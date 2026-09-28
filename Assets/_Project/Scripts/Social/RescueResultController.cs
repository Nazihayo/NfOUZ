using Nfouz.Core;
using Nfouz.Utils;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.SceneManagement;

namespace Nfouz.Social
{
    /// <summary>
    /// Sprint 8 — shows the outcome of a rescue attempt (success/failure)
    /// once RescueMissionController reports a resolved outcome, then
    /// returns to MainMap. Mirrors Combat/ResultController.cs's panel/
    /// auto-return convention.
    ///
    /// A successful rescue never grants Influence (GDD rule) — this screen
    /// therefore only ever shows Credits/XP, and only when `rewarded` is
    /// true (reward caps mean a successful rescue can still complete with
    /// no reward — "additional rescues remain possible but without
    /// rewards").
    /// </summary>
    public class RescueResultController : MonoBehaviour
    {
        [Header("Panels")]
        [SerializeField] private GameObject successPanel;
        [SerializeField] private GameObject failurePanel;

        [Header("Labels")]
        [SerializeField] private Text rewardLabel; // shown only when rewarded == true
        [SerializeField] private Button returnToMainMapButton;

        [Header("Behavior")]
        [SerializeField] private RescueMissionController missionController;
        [SerializeField] private float autoReturnSeconds = 6f;
        [SerializeField] private string mainMapSceneName = Constants.Scenes.MainMap;

        private float _autoReturnRemaining = -1f;
        private bool _returnTriggered;

        private void Awake()
        {
            SetAllPanelsInactive();

            if (returnToMainMapButton != null)
            {
                returnToMainMapButton.onClick.AddListener(ReturnToMainMap);
            }

            if (missionController != null)
            {
                missionController.OnMissionResolved += HandleMissionResolved;
            }
        }

        private void OnDestroy()
        {
            if (returnToMainMapButton != null)
            {
                returnToMainMapButton.onClick.RemoveListener(ReturnToMainMap);
            }

            if (missionController != null)
            {
                missionController.OnMissionResolved -= HandleMissionResolved;
            }
        }

        private void HandleMissionResolved(RescueOutcomeResponseData data)
        {
            SetAllPanelsInactive();

            if (data.status == "succeeded")
            {
                if (successPanel != null)
                {
                    successPanel.SetActive(true);
                }

                if (rewardLabel != null)
                {
                    rewardLabel.gameObject.SetActive(data.rewarded);
                    if (data.rewarded)
                    {
                        rewardLabel.text = $"حصلت على {Constants.Rescue.RewardCredits} عملة و {Constants.Rescue.RewardXp} نقطة خبرة!";
                    }
                }
            }
            else
            {
                if (failurePanel != null)
                {
                    failurePanel.SetActive(true);
                }
            }

            _autoReturnRemaining = autoReturnSeconds;
        }

        private void Update()
        {
            if (_autoReturnRemaining < 0f || _returnTriggered)
            {
                return;
            }

            _autoReturnRemaining -= Time.deltaTime;
            if (_autoReturnRemaining <= 0f)
            {
                ReturnToMainMap();
            }
        }

        private void ReturnToMainMap()
        {
            if (_returnTriggered)
            {
                return;
            }
            _returnTriggered = true;

            SceneManager.LoadScene(mainMapSceneName);
        }

        private void SetAllPanelsInactive()
        {
            if (successPanel != null)
            {
                successPanel.SetActive(false);
            }

            if (failurePanel != null)
            {
                failurePanel.SetActive(false);
            }

            if (rewardLabel != null)
            {
                rewardLabel.gameObject.SetActive(false);
            }
        }
    }
}
