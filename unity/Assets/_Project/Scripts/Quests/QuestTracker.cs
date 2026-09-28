using System;
using System.Threading;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Networking;
using UnityEngine;

namespace Nfouz.Quests
{
    /// <summary>
    /// Sprint 9 — single source of truth for the local player's today's
    /// quest list + Battle Pass XP, registered in ServiceLocator alongside
    /// ApiClient/PlayerInventory (see Core/ServiceLocator.cs and
    /// Inventory/PlayerInventory.cs, whose caching convention this mirrors).
    ///
    /// Server-authoritative: progress is NEVER computed or predicted
    /// locally — this is a read-only cache of GET /quests's response,
    /// refreshed on demand and after every successful claim. There is
    /// deliberately no API on this class to report client-side progress;
    /// the server computes it entirely from its own authoritative game
    /// events (battle wins, location updates, friend acceptances, rescues —
    /// see quest.service.js#recordProgress's doc comment for the exact hook
    /// call sites), matching "no client-reported progress trusted".
    /// </summary>
    public class QuestTracker : MonoBehaviour
    {
        public event Action<QuestListResponseData> OnQuestsRefreshed;

        private ApiClient _apiClient;
        private readonly CancellationTokenSource _lifetimeCts = new CancellationTokenSource();
        private bool _isRefreshing;

        public QuestListResponseData Current { get; private set; }
        public int BattlePassXp => Current?.battle_pass_xp ?? 0;

        private void Awake()
        {
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();
        }

        private void OnDestroy()
        {
            _lifetimeCts.Cancel();
            _lifetimeCts.Dispose();
        }

        public static string NewRequestId()
        {
            return Guid.NewGuid().ToString("N");
        }

        /// <summary>
        /// Refreshes today's quest list. The backend lazily assigns today's
        /// (UTC) quest rows on this very call if they don't exist yet
        /// (quest.service.js#assignTodayQuestsIfMissing) — this method never
        /// needs to know or care whether that assignment already happened.
        /// </summary>
        public async Task RefreshAsync()
        {
            if (_isRefreshing)
            {
                return;
            }
            _isRefreshing = true;

            try
            {
                var token = _lifetimeCts.Token;
                var response = await _apiClient.GetAsync<QuestListResponseData>("/quests", token);
                if (token.IsCancellationRequested || !response.success)
                {
                    return;
                }

                Current = response.data;
                OnQuestsRefreshed?.Invoke(Current);
            }
            finally
            {
                _isRefreshing = false;
            }
        }
    }
}
