using Nfouz.Core;
using Nfouz.Utils;
using UnityEngine;

#if PHOTON_FUSION_AVAILABLE
using Fusion;
#endif

namespace Nfouz.Networking
{
    /// <summary>
    /// Networked player state for a single battle participant. Sprint 5
    /// scope, per spec: synchronizes Health, Energy, Position, Rotation,
    /// Class, Faction, Weapon — MOVEMENT SYNCHRONIZATION ONLY. No combat
    /// logic (damage application, hit detection, ability execution) lives
    /// here; that is explicitly deferred to Sprint 6. Health/Energy are
    /// synchronized as display state only in this sprint.
    /// </summary>
#if PHOTON_FUSION_AVAILABLE
    public class NetworkPlayerController : NetworkBehaviour
#else
    public class NetworkPlayerController : MonoBehaviour
#endif
    {
        [Header("Movement (Sprint 5: sync only, no combat)")]
        [SerializeField] private float moveSpeed = 4f;
        [SerializeField] private float rotationSpeedDegreesPerSecond = 240f;

#if PHOTON_FUSION_AVAILABLE
        [Networked] public Vector3 NetworkedPosition { get; set; }
        [Networked] public float NetworkedYaw { get; set; }
        [Networked] public int NetworkedHealth { get; set; }
        [Networked] public int NetworkedEnergy { get; set; }
        [Networked] public NetworkString<_32> NetworkedClass { get; set; }
        [Networked] public NetworkString<_32> NetworkedFaction { get; set; }
        [Networked] public NetworkString<_32> NetworkedWeapon { get; set; }
        [Networked] public NetworkBool IsReady { get; set; }

        /// <summary>The host accepts this player's RPC_SetProfile once.</summary>
        [Networked] public NetworkBool ProfileReceived { get; set; }

        /// <summary>ActionBits of the last input the host ran, to run each
        /// press once (CombatActionBits.NewlyPressed).</summary>
        [Networked] public int LastActionBits { get; set; }
#else
        public Vector3 NetworkedPosition { get; set; }
        public float NetworkedYaw { get; set; }
        public int NetworkedHealth { get; set; }
        public int NetworkedEnergy { get; set; }
        public string NetworkedClass { get; set; }
        public string NetworkedFaction { get; set; }
        public string NetworkedWeapon { get; set; }
        public bool IsReady { get; set; }
#endif

        /// <summary>
        /// Raised on the Photon host only, once per combat button press of
        /// this avatar's player, during a network tick. BattleManager runs
        /// the matching PlayerCombat action (Host Mode Alpha: the host
        /// simulates the match). Never raised on a client.
        /// </summary>
        public event System.Action<NetworkPlayerController, CombatAction> CombatActionsPressed;

        /// <summary>True when this machine owns this avatar's state: the
        /// Photon host; also an avatar that is not a spawned network object
        /// (stub mode, tests), which only exists on this machine. Only then
        /// may Health/Energy be changed (a client's writes are overwritten
        /// by the host's).</summary>
        public bool HasSimulationAuthority
        {
            get
            {
#if PHOTON_FUSION_AVAILABLE
                return Object == null || !Object.IsValid || HasStateAuthority;
#else
                return true;
#endif
            }
        }

        /// <summary>Whether this is the local player's own avatar, from
        /// Fusion's input authority. Null when unknown (stub mode, or the
        /// object is not spawned yet): callers fall back to spawn points.</summary>
        public bool? IsLocalPlayer
        {
            get
            {
#if PHOTON_FUSION_AVAILABLE
                return Object != null && Object.IsValid ? HasInputAuthority : (bool?)null;
#else
                return null;
#endif
            }
        }

        /// <summary>Whether this machine is the Photon host (the attacker:
        /// PhotonRoomLifecycle joins the attacker as Host). Null when
        /// unknown.</summary>
        public bool? IsOnHostMachine
        {
            get
            {
#if PHOTON_FUSION_AVAILABLE
                return Runner != null && Runner.IsRunning ? Runner.IsServer : (bool?)null;
#else
                return null;
#endif
            }
        }

        /// <summary>After a combat action moved this avatar's transform
        /// directly (Dodge, Blink Step, Shadow Lunge, Ground Break's
        /// knockback), make that the networked position, or the next
        /// movement tick would snap it back.</summary>
        public void AdoptTransformPosition()
        {
#if PHOTON_FUSION_AVAILABLE
            if (Object == null || !Object.IsValid || !HasStateAuthority)
            {
                return;
            }
#endif
            NetworkedPosition = transform.position;
        }

        /// <summary>
        /// Called once on spawn (by NetworkPlayerSpawner) to seed the
        /// server-authoritative attributes that don't change during
        /// movement-only Sprint 5 gameplay (class/faction/weapon/starting
        /// health+energy) — sourced from PlayerSession, never invented
        /// client-side.
        /// </summary>
        public void Initialize(string classType, string faction, string weapon, int health, int energy)
        {
#if PHOTON_FUSION_AVAILABLE
            NetworkedClass = classType;
            NetworkedFaction = faction ?? string.Empty;
            NetworkedWeapon = weapon ?? string.Empty;
            NetworkedHealth = health;
            NetworkedEnergy = energy;
#else
            NetworkedClass = classType;
            NetworkedFaction = faction ?? string.Empty;
            NetworkedWeapon = weapon ?? string.Empty;
            NetworkedHealth = health;
            NetworkedEnergy = energy;
#endif
        }

#if PHOTON_FUSION_AVAILABLE
        /// <summary>
        /// The host spawns this avatar at its spawn point (see
        /// NetworkPlayerSpawner); the host seeds the networked transform
        /// from there. Each player then sends its own class and starting
        /// Health/Energy from its PlayerSession (server data) to the host,
        /// which alone may write networked state. Display state only.
        /// </summary>
        public override void Spawned()
        {
            if (HasStateAuthority)
            {
                NetworkedPosition = transform.position;
                NetworkedYaw = transform.eulerAngles.y;
            }

            if (HasInputAuthority && PlayerSession.HasActiveSession)
            {
                var session = PlayerSession.Current;
                RPC_SetProfile(session.ClassType ?? string.Empty, session.Health, session.Energy);
            }
        }

        [Rpc(RpcSources.InputAuthority, RpcTargets.StateAuthority)]
        private void RPC_SetProfile(string classType, int health, int energy)
        {
            // Once per avatar, at spawn: a second call (a modified client
            // healing itself mid-match) is ignored. Starting values are the
            // player's own server data; the backend re-checks health bounds
            // in the signed result (battle.service.js evaluateSuspicion).
            if (ProfileReceived)
            {
                Debug.LogWarning("[NetworkPlayerController] Ignoring a repeated profile update.");
                return;
            }

            if (!IsKnownClass(classType) || health <= 0 || energy < 0)
            {
                Debug.LogWarning("[NetworkPlayerController] Ignoring an invalid profile update.");
                return;
            }

            ProfileReceived = true;
            Initialize(classType, faction: null, weapon: null, health, energy);
        }

        private static bool IsKnownClass(string classType)
        {
            return classType == Constants.PlayerClass.Scout ||
                   classType == Constants.PlayerClass.Ranger ||
                   classType == Constants.PlayerClass.Titan;
        }

        public override void FixedUpdateNetwork()
        {
            if (GetInput(out NetworkInputData input))
            {
                input = Sanitize(input);
                ApplyMovement(input);

                if (input.IsReadyPressed)
                {
                    IsReady = true;
                }

                // Combat runs on the host only, once per tick (a client's
                // prediction resimulates ticks; it must not repeat actions).
                if (HasStateAuthority && Runner.IsForward)
                {
                    var pressed = CombatActionBits.NewlyPressed(input.ActionBits, LastActionBits);
                    LastActionBits = input.ActionBits;
                    if (pressed != CombatAction.None)
                    {
                        CombatActionsPressed?.Invoke(this, pressed);
                    }
                }
            }
        }

        /// <summary>Input comes from the other player's device: the host
        /// drops NaN/infinite values (they would make the position NaN) and
        /// caps the stick at length 1.</summary>
        private static NetworkInputData Sanitize(NetworkInputData input)
        {
            if (!IsFinite(input.MoveX) || !IsFinite(input.MoveZ))
            {
                input.MoveX = 0f;
                input.MoveZ = 0f;
            }

            if (!IsFinite(input.LookYaw))
            {
                input.LookYaw = 0f;
            }

            return input;
        }

        private static bool IsFinite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }

        private void ApplyMovement(NetworkInputData input)
        {
            var moveDirection = new Vector3(input.MoveX, 0f, input.MoveZ);
            if (moveDirection.sqrMagnitude > 1f)
            {
                moveDirection.Normalize();
            }

            NetworkedPosition += moveDirection * (moveSpeed * Runner.DeltaTime);
            if (moveDirection.sqrMagnitude > 0.0001f)
            {
                // Idle input carries no facing; keep the last one.
                NetworkedYaw = Mathf.MoveTowardsAngle(
                    NetworkedYaw, input.LookYaw, rotationSpeedDegreesPerSecond * Runner.DeltaTime);
            }

            transform.position = NetworkedPosition;
            transform.rotation = Quaternion.Euler(0f, NetworkedYaw, 0f);
        }

        public override void Render()
        {
            // Render-side interpolation target — keeps remote players
            // visually smooth between FixedUpdateNetwork ticks.
            transform.position = NetworkedPosition;
            transform.rotation = Quaternion.Euler(0f, NetworkedYaw, 0f);
        }
#else
        /// <summary>Stub-mode movement applier, used only when
        /// PHOTON_FUSION_AVAILABLE is not defined, so scenes referencing
        /// this component still behave sensibly in editor testing before
        /// the Photon Fusion SDK package is imported.</summary>
        public void ApplyLocalInput(NetworkInputData input, float deltaTime)
        {
            var moveDirection = new Vector3(input.MoveX, 0f, input.MoveZ);
            if (moveDirection.sqrMagnitude > 1f)
            {
                moveDirection.Normalize();
            }

            NetworkedPosition += moveDirection * (moveSpeed * deltaTime);
            NetworkedYaw = Mathf.MoveTowardsAngle(NetworkedYaw, input.LookYaw, rotationSpeedDegreesPerSecond * deltaTime);

            transform.position = NetworkedPosition;
            transform.rotation = Quaternion.Euler(0f, NetworkedYaw, 0f);

            if (input.IsReadyPressed)
            {
                IsReady = true;
            }
        }
#endif
    }
}
