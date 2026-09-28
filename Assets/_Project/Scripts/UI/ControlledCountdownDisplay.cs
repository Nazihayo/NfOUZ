using Nfouz.Core;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.UI
{
    /// <summary>
    /// Sprint 7 continuation — HUD countdown for the LOCAL player's own
    /// Control window. Shows/hides itself automatically based on
    /// ControlStateManager.IsControlled and re-derives the remaining time
    /// from the server-issued ControlledUntilIso deadline every frame
    /// (ServerTime.SecondsRemaining), never by decrementing its own
    /// Time.deltaTime-based counter — "local countdown is display-only":
    /// this component only FORMATS a number for display, it never owns
    /// the authoritative value.
    /// </summary>
    public class ControlledCountdownDisplay : MonoBehaviour
    {
        [SerializeField] private GameObject root; // parent panel/icon shown only while Controlled
        [SerializeField] private Text countdownLabel; // Text/TMP_Text per project convention

        private void OnEnable()
        {
            ControlStateManager.Initialize();
            ControlStateManager.OnControlChanged += HandleControlChanged;
            Refresh();
        }

        private void OnDisable()
        {
            ControlStateManager.OnControlChanged -= HandleControlChanged;
        }

        private void HandleControlChanged(bool isControlled)
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
            var isControlled = ControlStateManager.IsControlled;

            if (root != null)
            {
                root.SetActive(isControlled);
            }

            if (!isControlled || countdownLabel == null)
            {
                return;
            }

            var remaining = ControlStateManager.RemainingControlSeconds();
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
