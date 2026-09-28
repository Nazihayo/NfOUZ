'use strict';

const db = require('../config/database');
const playerRepo = require('../repositories/player.repository');
const creditTransferRepo = require('../repositories/creditTransfer.repository');
const { ApiError } = require('../utils/responseEnvelope');

/**
 * Sprint 7 continuation — Control economy foundation (GDD section 5).
 *
 * SCOPE: per the explicit instruction ("If the currency system is not yet
 * implemented, create only the database/service foundation and tests. Do
 * not invent a full shop or economy"), this file is the ONE entry point a
 * future Credits-income event (a quest reward, a contribution payout,
 * etc. — none of which exist yet) would call. There is no shop, no HTTP
 * route, and no other Credits-earning flow here — only the accounting
 * rule that must apply whenever eligible income lands on a currently-
 * Controlled player.
 *
 * "Eligible" income is exactly what the GDD's exclusion list allows to be
 * taxed. Everything else in that list — Influence, XP, paid currency,
 * battle rewards, rescue rewards, administrative grants, Battle Pass
 * rewards — must never reach this function at all; enforcing that is the
 * responsibility of whatever future caller decides a given event is
 * "eligible Credits income," not of applyEligibleIncome itself, since
 * this function has no way to know an amount's origin beyond the
 * `sourceType` label the caller supplies for audit purposes.
 *
 * IDEMPOTENCY SCOPE NOTE (honest limitation, not silently glossed over):
 * `credit_transfers.idempotency_reference` is UNIQUE and is what makes
 * "a duplicate income event does not transfer twice" true — but that
 * ledger only ever gets a row when the earning player is CURRENTLY
 * Controlled (see below). For an UNCONTROLLED player, this function just
 * credits the full amount with no ledger row at all, because no transfer
 * ledger applies and no general-purpose "income events" table was asked
 * for. A duplicate call for an uncontrolled player would therefore credit
 * twice — this is out of scope for the "foundation only" instruction
 * (there is no currency-earning flow yet for such a call to even
 * originate from) and is called out here rather than silently assumed
 * away. If/when a real income source is built, ITS OWN idempotency
 * (e.g. "this quest was already claimed") is what must prevent that
 * duplicate call from happening in the first place.
 */

const DEDUCTION_RATE = 0.20;
const MAX_PER_RELATIONSHIP = 100;
const MAX_PER_CONTROLLER_PER_DAY = 200;

function utcMidnight(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Applies one unit of eligible Credits income to `playerId`.
 *
 * - Not currently Controlled: the full `amount` is credited to the
 *   player. No deduction, no transfer, no ledger row.
 * - Currently Controlled: the controller's cut is
 *     min(floor(amount * 0.20), remaining per-relationship allowance,
 *         remaining per-controller-per-UTC-day allowance)
 *   which is transferred to the controller; the REST of `amount` (never
 *   less than 80%, often more once a cap is reached) stays with the
 *   controlled player. Neither the transfer nor the amount the controlled
 *   player keeps can ever push either balance below its floor
 *   (adjustCredits' own GREATEST(0, ...) — though a positive credit never
 *   actually needs that floor, it is the same, already-audited code path
 *   as any other Credits write). A `credit_transfers` row is written
 *   EVEN WHEN the computed cut is 0 (every cap already exhausted this
 *   relationship/day), both for a complete audit trail and so the
 *   `idempotency_reference` is consumed either way.
 *
 * Runs entirely inside one transaction: the idempotency check, the read
 * of the player's live Control state, both Credits adjustments, and the
 * ledger insert either all succeed together or (on any error, including
 * the UNIQUE constraint firing under a race) all roll back together —
 * "transaction rollback" leaves neither balance changed and no partial
 * ledger row behind.
 */
async function applyEligibleIncome(playerId, amount, sourceType, idempotencyReference) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ApiError('INVALID_CREDITS_AMOUNT', 'amount must be a positive integer.', 400);
  }
  if (!sourceType || typeof sourceType !== 'string') {
    throw new ApiError('INVALID_CREDITS_SOURCE', 'sourceType is required.', 400);
  }
  if (!idempotencyReference || typeof idempotencyReference !== 'string') {
    throw new ApiError('INVALID_IDEMPOTENCY_REFERENCE', 'idempotencyReference is required.', 400);
  }

  return db.withTransaction(async (client) => {
    const player = await playerRepo.getById(playerId, client);
    if (!player) {
      throw new ApiError('PLAYER_NOT_FOUND', 'Player does not exist.', 404);
    }

    const controlled = playerRepo.isControlActive(player);

    if (!controlled) {
      const updated = await playerRepo.adjustCredits(playerId, amount, client);
      return {
        player_id: playerId,
        source_type: sourceType,
        income_amount: amount,
        transferred: 0,
        kept: amount,
        controller_id: null,
        player_credits: updated.credits,
        idempotent: false,
      };
    }

    // --- Controlled path: idempotency, then the capped cut. ---
    const existing = await creditTransferRepo.getByIdempotencyReference(idempotencyReference, client);
    if (existing) {
      // Already processed by an earlier call with this exact reference —
      // neither balance is touched again; return the recorded outcome.
      const kept = existing.source_income_amount - existing.amount;
      return {
        player_id: playerId,
        source_type: sourceType,
        income_amount: existing.source_income_amount,
        transferred: existing.amount,
        kept,
        controller_id: existing.controller_id,
        player_credits: null, // not re-read: this call made no new write
        idempotent: true,
      };
    }

    const controllerId = player.controller_id;
    const nominalDeduction = Math.floor(amount * DEDUCTION_RATE); // "round down"

    const [relationshipUsed, dayUsed] = await Promise.all([
      creditTransferRepo.sumRelationshipTransfers(controllerId, playerId, player.controlled_since, client),
      creditTransferRepo.sumControllerDayTransfers(controllerId, utcMidnight(), client),
    ]);

    const relationshipRemaining = Math.max(0, MAX_PER_RELATIONSHIP - relationshipUsed);
    const dayRemaining = Math.max(0, MAX_PER_CONTROLLER_PER_DAY - dayUsed);

    const transferAmount = Math.min(nominalDeduction, relationshipRemaining, dayRemaining);
    const keptAmount = amount - transferAmount; // "the controlled player keeps the remaining Credits"

    const updatedControlled = await playerRepo.adjustCredits(playerId, keptAmount, client);
    if (transferAmount > 0) {
      await playerRepo.adjustCredits(controllerId, transferAmount, client);
    }

    await creditTransferRepo.insertTransfer(
      {
        controllerId,
        controlledId: playerId,
        amount: transferAmount,
        sourceIncomeAmount: amount,
        idempotencyReference,
      },
      client
    );

    return {
      player_id: playerId,
      source_type: sourceType,
      income_amount: amount,
      transferred: transferAmount,
      kept: keptAmount,
      controller_id: controllerId,
      player_credits: updatedControlled.credits,
      idempotent: false,
    };
  });
}

module.exports = {
  applyEligibleIncome,
  DEDUCTION_RATE,
  MAX_PER_RELATIONSHIP,
  MAX_PER_CONTROLLER_PER_DAY,
  utcMidnight,
};
