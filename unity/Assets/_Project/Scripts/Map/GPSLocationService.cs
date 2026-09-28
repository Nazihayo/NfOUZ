using System;
using System.Collections;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Networking;
using Nfouz.Utils;
using UnityEngine;

#if UNITY_ANDROID && !UNITY_EDITOR
using UnityEngine.Android;
#endif

namespace Nfouz.Map
{
    /// <summary>
    /// Reads the device's GPS location, requests the OS permission on
    /// Android (iOS prompts automatically via Info.plist on Input.location.Start()),
    /// and pushes throttled updates to PATCH /player/{id}/location.
    /// See Unity MVP Implementation Plan v1.0, Phase 3, and Photon Fusion
    /// Multiplayer & Mapbox Integration v1.0, section 2.4 (battery/performance).
    /// </summary>
    public class GPSLocationService : MonoBehaviour
    {
        [SerializeField] private float updateIntervalSeconds = 5f;
        [SerializeField] private float gpsDesiredAccuracyMeters = 10f;
        [SerializeField] private float gpsUpdateDistanceMeters = 5f;
        [SerializeField] private int gpsInitTimeoutSeconds = 20;

        public event Action<double, double> OnLocationUpdated;
        public event Action<string> OnLocationError;

        public bool IsRunning { get; private set; }
        public double LastLat { get; private set; }
        public double LastLng { get; private set; }

        private ApiClient _apiClient;
        private float _throttleTimer;
        private bool _permissionGranted;

        private void Awake()
        {
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();
        }

        private void Start()
        {
            _ = InitializeAsync();
        }

        public async Task<bool> InitializeAsync()
        {
            if (!await RequestPermissionAsync())
            {
                OnLocationError?.Invoke("إذن الموقع الجغرافي مرفوض. لا يمكن عرض خريطتك الحية بدونه.");
                return false;
            }

            Input.location.Start(gpsDesiredAccuracyMeters, gpsUpdateDistanceMeters);

            var elapsedSeconds = 0;
            while (Input.location.status == LocationServiceStatus.Initializing && elapsedSeconds < gpsInitTimeoutSeconds)
            {
                await Task.Delay(1000);
                elapsedSeconds++;
            }

            if (Input.location.status != LocationServiceStatus.Running)
            {
                Debug.LogWarning($"[GPSLocationService] GPS failed to start: {Input.location.status}");
                OnLocationError?.Invoke("تعذّر تشغيل GPS. تحقق من إعدادات الموقع في جهازك.");
                return false;
            }

            IsRunning = true;
            Debug.Log("[GPSLocationService] GPS running.");
            return true;
        }

        private async Task<bool> RequestPermissionAsync()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            if (Permission.HasUserAuthorizedPermission(Permission.FineLocation))
            {
                _permissionGranted = true;
                return true;
            }

            var tcs = new TaskCompletionSource<bool>();
            var callbacks = new PermissionCallbacks();
            callbacks.PermissionGranted += (permission) => tcs.TrySetResult(true);
            callbacks.PermissionDenied += (permission) => tcs.TrySetResult(false);
            callbacks.PermissionDeniedAndDontAskAgain += (permission) => tcs.TrySetResult(false);

            Permission.RequestUserPermission(Permission.FineLocation, callbacks);
            _permissionGranted = await tcs.Task;
            return _permissionGranted;
#else
            // iOS and Editor: Input.location.Start() triggers the OS-native
            // prompt automatically on iOS (per Info.plist NSLocationWhenInUseUsageDescription);
            // the Editor always reports permission as granted for simulated location.
            _permissionGranted = true;
            await Task.CompletedTask;
            return true;
#endif
        }

        private void Update()
        {
            if (!IsRunning || Input.location.status != LocationServiceStatus.Running)
            {
                return;
            }

            _throttleTimer += Time.deltaTime;
            if (_throttleTimer < updateIntervalSeconds)
            {
                return;
            }

            _throttleTimer = 0f;
            HandleLocationTick();
        }

        private void HandleLocationTick()
        {
            var data = Input.location.lastData;
            LastLat = data.latitude;
            LastLng = data.longitude;

            OnLocationUpdated?.Invoke(LastLat, LastLng);
            _ = SendLocationToServerAsync(LastLat, LastLng);
        }

        private async Task SendLocationToServerAsync(double lat, double lng)
        {
            if (!PlayerSession.HasActiveSession)
            {
                return;
            }

            var request = new LocationUpdateRequest { lat = lat, lng = lng };
            var endpoint = $"/player/{PlayerSession.Current.PlayerId}/location";
            var response = await _apiClient.PatchAsync<LocationUpdateResponseData>(endpoint, request);

            if (!response.success && response.error != null)
            {
                if (response.error.code == Constants.ErrorCodes.InvalidLocation)
                {
                    Debug.LogWarning("[GPSLocationService] Server rejected location update: possible GPS anomaly.");
                }
                else if (response.error.code == Constants.ErrorCodes.RateLimited)
                {
                    // Expected occasionally under normal throttling — not an error worth surfacing to the player.
                    Debug.Log("[GPSLocationService] Location update rate-limited; will retry next tick.");
                }
                else
                {
                    Debug.LogWarning($"[GPSLocationService] Location update failed: {response.error.message}");
                }
            }
        }

        private void OnDestroy()
        {
            if (IsRunning)
            {
                Input.location.Stop();
            }
        }
    }
}
