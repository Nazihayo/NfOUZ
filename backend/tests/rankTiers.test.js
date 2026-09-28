'use strict';

const { RANK_TIERS, rankForInfluence, buildRankCaseSql } = require('../src/config/rankTiers');

/**
 * Sprint 7 (Influence + Control), continuation pass: rankTiers.js is pure
 * — no db, no mocking required. The tier thresholds/names are now the
 * EXACT values from the latest detailed NFOUZ GDD (no more flagged
 * assumptions) — this file both pins down those exact literal numbers
 * AND exercises the generic boundary logic against whatever RANK_TIERS
 * currently holds, so a future GDD revision only needs the literal table
 * below updated.
 */
describe('rankTiers — exact GDD-authoritative thresholds', () => {
  it('matches the exact 8-tier table from the latest detailed NFOUZ GDD', () => {
    const cases = [
      [0, 'Citizen'], [299, 'Citizen'],
      [300, 'Influencer'], [749, 'Influencer'],
      [750, 'Commander'], [1499, 'Commander'],
      [1500, 'Leader'], [2999, 'Leader'],
      [3000, 'City Ruler'], [5999, 'City Ruler'],
      [6000, 'Country Ruler'], [11999, 'Country Ruler'],
      [12000, 'Continent Lord'], [23999, 'Continent Lord'],
      [24000, 'World Emperor'], [999999999, 'World Emperor'],
    ];
    for (const [influence, expectedRank] of cases) {
      expect(rankForInfluence(influence)).toBe(expectedRank);
    }
  });

  it('promotes upward the instant Influence reaches a boundary', () => {
    expect(rankForInfluence(299)).toBe('Citizen');
    expect(rankForInfluence(300)).toBe('Influencer');
  });

  it('demotes downward the instant Influence drops below a boundary (same code path as promotion)', () => {
    expect(rankForInfluence(750)).toBe('Commander');
    expect(rankForInfluence(749)).toBe('Influencer');
  });
});

describe('rankTiers — rankForInfluence', () => {
  it('maps 0 to the lowest tier', () => {
    expect(rankForInfluence(0)).toBe('Citizen');
  });

  it('is inclusive at each tier boundary', () => {
    for (const tier of RANK_TIERS) {
      expect(rankForInfluence(tier.minInfluence)).toBe(tier.name);
    }
  });

  it('stays on the lower tier one point below a boundary', () => {
    const sorted = [...RANK_TIERS].sort((a, b) => a.minInfluence - b.minInfluence);
    for (let i = 1; i < sorted.length; i++) {
      expect(rankForInfluence(sorted[i].minInfluence - 1)).toBe(sorted[i - 1].name);
    }
  });

  it('has no upper bound — a very large Influence total stays at the top tier', () => {
    const top = [...RANK_TIERS].sort((a, b) => b.minInfluence - a.minInfluence)[0];
    expect(rankForInfluence(1000000)).toBe(top.name);
  });
});

describe('rankTiers — buildRankCaseSql', () => {
  it('produces a CASE with one WHEN branch per tier, highest threshold first', () => {
    const sql = buildRankCaseSql('influence_val');
    const descending = [...RANK_TIERS].sort((a, b) => b.minInfluence - a.minInfluence);

    let lastIndex = -1;
    for (const tier of descending) {
      const needle = `WHEN influence_val >= ${tier.minInfluence} THEN '${tier.name}'`;
      const index = sql.indexOf(needle);
      expect(index).toBeGreaterThan(-1);
      expect(index).toBeGreaterThan(lastIndex); // proves descending order in the generated SQL
      lastIndex = index;
    }

    expect(sql).toMatch(/ELSE 'Citizen'/);
  });
});
