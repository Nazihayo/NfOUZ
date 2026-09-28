using System;

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
}
