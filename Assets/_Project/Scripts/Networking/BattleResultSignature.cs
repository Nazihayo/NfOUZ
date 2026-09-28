using System;
using System.Security.Cryptography;
using System.Text;

namespace Nfouz.Networking
{
    /// <summary>
    /// Client-side mirror of backend/src/utils/battleResultSignature.js.
    /// Only the Photon Host Mode host (the attacker's client, by the
    /// established backend convention — see battle.service.js's header
    /// doc comment) ever calls Sign: it is the one client that receives
    /// host_authority_secret/match_nonce, on the challenge response.
    ///
    /// The canonicalization here MUST exactly match the backend's
    /// canonicalizeResult field order and formatting, since the backend
    /// re-derives the same string and compares HMACs — any drift (a
    /// reordered field, a different number format) produces a signature
    /// the backend will reject as INVALID_SIGNATURE even though the
    /// underlying data is correct.
    ///
    /// Sprint 6 final security correction: this is a NEW file — the
    /// Unity side had no signing concept before this pass. It proves the
    /// result came from whichever client holds the host role and wasn't
    /// tampered with by the other client; it does NOT prove the host's
    /// own health/damage arithmetic was honest. This is the Host Mode
    /// Alpha "limited anti-cheat" the correction instruction asked to be
    /// clearly marked as such — never claimed as full server authority.
    /// </summary>
    public static class BattleResultSignature
    {
        /// <summary>
        /// Builds the exact same pipe-joined canonical string as the
        /// backend's canonicalizeResult — field order and String()-style
        /// number formatting must match exactly.
        /// </summary>
        public static string Canonicalize(BattleResultPayload result)
        {
            return string.Join("|", new[]
            {
                result.battle_id,
                result.room_name,
                result.rules_version,
                result.match_nonce,
                result.event_seq.ToString(),
                result.attacker_id,
                result.defender_id,
                result.attacker_final_health.ToString(),
                result.defender_final_health.ToString(),
                result.outcome,
                result.duration_seconds.ToString(),
                result.issued_at,
            });
        }

        /// <summary>
        /// HMAC-SHA256 of the canonical string, hex-encoded — matches
        /// crypto.createHmac('sha256', secret).update(...).digest('hex')
        /// on the backend exactly.
        /// </summary>
        public static string Sign(BattleResultPayload result, string secret)
        {
            var canonical = Canonicalize(result);
            var keyBytes = Encoding.UTF8.GetBytes(secret);
            var messageBytes = Encoding.UTF8.GetBytes(canonical);

            using (var hmac = new HMACSHA256(keyBytes))
            {
                var hash = hmac.ComputeHash(messageBytes);
                var hex = new StringBuilder(hash.Length * 2);
                foreach (var b in hash)
                {
                    hex.Append(b.ToString("x2"));
                }

                return hex.ToString();
            }
        }
    }
}
