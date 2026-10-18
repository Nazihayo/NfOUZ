'use strict';

process.env.NODE_ENV = 'test';

/**
 * Malformed client input answers a 4xx envelope before it reaches the
 * database (database-free; the same cases run against real PostgreSQL in
 * tests/contract/db/inputRobustness.dbtest.js).
 */

const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  checkConnection: jest.fn().mockResolvedValue(true),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
  withTransaction: jest.fn(),
}));
jest.mock('../src/config/firebase', () => ({
  initializeFirebase: jest.fn(),
  checkFirebaseReady: jest.fn().mockReturnValue(true),
  verifyIdToken: jest.fn(),
  admin: {},
}));
jest.mock('../src/middleware/rateLimit.middleware', () => {
  const passThrough = (req, res, next) => next();
  return {
    locationUpdateLimiter: passThrough,
    nearbyQueryLimiter: passThrough,
    battleChallengeLimiter: passThrough,
    friendRequestLimiter: passThrough,
    sosCreateLimiter: passThrough,
  };
});

const db = require('../src/config/database');
const { verifyIdToken } = require('../src/config/firebase');
const createApp = require('../src/app');
const { isUuid } = require('../src/utils/ids');

const SELF = { player_id: '11111111-1111-4111-8111-111111111111', firebase_uid: 'uid-self' };

describe('input validation', () => {
  let app;

  beforeEach(() => {
    jest.resetAllMocks();
    verifyIdToken.mockResolvedValue({ uid: SELF.firebase_uid });
    db.query.mockResolvedValue({ rows: [SELF] });
    app = createApp();
  });

  test('isUuid accepts canonical UUIDs only', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isUuid('AAAAAAAA-1111-4111-8111-111111111111')).toBe(true);
    for (const bad of ['not-a-uuid', '', null, 42, {}, '11111111111141118111111111111111', '{11111111-1111-4111-8111-111111111111}']) {
      expect(isUuid(bad)).toBe(false);
    }
  });

  test.each([
    ['get', '/battle/x', 'BATTLE_NOT_FOUND'],
    ['post', '/battle/x/ready', 'BATTLE_NOT_FOUND'],
    ['post', '/battle/x/resolve', 'BATTLE_NOT_FOUND'],
    ['get', '/sos/x', 'SOS_NOT_FOUND'],
    ['post', '/rescue/x/guard-battle/start', 'RESCUE_MISSION_NOT_FOUND'],
    ['post', '/quests/x/claim', 'QUEST_NOT_FOUND'],
    ['delete', '/friends/x', 'PLAYER_NOT_FOUND'],
  ])('%s %s with a malformed id answers 404 %s without querying the database', async (method, path, code) => {
    const res = await request(app)[method](path).set('Authorization', 'Bearer t').send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(code);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('a malformed id without a token still answers 401 INVALID_TOKEN first', async () => {
    const res = await request(app).get('/battle/x');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  test.each([
    ['/battle/challenge', { defender_id: 'x' }, 'INVALID_CHALLENGE'],
    ['/battle/challenge', { defender_id: 7 }, 'INVALID_CHALLENGE'],
    ['/friends/request', { player_id: 'x' }, 'INVALID_REQUEST'],
    ['/friends/block', { player_id: 'x' }, 'INVALID_REQUEST'],
    ['/rescue/accept', { sos_id: 'x' }, 'INVALID_REQUEST'],
    ['/inventory/equip', { item_key: 'k', request_id: 'r'.repeat(101) }, 'INVALID_REQUEST'],
  ])('POST %s with %j answers 400 %s', async (path, body, code) => {
    const res = await request(app).post(path).set('Authorization', 'Bearer t').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
  });

  test('malformed JSON answers 400 INVALID_REQUEST, not 500', async () => {
    const res = await request(app).post('/battle/challenge').set('Authorization', 'Bearer t')
      .set('Content-Type', 'application/json').send('{"defender_id": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, data: null, error: { code: 'INVALID_REQUEST', message: 'The request body is not valid JSON.' } });
  });

  test('a body over the 1 MB limit answers 413 PAYLOAD_TOO_LARGE, not 500', async () => {
    const res = await request(app).post('/battle/challenge').set('Authorization', 'Bearer t')
      .set('Content-Type', 'application/json').send(JSON.stringify({ pad: 'x'.repeat(1100 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('X-Request-Id is echoed only when it looks like an id', async () => {
    const ok = await request(app).get('/health').set('X-Request-Id', 'abc-123_x.y');
    expect(ok.headers['x-request-id']).toBe('abc-123_x.y');
    for (const bad of ['a'.repeat(129), 'has space', '{"json":1}']) {
      const res = await request(app).get('/health').set('X-Request-Id', bad);
      expect(res.headers['x-request-id']).not.toBe(bad);
      expect(isUuid(res.headers['x-request-id'])).toBe(true);
    }
  });
});
