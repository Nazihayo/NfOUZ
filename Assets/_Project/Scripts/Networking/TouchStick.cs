using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;

namespace Nfouz.Networking
{
    /// <summary>
    /// This device's floating movement stick (see TouchStickMath). Tracks one
    /// finger that started in the stick zone and not on a UI element (the
    /// action buttons). BattleScreen calls Tick() once per frame, because a
    /// touch can begin and end between two network input samples;
    /// NetworkInputData.SampleLocal reads MoveX/MoveZ. Uses the Input Manager
    /// (Old), the project's active input handling.
    /// </summary>
    public static class TouchStick
    {
        private const int NoFinger = -1;

        private static int _fingerId = NoFinger;
        private static Vector2 _origin;
        private static readonly List<RaycastResult> UiHits = new List<RaycastResult>();

        public static float MoveX { get; private set; }
        public static float MoveZ { get; private set; }

        public static void Tick()
        {
            var touchCount = Input.touchCount;
            var tracked = false;
            for (var i = 0; i < touchCount; i++)
            {
                var touch = Input.GetTouch(i);
                if (_fingerId == NoFinger && touch.phase == TouchPhase.Began &&
                    TouchStickMath.StartsInZone(touch.position.x, touch.position.y, Screen.width, Screen.height) &&
                    !IsOverUi(touch.position))
                {
                    _fingerId = touch.fingerId;
                    _origin = touch.position;
                }

                if (touch.fingerId != _fingerId)
                {
                    continue;
                }

                if (touch.phase == TouchPhase.Ended || touch.phase == TouchPhase.Canceled)
                {
                    break;
                }

                tracked = true;
                TouchStickMath.Evaluate(_origin.x, _origin.y, touch.position.x, touch.position.y,
                    TouchStickMath.RadiusPixels(Screen.width, Screen.height), out var x, out var z);
                MoveX = x;
                MoveZ = z;
            }

            if (!tracked)
            {
                Reset();
            }
        }

        public static void Reset()
        {
            _fingerId = NoFinger;
            MoveX = 0f;
            MoveZ = 0f;
        }

        /// <summary>Raycasts the UI at the touch directly: on a touch's first
        /// frame IsPointerOverGameObject(fingerId) can still be false, and
        /// the attack button lies inside the stick zone on narrow screens.</summary>
        private static bool IsOverUi(Vector2 screenPosition)
        {
            var eventSystem = EventSystem.current;
            if (eventSystem == null)
            {
                return false;
            }

            UiHits.Clear();
            eventSystem.RaycastAll(new PointerEventData(eventSystem) { position = screenPosition }, UiHits);
            return UiHits.Count > 0;
        }
    }
}
