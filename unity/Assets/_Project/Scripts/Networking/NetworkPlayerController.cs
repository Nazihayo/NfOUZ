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
            NetworkedYaw = Mathf.MoveTowardsAngle(
                NetworkedYaw, input.LookYaw, rotationSpeedDegreesPerSecond * Runner.DeltaTime);

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
