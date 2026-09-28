using System;
using Nfouz.Core;
using Nfouz.Utils;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.Map
{
    /// <summary>
    /// Drives the mini profile popup and challenge button for whichever
    /// marker NearbyPlayerSelection currently has selected. Evaluates all
    /// four challenge-eligibility rules from the Sprint 4 spec on every
    /// selection change and on every subsequent data refresh (a selected
    /// player's distance/is_controlled can change while still selected).
    /// See GDD v1.0 section 8 and Unity MVP Implementation Plan v1.0, Phase 4.
    /// </summary>
    public class ChallengeInteractionController : MonoBehaviour
    {
        [Header("Scene refs")]
        [SerializeField] private NearbyPlayerSelection selection;

        [Header("Mini profile popup")]
        [SerializeField] private GameObject miniProfilePopup;
        [SerializeField] private Text usernameLabel; // UnityEngine.UI.Text or swap for TMP_Text per project convention
        [SerializeField] private Text classLabel;
        [SerializeField] private Button challengeButton;

        [Header("Rules")]
        // Sprint 5 correction: this used to be an independent literal
        // (20f) duplicating the approved TDD v1.0 line 405 value ("نطاق
        // تحدٍّ، مثلاً 20 متر") in a second place. It now always mirrors
        // Constants.Battle.MaxChallengeDistanceMeters — the single source
        // of truth also used by env.BATTLE_MAX_CHALLENGE_DISTANCE_METERS
        // server-side — so the two can never silently drift apart again.
        // Still exposed in the Inspector for QA/tuning visibility, but
        // reset to the constant on Awake rather than hand-edited per scene.
        [SerializeField] private float maxChallengeDistanceMeters = Constants.Battle.MaxChallengeDistanceMeters;

        public event Action<NearbyPlayerData> OnChallengeRequested;

        private NearbyPlayerMarkerUi _currentMarker;

        private void Awake()
        {
            // Force the single source of truth even if a scene/prefab has a
            // stale serialized value baked in from before this correction —
            // a field's [SerializeField] default only applies the first
            // time the field is added, not retroactively to existing data.
            maxChallengeDistanceMeters = Constants.Battle.MaxChallengeDistanceMeters;

            if (selection == null)
            {
                Debug.LogError("[ChallengeInteractionController] No NearbyPlayerSelection assigned.");
                return;
            }

            selection.OnPlayerSelected += HandlePlayerSelected;
            selection.OnSelectionCleared += HandleSelectionCleared;

            if (challengeButton != null)
            {
                challengeButton.onClick.AddListener(HandleChallengeButtonPressed);
            }

            if (miniProfilePopup != null)
            {
                miniProfilePopup.SetActive(false);
            }
        }

        private void OnDestroy()
        {
            if (selection != null)
            {
                selection.OnPlayerSelected -= HandlePlayerSelected;
                selection.OnSelectionCleared -= HandleSelectionCleared;
            }

            if (challengeButton != null)
            {
                challengeButton.onClick.RemoveListener(HandleChallengeButtonPressed);
            }
        }

        private void HandlePlayerSelected(NearbyPlayerMarkerUi marker)
        {
            _currentMarker = marker;
            ShowPopup(marker.Data);
        }

        private void HandleSelectionCleared()
        {
            _currentMarker = null;
            HidePopup();
        }

        private void Update()
        {
            // The selected marker's underlying data (distance, is_controlled)
            // can change on every NearbyPlayersTracker refresh tick while it
            // remains selected — re-evaluate eligibility continuously rather
            // than only at the moment of selection.
            if (_currentMarker != null && miniProfilePopup != null && miniProfilePopup.activeSelf)
            {
                RefreshChallengeButtonState(_currentMarker.Data);
            }
        }

        private void ShowPopup(NearbyPlayerData data)
        {
            if (miniProfilePopup != null)
            {
                miniProfilePopup.SetActive(true);
            }

            if (usernameLabel != null)
            {
                usernameLabel.text = data.username;
            }

            if (classLabel != null)
            {
                classLabel.text = data.class_type;
            }

            RefreshChallengeButtonState(data);
        }

        private void HidePopup()
        {
            if (miniProfilePopup != null)
            {
                miniProfilePopup.SetActive(false);
            }
        }

        /// <summary>Evaluates every challenge-eligibility rule from the
        /// Sprint 4 spec: within allowed distance, target online, target
        /// visible (implied by appearing in the nearby list at all — a
        /// hidden player is never returned by the server), target not
        /// controlled, target not blocked.
        ///
        /// Sprint 7 (Influence + Control): also checks whether the LOCAL
        /// player is currently Controlled — the server now rejects that
        /// challenge outright with PLAYER_IS_CONTROLLED (see
        /// battle.service.js#createChallenge), so this mirrors that rule
        /// client-side for the same reason the target's own is_controlled
        /// check already existed: fail fast in the UI instead of only
        /// after a round trip. PlayerSession.Current.IsControlled is kept
        /// live by ResultController/BattleManager's post-battle fold and
        /// by /auth/me's own time-based isControlActive check — never a
        /// stale flag on its own.</summary>
        private bool IsChallengeEligible(NearbyPlayerData data, out string reasonIfNot)
        {
            if (PlayerSession.HasActiveSession && PlayerSession.Current.IsControlled)
            {
                reasonIfNot = "أنت تحت السيطرة حالياً ولا يمكنك التحدي.";
                return false;
            }

            // Sprint 7 continuation (GDD section 4 — Protection): "challenge
            // eligibility must check both Control and protection." Mirrors
            // battle.service.js#createChallenge's PLAYER_IS_PROTECTED check
            // for the local player, for the same fail-fast-in-the-UI reason
            // the IsControlled check above already exists.
            if (PlayerSession.HasActiveSession && PlayerSession.Current.IsProtected)
            {
                reasonIfNot = "أنت محمي حالياً ولا يمكنك التحدي.";
                return false;
            }

            if (data.distance_meters > maxChallengeDistanceMeters)
            {
                reasonIfNot = "الخصم بعيد جداً للتحدي.";
                return false;
            }

            if (!data.is_online)
            {
                reasonIfNot = "اللاعب غير متصل حالياً.";
                return false;
            }

            if (data.is_blocked)
            {
                reasonIfNot = "لا يمكن تحدي لاعب محظور.";
                return false;
            }

            if (data.is_controlled)
            {
                reasonIfNot = "اللاعب تحت السيطرة حالياً ولا يمكن تحديه.";
                return false;
            }

            // Sprint 7 continuation — target-side Protection check,
            // mirroring the target-side is_controlled check just above.
            if (data.is_protected)
            {
                reasonIfNot = "اللاعب محمي حالياً ولا يمكن تحديه.";
                return false;
            }

            reasonIfNot = null;
            return true;
        }

        private void RefreshChallengeButtonState(NearbyPlayerData data)
        {
            if (challengeButton == null)
            {
                return;
            }

            var eligible = IsChallengeEligible(data, out _);
            challengeButton.interactable = eligible;
        }

        private void HandleChallengeButtonPressed()
        {
            if (_currentMarker == null)
            {
                return;
            }

            var data = _currentMarker.Data;
            if (!IsChallengeEligible(data, out var reason))
            {
                Debug.LogWarning($"[ChallengeInteractionController] Challenge attempted while ineligible: {reason}");
                return;
            }

            // Sprint 5/6 (Photon + Battle System) subscribe to this event to
            // actually call POST /battle/challenge and join the Photon room —
            // this controller's only job is eligibility gating and UI state.
            OnChallengeRequested?.Invoke(data);
        }
    }
}
