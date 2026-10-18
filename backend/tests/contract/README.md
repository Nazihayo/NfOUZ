# Unity ↔ backend contract test

These tests check that the Unity client (`Assets/_Project/Scripts`) and this
backend still agree on every API call. There are two modes. They share one set
of scenarios, one world and one allowlist:

| Mode | Command | Needs |
|---|---|---|
| **Fake database** (default, authoritative, fast) | `npm run test:contract`, also part of every backend test run | nothing: no Unity Editor, database, Docker, network, Firebase credentials or accounts |
| **Real PostgreSQL** (optional, deeper) | `npm run test:contract:db` | a local PostgreSQL 13+ with a dedicated test role ([setup below](#real-database-mode)) |

The real-database mode never runs as part of `npm test` or `npx jest`.

## Run the fake-database mode

From `backend/`, after `npm install`. These commands are the same on Windows
(PowerShell or cmd) and Linux/macOS:

```
npm run test:contract        # only the contract test
npm test                     # all backend tests, including the contract test
```

`npx jest --runInBand` is equivalent to `npm test`. Test mode does not depend on
the shell: `tests/setupTestEnv.js` (Jest `setupFiles`) forces `NODE_ENV=test`, and
keeps `backend/.env` from being loaded, before every test file.

Both modes need the full repository checkout: they read the Unity C# sources from
`../Assets/_Project/Scripts` and fail with a clear message if they are missing.

## What both modes check

| Check | Catches, for example |
|---|---|
| Every Unity `ApiClient` call has exactly one scenario, and every scenario matches a call | a new or renamed client call that nobody covered |
| Every call reaches a backend route (method + path) | a client endpoint that no longer exists |
| Request body and query fields the client sends (Unity request DTO, JsonUtility names) vs the fields the backend actually reads | a renamed request field (`fcm_token` → `fcmToken`) |
| Success response vs the Unity DTO that parses it: missing fields, extra keys, JSON types | `PlayerId` vs `player_id`; `reward_coins` sent as `"100"` to an `int`; a renamed response field; a DTO expecting the wrong type |
| Partial responses (`/battle/{id}/ready`, `/reconnect`) carry exactly their documented fields, every call site applies them with the matching partial method, and that method reads nothing else | a partial battle response treated as a full session |
| Responses handed to a full-session replace (`BattleSession.UpdateFromServer`, `PlayerSession.UpdateFromServer`) carry the fields that define the session | a full-session response losing `attacker_id` |
| Every error code the client handles (and every `Constants.ErrorCodes` value) is one the backend sends | the client handling a code the backend never sends |
| Error envelopes match the client's `ApiResponse` / `ApiError` | a changed error envelope |
| Every token failure answers HTTP 401 `INVALID_TOKEN`, which is the only code sent with 401, and it matches the rule the client refreshes on (`AuthSession.IsTokenRejection`) | a token failure sent as 403, or another 401 that the client would mistake for an expired sign-in |
| Unity's `BattleLifecycle.FromStatus` has a case for exactly the battle statuses the schema's `battles_status_check` allows | a new terminal status the client would keep polling as if the match were running |
| No allowlist entry is stale | an exception that no longer applies |

## How it works

- `unitySource.js` reads the C# sources: `[Serializable]` DTOs (public fields and
  `[SerializeField]` private fields, as JsonUtility serializes them) and each API
  call. For a call it records the method, path, query names, request and response
  DTOs, and which session-apply method receives the response.
- `contractSuite.js` holds every check above. Each mode supplies only:
  - how to put the world in place for a scenario,
  - how executed statements are logged,
  - optional checks of its own.
- The **real** Express app, controllers, services and repository SQL run through
  supertest. Firebase token verification is replaced by `firebaseStub.js` (the
  bearer token is used as the uid), and the rate limiters by `rateLimitStub.js`.
- **Fake-database mode:** `fakeDatabase.js` replaces the PostgreSQL driver. It
  parses each SQL statement (`sqlShape.js`) and returns rows with exactly that
  statement's output columns. Each value is typed the way node-postgres types it,
  using the migrations (`schema.js`):
  - `BIGINT` and `NUMERIC` come back as **strings**,
  - timestamps come back as `Date`,
  - a nullable column with no value comes back as `NULL`.
  
  Values come from the world in `world.js`: players A, B and C, a battle,
  friendships, an SOS, a rescue mission, items and a quest.
- **Real-database mode:** the backend's own `src/config/database.js` (the real `pg`
  pool) runs against a throwaway database. The same world is inserted before
  every scenario.
- Request reads are recorded with a Proxy on `req.body` / `req.query`, so the
  backend code runs unchanged.

## Real-database mode

### One-time setup

Connect as a PostgreSQL superuser, for example `psql -U postgres -h localhost`
(Windows: from the PostgreSQL `bin` folder, or "SQL Shell (psql)"). Then create a
role and a database that exist only for this test:

```sql
CREATE ROLE nfouz_contract_test LOGIN CREATEDB PASSWORD '<choose a password>';
CREATE DATABASE nfouz_contract_test OWNER nfouz_contract_test;
```

**Privileges.** The role needs only `LOGIN` and `CREATEDB`. As the owner of each
database it creates, it can also run the migrations; the `pgcrypto` extension is
"trusted" from PostgreSQL 13, so no superuser is needed for it.
- Do **not** grant `SUPERUSER`: the test refuses to run as a superuser.
- `CREATEROLE` and access to other databases are not needed.

### Run it (from `backend/`)

Linux / macOS:
```bash
CONTRACT_TEST_DATABASE_URL=postgres://nfouz_contract_test:<password>@localhost:5432/nfouz_contract_test npm run test:contract:db
```

Windows PowerShell:
```powershell
$env:CONTRACT_TEST_DATABASE_URL = "postgres://nfouz_contract_test:<password>@localhost:5432/nfouz_contract_test"
npm run test:contract:db
Remove-Item Env:CONTRACT_TEST_DATABASE_URL
```

Windows cmd:
```bat
set "CONTRACT_TEST_DATABASE_URL=postgres://nfouz_contract_test:<password>@localhost:5432/nfouz_contract_test"
npm run test:contract:db
set CONTRACT_TEST_DATABASE_URL=
```

Without `CONTRACT_TEST_DATABASE_URL`, or with an unsafe value, the command
connects to nothing. It prints why, with these setup steps, and exits with code
2. It never falls back to `DATABASE_URL` or `backend/.env`.

### What it creates and deletes

| When | What |
|---|---|
| Start (once per test file: `unityContract.dbtest.js`, `battleLifecycle.dbtest.js`) | `CREATE DATABASE nfouz_contract_test_run_<UTC yyyymmddhhmmss>_<8 random hex>`, then `COMMENT ON DATABASE … IS 'nfouz-contract-test-run:<that name>'` (the ownership marker) |
| Setup | The backend's own `scripts/run-migrations.js` runs on that database, in a child process started in an empty temporary folder (so it can't load `backend/.env`) and with `DATABASE_URL`, `FIREBASE_*` and `PG*` removed from its environment |
| Before each scenario | Every table of **that** database is truncated and the world from `world.js` is inserted (only after checking `current_database()` is the run database) |
| End (`afterAll`, also after failures) | `DROP DATABASE … WITH (FORCE)`, only if all of these hold: the name is the one this run generated, it has the run-database shape, it isn't the connection database, and its comment carries this run's marker |

The connection database `nfouz_contract_test` and everything else on the server
are never changed.

If cleanup can't or mustn't drop the run database, the run prints
`[contract:db] CLEANUP FAILED` with the exact `DROP DATABASE` command and exits
non-zero. That is reported in addition to any test failures, never instead of
them. If a run is killed, for example with Ctrl+C, its database stays. To list
leftovers:
```sql
SELECT datname, shobj_description(oid, 'pg_database') FROM pg_database
WHERE datname LIKE 'nfouz_contract_test_run_%';
```
Drop only rows whose comment is `nfouz-contract-test-run:<same name>`.

### Safety checks (all fail closed)

Before connecting (`db/dbSafety.js`, unit-tested in `db/dbSafety.test.js`, which
is part of the normal test run):

| Check | Why |
|---|---|
| The URL comes **only** from `CONTRACT_TEST_DATABASE_URL` | `DATABASE_URL` is never a target |
| Host must be `localhost`, `127.0.0.1` or `::1` | blocks production, shared and LAN servers |
| No URL query parameters | `?host=` and similar could redirect the connection |
| Database name must contain `contract_test` (lowercase identifier) | an unmistakable test-only target |
| Refuses `nfouz_db`, `nfouz_db_test`, `postgres`, `template0` and `template1` | the normal development database and system databases |
| Refuses the database named by `DATABASE_URL` (environment or `backend/.env`; only that line is read) | the developer's own database |
| Refuses user or database names containing prod, production, live, staging, stage or shared | obvious production or shared targets |
| Refuses `NODE_ENV=production` | — |

After connecting, it refuses to continue if:
- the role is a superuser or lacks `CREATEDB`;
- `current_database()` is not the configured database;
- the server is older than PostgreSQL 13;
- the generated database name already exists.

Passwords and connection strings are never printed. Errors and child-process
output are redacted (`redact()`), and the runner prints the target as
`user@host:port/database`. The test process never loads `backend/.env`:
`dotenv` is replaced, so the developer's `DATABASE_URL` and Firebase key never
enter it.

### What only the real-database mode checks

| Check | Example it catches |
|---|---|
| `WHERE` clauses are really evaluated | a "blocked?" check matching non-blocked rows; nearby returning only the caller |
| Values written by `INSERT`/`UPDATE`/`RETURNING` (`real.expect` in `scenarios.js`) | quest claim → `reward_coins: 100`, `battle_pass_xp: 60`; resolve → influence 135 / 110 |
| State left in the database after each call (`real.after`: read-only `SELECT`s) | `is_claimed` not set; inventory quantity going up instead of down |
| The real driver's BIGINT/NUMERIC/timestamp/NULL behaviour | `reward_coins` arriving as `"100"` straight from `pg` |
| The fake mode's `rowCounts` hints (lookups that "find nothing") are true in PostgreSQL | a scenario world that only passes because of a fake-only hint |
| The migrations run cleanly, and the world's reference rows (items, quest) match their seeds | a seed changed in a migration but not in `world.js` |
| 15 representative error paths (`errorScenarios`): status, code and envelope | e.g. `PLAYER_NOT_FOUND`, `USERNAME_TAKEN`, `PLAYER_BLOCKED`, `DUPLICATE_CHALLENGE`, `RECONNECT_WINDOW_EXPIRED`, `QUEST_NOT_COMPLETED`, `FRIENDSHIP_TOO_NEW`, idempotent re-claim |
| The battle lifecycle cleanup (`battleLifecycle.dbtest.js`, 18 tests; timings are set relative to the database's `now()`) | a stale battle still blocking a challenge or the inventory; a fresh, overtime or reconnectable battle ended early; a ready timeout that ignores the ready flags; a cleanup that is not idempotent or ends a battle twice under 8 concurrent calls; a cleanup overwriting a committed result (or a late result overwriting a cleanup); terminal history, control, SOS or rescue rows changing |

### Fake and real modes: intentional differences

- **`rowCounts`:** fake mode only. The fake can't evaluate `WHERE`, so a scenario
  names the lookups that find nothing. The real mode ignores them for its
  results and instead **checks** them.
- **`real`:** real mode only (`expect`, `after`). The fake doesn't apply
  `SET`/`VALUES`, so its values come from the world, not from the statement.
- **`errorScenarios`:** real mode only. They depend on `WHERE` clauses and stored
  state.
- **One world:** both modes use the same world. A scenario's `world` change must
  make sense in both (e.g. "no active battle" both for the fake hint and for
  PostgreSQL).

## When a test fails

Each message names the Unity file and line, the endpoint, and the field. Then:

- **Real contract break:** fix the client or the backend.
- **New Unity API call:** add one scenario to `scenarios.js`. Use `world` to set
  up state; add `rowCounts` for lookups the fake must treat as empty, and `real`
  for values and state worth checking.
- **Intentional difference:** add an entry to `allowlist.js` with a reason. Entries
  are exact (endpoint, DTO, fields, and `at` for nested lists), and the test fails
  when an entry no longer matches anything.
- **Unsupported SQL:** an error saying the SQL can't be read means a repository
  uses SQL that `sqlShape.js` doesn't understand yet. Extend the parser; never
  hard-code a row.
- **`fake-mode hint … is false in PostgreSQL`:** the scenario's world doesn't
  produce the state the hint assumes. Fix the world (both modes use it).

`CONTRACT_REPORT=<file>` (either mode) writes every raw finding, before the
allowlist, as JSON. On PowerShell, set it with `$env:CONTRACT_REPORT="report.json"`.

## What neither mode can check

- **Client runtime behaviour:** culture-dependent formatting (covered by Unity
  EditMode tests) and what Unity does after parsing.
- **External services:** Photon, Firebase (token checks are stubbed) and FCM
  delivery.
- **Concurrency and timing:** races, rate limits and expiry windows beyond the
  timestamps a scenario sets.
- **Error paths not listed:** only the error paths in `errorScenarios` run, and
  only in the real-database mode.
- **Unrecognised C# patterns:** the C# reader recognises the patterns this client
  uses. A call built in an unrecognised way fails the test as "cannot resolve";
  it is never silently skipped.
