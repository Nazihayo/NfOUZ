using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.Quests
{
    /// <summary>
    /// Sprint 9 — one row in the Quest list UI: title, progress bar,
    /// reward, and a claim button. Mirrors Inventory/InventoryItem.cs's
    /// "bind data, expose a button click event" pattern — no networking of
    /// its own; QuestController owns the actual claim API call.
    /// </summary>
    public class QuestItem : MonoBehaviour
    {
        [SerializeField] private Text titleLabel;
        [SerializeField] private Slider progressSlider;
        [SerializeField] private Text progressLabel;
        [SerializeField] private Text rewardLabel;
        [SerializeField] private Button claimButton;
        [SerializeField] private GameObject claimedBadge;

        private QuestData _data;
        private System.Action<QuestData> _onClaimPressed;

        public void Bind(QuestData data, System.Action<QuestData> onClaimPressed)
        {
            _data = data;
            _onClaimPressed = onClaimPressed;

            if (titleLabel != null) titleLabel.text = data.title;
            if (progressSlider != null)
            {
                progressSlider.maxValue = Mathf.Max(1, data.goal_target);
                progressSlider.value = Mathf.Clamp(data.current_progress, 0, data.goal_target);
            }
            if (progressLabel != null) progressLabel.text = $"{data.current_progress}/{data.goal_target}";
            if (rewardLabel != null) rewardLabel.text = $"+{data.reward_coins} عملة، +{data.reward_bp_xp} XP";
            if (claimedBadge != null) claimedBadge.SetActive(data.is_claimed);

            if (claimButton != null)
            {
                claimButton.onClick.RemoveAllListeners();
                claimButton.onClick.AddListener(HandleClaimPressed);
                claimButton.interactable = data.is_completed && !data.is_claimed;
            }
        }

        private void HandleClaimPressed()
        {
            _onClaimPressed?.Invoke(_data);
        }
    }
}
