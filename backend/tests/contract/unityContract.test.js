'use strict';

/**
 * Unity <-> backend contract regression test — database-free mode (the
 * default, authoritative fast test; part of `npm test`).
 *
 * Reads the Unity client's C# sources (Assets/_Project/Scripts) and runs
 * every endpoint the client calls through the REAL Express app,
 * controllers, services and repository SQL. Only three things are
 * replaced, in-process: the PostgreSQL driver (tests/contract/
 * fakeDatabase.js — rows typed like node-postgres from the migrations),
 * Firebase token verification (the bearer token is used as the uid) and
 * the rate limiters. No Unity, database, Docker, network or credentials.
 *
 * The checks themselves are in contractSuite.js and are shared with the
 * optional real-PostgreSQL mode (db/unityContract.dbtest.js):
 *   1. every client call has a scenario, and every scenario a client call
 *   2. every client call reaches a backend route (method + path)
 *   3. request bodies / query strings: what the client sends (Unity
 *      request DTO, JsonUtility field names) vs what the backend reads
 *   4. success responses vs the Unity DTO that parses them: missing and
 *      extra fields, wrong JSON types (e.g. a number sent as a string)
 *   5. partial responses (battle ready/reconnect) are applied with the
 *      matching partial-apply method, never as a full session
 *   6. every error code the client handles is one the backend sends, and
 *      the error envelope matches the client's ApiResponse/ApiError
 * Intentional differences live in tests/contract/allowlist.js.
 */

process.env.NODE_ENV = 'test';

jest.mock('../../src/config/database', () => require('./fakeDatabaseInstance').databaseModule);
jest.mock('../../src/config/firebase', () => require('./firebaseStub'));
jest.mock('../../src/middleware/rateLimit.middleware', () => require('./rateLimitStub'));

const fs = require('fs');
const path = require('path');

const fake = require('./fakeDatabaseInstance');
const { installRecorder } = require('./harness');
const { baseWorld, DEFAULT_ROW_COUNTS } = require('./world');
const { createContractSuite } = require('./contractSuite');

// Repositories are instrumented before the app (and its services) load.
const REPO_DIR = path.resolve(__dirname, '../../src/repositories');
for (const file of fs.readdirSync(REPO_DIR).filter((f) => f.endsWith('.repository.js'))) {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  fake.instrumentRepository(file.replace('.repository.js', ''), require(path.join(REPO_DIR, file)));
}
installRecorder();
const app = require('../../src/app')();

const suite = createContractSuite({
  mode: 'fake database',
  getApp: () => app,
  // The fake cannot evaluate WHERE clauses: `rowCounts` tells it which
  // repository lookups find nothing (the real-database mode checks that
  // these hints are true against PostgreSQL).
  prepare: (scenario) => {
    const world = JSON.parse(JSON.stringify(baseWorld()));
    if (scenario.world) scenario.world(world);
    fake.setWorld(world);
    fake.setRowCounts({ ...DEFAULT_ROW_COUNTS, ...(scenario.rowCounts || {}) });
  },
  takeLog: () => fake.takeLog(),
});

beforeAll(() => suite.runAll());
afterAll(() => suite.writeReport());

describe('Unity <-> backend contract (fake database)', () => {
  suite.defineSharedTests();

  test('the world only uses real columns', () => {
    const bad = [];
    for (const [table, rows] of Object.entries(baseWorld())) {
      if (table.startsWith('$')) continue;
      if (!suite.schema[table]) { bad.push(`unknown table ${table}`); continue; }
      for (const row of rows) for (const col of Object.keys(row)) if (!(col in suite.schema[table])) bad.push(`${table}.${col}`);
    }
    expect(bad).toEqual([]);
  });
});
