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
