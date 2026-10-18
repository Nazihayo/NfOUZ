'use strict';

/**
 * The Unity <-> backend contract checks, shared by both modes:
 *   - unityContract.test.js        fake database (default, fast, authoritative)
 *   - db/unityContract.dbtest.js   real throwaway PostgreSQL (optional)
 * One set of scenarios (scenarios.js), one world (world.js), one allowlist
 * (allowlist.js); a mode only supplies how state is prepared for a
 * scenario (`prepare`), how executed statements are logged (`takeLog`),
 * and optional mode-specific checks per run (`inspect`).
 */

const fs = require('fs');
const request = require('supertest');

const { loadSchema } = require('./schema');
const { loadUnityContract } = require('./unitySource');
const { startRecording, routeExists, backendErrorCodes } = require('./harness');
const { compareToDto, requestFieldPaths, buildRequestBody } = require('./compare');
const scenarios = require('./scenarios');
const allowlist = require('./allowlist');

const STALE_CHECKED_KINDS = ['ignoredServerKeys', 'absentFields', 'partialResponses', 'nullableFields',
  'requestFields', 'clientOnlyErrorCodes', 'clientOnlyEnvelopeFields'];

function fillPath(pathTemplate, values = []) {
  let i = 0;
  const filled = pathTemplate.replace(/\{\}/g, () => {
    if (i >= values.length) throw new Error(`scenario has no value for path segment ${i + 1} of ${pathTemplate}`);
    return encodeURIComponent(values[i++]);
  });
  if (i !== values.length) throw new Error(`scenario gives ${values.length} path values; ${pathTemplate} has ${i}`);
  return filled;
}

/**
 * @param {object} options
 * @param {string} options.mode           label used in test names
 * @param {() => object} options.getApp   the Express app (created once the mode is ready)
 * @param {(scenario) => Promise|void} options.prepare  puts the world in place for one scenario
 * @param {() => Array} options.takeLog   statements executed since the last call
 * @param {(ctx) => Promise<string[]>} [options.inspect]  extra problems for one run
 */
function createContractSuite({ mode, getApp, prepare, takeLog, inspect }) {
  const unity = loadUnityContract();
  const { dtos } = unity;
  const schema = loadSchema();
  const used = new Set(); // allowlist entries that excused something
  const useEntry = (kind, entry) => used.add(`${kind}:${JSON.stringify(entry)}`);
  const results = new Map(); // `${key}|${call.where}` -> { call, scenario, result }

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

  /**
   * Sends one Unity call exactly as the client would (path, query and a
   * body built from the Unity request DTO) and compares what happens with
   * the Unity DTOs. Used for success scenarios and, in the real-database
   * mode, for error scenarios too.
   */
  async function sendCall(scenario, call) {
    await prepare(scenario);
    takeLog();

    const findings = [];
    const concretePath = fillPath(call.path, scenario.path);
    for (const q of Object.keys(scenario.query || {})) {
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
    let req = request(getApp())[call.method.toLowerCase()](url)
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${scenario.as}`);
    if (body !== undefined) req = req.send(JSON.stringify(body));
    const res = await req;
    const log = takeLog();

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

    const result = {
      ok, status: res.status, error: env && env.error, data: env && env.data, body: env, log, findings, modeProblems: [],
    };
    if (inspect) result.modeProblems = await inspect({ scenario, call, result });
    return result;
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

  /** Runs every success scenario once per distinct Unity call. Call from beforeAll. */
  async function runAll() {
    for (const scenario of scenarios) {
      for (const call of unity.calls.filter((c) => c.key === scenario.key)) {
        // Calls with the same request/response types behave identically.
        const twin = [...results.values()].find((r) => r.call.key === call.key
          && r.call.requestType === call.requestType && r.call.responseType === call.responseType);
        let result;
        try {
          result = twin ? { ...twin.result } : await sendCall(scenario, call);
        } catch (err) {
          // Reported by this endpoint's own test, not as a suite-wide crash.
          result = { ok: false, status: 'harness error', error: err.message, log: [], findings: [], modeProblems: [] };
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
  }

  /** CONTRACT_REPORT=<file>: every raw finding (before the allowlist) as JSON. */
  function writeReport() {
    if (!process.env.CONTRACT_REPORT) return;
    const report = [...results.values()].map(({ call, result }) => ({
      mode, endpoint: call.key, where: call.where, status: result.status, data: result.data, findings: result.findings,
    }));
    fs.writeFileSync(process.env.CONTRACT_REPORT, JSON.stringify(report, null, 2));
  }

  /** The checks both modes run. */
  function defineSharedTests() {
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
        .filter((c) => c.path && !routeExists(getApp(), c.method, c.path.replace(/\{\}/g, 'x')))
        .map((c) => `${c.key} (${c.where}) — no backend route`);
      expect(missing).toEqual([]);
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
          for (const p of result.modeProblems) problems.push(`${call.where}: [${mode}] ${p}`);
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
      await prepare({});
      const app = getApp();
      const responses = [
        ['INVALID_TOKEN', await request(app).get('/auth/me')],
        ['NOT_FOUND', await request(app).get('/no-such-route').set('Authorization', 'Bearer uid-a')],
        ['INVALID_USERNAME', await request(app).post('/auth/register').set('Authorization', 'Bearer uid-new')
          .set('Content-Type', 'application/json').send(JSON.stringify({ username: '!', class_type: 'Scout' }))],
      ];
      const problems = [];
      for (const [expected, res] of responses) problems.push(...envelopeProblems(expected, res.body));
      expect(problems).toEqual([]);
    });

    test('no allowlist entry is stale', () => {
      const stale = [];
      for (const kind of STALE_CHECKED_KINDS) {
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
  }

  /** Problems with an error envelope against the client's ApiResponse/ApiError. */
  function envelopeProblems(expectedCode, body) {
    const problems = [];
    const envelopeFields = dtos.ApiResponse.fields.map((f) => f.name)
      .filter((n) => !allowlist.clientOnlyEnvelopeFields.some((e) => e.field === n));
    const keys = Object.keys(body || {}).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...envelopeFields].sort())) problems.push(`${expectedCode}: envelope keys [${keys}] vs ApiResponse [${envelopeFields}]`);
    if (!body || body.success !== false || body.data !== null) problems.push(`${expectedCode}: error envelope must have success=false, data=null`);
    const errFindings = [];
    compareToDto(dtos, 'ApiError', body && body.error, 'error', errFindings);
    problems.push(...errFindings.map((f) => `${expectedCode}: ${f.detail}`));
    if (body && body.error && body.error.code !== expectedCode) problems.push(`expected ${expectedCode}, got ${body.error.code}`);
    return problems;
  }

  return {
    unity, dtos, schema, results, runAll, sendCall, writeReport, defineSharedTests, envelopeProblems,
  };
}

module.exports = { createContractSuite, scenarios };
