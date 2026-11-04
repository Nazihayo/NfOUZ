# NFOUZ: current status

Read this first. `HANDOFF.md` keeps the full history; this file only says
where things stand now. Update it in the same commit as any change it
describes.

Last updated: 2026-11-04 09:36, branch `claude/sprint-5-photon-multiplayer-5jv8v2`.

## Overall: PARTIAL

Players now see each other on both devices (D1 fixed). The two-device
challenge and battle (D2) have not run yet.

Statuses (see `CLAUDE.md` → Verification): VERIFIED, PARTIAL, FAILED, BLOCKED.

## Verification, by gate

| Check | Status | Evidence (commit, date) |
|---|---|---|
| Backend `npm test` (includes Unity asset checks) | VERIFIED | 35 suites / 491 tests, cloud, 2026-11-03 |
| CI (`.github/workflows/backend-tests.yml`) | see GitHub Actions | added 2026-11-03; a green run there is the evidence |
| Backend `npm run test:contract:db` | BLOCKED | needs a database; last run item 22 |
| Unity C# compiles | VERIFIED for `e77d87a` | laptop, batchmode, 2026-11-04: 0 errors in the log (Android target, Photon, Firebase and Mapbox defines on) |
| EditMode | VERIFIED for `e77d87a` | 386/386 (347 Nfouz + 39 Mapbox), 0 failed, laptop, batchmode, 2026-11-04 09:30 (XML kept locally, not committed) |
| PlayMode | VERIFIED for `6742d52` | 9/9, 0 failed, laptop, batchmode, 2026-11-04 09:36 (XML kept locally, not committed) |
| Android APK with Photon | VERIFIED | `nfouz-photon.apk` built and installed, 2026-11-02 (owner's screenshots) |
| Login → MainMap on phone and Editor | VERIFIED | 2026-11-02 (owner's screenshots); new account gets class stats (Scout 80/120) |
| `PHOTON_FUSION_AVAILABLE` committed in ProjectSettings | PARTIAL | edited as text in the cloud (one line, same as the laptop's local diff); counts once Unity has opened and re-saved it |
| Players visible to each other | VERIFIED for `b5f35d3` | 2026-11-03 21:58: phone (`nfouz-markers.apk`) and Editor Simulator each show two markers, own and the other player's (owner's photo) |
| Challenge → battle → result between two devices | BLOCKED | not yet run (next step) |

## Open defects

| ID | Defect | Status of root cause |
|---|---|---|
| D1 | No player markers visible on either map (owner's screenshots, 2026-11-02) | **Root cause confirmed 2026-11-03:** the markers were person-sized (about 2 units) while the MainMap camera is about 700 units away, so they drew under one pixel. Scene view showed the marker standing on the ground, at its map position, tiny next to the buildings (owner's screenshot); the terrain hypothesis is ruled out. Fix `c8dcec1`: both marker roots scaled x20 in Unity (the tap collider scales with them). Regression test `backend/tests/unity/mapMarkers.test.js` fails on the old prefabs. Verified 2026-11-03: both devices see both markers |
| D2 | Two-device battle never run | Blocked by D1 |
| D3 | Markers used Unity's default material (pink under URP) | Confirmed. **Fix committed:** five URP Lit materials in `Assets/_Project/Art/Materials` (own blue, opponent red, selection amber, controlled orange, protected teal), assigned in both marker prefabs. Unity re-saved both prefabs and all five materials in batchmode on the laptop, 2026-11-04: every marker renderer resolves to its material and shader, no content change. Not yet checked on a device. Test `mapMarkers.test.js` fails on the old prefabs |
| D4 | The stats panel covers the top of the map | Seen on both devices in the owner's screenshots; cause not traced |
| D6 | `[ServiceLocator] Accessed before initialization` when Play starts in a scene other than Boot | Expected: start Play from Boot. Not a defect in the build (Boot is scene 0) |
| D7 | Challenge button disabled, no challenge sent (owner's photo, 2026-11-03 22:10) | **Root cause confirmed 2026-11-04:** the opponent marker's DistanceText read 37 m, over `MaxChallengeDistanceMeters` (20 m), so the button was disabled as designed; the Editor dev location was 37 m from the phone's indoor GPS fix. Backend log: no `POST /battle/challenge`. **UI fix (owner approved 2026-11-04), compiled and EditMode-tested on e77d87a, not yet tried on a device:** while the button is disabled the panel shows the reason in place of the class, e.g. `بعيد: 38 م (التحدي حتى 20 م)`. EditMode test added |
| D5 | No sign-out button; changing accounts needed Android "Clear data" | **Owner approved 2026-11-04 ("fix everything"). Code committed, compiled and EditMode-tested on e77d87a, not yet tried on a device:** `SettingsScreen` sign-out flow (confirm popup, push token deactivation best effort, Firebase sign-out, API token cleared, SOS local state cleared, session cleared, Login). `SignOutButton` added to MainMap's Settings panel in batchmode on 2026-11-04 and assigned to `SettingsScreen.signOutButton` and `pushNotificationHandler`; its look and tap are not checked yet. Not verified: push re-registration after a sign-in in the same app run |

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
