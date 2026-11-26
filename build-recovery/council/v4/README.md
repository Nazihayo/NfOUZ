# Design council v4, 2026-11-26

The owner asked the council to review everything built so far and say how
NFOUZ can compete with the strongest games (he cited GTA 6), and asked the
director to review and decide. Five reviewers (Claude agents, each given an
expert role) wrote reports; the director read them, spot-checked the key
claims against the code, and wrote the decision. All files are in Arabic.

| File | Author | Topic |
|---|---|---|
| `00_DIRECTOR_DECISION.md` | Director | Verdict and strategy, ordered Build Recovery steps with definitions of done, freeze/cut list, roadmap and budgets, 8 owner decisions with defaults, process changes, first laptop session card |
| `01_game_design.md` | Game design | What makes top games fun, NFOUZ's real edge, the 90 s battle, the empty-map problem |
| `02_visual_realism.md` | Art & visual realism | Realism possible on Galaxy A16, Mapbox vs Google 3D Tiles, characters, arena and lighting budgets |
| `03_engineering_audit.md` | Engineering audit | Strengths, weaknesses, risks, bugs B1–B7 (report only), engineering plan |
| `04_growth_liveops.md` | Growth & live-ops | How location games grow and die, city-by-city launch, monetization without pay-to-win, KPI gates, legal minimum |
| `05_producer_plan.md` | Producer | Real velocity, realistic timeline, budget by phase, scope freeze, 90-day plan, working process |

## Owner decisions

- 2026-11-26: the owner approved all eight decisions in
  `00_DIRECTOR_DECISION.md` §6 with the director's defaults: (1) scope frozen
  until Alpha, and the latest GDD to be added to the repo; (2) D11 fix: the
  server supplies both players' stored max health, and old accounts are
  corrected to the GDD class values; (3) B1 fix in the same batch: the host
  rejects health above that value, and the server checks each player's final
  health against their own stored value; (4) first market: the owner's city
  in Germany (students and the Arab community), the Gulf second through a
  local partner, no German localization before Beta; (5) age 16+ at launch,
  18+ for selfie and prizes, adults only in Alpha; (6) battle length stays
  90 s + 30 s overtime unless the GDD says otherwise; (7) Alpha budget up to
  EUR 1,500 in the stated order, nothing spent before Phase 0 ends;
  (8) `BattleVisualSetup` is not run before the third battle, then kept only
  if it holds 30 fps on the Galaxy A16, otherwise a Low version without
  post-processing. The 20 v3 decisions stay open and frozen.

## Status

**Everything here is a proposal awaiting the owner's approval**, except work
that `CLAUDE.md` already allows during Build Recovery (fixing confirmed
defects, compiling and testing, scaffolding, SDK integration, and assets for
what already exists in code). No code, scene or approved design was changed
by this council. C# written in the cloud stays UNCOMPILED until the laptop
compiles it.

Verified while writing: backend `npm test` 498/498 passed in the cloud on
2026-11-26 (`bb26e3a`). Bugs B1 and B2 and the D11 mechanism were confirmed by
reading the code only; none was reproduced on a device.

Costs, dates, KPI targets and legal points are estimates and general
knowledge, not quotes or legal advice.
