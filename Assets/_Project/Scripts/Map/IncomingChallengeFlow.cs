using System.Collections.Generic;

namespace Nfouz.Map
{
    /// <summary>What the MainMap does with the incoming-challenge prompt.</summary>
    public enum IncomingPromptAction
    {
        None,
        /// <summary>Show the prompt for ShownBattleId (closing any other first).</summary>
        Show,
        /// <summary>Close the prompt: the challenge expired, was answered
        /// elsewhere, or belongs to an account that is no longer signed in.</summary>
        Close,
    }

    /// <summary>
    /// The defender's side of a challenge on MainMap (Alpha defender flow).
    /// One prompt at a time; a challenge that was answered or went away is
    /// never shown again; another account signing in clears everything;
    /// after an accept the flow stops until the battle is joined or the
    /// join fails. The server decides every outcome (GET /battle/incoming,
    /// POST /battle/{id}/accept|decline); this only decides what the screen
    /// shows. Unity-free so it is tested directly (IncomingChallengeFlowTests).
    /// </summary>
    public sealed class IncomingChallengeFlow
    {
        /// <summary>Same cadence as the SOS poll (SOSManager); the server
        /// allows 3 polls per 5 s.</summary>
        public const float PollIntervalSeconds = 5f;

        private readonly HashSet<string> _finished = new HashSet<string>();

        /// <summary>The signed-in player this state belongs to.</summary>
        public string OwnerId { get; private set; }

        /// <summary>The challenge on screen (or being answered); null if none.</summary>
        public string ShownBattleId { get; private set; }

        /// <summary>An Accept or Decline request is in flight.</summary>
        public bool IsAnswering { get; private set; }

        /// <summary>Accepted: no more prompts until ResumeAfterFailedJoin.</summary>
        public bool IsStopped { get; private set; }

        /// <summary>
        /// Call before each poll and whenever the signed-in player may have
        /// changed. Another player (or none) resets everything; returns Close
        /// if that player's prompt was on screen.
        /// </summary>
        public IncomingPromptAction SyncOwner(string currentPlayerId)
        {
            if (currentPlayerId == OwnerId)
            {
                return IncomingPromptAction.None;
            }

            var hadPrompt = ShownBattleId != null;
            OwnerId = currentPlayerId;
            ShownBattleId = null;
            IsAnswering = false;
            IsStopped = false;
            _finished.Clear();
            return hadPrompt ? IncomingPromptAction.Close : IncomingPromptAction.None;
        }

        /// <summary>Whether a poll may be sent now.</summary>
        public bool ShouldPoll => !string.IsNullOrEmpty(OwnerId) && !IsStopped && !IsAnswering;

        /// <summary>
        /// One GET /battle/incoming answer. polledForPlayerId is the player
        /// signed in when the request was sent: an answer for anyone else
        /// is dropped. incomingBattleId is the pending challenge, or null.
        /// A failed poll changes nothing.
        /// </summary>
        public IncomingPromptAction OnPoll(string polledForPlayerId, bool success, string incomingBattleId)
        {
            if (string.IsNullOrEmpty(OwnerId) || polledForPlayerId != OwnerId || IsStopped || IsAnswering || !success)
            {
                return IncomingPromptAction.None;
            }

            if (string.IsNullOrEmpty(incomingBattleId) || _finished.Contains(incomingBattleId))
            {
                return CloseShown();
            }

            if (incomingBattleId == ShownBattleId)
            {
                return IncomingPromptAction.None;
            }

            if (ShownBattleId != null)
            {
                _finished.Add(ShownBattleId); // replaced: the server no longer offers it
            }

            ShownBattleId = incomingBattleId;
            return IncomingPromptAction.Show;
        }

        /// <summary>Accept or Decline was pressed on the prompt for
        /// battleId. False (send nothing) if that is not the challenge on
        /// screen or an answer is already in flight.</summary>
        public bool TryBeginAnswer(string battleId)
        {
            if (IsAnswering || IsStopped || string.IsNullOrEmpty(battleId) || battleId != ShownBattleId)
            {
                return false;
            }

            IsAnswering = true;
            return true;
        }

        /// <summary>
        /// The server answered. answeredForPlayerId is the player signed in
        /// when the answer was sent; a result for anyone else is ignored
        /// (returns false). retryable: the request may not have reached the
        /// server (network, rate limit), so the same challenge may be shown
        /// again by the next poll; any other outcome is final.
        /// </summary>
        public bool OnAnswered(string answeredForPlayerId, bool accepted, bool success, bool retryable)
        {
            if (!IsAnswering || answeredForPlayerId != OwnerId)
            {
                return false;
            }

            IsAnswering = false;
            if (success || !retryable)
            {
                _finished.Add(ShownBattleId);
            }

            ShownBattleId = null;
            IsStopped = success && accepted;
            return true;
        }

        /// <summary>The accepted battle could not be joined: MainMap goes on.
        /// The accepted challenge is not offered again (the server ends it
        /// at the ready timeout).</summary>
        public void ResumeAfterFailedJoin()
        {
            IsStopped = false;
        }

        private IncomingPromptAction CloseShown()
        {
            if (ShownBattleId == null)
            {
                return IncomingPromptAction.None;
            }

            _finished.Add(ShownBattleId);
            ShownBattleId = null;
            return IncomingPromptAction.Close;
        }
    }
}
