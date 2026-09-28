-- 003_factions.sql
-- NFOUZ — Factions (see GDD v1.0 section 5)

BEGIN;

CREATE TABLE IF NOT EXISTS factions (
    faction_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         VARCHAR(30) UNIQUE NOT NULL CHECK (name IN ('Falcons', 'Wolves', 'Ghosts', 'Titans')),
    color_hex    VARCHAR(7) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE players
    ADD CONSTRAINT fk_players_faction
    FOREIGN KEY (faction_id) REFERENCES factions (faction_id) ON DELETE SET NULL;

INSERT INTO factions (name, color_hex) VALUES
    ('Falcons', '#3AA0FF'),
    ('Wolves',  '#9CA3AF'),
    ('Ghosts',  '#7C3AED'),
    ('Titans',  '#DC2626')
ON CONFLICT (name) DO NOTHING;

COMMIT;
