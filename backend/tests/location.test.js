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

const SELF_PLAYER = {
  player_id: 'self-player-id',
  username: 'nazih_k',
  last_lat: 52.5978,
  last_lng: 9.0854,
  last_location_at: new Date(Date.now() - 10000).toISOString(),
};

describe('Player location & nearby routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe('PATCH /player/:id/location', () => {
    it('rejects requests with no Authorization header', async () => {
      const response = await request(app)
        .patch(`/player/${SELF_PLAYER.player_id}/location`)
        .send({ lat: 52.598, lng: 9.0855 });

      expect(response.status).toBe(401);
    });

    it('rejects updating a different player_id than the authenticated one (FORBIDDEN)', async () => {
      verifyIdToken.mockResolvedValue({ uid: 'fb-uid-1' });
      db.query.mockResolvedValueOnce({ rows: [SELF_PLAYER] }); // getByFirebaseUid

      const response = await request(app)
        .patch('/player/someone-else-id/location')
        .set('Authorization', 'Bearer valid-token')
        .send({ lat: 52.598, lng: 9.0855 });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects an out-of-range latitude with INVALID_LOCATION', async () => {
      verifyIdToken.mockResolvedValue({ uid: 'fb-uid-1' });
      db.query.mockResolvedValueOnce({ rows: [SELF_PLAYER] }); // getByFirebaseUid

      const response = await request(app)
        .patch(`/player/${SELF_PLAYER.player_id}/location`)
        .set('Authorization', 'Bearer valid-token')
        .send({ lat: 999, lng: 9.0855 });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_LOCATION');
    });

    it('rejects a teleport-like jump with INVALID_LOCATION', async () => {
      verifyIdToken.mockResolvedValue({ uid: 'fb-uid-1' });
      db.query
        .mockResolvedValueOnce({ rows: [SELF_PLAYER] }) // getByFirebaseUid (assertOwnPlayerId)
        .mockResolvedValueOnce({ rows: [SELF_PLAYER] }); // getById (locationService)

      const response = await request(app)
        .patch(`/player/${SELF_PLAYER.player_id}/location`)
        .set('Authorization', 'Bearer valid-token')
        .send({ lat: 53.5, lng: 10.0 }); // far away, "instantly"

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_LOCATION');
    });

    it('accepts a realistic movement and persists it', async () => {
      verifyIdToken.mockResolvedValue({ uid: 'fb-uid-1' });
      db.query
        .mockResolvedValueOnce({ rows: [SELF_PLAYER] }) // getByFirebaseUid
        .mockResolvedValueOnce({ rows: [SELF_PLAYER] }) // getById
        .mockResolvedValueOnce({
          rows: [{ player_id: SELF_PLAYER.player_id, last_lat: 52.598, last_lng: 9.0855 }],
        }); // updateLocation

      const response = await request(app)
        .patch(`/player/${SELF_PLAYER.player_id}/location`)
        .set('Authorization', 'Bearer valid-token')
        .send({ lat: 52.598, lng: 9.0855 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.updated).toBe(true);
    });
  });

  describe('GET /player/nearby', () => {
    it('rejects missing lat/lng with INVALID_LOCATION', async () => {
      verifyIdToken.mockResolvedValue({ uid: 'fb-uid-1' });
      db.query.mockResolvedValueOnce({ rows: [SELF_PLAYER] }); // getByFirebaseUid

      const response = await request(app).get('/player/nearby').set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_LOCATION');
    });

    it('returns nearby players sorted by distance, excluding self', async () => {
      verifyIdToken.mockResolvedValue({ uid: 'fb-uid-1' });

      const farther = {
        player_id: 'p-far',
        username: 'titan_lord',
        class_type: 'Titan',
        last_lat: 52.6005,
        last_lng: 9.0854,
        is_controlled: false,
      };
      const closer = {
        player_id: 'p-close',
        username: 'ranger_88',
        class_type: 'Ranger',
        last_lat: 52.598,
        last_lng: 9.0855,
        is_controlled: false,
      };

      db.query
        .mockResolvedValueOnce({ rows: [SELF_PLAYER] }) // getByFirebaseUid
        .mockResolvedValueOnce({ rows: [farther, closer] }); // findWithinBoundingBox

      const response = await request(app)
        .get('/player/nearby')
        .query({ lat: 52.5978, lng: 9.0854, radius: 1000 })
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.data.players.length).toBe(2);
      expect(response.body.data.players[0].player_id).toBe('p-close');
      expect(response.body.data.players.every((p) => p.player_id !== SELF_PLAYER.player_id)).toBe(true);
    });
  });
});
