using System.Collections.Generic;

namespace Nfouz.Localization
{
    /// <summary>
    /// Sprint 10 — minimal English/Arabic string table for every NEW label
    /// Sprint 10's screens introduce (existing Sprint 1-9 Arabic strings,
    /// e.g. RescueMissionController/InventoryController/QuestController's
    /// own DescribeError/status text, are left exactly as they are — this
    /// table is additive, not a replacement i18n pass over the whole app).
    ///
    /// Implemented as a plain embedded Dictionary rather than a
    /// ScriptableObject asset or an external JSON/CSV file loaded via
    /// Resources: there is no Unity Editor available in this sandbox to
    /// author/serialize a ScriptableObject asset safely, and an embedded
    /// table keeps LocalizationManager fully unit-testable in EditMode with
    /// no asset-loading dependency at all. Swapping this for a real
    /// ScriptableObject/JSON asset later requires no change outside this
    /// one file — LocalizationManager only ever calls StringTable.Get.
    /// </summary>
    public static class StringTable
    {
        public const string English = "en";
        public const string Arabic = "ar";

        private static readonly Dictionary<string, Dictionary<string, string>> Entries =
            new Dictionary<string, Dictionary<string, string>>
            {
                ["nav.mainmap"] = new Dictionary<string, string> { [English] = "Map", [Arabic] = "الخريطة" },
                ["nav.inventory"] = new Dictionary<string, string> { [English] = "Inventory", [Arabic] = "الحقيبة" },
                ["nav.friends"] = new Dictionary<string, string> { [English] = "Friends", [Arabic] = "الأصدقاء" },
                ["nav.quests"] = new Dictionary<string, string> { [English] = "Quests", [Arabic] = "المهام" },
                ["nav.profile"] = new Dictionary<string, string> { [English] = "Profile", [Arabic] = "الملف الشخصي" },

                ["profile.username"] = new Dictionary<string, string> { [English] = "Username", [Arabic] = "اسم المستخدم" },
                ["profile.class"] = new Dictionary<string, string> { [English] = "Class", [Arabic] = "الفئة" },
                ["profile.faction"] = new Dictionary<string, string> { [English] = "Faction", [Arabic] = "الفصيل" },
                ["profile.level"] = new Dictionary<string, string> { [English] = "Level", [Arabic] = "المستوى" },
                ["profile.rank"] = new Dictionary<string, string> { [English] = "Rank", [Arabic] = "الرتبة" },
                ["profile.influence"] = new Dictionary<string, string> { [English] = "Influence", [Arabic] = "النفوذ" },
                ["profile.xp"] = new Dictionary<string, string> { [English] = "Experience", [Arabic] = "الخبرة" },
                ["profile.credits"] = new Dictionary<string, string> { [English] = "Credits", [Arabic] = "العملات" },
                ["profile.notAvailable"] = new Dictionary<string, string> { [English] = "—", [Arabic] = "—" },

                ["settings.language"] = new Dictionary<string, string> { [English] = "Language", [Arabic] = "اللغة" },
                ["settings.musicVolume"] = new Dictionary<string, string> { [English] = "Music Volume", [Arabic] = "مستوى الموسيقى" },
                ["settings.sfxVolume"] = new Dictionary<string, string> { [English] = "SFX Volume", [Arabic] = "مستوى المؤثرات الصوتية" },

                ["battlepass.title"] = new Dictionary<string, string> { [English] = "Battle Pass", [Arabic] = "تذكرة المعركة" },
                ["battlepass.xp"] = new Dictionary<string, string> { [English] = "XP", [Arabic] = "نقاط الخبرة" },

                ["shop.title"] = new Dictionary<string, string> { [English] = "Shop", [Arabic] = "المتجر" },
                ["shop.comingSoon"] = new Dictionary<string, string> { [English] = "Coming soon", [Arabic] = "قريباً" },

                ["ayaz.button"] = new Dictionary<string, string> { [English] = "AYAZ AI", [Arabic] = "الذكاء الاصطناعي أياز" },
                ["ayaz.comingSoon"] = new Dictionary<string, string> { [English] = "AYAZ is coming in a future update.", [Arabic] = "أياز قادم في تحديث قادم." },

                ["battle.overtime"] = new Dictionary<string, string> { [English] = "Overtime!", [Arabic] = "وقت إضافي!" },
                ["battle.ready"] = new Dictionary<string, string> { [English] = "Ready", [Arabic] = "جاهز" },
                ["battle.cooldown"] = new Dictionary<string, string> { [English] = "Cooling down", [Arabic] = "في فترة تهدئة" },
            };

        /// <summary>Returns the entry for `key` in `languageCode`, falling
        /// back to English, then to the raw key itself (never throws / never
        /// shows a blank label for a key that exists but hasn't been
        /// translated into the requested language).</summary>
        public static string Get(string key, string languageCode)
        {
            if (Entries.TryGetValue(key, out var byLanguage))
            {
                if (byLanguage.TryGetValue(languageCode, out var value))
                {
                    return value;
                }

                if (byLanguage.TryGetValue(English, out var fallback))
                {
                    return fallback;
                }
            }

            return key;
        }
    }
}
