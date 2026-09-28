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

describe('Auth routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe('POST /auth/register', () => {
    it('rejects requests with no Authorization header', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({ username: 'nazih_k', class_type: 'Scout' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });

    it('rejects an invalid Firebase token', async () => {
      verifyIdToken.mockRejectedValue(new Error('bad token'));

      const response = await request(app)
        .post('/auth/register')
        .set('Authorization', 'Bearer invalid-token')
        .send({ username: 'nazih_k', class_type: 'Scout' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });

    it('rejects an invalid class_type', async () => {
      verifyIdToken.mockResolvedValue({ uid: 'fb-uid-1' });
      db.query.mockResolvedValueOnce({ rows: [] }); // getByFirebaseUid -> none

      const response = await request(app)
        .post('/auth/register')
        .set('Authorization', 'Bearer valid-token')
        .send({ username: 'nazih_k', class_type: 'Wizard' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_CLASS_TYPE');
    });

    it('rejects a duplicate registration for the same firebase_uid', async () => {
      verifyIdToken.mockResolvedValue({ uid: 'fb-uid-1' });
      db.query.mockResolvedValueOnce({ rows: [{ player_id: 'existing-id' }] }); // getByFirebaseUid -> found

      const response = await request(app)
        .post('/auth/register')
        .set('Authorization', 'Bearer valid-token')
        .send({ username: 'nazih_k', class_type: 'Scout' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('PLAYER_ALREADY_REGISTERED');
    });

    it('creates a new player on valid input', async () => {
      verifyIdToken.mockResolvedValue({ uid: 'fb-uid-1' });
      db.query
        .mockResolvedValueOnce({ rows: [] }) // getByFirebaseUid -> none
        .mockResolvedValueOnce({ rows: [] }) // getByUsername -> none
        .mockResolvedValueOnce({
          rows: [
            {
              player_id: 'new-player-id',
              username: 'nazih_k',
              class_type: 'Scout',
              faction_id: null,
              health: 100,
              max_health: 100,
              energy: 100,
              max_energy: 100,
              influence: 100,
              level: 1,
              experience: 0,
              rank: 'Citizen',
              is_controlled: false,
              controlled_until: null,
            },
          ],
        }); // create -> new row

      const response = await request(app)
        .post('/auth/register')
        .set('Authorization', 'Bearer valid-token')
        .send({ username: 'nazih_k', class_type: 'Scout' });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.player_id).toBe('new-player-id');
      expect(response.body.data.influence).toBe(100);
    });
  });

  describe('GET /auth/me', () => {
    it('returns 404 PLAYER_NOT_FOUND when no player row exists yet', async () => {
      verifyIdToken.mockResolvedValue({ uid: 'fb-uid-2' });
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get('/auth/me').set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('PLAYER_NOT_FOUND');
    });

    it('returns the player row when it exists', async () => {
      verifyIdToken.mockResolvedValue({ uid: 'fb-uid-3' });
      db.query.mockResolvedValueOnce({
        rows: [
          {
            player_id: 'p-3',
            username: 'ranger_88',
            class_type: 'Ranger',
            faction_id: null,
            health: 90,
            max_health: 100,
            energy: 80,
            max_energy: 100,
            influence: 145,
            level: 3,
            experience: 420,
            rank: 'Citizen',
            is_controlled: false,
            controlled_until: null,
          },
        ],
      });

      const response = await request(app).get('/auth/me').set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.data.username).toBe('ranger_88');
      expect(response.body.data.influence).toBe(145);
    });
  });
});
