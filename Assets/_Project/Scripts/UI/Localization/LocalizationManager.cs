using System;
using Nfouz.Core;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Localization
{
    /// <summary>
    /// Sprint 10 — minimal key-to-string lookup for English/Arabic, backing
    /// SettingsScreen's language toggle. Registered in ServiceLocator like
    /// every other process-wide manager (Core/ServiceLocator.cs). Persists
    /// the chosen language via the ALREADY-DEFINED
    /// Constants.PlayerPrefsKeys.LanguageCode (Utils/Constants.cs — not
    /// modified, this key already existed, simply unused until now) and
    /// applies it at startup.
    ///
    /// Deliberately does not attempt to re-translate any EXISTING Sprint
    /// 1-9 UI string (e.g. RescueMissionController's own hard-coded Arabic
    /// DescribeError text) — those controllers are approved and not
    /// redesigned by this sprint. This only drives the NEW labels Sprint 10
    /// introduces (see StringTable.cs) and the RTL layout flip
    /// (RtlLayoutFlip.cs) for them.
    /// </summary>
    public class LocalizationManager : MonoBehaviour
    {
        public static string CurrentLanguage { get; private set; } = StringTable.Arabic;

        /// <summary>Fired whenever the language changes — RtlLayoutFlip and
        /// any screen showing a NEW Sprint 10 label subscribe to re-apply
        /// their text/alignment.</summary>
        public static event Action<string> OnLanguageChanged;

        public static bool IsRightToLeft => CurrentLanguage == StringTable.Arabic;

        private void Awake()
        {
            var locator = ServiceLocator.Instance;
            if (locator != null)
            {
                locator.Register<LocalizationManager>(this);
            }

            var saved = PlayerPrefs.GetString(Constants.PlayerPrefsKeys.LanguageCode, StringTable.Arabic);
            CurrentLanguage = saved == StringTable.English ? StringTable.English : StringTable.Arabic;
        }

        public static string Get(string key)
        {
            return StringTable.Get(key, CurrentLanguage);
        }

        public static void SetLanguage(string languageCode)
        {
            var normalized = languageCode == StringTable.English ? StringTable.English : StringTable.Arabic;
            if (normalized == CurrentLanguage)
            {
                return;
            }

            CurrentLanguage = normalized;
            PlayerPrefs.SetString(Constants.PlayerPrefsKeys.LanguageCode, normalized);
            PlayerPrefs.Save();
            OnLanguageChanged?.Invoke(CurrentLanguage);
        }
    }
}
