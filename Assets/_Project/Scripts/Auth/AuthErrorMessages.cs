using Nfouz.Utils;

namespace Nfouz.Auth
{
    /// <summary>
    /// Player-facing (Arabic) messages for authentication failures. Raw
    /// Firebase/SDK text and server error messages are English and may
    /// carry internal detail, so they are logged for developers and never
    /// shown on the error label. Unity-free so it can be exercised directly
    /// by an EditMode test (see AuthErrorMessagesTests).
    /// </summary>
    public static class AuthErrorMessages
    {
        public const string Generic = "حدث خطأ غير متوقع. حاول مرة أخرى.";
        public const string SignInFailed = "فشل تسجيل الدخول. تحقق من البيانات.";
        public const string RegisterFailed = "فشل إنشاء الحساب.";
        public const string ServiceUnavailable = "خدمة تسجيل الدخول غير متاحة في هذه النسخة.";
        public const string NotReady = "خدمة تسجيل الدخول غير جاهزة بعد. حاول مرة أخرى.";
        public const string Network = "تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مجدداً.";
        public const string SessionExpired = "انتهت الجلسة. سجّل الدخول مرة أخرى.";
        public const string TooManyRequests = "محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.";
        public const string InvalidEmail = "البريد الإلكتروني غير صالح.";
        // Same text for "wrong password" and "no such user" so the screen
        // never reveals whether an email address has an account.
        public const string WrongCredentials = "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
        public const string EmailAlreadyInUse = "هذا البريد الإلكتروني مسجّل بالفعل. سجّل الدخول بدلاً من ذلك.";
        public const string WeakPassword = "كلمة المرور ضعيفة. استخدم 6 أحرف على الأقل.";
        public const string AccountDisabled = "تم تعطيل هذا الحساب.";

        /// <summary>Maps a Firebase Auth error, given by its
        /// Firebase.Auth.AuthError enum name (e.g. "WrongPassword"), to a
        /// player message. Unknown or missing names fall back to a generic
        /// sign-in / registration failure.</summary>
        public static string FromFirebaseAuthError(string authErrorName, bool isRegistration)
        {
            switch (authErrorName)
            {
                case "InvalidEmail":
                case "MissingEmail":
                    return InvalidEmail;
                case "WrongPassword":
                case "UserNotFound":
                case "InvalidCredential":
                    return WrongCredentials;
                case "EmailAlreadyInUse":
                    return EmailAlreadyInUse;
                case "WeakPassword":
                    return WeakPassword;
                case "UserDisabled":
                    return AccountDisabled;
                case "TooManyRequests":
                    return TooManyRequests;
                case "NetworkRequestFailed":
                    return Network;
                default:
                    return isRegistration ? RegisterFailed : SignInFailed;
            }
        }

        /// <summary>Maps a backend/ApiClient error that has no more specific
        /// meaning on the calling screen. Never returns the server's own
        /// message text.</summary>
        public static string FromApiError(ApiError error)
        {
            switch (error?.code)
            {
                case Constants.ErrorCodes.NetworkError:
                    return Network;
                case Constants.ErrorCodes.InvalidToken:
                    return SessionExpired;
                case Constants.ErrorCodes.RateLimited:
                    return TooManyRequests;
                default:
                    return Generic;
            }
        }
    }
}
