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
    }
}
