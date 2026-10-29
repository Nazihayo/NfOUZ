using System;

namespace Nfouz.Networking
{
    /// <summary>
    /// Floating movement stick for phones: the finger's start point is the
    /// stick's centre, and how far it has moved (up to RadiusPixels) is the
    /// movement input, the same -1..1 Horizontal/Vertical values the
    /// keyboard gives in the Editor (NetworkInputData.SampleLocal). It only
    /// feeds the approved "free movement inside the Arena" (Battle System
    /// v1.0 §2): no speed, aim or other rule changes. Unity-free, so it is
    /// covered by EditMode tests.
    /// </summary>
    public static class TouchStickMath
    {
        /// <summary>Movement below this share of the radius counts as none,
        /// so a resting thumb does not drift.</summary>
        public const float DeadZone = 0.15f;

        /// <summary>The stick only starts from a touch in this share of the
        /// screen width on the left; the action buttons sit bottom-centre.
        /// Left is the thumb-stick side players know from other mobile
        /// games, also in Arabic ones; RTL mirroring applies to text and
        /// layout, not to this control (owner may revisit).</summary>
        public const float ZoneWidthShare = 0.4f;

        /// <summary>…and in this share of the screen height from the bottom,
        /// leaving the top for the timer and health bars.</summary>
        public const float ZoneHeightShare = 0.7f;

        public static bool StartsInZone(float x, float y, float screenWidth, float screenHeight)
        {
            return screenWidth > 0f && screenHeight > 0f &&
                   x >= 0f && x <= screenWidth * ZoneWidthShare &&
                   y >= 0f && y <= screenHeight * ZoneHeightShare;
        }

        /// <summary>The stick radius in pixels: about 1.5 cm on a typical
        /// phone, from the screen's shorter side (Screen.dpi is unreliable on
        /// Android).</summary>
        public static float RadiusPixels(float screenWidth, float screenHeight)
        {
            return Math.Max(40f, Math.Min(screenWidth, screenHeight) * 0.12f);
        }

        /// <summary>The input for a finger that started at (originX, originY)
        /// and is now at (x, y): length 0 inside the dead zone, at most 1,
        /// scaled so the edge of the dead zone is 0. Screen y grows upwards
        /// in Unity's Input.touches, so up on the screen is +Z (forward),
        /// as the Vertical axis.</summary>
        public static void Evaluate(float originX, float originY, float x, float y, float radius,
            out float moveX, out float moveZ)
        {
            moveX = 0f;
            moveZ = 0f;
            if (radius <= 0f || float.IsNaN(x) || float.IsNaN(y) || float.IsNaN(originX) || float.IsNaN(originY))
            {
                return;
            }

            var dx = (x - originX) / radius;
            var dy = (y - originY) / radius;
            var length = (float)Math.Sqrt(dx * dx + dy * dy);
            if (length <= DeadZone)
            {
                return;
            }

            var scaled = Math.Min(1f, (length - DeadZone) / (1f - DeadZone));
            moveX = dx / length * scaled;
            moveZ = dy / length * scaled;
        }
    }
}
