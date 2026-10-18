'use strict';

/**
 * Unity <-> backend contract test — optional REAL PostgreSQL mode.
 *
 * Runs only through `npm run test:contract:db` (the file name is not
 * picked up by `npm test`), and only with an explicit
 * CONTRACT_TEST_DATABASE_URL that passes every check in dbSafety.js. It
 * never reads DATABASE_URL or backend/.env to decide where to connect.
 *
 * Per run: creates one database nfouz_contract_test_run_<time>_<random>
 * (marked with COMMENT ON DATABASE), runs the backend's migration runner
 * on it, then runs the SAME scenarios, world and allowlist as the
 * database-free test (contractSuite.js) through the real pg driver —
 * reseeding the world before each scenario — plus checks only a real
 * database can answer (values written by INSERT/UPDATE, state after each
 * call, the fake mode's "finds nothing" hints, migration seeds, error
 * paths). The run database is dropped in afterAll after re-checking its
 * name and ownership marker; a failed cleanup is reported, never hidden.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

// This process must never load backend/.env (developer DATABASE_URL,
// Firebase credentials): env.js calls dotenv.config(), which becomes a no-op.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../../src/config/firebase', () => require('../firebaseStub'));
jest.mock('../../../src/middleware/rateLimit.middleware', () => require('../rateLimitStub'));

const fs = require('fs');
const path = require('path');

const safety = require('./dbSafety');
const { startRealBackend, stopRealBackend } = require('./realBackend');
const { reseed, migrationSeedProblems } = require('./seed');
const { instrumentRepository, currentRepoFn } = require('../repoContext');
const { installRecorder } = require('../harness');
const { baseWorld, DEFAULT_ROW_COUNTS } = require('../world');
const { createContractSuite } = require('../contractSuite');
const { errorScenarios } = require('../scenarios');

const MODE = 'real PostgreSQL';
const SETUP_TIMEOUT_MS = 180000;

let target = null;
let configError = null;
try {
  target = safety.validateConfig(process.env);
} catch (err) {
  configError = err;
}

const ctx = {};       // throwaway database lifecycle state, backend modules
let state = null;
let db = null;        // the backend's own src/config/database (real pg pool)
let app = null;
let seedProblems = [];
const queryLog = [];

/** Logs every statement the backend runs, with its repository function and row count. */
function instrumentDatabase(dbModule) {
  const record = (repoFn, text, result) => {
    queryLog.push({ repoFn, verb: String(text).trim().split(/\s+/)[0].toUpperCase(), rowCount: result ? result.rowCount : null });
    return result;
  };
  const wrapQuery = (target, method) => {
    const original = target[method].bind(target);
    return (text, params) => {
      const repoFn = currentRepoFn();
      return original(text, params).then((r) => record(repoFn, text, r));
    };
  };
  dbModule.query = wrapQuery(dbModule, 'query');
  const originalTx = dbModule.withTransaction;
  dbModule.withTransaction = (fn) => originalTx((client) => fn(Object.create(client, { query: { value: wrapQuery(client, 'query') } })));
}

function getPath(obj, dotted) {
  return dotted.split('.').reduce((v, k) => (v === null || v === undefined ? v : v[k]), obj);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Checks only a real database can answer, for one scenario run. */
async function realChecks({ scenario, result }) {
  const problems = [];
  // 1. The fake mode's hints ("this lookup finds nothing") must be true here.
  // Success scenarios only: error scenarios contradict them on purpose.
  const hints = 'status' in scenario ? {} : { ...DEFAULT_ROW_COUNTS, ...(scenario.rowCounts || {}) };
  for (const [fn, n] of Object.entries(hints)) {
    if (n !== 0) continue;
    const hit = result.log.find((l) => l.repoFn === fn && l.rowCount > 0);
    if (hit) problems.push(`fake-mode hint "${fn}: 0" is false in PostgreSQL (${hit.verb} returned ${hit.rowCount} rows) — fix the scenario world`);
  }
  if (!scenario.real) return problems;
  // 2. Values in the response (types are already compared with the Unity DTO).
  if (result.ok) {
    for (const [p, expected] of Object.entries(scenario.real.expect || {})) {
      const actual = getPath(result.data, p);
      const ok = typeof expected === 'function' ? expected(actual) : same(actual, expected);
      if (!ok) problems.push(`response ${p} is ${JSON.stringify(actual)}, expected ${typeof expected === 'function' ? expected.toString() : JSON.stringify(expected)}`);
    }
  }
  // 3. State the call left in the database.
  for (const check of scenario.real.after || []) {
    if (!/^\s*SELECT\b/i.test(check.sql)) throw new Error(`after-check must be a SELECT: ${check.sql}`);
    const { rows } = await db.pool.query(check.sql, check.params || []);
    if (!same(rows, check.rows)) problems.push(`after ${scenario.key}: ${check.sql.replace(/\s+/g, ' ')} returned ${JSON.stringify(rows)}, expected ${JSON.stringify(check.rows)}`);
  }
  return problems;
}

const suite = createContractSuite({
  mode: MODE,
  getApp: () => app,
  prepare: async (scenario) => {
    const world = JSON.parse(JSON.stringify(baseWorld()));
    if (scenario.world) scenario.world(world);
    await reseed(db.pool, state.createdName, world);
  },
  takeLog: () => queryLog.splice(0),
  inspect: realChecks,
});

if (configError) {
  describe(`Unity <-> backend contract (${MODE})`, () => {
    test('is configured safely', () => {
      throw new Error(configError.message);
    });
  });
} else {
  beforeAll(async () => {
    await startRealBackend(target, ctx, {
      beforeAppLoad: (dbModule) => {
        instrumentDatabase(dbModule);
        const repoDir = path.resolve(__dirname, '../../../src/repositories');
        for (const file of fs.readdirSync(repoDir).filter((f) => f.endsWith('.repository.js'))) {
          // eslint-disable-next-line global-require, import/no-dynamic-require
          instrumentRepository(file.replace('.repository.js', ''), require(path.join(repoDir, file)));
        }
        installRecorder();
      },
    });
    ({ state, db, app } = ctx);

    seedProblems = await migrationSeedProblems(db.pool, baseWorld());
    await suite.runAll();
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    suite.writeReport();
    await stopRealBackend(ctx);
  }, SETUP_TIMEOUT_MS);

  describe(`Unity <-> backend contract (${MODE})`, () => {
    suite.defineSharedTests();

    test('the world agrees with the reference data the migrations seed', () => {
      expect(seedProblems).toEqual([]);
    });

    describe.each(errorScenarios.map((s) => [s.name, s]))('error path: %s', (name, scenario) => {
      test(`answers ${scenario.status}${scenario.code ? ` ${scenario.code}` : ''}`, async () => {
        const call = suite.unity.calls.find((c) => c.key === scenario.key);
        expect(call).toBeDefined();
        const result = await suite.sendCall(scenario, call);
        const problems = [];
        if (result.status !== scenario.status) problems.push(`HTTP ${result.status} ${JSON.stringify(result.error)}, expected ${scenario.status} ${scenario.code}`);
        if (scenario.code) problems.push(...suite.envelopeProblems(scenario.code, result.body));
        problems.push(...result.modeProblems);
        expect(problems).toEqual([]);
      });
    });
  });
}
