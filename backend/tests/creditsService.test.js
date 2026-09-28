'use strict';

process.env.NODE_ENV = 'test';

/**
 * Sprint 7 continuation — Control economy foundation. Mirrors the mocking
 * style already used for battle.resolve.test.js: only `../src/config/
 * database` is mocked, so player.repository.js and creditTransfer.
 * repository.js run for real against a mocked transaction client — this
 * exercises the actual SQL-building code, not a re-implementation of it.
 */

const txClient = { query: jest.fn() };

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
  checkConnection: jest.fn(),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
}));

const db = require('../src/config/database');
const creditsService = require('../src/services/creditsService');

function relationshipSumRow(total) {
  return { rows: [{ total }] };
}

describe('creditsService.applyEligibleIncome (Sprint 7 continuation)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.withTransaction.mockImplementation((fn) => fn(txClient));
  });

  it('rejects a non-positive or non-integer amount before touching the database', async () => {
    await expect(creditsService.applyEligibleIncome('p-1', 0, 'quest_reward', 'evt-1')).rejects.toMatchObject({ code: 'INVALID_CREDITS_AMOUNT' });
    await expect(creditsService.applyEligibleIncome('p-1', -5, 'quest_reward', 'evt-1')).rejects.toMatchObject({ code: 'INVALID_CREDITS_AMOUNT' });
    await expect(creditsService.applyEligibleIncome('p-1', 1.5, 'quest_reward', 'evt-1')).rejects.toMatchObject({ code: 'INVALID_CREDITS_AMOUNT' });
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a missing idempotencyReference', async () => {
    await expect(creditsService.applyEligibleIncome('p-1', 100, 'quest_reward')).rejects.toMatchObject({ code: 'INVALID_IDEMPOTENCY_REFERENCE' });
  });

  it('credits the full amount with no transfer when the player is not currently Controlled', async () => {
    txClient.query
      .mockResolvedValueOnce({ rows: [{ player_id: 'p-1', is_controlled: false, controlled_until: null, credits: 0 }] }) // getById
      .mockResolvedValueOnce({ rows: [{ player_id: 'p-1', credits: 100 }] }); // adjustCredits

    const result = await creditsService.applyEligibleIncome('p-1', 100, 'quest_reward', 'evt-1');

    expect(result.transferred).toBe(0);
    expect(result.kept).toBe(100);
    expect(result.player_credits).toBe(100);
    expect(txClient.query).toHaveBeenCalledTimes(2); // getById + one adjustCredits — no ledger row at all
  });

  it('eligible income deduction and rounding: floor(47 * 0.20) = 9 transferred, 38 kept', async () => {
    const controlledSince = new Date(Date.now() - 60000);
    txClient.query
      .mockResolvedValueOnce({ rows: [{ player_id: 'ctrl-1', is_controlled: true, controller_id: 'boss-1', controlled_since: controlledSince, controlled_until: new Date(Date.now() + 60000), credits: 0 }] }) // getById
      .mockResolvedValueOnce({ rows: [] }) // getByIdempotencyReference -> not seen before
      .mockResolvedValueOnce(relationshipSumRow(0)) // sumRelationshipTransfers
      .mockResolvedValueOnce(relationshipSumRow(0)) // sumControllerDayTransfers
      .mockResolvedValueOnce({ rows: [{ player_id: 'ctrl-1', credits: 38 }] }) // adjustCredits(controlled, kept)
      .mockResolvedValueOnce({ rows: [{ player_id: 'boss-1', credits: 9 }] }) // adjustCredits(controller, transferred)
      .mockResolvedValueOnce({ rows: [{ transfer_id: 't-1', amount: 9 }] }); // insertTransfer

    const result = await creditsService.applyEligibleIncome('ctrl-1', 47, 'quest_reward', 'evt-47');

    expect(result.transferred).toBe(9);
    expect(result.kept).toBe(38);
    expect(result.controller_id).toBe('boss-1');

    const [insertSql, insertParams] = txClient.query.mock.calls[6];
    expect(insertSql).toMatch(/INSERT INTO credit_transfers/);
    expect(insertParams).toEqual(['boss-1', 'ctrl-1', 9, 47, 'evt-47']);
  });

  it('per-relationship 100-credit cap clamps the transfer even when the nominal 20% cut would exceed it', async () => {
    const controlledSince = new Date(Date.now() - 60000);
    txClient.query
      .mockResolvedValueOnce({ rows: [{ player_id: 'ctrl-1', is_controlled: true, controller_id: 'boss-1', controlled_since: controlledSince, controlled_until: new Date(Date.now() + 60000), credits: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(relationshipSumRow(95)) // only 5 left in this relationship's 100 cap
      .mockResolvedValueOnce(relationshipSumRow(95)) // day cap far from exhausted
      .mockResolvedValueOnce({ rows: [{ player_id: 'ctrl-1', credits: 995 }] })
      .mockResolvedValueOnce({ rows: [{ player_id: 'boss-1', credits: 100 }] })
      .mockResolvedValueOnce({ rows: [{ transfer_id: 't-2', amount: 5 }] });

    // Nominal 20% of 1000 = 200, but only 5 remains under the relationship cap.
    const result = await creditsService.applyEligibleIncome('ctrl-1', 1000, 'quest_reward', 'evt-cap');

    expect(result.transferred).toBe(5);
    expect(result.kept).toBe(995);
  });

  it('controller daily 200-credit cap clamps the transfer even when the relationship cap has room', async () => {
    const controlledSince = new Date(Date.now() - 60000);
    txClient.query
      .mockResolvedValueOnce({ rows: [{ player_id: 'ctrl-2', is_controlled: true, controller_id: 'boss-1', controlled_since: controlledSince, controlled_until: new Date(Date.now() + 60000), credits: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(relationshipSumRow(0)) // fresh relationship, full 100 available
      .mockResolvedValueOnce(relationshipSumRow(190)) // but boss-1 has already received 190 today (cap 200)
      .mockResolvedValueOnce({ rows: [{ player_id: 'ctrl-2', credits: 990 }] })
      .mockResolvedValueOnce({ rows: [{ player_id: 'boss-1', credits: 200 }] })
      .mockResolvedValueOnce({ rows: [{ transfer_id: 't-3', amount: 10 }] });

    const result = await creditsService.applyEligibleIncome('ctrl-2', 1000, 'quest_reward', 'evt-day-cap');

    expect(result.transferred).toBe(10); // only 10 left in the 200/day allowance
    expect(result.kept).toBe(990);
  });

  it('duplicate income event (same idempotency reference) does not transfer twice — short-circuits before any write', async () => {
    const existing = { transfer_id: 't-4', controller_id: 'boss-1', controlled_id: 'ctrl-3', amount: 20, source_income_amount: 100, idempotency_reference: 'evt-dup' };
    txClient.query
      .mockResolvedValueOnce({ rows: [{ player_id: 'ctrl-3', is_controlled: true, controller_id: 'boss-1', controlled_since: new Date(), controlled_until: new Date(Date.now() + 60000), credits: 80 }] }) // getById
      .mockResolvedValueOnce({ rows: [existing] }); // getByIdempotencyReference -> already processed

    const result = await creditsService.applyEligibleIncome('ctrl-3', 100, 'quest_reward', 'evt-dup');

    expect(result.idempotent).toBe(true);
    expect(result.transferred).toBe(20);
    expect(result.kept).toBe(80);
    // No adjustCredits or insertTransfer calls happened — only the 2 reads.
    expect(txClient.query).toHaveBeenCalledTimes(2);
  });

  it('transaction rollback: withTransaction propagates a mid-transaction failure without this service swallowing it', async () => {
    db.withTransaction.mockImplementation(async () => {
      throw new Error('simulated rollback');
    });

    await expect(creditsService.applyEligibleIncome('ctrl-4', 100, 'quest_reward', 'evt-rollback')).rejects.toThrow('simulated rollback');
  });

  it('never deducts from the existing balance — a tiny income that rounds to a 0 cut transfers nothing', async () => {
    txClient.query
      .mockResolvedValueOnce({ rows: [{ player_id: 'ctrl-5', is_controlled: true, controller_id: 'boss-1', controlled_since: new Date(), controlled_until: new Date(Date.now() + 60000), credits: 3 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(relationshipSumRow(0))
      .mockResolvedValueOnce(relationshipSumRow(0))
      .mockResolvedValueOnce({ rows: [{ player_id: 'ctrl-5', credits: 4 }] })
      .mockResolvedValueOnce({ rows: [{ transfer_id: 't-5', amount: 0 }] });

    const result = await creditsService.applyEligibleIncome('ctrl-5', 1, 'quest_reward', 'evt-tiny');

    expect(result.transferred).toBe(0);
    expect(result.kept).toBe(1);
    // Only ONE adjustCredits call (the controlled player) — the controller
    // is never even touched for a 0 transfer.
    const adjustCreditsCalls = txClient.query.mock.calls.filter(([sql]) => sql.includes('credits = GREATEST'));
    expect(adjustCreditsCalls).toHaveLength(1);
  });
});
