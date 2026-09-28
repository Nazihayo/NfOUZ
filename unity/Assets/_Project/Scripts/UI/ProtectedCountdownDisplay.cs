using Nfouz.Core;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.UI
{
    /// <summary>
    /// Sprint 7 continuation — HUD countdown for the LOCAL player's own
    /// Protection window (post-rescue/voluntary-release/administrative-
    /// invalidation only — never shown after a plain Control timer expiry,
    /// since the server never grants Protection for that case; see
    /// player.repository.js#clearExpiredControl vs.
    /// #releaseControlWithProtection). Same authoritative-deadline /
    /// display-only-countdown contract as ControlledCountdownDisplay.
    /// </summary>
    public class ProtectedCountdownDisplay : MonoBehaviour
    {
        [SerializeField] private GameObject root;
        [SerializeField] private Text countdownLabel;

        private void OnEnable()
        {
            ControlStateManager.Initialize();
            ControlStateManager.OnProtectionChanged += HandleProtectionChanged;
            Refresh();
        }

        private void OnDisable()
        {
            ControlStateManager.OnProtectionChanged -= HandleProtectionChanged;
        }

        private void HandleProtectionChanged(bool isProtected)
        {
            Refresh();
        }

        private void Update()
        {
            if (root != null && !root.activeSelf)
            {
                return;
            }

            Refresh();
        }

        private void Refresh()
        {
            var isProtected = ControlStateManager.IsProtected;

            if (root != null)
            {
                root.SetActive(isProtected);
            }

            if (!isProtected || countdownLabel == null)
            {
                return;
            }

            var remaining = ControlStateManager.RemainingProtectionSeconds();
            countdownLabel.text = FormatCountdown(remaining);
        }

        private static string FormatCountdown(float totalSeconds)
        {
            var totalWhole = Mathf.CeilToInt(totalSeconds);
            var minutes = totalWhole / 60;
            var seconds = totalWhole % 60;
            return $"{minutes:00}:{seconds:00}";
        }
    }
}
