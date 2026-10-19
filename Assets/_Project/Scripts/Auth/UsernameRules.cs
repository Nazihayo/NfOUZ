using System.Text.RegularExpressions;

namespace Nfouz.Auth
{
    /// <summary>
    /// The username rule the backend enforces (backend/src/services/auth.service.js
    /// USERNAME_REGEX), checked before POST /auth/register so a rejected name
    /// gets a clear Arabic message instead of a round trip. Arabic usernames
    /// are not accepted by the backend; supporting them is a separate product
    /// decision, so this rule must stay identical to the backend's (the
    /// backend's Unity UI test compares the two patterns).
    /// </summary>
    public static class UsernameRules
    {
        public const string Pattern = "^[a-zA-Z0-9_]{3,20}$";

        public const string InvalidMessage = "اسم المستخدم يجب أن يكون من 3 إلى 20 حرفاً، ويستخدم الحروف الإنجليزية والأرقام و _ فقط.";

        private static readonly Regex Rule = new Regex(Pattern, RegexOptions.CultureInvariant);

        public static bool IsValid(string username)
        {
            return username != null && Rule.IsMatch(username);
        }
    }
}
