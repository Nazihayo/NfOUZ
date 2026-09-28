-- 015_battle_pending_review.sql
-- NFOUZ — Sprint 6 final gameplay-completion pass: Alpha security mode.
--
-- The Sprint 6 final security correction (014_battle_result_authority.sql)
-- made the backend verify a host-signed result rather than trust a bare
-- claim. That signature proves the result came from the real Photon Host
-- Mode host and wasn't forged by the other client — it does NOT prove the
-- host's own reported health/damage/duration values were honest (a
-- cheating host can still sign a self-favoring result). This migration
-- adds the explicit "provisional" tier the correction instruction asked
-- for: a signed, structurally valid result that trips a plausibility
-- heuristic (implausible duration or implausible final health, see
-- battle.service.js's evaluateSuspicion) is still accepted and recorded
-- (so it can't be resubmitted/replayed), but is marked 'pending_review'
-- instead of 'resolved' — Influence and Control are NOT granted for a
-- pending_review battle. A Dedicated Server (real server-run combat
-- simulation) remains required before this can be called full server
-- authority or used for competitive public release.

BEGIN;

ALTER TABLE battles DROP CONSTRAINT IF EXISTS battles_status_check;

ALTER TABLE battles ADD CONSTRAINT battles_status_check
    CHECK (status IN ('in_progress', 'resolved', 'forfeited', 'cancelled', 'pending_review'));

COMMIT;
