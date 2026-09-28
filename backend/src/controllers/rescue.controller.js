'use strict';

const playerRepo = require('../repositories/player.repository');
const rescueService = require('../services/rescue.service');
const { success, ApiError } = require('../utils/responseEnvelope');

/**
 * Resolves the authenticated caller's own player row from req.firebaseUid.
 * Mirrors friend.controller.js/sos.controller.js — no request body or path
 * param is ever trusted for "who is making this call".
 */
async function resolveSelf(req) {
  const player = await playerRepo.getByFirebaseUid(req.firebaseUid);
  if (!player) {
    throw new ApiError('PLAYER_NOT_FOUND', 'No player is registered for this account.', 404);
  }
  return player;
}

/** POST /rescue/accept — Body: { sos_id } */
async function acceptMission(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const sosId = req.body.sos_id;
    if (!sosId || typeof sosId !== 'string') {
      throw new ApiError('INVALID_REQUEST', 'sos_id is required.', 400);
    }
    const mission = await rescueService.acceptMission(sosId, self.player_id);
    return res.status(200).json(
      success({
        mission_id: mission.mission_id,
        sos_id: mission.sos_id,
        status: mission.status,
        reservation_expires_at: mission.reservation_expires_at,
      })
    );
  } catch (err) {
    return next(err);
  }
}

/** POST /rescue/:missionId/guard-battle/start */
async function startGuardBattle(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const mission = await rescueService.startGuardBattle(req.params.missionId, self.player_id);
    return res.status(200).json(
      success({
        mission_id: mission.mission_id,
        status: mission.status,
        guard_battle_ends_at: mission.guard_battle_ends_at,
        // Sprint 8 Critical Security Patch — the one-time token the client
        // must echo back to /guard-battle/resolve. Deliberately the ONLY
        // guard-battle field returned here besides status/timing — the
        // authoritative guard_battle_outcome itself is never sent to the
        // client, before or after the battle plays out.
        guard_battle_token: mission.guard_battle_token,
      })
    );
  } catch (err) {
    return next(err);
  }
}

/** POST /rescue/:missionId/guard-battle/resolve — Body: { outcome: 'success' | 'failure', guard_battle_token } */
async function resolveGuardBattle(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const outcome = req.body.outcome;
    const guardBattleToken = req.body.guard_battle_token;
    if (!guardBattleToken || typeof guardBattleToken !== 'string') {
      throw new ApiError('INVALID_REQUEST', 'guard_battle_token is required.', 400);
    }
    const result = await rescueService.resolveGuardBattle(req.params.missionId, self.player_id, outcome, guardBattleToken);
    return res.status(200).json(
      success({
        mission_id: result.mission.mission_id,
        status: result.mission.status,
        rewarded: result.rewarded,
      })
    );
  } catch (err) {
    return next(err);
  }
}

module.exports = { acceptMission, startGuardBattle, resolveGuardBattle };
