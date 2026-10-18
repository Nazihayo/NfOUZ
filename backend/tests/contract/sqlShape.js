'use strict';

/**
 * Output columns of one SQL statement, as node-postgres would return
 * them: name + value kind (see schema.js) + the table column the value
 * comes from, when there is one. Covers the SQL the repositories actually
 * use (SELECT lists, *, alias.*, RETURNING, CTEs, CASE, COUNT/SUM/
 * COALESCE/MAX/MIN, comparisons, casts). Anything else throws, naming the
 * statement, so an unsupported query is a visible test failure — never a
 * silently wrong shape.
 */

const KEYWORDS = new Set([
  'ON', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'GROUP', 'ORDER',
  'LIMIT', 'OFFSET', 'FOR', 'SET', 'RETURNING', 'VALUES', 'USING', 'HAVING', 'UNION', 'AS',
]);

function topLevel(sql) {
  // Same string with parenthesised parts and string literals blanked out,
  // so keyword searches only see the statement's own level.
  let out = '';
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inStr) { out += ' '; if (c === '\'') inStr = false; continue; }
    if (c === '\'') { inStr = true; out += ' '; continue; }
    if (c === '(') { depth++; out += depth === 1 ? '(' : ' '; continue; }
    if (c === ')') { depth--; out += depth === 0 ? ')' : ' '; continue; }
    out += depth > 0 ? ' ' : c;
  }
  return out;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let inStr = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === '\'') inStr = false; continue; }
    if (c === '\'') inStr = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

function closeParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  throw new Error('unbalanced parentheses');
}

/** Position of a top-level keyword (word-bounded), or -1. */
function findKeyword(sql, keyword, from = 0) {
  const flat = topLevel(sql);
  const re = new RegExp(`\\b${keyword}\\b`, 'ig');
  re.lastIndex = from;
  const m = re.exec(flat);
  return m ? m.index : -1;
}

const CAST_TYPES = [
  [/^(int|int2|int4|integer|smallint)$/i, 'int'],
  [/^(bigint|int8)$/i, 'bigint'],
  [/^(numeric|decimal)/i, 'numeric'],
  [/^(real|float4|float8|double precision|float)$/i, 'float'],
  [/^(bool|boolean)$/i, 'bool'],
  [/^(date|timestamp|timestamptz)$/i, 'timestamp'],
  [/^(text|varchar|uuid)$/i, 'text'],
];

function castKind(type) {
  for (const [re, kind] of CAST_TYPES) if (re.test(type.trim())) return kind;
  throw new Error(`unsupported cast ::${type}`);
}

function stripOuterParens(expr) {
  let e = expr.trim();
  while (e.startsWith('(') && closeParen(e, 0) === e.length - 1) e = e.slice(1, -1).trim();
  return e;
}

class Scope {
  constructor(schema) {
    this.schema = schema;
    this.aliases = {}; // alias -> table (or CTE name)
    this.order = [];   // tables in FROM order
    this.ctes = {};    // name -> output columns
  }

  columnsOf(table) {
    if (this.ctes[table]) return this.ctes[table];
    const cols = this.schema[table];
    if (!cols) throw new Error(`unknown table ${table}`);
    return Object.entries(cols).map(([name, kind]) => ({ name, kind, source: { table, column: name } }));
  }

  add(table, alias) {
    this.order.push(table);
    this.aliases[table] = table;
    if (alias) this.aliases[alias] = table;
  }

  column(ref) {
    const parts = ref.split('.');
    const tables = parts.length === 2 ? [this.aliases[parts[0]]] : this.order;
    const name = parts[parts.length - 1];
    for (const t of tables) {
      if (!t) break;
      const col = this.columnsOf(t).find((c) => c.name === name);
      if (col) return col;
    }
    return null;
  }
}

function inferKind(expr, scope) {
  let e = stripOuterParens(expr);


  // Order matters: a CASE or a comparison may contain casts of its own.
  const flat = topLevel(e);
  if (/^CASE\b/i.test(e)) {
    const then = /\bTHEN\s+(.+?)\s+(?:WHEN|ELSE|END)\b/i.exec(e);
    if (!then) throw new Error(`cannot read CASE ${e}`);
    return inferKind(then[1], scope);
  }
  if (/\b(AND|OR|NOT|IS|IN|LIKE|BETWEEN|EXISTS)\b|<=|>=|<>|!=|[=<>]/i.test(flat)) return { kind: 'bool' };

  const cast = /::\s*([a-z0-9_ ]+(?:\([^)]*\))?)\s*$/i.exec(e);
  if (cast && flat.lastIndexOf('::') === cast.index) return { kind: castKind(cast[1]) };

  if (/^\$\d+$/.test(e)) throw new Error(`untyped parameter ${e} in output`);
  if (/^-?\d+$/.test(e)) return { kind: 'int' };
  if (/^'.*'$/.test(e)) return { kind: 'text' };
  if (/^(TRUE|FALSE)$/i.test(e)) return { kind: 'bool' };
  if (/^now\(\)$/i.test(e)) return { kind: 'timestamp' };

  const ref = /^(\w+\.)?\w+$/.exec(e);
  if (ref) {
    const col = scope.column(e);
    if (!col) throw new Error(`unknown column ${e}`);
    return { kind: col.kind, source: col.source };
  }


  const fn = /^(\w+)\s*\(/.exec(e);
  if (fn && closeParen(e, fn[0].length - 1) === e.length - 1) {
    const name = fn[1].toUpperCase();
    const args = splitTopLevel(e.slice(fn[0].length, -1));
    if (name === 'COUNT') return { kind: 'bigint' };
    if (name === 'SUM') {
      // SUM(int) is bigint and SUM(bigint) is numeric — strings either way.
      const inner = inferKind(args[0], scope);
      return { kind: inner.kind === 'float' ? 'float' : inner.kind === 'int' ? 'bigint' : 'numeric' };
    }
    if (['COALESCE', 'MAX', 'MIN', 'GREATEST', 'LEAST'].includes(name)) return inferKind(args[0], scope);
    if (name === 'PG_ADVISORY_XACT_LOCK') return { kind: 'void' };
    throw new Error(`no type rule for function ${fn[1]}()`);
  }

  const arith = /^(.+?)\s*[-+*/]\s*(.+)$/.exec(flat);
  if (arith) return inferKind(e.slice(0, arith[1].length), scope);

  throw new Error(`cannot infer the type of "${e}"`);
}

function outputName(expr) {
  const e = stripOuterParens(expr);
  const ref = /^(?:\w+\.)?([A-Za-z_]\w*)$/.exec(e);
  if (ref) return ref[1];
  const fn = /^(\w+)\s*\(/.exec(e);
  return fn ? fn[1].toLowerCase() : '?column?';
}

function outputList(list, scope) {
  const cols = [];
  for (const item of splitTopLevel(list)) {
    const star = /^(?:(\w+)\.)?\*$/.exec(item);
    if (star) {
      const tables = star[1] ? [scope.aliases[star[1]]] : scope.order;
      for (const t of tables) {
        if (!t) throw new Error(`unknown alias in ${item}`);
        cols.push(...scope.columnsOf(t));
      }
      continue;
    }
    const as = /^(.*\S)\s+AS\s+"?(\w+)"?$/is.exec(item);
    const expr = as ? as[1] : item;
    const kind = inferKind(expr, scope);
    cols.push({ name: as ? as[2] : outputName(expr), kind: kind.kind, source: kind.source || null, expr });
  }
  return cols;
}

function collectTables(clause, scope) {
  for (const m of topLevel(clause).matchAll(/(?<!\bDO\s)\b(?:FROM|JOIN|UPDATE|INTO)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi)) {
    const alias = m[2] && !KEYWORDS.has(m[2].toUpperCase()) ? m[2] : null;
    scope.add(m[1], alias);
  }
}

function shapeOf(sql, schema, outerCtes = {}) {
  let text = sql.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
  const scope = new Scope(schema);
  Object.assign(scope.ctes, outerCtes);

  if (/^WITH\b/i.test(text)) {
    let rest = text.slice(4).trim();
    for (;;) {
      const m = /^(\w+)\s+AS\s*\(/i.exec(rest);
      if (!m) throw new Error('cannot read WITH clause');
      const open = m[0].length - 1;
      const close = closeParen(rest, open);
      scope.ctes[m[1]] = shapeOf(rest.slice(open + 1, close), schema, scope.ctes).columns;
      rest = rest.slice(close + 1).trim();
      if (rest.startsWith(',')) { rest = rest.slice(1).trim(); continue; }
      break;
    }
    text = rest;
  }

  const kind = (/^(\w+)/.exec(text) || [])[1];
  if (!kind) throw new Error('empty statement');
  const verb = kind.toUpperCase();
  if (verb === 'SELECT') {
    const from = findKeyword(text, 'FROM');
    collectTables(from >= 0 ? text.slice(from) : '', scope);
    const list = text.slice(6, from >= 0 ? from : text.length).replace(/^\s*DISTINCT\b/i, '');
    return { verb, columns: outputList(list, scope) };
  }
  if (verb === 'INSERT' || verb === 'UPDATE' || verb === 'DELETE') {
    const ret = findKeyword(text, 'RETURNING');
    collectTables(ret >= 0 ? text.slice(0, ret) : text, scope);
    if (ret < 0) return { verb, columns: null };
    return { verb, columns: outputList(text.slice(ret + 'RETURNING'.length), scope) };
  }
  throw new Error(`unsupported statement ${verb}`);
}

module.exports = { shapeOf };
