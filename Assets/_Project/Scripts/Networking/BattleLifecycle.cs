using Nfouz.Utils;

namespace Nfouz.Networking
{
    /// <summary>What a battle's server status means for the client.</summary>
    public enum BattleEndKind
    {
        /// <summary>in_progress: the match is still running.</summary>
        InProgress,
        /// <summary>resolved: a winner/loser (or a draw) was recorded.</summary>
        Resolved,
        /// <summary>pending_review: a result was accepted but held for review.</summary>
        PendingReview,
        /// <summary>forfeited / cancelled (or any unknown status): the
        /// battle ended without a result — a reconnect deadline passed,
        /// nobody got ready in time, or no result could arrive any more
        /// (backend utils/battleLifecycle.js). Never shown as a win, loss
        /// or draw.</summary>
        EndedWithoutResult,
    }

    /// <summary>What the Battle loading screen does after a check of the
    /// battle while it waits for the opponent to be ready.</summary>
    public enum ReadyWaitStep
    {
        KeepWaiting,
        StartCountdown,
        /// <summary>The battle cannot start any more: back to MainMap.</summary>
        LeaveBattle,
    }

    /// <summary>What the attacker does after a check of a challenge that
    /// waits for the defender's answer (Alpha defender flow).</summary>
    public enum OutgoingWaitStep
    {
        KeepWaiting,
        /// <summary>The defender accepted: join the room as Host.</summary>
        JoinAsHost,
        /// <summary>The defender declined: back to MainMap.</summary>
        Declined,
        /// <summary>Nobody answered in time, or the battle ended: back to MainMap.</summary>
        NoAnswer,
    }

    /// <summary>
    /// How the client reads the server's battle lifecycle. Unity-free so it
    /// is tested directly (BattleLifecycleTests); the contract test checks
    /// that every status the backend's schema allows is handled here.
    /// </summary>
    public static class BattleLifecycle
    {
        public static BattleEndKind FromStatus(string status)
        {
            switch (status)
            {
                case "in_progress":
                    return BattleEndKind.InProgress;
                case "resolved":
                    return BattleEndKind.Resolved;
                case "pending_review":
                    return BattleEndKind.PendingReview;
                case "forfeited":
                case "cancelled":
                    return BattleEndKind.EndedWithoutResult;
                default:
                    return BattleEndKind.EndedWithoutResult;
            }
        }

        /// <summary>How often the loading screen re-checks the battle while
        /// waiting for the opponent (the same cadence as BattleManager's
        /// result polling).</summary>
        public const float ReadyPollIntervalSeconds = 1.5f;

        /// <summary>
        /// Next step while waiting on the loading screen, from one GET
        /// /battle/{id}. The server cancels a battle that both players have
        /// not readied within Constants.Battle.ReadyTimeoutSeconds (backend
        /// utils/battleLifecycle.js); one more poll after that gives it the
        /// chance to say so, and past that the client leaves even if the
        /// server could not be reached, because the same rule ends the
        /// battle there.
        /// </summary>
        public static ReadyWaitStep NextReadyStep(bool success, string status, bool attackerReady, bool defenderReady, ApiError error, float waitedSeconds)
        {
            if (success)
            {
                if (FromStatus(status) != BattleEndKind.InProgress)
                {
                    return ReadyWaitStep.LeaveBattle;
                }

                if (attackerReady && defenderReady)
                {
                    return ReadyWaitStep.StartCountdown;
                }
            }
            else if (IsBattleGone(error))
            {
                return ReadyWaitStep.LeaveBattle;
            }

            return waitedSeconds >= Constants.Battle.ReadyTimeoutSeconds + ReadyPollIntervalSeconds
                ? ReadyWaitStep.LeaveBattle
                : ReadyWaitStep.KeepWaiting;
        }

        /// <summary>
        /// Next step while the attacker waits for the defender to accept,
        /// from one GET /battle/{id}. The server ends an unanswered
        /// challenge at Constants.Battle.ReadyTimeoutSeconds after it was
        /// sent (backend utils/battleLifecycle.js); one more poll after that
        /// gives it the chance to say so, and past that the attacker stops
        /// waiting even if the server could not be reached. Polled at
        /// ReadyPollIntervalSeconds, like the loading screen.
        /// </summary>
        public static OutgoingWaitStep NextOutgoingStep(bool success, string status, string challengeState, ApiError error, float waitedSeconds)
        {
            if (success)
            {
                if (challengeState == "declined")
                {
                    return OutgoingWaitStep.Declined;
                }

                if (FromStatus(status) != BattleEndKind.InProgress)
                {
                    return OutgoingWaitStep.NoAnswer;
                }

                if (challengeState == "accepted")
                {
                    return OutgoingWaitStep.JoinAsHost;
                }
            }
            else if (IsBattleGone(error))
            {
                return OutgoingWaitStep.NoAnswer;
            }

            return waitedSeconds >= Constants.Battle.ReadyTimeoutSeconds + ReadyPollIntervalSeconds
                ? OutgoingWaitStep.NoAnswer
                : OutgoingWaitStep.KeepWaiting;
        }

        /// <summary>The battle is over or does not exist any more
        /// (SESSION_EXPIRED / BATTLE_NOT_FOUND), so nothing can be done in
        /// it. Network, auth and authorization errors are not this.</summary>
        public static bool IsBattleGone(ApiError error)
        {
            return error?.code == Constants.ErrorCodes.SessionExpired || error?.code == Constants.ErrorCodes.BattleNotFound;
        }
    }
}
