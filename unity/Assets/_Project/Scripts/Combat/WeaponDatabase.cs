using System.Collections.Generic;
using UnityEngine;

namespace Nfouz.Combat
{
    /// <summary>
    /// Looks up a WeaponBase by name. Backed by an Inspector-assigned array
    /// of WeaponBase ScriptableObject assets (one per approved weapon —
    /// Pulse Blade, Shadow Dagger, Titan Hammer, Influence Cannon), with a
    /// built-in fallback data table so combat works correctly even before
    /// those four .asset files are hand-created in the Unity Editor
    /// (ScriptableObject assets are editor-authored binary/YAML content
    /// that cannot be produced as a source file).
    ///
    /// Sprint 6 correction pass: base stats (damage / range / wind-up /
    /// attack cycle) use the latest detailed NFOUZ GDD's values.
    ///
    /// Sprint 6 final security correction: special abilities are fully
    /// replaced with the latest detailed GDD's named abilities — Pulse
    /// Arc, Shadow Lunge, Ground Break, Charged Pulse — and their exact
    /// damage/energy/cooldown/recovery/wind-up values. At that point,
    /// geometry fields (arc degrees, dash distance, AoE radius, knockback,
    /// projectile speed/radius) were carried as DATA on WeaponStats/
    /// WeaponBase only, with TrySpecial in PlayerCombat.cs still resolving
    /// each special as a single-target hit validated against CanAttack's
    /// range check.
    ///
    /// Sprint 6 final gameplay-completion pass: those geometry fields are
    /// now real gameplay — see WeaponGeometry.cs and PlayerCombat.cs's
    /// TryPulseArc/TryShadowLunge/TryGroundBreak/TryChargedPulse. This
    /// class still only supplies the approved numeric data; the
    /// hit-detection logic itself lives in PlayerCombat/WeaponGeometry/
    /// ChargedPulseProjectile, not here.
    /// </summary>
    [CreateAssetMenu(fileName = "WeaponDatabase", menuName = "NFOUZ/Weapon Database")]
    public class WeaponDatabase : ScriptableObject
    {
        public const string PulseBlade = "Pulse Blade";
        public const string ShadowDagger = "Shadow Dagger";
        public const string TitanHammer = "Titan Hammer";
        public const string InfluenceCannon = "Influence Cannon";

        [SerializeField] private WeaponBase[] weapons;

        private Dictionary<string, WeaponBase> _lookup;

        /// <summary>Looks up an assigned WeaponBase asset by name, falling
        /// back to nothing (null) if the database was never populated in
        /// the Inspector — callers should use GetStatsOrDefault instead
        /// when they need a guaranteed non-null result.</summary>
        public WeaponBase GetByName(string weaponName)
        {
            if (_lookup == null)
            {
                BuildLookup();
            }

            _lookup.TryGetValue(weaponName, out var weapon);
            return weapon;
        }

        private void BuildLookup()
        {
            _lookup = new Dictionary<string, WeaponBase>();
            if (weapons == null)
            {
                return;
            }

            foreach (var weapon in weapons)
            {
                if (weapon != null && !string.IsNullOrEmpty(weapon.WeaponName))
                {
                    _lookup[weapon.WeaponName] = weapon;
                }
            }
        }

        /// <summary>
        /// Returns the assigned WeaponBase asset if one exists for this
        /// name, otherwise the exact approved stats as a plain data
        /// struct — guaranteeing correct combat behavior with zero
        /// Editor asset setup required.
        /// </summary>
        public WeaponStats GetStatsOrDefault(string weaponName)
        {
            var asset = GetByName(weaponName);
            if (asset != null)
            {
                return WeaponStats.FromAsset(asset);
            }

            return GetDefaultStats(weaponName);
        }

        /// <summary>The four approved weapons' stats — latest detailed
        /// NFOUZ GDD values for both base attack and special ability. Do
        /// not redesign these numbers without new approved values.</summary>
        public static WeaponStats GetDefaultStats(string weaponName)
        {
            switch (weaponName)
            {
                case PulseBlade:
                    return new WeaponStats
                    {
                        WeaponName = PulseBlade,
                        BaseDamage = 18,
                        Range = 2.2f,
                        WindUpSeconds = 0.20f,
                        AttackCycleSeconds = 0.65f,
                        BasicAttackEnergyCost = 0,
                        SpecialName = "Pulse Arc",
                        SpecialDamage = 26,
                        SpecialRange = 3f,
                        SpecialArcDegrees = 140f,
                        SpecialWindUpSeconds = 0.45f,
                        SpecialEnergyCost = 25,
                        SpecialCooldown = 8f,
                        SpecialRecoverySeconds = 0.35f,
                        SpecialGrantsInvulnerability = false,
                    };

                case ShadowDagger:
                    return new WeaponStats
                    {
                        WeaponName = ShadowDagger,
                        BaseDamage = 12,
                        Range = 1.5f,
                        WindUpSeconds = 0.12f,
                        AttackCycleSeconds = 0.40f,
                        BasicAttackEnergyCost = 0,
                        SpecialName = "Shadow Lunge",
                        SpecialDamage = 20,
                        SpecialDashDistanceMeters = 3f,
                        SpecialWindUpSeconds = 0.25f,
                        SpecialEnergyCost = 20,
                        SpecialCooldown = 7f,
                        SpecialRecoverySeconds = 0.35f,
                        SpecialGrantsInvulnerability = false, // explicitly no invulnerability per the GDD
                    };

                case TitanHammer:
                    return new WeaponStats
                    {
                        WeaponName = TitanHammer,
                        BaseDamage = 32,
                        Range = 2.5f,
                        WindUpSeconds = 0.55f,
                        AttackCycleSeconds = 1.20f,
                        BasicAttackEnergyCost = 5,
                        SpecialName = "Ground Break",
                        SpecialDamage = 36,
                        SpecialRadiusMeters = 3f,
                        SpecialKnockbackMeters = 1f,
                        SpecialWindUpSeconds = 0.75f,
                        SpecialEnergyCost = 35,
                        SpecialCooldown = 12f,
                        SpecialRecoverySeconds = 0.35f,
                        SpecialGrantsInvulnerability = false,
                    };

                case InfluenceCannon:
                    return new WeaponStats
                    {
                        WeaponName = InfluenceCannon,
                        BaseDamage = 15,
                        Range = 10f,
                        WindUpSeconds = 0.25f,
                        AttackCycleSeconds = 0.80f,
                        BasicAttackEnergyCost = 0,
                        SpecialName = "Charged Pulse",
                        SpecialDamage = 28,
                        SpecialRange = 12f,
                        SpecialWindUpSeconds = 0.65f,
                        SpecialProjectileSpeed = 18f,
                        SpecialProjectileRadius = 0.2f,
                        SpecialEnergyCost = 30,
                        SpecialCooldown = 10f,
                        SpecialRecoverySeconds = 0.35f,
                        SpecialGrantsInvulnerability = false,
                    };

                default:
                    Debug.LogError($"[WeaponDatabase] Unknown weapon name '{weaponName}' — no default stats exist.");
                    return default;
            }
        }
    }

    /// <summary>Plain-data mirror of WeaponBase's fields, so combat code
    /// can operate identically whether the source was an assigned
    /// ScriptableObject asset or the built-in default table.</summary>
    [System.Serializable]
    public struct WeaponStats
    {
        public string WeaponName;
        public int BaseDamage;
        public float Range;
        public float WindUpSeconds;
        public float AttackCycleSeconds;
        public int BasicAttackEnergyCost;

        public string SpecialName;
        public int SpecialDamage;
        public float SpecialWindUpSeconds;
        public float SpecialCooldown;
        public int SpecialEnergyCost;
        public float SpecialRecoverySeconds;
        public bool SpecialGrantsInvulnerability;

        // Geometry — data only, see WeaponDatabase's class doc comment.
        public float SpecialRange;
        public float SpecialArcDegrees;
        public float SpecialDashDistanceMeters;
        public float SpecialRadiusMeters;
        public float SpecialKnockbackMeters;
        public float SpecialProjectileSpeed;
        public float SpecialProjectileRadius;

        public static WeaponStats FromAsset(WeaponBase asset)
        {
            return new WeaponStats
            {
                WeaponName = asset.WeaponName,
                BaseDamage = asset.BaseDamage,
                Range = asset.Range,
                WindUpSeconds = asset.WindUpSeconds,
                AttackCycleSeconds = asset.AttackCycleSeconds,
                BasicAttackEnergyCost = asset.BasicAttackEnergyCost,
                SpecialName = asset.SpecialName,
                SpecialDamage = asset.SpecialDamage,
                SpecialWindUpSeconds = asset.SpecialWindUpSeconds,
                SpecialCooldown = asset.SpecialCooldown,
                SpecialEnergyCost = asset.SpecialEnergyCost,
                SpecialRecoverySeconds = asset.SpecialRecoverySeconds,
                SpecialGrantsInvulnerability = asset.SpecialGrantsInvulnerability,
                SpecialRange = asset.SpecialRange,
                SpecialArcDegrees = asset.SpecialArcDegrees,
                SpecialDashDistanceMeters = asset.SpecialDashDistanceMeters,
                SpecialRadiusMeters = asset.SpecialRadiusMeters,
                SpecialKnockbackMeters = asset.SpecialKnockbackMeters,
                SpecialProjectileSpeed = asset.SpecialProjectileSpeed,
                SpecialProjectileRadius = asset.SpecialProjectileRadius,
            };
        }
    }
}
