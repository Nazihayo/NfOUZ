using System;
using System.Threading;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Map;
using Nfouz.UI;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Networking
{
    /// <summary>
    /// Orchestrates the Sprint 5 target flow end-to-end:
    /// Player A selects Player B -> Sends Challenge -> (Alpha defender flow)
    /// Player B accepts on MainMap (IncomingChallengeCoordinator) -> Photon
    /// Room Created by A as Host, joined by B as Client
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
        private readonly ActionGate _challengeGate = new ActionGate();
        private readonly CancellationTokenSource _destroyCts = new CancellationTokenSource();

        /// <summary>PopupManager key of the attacker's "waiting" popup.</summary>
        private const string WaitingPopupKey = "outgoing-challenge-wait";

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
            // Ends the attacker's wait; its finally closes the waiting popup.
            _destroyCts.Cancel();

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

            // One challenge at a time: a second tap while the first is in
            // flight would otherwise send POST /battle/challenge again.
            if (!_challengeGate.TryBegin())
            {
                return;
            }

            try
            {
                await ChallengeAsync(targetData);
            }
            finally
            {
                _challengeGate.End();
            }
        }

        private async Task ChallengeAsync(NearbyPlayerData targetData)
        {
            var payload = new ChallengeRequestPayload
            {
                defender_id = targetData.player_id,
                location = new ChallengeLocationPayload { lat = targetData.lat, lng = targetData.lng },
            };

            var response = await _apiClient.PostAsync<BattleSessionData>("/battle/challenge", payload);

            if (!response.success)
            {
                Debug.LogWarning($"[PhotonRoomLifecycle] Challenge failed: {response.error?.code}");
                ShowChallengeError(ChallengeErrorMessages.FromApiError(response.error));
                return;
            }

            BattleSession.UpdateFromServer(response.data);

            // Alpha defender flow: nobody joins Photon until the defender
            // accepts (POST /battle/{id}/accept). The challenge gate stays
            // held while waiting, so no second challenge can be sent.
            ShowWaitingPopup();
            OutgoingWaitStep step;
            try
            {
                step = await WaitForAnswerAsync(response.data.battle_id, _destroyCts.Token);
            }
            catch (OperationCanceledException)
            {
                return; // MainMap is going away
            }
            finally
            {
                DismissWaitingPopup();
            }

            switch (step)
            {
                case OutgoingWaitStep.JoinAsHost:
                    await JoinBattleAsync(response.data.photon_room_name, asHost: true);
                    break;
                case OutgoingWaitStep.Declined:
                    BattleSession.Clear();
                    ShowChallengeError(IncomingChallengeMessages.DeclinedByOpponent);
                    break;
                default:
                    BattleSession.Clear();
                    ShowChallengeError(IncomingChallengeMessages.NoAnswer);
                    break;
            }
        }

        /// <summary>
        /// Polls GET /battle/{id} until the defender answers, the server
        /// ends the challenge, or the client-side cap passes
        /// (BattleLifecycle.NextOutgoingStep). One request at a time.
        /// </summary>
        private async Task<OutgoingWaitStep> WaitForAnswerAsync(string battleId, CancellationToken token)
        {
            var waited = 0f;
            while (true)
            {
                await Task.Delay(TimeSpan.FromSeconds(BattleLifecycle.ReadyPollIntervalSeconds), token);
                waited += BattleLifecycle.ReadyPollIntervalSeconds;

                var poll = await _apiClient.GetAsync<BattleSessionData>($"/battle/{battleId}", token);
                token.ThrowIfCancellationRequested();

                var step = BattleLifecycle.NextOutgoingStep(
                    poll.success, poll.data?.status, poll.data?.challenge_state, poll.error, waited);
                if (step != OutgoingWaitStep.KeepWaiting)
                {
                    return step;
                }
            }
        }

        /// <summary>
        /// The defender accepted (IncomingChallengeCoordinator): keep the
        /// session (no host-signing material) and join the attacker's room as
        /// Client. Returns false if the room could not be joined; the
        /// session is then cleared and MainMap stays usable.
        /// </summary>
        public async Task<bool> JoinAsDefenderAsync(ChallengeAnswerData accepted)
        {
            if (accepted == null || string.IsNullOrEmpty(accepted.photon_room_name))
            {
                return false;
            }

            if (!_challengeGate.TryBegin())
            {
                // This player is waiting on a challenge of their own; the
                // server refuses that case (DUPLICATE_CHALLENGE), so it
                // should never happen.
                return false;
            }

            try
            {
                BattleSession.UpdateFromServer(accepted.ToSession());
                return await JoinBattleAsync(accepted.photon_room_name, asHost: false);
            }
            finally
            {
                _challengeGate.End();
            }
        }

        /// <summary>
        /// Steps 3-6 of the target flow: joins the Photon room, then loads
        /// the Battle scene once the join succeeds. Spawning itself is
        /// handled by NetworkPlayerSpawner once the scene is active (see
        /// BattleLoadingController for the scene-entry sequencing).
        /// </summary>
        private async Task<bool> JoinBattleAsync(string photonRoomName, bool asHost)
        {
            if (_photonConnectionManager == null)
            {
                Debug.LogError("[PhotonRoomLifecycle] PhotonConnectionManager not available via ServiceLocator.");
                BattleSession.Clear();
                return false;
            }

            var joined = await _photonConnectionManager.JoinRoomAsync(photonRoomName, asHost);
            if (!joined)
            {
                Debug.LogError("[PhotonRoomLifecycle] Failed to join Photon room — aborting battle entry.");
                // Nobody entered the room: drop the local session so MainMap
                // is not left holding a battle. The server cancels it when the
                // ready timeout passes (backend utils/battleLifecycle.js).
                BattleSession.Clear();
                ShowChallengeError(ChallengeErrorMessages.JoinFailed);
                return false;
            }

            await SceneLoader.LoadAsync(Constants.Scenes.Battle);
            return true;
        }

        private static void ShowWaitingPopup()
        {
            var locator = ServiceLocator.Instance;
            if (locator != null && locator.TryGet<PopupManager>(out var popups))
            {
                popups.ShowInfo(IncomingChallengeMessages.WaitingTitle, IncomingChallengeMessages.Waiting,
                    IncomingChallengeMessages.WaitingDismiss, WaitingPopupKey);
            }
        }

        private static void DismissWaitingPopup()
        {
            var locator = ServiceLocator.Instance;
            if (locator != null && locator.TryGet<PopupManager>(out var popups))
            {
                popups.Dismiss(WaitingPopupKey);
            }
        }

        /// <summary>
        /// Starts the 15-second reconnect grace period locally and notifies
        /// the backend so it can track the same deadline server-side
        /// (battle.service.js handleDisconnect). Sprint 5 scope: session
        /// state only, no forfeit RESULT logic here.
        /// </summary>
        private static void ShowChallengeError(string message)
        {
            var locator = ServiceLocator.Instance;
            if (locator != null && locator.TryGet<PopupManager>(out var popups))
            {
                popups.ShowInfo(ChallengeErrorMessages.Title, message);
            }
        }

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
                    BattleSession.ApplyStatus(response.data);
                }
                else
                {
                    Debug.LogWarning($"[PhotonRoomLifecycle] Reconnect rejected by server: {response.error?.code}");
                }
            }
        }
    }
}
