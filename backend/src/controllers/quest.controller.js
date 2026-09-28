'use strict';

const playerRepo = require('../repositories/player.repository');
const questService = require('../services/quest.service');
const { success, ApiError } = require('../utils/responseEnvelope');

/**
 * Resolves the authenticated caller's own player row from req.firebaseUid.
 * Mirrors rescue.controller.js/friend.controller.js/inventory.controller.js
 * — no request body or path param is ever trusted for "who is making this
 * call".
 */
async function resolveSelf(req) {
  const player = await playerRepo.getByFirebaseUid(req.firebaseUid);
  if (!player) {
    throw new ApiError('PLAYER_NOT_FOUND', 'No player is registered for this account.', 404);
  }
  return player;
}

/** GET /quests — lazily assigns today's quests, then lists them with progress/status. */
async function listQuests(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const result = await questService.getQuests(self.player_id);
    return res.status(200).json(success(result));
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /quests/:questId/claim — Body: { request_id }. Any client-supplied
 * "progress" field in the body is never read — quest progress is always
 * server-computed (see quest.service.js#recordProgress's doc comment).
 */
async function claimQuest(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const requestId = req.body.request_id;
    const result = await questService.claimQuest(self.player_id, req.params.questId, requestId);
    return res.status(200).json(success(result));
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listQuests,
  claimQuest,
};
