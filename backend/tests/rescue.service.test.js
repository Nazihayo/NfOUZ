'use strict';

process.env.NODE_ENV = 'test';

/**
 * Sprint 8 — Rescue orchestration. Every collaborator (`sosService`,
 * `sosRepo`, `rescueRepo`, `playerRepo`, `playerDeviceRepo`, `fcmService`)
 * is mocked directly so each test isolates exactly one piece of
 * rescue.service.js's own control flow (race handling, timeout
 * self-healing, reward caps, transaction rollback) rather than re-deriving
 * repository SQL semantics — that SQL is exercised for real in the non-Jest
 * execution proof (verify_sprint8_real.js) and in rescue.repository's own
 * suite.
 *
 * Sprint 8 correction updates to this file:
 *   - acceptMission now runs entirely inside db.withTransaction, locking
 *     the SOS row via sosService.getByIdForUpdate(sosId, client) instead
 *     of the old sosService.getById(sosId) — every acceptMission test now
 *     mocks getByIdForUpdate and asserts calls were threaded with txClient.
 *   - attempt_number/idempotency_key are computed inside that same
 *     transaction via the new rescueRepo.countMissionsForSos, so it's
 *     mocked and asserted on.
 *   - push notifications go through fcmService.sendToAllDevices with
 *     tokens looked up via the new playerDevice.repository (no more
 *     players.fcm_token) — both are mocked; sendToAllDevices is given a
 *     small real-ish implementation so the existing
 *     sendRescueAcceptedNotification/sendRescueCompletedNotification
 *     assertions keep working unchanged.
 *   - resolveGuardBattle's reward-cap/cooldown check now runs under
 *     rescueRepo.lockRescuerForRewardCheck(rescuerId, client) — mocked and
 *     asserted as called before the cap/cooldown reads.
 *   - recordReward's signature grew to (rescuerId, targetPlayerId,
 *     missionId, rewarded, creditsGranted, xpGranted, rewardReason,
 *     idempotencyKey, client) — it is now called on EVERY resolved
 *     successful mission (rewarded true or false), not only on an actual
 *     grant, so the "Reward Caps"/"Same Target Cooldown" tests assert it
 *     WAS called (with rewarded: false and the matching reward_reason)
 *     rather than asserting it was skipped.
 *
 * Sprint 8 Critical Security Patch updates to this file:
 *   - acceptMission now calls friendService.assertEligibleRescueFriendship
 *     (mocked) right after the self-rescue check — mocked to resolve by
 *     default so every pre-existing test keeps passing unchanged, with new
 *     tests asserting it's actually called/wired and that it blocks
 *     ineligible rescuers before any reservation is created.
 *   - rescueRepo.startGuardBattle now takes (missionId, duration, token,
 *     outcome); rescueRepo.succeedMission now takes (missionId, token,
 *     reportedOutcome, outcomeMismatch, client); rescueRepo.failMission now
 *     takes (missionId, failureReason, token, reportedOutcome,
 *     outcomeMismatch) — every existing call-arg assertion below is updated
 *     for the new signatures, and `activeMission()` now includes
 *     guard_battle_token/guard_battle_outcome fields.
 *   - resolveGuardBattle's 3rd/4th params are now (reportedOutcome,
 *     guardBattleToken) — the AUTHORITATIVE outcome is
 *     mission.guard_battle_outcome, never the client-reported value; new
 *     tests cover a forged/mismatched report, a missing/invalid token
 *     (replay), and a duplicate resolve of an already-resolved mission.
 */

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
  checkConnection: jest.fn(),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
}));

jest.mock('../src/services/sos.service', () => ({
  getByIdForUpdate: jest.fn(),
}));

jest.mock('../src/repositories/sos.repository', () => ({
  getById: jest.fn(),
  markRescued: jest.fn(),
}));

jest.mock('../src/repositories/rescue.repository', () => ({
  getMissionById: jest.fn(),
  getActiveMissionForSos: jest.fn(),
  countMissionsForSos: jest.fn(),
  getMostRecentFailureForSos: jest.fn(),
  createReservation: jest.fn(),
  startGuardBattle: jest.fn(),
  expireReservationIfDue: jest.fn(),
  expireGuardBattleIfDue: jest.fn(),
  succeedMission: jest.fn(),
  failMission: jest.fn(),
  lockRescuerForRewardCheck: jest.fn(),
  recordReward: jest.fn(),
  countRewardsSince: jest.fn(),
  hasRecentRewardForTarget: jest.fn(),
}));

jest.mock('../src/repositories/player.repository', () => ({
  getById: jest.fn(),
  isControlActive: jest.requireActual('../src/repositories/player.repository').isControlActive,
  releaseControlWithProtection: jest.fn(),
  adjustCredits: jest.fn(),
  adjustExperience: jest.fn(),
}));

jest.mock('../src/repositories/playerDevice.repository', () => ({
  getActiveTokens: jest.fn(),
}));

jest.mock('../src/services/fcm.service', () => ({
  sendRescueAcceptedNotification: jest.fn().mockResolvedValue({ success: true }),
  sendRescueCompletedNotification: jest.fn().mockResolvedValue({ success: true }),
  sendToAllDevices: jest.fn(),
}));

// Sprint 8 Critical Security Patch — acceptMission's friendship/eligibility
// gate. Mocked to resolve by default (see beforeEach) so it doesn't need
// re-wiring into every pre-existing acceptMission test.
jest.mock('../src/services/friend.service', () => ({
  assertEligibleRescueFriendship: jest.fn(),
}));

const db = require('../src/config/database');
const sosService = require('../src/services/sos.service');
const sosRepo = require('../src/repositories/sos.repository');
const rescueRepo = require('../src/repositories/rescue.repository');
const playerRepo = require('../src/repositories/player.repository');
const playerDeviceRepo = require('../src/repositories/playerDevice.repository');
const fcmService = require('../src/services/fcm.service');
const friendService = require('../src/services/friend.service');
const env = require('../src/config/env');
const rescueService = require('../src/services/rescue.service');

const txClient = { query: jest.fn() };

function realishSendToAllDevices(tokens, notifyFn) {
  if (!tokens || tokens.length === 0) {
    return Promise.resolve({ success: false, reason: 'no_token' });
  }
  return Promise.all(tokens.map((token) => notifyFn(token))).then((results) => {
    const anySuccess = results.some((r) => r.success);
    const lastFailure = [...results].reverse().find((r) => !r.success);
    return anySuccess ? { success: true } : { success: false, reason: lastFailure ? lastFailure.reason : 'unknown_error' };
  });
}

function openSos(overrides = {}) {
  return { sos_id: 'sos-1', player_id: 'TARGET', status: 'open', ...overrides };
}

function controlledTarget(overrides = {}) {
  return {
    player_id: 'TARGET',
    is_controlled: true,
    controlled_until: new Date(Date.now() + 5 * 60 * 1000),
    ...overrides,
  };
}

describe('rescue.service (Sprint 8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.withTransaction.mockImplementation((fn) => fn(txClient));
    playerRepo.getById.mockResolvedValue({ player_id: 'RESCUER', username: 'r' });
    playerDeviceRepo.getActiveTokens.mockResolvedValue(['tok-target']);
    fcmService.sendToAllDevices.mockImplementation(realishSendToAllDevices);
    rescueRepo.countMissionsForSos.mockResolvedValue(0); // attempt 1 by default
    rescueRepo.getMostRecentFailureForSos.mockResolvedValue(null); // no cooldown by default
    friendService.assertEligibleRescueFriendship.mockResolvedValue({ status: 'accepted' }); // eligible by default
  });

  describe('acceptMission', () => {
    it('Simultaneous Rescue Accept — a caller who loses the unique-index race gets RESCUE_ALREADY_IN_PROGRESS, not a 500', async () => {
      sosService.getByIdForUpdate.mockResolvedValue(openSos());
      rescueRepo.getActiveMissionForSos.mockResolvedValue(null);
      playerRepo.getById.mockResolvedValue(controlledTarget());

      const uniqueViolation = new Error('duplicate key value violates unique constraint "uniq_rescue_mission_active_per_sos"');
      uniqueViolation.code = '23505';
      rescueRepo.createReservation.mockRejectedValueOnce(uniqueViolation);

      await expect(rescueService.acceptMission('sos-1', 'RESCUER2')).rejects.toMatchObject({ code: 'RESCUE_ALREADY_IN_PROGRESS' });
      expect(sosService.getByIdForUpdate).toHaveBeenCalledWith('sos-1', txClient);
    });

    it('"Others see In Progress" — a second accept while a mission is already reserved/in_progress is rejected up front', async () => {
      sosService.getByIdForUpdate.mockResolvedValue(openSos());
      rescueRepo.getActiveMissionForSos.mockResolvedValue({ mission_id: 'm-1', status: 'reserved', reservation_expires_at: new Date(Date.now() + 30000) });

      await expect(rescueService.acceptMission('sos-1', 'RESCUER2')).rejects.toMatchObject({ code: 'RESCUE_ALREADY_IN_PROGRESS' });
      expect(rescueRepo.createReservation).not.toHaveBeenCalled();
    });

    it('rejects a rescuer trying to rescue themself', async () => {
      sosService.getByIdForUpdate.mockResolvedValue(openSos({ player_id: 'RESCUER' }));
      await expect(rescueService.acceptMission('sos-1', 'RESCUER')).rejects.toMatchObject({ code: 'CANNOT_RESCUE_SELF' });
      expect(rescueRepo.getActiveMissionForSos).not.toHaveBeenCalled();
    });

    it('Prevents a rescue start when Control has less than the configured minimum remaining', async () => {
      sosService.getByIdForUpdate.mockResolvedValue(openSos());
      rescueRepo.getActiveMissionForSos.mockResolvedValue(null);
      playerRepo.getById.mockResolvedValue(controlledTarget({ controlled_until: new Date(Date.now() + 30 * 1000) }));

      await expect(rescueService.acceptMission('sos-1', 'RESCUER')).rejects.toMatchObject({ code: 'CONTROL_TOO_SHORT' });
      expect(rescueRepo.createReservation).not.toHaveBeenCalled();
    });

    it('rejects when the SOS is not open', async () => {
      sosService.getByIdForUpdate.mockResolvedValue(openSos({ status: 'rescued' }));
      await expect(rescueService.acceptMission('sos-1', 'RESCUER')).rejects.toMatchObject({ code: 'SOS_NOT_OPEN' });
    });

    it('Failed-attempt cooldown — rejects a new accept within 10 minutes of the same SOS\'s last failure', async () => {
      sosService.getByIdForUpdate.mockResolvedValue(openSos());
      rescueRepo.getActiveMissionForSos.mockResolvedValue(null);
      rescueRepo.getMostRecentFailureForSos.mockResolvedValue({
        mission_id: 'm-failed',
        resolved_at: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      });

      await expect(rescueService.acceptMission('sos-1', 'RESCUER')).rejects.toMatchObject({ code: 'RESCUE_COOLDOWN_ACTIVE' });
      expect(rescueRepo.createReservation).not.toHaveBeenCalled();
    });

    it('Failed-attempt cooldown — allows a new accept once 10 minutes have passed since the last failure', async () => {
      sosService.getByIdForUpdate.mockResolvedValue(openSos());
      rescueRepo.getActiveMissionForSos.mockResolvedValue(null);
      playerRepo.getById.mockResolvedValue(controlledTarget());
      rescueRepo.getMostRecentFailureForSos.mockResolvedValue({
        mission_id: 'm-failed',
        resolved_at: new Date(Date.now() - 11 * 60 * 1000), // 11 minutes ago
      });
      rescueRepo.createReservation.mockResolvedValue({ mission_id: 'm-2', status: 'reserved', attempt_number: 2 });

      const result = await rescueService.acceptMission('sos-1', 'RESCUER');
      expect(result.mission_id).toBe('m-2');
    });

    it('computes attempt_number/idempotency_key from countMissionsForSos and threads the transaction client through every repo call', async () => {
      sosService.getByIdForUpdate.mockResolvedValue(openSos());
      rescueRepo.getActiveMissionForSos.mockResolvedValue(null);
      playerRepo.getById.mockResolvedValue(controlledTarget());
      rescueRepo.countMissionsForSos.mockResolvedValue(2); // two prior attempts already exist
      const created = { mission_id: 'm-3', sos_id: 'sos-1', rescuer_id: 'RESCUER', status: 'reserved', attempt_number: 3 };
      rescueRepo.createReservation.mockResolvedValue(created);

      const result = await rescueService.acceptMission('sos-1', 'RESCUER');

      expect(rescueRepo.countMissionsForSos).toHaveBeenCalledWith('sos-1', txClient);
      expect(rescueRepo.createReservation).toHaveBeenCalledWith(
        'sos-1',
        'RESCUER',
        3,
        'sos-1:RESCUER:3',
        env.RESCUE_RESERVATION_TIMEOUT_SECONDS,
        txClient
      );
      expect(result).toEqual(created);
      expect(fcmService.sendToAllDevices).toHaveBeenCalledWith(['tok-target'], expect.any(Function));
    });

    // --- Sprint 8 Critical Security Patch ---------------------------------

    it('Unauthorized rescue — rejects a rescuer who is not an eligible friend of the SOS owner, before creating any reservation', async () => {
      sosService.getByIdForUpdate.mockResolvedValue(openSos());
      const err = new Error('not eligible');
      err.code = 'NOT_ELIGIBLE_FRIEND';
      err.statusCode = 403;
      friendService.assertEligibleRescueFriendship.mockRejectedValue(err);

      await expect(rescueService.acceptMission('sos-1', 'RESCUER')).rejects.toMatchObject({ code: 'NOT_ELIGIBLE_FRIEND' });
      expect(rescueRepo.createReservation).not.toHaveBeenCalled();
      expect(rescueRepo.getActiveMissionForSos).not.toHaveBeenCalled(); // fails fast, before touching mission state
    });

    it('Friendship age bypass — rejects a rescuer whose accepted friendship with the owner is younger than the minimum age', async () => {
      sosService.getByIdForUpdate.mockResolvedValue(openSos());
      const err = new Error('too new');
      err.code = 'FRIENDSHIP_TOO_NEW';
      err.statusCode = 403;
      friendService.assertEligibleRescueFriendship.mockRejectedValue(err);

      await expect(rescueService.acceptMission('sos-1', 'RESCUER')).rejects.toMatchObject({ code: 'FRIENDSHIP_TOO_NEW' });
      expect(rescueRepo.createReservation).not.toHaveBeenCalled();
    });

    it('Block bypass — rejects a rescuer who has blocked, or is blocked by, the SOS owner', async () => {
      sosService.getByIdForUpdate.mockResolvedValue(openSos());
      const err = new Error('blocked');
      err.code = 'PLAYER_BLOCKED';
      err.statusCode = 403;
      friendService.assertEligibleRescueFriendship.mockRejectedValue(err);

      await expect(rescueService.acceptMission('sos-1', 'RESCUER')).rejects.toMatchObject({ code: 'PLAYER_BLOCKED' });
      expect(rescueRepo.createReservation).not.toHaveBeenCalled();
    });

    it('checks friendship eligibility inside the SAME transaction/row-locked client as the rest of the accept, for the actual SOS owner', async () => {
      sosService.getByIdForUpdate.mockResolvedValue(openSos());
      rescueRepo.getActiveMissionForSos.mockResolvedValue(null);
      playerRepo.getById.mockResolvedValue(controlledTarget());
      rescueRepo.createReservation.mockResolvedValue({ mission_id: 'm-x', status: 'reserved' });

      await rescueService.acceptMission('sos-1', 'RESCUER');

      expect(friendService.assertEligibleRescueFriendship).toHaveBeenCalledWith('RESCUER', 'TARGET', txClient);
    });

    it('a self-rescue attempt is rejected before even checking friendship eligibility', async () => {
      sosService.getByIdForUpdate.mockResolvedValue(openSos({ player_id: 'RESCUER' }));
      await expect(rescueService.acceptMission('sos-1', 'RESCUER')).rejects.toMatchObject({ code: 'CANNOT_RESCUE_SELF' });
      expect(friendService.assertEligibleRescueFriendship).not.toHaveBeenCalled();
    });
  });

  describe('startGuardBattle — Reservation Timeout', () => {
    it('self-heals an expired reservation and rejects the start with RESERVATION_EXPIRED', async () => {
      const expiredReservation = { mission_id: 'm-1', rescuer_id: 'RESCUER', status: 'reserved', reservation_expires_at: new Date(Date.now() - 1000) };
      rescueRepo.getMissionById.mockResolvedValue(expiredReservation);
      rescueRepo.expireReservationIfDue.mockResolvedValue({ ...expiredReservation, status: 'expired', failure_reason: 'reservation_timeout' });

      await expect(rescueService.startGuardBattle('m-1', 'RESCUER')).rejects.toMatchObject({ code: 'RESERVATION_EXPIRED' });
      expect(rescueRepo.startGuardBattle).not.toHaveBeenCalled();
    });

    it('rejects a caller who does not own the reservation', async () => {
      rescueRepo.getMissionById.mockResolvedValue({ mission_id: 'm-1', rescuer_id: 'SOMEONE_ELSE', status: 'reserved' });
      await expect(rescueService.startGuardBattle('m-1', 'RESCUER')).rejects.toMatchObject({ code: 'NOT_YOUR_RESERVATION' });
    });

    it('starts the guard battle for a still-valid reservation', async () => {
      const reservation = { mission_id: 'm-1', rescuer_id: 'RESCUER', status: 'reserved', reservation_expires_at: new Date(Date.now() + 20000) };
      rescueRepo.getMissionById.mockResolvedValue(reservation);
      rescueRepo.expireReservationIfDue.mockResolvedValue(null); // not due yet
      rescueRepo.startGuardBattle.mockResolvedValue({ ...reservation, status: 'in_progress', guard_battle_token: 'tok-1' });

      const result = await rescueService.startGuardBattle('m-1', 'RESCUER');
      expect(result.status).toBe('in_progress');
      // Sprint 8 Critical Security Patch — the server now generates and
      // stores its own one-time token and authoritative outcome right here,
      // never derived from anything the client sent.
      expect(rescueRepo.startGuardBattle).toHaveBeenCalledWith(
        'm-1',
        env.RESCUE_GUARD_BATTLE_DURATION_SECONDS,
        expect.any(String),
        expect.stringMatching(/^(success|failure)$/)
      );
      const [, , token] = rescueRepo.startGuardBattle.mock.calls[0];
      expect(token.length).toBeGreaterThanOrEqual(32); // a real random token, not a placeholder
    });
  });

  describe('resolveGuardBattle — Reward Caps / Same Target Cooldown / Transaction Rollback / Guard Battle Authority', () => {
    const TOKEN = 'tok-abc123';

    // Sprint 8 Critical Security Patch — every fixture now carries the
    // server-authoritative guard_battle_outcome and the token the caller
    // must echo back. Unless a test says otherwise, guard_battle_outcome
    // matches whatever `resolveGuardBattle` is called with below, so the
    // pre-existing reward/cooldown tests exercise the "client and server
    // agree" case exactly as before the patch — the mismatch/forgery cases
    // get their own dedicated tests further down.
    function activeMission(overrides = {}) {
      return {
        mission_id: 'm-1',
        sos_id: 'sos-1',
        rescuer_id: 'RESCUER',
        status: 'in_progress',
        guard_battle_token: TOKEN,
        guard_battle_outcome: 'success',
        ...overrides,
      };
    }

    it('failure outcome marks the mission failed (reason: rescuer_defeated) and grants nothing', async () => {
      rescueRepo.getMissionById.mockResolvedValue(activeMission({ guard_battle_outcome: 'failure' }));
      rescueRepo.expireGuardBattleIfDue.mockResolvedValue(null);
      rescueRepo.failMission.mockResolvedValue(activeMission({ status: 'failed', failure_reason: 'rescuer_defeated' }));

      const result = await rescueService.resolveGuardBattle('m-1', 'RESCUER', 'failure', TOKEN);

      expect(result.rewarded).toBe(false);
      expect(result.mission.status).toBe('failed');
      expect(rescueRepo.failMission).toHaveBeenCalledWith('m-1', 'rescuer_defeated', TOKEN, 'failure', false);
      expect(playerRepo.releaseControlWithProtection).not.toHaveBeenCalled();
      expect(rescueRepo.recordReward).not.toHaveBeenCalled();
    });

    it('Reward Caps — the 4th rewarded rescue of the UTC day is not rewarded, but still succeeds and is still ledgered', async () => {
      rescueRepo.getMissionById.mockResolvedValue(activeMission());
      rescueRepo.expireGuardBattleIfDue.mockResolvedValue(null);
      sosRepo.getById.mockResolvedValue(openSos());
      rescueRepo.succeedMission.mockResolvedValue(activeMission({ status: 'succeeded' }));
      rescueRepo.countRewardsSince.mockResolvedValue(env.RESCUE_MAX_REWARDED_PER_DAY); // already at the cap
      rescueRepo.hasRecentRewardForTarget.mockResolvedValue(false);

      const result = await rescueService.resolveGuardBattle('m-1', 'RESCUER', 'success', TOKEN);

      expect(result.rewarded).toBe(false);
      expect(result.mission.status).toBe('succeeded');
      expect(rescueRepo.lockRescuerForRewardCheck).toHaveBeenCalledWith('RESCUER', txClient);
      expect(playerRepo.releaseControlWithProtection).toHaveBeenCalledTimes(1); // Control still ends
      expect(playerRepo.adjustCredits).not.toHaveBeenCalled();
      expect(playerRepo.adjustExperience).not.toHaveBeenCalled();
      expect(rescueRepo.recordReward).toHaveBeenCalledWith('RESCUER', 'TARGET', 'm-1', false, 0, 0, 'daily_cap_reached', 'reward:m-1', txClient);
    });

    it('Same Target Cooldown — no reward when this rescuer/target pair was already rewarded within 24h, even under the daily cap', async () => {
      rescueRepo.getMissionById.mockResolvedValue(activeMission());
      rescueRepo.expireGuardBattleIfDue.mockResolvedValue(null);
      sosRepo.getById.mockResolvedValue(openSos());
      rescueRepo.succeedMission.mockResolvedValue(activeMission({ status: 'succeeded' }));
      rescueRepo.countRewardsSince.mockResolvedValue(0);
      rescueRepo.hasRecentRewardForTarget.mockResolvedValue(true); // cooldown active

      const result = await rescueService.resolveGuardBattle('m-1', 'RESCUER', 'success', TOKEN);

      expect(result.rewarded).toBe(false);
      expect(playerRepo.adjustCredits).not.toHaveBeenCalled();
      expect(rescueRepo.recordReward).toHaveBeenCalledWith('RESCUER', 'TARGET', 'm-1', false, 0, 0, 'same_target_cooldown', 'reward:m-1', txClient);
    });

    it('rewards Credits + XP directly via playerRepo, never through creditsService, when under both caps', async () => {
      rescueRepo.getMissionById.mockResolvedValue(activeMission());
      rescueRepo.expireGuardBattleIfDue.mockResolvedValue(null);
      sosRepo.getById.mockResolvedValue(openSos());
      rescueRepo.succeedMission.mockResolvedValue(activeMission({ status: 'succeeded' }));
      rescueRepo.countRewardsSince.mockResolvedValue(0);
      rescueRepo.hasRecentRewardForTarget.mockResolvedValue(false);

      const result = await rescueService.resolveGuardBattle('m-1', 'RESCUER', 'success', TOKEN);

      expect(result.rewarded).toBe(true);
      expect(playerRepo.adjustCredits).toHaveBeenCalledWith('RESCUER', env.RESCUE_REWARD_CREDITS, txClient);
      expect(playerRepo.adjustExperience).toHaveBeenCalledWith('RESCUER', env.RESCUE_REWARD_XP, txClient);
      expect(rescueRepo.succeedMission).toHaveBeenCalledWith('m-1', TOKEN, 'success', false, txClient);
      expect(rescueRepo.recordReward).toHaveBeenCalledWith(
        'RESCUER',
        'TARGET',
        'm-1',
        true,
        env.RESCUE_REWARD_CREDITS,
        env.RESCUE_REWARD_XP,
        'granted',
        'reward:m-1',
        txClient
      );
    });

    it('Never grants Influence on a rescue reward', async () => {
      rescueRepo.getMissionById.mockResolvedValue(activeMission());
      rescueRepo.expireGuardBattleIfDue.mockResolvedValue(null);
      sosRepo.getById.mockResolvedValue(openSos());
      rescueRepo.succeedMission.mockResolvedValue(activeMission({ status: 'succeeded' }));
      rescueRepo.countRewardsSince.mockResolvedValue(0);
      rescueRepo.hasRecentRewardForTarget.mockResolvedValue(false);

      await rescueService.resolveGuardBattle('m-1', 'RESCUER', 'success', TOKEN);

      expect(playerRepo.adjustInfluence).toBeUndefined(); // not even mocked/imported by rescue.service
    });

    it('Transaction Rollback — a mid-transaction failure propagates and this service does not swallow it', async () => {
      rescueRepo.getMissionById.mockResolvedValue(activeMission());
      rescueRepo.expireGuardBattleIfDue.mockResolvedValue(null);
      sosRepo.getById.mockResolvedValue(openSos());
      db.withTransaction.mockImplementation(async () => {
        throw new Error('SIMULATED_MID_TRANSACTION_FAILURE');
      });

      await expect(rescueService.resolveGuardBattle('m-1', 'RESCUER', 'success', TOKEN)).rejects.toThrow('SIMULATED_MID_TRANSACTION_FAILURE');
      expect(fcmService.sendRescueCompletedNotification).not.toHaveBeenCalled();
    });

    it('rejects an invalid outcome value before touching any repository', async () => {
      await expect(rescueService.resolveGuardBattle('m-1', 'RESCUER', 'maybe', TOKEN)).rejects.toMatchObject({ code: 'INVALID_OUTCOME' });
      expect(rescueRepo.getMissionById).not.toHaveBeenCalled();
    });

    it('rejects resolving a mission that has no active guard battle', async () => {
      rescueRepo.getMissionById.mockResolvedValue(activeMission({ status: 'reserved' }));
      rescueRepo.expireReservationIfDue.mockResolvedValue(null);

      await expect(rescueService.resolveGuardBattle('m-1', 'RESCUER', 'success', TOKEN)).rejects.toMatchObject({ code: 'GUARD_BATTLE_NOT_ACTIVE' });
    });

    // --- Sprint 8 Critical Security Patch: guard-battle authority ---------

    it('rejects a resolve call with no guard_battle_token before touching any repository', async () => {
      await expect(rescueService.resolveGuardBattle('m-1', 'RESCUER', 'success', undefined)).rejects.toMatchObject({
        code: 'INVALID_GUARD_BATTLE_TOKEN',
      });
      expect(rescueRepo.getMissionById).not.toHaveBeenCalled();
    });

    it('Replay attack — rejects a resolve call whose token does not match the mission\'s stored token, mutating nothing', async () => {
      rescueRepo.getMissionById.mockResolvedValue(activeMission());
      rescueRepo.expireGuardBattleIfDue.mockResolvedValue(null);

      await expect(rescueService.resolveGuardBattle('m-1', 'RESCUER', 'success', 'wrong-token')).rejects.toMatchObject({
        code: 'INVALID_GUARD_BATTLE_TOKEN',
      });
      expect(rescueRepo.succeedMission).not.toHaveBeenCalled();
      expect(rescueRepo.failMission).not.toHaveBeenCalled();
    });

    it('Forged rescue success — client reports "success" but the server-authoritative outcome was "failure": the mission FAILS and nothing is rewarded', async () => {
      rescueRepo.getMissionById.mockResolvedValue(activeMission({ guard_battle_outcome: 'failure' }));
      rescueRepo.expireGuardBattleIfDue.mockResolvedValue(null);
      rescueRepo.failMission.mockResolvedValue(activeMission({ status: 'failed', failure_reason: 'rescuer_defeated' }));

      const result = await rescueService.resolveGuardBattle('m-1', 'RESCUER', 'success', TOKEN);

      expect(result.mission.status).toBe('failed');
      expect(result.rewarded).toBe(false);
      // reportedOutcome='success', but outcomeMismatch=true — the client's
      // claim is recorded for audit, and NEVER used to decide the result.
      expect(rescueRepo.failMission).toHaveBeenCalledWith('m-1', 'rescuer_defeated', TOKEN, 'success', true);
      expect(rescueRepo.succeedMission).not.toHaveBeenCalled();
      expect(playerRepo.adjustCredits).not.toHaveBeenCalled();
    });

    it('a mismatch is recorded even on a legitimate-looking failure report (server said success, client claimed failure) — still succeeds', async () => {
      rescueRepo.getMissionById.mockResolvedValue(activeMission({ guard_battle_outcome: 'success' }));
      rescueRepo.expireGuardBattleIfDue.mockResolvedValue(null);
      sosRepo.getById.mockResolvedValue(openSos());
      rescueRepo.succeedMission.mockResolvedValue(activeMission({ status: 'succeeded' }));
      rescueRepo.countRewardsSince.mockResolvedValue(0);
      rescueRepo.hasRecentRewardForTarget.mockResolvedValue(false);

      const result = await rescueService.resolveGuardBattle('m-1', 'RESCUER', 'failure', TOKEN);

      expect(result.mission.status).toBe('succeeded'); // authoritative outcome wins, not the client's "failure" claim
      expect(rescueRepo.succeedMission).toHaveBeenCalledWith('m-1', TOKEN, 'failure', true, txClient);
    });

    it('Duplicate rescue success — resolving an already-resolved mission a second time is rejected, never double-rewarded', async () => {
      // The mission has already transitioned out of 'in_progress' (e.g. a
      // first resolve call already succeeded it) — selfHealMission is a
      // no-op for a terminal status, so this must be rejected up front.
      rescueRepo.getMissionById.mockResolvedValue(activeMission({ status: 'succeeded' }));

      await expect(rescueService.resolveGuardBattle('m-1', 'RESCUER', 'success', TOKEN)).rejects.toMatchObject({
        code: 'GUARD_BATTLE_NOT_ACTIVE',
      });
      expect(rescueRepo.succeedMission).not.toHaveBeenCalled();
      expect(rescueRepo.failMission).not.toHaveBeenCalled();
      expect(rescueRepo.recordReward).not.toHaveBeenCalled();
    });

    it('a race that consumes the token between the pre-check and the write (succeedMission returns null) is reported as GUARD_BATTLE_NOT_ACTIVE, not a silent 500', async () => {
      rescueRepo.getMissionById.mockResolvedValue(activeMission());
      rescueRepo.expireGuardBattleIfDue.mockResolvedValue(null);
      sosRepo.getById.mockResolvedValue(openSos());
      rescueRepo.succeedMission.mockResolvedValue(null); // lost the race at the DB level

      await expect(rescueService.resolveGuardBattle('m-1', 'RESCUER', 'success', TOKEN)).rejects.toMatchObject({
        code: 'GUARD_BATTLE_NOT_ACTIVE',
      });
    });
  });
});
