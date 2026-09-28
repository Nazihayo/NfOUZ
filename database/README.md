# Database

The single source of truth for the NFOUZ schema is
**`backend/migrations/`** (20 sequential, idempotent SQL files, applied via
`backend/scripts/run-migrations.js`). This folder does not duplicate the
migration files — that would risk drift between two copies of the schema —
it only documents them.

## Migration index (current, 001–020)

| # | File | Introduces |
|---|---|---|
| 001 | `001_extensions.sql` | Postgres extensions |
| 002 | `002_players.sql` | `players` table |
| 003 | `003_factions.sql` | Factions |
| 004 | `004_battles.sql` | Battle records |
| 005 | `005_friendships.sql` | Friendships |
| 006 | `006_sos.sql` | SOS requests |
| 007 | `007_influence_log.sql` | Influence audit log |
| 008 | `008_items.sql` | `items` (weapons + consumables) |
| 009 | `009_inventory.sql` | `player_inventory` |
| 010 | `010_quests.sql` | `quest_definitions`, `player_quests` |
| 011 | `011_ai_agents.sql` | AI agent support |
| 012 | `012_player_visibility.sql` | Player visibility rules |
| 013 | `013_battle_sessions.sql` | Battle sessions (Photon) |
| 014 | `014_battle_result_authority.sql` | Signed battle results |
| 015 | `015_battle_pending_review.sql` | Suspicious-result review queue |
| 016 | `016_control_protection_credits.sql` | Control/Protection + `players.credits` |
| 017 | `017_friends_sos_rescue_fcm.sql` (+ `.down.manual.psql`) | Friends/SOS/Rescue/FCM + Sprint 8 Critical Security Patch columns |
| 018 | `018_battle_pass_xp.sql` | `players.battle_pass_xp` |
| 019 | `019_inventory_idempotency.sql` | Inventory idempotency-key table |
| 020 | `020_quest_daily_assignment.sql` | Daily quest assignment uniqueness |

## Applying migrations

```
cd backend
npm install
cp .env.example .env   # set a real DATABASE_URL, never commit .env
node scripts/run-migrations.js
```

`run-migrations.js` tracks applied files in a `schema_migrations` table and
is safe to re-run — every migration in this list uses idempotent SQL
patterns (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).

Per project policy (`CLAUDE.md`), the approved schema is not redesigned
during Build Recovery — any future schema change is a new, additive,
sequentially-numbered migration file in `backend/migrations/`.
