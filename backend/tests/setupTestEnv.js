'use strict';

/**
 * Runs before every test file (package.json "jest.setupFiles"), so tests
 * do not depend on the shell: `npm test` works the same in PowerShell, cmd
 * and POSIX shells, whatever NODE_ENV the shell already has.
 *
 * - NODE_ENV is forced to "test" (Jest itself only sets it when it is
 *   unset, so a shell NODE_ENV=production would otherwise be kept).
 * - backend/.env is for running the server locally; tests never read it,
 *   so a developer's DATABASE_URL, Firebase key or tuning values cannot
 *   change test results.
 */

process.env.NODE_ENV = 'test';

jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
