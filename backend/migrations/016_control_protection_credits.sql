-- 016_control_protection_credits.sql
-- NFOUZ — Sprint 7 continuation: exact GDD Influence/Rank/Control/
-- Protection/Control-economy rules, replacing every assumed/placeholder
-- value from the previous Sprint 7 increment.
--
-- players:
--   controller_id     — who currently controls this player (NULL if not
--                        controlled). Sprint 6/first Sprint 7 increment
--                        only had is_controlled/controlled_until; "only
--                        one incoming controller per player" is enforced
--                        structurally by this being a single column, not
--                        a relationship table.
--   controlled_since  — when the CURRENT control relationship started.
--                        Needed to scope the "max 100 Credits per Control
--                        relationship" cap in credit_transfers to only
--                        this relationship's transfers, not a lifetime
--                        total across every past capture of this player.
--   protected_until   — post-rescue/voluntary-release/admin-invalidation
--                        protection window (GDD section 4). Deliberately
--                        NOT set by ordinary Control timer expiry.
--   battle_type on `battles` distinguishes a competitive challenge (the
--   only kind Influence/Control ever apply to) from a training battle
--   (no Influence change, no Control, regardless of outcome) — no such
--   distinction existed before this pass; only `status` did.
BEGIN;

ALTER TABLE players
    ADD COLUMN IF NOT EXISTS controller_id UUID REFERENCES players (player_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS controlled_since TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS protected_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS credits INT NOT NULL DEFAULT 0 CHECK (credits >= 0);

ALTER TABLE battles
    ADD COLUMN IF NOT EXISTS battle_type VARCHAR(20) NOT NULL DEFAULT 'competitive'
        CHECK (battle_type IN ('competitive', 'training'));

-- influence_log: `delta` has always meant "the change actually applied",
-- but with no floor-at-0 clamping ever exercised before this pass, it
-- happened to always equal the nominal per-event constant too. Sprint 7
-- requires the ACTUAL deducted/added amount (post-floor) to be what's
-- recorded — `delta` keeps doing exactly that; `nominal_delta` is added
-- alongside it so an audit can see both the requested change and what
-- actually landed (e.g. a -10 loss against 5 Influence applies -5, floors
-- at 0: delta = -5, nominal_delta = -10).
ALTER TABLE influence_log
    ADD COLUMN IF NOT EXISTS nominal_delta INT;

-- Sprint 7 continuation — Rank cosmetic unlocks: "unlocked cosmetic
-- rewards remain unlocked after rank loss" means this is an ADD-ONLY
-- ledger — a row here is never deleted or overwritten when a player's
-- current `rank` later drops back down.
CREATE TABLE IF NOT EXISTS player_rank_unlocks (
    player_id   UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    rank_name   VARCHAR(30) NOT NULL,
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, rank_name)
);

-- Sprint 7 continuation — Control economy foundation (GDD section 5).
-- Foundation only, per the explicit instruction: no shop, no other
-- currency source is implemented here, just the ledger + the accounting
-- rules a future Credits-income event will call into
-- (creditsService.applyEligibleIncome).
--
-- idempotency_reference: uniquely identifies the INCOME EVENT this
-- transfer (if any) was derived from — "duplicate income event does not
-- transfer twice" is enforced by the UNIQUE constraint below, not by
-- application-level locking alone.
CREATE TABLE IF NOT EXISTS credit_transfers (
    transfer_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    controller_id         UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    controlled_id         UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    amount                INT NOT NULL CHECK (amount >= 0),
    source_income_amount  INT NOT NULL CHECK (source_income_amount >= 0),
    idempotency_reference VARCHAR(100) NOT NULL UNIQUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_transfers_relationship
    ON credit_transfers (controller_id, controlled_id, created_at);
CREATE INDEX IF NOT EXISTS idx_credit_transfers_controller_day
    ON credit_transfers (controller_id, created_at);

COMMIT;
