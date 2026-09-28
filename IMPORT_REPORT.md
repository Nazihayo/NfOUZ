# NFOUZ — Build Recovery Phase 2 Import Report

- **Source:** `Nazihayo/Nfouz-` @ `809db78` ("Build Recovery preparation: Sprints 1-10 + GitHub structure"), the only commit in that repository.
- **Destination:** `Nazihayo/NfOUZ`, branch `claude/sprint-5-photon-multiplayer-5jv8v2`, on top of the Phase 1 Unity 6 scaffold (`24c79f1`).
- **Scope:** repository consolidation and compile validation only. No gameplay systems, scenes or prefabs were created. No backend or Unity script contents were changed.

## 1. Audit summary

| Area | Nfouz- (source) | NfOUZ (before import) | Result |
|---|---|---|---|
| Unity scripts (`.cs`) | 84 | 0 | Imported |
| EditMode tests (`.cs`) | 15 | 0 | Imported |
| Backend source (`backend/src`) | 54 | 0 | Imported |
| Backend tests (`backend/tests`) | 26 | 0 | Imported |
| Migrations (`backend/migrations`) | 21 (20 `.sql` + 1 manual down script) | 0 | Imported |
| Backend tooling (package.json, Dockerfile, compose, .env.example, scripts) | 5 | 0 | Imported |
| Documentation (`documentation/`, `build-recovery/`, `database/`, `art-reference/`, README, CLAUDE.md) | 12 | 0 | Imported |
| Unity project scaffold (`Packages/`, `ProjectSettings/`, folder `.meta`) | 0 | Phase 1 | Kept |
| `.gitignore` | yes | yes | **Conflict**, merged (see 3) |

Every source file existed only in `Nfouz-` except `.gitignore`. Nothing in NfOUZ was newer than, or overwritten by, the source.

## 2. How history was preserved

- **Merge commit:** the source history was merged with `--allow-unrelated-histories`, so `809db78` is an ancestor of the branch.
- **Relocation commit:** before the merge, one commit on top of the source (`9b3ace8`) moved `unity/Assets/_Project/{Scripts,Tests}` to `Assets/_Project/{Scripts,Tests}`. The Unity project lives at the repository root (Phase 1 layout). All 99 moves are pure renames, so `git log --follow` works across them.
- **Everything else:** kept its original path.

## 3. Conflicts

| File | Resolution |
|---|---|
| `.gitignore` | Both repos created it. The source version (Unity + Node + secrets rules) is kept verbatim. The Phase 1 lines not already covered are appended under "Unity — additional generated/local artifacts". Nothing was removed from either side. |

## 4. Files skipped

None. All 218 source files were imported. `unity/` no longer exists as a directory because its contents were relocated (section 2).

## 5. Files added in this phase (compile fixes / Unity import artifacts only)

| File(s) | Why |
|---|---|
| `Assets/_Project/Scripts/Nfouz.Runtime.asmdef` | Without assembly definitions, Unity compiles the tests into `Assembly-CSharp`, which cannot reference NUnit or the Test Framework, so the 15 test files would fail to compile. A test assembly cannot reference `Assembly-CSharp`, so the runtime scripts need their own assembly. References `Unity.TextMeshPro` and `UnityEngine.UI`. |
| `Assets/_Project/Tests/EditMode/Nfouz.Tests.EditMode.asmdef` | Editor-only test assembly. References `Nfouz.Runtime`, `UnityEngine.TestRunner`, `UnityEditor.TestRunner` and `nunit.framework.dll`, with define constraint `UNITY_INCLUDE_TESTS`. |
| 114 `.meta` files | 99 scripts (MonoImporter), 2 asmdefs (AssemblyDefinitionImporter), 13 folders. Fresh unique GUIDs, no duplicates. Unity would create these on first import; committing them keeps GUIDs stable for scenes and prefabs. |

## 6. Missing files

- **Scenes:** Boot, Login, Onboarding, MainMap, Battle, Result. Out of scope, not created.
- **Prefabs:** the 10 listed in `build-recovery/RECOVERY_STATUS.md`. Out of scope, not created.
- **Scene-setup documentation:** none exists for Result or for the Sprint 9/10 MainMap panels. Only five exist, in `documentation/unity-scene-setup/`.
- **`backend/package-lock.json`:** absent in the source, so dependency versions are not pinned.
- **Arabic-capable TMP font asset:** absent.
- **Stale paths in imported docs:** `CLAUDE.md` and `build-recovery/RECOVERY_STATUS.md` still describe the Unity project under `unity/`. They were imported unchanged, per the no-new-documentation rule.

## 7. Missing dependencies

**Unity SDKs.** All are behind scripting-define guards and fall back to stub code when the SDK is absent.

| Define symbol | SDK | Files guarded | Effect while absent |
|---|---|---|---|
| `PHOTON_FUSION_AVAILABLE` | Photon Fusion | PhotonConnectionManager, NetworkPlayerController, NetworkInputData, NetworkPlayerSpawner, BattleLoadingController, BattleManager | Compiles. The stub simulates a Host Mode join; no real networking, so a two-client Battle is impossible. |
| `FIREBASE_AUTH_AVAILABLE` | Firebase Auth | FirebaseManager | Compiles. Real login is unavailable. |
| `FIREBASE_MESSAGING_AVAILABLE` | Firebase Messaging | PushNotificationHandler | Compiles. Push notifications are unavailable. |
| `MAPBOX_SDK_AVAILABLE` | Mapbox Maps SDK | MapboxManager | Compiles. Stub map mode is used. |

Import notes for later phases:
- **Photon Fusion and Firebase** ship precompiled DLLs that are auto-referenced, so `Nfouz.Runtime.asmdef` picks them up once the define symbols are set.
- **Mapbox** ships as loose source compiled into `Assembly-CSharp`. An asmdef cannot reference `Assembly-CSharp`, so Mapbox will need its own asmdef, or an asmdef reference added to `Nfouz.Runtime`, when it is imported.

**Unity packages:** none missing. `Packages/manifest.json` already provides `com.unity.ugui` 2.0.0 (UGUI + TextMeshPro in Unity 6) and `com.unity.test-framework` 1.4.5.

**Backend runtime:** `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` and `DATABASE_URL` are required environment variables (see `backend/.env.example`). No real values exist in the repository, as intended.

## 8. Compile validation

**The Unity Editor is unavailable in this environment.** Downloads and the Unity package registry are blocked by network policy, so Unity compilation, script refresh and the Test Runner were **not run**.

**Stand-in compile check that was run:**

- **Toolchain:** .NET 8 SDK, C# 9 (Unity 6's language version), `netstandard2.1`.
- **Engine APIs:** Unity engine module reference assemblies (`UnityEngine.Modules` 2021.3.33 from NuGet).
- **UI library:** `UnityEngine.UI` built from Unity's public uGUI source (2018.4, with `reverseArrangement` added to match uGUI 1.0+/2.0).
- **Stand-ins:** minimal placeholders for `TMPro.TMP_Text` and `UnityEngine.TestTools.UnityTest`/`LogAssert`.
- **NUnit:** 3.5.0, matching the NUnit version in `com.unity.ext.nunit`.
- **Assembly split:** the same as the asmdefs in section 5.

| Configuration | Defines | Nfouz.Runtime | Nfouz.Tests.EditMode |
|---|---|---|---|
| Editor | `UNITY_EDITOR; UNITY_INCLUDE_TESTS` | 0 errors | 0 errors |
| Android player | `UNITY_ANDROID` | 0 errors | 0 errors |
| iOS player | `UNITY_IOS` | 0 errors | 0 errors |

- **Compile errors:** none in project code. The single error seen (`HorizontalLayoutGroup.reverseArrangement` in `RtlLayoutFlip.cs`) came from the stand-in's older uGUI version, not from the project; the API exists in Unity 6.
- **Missing namespaces:** none with the SDK defines off. With the defines on, `Fusion`, `Fusion.Sockets`, `Firebase`, `Firebase.Auth`, `Firebase.Extensions`, `Firebase.Messaging`, `Mapbox.Unity.Map` and `Mapbox.Utils` would be missing until the SDKs are imported.
- **Missing SDK references:** Photon Fusion, Firebase Auth, Firebase Messaging, Mapbox (section 7).
- **Missing packages:** none.
- **Test assembly validation:** all 15 EditMode test files compile as a separate assembly against `Nfouz.Runtime` alone, so no `InternalsVisibleTo` is needed. `[UnityTest]` coroutine tests exist in `PlayerCombatTests` and `CombatStateMachineTests`.
- **Limits of this check:** it cannot catch Unity 6-only API changes beyond what the 2021.3 reference assemblies expose, or anything that needs the real TextMeshPro and Test Framework assemblies. The first open in the Unity 6 Editor remains the authoritative compile.

## 9. Backend validation (imported code, unchanged)

- **Syntax:** `node --check` passes on every file in `backend/src` and `backend/scripts`.
- **Migrations:** all 20 `.sql` migrations apply in order through `scripts/run-migrations.js` against a fresh PostgreSQL 16 database, creating 22 public tables. `017_friends_sos_rescue_fcm.down.manual.psql` is a manual rollback script and is correctly skipped by the runner.
- **Jest:** 19 of 26 suites pass; 269 of 308 tests pass and 39 fail. The failures come from the source repository; no backend file was changed in this phase:

| Suite | Cause |
|---|---|
| `battle.test.js`, `location.test.js` | Rate limiter returns 429 inside the test run, before the expected 400/409 |
| `nearbyPlayers.test.js` | `response.body.data` is null (request rejected before the handler, same rate-limit pattern) |
| `auth.test.js` (1 test) | Expects `PLAYER_ALREADY_REGISTERED`, receives `USERNAME_TAKEN` |
| `player.repository.test.js` (1 test) | SQL assertion expects the pre-Sprint 7 `clearExpiredControl` statement |
| `fcm.service.test.js`, `database.transaction.test.js` | `jest.mock()` factory references out-of-scope variables (`messagingMock`, `fakePool`), so the suite fails to load |

## 10. Imported files

### Unity scripts (84)

- `Assets/_Project/Scripts/Auth/AuthController.cs` ← `unity/Assets/_Project/Scripts/Auth/AuthController.cs`
- `Assets/_Project/Scripts/Auth/OnboardingController.cs` ← `unity/Assets/_Project/Scripts/Auth/OnboardingController.cs`
- `Assets/_Project/Scripts/Combat/BattleManager.cs` ← `unity/Assets/_Project/Scripts/Combat/BattleManager.cs`
- `Assets/_Project/Scripts/Combat/ChargedPulseProjectile.cs` ← `unity/Assets/_Project/Scripts/Combat/ChargedPulseProjectile.cs`
- `Assets/_Project/Scripts/Combat/ClassAbilityDatabase.cs` ← `unity/Assets/_Project/Scripts/Combat/ClassAbilityDatabase.cs`
- `Assets/_Project/Scripts/Combat/CombatStateMachine.cs` ← `unity/Assets/_Project/Scripts/Combat/CombatStateMachine.cs`
- `Assets/_Project/Scripts/Combat/DamageCalculator.cs` ← `unity/Assets/_Project/Scripts/Combat/DamageCalculator.cs`
- `Assets/_Project/Scripts/Combat/PlayerCombat.cs` ← `unity/Assets/_Project/Scripts/Combat/PlayerCombat.cs`
- `Assets/_Project/Scripts/Combat/ResultController.cs` ← `unity/Assets/_Project/Scripts/Combat/ResultController.cs`
- `Assets/_Project/Scripts/Combat/WeaponBase.cs` ← `unity/Assets/_Project/Scripts/Combat/WeaponBase.cs`
- `Assets/_Project/Scripts/Combat/WeaponDatabase.cs` ← `unity/Assets/_Project/Scripts/Combat/WeaponDatabase.cs`
- `Assets/_Project/Scripts/Combat/WeaponGeometry.cs` ← `unity/Assets/_Project/Scripts/Combat/WeaponGeometry.cs`
- `Assets/_Project/Scripts/Core/ControlStateManager.cs` ← `unity/Assets/_Project/Scripts/Core/ControlStateManager.cs`
- `Assets/_Project/Scripts/Core/GameManager.cs` ← `unity/Assets/_Project/Scripts/Core/GameManager.cs`
- `Assets/_Project/Scripts/Core/InfluenceManager.cs` ← `unity/Assets/_Project/Scripts/Core/InfluenceManager.cs`
- `Assets/_Project/Scripts/Core/PlayerSession.cs` ← `unity/Assets/_Project/Scripts/Core/PlayerSession.cs`
- `Assets/_Project/Scripts/Core/RankCalculator.cs` ← `unity/Assets/_Project/Scripts/Core/RankCalculator.cs`
- `Assets/_Project/Scripts/Core/SceneLoader.cs` ← `unity/Assets/_Project/Scripts/Core/SceneLoader.cs`
- `Assets/_Project/Scripts/Core/ServiceLocator.cs` ← `unity/Assets/_Project/Scripts/Core/ServiceLocator.cs`
- `Assets/_Project/Scripts/Inventory/EquipmentManager.cs` ← `unity/Assets/_Project/Scripts/Inventory/EquipmentManager.cs`
- `Assets/_Project/Scripts/Inventory/InventoryController.cs` ← `unity/Assets/_Project/Scripts/Inventory/InventoryController.cs`
- `Assets/_Project/Scripts/Inventory/InventoryItem.cs` ← `unity/Assets/_Project/Scripts/Inventory/InventoryItem.cs`
- `Assets/_Project/Scripts/Inventory/InventoryModels.cs` ← `unity/Assets/_Project/Scripts/Inventory/InventoryModels.cs`
- `Assets/_Project/Scripts/Inventory/PlayerInventory.cs` ← `unity/Assets/_Project/Scripts/Inventory/PlayerInventory.cs`
- `Assets/_Project/Scripts/Map/ChallengeInteractionController.cs` ← `unity/Assets/_Project/Scripts/Map/ChallengeInteractionController.cs`
- `Assets/_Project/Scripts/Map/GPSLocationService.cs` ← `unity/Assets/_Project/Scripts/Map/GPSLocationService.cs`
- `Assets/_Project/Scripts/Map/GeoUtils.cs` ← `unity/Assets/_Project/Scripts/Map/GeoUtils.cs`
- `Assets/_Project/Scripts/Map/LocationModels.cs` ← `unity/Assets/_Project/Scripts/Map/LocationModels.cs`
- `Assets/_Project/Scripts/Map/MainMapRefreshRequest.cs` ← `unity/Assets/_Project/Scripts/Map/MainMapRefreshRequest.cs`
- `Assets/_Project/Scripts/Map/MapboxManager.cs` ← `unity/Assets/_Project/Scripts/Map/MapboxManager.cs`
- `Assets/_Project/Scripts/Map/MarkerPool.cs` ← `unity/Assets/_Project/Scripts/Map/MarkerPool.cs`
- `Assets/_Project/Scripts/Map/NearbyPlayerMarkerUi.cs` ← `unity/Assets/_Project/Scripts/Map/NearbyPlayerMarkerUi.cs`
- `Assets/_Project/Scripts/Map/NearbyPlayerSelection.cs` ← `unity/Assets/_Project/Scripts/Map/NearbyPlayerSelection.cs`
- `Assets/_Project/Scripts/Map/NearbyPlayersTracker.cs` ← `unity/Assets/_Project/Scripts/Map/NearbyPlayersTracker.cs`
- `Assets/_Project/Scripts/Networking/ApiClient.cs` ← `unity/Assets/_Project/Scripts/Networking/ApiClient.cs`
- `Assets/_Project/Scripts/Networking/BattleLoadingController.cs` ← `unity/Assets/_Project/Scripts/Networking/BattleLoadingController.cs`
- `Assets/_Project/Scripts/Networking/BattleResultSignature.cs` ← `unity/Assets/_Project/Scripts/Networking/BattleResultSignature.cs`
- `Assets/_Project/Scripts/Networking/BattleSessionData.cs` ← `unity/Assets/_Project/Scripts/Networking/BattleSessionData.cs`
- `Assets/_Project/Scripts/Networking/FirebaseManager.cs` ← `unity/Assets/_Project/Scripts/Networking/FirebaseManager.cs`
- `Assets/_Project/Scripts/Networking/NetworkInputData.cs` ← `unity/Assets/_Project/Scripts/Networking/NetworkInputData.cs`
- `Assets/_Project/Scripts/Networking/NetworkPlayerController.cs` ← `unity/Assets/_Project/Scripts/Networking/NetworkPlayerController.cs`
- `Assets/_Project/Scripts/Networking/NetworkPlayerSpawner.cs` ← `unity/Assets/_Project/Scripts/Networking/NetworkPlayerSpawner.cs`
- `Assets/_Project/Scripts/Networking/PhotonConnectionManager.cs` ← `unity/Assets/_Project/Scripts/Networking/PhotonConnectionManager.cs`
- `Assets/_Project/Scripts/Networking/PhotonRoomLifecycle.cs` ← `unity/Assets/_Project/Scripts/Networking/PhotonRoomLifecycle.cs`
- `Assets/_Project/Scripts/Networking/PushNotificationHandler.cs` ← `unity/Assets/_Project/Scripts/Networking/PushNotificationHandler.cs`
- `Assets/_Project/Scripts/Quests/QuestController.cs` ← `unity/Assets/_Project/Scripts/Quests/QuestController.cs`
- `Assets/_Project/Scripts/Quests/QuestItem.cs` ← `unity/Assets/_Project/Scripts/Quests/QuestItem.cs`
- `Assets/_Project/Scripts/Quests/QuestModels.cs` ← `unity/Assets/_Project/Scripts/Quests/QuestModels.cs`
- `Assets/_Project/Scripts/Quests/QuestTracker.cs` ← `unity/Assets/_Project/Scripts/Quests/QuestTracker.cs`
- `Assets/_Project/Scripts/Social/FriendListItem.cs` ← `unity/Assets/_Project/Scripts/Social/FriendListItem.cs`
- `Assets/_Project/Scripts/Social/FriendRequestItem.cs` ← `unity/Assets/_Project/Scripts/Social/FriendRequestItem.cs`
- `Assets/_Project/Scripts/Social/FriendsController.cs` ← `unity/Assets/_Project/Scripts/Social/FriendsController.cs`
- `Assets/_Project/Scripts/Social/RescueGuardCombat.cs` ← `unity/Assets/_Project/Scripts/Social/RescueGuardCombat.cs`
- `Assets/_Project/Scripts/Social/RescueGuardController.cs` ← `unity/Assets/_Project/Scripts/Social/RescueGuardController.cs`
- `Assets/_Project/Scripts/Social/RescueMissionController.cs` ← `unity/Assets/_Project/Scripts/Social/RescueMissionController.cs`
- `Assets/_Project/Scripts/Social/RescueResultController.cs` ← `unity/Assets/_Project/Scripts/Social/RescueResultController.cs`
- `Assets/_Project/Scripts/Social/SOSBannerOverlay.cs` ← `unity/Assets/_Project/Scripts/Social/SOSBannerOverlay.cs`
- `Assets/_Project/Scripts/Social/SOSManager.cs` ← `unity/Assets/_Project/Scripts/Social/SOSManager.cs`
- `Assets/_Project/Scripts/Social/SocialModels.cs` ← `unity/Assets/_Project/Scripts/Social/SocialModels.cs`
- `Assets/_Project/Scripts/UI/BottomNavController.cs` ← `unity/Assets/_Project/Scripts/UI/BottomNavController.cs`
- `Assets/_Project/Scripts/UI/ControlledCountdownDisplay.cs` ← `unity/Assets/_Project/Scripts/UI/ControlledCountdownDisplay.cs`
- `Assets/_Project/Scripts/UI/HUDController.cs` ← `unity/Assets/_Project/Scripts/UI/HUDController.cs`
- `Assets/_Project/Scripts/UI/LoadingManager.cs` ← `unity/Assets/_Project/Scripts/UI/LoadingManager.cs`
- `Assets/_Project/Scripts/UI/Localization/LocalizationManager.cs` ← `unity/Assets/_Project/Scripts/UI/Localization/LocalizationManager.cs`
- `Assets/_Project/Scripts/UI/Localization/RtlLayoutFlip.cs` ← `unity/Assets/_Project/Scripts/UI/Localization/RtlLayoutFlip.cs`
- `Assets/_Project/Scripts/UI/Localization/StringTable.cs` ← `unity/Assets/_Project/Scripts/UI/Localization/StringTable.cs`
- `Assets/_Project/Scripts/UI/NotificationManager.cs` ← `unity/Assets/_Project/Scripts/UI/NotificationManager.cs`
- `Assets/_Project/Scripts/UI/PlayerControlStatusIcon.cs` ← `unity/Assets/_Project/Scripts/UI/PlayerControlStatusIcon.cs`
- `Assets/_Project/Scripts/UI/PopupManager.cs` ← `unity/Assets/_Project/Scripts/UI/PopupManager.cs`
- `Assets/_Project/Scripts/UI/ProtectedCountdownDisplay.cs` ← `unity/Assets/_Project/Scripts/UI/ProtectedCountdownDisplay.cs`
- `Assets/_Project/Scripts/UI/ScreenId.cs` ← `unity/Assets/_Project/Scripts/UI/ScreenId.cs`
- `Assets/_Project/Scripts/UI/Screens/BattlePassScreen.cs` ← `unity/Assets/_Project/Scripts/UI/Screens/BattlePassScreen.cs`
- `Assets/_Project/Scripts/UI/Screens/BattleScreen.cs` ← `unity/Assets/_Project/Scripts/UI/Screens/BattleScreen.cs`
- `Assets/_Project/Scripts/UI/Screens/FriendsScreen.cs` ← `unity/Assets/_Project/Scripts/UI/Screens/FriendsScreen.cs`
- `Assets/_Project/Scripts/UI/Screens/MainMapScreen.cs` ← `unity/Assets/_Project/Scripts/UI/Screens/MainMapScreen.cs`
- `Assets/_Project/Scripts/UI/Screens/ProfileScreen.cs` ← `unity/Assets/_Project/Scripts/UI/Screens/ProfileScreen.cs`
- `Assets/_Project/Scripts/UI/Screens/SettingsScreen.cs` ← `unity/Assets/_Project/Scripts/UI/Screens/SettingsScreen.cs`
- `Assets/_Project/Scripts/UI/Screens/ShopScreen.cs` ← `unity/Assets/_Project/Scripts/UI/Screens/ShopScreen.cs`
- `Assets/_Project/Scripts/UI/Screens/SosScreen.cs` ← `unity/Assets/_Project/Scripts/UI/Screens/SosScreen.cs`
- `Assets/_Project/Scripts/UI/UIManager.cs` ← `unity/Assets/_Project/Scripts/UI/UIManager.cs`
- `Assets/_Project/Scripts/Utils/ApiResponse.cs` ← `unity/Assets/_Project/Scripts/Utils/ApiResponse.cs`
- `Assets/_Project/Scripts/Utils/Constants.cs` ← `unity/Assets/_Project/Scripts/Utils/Constants.cs`
- `Assets/_Project/Scripts/Utils/SecureDeviceKeyStore.cs` ← `unity/Assets/_Project/Scripts/Utils/SecureDeviceKeyStore.cs`
- `Assets/_Project/Scripts/Utils/ServerTime.cs` ← `unity/Assets/_Project/Scripts/Utils/ServerTime.cs`

### EditMode tests (15)

- `Assets/_Project/Tests/EditMode/BattleManagerHudAccessorsTests.cs` ← `unity/Assets/_Project/Tests/EditMode/BattleManagerHudAccessorsTests.cs`
- `Assets/_Project/Tests/EditMode/BattleManagerTests.cs` ← `unity/Assets/_Project/Tests/EditMode/BattleManagerTests.cs`
- `Assets/_Project/Tests/EditMode/ChargedPulseSimulatorTests.cs` ← `unity/Assets/_Project/Tests/EditMode/ChargedPulseSimulatorTests.cs`
- `Assets/_Project/Tests/EditMode/ClassAbilityDatabaseTests.cs` ← `unity/Assets/_Project/Tests/EditMode/ClassAbilityDatabaseTests.cs`
- `Assets/_Project/Tests/EditMode/CombatStateMachineTests.cs` ← `unity/Assets/_Project/Tests/EditMode/CombatStateMachineTests.cs`
- `Assets/_Project/Tests/EditMode/DamageCalculatorTests.cs` ← `unity/Assets/_Project/Tests/EditMode/DamageCalculatorTests.cs`
- `Assets/_Project/Tests/EditMode/LoadingCounterTests.cs` ← `unity/Assets/_Project/Tests/EditMode/LoadingCounterTests.cs`
- `Assets/_Project/Tests/EditMode/LocalizationManagerTests.cs` ← `unity/Assets/_Project/Tests/EditMode/LocalizationManagerTests.cs`
- `Assets/_Project/Tests/EditMode/NavigationStateTests.cs` ← `unity/Assets/_Project/Tests/EditMode/NavigationStateTests.cs`
- `Assets/_Project/Tests/EditMode/PlayerCombatTests.cs` ← `unity/Assets/_Project/Tests/EditMode/PlayerCombatTests.cs`
- `Assets/_Project/Tests/EditMode/PopupStackTests.cs` ← `unity/Assets/_Project/Tests/EditMode/PopupStackTests.cs`
- `Assets/_Project/Tests/EditMode/QuestDiffTests.cs` ← `unity/Assets/_Project/Tests/EditMode/QuestDiffTests.cs`
- `Assets/_Project/Tests/EditMode/SosStatusMessagesTests.cs` ← `unity/Assets/_Project/Tests/EditMode/SosStatusMessagesTests.cs`
- `Assets/_Project/Tests/EditMode/WeaponDatabaseTests.cs` ← `unity/Assets/_Project/Tests/EditMode/WeaponDatabaseTests.cs`
- `Assets/_Project/Tests/EditMode/WeaponGeometryTests.cs` ← `unity/Assets/_Project/Tests/EditMode/WeaponGeometryTests.cs`

### Migrations (21)

- `backend/migrations/001_extensions.sql`
- `backend/migrations/002_players.sql`
- `backend/migrations/003_factions.sql`
- `backend/migrations/004_battles.sql`
- `backend/migrations/005_friendships.sql`
- `backend/migrations/006_sos.sql`
- `backend/migrations/007_influence_log.sql`
- `backend/migrations/008_items.sql`
- `backend/migrations/009_inventory.sql`
- `backend/migrations/010_quests.sql`
- `backend/migrations/011_ai_agents.sql`
- `backend/migrations/012_player_visibility.sql`
- `backend/migrations/013_battle_sessions.sql`
- `backend/migrations/014_battle_result_authority.sql`
- `backend/migrations/015_battle_pending_review.sql`
- `backend/migrations/016_control_protection_credits.sql`
- `backend/migrations/017_friends_sos_rescue_fcm.down.manual.psql`
- `backend/migrations/017_friends_sos_rescue_fcm.sql`
- `backend/migrations/018_battle_pass_xp.sql`
- `backend/migrations/019_inventory_idempotency.sql`
- `backend/migrations/020_quest_daily_assignment.sql`

### Backend source (54)

- `backend/src/app.js`
- `backend/src/config/database.js`
- `backend/src/config/env.js`
- `backend/src/config/firebase.js`
- `backend/src/config/rankTiers.js`
- `backend/src/controllers/auth.controller.js`
- `backend/src/controllers/battle.controller.js`
- `backend/src/controllers/friend.controller.js`
- `backend/src/controllers/health.controller.js`
- `backend/src/controllers/inventory.controller.js`
- `backend/src/controllers/player.controller.js`
- `backend/src/controllers/quest.controller.js`
- `backend/src/controllers/rescue.controller.js`
- `backend/src/controllers/sos.controller.js`
- `backend/src/middleware/auth.middleware.js`
- `backend/src/middleware/errorHandler.js`
- `backend/src/middleware/rateLimit.middleware.js`
- `backend/src/middleware/requestId.js`
- `backend/src/repositories/battle.repository.js`
- `backend/src/repositories/controlRelationship.repository.js`
- `backend/src/repositories/creditTransfer.repository.js`
- `backend/src/repositories/friend.repository.js`
- `backend/src/repositories/influenceLog.repository.js`
- `backend/src/repositories/inventory.repository.js`
- `backend/src/repositories/player.repository.js`
- `backend/src/repositories/playerDevice.repository.js`
- `backend/src/repositories/quest.repository.js`
- `backend/src/repositories/rescue.repository.js`
- `backend/src/repositories/sos.repository.js`
- `backend/src/routes/auth.routes.js`
- `backend/src/routes/battle.routes.js`
- `backend/src/routes/friend.routes.js`
- `backend/src/routes/health.routes.js`
- `backend/src/routes/inventory.routes.js`
- `backend/src/routes/player.routes.js`
- `backend/src/routes/quest.routes.js`
- `backend/src/routes/rescue.routes.js`
- `backend/src/routes/sos.routes.js`
- `backend/src/server.js`
- `backend/src/services/auth.service.js`
- `backend/src/services/battle.service.js`
- `backend/src/services/creditsService.js`
- `backend/src/services/fcm.service.js`
- `backend/src/services/friend.service.js`
- `backend/src/services/inventory.service.js`
- `backend/src/services/location.service.js`
- `backend/src/services/quest.service.js`
- `backend/src/services/rescue.service.js`
- `backend/src/services/sos.service.js`
- `backend/src/utils/battleResultSignature.js`
- `backend/src/utils/deviceValidation.js`
- `backend/src/utils/geoUtils.js`
- `backend/src/utils/logger.js`
- `backend/src/utils/responseEnvelope.js`

### Backend tests (26)

- `backend/tests/auth.test.js`
- `backend/tests/battle.repository.test.js`
- `backend/tests/battle.resolve.test.js`
- `backend/tests/battle.test.js`
- `backend/tests/battleResultSignature.test.js`
- `backend/tests/creditTransfer.repository.test.js`
- `backend/tests/creditsService.test.js`
- `backend/tests/database.test.js`
- `backend/tests/database.transaction.test.js`
- `backend/tests/deviceValidation.test.js`
- `backend/tests/fcm.service.test.js`
- `backend/tests/firebase.test.js`
- `backend/tests/friend.service.test.js`
- `backend/tests/geoUtils.test.js`
- `backend/tests/health.test.js`
- `backend/tests/influenceLog.repository.test.js`
- `backend/tests/inventory.service.test.js`
- `backend/tests/location.test.js`
- `backend/tests/nearbyPlayers.test.js`
- `backend/tests/player.controller.devices.test.js`
- `backend/tests/player.repository.test.js`
- `backend/tests/playerDevice.repository.test.js`
- `backend/tests/quest.service.test.js`
- `backend/tests/rankTiers.test.js`
- `backend/tests/rescue.service.test.js`
- `backend/tests/sos.service.test.js`

### Backend tooling/config (5)

- `backend/.env.example`
- `backend/Dockerfile`
- `backend/docker-compose.yml`
- `backend/package.json`
- `backend/scripts/run-migrations.js`

### Documentation (7)

- `documentation/README.md`
- `documentation/SPRINT8_CRITICAL_SECURITY_PATCH_REPORT.md`
- `documentation/unity-scene-setup/BATTLE_SCENE_SETUP.md`
- `documentation/unity-scene-setup/BOOT_SCENE_SETUP.md`
- `documentation/unity-scene-setup/LOGIN_SCENE_SETUP.md`
- `documentation/unity-scene-setup/MAINMAP_SCENE_SETUP.md`
- `documentation/unity-scene-setup/ONBOARDING_SCENE_SETUP.md`

### Other top-level (6)

- `.gitignore` — **conflict, merged**
- `CLAUDE.md`
- `README.md`
- `art-reference/README.md`
- `build-recovery/RECOVERY_STATUS.md`
- `database/README.md`
