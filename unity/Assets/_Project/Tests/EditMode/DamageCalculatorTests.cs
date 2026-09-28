using Nfouz.Combat;
using Nfouz.Utils;
using NUnit.Framework;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for DamageCalculator.cs. Written for Unity Test
    /// Framework (NUnit) — this sandbox has no Unity Editor/compiler, so
    /// these are NOT executed here; the same arithmetic was independently
    /// verified by real Node.js execution during verification (see the
    /// sprint's verification report) to confirm the formula itself is
    /// correct, but running these exact C# tests requires the Unity Test
    /// Runner.
    ///
    /// Sprint 6 correction pass: Critical Hit is removed entirely from
    /// Alpha combat (no random chance, no multiplier, no randomized
    /// damage) — CalculateDamage no longer takes criticalChance/
    /// criticalMultiplier parameters at all, and is now purely
    /// deterministic. The former CriticalChance* tests are replaced with
    /// determinism tests below.
    /// </summary>
    [TestFixture]
    public class DamageCalculatorTests
    {
        [Test]
        public void CalculateDamage_PulseBladeVsScout_ReturnsExpectedValue()
        {
            // 18 * 1.0 * 1 - 2 = 16
            var damage = DamageCalculator.CalculateDamage(
                baseDamage: 18, classAttackMultiplier: 1.0f, weaponMultiplier: 1f,
                targetDefense: 2);

            Assert.AreEqual(16, damage);
        }

        [Test]
        public void CalculateDamage_NeverGoesBelowMinimumDamage()
        {
            // 5 * 1.0 * 1 - 10 = -5, floored to MinimumDamage (1)
            var damage = DamageCalculator.CalculateDamage(
                baseDamage: 5, classAttackMultiplier: 1.0f, weaponMultiplier: 1f,
                targetDefense: 10);

            Assert.AreEqual(Constants.Combat.MinimumDamage, damage);
        }

        [Test]
        public void CalculateDamage_IsFullyDeterministic_SameInputsAlwaysProduceSameOutput()
        {
            // No Critical Hit roll anywhere — repeated calls with the same
            // inputs must always return exactly the same value, unlike the
            // pre-correction version which could roll a critical.
            var first = DamageCalculator.CalculateDamage(28, 0.9f, 1f, 2);
            for (var i = 0; i < 50; i++)
            {
                var repeat = DamageCalculator.CalculateDamage(28, 0.9f, 1f, 2);
                Assert.AreEqual(first, repeat, "CalculateDamage must be deterministic — no Critical Hit system in Alpha.");
            }
        }

        [Test]
        public void CalculateDamage_TitanHammerVsRanger_MatchesHandComputedValue()
        {
            // 32 * 0.9 - 4 = 24.8 -> rounds to 25
            var damage = DamageCalculator.CalculateDamage(
                baseDamage: 32, classAttackMultiplier: 0.9f, weaponMultiplier: 1f,
                targetDefense: 4);

            Assert.AreEqual(25, damage);
        }

        [TestCase(Constants.PlayerClass.Scout, 1.0f)]
        [TestCase(Constants.PlayerClass.Ranger, 1.15f)]
        [TestCase(Constants.PlayerClass.Titan, 0.9f)]
        public void GetClassAttackMultiplier_MatchesApprovedTable(string classType, float expectedMultiplier)
        {
            Assert.AreEqual(expectedMultiplier, DamageCalculator.GetClassAttackMultiplier(classType));
        }

        [TestCase(Constants.PlayerClass.Scout, 2)]
        [TestCase(Constants.PlayerClass.Ranger, 4)]
        [TestCase(Constants.PlayerClass.Titan, 10)]
        public void GetClassDefense_MatchesApprovedTable(string classType, int expectedDefense)
        {
            Assert.AreEqual(expectedDefense, DamageCalculator.GetClassDefense(classType));
        }
    }
}
