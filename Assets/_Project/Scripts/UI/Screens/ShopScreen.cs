using System.Collections.Generic;
using Nfouz.Localization;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.UI.Screens
{
    /// <summary>
    /// Sprint 10 — Shop screen: DISPLAY-ONLY placeholder item list. Grepping
    /// backend/src finds no shop route, controller, service, or table of
    /// any kind (creditsService.js's own header comment explicitly says it
    /// is the one entry point a future shop purchase flow WOULD call —
    /// "There is no shop, no HTTP [endpoint]" today). This screen therefore:
    ///   - shows a small hard-coded mock item list (name + price text only,
    ///     no images, no real item data);
    ///   - never calls any API;
    ///   - its "buy" buttons, if wired in the scene, are forced non-
    ///     interactable here with a comment, rather than left to silently
    ///     no-op if a scene author wires an onClick by mistake.
    /// No payment code of any kind exists in this class.
    /// </summary>
    public class ShopScreen : MonoBehaviour
    {
        [SerializeField] private Text titleLabel;
        [SerializeField] private Text comingSoonLabel;
        [SerializeField] private Transform placeholderItemContainer;
        [SerializeField] private ShopPlaceholderItem placeholderItemPrefab;

        /// <summary>Mock, display-only — not a real catalog. No backend
        /// endpoint exists to fetch a real one from (see class doc comment).</summary>
        private static readonly List<(string name, string price)> MockItems = new List<(string, string)>
        {
            ("Skin Pack — Alpha", "—"),
            ("Credits Bundle — Small", "—"),
            ("Credits Bundle — Large", "—"),
        };

        private void OnEnable()
        {
            if (titleLabel != null) titleLabel.text = LocalizationManager.Get("shop.title");
            if (comingSoonLabel != null) comingSoonLabel.text = LocalizationManager.Get("shop.comingSoon");

            SpawnPlaceholderItems();
        }

        private void SpawnPlaceholderItems()
        {
            if (placeholderItemContainer == null || placeholderItemPrefab == null)
            {
                return;
            }

            for (var i = placeholderItemContainer.childCount - 1; i >= 0; i--)
            {
                Destroy(placeholderItemContainer.GetChild(i).gameObject);
            }

            foreach (var (name, price) in MockItems)
            {
                var row = Instantiate(placeholderItemPrefab, placeholderItemContainer);
                row.Bind(name, price);
            }
        }
    }

    /// <summary>One display-only row — no networking, no purchase call. The
    /// buy button, if assigned, is forced non-interactable: there is
    /// nothing for it to do (see ShopScreen's class doc comment).</summary>
    public class ShopPlaceholderItem : MonoBehaviour
    {
        [SerializeField] private Text nameLabel;
        [SerializeField] private Text priceLabel;
        [SerializeField] private Button buyButton;

        public void Bind(string itemName, string price)
        {
            if (nameLabel != null) nameLabel.text = itemName;
            if (priceLabel != null) priceLabel.text = price;

            if (buyButton != null)
            {
                // No shop backend exists (see ShopScreen's class doc
                // comment) — this button intentionally does nothing.
                buyButton.interactable = false;
            }
        }
    }
}
