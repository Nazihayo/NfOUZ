'use strict';

const playerRepo = require('../repositories/player.repository');
const sosService = require('../services/sos.service');
const { success, ApiError } = require('../utils/responseEnvelope');

async function resolveSelf(req) {
  const player = await playerRepo.getByFirebaseUid(req.firebaseUid);
  if (!player) {
    throw new ApiError('PLAYER_NOT_FOUND', 'No player is registered for this account.', 404);
  }
  return player;
}

/** POST /sos */
async function createSos(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const result = await sosService.createSos(self.player_id);
    return res.status(200).json(
      success({
        sos_id: result.sos.sos_id,
        status: result.sos.status,
        duplicate: result.duplicate,
        notified_friend_ids: result.notified_friend_ids,
      })
    );
  } catch (err) {
    return next(err);
  }
}

/** GET /sos/:sosId */
async function getSos(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const sos = await sosService.getById(req.params.sosId);
    // Sprint 8 Critical Security Patch — prevents the SOS IDOR: only the
    // owner, the recorded rescuer, or an eligible friend of the owner may
    // view this SOS. See sos.service.js#assertCanViewSos.
    await sosService.assertCanViewSos(sos, self.player_id);
    return res.status(200).json(
      success({
        sos_id: sos.sos_id,
        player_id: sos.player_id,
        status: sos.status,
        created_at: sos.created_at,
        resolved_at: sos.resolved_at,
        rescuer_id: sos.rescuer_id,
      })
    );
  } catch (err) {
    return next(err);
  }
}

module.exports = { createSos, getSos };
