'use strict';

const { Pool } = require('pg');
const env = require('./env');
const logger = require('../utils/logger');

/**
 * Single shared PostgreSQL connection pool for the whole process.
 * Repositories (added in later sprints) import `query()` from here —
 * no controller or service ever opens its own connection.
 */

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // Errors on idle clients in the pool — log but do not crash the process.
  logger.error('Unexpected PostgreSQL pool error', { error: err.message, stack: err.stack });
});

/**
 * Run a parameterized query against the pool.
 * @param {string} text
 * @param {Array<any>} params
 */
async function query(text, params = []) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const durationMs = Date.now() - start;

  if (durationMs > 200) {
    logger.warn('Slow query detected', { text, durationMs, rows: result.rowCount });
  }

  return result;
}

/**
 * Verifies the database is reachable. Used by the health endpoint.
 * @returns {Promise<boolean>}
 */
async function checkConnection() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    logger.error('Database connection check failed', { error: err.message });
    return false;
  }
}

/**
 * Sprint 6 correction pass — battle resolution (result + Influence +
 * Influence log + Control state) must be atomic: either all of it
 * persists or none of it does. Runs `fn(client)` inside BEGIN/COMMIT,
 * rolling back on any thrown error (including an ApiError raised by the
 * service layer mid-transaction, e.g. a lost idempotency race). Callers
 * pass `client` through to repository functions' `executor` parameter
 * instead of using the shared pool's `query()` directly, so every
 * statement in `fn` runs on the same reserved connection.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function shutdown() {
  await pool.end();
}

module.exports = { pool, query, checkConnection, shutdown, withTransaction };
