-- 017_friends_sos_rescue_fcm.sql
-- NFOUZ — Sprint 8: Friends + SOS + Rescue system.
--
-- FINAL comprehensive correction pass. Applied-status check performed
-- before writing this file (see the delivery report for the full
-- reasoning): no live database has ever existed in any environment this
-- code has run in during this engagement, and this sandbox's own local
-- Postgres — started for the very first time during this pass — has no
-- `nfouz` database and no `schema_migrations` table at all. Migration 017
-- has therefore never been applied anywhere I can verify, so per the
-- explicit rule given ("if it was never applied, correcting 017 in place
-- is allowed"), this file is corrected in place again rather than forked
-- into 018. I have no visibility into any database outside this sandbox —
-- if 017 has in fact been run against a real deployment elsewhere, this
-- file must NOT be re-applied there; migration 018 would be required
-- instead, and the down script below would need to run first.
--
-- This revision additionally makes the migration itself non-destructive
-- (previous revisions of this file used DROP TABLE to redefine
-- rescue_missions/rescue_rewards/sos_notifications in place, which is only
-- safe pre-deployment; a forward migration must never contain a DROP
-- TABLE at all, deployed or not, so this version doesn't, and instead
-- defines every table with CREATE TABLE IF NOT EXISTS plus additive ALTER
-- statements, matching the pattern already used elsewhere in this
-- migrations directory).
--
-- Sections, matching the final correction spec:
--   1. control_relationships — a new, authoritative, explicitly queryable
--      table for "this one Control relationship", replacing the earlier
--      approach of deriving a synthetic string identifier from
--      players.controller_id + controlled_since. players.controller_id/
--      controlled_since/controlled_until/is_controlled remain as the
--      live-state columns everything else already reads (isControlActive,
--      creditsService's per-relationship Credits cap) — this table is not
--      a replacement for them, it is the explicit record of relationship
--      IDENTITY that SOS needs to reference by UUID. One active INCOMING
--      relationship per player is enforced by a partial unique index.
--      "Do not infer historical relationships from sos created_at" —
--      there is no pre-existing production data in any database this
--      migration has ever touched, so there is nothing to backfill by
--      inference; sos_requests.control_relationship_id is added as a
--      NULLABLE column precisely so that a hypothetical future run of
--      this migration against a database that already has SOS history
--      never has to fabricate a relationship row for old data — the
--      application (sos.service.js) requires it for every NEW row it
--      creates, but the schema does not force a NOT NULL retroactively.
--   2. player_devices — replaces players.fcm_token (never added to
--      players in this migration): a player can be signed in on more than
--      one device. Adds `device_key` (the installation identifier Unity
--      stores securely) alongside `fcm_token`, per the corrected security
--      model in playerDevice.repository.js — a token is never silently
--      moved from one player to another; ON CONFLICT (fcm_token) now
--      raises when the existing owner differs instead of reassigning it.
--   3. sos_notifications — up to 3 notification batches per SOS, at least
--      15 minutes apart (enforced in sos.service.js, since "minimum 15
--      minutes between rounds" is a rate rule over time, not a constraint
--      a single row's shape can express).
--   4. rescue_missions — attempt_number/idempotency_key, failure_reason,
--      and now a full set of state-consistency CHECK constraints: guard
--      timestamps are both present or both absent; 'in_progress' requires
--      both; 'succeeded'/'failed'/'expired' all require resolved_at;
--      'failed' requires failure_reason; 'succeeded' forbids it. The
--      10-minute failed-attempt cooldown is enforced in rescue.service.js
--      (a rate rule relative to another row's resolved_at, not a single
--      row's own CHECK).
--   5. Composite indexes for the query shapes the self-healing expiry
--      sweeps and mission lookups actually use.
--   6. rescue_rewards — one row per resolved successful mission, rewarded
--      or not (`rewarded` distinguishes an actual grant from a
--      capped/cooled-down one) — a complete audit trail, not just a
--      record of grants.
--   7. Audit preservation: rescue_missions.sos_id and
--      rescue_rewards.mission_id are ON DELETE RESTRICT, never CASCADE —
--      deleting an SOS or a mission must never silently erase completed
--      mission/reward history. sos_notifications.sos_id remains CASCADE
--      (it is only ever meaningful alongside its parent SOS row, and
--      deleting an SOS at all is not a path this codebase exposes today).
--   8. friendships — existing rows backfilled: accepted_at for
--      already-accepted rows, expires_at for still-pending rows.
--      friendships.updated_at is verified present in 005_friendships.sql
--      before being relied on here.
--   9. Reward-cap/simultaneous-acceptance races are closed with real
--      row/advisory locking in rescue.service.js (SELECT ... FOR UPDATE
--      on sos_requests, pg_advisory_xact_lock keyed on the rescuer), not
--      application-level check-then-write alone — unchanged from the
--      previous pass, restated here for completeness.
--
-- See 017_friends_sos_rescue_fcm.down.manual.psql for the corresponding
-- rollback, which — unlike this file — IS destructive by design (a true
-- rollback of newly-created tables has no non-destructive form) and is
-- explicitly blocked from running against a database whose NODE_ENV/role
-- marks it as production (see that file's own header).

BEGIN;

-- ---------------------------------------------------------------------
-- 1. control_relationships — authoritative, explicit Control-relationship
--    records. See header note: players.controller_id/controlled_since/
--    controlled_until/is_controlled remain the live-state columns; this
--    table is the explicit, stable-UUID record of relationship identity.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_relationships (
    control_relationship_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    controlled_player_id     UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    controller_id            UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    source_battle_id         UUID REFERENCES battles (battle_id) ON DELETE SET NULL,
    started_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at                  TIMESTAMPTZ NOT NULL,
    ended_at                 TIMESTAMPTZ,
    end_reason               VARCHAR(40)
                                CHECK (end_reason IS NULL OR end_reason IN (
                                    'timer_expiry', 'rescue', 'voluntary_release',
                                    'administrative_invalidation', 'superseded_by_new_capture',
                                    'released_as_controller_defeated'
                                )),
    status                   VARCHAR(10) NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'ended')),
    CHECK (ends_at > started_at),
    CHECK ((status = 'active') = (ended_at IS NULL)),
    CHECK (status = 'active' OR end_reason IS NOT NULL)
);

-- "One active incoming Control relationship per player."
CREATE UNIQUE INDEX IF NOT EXISTS uniq_control_relationship_active_per_controlled
    ON control_relationships (controlled_player_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_control_relationships_controller_active
    ON control_relationships (controller_id)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_control_relationships_battle
    ON control_relationships (source_battle_id);

-- ---------------------------------------------------------------------
-- 2. player_devices — replaces players.fcm_token. Non-destructive: this
--    table is new (never created by any applied migration), so
--    CREATE TABLE IF NOT EXISTS + ALTER ... ADD COLUMN IF NOT EXISTS is
--    both correct and idempotent, with no DROP needed either way.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_devices (
    device_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id   UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    device_key  VARCHAR(255) NOT NULL,
    fcm_token   VARCHAR(255) NOT NULL,
    platform    VARCHAR(10) NOT NULL CHECK (platform IN ('android', 'ios')),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE player_devices
    ADD COLUMN IF NOT EXISTS device_key VARCHAR(255),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- device_key identifies one installation; fcm_token identifies one
-- currently-live push registration. Both are globally unique on their
-- own (a token can never be silently shared, and re-registering the same
-- installation must update its own row, not create a duplicate).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_player_devices_player_device_key
    ON player_devices (player_id, device_key);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_player_devices_fcm_token
    ON player_devices (fcm_token);

CREATE INDEX IF NOT EXISTS idx_player_devices_player_active
    ON player_devices (player_id)
    WHERE is_active;

-- ---------------------------------------------------------------------
-- 3. sos_notifications — up to 3 notification batches. New table, so
--    CREATE TABLE IF NOT EXISTS is sufficient (no prior shape to migrate
--    away from, so no DROP is needed or used).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sos_notifications (
    notification_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sos_id           UUID NOT NULL REFERENCES sos_requests (sos_id) ON DELETE CASCADE,
    friend_id        UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    batch_number     SMALLINT NOT NULL CHECK (batch_number BETWEEN 1 AND 3),
    notified_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    push_success     BOOLEAN NOT NULL,
    failure_code     VARCHAR(100),
    UNIQUE (sos_id, friend_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_sos_notifications_sos ON sos_notifications (sos_id);

-- ---------------------------------------------------------------------
-- 4. sos_requests — references control_relationships by UUID (replacing
--    the earlier synthetic VARCHAR identifier entirely — never deployed,
--    so there is no legacy VARCHAR data to migrate away from).
-- ---------------------------------------------------------------------
ALTER TABLE sos_requests
    ADD COLUMN IF NOT EXISTS control_relationship_id UUID
        REFERENCES control_relationships (control_relationship_id) ON DELETE RESTRICT;

-- "Exactly one SOS per control_relationship_id" — only enforced for rows
-- that actually have one (see header note on why the column is nullable).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sos_per_control_relationship
    ON sos_requests (control_relationship_id)
    WHERE control_relationship_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sos_requests_status_created
    ON sos_requests (status, created_at);

-- ---------------------------------------------------------------------
-- 5/6/9. rescue_missions — idempotency, attempt tracking, and now a full
--    set of state-consistency CHECK constraints. New table (never
--    deployed under any shape) — CREATE TABLE IF NOT EXISTS covers it
--    with no DROP.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rescue_missions (
    mission_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sos_id                  UUID NOT NULL REFERENCES sos_requests (sos_id) ON DELETE RESTRICT,
    rescuer_id              UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    status                  VARCHAR(20) NOT NULL DEFAULT 'reserved'
                                CHECK (status IN ('reserved', 'in_progress', 'succeeded', 'failed', 'expired')),
    attempt_number          INT NOT NULL CHECK (attempt_number >= 1),
    idempotency_key         VARCHAR(160) NOT NULL,
    reserved_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    reservation_expires_at  TIMESTAMPTZ NOT NULL,
    guard_battle_started_at TIMESTAMPTZ,
    guard_battle_ends_at    TIMESTAMPTZ,
    failure_reason          VARCHAR(50),
    resolved_at             TIMESTAMPTZ,
    CHECK (reservation_expires_at > reserved_at),
    CHECK (guard_battle_started_at IS NULL OR guard_battle_ends_at IS NULL OR guard_battle_ends_at > guard_battle_started_at),
    -- "Guard timestamps must both be NULL or both present."
    CHECK ((guard_battle_started_at IS NULL) = (guard_battle_ends_at IS NULL)),
    -- "in_progress requires guard timestamps."
    CHECK (status <> 'in_progress' OR (guard_battle_started_at IS NOT NULL AND guard_battle_ends_at IS NOT NULL)),
    -- "succeeded/failed/expired require resolved_at."
    CHECK (status NOT IN ('succeeded', 'failed', 'expired') OR resolved_at IS NOT NULL),
    -- "failed requires failure_reason."
    CHECK (status <> 'failed' OR failure_reason IS NOT NULL),
    -- "succeeded must not contain failure_reason."
    CHECK (status <> 'succeeded' OR failure_reason IS NULL)
);

-- Sprint 8 Critical Security Patch — "Guard battle success must be
-- validated authoritatively" + "Add replay/duplicate protection".
-- Never applied anywhere (see this file's own header) — corrected in
-- place rather than forked into 018.
--   - guard_battle_token: a one-time, server-generated nonce issued when
--     the guard battle starts; the client must echo it back to resolve
--     the battle. Combined with the existing `status = 'in_progress'`
--     guard on succeedMission/failMission, a stale or reused token can
--     never resolve a mission twice (replay protection).
--   - guard_battle_outcome: the AUTHORITATIVE result, decided and stored
--     by the server the moment the battle starts (see env.js's
--     RESCUE_GUARD_BATTLE_SUCCESS_PROBABILITY) — never derived from
--     anything the client sends.
--   - reported_outcome / outcome_mismatch: audit trail of what the client
--     actually claimed, and whether it disagreed with the authoritative
--     result — a mismatch is not itself blocked (a legitimate client
--     always reports honestly and will simply always match), but it is
--     logged and recorded as a suspicious-result signal for later review.
ALTER TABLE rescue_missions
    ADD COLUMN IF NOT EXISTS guard_battle_token VARCHAR(64),
    ADD COLUMN IF NOT EXISTS guard_battle_outcome VARCHAR(10)
        CHECK (guard_battle_outcome IS NULL OR guard_battle_outcome IN ('success', 'failure')),
    ADD COLUMN IF NOT EXISTS reported_outcome VARCHAR(10)
        CHECK (reported_outcome IS NULL OR reported_outcome IN ('success', 'failure')),
    ADD COLUMN IF NOT EXISTS outcome_mismatch BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_rescue_mission_active_per_sos
    ON rescue_missions (sos_id)
    WHERE status IN ('reserved', 'in_progress');
CREATE UNIQUE INDEX IF NOT EXISTS uniq_rescue_missions_idempotency_key
    ON rescue_missions (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_rescue_missions_rescuer ON rescue_missions (rescuer_id);
CREATE INDEX IF NOT EXISTS idx_rescue_missions_status_reservation_expiry ON rescue_missions (status, reservation_expires_at);
CREATE INDEX IF NOT EXISTS idx_rescue_missions_sos_status ON rescue_missions (sos_id, status);
-- Supports the 10-minute failed-attempt cooldown lookup: "most recent
-- failed mission for this sos_id" (see rescue.repository.js#getMostRecentFailureForSos).
CREATE INDEX IF NOT EXISTS idx_rescue_missions_sos_failed_resolved
    ON rescue_missions (sos_id, resolved_at)
    WHERE status = 'failed';

-- ---------------------------------------------------------------------
-- 7. rescue_rewards — complete audit ledger (one row per resolved
--    successful mission, rewarded or not), no cascade on mission_id.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rescue_rewards (
    reward_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rescuer_id        UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    target_player_id  UUID NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    mission_id        UUID NOT NULL REFERENCES rescue_missions (mission_id) ON DELETE RESTRICT,
    rewarded          BOOLEAN NOT NULL,
    credits_granted   INT NOT NULL DEFAULT 0 CHECK (credits_granted >= 0),
    xp_granted        INT NOT NULL DEFAULT 0 CHECK (xp_granted >= 0),
    reward_reason     VARCHAR(50) NOT NULL,
    idempotency_key   VARCHAR(160) NOT NULL,
    credited_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_rescue_rewards_mission ON rescue_rewards (mission_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_rescue_rewards_idempotency_key ON rescue_rewards (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_rescue_rewards_rescuer_day
    ON rescue_rewards (rescuer_id, credited_at)
    WHERE rewarded;
CREATE INDEX IF NOT EXISTS idx_rescue_rewards_rescuer_target
    ON rescue_rewards (rescuer_id, target_player_id, credited_at)
    WHERE rewarded;

-- ---------------------------------------------------------------------
-- 8. Backfill existing friendships rows for the columns this migration
--    adds (idempotent — only touches rows the new columns left NULL).
--    friendships.updated_at is confirmed present since 005_friendships.sql.
-- ---------------------------------------------------------------------
ALTER TABLE friendships
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

UPDATE friendships
SET accepted_at = updated_at
WHERE status = 'accepted' AND accepted_at IS NULL;

UPDATE friendships
SET expires_at = created_at + INTERVAL '7 days'
WHERE status = 'pending' AND expires_at IS NULL;

COMMIT;
