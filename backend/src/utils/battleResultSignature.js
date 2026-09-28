'use strict';

const crypto = require('crypto');

/**
 * Sprint 6 final security correction — signed authoritative battle-result
 * payload.
 *
 * Host Mode Alpha limitation: there is no separate server process running
 * combat in Photon Fusion Host Mode — the "host" is one of the two player
 * clients (by convention here, the attacker's client, since
 * battle.service.js createChallenge makes the attacker's client the room
 * creator). This signature therefore proves a result came from whichever
 * client held that battle's host role, generated from a per-battle secret
 * only that client ever receives — it does NOT prove the host's own
 * reported health/damage numbers are truthful. That is why
 * battle.service.js resolveBattle additionally runs plausibility/anomaly
 * checks (duration bounds, health bounds, outcome/health contradiction
 * checks) on top of signature verification, and why this is documented
 * everywhere as limited anti-cheat, never as full server authority.
 *
 * The signed string is a fixed-order, pipe-joined canonicalization of the
 * result fields — deliberately NOT JSON.stringify, since key ordering in
 * JSON.stringify is not guaranteed identical between a JS client (if ever
 * used) and this server, and would make an otherwise-valid signature
 * fail to verify.
 */

function canonicalizeResult(result) {
  return [
    result.battle_id,
    result.room_name,
    result.rules_version,
    result.match_nonce,
    String(result.event_seq),
    result.attacker_id,
    result.defender_id,
    String(result.attacker_final_health),
    String(result.defender_final_health),
    result.outcome,
    String(result.duration_seconds),
    result.issued_at,
  ].join('|');
}

/**
 * Computes the HMAC-SHA256 signature (lowercase hex) for a result payload
 * under the given per-battle secret.
 */
function signResult(result, secret) {
  return crypto.createHmac('sha256', secret).update(canonicalizeResult(result)).digest('hex');
}

/**
 * Verifies `signature` against `result` under `secret`, using a
 * timing-safe comparison. Returns false (never throws) for any malformed
 * input, so callers can treat every failure mode as "invalid signature"
 * uniformly.
 */
function verifySignature(result, signature, secret) {
  if (!secret || !signature || typeof signature !== 'string') {
    return false;
  }

  const expected = signResult(result, secret);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

/** Generates a new random per-battle signing secret (hex string). */
function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/** Generates a new random per-battle match nonce (hex string). */
function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { canonicalizeResult, signResult, verifySignature, generateSecret, generateNonce };
