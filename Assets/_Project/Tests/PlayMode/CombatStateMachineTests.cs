using System.Collections;
using Nfouz.Combat;
using Nfouz.Networking;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Nfouz.Tests.PlayMode
{
    /// <summary>
    /// PlayMode tests for CombatStateMachine.cs's timed Countdown -> Battle
    /// transition, which runs in a coroutine and only advances in Play
    /// Mode. Moved here unchanged from EditMode/CombatStateMachineTests.cs.
    /// In Play Mode, AddComponent runs OnEnable (subscribing to
    /// BattleSession) and DestroyImmediate runs OnDisable.
    /// </summary>
    [TestFixture]
    public class CombatStateMachineTests
    {
        private GameObject _go;
        private CombatStateMachine _stateMachine;

        [SetUp]
        public void SetUp()
        {
            _go = new GameObject("TestCombatStateMachine");
            _stateMachine = _go.AddComponent<CombatStateMachine>();
        }

        [TearDown]
        public void TearDown()
        {
            Object.DestroyImmediate(_go);
            BattleSession.Clear();
        }

        [UnityTest]
        public IEnumerator TransitionsToBattle_AfterCountdownSecondsElapse()
        {
            BattleSession.UpdateFromServer(new BattleSessionData
            {
                battle_id = "b-1",
                status = "in_progress",
                attacker_ready = true,
                defender_ready = true,
            });

            Assert.AreEqual(CombatStateMachine.MatchState.Countdown, _stateMachine.CurrentState);

            // Constants.Battle.CountdownSeconds = 3
            yield return new WaitForSeconds(3.1f);

            Assert.AreEqual(CombatStateMachine.MatchState.Battle, _stateMachine.CurrentState);
        }

        [UnityTest]
        public IEnumerator EnterOvertime_TransitionsToOvertime_WhenCalledDuringBattle()
        {
            BattleSession.UpdateFromServer(new BattleSessionData
            {
                battle_id = "b-1",
                status = "in_progress",
                attacker_ready = true,
                defender_ready = true,
            });

            // Constants.Battle.CountdownSeconds = 3
            yield return new WaitForSeconds(3.1f);
            Assert.AreEqual(CombatStateMachine.MatchState.Battle, _stateMachine.CurrentState);

            var stateChanges = 0;
            _stateMachine.OnStateChanged += _ => stateChanges++;

            _stateMachine.EnterOvertime();

            Assert.AreEqual(CombatStateMachine.MatchState.Overtime, _stateMachine.CurrentState);
            Assert.AreEqual(1, stateChanges);
        }
    }
}
