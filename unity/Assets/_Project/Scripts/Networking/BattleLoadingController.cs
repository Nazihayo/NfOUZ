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

        private ApiClient _apiClient;
        private bool _isAttacker;
        private bool _sessionActive;

        private async void Start()
        {
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();

            SetLoadingVisible(true);
            SetCountdownVisible(false);

            if (!BattleSession.HasActiveSession || !PlayerSession.HasActiveSession)
            {
                Debug.LogError("[BattleLoadingController] Entered Battle scene without an active battle/player session.");
                return;
            }

            _isAttacker = BattleSession.Current.attacker_id == PlayerSession.Current.PlayerId;

            // Both players spawn locally as soon as the scene is ready —
            // NetworkPlayerSpawner seeds attributes from PlayerSession, the
            // remote participant's avatar arrives via Photon's own
            // spawn/replication once PHOTON_FUSION_AVAILABLE is defined.
            playerSpawner?.SpawnLocalPlayer(_isAttacker);

            await ConfirmReadyAsync();
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

            var response = await _apiClient.PostAsync<BattleSessionData>(
                $"/battle/{BattleSession.Current.battle_id}/ready", null);

            if (!response.success)
            {
                Debug.LogWarning($"[BattleLoadingController] Ready confirmation failed: {response.error?.code}");
                return;
            }

            BattleSession.UpdateFromServer(response.data);

            if (response.data.attacker_ready && response.data.defender_ready)
            {
                await RunCountdownAsync();
            }
            else
            {
                Debug.Log("[BattleLoadingController] Waiting for opponent to be ready.");
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
