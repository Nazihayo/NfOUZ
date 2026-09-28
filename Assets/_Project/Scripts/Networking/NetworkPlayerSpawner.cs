using System.Collections.Generic;
using Nfouz.Core;
using UnityEngine;

#if PHOTON_FUSION_AVAILABLE
using Fusion;
#endif

namespace Nfouz.Networking
{
    /// <summary>
    /// Spawns and despawns NetworkPlayerController instances for both
    /// battle participants once the Photon room is joined. Sprint 5 scope:
    /// spawn/despawn + initial attribute seeding only — no combat.
    /// See BattleLoadingController for when this is invoked in the scene
    /// entry flow. Scene-local (lives only in Battle.unity) — unlike
    /// PhotonConnectionManager it is NOT DontDestroyOnLoad and is not
    /// registered in ServiceLocator, but it still guards against a second
    /// instance accidentally ending up in the same scene (see Awake).
    /// </summary>
    public class NetworkPlayerSpawner : MonoBehaviour
#if PHOTON_FUSION_AVAILABLE
        , INetworkRunnerCallbacks
#endif
    {
        [SerializeField] private GameObject networkPlayerPrefab;
        [SerializeField] private Transform attackerSpawnPoint;
        [SerializeField] private Transform defenderSpawnPoint;

        private static NetworkPlayerSpawner _activeInstance;

        private readonly Dictionary<string, GameObject> _spawnedByPlayerId = new Dictionary<string, GameObject>();

        private void Awake()
        {
            if (_activeInstance != null && _activeInstance != this)
            {
                Debug.LogError("[NetworkPlayerSpawner] Duplicate spawner detected in this scene — " +
                                "destroying the new one. Only one NetworkPlayerSpawner may be active " +
                                "in the Battle scene at a time.");
                Destroy(gameObject);
                return;
            }

            _activeInstance = this;
        }

        private void OnDestroy()
        {
            if (_activeInstance == this)
            {
                _activeInstance = null;
            }
        }

        /// <summary>
        /// Spawns the local player's networked avatar at the correct spawn
        /// point (attacker vs defender) using attributes sourced from
        /// PlayerSession — never invented client-side, per the
        /// server-authoritative principle.
        /// </summary>
        public GameObject SpawnLocalPlayer(bool isAttacker)
        {
            if (networkPlayerPrefab == null)
            {
                Debug.LogError("[NetworkPlayerSpawner] No networkPlayerPrefab assigned.");
                return null;
            }

            var spawnPoint = isAttacker ? attackerSpawnPoint : defenderSpawnPoint;
            var position = spawnPoint != null ? spawnPoint.position : Vector3.zero;
            var rotation = spawnPoint != null ? spawnPoint.rotation : Quaternion.identity;

            GameObject instance;

            // NetworkRunner.Spawn requires a live NetworkRunner reference;
            // room/runner ownership lives in PhotonConnectionManager. This
            // spawner instantiates directly for now — swapping to
            // runner.Spawn(...) is a drop-in change once a public runner
            // accessor is exposed there, without altering this class's API.
            instance = Instantiate(networkPlayerPrefab, position, rotation);

            var controller = instance.GetComponent<NetworkPlayerController>();
            if (controller != null && PlayerSession.HasActiveSession)
            {
                var session = PlayerSession.Current;
                controller.Initialize(
                    session.ClassType,
                    faction: null, // Faction not yet part of PlayerSessionData — populated once Faction System ships.
                    weapon: null,  // Equipped weapon resolution belongs to Sprint 6 combat wiring.
                    session.Health,
                    session.Energy);

                _spawnedByPlayerId[session.PlayerId] = instance;
            }

            return instance;
        }

        /// <summary>Despawns and removes tracking for a given player's
        /// networked avatar (used on session end or forfeit).</summary>
        public void DespawnPlayer(string playerId)
        {
            if (!_spawnedByPlayerId.TryGetValue(playerId, out var instance))
            {
                return;
            }

            if (instance != null)
            {
                Destroy(instance);
            }

            _spawnedByPlayerId.Remove(playerId);
        }

        /// <summary>Despawns every tracked avatar — used when leaving the
        /// Battle scene entirely.</summary>
        public void DespawnAll()
        {
            foreach (var kvp in _spawnedByPlayerId)
            {
                if (kvp.Value != null)
                {
                    Destroy(kvp.Value);
                }
            }

            _spawnedByPlayerId.Clear();
        }

#if PHOTON_FUSION_AVAILABLE
        public void OnPlayerJoined(NetworkRunner runner, PlayerRef player) { }
        public void OnPlayerLeft(NetworkRunner runner, PlayerRef player) { }
        public void OnInput(NetworkRunner runner, NetworkInput input) { }
        public void OnInputMissing(NetworkRunner runner, PlayerRef player, NetworkInput input) { }
        public void OnShutdown(NetworkRunner runner, ShutdownReason shutdownReason) { }
        public void OnConnectedToServer(NetworkRunner runner) { }
        public void OnDisconnectedFromServer(NetworkRunner runner, Fusion.Sockets.NetDisconnectReason reason) { }
        public void OnConnectRequest(NetworkRunner runner, NetworkRunnerCallbackArgs.ConnectRequest request, byte[] token) { }
        public void OnConnectFailed(NetworkRunner runner, Fusion.Sockets.NetAddress remoteAddress, Fusion.Sockets.NetConnectFailedReason reason) { }
        public void OnUserSimulationMessage(NetworkRunner runner, Fusion.Sockets.SimulationMessagePtr message) { }
        public void OnSessionListUpdated(NetworkRunner runner, System.Collections.Generic.List<SessionInfo> sessionList) { }
        public void OnCustomAuthenticationResponse(NetworkRunner runner, System.Collections.Generic.Dictionary<string, object> data) { }
        public void OnHostMigration(NetworkRunner runner, HostMigrationToken hostMigrationToken) { }
        public void OnReliableDataReceived(NetworkRunner runner, PlayerRef player, ReliableKey key, System.ArraySegment<byte> data) { }
        public void OnReliableDataProgress(NetworkRunner runner, PlayerRef player, ReliableKey key, float progress) { }
        public void OnSceneLoadDone(NetworkRunner runner) { }
        public void OnSceneLoadStart(NetworkRunner runner) { }
        public void OnObjectExitAOI(NetworkRunner runner, NetworkObject obj, PlayerRef player) { }
        public void OnObjectEnterAOI(NetworkRunner runner, NetworkObject obj, PlayerRef player) { }
#endif
    }
}
