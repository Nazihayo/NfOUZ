using System.Collections.Generic;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Networking;
using UnityEngine;

namespace Nfouz.Map
{
    /// <summary>
    /// Periodically queries GET /player/nearby and syncs the resulting list
    /// against pooled markers on the map: reuses a pooled marker for each
    /// newly-visible player, smoothly re-targets markers for players still
    /// visible, and releases markers back to the pool for players who left
    /// range — never calling Instantiate/Destroy on the hot path. See Unity
    /// MVP Implementation Plan v1.0, Phase 4.
    /// </summary>
    public class NearbyPlayersTracker : MonoBehaviour
    {
        [SerializeField] private MapboxManager mapboxManager;
        [SerializeField] private MarkerPool markerPool;
        [SerializeField] private NearbyPlayerSelection playerSelection;
        [SerializeField] private float queryIntervalSeconds = 6f;
        [SerializeField] private int radiusMeters = 1000;

        private ApiClient _apiClient;
        private GPSLocationService _gpsService;

        // player_id -> the marker currently representing that player.
        private readonly Dictionary<string, GameObject> _activeMarkers = new Dictionary<string, GameObject>();

        private float _queryTimer;
        private bool _queryInFlight;

        public IReadOnlyDictionary<string, GameObject> ActiveMarkers => _activeMarkers;

        private void Awake()
        {
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();

            if (markerPool == null)
            {
                Debug.LogError("[NearbyPlayersTracker] No MarkerPool assigned — markers cannot be spawned.");
            }
        }

        public void Bind(GPSLocationService gpsService)
        {
            _gpsService = gpsService;
        }

        private void OnEnable()
        {
            // Sprint 7 continuation — MainMap refresh after battle
            // resolution: force the NEXT Update tick to poll immediately
            // instead of waiting up to queryIntervalSeconds, so returning
            // from a battle reflects every nearby player's fresh
            // is_controlled/is_protected state right away. See
            // MainMapRefreshRequest's doc comment.
            if (MainMapRefreshRequest.ConsumeRefreshRequest())
            {
                _queryTimer = queryIntervalSeconds;
            }
        }

        private void Update()
        {
            if (_gpsService == null || !_gpsService.IsRunning || _queryInFlight)
            {
                return;
            }

            _queryTimer += Time.deltaTime;
            if (_queryTimer < queryIntervalSeconds)
            {
                return;
            }

            _queryTimer = 0f;
            _ = RefreshNearbyPlayersAsync(_gpsService.LastLat, _gpsService.LastLng);
        }

        public async Task RefreshNearbyPlayersAsync(double lat, double lng)
        {
            _queryInFlight = true;
            try
            {
                var endpoint = $"/player/nearby?lat={lat}&lng={lng}&radius={radiusMeters}";
                var response = await _apiClient.GetAsync<NearbyPlayersResponseData>(endpoint);

                if (!response.success || response.data?.players == null)
                {
                    if (response.isTransportFailure)
                    {
                        // Network/timeout failure: keep existing markers as-is
                        // rather than wiping the map because of one missed poll.
                        Debug.LogWarning("[NearbyPlayersTracker] Nearby-players request failed (network/timeout); keeping last known markers.");
                        return;
                    }

                    if (response.error != null)
                    {
                        Debug.LogWarning($"[NearbyPlayersTracker] Failed to fetch nearby players: {response.error.message}");
                    }
                    return;
                }

                SyncMarkers(response.data.players);
            }
            finally
            {
                _queryInFlight = false;
            }
        }

        private void SyncMarkers(NearbyPlayerData[] players)
        {
            var seenPlayerIds = new HashSet<string>();

            foreach (var player in players)
            {
                // Defensive de-duplication: if the same player_id somehow
                // appears twice in one response, the second occurrence
                // updates the same marker rather than spawning another.
                if (!seenPlayerIds.Add(player.player_id))
                {
                    continue;
                }

                var worldPosition = mapboxManager.GeoToWorldPosition(player.lat, player.lng);

                if (_activeMarkers.TryGetValue(player.player_id, out var existingMarker) && existingMarker != null)
                {
                    existingMarker.GetComponent<NearbyPlayerMarkerUi>()?.UpdateTarget(player, worldPosition);
                }
                else
                {
                    var marker = markerPool.Get(worldPosition);
                    if (marker == null)
                    {
                        // Pool exhausted — skip this player this tick rather than
                        // falling back to an uncontrolled Instantiate call.
                        continue;
                    }

                    marker.GetComponent<NearbyPlayerMarkerUi>()?.Bind(player, worldPosition);
                    _activeMarkers[player.player_id] = marker;
                }
            }

            ReleaseStaleMarkers(seenPlayerIds);
        }

        private void ReleaseStaleMarkers(HashSet<string> seenPlayerIds)
        {
            var staleIds = new List<string>();
            foreach (var kvp in _activeMarkers)
            {
                if (!seenPlayerIds.Contains(kvp.Key))
                {
                    staleIds.Add(kvp.Key);
                }
            }

            foreach (var id in staleIds)
            {
                var marker = _activeMarkers[id];
                if (marker != null)
                {
                    var markerUi = marker.GetComponent<NearbyPlayerMarkerUi>();
                    if (playerSelection != null && markerUi != null)
                    {
                        playerSelection.NotifyMarkerReleased(markerUi);
                    }
                    markerPool.Release(marker);
                }
                _activeMarkers.Remove(id);
            }
        }

        private void OnDestroy()
        {
            if (markerPool != null)
            {
                markerPool.ReleaseAll();
            }
            _activeMarkers.Clear();
        }
    }
}
