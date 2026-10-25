'use strict';

const env = require('../config/env');
const { haversineDistanceMeters } = require('./geoUtils');

/** "Don't show me" (players.is_visible, migration 012). */
function isHidden(player) {
  return player.is_visible === false;
}

/**
 * True while the player is treated as being in a vehicle: a location
 * update within the last SAFETY_FAST_MOVEMENT_COOLDOWN_SECONDS showed them
 * moving faster than SAFETY_MAX_PLAY_SPEED_KMH.
 */
function isMovingFast(player, now = Date.now()) {
  if (player.fast_movement_at == null) return false;
  return now - new Date(player.fast_movement_at).getTime() < env.SAFETY_FAST_MOVEMENT_COOLDOWN_SECONDS * 1000;
}

/**
 * Whether the move from the stored location to (lat, lng) looks like
 * driving. Ignored when the previous update is older than
 * SAFETY_FAST_MOVEMENT_MAX_GAP_SECONDS (someone who drove with the app
 * closed is not driving now) or the move is shorter than
 * SAFETY_FAST_MOVEMENT_MIN_DISTANCE_METERS (GPS jitter between two close
 * updates is not driving).
 */
function looksLikeDriving(previous, lat, lng, now = Date.now()) {
  if (previous.last_lat == null || previous.last_lng == null || previous.last_location_at == null) return false;
  const elapsedSeconds = (now - new Date(previous.last_location_at).getTime()) / 1000;
  if (elapsedSeconds <= 0 || elapsedSeconds > env.SAFETY_FAST_MOVEMENT_MAX_GAP_SECONDS) return false;
  const distance = haversineDistanceMeters(previous.last_lat, previous.last_lng, lat, lng);
  if (distance < env.SAFETY_FAST_MOVEMENT_MIN_DISTANCE_METERS) return false;
  return (distance / elapsedSeconds) * 3.6 > env.SAFETY_MAX_PLAY_SPEED_KMH;
}

module.exports = { isHidden, isMovingFast, looksLikeDriving };
