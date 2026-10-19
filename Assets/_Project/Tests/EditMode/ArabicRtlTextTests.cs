using System;
using Nfouz.Auth;
using NUnit.Framework;
using RTLTMPro;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// How Arabic UI text is drawn: RTLTextMeshPro (farsi off, numbers
    /// preserved, the settings every scene label uses) joins the letters, and
    /// TextMeshPro draws the result right-to-left. Screen() reproduces both
    /// steps, so it returns the characters as they appear left-to-right on
    /// screen. Unity-free apart from the RTLTMPro runtime.
    /// </summary>
    public class ArabicRtlTextTests
    {
        /// <summary>RTLTextMeshPro.UpdateText + TMP's right-to-left layout.</summary>
        private static string Screen(string text)
        {
            if (!TextUtils.IsRTLInput(text))
            {
                return text; // RTLTextMeshPro leaves non-Arabic text untouched, drawn left-to-right
            }

            var output = new FastStringBuilder(RTLSupport.DefaultBufferSize);
            RTLSupport.FixRTL(text, output, false, true, true);
            output.Reverse();
            var chars = output.ToString().ToCharArray();
            Array.Reverse(chars); // TMP draws the first character of an RTL text on the right
            return new string(chars);
        }

        private static void AssertContains(string expected, string actual, string message = null)
        {
            Assert.IsTrue(actual.IndexOf(expected, StringComparison.Ordinal) >= 0, message ?? $"expected \"{actual}\" to contain \"{expected}\"");
        }

        private static void AssertDoesNotContain(string unexpected, string actual)
        {
            Assert.IsTrue(actual.IndexOf(unexpected, StringComparison.Ordinal) < 0, $"expected \"{actual}\" not to contain \"{unexpected}\"");
        }

        private static void AssertStartsWith(string expected, string actual)
        {
            Assert.IsTrue(actual.StartsWith(expected, StringComparison.Ordinal), $"expected \"{actual}\" to start with \"{expected}\"");
        }

        private static bool HasUnjoinedArabicLetter(string text)
        {
            foreach (var c in text)
            {
                if (c >= 'ء' && c <= 'ي')
                {
                    return true;
                }
            }

            return false;
        }

        [TestCase("تسجيل الدخول")]
        [TestCase("البريد الإلكتروني أو كلمة المرور غير صحيحة.")]
        [TestCase("تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مجدداً.")]
        [TestCase(UsernameRules.InvalidMessage)]
        public void ArabicLetters_AreJoined(string text)
        {
            Assert.IsFalse(HasUnjoinedArabicLetter(Screen(text)), "every Arabic letter must be a joined presentation form");
        }

        [Test]
        public void Tashkeel_IsKept()
        {
            AssertContains("ّ", Screen("تعذّر"), "the shadda must survive shaping");
        }

        [TestCase("user@example.com")]
        [TestCase("player_1")]
        [TestCase("0 XP")]
        [TestCase("12:30")]
        [TestCase("https://example.com/a?b=1")]
        [TestCase("3f2b9c1e-0000-4000-8000-000000000000")]
        public void LatinOnlyText_IsUnchanged(string text)
        {
            Assert.AreEqual(text, Screen(text));
        }

        [Test]
        public void EmailAndNumbersInsideArabic_KeepTheirOrder()
        {
            var screen = Screen("مرحبا user@example.com 123");
            AssertStartsWith("user@example.com 123 ", screen);
        }

        [Test]
        public void Numbers_StayWesternDigitsInTheirOrder()
        {
            var screen = Screen(UsernameRules.InvalidMessage);
            AssertContains("20", screen);
            AssertContains("3", screen);
            AssertDoesNotContain("02", screen);
            AssertDoesNotContain("٣", screen); // not converted to Arabic-Indic digits
        }

        [Test]
        public void FarsiIsOff_ArabicYehIsNotTurnedIntoFarsiYeh()
        {
            AssertDoesNotContain("ی", Screen("في")); // Farsi yeh
            AssertDoesNotContain("ﯼ", Screen("في"));
        }

        [Test]
        public void RightToLeftMark_PutsSentencePunctuationAtTheEnd()
        {
            // Without U+200F RTLTMPro draws the period between the words
            // (this is why the project's messages carry it, see uiText.test.js).
            AssertStartsWith("sword.", Screen("تم تجهيز sword."));
            AssertStartsWith(".", Screen("تم تجهيز sword‏."));
            AssertStartsWith(".", Screen("تم الوصول للحد الأقصى لعدد الأصدقاء (100)‏."));
        }

        [Test]
        public void LatinWordsBetweenArabicWords_ReadInSentenceOrder()
        {
            // Read right-to-left: اختر فئة أولاً: Scout أو Ranger أو Titan.
            var screen = Screen("اختر فئة أولاً: Scout أو Ranger أو Titan‏.");
            AssertStartsWith(".", screen);
            Assert.Less(screen.IndexOf("Titan", StringComparison.Ordinal), screen.IndexOf("Ranger", StringComparison.Ordinal));
            Assert.Less(screen.IndexOf("Ranger", StringComparison.Ordinal), screen.IndexOf("Scout", StringComparison.Ordinal));
        }

        [TestCase("player_1", true)]
        [TestCase("Ab_9", true)]
        [TestCase("abc", true)]
        [TestCase("abcdefghijklmnopqrst", true)]
        [TestCase("ab", false)]
        [TestCase("abcdefghijklmnopqrstu", false)]
        [TestCase("لاعب", false)]
        [TestCase("player 1", false)]
        [TestCase(" player", false)]
        [TestCase("", false)]
        [TestCase(null, false)]
        public void UsernameRules_MatchTheBackend(string username, bool valid)
        {
            Assert.AreEqual(valid, UsernameRules.IsValid(username));
        }
    }
}
