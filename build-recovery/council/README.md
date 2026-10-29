# Council review, 2026-10-29

At the owner's request, six read-only reviewers studied the whole game while
he was away. Their reports are kept here as written; the status of each
finding after the same session's fixes is below. Nothing here is an
approved design change: proposals marked "needs decision" wait for the owner.

| Report | Reviewer |
|---|---|
| `backend.md` | Backend and security |
| `unity.md` | Unity / Photon Fusion engineer |
| `qa.md` | QA, including tonight's two-device test plan (§3) |
| `producer.md` | Producer: player journey, must-have list to Alpha, risks |
| `combat.md` | Combat design book (current behaviour), balance and proposals |
| `art_bible.md` | Art direction and asset list; concept page in `art-reference/concept-sheet.html` |

## Fixed in the cloud (commits `2e9fcbf`, `c0fcc70`)

Backend (unit-tested, 487/487):
- backend H1 block bypass; M5 quest progress after commit; M7 register race
  (409); M4 push token after sign-out; M3 coarse nearby distance; L3
  event_seq overflow; L13 null coordinates.
- backend H2, code part: new players get class base stats. **Existing rows
  keep 100/100 until a backfill is approved.**

Unity (not compiled in the cloud; compile and run EditMode on the laptop):
- QA H1 Challenge button never clickable; QA H2 raycast distance 500 → 5000;
  QA H3 `/ready` failure froze the loading screen.
- Unity H1 opponent leave reported as own disconnect; H3 match freeze when an
  avatar vanishes; H4 leave the Photon room after a match; M1 client result
  wait covers Overtime; M2 retry finding avatars during the countdown; M3 no
  nearby query at (0, 0), first location tick immediate.

## Open: laptop steps (no code)
- Build the APK with `PHOTON_FUSION_AVAILABLE` (Unity B1); keep stripping at
  Minimal (B2); set a Fixed Region in the local `PhotonAppSettings` (B3).
- Add `PhotonRoomLifecycle` to Battle.unity, Challenge Interaction Controller
  empty (Unity H2).
- Pink capsules: assign URP materials (art bible §3).
- Editor: Run In Background on; Dev Location placed ~9 m from the phone's
  stored location (QA §3).

## Open: need the owner's decision
- Forfeit outcome and who reports a leave (backend H3).
- Backfill class stats for existing players (backend H2).
- Teleport after a 60 s gap (backend M2); case-insensitive username index (M7).
- Combat numbers, arena clamp, wind-up, weapon choice in battle (combat.md P1).
- New systems: hit feedback, animation, audio, opponent HP bar, AYAZ,
  hosted HTTPS backend, store/legal items (producer.md).
