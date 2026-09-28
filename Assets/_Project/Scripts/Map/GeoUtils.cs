using System;
using UnityEngine;

namespace Nfouz.Map
{
    /// <summary>
    /// Client-side great-circle distance calculation. Must stay numerically
    /// consistent with the backend's src/utils/geoUtils.js — both use the
    /// same Haversine formula so "is this player in range" never disagrees
    /// between client and server. See Photon Fusion Multiplayer & Mapbox
    /// Integration v1.0, section 2.3.
    /// </summary>
    public static class GeoUtils
    {
        private const double EarthRadiusMeters = 6371000;

        /// <summary>Distance in meters between two lat/lng points.</summary>
        public static double DistanceInMeters(double lat1, double lng1, double lat2, double lng2)
        {
            double lat1Rad = lat1 * Mathf.Deg2Rad;
            double lat2Rad = lat2 * Mathf.Deg2Rad;
            double deltaLat = (lat2 - lat1) * Mathf.Deg2Rad;
            double deltaLng = (lng2 - lng1) * Mathf.Deg2Rad;

            double a = Math.Sin(deltaLat / 2) * Math.Sin(deltaLat / 2)
                     + Math.Cos(lat1Rad) * Math.Cos(lat2Rad)
                     * Math.Sin(deltaLng / 2) * Math.Sin(deltaLng / 2);

            double c = 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));

            return EarthRadiusMeters * c;
        }

        /// <summary>True if a GPS reading implies a physically unrealistic
        /// speed since the last known position — mirrors the server-side
        /// check in location.service.js so the client can pre-empt an
        /// obviously-doomed API call, though the server remains the final
        /// authority (see REST API Specification v1.0, section 2.3).</summary>
        public static bool IsRealisticSpeed(
            double prevLat, double prevLng, DateTime prevTimestampUtc,
            double newLat, double newLng, DateTime newTimestampUtc,
            double maxSpeedKmh = 300)
        {
            double elapsedSeconds = (newTimestampUtc - prevTimestampUtc).TotalSeconds;
            if (elapsedSeconds <= 0)
            {
                return false;
            }

            double distanceMeters = DistanceInMeters(prevLat, prevLng, newLat, newLng);
            double speedKmh = (distanceMeters / elapsedSeconds) * 3.6;

            return speedKmh <= maxSpeedKmh;
        }
    }
}
