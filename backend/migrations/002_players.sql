-- 002_players.sql
-- NFOUZ — Core players table (see TDD v1.0 section 5, GDD v1.0 sections 3-4)

BEGIN;

CREATE TABLE IF NOT EXISTS players (
    player_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username          VARCHAR(50) UNIQUE NOT NULL,
    firebase_uid      VARCHAR(128) UNIQUE NOT NULL,
    class_type        VARCHAR(20) NOT NULL CHECK (class_type IN ('Scout', 'Ranger', 'Titan')),
    faction_id        UUID,                       -- FK added in 003_factions.sql
    health            INT NOT NULL DEFAULT 100,
    max_health         INT NOT NULL DEFAULT 100,
    energy            INT NOT NULL DEFAULT 100,
    max_energy         INT NOT NULL DEFAULT 100,
    influence         INT NOT NULL DEFAULT 100 CHECK (influence >= 0),
    level             INT NOT NULL DEFAULT 1,
    experience        INT NOT NULL DEFAULT 0,
    rank              VARCHAR(30) NOT NULL DEFAULT 'Citizen',
    is_controlled     BOOLEAN NOT NULL DEFAULT FALSE,
    controlled_until  TIMESTAMPTZ,
    last_lat          DOUBLE PRECISION,
    last_lng          DOUBLE PRECISION,
    last_location_at  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_players_firebase_uid ON players (firebase_uid);
CREATE INDEX IF NOT EXISTS idx_players_last_location ON players (last_lat, last_lng);

COMMIT;
