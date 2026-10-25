using NUnit.Framework;
using Nfouz.Auth;
using Nfouz.Map;
using Nfouz.Utils;

namespace Nfouz.Tests.EditMode
{
    /// <summary>Answering a challenge shows an Arabic reason, never the
    /// server's own text; only a refusal that may not have reached the
    /// server lets the challenge be offered again.</summary>
    [TestFixture]
    public class IncomingChallengeMessagesTests
    {
        [TestCase("SESSION_EXPIRED", IncomingChallengeMessages.Expired)]
        [TestCase("BATTLE_NOT_FOUND", IncomingChallengeMessages.Expired)]
        [TestCase("CHALLENGE_ALREADY_ANSWERED", IncomingChallengeMessages.AlreadyAnswered)]
        [TestCase("NOT_CHALLENGE_DEFENDER", IncomingChallengeMessages.NotYours)]
        [TestCase("FORBIDDEN", IncomingChallengeMessages.NotYours)]
        [TestCase("PLAYER_MOVING_TOO_FAST", SafetyMessages.AcceptWhileDriving)]
        [TestCase("NETWORK_ERROR", AuthErrorMessages.Network)]
        [TestCase("RATE_LIMITED", AuthErrorMessages.TooManyRequests)]
        [TestCase("INVALID_TOKEN", AuthErrorMessages.SessionExpired)]
        public void ServerCode_MapsToArabicMessage(string code, string expected)
        {
            Assert.AreEqual(expected, IncomingChallengeMessages.FromAnswerError(new ApiError { code = code, message = "server text" }));
        }

        [TestCase("SESSION_EXPIRED", false)]
        [TestCase("BATTLE_NOT_FOUND", false)]
        [TestCase("CHALLENGE_ALREADY_ANSWERED", false)]
        [TestCase("NOT_CHALLENGE_DEFENDER", false)]
        [TestCase("FORBIDDEN", false)]
        [TestCase("NETWORK_ERROR", true)]
        [TestCase("RATE_LIMITED", true)]
        [TestCase("INTERNAL_ERROR", true)]
        public void OnlyTransientFailures_AreRetryable(string code, bool expected)
        {
            Assert.AreEqual(expected, IncomingChallengeMessages.IsRetryable(new ApiError { code = code }));
        }

        [Test]
        public void ErrorCodes_MatchTheBackend()
        {
            Assert.AreEqual("CHALLENGE_ALREADY_ANSWERED", Constants.ErrorCodes.ChallengeAlreadyAnswered);
            Assert.AreEqual("NOT_CHALLENGE_DEFENDER", Constants.ErrorCodes.NotChallengeDefender);
            Assert.AreEqual("CHALLENGE_NOT_ACCEPTED", Constants.ErrorCodes.ChallengeNotAccepted);
        }

        [Test]
        public void PromptBody_ShowsOnlyTheAttackersPublicDetails()
        {
            var body = IncomingChallengeMessages.PromptBody("alpha_one", "Scout", "Citizen");
            Assert.IsTrue(body.Contains("alpha_one"));
            Assert.IsTrue(body.Contains("Scout"));
            Assert.IsTrue(body.Contains("Citizen"));
        }

        [Test]
        public void PromptBody_WithoutAUsername_StillReadsAsArabic()
        {
            var body = IncomingChallengeMessages.PromptBody(null, null, null);
            Assert.AreEqual("يتحداك لاعب في معركة.", body);
        }
    }
}
