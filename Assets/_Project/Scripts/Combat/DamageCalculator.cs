using Nfouz.Core;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Combat
{
    /// <summary>
    /// Pure damage-math function.
    ///
    ///   FinalDamage = (BaseDamage * ClassAttackMultiplier * WeaponMultiplier) - Defense
    ///   FinalDamage = Max(FinalDamage, MinimumDamage)   // MinimumDamage = 1
    ///
    /// Sprint 6 correction pass: Critical Hit is removed entirely from
    /// Alpha combat per the latest detailed NFOUZ GDD — no random
    /// critical chance, no critical multiplier, and no randomized damage
    /// of any kind. This function is now fully deterministic: the same
    /// inputs always produce the same output (no Random.value roll
    /// anywhere in this class).
    /// </summary>
    public static class DamageCalculator
    {
        public static int CalculateDamage(
            int baseDamage,
            float classAttackMultiplier,
            float weaponMultiplier,
            int targetDefense)
        {
            float rawDamage = baseDamage * classAttackMultiplier * weaponMultiplier;
            float afterDefense = rawDamage - targetDefense;
            afterDefense = Mathf.Max(afterDefense, Constants.Combat.MinimumDamage);

            return Mathf.RoundToInt(afterDefense);
        }

        /// <summary>Class attack multiplier table — Battle System v1.0
        /// section 3.2. Scout 1.0x / Ranger 1.15x / Titan 0.9x.</summary>
        public static float GetClassAttackMultiplier(string classType)
        {
            switch (classType)
            {
                case Constants.PlayerClass.Scout: return 1.0f;
                case Constants.PlayerClass.Ranger: return 1.15f;
                case Constants.PlayerClass.Titan: return 0.9f;
                default: return 1.0f;
            }
        }

        /// <summary>Class defense (flat reduction) table — Battle System
        /// v1.0 section 3.2. Scout 2 / Ranger 4 / Titan 10.</summary>
        public static int GetClassDefense(string classType)
        {
            switch (classType)
            {
                case Constants.PlayerClass.Scout: return 2;
                case Constants.PlayerClass.Ranger: return 4;
                case Constants.PlayerClass.Titan: return 10;
                default: return 0;
            }
        }
    }
}
