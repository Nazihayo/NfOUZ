-- 007_influence_log.sql
-- NFOUZ — Influence audit log (see TDD v1.0 section 5, Master Handbook golden rule #5)

BEGIN;

CREATE TABLE IF NOT EXISTS influence_log (
    log_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id   UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    delta       INT NOT NULL,
    reason      VARCHAR(50) NOT NULL, -- 'battle_win' | 'battle_loss' | 'ai_agent_win' | ...
    battle_id   UUID REFERENCES battles (battle_id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_influence_log_player ON influence_log (player_id);
CREATE INDEX IF NOT EXISTS idx_influence_log_battle ON influence_log (battle_id);

COMMIT;
