using System;
using UnityEngine;

namespace Nfouz.Core
{
    /// <summary>
    /// In-memory cache of the current player's server-authoritative state.
    /// Populated exclusively from server responses (SessionBootstrap on boot,
    /// battle/resolve, quest/claim, etc.) — never mutated locally as a
    /// source of truth. See UI/UX Flows & Save System v1.0, section 4.
    /// </summary>
    [Serializable]
    public class PlayerSessionData
    {
        public string PlayerId;
        public string Username;
        public string ClassType;
        public int Health;
        public int MaxHealth;
        public int Energy;
        public int MaxEnergy;
        public int Influence;
        public int Level;
        public int Experience;
        public string Rank;
        public bool IsControlled;
        public string ControllerId; // Sprint 7 continuation — null unless IsControlled
        public string ControlledUntilIso; // ISO 8601 UTC string, parsed on demand
        public bool IsProtected; // Sprint 7 continuation — GDD section 4
        public string ProtectedUntilIso; // ISO 8601 UTC string, parsed on demand
        public int Credits; // Sprint 7 continuation — Control economy foundation
    }

    /// <summary>
    /// Static accessor for the current session. Registered as a plain class
    /// (not a MonoBehaviour) since it holds no scene-dependent state.
    /// </summary>
    public static class PlayerSession
    {
        public static PlayerSessionData Current { get; private set; }
        public static bool HasActiveSession => Current != null && !string.IsNullOrEmpty(Current.PlayerId);

        public static event Action<PlayerSessionData> OnSessionUpdated;

        /// <summary>
        /// Overwrites the entire session from a trusted server payload.
        /// Server data always wins over whatever was cached locally — see
        /// the Save System's "server always overrides local cache" rule.
        /// </summary>
        public static void UpdateFromServer(PlayerSessionData serverData)
        {
            if (serverData == null)
            {
                Debug.LogError("[PlayerSession] Attempted to update session with a null payload.");
                return;
            }

            Current = serverData;
            OnSessionUpdated?.Invoke(Current);
        }

        public static void Clear()
        {
            Current = null;
            OnSessionUpdated?.Invoke(null);
        }
    }
}
