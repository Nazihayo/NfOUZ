using System;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Networking
{
    /// <summary>
    /// Drives the Battle scene's entry flow, per Sprint 5 spec: loading ->
    /// scene entry -> ready confirmation -> countdown synchronization ->
    /// session start -> session end (session state only — final battle
    /// RESULT handling is Sprint 6). Lives on a persistent object in the
    /// Battle scene, wired in BATTLE_SCENE_SETUP.md.
    /// </summary>
    public class BattleLoadingController : MonoBehaviour
    {
        [SerializeField] private NetworkPlayerSpawner playerSpawner;
        [SerializeField] private GameObject loadingPanel;
        [SerializeField] private GameObject countdownPanel;

        private const int ReadyAttempts = 3;

        private ApiClient _apiClient;
        private bool _isAttacker;
        private bool _sessionActive;
        private bool _returningToMainMap;
        private bool _destroyed;

        private async void Start()
        {
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();

            SetLoadingVisible(true);
            SetCountdownVisible(false);

            if (!BattleSession.HasActiveSession || !PlayerSession.HasActiveSession)
            {
                Debug.LogError("[BattleLoadingController] Entered Battle scene without an active battle/player session.");
                // Nothing can start here; Boot routes a missing sign-in to Login.
                if (!PlayerSession.HasActiveSession)
                {
                    BattleSession.Clear();
                    await SceneLoader.LoadAsync(Constants.Scenes.Boot);
                }
                else
                {
                    await ReturnToMainMapAsync();
                }
                return;
            }

            _isAttacker = BattleSession.Current.attacker_id == PlayerSession.Current.PlayerId;

            // Stub mode: the local avatar is instantiated here. With Photon
            // the host spawns both avatars through the runner and the
            // client receives them by replication (NetworkPlayerSpawner).
            playerSpawner?.SpawnLocalPlayer(_isAttacker);

            await ConfirmReadyAsync();
        }

        /// <summary>Clears the ended battle and goes back to MainMap, once.
        /// No match had started, so there is no result to show.</summary>
        private async Task ReturnToMainMapAsync()
        {
            if (_returningToMainMap)
            {
                return;
            }

            _returningToMainMap = true;
            BattleSession.Clear();
            var locator = ServiceLocator.Instance;
            if (locator != null && locator.TryGet<PhotonConnectionManager>(out var photon))
            {
                await photon.LeaveRoomAsync();
            }

            await SceneLoader.LoadAsync(Constants.Scenes.MainMap);
        }

        /// <summary>
        /// Notifies the backend this client has finished loading and is
        /// ready (POST /battle/{battleId}/ready — battle.service.js
        /// setReady). Once both sides are ready, StartCountdown runs.
        /// </summary>
        private async Task ConfirmReadyAsync()
        {
            if (_apiClient == null || !BattleSession.HasActiveSession)
            {
                return;
            }

            // A transient failure (offline, 500, rate limit) is retried a few
            // times; then the wait loop below still leaves once the server
            // ends the battle, so the loading screen never stays up forever.
            ApiResponse<BattleSessionData> response = null;
            for (var attempt = 0; attempt < ReadyAttempts && !_destroyed && BattleSession.HasActiveSession; attempt++)
            {
                if (attempt > 0)
                {
                    await Task.Delay(TimeSpan.FromSeconds(BattleLifecycle.ReadyPollIntervalSeconds));
                    if (_destroyed || !BattleSession.HasActiveSession)
                    {
                        return;
                    }
                }

                response = await _apiClient.PostAsync<BattleSessionData>(
                    $"/battle/{BattleSession.Current.battle_id}/ready", null);
                if (response.success || BattleLifecycle.IsBattleGone(response.error))
                {
                    break;
                }

                Debug.LogWarning($"[BattleLoadingController] Ready confirmation failed: {response.error?.code}");
            }

            if (response == null || !response.success)
            {
                if (response != null && BattleLifecycle.IsBattleGone(response.error))
                {
                    // The server ended this battle (nobody became ready in time,
                    // a reconnect deadline passed, or no result can arrive any
                    // more). Nothing can start here: leave the loading screen.
                    await ReturnToMainMapAsync();
                }
                else if (!_destroyed && BattleSession.HasActiveSession)
                {
                    await WaitForOpponentAsync();
                }
                return;
            }

            BattleSession.ApplyReadyState(response.data);

            if (response.data.attacker_ready && response.data.defender_ready)
            {
                await RunCountdownAsync();
            }
            else
            {
                Debug.Log("[BattleLoadingController] Waiting for opponent to be ready.");
                await WaitForOpponentAsync();
            }
        }

        /// <summary>Re-checks the battle until both players are ready, or
        /// the server ends it (BattleLifecycle.NextReadyStep).</summary>
        private async Task WaitForOpponentAsync()
        {
            var waited = 0f;
            while (!_destroyed && BattleSession.HasActiveSession)
            {
                await Task.Delay(TimeSpan.FromSeconds(BattleLifecycle.ReadyPollIntervalSeconds));
                waited += BattleLifecycle.ReadyPollIntervalSeconds;
                if (_destroyed || !BattleSession.HasActiveSession)
                {
                    return;
                }

                var response = await _apiClient.GetAsync<BattleSessionData>($"/battle/{BattleSession.Current.battle_id}");
                if (_destroyed)
                {
                    return;
                }

                var data = response.success ? response.data : null;
                var step = BattleLifecycle.NextReadyStep(
                    response.success && data != null, data?.status,
                    data != null && data.attacker_ready, data != null && data.defender_ready,
                    response.error, waited);

                if (step == ReadyWaitStep.StartCountdown)
                {
                    BattleSession.ApplyReadyState(data);
                    await RunCountdownAsync();
                    return;
                }

                if (step == ReadyWaitStep.LeaveBattle)
                {
                    Debug.LogWarning("[BattleLoadingController] Battle ended before both players were ready.");
                    await ReturnToMainMapAsync();
                    return;
                }
            }
        }

        /// <summary>
        /// Countdown synchronization: both clients run the same fixed
        /// countdown (Constants.Battle.CountdownSeconds = 3, per Battle
        /// System v1.0 section 2) once both are confirmed ready. This is a
        /// local, deterministic timer rather than a networked one — safe
        /// for Sprint 5 since no gameplay-affecting state depends on exact
        /// millisecond alignment yet (movement sync starts only after the
        /// countdown completes).
        /// </summary>
        private async Task RunCountdownAsync()
        {
            SetLoadingVisible(false);
            SetCountdownVisible(true);

            var remaining = Constants.Battle.CountdownSeconds;
            while (remaining > 0)
            {
                Debug.Log($"[BattleLoadingController] Countdown: {remaining}");
                await Task.Delay(1000);
                remaining--;
            }

            SetCountdownVisible(false);
            StartSession();
        }

        /// <summary>Session start: movement synchronization becomes live.
        /// Combat is intentionally not enabled here — Sprint 6.</summary>
        private void StartSession()
        {
            _sessionActive = true;
            SetMovementInput(true);
            Debug.Log("[BattleLoadingController] Battle session started (movement sync active, combat pending Sprint 6).");
        }

        /// <summary>
        /// Session end: called when BattleSession reports a non
        /// in_progress status (resolved/forfeited/cancelled). Sprint 5 only
        /// tears down the session and despawns — it does not display a
        /// battle result, which depends on Sprint 6 combat resolution.
        /// </summary>
        public void EndSession()
        {
            if (!_sessionActive)
            {
                return;
            }

            _sessionActive = false;
            SetMovementInput(false);
            playerSpawner?.DespawnAll();
            Debug.Log("[BattleLoadingController] Battle session ended.");
        }

        private void OnEnable()
        {
            BattleSession.OnSessionEnded += EndSession;
        }

        private void OnDisable()
        {
            BattleSession.OnSessionEnded -= EndSession;
        }

        private void OnDestroy()
        {
            _destroyed = true;
            SetMovementInput(false);
        }

        /// <summary>Movement input reaches Photon only during the live match.</summary>
        private static void SetMovementInput(bool enabled)
        {
            var locator = ServiceLocator.Instance;
            if (locator != null && locator.TryGet<PhotonConnectionManager>(out var photon))
            {
                photon.SendMovementInput = enabled;
            }
        }

        private void SetLoadingVisible(bool visible)
        {
            if (loadingPanel != null)
            {
                loadingPanel.SetActive(visible);
            }
        }

        private void SetCountdownVisible(bool visible)
        {
            if (countdownPanel != null)
            {
                countdownPanel.SetActive(visible);
            }
        }
    }
}
