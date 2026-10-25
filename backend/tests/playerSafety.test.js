'use strict';

process.env.NODE_ENV = 'test';

/**
 * Safety rules: "don't show me" (players.is_visible) and the driving stop
 * (players.fast_movement_at, migration 022), plus blocked players being
 * unable to challenge each other. Both settings and the block are checked
 * by the server; the client only shows the result.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
  checkConnection: jest.fn().mockResolvedValue(true),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
}));

jest.mock('../src/middleware/rateLimit.middleware', () => {
  const passThrough = (req, res, next) => next();
  return {
    locationUpdateLimiter: passThrough,
    nearbyQueryLimiter: passThrough,
    battleChallengeLimiter: passThrough,
    friendRequestLimiter: passThrough,
    sosCreateLimiter: passThrough,
    incomingChallengeLimiter: passThrough,
    challengeResponseLimiter: passThrough,
  };
});

jest.mock('../src/config/firebase', () => ({
  initializeFirebase: jest.fn(),
  checkFirebaseReady: jest.fn().mockReturnValue(true),
  verifyIdToken: jest.fn(),
  admin: {},
}));

const db = require('../src/config/database');
const { verifyIdToken } = require('../src/config/firebase');
const createApp = require('../src/app');
const env = require('../src/config/env');
const playerRepo = require('../src/repositories/player.repository');
const battleRepo = require('../src/repositories/battle.repository');
const friendRepo = require('../src/repositories/friend.repository');
const battleService = require('../src/services/battle.service');
const { isHidden, isMovingFast, looksLikeDriving } = require('../src/utils/playerSafety');

const LAT = 52.5978;
const LNG = 9.0854;
const METERS_PER_DEGREE_LAT = 111195; // haversine with the 6371 km earth radius

const secondsAgo = (s) => new Date(Date.now() - s * 1000).toISOString();

const SELF = {
  player_id: 'self-id',
  username: 'nazih_k',
  last_lat: LAT,
  last_lng: LNG,
  last_location_at: secondsAgo(10),
  is_visible: true,
  fast_movement_at: null,
};

describe('playerSafety helpers', () => {
  const previous = { last_lat: LAT, last_lng: LNG, last_location_at: secondsAgo(10) };
  const northBy = (meters) => LAT + meters / METERS_PER_DEGREE_LAT;

  it('treats a move faster than SAFETY_MAX_PLAY_SPEED_KMH as driving', () => {
    expect(env.SAFETY_MAX_PLAY_SPEED_KMH).toBe(25);
    expect(looksLikeDriving(previous, northBy(100), LNG)).toBe(true); // 100 m in 10 s = 36 km/h
    expect(looksLikeDriving(previous, northBy(55), LNG)).toBe(false); // 55 m in 10 s = 19.8 km/h, a run
  });

  it('ignores GPS jitter shorter than SAFETY_FAST_MOVEMENT_MIN_DISTANCE_METERS', () => {
    const justNow = { ...previous, last_location_at: secondsAgo(1) };
    expect(looksLikeDriving(justNow, northBy(25), LNG)).toBe(false); // 90 km/h, but only 25 m
  });

  it('ignores a gap longer than SAFETY_FAST_MOVEMENT_MAX_GAP_SECONDS (drove with the app closed)', () => {
    const longAgo = { ...previous, last_location_at: secondsAgo(10 * 60) };
    expect(looksLikeDriving(longAgo, northBy(5000), LNG)).toBe(false); // 30 km/h over 10 minutes
  });

  it('has no opinion without a previous location', () => {
    expect(looksLikeDriving({ last_lat: null, last_lng: null, last_location_at: null }, LAT, LNG)).toBe(false);
  });

  it('keeps a player "moving fast" for SAFETY_FAST_MOVEMENT_COOLDOWN_SECONDS', () => {
    const cooldown = env.SAFETY_FAST_MOVEMENT_COOLDOWN_SECONDS;
    expect(isMovingFast({ fast_movement_at: null })).toBe(false);
    expect(isMovingFast({ fast_movement_at: secondsAgo(cooldown - 5) })).toBe(true);
    expect(isMovingFast({ fast_movement_at: secondsAgo(cooldown + 5) })).toBe(false);
  });

  it('only an explicit is_visible = false hides a player', () => {
    expect(isHidden({ is_visible: false })).toBe(true);
    expect(isHidden({ is_visible: true })).toBe(false);
  });
});

describe('safety rules over HTTP', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockReset();
    app = createApp();
    verifyIdToken.mockResolvedValue({ uid: 'fb-self' });
  });

  describe('PATCH /player/:id/location — driving stop', () => {
    it('records fast_movement_at and reports moving_too_fast for a driving-speed move', async () => {
      const now = new Date().toISOString();
      db.query
        .mockResolvedValueOnce({ rows: [SELF] }) // getByFirebaseUid
        .mockResolvedValueOnce({ rows: [SELF] }) // getById
        .mockResolvedValueOnce({ rows: [{ player_id: SELF.player_id, last_lat: LAT + 0.0009, last_lng: LNG, fast_movement_at: now }] })
        .mockResolvedValue({ rows: [] }); // quest progress (best-effort)

      const response = await request(app)
        .patch(`/player/${SELF.player_id}/location`)
        .set('Authorization', 'Bearer valid-token')
        .send({ lat: LAT + 0.0009, lng: LNG }); // ~100 m in ~10 s

      expect(response.status).toBe(200);
      expect(response.body.data.moving_too_fast).toBe(true);
      const [sql, params] = db.query.mock.calls[2];
      expect(sql).toMatch(/fast_movement_at = COALESCE\(\$5, fast_movement_at\)/);
      expect(params[4]).toBeInstanceOf(Date);
    });

    it('leaves fast_movement_at alone and reports false for a walking-speed move', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [SELF] })
        .mockResolvedValueOnce({ rows: [SELF] })
        .mockResolvedValueOnce({ rows: [{ player_id: SELF.player_id, last_lat: LAT + 0.0001, last_lng: LNG, fast_movement_at: null }] })
        .mockResolvedValue({ rows: [] });

      const response = await request(app)
        .patch(`/player/${SELF.player_id}/location`)
        .set('Authorization', 'Bearer valid-token')
        .send({ lat: LAT + 0.0001, lng: LNG }); // ~11 m

      expect(response.status).toBe(200);
      expect(response.body.data.moving_too_fast).toBe(false);
      expect(db.query.mock.calls[2][1][4]).toBeNull();
    });
  });

  describe('GET /player/nearby', () => {
    it.each([
      ['hidden', { is_visible: false }],
      ['moving fast', { fast_movement_at: secondsAgo(10) }],
    ])('returns no one while the requester is %s', async (_label, override) => {
      db.query.mockResolvedValueOnce({ rows: [{ ...SELF, ...override }] });

      const response = await request(app)
        .get('/player/nearby')
        .query({ lat: LAT, lng: LNG })
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.data.players).toEqual([]);
      expect(db.query).toHaveBeenCalledTimes(1); // never findWithinBoundingBox
    });

    it('leaves out hidden players and players seen moving fast within the cooldown (in SQL)', async () => {
      db.query.mockResolvedValueOnce({ rows: [SELF] }).mockResolvedValueOnce({ rows: [] });

      await request(app).get('/player/nearby').query({ lat: LAT, lng: LNG }).set('Authorization', 'Bearer valid-token');

      const [sql, params] = db.query.mock.calls[1];
      expect(sql).toMatch(/p\.is_visible = TRUE/);
      expect(sql).toMatch(/p\.fast_movement_at IS NULL OR p\.fast_movement_at < \$7/);
      const cooldownMs = env.SAFETY_FAST_MOVEMENT_COOLDOWN_SECONDS * 1000;
      expect(Math.abs(Date.now() - cooldownMs - params[6].getTime())).toBeLessThan(5000);
    });
  });

  describe('PATCH /player/:id/visibility', () => {
    it('stores the player\'s choice and returns it', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [SELF] })
        .mockResolvedValueOnce({ rows: [{ player_id: SELF.player_id, is_visible: false }] });

      const response = await request(app)
        .patch(`/player/${SELF.player_id}/visibility`)
        .set('Authorization', 'Bearer valid-token')
        .send({ is_visible: false });

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ is_visible: false });
      const [sql, params] = db.query.mock.calls[1];
      expect(sql).toMatch(/UPDATE players SET is_visible = \$1/);
      expect(params).toEqual([false, SELF.player_id]);
    });

    it.each([['the string "false"', 'false'], ['a number', 0], ['nothing', undefined]])(
      'rejects %s with INVALID_VISIBILITY',
      async (_label, value) => {
        db.query.mockResolvedValueOnce({ rows: [SELF] });

        const response = await request(app)
          .patch(`/player/${SELF.player_id}/visibility`)
          .set('Authorization', 'Bearer valid-token')
          .send({ is_visible: value });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('INVALID_VISIBILITY');
        expect(db.query).toHaveBeenCalledTimes(1);
      }
    );

    it('security: rejects changing another player (FORBIDDEN) and unauthenticated calls', async () => {
      db.query.mockResolvedValueOnce({ rows: [SELF] });
      const other = await request(app)
        .patch('/player/someone-else/visibility')
        .set('Authorization', 'Bearer valid-token')
        .send({ is_visible: false });
      expect(other.status).toBe(403);
      expect(other.body.error.code).toBe('FORBIDDEN');

      const anonymous = await request(app).patch(`/player/${SELF.player_id}/visibility`).send({ is_visible: false });
      expect(anonymous.status).toBe(401);
      expect(db.query).toHaveBeenCalledTimes(1);
    });
  });
});

describe('challenges and safety (battle.service)', () => {
  const ATTACKER = { ...SELF, player_id: 'attacker-id' };
  const DEFENDER = { ...SELF, player_id: 'defender-id', last_lat: LAT + 0.0001 }; // ~11 m away
  let players;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    players = { [ATTACKER.player_id]: ATTACKER, [DEFENDER.player_id]: DEFENDER };
    jest.spyOn(playerRepo, 'getById').mockImplementation(async (id) => players[id] || null);
    jest.spyOn(playerRepo, 'clearExpiredControl').mockResolvedValue(null);
    jest.spyOn(friendRepo, 'isBlockedEitherDirection').mockResolvedValue(false);
    db.withTransaction.mockImplementation(async () => ({ battle_id: 'new-battle' }));
  });

  afterEach(() => {
    jest.restoreAllMocks(); // the repository spies must not reach the HTTP tests above
  });

  it('allows a challenge between two visible, slow, unblocked players', async () => {
    await expect(battleService.createChallenge(ATTACKER.player_id, DEFENDER.player_id)).resolves.toEqual({ battle_id: 'new-battle' });
  });

  it.each([
    ['hidden', { is_visible: false }, 'PLAYER_HIDDEN'],
    ['moving fast', { fast_movement_at: secondsAgo(10) }, 'PLAYER_MOVING_TOO_FAST'],
  ])('an attacker who is %s cannot challenge', async (_label, override, code) => {
    players[ATTACKER.player_id] = { ...ATTACKER, ...override };
    await expect(battleService.createChallenge(ATTACKER.player_id, DEFENDER.player_id)).rejects.toMatchObject({ code, statusCode: 403 });
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['hidden', { is_visible: false }],
    ['moving fast', { fast_movement_at: secondsAgo(10) }],
  ])('a defender who is %s answers TARGET_UNAVAILABLE', async (_label, override) => {
    players[DEFENDER.player_id] = { ...DEFENDER, ...override };
    await expect(battleService.createChallenge(ATTACKER.player_id, DEFENDER.player_id)).rejects.toMatchObject({ code: 'TARGET_UNAVAILABLE' });
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('security: blocked players cannot challenge each other, and the answer does not say why', async () => {
    friendRepo.isBlockedEitherDirection.mockResolvedValue(true);
    await expect(battleService.createChallenge(ATTACKER.player_id, DEFENDER.player_id)).rejects.toMatchObject({ code: 'TARGET_UNAVAILABLE' });
    expect(friendRepo.isBlockedEitherDirection).toHaveBeenCalledWith(ATTACKER.player_id, DEFENDER.player_id);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  describe('answering while driving', () => {
    const pending = {
      battle_id: 'b-1', attacker_id: ATTACKER.player_id, defender_id: DEFENDER.player_id,
      status: 'in_progress', accepted_at: null, declined_at: null,
    };

    beforeEach(() => {
      players[DEFENDER.player_id] = { ...DEFENDER, fast_movement_at: secondsAgo(10) };
      jest.spyOn(battleRepo, 'expireStaleBattles').mockResolvedValue([]);
      jest.spyOn(battleRepo, 'getById').mockResolvedValue(pending);
      jest.spyOn(battleRepo, 'acceptChallenge').mockResolvedValue({ ...pending, accepted_at: 'now' });
      jest.spyOn(battleRepo, 'declineChallenge').mockResolvedValue({ ...pending, status: 'cancelled', declined_at: 'now' });
    });

    it('cannot accept (PLAYER_MOVING_TOO_FAST)', async () => {
      await expect(battleService.acceptChallenge('b-1', DEFENDER.player_id)).rejects.toMatchObject({ code: 'PLAYER_MOVING_TOO_FAST' });
      expect(battleRepo.acceptChallenge).not.toHaveBeenCalled();
    });

    it('can still decline', async () => {
      await expect(battleService.declineChallenge('b-1', DEFENDER.player_id)).resolves.toMatchObject({ declined_at: 'now' });
    });
  });
});
