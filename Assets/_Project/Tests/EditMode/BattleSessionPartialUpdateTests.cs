using NUnit.Framework;
using Nfouz.Networking;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// POST /battle/{id}/ready and /reconnect return only a few fields.
    /// Applying them must keep the rest of the session from
    /// POST /battle/challenge — above all the host-signing material — and
    /// must not end the session.
    /// </summary>
    [TestFixture]
    public class BattleSessionPartialUpdateTests
    {
        private int _ended;

        [SetUp]
        public void SetUp()
        {
            BattleSession.UpdateFromServer(new BattleSessionData
            {
                battle_id = "b-1", photon_room_name = "room-1", attacker_id = "p-a", defender_id = "p-d",
                status = "in_progress", host_authority_secret = "secret", match_nonce = "nonce", rules_version = "v1",
            });
            _ended = 0;
            BattleSession.OnSessionEnded += CountEnded;
        }

        [TearDown]
        public void TearDown()
        {
            BattleSession.OnSessionEnded -= CountEnded;
            BattleSession.Clear();
        }

        private void CountEnded() => _ended++;

        [Test]
        public void ReadyResponse_UpdatesReadyFlagsOnly()
        {
            BattleSession.ApplyReadyState(new BattleSessionData { battle_id = "b-1", attacker_ready = true, defender_ready = true });

            var s = BattleSession.Current;
            Assert.IsTrue(s.attacker_ready && s.defender_ready);
            Assert.AreEqual("in_progress", s.status);
            Assert.AreEqual("p-a", s.attacker_id);
            Assert.AreEqual("p-d", s.defender_id);
            Assert.AreEqual("room-1", s.photon_room_name);
            Assert.AreEqual("secret", s.host_authority_secret);
            Assert.AreEqual("nonce", s.match_nonce);
            Assert.AreEqual("v1", s.rules_version);
            Assert.AreEqual(0, _ended);
        }

        [Test]
        public void ReconnectResponse_UpdatesStatusOnly()
        {
            BattleSession.ApplyStatus(new BattleSessionData { battle_id = "b-1", status = "in_progress" });

            Assert.AreEqual("secret", BattleSession.Current.host_authority_secret);
            Assert.AreEqual("p-a", BattleSession.Current.attacker_id);
            Assert.AreEqual(0, _ended);
        }

        [Test]
        public void EndedStatus_EndsTheSession()
        {
            BattleSession.ApplyStatus(new BattleSessionData { battle_id = "b-1", status = "forfeited" });

            Assert.AreEqual(1, _ended);
        }

        [Test]
        public void UpdateForAnotherBattle_IsIgnored()
        {
            BattleSession.ApplyReadyState(new BattleSessionData { battle_id = "b-2", attacker_ready = true });

            Assert.IsFalse(BattleSession.Current.attacker_ready);
            Assert.AreEqual(0, _ended);
        }
    }
}
