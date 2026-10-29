# NFOUZ Art Bible (Alpha), from the Art Director

Status: proposal for the council and the owner. Nothing here changes code, and
nothing here is a new feature. Everything is matched to what the repo already
references (paths are given). Unity 6 (6000.0.58f2) + URP 17.0.4, Android first.

**Continuity note.** The earlier concept canvas this brief points to
(`.../scratchpad/nfouz-art/project/Characters.dc.html`, `Weapons.dc.html`,
`Main.dc.html`) **does not exist on disk** in this session (the scratchpad only
holds `council/`). I could not read it, so this bible and `concept.html` are
built from the repo alone. If the owner still has those files, the bits to
keep are whatever matches the palette and silhouettes below. Where they
conflict, the code and the latest GDD win.

---

## 1. Visual pillars

1. **Gulf night, near future.** Glass towers, sodium street light, neon trim,
   mashrabiya lattice turned into light panels. Warm key, cool rim. It should
   be recognisably Gulf without leaning on clichés. Use no religious symbols
   and no national flags or emblems.
2. **Read in 1 second, from above, on a 6" phone.** The battle camera looks
   down. Class reads from the *top-down* silhouette first, then from colour.
   Faction reads from the ground ring colour only.
3. **Stylised, chunky, mobile-cheap.** About 5 heads tall, big hands, big
   weapon heads, flat-ish shading with one emissive accent per character.
   No realtime GI. No transparency stacks.
4. **Arabic-first.** Every label is drawn for Arabic first and English second.
   Icons carry the meaning on their own, so no glyph is needed inside an icon,
   with one exception: "SOS" stays Latin because it is the international term
   and it already appears in the story text.

## 2. Palette (hex)

### 2.1 World / UI core (night)
| Token | Hex | Use |
|---|---|---|
| `ink-900` | `#070B17` | deepest background, outlines |
| `ink-800` | `#0B1020` | app background (dark) |
| `ink-700` | `#121A33` | panels |
| `ink-600` | `#1C2547` | raised panels, inactive buttons |
| `steel-400` | `#5B6578` | metal mid |
| `mist-200` | `#C9D3E6` | secondary text on dark |
| `pearl-50` | `#F3F6FB` | primary text on dark; light-mode background |
| `sodium` | `#FFB870` | key-light tint (street lamps). Highlights lean warm |
| `neon-rim` | `#22D3EE` | rim light and the ENERGY colour |

### 2.2 Gameplay semantics (never reuse for decoration)
| Token | Hex | Use |
|---|---|---|
| `hp` | `#FF4D5E` | Health bar, damage numbers |
| `en` | `#22D3EE` | Energy bar, energy cost badges |
| `influence` | `#F5B53D` | influence / rank / AYAZ gold |
| `controlled` | `#FF6B4A` | "تحت السيطرة" status (`PlayerControlStatusIcon.controlledIcon`) |
| `protected` | `#2DD4BF` | "محمي" status (`PlayerControlStatusIcon.protectedIcon`) |
| `telegraph` | `#FFFFFF` @ 35% | wind-up area previews (white so it reads on every faction) |

### 2.3 Factions (from `backend/migrations/003_factions.sql`; do not change)
Falcons `#3AA0FF` · Wolves `#9CA3AF` · Ghosts `#7C3AED` · Titans `#DC2626`.
Faction colour is used **only** for the ground ring under a character, the name
plate stripe and the map marker. It is never used on the character's body, so a
Scout of the Ghosts and a Scout of the Titans share one model.

### 2.4 Class accents (emissive / trim colour on the model)
| Class | Accent | Secondary | Why |
|---|---|---|---|
| Scout | `#3EE6A8` mint | `#2F3B5C` slate | speed, fresh, clashes with no faction |
| Ranger | `#F5B53D` saffron gold | `#2A211C` bisht brown | precision, prestige (bisht gold edging) |
| Titan | `#FF8A3D` ember copper | `#3A4254` gunmetal | heat, mass |

### 2.5 Rarity frames (`items.rarity` in `008_items.sql`)
common `#9AA4B2` · rare `#2DD4BF` · legendary `#F5B53D` (with a subtle gold
gradient). Rare is deliberately *not* blue, because blue is the Falcons'
colour.

### 2.6 Light mode (menus only; the battle stays night)
Background `#F3F6FB`, panel `#FFFFFF`, text `#0B1020`, borders `#D5DCE8`.
The semantic colours stay the same hue but use darker text variants:
hp `#D92D3F`, en `#0891B2`, gold `#B7791F`.

## 3. Shape language and silhouettes

Gulf motifs used as **shape**, not decoration:
- **Khatam / 8-point star** (two overlapping squares): emblems, the Titan chest
  core, the AYAZ orb, tile pattern of the arena floor.
- **Mashrabiya lattice**: emissive cut-outs (Titan pauldrons, panel
  backgrounds, arena boundary pylons).
- **Dhow-sail and falcon-wing curves**: Scout scarf, Pulse Blade's gentle
  saif curve, UI corner cuts.
- **Khanjar J-curve**: the Shadow Dagger silhouette.
- **Bisht with gold edging over a white thobe line**: the Ranger, modernised as
  a tech coat. It is a respectful nod to the garment, not a costume.

| Class | Primary shape | Front read | Top-down read (what the battle camera sees) |
|---|---|---|---|
| **Scout** «الكشّاف» | inverted triangle, asymmetric | hood point, face scarf, mint visor, trailing scarf tail, slim legs | teardrop pointing forward, plus a scarf tail behind. Smallest footprint (≈0.8 m) |
| **Ranger** «الرامي» | tall rectangle / ellipse | long coat to the shins with gold edges, cannon held across the body | long oval, plus a long barrel sticking out 1 m ahead |
| **Titan** «الصامد» | square / trapezoid | huge pauldrons, small rounded helmet with a glowing chevron visor (deliberately not a crusader-style T-visor), hammer resting head-down | wide rounded rectangle with two pauldron circles. Biggest footprint (≈1.3 m) |

Arabic class names are **proposals**: `StringTable.cs` has no class-name keys
yet, so these go through the language reviewer. "العملاق" was rejected for the
Titan class because it collides with the faction «العمالقة» (Titans) from
`STORY_DRAFT.md`. "الجبّار" was rejected because it is a Divine Name.
Proposed weapon names: نصل النبض، خنجر الظل، مطرقة العملاق، مدفع النفوذ.
Proposed consumable names: حزمة طاقة، حقيبة إسعاف، منارة استغاثة.

Weapon ↔ class pairing in the concepts is **visual only**. Code lets any class
use any weapon. `BattleManager` currently gives everyone Pulse Blade, and the
only code link is Ranger's +1 m passive on Influence Cannon. So every character
also needs a Pulse Blade hand-pose.

## 4. Lighting and materials (URP mobile)

**Lighting rule for all art (concepts, renders, icons):** key light from the
**upper-left**, warm (`#FFB870` tint). Rim light from the back-right, cyan
(`#22D3EE`). Ambient is a flat navy (`#1C2547`). Icons follow the same rule so
the inventory and the 3D world feel like one game.

URP setup (the existing asset is `Assets/_Project/settings/New Universal Render
Pipeline Asset.asset`):
- 1 realtime directional light. Soft shadows **off** and shadow distance 25 m
  for Alpha (two characters only). Use a **blob shadow** (a quad with a
  radial texture, Unlit, 128²) under each character instead of cascaded
  shadows if the frame time on the test phone exceeds 16 ms.
- MSAA 2×, HDR off, post-processing off for Alpha. Bloom costs 1–2 ms on
  mid-range Mali/Adreno GPUs. Glow comes from the emission colour plus an
  additive soft quad, which you add only if bloom stays off.
- SRP Batcher on (the default). All character, weapon and prop materials use
  **URP/Lit** (or **URP/Simple Lit** if Lit is too slow) so they batch. Never
  use built-in/Standard shaders. That is the pink capsule bug.
- Textures: ASTC (Android). Use 6×6 for 3D BaseMap, 4×4 for UI and icons,
  and the Normal Map type at 6×6.
- Per character: **1 material**, maps `BaseMap` 1024², `MetallicGlossMap`
  512² (R = metal, A = smoothness), `EmissionMap` 512² (accent only), and
  an optional `NormalMap` 512². Mobile target per character: ≤ 3 texture
  samples in Simple Lit, ≤ 4 in Lit.
- Faction tint stays off the body. The faction ring is a separate quad with 4
  material variants (`M_Ring_Falcons`, etc.). Picking the right variant at
  runtime would need a code hook (see §6.4).

## 5. Typography

- Existing: `Assets/_Project/Fonts/NotoSansArabic/NotoSansArabic-Regular SDF.asset`
  (OFL) and `DejaVuSans SDF` as fallback. `com.nosuchstudio.rtltmpro` v4.0.0 is
  in the manifest.
- Needed: a **Bold/SemiBold** Arabic SDF (Noto Sans Arabic Bold, or Noto Kufi
  Arabic Bold for display headings, both OFL), with Latin in the fallback chain.
  SDF atlas 2048², padding 9, with a glyph set built from `StringTable.cs`
  (the existing `ProjectFont_HasEveryGlyphTheUiDraws` test guards it).
- Legacy `Text` components cannot shape Arabic (art-reference/README). This is
  a UI-build task, not art, but no panel art can be signed off until its text
  renders in TMP/RTLTMPro.

## 6. Fixing the pink capsule (do this first; ~30–45 min in the Editor)

**Root cause (confirmed in the committed YAML):** renderers reference Unity's
built-in `Default-Material`, `{fileID: 10303, guid: 0000000000000000f000000000000000}`.
That material uses the built-in Standard shader, which URP cannot draw, and
the Render Pipeline Converter **never upgrades built-in materials**
(`MAPBOX_V3_SETUP.md` already learned this on the Mapbox placeholder).
`HANDOFF.md` item 35 notes "The capsule shows pink (built-in material under
URP)".

There are 11 renderer slots in 5 files, as committed:

| File | Slots | Objects |
|---|---|---|
| `Prefabs/Networking/NetworkPlayer.prefab` | 2 | `Visual` (capsule), `Facing` (cube) |
| `Prefabs/Map/NearbyPlayerMarker.prefab` | 4 | capsule, cube, cylinder, + 1 |
| `Prefabs/Map/PlayerMarker.prefab` | 2 | sphere, cube |
| `Scenes/Battle.unity` | 1 | `Arena` plane |
| `Scenes/MainMap.unity` | 2 | placeholder capsule / cylinder (check whether the laptop fix from MAPBOX_V3_SETUP was committed) |

`Assets/_Project/settings/New Material.mat` already exists (URP/Lit, white),
but nothing references it.

Steps (Unity Editor, laptop):
1. Create `Assets/_Project/Art/Materials/`. Right-click, then Create → Material.
   In a URP project this defaults to **Universal Render Pipeline/Lit**. Make:
   - `M_Placeholder_Body` Lit, Base `#5B6578`, Smoothness 0.3
   - `M_Placeholder_Facing` **Unlit**, `#3EE6A8` (shows the facing direction)
   - `M_Arena_Floor` Lit, Base `#1C2547`, Smoothness 0.15
   - `M_Marker_Self` Unlit `#F5B53D`, `M_Marker_Other` Unlit `#C9D3E6`
2. Open each prefab or scene above. For every MeshRenderer whose Element 0 is
   `Default-Material`, drag the matching material in. Save.
3. Check: Window → Analysis → Frame Debugger. No magenta, and no draw call
   uses `Hidden/InternalErrorShader`. Build to the phone and check Battle and
   MainMap.
4. Commit the new `.mat` + `.meta` files and the re-saved prefabs and scenes.
   No secrets are involved.
5. Optional guard: an EditMode test that fails if any file under
   `Assets/_Project` contains `fileID: 10303, guid: 0000000000000000f000000000000000`.
   This only edits a test, and it stops the regression.

### 6.4 The one code hook real characters will need (flag for owner approval)
`NetworkPlayer.prefab` is a single prefab with one `Visual` child, while the
class is networked (`NetworkedClass`). Showing a Scout model for Scouts needs a
tiny presenter: three child visuals, with only the matching one enabled. That
is a few lines of C# and touches no gameplay, but it *is* code. The Build
Recovery rules allow "scene/prefab construction for what already exists in
code", so the owner should explicitly approve it. Until then, ship one neutral
body for everyone.

## 7. Alpha production asset list (priority order)

Sizes: "icon master" means a vector SVG or 512² PNG on a transparent
background, exported to the listed sizes. Every UI sprite goes into one
**Sprite Atlas** `SA_UI` (2048², ASTC 4×4, mip-maps off).

### P0: blocks a credible Alpha, all code-referenced
| # | Asset | Spec | Code reference | Effort |
|---|---|---|---|---|
| 1 | URP placeholder materials (pink fix) | §6 | prefabs and scenes above | 0.1 d |
| 2 | Arabic Bold SDF font asset + fallback chain | 2048² SDF, padding 9, glyphs from StringTable | `LocalizationManager`, `ArabicUiAssetTests` | 0.5 d |
| 3 | Battle action button icons ×4: Attack, Special, Dodge, Class Ability | master 512, export 160² (button @3x), 96²; white glyph on transparent, tinted in UI; plus a cooldown radial-fill sprite 160² | `CombatActionInput.CombatAction` (4 bits), the "four ready icons" in `Battle.unity` | 1 d |
| 4 | Weapon icons ×4: Pulse Blade, Shadow Dagger, Titan Hammer, Influence Cannon | master 512, export 256² (inventory card), 128² (loadout/HUD), 64²; drawn at 30° angle, key upper-left | `WeaponDatabase` consts, `008_items.sql` | 1.5 d |
| 5 | Consumable icons ×3: Energy Pack, Health Kit, SOS Beacon | same sizes as weapons. **Health Kit must not use a red cross or red crescent** (protected emblems); use a heart + pulse line | `008_items.sql` | 0.75 d |
| 6 | Class icons ×3 + class card art | emblem master 512 → 128², 64²; card illustration 768×1024 (portrait, ASTC 6×6) | `ClassSelectionCard.prefab`, `OnboardingController` | 2 d |
| 7 | Status icons ×2: Controlled, Protected | 128², 64², 48² (map marker) | `PlayerControlStatusIcon`, `NearbyPlayerMarkerUi` | 0.5 d |
| 8 | AYAZ button icon | 128², 96² (holographic orb with khatam star) | `MainMapScreen.ayazButton` | 0.25 d |
| 9 | UI 9-slice kit | panel 128² (24 px borders), button 96² (20 px), pill 64², toast 128×64, popup 256² with header strip, bar frame + fill 256×32, result banners Win/Lose/Draw 1024×256; bottom-nav icons ×5 (MainMap, Inventory, Friends, Quest, Profile) 96². All drawn RTL-neutral, or mirrored via `RtlLayoutFlip` | `ScreenId`, `Popup`, `NotificationToast`, `SOSBanner`, `Battle.unity` HealthSlider/EnergySlider/ResultPanel/DrawPanel | 3 d |

### P1: makes battle look like a game (3D)
| # | Asset | Spec | Code reference | Effort (artist days) |
|---|---|---|---|---|
| 10 | Battle arena floor | 30 m diameter (`Constants.Combat.ArenaRadiusMeters` = 15). ≤ 6k tris, 1 tiling khatam floor texture 1024² + 1 trim sheet 1024², an emissive boundary ring at r = 15 m, 8 boundary pylons (mashrabiya). 1 material + 1 Unlit for the ring | `Battle.unity` `Arena` | 3 d |
| 11 | Character: Scout | ≤ 6,500 tris; Humanoid rig ≤ 40 bones (no fingers, 1 `WeaponSocket_R` bone); 1 mat, BaseMap 1024², Metal/Smooth 512², Emission 512²; height 1.75 m, footprint ≤ 0.8 m | `PlayerClass.Scout` | 5–7 d |
| 12 | Character: Ranger | ≤ 7,000 tris; same rig and maps; coat is skinned (no cloth sim) | `PlayerClass.Ranger` | 5–7 d |
| 13 | Character: Titan | ≤ 8,000 tris; same rig, wider skeleton proportions; footprint ≤ 1.3 m | `PlayerClass.Titan` | 6–8 d |
| 14 | Weapons ×4 (meshes) | Pulse Blade ≤ 900 tris, Shadow Dagger ≤ 600, Titan Hammer ≤ 1,500, Influence Cannon ≤ 1,800. **One shared 1024² atlas** + 512² emission; pivot at grip, +Z forward; length to scale: blade 1.1 m, dagger 0.45 m, hammer 1.4 m, cannon 1.3 m | `WeaponDatabase` | 4 d |
| 15 | Rescue Guard NPC «حارس الطوق الرقمي» | ≤ 7,000 tris, reuses the Titan rig, neutral ink/white + AYAZ cyan, no faction colour | `RescueGuardController` | 4 d |
| 16 | Map markers (self / nearby) | ≤ 800 tris each, Unlit, faction ring variants ×4 | `PlayerMarker.prefab`, `NearbyPlayerMarker.prefab` | 1 d |
| 17 | Faction ground rings ×4 | quad, 256² radial texture, Unlit additive | name plate / ring in `NetworkPlayer` | 0.25 d |

### P2: animation (staged, not wired)
`art-reference/README.md` confirms that **no Animator or animation system exists
in code**, so wiring clips in is a new system and needs owner approval. Produce
and import the clips (Humanoid, 30 fps, root motion off) so they are ready.
Contact frames are matched to the approved wind-up values so that, once wired,
the visuals agree with server-validated timing:

| Clip | Length | Contact / key frame (30 fps) | Source value |
|---|---|---|---|
| Idle (×3 class variants) | 2 s loop | n/a | |
| Run | 0.8 s loop | n/a | `NetworkPlayerController.moveSpeed` 4 m/s |
| Pulse Blade basic slash | 0.65 s | f6 (0.20 s) | Range 2.2, Cycle 0.65 |
| Pulse Arc (140° sweep) | 0.80 s | f13–14 (0.45 s), recovery 0.35 | |
| Shadow Dagger stab | 0.40 s | f4 (0.12 s) | |
| Shadow Lunge (3 m dash) | 0.60 s | f7–8 (0.25 s) | |
| Titan Hammer swing | 1.20 s | f16–17 (0.55 s) | basic costs 5 EN |
| Ground Break (3 m AoE slam) | 1.10 s | f22–23 (0.75 s) | |
| Influence Cannon shot | 0.80 s | f7–8 (0.25 s) | |
| Charged Pulse | 1.00 s | f19–20 (0.65 s), projectile 18 m/s | |
| Dodge roll | 0.30 s | i-frames 0–0.2 s | `DodgeDurationSeconds` |
| Blink Step | 0.25 s | i-frames 0–0.2 s, 4 m | `ClassAbilityDatabase` |
| Focus Shot (self-buff pose) | 0.40 s | action lock 0.2 s | |
| Bulwark (guard) | 0.40 s in, then a 3 s hold loop | action lock 0.2 s | |
| Hit react ×2, KO, Victory | 0.4 / 1.2 / 2 s | | Result flow |

VFX and audio are out of scope (README).

## 8. Low-cost route (honest)

| Route | What you get | Real cost | Real effort | Catches |
|---|---|---|---|---|
| **A. Unity Asset Store kit-bash** (e.g. Synty POLYGON City / Sci-Fi City class packs; Layer Lab GUI kits; a 2D icon pack) | Mobile-ready low-poly characters and props, ready UI 9-slices | roughly US$50–250 total, often less in sales (check current prices) | 4–6 days of a generalist: recolour textures to §2, swap heads/props, build 3 class variants, weapons from props | The look is generic and seen in many games, and it won't read as "Gulf" without custom heads, coats and the khanjar. The Asset Store EULA is per-seat for "Restricted Assets", so check before sharing the repo publicly |
| **B. Mixamo** (Adobe, free) | Auto-rig an FBX you supply; a large free animation library; free stock characters | US$0 | 1–2 days to retarget P2 clips to Humanoid and strip fingers (Mixamo rig ~65 bones → bake to ≤ 40) | Clips are generic; timing must be trimmed to §7's contact frames. You cannot redistribute raw Mixamo files as assets |
| **C. Commission** (ArtStation / Upwork / regional studios, preferably an Arabic-speaking artist) | Custom 3 characters + 4 weapons + arena that match this bible | about US$300–1,200 per character, US$100–300 per weapon, US$200–800 for the full icon/UI set (market ranges, not quotes) | 3–6 calendar weeks including revisions; 1–2 owner review rounds per asset | Needs a signed work-for-hire / IP assignment and source files (.blend/.fbx/.spp) delivered |
| **D. In-house from these concepts** | Icons and UI straight from `concept.html` vectors | US$0 | 2–3 days for P0 #3–#9 in Figma, Inkscape or Illustrator | 3D still needs A, B or C |

**Recommendation:** do **D for all of P0** now (it is what blocks the Alpha
UI). For 3D, use **A + B** for the first 20-player test: one kit-bashed body per
class in the §2 colours, with Mixamo idle/run staged. Commission (C) only after
the test shows players stay, starting with the Scout, which is the default
`classType` fallback. Total for an Alpha-credible look: **about 10–14 person-days
plus under US$300**.

## 9. Sign-off checklist per asset
- [ ] Silhouette test: the asset filled solid black is still identifiable at
      64 px and from the top-down view.
- [ ] Uses only §2 colours. Faction colour only on rings, plates and markers.
- [ ] Lit upper-left warm with a back-right cyan rim (renders and icons).
- [ ] Within poly/texture budget; 1 material (characters), shared atlas (weapons).
- [ ] URP/Lit, Simple Lit or Unlit only. No `Default-Material`.
- [ ] Arabic label checked by a native reviewer and rendered through TMP/RTLTMPro.
- [ ] No credentials, licence keys or store invoices committed (CLAUDE.md).
