using Nfouz.Core;
using Nfouz.Localization;
using Nfouz.Map;
using Nfouz.Networking;
using Nfouz.Utils;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.UI.Screens
{
    /// <summary>
    /// Sprint 10 — Settings screen: language toggle (drives
    /// LocalizationManager + RTL layout flip) and volume sliders. Volume
    /// keys (Constants.PlayerPrefsKeys.AudioMusicVolume/AudioSfxVolume)
    /// already existed but were unused before this sprint — grepping the
    /// repo finds no AudioManager/mixer-control script anywhere yet, so
    /// this screen persists the two values via PlayerPrefs directly (the
    /// same storage the keys' own name already implies) rather than
    /// inventing an audio system this sprint was never asked to build; a
    /// future audio sprint reads the same two keys.
    ///
    /// "Show me to nearby players" (PATCH /player/{id}/visibility): the
    /// server stores and enforces it; the toggle only shows the stored
    /// value and reverts if saving fails.
    /// </summary>
    public class SettingsScreen : MonoBehaviour
    {
        [Header("Language")]
        [SerializeField] private Toggle arabicToggle;
        [SerializeField] private Toggle englishToggle;

        [Header("Volume")]
        [SerializeField] private Slider musicVolumeSlider;
        [SerializeField] private Slider sfxVolumeSlider;

        [Header("Safety")]
        [SerializeField] private Toggle visibleToggle;

        private bool _savingVisibility;
        private bool _settingToggle; // set from code: not a player's tap

        private void OnEnable()
        {
            if (arabicToggle != null)
            {
                arabicToggle.isOn = LocalizationManager.CurrentLanguage == StringTable.Arabic;
                arabicToggle.onValueChanged.AddListener(HandleArabicToggleChanged);
            }

            if (englishToggle != null)
            {
                englishToggle.isOn = LocalizationManager.CurrentLanguage == StringTable.English;
                englishToggle.onValueChanged.AddListener(HandleEnglishToggleChanged);
            }

            if (musicVolumeSlider != null)
            {
                musicVolumeSlider.value = PlayerPrefs.GetFloat(Constants.PlayerPrefsKeys.AudioMusicVolume, 1f);
                musicVolumeSlider.onValueChanged.AddListener(HandleMusicVolumeChanged);
            }

            if (sfxVolumeSlider != null)
            {
                sfxVolumeSlider.value = PlayerPrefs.GetFloat(Constants.PlayerPrefsKeys.AudioSfxVolume, 1f);
                sfxVolumeSlider.onValueChanged.AddListener(HandleSfxVolumeChanged);
            }

            if (visibleToggle != null)
            {
                SetVisibleToggle(!PlayerSession.HasActiveSession || PlayerSession.Current.IsVisible);
                visibleToggle.onValueChanged.AddListener(HandleVisibleToggleChanged);
            }
        }

        private void OnDisable()
        {
            if (arabicToggle != null) arabicToggle.onValueChanged.RemoveListener(HandleArabicToggleChanged);
            if (englishToggle != null) englishToggle.onValueChanged.RemoveListener(HandleEnglishToggleChanged);
            if (musicVolumeSlider != null) musicVolumeSlider.onValueChanged.RemoveListener(HandleMusicVolumeChanged);
            if (sfxVolumeSlider != null) sfxVolumeSlider.onValueChanged.RemoveListener(HandleSfxVolumeChanged);
            if (visibleToggle != null) visibleToggle.onValueChanged.RemoveListener(HandleVisibleToggleChanged);
        }

        private void SetVisibleToggle(bool isOn)
        {
            _settingToggle = true;
            visibleToggle.isOn = isOn;
            _settingToggle = false;
        }

        private void HandleVisibleToggleChanged(bool isOn)
        {
            if (_settingToggle)
            {
                return;
            }

            if (_savingVisibility || !PlayerSession.HasActiveSession)
            {
                SetVisibleToggle(!isOn);
                return;
            }

            _ = SaveVisibilityAsync(isOn);
        }

        private async System.Threading.Tasks.Task SaveVisibilityAsync(bool isVisible)
        {
            _savingVisibility = true;
            visibleToggle.interactable = false;
            var playerId = PlayerSession.Current.PlayerId;

            var locator = ServiceLocator.Instance;
            ApiResponse<VisibilityResponseData> response = null;
            if (locator != null && locator.TryGet<ApiClient>(out var apiClient))
            {
                response = await apiClient.PatchAsync<VisibilityResponseData>(
                    $"/player/{playerId}/visibility", new VisibilityRequest { is_visible = isVisible });
            }

            _savingVisibility = false;
            if (this == null)
            {
                return; // the screen was destroyed while saving
            }

            visibleToggle.interactable = true;
            var saved = response != null && response.success && response.data != null;
            var stillSamePlayer = PlayerSession.HasActiveSession && PlayerSession.Current.PlayerId == playerId;

            if (saved && stillSamePlayer)
            {
                PlayerSession.Current.IsVisible = response.data.is_visible;
                SetVisibleToggle(response.data.is_visible);
                return;
            }

            SetVisibleToggle(stillSamePlayer ? PlayerSession.Current.IsVisible : true);
            if (!saved && locator != null && locator.TryGet<PopupManager>(out var popups))
            {
                popups.ShowInfo(SafetyMessages.VisibilityErrorTitle, SafetyMessages.VisibilityError);
            }
        }

        private void HandleArabicToggleChanged(bool isOn)
        {
            if (isOn) LocalizationManager.SetLanguage(StringTable.Arabic);
        }

        private void HandleEnglishToggleChanged(bool isOn)
        {
            if (isOn) LocalizationManager.SetLanguage(StringTable.English);
        }

        private void HandleMusicVolumeChanged(float value)
        {
            PlayerPrefs.SetFloat(Constants.PlayerPrefsKeys.AudioMusicVolume, value);
            PlayerPrefs.Save();
        }

        private void HandleSfxVolumeChanged(float value)
        {
            PlayerPrefs.SetFloat(Constants.PlayerPrefsKeys.AudioSfxVolume, value);
            PlayerPrefs.Save();
        }
    }
}
