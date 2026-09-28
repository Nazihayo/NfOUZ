-- 013_battle_sessions.sql
-- NFOUZ — Sprint 5: Photon Multiplayer Foundation — battle session state.
-- Extends the existing `battles` table (004_battles.sql) rather than
-- duplicating it. `battles.status` already supports 'forfeited' and
-- `photon_room_name` already exists — this migration adds ONLY the
-- per-player ready/disconnect tracking and grace-period fields needed
-- for Sprint 5 session-state handling (no final battle result logic).

BEGIN;

ALTER TABLE battles
    ADD COLUMN IF NOT EXISTS attacker_ready BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS defender_ready BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS attacker_disconnected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS defender_disconnected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS attacker_reconnect_deadline TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS defender_reconnect_deadline TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS forfeited_by UUID REFERENCES players (player_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMPTZ;

-- Fast lookup of a player's currently active (in_progress) battle, used to
-- reject duplicate challenges and to resolve "GET /battle/{battleId}" style
-- session checks without a full table scan.
CREATE INDEX IF NOT EXISTS idx_battles_attacker_status ON battles (attacker_id, status);
CREATE INDEX IF NOT EXISTS idx_battles_defender_status ON battles (defender_id, status);

COMMIT;
