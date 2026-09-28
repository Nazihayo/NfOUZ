using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Nfouz.Core;
using Nfouz.Networking;
using Nfouz.Utils;
using UnityEngine;

namespace Nfouz.Social
{
    /// <summary>
    /// Sprint 8 — Friends screen root controller. Drives the friends list
    /// and pending-requests list against the backend's /friends endpoints
    /// (friend.routes.js) and instantiates FriendListItem/FriendRequestItem
    /// rows. Identity is always the server's own resolution of the caller's
    /// Firebase token (see friend.controller.js#resolveSelf) — this
    /// controller never sends a "who am I" field, only the OTHER player's
    /// id when one is required (accept/decline/remove/block/unblock).
    ///
    /// Sprint 8 correction (final pass):
    ///   - Every request carries a CancellationToken tied to this object's
    ///     lifetime (cancelled in OnDestroy), so leaving the Friends screen
    ///     mid-request aborts it instead of racing to update UI elements
    ///     that may already be destroyed.
    ///   - RefreshAllAsync/RefreshFriendsAsync/RefreshPendingRequestsAsync
    ///     guard against overlapping calls — OnEnable firing a refresh
    ///     while a previous one is still in flight (e.g. rapid
    ///     enable/disable of the panel) could otherwise interleave two
    ///     ClearContainer/Instantiate passes and momentarily duplicate rows.
    ///   - The send-request button is disabled for the duration of its own
    ///     call so a double-tap cannot fire two concurrent requests for the
    ///     same target id.
    /// </summary>
    public class FriendsController : MonoBehaviour
    {
        [Header("Friends list")]
        [SerializeField] private Transform friendsListContainer;
        [SerializeField] private FriendListItem friendListItemPrefab;

        [Header("Pending requests")]
        [SerializeField] private Transform incomingRequestsContainer;
        [SerializeField] private Transform outgoingRequestsContainer;
        [SerializeField] private FriendRequestItem friendRequestItemPrefab;

        [Header("Send request")]
        [SerializeField] private UnityEngine.UI.InputField targetPlayerIdInput;
        [SerializeField] private UnityEngine.UI.Button sendRequestButton;
        [SerializeField] private UnityEngine.UI.Text statusLabel;

        private ApiClient _apiClient;
        private readonly List<GameObject> _spawnedRows = new List<GameObject>();
        private readonly CancellationTokenSource _lifetimeCts = new CancellationTokenSource();
        private bool _isRefreshingFriends;
        private bool _isRefreshingRequests;
        private bool _isSendingRequest;

        private void Awake()
        {
            _apiClient = ServiceLocator.Instance.Get<ApiClient>();

            if (sendRequestButton != null)
            {
                sendRequestButton.onClick.AddListener(HandleSendRequestButtonPressed);
            }
        }

        private void OnDestroy()
        {
            if (sendRequestButton != null)
            {
                sendRequestButton.onClick.RemoveListener(HandleSendRequestButtonPressed);
            }

            _lifetimeCts.Cancel();
            _lifetimeCts.Dispose();
        }

        private async void OnEnable()
        {
            await RefreshAllAsync();
        }

        public Task RefreshAllAsync()
        {
            return Task.WhenAll(RefreshFriendsAsync(), RefreshPendingRequestsAsync());
        }

        private async Task RefreshFriendsAsync()
        {
            if (_isRefreshingFriends)
            {
                return;
            }
            _isRefreshingFriends = true;

            try
            {
                var token = _lifetimeCts.Token;
                var response = await _apiClient.GetAsync<FriendsListResponseData>("/friends", token);
                if (token.IsCancellationRequested)
                {
                    return;
                }
                if (!response.success)
                {
                    SetStatus($"تعذر تحميل الأصدقاء: {response.error?.code}");
                    return;
                }

                ClearContainer(friendsListContainer);

                if (response.data?.friends == null || friendListItemPrefab == null || friendsListContainer == null)
                {
                    return;
                }

                foreach (var friend in response.data.friends)
                {
                    var row = Instantiate(friendListItemPrefab, friendsListContainer);
                    row.Bind(friend, HandleRemoveFriend, HandleBlockPlayer);
                    _spawnedRows.Add(row.gameObject);
                }
            }
            finally
            {
                _isRefreshingFriends = false;
            }
        }

        private async Task RefreshPendingRequestsAsync()
        {
            if (_isRefreshingRequests)
            {
                return;
            }
            _isRefreshingRequests = true;

            try
            {
                var token = _lifetimeCts.Token;
                var response = await _apiClient.GetAsync<PendingRequestsResponseData>("/friends/requests", token);
                if (token.IsCancellationRequested)
                {
                    return;
                }
                if (!response.success)
                {
                    SetStatus($"تعذر تحميل الطلبات المعلقة: {response.error?.code}");
                    return;
                }

                ClearContainer(incomingRequestsContainer);
                ClearContainer(outgoingRequestsContainer);

                if (friendRequestItemPrefab == null)
                {
                    return;
                }

                if (response.data?.incoming != null && incomingRequestsContainer != null)
                {
                    foreach (var req in response.data.incoming)
                    {
                        var row = Instantiate(friendRequestItemPrefab, incomingRequestsContainer);
                        row.BindIncoming(req, HandleAcceptRequest, HandleDeclineRequest);
                        _spawnedRows.Add(row.gameObject);
                    }
                }

                if (response.data?.outgoing != null && outgoingRequestsContainer != null)
                {
                    foreach (var req in response.data.outgoing)
                    {
                        var row = Instantiate(friendRequestItemPrefab, outgoingRequestsContainer);
                        row.BindOutgoing(req);
                        _spawnedRows.Add(row.gameObject);
                    }
                }
            }
            finally
            {
                _isRefreshingRequests = false;
            }
        }

        private void HandleSendRequestButtonPressed()
        {
            if (_isSendingRequest)
            {
                return;
            }

            var targetId = targetPlayerIdInput != null ? targetPlayerIdInput.text : null;
            if (string.IsNullOrEmpty(targetId))
            {
                SetStatus("أدخل معرّف اللاعب أولاً.");
                return;
            }

            _ = SendFriendRequestAsync(targetId);
        }

        private async Task SendFriendRequestAsync(string targetPlayerId)
        {
            _isSendingRequest = true;
            if (sendRequestButton != null)
            {
                sendRequestButton.interactable = false;
            }

            try
            {
                var token = _lifetimeCts.Token;
                var response = await _apiClient.PostAsync<FriendActionResponseData>("/friends/request", new PlayerIdRequest { player_id = targetPlayerId }, token);
                if (token.IsCancellationRequested)
                {
                    return;
                }
                if (!response.success)
                {
                    SetStatus(DescribeError(response.error?.code));
                    return;
                }

                SetStatus("تم إرسال طلب الصداقة.");
                await RefreshPendingRequestsAsync();
            }
            finally
            {
                _isSendingRequest = false;
                if (sendRequestButton != null)
                {
                    sendRequestButton.interactable = true;
                }
            }
        }

        private async void HandleAcceptRequest(string senderId)
        {
            var token = _lifetimeCts.Token;
            var response = await _apiClient.PostAsync<FriendActionResponseData>("/friends/accept", new PlayerIdRequest { player_id = senderId }, token);
            if (token.IsCancellationRequested)
            {
                return;
            }
            if (!response.success)
            {
                SetStatus(DescribeError(response.error?.code));
                return;
            }

            SetStatus("أصبحتما صديقين الآن.");
            await RefreshAllAsync();
        }

        private async void HandleDeclineRequest(string senderId)
        {
            var token = _lifetimeCts.Token;
            var response = await _apiClient.PostAsync<FriendActionResponseData>("/friends/decline", new PlayerIdRequest { player_id = senderId }, token);
            if (token.IsCancellationRequested)
            {
                return;
            }
            if (!response.success)
            {
                SetStatus(DescribeError(response.error?.code));
                return;
            }

            await RefreshPendingRequestsAsync();
        }

        private async void HandleRemoveFriend(string friendId)
        {
            var token = _lifetimeCts.Token;
            var response = await _apiClient.DeleteAsync<FriendActionResponseData>($"/friends/{friendId}", token);
            if (token.IsCancellationRequested)
            {
                return;
            }
            if (!response.success)
            {
                SetStatus(DescribeError(response.error?.code));
                return;
            }

            await RefreshFriendsAsync();
        }

        private async void HandleBlockPlayer(string playerId)
        {
            var token = _lifetimeCts.Token;
            var response = await _apiClient.PostAsync<FriendActionResponseData>("/friends/block", new PlayerIdRequest { player_id = playerId }, token);
            if (token.IsCancellationRequested)
            {
                return;
            }
            if (!response.success)
            {
                SetStatus(DescribeError(response.error?.code));
                return;
            }

            SetStatus("تم حظر اللاعب.");
            await RefreshAllAsync();
        }

        private static string DescribeError(string code)
        {
            switch (code)
            {
                case Constants.ErrorCodes.AlreadyFriends:
                    return "أنتما صديقان بالفعل.";
                case Constants.ErrorCodes.FriendLimitReached:
                    return "تم الوصول للحد الأقصى لعدد الأصدقاء (100).";
                case Constants.ErrorCodes.PlayerBlocked:
                    return "لا يمكن التفاعل مع هذا اللاعب.";
                case Constants.ErrorCodes.FriendRequestNotFound:
                    return "لا يوجد طلب صداقة معلق من هذا اللاعب.";
                case Constants.ErrorCodes.NotFriends:
                    return "أنتما لستما صديقين.";
                case Constants.ErrorCodes.NotBlocked:
                    return "لم تقم بحظر هذا اللاعب.";
                case Constants.ErrorCodes.PlayerNotFound:
                    return "اللاعب غير موجود.";
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
            Debug.Log($"[FriendsController] {message}");
        }

        private void ClearContainer(Transform container)
        {
            if (container == null)
            {
                return;
            }

            for (var i = container.childCount - 1; i >= 0; i--)
            {
                var child = container.GetChild(i).gameObject;
                _spawnedRows.Remove(child);
                Destroy(child);
            }
        }
    }
}
