using TMPro;
using UnityEngine;

namespace Nfouz.Auth
{
    /// <summary>
    /// Onboarding scene UI glue (ONBOARDING_SCENE_SETUP.md §4): the Confirm
    /// button calls OnConfirmClicked, which forwards UsernameInput.text to
    /// OnboardingController.OnConfirmButtonPressed, and
    /// OnboardingController.OnRegistrationError is shown on ErrorMessageText.
    /// Class selection is wired directly on each card's SelectButton.
    /// </summary>
    public class OnboardingPanelBridge : MonoBehaviour
    {
        [SerializeField] private OnboardingController onboardingController;
        [SerializeField] private TMP_InputField usernameInput;
        [SerializeField] private TMP_Text errorMessageText;

        private void OnEnable()
        {
            if (onboardingController != null)
            {
                onboardingController.OnRegistrationError += ShowError;
            }
        }

        private void OnDisable()
        {
            if (onboardingController != null)
            {
                onboardingController.OnRegistrationError -= ShowError;
            }
        }

        /// <summary>ConfirmButton.OnClick.</summary>
        public void OnConfirmClicked()
        {
            if (errorMessageText != null)
            {
                errorMessageText.gameObject.SetActive(false);
            }

            onboardingController.OnConfirmButtonPressed(usernameInput.text);
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
    }
}
