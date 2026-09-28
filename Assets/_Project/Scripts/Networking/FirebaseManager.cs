using System;
using System.Threading.Tasks;
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
    public class FirebaseManager : MonoBehaviour
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
#if FIREBASE_AUTH_AVAILABLE
            if (_auth?.CurrentUser == null)
            {
                return false;
            }

            try
            {
                CurrentToken = await _auth.CurrentUser.TokenAsync(true);
                PlayerPrefs.SetString(StoredTokenPrefsKey, CurrentToken);
                PlayerPrefs.Save();
                return !string.IsNullOrEmpty(CurrentToken);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[FirebaseManager] Silent token refresh failed: {ex.Message}");
                return false;
            }
#else
            await Task.CompletedTask;
            return false;
#endif
        }

        public async Task<(bool success, string errorMessage)> SignInWithEmail(string email, string password)
        {
#if FIREBASE_AUTH_AVAILABLE
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
                Debug.LogWarning($"[FirebaseManager] Sign-in failed: {ex.Message}");
                return (false, ex.Message);
            }
#else
            await Task.CompletedTask;
            return (false, "Firebase SDK not available in this build.");
#endif
        }

        public async Task<(bool success, string errorMessage)> RegisterWithEmail(string email, string password)
        {
#if FIREBASE_AUTH_AVAILABLE
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
                Debug.LogWarning($"[FirebaseManager] Registration failed: {ex.Message}");
                return (false, ex.Message);
            }
#else
            await Task.CompletedTask;
            return (false, "Firebase SDK not available in this build.");
#endif
        }

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
