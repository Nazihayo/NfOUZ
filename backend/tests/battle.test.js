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

const ATTACKER = {
  player_id: 'attacker-id',
  username: 'attacker_1',
  firebase_uid: 'fb-attacker',
  last_lat: 52.5978,
  last_lng: 9.0854,
};

const DEFENDER = {
  player_id: 'defender-id',
  username: 'defender_1',
  firebase_uid: 'fb-defender',
  last_lat: 52.5979,
  last_lng: 9.0855, // ~13m from ATTACKER — within the 20m challenge range
};

const FAR_DEFENDER = {
  ...DEFENDER,
  player_id: 'far-defender-id',
  last_lat: 52.62, // far outside the 20m challenge range
  last_lng: 9.12,
};

function baseBattleRow(overrides = {}) {
  return {
    battle_id: 'battle-1',
    attacker_id: ATTACKER.player_id,
    defender_id: DEFENDER.player_id,
    status: 'in_progress',
    photon_room_name: 'battle_abc123',
    attacker_ready: false,
    defender_ready: false,
    attacker_disconnected_at: null,
    defender_disconnected_at: null,
    attacker_reconnect_deadline: null,
    defender_reconnect_deadline: null,
    forfeited_by: null,
    session_started_at: new Date().toISOString(),
    session_expires_at: new Date(Date.now() + 90000).toISOString(),
    ...overrides,
  };
}

describe('Battle routes (Sprint 5 — Photon Multiplayer Foundation)', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe('POST /battle/challenge — room creation', () => {
    it('rejects requests with no Authorization header', async () => {
      const response = await request(app)
        .post('/battle/challenge')
        .send({ defender_id: DEFENDER.player_id, location: { lat: 52.5978, lng: 9.0854 } });

      expect(response.status).toBe(401);
    });

    it('creates a battle and generates a photon room name on success', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf -> getByFirebaseUid
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // getById(attackerId)
        .mockResolvedValueOnce({ rows: [DEFENDER] }) // getById(defenderId)
        .mockResolvedValueOnce({ rows: [] }) // Sprint 7: clearExpiredControl(attacker) -> not expired/not controlled
        .mockResolvedValueOnce({ rows: [] }) // Sprint 7: clearExpiredControl(defender) -> not expired/not controlled
        .mockResolvedValueOnce({ rows: [] }) // findActiveBattleForPlayer(attacker) -> none
        .mockResolvedValueOnce({ rows: [] }) // findActiveBattleForPlayer(defender) -> none
        .mockResolvedValueOnce({ rows: [baseBattleRow()] }); // createBattle

      const response = await request(app)
        .post('/battle/challenge')
        .set('Authorization', 'Bearer valid-token')
        .send({ defender_id: DEFENDER.player_id, location: { lat: 52.5978, lng: 9.0854 } });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.battle_id).toBe('battle-1');
      expect(response.body.data.photon_room_name).toBe('battle_abc123');
      expect(response.body.data.status).toBe('in_progress');

      // The mocked DB return value above is fixed, so it can't prove the
      // real id->room-name relationship on its own — inspect the actual
      // INSERT params the service built from a REAL crypto.randomUUID()
      // battle_id to confirm generatePhotonRoomName(battleId) was used
      // correctly: battle_{battle_id}, not an unrelated random token.
      // See battle.repository.js createBattle's param order.
      const insertCall = db.query.mock.calls[7];
      const [insertSql, insertParams] = insertCall;
      expect(insertSql).toMatch(/INSERT INTO battles/);
      const [realBattleId, , , realRoomName] = insertParams;
      expect(realRoomName).toBe(`battle_${realBattleId}`);
      // A v4 UUID, confirming battle_id is generated up front (not left
      // to the column default) so the room name can be derived from it.
      expect(realBattleId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('rejects a self-challenge with INVALID_CHALLENGE before touching the database for battle checks', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });
      db.query.mockResolvedValueOnce({ rows: [ATTACKER] }); // resolveSelf

      const response = await request(app)
        .post('/battle/challenge')
        .set('Authorization', 'Bearer valid-token')
        .send({ defender_id: ATTACKER.player_id, location: { lat: 52.5978, lng: 9.0854 } });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_CHALLENGE');
    });

    it('rejects a challenge when the defender is outside the max challenge distance (TARGET_OUT_OF_RANGE)', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // getById(attacker)
        .mockResolvedValueOnce({ rows: [FAR_DEFENDER] }) // getById(defender)
        .mockResolvedValueOnce({ rows: [] }) // Sprint 7: clearExpiredControl(attacker)
        .mockResolvedValueOnce({ rows: [] }) // Sprint 7: clearExpiredControl(defender)
        .mockResolvedValueOnce({ rows: [] }) // findActiveBattleForPlayer(attacker)
        .mockResolvedValueOnce({ rows: [] }); // findActiveBattleForPlayer(defender)

      const response = await request(app)
        .post('/battle/challenge')
        .set('Authorization', 'Bearer valid-token')
        .send({ defender_id: FAR_DEFENDER.player_id, location: { lat: 52.5978, lng: 9.0854 } });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('TARGET_OUT_OF_RANGE');
    });

    it('rejects a duplicate challenge when the attacker already has an active battle (DUPLICATE_CHALLENGE)', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // getById(attacker)
        .mockResolvedValueOnce({ rows: [DEFENDER] }) // getById(defender)
        .mockResolvedValueOnce({ rows: [] }) // Sprint 7: clearExpiredControl(attacker)
        .mockResolvedValueOnce({ rows: [] }) // Sprint 7: clearExpiredControl(defender)
        .mockResolvedValueOnce({ rows: [baseBattleRow()] }); // findActiveBattleForPlayer(attacker) -> already active

      const response = await request(app)
        .post('/battle/challenge')
        .set('Authorization', 'Bearer valid-token')
        .send({ defender_id: DEFENDER.player_id, location: { lat: 52.5978, lng: 9.0854 } });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('DUPLICATE_CHALLENGE');
    });

    it('rejects a duplicate challenge when the defender already has an active battle (DUPLICATE_CHALLENGE)', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // getById(attacker)
        .mockResolvedValueOnce({ rows: [DEFENDER] }) // getById(defender)
        .mockResolvedValueOnce({ rows: [] }) // Sprint 7: clearExpiredControl(attacker)
        .mockResolvedValueOnce({ rows: [] }) // Sprint 7: clearExpiredControl(defender)
        .mockResolvedValueOnce({ rows: [] }) // findActiveBattleForPlayer(attacker) -> none
        .mockResolvedValueOnce({ rows: [baseBattleRow()] }); // findActiveBattleForPlayer(defender) -> already active

      const response = await request(app)
        .post('/battle/challenge')
        .set('Authorization', 'Bearer valid-token')
        .send({ defender_id: DEFENDER.player_id, location: { lat: 52.5978, lng: 9.0854 } });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('DUPLICATE_CHALLENGE');
    });

    it('returns PLAYER_NOT_FOUND when the defender_id does not exist', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // getById(attacker)
        .mockResolvedValueOnce({ rows: [] }); // getById(defender) -> not found

      const response = await request(app)
        .post('/battle/challenge')
        .set('Authorization', 'Bearer valid-token')
        .send({ defender_id: 'ghost-id', location: { lat: 52.5978, lng: 9.0854 } });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('PLAYER_NOT_FOUND');
    });

    // ---- Sprint 7 — Influence + Control: createChallenge now enforces
    // the Control state Sprint 6 already granted but nothing checked. ----

    it('rejects with PLAYER_IS_CONTROLLED when the ATTACKER is currently Controlled', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });
      const controlledAttacker = {
        ...ATTACKER,
        is_controlled: true,
        controlled_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // still active
      };

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [controlledAttacker] }) // getById(attacker)
        .mockResolvedValueOnce({ rows: [DEFENDER] }) // getById(defender)
        .mockResolvedValueOnce({ rows: [] }) // clearExpiredControl(attacker) -> not expired, no-op
        .mockResolvedValueOnce({ rows: [] }); // clearExpiredControl(defender)

      const response = await request(app)
        .post('/battle/challenge')
        .set('Authorization', 'Bearer valid-token')
        .send({ defender_id: DEFENDER.player_id, location: { lat: 52.5978, lng: 9.0854 } });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('PLAYER_IS_CONTROLLED');
    });

    it('rejects with PLAYER_IS_CONTROLLED when the DEFENDER is currently Controlled', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });
      const controlledDefender = {
        ...DEFENDER,
        is_controlled: true,
        controlled_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // getById(attacker)
        .mockResolvedValueOnce({ rows: [controlledDefender] }) // getById(defender)
        .mockResolvedValueOnce({ rows: [] }) // clearExpiredControl(attacker)
        .mockResolvedValueOnce({ rows: [] }); // clearExpiredControl(defender) -> not expired, no-op

      const response = await request(app)
        .post('/battle/challenge')
        .set('Authorization', 'Bearer valid-token')
        .send({ defender_id: DEFENDER.player_id, location: { lat: 52.5978, lng: 9.0854 } });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('PLAYER_IS_CONTROLLED');
    });

    // ---- Sprint 7 continuation — GDD section 4: challenge eligibility
    // must also check Protection, independent of Control. ----

    it('rejects with PLAYER_IS_PROTECTED when the ATTACKER is currently Protected', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });
      const protectedAttacker = {
        ...ATTACKER,
        protected_until: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // still active
      };

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [protectedAttacker] }) // getById(attacker)
        .mockResolvedValueOnce({ rows: [DEFENDER] }) // getById(defender)
        .mockResolvedValueOnce({ rows: [] }) // clearExpiredControl(attacker)
        .mockResolvedValueOnce({ rows: [] }); // clearExpiredControl(defender)

      const response = await request(app)
        .post('/battle/challenge')
        .set('Authorization', 'Bearer valid-token')
        .send({ defender_id: DEFENDER.player_id, location: { lat: 52.5978, lng: 9.0854 } });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('PLAYER_IS_PROTECTED');
    });

    it('rejects with PLAYER_IS_PROTECTED when the DEFENDER is currently Protected', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });
      const protectedDefender = {
        ...DEFENDER,
        protected_until: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      };

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // getById(attacker)
        .mockResolvedValueOnce({ rows: [protectedDefender] }) // getById(defender)
        .mockResolvedValueOnce({ rows: [] }) // clearExpiredControl(attacker)
        .mockResolvedValueOnce({ rows: [] }); // clearExpiredControl(defender)

      const response = await request(app)
        .post('/battle/challenge')
        .set('Authorization', 'Bearer valid-token')
        .send({ defender_id: DEFENDER.player_id, location: { lat: 52.5978, lng: 9.0854 } });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('PLAYER_IS_PROTECTED');
    });

    it('allows the challenge once protected_until has already passed', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });
      const formerlyProtectedDefender = {
        ...DEFENDER,
        protected_until: new Date(Date.now() - 1000).toISOString(), // already expired
      };

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // getById(attacker)
        .mockResolvedValueOnce({ rows: [formerlyProtectedDefender] }) // getById(defender)
        .mockResolvedValueOnce({ rows: [] }) // clearExpiredControl(attacker)
        .mockResolvedValueOnce({ rows: [] }) // clearExpiredControl(defender)
        .mockResolvedValueOnce({ rows: [] }) // findActiveBattleForPlayer(attacker)
        .mockResolvedValueOnce({ rows: [] }) // findActiveBattleForPlayer(defender)
        .mockResolvedValueOnce({ rows: [baseBattleRow()] }); // createBattle

      const response = await request(app)
        .post('/battle/challenge')
        .set('Authorization', 'Bearer valid-token')
        .send({ defender_id: DEFENDER.player_id, location: { lat: 52.5978, lng: 9.0854 } });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('allows the challenge when a player\'s stored is_controlled=true has already EXPIRED (stale flag is not trusted)', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });
      const staleControlledDefender = {
        ...DEFENDER,
        is_controlled: true,
        controlled_until: new Date(Date.now() - 1000).toISOString(), // already expired
      };

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // getById(attacker)
        .mockResolvedValueOnce({ rows: [staleControlledDefender] }) // getById(defender)
        .mockResolvedValueOnce({ rows: [] }) // clearExpiredControl(attacker)
        .mockResolvedValueOnce({ rows: [{ player_id: DEFENDER.player_id, is_controlled: false, controlled_until: null }] }) // clearExpiredControl(defender) -> persists the expiry
        .mockResolvedValueOnce({ rows: [] }) // findActiveBattleForPlayer(attacker)
        .mockResolvedValueOnce({ rows: [] }) // findActiveBattleForPlayer(defender)
        .mockResolvedValueOnce({ rows: [baseBattleRow()] }); // createBattle

      const response = await request(app)
        .post('/battle/challenge')
        .set('Authorization', 'Bearer valid-token')
        .send({ defender_id: DEFENDER.player_id, location: { lat: 52.5978, lng: 9.0854 } });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /battle/{battleId} — session validation / room join lookup', () => {
    it('returns the battle session for a participant', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [baseBattleRow()] }); // getById (inside checkForfeit)

      const response = await request(app)
        .get('/battle/battle-1')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.data.battle_id).toBe('battle-1');
      expect(response.body.data.photon_room_name).toBe('battle_abc123');
    });

    it('rejects a non-participant with FORBIDDEN', async () => {
      const stranger = { player_id: 'stranger-id', firebase_uid: 'fb-stranger' };
      verifyIdToken.mockResolvedValue({ uid: stranger.firebase_uid });

      db.query
        .mockResolvedValueOnce({ rows: [stranger] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [baseBattleRow()] }); // getById

      const response = await request(app)
        .get('/battle/battle-1')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('returns BATTLE_NOT_FOUND for an unknown battleId', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [] }); // getById -> not found

      const response = await request(app)
        .get('/battle/does-not-exist')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('BATTLE_NOT_FOUND');
    });
  });

  describe('Timeout handling — checkForfeit via GET /battle/{battleId}', () => {
    it('marks the battle forfeited when the attacker’s reconnect deadline has passed', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      const expiredBattle = baseBattleRow({
        attacker_disconnected_at: new Date(Date.now() - 20000).toISOString(),
        attacker_reconnect_deadline: new Date(Date.now() - 5000).toISOString(), // already passed
      });
      const forfeitedBattle = { ...expiredBattle, status: 'forfeited', forfeited_by: ATTACKER.player_id };

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [expiredBattle] }) // getById (inside checkForfeit)
        .mockResolvedValueOnce({ rows: [forfeitedBattle] }); // markForfeited

      const response = await request(app)
        .get('/battle/battle-1')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('forfeited');
      expect(response.body.data.forfeited_by).toBe(ATTACKER.player_id);
    });

    it('leaves the battle in_progress when the grace period has not yet elapsed', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      const stillGraced = baseBattleRow({
        attacker_disconnected_at: new Date().toISOString(),
        attacker_reconnect_deadline: new Date(Date.now() + 10000).toISOString(), // still 10s left
      });

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [stillGraced] }); // getById

      const response = await request(app)
        .get('/battle/battle-1')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('in_progress');
    });
  });

  describe('POST /battle/{battleId}/disconnect — disconnect handling', () => {
    it('records a disconnect and returns a reconnect deadline', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      const disconnected = baseBattleRow({
        attacker_disconnected_at: new Date().toISOString(),
        attacker_reconnect_deadline: new Date(Date.now() + 15000).toISOString(),
      });

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [baseBattleRow()] }) // getById
        .mockResolvedValueOnce({ rows: [disconnected] }); // recordDisconnect

      const response = await request(app)
        .post('/battle/battle-1/disconnect')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.data.attacker_reconnect_deadline).toBeTruthy();
    });

    it('rejects a disconnect report for a battle that is no longer in_progress (SESSION_EXPIRED)', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [baseBattleRow({ status: 'forfeited' })] }); // getById

      const response = await request(app)
        .post('/battle/battle-1/disconnect')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('SESSION_EXPIRED');
    });
  });

  describe('POST /battle/{battleId}/reconnect — reconnect handling', () => {
    it('clears disconnect state when the reconnect happens within the grace period', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      const graced = baseBattleRow({
        attacker_disconnected_at: new Date().toISOString(),
        attacker_reconnect_deadline: new Date(Date.now() + 10000).toISOString(),
      });
      const cleared = baseBattleRow();

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [graced] }) // getById
        .mockResolvedValueOnce({ rows: [cleared] }); // clearDisconnect

      const response = await request(app)
        .post('/battle/battle-1/reconnect')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('in_progress');
    });

    it('rejects a reconnect after the grace period has expired (RECONNECT_WINDOW_EXPIRED)', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      const expired = baseBattleRow({
        attacker_disconnected_at: new Date(Date.now() - 30000).toISOString(),
        attacker_reconnect_deadline: new Date(Date.now() - 15000).toISOString(),
      });

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [expired] }); // getById

      const response = await request(app)
        .post('/battle/battle-1/reconnect')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('RECONNECT_WINDOW_EXPIRED');
    });
  });

  describe('POST /battle/{battleId}/ready — room join / ready confirmation', () => {
    it('marks the caller ready', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      const readyBattle = baseBattleRow({ attacker_ready: true });

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [baseBattleRow()] }) // getById
        .mockResolvedValueOnce({ rows: [readyBattle] }); // setPlayerReady

      const response = await request(app)
        .post('/battle/battle-1/ready')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.data.attacker_ready).toBe(true);
    });
  });

  describe('Idempotency and authorization (Sprint 5 correction pass)', () => {
    it('rejects GET /battle/{battleId} with no Authorization header (unauthorized battle lookup)', async () => {
      const response = await request(app).get('/battle/battle-1');
      expect(response.status).toBe(401);
    });

    it('rejects POST /battle/{battleId}/ready with no Authorization header', async () => {
      const response = await request(app).post('/battle/battle-1/ready').send({});
      expect(response.status).toBe(401);
    });

    it('rejects POST /battle/{battleId}/disconnect with no Authorization header', async () => {
      const response = await request(app).post('/battle/battle-1/disconnect').send({});
      expect(response.status).toBe(401);
    });

    it('rejects POST /battle/{battleId}/reconnect with no Authorization header', async () => {
      const response = await request(app).post('/battle/battle-1/reconnect').send({});
      expect(response.status).toBe(401);
    });

    it('rejects a non-participant calling POST /ready (participant-only room access)', async () => {
      const stranger = { player_id: 'stranger-id', firebase_uid: 'fb-stranger' };
      verifyIdToken.mockResolvedValue({ uid: stranger.firebase_uid });

      db.query
        .mockResolvedValueOnce({ rows: [stranger] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [baseBattleRow()] }); // getById

      const response = await request(app)
        .post('/battle/battle-1/ready')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects a non-participant calling POST /disconnect (participant-only room access)', async () => {
      const stranger = { player_id: 'stranger-id', firebase_uid: 'fb-stranger' };
      verifyIdToken.mockResolvedValue({ uid: stranger.firebase_uid });

      db.query
        .mockResolvedValueOnce({ rows: [stranger] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [baseBattleRow()] }); // getById

      const response = await request(app)
        .post('/battle/battle-1/disconnect')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects a non-participant calling POST /reconnect (participant-only room access)', async () => {
      const stranger = { player_id: 'stranger-id', firebase_uid: 'fb-stranger' };
      verifyIdToken.mockResolvedValue({ uid: stranger.firebase_uid });

      db.query
        .mockResolvedValueOnce({ rows: [stranger] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [baseBattleRow()] }); // getById

      const response = await request(app)
        .post('/battle/battle-1/reconnect')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('allows repeated ready submission without error (idempotent — already-ready stays ready)', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      const alreadyReady = baseBattleRow({ attacker_ready: true });

      // First submission
      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] })
        .mockResolvedValueOnce({ rows: [baseBattleRow()] })
        .mockResolvedValueOnce({ rows: [alreadyReady] });

      const first = await request(app)
        .post('/battle/battle-1/ready')
        .set('Authorization', 'Bearer valid-token')
        .send({});
      expect(first.status).toBe(200);
      expect(first.body.data.attacker_ready).toBe(true);

      // Second, repeated submission against the now-already-ready battle
      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] })
        .mockResolvedValueOnce({ rows: [alreadyReady] })
        .mockResolvedValueOnce({ rows: [alreadyReady] });

      const second = await request(app)
        .post('/battle/battle-1/ready')
        .set('Authorization', 'Bearer valid-token')
        .send({});
      expect(second.status).toBe(200);
      expect(second.body.data.attacker_ready).toBe(true);
    });

    it('allows repeated disconnect submission without error (idempotent — deadline just refreshes)', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      const firstDeadline = new Date(Date.now() + 15000).toISOString();
      const secondDeadline = new Date(Date.now() + 15500).toISOString();

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] })
        .mockResolvedValueOnce({ rows: [baseBattleRow()] })
        .mockResolvedValueOnce({ rows: [baseBattleRow({ attacker_disconnected_at: new Date().toISOString(), attacker_reconnect_deadline: firstDeadline })] });

      const first = await request(app)
        .post('/battle/battle-1/disconnect')
        .set('Authorization', 'Bearer valid-token')
        .send({});
      expect(first.status).toBe(200);

      // Repeated disconnect report while still in_progress and still disconnected —
      // must not error, and simply re-records the (refreshed) deadline.
      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] })
        .mockResolvedValueOnce({ rows: [baseBattleRow({ attacker_disconnected_at: new Date().toISOString(), attacker_reconnect_deadline: firstDeadline })] })
        .mockResolvedValueOnce({ rows: [baseBattleRow({ attacker_disconnected_at: new Date().toISOString(), attacker_reconnect_deadline: secondDeadline })] });

      const second = await request(app)
        .post('/battle/battle-1/disconnect')
        .set('Authorization', 'Bearer valid-token')
        .send({});
      expect(second.status).toBe(200);
      expect(second.body.data.attacker_reconnect_deadline).toBe(secondDeadline);
    });

    it('rejects ready confirmation on an expired/ended battle session (SESSION_EXPIRED)', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [baseBattleRow({ status: 'cancelled' })] }); // getById

      const response = await request(app)
        .post('/battle/battle-1/ready')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('SESSION_EXPIRED');
    });

    it('rejects reconnect on an expired/ended battle session (SESSION_EXPIRED)', async () => {
      verifyIdToken.mockResolvedValue({ uid: ATTACKER.firebase_uid });

      db.query
        .mockResolvedValueOnce({ rows: [ATTACKER] }) // resolveSelf
        .mockResolvedValueOnce({ rows: [baseBattleRow({ status: 'resolved' })] }); // getById

      const response = await request(app)
        .post('/battle/battle-1/reconnect')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('SESSION_EXPIRED');
    });
  });
});
