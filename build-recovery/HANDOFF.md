# NFOUZ — Session Handoff (Build Recovery)

Read this first when resuming work, especially in a Claude session running on
the developer's Windows laptop. It summarizes what was done in the cloud
sessions, what was verified in the real Unity Editor, and what is next.
`build-recovery/RECOVERY_STATUS.md` is older and still describes a `unity/`
folder; where they differ, this file is current.

- **Branch:** `claude/sprint-5-photon-multiplayer-5jv8v2` (all work below is pushed)
- **Phase:** Build Recovery — make the existing Sprint 1–10 code runnable.
  **Do not start Sprint 11. Do not add gameplay features or redesign systems.**
- **Last updated:** 2026-10-18 (covers commits through `64f274a`)

## Working rules agreed with the developer

- Never discard the developer's local Unity changes: no `git reset --hard`,
  no forced checkout, no overwriting scenes/prefabs they changed locally.
  Run `git status` before editing.
- Never commit or print secrets: `backend/.env`, Firebase service-account
  JSON, `google-services.json`, `GoogleService-Info.plist`,
  `google-services-desktop.json`, Photon App IDs, Mapbox tokens (see
  CLAUDE.md "Security"). Show the diff before committing anything generated
  by the local environment.
- Ask before administrator-level Windows changes, restarts, BIOS changes, or
  deleting Docker volumes / database data.
- Unity version is **6000.0.58f2**. Unity 6000.0.84f1 is also installed on the
  laptop — do not open the project with it (it would upgrade the project).
- The developer communicates in Arabic.

## Repository layout

| Path | Contents |
|---|---|
| `Assets/_Project/Scripts` | 84 Sprint 1–10 scripts + recovery additions, assembly `Nfouz.Runtime` |
| `Assets/_Project/Tests/EditMode` | EditMode tests, assembly `Nfouz.Tests.EditMode` |
| `Assets/_Project/Scenes` | Boot, Login, Onboarding, MainMap, Battle, Result (Build Settings order) |
| `Assets/_Project/Prefabs` | 13 placeholder prefabs (Core, UI, Map, Networking) |
| `Assets/_Project/Resources/ApiEnvironmentSettings.asset` | Backend URL per environment |
| `backend/` | Node/Express API + PostgreSQL migrations (`npm run dev`, `npm run migrate`) |
| `documentation/unity-scene-setup/` | Per-scene setup specs |
| `IMPORT_REPORT.md` | How the codebase was imported from `Nazihayo/Nfouz-` |

## Done and verified in the real Unity Editor (6000.0.58f2)

1. Unity 6 project scaffold, packages (`com.unity.ugui` 2.0.0 incl. TMP,
   `com.unity.test-framework`), asmdefs, `.meta` files.
2. Six scenes and 12 prefabs generated and wired to existing scripts.
3. Scene loading fixed (commits `a642902`, `537e9b8`): **Unity scene files
   must list objects in ascending fileID order**; RectTransforms must not
   carry `serializedVersion`. Any hand-written/generated `.unity` file must
   follow both rules or children/components silently disappear.
4. Runtime wiring (`bbcf95d`): `SessionBootstrap` (Boot → Login/Onboarding/
   MainMap), `LoginPanelBridge`, `OnboardingPanelBridge`, `MainMapController`
   (`NearbyPlayersTracker.Bind(gps)`). Boot → Login verified.
5. API environment (`c63f3e7`): Editor and Development Builds always use the
   Development backend (`http://localhost:3000`); Production is blocked
   outside release builds. Unity's "Allow downloads over HTTP" must be
   "Allowed in Development Builds".
6. Firebase Auth on the laptop: `FirebaseAuth.unitypackage` imported,
   `google-services.json` in `Assets/` (gitignored), EDM4U Android resolve OK,
   Email/Password enabled, `FIREBASE_AUTH_AVAILABLE` defined (Player settings +
   `Assets/csc.rsp`, which exists only on the laptop and is not in Git).
   Firebase initializes and account creation reaches
   Onboarding. (The asmdef `versionDefines` entry only auto-detects the UPM
   package, not the `.unitypackage`, hence the manual define.)
7. Migrations (`f454681`): `npm run migrate` is the only migration mechanism;
   the Docker init-script mount was removed. Fresh DB: 20/20 applied; rerun
   skips all 20.
8. Backend tests (`9b107b4`): all 26 suites / 318 tests passed at the time
   (test-side fixes only; no backend source changed).
9. `ShopPlaceholderItem` moved to its own file, prefab
   `Prefabs/UI/ShopPlaceholderItem.prefab` created and assigned to
   `ShopScreen.placeholderItemPrefab` in MainMap (`46819ba`).
10. `.gitignore` covers `PhotonAppSettings.asset` and
    `MapboxConfiguration.txt` (+ `.meta`); docker-compose publishes
    PostgreSQL on `127.0.0.1` only.

Done in the cloud repository on 2026-10-18 — compiled and tested there, **not
yet checked in the Unity Editor** (see "Check in Unity after pulling" below):

11. Arabic auth errors (`004f095`): new `Auth/AuthErrorMessages.cs` maps
    Firebase `AuthError` names and API error codes to Arabic; `FirebaseManager`,
    `AuthController` and `OnboardingController` no longer show raw Firebase or
    server text (it is logged with `Debug.LogWarning`). Wrong password and
    unknown user share one message. A failed `POST /auth/register` because the
    backend is down now shows "تعذّر الاتصال بالخادم…". 17 EditMode tests in
    `AuthErrorMessagesTests` (pass under .NET in the cloud).
12. Result screen (`d021cbb`): `ResultController` hides the return button until
    a result is shown and shows it for every outcome; in `Battle.unity` and
    `Result.unity` the button moved from `VictoryPanel` to the shared
    `ResultPanel`. `Result.unity` is kept but is never loaded by code
    (`Constants.Scenes.Result` / `ScreenId.Result` unused; `BattleManager`
    calls the `ResultController` inside `Battle.unity`).
13. `.gitignore` (`3a56ca8`): Firebase's generated
    `Assets/Plugins/Android/FirebaseApp.androidlib/` (+ `.meta`, and any
    `google-services.xml`) — it contains the API key and project identifiers.
14. Faction investigated, unchanged: nothing ever sets `players.faction_id`
    (always `NULL`), the API returns only that id (a per-database random UUID,
    no name), and Unity has no faction field, so the profile's "—" is correct.
    Showing a faction needs the not-yet-built Faction System (assignment +
    name in the API) — a new feature, needs approval.

Build Recovery audit, 2026-10-18 (cloud). Every Unity API call was run
against the real backend on a throwaway PostgreSQL, and each response was
compared with the Unity DTO that parses it. Same status: compiled and
tested in the cloud, **not yet checked in Unity**:

15. Player session (`5f86c95`) — **critical**. `PlayerSessionData` had
    PascalCase fields, but the backend sends snake_case keys (`player_id`, …).
    JsonUtility matches names exactly, so after `/auth/me` or `/auth/register`
    every field stayed empty: `PlayerSession.HasActiveSession` was false,
    GPS location / FCM calls were skipped, and HUD/Profile stats were blank.
    The serialized fields now use the backend names, with PascalCase
    properties for the existing code. Test: `PlayerSessionDataContractTests`.
16. Battle session (`0d63d5c`). The `/battle/{id}/ready` and `/reconnect`
    responses carry only 2–3 fields but replaced the whole `BattleSession`.
    The host lost its signing secret, so it could not submit a result. After
    `/ready` the empty status also ended the match before the countdown.
    Test: `BattleSessionPartialUpdateTests`.
17. Quest rewards (`3ca2557`, backend). `reward_coins` (BIGINT) was sent as
    a string (`"100"`); it is now a number.
18. Culture (`af37336`). On German Windows (and ar-SA/ar-EG devices) the
    nearby-players URL sent `lat=52,5978`, which the backend reads as NaN.
    On ar-SA/fa-IR/th-TH devices the battle result's `issued_at` used a
    non-Gregorian year (e.g. 1448). Both now use the invariant culture. Test:
    `CultureInvariantRequestTests`, which also pins the C# signature to the
    backend's HMAC.
19. `.gitignore` (`d991180`). It now also covers the Admin key's default
    download name (`*-firebase-adminsdk-*.json`), `*service-account*.json`,
    `.env.*` (except `.env.example`), `*.p8`, `*.mobileprovision` and
    `keystore.properties`. The secret scan of tracked files and full history
    found nothing.
20. Checked and OK: all 29 Unity endpoints (33 call sites) exist with the
    right method, request bodies match what the backend reads,
    rescue/inventory/SOS/friends/devices/quests responses match, and every
    error code Unity handles is one the backend sends. Backend tests then:
    26 suites / 320 tests.
21. Contract regression test (`d253cbd`, `47989dc`, `48ae5e5`):
    `backend/tests/contract/` re-checks items 15–20 automatically on every
    backend test run. No Unity, database, Docker, network or credentials are
    needed.
    - It reads the Unity C# DTOs and API calls, then runs each of the 29
      endpoints through the real backend code.
    - A fake database returns rows typed like PostgreSQL's driver, from the
      migrations.
    - It fails on renamed or missing fields, wrong JSON types (e.g. a number
      sent as a string), removed endpoints, renamed request fields, partial
      battle responses applied as full sessions, and unknown error codes.
    - Intentional differences are in `allowlist.js`, each with a reason.
    - Run it from `backend/` with `npm run test:contract` (same command on
      Windows and Linux). It is also part of `npx jest --runInBand`.
    - Details and limits are in `backend/tests/contract/README.md`.
    - Backend tests then: 27 suites / 356 tests.
22. Optional real-PostgreSQL contract mode (`2b6893f`, `b7c85a0`, `6c8053e`,
    `f5cc342`, `a36c5a0`): `npm run test:contract:db`.
    - It runs the same scenarios against a throwaway database created and
      dropped by each run, and adds checks only a real database can answer:
      - values written by INSERT/UPDATE and the state left after each call;
      - the real BIGINT/timestamp/NULL behaviour;
      - migration seeds;
      - 15 error paths.
    - It is never part of `npm test`.
    - It needs a dedicated local role and database. One-time setup as a
      PostgreSQL superuser:
      `CREATE ROLE nfouz_contract_test LOGIN CREATEDB PASSWORD '…';`
      `CREATE DATABASE nfouz_contract_test OWNER nfouz_contract_test;`
    - Then run it with
      `CONTRACT_TEST_DATABASE_URL=postgres://nfouz_contract_test:…@localhost:5432/nfouz_contract_test`.
    - Commands for PowerShell and cmd are in
      `backend/tests/contract/README.md`.
    - It refuses `nfouz_db`, non-local hosts, names without `contract_test`,
      the database in `DATABASE_URL`, and superuser roles. It never reads
      `backend/.env`.
    - Verified in the cloud with a throwaway PostgreSQL 16: 51/51 at the
      time, repeated, in parallel and in random order. Cleanup was proven after success and
      after injected failures.
    - Backend tests then: 28 suites / 368 tests (the safety checks run in
      the normal suite).
23. `npm test` is cross-platform (`63dfcea`): it now works in PowerShell,
    cmd and Linux.
    - The script is now `jest --runInBand`; the POSIX `NODE_ENV=test` prefix
      is gone.
    - `backend/tests/setupTestEnv.js` (Jest `setupFiles`) runs before every
      test file. It forces `NODE_ENV=test`, whatever the shell has set, and
      stops `backend/.env` from being loaded during tests.
    - Before this change, a developer's `.env` could change results: a
      hostile one failed 28 tests.
24. Expired Firebase sign-in (`dd78e99`, `179831b`, `2c1f52f`): recovers
    without restarting the app.
    - **Before:** the ID token was fetched once (sign-in or Boot) and never
      refreshed. After about 1 hour, every API call failed with 401
      `INVALID_TOKEN`.
    - **Lifecycle now:**
      - sign-in, registration or Boot gives `ApiClient` a token
        (`SetAuthToken`);
      - every call goes through `Networking/AuthSession.cs`;
      - on a 401 `INVALID_TOKEN` it forces `TokenAsync(true)` through
        `FirebaseManager` and retries the same request once with the new
        token, which is kept for later calls.
    - **Retry rules:**
      - only 401 + `INVALID_TOKEN` triggers a refresh; network errors, 403s
        and all other errors never do;
      - at most one refresh and one retry per request;
      - simultaneous failures share one refresh;
      - cancelled requests, requests sent without a token, and requests
        from a replaced session are not retried.
    - **Session end and Login:**
      - the session ends when Firebase has no user, refuses the refresh
        (sign-in revoked, disabled or deleted), or the backend rejects the
        fresh token too;
      - `GameManager` then signs out, clears `PlayerSession` and loads Login
        once (not from Boot or Login, which route themselves);
      - if the refresh fails only temporarily (offline), the session is
        kept and the call returns `NETWORK_ERROR`, shown as the Arabic
        network message.
    - **Tests:** 30 EditMode tests in `AuthSessionTests`. The contract tests
      now pin the backend rule: every token failure is 401
      `INVALID_TOKEN`, and that is the only code sent with 401.
    - Tokens are never logged.
25. Stuck battles (`56dfcb6`, `fdfa74b`, `3977dfb`): a battle that can no
    longer finish now ends by itself and stops blocking both players.
    - **Before:** only `status = 'in_progress'` was checked. Nothing ended
      a battle without a result, so both players got `DUPLICATE_CHALLENGE`
      (and inventory `ACTIVE_BATTLE_IN_PROGRESS`) forever.
    - **Statuses:** `in_progress` is the only live one. `resolved`,
      `pending_review`, `forfeited` and `cancelled` are terminal and are
      never reopened or rewritten.
    - **Rules** (`backend/src/utils/battleLifecycle.js`, existing settings
      only; times count from the challenge):
      - a reconnect deadline (15 s grace) passed → `forfeited` by that
        player (attacker first if both);
      - not both ready after `BATTLE_READY_TIMEOUT_SECONDS` (30 s) →
        `cancelled`;
      - no result after 298 s (ready 30 + countdown 3 + result max duration
        130 + max age 120 + clock skew 15), the point after which no result
        can be accepted → `cancelled`.
      - `session_expires_at` (challenge + 90 s) is not used: combat
        (90 s + 30 s overtime) starts after loading, so it would end valid
        battles.
      - No rewards, influence, control or rescue changes for `forfeited` or
        `cancelled`.
    - **Trigger (no scheduler):** one guarded `UPDATE … WHERE status =
      'in_progress'` (`expireStaleBattles`) runs before every battle endpoint
      (GET, ready, disconnect, reconnect, resolve), before the
      duplicate-challenge check and before the inventory battle lock. It is
      idempotent; PostgreSQL row locks let exactly one of cleanup or result
      win. Old stuck rows are ended the next time either player acts. No
      migration.
    - **Unity:** a polled `forfeited` / `cancelled` battle shows the
      unknown-result panel (no longer a draw), which clears `BattleSession`
      and returns to MainMap. A ready call answered `SESSION_EXPIRED` /
      `BATTLE_NOT_FOUND` clears `BattleSession` and loads MainMap once.
    - **Tests:** 15 EditMode tests in `BattleLifecycleTests`; 18 real-PostgreSQL
      tests in `backend/tests/contract/db/battleLifecycle.dbtest.js`; the
      contract tests check that Unity handles every battle status.
    - Docs: `64f274a`.

Current test counts (cloud, at `64f274a`; run from `backend/`):

| Command | Result |
|---|---|
| `npm test` (same as `npx jest --runInBand`; includes the fake-database contract test) | 29 suites / 374 tests |
| `npm run test:contract` | 50 tests |
| `npm run test:contract:db` (needs `CONTRACT_TEST_DATABASE_URL`, item 22) | 71 tests: 53 contract + 18 battle lifecycle |
| Unity EditMode, run under .NET in the cloud | `AuthErrorMessagesTests` 17, `AuthSessionTests` 30, `BattleLifecycleTests` 15, `PlayerSessionDataContractTests` + `BattleSessionPartialUpdateTests` + `CultureInvariantRequestTests` 13 of 14 (the 14th needs Unity's JsonUtility) |

Check in Unity after pulling:
- EditMode Test Runner: all tests, including the new ones above.
  `PlayerSessionDataContractTests.AuthMeEnvelope_ParsesIntoSession` uses
  JsonUtility, so it runs only in Unity.
- The Login error label shows Arabic text.
- After Register → MainMap, the HUD/Profile show the player's stats
  (item 15).
- The result screen's return button in Battle (needs Photon for a real
  match).
- Expired sign-in (item 24): `AuthSessionTests` in the Test Runner. By hand:
  sign in, wait more than 1 hour (or revoke the user's tokens in the Firebase
  Console), then open Friends or Quests.
  - Expected after waiting: the call succeeds after a silent refresh.
  - Expected after revoking: a single return to Login.
- Stuck battles (item 25): `BattleLifecycleTests` in the Test Runner. By hand
  in stub mode: challenge with only one client, wait more than 30 s, return
  to MainMap and challenge the same player again.
  - Expected: the new challenge is accepted (no `DUPLICATE_CHALLENGE`), and
    the old battle's row reads `cancelled`.

Notes for the laptop:
- On an Android phone, `http://localhost:3000` is the phone itself. Point the
  Development URL in `Resources/ApiEnvironmentSettings.asset` at the
  laptop's LAN IP (or `10.0.2.2` on the emulator) for device tests. Don't
  commit a personal IP.
- The repo's `ProjectSettings/ProjectSettings.asset` is a 10-line stub; the
  real Android settings exist only on the laptop. Review that file's diff
  (package name, min/target SDK, IL2CPP + ARM64, "Allow downloads over HTTP")
  before committing it. Unity does not store keystore passwords there.

## Current blocker

Onboarding's `POST /auth/register` fails with "Cannot connect to destination
host": the local backend at `http://localhost:3000` is not running because
there is no local PostgreSQL yet.

- Docker Desktop 4.95.0 is installed, but `wsl --install -d Ubuntu` loops
  (re-enables VirtualMachinePlatform and asks for a restart every time).
  Likely cause: CPU virtualization disabled in the Dell BIOS — check Task
  Manager → Performance → CPU → "Virtualisierung". Ubuntu itself is **not**
  needed for this project.
- Chosen path: native PostgreSQL 16 on Windows (no Docker/WSL) via
  `backend/scripts/setup-local-windows.ps1` (`dd6e2c3`).

## Next steps (in order)

1. Firebase Console → project NFOUZ → Project settings → Service accounts →
   Generate new private key. Save the JSON **outside the repository**.
   Never paste it into chat.
2. In an **Administrator** PowerShell at the repo root:
   ```powershell
   git pull
   powershell -ExecutionPolicy Bypass -File backend\scripts\setup-local-windows.ps1 -ServiceAccountJson "<path to the JSON>"
   ```
   It installs PostgreSQL 16 (winget) if missing, creates `nfouz`/`nfouz_db`,
   creates `backend/.env` (gitignored) with the Firebase Admin values without
   printing them, checks the project matches Unity's `google-services.json`,
   runs `npm run migrate`, starts `npm run dev` and checks `/health`.
   Expected final line: `OK GET http://localhost:3000/health -> 200`.
   Re-runnable; never deletes data. If it stops, the red `STOP` line says why.
   If Windows Firewall asks about Node.js, choose Cancel (localhost only).
3. In Unity: Boot → Login → register a new account → Onboarding → pick a class
   and username → Confirm → MainMap must load. A 401 `INVALID_TOKEN` means the
   Admin key belongs to a different Firebase project than Unity.

## Backlog after the Register → MainMap test (do not start without approval)

Completed work is items 1–25 above; nothing completed is listed here.

Needs the laptop:
- "Current blocker" and "Next steps (in order)" above.
- "Check in Unity after pulling" and "Notes for the laptop" above.
- Optional, once local PostgreSQL works (Next steps 2): create the
  `nfouz_contract_test` role/database (item 22) and run
  `npm run test:contract:db` (README, "Real-database mode"). It never
  touches `nfouz_db`.

Needs a decision or approval:
- TMP/Arabic migration: 59 `Text` fields + 1 `InputField` in 25
  scripts (the recovery bridges `LoginPanelBridge` / `OnboardingPanelBridge`
  add 6 more `InputField`s), an Arabic TMP font asset, and an Arabic shaping
  solution (e.g. RTLTMPro — third-party, needs approval). Legacy `Text`
  cannot join Arabic letters.
- Whether `Result.unity` should be loaded by the flow or retired; it is
  currently unused (see item 12).
- Usernames: the backend accepts only `^[a-zA-Z0-9_]{3,20}$`. Arabic names
  are rejected (shown as "اسم المستخدم غير صالح").
- Logout: `FirebaseManager.SignOut` is called only when a session ends
  (item 24); no screen offers logout.
- Battle loading screen: a battle the server cancels while the player
  waits is noticed only on the player's next battle call (item 25). A live
  check while waiting would be a separate change.

Needs the developer's external accounts:
- Firebase Admin service-account key (Next steps 1).
- Photon Fusion import (Battle has stub mode only), then Mapbox (needs an
  asmdef for its sources). Each needs its account and App ID / token, kept
  out of Git.

Future features (not Build Recovery):
- Faction System (see item 14).
- Sprint 11 and anything else not already in the Sprint 1–10 code.

Rule for later changes: when a Unity API call or a backend response changes
on purpose, update `backend/tests/contract/scenarios.js` / `allowlist.js` in
the same commit (see `backend/tests/contract/README.md`).
