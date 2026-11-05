# NFOUZ: current status

Read this first. `HANDOFF.md` keeps the full history; this file only says
where things stand now. Update it in the same commit as any change it
describes.

Last updated: 2026-11-05 22:15, branch `claude/sprint-5-photon-multiplayer-5jv8v2`.

## Overall: PARTIAL

Players see each other on both devices (D1 fixed). The second two-device battle
(2026-11-05) ran without `FieldAccessException` (D8) and both devices reached
the Battle state, but it was not a real fight: nothing moved and no damage
happened on either device (D12), and the result came from a health mismatch (D11).

Statuses (see `CLAUDE.md` → Verification): VERIFIED, PARTIAL, FAILED, BLOCKED.

## Verification, by gate

| Check | Status | Evidence (commit, date) |
|---|---|---|
| Backend `npm test` (includes Unity asset checks) | VERIFIED | 35 suites / 493 tests, laptop, 2026-11-04 |
| CI (`.github/workflows/backend-tests.yml`) | see GitHub Actions | added 2026-11-03; a green run there is the evidence |
| Backend `npm run test:contract:db` | BLOCKED | needs a database; last run item 22 |
| Unity C# compiles | VERIFIED for `e77d87a` | laptop, batchmode, 2026-11-04: 0 errors in the log (Android target, Photon, Firebase and Mapbox defines on) |
| EditMode | VERIFIED for `e77d87a` | 386/386 (347 Nfouz + 39 Mapbox), 0 failed, laptop, batchmode, 2026-11-04 09:30 (XML kept locally, not committed) |
| PlayMode | VERIFIED for `6742d52` | 9/9, 0 failed, laptop, batchmode, 2026-11-04 09:36 (XML kept locally, not committed) |
| Android APK with Photon | VERIFIED | `nfouz-photon.apk` built and installed, 2026-11-02 (owner's screenshots) |
| Login → MainMap on phone and Editor | VERIFIED | 2026-11-02 (owner's screenshots); new account gets class stats (Scout 80/120) |
| `PHOTON_FUSION_AVAILABLE` committed in ProjectSettings | PARTIAL | edited as text in the cloud (one line, same as the laptop's local diff); counts once Unity has opened and re-saved it |
| Players visible to each other | VERIFIED for `b5f35d3` | 2026-11-03 21:58: phone (`nfouz-markers.apk`) and Editor Simulator each show two markers, own and the other player's (owner's photo) |
| Challenge → battle → result between two devices | FAILED for Editor `7627607` + phone APK `996be28` | 2026-11-05: challenge to `resolve` and the return to MainMap ran, with no `FieldAccessException`; nothing moved and no damage happened (D12), and the devices disagreed at time end (D11). See "Second two-device battle" |

## Open defects

| ID | Defect | Status of root cause |
|---|---|---|
| D1 | No player markers visible on either map (owner's screenshots, 2026-11-02) | **Root cause confirmed 2026-11-03:** the markers were person-sized (about 2 units) while the MainMap camera is about 700 units away, so they drew under one pixel. Scene view showed the marker standing on the ground, at its map position, tiny next to the buildings (owner's screenshot); the terrain hypothesis is ruled out. Fix `c8dcec1`: both marker roots scaled x20 in Unity (the tap collider scales with them). Regression test `backend/tests/unity/mapMarkers.test.js` fails on the old prefabs. Verified 2026-11-03: both devices see both markers |
| D2 | No complete two-device battle yet | First attempt 2026-11-04 failed on D8; second attempt 2026-11-05 failed on D12 (E3, E4) and D11 (E5). Step-by-step retest and evidence E1–E7: `FIRST_BATTLE_CHECKLIST.md` |
| D11 | At time end the host and the client compute different results; a player can win with no recorded damage | **Mechanism shown by code and data, runtime values not logged:** `BattleManager.InitializeCombatant` takes the local player's real max health from `PlayerSession`, but the opponent's from the class base table. `aya3` is a Scout with stored 100/100 (base is 80), `miran` a Scout with 80/80. Host (phone): `miran` 80/80 = 100%, `aya3` 100/80 = 125%, so `aya3` wins. Client (Editor): `aya3` 100/100 = 100%, `miran` 80/80 = 100%, so Overtime. Both match the logs. Reproduction: this battle. Not fixed, needs a decision |
| D12 | In the battle nothing moved on either device and no damage happened (owner's report, 2026-11-05) | **Root cause not established; no log records input or spawns.** On the host, 3 attack attempts were rejected: `Basic attack ... 12,00m > 2,2m` and Pulse Arc out of range twice, so at least one device's button input reached the host, and the avatars were still 12 m apart 73 s into the match. The log does not say which device sent them. Not yet checked: both avatars present, input authority, `MoveX`/`MoveZ` values. Next step: observe them in the Editor Inspector during a battle |
| D8 | Editor client stuck on "connecting" in Battle; `FieldAccessException` for `Fusion.NetworkBehaviour:InvokeRpc` and `:Ptr` (`NetworkPlayerController.Spawned`, line 235, then every tick) | **Cause supported by evidence, fix not tried:** both fields are `internal` in `Fusion.Runtime.dll`, and `Nfouz.Runtime` is not in its `InternalsVisibleTo` list. Weaved `Fusion.Unity.dll` (`allowUnsafeCode: true`) carries `UnverifiableCode` and `SkipVerification`; weaved `Nfouz.Runtime.dll` (`allowUnsafeCode: false`) has neither. `Assets/_Project/Scripts/Nfouz.Runtime.asmdef` is the only weaved assembly here with it off. The Player setting is on, but an asmdef has its own flag. Ruled out: all Fusion assemblies and references are 2.0.13; `Nfouz.Runtime` is in `AssembliesToWeave`. Phone (IL2CPP) logged 0 of these errors. **Fix applied (owner approved 2026-11-04):** `allowUnsafeCode: true` in that asmdef, no Library deletion. After it, weaved `Nfouz.Runtime.dll` carries `UnverifiableCode` and `SkipVerification`; batchmode EditMode 386/386, PlayMode 9/9, backend 493/493. These tests did not show the error before the fix either. **Fix verified 2026-11-05 in a two-client battle (Editor `7627607`):** 0 `FieldAccessException` in `Editor.log` after joining the room (about 34,000 in the first battle), and the Editor went through Countdown into Battle. Regression guard in `backend/tests/unity/networking.test.js` |
| D9 | A battle gets a result while one player is frozen | **Confirmed in code and data, design decision open:** `resolveBattle` accepts the host's signed result and needs nothing from the other player. Host Mode Alpha documents this as a limitation. Not changed. Owner decision 2026-11-04: accepted for Alpha (Host Mode limit); fixed by dedicated servers in Beta; no prize competitions before. |
| D10 | Phone showed `CurlError 52: Empty reply from server` (owner's report) | **Not reproduced, cause unknown.** 0 matches in the recorded phone Unity log (10:09:47 to 11:17:30), `Editor.log` and the server log. Server stayed up and `adb reverse` was on. The phone was then disconnected, so the full `adb logcat` could not run. Hypothesis to test: Node's default 5 s `keepAliveTimeout` racing the client's roughly 5 s polling |
| D3 | Markers used Unity's default material (pink under URP) | Confirmed. **Fix committed:** five URP Lit materials in `Assets/_Project/Art/Materials` (own blue, opponent red, selection amber, controlled orange, protected teal), assigned in both marker prefabs. Unity re-saved both prefabs and all five materials in batchmode on the laptop, 2026-11-04: every marker renderer resolves to its material and shader, no content change. Not yet checked on a device. Test `mapMarkers.test.js` fails on the old prefabs |
| D4 | The stats panel covers the top of the map | Seen on both devices in the owner's screenshots; cause not traced |
| D6 | `[ServiceLocator] Accessed before initialization` when Play starts in a scene other than Boot | Expected: start Play from Boot. Not a defect in the build (Boot is scene 0) |
| D7 | Challenge button disabled, no challenge sent (owner's photo, 2026-11-03 22:10) | **Root cause confirmed 2026-11-04:** the opponent marker's DistanceText read 37 m, over `MaxChallengeDistanceMeters` (20 m), so the button was disabled as designed; the Editor dev location was 37 m from the phone's indoor GPS fix. Backend log: no `POST /battle/challenge`. **UI fix (owner approved 2026-11-04), compiled and EditMode-tested on e77d87a, not yet tried on a device:** while the button is disabled the panel shows the reason in place of the class, e.g. `بعيد: 38 م (التحدي حتى 20 م)`. EditMode test added |
| D5 | No sign-out button; changing accounts needed Android "Clear data" | **Owner approved 2026-11-04 ("fix everything"). Code committed, compiled on e77d87a; no test covers the sign-out path; not yet tried:** `SettingsScreen` sign-out flow (confirm popup, push token deactivation best effort, Firebase sign-out, API token cleared, SOS local state cleared, session cleared, Login). `SignOutButton` added to MainMap's Settings panel in batchmode on 2026-11-04 and assigned to `SettingsScreen.signOutButton` and `pushNotificationHandler`; its look and tap are not checked yet. Not verified: push re-registration after a sign-in in the same app run |

## First two-device battle (2026-11-04, `996be28`)

Battle `ca309753-453f-41aa-8275-30b4e91b58cf`. Phone: `miran`, attacker and
Photon host. Editor: `aya3`, defender and client.

- **Worked:** `POST /battle/challenge` 10:10:11 UTC, `accept` 10:10:23, `ready`
  twice 10:10:28 and 10:10:29, both clients in the Photon room. The Editor's first
  join got `GameNotFound` and its retry as Client succeeded. The D7 distance
  message showed in the Editor (`بعيد: 43 م`).
- **Failed:** the Editor threw `FieldAccessException` from the first `Spawned()`
  (D8) and logged it about 34,000 times. `BattleManager` warned 1,594 times that
  it found no `PlayerCombat`.
- **Result:** `POST /battle/.../resolve` at 10:12:05.807 UTC. The server log does
  not record the caller. It was the phone: only the host holds the signing
  secret, `host_player_id` is `miran`, and the phone logged `CompleteMatch` then.
  A normal signed result, not a forfeit: `status` `resolved`, `forfeited_by` and
  both `*_disconnected_at` null, `duration_seconds` 90, winner `miran`. The final
  health values are not stored, so why the attacker won is not established.
- **Accepted after `session_expires_at`** (10:11:42), about 23 s later:
  `resolveBattle` does not check that column, and stale battles expire on a
  separate no-result cutoff.
- **Real effects on these test accounts:** `miran` influence +15 (now 115),
  `aya3` influence -10 (now 90), and `aya3` controlled by `miran` until 12:12:05
  UTC (`control_relationships`). Not reverted; a frozen client caused them. At
  20:52 UTC `is_controlled` still read true; `battle.service.js` has a
  self-heal step for stale rows, not yet seen running here.

## Second two-device battle (2026-11-05, Editor `7627607`, phone APK `996be28`)

Battle `dfce2b61-662a-4645-ac5e-a587cc0ffc03`. Phone: `miran`, attacker and
Photon host. Editor: `aya3`, defender and client. Requests: `challenge` 21:05:03
UTC, `accept` 21:05:10, `ready` 21:05:14 and 21:05:17, `resolve` 21:06:50.

| # | Evidence | Status | Detail |
|---|---|---|---|
| E1 | No `FieldAccessException` | VERIFIED | 0 in `Editor.log` after joining the room; D8 fix confirmed |
| E2 | No freeze | PARTIAL | Countdown 3, 2, 1 and `Countdown -> Battle` logged on both devices; screens not confirmed |
| E3 | Movement synced | FAILED | Owner: nothing moved on either device. See D12 |
| E4 | Damage synced | FAILED | Owner: no hits or damage. Logged: 3 rejected attacks on the host (`12,00m > 2,2m` and Pulse Arc out of range), 0 deaths. Successful hits are not logged. See D12 |
| E5 | Same result after a real fight | FAILED | Phone `Battle -> Ended`, showed defeat and -10 Influence. Editor `Battle -> Overtime`, then `Overtime -> Ended` after the host left. See D11 |
| E6 | Server | VERIFIED | One `resolve`, `status` `resolved`, `forfeited_by` null, `duration_seconds` 90, Influence changed once. Final health is not stored in the database or logged by the server |
| E7 | Return to the map | PARTIAL | Both reloaded MainMap and both sent location afterwards. A new challenge was not tried |

**Was it a real fight? No.** Owner's report: no movement, no hits, no damage. The
host ended the match on time at 90 s without Overtime (only the Editor entered
it), and D11 explains the winner with no damage at all.

**Effects:** `aya3` Influence +15 (now 105), `miran` -10 (now 105), and `miran`
controlled by `aya3` until 23:06:50 UTC. Not reverted. D10: 0 `CurlError 52` in
this run; `Curl error 28` (2 s timeout) seen once on each device, source unknown.

Most likely explained (not reproduced): the location "rate-limited" log every
5 s on 2026-11-02 matches the phone and the Editor signed in to the same
account (the server allows one update per 4 s per account). The last log was
22:20:56; the owner then gave the phone its own account and none followed in
the 22:39 screenshot. Confirm in the next session: one account per device,
no "rate-limited" logs.

## Fixed on 2026-11-03 (prevention)

- `PHOTON_FUSION_AVAILABLE` committed in `ProjectSettings.asset` (it was
  laptop-only and a branch switch reset it), with a test that fails if it
  goes missing. PARTIAL until Unity re-saves the file on the laptop.
- Test: the NetworkPlayer NetworkObject must list every NetworkBehaviour (the
  list was empty in the repo until `2ed5b33`). Both tests fail on the old
  files.
- CI: `.github/workflows/backend-tests.yml`.
- Claude Code hook: `.claude/hooks/pre-push-tests.sh` blocks a Bash
  `git push` while tracked files are uncommitted or the backend tests fail.
  It does not see pushes made through GitHub MCP tools; CI covers those.
  `.gitattributes` keeps `*.sh` LF so the hook runs on Windows checkouts.

## How to record Unity evidence

Test Runner → EditMode (then PlayMode) → Run All → ⋮ → Export Results, or:

```
"C:\Program Files\Unity\Hub\Editor\6000.0.58f2\Editor\Unity.exe" -batchmode -projectPath C:\Projects\NfOUZ -runTests -testPlatform EditMode -testResults C:\Projects\editmode.xml
```

(close the Editor first; repeat with `PlayMode` and `playmode.xml`). Note the
commit (`git log -1 --oneline`) next to the result.
