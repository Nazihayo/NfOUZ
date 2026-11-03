# NFOUZ: current status

Read this first. `HANDOFF.md` keeps the full history; this file only says
where things stand now. Update it in the same commit as any change it
describes.

Last updated: 2026-11-03, branch `claude/sprint-5-photon-multiplayer-5jv8v2`.

## Overall: FAILED

The two-device battle has never run. Players cannot see each other on the
map (D1), so no challenge or battle can start (D2).

Statuses (see `CLAUDE.md` → Verification): VERIFIED, PARTIAL, FAILED, BLOCKED.

## Verification, by gate

| Check | Status | Evidence (commit, date) |
|---|---|---|
| Backend `npm test` (includes Unity asset checks) | VERIFIED | 34 suites / 489 tests, cloud, 2026-11-03 |
| CI (`.github/workflows/backend-tests.yml`) | see GitHub Actions | added 2026-11-03; a green run there is the evidence |
| Backend `npm run test:contract:db` | BLOCKED | needs a database; last run item 22 |
| Unity C# compiles | VERIFIED for `c0fcc70` | laptop, 2026-11-02 (owner's screenshot) |
| EditMode | VERIFIED for `c0fcc70` | 384/384 (345 Nfouz + 39 Mapbox), laptop, 2026-11-02 (owner's screenshot); no XML kept |
| PlayMode | BLOCKED | last 9/9 at item 30; not run on the current code |
| Android APK with Photon | VERIFIED | `nfouz-photon.apk` built and installed, 2026-11-02 (owner's screenshots) |
| Login → MainMap on phone and Editor | VERIFIED | 2026-11-02 (owner's screenshots); new account gets class stats (Scout 80/120) |
| `PHOTON_FUSION_AVAILABLE` committed in ProjectSettings | PARTIAL | edited as text in the cloud (one line, same as the laptop's local diff); counts once Unity has opened and re-saved it |
| Players visible to each other | FAILED | D1 |
| Challenge → battle → result between two devices | BLOCKED | needs D1 |

## Open defects

| ID | Defect | Status of root cause |
|---|---|---|
| D1 | No player markers visible on either map (owner's screenshots, 2026-11-02), although the Editor Hierarchy showed an active `PlayerMarker(Clone)` and, once, an active `NearbyPlayerMarker(Clone)` | **Not confirmed.** Hypotheses: marker (~2 units) far too small for a camera ~700 units away (`MainMap.unity`: y 500, z -500, FOV 77); marker below the terrain (`MapboxManager.GeoToWorldPosition` returns the map's y); phone stopped reporting while its screen was off (offline after 120 s). Next evidence: Scene view, double-click `PlayerMarker(Clone)` during Play |
| D2 | Two-device battle never run | Blocked by D1 |
| D3 | Markers use Unity's default material (pink under URP) | Confirmed (`NearbyPlayerMarker.prefab`, `fileID 10303`) |
| D4 | The stats panel covers the top of the map | Seen on both devices in the owner's screenshots; cause not traced |
| D5 | No sign-out button; changing accounts needs Android "Clear data" | Confirmed; a fix is a small feature and needs owner approval |

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
