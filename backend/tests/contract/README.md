# Unity ↔ backend contract test

`unityContract.test.js` checks that the Unity client (`Assets/_Project/Scripts`)
and this backend still agree on every API call. It runs with the normal backend
tests and needs **no Unity Editor, database, Docker, network, Firebase credentials
or other accounts**.

## Run it

From `backend/`, after `npm install`. These commands are the same on Windows
(PowerShell or cmd) and Linux/macOS:

```
npm run test:contract        # only the contract test
npx jest --runInBand         # all backend tests, including the contract test
```

On Linux/macOS, `npm test` also runs everything. On Windows, `npm test` does not
work in cmd or PowerShell, because the script uses POSIX `NODE_ENV=test` syntax;
use `npx jest --runInBand` there instead.

The test needs the full repository checkout: it reads the Unity C# sources from
`../Assets/_Project/Scripts` and fails with a clear message if they are missing.

## What it checks

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
| No allowlist entry is stale | an exception that no longer applies |

## How it works

- `unitySource.js` reads the C# sources: `[Serializable]` DTOs (public fields and
  `[SerializeField]` private fields, as JsonUtility serializes them) and each API
  call. For a call it records the method, path, query names, request and response
  DTOs, and which session-apply method receives the response.
- The **real** Express app, controllers, services and repository SQL run through
  supertest. Only three things are replaced, in-process:
  - **PostgreSQL driver:** replaced by `fakeDatabase.js`.
  - **Firebase token check:** the bearer token is used as the uid.
  - **Rate limiters:** pass requests straight through.
- `fakeDatabase.js` parses each SQL statement the repositories issue
  (`sqlShape.js`) and returns rows with exactly that statement's output columns.
  Each value is typed the way node-postgres types it, using the column types from
  `backend/migrations` (`schema.js`):
  - `BIGINT` and `NUMERIC` come back as **strings**,
  - timestamps come back as `Date`,
  - a nullable column with no value comes back as `NULL`.
  
  Values come from a small consistent world (`world.js`): player A, player B, a
  battle, a friendship, an SOS, a rescue mission, items and quests.
- Request reads are recorded with a Proxy on `req.body` / `req.query`, so the
  backend code runs unchanged.

## When it fails

Each message names the Unity file and line, the endpoint, and the field. Then:

- **Real contract break:** fix the client or the backend.
- **New Unity API call:** add one scenario to `scenarios.js`. Use `rowCounts` to
  make a repository lookup find nothing, so the backend takes its success path.
- **Intentional difference:** add an entry to `allowlist.js` with a reason. Entries
  are exact (endpoint, DTO, fields, and `at` for nested lists), and the test fails
  when an entry no longer matches anything.
- **Unsupported SQL:** an error saying the SQL can't be read means a repository
  uses SQL that `sqlShape.js` doesn't understand yet. Extend the parser; never
  hard-code a row.

`CONTRACT_REPORT=<file> npm run test:contract` writes every raw finding (before
the allowlist) as JSON, which helps when you update the allowlist. On Windows
PowerShell, set it with `$env:CONTRACT_REPORT="report.json"` before running.

## What it cannot check

- **Database behaviour:** the fake database does not run `WHERE`, `SET` or
  `VALUES`. Shapes and types come from the real SQL text and the migrations, but
  values do not. A column that a statement writes may come back `NULL` here even
  though the real database has a value. Check SQL correctness against a real
  database.
- **Client runtime behaviour:** culture-dependent formatting (covered by Unity
  EditMode tests) and what Unity does after parsing.
- **Error paths:** only success paths, plus three error envelopes, are
  exercised. Error codes per endpoint are checked statically, not by running each
  error path.
- **Unrecognised C# patterns:** the C# reader recognises the patterns this client
  uses. A call built in an unrecognised way fails the test as "cannot resolve";
  it is never silently skipped.
