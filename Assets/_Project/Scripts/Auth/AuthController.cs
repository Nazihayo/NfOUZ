using System;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Networking;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Auth
{
    /// <summary>
    /// Drives the Login scene: sign-in for returning players, registration
    /// (Firebase account creation only) for new players. Class/username
    /// selection happens afterward in Onboarding — see OnboardingController.
    /// See Scene Architecture v1.0, section 2, and Unity MVP Implementation
    /// Plan v1.0, Phase 2.
    /// </summary>
    public class AuthController : MonoBehaviour
    {
        public event Action<string> OnAuthError;

        private FirebaseManager _firebaseManager;
        private ApiClient _apiClient;

        private void Awake()
        {
            _firebaseManager = ServiceLocator.Instance.Get<FirebaseManager>();
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();
        }

        /// <summary>Called by the "تسجيل الدخول" button. Signs in an existing
        /// Firebase user, then fetches the player's server state via /auth/me.
        /// Routes to MainMap if a player row already exists, or Onboarding
        /// if this Firebase account has not finished registration yet.</summary>
        public async void OnLoginButtonPressed(string email, string password)
        {
            if (!ValidateCredentials(email, password))
            {
                return;
            }

            var (signInOk, signInError) = await _firebaseManager.SignInWithEmail(email, password);
            if (!signInOk)
            {
                RaiseError(signInError ?? "فشل تسجيل الدخول. تحقق من البيانات.");
                return;
            }

            _apiClient.SetAuthToken(_firebaseManager.CurrentToken);
            var meResponse = await _apiClient.GetAsync<PlayerSessionData>("/auth/me");

            if (meResponse.success)
            {
                PlayerSession.UpdateFromServer(meResponse.data);
                await SceneLoader.LoadAsync(Constants.Scenes.MainMap);
                return;
            }

            if (meResponse.error != null && meResponse.error.code == Constants.ErrorCodes.PlayerNotFound)
            {
                // Firebase account exists but never finished onboarding.
                await SceneLoader.LoadAsync(Constants.Scenes.Onboarding);
                return;
            }

            RaiseError(meResponse.error?.message ?? "تعذّر جلب بيانات الحساب.");
        }

        /// <summary>Called by the "إنشاء حساب" button. Creates the Firebase
        /// account only — the actual player row is created afterward in
        /// Onboarding once the class and username are chosen.</summary>
        public async void OnRegisterButtonPressed(string email, string password, string confirmPassword)
        {
            if (!ValidateCredentials(email, password))
            {
                return;
            }

            if (password != confirmPassword)
            {
                RaiseError("كلمتا المرور غير متطابقتين.");
                return;
            }

            var (registerOk, registerError) = await _firebaseManager.RegisterWithEmail(email, password);
            if (!registerOk)
            {
                RaiseError(registerError ?? "فشل إنشاء الحساب.");
                return;
            }

            _apiClient.SetAuthToken(_firebaseManager.CurrentToken);
            await SceneLoader.LoadAsync(Constants.Scenes.Onboarding);
        }

        private bool ValidateCredentials(string email, string password)
        {
            if (string.IsNullOrWhiteSpace(email) || !email.Contains("@"))
            {
                RaiseError("أدخل بريداً إلكترونياً صحيحاً.");
                return false;
            }

            if (string.IsNullOrWhiteSpace(password) || password.Length < 6)
            {
                RaiseError("كلمة المرور يجب أن تكون 6 أحرف على الأقل.");
                return false;
            }

            return true;
        }

        private void RaiseError(string message)
        {
            Debug.LogWarning($"[AuthController] {message}");
            OnAuthError?.Invoke(message);
        }
    }
}
