# Sprint 8 Critical Security Patch

Scope: fixes the two Critical findings from the Sprint 8 Final Audit — the missing rescue-eligibility check and the client-authoritative Guard Battle outcome — plus the required tests, real-execution verification, and packaging. No new features, no redesign of existing systems, no Sprint 9 work.

## 1. Rescue authorization (`POST /rescue/accept`, `GET /sos/:sosId`)

**New: `friend.service.js#assertEligibleRescueFriendship(playerIdA, playerIdB, executor)`** — the one eligibility gate now shared by both endpoints:
1. Either side blocked → `PLAYER_BLOCKED` (403)
2. No accepted friendship at all → `NOT_ELIGIBLE_FRIEND` (403)
3. Accepted friendship younger than `SOS_FRIENDSHIP_MIN_AGE_HOURS` (24h) → `FRIENDSHIP_TOO_NEW` (403)

**`rescue.service.js#acceptMission`** now calls this inside the same SOS-row-locked transaction, right after the self-rescue check and before any mission-state work — an ineligible caller never creates a reservation.

**`sos.controller.js`/`sos.service.js`** — new `assertCanViewSos(sos, viewerId)`: the SOS owner, the recorded `rescuer_id`, or an eligible friend of the owner may view it; everyone else gets 403. This closes the IDOR: knowing/guessing a `sos_id` is no longer sufficient to read another player's SOS record.

**Identity** was already resolved exclusively from the verified Firebase token (`resolveSelf(req)` in both controllers) — never from a request body/param — so this requirement was already satisfied and is unchanged.

## 2. Rescue battle authority (`POST /rescue/:missionId/guard-battle/start` and `.../resolve`)

The server, not the client, now decides who wins. Reimplementing the client's real-time combat (`RescueGuardCombat.cs`) server-side would be a full redesign of an already-built system, which this patch is explicitly scoped not to do — see `env.js`'s `RESCUE_GUARD_BATTLE_SUCCESS_PROBABILITY` doc comment for the honest reasoning. Instead:

- **`startGuardBattle`** now rolls the **authoritative** outcome itself (a server-side coin flip, `RESCUE_GUARD_BATTLE_SUCCESS_PROBABILITY`, default 65%) and generates a one-time `guard_battle_token` (24 random bytes), storing both on the mission. The token — but never the outcome — is returned to the client.
- **`resolveGuardBattle`** requires the token to match the mission's stored one (`INVALID_GUARD_BATTLE_TOKEN` otherwise, no state change — **replay/duplicate protection**). The client's reported `outcome` is recorded for audit but **never** used to decide success/failure — `mission.guard_battle_outcome` (decided at start time) always wins. A mismatch between the two is logged as a suspicious-result signal (**suspicious-result handling**) and persisted (`reported_outcome`, `outcome_mismatch` columns) for later anti-cheat review.
- The pre-existing atomic `status = 'in_progress'` guard on `succeedMission`/`failMission` (proven airtight in the prior audit) is now further reinforced by the token check, closing the resolve path at two independent layers.

**Migration 017** (never applied anywhere — confirmed by its own header, corrected in place per established precedent) gained: `guard_battle_token`, `guard_battle_outcome`, `reported_outcome`, `outcome_mismatch` on `rescue_missions`.

**Unity client** (`SocialModels.cs`, `RescueMissionController.cs`, `Constants.cs`) updated to carry the token end-to-end and to describe the three new error codes (`NOT_ELIGIBLE_FRIEND`, `FRIENDSHIP_TOO_NEW`, `INVALID_GUARD_BATTLE_TOKEN`) in Arabic — without this the patched backend would silently break the existing client flow.

## 3. Tests

Added to `friend.service.test.js`, `sos.service.test.js`, and `rescue.service.test.js` (Jest specs — could not be executed; see Verification below):

- Unauthorized rescue / Fake SOS ID access (no relationship at all)
- Friendship age bypass (< 24h)
- Block bypass (either direction)
- Forged rescue success (client claims success, server had rolled failure)
- Duplicate rescue success (resolving an already-terminal mission)
- Replay attacks (stale/forged/missing `guard_battle_token`)

Pre-existing `rescue.service.test.js` tests were updated for the new `startGuardBattle`/`succeedMission`/`failMission` call signatures and the friendship-gate mock (defaulted to "eligible" so every previously-passing test keeps passing unchanged).

## 4. Verification

**Jest/PostgreSQL could not be run** — this sandbox has no `node_modules` and no network access to the npm registry (same limitation as every prior pass in this engagement). Instead, three new real-execution proof scripts (same `Module._load`-injection technique used throughout this engagement) run the **actual, unmodified** patched source end-to-end:

| Script | Scenarios | Result |
|---|---|---|
| `verify_friend_eligibility_real.js` | stranger / pending-only / too-new / blocked (both directions) / eligible | **6/6 passed** |
| `verify_guard_battle_authority_real.js` | accept-gate (unauthorized/age/block/eligible), token freshness, forged success, legitimate success, replay, missing token, duplicate resolve, DB-race null-return | **11/11 passed** |
| `verify_sos_idor_real.js` | stranger, owner, rescuer, eligible friend, the IDOR itself | **5/5 passed** |

The **pre-existing** `verify_sprint8_real.js` harness (built in the prior audit/correction passes) was updated to seed eligible friendships and thread guard-battle tokens through every rescue scenario it already covered, then re-run in full: **22/22 still passing** — confirming this patch introduces no regression in anything previously verified (friends, SOS, control relationships, devices, FCM, transaction rollback, etc.).

**Total: 44/44 real-execution scenarios passing.** `node -c` syntax-checked on every touched backend file; brace/paren balance checked on every touched Unity file (no Unity compiler available in this sandbox).

## 5. Packaging

`NFOUZ_Sprint8_SecurityPatch.zip` created from the current repository (excluding `node_modules`/`.git`/`*.zip`), integrity-verified with `unzip -t` (no errors). The three prior zips (`NFOUZ_Sprint7_Repository.zip`, `NFOUZ_Sprint8_Repository.zip`, `NFOUZ_Sprint8_FinalCorrection.zip`) are untouched — same sizes and timestamps as before this patch.

---

**Stopping here per the instruction.** No Sprint 9 work, no Inventory/Quest implementation, no further changes. Waiting for approval.
