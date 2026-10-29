'use strict';

const playerRepo = require('../repositories/player.repository');
const playerDeviceRepo = require('../repositories/playerDevice.repository');
const locationService = require('../services/location.service');
const { parseRegisterDeviceBody, parseDeactivateDeviceBody } = require('../utils/deviceValidation');
const { success, ApiError } = require('../utils/responseEnvelope');

async function assertOwnPlayerId(req) {
  const player = await playerRepo.getByFirebaseUid(req.firebaseUid);
  if (!player) {
    throw new ApiError('PLAYER_NOT_FOUND', 'No player is registered for this account.', 404);
  }
  if (player.player_id !== req.params.id) {
    throw new ApiError('FORBIDDEN', 'You may only change your own player.', 403);
  }
  return player;
}

function toCoordinate(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

async function updateLocation(req, res, next) {
  try {
    const player = await assertOwnPlayerId(req);
    // Number(null), Number('') and Number([]) are 0: only a number or a
    // numeric string counts, anything else becomes NaN and is rejected.
    const lat = toCoordinate(req.body.lat);
    const lng = toCoordinate(req.body.lng);
    const result = await locationService.updatePlayerLocation(player.player_id, lat, lng);
    return res.status(200).json(success(result));
  } catch (err) {
    return next(err);
  }
}

/**
 * A device row's response representation — deliberately NEVER includes
 * fcm_token. "Never return FCM tokens through an API response" applies
 * even to the caller re-registering their own token; the client already
 * has the token (it generated it), so there is nothing legitimate to gain
 * by echoing it back, and doing so would be one more place a token could
 * leak (logs, error-tracking breadcrumbs of the response body, etc).
 */
function toDeviceResponse(device) {
  return {
    device_id: device.device_id,
    player_id: device.player_id,
    platform: device.platform,
    is_active: device.is_active,
    updated_at: device.updated_at,
  };
}

/**
 * PATCH /player/:id/fcm-token — Sprint 8 correction (final pass).
 * Body: { device_key: string, fcm_token: string, platform: 'android'|'ios' }.
 * Registers or refreshes exactly ONE device (a player can have several).
 *
 * Security: a token already registered to a DIFFERENT player is rejected
 * with 409 FCM_TOKEN_CONFLICT rather than silently reassigned — see
 * playerDevice.repository.js#registerDevice's doc comment. Never returns
 * or logs the raw token (toDeviceResponse omits it; ApiError messages
 * here never interpolate req.body.fcm_token).
 */
async function updateFcmToken(req, res, next) {
  try {
    const player = await assertOwnPlayerId(req);
    const { deviceKey, fcmToken, platform } = parseRegisterDeviceBody(req.body);

    let device;
    try {
      device = await playerDeviceRepo.registerDevice(player.player_id, deviceKey, fcmToken, platform);
    } catch (err) {
      if (err.code === 'FCM_TOKEN_CONFLICT') {
        throw new ApiError('FCM_TOKEN_CONFLICT', 'This push token is already registered to a different player.', 409);
      }
      throw err;
    }

    return res.status(200).json(success(toDeviceResponse(device)));
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /player/:id/devices/deactivate — Sprint 8 correction (final pass).
 * Body: { device_key: string }. Normal sign-out: deactivates ONLY the
 * caller's current device, identified by its own device_key — never all
 * of the player's devices (see deactivateAllDevices below for that).
 */
async function deactivateDevice(req, res, next) {
  try {
    const player = await assertOwnPlayerId(req);
    const { deviceKey } = parseDeactivateDeviceBody(req.body);

    const device = await playerDeviceRepo.deactivateDevice(player.player_id, deviceKey);
    if (!device) {
      throw new ApiError('DEVICE_NOT_FOUND', 'No device with this device_key is registered to you.', 404);
    }

    return res.status(200).json(success(toDeviceResponse(device)));
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /player/:id/devices/deactivate-all — Sprint 8 correction (final
 * pass). "Account-wide device deactivation must be a separate privileged
 * operation": a distinct endpoint the client must explicitly call, never
 * an implicit side effect of an ordinary token registration or a single
 * device's sign-out (compare deactivateDevice above).
 */
async function deactivateAllDevices(req, res, next) {
  try {
    const player = await assertOwnPlayerId(req);
    const devices = await playerDeviceRepo.deactivateAllDevices(player.player_id);
    return res.status(200).json(success({ player_id: player.player_id, deactivated_count: devices.length }));
  } catch (err) {
    return next(err);
  }
}

async function getNearby(req, res, next) {
  try {
    const requestingPlayer = await playerRepo.getByFirebaseUid(req.firebaseUid);
    if (!requestingPlayer) {
      throw new ApiError('PLAYER_NOT_FOUND', 'No player is registered for this account.', 404);
    }
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radius = req.query.radius !== undefined ? Number(req.query.radius) : undefined;
    const result = await locationService.getNearbyPlayers(requestingPlayer, lat, lng, radius);
    return res.status(200).json(success(result));
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /player/:id/visibility — "don't show me".
 * Body: { is_visible: boolean } (a real JSON boolean, nothing else).
 * Hidden players are not listed as nearby, see no one, cannot challenge
 * and cannot be challenged.
 */
async function updateVisibility(req, res, next) {
  try {
    const player = await assertOwnPlayerId(req);
    const isVisible = req.body ? req.body.is_visible : undefined;
    if (typeof isVisible !== 'boolean') {
      throw new ApiError('INVALID_VISIBILITY', 'is_visible must be true or false.', 400);
    }
    const updated = await playerRepo.setVisibility(player.player_id, isVisible);
    return res.status(200).json(success({ is_visible: updated.is_visible }));
  } catch (err) {
    return next(err);
  }
}

module.exports = { updateLocation, getNearby, updateVisibility, updateFcmToken, deactivateDevice, deactivateAllDevices };
