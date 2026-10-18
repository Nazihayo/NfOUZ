namespace Nfouz.Networking
{
    /// <summary>
    /// What may be written to the device log about a request. Query strings
    /// carry the player's coordinates (GET /player/nearby?lat=…&amp;lng=…), so
    /// only the path is logged. Unity-free so it is tested directly.
    /// </summary>
    public static class LogRedaction
    {
        public static string Endpoint(string endpoint)
        {
            if (string.IsNullOrEmpty(endpoint))
            {
                return endpoint;
            }

            var query = endpoint.IndexOf('?');
            return query < 0 ? endpoint : endpoint.Substring(0, query) + "?…";
        }
    }
}
