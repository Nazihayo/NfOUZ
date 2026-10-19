using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.Localization
{
    /// <summary>
    /// Sprint 10 — flips a horizontal layout/alignment for Arabic. Targets
    /// a TMP_Text (all UI text is TextMeshPro / RTLTMPro since the Arabic UI
    /// migration) and a HorizontalLayoutGroup. Only the horizontal
    /// alignment changes; the vertical alignment set in the scene is kept.
    /// </summary>
    public class RtlLayoutFlip : MonoBehaviour
    {
        [SerializeField] private TMP_Text targetText;
        [SerializeField] private HorizontalLayoutGroup targetLayoutGroup;

        private void OnEnable()
        {
            LocalizationManager.OnLanguageChanged += HandleLanguageChanged;
            Apply(LocalizationManager.IsRightToLeft);
        }

        private void OnDisable()
        {
            LocalizationManager.OnLanguageChanged -= HandleLanguageChanged;
        }

        private void HandleLanguageChanged(string languageCode)
        {
            Apply(LocalizationManager.IsRightToLeft);
        }

        private void Apply(bool rightToLeft)
        {
            if (targetText != null)
            {
                targetText.horizontalAlignment = rightToLeft ? HorizontalAlignmentOptions.Right : HorizontalAlignmentOptions.Left;
            }

            if (targetLayoutGroup != null)
            {
                targetLayoutGroup.reverseArrangement = rightToLeft;
            }
        }
    }
}
