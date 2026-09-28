namespace Nfouz.Utils
{
    /// <summary>
    /// Central, immutable constants used across the client.
    /// Mirrors values defined server-side in the REST API Specification v1.0
    /// and Backend Implementation Guide v1.0 — keep these in sync manually
    /// until a shared config endpoint is introduced.
    /// </summary>
    public static class Constants
    {
        public static class Api
        {
            // Overridden per-environment via ApiClient.Configure(); this is the Alpha default.
            public const string BaseUrl = "https://api.nfouz-game.com/v1";
            public const int RequestTimeoutSeconds = 15;
        }

        public static class Scenes
        {
            public const string Boot = "Boot";
            public const string Login = "Login";
            public const string Onboarding = "Onboarding";
            public const string MainMap = "MainMap";
            public const string Battle = "Battle";
            public const string Result = "Result";
        }

        public static class PlayerClass
        {
            public const string Scout = "Scout";
            public const string Ranger = "Ranger";
            public const string Titan = "Titan";
        }

        public static class Influence
        {
            public const int StartingInfluence = 100;
            public const int WinDelta = 15;
            public const int LossDelta = -10;
        }

        public static class Control
        {
            public const float ControlDurationMinutes = 120f;
        }

        /// <summary>
        /// Sprint 5 — Photon Multiplayer Foundation. Mirrors
        /// env.BATTLE_* on the backend (backend/src/config/env.js).
        /// Movement synchronization only — no combat values here
        /// (combat belongs to Sprint 6).
        /// </summary>
        public static class Battle
        {
            public const float MaxChallengeDistanceMeters = 20f;
            public const float DisconnectGraceSeconds = 15f;
            public const float ReadyTimeoutSeconds = 30f;
            public const float SessionMaxDurationSeconds = 90f;
            public const int CountdownSeconds = 3;

            /// <summary>Sprint 6 final gameplay-completion pass: Shadow
            /// Lunge must "respect arena boundaries" — no arena dimension
            /// has ever been specified in any GDD excerpt given to this
            /// project, so this is an explicitly flagged ASSUMED
            /// environment bound (not an approved design value, unlike
            /// every weapon/ability number in Constants.Combat below),
            /// generous enough to contain both spawn points. Should be
            /// replaced with the real arena/level dimensions once a level
            /// designer specifies them.</summary>
            public const float ArenaRadiusMeters = 15f;
        }

        /// <summary>
        /// Sprint 6 correction pass. The latest detailed NFOUZ GDD is now
        /// the authoritative source for these values and overrides the
        /// older Battle System, Weapons Data & Combat Math v1.0 document
        /// where the two conflict (per the correction instruction this
        /// pass implements). Two changes from the original Sprint 6 values:
        ///   - Critical Hit is removed entirely for Alpha (no random
        ///     chance, no multiplier, no randomized damage at all) — see
        ///     DamageCalculator.cs, now fully deterministic.
        ///   - Dodge's numbers are now the GDD's own explicit values,
        ///     replacing the earlier placeholder (which was flagged at the
        ///     time as not an approved value and is superseded here).
        /// </summary>
        public static class Combat
        {
            public const int MinimumDamage = 1;
            public const int EnergyRegenPerSecond = 5;

            // Dodge — GDD (latest detailed version): distance 3m, duration
            // 0.3s, energy cost 20 (18 for Scout), cooldown 4s, invulnerable
            // for the first 0.2s of the dodge. The earlier 70%
            // damage-resistance rule was an invented placeholder and is
            // removed: outside the 0.2s invulnerability window a dodging
            // player takes full damage, same as not dodging at all.
            public const float DodgeDistanceMeters = 3f;
            public const float DodgeDurationSeconds = 0.3f;
            public const float DodgeInvulnerabilitySeconds = 0.2f;
            public const int DodgeEnergyCost = 20;
            public const int ScoutDodgeEnergyCost = 18;
            public const float DodgeCooldownSeconds = 4f;

            // Timeout / Overtime — GDD (latest detailed version): 90s
            // battle duration, compare remaining Health percentage; a
            // difference greater than 1 percentage point decides the
            // winner outright, otherwise a 30s Overtime is played (with
            // energy regeneration disabled) and the same comparison is
            // applied again; if still within 1 percentage point after
            // Overtime, the match is a Draw. This replaces the earlier
            // "attacker wins all ties" placeholder rule entirely.
            public const float OvertimeSeconds = 30f;
            public const float DrawThresholdPercent = 1f;

            /// <summary>Sprint 6 final gameplay-completion pass: Shadow
            /// Lunge "applies damage only on valid contact" — contact is
            /// checked against the dash's landing position using the same
            /// 1.5m Range already approved for Shadow Dagger's own basic
            /// attack (Shadow Lunge's damage/dash numbers are approved by
            /// the GDD; this contact radius reuses an already-approved
            /// number rather than inventing a new one).</summary>
            public const float ShadowLungeContactRadiusMeters = 1.5f;
        }

        /// <summary>
        /// Sprint 6 final gameplay-completion pass — class PASSIVE
        /// abilities (always-on, not activated like Blink Step/Focus
        /// Shot/Bulwark). GDD (latest detailed version): Scout's reduced
        /// Dodge energy cost already lives in Constants.Combat.ScoutDodgeEnergyCost;
        /// the two below are new.
        /// </summary>
        public static class ClassPassives
        {
            /// <summary>Ranger: +1m range on Influence Cannon's basic
            /// attack range AND Charged Pulse's special range — no other
            /// weapon is affected, per the GDD.</summary>
            public const float RangerInfluenceCannonRangeBonusMeters = 1f;

            /// <summary>Titan: incoming knockback (e.g. Ground Break's 1m)
            /// is reduced by this fraction when a Titan is on the
            /// receiving end.</summary>
            public const float TitanKnockbackResistance = 0.30f;

            /// <summary>Focus Shot and Bulwark activation both lock all
            /// other actions for this long — a short, shared action lock,
            /// separate from a weapon special's own SpecialRecoverySeconds.
            /// Blink Step is not included — the GDD lists this lock only
            /// for Focus Shot and Bulwark.</summary>
            public const float ActivationActionLockSeconds = 0.2f;
        }

        /// <summary>
        /// Sprint 8 — Friends + SOS + Rescue. Mirrors env.RESCUE_GUARD_* on
        /// the backend (backend/src/config/env.js) exactly — these are the
        /// approved GDD combat values for the (non-player-controlled)
        /// Rescue Guard NPC, not a design choice made here.
        /// </summary>
        public static class RescueGuard
        {
            public const int Health = 160;
            public const float MoveSpeedMetersPerSecond = 4.6f;

            public const int BasicAttackDamage = 15;
            public const float BasicAttackRangeMeters = 2f;
            public const float BasicAttackWindupSeconds = 0.35f;
            public const float BasicAttackCycleSeconds = 1.2f;

            public const float SpecialAttackIntervalSeconds = 8f;
            public const int SpecialAttackDamage = 24;
            public const float SpecialAttackRangeMeters = 3f;
            public const float SpecialAttackWindupSeconds = 0.9f;
        }

        /// <summary>
        /// Sprint 8 — Rescue mission timing. Mirrors env.RESCUE_* on the
        /// backend; the client uses these only to drive local UI countdowns
        /// (reservation/guard-battle timers) — the server's own deadlines
        /// (reservation_expires_at / guard_battle_ends_at) are always
        /// authoritative, same convention as ServerTime/ControlStateManager.
        /// </summary>
        public static class Rescue
        {
            public const int ReservationTimeoutSeconds = 30;
            public const int GuardBattleDurationSeconds = 60;

            /// <summary>Mirrors env.RESCUE_REWARD_CREDITS / env.RESCUE_REWARD_XP —
            /// used by RescueResultController's reward label so the displayed
            /// numbers cannot drift from the approved GDD values in one place.</summary>
            public const int RewardCredits = 50;
            public const int RewardXp = 80;
        }

        /// <summary>
        /// Sprint 8 correction (final pass) — the `platform` values the
        /// backend's CHECK constraint / Zod-equivalent validator accept
        /// (deviceValidation.js). Any other string is rejected with 400.
        /// </summary>
        public static class Devices
        {
            public const string PlatformAndroid = "android";
            public const string PlatformIos = "ios";
        }

        public static class ErrorCodes
        {
            public const string InvalidToken = "INVALID_TOKEN";
            public const string PlayerNotFound = "PLAYER_NOT_FOUND";
            public const string PlayerIsControlled = "PLAYER_IS_CONTROLLED";
            public const string TargetOutOfRange = "TARGET_OUT_OF_RANGE";
            public const string RateLimited = "RATE_LIMITED";
            public const string InvalidLocation = "INVALID_LOCATION";
            public const string SosAlreadyActive = "SOS_ALREADY_ACTIVE";
            public const string InternalError = "INTERNAL_ERROR";
            public const string NetworkError = "NETWORK_ERROR";

            // Sprint 5 — Photon Multiplayer Foundation
            public const string InvalidChallenge = "INVALID_CHALLENGE";
            public const string DuplicateChallenge = "DUPLICATE_CHALLENGE";
            public const string BattleNotFound = "BATTLE_NOT_FOUND";
            public const string SessionExpired = "SESSION_EXPIRED";
            public const string ReconnectWindowExpired = "RECONNECT_WINDOW_EXPIRED";
            public const string Forbidden = "FORBIDDEN";

            // Sprint 6 — Full Combat System
            public const string InvalidResolution = "INVALID_RESOLUTION";

            // Sprint 8 — Friends + SOS + Rescue
            public const string AlreadyFriends = "ALREADY_FRIENDS";
            public const string FriendLimitReached = "FRIEND_LIMIT_REACHED";
            public const string PlayerBlocked = "PLAYER_BLOCKED";
            public const string FriendRequestNotFound = "FRIEND_REQUEST_NOT_FOUND";
            public const string NotFriends = "NOT_FRIENDS";
            public const string NotBlocked = "NOT_BLOCKED";
            public const string SosRequiresControl = "SOS_REQUIRES_CONTROL";
            public const string SosNotFound = "SOS_NOT_FOUND";
            public const string SosNotOpen = "SOS_NOT_OPEN";
            public const string CannotRescueSelf = "CANNOT_RESCUE_SELF";
            public const string RescueAlreadyInProgress = "RESCUE_ALREADY_IN_PROGRESS";
            public const string ControlTooShort = "CONTROL_TOO_SHORT";
            public const string ReservationExpired = "RESERVATION_EXPIRED";
            public const string NotYourReservation = "NOT_YOUR_RESERVATION";
            public const string GuardBattleNotActive = "GUARD_BATTLE_NOT_ACTIVE";
            public const string RescueMissionNotFound = "RESCUE_MISSION_NOT_FOUND";

            // Sprint 8 correction (final pass) — player_devices security
            // model, the SOS Control-relationship integrity guard, and the
            // rescue failed-attempt cooldown, mirroring the backend's
            // ApiError codes exactly (player.controller.js, sos.service.js,
            // rescue.service.js).
            public const string FcmTokenConflict = "FCM_TOKEN_CONFLICT";
            public const string DeviceNotFound = "DEVICE_NOT_FOUND";
            public const string ControlRelationshipNotFound = "CONTROL_RELATIONSHIP_NOT_FOUND";
            public const string RescueCooldownActive = "RESCUE_COOLDOWN_ACTIVE";

            // Sprint 8 Critical Security Patch — friend.service.js's
            // assertEligibleRescueFriendship (rescue accept + SOS view) and
            // rescue.service.js's guard-battle-token check.
            public const string NotEligibleFriend = "NOT_ELIGIBLE_FRIEND";
            public const string FriendshipTooNew = "FRIENDSHIP_TOO_NEW";
            public const string InvalidGuardBattleToken = "INVALID_GUARD_BATTLE_TOKEN";
        }

        public static class PlayerPrefsKeys
        {
            public const string LastKnownPlayerId = "nfouz_last_player_id";
            public const string AudioMusicVolume = "nfouz_audio_music_volume";
            public const string AudioSfxVolume = "nfouz_audio_sfx_volume";
            public const string LanguageCode = "nfouz_language_code";
        }
    }
}
