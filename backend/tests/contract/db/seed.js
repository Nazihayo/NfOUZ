'use strict';

/**
 * Puts the shared contract-test world (../world.js) into the run
 * database, so the real-database mode starts every scenario from exactly
 * the state the fake-database mode uses.
 */

const { RUN_DB_RE, SafetyError } = require('./dbSafety');

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name) {
  if (!IDENT.test(name)) throw new SafetyError(`refusing SQL identifier "${name}"`);
  return `"${name}"`;
}

/** Fails unless the pool is connected to this run's own database. */
async function assertRunDatabase(pool, runDatabase) {
  const { rows: [r] } = await pool.query('SELECT current_database() AS db');
  if (r.db !== runDatabase || !RUN_DB_RE.test(r.db)) {
    throw new SafetyError(`refusing to modify "${r.db}": it is not this run's database`);
  }
}

/**
 * The migrations seed reference data (items, quest definitions). The world
 * uses the same rows; check they agree before the first reseed replaces them.
 */
async function migrationSeedProblems(pool, world) {
  const problems = [];
  for (const item of world.items || []) {
    const { rows } = await pool.query('SELECT item_type, rarity FROM items WHERE name = $1', [item.name]);
    if (rows.length !== 1) problems.push(`world item "${item.name}" is not seeded by the migrations`);
    else if (rows[0].item_type !== item.item_type || rows[0].rarity !== item.rarity) {
      problems.push(`world item "${item.name}" is ${item.item_type}/${item.rarity}; migrations seed ${rows[0].item_type}/${rows[0].rarity}`);
    }
  }
  for (const q of world.quest_definitions || []) {
    const { rows } = await pool.query(
      'SELECT quest_type, goal_type, goal_target, reward_coins, reward_bp_xp FROM quest_definitions WHERE title = $1',
      [q.title]
    );
    if (rows.length !== 1) { problems.push(`world quest "${q.title}" is not seeded by the migrations`); continue; }
    for (const k of ['quest_type', 'goal_type', 'goal_target', 'reward_coins', 'reward_bp_xp']) {
      if (String(rows[0][k]) !== String(q[k])) problems.push(`world quest "${q.title}" ${k}=${q[k]}; migrations seed ${rows[0][k]}`);
    }
  }
  return problems;
}

/** Empties every application table of the run database and inserts the world. */
async function reseed(pool, runDatabase, world) {
  await assertRunDatabase(pool, runDatabase);
  const { rows } = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY tablename"
  );
  if (rows.length > 0) {
    await pool.query(`TRUNCATE ${rows.map((r) => ident(r.tablename)).join(', ')} RESTART IDENTITY CASCADE`);
  }
  // Object key order in world.js is foreign-key order.
  for (const [table, tableRows] of Object.entries(world)) {
    if (table.startsWith('$')) continue;
    for (const row of tableRows) {
      const cols = Object.keys(row);
      const sql = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES (${cols.map((c, i) => `$${i + 1}`).join(', ')})`;
      try {
        await pool.query(sql, cols.map((c) => row[c]));
      } catch (err) {
        throw new Error(`seeding ${table} failed: ${err.message}`);
      }
    }
  }
}

module.exports = { reseed, migrationSeedProblems, assertRunDatabase };
