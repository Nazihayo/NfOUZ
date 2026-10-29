using System;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Networking;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Combat
{
    /// <summary>
    /// Match Flow orchestrator: Ready -> Countdown -> Battle -> Death OR
    /// Time End -> Winner Calculation -> Result Screen -> Return To
    /// MainMap. Owns the match timer, death/timeout detection, winner
    /// determination, the backend resolve call, and handing off to
    /// ResultController. Drives off CombatStateMachine's state changes
    /// rather than modifying BattleLoadingController.cs (Sprint 5).
    ///
    /// Sprint 6 final security correction: the backend no longer accepts
    /// a bare claimed outcome from either client — it requires a signed
    /// BattleResultPayload (see BattleResultSignature.cs and
    /// battle.service.js's header doc comment). Only the Photon Host Mode
    /// host — the attacker's client, by convention, since it always
    /// creates the Photon room — ever holds the signing secret
    /// (host_authority_secret/match_nonce, received once on the
    /// challenge response) and is the one that actually calls
    /// POST /battle/{battleId}/resolve. The non-host client instead polls
    /// GET /battle/{battleId} until the host's submission lands, then
    /// refreshes its own profile via /auth/me for the authoritative
    /// Influence/Controlled outcome (the resolve response's influence
    /// fields are only ever returned to whichever client submitted the
    /// result). This is still Host Mode Alpha's LIMITED anti-cheat: the
    /// signature proves the result came from the real host and wasn't
    /// forged by the other client, not that the host's own health/damage
    /// arithmetic was honest — never claimed as full server authority.
    ///
    /// ALPHA SECURITY MODE (Sprint 6 final gameplay-completion pass): a
    /// host-signed submission is PROVISIONAL, not a guarantee. The backend
    /// re-validates sequence, duration, health bounds and consistency and
    /// can mark a submission `pending_review` instead of granting it —
    /// see battle.service.js's evaluateSuspicion. A pending_review result
    /// grants NO Influence or Control on either client; ShowResult/
    /// ResultController surface it as a distinct "under review" state,
    /// never as a win, loss, or draw. A Dedicated Server (real server-run
    /// combat simulation) remains required before this game can call
    /// itself server-authoritative or ship a competitive public release.
    /// This class never logs, prints, or otherwise surfaces
    /// host_authority_secret anywhere — it is read once from
    /// BattleSession.Current to sign a result and never touched again.
    /// </summary>
    [RequireComponent(typeof(CombatStateMachine))]
    public class BattleManager : MonoBehaviour
    {
        [Header("Scene refs")]
        [SerializeField] private Transform attackerSpawnPoint;
        [SerializeField] private Transform defenderSpawnPoint;
        [SerializeField] private ResultController resultController;
        [SerializeField] private WeaponDatabase weaponDatabase;

        private CombatStateMachine _stateMachine;
        private ApiClient _apiClient;

        private PlayerCombat _attackerCombat;
        private PlayerCombat _defenderCombat;

        private float _matchTimeRemaining;
        private float _overtimeTimeRemaining;
        private bool _inOvertime;
        private bool _matchEndHandled;
        private bool _bothCombatantsIdentified;
        private float _identifyRetryTimer;
        private const float IdentifyRetryIntervalSeconds = 0.5f;

        /// <summary>
        /// Sprint 10 — Full UI Integration. Read-only accessors added so
        /// BattleScreen.cs can display the live Match Timer / Overtime
        /// state / local combatant without re-deriving any match logic
        /// itself. Additive only: no existing field, method body, or
        /// behavior above is changed — these simply expose values this
        /// class already computed for its own private use.
        /// </summary>
        public float MatchTimeRemaining => _matchTimeRemaining;
        public float OvertimeTimeRemaining => _overtimeTimeRemaining;
        public bool IsInOvertime => _inOvertime;

        /// <summary>The LOCAL player's own PlayerCombat instance for this
        /// match, or null before IdentifyCombatants has run (Countdown
        /// state) or if no session/battle session is active. Uses the same
        /// attacker/defender-id comparison IsLocalHost already performs.</summary>
        public PlayerCombat LocalPlayerCombat
        {
            get
            {
                if (!PlayerSession.HasActiveSession || !BattleSession.HasActiveSession)
                {
                    return null;
                }

                return BattleSession.Current.attacker_id == PlayerSession.Current.PlayerId
                    ? _attackerCombat
                    : _defenderCombat;
            }
        }

        /// <summary>Monotonic event sequence for this match's signed result.
        /// Host Mode Alpha submits exactly one result per match, so a
        /// constant starting value above the server's default of 0 is
        /// sufficient — this is not a full per-action event feed.</summary>
        private const int MatchResultEventSeq = 1;

        /// <summary>How long the non-host client waits for the host to
        /// submit the signed result before giving up and showing an
        /// unknown-result screen.</summary>
        // The host may still play the 30 s Overtime after this client's timer
        // ends (the countdowns can start up to one ready poll apart).
        private const float ResolutionPollTimeoutSeconds = 20f + Constants.Combat.OvertimeSeconds;
        private const float ResolutionPollIntervalSeconds = 1.5f;

        private void Awake()
        {
            _stateMachine = GetComponent<CombatStateMachine>();
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();
        }

        private void OnEnable()
        {
            _stateMachine.OnStateChanged += HandleStateChanged;
        }

        private void OnDisable()
        {
            _stateMachine.OnStateChanged -= HandleStateChanged;
            UnsubscribeCombatants();
        }

        private void Update()
        {
            if (_matchEndHandled)
            {
                return;
            }

            switch (_stateMachine.CurrentState)
            {
                case CombatStateMachine.MatchState.Countdown:
                    // A client's replicated avatars may arrive after the
                    // countdown started: keep looking until both exist.
                    _identifyRetryTimer -= Time.deltaTime;
                    if ((_attackerCombat == null || _defenderCombat == null) && _identifyRetryTimer <= 0f)
                    {
                        _identifyRetryTimer = IdentifyRetryIntervalSeconds;
                        UnsubscribeCombatants();
                        IdentifyCombatants();
                    }
                    break;

                case CombatStateMachine.MatchState.Battle:
                    if (CheckDeathReportedByHost() || CheckCombatantLost())
                    {
                        return;
                    }

                    _matchTimeRemaining -= Time.deltaTime;
                    if (_matchTimeRemaining <= 0f)
                    {
                        HandleBattleTimeEnd();
                    }
                    break;

                case CombatStateMachine.MatchState.Overtime:
                    if (CheckDeathReportedByHost() || CheckCombatantLost())
                    {
                        return;
                    }

                    _overtimeTimeRemaining -= Time.deltaTime;
                    if (_overtimeTimeRemaining <= 0f)
                    {
                        HandleOvertimeTimeEnd();
                    }
                    break;
            }
        }

        private void HandleStateChanged(CombatStateMachine.MatchState state)
        {
            switch (state)
            {
                case CombatStateMachine.MatchState.Countdown:
                    // Identify + seed combat data for both participants as
                    // close to spawn time as possible (see IdentifyCombatants'
                    // doc comment for why this is spawn-point-proximity based
                    // rather than a true network-authority id in stub mode).
                    IdentifyCombatants();
                    break;

                case CombatStateMachine.MatchState.Battle:
                    // Buttons tapped during the countdown do not fire at "go".
                    CombatActionLatch.Local.Clear();
                    _matchTimeRemaining = Constants.Battle.SessionMaxDurationSeconds;
                    _inOvertime = false;
                    _matchEndHandled = false;
                    break;

                case CombatStateMachine.MatchState.Overtime:
                    // GDD: a 30s Overtime window when the 90s timeout's
                    // Health-percentage comparison is too close to call —
                    // energy regeneration is disabled for its duration.
                    _overtimeTimeRemaining = Constants.Combat.OvertimeSeconds;
                    _inOvertime = true;
                    SetEnergyRegenEnabled(false);
                    break;
            }
        }

        private void SetEnergyRegenEnabled(bool enabled)
        {
            if (_attackerCombat != null)
            {
                _attackerCombat.EnergyRegenEnabled = enabled;
            }

            if (_defenderCombat != null)
            {
                _defenderCombat.EnergyRegenEnabled = enabled;
            }
        }

        /// <summary>
        /// Finds the two spawned PlayerCombat instances, identifies
        /// which is the attacker's and which is the defender's, then Initializes each from
        /// server-authoritative data (BattleSession.Current for ids,
        /// PlayerSession.Current for the local player's own class/weapon/
        /// max stats where available).
        ///
        /// With the real Fusion SDK each avatar is identified by its input
        /// authority (TryIdentifyByAuthority). In stub mode, where that does
        /// not exist, spawn-point proximity at Countdown time (immediately
        /// after NetworkPlayerSpawner places each avatar exactly at its spawn
        /// point) remains the stand-in (IdentifyBySpawnPoints).
        /// </summary>
        private void IdentifyCombatants()
        {
            var allCombatants = FindObjectsOfType<PlayerCombat>();
            if (allCombatants.Length == 0)
            {
                Debug.LogWarning("[BattleManager] No PlayerCombat instances found at Countdown — " +
                                  "NetworkPlayerPrefab may be missing the PlayerCombat component, " +
                                  "or only the local avatar has spawned so far (expected in stub mode " +
                                  "without a live Photon connection).");
                return;
            }

            if (!TryIdentifyByAuthority(allCombatants, out var attacker, out var defender))
            {
                IdentifyBySpawnPoints(allCombatants, out attacker, out defender);
            }

            _attackerCombat = attacker;
            _defenderCombat = defender;
            _bothCombatantsIdentified = _attackerCombat != null && _defenderCombat != null;

            InitializeCombatant(_attackerCombat, isAttacker: true);
            InitializeCombatant(_defenderCombat, isAttacker: false);

            if (_attackerCombat != null)
            {
                _attackerCombat.OnDeath += HandleAttackerDeath;
                SubscribeActions(_attackerCombat);
            }

            if (_defenderCombat != null)
            {
                _defenderCombat.OnDeath += HandleDefenderDeath;
                SubscribeActions(_defenderCombat);
            }
        }

        /// <summary>
        /// With the real Fusion SDK: the host is the attacker (it creates the
        /// Photon room), so on every machine the attacker's avatar is the one
        /// whose "is it mine?" answer equals "am I the host?". False when
        /// that is unknown for any avatar (stub mode, not spawned yet).
        /// </summary>
        private static bool TryIdentifyByAuthority(PlayerCombat[] combatants,
            out PlayerCombat attacker, out PlayerCombat defender)
        {
            attacker = null;
            defender = null;
            foreach (var combatant in combatants)
            {
                var controller = combatant.GetComponent<NetworkPlayerController>();
                var isLocal = controller != null ? controller.IsLocalPlayer : null;
                var onHost = controller != null ? controller.IsOnHostMachine : null;
                if (!isLocal.HasValue || !onHost.HasValue)
                {
                    return false;
                }

                if (isLocal.Value == onHost.Value)
                {
                    attacker = combatant;
                }
                else
                {
                    defender = combatant;
                }
            }

            return attacker != null || defender != null;
        }

        /// <summary>Stub-mode stand-in (no input authority): the avatar
        /// nearest each spawn point, placed there at spawn by
        /// NetworkPlayerSpawner.</summary>
        private void IdentifyBySpawnPoints(PlayerCombat[] allCombatants,
            out PlayerCombat attacker, out PlayerCombat defender)
        {
            PlayerCombat nearestToAttacker = null;
            PlayerCombat nearestToDefender = null;
            var nearestToAttackerDist = float.MaxValue;
            var nearestToDefenderDist = float.MaxValue;

            foreach (var combatant in allCombatants)
            {
                if (attackerSpawnPoint != null)
                {
                    var dA = Vector3.Distance(combatant.transform.position, attackerSpawnPoint.position);
                    if (dA < nearestToAttackerDist)
                    {
                        nearestToAttackerDist = dA;
                        nearestToAttacker = combatant;
                    }
                }

                if (defenderSpawnPoint != null)
                {
                    var dD = Vector3.Distance(combatant.transform.position, defenderSpawnPoint.position);
                    if (dD < nearestToDefenderDist)
                    {
                        nearestToDefenderDist = dD;
                        nearestToDefender = combatant;
                    }
                }
            }

            attacker = nearestToAttacker;
            defender = nearestToDefender;
        }

        private void SubscribeActions(PlayerCombat combat)
        {
            var controller = combat.GetComponent<NetworkPlayerController>();
            if (controller != null)
            {
                controller.CombatActionsPressed -= HandleCombatActions;
                controller.CombatActionsPressed += HandleCombatActions;
            }
        }

        private void UnsubscribeActions(PlayerCombat combat)
        {
            var controller = combat != null ? combat.GetComponent<NetworkPlayerController>() : null;
            if (controller != null)
            {
                controller.CombatActionsPressed -= HandleCombatActions;
            }
        }

        /// <summary>
        /// Host only (NetworkPlayerController raises the event on the Photon
        /// host): runs the approved Sprint 6 actions a player pressed, against
        /// the other combatant, during Battle and Overtime only. PlayerCombat
        /// itself validates range, energy, cooldowns and locks, so a rejected
        /// press changes nothing. Dodge and the class ability go first, so a
        /// dodge pressed in the same tick as an attack is not blocked by it.
        /// </summary>
        private void HandleCombatActions(NetworkPlayerController source, CombatAction pressed)
        {
            if (_matchEndHandled || source == null)
            {
                return;
            }

            var state = _stateMachine.CurrentState;
            if (state != CombatStateMachine.MatchState.Battle && state != CombatStateMachine.MatchState.Overtime)
            {
                return;
            }

            PlayerCombat actor;
            PlayerCombat target;
            if (_attackerCombat != null && _attackerCombat.gameObject == source.gameObject)
            {
                actor = _attackerCombat;
                target = _defenderCombat;
            }
            else if (_defenderCombat != null && _defenderCombat.gameObject == source.gameObject)
            {
                actor = _defenderCombat;
                target = _attackerCombat;
            }
            else
            {
                return;
            }

            if (actor.IsDead)
            {
                return;
            }

            if ((pressed & CombatAction.Dodge) != 0)
            {
                actor.TryDodge();
            }

            if ((pressed & CombatAction.ClassAbility) != 0)
            {
                actor.TryClassAbility();
            }

            if (target != null && (pressed & CombatAction.BasicAttack) != 0)
            {
                actor.BasicAttack(target);
            }

            if (target != null && !_matchEndHandled && (pressed & CombatAction.Special) != 0)
            {
                actor.TrySpecial(target);
            }

            // Dodge, Blink Step, Shadow Lunge and knockback move transforms
            // directly; make that the networked position of both avatars.
            AdoptPosition(actor);
            AdoptPosition(target);
        }

        private static void AdoptPosition(PlayerCombat combat)
        {
            var controller = combat != null ? combat.GetComponent<NetworkPlayerController>() : null;
            if (controller != null)
            {
                controller.AdoptTransformPosition();
            }
        }

        private void InitializeCombatant(PlayerCombat combat, bool isAttacker)
        {
            if (combat == null)
            {
                return;
            }

            // The local player's own class/max health/max energy are known
            // precisely from PlayerSession; for the opponent (no server
            // endpoint yet returns their full stats to this client) we
            // fall back to the same class-driven base stats used at
            // registration time (GDD v1.0 section 3.3), matched via the
            // NetworkPlayerController's already-networked NetworkedClass.
            var networkController = combat.GetComponent<NetworkPlayerController>();
            var classType = networkController != null ? networkController.NetworkedClass.ToString() : Constants.PlayerClass.Scout;

            int maxHealth;
            int maxEnergy;
            var isLocalPlayer = PlayerSession.HasActiveSession &&
                                 BattleSession.HasActiveSession &&
                                 ((isAttacker && BattleSession.Current.attacker_id == PlayerSession.Current.PlayerId) ||
                                  (!isAttacker && BattleSession.Current.defender_id == PlayerSession.Current.PlayerId));

            if (isLocalPlayer)
            {
                classType = PlayerSession.Current.ClassType;
                maxHealth = PlayerSession.Current.MaxHealth;
                maxEnergy = PlayerSession.Current.MaxEnergy;
            }
            else
            {
                GetClassBaseStats(classType, out maxHealth, out maxEnergy);
            }

            // Weapon: PlayerSession does not yet carry an equipped-weapon
            // field (Inventory/equip-loadout wiring is a later system) —
            // default every combatant to Pulse Blade, the baseline
            // approved weapon, until equip-loadout is implemented.
            var weaponStats = weaponDatabase != null
                ? weaponDatabase.GetStatsOrDefault(WeaponDatabase.PulseBlade)
                : WeaponDatabase.GetDefaultStats(WeaponDatabase.PulseBlade);

            combat.Initialize(classType, weaponStats, maxHealth, maxEnergy);
        }

        /// <summary>Base Health/Energy by class — GDD v1.0 section 3.3.</summary>
        private static void GetClassBaseStats(string classType, out int maxHealth, out int maxEnergy)
        {
            switch (classType)
            {
                case Constants.PlayerClass.Scout:
                    maxHealth = 80;
                    maxEnergy = 120;
                    break;
                case Constants.PlayerClass.Ranger:
                    maxHealth = 100;
                    maxEnergy = 100;
                    break;
                case Constants.PlayerClass.Titan:
                    maxHealth = 140;
                    maxEnergy = 80;
                    break;
                default:
                    maxHealth = 100;
                    maxEnergy = 100;
                    break;
            }
        }

        private void UnsubscribeCombatants()
        {
            if (_attackerCombat != null)
            {
                _attackerCombat.OnDeath -= HandleAttackerDeath;
                UnsubscribeActions(_attackerCombat);
            }

            if (_defenderCombat != null)
            {
                _defenderCombat.OnDeath -= HandleDefenderDeath;
                UnsubscribeActions(_defenderCombat);
            }
        }

        /// <summary>Photon client: combat runs on the host, so a death shows
        /// up here only as networked Health 0 (see
        /// NetworkPlayerController.IsKnockedOutOnRemoteHost). Ends the match
        /// like a local death; the non-host path then polls the server for
        /// the host's signed result, it never decides it.</summary>
        private bool CheckDeathReportedByHost()
        {
            if (IsKnockedOut(_attackerCombat))
            {
                HandleAttackerDeath();
                return true;
            }

            if (IsKnockedOut(_defenderCombat))
            {
                HandleDefenderDeath();
                return true;
            }

            return false;
        }

        /// <summary>An identified avatar was destroyed mid-match (its runner
        /// shut down): nothing can be judged here any more, so ask the server
        /// for its record instead of freezing at 0:00. Stub mode (one avatar)
        /// never sets _bothCombatantsIdentified.</summary>
        private bool CheckCombatantLost()
        {
            if (!_bothCombatantsIdentified || (_attackerCombat != null && _defenderCombat != null))
            {
                return false;
            }

            Debug.LogWarning("[BattleManager] A combatant's avatar disappeared mid-match; waiting for the server's record.");
            _matchEndHandled = true;
            _stateMachine.EndMatch();
            _ = PollForResolutionAsync();
            return true;
        }

        private static bool IsKnockedOut(PlayerCombat combat)
        {
            var controller = combat != null ? combat.GetComponent<NetworkPlayerController>() : null;
            return controller != null && controller.IsKnockedOutOnRemoteHost;
        }

        private void HandleAttackerDeath() => HandleDeath(loser: _attackerCombat, winner: _defenderCombat);
        private void HandleDefenderDeath() => HandleDeath(loser: _defenderCombat, winner: _attackerCombat);

        /// <summary>Death Detection + immediate Match Winner Detection —
        /// Battle System v1.0 section 2: "عند Health = 0 لأحد اللاعبين ->
        /// نهاية فورية".</summary>
        private void HandleDeath(PlayerCombat loser, PlayerCombat winner)
        {
            if (_matchEndHandled || winner == null || loser == null)
            {
                return;
            }

            CompleteMatch(winner, loser);
        }

        /// <summary>
        /// The three-way outcome of comparing the two combatants' Health
        /// percentages — used both at the 90s Battle timeout (TooClose
        /// there means "enter Overtime") and again at the 30s Overtime
        /// timeout (TooClose there means "Draw"). Extracted as a pure,
        /// testable static method — see CompareHealthPercentages.
        /// </summary>
        public enum HealthComparisonResult
        {
            AttackerWins,
            DefenderWins,
            TooClose,
        }

        /// <summary>
        /// Pure, testable form of the GDD's Health-percentage comparison:
        /// a difference greater than Constants.Combat.DrawThresholdPercent
        /// (1 percentage point) decides the winner outright; otherwise the
        /// result is TooClose (the caller decides what that means — enter
        /// Overtime the first time, Draw the second). This replaces the
        /// old ShouldDefenderWinOnTimeout method and its "attacker always
        /// wins ties" rule entirely, per the Sprint 6 correction pass.
        /// </summary>
        public static HealthComparisonResult CompareHealthPercentages(float attackerHealthPercent, float defenderHealthPercent)
        {
            var diff = Mathf.Abs(attackerHealthPercent - defenderHealthPercent);
            if (diff > Constants.Combat.DrawThresholdPercent)
            {
                return attackerHealthPercent > defenderHealthPercent
                    ? HealthComparisonResult.AttackerWins
                    : HealthComparisonResult.DefenderWins;
            }

            return HealthComparisonResult.TooClose;
        }

        private (float attackerPercent, float defenderPercent) GetHealthPercentages()
        {
            var attackerHealth = _attackerCombat.GetComponent<NetworkPlayerController>().NetworkedHealth;
            var defenderHealth = _defenderCombat.GetComponent<NetworkPlayerController>().NetworkedHealth;

            var attackerPercent = _attackerCombat.MaxHealth > 0 ? attackerHealth / (float)_attackerCombat.MaxHealth * 100f : 0f;
            var defenderPercent = _defenderCombat.MaxHealth > 0 ? defenderHealth / (float)_defenderCombat.MaxHealth * 100f : 0f;

            return (attackerPercent, defenderPercent);
        }

        /// <summary>Battle System's 90s timeout — GDD (latest detailed
        /// version): compare remaining Health percentage; a difference
        /// greater than 1 percentage point decides the winner, otherwise
        /// enter the 30s Overtime window rather than deciding immediately.</summary>
        private void HandleBattleTimeEnd()
        {
            if (_matchEndHandled || _attackerCombat == null || _defenderCombat == null)
            {
                return;
            }

            var (attackerPercent, defenderPercent) = GetHealthPercentages();
            var comparison = CompareHealthPercentages(attackerPercent, defenderPercent);

            if (comparison == HealthComparisonResult.TooClose)
            {
                _stateMachine.EnterOvertime();
                return;
            }

            var attackerWins = comparison == HealthComparisonResult.AttackerWins;
            CompleteMatch(
                winner: attackerWins ? _attackerCombat : _defenderCombat,
                loser: attackerWins ? _defenderCombat : _attackerCombat);
        }

        /// <summary>End of the 30s Overtime window — GDD: apply the same
        /// Health-percentage comparison again; if still within 1
        /// percentage point, the match is a Draw.</summary>
        private void HandleOvertimeTimeEnd()
        {
            if (_matchEndHandled || _attackerCombat == null || _defenderCombat == null)
            {
                return;
            }

            var (attackerPercent, defenderPercent) = GetHealthPercentages();
            var comparison = CompareHealthPercentages(attackerPercent, defenderPercent);

            if (comparison == HealthComparisonResult.TooClose)
            {
                CompleteMatch(winner: null, loser: null); // Draw
                return;
            }

            var attackerWins = comparison == HealthComparisonResult.AttackerWins;
            CompleteMatch(
                winner: attackerWins ? _attackerCombat : _defenderCombat,
                loser: attackerWins ? _defenderCombat : _attackerCombat);
        }

        /// <summary>
        /// Ends the match. `winner`/`loser` are both null for a Draw.
        /// Sprint 6 final security correction: only the Photon Host Mode
        /// host (see class doc comment) builds and submits the signed
        /// result; the non-host client polls for it instead — see
        /// ResolveMatchAsync.
        /// </summary>
        private async void CompleteMatch(PlayerCombat winner, PlayerCombat loser)
        {
            _matchEndHandled = true;
            _stateMachine.EndMatch();
            SetEnergyRegenEnabled(true);

            string absoluteOutcome; // "attacker_win" | "defender_win" | "draw"
            if (winner == null || loser == null)
            {
                absoluteOutcome = "draw";
            }
            else
            {
                absoluteOutcome = winner == _attackerCombat ? "attacker_win" : "defender_win";
            }

            var battleElapsed = Constants.Battle.SessionMaxDurationSeconds - Mathf.Max(0f, _matchTimeRemaining);
            var overtimeElapsed = _inOvertime ? Constants.Combat.OvertimeSeconds - Mathf.Max(0f, _overtimeTimeRemaining) : 0f;
            var durationSeconds = Mathf.RoundToInt(battleElapsed + overtimeElapsed);

            await ResolveMatchAsync(absoluteOutcome, durationSeconds);
        }

        /// <summary>
        /// True only when this client is the attacker AND actually holds
        /// a host_authority_secret for this battle (received exclusively
        /// on this client's own POST /battle/challenge response — see
        /// BattleSessionData's doc comment). A defender never has a
        /// secret to sign with, so it is never treated as the host.
        /// </summary>
        private bool IsLocalHost()
        {
            return PlayerSession.HasActiveSession && BattleSession.HasActiveSession &&
                   BattleSession.Current.attacker_id == PlayerSession.Current.PlayerId &&
                   !string.IsNullOrEmpty(BattleSession.Current.host_authority_secret);
        }

        /// <summary>Converts the absolute outcome ("attacker_win" |
        /// "defender_win" | "draw") into this client's own perspective
        /// ("win" | "loss" | "draw") for ResultController, which shows a
        /// Victory/Defeat/Draw panel from the local player's point of
        /// view regardless of which side submitted the result.</summary>
        private string LocalOutcomeFor(string absoluteOutcome)
        {
            if (absoluteOutcome == "draw")
            {
                return "draw";
            }

            var attackerWon = absoluteOutcome == "attacker_win";
            var isLocalAttacker = PlayerSession.HasActiveSession && BattleSession.HasActiveSession &&
                                   BattleSession.Current.attacker_id == PlayerSession.Current.PlayerId;
            var localWon = isLocalAttacker ? attackerWon : !attackerWon;
            return localWon ? "win" : "loss";
        }

        /// <summary>
        /// Sprint 6 final security correction: the host signs and submits
        /// the authoritative result; the non-host polls for it. Neither
        /// path lets a client's own claim be trusted directly — the
        /// backend independently verifies the signature, participants,
        /// nonce, sequence and plausibility before applying any effect
        /// (see battle.service.js resolveBattle).
        /// </summary>
        private async Task ResolveMatchAsync(string absoluteOutcome, int durationSeconds)
        {
            if (_apiClient == null || !BattleSession.HasActiveSession)
            {
                Debug.LogError("[BattleManager] Cannot resolve match — missing ApiClient or active session.");
                ShowResult(LocalOutcomeFor(absoluteOutcome), null);
                return;
            }

            if (IsLocalHost())
            {
                await SubmitSignedResultAsync(absoluteOutcome, durationSeconds);
            }
            else
            {
                await PollForResolutionAsync();
            }
        }

        /// <summary>
        /// Host-only: builds the full BattleResultPayload, signs it with
        /// the host_authority_secret received on this client's own
        /// challenge response, and submits it to
        /// POST /battle/{battleId}/resolve. See BattleResultSignature.cs
        /// and this class's own header doc comment for what the signature
        /// does and does not prove.
        /// </summary>
        private async Task SubmitSignedResultAsync(string absoluteOutcome, int durationSeconds)
        {
            var attackerHealth = _attackerCombat != null
                ? _attackerCombat.GetComponent<NetworkPlayerController>().NetworkedHealth
                : 0;
            var defenderHealth = _defenderCombat != null
                ? _defenderCombat.GetComponent<NetworkPlayerController>().NetworkedHealth
                : 0;

            var result = new BattleResultPayload
            {
                battle_id = BattleSession.Current.battle_id,
                room_name = BattleSession.Current.photon_room_name,
                rules_version = BattleSession.Current.rules_version,
                match_nonce = BattleSession.Current.match_nonce,
                event_seq = MatchResultEventSeq,
                attacker_id = BattleSession.Current.attacker_id,
                defender_id = BattleSession.Current.defender_id,
                attacker_final_health = attackerHealth,
                defender_final_health = defenderHealth,
                outcome = absoluteOutcome,
                duration_seconds = durationSeconds,
                issued_at = BattleResultSignature.FormatIssuedAt(DateTime.UtcNow),
            };

            var signature = BattleResultSignature.Sign(result, BattleSession.Current.host_authority_secret);

            var payload = new BattleResolveRequestPayload
            {
                result = result,
                signature = signature,
            };

            var response = await _apiClient.PostAsync<BattleResolveResponseData>(
                $"/battle/{BattleSession.Current.battle_id}/resolve", payload);

            if (!response.success)
            {
                Debug.LogWarning($"[BattleManager] Signed battle resolve rejected: {response.error?.code} — {response.error?.message}");
                ShowResult(LocalOutcomeFor(absoluteOutcome), null);
                return;
            }

            // Alpha security mode: the server accepted the signature but
            // is holding this result for review — see this class's header
            // doc comment. "pending_review" is not attacker_win/
            // defender_win/draw, so it must never be run through
            // LocalOutcomeFor (which only knows those three).
            var displayOutcome = response.data.result == "pending_review"
                ? "pending_review"
                : LocalOutcomeFor(response.data.result);

            ShowResult(displayOutcome, response.data);
        }

        /// <summary>
        /// Non-host only: this client never holds a signing secret, so it
        /// cannot submit a result itself — it polls GET /battle/{battleId}
        /// until the host's signed submission has been accepted, then
        /// refreshes its own profile via /auth/me for the authoritative
        /// Influence/Controlled outcome (the resolve response's influence
        /// fields are only ever returned to whichever client actually
        /// submitted the result, i.e. the host).
        /// </summary>
        private async Task PollForResolutionAsync()
        {
            var waited = 0f;
            while (waited < ResolutionPollTimeoutSeconds)
            {
                var response = await _apiClient.GetAsync<BattleSessionData>($"/battle/{BattleSession.Current.battle_id}");
                var kind = response.success && response.data != null
                    ? BattleLifecycle.FromStatus(response.data.status)
                    : BattleEndKind.InProgress;
                if (kind == BattleEndKind.EndedWithoutResult || (!response.success && BattleLifecycle.IsBattleGone(response.error)))
                {
                    // Forfeited, cancelled by the server's lifecycle cleanup, or
                    // gone: there is no result to show — never present it as a
                    // draw. The unknown-result panel returns to MainMap.
                    Debug.LogWarning($"[BattleManager] Battle ended without a result ({response.data?.status ?? response.error?.code}).");
                    ShowResult("draw", null); // resolveData == null shows the unknown-result panel regardless of the outcome argument
                    return;
                }
                if (kind == BattleEndKind.Resolved || kind == BattleEndKind.PendingReview)
                {
                    await HandleResolvedFromPollAsync(response.data);
                    return;
                }

                await Task.Delay(TimeSpan.FromSeconds(ResolutionPollIntervalSeconds));
                waited += ResolutionPollIntervalSeconds;
            }

            Debug.LogWarning("[BattleManager] Timed out waiting for the host to submit the signed battle result.");
            ShowResult("draw", null); // resolveData == null shows the unknown-result panel regardless of the outcome argument
        }

        /// <summary>Derives this client's own outcome from the now-resolved
        /// BattleSessionData, refreshes PlayerSession from /auth/me (the
        /// authoritative source for this client's own Influence/Controlled
        /// state), and shows the result screen.</summary>
        private async Task HandleResolvedFromPollAsync(BattleSessionData resolved)
        {
            string outcome;
            if (resolved.status == "pending_review")
            {
                // Alpha security mode: the host's submission was accepted
                // but is held for review — winner_id/loser_id may still be
                // recorded for that review, but they must NOT be read as
                // an actual win/loss here, and no Influence/Control was
                // granted on either side (see this class's header doc
                // comment and battle.service.js's evaluateSuspicion).
                outcome = "pending_review";
            }
            else if (string.IsNullOrEmpty(resolved.winner_id) && string.IsNullOrEmpty(resolved.loser_id))
            {
                outcome = "draw";
            }
            else
            {
                var isLocalWinner = PlayerSession.HasActiveSession && resolved.winner_id == PlayerSession.Current.PlayerId;
                outcome = isLocalWinner ? "win" : "loss";
            }

            var meResponse = await _apiClient.GetAsync<PlayerSessionData>("/auth/me");
            if (meResponse.success && meResponse.data != null)
            {
                PlayerSession.UpdateFromServer(meResponse.data);
            }
            else
            {
                Debug.LogWarning("[BattleManager] Could not refresh /auth/me after a non-host resolution — Influence/Controlled state may be stale.");
            }

            // ResultController.ApplyResultToPlayerSession only ever reads
            // the ONE field that matches this client's own outcome
            // (winner_influence if it won, loser_influence if it lost),
            // so mirroring the already-refreshed PlayerSession value into
            // both is safe — it never applies the other side's value.
            var currentInfluence = PlayerSession.HasActiveSession ? PlayerSession.Current.Influence : 0;
            var currentRank = PlayerSession.HasActiveSession ? PlayerSession.Current.Rank : null;
            var currentControlledUntil = PlayerSession.HasActiveSession ? PlayerSession.Current.ControlledUntilIso : null;

            var syntheticResolveData = new BattleResolveResponseData
            {
                battle_id = resolved.battle_id,
                result = outcome, // display-only; not re-parsed by ResultController (which switches on the `outcome` argument to ShowResult instead)
                winner_influence = currentInfluence,
                winner_rank = currentRank, // Sprint 7 (Influence + Control) — same "mirror into both, only the matching one is ever read" pattern as Influence above
                loser_influence = currentInfluence,
                loser_rank = currentRank,
                loser_controlled_until = currentControlledUntil,
            };

            ShowResult(outcome, syntheticResolveData);
        }

        private void ShowResult(string outcome, BattleResolveResponseData resolveData)
        {
            if (resultController == null)
            {
                Debug.LogError("[BattleManager] No ResultController assigned — cannot show the result screen.");
                return;
            }

            resultController.ShowResult(outcome, resolveData);
        }
    }
}
