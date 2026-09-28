using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.UI
{
    /// <summary>
    /// Sprint 10 — tab bar for the five persistent bottom-nav screens
    /// (MainMap, Inventory, Friends, Quest, Profile). Each tab maps to a
    /// panel root GameObject that already hosts the real Sprint 1-9
    /// controller (InventoryController, FriendsController, QuestController,
    /// etc.) — this class only ever calls GameObject.SetActive on those
    /// panels; it never re-implements list refresh, claim, equip or any
    /// other business logic those controllers already own. A panel's own
    /// OnEnable (already present on every one of those controllers) is what
    /// triggers its data refresh the moment its tab becomes visible.
    ///
    /// The actual index-tracking logic is extracted into the plain
    /// (non-MonoBehaviour) NavigationState class below so it can be
    /// unit-tested in EditMode without a live GameObject/Button — see
    /// Tests/EditMode/NavigationStateTests.cs.
    /// </summary>
    public class BottomNavController : MonoBehaviour
    {
        [Serializable]
        public class Tab
        {
            public ScreenId screenId;
            public GameObject panelRoot;
            public Button tabButton;
        }

        [SerializeField] private List<Tab> tabs = new List<Tab>();
        [SerializeField] private ScreenId initialTab = ScreenId.MainMap;

        public event Action<ScreenId> OnTabChanged;

        private readonly NavigationState _state = new NavigationState();

        private void Awake()
        {
            foreach (var tab in tabs)
            {
                var capturedId = tab.screenId;
                if (tab.tabButton != null)
                {
                    tab.tabButton.onClick.AddListener(() => SwitchTo(capturedId));
                }
            }
        }

        private void OnDestroy()
        {
            foreach (var tab in tabs)
            {
                if (tab.tabButton != null)
                {
                    tab.tabButton.onClick.RemoveAllListeners();
                }
            }
        }

        private void Start()
        {
            SwitchTo(initialTab, force: true);
        }

        /// <summary>Activates the panel for `target` and deactivates every
        /// other tab's panel. A no-op if `target` is already the active tab
        /// (unless `force` is set — used once at Start()).</summary>
        public void SwitchTo(ScreenId target, bool force = false)
        {
            var changed = _state.SwitchTo(target);
            if (!changed && !force)
            {
                return;
            }

            foreach (var tab in tabs)
            {
                if (tab.panelRoot != null)
                {
                    tab.panelRoot.SetActive(tab.screenId == target);
                }
            }

            OnTabChanged?.Invoke(target);
        }

        public ScreenId CurrentTab => _state.Current;
    }

    /// <summary>
    /// Pure tab-switch state, deliberately free of any Unity/MonoBehaviour
    /// dependency so it can be exercised directly by an EditMode test with
    /// no GameObject at all.
    /// </summary>
    public class NavigationState
    {
        public ScreenId Current { get; private set; } = ScreenId.MainMap;

        /// <summary>Returns true if this call actually changed the current
        /// tab (false when `target` was already current).</summary>
        public bool SwitchTo(ScreenId target)
        {
            if (target == Current)
            {
                return false;
            }

            Current = target;
            return true;
        }
    }
}
