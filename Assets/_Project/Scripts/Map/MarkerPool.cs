using System.Collections.Generic;
using UnityEngine;

namespace Nfouz.Map
{
    /// <summary>
    /// Generic object pool for a single marker prefab. Prevents the
    /// "excessive Instantiate/Destroy calls" and "marker leaks" problems
    /// called out in the Sprint 4 requirements: markers are deactivated
    /// and returned to the pool instead of destroyed, then reused on the
    /// next Get() call. See Unity MVP Implementation Plan v1.0, Phase 4.
    /// </summary>
    public class MarkerPool : MonoBehaviour
    {
        [SerializeField] private GameObject markerPrefab;
        [SerializeField] private Transform poolParent;
        [SerializeField] private int prewarmCount = 10;
        [SerializeField] private int maxPoolSize = 200;

        private readonly Stack<GameObject> _available = new Stack<GameObject>();
        private readonly HashSet<GameObject> _inUse = new HashSet<GameObject>();

        public int AvailableCount => _available.Count;
        public int InUseCount => _inUse.Count;

        private void Awake()
        {
            if (poolParent == null)
            {
                poolParent = transform;
            }

            Prewarm();
        }

        private void Prewarm()
        {
            if (markerPrefab == null)
            {
                Debug.LogError("[MarkerPool] No markerPrefab assigned — cannot prewarm.");
                return;
            }

            for (var i = 0; i < prewarmCount; i++)
            {
                var instance = CreateNewInstance();
                instance.SetActive(false);
                _available.Push(instance);
            }
        }

        private GameObject CreateNewInstance()
        {
            var instance = Instantiate(markerPrefab, poolParent);
            return instance;
        }

        /// <summary>Retrieves a marker instance, reusing a pooled one when
        /// available and creating a new one only when the pool is empty
        /// and under maxPoolSize.</summary>
        public GameObject Get(Vector3 position)
        {
            GameObject instance;

            if (_available.Count > 0)
            {
                instance = _available.Pop();
            }
            else if (_inUse.Count < maxPoolSize)
            {
                instance = CreateNewInstance();
            }
            else
            {
                Debug.LogWarning($"[MarkerPool] Pool exhausted at max size {maxPoolSize} — reusing oldest instance is not supported; returning null.");
                return null;
            }

            instance.transform.position = position;
            instance.transform.SetParent(null, true);
            instance.SetActive(true);
            _inUse.Add(instance);
            return instance;
        }

        /// <summary>Returns a marker to the pool for reuse instead of
        /// destroying it. Safe to call with an instance not currently
        /// tracked (no-op with a warning).</summary>
        public void Release(GameObject instance)
        {
            if (instance == null)
            {
                return;
            }

            if (!_inUse.Remove(instance))
            {
                Debug.LogWarning("[MarkerPool] Release() called with an instance not tracked as in-use.");
                return;
            }

            instance.SetActive(false);
            instance.transform.SetParent(poolParent, true);
            _available.Push(instance);
        }

        /// <summary>Releases every currently in-use marker. Used when
        /// leaving MainMap entirely (e.g. entering Battle) to avoid stale
        /// markers persisting across scene transitions.</summary>
        public void ReleaseAll()
        {
            var toRelease = new List<GameObject>(_inUse);
            foreach (var instance in toRelease)
            {
                Release(instance);
            }
        }
    }
}
