# NFOUZ — QA lead report (council, 2026-10-29)

Branch `claude/sprint-5-photon-multiplayer-5jv8v2`, read-only review. No .NET/Unity in this
sandbox: Unity findings come from reading the C# and the scene/prefab YAML. Line numbers are
from the current branch.

## 1. Automated tests run here

| Command (from `backend/`) | Result |
|---|---|
| `npx jest` | **34 suites / 475 tests, all pass** (HANDOFF table still says 33/468; `tests/unity/networking.test.js` was added since) |
| `npx jest tests/contract` | **2 suites / 54 tests, all pass** |

The only console noise is expected warnings from negative-path tests (FCM failures, DB
connection refused, expired token, INVALID_USERNAME).

Scene wiring check (my script compared every `[SerializeField]` in the 6 scenes and 13
prefabs with the YAML): **no unwired object reference and no dangling fileID.** The three
null fields on `GameManager.prefab` fall back to `AddComponent`. The three null fields on
`NotificationToast.prefab` are overridden in MainMap. Every button has either a persistent
call or a code listener. The bottom nav and the four top buttons (Settings, SOS, BattlePass,
Shop) are wired through `BottomNavController.tabs`. So the problems below are in behaviour,
not in wiring.

---

## 2. Findings

### HIGH (each one can stop tonight's test)

**H1. The Challenge button can never be clicked.**
`Map/NearbyPlayerSelection.cs:31-64` runs a physics raycast on every pointer-down, including
one on a UI button. It does not check `EventSystem.IsPointerOverGameObject`. Over the button
the ray hits no marker, so `ClearSelection()` (line 63) runs.
`ChallengeInteractionController.HandleSelectionCleared` (`ChallengeInteractionController.cs:92`)
then hides `MiniProfilePopup` (line 134) in the same pointer-down frame. `Button.onClick` fires
on pointer-up, but by then the button's GameObject is inactive, so the click is dropped.
`POST /battle/challenge` is never sent, on the phone or in the Editor.
- *Fix:* at the top of `NearbyPlayerSelection.Update`, return when
  `EventSystem.current != null && EventSystem.current.IsPointerOverGameObject()` (mouse), or
  `IsPointerOverGameObject(touch.fingerId)` (touch).
- *Tonight's workaround (Editor only):* select the marker, untick the `NearbyPlayerSelection`
  component on MainCamera in the Inspector, then click Challenge. There is no workaround on
  the phone, so the **Editor must be the attacker**.

**H2. A marker tap probably cannot reach the map at all.**
- MainMap `MainCamera` sits at (0, 500, −500), pitched about 43°, with a 77° FOV
  (`MainMap.unity:18765`). `NearbyPlayerSelection.maxRaycastDistance` is 500
  (`MainMap.unity:10947`).
- The shortest camera-to-ground ray (at the bottom of the screen) is about 506 units, and
  the ray through the screen centre is about 733 units. Markers sit near y = 0 (SphereCollider,
  radius 1.5, centre y = 1), so a tap at ground level never hits a marker.
- At about 700 units, a 3-unit collider is only a few pixels on screen.
- Not yet confirmed in Unity. It depends on how Mapbox v3 places the map root, but the
  geometry above holds for a map at y ≈ 0.
- *Fix:* `maxRaycastDistance` ≥ the camera's far clip (5000), or `Mathf.Infinity`. Consider a
  bigger marker collider, or a screen-space pick radius.
- *Tonight's workaround:* in Play mode, set Max Raycast Distance to 5000 in the Inspector.
  Play-mode changes are not saved. Put the Editor 8–12 m from the phone, not 2–3 m, so the
  two markers do not overlap.

**H3. A failed `/ready` leaves the Battle loading screen up forever.**
`Networking/BattleLoadingController.cs:90-101`: when `POST /battle/{id}/ready` fails with
anything except SESSION_EXPIRED or BATTLE_NOT_FOUND, the method just returns. That covers
offline/NETWORK_ERROR, 500 INTERNAL_ERROR, RATE_LIMITED, CHALLENGE_NOT_ACCEPTED, FORBIDDEN,
and a 401 after the refresh failed. It never enters `WaitForOpponentAsync`, which holds the
31.5 s exit. There is no back button, so the player has to kill the app.
- *Fix:* on a "battle not gone" failure, fall through to `WaitForOpponentAsync` (it re-checks
  and leaves after the timeout), or retry `/ready` inside that loop.

**H4. The battle soft-locks when either player drops. There is no disconnect handling inside
Battle.**
- `Battle.unity` has no `PhotonRoomLifecycle` (HANDOFF item 35). As a result:
  - no `POST /battle/{id}/disconnect` or `/reconnect` is ever sent from Battle;
  - `DisconnectPanel`, `ReconnectedToast` and `ReadyStatusPanel` in Battle.unity are driven by
    no script.
- When the phone is killed, backgrounded or locked, the host's `NetworkPlayerSpawner.OnPlayerLeft`
  (`NetworkPlayerSpawner.cs:269-275`) despawns the defender avatar. `_defenderCombat` then
  becomes Unity-null.
- `BattleManager.HandleBattleTimeEnd` / `HandleOvertimeTimeEnd` (`BattleManager.cs:610`, `635`)
  return early when a combatant is null. `Update` calls them every frame, so the match never
  ends: the timer sits at 0 with no result screen and no exit. The same happens on a client
  whose runner shut down, and when only one avatar existed at Countdown.
- The server cancels the battle after 298 s, but the stuck client never polls again.
- *Fix (smallest):*
  - when the time ends with a missing combatant, or on `OnPlayerLeft`/`OnShutdown` during the
    match, run the existing paths: the host reports `/disconnect`, the non-host goes to
    `PollForResolutionAsync`, which already ends at the unknown-result panel and returns to
    MainMap;
  - add `PhotonRoomLifecycle` (or an equivalent hook) to Battle, and post `/disconnect` with
    the *leaving* player's identity semantics fixed (QA open item, HANDOFF 35).

### MEDIUM

**M1. Players see raw English error codes.** Every default branch shows the code:
- `Inventory/InventoryController.cs:217` ("حدث خطأ: CODE");
- `Social/FriendsController.cs:106`, `:148`, `:327`;
- `Quests/QuestController.cs:155`;
- `Social/RescueMissionController.cs:272`;
- `UI/Screens/SosScreen.cs:105` ("خطأ: CODE");
- `UI/NotificationManager.cs:130`, `:134`.

So offline gives "حدث خطأ: NETWORK_ERROR". The backend can send these codes that no screen
maps: NETWORK_ERROR, RATE_LIMITED, INTERNAL_ERROR, INVALID_REQUEST (e.g. a non-UUID typed into
the Friends id box), INVALID_FRIEND_REQUEST (yourself), INVALID_BLOCK, DUPLICATE_REQUEST,
ITEM_NOT_FOUND, ITEM_NOT_A_WEAPON, PLAYER_NOT_FOUND (inventory/quests). INVALID_SIGNATURE,
RESULT_EXPIRED, CONTRADICTORY_RESULT, PARTICIPANT_MISMATCH and DUPLICATE_RESULT reach only
`/resolve`, which already shows the unknown-result panel, so those are fine. The backlog lists
this as "keep for Alpha debugging?".
- *Fix:* make every default branch return `AuthErrorMessages.FromApiError(error)` and log the
  code. Map the inventory and friends codes listed above.

**M2. English text shown to players (CLAUDE.md: Arabic first).**
- `Combat/ResultController.cs:164/185/197` shows "+15 Influence", "0 Influence" and
  "-10 Influence". These are also client constants, not the server's real change.
- Rank names come from the server in English ("Citizen"), on the HUD, Profile, the result
  rank label (`ResultController.cs:312`) and the incoming prompt
  (`IncomingChallengeMessages.cs:38`).
- Class names are raw (`ChallengeInteractionController.cs:124`, Profile).
- Inventory statuses show the raw `item_key` ("تم تجهيز sword.").
- The Battle HUD has "HP" and "EN".
- *Fix:* an Arabic display map for rank, class and item, plus "نفوذ".

**M3. Offline at launch silently signs the player out.**
`Core/SessionBootstrap.cs:80-83` treats NETWORK_ERROR and 500 from `/auth/me` like an invalid
token. It clears the token, goes to Login and shows no message, so the player has to type the
password again even though Firebase still has the user.
- *Fix:* on NETWORK_ERROR or INTERNAL_ERROR, keep the token and show
  `AuthErrorMessages.Network` with a retry. Go to Login only on INVALID_TOKEN (after a refresh)
  or NoUser.

**M4. The host does not retry `/resolve`.**
`BattleManager.cs:789-793`: a single dropped `POST /resolve` (a network blip) means the result
is lost for good. Both players see "النتيجة غير مؤكدة" and the server cancels at 298 s.
- *Fix:* retry transport failures 2–3 times within the result max age. The server rejects
  repeats with DUPLICATE_RESULT.

**M5. The screen can sleep mid-battle.**
No `Screen.sleepTimeout` is set anywhere. The phone can dim and lock during the 30 s ready
wait or the 90–120 s match. Unity then pauses, Photon times out, and H4 follows.
- *Fix:* `Screen.sleepTimeout = SleepTimeout.NeverSleep` while in Battle; restore it on exit.
- *Tonight:* set the phone's screen timeout to 10 min.

**M6. SOS/Rescue and Friends cannot be used from the UI.**
- No button calls `SOSManager.RequestSosAsync` (`SOSManager.cs:166`) or
  `RescueMissionController.AcceptMissionAsync` (`RescueMissionController.cs:85`). SosScreen
  only shows status.
- Friends needs the other player's raw UUID typed in, and no screen shows a player their own
  id (`ProfileScreen`).
- *Fix:* scene wiring to the existing methods (allowed in Build Recovery), and show the own id
  on Profile.

**M7. Friends actions have no in-flight guard and no confirmation.**
`FriendsController.cs:238-305` (accept, decline, remove, block):
- a double tap sends two requests, and the second (FRIEND_REQUEST_NOT_FOUND / NOT_FRIENDS)
  overwrites the success message with an error;
- Block and Remove happen on one tap.
- *Fix:* reuse `ActionGate`, and use `PopupManager.ShowConfirm` for Block and Remove.

**M8. The defender gets no feedback while joining.**
After "قبول", the Client join retries for up to 20 s (`PhotonConnectionManager.ClientJoinRetrySeconds`).
Nothing is shown and MainMap stays usable: a tap on Challenge is ignored silently, because
the gate is held. (`IncomingChallengeCoordinator.cs:177`)
- *Fix:* show "جارٍ الدخول إلى المعركة…" until the join finishes.

**M9. The countdown is local, starts at different times, and its label never changes.**
`BattleLoadingController.cs:167-182`: the device that sent `/ready` first only notices "both
ready" on its next 1.5 s poll, so the two devices start the match 0–1.5 s apart, plus network
time. The `CountdownLabel` shows a static "3" and no code updates it.
- *Fix:* update the label each second, and start from a server timestamp.

### LOW

- L1. `Core/ServiceLocator.TryGet` (lines 66-71) checks `service != null` by reference. A
  destroyed scene service (PopupManager after MainMap unloads) is still returned. Today this is
  harmless because PopupManager checks its own fields with Unity's null check.
  Fix: `service is UnityEngine.Object o ? o != null : service != null`.
- L2. After a match nothing calls `LeaveRoomAsync`. The runner and avatars stay in
  DontDestroyOnLoad and keep using CCU (known, HANDOFF item 35).
- L3. `InfluenceChangeLabel` ("—") in Battle's `ResultPanel` stays visible during the whole
  match: `SetAllPanelsInactive` does not hide it.
- L4. Onboarding shows no highlight on the chosen class card.
- L5. The Arabic and English toggles in Settings have no ToggleGroup (`m_Group: 0`), so both
  can be on. English changes only the Sprint 10 labels, and `RtlLayoutFlip` then left-aligns
  Arabic text.
- L6. A refused location permission shows one popup, and GPS is never retried until MainMap
  reloads (`GPSLocationService.cs:55-59`).
- L7. There is no logout UI, so "account switch" (step 9 of the defender test) cannot be run
  without clearing app data.
- L8. Pushed screens (Settings, SOS, Shop, BattlePass) close only through the Map tab. Tapping
  the same top button again does nothing.
- L9. With an empty `NetworkedClass` at Countdown, the remote combatant gets the default
  100/100 stats and no class (`BattleManager.InitializeCombatant`). That is unlikely, because
  the profile RPC is sent at spawn.
- L10. `SessionExpired` during Battle loads Login and leaves the Photon runner alive.

Checked and OK:
- Login, Register, Confirm, Challenge, Accept/Decline, Return, Visibility, Inventory action and
  Quest claim all ignore a double tap.
- 401 refresh-and-retry (`AuthSession`) and its Arabic messages.
- Visibility toggle: reverts and shows an Arabic popup on failure.
- The attacker's wait loop: decline, expiry and network failure all end within 31.5 s.
- `/auth/me` PLAYER_NOT_FOUND → Onboarding.

---

## 3. Two-device test plan — tonight

**Roles:**
- **Phone** = account **A** (Android, USB) = **defender** / Photon Client.
- **Editor** = account **B** = **attacker** / Photon Host.

The Editor attacks because of H1 and H2: the phone cannot open the Challenge button.

**Order matters:** a decided result makes the loser Controlled for 120 min, which blocks any
rematch. So run decline → expiry → accept/fight → disconnect → draw → KO, in that order.

### 3.0 Logging and capture (before anything)

- **Backend:**
  ```powershell
  cd C:\Projects\NfOUZ\backend; npm.cmd start 2>&1 | Tee-Object C:\NFOUZ-Logs\backend-1029.log
  ```
  The backend logs only `info: Incoming request {"method":…,"path":…,"requestId":…}` per call
  (no status code), and `warn: Handled API error <msg> {"code":"…","path":…}` per refusal.
  "Success" therefore means an `Incoming request` line with **no** `Handled API error` line
  carrying the same requestId.
- **Phone:**
  ```powershell
  adb logcat -c; adb logcat -s Unity > C:\NFOUZ-Logs\phone-1029.log
  ```
- **Editor:** Console with Collapse off. The file is at
  `%LOCALAPPDATA%\Unity\Editor\Editor.log`.
- **Database:** keep a psql shell open on `nfouz_db`, for reads only. A reset UPDATE is the
  owner's choice.

### 3.1 Preflight (T−30 min)

1. Run `git status` on the laptop. Only laptop-local files may show:
   `PHOTON_FUSION_AVAILABLE` in ProjectSettings, the x86-64 arch tick, `csc.rsp`.
2. `curl http://127.0.0.1:3000/health` must answer 200 with database ok and firebase ok.
   `npm.cmd run migrate` must show 22/22 applied.
3. **Rebuild the APK with `PHOTON_FUSION_AVAILABLE` on.** The 10-27 APK has no Photon. Use a
   Development Build. Install it with `adb install -r`, then run `adb reverse tcp:3000 tcp:3000`.
   The phone needs Wi-Fi or mobile data for Firebase, Photon and Mapbox; USB carries only the
   backend.
4. Phone settings:
   - Screen timeout 10 min (M5).
   - Location: precise, "allow while using".
   - Developer options: Stay awake on.
   - Stand near a window or outdoors. Indoor GPS jumps of 30 m or more trip the driving stop
     ("سلامتك أولاً", hidden for 120 s).
5. Editor settings:
   - Player → Resolution → Run In Background ✓ (laptop-local). Otherwise the Host pauses when
     you touch the phone or another window.
   - Game view at a portrait phone resolution (1080×2400).
6. Database state:
   ```sql
   SELECT username, player_id, is_visible, is_controlled, controlled_until, protected_until,
          fast_movement_at, influence, last_lat, last_lng, last_location_at
   FROM players WHERE username IN ('<A>','<B>');
   SELECT battle_id, status, accepted_at, declined_at
   FROM battles WHERE status = 'in_progress';
   ```
   Expect `is_visible` true, not controlled or protected, no `fast_movement_at` in the last
   2 min, and no in-progress battle for A or B. If Controlled from an earlier test: wait for
   it to end, or (owner decision) `UPDATE players SET is_controlled=false, controlled_until=NULL,
   controller_id=NULL, controlled_since=NULL, protected_until=NULL WHERE username IN (…)`.

### 3.2 Bring both online

| # | Action | Expected | Screenshot |
|---|---|---|---|
| 1 | Phone: open app, log in as A | Boot → Login → MainMap. Backend about every 5 s: `PATCH /player/<A>/location`, `GET /battle/incoming`; about every 6 s `GET /player/nearby`. No `Handled API error`. | S1 phone MainMap (HUD Arabic, map) |
| 2 | Read A's stored point: `SELECT last_lat,last_lng,now()-last_location_at FROM players WHERE username='<A>'` | Age under 10 s | — |
| 3 | Editor (**not playing**): Tools → NFOUZ → Dev Location. Use dev location ✓, lat = A.lat + 0.00008 (about 9 m north), lng = A.lng, with a dot as the separator. Save. | Console: `[EditorDevLocation] Dev location on.` | S2 dev-location window |
| 4 | Editor: Play, log in as B | Console `[GPSLocationService] Editor dev location in use`; backend `PATCH /player/<B>/location` every 5 s with no `INVALID_LOCATION`. Do not change the dev point while playing: a jump of 30 m or more within 60 s marks B as "driving". | S3 Editor MainMap |
| 5 | Server distance check (repeat right before every challenge): see the SQL below | meters < 20 (aim for 8–12), both ages < 120 s | S4 SQL output |
| 6 | Wait about 6 s | Each side shows one marker for the other. In the Editor Hierarchy, `MarkerPoolContainer` has one active child. | S5 both maps |

Distance query for step 5:
```sql
SELECT 6371000*2*asin(sqrt(power(sin(radians(b.last_lat-a.last_lat)/2),2)
       + cos(radians(a.last_lat))*cos(radians(b.last_lat))
       * power(sin(radians(b.last_lng-a.last_lng)/2),2))) AS meters,
       now()-a.last_location_at AS a_age, now()-b.last_location_at AS b_age
FROM players a, players b WHERE a.username='<A>' AND b.username='<B>';
```

### 3.3 Prove H1 and H2, then work around them (Editor)

7. Click A's marker in the Game view.
   - Expected if H2 is real: nothing opens.
   - Then MainCamera → NearbyPlayerSelection → Max Raycast Distance = 5000 and click again.
     Expected: `MiniProfilePopup` with A's username and class; "تحدي" is enabled (≤ 20 m). S6.
8. Click "تحدي" once, without the workaround. Expected (H1): the popup vanishes and there is
   no `POST /battle/challenge` in the backend log. Record it.
9. Select the marker again, untick the **NearbyPlayerSelection** component, then click "تحدي".
   Expected:
   - backend `Incoming request {"method":"POST","path":"/battle/challenge"}`, no error;
   - Editor popup "أُرسل التحدي. بانتظار رد الخصم…" (S7);
   - backend `GET /battle/<id>` from B every 1.5 s.
   Re-tick NearbyPlayerSelection after each challenge.
   - `TARGET_OUT_OF_RANGE` → rerun the distance query; the phone's GPS drifted.
   - `TARGET_UNAVAILABLE` → A is hidden, driving or blocked.
   - `DUPLICATE_CHALLENGE` → an old battle is still in progress (see 3.1 step 6).
10. *(Reverse direction, record only.)* On the phone, tap B's marker. Expected today: nothing
    happens, or the popup closes on "تحدي". This confirms H1/H2 on device. S8.

### 3.4 Answering the challenge

11. **Decline.** Within ≤ 5 s the phone shows "تحدٍّ جديد" with B's name, class and rank,
    and "قبول" / "رفض" (S9).
    - Tap "رفض" → one `POST /battle/<id>/decline`.
    - The phone prompt closes; the Editor shows "رفض الخصم التحدي." (S10).
    - SQL: `status='cancelled'`, `declined_at` set.
12. **Expiry.** Challenge again (step 9) and ignore it for 30 s.
    - The phone prompt closes by itself.
    - The Editor shows "لم يرد الخصم على التحدي في الوقت المحدد." (S11).
    - SQL: `cancelled`, `accepted_at` and `declined_at` both NULL.
13. **Accept (double tap).** Challenge again; on the phone tap "قبول" twice quickly.
    - Backend: exactly **one** `POST /battle/<id>/accept`.
    - Logcat: possibly `Room 'battle_<id>' not created yet — retrying as Client.`, then
      `Joined room 'battle_<id>' as Client.`
    - Editor, within about 1.5 s plus StartGame: `Joined room 'battle_<id>' as Host.`
    - The phone shows no "joining" feedback (M8). Note how long it takes.
14. **Battle load.**
    - Both load Battle. Backend: two `POST /battle/<id>/ready` (one per account), then
      `GET /battle/<id>` polls until both are ready.
    - Both show the countdown panel; the label stays "3" (M9).
    - The phone's `GET /battle/incoming` lines stop.
    - S12 loading screen, both. S13 countdown, both. Note the start-time skew between the two
      timer labels.
    - If the phone shows "تعذّر دخول غرفة المعركة": save the logcat `ShutdownReason` line.
    - If the loading screen never leaves after a `Handled API error` on `/ready`: that is H3.
      Note the code.
15. **Fight sync (about 30 s, no KOs).**
    - Editor: WASD, Space (attack), E (special), Left Shift (dodge), Q (ability). Phone: left
      stick and icon buttons.
    - Expected: two (pink) capsules on both screens; movement mirrors both ways; health bars
      drop on both screens after hits.
    - Known: the phone's cooldown icons always show ready.
    - S14 mid-fight, both screens at the same moment (photo the phone next to the laptop).

### 3.5 Disconnect / reconnect (in the same battle, before any result)

16. **Kill the phone app mid-match** (recents → swipe away). What the code predicts:
    - Editor: `[PhotonConnectionManager] Player … left the room — starting disconnect grace period.`
    - **No** `POST /battle/<id>/disconnect` in the backend log (H4).
    - The phone's avatar disappears in the Editor. The Editor timer runs to 0 and then stays
      there: no result panel, no return (H4). S15 Editor stuck at 0.
17. **Reopen the phone within 15 s.**
    - Expected: Boot → `GET /auth/me` → MainMap. There is no way back into the room; reconnect
      is not built in Battle. S16.
    - The backend never sees `/reconnect`.
18. Stop Play in the Editor to get out.
    - The battle row stays `in_progress` (accepted) until 298 s after `accepted_at`. Any
      challenge before then answers `DUPLICATE_CHALLENGE` (note it once). After that, the
      first battle call ends it.
    - SQL: `status='cancelled'`, no influence change for either player. S17.
19. *(Optional, one more accepted battle.)* Airplane mode on the phone for 5 s mid-match, then
    off; next, the Home button for 10 s, then return. Record whether the Fusion Client
    survives a short blip, and what each screen shows. Both are expected to end in H4 if the
    Client drops.

### 3.6 Result

20. **Draw (does not lock either account).** New accept. Nobody attacks for 90 s → Overtime
    banner "وقت إضافي!" → 30 s → draw.
    - Backend: the host sends exactly **one** `POST /battle/<id>/resolve`. The phone sends
      `GET /battle/<id>` every 1.5 s, then `GET /auth/me`, and **never** `/resolve`.
    - Both show "تعادل" with "0 Influence" (English, M2). S18 both result screens.
    - SQL: `status='resolved'`, `winner_id` and `loser_id` NULL; influence unchanged.
    - Auto-return after 8 s, or tap "العودة إلى الخريطة": both on MainMap, and the backend
      shows `PATCH location`, `GET nearby` and `GET incoming` again. S19.
21. **KO (last test).** Note both influences first. New accept; the Editor (host) attacks the
    standing phone avatar until its health is 0.
    - Editor: "نصر!" with "+15 Influence". Phone: "هزيمة" with "-10 Influence". S20.
    - Backend: one `/resolve` from B. The phone sends `GET /battle/<id>`, then `/auth/me`.
    - SQL:
      - the winner +15, the loser −10;
      - the loser `is_controlled = true`, `controlled_until` ≈ now + 120 min,
        `controller_id` = the winner;
      - the battle `resolved` with `winner_id` and `loser_id` set, or `pending_review` (then
        "قيد المراجعة الأمنية" on screen and no influence change).
    - Back on MainMap: the HUD shows the new influence; the phone shows the Controlled badge
      and countdown. S21.
22. Editor Hierarchy → DontDestroyOnLoad: `NetworkRunner_battle_<id>` and NetworkPlayer objects
    are still there (L2). Photon dashboard CCU is still 2. S22.

### 3.7 Offline / 500 quick checks (if time is left)

23. Ctrl+C the backend with the phone on MainMap, then open the Inventory, Quests and Friends
    tabs. Expected today: "حدث خطأ: NETWORK_ERROR" (M1). S23.
24. With the backend still down, force-close and reopen the app. Expected today: it lands on
    Login with no message (M3). S24.
25. Restart the backend and log in again. MainMap recovers.

### Screenshot checklist

S1–S24 as above. Also save the backend log, the phone logcat and Editor.log, plus the result
of every SQL query, with times in the file names. For every unexpected step, write down the
wall-clock time, so the requestId can be found in the backend log.
