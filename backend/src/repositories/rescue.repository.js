'use strict';

const db = require('../config/database');

/**
 * All SQL touching `rescue_missions` and `rescue_rewards`
 * (017_friends_sos_rescue_fcm.sql) lives here.
 *
 * Sprint 8 correction:
 *   - createReservation/startGuardBattle now compute their own deadlines
 *     from the DATABASE's `now()` (via `now() + interval`) rather than a
 *     JS-computed Date passed in, so they can never violate the new
 *     `reservation_expires_at > reserved_at` /
 *     `guard_battle_ends_at > guard_battle_started_at` CHECK constraints
 *     over any app/DB clock skew.
 *   - createReservation also records attempt_number/idempotency_key —
 *     see rescue.service.js#acceptMission for how these are derived.
 *   - expireReservationIfDue/expireGuardBattleIfDue/failMission now record
 *     `failure_reason` for audit.
 *   - recordReward/countRewardsSince/hasRecentRewardForTarget now go
 *     through the redesigned rescue_rewards ledger (one row per resolved
 *     successful mission, `rewarded` true/false) rather than "a row only
 *     exists when a reward was actually granted".
 *   - lockRescuerForRewardCheck adds a real, transactional advisory lock
 *     so the reward-cap/cooldown check-then-write in resolveGuardBattle is
 *     serialized per rescuer at the database level, not only by
 *     application logic.
 */

async function getMissionById(missionId, executor = db) {
  const result = await executor.query(`SELECT * FROM rescue_missions WHERE mission_id = $1`, [missionId]);
  return result.rows[0] || null;
}

async function getActiveMissionForSos(sosId, executor = db) {
  const result = await executor.query(
    `SELECT * FROM rescue_missions WHERE sos_id = $1 AND status IN ('reserved', 'in_progress')`,
    [sosId]
  );
  return result.rows[0] || null;
}

/** Every mission (any status) ever created for this SOS — used only to
 * compute the next attempt_number. Safe to call unlocked when the caller
 * already holds the SOS row's FOR UPDATE lock (see
 * sos.repository.js#lockForUpdate), which serializes concurrent callers
 * for the same sos_id and makes this count race-free. */
async function countMissionsForSos(sosId, executor = db) {
  const result = await executor.query(`SELECT COUNT(*)::int AS count FROM rescue_missions WHERE sos_id = $1`, [sosId]);
  return result.rows[0].count;
}

/**
 * Reserves a mission. The partial unique index
 * (uniq_rescue_mission_active_per_sos) remains a database-level backstop
 * for "first accepted rescuer reserves mission" — this insert throws a
 * unique-violation (code 23505) for every caller except the winner of a
 * race that somehow reaches here without the SOS row lock already having
 * serialized them (see rescue.service.js#acceptMission, which takes that
 * lock as the PRIMARY mechanism now, per the Sprint 8 correction).
 * `idempotencyKey` is UNIQUE — a byte-for-byte retried accept call (same
 * sos/rescuer/attempt) is therefore also idempotent at the database level.
 */
async function createReservation(sosId, rescuerId, attemptNumber, idempotencyKey, reservationTimeoutSeconds, executor = db) {
  const result = await executor.query(
    `INSERT INTO rescue_missions (sos_id, rescuer_id, status, attempt_number, idempotency_key, reserved_at, reservation_expires_at)
     VALUES ($1, $2, 'reserved', $3, $4, now(), now() + ($5 || ' seconds')::interval)
     RETURNING *`,
    [sosId, rescuerId, attemptNumber, idempotencyKey, reservationTimeoutSeconds]
  );
  return result.rows[0];
}

/** Reservation -> Guard Battle. Guarded by both status AND an unexpired
 * reservation. `guardBattleDurationSeconds` is applied as a DB-side
 * interval so guard_battle_ends_at is always strictly after
 * guard_battle_started_at (both computed from the same `now()`), never
 * two separately-computed app-side Dates.
 *
 * Sprint 8 Critical Security Patch — also stamps the one-time
 * `guardBattleToken` the client must echo back to resolve this battle, and
 * the AUTHORITATIVE `guardBattleOutcome` decided by the server right now
 * (see rescue.service.js#startGuardBattle) — never derived from, or
 * revealed in, anything sent back to the client. */
async function startGuardBattle(missionId, guardBattleDurationSeconds, guardBattleToken, guardBattleOutcome, executor = db) {
  const result = await executor.query(
    `UPDATE rescue_missions
     SET status = 'in_progress',
         guard_battle_started_at = now(),
         guard_battle_ends_at = now() + ($2 || ' seconds')::interval,
         guard_battle_token = $3,
         guard_battle_outcome = $4
     WHERE mission_id = $1 AND status = 'reserved' AND reservation_expires_at > now()
     RETURNING *`,
    [missionId, guardBattleDurationSeconds, guardBattleToken, guardBattleOutcome]
  );
  return result.rows[0] || null;
}

/** Self-healing: releases ONE mission's reservation if it's both still 'reserved' and past its own timeout. */
async function expireReservationIfDue(missionId, executor = db) {
  const result = await executor.query(
    `UPDATE rescue_missions
     SET status = 'expired', resolved_at = now(), failure_reason = 'reservation_timeout'
     WHERE mission_id = $1 AND status = 'reserved' AND reservation_expires_at <= now()
     RETURNING *`,
    [missionId]
  );
  return result.rows[0] || null;
}

/** Self-healing: a guard battle that ran past its own end time without a reported outcome counts as a failure (the guard held). */
async function expireGuardBattleIfDue(missionId, executor = db) {
  const result = await executor.query(
    `UPDATE rescue_missions
     SET status = 'failed', resolved_at = now(), failure_reason = 'guard_battle_timeout'
     WHERE mission_id = $1 AND status = 'in_progress' AND guard_battle_ends_at <= now()
     RETURNING *`,
    [missionId]
  );
  return result.rows[0] || null;
}

/**
 * Sprint 8 Critical Security Patch — the WHERE clause now also requires
 * `guard_battle_token = $2`, the exact one-time token issued by
 * startGuardBattle: a stale, forged, or already-used token can never
 * match (replay/duplicate protection), and this UPDATE returns null just
 * like the pre-existing `status = 'in_progress'` guard already did for a
 * mission resolved twice. `guard_battle_token` is cleared to NULL on the
 * same write so it can never be reused even in principle.
 * `reportedOutcome`/`outcomeMismatch` persist the client's own claim and
 * whether it disagreed with the authoritative result, for audit.
 */
async function succeedMission(missionId, guardBattleToken, reportedOutcome, outcomeMismatch, executor = db) {
  const result = await executor.query(
    `UPDATE rescue_missions
     SET status = 'succeeded', resolved_at = now(), guard_battle_token = NULL,
         reported_outcome = $3, outcome_mismatch = $4
     WHERE mission_id = $1 AND status = 'in_progress' AND guard_battle_token = $2
     RETURNING *`,
    [missionId, guardBattleToken, reportedOutcome, outcomeMismatch]
  );
  return result.rows[0] || null;
}

/**
 * Sprint 8 correction (final pass) — "Failed attempt cooldown is 10
 * minutes": the most recent FAILED mission for this sos_id, if any, so
 * rescue.service.js#acceptMission can reject a new attempt until 10
 * minutes have passed since that failure's resolved_at. Uses
 * idx_rescue_missions_sos_failed_resolved.
 */
async function getMostRecentFailureForSos(sosId, executor = db) {
  const result = await executor.query(
    `SELECT * FROM rescue_missions
     WHERE sos_id = $1 AND status = 'failed'
     ORDER BY resolved_at DESC
     LIMIT 1`,
    [sosId]
  );
  return result.rows[0] || null;
}

/**
 * Same token-based replay/duplicate guard as succeedMission — see its doc
 * comment. `guardBattleToken`/`reportedOutcome`/`outcomeMismatch` are
 * OPTIONAL (default null/false) because this is also called by the
 * self-healing guard-battle-timeout path (rescue.service.js's
 * selfHealMission -> expireGuardBattleIfDue is the actual timeout path;
 * this function itself is only ever invoked directly from
 * resolveGuardBattle's client-reported-failure branch, so the token is
 * always supplied there) — the defaults exist purely so a future caller
 * that resolves a failure without a client report (e.g. an admin
 * invalidation) does not need to fabricate one.
 */
async function failMission(missionId, failureReason, guardBattleToken = null, reportedOutcome = null, outcomeMismatch = false, executor = db) {
  const result = await executor.query(
    `UPDATE rescue_missions
     SET status = 'failed', resolved_at = now(), failure_reason = $2, guard_battle_token = NULL,
         reported_outcome = $4, outcome_mismatch = $5
     WHERE mission_id = $1 AND status = 'in_progress' AND ($3::varchar IS NULL OR guard_battle_token = $3)
     RETURNING *`,
    [missionId, failureReason || null, guardBattleToken, reportedOutcome, outcomeMismatch]
  );
  return result.rows[0] || null;
}

/** Serializes the reward-cap/cooldown check-then-write for one rescuer
 * within the CALLER's transaction — must be called with the transaction's
 * client as `executor`, same requirement as sos.repository.js#lockForUpdate.
 * hashtext() keeps the lock key within Postgres's advisory-lock int4/int8
 * range regardless of the UUID's own width. */
async function lockRescuerForRewardCheck(rescuerId, executor = db) {
  await executor.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [rescuerId]);
}

/**
 * Records the reward OUTCOME of a resolved successful mission — always
 * called exactly once per mission (UNIQUE(mission_id) enforces that),
 * whether or not a reward was actually granted, so the ledger is a
 * complete audit trail rather than only recording actual grants.
 */
async function recordReward(rescuerId, targetPlayerId, missionId, rewarded, creditsGranted, xpGranted, rewardReason, idempotencyKey, executor = db) {
  const result = await executor.query(
    `INSERT INTO rescue_rewards (rescuer_id, target_player_id, mission_id, rewarded, credits_granted, xp_granted, reward_reason, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [rescuerId, targetPlayerId, missionId, rewarded, creditsGranted, xpGranted, rewardReason, idempotencyKey]
  );
  return result.rows[0];
}

/** "3 rewarded rescues per UTC day" — counted from `dayStart` (caller passes UTC midnight). Only ACTUAL grants (rewarded = TRUE) count. */
async function countRewardsSince(rescuerId, dayStart, executor = db) {
  const result = await executor.query(
    `SELECT COUNT(*)::int AS count FROM rescue_rewards WHERE rescuer_id = $1 AND rewarded = TRUE AND credited_at >= $2`,
    [rescuerId, dayStart]
  );
  return result.rows[0].count;
}

/** "Same target only rewarded once every 24 hours" — for this exact rescuer/target pair, ACTUAL grants only. */
async function hasRecentRewardForTarget(rescuerId, targetPlayerId, since, executor = db) {
  const result = await executor.query(
    `SELECT 1 FROM rescue_rewards WHERE rescuer_id = $1 AND target_player_id = $2 AND rewarded = TRUE AND credited_at >= $3 LIMIT 1`,
    [rescuerId, targetPlayerId, since]
  );
  return result.rows.length > 0;
}

module.exports = {
  getMissionById,
  getActiveMissionForSos,
  countMissionsForSos,
  getMostRecentFailureForSos,
  createReservation,
  startGuardBattle,
  expireReservationIfDue,
  expireGuardBattleIfDue,
  succeedMission,
  failMission,
  lockRescuerForRewardCheck,
  recordReward,
  countRewardsSince,
  hasRecentRewardForTarget,
};
