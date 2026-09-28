using UnityEngine;

namespace Nfouz.Combat
{
    /// <summary>
    /// Sprint 6 final gameplay-completion pass — pure, stateless geometry
    /// helpers for the four weapon specials' real hit-detection, extracted
    /// as plain static functions (Vector3s in, bool/float out) so they can
    /// be unit-tested without any GameObject/MonoBehaviour, the same
    /// pattern already used by DamageCalculator.cs and
    /// BattleManager.CompareHealthPercentages.
    /// </summary>
    public static class WeaponGeometry
    {
        /// <summary>
        /// Pulse Arc: true when `targetPosition` is within `range` of
        /// `originPosition` AND within `arcDegrees` total width centered
        /// on `originForward` (i.e. within arcDegrees/2 either side).
        /// </summary>
        public static bool IsWithinArc(Vector3 originPosition, Vector3 originForward, Vector3 targetPosition, float range, float arcDegrees)
        {
            var offset = targetPosition - originPosition;
            var distance = offset.magnitude;
            if (distance > range)
            {
                return false;
            }

            if (distance <= 0.0001f)
            {
                // Target is effectively on top of the origin — no
                // meaningful direction to measure an angle against.
                return true;
            }

            var angle = Vector3.Angle(originForward, offset);
            return angle <= arcDegrees / 2f;
        }

        /// <summary>Ground Break: true when `targetPosition` is within
        /// `radius` of `originPosition` (a simple AoE radius check).</summary>
        public static bool IsWithinRadius(Vector3 originPosition, Vector3 targetPosition, float radius)
        {
            return Vector3.Distance(originPosition, targetPosition) <= radius;
        }

        /// <summary>Shadow Lunge: true when `positionA` ends up within
        /// `contactRadius` of `positionB` — used to decide whether the
        /// dash actually made contact with its target.</summary>
        public static bool IsWithinContactRadius(Vector3 positionA, Vector3 positionB, float contactRadius)
        {
            return Vector3.Distance(positionA, positionB) <= contactRadius;
        }

        /// <summary>Ground Break: applies Titan's passive knockback
        /// resistance to a raw knockback distance. `targetHasResistance`
        /// should be true only when the RECEIVING combatant is a Titan —
        /// the attacker's class never matters here.</summary>
        public static float ApplyKnockbackResistance(float rawKnockbackMeters, bool targetHasResistance, float resistanceFraction)
        {
            return targetHasResistance ? rawKnockbackMeters * (1f - resistanceFraction) : rawKnockbackMeters;
        }

        /// <summary>Shadow Lunge: clamps a desired destination to within
        /// `arenaRadius` of `arenaCenter` — "respect arena boundaries" for
        /// a dash that would otherwise be an unconditional position
        /// offset (see PlayerCombat.cs's TryDodge/TryClassAbility, which
        /// use unclamped offsets for other, shorter movement abilities).</summary>
        public static Vector3 ClampToArena(Vector3 desiredPosition, Vector3 arenaCenter, float arenaRadius)
        {
            var offset = desiredPosition - arenaCenter;
            if (offset.magnitude <= arenaRadius)
            {
                return desiredPosition;
            }

            return arenaCenter + offset.normalized * arenaRadius;
        }
    }
}
