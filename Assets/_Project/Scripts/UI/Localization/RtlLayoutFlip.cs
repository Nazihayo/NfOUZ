using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.Localization
{
    /// <summary>
    /// Sprint 10 — flips a horizontal layout/alignment for Arabic. The
    /// project's own UI is split between UnityEngine.UI.Text (14 of the 15
    /// existing UI scripts referencing a text component) and TMPro
    /// (NearbyPlayerMarkerUi.cs only) — this component targets
    /// UnityEngine.UI.Text/HorizontalLayoutGroup to match the majority
    /// convention every Sprint 10 screen otherwise follows (see the sprint
    /// report's "existing localization/RTL/test infra" section for this
    /// judgment call). A TMP_Text variant is a small, mechanical follow-up
    /// if a scene built with TMPro ever needs one.
    /// </summary>
    public class RtlLayoutFlip : MonoBehaviour
    {
        [SerializeField] private Text targetText;
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
                targetText.alignment = rightToLeft ? TextAnchor.MiddleRight : TextAnchor.MiddleLeft;
            }

            if (targetLayoutGroup != null)
            {
                targetLayoutGroup.reverseArrangement = rightToLeft;
            }
        }
    }
}
