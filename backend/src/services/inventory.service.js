'use strict';

const db = require('../config/database');
const inventoryRepo = require('../repositories/inventory.repository');
const battleRepo = require('../repositories/battle.repository');
const { ApiError } = require('../utils/responseEnvelope');

/**
 * Sprint 9 — Inventory System. Player progression outside of combat.
 *
 * Server-authoritative per this project's existing golden rule (see
 * rescue.service.js/battle.service.js's own header comments): the client
 * never trusts its own claimed ownership or item state — every equip/use
 * call re-resolves the item and the caller's owned quantity from the
 * database, from the player_id the controller already resolved out of the
 * verified Firebase token (see inventory.controller.js#resolveSelf), never
 * from anything in the request body.
 *
 * Idempotency: both mutating operations (equip, use) run their entire
 * check-then-write sequence inside one db.withTransaction, guarded by the
 * inventory_idempotency table (019_inventory_idempotency.sql) via
 * withIdempotency below — a validation failure thrown mid-transaction rolls
 * back the whole transaction, INCLUDING the idempotency claim itself, so a
 * client retry after a genuine error (e.g. ACTIVE_BATTLE_IN_PROGRESS) is
 * free to try again with the same request_id rather than being permanently
 * "stuck" on a failed attempt. Only a call that actually completes the
 * effect ever commits a non-null result_json for that request_id.
 */

/**
 * Wraps one idempotent inventory operation. `effectFn(client)` performs the
 * real validation + mutation and returns the JSON-serializable result to
 * both return now and hand back verbatim to any future retry with the same
 * (player_id, operation, request_id).
 */
async function withIdempotency(playerId, operation, requestId, effectFn) {
  if (!requestId || typeof requestId !== 'string') {
    throw new ApiError('INVALID_REQUEST', 'request_id is required.', 400);
  }

  return db.withTransaction(async (client) => {
    const claimed = await inventoryRepo.claimIdempotencyKey(playerId, operation, requestId, client);

    if (!claimed) {
      // Lost the claim race (or this is a genuine retry of an
      // already-completed call) — see 019_inventory_idempotency.sql's doc
      // comment for why this INSERT's conflict guarantees the row we're
      // about to read here is fully committed, not a half-written one.
      const existing = await inventoryRepo.getIdempotencyResult(playerId, operation, requestId, client);
      if (existing && existing.result_json) {
        return { ...JSON.parse(existing.result_json), idempotent: true };
      }
      throw new ApiError('DUPLICATE_REQUEST', 'This request is already being processed.', 409);
    }

    const result = await effectFn(client);
    await inventoryRepo.completeIdempotencyKey(claimed.idempotency_id, JSON.stringify(result), client);
    return result;
  });
}

/**
 * Rejects equip/use while the caller has an active battle in progress.
 * Reuses battle.repository.js#findActiveBattleForPlayer — the same
 * Sprint 5/6 `battles` row query already used to reject a duplicate battle
 * challenge — rather than inventing new battle-state tracking, per the
 * spec. That function always reads through the shared pool (it has no
 * `executor` parameter to thread a transaction client through), which is
 * fine here: it is a read-only plausibility check, not something this
 * transaction itself writes to.
 */
async function assertNoActiveBattle(playerId) {
  const activeBattle = await battleRepo.findActiveBattleForPlayer(playerId);
  if (activeBattle) {
    throw new ApiError('ACTIVE_BATTLE_IN_PROGRESS', 'Cannot change equipment or use items during an active battle.', 409);
  }
}

/** GET /inventory — the caller's owned items + quantities + currently equipped weapon. */
async function listInventory(playerId) {
  const rows = await inventoryRepo.listInventory(playerId);
  const equippedRow = rows.find((row) => row.is_equipped);

  return {
    items: rows.map((row) => ({
      item_key: row.name,
      item_type: row.item_type,
      rarity: row.rarity,
      quantity: row.quantity,
      is_equipped: row.is_equipped,
    })),
    equipped_weapon: equippedRow ? equippedRow.name : null,
  };
}

/**
 * POST /inventory/equip — equips a weapon the caller owns. Only one
 * equipped weapon at a time; equipping a new one atomically unequips the
 * previous one (both writes inside the same transaction as everything
 * else here).
 *
 * "The service layer MUST ensure only weapon-type items are ever set
 * is_equipped=TRUE" — the partial unique index on player_inventory
 * (009_inventory.sql) enforces "one equipped item globally", not
 * "one equipped WEAPON"; a consumable is rejected here with
 * ITEM_NOT_A_WEAPON before ever reaching an UPDATE that could set its
 * is_equipped flag, so consumables never have is_equipped touched at all.
 */
async function equipWeapon(playerId, itemKey, requestId) {
  if (!itemKey || typeof itemKey !== 'string') {
    throw new ApiError('INVALID_REQUEST', 'item_key is required.', 400);
  }

  return withIdempotency(playerId, 'equip', requestId, async (client) => {
    const item = await inventoryRepo.getItemByKey(itemKey, client);
    if (!item) {
      throw new ApiError('ITEM_NOT_FOUND', `No item exists with key '${itemKey}'.`, 404);
    }
    if (item.item_type !== 'weapon') {
      throw new ApiError('ITEM_NOT_A_WEAPON', 'Only weapons can be equipped.', 400);
    }

    await assertNoActiveBattle(playerId);

    const owned = await inventoryRepo.getInventoryRow(playerId, item.item_id, client);
    if (!owned || owned.quantity <= 0) {
      throw new ApiError('ITEM_NOT_OWNED', 'You do not own this item.', 403);
    }

    // Atomically unequip whatever weapon was equipped before, then equip
    // the new one — both inside this same transaction, so a failure
    // between the two never leaves the player with either zero or two
    // equipped weapons.
    await inventoryRepo.unequipCurrentWeapon(playerId, client);
    const equipped = await inventoryRepo.equipWeapon(playerId, item.item_id, client);
    if (!equipped) {
      // Lost a race against a concurrent change to this same row (e.g. the
      // item was somehow removed from the player's inventory mid-flight).
      throw new ApiError('ITEM_NOT_OWNED', 'You do not own this item.', 403);
    }

    return { item_key: itemKey, equipped: true };
  });
}

/**
 * POST /inventory/use — consumes one unit of a consumable the caller owns.
 * Rejected outright for a weapon/cosmetic item_key (USE is for consumables
 * only) and while the caller has an active battle in progress.
 */
async function useConsumable(playerId, itemKey, requestId) {
  if (!itemKey || typeof itemKey !== 'string') {
    throw new ApiError('INVALID_REQUEST', 'item_key is required.', 400);
  }

  return withIdempotency(playerId, 'use', requestId, async (client) => {
    const item = await inventoryRepo.getItemByKey(itemKey, client);
    if (!item) {
      throw new ApiError('ITEM_NOT_FOUND', `No item exists with key '${itemKey}'.`, 404);
    }
    if (item.item_type !== 'consumable') {
      throw new ApiError('ITEM_NOT_CONSUMABLE', 'Only consumables can be used.', 400);
    }

    await assertNoActiveBattle(playerId);

    const decremented = await inventoryRepo.decrementConsumable(playerId, item.item_id, client);
    if (!decremented) {
      throw new ApiError('ITEM_NOT_OWNED', 'You do not own this item, or have none remaining.', 403);
    }

    return { item_key: itemKey, used: true, remaining_quantity: decremented.quantity };
  });
}

module.exports = {
  listInventory,
  equipWeapon,
  useConsumable,
};
