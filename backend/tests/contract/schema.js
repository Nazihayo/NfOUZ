'use strict';

/**
 * Column types of every table, read from backend/migrations/*.sql
 * (CREATE TABLE + ALTER TABLE ... ADD COLUMN), mapped to the JavaScript
 * value node-postgres returns for that type with its default parsers:
 *
 *   int2/int4 -> number      int8 (BIGINT), NUMERIC -> STRING
 *   real/double -> number    boolean -> boolean
 *   timestamp(tz)/date -> Date   uuid/varchar/text -> string
 *
 * The int8/numeric-as-string rule is why reward_coins (BIGINT) reached the
 * client as "100": the contract test's fake database applies these rules
 * so the same bug cannot come back unnoticed.
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

const TYPE_MAP = [
  [/^(SMALLINT|INT2|INT|INT4|INTEGER|SERIAL|SMALLSERIAL)\b/, 'int'],
  [/^(BIGINT|INT8|BIGSERIAL)\b/, 'bigint'],
  [/^(NUMERIC|DECIMAL)\b/, 'numeric'],
  [/^(REAL|FLOAT4|DOUBLE PRECISION|FLOAT8|FLOAT)\b/, 'float'],
  [/^(BOOLEAN|BOOL)\b/, 'bool'],
  [/^(TIMESTAMPTZ|TIMESTAMP|DATE)\b/, 'timestamp'],
  [/^(UUID|VARCHAR|CHARACTER VARYING|CHAR|TEXT|CITEXT)\b/, 'text'],
  [/^(JSONB|JSON)\b/, 'json'],
  [/^INTERVAL\b/, 'interval'],
];

function mapType(sqlType) {
  const t = sqlType.trim().toUpperCase();
  if (/\[\]/.test(t)) return 'array';
  for (const [re, kind] of TYPE_MAP) if (re.test(t)) return kind;
  return null;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function closeParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  throw new Error('unbalanced parentheses in migration');
}

const NOT_A_COLUMN = /^(PRIMARY|UNIQUE|CHECK|CONSTRAINT|FOREIGN|EXCLUDE|LIKE)\b/i;

function addColumn(tables, table, def, file) {
  const m = /^"?(\w+)"?\s+(.+)$/s.exec(def.trim());
  if (!m) throw new Error(`${file}: cannot read column definition "${def}"`);
  const type = mapType(m[2]);
  if (!type) throw new Error(`${file}: unknown SQL type for ${table}.${m[1]}: "${m[2].slice(0, 40)}"`);
  // PRIMARY KEY implies NOT NULL; everything else is nullable unless declared.
  const notNull = /\bNOT\s+NULL\b|\bPRIMARY\s+KEY\b/i.test(m[2]) || /SERIAL\b/i.test(m[2]);
  tables[table][m[1]] = type;
  (nullability[table] = nullability[table] || {})[m[1]] = !notNull;
}

const nullability = {};

/** { table: { column: true if the column may be NULL } } (after loadSchema). */
function loadNullability() {
  loadSchema();
  return nullability;
}

function loadSchema() {
  const tables = {};
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(/gi)) {
      const open = m.index + m[0].length - 1;
      const body = sql.slice(open + 1, closeParen(sql, open));
      const table = m[1];
      // CREATE TABLE IF NOT EXISTS on an existing table is a no-op.
      if (tables[table]) continue;
      tables[table] = {};
      for (const def of splitTopLevel(body)) {
        if (!NOT_A_COLUMN.test(def)) addColumn(tables, table, def, file);
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?(\w+)([^;]*);/gi)) {
      const table = m[1];
      for (const clause of splitTopLevel(m[2])) {
        const add = /^ADD COLUMN\s+(IF NOT EXISTS\s+)?(.+)$/is.exec(clause);
        if (add) {
          if (!tables[table]) throw new Error(`${file}: ALTER TABLE on unknown table ${table}`);
          const column = /^"?(\w+)/.exec(add[2])[1];
          // ADD COLUMN IF NOT EXISTS on an existing column is a no-op.
          if (add[1] && column in tables[table]) continue;
          addColumn(tables, table, add[2], file);
        } else if (/^(ALTER COLUMN|RENAME|DROP COLUMN)\b/i.test(clause)) {
          throw new Error(`${file}: "${clause.slice(0, 40)}" is not supported by the contract test's schema reader — extend tests/contract/schema.js`);
        }
      }
    }
  }
  return tables;
}

module.exports = { loadSchema, loadNullability, mapType };
