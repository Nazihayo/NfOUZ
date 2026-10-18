using Nfouz.Networking;
using Nfouz.Utils;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Nfouz.Core
{
    /// <summary>
    /// Entry point for the whole application. Lives only in the Boot scene,
    /// persists via DontDestroyOnLoad, and wires up every process-wide
    /// service before handing off to SessionBootstrap. See Unity MVP
    /// Implementation Plan v1.0, Phase 1, and Scene Architecture v1.0,
    /// section 1 (Boot Scene).
    /// </summary>
    [RequireComponent(typeof(ServiceLocator))]
    public class GameManager : MonoBehaviour
    {
        private static GameManager _instance;
        private bool _returningToLogin;

        [Header("Service Prefabs / Components")]
        [SerializeField] private ApiClient apiClientPrefab;
        [SerializeField] private FirebaseManager firebaseManagerPrefab;
        [SerializeField] private PhotonConnectionManager photonConnectionManagerPrefab;

        private void Awake()
        {
            if (_instance != null && _instance != this)
            {
                Destroy(gameObject);
                return;
            }

            _instance = this;
            DontDestroyOnLoad(gameObject);

            RegisterCoreServices();
        }

        private void RegisterCoreServices()
        {
            var locator = GetComponent<ServiceLocator>();
            if (locator == null)
            {
                Debug.LogError("[GameManager] Missing required ServiceLocator component.");
                return;
            }

            var apiClient = apiClientPrefab != null
                ? Instantiate(apiClientPrefab, transform)
                : gameObject.AddComponent<ApiClient>();
            apiClient.Configure(ApiEnvironmentSettings.ResolveBaseUrl(), Constants.Api.RequestTimeoutSeconds);
            locator.Register<ApiClient>(apiClient);

            var firebaseManager = firebaseManagerPrefab != null
                ? Instantiate(firebaseManagerPrefab, transform)
                : gameObject.AddComponent<FirebaseManager>();
            locator.Register<FirebaseManager>(firebaseManager);

            // Expired ID token -> one refresh and retry inside ApiClient; a
            // session that cannot be recovered comes back here (see AuthSession).
            apiClient.SetTokenProvider(firebaseManager);
            apiClient.SessionExpired += reason => HandleSessionExpired(firebaseManager, reason);

            // Sprint 5 — Photon Multiplayer Foundation.
            var photonConnectionManager = photonConnectionManagerPrefab != null
                ? Instantiate(photonConnectionManagerPrefab, transform)
                : gameObject.AddComponent<PhotonConnectionManager>();
            locator.Register<PhotonConnectionManager>(photonConnectionManager);

            Debug.Log("[GameManager] Core services registered.");
        }

        /// <summary>
        /// The sign-in can no longer be recovered (no Firebase user, refresh
        /// refused, or the fresh token rejected too). AuthSession raises this
        /// at most once per session. Clears the session and returns to Login
        /// once; Boot (SessionBootstrap) and Login route by themselves.
        /// </summary>
        private async void HandleSessionExpired(FirebaseManager firebaseManager, string reason)
        {
            Debug.LogWarning($"[GameManager] Session ended ({reason}); returning to Login.");
            firebaseManager.SignOut();
            PlayerSession.Clear();

            var activeScene = SceneManager.GetActiveScene().name;
            if (_returningToLogin || activeScene == Constants.Scenes.Boot || activeScene == Constants.Scenes.Login)
            {
                return;
            }

            _returningToLogin = true;
            try
            {
                await SceneLoader.LoadAsync(Constants.Scenes.Login);
            }
            finally
            {
                _returningToLogin = false;
            }
        }

        private void Start()
        {
            // SessionBootstrap (added when Phase 2 — Authentication — is implemented)
            // takes over from here: it checks for a stored token, refreshes the
            // session from the server, and routes to Login or MainMap accordingly.
            Debug.Log("[GameManager] Boot sequence ready. Awaiting SessionBootstrap.");
        }
    }
}
