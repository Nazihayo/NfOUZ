using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Nfouz.Networking;
using Nfouz.Utils;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// Expired Firebase ID tokens: ApiClient's AuthSession refreshes once,
    /// retries once, shares one refresh between simultaneous failures, and
    /// ends the session (once) only when it cannot be recovered. Every test
    /// also checks that no token reached a log line, message or reason.
    /// </summary>
    [TestFixture]
    public class AuthSessionTests
    {
        private const string OldToken = "token-OLD-1f9c";
        private const string NewToken = "token-NEW-7a2e";
        private const string OtherToken = "token-OTHER-55d0";

        private List<string> _logs;
        private List<string> _expiredReasons;
        private AuthSession _session;
        private FakeBackend _backend;
        private FakeProvider _provider;

        [SetUp]
        public void SetUp()
        {
            _logs = new List<string>();
            _expiredReasons = new List<string>();
            // Without a SynchronizationContext continuations run on pool
            // threads, so everything the fakes record is locked.
            _session = new AuthSession(message => { lock (_logs) _logs.Add(message); });
            _session.SessionExpired += reason => { lock (_expiredReasons) _expiredReasons.Add(reason); };
            _backend = new FakeBackend { ValidToken = NewToken };
            _provider = new FakeProvider();
            _session.TokenProvider = _provider;
            _session.SetToken(OldToken);
        }

        [TearDown]
        public void NoTokenEverExposed()
        {
            var texts = _logs.Concat(_expiredReasons).Concat(_backend.ResponseMessages);
            foreach (var text in texts)
            {
                foreach (var token in new[] { OldToken, NewToken, OtherToken })
                {
                    Assert.IsFalse(text != null && text.Contains(token), $"token leaked into: {text}");
                }
            }
        }

        /// <summary>Waits (bounded) for a state the test can observe, instead of a fixed sleep.</summary>
        private static async Task Until(Func<bool> condition)
        {
            for (var i = 0; i < 1000 && !condition(); i++)
            {
                await Task.Delay(2);
            }
            Assert.IsTrue(condition(), "timed out waiting for the expected state");
        }

        private static ApiRequest Request(string endpoint = "/auth/me") =>
            new ApiRequest("POST", endpoint, "{\"request_id\":\"r-1\"}");

        private Task<ApiResponse<Payload>> Send(ApiRequest request, CancellationToken ct = default) =>
            _session.ExecuteAsync<Payload>(request, _backend.SendAsync, ct);

        [Test]
        public async Task NormalRequest_UsesTheTokenOnce_WithoutRefreshing()
        {
            _session.SetToken(NewToken);

            var response = await Send(Request());

            Assert.IsTrue(response.success);
            CollectionAssert.AreEqual(new[] { NewToken }, _backend.TokensSeen);
            Assert.AreEqual(0, _provider.Calls);
        }

        [Test]
        public async Task ExpiredToken_RefreshesOnce_AndRetriesTheSameRequestOnce()
        {
            _provider.Next = TokenRefreshResult.Refreshed(NewToken);
            var request = Request("/quests/q-1/claim");

            var response = await Send(request);

            Assert.IsTrue(response.success);
            Assert.AreEqual(1, _provider.Calls);
            CollectionAssert.AreEqual(new[] { OldToken, NewToken }, _backend.TokensSeen);
            Assert.That(_backend.RequestsSeen, Has.All.SameAs(request), "retry must send the same method, endpoint and body");
            Assert.AreEqual(0, _expiredReasons.Count);
        }

        [Test]
        public async Task RefreshedToken_ReplacesTheOldOne_ForLaterRequests()
        {
            _provider.Next = TokenRefreshResult.Refreshed(NewToken);
            await Send(Request());
            _backend.TokensSeen.Clear();

            await Send(Request("/friends"));

            Assert.AreEqual(NewToken, _session.CurrentToken);
            CollectionAssert.AreEqual(new[] { NewToken }, _backend.TokensSeen);
            Assert.AreEqual(1, _provider.Calls);
        }

        [Test]
        public async Task SimultaneousRejections_ShareOneRefresh()
        {
            _provider.Gate = new TaskCompletionSource<TokenRefreshResult>();
            var calls = Enumerable.Range(0, 3).Select(i => Send(Request($"/endpoint/{i}"))).ToArray();
            await Until(() => _backend.ResponseCount == 3 && _provider.Calls == 1); // all three rejected, one refresh running

            Assert.AreEqual(1, _provider.Calls);
            _provider.Gate.SetResult(TokenRefreshResult.Refreshed(NewToken));
            var responses = await Task.WhenAll(calls);

            Assert.That(responses.Select(r => r.success), Has.All.True);
            Assert.AreEqual(1, _provider.Calls);
            Assert.AreEqual(3, _backend.TokensSeen.Count(t => t == NewToken));
        }

        [Test]
        public async Task RequestFailingAfterAnotherRefreshed_RetriesWithoutRefreshingAgain()
        {
            _provider.Next = TokenRefreshResult.Refreshed(NewToken);
            var hold = new TaskCompletionSource<bool>();
            _backend.HoldNext = hold; // the slow request was sent with the old token
            var slow = Send(Request("/slow"));

            await Send(Request("/fast")); // refreshes
            hold.SetResult(true);
            var slowResponse = await slow;

            Assert.IsTrue(slowResponse.success);
            Assert.AreEqual(1, _provider.Calls);
        }

        [Test]
        public async Task RefreshRejected_EndsTheSessionOnce_ForSimultaneousRequests()
        {
            _provider.Gate = new TaskCompletionSource<TokenRefreshResult>();
            var calls = Enumerable.Range(0, 3).Select(i => Send(Request($"/endpoint/{i}"))).ToArray();
            await Until(() => _backend.ResponseCount == 3 && _provider.Calls == 1);
            _provider.Gate.SetResult(TokenRefreshResult.Of(TokenRefreshStatus.Rejected));
            var responses = await Task.WhenAll(calls);

            CollectionAssert.AreEqual(new[] { "refresh_rejected" }, _expiredReasons);
            Assert.IsNull(_session.CurrentToken);
            Assert.That(responses.Select(r => r.error.code), Has.All.EqualTo(Constants.ErrorCodes.InvalidToken));
            Assert.AreEqual(1, _provider.Calls);
        }

        [Test]
        public async Task NoFirebaseUser_EndsTheSession()
        {
            _provider.Next = TokenRefreshResult.Of(TokenRefreshStatus.NoUser);

            var response = await Send(Request());

            Assert.AreEqual(Constants.ErrorCodes.InvalidToken, response.error.code);
            CollectionAssert.AreEqual(new[] { "no_firebase_user" }, _expiredReasons);
            Assert.IsFalse(_session.HasToken);
        }

        [Test]
        public async Task RetryRejectedToo_DoesNotRefreshAgain_AndEndsTheSession()
        {
            _backend.ValidToken = null; // the backend rejects every token
            _provider.Next = TokenRefreshResult.Refreshed(NewToken);

            var response = await Send(Request());

            Assert.AreEqual(Constants.ErrorCodes.InvalidToken, response.error.code);
            Assert.AreEqual(1, _provider.Calls);
            Assert.AreEqual(2, _backend.TokensSeen.Count);
            CollectionAssert.AreEqual(new[] { "retry_rejected" }, _expiredReasons);
        }

        [Test]
        public async Task AfterTheSessionEnded_NoFurtherRefreshOrEvent_UntilANewSignIn()
        {
            _provider.Next = TokenRefreshResult.Of(TokenRefreshStatus.Rejected);
            await Send(Request());
            await Send(Request());

            Assert.AreEqual(1, _provider.Calls);
            Assert.AreEqual(1, _expiredReasons.Count);

            _session.SetToken(NewToken);
            var response = await Send(Request());
            Assert.IsTrue(response.success);
        }

        [Test]
        public async Task NetworkError_IsNotRetried_AndDoesNotRefresh()
        {
            _backend.Script = () => new TransportResult<Payload>(0, ApiResponse<Payload>.Failure(Constants.ErrorCodes.NetworkError, "offline", true));

            var response = await Send(Request());

            Assert.AreEqual(Constants.ErrorCodes.NetworkError, response.error.code);
            Assert.AreEqual(1, _backend.TokensSeen.Count);
            Assert.AreEqual(0, _provider.Calls);
            Assert.AreEqual(0, _expiredReasons.Count);
        }

        [TestCase(403, "FORBIDDEN")]
        [TestCase(403, "INVALID_GUARD_BATTLE_TOKEN")]
        [TestCase(403, "PLAYER_BLOCKED")]
        [TestCase(401, "SOME_OTHER_CODE")]
        [TestCase(500, "INVALID_TOKEN")]
        public async Task OtherFailures_AreReturnedUnchanged_WithoutRefresh(int status, string code)
        {
            _backend.Script = () => new TransportResult<Payload>(status, ApiResponse<Payload>.Failure(code, "nope"));

            var response = await Send(Request());

            Assert.AreEqual(code, response.error.code);
            Assert.AreEqual(1, _backend.TokensSeen.Count);
            Assert.AreEqual(0, _provider.Calls);
            Assert.AreEqual(0, _expiredReasons.Count);
        }

        [Test]
        public async Task TransientRefreshFailure_KeepsTheSession_AndAnswersNetworkError()
        {
            _provider.Next = TokenRefreshResult.Of(TokenRefreshStatus.Transient);

            var response = await Send(Request());

            Assert.AreEqual(Constants.ErrorCodes.NetworkError, response.error.code);
            Assert.IsTrue(response.isTransportFailure);
            Assert.AreEqual(OldToken, _session.CurrentToken);
            Assert.AreEqual(0, _expiredReasons.Count);
        }

        [Test]
        public async Task ProviderThrowing_IsTransient_AndItsMessageIsNotLogged()
        {
            _provider.Throw = new InvalidOperationException($"refresh failed for {OldToken}");

            var response = await Send(Request());

            Assert.AreEqual(Constants.ErrorCodes.NetworkError, response.error.code);
            Assert.AreEqual(0, _expiredReasons.Count);
            Assert.That(_logs, Has.Some.Contains("InvalidOperationException"));
        }

        [Test]
        public async Task RefreshFinishingAfterTheOwnerWasCancelled_DoesNotRetry()
        {
            _provider.Gate = new TaskCompletionSource<TokenRefreshResult>();
            var cts = new CancellationTokenSource();
            var call = Send(Request(), cts.Token);
            await Until(() => _provider.Calls == 1);
            cts.Cancel(); // e.g. the scene's controller was destroyed
            _provider.Gate.SetResult(TokenRefreshResult.Refreshed(NewToken));
            var response = await call;

            Assert.AreEqual(Constants.ErrorCodes.InvalidToken, response.error.code);
            CollectionAssert.AreEqual(new[] { OldToken }, _backend.TokensSeen);
            Assert.AreEqual(NewToken, _session.CurrentToken, "the refreshed token is still kept for later requests");
        }

        [Test]
        public async Task SignInDuringARefresh_IsNotOverwrittenByTheStaleRefresh()
        {
            _provider.Gate = new TaskCompletionSource<TokenRefreshResult>();
            var call = Send(Request());
            await Until(() => _provider.Calls == 1);
            _session.SetToken(OtherToken); // a different sign-in happened meanwhile
            _provider.Gate.SetResult(TokenRefreshResult.Refreshed(NewToken));
            await call;

            Assert.AreEqual(OtherToken, _session.CurrentToken);
            CollectionAssert.AreEqual(new[] { OldToken }, _backend.TokensSeen, "the old session's request is not retried as the new user");
            Assert.AreEqual(0, _expiredReasons.Count);
        }

        [Test]
        public async Task RequestWithoutAToken_IsNotRefreshed()
        {
            _session.SetToken(null);

            var response = await Send(Request());

            Assert.AreEqual(Constants.ErrorCodes.InvalidToken, response.error.code);
            Assert.AreEqual(0, _provider.Calls);
            Assert.AreEqual(0, _expiredReasons.Count);
        }

        [Test]
        public void TokenRefreshResult_NeverPrintsItsToken()
        {
            StringAssert.DoesNotContain(NewToken, TokenRefreshResult.Refreshed(NewToken).ToString());
        }

        [TestCase("UserTokenExpired", TokenRefreshStatus.Rejected)]
        [TestCase("InvalidUserToken", TokenRefreshStatus.Rejected)]
        [TestCase("UserDisabled", TokenRefreshStatus.Rejected)]
        [TestCase("UserNotFound", TokenRefreshStatus.Rejected)]
        [TestCase("InvalidCredential", TokenRefreshStatus.Rejected)]
        [TestCase("NetworkRequestFailed", TokenRefreshStatus.Transient)]
        [TestCase("TooManyRequests", TokenRefreshStatus.Transient)]
        [TestCase("Failure", TokenRefreshStatus.Transient)]
        [TestCase(null, TokenRefreshStatus.Transient)]
        public void FirebaseRefreshErrors_EndTheSessionOnlyWhenTheSignInIsOver(string authErrorName, TokenRefreshStatus expected)
        {
            Assert.AreEqual(expected, TokenRefreshClassifier.FromAuthErrorName(authErrorName));
        }

        [Serializable]
        public class Payload
        {
            public string value;
        }

        /// <summary>Accepts only ValidToken (401 INVALID_TOKEN otherwise), like the backend's auth middleware.</summary>
        private sealed class FakeBackend
        {
            public string ValidToken;
            public Func<TransportResult<Payload>> Script;
            public TaskCompletionSource<bool> HoldNext;
            public readonly List<string> TokensSeen = new List<string>();
            public readonly List<ApiRequest> RequestsSeen = new List<ApiRequest>();
            public readonly List<string> ResponseMessages = new List<string>();

            public int ResponseCount
            {
                get { lock (TokensSeen) return ResponseMessages.Count; }
            }

            public async Task<TransportResult<Payload>> SendAsync(ApiRequest request, string token)
            {
                TaskCompletionSource<bool> hold;
                lock (TokensSeen)
                {
                    TokensSeen.Add(token);
                    RequestsSeen.Add(request);
                    hold = HoldNext;
                    HoldNext = null;
                }
                if (hold != null) await hold.Task;
                else await Task.Yield();

                TransportResult<Payload> result;
                if (Script != null) result = Script();
                else if (token != null && token == ValidToken)
                    result = new TransportResult<Payload>(200, new ApiResponse<Payload> { success = true, data = new Payload { value = "ok" } });
                else
                    result = new TransportResult<Payload>(401, ApiResponse<Payload>.Failure(Constants.ErrorCodes.InvalidToken, "Token verification failed."));
                lock (TokensSeen) ResponseMessages.Add(result.Response.error?.message);
                return result;
            }
        }

        private sealed class FakeProvider : IAuthTokenProvider
        {
            public int Calls;
            public TokenRefreshResult Next = TokenRefreshResult.Of(TokenRefreshStatus.Transient);
            public TaskCompletionSource<TokenRefreshResult> Gate;
            public Exception Throw;

            public async Task<TokenRefreshResult> RefreshTokenAsync()
            {
                Interlocked.Increment(ref Calls);
                if (Throw != null) throw Throw;
                if (Gate != null) return await Gate.Task;
                await Task.Yield();
                return Next;
            }
        }
    }
}
