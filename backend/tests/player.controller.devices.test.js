'use strict';

process.env.NODE_ENV = 'test';

/**
 * Sprint 8 correction (final pass) — HTTP-level proof for the two
 * requirements that only make sense to check at the response-body level:
 * "Never return FCM tokens through an API response" and the
 * FCM_TOKEN_CONFLICT security response. Uses the real app + a mocked
 * database/firebase, same pattern as battle.resolve.test.js.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
  checkConnection: jest.fn().mockResolvedValue(true),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
}));

jest.mock('../src/config/firebase', () => ({
  initializeFirebase: jest.fn(),
  checkFirebaseReady: jest.fn().mockReturnValue(true),
  verifyIdToken: jest.fn(),
  admin: {},
}));

const db = require('../src/config/database');
const { verifyIdToken } = require('../src/config/firebase');
const createApp = require('../src/app');

const PLAYER = { player_id: 'p-1', firebase_uid: 'fb-1' };

describe('PATCH /player/:id/fcm-token and /player/:id/devices/* (Sprint 8 correction, final pass)', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
    verifyIdToken.mockResolvedValue({ uid: PLAYER.firebase_uid });
  });

  it('never returns fcm_token in the response body on registration', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [PLAYER] }) // getByFirebaseUid
      .mockResolvedValueOnce({ rows: [] }) // registerDevice: token-owner lookup -> free
      .mockResolvedValueOnce({
        rows: [{ device_id: 'd-1', player_id: 'p-1', fcm_token: 'tok-should-never-appear', platform: 'android', is_active: true, updated_at: new Date() }],
      }); // upsert

    const response = await request(app)
      .patch('/player/p-1/fcm-token')
      .set('Authorization', 'Bearer valid-token')
      .send({ device_key: 'device-1', fcm_token: 'tok-should-never-appear', platform: 'android' });

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain('tok-should-never-appear');
    expect(response.body.data).not.toHaveProperty('fcm_token');
  });

  it('returns 409 FCM_TOKEN_CONFLICT when the token already belongs to a different player, without leaking either player\'s token', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [PLAYER] }) // getByFirebaseUid
      .mockResolvedValueOnce({ rows: [{ player_id: 'someone-else' }] }); // token-owner lookup -> conflict

    const response = await request(app)
      .patch('/player/p-1/fcm-token')
      .set('Authorization', 'Bearer valid-token')
      .send({ device_key: 'device-1', fcm_token: 'tok-claimed', platform: 'android' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('FCM_TOKEN_CONFLICT');
    expect(JSON.stringify(response.body)).not.toContain('tok-claimed');
  });

  it('rejects an invalid platform with 400 before ever touching the database', async () => {
    db.query.mockResolvedValueOnce({ rows: [PLAYER] }); // getByFirebaseUid only

    const response = await request(app)
      .patch('/player/p-1/fcm-token')
      .set('Authorization', 'Bearer valid-token')
      .send({ device_key: 'device-1', fcm_token: 'tok-1', platform: 'windows' });

    expect(response.status).toBe(400);
    expect(db.query).toHaveBeenCalledTimes(1); // only the identity lookup — never reached registerDevice
  });

  it('devices/deactivate deactivates only the current device', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [PLAYER] }) // getByFirebaseUid
      .mockResolvedValueOnce({ rows: [{ device_id: 'd-1', player_id: 'p-1', device_key: 'device-1', is_active: false, updated_at: new Date() }] });

    const response = await request(app)
      .post('/player/p-1/devices/deactivate')
      .set('Authorization', 'Bearer valid-token')
      .send({ device_key: 'device-1' });

    expect(response.status).toBe(200);
    const [sql, params] = db.query.mock.calls[1];
    expect(sql).toMatch(/WHERE player_id = \$1 AND device_key = \$2/);
    expect(params).toEqual(['p-1', 'device-1']);
  });

  it('devices/deactivate-all is a distinct endpoint that deactivates every device', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [PLAYER] }) // getByFirebaseUid
      .mockResolvedValueOnce({ rows: [{ device_id: 'd-1' }, { device_id: 'd-2' }] });

    const response = await request(app).post('/player/p-1/devices/deactivate-all').set('Authorization', 'Bearer valid-token').send({});

    expect(response.status).toBe(200);
    expect(response.body.data.deactivated_count).toBe(2);
    const [sql] = db.query.mock.calls[1];
    expect(sql).toMatch(/WHERE player_id = \$1 AND is_active = TRUE/);
  });
});
