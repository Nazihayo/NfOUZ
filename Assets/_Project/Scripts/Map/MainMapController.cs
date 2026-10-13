using UnityEngine;

namespace Nfouz.Map
{
    /// <summary>
    /// MainMap scene bootstrap (MAINMAP_SCENE_SETUP.md §5): binds the
    /// scene-local GPSLocationService to NearbyPlayersTracker once both
    /// exist. Intentionally a direct scene reference rather than a
    /// ServiceLocator registration, since GPSLocationService is not
    /// DontDestroyOnLoad.
    /// </summary>
    public class MainMapController : MonoBehaviour
    {
        [SerializeField] private NearbyPlayersTracker nearbyPlayersTracker;
        [SerializeField] private GPSLocationService gpsLocationService;

        private void Start()
        {
            if (nearbyPlayersTracker == null || gpsLocationService == null)
            {
                Debug.LogError("[MainMapController] NearbyPlayersTracker or GPSLocationService not assigned.");
                return;
            }

            nearbyPlayersTracker.Bind(gpsLocationService);
        }
    }
}
