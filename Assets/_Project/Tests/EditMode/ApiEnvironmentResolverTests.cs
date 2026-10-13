using NUnit.Framework;
using Nfouz.Utils;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// The Production API must never be reachable from the Editor or a
    /// Development Build; every other selection passes through unchanged.
    /// </summary>
    [TestFixture]
    public class ApiEnvironmentResolverTests
    {
        [Test]
        public void Production_IsRedirectedToDevelopment_InEditorAndDevelopmentBuilds()
        {
            Assert.AreEqual(ApiEnvironment.Development,
                ApiEnvironmentResolver.Resolve(ApiEnvironment.Production, isTestContext: true));
        }

        [Test]
        public void Production_IsAllowed_InReleaseBuilds()
        {
            Assert.AreEqual(ApiEnvironment.Production,
                ApiEnvironmentResolver.Resolve(ApiEnvironment.Production, isTestContext: false));
        }

        [TestCase(ApiEnvironment.Development, true)]
        [TestCase(ApiEnvironment.Development, false)]
        [TestCase(ApiEnvironment.Staging, true)]
        [TestCase(ApiEnvironment.Staging, false)]
        public void NonProductionEnvironments_AreUnchanged(ApiEnvironment requested, bool isTestContext)
        {
            Assert.AreEqual(requested, ApiEnvironmentResolver.Resolve(requested, isTestContext));
        }
    }
}
