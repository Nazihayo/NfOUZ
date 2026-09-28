-- 012_player_visibility.sql
-- NFOUZ Sprint 4 — visibility ("ghost mode") flag + indexes supporting the
-- nearby-players query: online recency filter, visibility filter, and the
-- existing blocked-player exclusion via friendships.status = 'blocked'.

BEGIN;

ALTER TABLE players
    ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE;

-- Speeds up the "last_location_at >= :onlineSince" recency filter used to
-- decide whether a player counts as online for nearby-players purposes.
CREATE INDEX IF NOT EXISTS idx_players_last_location_at ON players (last_location_at);

-- Composite index covering the common nearby-players access pattern:
-- visible players with a known location, narrowed further by the
-- lat/lng bounding box at query time.
CREATE INDEX IF NOT EXISTS idx_players_visible_location
    ON players (is_visible, last_lat, last_lng)
    WHERE is_visible = TRUE;

COMMIT;
