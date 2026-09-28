-- 010_quests.sql
-- NFOUZ — Quest definitions and player progress (see Shop/BattlePass/Quests v1.0 section 3)

BEGIN;

CREATE TABLE IF NOT EXISTS quest_definitions (
    quest_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title          VARCHAR(100) NOT NULL,
    quest_type     VARCHAR(20) NOT NULL CHECK (quest_type IN ('daily', 'weekly', 'onboarding')),
    goal_type      VARCHAR(30) NOT NULL, -- 'win_battles' | 'claim_zones' | 'add_friend' | 'use_sos_rescue' | ...
    goal_target    INT NOT NULL CHECK (goal_target > 0),
    reward_coins   BIGINT NOT NULL DEFAULT 0,
    reward_bp_xp   INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_quests (
    player_quest_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id         UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    quest_id          UUID NOT NULL REFERENCES quest_definitions (quest_id) ON DELETE CASCADE,
    current_progress INT NOT NULL DEFAULT 0,
    is_completed      BOOLEAN NOT NULL DEFAULT FALSE,
    is_claimed        BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at        TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_player_quests_player ON player_quests (player_id);
CREATE INDEX IF NOT EXISTS idx_player_quests_expires ON player_quests (expires_at);

-- Seed a minimal Alpha daily quest set (see Shop/BattlePass/Quests v1.0 section 3.3).
INSERT INTO quest_definitions (title, quest_type, goal_type, goal_target, reward_coins, reward_bp_xp) VALUES
    ('اربح معركتين اليوم',        'daily', 'win_battles',    2, 100, 30),
    ('امشِ 500 متر داخل اللعبة',   'daily', 'distance_traveled', 500, 50, 0),
    ('أضف صديقاً جديداً',          'daily', 'add_friend',     1, 0, 20),
    ('حرّر صديقاً عبر SOS',        'daily', 'use_sos_rescue', 1, 150, 25)
ON CONFLICT DO NOTHING;

COMMIT;
