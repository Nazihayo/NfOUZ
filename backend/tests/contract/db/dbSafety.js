'use strict';

/**
 * Safety rules for the optional real-PostgreSQL contract test. Pure
 * functions (no database access) so they are unit-tested in the default
 * test run (dbSafety.test.js). Every rule fails closed: anything that is
 * not clearly a local, dedicated contract-test database is refused.
 *
 * The test is configured ONLY through CONTRACT_TEST_DATABASE_URL. It never
 * reads DATABASE_URL to decide where to connect; DATABASE_URL (process
 * environment or backend/.env) is read only to refuse pointing at the
 * developer's normal database.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONFIG_VAR = 'CONTRACT_TEST_DATABASE_URL';
const TEST_MARKER = 'contract_test';
const RUN_DB_PREFIX = 'nfouz_contract_test_run_';
const RUN_DB_RE = /^nfouz_contract_test_run_\d{14}_[0-9a-f]{8}$/;
const OWNERSHIP_PREFIX = 'nfouz-contract-test-run:';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
// Well-known databases the test must never use as its connection database.
const FORBIDDEN_DATABASES = new Set(['nfouz_db', 'nfouz_db_test', 'postgres', 'template0', 'template1']);
const PRODUCTION_WORDS = /(^|[^a-z])(prod|production|live|staging|stage|shared)([^a-z]|$)/i;
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

class SafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SafetyError';
  }
}

const SETUP_HELP = [
  `${CONFIG_VAR} is not set, so the real-database contract test cannot run.`,
  'It needs a local PostgreSQL role and database dedicated to this test, for example (as a PostgreSQL superuser, once):',
  "  CREATE ROLE nfouz_contract_test LOGIN CREATEDB PASSWORD '<choose a password>';",
  '  CREATE DATABASE nfouz_contract_test OWNER nfouz_contract_test;',
  'then, from backend/:',
  `  Linux/macOS:  ${CONFIG_VAR}=postgres://nfouz_contract_test:<password>@localhost:5432/nfouz_contract_test npm run test:contract:db`,
  `  PowerShell:   $env:${CONFIG_VAR}="postgres://nfouz_contract_test:<password>@localhost:5432/nfouz_contract_test"; npm run test:contract:db`,
  `  cmd:          set "${CONFIG_VAR}=postgres://nfouz_contract_test:<password>@localhost:5432/nfouz_contract_test" && npm run test:contract:db`,
  'See backend/tests/contract/README.md ("Real-database mode").',
].join('\n');

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

/** postgres://user:***@host:port/db — never the password. */
function describeTarget(t) {
  return `postgres://${t.user || '(no user)'}:***@${t.host}:${t.port}/${t.database}`;
}

/**
 * Removes credentials from any text (error messages, child-process
 * output): the given passwords and URLs, and the password part of any
 * postgres:// URL.
 */
function redact(text, secrets = []) {
  let out = String(text);
  for (const s of secrets) {
    if (!s) continue;
    for (const v of new Set([s, safeDecode(s), encodeURIComponent(s)])) {
      if (v && v.length >= 1) out = out.split(v).join('***');
    }
  }
  return out.replace(/(postgres(?:ql)?:\/\/[^:/@\s]*:)[^@\s]*@/gi, '$1***@');
}

/** Parses a postgres URL into its parts; throws SafetyError (without echoing it) if it cannot. */
function parseUrl(urlString, label) {
  let u;
  try {
    u = new URL(urlString);
  } catch (e) {
    throw new SafetyError(`${label} is not a valid URL (value not shown).`);
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    throw new SafetyError(`${label} must start with postgres:// or postgresql://.`);
  }
  return {
    user: safeDecode(u.username),
    password: safeDecode(u.password),
    host: u.hostname.toLowerCase(),
    port: u.port || '5432',
    database: safeDecode(u.pathname.replace(/^\//, '')),
    search: u.search,
    raw: urlString,
  };
}

/** DATABASE_URL from the environment and from backend/.env (that line only; never loaded or printed). */
function developerDatabaseUrls(env = process.env, envFile = path.resolve(__dirname, '../../../.env')) {
  const urls = [];
  if (env.DATABASE_URL) urls.push(env.DATABASE_URL);
  try {
    const text = fs.readFileSync(envFile, 'utf8');
    const m = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m.exec(text);
    if (m) urls.push(m[1].replace(/^['"]|['"]$/g, ''));
  } catch (e) {
    // no backend/.env — nothing to compare against
  }
  return urls;
}

const sameServerHost = (a, b) => (LOOPBACK_HOSTS.has(a) && LOOPBACK_HOSTS.has(b)) || a === b;

/**
 * Validates the contract-test connection URL. Returns the parsed target,
 * or throws SafetyError naming the rule (the URL and password are never
 * echoed). `missing: true` on the error means "not configured".
 */
function validateConfig(env = process.env, { envFile } = {}) {
  const urlString = env[CONFIG_VAR];
  if (!urlString) {
    const err = new SafetyError(SETUP_HELP);
    err.missing = true;
    throw err;
  }
  if (env.NODE_ENV === 'production') throw new SafetyError('Refusing to run with NODE_ENV=production.');

  const t = parseUrl(urlString, CONFIG_VAR);
  const where = describeTarget(t);
  if (t.search) {
    throw new SafetyError(`${CONFIG_VAR} must not have query parameters (they can redirect the connection): ${where}`);
  }
  if (!LOOPBACK_HOSTS.has(t.host)) {
    throw new SafetyError(`Refusing non-local database host "${t.host}": the contract test only runs against localhost / 127.0.0.1 / ::1.`);
  }
  for (const [what, value] of [['user', t.user], ['database', t.database]]) {
    if (PRODUCTION_WORDS.test(value || '')) {
      throw new SafetyError(`Refusing ${what} "${value}": it looks like a production or shared target.`);
    }
  }
  if (!t.database) throw new SafetyError(`${CONFIG_VAR} must name a database: ${where}`);
  if (FORBIDDEN_DATABASES.has(t.database)) {
    throw new SafetyError(`Refusing database "${t.database}": that is the normal NFOUZ development/test database or a system database. Create a dedicated one whose name contains "${TEST_MARKER}".`);
  }
  if (!SAFE_IDENTIFIER.test(t.database) || !t.database.includes(TEST_MARKER)) {
    throw new SafetyError(`Refusing database "${t.database}": its name must contain the test-only marker "${TEST_MARKER}" (lowercase letters, digits and _ only).`);
  }
  if (!t.user || !SAFE_IDENTIFIER.test(t.user)) {
    throw new SafetyError('The database user must be a plain lowercase identifier (letters, digits, _).');
  }

  for (const dev of developerDatabaseUrls(env, envFile)) {
    let d;
    try { d = parseUrl(dev, 'DATABASE_URL'); } catch (e) { continue; }
    if (dev === urlString || (sameServerHost(d.host, t.host) && d.port === t.port && d.database === t.database)) {
      throw new SafetyError(`Refusing ${where}: it is the developer database from DATABASE_URL.`);
    }
  }
  return t;
}

/** A unique, unmistakably test-only database name for one run. */
function newRunDatabaseName(now = new Date(), random = crypto.randomBytes(4).toString('hex')) {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const name = `${RUN_DB_PREFIX}${stamp}_${random}`;
  if (!RUN_DB_RE.test(name)) throw new SafetyError(`generated database name ${name} failed its own check`);
  return name;
}

const ownershipMarker = (runDatabase) => `${OWNERSHIP_PREFIX}${runDatabase}`;

/**
 * The only condition under which the test drops a database: it is the
 * name this run generated, it has the run-database shape, it is not the
 * connection database, and its comment carries this run's marker.
 */
function mayDropDatabase({ name, createdName, connectionDatabase, comment }) {
  const reasons = [];
  if (!createdName) reasons.push('this run did not create a database');
  if (name !== createdName) reasons.push(`"${name}" is not the database this run created`);
  if (!RUN_DB_RE.test(name || '')) reasons.push(`"${name}" does not have the run-database name shape`);
  if (name === connectionDatabase) reasons.push('it is the connection database');
  if (comment !== ownershipMarker(createdName)) reasons.push('its ownership marker does not match this run');
  return { ok: reasons.length === 0, reasons };
}

/** Connection URL for the run database: same server and credentials, no query string. */
function runDatabaseUrl(target, runDatabase) {
  if (!RUN_DB_RE.test(runDatabase)) throw new SafetyError(`refusing to build a URL for ${runDatabase}`);
  const u = new URL(target.raw);
  u.pathname = `/${runDatabase}`;
  u.search = '';
  return u.toString();
}

module.exports = {
  CONFIG_VAR,
  TEST_MARKER,
  RUN_DB_RE,
  SafetyError,
  SETUP_HELP,
  validateConfig,
  describeTarget,
  redact,
  newRunDatabaseName,
  ownershipMarker,
  mayDropDatabase,
  runDatabaseUrl,
};
