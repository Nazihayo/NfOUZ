'use strict';

const playerRepo = require('../repositories/player.repository');
const { haversineDistanceMeters, boundingBoxDegrees, isRealisticSpeed } = require('../utils/geoUtils');
const { ApiError } = require('../utils/responseEnvelope');
const env = require('../config/env');
const questService = require('./quest.service'); // Sprint 9 — best-effort quest progress hook only, see updatePlayerLocation below.
const logger = require('../utils/logger');
const { isHidden, isMovingFast, looksLikeDriving } = require('../utils/playerSafety');

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

  // Driving stop: hidden and unable to challenge for a cooldown afterwards.
  const fastMovementAt = looksLikeDriving(player, lat, lng, now) ? new Date(now) : null;
  const updated = await playerRepo.updateLocation(playerId, { lat, lng, timestamp: new Date(now), fastMovementAt });

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

  return {
    updated: true,
    last_lat: updated.last_lat,
    last_lng: updated.last_lng,
    // The client shows "don't play while driving" while this is true.
    moving_too_fast: isMovingFast({ fast_movement_at: updated.fast_movement_at }, now),
  };
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
// Within this distance a player's exact position is returned: the client
// needs it to gate the 20 m challenge (ChallengeInteractionController.cs).
// Farther players get only a grid cell and a rounded distance, so nobody
// can follow a stranger at GPS precision or find where they live.
const EXACT_LOCATION_WITHIN_METERS = 50;
const COARSE_CELL_DEGREES = 0.001; // about 110 m north-south
const COARSE_DISTANCE_STEP_METERS = 50;

function coarseCellCentre(degrees) {
  return Math.floor(degrees / COARSE_CELL_DEGREES) * COARSE_CELL_DEGREES + COARSE_CELL_DEGREES / 2;
}

function hasFreshLocation(player, onlineSince) {
  return typeof player.last_lat === 'number' && typeof player.last_lng === 'number' &&
    player.last_location_at != null && new Date(player.last_location_at) >= onlineSince;
}

/**
 * Lists the visible, online players around the requester's own stored
 * location. The lat/lng in the request are still validated, but never used
 * as the centre: otherwise any account could list the players around any
 * point on earth. Without a fresh stored location the list is empty.
 *
 * Also empty while the requester is hidden ("don't show me": who cannot be
 * seen does not see others either) or moving fast (driving stop).
 */
async function getNearbyPlayers(requester, lat, lng, radiusMeters) {
  assertValidLatLng(lat, lng);

  const onlineSince = new Date(Date.now() - env.NEARBY_ONLINE_THRESHOLD_SECONDS * 1000);
  if (!hasFreshLocation(requester, onlineSince) || isHidden(requester) || isMovingFast(requester)) {
    return { players: [] };
  }
  const notFastSince = new Date(Date.now() - env.SAFETY_FAST_MOVEMENT_COOLDOWN_SECONDS * 1000);
  const centreLat = requester.last_lat;
  const centreLng = requester.last_lng;

  const radius = Math.min(radiusMeters || env.NEARBY_DEFAULT_RADIUS_METERS, env.NEARBY_MAX_RADIUS_METERS);
  const box = boundingBoxDegrees(centreLat, centreLng, radius);

  const candidates = await playerRepo.findWithinBoundingBox(box, requester.player_id, onlineSince, notFastSince);

  const withDistance = candidates
    .map((row) => ({ row, distance: haversineDistanceMeters(centreLat, centreLng, row.last_lat, row.last_lng) }))
    .filter(({ distance }) => distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, env.NEARBY_MAX_RESULTS)
    .map(({ row, distance }) => {
      const exact = distance <= EXACT_LOCATION_WITHIN_METERS;
      return {
        player_id: row.player_id,
        username: row.username,
        class_type: row.class_type,
        lat: exact ? row.last_lat : coarseCellCentre(row.last_lat),
        lng: exact ? row.last_lng : coarseCellCentre(row.last_lng),
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
        // Farther away: rounded up to the next 50 m ("under 100 m").
        distance_meters: exact
          ? distance
          : Math.ceil(distance / COARSE_DISTANCE_STEP_METERS) * COARSE_DISTANCE_STEP_METERS,
      };
    });

  return { players: withDistance };
}

module.exports = {
  updatePlayerLocation,
  getNearbyPlayers,
  MAX_SPEED_KMH,
  MAX_RADIUS_METERS: env.NEARBY_MAX_RADIUS_METERS,
  EXACT_LOCATION_WITHIN_METERS,
};
