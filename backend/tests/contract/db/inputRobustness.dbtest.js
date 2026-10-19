'use strict';

/**
 * Malformed and oversized client input against REAL PostgreSQL: every
 * endpoint must answer it with a 4xx error envelope, never a 500 (which
 * the client can only show as a generic failure, and which logs a stack
 * trace). PostgreSQL itself rejects bad UUIDs and over-long text, so only
 * the real database shows what reaches it.
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

const BAD_ID = 'not-a-uuid';
const LONG = 'x'.repeat(5000);

/** [label, method, path, body?] — every request is sent as player A. */
const CASES = [
  ['battle id: GET', 'get', `/battle/${BAD_ID}`],
  ['battle id: ready', 'post', `/battle/${BAD_ID}/ready`, {}],
  ['battle id: disconnect', 'post', `/battle/${BAD_ID}/disconnect`, {}],
  ['battle id: reconnect', 'post', `/battle/${BAD_ID}/reconnect`, {}],
  ['battle id: resolve', 'post', `/battle/${BAD_ID}/resolve`, { result: {}, signature: 'x' }],
  ['challenge: defender_id not a uuid', 'post', '/battle/challenge', { defender_id: BAD_ID }],
  ['challenge: defender_id is a number', 'post', '/battle/challenge', { defender_id: 123 }],
  ['challenge: defender_id is an object', 'post', '/battle/challenge', { defender_id: { id: ids.B } }],
  ['challenge: location not numbers', 'post', '/battle/challenge', { defender_id: ids.B, location: { lat: 'abc', lng: [] } }],
  ['resolve: result is a string', 'post', `/battle/${ids.battle}/resolve`, { result: 'attacker_win', signature: 'x' }],
  ['resolve: signature is an object', 'post', `/battle/${ids.battle}/resolve`, { result: {}, signature: { a: 1 } }],
  ['resolve: battle_id inside result not a uuid', 'post', `/battle/${ids.battle}/resolve`, { result: { battle_id: BAD_ID }, signature: 'x' }],
  ['sos id: GET', 'get', `/sos/${BAD_ID}`],
  ['rescue accept: sos_id not a uuid', 'post', '/rescue/accept', { sos_id: BAD_ID }],
  ['rescue accept: sos_id is an object', 'post', '/rescue/accept', { sos_id: { a: 1 } }],
  ['rescue mission id: start', 'post', `/rescue/${BAD_ID}/guard-battle/start`, {}],
  ['rescue mission id: resolve', 'post', `/rescue/${BAD_ID}/guard-battle/resolve`, { outcome: 'win', guard_battle_token: 'x' }],
  ['quest id: claim', 'post', `/quests/${BAD_ID}/claim`, { request_id: 'r-1' }],
  ['quest claim: request_id is an object', 'post', `/quests/${ids.quest}/claim`, { request_id: { a: 1 } }],
  ['inventory equip: request_id longer than its column', 'post', '/inventory/equip', { item_key: 'test_sword', request_id: LONG }],
  ['inventory use: request_id longer than its column', 'post', '/inventory/use', { item_key: 'test_potion', request_id: LONG }],
  ['inventory equip: item_key very long', 'post', '/inventory/equip', { item_key: LONG, request_id: 'r-2' }],
  ['inventory equip: item_key is an object', 'post', '/inventory/equip', { item_key: { a: 1 }, request_id: 'r-3' }],
  ['friends request: player_id not a uuid', 'post', '/friends/request', { player_id: BAD_ID }],
  ['friends accept: player_id not a uuid', 'post', '/friends/accept', { player_id: BAD_ID }],
  ['friends decline: player_id not a uuid', 'post', '/friends/decline', { player_id: BAD_ID }],
  ['friends block: player_id not a uuid', 'post', '/friends/block', { player_id: BAD_ID }],
  ['friends unblock: player_id not a uuid', 'post', '/friends/unblock', { player_id: BAD_ID }],
  ['friends remove: path id not a uuid', 'delete', `/friends/${BAD_ID}`],
  ['friends request: player_id is an object', 'post', '/friends/request', { player_id: { a: 1 } }],
  ['location: lat/lng not numbers', 'patch', `/player/${ids.A}/location`, { lat: 'abc', lng: 'def' }],
  ['location: out of range', 'patch', `/player/${ids.A}/location`, { lat: 1e9, lng: -1e9 }],
  ['location: other player id', 'patch', `/player/${BAD_ID}/location`, { lat: 1, lng: 1 }],
  ['nearby: lat not a number', 'get', '/player/nearby?lat=abc&lng=9'],
  ['nearby: repeated query keys', 'get', '/player/nearby?lat=52.5&lat=53&lng=9.0'],
  ['fcm token: oversized', 'patch', `/player/${ids.A}/fcm-token`, { device_key: 'k', fcm_token: LONG, platform: 'android' }],
  ['fcm token: wrong types', 'patch', `/player/${ids.A}/fcm-token`, { device_key: {}, fcm_token: [], platform: 1 }],
  ['register: username is an object', 'post', '/auth/register', { username: { a: 1 }, class_type: 'scout' }],
  ['register: username very long', 'post', '/auth/register', { username: LONG, class_type: 'scout' }],
];

function send(method, path, body, uid = 'uid-a') {
  let req = request(ctx.app)[method](path).set('Authorization', `Bearer ${uid}`);
  if (body !== undefined) req = req.set('Content-Type', 'application/json').send(JSON.stringify(body));
  return req;
}

if (configError) {
  describe('Input robustness (real PostgreSQL)', () => {
    test('is configured safely', () => {
      throw new Error(configError.message);
    });
  });
} else {
  beforeAll(async () => {
    await startRealBackend(target, ctx);
  }, SETUP_TIMEOUT_MS);

  afterAll(() => stopRealBackend(ctx), SETUP_TIMEOUT_MS);

  describe('Input robustness (real PostgreSQL)', () => {
    beforeEach(async () => {
      await reseed(ctx.db.pool, ctx.state.createdName, baseWorld());
    });

    // Rows are padded to four values: with fewer, test.each would pass a
    // `done` callback as `body`.
    test.each(CASES.map((c) => [c[0], c[1], c[2], c[3]]))('%s answers 4xx with an error envelope', async (_label, method, path, body) => {
      const res = await send(method, path, body);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error.code).toBe('string');
      expect(JSON.stringify(res.body)).not.toMatch(/invalid input syntax|violates|stack|at \w+ \(/i);
    });

    test('an out-of-range nearby radius is clamped, not an error', async () => {
      for (const radius of ['-5', '1e12']) {
        const res = await send('get', `/player/nearby?lat=52.5&lng=9.0&radius=${radius}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data.players)).toBe(true);
      }
    });

    test('a malformed id still answers 401 first when the token is missing', async () => {
      const res = await request(ctx.app).get(`/battle/${BAD_ID}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    test('malformed ids answer like unknown ids: the codes the client already handles', async () => {
      const codes = {};
      for (const [path, method] of [[`/battle/${BAD_ID}`, 'get'], [`/sos/${BAD_ID}`, 'get'], [`/quests/${BAD_ID}/claim`, 'post'], [`/rescue/${BAD_ID}/guard-battle/start`, 'post'], [`/friends/${BAD_ID}`, 'delete']]) {
        codes[path] = (await send(method, path, method === 'post' ? { request_id: 'r' } : undefined)).body.error.code;
      }
      expect(codes).toEqual({
        [`/battle/${BAD_ID}`]: 'BATTLE_NOT_FOUND',
        [`/sos/${BAD_ID}`]: 'SOS_NOT_FOUND',
        [`/quests/${BAD_ID}/claim`]: 'QUEST_NOT_FOUND',
        [`/rescue/${BAD_ID}/guard-battle/start`]: 'RESCUE_MISSION_NOT_FOUND',
        [`/friends/${BAD_ID}`]: 'PLAYER_NOT_FOUND',
      });
    });

    test('malformed JSON answers 400', async () => {
      const res = await request(ctx.app).post('/battle/challenge').set('Authorization', 'Bearer uid-a')
        .set('Content-Type', 'application/json').send('{"defender_id": ');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('a body over the 1 MB limit answers 413', async () => {
      const res = await request(ctx.app).post('/battle/challenge').set('Authorization', 'Bearer uid-a')
        .set('Content-Type', 'application/json').send(JSON.stringify({ defender_id: ids.B, pad: 'x'.repeat(1100 * 1024) }));
      expect(res.status).toBe(413);
      expect(res.body.success).toBe(false);
    });
  });
}
