using System;
using System.Threading;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Networking;
using Nfouz.UI;
using UnityEngine;

namespace Nfouz.Map
{
    /// <summary>
    /// Alpha defender flow on MainMap: asks the server for a challenge
    /// waiting for this player's answer (GET /battle/incoming) every
    /// IncomingChallengeFlow.PollIntervalSeconds while MainMap is active,
    /// shows one Arabic Accept/Decline prompt for it, and sends the answer
    /// (POST /battle/{id}/accept|decline). On accept the battle session is
    /// stored and the defender joins the attacker's room as Photon Client
    /// (PhotonRoomLifecycle.JoinAsDefenderAsync). Push notifications for
    /// challenges are deferred until FCM is set up.
    ///
    /// One poll loop per enable, one request at a time, cancelled in
    /// OnDisable (also when the scene is unloaded). What is shown and when
    /// lives in IncomingChallengeFlow, which is tested without Unity.
    /// </summary>
    public class IncomingChallengeCoordinator : MonoBehaviour
    {
        private const string PromptKey = "incoming-challenge";

        [SerializeField] private PhotonRoomLifecycle photonRoomLifecycle;

        private readonly IncomingChallengeFlow _flow = new IncomingChallengeFlow();
        private ApiClient _apiClient;
        private CancellationTokenSource _pollCts;

        private void Awake()
        {
            var locator = ServiceLocator.Instance;
            if (locator != null)
            {
                locator.TryGet(out _apiClient);
            }
        }

        private void OnEnable()
        {
            PlayerSession.OnSessionUpdated += HandleSessionUpdated;
            _pollCts = new CancellationTokenSource();
            _ = PollLoopAsync(_pollCts.Token);
        }

        private void OnDisable()
        {
            PlayerSession.OnSessionUpdated -= HandleSessionUpdated;
            _pollCts?.Cancel();
            _pollCts = null;
            DismissPrompt();
        }

        private void HandleSessionUpdated(PlayerSessionData _)
        {
            SyncOwner();
        }

        /// <summary>Another account (or none) signed in: drop the previous
        /// player's prompt and everything known about their challenges.</summary>
        private void SyncOwner()
        {
            var playerId = PlayerSession.HasActiveSession ? PlayerSession.Current.PlayerId : null;
            if (_flow.SyncOwner(playerId) == IncomingPromptAction.Close)
            {
                DismissPrompt();
            }
        }

        private async Task PollLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                SyncOwner();
                if (_flow.ShouldPoll && _apiClient != null)
                {
                    var polledFor = _flow.OwnerId;
                    var response = await _apiClient.GetAsync<IncomingChallengesResponseData>("/battle/incoming", token);
                    if (token.IsCancellationRequested)
                    {
                        break;
                    }

                    if (!response.success)
                    {
                        Debug.LogWarning($"[IncomingChallengeCoordinator] Poll failed: {response.error?.code}");
                    }

                    SyncOwner();
                    var challenges = response.success ? response.data?.challenges : null;
                    var incoming = challenges != null && challenges.Length > 0 ? challenges[0] : null;
                    Apply(_flow.OnPoll(polledFor, response.success, incoming?.battle_id), incoming);
                }

                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(IncomingChallengeFlow.PollIntervalSeconds), token);
                }
                catch (OperationCanceledException)
                {
                    break; // MainMap disabled or unloaded — stop polling.
                }
            }
        }

        private void Apply(IncomingPromptAction action, IncomingChallengeData incoming)
        {
            if (action == IncomingPromptAction.Close)
            {
                DismissPrompt();
            }
            else if (action == IncomingPromptAction.Show && TryGetPopups(out var popups))
            {
                popups.Dismiss(PromptKey); // never two prompts on screen
                var battleId = incoming.battle_id;
                popups.ShowConfirm(
                    IncomingChallengeMessages.PromptTitle,
                    IncomingChallengeMessages.PromptBody(incoming.attacker_username, incoming.attacker_class_type, incoming.attacker_rank),
                    IncomingChallengeMessages.Accept,
                    IncomingChallengeMessages.Decline,
                    () => _ = AnswerAsync(battleId, accept: true),
                    () => _ = AnswerAsync(battleId, accept: false),
                    PromptKey);
            }
        }

        private async Task AnswerAsync(string battleId, bool accept)
        {
            // One answer per prompt: a second tap, or a tap on a prompt that
            // is no longer the current challenge, sends nothing.
            if (_apiClient == null || !_flow.TryBeginAnswer(battleId))
            {
                return;
            }

            var answeredFor = _flow.OwnerId;
            var response = accept
                ? await _apiClient.PostAsync<ChallengeAnswerData>($"/battle/{battleId}/accept", null)
                : await _apiClient.PostAsync<ChallengeAnswerData>($"/battle/{battleId}/decline", null);
            if (this == null)
            {
                return; // MainMap was unloaded meanwhile
            }

            var retryable = !response.success && IncomingChallengeMessages.IsRetryable(response.error);
            if (!_flow.OnAnswered(answeredFor, accept, response.success, retryable))
            {
                return; // another account signed in meanwhile
            }

            if (!response.success)
            {
                Debug.LogWarning($"[IncomingChallengeCoordinator] Answer refused: {response.error?.code}");
                ShowError(IncomingChallengeMessages.FromAnswerError(response.error));
                return;
            }

            if (!accept)
            {
                return; // declined: both players are free, MainMap goes on
            }

            if (photonRoomLifecycle == null)
            {
                Debug.LogError("[IncomingChallengeCoordinator] PhotonRoomLifecycle not assigned.");
                ShowError(ChallengeErrorMessages.JoinFailed);
                _flow.ResumeAfterFailedJoin();
                return;
            }

            // Shows its own error and clears the session if the join fails.
            if (!await photonRoomLifecycle.JoinAsDefenderAsync(response.data) && this != null)
            {
                _flow.ResumeAfterFailedJoin();
            }
        }

        private void DismissPrompt()
        {
            if (TryGetPopups(out var popups))
            {
                popups.Dismiss(PromptKey);
            }
        }

        private static void ShowError(string message)
        {
            if (TryGetPopups(out var popups))
            {
                popups.ShowInfo(IncomingChallengeMessages.AnswerErrorTitle, message);
            }
        }

        private static bool TryGetPopups(out PopupManager popups)
        {
            popups = null;
            var locator = ServiceLocator.Instance;
            return locator != null && locator.TryGet(out popups);
        }
    }
}
