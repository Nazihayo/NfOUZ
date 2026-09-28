'use strict';

const env = require('../config/env');
const db = require('../config/database');
const sosRepo = require('../repositories/sos.repository');
const friendRepo = require('../repositories/friend.repository');
const playerRepo = require('../repositories/player.repository');
const playerDeviceRepo = require('../repositories/playerDevice.repository');
const controlRelationshipRepo = require('../repositories/controlRelationship.repository');
const friendService = require('./friend.service');
const fcmService = require('./fcm.service');
const logger = require('../utils/logger');
const { ApiError } = require('../utils/responseEnvelope');

const UNIQUE_VIOLATION = '23505';

/**
 * Sprint 8 — SOS system. "No exact coordinates in notifications" holds
 * throughout: only sos_id, the requester's username, and (for rescue
 * notifications) the rescuer's username are ever handed to fcmService —
 * never a lat/lng, never a full player row.
 *
 * Sprint 8 correction (final pass) — every SOS now references a
 * `control_relationship_id` UUID that names the specific, authoritative
 * control_relationships row it was raised for (replacing the earlier
 * synthetic string identifier derived from controller_id/controlled_since).
 * A player who is currently Controlled (isControlActive) is expected to
 * have exactly one active control_relationships row — see
 * controlRelationship.repository.js and battle.service.js/
 * player.repository.js for every place that opens/closes one.
 */

/**
 * Self-heals an SOS whose target is no longer actually Controlled (the
 * Control window expired naturally while the SOS sat open) — there is
 * nothing left to rescue, so the SOS is closed as 'expired' rather than
 * left open forever. Safe to call on every read. `executor` threads a
 * transaction client through when called from inside a locked
 * transaction (see getByIdForUpdate) — otherwise defaults to the pool.
 */
async function expireIfControlEnded(sos, executor = db) {
  if (sos.status !== 'open') {
    return sos;
  }

  const target = await playerRepo.getById(sos.player_id, executor);
  if (target && playerRepo.isControlActive(target)) {
    return sos;
  }

  const expired = await sosRepo.markExpired(sos.sos_id, executor);
  return expired || sos;
}

async function getById(sosId) {
  const sos = await sosRepo.getById(sosId);
  if (!sos) {
    throw new ApiError('SOS_NOT_FOUND', 'No SOS request exists with this id.', 404);
  }
  return expireIfControlEnded(sos);
}

/**
 * Sprint 8 Critical Security Patch — "Prevent SOS IDOR": GET /sos/:sosId
 * used to hand back the full SOS record to any authenticated caller who
 * knew (or guessed, or found in a log) the sos_id, with no ownership check
 * at all. Now allowed only for:
 *   - the SOS's own owner,
 *   - the player already recorded as its rescuer (sos.rescuer_id, set once
 *     a rescue succeeds), or
 *   - an eligible friend of the owner (the same accepted+aged+not-blocked
 *     rule rescue.service.js#acceptMission enforces — see
 *     friend.service.js#assertEligibleRescueFriendship), since an eligible
 *     friend is exactly who is allowed to see and act on this SOS at all.
 * Everyone else gets NOT_ELIGIBLE_FRIEND/PLAYER_BLOCKED/FRIENDSHIP_TOO_NEW
 * (403), never the SOS contents.
 */
async function assertCanViewSos(sos, viewerId) {
  if (sos.player_id === viewerId || sos.rescuer_id === viewerId) {
    return;
  }
  await friendService.assertEligibleRescueFriendship(viewerId, sos.player_id);
}

/**
 * Same lookup as getById, but locks the row with SELECT ... FOR UPDATE
 * inside the CALLER's transaction (`client`), so rescue.service.js#acceptMission
 * can serialize concurrent accepts for the same SOS at the database level
 * instead of relying only on an application-level check-then-write (see
 * rescue_missions' own partial unique index, which remains as a
 * defense-in-depth backstop).
 */
async function getByIdForUpdate(sosId, client) {
  const sos = await sosRepo.lockForUpdate(sosId, client);
  if (!sos) {
    throw new ApiError('SOS_NOT_FOUND', 'No SOS request exists with this id.', 404);
  }
  return expireIfControlEnded(sos, client);
}

/** Sends one notification round (1..3) to up to SOS_MAX_NOTIFIED_FRIENDS eligible friends. */
async function notifyFriends(sos, requesterUsername, batchNumber) {
  const onlineSince = new Date(Date.now() - env.NEARBY_ONLINE_THRESHOLD_SECONDS * 1000);
  const candidates = await friendRepo.getSosNotificationCandidates(sos.player_id, env.SOS_FRIENDSHIP_MIN_AGE_HOURS, onlineSince);
  const toNotify = candidates.slice(0, env.SOS_MAX_NOTIFIED_FRIENDS);

  return Promise.all(
    toNotify.map(async (friend) => {
      let pushResult;
      try {
        const tokens = await playerDeviceRepo.getActiveTokens(friend.friend_id);
        pushResult = await fcmService.sendToAllDevices(tokens, (token) =>
          fcmService.sendSosNotification(token, { sosId: sos.sos_id, requesterUsername })
        );
      } catch (err) {
        // fcmService itself never throws, but this stays defensive —
        // a notification failure must never fail SOS creation.
        logger.warn('Unexpected error sending SOS push', { error: err.message });
        pushResult = { success: false, reason: 'internal_error' };
      }

      try {
        await sosRepo.recordNotification(sos.sos_id, friend.friend_id, batchNumber, pushResult.success, pushResult.reason);
      } catch (err) {
        logger.warn('Failed to record SOS notification audit row', { error: err.message });
      }

      return friend.friend_id;
    })
  );
}

/**
 * Creates a new SOS for the caller. Requires the caller to be CURRENTLY
 * Controlled ("SOS Without Control" is rejected). A repeated call while an
 * SOS is already open returns the existing SOS — and, per the final
 * correction spec, ALSO triggers the next notification round when one is
 * due (round < SOS_MAX_NOTIFICATION_ROUNDS and at least
 * SOS_NOTIFICATION_ROUND_MIN_INTERVAL_MINUTES have passed since the last
 * round actually went out). A repeat that is not yet due for another
 * round is a pure no-op read, same as before this correction.
 */
async function createSos(playerId) {
  const player = await playerRepo.getById(playerId);
  if (!player) {
    throw new ApiError('PLAYER_NOT_FOUND', 'Player does not exist.', 404);
  }

  if (!playerRepo.isControlActive(player)) {
    throw new ApiError('SOS_REQUIRES_CONTROL', 'You must be currently Controlled to call an SOS.', 403);
  }

  const existingOpen = await sosRepo.getOpenSosForPlayer(playerId);
  if (existingOpen) {
    const latestRound = await sosRepo.getLatestNotificationRound(existingOpen.sos_id);
    const currentBatch = latestRound ? latestRound.batch_number : 0;
    const dueForNextRound =
      currentBatch < env.SOS_MAX_NOTIFICATION_ROUNDS &&
      (!latestRound ||
        Date.now() - new Date(latestRound.notified_at).getTime() >= env.SOS_NOTIFICATION_ROUND_MIN_INTERVAL_MINUTES * 60 * 1000);

    if (!dueForNextRound) {
      return { sos: existingOpen, duplicate: true, notified_friend_ids: [] };
    }

    const notifiedFriendIds = await notifyFriends(existingOpen, player.username, currentBatch + 1);
    return { sos: existingOpen, duplicate: true, notified_friend_ids: notifiedFriendIds };
  }

  const activeRelationship = await controlRelationshipRepo.getActiveForPlayer(playerId);
  if (!activeRelationship) {
    // isControlActive(player) is true (checked above), so a missing
    // control_relationships row here means the two records have drifted
    // out of sync — a data-integrity problem, not a normal user error.
    throw new ApiError(
      'CONTROL_RELATIONSHIP_NOT_FOUND',
      'No active Control relationship record exists for this player.',
      409
    );
  }

  let sos;
  try {
    sos = await sosRepo.createSos(playerId, activeRelationship.control_relationship_id);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      // Lost a race to another concurrent SOS create (either the
      // per-player or the per-control-relationship unique index) — the
      // winner's row is the one that matters; return it exactly like a
      // normal duplicate.
      const raceWinner = await sosRepo.getOpenSosForPlayer(playerId);
      if (raceWinner) {
        return { sos: raceWinner, duplicate: true, notified_friend_ids: [] };
      }
    }
    throw err;
  }

  const notifiedFriendIds = await notifyFriends(sos, player.username, 1);
  return { sos, duplicate: false, notified_friend_ids: notifiedFriendIds };
}

module.exports = { createSos, getById, getByIdForUpdate, expireIfControlEnded, assertCanViewSos };
