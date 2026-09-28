using Nfouz.Localization;
using NUnit.Framework;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for StringTable.Get (UI/Localization/StringTable.cs)
    /// and LocalizationManager's static language state
    /// (UI/Localization/LocalizationManager.cs). Not executed in this
    /// sandbox — see DamageCalculatorTests.cs's header note.
    /// </summary>
    [TestFixture]
    public class LocalizationManagerTests
    {
        [TearDown]
        public void TearDown()
        {
            // Restore a known state so test order never leaks between cases —
            // LocalizationManager.CurrentLanguage is a static, process-wide field.
            LocalizationManager.SetLanguage(StringTable.Arabic);
        }

        [Test]
        public void StringTable_Get_ReturnsArabicForKnownKey()
        {
            Assert.AreEqual("الخريطة", StringTable.Get("nav.mainmap", StringTable.Arabic));
        }

        [Test]
        public void StringTable_Get_ReturnsEnglishForKnownKey()
        {
            Assert.AreEqual("Map", StringTable.Get("nav.mainmap", StringTable.English));
        }

        [Test]
        public void StringTable_Get_UnknownKey_ReturnsKeyItself()
        {
            const string unknownKey = "this.key.does.not.exist";
            Assert.AreEqual(unknownKey, StringTable.Get(unknownKey, StringTable.Arabic));
        }

        [Test]
        public void StringTable_Get_UnknownLanguage_FallsBackToEnglish()
        {
            Assert.AreEqual("Map", StringTable.Get("nav.mainmap", "fr"));
        }

        [Test]
        public void LocalizationManager_SetLanguage_UpdatesCurrentLanguage()
        {
            LocalizationManager.SetLanguage(StringTable.English);
            Assert.AreEqual(StringTable.English, LocalizationManager.CurrentLanguage);
            Assert.IsFalse(LocalizationManager.IsRightToLeft);
        }

        [Test]
        public void LocalizationManager_Get_UsesCurrentLanguage()
        {
            LocalizationManager.SetLanguage(StringTable.English);
            Assert.AreEqual("Friends", LocalizationManager.Get("nav.friends"));

            LocalizationManager.SetLanguage(StringTable.Arabic);
            Assert.AreEqual("الأصدقاء", LocalizationManager.Get("nav.friends"));
        }

        [Test]
        public void LocalizationManager_SetLanguage_UnknownCode_FallsBackToArabic()
        {
            LocalizationManager.SetLanguage("fr");
            Assert.AreEqual(StringTable.Arabic, LocalizationManager.CurrentLanguage);
        }
    }
}
