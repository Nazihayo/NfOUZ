using Nfouz.Networking;
using Nfouz.Utils;
using UnityEngine;

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
            apiClient.Configure(Constants.Api.BaseUrl, Constants.Api.RequestTimeoutSeconds);
            locator.Register<ApiClient>(apiClient);

            var firebaseManager = firebaseManagerPrefab != null
                ? Instantiate(firebaseManagerPrefab, transform)
                : gameObject.AddComponent<FirebaseManager>();
            locator.Register<FirebaseManager>(firebaseManager);

            // Sprint 5 — Photon Multiplayer Foundation.
            var photonConnectionManager = photonConnectionManagerPrefab != null
                ? Instantiate(photonConnectionManagerPrefab, transform)
                : gameObject.AddComponent<PhotonConnectionManager>();
            locator.Register<PhotonConnectionManager>(photonConnectionManager);

            Debug.Log("[GameManager] Core services registered.");
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
