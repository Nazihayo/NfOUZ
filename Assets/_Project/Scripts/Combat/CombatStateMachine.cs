using System;
using System.Collections;
using Nfouz.Networking;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Combat
{
    /// <summary>
    /// Match Flow state machine: Ready -> Countdown -> Battle -> (Overtime
    /// ->) Ended. Deliberately additive-only with respect to Sprint 5: it
    /// drives combat-enabling state purely by subscribing to the
    /// already-public static events on Networking.BattleSession
    /// (OnSessionUpdated / OnSessionEnded), the same data
    /// BattleLoadingController.cs (Sprint 5) already reacts to for its
    /// loading-screen UI. No Sprint 5 file is modified to wire this in —
    /// see BATTLE_SCENE_SETUP.md's cross-scene wiring notes for why that
    /// file is left untouched.
    ///
    /// Sprint 6 correction pass: added the Overtime state (GDD's 30s
    /// tie-break window when the 90s timeout's Health-percentage
    /// comparison is too close to call) — see BattleManager.cs for when
    /// EnterOvertime() is invoked and for the corrected timeout/draw
    /// logic that replaces the old "attacker always wins ties" rule.
    /// </summary>
    public class CombatStateMachine : MonoBehaviour
    {
        public enum MatchState
        {
            Ready,
            Countdown,
            Battle,
            Overtime,
            Ended,
        }

        public event Action<MatchState> OnStateChanged;

        public MatchState CurrentState { get; private set; } = MatchState.Ready;

        private Coroutine _countdownRoutine;

        private void OnEnable()
        {
            BattleSession.OnSessionUpdated += HandleSessionUpdated;
            BattleSession.OnSessionEnded += HandleSessionEnded;
        }

        private void OnDisable()
        {
            BattleSession.OnSessionUpdated -= HandleSessionUpdated;
            BattleSession.OnSessionEnded -= HandleSessionEnded;

            if (_countdownRoutine != null)
            {
                StopCoroutine(_countdownRoutine);
                _countdownRoutine = null;
            }
        }

        private void HandleSessionUpdated(BattleSessionData data)
        {
            if (CurrentState == MatchState.Ready && data.attacker_ready && data.defender_ready)
            {
                TransitionTo(MatchState.Countdown);
                _countdownRoutine = StartCoroutine(RunCountdown());
            }
        }

        private void HandleSessionEnded()
        {
            // A forfeit/cancellation arriving from the server (Sprint 5
            // disconnect-grace-period logic) ends the match the same way
            // a death or the match timer would — see BattleManager.cs for
            // the death/timeout path into EndMatch().
            if (CurrentState != MatchState.Ended)
            {
                EndMatch();
            }
        }

        private IEnumerator RunCountdown()
        {
            yield return new WaitForSeconds(Constants.Battle.CountdownSeconds);

            if (CurrentState == MatchState.Countdown)
            {
                TransitionTo(MatchState.Battle);
            }

            _countdownRoutine = null;
        }

        /// <summary>Called by BattleManager when the 90s Battle timer
        /// expires with the two players' remaining Health percentages
        /// within the GDD's 1-percentage-point threshold — enters the 30s
        /// Overtime window (energy regen disabled — see
        /// PlayerCombat.EnergyRegenEnabled) rather than ending the match
        /// outright. A no-op if not currently in Battle, so a stray
        /// duplicate call can't skip states.</summary>
        public void EnterOvertime()
        {
            if (CurrentState != MatchState.Battle)
            {
                return;
            }

            TransitionTo(MatchState.Overtime);
        }

        /// <summary>Called by BattleManager on death or match/overtime
        /// timer expiry to move into the terminal Ended state.</summary>
        public void EndMatch()
        {
            if (CurrentState == MatchState.Ended)
            {
                return;
            }

            if (_countdownRoutine != null)
            {
                StopCoroutine(_countdownRoutine);
                _countdownRoutine = null;
            }

            TransitionTo(MatchState.Ended);
        }

        private void TransitionTo(MatchState newState)
        {
            if (CurrentState == newState)
            {
                return;
            }

            Debug.Log($"[CombatStateMachine] {CurrentState} -> {newState}");
            CurrentState = newState;
            OnStateChanged?.Invoke(CurrentState);
        }
    }
}
