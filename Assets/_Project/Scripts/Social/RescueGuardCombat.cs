using System.Collections;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Social
{
    /// <summary>
    /// Sprint 8 — the Rescue Guard's own attack timing and damage
    /// resolution, split out from RescueGuardController (movement/health)
    /// per the sprint's explicit file list. Implements both approved attack
    /// patterns exactly as specified:
    ///   Basic Attack — 15 damage, 2m range, 0.35s wind-up, 1.2s cycle.
    ///   Special Attack — every 8 seconds, 24 damage, 3m range, 0.9s
    ///     wind-up, with a visible warning indicator during wind-up.
    ///
    /// Sprint 8 correction (final pass) — "Cannot overlap basic attack":
    /// the two attack loops share `_attackWindupInProgress` so a special
    /// attack never begins its own wind-up while a basic attack's wind-up
    /// is in flight, and vice versa. Whichever loop's timer fires first
    /// claims the lock and proceeds normally; the other polls (once per
    /// frame) until the lock clears before starting its own wind-up,
    /// rather than firing simultaneously. This also doubles as the
    /// duplicate-damage-event guard together with RescueGuardController's
    /// own IsBattleActive check: a single boolean lock per attack type
    /// makes it structurally impossible for BasicAttackLoop or
    /// SpecialAttackLoop to apply more than one hit per completed wind-up.
    /// </summary>
    public class RescueGuardCombat : MonoBehaviour
    {
        [Header("Special attack warning indicator")]
        [SerializeField] private GameObject specialWarningIndicator;

        private RescueGuardController _controller;
        private Coroutine _basicAttackLoop;
        private Coroutine _specialAttackLoop;
        private bool _attackWindupInProgress;

        public void BeginCombat(RescueGuardController controller)
        {
            _controller = controller;
            _attackWindupInProgress = false;
            SetWarningVisible(false);

            _basicAttackLoop = StartCoroutine(BasicAttackLoop());
            _specialAttackLoop = StartCoroutine(SpecialAttackLoop());
        }

        public void EndCombat()
        {
            if (_basicAttackLoop != null)
            {
                StopCoroutine(_basicAttackLoop);
                _basicAttackLoop = null;
            }

            if (_specialAttackLoop != null)
            {
                StopCoroutine(_specialAttackLoop);
                _specialAttackLoop = null;
            }

            // StopCoroutine can cut a loop off mid-wind-up, which would
            // otherwise leave the lock permanently held for the next
            // BeginCombat — reset it explicitly rather than relying on the
            // coroutine's own (now-skipped) cleanup path.
            _attackWindupInProgress = false;
            SetWarningVisible(false);
        }

        /// <summary>
        /// Basic Attack: repeats every AttackCycleSeconds. Each cycle waits
        /// the wind-up, then lands the hit only if the rescuer is still
        /// within BasicAttackRangeMeters at the moment the wind-up
        /// completes — a target that has since stepped out of range takes
        /// no damage that cycle, same "resolve where the target actually is
        /// when the wind-up ends" rule as PlayerCombat's own weapons.
        /// </summary>
        private IEnumerator BasicAttackLoop()
        {
            while (_controller.IsBattleActive)
            {
                // "Cannot overlap basic attack" — wait for any in-flight
                // special-attack wind-up to finish before starting ours.
                while (_attackWindupInProgress && _controller.IsBattleActive)
                {
                    yield return null;
                }
                if (!_controller.IsBattleActive)
                {
                    yield break;
                }

                _attackWindupInProgress = true;
                yield return new WaitForSeconds(Constants.RescueGuard.BasicAttackWindupSeconds);
                _attackWindupInProgress = false;

                if (!_controller.IsBattleActive)
                {
                    yield break;
                }

                if (_controller.DistanceToRescuer() <= Constants.RescueGuard.BasicAttackRangeMeters)
                {
                    _controller.ApplyDamageToRescuer(Constants.RescueGuard.BasicAttackDamage);
                }

                var remainingCycle = Constants.RescueGuard.BasicAttackCycleSeconds - Constants.RescueGuard.BasicAttackWindupSeconds;
                if (remainingCycle > 0f)
                {
                    yield return new WaitForSeconds(remainingCycle);
                }
            }
        }

        /// <summary>
        /// Special Attack: fires every SpecialAttackIntervalSeconds
        /// (measured from the start of one special to the start of the
        /// next, independent of the basic-attack cycle), with a visible
        /// warning indicator shown for the full wind-up so the rescuer has
        /// a fair chance to react ("visible warning indicator" per spec).
        /// </summary>
        private IEnumerator SpecialAttackLoop()
        {
            while (_controller.IsBattleActive)
            {
                yield return new WaitForSeconds(Constants.RescueGuard.SpecialAttackIntervalSeconds);

                if (!_controller.IsBattleActive)
                {
                    yield break;
                }

                // "Cannot overlap basic attack" — wait out any in-flight
                // basic-attack wind-up before starting the special's own.
                // The visible warning is shown only once the special's
                // actual wind-up begins, so it always reflects a real,
                // about-to-land wind-up rather than a queued/waiting state.
                while (_attackWindupInProgress && _controller.IsBattleActive)
                {
                    yield return null;
                }
                if (!_controller.IsBattleActive)
                {
                    yield break;
                }

                _attackWindupInProgress = true;
                SetWarningVisible(true);
                yield return new WaitForSeconds(Constants.RescueGuard.SpecialAttackWindupSeconds);
                SetWarningVisible(false);
                _attackWindupInProgress = false;

                if (!_controller.IsBattleActive)
                {
                    yield break;
                }

                if (_controller.DistanceToRescuer() <= Constants.RescueGuard.SpecialAttackRangeMeters)
                {
                    _controller.ApplyDamageToRescuer(Constants.RescueGuard.SpecialAttackDamage);
                }
            }
        }

        private void SetWarningVisible(bool visible)
        {
            if (specialWarningIndicator != null)
            {
                specialWarningIndicator.SetActive(visible);
            }
        }

        private void OnDisable()
        {
            EndCombat();
        }
    }
}
