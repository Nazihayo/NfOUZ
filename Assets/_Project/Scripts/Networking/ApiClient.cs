using System;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Nfouz.Utils;
using UnityEngine;
using UnityEngine.Networking;

namespace Nfouz.Networking
{
    /// <summary>
    /// Single HTTP client for all REST API calls (see REST API Specification v1.0).
    /// Registered once in ServiceLocator by GameManager; every controller
    /// resolves it via ServiceLocator.Instance.Get&lt;ApiClient&gt;() rather than
    /// creating its own UnityWebRequest instances.
    /// </summary>
    public class ApiClient : MonoBehaviour
    {
        private string _baseUrl;
        private int _timeoutSeconds;
        private readonly AuthSession _session = new AuthSession(message => Debug.Log(message));

        public void Configure(string baseUrl, int timeoutSeconds)
        {
            _baseUrl = baseUrl.TrimEnd('/');
            _timeoutSeconds = timeoutSeconds;
        }

        /// <summary>Sets the Firebase ID token attached as Authorization: Bearer &lt;token&gt;
        /// on every subsequent request. Call again after each token refresh.</summary>
        /// <summary>Starts (token) or ends (null) the authenticated session.</summary>
        public void SetAuthToken(string token)
        {
            _session.SetToken(token);
        }

        /// <summary>Where fresh ID tokens come from when the backend answers
        /// 401 INVALID_TOKEN (FirebaseManager; wired by GameManager).</summary>
        public void SetTokenProvider(IAuthTokenProvider provider)
        {
            _session.TokenProvider = provider;
        }

        /// <summary>Raised once when the session can no longer be recovered
        /// (see AuthSession for the rules); the argument is a safe reason code.</summary>
        public event Action<string> SessionExpired
        {
            add => _session.SessionExpired += value;
            remove => _session.SessionExpired -= value;
        }

        public Task<ApiResponse<T>> GetAsync<T>(string endpoint, CancellationToken cancellationToken = default)
        {
            return SendAsync<T>(UnityWebRequest.kHttpVerbGET, endpoint, null, cancellationToken);
        }

        public Task<ApiResponse<T>> PostAsync<T>(string endpoint, object payload, CancellationToken cancellationToken = default)
        {
            return SendAsync<T>(UnityWebRequest.kHttpVerbPOST, endpoint, payload, cancellationToken);
        }

        /// <summary>Sprint 8 — DELETE /friends/:playerId (remove friend). Added
        /// alongside GET/POST/PATCH rather than assuming callers reuse PostAsync
        /// with a non-standard verb.</summary>
        public Task<ApiResponse<T>> DeleteAsync<T>(string endpoint, CancellationToken cancellationToken = default)
        {
            return SendAsync<T>(UnityWebRequest.kHttpVerbDELETE, endpoint, null, cancellationToken);
        }

        public Task<ApiResponse<T>> PatchAsync<T>(string endpoint, object payload, CancellationToken cancellationToken = default)
        {
            return SendAsync<T>("PATCH", endpoint, payload, cancellationToken);
        }

        /// <summary>
        /// Sprint 8 correction (final pass) — every call site takes an
        /// optional CancellationToken so a controller leaving its scene
        /// (SOSManager, RescueMissionController, etc. — see their own
        /// OnDestroy/OnDisable) can abort an in-flight request instead of
        /// awaiting a response no one is left to handle. Cancellation
        /// aborts the underlying UnityWebRequest and returns a
        /// NetworkError failure rather than throwing, since ApiClient's
        /// contract is "always resolves to an ApiResponse" — callers that
        /// want to distinguish "cancelled" from "genuinely failed" should
        /// check `cancellationToken.IsCancellationRequested` themselves
        /// after the await, exactly as they would with any cooperative
        /// cancellation.
        /// </summary>
        private Task<ApiResponse<T>> SendAsync<T>(string method, string endpoint, object payload, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrEmpty(_baseUrl))
            {
                Debug.LogError("[ApiClient] Configure() was never called — missing base URL.");
                return Task.FromResult(ApiResponse<T>.Failure(Constants.ErrorCodes.NetworkError, "API client not configured.", true));
            }

            // Serialized once: a retry after a token refresh sends exactly this.
            var apiRequest = new ApiRequest(method, endpoint, payload != null ? JsonUtility.ToJson(payload) : null);
            return _session.ExecuteAsync<T>(apiRequest, (req, token) => SendOnceAsync<T>(req, token, cancellationToken), cancellationToken);
        }

        /// <summary>One HTTP attempt with the given token. Never logs the token.</summary>
        private async Task<TransportResult<T>> SendOnceAsync<T>(ApiRequest apiRequest, string authToken, CancellationToken cancellationToken)
        {
            var method = apiRequest.Method;
            var endpoint = apiRequest.Endpoint;
            var url = $"{_baseUrl}{endpoint}";

            using var request = new UnityWebRequest(url, method);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.timeout = _timeoutSeconds;

            if (apiRequest.Body != null)
            {
                var bodyRaw = Encoding.UTF8.GetBytes(apiRequest.Body);
                request.uploadHandler = new UploadHandlerRaw(bodyRaw);
            }

            request.SetRequestHeader("Content-Type", "application/json");
            if (!string.IsNullOrEmpty(authToken))
            {
                request.SetRequestHeader("Authorization", $"Bearer {authToken}");
            }

            try
            {
                var operation = request.SendWebRequest();
                while (!operation.isDone)
                {
                    if (cancellationToken.IsCancellationRequested)
                    {
                        request.Abort();
                        return Transport(ApiResponse<T>.Failure(Constants.ErrorCodes.NetworkError, "Request cancelled.", true));
                    }
                    await Task.Yield();
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"[ApiClient] Transport exception calling {method} {endpoint}: {ex.GetType().Name}");
                return Transport(ApiResponse<T>.Failure(Constants.ErrorCodes.NetworkError, "Transport failure.", true));
            }

            if (cancellationToken.IsCancellationRequested)
            {
                return Transport(ApiResponse<T>.Failure(Constants.ErrorCodes.NetworkError, "Request cancelled.", true));
            }

            if (request.result == UnityWebRequest.Result.ConnectionError ||
                request.result == UnityWebRequest.Result.DataProcessingError)
            {
                Debug.LogWarning($"[ApiClient] Connection error calling {method} {endpoint}: {request.error}");
                return Transport(ApiResponse<T>.Failure(Constants.ErrorCodes.NetworkError, request.error, true));
            }

            var status = request.responseCode;

            var responseText = request.downloadHandler.text;

            if (request.result == UnityWebRequest.Result.ProtocolError)
            {
                // Server responded with a non-2xx status — the body should still be
                // a valid envelope with a populated `error` field per the API spec.
                var parsedError = TryParseEnvelope<T>(responseText);
                if (parsedError != null)
                {
                    return new TransportResult<T>(status, parsedError);
                }

                return new TransportResult<T>(status, ApiResponse<T>.Failure(
                    Constants.ErrorCodes.InternalError,
                    $"HTTP {status} with unparseable body."));
            }

            var parsed = TryParseEnvelope<T>(responseText);
            if (parsed != null)
            {
                return new TransportResult<T>(status, parsed);
            }

            // Only the length: a body can carry secrets (e.g. host_authority_secret).
            Debug.LogError($"[ApiClient] Failed to parse response body for {method} {endpoint} ({responseText?.Length ?? 0} chars).");
            return new TransportResult<T>(status, ApiResponse<T>.Failure(Constants.ErrorCodes.InternalError, "Failed to parse server response."));
        }

        private static TransportResult<T> Transport<T>(ApiResponse<T> failure) => new TransportResult<T>(0, failure);

        private static ApiResponse<T> TryParseEnvelope<T>(string json)
        {
            if (string.IsNullOrEmpty(json))
            {
                return null;
            }

            try
            {
                return JsonUtility.FromJson<ApiResponse<T>>(json);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[ApiClient] JSON parse exception: {ex.Message}");
                return null;
            }
        }
    }
}
