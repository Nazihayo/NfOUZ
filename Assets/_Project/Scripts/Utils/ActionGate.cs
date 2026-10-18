namespace Nfouz.Utils
{
    /// <summary>
    /// Lets one player action run at a time: a second tap while the first
    /// request is still in flight is ignored instead of sending the request
    /// again (a double tap on Login, Confirm or Challenge). Unity-free so it
    /// is tested directly (ActionGateTests).
    /// </summary>
    public sealed class ActionGate
    {
        public bool IsBusy { get; private set; }

        /// <summary>True if the caller may start; it must then call End.</summary>
        public bool TryBegin()
        {
            if (IsBusy)
            {
                return false;
            }

            IsBusy = true;
            return true;
        }

        public void End()
        {
            IsBusy = false;
        }
    }
}
