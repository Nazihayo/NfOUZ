-- 004_battles.sql
-- NFOUZ — Battles (see TDD v1.0 section 5, Battle System v1.0)

BEGIN;

CREATE TABLE IF NOT EXISTS battles (
    battle_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attacker_id     UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    defender_id     UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    winner_id       UUID REFERENCES players (player_id) ON DELETE SET NULL,
    loser_id        UUID REFERENCES players (player_id) ON DELETE SET NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'in_progress'
                       CHECK (status IN ('in_progress', 'resolved', 'forfeited', 'cancelled')),
    duration_seconds INT,
    location_lat    DOUBLE PRECISION,
    location_lng    DOUBLE PRECISION,
    photon_room_name VARCHAR(100),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ,

    CONSTRAINT chk_battle_participants_differ CHECK (attacker_id <> defender_id)
);

CREATE INDEX IF NOT EXISTS idx_battles_attacker ON battles (attacker_id);
CREATE INDEX IF NOT EXISTS idx_battles_defender ON battles (defender_id);
CREATE INDEX IF NOT EXISTS idx_battles_status ON battles (status);

COMMIT;
