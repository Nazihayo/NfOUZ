using System;
using System.Threading;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Networking;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Social
{
    /// <summary>
    /// Sprint 8 — orchestrates one rescuer's attempt end-to-end: Friend
    /// accepts mission -> Reservation -> Guard Battle -> Success/Failure,
    /// against rescue.routes.js. "Remote virtual rescue. No physical
    /// navigation. No Mapbox rescue route." — this controller never reads
    /// or displays a location; the guard battle itself is a local combat
    /// encounter (RescueGuardController/RescueGuardCombat) resolved
    /// entirely client-side and then reported to the server as one outcome,
    /// the same authority model already used for
    /// battle.service.js#resolveBattle's signed result (Host Mode Alpha).
    ///
    /// Sprint 8 correction (final pass):
    ///   - Every network call now carries a CancellationToken tied to this
    ///     object's lifetime, cancelled in OnDestroy — leaving the scene
    ///     mid-reservation/mid-guard-battle aborts the in-flight request
    ///     and the countdown loop instead of resuming a callback against a
    ///     destroyed panel/slider.
    ///   - AcceptMissionAsync guards against overlapping calls (a
    ///     double-tap on "Rescue" can no longer fire two concurrent
    ///     reservation attempts for the same sos_id).
    ///   - DescribeError covers the new RESCUE_COOLDOWN_ACTIVE code
    ///     (failed-attempt cooldown) added this pass.
    /// </summary>
    public class RescueMissionController : MonoBehaviour
    {
        [Header("Scene refs")]
        [SerializeField] private GameObject reservationPanel;
        [SerializeField] private GameObject guardBattlePanel;
        [SerializeField] private RescueGuardController guardController;
        [SerializeField] private UnityEngine.UI.Text statusLabel;
        [SerializeField] private UnityEngine.UI.Slider guardBattleTimerSlider;

        public event Action<RescueOutcomeResponseData> OnMissionResolved;
        public event Action<string> OnMissionError; // param: error code

        private ApiClient _apiClient;
        private RescueMissionData _mission;
        private bool _outcomeReported;
        private bool _isAccepting;
        private readonly CancellationTokenSource _lifetimeCts = new CancellationTokenSource();

        private void Awake()
        {
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();
            SetPanelsVisible(reservation: false, guardBattle: false);

            if (guardController != null)
            {
                guardController.OnGuardDefeated += HandleGuardDefeated;
                guardController.OnPlayerDefeated += HandlePlayerDefeated;
            }
        }

        private void OnDestroy()
        {
            if (guardController != null)
            {
                guardController.OnGuardDefeated -= HandleGuardDefeated;
                guardController.OnPlayerDefeated -= HandlePlayerDefeated;
            }

            _lifetimeCts.Cancel();
            _lifetimeCts.Dispose();
        }

        /// <summary>
        /// Step 1: accept the mission (reserve it). Called when the rescuer
        /// taps "Rescue" on an SOS (from a push notification or a friend's
        /// status). A RESCUE_ALREADY_IN_PROGRESS response means another
        /// friend won the race — surfaced as an error, not a crash, per
        /// "Others see In Progress". Guards against a duplicate concurrent
        /// call (double-tap) for the same or a different sos_id while one
        /// is already in flight.
        /// </summary>
        public async Task AcceptMissionAsync(string sosId)
        {
            if (_isAccepting)
            {
                return;
            }
            _isAccepting = true;

            try
            {
                SetStatus("جارٍ حجز مهمة الإنقاذ...");

                var token = _lifetimeCts.Token;
                var response = await _apiClient.PostAsync<RescueMissionData>("/rescue/accept", new RescueAcceptRequest { sos_id = sosId }, token);
                if (token.IsCancellationRequested)
                {
                    return;
                }
                if (!response.success)
                {
                    HandleError(response.error?.code);
                    return;
                }

                _mission = response.data;
                _outcomeReported = false;
                SetPanelsVisible(reservation: true, guardBattle: false);
                SetStatus("تم حجز المهمة — استعد لمعركة الحارس.");

                await StartGuardBattleAsync();
            }
            finally
            {
                _isAccepting = false;
            }
        }

        /// <summary>
        /// Step 2: starts the 60-second Guard Battle window. Called
        /// automatically right after a successful reservation — there is no
        /// separate "ready" gesture for a rescue in this sprint's spec,
        /// unlike the PvP Battle flow's ready-confirmation step.
        /// </summary>
        private async Task StartGuardBattleAsync()
        {
            var token = _lifetimeCts.Token;
            var response = await _apiClient.PostAsync<RescueMissionData>($"/rescue/{_mission.mission_id}/guard-battle/start", null, token);
            if (token.IsCancellationRequested)
            {
                return;
            }
            if (!response.success)
            {
                HandleError(response.error?.code);
                return;
            }

            _mission = response.data;
            SetPanelsVisible(reservation: false, guardBattle: true);
            SetStatus("قاتل الحارس لإنقاذ صديقك!");

            guardController?.BeginBattle();
            _ = RunGuardBattleTimerAsync();
        }

        /// <summary>Local countdown display only — the server's own
        /// guard_battle_ends_at is authoritative, same ServerTime convention
        /// as ControlStateManager's Control/Protection countdowns. Exits
        /// promptly if this object is destroyed mid-battle (scene change).</summary>
        private async Task RunGuardBattleTimerAsync()
        {
            var deadline = ServerTime.ParseIsoUtc(_mission.guard_battle_ends_at);
            if (deadline == null)
            {
                return;
            }

            var token = _lifetimeCts.Token;
            while (!_outcomeReported && !token.IsCancellationRequested)
            {
                var remaining = ServerTime.SecondsRemaining(deadline);
                if (guardBattleTimerSlider != null)
                {
                    guardBattleTimerSlider.value = Mathf.Clamp01(remaining / Constants.Rescue.GuardBattleDurationSeconds);
                }

                if (remaining <= 0f)
                {
                    // The guard held for the full duration — a timeout counts
                    // as the guard winning (rescue failure), mirroring
                    // rescue.repository.js#expireGuardBattleIfDue server-side.
                    await ReportOutcomeAsync("failure");
                    return;
                }

                await Task.Yield();
            }
        }

        private async void HandleGuardDefeated()
        {
            await ReportOutcomeAsync("success");
        }

        private async void HandlePlayerDefeated()
        {
            await ReportOutcomeAsync("failure");
        }

        /// <summary>
        /// Step 3: reports the guard battle's outcome. Idempotent against a
        /// double-report (e.g. the timer and a combat event firing in the
        /// same frame) via `_outcomeReported`.
        /// </summary>
        private async Task ReportOutcomeAsync(string outcome)
        {
            if (_outcomeReported || _mission == null)
            {
                return;
            }
            _outcomeReported = true;

            guardController?.EndBattle();

            var token = _lifetimeCts.Token;
            // Sprint 8 Critical Security Patch — the server decides who
            // actually won; this call reports what the local, entirely
            // client-side combat encounter produced, but is authoritative
            // for nothing. guard_battle_token proves this report belongs to
            // the specific battle the server started (and, since it is
            // cleared server-side the moment a resolve succeeds, can never
            // be replayed to double-resolve the same mission).
            var response = await _apiClient.PostAsync<RescueOutcomeResponseData>(
                $"/rescue/{_mission.mission_id}/guard-battle/resolve",
                new RescueOutcomeRequest { outcome = outcome, guard_battle_token = _mission.guard_battle_token },
                token);

            if (token.IsCancellationRequested)
            {
                return;
            }
            if (!response.success)
            {
                HandleError(response.error?.code);
                return;
            }

            SetStatus(response.data.status == "succeeded" ? "تم الإنقاذ بنجاح!" : "فشلت محاولة الإنقاذ.");
            OnMissionResolved?.Invoke(response.data);
        }

        private void HandleError(string errorCode)
        {
            Debug.LogWarning($"[RescueMissionController] Error: {errorCode}");
            SetStatus(DescribeError(errorCode));
            OnMissionError?.Invoke(errorCode);
        }

        private static string DescribeError(string code)
        {
            switch (code)
            {
                case Constants.ErrorCodes.RescueAlreadyInProgress:
                    return "صديق آخر يقوم بمحاولة الإنقاذ بالفعل.";
                case Constants.ErrorCodes.ControlTooShort:
                    return "الوقت المتبقي على السيطرة غير كافٍ لبدء الإنقاذ.";
                case Constants.ErrorCodes.SosNotOpen:
                    return "نداء الاستغاثة لم يعد مفتوحاً.";
                case Constants.ErrorCodes.CannotRescueSelf:
                    return "لا يمكنك إنقاذ نفسك.";
                case Constants.ErrorCodes.ReservationExpired:
                    return "انتهت مهلة الحجز.";
                case Constants.ErrorCodes.NotYourReservation:
                    return "هذه المهمة محجوزة لشخص آخر.";
                case Constants.ErrorCodes.GuardBattleNotActive:
                    return "معركة الحارس لم تعد نشطة.";
                case Constants.ErrorCodes.RescueCooldownActive:
                    return "محاولة إنقاذ أخرى فشلت مؤخراً — يرجى الانتظار قليلاً قبل المحاولة مجدداً.";
                case Constants.ErrorCodes.PlayerBlocked:
                    return "لا يمكنك التفاعل مع هذا اللاعب.";
                case Constants.ErrorCodes.NotEligibleFriend:
                    return "يجب أن تكون صديقاً مقبولاً لهذا اللاعب لإنقاذه.";
                case Constants.ErrorCodes.FriendshipTooNew:
                    return "الصداقة حديثة جداً — يجب أن تمر 24 ساعة على الأقل قبل الإنقاذ.";
                case Constants.ErrorCodes.InvalidGuardBattleToken:
                    return "معركة الحارس غير صالحة أو انتهت بالفعل.";
                default:
                    return $"حدث خطأ: {code}";
            }
        }

        private void SetStatus(string message)
        {
            if (statusLabel != null)
            {
                statusLabel.text = message;
            }
        }

        private void SetPanelsVisible(bool reservation, bool guardBattle)
        {
            if (reservationPanel != null)
            {
                reservationPanel.SetActive(reservation);
            }

            if (guardBattlePanel != null)
            {
                guardBattlePanel.SetActive(guardBattle);
            }
        }
    }
}
