using Nfouz.Core;
using UnityEngine;

namespace Nfouz.UI
{
    /// <summary>
    /// Sprint 10 — top-level UI owner for whichever scene it lives in
    /// (MainMap or Battle — the only two scenes with a persistent bottom
    /// nav / HUD). Registered in ServiceLocator, mirroring
    /// GameManager/ServiceLocator's own convention (Core/ServiceLocator.cs),
    /// so any screen script can reach it with
    /// ServiceLocator.Instance.Get&lt;UIManager&gt;() instead of holding a
    /// direct scene reference. Deliberately scene-scoped rather than
    /// DontDestroyOnLoad — unlike ApiClient/PlayerSession, the UI tree is
    /// rebuilt fresh by Unity's own scene load for each scene, and
    /// ServiceLocator.Register's "overwrite with a warning" behavior
    /// (already the documented contract) is exactly what should happen when
    /// a new scene's UIManager replaces the previous scene's.
    ///
    /// Owns nothing itself — it only delegates to the four subsystems named
    /// in the sprint brief, each already responsible for its own concern:
    /// navigation (BottomNavController), popups (PopupManager), loading
    /// overlays (LoadingManager), and toast notifications
    /// (NotificationManager). A screen that only needs one of those can
    /// still just hold a direct reference to it instead of going through
    /// UIManager — this class exists for convenience/discoverability, not
    /// as a mandatory indirection layer.
    /// </summary>
    public class UIManager : MonoBehaviour
    {
        [SerializeField] private BottomNavController bottomNav;
        [SerializeField] private PopupManager popupManager;
        [SerializeField] private LoadingManager loadingManager;
        [SerializeField] private NotificationManager notificationManager;

        public BottomNavController BottomNav => bottomNav;
        public PopupManager Popups => popupManager;
        public LoadingManager Loading => loadingManager;
        public NotificationManager Notifications => notificationManager;

        private void Awake()
        {
            var locator = ServiceLocator.Instance;
            if (locator != null)
            {
                locator.Register<UIManager>(this);
            }
        }

        /// <summary>Convenience pass-through for a bottom-nav tab switch —
        /// see BottomNavController.SwitchTo. A no-op if this scene has no
        /// bottom nav (e.g. Battle/Result/Login scenes).</summary>
        public void ShowTab(ScreenId screenId)
        {
            bottomNav?.SwitchTo(screenId);
        }
    }
}
