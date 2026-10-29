# NFOUZ backend — Backend/Security council review (2026-10-29)

Branch `claude/sprint-5-photon-multiplayer-5jv8v2`, read-only review of `backend/` (routes, controllers,
services, repositories, migrations 001–022, middleware, env) plus Unity call sites in
`Assets/_Project/Scripts`. Baseline: `cd backend && npx jest --runInBand` → **34 suites / 475 tests pass**.
Nothing in the repo was edited. Verification scripts (stubbed DB, no repo changes) are in
a cloud scratchpad (not kept) (`v1.js` block bypass,
`v2.js` instant resolve). I could not start a real PostgreSQL in this sandbox (permissions), so SQL-level
findings are verified by reading the exact statements, and by emulating them where noted.

Secrets: no real credential is tracked. `backend/.env.example` and `backend/src/config/env.js` hold only
placeholder/test values, and `backend/docker-compose.yml` holds a local-dev DB password bound to 127.0.0.1.
`.gitignore` covers `.env*`, Firebase configs and `backend/logs/`. No log line prints tokens, the HMAC secret or FCM tokens.

**Checked and OK (no change needed):** all SQL is parameterized (the only dynamic SQL is column names picked
by fixed ternaries in `battle.repository.js`). Every "act as me" route resolves the player from the Firebase
uid (`assertOwnPlayerId`, `resolveSide`, `rescuer_id` checks, `assertCanViewSos`). `host_authority_secret` and
`match_nonce` appear only in the attacker's `POST /battle/challenge` response. Accept, decline, expiry, resolve
and forfeit are each one guarded `UPDATE ... WHERE status='in_progress'`. Challenge creation is serialized by
advisory locks. Quest claim uses a guarded `is_claimed=FALSE` update in one transaction. Inventory has a
transactional idempotency table. Rescue reward caps run under an advisory lock. The guard-battle outcome is
rolled server-side and the token is single-use. A hidden, fast-moving or blocked player is excluded from nearby
in SQL. **Unity ↔ backend:** all 39 Unity call sites (`grep '"/player|/battle|...'`) map to existing routes.
The client never calls `POST /friends/unblock` or `/player/:id/devices/deactivate-all` (see L11).

Legend: **[SMALL-SAFE]** = small change, safe to apply now with the unit test named. **[NEEDS DECISION]** =
changes approved behaviour or data, so the owner or the GDD must decide first.

---

## HIGH

### H1. A blocked player can erase the block placed on them — [SMALL-SAFE]
`backend/src/repositories/friend.repository.js:129-139` (`blockPlayer`), reached via `POST /friends/block`
(`friend.service.js` `blockPlayer`, which has no "am I blocked" check).

- `blockPlayer` first runs
  `DELETE FROM friendships WHERE (player_id=$1 AND friend_id=$2) OR (player_id=$2 AND friend_id=$1)`.
  There is no `status` filter, so it also deletes the *other* player's `blocked` row.
- **Scenario:**
  1. Victim A blocks harasser V. The row (A,V,'blocked') exists.
  2. V calls `POST /friends/block {player_id: A}`. This deletes A's block and inserts (V,A,'blocked').
  3. V calls `POST /friends/unblock {player_id: A}`. Zero rows remain.
  4. V can now see A in `/player/nearby` (exact coordinates within 50 m), challenge A and friend-request A.
  - Reproduced: `scratchpad/verify/v1.js` prints `blocked? true` and then `blocked? false rows: 0`.
- **Fix** (the PK `(player_id, friend_id)` allows both directions to be blocked at once):
  ```js
  await executor.query(
    `DELETE FROM friendships
     WHERE ((player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1))
       AND status <> 'blocked'`, [blockerId, blockedId]);
  const result = await executor.query(
    `INSERT INTO friendships (player_id, friend_id, status) VALUES ($1, $2, 'blocked')
     ON CONFLICT (player_id, friend_id) DO UPDATE SET status = 'blocked', updated_at = now()
     RETURNING *`, [blockerId, blockedId]);
  ```
  Every reader already copes with two rows per pair: `isBlockedEitherDirection`, the nearby `NOT EXISTS`,
  `getSosNotificationCandidates`, and `unblockPlayer` (which deletes only the caller's own row).
- **Test:**
  - Unit: a repository test asserting that the DELETE contains `status <> 'blocked'` and that the INSERT has
    `ON CONFLICT`.
  - Real DB: add "A blocks V; V blocks A; V unblocks A ⇒ isBlockedEitherDirection(A,V) is true" to
    `tests/contract/db/inputRobustness.dbtest.js`, and run it on the laptop.

### H2. Every class is stored with 100 HP / 100 energy, so host and client disagree on HP — [SMALL-SAFE code] + [NEEDS DECISION backfill]
`backend/src/repositories/player.repository.js:46-54` (`create` inserts only uid/username/class),
`backend/src/services/auth.service.js:38`, `backend/migrations/002_players.sql:12-16` (defaults are 100).

- Unity's approved class stats (`Assets/_Project/Scripts/Combat/BattleManager.cs:475-496`
  `GetClassBaseStats`) are Scout 80/120, Ranger 100/100 and Titan 140/80.
- `BattleManager.cs:452-460` takes the **local** player's max health from `PlayerSession.MaxHealth`, which
  is the server's 100. The **remote** player's max health comes from the class table.
- **Scenario:** a Scout host fights as 100 HP on its own (authoritative) simulation, while the Titan
  defender's client shows the Scout at 80. The Titan host fights as 100 HP instead of 140.
  - Results are signed from the host's numbers, so the stat error reaches Influence and Control.
  - HUD/Profile also show 100/100 for every class (`HUDController.cs:83`, `MainMapScreen.cs:89`).
- **Fix:** add the per-class table to the backend, and insert it at registration:
  ```js
  // auth.service.js
  const CLASS_BASE_STATS = { Scout: { health: 80, energy: 120 }, Ranger: { health: 100, energy: 100 }, Titan: { health: 140, energy: 80 } };
  // player.repository.js create({ firebaseUid, username, classType, health, energy })
  `INSERT INTO players (firebase_uid, username, class_type, health, max_health, energy, max_energy)
   VALUES ($1, $2, $3, $4, $4, $5, $5) RETURNING *`
  ```
  - Test: `tests/auth.test.js`, "registering a Titan stores max_health 140 / max_energy 80" (mock `create`
    and assert its arguments), plus the matching Scout case.
- **[NEEDS DECISION]** Existing rows need a backfill migration (data change on the laptop DB):
  `UPDATE players SET max_health = CASE class_type WHEN 'Scout' THEN 80 WHEN 'Titan' THEN 140 ELSE 100 END, health = LEAST(health, ...) ...`.
- Once stored stats are right, the result check can use them: see L8.

### H3. Leaving or "disconnecting" erases a loss; the host is even recorded as the leaver — [NEEDS DECISION]
`backend/src/services/battle.service.js:371-384` (`handleDisconnect`: allowed any time after accept),
`backend/src/repositories/battle.repository.js:216-243` (`expireStaleBattles`: forfeit = status only, no
winner, no Influence/Control), `battle.service.js:509` (resolve on a forfeited battle → `SESSION_EXPIRED`).

- **Scenario A (no modified client needed):** the defender is losing and kills the app.
  - The Photon host sees the leave, and `PhotonRoomLifecycle.HandlePlayerDisconnected`
    (`PhotonRoomLifecycle.cs:297-305`) posts `/battle/{id}/disconnect` with the **host's own** token
    (item 35 open issue).
  - The server therefore records the **attacker** as disconnected, and after 15 s the battle is
    `forfeited_by = attacker`.
  - The host's signed win, if it is ever sent, gets `SESSION_EXPIRED`. The loser escapes Control (the core
    penalty), and the record blames the winner.
- **Scenario B:** a losing defender calls `POST /battle/{id}/disconnect` mid-match. The battle is forfeited
  15 s later, before the host's end-of-match result arrives.
- **Fix options** (they change approved Sprint 5 semantics, "forfeit = session state only", so they need the
  GDD or the owner):
  1. Once both players were ready, treat a forfeit as a decisive loss for `forfeited_by`. Run the same
     Influence/Control block as `resolveBattle` in the `expireStaleBattles` transaction, or in a follow-up
     `applyForfeitOutcome(battle)` called by `getBattleById` when the cleanup returns forfeited rows.
  2. Let only the host report the *opponent's* leave:
     - `POST /battle/:id/disconnect` takes an optional `{ "side": "opponent" }`, accepted only when
       `callerId === battle.host_player_id`, and records the other side.
     - Otherwise the caller's own side is recorded, as now.
     - The Unity host then sends `side: "opponent"` from `HandlePlayerDisconnected`. This is a contract
       change, so it needs a new scenario in `tests/contract/scenarios.js`.
- Until a decision is made, also fix the client so that the host never posts its own `/disconnect` for the
  other player's leave (item 35).

---

## MEDIUM

### M1. A signed result is accepted immediately after accept, with nobody ready and no match played — [SMALL-SAFE, fixture updates]
`backend/src/services/battle.service.js:505-563` (only `assertAccepted` at :512, and `duration_seconds` is
never compared with server wall-clock time).

- **Scenario:** the attacker (host) receives the secret in the challenge response. The moment
  `challenge_state` reads `accepted`, it posts a signed `attacker_win` with `duration_seconds: 5` and
  defender health 0.
  - It resolves, and the defender is Controlled for 120 min.
  - Reproduced: `scratchpad/verify/v2.js` prints `attacker_win loser_controlled_until set: true` with
    `attacker_ready=false, defender_ready=false, accepted_at=now`.
  - This is within the accepted Alpha host-authority debt, but the check costs nothing and binds the claim to
    server-observed time.
- **Fix** (after the event_seq check, inside `resolveBattle`):
  ```js
  if (!battle.attacker_ready || !battle.defender_ready) {
    throw new ApiError('INVALID_RESOLUTION', 'Both players must be ready before a result is accepted.', 409);
  }
  const acceptedMs = new Date(battle.accepted_at).getTime();
  const serverElapsed = (Date.now() - acceptedMs) / 1000;
  if (issuedAtMs < acceptedMs - env.RESULT_MAX_CLOCK_SKEW_SECONDS * 1000 ||
      durationSeconds > serverElapsed - env.BATTLE_COUNTDOWN_SECONDS + env.RESULT_MAX_CLOCK_SKEW_SECONDS) {
    throw new ApiError('INVALID_RESOLUTION', 'Result duration is longer than the time since the challenge was accepted.', 400);
  }
  ```
- **Safe for honest play:** a battle that is not both-ready 30 s after accept is already cancelled by the
  ready timeout. An honest match always lasts at least countdown + duration after accept.
- **Tests:** `tests/battle.resolve.test.js`:
  - reject when either side is not ready;
  - reject when duration > elapsed;
  - accept an honest timing.
  - Existing fixtures and the contract world need `attacker_ready/defender_ready: true` and an older
    `accepted_at`.

### M2. GPS teleport bypasses the driving stop: about 5 km per minute, and a challenge right away — [NEEDS DECISION]
`backend/src/utils/playerSafety.js:32` (an update more than `SAFETY_FAST_MOVEMENT_MAX_GAP_SECONDS`=60 s after
the last one is never flagged), `backend/src/services/location.service.js:37-56` (only the 300 km/h cap applies).

- **Scenario:** a spoofer waits 61 s and PATCHes a point 4.99 km away. The update is accepted (295 km/h), and
  `fast_movement_at` stays NULL.
  - The stored location is fresh, so they can challenge anyone within 20 m of the new point immediately.
  - Repeating this gives remote reach across a city in minutes. Verified with
    `isRealisticSpeed`/`looksLikeDriving`: `speed ok: true, flagged driving: false, jump m: 4994`.
- **Fix options:**
  - (a) Apply the long-gap exemption only when the previous fix is already stale
    (`elapsed > NEARBY_ONLINE_THRESHOLD_SECONDS`). Within the online window, any implied speed above
    `SAFETY_MAX_PLAY_SPEED_KMH` over more than 30 m sets `fast_movement_at`.
  - (b) Additionally, after a jump of more than X m from a stale fix, set `fast_movement_at`. This gives a
    120 s cooldown before challenge eligibility.
- Either option changes the approved driving-stop behaviour. Test: `tests/playerSafety.test.js`.

### M3. Far players' `distance_meters` is computed from exact positions, which allows trilateration — [SMALL-SAFE]
`backend/src/services/location.service.js:141-169`.

- Players farther than 50 m are given a ~110 m grid cell. But `distance_meters` is
  `ceil(exactDistance/50)*50` from the requester's exact stored point, and the list is sorted by exact distance.
- **Scenario:** a stalker queries from 3 stored points (each move is allowed within the 300 km/h cap) and
  intersects the 50 m annuli. This narrows a stranger to tens of meters without ever coming within 50 m.
- **Fix:** derive the coarse distance only from coarse data:
  ```js
  const coarseLat = coarseCellCentre(row.last_lat), coarseLng = coarseCellCentre(row.last_lng);
  const coarseDistance = haversineDistanceMeters(coarseCellCentre(centreLat), coarseCellCentre(centreLng), coarseLat, coarseLng);
  distance_meters: exact ? distance : Math.max(COARSE_DISTANCE_STEP_METERS, Math.ceil(coarseDistance / COARSE_DISTANCE_STEP_METERS) * COARSE_DISTANCE_STEP_METERS),
  ```
  - Sort non-exact entries by that coarse distance too.
  - Test: `tests/nearbyPlayers.test.js`. Two targets in the same cell at different exact distances must get an
    identical `distance_meters`.
- **[NEEDS DECISION]** The 50 m exact radius is wider than the 20 m challenge range. Consider
  `BATTLE_MAX_CHALLENGE_DISTANCE_METERS + 10`.

### M4. After an account switch on one phone, pushes never arrive (`FCM_TOKEN_CONFLICT` forever) — [SMALL-SAFE]
`backend/src/repositories/playerDevice.repository.js:39-42`.

- Sign-out deactivates the device row but keeps `fcm_token` owned by player A (the unique index is global).
- **Scenario:** A signs out, B signs in on the same phone, and `PATCH /player/B/fcm-token` with the same
  token answers 409. B never gets SOS or rescue pushes. This is likely on the single test phone.
- **Fix:** only an **active** registration blocks reuse. An inactive one moves:
  ```js
  const owner = (await executor.query(`SELECT player_id, is_active FROM player_devices WHERE fcm_token = $1`, [fcmToken])).rows[0];
  if (owner && owner.player_id !== playerId) {
    if (owner.is_active) throw new TokenOwnedByAnotherPlayerError();
    await executor.query(`DELETE FROM player_devices WHERE fcm_token = $1 AND is_active = FALSE AND player_id <> $2`, [fcmToken, playerId]);
  }
  ```
  - Test: `tests/playerDevice.repository.test.js`. An inactive foreign owner is reassigned; an active one
    still gives 409.

### M5. Quest progress runs on a second pool connection inside the battle transaction — [SMALL-SAFE]
`backend/src/services/battle.service.js:727-731` (inside `db.withTransaction` at :621).

- `questService.recordProgress` uses the shared pool, not `client`.
- **Scenario 1:** with `DATABASE_POOL_MAX`=10 concurrent resolves, every transaction holds a client and waits
  for an 11th. Each stalls 5 s (`connectionTimeoutMillis`), and win progress is silently lost.
- **Scenario 2:** if COMMIT fails, the "win 2 battles" progress was already written for a battle that never
  resolved. The comment there says "already-committed", but nothing has been committed at that point.
- **Fix:**
  - Return `{ response, questWinnerId }` from the transaction callback, and call
    `questService.recordProgress(questWinnerId, 'win_battles', 1)` after `withTransaction` resolves.
    `rescue.service.js:465-474` already does this.
  - Test: `tests/battle.resolve.test.js`. Make the mocked `withTransaction` reject after `fn` and assert that
    `recordProgress` was not called.

### M6. Most mutating endpoints have no rate limit — [SMALL-SAFE]
`backend/src/routes/*.js`.

- Limited today: location, nearby, challenge, incoming, accept/decline, friend request, SOS create.
- Unlimited: `/auth/register`, `/battle/:id/{ready,disconnect,reconnect,resolve}`,
  `/friends/{accept,decline,block,unblock}`, `DELETE /friends/:id`, `/inventory/*`, `/quests/*`,
  `/rescue/*`, `GET /sos/:id`, and `/player/:id/{visibility,fcm-token,devices/*}`.
- **Scenario:** a script hammers `/rescue/:id/guard-battle/resolve`, or calls `/friends/block`/`unblock`
  thousands of times a second (each block is a transaction). Every call is a token verify plus several
  queries, and the pool has 10 connections.
- **Fix:**
  - Add `const generalLimiter = rateLimit({ windowMs: 10_000, max: 40, keyGenerator: keyByFirebaseUid, ... })`
    in `rateLimit.middleware.js`.
  - Mount it in each router right after `verifyFirebaseToken`, or once as
    `app.use((req,res,next)=> req.firebaseUid ? generalLimiter(req,res,next) : next())`, which only works
    after auth, so per router is simpler.
  - GET `/battle/:id` is polled every 1.5 s, and 40 per 10 s leaves room for that.
  - Add it to `tests/contract/rateLimitStub.js`.

### M7. Registration race gives a 500; username uniqueness is case-insensitive in code only — [SMALL-SAFE] + [NEEDS DECISION index]
`backend/src/services/auth.service.js:15-38`, `backend/migrations/002_players.sql:7-8`.

- `registerPlayer` checks, then inserts.
- **Scenario 1:** a double-tapped Register, or two installs racing, hits `players_firebase_uid_key` /
  `players_username_key`. The 23505 error becomes 500 `INTERNAL_ERROR`, and Onboarding shows a generic error.
- **Scenario 2:** "Admin" and "admin" registered concurrently both pass `getByUsername` (lower), and the DB
  UNIQUE is case-sensitive.
- **Fix:**
  ```js
  try { player = await playerRepo.create(...); }
  catch (err) {
    if (err.code === '23505' && err.constraint === 'players_firebase_uid_key') throw new ApiError('PLAYER_ALREADY_REGISTERED', 'This account is already registered.', 409);
    if (err.code === '23505' && /username/.test(err.constraint || '')) throw new ApiError('USERNAME_TAKEN', 'This username is already taken.', 409);
    throw err;
  }
  ```
  - Test: `tests/auth.test.js`, with mocked `create` throwing each constraint.
- **[NEEDS DECISION]** New migration `CREATE UNIQUE INDEX uniq_players_username_lower ON players (lower(username));`.
  Check the laptop DB for case-duplicates first.

---

## LOW

- **L1. Friend request double-tap gives a 500; opposite simultaneous requests give two pending rows.**
  `friend.service.js:95-133`, `friend.repository.js:37-45`.
  - The PK violation is a 500, and both directions can be pending at once. Accepting one leaves the other,
    which can later produce a second `accepted` row (the friend is counted twice towards the 100 limit).
  - Fix: `ON CONFLICT (player_id, friend_id) DO NOTHING RETURNING *`, then re-read and return the existing
    row. Run `sendFriendRequest` in `withTransaction` with
    `pg_advisory_xact_lock(hashtextextended('friend:'||least(a,b)||greatest(a,b),0))`. [SMALL-SAFE]
- **L2. `withTransaction` mishandles a failed ROLLBACK.** `backend/src/config/database.js:67-80`.
  - If ROLLBACK throws (connection lost), its error replaces the real one, and a broken client is
    `release()`d back into the pool.
  - Fix: `catch (err) { try { await client.query('ROLLBACK'); } catch (rb) { broken = rb; } throw err; } finally { client.release(broken); }`.
  - Test: `tests/database.transaction.test.js`. [SMALL-SAFE]
- **L3. `event_seq` above int4 gives a 500.** `battle.service.js:550-553` and `last_event_seq INTEGER`
  (`014_battle_result_authority.sql`).
  - Add `|| eventSeq > 2147483647` to the existing `DUPLICATE_RESULT`/`INVALID_RESOLUTION` check. It is the same
    class of bug as the fractional-meters one.
  - Unity always sends 1 (`BattleManager.cs:105`), so the replay guard is effectively the status guard plus
    the nonce. [SMALL-SAFE]
- **L4. `pending_review_reasons` tells a cheating host the exact thresholds.** `battle.service.js:645`.
  - It sends lines such as "duration ... within the suspicious range".
  - Log the reasons server-side and return only `result: 'pending_review'`. Unity reads only `result`,
    but check the contract allowlist. [SMALL-SAFE]
- **L5. Rescue success does not re-check its preconditions inside the transaction.** `rescue.service.js:313-314`.
  - `markRescued`'s null return is ignored, and the target's live Control is not re-checked.
  - Also, `battle.service.js:689` `releaseOutgoingControl` frees captives without closing their open SOS.
  - Scenario: the controller loses a battle while a guard battle is running. The target is already free, yet
    the success path grants 30 min Protection, 50 credits and 80 XP.
  - Fix: inside the transaction, `const target = await playerRepo.getById(targetPlayerId, client)`. If it is
    not controlled, or `markRescued` returns null, then `failMission(..., 'target_no_longer_controlled')` with
    no reward. [SMALL-SAFE]
- **L6. "Walk 500 m" progresses while driving and from GPS jitter.** `location.service.js:59-70`.
  - Skip `recordProgress` when `fastMovementAt` is set, which is consistent with the driving stop.
  - Optionally ignore moves under ~5 m per update. [SMALL-SAFE, minor behaviour change]
- **L7. Quest coins bypass the Control 20% deduction.** `quest.service.js:123` credits directly.
  - `creditsService.applyEligibleIncome` names "a quest reward" as its intended caller, but nothing calls it.
  - GDD question: is a quest reward eligible income? [NEEDS DECISION]
- **L8. The health anomaly check is coarse.** `battle.service.js:464-481`.
  - The suspicious threshold is 160 for everyone. After H2, compare each `*_final_health` with that player's
    stored `max_health` (fetch both rows), and mark a larger value `pending_review`. [SMALL after H2]
- **L9. Revoked or disabled Firebase accounts keep API access until the token expires (≤1 h).** `config/firebase.js:58`.
  - Consider `verifyIdToken(idToken, true)` (one extra network call per request), or caching.
- **L10. A pending challenge locks the defender for 30 s and can be repeated.** `inventory.service.js:73-80`
  and `battle.repository.js:19-29` (pending counts as active).
  - The defender cannot use or equip items, and cannot challenge anyone else.
  - A griefer within 20 m can re-challenge right after each decline (2 per 5 s). Blocking stops it.
  - Optional per-pair cooldown after a decline. [NEEDS DECISION]
- **L11. Client gaps (not backend bugs).**
  - Unity has no `/friends/unblock` call, so a block cannot be undone in the app.
  - `deactivate-all` is unused.
  - No endpoint lists the caller's blocked players.
- **L12. Session writes are not guarded by status.** `battle.repository.js:97-138` (`setPlayerReady`,
  `recordDisconnect`, `clearDisconnect`).
  - These update by `battle_id` only, so a late call can write to an already resolved or forfeited row (race
    with `getBattleById`). It is harmless state noise.
  - Add `AND status = 'in_progress'` and treat null as `SESSION_EXPIRED`. [SMALL-SAFE]
- **L13. Location coercion.** `player.controller.js:23-24`.
  - `Number(null)`, `Number("")` and `Number([])` are 0, so a buggy first update stores (0,0).
  - Require `typeof === 'number'` or a numeric string before `Number()`. [SMALL-SAFE]
- **L14. Production DB TLS.** `config/database.js:15`: `rejectUnauthorized: false` when `DATABASE_SSL=true`.
  Use the provider CA before any hosted deployment.
- **L15. A controller can be the rescuer of its own captive.** That requires a ≥24 h friendship. Farming is
  bounded by 3 rewards per day and a 24 h cooldown per target.
  - Decide whether `rescuerId === sos target's controller_id` should be rejected. [NEEDS DECISION]
- **L16. Plain HTTP in development carries `host_authority_secret`.** Device tests use LAN HTTP. Ensure
  production builds point at HTTPS only.

---

## Suggested order (small, safe, each with a unit test)
1. H1, the block bypass: 2 SQL statements.
2. M5: move quest progress out of the transaction.
3. M7: map 23505 to 409.
4. M4: FCM token reassignment.
5. M3: coarse distance.
6. L2, L3, L4, L12, L13.
7. M1: both-ready plus wall-clock check (needs fixture updates).
8. H2 code part: class stats at register, then the backfill after approval.

H3, M2, L7, L10, L15 and the H2 backfill need the owner/GDD before any code.
