'use strict';

/**
 * Boots the real Express app for the contract test and records, per
 * request, which req.body / req.query fields the backend actually reads.
 * Recording uses a Proxy installed through an accessor on
 * http.IncomingMessage.prototype, so no backend code is changed or
 * bypassed. (Not express.request: Express 4 assigns req.query before it
 * switches the request's prototype to its own.)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const SRC_DIR = path.resolve(__dirname, '../../src');

let recorder = null;

function recordingProxy(target, prefix, sink) {
  if (target === null || typeof target !== 'object') return target;
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof prop !== 'string' || !Object.prototype.hasOwnProperty.call(obj, prop) && typeof value === 'function') return value;
      const p = prefix ? `${prefix}.${prop}` : prop;
      sink.reads.add(p);
      return recordingProxy(value, p, sink);
    },
    has(obj, prop) {
      if (typeof prop === 'string') sink.reads.add(prefix ? `${prefix}.${prop}` : prop);
      return Reflect.has(obj, prop);
    },
    ownKeys(obj) {
      // Enumerating (spread, Object.keys, JSON.stringify) reads every field.
      sink.enumerated.add(prefix || '(root)');
      for (const k of Object.keys(obj)) sink.reads.add(prefix ? `${prefix}.${k}` : k);
      return Reflect.ownKeys(obj);
    },
  });
}

function installRecorder() {
  for (const prop of ['body', 'query']) {
    const slot = Symbol(prop);
    Object.defineProperty(http.IncomingMessage.prototype, prop, {
      configurable: true,
      get() { return this[slot]; },
      set(value) {
        this[slot] = recorder && value && typeof value === 'object'
          ? recordingProxy(value, '', recorder[prop])
          : value;
      },
    });
  }
}

/** Starts recording reads for one request; returns the sink. */
function startRecording() {
  recorder = {
    body: { reads: new Set(), enumerated: new Set() },
    query: { reads: new Set(), enumerated: new Set() },
  };
  return recorder;
}

/**
 * True if `method path` reaches a route handler in the app's router
 * (Express 4 router stack walk: routers mounted with app.use, routes
 * with router.<method>).
 */
function routeExists(app, method, concretePath) {
  const m = method.toLowerCase();
  function walk(stack, p) {
    for (const layer of stack) {
      if (!layer.match(p)) continue;
      if (layer.route) {
        if (layer.route.methods[m] || layer.route.methods._all) return true;
      } else if (layer.handle && Array.isArray(layer.handle.stack)) {
        const rest = p.slice(layer.path.length) || '/';
        if (walk(layer.handle.stack, rest.startsWith('/') ? rest : `/${rest}`)) return true;
      }
    }
    return false;
  }
  return walk(app._router.stack, concretePath);
}

/** Every error code the backend can put in an error envelope. */
function backendErrorCodes() {
  const codes = new Set();
  const files = [];
  (function list(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) list(full);
      else if (e.name.endsWith('.js')) files.push(full);
    }
  })(SRC_DIR);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\b(?:ApiError|errorEnvelope|standardEnvelope)\(\s*'([A-Z][A-Z0-9_]+)'/g)) codes.add(m[1]);
  }
  return codes;
}

/**
 * HTTP status(es) each backend error code is sent with: `new ApiError(code,
 * message[, status])` (default 400) and `res.status(n).json(errorEnvelope(code, ...))`.
 * `unattributed401` counts 401 responses whose code could not be read,
 * so a new kind of 401 cannot slip past the check.
 */
function backendErrorStatuses() {
  const statuses = new Map();
  const add = (code, status) => {
    if (!statuses.has(code)) statuses.set(code, new Set());
    statuses.get(code).add(status);
  };
  let all401 = 0;
  let attributed401 = 0;
  const STRING = String.raw`(?:'[^']*'|"[^"]*"|\`[^\`]*\`)`;
  const apiError = new RegExp(String.raw`new ApiError\(\s*'([A-Z][A-Z0-9_]+)'\s*,\s*${STRING}\s*(?:,\s*(\d{3})\s*)?\)`, 'g');
  const envelope = /\.status\((\d{3})\)\s*\.json\(\s*errorEnvelope\(\s*'([A-Z][A-Z0-9_]+)'/g;
  (function list(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { list(full); continue; }
      if (!e.name.endsWith('.js')) continue;
      const text = fs.readFileSync(full, 'utf8');
      for (const m of text.matchAll(apiError)) {
        const status = Number(m[2] || 400);
        add(m[1], status);
        if (status === 401) attributed401++;
      }
      for (const m of text.matchAll(envelope)) {
        add(m[2], Number(m[1]));
        if (m[1] === '401') attributed401++;
      }
      all401 += (text.match(/\.status\(401\)|,\s*401\s*\)/g) || []).length;
    }
  })(SRC_DIR);
  return { statuses, unattributed401: all401 - attributed401 };
}

module.exports = { installRecorder, startRecording, routeExists, backendErrorCodes, backendErrorStatuses };
