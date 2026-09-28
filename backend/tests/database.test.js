'use strict';

process.env.NODE_ENV = 'test';

// Mock the 'pg' module itself so these are true unit tests with no real DB required.
const mockQuery = jest.fn();
const mockOn = jest.fn();
const mockEnd = jest.fn();

jest.mock('pg', () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      query: mockQuery,
      on: mockOn,
      end: mockEnd,
    })),
  };
});

const { query, checkConnection, shutdown } = require('../src/config/database');

describe('database config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('query() delegates to the underlying pool and returns its result', async () => {
    mockQuery.mockResolvedValue({ rows: [{ one: 1 }], rowCount: 1 });

    const result = await query('SELECT 1 AS one', []);

    expect(mockQuery).toHaveBeenCalledWith('SELECT 1 AS one', []);
    expect(result.rows).toEqual([{ one: 1 }]);
  });

  it('checkConnection() returns true when the pool responds', async () => {
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const ok = await checkConnection();

    expect(ok).toBe(true);
  });

  it('checkConnection() returns false when the pool throws', async () => {
    mockQuery.mockRejectedValue(new Error('connection refused'));

    const ok = await checkConnection();

    expect(ok).toBe(false);
  });

  it('shutdown() ends the pool', async () => {
    mockEnd.mockResolvedValue(undefined);

    await shutdown();

    expect(mockEnd).toHaveBeenCalledTimes(1);
  });
});
