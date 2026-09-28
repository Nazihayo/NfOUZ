using Nfouz.Combat;
using NUnit.Framework;
using UnityEngine;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for ChargedPulseSimulator — the pure, stateless core
    /// of Charged Pulse's real "authoritative projectile" gameplay (see
    /// ChargedPulseProjectile.cs's doc comment). No GameObject/
    /// MonoBehaviour/Update loop is needed since the simulator is a plain
    /// static function over a struct — these can call Advance directly
    /// with controlled deltaTime steps. Written for Unity Test Framework;
    /// not executed in this sandbox (no Unity Editor) — see
    /// DamageCalculatorTests.cs's header note.
    /// </summary>
    [TestFixture]
    public class ChargedPulseSimulatorTests
    {
        [Test]
        public void Advance_MovesAtTheGivenSpeed()
        {
            var state = ChargedPulseSimulator.CreateInitial(Vector3.zero);

            // 18 m/s (the GDD's approved speed) for 0.5s should move 9m,
            // as long as it doesn't hit or exceed range first.
            state = ChargedPulseSimulator.Advance(state, Vector3.forward, speed: 18f, collisionRadius: 0.2f, maxRange: 100f, targetPosition: new Vector3(0, 0, 999f), deltaTime: 0.5f);

            Assert.AreEqual(9f, state.DistanceTraveled, 0.001f);
            Assert.AreEqual(new Vector3(0, 0, 9f), state.Position);
            Assert.IsFalse(state.HasHit);
            Assert.IsFalse(state.Expired);
        }

        [Test]
        public void Advance_RegistersAHit_WhenWithinTheCollisionRadiusOfTheTarget()
        {
            var state = ChargedPulseSimulator.CreateInitial(Vector3.zero);
            var targetPosition = new Vector3(0, 0, 1f);

            // 18 m/s * ~0.056s ≈ 1m — lands within the 0.2m collision radius.
            state = ChargedPulseSimulator.Advance(state, Vector3.forward, speed: 18f, collisionRadius: 0.2f, maxRange: 12f, targetPosition: targetPosition, deltaTime: 1f / 18f);

            Assert.IsTrue(state.HasHit);
        }

        [Test]
        public void Advance_DoesNotHit_WhenOutsideTheCollisionRadius()
        {
            var state = ChargedPulseSimulator.CreateInitial(Vector3.zero);
            var farTargetPosition = new Vector3(0, 0, 50f);

            state = ChargedPulseSimulator.Advance(state, Vector3.forward, speed: 18f, collisionRadius: 0.2f, maxRange: 12f, targetPosition: farTargetPosition, deltaTime: 0.1f);

            Assert.IsFalse(state.HasHit);
        }

        [Test]
        public void Advance_ExpiresOnceItTravelsBeyondMaxRangeWithoutHitting()
        {
            var state = ChargedPulseSimulator.CreateInitial(Vector3.zero);
            var farTargetPosition = new Vector3(0, 0, 999f); // never in range of the projectile

            // 18 m/s for 1s = 18m, beyond a 12m (approved Charged Pulse) range.
            state = ChargedPulseSimulator.Advance(state, Vector3.forward, speed: 18f, collisionRadius: 0.2f, maxRange: 12f, targetPosition: farTargetPosition, deltaTime: 1f);

            Assert.IsTrue(state.Expired);
            Assert.IsFalse(state.HasHit);
        }

        [Test]
        public void Advance_RespectsARangerExtendedRange_ThirteenMetersInsteadOfTwelve()
        {
            var state = ChargedPulseSimulator.CreateInitial(Vector3.zero);
            var farTargetPosition = new Vector3(0, 0, 999f);

            // 18 m/s for 0.7s = 12.6m — beyond the base 12m range but still
            // within a Ranger's +1m bonus (13m), so it must NOT expire yet.
            state = ChargedPulseSimulator.Advance(state, Vector3.forward, speed: 18f, collisionRadius: 0.2f, maxRange: 13f, targetPosition: farTargetPosition, deltaTime: 0.7f);

            Assert.IsFalse(state.Expired);
        }

        [Test]
        public void Advance_IsANoOpAfterAHit_PreventingADuplicateHitOnTheSameProjectile()
        {
            var state = ChargedPulseSimulator.CreateInitial(Vector3.zero);
            var targetPosition = new Vector3(0, 0, 1f);

            state = ChargedPulseSimulator.Advance(state, Vector3.forward, speed: 18f, collisionRadius: 0.2f, maxRange: 12f, targetPosition: targetPosition, deltaTime: 1f / 18f);
            Assert.IsTrue(state.HasHit);
            var positionAtHit = state.Position;

            // A second Advance call (e.g. a stray extra Update tick before
            // the GameObject is destroyed) must not move the projectile or
            // change its hit state — the caller can safely treat HasHit as
            // a one-time latch and apply damage exactly once.
            var stateAfter = ChargedPulseSimulator.Advance(state, Vector3.forward, speed: 18f, collisionRadius: 0.2f, maxRange: 12f, targetPosition: targetPosition, deltaTime: 1f);

            Assert.AreEqual(positionAtHit, stateAfter.Position);
            Assert.IsTrue(stateAfter.HasHit);
        }

        [Test]
        public void Advance_IsANoOpAfterExpiring()
        {
            var state = ChargedPulseSimulator.CreateInitial(Vector3.zero);
            var farTargetPosition = new Vector3(0, 0, 999f);

            state = ChargedPulseSimulator.Advance(state, Vector3.forward, speed: 18f, collisionRadius: 0.2f, maxRange: 12f, targetPosition: farTargetPosition, deltaTime: 1f);
            Assert.IsTrue(state.Expired);
            var distanceAtExpiry = state.DistanceTraveled;

            var stateAfter = ChargedPulseSimulator.Advance(state, Vector3.forward, speed: 18f, collisionRadius: 0.2f, maxRange: 12f, targetPosition: farTargetPosition, deltaTime: 1f);

            Assert.AreEqual(distanceAtExpiry, stateAfter.DistanceTraveled);
            Assert.IsFalse(stateAfter.HasHit);
        }
    }
}
