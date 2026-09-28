using Nfouz.Combat;
using Nfouz.Core;
using Nfouz.Networking;
using NUnit.Framework;
using UnityEngine;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for the Sprint 10 additive, read-only HUD accessors on
    /// BattleManager.cs (MatchTimeRemaining/OvertimeTimeRemaining/
    /// IsInOvertime/LocalPlayerCombat) — added so BattleScreen.cs can
    /// display the live Match Timer without BattleManager's own match-flow
    /// logic being touched. Covers "Battle result updates"/"UI refresh" for
    /// this sprint's own new wiring. Not executed in this sandbox — see
    /// DamageCalculatorTests.cs's header note.
    /// </summary>
    [TestFixture]
    public class BattleManagerHudAccessorsTests
    {
        private GameObject _go;
        private BattleManager _battleManager;

        [SetUp]
        public void SetUp()
        {
            _go = new GameObject("TestBattleManager");
            _go.AddComponent<CombatStateMachine>();
            _battleManager = _go.AddComponent<BattleManager>();
        }

        [TearDown]
        public void TearDown()
        {
            Object.DestroyImmediate(_go);
            BattleSession.Clear();
            PlayerSession.Clear();
        }

        [Test]
        public void MatchTimeRemaining_DefaultsToZero_BeforeAnyStateChange()
        {
            Assert.AreEqual(0f, _battleManager.MatchTimeRemaining);
        }

        [Test]
        public void OvertimeTimeRemaining_DefaultsToZero_BeforeOvertime()
        {
            Assert.AreEqual(0f, _battleManager.OvertimeTimeRemaining);
        }

        [Test]
        public void IsInOvertime_DefaultsToFalse()
        {
            Assert.IsFalse(_battleManager.IsInOvertime);
        }

        [Test]
        public void LocalPlayerCombat_NullWithNoActiveSessions()
        {
            Assert.IsNull(_battleManager.LocalPlayerCombat);
        }

        [Test]
        public void LocalPlayerCombat_NullWhenCombatantsNotYetIdentified_EvenWithActiveSessions()
        {
            PlayerSession.UpdateFromServer(new PlayerSessionData { PlayerId = "p1" });
            BattleSession.UpdateFromServer(new BattleSessionData
            {
                battle_id = "b1",
                status = "in_progress",
                attacker_id = "p1",
                defender_id = "p2",
            });

            // IdentifyCombatants only runs at Countdown (via BattleManager's
            // own state-change handler) — before that, the accessor must
            // return null rather than throw, since neither combatant field
            // has been populated yet.
            Assert.IsNull(_battleManager.LocalPlayerCombat);
        }
    }
}
