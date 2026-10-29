# NFOUZ — Producer / Game Design review (2026-10-29)

Branch `claude/sprint-5-photon-multiplayer-5jv8v2` @ `42c5c3e`. Read-only review.
Sources: CLAUDE.md, build-recovery/* (HANDOFF items 1–35, checklists, vision, story, safety), art-reference, documentation, Unity scripts and backend src/migrations. The GDD is not in the repo. Its values are known only from code comments.

**Where we are:** Station 1 (single player on a real phone) is reached: login, MainMap and a real Mapbox v3 map on a Galaxy A16. Station 2 (two players battle) has never run. Battle controls are merged, and the Fusion 2 code compiles with the define on (EditMode 375/375). There has been no two-client session yet.

---

## 1. Player journey, step by step

Legend: **E** = exists and works in code · **S** = stub/placeholder · **M** = missing · **Phone today** = what the player sees right now on the A16 dev build (USB + `adb reverse` to the laptop).

| # | Step | E (in code) | S (stub) | M (missing) | Phone today |
|---|---|---|---|---|---|
| 1 | Install | Android dev APK (IL2CPP, ARM64), package `com.NFOUZ.NFOUZ1` | — | Release signing/keystore, AAB, store listing, iOS build (needs a Mac), app icon/splash art | Sideloaded dev APK only. It reaches the backend only through USB `adb reverse` to the laptop. |
| 2 | Register / Login | Firebase email+password, Arabic error messages, silent token refresh, double-tap guard | — | Privacy policy/ToS consent, age gate, **in-app account deletion** (Play requirement), logout button, password reset, Google/Apple sign-in | Works (verified). Plain Arabic placeholder UI. |
| 3 | Onboarding / class choice | 3 class cards (Scout/Ranger/Titan), username rule check, `POST /auth/register` | AYAZ intro was descoped | Tutorial / first-battle guidance, class descriptions or art, faction assignment (`faction_id` always NULL), Arabic usernames | Pick a class and a Latin username, then MainMap. There is no explanation of what to do next. |
| 4 | Map | Mapbox v3 3D map follows GPS. HUD shows health/energy/influence/rank/credits. Location PATCH every 5 s. Visibility toggle. Driving stop (25 km/h). | AYAZ button (only a "coming soon" popup) | Proper player avatar on the map (the capsule is pink under URP), safe-area/notch handling, battery tuning | Real map around the player and an overlay HUD. This works on the phone. |
| 5 | Find players | `/player/nearby`, 1000 m radius, coarse grid beyond 50 m, marker pool, blocks respected | — | Marker art and class/rank badges on the map, an "empty area" state (nothing to do alone), challenge push (FCM) | Markers show only if another located player is within 1 km. With one phone, the map is always empty. |
| 6 | Challenge | 20 m range enforced server-side, Accept/Decline prompt, 30 s expiry, advisory locks against races, Arabic refusal reasons | — | Push for an incoming challenge (the defender must have MainMap open), a "face-off" pre-battle screen | Never exercised with two devices. The defender sees the challenge only while MainMap is in the foreground. |
| 7 | Battle | Fusion 2 Host/Client, spawn and input authority, touch stick plus 4 action buttons, approved GDD combat (90 s + 30 s overtime, dodge, specials, class abilities), loading screen and ready timeout, lifecycle cleanup | Arena is an assumed 15 m radius (flagged assumption). The weapon is always Pulse Blade (the loadout is not wired). | **Two-client test**, `/disconnect` and reconnect wiring in Battle.unity, `LeaveRoomAsync` after a match, opponent health bar (the HUD shows only the local player), client cooldown display, networked Charged Pulse projectile, interpolation, characters/arena/VFX/SFX/animation | Has never been played between two clients. Visually it is capsules on a plain arena. |
| 8 | Result / rewards | Server-validated HMAC result. Victory/Defeat/Draw/Unknown panels. Influence +15/−10, rank change label, 120 min Control for the loser, `win_battles` quest progress | `Result.unity` exists but is unused | A battle win grants **no credits, XP or Battle Pass XP**. There is no reward animation. | Not reachable yet (needs step 7). |
| 9 | Quests | 4 seeded daily quests (win 2, walk 500 m, add a friend, rescue via SOS), assigned daily, server-tracked, claim grants credits and BP XP | — | Weekly/onboarding quests (the schema allows them, none are seeded), quest art | Visible. "Walk 500 m" progresses on the phone (seen in the logs). The other three are blocked by battle, friends and SOS. |
| 10 | Inventory | `/inventory`, equip, use (idempotent). 4 weapons and 3 consumables in the catalog | — | **No server path ever grants an item** (no starter kit, no drop, no shop). Equip does not affect battle (always Pulse Blade). Item icons. | Always empty. |
| 11 | Shop | Screen with 3 hard-coded mock rows, buy disabled, "قريباً" (coming soon) | Whole screen | Backend, catalog, IAP, prices (deferred past Alpha) | "Coming soon". |
| 12 | Battle Pass | XP bar from the quests' `battle_pass_xp` | Tier size of 1000 is a flagged, unapproved constant | Tiers and rewards table, premium track (deferred) | A bar that fills slowly from quest claims and unlocks nothing. |
| 13 | Friends | Request/accept/decline/remove/block, friend-quest hook | Blocked list hidden (no GET endpoint) | **Adding a friend requires typing the other player's UUID.** There is no search, QR code, or "add from the battle you just played". There is no unblock UI. | Practically unusable: nobody can find a UUID. |
| 14 | SOS / Rescue | Controlled player sends SOS to up to 10 friends (friendship at least 24 h old). Server-rolled guard battle (65 %). 30 min Protection for the rescued player. Rescuer gets 50 credits + 80 XP (max 3/day). | Push routing (Firebase Messaging not imported, `FIREBASE_MESSAGING_AVAILABLE` stub) | **The rescuer has no way to learn about an SOS without FCM**: there is no in-app list of friends' SOS calls. The 24 h friendship rule blocks same-day testing. | Unreachable end to end. |
| 15 | Profile | Username, class, level, rank, influence, XP, credits | Faction shows "—" | XP never raises `level` (no level-up logic found) | Shows the stats. |
| 16 | Settings / Safety | Arabic/English toggle, visibility toggle, driving stop message, blocks honoured in challenge and nearby lists | Music/SFX sliders (no audio exists) | Logout, delete account, privacy policy link, credits/licences screen (DejaVu licence requires it), report-a-player, home-zone protection, minors policy, night/public-place warning | Language and visibility toggles work. The sliders do nothing. |

**Net player experience today:** one player can register, choose a class, walk around a real 3D map and see the walking quest tick up. There is nobody to fight, nothing to equip, buy or unlock, and no way to add a friend or rescue one. The core loop (meet → fight → result) has not been played even once.

---

## 2. Must-haves for a playable Alpha (prioritized)

Alpha here means 10–20 invited testers who are friends, on Android, outdoors in one city, playing the full loop. Every item below either completes an approved system or is infrastructure. **None of them is a new feature**, except where tagged *(decision)*.

| P | Item | Why | Effort | Owner |
|---|---|---|---|---|
| 1 | **Two-client battle test** in the Editor with the Dev Location (approved) and a phone: challenge → accept → countdown → move/attack → resolve → influence update | The core loop is unproven | M | Unity |
| 2 | Battle network fixes from the QA review: put `PhotonRoomLifecycle` in Battle.unity, make `/disconnect` report the correct player, raise reconnect, call `LeaveRoomAsync` after the result, handle a null role when only one avatar is spawned | A disconnect or a second match will break, and leaked runners use up the 20-CCU limit | M | Unity + backend (verify) |
| 3 | **Hosted backend over HTTPS** (a small VPS or Cloud Run, plus managed Postgres and a domain/TLS). Production URL in `ApiEnvironmentSettings`. Secrets kept outside Git. | Two phones in a street cannot reach a laptop over `adb reverse`. Release builds block HTTP. | M | Backend |
| 4 | Battle readability: opponent health bar, client cooldown display, Render interpolation, a non-pink material for the avatars | Without the opponent's health a fight cannot be read. Jitter makes it feel broken. | M | Unity |
| 5 | **Friend add that a human can use**: show your own ID as a short copyable code or QR, and/or "add opponent" on the Result screen. Uses the existing `/friends/request`. | Friends gate quests, SOS and rescue. Typing a UUID is a dead end. | S–M | Unity (+ design: which option) *(decision: UI only, no new system)* |
| 6 | **Firebase Messaging (FCM) on Android**: import the package, set the define, test the 4 SOS/rescue push types, and add the deferred challenge push | SOS/rescue is unreachable without it, and defenders miss challenges | M | Unity + backend |
| 7 | Grant a **starter loadout** and wire the **equipped weapon into battle** (BattleManager currently hard-codes Pulse Blade) | Inventory and its 4 approved weapons do nothing. Needs the GDD's starting-items rule. | S–M | Backend + Unity + design (GDD check) |
| 8 | Store/legal baseline: privacy policy, in-app account deletion (Play policy), location prominent-disclosure screen before the permission prompt, logout, credits/licences screen | Required for any Play track beyond internal testing, and for GDPR (the developer is in Germany) | M | Design + backend + Unity |
| 9 | Release Android build: keystore kept outside Git, AAB, `versionCode`, Play Console internal testing track, safe-area pass, x86-64 unticked | Testers' installs | S–M | Unity |
| 10 | Minimum art pass: class icons/avatars, map player markers, 4 weapon + 3 consumable icons, Controlled/Protected icons, app icon, panel backgrounds (list in art-reference/README) | Placeholder capsules make playtest feedback about the look useless | L | Art |
| 11 | Crash reporting (Crashlytics, which is already in the Firebase stack) plus a short test-session log | We need to know where Alpha breaks | S | Unity |
| 12 | Full two-phone outdoor checklist run (`PRE_ALPHA_CHECKLISTS.md` §2–4, roadmap step 8): reconnect, background, network loss, SOS/rescue between friends, quests, battery | Acceptance gate | M | QA (developer) |
| 13 | Tester config: lower `SOS_FRIENDSHIP_MIN_AGE_HOURS` through the Alpha `.env` only (the code stays unchanged) so rescue can be tested on day one *(decision)* | The 24 h rule blocks the test plan | S | Backend + design |

Not required for Alpha (already deferred in HANDOFF): Shop backend/IAP, Battle Pass tiers, AYAZ backend, factions, iOS, server-authoritative combat.

---

## 3. Fun and retention improvements

### A. Completing approved systems (no new-feature approval needed; check against the GDD)

| Improvement | Basis in code | Effort |
|---|---|---|
| Win rewards beyond influence: credits/XP/BP XP for a battle win, if the GDD defines them | creditsService lists "battle rewards" as eligible income, but battle.service grants none | S |
| XP → level-up | `players.level` and XP exist, but nothing converts XP to level | S |
| Battle Pass tier table plus free-track cosmetic rewards | XP counter exists. The 1000-XP tier is flagged as unapproved. Rewards need the GDD. | M |
| Seed weekly and onboarding quests (the schema allows both types) | `010_quests.sql` | S |
| Onboarding first-session guidance with AYAZ as narrator (text only, existing popup system) | The AYAZ button is a stub. The story draft is ready. | M (design + Unity) |
| Unblock UI plus a blocked list (one read endpoint) | `/friends/unblock` exists but is unused | S |
| Factions: assignment plus name in the API, colours from the story draft | `003_factions.sql` exists but nothing sets it. HANDOFF says it needs approval, so it sits on the boundary. | M |
| Audio for the existing sliders (UI clicks, hit, victory/defeat) | Sliders exist with no audio. art-reference says audio is a *new system*. **Owner call.** | M |

### B. New features (need owner approval after Alpha; all already listed in POST_ALPHA_VISION)

| Idea | Why it helps | Risk |
|---|---|---|
| **Solo activity when nobody is within 20 m** (training vs `RescueGuardCombat` AI, daily guard fights) | The biggest retention hole: one player alone sees an empty map | Low. Reuses the guard AI. |
| **Rescue countdown drama**, with a push "X was captured, 15 min to save them" | Makes losing a social story. SOS is the game's marketing hook. | Needs FCM (P6) |
| **Face-off screen** (3 s, both avatars, class, rank) | Cheap hype moment | Low |
| **Revenge**: one challenge against whoever beat you, with bonus influence | Gives a reason to come back after a loss | Win-trading abuse |
| **Timed loot drops in public places / evening "peak hour"** | Brings players together. Fits Gulf evenings and Ramadan. | Safety: daylight or lit public places only |
| **Weekly neighbourhood faction war** | Long-term goal, as in Ingress | L. Needs factions plus geo zones. |
| Arabic usernames | Arabic-first identity | Backend rule plus RTL input |
| Virtual city travel / selfie avatar (owner ideas) | Fixes sparse areas / builds identity | Selfie: GDPR Art. 9 biometrics. Needs legal advice. |

---

## 4. Risks

| Risk | Detail | Mitigation / owner |
|---|---|---|
| **Location privacy** | Players within 50 m see exact positions, and a player is updated every 5 s while MainMap is open. A real-time "find a person" vector. GDPR treats precise location as sensitive in practice. | Fuzzing is done. Still needed: privacy policy, data retention for `last_lat/lng`, deletion, home-zone protection *(decision)*, consent copy. Design + backend. |
| **Physical safety** | The game invites strangers to meet within 20 m. Night meetings, minors, driving (25 km/h stop is done). | Alpha with known testers only. Night/public-place warning, age gate/minors policy (legal advice), report and block. |
| **Store policy** | Google Play: account deletion in-app and on the web, a Data Safety form (precise location, account data), prominent disclosure for location, target API level. Apple: Sign in with Apple is required if other social logins are added, plus a location usage string and App Privacy labels. | P8. Design + Unity. |
| **Cheating / host authority** | The attacker host holds the signing secret (accepted Alpha debt). GPS spoofing is checked only at 300 km/h. Self win-trading is limited only by the 120 min Control. | Acceptable for a friends Alpha. Server/Photon-server authority plus Play Integrity before a public launch. |
| **Monetization** | No shop or IAP exists. Credits accumulate with nowhere to spend them. Selling combat power would break fairness (the vision doc says cosmetics only). Gulf payments (mada) are outside the stores. | Decide on a cosmetics-only policy now. Keep IAP out of Alpha. |
| **Empty-world churn** | The loop needs another player within 20 m. In sparse areas the game does nothing. Two-hour Control after a loss can make a new player quit. | Seed testers in one area at set times. Solo activity post-Alpha. Possibly tune Control for Alpha via env *(decision)*. |
| **Apple build needs a Mac** | iOS needs Xcode on macOS (a Mac or a cloud Mac / Unity Build Automation / Codemagic), an Apple Developer account ($99/yr), `GoogleService-Info.plist`, APNs key for FCM, and Mapbox/Photon iOS checks. | Deferred past Alpha. Budget for it before beta. |
| **Infra / cost** | The Photon free plan allows 20 CCU, and leaked runners (no `LeaveRoomAsync`) burn it. Mapbox and Firebase costs are free tier for now. No hosted backend exists. | P2, P3. Monitor CCU. |
| **Process** | A single developer and laptop. Cloud sessions cannot compile C#. Real Android settings live only on the laptop. The GDD is not in the repo, so design decisions are made blind. | Add the GDD (or its relevant sections) to the repo as the authoritative reference. |
| **Licences** | DejaVu requires its licence text to ship with the app (credits screen). Mapbox requires attribution on the map. | P8. |
