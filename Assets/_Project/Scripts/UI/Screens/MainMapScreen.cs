using System;
using Nfouz.Core;
using Nfouz.Localization;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.UI.Screens
{
    /// <summary>
    /// Sprint 10 — MainMap screen stat panel: Health, Energy, Influence,
    /// Rank, Credits, Controlled State, Protected State, and the AYAZ AI
    /// button. A thin binder only — every value already exists on
    /// PlayerSession/ControlStateManager (Sprint 7 continuation), none of
    /// it is recomputed here.
    ///
    /// AYAZ AI: grepping the whole repo (see the sprint report) finds no
    /// implementation anywhere — only one design-doc mention
    /// (OnboardingScene/ONBOARDING_SCENE_SETUP.md) noting the intro panel
    /// "is out of scope" and was "renamed per the global assistant rename"
    /// from an earlier placeholder name, with no server dependency defined.
    /// Per the sprint brief, the button here is therefore a STUBBED entry
    /// point only: it fires OnAyazButtonPressed and shows a
    /// "coming in a future update" popup — it does not invent any AI
    /// feature, dialogue, or backend call.
    /// </summary>
    public class MainMapScreen : MonoBehaviour
    {
        [Header("Stats")]
        [SerializeField] private Text healthLabel;
        [SerializeField] private Text energyLabel;
        [SerializeField] private Text influenceLabel;
        [SerializeField] private Text rankLabel;
        [SerializeField] private Text creditsLabel;

        [Header("Control state")]
        [SerializeField] private GameObject controlledBadge;
        [SerializeField] private GameObject protectedBadge;

        [Header("AYAZ AI (stub — see class doc comment)")]
        [SerializeField] private Button ayazButton;

        /// <summary>Fired when the AYAZ AI button is pressed. No listener is
        /// wired to this by Sprint 10 itself beyond the popup below — a
        /// future AYAZ sprint hooks its real entry point here instead of
        /// this screen needing to change.</summary>
        public event Action OnAyazButtonPressed;

        private void Awake()
        {
            if (ayazButton != null)
            {
                ayazButton.onClick.AddListener(HandleAyazButtonPressed);
            }
        }

        private void OnDestroy()
        {
            if (ayazButton != null)
            {
                ayazButton.onClick.RemoveListener(HandleAyazButtonPressed);
            }
        }

        private void OnEnable()
        {
            ControlStateManager.Initialize();
            PlayerSession.OnSessionUpdated += HandleSessionUpdated;
            ControlStateManager.OnControlChanged += HandleControlOrProtectionChanged;
            ControlStateManager.OnProtectionChanged += HandleControlOrProtectionChanged;
            Refresh();
        }

        private void OnDisable()
        {
            PlayerSession.OnSessionUpdated -= HandleSessionUpdated;
            ControlStateManager.OnControlChanged -= HandleControlOrProtectionChanged;
            ControlStateManager.OnProtectionChanged -= HandleControlOrProtectionChanged;
        }

        private void HandleSessionUpdated(PlayerSessionData data) => Refresh();
        private void HandleControlOrProtectionChanged(bool _) => Refresh();

        private void Refresh()
        {
            if (PlayerSession.HasActiveSession)
            {
                var data = PlayerSession.Current;
                if (healthLabel != null) healthLabel.text = $"{data.Health}/{data.MaxHealth}";
                if (energyLabel != null) energyLabel.text = $"{data.Energy}/{data.MaxEnergy}";
                if (influenceLabel != null) influenceLabel.text = data.Influence.ToString();
                if (rankLabel != null) rankLabel.text = data.Rank;
                if (creditsLabel != null) creditsLabel.text = data.Credits.ToString();
            }

            if (controlledBadge != null) controlledBadge.SetActive(ControlStateManager.IsControlled);
            if (protectedBadge != null) protectedBadge.SetActive(ControlStateManager.IsProtected);
        }

        private void HandleAyazButtonPressed()
        {
            Debug.Log("[MainMapScreen] AYAZ AI button pressed — stubbed entry point, no AYAZ implementation exists yet (see class doc comment).");
            OnAyazButtonPressed?.Invoke();

            var locator = ServiceLocator.Instance;
            if (locator != null && locator.TryGet<PopupManager>(out var popups))
            {
                popups.ShowInfo(LocalizationManager.Get("ayaz.button"), LocalizationManager.Get("ayaz.comingSoon"));
            }
        }
    }
}
