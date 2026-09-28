# CLAUDE.md — NFOUZ Project Rules

These rules govern any AI-assisted or human work on this repository during and
after the Build Recovery Phase. They are binding project policy, not
suggestions.

## Authoritative sources

- **Unity 6 is authoritative.** All Unity Editor, package, and build-target
  work in this repository targets Unity 6. Any earlier version reference
  found in prior audit notes was a fallback recommendation made before this
  policy was set and is superseded by this file.
- **The latest detailed Game Design Document (GDD) is authoritative.** Where
  any older design document, comment, or prior sprint note conflicts with the
  latest detailed GDD, the GDD wins.

## Build Recovery Phase constraints

- **No new features** may be added while the project is in Build Recovery.
  Recovery work is limited to: Unity project scaffolding, package
  installation, scene/prefab construction, SDK integration (Photon, Mapbox,
  Firebase), and asset production for what already exists in code.
- **Do not redesign approved systems.** Sprint 1–10 backend and gameplay
  logic is approved and stays as-is; Build Recovery only makes it runnable.

## Architecture rules

- **Server-authoritative rules.** The client never decides an outcome the
  server can verify. Battle results, rescue outcomes, inventory ownership,
  and quest progress are all resolved and validated server-side; the client
  reports intent, never authoritative state.
- **Arabic-first, RTL.** Arabic is the default language and primary design
  target; UI, layout, and text rendering must support right-to-left
  correctly. English is a secondary, fully-supported locale, not an
  afterthought.

## Naming

- **NORA was renamed to AYAZ.** Any reference to "NORA" in older design
  material, comments, or docs refers to the same in-game AI assistant now
  named **AYAZ**. Use AYAZ in all new work; do not reintroduce the old name.

## Security

- **Never commit credentials or tokens.** No `.env` files, Firebase
  service-account JSON/plist files, Photon App IDs, Mapbox access tokens,
  signing keys/keystores, or any other secret value are ever committed to
  this repository. Use `.env.example` / SDK-generated local config assets
  (already gitignored) for real values, on each developer's own machine.
