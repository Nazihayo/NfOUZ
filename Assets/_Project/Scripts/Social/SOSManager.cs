using System;
using System.Threading;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Networking;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Social
{
    /// <summary>
    /// Sprint 8 — drives the local player's own SOS lifecycle: pressing the
    /// SOS button (POST /sos — idempotent, a repeated press while one is
    /// already open just re-surfaces the same sos_id per sos.service.js),
    /// and polling GET /sos/{sosId} while one is open so the banner can
    /// react the moment a friend rescues the player or the SOS naturally
    /// expires (Control ran out on its own). Lives on a persistent object
    /// registered in ServiceLocator, same convention as ApiClient/
    /// FirebaseManager, since an open SOS can outlive any single scene.
    ///
    /// Sprint 8 correction (final pass):
    ///   - RequestSosAsync guards against overlapping requests (a
    ///     double-tap of the SOS button can no longer fire two concurrent
    ///     POST /sos calls).
    ///   - The poll loop is driven by a CancellationTokenSource that is
    ///     cancelled in OnDestroy, so an in-flight GET is aborted cleanly
    ///     on app quit / this persistent object being torn down, rather
    ///     than resuming a callback afterward.
    ///   - "Reconnect restores active SOS/mission state": the active
    ///     sos_id is persisted locally (PlayerPrefs — a non-secret opaque
    ///     id, unlike device_key/fcm_token which never go through
    ///     PlayerPrefs) and re-checked against GET /sos/{sosId} on
    ///     OnApplicationPause(false) (foregrounding) and on first Start()
    ///     of a session already carrying one — there is no "get my current
    ///     SOS" endpoint in this sprint's API surface, so resuming the
    ///     SAME previously-known sos_id via the existing per-id GET is the
    ///     correct way to restore state within the actual backend contract
    ///     rather than inventing a new endpoint.
    /// </summary>
    public class SOSManager : MonoBehaviour
    {
        private const float PollIntervalSeconds = 5f;
        private const string ActiveSosIdPrefsKey = "nfouz_active_sos_id";

        public static SOSManager Instance { get; private set; }

        /// <summary>Fired whenever a fresh (non-duplicate) SOS is created.</summary>
        public event Action<SosCreateResponseData> OnSosCreated;

        /// <summary>Fired on every poll where the SOS's status is still 'open' — banner stays up.</summary>
        public event Action<SosGetResponseData> OnSosStillOpen;

        /// <summary>Fired the moment an open SOS transitions to 'rescued'.</summary>
        public event Action<SosGetResponseData> OnSosRescued;

        /// <summary>Fired the moment an open SOS transitions to 'expired' (Control ran out with no rescue).</summary>
        public event Action<SosGetResponseData> OnSosExpired;

        public event Action<string> OnSosError; // param: error code

        private ApiClient _apiClient;
        private string _activeSosId;
        private bool _isPolling;
        private bool _isRequestingSos;
        private CancellationTokenSource _pollCts;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        private void Start()
        {
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();
            _ = RestoreActiveSosAsync();
        }

        private void OnApplicationPause(bool isPaused)
        {
            if (!isPaused)
            {
                _ = RestoreActiveSosAsync();
            }
        }

        private void OnDestroy()
        {
            _pollCts?.Cancel();
            _pollCts?.Dispose();
        }

        public bool HasActiveSos => !string.IsNullOrEmpty(_activeSosId);

        /// <summary>
        /// Reconnect/foreground state restoration: if a previous session
        /// left an sos_id persisted locally, re-fetches its CURRENT status
        /// from the server (never trusting the locally-cached status) and
        /// resumes polling if it is still open, or clears it otherwise.
        /// Safe to call redundantly (e.g. both from Start() and an
        /// OnApplicationPause(false) that fires moments later).
        /// </summary>
        public async Task RestoreActiveSosAsync()
        {
            if (_isPolling || !PlayerSession.HasActiveSession)
            {
                return;
            }

            var persistedSosId = PlayerPrefs.GetString(ActiveSosIdPrefsKey, string.Empty);
            if (string.IsNullOrEmpty(persistedSosId))
            {
                return;
            }

            var response = await _apiClient.GetAsync<SosGetResponseData>($"/sos/{persistedSosId}");
            if (!response.success)
            {
                // Not found, or a transient error — either way there is
                // nothing safe to resume; a stale/foreign id must not keep
                // being retried forever.
                ClearLocalState();
                return;
            }

            if (response.data.status != "open")
            {
                ClearLocalState();
                return;
            }

            SetActiveSos(persistedSosId);
            // Fire immediately so SOSBannerOverlay reflects the restored
            // state right away rather than waiting up to PollIntervalSeconds
            // for the loop's first tick.
            OnSosStillOpen?.Invoke(response.data);
            if (!_isPolling)
            {
                _ = PollLoopAsync();
            }
        }

        private void SetActiveSos(string sosId)
        {
            _activeSosId = sosId;
            PlayerPrefs.SetString(ActiveSosIdPrefsKey, sosId ?? string.Empty);
            PlayerPrefs.Save();
        }

        /// <summary>
        /// Presses the SOS button. Only meaningful while the local player is
        /// currently Controlled (mirrors sos.service.js#createSos's
        /// SOS_REQUIRES_CONTROL check) — gated client-side the same way
        /// ChallengeInteractionController fails fast on an ineligible
        /// challenge, so the UI never even attempts an SOS it knows the
        /// server will reject. Guards against overlapping calls — a rapid
        /// double press while the first request is still in flight is a
        /// no-op rather than a second concurrent POST /sos.
        /// </summary>
        public async Task RequestSosAsync()
        {
            if (_isRequestingSos)
            {
                return;
            }

            if (!ControlStateManager.IsControlled)
            {
                Debug.LogWarning("[SOSManager] SOS requested while not Controlled — ignored client-side.");
                OnSosError?.Invoke(Constants.ErrorCodes.SosRequiresControl);
                return;
            }

            _isRequestingSos = true;
            try
            {
                var response = await _apiClient.PostAsync<SosCreateResponseData>("/sos", null);
                if (!response.success)
                {
                    Debug.LogWarning($"[SOSManager] SOS creation failed: {response.error?.code}");
                    OnSosError?.Invoke(response.error?.code);
                    return;
                }

                SetActiveSos(response.data.sos_id);
                OnSosCreated?.Invoke(response.data);

                if (!_isPolling)
                {
                    _ = PollLoopAsync();
                }
            }
            finally
            {
                _isRequestingSos = false;
            }
        }

        /// <summary>
        /// Polls the open SOS's status until it stops being 'open'. Runs at
        /// a fixed interval rather than a push subscription — no
        /// server-push channel for SOS state exists in this sprint's spec
        /// beyond the one-shot FCM notifications sent to FRIENDS, not to
        /// the requester themselves.
        /// </summary>
        private async Task PollLoopAsync()
        {
            _isPolling = true;
            _pollCts?.Dispose();
            _pollCts = new CancellationTokenSource();
            var token = _pollCts.Token;

            try
            {
                while (HasActiveSos && !token.IsCancellationRequested)
                {
                    try
                    {
                        await Task.Delay(TimeSpan.FromSeconds(PollIntervalSeconds), token);
                    }
                    catch (TaskCanceledException)
                    {
                        break; // this object is being torn down — stop polling immediately.
                    }

                    if (!HasActiveSos || token.IsCancellationRequested)
                    {
                        break;
                    }

                    var response = await _apiClient.GetAsync<SosGetResponseData>($"/sos/{_activeSosId}", token);
                    if (token.IsCancellationRequested)
                    {
                        break;
                    }

                    if (!response.success)
                    {
                        Debug.LogWarning($"[SOSManager] SOS poll failed: {response.error?.code}");
                        continue; // transient network issue — keep polling, don't tear down the banner on a blip
                    }

                    // Server time drives every transition below — this is
                    // the actual server-reported status, never a
                    // client-side guess about whether the deadline has
                    // passed; any on-screen countdown built from
                    // reservation_expires_at/controlled_until is display
                    // only (see ServerTime.cs / SOSBannerOverlay.cs).
                    switch (response.data.status)
                    {
                        case "open":
                            OnSosStillOpen?.Invoke(response.data);
                            break;
                        case "rescued":
                            OnSosRescued?.Invoke(response.data);
                            ClearLocalState();
                            break;
                        case "expired":
                            OnSosExpired?.Invoke(response.data);
                            ClearLocalState();
                            break;
                    }
                }
            }
            finally
            {
                _isPolling = false;
            }
        }

        /// <summary>Clears local SOS tracking without a server call — used when
        /// ControlStateManager reports Control ended locally (e.g. via a
        /// rescue push already reflected in PlayerSession) so the banner
        /// does not wait for the next poll tick. Also clears the persisted
        /// sos_id so a later reconnect never tries to restore a resolved SOS.</summary>
        public void ClearLocalState()
        {
            _activeSosId = null;
            PlayerPrefs.DeleteKey(ActiveSosIdPrefsKey);
            PlayerPrefs.Save();
        }
    }
}
