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

        /// <summary>The battle is over or does not exist any more
        /// (SESSION_EXPIRED / BATTLE_NOT_FOUND), so nothing can be done in
        /// it. Network, auth and authorization errors are not this.</summary>
        public static bool IsBattleGone(ApiError error)
        {
            return error?.code == Constants.ErrorCodes.SessionExpired || error?.code == Constants.ErrorCodes.BattleNotFound;
        }
    }
}
