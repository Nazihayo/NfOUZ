using Nfouz.Combat;
using NUnit.Framework;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for BattleManager.cs's Match Winner Detection at
    /// timeout/Overtime (latest detailed NFOUZ GDD: compare remaining
    /// Health percentage; a difference greater than 1 percentage point
    /// decides the winner, otherwise enter a 30s Overtime and compare
    /// again — a difference still within 1 percentage point after
    /// Overtime is a Draw). Exercises the pure static
    /// CompareHealthPercentages helper directly rather than the full
    /// MonoBehaviour, since that is the one part of Match Winner
    /// Detection that doesn't require live NetworkPlayerController/
    /// PlayerCombat instances to verify. Written for Unity Test Framework
    /// (NUnit); not executed in this sandbox — see
    /// DamageCalculatorTests.cs's header note.
    ///
    /// Sprint 6 correction pass: replaces the old
    /// ShouldDefenderWinOnTimeout tests (health-point comparison,
    /// attacker-wins-ties) entirely — see BattleManager.cs's
    /// CompareHealthPercentages doc comment.
    /// </summary>
    [TestFixture]
    public class BattleManagerTests
    {
        [Test]
        public void DefenderWins_WhenDifferenceExceedsOnePercentagePoint()
        {
            var result = BattleManager.CompareHealthPercentages(attackerHealthPercent: 20f, defenderHealthPercent: 50f);

            Assert.AreEqual(BattleManager.HealthComparisonResult.DefenderWins, result);
        }

        [Test]
        public void AttackerWins_WhenDifferenceExceedsOnePercentagePoint()
        {
            var result = BattleManager.CompareHealthPercentages(attackerHealthPercent: 60f, defenderHealthPercent: 10f);

            Assert.AreEqual(BattleManager.HealthComparisonResult.AttackerWins, result);
        }

        [Test]
        public void TooClose_ExactEqualHealthPercentages_EntersOvertimeOrDraw()
        {
            // GDD: a difference within 1 percentage point does not decide
            // a winner outright — the old "attacker wins all ties" rule
            // is removed entirely. The caller (BattleManager) decides
            // what TooClose means: Overtime the first time, Draw the
            // second — this method itself is symmetric and picks neither
            // side.
            var result = BattleManager.CompareHealthPercentages(attackerHealthPercent: 30f, defenderHealthPercent: 30f);

            Assert.AreEqual(BattleManager.HealthComparisonResult.TooClose, result);
        }

        [Test]
        public void TooClose_ExactlyOnePercentagePointDifference_IsStillTooClose()
        {
            // GDD: "if difference is <= 1 percentage point" — exactly 1.0
            // must still count as too close, not as a decided winner.
            var result = BattleManager.CompareHealthPercentages(attackerHealthPercent: 51f, defenderHealthPercent: 50f);

            Assert.AreEqual(BattleManager.HealthComparisonResult.TooClose, result);
        }

        [Test]
        public void DefenderWins_JustOverOnePercentagePointDifference()
        {
            var result = BattleManager.CompareHealthPercentages(attackerHealthPercent: 50f, defenderHealthPercent: 51.01f);

            Assert.AreEqual(BattleManager.HealthComparisonResult.DefenderWins, result);
        }

        [Test]
        public void TooClose_BothAtZeroHealth()
        {
            var result = BattleManager.CompareHealthPercentages(attackerHealthPercent: 0f, defenderHealthPercent: 0f);

            Assert.AreEqual(BattleManager.HealthComparisonResult.TooClose, result);
        }

        [Test]
        public void AttackerWins_FullHealthVsZero()
        {
            var result = BattleManager.CompareHealthPercentages(attackerHealthPercent: 100f, defenderHealthPercent: 0f);

            Assert.AreEqual(BattleManager.HealthComparisonResult.AttackerWins, result);
        }
    }
}
