using System;
using System.Collections.Generic;
using UnityEngine;

namespace Nfouz.Core
{
    /// <summary>
    /// Minimal service locator used for the small set of process-wide singletons
    /// (ApiClient, FirebaseManager, PlayerSession). Registered once in
    /// GameManager.Awake() on the Boot scene and never re-created afterward.
    /// </summary>
    public class ServiceLocator : MonoBehaviour
    {
        private static ServiceLocator _instance;
        private readonly Dictionary<Type, object> _services = new Dictionary<Type, object>();

        public static ServiceLocator Instance
        {
            get
            {
                if (_instance == null)
                {
                    Debug.LogError("[ServiceLocator] Accessed before initialization. " +
                                    "Ensure GameManager runs in the Boot scene first.");
                }
                return _instance;
            }
        }

        private void Awake()
        {
            if (_instance != null && _instance != this)
            {
                Destroy(gameObject);
                return;
            }

            _instance = this;
            DontDestroyOnLoad(gameObject);
        }

        public void Register<T>(T service) where T : class
        {
            var type = typeof(T);
            if (_services.ContainsKey(type))
            {
                Debug.LogWarning($"[ServiceLocator] Overwriting existing registration for {type.Name}.");
            }
            _services[type] = service;
        }

        public T Get<T>() where T : class
        {
            var type = typeof(T);
            if (_services.TryGetValue(type, out var service))
            {
                return service as T;
            }

            Debug.LogError($"[ServiceLocator] No service registered for type {type.Name}.");
            return null;
        }

        public bool TryGet<T>(out T service) where T : class
        {
            var type = typeof(T);
            if (_services.TryGetValue(type, out var raw))
            {
                service = raw as T;
                return service != null;
            }

            service = null;
            return false;
        }
    }
}
