using NUnit.Framework;
using Nfouz.Auth;
using Nfouz.Map;
using Nfouz.Utils;

namespace Nfouz.Tests.EditMode
{
    /// <summary>A refused challenge shows an Arabic reason, never the
    /// server's own text.</summary>
    [TestFixture]
    public class ChallengeErrorMessagesTests
    {
        [TestCase("DUPLICATE_CHALLENGE", ChallengeErrorMessages.Busy)]
        [TestCase("TARGET_OUT_OF_RANGE", ChallengeErrorMessages.OutOfRange)]
        [TestCase("PLAYER_IS_CONTROLLED", ChallengeErrorMessages.Controlled)]
        [TestCase("PLAYER_IS_PROTECTED", ChallengeErrorMessages.Protected)]
        [TestCase("INVALID_CHALLENGE", ChallengeErrorMessages.NotAvailable)]
        [TestCase("PLAYER_NOT_FOUND", ChallengeErrorMessages.NotAvailable)]
        [TestCase("NETWORK_ERROR", AuthErrorMessages.Network)]
        [TestCase("RATE_LIMITED", AuthErrorMessages.TooManyRequests)]
        [TestCase("INVALID_TOKEN", AuthErrorMessages.SessionExpired)]
        [TestCase("INTERNAL_ERROR", AuthErrorMessages.Generic)]
        public void ServerCode_MapsToArabicMessage(string code, string expected)
        {
            Assert.AreEqual(expected, ChallengeErrorMessages.FromApiError(new ApiError { code = code, message = "server text" }));
        }

        [Test]
        public void MissingError_IsTheGenericMessage()
        {
            Assert.AreEqual(AuthErrorMessages.Generic, ChallengeErrorMessages.FromApiError(null));
        }
    }
}
