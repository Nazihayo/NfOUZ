using Nfouz.Auth;
using Nfouz.Utils;

namespace Nfouz.Map
{
    /// <summary>
    /// Arabic messages for a challenge the server refused (POST
    /// /battle/challenge, battle.service.js createChallenge) or one that
    /// could not enter the battle room. Never returns the server's own
    /// message text. Unity-free so it is tested directly.
    /// </summary>
    public static class ChallengeErrorMessages
    {
        public const string Title = "تعذّر التحدي";
        public const string Busy = "أنت أو الخصم في معركة أخرى حالياً.";
        public const string OutOfRange = "الخصم بعيد جداً للتحدي.";
        public const string Controlled = "لا يمكن التحدي الآن: أحد اللاعبين تحت السيطرة.";
        public const string Protected = "لا يمكن التحدي الآن: أحد اللاعبين محمي.";
        public const string NotAvailable = "هذا اللاعب غير متاح للتحدي.";
        public const string JoinFailed = "تعذّر دخول غرفة المعركة. حاول مرة أخرى.";

        public static string FromApiError(ApiError error)
        {
            switch (error?.code)
            {
                case Constants.ErrorCodes.DuplicateChallenge:
                    return Busy;
                case Constants.ErrorCodes.TargetOutOfRange:
                    return OutOfRange;
                case Constants.ErrorCodes.PlayerIsControlled:
                    return Controlled;
                case Constants.ErrorCodes.PlayerIsProtected:
                    return Protected;
                case Constants.ErrorCodes.InvalidChallenge:
                case Constants.ErrorCodes.PlayerNotFound:
                    return NotAvailable;
                default:
                    return AuthErrorMessages.FromApiError(error);
            }
        }
    }
}
