using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.UI.Screens
{
    /// <summary>One display-only row — no networking, no purchase call. The
    /// buy button, if assigned, is forced non-interactable: there is
    /// nothing for it to do (see ShopScreen's class doc comment).</summary>
    public class ShopPlaceholderItem : MonoBehaviour
    {
        [SerializeField] private TMP_Text nameLabel;
        [SerializeField] private TMP_Text priceLabel;
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
