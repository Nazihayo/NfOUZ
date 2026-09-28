-- 009_inventory.sql
-- NFOUZ — Player inventory (see Inventory/Friends/Clan v1.0 section 1.2)

BEGIN;

CREATE TABLE IF NOT EXISTS player_inventory (
    inventory_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id     UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    item_id       UUID NOT NULL REFERENCES items (item_id) ON DELETE CASCADE,
    quantity      INT NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    is_equipped   BOOLEAN NOT NULL DEFAULT FALSE,
    acquired_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (player_id, item_id)
);

-- Only one equipped weapon per player.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_one_equipped_weapon_per_player
    ON player_inventory (player_id)
    WHERE is_equipped = TRUE;

CREATE INDEX IF NOT EXISTS idx_inventory_player ON player_inventory (player_id);

COMMIT;
