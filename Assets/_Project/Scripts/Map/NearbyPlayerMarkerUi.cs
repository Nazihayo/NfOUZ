using TMPro;
using UnityEngine;

namespace Nfouz.Map
{
    /// <summary>
    /// Visual + interaction surface for a single nearby-player marker.
    /// Handles smooth movement interpolation toward the latest known
    /// position, keeps its distance label current, and exposes a
    /// selection highlight toggled by NearbyPlayerSelection. See Unity
    /// MVP Implementation Plan v1.0, Phase 4.
    /// </summary>
    [RequireComponent(typeof(Collider))]
    public class NearbyPlayerMarkerUi : MonoBehaviour
    {
        [SerializeField] private TMP_Text usernameText;
        [SerializeField] private TMP_Text distanceText;
        [SerializeField] private GameObject controlledStatusIcon;
        [SerializeField] private GameObject protectedStatusIcon; // Sprint 7 continuation — GDD section 4
        [SerializeField] private GameObject selectionHighlight;
        [SerializeField] private float movementLerpSpeed = 6f;

        public NearbyPlayerData Data { get; private set; }
        public bool IsSelected { get; private set; }

        private Vector3 _targetPosition;
        private bool _hasTarget;

        /// <summary>Called once when a pooled marker is (re)assigned to a
        /// player for the first time this activation — snaps to position
        /// immediately rather than interpolating from wherever the pooled
        /// object last was.</summary>
        public void Bind(NearbyPlayerData data, Vector3 worldPosition)
        {
            Data = data;
            _targetPosition = worldPosition;
            _hasTarget = true;
            transform.position = worldPosition;
            SetSelected(false);
            Refresh();
        }

        /// <summary>Called on every subsequent refresh tick for a player
        /// already bound to this marker — updates the interpolation target
        /// instead of snapping, so movement reads as smooth motion on the
        /// map rather than a teleport every polling interval.</summary>
        public void UpdateTarget(NearbyPlayerData data, Vector3 worldPosition)
        {
            Data = data;
            _targetPosition = worldPosition;
            _hasTarget = true;
            Refresh();
        }

        private void Refresh()
        {
            if (usernameText != null)
            {
                usernameText.text = Data.username;
            }

            if (distanceText != null)
            {
                distanceText.text = FormatDistance(Data.distance_meters);
            }

            if (controlledStatusIcon != null)
            {
                controlledStatusIcon.SetActive(Data.is_controlled);
            }

            // Sprint 7 continuation — a player can be Protected without
            // being Controlled (post-rescue/release window), and the two
            // never overlap in practice, so both icons are independent
            // rather than mutually exclusive toggles of one GameObject.
            if (protectedStatusIcon != null)
            {
                protectedStatusIcon.SetActive(Data.is_protected);
            }
        }

        private static string FormatDistance(double meters)
        {
            return meters >= 1000 ? $"{meters / 1000:0.0} كم" : $"{meters:0} م";
        }

        public void SetSelected(bool selected)
        {
            IsSelected = selected;
            if (selectionHighlight != null)
            {
                selectionHighlight.SetActive(selected);
            }
        }

        private void Update()
        {
            if (!_hasTarget)
            {
                return;
            }

            transform.position = Vector3.Lerp(transform.position, _targetPosition, movementLerpSpeed * Time.deltaTime);
        }

        private void OnDisable()
        {
            _hasTarget = false;
            SetSelected(false);
        }
    }
}
