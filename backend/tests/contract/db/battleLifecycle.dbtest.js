'use strict';

/**
 * Battle lifecycle against REAL PostgreSQL: a battle that can no longer
 * finish normally is ended (utils/battleLifecycle.js) instead of blocking
 * both players forever, and nothing valid is ended early or overwritten.
 * Uses PostgreSQL's own clock, WHERE clauses and row locks — exactly what
 * the fake-database tests cannot check.
 *
 * Runs with `npm run test:contract:db` (same throwaway-database safety
 * rules as the contract test: db/dbSafety.js, db/realBackend.js).
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../../src/config/firebase', () => require('../firebaseStub'));
jest.mock('../../../src/middleware/rateLimit.middleware', () => require('../rateLimitStub'));

const request = require('supertest');

const safety = require('./dbSafety');
const { startRealBackend, stopRealBackend } = require('./realBackend');
const { reseed } = require('./seed');
const { baseWorld, ids, signResult } = require('../world');

const SETUP_TIMEOUT_MS = 180000;
const ctx = {};
let battleRepo;
let limits;

let target = null;
let configError = null;
try {
  target = safety.validateConfig(process.env);
} catch (err) {
  configError = err;
}

const OLD_BATTLE = ids.battle;
const HISTORY_TIME = '2026-01-02T03:04:05.000Z';

/** Fresh world; the A-vs-B battle's timing is then set with PostgreSQL's own clock. */
async function setup({ startedSecondsAgo, ready = [false, false], extra = {}, worldChange } = {}) {
  const world = JSON.parse(JSON.stringify(baseWorld()));
  // C stands next to A, so A can challenge C.
  Object.assign(world.players[2], { last_lat: 52.5978, last_lng: 9.0854 });
  if (worldChange) worldChange(world);
  await reseed(ctx.db.pool, ctx.state.createdName, world);
  if (startedSecondsAgo !== undefined) {
    await sql(
      `UPDATE battles SET started_at = now() - $2 * interval '1 second',
              session_started_at = now() - $2 * interval '1 second',
              session_expires_at = now() - ($2 - 90) * interval '1 second',
              attacker_ready = $3, defender_ready = $4
       WHERE battle_id = $1`,
      [OLD_BATTLE, startedSecondsAgo, ready[0], ready[1]]
    );
  }
  for (const [column, value] of Object.entries(extra)) {
    if (!/^[a-z_]+$/.test(column)) throw new Error(`bad column ${column}`);
    await sql(`UPDATE battles SET ${column} = ${value} WHERE battle_id = $1`, [OLD_BATTLE]);
  }
}

/**
 * Runs `fn(client)` on a dedicated connection inside BEGIN … COMMIT. On
 * any failure it rolls back, and the connection is always destroyed
 * rather than returned to the pool: a half-finished transaction must
 * never leak locks into later tests.
 */
async function inTransaction(fn) {
  const client = await ctx.db.pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const value = await fn(client, async () => {
      await client.query('COMMIT');
      committed = true;
    });
    return value;
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    client.release(true);
  }
}

async function sql(text, params = []) {
  return (await ctx.db.pool.query(text, params)).rows;
}

const oldBattle = async () => (await sql('SELECT * FROM battles WHERE battle_id = $1', [OLD_BATTLE]))[0];

function challenge(asUid, defenderId) {
  return request(ctx.app).post('/battle/challenge').set('Authorization', `Bearer ${asUid}`)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ defender_id: defenderId, location: { lat: 52.5978, lng: 9.0854 } }));
}

function signedResult(overrides = {}) {
  const result = {
    battle_id: OLD_BATTLE, room_name: `battle_${OLD_BATTLE}`, rules_version: 'v1', match_nonce: 'nonce-1',
    event_seq: 1, attacker_id: ids.A, defender_id: ids.B, attacker_final_health: 60, defender_final_health: 0,
    outcome: 'attacker_win', duration_seconds: 45, issued_at: new Date().toISOString(), ...overrides,
  };
  return { result, signature: signResult(result) };
}

if (configError) {
  describe('Battle lifecycle (real PostgreSQL)', () => {
    test('is configured safely', () => {
      throw new Error(configError.message);
    });
  });
} else {
  beforeAll(async () => {
    await startRealBackend(target, ctx);
    // eslint-disable-next-line global-require
    battleRepo = require('../../../src/repositories/battle.repository');
    // eslint-disable-next-line global-require
    limits = require('../../../src/utils/battleLifecycle').battleLifecycleLimits();
  }, SETUP_TIMEOUT_MS);

  afterAll(() => stopRealBackend(ctx), SETUP_TIMEOUT_MS);

  describe('Battle lifecycle (real PostgreSQL)', () => {
    test('limits come from the existing settings: ready 30 s, no-result cutoff 298 s', () => {
      expect(limits).toEqual({ readyTimeoutSeconds: 30, noResultCutoffSeconds: 298 });
    });

    test('a started battle past the no-result cutoff no longer blocks a new challenge', async () => {
      await setup({ startedSecondsAgo: 300, ready: [true, true] });

      const res = await challenge('uid-a', ids.B);

      expect(res.status).toBe(200);
      const old = await oldBattle();
      expect(old.status).toBe('cancelled');
      expect(old.ended_at).not.toBeNull();
      expect(old.winner_id).toBeNull();
      expect(res.body.data.battle_id).not.toBe(OLD_BATTLE);
      expect((await sql("SELECT count(*)::int AS n FROM battles WHERE status = 'in_progress'"))[0].n).toBe(1);
    });

    test('a battle created long before the lifecycle columns existed also recovers', async () => {
      await setup({ startedSecondsAgo: 86400, ready: [true, true], extra: { session_started_at: 'NULL' } });

      const res = await request(ctx.app).get(`/battle/${OLD_BATTLE}`).set('Authorization', 'Bearer uid-a');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
    });

    test('a fresh battle stays active and still blocks a duplicate challenge', async () => {
      await setup({ startedSecondsAgo: 10 });

      const res = await challenge('uid-a', ids.B);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_CHALLENGE');
      expect((await oldBattle()).status).toBe('in_progress');
    });

    test('a battle in overtime is not ended early, even though session_expires_at has passed', async () => {
      await setup({ startedSecondsAgo: 160, ready: [true, true] });
      expect(new Date((await oldBattle()).session_expires_at).getTime()).toBeLessThan(Date.now());

      const res = await challenge('uid-a', ids.B);

      expect(res.body.error && res.body.error.code).toBe('DUPLICATE_CHALLENGE');
      expect((await oldBattle()).status).toBe('in_progress');
    });

    test('not both ready within the 30 s ready timeout -> cancelled; within it -> still active', async () => {
      await setup({ startedSecondsAgo: 20, ready: [true, false] });
      expect((await challenge('uid-a', ids.B)).body.error.code).toBe('DUPLICATE_CHALLENGE');
      expect((await oldBattle()).status).toBe('in_progress');

      await setup({ startedSecondsAgo: 31, ready: [true, false] });
      expect((await challenge('uid-a', ids.B)).status).toBe(200);
      expect((await oldBattle()).status).toBe('cancelled');
    });

    test('a battle inside its reconnect window is not ended early', async () => {
      await setup({
        startedSecondsAgo: 60,
        ready: [true, true],
        extra: { defender_disconnected_at: "now() - interval '5 seconds'", defender_reconnect_deadline: "now() + interval '10 seconds'" },
      });

      const res = await request(ctx.app).get(`/battle/${OLD_BATTLE}`).set('Authorization', 'Bearer uid-a');

      expect(res.body.data.status).toBe('in_progress');
      const reconnect = await request(ctx.app).post(`/battle/${OLD_BATTLE}/reconnect`).set('Authorization', 'Bearer uid-b');
      expect(reconnect.status).toBe(200);
    });

    test('an expired reconnect window follows the existing forfeit rule (no winner, no Influence or Control)', async () => {
      await setup({
        startedSecondsAgo: 60,
        ready: [true, true],
        extra: { defender_disconnected_at: "now() - interval '30 seconds'", defender_reconnect_deadline: "now() - interval '15 seconds'" },
      });
      const before = await sql('SELECT player_id, influence, is_controlled FROM players ORDER BY player_id');

      const reconnect = await request(ctx.app).post(`/battle/${OLD_BATTLE}/reconnect`).set('Authorization', 'Bearer uid-b');
      const poll = await request(ctx.app).get(`/battle/${OLD_BATTLE}`).set('Authorization', 'Bearer uid-a');

      expect(reconnect.status).toBe(409);
      expect(reconnect.body.error.code).toBe('RECONNECT_WINDOW_EXPIRED');
      expect(poll.body.data.status).toBe('forfeited');
      expect(poll.body.data.forfeited_by).toBe(ids.B);
      expect(poll.body.data.winner_id).toBeNull();
      expect(await sql('SELECT player_id, influence, is_controlled FROM players ORDER BY player_id')).toEqual(before);
    });

    test('every battle endpoint answers SESSION_EXPIRED for a battle that just went stale', async () => {
      await setup({ startedSecondsAgo: 300, ready: [true, true] });

      const ready = await request(ctx.app).post(`/battle/${OLD_BATTLE}/ready`).set('Authorization', 'Bearer uid-a');
      const resolve = await request(ctx.app).post(`/battle/${OLD_BATTLE}/resolve`).set('Authorization', 'Bearer uid-a')
        .set('Content-Type', 'application/json').send(JSON.stringify(signedResult()));

      expect(ready.status).toBe(409);
      expect(ready.body.error.code).toBe('SESSION_EXPIRED');
      expect(resolve.status).toBe(409);
      expect(resolve.body.error.code).toBe('SESSION_EXPIRED');
      expect((await oldBattle()).status).toBe('cancelled');
    });

    test('cleanup is idempotent', async () => {
      await setup({ startedSecondsAgo: 300, ready: [true, true] });

      const first = await battleRepo.expireStaleBattles({ battleId: OLD_BATTLE }, limits);
      const endedAt = (await oldBattle()).ended_at;
      const second = await battleRepo.expireStaleBattles({ battleId: OLD_BATTLE }, limits);

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0);
      expect((await oldBattle()).ended_at).toEqual(endedAt);
    });

    test('simultaneous cleanups produce exactly one terminal outcome', async () => {
      await setup({ startedSecondsAgo: 300, ready: [true, true] });

      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2
        ? battleRepo.expireStaleBattles({ battleId: OLD_BATTLE }, limits)
        : battleRepo.expireStaleBattles({ playerIds: [ids.A, ids.B] }, limits))));

      expect(results.reduce((n, rows) => n + rows.length, 0)).toBe(1);
      expect((await oldBattle()).status).toBe('cancelled');
    });

    test('a result submitted while cleanup runs is never overwritten', async () => {
      // Past the cutoff, so cleanup wants to cancel it; the result commits first.
      await setup({ startedSecondsAgo: 300, ready: [true, true] });
      let cleanup;
      await inTransaction(async (client, commit) => {
        const resolved = await battleRepo.resolveBattle(OLD_BATTLE, {
          winnerId: ids.A, loserId: ids.B, durationSeconds: 45, eventSeq: 1,
        }, client);
        expect(resolved.status).toBe('resolved');

        cleanup = battleRepo.expireStaleBattles({ battleId: OLD_BATTLE }, limits); // waits for the row lock
        await new Promise((r) => setTimeout(r, 200));
        await commit();
      });
      expect(await cleanup).toHaveLength(0);
      const old = await oldBattle();
      expect(old.status).toBe('resolved');
      expect(old.winner_id).toBe(ids.A);
    });

    test('a result arriving after cleanup ended the battle is refused, not applied', async () => {
      await setup({ startedSecondsAgo: 300, ready: [true, true] });
      let late;
      await inTransaction(async (client, commit) => {
        const ended = await battleRepo.expireStaleBattles({ battleId: OLD_BATTLE }, limits, client);
        expect(ended).toHaveLength(1);

        late = battleRepo.resolveBattle(OLD_BATTLE, {
          winnerId: ids.A, loserId: ids.B, durationSeconds: 45, eventSeq: 1,
        }); // waits for the row lock
        await new Promise((r) => setTimeout(r, 200));
        await commit();
      });
      expect(await late).toBeNull();
      expect((await oldBattle()).status).toBe('cancelled');
    });

    test('a valid result on a live battle still resolves normally', async () => {
      await setup({ startedSecondsAgo: 60, ready: [true, true] });

      const res = await request(ctx.app).post(`/battle/${OLD_BATTLE}/resolve`).set('Authorization', 'Bearer uid-a')
        .set('Content-Type', 'application/json').send(JSON.stringify(signedResult()));

      expect(res.status).toBe(200);
      expect(res.body.data.result).toBe('attacker_win');
      expect((await oldBattle()).status).toBe('resolved');
    });

    test('both players are released, whichever side they were on', async () => {
      // B challenged A long ago and nothing happened since.
      await setup({
        startedSecondsAgo: 300,
        ready: [true, true],
        worldChange: (w) => { Object.assign(w.battles[0], { attacker_id: ids.B, defender_id: ids.A, host_player_id: ids.B }); },
      });

      const res = await challenge('uid-a', ids.C); // A was the defender

      expect(res.status).toBe(200);
      expect((await oldBattle()).status).toBe('cancelled');
      expect(await battleRepo.findActiveBattleForPlayer(ids.B)).toBeNull(); // B was the attacker
    });

    test('a stale battle no longer locks the inventory', async () => {
      await setup({ startedSecondsAgo: 300, ready: [true, true] });

      const res = await request(ctx.app).post('/inventory/use').set('Authorization', 'Bearer uid-a')
        .set('Content-Type', 'application/json').send(JSON.stringify({ item_key: 'Health Kit', request_id: 'lifecycle-use-1' }));

      expect(res.status).toBe(200);
    });

    test('battles that already ended are never changed', async () => {
      await setup({
        worldChange: (w) => {
          w.battles = ['resolved', 'forfeited', 'cancelled', 'pending_review'].map((status, i) => ({
            ...w.battles[0], battle_id: `00000000-0000-4000-8000-00000000000${i}`, photon_room_name: `battle_hist_${i}`,
            status, started_at: '2026-01-01T00:00:00.000Z', session_started_at: '2026-01-01T00:00:00.000Z',
            ended_at: HISTORY_TIME, winner_id: status === 'resolved' ? ids.A : null, attacker_ready: true, defender_ready: true,
            defender_disconnected_at: '2026-01-01T00:00:10.000Z', defender_reconnect_deadline: '2026-01-01T00:00:25.000Z',
          }));
          w.control_relationships = [];
          w.sos_requests = [];
          w.rescue_missions = [];
        },
      });
      const before = await sql('SELECT * FROM battles ORDER BY battle_id');

      const ended = await battleRepo.expireStaleBattles({ playerIds: [ids.A, ids.B] }, limits);

      expect(ended).toHaveLength(0);
      expect(await sql('SELECT * FROM battles ORDER BY battle_id')).toEqual(before);
    });

    test('Control, SOS and rescue rows are untouched when a battle is cancelled', async () => {
      await setup({ startedSecondsAgo: 300, ready: [true, true] });
      const snapshot = async () => ({
        control: await sql('SELECT * FROM control_relationships ORDER BY control_relationship_id'),
        sos: await sql('SELECT * FROM sos_requests ORDER BY sos_id'),
        rescue: await sql('SELECT * FROM rescue_missions ORDER BY mission_id'),
        players: await sql('SELECT player_id, influence, is_controlled, controller_id, controlled_until, protected_until FROM players ORDER BY player_id'),
      });
      const before = await snapshot();

      await battleRepo.expireStaleBattles({ battleId: OLD_BATTLE }, limits);

      expect((await oldBattle()).status).toBe('cancelled');
      expect(await snapshot()).toEqual(before);
    });
  });
}
