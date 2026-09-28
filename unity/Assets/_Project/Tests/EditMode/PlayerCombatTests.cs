using System.Collections;
using System.Collections.Generic;
using Nfouz.Combat;
using Nfouz.Networking;
using Nfouz.Utils;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for PlayerCombat.cs: cooldowns, energy use, death
    /// state, and (Sprint 6 correction pass) the rebuilt Dodge system.
    /// Written for Unity Test Framework; not executed in this sandbox —
    /// see DamageCalculatorTests.cs's header note. These tests exercise
    /// real GameObjects/components (CreateInstance / AddComponent), which
    /// additionally requires the Unity runtime, not just a C# compiler —
    /// a stronger reason this suite specifically needs the Editor's Test
    /// Runner rather than a plain unit-test host.
    /// </summary>
    [TestFixture]
    public class PlayerCombatTests
    {
        private GameObject CreateCombatant(string classType, WeaponStats weapon, int maxHealth, int maxEnergy)
        {
            var go = new GameObject("TestCombatant");
            go.AddComponent<NetworkPlayerController>();
            var combat = go.AddComponent<PlayerCombat>();
            combat.Initialize(classType, weapon, maxHealth, maxEnergy);
            return go;
        }

        [TearDown]
        public void TearDown()
        {
            foreach (var obj in Object.FindObjectsOfType<GameObject>())
            {
                // "ChargedPulseProjectile" is also cleaned up here: a
                // Charged Pulse test that doesn't advance Update() (most
                // don't need to — see the synchronous-non-application test
                // below) would otherwise leak a spawned projectile
                // GameObject into the next test in the same Editor Test
                // Runner domain.
                if (obj.name == "TestCombatant" || obj.name == "ChargedPulseProjectile")
                {
                    Object.DestroyImmediate(obj);
                }
            }
        }

        [Test]
        public void BasicAttack_ConsumesEnergy_ForWeaponsThatCostEnergy()
        {
            var titanHammer = WeaponDatabase.GetDefaultStats(WeaponDatabase.TitanHammer); // costs 5 energy on basic attack
            var attackerGo = CreateCombatant("Titan", titanHammer, maxHealth: 140, maxEnergy: 80);
            var targetGo = CreateCombatant("Scout", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), maxHealth: 80, maxEnergy: 120);

            targetGo.transform.position = attackerGo.transform.position + Vector3.forward * 1f; // within Titan Hammer's 2.5m range

            var attackerCombat = attackerGo.GetComponent<PlayerCombat>();
            var attackerNetwork = attackerGo.GetComponent<NetworkPlayerController>();
            var targetCombat = targetGo.GetComponent<PlayerCombat>();

            attackerNetwork.NetworkedEnergy = 80;

            var executed = attackerCombat.BasicAttack(targetCombat);

            Assert.IsTrue(executed);
            Assert.AreEqual(75, attackerNetwork.NetworkedEnergy); // 80 - 5
        }

        [Test]
        public void BasicAttack_RejectedWhenInsufficientEnergy()
        {
            var titanHammer = WeaponDatabase.GetDefaultStats(WeaponDatabase.TitanHammer);
            var attackerGo = CreateCombatant("Titan", titanHammer, maxHealth: 140, maxEnergy: 80);
            var targetGo = CreateCombatant("Scout", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), maxHealth: 80, maxEnergy: 120);
            targetGo.transform.position = attackerGo.transform.position + Vector3.forward * 1f;

            var attackerCombat = attackerGo.GetComponent<PlayerCombat>();
            var attackerNetwork = attackerGo.GetComponent<NetworkPlayerController>();
            attackerNetwork.NetworkedEnergy = 2; // less than the 5 required

            var executed = attackerCombat.BasicAttack(targetGo.GetComponent<PlayerCombat>());

            Assert.IsFalse(executed);
            Assert.AreEqual(2, attackerNetwork.NetworkedEnergy); // unchanged
        }

        [Test]
        public void BasicAttack_EntersCooldown_AndRejectsASecondImmediateAttack()
        {
            var pulseBlade = WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade); // AttackCycleSeconds 0.65s
            var attackerGo = CreateCombatant("Scout", pulseBlade, maxHealth: 80, maxEnergy: 120);
            var targetGo = CreateCombatant("Scout", pulseBlade, maxHealth: 80, maxEnergy: 120);
            targetGo.transform.position = attackerGo.transform.position + Vector3.forward * 1f;

            var attackerCombat = attackerGo.GetComponent<PlayerCombat>();
            var targetCombat = targetGo.GetComponent<PlayerCombat>();

            var first = attackerCombat.BasicAttack(targetCombat);
            Assert.IsTrue(first);
            Assert.IsFalse(attackerCombat.IsBasicAttackReady);

            var second = attackerCombat.BasicAttack(targetCombat);
            Assert.IsFalse(second, "A second attack immediately after the first must be rejected by the cooldown.");
        }

        [Test]
        public void CanAttack_RejectsTargetOutsideWeaponRange()
        {
            var pulseBlade = WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade); // Range 2.2m
            var attackerGo = CreateCombatant("Scout", pulseBlade, maxHealth: 80, maxEnergy: 120);
            var targetGo = CreateCombatant("Scout", pulseBlade, maxHealth: 80, maxEnergy: 120);
            targetGo.transform.position = attackerGo.transform.position + Vector3.forward * 10f; // far outside range

            var canAttack = attackerGo.GetComponent<PlayerCombat>().CanAttack(targetGo.GetComponent<PlayerCombat>(), out var reason);

            Assert.IsFalse(canAttack);
            StringAssert.Contains("range", reason);
        }

        [Test]
        public void CanAttack_RejectsSelfTargeting()
        {
            var combatGo = CreateCombatant("Scout", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), 80, 120);
            var combat = combatGo.GetComponent<PlayerCombat>();

            var canAttack = combat.CanAttack(combat, out var reason);

            Assert.IsFalse(canAttack);
            StringAssert.Contains("self", reason);
        }

        [Test]
        public void ApplyDamage_ReducesHealth_AndFiresDeathAtZero()
        {
            var targetGo = CreateCombatant("Scout", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), maxHealth: 10, maxEnergy: 100);
            var targetCombat = targetGo.GetComponent<PlayerCombat>();
            var targetNetwork = targetGo.GetComponent<NetworkPlayerController>();
            targetNetwork.NetworkedHealth = 10;

            var died = false;
            targetCombat.OnDeath += () => died = true;

            targetCombat.ApplyDamage(15); // more than current health

            Assert.AreEqual(0, targetNetwork.NetworkedHealth, "Health must never go negative.");
            Assert.IsTrue(targetCombat.IsDead);
            Assert.IsTrue(died, "OnDeath must fire exactly when health reaches 0.");
        }

        [Test]
        public void ApplyDamage_DoesNothingAfterDeath()
        {
            var targetGo = CreateCombatant("Scout", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), maxHealth: 10, maxEnergy: 100);
            var targetCombat = targetGo.GetComponent<PlayerCombat>();
            var targetNetwork = targetGo.GetComponent<NetworkPlayerController>();
            targetNetwork.NetworkedHealth = 10;

            targetCombat.ApplyDamage(10);
            Assert.IsTrue(targetCombat.IsDead);

            var deathFiredAgain = false;
            targetCombat.OnDeath += () => deathFiredAgain = true;
            targetCombat.ApplyDamage(50); // should be a no-op on an already-dead target

            Assert.IsFalse(deathFiredAgain);
            Assert.AreEqual(0, targetNetwork.NetworkedHealth);
        }

        [Test]
        public void Dodge_ConsumesEnergy_AndMovesTheDistanceForward()
        {
            var targetGo = CreateCombatant("Ranger", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), 100, 100);
            var targetCombat = targetGo.GetComponent<PlayerCombat>();
            var targetNetwork = targetGo.GetComponent<NetworkPlayerController>();
            targetNetwork.NetworkedEnergy = 100;
            var startPosition = targetGo.transform.position;

            var dodged = targetCombat.TryDodge();

            Assert.IsTrue(dodged);
            Assert.AreEqual(80, targetNetwork.NetworkedEnergy); // 100 - DodgeEnergyCost(20) — non-Scout class
            Assert.IsTrue(targetCombat.IsDodging);
            Assert.IsTrue(targetCombat.IsInvulnerable, "The first 0.2s of a dodge must be fully invulnerable.");

            var distanceMoved = Vector3.Distance(startPosition, targetGo.transform.position);
            Assert.AreEqual(3f, distanceMoved, 0.001f, "Dodge must move the player 3 meters — the GDD's approved distance.");
        }

        [Test]
        public void Dodge_ScoutPaysReducedEnergyCost()
        {
            var scoutGo = CreateCombatant("Scout", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), 80, 120);
            var scoutCombat = scoutGo.GetComponent<PlayerCombat>();
            var scoutNetwork = scoutGo.GetComponent<NetworkPlayerController>();
            scoutNetwork.NetworkedEnergy = 100;

            var dodged = scoutCombat.TryDodge();

            Assert.IsTrue(dodged);
            Assert.AreEqual(82, scoutNetwork.NetworkedEnergy); // 100 - ScoutDodgeEnergyCost(18)
        }

        [Test]
        public void Dodge_RejectedWhileOnCooldown()
        {
            var combatGo = CreateCombatant("Ranger", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), 100, 100);
            var combat = combatGo.GetComponent<PlayerCombat>();
            var network = combatGo.GetComponent<NetworkPlayerController>();
            network.NetworkedEnergy = 100;

            var first = combat.TryDodge();
            Assert.IsTrue(first);
            Assert.IsFalse(combat.IsDodgeReady, "Dodge must enter its 4s cooldown immediately.");

            var second = combat.TryDodge();
            Assert.IsFalse(second, "A second dodge attempt while on cooldown must be rejected.");
        }

        [Test]
        public void ApplyDamage_IsFullyNegated_WhileInvulnerable()
        {
            var targetGo = CreateCombatant("Ranger", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), 100, 100);
            var targetCombat = targetGo.GetComponent<PlayerCombat>();
            var targetNetwork = targetGo.GetComponent<NetworkPlayerController>();
            targetNetwork.NetworkedEnergy = 100;
            targetNetwork.NetworkedHealth = 100;

            targetCombat.TryDodge();
            Assert.IsTrue(targetCombat.IsInvulnerable);

            targetCombat.ApplyDamage(40);

            // The old 70% partial-resistance rule is removed — invulnerable
            // means invulnerable: zero damage, not merely reduced damage.
            Assert.AreEqual(100, targetNetwork.NetworkedHealth);
        }

        [UnityTest]
        public IEnumerator EnergyRegenEnabled_False_PreventsRegeneration_ForOvertime()
        {
            // BattleManager sets EnergyRegenEnabled = false on both
            // combatants when entering the GDD's 30s Overtime window —
            // this proves PlayerCombat actually honors that flag rather
            // than always regenerating.
            var combatantGo = CreateCombatant("Ranger", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), 100, 100);
            var combat = combatantGo.GetComponent<PlayerCombat>();
            var network = combatantGo.GetComponent<NetworkPlayerController>();
            network.NetworkedEnergy = 50;
            combat.EnergyRegenEnabled = false;

            yield return new WaitForSeconds(0.5f); // would regenerate +5/s if enabled

            Assert.AreEqual(50, network.NetworkedEnergy, "Energy must not regenerate while EnergyRegenEnabled is false.");

            combat.EnergyRegenEnabled = true;
            yield return new WaitForSeconds(0.5f);

            Assert.Greater(network.NetworkedEnergy, 50, "Energy must resume regenerating once EnergyRegenEnabled is true again.");
        }

        [UnityTest]
        public IEnumerator ApplyDamage_IsFullDamage_AfterInvulnerabilityWindowExpires_ButStillDodging()
        {
            var targetGo = CreateCombatant("Ranger", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), 100, 100);
            var targetCombat = targetGo.GetComponent<PlayerCombat>();
            var targetNetwork = targetGo.GetComponent<NetworkPlayerController>();
            targetNetwork.NetworkedEnergy = 100;
            targetNetwork.NetworkedHealth = 100;

            targetCombat.TryDodge();

            // Constants.Combat.DodgeInvulnerabilitySeconds = 0.2f,
            // DodgeDurationSeconds = 0.3f — wait past the invulnerability
            // window but still inside the dodge's total duration.
            yield return new WaitForSeconds(0.25f);

            Assert.IsTrue(targetCombat.IsDodging, "Still within the 0.3s dodge duration.");
            Assert.IsFalse(targetCombat.IsInvulnerable, "Invulnerability must end after 0.2s.");

            targetCombat.ApplyDamage(40);

            // No partial resistance outside the invulnerability window.
            Assert.AreEqual(60, targetNetwork.NetworkedHealth);
        }

        // ---- Sprint 6 final security correction ----

        [Test]
        public void TrySpecial_UsesFlatSpecialDamage_NotAMultiplierOfBaseDamage()
        {
            // Pulse Arc: flat 26 damage, 25 energy, regardless of Pulse
            // Blade's BaseDamage(18) — proves the removed
            // SpecialDamageMultiplier model is gone.
            var pulseBlade = WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade);
            var attackerGo = CreateCombatant("Scout", pulseBlade, maxHealth: 80, maxEnergy: 120);
            var targetGo = CreateCombatant("Scout", pulseBlade, maxHealth: 200, maxEnergy: 120);
            targetGo.transform.position = attackerGo.transform.position + Vector3.forward * 1f;

            var attackerCombat = attackerGo.GetComponent<PlayerCombat>();
            var attackerNetwork = attackerGo.GetComponent<NetworkPlayerController>();
            var targetNetwork = targetGo.GetComponent<NetworkPlayerController>();
            attackerNetwork.NetworkedEnergy = 120;
            targetNetwork.NetworkedHealth = 200;

            var executed = attackerCombat.TrySpecial(targetGo.GetComponent<PlayerCombat>());

            Assert.IsTrue(executed);
            Assert.AreEqual(95, attackerNetwork.NetworkedEnergy); // 120 - SpecialEnergyCost(25)
            // Scout class attack multiplier is 1.0x, Scout defense is 2:
            // (26 * 1.0) - 2 = 24 damage.
            Assert.AreEqual(176, targetNetwork.NetworkedHealth);
        }

        [Test]
        public void TrySpecial_EntersRecoveryLock_BlockingAllOtherActionsUntilItElapses()
        {
            // Every approved weapon's special has a 0.35s recovery.
            var pulseBlade = WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade);
            var attackerGo = CreateCombatant("Scout", pulseBlade, maxHealth: 80, maxEnergy: 120);
            var targetGo = CreateCombatant("Scout", pulseBlade, maxHealth: 80, maxEnergy: 120);
            targetGo.transform.position = attackerGo.transform.position + Vector3.forward * 1f;

            var attackerCombat = attackerGo.GetComponent<PlayerCombat>();
            attackerGo.GetComponent<NetworkPlayerController>().NetworkedEnergy = 120;

            var executed = attackerCombat.TrySpecial(targetGo.GetComponent<PlayerCombat>());
            Assert.IsTrue(executed);

            Assert.IsTrue(attackerCombat.IsInRecovery, "A successful special must start the recovery lock.");
            Assert.IsFalse(attackerCombat.IsBasicAttackReady, "Basic attack must be blocked during recovery.");
            Assert.IsFalse(attackerCombat.IsDodgeReady, "Dodge must be blocked during recovery.");

            var secondAttack = attackerCombat.BasicAttack(targetGo.GetComponent<PlayerCombat>());
            Assert.IsFalse(secondAttack, "Basic attack must actually be rejected while in recovery.");
        }

        [UnityTest]
        public IEnumerator TrySpecial_RecoveryLock_ClearsAfterItsDuration()
        {
            var pulseBlade = WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade); // SpecialRecoverySeconds 0.35s
            var attackerGo = CreateCombatant("Scout", pulseBlade, maxHealth: 80, maxEnergy: 120);
            var targetGo = CreateCombatant("Scout", pulseBlade, maxHealth: 80, maxEnergy: 120);
            targetGo.transform.position = attackerGo.transform.position + Vector3.forward * 1f;

            var attackerCombat = attackerGo.GetComponent<PlayerCombat>();
            attackerGo.GetComponent<NetworkPlayerController>().NetworkedEnergy = 120;

            attackerCombat.TrySpecial(targetGo.GetComponent<PlayerCombat>());
            Assert.IsTrue(attackerCombat.IsInRecovery);

            yield return new WaitForSeconds(0.4f); // past the 0.35s recovery window

            Assert.IsFalse(attackerCombat.IsInRecovery, "Recovery must clear once SpecialRecoverySeconds has elapsed.");
        }

        [Test]
        public void TryClassAbility_Scout_BlinkStep_MovesForwardAndConsumesEnergy()
        {
            var combatGo = CreateCombatant("Scout", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), 80, 120);
            var combat = combatGo.GetComponent<PlayerCombat>();
            var network = combatGo.GetComponent<NetworkPlayerController>();
            network.NetworkedEnergy = 120;
            var startPosition = combatGo.transform.position;

            var stats = ClassAbilityDatabase.GetDefaultStats(Constants.PlayerClass.Scout);
            var used = combat.TryClassAbility();

            Assert.IsTrue(used);
            Assert.AreEqual(120 - stats.EnergyCost, network.NetworkedEnergy);
            var distanceMoved = Vector3.Distance(startPosition, combatGo.transform.position);
            Assert.AreEqual(stats.DashDistanceMeters, distanceMoved, 0.001f);
            Assert.IsFalse(combat.IsClassAbilityReady, "Blink Step must enter its own cooldown.");
            Assert.IsFalse(combat.IsInRecovery, "Blink Step does not use the shared activation action lock — only Focus Shot/Bulwark do.");
        }

        [UnityTest]
        public IEnumerator TryClassAbility_Scout_BlinkStep_IsInvulnerableForExactlyItsApprovedWindow()
        {
            // GDD: 0.25s total dash duration, with the first 0.2s fully
            // invulnerable — same full-negation effect as Dodge's own
            // invulnerability, but via an entirely separate ability/timer.
            var combatGo = CreateCombatant("Scout", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), 80, 120);
            var combat = combatGo.GetComponent<PlayerCombat>();
            var network = combatGo.GetComponent<NetworkPlayerController>();
            network.NetworkedEnergy = 120;
            network.NetworkedHealth = 80;

            combat.TryClassAbility();
            Assert.IsTrue(combat.IsBlinkInvulnerable, "Blink Step must be invulnerable immediately after activation.");

            combat.ApplyDamage(50);
            Assert.AreEqual(80, network.NetworkedHealth, "Damage must be fully negated during Blink Step's 0.2s invulnerability window.");

            yield return new WaitForSeconds(0.22f); // past the 0.2s invulnerability window, still inside the 0.25s dash

            Assert.IsFalse(combat.IsBlinkInvulnerable, "Invulnerability must end after exactly 0.2s.");

            combat.ApplyDamage(50);
            Assert.AreEqual(30, network.NetworkedHealth, "Damage must apply in full once the invulnerability window has elapsed.");

            yield return new WaitForSeconds(0.1f); // past the full 0.25s dash duration

            Assert.IsFalse(combat.IsBlinkInvulnerable);
        }

        // ---- Ranger — Focus Shot: a self-buff consumed by the next successful hit ----

        [Test]
        public void TryClassAbility_Ranger_FocusShot_ArmsABuff_WithNoTargetRequired()
        {
            var rangerGo = CreateCombatant("Ranger", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), 80, 120);
            var combat = rangerGo.GetComponent<PlayerCombat>();
            var network = rangerGo.GetComponent<NetworkPlayerController>();
            network.NetworkedEnergy = 120;

            var stats = ClassAbilityDatabase.GetDefaultStats(Constants.PlayerClass.Ranger);
            var used = combat.TryClassAbility();

            Assert.IsTrue(used, "Focus Shot is a self-buff — it needs no target.");
            Assert.IsTrue(combat.IsFocusShotArmed);
            Assert.AreEqual(120 - stats.EnergyCost, network.NetworkedEnergy);
            Assert.IsTrue(combat.IsInRecovery, "Focus Shot activation must trigger the shared 0.2s activation action lock.");
        }

        [UnityTest]
        public IEnumerator TryClassAbility_Ranger_FocusShot_BuffSurvivesARejectedAttack()
        {
            var rangerGo = CreateCombatant("Ranger", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), 80, 120);
            var targetGo = CreateCombatant("Scout", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), 200, 120);
            var combat = rangerGo.GetComponent<PlayerCombat>();
            var network = rangerGo.GetComponent<NetworkPlayerController>();
            var targetNetwork = targetGo.GetComponent<NetworkPlayerController>();
            network.NetworkedEnergy = 120;
            targetNetwork.NetworkedHealth = 200;
            targetGo.transform.position = rangerGo.transform.position + Vector3.forward * 50f; // far out of weapon range

            combat.TryClassAbility();
            Assert.IsTrue(combat.IsFocusShotArmed);

            yield return new WaitForSeconds(0.25f); // past the 0.2s activation lock, so the rejection below is due to range only

            var rejected = combat.BasicAttack(targetGo.GetComponent<PlayerCombat>());

            Assert.IsFalse(rejected, "Target is far out of range — the attack itself must be rejected.");
            Assert.IsTrue(combat.IsFocusShotArmed, "A rejected attack must not consume the Focus Shot buff — only a successful hit does.");
            Assert.AreEqual(200, targetNetwork.NetworkedHealth, "No damage should have been applied by the rejected attack.");
        }

        [UnityTest]
        public IEnumerator TryClassAbility_Ranger_FocusShot_SuccessfulHitAddsExactlyTheApprovedBonus_AndConsumesTheBuff()
        {
            var rangerGo = CreateCombatant("Ranger", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), 80, 120);
            var targetGo = CreateCombatant("Scout", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), 200, 120);
            targetGo.transform.position = rangerGo.transform.position + Vector3.forward * 1f; // within Pulse Blade's 2.2m range

            var combat = rangerGo.GetComponent<PlayerCombat>();
            var network = rangerGo.GetComponent<NetworkPlayerController>();
            var targetNetwork = targetGo.GetComponent<NetworkPlayerController>();
            network.NetworkedEnergy = 120;
            targetNetwork.NetworkedHealth = 200;

            combat.TryClassAbility();
            Assert.IsTrue(combat.IsFocusShotArmed);

            yield return new WaitForSeconds(0.25f); // past the 0.2s activation lock so BasicAttack isn't also blocked by it

            var executed = combat.BasicAttack(targetGo.GetComponent<PlayerCombat>());

            Assert.IsTrue(executed);
            Assert.IsFalse(combat.IsFocusShotArmed, "A successful hit — basic or special — must consume the armed buff.");

            // Pulse Blade BaseDamage 18 * Ranger's 1.15x attack multiplier
            // - the TARGET's (Scout) defense of 2: (18 * 1.15) - 2 = 18.7,
            // rounds to 19, then Focus Shot's flat +6 bonus on top = 25.
            Assert.AreEqual(200 - 25, targetNetwork.NetworkedHealth, "The bonus must be exactly +6 on top of the normal damage formula's result.");
        }

        [Test]
        public void TryClassAbility_Ranger_FocusShot_DoesNotStack_ItsOwnCooldownPreventsARepeatActivationWhileArmed()
        {
            var rangerGo = CreateCombatant("Ranger", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), 80, 120);
            var combat = rangerGo.GetComponent<PlayerCombat>();
            var network = rangerGo.GetComponent<NetworkPlayerController>();
            network.NetworkedEnergy = 120;

            var firstActivation = combat.TryClassAbility();
            Assert.IsTrue(firstActivation);
            Assert.IsTrue(combat.IsFocusShotArmed);

            // Focus Shot's own 12s cooldown is the only gate on
            // TryClassAbility, and it is still fully active here — proving
            // there is no path to arm a second, stacked bonus while one is
            // already armed.
            var secondActivation = combat.TryClassAbility();
            Assert.IsFalse(secondActivation, "Focus Shot does not stack — a repeat activation while already armed must be rejected.");
        }

        // ---- Titan — Bulwark: a flat damage-absorption pool ----

        [Test]
        public void TryClassAbility_Titan_Bulwark_AbsorbsExactlyTheApprovedTotal_AcrossMultipleHits()
        {
            var targetGo = CreateCombatant("Titan", WeaponDatabase.GetDefaultStats(WeaponDatabase.TitanHammer), 140, 100);
            var combat = targetGo.GetComponent<PlayerCombat>();
            var network = targetGo.GetComponent<NetworkPlayerController>();
            network.NetworkedEnergy = 100;
            network.NetworkedHealth = 140;

            var stats = ClassAbilityDatabase.GetDefaultStats(Constants.PlayerClass.Titan);
            Assert.AreEqual(25, stats.AbsorbAmount, "Sanity check against the approved GDD value this test's arithmetic relies on.");

            var used = combat.TryClassAbility();
            Assert.IsTrue(used);
            Assert.IsTrue(combat.IsBulwarkActive);

            combat.ApplyDamage(15); // first hit: fully within the 25-point pool
            Assert.AreEqual(140, network.NetworkedHealth, "The first 15-damage hit must be fully absorbed (15 of 25 used).");

            combat.ApplyDamage(15); // second hit: only 10 remain in the pool
            Assert.AreEqual(135, network.NetworkedHealth, "10 of the second hit's 15 damage is absorbed (exhausting the pool); the remaining 5 applies — total absorbed across both hits is exactly 25.");
        }

        [Test]
        public void ApplyDamage_Bulwark_CanLegitimatelyReduceAppliedDamageToExactlyZero()
        {
            // The previous pass's percentage-reduction model had a
            // MinimumDamage floor (damage could never round below 1). The
            // new flat-absorption-pool model has NO such floor — a hit
            // fully covered by the pool must apply exactly 0.
            var targetGo = CreateCombatant("Titan", WeaponDatabase.GetDefaultStats(WeaponDatabase.TitanHammer), 140, 100);
            var combat = targetGo.GetComponent<PlayerCombat>();
            var network = targetGo.GetComponent<NetworkPlayerController>();
            network.NetworkedEnergy = 100;
            network.NetworkedHealth = 140;

            combat.TryClassAbility(); // activates Bulwark: 25-point pool

            var appliedAmounts = new List<int>();
            combat.OnDamageTaken += amount => appliedAmounts.Add(amount);

            combat.ApplyDamage(1); // smallest possible hit, well within the pool

            Assert.AreEqual(140, network.NetworkedHealth, "A hit fully covered by the absorption pool must apply zero damage.");
            Assert.AreEqual(1, appliedAmounts.Count);
            Assert.AreEqual(0, appliedAmounts[0], "OnDamageTaken must report the actual applied amount (0), not the raw incoming amount.");
        }

        [UnityTest]
        public IEnumerator TryClassAbility_Titan_Bulwark_UnusedAbsorptionIsLost_NotBanked_WhenTheWindowExpires()
        {
            var targetGo = CreateCombatant("Titan", WeaponDatabase.GetDefaultStats(WeaponDatabase.TitanHammer), 140, 100);
            var combat = targetGo.GetComponent<PlayerCombat>();
            var network = targetGo.GetComponent<NetworkPlayerController>();
            network.NetworkedEnergy = 100;
            network.NetworkedHealth = 140;

            combat.TryClassAbility(); // 25-point pool, 3s window
            combat.ApplyDamage(10); // 15 points remain in the pool

            yield return new WaitForSeconds(3.1f); // past Bulwark's 3-second window

            Assert.IsFalse(combat.IsBulwarkActive, "Bulwark must expire after exactly its 3-second duration.");

            combat.ApplyDamage(10);
            Assert.AreEqual(120, network.NetworkedHealth, "The unused 15-point pool must be discarded at expiry, not banked for a later hit — a fresh 10-damage hit after expiry applies in full.");
        }

        // ---- Weapon specials: real gameplay geometry (Sprint 6 final gameplay-completion pass) ----

        [Test]
        public void TrySpecial_ShadowLunge_DealsDamage_WhenTheDashLandsWithinContactRange()
        {
            var shadowDagger = WeaponDatabase.GetDefaultStats(WeaponDatabase.ShadowDagger);
            var attackerGo = CreateCombatant("Scout", shadowDagger, maxHealth: 80, maxEnergy: 120);
            var targetGo = CreateCombatant("Scout", shadowDagger, maxHealth: 80, maxEnergy: 120);
            // Shadow Lunge dashes 3m forward; placing the target 3.5m
            // ahead lands the attacker within the 1.5m contact radius
            // (Shadow Dagger's own approved basic-attack range, reused —
            // see Constants.Combat.ShadowLungeContactRadiusMeters) after the dash.
            targetGo.transform.position = attackerGo.transform.position + Vector3.forward * 3.5f;

            var attackerCombat = attackerGo.GetComponent<PlayerCombat>();
            var targetNetwork = targetGo.GetComponent<NetworkPlayerController>();
            attackerGo.GetComponent<NetworkPlayerController>().NetworkedEnergy = 120;
            targetNetwork.NetworkedHealth = 80;

            var executed = attackerCombat.TrySpecial(targetGo.GetComponent<PlayerCombat>());

            Assert.IsTrue(executed);
            Assert.Less(targetNetwork.NetworkedHealth, 80, "Contact after the dash must apply Shadow Lunge's damage.");

            var distanceMoved = Vector3.Distance(Vector3.zero, attackerGo.transform.position);
            Assert.AreEqual(3f, distanceMoved, 0.001f, "Shadow Lunge must actually move the attacker 3 meters.");
        }

        [Test]
        public void TrySpecial_ShadowLunge_StillDashes_ButAppliesNoDamage_WhenItMissesContact()
        {
            var shadowDagger = WeaponDatabase.GetDefaultStats(WeaponDatabase.ShadowDagger);
            var attackerGo = CreateCombatant("Scout", shadowDagger, maxHealth: 80, maxEnergy: 120);
            var targetGo = CreateCombatant("Scout", shadowDagger, maxHealth: 80, maxEnergy: 120);
            // Far enough that the 3m dash still lands well outside the 1.5m contact radius.
            targetGo.transform.position = attackerGo.transform.position + Vector3.forward * 20f;

            var attackerCombat = attackerGo.GetComponent<PlayerCombat>();
            var targetNetwork = targetGo.GetComponent<NetworkPlayerController>();
            attackerGo.GetComponent<NetworkPlayerController>().NetworkedEnergy = 120;
            targetNetwork.NetworkedHealth = 80;

            var executed = attackerCombat.TrySpecial(targetGo.GetComponent<PlayerCombat>());

            Assert.IsTrue(executed, "The dash itself always executes, regardless of whether it makes contact.");
            Assert.AreEqual(80, targetNetwork.NetworkedHealth, "No damage applies when the dash doesn't land within contact range.");

            var distanceMoved = Vector3.Distance(Vector3.zero, attackerGo.transform.position);
            Assert.AreEqual(3f, distanceMoved, 0.001f, "The attacker must still dash the full 3 meters even without contact.");
        }

        [Test]
        public void TrySpecial_ShadowLunge_ClampsTheDashToTheArenaBoundary()
        {
            var shadowDagger = WeaponDatabase.GetDefaultStats(WeaponDatabase.ShadowDagger);
            var attackerGo = CreateCombatant("Scout", shadowDagger, maxHealth: 80, maxEnergy: 120);
            var targetGo = CreateCombatant("Scout", shadowDagger, maxHealth: 80, maxEnergy: 120);
            // Start near the arena's edge, facing further outward — an
            // unclamped 3m dash would land well beyond ArenaRadiusMeters.
            attackerGo.transform.position = Vector3.forward * (Constants.Battle.ArenaRadiusMeters - 0.5f);
            targetGo.transform.position = attackerGo.transform.position + Vector3.forward * 100f;

            var attackerCombat = attackerGo.GetComponent<PlayerCombat>();
            attackerGo.GetComponent<NetworkPlayerController>().NetworkedEnergy = 120;

            attackerCombat.TrySpecial(targetGo.GetComponent<PlayerCombat>());

            Assert.AreEqual(Constants.Battle.ArenaRadiusMeters, attackerGo.transform.position.magnitude, 0.001f,
                "A dash that would exceed the arena radius must be clamped exactly to its edge.");
        }

        [Test]
        public void TrySpecial_GroundBreak_RejectsATargetOutsideTheAoeRadius()
        {
            var titanHammer = WeaponDatabase.GetDefaultStats(WeaponDatabase.TitanHammer);
            var attackerGo = CreateCombatant("Titan", titanHammer, maxHealth: 140, maxEnergy: 100);
            var targetGo = CreateCombatant("Scout", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), maxHealth: 80, maxEnergy: 100);
            targetGo.transform.position = attackerGo.transform.position + Vector3.forward * 10f; // well outside the 3m radius

            var attackerCombat = attackerGo.GetComponent<PlayerCombat>();
            var attackerNetwork = attackerGo.GetComponent<NetworkPlayerController>();
            attackerNetwork.NetworkedEnergy = 100;

            var executed = attackerCombat.TrySpecial(targetGo.GetComponent<PlayerCombat>());

            Assert.IsFalse(executed);
            Assert.AreEqual(100, attackerNetwork.NetworkedEnergy, "A rejected Ground Break must not consume energy.");
        }

        [Test]
        public void TrySpecial_GroundBreak_AppliesFullKnockback_ToANonTitanTarget()
        {
            var titanHammer = WeaponDatabase.GetDefaultStats(WeaponDatabase.TitanHammer);
            var attackerGo = CreateCombatant("Titan", titanHammer, maxHealth: 140, maxEnergy: 100);
            var targetGo = CreateCombatant("Scout", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), maxHealth: 200, maxEnergy: 100);
            targetGo.transform.position = attackerGo.transform.position + Vector3.forward * 2f; // within the 3m radius
            var targetStartPosition = targetGo.transform.position;

            var attackerCombat = attackerGo.GetComponent<PlayerCombat>();
            var targetNetwork = targetGo.GetComponent<NetworkPlayerController>();
            attackerGo.GetComponent<NetworkPlayerController>().NetworkedEnergy = 100;
            targetNetwork.NetworkedHealth = 200;

            var executed = attackerCombat.TrySpecial(targetGo.GetComponent<PlayerCombat>());

            Assert.IsTrue(executed);
            Assert.Less(targetNetwork.NetworkedHealth, 200, "Ground Break must deal damage.");

            var knockbackDistance = Vector3.Distance(targetStartPosition, targetGo.transform.position);
            Assert.AreEqual(1f, knockbackDistance, 0.001f, "A non-Titan target must take the full 1m knockback.");
        }

        [Test]
        public void TrySpecial_GroundBreak_ReducesKnockback_ForATitanTarget()
        {
            var titanHammer = WeaponDatabase.GetDefaultStats(WeaponDatabase.TitanHammer);
            var attackerGo = CreateCombatant("Titan", titanHammer, maxHealth: 140, maxEnergy: 100);
            var targetGo = CreateCombatant("Titan", titanHammer, maxHealth: 140, maxEnergy: 100);
            targetGo.transform.position = attackerGo.transform.position + Vector3.forward * 2f;
            var targetStartPosition = targetGo.transform.position;

            var attackerCombat = attackerGo.GetComponent<PlayerCombat>();
            var targetNetwork = targetGo.GetComponent<NetworkPlayerController>();
            attackerGo.GetComponent<NetworkPlayerController>().NetworkedEnergy = 100;
            targetNetwork.NetworkedHealth = 140;

            attackerCombat.TrySpecial(targetGo.GetComponent<PlayerCombat>());

            var knockbackDistance = Vector3.Distance(targetStartPosition, targetGo.transform.position);
            Assert.AreEqual(0.7f, knockbackDistance, 0.001f, "A Titan target's knockback must be reduced by exactly 30% (1m * 0.7 = 0.7m).");
        }

        [Test]
        public void TrySpecial_ChargedPulse_DoesNotApplyDamageSynchronously_ButStillConsumesResourcesImmediately()
        {
            var influenceCannon = WeaponDatabase.GetDefaultStats(WeaponDatabase.InfluenceCannon);
            var attackerGo = CreateCombatant("Ranger", influenceCannon, maxHealth: 80, maxEnergy: 120);
            var targetGo = CreateCombatant("Scout", WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade), maxHealth: 200, maxEnergy: 120);
            targetGo.transform.position = attackerGo.transform.position + Vector3.forward * 5f;

            var attackerCombat = attackerGo.GetComponent<PlayerCombat>();
            var attackerNetwork = attackerGo.GetComponent<NetworkPlayerController>();
            var targetNetwork = targetGo.GetComponent<NetworkPlayerController>();
            attackerNetwork.NetworkedEnergy = 120;
            targetNetwork.NetworkedHealth = 200;

            var executed = attackerCombat.TrySpecial(targetGo.GetComponent<PlayerCombat>());

            Assert.IsTrue(executed);
            Assert.AreEqual(200, targetNetwork.NetworkedHealth, "Charged Pulse spawns a projectile — it must not apply damage the instant TrySpecial returns.");
            Assert.AreEqual(90, attackerNetwork.NetworkedEnergy, "Energy (30 SpecialEnergyCost) must still be consumed immediately, even though damage is delayed.");
            Assert.IsFalse(attackerCombat.IsSpecialReady, "The special's cooldown/recovery must still start immediately, independent of the projectile's flight.");
        }
    }
}
