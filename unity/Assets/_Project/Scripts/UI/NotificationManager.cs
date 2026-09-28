using System.Collections.Generic;
using Nfouz.Core;
using Nfouz.Networking;
using Nfouz.Quests;
using Nfouz.Social;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.UI
{
    /// <summary>
    /// Sprint 10 — in-app toast/banner notifications. Wired ONLY to events
    /// already publicly exposed by Sprint 8/9 controllers — it never polls
    /// or invents a new backend call of its own:
    ///   - PushNotificationHandler (Sprint 8) — the four FCM push types
    ///     already routed there (SOS, Rescue Accepted, Rescue Completed,
    ///     Rescue Expired). This IS "if push/FCM notification receipt is
    ///     handled elsewhere, integrate with it, don't duplicate it" — no
    ///     new FCM plumbing is added here.
    ///   - RescueMissionController.OnMissionResolved / OnMissionError
    ///     (Sprint 8) — a rescuer's own mission outcome.
    ///   - SOSManager.OnSosRescued / OnSosExpired / OnSosError (Sprint 8) —
    ///     the local player's own open SOS lifecycle.
    ///   - QuestTracker.OnQuestsRefreshed (Sprint 9) — there is no dedicated
    ///     "quest completed" event on QuestTracker/QuestController (their
    ///     public surface is a data refresh event only), so a "quest just
    ///     became completed" toast is derived HERE by diffing the previous
    ///     vs. new quest list on each refresh (QuestDiff.FindNewlyCompleted
    ///     below) — this reads QuestTracker's already-public Current data,
    ///     it does not add any new method or event to QuestTracker itself.
    ///
    /// Deliberately NOT wired: a "friend request received" toast, since
    /// FriendsController (Sprint 8) exposes no event at all (friends/pending
    /// requests are refreshed by an explicit RefreshAllAsync() pull, not a
    /// push) — adding one would mean modifying that approved controller's
    /// public surface, which this sprint's scope excludes. Flagged in the
    /// Sprint 10 report as a gap for a future sprint rather than silently
    /// invented here.
    /// </summary>
    public class NotificationManager : MonoBehaviour
    {
        [SerializeField] private GameObject toastRoot;
        [SerializeField] private Text toastLabel;
        [SerializeField] private float toastDisplaySeconds = 4f;

        [Header("Optional scene refs (wired where present in this scene)")]
        [SerializeField] private PushNotificationHandler pushNotificationHandler;
        [SerializeField] private RescueMissionController rescueMissionController;
        [SerializeField] private QuestTracker questTracker;

        private List<QuestData> _previousQuests;

        private void Awake()
        {
            var locator = ServiceLocator.Instance;
            if (locator != null)
            {
                locator.Register<NotificationManager>(this);
            }

            SetVisible(false);
        }

        private void OnEnable()
        {
            if (pushNotificationHandler != null)
            {
                pushNotificationHandler.OnSosNotificationReceived += HandleSosPush;
                pushNotificationHandler.OnRescueAcceptedNotificationReceived += HandleRescueAcceptedPush;
                pushNotificationHandler.OnRescueCompletedNotificationReceived += HandleRescueCompletedPush;
                pushNotificationHandler.OnRescueExpiredNotificationReceived += HandleRescueExpiredPush;
            }

            if (rescueMissionController != null)
            {
                rescueMissionController.OnMissionResolved += HandleMissionResolved;
                rescueMissionController.OnMissionError += HandleMissionError;
            }

            if (SOSManager.Instance != null)
            {
                SOSManager.Instance.OnSosRescued += HandleSosRescued;
                SOSManager.Instance.OnSosExpired += HandleSosExpired;
                SOSManager.Instance.OnSosError += HandleSosError;
            }

            if (questTracker != null)
            {
                questTracker.OnQuestsRefreshed += HandleQuestsRefreshed;
            }
        }

        private void OnDisable()
        {
            if (pushNotificationHandler != null)
            {
                pushNotificationHandler.OnSosNotificationReceived -= HandleSosPush;
                pushNotificationHandler.OnRescueAcceptedNotificationReceived -= HandleRescueAcceptedPush;
                pushNotificationHandler.OnRescueCompletedNotificationReceived -= HandleRescueCompletedPush;
                pushNotificationHandler.OnRescueExpiredNotificationReceived -= HandleRescueExpiredPush;
            }

            if (rescueMissionController != null)
            {
                rescueMissionController.OnMissionResolved -= HandleMissionResolved;
                rescueMissionController.OnMissionError -= HandleMissionError;
            }

            if (SOSManager.Instance != null)
            {
                SOSManager.Instance.OnSosRescued -= HandleSosRescued;
                SOSManager.Instance.OnSosExpired -= HandleSosExpired;
                SOSManager.Instance.OnSosError -= HandleSosError;
            }

            if (questTracker != null)
            {
                questTracker.OnQuestsRefreshed -= HandleQuestsRefreshed;
            }
        }

        private void HandleSosPush(string sosId) => Show("نداء استغاثة من صديق!");
        private void HandleRescueAcceptedPush(string sosId) => Show("صديق في طريقه لإنقاذك.");
        private void HandleRescueCompletedPush(string sosId) => Show("تم إنقاذك بنجاح!");
        private void HandleRescueExpiredPush(string sosId) => Show("انتهى نداء الاستغاثة.");

        private void HandleMissionResolved(RescueOutcomeResponseData data) =>
            Show(data.status == "succeeded" ? "أتممت مهمة الإنقاذ بنجاح!" : "فشلت مهمة الإنقاذ.");

        private void HandleMissionError(string errorCode) => Show($"خطأ في مهمة الإنقاذ: {errorCode}");

        private void HandleSosRescued(SosGetResponseData data) => Show("تم إنقاذك! أنت الآن محمي.");
        private void HandleSosExpired(SosGetResponseData data) => Show("انتهى نداء الاستغاثة دون إنقاذ.");
        private void HandleSosError(string errorCode) => Show($"تعذّر إرسال نداء الاستغاثة: {errorCode}");

        private void HandleQuestsRefreshed(QuestListResponseData data)
        {
            var newlyCompleted = QuestDiff.FindNewlyCompleted(_previousQuests, data?.quests);
            foreach (var quest in newlyCompleted)
            {
                Show($"اكتملت المهمة: {quest.title}!");
            }

            _previousQuests = data?.quests != null ? new List<QuestData>(data.quests) : null;
        }

        private void Show(string message)
        {
            if (toastLabel != null)
            {
                toastLabel.text = message;
            }

            SetVisible(true);
            CancelInvoke(nameof(Hide));
            Invoke(nameof(Hide), toastDisplaySeconds);
        }

        private void Hide() => SetVisible(false);

        private void SetVisible(bool visible)
        {
            if (toastRoot != null)
            {
                toastRoot.SetActive(visible);
            }
        }
    }

    /// <summary>
    /// Pure diffing helper — Unity-free so it can be exercised directly by
    /// an EditMode test. Finds every quest that is completed in `current`
    /// but either absent or not-yet-completed in `previous`, by
    /// player_quest_id. `previous == null` (first-ever refresh) never
    /// reports anything as "newly" completed — there is no prior baseline
    /// to compare against, mirroring InfluenceManager's own "first load is
    /// a baseline, not a change" rule.
    /// </summary>
    public static class QuestDiff
    {
        public static List<QuestData> FindNewlyCompleted(List<QuestData> previous, QuestData[] current)
        {
            var result = new List<QuestData>();
            if (previous == null || current == null)
            {
                return result;
            }

            foreach (var quest in current)
            {
                if (!quest.is_completed)
                {
                    continue;
                }

                var wasCompletedBefore = false;
                foreach (var prevQuest in previous)
                {
                    if (prevQuest.player_quest_id == quest.player_quest_id)
                    {
                        wasCompletedBefore = prevQuest.is_completed;
                        break;
                    }
                }

                if (!wasCompletedBefore)
                {
                    result.Add(quest);
                }
            }

            return result;
        }
    }
}
