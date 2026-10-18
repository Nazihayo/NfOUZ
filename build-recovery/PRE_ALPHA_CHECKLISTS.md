# NFOUZ — Pre-Alpha laptop and phone checklists

Companion to `build-recovery/HANDOFF.md` ("PRE-ALPHA ROADMAP"). Everything
here needs the developer's laptop, Unity Editor, a phone, an account or a
decision; nothing in it can be verified from a cloud session. Never commit
an App ID, token, key, keystore or password while following it.

## 1. Arabic font and visual validation

Steps are in HANDOFF "Next steps 2". What the font must cover (measured from
every scene text and every Arabic message in the scripts at `caa311c`):

| Needed | Code points | Why |
|---|---|---|
| Arabic letters (shaped) | U+FE70–U+FEFC (Presentation Forms-B; the highest used is U+FEFC, lam-alef) | RTLTMPro outputs joined presentation forms, not base letters |
| Arabic base letters, tatweel, tashkeel | U+0621–U+063A, U+0640–U+065F, U+0670 | tashkeel is kept on top of joined letters (e.g. shadda U+0651, kasratan U+064D) |
| Arabic punctuation | U+060C ، , U+061B ؛ , U+061F ؟ | |
| Western digits and Latin | U+0020–U+007E | numbers stay Western (`preserveNumbers`); emails, usernames, "HP", "XP", "AYAZ", "SOS" |
| Symbols | U+2014 —, U+2026 …, U+2192 →, U+2699 ⚙, U+2713 ✓ | profile placeholders, messages, rank change, Settings button, quest badge |
| Right-to-left mark | U+200F | synthesized by TMP; no glyph needed |

Fallback order: the Arabic SDF asset is TMP Settings → Default Font Asset;
`LiberationSans SDF` is its first fallback (Latin). ⚙ and ✓ are usually in
neither font: either add an OFL symbol font (with its license file) as a
further fallback, or replace them with icons (product decision).

Visual checks after the font is set (EditMode `ArabicUiAssetTests` first):
- Login/Register: Arabic titles, buttons and placeholders right-to-left and
  joined; a typed email and password run left-to-right; password shows `*`;
  wrong password shows "البريد الإلكتروني أو كلمة المرور غير صحيحة."
- Onboarding: the three cards read Scout / Ranger / Titan (not "Class");
  an Arabic or 2-letter username shows the username-rule message without a
  server call.
- Messages that mix Arabic with a value end with the punctuation on the far
  left (e.g. "تم تجهيز sword." shows the period after "sword", leftmost).
- Numbers in Arabic text keep their order ("3 إلى 20"); "+100" keeps its sign
  on the left (RTLTMPro behaviour).
- Multiline texts (Popup message, blocked-players note) wrap right-to-left
  without clipping; nothing overlaps (overflow is now always visible).
- Battle/Result titles, the countdown, and toasts (quest completed, SOS).

## 2. Photon Fusion account, SDK and two-device test

What the code already assumes (verified by reading it; never compiled with
the SDK):
- **SDK:** Photon **Fusion 2** API (`INetworkRunnerCallbacks` with
  `OnDisconnectedFromServer(runner, NetDisconnectReason)`, `ReliableKey`,
  `OnObjectEnterAOI/ExitAOI`; `NetworkString<_32>`, `NetworkBool`,
  `[Networked]` properties, `GetInput`, `Runner.DeltaTime`).
- **Topology:** Host Mode, 2 players, session name = the server's
  `photon_room_name` (`battle_<battle_id>`). The attacker is the host by
  convention, and only the attacker receives `host_authority_secret`.
- **Authority split:** Photon carries movement/combat state; the backend
  owns battle existence, ready state, disconnect/reconnect grace (15 s),
  forfeits, the 30 s ready timeout, the 298 s no-result cutoff, result
  validation (HMAC signature, nonce, `event_seq`, timestamps) and all
  rewards.

Code work still needed before two players can meet (not settings; each is
a change to review and test on the laptop with the SDK present):
1. **Defender join flow (product decision first):** nothing tells the
   defender a challenge exists or makes them join the room (no push type,
   no polling, no accept/decline route). See HANDOFF backlog.
2. `PhotonConnectionManager.JoinRoomAsync` always starts `GameMode.Host`;
   the defender must start `GameMode.Client` for the same session.
3. `NetworkPlayerSpawner` instantiates locally even with the SDK; the host
   must `Runner.Spawn` one `NetworkPlayer` per player (input authority to
   that player), and despawn on leave.
4. No `OnInput` callback fills `NetworkInputData`, so nobody can move in a
   real session.
5. The networked `IsReady` flag is unused; readiness is the backend's
   `/ready` (keep it that way — the server decides).

Laptop steps:
1. Photon account: dashboard.photonengine.com → create an app of type
   **Fusion** (Fusion 2).
2. Copy its App ID. Never paste it into chat, code or Git.
3. Install Photon Fusion 2 for Unity (Photon's download/Asset Store). Confirm
   in its release notes that the version supports Unity 6000.0.58f2.
4. Tools → Fusion → Fusion Hub → enter the App ID. It is stored in
   `Assets/Photon/Fusion/Resources/PhotonAppSettings.asset`.
5. Confirm it stays out of Git: `git check-ignore -v Assets/Photon/Fusion/Resources/PhotonAppSettings.asset`
   must print the `**/PhotonAppSettings.asset` rule.
6. Add `PHOTON_FUSION_AVAILABLE` to Player Settings → Scripting Define
   Symbols (Android and Standalone). The Console must compile cleanly.
7. `Prefabs/Networking/NetworkPlayer.prefab`: add a `NetworkObject`
   component; `NetworkPlayerController` becomes a `NetworkBehaviour` under the
   define. Rebuild Fusion's prefab table. Assign the prefab to
   `NetworkPlayerSpawner.networkPlayerPrefab` in Battle (already assigned).
8. First two-client test (after code items 1–4): two devices or a build plus
   the Editor, two different accounts within 20 m (or a dev location),
   attacker challenges → both reach Battle → countdown → both move.
9. Disconnect/reconnect: kill the defender's app mid-match → host logs
   `OnPlayerLeft` and `POST /battle/{id}/disconnect` answers a deadline;
   restart within 15 s → `POST /reconnect` 200; after 15 s →
   `RECONNECT_WINDOW_EXPIRED` and the battle reads `forfeited`.
10. Result: finish a match → the attacker's client signs and posts
    `/resolve` → both clients show the result → MainMap; influence changes
    in `/auth/me`. Re-posting the same result answers `DUPLICATE_RESULT`; a
    defender-signed result is impossible (no secret) — confirm the defender
    never sends `/resolve`.

## 3. Mapbox and GPS (laptop, then phone)

What exists: `GPSLocationService` (permission, `Input.location`, PATCH
`/player/{id}/location` every 5 s), `NearbyPlayersTracker` (GET
`/player/nearby` every 6 s, radius 1000 m, markers pooled, stale markers
released on the next successful poll, kept on a network failure),
`MapboxManager` (stub: no map, all markers at the origin; SDK path uses the
**Mapbox Maps SDK for Unity v2.x** `AbstractMap`). Coordinates are sent with
the invariant culture; the server rejects implausible jumps
(`INVALID_LOCATION`) and rate-limits updates. Location is no longer written
to the device log (`431f2b4`). In the Editor `Input.location` does not run
(no Unity Remote), so MainMap shows "الموقع غير متاح" and no nearby players.

1. Account/token: decide first whether NFOUZ stays on the Mapbox Maps SDK
   for Unity v2.x (the code's API) — confirm it supports Unity 6. Then a
   Mapbox account and a **public** token (`pk.`) restricted to the app.
2. Import the SDK; give its sources an asmdef (backlog); add
   `MAPBOX_SDK_AVAILABLE` to the Scripting Define Symbols.
3. Mapbox → Setup → paste the token. It is written to
   `Assets/Resources/Mapbox/MapboxConfiguration.txt`;
   `git check-ignore -v` that file must print `**/MapboxConfiguration.txt`.
4. MainMap → Managers → MapboxManager: assign the `AbstractMap`.
5. Permissions: Android adds ACCESS_FINE_LOCATION when `Input.location` is
   used and `GPSLocationService` asks at runtime; iOS needs Player Settings →
   Location Usage Description (wording is a product decision; Arabic first).
6. Real device: install a development build pointed at the laptop's LAN IP
   (HANDOFF "Notes for the laptop"); accept the prompt; the backend log shows
   `PATCH /player/<id>/location` 200 every ~5 s.
7. Hamburg-area sanity test: two phones at a spot you choose in Hamburg;
   `players.last_lat/last_lng` match the spot within GPS accuracy, and each
   phone lists the other. Nothing in the code is tied to Hamburg.
8. Markers: one marker per nearby player, moving smoothly between polls; a
   phone that leaves the 1000 m radius or goes offline disappears on the
   next successful poll (~6 s).
9. Movement and denial: walk ~30 m apart and back — the Challenge button is
   enabled only within 20 m. Deny the permission → "الموقع غير متاح" popup;
   airplane mode → markers stay, updates resume when back online.

## 4. Android Alpha build

Only a 10-line `ProjectSettings/ProjectSettings.asset` stub is in Git; the
real Android settings exist only on the laptop. Review that file's diff
before committing any of it.

1. Player Settings: package identifier (decide it; changing it later breaks
   Firebase and store identity), version and `versionCode` (start at 1,
   increase on every upload), Minimum/Target API levels.
2. Scripting backend IL2CPP, Target Architectures ARM64 (Play requires 64-bit).
3. Active Input Handling: "Input Manager (Old)" or "Both" — the code uses the
   legacy `Input` API and `StandaloneInputModule`.
4. Orientation: decide (portrait is the UI's layout); no safe-area handling
   exists yet, so check notched phones (backlog).
5. "Allow downloads over HTTP": "Allowed in Development Builds" only
   (item 5). A release build needs an HTTPS backend.
6. Firebase: `google-services.json` in `Assets/` (ignored); EDM4U → Android
   Resolver → Force Resolve; `FirebaseApp.androidlib` stays ignored.
7. Keystore: create it on the laptop (Publishing Settings → Keystore
   Manager), store it **outside the repository** with a backup, and keep the
   passwords in a password manager. `*.keystore`, `*.jks` and
   `keystore.properties` are ignored. Register the release SHA-1/SHA-256 in
   the Firebase console if needed.
8. Build: a Development APK first; an AAB for Play internal testing later.
9. Install on a physical phone (`adb install`), backend reachable on the LAN.
10. Login/Register with a new account; Onboarding; MainMap.
11. Arabic UI (section 1) on the phone's own screen size.
12. GPS (section 3).
13. Photon two-device test (section 2).
14. Background/resume: home button during MainMap and during a battle; return
    within 15 s (reconnect) and after (forfeit).
15. Network loss: airplane mode on MainMap, during the loading screen (it
    returns to MainMap after the 30 s ready timeout) and mid-battle.
16. Token refresh: keep the app open over 1 hour, then open Friends (item 24).
17. Battle result: rewards and influence update on MainMap.
18. Crash/log review: `adb logcat -s Unity` — no exceptions, no coordinates,
    tokens or secrets in the log.
