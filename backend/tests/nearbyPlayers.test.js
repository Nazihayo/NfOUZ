'use strict';

process.env.NODE_ENV = 'test';

const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
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

const SELF = { player_id: 'self-id', username: 'nazih_k' };
const CENTER_LAT = 52.5978;
const CENTER_LNG = 9.0854;

function playerRow(id, latOffsetDeg, extra = {}) {
  return {
    player_id: id,
    username: id,
    class_type: 'Scout',
    last_lat: CENTER_LAT + latOffsetDeg,
    last_lng: CENTER_LNG,
    is_controlled: false,
    ...extra,
  };
}

describe('Sprint 4 — Nearby Players System', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
    verifyIdToken.mockResolvedValue({ uid: 'fb-self' });
  });

  it('security: rejects unauthenticated requests before touching the database', async () => {
    const response = await request(app).get('/player/nearby').query({ lat: CENTER_LAT, lng: CENTER_LNG });

    expect(response.status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('handles multiple nearby players, ordered nearest-first', async () => {
    const near = playerRow('near-player', 0.0005); // ~55m north
    const mid = playerRow('mid-player', 0.003); // ~333m north
    const far = playerRow('far-player', 0.008); // ~890m north

    db.query
      .mockResolvedValueOnce({ rows: [SELF] }) // getByFirebaseUid
      .mockResolvedValueOnce({ rows: [far, near, mid] }); // findWithinBoundingBox (unsorted on purpose)

    const response = await request(app)
      .get('/player/nearby')
      .query({ lat: CENTER_LAT, lng: CENTER_LNG, radius: 1000 })
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);
    const ids = response.body.data.players.map((p) => p.player_id);
    expect(ids).toEqual(['near-player', 'mid-player', 'far-player']);
  });

  it('excludes a player just outside the requested radius ("exit radius")', async () => {
    const inside = playerRow('inside-player', 0.003); // ~333m
    const outside = playerRow('outside-player', 0.02); // ~2.2km, outside a 1000m radius

    db.query
      .mockResolvedValueOnce({ rows: [SELF] })
      .mockResolvedValueOnce({ rows: [inside, outside] });

    const response = await request(app)
      .get('/player/nearby')
      .query({ lat: CENTER_LAT, lng: CENTER_LNG, radius: 1000 })
      .set('Authorization', 'Bearer valid-token');

    const ids = response.body.data.players.map((p) => p.player_id);
    expect(ids).toEqual(['inside-player']);
  });

  it('includes a player just inside the requested radius ("enter radius")', async () => {
    const justInside = playerRow('just-inside', 0.0089); // ~988m, inside a 1000m radius

    db.query
      .mockResolvedValueOnce({ rows: [SELF] })
      .mockResolvedValueOnce({ rows: [justInside] });

    const response = await request(app)
      .get('/player/nearby')
      .query({ lat: CENTER_LAT, lng: CENTER_LNG, radius: 1000 })
      .set('Authorization', 'Bearer valid-token');

    const ids = response.body.data.players.map((p) => p.player_id);
    expect(ids).toEqual(['just-inside']);
  });

  it('reports a plausible distance_meters value for each result', async () => {
    const near = playerRow('near-player', 0.0005);

    db.query
      .mockResolvedValueOnce({ rows: [SELF] })
      .mockResolvedValueOnce({ rows: [near] });

    const response = await request(app)
      .get('/player/nearby')
      .query({ lat: CENTER_LAT, lng: CENTER_LNG, radius: 1000 })
      .set('Authorization', 'Bearer valid-token');

    expect(response.body.data.players[0].distance_meters).toBeGreaterThan(40);
    expect(response.body.data.players[0].distance_meters).toBeLessThan(70);
  });

  it('marks every returned player as online and not blocked (server-guaranteed by SQL filter)', async () => {
    const player = playerRow('some-player', 0.0005);

    db.query
      .mockResolvedValueOnce({ rows: [SELF] })
      .mockResolvedValueOnce({ rows: [player] });

    const response = await request(app)
      .get('/player/nearby')
      .query({ lat: CENTER_LAT, lng: CENTER_LNG })
      .set('Authorization', 'Bearer valid-token');

    expect(response.body.data.players[0].is_online).toBe(true);
    expect(response.body.data.players[0].is_blocked).toBe(false);
  });

  it('Sprint 7 continuation: reports is_protected from the time-based isProtected check, not a stale stored column', async () => {
    const stillProtected = playerRow('protected-player', 0.0005, { protected_until: new Date(Date.now() + 60000) });
    const expiredProtection = playerRow('expired-protection-player', 0.0006, { protected_until: new Date(Date.now() - 60000) });

    db.query
      .mockResolvedValueOnce({ rows: [SELF] })
      .mockResolvedValueOnce({ rows: [stillProtected, expiredProtection] });

    const response = await request(app)
      .get('/player/nearby')
      .query({ lat: CENTER_LAT, lng: CENTER_LNG })
      .set('Authorization', 'Bearer valid-token');

    const byId = Object.fromEntries(response.body.data.players.map((p) => [p.player_id, p]));
    expect(byId['protected-player'].is_protected).toBe(true);
    expect(byId['expired-protection-player'].is_protected).toBe(false);
  });

  it('caps the requested radius at NEARBY_MAX_RADIUS_METERS without erroring', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [SELF] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .get('/player/nearby')
      .query({ lat: CENTER_LAT, lng: CENTER_LNG, radius: 999999 })
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);
    expect(response.body.data.players).toEqual([]);
  });

  it('propagates a database failure as a 500 INTERNAL_ERROR rather than crashing the process', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [SELF] })
      .mockRejectedValueOnce(new Error('connection terminated unexpectedly'));

    const response = await request(app)
      .get('/player/nearby')
      .query({ lat: CENTER_LAT, lng: CENTER_LNG })
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('rejects a request missing lat/lng before any repository call', async () => {
    db.query.mockResolvedValueOnce({ rows: [SELF] }); // getByFirebaseUid only

    const response = await request(app).get('/player/nearby').set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_LOCATION');
    expect(db.query).toHaveBeenCalledTimes(1); // only the identity lookup, never findWithinBoundingBox
  });
});
