'use strict';

const db = require('../config/database');

/**
 * All SQL touching the `friendships` table (005_friendships.sql, extended
 * by 017_friends_sos_rescue_fcm.sql) lives here. A friendship is stored as
 * ONE directional row per pair (player_id, friend_id) — never two rows for
 * the same pair — so every query that means "either direction" explicitly
 * checks both (player_id=$a AND friend_id=$b) OR (player_id=$b AND
 * friend_id=$a) rather than relying on a second row existing.
 */

/**
 * The one row (if any) representing a relationship between two players,
 * regardless of which one is stored as player_id vs friend_id. Used to
 * decide what a new request should do: nothing exists yet (fresh
 * request), a pending request already exists (idempotent return), an
 * accepted friendship already exists (ALREADY_FRIENDS), or a block exists
 * (PLAYER_BLOCKED, direction-independent).
 */
async function getRelationshipBetween(playerIdA, playerIdB, executor = db) {
  const result = await executor.query(
    `SELECT * FROM friendships
     WHERE (player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1)
     LIMIT 1`,
    [playerIdA, playerIdB]
  );
  return result.rows[0] || null;
}

/**
 * Creates a new pending request, sender -> recipient. `expiresAt` is
 * computed by the caller (now + FRIEND_REQUEST_EXPIRY_DAYS) rather than in
 * SQL, so the exact expiry policy lives in one place (friend.service.js).
 */
async function createPendingRequest(senderId, recipientId, expiresAt, executor = db) {
  const result = await executor.query(
    `INSERT INTO friendships (player_id, friend_id, status, expires_at)
     VALUES ($1, $2, 'pending', $3)
     RETURNING *`,
    [senderId, recipientId, expiresAt]
  );
  return result.rows[0];
}

/**
 * The directional pending request row between an exact sender and
 * recipient (accept/decline always know both sides — the caller is always
 * the recipient, the other id is supplied by the request body but never
 * trusted for identity, only to name which request is being acted on).
 */
async function getPendingRequest(senderId, recipientId, executor = db) {
  const result = await executor.query(
    `SELECT * FROM friendships WHERE player_id = $1 AND friend_id = $2 AND status = 'pending'`,
    [senderId, recipientId]
  );
  return result.rows[0] || null;
}

/**
 * Accepts a pending request in place (no new row — the same directional
 * row simply changes status), stamping `accepted_at` for the SOS
 * "friendship age minimum 24 hours" rule. Guarded by `status = 'pending'`
 * so accepting twice (a race) is a no-op the second time — the caller
 * treats a null return as "no longer pending" (already accepted, expired,
 * or never existed).
 */
async function acceptRequest(senderId, recipientId, executor = db) {
  const result = await executor.query(
    `UPDATE friendships
     SET status = 'accepted', accepted_at = now(), updated_at = now()
     WHERE player_id = $1 AND friend_id = $2 AND status = 'pending'
     RETURNING *`,
    [senderId, recipientId]
  );
  return result.rows[0] || null;
}

/**
 * Deletes a pending request outright — used for both a decline (recipient
 * says no) and a cancel (sender withdraws it). There is no "declined"
 * status to keep around: once declined, sending a fresh request later is
 * simply a new row.
 */
async function deletePendingRequest(senderId, recipientId, executor = db) {
  const result = await executor.query(
    `DELETE FROM friendships WHERE player_id = $1 AND friend_id = $2 AND status = 'pending' RETURNING *`,
    [senderId, recipientId]
  );
  return result.rows[0] || null;
}

/**
 * Self-healing expiry, same pattern as player.repository.js's
 * clearExpiredControl: deletes ONE specific pending row only if it is both
 * still pending and already past its own expires_at. Safe to call
 * unconditionally before reading a request.
 */
async function deleteIfExpired(senderId, recipientId, executor = db) {
  const result = await executor.query(
    `DELETE FROM friendships
     WHERE player_id = $1 AND friend_id = $2 AND status = 'pending' AND expires_at <= now()
     RETURNING *`,
    [senderId, recipientId]
  );
  return result.rows[0] || null;
}

/** Removes an accepted friendship in whichever direction the row exists. */
async function removeFriend(playerIdA, playerIdB, executor = db) {
  const result = await executor.query(
    `DELETE FROM friendships
     WHERE ((player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1))
       AND status = 'accepted'
     RETURNING *`,
    [playerIdA, playerIdB]
  );
  return result.rows[0] || null;
}

/**
 * Blocking supersedes any prior relationship: any existing row between the
 * two players (either direction, any status) is removed first, then a
 * fresh 'blocked' row is inserted with the blocker as player_id. Runs as
 * two statements on the SAME executor — the caller wraps this in a
 * transaction when atomicity matters.
 */
async function blockPlayer(blockerId, blockedId, executor = db) {
  await executor.query(
    `DELETE FROM friendships WHERE (player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1)`,
    [blockerId, blockedId]
  );
  const result = await executor.query(
    `INSERT INTO friendships (player_id, friend_id, status) VALUES ($1, $2, 'blocked') RETURNING *`,
    [blockerId, blockedId]
  );
  return result.rows[0];
}

/** Only the original blocker can unblock — the row must have them as player_id. */
async function unblockPlayer(blockerId, blockedId, executor = db) {
  const result = await executor.query(
    `DELETE FROM friendships WHERE player_id = $1 AND friend_id = $2 AND status = 'blocked' RETURNING *`,
    [blockerId, blockedId]
  );
  return result.rows[0] || null;
}

/**
 * True if either player has blocked the other — "blocking works both
 * directions": B being blocked by A must also stop B from friending or
 * interacting with A, not just the reverse.
 */
async function isBlockedEitherDirection(playerIdA, playerIdB, executor = db) {
  const result = await executor.query(
    `SELECT 1 FROM friendships
     WHERE ((player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1))
       AND status = 'blocked'
     LIMIT 1`,
    [playerIdA, playerIdB]
  );
  return result.rows.length > 0;
}

/** Counts a player's accepted friendships regardless of which side of the row they're on — the Friend Limit = 100 gate. */
async function countAcceptedFriends(playerId, executor = db) {
  const result = await executor.query(
    `SELECT COUNT(*)::int AS count FROM friendships WHERE (player_id = $1 OR friend_id = $1) AND status = 'accepted'`,
    [playerId]
  );
  return result.rows[0].count;
}

/** Incoming pending requests (this player is friend_id), unexpired only. */
async function listIncomingPendingRequests(playerId, executor = db) {
  const result = await executor.query(
    `SELECT f.player_id AS sender_id, f.created_at, f.expires_at, p.username, p.class_type
     FROM friendships f
     JOIN players p ON p.player_id = f.player_id
     WHERE f.friend_id = $1 AND f.status = 'pending' AND f.expires_at > now()
     ORDER BY f.created_at DESC`,
    [playerId]
  );
  return result.rows;
}

/** Outgoing pending requests (this player is player_id), unexpired only. */
async function listOutgoingPendingRequests(playerId, executor = db) {
  const result = await executor.query(
    `SELECT f.friend_id AS recipient_id, f.created_at, f.expires_at, p.username, p.class_type
     FROM friendships f
     JOIN players p ON p.player_id = f.friend_id
     WHERE f.player_id = $1 AND f.status = 'pending' AND f.expires_at > now()
     ORDER BY f.created_at DESC`,
    [playerId]
  );
  return result.rows;
}

/** Full accepted friends list, resolving to the OTHER player's own row regardless of which side of the pair they're stored on. */
async function listAcceptedFriends(playerId, executor = db) {
  const result = await executor.query(
    `SELECT
       CASE WHEN f.player_id = $1 THEN f.friend_id ELSE f.player_id END AS friend_id,
       f.accepted_at,
       p.username,
       p.class_type
     FROM friendships f
     JOIN players p ON p.player_id = CASE WHEN f.player_id = $1 THEN f.friend_id ELSE f.player_id END
     WHERE (f.player_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'
     ORDER BY f.accepted_at DESC`,
    [playerId]
  );
  return result.rows;
}

/**
 * SOS recipient candidates: accepted friends whose friendship is at least
 * `minAgeHours` old, excluding anyone blocked (defensive — blocking
 * already deletes an accepted row, so this should never actually match,
 * but the SOS notification path double-checks it explicitly per the
 * requirement), ordered online-first (last_location_at >= onlineSince)
 * then most-recently-active. The caller (sos.service.js) applies the
 * top-10 cap — this returns every eligible candidate, in priority order.
 *
 * Sprint 8 correction — no longer selects a single fcm_token column
 * (players.fcm_token was replaced by the one-to-many player_devices
 * table); the caller looks up each candidate's active device tokens
 * separately via playerDevice.repository.js#getActiveTokens.
 */
async function getSosNotificationCandidates(playerId, minAgeHours, onlineSince, executor = db) {
  const result = await executor.query(
    `SELECT
       CASE WHEN f.player_id = $1 THEN f.friend_id ELSE f.player_id END AS friend_id,
       p.username,
       p.last_location_at,
       (p.last_location_at IS NOT NULL AND p.last_location_at >= $3) AS is_online
     FROM friendships f
     JOIN players p ON p.player_id = CASE WHEN f.player_id = $1 THEN f.friend_id ELSE f.player_id END
     WHERE (f.player_id = $1 OR f.friend_id = $1)
       AND f.status = 'accepted'
       AND f.accepted_at IS NOT NULL
       AND f.accepted_at <= now() - ($2 || ' hours')::interval
       AND NOT EXISTS (
         SELECT 1 FROM friendships b
         WHERE b.status = 'blocked'
           AND (
             (b.player_id = $1 AND b.friend_id = CASE WHEN f.player_id = $1 THEN f.friend_id ELSE f.player_id END) OR
             (b.friend_id = $1 AND b.player_id = CASE WHEN f.player_id = $1 THEN f.friend_id ELSE f.player_id END)
           )
       )
     ORDER BY is_online DESC, p.last_location_at DESC NULLS LAST`,
    [playerId, minAgeHours, onlineSince]
  );
  return result.rows;
}

module.exports = {
  getRelationshipBetween,
  createPendingRequest,
  getPendingRequest,
  acceptRequest,
  deletePendingRequest,
  deleteIfExpired,
  removeFriend,
  blockPlayer,
  unblockPlayer,
  isBlockedEitherDirection,
  countAcceptedFriends,
  listIncomingPendingRequests,
  listOutgoingPendingRequests,
  listAcceptedFriends,
  getSosNotificationCandidates,
};
