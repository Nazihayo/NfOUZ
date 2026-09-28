'use strict';

const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two lat/lng points, in meters.
 * Mirrors Unity's GeoUtils.DistanceInMeters exactly (see Photon Fusion
 * Multiplayer & Mapbox Integration v1.0, section 2.3) so client and
 * server never disagree on "is this player in range".
 */
function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Returns a rectangular lat/lng prefilter box around a center point.
 * Used to cheaply narrow down candidate rows via the (last_lat, last_lng)
 * index before computing exact Haversine distance in application code.
 * The box is intentionally generous (rectangle, not circle) — exact
 * filtering still happens in JS afterward.
 */
function boundingBoxDegrees(lat, lng, radiusMeters) {
  const latDelta = radiusMeters / 111320; // ~meters per degree latitude, constant enough for this use
  const lngDelta = radiusMeters / (111320 * Math.cos(toRadians(lat)) || 1);

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

/**
 * Rejects GPS updates implying an unrealistic travel speed (possible
 * spoofing). See REST API Specification v1.0 section 2.3 and Backend
 * Implementation Guide v1.0 section 12 (Battle Validation ethos applied
 * here to location).
 */
function isRealisticSpeed(prevLat, prevLng, prevTimestampMs, newLat, newLng, newTimestampMs, maxSpeedKmh = 300) {
  const elapsedSeconds = (newTimestampMs - prevTimestampMs) / 1000;

  if (elapsedSeconds <= 0) {
    // Out-of-order or duplicate timestamp — treat as suspicious, not a crash.
    return false;
  }

  const distanceMeters = haversineDistanceMeters(prevLat, prevLng, newLat, newLng);
  const speedKmh = (distanceMeters / elapsedSeconds) * 3.6;

  return speedKmh <= maxSpeedKmh;
}

module.exports = { haversineDistanceMeters, boundingBoxDegrees, isRealisticSpeed, EARTH_RADIUS_METERS };
