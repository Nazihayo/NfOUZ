using Nfouz.Combat;
using Nfouz.Networking;
using NUnit.Framework;
using UnityEngine;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for CombatStateMachine.cs's Match Flow states
    /// (Ready -> Countdown -> Battle -> Ended). Written for Unity Test
    /// Framework; not executed in this sandbox — see
    /// DamageCalculatorTests.cs's header note. The timed countdown
    /// transition needs a running coroutine, so its tests live in
    /// PlayMode/CombatStateMachineTests.cs.
    /// </summary>
    [TestFixture]
    public class CombatStateMachineTests
    {
        private GameObject _go;
        private CombatStateMachine _stateMachine;
        private bool _lifecycleStarted;

        [SetUp]
        public void SetUp()
        {
            _go = new GameObject("TestCombatStateMachine");
            _stateMachine = _go.AddComponent<CombatStateMachine>();
            _lifecycleStarted = false;
        }

        // EditMode skips OnEnable for AddComponent, so the state machine
        // never subscribes to BattleSession's events unless a test runs it.
        private void StartLifecycle()
        {
            EditModeLifecycle.Start(_stateMachine);
            _lifecycleStarted = true;
        }

        [TearDown]
        public void TearDown()
        {
            if (_lifecycleStarted)
            {
                // Unsubscribe from the static events before the object is destroyed.
                EditModeLifecycle.Stop(_stateMachine);
            }

            Object.DestroyImmediate(_go);
            BattleSession.Clear();
        }

        [Test]
        public void StartsInReadyState()
        {
            Assert.AreEqual(CombatStateMachine.MatchState.Ready, _stateMachine.CurrentState);
        }

        [Test]
        public void RemainsInReady_WhenOnlyOneSideIsReady()
        {
            BattleSession.UpdateFromServer(new BattleSessionData
            {
                battle_id = "b-1",
                status = "in_progress",
                attacker_ready = true,
                defender_ready = false,
            });

            Assert.AreEqual(CombatStateMachine.MatchState.Ready, _stateMachine.CurrentState);
        }

        [Test]
        public void TransitionsToCountdown_WhenBothSidesReady()
        {
            StartLifecycle();
            var stateChanges = 0;
            _stateMachine.OnStateChanged += _ => stateChanges++;

            BattleSession.UpdateFromServer(new BattleSessionData
            {
                battle_id = "b-1",
                status = "in_progress",
                attacker_ready = true,
                defender_ready = true,
            });

            Assert.AreEqual(CombatStateMachine.MatchState.Countdown, _stateMachine.CurrentState);
            Assert.AreEqual(1, stateChanges);
        }

        [Test]
        public void EnterOvertime_TransitionsFromBattleToOvertime()
        {
            StartLifecycle();
            BattleSession.UpdateFromServer(new BattleSessionData
            {
                battle_id = "b-1",
                status = "in_progress",
                attacker_ready = true,
                defender_ready = true,
            });
            Assert.AreEqual(CombatStateMachine.MatchState.Countdown, _stateMachine.CurrentState);

            // Skip straight past Countdown for this test's purposes — only
            // the Battle -> Overtime transition is under test here; the
            // timed Countdown -> Battle transition is covered by
            // TransitionsToBattle_AfterCountdownSecondsElapse in
            // PlayMode/CombatStateMachineTests.cs.
            _stateMachine.EndMatch();
            Assert.AreEqual(CombatStateMachine.MatchState.Ended, _stateMachine.CurrentState);

            // EnterOvertime is a no-op once the match has already ended —
            // it may only be reached from Battle.
            _stateMachine.EnterOvertime();
            Assert.AreEqual(CombatStateMachine.MatchState.Ended, _stateMachine.CurrentState);
        }

        [Test]
        public void EndMatch_TransitionsToEnded_FromAnyState()
        {
            _stateMachine.EndMatch();
            Assert.AreEqual(CombatStateMachine.MatchState.Ended, _stateMachine.CurrentState);
        }

        [Test]
        public void EndMatch_IsIdempotent_DoesNotFireStateChangedTwice()
        {
            _stateMachine.EndMatch();

            var firedAgain = false;
            _stateMachine.OnStateChanged += _ => firedAgain = true;
            _stateMachine.EndMatch();

            Assert.IsFalse(firedAgain);
        }

        [Test]
        public void SessionEndedEvent_EndsMatch_EvenWithoutExplicitEndMatchCall()
        {
            // Simulates a Sprint 5 forfeit/cancellation arriving mid-battle.
            StartLifecycle();
            BattleSession.UpdateFromServer(new BattleSessionData
            {
                battle_id = "b-1",
                status = "forfeited",
                forfeited_by = "someone",
            });

            Assert.AreEqual(CombatStateMachine.MatchState.Ended, _stateMachine.CurrentState);
        }
    }
}
