using NUnit.Framework;
using Nfouz.Networking;

namespace Nfouz.Tests.EditMode
{
    /// <summary>Device logs never carry the player's coordinates: request
    /// query strings (GET /player/nearby?lat=…) are dropped from them.</summary>
    [TestFixture]
    public class LogRedactionTests
    {
        [TestCase("/player/nearby?lat=53.5511&lng=9.9937&radius=500", "/player/nearby?…")]
        [TestCase("/battle/3f2b9c1e-0000-4000-8000-000000000000/ready", "/battle/3f2b9c1e-0000-4000-8000-000000000000/ready")]
        [TestCase("", "")]
        [TestCase(null, null)]
        public void LoggedEndpoints_NeverCarryTheQuery(string endpoint, string logged)
        {
            Assert.AreEqual(logged, LogRedaction.Endpoint(endpoint));
        }
    }
}
