'use strict';

const playerRepo = require('../repositories/player.repository');
const { haversineDistanceMeters, boundingBoxDegrees, isRealisticSpeed } = require('../utils/geoUtils');
const { ApiError } = require('../utils/responseEnvelope');
const env = require('../config/env');
const questService = require('./quest.service'); // Sprint 9 — best-effort quest progress hook only, see updatePlayerLocation below.
const logger = require('../utils/logger');

const MAX_SPEED_KMH = 300;

function assertValidLatLng(lat, lng) {
  if (
    typeof lat !== 'number' || Number.isNaN(lat) || lat < -90 || lat > 90 ||
    typeof lng !== 'number' || Number.isNaN(lng) || lng < -180 || lng > 180
  ) {
    throw new ApiError('INVALID_LOCATION', 'lat/lng are missing or out of range.', 400);
  }
}

/**
 * Validates and persists a player's new location. Rejects updates that
 * imply an unrealistic travel speed compared to the player's last known
 * position — see REST API Specification v1.0, section 2.3.
 */
async function updatePlayerLocation(playerId, lat, lng) {
  assertValidLatLng(lat, lng);

  const player = await playerRepo.getById(playerId);
  if (!player) {
    throw new ApiError('PLAYER_NOT_FOUND', 'Player does not exist.', 404);
  }

  const now = Date.now();

  if (player.last_lat !== null && player.last_lng !== null && player.last_location_at) {
    const prevTimestampMs = new Date(player.last_location_at).getTime();
    const realistic = isRealisticSpeed(
      player.last_lat,
      player.last_lng,
      prevTimestampMs,
      lat,
      lng,
      now,
      MAX_SPEED_KMH
    );

    if (!realistic) {
      throw new ApiError(
        'INVALID_LOCATION',
        `Movement speed exceeds realistic threshold (${MAX_SPEED_KMH} km/h).`,
        400
      );
    }
  }

  const updated = await playerRepo.updateLocation(playerId, { lat, lng, timestamp: new Date(now) });

  // Sprint 9 — Quest System: server-side "Travel 500 meters" progress,
  // computed from the SAME previous-location values already validated
  // above (never from a client-reported distance) — only when a previous
  // location actually existed to measure movement from. Best-effort and
  // never allowed to affect this already-persisted location update.
  if (player.last_lat !== null && player.last_lng !== null) {
    try {
      const distanceMovedMeters = haversineDistanceMeters(player.last_lat, player.last_lng, lat, lng);
      await questService.recordProgress(playerId, 'distance_traveled', distanceMovedMeters);
    } catch (err) {
      logger.warn('Sprint 9 quest progress hook failed (best-effort, ignored)', { error: err.message, playerId });
    }
  }

  return { updated: true, last_lat: updated.last_lat, last_lng: updated.last_lng };
}

/**
 * Returns players within `radiusMeters` of (lat, lng), sorted nearest
 * first, excluding the requesting player. Sprint 4 visibility rules
 * (online, not hidden, not blocked) are enforced in SQL by
 * player.repository.js#findWithinBoundingBox; this function only adds
 * the exact-radius cut and result-count cap on top of the SQL prefilter.
 *
 * "Online" here is a recency proxy (last_location_at within
 * NEARBY_ONLINE_THRESHOLD_SECONDS) rather than a query against Firebase
 * presence: presence lives in Firestore/Realtime DB (see Firebase
 * Security Package v1.0, section 3), which is not joinable with
 * PostgreSQL in a single query. A player who is actively sending GPS
 * updates is, by definition, running the app right now.
 */
async function getNearbyPlayers(requestingPlayerId, lat, lng, radiusMeters) {
  assertValidLatLng(lat, lng);

  const radius = Math.min(radiusMeters || env.NEARBY_DEFAULT_RADIUS_METERS, env.NEARBY_MAX_RADIUS_METERS);
  const box = boundingBoxDegrees(lat, lng, radius);
  const onlineSince = new Date(Date.now() - env.NEARBY_ONLINE_THRESHOLD_SECONDS * 1000);

  const candidates = await playerRepo.findWithinBoundingBox(box, requestingPlayerId, onlineSince);

  const withDistance = candidates
    .map((row) => ({
      player_id: row.player_id,
      username: row.username,
      class_type: row.class_type,
      lat: row.last_lat,
      lng: row.last_lng,
      // Sprint 7: live, time-based status — the raw is_controlled/
      // protected_until columns are never cleared on their own once a
      // window passes (see player.repository.js#isControlActive/
      // isProtected's doc comments), so
      // ChallengeInteractionController.cs's client-side eligibility check
      // must never be fed a stale `true` here.
      is_controlled: playerRepo.isControlActive(row),
      is_protected: playerRepo.isProtected(row),
      // Guaranteed by the SQL filter above — included for defense-in-depth
      // on the client (see NearbyPlayerData / ChallengeInteractionController.cs).
      is_online: true,
      is_blocked: false,
      distance_meters: haversineDistanceMeters(lat, lng, row.last_lat, row.last_lng),
    }))
    .filter((row) => row.distance_meters <= radius)
    .sort((a, b) => a.distance_meters - b.distance_meters)
    .slice(0, env.NEARBY_MAX_RESULTS);

  return { players: withDistance };
}

module.exports = {
  updatePlayerLocation,
  getNearbyPlayers,
  MAX_SPEED_KMH,
  MAX_RADIUS_METERS: env.NEARBY_MAX_RADIUS_METERS,
};
