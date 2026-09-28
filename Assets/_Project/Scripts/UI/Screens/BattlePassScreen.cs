using Nfouz.Core;
using Nfouz.Localization;
using Nfouz.Quests;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.UI.Screens
{
    /// <summary>
    /// Sprint 10 — Battle Pass screen: DISPLAY-ONLY XP progress bar using
    /// Sprint 9's battle_pass_xp (GET /quests response — quest.service.js's
    /// own documented choice to return it there rather than add a new
    /// endpoint; see QuestModels.cs/QuestTracker.cs, both unmodified).
    /// Explicitly NO purchase/premium UI or code — there is no shop/premium
    /// backend at all (creditsService.js's own header comment: "not invent
    /// a full shop or economy").
    ///
    /// There is no server-defined XP-per-tier threshold anywhere in the
    /// backend (grep confirms only a flat, ever-increasing battle_pass_xp
    /// counter — no tiers table). `AssumedTierXp` below is therefore an
    /// explicitly FLAGGED, NOT-approved display constant (same convention
    /// Constants.cs itself already uses for e.g. Constants.Battle.ArenaRadiusMeters)
    /// used only to give the progress bar a visible fill fraction — the raw
    /// XP number, which IS real server data, is always shown alongside it.
    /// </summary>
    public class BattlePassScreen : MonoBehaviour
    {
        /// <summary>FLAGGED ASSUMPTION — not an approved GDD/backend value.
        /// No tier-threshold concept exists server-side yet; used only to
        /// give the progress bar a plausible fill fraction.</summary>
        private const int AssumedTierXp = 1000;

        [SerializeField] private QuestTracker questTracker;
        [SerializeField] private Text titleLabel;
        [SerializeField] private Text xpLabel;
        [SerializeField] private Slider xpProgressSlider;

        private void Awake()
        {
            if (questTracker == null)
            {
                questTracker = ServiceLocator.Instance.Get<QuestTracker>();
            }
        }

        private void OnEnable()
        {
            if (titleLabel != null) titleLabel.text = LocalizationManager.Get("battlepass.title");

            if (questTracker != null)
            {
                questTracker.OnQuestsRefreshed += HandleQuestsRefreshed;
            }

            Refresh();
        }

        private void OnDisable()
        {
            if (questTracker != null)
            {
                questTracker.OnQuestsRefreshed -= HandleQuestsRefreshed;
            }
        }

        private void HandleQuestsRefreshed(QuestListResponseData data) => Refresh();

        private void Refresh()
        {
            var xp = questTracker != null ? questTracker.BattlePassXp : 0;

            if (xpLabel != null)
            {
                xpLabel.text = $"{LocalizationManager.Get("battlepass.xp")}: {xp}";
            }

            if (xpProgressSlider != null)
            {
                xpProgressSlider.value = Mathf.Clamp01((xp % AssumedTierXp) / (float)AssumedTierXp);
            }
        }
    }
}
