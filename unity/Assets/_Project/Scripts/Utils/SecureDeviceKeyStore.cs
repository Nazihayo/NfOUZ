using System;
using UnityEngine;

namespace Nfouz.Utils
{
    /// <summary>
    /// Sprint 8 correction (final pass) — "device_key identifies an
    /// installation and is stored securely by Unity." This is the secure
    /// storage ABSTRACTION the correction spec asks for: every other class
    /// in this project reads/writes the installation's device_key only
    /// through <see cref="GetOrCreateDeviceKey"/> / <see cref="Clear"/>,
    /// never directly through PlayerPrefs or a platform API, so swapping
    /// the implementation below for a real Android Keystore / iOS Keychain
    /// plugin later is a one-file change with no other call site touched.
    ///
    /// HONEST LIMITATION: this Unity project has no native Keystore/Keychain
    /// plugin installed (no such plugin exists anywhere in this repository —
    /// confirmed by inspection), and one cannot be added from this sandbox
    /// (no Unity Editor, no ability to import a native iOS/Android plugin
    /// package or write platform-specific Swift/Kotlin/Obj-C code that
    /// would actually compile into an .ipa/.aab here). The implementation
    /// below therefore stores the device_key in Unity's PlayerPrefs — which
    /// on Android backs onto a SharedPreferences XML file and on iOS onto
    /// an NSUserDefaults plist, NEITHER of which is Keystore/Keychain-backed
    /// encryption at rest. This is flagged explicitly rather than silently
    /// presented as "secure storage": the abstraction boundary is real and
    /// correctly placed, but the concrete implementation is a placeholder
    /// that needs a native secure-storage plugin (e.g. a Keystore/Keychain
    /// wrapper) dropped in before this ships. A `device_key` alone is a
    /// non-secret installation identifier (unlike an fcm_token or an auth
    /// token, which this class never touches) — its confidentiality
    /// requirement is lower, but the correction spec is explicit that it
    /// must go through secure storage, so this gap is called out rather
    /// than assumed acceptable.
    /// </summary>
    public static class SecureDeviceKeyStore
    {
        private const string PrefsKey = "nfouz_secure_device_key";

        /// <summary>
        /// Returns this installation's stable device_key, generating and
        /// persisting a new one (a GUID) the first time this is called on a
        /// fresh install. The same key is returned for the lifetime of the
        /// install — re-registering a token (a refreshed fcm_token) never
        /// changes it, which is exactly what lets the backend's
        /// UNIQUE(player_id, device_key) upsert treat it as "the same
        /// device" across token rotations (playerDevice.repository.js#registerDevice).
        /// </summary>
        public static string GetOrCreateDeviceKey()
        {
            var existing = PlayerPrefs.GetString(PrefsKey, string.Empty);
            if (!string.IsNullOrEmpty(existing))
            {
                return existing;
            }

            var generated = Guid.NewGuid().ToString("N");
            PlayerPrefs.SetString(PrefsKey, generated);
            PlayerPrefs.Save();
            return generated;
        }

        /// <summary>
        /// Clears the stored device_key — intentionally NOT called by
        /// ordinary sign-out (PushNotificationHandler.ClearTokenAsync
        /// deactivates the device server-side but keeps the local
        /// device_key, so signing back in on the SAME installation
        /// re-registers the SAME device rather than minting a new row).
        /// Reserved for an explicit "forget this device" / uninstall-reset
        /// flow, which does not yet exist anywhere in this codebase.
        /// </summary>
        public static void Clear()
        {
            PlayerPrefs.DeleteKey(PrefsKey);
            PlayerPrefs.Save();
        }
    }
}
