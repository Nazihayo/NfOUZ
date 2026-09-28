using System;

namespace Nfouz.Inventory
{
    /// <summary>
    /// Sprint 9 — Inventory System DTOs. Field names mirror the JSON keys the
    /// backend actually returns (see inventory.controller.js) exactly, the
    /// same convention as Social/SocialModels.cs, so JsonUtility can
    /// deserialize them with no custom mapping.
    ///
    /// Deviation from the spec's assumption: items (008_items.sql) has no
    /// `item_key` column — the backend uses `items.name` (e.g. "Pulse
    /// Blade") as that stable key instead (see
    /// inventory.repository.js's own doc comment), so `item_key` here is
    /// literally that item name string, not a separate slug.
    /// </summary>
    [Serializable]
    public class InventoryItemData
    {
        public string item_key;
        public string item_type; // "weapon" | "consumable" | "cosmetic"
        public string rarity;
        public int quantity;
        public bool is_equipped;
    }

    [Serializable]
    public class InventoryListResponseData
    {
        public InventoryItemData[] items;
        public string equipped_weapon; // item_key, or null if nothing is equipped
    }

    [Serializable]
    public class InventoryEquipRequest
    {
        public string item_key;
        public string request_id; // client-generated UUID — see InventoryController.NewRequestId()
    }

    [Serializable]
    public class InventoryUseRequest
    {
        public string item_key;
        public string request_id;
    }

    [Serializable]
    public class InventoryEquipResponseData
    {
        public string item_key;
        public bool equipped;
        public bool idempotent; // true only when this response was a replay of a prior identical request_id
    }

    [Serializable]
    public class InventoryUseResponseData
    {
        public string item_key;
        public bool used;
        public int remaining_quantity;
        public bool idempotent;
    }
}
