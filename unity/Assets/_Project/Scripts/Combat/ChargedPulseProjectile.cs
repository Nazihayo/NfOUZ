using UnityEngine;

namespace Nfouz.Combat
{
    /// <summary>
    /// Sprint 6 final gameplay-completion pass — Charged Pulse's real
    /// "authoritative projectile" gameplay. Split into a pure, stateless
    /// simulator (unit-testable without any GameObject) and a thin
    /// MonoBehaviour wrapper that actually spawns and moves it in-scene —
    /// the same pure-logic/thin-wrapper split already used by
    /// DamageCalculator.cs and PlayerCombat.cs's dodge/class-ability code.
    /// </summary>
    public static class ChargedPulseSimulator
    {
        public struct State
        {
            public Vector3 Position;
            public float DistanceTraveled;
            public bool HasHit;
            public bool Expired;
        }

        public static State CreateInitial(Vector3 startPosition)
        {
            return new State
            {
                Position = startPosition,
                DistanceTraveled = 0f,
                HasHit = false,
                Expired = false,
            };
        }

        /// <summary>
        /// Advances the projectile by `deltaTime` seconds along
        /// `direction` (normalized internally) at `speed` m/s, then checks
        /// for a hit against `targetPosition` within `collisionRadius`.
        /// Once HasHit or Expired is true, the state is returned unchanged
        /// on every subsequent call — this is what guarantees a single
        /// target can only ever be hit once by a given projectile
        /// (duplicate-hit prevention), independent of the caller.
        /// </summary>
        public static State Advance(State state, Vector3 direction, float speed, float collisionRadius, float maxRange, Vector3 targetPosition, float deltaTime)
        {
            if (state.HasHit || state.Expired)
            {
                return state;
            }

            var normalizedDirection = direction.sqrMagnitude > 0.0001f ? direction.normalized : Vector3.forward;
            var step = normalizedDirection * speed * deltaTime;
            var newPosition = state.Position + step;
            var newDistance = state.DistanceTraveled + step.magnitude;

            var hit = Vector3.Distance(newPosition, targetPosition) <= collisionRadius;
            var expired = !hit && newDistance >= maxRange;

            return new State
            {
                Position = newPosition,
                DistanceTraveled = newDistance,
                HasHit = hit,
                Expired = expired,
            };
        }
    }

    /// <summary>
    /// Thin MonoBehaviour wrapper: owns a ChargedPulseSimulator.State,
    /// advances it every frame, moves this transform to match, and
    /// applies damage exactly once on the frame it registers a hit (via
    /// the attacker's own ApplyDamageWithFocusShotBonus, so Ranger's
    /// Focus Shot buff is honored for a projectile hit exactly as it is
    /// for a melee hit) before destroying itself. Also self-destructs,
    /// dealing no damage, once it exceeds Charged Pulse's Range without
    /// hitting.
    /// </summary>
    public class ChargedPulseProjectile : MonoBehaviour
    {
        private PlayerCombat _attacker;
        private PlayerCombat _target;
        private int _damage;
        private float _speed;
        private float _collisionRadius;
        private float _maxRange;
        private Vector3 _direction;
        private ChargedPulseSimulator.State _state;

        /// <summary>
        /// Spawns and configures a Charged Pulse projectile at
        /// `attacker`'s current position, aimed at `target`'s current
        /// position. `damage`, `speed`, `collisionRadius` and `maxRange`
        /// come from WeaponStats (Charged Pulse's approved GDD values;
        /// `maxRange` should already include Ranger's +1m bonus if
        /// applicable — see PlayerCombat.GetEffectiveSpecialRange).
        /// </summary>
        public static ChargedPulseProjectile Spawn(PlayerCombat attacker, PlayerCombat target, int damage, float speed, float collisionRadius, float maxRange)
        {
            var go = new GameObject("ChargedPulseProjectile");
            go.transform.position = attacker.transform.position;

            var projectile = go.AddComponent<ChargedPulseProjectile>();
            projectile._attacker = attacker;
            projectile._target = target;
            projectile._damage = damage;
            projectile._speed = speed;
            projectile._collisionRadius = collisionRadius;
            projectile._maxRange = maxRange;
            projectile._direction = (target.transform.position - attacker.transform.position);
            projectile._state = ChargedPulseSimulator.CreateInitial(attacker.transform.position);

            return projectile;
        }

        private void Update()
        {
            if (_target == null || _attacker == null)
            {
                Destroy(gameObject);
                return;
            }

            var wasHit = _state.HasHit;
            _state = ChargedPulseSimulator.Advance(
                _state, _direction, _speed, _collisionRadius, _maxRange, _target.transform.position, Time.deltaTime);

            transform.position = _state.Position;

            if (_state.HasHit && !wasHit)
            {
                _attacker.ApplyDamageWithFocusShotBonus(_target, _damage);
                Destroy(gameObject);
                return;
            }

            if (_state.Expired)
            {
                Destroy(gameObject);
            }
        }
    }
}
