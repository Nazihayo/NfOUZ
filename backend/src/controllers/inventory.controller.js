'use strict';

const playerRepo = require('../repositories/player.repository');
const inventoryService = require('../services/inventory.service');
const { success, ApiError } = require('../utils/responseEnvelope');

/**
 * Resolves the authenticated caller's own player row from req.firebaseUid.
 * Mirrors rescue.controller.js/friend.controller.js/sos.controller.js — no
 * request body or path param is ever trusted for "who is making this call",
 * and inventory ownership is therefore always resolved from THIS player_id,
 * never a client-supplied one.
 */
async function resolveSelf(req) {
  const player = await playerRepo.getByFirebaseUid(req.firebaseUid);
  if (!player) {
    throw new ApiError('PLAYER_NOT_FOUND', 'No player is registered for this account.', 404);
  }
  return player;
}

function requireItemKey(body) {
  const value = body.item_key;
  if (!value || typeof value !== 'string') {
    throw new ApiError('INVALID_REQUEST', 'item_key is required.', 400);
  }
  return value;
}

function requireRequestId(body) {
  const value = body.request_id;
  if (!value || typeof value !== 'string') {
    throw new ApiError('INVALID_REQUEST', 'request_id is required.', 400);
  }
  return value;
}

/** GET /inventory */
async function listInventory(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const result = await inventoryService.listInventory(self.player_id);
    return res.status(200).json(success(result));
  } catch (err) {
    return next(err);
  }
}

/** POST /inventory/equip — Body: { item_key, request_id } */
async function equip(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const itemKey = requireItemKey(req.body);
    const requestId = requireRequestId(req.body);
    // Any client-supplied "progress"/ownership claim in the body beyond
    // item_key/request_id is simply never read — ownership is resolved
    // exclusively from the database row for self.player_id inside the
    // service layer.
    const result = await inventoryService.equipWeapon(self.player_id, itemKey, requestId);
    return res.status(200).json(success(result));
  } catch (err) {
    return next(err);
  }
}

/** POST /inventory/use — Body: { item_key, request_id } */
async function use(req, res, next) {
  try {
    const self = await resolveSelf(req);
    const itemKey = requireItemKey(req.body);
    const requestId = requireRequestId(req.body);
    const result = await inventoryService.useConsumable(self.player_id, itemKey, requestId);
    return res.status(200).json(success(result));
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listInventory,
  equip,
  use,
};
