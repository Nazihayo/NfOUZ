using Nfouz.Core;
using UnityEngine;

namespace Nfouz.UI
{
    /// <summary>
    /// Sprint 7 continuation — LOCAL-player HUD equivalent of
    /// NearbyPlayerMarkerUi's controlledStatusIcon/protectedStatusIcon
    /// (Map/NearbyPlayerMarkerUi.cs), which only ever renders OTHER
    /// players' status on their map markers. There is no on-map marker for
    /// the local player in this project to extend, so the local player's
    /// own Controlled/Protected status is surfaced here instead, as a
    /// persistent HUD icon pair (e.g. docked near the minimap) driven by
    /// the same ControlStateManager the countdown displays use — both
    /// icons independent of each other, exactly like the map-marker
    /// version (a player can be Protected without being Controlled, and
    /// the two never overlap in practice).
    /// </summary>
    public class PlayerControlStatusIcon : MonoBehaviour
    {
        [SerializeField] private GameObject controlledIcon;
        [SerializeField] private GameObject protectedIcon;

        private void OnEnable()
        {
            ControlStateManager.Initialize();
            ControlStateManager.OnControlChanged += HandleControlChanged;
            ControlStateManager.OnProtectionChanged += HandleProtectionChanged;
            Refresh();
        }

        private void OnDisable()
        {
            ControlStateManager.OnControlChanged -= HandleControlChanged;
            ControlStateManager.OnProtectionChanged -= HandleProtectionChanged;
        }

        private void HandleControlChanged(bool isControlled)
        {
            if (controlledIcon != null)
            {
                controlledIcon.SetActive(isControlled);
            }
        }

        private void HandleProtectionChanged(bool isProtected)
        {
            if (protectedIcon != null)
            {
                protectedIcon.SetActive(isProtected);
            }
        }

        private void Refresh()
        {
            HandleControlChanged(ControlStateManager.IsControlled);
            HandleProtectionChanged(ControlStateManager.IsProtected);
        }
    }
}
