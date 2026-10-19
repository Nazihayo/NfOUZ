using Nfouz.Core;
using Nfouz.UI;
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

        public const string LocationUnavailableTitle = "الموقع غير متاح";

        // Subscribed in OnEnable: GPSLocationService reports a refused
        // permission or a GPS that never started from its own Start.
        private void OnEnable()
        {
            if (gpsLocationService != null)
            {
                gpsLocationService.OnLocationError += ShowLocationError;
            }
        }

        private void OnDisable()
        {
            if (gpsLocationService != null)
            {
                gpsLocationService.OnLocationError -= ShowLocationError;
            }
        }

        /// <summary>Without a location the map has no nearby players; say
        /// why instead of showing an empty map.</summary>
        private static void ShowLocationError(string message)
        {
            var locator = ServiceLocator.Instance;
            if (locator != null && locator.TryGet<PopupManager>(out var popups))
            {
                popups.ShowInfo(LocationUnavailableTitle, message);
            }
        }

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
