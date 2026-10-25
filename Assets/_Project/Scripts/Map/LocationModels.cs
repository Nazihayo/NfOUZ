using System;
using System.Globalization;

namespace Nfouz.Map
{
    [Serializable]
    public class LocationUpdateRequest
    {
        public double lat;
        public double lng;
    }

    [Serializable]
    public class LocationUpdateResponseData
    {
        public bool updated;
        public double last_lat;
        public double last_lng;
        // Driving stop: true while the server treats this player as being
        // in a vehicle (hidden from others, cannot challenge).
        public bool moving_too_fast;
    }

    /// <summary>PATCH /player/{id}/visibility request and response.</summary>
    [Serializable]
    public class VisibilityRequest
    {
        public bool is_visible;
    }

    [Serializable]
    public class VisibilityResponseData
    {
        public bool is_visible;
    }

    [Serializable]
    public class NearbyPlayerData
    {
        public string player_id;
        public string username;
        public string class_type;
        public double lat;
        public double lng;
        public bool is_controlled;
        public bool is_protected; // Sprint 7 continuation — GDD section 4
        public bool is_online;
        public bool is_blocked;
        public double distance_meters;
    }

    [Serializable]
    public class NearbyPlayersResponseData
    {
        public NearbyPlayerData[] players;
    }

    /// <summary>
    /// GET /player/nearby query string. Formatted with the invariant culture:
    /// on a German (or ar-SA / ar-EG) system a double prints as "52,5978" /
    /// "52٫5978", which the backend's Number() reads as NaN.
    /// </summary>
    public static class NearbyPlayersQuery
    {
        public static string BuildEndpoint(double lat, double lng, int radiusMeters)
        {
            return string.Format(CultureInfo.InvariantCulture,
                "/player/nearby?lat={0}&lng={1}&radius={2}", lat, lng, radiusMeters);
        }
    }
}
