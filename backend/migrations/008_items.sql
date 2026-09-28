-- 008_items.sql
-- NFOUZ — Item definitions (see Inventory/Friends/Clan v1.0 section 1, Weapons Data)

BEGIN;

CREATE TABLE IF NOT EXISTS items (
    item_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(50) UNIQUE NOT NULL,
    item_type     VARCHAR(20) NOT NULL CHECK (item_type IN ('weapon', 'consumable', 'cosmetic')),
    rarity        VARCHAR(20) NOT NULL DEFAULT 'common'
                     CHECK (rarity IN ('common', 'rare', 'legendary')),
    description   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the four base weapons from Battle System, Weapons Data & Combat Math v1.0.
INSERT INTO items (name, item_type, rarity, description) VALUES
    ('Pulse Blade',      'weapon', 'common',    'Fast melee weapon, balanced damage.'),
    ('Shadow Dagger',    'weapon', 'rare',      'Fast melee weapon, high critical chance.'),
    ('Titan Hammer',     'weapon', 'rare',      'Heavy melee weapon, AoE special ability.'),
    ('Influence Cannon', 'weapon', 'legendary', 'Rare weapon draining battle influence.'),
    ('Energy Pack',      'consumable', 'common', 'Restores 40 energy outside of battle.'),
    ('Health Kit',       'consumable', 'common', 'Restores 30 health outside of battle.'),
    ('SOS Beacon',       'consumable', 'common', 'Widens notification range for one SOS request.')
ON CONFLICT (name) DO NOTHING;

COMMIT;
