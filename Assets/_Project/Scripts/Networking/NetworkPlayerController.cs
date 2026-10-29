using Nfouz.Core;
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
        [Networked] public NetworkBool IsReady { get; set; }

        // Health/Energy/Class are networked once this avatar is spawned by a
        // runner. Fusion throws on networked properties of an unspawned
        // object, so before that (EditMode tests, a scene placed avatar)
        // they read and write the plain fields below instead.
        [Networked] private int NetHealth { get; set; }
        [Networked] private int NetEnergy { get; set; }
        [Networked] private NetworkString<_32> NetClass { get; set; }
        [Networked] private NetworkString<_32> NetFaction { get; set; }
        [Networked] private NetworkString<_32> NetWeapon { get; set; }

        private int _offlineHealth;
        private int _offlineEnergy;
        private string _offlineClass = string.Empty;
        private string _offlineFaction = string.Empty;
        private string _offlineWeapon = string.Empty;

        private bool IsNetworked => Object != null && Object.IsValid;

        public int NetworkedHealth
        {
            get => IsNetworked ? NetHealth : _offlineHealth;
            set { if (IsNetworked) NetHealth = value; else _offlineHealth = value; }
        }

        public int NetworkedEnergy
        {
            get => IsNetworked ? NetEnergy : _offlineEnergy;
            set { if (IsNetworked) NetEnergy = value; else _offlineEnergy = value; }
        }

        public string NetworkedClass
        {
            get => IsNetworked ? NetClass.ToString() : _offlineClass;
            set { if (IsNetworked) NetClass = value ?? string.Empty; else _offlineClass = value ?? string.Empty; }
        }

        public string NetworkedFaction
        {
            get => IsNetworked ? NetFaction.ToString() : _offlineFaction;
            set { if (IsNetworked) NetFaction = value ?? string.Empty; else _offlineFaction = value ?? string.Empty; }
        }

        public string NetworkedWeapon
        {
            get => IsNetworked ? NetWeapon.ToString() : _offlineWeapon;
            set { if (IsNetworked) NetWeapon = value ?? string.Empty; else _offlineWeapon = value ?? string.Empty; }
        }
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
            Initialize(classType, faction: null, weapon: null, health, energy);
        }

        public override void FixedUpdateNetwork()
        {
            if (GetInput(out NetworkInputData input))
            {
                ApplyMovement(input);

                if (input.IsReadyPressed)
                {
                    IsReady = true;
                }
            }
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
