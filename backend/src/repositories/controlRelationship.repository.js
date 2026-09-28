'use strict';

const db = require('../config/database');

/**
 * Sprint 8 correction (final pass) — all SQL touching `control_relationships`
 * (017_friends_sos_rescue_fcm.sql). This table is the authoritative,
 * explicitly queryable record of Control relationship IDENTITY — it does
 * NOT replace players.controller_id/controlled_since/controlled_until/
 * is_controlled, which remain the live-state columns player.repository.js's
 * isControlActive and creditsService's per-relationship Credits cap
 * already read. Every caller that changes Control state calls both: the
 * players-table function (unchanged) AND the matching function here, so a
 * relationship's stable UUID is always available for sos_requests to
 * reference.
 */

/**
 * Opens a new active incoming Control relationship. The partial unique
 * index (uniq_control_relationship_active_per_controlled) is the
 * database-level backstop for "one active incoming Control relationship
 * per player" — callers are expected to have already closed any existing
 * active relationship for this controlled player (see
 * closeActiveForControlled) in the SAME transaction, exactly like
 * applyIncomingControl overwrites players.controller_id unconditionally.
 */
async function create(controlledPlayerId, controllerId, sourceBattleId, endsAt, executor = db) {
  const result = await executor.query(
    `INSERT INTO control_relationships (controlled_player_id, controller_id, source_battle_id, ends_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [controlledPlayerId, controllerId, sourceBattleId || null, endsAt]
  );
  return result.rows[0];
}

/** The player's current active INCOMING relationship (they are the controlled party), if any. */
async function getActiveForPlayer(controlledPlayerId, executor = db) {
  const result = await executor.query(
    `SELECT * FROM control_relationships WHERE controlled_player_id = $1 AND status = 'active'`,
    [controlledPlayerId]
  );
  return result.rows[0] || null;
}

async function getById(controlRelationshipId, executor = db) {
  const result = await executor.query(`SELECT * FROM control_relationships WHERE control_relationship_id = $1`, [controlRelationshipId]);
  return result.rows[0] || null;
}

/**
 * Explicitly closes the controlled player's current active relationship
 * (if any) with a named reason — used by every end path: timer expiry,
 * rescue, voluntary release, administrative invalidation, or being
 * superseded by a fresh capture. A no-op (returns null) if there is no
 * active relationship to close, so it is safe to call defensively.
 */
async function closeActiveForControlled(controlledPlayerId, endReason, executor = db) {
  const result = await executor.query(
    `UPDATE control_relationships
     SET status = 'ended', ended_at = now(), end_reason = $2
     WHERE controlled_player_id = $1 AND status = 'active'
     RETURNING *`,
    [controlledPlayerId, endReason]
  );
  return result.rows[0] || null;
}

/**
 * Closes every active OUTGOING relationship a player currently holds AS A
 * CONTROLLER — used when that controller themselves suffers an eligible
 * battle loss (GDD: "release all active outgoing Control relationships").
 * Returns every relationship that was closed, for audit/notification.
 */
async function closeAllActiveForController(controllerId, endReason, executor = db) {
  const result = await executor.query(
    `UPDATE control_relationships
     SET status = 'ended', ended_at = now(), end_reason = $2
     WHERE controller_id = $1 AND status = 'active'
     RETURNING *`,
    [controllerId, endReason]
  );
  return result.rows;
}

module.exports = {
  create,
  getActiveForPlayer,
  getById,
  closeActiveForControlled,
  closeAllActiveForController,
};
