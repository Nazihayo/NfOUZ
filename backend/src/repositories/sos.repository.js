'use strict';

const db = require('../config/database');

/**
 * All SQL touching `sos_requests` (006_sos.sql) and `sos_notifications`
 * (017_friends_sos_rescue_fcm.sql) lives here.
 */

/** The player's currently open SOS, if any — "duplicate presses return existing SOS" reads this first. */
async function getOpenSosForPlayer(playerId, executor = db) {
  const result = await executor.query(
    `SELECT * FROM sos_requests WHERE player_id = $1 AND status = 'open'`,
    [playerId]
  );
  return result.rows[0] || null;
}

async function getById(sosId, executor = db) {
  const result = await executor.query(`SELECT * FROM sos_requests WHERE sos_id = $1`, [sosId]);
  return result.rows[0] || null;
}

/** Sprint 8 correction — locks the row for the duration of the caller's
 * transaction (SELECT ... FOR UPDATE), so concurrent rescue-accept
 * attempts for the same SOS are serialized by the database itself rather
 * than relying only on the application checking-then-writing. Must be
 * called inside db.withTransaction with the transaction's client passed
 * as `executor` — a lock taken outside a transaction is released
 * immediately and does nothing. */
async function lockForUpdate(sosId, executor = db) {
  const result = await executor.query(`SELECT * FROM sos_requests WHERE sos_id = $1 FOR UPDATE`, [sosId]);
  return result.rows[0] || null;
}

/**
 * Creates a new open SOS, stamped with a stable identifier of the
 * specific Control relationship it was raised for (Sprint 8 correction —
 * see sos.service.js for how `controlRelationshipId` is derived). Two
 * unique constraints can now fire on a race: the pre-existing partial
 * index (uniq_sos_open_per_player) and the new global
 * uniq_sos_per_control_relationship index — either way the service layer
 * catches the violation and treats it as "duplicate — return the
 * existing one" rather than a hard error.
 */
async function createSos(playerId, controlRelationshipId, executor = db) {
  const result = await executor.query(
    `INSERT INTO sos_requests (player_id, status, control_relationship_id) VALUES ($1, 'open', $2) RETURNING *`,
    [playerId, controlRelationshipId]
  );
  return result.rows[0];
}

async function markRescued(sosId, rescuerId, executor = db) {
  const result = await executor.query(
    `UPDATE sos_requests SET status = 'rescued', resolved_at = now(), rescuer_id = $2
     WHERE sos_id = $1 AND status = 'open'
     RETURNING *`,
    [sosId, rescuerId]
  );
  return result.rows[0] || null;
}

async function markExpired(sosId, executor = db) {
  const result = await executor.query(
    `UPDATE sos_requests SET status = 'expired', resolved_at = now()
     WHERE sos_id = $1 AND status = 'open'
     RETURNING *`,
    [sosId]
  );
  return result.rows[0] || null;
}

/**
 * Records that a friend was notified in a given batch, and whether the
 * push itself succeeded — audit trail, never blocks SOS creation. Sprint
 * 8 correction — `batchNumber` (1..3) supports re-announcing an SOS to
 * friends in up to three rounds; `failureCode` records fcm.service.js's
 * own failure reason (e.g. 'no_token') for audit, null on success.
 */
async function recordNotification(sosId, friendId, batchNumber, pushSuccess, failureCode, executor = db) {
  const result = await executor.query(
    `INSERT INTO sos_notifications (sos_id, friend_id, batch_number, push_success, failure_code)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (sos_id, friend_id, batch_number) DO NOTHING
     RETURNING *`,
    [sosId, friendId, batchNumber, pushSuccess, failureCode || null]
  );
  return result.rows[0] || null;
}

async function listNotifications(sosId, executor = db) {
  const result = await executor.query(`SELECT * FROM sos_notifications WHERE sos_id = $1 ORDER BY notified_at ASC`, [sosId]);
  return result.rows;
}

/**
 * Sprint 8 correction (final pass) — "Up to 3 notification rounds. Minimum
 * 15 minutes between rounds." A duplicate createSos call is what triggers
 * the next round (see sos.service.js), and it needs to know the highest
 * batch_number reached so far and when that round actually went out.
 */
async function getLatestNotificationRound(sosId, executor = db) {
  const result = await executor.query(
    `SELECT batch_number, MAX(notified_at) AS notified_at
     FROM sos_notifications
     WHERE sos_id = $1
     GROUP BY batch_number
     ORDER BY batch_number DESC
     LIMIT 1`,
    [sosId]
  );
  return result.rows[0] || null;
}

module.exports = {
  getOpenSosForPlayer,
  getById,
  lockForUpdate,
  createSos,
  markRescued,
  markExpired,
  recordNotification,
  listNotifications,
  getLatestNotificationRound,
};
