# Art Reference

**No art assets exist in this repository yet.** This folder is a placeholder
for reference material and, later, produced assets. Nothing here should be
invented or faked during Build Recovery — assets are added only when
actually produced or sourced.

## Confirmed, code-referenced art requirements (from the current script set)

- **Icons — weapons (4):** Pulse Blade, Shadow Dagger, Titan Hammer,
  Influence Cannon (`backend/migrations/008_items.sql` seed data,
  `unity/Assets/_Project/Scripts/Combat/WeaponDatabase.cs`).
- **Icons — consumables (3):** Energy Pack, Health Kit, SOS Beacon (same
  seed data).
- **Icons — classes (3):** Scout, Ranger, Titan (`Constants.PlayerClass`,
  the `ClassSelectionCard` prefab).
- **Icons — status:** Controlled / Protected indicators
  (`PlayerControlStatusIcon.cs`).
- **Fonts — highest priority:** an Arabic-capable TextMeshPro Font Asset.
  The app defaults to Arabic (`LocalizationManager`), and Unity's default
  TMP font has no Arabic glyph coverage. Most existing UI scripts also use
  legacy `Text` rather than TMP, which cannot shape Arabic correctly at
  all — this is a real, confirmed risk, not a generic checklist item.
- **UI backgrounds:** panel backgrounds for every screen (Popup,
  Notification toast, Result panels, etc.) — no image assets exist.

## Explicitly out of scope for Build Recovery

Animation, audio (music/SFX), and VFX are **not missing assets** — no
animation, audio-playback, or particle/VFX system exists anywhere in the
current codebase (confirmed by code search). These are new systems, not
recovery gaps, and are not part of Build Recovery per `CLAUDE.md`'s
no-new-features rule.

See `build-recovery/RECOVERY_STATUS.md` for how this fits into the overall
recovery sequence.
