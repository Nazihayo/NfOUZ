using System;

#if PHOTON_FUSION_AVAILABLE
using Fusion;
#endif

namespace Nfouz.Networking
{
    /// <summary>
    /// Per-tick input sampled locally and sent to the Photon Fusion
    /// simulation for this player. Sprint 5 scope: movement synchronization
    /// only (position/rotation intent) — no attack/ability input here yet,
    /// that belongs to Sprint 6 combat. See Battle System v1.0 section 2
    /// (Combat Loop) for the "free movement inside the Arena" phase this
    /// feeds.
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
#if PHOTON_FUSION_AVAILABLE
        public NetworkBool IsReadyPressed; // Fusion input structs use NetworkBool, not bool.
#else
        public bool IsReadyPressed;
#endif

        /// <summary>
        /// This device's movement input from the Input Manager (Old)
        /// Horizontal/Vertical axes (keyboard in the Editor), facing the
        /// move direction. The Battle scene has no touch joystick yet, so a
        /// phone sends no movement.
        /// </summary>
        public static NetworkInputData SampleLocal()
        {
            var x = UnityEngine.Input.GetAxisRaw("Horizontal");
            var z = UnityEngine.Input.GetAxisRaw("Vertical");
            var data = new NetworkInputData { MoveX = x, MoveZ = z };
            if (x * x + z * z > 0.01f)
            {
                data.LookYaw = UnityEngine.Mathf.Atan2(x, z) * UnityEngine.Mathf.Rad2Deg;
            }

            return data;
        }
    }
}
