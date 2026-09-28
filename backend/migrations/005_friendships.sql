-- 005_friendships.sql
-- NFOUZ — Friendships (see Inventory/Friends/Clan v1.0 section 2)

BEGIN;

CREATE TABLE IF NOT EXISTS friendships (
    player_id   UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    friend_id   UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'accepted', 'blocked')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (player_id, friend_id),
    CONSTRAINT chk_friendship_not_self CHECK (player_id <> friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships (friend_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships (status);

COMMIT;
