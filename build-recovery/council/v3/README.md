# Design council v3, 2026-10-29/30

At the owner's request, five reviewers (Claude agents, each given an expert
role) proposed how to grow NFOUZ after Build Recovery. Everything here is a
**proposal**: nothing is implemented and no approved system is changed.
`summary.html` is the one-page Arabic summary with the 20 numbered decisions
waiting for the owner (also published as a private claude.ai page).

| File | Reviewer | Topic |
|---|---|---|
| `01_combat_v3.md` | Combat & game design | Duel camera, stamina/guard/adrenaline, move sets, 21 weapons (7 per class, equal power), 3 future classes, Glicko-2 leagues, anti-cheat, animation budget |
| `02_competitions_14_months.md` | Live-ops & esports | 14 monthly competitions, battle pass, leaderboards, tournament tech, creator program, prize law by region |
| `03_travel_adventure.md` | World & exploration | Passport stamps, virtual travel options (recommends remote expedition, then limited expedition tickets; rejects free teleport), 20 world cities, sponsored stores, geofence exclusions |
| `04_retention_economy_creators.md` | Retention, economy, community | Loops, progression, no pay-to-win, cosmetics pipeline, clans, chat safety, creator tools (9:16 clips, streamer mode), KPIs, top 15 features |
| `05_tech_roadmap.md` | Technical director | Quality tiers (Galaxy A16 vs iPhone 16 Pro), 3D pipeline, selfie privacy, dedicated servers, scaling and cost, iOS without a Mac, roadmap |

## Owner decisions so far
- 2026-10-30: the council's work is accepted as the plan to review on the
  laptop and implement step by step; the 20 decisions in `summary.html` §7
  are still open.
- 2026-10-30: build characters with free or low-cost tools first (Blender
  with MakeHuman/MPFB, Asset Store kits, Meshy/Tripo for weapons, Mixamo,
  phone-video mocap; about US$0–150). The Gemini images in
  `art-reference/gemini/approved/` stay the official target; professional
  versions are paid for once there are subscribers.

## Found while reviewing (needs approval before any change)
- `backend/src/services/location.service.js` (`MAX_SPEED_KMH = 300`) rejects
  a player's location for hours after a flight (about 16 h for Riyadh to
  London). Proposed "re-anchor" fix in `03_travel_adventure.md` §6.2.

Costs and legal points in these files are estimates and general knowledge,
not quotes or legal advice.
