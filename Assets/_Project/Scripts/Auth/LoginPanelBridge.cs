using TMPro;
using UnityEngine;

namespace Nfouz.Auth
{
    /// <summary>
    /// Login scene UI glue (LOGIN_SCENE_SETUP.md §3): Button.OnClick cannot
    /// forward InputField values to AuthController's parameterized methods,
    /// so the Login/Register buttons call these parameterless wrappers, and
    /// AuthController.OnAuthError is shown on ErrorMessageText. No auth
    /// logic lives here — validation and routing stay in AuthController.
    /// </summary>
    public class LoginPanelBridge : MonoBehaviour
    {
        [SerializeField] private AuthController authController;

        [Header("Login panel")]
        [SerializeField] private TMP_InputField loginEmailInput;
        [SerializeField] private TMP_InputField loginPasswordInput;

        [Header("Register panel")]
        [SerializeField] private TMP_InputField registerEmailInput;
        [SerializeField] private TMP_InputField registerPasswordInput;
        [SerializeField] private TMP_InputField registerConfirmPasswordInput;

        [Header("Errors")]
        [SerializeField] private TMP_Text errorMessageText;

        private void OnEnable()
        {
            if (authController != null)
            {
                authController.OnAuthError += ShowError;
            }
        }

        private void OnDisable()
        {
            if (authController != null)
            {
                authController.OnAuthError -= ShowError;
            }
        }

        /// <summary>LoginButton.OnClick.</summary>
        public void OnLoginClicked()
        {
            HideError();
            authController.OnLoginButtonPressed(loginEmailInput.text, loginPasswordInput.text);
        }

        /// <summary>RegisterButton.OnClick.</summary>
        public void OnRegisterClicked()
        {
            HideError();
            authController.OnRegisterButtonPressed(registerEmailInput.text, registerPasswordInput.text,
                registerConfirmPasswordInput.text);
        }

        private void ShowError(string message)
        {
            if (errorMessageText == null)
            {
                return;
            }

            errorMessageText.text = message;
            errorMessageText.gameObject.SetActive(true);
        }

        private void HideError()
        {
            if (errorMessageText != null)
            {
                errorMessageText.gameObject.SetActive(false);
            }
        }
    }
}
