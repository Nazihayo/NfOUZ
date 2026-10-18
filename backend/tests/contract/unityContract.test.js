'use strict';

/**
 * Unity <-> backend contract regression test.
 *
 * Reads the Unity client's C# sources (Assets/_Project/Scripts) and runs
 * every endpoint the client calls through the REAL Express app,
 * controllers, services and repository SQL. Only three things are
 * replaced, in-process: the PostgreSQL driver (tests/contract/
 * fakeDatabase.js — rows typed like node-postgres from the migrations),
 * Firebase token verification (the bearer token is used as the uid) and
 * the rate limiters. No Unity, database, Docker, network or credentials.
 *
 * Checks:
 *   1. every client call has a scenario, and every scenario a client call
 *   2. every client call reaches a backend route (method + path)
 *   3. request bodies / query strings: what the client sends (Unity
 *      request DTO, JsonUtility field names) vs what the backend reads
 *   4. success responses vs the Unity DTO that parses them: missing and
 *      extra fields, wrong JSON types (e.g. a number sent as a string)
 *   5. partial responses (battle ready/reconnect) are applied with the
 *      matching partial-apply method, never as a full session
 *   6. every error code the client handles is one the backend sends, and
 *      the error envelope matches the client's ApiResponse/ApiError
 * Intentional differences live in tests/contract/allowlist.js.
 */

process.env.NODE_ENV = 'test';

jest.mock('../../src/config/database', () => require('./fakeDatabaseInstance').databaseModule);
jest.mock('../../src/config/firebase', () => ({
  initializeFirebase: () => {},
  checkFirebaseReady: () => true,
  verifyIdToken: async (token) => ({ uid: token }),
  admin: {
    messaging: () => ({
      send: async () => 'message-id',
      sendEachForMulticast: async (m) => ({
        successCount: m.tokens.length,
        failureCount: 0,
        responses: m.tokens.map(() => ({ success: true })),
      }),
    }),
  },
}));
jest.mock('../../src/middleware/rateLimit.middleware', () => {
  const passThrough = (req, res, next) => next();
  return {
    locationUpdateLimiter: passThrough,
    nearbyQueryLimiter: passThrough,
    battleChallengeLimiter: passThrough,
    friendRequestLimiter: passThrough,
    sosCreateLimiter: passThrough,
  };
});

const fs = require('fs');
const path = require('path');
const request = require('supertest');

const fake = require('./fakeDatabaseInstance');
const { loadSchema } = require('./schema');
const { loadUnityContract } = require('./unitySource');
const { installRecorder, startRecording, routeExists, backendErrorCodes } = require('./harness');
const { compareToDto, requestFieldPaths, buildRequestBody } = require('./compare');
const { baseWorld, DEFAULT_ROW_COUNTS } = require('./world');
const scenarios = require('./scenarios');
const allowlist = require('./allowlist');

// Repositories are instrumented before the app (and its services) load.
const REPO_DIR = path.resolve(__dirname, '../../src/repositories');
for (const file of fs.readdirSync(REPO_DIR).filter((f) => f.endsWith('.repository.js'))) {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  fake.instrumentRepository(file.replace('.repository.js', ''), require(path.join(REPO_DIR, file)));
}
installRecorder();
const createApp = require('../../src/app');

const unity = loadUnityContract();
const { dtos } = unity;
const schema = loadSchema();
const app = createApp();

const used = new Set(); // allowlist entries that excused something
const useEntry = (kind, entry) => used.add(`${kind}:${JSON.stringify(entry)}`);

function fillPath(pathTemplate, values = []) {
  let i = 0;
  const filled = pathTemplate.replace(/\{\}/g, () => {
    if (i >= values.length) throw new Error(`scenario has no value for path segment ${i + 1} of ${pathTemplate}`);
    return encodeURIComponent(values[i++]);
  });
  if (i !== values.length) throw new Error(`scenario gives ${values.length} path values; ${pathTemplate} has ${i}`);
  return filled;
}

function cloneWorld() {
  return JSON.parse(JSON.stringify(baseWorld()));
}

/** Fields a call site's full-session apply method requires in the response. */
function requiredFields(call) {
  const out = new Set();
  for (const a of call.applies) {
    const req = allowlist.fullSessionFields[a];
    if (req === '*') dtos[call.responseType].fields.forEach((f) => out.add(f.name));
    else if (req) req.forEach((f) => out.add(f));
  }
  return [...out];
}

/** Findings not excused by the allowlist, for one scenario run. */
function unexcused(key, findings, call) {
  const left = [];
  const partial = allowlist.partialResponses.find((p) => p.endpoint === key);
  for (const f of findings) {
    if (f.kind === 'missing' && partial && f.dto === partial.dto && f.at === 'data'
        && !partial.fields.includes(f.field)) {
      useEntry('partialResponses', partial);
      continue;
    }
    if (f.kind === 'extra') {
      const e = allowlist.ignoredServerKeys.find((x) => x.dto === f.dto && x.keys.includes(f.field)
        && (!x.endpoint || x.endpoint === key));
      if (e) { useEntry('ignoredServerKeys', e); continue; }
    }
    if (f.kind === 'missing') {
      const e = allowlist.absentFields.find((x) => x.endpoint === key && x.dto === f.dto
        && x.fields.includes(f.field) && f.at.replace(/\[\d+\]/g, '[]') === (x.at || 'data'));
      if (e && !requiredFields(call).includes(f.field)) { useEntry('absentFields', e); continue; }
    }
    if (f.kind === 'null') {
      const e = allowlist.nullableFields.find((x) => x.dto === f.dto && x.field === f.field
        && (!x.endpoint || x.endpoint === key));
      if (e) { useEntry('nullableFields', e); continue; }
    }
    if (f.kind === 'request-unsent' || f.kind === 'request-unread') {
      const e = allowlist.requestFields.find((x) => x.endpoint === key && x.field === f.field && x.kind === f.kind);
      if (e) { useEntry('requestFields', e); continue; }
    }
    left.push(f);
  }
  return left;
}

async function runScenario(scenario, call) {
  const world = cloneWorld();
  if (scenario.world) scenario.world(world);
  fake.setWorld(world);
  fake.setRowCounts({ ...DEFAULT_ROW_COUNTS, ...(scenario.rowCounts || {}) });
  fake.takeLog();

  const findings = [];
  const concretePath = fillPath(call.path, scenario.path);
  const queryNames = Object.keys(scenario.query || {});
  for (const q of queryNames) {
    if (!call.query.includes(q)) throw new Error(`${scenario.key}: scenario sets query "${q}", the client sends only [${call.query}]`);
  }
  const url = call.query.length
    ? `${concretePath}?${call.query.map((q) => `${q}=${encodeURIComponent((scenario.query || {})[q] ?? '0')}`).join('&')}`
    : concretePath;

  let body;
  const values = typeof scenario.body === 'function' ? scenario.body() : scenario.body;
  if (call.requestType) {
    const built = buildRequestBody(dtos, call.requestType, values);
    body = built.body;
    for (const u of built.unknown) findings.push({ kind: 'scenario', field: u, at: 'body', detail: `scenario sets ${u}, which the Unity request DTO does not have (renamed or removed?)` });
  } else if (values) {
    findings.push({ kind: 'scenario', field: '(body)', at: 'body', detail: `scenario has a body, but ${call.where} sends none` });
  }

  const rec = startRecording();
  let req = request(app)[call.method.toLowerCase()](url)
    .set('Content-Type', 'application/json')
    .set('Authorization', `Bearer ${scenario.as}`);
  if (body !== undefined) req = req.send(JSON.stringify(body));
  const res = await req;
  const log = fake.takeLog();

  const ok = res.status >= 200 && res.status < 300;
  const env = res.body;
  if (ok) {
    // Envelope (ApiResponse<T>): success/data/error.
    if (env.success !== true || !('data' in env) || !('error' in env) || env.error !== null) {
      findings.push({ kind: 'envelope', dto: 'ApiResponse', field: '(envelope)', at: 'response', detail: `unexpected success envelope ${JSON.stringify(env).slice(0, 120)}` });
    }
    if (call.responseType !== 'object') compareToDto(dtos, call.responseType, env.data, 'data', findings);
  }

  // Request body (checked even when the backend rejected the request —
  // a renamed request field usually is why it did): client fields vs backend reads.
  const sent = call.requestType ? requestFieldPaths(dtos, call.requestType) : [];
  const read = [...rec.body.reads];
  for (const r of read) {
    if (!sent.includes(r)) findings.push({ kind: 'request-unsent', field: r, at: 'body', detail: `backend reads body field "${r}"; the client (${call.requestType || 'no body'}) never sends it` });
  }
  for (const s of sent) {
    const covered = read.includes(s) || read.some((r) => s.startsWith(`${r}.`) && rec.body.enumerated.has(r));
    const parent = dtos[(dtos[call.requestType].fields.find((f) => f.name === s) || {}).type];
    if (!covered && !parent) findings.push({ kind: 'request-unread', field: s, at: 'body', detail: `client sends "${s}" (${call.requestType}); the backend never reads it` });
  }
  // Query string.
  for (const r of rec.query.reads) {
    if (!call.query.includes(r)) findings.push({ kind: 'request-unsent', field: r, at: 'query', detail: `backend reads query "${r}"; the client never sends it` });
  }
  for (const q of call.query) {
    if (!rec.query.reads.has(q)) findings.push({ kind: 'request-unread', field: q, at: 'query', detail: `client sends query "${q}"; the backend never reads it` });
  }

  return {
    ok, status: res.status, error: env && env.error, data: env && env.data, log, findings,
  };
}

function errorCodeProblems() {
  const backend = backendErrorCodes();
  const problems = [];
  const clientOnly = new Map(allowlist.clientOnlyErrorCodes.map((e) => [e.code, e]));
  for (const [code, where] of unity.errorCodes.handled) {
    if (backend.has(code)) continue;
    if (clientOnly.has(code)) { useEntry('clientOnlyErrorCodes', clientOnly.get(code)); continue; }
    problems.push(`${where}: handles "${code}", which the backend never sends`);
  }
  for (const [name, code] of Object.entries(unity.errorCodes.constants)) {
    if (backend.has(code)) continue;
    if (clientOnly.has(code)) { useEntry('clientOnlyErrorCodes', clientOnly.get(code)); continue; }
    problems.push(`Constants.ErrorCodes.${name} = "${code}" is not a backend error code`);
  }
  return problems;
}

const results = new Map(); // `${key}|${call.where}` -> result

beforeAll(async () => {
  for (const scenario of scenarios) {
    for (const call of unity.calls.filter((c) => c.key === scenario.key)) {
      // Calls with the same request/response types behave identically.
      const twin = [...results.values()].find((r) => r.call.key === call.key
        && r.call.requestType === call.requestType && r.call.responseType === call.responseType);
      let result;
      try {
        result = twin ? { ...twin.result } : await runScenario(scenario, call);
      } catch (err) {
        // Reported by this endpoint's own test, not as a suite-wide crash.
        result = { ok: false, status: 'harness error', error: err.message, log: [], findings: [] };
      }
      results.set(`${call.key}|${call.where}`, { call, scenario, result });
    }
  }
  // Record which allowlist entries excuse something, so the stale-entry
  // test does not depend on the other tests having run first.
  for (const { call, result } of results.values()) unexcused(call.key, result.findings, call);
  errorCodeProblems();
  for (const e of allowlist.clientOnlyEnvelopeFields) {
    if (dtos.ApiResponse.fields.some((f) => f.name === e.field)) useEntry('clientOnlyEnvelopeFields', e);
  }
});

// CONTRACT_REPORT=<file>: write every raw finding (before the allowlist)
// as JSON — handy when updating tests/contract/allowlist.js.
afterAll(() => {
  if (!process.env.CONTRACT_REPORT) return;
  const report = [...results.values()].map(({ call, result }) => ({
    endpoint: call.key, where: call.where, status: result.status, data: result.data, findings: result.findings,
  }));
  fs.writeFileSync(process.env.CONTRACT_REPORT, JSON.stringify(report, null, 2));
});

describe('Unity <-> backend contract', () => {
  test('every Unity API call is resolvable and has exactly one scenario', () => {
    const problems = [];
    for (const c of unity.calls) {
      if (c.key === null) problems.push(`${c.where}: cannot resolve the endpoint expression`);
      if (c.requestType === undefined) problems.push(`${c.where}: cannot resolve the request payload "${c.unresolvedPayload}"`);
      if (c.responseType !== 'object' && !dtos[c.responseType]) problems.push(`${c.where}: response type ${c.responseType} is not a [Serializable] DTO`);
      if (c.requestType && !dtos[c.requestType]) problems.push(`${c.where}: request type ${c.requestType} is not a [Serializable] DTO`);
      const n = scenarios.filter((s) => s.key === c.key).length;
      if (n !== 1) problems.push(`${c.where}: ${c.key} has ${n} scenarios in tests/contract/scenarios.js (need exactly 1)`);
    }
    for (const s of scenarios) {
      if (!unity.calls.some((c) => c.key === s.key)) problems.push(`scenario ${s.key} matches no Unity API call (stale or renamed endpoint)`);
    }
    expect(problems).toEqual([]);
  });

  test('every Unity endpoint exists in the backend router', () => {
    const missing = unity.calls
      .filter((c) => c.path && !routeExists(app, c.method, c.path.replace(/\{\}/g, 'x')))
      .map((c) => `${c.key} (${c.where}) — no backend route`);
    expect(missing).toEqual([]);
  });

  test('the world only uses real columns', () => {
    const bad = [];
    for (const [table, rows] of Object.entries(baseWorld())) {
      if (table.startsWith('$')) continue;
      if (!schema[table]) { bad.push(`unknown table ${table}`); continue; }
      for (const row of rows) for (const col of Object.keys(row)) if (!(col in schema[table])) bad.push(`${table}.${col}`);
    }
    expect(bad).toEqual([]);
  });

  describe.each(scenarios.map((s) => [s.key, s]))('%s', (key) => {
    test('succeeds and matches the Unity DTOs', () => {
      const runs = [...results.values()].filter((r) => r.call.key === key);
      expect(runs.length).toBeGreaterThan(0);
      const problems = [];
      for (const { call, result } of runs) {
        if (!result.ok) {
          problems.push(`${call.where}: HTTP ${result.status} ${JSON.stringify(result.error)}; repository calls: ${result.log.map((l) => l.repoFn).join(', ')}`);
        }
        for (const f of unexcused(key, result.findings, call)) problems.push(`${call.where}: [${f.kind}] ${f.detail} (at ${f.at})`);
      }
      expect(problems).toEqual([]);
    });
  });

  test('partial responses are applied as partial updates, never as a full session', () => {
    const problems = [];
    for (const p of allowlist.partialResponses) {
      const runs = [...results.values()].filter((r) => r.call.key === p.endpoint);
      if (runs.length === 0) { problems.push(`partial response ${p.endpoint} matches no Unity call`); continue; }
      for (const { call, result } of runs) {
        if (call.responseType !== p.dto) problems.push(`${call.where}: parses ${call.responseType}, allowlist says ${p.dto}`);
        if (!call.applies.includes(p.apply)) problems.push(`${call.where}: ${p.endpoint} is partial — the response must go to ${p.apply} (found: ${call.applies.join(', ') || 'nothing'})`);
        const full = call.applies.filter((a) => allowlist.fullSessionFields[a]);
        if (full.length) problems.push(`${call.where}: ${p.endpoint} is a partial response but is passed to ${full.join(', ')} (a full-session replace)`);
        if (result.ok) {
          const keys = Object.keys(result.data || {}).sort();
          if (JSON.stringify(keys) !== JSON.stringify([...p.fields].sort())) problems.push(`${p.endpoint}: response fields are [${keys}], allowlist documents [${p.fields}]`);
        }
      }
      const reads = unity.applyReads[p.apply];
      if (!reads) problems.push(`${p.apply} not found in BattleSessionData.cs`);
      else for (const f of reads) if (!p.fields.includes(f)) problems.push(`${p.apply} reads ${f}, which ${p.endpoint} does not send`);
    }
    // A response handed to a full-session replace must carry the fields that define the session.
    for (const { call, result } of results.values()) {
      if (!result.ok) continue;
      for (const f of requiredFields(call)) {
        if (!(f in (result.data || {}))) problems.push(`${call.where}: hands ${call.key} to a full-session replace (${call.applies.join(', ')}), but the response lacks ${f}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('every error code the client handles is one the backend sends', () => {
    expect(errorCodeProblems()).toEqual([]);
  });

  test('error responses match the client ApiResponse/ApiError envelope', async () => {
    fake.setWorld(cloneWorld());
    fake.setRowCounts({});
    const responses = [
      ['INVALID_TOKEN', await request(app).get('/auth/me')],
      ['NOT_FOUND', await request(app).get('/no-such-route').set('Authorization', 'Bearer uid-a')],
      ['INVALID_USERNAME', await request(app).post('/auth/register').set('Authorization', 'Bearer uid-a')
        .set('Content-Type', 'application/json').send(JSON.stringify({ username: '!', class_type: 'Scout' }))],
    ];
    const problems = [];
    const envelopeFields = dtos.ApiResponse.fields.map((f) => f.name).filter((n) => !allowlist.clientOnlyEnvelopeFields.some((e) => e.field === n));
    for (const [expected, res] of responses) {
      const keys = Object.keys(res.body).sort();
      if (JSON.stringify(keys) !== JSON.stringify([...envelopeFields].sort())) problems.push(`${expected}: envelope keys [${keys}] vs ApiResponse [${envelopeFields}]`);
      if (res.body.success !== false || res.body.data !== null) problems.push(`${expected}: error envelope must have success=false, data=null`);
      const errFindings = [];
      compareToDto(dtos, 'ApiError', res.body.error, 'error', errFindings);
      problems.push(...errFindings.map((f) => `${expected}: ${f.detail}`));
      if (res.body.error && res.body.error.code !== expected) problems.push(`expected ${expected}, got ${res.body.error.code}`);
    }
    expect(problems).toEqual([]);
  });

  test('no allowlist entry is stale', () => {
    const stale = [];
    for (const kind of ['ignoredServerKeys', 'absentFields', 'partialResponses', 'nullableFields', 'requestFields', 'clientOnlyErrorCodes', 'clientOnlyEnvelopeFields']) {
      for (const entry of allowlist[kind]) {
        if (!entry.reason || entry.reason.length < 20) stale.push(`${kind} entry without a real reason: ${JSON.stringify(entry)}`);
        if (!used.has(`${kind}:${JSON.stringify(entry)}`)) stale.push(`${kind} entry no longer matches anything — remove it: ${JSON.stringify(entry)}`);
      }
    }
    // An exception may only name fields that are absent for real.
    for (const entry of allowlist.absentFields) {
      for (const field of entry.fields) {
        const hit = [...results.values()].some(({ call, result }) => call.key === entry.endpoint
          && result.findings.some((f) => f.kind === 'missing' && f.dto === entry.dto && f.field === field));
        if (!hit) stale.push(`absentFields ${entry.endpoint} ${entry.dto}.${field} is present now — remove it from the allowlist`);
      }
    }
    for (const entry of allowlist.ignoredServerKeys) {
      for (const k of entry.keys) {
        const hit = [...results.values()].some(({ result }) => result.findings.some((f) => f.kind === 'extra' && f.dto === entry.dto && f.field === k));
        if (!hit) stale.push(`ignoredServerKeys ${entry.dto}.${k} is no longer sent — remove it from the allowlist`);
      }
    }
    expect(stale).toEqual([]);
  });
});
