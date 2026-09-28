using System;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Social
{
    /// <summary>
    /// Sprint 8 — the Rescue Guard NPC encountered during a Guard Battle.
    /// "Remote virtual rescue. No physical navigation." — this is a
    /// self-contained local mini-encounter, not a Photon-networked battle
    /// like PlayerCombat/BattleManager: both the guard's health and the
    /// rescuer's own health for the purpose of this encounter are tracked
    /// here, since no separate rescuer-avatar combat system exists for this
    /// flow. Movement/health are this file's job; attack timing and damage
    /// resolution are RescueGuardCombat's (kept separate per the sprint's
    /// explicit file list).
    /// </summary>
    [RequireComponent(typeof(RescueGuardCombat))]
    public class RescueGuardController : MonoBehaviour
    {
        [SerializeField] private Transform rescuerTarget;
        [SerializeField] private int rescuerVirtualHealth = 100; // Sprint 8 spec gives no explicit rescuer HP value — a reasonable, clearly-local encounter default, not a GDD-approved number.

        public event Action OnGuardDefeated;
        public event Action OnPlayerDefeated;
        public event Action<int, int> OnGuardHealthChanged; // current, max
        public event Action<int, int> OnRescuerHealthChanged; // current, max

        public int GuardHealth { get; private set; }
        public int GuardMaxHealth => Constants.RescueGuard.Health;
        public int RescuerHealth { get; private set; }
        public int RescuerMaxHealth => rescuerVirtualHealth;

        public bool IsBattleActive { get; private set; }
        public Transform RescuerTarget => rescuerTarget;

        private RescueGuardCombat _combat;

        private void Awake()
        {
            _combat = GetComponent<RescueGuardCombat>();
        }

        /// <summary>Resets and starts a fresh Guard Battle encounter. Called by
        /// RescueMissionController right after the server confirms the
        /// guard-battle/start reservation transition.</summary>
        public void BeginBattle()
        {
            GuardHealth = GuardMaxHealth;
            RescuerHealth = RescuerMaxHealth;
            IsBattleActive = true;

            OnGuardHealthChanged?.Invoke(GuardHealth, GuardMaxHealth);
            OnRescuerHealthChanged?.Invoke(RescuerHealth, RescuerMaxHealth);

            _combat.BeginCombat(this);
        }

        /// <summary>Stops the guard's attack timers — called once an outcome
        /// (success, failure, or a server-side timeout) has been decided,
        /// so no further damage can apply after resolution.</summary>
        public void EndBattle()
        {
            IsBattleActive = false;
            _combat.EndCombat();
        }

        private void Update()
        {
            if (!IsBattleActive || rescuerTarget == null)
            {
                return;
            }

            var toTarget = rescuerTarget.position - transform.position;
            var distance = toTarget.magnitude;

            // Close to basic-attack range, then hold position — RescueGuardCombat
            // decides when an attack actually lands from there.
            if (distance > Constants.RescueGuard.BasicAttackRangeMeters * 0.9f)
            {
                var step = Constants.RescueGuard.MoveSpeedMetersPerSecond * Time.deltaTime;
                transform.position += toTarget.normalized * Mathf.Min(step, distance);
            }
        }

        /// <summary>Called by the rescuer's own attack input (this encounter has
        /// no separate weapon/PlayerCombat wiring — see class doc comment).
        /// Damage values come from the rescuer's equipped class, same as any
        /// other combat encounter; this controller does not invent one.</summary>
        public void ApplyDamageToGuard(int amount)
        {
            if (!IsBattleActive || amount <= 0)
            {
                return;
            }

            GuardHealth = Mathf.Max(0, GuardHealth - amount);
            OnGuardHealthChanged?.Invoke(GuardHealth, GuardMaxHealth);

            if (GuardHealth <= 0)
            {
                IsBattleActive = false;
                _combat.EndCombat();
                OnGuardDefeated?.Invoke();
            }
        }

        /// <summary>Called internally by RescueGuardCombat when a basic or
        /// special attack lands on the rescuer.</summary>
        public void ApplyDamageToRescuer(int amount)
        {
            if (!IsBattleActive || amount <= 0)
            {
                return;
            }

            RescuerHealth = Mathf.Max(0, RescuerHealth - amount);
            OnRescuerHealthChanged?.Invoke(RescuerHealth, RescuerMaxHealth);

            if (RescuerHealth <= 0)
            {
                IsBattleActive = false;
                _combat.EndCombat();
                OnPlayerDefeated?.Invoke();
            }
        }

        public float DistanceToRescuer()
        {
            return rescuerTarget == null ? Mathf.Infinity : Vector3.Distance(transform.position, rescuerTarget.position);
        }
    }
}
