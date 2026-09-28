using System;
using UnityEngine;

namespace Nfouz.Core
{
    /// <summary>
    /// Sprint 7 continuation — thin, static observer over PlayerSession's
    /// Influence/Rank fields. Not a MonoBehaviour (holds no scene-
    /// dependent state, same reasoning as PlayerSession itself) — any
    /// scene component that cares about Influence/rank changes (a HUD
    /// label, a rank-up VFX trigger, ResultController's rank-transition
    /// banner) subscribes to OnInfluenceChanged/OnRankChanged here instead
    /// of each polling PlayerSession.OnSessionUpdated and re-deriving the
    /// same diff independently.
    ///
    /// Never computes Influence or Rank itself — PlayerSession.Current is
    /// always folded from a trusted server response (see PlayerSession's
    /// own doc comment); this class only detects and republishes the
    /// DIFFERENCE between the previous and new session snapshot.
    /// RankCalculator is used only to classify a detected rank change as a
    /// promotion or a demotion for the event payload — never to compute
    /// the rank value itself.
    /// </summary>
    public static class InfluenceManager
    {
        public readonly struct InfluenceChange
        {
            public readonly int PreviousInfluence;
            public readonly int NewInfluence;
            public readonly int Delta;

            public InfluenceChange(int previousInfluence, int newInfluence)
            {
                PreviousInfluence = previousInfluence;
                NewInfluence = newInfluence;
                Delta = newInfluence - previousInfluence;
            }
        }

        public readonly struct RankChange
        {
            public readonly string PreviousRank;
            public readonly string NewRank;
            public readonly bool IsPromotion; // false for a demotion; also false if ranks are equal (never raised in that case)

            public RankChange(string previousRank, string newRank)
            {
                PreviousRank = previousRank;
                NewRank = newRank;
                IsPromotion = RankCalculator.TierIndex(newRank) > RankCalculator.TierIndex(previousRank);
            }
        }

        public static event Action<InfluenceChange> OnInfluenceChanged;
        public static event Action<RankChange> OnRankChanged;

        private static bool _subscribed;
        private static int _lastKnownInfluence;
        private static string _lastKnownRank;

        /// <summary>
        /// Starts observing PlayerSession. Safe to call more than once
        /// (e.g. from multiple scenes' bootstrap code) — subscribes to
        /// PlayerSession.OnSessionUpdated exactly once regardless of how
        /// many times this is called. Call once during app/session
        /// bootstrap (alongside wherever PlayerSession itself is first
        /// populated), not per-scene.
        /// </summary>
        public static void Initialize()
        {
            if (_subscribed)
            {
                return;
            }

            _subscribed = true;
            if (PlayerSession.HasActiveSession)
            {
                _lastKnownInfluence = PlayerSession.Current.Influence;
                _lastKnownRank = PlayerSession.Current.Rank;
            }

            PlayerSession.OnSessionUpdated += HandleSessionUpdated;
        }

        private static void HandleSessionUpdated(PlayerSessionData data)
        {
            if (data == null)
            {
                // Session cleared (e.g. logout) — nothing to diff against
                // next time until a fresh session repopulates both fields.
                _lastKnownInfluence = 0;
                _lastKnownRank = null;
                return;
            }

            if (data.Influence != _lastKnownInfluence)
            {
                var change = new InfluenceChange(_lastKnownInfluence, data.Influence);
                _lastKnownInfluence = data.Influence;
                OnInfluenceChanged?.Invoke(change);
            }

            if (!string.IsNullOrEmpty(data.Rank) && data.Rank != _lastKnownRank)
            {
                if (!string.IsNullOrEmpty(_lastKnownRank))
                {
                    // Only raise a transition event when there WAS a
                    // previous rank to compare against — the very first
                    // session load (e.g. right after registration) is a
                    // baseline, not a promotion or demotion.
                    OnRankChanged?.Invoke(new RankChange(_lastKnownRank, data.Rank));
                }

                _lastKnownRank = data.Rank;
            }
        }

        /// <summary>Influence still needed to reach the next rank tier, or
        /// 0 at the top tier / with no active session.</summary>
        public static int InfluenceToNextRank()
        {
            if (!PlayerSession.HasActiveSession)
            {
                return 0;
            }

            return RankCalculator.InfluenceToNextTier(PlayerSession.Current.Influence);
        }
    }
}
