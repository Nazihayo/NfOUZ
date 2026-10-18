'use strict';

const env = require('../config/env');

/**
 * When an in_progress battle can no longer finish normally, and what it
 * becomes. Applied lazily (no scheduler) by battle.repository.js
 * expireStaleBattles whenever a battle or a player's active battle is
 * looked up, so a battle that never produced a result cannot block its
 * players (DUPLICATE_CHALLENGE / ACTIVE_BATTLE_IN_PROGRESS) forever.
 *
 * Rules, in priority order:
 *   1. Forfeit — the existing Sprint 5 rule (formerly only in
 *      checkForfeit): a participant reported a disconnect and their
 *      reconnect deadline (BATTLE_DISCONNECT_GRACE_SECONDS) has passed →
 *      'forfeited', forfeited_by = that participant (attacker first).
 *      Session state only, as before: no winner, Influence or Control.
 *   2. Ready timeout — the two players were not both ready within
 *      BATTLE_READY_TIMEOUT_SECONDS of the challenge → 'cancelled'.
 *   3. No-result cutoff — no valid result can be accepted any more →
 *      'cancelled'. Derived only from existing limits: ready timeout +
 *      countdown + longest accepted result duration + oldest accepted
 *      result + allowed clock skew (30 + 3 + 130 + 120 + 15 = 298 s by
 *      default). An honest result always arrives before it.
 *
 * Deliberately NOT session_expires_at (challenge + 90 s): Unity's 90 s
 * match timer and 30 s overtime only start after loading, ready and the
 * countdown, so that timestamp would cancel real battles.
 */
function battleLifecycleLimits(config = env) {
  const readyTimeoutSeconds = config.BATTLE_READY_TIMEOUT_SECONDS;
  return {
    readyTimeoutSeconds,
    noResultCutoffSeconds:
      readyTimeoutSeconds
      + config.BATTLE_COUNTDOWN_SECONDS
      + config.RESULT_MAX_DURATION_SECONDS
      + config.RESULT_MAX_AGE_SECONDS
      + config.RESULT_MAX_CLOCK_SKEW_SECONDS,
  };
}

module.exports = { battleLifecycleLimits };
