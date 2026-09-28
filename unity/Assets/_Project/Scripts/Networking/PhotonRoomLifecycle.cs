using System;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Map;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Networking
{
    /// <summary>
    /// Orchestrates the Sprint 5 target flow end-to-end:
    /// Player A selects Player B -> Sends Challenge -> Photon Room Created
    /// -> Both Players Join -> Both Players Spawn -> Network Synchronization
    /// Works -> Battle Scene Loads -> Ready For Sprint 6 Combat.
    ///
    /// Subscribes to ChallengeInteractionController.OnChallengeRequested
    /// (the documented Sprint 5/6 integration hook) to call
    /// POST /battle/challenge and then drive the Photon room join + scene
    /// transition. Also owns the 15-second disconnect grace period and
    /// forfeit-flag session state — NOT final battle result logic
    /// (Sprint 6), per the Sprint 5 spec.
    /// </summary>
    public class PhotonRoomLifecycle : MonoBehaviour
    {
        [SerializeField] private ChallengeInteractionController challengeInteractionController;

        private ApiClient _apiClient;
        private PhotonConnectionManager _photonConnectionManager;

        private float _disconnectGraceRemaining = -1f;
        private bool _awaitingReconnect;

        private void Awake()
        {
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();
            _photonConnectionManager = ServiceLocator.Instance.Get<PhotonConnectionManager>();

            if (challengeInteractionController != null)
            {
                challengeInteractionController.OnChallengeRequested += HandleChallengeRequested;
            }

            if (_photonConnectionManager != null)
            {
                _photonConnectionManager.OnPlayerDisconnected += HandlePlayerDisconnected;
                _photonConnectionManager.OnPlayerReconnected += HandlePlayerReconnected;
            }
        }

        private void OnDestroy()
        {
            if (challengeInteractionController != null)
            {
                challengeInteractionController.OnChallengeRequested -= HandleChallengeRequested;
            }

            if (_photonConnectionManager != null)
            {
                _photonConnectionManager.OnPlayerDisconnected -= HandlePlayerDisconnected;
                _photonConnectionManager.OnPlayerReconnected -= HandlePlayerReconnected;
            }
        }

        private void Update()
        {
            // Local countdown mirroring the server's 15s grace period
            // (BATTLE_DISCONNECT_GRACE_SECONDS). The server is the source
            // of truth for the actual forfeit decision (battle.service.js
            // checkForfeit) — this local timer only drives the UI and
            // triggers the reconnect-window-expired client-side cutoff.
            if (_awaitingReconnect && _disconnectGraceRemaining > 0f)
            {
                _disconnectGraceRemaining -= Time.deltaTime;
                if (_disconnectGraceRemaining <= 0f)
                {
                    Debug.LogWarning("[PhotonRoomLifecycle] Reconnect grace period elapsed locally.");
                    _awaitingReconnect = false;
                }
            }
        }

        /// <summary>
        /// Step 1-2 of the target flow: sends the challenge to the backend,
        /// which validates eligibility server-side and creates the battle +
        /// Photon room name. See battle.service.js createChallenge.
        /// </summary>
        private async void HandleChallengeRequested(NearbyPlayerData targetData)
        {
            if (_apiClient == null)
            {
                Debug.LogError("[PhotonRoomLifecycle] ApiClient not available via ServiceLocator.");
                return;
            }

            var payload = new ChallengeRequestPayload
            {
                defender_id = targetData.player_id,
                location = new ChallengeLocationPayload { lat = targetData.lat, lng = targetData.lng },
            };

            var response = await _apiClient.PostAsync<BattleSessionData>("/battle/challenge", payload);

            if (!response.success)
            {
                Debug.LogWarning($"[PhotonRoomLifecycle] Challenge failed: {response.error?.code} — {response.error?.message}");
                return;
            }

            BattleSession.UpdateFromServer(response.data);
            await JoinBattleAsync(response.data.photon_room_name);
        }

        /// <summary>
        /// Steps 3-6 of the target flow: joins the Photon room, then loads
        /// the Battle scene once the join succeeds. Spawning itself is
        /// handled by NetworkPlayerSpawner once the scene is active (see
        /// BattleLoadingController for the scene-entry sequencing).
        /// </summary>
        private async Task JoinBattleAsync(string photonRoomName)
        {
            if (_photonConnectionManager == null)
            {
                Debug.LogError("[PhotonRoomLifecycle] PhotonConnectionManager not available via ServiceLocator.");
                return;
            }

            var joined = await _photonConnectionManager.JoinRoomAsync(photonRoomName);
            if (!joined)
            {
                Debug.LogError("[PhotonRoomLifecycle] Failed to join Photon room — aborting battle entry.");
                return;
            }

            await SceneLoader.LoadAsync(Constants.Scenes.Battle);
        }

        /// <summary>
        /// Starts the 15-second reconnect grace period locally and notifies
        /// the backend so it can track the same deadline server-side
        /// (battle.service.js handleDisconnect). Sprint 5 scope: session
        /// state only, no forfeit RESULT logic here.
        /// </summary>
        private async void HandlePlayerDisconnected()
        {
            _awaitingReconnect = true;
            _disconnectGraceRemaining = Constants.Battle.DisconnectGraceSeconds;

            if (_apiClient != null && BattleSession.HasActiveSession)
            {
                await _apiClient.PostAsync<object>($"/battle/{BattleSession.Current.battle_id}/disconnect", null);
            }
        }

        private async void HandlePlayerReconnected()
        {
            if (!_awaitingReconnect)
            {
                return;
            }

            _awaitingReconnect = false;
            _disconnectGraceRemaining = -1f;

            if (_apiClient != null && BattleSession.HasActiveSession)
            {
                var response = await _apiClient.PostAsync<BattleSessionData>(
                    $"/battle/{BattleSession.Current.battle_id}/reconnect", null);

                if (response.success)
                {
                    BattleSession.UpdateFromServer(response.data);
                }
                else
                {
                    Debug.LogWarning($"[PhotonRoomLifecycle] Reconnect rejected by server: {response.error?.code}");
                }
            }
        }
    }
}
