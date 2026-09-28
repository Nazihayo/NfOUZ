'use strict';

const db = require('../config/database');

/**
 * All SQL touching the `credit_transfers` table (016_control_protection_
 * credits.sql) lives here — the Control economy's auditable ledger of
 * every Credits cut a controller has ever received from a controlled
 * player's eligible income. See creditsService.js#applyEligibleIncome for
 * the accounting rules this data supports.
 */

/**
 * Looks up a previously-recorded transfer by its idempotency reference.
 * The `idempotency_reference` column is UNIQUE at the database level —
 * that constraint, not this lookup, is what actually guarantees "a
 * duplicate income event does not transfer twice" under concurrent
 * calls; this lookup lets the service short-circuit and return the
 * existing result instead of racing the UNIQUE constraint and having to
 * handle its violation as an error on every retry.
 */
async function getByIdempotencyReference(idempotencyReference, executor = db) {
  const result = await executor.query(
    `SELECT * FROM credit_transfers WHERE idempotency_reference = $1`,
    [idempotencyReference]
  );
  return result.rows[0] || null;
}

/**
 * Sums every transfer for one specific controller/controlled pair since
 * `since` (player.repository.js's `controlled_since`, the timestamp the
 * CURRENT Control relationship began) — this is what scopes the "max 100
 * Credits transferred per Control relationship" cap to only the present
 * capture, not a lifetime total across every past capture of the same
 * two players.
 */
async function sumRelationshipTransfers(controllerId, controlledId, since, executor = db) {
  const result = await executor.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM credit_transfers
     WHERE controller_id = $1 AND controlled_id = $2 AND created_at >= $3`,
    [controllerId, controlledId, since]
  );
  return Number(result.rows[0].total);
}

/**
 * Sums every transfer a controller has RECEIVED since `dayStart` (the
 * caller passes UTC midnight) — enforces the "maximum 200 Credits
 * received by one controller per UTC day" cap across ALL of that
 * controller's relationships combined, not per-relationship.
 */
async function sumControllerDayTransfers(controllerId, dayStart, executor = db) {
  const result = await executor.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM credit_transfers
     WHERE controller_id = $1 AND created_at >= $2`,
    [controllerId, dayStart]
  );
  return Number(result.rows[0].total);
}

/**
 * Records one transfer. `amount` may legitimately be 0 (every cap
 * exhausted, so the controlled player keeps the entire eligible income)
 * — a 0-amount row is still inserted so the idempotency reference is
 * consumed and the whole income event, not just a nonzero cut, can never
 * be double-applied.
 */
async function insertTransfer({ controllerId, controlledId, amount, sourceIncomeAmount, idempotencyReference }, executor = db) {
  const result = await executor.query(
    `INSERT INTO credit_transfers
       (controller_id, controlled_id, amount, source_income_amount, idempotency_reference)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [controllerId, controlledId, amount, sourceIncomeAmount, idempotencyReference]
  );
  return result.rows[0];
}

module.exports = {
  getByIdempotencyReference,
  sumRelationshipTransfers,
  sumControllerDayTransfers,
  insertTransfer,
};
