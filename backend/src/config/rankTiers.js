'use strict';

/**
 * Sprint 7 (Influence + Control) — Influence-driven Rank tiers.
 *
 * Sprint 7 continuation: these are now the EXACT thresholds from the
 * latest detailed NFOUZ GDD, replacing the previous pass's flagged
 * placeholder tiers ('Operative'/150, 'Enforcer'/300, 'Warlord'/500,
 * 'Overlord'/800) entirely. No assumed values remain in this file.
 *
 * Ordered ascending by minInfluence; `rankForInfluence` picks the
 * highest tier the player's current Influence still qualifies for, so a
 * rank recomputation naturally moves both up AND down as Influence
 * changes — there is no separate "demotion" code path.
 */
const RANK_TIERS = Object.freeze([
  Object.freeze({ name: 'Citizen', minInfluence: 0 }),
  Object.freeze({ name: 'Influencer', minInfluence: 300 }),
  Object.freeze({ name: 'Commander', minInfluence: 750 }),
  Object.freeze({ name: 'Leader', minInfluence: 1500 }),
  Object.freeze({ name: 'City Ruler', minInfluence: 3000 }),
  Object.freeze({ name: 'Country Ruler', minInfluence: 6000 }),
  Object.freeze({ name: 'Continent Lord', minInfluence: 12000 }),
  Object.freeze({ name: 'World Emperor', minInfluence: 24000 }),
]);

/**
 * Pure lookup — the same table read by buildRankCaseSql below, exposed
 * separately so anything that already has an influence value in hand
 * (tests, future non-SQL callers) doesn't need to touch the database to
 * find out what rank it maps to.
 */
function rankForInfluence(influence) {
  let rank = RANK_TIERS[0].name;
  for (const tier of RANK_TIERS) {
    if (influence >= tier.minInfluence) {
      rank = tier.name;
    } else {
      break;
    }
  }
  return rank;
}

/**
 * Builds a SQL `CASE` expression (evaluated highest threshold first) that
 * computes the same mapping as rankForInfluence, so a single UPDATE can
 * set `rank` from the new Influence value in the same round trip as the
 * Influence write itself — see player.repository.js#adjustInfluence.
 * `influenceExpr` must be a fixed SQL expression built by this codebase
 * (never raw user input) since it is interpolated directly.
 */
function buildRankCaseSql(influenceExpr) {
  const descending = [...RANK_TIERS].sort((a, b) => b.minInfluence - a.minInfluence);
  const whens = descending
    .map((tier) => `WHEN ${influenceExpr} >= ${tier.minInfluence} THEN '${tier.name}'`)
    .join('\n      ');
  return `CASE\n      ${whens}\n      ELSE '${RANK_TIERS[0].name}'\n    END`;
}

module.exports = { RANK_TIERS, rankForInfluence, buildRankCaseSql };
