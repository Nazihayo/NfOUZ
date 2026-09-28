using System;
using UnityEngine;

namespace Nfouz.Networking
{
    /// <summary>
    /// Mirrors the battle session shape returned by POST /battle/challenge
    /// and GET /battle/{battleId} (see REST API Specification v1.0 section 3.1,
    /// extended in Sprint 5 with session-state fields, and in Sprint 6 with
    /// the winner_id/loser_id/duration_seconds result-retrieval fields
    /// this class's own doc comment previously called out as deferred).
    ///
    /// Sprint 6 final security correction: host_authority_secret,
    /// match_nonce and rules_version are only ever populated on the
    /// POST /battle/challenge response, and only for the attacker (who is
    /// the Photon Host Mode host by convention, since the attacker's
    /// client is the one that creates the Photon room — see
    /// battle.service.js's header doc comment). GET /battle/{battleId}
    /// never returns host_authority_secret or match_nonce to either
    /// participant — a non-host client polls status via GET and never
    /// sees the secret. These three fields stay null/empty on this client
    /// unless it is genuinely the host of this specific battle.
    /// </summary>
    [Serializable]
    public class BattleSessionData
    {
        public string battle_id;
        public string photon_room_name;
        public string attacker_id;
        public string defender_id;
        public string status; // in_progress | resolved | forfeited | cancelled
        public bool attacker_ready;
        public bool defender_ready;
        public string attacker_disconnected_at; // ISO 8601 UTC, null when connected
        public string defender_disconnected_at;
        public string forfeited_by;
        public string session_started_at;
        public string session_expires_at;

        // Sprint 6 — Full Combat System result fields. Null/0 until the
        // battle has actually been resolved (status becomes "resolved").
        public string winner_id;
        public string loser_id;
        public int duration_seconds;

        // Sprint 6 final security correction — host-signing material.
        // Attacker-only, challenge-response-only. See class doc comment.
        public string host_authority_secret;
        public string match_nonce;
        public string rules_version;
    }

    [Serializable]
    public class ChallengeRequestPayload
    {
        public string defender_id;
        public ChallengeLocationPayload location;
    }

    [Serializable]
    public class ChallengeLocationPayload
    {
        public double lat;
        public double lng;
    }

    /// <summary>
    /// The signed authoritative battle-result payload — mirrors the
    /// backend's canonicalizeResult field order exactly
    /// (battleResultSignature.js), which is what the signature actually
    /// covers. Only ever built and signed by the Photon Host Mode host
    /// (the attacker's client, by the established backend convention),
    /// using the host_authority_secret/match_nonce it alone received on
    /// the challenge response.
    ///
    /// Sprint 6 final security correction: this REPLACES the old
    /// caller-relative BattleResolveRequestPayload ("outcome" from the
    /// submitting client's own perspective). Outcome is now absolute
    /// ("attacker_win" | "defender_win" | "draw") since this payload
    /// names both participants explicitly and is verified, not trusted,
    /// server-side.
    /// </summary>
    [Serializable]
    public class BattleResultPayload
    {
        public string battle_id;
        public string room_name;
        public string rules_version;
        public string match_nonce;
        public int event_seq;
        public string attacker_id;
        public string defender_id;
        public int attacker_final_health;
        public int defender_final_health;
        public string outcome; // "attacker_win" | "defender_win" | "draw"
        public int duration_seconds;
        public string issued_at; // ISO 8601 UTC
    }

    /// <summary>
    /// POST /battle/{battleId}/resolve request body — the signed result
    /// plus its signature. Only the host ever sends this; the non-host
    /// client polls GET /battle/{battleId} instead (see
    /// BattleManager.cs's PollForResolutionAsync).
    /// </summary>
    [Serializable]
    public class BattleResolveRequestPayload
    {
        public BattleResultPayload result;
        public string signature;
    }

    /// <summary>
    /// POST /battle/{battleId}/resolve response body.
    ///
    /// Sprint 6 final security correction: `result` is now the absolute
    /// outcome string ("attacker_win" | "defender_win" | "draw"), matching
    /// BattleResultPayload.outcome, rather than the old caller-relative
    /// "win"/"loss"/"draw". For a Draw, winner_influence/loser_influence/
    /// loser_controlled_until are sent by the server as JSON null (no
    /// Influence or Control change occurred) — JsonUtility has no
    /// nullable-int support, so winner_influence/loser_influence simply
    /// keep their C# default (0) in that case; callers MUST branch on
    /// `result == "draw"` first and never read those two fields for a
    /// draw, exactly as ResultController.ShowResult does.
    ///
    /// Sprint 7 (Influence + Control): winner_rank/loser_rank are the
    /// server-computed Rank strings (see backend config/rankTiers.js —
    /// FLAGGED ASSUMPTION, not an approved GDD tier table) that go with
    /// the new Influence totals above. Same draw caveat applies: for a
    /// draw these are sent as JSON null and simply keep their C# default
    /// (empty string) — never read them without checking `result` first.
    /// </summary>
    [Serializable]
    public class BattleResolveResponseData
    {
        public string battle_id;
        public string result; // "attacker_win" | "defender_win" | "draw"
        public int winner_influence;
        public string winner_rank;
        public int loser_influence;
        public string loser_rank;
        public string loser_controlled_until;
    }

    /// <summary>
    /// Static, in-memory holder for the locally active battle session —
    /// mirrors the PlayerSession pattern (Core/PlayerSession.cs). Populated
    /// only from server responses; never a source of truth on its own.
    /// </summary>
    public static class BattleSession
    {
        public static BattleSessionData Current { get; private set; }
        public static bool HasActiveSession => Current != null && !string.IsNullOrEmpty(Current.battle_id);

        public static event Action<BattleSessionData> OnSessionUpdated;
        public static event Action OnSessionEnded;

        public static void UpdateFromServer(BattleSessionData serverData)
        {
            if (serverData == null)
            {
                Debug.LogError("[BattleSession] Attempted to update session with a null payload.");
                return;
            }

            Current = serverData;
            OnSessionUpdated?.Invoke(Current);

            if (serverData.status != "in_progress")
            {
                OnSessionEnded?.Invoke();
            }
        }

        public static void Clear()
        {
            Current = null;
            OnSessionEnded?.Invoke();
        }
    }
}
