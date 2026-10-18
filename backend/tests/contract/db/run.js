'use strict';

/**
 * `npm run test:contract:db` — runs the optional real-PostgreSQL contract
 * test. Checks the configuration first (no connection is made if it is
 * missing or unsafe) and prints setup instructions instead of running.
 * Works the same on Windows and Linux.
 */

const path = require('path');
const { spawnSync } = require('child_process');
const { validateConfig } = require('./dbSafety');

try {
  const target = validateConfig(process.env);
  process.stdout.write(`[contract:db] using ${target.user}@${target.host}:${target.port}/${target.database} (password not shown)\n`);
} catch (err) {
  process.stderr.write(`[contract:db] ${err.message}\n`);
  process.exit(2);
}

const jestBin = require.resolve('jest/bin/jest');
const backendDir = path.resolve(__dirname, '../../..');
const result = spawnSync(process.execPath, [
  jestBin, '--runInBand', '--rootDir', backendDir,
  '--testMatch', '**/tests/contract/db/unityContract.dbtest.js',
  ...process.argv.slice(2),
], { stdio: 'inherit', cwd: backendDir });
process.exit(result.status === null ? 1 : result.status);
