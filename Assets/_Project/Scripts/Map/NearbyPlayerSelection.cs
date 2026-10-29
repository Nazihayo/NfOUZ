using System;
using UnityEngine;
using UnityEngine.EventSystems;

namespace Nfouz.Map
{
    /// <summary>
    /// Detects taps/clicks on nearby-player markers via a physics raycast
    /// from the main camera, tracks the currently-selected marker, and
    /// raises OnPlayerSelected for the mini profile popup + challenge
    /// button to react to. See Unity MVP Implementation Plan v1.0, Phase 4.
    /// </summary>
    public class NearbyPlayerSelection : MonoBehaviour
    {
        [SerializeField] private Camera worldCamera;
        [SerializeField] private LayerMask markerLayerMask;
        // The Mapbox camera sits ~700 units from the ground (far clip 5000).
        [SerializeField] private float maxRaycastDistance = 5000f;

        public event Action<NearbyPlayerMarkerUi> OnPlayerSelected;
        public event Action OnSelectionCleared;

        private NearbyPlayerMarkerUi _selectedMarker;

        private void Awake()
        {
            if (worldCamera == null)
            {
                worldCamera = Camera.main;
            }
        }

        private void Update()
        {
            // A press on UI (the mini profile's Challenge button, the HUD) is
            // not a map tap: clearing the selection there would hide the
            // popup before the button's click arrives.
            if (Input.touchCount > 0)
            {
                var touch = Input.GetTouch(0);
                if (touch.phase == TouchPhase.Began && !IsOverUi(touch.fingerId))
                {
                    TrySelectAtScreenPosition(touch.position);
                }
            }
            else if (Input.GetMouseButtonDown(0) && !IsOverUi(-1))
            {
                TrySelectAtScreenPosition(Input.mousePosition);
            }
        }

        private static bool IsOverUi(int pointerId)
        {
            var events = EventSystem.current;
            return events != null && (pointerId < 0 ? events.IsPointerOverGameObject() : events.IsPointerOverGameObject(pointerId));
        }

        private void TrySelectAtScreenPosition(Vector2 screenPosition)
        {
            if (worldCamera == null)
            {
                Debug.LogWarning("[NearbyPlayerSelection] No camera assigned or found via Camera.main.");
                return;
            }

            var ray = worldCamera.ScreenPointToRay(screenPosition);

            if (Physics.Raycast(ray, out var hit, maxRaycastDistance, markerLayerMask))
            {
                var marker = hit.collider.GetComponentInParent<NearbyPlayerMarkerUi>();
                if (marker != null)
                {
                    Select(marker);
                    return;
                }
            }

            ClearSelection();
        }

        public void Select(NearbyPlayerMarkerUi marker)
        {
            if (_selectedMarker == marker)
            {
                return;
            }

            _selectedMarker?.SetSelected(false);
            _selectedMarker = marker;
            _selectedMarker.SetSelected(true);

            OnPlayerSelected?.Invoke(_selectedMarker);
        }

        public void ClearSelection()
        {
            if (_selectedMarker == null)
            {
                return;
            }

            _selectedMarker.SetSelected(false);
            _selectedMarker = null;
            OnSelectionCleared?.Invoke();
        }

        /// <summary>Called by NearbyPlayersTracker when a marker is released
        /// back to the pool — clears the selection if it was the selected one,
        /// so the mini profile popup never shows stale data for a player who
        /// just left range.</summary>
        public void NotifyMarkerReleased(NearbyPlayerMarkerUi marker)
        {
            if (_selectedMarker == marker)
            {
                ClearSelection();
            }
        }
    }
}
