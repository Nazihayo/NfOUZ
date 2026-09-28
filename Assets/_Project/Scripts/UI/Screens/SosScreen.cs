using Nfouz.Social;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.UI.Screens
{
    /// <summary>
    /// Sprint 10 — SOS screen: SOS Status, Rescue Countdown, Rescue Result,
    /// Protection Countdown. Deliberately a thin AGGREGATOR, not a
    /// reimplementation — every one of these four already has a full,
    /// approved Sprint 7/8 owner:
    ///   - SOS Status: SOSManager's events (OnSosCreated/OnSosStillOpen/
    ///     OnSosRescued/OnSosExpired/OnSosError) — SOSBannerOverlay.cs
    ///     already renders this as a persistent banner; this screen's own
    ///     status label mirrors the same events for the pushed SOS screen
    ///     context rather than duplicating SOSBannerOverlay's own instance.
    ///   - Rescue Countdown: RescueMissionController's own
    ///     guardBattleTimerSlider (its reservation/guard-battle panels) —
    ///     this screen only forwards SetActive on a wrapping root so the
    ///     pushed-screen container matches RescueMissionController's own
    ///     panel visibility; it reads no timer value itself.
    ///   - Rescue Result: RescueResultController's success/failure panels —
    ///     unmodified, hosted directly under this screen's root in the
    ///     scene hierarchy.
    ///   - Protection Countdown: the existing ProtectedCountdownDisplay
    ///     (UI/ProtectedCountdownDisplay.cs) — hosted as a child, not
    ///     reimplemented here.
    /// This class's own code is therefore limited to the one thing none of
    /// those own: the local player's own SOS status TEXT for THIS screen's
    /// layout (the four sub-panels above are Inspector-wired children, not
    /// constructed here).
    /// </summary>
    public class SosScreen : MonoBehaviour
    {
        [SerializeField] private Text statusLabel;

        private void OnEnable()
        {
            if (SOSManager.Instance == null)
            {
                Debug.LogWarning("[SosScreen] No SOSManager in the scene yet.");
                return;
            }

            SOSManager.Instance.OnSosCreated += HandleSosCreated;
            SOSManager.Instance.OnSosStillOpen += HandleSosStillOpen;
            SOSManager.Instance.OnSosRescued += HandleSosRescued;
            SOSManager.Instance.OnSosExpired += HandleSosExpired;
            SOSManager.Instance.OnSosError += HandleSosError;

            SetStatus(SosStatusMessages.ForHasActiveSos(SOSManager.Instance.HasActiveSos));
        }

        private void OnDisable()
        {
            if (SOSManager.Instance == null)
            {
                return;
            }

            SOSManager.Instance.OnSosCreated -= HandleSosCreated;
            SOSManager.Instance.OnSosStillOpen -= HandleSosStillOpen;
            SOSManager.Instance.OnSosRescued -= HandleSosRescued;
            SOSManager.Instance.OnSosExpired -= HandleSosExpired;
            SOSManager.Instance.OnSosError -= HandleSosError;
        }

        private void HandleSosCreated(SosCreateResponseData data) => SetStatus(SosStatusMessages.ForStatus("created"));
        private void HandleSosStillOpen(SosGetResponseData data) => SetStatus(SosStatusMessages.ForStatus("open"));
        private void HandleSosRescued(SosGetResponseData data) => SetStatus(SosStatusMessages.ForStatus("rescued"));
        private void HandleSosExpired(SosGetResponseData data) => SetStatus(SosStatusMessages.ForStatus("expired"));
        private void HandleSosError(string errorCode) => SetStatus(SosStatusMessages.ForError(errorCode));

        private void SetStatus(string message)
        {
            if (statusLabel != null)
            {
                statusLabel.text = message;
            }
        }
    }

    /// <summary>
    /// Pure SOS-status -> display-text mapping, extracted out of SosScreen
    /// so it can be unit-tested without a GameObject/SOSManager — see
    /// Tests/EditMode/SosStatusMessagesTests.cs ("SOS updates").
    /// </summary>
    public static class SosStatusMessages
    {
        public static string ForHasActiveSos(bool hasActiveSos) =>
            hasActiveSos ? "نداء استغاثة نشط." : "لا يوجد نداء استغاثة حالياً.";

        public static string ForStatus(string status)
        {
            switch (status)
            {
                case "created": return "تم إرسال نداء الاستغاثة.";
                case "open": return "بانتظار وصول أحد الأصدقاء لإنقاذك...";
                case "rescued": return "تم إنقاذك!";
                case "expired": return "انتهى نداء الاستغاثة دون إنقاذ.";
                default: return status;
            }
        }

        public static string ForError(string errorCode) => $"خطأ: {errorCode}";
    }
}
