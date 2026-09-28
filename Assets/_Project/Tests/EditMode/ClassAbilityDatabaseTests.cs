using Nfouz.Combat;
using Nfouz.Utils;
using NUnit.Framework;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for ClassAbilityDatabase.cs.
    ///
    /// Sprint 6 final gameplay-completion pass: rewritten to assert the
    /// EXACT approved GDD values — the previous pass's placeholder values
    /// (flagged there as not yet approved) have all been replaced, and
    /// this suite now checks them the same way WeaponDatabaseTests.cs
    /// checks the four weapons' exact numbers. Written for Unity Test
    /// Framework; not executed in this sandbox (no Unity Editor) — see
    /// DamageCalculatorTests.cs's header note.
    /// </summary>
    [TestFixture]
    public class ClassAbilityDatabaseTests
    {
        [Test]
        public void Scout_BlinkStep_MatchesLatestGdd()
        {
            var stats = ClassAbilityDatabase.GetDefaultStats(Constants.PlayerClass.Scout);

            Assert.AreEqual(ClassAbilityDatabase.BlinkStep, stats.AbilityName);
            Assert.AreEqual(4f, stats.DashDistanceMeters);
            Assert.AreEqual(0.25f, stats.DurationSeconds);
            Assert.AreEqual(0.2f, stats.InvulnerabilitySeconds);
            Assert.AreEqual(25, stats.EnergyCost);
            Assert.AreEqual(12f, stats.Cooldown);
        }

        [Test]
        public void Ranger_FocusShot_MatchesLatestGdd_AndIsABuffNotADirectAttack()
        {
            var stats = ClassAbilityDatabase.GetDefaultStats(Constants.PlayerClass.Ranger);

            Assert.AreEqual(ClassAbilityDatabase.FocusShot, stats.AbilityName);
            Assert.AreEqual(5f, stats.BuffDurationSeconds);
            Assert.AreEqual(6, stats.BonusDamage);
            Assert.AreEqual(25, stats.EnergyCost);
            Assert.AreEqual(12f, stats.Cooldown);
            // Focus Shot has no dash distance, no absorb amount — it is
            // purely a self-buff, not a direct attack of its own.
            Assert.AreEqual(0f, stats.DashDistanceMeters);
            Assert.AreEqual(0, stats.AbsorbAmount);
        }

        [Test]
        public void Titan_Bulwark_MatchesLatestGdd_AndIsAnAbsorptionPoolNotAPercentage()
        {
            var stats = ClassAbilityDatabase.GetDefaultStats(Constants.PlayerClass.Titan);

            Assert.AreEqual(ClassAbilityDatabase.Bulwark, stats.AbilityName);
            Assert.AreEqual(25, stats.AbsorbAmount);
            Assert.AreEqual(3f, stats.DurationSeconds);
            Assert.AreEqual(30, stats.EnergyCost);
            Assert.AreEqual(15f, stats.Cooldown);
            // Bulwark has no bonus damage, no buff duration — it is a
            // self damage-absorption pool, not a buff on outgoing hits.
            Assert.AreEqual(0, stats.BonusDamage);
            Assert.AreEqual(0f, stats.BuffDurationSeconds);
        }

        [Test]
        public void UnknownClass_ReturnsEmptyStats()
        {
            var stats = ClassAbilityDatabase.GetDefaultStats("NotARealClass");

            Assert.IsTrue(string.IsNullOrEmpty(stats.AbilityName));
        }

        [Test]
        public void ClassAbilityStats_HasNoLeftoverPlaceholderFields()
        {
            // The previous pass's placeholder model used Damage/Range/
            // RecoverySeconds/DamageReductionFraction — this test exists
            // to fail loudly if any of those old field names are ever
            // reintroduced without an explicit decision.
            var fieldNames = new System.Collections.Generic.List<string>();
            foreach (var field in typeof(ClassAbilityStats).GetFields())
            {
                fieldNames.Add(field.Name);
            }

            CollectionAssert.DoesNotContain(fieldNames, "Damage");
            CollectionAssert.DoesNotContain(fieldNames, "Range");
            CollectionAssert.DoesNotContain(fieldNames, "RecoverySeconds");
            CollectionAssert.DoesNotContain(fieldNames, "DamageReductionFraction");
            CollectionAssert.Contains(fieldNames, "BonusDamage");
            CollectionAssert.Contains(fieldNames, "AbsorbAmount");
            CollectionAssert.Contains(fieldNames, "BuffDurationSeconds");
            CollectionAssert.Contains(fieldNames, "InvulnerabilitySeconds");
        }
    }
}
