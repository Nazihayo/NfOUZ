-- 020_quest_daily_assignment.sql
-- NFOUZ — Sprint 9 (Inventory + Quest System): unique per-UTC-day
-- assignment guard for player_quests.
--
-- Deviation from the spec's assumption: it expected 010_quests.sql to
-- already define a unique constraint keyed by
-- (player_id, quest_definition_id, assigned_date) — it does not (only
-- non-unique indexes on player_id and expires_at, and no separate
-- assigned_date column, only `assigned_at TIMESTAMPTZ`). This migration
-- adds the missing guard additively, as a unique EXPRESSION index over the
-- UTC calendar date derived from the existing `assigned_at` column, rather
-- than adding a new column — no existing column's meaning or values change.
--
-- quest.repository.js#assignTodayQuestsIfMissing inserts each of today's
-- daily quest_definitions rows via
-- `INSERT ... ON CONFLICT (player_id, quest_id, ((assigned_at AT TIME ZONE 'utc')::date)) DO NOTHING`,
-- which references this exact index's expressions — the first insert for a
-- given player+quest+UTC-day wins, every repeat call for the same day is a
-- harmless no-op at the database level, not an application-level check.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_player_quest_assigned_day
    ON player_quests (player_id, quest_id, ((assigned_at AT TIME ZONE 'utc')::date));

COMMIT;
