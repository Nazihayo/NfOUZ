using NUnit.Framework;
using Nfouz.Auth;
using Nfouz.Utils;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// Player-facing auth errors are Arabic, never the raw (English, possibly
    /// internal) Firebase or server text, and never reveal whether an email
    /// address has an account.
    /// </summary>
    [TestFixture]
    public class AuthErrorMessagesTests
    {
        [TestCase("InvalidEmail", AuthErrorMessages.InvalidEmail)]
        [TestCase("MissingEmail", AuthErrorMessages.InvalidEmail)]
        [TestCase("EmailAlreadyInUse", AuthErrorMessages.EmailAlreadyInUse)]
        [TestCase("WeakPassword", AuthErrorMessages.WeakPassword)]
        [TestCase("UserDisabled", AuthErrorMessages.AccountDisabled)]
        [TestCase("TooManyRequests", AuthErrorMessages.TooManyRequests)]
        [TestCase("NetworkRequestFailed", AuthErrorMessages.Network)]
        public void KnownFirebaseErrors_MapToArabicMessages(string authErrorName, string expected)
        {
            Assert.AreEqual(expected, AuthErrorMessages.FromFirebaseAuthError(authErrorName, isRegistration: false));
        }

        [TestCase("WrongPassword")]
        [TestCase("UserNotFound")]
        [TestCase("InvalidCredential")]
        public void WrongPasswordAndUnknownUser_ShareOneMessage(string authErrorName)
        {
            Assert.AreEqual(AuthErrorMessages.WrongCredentials,
                AuthErrorMessages.FromFirebaseAuthError(authErrorName, isRegistration: false));
        }

        [Test]
        public void UnknownOrMissingFirebaseError_FallsBackPerFlow()
        {
            Assert.AreEqual(AuthErrorMessages.SignInFailed, AuthErrorMessages.FromFirebaseAuthError("Failure", isRegistration: false));
            Assert.AreEqual(AuthErrorMessages.SignInFailed, AuthErrorMessages.FromFirebaseAuthError(null, isRegistration: false));
            Assert.AreEqual(AuthErrorMessages.RegisterFailed, AuthErrorMessages.FromFirebaseAuthError("Failure", isRegistration: true));
            Assert.AreEqual(AuthErrorMessages.RegisterFailed, AuthErrorMessages.FromFirebaseAuthError(null, isRegistration: true));
        }

        [TestCase(Constants.ErrorCodes.NetworkError, AuthErrorMessages.Network)]
        [TestCase(Constants.ErrorCodes.InvalidToken, AuthErrorMessages.SessionExpired)]
        [TestCase(Constants.ErrorCodes.RateLimited, AuthErrorMessages.TooManyRequests)]
        [TestCase(Constants.ErrorCodes.InternalError, AuthErrorMessages.Generic)]
        [TestCase("SOMETHING_NEW", AuthErrorMessages.Generic)]
        public void ApiErrors_MapToArabicMessages(string code, string expected)
        {
            Assert.AreEqual(expected, AuthErrorMessages.FromApiError(new ApiError { code = code, message = "x" }));
        }

        [Test]
        public void ApiError_NeverPassesTheServerMessageThrough()
        {
            const string serverText = "Token verification failed.";
            var message = AuthErrorMessages.FromApiError(new ApiError { code = "UNEXPECTED", message = serverText });
            Assert.AreNotEqual(serverText, message);
            Assert.AreEqual(AuthErrorMessages.Generic, AuthErrorMessages.FromApiError(null));
        }
    }
}
