using UnityEngine;

#if MAPBOX_SDK_AVAILABLE
using Mapbox.BaseModule.Data.Vector2d;
using Mapbox.BaseModule.Map;
using Mapbox.Example.Scripts.Map;
#endif

namespace Nfouz.Map
{
    /// <summary>
    /// Thin wrapper around the Mapbox Unity SDK v3 map
    /// (<c>MapboxMapBehaviour</c>, package <c>com.mapbox.sdk</c>). Guarded by
    /// the MAPBOX_SDK_AVAILABLE scripting define so this project compiles
    /// before the Mapbox package is imported (same pattern as
    /// FirebaseManager's FIREBASE_AUTH_AVAILABLE guard). See Photon Fusion
    /// Multiplayer & Mapbox Integration v1.0, section 2.2.
    ///
    /// SDK v2 (AbstractMap) is no longer developed, so the owner chose v3 on
    /// 2026-10-27; v3 needs URP (build-recovery/MAPBOX_V3_SETUP.md).
    ///
    /// The map follows <see cref="GPSLocationService"/>, the same position
    /// the server receives, rather than a second location provider inside
    /// the SDK. v3 converts lat/lng into the map's local space; this class
    /// returns world positions (via the map root) so callers can keep
    /// setting <c>transform.position</c>. A marker placed with
    /// <see cref="GeoToWorldPosition"/> is correct until the map recenters;
    /// NearbyPlayersTracker repositions its markers on every poll.
    /// </summary>
    public class MapboxManager : MonoBehaviour
    {
#if MAPBOX_SDK_AVAILABLE
        [SerializeField] private MapboxMapBehaviour map;
#endif
        [SerializeField] private GPSLocationService gpsLocationService;
        [SerializeField] private GameObject playerMarkerPrefab;

        private GameObject _playerMarkerInstance;

#if MAPBOX_SDK_AVAILABLE
        /// <summary>True once the SDK has created and initialized its map;
        /// the SDK initializes asynchronously after Start.</summary>
        public bool IsReady => map != null && map.MapboxMap != null && map.MapboxMap.MapInformation != null &&
                               map.InitializationStatus != InitializationStatus.WaitingForInitialization &&
                               map.InitializationStatus != InitializationStatus.Initializing;
#else
        public bool IsReady => false;
#endif

        private void Awake()
        {
#if MAPBOX_SDK_AVAILABLE
            if (map == null)
            {
                Debug.LogError("[MapboxManager] MapboxMapBehaviour reference not assigned in the Inspector.");
            }
#else
            Debug.LogWarning("[MapboxManager] MAPBOX_SDK_AVAILABLE not defined — " +
                              "running in stub mode until the Mapbox SDK package is imported.");
#endif
        }

        private void OnEnable()
        {
            if (gpsLocationService != null)
            {
                gpsLocationService.OnLocationUpdated += CenterOnPlayer;
            }
        }

        private void OnDisable()
        {
            if (gpsLocationService != null)
            {
                gpsLocationService.OnLocationUpdated -= CenterOnPlayer;
            }
        }

        /// <summary>Recenters the map on the player's current GPS position and
        /// moves/creates the player's own marker there.</summary>
        public void CenterOnPlayer(double lat, double lng)
        {
#if MAPBOX_SDK_AVAILABLE
            if (!IsReady) return;

            var latLng = new LatitudeLongitude(lat, lng);
            map.MapboxMap.ChangeView(latLng);

            if (_playerMarkerInstance == null && playerMarkerPrefab != null)
            {
                _playerMarkerInstance = Instantiate(playerMarkerPrefab);
            }

            if (_playerMarkerInstance != null)
            {
                _playerMarkerInstance.transform.position = GeoToWorldPosition(lat, lng);
            }
#else
            // No coordinates in the log: they are the player's location.
            Debug.Log("[MapboxManager stub] CenterOnPlayer — no-op without Mapbox SDK.");
#endif
        }

        /// <summary>Converts a lat/lng to a Unity world-space position using the
        /// active map's projection. Returns Vector3.zero in stub mode or before
        /// the map has initialized.</summary>
        public Vector3 GeoToWorldPosition(double lat, double lng)
        {
#if MAPBOX_SDK_AVAILABLE
            if (!IsReady) return Vector3.zero;
            var local = map.MapboxMap.MapInformation.ConvertLatLngToPosition(new LatitudeLongitude(lat, lng));
            var root = map.UnityContext != null ? map.UnityContext.MapRoot : null;
            return root != null ? root.TransformPoint(local) : local;
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
