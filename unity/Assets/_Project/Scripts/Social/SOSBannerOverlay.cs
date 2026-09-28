using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.Social
{
    /// <summary>
    /// Sprint 8 — the persistent "you are Controlled, help is on the way"
    /// banner shown on the main map while the local player has an open SOS.
    /// Purely reactive to SOSManager's events; holds no polling or network
    /// logic of its own.
    /// </summary>
    public class SOSBannerOverlay : MonoBehaviour
    {
        [SerializeField] private GameObject bannerRoot;
        [SerializeField] private Text bannerLabel;
        [SerializeField] private float rescuedBannerDisplaySeconds = 4f;
        [SerializeField] private float expiredBannerDisplaySeconds = 4f;

        private void OnEnable()
        {
            if (SOSManager.Instance == null)
            {
                Debug.LogWarning("[SOSBannerOverlay] No SOSManager in the scene yet.");
                return;
            }

            SOSManager.Instance.OnSosCreated += HandleSosCreated;
            SOSManager.Instance.OnSosStillOpen += HandleSosStillOpen;
            SOSManager.Instance.OnSosRescued += HandleSosRescued;
            SOSManager.Instance.OnSosExpired += HandleSosExpired;
            SOSManager.Instance.OnSosError += HandleSosError;

            SetBannerVisible(SOSManager.Instance.HasActiveSos);
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

        private void HandleSosCreated(SosCreateResponseData data)
        {
            SetBannerVisible(true);
            SetText(data.duplicate
                ? "نداء الاستغاثة الخاص بك ما زال نشطاً — بانتظار صديق للإنقاذ."
                : $"تم إرسال نداء الاستغاثة إلى {data.notified_friend_ids?.Length ?? 0} من أصدقائك.");
        }

        private void HandleSosStillOpen(SosGetResponseData data)
        {
            SetBannerVisible(true);
            SetText("بانتظار وصول أحد الأصدقاء لإنقاذك...");
        }

        private void HandleSosRescued(SosGetResponseData data)
        {
            SetText("تم إنقاذك! أنت الآن محمي.");
            Invoke(nameof(HideBanner), rescuedBannerDisplaySeconds);
        }

        private void HandleSosExpired(SosGetResponseData data)
        {
            SetText("انتهى نداء الاستغاثة دون إنقاذ.");
            Invoke(nameof(HideBanner), expiredBannerDisplaySeconds);
        }

        private void HandleSosError(string errorCode)
        {
            Debug.LogWarning($"[SOSBannerOverlay] SOS error: {errorCode}");
        }

        private void HideBanner()
        {
            SetBannerVisible(false);
        }

        private void SetBannerVisible(bool visible)
        {
            if (bannerRoot != null)
            {
                bannerRoot.SetActive(visible);
            }
        }

        private void SetText(string text)
        {
            if (bannerLabel != null)
            {
                bannerLabel.text = text;
            }
        }
    }
}
