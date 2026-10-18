using NUnit.Framework;
using Nfouz.Social;
using Nfouz.Utils;

namespace Nfouz.Tests.EditMode
{
    /// <summary>The SOS poll stops for an SOS that is gone or not this
    /// player's, and keeps going through transient failures.</summary>
    [TestFixture]
    public class SosPollingTests
    {
        [TestCase("SOS_NOT_FOUND", true)]
        [TestCase("FORBIDDEN", true)]
        [TestCase("NETWORK_ERROR", false)]
        [TestCase("RATE_LIMITED", false)]
        [TestCase("INTERNAL_ERROR", false)]
        [TestCase("INVALID_TOKEN", false)]
        public void PollFailure_IsPermanentOnlyWhenTheSosCannotComeBack(string code, bool permanent)
        {
            Assert.AreEqual(permanent, SosPolling.IsPermanentFailure(new ApiError { code = code }));
        }

        [Test]
        public void MissingError_IsNotPermanent()
        {
            Assert.IsFalse(SosPolling.IsPermanentFailure(null));
        }
    }
}
