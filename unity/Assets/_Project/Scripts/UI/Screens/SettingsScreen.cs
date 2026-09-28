using Nfouz.Localization;
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
    /// </summary>
    public class SettingsScreen : MonoBehaviour
    {
        [Header("Language")]
        [SerializeField] private Toggle arabicToggle;
        [SerializeField] private Toggle englishToggle;

        [Header("Volume")]
        [SerializeField] private Slider musicVolumeSlider;
        [SerializeField] private Slider sfxVolumeSlider;

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
        }

        private void OnDisable()
        {
            if (arabicToggle != null) arabicToggle.onValueChanged.RemoveListener(HandleArabicToggleChanged);
            if (englishToggle != null) englishToggle.onValueChanged.RemoveListener(HandleEnglishToggleChanged);
            if (musicVolumeSlider != null) musicVolumeSlider.onValueChanged.RemoveListener(HandleMusicVolumeChanged);
            if (sfxVolumeSlider != null) sfxVolumeSlider.onValueChanged.RemoveListener(HandleSfxVolumeChanged);
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
