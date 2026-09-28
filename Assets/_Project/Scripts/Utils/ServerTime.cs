using System;
using System.Globalization;

namespace Nfouz.Utils
{
    /// <summary>
    /// Sprint 7 continuation — single source of "now" for every
    /// Controlled/Protected countdown display, so "server time must be
    /// authoritative; local countdown is display-only" means what it says:
    /// a countdown's remaining time is always recomputed as
    /// (serverIssuedDeadline - ServerTime.Now()), never by decrementing a
    /// client-side timer with Time.deltaTime — the latter can drift
    /// arbitrarily over a long Controlled/Protected window (backgrounded
    /// app, paused Time.timeScale, frame hitches), while recomputing
    /// against wall-clock time every tick cannot.
    ///
    /// SCOPE / HONEST LIMITATION: `controlled_until` and `protected_until`
    /// are themselves already server-authoritative absolute timestamps
    /// (set once by battle.service.js#resolveBattle /
    /// player.repository.js#releaseControlWithProtection and never
    /// recomputed client-side) — that part of "authoritative" is real. The
    /// remaining gap is DEVICE CLOCK SKEW: this class has no dedicated
    /// time-sync endpoint to correct for a device whose local clock is
    /// simply wrong, because no such endpoint exists in the backend today
    /// and none was asked for as part of this pass. `_serverOffset`
    /// defaults to zero (i.e. trusts the device's own UTC clock) but
    /// `SyncFromServerTimestamp` is exposed and ready to be wired up the
    /// moment any server response starts carrying its own current-time
    /// field (a `server_time` on /auth/me would be the natural place) —
    /// at that point every countdown display in this file already reads
    /// through ServerTime.Now() and needs no further change to become
    /// fully clock-skew-corrected.
    /// </summary>
    public static class ServerTime
    {
        private static TimeSpan _serverOffset = TimeSpan.Zero;
        private static bool _hasSynced;

        /// <summary>True once at least one real server timestamp has been
        /// used to compute an offset — false means Now() is currently
        /// just the device's own UTC clock (see class doc comment).</summary>
        public static bool HasSynced => _hasSynced;

        /// <summary>
        /// Best-effort "now", corrected by whatever server/local offset has
        /// been learned so far (zero until SyncFromServerTimestamp is
        /// called at least once — see class doc comment). Every
        /// Controlled/Protected countdown display in this project reads
        /// remaining time through this method, never through
        /// DateTime.UtcNow directly, so wiring up real sync later requires
        /// no further call-site changes.
        /// </summary>
        public static DateTime Now()
        {
            return DateTime.UtcNow + _serverOffset;
        }

        /// <summary>
        /// Learns (or refines) the local/server clock offset from one
        /// authoritative server timestamp. Safe to call repeatedly — each
        /// call simply overwrites the previous offset with a fresher
        /// measurement, the same way a real NTP-style sync would.
        /// </summary>
        public static void SyncFromServerTimestamp(DateTime serverUtcNow)
        {
            _serverOffset = serverUtcNow.ToUniversalTime() - DateTime.UtcNow;
            _hasSynced = true;
        }

        /// <summary>
        /// Parses one of the ISO 8601 UTC timestamp strings this project
        /// passes around (controlled_until / protected_until / etc.) using
        /// a fixed round-trip format, returning null for an empty/invalid
        /// string rather than throwing — every countdown display in this
        /// file treats a null deadline as "not currently active" instead
        /// of crashing on a malformed payload.
        /// </summary>
        public static DateTime? ParseIsoUtc(string isoUtc)
        {
            if (string.IsNullOrEmpty(isoUtc))
            {
                return null;
            }

            if (DateTime.TryParse(isoUtc, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var parsed))
            {
                return parsed;
            }

            return null;
        }

        /// <summary>
        /// Seconds remaining until `deadlineUtc`, floored at 0 — never
        /// negative, so callers can drive a countdown label or a
        /// progress-bar fill fraction directly off this value without an
        /// extra Mathf.Max(0, ...) at every call site.
        /// </summary>
        public static float SecondsRemaining(DateTime? deadlineUtc)
        {
            if (deadlineUtc == null)
            {
                return 0f;
            }

            var remaining = (float)(deadlineUtc.Value - Now()).TotalSeconds;
            return remaining > 0f ? remaining : 0f;
        }
    }
}
