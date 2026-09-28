using System;
using System.Collections.Generic;
using Nfouz.Core;
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

            public PopupRequest(string title, string message, string confirmLabel, string cancelLabel, Action onConfirm, Action onCancel)
            {
                Title = title;
                Message = message;
                ConfirmLabel = confirmLabel;
                CancelLabel = cancelLabel;
                OnConfirm = onConfirm;
                OnCancel = onCancel;
            }
        }

        [Header("Scene refs")]
        [SerializeField] private GameObject panelRoot;
        [SerializeField] private Text titleLabel;
        [SerializeField] private Text messageLabel;
        [SerializeField] private Button confirmButton;
        [SerializeField] private Text confirmButtonLabel;
        [SerializeField] private Button cancelButton;
        [SerializeField] private Text cancelButtonLabel;

        private readonly PopupStack _stack = new PopupStack();

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
        public void ShowInfo(string title, string message, string dismissLabel = "حسناً")
        {
            Enqueue(new PopupRequest(title, message, dismissLabel, null, null, null));
        }

        /// <summary>Two-button confirmation popup.</summary>
        public void ShowConfirm(string title, string message, string confirmLabel, string cancelLabel, Action onConfirm, Action onCancel = null)
        {
            Enqueue(new PopupRequest(title, message, confirmLabel, cancelLabel, onConfirm, onCancel));
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
            var wasEmpty = _stack.Count == 0;
            _stack.Push(request);
            if (wasEmpty)
            {
                Present(request);
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
            var current = _stack.Pop();
            SetVisible(false);
            current?.OnConfirm?.Invoke();
            PresentNextIfAny();
        }

        private void HandleCancelPressed()
        {
            var current = _stack.Pop();
            SetVisible(false);
            current?.OnCancel?.Invoke();
            PresentNextIfAny();
        }

        private void PresentNextIfAny()
        {
            if (_stack.TryPeek(out var next))
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
