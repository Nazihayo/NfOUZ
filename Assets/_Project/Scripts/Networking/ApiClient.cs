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
        private string _authToken;

        public void Configure(string baseUrl, int timeoutSeconds)
        {
            _baseUrl = baseUrl.TrimEnd('/');
            _timeoutSeconds = timeoutSeconds;
        }

        /// <summary>Sets the Firebase ID token attached as Authorization: Bearer &lt;token&gt;
        /// on every subsequent request. Call again after each token refresh.</summary>
        public void SetAuthToken(string token)
        {
            _authToken = token;
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
        private async Task<ApiResponse<T>> SendAsync<T>(string method, string endpoint, object payload, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrEmpty(_baseUrl))
            {
                Debug.LogError("[ApiClient] Configure() was never called — missing base URL.");
                return ApiResponse<T>.Failure(Constants.ErrorCodes.NetworkError, "API client not configured.", true);
            }

            var url = $"{_baseUrl}{endpoint}";

            using var request = new UnityWebRequest(url, method);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.timeout = _timeoutSeconds;

            if (payload != null)
            {
                var json = JsonUtility.ToJson(payload);
                var bodyRaw = Encoding.UTF8.GetBytes(json);
                request.uploadHandler = new UploadHandlerRaw(bodyRaw);
            }

            request.SetRequestHeader("Content-Type", "application/json");
            if (!string.IsNullOrEmpty(_authToken))
            {
                request.SetRequestHeader("Authorization", $"Bearer {_authToken}");
            }

            try
            {
                var operation = request.SendWebRequest();
                while (!operation.isDone)
                {
                    if (cancellationToken.IsCancellationRequested)
                    {
                        request.Abort();
                        return ApiResponse<T>.Failure(Constants.ErrorCodes.NetworkError, "Request cancelled.", true);
                    }
                    await Task.Yield();
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"[ApiClient] Transport exception calling {method} {endpoint}: {ex.Message}");
                return ApiResponse<T>.Failure(Constants.ErrorCodes.NetworkError, ex.Message, true);
            }

            if (cancellationToken.IsCancellationRequested)
            {
                return ApiResponse<T>.Failure(Constants.ErrorCodes.NetworkError, "Request cancelled.", true);
            }

            if (request.result == UnityWebRequest.Result.ConnectionError ||
                request.result == UnityWebRequest.Result.DataProcessingError)
            {
                Debug.LogWarning($"[ApiClient] Connection error calling {method} {endpoint}: {request.error}");
                return ApiResponse<T>.Failure(Constants.ErrorCodes.NetworkError, request.error, true);
            }

            var responseText = request.downloadHandler.text;

            if (request.result == UnityWebRequest.Result.ProtocolError)
            {
                // Server responded with a non-2xx status — the body should still be
                // a valid envelope with a populated `error` field per the API spec.
                var parsedError = TryParseEnvelope<T>(responseText);
                if (parsedError != null)
                {
                    return parsedError;
                }

                return ApiResponse<T>.Failure(
                    Constants.ErrorCodes.InternalError,
                    $"HTTP {request.responseCode} with unparseable body.");
            }

            var parsed = TryParseEnvelope<T>(responseText);
            if (parsed != null)
            {
                return parsed;
            }

            Debug.LogError($"[ApiClient] Failed to parse response body for {method} {endpoint}: {responseText}");
            return ApiResponse<T>.Failure(Constants.ErrorCodes.InternalError, "Failed to parse server response.");
        }

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
