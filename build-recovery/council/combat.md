# NFOUZ — Combat Design Book (as implemented) + Balance & Feel Review

Author: Combat Designer (council seat). Branch `claude/sprint-5-photon-multiplayer-5jv8v2`. Read-only review, no repo edits.
Scope: `Assets/_Project/Scripts/Combat/*`, `Networking/{CombatActionInput,NetworkInputData,TouchStick,TouchStickMath,NetworkPlayerController}.cs`,
`UI/Screens/BattleScreen.cs`, `UI/HUDController.cs`, `Combat/ResultController.cs`, `backend/src/services/battle.service.js`,
`backend/src/utils/battleLifecycle.js`, `backend/src/config/env.js`, `backend/migrations/{002_players,008_items}.sql`, EditMode tests.

Part A describes what the code does now. Part A is the authoritative current behavior, not the GDD's intent.
Part B is review. Every number in Part B §B5 is a **PROPOSAL that needs owner approval**. None of it is approved.

---

## PART A — DESIGN BOOK (current behavior)

### A1. Match flow and timers

| Phase | Duration | Where | Notes |
|---|---|---|---|
| Challenge → defender Accept | ready window starts at `accepted_at` | battle.service.js `acceptChallenge` | Challenge range is 20 m, using fresh server-stored locations only (`assertWithinChallengeRange`) |
| Ready timeout | **30 s** (`BATTLE_READY_TIMEOUT_SECONDS`) | battleLifecycle.js rule 2 | If both players are not ready, the battle becomes `cancelled` |
| Countdown | **3 s** (`Constants.Battle.CountdownSeconds`) | CombatStateMachine.RunCountdown | Starts on each client when its own session update shows both players ready. Movement works during the countdown. Combat input is ignored, and the latch is cleared at "go" |
| Battle | **90 s** (`SessionMaxDurationSeconds`) | BattleManager.Update | Each machine keeps its own local timer (Time.deltaTime). Only the host's timer decides the result |
| 90 s timeout | — | HandleBattleTimeEnd | Compares health **percentages**. A difference > **1.0 pp** wins outright. Otherwise the match goes to Overtime |
| Overtime | **30 s** (`OvertimeSeconds`) | HandleOvertimeTimeEnd | **Energy regen is OFF** for the rest of the match. The same 1 pp comparison runs again. If still within 1 pp, the result is a **Draw** |
| Death | instant | HandleDeath / CheckDeathReportedByHost | Health 0 ends the match at once. A client learns of the death from networked Health 0 |
| Reconnect grace | **15 s** (`BATTLE_DISCONNECT_GRACE_SECONDS`) | handleDisconnect/Reconnect, lifecycle rule 1 | A missed deadline sets `forfeited`. This is session state only: no winner, no Influence. Note: Battle.unity has no PhotonRoomLifecycle, so nothing posts /disconnect today (HANDOFF open item) |
| No-result cutoff | **298 s** = 30 + 3 + 130 + 120 + 15 | battleLifecycle.js | After this the battle becomes `cancelled`. It is measured from `accepted_at` |
| Result validity | issued_at age ≤ **120 s**, clock skew ≤ **15 s**, duration ≤ **130 s** (hard limits) | battle.service.js resolveBattle | |
| Non-host result poll | every 1.5 s, up to 20 s | BattleManager.PollForResolutionAsync | If it times out, the screen shows the unknown-result panel |
| Result screen | auto-return to MainMap | ResultController | |

State machine: `Ready → Countdown → Battle → (Overtime) → Ended` (CombatStateMachine.cs). A server-side forfeit or cancel (`OnSessionEnded`) moves any state to Ended.

### A2. Classes

| | Scout | Ranger | Titan |
|---|---|---|---|
| Base HP / Energy (designed; BattleManager.GetClassBaseStats, "GDD v1.0 §3.3") | 80 / 120 | 100 / 100 | 140 / 80 |
| **HP / Energy actually used in a live match** | **100 / 100** (see Bug C1) | 100 / 100 | 100 / 100 |
| Attack multiplier | 1.00 | 1.15 | 0.90 |
| Defense (flat subtraction) | 2 | 4 | 10 |
| Dodge cost | **18** | 20 | 20 |
| Passive | cheaper Dodge | +1 m range on Influence Cannon basic and Charged Pulse only | 30 % knockback resistance |
| Class ability | **Blink Step** | **Focus Shot** | **Bulwark** |
| Ability cost / cooldown | 25 E / 12 s | 25 E / 12 s | 30 E / 15 s |
| Ability effect | Instant 4 m teleport along current facing, clamped to an arena radius of 15 m. 0.25 s state with **0.2 s full invulnerability**. No action lock | Self-buff for 5 s. The next hit that lands (basic, special or projectile) gets **+6 flat** and uses up the buff. No stacking. 0.2 s action lock | Absorbs a **flat 25 damage pool** for 3 s. Whatever is not absorbed is lost. 0.2 s action lock |

**Universal Dodge** (all classes): instant **3 m** teleport along current facing, **not clamped** to the arena. The state lasts 0.3 s, of which the first **0.2 s is fully invulnerable** (ApplyDamage is skipped). Cooldown **4 s**, cost 20 E (Scout 18).

### A3. Weapons (WeaponDatabase.GetDefaultStats — "latest detailed GDD")

| | Pulse Blade | Shadow Dagger | Titan Hammer | Influence Cannon |
|---|---|---|---|---|
| Basic damage | 18 | 12 | 32 | 15 |
| Basic range | 2.2 m | 1.5 m | 2.5 m | 10 m (Ranger 11 m) |
| Attack cycle (= basic cooldown) | 0.65 s | 0.40 s | 1.20 s | 0.80 s |
| Basic wind-up (data only, **not implemented**) | 0.20 s | 0.12 s | 0.55 s | 0.25 s |
| Basic energy cost | 0 | 0 | **5** | 0 |
| Special | **Pulse Arc** | **Shadow Lunge** | **Ground Break** | **Charged Pulse** |
| Special damage (flat base, then the normal formula) | 26 | 20 | 36 | 28 |
| Special geometry | 3 m reach, 140° arc around facing | 3 m dash along facing (clamped to 15 m). Damage only if the landing point is within 1.5 m of the target. **No invulnerability** | 3 m radius AoE plus 1 m knockback away from the attacker (Titan target 0.7 m) | Projectile, 18 m/s, 0.2 m hit radius, 12 m range (Ranger 13 m). Aimed at the target's position when fired, **does not home**, hits at most once |
| Special cost / cooldown | 25 E / 8 s | 20 E / 7 s | 35 E / 12 s | 30 E / 10 s |
| Special wind-up (data only, **not implemented**) | 0.45 s | 0.25 s | 0.75 s | 0.65 s |
| Recovery lock after a special | 0.35 s (blocks every action) | 0.35 s | 0.35 s | 0.35 s |
| Charges resources on a miss? | No (an arc-check failure costs nothing) | **Yes**, the dash always happens | No (outside the radius costs nothing) | **Yes**, fires with no range check |

**In live matches every combatant has Pulse Blade.** BattleManager.cs:467-469 hard-codes it because loadout and equip do not exist yet. The other three weapons exist only in tests.

### A4. Energy, damage, mitigation, knockback, death

- **Energy regen:** +5 E/s, accumulated fractionally and capped at MaxEnergy. Only the Photon host regenerates (`HasSimulationAuthority`). Regen is off in Overtime.
- **Damage formula** (DamageCalculator): `round( max( base × classAtkMult × 1.0 − targetDefense , 1 ) )`. `Mathf.RoundToInt` uses banker's rounding. The result is deterministic, with **no crits and no randomness** (crits were removed in the Sprint 6 correction). The weapon multiplier is always 1.0.
- **Focus Shot** adds +6 **after** the formula, so defense does not reduce it.
- **Mitigation order** (PlayerCombat.ApplyDamage): (1) Dodge or Blink i-frames negate the hit fully and raise `OnDamageTaken(0)`. (2) The Bulwark pool absorbs up to what remains. (3) HP is reduced, clamped at 0. (4) HP ≤ 0 → `Die()` → `OnDeath`.
- **Knockback:** Ground Break only. 1 m, or 0.7 m against a Titan. Applied as an instant transform offset that is **not clamped to the arena**.
- **Target validation:** basic attacks check center-to-center distance only. **No facing is required**, so a basic attack hits in all 360°. Pulse Arc is the only attack that needs facing.
- **Same-tick actions:** the host runs presses in this order: Dodge → Class ability → Basic → Special. Basic and special have separate cooldowns, so pressing both in one tick lands **both hits in one frame**.

**Per-hit damage table (basic / special), attacker row vs defender column:**

| Weapon | Atk | vs Scout | vs Ranger | vs Titan |
|---|---|---|---|---|
| Blade | S | 16 / 24 | 14 / 22 | 8 / 16 |
| | R | 19 / 28 | 17 / 26 | 11 / 20 |
| | T | 14 / 21 | 12 / 19 | 6 / 13 |
| Dagger | S | 10 / 18 | 8 / 16 | **2** / 10 |
| | R | 12 / 21 | 10 / 19 | 4 / 13 |
| | T | 9 / 16 | 7 / 14 | **1** / 8 |
| Hammer | S | 30 / 34 | 28 / 32 | 22 / 26 |
| | R | 35 / 39 | 33 / 37 | 27 / 31 |
| | T | 27 / 30 | 25 / 28 | 19 / 22 |
| Cannon | S | 13 / 26 | 11 / 24 | 5 / 18 |
| | R | 15 / 30 | 13 / 28 | 7 / 22 |
| | T | 12 / 23 | 10 / 21 | 4 / 15 |

### A5. Win conditions, signing, validation, rewards

1. **KO:** Health 0 → the other side wins at once.
2. **90 s timeout:** higher HP% wins if the gap is > 1 pp. Otherwise Overtime runs.
3. **Overtime end:** same rule. Within 1 pp → **Draw**.
4. **Server-side forfeit or cancel:** the match ends with no result. The client shows the unknown-result panel and never presents it as a draw.

**Signing** (Host Mode Alpha): the attacker's client is always the Photon host and alone holds `host_authority_secret` and `match_nonce`. It builds a `BattleResultPayload` with battle_id, room_name, rules_version (6.1.0), match_nonce, event_seq = 1, both ids, both final HPs, outcome (`attacker_win`, `defender_win` or `draw`), duration_seconds and issued_at. It HMAC-SHA256 signs the payload and POSTs to `/battle/{id}/resolve`. The non-host polls `GET /battle/{id}`, then `/auth/me`.

**Server validation** (resolveBattle):
- Hard rejects:
  - a missing field
  - a bad HMAC (timing-safe compare)
  - an id, room, rules_version or nonce mismatch
  - event_seq ≤ last
  - age > 120 s or skew > 15 s
  - duration outside 0–130
  - HP outside 0–500 or not an integer
  - an outcome that contradicts the HPs (a draw with someone at 0, or a winner at 0)
- Soft → **pending_review** (no rewards): duration < 2 s, duration ≥ 125 s, or either HP ≥ 160.

**Rewards** (decisive, non-training, not pending_review):
- Winner: **+15 Influence**.
- Loser: **−10 Influence**, floored at 0. The applied delta is logged.
- Loser becomes **Controlled for 120 min**. Their outgoing Control relationships are released first.
- Rank is recomputed and rank cosmetics are recorded add-only.
- Quest `win_battles` +1 for the winner.
- Draw, training and pending_review give nothing.
- There are **no XP or credit rewards for PvP**.

### A6. Controls

**Phone:**
- **Floating stick:** a touch that begins in the **left 40 % × bottom 70 %** of the screen and not on UI. Radius = max(40 px, 12 % of the short side). Dead zone 15 %, output rescaled to 0..1.
- **4 buttons:** the four "ready" icons are Unity Buttons that fire on **click, which means on release**. They are hidden while not ready.
- **Facing:** follows the move direction only, rotating at 240°/s. With no stick input the player keeps the last facing.
- **Movement:** 4 m/s, with no collision and no arena clamp.

**Editor:** WASD/arrows (Input Manager axes), **Space** = basic, **E** = special, **Left Shift** = dodge, **Q** = class ability.

**Pipeline:** a press goes to `CombatActionLatch.Local`, which is consumed into `NetworkInputData.ActionBits` each input sample. On the host, `NewlyPressed` (rising edge vs `LastActionBits`) leads to `BattleManager.HandleCombatActions`. The client sends intent only. In stub mode (no Fusion define), `CombatActionsPressed` is never raised, so **combat cannot be exercised without Fusion**.

---

## PART B — BALANCE & FEEL REVIEW

### B1. Time-to-kill (computed)

Method: a greedy rotation from t = 0, starting with full class energy.
- Order: Focus Shot when ready, then special when ready and affordable, then basic.
- 0.35 s recovery and 0.2 s activation locks are included. Regen is 5 E/s.
- **Wind-up is not modelled, because the code does not implement it.**
- The attacker is always in range, the target never dodges, and the first hit lands at 0 s.
- Script: a cloud scratchpad script (not kept).

**As shipped** (everyone Pulse Blade, 100 HP, 100 E). Seconds:

| Atk \ Def | Scout | Ranger | Titan |
|---|---|---|---|
| Scout | 2.95 | 3.60 | 6.85 |
| Ranger | 2.50 | 2.50 | 4.45 |
| Titan | 3.60 | 4.25 | 8.36 |

**As designed** (class HP 80/100/140, class energy). Seconds:

| Weapon | Atk | vs S | vs R | vs T |
|---|---|---|---|---|
| Blade | S | 2.3 | 3.6 | 9.0 |
| | R | 1.9 | 2.5 | 7.1 |
| | T | 3.0 | 4.3 | 12.3 |
| Dagger | S | 2.8 | 4.4 | 21.0 |
| | R | 2.2 | 3.4 | 11.2 |
| | T | 3.2 | 5.2 | **37.8** |
| Hammer | S | 1.6 | 2.8 | 6.4 |
| | R | **0.55** | 1.8 | 4.2 |
| | T | 1.6 | 2.8 | 7.6 |
| Cannon | S | 3.6 | 5.2 | 16.4 |
| | R | 2.2 | 4.6 | 10.2 |
| | T | 3.6 | 6.0 | 20.0 |

Reading:
- **Typical TTK is 2–5 s inside a 90 s match.** The spawns are 12 m apart (z = −6 / +6), so a melee player needs about 2.5 s to close the gap, which is as long as the fight itself. Dodge, abilities and energy barely matter in most fights. The starting energy pool covers everything.
- **Titan is the dominant class.** Shipped: Titan kills Scout in 3.6 s, Scout needs 6.85 s. Designed: 3.0 s vs 9.0 s. Flat defense 10 nearly halves Pulse Blade damage against Titan, while Titan's 0.9× attack multiplier costs it only about 10 %.
- **Shadow Dagger is non-viable against Titan.** It deals 1–4 damage per basic hit: 38 s for Titan vs Titan, with 140 basic hits needed. Flat defense punishes fast, low-damage weapons hardest.
- **Titan Hammer is strictly the best melee weapon** while wind-up is not implemented. It has the highest per-hit damage, the longest melee reach (2.5 m) and its 5 E basic cost is easily sustained (4.2 E/s spend vs 5 E/s regen). Ranger + Hammer kills a designed Scout in **0.55 s** (Focus + special + basic). The server would put that result into pending_review because it is under 2 s.
- **Influence Cannon** has the lowest damage output, but its 10–11 m range plus 360° basic attacks with no facing check make it a kiting weapon (see B2).

### B2. Dominant strategies and degenerate cases

1. **Hit once, then run.** Walking has no arena limit (NetworkPlayerController.cs:327) and both sides move at 4 m/s. A player who is ahead on HP% can walk away and win on the 90 s timeout, and a chaser can never catch up. Only Dodge, Blink and Lunge add burst distance. The visible floor is about 15 × 15 m (Plane × 1.5), but nothing keeps players on it.
2. **Kiting with Cannon or ranged basics.** Basic attacks do not need facing, so a Cannon user can retreat at full speed and keep firing every 0.8 s from 10 m.
3. **Press both buttons together.** Basic + special in the same tick land together (BattleManager.cs:404-412) because their cooldowns are separate. This is a front-loaded burst with no counterplay.
4. **Dodge cannot be used reactively.** Wind-up is not implemented, so every hit is instant. The 0.2 s i-frames can only avoid a hit by luck or by prediction. They work as a 3 m teleport, not as a defensive skill.
5. **The host always has an advantage.** The attacker is always the host and runs with zero input latency, while the defender's presses take a round trip. The attacker is also the side that chose to start the fight.
6. **The HP% timeout is skewed by the MaxHealth mismatch** (Bug C1). A Scout defender starts at 125 % and a Titan defender at 71 %. An idle match against a Titan defender is an attacker win, and an idle match against a Scout defender is a defender win.
7. **The 1 pp draw threshold is very narrow.** One Dagger hit is more than 1 pp. Idle mirrors go to Overtime and then Draw at 120 s (under the 125 s suspicion threshold, so they are recorded as draws).
8. **Shadow Lunge charges energy and cooldown on a whiff.** It dashes along facing, not toward the target. Ground Break's 1 m knockback is shorter than the Hammer's own 2.5 m reach, so it has no tactical effect.
9. **Charged Pulse is easy to dodge by strafing** (0.2 m radius, flight time up to 0.67 s, target moves 4 m/s). It is also subject to tunnelling (Bug C5). Its expected value is well below its 30 E cost.

### B3. Missing feedback (all of these are NEW systems, so they need owner scoping under the Build Recovery rules)

- **No opponent HP bar.** The HUD shows only the local player's HP and Energy (HUDController). You cannot see whether you are winning.
- No hit VFX, damage numbers, hit-stop, screen shake, haptics or SFX. There is no AudioSource, Animator or ParticleSystem in combat code. The avatar is a pink capsule (URP material).
- No attack, dash, special or death animations. Dodge, Blink and Lunge are instant teleports with no interpolation (Render() snaps).
- No telegraphs or wind-up indicators (wind-up itself is missing).
- **No cooldown timers.** Buttons simply **disappear** (SetActive(false)) while on cooldown. On the non-host client they always show ready (cooldowns run on the host; HANDOFF open item).
- No buff or status indicators: Focus armed, Bulwark pool, invulnerable, Overtime regen off (only a banner).
- No 3-2-1 countdown display. The timer label shows "0" during Ready and Countdown.
- No feedback for "not enough energy", "out of range" or "outside arc". These only produce Debug.LogWarning.
- No target indicator or lock-on, and no way to aim Pulse Arc except by walking toward the target.
- The result screen shows a fixed "+15 / −10 Influence" in English, not the applied delta in Arabic-first copy.

### B4. Combat bugs (file:line)

| # | Severity | Location | Bug |
|---|---|---|---|
| C1 | **High** | backend/migrations/002_players.sql:12-15, backend/src/repositories/player.repository.js:48, Assets/_Project/Scripts/Combat/BattleManager.cs:447-461 | Class base stats are never applied server-side. Every player is 100/100. The host uses PlayerSession (100) for its own MaxHealth but class base values (80/100/140) for the remote avatar, while the remote's networked HP is 100. HP% is wrong for the defender: Scout 125 %, Titan 71 %. The timeout winner and Overtime entry are skewed. Energy caps are wrong too: a Titan remote starts at 100 E above its 80 cap, and a Scout remote's cap is 120 |
| C2 | High | Assets/_Project/Scripts/Combat/BattleManager.cs:467-469 | Weapon is hard-coded to Pulse Blade for both players, so 3 of the 4 weapons are unreachable in matches (the `NetworkedWeapon` RPC passes null) |
| C3 | High | Assets/_Project/Scripts/Networking/NetworkPlayerController.cs:327 (movement), Assets/_Project/Scripts/Combat/PlayerCombat.cs:705 (Dodge), :554 (knockback) | Nothing keeps players inside the arena. Walking, Dodge and knockback are all unclamped. Only Blink and Lunge clamp, and they clamp to radius 15 m (Constants.cs:70) while the visible floor is about 7.5 m half-width (Battle.unity ArenaFloor: Plane scaled 1.5) |
| C4 | High (design) | Assets/_Project/Scripts/Combat/PlayerCombat.cs:390-399, :463-584 | `WindUpSeconds` and `SpecialWindUpSeconds` are never used. Every attack resolves instantly, which breaks the dodge counterplay and the Hammer's trade-off. TTK is lower than designed |
| C5 | Med | Assets/_Project/Scripts/Combat/ChargedPulseProjectile.cs:55 | The hit test checks only the end point of each step. At 18 m/s the step is 0.6 m at 30 fps, wider than the 0.4 m hit diameter, so the projectile can pass through even a stationary target. It runs in `Update`/Time.deltaTime on the host, not on the Fusion tick, and is not networked (the client never sees it) |
| C6 | Med | Assets/_Project/Scripts/Combat/PlayerCombat.cs:723-729 | Focus Shot is used up **before** `ApplyDamage` checks i-frames, so a hit that Dodge or Blink negates still wastes the buff. The docs say "next successful hit" |
| C7 | Med | Assets/_Project/Scripts/UI/Screens/BattleScreen.cs:148 | Combat buttons use `Button.onClick`, which fires on pointer **up**. This adds press-to-release latency, and a press is lost if the finger slides off |
| C8 | Med | Assets/_Project/Scripts/UI/Screens/BattleScreen.cs:183-189 | The readiness icon *is* the button, and it is set inactive while on cooldown. The basic-attack button blinks off every 0.35–1.2 s, and a tap during the 0.35 s recovery lands on nothing. On the client it always shows ready |
| C9 | Med | Assets/_Project/Scripts/Combat/BattleManager.cs:404-412 | Basic + special can resolve in the same tick (double hit). The recovery lock only applies *after* a special. Needs an owner decision: intended or not |
| C10 | Med | Assets/_Project/Scripts/Networking/NetworkPlayerController.cs:329-333 + PlayerCombat.cs:504, :626, :705 | Dashes use `transform.forward`, which only rotates toward stick direction at 240°/s. Reversing and dodging immediately sends the player the old way, possibly *into* the attacker |
| C11 | Low | Assets/_Project/Scripts/Combat/PlayerCombat.cs:565-584 | Charged Pulse has no range check before firing. It spends 30 E on a target 50 m away |
| C12 | Low | Assets/_Project/Scripts/Combat/BattleManager.cs:443 | If the profile RPC has not arrived by Countdown, `NetworkedClass` is empty. The combatant becomes "classless": 1.0× attack, 0 defense, no class ability. It is never re-initialised |
| C13 | Low | backend/src/config/env.js:125 + battle.service.js evaluateSuspicion | `RESULT_SUSPICIOUS_MIN_DURATION_SECONDS = 2`, but legitimate sub-2 s kills are possible once Hammer is equipped (0.55 s, 1.55 s rounds to 2). Honest wins would go to pending_review |
| C14 | Low | Assets/_Project/Scripts/Networking/NetworkPlayerController.cs RPC_SetProfile | The host accepts any client-sent health from 1 up to anything. 159 HP passes the server's soft check (≥160) and hard check (≤500). A modified defender can enter with 159 HP. The backend is the right place to check this against stored max_health |
| C15 | Low | Assets/_Project/Scripts/UI/Screens/BattleScreen.cs:101-105 | The timer shows "0" during Ready and Countdown (`_matchTimeRemaining` default) |
| C16 | Low | Assets/_Project/Scripts/Combat/ResultController.cs:164, :197, :246 | Fixed ±Influence labels ignore the 0-floor applied delta. For a `training` result, the null influence deserialises to 0 and is written into PlayerSession.Influence until /auth/me refreshes |
| C17 | Low | Assets/_Project/Scripts/Combat/DamageCalculator.cs:377-381 | Results sit exactly on .5 boundaries (e.g. Titan Cannon 15 × 0.9 = 13.5). Single- vs double-precision float math and banker's vs JS Math.round can disagree when a server replay validator is added. Use integer math (multipliers in percent) |
| C18 | Low | backend/migrations/008_items.sql:19, :21 | Stale item copy: Dagger "high critical chance" (crits were removed), Cannon "draining battle influence" (not implemented) |
| C19 | Info | Assets/_Project/Scripts/Networking/NetworkPlayerController.cs:106 | In stub mode `CombatActionsPressed` is never raised. Editor keys do nothing without the Fusion define. Tests cover PlayerCombat directly |

### B5. Tuning proposals — **PROPOSALS ONLY, need owner approval; not approved values**

Priorities. P0 items are bug fixes within Build Recovery scope; the rest change GDD numbers or add systems.

**P0 — make the existing design actually run (fixes, not redesign):**
1. Apply the class base stats server-side at registration: Scout 80/120, Ranger 100/100, Titan 140/80. Have the host take the remote's max HP and energy from the same source (a server-sent opponent profile), not from a hard-coded table plus client RPC.
2. Clamp **all** movement (walk, Dodge, knockback) to the arena. Set `ArenaRadiusMeters` to match the floor: either the floor scaled to radius 15, or the radius set to about 7 (owner/level choice).
3. Implement the already-approved wind-ups: 0.20 / 0.12 / 0.55 / 0.25 s basic and 0.45 / 0.25 / 0.75 / 0.65 s special. Resolve hit validation at the end of the wind-up.
4. Use the stick direction for Dodge, Blink and Lunge when the stick is pushed; otherwise use facing.
5. Charged Pulse: use a swept segment-vs-circle hit test and run it on the Fusion tick. Make the hit radius the target's body radius (about 0.5 m) + 0.2.
6. Consume Focus Shot only when damage was actually applied (> 0 after i-frames).

**P1 — numbers (proposed):**
- **TTK target 8–15 s** for an evenly matched fight, so dodge, ability and energy decisions matter. Scale HP about 2.5×: **Scout 220 / Ranger 260 / Titan 320**.
- **Defense: Scout 1 / Ranger 2 / Titan 4** (was 2 / 4 / 10). With this pair the modelled TTK becomes (Blade, attacker → target):

  | Atk \ Def | Scout | Ranger | Titan |
  |---|---|---|---|
  | Scout | 7.5 s | 9.0 s | 12.9 s |
  | Ranger | 6.4 s | 7.7 s | 10.5 s |
  | Titan | 8.0 s | 10.3 s | 15.5 s |

  Titan vs Scout is still favourable for Titan (1.6× instead of 3×). The Dagger vs Titan worst case drops from 37.8 s to 16 s. Alternative: percentage defense of 3 / 6 / 15 % instead of flat.
- **Shadow Dagger** base 12 → **14**, or a 0.35 s cycle, so its DPS is competitive under flat defense.
- **Titan Hammer** keeps its 32 damage once the 0.55 s wind-up exists. If wind-up is delayed, cut it to **26**.
- **Ground Break** knockback 1 m → **2.5 m** (= Hammer reach), so it creates space.
- **Charged Pulse:** 28 → **32** damage, or radius 0.2 → **0.35 m**, because it can be strafed.
- **Overtime draw threshold:** keep 1 pp at 90 s, but use **"any HP difference ≥ 1 HP"** at the end of Overtime, to reduce draws.
- **Server soft minimum duration** 2 s → **1 s**, or derive it from countdown + minimum possible TTK.
- Same-tick basic + special: either apply the 0.35 s recovery lock to basics fired in the same tick or **queue the special until after the basic's wind-up**.

**P2 — feel (new systems, need explicit scoping):**
- Opponent HP bar.
- Radial cooldown fill on buttons that always stay visible.
- Pointer-down activation with a 100 ms input buffer.
- Hit flash, damage number, 50 ms hit-stop, light haptic on hit.
- 3-2-1-Go overlay.
- Focus and Bulwark icons, plus a Bulwark pool bar.
- Wind-up telegraph (ground decal for Ground Break, charge glow for Charged Pulse).
- Dash trails and interpolation.
- An SFX set of about 12 cues.
- Arabic result copy showing the actual applied Influence delta.
- Longer term, to address host advantage: a dedicated server, or input-delay parity (already called out as required before competitive release).

### B6. Test coverage notes

EditMode covers damage tables, health comparison and overtime thresholds, the Charged Pulse simulator (including Ranger 13 m), geometry, the latch and stick, and most PlayerCombat rules.

Not covered:
- arena clamping of Dodge and knockback
- Focus being consumed by an i-frame-negated hit
- same-tick basic + special
- MaxHealth source parity between host and remote
- projectile tunnelling at low frame rate
- the Battle → Overtime → Draw path end to end
