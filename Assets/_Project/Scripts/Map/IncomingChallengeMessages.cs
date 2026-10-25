using Nfouz.Auth;
using Nfouz.Utils;

namespace Nfouz.Map
{
    /// <summary>
    /// Arabic texts for the Alpha defender flow: the defender's incoming
    /// prompt and answer errors (POST /battle/{id}/accept|decline,
    /// battle.service.js), and the attacker's wait for that answer. Never
    /// returns the server's own message text. Unity-free so it is tested
    /// directly (IncomingChallengeMessagesTests).
    /// </summary>
    public static class IncomingChallengeMessages
    {
        public const string PromptTitle = "تحدٍّ جديد";
        public const string Accept = "قبول";
        public const string Decline = "رفض";

        public const string AnswerErrorTitle = "تعذّر الرد على التحدي";
        public const string Expired = "انتهت مهلة هذا التحدي.";
        public const string AlreadyAnswered = "تم الرد على هذا التحدي مسبقاً.";
        public const string NotYours = "هذا التحدي ليس موجهاً إليك.";

        public const string WaitingTitle = "بانتظار الخصم";
        public const string Waiting = "أُرسل التحدي. بانتظار رد الخصم…";
        public const string WaitingDismiss = "إخفاء";
        public const string DeclinedByOpponent = "رفض الخصم التحدي.";
        public const string NoAnswer = "لم يرد الخصم على التحدي في الوقت المحدد.";

        /// <summary>The prompt body: only what the server sends about the
        /// attacker (username, class, rank).</summary>
        public static string PromptBody(string username, string classType, string rank)
        {
            var name = string.IsNullOrEmpty(username) ? "لاعب" : username;
            var body = $"يتحداك {name} في معركة.";
            if (!string.IsNullOrEmpty(classType) && !string.IsNullOrEmpty(rank))
            {
                body += $"\nالفئة: {classType} — الرتبة: {rank}";
            }

            return body;
        }

        public static string FromAnswerError(ApiError error)
        {
            switch (error?.code)
            {
                case Constants.ErrorCodes.SessionExpired:
                case Constants.ErrorCodes.BattleNotFound:
                    return Expired;
                case Constants.ErrorCodes.ChallengeAlreadyAnswered:
                    return AlreadyAnswered;
                case Constants.ErrorCodes.NotChallengeDefender:
                case Constants.ErrorCodes.Forbidden:
                    return NotYours;
                case Constants.ErrorCodes.PlayerMovingTooFast:
                    return SafetyMessages.AcceptWhileDriving;
                default:
                    return AuthErrorMessages.FromApiError(error);
            }
        }

        /// <summary>True when the answer may not have reached the server
        /// (network, rate limit, server error), so the challenge can be
        /// offered again; false when the server's refusal is final.</summary>
        public static bool IsRetryable(ApiError error)
        {
            switch (error?.code)
            {
                case Constants.ErrorCodes.SessionExpired:
                case Constants.ErrorCodes.BattleNotFound:
                case Constants.ErrorCodes.ChallengeAlreadyAnswered:
                case Constants.ErrorCodes.NotChallengeDefender:
                case Constants.ErrorCodes.Forbidden:
                    return false;
                default:
                    return true;
            }
        }
    }
}
