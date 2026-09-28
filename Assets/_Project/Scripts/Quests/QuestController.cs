using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Networking;
using UnityEngine;

namespace Nfouz.Quests
{
    /// <summary>
    /// Sprint 9 — Quest screen root controller. Drives the quest list,
    /// progress, and reward-claim UI, plus the Battle Pass XP display,
    /// against the backend's /quests endpoints (quest.routes.js). Mirrors
    /// Social/FriendsController.cs's list-refresh/spawn-rows pattern and
    /// its lifetime-CancellationToken / overlapping-call guards.
    /// </summary>
    public class QuestController : MonoBehaviour
    {
        [SerializeField] private QuestTracker questTracker;
        [SerializeField] private Transform questListContainer;
        [SerializeField] private QuestItem questItemPrefab;
        [SerializeField] private UnityEngine.UI.Text statusLabel;

        [Header("Battle Pass XP display")]
        [SerializeField] private UnityEngine.UI.Text battlePassXpLabel;

        private ApiClient _apiClient;
        private readonly List<GameObject> _spawnedRows = new List<GameObject>();
        private readonly CancellationTokenSource _lifetimeCts = new CancellationTokenSource();
        private bool _isClaiming;

        private void Awake()
        {
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();

            if (questTracker == null)
            {
                questTracker = ServiceLocator.Instance.Get<QuestTracker>();
            }
            if (questTracker != null)
            {
                questTracker.OnQuestsRefreshed += HandleQuestsRefreshed;
            }
        }

        private void OnDestroy()
        {
            if (questTracker != null)
            {
                questTracker.OnQuestsRefreshed -= HandleQuestsRefreshed;
            }

            _lifetimeCts.Cancel();
            _lifetimeCts.Dispose();
        }

        private async void OnEnable()
        {
            if (questTracker != null)
            {
                await questTracker.RefreshAsync();
            }
        }

        private void HandleQuestsRefreshed(QuestListResponseData data)
        {
            ClearRows();
            UpdateBattlePassXpDisplay(data?.battle_pass_xp ?? 0);

            if (data?.quests == null || questListContainer == null || questItemPrefab == null)
            {
                return;
            }

            foreach (var quest in data.quests)
            {
                var row = Instantiate(questItemPrefab, questListContainer);
                row.Bind(quest, HandleClaimPressed);
                _spawnedRows.Add(row.gameObject);
            }
        }

        private void UpdateBattlePassXpDisplay(int battlePassXp)
        {
            if (battlePassXpLabel != null)
            {
                battlePassXpLabel.text = $"نقاط تذكرة المعركة: {battlePassXp}";
            }
        }

        /// <summary>
        /// Claims a completed quest's reward. Idempotent server-side
        /// (quest.service.js#claimQuest's atomic is_claimed guard) — a
        /// dropped response after the server already granted the reward
        /// simply comes back as `already_claimed = true` on a retry, never a
        /// second grant, so this method is safe to call again on a network
        /// timeout without any local "did this actually go through" state.
        /// </summary>
        private async void HandleClaimPressed(QuestData quest)
        {
            if (_isClaiming)
            {
                return;
            }
            _isClaiming = true;

            try
            {
                SetStatus($"جارٍ استلام مكافأة \"{quest.title}\"...");

                var token = _lifetimeCts.Token;
                var requestId = QuestTracker.NewRequestId();
                var response = await _apiClient.PostAsync<QuestClaimResponseData>(
                    $"/quests/{quest.quest_id}/claim",
                    new QuestClaimRequest { request_id = requestId },
                    token);

                if (token.IsCancellationRequested)
                {
                    return;
                }

                if (!response.success)
                {
                    SetStatus(DescribeError(response.error?.code));
                    return;
                }

                SetStatus(response.data.already_claimed
                    ? "تم استلام هذه المكافأة مسبقاً."
                    : $"تم استلام +{response.data.reward_coins} عملة و +{response.data.reward_bp_xp} XP!");

                if (questTracker != null)
                {
                    await questTracker.RefreshAsync();
                }
            }
            finally
            {
                _isClaiming = false;
            }
        }

        private static string DescribeError(string code)
        {
            switch (code)
            {
                case "QUEST_NOT_COMPLETED":
                    return "لم تكتمل هذه المهمة بعد.";
                case "QUEST_EXPIRED":
                    return "انتهت صلاحية هذه المهمة.";
                case "QUEST_NOT_FOUND":
                    return "هذه المهمة غير موجودة.";
                default:
                    return $"حدث خطأ: {code}";
            }
        }

        private void SetStatus(string message)
        {
            if (statusLabel != null)
            {
                statusLabel.text = message;
            }
        }

        private void ClearRows()
        {
            foreach (var row in _spawnedRows)
            {
                if (row != null)
                {
                    Destroy(row);
                }
            }
            _spawnedRows.Clear();
        }
    }
}
