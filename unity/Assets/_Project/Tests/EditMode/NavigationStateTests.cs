using Nfouz.UI;
using NUnit.Framework;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for BottomNavController's pure NavigationState class
    /// (UI/BottomNavController.cs) — Navigation / State transitions. No
    /// GameObject/Button is needed since NavigationState holds no Unity
    /// dependency; not executed in this sandbox — see
    /// DamageCalculatorTests.cs's header note for why (no Unity Editor/
    /// compiler available here).
    /// </summary>
    [TestFixture]
    public class NavigationStateTests
    {
        [Test]
        public void StartsOnMainMap()
        {
            var state = new NavigationState();
            Assert.AreEqual(ScreenId.MainMap, state.Current);
        }

        [Test]
        public void SwitchTo_ChangesCurrentAndReturnsTrue()
        {
            var state = new NavigationState();
            var changed = state.SwitchTo(ScreenId.Inventory);

            Assert.IsTrue(changed);
            Assert.AreEqual(ScreenId.Inventory, state.Current);
        }

        [Test]
        public void SwitchTo_SameTab_ReturnsFalse_AndLeavesCurrentUnchanged()
        {
            var state = new NavigationState();
            state.SwitchTo(ScreenId.Friends);

            var changed = state.SwitchTo(ScreenId.Friends);

            Assert.IsFalse(changed);
            Assert.AreEqual(ScreenId.Friends, state.Current);
        }

        [Test]
        public void SwitchTo_CanMoveBetweenSeveralTabsInSequence()
        {
            var state = new NavigationState();

            Assert.IsTrue(state.SwitchTo(ScreenId.Quest));
            Assert.IsTrue(state.SwitchTo(ScreenId.Profile));
            Assert.IsTrue(state.SwitchTo(ScreenId.MainMap));
            Assert.AreEqual(ScreenId.MainMap, state.Current);
        }
    }
}
