'use strict';

/**
 * Starts the real backend against a throwaway PostgreSQL database for the
 * real-database tests (*.dbtest.js), and tears it down again. One
 * implementation of the safety-critical steps for every such test file:
 * create + mark the run database (throwawayDatabase.js), run the
 * migrations, load the backend's own modules pointed at that database
 * only, and on the way out drop it after the ownership checks — reporting
 * a failed cleanup instead of hiding it.
 *
 * `ctx` is filled in step by step, so stopRealBackend can clean up
 * whatever exists even when startRealBackend failed half-way.
 */

const fs = require('fs');
const { createRunDatabase, migrate, dropRunDatabase } = require('./throwawayDatabase');

/**
 * @param target  validated config (dbSafety.validateConfig)
 * @param ctx     {} — receives state, db, app
 * @param {(db) => void} [beforeAppLoad]  e.g. instrumentation, run before the app's modules load
 */
async function startRealBackend(target, ctx, { beforeAppLoad } = {}) {
  try {
    ctx.state = await createRunDatabase(target);
  } catch (err) {
    ctx.state = err.state || null;
    throw err;
  }
  await migrate(ctx.state);

  // From here on the backend's own modules load, pointed at the run database only.
  process.env.DATABASE_URL = ctx.state.runUrl;
  // eslint-disable-next-line global-require
  ctx.db = require('../../../src/config/database');
  if (beforeAppLoad) beforeAppLoad(ctx.db);
  // eslint-disable-next-line global-require
  ctx.app = require('../../../src/app')();
  return ctx;
}

/** Closes the backend's pool and drops the run database; throws (after reporting) if cleanup failed. */
async function stopRealBackend(ctx) {
  if (ctx.db) {
    // Bounded: a stuck query must not keep cleanup from running.
    // DROP DATABASE ... WITH (FORCE) ends any connection still open.
    await Promise.race([
      ctx.db.shutdown().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 10000).unref()),
    ]);
  }
  const cleanup = await dropRunDatabase(ctx.state);
  const name = ctx.state && ctx.state.createdName;
  if (process.env.CONTRACT_DB_CLEANUP_REPORT) {
    fs.appendFileSync(process.env.CONTRACT_DB_CLEANUP_REPORT, `${JSON.stringify({ database: name, ...cleanup })}\n`);
  }
  if (cleanup.problems.length) {
    // Reported in addition to (never instead of) any test failures.
    // eslint-disable-next-line no-console
    console.error(`[contract:db] CLEANUP FAILED:\n  ${cleanup.problems.join('\n  ')}`);
    throw new Error(`cleanup failed: ${cleanup.problems.join('; ')}`);
  }
}

module.exports = { startRealBackend, stopRealBackend };
