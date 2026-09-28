using System;
using System.Threading;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Social;
using Nfouz.Utils;
using UnityEngine;

#if FIREBASE_MESSAGING_AVAILABLE
using Firebase.Messaging;
#endif

namespace Nfouz.Networking
{
    /// <summary>
    /// Sprint 8 — wraps Firebase Cloud Messaging on the client: registers
    /// the device's FCM token with the backend (PATCH
    /// /player/:id/fcm-token, mirroring player.repository.js#updateFcmToken)
    /// and routes the four Sprint 8 push types (SOS, Rescue Accepted,
    /// Rescue Completed, Rescue Expired — fcm.service.js) to typed events
    /// other systems subscribe to. Guarded by FIREBASE_MESSAGING_AVAILABLE,
    /// the same scripting-define convention FirebaseManager.cs uses for
    /// Firebase Auth, so this project compiles before the Firebase
    /// Messaging Unity package is imported.
    ///
    /// "No exact coordinates" holds on the client too, structurally: every
    /// event below is typed with only the fields the server actually sends
    /// (sos_id, and nothing location-shaped) — there is no lat/lng field to
    /// even accidentally forward to the UI.
    ///
    /// Sprint 8 correction (final pass):
    ///   - Registration now sends device_key (SecureDeviceKeyStore — a
    ///     stable per-installation id, distinct from the rotatable
    ///     fcm_token) and platform alongside fcm_token, matching the
    ///     backend's redesigned player_devices contract exactly.
    ///     "Push is not the source of truth" and reconnect state
    ///     restoration are handled by SOSManager/RescueMissionController
    ///     re-fetching from the REST API on reconnect — this class only
    ///     ever forwards a `type`/`sos_id` pair, never treated as
    ///     authoritative state by itself.
    ///   - A 409 FCM_TOKEN_CONFLICT (this token is already registered to a
    ///     DIFFERENT player — e.g. a shared test device, or a stale
    ///     Firebase Installation ID reused after a sign-out on another
    ///     account) is logged distinctly rather than treated like any other
    ///     transient failure, since retrying with the SAME token can never
    ///     succeed — the resolution is a fresh FCM token, not a retry.
    ///   - Sign-out now calls the dedicated CURRENT-device deactivation
    ///     endpoint (POST /player/:id/devices/deactivate) instead of the
    ///     old "PATCH fcm-token with a null token" pattern, which no longer
    ///     exists server-side and would never have been current-device-only
    ///     anyway. It never touches the player's other devices, and never
    ///     calls the separate, privileged deactivate-ALL endpoint.
    ///   - RegisterTokenAsync/ClearTokenAsync take a CancellationToken so a
    ///     caller leaving the scene mid-request (sign-out during a slow
    ///     network call, or the app backgrounding) can abort cleanly
    ///     instead of resuming a callback against destroyed objects.
    ///   - Never logs the raw token or device_key — only success/failure
    ///     and the sanitized server error code.
    /// </summary>
    public class PushNotificationHandler : MonoBehaviour
    {
        public event Action<string> OnSosNotificationReceived; // param: sos_id
        public event Action<string> OnRescueAcceptedNotificationReceived; // param: sos_id
        public event Action<string> OnRescueCompletedNotificationReceived; // param: sos_id
        public event Action<string> OnRescueExpiredNotificationReceived; // param: sos_id

        private ApiClient _apiClient;
        private string _lastRegisteredToken;
        private readonly CancellationTokenSource _lifetimeCts = new CancellationTokenSource();

        private void Awake()
        {
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();
        }

        private void OnDestroy()
        {
            _lifetimeCts.Cancel();
            _lifetimeCts.Dispose();
        }

        private void OnEnable()
        {
#if FIREBASE_MESSAGING_AVAILABLE
            FirebaseMessaging.TokenReceived += HandleTokenReceived;
            FirebaseMessaging.MessageReceived += HandleMessageReceived;
#else
            Debug.LogWarning("[PushNotificationHandler] FIREBASE_MESSAGING_AVAILABLE not defined — " +
                              "running in stub mode until the Firebase Messaging SDK package is imported.");
#endif
        }

        private void OnDisable()
        {
#if FIREBASE_MESSAGING_AVAILABLE
            FirebaseMessaging.TokenReceived -= HandleTokenReceived;
            FirebaseMessaging.MessageReceived -= HandleMessageReceived;
#endif
        }

#if FIREBASE_MESSAGING_AVAILABLE
        private void HandleTokenReceived(object sender, TokenReceivedEventArgs args)
        {
            _ = RegisterTokenAsync(args.Token);
        }

        private void HandleMessageReceived(object sender, MessageReceivedEventArgs args)
        {
            var data = args.Message?.Data;
            if (data == null || !data.TryGetValue("type", out var type))
            {
                return;
            }

            data.TryGetValue("sos_id", out var sosId);
            Dispatch(type, sosId);
        }
#endif

        /// <summary>Sends the device's current FCM token to the backend,
        /// alongside this installation's stable device_key and platform
        /// (Sprint 8 correction, final pass — player_devices redesign).
        /// Push failure on the SERVER side must never fail SOS/rescue
        /// creation (fcm.service.js) — symmetrically, a failure to
        /// REGISTER a token here must never block the client; it is
        /// logged and simply retried the next time a token is issued.
        /// A 409 FCM_TOKEN_CONFLICT is NOT retried with the same token —
        /// see the class doc comment.</summary>
        public async Task RegisterTokenAsync(string token, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrEmpty(token) || token == _lastRegisteredToken || !PlayerSession.HasActiveSession)
            {
                return;
            }

            using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetimeCts.Token);

            var deviceKey = SecureDeviceKeyStore.GetOrCreateDeviceKey();
            var platform = Application.platform == RuntimePlatform.IPhonePlayer
                ? Constants.Devices.PlatformIos
                : Constants.Devices.PlatformAndroid;

            var response = await _apiClient.PatchAsync<DeviceResponseData>(
                $"/player/{PlayerSession.Current.PlayerId}/fcm-token",
                new FcmTokenRequest { device_key = deviceKey, fcm_token = token, platform = platform },
                linked.Token);

            if (linked.IsCancellationRequested)
            {
                return; // scene torn down mid-request — nothing left to update.
            }

            if (!response.success)
            {
                if (response.error?.code == Constants.ErrorCodes.FcmTokenConflict)
                {
                    Debug.LogWarning("[PushNotificationHandler] This push token is already registered to a different player — " +
                                      "will not retry with the same token; a fresh token from Firebase is required.");
                }
                else
                {
                    Debug.LogWarning($"[PushNotificationHandler] Failed to register FCM token: {response.error?.code}");
                }
                return;
            }

            _lastRegisteredToken = token;
        }

        /// <summary>Deactivates ONLY this installation's device server-side
        /// on sign-out (Sprint 8 correction, final pass — POST
        /// /player/:id/devices/deactivate, current-device-scoped by
        /// device_key). Deliberately never calls the separate,
        /// account-wide /devices/deactivate-all endpoint — an ordinary
        /// sign-out on one device must never sign every other device out of
        /// push notifications. The local device_key itself is intentionally
        /// NOT cleared (see SecureDeviceKeyStore.Clear's doc comment) so
        /// signing back in on this same installation re-registers the same
        /// device row rather than creating a new one.</summary>
        public async Task ClearTokenAsync(CancellationToken cancellationToken = default)
        {
            if (!PlayerSession.HasActiveSession)
            {
                return;
            }

            using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetimeCts.Token);
            var deviceKey = SecureDeviceKeyStore.GetOrCreateDeviceKey();

            var response = await _apiClient.PostAsync<DeviceResponseData>(
                $"/player/{PlayerSession.Current.PlayerId}/devices/deactivate",
                new DeactivateDeviceRequest { device_key = deviceKey },
                linked.Token);

            if (linked.IsCancellationRequested)
            {
                return;
            }

            if (!response.success)
            {
                Debug.LogWarning($"[PushNotificationHandler] Failed to deactivate current device on sign-out: {response.error?.code}");
            }

            _lastRegisteredToken = null;
        }

        /// <summary>Routes a raw notification `type`/`sos_id` pair to its typed
        /// event — separated from message parsing so EditMode tests (and the
        /// stub path above) can drive it directly without a real FCM message.</summary>
        public void Dispatch(string type, string sosId)
        {
            switch (type)
            {
                case "sos_notification":
                    OnSosNotificationReceived?.Invoke(sosId);
                    break;
                case "rescue_accepted":
                    OnRescueAcceptedNotificationReceived?.Invoke(sosId);
                    break;
                case "rescue_completed":
                    OnRescueCompletedNotificationReceived?.Invoke(sosId);
                    if (SOSManager.Instance != null)
                    {
                        SOSManager.Instance.ClearLocalState();
                    }
                    break;
                case "rescue_expired":
                    OnRescueExpiredNotificationReceived?.Invoke(sosId);
                    break;
                default:
                    Debug.LogWarning($"[PushNotificationHandler] Unknown notification type: {type}");
                    break;
            }
        }
    }
}
