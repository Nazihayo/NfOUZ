using Nfouz.Social;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.UI.Screens
{
    /// <summary>
    /// Sprint 10 — Friends screen wrapper. Friends list + Pending Requests
    /// are ALREADY fully implemented by the existing, approved
    /// FriendsController (Social/FriendsController.cs, Sprint 8 — its own
    /// list-refresh, send/accept/decline/remove/block flow) — this class
    /// does not re-implement any of that; FriendsController's GameObject is
    /// simply hosted as a child under this screen's root and is left
    /// completely untouched.
    ///
    /// Blocked Players and Active SOS are the two items in the sprint
    /// brief's list that FriendsController does NOT cover, for a real
    /// reason found during exploration rather than an oversight:
    ///   - Blocked Players: friend.routes.js exposes POST /friends/block
    ///     and /friends/unblock, but there is no GET /friends/blocked (or
    ///     equivalent) endpoint anywhere in the backend to list them, and
    ///     FriendsController itself never calls /friends/unblock either
    ///     (only block, via HandleBlockPlayer). Listing blocked players
    ///     would require a new backend endpoint, which this sprint's scope
    ///     explicitly excludes ("no backend changes... unless a screen
    ///     literally cannot function without a trivial, read-only,
    ///     additive backend field") — a whole missing LIST endpoint is more
    ///     than a trivial field, so this is flagged in the sprint report as
    ///     a gap for a future sprint rather than silently added here. The
    ///     section is shown collapsed/hidden with an explanatory label
    ///     instead of a fake empty list.
    ///   - Active SOS: there is no backend concept of "which of my friends
    ///     currently has an open SOS" (SOSManager only ever tracks the
    ///     LOCAL player's own SOS) — the closest existing signal is the
    ///     local player's own SOSManager.HasActiveSos, shown here as a
    ///     read-only indicator rather than inventing a per-friend SOS feed
    ///     the backend has no route for.
    /// </summary>
    public class FriendsScreen : MonoBehaviour
    {
        [Header("Existing Sprint 8 controller (untouched)")]
        [SerializeField] private FriendsController friendsController;

        [Header("Blocked Players — no backing endpoint yet (see class doc comment)")]
        [SerializeField] private GameObject blockedPlayersSection;
        [SerializeField] private Text blockedPlayersUnavailableLabel;

        [Header("Active SOS — local player's own SOS only")]
        [SerializeField] private Text activeSosLabel;

        private void OnEnable()
        {
            if (blockedPlayersSection != null)
            {
                blockedPlayersSection.SetActive(false);
            }

            if (blockedPlayersUnavailableLabel != null)
            {
                blockedPlayersUnavailableLabel.text = "قائمة اللاعبين المحظورين غير متاحة بعد (لا يوجد نقطة نهاية في الخادم لعرضها).";
            }

            if (SOSManager.Instance != null)
            {
                SOSManager.Instance.OnSosCreated += HandleSosChanged;
                SOSManager.Instance.OnSosRescued += HandleSosChanged;
                SOSManager.Instance.OnSosExpired += HandleSosChanged;
            }

            RefreshActiveSos();
        }

        private void OnDisable()
        {
            if (SOSManager.Instance != null)
            {
                SOSManager.Instance.OnSosCreated -= HandleSosChanged;
                SOSManager.Instance.OnSosRescued -= HandleSosChanged;
                SOSManager.Instance.OnSosExpired -= HandleSosChanged;
            }
        }

        private void HandleSosChanged<T>(T _) => RefreshActiveSos();

        private void RefreshActiveSos()
        {
            if (activeSosLabel == null)
            {
                return;
            }

            var hasActiveSos = SOSManager.Instance != null && SOSManager.Instance.HasActiveSos;
            activeSosLabel.text = hasActiveSos ? "لديك نداء استغاثة نشط." : "لا يوجد نداء استغاثة نشط.";
        }
    }
}
