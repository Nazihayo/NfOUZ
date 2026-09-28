using System;
using Nfouz.Utils;

namespace Nfouz.Core
{
    /// <summary>
    /// Sprint 7 continuation — single, static source of the LOCAL player's
    /// live Control/Protection state, computed from PlayerSession exactly
    /// the way the server itself computes it (player.repository.js's
    /// isControlActive/isProtected: a stored flag plus a deadline, both
    /// re-checked against "now" on every read, never trusted as a stale
    /// boolean). Every HUD element that cares (status icon, countdown
    /// display, ChallengeInteractionController's local-player gate) reads
    /// through this class instead of re-deriving the same time comparison
    /// independently against PlayerSession.Current directly.
    ///
    /// Not a MonoBehaviour — same reasoning as PlayerSession/
    /// InfluenceManager. A MonoBehaviour countdown display still needs its
    /// own Update() to refresh a label every frame (this class holds no
    /// per-frame ticking of its own), but the VALUE it reads (IsControlled,
    /// RemainingControlSeconds) is always freshly computed against
    /// ServerTime.Now() on each call, never cached.
    /// </summary>
    public static class ControlStateManager
    {
        public static event Action<bool> OnControlChanged; // param: newIsControlled
        public static event Action<bool> OnProtectionChanged; // param: newIsProtected

        private static bool _subscribed;
        private static bool _lastKnownControlled;
        private static bool _lastKnownProtected;

        /// <summary>Starts observing PlayerSession for Control/Protection
        /// transitions. Safe to call more than once — see
        /// InfluenceManager.Initialize's identical contract.</summary>
        public static void Initialize()
        {
            if (_subscribed)
            {
                return;
            }

            _subscribed = true;
            if (PlayerSession.HasActiveSession)
            {
                _lastKnownControlled = IsControlled;
                _lastKnownProtected = IsProtected;
            }

            PlayerSession.OnSessionUpdated += HandleSessionUpdated;
        }

        private static void HandleSessionUpdated(PlayerSessionData data)
        {
            var nowControlled = IsControlled;
            if (nowControlled != _lastKnownControlled)
            {
                _lastKnownControlled = nowControlled;
                OnControlChanged?.Invoke(nowControlled);
            }

            var nowProtected = IsProtected;
            if (nowProtected != _lastKnownProtected)
            {
                _lastKnownProtected = nowProtected;
                OnProtectionChanged?.Invoke(nowProtected);
            }
        }

        /// <summary>
        /// True only while PlayerSession's stored IsControlled flag AND its
        /// ControlledUntilIso deadline (parsed against ServerTime.Now(), not
        /// merely "is the flag true") both say so — mirrors
        /// player.repository.js#isControlActive's staleness caveat: the
        /// stored flag alone can be true well after the real window ended,
        /// until the next server write catches up (clearExpiredControl).
        /// </summary>
        public static bool IsControlled
        {
            get
            {
                if (!PlayerSession.HasActiveSession || !PlayerSession.Current.IsControlled)
                {
                    return false;
                }

                var deadline = ServerTime.ParseIsoUtc(PlayerSession.Current.ControlledUntilIso);
                return deadline != null && deadline.Value > ServerTime.Now();
            }
        }

        /// <summary>Mirrors IsControlled's staleness handling for
        /// Protection — see player.repository.js#isProtected.</summary>
        public static bool IsProtected
        {
            get
            {
                if (!PlayerSession.HasActiveSession || !PlayerSession.Current.IsProtected)
                {
                    return false;
                }

                var deadline = ServerTime.ParseIsoUtc(PlayerSession.Current.ProtectedUntilIso);
                return deadline != null && deadline.Value > ServerTime.Now();
            }
        }

        /// <summary>Seconds remaining in the current Control window, 0 if
        /// not currently Controlled. Local-countdown-display-only per the
        /// GDD — see ServerTime's class doc comment for what "authoritative"
        /// means here.</summary>
        public static float RemainingControlSeconds()
        {
            if (!IsControlled)
            {
                return 0f;
            }

            return ServerTime.SecondsRemaining(ServerTime.ParseIsoUtc(PlayerSession.Current.ControlledUntilIso));
        }

        /// <summary>Seconds remaining in the current Protection window, 0
        /// if not currently Protected.</summary>
        public static float RemainingProtectionSeconds()
        {
            if (!IsProtected)
            {
                return 0f;
            }

            return ServerTime.SecondsRemaining(ServerTime.ParseIsoUtc(PlayerSession.Current.ProtectedUntilIso));
        }

        public static string ControllerId => PlayerSession.HasActiveSession ? PlayerSession.Current.ControllerId : null;
    }
}
