using System;
using System.Collections.Generic;
using Nfouz.Core;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Nfouz.UI
{
    /// <summary>
    /// Sprint 10 — generic modal/dialog stack: confirmations, error popups
    /// (driven by Constants.ErrorCodes-derived messages the caller already
    /// produced — e.g. the same DescribeError strings RescueMissionController/
    /// FriendsController/QuestController/InventoryController already build),
    /// and reward popups. Only one popup panel is ever instantiated in the
    /// scene (a single generic "message + buttons" panel, matching the
    /// project's existing convention of one panel per state rather than a
    /// per-popup-type prefab); a stacked popup is queued and shown the
    /// moment the current one is dismissed, never overlapped.
    ///
    /// The stack bookkeeping itself lives in the plain PopupStack class
    /// below so it can be unit-tested without any GameObject/Canvas — see
    /// Tests/EditMode/PopupStackTests.cs.
    /// </summary>
    public class PopupManager : MonoBehaviour
    {
        public readonly struct PopupRequest
        {
            public readonly string Title;
            public readonly string Message;
            public readonly string ConfirmLabel;
            public readonly string CancelLabel; // null for a single-button (info/error) popup
            public readonly Action OnConfirm;
            public readonly Action OnCancel;
            /// <summary>Optional: lets the caller close this popup itself
            /// (Dismiss), e.g. an invitation that expired.</summary>
            public readonly string Key;
            /// <summary>Set when queued; identifies this exact popup.</summary>
            public readonly int Ticket;

            public PopupRequest(string title, string message, string confirmLabel, string cancelLabel, Action onConfirm, Action onCancel, string key = null)
                : this(title, message, confirmLabel, cancelLabel, onConfirm, onCancel, key, 0)
            {
            }

            private PopupRequest(string title, string message, string confirmLabel, string cancelLabel, Action onConfirm, Action onCancel, string key, int ticket)
            {
                Title = title;
                Message = message;
                ConfirmLabel = confirmLabel;
                CancelLabel = cancelLabel;
                OnConfirm = onConfirm;
                OnCancel = onCancel;
                Key = key;
                Ticket = ticket;
            }

            public PopupRequest WithTicket(int ticket) =>
                new PopupRequest(Title, Message, ConfirmLabel, CancelLabel, OnConfirm, OnCancel, Key, ticket);
        }

        [Header("Scene refs")]
        [SerializeField] private GameObject panelRoot;
        [SerializeField] private TMP_Text titleLabel;
        [SerializeField] private TMP_Text messageLabel;
        [SerializeField] private Button confirmButton;
        [SerializeField] private TMP_Text confirmButtonLabel;
        [SerializeField] private Button cancelButton;
        [SerializeField] private TMP_Text cancelButtonLabel;

        private readonly PopupQueue _queue = new PopupQueue();

        private void Awake()
        {
            var locator = ServiceLocator.Instance;
            if (locator != null)
            {
                locator.Register<PopupManager>(this);
            }

            SetVisible(false);

            if (confirmButton != null)
            {
                confirmButton.onClick.AddListener(HandleConfirmPressed);
            }

            if (cancelButton != null)
            {
                cancelButton.onClick.AddListener(HandleCancelPressed);
            }
        }

        private void OnDestroy()
        {
            if (confirmButton != null)
            {
                confirmButton.onClick.RemoveListener(HandleConfirmPressed);
            }

            if (cancelButton != null)
            {
                cancelButton.onClick.RemoveListener(HandleCancelPressed);
            }
        }

        /// <summary>Single-button info/error popup — e.g. an
        /// ApiError.code-driven message already translated by the calling
        /// controller's own DescribeError.</summary>
        public void ShowInfo(string title, string message, string dismissLabel = "حسناً", string key = null)
        {
            Enqueue(new PopupRequest(title, message, dismissLabel, null, null, null, key));
        }

        /// <summary>Two-button confirmation popup.</summary>
        public void ShowConfirm(string title, string message, string confirmLabel, string cancelLabel, Action onConfirm, Action onCancel = null, string key = null)
        {
            Enqueue(new PopupRequest(title, message, confirmLabel, cancelLabel, onConfirm, onCancel, key));
        }

        /// <summary>Closes every queued or visible popup with this key,
        /// without running its callbacks.</summary>
        public void Dismiss(string key)
        {
            if (_queue.Dismiss(key))
            {
                SetVisible(false);
                PresentNextIfAny();
            }
        }

        /// <summary>Reward popup — same single-button shape as ShowInfo,
        /// kept as a distinct method for callers (e.g. a quest claim or
        /// rescue reward) to express intent clearly.</summary>
        public void ShowReward(string title, string message, string dismissLabel = "رائع!")
        {
            Enqueue(new PopupRequest(title, message, dismissLabel, null, null, null));
        }

        private void Enqueue(PopupRequest request)
        {
            var toShow = _queue.Enqueue(request);
            if (toShow.HasValue)
            {
                Present(toShow.Value);
            }
        }

        private void Present(PopupRequest request)
        {
            SetVisible(true);
            if (titleLabel != null) titleLabel.text = request.Title;
            if (messageLabel != null) messageLabel.text = request.Message;
            if (confirmButtonLabel != null) confirmButtonLabel.text = request.ConfirmLabel;

            var hasCancel = !string.IsNullOrEmpty(request.CancelLabel);
            if (cancelButton != null) cancelButton.gameObject.SetActive(hasCancel);
            if (hasCancel && cancelButtonLabel != null) cancelButtonLabel.text = request.CancelLabel;
        }

        private void HandleConfirmPressed()
        {
            var current = TakeCurrent();
            current?.OnConfirm?.Invoke();
            PresentNextIfAny();
        }

        private void HandleCancelPressed()
        {
            var current = TakeCurrent();
            current?.OnCancel?.Invoke();
            PresentNextIfAny();
        }

        private PopupRequest? TakeCurrent()
        {
            SetVisible(false);
            return _queue.TakeCurrent();
        }

        private void PresentNextIfAny()
        {
            var next = _queue.Next();
            if (next.HasValue)
            {
                Present(next.Value);
            }
        }

        private void SetVisible(bool visible)
        {
            if (panelRoot != null)
            {
                panelRoot.SetActive(visible);
            }
        }
    }

    /// <summary>
    /// Which popup is on screen. One at a time: a popup queued while another
    /// is visible waits, and the visible one's buttons always act on it,
    /// never on a popup waiting behind it. Unity-free (PopupStackTests).
    /// </summary>
    public class PopupQueue
    {
        private readonly PopupStack _stack = new PopupStack();
        private int _nextTicket;

        public PopupManager.PopupRequest? Current { get; private set; }

        public int Count => _stack.Count;

        /// <summary>Queues a popup; returns it if it should be shown now.</summary>
        public PopupManager.PopupRequest? Enqueue(PopupManager.PopupRequest request)
        {
            var ticketed = request.WithTicket(++_nextTicket);
            _stack.Push(ticketed);
            if (Current.HasValue)
            {
                return null;
            }

            Current = ticketed;
            return ticketed;
        }

        /// <summary>Removes and returns the popup on screen (a button was pressed).</summary>
        public PopupManager.PopupRequest? TakeCurrent()
        {
            var current = Current;
            if (current.HasValue)
            {
                var ticket = current.Value.Ticket;
                _stack.RemoveWhere(r => r.Ticket == ticket);
            }

            Current = null;
            return current;
        }

        /// <summary>The next popup to show once none is on screen (null: none, or one is already shown).</summary>
        public PopupManager.PopupRequest? Next()
        {
            if (Current.HasValue || !_stack.TryPeek(out var next))
            {
                return null;
            }

            Current = next;
            return next;
        }

        /// <summary>Removes every popup with this key. True if the one on screen was among them.</summary>
        public bool Dismiss(string key)
        {
            if (string.IsNullOrEmpty(key) || _stack.RemoveWhere(r => r.Key == key) == 0)
            {
                return false;
            }

            if (Current.HasValue && Current.Value.Key == key)
            {
                Current = null;
                return true;
            }

            return false;
        }
    }

    /// <summary>
    /// Pure LIFO popup queue — Unity/MonoBehaviour-free so it can be
    /// exercised directly by an EditMode test. Push/Pop mirror a normal
    /// stack; TryPeek lets the caller present the next request without
    /// removing it first.
    /// </summary>
    public class PopupStack
    {
        private readonly Stack<PopupManager.PopupRequest> _requests = new Stack<PopupManager.PopupRequest>();

        public int Count => _requests.Count;

        public void Push(PopupManager.PopupRequest request)
        {
            _requests.Push(request);
        }

        public PopupManager.PopupRequest? Pop()
        {
            return _requests.Count > 0 ? _requests.Pop() : (PopupManager.PopupRequest?)null;
        }

        /// <summary>Removes every request that matches, keeping the
        /// others in order. Returns how many were removed.</summary>
        public int RemoveWhere(Func<PopupManager.PopupRequest, bool> match)
        {
            var kept = new List<PopupManager.PopupRequest>();
            var removed = 0;
            while (_requests.Count > 0)
            {
                var request = _requests.Pop();
                if (match(request))
                {
                    removed++;
                }
                else
                {
                    kept.Add(request);
                }
            }

            for (var i = kept.Count - 1; i >= 0; i--)
            {
                _requests.Push(kept[i]);
            }

            return removed;
        }

        public bool TryPeek(out PopupManager.PopupRequest? request)
        {
            if (_requests.Count > 0)
            {
                request = _requests.Peek();
                return true;
            }

            request = null;
            return false;
        }
    }
}
