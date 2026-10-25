-- 022_player_safety.sql
-- Driving stop: the last time a location update showed the player moving
-- faster than SAFETY_MAX_PLAY_SPEED_KMH (backend utils/playerSafety.js).
-- For SAFETY_FAST_MOVEMENT_COOLDOWN_SECONDS afterwards the player is not
-- listed as nearby, cannot challenge and cannot be challenged.
--
-- Forward-only and additive: NULL means "never seen moving fast". Rolling
-- back means dropping the column.

BEGIN;

ALTER TABLE players
    ADD COLUMN IF NOT EXISTS fast_movement_at TIMESTAMPTZ;

COMMIT;
