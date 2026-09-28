'use strict';

require('dotenv').config();

/**
 * Centralized, validated environment configuration.
 * Every other module reads config through this file — never process.env directly.
 */

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name, fallback) {
  return process.env[name] ?? fallback;
}

function toBool(value, fallback) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

function toInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const NODE_ENV = optional('NODE_ENV', 'development');
const IS_TEST = NODE_ENV === 'test';

const env = {
  NODE_ENV,
  IS_PRODUCTION: NODE_ENV === 'production',
  IS_TEST,
  PORT: toInt(process.env.PORT, 3000),
  LOG_LEVEL: optional('LOG_LEVEL', 'info'),

  DATABASE_URL: IS_TEST
    ? optional('DATABASE_URL', 'postgres://nfouz:nfouz_pass@localhost:5432/nfouz_db_test')
    : required('DATABASE_URL'),
  DATABASE_SSL: toBool(process.env.DATABASE_SSL, false),
  DATABASE_POOL_MAX: toInt(process.env.DATABASE_POOL_MAX, 10),

  // Firebase is optional under test so unit tests can run without real credentials.
  FIREBASE_PROJECT_ID: IS_TEST
    ? optional('FIREBASE_PROJECT_ID', 'nfouz-test')
    : required('FIREBASE_PROJECT_ID'),
  FIREBASE_CLIENT_EMAIL: IS_TEST
    ? optional('FIREBASE_CLIENT_EMAIL', 'test@nfouz-test.iam.gserviceaccount.com')
    : required('FIREBASE_CLIENT_EMAIL'),
  FIREBASE_PRIVATE_KEY: IS_TEST
    ? optional('FIREBASE_PRIVATE_KEY', '-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n')
    : required('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),

  CORS_ALLOWED_ORIGINS: optional('CORS_ALLOWED_ORIGINS', '*')
    .split(',')
    .map((origin) => origin.trim()),

  // Sprint 4 — Nearby Players System: configurable radius/result limits
  // and the recency window used to decide "online" for nearby purposes
  // (no separate presence store is queried here — see location.service.js
  // for the reasoning).
  NEARBY_DEFAULT_RADIUS_METERS: toInt(process.env.NEARBY_DEFAULT_RADIUS_METERS, 1000),
  NEARBY_MAX_RADIUS_METERS: toInt(process.env.NEARBY_MAX_RADIUS_METERS, 5000),
  NEARBY_MAX_RESULTS: toInt(process.env.NEARBY_MAX_RESULTS, 50),
  NEARBY_ONLINE_THRESHOLD_SECONDS: toInt(process.env.NEARBY_ONLINE_THRESHOLD_SECONDS, 120),

  // Sprint 5 — Photon Multiplayer Foundation: battle challenge validation
  // and session grace-period timing. See Battle System v1.0 section 1 for
  // the 15x15m arena and Sprint 5 spec for the 15s disconnect grace period.
  BATTLE_MAX_CHALLENGE_DISTANCE_METERS: toInt(process.env.BATTLE_MAX_CHALLENGE_DISTANCE_METERS, 20),
  BATTLE_DISCONNECT_GRACE_SECONDS: toInt(process.env.BATTLE_DISCONNECT_GRACE_SECONDS, 15),
  BATTLE_READY_TIMEOUT_SECONDS: toInt(process.env.BATTLE_READY_TIMEOUT_SECONDS, 30),
  BATTLE_SESSION_MAX_DURATION_SECONDS: toInt(process.env.BATTLE_SESSION_MAX_DURATION_SECONDS, 90),

  // Sprint 6 — Full Combat System: battle resolution. Values are NOT new
  // design — they are the already-approved GDD v1.0 section 7 (Influence
  // System: +15 win / -10 loss) and section 8 (Control System: 120 minute
  // Controlled duration) numbers, which the backend is only now
  // implementing for the first time. Must stay equal to Unity's
  // Constants.Influence.WinDelta/LossDelta and Constants.Control.ControlDurationMinutes.
  INFLUENCE_WIN_DELTA: toInt(process.env.INFLUENCE_WIN_DELTA, 15),
  INFLUENCE_LOSS_DELTA: toInt(process.env.INFLUENCE_LOSS_DELTA, -10),
  CONTROL_DURATION_MINUTES: toInt(process.env.CONTROL_DURATION_MINUTES, 120),

  // Sprint 6 final security correction — signed authoritative battle
  // result. Host Mode Alpha limitation: "host" means whichever player
  // client holds the Photon Fusion room's host role, not a separate
  // server process — see battle.service.js resolveBattle's doc comment.
  // These are anti-cheat/anomaly bounds, not new gameplay design values.
  COMBAT_RULES_VERSION: optional('COMBAT_RULES_VERSION', '6.1.0'),
  RESULT_MAX_AGE_SECONDS: toInt(process.env.RESULT_MAX_AGE_SECONDS, 120),
  RESULT_MAX_CLOCK_SKEW_SECONDS: toInt(process.env.RESULT_MAX_CLOCK_SKEW_SECONDS, 15),
  RESULT_MAX_DURATION_SECONDS: toInt(process.env.RESULT_MAX_DURATION_SECONDS, 130), // 90s Battle + 30s Overtime + buffer
  RESULT_MAX_PLAUSIBLE_HEALTH: toInt(process.env.RESULT_MAX_PLAUSIBLE_HEALTH, 500), // coarse anomaly bound — highest approved MaxHealth is Titan's 140

  // Sprint 6 final gameplay-completion pass — Alpha security mode
  // (explicit "provisional" tier). A result that passes every hard check
  // above (signature, participants, nonce, not a duplicate, not expired,
  // not contradictory) but trips one of these SOFTER plausibility
  // heuristics is still accepted and recorded (so it can't be replayed),
  // but is marked 'pending_review' rather than 'resolved' — Influence and
  // Control are withheld until a human reviews it. These are heuristics,
  // not proof of cheating: a real match can legitimately (if rarely) end
  // very quickly or run close to the timeout, so the thresholds are
  // intentionally looser than RESULT_MAX_DURATION_SECONDS/
  // RESULT_MAX_PLAUSIBLE_HEALTH above, which remain hard, non-negotiable
  // rejections for values that are outright impossible.
  RESULT_SUSPICIOUS_MIN_DURATION_SECONDS: toInt(process.env.RESULT_SUSPICIOUS_MIN_DURATION_SECONDS, 2), // faster than this to a decisive kill is implausible
  RESULT_SUSPICIOUS_DURATION_SECONDS: toInt(process.env.RESULT_SUSPICIOUS_DURATION_SECONDS, 125), // within 5s of the 130s hard cap
  RESULT_SUSPICIOUS_HEALTH_THRESHOLD: toInt(process.env.RESULT_SUSPICIOUS_HEALTH_THRESHOLD, 160), // above every approved class's MaxHealth (Titan's 140 is highest) but still under the 500 hard cap

  // Sprint 8 — Friends system.
  FRIEND_LIMIT: toInt(process.env.FRIEND_LIMIT, 100),
  FRIEND_REQUEST_EXPIRY_DAYS: toInt(process.env.FRIEND_REQUEST_EXPIRY_DAYS, 7),

  // Sprint 8 — SOS system.
  SOS_MAX_NOTIFIED_FRIENDS: toInt(process.env.SOS_MAX_NOTIFIED_FRIENDS, 10),
  SOS_FRIENDSHIP_MIN_AGE_HOURS: toInt(process.env.SOS_FRIENDSHIP_MIN_AGE_HOURS, 24),
  // Reuses the same "online" recency proxy as the Nearby Players System
  // (NEARBY_ONLINE_THRESHOLD_SECONDS) rather than a second presence store.

  // Sprint 8 — Rescue system (remote virtual rescue: reservation -> guard
  // battle -> success/failure; no physical navigation, no Mapbox route).
  RESCUE_RESERVATION_TIMEOUT_SECONDS: toInt(process.env.RESCUE_RESERVATION_TIMEOUT_SECONDS, 30),
  RESCUE_GUARD_BATTLE_DURATION_SECONDS: toInt(process.env.RESCUE_GUARD_BATTLE_DURATION_SECONDS, 60),
  RESCUE_MIN_CONTROL_REMAINING_SECONDS: toInt(process.env.RESCUE_MIN_CONTROL_REMAINING_SECONDS, 90),
  RESCUE_PROTECTION_MINUTES: toInt(process.env.RESCUE_PROTECTION_MINUTES, 30),
  RESCUE_REWARD_CREDITS: toInt(process.env.RESCUE_REWARD_CREDITS, 50),
  RESCUE_REWARD_XP: toInt(process.env.RESCUE_REWARD_XP, 80),
  RESCUE_MAX_REWARDED_PER_DAY: toInt(process.env.RESCUE_MAX_REWARDED_PER_DAY, 3),
  RESCUE_SAME_TARGET_COOLDOWN_HOURS: toInt(process.env.RESCUE_SAME_TARGET_COOLDOWN_HOURS, 24),
  // Sprint 8 correction (final pass) — "Failed attempt cooldown is 10
  // minutes": after a rescue attempt on a given SOS fails, no new
  // acceptMission for that SAME sos_id is allowed until this many minutes
  // have passed since that failure's resolved_at.
  RESCUE_FAILED_ATTEMPT_COOLDOWN_MINUTES: toInt(process.env.RESCUE_FAILED_ATTEMPT_COOLDOWN_MINUTES, 10),

  // Sprint 8 Critical Security Patch — "Guard battle success must be
  // validated authoritatively": the server, not the client, now decides
  // whether a guard battle is won. Reimplementing RescueGuardCombat.cs's
  // real-time combat (timing windows, dodge inputs) server-side would be a
  // full redesign of an already-built system, which this patch is
  // explicitly scoped NOT to do. Instead, the authoritative outcome is
  // decided by the SERVER at guard-battle START time (before the client
  // can possibly know it) via a fair weighted coin flip, stored, and never
  // overridden by whatever the client later reports — see
  // rescue.service.js#startGuardBattle/resolveGuardBattle. This constant
  // is the base win probability for that roll.
  RESCUE_GUARD_BATTLE_SUCCESS_PROBABILITY: parseFloat(process.env.RESCUE_GUARD_BATTLE_SUCCESS_PROBABILITY || '0.65'),

  // Sprint 8 correction (final pass) — SOS may re-announce to friends in up
  // to 3 notification rounds, at least this many minutes apart. A duplicate
  // createSos call is what triggers the next round (see sos.service.js).
  SOS_MAX_NOTIFICATION_ROUNDS: toInt(process.env.SOS_MAX_NOTIFICATION_ROUNDS, 3),
  SOS_NOTIFICATION_ROUND_MIN_INTERVAL_MINUTES: toInt(process.env.SOS_NOTIFICATION_ROUND_MIN_INTERVAL_MINUTES, 15),

  // Sprint 8 — Rescue Guard combat stats (approved GDD values).
  RESCUE_GUARD_HEALTH: toInt(process.env.RESCUE_GUARD_HEALTH, 160),
  RESCUE_GUARD_MOVE_SPEED_MPS: parseFloat(process.env.RESCUE_GUARD_MOVE_SPEED_MPS || '4.6'),
  RESCUE_GUARD_BASIC_DAMAGE: toInt(process.env.RESCUE_GUARD_BASIC_DAMAGE, 15),
  RESCUE_GUARD_BASIC_RANGE_METERS: parseFloat(process.env.RESCUE_GUARD_BASIC_RANGE_METERS || '2'),
  RESCUE_GUARD_BASIC_WINDUP_SECONDS: parseFloat(process.env.RESCUE_GUARD_BASIC_WINDUP_SECONDS || '0.35'),
  RESCUE_GUARD_BASIC_CYCLE_SECONDS: parseFloat(process.env.RESCUE_GUARD_BASIC_CYCLE_SECONDS || '1.2'),
  RESCUE_GUARD_SPECIAL_INTERVAL_SECONDS: toInt(process.env.RESCUE_GUARD_SPECIAL_INTERVAL_SECONDS, 8),
  RESCUE_GUARD_SPECIAL_DAMAGE: toInt(process.env.RESCUE_GUARD_SPECIAL_DAMAGE, 24),
  RESCUE_GUARD_SPECIAL_RANGE_METERS: parseFloat(process.env.RESCUE_GUARD_SPECIAL_RANGE_METERS || '3'),
  RESCUE_GUARD_SPECIAL_WINDUP_SECONDS: parseFloat(process.env.RESCUE_GUARD_SPECIAL_WINDUP_SECONDS || '0.9'),
};

module.exports = env;
