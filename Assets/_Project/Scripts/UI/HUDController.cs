using Nfouz.Combat;
using Nfouz.Core;
using Nfouz.Networking;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.UI
{
    /// <summary>
    /// Sprint 10 — persistent in-world HUD overlay, used on both MainMap
    /// (session-level stats) and Battle (live combat stats, when a local
    /// PlayerCombat is assigned). Purely a display binder over data that
    /// already exists:
    ///   - MainMap mode (localPlayerCombat left unassigned): Health/Energy
    ///     read from PlayerSession.Current (server-authoritative snapshot),
    ///     refreshed via PlayerSession.OnSessionUpdated.
    ///   - Battle mode (localPlayerCombat assigned by BattleScreen once
    ///     BattleManager has identified the local combatant): Health/Energy
    ///     read live every frame from NetworkPlayerController's networked
    ///     properties instead, since those change far faster than a session
    ///     refresh during an actual fight.
    /// Influence/Rank/Credits always come from PlayerSession — there is no
    /// live in-battle equivalent for those (they only change on a resolved
    /// match, handled by ResultController, not mid-fight).
    /// </summary>
    public class HUDController : MonoBehaviour
    {
        [Header("Stat labels")]
        [SerializeField] private Text healthLabel;
        [SerializeField] private Slider healthSlider;
        [SerializeField] private Text energyLabel;
        [SerializeField] private Slider energySlider;
        [SerializeField] private Text influenceLabel;
        [SerializeField] private Text rankLabel;
        [SerializeField] private Text creditsLabel;

        private PlayerCombat _localPlayerCombat; // Battle mode only — null on MainMap

        private void OnEnable()
        {
            PlayerSession.OnSessionUpdated += HandleSessionUpdated;
            Refresh();
        }

        private void OnDisable()
        {
            PlayerSession.OnSessionUpdated -= HandleSessionUpdated;
        }

        private void Update()
        {
            if (_localPlayerCombat != null)
            {
                RefreshLiveCombatStats();
            }
        }

        /// <summary>Switches the HUD into Battle mode — called by
        /// BattleScreen once BattleManager.LocalPlayerCombat resolves a
        /// value (see BattleScreen.cs). Passing null reverts to
        /// PlayerSession-driven MainMap mode.</summary>
        public void SetLocalPlayerCombat(PlayerCombat playerCombat)
        {
            _localPlayerCombat = playerCombat;
            Refresh();
        }

        private void HandleSessionUpdated(PlayerSessionData data)
        {
            Refresh();
        }

        private void Refresh()
        {
            if (_localPlayerCombat != null)
            {
                RefreshLiveCombatStats();
            }
            else if (PlayerSession.HasActiveSession)
            {
                var data = PlayerSession.Current;
                SetHealth(data.Health, data.MaxHealth);
                SetEnergy(data.Energy, data.MaxEnergy);
            }

            if (PlayerSession.HasActiveSession)
            {
                if (influenceLabel != null) influenceLabel.text = PlayerSession.Current.Influence.ToString();
                if (rankLabel != null) rankLabel.text = PlayerSession.Current.Rank;
                if (creditsLabel != null) creditsLabel.text = PlayerSession.Current.Credits.ToString();
            }
        }

        private void RefreshLiveCombatStats()
        {
            var networkController = _localPlayerCombat.GetComponent<NetworkPlayerController>();
            if (networkController == null)
            {
                return;
            }

            SetHealth(networkController.NetworkedHealth, _localPlayerCombat.MaxHealth);
            SetEnergy(networkController.NetworkedEnergy, _localPlayerCombat.MaxEnergy);
        }

        private void SetHealth(int current, int max)
        {
            if (healthLabel != null) healthLabel.text = $"{current}/{max}";
            if (healthSlider != null) healthSlider.value = max > 0 ? (float)current / max : 0f;
        }

        private void SetEnergy(int current, int max)
        {
            if (energyLabel != null) energyLabel.text = $"{current}/{max}";
            if (energySlider != null) energySlider.value = max > 0 ? (float)current / max : 0f;
        }
    }
}
