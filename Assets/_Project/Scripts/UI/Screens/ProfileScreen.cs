using Nfouz.Core;
using Nfouz.Localization;
using TMPro;
using UnityEngine;

namespace Nfouz.UI.Screens
{
    /// <summary>
    /// Sprint 10 — Profile screen: Username, Class, Faction, Level, Rank,
    /// Influence, XP, Credits.
    ///
    /// Faction: grepping the backend shows /auth/me (auth.service.js's
    /// toPublicPlayer) DOES return `faction_id` server-side (003_factions.sql
    /// exists), but the Unity client's own PlayerSessionData
    /// (Core/PlayerSession.cs) has no Faction field to receive it —
    /// NetworkPlayerSpawner.cs already flags this exact gap itself
    /// ("Faction not yet part of PlayerSessionData — populated once Faction
    /// System ships"). Per the sprint brief's own instruction for this
    /// case, Faction is therefore displayed defensively as "—" rather than
    /// fabricated, and PlayerSessionData is left unmodified (adding a
    /// Faction field there is exactly the kind of "Faction System" work the
    /// existing comment defers to a later sprint, not this UI-integration
    /// one).
    ///
    /// Level: unlike Faction, PlayerSessionData.Level already exists and is
    /// already populated from /auth/me — shown directly, no gap here.
    /// </summary>
    public class ProfileScreen : MonoBehaviour
    {
        [SerializeField] private TMP_Text usernameLabel;
        [SerializeField] private TMP_Text classLabel;
        [SerializeField] private TMP_Text factionLabel;
        [SerializeField] private TMP_Text levelLabel;
        [SerializeField] private TMP_Text rankLabel;
        [SerializeField] private TMP_Text influenceLabel;
        [SerializeField] private TMP_Text xpLabel;
        [SerializeField] private TMP_Text creditsLabel;

        private void OnEnable()
        {
            PlayerSession.OnSessionUpdated += HandleSessionUpdated;
            Refresh();
        }

        private void OnDisable()
        {
            PlayerSession.OnSessionUpdated -= HandleSessionUpdated;
        }

        private void HandleSessionUpdated(PlayerSessionData data) => Refresh();

        private void Refresh()
        {
            if (!PlayerSession.HasActiveSession)
            {
                return;
            }

            var data = PlayerSession.Current;
            if (usernameLabel != null) usernameLabel.text = data.Username;
            if (classLabel != null) classLabel.text = data.ClassType;
            if (factionLabel != null) factionLabel.text = LocalizationManager.Get("profile.notAvailable");
            if (levelLabel != null) levelLabel.text = data.Level.ToString();
            if (rankLabel != null) rankLabel.text = data.Rank;
            if (influenceLabel != null) influenceLabel.text = data.Influence.ToString();
            if (xpLabel != null) xpLabel.text = data.Experience.ToString();
            if (creditsLabel != null) creditsLabel.text = data.Credits.ToString();
        }
    }
}
