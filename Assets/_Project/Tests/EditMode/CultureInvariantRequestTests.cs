using System;
using System.Globalization;
using System.Threading;
using NUnit.Framework;
using Nfouz.Map;
using Nfouz.Networking;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// Values the backend parses (query numbers, the signed battle result)
    /// must not depend on the device or Editor culture. de-DE is the
    /// developer's Windows locale; ar-SA is Arabic with a Hijri calendar and
    /// the Arabic decimal separator.
    /// </summary>
    [TestFixture]
    public class CultureInvariantRequestTests
    {
        private CultureInfo _originalCulture;

        [SetUp]
        public void SetUp() => _originalCulture = Thread.CurrentThread.CurrentCulture;

        [TearDown]
        public void TearDown() => Thread.CurrentThread.CurrentCulture = _originalCulture;

        [TestCase("de-DE")]
        [TestCase("ar-SA")]
        [TestCase("en-US")]
        public void NearbyEndpoint_UsesDotDecimals(string culture)
        {
            Thread.CurrentThread.CurrentCulture = new CultureInfo(culture);
            Assert.AreEqual("/player/nearby?lat=52.5978&lng=9.0854&radius=1000",
                NearbyPlayersQuery.BuildEndpoint(52.5978, 9.0854, 1000));
        }

        [TestCase("ar-SA")]
        [TestCase("de-DE")]
        [TestCase("th-TH")]
        public void IssuedAt_IsGregorianIso8601(string culture)
        {
            Thread.CurrentThread.CurrentCulture = new CultureInfo(culture);
            var utc = new DateTime(2026, 10, 18, 12, 34, 56, 789, DateTimeKind.Utc);
            Assert.AreEqual("2026-10-18T12:34:56.789Z", BattleResultSignature.FormatIssuedAt(utc));
        }

        /// <summary>Expected value from the backend itself:
        /// signResult(result, "test-secret") in
        /// backend/src/utils/battleResultSignature.js.</summary>
        [TestCase("ar-SA")]
        [TestCase("de-DE")]
        public void Signature_MatchesBackend(string culture)
        {
            Thread.CurrentThread.CurrentCulture = new CultureInfo(culture);
            var result = new BattleResultPayload
            {
                battle_id = "b-1", room_name = "room-1", rules_version = "v1", match_nonce = "nonce-1",
                event_seq = 1, attacker_id = "p-a", defender_id = "p-d",
                attacker_final_health = 60, defender_final_health = 0, outcome = "attacker_win",
                duration_seconds = 45, issued_at = "2026-10-18T12:34:56.789Z",
            };

            Assert.AreEqual("b-1|room-1|v1|nonce-1|1|p-a|p-d|60|0|attacker_win|45|2026-10-18T12:34:56.789Z",
                BattleResultSignature.Canonicalize(result));
            Assert.AreEqual("1f52bd1b92e3ed6ea36c2979a878c084bc432ccacde633f1bf937ed1c22a4597",
                BattleResultSignature.Sign(result, "test-secret"));
        }
    }
}
