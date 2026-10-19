'use strict';

process.env.NODE_ENV = 'test';

/**
 * Alpha defender flow, database-free: who may answer a challenge, what an
 * answer that changed nothing reports, and that nothing before an accept
 * can start the battle. The SQL guards and races run against real
 * PostgreSQL in tests/contract/db/challengeResponse.dbtest.js.
 */

jest.mock('../src/repositories/battle.repository', () => ({
  expireStaleBattles: jest.fn().mockResolvedValue([]),
  getById: jest.fn(),
  findIncomingChallenge: jest.fn(),
  acceptChallenge: jest.fn(),
  declineChallenge: jest.fn(),
  setPlayerReady: jest.fn(),
  recordDisconnect: jest.fn(),
  clearDisconnect: jest.fn(),
}));

const battleRepo = require('../src/repositories/battle.repository');
const battleService = require('../src/services/battle.service');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BATTLE = '33333333-3333-4333-8333-333333333333';

function battle(overrides = {}) {
  return {
    battle_id: BATTLE, attacker_id: A, defender_id: B, status: 'in_progress',
    accepted_at: null, declined_at: null, photon_room_name: `battle_${BATTLE}`,
    host_authority_secret: 'secret', match_nonce: 'nonce', ...overrides,
  };
}

describe('challenge answers', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    battleRepo.expireStaleBattles.mockResolvedValue([]);
  });

  test('challengeState maps the stored columns', () => {
    expect(battleService.challengeState(battle())).toBe('pending');
    expect(battleService.challengeState(battle({ accepted_at: 'x' }))).toBe('accepted');
    expect(battleService.challengeState(battle({ status: 'cancelled', declined_at: 'x' }))).toBe('declined');
    expect(battleService.challengeState(battle({ status: 'cancelled' }))).toBe('expired');
    expect(battleService.challengeState(battle({ status: 'resolved', accepted_at: 'x' }))).toBe('accepted');
  });

  test.each([['acceptChallenge'], ['declineChallenge']])('%s: the attacker cannot answer their own challenge', async (fn) => {
    battleRepo.getById.mockResolvedValue(battle());
    await expect(battleService[fn](BATTLE, A)).rejects.toMatchObject({ code: 'NOT_CHALLENGE_DEFENDER', statusCode: 403 });
    expect(battleRepo.acceptChallenge).not.toHaveBeenCalled();
    expect(battleRepo.declineChallenge).not.toHaveBeenCalled();
  });

  test.each([['acceptChallenge'], ['declineChallenge']])('%s: an unrelated player is refused without touching the battle', async (fn) => {
    battleRepo.getById.mockResolvedValue(battle());
    await expect(battleService[fn](BATTLE, C)).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(battleRepo.acceptChallenge).not.toHaveBeenCalled();
    expect(battleRepo.declineChallenge).not.toHaveBeenCalled();
  });

  test.each([
    ['accepted', { accepted_at: 'x' }, 'CHALLENGE_ALREADY_ANSWERED'],
    ['declined', { status: 'cancelled', declined_at: 'x' }, 'SESSION_EXPIRED'],
    ['expired', { status: 'cancelled' }, 'SESSION_EXPIRED'],
    ['resolved', { status: 'resolved', accepted_at: 'x' }, 'SESSION_EXPIRED'],
    ['forfeited', { status: 'forfeited', accepted_at: 'x' }, 'SESSION_EXPIRED'],
  ])('a %s challenge cannot be accepted', async (_name, overrides, code) => {
    battleRepo.getById.mockResolvedValue(battle(overrides));
    await expect(battleService.acceptChallenge(BATTLE, B)).rejects.toMatchObject({ code });
    expect(battleRepo.acceptChallenge).not.toHaveBeenCalled();
  });

  test('the cleanup runs before an answer is checked', async () => {
    battleRepo.getById.mockResolvedValue(battle());
    battleRepo.acceptChallenge.mockResolvedValue(battle({ accepted_at: 'now' }));
    await battleService.acceptChallenge(BATTLE, B);
    expect(battleRepo.expireStaleBattles).toHaveBeenCalledWith({ battleId: BATTLE }, expect.any(Object));
    expect(battleRepo.acceptChallenge).toHaveBeenCalledWith(BATTLE, B, 30);
  });

  test('losing a race reports what won: already answered, or no longer open', async () => {
    battleRepo.getById
      .mockResolvedValueOnce(battle()) // checks pass
      .mockResolvedValueOnce(battle({ accepted_at: 'other request' })); // re-read after the guarded UPDATE changed nothing
    battleRepo.acceptChallenge.mockResolvedValue(null);
    await expect(battleService.acceptChallenge(BATTLE, B)).rejects.toMatchObject({ code: 'CHALLENGE_ALREADY_ANSWERED' });

    battleRepo.getById
      .mockResolvedValueOnce(battle())
      .mockResolvedValueOnce(battle({ status: 'cancelled', declined_at: 'other request' }));
    await expect(battleService.acceptChallenge(BATTLE, B)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  test.each([['setReady'], ['handleDisconnect'], ['handleReconnect']])('%s on a pending challenge answers CHALLENGE_NOT_ACCEPTED', async (fn) => {
    battleRepo.getById.mockResolvedValue(battle());
    await expect(battleService[fn](BATTLE, A)).rejects.toMatchObject({ code: 'CHALLENGE_NOT_ACCEPTED', statusCode: 409 });
    expect(battleRepo.setPlayerReady).not.toHaveBeenCalled();
    expect(battleRepo.recordDisconnect).not.toHaveBeenCalled();
    expect(battleRepo.clearDisconnect).not.toHaveBeenCalled();
  });

  test('a result cannot be submitted before the defender accepted', async () => {
    battleRepo.getById.mockResolvedValue(battle());
    await expect(battleService.resolveBattle(BATTLE, A, { result: {}, signature: 'x' })).rejects.toMatchObject({ code: 'CHALLENGE_NOT_ACCEPTED' });
  });

  test('incoming challenges: zero or one, cleaned up first, expiring with the ready timeout', async () => {
    battleRepo.findIncomingChallenge.mockResolvedValueOnce(null);
    expect(await battleService.getIncomingChallenges(B)).toEqual([]);

    battleRepo.findIncomingChallenge.mockResolvedValueOnce({
      battle_id: BATTLE, attacker_id: A, challenged_at: '2026-10-19T10:00:00.000Z',
      attacker_username: 'alice_a', attacker_class_type: 'Scout', attacker_rank: 'Citizen',
    });
    expect(await battleService.getIncomingChallenges(B)).toEqual([{
      battle_id: BATTLE, attacker_id: A, attacker_username: 'alice_a', attacker_class_type: 'Scout',
      attacker_rank: 'Citizen', expires_at: '2026-10-19T10:00:30.000Z',
    }]);
    expect(battleRepo.expireStaleBattles).toHaveBeenCalledWith({ playerIds: [B] }, expect.any(Object));
    expect(battleRepo.findIncomingChallenge).toHaveBeenCalledWith(B);
  });
});

describe('challenge answer endpoints (HTTP)', () => {
  // Real rate limiters here: the poll and the answers are throttled.
  jest.resetModules();
  const request = require('supertest');

  beforeAll(() => {
    jest.doMock('../src/config/database', () => ({
      query: jest.fn(), checkConnection: jest.fn().mockResolvedValue(true), shutdown: jest.fn(),
      pool: { on: jest.fn(), query: jest.fn() }, withTransaction: jest.fn(),
    }));
    jest.doMock('../src/config/firebase', () => ({
      initializeFirebase: jest.fn(), checkFirebaseReady: jest.fn().mockReturnValue(true),
      verifyIdToken: jest.fn().mockResolvedValue({ uid: 'uid-b' }), admin: {},
    }));
  });

  function appWith(serviceOverrides) {
    let app;
    jest.isolateModules(() => {
      const db = require('../src/config/database');
      db.query.mockResolvedValue({ rows: [{ player_id: B, firebase_uid: 'uid-b' }] });
      const service = require('../src/services/battle.service');
      Object.assign(service, serviceOverrides);
      app = require('../src/app')();
    });
    return app;
  }

  test('the defender\'s answer never carries the host signing secret or nonce', async () => {
    const accepted = battle({ accepted_at: '2026-10-19T10:00:05.000Z', host_authority_secret: 'TOP-SECRET', match_nonce: 'NONCE' });
    const app = appWith({ acceptChallenge: jest.fn().mockResolvedValue(accepted) });
    const res = await request(app).post(`/battle/${BATTLE}/accept`).set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      battle_id: BATTLE, attacker_id: A, defender_id: B, status: 'in_progress', challenge_state: 'accepted',
      photon_room_name: `battle_${BATTLE}`, session_expires_at: undefined,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/TOP-SECRET|NONCE|host_authority_secret|match_nonce/);
  });

  test('the caller is the authenticated player: a body naming someone else is ignored', async () => {
    const acceptChallenge = jest.fn().mockResolvedValue(battle({ accepted_at: 'now' }));
    const app = appWith({ acceptChallenge });
    await request(app).post(`/battle/${BATTLE}/accept`).set('Authorization', 'Bearer t').send({ defender_id: C, player_id: C });
    expect(acceptChallenge).toHaveBeenCalledWith(BATTLE, B);
  });

  test('a malformed battle id answers BATTLE_NOT_FOUND; "incoming" is not taken as an id', async () => {
    const app = appWith({ getIncomingChallenges: jest.fn().mockResolvedValue([]) });
    const bad = await request(app).post('/battle/not-a-uuid/decline').set('Authorization', 'Bearer t');
    expect(bad.status).toBe(404);
    expect(bad.body.error.code).toBe('BATTLE_NOT_FOUND');
    const incoming = await request(app).get('/battle/incoming').set('Authorization', 'Bearer t');
    expect(incoming.status).toBe(200);
    expect(incoming.body.data).toEqual({ challenges: [] });
  });

  test('polling the incoming challenge is rate limited (3 per 5 s per player)', async () => {
    const app = appWith({ getIncomingChallenges: jest.fn().mockResolvedValue([]) });
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await request(app).get('/battle/incoming').set('Authorization', 'Bearer t')).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  test('answers are rate limited (3 per 5 s per player)', async () => {
    const app = appWith({ declineChallenge: jest.fn().mockResolvedValue(battle({ status: 'cancelled', declined_at: 'x' })) });
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await request(app).post(`/battle/${BATTLE}/decline`).set('Authorization', 'Bearer t')).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});
