'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Rate limiters keyed on the authenticated player's Firebase uid rather
 * than IP — multiple players can legitimately share a network (same
 * building, campus Wi-Fi). See Firebase Security Package v1.0, section 7.
 * These middlewares must run AFTER verifyFirebaseToken so req.firebaseUid
 * is already populated.
 */

function keyByFirebaseUid(req) {
  return req.firebaseUid || req.ip;
}

const standardEnvelope = (code, message) => ({
  success: false,
  data: null,
  error: { code, message },
});

const locationUpdateLimiter = rateLimit({
  windowMs: 4 * 1000,
  max: 1,
  keyGenerator: keyByFirebaseUid,
  standardHeaders: true,
  legacyHeaders: false,
  message: standardEnvelope('RATE_LIMITED', 'Too many location updates. Try again shortly.'),
});

const nearbyQueryLimiter = rateLimit({
  windowMs: 5 * 1000,
  max: 3,
  keyGenerator: keyByFirebaseUid,
  standardHeaders: true,
  legacyHeaders: false,
  message: standardEnvelope('RATE_LIMITED', 'Too many nearby-player queries. Try again shortly.'),
});

// Sprint 5 — Photon Multiplayer Foundation: throttles challenge spam
// distinct from the DUPLICATE_CHALLENGE business rule enforced in
// battle.service.js (this limiter is about request rate, not state).
const battleChallengeLimiter = rateLimit({
  windowMs: 5 * 1000,
  max: 2,
  keyGenerator: keyByFirebaseUid,
  standardHeaders: true,
  legacyHeaders: false,
  message: standardEnvelope('RATE_LIMITED', 'Too many challenge requests. Try again shortly.'),
});

// Sprint 8 — Friends system: throttles request spam distinct from the
// idempotency/limit business rules enforced in friend.service.js.
const friendRequestLimiter = rateLimit({
  windowMs: 5 * 1000,
  max: 3,
  keyGenerator: keyByFirebaseUid,
  standardHeaders: true,
  legacyHeaders: false,
  message: standardEnvelope('RATE_LIMITED', 'Too many friend requests. Try again shortly.'),
});

// Sprint 8 — SOS system: a controlled player mashing the SOS button gets
// throttled at the transport layer; sos.service.js's own idempotent
// "duplicate SOS returns the existing one" logic handles the business rule.
const sosCreateLimiter = rateLimit({
  windowMs: 5 * 1000,
  max: 2,
  keyGenerator: keyByFirebaseUid,
  standardHeaders: true,
  legacyHeaders: false,
  message: standardEnvelope('RATE_LIMITED', 'Too many SOS requests. Try again shortly.'),
});

module.exports = {
  locationUpdateLimiter,
  nearbyQueryLimiter,
  battleChallengeLimiter,
  friendRequestLimiter,
  sosCreateLimiter,
};
