'use strict';

const authService = require('../services/auth.service');
const { success } = require('../utils/responseEnvelope');

/**
 * POST /auth/register
 * Body: { username: string, class_type: 'Scout' | 'Ranger' | 'Titan' }
 * Requires a valid Firebase ID token (see auth.middleware.js).
 */
async function register(req, res, next) {
  try {
    const { username, class_type: classType } = req.body;
    const player = await authService.registerPlayer(req.firebaseUid, { username, classType });
    return res.status(201).json(success(player));
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /auth/me
 * Requires a valid Firebase ID token. Returns the player row for the
 * currently authenticated account, or 404 PLAYER_NOT_FOUND if this
 * Firebase account has not completed /auth/register yet — the client
 * routes to Onboarding in that case (see Scene Architecture v1.0,
 * section 15).
 */
async function me(req, res, next) {
  try {
    const player = await authService.getSessionByFirebaseUid(req.firebaseUid);
    return res.status(200).json(success(player));
  } catch (err) {
    return next(err);
  }
}

module.exports = { register, me };
