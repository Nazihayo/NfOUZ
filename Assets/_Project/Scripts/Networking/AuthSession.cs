using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Nfouz.Utils;

namespace Nfouz.Networking
{
    /// <summary>Outcome of asking Firebase for a fresh ID token.</summary>
    public enum TokenRefreshStatus
    {
        /// <summary>A new ID token was issued.</summary>
        Refreshed,
        /// <summary>No Firebase user is signed in on this device.</summary>
        NoUser,
        /// <summary>Firebase refused: the user's sign-in is no longer valid
        /// (revoked, disabled, deleted, credential no longer accepted).</summary>
        Rejected,
        /// <summary>Could not ask right now (offline, throttled, not
        /// initialized, unknown error). The sign-in itself may still be valid.</summary>
        Transient,
    }

    public readonly struct TokenRefreshResult
    {
        public readonly TokenRefreshStatus Status;
        public readonly string Token;

        private TokenRefreshResult(TokenRefreshStatus status, string token)
        {
            Status = status;
            Token = token;
        }

        public static TokenRefreshResult Refreshed(string token) => new TokenRefreshResult(TokenRefreshStatus.Refreshed, token);
        public static TokenRefreshResult Of(TokenRefreshStatus status) => new TokenRefreshResult(status, null);

        /// <summary>Never includes the token.</summary>
        public override string ToString() => Status.ToString();
    }

    /// <summary>Source of fresh ID tokens (FirebaseManager in the game).</summary>
    public interface IAuthTokenProvider
    {
        /// <summary>Forces a new ID token from Firebase.</summary>
        Task<TokenRefreshResult> RefreshTokenAsync();
    }

    /// <summary>
    /// Maps a failed Firebase token refresh, given by its
    /// Firebase.Auth.AuthError name, to what the session should do.
    /// Only errors that mean "this sign-in is over" end the session; anything
    /// else (network, throttling, unknown) is transient, so a flaky
    /// connection never logs the player out.
    /// </summary>
    public static class TokenRefreshClassifier
    {
        private static readonly HashSet<string> SignInOver = new HashSet<string>
        {
            "UserTokenExpired", "InvalidUserToken", "UserDisabled", "UserNotFound", "InvalidCredential",
        };

        public static TokenRefreshStatus FromAuthErrorName(string authErrorName)
        {
            return authErrorName != null && SignInOver.Contains(authErrorName)
                ? TokenRefreshStatus.Rejected
                : TokenRefreshStatus.Transient;
        }
    }

    /// <summary>One API request, built once so a retry sends exactly the same method, endpoint and body.</summary>
    public sealed class ApiRequest
    {
        public string Method { get; }
        public string Endpoint { get; }
        /// <summary>JSON body, or null for none.</summary>
        public string Body { get; }

        public ApiRequest(string method, string endpoint, string body)
        {
            Method = method;
            Endpoint = endpoint;
            Body = body;
        }
    }

    /// <summary>What one HTTP attempt produced: the status code (0 for a
    /// transport failure) and the parsed envelope.</summary>
    public readonly struct TransportResult<T>
    {
        public readonly long StatusCode;
        public readonly ApiResponse<T> Response;

        public TransportResult(long statusCode, ApiResponse<T> response)
        {
            StatusCode = statusCode;
            Response = response;
        }
    }

    /// <summary>
    /// Holds the Firebase ID token ApiClient sends, and recovers from an
    /// expired token. Unity-free so its rules are tested directly
    /// (AuthSessionTests). Rules:
    ///   - Only HTTP 401 with error code INVALID_TOKEN (the backend's auth
    ///     middleware; it does not tell expired from invalid) triggers a
    ///     refresh. Transport failures (NETWORK_ERROR, status 0), 403s and
    ///     every other error are returned unchanged.
    ///   - Then one forced refresh and at most one retry of the same request
    ///     with the new token. A second INVALID_TOKEN ends the session; it
    ///     never refreshes again for that request.
    ///   - Requests failing together share one refresh. A request whose
    ///     token was already replaced retries with the new token directly.
    ///   - The session ends (token cleared, SessionExpired raised once) when
    ///     Firebase has no user, refuses the refresh, or the backend rejects
    ///     the fresh token. A transient refresh failure keeps the session and
    ///     answers NETWORK_ERROR.
    ///   - A request sent without a token, or belonging to a session that was
    ///     replaced or ended meanwhile, is never refreshed or retried.
    ///   - No token is ever logged or put into a message.
    /// </summary>
    public sealed class AuthSession
    {
        private readonly object _gate = new object();
        private readonly Action<string> _log;
        private string _token;
        private int _generation;
        private bool _expired;
        private TaskCompletionSource<TokenRefreshResult> _refresh;

        public AuthSession(Action<string> log = null)
        {
            _log = log ?? (_ => { });
        }

        public IAuthTokenProvider TokenProvider { get; set; }

        /// <summary>Raised once per session when it can no longer be recovered; the argument is a safe reason code.</summary>
        public event Action<string> SessionExpired;

        public bool HasToken
        {
            get { lock (_gate) return !string.IsNullOrEmpty(_token); }
        }

        /// <summary>The token sent with requests (for SessionBootstrap/tests; never log it).</summary>
        public string CurrentToken
        {
            get { lock (_gate) return _token; }
        }

        /// <summary>Starts a new session with this token (sign-in, restored
        /// session) or ends it (null). A refresh still running for the old
        /// session can no longer change the token.</summary>
        public void SetToken(string token)
        {
            lock (_gate)
            {
                _token = string.IsNullOrEmpty(token) ? null : token;
                _generation++;
                _expired = false;
                _refresh = null;
            }
        }

        public static bool IsTokenRejection<T>(long statusCode, ApiResponse<T> response)
        {
            return statusCode == 401 && response?.error?.code == Constants.ErrorCodes.InvalidToken;
        }

        public async Task<ApiResponse<T>> ExecuteAsync<T>(
            ApiRequest request,
            Func<ApiRequest, string, Task<TransportResult<T>>> transport,
            CancellationToken cancellationToken = default)
        {
            string token;
            int generation;
            lock (_gate)
            {
                token = _token;
                generation = _generation;
            }

            var first = await transport(request, token);
            if (!IsTokenRejection(first.StatusCode, first.Response))
            {
                return first.Response;
            }

            var where = $"{request.Method} {request.Endpoint}";
            if (string.IsNullOrEmpty(token) || cancellationToken.IsCancellationRequested || IsOver(generation))
            {
                _log($"[AuthSession] {where}: INVALID_TOKEN, not retried (no token, cancelled or session over).");
                return first.Response;
            }

            var refreshed = await RefreshOnceAsync(token, generation);
            switch (refreshed.Status)
            {
                case TokenRefreshStatus.Refreshed:
                    if (cancellationToken.IsCancellationRequested || IsOver(generation))
                    {
                        return first.Response;
                    }

                    var second = await transport(request, refreshed.Token);
                    if (IsTokenRejection(second.StatusCode, second.Response))
                    {
                        _log($"[AuthSession] {where}: INVALID_TOKEN again after refresh.");
                        EndSession(generation, "retry_rejected");
                    }
                    return second.Response;

                case TokenRefreshStatus.Transient:
                    _log($"[AuthSession] {where}: token refresh unavailable right now; session kept.");
                    return ApiResponse<T>.Failure(Constants.ErrorCodes.NetworkError, "Could not refresh the sign-in.", true);

                default:
                    // NoUser / Rejected: the session was ended by the refresh.
                    return first.Response;
            }
        }

        private bool IsOver(int generation)
        {
            lock (_gate) return generation != _generation || _expired;
        }

        /// <summary>One refresh shared by every request that failed with
        /// `staleToken`; a request whose token was already replaced reuses
        /// the current one.</summary>
        private Task<TokenRefreshResult> RefreshOnceAsync(string staleToken, int generation)
        {
            TaskCompletionSource<TokenRefreshResult> owned = null;
            Task<TokenRefreshResult> shared;
            lock (_gate)
            {
                if (generation != _generation || _expired)
                {
                    return Task.FromResult(TokenRefreshResult.Of(TokenRefreshStatus.NoUser));
                }
                if (!string.IsNullOrEmpty(_token) && _token != staleToken)
                {
                    return Task.FromResult(TokenRefreshResult.Refreshed(_token));
                }
                if (_refresh == null)
                {
                    owned = new TaskCompletionSource<TokenRefreshResult>(TaskCreationOptions.RunContinuationsAsynchronously);
                    _refresh = owned;
                }
                shared = _refresh.Task;
            }

            if (owned != null)
            {
                _ = RunRefreshAsync(owned, generation);
            }
            return shared;
        }

        private async Task RunRefreshAsync(TaskCompletionSource<TokenRefreshResult> completion, int generation)
        {
            TokenRefreshResult result;
            try
            {
                var provider = TokenProvider;
                result = provider == null
                    ? TokenRefreshResult.Of(TokenRefreshStatus.NoUser)
                    : await provider.RefreshTokenAsync();
                if (result.Status == TokenRefreshStatus.Refreshed && string.IsNullOrEmpty(result.Token))
                {
                    result = TokenRefreshResult.Of(TokenRefreshStatus.Transient);
                }
            }
            catch (Exception ex)
            {
                // The exception text is not logged: it could echo request data.
                _log($"[AuthSession] token refresh threw {ex.GetType().Name}; treated as transient.");
                result = TokenRefreshResult.Of(TokenRefreshStatus.Transient);
            }

            var current = false;
            lock (_gate)
            {
                if (_refresh == completion)
                {
                    _refresh = null;
                }
                if (generation == _generation && !_expired)
                {
                    current = true;
                    if (result.Status == TokenRefreshStatus.Refreshed)
                    {
                        _token = result.Token;
                    }
                }
            }

            if (!current)
            {
                // Signed out or signed in again meanwhile: this result is stale.
                result = TokenRefreshResult.Of(TokenRefreshStatus.NoUser);
            }
            else if (result.Status == TokenRefreshStatus.NoUser || result.Status == TokenRefreshStatus.Rejected)
            {
                EndSession(generation, result.Status == TokenRefreshStatus.NoUser ? "no_firebase_user" : "refresh_rejected");
            }
            else
            {
                _log($"[AuthSession] token refresh: {result.Status}.");
            }

            completion.SetResult(result);
        }

        private void EndSession(int generation, string reason)
        {
            lock (_gate)
            {
                if (generation != _generation || _expired)
                {
                    return;
                }
                _expired = true;
                _token = null;
                _refresh = null;
            }

            _log($"[AuthSession] session ended: {reason}.");
            SessionExpired?.Invoke(reason);
        }
    }
}
