using System;

#if PHOTON_FUSION_AVAILABLE
using Fusion;
#endif

namespace Nfouz.Networking
{
    /// <summary>
    /// Per-tick input sampled locally and sent to the Photon Fusion
    /// simulation for this player: movement intent (Sprint 5, Battle System
    /// v1.0 section 2 "free movement inside the Arena") and which of the
    /// Sprint 6 combat buttons were pressed (ActionBits, see
    /// CombatActionInput). Intent only: the host runs the actions
    /// (BattleManager), the client never applies their outcome.
    /// </summary>
#if PHOTON_FUSION_AVAILABLE
    public struct NetworkInputData : INetworkInput
#else
    [Serializable]
    public struct NetworkInputData
#endif
    {
        public float MoveX;
        public float MoveZ;
        public float LookYaw;

        /// <summary>CombatAction flags pressed since the previous sample.</summary>
        public int ActionBits;
#if PHOTON_FUSION_AVAILABLE
        public NetworkBool IsReadyPressed; // Fusion input structs use NetworkBool, not bool.
#else
        public bool IsReadyPressed;
#endif

        /// <summary>
        /// This device's input: movement from the Input Manager (Old)
        /// Horizontal/Vertical axes (keyboard in the Editor) or the phone's
        /// movement stick (TouchStick), whichever is pushed further, facing
        /// the move direction; and the combat buttons pressed since the last
        /// sample (CombatActionLatch.Local).
        /// </summary>
        public static NetworkInputData SampleLocal()
        {
            var x = UnityEngine.Input.GetAxisRaw("Horizontal");
            var z = UnityEngine.Input.GetAxisRaw("Vertical");
            if (TouchStick.MoveX * TouchStick.MoveX + TouchStick.MoveZ * TouchStick.MoveZ > x * x + z * z)
            {
                x = TouchStick.MoveX;
                z = TouchStick.MoveZ;
            }

            var data = new NetworkInputData
            {
                MoveX = x,
                MoveZ = z,
                ActionBits = (int)CombatActionLatch.Local.Consume(),
            };
            if (x * x + z * z > 0.01f)
            {
                data.LookYaw = UnityEngine.Mathf.Atan2(x, z) * UnityEngine.Mathf.Rad2Deg;
            }

            return data;
        }
    }
}
