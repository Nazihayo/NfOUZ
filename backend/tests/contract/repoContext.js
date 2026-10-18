'use strict';

/**
 * Which repository function issued the SQL statement currently running.
 * Repository exports are wrapped so every statement can be attributed
 * (e.g. "friend.isBlockedEitherDirection") in both contract-test modes:
 * the fake database uses it for per-scenario row-count hints, the
 * real-database mode to check those hints against PostgreSQL.
 */

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/**
 * Wraps every exported function of one repository module in place.
 * Services call repositories through the module object, so wrapping the
 * exports is enough.
 */
function instrumentRepository(name, mod) {
  for (const [fnName, fn] of Object.entries(mod)) {
    if (typeof fn !== 'function') continue;
    const qualified = `${name}.${fnName}`;
    mod[fnName] = function instrumented(...args) {
      if (storage.getStore()) return fn.apply(this, args); // nested call keeps the outer name
      return storage.run(qualified, () => fn.apply(this, args));
    };
  }
}

const currentRepoFn = () => storage.getStore() || '(outside a repository)';

module.exports = { instrumentRepository, currentRepoFn };
