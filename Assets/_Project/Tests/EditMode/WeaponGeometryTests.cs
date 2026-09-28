using Nfouz.Combat;
using NUnit.Framework;
using UnityEngine;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for WeaponGeometry.cs — the pure, stateless geometry
    /// helpers behind Pulse Arc's arc check, Ground Break's radius check
    /// and knockback resistance, Shadow Lunge's contact/arena-boundary
    /// checks. These need no GameObject/MonoBehaviour at all, so unlike
    /// most of this project's Unity-side tests they are pure C# — but are
    /// still written for the Unity Test Framework runner and not executed
    /// in this sandbox (no Unity Editor) — see DamageCalculatorTests.cs's
    /// header note.
    /// </summary>
    [TestFixture]
    public class WeaponGeometryTests
    {
        // ---- Pulse Arc: 3m range, 140-degree arc ----

        [Test]
        public void IsWithinArc_AcceptsATargetDirectlyAheadWithinRange()
        {
            var inArc = WeaponGeometry.IsWithinArc(Vector3.zero, Vector3.forward, new Vector3(0, 0, 2f), range: 3f, arcDegrees: 140f);
            Assert.IsTrue(inArc);
        }

        [Test]
        public void IsWithinArc_RejectsATargetBeyondRange_EvenDirectlyAhead()
        {
            var inArc = WeaponGeometry.IsWithinArc(Vector3.zero, Vector3.forward, new Vector3(0, 0, 5f), range: 3f, arcDegrees: 140f);
            Assert.IsFalse(inArc);
        }

        [Test]
        public void IsWithinArc_RejectsATargetDirectlyBehind_EvenWithinRange()
        {
            // 140 degrees total = 70 degrees each side of forward — directly
            // behind (180 degrees) is well outside that.
            var inArc = WeaponGeometry.IsWithinArc(Vector3.zero, Vector3.forward, new Vector3(0, 0, -2f), range: 3f, arcDegrees: 140f);
            Assert.IsFalse(inArc);
        }

        [Test]
        public void IsWithinArc_AcceptsATargetJustInsideTheHalfAngleBoundary()
        {
            // Half-angle is 70 degrees. Place the target at 65 degrees off
            // forward, well within range.
            var direction = Quaternion.Euler(0, 65f, 0) * Vector3.forward;
            var targetPosition = direction.normalized * 2f;

            var inArc = WeaponGeometry.IsWithinArc(Vector3.zero, Vector3.forward, targetPosition, range: 3f, arcDegrees: 140f);
            Assert.IsTrue(inArc);
        }

        [Test]
        public void IsWithinArc_RejectsATargetJustOutsideTheHalfAngleBoundary()
        {
            // 75 degrees off forward is outside the 70-degree half-angle.
            var direction = Quaternion.Euler(0, 75f, 0) * Vector3.forward;
            var targetPosition = direction.normalized * 2f;

            var inArc = WeaponGeometry.IsWithinArc(Vector3.zero, Vector3.forward, targetPosition, range: 3f, arcDegrees: 140f);
            Assert.IsFalse(inArc);
        }

        // ---- Ground Break: 3m radius ----

        [Test]
        public void IsWithinRadius_AcceptsATargetInsideTheRadius()
        {
            Assert.IsTrue(WeaponGeometry.IsWithinRadius(Vector3.zero, new Vector3(2f, 0, 0), radius: 3f));
        }

        [Test]
        public void IsWithinRadius_RejectsATargetOutsideTheRadius()
        {
            Assert.IsFalse(WeaponGeometry.IsWithinRadius(Vector3.zero, new Vector3(4f, 0, 0), radius: 3f));
        }

        [Test]
        public void IsWithinRadius_TreatsExactlyOnTheBoundaryAsInside()
        {
            Assert.IsTrue(WeaponGeometry.IsWithinRadius(Vector3.zero, new Vector3(3f, 0, 0), radius: 3f));
        }

        // ---- Ground Break: knockback resistance ----

        [Test]
        public void ApplyKnockbackResistance_ReducesKnockbackByExactly30PercentForATitan()
        {
            var reduced = WeaponGeometry.ApplyKnockbackResistance(1f, targetHasResistance: true, resistanceFraction: 0.30f);
            Assert.AreEqual(0.7f, reduced, 0.0001f);
        }

        [Test]
        public void ApplyKnockbackResistance_LeavesKnockbackUnchangedForANonTitan()
        {
            var unchanged = WeaponGeometry.ApplyKnockbackResistance(1f, targetHasResistance: false, resistanceFraction: 0.30f);
            Assert.AreEqual(1f, unchanged, 0.0001f);
        }

        // ---- Shadow Lunge: contact radius + arena boundary ----

        [Test]
        public void IsWithinContactRadius_AcceptsPositionsCloseEnoughTogether()
        {
            Assert.IsTrue(WeaponGeometry.IsWithinContactRadius(Vector3.zero, new Vector3(1f, 0, 0), contactRadius: 1.5f));
        }

        [Test]
        public void IsWithinContactRadius_RejectsPositionsTooFarApart()
        {
            Assert.IsFalse(WeaponGeometry.IsWithinContactRadius(Vector3.zero, new Vector3(5f, 0, 0), contactRadius: 1.5f));
        }

        [Test]
        public void ClampToArena_LeavesAPositionInsideTheArenaUnchanged()
        {
            var position = new Vector3(5f, 0, 0);
            var clamped = WeaponGeometry.ClampToArena(position, Vector3.zero, arenaRadius: 15f);

            Assert.AreEqual(position, clamped);
        }

        [Test]
        public void ClampToArena_PullsAnOutOfBoundsDashBackToTheArenaEdge()
        {
            var desired = new Vector3(100f, 0, 0); // way outside a 15m arena
            var clamped = WeaponGeometry.ClampToArena(desired, Vector3.zero, arenaRadius: 15f);

            Assert.AreEqual(15f, clamped.magnitude, 0.0001f, "A dash outside the arena must be clamped exactly to the arena radius.");
        }
    }
}
