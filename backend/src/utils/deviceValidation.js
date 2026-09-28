'use strict';

const { ApiError } = require('./responseEnvelope');

/**
 * Sprint 8 correction (final pass) — "Validate request bodies strictly
 * with Zod." `zod` is not an installed dependency of this project and
 * `npm install` is unavailable in this environment (see the delivery
 * report's verification section — network access to the npm registry is
 * blocked here), so `require('zod')` would crash this module at import
 * time. Rather than adding an unreachable dependency, this file is a
 * small hand-written validator with the exact same strictness a Zod
 * object schema would give this payload — bounded-length trimmed
 * strings, an explicit enum, reject-unknown-keys — so swapping in a real
 * `z.object({...}).strict()` later is a drop-in replacement, not a
 * behavior change. If `zod` becomes installable, replace this file's body
 * with the schema in the comment below and keep the same exported shape.
 *
 *   // With zod installed, this file would instead be:
 *   // const { z } = require('zod');
 *   // const registerDeviceSchema = z.object({
 *   //   device_key: z.string().trim().min(1).max(255),
 *   //   fcm_token: z.string().trim().min(1).max(255),
 *   //   platform: z.enum(['android', 'ios']),
 *   // }).strict();
 */

const MAX_DEVICE_KEY_LENGTH = 255;
const MAX_FCM_TOKEN_LENGTH = 255;
const ALLOWED_PLATFORMS = ['android', 'ios'];

function requireNonEmptyString(value, fieldName, maxLength) {
  if (typeof value !== 'string') {
    throw new ApiError('INVALID_REQUEST', `${fieldName} is required and must be a string.`, 400);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ApiError('INVALID_REQUEST', `${fieldName} must not be empty.`, 400);
  }
  if (trimmed.length > maxLength) {
    throw new ApiError('INVALID_REQUEST', `${fieldName} exceeds the maximum length of ${maxLength}.`, 400);
  }
  return trimmed;
}

/** Validates a device-registration body: { device_key, fcm_token, platform }. Rejects missing, empty, oversized, or unknown-platform values. */
function parseRegisterDeviceBody(body) {
  if (!body || typeof body !== 'object') {
    throw new ApiError('INVALID_REQUEST', 'Request body must be a JSON object.', 400);
  }

  const deviceKey = requireNonEmptyString(body.device_key, 'device_key', MAX_DEVICE_KEY_LENGTH);
  const fcmToken = requireNonEmptyString(body.fcm_token, 'fcm_token', MAX_FCM_TOKEN_LENGTH);

  if (typeof body.platform !== 'string' || !ALLOWED_PLATFORMS.includes(body.platform)) {
    throw new ApiError('INVALID_REQUEST', `platform must be one of: ${ALLOWED_PLATFORMS.join(', ')}.`, 400);
  }

  const knownKeys = ['device_key', 'fcm_token', 'platform'];
  const unknownKeys = Object.keys(body).filter((key) => !knownKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw new ApiError('INVALID_REQUEST', `Unexpected field(s): ${unknownKeys.join(', ')}.`, 400);
  }

  return { deviceKey, fcmToken, platform: body.platform };
}

/** Validates a device-deactivation body: { device_key }. */
function parseDeactivateDeviceBody(body) {
  if (!body || typeof body !== 'object') {
    throw new ApiError('INVALID_REQUEST', 'Request body must be a JSON object.', 400);
  }
  const deviceKey = requireNonEmptyString(body.device_key, 'device_key', MAX_DEVICE_KEY_LENGTH);

  const unknownKeys = Object.keys(body).filter((key) => key !== 'device_key');
  if (unknownKeys.length > 0) {
    throw new ApiError('INVALID_REQUEST', `Unexpected field(s): ${unknownKeys.join(', ')}.`, 400);
  }

  return { deviceKey };
}

module.exports = { parseRegisterDeviceBody, parseDeactivateDeviceBody, MAX_DEVICE_KEY_LENGTH, MAX_FCM_TOKEN_LENGTH, ALLOWED_PLATFORMS };
