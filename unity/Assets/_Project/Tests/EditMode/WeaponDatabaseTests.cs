using Nfouz.Combat;
using NUnit.Framework;
using UnityEngine;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for WeaponDatabase.cs's default stats table — proves
    /// the four approved weapons' data matches the latest detailed NFOUZ
    /// GDD.
    ///
    /// Sprint 6 final security correction: rewritten for the new special-
    /// ability model — a flat SpecialDamage value plus named abilities
    /// (Pulse Arc / Shadow Lunge / Ground Break / Charged Pulse) and their
    /// exact damage/energy/cooldown/recovery/wind-up numbers, replacing
    /// the old SpecialDamageMultiplier assertions. Written for Unity Test
    /// Framework; not executed in this sandbox (no Unity Editor) — see
    /// DamageCalculatorTests.cs's header note.
    /// </summary>
    [TestFixture]
    public class WeaponDatabaseTests
    {
        [Test]
        public void PulseBlade_BaseStats_MatchLatestGdd()
        {
            var stats = WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade);

            Assert.AreEqual(18, stats.BaseDamage);
            Assert.AreEqual(2.2f, stats.Range);
            Assert.AreEqual(0.20f, stats.WindUpSeconds);
            Assert.AreEqual(0.65f, stats.AttackCycleSeconds);
            Assert.AreEqual(0, stats.BasicAttackEnergyCost);
        }

        [Test]
        public void PulseBlade_PulseArc_MatchesLatestGdd()
        {
            var stats = WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade);

            Assert.AreEqual("Pulse Arc", stats.SpecialName);
            Assert.AreEqual(26, stats.SpecialDamage);
            Assert.AreEqual(3f, stats.SpecialRange);
            Assert.AreEqual(140f, stats.SpecialArcDegrees);
            Assert.AreEqual(0.45f, stats.SpecialWindUpSeconds);
            Assert.AreEqual(25, stats.SpecialEnergyCost);
            Assert.AreEqual(8f, stats.SpecialCooldown);
            Assert.AreEqual(0.35f, stats.SpecialRecoverySeconds);
            Assert.IsFalse(stats.SpecialGrantsInvulnerability);
        }

        [Test]
        public void ShadowDagger_BaseStats_MatchLatestGdd()
        {
            var stats = WeaponDatabase.GetDefaultStats(WeaponDatabase.ShadowDagger);

            Assert.AreEqual(12, stats.BaseDamage);
            Assert.AreEqual(1.5f, stats.Range);
            Assert.AreEqual(0.12f, stats.WindUpSeconds);
            Assert.AreEqual(0.40f, stats.AttackCycleSeconds);
        }

        [Test]
        public void ShadowDagger_ShadowLunge_MatchesLatestGdd_AndGrantsNoInvulnerability()
        {
            var stats = WeaponDatabase.GetDefaultStats(WeaponDatabase.ShadowDagger);

            Assert.AreEqual("Shadow Lunge", stats.SpecialName);
            Assert.AreEqual(20, stats.SpecialDamage);
            Assert.AreEqual(3f, stats.SpecialDashDistanceMeters);
            Assert.AreEqual(0.25f, stats.SpecialWindUpSeconds);
            Assert.AreEqual(20, stats.SpecialEnergyCost);
            Assert.AreEqual(7f, stats.SpecialCooldown);
            Assert.AreEqual(0.35f, stats.SpecialRecoverySeconds);
            // Explicitly stated in the GDD: Shadow Lunge grants no invulnerability.
            Assert.IsFalse(stats.SpecialGrantsInvulnerability);
        }

        [Test]
        public void TitanHammer_BaseStats_MatchLatestGdd_IncludingEnergyCostOnBasicAttack()
        {
            var stats = WeaponDatabase.GetDefaultStats(WeaponDatabase.TitanHammer);

            Assert.AreEqual(32, stats.BaseDamage);
            Assert.AreEqual(2.5f, stats.Range);
            Assert.AreEqual(0.55f, stats.WindUpSeconds);
            Assert.AreEqual(1.20f, stats.AttackCycleSeconds);
            Assert.AreEqual(5, stats.BasicAttackEnergyCost); // unlike the other three weapons, costs energy on basic attack
        }

        [Test]
        public void TitanHammer_GroundBreak_MatchesLatestGdd()
        {
            var stats = WeaponDatabase.GetDefaultStats(WeaponDatabase.TitanHammer);

            Assert.AreEqual("Ground Break", stats.SpecialName);
            Assert.AreEqual(36, stats.SpecialDamage);
            Assert.AreEqual(3f, stats.SpecialRadiusMeters);
            Assert.AreEqual(1f, stats.SpecialKnockbackMeters);
            Assert.AreEqual(0.75f, stats.SpecialWindUpSeconds);
            Assert.AreEqual(35, stats.SpecialEnergyCost);
            Assert.AreEqual(12f, stats.SpecialCooldown);
            Assert.AreEqual(0.35f, stats.SpecialRecoverySeconds);
        }

        [Test]
        public void InfluenceCannon_BaseStats_MatchLatestGdd()
        {
            var stats = WeaponDatabase.GetDefaultStats(WeaponDatabase.InfluenceCannon);

            Assert.AreEqual(15, stats.BaseDamage);
            Assert.AreEqual(10f, stats.Range); // longest range of the four weapons
            Assert.AreEqual(0.25f, stats.WindUpSeconds);
            Assert.AreEqual(0.80f, stats.AttackCycleSeconds);
        }

        [Test]
        public void InfluenceCannon_ChargedPulse_MatchesLatestGdd()
        {
            var stats = WeaponDatabase.GetDefaultStats(WeaponDatabase.InfluenceCannon);

            Assert.AreEqual("Charged Pulse", stats.SpecialName);
            Assert.AreEqual(28, stats.SpecialDamage);
            Assert.AreEqual(12f, stats.SpecialRange);
            Assert.AreEqual(0.65f, stats.SpecialWindUpSeconds);
            Assert.AreEqual(18f, stats.SpecialProjectileSpeed);
            Assert.AreEqual(0.2f, stats.SpecialProjectileRadius);
            Assert.AreEqual(30, stats.SpecialEnergyCost);
            Assert.AreEqual(10f, stats.SpecialCooldown);
            Assert.AreEqual(0.35f, stats.SpecialRecoverySeconds);
        }

        [Test]
        public void AllFourWeapons_ShareTheApproved035SecondRecovery()
        {
            // GDD: all four specials share a 0.35s recovery window.
            Assert.AreEqual(0.35f, WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade).SpecialRecoverySeconds);
            Assert.AreEqual(0.35f, WeaponDatabase.GetDefaultStats(WeaponDatabase.ShadowDagger).SpecialRecoverySeconds);
            Assert.AreEqual(0.35f, WeaponDatabase.GetDefaultStats(WeaponDatabase.TitanHammer).SpecialRecoverySeconds);
            Assert.AreEqual(0.35f, WeaponDatabase.GetDefaultStats(WeaponDatabase.InfluenceCannon).SpecialRecoverySeconds);
        }

        [Test]
        public void GetStatsOrDefault_FallsBackToDefaultTable_WhenNoAssetAssigned()
        {
            var database = ScriptableObject.CreateInstance<WeaponDatabase>();

            var stats = database.GetStatsOrDefault(WeaponDatabase.PulseBlade);

            Assert.AreEqual(WeaponDatabase.PulseBlade, stats.WeaponName);
            Assert.AreEqual(18, stats.BaseDamage);
        }

        [Test]
        public void WeaponStats_HasNoCriticalHitFields()
        {
            // Sprint 6 correction pass: Critical Hit is removed entirely.
            // This test exists to fail loudly (a compile error, in
            // practice) if CriticalChance/CriticalMultiplier are ever
            // reintroduced onto WeaponStats without an explicit decision.
            var fieldNames = new System.Collections.Generic.List<string>();
            foreach (var field in typeof(WeaponStats).GetFields())
            {
                fieldNames.Add(field.Name);
            }

            CollectionAssert.DoesNotContain(fieldNames, "CriticalChance");
            CollectionAssert.DoesNotContain(fieldNames, "CriticalMultiplier");
        }

        [Test]
        public void WeaponStats_HasNoOldSpecialDamageMultiplierField()
        {
            // Sprint 6 final security correction: SpecialDamageMultiplier
            // is replaced by a flat SpecialDamage value. This test exists
            // to fail loudly if the old field is ever reintroduced
            // without an explicit decision.
            var fieldNames = new System.Collections.Generic.List<string>();
            foreach (var field in typeof(WeaponStats).GetFields())
            {
                fieldNames.Add(field.Name);
            }

            CollectionAssert.DoesNotContain(fieldNames, "SpecialDamageMultiplier");
            CollectionAssert.Contains(fieldNames, "SpecialDamage");
        }
    }
}
