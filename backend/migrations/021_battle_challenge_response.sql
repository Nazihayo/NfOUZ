-- 021_battle_challenge_response.sql
-- Alpha defender flow: a challenge waits for the defender's explicit
-- Accept or Decline instead of being joined automatically.
--
-- The lifecycle stays on the existing battles.status values; two timestamps
-- record the defender's answer:
--   pending   status = 'in_progress', accepted_at IS NULL
--   accepted  status = 'in_progress', accepted_at set
--   declined  status = 'cancelled',   declined_at set
--   expired   status = 'cancelled',   both NULL (nobody answered within
--             BATTLE_READY_TIMEOUT_SECONDS; backend utils/battleLifecycle.js)
--
-- Forward-only and additive. Battles created before this migration had no
-- invitation step, so they are recorded as accepted when their session
-- started: their timing and history are unchanged. Rolling back means
-- dropping the two columns and the constraint; any declined/accepted
-- information is then lost.

BEGIN;

ALTER TABLE battles
    ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;

UPDATE battles
SET accepted_at = COALESCE(session_started_at, started_at)
WHERE accepted_at IS NULL AND declined_at IS NULL;

ALTER TABLE battles DROP CONSTRAINT IF EXISTS battles_answered_once_check;
ALTER TABLE battles ADD CONSTRAINT battles_answered_once_check
    CHECK (accepted_at IS NULL OR declined_at IS NULL);

COMMIT;
