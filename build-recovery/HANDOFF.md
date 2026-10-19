# NFOUZ — Session Handoff (Build Recovery)

Read this first when resuming work, especially in a Claude session running on
the developer's Windows laptop. It summarizes what was done in the cloud
sessions, what was verified in the real Unity Editor, and what is next.
`build-recovery/RECOVERY_STATUS.md` is older and still describes a `unity/`
folder; where they differ, this file is current.

- **Branch:** `claude/sprint-5-photon-multiplayer-5jv8v2` (all work below is pushed)
- **Phase:** Build Recovery — make the existing Sprint 1–10 code runnable.
  **Do not start Sprint 11. Do not add gameplay features or redesign systems.**
- **Last updated:** 2026-10-19 (covers commits through the first laptop Unity test run; see item 30)

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

Verified on the real laptop on 2026-10-18:

26. **Boot → Login → Register → Onboarding → MainMap works end to end**
    (Unity 6000.0.58f2).
    - Local PostgreSQL 16, the backend, Firebase Admin and `/health` all
      work: the former blocker and its setup steps are done (kept below for
      a new machine).
    - `UnityWebRequest` to `http://localhost:3000` failed with Curl error 56;
      `http://127.0.0.1:3000` works. The laptop's
      `Resources/ApiEnvironmentSettings.asset` Development URL was changed to
      `http://127.0.0.1:3000` locally; the repository still says `localhost`
      (item 5). Commit that change from the laptop (Next steps 1). Cloud
      sessions don't touch the file, so it can't conflict.
    - TMP Essential Resources were imported (`Assets/TextMesh Pro/`, not yet
      in Git) and the Console is clean.

Done in the cloud after that — compiled and tested there, **not yet checked
in the Unity Editor**:

27. Arabic UI on TextMeshPro + RTLTMPro (`6d4035b`, `d45f25d`, `eead30b`,
    `ac4e213`): Arabic letters are joined and laid out right-to-left.
    - **Package:** `com.nosuchstudio.rtltmpro` 4.0.0, RTLTMPro's Unity 6
      release, installed the way its README documents (git URL
      `https://github.com/hk1ll3r/RTLTMPro.git?path=/UPMPackage#v4.0.0`,
      locked to commit `69c9193`). Unity downloads it with git on first
      open. Its demo `.unitypackage` (sample scenes, Segoe UI fonts) is not
      imported; Segoe UI is not redistributable.
    - **Before:** 145 legacy `Text` and 7 `InputField` components in the 6
      scenes and 10 UI prefabs (Boot has none), 3 world-space `TextMeshPro`
      labels, and 68 `Text`/`InputField` fields in 28 scripts.
      - By role: 37 static labels, 30 button labels, 46 player-data/number
        labels, 15 status/error/message labels, 3 other dynamic labels, 14
        input text/placeholder components.
      - By content: 64 static Arabic texts, 41 Latin/number-only, 40 empty
        until code fills them; no static text mixes Arabic with Latin.
    - **After:** 0 legacy components.
      - Labels: 138 `RTLTextMeshPro` (Farsi off, numbers kept as typed) and
        3 `RTLTextMeshPro3D`. Latin-only text (numbers, emails, usernames)
        passes through unchanged.
      - Inputs: 7 `TMP_InputField`, each with a left-to-right
        `TextMeshProUGUI` for the typed text (email, password, username and
        player id are Latin) and an `RTLTextMeshPro` placeholder.
      - Converted in place with the same fileIDs, so references, layout,
        sizes, colours and button wiring are unchanged. Scripts use
        `TMP_Text` / `TMP_InputField`; `RtlLayoutFlip` sets the TMP
        horizontal alignment.
      - Text overflow is now "Overflow" (always visible) instead of the
        legacy "Truncate", because the new font's metrics differ.
    - **Font:** every text uses the project default font (TMP Settings →
      Default Font Asset). The repository has no Arabic font yet; see Next
      steps 2.
    - **Messages:** 11 Arabic messages put U+200F (right-to-left mark)
      before punctuation that follows a Latin word, number or value;
      RTLTMPro otherwise draws it on the wrong side. The class-choice
      message no longer puts parentheses around Latin words. All 145 script
      messages and 52 scene texts were checked against the Unicode bidi
      algorithm.
    - **Usernames:** Onboarding checks the backend's rule
      (`Auth/UsernameRules.cs`, the same pattern as `auth.service.js`)
      before calling the server, and shows "اسم المستخدم يجب أن يكون من 3
      إلى 20 حرفاً، ويستخدم الحروف الإنجليزية والأرقام و _ فقط." for it and
      for `INVALID_USERNAME`. The backend rule is unchanged.
    - **Tests:**
      - `backend/tests/unity/uiText.test.js` (14 checks, part of `npm test`)
        reads every scene, prefab and script.
      - EditMode `ArabicRtlTextTests` (27): joining, tashkeel, digits, Latin
        pass-through and punctuation order.
      - EditMode `ArabicUiAssetTests` (Editor only): loads every Build
        Settings scene and prefab, and checks the project font has every
        glyph the UI draws.

28. Pre-Alpha pass (cloud; `d268fd1`, `d0bfd0f`, `35c4721`, `431f2b4`,
    `8f25be0`, `caa311c`, `eab6108`, `79a6426`): compiled and tested in the
    cloud, **not yet checked in Unity**.
    - **Backend input:** 22 of 41 malformed-input cases answered 500 against
      real PostgreSQL. Non-UUID path ids now answer the resource's existing
      not-found code, non-UUID body ids and an over-long inventory
      `request_id` answer 400, malformed JSON 400, a body over 1 MB 413
      `PAYLOAD_TOO_LARGE`; a client `X-Request-Id` is kept only if it is a
      short plain id. Tests: `inputValidation.test.js`,
      `contract/db/inputRobustness.dbtest.js`.
    - **Challenge race:** simultaneous challenges (a double tap, or two
      players challenging each other) created several battles. Challenge
      creation now holds per-player advisory locks in one transaction;
      proven against real PostgreSQL (and the test fails without the lock).
    - **Onboarding regression from item 27:** the class cards' names were set
      through prefab overrides of the legacy `m_Text` field and would have
      shown "Class"; they now set `originalText`/`m_text`, and
      `uiText.test.js` checks every text override names a real field.
    - **Privacy:** endpoints written to the device log end at the path (the
      nearby query carries coordinates); the Mapbox stub no longer logs them.
    - **Unity flow:** Login, Register, Onboarding Confirm and Challenge ignore
      a second tap while in flight; a refused challenge shows an Arabic
      reason; a failed room join clears `BattleSession`; the Battle loading
      screen re-checks the battle every 1.5 s and leaves after the server's
      30 s ready timeout instead of waiting forever; entering Battle without
      a session no longer dead-ends; a refused location permission or GPS
      failure shows "الموقع غير متاح"; the SOS poll stops for an SOS that is
      gone or not this player's.
    - **Repository:** `.gitignore` adds `obj/`, `desktop.ini` and Office lock
      files. A full-history secret scan (62 commits; values never printed)
      found only placeholders and test fixtures.
    - Laptop/phone checklists: `build-recovery/PRE_ALPHA_CHECKLISTS.md`.

29. Alpha defender flow (cloud; `481f484`, `94e06e3`, `67f5b26`): from the
    approved product decision of 2026-10-19. Compiled and tested in the
    cloud, **not yet checked in Unity, never run with the Photon SDK**.
    - **Lifecycle** (migration `021_battle_challenge_response.sql`): the
      existing `battles.status` values plus `accepted_at` / `declined_at`
      (at most one is set).

      | State | Stored as | Blocks both players |
      |---|---|---|
      | pending | `in_progress`, both NULL | yes |
      | accepted | `in_progress`, `accepted_at` set | yes, until the battle ends |
      | declined | `cancelled`, `declined_at` set | no |
      | expired | `cancelled`, both NULL | no |

      - A pending challenge expires 30 s after it was sent (the existing
        ready timeout, `BATTLE_READY_TIMEOUT_SECONDS`).
      - On accept, the ready timeout and the 298 s no-result cutoff restart
        from `accepted_at`.
      - Expiry is the existing lazy cleanup (`expireStaleBattles`), which
        runs before every battle call, so it is deterministic.
      - History rows are kept. Rows from before the migration are recorded
        as accepted at their start time. Rescue is unchanged.
    - **Endpoints:** all need the Firebase token. The player id always comes
      from the token, never from the body.
      - `GET /battle/incoming`: only the defender sees the challenge, and
        only these attacker details. Limit: 3 per 5 s.
        - No challenge: `{challenges: []}`.
        - One challenge: one entry with `battle_id`, `attacker_id`,
          `attacker_username`, `attacker_class_type`, `attacker_rank` and
          `expires_at`.
      - `POST /battle/{id}/accept` and `/decline`: limit 3 per 5 s.
        - Answer: `battle_id`, `attacker_id`, `defender_id`, `status`,
          `challenge_state`, `photon_room_name`, `session_expires_at`.
        - Never `host_authority_secret` or `match_nonce`.
        - A non-UUID id answers 404 `BATTLE_NOT_FOUND`.
      - Errors:
        - the attacker answering: 403 `NOT_CHALLENGE_DEFENDER`;
        - anyone else answering: 403 `FORBIDDEN`;
        - a second answer: 409 `CHALLENGE_ALREADY_ANSWERED`;
        - expired, declined, resolved or forfeited: 409 `SESSION_EXPIRED`;
        - ready, disconnect, reconnect or resolve before an accept: 409
          `CHALLENGE_NOT_ACCEPTED`.
      - `GET /battle/{id}` and the challenge response also carry
        `challenge_state` and `accepted_at`.
    - **Concurrency:** accept and decline are each one guarded `UPDATE`.
      - The guard: `status = 'in_progress'`, `accepted_at IS NULL`,
        `declined_at IS NULL` and `defender_id` = the caller. Accept also
        requires the 30 s window.
      - PostgreSQL's row lock lets exactly one answer win. The loser re-reads
        the row and reports what won.
      - Proven against real PostgreSQL: simultaneous accept/decline, and
        accept racing expiry. Removing each guard makes its test fail.
    - **Unity, defender:** `Map/IncomingChallengeCoordinator` is on MainMap
      → Managers. The rules are in the Unity-free `IncomingChallengeFlow`
      and `IncomingChallengeMessages`.
      - It polls `GET /battle/incoming` every 5 s while MainMap is enabled:
        one loop, one request at a time, cancelled in `OnDisable`.
      - It shows one Arabic prompt ("تحدٍّ جديد", "قبول" / "رفض"). The prompt
        closes when the challenge expires or is replaced.
      - A second tap sends nothing.
      - A network or rate-limit failure may offer the same challenge again;
        a final refusal never does.
      - Accept stores `BattleSession` without signing material and calls
        `PhotonRoomLifecycle.JoinAsDefenderAsync` (Photon Client).
      - Decline leaves MainMap as it was.
      - Another account signing in closes the prompt and drops late answers
        for the previous player.
    - **Unity, attacker:** after `POST /battle/challenge`,
      `PhotonRoomLifecycle` shows "بانتظار الخصم" and polls
      `GET /battle/{id}` every 1.5 s (`BattleLifecycle.NextOutgoingStep`).
      - It joins as Photon Host only after reading `accepted`.
      - Declined: shows "رفض الخصم التحدي.".
      - No answer, or past 30 s plus one poll: shows "لم يرد الخصم على
        التحدي في الوقت المحدد.".
      - In both cases `BattleSession` is cleared.
    - **Popups:** `PopupManager` shows one popup at a time. Its buttons now
      act on the popup on screen; they used to pop the newest queued one.
      `Dismiss(key)` closes a popup that is no longer valid.
    - **Photon boundary:** `PhotonConnectionManager.JoinRoomAsync(roomName,
      asHost)`.
      - The attacker calls it with `asHost: true` after the accept and
        starts `GameMode.Host`.
      - The defender calls it with `asHost: false` and starts
        `GameMode.Client`.
      - Both use `SessionName = photon_room_name` (`battle_<battle_id>`,
        from the server) and `PlayerCount = 2`.
      - Without `PHOTON_FUSION_AVAILABLE`, the stub only logs the role and
        reports success. No room exists, so stub mode proves nothing about
        Photon. The SDK branch has never been compiled.
      - The defender joins right after accepting; the attacker notices the
        accept on its next poll, up to about 1.5 s later. The Client can
        therefore arrive before the Host has started the session
        (`PRE_ALPHA_CHECKLISTS.md` §2).
    - **Accepted Alpha debt (host authority):** the attacker is the Photon
      host and alone holds `host_authority_secret`, so a modified attacker
      client can sign any outcome.
      - Results stay bound to the battle, nonce, sequence and time, are
        checked for plausibility, and suspicious ones are held for review.
      - Approved to keep for Alpha on 2026-10-19. After Alpha, plan server or
        Photon-server authority.
    - **Deferred:** a push notification for a new challenge (needs FCM).

Verified on the real laptop on 2026-10-19 (a Claude session running on the
laptop; Unity 6000.0.58f2, Android target):

30. **Laptop synced; first real Unity test run** (`3e599ce`, `126a0e4`,
    `81e8898`, `d61649d`, `7323427`, `b138b94`).
    - Next steps 1 done: TMP Essentials and the `127.0.0.1` URL committed,
      then merged with the branch. A duplicate Firebase Android config named
      `.json` in the repo root was deleted (the real one is
      `Assets/google-services.json`, ignored). The old
      `Packages/packages-lock.json` is kept in `stash@{0}`.
    - Unity opened the project with no compile errors and downloaded
      RTLTMPro.
    - EditMode: 339 tests, 36 failed. The failing tests had never run in
      Unity before.
      - 26 used `AddComponent` without `Awake`/`OnEnable`, which EditMode
        does not call. The tests now call them through a helper; no script
        changed (`81e8898`).
      - 9 depend on time passing and moved to PlayMode, unchanged
        (`Tests/PlayMode`, own asmdef; `d61649d`).
      - The Bulwark test expected 120 health, but its own comments describe
        130 (first hit fully absorbed). The expectation is now 130.
    - **Bug found and fixed:** energy never regenerated above 10 FPS.
      `PlayerCombat.RegenerateEnergy` rounded each frame's `5 × deltaTime`
      to an integer (0 at normal frame rates). It now accumulates the
      fraction, restoring the approved +5/s (`7323427`). No other script
      rounds a per-frame `deltaTime` value.
    - Result: EditMode 329 of 330 pass; the one failure is
      `ArabicUiAssetTests.ProjectFont_HasEveryGlyphTheUiDraws` (no Arabic
      font yet, Next steps 2). PlayMode 9 of 9 pass.
    - Laptop-only files sorted (`61d9f23`, `38af2de`, `7eca576`,
      `1657b7f`, `7ab67bf`, `28ce2d8`); `git status` on the laptop is clean.
      - Ignored, per machine: the Firebase Unity SDK (231 MB; one file is
        106.6 MB, over GitHub's 100 MB limit), EDM4U,
        `GeneratedLocalRepo/`, `Plugins/iOS|tvOS/`,
        `Editor Default Resources/`, `AndroidResolverDependencies.xml`,
        `StreamingAssets.meta`, `csc.rsp`.
      - Committed: Unity's standard `ProjectSettings/*` files,
        `GvhProjectSettings.xml`, `ProjectVersion.txt`,
        `Packages/packages-lock.json` (with RTLTMPro), the three Android
        Gradle templates EDM4U enabled, and `backend/package-lock.json`
        (580 entries, all from registry.npmjs.org; `npm ci` installs 579
        packages, `npm test` 433/433).
      - `ProjectSettings.asset` (real Android Player Settings): package
        `com.NFOUZ.NFOUZ1`, ARM64 only, "Allow downloads over HTTP" =
        development builds only, the three Gradle templates enabled, no
        scripting defines (the misspelled `FIREBASE_ATHU_AVAILABLE` was
        removed; `csc.rsp` defines `FIREBASE_AUTH_AVAILABLE` locally), no
        keystore set. IL2CPP was selected in the Editor, but the file
        stores `scriptingBackend: {}` (Unity's default). Confirm the first
        Android build log says IL2CPP.
    - **A new machine** after cloning: import `FirebaseAuth.unitypackage`
      13.17.0 (Firebase Unity SDK), run EDM4U → Android Resolver → Force
      Resolve, put `google-services.json` in `Assets/`, and create
      `Assets/csc.rsp` with the single line
      `-define:FIREBASE_AUTH_AVAILABLE`. None of these are in Git.
    - The project lives under OneDrive
      (`OneDrive\Documents\GitHub\NfOUZ`); moving it out is recommended
      (sync conflicts with `Library/`).

Current test counts (cloud, after item 29; run from `backend/`):

| Command | Result |
|---|---|
| `npm test` (same as `npx jest --runInBand`; includes the fake-database contract test and the Unity UI checks) | 32 suites / 433 tests |
| `npm run test:contract` | 53 tests |
| `npm run test:contract:db` (needs `CONTRACT_TEST_DATABASE_URL`, item 22) | 133 tests: 58 contract + 11 challenge answer + 20 battle lifecycle + 44 input robustness |
| Unity EditMode / PlayMode in the real Editor (laptop, item 30) | 329 of 330 / 9 of 9 |
| Unity EditMode, run under .NET in the cloud | `AuthErrorMessagesTests` 17, `AuthSessionTests` 30, `BattleLifecycleTests` 33, `IncomingChallengeFlowTests` 23, `IncomingChallengeMessagesTests` 19, `PopupStackTests` 13, `ActionGateTests` 2, `ChallengeErrorMessagesTests` 11, `LogRedactionTests` 4, `SosPollingTests` 7, `ArabicRtlTextTests` 27, `PlayerSessionDataContractTests` + `BattleSessionPartialUpdateTests` + `CultureInvariantRequestTests` 13 of 14 (the 14th needs Unity's JsonUtility) |

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
- Arabic UI (item 27), after Next steps 1–2:
  - Package Manager lists "RTL Text Mesh Pro" 4.0.0. The Console has no
    errors and no "missing script" warnings in any scene.
  - EditMode: `ArabicRtlTextTests` and `ArabicUiAssetTests` pass.
    `ProjectFont_HasEveryGlyphTheUiDraws` fails until the Arabic font is
    set, and lists each missing character.
  - Login/Register: titles, buttons and placeholders read right-to-left with
    joined letters; a typed email/password runs left-to-right; the password
    shows asterisks; an error (e.g. a wrong password) shows joined Arabic.
  - Onboarding: an Arabic or 2-letter username shows the new username
    message without a server call.
  - MainMap: HUD numbers, bottom tabs, every screen title, Profile
    (username, stats), Settings toggles, popups, toasts, the SOS banner, and
    quest/inventory/friend list items.
  - Battle and Result panels (stub mode): titles and the return button.
  - No text overlaps or runs outside its panel; the ⚙ Settings button and
    the ✓ quest badge show a glyph, not a box.
- Pre-Alpha fixes (item 28):
  - Onboarding: the three cards read Scout, Ranger and Titan.
  - Double-tap Login, Register and Confirm: one request each (backend log),
    one scene change.
  - MainMap in the Editor: a "الموقع غير متاح" popup (the Editor has no GPS).
  - Battle in stub mode: challenge, stay on the loading screen — after about
    31 s it returns to MainMap and the same player can be challenged again.
- Defender flow (item 29):
  - MainMap → Managers has `IncomingChallengeCoordinator` with
    `Photon Room Lifecycle` assigned; EditMode `IncomingChallengeFlowTests`,
    `IncomingChallengeMessagesTests`, `PopupStackTests` and
    `BattleLifecycleTests` pass.
  - Signed in on MainMap, the backend log shows `GET /battle/incoming` 200
    about every 5 s, and none after leaving MainMap.
  - The challenge itself needs two clients with locations (the Editor has
    no GPS): `PRE_ALPHA_CHECKLISTS.md` §2, "Two-device defender test".

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

None since 2026-10-18 (item 26). The resolved blocker is kept under "Local
setup reference" below.

## Next steps (in order)

Step 1 was done on 2026-10-19 (item 30); kept below for a new machine.

1. Bring this branch to the laptop without losing local work. In PowerShell
   at the repo root, run `git status` first. Expected local changes:
   `Assets/TextMesh Pro/` (untracked: TMP Essentials),
   `Assets/_Project/Resources/ApiEnvironmentSettings.asset` (127.0.0.1),
   maybe `Packages/packages-lock.json` or `ProjectSettings/*` (written by
   Unity), and `Assets/csc.rsp` (untracked, item 6).
   1. Commit TMP Essentials and the URL. No cloud commit touches them, so
      they can't conflict:
      ```powershell
      git add "Assets/TextMesh Pro" Assets/_Project/Resources/ApiEnvironmentSettings.asset
      git commit -m "Add TMP Essential Resources; use 127.0.0.1 for the local backend"
      ```
      Commit the whole `Assets/TextMesh Pro` folder with its `.meta` files
      (TMP Settings, LiberationSans SDF and `LiberationSans - OFL.txt`,
      shaders, sprites, style sheets, line-breaking rules): every machine
      needs the same TMP Settings. Leave out
      `Assets/TextMesh Pro/Examples & Extras` if it was imported.
   2. If `Packages/packages-lock.json` is modified, run
      `git stash push Packages/packages-lock.json`. This branch adds the
      RTLTMPro entry, and Unity rewrites the file anyway.
   3. If any file under `Assets/_Project/Scenes` or `Assets/_Project/Prefabs`
      is modified, stop and ask before pulling: this branch rewrites every
      text component in them.
   4. `git pull`. Leave a stashed lock file in the stash unless Unity
      reports a package error.
   5. Open the project in Unity 6000.0.58f2. The Package Manager downloads
      RTLTMPro (needs git on PATH and access to github.com). The Console
      must be clean.
2. Arabic font. The repository has no Arabic font, and RTLTMPro's demo
   Segoe UI fonts may not be redistributed, so a font must be chosen and
   added on the laptop:
   1. Pick an Arabic font under the SIL Open Font License whose cmap
      includes Arabic Presentation Forms-B (U+FE70–U+FEFF): RTLTMPro outputs
      those code points. Candidates: Noto Naskh Arabic or Noto Sans Arabic
      (Google Fonts, OFL 1.1). Choosing the family is a product decision.
   2. Put the `.ttf` and its `OFL.txt` together in
      `Assets/_Project/Fonts/<Family>/`. `uiText.test.js` rejects a font
      without a license file next to it.
   3. Window → TextMeshPro → Font Asset Creator: Source = that `.ttf`,
      Atlas Resolution 2048×2048, Render Mode SDFAA, Character Set "Unicode
      Range (Hex)" =
      `20-7E,A0,2014,2026,2192,200F,060C,061B,061F,0621-063A,0640-065F,0660-0669,0670,FC5E-FC63,FE70-FEFF`.
      Generate, then save as `Assets/_Project/Fonts/<Family>/<Family> SDF.asset`.
   4. In the new font asset, add `LiberationSans SDF` (TMP Essentials) under
      Fallback Font Assets, for Latin letters the Arabic font lacks.
   5. Project Settings → TextMesh Pro → Settings → Default Font Asset = the
      new Arabic SDF asset.
   6. Run EditMode `ArabicUiAssetTests.ProjectFont_HasEveryGlyphTheUiDraws`.
      It lists every missing code point. ⚙ (U+2699) and ✓ (U+2713) may be
      missing from both fonts; see the backlog.
   7. Commit `Assets/_Project/Fonts/**` (font, `OFL.txt`, SDF asset, `.meta`
      files) and the changed `Assets/TextMesh Pro/Resources/TMP Settings.asset`.
3. Run "Check in Unity after pulling" above, especially the Arabic UI list.
4. Optional: the real-database contract test (backlog, "Needs the laptop").

### Local setup reference (done on 2026-10-18; repeat on a new machine)

Resolved blocker, for the record:

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

Setup steps used:

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

## PRE-ALPHA ROADMAP

In priority order. Done means compiled and tested in the cloud unless it
says "verified on the laptop".

1. **Already complete.**
   - Verified on the laptop: Unity 6000.0.58f2 project; Boot → Login →
     Register → Onboarding → MainMap; PostgreSQL 16 with `nfouz_db`;
     backend `/health` 200; Firebase Admin; `127.0.0.1:3000` instead of
     `localhost` (Curl error 56); TMP Essential Resources imported.
   - Cloud only: items 11–25 and 27–28 (API contract fixes, contract tests
     in both modes, token refresh, battle lifecycle, Arabic/TMP/RTLTMPro,
     the pre-Alpha fixes).
2. **Laptop reconciliation:** done on 2026-10-19, untracked files sorted
   (item 30).
3. **Arabic font and visual validation:** Next steps 2, then
   `PRE_ALPHA_CHECKLISTS.md` §1 and "Check in Unity after pulling".
4. **Defender flow:** decided on 2026-10-19 and built in the cloud
   (item 29); checked on devices by the two-device test in step 5.
5. **Photon:** account and App ID, Fusion 2 SDK, the remaining code items and the
   two-device test — `PRE_ALPHA_CHECKLISTS.md` §2.
6. **Mapbox/GPS:** SDK decision, token, phone test — §3.
7. **Android build and signing:** §4.
8. **Full gameplay test** on two phones: register, find each other on the
   map, challenge, fight, result and rewards, reconnect, SOS/rescue between
   friends, quests and inventory.
9. **Deferred past Alpha:** Sprint 11, Faction System, Battle Pass, the Shop
   backend, the AYAZ backend, FCM on iOS, production deployment and HTTPS,
   server-authoritative combat (see the host-authority decision), Arabic
   usernames, logout UI.

## Backlog after the Register → MainMap test (do not start without approval)

Completed work is items 1–29 above; nothing completed is listed here.

Needs the laptop:
- "Next steps (in order)" above: reconcile and pull, the Arabic font, then
  the Unity checks.
- "Check in Unity after pulling" and "Notes for the laptop" above.
- Optional, now that local PostgreSQL works: create the
  `nfouz_contract_test` role/database (item 22) and run
  `npm run test:contract:db` (README, "Real-database mode"). It never
  touches `nfouz_db`.

Needs a decision or approval:
- **Host authority (accepted for Alpha on 2026-10-19, item 29):** revisit
  after Alpha — server-side or Photon-server authority.
- **Challenge push notification:** deferred until FCM; the defender learns
  of a challenge only while MainMap is open (item 29).
- **Usernames are case-sensitive:** "Player" and "player" can both exist
  (look-alike names).
- **Error fallback text** shows the server code ("حدث خطأ: CODE",
  "تعذّر إرسال نداء الاستغاثة: CODE"); `SosStatusMessagesTests` pin that.
  Keep for Alpha debugging or replace with a generic Arabic message.
- **Editor location:** the Editor has no GPS, so MainMap shows no nearby
  players there. A dev-only simulated location would be a new tool.
- **Mapbox SDK:** the code uses the Mapbox Maps SDK for Unity v2.x API;
  confirm it supports Unity 6 before buying into it.
- **Safe area / orientation** for notched phones (no handling yet).
- Arabic font family (Next steps 2): **decided on 2026-10-19: Noto Sans
  Arabic** (Google Fonts, OFL 1.1). Use the static
  `NotoSansArabic-Regular.ttf` from the download's `static/` folder, not the
  variable font, and confirm its cmap covers U+FE70–U+FEFF before
  generating the SDF asset.
- ⚙ (Settings button) and ✓ (quest "claimed" badge) are text symbols. If
  the chosen fonts lack them: add an OFL symbol font as a fallback, or
  replace them with icons.
- Digits: Western digits (0–9) are kept as typed in Arabic text. Showing
  Arabic-Indic digits (٠–٩) instead would be a one-setting change
  (`preserveNumbers`), but it is a product choice.
- RTLTMPro limits found in the migration:
  - a sign is drawn before the number ("+100", not "100+");
  - parentheses around Latin words are misplaced (avoided in current
    messages);
  - typed Arabic input is not supported in the TMP input fields (all
    current inputs are Latin; matters only if Arabic usernames are
    approved).
- Whether `Result.unity` should be loaded by the flow or retired; it is
  currently unused (see item 12).
- Usernames: the backend accepts only `^[a-zA-Z0-9_]{3,20}$`. Arabic names
  are rejected; Onboarding now explains the rule before sending (item 27).
  Supporting Arabic usernames needs a backend rule change and RTL input.
- Logout: `FirebaseManager.SignOut` is called only when a session ends
  (item 24); no screen offers logout.
- Battle loading screen: a battle the server cancels while the player
  waits is noticed only on the player's next battle call (item 25). A live
  check while waiting would be a separate change.

Needs the developer's external accounts:
- Firebase Admin service-account key: done on the laptop (item 26); a new
  machine needs it again ("Local setup reference", step 1).
- Photon Fusion import (Battle has stub mode only), then Mapbox (needs an
  asmdef for its sources). Each needs its account and App ID / token, kept
  out of Git.

Future features (not Build Recovery):
- Faction System (see item 14).
- Sprint 11 and anything else not already in the Sprint 1–10 code.

Rule for later changes: when a Unity API call or a backend response changes
on purpose, update `backend/tests/contract/scenarios.js` / `allowlist.js` in
the same commit (see `backend/tests/contract/README.md`).
