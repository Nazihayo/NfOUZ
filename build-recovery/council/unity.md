# NFOUZ council: Unity / Photon Fusion engineer review

Branch `claude/sprint-5-photon-multiplayer-5jv8v2` at `42c5c3e`. This was a read-only review. No C# compiler was available, so every finding comes from reading the source against `Assets/Photon/Fusion/Assemblies/Fusion.Runtime.xml` / `Fusion.Sockets.xml` and `Runtime/NetworkSceneManagerDefault.cs`. Line numbers refer to this commit.

## Summary verdict

On the happy path (both players stay connected and the match ends by KO or by timer), I found no code defect that stops the first two-client battle. Spawn, input authority, `OnInput`, the profile RPC, and networked properties before `Spawned` (guarded by `b7a0f39`) all look correct. The DDOL avatars survive the Battle scene load, the host signs and posts `/resolve`, and the client polls and reaches the result panel. The result panel is part of Battle.unity; `Result.unity` is never loaded.

The real risks are:
- configuration for the device build (B1–B3);
- what happens when either peer leaves (H1–H3);
- the end of the match, after the result (H4).

---

## BLOCKER: configuration that must be right before the two-device test

### B1. The phone APK must be built with `PHOTON_FUSION_AVAILABLE` on the Android target
`ProjectSettings/ProjectSettings.asset` → `scriptingDefineSymbols: Android:` currently holds `MAPBOX_SDK_AVAILABLE;FUSION_WEAVER;FUSION2;…` without `PHOTON_FUSION_AVAILABLE`, because the laptop keeps that define local.

**Failure:** an APK built without the define runs `PhotonConnectionManager` in stub mode (`JoinRoomAsync` simulates the join). The phone instantiates only its own avatar, so the two devices never meet. If the phone is the defender, it polls for 20 s and shows "unknown result".

**Action (laptop):** Player Settings → Android → Scripting Define Symbols must contain `PHOTON_FUSION_AVAILABLE` when building the APK. Build the Editor and the APK from the same commit, because the weaved network layout must match on both peers.

### B2. The first Android IL2CPP build with Fusion has never been made
The Galaxy A16 run (item 34) happened before Fusion was turned on. `managedStrippingLevel: {}` is the IL2CPP default (Minimal), and Fusion ships no `link.xml` in this repo.

**Action:** keep Managed Stripping Level at Minimal for the first build. If the device log shows `MissingMethodException`, `TypeLoadException` or a Fusion "behaviour not registered" error, add `Assets/_Project/link.xml`:
```xml
<linker>
  <assembly fullname="Fusion.Runtime" preserve="all"/>
  <assembly fullname="Fusion.Unity" preserve="all"/>
  <assembly fullname="Fusion.Common" preserve="all"/>
  <assembly fullname="Fusion.Sockets" preserve="all"/>
  <assembly fullname="Fusion.Realtime" preserve="all"/>
  <assembly fullname="Nfouz.Runtime" preserve="all"/>
</linker>
```

### B3. Photon App ID and region
`PhotonAppSettings.asset` is git-ignored (correct per CLAUDE.md). An APK built on any other machine has no App ID, and `StartGame` then fails with `InvalidAuthentication`.

Both peers also use "best region". A laptop on cable and a phone on mobile data can choose different regions. The client then gets `GameNotFound` for 20 s, `JoinRoomAsync` fails, and `/ready` is never sent.

**Action (no code):** in the laptop-local `PhotonAppSettings` asset, set **Fixed Region** (for example `eu`) before building the APK, so both peers use the same region.

---

## HIGH

### H1. The host would report the opponent's leave as its own disconnect, and the server would then forfeit the host
- `Networking/PhotonConnectionManager.cs:282-286`: `OnPlayerLeft` (another player left) raises `OnPlayerDisconnected`.
- `Networking/PhotonRoomLifecycle.cs:552-561` then posts `/battle/{id}/disconnect` with the caller's token.
- `backend/src/services/battle.service.js:371-384` (`handleDisconnect`) records **the caller's** side.

**Failure:** today this happens only in MainMap, because Battle.unity has no `PhotonRoomLifecycle`. Once that component is added to Battle (H2), a client crashing mid-match makes the host report itself. After 15 s the server forfeits the battle with `forfeited_by = host`, and the host's `/resolve` at 90 s returns `SESSION_EXPIRED`.

The client side has a related problem. When the host closes its room, the client gets `OnDisconnectedFromServer(ByRemote)` and reports *itself* as disconnected. **Fix this before H2.**

```diff
--- Networking/PhotonConnectionManager.cs
         public event Action OnPlayerDisconnected;
         public event Action OnPlayerReconnected;
+        /// <summary>The other player left the room. Not reported to the
+        /// server: /disconnect records the caller, never someone else.</summary>
+        public event Action OnOpponentLeft;
@@ OnPlayerLeft
         public void OnPlayerLeft(NetworkRunner runner, PlayerRef player)
         {
-            Debug.LogWarning($"[PhotonConnectionManager] Player {player} left the room — starting disconnect grace period.");
-            OnPlayerDisconnected?.Invoke();
+            Debug.LogWarning($"[PhotonConnectionManager] Player {player} left the room.");
+            OnOpponentLeft?.Invoke();
         }
@@ OnShutdown
             Debug.Log($"[PhotonConnectionManager] Runner shutdown: {shutdownReason}");
             IsConnected = false;
+            // A host has no OnDisconnectedFromServer: losing the cloud shuts its
+            // runner down. (Our own Leave/Shutdown removes callbacks first.)
+            if (!_isJoining && runner.GameMode == GameMode.Host && shutdownReason != ShutdownReason.Ok)
+            {
+                OnPlayerDisconnected?.Invoke();
+            }
@@ OnDisconnectedFromServer
                 return;
             }
 
+            if (reason == NetDisconnectReason.Requested || reason == NetDisconnectReason.ByRemote)
+            {
+                // We left, or the host closed its room: not this player's disconnect.
+                Debug.Log($"[PhotonConnectionManager] Room closed: {reason}");
+                return;
+            }
+
             Debug.LogWarning($"[PhotonConnectionManager] Disconnected from server: {reason}");
             OnPlayerDisconnected?.Invoke();
```
Known limitation, left unchanged: `OnPlayerReconnected` is never raised. Fusion Host Mode has no automatic in-room rejoin, so a reported disconnect always ends in a server forfeit after 15 s. Adding rejoin would be a new feature.

### H2. Battle.unity has no `PhotonRoomLifecycle`, so `/disconnect` is never posted during a match (known)
**Action (laptop, scene construction, after H1):** open Battle → the object that holds `BattleLoadingController` → Add Component **Photon Room Lifecycle**, and leave *Challenge Interaction Controller* empty. Its `Awake` only resolves services, so a null controller is safe (`PhotonRoomLifecycle.cs:296-311`).

### H3. A vanished avatar freezes the match forever on both peers
`Combat/BattleManager.cs:608-614` and `:633-639`: `HandleBattleTimeEnd` / `HandleOvertimeTimeEnd` return early when a combatant is null. The return happens every frame, so the match never ends: the timer shows 0, no result appears, and there is no way back to MainMap.

**Failure scenarios:**
- On the host, `NetworkPlayerSpawner.OnPlayerLeft` (`Networking/NetworkPlayerSpawner.cs:269-275`) despawns the leaver's avatar mid-match.
- On the client, the runner shuts down when the host leaves, and Fusion destroys both avatars.

The fix has two parts:
1. During a live battle, the host keeps the leaver's avatar. It gets no input and stands still, so the match still ends by the approved rules and the host signs a real result.
2. Any peer that loses an avatar stops judging the match and asks the server.

```diff
--- Networking/NetworkPlayerSpawner.cs:269
         public void OnPlayerLeft(NetworkRunner runner, PlayerRef player)
         {
-            if (runner.IsServer)
+            // During a battle the leaver's avatar stays (no input: it stands
+            // still) so the match ends by the approved rules and the host can
+            // sign the result. DespawnAll / runner shutdown removes it later.
+            if (runner.IsServer && !BattleSession.HasActiveSession)
             {
                 DespawnNetworkedPlayer(player);
             }
         }
```
```diff
--- Combat/BattleManager.cs
         private bool _matchEndHandled;
+        private bool _bothCombatantsIdentified;
@@ Update(), in both the Battle and Overtime cases, after CheckDeathReportedByHost:
                     if (CheckDeathReportedByHost())
                     {
                         return;
                     }
+
+                    if (CheckCombatantLost())
+                    {
+                        return;
+                    }
@@ IdentifyCombatants(), after `_defenderCombat = defender;`
+            _bothCombatantsIdentified = _attackerCombat != null && _defenderCombat != null;
@@ new method next to CheckDeathReportedByHost
+        /// <summary>An identified avatar was destroyed mid-match (its runner
+        /// shut down): nothing can be judged here any more, so wait for the
+        /// server's record instead of freezing at 0:00. Stub mode (one avatar)
+        /// never sets _bothCombatantsIdentified.</summary>
+        private bool CheckCombatantLost()
+        {
+            if (!_bothCombatantsIdentified || (_attackerCombat != null && _defenderCombat != null))
+            {
+                return false;
+            }
+
+            _matchEndHandled = true;
+            _stateMachine.EndMatch();
+            _ = PollForResolutionAsync();
+            return true;
+        }
```
`PollForResolutionAsync` already ends on `EndedWithoutResult` or after a timeout with the unknown-result panel, and that panel returns to MainMap.

### H4. Nobody leaves the room after a match (known)
- `Combat/ResultController.cs:347-360`: `ReturnToMainMap` only clears the session and loads MainMap.
- `Networking/BattleLoadingController.cs:63-73`: the ready-failure exit does the same.

**Failure:** the runner (DontDestroyOnLoad) stays connected in MainMap and keeps 2 CCU of the 20 free per pair. `OnInput` keeps ticking. On the client, avatars stay until the host's despawn replicates. On the host, `EndSession`'s `DespawnAll` runs only if the countdown had finished. Later, the other player quitting raises Photon callbacks inside MainMap's `PhotonRoomLifecycle`.

```diff
--- Combat/ResultController.cs:355
             _returnTriggered = true;
             BattleSession.Clear();
+            // Clear() first: the host despawns both avatars (EndSession) while its
+            // runner still runs. Then leave the room; the next battle starts a
+            // fresh runner.
+            if (ServiceLocator.Instance != null &&
+                ServiceLocator.Instance.TryGet<PhotonConnectionManager>(out var photon))
+            {
+                _ = photon.LeaveRoomAsync();
+            }
             MainMapRefreshRequest.RequestImmediateRefresh();
             SceneLoader.Load(Constants.Scenes.MainMap);
```
```diff
--- Networking/BattleLoadingController.cs:70
             _returningToMainMap = true;
             BattleSession.Clear();
+            var locator = ServiceLocator.Instance;
+            if (locator != null && locator.TryGet<PhotonConnectionManager>(out var photon))
+            {
+                await photon.LeaveRoomAsync();
+            }
             await SceneLoader.LoadAsync(Constants.Scenes.MainMap);
```
**Ordering is safe:**
- The host posts `/resolve` before `ShowResult`, so leaving at the 8 s auto-return cannot cut off its own submission.
- When the host leaves, the client gets `ByRemote`, which H1 ignores, so it does not report itself.
- If the client's poll is still running, it continues over HTTP.
- `LeaveRoomAsync` → `DestroyRunnerAsync` removes callbacks before `Shutdown`, so the leaving peer does not raise its own disconnect.

---

## MEDIUM

### M1. The countdown is not synchronized: the client can finish 1.5 s early and decide Overtime on its own
- `Networking/BattleLoadingController.cs:118-156` and `BattleLifecycle.cs:73`: the peer that posts `/ready` second starts its countdown at once. The other peer learns "both ready" only on its next 1.5 s poll.
- `CombatStateMachine.cs:61-68` and `BattleManager.cs:608-628`: both peers then run their own 90 s timer and their own `CompareHealthPercentages`.

**Failure:** suppose the host enters Overtime (it decides 1.5 s later, and a last hit changed the health numbers) but the client already ended. The client polls for only `ResolutionPollTimeoutSeconds = 20` (`BattleManager.cs:110`). The host resolves at about 120 s, so the client times out at about 108 s and shows "unknown result" even though the server holds a real result. The reverse case leaves the client sitting in a local Overtime for up to 30 s after the host has resolved.

The smallest fix (one line) covers the timeout case:
```diff
--- Combat/BattleManager.cs:110
-        private const float ResolutionPollTimeoutSeconds = 20f;
+        // The host may still play the 30 s Overtime after this client's timer ends.
+        private const float ResolutionPollTimeoutSeconds = 20f + Constants.Combat.OvertimeSeconds;
```
A better fix, still small: a Photon client never decides at the timer and only waits for the host.
```diff
--- Combat/BattleManager.cs HandleBattleTimeEnd(), after the null guard
+            var controller = _attackerCombat.GetComponent<NetworkPlayerController>();
+            if (controller != null && controller.IsOnHostMachine == false)
+            {
+                _matchEndHandled = true;
+                _stateMachine.EndMatch();
+                _ = PollForResolutionAsync();   // with the timeout above
+                return;
+            }
```
Trade-off: the client then never shows the Overtime banner. I recommend the one-line fix for the first test.

### M2. Only one avatar may exist when Countdown starts (known)
`BattleManager.cs:171-177` and `:224-258`: `IdentifyCombatants` runs once, at the Countdown transition. If the client's replicated avatars have not arrived (a slow Battle load or high round-trip time), one role stays null for the whole match. Combat presses are then dropped, and the timer path returns early forever, which is the same freeze as H3. Retry while Countdown lasts (3 s):
```diff
--- Combat/BattleManager.cs Update(), add to the switch
+                case CombatStateMachine.MatchState.Countdown:
+                    if (_attackerCombat == null || _defenderCombat == null)
+                    {
+                        UnsubscribeCombatants();
+                        IdentifyCombatants();
+                    }
+                    break;
```
In stub mode this re-runs `FindObjectsOfType` and re-`Initialize`s the single avatar every frame during the 3 s countdown. That is harmless, because nothing is live yet.

### M3. MainMap's first nearby query can use (0, 0)
- `Map/GPSLocationService.cs:206-221`: the first location tick comes `updateIntervalSeconds` (5 s) after `IsRunning`, and `LastLat`/`LastLng` stay 0 until then.
- `Map/NearbyPlayersTracker.cs:201-204` / `:207-222`: after a battle, `MainMapRefreshRequest` forces an immediate query, and with the dev location `IsRunning` is true from frame 1. The tracker then sends `GET /player/nearby?lat=0&lng=0`.

The map also stays uncentred for 5 s after every MainMap load.
```diff
--- Map/GPSLocationService.cs, InitializeAsync, both places that set IsRunning = true
             IsRunning = true;
+            _throttleTimer = updateIntervalSeconds; // first fix on the next frame, not after 5 s
--- Map/NearbyPlayersTracker.cs:209
-            if (_gpsService == null || !_gpsService.IsRunning || _queryInFlight)
+            if (_gpsService == null || !_gpsService.IsRunning || _queryInFlight ||
+                (_gpsService.LastLat == 0 && _gpsService.LastLng == 0))
```

---

## LOW

- **L1. A client's cooldown icons always show "ready"; Charged Pulse is not networked; `Render()` has no interpolation.** These are known. `NetworkPlayerController.cs:339-345` snaps to the tick state, so remote motion jitters at the send rate. Host-side Dodge/Blink moves (`AdoptTransformPosition`) are not predicted on the client and snap. Cosmetic, so not for the first test.
- **L2. Two presses in consecutive ticks can merge.** `CombatActionBits.NewlyPressed` (`CombatActionInput.cs:60`) drops a press when the same bit is set in two consecutive input samples, because each sample holds "presses since last sample". Rare at 64 Hz.
- **L3. Presses during the clocks' skew are lost.** If the client's Battle state starts before the host's (M1), presses in that gap are consumed and dropped by the host, and `LastActionBits` is still updated (`NetworkPlayerController.cs:283-291`, `BattleManager.cs:366-370`).
- **L4. A late profile gives wrong opponent stats.** If `RPC_SetProfile` arrives after Countdown, the host initialises the opponent from `NetworkedClass == ""` with the default 100/100 (`BattleManager.cs:443,460`). The health percentage is then wrong for a Titan or Scout. The M2 retry does not cover this (both avatars exist). It is unlikely, because the RPC is sent at `Spawned`, long before both players are ready.
- **L5. Player health of 0 is rejected.** `RPC_SetProfile` rejects `health <= 0` (`NetworkPlayerController.cs:252`). For a player whose session Health is 0, `ProfileReceived` stays false, so a client can never detect that avatar's KO. This only matters if the server allows battles at 0 Health.
- **L6. Nearby markers drift.** `MapboxManager.CenterOnPlayer` (`MapboxManager.cs:81-102`) calls `ChangeView` every 5 s, which shifts world space. Nearby markers are re-projected only on the tracker's 6 s poll, so they drift for up to 6 s after the player moves. It also calls `ChangeView` when the location has not changed. With a fixed dev location there is no drift.
- **L7. The Dev Location window may go blank after a reload.** `Map/EditorDevLocation.cs` lives in the runtime assembly and is fully inside `#if UNITY_EDITOR`, and `GPSLocationService` refers to it only under `UNITY_EDITOR`, so nothing leaks into a build. But its nested `EditorWindow` lives in a file whose name does not match the class, so an open window can come back blank after a domain reload. Close and reopen it. The help text says "restart Play after a change"; only the *Enabled* flag needs that, because lat/lng are re-read on every tick.
- **L8. Other IL2CPP and build checks:**
  - No Editor-only APIs outside `UNITY_EDITOR` were found in `Assets/_Project/Scripts`.
  - JsonUtility generics (`ApiResponse<T>`, including `T = object` for `/disconnect`) are AOT-safe.
  - `FindObjectsOfType` (`BattleManager.cs:226`) is obsolete in Unity 6. It is a warning only; `FindObjectsByType<PlayerCombat>(FindObjectsSortMode.None)` replaces it.
  - `insecureHttpOption: 1` allows `http://` only in Development builds, so the phone APK must be a Development Build to reach the laptop backend.
  - `activeInputHandler: 0` (old Input Manager) matches `Input.GetAxisRaw` in `NetworkInputData.SampleLocal`.
- **L9. `Result.unity` is never loaded.** It is in Build Settings but no code references `Constants.Scenes.Result`; the result is shown by `ResultController` inside Battle.unity. It is dead, not broken.
- **L10. The phone drops after 10 s in the background.** Fusion's `ConnectionTimeout: 10` is shorter than the server's 15 s grace, and a client cannot rejoin a match, so screen lock or backgrounding the app ends the match for that peer. Keep the phone screen on during the test.

## Checked and OK (no change)
- **Input authority:** the host `Spawn`s with input authority for each `PlayerRef` and calls `SetPlayerObject`. `ActivePlayers` plus `OnPlayerJoined` covers a client that joins before or after the host's Battle `Start`. A client never spawns (`!runner.IsServer`).
- **DDOL avatars:** `NetworkSpawnFlags.DontDestroyOnLoad` applies "on all clients" (Fusion.Runtime.xml:15544), so client-side avatars received while the client is still in MainMap survive `SceneLoader` loading Battle. `FindObjectsOfType` finds DDOL objects.
- **Scene manager:** `StartGameArgs.Scene` is null with `NetworkSceneManagerDefault`, so Fusion never loads scenes and never fights `SceneLoader`.
- **Input:** `OnInput` is registered on the runner before `StartGame` (`ProvideInput = true`), and it sends `default` outside the live match.
- **Host-only combat:** combat runs only when `HasStateAuthority && Runner.IsForward`, so it is not repeated on client resimulation. Input from a client is sanitised (NaN).
- **Profile RPC:** `RPC_SetProfile` (InputAuthority → StateAuthority) is invoked locally for the host's own avatar and is accepted once. Networked properties are not touched before `Spawned` (`IsNetworked` falls back to plain fields).
- **Host secret:** only the attacker holds `host_authority_secret`. Ready and poll updates are partial (`ApplyReadyState`), so the secret survives until `/resolve`.
- **Combatant roles:** `TryIdentifyByAuthority` (attacker = "mine" == "I am host") is correct on both peers.
- **Runner lifecycle:** the client join retry has a 20 s wall-clock deadline inside the 30 s ready timeout. `DestroyRunnerAsync` handles a runner Fusion already destroyed (Unity null check).
