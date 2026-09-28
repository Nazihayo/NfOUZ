-- 006_sos.sql
-- NFOUZ — SOS requests (see GDD v1.0 section 9, Inventory/Friends/Clan v1.0 section 2.4)

BEGIN;

CREATE TABLE IF NOT EXISTS sos_requests (
    sos_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id    UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    status       VARCHAR(20) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'rescued', 'expired')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    rescuer_id   UUID REFERENCES players (player_id) ON DELETE SET NULL
);

-- Only one open SOS request per player at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sos_open_per_player
    ON sos_requests (player_id)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_sos_status ON sos_requests (status);

COMMIT;
