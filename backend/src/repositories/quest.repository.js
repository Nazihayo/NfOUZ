'use strict';

const db = require('../config/database');

/**
 * Sprint 9 — Quest System. All SQL touching `quest_definitions`,
 * `player_quests`, and `players.battle_pass_xp` (018_battle_pass_xp.sql)
 * lives here. Services never write raw queries; controllers never touch
 * this repository directly.
 *
 * "Today" is always computed as a UTC calendar date
 * (`(assigned_at AT TIME ZONE 'utc')::date` / `(now() AT TIME ZONE 'utc')::date`)
 * so a player's local timezone never shifts the daily reset boundary — the
 * spec's "Daily refresh at UTC midnight" requirement.
 */

/** Every seeded daily quest definition (010_quests.sql). */
async function listDailyQuestDefinitions(executor = db) {
  const result = await executor.query(
    `SELECT quest_id, title, goal_type, goal_target, reward_coins, reward_bp_xp
     FROM quest_definitions
     WHERE quest_type = 'daily'`
  );
  return result.rows;
}

/**
 * Lazily assigns today's (UTC) player_quests row for one quest_definition,
 * a no-op if it already exists — see 020_quest_daily_assignment.sql's doc
 * comment for why the ON CONFLICT target below is an expression index
 * rather than a plain column list, and for why this is the actual
 * correctness mechanism (not an application-level "check then insert").
 * `expiresAt` is the next UTC midnight, computed once by the caller so every
 * quest assigned in the same call shares an identical, consistent deadline.
 */
async function assignQuestForToday(playerId, questId, expiresAt, executor = db) {
  const result = await executor.query(
    `INSERT INTO player_quests (player_id, quest_id, current_progress, is_completed, is_claimed, assigned_at, expires_at)
     VALUES ($1, $2, 0, FALSE, FALSE, now(), $3)
     ON CONFLICT (player_id, quest_id, ((assigned_at AT TIME ZONE 'utc')::date)) DO NOTHING
     RETURNING *`,
    [playerId, questId, expiresAt]
  );
  return result.rows[0] || null;
}

/** Today's (UTC) assigned quests for a player, joined with their definitions. */
async function getTodayQuestsForPlayer(playerId, executor = db) {
  const result = await executor.query(
    `SELECT pq.player_quest_id, pq.quest_id, pq.current_progress, pq.is_completed, pq.is_claimed,
            pq.assigned_at, pq.expires_at,
            qd.title, qd.goal_type, qd.goal_target, qd.reward_coins, qd.reward_bp_xp
     FROM player_quests pq
     JOIN quest_definitions qd ON qd.quest_id = pq.quest_id
     WHERE pq.player_id = $1
       AND (pq.assigned_at AT TIME ZONE 'utc')::date = (now() AT TIME ZONE 'utc')::date
     ORDER BY qd.title`,
    [playerId]
  );
  return result.rows;
}

/** One (today-scoped) player_quest row, joined with its definition, for the claim flow's pre-check. */
async function getPlayerQuestForClaim(playerId, questId, executor = db) {
  const result = await executor.query(
    `SELECT pq.player_quest_id, pq.quest_id, pq.current_progress, pq.is_completed, pq.is_claimed,
            pq.assigned_at, pq.expires_at,
            qd.reward_coins, qd.reward_bp_xp,
            ((pq.assigned_at AT TIME ZONE 'utc')::date = (now() AT TIME ZONE 'utc')::date) AS is_today
     FROM player_quests pq
     JOIN quest_definitions qd ON qd.quest_id = pq.quest_id
     WHERE pq.player_id = $1 AND pq.quest_id = $2
     ORDER BY pq.assigned_at DESC
     LIMIT 1`,
    [playerId, questId]
  );
  return result.rows[0] || null;
}

/**
 * Server-side progress tracking, the ONLY writer of `current_progress`/
 * `is_completed` — never trusted from any client-reported value (see
 * quest.service.js#recordProgress's doc comment for the hook call sites).
 * A single atomic UPDATE...FROM (joined against quest_definitions for
 * `goal_type`/`goal_target`) — matches an active, not-yet-completed,
 * TODAY-assigned quest of the given goal_type for this player, clamps
 * `current_progress` at `goal_target`, and flips `is_completed` in the same
 * statement. No-ops safely (returns null) if no such quest exists — that is
 * the deliberate "no-op if no active quest of that goal_type" behavior the
 * spec requires of recordProgress, enforced here at the SQL level rather
 * than by an application-level existence check first.
 */
async function recordProgress(playerId, goalType, amount, executor = db) {
  const result = await executor.query(
    `UPDATE player_quests pq
     SET current_progress = LEAST(qd.goal_target, pq.current_progress + $3),
         is_completed = (pq.current_progress + $3) >= qd.goal_target
     FROM quest_definitions qd
     WHERE pq.quest_id = qd.quest_id
       AND pq.player_id = $1
       AND qd.goal_type = $2
       AND pq.is_completed = FALSE
       AND (pq.assigned_at AT TIME ZONE 'utc')::date = (now() AT TIME ZONE 'utc')::date
     RETURNING pq.*`,
    [playerId, goalType, amount]
  );
  return result.rows[0] || null;
}

/**
 * Atomic guarded claim — the exact `UPDATE ... WHERE is_claimed = FALSE
 * RETURNING *` idiom already used by rescue_missions' status guards
 * (rescue.repository.js#succeedMission/failMission). A null/no-row return
 * means "already claimed, do nothing further" — the service layer never
 * needs (and never performs) a separate check-then-act for this. Also
 * requires `is_completed = TRUE` and today's UTC assignment, so an
 * incomplete or expired (yesterday's) quest can never be claimed even if
 * `is_claimed` happened to be FALSE.
 */
async function claimIfEligible(playerId, questId, executor = db) {
  const result = await executor.query(
    `UPDATE player_quests
     SET is_claimed = TRUE
     WHERE player_id = $1 AND quest_id = $2 AND is_claimed = FALSE AND is_completed = TRUE
       AND (assigned_at AT TIME ZONE 'utc')::date = (now() AT TIME ZONE 'utc')::date
     RETURNING *`,
    [playerId, questId]
  );
  return result.rows[0] || null;
}

/**
 * Sprint 9 — Battle Pass XP (018_battle_pass_xp.sql). Floored at 0 via the
 * same GREATEST pattern as player.repository.js#adjustCredits/
 * adjustExperience, though XP is never expected to go negative in practice.
 * Kept here rather than in player.repository.js so Sprint 9 adds a new file
 * instead of modifying an already-approved Sprint 1-8 one.
 */
async function adjustBattlePassXp(playerId, delta, executor = db) {
  const result = await executor.query(
    `UPDATE players SET battle_pass_xp = GREATEST(0, battle_pass_xp + $1), updated_at = now()
     WHERE player_id = $2
     RETURNING player_id, battle_pass_xp`,
    [delta, playerId]
  );
  return result.rows[0] || null;
}

module.exports = {
  listDailyQuestDefinitions,
  assignQuestForToday,
  getTodayQuestsForPlayer,
  getPlayerQuestForClaim,
  recordProgress,
  claimIfEligible,
  adjustBattlePassXp,
};
