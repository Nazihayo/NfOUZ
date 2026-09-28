namespace Nfouz.Map
{
    /// <summary>
    /// Sprint 7 continuation — "MainMap refresh after battle resolution."
    /// A tiny static flag, not an event bus: ResultController (Combat
    /// scene) sets it right before returning to MainMap, and
    /// NearbyPlayersTracker (MainMap scene) consumes it once on enable.
    /// Needed because the two live in different scenes with no direct
    /// reference to each other, and because NearbyPlayersTracker's normal
    /// poll interval (queryIntervalSeconds, default 6s) is otherwise too
    /// slow to reflect a state change that JUST happened server-side — the
    /// local player's own new is_controlled/rank (already folded into
    /// PlayerSession directly by ResultController) and, more importantly,
    /// every OTHER nearby player's is_controlled/is_protected, which this
    /// class has no other way to learn about except by asking the server
    /// again immediately.
    /// </summary>
    public static class MainMapRefreshRequest
    {
        private static bool _pending;

        public static void RequestImmediateRefresh()
        {
            _pending = true;
        }

        /// <summary>Returns whether a refresh was requested and clears the
        /// flag — a NearbyPlayersTracker enabling twice in a row (e.g. a
        /// domain reload in the editor) only forces one extra immediate
        /// poll, not one per enable.</summary>
        public static bool ConsumeRefreshRequest()
        {
            if (!_pending)
            {
                return false;
            }

            _pending = false;
            return true;
        }
    }
}
