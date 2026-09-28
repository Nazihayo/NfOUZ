using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Networking;
using UnityEngine;

namespace Nfouz.Inventory
{
    /// <summary>
    /// Sprint 9 — Inventory screen root controller. Drives the item list UI
    /// (weapon equip + consumable use) against the backend's /inventory
    /// endpoints (inventory.routes.js), mirroring
    /// Social/FriendsController.cs's list-refresh/spawn-rows pattern.
    /// Identity is always the server's own resolution of the caller's
    /// Firebase token (inventory.controller.js#resolveSelf) — this
    /// controller never sends a player_id.
    ///
    /// Every request carries a CancellationToken tied to this object's
    /// lifetime (cancelled in OnDestroy), and RefreshAsync/HandleAction
    /// guard against overlapping calls, the same conventions as
    /// RescueMissionController.cs/FriendsController.cs.
    /// </summary>
    public class InventoryController : MonoBehaviour
    {
        [SerializeField] private PlayerInventory playerInventory;
        [SerializeField] private EquipmentManager equipmentManager;
        [SerializeField] private Transform itemListContainer;
        [SerializeField] private InventoryItem itemPrefab;
        [SerializeField] private UnityEngine.UI.Text statusLabel;

        private ApiClient _apiClient;
        private readonly List<GameObject> _spawnedRows = new List<GameObject>();
        private readonly CancellationTokenSource _lifetimeCts = new CancellationTokenSource();
        private bool _isRefreshing;
        private bool _isPerformingAction;

        private void Awake()
        {
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();

            if (playerInventory == null)
            {
                playerInventory = ServiceLocator.Instance.Get<PlayerInventory>();
            }
            if (equipmentManager == null)
            {
                equipmentManager = ServiceLocator.Instance.Get<EquipmentManager>();
            }

            if (playerInventory != null)
            {
                playerInventory.OnInventoryRefreshed += HandleInventoryRefreshed;
            }
        }

        private void OnDestroy()
        {
            if (playerInventory != null)
            {
                playerInventory.OnInventoryRefreshed -= HandleInventoryRefreshed;
            }

            _lifetimeCts.Cancel();
            _lifetimeCts.Dispose();
        }

        private async void OnEnable()
        {
            await RefreshAsync();
        }

        public async Task RefreshAsync()
        {
            if (_isRefreshing || playerInventory == null)
            {
                return;
            }
            _isRefreshing = true;

            try
            {
                await playerInventory.RefreshAsync();
            }
            finally
            {
                _isRefreshing = false;
            }
        }

        private void HandleInventoryRefreshed(InventoryListResponseData data)
        {
            ClearRows();

            if (data?.items == null || itemListContainer == null || itemPrefab == null)
            {
                return;
            }

            foreach (var item in data.items)
            {
                var row = Instantiate(itemPrefab, itemListContainer);
                row.Bind(item, HandleItemActionPressed);
                _spawnedRows.Add(row.gameObject);
            }
        }

        /// <summary>
        /// Weapon rows call this to equip; consumable rows call this to use
        /// one unit. Routed to the right endpoint by `item_type`, matching
        /// the server's own equip/use split (inventory.service.js).
        /// </summary>
        private async void HandleItemActionPressed(InventoryItemData item)
        {
            if (_isPerformingAction)
            {
                return;
            }
            _isPerformingAction = true;

            try
            {
                if (item.item_type == "weapon")
                {
                    await HandleEquipAsync(item);
                }
                else if (item.item_type == "consumable")
                {
                    await HandleUseAsync(item);
                }
            }
            finally
            {
                _isPerformingAction = false;
            }
        }

        private async Task HandleEquipAsync(InventoryItemData item)
        {
            SetStatus($"جارٍ تجهيز {item.item_key}...");

            bool succeeded;
            if (equipmentManager != null)
            {
                succeeded = await equipmentManager.EquipAsync(item.item_key);
            }
            else
            {
                succeeded = await EquipDirectlyAsync(item.item_key);
            }

            SetStatus(succeeded ? $"تم تجهيز {item.item_key}." : "تعذّر تجهيز هذا السلاح.");
        }

        /// <summary>Fallback path if no EquipmentManager is wired in the scene — calls
        /// the same endpoint directly so the Inventory screen still works standalone.</summary>
        private async Task<bool> EquipDirectlyAsync(string itemKey)
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
                Debug.LogWarning($"[InventoryController] Equip failed: {response.error?.code}");
                return false;
            }

            await RefreshAsync();
            return true;
        }

        private async Task HandleUseAsync(InventoryItemData item)
        {
            SetStatus($"جارٍ استخدام {item.item_key}...");

            var token = _lifetimeCts.Token;
            var requestId = PlayerInventory.NewRequestId();
            var response = await _apiClient.PostAsync<InventoryUseResponseData>(
                "/inventory/use",
                new InventoryUseRequest { item_key = item.item_key, request_id = requestId },
                token);

            if (token.IsCancellationRequested)
            {
                return;
            }

            if (!response.success)
            {
                SetStatus(DescribeError(response.error?.code));
                return;
            }

            SetStatus($"تم استخدام {item.item_key}.");
            await RefreshAsync();
        }

        private static string DescribeError(string code)
        {
            switch (code)
            {
                case "ACTIVE_BATTLE_IN_PROGRESS":
                    return "لا يمكن استخدام العناصر أثناء معركة نشطة.";
                case "ITEM_NOT_OWNED":
                    return "لا تملك هذا العنصر.";
                case "ITEM_NOT_CONSUMABLE":
                    return "هذا العنصر ليس مستهلكاً.";
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

        private void ClearRows()
        {
            foreach (var row in _spawnedRows)
            {
                if (row != null)
                {
                    Destroy(row);
                }
            }
            _spawnedRows.Clear();
        }
    }
}
