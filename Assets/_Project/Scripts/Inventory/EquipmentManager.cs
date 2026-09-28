using System.Threading;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Networking;
using UnityEngine;

namespace Nfouz.Inventory
{
    /// <summary>
    /// Sprint 9 — Weapon equip UI orchestration against POST
    /// /inventory/equip. Kept separate from the general InventoryController
    /// (which owns the item LIST/consumable-use UI) since equipping a
    /// weapon is the one inventory action combat/loadout screens outside
    /// the Inventory screen itself may also need to trigger directly.
    ///
    /// Idempotency: every equip call carries a fresh
    /// PlayerInventory.NewRequestId() the first time an action is
    /// attempted, then re-sends the SAME id on an automatic retry of that
    /// exact attempt — never a new one per retry — so a dropped response
    /// after the server already applied the change cannot double-apply it
    /// (see inventory.service.js#withIdempotency's doc comment for why this
    /// is actually safe under retry).
    /// </summary>
    public class EquipmentManager : MonoBehaviour
    {
        [SerializeField] private PlayerInventory playerInventory;

        private ApiClient _apiClient;
        private readonly CancellationTokenSource _lifetimeCts = new CancellationTokenSource();
        private bool _isEquipping;

        private void Awake()
        {
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();
            if (playerInventory == null)
            {
                playerInventory = ServiceLocator.Instance.Get<PlayerInventory>();
            }
        }

        private void OnDestroy()
        {
            _lifetimeCts.Cancel();
            _lifetimeCts.Dispose();
        }

        /// <summary>
        /// Equips the given weapon (by item_key). Returns true on success —
        /// the caller (InventoryController/loadout UI) is responsible for
        /// surfacing an error via the response's ApiError.code on failure
        /// (e.g. ITEM_NOT_A_WEAPON, ITEM_NOT_OWNED, ACTIVE_BATTLE_IN_PROGRESS
        /// — see inventory.controller.js for the full set). Guards against a
        /// double-tap firing two concurrent equip calls.
        /// </summary>
        public async Task<bool> EquipAsync(string itemKey)
        {
            if (_isEquipping || string.IsNullOrEmpty(itemKey))
            {
                return false;
            }
            _isEquipping = true;

            try
            {
                var token = _lifetimeCts.Token;
                var requestId = PlayerInventory.NewRequestId();
                var response = await _apiClient.PostAsync<InventoryEquipResponseData>(
                    "/inventory/equip",
                    new InventoryEquipRequest { item_key = itemKey, request_id = requestId },
                    token);

                if (token.IsCancellationRequested)
                {
                    return false;
                }

                if (!response.success)
                {
                    Debug.LogWarning($"[EquipmentManager] Equip failed for '{itemKey}': {response.error?.code}");
                    return false;
                }

                if (playerInventory != null)
                {
                    await playerInventory.RefreshAsync();
                }
                return true;
            }
            finally
            {
                _isEquipping = false;
            }
        }
    }
}
