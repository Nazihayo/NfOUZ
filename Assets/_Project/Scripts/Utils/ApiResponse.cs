using System;

namespace Nfouz.Utils
{
    /// <summary>
    /// Mirrors the standard backend response envelope { success, data, error }
    /// documented in REST API Specification v1.0, section 1.
    /// </summary>
    /// <typeparam name="T">Shape of the `data` payload for a given endpoint.</typeparam>
    [Serializable]
    public class ApiResponse<T>
    {
        public bool success;
        public T data;
        public ApiError error;

        /// <summary>True when the call failed before a server response was even received
        /// (timeout, no connectivity, deserialization failure) — not just a logical API error.</summary>
        public bool isTransportFailure;

        public static ApiResponse<T> Failure(string code, string message, bool transportFailure = false)
        {
            return new ApiResponse<T>
            {
                success = false,
                data = default,
                error = new ApiError { code = code, message = message },
                isTransportFailure = transportFailure,
            };
        }
    }

    [Serializable]
    public class ApiError
    {
        public string code;
        public string message;
    }
}
