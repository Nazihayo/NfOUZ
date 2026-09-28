using System;

namespace Nfouz.Social
{
    /// <summary>
    /// Sprint 8 — Friends + SOS + Rescue DTOs. Field names mirror the JSON
    /// keys the backend actually returns (see friend.controller.js/
    /// sos.controller.js/rescue.controller.js) exactly, the same convention
    /// as Map/LocationModels.cs, so JsonUtility can deserialize them with no
    /// custom mapping.
    /// </summary>
    [Serializable]
    public class FriendData
    {
        public string friend_id;
        public string username;
        public string class_type;
        public string accepted_at; // ISO 8601 UTC
    }

    [Serializable]
    public class FriendsListResponseData
    {
        public FriendData[] friends;
    }

    [Serializable]
    public class PendingFriendRequestData
    {
        public string sender_id; // present on an incoming request
        public string recipient_id; // present on an outgoing request
        public string username;
        public string class_type;
        public string created_at;
        public string expires_at;
    }

    [Serializable]
    public class PendingRequestsResponseData
    {
        public PendingFriendRequestData[] incoming;
        public PendingFriendRequestData[] outgoing;
    }

    [Serializable]
    public class PlayerIdRequest
    {
        public string player_id;
    }

    [Serializable]
    public class SosCreateResponseData
    {
        public string sos_id;
        public string status;
        public bool duplicate;
        public string[] notified_friend_ids;
    }

    [Serializable]
    public class SosGetResponseData
    {
        public string sos_id;
        public string player_id;
        public string status; // 'open' | 'rescued' | 'expired'
        public string created_at;
        public string resolved_at;
        public string rescuer_id;
    }

    [Serializable]
    public class RescueAcceptRequest
    {
        public string sos_id;
    }

    [Serializable]
    public class RescueMissionData
    {
        public string mission_id;
        public string sos_id;
        public string status; // 'reserved' | 'in_progress' | 'succeeded' | 'failed' | 'expired'
        public string reservation_expires_at;
        public string guard_battle_ends_at;

        /// <summary>
        /// Sprint 8 Critical Security Patch — the one-time token
        /// rescue.controller.js#startGuardBattle returns alongside the
        /// mission. Must be echoed back verbatim in RescueOutcomeRequest —
        /// the server never trusts a resolve call without it, and rejects a
        /// stale/reused one (INVALID_GUARD_BATTLE_TOKEN), closing the
        /// replay/duplicate-resolve path. There is deliberately no
        /// "authoritative outcome" field here — the server decides that
        /// itself and never reveals it to the client, before or after the
        /// battle plays out.
        /// </summary>
        public string guard_battle_token;
    }

    [Serializable]
    public class RescueOutcomeRequest
    {
        public string outcome; // 'success' | 'failure' — the client's own report; NEVER authoritative server-side, see RescueMissionData.guard_battle_token.
        public string guard_battle_token;
    }

    [Serializable]
    public class RescueOutcomeResponseData
    {
        public string mission_id;
        public string status;
        public bool rewarded;
    }

      /// <summary>
    /// Sprint 8 correction (final pass) — PATCH /player/:id/fcm-token now
    /// requires all three fields (deviceValidation.js#parseRegisterDeviceBody
    /// rejects a missing/empty device_key or platform with 400, and an
    /// unexpected extra field). `device_key` is this installation's stable
    /// identifier (SecureDeviceKeyStore.GetOrCreateDeviceKey) — separate
    /// from `fcm_token`, which rotates.
    /// </summary>
    [Serializable]
    public class FcmTokenRequest
    {
        public string device_key;
        public string fcm_token;
        public string platform; // Constants.Devices.PlatformAndroid | PlatformIos
    }

    /// <summary>
    /// Sprint 8 correction (final pass) — mirrors player.controller.js's
    /// toDeviceResponse() exactly: "Never return FCM tokens through an API
    /// response" means the response body never has an fcm_token field at
    /// all, so this DTO deliberately has none for JsonUtility to populate
    /// even if the server response were ever to add one by mistake.
    /// </summary>
    [Serializable]
    public class DeviceResponseData
    {
        public string device_id;
        public string player_id;
        public string platform;
        public bool is_active;
        public string updated_at;
    }

    /// <summary>Sprint 8 correction (final pass) — POST /player/:id/devices/deactivate body.</summary>
    [Serializable]
    public class DeactivateDeviceRequest
    {
        public string device_key;
    }

    /// <summary>Sprint 8 correction (final pass) — POST /player/:id/devices/deactivate-all response.</summary>
    [Serializable]
    public class DeactivateAllDevicesResponseData
    {
        public string player_id;
        public int deactivated_count;
    }

    /// <summary>Covers the handful of simple-flag responses (decline/remove/unblock)
    /// plus the full friendship row (accept/block) — JsonUtility silently
    /// ignores whichever fields a given endpoint didn't actually send.</summary>
    [Serializable]
    public class FriendActionResponseData
    {
        public bool declined;
        public bool removed;
        public bool unblocked;
        public string player_id;
        public string friend_id;
        public string status;
    }
}
