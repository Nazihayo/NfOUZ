'use strict';

/**
 * Minimal migration runner for Sprint 1.
 * Applies every .sql file in /migrations in filename order, tracking
 * applied files in a schema_migrations table so re-runs are safe.
 *
 * Usage: npm run migrate
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');
const logger = require('../src/utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations() {
  const result = await pool.query('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map((row) => row.filename));
}

async function applyMigration(filename) {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filePath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    logger.info(`Applied migration: ${filename}`);
  } finally {
    client.release();
  }
}

async function run() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      logger.info(`Skipping already-applied migration: ${file}`);
      continue;
    }
    await applyMigration(file);
  }

  logger.info('All migrations applied successfully.');
  await pool.end();
}

run().catch((err) => {
  logger.error('Migration run failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
