using System;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.Social
{
    /// <summary>
    /// Sprint 8 — one row in either the incoming or outgoing pending-request
    /// list. An incoming row shows Accept/Decline buttons; an outgoing row
    /// (the caller is the sender, waiting on someone else) is display-only,
    /// since there is no "cancel my own outgoing request" endpoint in this
    /// sprint's spec.
    /// </summary>
    public class FriendRequestItem : MonoBehaviour
    {
        [SerializeField] private Text usernameLabel;
        [SerializeField] private Text classLabel;
        [SerializeField] private Text statusLabel; // e.g. "بانتظار الرد" for outgoing rows
        [SerializeField] private Button acceptButton;
        [SerializeField] private Button declineButton;

        private string _otherPlayerId;
        private Action<string> _onAccept;
        private Action<string> _onDecline;

        public void BindIncoming(PendingFriendRequestData data, Action<string> onAccept, Action<string> onDecline)
        {
            _otherPlayerId = data.sender_id;
            _onAccept = onAccept;
            _onDecline = onDecline;

            SetLabels(data);

            SetButtonsVisible(true);

            if (acceptButton != null)
            {
                acceptButton.onClick.RemoveAllListeners();
                acceptButton.onClick.AddListener(() => _onAccept?.Invoke(_otherPlayerId));
            }

            if (declineButton != null)
            {
                declineButton.onClick.RemoveAllListeners();
                declineButton.onClick.AddListener(() => _onDecline?.Invoke(_otherPlayerId));
            }
        }

        public void BindOutgoing(PendingFriendRequestData data)
        {
            _otherPlayerId = data.recipient_id;
            SetLabels(data);
            SetButtonsVisible(false);

            if (statusLabel != null)
            {
                statusLabel.text = "بانتظار الرد";
            }
        }

        private void SetLabels(PendingFriendRequestData data)
        {
            if (usernameLabel != null)
            {
                usernameLabel.text = data.username;
            }

            if (classLabel != null)
            {
                classLabel.text = data.class_type;
            }
        }

        private void SetButtonsVisible(bool visible)
        {
            if (acceptButton != null)
            {
                acceptButton.gameObject.SetActive(visible);
            }

            if (declineButton != null)
            {
                declineButton.gameObject.SetActive(visible);
            }
        }
    }
}
