'use strict';

const crypto = require('crypto');
const env = require('../config/env');
const db = require('../config/database');
const battleRepo = require('../repositories/battle.repository');
const playerRepo = require('../repositories/player.repository');
const influenceLogRepo = require('../repositories/influenceLog.repository');
const controlRelationshipRepo = require('../repositories/controlRelationship.repository');
const { haversineDistanceMeters } = require('../utils/geoUtils');
const { ApiError } = require('../utils/responseEnvelope');
const resultSignature = require('../utils/battleResultSignature');
const questService = require('./quest.service'); // Sprint 9 — best-effort quest progress hook only, see resolveBattle's decisive-win branch below.
const logger = require('../utils/logger');

/**
 * Sprint 5 — Photon Multiplayer Foundation: battle challenge + session
 * business logic. Server-authoritative per the Master Developer Handbook's
 * golden rules — the client never dictates whether a challenge is valid,
 * only requests one.
 *
 * Sprint 6 — Full Combat System adds resolveBattle() at the bottom of this
 * file: battle result persistence + Influence/Control updates.
 *
 * Sprint 6 final security correction — signed authoritative battle
 * result. The two earlier resolveBattle() contracts (raw winner_id/
 * loser_id, then a caller-reported outcome string) both ultimately
 * trusted a value an ordinary client typed into a request body. Neither
 * is trusted anymore. The client no longer sends outcome, winner_id,
 * loser_id, health, or damage values that the server takes at face
 * value — it sends a `result` payload plus a `signature`, and the
 * server:
 *   1. Recomputes the HMAC-SHA256 signature over the result's fields
 *      using the per-battle secret this battle's HOST client alone was
 *      given (see createChallenge), and rejects anything that doesn't
 *      match byte-for-byte (timing-safe compare).
 *   2. Validates battle_id, both participant ids, the Photon room name,
 *      the combat rules_version, the match_nonce, and that event_seq is
 *      strictly greater than this battle's last recorded value (rejects
 *      duplicates/replays).
 *   3. Validates the payload isn't expired (issued_at within
 *      RESULT_MAX_AGE_SECONDS, allowing RESULT_MAX_CLOCK_SKEW_SECONDS of
 *      clock drift) and that duration/health values are within coarse
 *      anomaly bounds, and that the claimed outcome isn't self-
 *      contradictory against the claimed final health values (e.g. a
 *      "draw" where someone is already dead is impossible under this
 *      game's own rules — see HandleOvertimeTimeEnd/HandleDeath in
 *      BattleManager.cs, which never produce that combination).
 *
 * HOST MODE ALPHA — READ THIS BEFORE TRUSTING THIS AS "SERVER-
 * AUTHORITATIVE": Photon Fusion Host Mode has no separate server process
 * running combat. The "host" is one of the two player clients — by
 * convention here, the attacker's client, since it is always the one
 * that creates the Photon room (see createChallenge below). This
 * signature scheme proves a result came from whichever client held that
 * role for this specific battle, and that it hasn't been tampered with,
 * replayed, or forged by the OTHER (non-host) client. It does NOT prove
 * the host's own health/damage arithmetic was honest — a modified host
 * client can still sign a self-favoring result. That gap is why this
 * function also runs the anomaly/plausibility bounds in step 3 above,
 * and why this whole scheme is documented, here and in every related
 * comment, as limited anti-cheat for Host Mode Alpha — never as full
 * server authority. Full combat-log replay validation against the
 * server's own physics/damage simulation remains explicitly out of
 * scope until a dedicated server-authoritative or relay/cloud hosting
 * mode is built.
 *
 * Sprint 7 — Influence + Control: createChallenge now enforces the
 * Control state that resolveBattle has granted since Sprint 6 but that
 * nothing previously checked — a Controlled player (attacker or
 * defender) cannot issue or receive a new challenge until their window
 * elapses (player.repository.js#isControlActive/clearExpiredControl).
 * resolveBattle's response also now carries winner_rank/loser_rank,
 * computed from the new Influence total — see config/rankTiers.js for
 * the exact GDD-authoritative tier thresholds.
 *
 * Sprint 7 continuation — GDD-exact Influence/Rank/Control/Protection:
 * createChallenge additionally rejects a Protected attacker or defender
 * (player.repository.js#isProtected) — "challenge eligibility must check
 * both Control and protection." resolveBattle now: skips all Influence/
 * Control/rank effects for a 'training' battle (battles.battle_type,
 * migration 016) exactly like it already skips for a draw or
 * pending_review result; logs the ACTUAL (post-floor) Influence delta via
 * adjustInfluence's returned `applied_delta`, alongside the nominal
 * per-event constant, in influence_log; records both players' rank-
 * cosmetic unlocks (player_rank_unlocks — add-only, so a later demotion
 * never revokes one); and, when the loser of an eligible battle is
 * themselves currently controlling other players, releases every one of
 * those outgoing Control relationships before applying the new incoming
 * one to the loser — all inside the same transaction as everything else
 * ("perform this atomically inside the battle-resolution transaction").
 *
 * ALPHA SECURITY MODE (Sprint 6 final gameplay-completion pass): the
 * host's signature is PROVISIONAL, not a security guarantee on its own.
 * A signed result that passes every hard check above but trips one of
 * evaluateSuspicion's softer plausibility heuristics (implausibly fast
 * or implausibly slow duration, implausible final health) is still
 * accepted and recorded — so it can never be resubmitted or replayed —
 * but is left in 'pending_review' status instead of 'resolved'.
 * Influence and Control are NOT granted for a pending_review battle;
 * see the withTransaction block below. A Dedicated Server (real,
 * server-run combat simulation, not a signing client) remains required
 * before any of this can be called full server authority or used for
 * competitive public release. The host_authority_secret itself is never
 * included in any log line, error message, or API response anywhere in
 * this file — it is read once here to verify a signature and discarded.
 */

/**
 * Generates the Photon room (session) name for a battle. MUST be
 * `battle_{battle_id}` exactly — this is not a style choice, it is the
 * approved room-lifecycle contract: Photon & Mapbox Integration v1.0
 * section 1.2 step 2 ("الخادم يطلب من Photon Fusion Cloud إنشاء Session
 * جديدة باسم battle_{battle_id}") and Unity MVP Implementation Plan
 * v1.0's Phase 5 Photon Requirements line say the same thing. A
 * previous revision of this function generated an unrelated random
 * token instead — corrected here; do not reintroduce a random token.
 */
function generatePhotonRoomName(battleId) {
  return `battle_${battleId}`;
}

/**
 * Creates a new battle challenge. Validates, in order:
 *   1. Both players exist.
 *   2. Attacker is not challenging themselves.
 *   3. Neither player is CURRENTLY Controlled (Sprint 7 — Influence +
 *      Control: a Controlled player can neither issue nor receive a new
 *      challenge until their Control window elapses) or CURRENTLY
 *      Protected (Sprint 7 continuation — GDD section 4: "challenge
 *      eligibility must check both Control and protection").
 *   4. Neither player already has an active (in_progress) battle
 *      (duplicate-challenge prevention).
 *   5. The two players are within BATTLE_MAX_CHALLENGE_DISTANCE_METERS
 *      of the claimed location (mirrors the client-side
 *      ChallengeInteractionController.maxChallengeDistanceMeters check —
 *      never trusted from the client alone).
 *
 * Movement-synchronization only: this does not touch combat state.
 */
async function createChallenge(attackerId, defenderId, location) {
  if (attackerId === defenderId) {
    throw new ApiError('INVALID_CHALLENGE', 'A player cannot challenge themselves.', 400);
  }

  const [attacker, defender] = await Promise.all([
    playerRepo.getById(attackerId),
    playerRepo.getById(defenderId),
  ]);

  if (!attacker) {
    throw new ApiError('PLAYER_NOT_FOUND', 'Attacker player does not exist.', 404);
  }
  if (!defender) {
    throw new ApiError('PLAYER_NOT_FOUND', 'Defender player does not exist.', 404);
  }

  // Sprint 7 (Influence + Control): self-heal any stale is_controlled row
  // whose window has already passed — see clearExpiredControl's doc
  // comment. This is a persistence cleanup only; the actual authorization
  // decision below always uses the time-based isControlActive/isProtected
  // checks against the rows already fetched above, never the raw stored
  // flags. clearExpiredControl never grants Protection (see its doc
  // comment) so it has no bearing on the isProtected checks below.
  await Promise.all([
    playerRepo.clearExpiredControl(attackerId),
    playerRepo.clearExpiredControl(defenderId),
  ]);

  if (playerRepo.isControlActive(attacker)) {
    throw new ApiError('PLAYER_IS_CONTROLLED', 'You are currently Controlled and cannot issue a challenge.', 403);
  }
  if (playerRepo.isControlActive(defender)) {
    throw new ApiError('PLAYER_IS_CONTROLLED', 'Target is currently Controlled and cannot be challenged.', 403);
  }
  // Sprint 7 continuation (GDD section 4 — Protection): "Protected players
  // cannot enter competitive challenges" — checked as its own condition,
  // independent of Control, since a player can be Protected without being
  // Controlled (post-rescue/release) and the two never overlap in
  // practice (applyIncomingControl always clears protected_until).
  if (playerRepo.isProtected(attacker)) {
    throw new ApiError('PLAYER_IS_PROTECTED', 'You are currently Protected and cannot issue a challenge.', 403);
  }
  if (playerRepo.isProtected(defender)) {
    throw new ApiError('PLAYER_IS_PROTECTED', 'Target is currently Protected and cannot be challenged.', 403);
  }

  const [attackerActive, defenderActive] = await Promise.all([
    battleRepo.findActiveBattleForPlayer(attackerId),
    battleRepo.findActiveBattleForPlayer(defenderId),
  ]);

  if (attackerActive) {
    throw new ApiError('DUPLICATE_CHALLENGE', 'Attacker already has an active battle in progress.', 409);
  }
  if (defenderActive) {
    throw new ApiError('DUPLICATE_CHALLENGE', 'Defender already has an active battle in progress.', 409);
  }

  if (location && typeof defender.last_lat === 'number' && typeof defender.last_lng === 'number') {
    const distance = haversineDistanceMeters(
      location.lat,
      location.lng,
      defender.last_lat,
      defender.last_lng
    );
    if (distance > env.BATTLE_MAX_CHALLENGE_DISTANCE_METERS) {
      throw new ApiError(
        'TARGET_OUT_OF_RANGE',
        `Defender is ${Math.round(distance)}m away, outside the ${env.BATTLE_MAX_CHALLENGE_DISTANCE_METERS}m challenge range.`,
        400
      );
    }
  }

  // battle_id is generated here, BEFORE insert, specifically so the
  // Photon room name can be derived from it up front (battle_id first,
  // room name second — never the other way around). See
  // generatePhotonRoomName's doc comment for the source of this rule.
  const battleId = crypto.randomUUID();
  const photonRoomName = generatePhotonRoomName(battleId);
  const sessionExpiresAt = new Date(Date.now() + env.BATTLE_SESSION_MAX_DURATION_SECONDS * 1000);

  // Sprint 6 final security correction: the attacker's client is always
  // the one that requests this challenge and therefore always the one
  // that creates the Photon room, so it is treated as this battle's Host
  // Mode host by convention (see this file's header comment for why that
  // is a real limitation, not full server authority). hostAuthoritySecret
  // is generated here and returned ONLY in this response — see
  // battle.controller.js createChallenge, which must never forward it to
  // anyone but this same caller, and GET /battle/{battleId} must never
  // expose it to either participant afterward.
  const hostPlayerId = attackerId;
  const hostAuthoritySecret = resultSignature.generateSecret();
  const matchNonce = resultSignature.generateNonce();

  const battle = await battleRepo.createBattle({
    battleId,
    attackerId,
    defenderId,
    photonRoomName,
    locationLat: location ? location.lat : null,
    locationLng: location ? location.lng : null,
    sessionExpiresAt,
    hostPlayerId,
    hostAuthoritySecret,
    matchNonce,
    rulesVersion: env.COMBAT_RULES_VERSION,
  });

  return battle;
}

/**
 * Retrieves a battle by id. Used for GET /battle/{battleId} and for
 * clients re-checking session state after a reconnect.
 */
async function getBattleById(battleId) {
  const battle = await battleRepo.getById(battleId);
  if (!battle) {
    throw new ApiError('BATTLE_NOT_FOUND', 'No battle exists with this id.', 404);
  }
  return battle;
}

/**
 * Resolves which side ('attacker' | 'defender') a player is on for a
 * given battle, throwing FORBIDDEN if they are not a participant at all.
 */
function resolveSide(battle, playerId) {
  if (battle.attacker_id === playerId) return 'attacker';
  if (battle.defender_id === playerId) return 'defender';
  throw new ApiError('FORBIDDEN', 'You are not a participant in this battle.', 403);
}

/**
 * Marks the calling player as ready inside the battle session (loading
 * synchronization / ready confirmation, per Sprint 5 Battle Scene spec).
 */
async function setReady(battleId, playerId) {
  const battle = await getBattleById(battleId);
  const side = resolveSide(battle, playerId);

  if (battle.status !== 'in_progress') {
    throw new ApiError('SESSION_EXPIRED', 'This battle session is no longer active.', 409);
  }

  return battleRepo.setPlayerReady(battleId, side);
}

/**
 * Handles a disconnect notification for one side. Starts the 15-second
 * grace period (env.BATTLE_DISCONNECT_GRACE_SECONDS) during which a
 * reconnect is still accepted. This function only records session
 * state — it does NOT decide the battle outcome.
 */
async function handleDisconnect(battleId, playerId) {
  const battle = await getBattleById(battleId);
  const side = resolveSide(battle, playerId);

  if (battle.status !== 'in_progress') {
    throw new ApiError('SESSION_EXPIRED', 'This battle session is no longer active.', 409);
  }

  const disconnectedAt = new Date();
  const reconnectDeadline = new Date(disconnectedAt.getTime() + env.BATTLE_DISCONNECT_GRACE_SECONDS * 1000);

  return battleRepo.recordDisconnect(battleId, side, disconnectedAt, reconnectDeadline);
}

/**
 * Handles a reconnect within the grace period. If the deadline has
 * already passed, the reconnect is rejected — the caller (controller)
 * is responsible for triggering forfeit handling separately, since a
 * missed deadline is normally detected by a timeout check, not by the
 * player's own reconnect attempt arriving late.
 */
async function handleReconnect(battleId, playerId) {
  const battle = await getBattleById(battleId);
  const side = resolveSide(battle, playerId);

  const deadlineField = side === 'attacker' ? 'attacker_reconnect_deadline' : 'defender_reconnect_deadline';
  const deadline = battle[deadlineField];

  if (battle.status !== 'in_progress') {
    throw new ApiError('SESSION_EXPIRED', 'This battle session is no longer active.', 409);
  }

  if (deadline && new Date(deadline).getTime() < Date.now()) {
    throw new ApiError('RECONNECT_WINDOW_EXPIRED', 'The 15-second reconnect grace period has already elapsed.', 409);
  }

  return battleRepo.clearDisconnect(battleId, side);
}

/**
 * Checks whether a disconnected player's grace period has elapsed and,
 * if so, marks the battle forfeited by that player. Safe to call
 * repeatedly (idempotent — markForfeited only affects 'in_progress'
 * rows). Sprint 5 scope: session state (forfeit flag) only — no
 * winner/loser/Influence computation, which is Sprint 6.
 */
async function checkForfeit(battleId) {
  const battle = await getBattleById(battleId);

  if (battle.status !== 'in_progress') {
    return battle;
  }

  const now = Date.now();

  const attackerExpired =
    battle.attacker_disconnected_at &&
    battle.attacker_reconnect_deadline &&
    new Date(battle.attacker_reconnect_deadline).getTime() < now;

  const defenderExpired =
    battle.defender_disconnected_at &&
    battle.defender_reconnect_deadline &&
    new Date(battle.defender_reconnect_deadline).getTime() < now;

  if (attackerExpired) {
    return battleRepo.markForfeited(battleId, battle.attacker_id);
  }
  if (defenderExpired) {
    return battleRepo.markForfeited(battleId, battle.defender_id);
  }

  return battle;
}

const VALID_OUTCOMES = new Set(['attacker_win', 'defender_win', 'draw']);
const REQUIRED_RESULT_FIELDS = [
  'battle_id',
  'room_name',
  'rules_version',
  'match_nonce',
  'event_seq',
  'attacker_id',
  'defender_id',
  'attacker_final_health',
  'defender_final_health',
  'outcome',
  'duration_seconds',
  'issued_at',
];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Sprint 6 final gameplay-completion pass — Alpha security mode. These
 * are HEURISTICS layered on top of the hard, non-negotiable bounds
 * already enforced above (RESULT_MAX_DURATION_SECONDS /
 * RESULT_MAX_PLAUSIBLE_HEALTH) — a value outside those hard bounds is
 * rejected outright (INVALID_RESOLUTION) and never reaches here. A
 * signed, otherwise fully valid result that trips one of THESE softer
 * checks is not rejected — a real match can rarely but legitimately end
 * very quickly or run right up to the timeout — it is instead accepted
 * and recorded but held as 'pending_review' rather than immediately
 * granting Influence/Control. See this file's header comment and
 * 015_battle_pending_review.sql.
 */
function evaluateSuspicion({ durationSeconds, attackerHealth, defenderHealth }) {
  const reasons = [];

  if (durationSeconds < env.RESULT_SUSPICIOUS_MIN_DURATION_SECONDS) {
    reasons.push(`duration_seconds (${durationSeconds}) is implausibly fast for a decisive result.`);
  }
  if (durationSeconds >= env.RESULT_SUSPICIOUS_DURATION_SECONDS) {
    reasons.push(`duration_seconds (${durationSeconds}) is within the suspicious range just under the hard timeout bound.`);
  }
  if (attackerHealth >= env.RESULT_SUSPICIOUS_HEALTH_THRESHOLD) {
    reasons.push(`attacker_final_health (${attackerHealth}) exceeds every approved class's MaxHealth.`);
  }
  if (defenderHealth >= env.RESULT_SUSPICIOUS_HEALTH_THRESHOLD) {
    reasons.push(`defender_final_health (${defenderHealth}) exceeds every approved class's MaxHealth.`);
  }

  return { suspicious: reasons.length > 0, reasons };
}

/**
 * Resolves a battle's final outcome from a SIGNED authoritative result
 * payload — see this file's header comment for the full threat model and
 * the Host Mode Alpha limitation. `outcome` is now absolute
 * ('attacker_win' | 'defender_win' | 'draw'), not caller-relative: the
 * result names both participants explicitly and is verified before any
 * of its fields are trusted, so there is no more "the caller's own
 * outcome" framing to exploit.
 *
 * Idempotency + atomicity: everything that mutates state — the battle
 * status UPDATE (which also records last_event_seq), both players'
 * Influence adjustments, the loser's Control write, and both Influence
 * log rows — runs inside a single PostgreSQL transaction
 * (config/database.js's withTransaction). The UPDATE's
 * `WHERE status = 'in_progress'` guard still runs first inside that same
 * transaction, so a race between two resolve calls can neither
 * double-apply Influence nor partially apply it.
 *
 * A Draw applies no Influence change and creates no Control state —
 * winner_id/loser_id are persisted as NULL and the response's
 * influence/control fields are null.
 */
async function resolveBattle(battleId, callerId, { result, signature }) {
  const battle = await getBattleById(battleId);
  resolveSide(battle, callerId); // throws FORBIDDEN if the caller isn't a participant at all

  if (battle.status !== 'in_progress') {
    throw new ApiError('SESSION_EXPIRED', 'This battle has already been resolved or ended.', 409);
  }

  // --- Structural validation: reject an unsigned/malformed payload before
  // trusting any of its fields. ---
  if (!isPlainObject(result) || typeof signature !== 'string' || signature.length === 0) {
    throw new ApiError('INVALID_RESOLUTION', 'A signed result payload and signature are required.', 400);
  }
  for (const field of REQUIRED_RESULT_FIELDS) {
    if (result[field] === undefined || result[field] === null || result[field] === '') {
      throw new ApiError('INVALID_RESOLUTION', `Result payload is missing required field '${field}'.`, 400);
    }
  }

  // --- Signature verification: nothing below this point is trusted until
  // this passes. Verified against the secret issued ONLY to this
  // battle's host at challenge time (see createChallenge). ---
  if (!resultSignature.verifySignature(result, signature, battle.host_authority_secret)) {
    throw new ApiError('INVALID_SIGNATURE', 'Result signature is missing, malformed, or does not match this battle.', 403);
  }

  // --- Identity / session-binding validation. ---
  if (result.battle_id !== battleId) {
    throw new ApiError('INVALID_RESOLUTION', 'Result battle_id does not match the requested battle.', 400);
  }
  if (result.room_name !== battle.photon_room_name) {
    throw new ApiError('INVALID_RESOLUTION', 'Result room_name does not match this battle\'s Photon room.', 400);
  }
  if (result.rules_version !== battle.rules_version) {
    throw new ApiError('INVALID_RESOLUTION', 'Result was produced under a different combat rules_version than this battle was created with.', 400);
  }
  if (result.attacker_id !== battle.attacker_id || result.defender_id !== battle.defender_id) {
    throw new ApiError('PARTICIPANT_MISMATCH', 'Result participants do not match this battle\'s real attacker/defender.', 400);
  }
  if (result.match_nonce !== battle.match_nonce) {
    throw new ApiError('INVALID_RESOLUTION', 'Result match_nonce does not match this battle\'s current match attempt.', 400);
  }

  // --- Duplicate / replay guard. ---
  const eventSeq = Number(result.event_seq);
  if (!Number.isInteger(eventSeq) || eventSeq <= battle.last_event_seq) {
    throw new ApiError('DUPLICATE_RESULT', 'Result event_seq must strictly exceed this battle\'s last recorded value.', 409);
  }

  // --- Expiry check (clock-skew tolerant). ---
  const issuedAtMs = Date.parse(result.issued_at);
  if (Number.isNaN(issuedAtMs)) {
    throw new ApiError('INVALID_RESOLUTION', 'Result issued_at is not a valid timestamp.', 400);
  }
  const ageSeconds = (Date.now() - issuedAtMs) / 1000;
  if (ageSeconds > env.RESULT_MAX_AGE_SECONDS || ageSeconds < -env.RESULT_MAX_CLOCK_SKEW_SECONDS) {
    throw new ApiError('RESULT_EXPIRED', 'Result payload is expired or issued too far in the future.', 400);
  }

  // --- Server-side anomaly bounds (Host Mode Alpha limited anti-cheat —
  // see this file's header comment: these are coarse plausibility
  // checks, not a substitute for real combat-log replay validation). ---
  const durationSeconds = Number(result.duration_seconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > env.RESULT_MAX_DURATION_SECONDS) {
    throw new ApiError('INVALID_RESOLUTION', 'Result duration_seconds is outside the plausible range for a match.', 400);
  }

  const attackerHealth = Number(result.attacker_final_health);
  const defenderHealth = Number(result.defender_final_health);
  if (
    !Number.isInteger(attackerHealth) || attackerHealth < 0 || attackerHealth > env.RESULT_MAX_PLAUSIBLE_HEALTH ||
    !Number.isInteger(defenderHealth) || defenderHealth < 0 || defenderHealth > env.RESULT_MAX_PLAUSIBLE_HEALTH
  ) {
    throw new ApiError('INVALID_RESOLUTION', 'Result final health values are outside the plausible range.', 400);
  }

  if (!VALID_OUTCOMES.has(result.outcome)) {
    throw new ApiError('INVALID_RESOLUTION', "outcome must be one of 'attacker_win', 'defender_win', or 'draw'.", 400);
  }

  // --- Outcome/health contradiction checks. Under this game's own rules
  // (BattleManager.cs: HandleDeath always ends the match immediately with
  // a winner; HandleOvertimeTimeEnd only ever produces a Draw when both
  // combatants are still alive), these combinations can never legitimately
  // occur, so any result claiming one is rejected as contradictory rather
  // than trusted. ---
  if (result.outcome === 'draw' && (attackerHealth <= 0 || defenderHealth <= 0)) {
    throw new ApiError('CONTRADICTORY_RESULT', 'A Draw is impossible when either combatant\'s final health is 0 — death always produces a decisive winner.', 400);
  }
  if (result.outcome === 'attacker_win' && attackerHealth <= 0) {
    throw new ApiError('CONTRADICTORY_RESULT', 'attacker_win is impossible when the attacker\'s own final health is 0.', 400);
  }
  if (result.outcome === 'defender_win' && defenderHealth <= 0) {
    throw new ApiError('CONTRADICTORY_RESULT', 'defender_win is impossible when the defender\'s own final health is 0.', 400);
  }

  let winnerId = null;
  let loserId = null;
  if (result.outcome === 'attacker_win') {
    winnerId = battle.attacker_id;
    loserId = battle.defender_id;
  } else if (result.outcome === 'defender_win') {
    winnerId = battle.defender_id;
    loserId = battle.attacker_id;
  }
  // 'draw' -> winnerId/loserId both stay null.

  const roundedDuration = Math.round(durationSeconds);

  // --- Alpha security mode (Sprint 6 final gameplay-completion pass): a
  // fully valid, signed result can still be provisional — see
  // evaluateSuspicion's doc comment and this file's header comment. ---
  const suspicion = evaluateSuspicion({ durationSeconds: roundedDuration, attackerHealth, defenderHealth });
  const resolvedStatus = suspicion.suspicious ? 'pending_review' : 'resolved';

  return db.withTransaction(async (client) => {
    const resolved = await battleRepo.resolveBattle(
      battleId,
      { winnerId, loserId, durationSeconds: roundedDuration, eventSeq, status: resolvedStatus },
      client
    );
    if (!resolved) {
      // Lost the race to another resolve call between getBattleById above
      // and this UPDATE — the SQL-level 'in_progress' guard caught it.
      // Throwing here rolls back the transaction (nothing was written).
      throw new ApiError('SESSION_EXPIRED', 'This battle has already been resolved or ended.', 409);
    }

    if (suspicion.suspicious) {
      // Recorded (winner_id/loser_id/duration_seconds/last_event_seq are
      // all persisted above) so the claim can't be replayed, but NO
      // Influence adjustment, Control write, or Influence log happens —
      // this result is provisional until a human reviews it.
      return {
        battle_id: battleId,
        result: 'pending_review',
        winner_influence: null,
        loser_influence: null,
        loser_controlled_until: null,
        pending_review_reasons: suspicion.reasons,
      };
    }

    if (result.outcome === 'draw') {
      return {
        battle_id: battleId,
        result: 'draw',
        winner_influence: null,
        loser_influence: null,
        loser_controlled_until: null,
      };
    }

    // Sprint 7 continuation (GDD: "Cancelled, training and pending_review
    // battles: no Influence change") — a training battle still resolves
    // (status/winner/loser/duration are already persisted above by the
    // battleRepo.resolveBattle call, same as any other battle) but grants
    // no Influence, no rank change, and no Control, exactly like the
    // pending_review/draw branches above.
    if (battle.battle_type === 'training') {
      return {
        battle_id: battleId,
        result: result.outcome,
        winner_influence: null,
        loser_influence: null,
        loser_controlled_until: null,
      };
    }

    const controlledUntil = new Date(Date.now() + env.CONTROL_DURATION_MINUTES * 60 * 1000);

    const winnerRow = await playerRepo.adjustInfluence(winnerId, env.INFLUENCE_WIN_DELTA, client);
    const loserRow = await playerRepo.adjustInfluence(loserId, env.INFLUENCE_LOSS_DELTA, client);

    // Sprint 7 continuation (GDD section 3 — Control): "If a controller
    // loses an eligible battle: release all active outgoing Control
    // relationships, then apply the new incoming Control relationship to
    // the losing controller. Perform this atomically inside the
    // battle-resolution transaction." Both calls run against `client`,
    // inside this same withTransaction block, and in this exact order —
    // release-then-apply — so a losing controller's own outgoing
    // relationships are always torn down before their own incoming one is
    // written, never the reverse.
    await playerRepo.releaseOutgoingControl(loserId, client);
    await playerRepo.applyIncomingControl(loserId, winnerId, controlledUntil, client);

    // Sprint 8 correction (final pass) — the same two events, now also
    // recorded explicitly in control_relationships so SOS has a stable
    // UUID to reference: (1) every relationship the loser held AS A
    // CONTROLLER is closed (mirrors releaseOutgoingControl above), and
    // (2) any relationship the loser was already THE CONTROLLED PARTY of
    // is closed as superseded before the new one opens — applyIncomingControl
    // above unconditionally overwrites players.controller_id the same way,
    // "does not stack or extend" — then the new active relationship is
    // created. All in the same transaction as the writes above.
    await controlRelationshipRepo.closeAllActiveForController(loserId, 'released_as_controller_defeated', client);
    await controlRelationshipRepo.closeActiveForControlled(loserId, 'superseded_by_new_capture', client);
    await controlRelationshipRepo.create(loserId, winnerId, battleId, controlledUntil, client);

    // Sprint 7 continuation (GDD: "record the actual deducted amount in
    // influence_log") — `applied_delta` is the ACTUAL post-floor change
    // (see player.repository.js#adjustInfluence's CTE), which can differ
    // from the nominal per-event constant once a loser's Influence is
    // clamped at the 0 floor (e.g. losing the nominal -10 at 5 Influence
    // only actually applies -5). Both values are recorded side by side.
    await influenceLogRepo.log(winnerId, winnerRow.applied_delta, 'battle_win', battleId, client, env.INFLUENCE_WIN_DELTA);
    await influenceLogRepo.log(loserId, loserRow.applied_delta, 'battle_loss', battleId, client, env.INFLUENCE_LOSS_DELTA);

    // Sprint 7 continuation (GDD: "unlocked cosmetic rewards remain
    // unlocked after rank loss") — add-only ledger insert per player per
    // rank name; ON CONFLICT DO NOTHING inside recordRankUnlock means a
    // rank the player has already reached before is a harmless no-op here,
    // never re-inserted or overwritten.
    await playerRepo.recordRankUnlock(winnerId, winnerRow.rank, client);
    await playerRepo.recordRankUnlock(loserId, loserRow.rank, client);

    // Sprint 9 — Quest System: server-side "Win 2 Battles" progress for a
    // decisive, eligible (non-draw, non-training, non-pending_review) win
    // only. Best-effort and never allowed to affect this already-committed
    // battle resolution — see quest.service.js#recordProgress's own
    // internal try/catch, mirrored here defensively as well.
    try {
      await questService.recordProgress(winnerId, 'win_battles', 1);
    } catch (err) {
      logger.warn('Sprint 9 quest progress hook failed (best-effort, ignored)', { error: err.message, winnerId });
    }

    return {
      battle_id: battleId,
      result: result.outcome, // 'attacker_win' or 'defender_win' — absolute, not caller-relative
      winner_influence: winnerRow.influence,
      winner_rank: winnerRow.rank, // Sprint 7 (Influence + Control) — see config/rankTiers.js
      loser_influence: loserRow.influence,
      loser_rank: loserRow.rank,
      loser_controlled_until: controlledUntil,
    };
  });
}

module.exports = {
  generatePhotonRoomName,
  createChallenge,
  getBattleById,
  resolveSide,
  setReady,
  handleDisconnect,
  handleReconnect,
  checkForfeit,
  resolveBattle,
};
