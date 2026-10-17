# NFOUZ — Session Handoff (Build Recovery)

Read this first when resuming work, especially in a Claude session running on
the developer's Windows laptop. It summarizes what was done in the cloud
sessions, what was verified in the real Unity Editor, and what is next.
`build-recovery/RECOVERY_STATUS.md` is older and still describes a `unity/`
folder; where they differ, this file is current.

- **Branch:** `claude/sprint-5-photon-multiplayer-5jv8v2` (all work below is pushed)
- **Phase:** Build Recovery — make the existing Sprint 1–10 code runnable.
  **Do not start Sprint 11. Do not add gameplay features or redesign systems.**
- **Last updated:** 2026-10-17

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
| `Assets/_Project/Prefabs` | 12 placeholder prefabs (Core, UI, Map, Networking) |
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
- Firebase error messages are shown in English (raw SDK text).
- Photon Fusion import (Battle has stub mode only), then Mapbox (needs an
  asmdef for its sources). Both need the developer's accounts.
- `Result.unity` is never loaded by code; the live result screen is the panel
  inside `Battle.unity`. `ResultController` has no root-visibility field, so
  the Return button lives in the Victory panel only.
- `npm test` uses POSIX `NODE_ENV=test jest …` syntax, which fails under
  Windows `cmd`; on Windows run `npx jest --runInBand` from `backend/`
  (each test file sets `NODE_ENV=test` itself).
