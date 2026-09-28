using System;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.Social
{
    /// <summary>
    /// Sprint 8 — one row in the accepted-friends list. Purely a view: all
    /// network calls live in FriendsController, which this row's buttons
    /// call back into via the delegates passed to Bind.
    /// </summary>
    public class FriendListItem : MonoBehaviour
    {
        [SerializeField] private Text usernameLabel;
        [SerializeField] private Text classLabel;
        [SerializeField] private Button removeButton;
        [SerializeField] private Button blockButton;

        private string _friendId;
        private Action<string> _onRemove;
        private Action<string> _onBlock;

        public void Bind(FriendData data, Action<string> onRemove, Action<string> onBlock)
        {
            _friendId = data.friend_id;
            _onRemove = onRemove;
            _onBlock = onBlock;

            if (usernameLabel != null)
            {
                usernameLabel.text = data.username;
            }

            if (classLabel != null)
            {
                classLabel.text = data.class_type;
            }

            if (removeButton != null)
            {
                removeButton.onClick.RemoveAllListeners();
                removeButton.onClick.AddListener(() => _onRemove?.Invoke(_friendId));
            }

            if (blockButton != null)
            {
                blockButton.onClick.RemoveAllListeners();
                blockButton.onClick.AddListener(() => _onBlock?.Invoke(_friendId));
            }
        }
    }
}
