'use strict';

const db = require('../config/database');
const env = require('../config/env');
const friendRepo = require('../repositories/friend.repository');
const playerRepo = require('../repositories/player.repository');
const { ApiError } = require('../utils/responseEnvelope');
const questService = require('./quest.service'); // Sprint 9 — best-effort quest progress hook only, see acceptFriendRequest below.
const logger = require('../utils/logger');

/**
 * Sprint 8 — Friends system. Identity is always the authenticated caller's
 * own player row, resolved via Firebase uid by the controller — every
 * function here takes player_ids that have already been validated to
 * belong to the request, never a client-asserted "who am I" value.
 */

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function assertNotBlocked(playerIdA, playerIdB) {
  if (await friendRepo.isBlockedEitherDirection(playerIdA, playerIdB)) {
    throw new ApiError('PLAYER_BLOCKED', 'This player cannot be interacted with.', 403);
  }
}

async function getPlayerOrThrow(playerId) {
  const player = await playerRepo.getById(playerId);
  if (!player) {
    throw new ApiError('PLAYER_NOT_FOUND', 'Player does not exist.', 404);
  }
  return player;
}

/**
 * Sprint 8 Critical Security Patch — the ONE eligibility gate for
 * "may playerA rescue playerB": an ACCEPTED friendship that is at least
 * SOS_FRIENDSHIP_MIN_AGE_HOURS old, with neither side blocking the other.
 * This is the exact rule sos.service.js#notifyFriends already applies when
 * deciding who even gets notified of an SOS (getSosNotificationCandidates)
 * — rescue.service.js#acceptMission and sos.service.js#assertCanViewSos
 * both now enforce it explicitly server-side too, instead of relying on
 * "you'd only know the sos_id if we notified you" as a de facto
 * authorization boundary (that was never real authorization — an sos_id
 * can leak through logs, a shared screenshot, or simply being guessed).
 *
 * Checked in this specific order so the error tells the truth about which
 * condition actually failed, rather than collapsing every case into one
 * generic 403:
 *   1. Either direction blocked -> PLAYER_BLOCKED.
 *   2. No accepted friendship between the two at all -> NOT_ELIGIBLE_FRIEND.
 *   3. An accepted friendship exists but is younger than the minimum age
 *      -> FRIENDSHIP_TOO_NEW.
 *
 * `executor` lets a caller (rescue.service.js#acceptMission) run this
 * inside its own transaction/row-locked client so the check participates
 * in the same atomic unit as the rest of the accept — it defaults to the
 * plain pool connection for callers (sos.service.js's view-authorization
 * check) that have no surrounding transaction of their own.
 */
async function assertEligibleRescueFriendship(playerIdA, playerIdB, executor = db) {
  if (await friendRepo.isBlockedEitherDirection(playerIdA, playerIdB, executor)) {
    throw new ApiError('PLAYER_BLOCKED', 'This player cannot be interacted with.', 403);
  }

  const relationship = await friendRepo.getRelationshipBetween(playerIdA, playerIdB, executor);
  if (!relationship || relationship.status !== 'accepted' || !relationship.accepted_at) {
    throw new ApiError('NOT_ELIGIBLE_FRIEND', 'You must be an accepted friend of this player to do this.', 403);
  }

  const minAgeMs = env.SOS_FRIENDSHIP_MIN_AGE_HOURS * 60 * 60 * 1000;
  const ageMs = Date.now() - new Date(relationship.accepted_at).getTime();
  if (ageMs < minAgeMs) {
    throw new ApiError(
      'FRIENDSHIP_TOO_NEW',
      `Friendship must be at least ${env.SOS_FRIENDSHIP_MIN_AGE_HOURS} hours old for this action.`,
      403
    );
  }

  return relationship;
}

/**
 * Sends a friend request. Idempotent: a repeat call while a request from
 * this same sender is already pending simply returns that same request
 * rather than erroring or creating a duplicate row (the friendships table
 * has no unique constraint that would even allow a duplicate — this is an
 * explicit application-level check). If the RECIPIENT had already sent a
 * pending request to this caller, this call accepts that existing request
 * instead of creating a second, opposite-direction one — mutual intent to
 * be friends should just make them friends, not deadlock on direction.
 */
async function sendFriendRequest(senderId, recipientId) {
  if (senderId === recipientId) {
    throw new ApiError('INVALID_FRIEND_REQUEST', 'You cannot send a friend request to yourself.', 400);
  }

  await getPlayerOrThrow(recipientId);
  await assertNotBlocked(senderId, recipientId);

  // Self-heal a stale pending row in either direction before deciding.
  await friendRepo.deleteIfExpired(senderId, recipientId);
  await friendRepo.deleteIfExpired(recipientId, senderId);

  const existing = await friendRepo.getRelationshipBetween(senderId, recipientId);

  if (existing) {
    if (existing.status === 'blocked') {
      throw new ApiError('PLAYER_BLOCKED', 'This player cannot be interacted with.', 403);
    }

    if (existing.status === 'accepted') {
      throw new ApiError('ALREADY_FRIENDS', 'You are already friends with this player.', 409);
    }

    // status === 'pending'
    if (existing.player_id === senderId) {
      // Idempotent — the exact same request already exists.
      return existing;
    }

    // The recipient had already sent US a request — mutual intent, accept it now.
    return acceptFriendRequest(senderId, recipientId);
  }

  const senderFriendCount = await friendRepo.countAcceptedFriends(senderId);
  if (senderFriendCount >= env.FRIEND_LIMIT) {
    throw new ApiError('FRIEND_LIMIT_REACHED', `You already have ${env.FRIEND_LIMIT} friends.`, 409);
  }

  return friendRepo.createPendingRequest(senderId, recipientId, daysFromNow(env.FRIEND_REQUEST_EXPIRY_DAYS));
}

/**
 * Accepts a pending request. `recipientId` is always the authenticated
 * caller; `senderId` names which incoming request to act on. Enforces the
 * Friend Limit for BOTH sides, since accepting adds a friend slot to each.
 */
async function acceptFriendRequest(recipientId, senderId) {
  await friendRepo.deleteIfExpired(senderId, recipientId);

  const pending = await friendRepo.getPendingRequest(senderId, recipientId);
  if (!pending) {
    throw new ApiError('FRIEND_REQUEST_NOT_FOUND', 'No pending friend request from this player.', 404);
  }

  await assertNotBlocked(senderId, recipientId);

  const [senderCount, recipientCount] = await Promise.all([
    friendRepo.countAcceptedFriends(senderId),
    friendRepo.countAcceptedFriends(recipientId),
  ]);

  if (senderCount >= env.FRIEND_LIMIT || recipientCount >= env.FRIEND_LIMIT) {
    throw new ApiError('FRIEND_LIMIT_REACHED', `One of you already has ${env.FRIEND_LIMIT} friends.`, 409);
  }

  const accepted = await friendRepo.acceptRequest(senderId, recipientId);
  if (!accepted) {
    // Lost a race (e.g. the request expired or was accepted/declined
    // between the read above and this write).
    throw new ApiError('FRIEND_REQUEST_NOT_FOUND', 'No pending friend request from this player.', 404);
  }

  // Sprint 9 — Quest System: server-side "Add 1 Friend" progress for the
  // accepter only (keeps this hook minimal, per the spec). Best-effort and
  // never allowed to affect this already-committed friend acceptance.
  try {
    await questService.recordProgress(recipientId, 'add_friend', 1);
  } catch (err) {
    logger.warn('Sprint 9 quest progress hook failed (best-effort, ignored)', { error: err.message, recipientId });
  }

  return accepted;
}

/** Declines (deletes) a pending incoming request. `recipientId` is the caller. */
async function declineFriendRequest(recipientId, senderId) {
  const declined = await friendRepo.deletePendingRequest(senderId, recipientId);
  if (!declined) {
    throw new ApiError('FRIEND_REQUEST_NOT_FOUND', 'No pending friend request from this player.', 404);
  }
  return { declined: true };
}

/** Removes an existing accepted friendship, in whichever direction it's stored. */
async function removeFriend(playerId, friendId) {
  const removed = await friendRepo.removeFriend(playerId, friendId);
  if (!removed) {
    throw new ApiError('NOT_FRIENDS', 'You are not friends with this player.', 404);
  }
  return { removed: true };
}

/**
 * Blocks a player. Supersedes any prior friendship/pending request between
 * the two (friendRepo.blockPlayer deletes it first) — runs inside a
 * transaction so the delete-then-insert is atomic.
 */
async function blockPlayer(blockerId, blockedId) {
  if (blockerId === blockedId) {
    throw new ApiError('INVALID_BLOCK', 'You cannot block yourself.', 400);
  }

  await getPlayerOrThrow(blockedId);

  return db.withTransaction((client) => friendRepo.blockPlayer(blockerId, blockedId, client));
}

/** Unblocks a player — only the original blocker may do this. */
async function unblockPlayer(blockerId, blockedId) {
  const unblocked = await friendRepo.unblockPlayer(blockerId, blockedId);
  if (!unblocked) {
    throw new ApiError('NOT_BLOCKED', 'You have not blocked this player.', 404);
  }
  return { unblocked: true };
}

/** Returns both directions of pending requests for the caller. */
async function listPendingRequests(playerId) {
  const [incoming, outgoing] = await Promise.all([
    friendRepo.listIncomingPendingRequests(playerId),
    friendRepo.listOutgoingPendingRequests(playerId),
  ]);
  return { incoming, outgoing };
}

async function listFriends(playerId) {
  return friendRepo.listAcceptedFriends(playerId);
}

module.exports = {
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  blockPlayer,
  unblockPlayer,
  listPendingRequests,
  listFriends,
  assertEligibleRescueFriendship,
};
