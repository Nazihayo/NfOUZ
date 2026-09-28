using Nfouz.Core;
using UnityEngine;

namespace Nfouz.UI
{
    /// <summary>
    /// Sprint 10 — loading spinner/overlay shown during async scene loads
    /// (SceneLoader.OnSceneLoadStarted/OnSceneLoadCompleted — Core/SceneLoader.cs,
    /// not modified) and during in-flight API calls that a screen explicitly
    /// wraps with BeginApiCall/EndApiCall. Multiple overlapping callers (e.g.
    /// a scene load starting while a screen's own refresh call is still in
    /// flight) are coalesced by a simple reference count — the spinner only
    /// hides once every caller that asked for it has also released it. The
    /// counting itself lives in the plain LoadingCounter class below so it
    /// can be unit-tested without a GameObject — see
    /// Tests/EditMode/LoadingCounterTests.cs.
    /// </summary>
    public class LoadingManager : MonoBehaviour
    {
        [SerializeField] private GameObject spinnerRoot;

        private readonly LoadingCounter _counter = new LoadingCounter();

        private void Awake()
        {
            var locator = ServiceLocator.Instance;
            if (locator != null)
            {
                locator.Register<LoadingManager>(this);
            }

            SetVisible(false);
        }

        private void OnEnable()
        {
            SceneLoader.OnSceneLoadStarted += HandleSceneLoadStarted;
            SceneLoader.OnSceneLoadCompleted += HandleSceneLoadCompleted;
        }

        private void OnDisable()
        {
            SceneLoader.OnSceneLoadStarted -= HandleSceneLoadStarted;
            SceneLoader.OnSceneLoadCompleted -= HandleSceneLoadCompleted;
        }

        private void HandleSceneLoadStarted(string sceneName) => BeginLoading();
        private void HandleSceneLoadCompleted(string sceneName) => EndLoading();

        /// <summary>Call before starting an awaited API call whose latency
        /// the player should see a spinner for. Every BeginLoading must be
        /// matched by exactly one EndLoading (e.g. in a try/finally around
        /// the await), the same convention every Sprint 8/9 controller
        /// already uses for its own `_isRefreshing`-style guards.</summary>
        public void BeginLoading()
        {
            _counter.Increment();
            SetVisible(_counter.IsLoading);
        }

        public void EndLoading()
        {
            _counter.Decrement();
            SetVisible(_counter.IsLoading);
        }

        private void SetVisible(bool visible)
        {
            if (spinnerRoot != null)
            {
                spinnerRoot.SetActive(visible);
            }
        }
    }

    /// <summary>
    /// Pure reference-counted "is anything loading" flag — Unity-free so it
    /// can be exercised directly by an EditMode test.
    /// </summary>
    public class LoadingCounter
    {
        private int _count;

        public bool IsLoading => _count > 0;

        public void Increment()
        {
            _count++;
        }

        /// <summary>Floors at 0 — an unmatched extra EndLoading (a bug
        /// elsewhere) must never wrap around to a negative count and leave
        /// the spinner permanently "loading" after the next Increment.</summary>
        public void Decrement()
        {
            _count = Mathf.Max(0, _count - 1);
        }
    }
}
