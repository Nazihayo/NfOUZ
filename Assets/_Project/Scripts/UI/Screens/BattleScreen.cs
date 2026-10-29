using Nfouz.Combat;
using Nfouz.Networking;
using Nfouz.Utils;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.UI.Screens
{
    /// <summary>
    /// Sprint 10 — Battle screen HUD: Health, Energy, Cooldowns, Match
    /// Timer, Overtime State. Draw/PendingReview are NOT live in-battle
    /// states — they are terminal OUTCOMES only known once the match ends,
    /// and are already fully displayed by the existing, approved
    /// ResultController (Combat/ResultController.cs — its drawPanel /
    /// unknownResultPanel with the "pending_review" message). This screen
    /// therefore only surfaces what is genuinely live during a match:
    /// Health/Energy/Cooldown-readiness/Match-Timer/Overtime.
    ///
    /// Cooldowns are shown as ready/not-ready (PlayerCombat.IsBasicAttackReady/
    /// IsSpecialReady/IsDodgeReady/IsClassAbilityReady — all already public)
    /// rather than a numeric countdown: PlayerCombat's actual remaining-time
    /// fields are private, and this sprint's "do not modify existing
    /// approved scripts' behavior" constraint is read here as also meaning
    /// "avoid touching Combat's own gameplay class beyond what's strictly
    /// unavoidable" — see BattleManager.cs's own additive-only exception
    /// (documented there and in the sprint report) for the one case where a
    /// read-only accessor genuinely could not be avoided (the match timer,
    /// which has no boolean substitute).
    ///
    /// Build Recovery (HANDOFF item 35): the four readiness icons double as
    /// the action buttons. A tap only records the press
    /// (CombatActionLatch.Local); NetworkInputData carries it to the Photon
    /// host, which runs the action (BattleManager.HandleCombatActions). This
    /// screen also drives the phone's movement stick (TouchStick) every
    /// frame. In the Editor: Space attack, E special, Left Shift dodge,
    /// Q class ability.
    /// </summary>
    [RequireComponent(typeof(BattleManager))]
    public class BattleScreen : MonoBehaviour
    {
        [Header("Wiring")]
        [SerializeField] private HUDController hud;

        [Header("Match timer")]
        [SerializeField] private TMP_Text matchTimerLabel;
        [SerializeField] private Slider matchTimerSlider;
        [SerializeField] private GameObject overtimeBanner;

        [Header("Cooldown readiness")]
        [SerializeField] private GameObject basicAttackReadyIcon;
        [SerializeField] private GameObject specialReadyIcon;
        [SerializeField] private GameObject dodgeReadyIcon;
        [SerializeField] private GameObject classAbilityReadyIcon;

        private BattleManager _battleManager;
        private PlayerCombat _localPlayerCombat;

        private void Awake()
        {
            _battleManager = GetComponent<BattleManager>();

            AttachActionButton(basicAttackReadyIcon, CombatAction.BasicAttack);
            AttachActionButton(specialReadyIcon, CombatAction.Special);
            AttachActionButton(dodgeReadyIcon, CombatAction.Dodge);
            AttachActionButton(classAbilityReadyIcon, CombatAction.ClassAbility);
        }

        private void OnDisable()
        {
            TouchStick.Reset();
            CombatActionLatch.Local.Clear();
        }

        private void Update()
        {
            TouchStick.Tick();
            ReadEditorKeys();

            if (_localPlayerCombat == null)
            {
                // BattleManager only identifies the local combatant once the
                // Countdown state runs (see BattleManager.IdentifyCombatants) —
                // poll cheaply until it becomes available rather than
                // requiring an extra event on an approved script.
                _localPlayerCombat = _battleManager.LocalPlayerCombat;
                if (_localPlayerCombat != null && hud != null)
                {
                    hud.SetLocalPlayerCombat(_localPlayerCombat);
                }
            }

            RefreshMatchTimer();
            RefreshCooldowns();
        }

        private void RefreshMatchTimer()
        {
            var inOvertime = _battleManager.IsInOvertime;
            var remaining = inOvertime ? _battleManager.OvertimeTimeRemaining : _battleManager.MatchTimeRemaining;

            if (matchTimerLabel != null)
            {
                matchTimerLabel.text = Mathf.CeilToInt(Mathf.Max(0f, remaining)).ToString();
            }

            if (matchTimerSlider != null)
            {
                var total = inOvertime ? Constants.Combat.OvertimeSeconds : Constants.Battle.SessionMaxDurationSeconds;
                matchTimerSlider.value = total > 0f ? Mathf.Clamp01(remaining / total) : 0f;
            }

            if (overtimeBanner != null)
            {
                overtimeBanner.SetActive(inOvertime);
            }
        }

        private void RefreshCooldowns()
        {
            if (_localPlayerCombat == null)
            {
                return;
            }

            SetReady(basicAttackReadyIcon, _localPlayerCombat.IsBasicAttackReady);
            SetReady(specialReadyIcon, _localPlayerCombat.IsSpecialReady);
            SetReady(dodgeReadyIcon, _localPlayerCombat.IsDodgeReady);
            SetReady(classAbilityReadyIcon, _localPlayerCombat.IsClassAbilityReady);
        }

        /// <summary>The icon's Image is already a raycast target; a Button on
        /// it turns a tap into a press.</summary>
        private static void AttachActionButton(GameObject icon, CombatAction action)
        {
            if (icon == null)
            {
                return;
            }

            var button = icon.GetComponent<Button>();
            if (button == null)
            {
                button = icon.AddComponent<Button>();
            }

            button.onClick.AddListener(() => CombatActionLatch.Local.Press(action));
        }

        private static void ReadEditorKeys()
        {
            if (Input.GetKeyDown(KeyCode.Space))
            {
                CombatActionLatch.Local.Press(CombatAction.BasicAttack);
            }

            if (Input.GetKeyDown(KeyCode.E))
            {
                CombatActionLatch.Local.Press(CombatAction.Special);
            }

            if (Input.GetKeyDown(KeyCode.LeftShift))
            {
                CombatActionLatch.Local.Press(CombatAction.Dodge);
            }

            if (Input.GetKeyDown(KeyCode.Q))
            {
                CombatActionLatch.Local.Press(CombatAction.ClassAbility);
            }
        }

        private static void SetReady(GameObject icon, bool isReady)
        {
            if (icon != null)
            {
                icon.SetActive(isReady);
            }
        }
    }
}
