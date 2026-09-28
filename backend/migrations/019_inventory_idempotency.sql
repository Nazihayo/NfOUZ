-- 019_inventory_idempotency.sql
-- NFOUZ — Sprint 9 (Inventory + Quest System): idempotency-key table for
-- Inventory equip/use-consumable operations.
--
-- Inventory operations mutate an existing player_inventory row (quantity/
-- is_equipped) rather than inserting a new uniquely-keyed row the way
-- rescue_missions.idempotency_key does (see rescue.repository.js's doc
-- comment for that pattern) — there is no natural row for a client-supplied
-- request_id to attach to, so a small dedicated table is added instead.
--
-- Correctness comes from the UNIQUE constraint below plus an
-- `INSERT ... ON CONFLICT (player_id, operation, request_id) DO NOTHING`
-- in inventory.repository.js#claimIdempotencyKey: the first caller for a
-- given (player_id, operation, request_id) wins the INSERT and proceeds to
-- apply the effect; a concurrent or retried duplicate call's INSERT either
-- waits on Postgres's own conflict handling until the first caller's
-- transaction commits or rolls back, or returns no row outright — in both
-- cases the DUPLICATE never re-applies the effect, matching the "correctness
-- must come from a DB-level atomic operation" requirement. `result_json` is
-- filled in by the SAME transaction that claimed the row, once the effect's
-- outcome is known, so a duplicate caller can return the exact prior result.
BEGIN;

CREATE TABLE IF NOT EXISTS inventory_idempotency (
    idempotency_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id      UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    operation      VARCHAR(20) NOT NULL CHECK (operation IN ('equip', 'use')),
    request_id     VARCHAR(100) NOT NULL,
    result_json    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (player_id, operation, request_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_idempotency_player ON inventory_idempotency (player_id);

COMMIT;
