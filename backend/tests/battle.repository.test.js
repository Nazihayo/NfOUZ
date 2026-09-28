'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  checkConnection: jest.fn(),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
}));

const db = require('../src/config/database');
const battleRepo = require('../src/repositories/battle.repository');

describe('battle.repository — findActiveBattleForPlayer (duplicate-challenge prevention)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({ rows: [] });
  });

  it('matches the player as either attacker or defender, restricted to in_progress', async () => {
    await battleRepo.findActiveBattleForPlayer('p-1');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/attacker_id = \$1 OR defender_id = \$1/);
    expect(sql).toMatch(/status = 'in_progress'/);
    expect(params).toEqual(['p-1']);
  });
});

describe('battle.repository — createBattle (room creation)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('inserts a new battle row in in_progress status, with an explicit battle_id and battle_{battle_id} room name', async () => {
    const row = { battle_id: 'b-1', status: 'in_progress', photon_room_name: 'battle_b-1' };
    db.query.mockResolvedValue({ rows: [row] });

    const result = await battleRepo.createBattle({
      battleId: 'b-1',
      attackerId: 'a-1',
      defenderId: 'd-1',
      photonRoomName: 'battle_b-1',
      locationLat: 1.1,
      locationLng: 2.2,
      sessionExpiresAt: new Date('2026-01-01T00:01:30Z'),
      hostPlayerId: 'a-1',
      hostAuthoritySecret: 'secret-hex',
      matchNonce: 'nonce-hex',
      rulesVersion: '6.1.0',
    });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO battles/);
    expect(sql).toMatch(/\(battle_id, attacker_id, defender_id, status, photon_room_name/);
    expect(sql).toMatch(/host_player_id, host_authority_secret, match_nonce, rules_version/);
    expect(sql).toMatch(/'in_progress'/);
    expect(params).toEqual([
      'b-1', 'a-1', 'd-1', 'battle_b-1', 1.1, 2.2, new Date('2026-01-01T00:01:30Z'),
      'a-1', 'secret-hex', 'nonce-hex', '6.1.0',
    ]);
    expect(result).toEqual(row);
  });
});

describe('battle.repository — getByPhotonRoomName (room join lookup)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('looks up a battle by its photon_room_name', async () => {
    const row = { battle_id: 'b-1', photon_room_name: 'battle_xyz' };
    db.query.mockResolvedValue({ rows: [row] });

    const result = await battleRepo.getByPhotonRoomName('battle_xyz');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/WHERE photon_room_name = \$1/);
    expect(params).toEqual(['battle_xyz']);
    expect(result).toEqual(row);
  });

  it('returns null when no battle matches the room name', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const result = await battleRepo.getByPhotonRoomName('nonexistent');
    expect(result).toBeNull();
  });
});

describe('battle.repository — cancelBattle (room leave / abandon)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets status to cancelled and ended_at, restricted to in_progress rows', async () => {
    const row = { battle_id: 'b-1', status: 'cancelled' };
    db.query.mockResolvedValue({ rows: [row] });

    const result = await battleRepo.cancelBattle('b-1');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/SET\s+status = 'cancelled', ended_at = now\(\)/);
    expect(sql).toMatch(/WHERE battle_id = \$1 AND status = 'in_progress'/);
    expect(params).toEqual(['b-1']);
    expect(result).toEqual(row);
  });

  it('returns null when the battle is no longer in_progress (no rows updated)', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const result = await battleRepo.cancelBattle('b-1');
    expect(result).toBeNull();
  });
});

describe('battle.repository — recordDisconnect / clearDisconnect (disconnect + reconnect handling)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes the correct columns for the attacker side', async () => {
    db.query.mockResolvedValue({ rows: [{ battle_id: 'b-1' }] });
    const disconnectedAt = new Date();
    const deadline = new Date(disconnectedAt.getTime() + 15000);

    await battleRepo.recordDisconnect('b-1', 'attacker', disconnectedAt, deadline);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/attacker_disconnected_at = \$2/);
    expect(sql).toMatch(/attacker_reconnect_deadline = \$3/);
    expect(params).toEqual(['b-1', disconnectedAt, deadline]);
  });

  it('writes the correct columns for the defender side', async () => {
    db.query.mockResolvedValue({ rows: [{ battle_id: 'b-1' }] });
    const disconnectedAt = new Date();
    const deadline = new Date(disconnectedAt.getTime() + 15000);

    await battleRepo.recordDisconnect('b-1', 'defender', disconnectedAt, deadline);

    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/defender_disconnected_at = \$2/);
    expect(sql).toMatch(/defender_reconnect_deadline = \$3/);
  });

  it('clears both disconnect columns to NULL on reconnect', async () => {
    db.query.mockResolvedValue({ rows: [{ battle_id: 'b-1' }] });

    await battleRepo.clearDisconnect('b-1', 'attacker');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/attacker_disconnected_at = NULL/);
    expect(sql).toMatch(/attacker_reconnect_deadline = NULL/);
    expect(params).toEqual(['b-1']);
  });
});

describe('battle.repository — markForfeited (timeout handling)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets status to forfeited, records forfeited_by, and only affects in_progress rows', async () => {
    const row = { battle_id: 'b-1', status: 'forfeited', forfeited_by: 'p-1' };
    db.query.mockResolvedValue({ rows: [row] });

    const result = await battleRepo.markForfeited('b-1', 'p-1');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/SET\s+status = 'forfeited', forfeited_by = \$2/);
    expect(sql).toMatch(/WHERE battle_id = \$1 AND status = 'in_progress'/);
    expect(params).toEqual(['b-1', 'p-1']);
    expect(result).toEqual(row);
  });
});

describe('battle.repository — resolveBattle (Sprint 6 battle resolve / winner detection persistence)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets status to resolved with winner_id, loser_id, duration_seconds, last_event_seq, and only affects in_progress rows', async () => {
    const row = { battle_id: 'b-1', status: 'resolved', winner_id: 'p-1', loser_id: 'p-2', duration_seconds: 42, last_event_seq: 7 };
    db.query.mockResolvedValue({ rows: [row] });

    const result = await battleRepo.resolveBattle('b-1', { winnerId: 'p-1', loserId: 'p-2', durationSeconds: 42, eventSeq: 7 });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/SET\s+status = \$6, winner_id = \$2, loser_id = \$3/);
    expect(sql).toMatch(/duration_seconds = \$4/);
    expect(sql).toMatch(/last_event_seq = \$5/);
    expect(sql).toMatch(/WHERE battle_id = \$1 AND status = 'in_progress'/);
    // status defaults to 'resolved' when not passed explicitly.
    expect(params).toEqual(['b-1', 'p-1', 'p-2', 42, 7, 'resolved']);
    expect(result).toEqual(row);
  });

  it('returns null (no rows updated) when the battle is no longer in_progress — the idempotency guard', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const result = await battleRepo.resolveBattle('b-1', { winnerId: 'p-1', loserId: 'p-2', durationSeconds: 42, eventSeq: 1 });

    expect(result).toBeNull();
  });

  it('accepts NULL winner_id/loser_id for a Draw', async () => {
    const row = { battle_id: 'b-1', status: 'resolved', winner_id: null, loser_id: null, duration_seconds: 90 };
    db.query.mockResolvedValue({ rows: [row] });

    const result = await battleRepo.resolveBattle('b-1', { winnerId: null, loserId: null, durationSeconds: 90, eventSeq: 3 });

    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual(['b-1', null, null, 90, 3, 'resolved']);
    expect(result.winner_id).toBeNull();
  });

  it('Sprint 6 final gameplay-completion pass: accepts an explicit status of pending_review (Alpha security mode)', async () => {
    const row = { battle_id: 'b-1', status: 'pending_review', winner_id: 'p-1', loser_id: 'p-2', duration_seconds: 1 };
    db.query.mockResolvedValue({ rows: [row] });

    const result = await battleRepo.resolveBattle('b-1', {
      winnerId: 'p-1',
      loserId: 'p-2',
      durationSeconds: 1,
      eventSeq: 1,
      status: 'pending_review',
    });

    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual(['b-1', 'p-1', 'p-2', 1, 1, 'pending_review']);
    expect(result.status).toBe('pending_review');
  });

  it('Sprint 6: runs on the provided executor (transaction client) instead of the shared pool when given', async () => {
    const row = { battle_id: 'b-1', status: 'resolved', winner_id: 'p-1', loser_id: 'p-2', duration_seconds: 42 };
    const txClient = { query: jest.fn().mockResolvedValue({ rows: [row] }) };

    const result = await battleRepo.resolveBattle(
      'b-1',
      { winnerId: 'p-1', loserId: 'p-2', durationSeconds: 42, eventSeq: 1 },
      txClient
    );

    expect(txClient.query).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
    expect(result).toEqual(row);
  });
});
