using System.Threading.Tasks;
using Nfouz.Networking;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Core
{
    /// <summary>
    /// Boot scene hand-off promised by GameManager.Start(): checks for an
    /// existing Firebase session, refreshes the player's server state via
    /// /auth/me, and routes to MainMap, Onboarding or Login — the same
    /// routing AuthController applies after an interactive sign-in.
    /// Without a usable token (always the case in Firebase stub mode) it
    /// goes straight to Login. Lives in Boot.unity next to GameManager;
    /// runs in Start() so GameManager.Awake() has registered every service.
    /// </summary>
    public class SessionBootstrap : MonoBehaviour
    {
#if FIREBASE_AUTH_AVAILABLE
        // FirebaseManager initializes asynchronously from its own Awake();
        // give it a bounded window before falling back to the stored token.
        private const float FirebaseInitTimeoutSeconds = 10f;
#endif

        private async void Start()
        {
            var locator = ServiceLocator.Instance;
            if (locator == null ||
                !locator.TryGet<FirebaseManager>(out var firebaseManager) ||
                !locator.TryGet<ApiClient>(out var apiClient))
            {
                Debug.LogError("[SessionBootstrap] Core services missing — routing to Login.");
                await SceneLoader.LoadAsync(Constants.Scenes.Login);
                return;
            }

#if FIREBASE_AUTH_AVAILABLE
            var waited = 0f;
            while (!firebaseManager.IsInitialized && waited < FirebaseInitTimeoutSeconds)
            {
                await Task.Yield();
                waited += Time.unscaledDeltaTime;
            }
#endif

            string token = null;
            if (await firebaseManager.RefreshTokenSilently())
            {
                token = firebaseManager.CurrentToken;
            }
            else if (firebaseManager.TryLoadStoredToken(out var storedToken))
            {
                token = storedToken;
            }

            if (string.IsNullOrEmpty(token))
            {
                Debug.Log("[SessionBootstrap] No stored session — routing to Login.");
                await SceneLoader.LoadAsync(Constants.Scenes.Login);
                return;
            }

            apiClient.SetAuthToken(token);
            var meResponse = await apiClient.GetAsync<PlayerSessionData>("/auth/me");

            if (meResponse.success)
            {
                PlayerSession.UpdateFromServer(meResponse.data);
                await SceneLoader.LoadAsync(Constants.Scenes.MainMap);
                return;
            }

            if (meResponse.error != null && meResponse.error.code == Constants.ErrorCodes.PlayerNotFound)
            {
                // Signed in, but onboarding was never finished.
                await SceneLoader.LoadAsync(Constants.Scenes.Onboarding);
                return;
            }

            // Expired/invalid token or server unreachable: sign in again.
            Debug.LogWarning($"[SessionBootstrap] Session restore failed ({meResponse.error?.code}) — routing to Login.");
            apiClient.SetAuthToken(null);
            await SceneLoader.LoadAsync(Constants.Scenes.Login);
        }
    }
}
