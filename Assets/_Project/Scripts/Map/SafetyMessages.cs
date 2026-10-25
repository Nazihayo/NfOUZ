namespace Nfouz.Map
{
    /// <summary>
    /// Arabic texts for the safety rules the server enforces: the driving
    /// stop (PATCH /player/{id}/location answers moving_too_fast) and
    /// "don't show me" (PATCH /player/{id}/visibility). Unity-free so it is
    /// tested directly (SafetyMessagesTests).
    /// </summary>
    public static class SafetyMessages
    {
        public const string DrivingTitle = "سلامتك أولاً";
        public const string Driving = "يبدو أنك تتنقل بسرعة مركبة. لا تلعب أثناء القيادة. لن يراك أحد ولن تستطيع التحدي حتى تتوقف.";
        public const string ChallengeWhileDriving = "لا يمكن التحدي أثناء القيادة أو التنقل السريع.";
        public const string AcceptWhileDriving = "لا يمكن قبول التحدي أثناء القيادة أو التنقل السريع.";

        public const string VisibilityLabel = "أظهرني للاعبين القريبين";
        public const string HiddenChallenge = "أنت مخفي الآن. فعّل «أظهرني للاعبين القريبين» في الإعدادات لتتحدى.";
        public const string VisibilityErrorTitle = "تعذّر حفظ الإعداد";
        public const string VisibilityError = "لم يُحفظ الإعداد. تحقق من الاتصال وحاول مرة أخرى.";
    }

    /// <summary>
    /// Shows the driving message once when the server starts reporting
    /// moving_too_fast, and closes it once it stops; not on every update.
    /// </summary>
    public class DrivingNoticeGate
    {
        public const string PopupKey = "safety.driving";

        private bool _movingTooFast;

        /// <summary>Returns +1 to show the message, -1 to close it, 0 to do nothing.</summary>
        public int Update(bool movingTooFast)
        {
            if (movingTooFast == _movingTooFast)
            {
                return 0;
            }

            _movingTooFast = movingTooFast;
            return movingTooFast ? 1 : -1;
        }
    }
}
