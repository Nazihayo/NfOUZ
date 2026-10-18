# NFOUZ — Session Handoff (Build Recovery)

Read this first when resuming work, especially in a Claude session running on
the developer's Windows laptop. It summarizes what was done in the cloud
sessions, what was verified in the real Unity Editor, and what is next.
`build-recovery/RECOVERY_STATUS.md` is older and still describes a `unity/`
folder; where they differ, this file is current.

- **Branch:** `claude/sprint-5-photon-multiplayer-5jv8v2` (all work below is pushed)
- **Phase:** Build Recovery — make the existing Sprint 1–10 code runnable.
  **Do not start Sprint 11. Do not add gameplay features or redesign systems.**
- **Last updated:** 2026-10-18

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
   `Assets/csc.rsp`). Firebase initializes and account creation reaches
   Onboarding. (The asmdef `versionDefines` entry only auto-detects the UPM
   package, not the `.unitypackage`, hence the manual define.)
7. Migrations (`f454681`): `npm run migrate` is the only migration mechanism;
   the Docker init-script mount was removed. Fresh DB: 20/20 applied; rerun
   skips all 20.
8. Backend tests (`9b107b4`): all 26 suites / 318 tests pass (test-side
   fixes only; no backend source changed).
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
20. Checked and OK: all 32 Unity endpoints exist with the right method,
    request bodies match what the backend reads, rescue/inventory/SOS/
    friends/devices/quests responses match, and every error code Unity
    handles is one the backend sends. Backend tests: 26 suites / 320 tests.
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
    - Backend tests are now 27 suites / 356 tests.
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
    - Verified in the cloud with a throwaway PostgreSQL 16: 51/51, repeated,
      in parallel and in random order. Cleanup was proven after success and
      after injected failures.
    - Backend tests are now 28 suites / 368 tests (the safety checks run in
      the normal suite).

Check in Unity after pulling:
- EditMode Test Runner: all tests, including the new ones above.
  `PlayerSessionDataContractTests.AuthMeEnvelope_ParsesIntoSession` uses
  JsonUtility, so it runs only in Unity.
- The Login error label shows Arabic text.
- After Register → MainMap, the HUD/Profile show the player's stats
  (item 15).
- The result screen's return button in Battle (needs Photon for a real
  match).

Notes for the laptop:
- On an Android phone, `http://localhost:3000` is the phone itself. Point the
  Development URL in `Resources/ApiEnvironmentSettings.asset` at the
  laptop's LAN IP (or `10.0.2.2` on the emulator) for device tests. Don't
  commit a personal IP.
- The repo's `ProjectSettings/ProjectSettings.asset` is a 10-line stub; the
  real Android settings exist only on the laptop. Review that file's diff
  (package name, min/target SDK, IL2CPP + ARM64, "Allow downloads over HTTP")
  before committing it. Unity does not store keystore passwords there.
- A battle that never resolves stays `in_progress` forever, and both players
  then get `DUPLICATE_CHALLENGE` (nothing expires it; see backlog). In stub
  mode, clear it in the local DB with
  `UPDATE battles SET status = 'cancelled' WHERE status = 'in_progress';`.

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

- TMP/Arabic migration: 59 `Text` fields + 1 `InputField` in 25 scripts,
  Arabic TMP font asset, and an Arabic shaping solution (e.g. RTLTMPro —
  third-party, needs approval). Legacy `Text` cannot join Arabic letters.
- Photon Fusion import (Battle has stub mode only), then Mapbox (needs an
  asmdef for its sources). Both need the developer's accounts.
- Decide whether `Result.unity` should be loaded by the flow or retired; it
  is currently unused (see item 12).
- Faction System (see item 14) — new feature.
- Needs a decision (found in the 2026-10-18 audit):
  - The Firebase ID token is refreshed only at Boot. After about 1 h of
    play, every API call returns 401 `INVALID_TOKEN`, and nothing re-signs
    the player in. Option: refresh the token and retry once on 401.
  - Stale battles: `findActiveBattleForPlayer` ignores `session_expires_at`,
    so an unresolved battle blocks both players from challenging again.
  - The backend accepts only `^[a-zA-Z0-9_]{3,20}$` usernames. Arabic
    names are rejected (shown as "اسم المستخدم غير صالح").
  - Logout: `FirebaseManager.SignOut` exists, but no screen calls it.
- `npm test` uses POSIX `NODE_ENV=test jest …` syntax, which fails under
  Windows `cmd`; on Windows run `npx jest --runInBand` from `backend/`
  (each test file sets `NODE_ENV=test` itself).
- When a Unity API call or a backend response changes on purpose, update
  `backend/tests/contract/scenarios.js` / `allowlist.js` in the same commit
  (see `backend/tests/contract/README.md`).
- Optional on the laptop, once local PostgreSQL works (Next steps 2):
  create the `nfouz_contract_test` role/database above and run
  `npm run test:contract:db` (README, "Real-database mode"). It never
  touches `nfouz_db`.
