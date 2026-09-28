using System;
using System.Threading;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Networking;
using UnityEngine;

namespace Nfouz.Inventory
{
    /// <summary>
    /// Sprint 9 — single source of truth for the local player's inventory
    /// state, registered in ServiceLocator alongside ApiClient/PlayerSession
    /// (see Core/ServiceLocator.cs). Every screen that needs to know what
    /// the player owns or has equipped (Inventory UI, a future loadout
    /// screen, HUD) reads through this instead of each keeping its own
    /// stale copy or re-fetching independently.
    ///
    /// Server-authoritative: this is a CACHE of the server's own inventory
    /// state (GET /inventory), refreshed after every successful
    /// equip/use call — it is never written to directly by any local
    /// "predicted" change. A modified/forged client claiming a different
    /// item_key or quantity gains nothing, since inventory.service.js
    /// re-resolves ownership from the database on every call regardless of
    /// what this cache says.
    /// </summary>
    public class PlayerInventory : MonoBehaviour
    {
        public event Action<InventoryListResponseData> OnInventoryRefreshed;

        private ApiClient _apiClient;
        private readonly CancellationTokenSource _lifetimeCts = new CancellationTokenSource();
        private bool _isRefreshing;

        public InventoryListResponseData Current { get; private set; }

        private void Awake()
        {
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();
        }

        private void OnDestroy()
        {
            _lifetimeCts.Cancel();
            _lifetimeCts.Dispose();
        }

        /// <summary>Generates a fresh client-supplied idempotency key for one
        /// equip/use call — a UUID string, matching the backend's
        /// `request_id` validation (inventory.controller.js#requireRequestId:
        /// any non-empty string). A distinct value per logical user action,
        /// re-sent unchanged on any automatic retry of that SAME action.</summary>
        public static string NewRequestId()
        {
            return Guid.NewGuid().ToString("N");
        }

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
                var response = await _apiClient.GetAsync<InventoryListResponseData>("/inventory", token);
                if (token.IsCancellationRequested || !response.success)
                {
                    return;
                }

                Current = response.data;
                OnInventoryRefreshed?.Invoke(Current);
            }
            finally
            {
                _isRefreshing = false;
            }
        }

        public bool HasEquippedWeapon => Current != null && !string.IsNullOrEmpty(Current.equipped_weapon);

        public bool Owns(string itemKey, int atLeastQuantity = 1)
        {
            if (Current?.items == null)
            {
                return false;
            }

            foreach (var item in Current.items)
            {
                if (item.item_key == itemKey && item.quantity >= atLeastQuantity)
                {
                    return true;
                }
            }
            return false;
        }
    }
}
