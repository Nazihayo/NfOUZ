'use strict';

const db = require('../config/database');
const questRepo = require('../repositories/quest.repository');
const playerRepo = require('../repositories/player.repository');
const logger = require('../utils/logger');
const { ApiError } = require('../utils/responseEnvelope');

/**
 * Sprint 9 — Quest System. Daily quests, server-computed progress, and
 * Battle Pass XP (tracking/display only — no Premium tier/purchase logic).
 *
 * "Progress is calculated server-side only ... never from client-reported
 * progress" — recordProgress below is the ONLY writer of a quest's
 * current_progress, and it is called exclusively from best-effort hook call
 * sites added to battle.service.js/location.service.js/friend.service.js/
 * rescue.service.js (see each file's own doc comment at the call site).
 * Nothing in this module, or in quest.controller.js, ever reads a
 * client-supplied "progress" field from a request body.
 */

function nextUtcMidnight(now = new Date()) {
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return midnight;
}

/**
 * Lazily assigns today's (UTC) player_quests rows for every seeded daily
 * quest_definition, a no-op for any quest already assigned today — see
 * 020_quest_daily_assignment.sql's doc comment for the atomic
 * INSERT ... ON CONFLICT DO NOTHING guard this relies on (not an
 * application-level "does it exist yet" check).
 */
async function assignTodayQuestsIfMissing(playerId) {
  const definitions = await questRepo.listDailyQuestDefinitions();
  const expiresAt = nextUtcMidnight();
  for (const definition of definitions) {
    await questRepo.assignQuestForToday(playerId, definition.quest_id, expiresAt);
  }
}

/**
 * GET /quests — lazily assigns today's quests first, then returns them with
 * progress/status. `battle_pass_xp` is included here as a convenience field
 * (chosen over adding it to an existing "get player" endpoint response,
 * which would mean touching an already-approved Sprint 1-8 file/shape —
 * see player.controller.js — for a value only this new Quest UI needs
 * today; least new surface area for what Sprint 9 actually requires).
 */
async function getQuests(playerId) {
  await assignTodayQuestsIfMissing(playerId);
  const [quests, player] = await Promise.all([
    questRepo.getTodayQuestsForPlayer(playerId),
    playerRepo.getById(playerId),
  ]);

  return {
    quests: quests.map((row) => ({
      player_quest_id: row.player_quest_id,
      quest_id: row.quest_id,
      title: row.title,
      goal_type: row.goal_type,
      goal_target: row.goal_target,
      current_progress: row.current_progress,
      is_completed: row.is_completed,
      is_claimed: row.is_claimed,
      reward_coins: row.reward_coins,
      reward_bp_xp: row.reward_bp_xp,
      expires_at: row.expires_at,
    })),
    battle_pass_xp: player ? player.battle_pass_xp : 0,
  };
}

/**
 * POST /quests/:questId/claim — idempotent via the natural atomic
 * `is_claimed = FALSE` guarded UPDATE alone (questRepo.claimIfEligible) —
 * per the spec, no separate idempotency-key table is needed for quest
 * claim, unlike Inventory's equip/use, since this guard is already a
 * sufficient, simpler DB-level dedup mechanism on its own. `requestId` is
 * still required as input validation for consistency with the Inventory
 * endpoints' request shape, but the actual duplicate-claim protection never
 * depends on it matching a prior call's value.
 *
 * Runs entirely inside one transaction: the guarded claim UPDATE and the
 * reward grant (credits += reward_coins, battle_pass_xp += reward_bp_xp)
 * are one atomic unit — any failure after the claim rolls the claim back
 * too, so a quest can never end up marked claimed with no reward granted.
 */
async function claimQuest(playerId, questId, requestId) {
  if (!requestId || typeof requestId !== 'string') {
    throw new ApiError('INVALID_REQUEST', 'request_id is required.', 400);
  }
  if (!questId || typeof questId !== 'string') {
    throw new ApiError('INVALID_REQUEST', 'A valid questId path parameter is required.', 400);
  }

  return db.withTransaction(async (client) => {
    const questRow = await questRepo.getPlayerQuestForClaim(playerId, questId, client);
    if (!questRow) {
      throw new ApiError('QUEST_NOT_FOUND', 'No such quest is assigned to you.', 404);
    }
    if (!questRow.is_today || new Date(questRow.expires_at).getTime() <= Date.now()) {
      throw new ApiError('QUEST_EXPIRED', 'This quest has expired and can no longer be claimed.', 409);
    }
    if (!questRow.is_completed) {
      throw new ApiError('QUEST_NOT_COMPLETED', 'This quest has not been completed yet.', 409);
    }

    const claimed = await questRepo.claimIfEligible(playerId, questId, client);
    if (!claimed) {
      // Already claimed — either a genuine retry or a race this atomic
      // guard lost on purpose. Idempotent: no reward is granted twice.
      return {
        quest_id: questId,
        already_claimed: true,
        reward_coins: 0,
        reward_bp_xp: 0,
      };
    }

    await playerRepo.adjustCredits(playerId, questRow.reward_coins, client);
    const xpRow = await questRepo.adjustBattlePassXp(playerId, questRow.reward_bp_xp, client);

    return {
      quest_id: questId,
      already_claimed: false,
      reward_coins: questRow.reward_coins,
      reward_bp_xp: questRow.reward_bp_xp,
      battle_pass_xp: xpRow ? xpRow.battle_pass_xp : null,
    };
  });
}

/**
 * Server-side progress hook, called (best-effort, never throwing) from the
 * four existing Sprint 3/6/8 files this pass adds minimal hook call sites
 * to: battle.service.js (win_battles), location.service.js
 * (distance_traveled), friend.service.js (add_friend), rescue.service.js
 * (use_sos_rescue) — see each file's own doc comment at its call site for
 * exactly which event triggers it. No-ops safely (via
 * questRepo.recordProgress's own SQL-level guard) if the player has no
 * active, not-yet-completed, TODAY-assigned quest of that goal_type — this
 * function itself never throws, so a quest-tracking failure can never break
 * the battle/location/friend/rescue flow that calls it.
 */
async function recordProgress(playerId, goalType, amount) {
  try {
    if (!playerId || !goalType || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return;
    }
    await questRepo.recordProgress(playerId, goalType, amount);
  } catch (err) {
    logger.warn('questService.recordProgress failed (best-effort, no-op on error)', {
      error: err.message,
      playerId,
      goalType,
    });
  }
}

module.exports = {
  assignTodayQuestsIfMissing,
  getQuests,
  claimQuest,
  recordProgress,
};
