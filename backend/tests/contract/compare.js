'use strict';

/**
 * Compares a JSON value with the Unity DTO that JsonUtility parses it
 * into, and lists every difference as a finding:
 *   missing   - the DTO has a field the JSON lacks (stays at its C# default)
 *   extra     - the JSON has a key the DTO lacks (silently dropped)
 *   type      - the JSON value cannot be read as the field's C# type
 *               (e.g. "100" for an int — JsonUtility will not parse it)
 *   null      - JSON null for a C# value type (int/float/bool/array)
 *   unchecked - an empty array of DTOs: its element shape was not tested
 */

const INT_TYPES = new Set(['int', 'long', 'short', 'byte', 'uint', 'ulong', 'ushort', 'sbyte']);
const FLOAT_TYPES = new Set(['float', 'double', 'decimal']);

function elementType(type) {
  const list = /^List<(.+)>$/.exec(type);
  if (list) return list[1];
  if (type.endsWith('[]')) return type.slice(0, -2);
  return null;
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return `${typeof value} ${JSON.stringify(value).slice(0, 40)}`;
}

function compareToDto(dtos, dtoName, value, at, findings) {
  const dto = dtos[dtoName];
  if (!dto) throw new Error(`Unity DTO ${dtoName} not found`);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    findings.push({ kind: 'type', dto: dtoName, field: '(object)', at, detail: `expected an object, got ${describe(value)}` });
    return;
  }
  const fieldNames = new Set(dto.fields.map((f) => f.name));
  for (const key of Object.keys(value)) {
    if (!fieldNames.has(key)) findings.push({ kind: 'extra', dto: dtoName, field: key, at, detail: `server sends "${key}" (${describe(value[key])}); ${dtoName} has no such field` });
  }
  for (const field of dto.fields) {
    if (!(field.name in value)) {
      findings.push({ kind: 'missing', dto: dtoName, field: field.name, at, detail: `${dtoName}.${field.name} (${field.type}) is not in the response` });
      continue;
    }
    compareValue(dtos, dtoName, field, value[field.name], `${at}.${field.name}`, findings);
  }
}

function compareValue(dtos, dtoName, field, v, at, findings) {
  const t = field.type;
  const push = (kind, detail) => findings.push({ kind, dto: dtoName, field: field.name, at, detail });
  const elem = elementType(t);

  if (v === null) {
    if (t === 'string' || t === 'object' || dtos[t]) return; // reference types: null is fine
    push('null', `${dtoName}.${field.name} is ${t}; server sends null (client reads ${elem ? 'an empty/null array' : 'the C# default'})`);
    return;
  }
  if (elem) {
    if (!Array.isArray(v)) { push('type', `${dtoName}.${field.name} is ${t}; server sends ${describe(v)}`); return; }
    if (v.length === 0 && dtos[elem]) {
      push('unchecked', `${dtoName}.${field.name} is an empty array, so ${elem} was not checked — make the scenario return at least one`);
      return;
    }
    v.forEach((item, i) => {
      if (dtos[elem]) compareToDto(dtos, elem, item, `${at}[${i}]`, findings);
      else compareValue(dtos, dtoName, { name: field.name, type: elem }, item, `${at}[${i}]`, findings);
    });
    return;
  }
  if (t === 'string') { if (typeof v !== 'string') push('type', `${dtoName}.${field.name} is string; server sends ${describe(v)}`); return; }
  if (INT_TYPES.has(t)) { if (typeof v !== 'number' || !Number.isInteger(v)) push('type', `${dtoName}.${field.name} is ${t}; server sends ${describe(v)}`); return; }
  if (FLOAT_TYPES.has(t)) { if (typeof v !== 'number') push('type', `${dtoName}.${field.name} is ${t}; server sends ${describe(v)}`); return; }
  if (t === 'bool') { if (typeof v !== 'boolean') push('type', `${dtoName}.${field.name} is bool; server sends ${describe(v)}`); return; }
  if (t === 'object') return;
  if (dtos[t]) { compareToDto(dtos, t, v, at, findings); return; }
  push('type', `no comparison rule for C# type ${t} (${dtoName}.${field.name})`);
}

/** Leaf field paths a request DTO serializes to (nested DTOs flattened). */
function requestFieldPaths(dtos, dtoName, prefix = '') {
  const out = [];
  for (const f of dtos[dtoName].fields) {
    const p = prefix ? `${prefix}.${f.name}` : f.name;
    if (dtos[f.type]) out.push(p, ...requestFieldPaths(dtos, f.type, p));
    else out.push(p);
  }
  return out;
}

/**
 * A JSON body shaped exactly like JsonUtility.ToJson(new DtoName{...}):
 * every DTO field, scenario values where given, C# defaults otherwise.
 * Scenario values for fields the DTO does not have are listed in
 * `unknown` (the DTO was probably renamed) and not sent.
 */
function buildRequestBody(dtos, dtoName, values = {}, at = dtoName, unknown = []) {
  const dto = dtos[dtoName];
  const known = new Set(dto.fields.map((f) => f.name));
  for (const k of Object.keys(values)) if (!known.has(k)) unknown.push(`${at}.${k}`);
  const body = {};
  for (const f of dto.fields) {
    if (dtos[f.type]) body[f.name] = buildRequestBody(dtos, f.type, values[f.name] || {}, `${at}.${f.name}`, unknown).body;
    else if (f.name in values) body[f.name] = values[f.name];
    else if (f.type === 'string') body[f.name] = ''; // JsonUtility writes "" for a null string
    else if (f.type === 'bool') body[f.name] = false;
    else if (INT_TYPES.has(f.type) || FLOAT_TYPES.has(f.type)) body[f.name] = 0;
    else if (elementType(f.type)) body[f.name] = [];
    else throw new Error(`cannot default ${dtoName}.${f.name} (${f.type})`);
  }
  return { body, unknown };
}

module.exports = { compareToDto, requestFieldPaths, buildRequestBody };
