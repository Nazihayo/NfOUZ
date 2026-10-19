'use strict';

/**
 * Alpha defender flow against REAL PostgreSQL: a challenge waits for the
 * defender's Accept or Decline (migration 021). Ownership, one answer per
 * challenge, races between answers and the expiry cleanup, release of
 * both players, and the host signing secret never reaching the defender —
 * all decided by PostgreSQL's own WHERE clauses, clock and row locks.
 *
 * Runs with `npm run test:contract:db` (same throwaway-database safety
 * rules as the contract test: db/dbSafety.js, db/realBackend.js).
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../../src/config/firebase', () => require('../firebaseStub'));
jest.mock('../../../src/middleware/rateLimit.middleware', () => require('../rateLimitStub'));

const fs = require('fs');
const path = require('path');
const request = require('supertest');

const safety = require('./dbSafety');
const { startRealBackend, stopRealBackend } = require('./realBackend');
const { reseed } = require('./seed');
const { baseWorld, ids } = require('../world');

const SETUP_TIMEOUT_MS = 180000;
const ctx = {};

let target = null;
let configError = null;
try {
  target = safety.validateConfig(process.env);
} catch (err) {
  configError = err;
}

async function sql(text, params = []) {
  return (await ctx.db.pool.query(text, params)).rows;
}

const as = (uid) => ({
  get: (p) => request(ctx.app).get(p).set('Authorization', `Bearer ${uid}`),
  post: (p, body) => request(ctx.app).post(p).set('Authorization', `Bearer ${uid}`)
    .set('Content-Type', 'application/json').send(JSON.stringify(body || {})),
});

/** World with A's battle against B already over, and C standing next to A. */
async function freshWorld() {
  const world = JSON.parse(JSON.stringify(baseWorld()));
  Object.assign(world.players[2], { last_lat: 52.5978, last_lng: 9.0854 });
  await reseed(ctx.db.pool, ctx.state.createdName, world);
  await sql("UPDATE battles SET status = 'resolved', ended_at = now() WHERE battle_id = $1", [ids.battle]);
}

/** A challenges C; returns the attacker's response body data. */
async function challengeAtoC() {
  const res = await as('uid-a').post('/battle/challenge', { defender_id: ids.C, location: { lat: 52.5978, lng: 9.0854 } });
  expect(res.status).toBe(200);
  return res.body.data;
}

async function ageChallenge(battleId, seconds) {
  await sql(
    `UPDATE battles SET started_at = now() - $2 * interval '1 second',
            session_started_at = now() - $2 * interval '1 second' WHERE battle_id = $1`,
    [battleId, seconds]
  );
}

const row = async (battleId) => (await sql('SELECT * FROM battles WHERE battle_id = $1', [battleId]))[0];
const statusesOf = (responses) => responses.map((r) => r.status).sort();

if (configError) {
  describe('Challenge response (real PostgreSQL)', () => {
    test('is configured safely', () => {
      throw new Error(configError.message);
    });
  });
} else {
  beforeAll(async () => {
    await startRealBackend(target, ctx);
  }, SETUP_TIMEOUT_MS);

  afterAll(() => stopRealBackend(ctx), SETUP_TIMEOUT_MS);

  describe('Challenge response (real PostgreSQL)', () => {
    beforeEach(freshWorld);

    test('a new challenge is pending and appears only for its defender', async () => {
      const battle = await challengeAtoC();
      expect(battle.challenge_state).toBe('pending');
      expect(battle.accepted_at).toBeNull();

      const forC = await as('uid-c').get('/battle/incoming');
      expect(forC.status).toBe(200);
      expect(forC.body.data.challenges).toHaveLength(1);
      expect(forC.body.data.challenges[0]).toMatchObject({
        battle_id: battle.battle_id, attacker_id: ids.A, attacker_username: 'alpha_one', attacker_class_type: 'Scout',
      });
      expect(Date.parse(forC.body.data.challenges[0].expires_at) - Date.now()).toBeGreaterThan(20000);

      for (const uid of ['uid-a', 'uid-b']) {
        expect((await as(uid).get('/battle/incoming')).body.data.challenges).toEqual([]);
      }
    });

    test('accept succeeds once, gives both sides the same room, and never the host secret', async () => {
      const attacker = await challengeAtoC();
      const accept = await as('uid-c').post(`/battle/${attacker.battle_id}/accept`);
      expect(accept.status).toBe(200);
      expect(accept.body.data).toMatchObject({ battle_id: attacker.battle_id, challenge_state: 'accepted', defender_id: ids.C });
      expect(accept.body.data.photon_room_name).toBe(attacker.photon_room_name);
      const stored = await row(attacker.battle_id);
      const text = JSON.stringify(accept.body);
      expect(text).not.toContain(stored.host_authority_secret);
      expect(text).not.toContain(stored.match_nonce);
      expect(text).not.toMatch(/host_authority_secret|match_nonce/);

      const again = await as('uid-c').post(`/battle/${attacker.battle_id}/accept`);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('CHALLENGE_ALREADY_ANSWERED');

      // The defender's GET never carries it either, and shows the same room.
      const get = await as('uid-c').get(`/battle/${attacker.battle_id}`);
      expect(get.body.data.photon_room_name).toBe(attacker.photon_room_name);
      expect(get.body.data.challenge_state).toBe('accepted');
      expect(JSON.stringify(get.body)).not.toContain(stored.host_authority_secret);
      expect((await as('uid-c').get('/battle/incoming')).body.data.challenges).toEqual([]);
    });

    test('decline succeeds once and frees both players for new challenges', async () => {
      const attacker = await challengeAtoC();
      const decline = await as('uid-c').post(`/battle/${attacker.battle_id}/decline`);
      expect(decline.status).toBe(200);
      expect(decline.body.data).toMatchObject({ status: 'cancelled', challenge_state: 'declined' });
      expect((await as('uid-c').post(`/battle/${attacker.battle_id}/decline`)).body.error.code).toBe('SESSION_EXPIRED');
      expect((await as('uid-c').post(`/battle/${attacker.battle_id}/accept`)).body.error.code).toBe('SESSION_EXPIRED');

      expect((await as('uid-a').get(`/battle/${attacker.battle_id}`)).body.data.challenge_state).toBe('declined');
      // Either player may now challenge the other.
      const back = await as('uid-c').post('/battle/challenge', { defender_id: ids.A, location: { lat: 52.5978, lng: 9.0854 } });
      expect(back.status).toBe(200);
      const stored = await row(attacker.battle_id);
      expect(stored.declined_at).not.toBeNull();
      expect(stored.accepted_at).toBeNull();
    });

    test('the attacker cannot answer their own challenge; an unrelated player cannot answer it', async () => {
      const attacker = await challengeAtoC();
      for (const action of ['accept', 'decline']) {
        const own = await as('uid-a').post(`/battle/${attacker.battle_id}/${action}`);
        expect([own.status, own.body.error.code]).toEqual([403, 'NOT_CHALLENGE_DEFENDER']);
        const other = await as('uid-b').post(`/battle/${attacker.battle_id}/${action}`);
        expect([other.status, other.body.error.code]).toEqual([403, 'FORBIDDEN']);
      }
      expect((await row(attacker.battle_id)).accepted_at).toBeNull();
      expect((await row(attacker.battle_id)).status).toBe('in_progress');
    });

    test('simultaneous accepts and declines produce exactly one outcome', async () => {
      for (let round = 0; round < 3; round++) {
        await freshWorld();
        const attacker = await challengeAtoC();
        const responses = await Promise.all([
          as('uid-c').post(`/battle/${attacker.battle_id}/accept`),
          as('uid-c').post(`/battle/${attacker.battle_id}/decline`),
          as('uid-c').post(`/battle/${attacker.battle_id}/accept`),
          as('uid-c').post(`/battle/${attacker.battle_id}/decline`),
        ]);
        expect(statusesOf(responses).filter((s) => s === 200)).toHaveLength(1);
        const stored = await row(attacker.battle_id);
        expect(Boolean(stored.accepted_at) !== Boolean(stored.declined_at)).toBe(true);
        const winner = responses.find((r) => r.status === 200).body.data.challenge_state;
        expect(winner).toBe(stored.accepted_at ? 'accepted' : 'declined');
      }
    });

    test('an accept racing the expiry cleanup has one outcome', async () => {
      const attacker = await challengeAtoC();
      await ageChallenge(attacker.battle_id, 31);
      const [accept, poll] = await Promise.all([
        as('uid-c').post(`/battle/${attacker.battle_id}/accept`),
        as('uid-a').get(`/battle/${attacker.battle_id}`),
      ]);
      expect(accept.status).toBe(409);
      expect(accept.body.error.code).toBe('SESSION_EXPIRED');
      expect(poll.body.data.challenge_state).toBe('expired');
      expect((await row(attacker.battle_id)).accepted_at).toBeNull();
    });

    test('an unanswered challenge expires after the ready timeout and stops blocking both players', async () => {
      const attacker = await challengeAtoC();
      await ageChallenge(attacker.battle_id, 29);
      expect((await as('uid-c').get('/battle/incoming')).body.data.challenges).toHaveLength(1);

      await ageChallenge(attacker.battle_id, 31);
      expect((await as('uid-c').get('/battle/incoming')).body.data.challenges).toEqual([]);
      const stored = await row(attacker.battle_id);
      expect(stored.status).toBe('cancelled');
      expect(stored.accepted_at).toBeNull();
      expect(stored.declined_at).toBeNull();
      expect((await as('uid-c').post(`/battle/${attacker.battle_id}/accept`)).body.error.code).toBe('SESSION_EXPIRED');
      expect((await as('uid-a').post('/battle/challenge', { defender_id: ids.C, location: { lat: 52.5978, lng: 9.0854 } })).status).toBe(200);
    });

    test('nothing can start the battle before the accept', async () => {
      const attacker = await challengeAtoC();
      for (const action of ['ready', 'disconnect', 'reconnect']) {
        const res = await as('uid-a').post(`/battle/${attacker.battle_id}/${action}`);
        expect([res.status, res.body.error.code]).toEqual([409, 'CHALLENGE_NOT_ACCEPTED']);
      }
      await as('uid-c').post(`/battle/${attacker.battle_id}/accept`);
      expect((await as('uid-a').post(`/battle/${attacker.battle_id}/ready`)).status).toBe(200);
      expect((await as('uid-c').post(`/battle/${attacker.battle_id}/ready`)).status).toBe(200);
    });

    test('the ready timeout restarts at the accept', async () => {
      const attacker = await challengeAtoC();
      await as('uid-c').post(`/battle/${attacker.battle_id}/accept`);
      // Challenged 40 s ago but accepted 5 s ago: still inside the ready window.
      await ageChallenge(attacker.battle_id, 40);
      await sql("UPDATE battles SET accepted_at = now() - interval '5 seconds' WHERE battle_id = $1", [attacker.battle_id]);
      expect((await as('uid-a').get(`/battle/${attacker.battle_id}`)).body.data.status).toBe('in_progress');
      // Accepted 31 s ago and nobody ready: cancelled by the existing rule.
      await sql("UPDATE battles SET accepted_at = now() - interval '31 seconds' WHERE battle_id = $1", [attacker.battle_id]);
      const after = await as('uid-a').get(`/battle/${attacker.battle_id}`);
      expect(after.body.data).toMatchObject({ status: 'cancelled', challenge_state: 'accepted' });
    });

    test('a pending incoming challenge is not offered to another account on the same device', async () => {
      await challengeAtoC();
      // Same "device", other signed-in account: the server derives the
      // defender from the token, so B sees nothing of C's invitation.
      expect((await as('uid-b').get('/battle/incoming')).body.data.challenges).toEqual([]);
    });

    test('migration 021 records pre-existing battles as accepted, and re-applying it changes nothing', async () => {
      await sql('ALTER TABLE battles DROP CONSTRAINT battles_answered_once_check');
      await sql('UPDATE battles SET accepted_at = NULL WHERE battle_id = $1', [ids.battle]);
      const migration = fs.readFileSync(path.join(__dirname, '../../../migrations/021_battle_challenge_response.sql'), 'utf8');
      await sql(migration);
      const legacy = await row(ids.battle);
      expect(legacy.accepted_at).toEqual(legacy.session_started_at);
      const before = await sql('SELECT battle_id, accepted_at, declined_at, status FROM battles ORDER BY battle_id');
      await sql(migration);
      expect(await sql('SELECT battle_id, accepted_at, declined_at, status FROM battles ORDER BY battle_id')).toEqual(before);
      await expect(sql('UPDATE battles SET accepted_at = now(), declined_at = now() WHERE battle_id = $1', [ids.battle]))
        .rejects.toThrow(/battles_answered_once_check/);
    });
  });
}
