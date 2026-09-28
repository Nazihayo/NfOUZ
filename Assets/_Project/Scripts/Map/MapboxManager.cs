using UnityEngine;

#if MAPBOX_SDK_AVAILABLE
using Mapbox.Unity.Map;
using Mapbox.Utils;
#endif

namespace Nfouz.Map
{
    /// <summary>
    /// Thin wrapper around the Mapbox Unity SDK's AbstractMap. Guarded by
    /// the MAPBOX_SDK_AVAILABLE scripting define so this project compiles
    /// before the Mapbox package is imported (same pattern as
    /// FirebaseManager's FIREBASE_AUTH_AVAILABLE guard). See Photon Fusion
    /// Multiplayer & Mapbox Integration v1.0, section 2.2.
    /// </summary>
    public class MapboxManager : MonoBehaviour
    {
#if MAPBOX_SDK_AVAILABLE
        [SerializeField] private AbstractMap map;
#endif
        [SerializeField] private GameObject playerMarkerPrefab;

        private GameObject _playerMarkerInstance;
        public bool IsReady { get; private set; }

        private void Awake()
        {
#if MAPBOX_SDK_AVAILABLE
            IsReady = map != null;
            if (!IsReady)
            {
                Debug.LogError("[MapboxManager] AbstractMap reference not assigned in the Inspector.");
            }
#else
            IsReady = false;
            Debug.LogWarning("[MapboxManager] MAPBOX_SDK_AVAILABLE not defined — " +
                              "running in stub mode until the Mapbox SDK package is imported.");
#endif
        }

        /// <summary>Recenters the map on the player's current GPS position and
        /// moves/creates the player's own marker there.</summary>
        public void CenterOnPlayer(double lat, double lng)
        {
#if MAPBOX_SDK_AVAILABLE
            if (!IsReady) return;

            var latLng = new Vector2d(lat, lng);
            map.SetCenterLatitudeLongitude(latLng);
            map.UpdateMap(latLng, map.Zoom);

            if (_playerMarkerInstance == null && playerMarkerPrefab != null)
            {
                _playerMarkerInstance = Instantiate(playerMarkerPrefab);
            }

            if (_playerMarkerInstance != null)
            {
                _playerMarkerInstance.transform.position = map.GeoToWorldPosition(latLng, true);
            }
#else
            Debug.Log($"[MapboxManager stub] CenterOnPlayer({lat}, {lng}) — no-op without Mapbox SDK.");
#endif
        }

        /// <summary>Converts a lat/lng to a Unity world-space position using the
        /// active map's projection. Returns Vector3.zero in stub mode.</summary>
        public Vector3 GeoToWorldPosition(double lat, double lng)
        {
#if MAPBOX_SDK_AVAILABLE
            if (!IsReady) return Vector3.zero;
            return map.GeoToWorldPosition(new Vector2d(lat, lng), true);
#else
            return Vector3.zero;
#endif
        }

        /// <summary>Instantiates a marker prefab at the given lat/lng and returns
        /// the created instance so callers (e.g. NearbyPlayersTracker) can track
        /// and later destroy it.</summary>
        public GameObject SpawnMarkerAt(double lat, double lng, GameObject markerPrefab, Transform parent = null)
        {
            if (markerPrefab == null)
            {
                Debug.LogError("[MapboxManager] SpawnMarkerAt called with a null prefab.");
                return null;
            }

            var worldPosition = GeoToWorldPosition(lat, lng);
            return Instantiate(markerPrefab, worldPosition, Quaternion.identity, parent);
        }

        /// <summary>Updates an already-spawned marker's world position to match
        /// a new lat/lng, without destroying/recreating it.</summary>
        public void UpdateMarkerPosition(GameObject marker, double lat, double lng)
        {
            if (marker == null) return;
            marker.transform.position = GeoToWorldPosition(lat, lng);
        }
    }
}
