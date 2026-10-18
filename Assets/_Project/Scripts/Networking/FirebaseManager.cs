using System;
using System.Threading.Tasks;
using Nfouz.Auth;
using Nfouz.Utils;
using UnityEngine;

#if FIREBASE_AUTH_AVAILABLE
using Firebase;
using Firebase.Auth;
using Firebase.Extensions;
#endif

namespace Nfouz.Networking
{
    /// <summary>
    /// Wraps the Firebase Auth SDK behind a small, testable interface.
    /// Guarded by the FIREBASE_AUTH_AVAILABLE scripting define symbol so this
    /// project compiles even before the Firebase Unity SDK package is imported
    /// (Phase 1 / Phase 2 boundary — see Unity MVP Implementation Plan v1.0).
    /// </summary>
    public class FirebaseManager : MonoBehaviour, IAuthTokenProvider
    {
        private const string StoredTokenPrefsKey = "nfouz_firebase_id_token";

        public bool IsInitialized { get; private set; }
        public string CurrentToken { get; private set; }

#if FIREBASE_AUTH_AVAILABLE
        private FirebaseAuth _auth;
#endif

        private async void Awake()
        {
            await InitializeAsync();
        }

        public async Task<bool> InitializeAsync()
        {
#if FIREBASE_AUTH_AVAILABLE
            try
            {
                var dependencyStatus = await FirebaseApp.CheckAndFixDependenciesAsync();
                if (dependencyStatus != DependencyStatus.Available)
                {
                    Debug.LogError($"[FirebaseManager] Firebase dependencies unavailable: {dependencyStatus}");
                    return false;
                }

                _auth = FirebaseAuth.DefaultInstance;
                IsInitialized = true;
                Debug.Log("[FirebaseManager] Firebase Auth initialized.");
                return true;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[FirebaseManager] Initialization failed: {ex.Message}");
                return false;
            }
#else
            Debug.LogWarning("[FirebaseManager] FIREBASE_AUTH_AVAILABLE not defined — " +
                              "running in stub mode until the Firebase SDK package is imported.");
            IsInitialized = false;
            await Task.CompletedTask;
            return false;
#endif
        }

        /// <summary>Attempts to load a previously stored token from secure device storage.
        /// See Firebase Security Package v1.0, section 8 (Session Handling).</summary>
        public bool TryLoadStoredToken(out string token)
        {
            token = PlayerPrefs.GetString(StoredTokenPrefsKey, string.Empty);
            return !string.IsNullOrEmpty(token);
        }

        /// <summary>Silently refreshes the current ID token. Returns false if no user
        /// is signed in or the refresh fails — caller should route to Login in that case.</summary>
        public async Task<bool> RefreshTokenSilently()
        {
            return (await RefreshTokenAsync()).Status == TokenRefreshStatus.Refreshed;
        }

        /// <summary>
        /// Forces a new ID token from Firebase (IAuthTokenProvider; ApiClient
        /// calls it, via AuthSession, when the backend answers 401
        /// INVALID_TOKEN). The token itself is never logged.
        /// </summary>
        public async Task<TokenRefreshResult> RefreshTokenAsync()
        {
#if FIREBASE_AUTH_AVAILABLE
            if (!IsInitialized || _auth == null)
            {
                return TokenRefreshResult.Of(TokenRefreshStatus.Transient);
            }
            if (_auth.CurrentUser == null)
            {
                return TokenRefreshResult.Of(TokenRefreshStatus.NoUser);
            }

            try
            {
                var token = await _auth.CurrentUser.TokenAsync(true);
                if (string.IsNullOrEmpty(token))
                {
                    return TokenRefreshResult.Of(TokenRefreshStatus.Transient);
                }

                CurrentToken = token;
                PlayerPrefs.SetString(StoredTokenPrefsKey, token);
                PlayerPrefs.Save();
                return TokenRefreshResult.Refreshed(token);
            }
            catch (Exception ex)
            {
                var errorName = GetAuthErrorName(ex);
                var status = TokenRefreshClassifier.FromAuthErrorName(errorName);
                Debug.LogWarning($"[FirebaseManager] Token refresh failed ({errorName ?? ex.GetType().Name}): {status}.");
                return TokenRefreshResult.Of(status);
            }
#else
            await Task.CompletedTask;
            // Stub mode: no Firebase SDK, so no user can be signed in.
            return TokenRefreshResult.Of(TokenRefreshStatus.NoUser);
#endif
        }

        public async Task<(bool success, string errorMessage)> SignInWithEmail(string email, string password)
        {
#if FIREBASE_AUTH_AVAILABLE
            if (!IsInitialized || _auth == null)
            {
                return (false, AuthErrorMessages.NotReady);
            }

            try
            {
                var result = await _auth.SignInWithEmailAndPasswordAsync(email, password);
                CurrentToken = await result.User.TokenAsync(false);
                PlayerPrefs.SetString(StoredTokenPrefsKey, CurrentToken);
                PlayerPrefs.Save();
                return (true, null);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[FirebaseManager] Sign-in failed ({GetAuthErrorName(ex) ?? "no AuthError"}): {ex}");
                return (false, AuthErrorMessages.FromFirebaseAuthError(GetAuthErrorName(ex), isRegistration: false));
            }
#else
            await Task.CompletedTask;
            Debug.LogWarning("[FirebaseManager] Firebase SDK not available in this build.");
            return (false, AuthErrorMessages.ServiceUnavailable);
#endif
        }

        public async Task<(bool success, string errorMessage)> RegisterWithEmail(string email, string password)
        {
#if FIREBASE_AUTH_AVAILABLE
            if (!IsInitialized || _auth == null)
            {
                return (false, AuthErrorMessages.NotReady);
            }

            try
            {
                var result = await _auth.CreateUserWithEmailAndPasswordAsync(email, password);
                CurrentToken = await result.User.TokenAsync(false);
                PlayerPrefs.SetString(StoredTokenPrefsKey, CurrentToken);
                PlayerPrefs.Save();
                return (true, null);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[FirebaseManager] Registration failed ({GetAuthErrorName(ex) ?? "no AuthError"}): {ex}");
                return (false, AuthErrorMessages.FromFirebaseAuthError(GetAuthErrorName(ex), isRegistration: true));
            }
#else
            await Task.CompletedTask;
            Debug.LogWarning("[FirebaseManager] Firebase SDK not available in this build.");
            return (false, AuthErrorMessages.ServiceUnavailable);
#endif
        }

#if FIREBASE_AUTH_AVAILABLE
        /// <summary>Firebase.Auth.AuthError name of a failed auth call
        /// (e.g. "WrongPassword"), or null if the exception carries none.
        /// Awaited Firebase tasks can surface the FirebaseException directly
        /// or wrapped in an AggregateException.</summary>
        private static string GetAuthErrorName(Exception ex)
        {
            var current = ex;
            while (current != null)
            {
                if (current is FirebaseException firebaseException)
                {
                    return ((AuthError)firebaseException.ErrorCode).ToString();
                }

                current = current is AggregateException aggregate && aggregate.InnerExceptions.Count > 0
                    ? aggregate.InnerExceptions[0]
                    : current.InnerException;
            }

            return null;
        }
#endif

        public void SignOut()
        {
#if FIREBASE_AUTH_AVAILABLE
            _auth?.SignOut();
#endif
            CurrentToken = null;
            PlayerPrefs.DeleteKey(StoredTokenPrefsKey);
            PlayerPrefs.Save();
        }
    }
}
