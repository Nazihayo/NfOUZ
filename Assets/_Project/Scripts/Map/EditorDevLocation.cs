#if UNITY_EDITOR
using System.Globalization;
using UnityEditor;
using UnityEngine;

namespace Nfouz.Map
{
    /// <summary>
    /// Development only, Unity Editor only: a fixed location the Editor
    /// reports instead of GPS (the Editor has none), so a laptop player can
    /// stand next to a phone player for a two-client battle test. Stored in
    /// this machine's EditorPrefs, never in a scene, an asset or Git, and
    /// compiled out of every player build (UNITY_EDITOR). The server
    /// validates it like any other location update.
    /// Tools → NFOUZ → Dev Location.
    /// </summary>
    public static class EditorDevLocation
    {
        private const string EnabledKey = "Nfouz.DevLocation.Enabled";
        private const string LatKey = "Nfouz.DevLocation.Lat";
        private const string LngKey = "Nfouz.DevLocation.Lng";

        public static bool Enabled => EditorPrefs.GetBool(EnabledKey, false) && TryGet(out _, out _);

        public static bool TryGet(out double lat, out double lng)
        {
            lng = 0;
            return double.TryParse(EditorPrefs.GetString(LatKey, ""), NumberStyles.Float, CultureInfo.InvariantCulture, out lat) &&
                   double.TryParse(EditorPrefs.GetString(LngKey, ""), NumberStyles.Float, CultureInfo.InvariantCulture, out lng) &&
                   IsValid(lat, lng);
        }

        /// <summary>Plain latitude/longitude range check.</summary>
        public static bool IsValid(double lat, double lng) =>
            lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat == 0 && lng == 0);

        private class Window : EditorWindow
        {
            private bool _enabled;
            private string _lat;
            private string _lng;

            [MenuItem("Tools/NFOUZ/Dev Location")]
            private static void Open() => GetWindow<Window>(true, "NFOUZ Dev Location");

            private void OnEnable()
            {
                _enabled = EditorPrefs.GetBool(EnabledKey, false);
                _lat = EditorPrefs.GetString(LatKey, "");
                _lng = EditorPrefs.GetString(LngKey, "");
            }

            private void OnGUI()
            {
                EditorGUILayout.HelpBox(
                    "Editor only. The Editor reports this location instead of GPS. " +
                    "Saved on this computer only, never in Git or in a build. " +
                    "Use a point a few meters from the phone; restart Play after a change.",
                    MessageType.Info);
                _enabled = EditorGUILayout.Toggle("Use dev location", _enabled);
                _lat = EditorGUILayout.TextField("Latitude (e.g. 48.1371)", _lat);
                _lng = EditorGUILayout.TextField("Longitude (e.g. 11.5754)", _lng);

                var ok = double.TryParse(_lat, NumberStyles.Float, CultureInfo.InvariantCulture, out var lat) &&
                         double.TryParse(_lng, NumberStyles.Float, CultureInfo.InvariantCulture, out var lng) &&
                         IsValid(lat, lng);
                if (!ok && (_lat.Length > 0 || _lng.Length > 0))
                {
                    EditorGUILayout.HelpBox("Use a dot, not a comma (48.1371).", MessageType.Warning);
                }

                if (GUILayout.Button("Save"))
                {
                    EditorPrefs.SetBool(EnabledKey, _enabled && ok);
                    EditorPrefs.SetString(LatKey, _lat.Trim());
                    EditorPrefs.SetString(LngKey, _lng.Trim());
                    Debug.Log($"[EditorDevLocation] Dev location {(_enabled && ok ? "on" : "off")}.");
                }
            }
        }
    }
}
#endif
