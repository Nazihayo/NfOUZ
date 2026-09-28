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
        public bool IsReadyPressed;
    }
}
