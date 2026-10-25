using NUnit.Framework;
using Nfouz.Map;

namespace Nfouz.Tests.EditMode
{
    /// <summary>The driving message appears once when the server starts
    /// reporting moving_too_fast and closes when it stops.</summary>
    [TestFixture]
    public class SafetyMessagesTests
    {
        [Test]
        public void DrivingNotice_ShowsOnceThenClosesWhenSlow()
        {
            var gate = new DrivingNoticeGate();
            Assert.AreEqual(0, gate.Update(false), "walking from the start: nothing to show");
            Assert.AreEqual(1, gate.Update(true), "starts driving: show");
            Assert.AreEqual(0, gate.Update(true), "still driving: not again");
            Assert.AreEqual(-1, gate.Update(false), "stopped: close");
            Assert.AreEqual(0, gate.Update(false));
            Assert.AreEqual(1, gate.Update(true), "drives again: show again");
        }

        [Test]
        public void Messages_AreArabic()
        {
            foreach (var text in new[] { SafetyMessages.Driving, SafetyMessages.HiddenChallenge, SafetyMessages.VisibilityLabel, SafetyMessages.VisibilityError })
            {
                StringAssert.IsMatch("[؀-ۿ]", text);
            }
        }
    }
}
