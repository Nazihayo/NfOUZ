'use strict';

process.env.NODE_ENV = 'test';

/**
 * Sprint 6 correction pass — unit tests for config/database.js's
 * withTransaction, exercised against the REAL implementation (unlike
 * battle.resolve.test.js, which mocks the whole database module and so
 * cannot prove BEGIN/COMMIT/ROLLBACK actually happen). Only the `pg`
 * Pool itself is mocked here, so this runs the genuine
 * BEGIN -> fn -> COMMIT / ROLLBACK -> release control flow.
 */

const fakeClient = {
  query: jest.fn(),
  release: jest.fn(),
};

const fakePool = {
  connect: jest.fn(),
  on: jest.fn(),
  query: jest.fn(),
  end: jest.fn(),
};

jest.mock('pg', () => ({
  Pool: jest.fn(() => fakePool),
}));

const db = require('../src/config/database');

describe('config/database — withTransaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fakePool.connect.mockResolvedValue(fakeClient);
    fakeClient.query.mockResolvedValue({ rows: [] });
  });

  it('runs BEGIN, the callback, then COMMIT, and releases the client on success', async () => {
    const work = jest.fn().mockResolvedValue('the-result');

    const result = await db.withTransaction(work);

    expect(result).toBe('the-result');
    expect(work).toHaveBeenCalledWith(fakeClient);

    const calls = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(calls).toEqual(['BEGIN', 'COMMIT']);
    expect(fakeClient.query).not.toHaveBeenCalledWith('ROLLBACK');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and re-throws when the callback throws mid-transaction, without committing', async () => {
    const failure = new Error('setControlled failed');
    const work = jest.fn().mockRejectedValue(failure);

    await expect(db.withTransaction(work)).rejects.toThrow('setControlled failed');

    const calls = fakeClient.query.mock.calls.map(([sql]) => sql);
    expect(calls).toEqual(['BEGIN', 'ROLLBACK']);
    expect(calls).not.toContain('COMMIT');
    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });

  it('releases the client even if ROLLBACK itself is reached after a mid-transaction failure', async () => {
    // Guards against a regression where an early return/throw skips the
    // finally block and leaks the pooled connection.
    const work = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(db.withTransaction(work)).rejects.toThrow('boom');

    expect(fakeClient.release).toHaveBeenCalledTimes(1);
  });
});
