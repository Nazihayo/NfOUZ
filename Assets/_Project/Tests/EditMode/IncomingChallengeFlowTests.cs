using NUnit.Framework;
using Nfouz.Map;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// The defender's incoming-challenge prompt on MainMap (Alpha defender
    /// flow): one prompt at a time, one answer per prompt, nothing shown
    /// twice, polling stopped after an accept, and nothing carried over to
    /// another account.
    /// </summary>
    [TestFixture]
    public class IncomingChallengeFlowTests
    {
        private const string Me = "player-b";
        private const string Other = "player-c";
        private const string Battle1 = "battle-1";
        private const string Battle2 = "battle-2";

        private static IncomingChallengeFlow SignedIn()
        {
            var flow = new IncomingChallengeFlow();
            flow.SyncOwner(Me);
            return flow;
        }

        [Test]
        public void PollsEveryFiveSeconds_LikeTheSosPoll()
        {
            Assert.AreEqual(5f, IncomingChallengeFlow.PollIntervalSeconds);
        }

        [Test]
        public void NobodySignedIn_DoesNotPoll()
        {
            var flow = new IncomingChallengeFlow();
            Assert.IsFalse(flow.ShouldPoll);
            Assert.AreEqual(IncomingPromptAction.None, flow.OnPoll(null, true, Battle1));
        }

        [Test]
        public void AChallenge_IsShownOnce()
        {
            var flow = SignedIn();
            Assert.AreEqual(IncomingPromptAction.Show, flow.OnPoll(Me, true, Battle1));
            Assert.AreEqual(Battle1, flow.ShownBattleId);
            Assert.AreEqual(IncomingPromptAction.None, flow.OnPoll(Me, true, Battle1));
        }

        [Test]
        public void ExpiredOrAnsweredElsewhere_ClosesThePrompt_AndKeepsPolling()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            Assert.AreEqual(IncomingPromptAction.Close, flow.OnPoll(Me, true, null));
            Assert.IsNull(flow.ShownBattleId);
            Assert.IsTrue(flow.ShouldPoll);
            Assert.AreEqual(IncomingPromptAction.None, flow.OnPoll(Me, true, null));
        }

        [Test]
        public void AClosedChallenge_IsNeverShownAgain()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            flow.OnPoll(Me, true, null);
            Assert.AreEqual(IncomingPromptAction.None, flow.OnPoll(Me, true, Battle1));
        }

        [Test]
        public void ANewChallenge_ReplacesTheOldPrompt_NeverTwoAtOnce()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            Assert.AreEqual(IncomingPromptAction.Show, flow.OnPoll(Me, true, Battle2));
            Assert.AreEqual(Battle2, flow.ShownBattleId);
            Assert.IsFalse(flow.TryBeginAnswer(Battle1)); // the replaced prompt cannot be answered
        }

        [Test]
        public void AFailedPoll_ChangesNothing()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            Assert.AreEqual(IncomingPromptAction.None, flow.OnPoll(Me, false, null));
            Assert.AreEqual(Battle1, flow.ShownBattleId);
        }

        [Test]
        public void DoubleTap_SendsOneAnswer()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            Assert.IsTrue(flow.TryBeginAnswer(Battle1));
            Assert.IsFalse(flow.TryBeginAnswer(Battle1)); // second Accept
            Assert.IsFalse(flow.ShouldPoll);
        }

        [Test]
        public void AcceptAndDeclineTogether_SendOneAnswer()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            Assert.IsTrue(flow.TryBeginAnswer(Battle1));  // Accept
            Assert.IsFalse(flow.TryBeginAnswer(Battle1)); // Decline right after
        }

        [Test]
        public void APollWhileAnswering_IsIgnored()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            flow.TryBeginAnswer(Battle1);
            Assert.AreEqual(IncomingPromptAction.None, flow.OnPoll(Me, true, null));
            Assert.AreEqual(IncomingPromptAction.None, flow.OnPoll(Me, true, Battle2));
        }

        [Test]
        public void Accepted_StopsPolling()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            flow.TryBeginAnswer(Battle1);
            Assert.IsTrue(flow.OnAnswered(Me, accepted: true, success: true, retryable: false));
            Assert.IsTrue(flow.IsStopped);
            Assert.IsFalse(flow.ShouldPoll);
            Assert.AreEqual(IncomingPromptAction.None, flow.OnPoll(Me, true, Battle2));
        }

        [Test]
        public void AFailedJoin_ResumesPolling_WithoutReofferingTheAcceptedChallenge()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            flow.TryBeginAnswer(Battle1);
            flow.OnAnswered(Me, true, true, false);
            flow.ResumeAfterFailedJoin();
            Assert.IsTrue(flow.ShouldPoll);
            Assert.AreEqual(IncomingPromptAction.None, flow.OnPoll(Me, true, Battle1));
        }

        [Test]
        public void Declined_KeepsPolling_AndNeverShowsItAgain()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            flow.TryBeginAnswer(Battle1);
            flow.OnAnswered(Me, accepted: false, success: true, retryable: false);
            Assert.IsTrue(flow.ShouldPoll);
            Assert.AreEqual(IncomingPromptAction.None, flow.OnPoll(Me, true, Battle1));
            Assert.AreEqual(IncomingPromptAction.Show, flow.OnPoll(Me, true, Battle2));
        }

        [Test]
        public void AFinalRefusal_IsNotOfferedAgain()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            flow.TryBeginAnswer(Battle1);
            flow.OnAnswered(Me, accepted: true, success: false, retryable: false); // e.g. SESSION_EXPIRED
            Assert.IsFalse(flow.IsStopped);
            Assert.AreEqual(IncomingPromptAction.None, flow.OnPoll(Me, true, Battle1));
        }

        [Test]
        public void ANetworkFailure_OffersTheSameChallengeAgain()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            flow.TryBeginAnswer(Battle1);
            flow.OnAnswered(Me, accepted: true, success: false, retryable: true);
            Assert.IsFalse(flow.IsStopped);
            Assert.AreEqual(IncomingPromptAction.Show, flow.OnPoll(Me, true, Battle1));
        }

        [Test]
        public void AccountSwitch_ClosesThePrompt_AndForgetsEverything()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            Assert.AreEqual(IncomingPromptAction.Close, flow.SyncOwner(Other));
            Assert.IsNull(flow.ShownBattleId);
            Assert.AreEqual(Other, flow.OwnerId);
        }

        [Test]
        public void AccountSwitch_DropsAPollSentForThePreviousPlayer()
        {
            var flow = SignedIn();
            flow.SyncOwner(Other);
            Assert.AreEqual(IncomingPromptAction.None, flow.OnPoll(Me, true, Battle1));
            Assert.IsNull(flow.ShownBattleId);
        }

        [Test]
        public void AccountSwitch_DropsAnAnswerSentForThePreviousPlayer()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            flow.TryBeginAnswer(Battle1);
            flow.SyncOwner(Other);
            Assert.IsFalse(flow.OnAnswered(Me, true, true, false));
            Assert.IsFalse(flow.IsStopped);
            Assert.IsTrue(flow.ShouldPoll);
        }

        [Test]
        public void AccountSwitch_ThePreviousPlayersLateAnswer_DoesNotTouchTheNewPlayersPrompt()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            flow.TryBeginAnswer(Battle1);       // Me's Accept is in flight
            flow.SyncOwner(Other);
            flow.OnPoll(Other, true, Battle2);
            flow.TryBeginAnswer(Battle2);       // Other answers their own challenge
            Assert.IsFalse(flow.OnAnswered(Me, true, true, false)); // Me's answer arrives late
            Assert.IsTrue(flow.IsAnswering);
            Assert.AreEqual(Battle2, flow.ShownBattleId);
            Assert.IsFalse(flow.IsStopped);
        }

        [Test]
        public void AccountSwitch_StartsFromAnEmptyHistory()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            flow.OnPoll(Me, true, null); // closed for Me
            flow.SyncOwner(Other);
            Assert.AreEqual(IncomingPromptAction.Show, flow.OnPoll(Other, true, Battle1));
        }

        [Test]
        public void SignOut_ClosesThePrompt_AndStopsPolling()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            Assert.AreEqual(IncomingPromptAction.Close, flow.SyncOwner(null));
            Assert.IsFalse(flow.ShouldPoll);
        }

        [Test]
        public void SameAccountUpdate_KeepsThePrompt()
        {
            var flow = SignedIn();
            flow.OnPoll(Me, true, Battle1);
            Assert.AreEqual(IncomingPromptAction.None, flow.SyncOwner(Me));
            Assert.AreEqual(Battle1, flow.ShownBattleId);
        }

        [Test]
        public void OnlyTheShownChallenge_CanBeAnswered()
        {
            var flow = SignedIn();
            Assert.IsFalse(flow.TryBeginAnswer(Battle1)); // nothing shown
            flow.OnPoll(Me, true, Battle1);
            Assert.IsFalse(flow.TryBeginAnswer(Battle2));
            Assert.IsFalse(flow.TryBeginAnswer(null));
        }
    }
}
