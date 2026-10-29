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

        /// <summary>The defender may reach Photon before the attacker has
        /// created the room (it learns of the accept first). A Client join
        /// that finds no room is retried for this long, which stays inside
        /// the server's 30 s ready timeout.</summary>
        public const float ClientJoinRetrySeconds = 20f;
        private const int ClientJoinRetryDelayMs = 1000;

        /// <summary>True only during the live match (after the countdown):
        /// OnInput sends movement input while this is set.
        /// BattleLoadingController switches it on and off.</summary>
        public bool SendMovementInput { get; set; }

#if PHOTON_FUSION_AVAILABLE
        private NetworkRunner _runner;

        /// <summary>The live runner, or null outside a room. Used by
        /// NetworkPlayerSpawner to spawn avatars on the host.</summary>
        public NetworkRunner Runner => _runner;
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
        /// Starts or joins the Photon room for a battle session. `roomName`
        /// is always the server-generated photon_room_name (POST
        /// /battle/challenge for the attacker, POST /battle/{id}/accept for
        /// the defender) — never client-generated, so both participants
        /// converge on the same room. Fusion Host Mode (see class remarks):
        /// the attacker starts the room as Host (asHost: true; it alone holds
        /// host_authority_secret) and the defender joins it as Client
        /// (asHost: false). Accepted Alpha debt: the host's client simulates
        /// the match, so a modified attacker client can cheat (HANDOFF).
        /// </summary>
        public async Task<bool> JoinRoomAsync(string roomName, bool asHost)
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

                var result = await StartRunnerAsync(roomName, asHost);

                // Client before Host: retry while the attacker's room does
                // not exist yet (see ClientJoinRetrySeconds).
                // Wall-clock deadline: each StartGame attempt is itself a
                // cloud round-trip of a few seconds, so counting only the
                // delays would let twenty attempts run far past the
                // server's 30 s ready timeout.
                var retryClock = System.Diagnostics.Stopwatch.StartNew();
                while (!asHost && !result.Ok && result.ShutdownReason == ShutdownReason.GameNotFound &&
                       retryClock.Elapsed.TotalSeconds < ClientJoinRetrySeconds)
                {
                    await DestroyRunnerAsync();
                    await Task.Delay(ClientJoinRetryDelayMs);
                    Debug.Log($"[PhotonConnectionManager] Room '{roomName}' not created yet — retrying as Client.");
                    result = await StartRunnerAsync(roomName, asHost);
                }

                if (result.Ok)
                {
                    CurrentRoomName = roomName;
                    IsConnected = true;
                    Debug.Log($"[PhotonConnectionManager] Joined room '{roomName}' as {(asHost ? "Host" : "Client")}.");
                    OnRoomJoined?.Invoke();
                    return true;
                }

                Debug.LogError($"[PhotonConnectionManager] Failed to join room '{roomName}': {result.ShutdownReason}");
                await DestroyRunnerAsync();
                OnConnectFailed?.Invoke(result.ShutdownReason.ToString());
                return false;
#else
                // Stub only: no Photon connection is made, so this proves
                // nothing about a real Host/Client session.
                Debug.LogWarning("[PhotonConnectionManager] PHOTON_FUSION_AVAILABLE not defined — " +
                                  "running in stub mode until the Photon Fusion SDK package is imported. " +
                                  $"Simulating a join to '{roomName}' as {(asHost ? "Host" : "Client")}; no real room exists.");
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

#if PHOTON_FUSION_AVAILABLE
        /// <summary>One StartGame attempt on a fresh runner (a runner cannot
        /// be restarted after it shuts down).</summary>
        private async Task<StartGameResult> StartRunnerAsync(string roomName, bool asHost)
        {
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
                GameMode = asHost ? GameMode.Host : GameMode.Client,
                SessionName = roomName,
                PlayerCount = 2,
                SceneManager = runnerObject.AddComponent<NetworkSceneManagerDefault>(),
            };

            return await _runner.StartGame(startArgs);
        }

        private async Task DestroyRunnerAsync()
        {
            if (_runner == null)
            {
                return;
            }

            var runner = _runner;
            _runner = null;
            runner.RemoveCallbacks(this);
            if (runner.IsRunning)
            {
                await runner.Shutdown();
            }

            if (runner != null && runner.gameObject != null)
            {
                Destroy(runner.gameObject);
            }
        }
#endif

        /// <summary>
        /// Leaves the current room without fully tearing down — used when a
        /// battle session ends normally (resolved/forfeited/cancelled) and
        /// the player is returning to MainMap.
        /// </summary>
        public async Task LeaveRoomAsync()
        {
#if PHOTON_FUSION_AVAILABLE
            // Shut down AND forget the runner (and its callbacks), so the
            // next battle starts a fresh one instead of reusing a dead one.
            await DestroyRunnerAsync();
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
            // Runner.Shutdown() destroys the runner's GameObject by default,
            // so touching _runner.gameObject afterwards could throw;
            // DestroyRunnerAsync checks first.
            await DestroyRunnerAsync();
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

        public void OnInput(NetworkRunner runner, NetworkInput input)
        {
            input.Set(SendMovementInput ? NetworkInputData.SampleLocal() : default);
        }

        public void OnInputMissing(NetworkRunner runner, PlayerRef player, NetworkInput input) { }

        public void OnShutdown(NetworkRunner runner, ShutdownReason shutdownReason)
        {
            Debug.Log($"[PhotonConnectionManager] Runner shutdown: {shutdownReason}");
            IsConnected = false;
        }

        public void OnConnectedToServer(NetworkRunner runner) { }

        public void OnDisconnectedFromServer(NetworkRunner runner, NetDisconnectReason reason)
        {
            if (_isJoining)
            {
                // A failed join attempt, reported by JoinRoomAsync's result;
                // not a match disconnect, so no reconnect grace starts.
                Debug.Log($"[PhotonConnectionManager] Join attempt disconnected: {reason}");
                return;
            }

            Debug.LogWarning($"[PhotonConnectionManager] Disconnected from server: {reason}");
            OnPlayerDisconnected?.Invoke();
        }

        public void OnConnectRequest(NetworkRunner runner, NetworkRunnerCallbackArgs.ConnectRequest request, byte[] token) { }

        // Explicit: the public OnConnectFailed event above has the same name.
        void INetworkRunnerCallbacks.OnConnectFailed(NetworkRunner runner, NetAddress remoteAddress, NetConnectFailedReason reason)
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
