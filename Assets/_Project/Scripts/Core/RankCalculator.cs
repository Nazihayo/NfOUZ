using System.Collections.Generic;

namespace Nfouz.Core
{
    /// <summary>
    /// Sprint 7 continuation — client-side mirror of the exact GDD-
    /// authoritative Rank tiers computed server-side in
    /// backend/src/config/rankTiers.js. This exists ONLY for client-side
    /// display/prediction (e.g. showing "X Influence to next rank" or a
    /// rank-transition animation the instant a battle result arrives,
    /// before the next full session refresh) — the server's own
    /// `rank`/`winner_rank`/`loser_rank` fields (folded into
    /// PlayerSession by ResultController/SessionBootstrap) remain the only
    /// authoritative source of a player's actual current Rank. If this
    /// table and the server's ever drift apart, the server always wins;
    /// keep the two in sync by hand until a shared config endpoint exists
    /// (same caveat Constants.cs already carries for its own mirrored
    /// values).
    ///
    /// Ordered ascending by MinInfluence, exactly like rankTiers.js — the
    /// same table serves both promotion and demotion, since RankForInfluence
    /// always recomputes from scratch rather than only ever moving up.
    /// </summary>
    public readonly struct RankTier
    {
        public readonly string Name;
        public readonly int MinInfluence;

        public RankTier(string name, int minInfluence)
        {
            Name = name;
            MinInfluence = minInfluence;
        }
    }

    public static class RankCalculator
    {
        public static readonly IReadOnlyList<RankTier> Tiers = new List<RankTier>
        {
            new RankTier("Citizen", 0),
            new RankTier("Influencer", 300),
            new RankTier("Commander", 750),
            new RankTier("Leader", 1500),
            new RankTier("City Ruler", 3000),
            new RankTier("Country Ruler", 6000),
            new RankTier("Continent Lord", 12000),
            new RankTier("World Emperor", 24000),
        }.AsReadOnly();

        /// <summary>
        /// Highest tier whose MinInfluence the given Influence total still
        /// qualifies for — mirrors rankForInfluence's loop exactly (last
        /// match wins, since Tiers is ascending).
        /// </summary>
        public static string RankForInfluence(int influence)
        {
            var rank = Tiers[0].Name;
            foreach (var tier in Tiers)
            {
                if (influence >= tier.MinInfluence)
                {
                    rank = tier.Name;
                }
                else
                {
                    break;
                }
            }

            return rank;
        }

        /// <summary>
        /// The next tier above the given Influence total, or null if
        /// already at (or past) the top tier — used for "X Influence to
        /// next rank" progress UI. Null, not an exception, at the ceiling:
        /// World Emperor has no tier above it to progress toward.
        /// </summary>
        public static RankTier? NextTier(int influence)
        {
            foreach (var tier in Tiers)
            {
                if (influence < tier.MinInfluence)
                {
                    return tier;
                }
            }

            return null;
        }

        /// <summary>
        /// Influence still needed to reach the next tier, or 0 if already
        /// at the top tier (nothing further to progress toward).
        /// </summary>
        public static int InfluenceToNextTier(int influence)
        {
            var next = NextTier(influence);
            return next == null ? 0 : next.Value.MinInfluence - influence;
        }

        /// <summary>Index of a rank's tier, for ordering comparisons (e.g.
        /// "did this rank change count as a promotion or a demotion?") —
        /// returns -1 for an unrecognized rank name rather than throwing.</summary>
        public static int TierIndex(string rankName)
        {
            for (var i = 0; i < Tiers.Count; i++)
            {
                if (Tiers[i].Name == rankName)
                {
                    return i;
                }
            }

            return -1;
        }
    }
}
