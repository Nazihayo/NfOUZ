'use strict';

/**
 * Lifecycle of the one throwaway PostgreSQL database a real-database
 * contract run uses:
 *   1. connect to the dedicated contract-test database (validated by
 *      dbSafety.validateConfig) and check the server and role;
 *   2. CREATE DATABASE nfouz_contract_test_run_<UTC time>_<random>, and
 *      mark it with COMMENT ON DATABASE (the ownership marker);
 *   3. run the backend's own migration runner against it;
 *   4. at the end, DROP it — only after re-checking its name and marker.
 * Nothing else on the server is created, changed or dropped.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');
const {
  SafetyError, describeTarget, redact, newRunDatabaseName, ownershipMarker, mayDropDatabase, runDatabaseUrl, RUN_DB_RE,
} = require('./dbSafety');

const MIGRATION_RUNNER = path.resolve(__dirname, '../../../scripts/run-migrations.js');
const MIN_SERVER_VERSION = 130000; // DROP DATABASE ... WITH (FORCE); trusted pgcrypto

function quoteIdent(name) {
  if (!RUN_DB_RE.test(name)) throw new SafetyError(`refusing to use "${name}" as a database identifier`);
  return `"${name}"`;
}

function scrub(err, target) {
  const e = new Error(redact(err && err.message ? err.message : String(err), [target.password, target.raw]));
  e.code = err && err.code;
  return e;
}

/**
 * Connects to the contract-test database and creates this run's
 * database. Returns the run state; `state.createdName` is set as soon as
 * CREATE DATABASE succeeded, so cleanup knows what (and only what) to drop.
 */
async function createRunDatabase(target) {
  const state = { target, admin: null, createdName: null, runUrl: null, marked: false };
  const admin = new Client({ connectionString: target.raw, connectionTimeoutMillis: 5000 });
  state.admin = admin;
  try {
    await admin.connect();
    const { rows: [info] } = await admin.query(
      `SELECT current_database() AS db, current_user AS usr, r.rolsuper, r.rolcreatedb,
              current_setting('server_version_num')::int AS version
       FROM pg_roles r WHERE r.rolname = current_user`
    );
    if (info.db !== target.database) throw new SafetyError(`connected to "${info.db}", expected "${target.database}"`);
    if (info.rolsuper) {
      throw new SafetyError(`Refusing to run as superuser "${info.usr}". Use a dedicated role with only LOGIN and CREATEDB (see README).`);
    }
    if (!info.rolcreatedb) throw new SafetyError(`Role "${info.usr}" lacks CREATEDB, which the test needs to create its throwaway database.`);
    if (info.version < MIN_SERVER_VERSION) throw new SafetyError(`PostgreSQL ${info.version} is too old; version 13 or later is required.`);

    const name = newRunDatabaseName();
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount !== 0) throw new SafetyError(`database ${name} already exists — refusing to reuse it`);

    await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
    state.createdName = name;
    await admin.query(`COMMENT ON DATABASE ${quoteIdent(name)} IS '${ownershipMarker(name)}'`);
    state.marked = true;
    state.runUrl = runDatabaseUrl(target, name);
    return state;
  } catch (err) {
    err.state = state;
    throw err instanceof SafetyError ? err : Object.assign(scrub(err, target), { state });
  }
}

/** Environment for child processes: no developer database, Firebase or PG* settings. */
function childEnv(runUrl) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(DATABASE_URL|DATABASE_SSL|FIREBASE_|CONTRACT_TEST_|PG)/i.test(k)) continue;
    env[k] = v;
  }
  return { ...env, DATABASE_URL: runUrl, NODE_ENV: 'test', LOG_LEVEL: 'error' };
}

/**
 * Runs the backend's real migration runner (scripts/run-migrations.js)
 * against the run database, in a child process whose working directory
 * is a fresh empty folder — so dotenv finds no backend/.env there.
 */
async function migrate(state) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nfouz-contract-migrate-'));
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [MIGRATION_RUNNER], { cwd, env: childEnv(state.runUrl), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`migration runner exited with ${code}:\n${out}`))));
    });
    return redact(output, [state.target.password, state.runUrl, state.target.raw]);
  } catch (err) {
    throw scrub(err, state.target);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

/**
 * Drops the run database if — and only if — every ownership check passes.
 * Never throws: returns { dropped, problems } so the caller can report a
 * cleanup failure without hiding the test's own failures.
 */
async function dropRunDatabase(state) {
  const problems = [];
  if (!state || !state.admin) return { dropped: false, problems };
  const { admin, createdName, target } = state;
  try {
    if (!createdName) return { dropped: false, problems };
    const { rows } = await admin.query(
      "SELECT datname, shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = $1",
      [createdName]
    );
    if (rows.length === 0) {
      problems.push(`run database ${createdName} was already gone`);
      return { dropped: false, problems };
    }
    const verdict = mayDropDatabase({
      name: rows[0].datname, createdName, connectionDatabase: target.database, comment: rows[0].comment,
    });
    if (!verdict.ok) {
      problems.push(`NOT dropping ${createdName}: ${verdict.reasons.join('; ')}. Check it, then drop it by hand: DROP DATABASE "${createdName}";`);
      return { dropped: false, problems };
    }
    await admin.query(`DROP DATABASE ${quoteIdent(createdName)} WITH (FORCE)`);
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [createdName]);
    if (rowCount !== 0) problems.push(`run database ${createdName} still exists after DROP`);
    return { dropped: rowCount === 0, problems };
  } catch (err) {
    problems.push(`cleanup of ${createdName} failed: ${scrub(err, target).message}. Drop it by hand: DROP DATABASE "${createdName}";`);
    return { dropped: false, problems };
  } finally {
    await admin.end().catch(() => {});
  }
}

module.exports = { createRunDatabase, migrate, dropRunDatabase, childEnv, describeTarget };
