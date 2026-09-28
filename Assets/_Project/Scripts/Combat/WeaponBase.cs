using UnityEngine;

namespace Nfouz.Combat
{
    /// <summary>
    /// Weapon data as a ScriptableObject asset.
    ///
    /// Sprint 6 correction pass: base stats use the latest detailed NFOUZ
    /// GDD's model (damage / range / wind-up / attack cycle). Critical
    /// Hit fields are removed entirely — Alpha combat has no random
    /// critical chance, multiplier, or randomized damage of any kind (see
    /// DamageCalculator.cs).
    ///
    /// Sprint 6 final security correction: special abilities are replaced
    /// with the latest detailed GDD's named abilities (Pulse Arc, Shadow
    /// Lunge, Ground Break, Charged Pulse) and their exact values —
    /// SpecialDamageMultiplier is replaced by a flat SpecialDamage value,
    /// since the GDD gives explicit damage numbers per special rather
    /// than a multiplier of BaseDamage. New geometry/behavior fields
    /// (arc, dash distance, radius, knockback, projectile speed/radius,
    /// recovery, whether the special grants invulnerability) are added as
    /// DATA — see WeaponDatabase.cs's doc comment for why the actual
    /// arc/AoE/dash/projectile hit-detection geometry is not implemented
    /// as gameplay code in this pass (consistent with the original Sprint
    /// 6 Titan Hammer AoE+freeze precedent).
    /// </summary>
    [CreateAssetMenu(fileName = "NewWeapon", menuName = "NFOUZ/Weapon")]
    public class WeaponBase : ScriptableObject
    {
        public string WeaponName;
        public int BaseDamage;
        public float Range;

        [Tooltip("Seconds of wind-up before a basic attack's damage is applied.")]
        public float WindUpSeconds;

        [Tooltip("Seconds between the start of one basic attack and when the next can begin — replaces the old 1/AttackSpeed cooldown model.")]
        public float AttackCycleSeconds;

        public int BasicAttackEnergyCost;

        [Header("Special Ability — latest detailed GDD values")]
        public string SpecialName;
        public int SpecialDamage;
        public float SpecialWindUpSeconds;
        public float SpecialCooldown;
        public int SpecialEnergyCost;

        [Tooltip("Seconds after the special resolves before any other action may begin — GDD: 0.35s for all four weapons.")]
        public float SpecialRecoverySeconds;

        [Tooltip("True only if this special explicitly grants invulnerability (none of the four approved specials do — Shadow Lunge explicitly does not).")]
        public bool SpecialGrantsInvulnerability;

        [Header("Special Ability — geometry (data only, see class doc comment)")]
        [Tooltip("Pulse Arc: 3m. Charged Pulse: 12m. 0 for specials that use a radius/dash instead of a range.")]
        public float SpecialRange;

        [Tooltip("Pulse Arc: 140 degrees. 0 for non-arc specials.")]
        public float SpecialArcDegrees;

        [Tooltip("Shadow Lunge: 3m dash. 0 for non-dash specials.")]
        public float SpecialDashDistanceMeters;

        [Tooltip("Ground Break: 3m AoE radius. 0 for non-AoE specials.")]
        public float SpecialRadiusMeters;

        [Tooltip("Ground Break: 1m knockback. 0 for specials with no knockback.")]
        public float SpecialKnockbackMeters;

        [Tooltip("Charged Pulse: 18 m/s projectile speed. 0 for non-projectile specials.")]
        public float SpecialProjectileSpeed;

        [Tooltip("Charged Pulse: 0.2m projectile radius. 0 for non-projectile specials.")]
        public float SpecialProjectileRadius;
    }
}
