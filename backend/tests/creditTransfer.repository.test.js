'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  checkConnection: jest.fn(),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
}));

const db = require('../src/config/database');
const creditTransferRepo = require('../src/repositories/creditTransfer.repository');

describe('creditTransfer.repository — getByIdempotencyReference (Sprint 7 continuation)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('looks up a transfer by its unique idempotency_reference', async () => {
    const row = { transfer_id: 't-1', idempotency_reference: 'evt-1' };
    db.query.mockResolvedValue({ rows: [row] });

    const result = await creditTransferRepo.getByIdempotencyReference('evt-1');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/WHERE idempotency_reference = \$1/);
    expect(params).toEqual(['evt-1']);
    expect(result).toEqual(row);
  });

  it('returns null when no transfer exists yet for this reference', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const result = await creditTransferRepo.getByIdempotencyReference('never-seen');
    expect(result).toBeNull();
  });
});

describe('creditTransfer.repository — sumRelationshipTransfers (per-relationship 100 cap support)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sums only transfers for the exact controller/controlled pair since the given timestamp', async () => {
    db.query.mockResolvedValue({ rows: [{ total: '42' }] });
    const since = new Date('2026-01-01T00:00:00Z');

    const result = await creditTransferRepo.sumRelationshipTransfers('boss-1', 'thrall-1', since);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/controller_id = \$1 AND controlled_id = \$2/);
    expect(sql).toMatch(/created_at >= \$3/);
    expect(params).toEqual(['boss-1', 'thrall-1', since]);
    expect(result).toBe(42); // coerced from the SUM(...)::text-ish driver value to a number
  });

  it('returns 0 (not null) when no transfers have happened yet for this relationship', async () => {
    db.query.mockResolvedValue({ rows: [{ total: 0 }] }); // COALESCE(SUM(...), 0) guarantees this in real SQL
    const result = await creditTransferRepo.sumRelationshipTransfers('boss-1', 'thrall-1', new Date());
    expect(result).toBe(0);
  });
});

describe('creditTransfer.repository — sumControllerDayTransfers (per-controller 200/UTC-day cap support)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sums every transfer a controller received since the given UTC day start, across ALL relationships', async () => {
    db.query.mockResolvedValue({ rows: [{ total: '150' }] });
    const dayStart = new Date('2026-01-01T00:00:00.000Z');

    const result = await creditTransferRepo.sumControllerDayTransfers('boss-1', dayStart);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/controller_id = \$1 AND created_at >= \$2/);
    expect(sql).not.toMatch(/controlled_id/); // deliberately NOT scoped to one relationship
    expect(params).toEqual(['boss-1', dayStart]);
    expect(result).toBe(150);
  });
});

describe('creditTransfer.repository — insertTransfer (auditable ledger row)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('inserts a transfer row, including a 0-amount transfer (every cap already exhausted)', async () => {
    const row = { transfer_id: 't-2', controller_id: 'boss-1', controlled_id: 'thrall-1', amount: 0, source_income_amount: 100, idempotency_reference: 'evt-2' };
    db.query.mockResolvedValue({ rows: [row] });

    const result = await creditTransferRepo.insertTransfer({
      controllerId: 'boss-1',
      controlledId: 'thrall-1',
      amount: 0,
      sourceIncomeAmount: 100,
      idempotencyReference: 'evt-2',
    });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO credit_transfers/);
    expect(params).toEqual(['boss-1', 'thrall-1', 0, 100, 'evt-2']);
    expect(result).toEqual(row);
  });
});
