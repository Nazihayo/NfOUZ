using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.Inventory
{
    /// <summary>
    /// Sprint 9 — one row in the Inventory list UI. Mirrors
    /// Social/FriendListItem.cs's simple "bind data, expose a button click
    /// event" pattern — no networking of its own; InventoryController owns
    /// every API call and simply calls Bind() on each spawned row.
    /// </summary>
    public class InventoryItem : MonoBehaviour
    {
        [SerializeField] private Text nameLabel;
        [SerializeField] private Text quantityLabel;
        [SerializeField] private Text typeLabel;
        [SerializeField] private GameObject equippedBadge;
        [SerializeField] private Button actionButton; // "Equip" for a weapon, "Use" for a consumable
        [SerializeField] private Text actionButtonLabel;

        private InventoryItemData _data;
        private System.Action<InventoryItemData> _onActionPressed;

        public void Bind(InventoryItemData data, System.Action<InventoryItemData> onActionPressed)
        {
            _data = data;
            _onActionPressed = onActionPressed;

            if (nameLabel != null) nameLabel.text = data.item_key;
            if (quantityLabel != null) quantityLabel.text = $"x{data.quantity}";
            if (typeLabel != null) typeLabel.text = data.rarity;
            if (equippedBadge != null) equippedBadge.SetActive(data.is_equipped);

            if (actionButton != null)
            {
                actionButton.onClick.RemoveAllListeners();
                actionButton.onClick.AddListener(HandleActionPressed);

                var isWeapon = data.item_type == "weapon";
                if (actionButtonLabel != null)
                {
                    actionButtonLabel.text = isWeapon ? (data.is_equipped ? "مجهّز" : "تجهيز") : "استخدام";
                }
                // A cosmetic item (neither weapon nor consumable) has no
                // action in this sprint's scope.
                actionButton.interactable = isWeapon ? !data.is_equipped : data.item_type == "consumable";
            }
        }

        private void HandleActionPressed()
        {
            _onActionPressed?.Invoke(_data);
        }
    }
}
