using System;
using Nfouz.Networking;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Combat
{
    /// <summary>
    /// Per-player combat behavior: basic attack, special ability, energy
    /// cost/regen, cooldowns, dodge, class ability, target validation,
    /// damage application, and death detection. Sits alongside
    /// NetworkPlayerController (Sprint 5) on the same NetworkPlayerPrefab
    /// instance and reads/writes its public NetworkedHealth/NetworkedEnergy
    /// properties directly — NetworkPlayerController.cs itself is NOT
    /// modified (Sprint 5 architecture, movement-sync only, left as-is).
    ///
    /// Sprint 6 correction pass:
    ///   - Critical Hit is gone entirely — BasicAttack/TrySpecial no
    ///     longer roll for or apply one (see DamageCalculator.cs).
    ///   - Dodge is rebuilt around the GDD's own numbers: 3m distance,
    ///     0.3s duration, 0.2s of full invulnerability at the start (not
    ///     partial damage resistance — the old 70% resistance rule is
    ///     removed), 20 energy (18 for Scout), 4s cooldown. The 3m
    ///     "distance" is implemented as an instant position offset in the
    ///     player's forward direction at dodge start — there is no
    ///     dash/lerp animation or collision check here, since that is a
    ///     movement/animation concern that belongs with
    ///     NetworkPlayerController's movement sync (Sprint 5, not
    ///     modified) rather than PlayerCombat; flagged as a follow-up
    ///     integration point, not a silent gap.
    ///   - AttackCycleSeconds is wired in as the basic-attack cooldown,
    ///     replacing the old 1/AttackSpeed model. EquippedWeapon.WindUpSeconds
    ///     is carried as data but not gated by a timer — a wind-up-then-
    ///     resolve state machine is a distinct, larger piece of work than
    ///     this project's scope has asked for so far.
    ///
    /// Sprint 6 final security correction:
    ///   - TrySpecial's damage uses EquippedWeapon.SpecialDamage — a flat
    ///     value from the GDD — instead of the removed
    ///     SpecialDamageMultiplier.
    ///   - A recovery/action lock is added: EquippedWeapon.SpecialRecoverySeconds
    ///     (0.35s for all four approved weapons) blocks all other actions
    ///     after a special resolves.
    ///
    /// Sprint 6 final gameplay-completion pass:
    ///   - Every weapon special now has REAL gameplay geometry instead of
    ///     resolving as a single-target hit validated only by the
    ///     equipped weapon's basic-attack range: Pulse Arc validates a
    ///     3m/140-degree arc (WeaponGeometry.IsWithinArc); Shadow Lunge
    ///     actually dashes 3m (clamped to the arena — see
    ///     Constants.Battle.ArenaRadiusMeters) and only deals damage on
    ///     post-dash contact, granting no invulnerability; Ground Break
    ///     checks a real 3m AoE radius, applies 1m knockback reduced by
    ///     30% if the target is a Titan; Charged Pulse spawns a real,
    ///     moving ChargedPulseProjectile that can only ever hit once.
    ///   - Class abilities are implemented for real: Scout's Blink Step
    ///     is a second, longer, invulnerable dash (independent of the
    ///     universal Dodge); Ranger's Focus Shot is a self-buff consumed
    ///     by the next successful hit (basic OR special, including a
    ///     Charged Pulse projectile's hit) rather than a direct attack of
    ///     its own; Titan's Bulwark is a flat damage-ABSORPTION pool (not
    ///     a percentage reduction), distinct from Dodge/Blink Step's full
    ///     invulnerability. Focus Shot and Bulwark activation both lock
    ///     all other actions for Constants.ClassPassives.ActivationActionLockSeconds
    ///     (reusing the same _recoveryRemaining timer as a weapon
    ///     special's own recovery — only one lock is ever active at a
    ///     time). Every placeholder value from the previous pass is gone;
    ///     see ClassAbilityDatabase.cs.
    ///   - Passives: Scout's reduced Dodge energy cost (unchanged, already
    ///     approved); Ranger's +1m range on Influence Cannon's basic
    ///     attack AND Charged Pulse's special range only (GetEffectiveWeaponRange/
    ///     GetEffectiveSpecialRange); Titan's 30% knockback resistance
    ///     (applied to the RECEIVING combatant regardless of who attacks).
    /// </summary>
    [RequireComponent(typeof(NetworkPlayerController))]
    public class PlayerCombat : MonoBehaviour
    {
        public event Action OnDeath;
        public event Action<int> OnDamageTaken; // amount actually applied (0 while invulnerable; reduced while Bulwark absorbs)
        public event Action OnDodgeStarted;
        public event Action OnClassAbilityUsed;

        public bool IsDead { get; private set; }
        public int MaxHealth { get; private set; }
        public int MaxEnergy { get; private set; }
        public WeaponStats EquippedWeapon { get; private set; }
        public string ClassType { get; private set; }

        /// <summary>Sprint 6 correction pass: energy regeneration is
        /// disabled during Overtime (GDD) — BattleManager sets this false
        /// on both combatants when Overtime starts and leaves it false
        /// for the rest of the match (Overtime never returns to normal
        /// Battle state).</summary>
        public bool EnergyRegenEnabled { get; set; } = true;

        private NetworkPlayerController _networkController;

        private float _basicAttackCooldownRemaining;
        private float _specialCooldownRemaining;
        private float _dodgeCooldownRemaining;
        private float _classAbilityCooldownRemaining;

        private bool _isDodging;
        private float _dodgeElapsed;

        /// <summary>Blocks all actions for either a weapon special's own
        /// SpecialRecoverySeconds, or Focus Shot/Bulwark's shared 0.2s
        /// activation lock — only one of these is ever running at a time,
        /// so a single timer is enough.</summary>
        private float _recoveryRemaining;

        // Scout — Blink Step: a second, longer, invulnerable dash,
        // independent of the universal Dodge fields above.
        private bool _isBlinking;
        private float _blinkElapsed;
        private float _blinkDurationSeconds;
        private float _blinkInvulnerabilitySeconds;

        // Ranger — Focus Shot: a self-buff consumed by the next
        // successful hit, not a direct attack of its own.
        private float _focusShotBuffRemaining;
        private int _focusShotBonusDamage;

        // Titan — Bulwark: a flat damage-absorption pool, distinct from
        // Dodge/Blink Step's full invulnerability.
        private int _bulwarkAbsorbRemaining;
        private float _bulwarkDurationRemaining;

        public bool IsDodging => _isDodging;

        /// <summary>True for the first Constants.Combat.DodgeInvulnerabilitySeconds
        /// of a dodge — ApplyDamage is a full no-op while this is true.</summary>
        public bool IsInvulnerable => _isDodging && _dodgeElapsed < Constants.Combat.DodgeInvulnerabilitySeconds;

        /// <summary>True for the first _blinkInvulnerabilitySeconds of a
        /// Blink Step — same full-negation effect as IsInvulnerable, via a
        /// separate ability with its own duration/cooldown/cost.</summary>
        public bool IsBlinkInvulnerable => _isBlinking && _blinkElapsed < _blinkInvulnerabilitySeconds;

        /// <summary>True while EquippedWeapon.SpecialRecoverySeconds (or
        /// Focus Shot/Bulwark's 0.2s activation lock) hasn't yet elapsed —
        /// see _recoveryRemaining's doc comment.</summary>
        public bool IsInRecovery => _recoveryRemaining > 0f;

        /// <summary>True while Titan's Bulwark still has absorption left
        /// AND its 3-second window hasn't expired — incoming damage is
        /// reduced (not negated) while this is true.</summary>
        public bool IsBulwarkActive => _bulwarkAbsorbRemaining > 0 && _bulwarkDurationRemaining > 0f;

        /// <summary>True while Ranger's Focus Shot buff is armed — the
        /// next successful hit consumes it for +6 damage.</summary>
        public bool IsFocusShotArmed => _focusShotBuffRemaining > 0f;

        public bool IsBasicAttackReady => _basicAttackCooldownRemaining <= 0f && !IsInRecovery;
        public bool IsSpecialReady => _specialCooldownRemaining <= 0f && !IsInRecovery;
        public bool IsDodgeReady => _dodgeCooldownRemaining <= 0f && !IsInRecovery;
        public bool IsClassAbilityReady => _classAbilityCooldownRemaining <= 0f && !IsInRecovery;

        private void Awake()
        {
            _networkController = GetComponent<NetworkPlayerController>();
        }

        /// <summary>
        /// Seeds this combat component from server-authoritative data —
        /// never invented locally. `weapon` comes from WeaponDatabase
        /// (asset lookup or the approved default table), `classType` and
        /// max health/energy come from PlayerSession/NetworkPlayerController
        /// initialization for this same player.
        /// </summary>
        public void Initialize(string classType, WeaponStats weapon, int maxHealth, int maxEnergy)
        {
            ClassType = classType;
            EquippedWeapon = weapon;
            MaxHealth = maxHealth;
            MaxEnergy = maxEnergy;
            IsDead = false;
            EnergyRegenEnabled = true;
            _basicAttackCooldownRemaining = 0f;
            _specialCooldownRemaining = 0f;
            _dodgeCooldownRemaining = 0f;
            _classAbilityCooldownRemaining = 0f;
            _isDodging = false;
            _dodgeElapsed = 0f;
            _recoveryRemaining = 0f;
            _isBlinking = false;
            _blinkElapsed = 0f;
            _blinkDurationSeconds = 0f;
            _blinkInvulnerabilitySeconds = 0f;
            _focusShotBuffRemaining = 0f;
            _focusShotBonusDamage = 0;
            _bulwarkAbsorbRemaining = 0;
            _bulwarkDurationRemaining = 0f;
        }

        private void Update()
        {
            if (IsDead)
            {
                return;
            }

            if (_basicAttackCooldownRemaining > 0f)
            {
                _basicAttackCooldownRemaining -= Time.deltaTime;
            }

            if (_specialCooldownRemaining > 0f)
            {
                _specialCooldownRemaining -= Time.deltaTime;
            }

            if (_dodgeCooldownRemaining > 0f)
            {
                _dodgeCooldownRemaining -= Time.deltaTime;
            }

            if (_classAbilityCooldownRemaining > 0f)
            {
                _classAbilityCooldownRemaining -= Time.deltaTime;
            }

            if (_recoveryRemaining > 0f)
            {
                _recoveryRemaining -= Time.deltaTime;
            }

            if (_focusShotBuffRemaining > 0f)
            {
                _focusShotBuffRemaining -= Time.deltaTime;
            }

            if (_bulwarkDurationRemaining > 0f)
            {
                _bulwarkDurationRemaining -= Time.deltaTime;
                if (_bulwarkDurationRemaining <= 0f)
                {
                    _bulwarkDurationRemaining = 0f;
                    _bulwarkAbsorbRemaining = 0; // whatever's left is lost, not banked
                }
            }

            if (_isDodging)
            {
                _dodgeElapsed += Time.deltaTime;
                if (_dodgeElapsed >= Constants.Combat.DodgeDurationSeconds)
                {
                    _isDodging = false;
                }
            }

            if (_isBlinking)
            {
                _blinkElapsed += Time.deltaTime;
                if (_blinkElapsed >= _blinkDurationSeconds)
                {
                    _isBlinking = false;
                }
            }

            if (EnergyRegenEnabled)
            {
                RegenerateEnergy();
            }
        }

        /// <summary>Energy Regeneration: +5 energy/second, capped at
        /// MaxEnergy. Disabled entirely during Overtime — see
        /// EnergyRegenEnabled's doc comment.</summary>
        private void RegenerateEnergy()
        {
            if (_networkController.NetworkedEnergy >= MaxEnergy)
            {
                return;
            }

            var regenThisFrame = Constants.Combat.EnergyRegenPerSecond * Time.deltaTime;
            var newEnergy = Mathf.Min(MaxEnergy, _networkController.NetworkedEnergy + Mathf.RoundToInt(regenThisFrame));
            _networkController.NetworkedEnergy = newEnergy;
        }

        /// <summary>Ranger's passive: +1m range on Influence Cannon's
        /// basic attack range only — no other weapon is affected.</summary>
        private float GetEffectiveWeaponRange()
        {
            return EquippedWeapon.Range + RangerInfluenceCannonBonus();
        }

        /// <summary>Ranger's passive: +1m range on Charged Pulse's special
        /// (projectile) range only — no other weapon's special is affected.</summary>
        private float GetEffectiveSpecialRange()
        {
            return EquippedWeapon.SpecialRange + RangerInfluenceCannonBonus();
        }

        private float RangerInfluenceCannonBonus()
        {
            return ClassType == Constants.PlayerClass.Ranger && EquippedWeapon.WeaponName == WeaponDatabase.InfluenceCannon
                ? Constants.ClassPassives.RangerInfluenceCannonRangeBonusMeters
                : 0f;
        }

        /// <summary>
        /// Target Validation — a target is attackable when it exists, is
        /// not this player, is not already dead, and is within the
        /// equipped weapon's (effective, passive-adjusted) Range. Distance
        /// is measured against the NetworkPlayerController transforms so
        /// it agrees with whatever position movement-sync (Sprint 5) has
        /// actually converged on.
        /// </summary>
        public bool CanAttack(PlayerCombat target, out string reasonIfNot)
        {
            if (target == null)
            {
                reasonIfNot = "No target.";
                return false;
            }

            if (target == this)
            {
                reasonIfNot = "Cannot target self.";
                return false;
            }

            if (IsDead)
            {
                reasonIfNot = "Attacker is dead.";
                return false;
            }

            if (target.IsDead)
            {
                reasonIfNot = "Target is already dead.";
                return false;
            }

            var effectiveRange = GetEffectiveWeaponRange();
            var distance = Vector3.Distance(transform.position, target.transform.position);
            if (distance > effectiveRange)
            {
                reasonIfNot = $"Target out of weapon range ({distance:F2}m > {effectiveRange}m).";
                return false;
            }

            reasonIfNot = null;
            return true;
        }

        /// <summary>
        /// Basic Attack. Validates target, cooldown (AttackCycleSeconds —
        /// GDD's replacement for the old AttackSpeed-derived cooldown),
        /// and energy cost before applying damage. No Critical Hit roll —
        /// removed entirely per the Sprint 6 correction pass. A successful
        /// hit can consume an armed Focus Shot buff (see
        /// ApplyDamageWithFocusShotBonus). Returns true if the attack was
        /// actually executed.
        /// </summary>
        public bool BasicAttack(PlayerCombat target)
        {
            if (!CanAttack(target, out var reason))
            {
                Debug.LogWarning($"[PlayerCombat] Basic attack rejected: {reason}");
                return false;
            }

            if (!IsBasicAttackReady)
            {
                Debug.LogWarning("[PlayerCombat] Basic attack rejected: still on cooldown or locked.");
                return false;
            }

            if (_networkController.NetworkedEnergy < EquippedWeapon.BasicAttackEnergyCost)
            {
                Debug.LogWarning("[PlayerCombat] Basic attack rejected: insufficient energy.");
                return false;
            }

            var damage = DamageCalculator.CalculateDamage(
                EquippedWeapon.BaseDamage,
                DamageCalculator.GetClassAttackMultiplier(ClassType),
                1f,
                DamageCalculator.GetClassDefense(target.ClassType));

            ApplyDamageWithFocusShotBonus(target, damage);

            _networkController.NetworkedEnergy -= EquippedWeapon.BasicAttackEnergyCost;
            _basicAttackCooldownRemaining = EquippedWeapon.AttackCycleSeconds;

            return true;
        }

        /// <summary>
        /// Special Ability. Dispatches to each weapon's own real gameplay
        /// geometry — see this class's header doc comment and each
        /// Try*(...) method below. Shared validation (cooldown/recovery,
        /// energy) happens here; per-weapon target/geometry validation and
        /// resource consumption happen in each branch, since a rejected
        /// geometry check (e.g. Pulse Arc's target outside the arc) must
        /// NOT consume energy or start the cooldown, exactly like a
        /// rejected CanAttack check for a basic attack.
        /// </summary>
        public bool TrySpecial(PlayerCombat target)
        {
            if (IsDead)
            {
                return false;
            }

            if (!IsSpecialReady)
            {
                Debug.LogWarning("[PlayerCombat] Special ability rejected: still on cooldown or locked.");
                return false;
            }

            if (_networkController.NetworkedEnergy < EquippedWeapon.SpecialEnergyCost)
            {
                Debug.LogWarning("[PlayerCombat] Special ability rejected: insufficient energy.");
                return false;
            }

            switch (EquippedWeapon.WeaponName)
            {
                case WeaponDatabase.PulseBlade:
                    return TryPulseArc(target);
                case WeaponDatabase.ShadowDagger:
                    return TryShadowLunge(target);
                case WeaponDatabase.TitanHammer:
                    return TryGroundBreak(target);
                case WeaponDatabase.InfluenceCannon:
                    return TryChargedPulse(target);
                default:
                    Debug.LogWarning($"[PlayerCombat] Special ability rejected: unknown weapon '{EquippedWeapon.WeaponName}'.");
                    return false;
            }
        }

        /// <summary>Consumes this special's energy/cooldown/recovery — call
        /// exactly once, only after a weapon special's own geometry check
        /// has already succeeded (a rejected geometry check must cost
        /// nothing, same as a rejected CanAttack).</summary>
        private void ConsumeSpecialCost()
        {
            _networkController.NetworkedEnergy -= EquippedWeapon.SpecialEnergyCost;
            _specialCooldownRemaining = EquippedWeapon.SpecialCooldown;
            _recoveryRemaining = EquippedWeapon.SpecialRecoverySeconds;
        }

        /// <summary>Pulse Blade's special — Pulse Arc. Validates a real
        /// 3m/140-degree arc (WeaponGeometry.IsWithinArc) instead of the
        /// weapon's ordinary Range, then applies 26 flat damage once.</summary>
        private bool TryPulseArc(PlayerCombat target)
        {
            if (target == null || target == this || target.IsDead)
            {
                Debug.LogWarning("[PlayerCombat] Pulse Arc rejected: no valid target.");
                return false;
            }

            if (!WeaponGeometry.IsWithinArc(transform.position, transform.forward, target.transform.position, EquippedWeapon.SpecialRange, EquippedWeapon.SpecialArcDegrees))
            {
                Debug.LogWarning($"[PlayerCombat] Pulse Arc rejected: target outside the {EquippedWeapon.SpecialRange}m/{EquippedWeapon.SpecialArcDegrees}-degree arc.");
                return false;
            }

            ConsumeSpecialCost();

            var damage = DamageCalculator.CalculateDamage(
                EquippedWeapon.SpecialDamage,
                DamageCalculator.GetClassAttackMultiplier(ClassType),
                1f,
                DamageCalculator.GetClassDefense(target.ClassType));
            ApplyDamageWithFocusShotBonus(target, damage);

            return true;
        }

        /// <summary>Shadow Dagger's special — Shadow Lunge. Always
        /// executes a real 3m dash (clamped to the arena), but only deals
        /// its 20 flat damage if the dash actually lands within contact
        /// range of the target — grants NO invulnerability, explicitly
        /// per the GDD (unlike Blink Step/Dodge).</summary>
        private bool TryShadowLunge(PlayerCombat target)
        {
            if (target == null || target == this || target.IsDead)
            {
                Debug.LogWarning("[PlayerCombat] Shadow Lunge rejected: no valid target.");
                return false;
            }

            ConsumeSpecialCost();

            var desiredDestination = transform.position + transform.forward * EquippedWeapon.SpecialDashDistanceMeters;
            transform.position = WeaponGeometry.ClampToArena(desiredDestination, Vector3.zero, Constants.Battle.ArenaRadiusMeters);

            if (WeaponGeometry.IsWithinContactRadius(transform.position, target.transform.position, Constants.Combat.ShadowLungeContactRadiusMeters))
            {
                var damage = DamageCalculator.CalculateDamage(
                    EquippedWeapon.SpecialDamage,
                    DamageCalculator.GetClassAttackMultiplier(ClassType),
                    1f,
                    DamageCalculator.GetClassDefense(target.ClassType));
                ApplyDamageWithFocusShotBonus(target, damage);
            }

            return true; // the dash itself always executes; damage is conditional on contact
        }

        /// <summary>Titan Hammer's special — Ground Break. Checks a real
        /// 3m AoE radius, applies 36 flat damage once, then 1m knockback
        /// away from this attacker — reduced 30% if the target is a Titan
        /// (Constants.ClassPassives.TitanKnockbackResistance).</summary>
        private bool TryGroundBreak(PlayerCombat target)
        {
            if (target == null || target == this || target.IsDead)
            {
                Debug.LogWarning("[PlayerCombat] Ground Break rejected: no valid target.");
                return false;
            }

            if (!WeaponGeometry.IsWithinRadius(transform.position, target.transform.position, EquippedWeapon.SpecialRadiusMeters))
            {
                Debug.LogWarning($"[PlayerCombat] Ground Break rejected: target outside the {EquippedWeapon.SpecialRadiusMeters}m radius.");
                return false;
            }

            ConsumeSpecialCost();

            var damage = DamageCalculator.CalculateDamage(
                EquippedWeapon.SpecialDamage,
                DamageCalculator.GetClassAttackMultiplier(ClassType),
                1f,
                DamageCalculator.GetClassDefense(target.ClassType));
            ApplyDamageWithFocusShotBonus(target, damage);

            var targetIsTitan = target.ClassType == Constants.PlayerClass.Titan;
            var knockbackMeters = WeaponGeometry.ApplyKnockbackResistance(
                EquippedWeapon.SpecialKnockbackMeters, targetIsTitan, Constants.ClassPassives.TitanKnockbackResistance);

            var knockbackDirection = target.transform.position - transform.position;
            if (knockbackDirection.sqrMagnitude > 0.0001f)
            {
                target.transform.position += knockbackDirection.normalized * knockbackMeters;
            }

            return true;
        }

        /// <summary>Influence Cannon's special — Charged Pulse. Spawns a
        /// real, moving ChargedPulseProjectile rather than resolving as an
        /// instant hit — the projectile itself applies damage exactly
        /// once on contact (or none at all if it expires first). Range
        /// includes Ranger's +1m passive bonus (GetEffectiveSpecialRange).</summary>
        private bool TryChargedPulse(PlayerCombat target)
        {
            if (target == null || target == this || target.IsDead)
            {
                Debug.LogWarning("[PlayerCombat] Charged Pulse rejected: no valid target.");
                return false;
            }

            ConsumeSpecialCost();

            ChargedPulseProjectile.Spawn(
                this,
                target,
                EquippedWeapon.SpecialDamage,
                EquippedWeapon.SpecialProjectileSpeed,
                EquippedWeapon.SpecialProjectileRadius,
                GetEffectiveSpecialRange());

            return true;
        }

        /// <summary>
        /// Class Ability — Scout Blink Step, Ranger Focus Shot, Titan
        /// Bulwark. None of the three require a target: Blink Step is a
        /// directional dash, Focus Shot is a self-buff, Bulwark is a
        /// self-buff. See ClassAbilityDatabase.cs for the approved GDD
        /// values and this class's header doc comment for how each one
        /// actually behaves.
        /// </summary>
        public bool TryClassAbility()
        {
            if (IsDead)
            {
                return false;
            }

            var stats = ClassAbilityDatabase.GetDefaultStats(ClassType);
            if (string.IsNullOrEmpty(stats.AbilityName))
            {
                Debug.LogWarning($"[PlayerCombat] Class ability rejected: no ability defined for class '{ClassType}'.");
                return false;
            }

            if (!IsClassAbilityReady)
            {
                Debug.LogWarning("[PlayerCombat] Class ability rejected: still on cooldown or locked.");
                return false;
            }

            if (_networkController.NetworkedEnergy < stats.EnergyCost)
            {
                Debug.LogWarning("[PlayerCombat] Class ability rejected: insufficient energy.");
                return false;
            }

            switch (ClassType)
            {
                case Constants.PlayerClass.Scout:
                    // Blink Step: a second, longer, invulnerable dash,
                    // independent of the universal Dodge — no action lock
                    // per the GDD (only Focus Shot/Bulwark get one).
                    var desiredDestination = transform.position + transform.forward * stats.DashDistanceMeters;
                    transform.position = WeaponGeometry.ClampToArena(desiredDestination, Vector3.zero, Constants.Battle.ArenaRadiusMeters);
                    _isBlinking = true;
                    _blinkElapsed = 0f;
                    _blinkDurationSeconds = stats.DurationSeconds;
                    _blinkInvulnerabilitySeconds = stats.InvulnerabilitySeconds;
                    break;

                case Constants.PlayerClass.Ranger:
                    // Focus Shot: arms a self-buff; does not attack by
                    // itself. Does not stack — re-activating simply resets
                    // the same single pending bonus rather than adding a
                    // second one.
                    _focusShotBuffRemaining = stats.BuffDurationSeconds;
                    _focusShotBonusDamage = stats.BonusDamage;
                    _recoveryRemaining = Constants.ClassPassives.ActivationActionLockSeconds;
                    break;

                case Constants.PlayerClass.Titan:
                    // Bulwark: arms a flat damage-absorption pool for the
                    // next 3 seconds — see ApplyDamage's Bulwark branch.
                    _bulwarkAbsorbRemaining = stats.AbsorbAmount;
                    _bulwarkDurationRemaining = stats.DurationSeconds;
                    _recoveryRemaining = Constants.ClassPassives.ActivationActionLockSeconds;
                    break;

                default:
                    Debug.LogWarning($"[PlayerCombat] Class ability rejected: unhandled class '{ClassType}'.");
                    return false;
            }

            _networkController.NetworkedEnergy -= stats.EnergyCost;
            _classAbilityCooldownRemaining = stats.Cooldown;

            OnClassAbilityUsed?.Invoke();
            return true;
        }

        /// <summary>Per-class Dodge energy cost — GDD: 20, except Scout at 18.</summary>
        private int GetDodgeEnergyCost()
        {
            return ClassType == Constants.PlayerClass.Scout
                ? Constants.Combat.ScoutDodgeEnergyCost
                : Constants.Combat.DodgeEnergyCost;
        }

        /// <summary>
        /// Dodge — GDD: moves 3m, lasts 0.3s total with the first 0.2s
        /// fully invulnerable (see IsInvulnerable/ApplyDamage), costs 20
        /// energy (18 for Scout), 4s cooldown. See this class's header
        /// note on the 3m move being an instant position offset, not an
        /// animated dash. Distinct from Scout's own Blink Step class
        /// ability, which every Scout also has on top of this.
        /// </summary>
        public bool TryDodge()
        {
            if (IsDead)
            {
                return false;
            }

            if (!IsDodgeReady)
            {
                Debug.LogWarning("[PlayerCombat] Dodge rejected: still on cooldown or locked.");
                return false;
            }

            var cost = GetDodgeEnergyCost();
            if (_networkController.NetworkedEnergy < cost)
            {
                Debug.LogWarning("[PlayerCombat] Dodge rejected: insufficient energy.");
                return false;
            }

            _networkController.NetworkedEnergy -= cost;
            _isDodging = true;
            _dodgeElapsed = 0f;
            _dodgeCooldownRemaining = Constants.Combat.DodgeCooldownSeconds;

            transform.position += transform.forward * Constants.Combat.DodgeDistanceMeters;

            OnDodgeStarted?.Invoke();
            return true;
        }

        /// <summary>
        /// Applies `baseDamage` to `target`, adding Ranger's Focus Shot
        /// bonus (+6, flat, applied after the normal damage formula) and
        /// consuming the buff if THIS attacker currently has one armed.
        /// Used by every source of outgoing damage (basic attack, every
        /// weapon special that connects, and ChargedPulseProjectile's
        /// delayed hit) so Focus Shot behaves identically regardless of
        /// how the hit was delivered.
        /// </summary>
        public void ApplyDamageWithFocusShotBonus(PlayerCombat target, int baseDamage)
        {
            var finalDamage = baseDamage;
            if (_focusShotBuffRemaining > 0f)
            {
                finalDamage += _focusShotBonusDamage;
                _focusShotBuffRemaining = 0f; // consumed on the first successful hit
            }

            target.ApplyDamage(finalDamage);
        }

        /// <summary>
        /// Damage Application + Death Detection.
        ///
        /// Mitigation is checked in this order:
        ///   1. IsInvulnerable (Dodge) or IsBlinkInvulnerable (Blink Step)
        ///      — full negation, zero damage applied at all.
        ///   2. IsBulwarkActive (Titan) — damage is absorbed from a flat
        ///      25-point pool (not a percentage), reducing but not
        ///      necessarily zeroing the applied amount; whatever the pool
        ///      can't cover still goes through in full.
        /// Neither Bulwark's absorption nor being outside any
        /// invulnerability window reinstates the removed 70%-resistance
        /// Dodge rule — these are two distinct, newer abilities.
        /// </summary>
        public void ApplyDamage(int amount)
        {
            if (IsDead)
            {
                return;
            }

            if (IsInvulnerable || IsBlinkInvulnerable)
            {
                OnDamageTaken?.Invoke(0);
                return;
            }

            var appliedAmount = amount;
            if (IsBulwarkActive)
            {
                var absorbed = Mathf.Min(appliedAmount, _bulwarkAbsorbRemaining);
                appliedAmount -= absorbed;
                _bulwarkAbsorbRemaining -= absorbed;
            }

            _networkController.NetworkedHealth = Mathf.Max(0, _networkController.NetworkedHealth - appliedAmount);
            OnDamageTaken?.Invoke(appliedAmount);

            if (_networkController.NetworkedHealth <= 0)
            {
                Die();
            }
        }

        private void Die()
        {
            if (IsDead)
            {
                return;
            }

            IsDead = true;
            Debug.Log($"[PlayerCombat] {ClassType} player died.");
            OnDeath?.Invoke();
        }
    }
}
