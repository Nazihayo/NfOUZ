'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  checkConnection: jest.fn(),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
}));

const db = require('../src/config/database');
const influenceLogRepo = require('../src/repositories/influenceLog.repository');

describe('influenceLog.repository — log (Sprint 6 Influence audit trail)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('inserts a battle_win row with the correct player/delta/reason/battle_id (nominalDelta defaults to delta)', async () => {
    const row = { log_id: 'log-1', player_id: 'p-1', delta: 15, reason: 'battle_win', battle_id: 'b-1', nominal_delta: 15 };
    db.query.mockResolvedValue({ rows: [row] });

    const result = await influenceLogRepo.log('p-1', 15, 'battle_win', 'b-1');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO influence_log/);
    expect(sql).toMatch(/nominal_delta/);
    expect(params).toEqual(['p-1', 15, 'battle_win', 'b-1', 15]);
    expect(result).toEqual(row);
  });

  it('inserts a battle_loss row with a negative delta', async () => {
    const row = { log_id: 'log-2', player_id: 'p-2', delta: -10, reason: 'battle_loss', battle_id: 'b-1', nominal_delta: -10 };
    db.query.mockResolvedValue({ rows: [row] });

    const result = await influenceLogRepo.log('p-2', -10, 'battle_loss', 'b-1');

    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual(['p-2', -10, 'battle_loss', 'b-1', -10]);
    expect(result.delta).toBe(-10);
  });

  it('Sprint 6 correction pass: runs on the provided executor (transaction client) instead of the shared pool when given', async () => {
    const row = { log_id: 'log-3', player_id: 'p-1', delta: 15, reason: 'battle_win', battle_id: 'b-1', nominal_delta: 15 };
    const txClient = { query: jest.fn().mockResolvedValue({ rows: [row] }) };

    const result = await influenceLogRepo.log('p-1', 15, 'battle_win', 'b-1', txClient);

    expect(txClient.query).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
    expect(result).toEqual(row);
  });

  it('Sprint 7 continuation: records a distinct nominalDelta from the actual applied delta when the floor clips a loss', async () => {
    const row = { log_id: 'log-4', player_id: 'p-2', delta: -5, reason: 'battle_loss', battle_id: 'b-1', nominal_delta: -10 };
    db.query.mockResolvedValue({ rows: [row] });

    const result = await influenceLogRepo.log('p-2', -5, 'battle_loss', 'b-1', undefined, -10);

    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual(['p-2', -5, 'battle_loss', 'b-1', -10]);
    expect(result.nominal_delta).toBe(-10);
  });
});
