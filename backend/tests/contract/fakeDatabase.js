'use strict';

/**
 * In-process stand-in for src/config/database.js used only by the contract
 * test. Every SQL statement the real repositories issue is parsed
 * (sqlShape.js) and answered with rows whose columns are exactly the
 * statement's output columns, typed the way node-postgres would type them
 * (schema.js: BIGINT/NUMERIC -> string, timestamps -> Date, NULL for
 * nullable columns with no value). Values come from a small, consistent
 * "world" (one object per row, per table) supplied by the test.
 *
 * It does not evaluate WHERE clauses. It picks, per table, the world row
 * that shares the most values with the statement's parameters (so
 * "WHERE player_id = $1" finds that player), and it returns one row per
 * statement unless the scenario says a repository function finds nothing
 * (see setRowCounts).
 */

const { AsyncLocalStorage } = require('async_hooks');
const { shapeOf } = require('./sqlShape');

const FIXED_TIME = '2026-01-01T00:00:00.000Z';

function defaultValue(kind) {
  switch (kind) {
    case 'int': case 'float': case 'bigint': case 'numeric': return 0;
    case 'bool': return false;
    case 'timestamp': return FIXED_TIME;
    case 'json': return {};
    case 'void': return '';
    default: return 'x';
  }
}

/** Converts a world value into what node-postgres returns for `kind`. */
function toDriverValue(kind, value) {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case 'int': case 'float': return Number(value);
    case 'bigint': case 'numeric': return String(value);
    case 'bool': return Boolean(value);
    case 'timestamp': return new Date(value);
    case 'void': return '';
    case 'json': case 'interval': case 'array': return value;
    default: return String(value);
  }
}

function createFakeDatabase({ schema, nullable }) {
  const repoContext = new AsyncLocalStorage();
  let world = {};
  let rowCounts = {};
  let log = [];

  function pickRow(table, params) {
    const rows = world[table] || [];
    if (rows.length === 0) return {};
    const wanted = new Set(params.filter((p) => p !== null && p !== undefined && typeof p !== 'object').map(String));
    let best = rows[0];
    let bestScore = -1;
    for (const row of rows) {
      const score = Object.values(row).filter((v) => v !== null && wanted.has(String(v))).length;
      if (score > bestScore) { best = row; bestScore = score; }
    }
    return best;
  }

  function valueFor(col, params) {
    if (col.source) {
      const row = pickRow(col.source.table, params);
      if (col.source.column in row) return row[col.source.column];
      const mayBeNull = nullable[col.source.table] && nullable[col.source.table][col.source.column];
      return mayBeNull ? null : defaultValue(col.kind);
    }
    const expr = world.$expressions || {};
    if (col.name in expr) return expr[col.name];
    return col.kind === 'bool' ? true : defaultValue(col.kind);
  }

  async function query(text, params = []) {
    if (typeof text !== 'string') throw new Error('contract fake database: only query(text, params) is supported');
    const repoFn = repoContext.getStore() || '(outside a repository)';
    let shape;
    try {
      shape = shapeOf(text, schema);
    } catch (err) {
      throw new Error(`contract fake database cannot read SQL in ${repoFn}: ${err.message}\n${text.replace(/\s+/g, ' ').trim()}`);
    }
    const count = repoFn in rowCounts ? rowCounts[repoFn] : 1;
    log.push({ repoFn, verb: shape.verb, columns: shape.columns && shape.columns.map((c) => `${c.name}:${c.kind}`) });
    if (!shape.columns) return { rows: [], rowCount: count };
    const rows = [];
    for (let i = 0; i < count; i++) {
      const row = {};
      for (const col of shape.columns) row[col.name] = toDriverValue(col.kind, valueFor(col, params));
      rows.push(row);
    }
    return { rows, rowCount: rows.length };
  }

  const client = { query, release() {} };

  const databaseModule = {
    pool: { on() {}, query, connect: async () => client, end: async () => {} },
    query,
    checkConnection: async () => true,
    shutdown: async () => {},
    withTransaction: async (fn) => fn(client),
  };

  /**
   * Wraps every exported repository function so statements know which
   * repository function issued them (for setRowCounts and the log).
   * Services call repositories through the module object, so wrapping
   * the exports is enough.
   */
  function instrumentRepository(name, mod) {
    for (const [fnName, fn] of Object.entries(mod)) {
      if (typeof fn !== 'function') continue;
      const qualified = `${name}.${fnName}`;
      mod[fnName] = function instrumented(...args) {
        if (repoContext.getStore()) return fn.apply(this, args); // nested call keeps the outer name
        return repoContext.run(qualified, () => fn.apply(this, args));
      };
    }
  }

  return {
    databaseModule,
    instrumentRepository,
    /** Replaces the world: { table: [row, ...], $expressions: { alias: value } }. */
    setWorld(next) { world = next; },
    /** { 'battle.findActiveBattleForPlayer': 0 } — rows returned per statement. */
    setRowCounts(next) { rowCounts = next; },
    takeLog() { const l = log; log = []; return l; },
  };
}

module.exports = { createFakeDatabase, toDriverValue, FIXED_TIME };
