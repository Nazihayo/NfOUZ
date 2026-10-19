using Nfouz.Utils;

namespace Nfouz.Social
{
    /// <summary>
    /// Which SOS poll failures are final. A transient failure (network,
    /// rate limit, server error) keeps the banner and the poll; an SOS that
    /// no longer exists, or that is not this player's (another account
    /// signed in on this device while the poll ran), never comes back, so
    /// polling it again would run forever. Unity-free so it is tested
    /// directly (SosPollingTests).
    /// </summary>
    public static class SosPolling
    {
        public static bool IsPermanentFailure(ApiError error)
        {
            return error?.code == Constants.ErrorCodes.SosNotFound || error?.code == Constants.ErrorCodes.Forbidden;
        }
    }
}
