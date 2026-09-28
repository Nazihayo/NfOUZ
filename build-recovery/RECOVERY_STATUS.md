# NFOUZ Build Recovery — Status

## Where the project stands

- **Backend:** complete and approved through Sprint 10 (Auth, GPS, Nearby
  Players, Influence/Control/Protection, Friends/SOS/Rescue + Sprint 8
  Critical Security Patch, Inventory + Quest System + Battle Pass XP,
  full UI integration + localization). 20 migrations, full
  repository/service/controller/route layers, Jest test files for every
  system.
- **Unity client:** 84 C# scripts + 15 EditMode test files exist and are
  internally consistent, well-guarded (Photon Fusion / Mapbox / Firebase
  Auth / Firebase Messaging are all behind scripting-define guards with
  working stub fallbacks), and cross-verified against the backend's real
  endpoints. **No Unity project scaffolding exists yet**: no
  `ProjectSettings/`, no `Packages/manifest.json`, no `.unity` scene
  files, no `.prefab` files, no `.meta` files. The five pre-existing
  scene-setup documents (now under `documentation/unity-scene-setup/`)
  describe Boot, Login, Onboarding, MainMap, and Battle in detail; no
  setup document exists yet for Result, or for the Sprint 9/10 UI panels
  (Inventory, Friends, SOS, Quest, Profile, Settings, BattlePass, Shop —
  confirmed to be panels inside MainMap's canvas, not separate scenes).

## Current phase: Build Recovery (no new features)

The project is in a scaffolding/reconstitution phase. No gameplay or
backend features are being added. The approved execution order is:

1. Create the Unity 6 project; graft `unity/Assets/_Project/Scripts/` and
   `Tests/EditMode/` in unmodified.
2. Create the folder structure (`Scenes/`, `Prefabs/{Core,UI,Map,Networking}/`,
   `Art/`, `Fonts/`, `Audio/`).
3. Install TextMeshPro + Test Framework via Package Manager.
4. Build the 6 real scenes (Boot, Login, Onboarding, MainMap, Battle,
   Result) and the 10 required prefabs (ClassSelectionCard,
   NearbyPlayerMarker, PlayerMarker, NetworkPlayer, Popup, Notification,
   QuestItem, InventoryItem, FriendListItem, FriendRequestItem).
5. Reach a first runnable build (Login → MainMap → Nearby Players →
   Challenge) with **zero third-party SDKs** — Mapbox already has a
   working stub mode, and GPS can be substituted with Unity's Editor
   location simulation for this stage.
6. Provision real accounts and import: Photon Fusion (blocks Battle —
   no offline fallback exists anywhere in the code), Firebase Auth +
   Messaging (blocks real login / real push), Mapbox (blocks real map
   rendering; deferrable).
7. Reach a first multiplayer build (Battle, two clients).
8. Reach a first full-gameplay build across the complete chain:
   Login → MainMap → Nearby → Challenge → Battle → Win/Lose → Control →
   SOS → Rescue → Protection.
9. Produce the code-referenced art gap: 4 weapon icons, 3 consumable
   icons, 3 class icons, status icons, and — highest priority — an
   Arabic-capable TMP font asset (the app defaults to Arabic; Unity's
   default font has no Arabic glyphs, and most existing UI scripts use
   legacy `Text`, which cannot shape Arabic at all).

## Known blockers (unchanged by this preparation pass)

- **CRITICAL** — No Unity project scaffolding exists on disk.
- **CRITICAL** — Photon Fusion is required for Battle with no fallback;
  requires a real Photon account + App ID that cannot be provisioned
  from an automated environment.
- **HIGH** — Firebase config (`google-services.json` /
  `GoogleService-Info.plist`) and a Mapbox access token do not exist and
  require real accounts.
- **MEDIUM** — Arabic text shaping risk: most UI is on legacy `Text`
  components, not TextMeshPro, and no Arabic font asset exists.

## What this preparation pass did

- Verified the current Sprints 1–10 repository state directly (file
  counts, script contents, migration list) rather than trusting prior
  summaries.
- Reorganized the repository into the root structure required for
  GitHub (`backend/`, `unity/`, `documentation/`, `database/`,
  `art-reference/`, `build-recovery/`) without moving or modifying any
  backend source, migration, or Unity script — only the five scene-setup
  markdown docs were relocated (from loose top-level folders under
  `unity/` into `documentation/unity-scene-setup/`), since they are
  documentation, not code or scene assets.
- Added a Unity-aware `.gitignore` that excludes only generated/local
  artifacts and secrets, never source, assets, `.meta` files, package
  manifests, `ProjectSettings`, tests, or documentation.
- Scanned the repository for exposed secrets (see the delivery message
  for the scan method and result) — none found; no fake credentials
  were created for Firebase, Photon, or Mapbox.

## What this preparation pass did NOT do

- No Unity Editor was opened (none is available in this environment) —
  no scenes, prefabs, or `.meta` files were created.
- No third-party SDK was imported.
- No new gameplay or backend feature was added.
- No existing approved system was modified or redesigned.
