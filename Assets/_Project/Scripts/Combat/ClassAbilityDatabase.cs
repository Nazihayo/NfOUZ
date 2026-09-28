using Nfouz.Utils;

namespace Nfouz.Combat
{
    /// <summary>
    /// Class ability data — Scout "Blink Step", Ranger "Focus Shot", Titan
    /// "Bulwark".
    ///
    /// Sprint 6 final gameplay-completion pass: replaces EVERY placeholder
    /// value from the previous pass (flagged there as pending real GDD
    /// numbers) with the latest detailed GDD's exact, approved values.
    /// There are no placeholders left in this file.
    /// </summary>
    public static class ClassAbilityDatabase
    {
        public const string BlinkStep = "Blink Step"; // Scout
        public const string FocusShot = "Focus Shot"; // Ranger
        public const string Bulwark = "Bulwark"; // Titan

        /// <summary>Approved GDD values — see this class's own doc comment.</summary>
        public static ClassAbilityStats GetDefaultStats(string classType)
        {
            switch (classType)
            {
                case Constants.PlayerClass.Scout:
                    // Blink Step: a 4m dash, 0.25s total duration, with
                    // the first 0.2s fully invulnerable — the same
                    // full-negation invulnerability model as the
                    // universal Dodge (see PlayerCombat.IsInvulnerable),
                    // but a longer dash, its own 12s cooldown, and its
                    // own 25-energy cost, on top of (not instead of)
                    // Scout's ordinary Dodge.
                    return new ClassAbilityStats
                    {
                        AbilityName = BlinkStep,
                        DashDistanceMeters = 4f,
                        DurationSeconds = 0.25f,
                        InvulnerabilitySeconds = 0.2f,
                        EnergyCost = 25,
                        Cooldown = 12f,
                    };

                case Constants.PlayerClass.Ranger:
                    // Focus Shot: NOT a direct attack — activating it
                    // grants a 5-second self-buff. The next successful
                    // basic OR special hit within that window gains +6
                    // damage and consumes the buff; it does not stack
                    // (re-activating while already active does not grant
                    // a second pending bonus).
                    return new ClassAbilityStats
                    {
                        AbilityName = FocusShot,
                        BuffDurationSeconds = 5f,
                        BonusDamage = 6,
                        EnergyCost = 25,
                        Cooldown = 12f,
                    };

                case Constants.PlayerClass.Titan:
                    // Bulwark: absorbs a flat 25 total damage over the
                    // next 3 seconds (a shield/pool, not a percentage
                    // reduction — see PlayerCombat.ApplyDamage's Bulwark
                    // branch). Whatever is left unused when the 3s
                    // duration ends is lost, not banked.
                    return new ClassAbilityStats
                    {
                        AbilityName = Bulwark,
                        AbsorbAmount = 25,
                        DurationSeconds = 3f,
                        EnergyCost = 30,
                        Cooldown = 15f,
                    };

                default:
                    return default;
            }
        }
    }

    /// <summary>Plain-data class-ability stats. Not every field applies to
    /// every class — see GetDefaultStats' per-class construction.</summary>
    [System.Serializable]
    public struct ClassAbilityStats
    {
        public string AbilityName;
        public int EnergyCost;
        public float Cooldown;

        // Scout — Blink Step
        public float DashDistanceMeters;
        public float DurationSeconds; // also reused by Titan — see below
        public float InvulnerabilitySeconds;

        // Ranger — Focus Shot (a self-buff, not a direct attack)
        public float BuffDurationSeconds;
        public int BonusDamage;

        // Titan — Bulwark
        public int AbsorbAmount;
        // DurationSeconds (above) doubles as Bulwark's 3s absorb window.
    }
}
