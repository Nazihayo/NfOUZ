'use strict';

const db = require('../config/database');
const { buildRankCaseSql } = require('../config/rankTiers');
const controlRelationshipRepo = require('./controlRelationship.repository');

/**
 * All SQL touching the `players` table lives here — services never
 * write raw queries directly. See Backend Implementation Guide v1.0,
 * section 4.
 */

async function getByFirebaseUid(firebaseUid) {
  const result = await db.query('SELECT * FROM players WHERE firebase_uid = $1', [firebaseUid]);
  return result.rows[0] || null;
}

/**
 * `executor` defaults to the shared pool but accepts a transaction client
 * — added for creditsService.js#applyEligibleIncome, which needs to read
 * a player's live is_controlled/controller_id/controlled_since state
 * inside the same transaction as the Credits writes that follow, not via
 * a separate connection that could see a different snapshot.
 */
async function getById(playerId, executor = db) {
  const result = await executor.query('SELECT * FROM players WHERE player_id = $1', [playerId]);
  return result.rows[0] || null;
}

async function getByUsername(username) {
  const result = await db.query('SELECT * FROM players WHERE username = $1', [username]);
  return result.rows[0] || null;
}

async function create({ firebaseUid, username, classType }) {
  const result = await db.query(
    `INSERT INTO players (firebase_uid, username, class_type)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [firebaseUid, username, classType]
  );
  return result.rows[0];
}

/**
 * Persists a new confirmed location for a player. Always called after
 * location.service.js has already validated the speed implied by the
 * previous location — this function trusts its caller and simply writes.
 */
async function updateLocation(playerId, { lat, lng, timestamp }) {
  const result = await db.query(
    `UPDATE players
     SET last_lat = $1, last_lng = $2, last_location_at = $3, updated_at = now()
     WHERE player_id = $4
     RETURNING player_id, last_lat, last_lng, last_location_at`,
    [lat, lng, timestamp, playerId]
  );
  return result.rows[0] || null;
}

/**
 * Prefilters players within a rectangular lat/lng box (leverages
 * idx_players_visible_location), applying every Sprint 4 visibility rule
 * in SQL rather than in application code:
 *   - excludes the requesting player
 *   - excludes players with is_visible = FALSE (ghost mode)
 *   - excludes players whose last_location_at is older than onlineSince
 *     (the recency-based "online" proxy — see location.service.js)
 *   - excludes any player with a 'blocked' friendship row in either
 *     direction against the requesting player
 * Exact circular-radius filtering and distance sorting still happen
 * afterward in location.service.js.
 */
async function findWithinBoundingBox(box, excludePlayerId, onlineSince) {
  const result = await db.query(
    `SELECT p.player_id, p.username, p.class_type, p.last_lat, p.last_lng, p.is_controlled, p.controlled_until, p.protected_until
     FROM players p
     WHERE p.last_lat IS NOT NULL
       AND p.last_lng IS NOT NULL
       AND p.last_lat BETWEEN $1 AND $2
       AND p.last_lng BETWEEN $3 AND $4
       AND p.player_id <> $5
       AND p.is_visible = TRUE
       AND p.last_location_at >= $6
       AND NOT EXISTS (
         SELECT 1 FROM friendships f
         WHERE f.status = 'blocked'
           AND (
             (f.player_id = $5 AND f.friend_id = p.player_id) OR
             (f.player_id = p.player_id AND f.friend_id = $5)
           )
       )`,
    [box.minLat, box.maxLat, box.minLng, box.maxLng, excludePlayerId, onlineSince]
  );
  return result.rows;
}

// The new-influence expression is repeated verbatim inside the rank CASE
// below (see buildRankCaseSql's doc comment) — a SET clause's expressions
// all read the row's OLD values, so the rank CASE can't reference the
// `influence` column's newly-written value directly and must recompute
// it the same way instead.
const NEW_INFLUENCE_SQL = 'GREATEST(0, influence + $1)';
const RANK_CASE_SQL = buildRankCaseSql(NEW_INFLUENCE_SQL);

/**
 * Applies a signed Influence delta (positive for an eligible win,
 * negative for an eligible loss) and floors the result at 0, matching
 * the `influence INT NOT NULL DEFAULT 100 CHECK (influence >= 0)`
 * constraint on the players table (002_players.sql) — GREATEST(0, ...)
 * prevents that CHECK from ever rejecting the write on a large enough
 * loss streak. See the latest detailed NFOUZ GDD's Influence System
 * section.
 *
 * Sprint 7 continuation: also recomputes and persists `rank` from the
 * new Influence value in the same statement, using the exact GDD tier
 * thresholds in config/rankTiers.js (no more placeholder tiers). Because
 * rankForInfluence always recomputes from scratch rather than only ever
 * moving up, this naturally handles rank DEMOTION too — no separate
 * demotion code path is needed.
 *
 * Also returns the ACTUAL applied delta (`applied_delta` = new influence
 * - old influence), which can differ from the nominal `delta` passed in
 * when the GREATEST(0, ...) floor clips it (e.g. losing 10 Influence at
 * 5 Influence only actually applies -5) — battle.service.js logs THIS
 * value to influence_log, not the nominal per-event constant, per the
 * GDD's "record the actual deducted amount" requirement. A `WITH before
 * AS (...)` CTE captures the pre-update value in the same statement so
 * this stays one round trip and one atomic write.
 *
 * `executor` defaults to the shared pool's `query()` but accepts a
 * transaction client (see config/database.js's withTransaction) instead
 * — Sprint 6 correction pass: battle.service.js's resolveBattle() runs
 * this inside the same transaction as the battle-status UPDATE, the
 * Control write, and the Influence log inserts, so a failure partway
 * through never leaves Influence changed without everything else.
 */
async function adjustInfluence(playerId, delta, executor = db) {
  const result = await executor.query(
    `WITH before AS (
       SELECT influence AS old_influence FROM players WHERE player_id = $2
     )
     UPDATE players
     SET influence = ${NEW_INFLUENCE_SQL},
         rank = ${RANK_CASE_SQL},
         updated_at = now()
     FROM before
     WHERE player_id = $2
     RETURNING players.player_id, players.influence, players.rank,
               (players.influence - before.old_influence) AS applied_delta`,
    [delta, playerId]
  );
  return result.rows[0] || null;
}

/**
 * Sprint 7 continuation — Rank cosmetic unlocks: "unlocked cosmetic
 * rewards remain unlocked after rank loss" means a reached rank is
 * recorded PERMANENTLY the first time it's reached and never removed
 * when the player's live `rank` later drops back down (that live value
 * lives on `players.rank`, recomputed on every adjustInfluence — this
 * table is the separate, add-only history of every tier ever attained).
 * `ON CONFLICT DO NOTHING` makes this safe to call on every Influence
 * change regardless of whether the rank actually changed this time.
 */
async function recordRankUnlock(playerId, rankName, executor = db) {
  const result = await executor.query(
    `INSERT INTO player_rank_unlocks (player_id, rank_name)
     VALUES ($1, $2)
     ON CONFLICT (player_id, rank_name) DO NOTHING
     RETURNING player_id, rank_name, unlocked_at`,
    [playerId, rankName]
  );
  return result.rows[0] || null; // null means this rank was already unlocked previously
}

async function getUnlockedRanks(playerId, executor = db) {
  const result = await executor.query(
    `SELECT rank_name, unlocked_at FROM player_rank_unlocks WHERE player_id = $1 ORDER BY unlocked_at ASC`,
    [playerId]
  );
  return result.rows;
}

/**
 * Sprint 7 continuation — applies a NEW incoming Control relationship:
 * `controllerId` becomes this player's controller, `controlledUntil` is
 * the absolute expiry, and `controlled_since` is stamped to `now()` so
 * credit_transfers can later scope its per-relationship cap to only
 * transfers that happened under THIS capture (see
 * creditsService.js/016_control_protection_credits.sql). Any existing
 * Control state is fully OVERWRITTEN, never extended or stacked — this
 * one absolute write is what "does not stack or extend" means in
 * practice. Also clears `protected_until`: a player who is freshly
 * captured is, by definition, not under Protection right now (Protection
 * only ever follows a RELEASE, never a capture).
 */
async function applyIncomingControl(playerId, controllerId, controlledUntil, executor = db) {
  const result = await executor.query(
    `UPDATE players
     SET is_controlled = TRUE,
         controller_id = $1,
         controlled_until = $2,
         controlled_since = now(),
         protected_until = NULL,
         updated_at = now()
     WHERE player_id = $3
     RETURNING player_id, is_controlled, controller_id, controlled_until, controlled_since`,
    [controllerId, controlledUntil, playerId]
  );
  return result.rows[0] || null;
}

/**
 * Sprint 7 continuation — releases every OUTGOING Control relationship a
 * player currently holds AS A CONTROLLER (i.e. every row where
 * `controller_id = controllerId`), used when that controller themselves
 * suffers an eligible loss: "release all active outgoing Control
 * relationships, then apply the new incoming Control relationship to the
 * losing controller." This must run BEFORE applyIncomingControl for the
 * same player inside the same transaction — see battle.service.js. Grants
 * no Protection (that's only for the RELEASED players' own controllers,
 * not automatic here) — released players simply become free.
 */
async function releaseOutgoingControl(controllerId, executor = db) {
  const result = await executor.query(
    `UPDATE players
     SET is_controlled = FALSE,
         controller_id = NULL,
         controlled_until = NULL,
         controlled_since = NULL,
         updated_at = now()
     WHERE controller_id = $1
     RETURNING player_id`,
    [controllerId]
  );
  return result.rows; // every player who was freed, for audit/notification purposes
}

/**
 * Sprint 7 continuation — pure, time-based check for whether a player is
 * CURRENTLY Controlled. `is_controlled` is set once (by
 * applyIncomingControl) and nothing else clears it back to FALSE on its
 * own: no cron job, no lazy expiry-on-read, no trigger. Every caller that
 * needs to know whether a player is controlled RIGHT NOW must go through
 * this function rather than trusting the raw `is_controlled` column,
 * which can be stale by up to the full Control duration. Takes a plain
 * player row (must include `is_controlled` and `controlled_until`) so it
 * needs no database access of its own and is trivially unit-testable.
 */
function isControlActive(player, now = new Date()) {
  if (!player || !player.is_controlled || !player.controlled_until) {
    return false;
  }
  return new Date(player.controlled_until).getTime() > now.getTime();
}

/**
 * Sprint 7 continuation — pure, time-based check for whether a player is
 * CURRENTLY Protected (post-rescue/voluntary-release/admin-invalidation
 * only — normal Control timer expiry never sets protected_until at all,
 * per the GDD, so this is naturally false after a plain expiry). Same
 * staleness caveat and unit-testability as isControlActive.
 */
function isProtected(player, now = new Date()) {
  if (!player || !player.protected_until) {
    return false;
  }
  return new Date(player.protected_until).getTime() > now.getTime();
}

/**
 * Self-healing persistence step: once a Controlled window has actually
 * passed, this clears the stored Control columns so any OTHER direct
 * reader of the `players` table (not just code that remembers to call
 * isControlActive) eventually sees the truth too. The WHERE clause only
 * ever matches a row that is both marked controlled AND already past its
 * own controlled_until, so this is safe to call unconditionally and
 * often (e.g. on every challenge attempt) — it is a no-op write for
 * anyone not actually expired. Authorization decisions must still use
 * isControlActive on the row already in hand rather than waiting on this
 * write to land. Deliberately does NOT set protected_until — plain timer
 * expiry grants no Protection per the GDD (see isProtected's doc
 * comment).
 */
async function clearExpiredControl(playerId, executor = db) {
  const result = await executor.query(
    `UPDATE players
     SET is_controlled = FALSE, controller_id = NULL, controlled_until = NULL, controlled_since = NULL, updated_at = now()
     WHERE player_id = $1 AND is_controlled = TRUE AND controlled_until <= now()
     RETURNING player_id, is_controlled, controlled_until`,
    [playerId]
  );
  const row = result.rows[0] || null;
  // Sprint 8 correction (final pass) — explicit close of the authoritative
  // control_relationships record whenever this self-heal actually fires
  // (a no-op call when nothing was expired). Uses the same `executor` as
  // the write above, so it is atomic with it whenever the caller passes a
  // transaction client, and best-effort-consistent (same as every other
  // self-healing call in this codebase) when it doesn't.
  if (row) {
    await controlRelationshipRepo.closeActiveForControlled(playerId, 'timer_expiry', executor);
  }
  return row;
}

/**
 * Sprint 7 continuation — the ONE release path that DOES grant
 * Protection: a successful SOS rescue, a voluntary release by the
 * controller, or an administrative invalidation ("Control ends through:
 * ... Successful SOS rescue, Voluntary controller release,
 * Administrative invalidation" — all three are "another approved
 * release" for GDD section 4's Protection grant, unlike plain timer
 * expiry). Clears every Control column exactly like clearExpiredControl,
 * then additionally sets `protected_until` 30 minutes out.
 *
 * Sprint 8 correction (final pass) — `endReason` is now ALSO persisted:
 * the caller's active control_relationships row for this player is
 * explicitly closed with it ('rescue', 'voluntary_release', or
 * 'administrative_invalidation' — see the CHECK constraint in
 * 017_friends_sos_rescue_fcm.sql for the exact allowed set). Only
 * 'rescue' has an actual caller today (rescue.service.js#resolveGuardBattle);
 * voluntary release and administrative invalidation have no existing
 * endpoint anywhere in this codebase to trigger them, so those two reason
 * strings exist in the schema/repository for when such an endpoint is
 * built, not because one already calls this function with them.
 */
async function releaseControlWithProtection(playerId, protectedUntil, endReason, executor = db) {
  const result = await executor.query(
    `UPDATE players
     SET is_controlled = FALSE, controller_id = NULL, controlled_until = NULL, controlled_since = NULL,
         protected_until = $1, updated_at = now()
     WHERE player_id = $2
     RETURNING player_id, is_controlled, protected_until`,
    [protectedUntil, playerId]
  );
  const row = result.rows[0] || null;
  if (row) {
    await controlRelationshipRepo.closeActiveForControlled(playerId, endReason, executor);
  }
  return row;
}

/**
 * Sprint 7 continuation — Control economy foundation: applies a Credits
 * change to a single player's balance. Never allowed to go negative
 * (`credits >= 0` CHECK on the table, GREATEST(0, ...) here mirrors
 * adjustInfluence's own floor) — the GDD's "never create debt" rule.
 * `executor` — see adjustInfluence's doc comment.
 */
async function adjustCredits(playerId, delta, executor = db) {
  const result = await executor.query(
    `UPDATE players
     SET credits = GREATEST(0, credits + $1), updated_at = now()
     WHERE player_id = $2
     RETURNING player_id, credits`,
    [delta, playerId]
  );
  return result.rows[0] || null;
}

/**
 * Sprint 8 — grants XP (e.g. a successful rescue's flat 80 XP reward).
 * Floored at 0 via the same GREATEST pattern as adjustInfluence/
 * adjustCredits, though XP is never expected to go negative in practice.
 * Deliberately does NOT touch `influence` or `rank` — XP and Influence are
 * separate progression tracks (a rescue reward "never grants Influence").
 */
async function adjustExperience(playerId, delta, executor = db) {
  const result = await executor.query(
    `UPDATE players
     SET experience = GREATEST(0, experience + $1), updated_at = now()
     WHERE player_id = $2
     RETURNING player_id, experience`,
    [delta, playerId]
  );
  return result.rows[0] || null;
}

// Sprint 8 correction — push-token storage moved to a dedicated
// player_devices table (one player -> many devices); see
// repositories/playerDevice.repository.js. There is no players.fcm_token
// column any more, so no updateFcmToken belongs in this file.

module.exports = {
  getByFirebaseUid,
  getById,
  getByUsername,
  create,
  updateLocation,
  findWithinBoundingBox,
  adjustInfluence,
  adjustExperience,
  recordRankUnlock,
  getUnlockedRanks,
  applyIncomingControl,
  releaseOutgoingControl,
  isControlActive,
  isProtected,
  clearExpiredControl,
  releaseControlWithProtection,
  adjustCredits,
};
