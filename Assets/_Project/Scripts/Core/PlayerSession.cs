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
    /// <remarks>
    /// JsonUtility matches JSON keys to serialized field names exactly, so the
    /// serialized fields carry the backend's snake_case keys (auth.service.js
    /// toPublicPlayer: GET /auth/me, POST /auth/register) and the PascalCase
    /// properties are the C# API used by the rest of the client.
    /// </remarks>
    [Serializable]
    public class PlayerSessionData
    {
        [SerializeField] private string player_id;
        [SerializeField] private string username;
        [SerializeField] private string class_type;
        [SerializeField] private int health;
        [SerializeField] private int max_health;
        [SerializeField] private int energy;
        [SerializeField] private int max_energy;
        [SerializeField] private int influence;
        [SerializeField] private int level;
        [SerializeField] private int experience;
        [SerializeField] private string rank;
        [SerializeField] private bool is_controlled;
        [SerializeField] private string controller_id;
        [SerializeField] private string controlled_until;
        [SerializeField] private bool is_protected;
        [SerializeField] private string protected_until;
        [SerializeField] private int credits;

        public string PlayerId { get => player_id; set => player_id = value; }
        public string Username { get => username; set => username = value; }
        public string ClassType { get => class_type; set => class_type = value; }
        public int Health { get => health; set => health = value; }
        public int MaxHealth { get => max_health; set => max_health = value; }
        public int Energy { get => energy; set => energy = value; }
        public int MaxEnergy { get => max_energy; set => max_energy = value; }
        public int Influence { get => influence; set => influence = value; }
        public int Level { get => level; set => level = value; }
        public int Experience { get => experience; set => experience = value; }
        public string Rank { get => rank; set => rank = value; }
        public bool IsControlled { get => is_controlled; set => is_controlled = value; }
        public string ControllerId { get => controller_id; set => controller_id = value; } // Sprint 7 continuation — null unless IsControlled
        public string ControlledUntilIso { get => controlled_until; set => controlled_until = value; } // ISO 8601 UTC string, parsed on demand
        public bool IsProtected { get => is_protected; set => is_protected = value; } // Sprint 7 continuation — GDD section 4
        public string ProtectedUntilIso { get => protected_until; set => protected_until = value; } // ISO 8601 UTC string, parsed on demand
        public int Credits { get => credits; set => credits = value; } // Sprint 7 continuation — Control economy foundation
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
