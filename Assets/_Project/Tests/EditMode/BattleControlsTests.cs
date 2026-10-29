using NUnit.Framework;
using Nfouz.Networking;

namespace Nfouz.Tests.EditMode
{
    /// <summary>Battle controls (HANDOFF item 35): the combat-button latch,
    /// once-per-press detection on the host, and the phone's movement
    /// stick.</summary>
    [TestFixture]
    public class BattleControlsTests
    {
        [Test]
        public void Latch_KeepsEveryPressUntilConsumed_ThenForgetsThem()
        {
            var latch = new CombatActionLatch();
            latch.Press(CombatAction.BasicAttack);
            latch.Press(CombatAction.Dodge);
            Assert.AreEqual(CombatAction.BasicAttack | CombatAction.Dodge, latch.Consume());
            Assert.AreEqual(CombatAction.None, latch.Consume());
        }

        [Test]
        public void Latch_Clear_DropsPressesFromTheCountdown()
        {
            var latch = new CombatActionLatch();
            latch.Press(CombatAction.Special);
            latch.Clear();
            Assert.AreEqual(CombatAction.None, latch.Consume());
        }

        [Test]
        public void NewlyPressed_RunsAPressOnce_EvenIfTheSameInputRepeats()
        {
            var attack = (int)CombatAction.BasicAttack;
            Assert.AreEqual(CombatAction.BasicAttack, CombatActionBits.NewlyPressed(attack, 0));
            Assert.AreEqual(CombatAction.None, CombatActionBits.NewlyPressed(attack, attack));
            Assert.AreEqual(CombatAction.Dodge,
                CombatActionBits.NewlyPressed(attack | (int)CombatAction.Dodge, attack));
        }

        [Test]
        public void NewlyPressed_DropsUnknownBits()
        {
            Assert.AreEqual(CombatAction.None, CombatActionBits.NewlyPressed(1 << 10, 0));
        }

        [Test]
        public void Stick_InsideTheDeadZone_IsNoMovement()
        {
            TouchStickMath.Evaluate(100f, 100f, 105f, 100f, 100f, out var x, out var z);
            Assert.AreEqual(0f, x);
            Assert.AreEqual(0f, z);
        }

        [Test]
        public void Stick_PastTheRadius_IsCappedAtFullSpeed()
        {
            TouchStickMath.Evaluate(100f, 100f, 400f, 100f, 100f, out var x, out var z);
            Assert.AreEqual(1f, x, 1e-5f);
            Assert.AreEqual(0f, z, 1e-5f);
        }

        [Test]
        public void Stick_UpOnTheScreen_IsForward()
        {
            TouchStickMath.Evaluate(100f, 100f, 100f, 200f, 100f, out var x, out var z);
            Assert.AreEqual(0f, x, 1e-5f);
            Assert.AreEqual(1f, z, 1e-5f);
        }

        [Test]
        public void Stick_NaNOrNoRadius_IsNoMovement()
        {
            TouchStickMath.Evaluate(100f, 100f, float.NaN, 100f, 100f, out var x1, out var z1);
            TouchStickMath.Evaluate(100f, 100f, 300f, 100f, 0f, out var x2, out var z2);
            Assert.AreEqual(0f, x1 + z1 + x2 + z2);
        }

        [Test]
        public void Stick_StartsOnlyInTheLowerLeftZone()
        {
            Assert.IsTrue(TouchStickMath.StartsInZone(100f, 100f, 1080f, 2400f));
            Assert.IsFalse(TouchStickMath.StartsInZone(900f, 100f, 1080f, 2400f), "right side: action buttons");
            Assert.IsFalse(TouchStickMath.StartsInZone(100f, 2300f, 1080f, 2400f), "top: timer and bars");
        }
    }
}
