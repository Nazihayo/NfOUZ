# NFOUZ Art Bible v2: Semi-Realistic Heroic (Alpha)

This replaces `art_bible.md` (v1, the stylised chunky look the owner rejected).
The owner chose **semi-realistic heroic, in the Free Fire / PUBG Mobile key-art
class**. Nothing here changes code or adds features. Every asset is matched to
what the repo already references. Target: Unity 6 (6000.0.58f2), URP 17.0.4,
Android first.

The concept page is `concept_v2.html` in this folder. **It is a direction, not
production art.** SVG can fix proportions, silhouettes, palette, materials and
lighting intent. A premium look comes only from sculpted, PBR-textured 3D models
rendered in-engine (§6–§8).

---

## 1. Style pillars
1. **Adults with real proportions.** Heroes are 7.5–8 heads tall. In-engine
   heights: Scout 1.72 m, Ranger 1.84 m, Titan 1.95 m. No chibi, no oversized
   heads or hands, no rounded toy shapes. Hands are life-size. Gear has real
   thickness.
2. **Grounded tactical gear.** Plate carriers with MOLLE, battle belts, pouches,
   knee pads, gloves and boots with real soles. Fabric folds sit where the
   body bends: elbows, knees, crotch, shoulders, and under belts and straps.
   Gear wears in at the edges: scuffed corners and lighter edge wear on metal.
3. **Gulf near-future identity, used as gear details, not costume.**
   - **Shemagh** weave appears as the Scout's neck wrap and in scarf patterns,
     in bone and maroon.
   - **The bisht cut** with brass edging becomes the Ranger's long tactical coat
     over a thobe-line tunic.
   - **Mashrabiya / khatam lattice** appears as heat grilles (Titan chest,
     hammer head), engraved ID plates, coat embroidery and arena pylons.
   - **The khanjar J-curve** shapes the Shadow Dagger.
   - Never use religious symbols, national emblems or real flags.
4. **Cinematic night lighting.** The key light is warm sodium (`#FFB46B`) from
   the front-left. The rim light is cool teal (`#3FB7C9`) from the back-right.
   Ambient stays low, so shadows go deep. Emissives are small and meaningful:
   a teal LED, a gold energy cell, an ember core.
5. **Strong poses.** Contrapposto (weight on one leg, hips and shoulders
   counter-tilted) plus a slight 3/4 turn. Every hero reads as a silhouette
   with one dominant weapon line.

## 2. Palette (darker, desaturated)
| Token | Hex | Use |
|---|---|---|
| night-ink | `#07090D` | backgrounds, deepest shadow |
| gunmetal | `#1A1E26` / `#2F343C` | weapons, armour base |
| olive drab | `#3A4032` | carriers, pouches (Scout, Ranger) |
| desert tan | `#6C5E45` | webbing, belts |
| bisht brown | `#2A1F19` | Ranger coat |
| shemagh bone / maroon | `#BDB19B` / `#571C22` | scarves, wraps |
| brass | `#9C7834` | trims, legendary anodising |
| sodium key | `#FFB46B` | key-light tint |
| teal rim / energy | `#3FB7C9` | rim light, EN bar, Scout LED (`#36D1C4`) |
| ember | `#FF7A2E` | Titan core, Titan Hammer grille |
| health | `#E5484D` | HP bar, damage numbers only |
| influence gold | `#E9B44C` | timer frame, Influence Cannon cell, callouts |

The faction colours in `003_factions.sql` are unchanged (Falcons `#3AA0FF`,
Wolves `#9CA3AF`, Ghosts `#7C3AED`, Titans `#DC2626`). They appear **only** on
ground rings, name plates and map markers, never on the hero body. Rarity:
common `#9AA4B2`, rare `#2FB5A6`, legendary `#E9B44C`.

## 3. Heroes (code: `Constants.PlayerClass`)
| | Scout «الكشّاف» | Ranger «الرامي» | Titan «الصامد» |
|---|---|---|---|
| HP / EN (`BattleManager`) | 80 / 120 | 100 / 100 | 140 / 80 |
| Body | lean athletic woman, 1.72 m | lean tall man, 1.84 m, trimmed beard | heavy man, 1.95 m, full beard |
| Gear | softshell hood jacket, shemagh wrap, low-profile carrier, thigh rig, knee pads, comms earpiece | bisht-cut coat with brass trim and lattice embroidery, thobe-line tunic, plate carrier with a mashrabiya ID plate, headset with monocular optic | open-face helmet with glass visor, lamellar pauldrons, mashrabiya chest grille with ember core, abdominal lames, tassets, gauntlets, greaves |
| Signature weapon (visual) | Shadow Dagger, reverse grip | Influence Cannon, low ready | Titan Hammer, shouldered |
| Silhouette | hood plus a low blade | tall coat plus a long barrel | massive shoulders plus the hammer head above the shoulder |
| Top-down read | small hood teardrop with a scarf tail | coat oval plus a 1 m barrel | wide pauldrons plus the hammer head |

The Arabic names are **proposals**, because `StringTable.cs` has no class keys
yet. «الصامد» avoids clashing with the faction «العمالقة». Weapon pairings are
visual only: code lets any class use any weapon, and `BattleManager` currently
gives everyone Pulse Blade.

## 4. Weapons (code: `WeaponDatabase`, `008_items.sql`)
These are serious military sci-fi hardware. Every weapon has a readable
mechanism, stencils and serials, and edge wear.
- **Pulse Blade** (common; 18 dmg, 2.2 m; Pulse Arc 26 / 140° / 3 m): a straight
  tanto-tipped blade with an emitter rail and vent slots along the spine, a
  power cell in the guard, a cord-wrapped grip and a hex pommel with a lanyard
  ring.
- **Shadow Dagger** (rare; 12 dmg, 1.5 m; Shadow Lunge 20 / 3 m): a khanjar
  J-curve with a DLC-black blade, satin bevel, fuller and spine jimping, G10
  scales with screws, and a skull-crusher pommel.
- **Titan Hammer** (rare; 32 dmg, 2.5 m, 5 EN basic; Ground Break 36 / 3 m /
  1 m knockback): a breaching hammer with a knurled shaft, hazard collar,
  hydraulic piston, a mashrabiya heat grille glowing ember, cooling fins and
  a scarred striking face.
- **Influence Cannon** (legendary; 15 dmg, 10 m; Charged Pulse 28 / 12 m /
  18 m/s): a skeleton stock, a receiver with panel seams and a brass strip, a
  holo optic on a rail, a stippled grip, a gold energy-cell magazine, a vented
  shroud and a muzzle brake.

## 5. A reality check for the battle camera
The battle reads top-down, at roughly 10 m across a 390 pt screen. At that
framing a hero is about **35–50 px wide**, so faces and stitching are
invisible in combat. The semi-realistic investment pays off in **key art,
class select, inventory/loadout, result screens and the store**. In battle,
silhouette and the emissive accent do the work. The council or owner may want
to revisit the battle camera's tilt (for example 50–60° instead of near
top-down) so heroes read better. That is a GDD/owner decision, not an art
change. It is flagged here only because it decides how much of this detail
players ever see.

## 6. Technical specs (URP, mobile PBR)
**Shading.** Use URP/Lit (metallic workflow) for heroes, weapons and props.
A small Shader Graph variant adds a Fresnel rim term (teal) and an emission
mask. Installing Shader Graph is package installation, which Build Recovery
allows. Skin uses Lit with a warm-tinted base and a smoothness map. Mobile gets
no subsurface scattering. Hair is alpha-clipped hair cards, never
alpha-blended. Transparent surfaces are limited to visor glass only.

**Lighting.** One realtime directional key light. Baked lightmaps plus light
probes for the arena. Rim comes from the shader, not an extra light. Post on the
high tier only: ACES tonemapping plus low-quality bloom (budget about 1 ms on
mid-range Adreno/Mali). Low tier: no post.

**Budgets (LOD0 / LOD1 / LOD2 tris):**
| Asset | LOD0 | LOD1 | LOD2 | Textures (ASTC 6×6 on Android) | Rig / notes |
|---|---|---|---|---|---|
| Scout | 15–18k | 8k | 3k | BaseColor 2048², Normal 2048², Mask 1024² (R metal, G AO, A smooth), Emission 512² | Humanoid, ~55–65 bones incl. simplified fingers, 4-bone scarf chain |
| Ranger | 18–22k | 10k | 4k | same | plus 2×5-bone coat chains (no cloth sim on mobile) |
| Titan | 20–25k | 11k | 4.5k | same | Humanoid with wide proportions; pauldrons on shoulder twist bones |
| Rescue Guard NPC (`RescueGuardController`) | 15–18k | 8k | 3k | same | reuses the Titan rig |
| Weapons ×4 | 3–6k each | 1.5k | 600 | one 2048² atlas set shared by all four, plus a 512² emission | pivot at the grip, +Z forward; real lengths: blade 1.1 m, dagger 0.4 m, hammer 1.4 m, cannon 1.2 m |
| Battle arena (r = 15 m, `ArenaRadiusMeters`) | 30–50k total | n/a | n/a | 2 tiling 2048² trim sets plus lightmap 1024² | baked lighting; 8 mashrabiya pylons; emissive ring |
| Map markers | ≤ 1.5k | n/a | n/a | shared 512² | `PlayerMarker` / `NearbyPlayerMarker` |

Frame budget: two heroes, two weapons and the arena come to about
110–130k tris, under 120 draw calls, with SRP Batcher on.

Texture memory: a 2048² map in ASTC 6×6 is about 2.5 MB with mips, so about
8 MB per hero. A low-tier quality level uses Global Mipmap Limit = 1, which
halves every texture without separate assets.

**Animation (staged, not wired).** No Animator system exists in code
(`art-reference/README.md`), so wiring clips is a new system and needs owner
approval. Produce and import Humanoid clips at 30 fps with root motion off.
Set each clip's contact frame to the approved wind-up value:
- Pulse Blade: 0.20 s basic; Pulse Arc 0.45 s.
- Shadow Dagger: 0.12 s; Shadow Lunge 0.25 s.
- Titan Hammer: 0.55 s; Ground Break 0.75 s.
- Influence Cannon: 0.25 s; Charged Pulse 0.65 s.
- Dodge: 0.3 s with 0.2 s i-frames.
- Blink Step: 0.25 s.
- Focus Shot and Bulwark: 0.2 s action lock.

Also needed: idle ×3, run, hit-react ×2, KO, victory, and class-select poses
×3 for the hero screens.

**Icons.** Painted or rendered from the 3D models with the same key and rim
light. Masters are 512², exported at 256 (inventory), 128 (HUD) and 64
(markers), into one Sprite Atlas at 2048² ASTC 4×4. The Health Kit must avoid
the red cross and red crescent (protected emblems).

**Fonts.** The Arabic SDF already exists (Noto Sans Arabic Regular). A Bold
Arabic SDF is still needed for headings.

## 7. Fixing the pink capsule (unchanged from v1, still first)
Renderers still reference Unity's built-in `Default-Material`
(`fileID: 10303, guid: 0000000000000000f000000000000000`). The URP converter
never upgrades it. There are 11 slots in 5 files:

| File | Slots |
|---|---|
| `Prefabs/Networking/NetworkPlayer.prefab` | 2 (`Visual` capsule, `Facing` cube) |
| `Prefabs/Map/NearbyPlayerMarker.prefab` | 4 |
| `Prefabs/Map/PlayerMarker.prefab` | 2 |
| `Scenes/Battle.unity` | 1 (`Arena` plane) |
| `Scenes/MainMap.unity` | 2 |

Fix (30–45 minutes in the Editor):
1. Create `Assets/_Project/Art/Materials/`, then Create → Material. It defaults
   to URP/Lit. Make `M_Placeholder_Body` (`#2F343C`, smoothness 0.35),
   `M_Placeholder_Facing` (Unlit `#36D1C4`) and `M_Arena_Floor`
   (`#12161D`, smoothness 0.2).
2. Assign them to every slot listed above and save.
3. Check the Frame Debugger: no `Hidden/InternalErrorShader`.
4. Commit the `.mat`/`.meta` files and the re-saved assets.

Optionally, add an EditMode test that fails on `fileID: 10303` under
`Assets/_Project`.

**Code hook needing owner approval.** One prefab with one `Visual` child cannot
show a different hero per `NetworkedClass`. A tiny presenter is needed that
enables one of three child visuals. It is a few lines of C# with no gameplay
change. Until it is approved, everyone shares one placeholder body.

## 8. Sourcing route (realistic, honest)
Semi-realistic costs about **3–5× the stylised route** in money and time, and it
needs some technical-art time (skin, hair cards, LODs, mobile shader tuning).
Verify every licence below for commercial game distribution before purchase.

| Route | Fits this style? | Cost (market ranges, not quotes) | Effort | Notes |
|---|---|---|---|---|
| **Unity Asset Store: realistic modular soldier / sci-fi trooper packs and PBR sci-fi weapon packs** (search "modular tactical character PBR", "sci-fi soldier mobile", "sci-fi weapons PBR") | Yes for bodies, gear and weapons; heads and faces are usually generic | US$30–150 per pack; about US$200–500 for a full kit | 1–2 weeks for one tech artist to kit-bash three heroes, recolour to §2, build LODs and set up URP materials | The fastest Alpha path. The Gulf identity (shemagh, bisht coat, mashrabiya grilles) still needs custom pieces. Unity's Asset Store EULA allows game use, but check each pack's poly count and whether it is mobile-ready |
| **Reallusion Character Creator 4 + Headshot** (realistic heads from photos) with its game-ready LOD export | Yes, for faces and bodies | software plus content licences, roughly US$300–1,000 total | about 1 week to learn, then 1–3 days per hero | Gives believable adult anatomy and faces. Confirm the export licence for game engines. Pair it with Asset Store gear |
| **Mixamo** (Adobe, free) | Yes for locomotion and combat basics | US$0 | 2–4 days to retarget to Humanoid and trim contact frames to §6 | The 65-bone rig maps to Humanoid. Clips are generic, so the signature attacks need custom keys or a commission |
| **Marketplaces** (ArtStation, CGTrader, Sketchfab "game-ready", TurboSquid) | Varies | US$20–300 per asset | mixed | Read each licence carefully. Many forbid redistribution or use in a game, or require attribution |
| **Commission** (freelancers or a regional studio; prefer Arabic-speaking artists for authenticity) | The best fit | 2D paint-over concept per hero US$200–600; game-ready hero (sculpt, retopo to budget, bake, PBR, rig) US$1,500–4,000 each from mid-tier freelancers (studios charge more); weapons US$300–900 each; arena US$2,000–6,000; painted key art US$500–2,000; icon set US$400–1,200 | 3–5 weeks per hero including two review rounds | A work-for-hire contract with IP assignment and source files (`.ztl`, `.blend`/`.fbx`, `.spp`) delivered is mandatory |

**Recommendation.**
- **Now (Alpha, about 2 weeks, under US$600):**
  - Fix the pink capsule.
  - Produce P0 UI and icons in-house from the concept sheet.
  - Build three heroes by kit-bashing Asset Store tactical bodies (optionally CC4
    heads) with custom shemagh, coat and mashrabiya pieces, and import
    Mixamo locomotion.
  - Ship at 1024² textures on low tier.
- **After the 20-player test:** commission 2D paint-overs of these SVGs,
  then commission production heroes, Scout first because it is the default
  `classType` fallback. Then weapons, then the arena. Roughly US$8–15k and 2–3
  months for the full premium set.

## 9. Production asset list (priority order)
- **P0:** pink-capsule materials (§7); Arabic Bold SDF; battle action icons ×4;
  weapon icons ×4; consumable icons ×3; class icons ×3 with class-select
  portraits 768×1024; status icons ×2 (`PlayerControlStatusIcon`); AYAZ button
  icon (`MainMapScreen`); UI 9-slice kit in the dark-glass style (panel, button,
  toast, popup, HP/EN bars, Win/Lose/Draw banners, bottom-nav ×5).
- **P1:** heroes ×3, weapons ×4, arena, Rescue Guard, map markers and faction
  rings, all at the §6 budgets.
- **P2:** animation clips (staged, §6); hero-select poses; key-art render for
  the store.

## 10. Sign-off checklist (per 3D asset)
- [ ] Proportions are within ±0.25 heads of §3, and the black-fill silhouette
      reads at 64 px and from the battle camera.
- [ ] Uses §2 colours only. Faction colour never appears on the body.
- [ ] Gulf detail is present and respectful (reviewed by a native reviewer).
- [ ] Budget met (tris, textures, bones). One material per hero; weapons on the
      shared atlas.
- [ ] URP/Lit or the approved Shader Graph only. No `Default-Material`.
- [ ] The source files and the licence or contract are stored outside the repo.
      No credentials, invoices or licence keys are committed (CLAUDE.md).
