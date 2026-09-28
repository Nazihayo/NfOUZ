-- 014_battle_result_authority.sql
-- NFOUZ — Sprint 6 final security correction: signed authoritative
-- battle-result payload. Extends the existing `battles` table
-- (004_battles.sql / 013_battle_sessions.sql) rather than duplicating it.
--
-- Host Mode Alpha limitation (see battle.service.js resolveBattle's doc
-- comment): the "host" here is one of the two player clients (Photon
-- Fusion Host Mode has no separate server process running combat), so
-- this signature proves a result came from whichever client held the
-- room's host role for this battle — it is limited anti-cheat, not full
-- server authority. It stops a non-host client from forging a result and
-- stops a stale/replayed result from a different match attempt, but a
-- cheating host's own reported health/damage values still need the
-- server-side anomaly bounds checked in the service layer, and full
-- combat-log replay validation remains explicitly out of scope for Alpha.

BEGIN;

ALTER TABLE battles
    -- Which participant holds this battle's Photon Fusion host role.
    -- Sprint 5's createChallenge always makes the attacker's client the
    -- room creator, so it defaults to attacker_id — see
    -- battle.service.js createChallenge's comment on this assumption.
    ADD COLUMN IF NOT EXISTS host_player_id UUID REFERENCES players (player_id) ON DELETE SET NULL,

    -- Per-battle HMAC signing secret, generated server-side at challenge
    -- time and returned ONLY to the host's own createChallenge response —
    -- never exposed via GET /battle/{battleId} to either participant.
    ADD COLUMN IF NOT EXISTS host_authority_secret VARCHAR(64),

    -- Random value the host must echo back in its signed result,
    -- preventing a result signed for a previous match attempt (e.g.
    -- before a reconnect) from being replayed onto this one.
    ADD COLUMN IF NOT EXISTS match_nonce VARCHAR(64),

    -- Monotonically increasing combat-event counter the host includes in
    -- its signed result. A resolve request whose event_seq does not
    -- exceed this stored value is rejected as a duplicate/replay.
    ADD COLUMN IF NOT EXISTS last_event_seq INTEGER NOT NULL DEFAULT 0,

    -- The combat rules/weapon-data version this battle was created
    -- under, so a resolve request computed under a stale client build
    -- (old weapon stats) can be rejected rather than silently trusted.
    ADD COLUMN IF NOT EXISTS rules_version VARCHAR(20);

COMMIT;
