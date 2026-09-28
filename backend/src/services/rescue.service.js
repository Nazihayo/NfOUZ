'use strict';

const crypto = require('crypto');
const db = require('../config/database');
const env = require('../config/env');
const rescueRepo = require('../repositories/rescue.repository');
const sosRepo = require('../repositories/sos.repository');
const sosService = require('./sos.service');
const friendService = require('./friend.service');
const playerRepo = require('../repositories/player.repository');
const playerDeviceRepo = require('../repositories/playerDevice.repository');
const fcmService = require('./fcm.service');
const logger = require('../utils/logger');
const { ApiError } = require('../utils/responseEnvelope');
const questService = require('./quest.service'); // Sprint 9 — best-effort quest progress hook only, see resolveGuardBattle's success path below.

const UNIQUE_VIOLATION = '23505';

/** A fresh, unguessable one-time token for one guard battle (see startGuardBattle). */
function generateGuardBattleToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Sprint 8 Critical Security Patch — the server, not the client, decides
 * whether a guard battle is won. Rolled once, right now, before the client
 * has any way to know the answer — never derived from, or influenced by,
 * anything the client later reports. See env.js's
 * RESCUE_GUARD_BATTLE_SUCCESS_PROBABILITY doc comment for why this is a
 * probability roll rather than a full server-side reimplementation of
 * RescueGuardCombat.cs's real-time combat.
 */
function rollAuthoritativeGuardBattleOutcome() {
  return Math.random() < env.RESCUE_GUARD_BATTLE_SUCCESS_PROBABILITY ? 'success' : 'failure';
}

/**
 * Sprint 8 — Rescue orchestration.
 *
 * Friend accepts mission -> Reservation -> Guard Battle -> Success/Failure.
 *
 * "Remote virtual rescue. No physical navigation. No Mapbox rescue route." —
 * this module never touches location data at all; a mission is identified
 * purely by sos_id/mission_id, and the guard battle itself is resolved
 * client-side (RescueGuardCombat.cs) then reported here as one outcome.
 *
 * Sprint 8 correction — "reward caps and simultaneous acceptance are
 * enforced transactionally with row locking, not only application-level
 * checks":
 *   - acceptMission now runs its entire check-then-write sequence inside
 *     ONE db.withTransaction, holding a `SELECT ... FOR UPDATE` lock on
 *     the sos_requests row for its whole duration (sosService.
 *     getByIdForUpdate) — a second concurrent accept for the same SOS
 *     blocks on that lock rather than racing the first to an insert, so
 *     "Others see In Progress" is a real serialization guarantee, not
 *     just a caught unique-violation.
 *   - resolveGuardBattle's reward-cap/same-target-cooldown check is
 *     wrapped in a Postgres advisory transaction lock keyed on the
 *     rescuer (rescueRepo.lockRescuerForRewardCheck), so two simultaneous
 *     successful rescues by the same rescuer can never both read "under
 *     the cap" and both grant a reward.
 * The partial unique index on rescue_missions and the UNIQUE
 * idempotency_key/reward idempotency_key remain as defense-in-depth, not
 * the only guard.
 */

/** Self-heals a mission's reservation/guard-battle expiry before any read that depends on its current status. */
async function selfHealMission(mission, executor = db) {
  if (!mission) {
    return mission;
  }
  if (mission.status === 'reserved') {
    const expired = await rescueRepo.expireReservationIfDue(mission.mission_id, executor);
    return expired || mission;
  }
  if (mission.status === 'in_progress') {
    const expired = await rescueRepo.expireGuardBattleIfDue(mission.mission_id, executor);
    return expired || mission;
  }
  return mission;
}

/**
 * Friend accepts an SOS mission. Runs entirely inside one transaction that
 * locks the SOS row for its duration — see the module doc comment above
 * for why this, and not only the rescue_missions partial unique index, is
 * now the primary race guard for "First accepted rescuer reserves
 * mission" / "Others see In Progress".
 */
async function acceptMission(sosId, rescuerId) {
  const { mission, target } = await db.withTransaction(async (client) => {
    const sos = await sosService.getByIdForUpdate(sosId, client); // locks the row + self-heals Control-expired SOS

    if (sos.status !== 'open') {
      throw new ApiError('SOS_NOT_OPEN', 'This SOS is no longer open for rescue.', 409);
    }

    if (sos.player_id === rescuerId) {
      throw new ApiError('CANNOT_RESCUE_SELF', 'You cannot rescue yourself.', 400);
    }

    // Sprint 8 Critical Security Patch — "Only eligible friends may accept
    // rescue": an accepted friendship at least SOS_FRIENDSHIP_MIN_AGE_HOURS
    // old, with neither side blocking the other — the exact rule that
    // already gates who gets NOTIFIED of this SOS in the first place (see
    // friend.service.js#assertEligibleRescueFriendship's doc comment for
    // why push-notification-channel obscurity was never real
    // authorization). Runs inside this same transaction/row-locked client
    // so it's part of one atomic decision, not a separate racy check.
    await friendService.assertEligibleRescueFriendship(rescuerId, sos.player_id, client);

    const existingActive = await rescueRepo.getActiveMissionForSos(sosId, client);
    if (existingActive) {
      const healed = await selfHealMission(existingActive, client);
      if (healed.status === 'reserved' || healed.status === 'in_progress') {
        throw new ApiError('RESCUE_ALREADY_IN_PROGRESS', 'Another friend already has this rescue in progress.', 409);
      }
    }

    // Sprint 8 correction (final pass) — "Failed attempt cooldown is 10
    // minutes": race-free under the SOS row lock this transaction already
    // holds, same as the attempt_number computation below.
    const mostRecentFailure = await rescueRepo.getMostRecentFailureForSos(sosId, client);
    if (mostRecentFailure) {
      const cooldownEndsAt = new Date(mostRecentFailure.resolved_at).getTime() + env.RESCUE_FAILED_ATTEMPT_COOLDOWN_MINUTES * 60 * 1000;
      if (Date.now() < cooldownEndsAt) {
        throw new ApiError(
          'RESCUE_COOLDOWN_ACTIVE',
          `Another rescue attempt failed recently — wait ${env.RESCUE_FAILED_ATTEMPT_COOLDOWN_MINUTES} minutes before trying again.`,
          409
        );
      }
    }

    const targetPlayer = await playerRepo.getById(sos.player_id, client);
    if (!targetPlayer || !playerRepo.isControlActive(targetPlayer)) {
      throw new ApiError('SOS_REQUIRES_CONTROL', 'The target is no longer Controlled.', 409);
    }

    const remainingSeconds = (new Date(targetPlayer.controlled_until).getTime() - Date.now()) / 1000;
    if (remainingSeconds < env.RESCUE_MIN_CONTROL_REMAINING_SECONDS) {
      throw new ApiError(
        'CONTROL_TOO_SHORT',
        `Control must have at least ${env.RESCUE_MIN_CONTROL_REMAINING_SECONDS} seconds remaining to start a rescue.`,
        409
      );
    }

    // Race-free because the SOS row lock above serializes every
    // concurrent acceptMission call for this sos_id.
    const attemptNumber = (await rescueRepo.countMissionsForSos(sosId, client)) + 1;
    const idempotencyKey = `${sosId}:${rescuerId}:${attemptNumber}`;

    let createdMission;
    try {
      createdMission = await rescueRepo.createReservation(
        sosId,
        rescuerId,
        attemptNumber,
        idempotencyKey,
        env.RESCUE_RESERVATION_TIMEOUT_SECONDS,
        client
      );
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) {
        throw new ApiError('RESCUE_ALREADY_IN_PROGRESS', 'Another friend already has this rescue in progress.', 409);
      }
      throw err;
    }

    return { mission: createdMission, target: targetPlayer };
  });

  try {
    const rescuer = await playerRepo.getById(rescuerId);
    const tokens = await playerDeviceRepo.getActiveTokens(target.player_id);
    await fcmService.sendToAllDevices(tokens, (token) =>
      fcmService.sendRescueAcceptedNotification(token, { sosId, rescuerUsername: rescuer ? rescuer.username : 'A friend' })
    );
  } catch (err) {
    logger.warn('Failed to send rescue-accepted push', { error: err.message });
  }

  return mission;
}

/**
 * Starts the Guard Battle for a reservation the caller owns. Rejects a
 * reservation that has already timed out (self-healed to 'expired' first).
 */
async function startGuardBattle(missionId, rescuerId) {
  let mission = await rescueRepo.getMissionById(missionId);
  if (!mission) {
    throw new ApiError('RESCUE_MISSION_NOT_FOUND', 'No rescue mission exists with this id.', 404);
  }
  if (mission.rescuer_id !== rescuerId) {
    throw new ApiError('NOT_YOUR_RESERVATION', 'This rescue mission belongs to another rescuer.', 403);
  }

  mission = await selfHealMission(mission);
  if (mission.status !== 'reserved') {
    throw new ApiError('RESERVATION_EXPIRED', 'Your reservation has expired.', 409);
  }

  const guardBattleToken = generateGuardBattleToken();
  const guardBattleOutcome = rollAuthoritativeGuardBattleOutcome(); // authoritative — decided now, never revealed to the client, never overridden later.

  const started = await rescueRepo.startGuardBattle(missionId, env.RESCUE_GUARD_BATTLE_DURATION_SECONDS, guardBattleToken, guardBattleOutcome);
  if (!started) {
    throw new ApiError('RESERVATION_EXPIRED', 'Your reservation has expired.', 409);
  }
  return started;
}

/**
 * Resolves a Guard Battle the caller owns. `reportedOutcome` is whatever
 * the client claims happened ('success' or 'failure') and `guardBattleToken`
 * is the one-time token issued by startGuardBattle.
 *
 * Sprint 8 Critical Security Patch — "Client may never directly claim
 * rescue success" / "Guard battle success must be validated
 * authoritatively": `reportedOutcome` is NEVER used to decide success or
 * failure. The real decision is `mission.guard_battle_outcome`, rolled and
 * stored by the server back when the battle started (see
 * startGuardBattle/rollAuthoritativeGuardBattleOutcome) — a modified client
 * that always reports "success" simply gets whatever the server had
 * already decided, no better and no worse. `reportedOutcome` is still
 * recorded for audit, and a mismatch between it and the authoritative
 * result is logged as a suspicious-result signal (a legitimate,
 * unmodified client always agrees with the server, since the same
 * `outcome` its local combat produces was never the one that mattered).
 *
 * `guardBattleToken` must match the mission's stored, single-use token —
 * see rescue.repository.js#succeedMission/failMission's doc comments for
 * how this closes the replay/duplicate-resolve path at the database level,
 * on top of the pre-existing `status = 'in_progress'` guard.
 *
 * On success: ends Control, closes the SOS, grants 30-minute Protection,
 * and (subject to reward caps, checked under an advisory lock — see module
 * doc comment) grants the rescuer 50 Credits + 80 XP directly via
 * playerRepo — NEVER through creditsService, since rescue rewards are
 * explicitly excluded from the Sprint 7 Control-economy 20% deduction
 * rule. A rescue_rewards row is written on EVERY successful resolution,
 * `rewarded` true or false, so the ledger is a complete audit trail. On
 * failure, the SOS remains open for another rescue attempt ("additional
 * rescues remain possible").
 */
async function resolveGuardBattle(missionId, rescuerId, reportedOutcome, guardBattleToken) {
  if (reportedOutcome !== 'success' && reportedOutcome !== 'failure') {
    throw new ApiError('INVALID_OUTCOME', "outcome must be 'success' or 'failure'.", 400);
  }
  if (!guardBattleToken || typeof guardBattleToken !== 'string') {
    throw new ApiError('INVALID_GUARD_BATTLE_TOKEN', 'guard_battle_token is required.', 403);
  }

  let mission = await rescueRepo.getMissionById(missionId);
  if (!mission) {
    throw new ApiError('RESCUE_MISSION_NOT_FOUND', 'No rescue mission exists with this id.', 404);
  }
  if (mission.rescuer_id !== rescuerId) {
    throw new ApiError('NOT_YOUR_RESERVATION', 'This rescue mission belongs to another rescuer.', 403);
  }

  mission = await selfHealMission(mission);
  if (mission.status !== 'in_progress') {
    throw new ApiError('GUARD_BATTLE_NOT_ACTIVE', 'This rescue mission has no active guard battle.', 409);
  }

  if (mission.guard_battle_token !== guardBattleToken) {
    // Wrong/stale/forged token while the mission is still 'in_progress' —
    // either a replay of an old request, or a forged call that never went
    // through startGuardBattle for this attempt. Never touches any state.
    logger.warn('Rejected guard-battle resolve with an invalid guard_battle_token — possible replay/forgery attempt', {
      missionId,
      rescuerId,
    });
    throw new ApiError('INVALID_GUARD_BATTLE_TOKEN', 'This guard battle token is invalid or has already been used.', 403);
  }

  const authoritativeOutcome = mission.guard_battle_outcome === 'success' ? 'success' : 'failure';
  const outcomeMismatch = authoritativeOutcome !== reportedOutcome;
  if (outcomeMismatch) {
    // Suspicious-result handling: never silently trusted, never silently
    // dropped either — logged for anti-cheat review. The mission still
    // resolves to the AUTHORITATIVE outcome, not what was reported.
    logger.warn('Guard battle outcome mismatch — client-reported outcome differs from the server-authoritative result (possible cheat attempt)', {
      missionId,
      rescuerId,
      reportedOutcome,
      authoritativeOutcome,
    });
  }

  if (authoritativeOutcome === 'failure') {
    const failed = await rescueRepo.failMission(missionId, 'rescuer_defeated', guardBattleToken, reportedOutcome, outcomeMismatch);
    if (!failed) {
      // Lost a race to a concurrent resolve call that already consumed
      // this token/status — same "no longer active" outcome as any other
      // duplicate resolution.
      throw new ApiError('GUARD_BATTLE_NOT_ACTIVE', 'This rescue mission has no active guard battle.', 409);
    }
    return { mission: failed, rewarded: false };
  }

  const sos = await sosRepo.getById(mission.sos_id);
  if (!sos) {
    throw new ApiError('SOS_NOT_FOUND', 'No SOS request exists for this mission.', 404);
  }
  const targetPlayerId = sos.player_id;
  const protectedUntil = new Date(Date.now() + env.RESCUE_PROTECTION_MINUTES * 60 * 1000);

  const result = await db.withTransaction(async (client) => {
    await playerRepo.releaseControlWithProtection(targetPlayerId, protectedUntil, 'rescue', client);
    await sosRepo.markRescued(sos.sos_id, rescuerId, client);
    const succeeded = await rescueRepo.succeedMission(missionId, guardBattleToken, reportedOutcome, outcomeMismatch, client);
    if (!succeeded) {
      throw new ApiError('GUARD_BATTLE_NOT_ACTIVE', 'This rescue mission has no active guard battle.', 409);
    }

    // Serializes the reward-cap/cooldown check-then-write for THIS
    // rescuer against any other concurrent successful resolution by the
    // same rescuer — see module doc comment.
    await rescueRepo.lockRescuerForRewardCheck(rescuerId, client);

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const cooldownSince = new Date(Date.now() - env.RESCUE_SAME_TARGET_COOLDOWN_HOURS * 60 * 60 * 1000);

    const [rewardsToday, recentForTarget] = await Promise.all([
      rescueRepo.countRewardsSince(rescuerId, dayStart, client),
      rescueRepo.hasRecentRewardForTarget(rescuerId, targetPlayerId, cooldownSince, client),
    ]);

    let rewarded = false;
    let creditsGranted = 0;
    let xpGranted = 0;
    let rewardReason;

    if (rewardsToday >= env.RESCUE_MAX_REWARDED_PER_DAY) {
      rewardReason = 'daily_cap_reached';
    } else if (recentForTarget) {
      rewardReason = 'same_target_cooldown';
    } else {
      rewarded = true;
      creditsGranted = env.RESCUE_REWARD_CREDITS;
      xpGranted = env.RESCUE_REWARD_XP;
      rewardReason = 'granted';
      await playerRepo.adjustCredits(rescuerId, creditsGranted, client);
      await playerRepo.adjustExperience(rescuerId, xpGranted, client);
    }

    await rescueRepo.recordReward(
      rescuerId,
      targetPlayerId,
      missionId,
      rewarded,
      creditsGranted,
      xpGranted,
      rewardReason,
      `reward:${missionId}`,
      client
    );

    return { mission: succeeded, rewarded };
  });

  try {
    const tokens = await playerDeviceRepo.getActiveTokens(targetPlayerId);
    await fcmService.sendToAllDevices(tokens, (token) => fcmService.sendRescueCompletedNotification(token, { sosId: sos.sos_id }));
  } catch (err) {
    logger.warn('Failed to send rescue-completed push', { error: err.message });
  }

  // Sprint 9 — Quest System: server-side "Complete 1 Rescue" progress, from
  // this authoritative success path only (never from the client-reported
  // outcome — see this function's own header comment on guard-battle
  // authority). Best-effort and never allowed to affect this already-
  // committed rescue.
  try {
    await questService.recordProgress(rescuerId, 'use_sos_rescue', 1);
  } catch (err) {
    logger.warn('Sprint 9 quest progress hook failed (best-effort, ignored)', { error: err.message, rescuerId });
  }

  return result;
}

module.exports = { acceptMission, startGuardBattle, resolveGuardBattle };
