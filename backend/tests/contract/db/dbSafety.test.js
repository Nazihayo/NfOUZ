'use strict';

/**
 * Safety rules of the optional real-PostgreSQL contract test. Runs in the
 * normal test suite: no database, no network.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CONFIG_VAR, SafetyError, validateConfig, redact, describeTarget, newRunDatabaseName,
  ownershipMarker, mayDropDatabase, runDatabaseUrl, RUN_DB_RE,
} = require('./dbSafety');

const PASSWORD = 's3cret-Pa55';
const NO_ENV_FILE = path.join(os.tmpdir(), 'nfouz-contract-no-such-env-file');
const url = (rest) => `postgres://nfouz_contract_test:${PASSWORD}@${rest}`;

function check(value, extraEnv = {}, envFile = NO_ENV_FILE) {
  return validateConfig({ [CONFIG_VAR]: value, ...extraEnv }, { envFile });
}

function rejection(value, extraEnv, envFile) {
  try {
    check(value, extraEnv, envFile);
  } catch (err) {
    expect(err).toBeInstanceOf(SafetyError);
    expect(err.message).not.toContain(PASSWORD);
    return err.message;
  }
  throw new Error('expected the configuration to be refused');
}

describe('real-database contract test — safety checks', () => {
  test('not configured: refuses with setup instructions, never falls back to DATABASE_URL', () => {
    let err;
    try {
      validateConfig({ DATABASE_URL: 'postgres://nfouz:nfouz_pass@localhost:5432/nfouz_db' }, { envFile: NO_ENV_FILE });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SafetyError);
    expect(err.missing).toBe(true);
    expect(err.message).toContain(CONFIG_VAR);
    expect(err.message).toContain('CREATE ROLE nfouz_contract_test');
  });

  test('a) refuses the normal nfouz_db database', () => {
    expect(rejection(url('localhost:5432/nfouz_db'))).toMatch(/normal NFOUZ development/);
    expect(rejection(url('localhost:5432/nfouz_db_test'))).toMatch(/normal NFOUZ development/);
  });

  test('b) refuses a database URL without the test-only marker', () => {
    expect(rejection(url('localhost:5432/nfouz_dev'))).toMatch(/must contain the test-only marker "contract_test"/);
    expect(rejection(url('localhost:5432/postgres'))).toMatch(/system database|normal NFOUZ/);
    expect(rejection(url('localhost:5432/'))).toMatch(/must name a database/);
  });

  test('c) refuses obvious production hosts and names', () => {
    expect(rejection(url('db.prod.example.com:5432/nfouz_contract_test'))).toMatch(/non-local database host/);
    expect(rejection(url('nfouz-production.eu-west-1.rds.amazonaws.com:5432/nfouz_contract_test'))).toMatch(/non-local/);
    expect(rejection(url('localhost:5432/nfouz_contract_test_production'))).toMatch(/production or shared/);
    expect(rejection(`postgres://prod_admin:${PASSWORD}@localhost:5432/nfouz_contract_test`)).toMatch(/production or shared/);
    expect(rejection(url('localhost:5432/nfouz_contract_test'), { NODE_ENV: 'production' })).toMatch(/NODE_ENV=production/);
  });

  test('refuses any non-loopback host, including LAN addresses', () => {
    for (const host of ['10.0.0.5', '192.168.1.20', 'db', 'my-laptop.local']) {
      expect(rejection(url(`${host}:5432/nfouz_contract_test`))).toMatch(/non-local database host/);
    }
  });

  test('refuses query parameters that could redirect the connection', () => {
    expect(rejection(url('localhost:5432/nfouz_contract_test?host=db.prod.example.com'))).toMatch(/query parameters/);
    expect(rejection(url('localhost:5432/nfouz_contract_test?sslmode=disable'))).toMatch(/query parameters/);
  });

  test('refuses the developer database named by DATABASE_URL (environment or backend/.env)', () => {
    const target = url('localhost:5432/nfouz_contract_test');
    expect(rejection(target, { DATABASE_URL: target })).toMatch(/developer database/);
    expect(rejection(target, { DATABASE_URL: 'postgres://other:x@127.0.0.1:5432/nfouz_contract_test' })).toMatch(/developer database/);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfouz-contract-env-'));
    const envFile = path.join(dir, '.env');
    fs.writeFileSync(envFile, 'PORT=3000\nDATABASE_URL=postgres://nfouz:pw@localhost:5432/nfouz_contract_test\n');
    try {
      expect(rejection(target, {}, envFile)).toMatch(/developer database/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refuses malformed URLs and other protocols without echoing them', () => {
    expect(rejection(`mysql://u:${PASSWORD}@localhost/nfouz_contract_test`)).toMatch(/must start with postgres/);
    expect(rejection(`not a url ${PASSWORD}`)).toMatch(/not a valid URL \(value not shown\)/);
  });

  test('accepts a local, dedicated contract-test database', () => {
    for (const host of ['localhost:5432', '127.0.0.1:5436', '[::1]:5432']) {
      const t = check(url(`${host}/nfouz_contract_test`), { DATABASE_URL: 'postgres://nfouz:x@localhost:5432/nfouz_db' });
      expect(t.database).toBe('nfouz_contract_test');
      expect(describeTarget(t)).not.toContain(PASSWORD);
    }
  });

  test('redacts passwords from any text', () => {
    const text = `connect ${url('localhost:5432/x')} failed; password=${PASSWORD}; other postgresql://a:b%40c@h/d`;
    const out = redact(text, [PASSWORD]);
    expect(out).not.toContain(PASSWORD);
    expect(out).not.toContain('b%40c');
    expect(out).toContain('postgres://nfouz_contract_test:***@localhost:5432/x');
  });

  test('run databases have a unique, unmistakable test-only name', () => {
    const a = newRunDatabaseName();
    const b = newRunDatabaseName();
    expect(a).not.toBe(b);
    expect(a).toMatch(RUN_DB_RE);
    expect(newRunDatabaseName(new Date('2026-10-18T13:14:15Z'), 'deadbeef')).toBe('nfouz_contract_test_run_20261018131415_deadbeef');
    expect(() => runDatabaseUrl(check(url('localhost:5432/nfouz_contract_test')), 'nfouz_db')).toThrow(SafetyError);
  });

  test('drops only the database this run created, with its ownership marker', () => {
    const created = 'nfouz_contract_test_run_20261018131415_deadbeef';
    const base = { name: created, createdName: created, connectionDatabase: 'nfouz_contract_test', comment: ownershipMarker(created) };
    expect(mayDropDatabase(base).ok).toBe(true);
    expect(mayDropDatabase({ ...base, createdName: null }).ok).toBe(false);
    expect(mayDropDatabase({ ...base, name: 'nfouz_db' }).ok).toBe(false);
    expect(mayDropDatabase({ ...base, comment: null }).ok).toBe(false);
    expect(mayDropDatabase({ ...base, comment: ownershipMarker('nfouz_contract_test_run_20261018131415_00000000') }).ok).toBe(false);
    expect(mayDropDatabase({ ...base, name: 'nfouz_contract_test', createdName: 'nfouz_contract_test', connectionDatabase: 'nfouz_contract_test' }).ok).toBe(false);
  });
});
