'use strict';

const playerRepo = require('../repositories/player.repository');
const friendService = require('../services/friend.service');
const { success, ApiError } = require('../utils/responseEnvelope');

/**
 * Resolves the authenticated caller's own player row from req.firebaseUid.
 * Mirrors battle.controller.js/player.controller.js — no request body or
 * path param is ever trusted for "who is making this call".
 */
async function resolveSelf(req) {
  const player = await playerRepo.getByFirebaseUid(req.firebaseUid);
  if (!player) {
    throw new ApiError('PLAYER_NOT_FOUND', 'No player is registered for this account.', 404);
  }
  return player;
}

function requirePlayerId(body, field = 'player_id') {
  const value = body[field];
  if (!value || typeof value !== 'string') {
    throw new ApiError('INVALID_REQUEST', `${field} is required.`, 400);
  }
  return value;
}

/** POST /friends/request — Body: { player_id } */
async function sendRequest(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const recipientId = requirePlayerId(req.body);
    const result = await friendService.sendFriendRequest(self.player_id, recipientId);
    return res.status(200).json(success(result));
  } catch (err) {
    return next(err);
  }
}

/** POST /friends/accept — Body: { player_id } (the sender of the request being accepted) */
async function acceptRequest(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const senderId = requirePlayerId(req.body);
    const result = await friendService.acceptFriendRequest(self.player_id, senderId);
    return res.status(200).json(success(result));
  } catch (err) {
    return next(err);
  }
}

/** POST /friends/decline — Body: { player_id } */
async function declineRequest(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const senderId = requirePlayerId(req.body);
    const result = await friendService.declineFriendRequest(self.player_id, senderId);
    return res.status(200).json(success(result));
  } catch (err) {
    return next(err);
  }
}

/** DELETE /friends/:playerId */
async function removeFriend(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const result = await friendService.removeFriend(self.player_id, req.params.playerId);
    return res.status(200).json(success(result));
  } catch (err) {
    return next(err);
  }
}

/** POST /friends/block — Body: { player_id } */
async function blockPlayer(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const blockedId = requirePlayerId(req.body);
    const result = await friendService.blockPlayer(self.player_id, blockedId);
    return res.status(200).json(success(result));
  } catch (err) {
    return next(err);
  }
}

/** POST /friends/unblock — Body: { player_id } */
async function unblockPlayer(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const blockedId = requirePlayerId(req.body);
    const result = await friendService.unblockPlayer(self.player_id, blockedId);
    return res.status(200).json(success(result));
  } catch (err) {
    return next(err);
  }
}

/** GET /friends/requests */
async function listPendingRequests(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const result = await friendService.listPendingRequests(self.player_id);
    return res.status(200).json(success(result));
  } catch (err) {
    return next(err);
  }
}

/** GET /friends */
async function listFriends(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const result = await friendService.listFriends(self.player_id);
    return res.status(200).json(success({ friends: result }));
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  sendRequest,
  acceptRequest,
  declineRequest,
  removeFriend,
  blockPlayer,
  unblockPlayer,
  listPendingRequests,
  listFriends,
};
