using System.Collections;
using Nfouz.Combat;
using Nfouz.Networking;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Nfouz.Tests.PlayMode
{
    /// <summary>
    /// PlayMode tests for PlayerCombat.cs timers: cooldowns, recovery,
    /// invulnerability windows and energy regeneration all advance in
    /// Update() with Time.deltaTime, which only runs in Play Mode. Moved
    /// here unchanged from EditMode/PlayerCombatTests.cs. In Play Mode,
    /// AddComponent runs Awake/OnEnable itself.
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
                if (obj.name == "TestCombatant" || obj.name == "ChargedPulseProjectile")
                {
                    Object.DestroyImmediate(obj);
                }
            }
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

        // ---- Titan — Bulwark: a flat damage-absorption pool ----

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
            Assert.AreEqual(130, network.NetworkedHealth, "The unused 15-point pool must be discarded at expiry, not banked for a later hit — a fresh 10-damage hit after expiry applies in full.");
        }
    }
}
