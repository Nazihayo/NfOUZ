using NUnit.Framework;
using Nfouz.Networking;
using Nfouz.Utils;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// A battle the server ended without a result (forfeit, or the backend's
    /// lifecycle cleanup cancelling it) is never shown as a win, loss or
    /// draw, and a battle that is gone sends the player back to MainMap.
    /// </summary>
    [TestFixture]
    public class BattleLifecycleTests
    {
        [TestCase("in_progress", BattleEndKind.InProgress)]
        [TestCase("resolved", BattleEndKind.Resolved)]
        [TestCase("pending_review", BattleEndKind.PendingReview)]
        [TestCase("forfeited", BattleEndKind.EndedWithoutResult)]
        [TestCase("cancelled", BattleEndKind.EndedWithoutResult)]
        [TestCase("some_future_status", BattleEndKind.EndedWithoutResult)]
        [TestCase(null, BattleEndKind.EndedWithoutResult)]
        public void ServerStatus_MapsToWhatTheClientShows(string status, BattleEndKind expected)
        {
            Assert.AreEqual(expected, BattleLifecycle.FromStatus(status));
        }

        [TestCase("SESSION_EXPIRED", true)]
        [TestCase("BATTLE_NOT_FOUND", true)]
        [TestCase("NETWORK_ERROR", false)]
        [TestCase("INVALID_TOKEN", false)]
        [TestCase("FORBIDDEN", false)]
        [TestCase("DUPLICATE_CHALLENGE", false)]
        public void OnlyAnEndedOrMissingBattle_CountsAsGone(string code, bool expected)
        {
            Assert.AreEqual(expected, BattleLifecycle.IsBattleGone(new ApiError { code = code, message = "x" }));
        }

        [Test]
        public void NoError_IsNotGone()
        {
            Assert.IsFalse(BattleLifecycle.IsBattleGone(null));
        }

        [Test]
        public void ConstantsMatchTheBackendCodes()
        {
            Assert.AreEqual("SESSION_EXPIRED", Constants.ErrorCodes.SessionExpired);
            Assert.AreEqual("BATTLE_NOT_FOUND", Constants.ErrorCodes.BattleNotFound);
        }

        // ---- Loading screen: waiting for the opponent to be ready

        [Test]
        public void Waiting_KeepsWaitingWhileTheOpponentIsNotReady()
        {
            Assert.AreEqual(ReadyWaitStep.KeepWaiting, BattleLifecycle.NextReadyStep(true, "in_progress", true, false, null, 3f));
        }

        [Test]
        public void Waiting_StartsTheCountdownOnceBothAreReady()
        {
            Assert.AreEqual(ReadyWaitStep.StartCountdown, BattleLifecycle.NextReadyStep(true, "in_progress", true, true, null, 3f));
        }

        [TestCase("cancelled")]
        [TestCase("forfeited")]
        [TestCase("resolved")]
        public void Waiting_LeavesWhenTheServerEndedTheBattle(string status)
        {
            Assert.AreEqual(ReadyWaitStep.LeaveBattle, BattleLifecycle.NextReadyStep(true, status, true, false, null, 3f));
        }

        [TestCase("SESSION_EXPIRED")]
        [TestCase("BATTLE_NOT_FOUND")]
        public void Waiting_LeavesWhenTheBattleIsGone(string code)
        {
            Assert.AreEqual(ReadyWaitStep.LeaveBattle, BattleLifecycle.NextReadyStep(false, null, false, false, new ApiError { code = code }, 3f));
        }

        [Test]
        public void Waiting_KeepsTryingThroughNetworkErrorsUntilTheReadyTimeoutHasPassed()
        {
            var network = new ApiError { code = Constants.ErrorCodes.NetworkError };
            var lastChance = Constants.Battle.ReadyTimeoutSeconds + BattleLifecycle.ReadyPollIntervalSeconds;
            Assert.AreEqual(ReadyWaitStep.KeepWaiting, BattleLifecycle.NextReadyStep(false, null, false, false, network, lastChance - 0.1f));
            Assert.AreEqual(ReadyWaitStep.LeaveBattle, BattleLifecycle.NextReadyStep(false, null, false, false, network, lastChance));
        }

        [Test]
        public void Waiting_NeverOutlastsTheServerReadyTimeout()
        {
            // The server cancels at the ready timeout; the client gives it one
            // more poll and then leaves even if it still reads in_progress.
            Assert.AreEqual(30f, Constants.Battle.ReadyTimeoutSeconds);
            Assert.AreEqual(ReadyWaitStep.LeaveBattle, BattleLifecycle.NextReadyStep(true, "in_progress", true, false, null, 31.5f));
        }

        // Alpha defender flow: the attacker waits for an explicit answer.

        [Test]
        public void Outgoing_JoinsAsHostOnlyOnceTheDefenderAccepted()
        {
            Assert.AreEqual(OutgoingWaitStep.KeepWaiting, BattleLifecycle.NextOutgoingStep(true, "in_progress", "pending", null, 3f));
            Assert.AreEqual(OutgoingWaitStep.JoinAsHost, BattleLifecycle.NextOutgoingStep(true, "in_progress", "accepted", null, 3f));
        }

        [Test]
        public void Outgoing_DeclinedIsReportedAsDeclined()
        {
            Assert.AreEqual(OutgoingWaitStep.Declined, BattleLifecycle.NextOutgoingStep(true, "cancelled", "declined", null, 3f));
        }

        [TestCase("cancelled", "expired")]
        [TestCase("forfeited", "accepted")]
        [TestCase("resolved", "accepted")]
        [TestCase("cancelled", null)]
        public void Outgoing_AnEndedChallengeIsNoAnswer_NeverAJoin(string status, string challengeState)
        {
            Assert.AreEqual(OutgoingWaitStep.NoAnswer, BattleLifecycle.NextOutgoingStep(true, status, challengeState, null, 3f));
        }

        [TestCase("SESSION_EXPIRED")]
        [TestCase("BATTLE_NOT_FOUND")]
        public void Outgoing_AGoneBattleIsNoAnswer(string code)
        {
            Assert.AreEqual(OutgoingWaitStep.NoAnswer, BattleLifecycle.NextOutgoingStep(false, null, null, new ApiError { code = code }, 3f));
        }

        [Test]
        public void Outgoing_NeverWaitsPastTheServerExpiryPlusOnePoll()
        {
            var network = new ApiError { code = Constants.ErrorCodes.NetworkError };
            var lastChance = Constants.Battle.ReadyTimeoutSeconds + BattleLifecycle.ReadyPollIntervalSeconds;
            Assert.AreEqual(OutgoingWaitStep.KeepWaiting, BattleLifecycle.NextOutgoingStep(false, null, null, network, lastChance - 0.1f));
            Assert.AreEqual(OutgoingWaitStep.NoAnswer, BattleLifecycle.NextOutgoingStep(false, null, null, network, lastChance));
            Assert.AreEqual(OutgoingWaitStep.NoAnswer, BattleLifecycle.NextOutgoingStep(true, "in_progress", "pending", null, lastChance));
        }
    }
}
