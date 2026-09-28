using Nfouz.Core;
using Nfouz.Map;
using Nfouz.Networking;
using Nfouz.Utils;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.Combat
{
    /// <summary>
    /// Result Screen: shows Victory/Defeat/Draw and the Influence change
    /// from the server's resolve response, then returns to MainMap — the
    /// final two steps of the Match Flow (Result Screen -> Return To
    /// MainMap). Also folds the authoritative result back into
    /// PlayerSession, since the server response is the source of truth
    /// for the local player's new Influence/Controlled state (see
    /// PlayerSession.UpdateFromServer's own "server always overrides
    /// local cache" rule).
    ///
    /// Sprint 6 correction pass: added Draw support (GDD's Overtime rule
    /// can end a match with neither side ahead) — a Draw changes neither
    /// Influence nor Controlled state, so PlayerSession is left untouched
    /// in that case.
    ///
    /// Sprint 7 (Influence + Control): also folds the server-computed Rank
    /// (winner_rank/loser_rank — see backend config/rankTiers.js) into
    /// PlayerSession alongside Influence, so a Rank change from a battle
    /// takes effect immediately rather than waiting for the next /auth/me
    /// refresh.
    ///
    /// Sprint 6 final gameplay-completion pass: added "pending_review"
    /// support — Alpha security mode can accept a host-signed result but
    /// hold it for review (see BattleManager.cs's header doc comment and
    /// battle.service.js's evaluateSuspicion). A pending_review result is
    /// NOT a win, loss, or draw: no Influence or Control was granted, so
    /// PlayerSession is left untouched exactly like a Draw, and it is
    /// shown with its own message via the existing unknownResultPanel
    /// (reused rather than adding a new Inspector-wired panel) rather
    /// than being folded into any of the three real outcomes.
    /// </summary>
    public class ResultController : MonoBehaviour
    {
        [Header("Panels")]
        [SerializeField] private GameObject victoryPanel;
        [SerializeField] private GameObject defeatPanel;
        [SerializeField] private GameObject drawPanel; // shown for a resolved Draw
        [SerializeField] private GameObject unknownResultPanel; // shown if the resolve call itself failed

        [Header("Labels")]
        [SerializeField] private Text influenceChangeLabel; // Text/TMP_Text per project convention
        [SerializeField] private Text rankTransitionLabel; // Sprint 7 continuation — shown only on an actual rank change
        [SerializeField] private Button returnToMainMapButton;

        [Header("Behavior")]
        [SerializeField] private float autoReturnSeconds = 8f;

        private float _autoReturnRemaining = -1f;
        private bool _returnTriggered;

        private void Awake()
        {
            SetAllPanelsInactive();

            if (returnToMainMapButton != null)
            {
                returnToMainMapButton.onClick.AddListener(ReturnToMainMap);
            }
        }

        private void OnDestroy()
        {
            if (returnToMainMapButton != null)
            {
                returnToMainMapButton.onClick.RemoveListener(ReturnToMainMap);
            }
        }

        private void Update()
        {
            if (_autoReturnRemaining < 0f || _returnTriggered)
            {
                return;
            }

            _autoReturnRemaining -= Time.deltaTime;
            if (_autoReturnRemaining <= 0f)
            {
                ReturnToMainMap();
            }
        }

        /// <summary>
        /// Displays the result. `outcome` is this client's own outcome
        /// ("win" | "loss" | "draw" | "pending_review"), matching exactly
        /// what BattleManager derived. `resolveData` is null when the
        /// resolve call itself failed (e.g. network failure) — in that
        /// case the outcome is shown as unknown rather than guessed, since
        /// only the server's response is authoritative for the actual
        /// Influence change. `pending_review` is different from a network
        /// failure — the server DID accept the result, but Alpha security
        /// mode is holding it for review (see this class's header doc
        /// comment) — so it gets its own message even though it reuses
        /// the same panel.
        /// </summary>
        public void ShowResult(string outcome, BattleResolveResponseData resolveData)
        {
            SetAllPanelsInactive();

            if (resolveData == null)
            {
                if (unknownResultPanel != null)
                {
                    unknownResultPanel.SetActive(true);
                }

                if (influenceChangeLabel != null)
                {
                    influenceChangeLabel.text = "تعذّر تأكيد نتيجة المعركة من الخادم.";
                }

                _autoReturnRemaining = autoReturnSeconds;
                return;
            }

            if (outcome == "pending_review")
            {
                // No Influence or Control was granted — PlayerSession is
                // intentionally left untouched, exactly like a Draw.
                if (unknownResultPanel != null)
                {
                    unknownResultPanel.SetActive(true);
                }

                if (influenceChangeLabel != null)
                {
                    influenceChangeLabel.text = "نتيجة هذه المعركة قيد المراجعة الأمنية — لم يُمنح أي تغيير في النفوذ بعد.";
                }

                _autoReturnRemaining = autoReturnSeconds;
                return;
            }

            // Sprint 7 continuation — Result screen rank transition:
            // captured BEFORE folding the server's new rank into
            // PlayerSession, so this is genuinely "previous vs new", not
            // comparing a value against itself.
            var previousRank = PlayerSession.HasActiveSession ? PlayerSession.Current.Rank : null;

            ApplyResultToPlayerSession(outcome, resolveData);

            UpdateRankTransitionLabel(previousRank, outcome, resolveData);

            switch (outcome)
            {
                case "win":
                    if (victoryPanel != null)
                    {
                        victoryPanel.SetActive(true);
                    }

                    if (influenceChangeLabel != null)
                    {
                        influenceChangeLabel.text = $"+{Mathf.Abs(Constants.Influence.WinDelta)} Influence";
                    }
                    break;

                case "draw":
                    // GDD: a Draw changes no Influence and creates no
                    // Control state — shown with its own panel (falling
                    // back to the unknown-result panel if none is
                    // assigned in the scene) rather than being folded
                    // into either Victory or Defeat.
                    if (drawPanel != null)
                    {
                        drawPanel.SetActive(true);
                    }
                    else if (unknownResultPanel != null)
                    {
                        unknownResultPanel.SetActive(true);
                    }

                    if (influenceChangeLabel != null)
                    {
                        influenceChangeLabel.text = "0 Influence";
                    }
                    break;

                default: // "loss"
                    if (defeatPanel != null)
                    {
                        defeatPanel.SetActive(true);
                    }

                    if (influenceChangeLabel != null)
                    {
                        influenceChangeLabel.text = $"{Constants.Influence.LossDelta} Influence";
                    }
                    break;
            }

            _autoReturnRemaining = autoReturnSeconds;
        }

        /// <summary>
        /// Folds the server's authoritative Influence/Controlled result
        /// back into PlayerSession for the local player only — the
        /// opponent's session state is not this client's concern. A Draw
        /// changes neither field, so PlayerSession is left untouched
        /// entirely in that case (resolveData's influence/control fields
        /// are null/default for a draw — see BattleResolveResponseData's
        /// doc comment).
        /// </summary>
        private void ApplyResultToPlayerSession(string outcome, BattleResolveResponseData resolveData)
        {
            if (!PlayerSession.HasActiveSession || outcome == "draw" || outcome == "pending_review")
            {
                return;
            }

            var localPlayerWon = outcome == "win";
            var current = PlayerSession.Current;
            var rankFromServer = localPlayerWon ? resolveData.winner_rank : resolveData.loser_rank;
            var updated = new PlayerSessionData
            {
                PlayerId = current.PlayerId,
                Username = current.Username,
                ClassType = current.ClassType,
                Health = current.Health,
                MaxHealth = current.MaxHealth,
                Energy = current.Energy,
                MaxEnergy = current.MaxEnergy,
                Influence = localPlayerWon ? resolveData.winner_influence : resolveData.loser_influence,
                Level = current.Level,
                Experience = current.Experience,
                // Sprint 7 (Influence + Control): the server now recomputes
                // Rank in the same write as the Influence change (see
                // config/rankTiers.js) and returns it here — fall back to
                // the previous cached Rank only if the field somehow came
                // back empty (e.g. an older server build), rather than
                // silently keeping a stale Rank string forever.
                Rank = string.IsNullOrEmpty(rankFromServer) ? current.Rank : rankFromServer,
                IsControlled = !localPlayerWon,
                // Sprint 7 continuation — applyIncomingControl always
                // overwrites the loser's ControllerId to the winner and
                // clears any Protection the loser might have had (a
                // freshly-captured player is, by definition, not
                // Protected) — mirrored here so PlayerSession doesn't hold
                // a stale ControllerId/IsProtected value between now and
                // the next full /auth/me refresh. resolveData carries no
                // winner_id field, so the winner's id is derived from the
                // absolute (not caller-relative) resolveData.result string
                // against BattleSession's own attacker_id/defender_id.
                ControllerId = localPlayerWon ? current.ControllerId : ResolveWinnerId(resolveData.result),
                ControlledUntilIso = localPlayerWon ? current.ControlledUntilIso : resolveData.loser_controlled_until,
                IsProtected = localPlayerWon && current.IsProtected,
                ProtectedUntilIso = localPlayerWon ? current.ProtectedUntilIso : null,
                Credits = current.Credits,
            };

            PlayerSession.UpdateFromServer(updated);
        }

        /// <summary>
        /// Sprint 7 continuation — "Result screen rank transition." Shows
        /// nothing for a Draw/pending_review (no rank change is possible —
        /// PlayerSession's rank is left untouched for both) or when the
        /// server-reported rank simply didn't move this battle (most
        /// battles don't cross a tier boundary). RankCalculator.TierIndex
        /// is used only to classify the direction (promotion vs demotion)
        /// for the display string — the actual new rank always comes from
        /// the server's own winner_rank/loser_rank, never recomputed
        /// client-side.
        /// </summary>
        private void UpdateRankTransitionLabel(string previousRank, string outcome, BattleResolveResponseData resolveData)
        {
            if (rankTransitionLabel == null)
            {
                return;
            }

            if (outcome != "win" && outcome != "loss")
            {
                rankTransitionLabel.gameObject.SetActive(false);
                return;
            }

            var newRank = outcome == "win" ? resolveData.winner_rank : resolveData.loser_rank;
            if (string.IsNullOrEmpty(newRank) || string.IsNullOrEmpty(previousRank) || newRank == previousRank)
            {
                rankTransitionLabel.gameObject.SetActive(false);
                return;
            }

            var isPromotion = RankCalculator.TierIndex(newRank) > RankCalculator.TierIndex(previousRank);
            rankTransitionLabel.gameObject.SetActive(true);
            rankTransitionLabel.text = isPromotion
                ? $"ترقية! {previousRank} → {newRank}"
                : $"تخفيض الرتبة: {previousRank} → {newRank}";
        }

        /// <summary>Resolves the winner's player_id from the absolute
        /// resolveData.result ('attacker_win' | 'defender_win') against
        /// this battle's own attacker_id/defender_id — resolveData itself
        /// carries no winner_id field. Returns null for a value this
        /// method doesn't recognize (e.g. called for a 'draw', which never
        /// reaches this code path) rather than guessing.</summary>
        private static string ResolveWinnerId(string absoluteResult)
        {
            if (!BattleSession.HasActiveSession)
            {
                return null;
            }

            var battle = BattleSession.Current;
            if (absoluteResult == "attacker_win") return battle.attacker_id;
            if (absoluteResult == "defender_win") return battle.defender_id;
            return null;
        }

        private void SetAllPanelsInactive()
        {
            if (victoryPanel != null) victoryPanel.SetActive(false);
            if (defeatPanel != null) defeatPanel.SetActive(false);
            if (drawPanel != null) drawPanel.SetActive(false);
            if (unknownResultPanel != null) unknownResultPanel.SetActive(false);
            if (rankTransitionLabel != null) rankTransitionLabel.gameObject.SetActive(false);
        }

        /// <summary>Match Flow's final step: Return To MainMap. Also clears
        /// the now-finished BattleSession so a stale session can't leak
        /// into the next challenge.</summary>
        private void ReturnToMainMap()
        {
            if (_returnTriggered)
            {
                return;
            }

            _returnTriggered = true;
            BattleSession.Clear();
            // Sprint 7 continuation — MainMap refresh after battle
            // resolution: see MainMapRefreshRequest's doc comment.
            MainMapRefreshRequest.RequestImmediateRefresh();
            SceneLoader.Load(Constants.Scenes.MainMap);
        }
    }
}
