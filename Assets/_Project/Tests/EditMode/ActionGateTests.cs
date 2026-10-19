using NUnit.Framework;
using Nfouz.Utils;

namespace Nfouz.Tests.EditMode
{
    /// <summary>A second tap while a request is in flight is ignored
    /// (Login, Register, Onboarding Confirm, Challenge).</summary>
    [TestFixture]
    public class ActionGateTests
    {
        [Test]
        public void SecondTapWhileBusy_IsRefused()
        {
            var gate = new ActionGate();
            Assert.IsTrue(gate.TryBegin());
            Assert.IsTrue(gate.IsBusy);
            Assert.IsFalse(gate.TryBegin());
        }

        [Test]
        public void AfterEnd_TheNextTapRunsAgain()
        {
            var gate = new ActionGate();
            gate.TryBegin();
            gate.End();
            Assert.IsFalse(gate.IsBusy);
            Assert.IsTrue(gate.TryBegin());
        }
    }
}
