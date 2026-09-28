using System;
using Nfouz.Core;
using Nfouz.Networking;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Auth
{
    /// <summary>Serializable request body for POST /auth/register.
    /// Field names match the API's snake_case JSON exactly — JsonUtility
    /// has no attribute-based renaming, so the C# field names ARE the wire format.</summary>
    [Serializable]
    public class RegisterRequest
    {
        public string username;
        public string class_type;
    }

    /// <summary>
    /// Drives the Onboarding scene: class selection (Scout/Ranger/Titan)
    /// followed by username entry, then calls POST /auth/register to
    /// create the actual player row on the server. See GDD v1.0 section 3,
    /// Scene Architecture v1.0 section 3.
    /// </summary>
    public class OnboardingController : MonoBehaviour
    {
        public event Action<string> OnRegistrationError;
        public event Action OnRegistrationSucceeded;

        private ApiClient _apiClient;
        private string _selectedClassType;

        private void Awake()
        {
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();
        }

        /// <summary>Called by each ClassSelectionCard (Scout/Ranger/Titan) on tap.</summary>
        public void OnClassSelected(string classType)
        {
            if (classType != Constants.PlayerClass.Scout &&
                classType != Constants.PlayerClass.Ranger &&
                classType != Constants.PlayerClass.Titan)
            {
                Debug.LogError($"[OnboardingController] Unknown class type selected: {classType}");
                return;
            }

            _selectedClassType = classType;
            Debug.Log($"[OnboardingController] Class selected: {classType}");
        }

        /// <summary>Called by the "تأكيد" button after class + username are chosen.</summary>
        public async void OnConfirmButtonPressed(string username)
        {
            if (string.IsNullOrEmpty(_selectedClassType))
            {
                RaiseError("اختر فئة أولاً (Scout / Ranger / Titan).");
                return;
            }

            if (string.IsNullOrWhiteSpace(username) || username.Length < 3 || username.Length > 20)
            {
                RaiseError("اسم المستخدم يجب أن يكون بين 3 و20 حرفاً.");
                return;
            }

            var request = new RegisterRequest { username = username, class_type = _selectedClassType };
            var response = await _apiClient.PostAsync<PlayerSessionData>("/auth/register", request);

            if (!response.success)
            {
                RaiseError(TranslateError(response.error));
                return;
            }

            PlayerSession.UpdateFromServer(response.data);
            OnRegistrationSucceeded?.Invoke();
            await SceneLoader.LoadAsync(Constants.Scenes.MainMap);
        }

        private static string TranslateError(ApiError error)
        {
            if (error == null)
            {
                return "حدث خطأ غير متوقع.";
            }

            return error.code switch
            {
                "USERNAME_TAKEN" => "اسم المستخدم مُستخدَم بالفعل.",
                "PLAYER_ALREADY_REGISTERED" => "هذا الحساب مُسجَّل بالفعل.",
                "INVALID_CLASS_TYPE" => "الفئة المختارة غير صالحة.",
                "INVALID_USERNAME" => "اسم المستخدم غير صالح.",
                _ => error.message,
            };
        }

        private void RaiseError(string message)
        {
            Debug.LogWarning($"[OnboardingController] {message}");
            OnRegistrationError?.Invoke(message);
        }
    }
}
