'use strict';

/**
 * Reads the Unity client's C# sources (no Unity needed) and extracts what
 * the Unity <-> backend contract test compares:
 *   - [Serializable] DTO classes and the field names/types JsonUtility
 *     (de)serializes (public fields + [SerializeField] private fields;
 *     properties, static, const and readonly members are not serialized),
 *   - every ApiClient call: HTTP method, path template, query parameter
 *     names, request DTO type, response DTO type, and which session-apply
 *     method the response is handed to,
 *   - every error code the client compares against.
 *
 * Deliberately a small, strict scanner: anything it cannot resolve
 * (e.g. an endpoint built in a way it does not understand) is reported as
 * an error by the test rather than silently skipped.
 */

const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = path.resolve(__dirname, '../../../Assets/_Project/Scripts');

function listCsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listCsFiles(full));
    else if (entry.name.endsWith('.cs')) out.push(full);
  }
  return out.sort();
}

/**
 * Replaces comments with spaces (keeping offsets and line numbers) while
 * leaving string and char literals intact. Handles "...", $"...", @"..."
 * and $@"..." literals.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && n === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
    } else if (c === '"' || ((c === '$' || c === '@') && (n === '"' || ((n === '$' || n === '@') && src[i + 2] === '"')))) {
      let prefix = '';
      while (src[i] !== '"') { prefix += src[i]; i++; }
      const verbatim = prefix.includes('@');
      out += prefix + '"'; i++;
      while (i < src.length) {
        if (verbatim && src[i] === '"' && src[i + 1] === '"') { out += '""'; i += 2; continue; }
        if (!verbatim && src[i] === '\\') { out += src[i] + src[i + 1]; i += 2; continue; }
        out += src[i];
        if (src[i] === '"') { i++; break; }
        i++;
      }
    } else if (c === '\'') {
      // char literal: '"', '\'', 'a'
      const end = src[i + 1] === '\\' ? i + 3 : i + 2;
      out += src.slice(i, end + 1); i = end + 1;
    } else {
      out += c; i++;
    }
  }
  return out;
}

/** Index of the bracket matching the one at `open` (which must be ( { or [). */
function matchBracket(text, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  let inStr = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === '}' || c === ']') {
      if (stack.pop() !== c) throw new Error(`Unbalanced bracket at ${i}`);
      if (stack.length === 0) return i;
    }
  }
  throw new Error(`No matching bracket for ${open}`);
}

/** Splits on commas that are not nested inside brackets or strings. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let inStr = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function loadSources() {
  return listCsFiles(SCRIPTS_DIR).map((file) => {
    const raw = fs.readFileSync(file, 'utf8');
    return { file, rel: path.relative(SCRIPTS_DIR, file).split(path.sep).join('/'), text: stripComments(raw) };
  });
}

/** Text of the class body (between its braces) for each class declaration. */
function* classBodies(source) {
  const re = /\bclass\s+(\w+)(?:<[^>]*>)?[^{;]*\{/g;
  let m;
  while ((m = re.exec(source.text))) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(source.text, open);
    const header = source.text.slice(Math.max(0, m.index - 200), m.index);
    yield { name: m[1], open, close, body: source.text.slice(open + 1, close), header };
  }
}

/** Removes nested { ... } blocks so only member declarations at class level remain. */
function flattenTopLevel(body) {
  let out = '';
  let depth = 0;
  for (const c of body) {
    if (c === '{') { depth++; continue; }
    // A member body (method, property accessors) becomes a marker that the
    // field pattern cannot match, so `int X { get; set; }` is not a field.
    if (c === '}') { depth--; if (depth === 0) out += ' {BODY};'; continue; }
    if (depth === 0) out += c;
  }
  return out;
}

function extractDtos(sources) {
  const dtos = {};
  for (const source of sources) {
    for (const cls of classBodies(source)) {
      if (!/\[Serializable\]\s*(public|internal)?\s*(sealed\s+)?$/.test(cls.header.trimEnd())) continue;
      const flat = flattenTopLevel(cls.body);
      const fields = [];
      const fieldRe = /((?:\[[^\]]*\]\s*)*)(public|private|protected|internal)?\s*((?:static|readonly|const|new)\s+)*([\w.]+(?:<[\w.,\s]+>)?(?:\[\])?)\s+(\w+)\s*(=[^;]*)?;/g;
      let f;
      while ((f = fieldRe.exec(flat))) {
        const [, attrs = '', access, mods, type, name] = f;
        if (mods) continue;
        if (['return', 'new', 'using', 'var', 'await'].includes(type)) continue;
        if (access === 'public' || /\bSerializeField\b/.test(attrs)) {
          fields.push({ name, type: type.replace(/\s+/g, '') });
        }
      }
      if (dtos[cls.name]) throw new Error(`Duplicate [Serializable] class ${cls.name} (${source.rel})`);
      dtos[cls.name] = { file: source.rel, fields };
    }
  }
  return dtos;
}

/** Enclosing method body (text between its braces) of position `index`. */
function enclosingMethod(text, index) {
  const re = /(?:public|private|protected|internal)[^;{}=]*\b(\w+)\s*\([^;{}]*\)\s*\{/g;
  let best = null;
  let m;
  while ((m = re.exec(text)) && m.index < index) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(text, open);
    if (close > index) best = { name: m[1], open, close, body: text.slice(open + 1, close) };
  }
  return best;
}

/** Converts a C# string/interpolated-string literal into a path template. */
function literalToTemplate(literal) {
  const m = /^\$?"((?:[^"\\]|\\.)*)"$/.exec(literal.trim());
  if (!m) return null;
  return m[1].replace(/\{[^}]*\}/g, '{}');
}

function resolvePathExpr(expr, method, sources) {
  expr = expr.trim();
  const literal = literalToTemplate(expr);
  if (literal !== null) return literal;

  // Local variable: var endpoint = ...;
  if (/^\w+$/.test(expr) && method) {
    const decl = new RegExp(`(?:var|string)\\s+${expr}\\s*=\\s*([^;]+);`).exec(method.body);
    if (decl) return resolvePathExpr(decl[1], method, sources);
  }

  // Static builder: SomeClass.Method(args) returning string.Format(..., "fmt", ...) or $"..."
  const call = /^(\w+)\.(\w+)\s*\(/.exec(expr);
  if (call) {
    for (const source of sources) {
      for (const cls of classBodies(source)) {
        if (cls.name !== call[1]) continue;
        const methodRe = new RegExp(`static\\s+string\\s+${call[2]}\\s*\\([^)]*\\)\\s*\\{`);
        const mm = methodRe.exec(cls.body);
        if (!mm) continue;
        const open = mm.index + mm[0].length - 1;
        const mbody = cls.body.slice(open + 1, matchBracket(cls.body, open));
        const fmt = /string\.Format\s*\(\s*(?:CultureInfo\.InvariantCulture\s*,\s*)?("(?:[^"\\]|\\.)*")/.exec(mbody);
        if (fmt) return literalToTemplate(fmt[1]).replace(/\{\d+\}/g, '{}');
        const ret = /return\s+(\$?"(?:[^"\\]|\\.)*")\s*;/.exec(mbody);
        if (ret) return literalToTemplate(ret[1]);
      }
    }
  }
  return null;
}

function resolvePayloadType(expr, method) {
  if (expr === undefined) return { type: null };
  expr = expr.trim();
  if (expr === 'null') return { type: null };
  const direct = /^new\s+(\w+)\s*[({]/.exec(expr);
  if (direct) return { type: direct[1] };
  if (/^\w+$/.test(expr) && method) {
    const decl = new RegExp(`(?:var|\\w+)\\s+${expr}\\s*=\\s*new\\s+(\\w+)\\s*[({]`).exec(method.body);
    if (decl) return { type: decl[1] };
  }
  return { type: undefined, expr };
}

const APPLY_RE = /\b(BattleSession|PlayerSession)\.(UpdateFromServer|ApplyReadyState|ApplyStatus)\s*\(/g;

function extractApiCalls(sources) {
  const calls = [];
  const re = /\.(Get|Post|Patch|Put|Delete)Async<([\w.]+)>\s*\(/g;
  for (const source of sources) {
    if (source.rel === 'Networking/ApiClient.cs') continue;
    let m;
    while ((m = re.exec(source.text))) {
      const open = m.index + m[0].length - 1;
      const close = matchBracket(source.text, open);
      const args = splitTopLevel(source.text.slice(open + 1, close));
      const method = enclosingMethod(source.text, m.index);
      const httpMethod = m[1].toUpperCase();
      const template = resolvePathExpr(args[0], method, sources);
      const hasBody = httpMethod === 'POST' || httpMethod === 'PATCH' || httpMethod === 'PUT';
      const payload = hasBody ? resolvePayloadType(args[1], method) : { type: null };

      // How the response is applied: session-apply calls after this call
      // in the same method, up to the next ApiClient call.
      const after = source.text.slice(close, method ? method.close : close);
      const nextCall = after.search(/\.(Get|Post|Patch|Put|Delete)Async</);
      const scope = nextCall >= 0 ? after.slice(0, nextCall) : after;
      const applies = [...scope.matchAll(APPLY_RE)].map((a) => `${a[1]}.${a[2]}`);

      let pathOnly = null;
      let query = [];
      if (template !== null) {
        const [p, q] = template.split('?');
        pathOnly = p;
        query = q ? q.split('&').map((kv) => kv.split('=')[0]) : [];
      }
      calls.push({
        where: `${source.rel}:${lineOf(source.text, m.index)}`,
        method: httpMethod,
        template,
        path: pathOnly,
        // Normalized key used to match scenarios: /battle/{}/ready
        key: pathOnly === null ? null : `${httpMethod} ${pathOnly}`,
        query,
        responseType: m[2],
        requestType: payload.type,
        unresolvedPayload: payload.expr,
        applies,
      });
    }
  }
  return calls;
}

/** Error codes the client compares against, and the Constants.ErrorCodes table. */
function extractErrorCodes(sources) {
  const constants = {};
  const constantsSrc = sources.find((s) => s.rel === 'Utils/Constants.cs');
  if (!constantsSrc) throw new Error('Utils/Constants.cs not found');
  const ecIndex = constantsSrc.text.search(/class\s+ErrorCodes\b/);
  if (ecIndex < 0) throw new Error('Constants.ErrorCodes not found');
  const open = constantsSrc.text.indexOf('{', ecIndex);
  const body = constantsSrc.text.slice(open + 1, matchBracket(constantsSrc.text, open));
  for (const c of body.matchAll(/const\s+string\s+(\w+)\s*=\s*"([^"]+)"/g)) constants[c[1]] = c[2];

  const handled = new Map(); // code -> first location
  const note = (code, where) => { if (!handled.has(code)) handled.set(code, where); };
  for (const source of sources) {
    if (source === constantsSrc) continue;
    const t = source.text;
    for (const m of t.matchAll(/Constants\.ErrorCodes\.(\w+)/g)) {
      if (!(m[1] in constants)) throw new Error(`${source.rel}: unknown Constants.ErrorCodes.${m[1]}`);
      note(constants[m[1]], `${source.rel}:${lineOf(t, m.index)}`);
    }
    // case "CODE": / "CODE" => / == "CODE" / != "CODE" on an error code
    for (const m of t.matchAll(/(?:case\s+"([A-Z][A-Z0-9_]{2,})"\s*:|"([A-Z][A-Z0-9_]{2,})"\s*=>|code\s*[!=]=\s*"([A-Z][A-Z0-9_]{2,})")/g)) {
      note(m[1] || m[2] || m[3], `${source.rel}:${lineOf(t, m.index)}`);
    }
  }
  return { constants, handled };
}

/**
 * Fields a BattleSession partial-apply method copies from its argument
 * (e.g. ApplyReadyState copies attacker_ready/defender_ready), plus the
 * battle_id it matches on. Lets the test check that each partial response
 * really carries everything the client reads from it.
 */
function extractApplyMethodReads(sources) {
  const src = sources.find((s) => s.rel === 'Networking/BattleSessionData.cs');
  if (!src) throw new Error('Networking/BattleSessionData.cs not found');
  const reads = {};
  for (const m of src.text.matchAll(/public\s+static\s+void\s+(\w+)\s*\(\s*BattleSessionData\s+(\w+)\s*\)\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const body = src.text.slice(open + 1, matchBracket(src.text, open));
    const fields = new Set([...body.matchAll(new RegExp(`\\b${m[2]}\\.(\\w+)`, 'g'))].map((x) => x[1]));
    // IsUpdateForCurrent(partial) compares partial.battle_id.
    if (/IsUpdateForCurrent\s*\(/.test(body)) fields.add('battle_id');
    reads[`BattleSession.${m[1]}`] = [...fields].sort();
  }
  return reads;
}

/**
 * The client's "refresh the token" rule, read from
 * AuthSession.IsTokenRejection: the HTTP status and error code it reacts to.
 */
function extractTokenRejectionRule(sources, constants) {
  const src = sources.find((s) => s.rel === 'Networking/AuthSession.cs');
  if (!src) throw new Error('Networking/AuthSession.cs not found');
  const m = /static\s+bool\s+IsTokenRejection\s*<\w+>\s*\([^)]*\)\s*\{/.exec(src.text);
  if (!m) throw new Error('AuthSession.IsTokenRejection not found');
  const open = m.index + m[0].length - 1;
  const body = src.text.slice(open + 1, matchBracket(src.text, open));
  const statuses = [...body.matchAll(/statusCode\s*==\s*(\d{3})/g)].map((x) => Number(x[1]));
  const codes = [...body.matchAll(/Constants\.ErrorCodes\.(\w+)/g)].map((x) => constants[x[1]]);
  return { statuses, codes };
}

function loadUnityContract() {
  if (!fs.existsSync(SCRIPTS_DIR)) {
    throw new Error(`Unity scripts not found at ${SCRIPTS_DIR} — the contract test needs the full repository checkout.`);
  }
  const sources = loadSources();
  const errorCodes = extractErrorCodes(sources);
  return {
    dtos: extractDtos(sources),
    calls: extractApiCalls(sources),
    errorCodes,
    applyReads: extractApplyMethodReads(sources),
    tokenRejection: extractTokenRejectionRule(sources, errorCodes.constants),
  };
}

module.exports = { loadUnityContract, stripComments, SCRIPTS_DIR };
