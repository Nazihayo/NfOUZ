using Nfouz.UI.Screens;
using NUnit.Framework;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for SosScreen's pure SosStatusMessages helper
    /// (UI/Screens/SosScreen.cs) — SOS updates. Not executed in this
    /// sandbox — see DamageCalculatorTests.cs's header note.
    /// </summary>
    [TestFixture]
    public class SosStatusMessagesTests
    {
        [Test]
        public void ForHasActiveSos_True_ReturnsActiveMessage()
        {
            Assert.AreEqual("نداء استغاثة نشط.", SosStatusMessages.ForHasActiveSos(true));
        }

        [Test]
        public void ForHasActiveSos_False_ReturnsNoActiveMessage()
        {
            Assert.AreEqual("لا يوجد نداء استغاثة حالياً.", SosStatusMessages.ForHasActiveSos(false));
        }

        [TestCase("created")]
        [TestCase("open")]
        [TestCase("rescued")]
        [TestCase("expired")]
        public void ForStatus_KnownStatus_ReturnsNonEmptyDistinctMessage(string status)
        {
            var message = SosStatusMessages.ForStatus(status);

            Assert.IsNotEmpty(message);
            Assert.AreNotEqual(status, message);
        }

        [Test]
        public void ForStatus_UnknownStatus_ReturnsStatusItself()
        {
            const string unknown = "some_future_status";
            Assert.AreEqual(unknown, SosStatusMessages.ForStatus(unknown));
        }

        [Test]
        public void ForError_IncludesTheErrorCode()
        {
            var message = SosStatusMessages.ForError("SOS_REQUIRES_CONTROL");
            StringAssert.Contains("SOS_REQUIRES_CONTROL", message);
        }
    }
}
