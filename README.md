# NFOUZ

A location-based, social mobile game. Backend (Node/Express/PostgreSQL) is
complete through Sprint 10 (Inventory, Quests, Battle Pass XP, full UI
integration + localization). The Unity client exists as a complete,
audited script set, but has no Unity project scaffolding yet — see
`build-recovery/RECOVERY_STATUS.md`.

See `CLAUDE.md` for binding project rules (authoritative Unity/GDD versions,
Build Recovery constraints, server-authority, Arabic-first/RTL, naming,
secrets policy).

## Repository structure

```
backend/            Node/Express/PostgreSQL backend — source, migrations, tests
unity/               Unity client — Assets/_Project/Scripts + Tests/EditMode
documentation/       Scene-setup specs, audit/report archive
database/            Schema/migration overview (source of truth stays in backend/migrations)
art-reference/       Art asset requirements and references (no assets produced yet)
build-recovery/      Current recovery status and execution plan
```

## Backend

```
cd backend
npm install
cp .env.example .env   # fill in real local values — never commit .env
node scripts/run-migrations.js
npm start
```

## Unity client

The client is currently script-only: no `.unity` scene files, prefabs, or
Unity project scaffolding exist in this repository yet. See
`build-recovery/RECOVERY_STATUS.md` for the exact, ordered steps to turn
`unity/Assets/_Project/` into an openable Unity 6 project and reach a first
runnable build.

## Status

Sprints 1–10 approved. The project is currently in **Build Recovery** —
no new gameplay or backend features are being added until a real, runnable
Unity build exists. See `build-recovery/RECOVERY_STATUS.md` for details.
