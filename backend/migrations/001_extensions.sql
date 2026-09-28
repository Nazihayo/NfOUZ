-- 001_extensions.sql
-- NFOUZ — Required PostgreSQL extensions

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

COMMIT;
