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
    // clearAllMocks keeps queued mockResolvedValueOnce values; a test whose
    // request fails validation before querying would leak them into the next test.
    db.query.mockReset();
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

    it('rejects a username that differs from an existing one only by case (USERNAME_TAKEN)', async () => {
      verifyIdToken.mockResolvedValue({ uid: 'fb-uid-2' });
      db.query
        .mockResolvedValueOnce({ rows: [] }) // getByFirebaseUid -> none
        .mockResolvedValueOnce({ rows: [{ player_id: 'p-1', username: 'nazih_k' }] }); // getByUsername (case-insensitive)

      const response = await request(app)
        .post('/auth/register')
        .set('Authorization', 'Bearer valid-token')
        .send({ username: 'Nazih_K', class_type: 'Scout' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('USERNAME_TAKEN');
      const lookup = db.query.mock.calls.find(([sql]) => /FROM players WHERE .*username/.test(sql));
      expect(lookup[0]).toMatch(/lower\(username\) = lower\(\$1\)/);
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

    it.each([
      ['Scout', 80, 120],
      ['Ranger', 100, 100],
      ['Titan', 140, 80],
    ])('stores the %s base Health/Energy (GDD 3.3) at registration', async (classType, health, energy) => {
      verifyIdToken.mockResolvedValue({ uid: 'fb-uid-1' });
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ player_id: 'p', username: 'nazih_k', class_type: classType }] });

      const response = await request(app)
        .post('/auth/register')
        .set('Authorization', 'Bearer valid-token')
        .send({ username: 'nazih_k', class_type: classType });

      expect(response.status).toBe(201);
      const [sql, params] = db.query.mock.calls[2];
      expect(sql).toMatch(/INSERT INTO players/);
      expect(params).toEqual(['fb-uid-1', 'nazih_k', classType, health, energy]);
    });

    it.each([
      ['players_firebase_uid_key', 'PLAYER_ALREADY_REGISTERED'],
      ['players_username_key', 'USERNAME_TAKEN'],
    ])('answers 409, not 500, when a concurrent register hits %s', async (constraint, code) => {
      verifyIdToken.mockResolvedValue({ uid: 'fb-uid-1' });
      const unique = Object.assign(new Error('duplicate key'), { code: '23505', constraint });
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(unique);

      const response = await request(app)
        .post('/auth/register')
        .set('Authorization', 'Bearer valid-token')
        .send({ username: 'nazih_k', class_type: 'Scout' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe(code);
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
