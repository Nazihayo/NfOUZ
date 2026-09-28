using System;
using System.Threading.Tasks;
using Nfouz.Core;
using UnityEngine;

#if PHOTON_FUSION_AVAILABLE
using Fusion;
using Fusion.Sockets;
using System.Collections.Generic;
#endif

namespace Nfouz.Networking
{
    /// <summary>
    /// Owns the Photon Fusion NetworkRunner lifecycle: room creation, room
    /// join, room leave, room shutdown, and connection/disconnect events.
    /// Guarded by PHOTON_FUSION_AVAILABLE (see FirebaseManager.cs /
    /// MapboxManager.cs for the same stub-mode pattern) so the project
    /// compiles before the Photon Fusion SDK package is imported.
    ///
    /// Sprint 5 scope: room lifecycle + connection/disconnect/timeout
    /// detection only. No combat, no result computation.
    /// Registered in ServiceLocator by GameManager (Boot scene), same as
    /// ApiClient/FirebaseManager.
    ///
    /// <b>Mode decision (Alpha): Fusion Host Mode.</b> This is not a free
    /// choice made in Sprint 5 — it is the mode already approved in TDD
    /// v1.0 section 1 ("Photon Fusion — Host/Server Mode مع
    /// Server-Authoritative Logic") and spelled out in full in Photon &
    /// Mapbox Integration v1.0 section 1.1, which explicitly rejects
    /// Shared Mode ("يمنح كل عميل سلطة جزئية — غير مناسب لمعركة تنافسية")
    /// and defers a fully separate Dedicated Server to post-Alpha as a
    /// future security recommendation, once operating budget allows. A
    /// prior revision of this file used GameMode.Shared — that was a
    /// defect against the approved documents and has been corrected
    /// here. Do not mix Host Mode and Dedicated Server code paths.
    /// </summary>
    public class PhotonConnectionManager : MonoBehaviour
#if PHOTON_FUSION_AVAILABLE
        , INetworkRunnerCallbacks
#endif
    {
        public event Action OnRoomJoined;
        public event Action OnRoomLeft;
        public event Action<string> OnConnectFailed;
        public event Action OnPlayerDisconnected;
        public event Action OnPlayerReconnected;

        public bool IsConnected { get; private set; }
        public string CurrentRoomName { get; private set; }

        // Singleton guard: exactly one PhotonConnectionManager (and
        // therefore exactly one NetworkRunner) may exist at a time. See
        // class remarks — duplicate managers would mean duplicate Photon
        // sessions/runners fighting over the same battle.
        private static PhotonConnectionManager _instance;

        // Re-entrancy guard: prevents two overlapping JoinRoomAsync calls
        // (e.g. a double-tapped challenge button) from racing to create
        // two NetworkRunners before the first StartGame() call resolves.
        private bool _isJoining;

#if PHOTON_FUSION_AVAILABLE
        private NetworkRunner _runner;
#endif

        private void Awake()
        {
            if (_instance != null && _instance != this)
            {
                Debug.LogError("[PhotonConnectionManager] Duplicate instance detected — destroying the new one. " +
                                "Only one PhotonConnectionManager may exist (registered once by GameManager).");
                Destroy(gameObject);
                return;
            }

            _instance = this;
        }

        private void OnDestroy()
        {
            if (_instance == this)
            {
                _instance = null;
            }
        }

        /// <summary>
        /// Creates (or joins, if it already exists) the Photon room for a
        /// battle session. `roomName` is always the server-generated
        /// photon_room_name from POST /battle/challenge — never
        /// client-generated, so both participants converge on the same
        /// room deterministically. Uses Fusion Host Mode (see class
        /// remarks) — the first participant to reach StartGame() becomes
        /// the authoritative Host for this room.
        /// </summary>
        public async Task<bool> JoinRoomAsync(string roomName)
        {
            if (string.IsNullOrEmpty(roomName))
            {
                Debug.LogError("[PhotonConnectionManager] Cannot join a room with a null/empty name.");
                return false;
            }

            if (_isJoining)
            {
                Debug.LogWarning("[PhotonConnectionManager] JoinRoomAsync already in progress — ignoring re-entrant call.");
                return false;
            }

            _isJoining = true;
            try
            {
#if PHOTON_FUSION_AVAILABLE
                if (_runner != null)
                {
                    Debug.LogWarning("[PhotonConnectionManager] Runner already exists — shutting down before rejoining.");
                    await ShutdownAsync();
                }

                var runnerObject = new GameObject($"NetworkRunner_{roomName}");
                DontDestroyOnLoad(runnerObject);
                _runner = runnerObject.AddComponent<NetworkRunner>();
                _runner.ProvideInput = true;
                _runner.AddCallbacks(this);

                var startArgs = new StartGameArgs
                {
                    // Host Mode is the approved Alpha mode — see class remarks.
                    // Do NOT change to GameMode.Shared or a Dedicated Server
                    // mode without a corresponding update to TDD v1.0 and
                    // Photon & Mapbox Integration v1.0.
                    GameMode = GameMode.Host,
                    SessionName = roomName,
                    PlayerCount = 2,
                    SceneManager = runnerObject.AddComponent<NetworkSceneManagerDefault>(),
                };

                var result = await _runner.StartGame(startArgs);

                if (result.Ok)
                {
                    CurrentRoomName = roomName;
                    IsConnected = true;
                    Debug.Log($"[PhotonConnectionManager] Joined room '{roomName}' (Host Mode).");
                    OnRoomJoined?.Invoke();
                    return true;
                }

                Debug.LogError($"[PhotonConnectionManager] Failed to join room '{roomName}': {result.ShutdownReason}");
                OnConnectFailed?.Invoke(result.ShutdownReason.ToString());
                return false;
#else
                Debug.LogWarning("[PhotonConnectionManager] PHOTON_FUSION_AVAILABLE not defined — " +
                                  "running in stub mode until the Photon Fusion SDK package is imported. " +
                                  $"Simulating successful Host Mode join to '{roomName}'.");
                CurrentRoomName = roomName;
                IsConnected = true;
                OnRoomJoined?.Invoke();
                await Task.Yield();
                return true;
#endif
            }
            finally
            {
                _isJoining = false;
            }
        }

        /// <summary>
        /// Leaves the current room without fully tearing down — used when a
        /// battle session ends normally (resolved/forfeited/cancelled) and
        /// the player is returning to MainMap.
        /// </summary>
        public async Task LeaveRoomAsync()
        {
#if PHOTON_FUSION_AVAILABLE
            if (_runner != null)
            {
                await _runner.Shutdown();
            }
#else
            await Task.Yield();
#endif
            IsConnected = false;
            var leftRoom = CurrentRoomName;
            CurrentRoomName = null;
            Debug.Log($"[PhotonConnectionManager] Left room '{leftRoom}'.");
            OnRoomLeft?.Invoke();
        }

        /// <summary>Full shutdown of the underlying runner — used on
        /// application quit or when abandoning a session outright (e.g.
        /// forced return to MainMap after an unrecoverable connect failure).</summary>
        public async Task ShutdownAsync()
        {
#if PHOTON_FUSION_AVAILABLE
            if (_runner != null)
            {
                await _runner.Shutdown();
                if (_runner.gameObject != null)
                {
                    Destroy(_runner.gameObject);
                }
                _runner = null;
            }
#else
            await Task.Yield();
#endif
            IsConnected = false;
            CurrentRoomName = null;
        }

#if PHOTON_FUSION_AVAILABLE
        // ---- INetworkRunnerCallbacks: only the subset relevant to Sprint 5
        // (room lifecycle + disconnect detection) is implemented meaningfully;
        // the rest are required by the interface and are intentionally no-ops.

        public void OnPlayerJoined(NetworkRunner runner, PlayerRef player) { }

        public void OnPlayerLeft(NetworkRunner runner, PlayerRef player)
        {
            Debug.LogWarning($"[PhotonConnectionManager] Player {player} left the room — starting disconnect grace period.");
            OnPlayerDisconnected?.Invoke();
        }

        public void OnInput(NetworkRunner runner, NetworkInput input) { }
        public void OnInputMissing(NetworkRunner runner, PlayerRef player, NetworkInput input) { }

        public void OnShutdown(NetworkRunner runner, ShutdownReason shutdownReason)
        {
            Debug.Log($"[PhotonConnectionManager] Runner shutdown: {shutdownReason}");
            IsConnected = false;
        }

        public void OnConnectedToServer(NetworkRunner runner) { }

        public void OnDisconnectedFromServer(NetworkRunner runner, NetDisconnectReason reason)
        {
            Debug.LogWarning($"[PhotonConnectionManager] Disconnected from server: {reason}");
            OnPlayerDisconnected?.Invoke();
        }

        public void OnConnectRequest(NetworkRunner runner, NetworkRunnerCallbackArgs.ConnectRequest request, byte[] token) { }

        public void OnConnectFailed(NetworkRunner runner, NetAddress remoteAddress, NetConnectFailedReason reason)
        {
            OnConnectFailed?.Invoke(reason.ToString());
        }

        public void OnUserSimulationMessage(NetworkRunner runner, SimulationMessagePtr message) { }
        public void OnSessionListUpdated(NetworkRunner runner, List<SessionInfo> sessionList) { }
        public void OnCustomAuthenticationResponse(NetworkRunner runner, Dictionary<string, object> data) { }
        public void OnHostMigration(NetworkRunner runner, HostMigrationToken hostMigrationToken) { }
        public void OnReliableDataReceived(NetworkRunner runner, PlayerRef player, ReliableKey key, ArraySegment<byte> data) { }
        public void OnReliableDataProgress(NetworkRunner runner, PlayerRef player, ReliableKey key, float progress) { }
        public void OnSceneLoadDone(NetworkRunner runner) { }
        public void OnSceneLoadStart(NetworkRunner runner) { }
        public void OnObjectExitAOI(NetworkRunner runner, NetworkObject obj, PlayerRef player) { }
        public void OnObjectEnterAOI(NetworkRunner runner, NetworkObject obj, PlayerRef player) { }
#endif
    }
}
