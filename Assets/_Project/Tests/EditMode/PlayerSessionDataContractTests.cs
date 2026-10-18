using System.Linq;
using System.Reflection;
using NUnit.Framework;
using Nfouz.Core;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// PlayerSessionData is parsed with JsonUtility from GET /auth/me and
    /// POST /auth/register, whose keys come from the backend's
    /// auth.service.js toPublicPlayer. JsonUtility only fills fields whose
    /// serialized name matches a key exactly; any mismatch silently leaves a
    /// default (an empty PlayerId means no active session).
    /// </summary>
    [TestFixture]
    public class PlayerSessionDataContractTests
    {
        // toPublicPlayer keys, minus faction_id (no Unity field until the
        // Faction System exists).
        private static readonly string[] BackendKeys =
        {
            "player_id", "username", "class_type", "health", "max_health", "energy", "max_energy",
            "influence", "level", "experience", "rank", "credits", "is_controlled", "controller_id",
            "controlled_until", "is_protected", "protected_until",
        };

        [Test]
        public void SerializedFieldNames_MatchBackendKeys()
        {
            var serialized = typeof(PlayerSessionData)
                .GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                .Where(f => f.IsPublic || f.GetCustomAttribute<SerializeField>() != null)
                .Select(f => f.Name)
                .OrderBy(n => n)
                .ToArray();
            CollectionAssert.AreEqual(BackendKeys.OrderBy(n => n).ToArray(), serialized);
        }

        [Test]
        public void AuthMeEnvelope_ParsesIntoSession()
        {
            const string json = "{\"success\":true,\"data\":{\"player_id\":\"p-1\",\"username\":\"alpha_one\"," +
                "\"class_type\":\"Scout\",\"faction_id\":null,\"health\":80,\"max_health\":100,\"energy\":40," +
                "\"max_energy\":50,\"influence\":7,\"level\":3,\"experience\":120,\"rank\":\"Recruit\"," +
                "\"credits\":250,\"is_controlled\":true,\"controller_id\":\"p-2\"," +
                "\"controlled_until\":\"2026-10-19T10:00:00.000Z\",\"is_protected\":false,\"protected_until\":null}}";

            var data = JsonUtility.FromJson<ApiResponse<PlayerSessionData>>(json).data;

            Assert.AreEqual("p-1", data.PlayerId);
            Assert.AreEqual("alpha_one", data.Username);
            Assert.AreEqual("Scout", data.ClassType);
            Assert.AreEqual(80, data.Health);
            Assert.AreEqual(100, data.MaxHealth);
            Assert.AreEqual(40, data.Energy);
            Assert.AreEqual(50, data.MaxEnergy);
            Assert.AreEqual(7, data.Influence);
            Assert.AreEqual(3, data.Level);
            Assert.AreEqual(120, data.Experience);
            Assert.AreEqual("Recruit", data.Rank);
            Assert.AreEqual(250, data.Credits);
            Assert.IsTrue(data.IsControlled);
            Assert.AreEqual("p-2", data.ControllerId);
            Assert.AreEqual("2026-10-19T10:00:00.000Z", data.ControlledUntilIso);
            Assert.IsFalse(data.IsProtected);
        }
    }
}
