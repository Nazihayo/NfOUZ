-- 018_battle_pass_xp.sql
-- NFOUZ — Sprint 9 (Inventory + Quest System): Battle Pass XP tracking only.
-- "Do NOT implement any Premium Battle Pass tier/purchase logic" — this
-- migration adds XP storage on the players row and nothing else; there is
-- no battle_pass_tier/purchase table anywhere in this pass.

BEGIN;

ALTER TABLE players
    ADD COLUMN IF NOT EXISTS battle_pass_xp INTEGER NOT NULL DEFAULT 0 CHECK (battle_pass_xp >= 0);

COMMIT;
