'use strict';

const db = require('../config/database');

/**
 * Sprint 9 — Inventory System. All SQL touching `items`, `player_inventory`,
 * and `inventory_idempotency` (019_inventory_idempotency.sql) lives here.
 * Services never write raw queries; controllers never touch this repository
 * directly — see Backend Implementation Guide v1.0's layering rules, the
 * same convention rescue.repository.js/friend.repository.js follow.
 *
 * Deviation from the spec's assumption: items (008_items.sql) has no
 * `item_key`/`effect` column — only `name`, `item_type`, `rarity`,
 * `description`. This repository (and the Inventory API's `item_key` field)
 * uses `items.name` as that stable key (e.g. "Pulse Blade") rather than
 * inventing a new column, since the seeded names are already unique
 * (UNIQUE NOT NULL) and exactly what the spec's own item list names.
 */

async function getItemByKey(itemKey, executor = db) {
  const result = await executor.query(
    `SELECT item_id, name, item_type, rarity, description FROM items WHERE name = $1`,
    [itemKey]
  );
  return result.rows[0] || null;
}

/** One player's full inventory (owned items only), joined with the item catalog. */
async function listInventory(playerId, executor = db) {
  const result = await executor.query(
    `SELECT i.name, i.item_type, i.rarity, pi.quantity, pi.is_equipped
     FROM player_inventory pi
     JOIN items i ON i.item_id = pi.item_id
     WHERE pi.player_id = $1 AND pi.quantity > 0
     ORDER BY i.item_type, i.name`,
    [playerId]
  );
  return result.rows;
}

/** A single (player, item) row — used to check ownership/quantity before equip/use. */
async function getInventoryRow(playerId, itemId, executor = db) {
  const result = await executor.query(
    `SELECT * FROM player_inventory WHERE player_id = $1 AND item_id = $2`,
    [playerId, itemId]
  );
  return result.rows[0] || null;
}

/**
 * Unequips whatever weapon this player currently has equipped, if any.
 * Scoped to `is_equipped = TRUE` only — the partial unique index
 * `uniq_one_equipped_weapon_per_player` (009_inventory.sql) is global to
 * is_equipped, not item_type-scoped, so the service layer (never this
 * repository) is what guarantees only a weapon-type row is ever equipped in
 * the first place (see inventory.service.js#equipWeapon's doc comment).
 */
async function unequipCurrentWeapon(playerId, executor = db) {
  const result = await executor.query(
    `UPDATE player_inventory SET is_equipped = FALSE WHERE player_id = $1 AND is_equipped = TRUE RETURNING *`,
    [playerId]
  );
  return result.rows;
}

/**
 * Equips the given item for this player. Guarded by `quantity > 0` — a
 * player can only equip a weapon they actually own. Returns null if the
 * player does not own this item at all (no row) or owns zero of it, so the
 * service layer can distinguish "not owned" from a real failure.
 */
async function equipWeapon(playerId, itemId, executor = db) {
  const result = await executor.query(
    `UPDATE player_inventory SET is_equipped = TRUE
     WHERE player_id = $1 AND item_id = $2 AND quantity > 0
     RETURNING *`,
    [playerId, itemId]
  );
  return result.rows[0] || null;
}

/**
 * Atomically consumes one unit of a consumable. The `quantity > 0` guard in
 * the WHERE clause is the actual correctness mechanism (mirrors the
 * `status = 'in_progress'`/`is_claimed = FALSE` atomic-UPDATE-guard idiom
 * already used by rescue_missions/player_quests elsewhere in this repo) —
 * a concurrent double-use of the last unit can never both succeed, since
 * only one UPDATE can match `quantity > 0` before the other's WHERE clause
 * sees the already-decremented value. Returns null (not a thrown error) when
 * the player owns none of this item, so the service layer maps that to a
 * clear ITEM_NOT_OWNED validation error rather than a generic 500.
 */
async function decrementConsumable(playerId, itemId, executor = db) {
  const result = await executor.query(
    `UPDATE player_inventory SET quantity = quantity - 1
     WHERE player_id = $1 AND item_id = $2 AND quantity > 0
     RETURNING *`,
    [playerId, itemId]
  );
  return result.rows[0] || null;
}

/**
 * Idempotency-key claim: the first caller for a given (player_id,
 * operation, request_id) wins this INSERT and proceeds to apply the real
 * effect within the SAME transaction; every other caller's INSERT either
 * blocks (Postgres's own conflict-handling wait) until the winner commits
 * or rolls back, then itself returns no row, or observes the already-
 * committed row and returns no row immediately. `result_json` starts NULL
 * and is filled in by inventory.repository.js#completeIdempotencyKey once
 * the effect's outcome is known, still inside the same transaction — see
 * 019_inventory_idempotency.sql's doc comment for the full correctness
 * argument.
 */
async function claimIdempotencyKey(playerId, operation, requestId, executor = db) {
  const result = await executor.query(
    `INSERT INTO inventory_idempotency (player_id, operation, request_id, result_json)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (player_id, operation, request_id) DO NOTHING
     RETURNING *`,
    [playerId, operation, requestId]
  );
  return result.rows[0] || null;
}

/** The already-recorded result for a (player, operation, request_id) that lost the claim race above — i.e. a genuine retry. */
async function getIdempotencyResult(playerId, operation, requestId, executor = db) {
  const result = await executor.query(
    `SELECT * FROM inventory_idempotency WHERE player_id = $1 AND operation = $2 AND request_id = $3`,
    [playerId, operation, requestId]
  );
  return result.rows[0] || null;
}

/** Stores the effect's outcome against the idempotency row this same transaction just claimed. */
async function completeIdempotencyKey(idempotencyId, resultJson, executor = db) {
  const result = await executor.query(
    `UPDATE inventory_idempotency SET result_json = $2 WHERE idempotency_id = $1 RETURNING *`,
    [idempotencyId, resultJson]
  );
  return result.rows[0] || null;
}

module.exports = {
  getItemByKey,
  listInventory,
  getInventoryRow,
  unequipCurrentWeapon,
  equipWeapon,
  decrementConsumable,
  claimIdempotencyKey,
  getIdempotencyResult,
  completeIdempotencyKey,
};
