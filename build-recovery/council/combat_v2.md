# NFOUZ Combat v2 — "Fight until KO" proposal

Author: Combat Designer (council). Repo read at HEAD `77ccdd2`, branch `claude/sprint-5-photon-multiplayer-5jv8v2`. This includes `2e9fcbf`, which stores 80/120, 100/100 and 140/80 at registration. Nothing in the repo was edited.

**Status: PROPOSAL.** Every number and rule below needs the owner's approval. It changes approved GDD values on purpose, because the owner asked for longer, KO-decided fights (decision of 2026-10-29).

Model scripts are in (cloud scratchpad, not kept):
- `duel_v2.py`: Monte Carlo duel. Both players fight; 1000 runs per cell.
- `perfect.py`: the fastest possible KO.
- `proposal_run.txt`, `proposal_highskill.txt`, `proposal_lowskill.txt`, `current_run.txt`: raw output.

---

## 1. Match flow (v2)

```
Ready (30 s server timeout) → Countdown 3 s → BATTLE (normal, up to 180 s)
   → SUDDEN DEATH (Overtime state reused, 120 s): all damage ×1.5, energy regen stays ON
   → HARD CAP at 300 s total: health-percentage rule (> 1 pp wins, else Draw)
KO (Health 0) ends the match immediately in any phase.
```

- **The normal end is KO.** With the proposed numbers, 0 % of simulated matches reached the cap, even at low skill (35 % basic / 25 % special hit rate). The slowest median cell was 154 s (Titan mirror with Cannons at low skill).
- **Why keep a cap:** both clients and the server need a bound. The server has a no-result cutoff and HMAC age checks. A player who stops playing must not hold an opponent forever. Five minutes is about 3× the typical fight, so almost every match ends by KO.
- **Anti-stall rule** (small, it reuses the existing Overtime state): from 180 s, every hit does ×1.5 damage. It is one multiplier passed into DamageCalculator's existing `weaponMultiplier` argument, which is always `1f` today. Energy regen is **not** switched off, unlike today's Overtime, because switching it off would slow the finish down.
- The arena clamp (§3) removes the "walk away" stall, so no shrinking arena is needed.

### Constants and env that must change

| Where | Current | Proposed | Why |
|---|---|---|---|
| `Assets/_Project/Scripts/Utils/Constants.cs:58` `Battle.SessionMaxDurationSeconds` | 90f | **180f** | Normal phase before Sudden Death |
| `Constants.cs:112` `Combat.OvertimeSeconds` | 30f | **120f** | Sudden Death length; 180 + 120 = 300 s cap |
| `Constants.cs` new `Combat.SuddenDeathDamageMultiplier` | — | **1.5f** | Anti-stall |
| `Constants.cs:113` `DrawThresholdPercent` | 1f | 1f (unchanged) | Used only at the 300 s cap |
| `Constants.cs:70` `Battle.ArenaRadiusMeters` | 15f | **7f** | See §3. The floor is a 15 × 15 m plane (`env.js:73` comment "15x15m arena") |
| `Constants.cs:89` `EnergyRegenPerSecond` | 5 | 5 (unchanged) | |
| `backend/src/config/env.js:87` `BATTLE_SESSION_MAX_DURATION_SECONDS` | 90 | **300** | Only feeds `session_expires_at` (battle.service.js:270); kept truthful |
| `env.js:107` `COMBAT_RULES_VERSION` | '6.1.0' | **'7.0.0'** | Results from the old rules cannot be resolved under the new ones |
| `env.js:110` `RESULT_MAX_DURATION_SECONDS` | 130 | **310** | 300 s cap + 10 s buffer |
| `env.js:111` `RESULT_MAX_PLAUSIBLE_HEALTH` | 500 | **2000** | Highest MaxHealth becomes 1000 |
| `env.js:125` `RESULT_SUSPICIOUS_MIN_DURATION_SECONDS` | 2 | **15** | The fastest possible KO (100 % hits, no dodges) is 23.2 s (`perfect.py`). 15 leaves margin |
| `env.js:126` `RESULT_SUSPICIOUS_DURATION_SECONDS` | 125 | **305** | A cap result at exactly 300 s is legitimate; 301 to 310 is suspicious |
| `env.js:127` `RESULT_SUSPICIOUS_HEALTH_THRESHOLD` | 160 | **1001** | Above Titan's 1000 |
| `backend/.env.example:36, 46, 49, 50, 54, 55, 56` | 90, 6.1.0, 130, 500, 2, 125, 160 | 300, 7.0.0, 310, 2000, 15, 305, 1001 | Keep in step with env.js |
| `backend/src/utils/battleLifecycle.js:23` (comment) | 30 + 3 + 130 + 120 + 15 = **298 s** | 30 + 3 + 310 + 120 + 15 = **478 s** | The formula at :34-39 already derives it; only the comment changes |

`evaluateSuspicion` (battle.service.js:465-481) needs **no code change**; it reads the env values above.

The `CombatStateMachine.cs` states are unchanged: Overtime is reused as Sudden Death. Only doc comments change (the `EnterOvertime` comment, around :95-100).

Optional, recommended later: replace the global health threshold with a per-participant check, `final_health <= classMaxHealth(class_type)`, inside resolveBattle. The server knows both players' classes.

---

## 2. New numbers (proposal)

### Design approach

- Fights need to be about 10× longer at realistic hit rates.
- Weapon attack speeds and the feel of every ability stay as they are (same cycles, cooldowns, costs, dashes, i-frames). Only **HP, the attack multipliers and flat defense** are re-tuned.
- Win rates are balanced on **Pulse Blade**, the only weapon in live matches (BattleManager.cs:486).
- **Flat defense goes to 0.** It made small, fast hits useless (Dagger against Titan did 1 damage) and caused most of Titan's dominance.
- Each class gets its identity from HP plus attack plus its kit:
  - Scout: lowest HP, hits hardest per swing, cheapest Dodge plus Blink.
  - Ranger: middle HP, Focus Shot.
  - Titan: highest HP, lowest damage, Bulwark, knockback resistance.

### Class table

| | Scout | Ranger | Titan |
|---|---|---|---|
| **Battle MaxHealth** | 80 → **840** | 100 → **930** | 140 → **1000** |
| Battle MaxEnergy | 120 | 100 | 80 (unchanged) |
| Attack multiplier | 1.00 → **1.20** | 1.15 → **1.10** | 0.90 → **0.95** |
| Defense (flat) | 2 → **0** | 4 → **0** | 10 → **0** |
| Dodge cost / cooldown | 18 / 4 s | 20 / 4 s | 20 / 4 s (unchanged) |
| Class ability | Blink Step 25 E / 12 s, 4 m, 0.2 s i-frames (unchanged) | Focus Shot 25 E / 12 s, +6 (unchanged) | Bulwark 30 E / 15 s, 25 absorb / 3 s (unchanged) |
| Energy regen | 5/s for all (unchanged) | | |

### Weapons

GDD values are kept except Influence Cannon.

| | Pulse Blade | Shadow Dagger | Titan Hammer | Influence Cannon |
|---|---|---|---|---|
| Basic damage / range / cycle | 18 / 2.2 m / 0.65 s | 12 / 1.5 m / 0.40 s | 32 / 2.5 m / 1.20 s (5 E) | 15 → **18** / 10 m / 0.80 s |
| Special damage / cost / cooldown | 26 / 25 / 8 s | 20 / 20 / 7 s | 36 / 35 / 12 s | 28 → **34** / 30 / 10 s |
| Wind-ups, recovery 0.35 s, geometry | unchanged | unchanged | unchanged | unchanged |

### Model assumptions (`duel_v2.py`)

- Both players are in range and attacking all the time ("active fighting").
- Hit rates: basic 50 %, special 40 %.
- The defender dodges an incoming special 60 % of the time and a basic 10 % of the time, if Dodge (or the Scout's Blink) is ready and affordable.
- Focus Shot is used whenever it is ready. Bulwark is used whenever it is ready and HP is under 90 %. A special is used when energy covers its cost plus a dodge reserve.
- Wind-up is assumed to be implemented.
- The damage formula follows the code: `round(max(base × atk × mult − def, 1))`, with Focus +6 added after.

### Median time to KO (seconds) and win rate, Pulse Blade (live weapon), n = 1000 per cell

| Matchup | Low skill (35/25 %) | **Typical (50/40 %)** | High skill (75/60 %) | Win % (typical) |
|---|---|---|---|---|
| Scout vs Scout | 76 | **53** (p10 46 / p90 60) | 35 | 50 / 50 |
| Scout vs Ranger | 81 | **57** | 38 | Scout 44 / Ranger 56 |
| Scout vs Titan | 101 | **70** | 46 | Scout 50 / Titan 50 |
| Ranger vs Ranger | 88 | **61** | 41 | 49 / 51 |
| Ranger vs Titan | 108 | **74** | 49 | Ranger 56 / Titan 44 |
| Titan vs Titan | 136 | **92** | 60 | 50 / 50 |

### Same-weapon matchups, typical skill (median s / first-named class win %)

| Weapon | SvS | SvR | SvT | RvR | RvT | TvT |
|---|---|---|---|---|---|---|
| Dagger | 54 | 58 / 39 % | 71 / 51 % | 62 | 75 / 58 % | 93 |
| Hammer | 51 | 56 / 59 % | 64 / 68 % | 60 | 70 / 55 % | 82 |
| Cannon | 60 | 64 / 39 % | 78 / 52 % | 69 | 83 / 58 % | 104 |

### Checks against the owner's brief

- **No cell is under 30 s or over 150 s at typical skill.** Typical medians run 51 to 104 s. High skill runs 34 to 67 s. The only cells above 150 s are Titan-mirror cells at low skill (Cannon median 154 s, Blade/Dagger p90 about 151-152 s). Sudden Death at 180 s and the 300 s cap cover them, and no simulated match reached the cap.
- **Titan is not dominant.** On Pulse Blade, Titan wins 50 % against Scout and 44 % against Ranger. Before this proposal (with the class base HP from commit 2e9fcbf), Titan won **100 %** against Scout and 93 % against Ranger, and fights lasted 5 to 12 s (`current_run.txt`).
- **The remaining gaps are 44-56 % on Blade**, and Hammer Scout vs Titan at 68 %. Most of the Hammer gap comes from rounding at small base values (for example 12 × 0.95 = 11.4 rounds to 11).
- **Weapon-versus-weapon balance is not solved, and does not need to be yet.** Loadouts do not exist, and the 1-D model gives Cannon no credit for its range.
  - Scout Blade vs Scout Cannon: 78 % for Blade.
  - Titan Hammer vs Scout Dagger: 24 % for Titan.
  - Re-tune these when loadouts exist and can be playtested.
  - When they do, run damage in integer tenths (HP × 10, damage × 10, shown ÷ 10) to remove the rounding asymmetry.

### Battle HP comes from the class table, not the player row

The host sets both avatars to full class HP and energy at Countdown. It stops using the Health/Energy the client sends in `RPC_SetProfile`. This:
- removes the cheat where a client sends any health it likes (earlier finding C14);
- removes the old MaxHealth mismatch;
- avoids a backfill of existing 100/100 player rows.

The DB `health`/`max_health` columns stay as the out-of-battle profile values. Aligning them to 840/930/1000 is optional (auth.service + migration 023 + tests), and is a separate owner decision.

---

## 3. Arena clamp

- Today **walking is unclamped**: `NetworkPlayerController.cs:327` (Fusion) and `:359` (stub).
- Dodge (`PlayerCombat.cs:705`) and Ground Break knockback (`PlayerCombat.cs:554`) are also unclamped.
- Only Shadow Lunge (`:505`) and Blink (`:627`) clamp, and they use a 15 m radius on a 15 × 15 m floor (Battle.unity ArenaFloor is a Plane scaled 1.5; spawns sit at z = ±6 around the origin).

Changes:

1. `Constants.cs:70`: `ArenaRadiusMeters = 15f` → `7f`. This is the inscribed circle of the 7.5 m half-width floor minus about 0.5 m of capsule. Spawns at ±6 stay inside. The doc comment there ("no arena dimension has ever been specified") should cite Battle System v1.0 §1, "15x15m arena", which is quoted in `env.js:73`.
2. `NetworkPlayerController.cs:327` (and stub `:359`):

   ```csharp
   NetworkedPosition += moveDirection * (moveSpeed * Runner.DeltaTime);
   // →
   NetworkedPosition = Nfouz.Combat.WeaponGeometry.ClampToArena(
       NetworkedPosition + moveDirection * (moveSpeed * Runner.DeltaTime),
       Vector3.zero, Constants.Battle.ArenaRadiusMeters);
   ```

   Both scripts are in the same `Nfouz.Runtime` assembly, so no asmdef change is needed. If MainMap also uses this prefab outside battle, apply the clamp only while a battle session is active (`BattleSession.HasActiveSession`).
3. `PlayerCombat.cs:705` Dodge: `transform.position += transform.forward * DodgeDistanceMeters;` → `transform.position = WeaponGeometry.ClampToArena(transform.position + transform.forward * Constants.Combat.DodgeDistanceMeters, Vector3.zero, Constants.Battle.ArenaRadiusMeters);`
4. `PlayerCombat.cs:554` knockback: the same `ClampToArena(...)` wrapper.
5. Update the doc comment on `WeaponGeometry.ClampToArena` (it says the other movement abilities "use unclamped offsets").

---

## 4. File-by-file change list

### Unity C#

| File:line | Old → New |
|---|---|
| `Scripts/Utils/Constants.cs:58` | `SessionMaxDurationSeconds = 90f` → `180f` |
| `Constants.cs:70` | `ArenaRadiusMeters = 15f` → `7f` (plus doc comment) |
| `Constants.cs:112` | `OvertimeSeconds = 30f` → `120f` (rename the comment to Sudden Death) |
| `Constants.cs:~114` (new) | `public const float SuddenDeathDamageMultiplier = 1.5f;` |
| `Constants.cs:~123` (new) | Class battle table: `ScoutMaxHealth = 840, RangerMaxHealth = 930, TitanMaxHealth = 1000` (energy 120/100/80), the single source for BattleManager |
| `Scripts/Combat/DamageCalculator.cs:41-43` | Attack multipliers 1.0 / 1.15 / 0.9 → **1.20 / 1.10 / 0.95** |
| `DamageCalculator.cs:54-56` | Defense 2 / 4 / 10 → **0 / 0 / 0** (formula and MinimumDamage kept) |
| `Scripts/Combat/WeaponDatabase.cs:166` | Influence Cannon `BaseDamage = 15` → `18` |
| `WeaponDatabase.cs:172` | Influence Cannon `SpecialDamage = 28` → `34` |
| `Scripts/Combat/PlayerCombat.cs` new property | `public float DamageMultiplier { get; set; } = 1f;` (set by BattleManager; reset in `Initialize` at :175-198) |
| `PlayerCombat.cs:393, 482, 512, 543` | The `1f,` weaponMultiplier argument → `DamageMultiplier,` |
| `PlayerCombat.cs:575-581` + `ChargedPulseProjectile.cs:105, 131` | **Bug fix:** Charged Pulse passes raw `SpecialDamage` (28) and skips the attack multiplier, defense and Sudden Death. Compute `DamageCalculator.CalculateDamage(SpecialDamage, atk, DamageMultiplier, def)` at hit time in the projectile, then call `ApplyDamageWithFocusShotBonus` |
| `PlayerCombat.cs:705, 554` | Arena clamp (§3) |
| `Scripts/Networking/NetworkPlayerController.cs:327, 359` | Arena clamp (§3) |
| `Scripts/Combat/BattleManager.cs:160-166` `HandleBattleTimeEnd` (body at :644-663) | Always call `_stateMachine.EnterOvertime()` at the end of the normal phase. Remove the health comparison there. `HandleOvertimeTimeEnd` (:669-688) stays as is (300 s cap → health % or Draw) |
| `BattleManager.cs:207-210` (Overtime case) | Remove `SetEnergyRegenEnabled(false)`. Add `SetDamageMultiplier(Constants.Combat.SuddenDeathDamageMultiplier)`, a new helper mirroring `SetEnergyRegenEnabled` (:215-226). Reset it to 1 in `CompleteMatch` (:700-702) |
| `BattleManager.cs:466-489` `InitializeCombatant` | Take max HP and energy from the class table for **both** avatars (drop the PlayerSession branch at :470-475). After `combat.Initialize(...)`, when `networkController.HasSimulationAuthority`, set `NetworkedHealth = maxHealth; NetworkedEnergy = maxEnergy;` |
| `BattleManager.cs:493-512` `GetClassBaseStats` | 80/120, 100/100, 140/80 → read the new Constants table (840/120, 930/100, 1000/80) |
| `BattleManager.cs:115` `ResolutionPollTimeoutSeconds = 20f + OvertimeSeconds` | Becomes 140 s automatically. Better: `20f + 10f` (countdown skew only); the client now ends on KO or on its own 300 s cap |
| `BattleManager.cs:714-715` (duration) | Unchanged; with the new constants it yields 0-300 |
| `Scripts/Networking/NetworkPlayerController.cs:235` | `RPC_SetProfile(class, session.Health, session.Energy)`: the host ignores the health and energy values (the BattleManager change above overwrites them). The signature can stay |
| `Scripts/UI/Screens/BattleScreen.cs:100-117` | Works unchanged (shows 180 → 0, then the Sudden Death banner with 120 → 0). Optional: show "الموت المفاجئ" (Sudden Death) on the banner |
| `Scripts/Combat/CombatStateMachine.cs:~95-110` | Doc comments only |

### Backend JS

| File:line | Old → New |
|---|---|
| `backend/src/config/env.js:87` | `BATTLE_SESSION_MAX_DURATION_SECONDS` 90 → 300 |
| `env.js:107` | `COMBAT_RULES_VERSION` '6.1.0' → '7.0.0' |
| `env.js:110` | `RESULT_MAX_DURATION_SECONDS` 130 → 310 (comment "180 s Battle + 120 s Sudden Death + buffer") |
| `env.js:111` | `RESULT_MAX_PLAUSIBLE_HEALTH` 500 → 2000 |
| `env.js:125` | `RESULT_SUSPICIOUS_MIN_DURATION_SECONDS` 2 → 15 |
| `env.js:126` | `RESULT_SUSPICIOUS_DURATION_SECONDS` 125 → 305 |
| `env.js:127` | `RESULT_SUSPICIOUS_HEALTH_THRESHOLD` 160 → 1001 (and the comment: Titan 1000) |
| `backend/.env.example:36, 46, 49, 50, 54, 55, 56` | Same values as above |
| `backend/src/utils/battleLifecycle.js:23` | Comment 298 → 478 |
| `backend/src/services/battle.service.js:46-51, 453-462` | Doc comments only (no logic change) |
| `backend/src/services/auth.service.js:9-15` | `CLASS_BASE_STATS` unchanged, unless the owner also approves the profile alignment (then 840/120, 930/100, 1000/80, plus a migration `023_class_battle_stats.sql` to backfill `max_health`/`health`) |
| `backend/migrations/008_items.sql:19, 21` | Stale descriptions ("high critical chance", "draining battle influence"). Copy fix only |

### Tests that must change

**Backend:**
- `backend/tests/battle.test.js:531`: `noResultCutoffSeconds: 298` → `478`.
- `backend/tests/battle.lifecycle.test.js:39`: `LIMITS = { …, noResultCutoffSeconds: 298 }` → `478`. The :51-53 case passes its own config and is unaffected.
- `backend/tests/contract/db/battleLifecycle.dbtest.js:129-130`: 298 → 478.
- `backend/tests/battle.resolve.test.js`:
  - :373-401: the 1 s pending case still passes (1 < 15); update the comment at :382.
  - :403-421: `attacker_final_health: 200` would now be **resolved**, not pending. Change it to `1200` (above 1001, below 2000).
  - :423-441: `duration_seconds: 127` would now resolve. Change it to `307` (between 305 and the 310 hard cap).
  - Add one case: `duration_seconds: 300` with `outcome: 'draw'` resolves as a draw (the cap result).
  - The baseline `duration_seconds: 42` (:91) stays valid (above 15).
- Any test that relies on the `6.1.0` env default (`battle.repository.test.js:51, 61`, `battleResultSignature.test.js:10`) passes its own value. Re-run to confirm.
- `backend/tests/auth.test.js:139-141` changes only if the profile alignment is approved.

**Unity EditMode** (`Assets/_Project/Tests/EditMode`):
- `DamageCalculatorTests.cs`:
  - :73-75 attack multiplier TestCases → 1.2 / 1.1 / 0.95.
  - :81-83 defense TestCases → 0 / 0 / 0.
  - :27-71 pass literal multipliers and defenses, so they still pass. Update their names and comments (e.g. "TitanHammerVsRanger"), or switch them to table lookups.
- `WeaponDatabaseTests.cs:110` 15 → 18 and `:122` 28 → 34.
- `PlayerCombatTests.cs:275`: 176 → 169 (26 × 1.2 = 31.2 → 31); update the comment at :273-274.
- `PlayerCombatTests.cs:462-480` (Lunge clamp) still passes with radius 7.
- `BattleManagerTests.cs`: `CompareHealthPercentages` is unchanged.
- New tests:
  - walking, Dodge and knockback are clamped to `ArenaRadiusMeters`;
  - `HandleBattleTimeEnd` always enters Overtime;
  - damage ×1.5 while `DamageMultiplier` is 1.5;
  - Charged Pulse damage uses the formula;
  - InitializeCombatant sets full class HP and energy.

**Unity PlayMode** (`Assets/_Project/Tests/PlayMode`):
- `PlayerCombatTests.cs:190`: `200 - 25` → `200 - 26` (18 × 1.1 = 19.8 → 20, + 6); update the comment at :186-189.
- `CombatStateMachineTests.cs` is unchanged.

---

## 5. Risks and dependencies

1. **The fight length assumes wind-up is implemented** and dodges are skill-based. Without wind-up, dodge-on-special drops, which makes fights about 5 % shorter. Balance holds because it applies to both sides.
2. **The host advantage grows with fight length**, because the defender has input latency for 60-90 s instead of 5 s. A dedicated server remains the real fix.
3. **New feedback becomes essential:** an opponent HP bar, hit flashes and cooldown fills. A 60 s fight with no visible opponent HP is unreadable. These are new systems and need owner scoping.
4. **Phone tap fatigue:** about 90 basic presses per minute at the 0.65 s cycle. Consider letting a held button repeat basics, which is a new input rule needing owner approval.
5. Only Pulse Blade is balanced. Weapon balance waits for loadouts.
