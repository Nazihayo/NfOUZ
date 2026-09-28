'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  checkConnection: jest.fn(),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
}));

const db = require('../src/config/database');
const playerRepo = require('../src/repositories/player.repository');

describe('player.repository — findWithinBoundingBox (Sprint 4 visibility rules)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({ rows: [] });
  });

  it('excludes the requesting player via the player_id <> $5 clause', async () => {
    const box = { minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 };
    const onlineSince = new Date();

    await playerRepo.findWithinBoundingBox(box, 'self-id', onlineSince);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/player_id\s*<>\s*\$5/);
    expect(params[4]).toBe('self-id');
  });

  it('filters on is_visible = TRUE', async () => {
    await playerRepo.findWithinBoundingBox({ minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 }, 'self-id', new Date());

    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/is_visible\s*=\s*TRUE/);
  });

  it('filters on last_location_at >= the online-since parameter', async () => {
    const onlineSince = new Date('2026-01-01T00:00:00Z');

    await playerRepo.findWithinBoundingBox({ minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 }, 'self-id', onlineSince);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/last_location_at\s*>=\s*\$6/);
    expect(params[5]).toBe(onlineSince);
  });

  it('excludes players with a blocked friendship in either direction', async () => {
    await playerRepo.findWithinBoundingBox({ minLat: 1, maxLat: 2, minLng: 3, maxLng: 4 }, 'self-id', new Date());

    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).toMatch(/status = 'blocked'/);
    expect(sql).toMatch(/f\.player_id = \$5 AND f\.friend_id = p\.player_id/);
    expect(sql).toMatch(/f\.player_id = p\.player_id AND f\.friend_id = \$5/);
  });

  it('passes the bounding box coordinates as the first four parameters', async () => {
    const box = { minLat: 10, maxLat: 20, minLng: 30, maxLng: 40 };

    await playerRepo.findWithinBoundingBox(box, 'self-id', new Date());

    const [, params] = db.query.mock.calls[0];
    expect(params.slice(0, 4)).toEqual([10, 20, 30, 40]);
  });
});

describe('player.repository — updateLocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes lat/lng/timestamp for the given player_id and returns the updated row', async () => {
    const returnedRow = { player_id: 'p-1', last_lat: 1.23, last_lng: 4.56, last_location_at: new Date() };
    db.query.mockResolvedValue({ rows: [returnedRow] });

    const result = await playerRepo.updateLocation('p-1', { lat: 1.23, lng: 4.56, timestamp: returnedRow.last_location_at });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE players/);
    expect(params).toEqual([1.23, 4.56, returnedRow.last_location_at, 'p-1']);
    expect(result).toEqual(returnedRow);
  });
});

describe('player.repository — adjustInfluence (Sprint 6 Influence updates)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies a positive delta (win) and floors at 0 via GREATEST', async () => {
    db.query.mockResolvedValue({ rows: [{ player_id: 'p-1', influence: 115 }] });

    const result = await playerRepo.adjustInfluence('p-1', 15);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE players/);
    expect(sql).toMatch(/influence = GREATEST\(0, influence \+ \$1\)/);
    expect(params).toEqual([15, 'p-1']);
    expect(result).toEqual({ player_id: 'p-1', influence: 115 });
  });

  it('applies a negative delta (loss) using the same GREATEST(0, ...) floor', async () => {
    db.query.mockResolvedValue({ rows: [{ player_id: 'p-2', influence: 0 }] });

    const result = await playerRepo.adjustInfluence('p-2', -10);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/influence = GREATEST\(0, influence \+ \$1\)/);
    expect(params).toEqual([-10, 'p-2']);
    // The floor logic itself runs in SQL (not JS), so this only proves
    // the repository passes the raw negative delta through unmodified —
    // the mocked return value simulates what GREATEST(0, ...) would
    // produce for a player whose influence would otherwise go negative.
    expect(result.influence).toBe(0);
  });
});

describe('player.repository — adjustInfluence also computes rank (Sprint 7 Influence + Control)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('issues a single CTE-based UPDATE that sets influence, rank, and returns applied_delta', async () => {
    db.query.mockResolvedValue({ rows: [{ player_id: 'p-1', influence: 800, rank: 'City Ruler', applied_delta: 700 }] });

    const result = await playerRepo.adjustInfluence('p-1', 700);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/WITH before AS/);
    expect(sql).toMatch(/UPDATE players/);
    expect(sql).toMatch(/rank = CASE/);
    expect(sql).toMatch(/ELSE 'Citizen'/);
    expect(sql).toMatch(/applied_delta/);
    expect(params).toEqual([700, 'p-1']);
    expect(result).toEqual({ player_id: 'p-1', influence: 800, rank: 'City Ruler', applied_delta: 700 });
  });

  it('still returns exactly one row from a single query (no second round trip for rank)', async () => {
    const txClient = { query: jest.fn().mockResolvedValue({ rows: [{ player_id: 'p-1', influence: 115, rank: 'Citizen', applied_delta: 15 }] }) };

    await playerRepo.adjustInfluence('p-1', 15, txClient);

    expect(txClient.query).toHaveBeenCalledTimes(1);
  });

  it('applied_delta reflects the ACTUAL change, distinct from the nominal delta requested, once the floor clips it', async () => {
    // A -10 loss against 5 Influence only actually applies -5.
    db.query.mockResolvedValue({ rows: [{ player_id: 'p-2', influence: 0, rank: 'Citizen', applied_delta: -5 }] });

    const result = await playerRepo.adjustInfluence('p-2', -10);

    const [, params] = db.query.mock.calls[0];
    expect(params[0]).toBe(-10); // the nominal delta is still what's passed into the query
    expect(result.applied_delta).toBe(-5); // but the ACTUAL change is what's returned for logging
    expect(result.influence).toBe(0);
  });
});

describe('player.repository — isProtected (Sprint 7 continuation, pure)', () => {
  it('is true when protected_until is still in the future', () => {
    const future = new Date(Date.now() + 60000);
    expect(playerRepo.isProtected({ protected_until: future })).toBe(true);
  });

  it('is false once protected_until has passed', () => {
    const past = new Date(Date.now() - 1000);
    expect(playerRepo.isProtected({ protected_until: past })).toBe(false);
  });

  it('is false when protected_until is null (e.g. after plain Control timer expiry, which grants no Protection)', () => {
    expect(playerRepo.isProtected({ protected_until: null })).toBe(false);
  });

  it('is false for a null/undefined player row', () => {
    expect(playerRepo.isProtected(null)).toBe(false);
    expect(playerRepo.isProtected(undefined)).toBe(false);
  });
});

describe('player.repository — applyIncomingControl (Sprint 7 continuation)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('unconditionally overwrites Control state — never stacks or extends — and clears any existing Protection', async () => {
    const controlledUntil = new Date(Date.now() + 120 * 60 * 1000);
    db.query.mockResolvedValue({
      rows: [{ player_id: 'p-1', is_controlled: true, controller_id: 'winner-1', controlled_until: controlledUntil, controlled_since: new Date() }],
    });

    const result = await playerRepo.applyIncomingControl('p-1', 'winner-1', controlledUntil);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/is_controlled = TRUE/);
    expect(sql).toMatch(/controller_id = \$1/);
    expect(sql).toMatch(/controlled_since = now\(\)/);
    expect(sql).toMatch(/protected_until = NULL/);
    expect(params).toEqual(['winner-1', controlledUntil, 'p-1']);
    expect(result.controller_id).toBe('winner-1');
  });
});

describe('player.repository — releaseOutgoingControl (Sprint 7 continuation — controller-loses cascade)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('releases every player whose controller_id matches the given controller, before that controller\'s own incoming control is applied', async () => {
    db.query.mockResolvedValue({ rows: [{ player_id: 'thrall-1' }, { player_id: 'thrall-2' }] });

    const result = await playerRepo.releaseOutgoingControl('loser-1');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/WHERE controller_id = \$1/);
    expect(sql).toMatch(/is_controlled = FALSE/);
    expect(params).toEqual(['loser-1']);
    expect(result).toHaveLength(2);
  });
});

describe('player.repository — recordRankUnlock (Sprint 7 continuation — add-only cosmetic ledger)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('inserts with ON CONFLICT DO NOTHING so a re-reached rank is a harmless no-op', async () => {
    db.query.mockResolvedValue({ rows: [] }); // conflict -> no row returned

    const result = await playerRepo.recordRankUnlock('p-1', 'Commander');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO player_rank_unlocks/);
    expect(sql).toMatch(/ON CONFLICT \(player_id, rank_name\) DO NOTHING/);
    expect(params).toEqual(['p-1', 'Commander']);
    expect(result).toBeNull(); // already unlocked previously — never deleted or overwritten
  });
});

describe('player.repository — releaseControlWithProtection (Sprint 7 continuation — rescue/voluntary/admin release)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears Control and grants Protection in the same write, and explicitly closes the control_relationships row (Sprint 8 correction)', async () => {
    const protectedUntil = new Date(Date.now() + 30 * 60 * 1000);
    db.query.mockResolvedValue({ rows: [{ player_id: 'p-1', is_controlled: false, protected_until: protectedUntil }] });

    const result = await playerRepo.releaseControlWithProtection('p-1', protectedUntil, 'rescue');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/is_controlled = FALSE/);
    expect(sql).toMatch(/protected_until = \$1/);
    expect(params).toEqual([protectedUntil, 'p-1']);
    expect(result.protected_until).toEqual(protectedUntil);

    const [relSql, relParams] = db.query.mock.calls[1];
    expect(relSql).toMatch(/UPDATE control_relationships/);
    expect(relSql).toMatch(/status = 'ended'/);
    expect(relParams).toEqual(['p-1', 'rescue']);
  });

  it('does not touch control_relationships when the players-table write matched no row', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await playerRepo.releaseControlWithProtection('p-missing', new Date(), 'rescue');

    expect(result).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe('player.repository — adjustCredits (Sprint 7 continuation — Control economy foundation)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('floors at 0 via the same GREATEST pattern as adjustInfluence — never creates debt', async () => {
    db.query.mockResolvedValue({ rows: [{ player_id: 'p-1', credits: 0 }] });

    const result = await playerRepo.adjustCredits('p-1', -50);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/credits = GREATEST\(0, credits \+ \$1\)/);
    expect(params).toEqual([-50, 'p-1']);
    expect(result.credits).toBe(0);
  });
});

describe('player.repository — isControlActive (Sprint 7 Influence + Control, pure)', () => {
  it('is true when is_controlled and controlled_until is still in the future', () => {
    const future = new Date(Date.now() + 60000);
    expect(playerRepo.isControlActive({ is_controlled: true, controlled_until: future })).toBe(true);
  });

  it('is false once controlled_until has passed, even if is_controlled is still stored as true', () => {
    const past = new Date(Date.now() - 1000);
    expect(playerRepo.isControlActive({ is_controlled: true, controlled_until: past })).toBe(false);
  });

  it('is false when is_controlled is false, regardless of controlled_until', () => {
    const future = new Date(Date.now() + 60000);
    expect(playerRepo.isControlActive({ is_controlled: false, controlled_until: future })).toBe(false);
  });

  it('is false when controlled_until is null', () => {
    expect(playerRepo.isControlActive({ is_controlled: true, controlled_until: null })).toBe(false);
  });

  it('is false for a null/undefined player row', () => {
    expect(playerRepo.isControlActive(null)).toBe(false);
    expect(playerRepo.isControlActive(undefined)).toBe(false);
  });

  it('accepts an injected `now` for deterministic boundary testing', () => {
    const controlledUntil = new Date('2026-01-01T12:00:00.000Z');
    const justBefore = new Date('2026-01-01T11:59:59.999Z');
    const exactBoundary = new Date('2026-01-01T12:00:00.000Z');
    expect(playerRepo.isControlActive({ is_controlled: true, controlled_until: controlledUntil }, justBefore)).toBe(true);
    expect(playerRepo.isControlActive({ is_controlled: true, controlled_until: controlledUntil }, exactBoundary)).toBe(false);
  });
});

describe('player.repository — clearExpiredControl (Sprint 7 Influence + Control)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('only targets a row that is both is_controlled = TRUE and past its own controlled_until', async () => {
    db.query.mockResolvedValue({ rows: [{ player_id: 'p-1', is_controlled: false, controlled_until: null }] });

    const result = await playerRepo.clearExpiredControl('p-1');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/SET is_controlled = FALSE, controlled_until = NULL/);
    expect(sql).toMatch(/WHERE player_id = \$1 AND is_controlled = TRUE AND controlled_until <= now\(\)/);
    expect(params).toEqual(['p-1']);
    expect(result.is_controlled).toBe(false);
  });

  it('runs on the provided executor instead of the shared pool when given', async () => {
    const txClient = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    await playerRepo.clearExpiredControl('p-1', txClient);

    expect(txClient.query).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('Sprint 8 correction — explicitly closes the control_relationships row (reason: timer_expiry) whenever the self-heal actually fires', async () => {
    db.query.mockResolvedValue({ rows: [{ player_id: 'p-1', is_controlled: false, controlled_until: null }] });

    await playerRepo.clearExpiredControl('p-1');

    expect(db.query).toHaveBeenCalledTimes(2);
    const [relSql, relParams] = db.query.mock.calls[1];
    expect(relSql).toMatch(/UPDATE control_relationships/);
    expect(relParams).toEqual(['p-1', 'timer_expiry']);
  });

  it('Sprint 8 correction — does not touch control_relationships when nothing was actually expired', async () => {
    const txClient = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    await playerRepo.clearExpiredControl('p-1', txClient);

    expect(txClient.query).toHaveBeenCalledTimes(1); // only the players UPDATE — no expiry actually happened
  });
});

describe('player.repository — Sprint 7 continuation: optional executor (transaction client) param', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adjustInfluence runs on the provided executor instead of the shared pool when given', async () => {
    const txClient = { query: jest.fn().mockResolvedValue({ rows: [{ player_id: 'p-1', influence: 115, applied_delta: 15 }] }) };

    const result = await playerRepo.adjustInfluence('p-1', 15, txClient);

    expect(txClient.query).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
    expect(result.influence).toBe(115);
  });

  it('applyIncomingControl runs on the provided executor instead of the shared pool when given', async () => {
    const controlledUntil = new Date();
    const txClient = { query: jest.fn().mockResolvedValue({ rows: [{ player_id: 'p-1', is_controlled: true, controller_id: 'w-1', controlled_until: controlledUntil }] }) };

    const result = await playerRepo.applyIncomingControl('p-1', 'w-1', controlledUntil, txClient);

    expect(txClient.query).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
    expect(result.is_controlled).toBe(true);
  });

  it('releaseOutgoingControl runs on the provided executor instead of the shared pool when given', async () => {
    const txClient = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    await playerRepo.releaseOutgoingControl('w-1', txClient);

    expect(txClient.query).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });
});
