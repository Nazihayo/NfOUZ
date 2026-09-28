-- 011_ai_agents.sql
-- NFOUZ — AI Agents system (see AI Agents System v1.0 section 8)

BEGIN;

CREATE TABLE IF NOT EXISTS ai_agent_types (
    agent_type_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    VARCHAR(30) UNIQUE NOT NULL
                               CHECK (name IN ('Scout Drone', 'Wolf Bot', 'Titan Guard', 'Legend Agent')),
    base_health             INT NOT NULL,
    min_damage              INT NOT NULL,
    max_damage              INT NOT NULL,
    influence_reward_win    INT NOT NULL,
    influence_penalty_loss  INT NOT NULL DEFAULT 0,
    detection_range_meters  INT NOT NULL,
    respawn_seconds         INT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_agent_instances (
    instance_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_type_id UUID NOT NULL REFERENCES ai_agent_types (agent_type_id) ON DELETE CASCADE,
    zone_id       UUID, -- FK to zones table, added when Territory System is implemented
    lat           DOUBLE PRECISION NOT NULL,
    lng           DOUBLE PRECISION NOT NULL,
    state         VARCHAR(20) NOT NULL DEFAULT 'idle'
                     CHECK (state IN ('idle', 'alert', 'battle', 'defeated', 'respawning')),
    spawned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    defeated_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ai_battle_log (
    log_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id     UUID NOT NULL REFERENCES ai_agent_instances (instance_id) ON DELETE CASCADE,
    player_id       UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    player_won      BOOLEAN NOT NULL,
    influence_delta INT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_instances_state ON ai_agent_instances (state);
CREATE INDEX IF NOT EXISTS idx_ai_instances_location ON ai_agent_instances (lat, lng);
CREATE INDEX IF NOT EXISTS idx_ai_battle_log_player ON ai_battle_log (player_id);

-- Seed the four agent types (see AI Agents System v1.0 section 2).
INSERT INTO ai_agent_types
    (name, base_health, min_damage, max_damage, influence_reward_win, influence_penalty_loss, detection_range_meters, respawn_seconds)
VALUES
    ('Scout Drone',  40,  5,  8,  5,  0, 40, 300),
    ('Wolf Bot',     80, 10, 15,  8,  3, 25, 900),
    ('Titan Guard', 150, 18, 25, 12,  5, 30, 1800),
    ('Legend Agent',220, 25, 35, 20,  8, 20, 86400)
ON CONFLICT (name) DO NOTHING;

COMMIT;
