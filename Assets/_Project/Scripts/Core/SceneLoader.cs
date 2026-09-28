using System;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Nfouz.Core
{
    /// <summary>
    /// Thin async wrapper around Unity's SceneManager, used by every
    /// controller that needs to move the player between scenes
    /// (Login -> Onboarding -> MainMap -> Battle -> Result, etc.).
    /// </summary>
    public static class SceneLoader
    {
        public static event Action<string> OnSceneLoadStarted;
        public static event Action<string> OnSceneLoadCompleted;

        /// <summary>
        /// Loads a scene by name asynchronously and awaits completion.
        /// </summary>
        public static async Task LoadAsync(string sceneName, LoadSceneMode mode = LoadSceneMode.Single)
        {
            if (string.IsNullOrEmpty(sceneName))
            {
                Debug.LogError("[SceneLoader] Attempted to load a scene with a null or empty name.");
                return;
            }

            OnSceneLoadStarted?.Invoke(sceneName);

            var operation = SceneManager.LoadSceneAsync(sceneName, mode);
            if (operation == null)
            {
                Debug.LogError($"[SceneLoader] Failed to start loading scene '{sceneName}'. " +
                                 "Confirm it is added to Build Settings.");
                return;
            }

            while (!operation.isDone)
            {
                await Task.Yield();
            }

            OnSceneLoadCompleted?.Invoke(sceneName);
        }

        /// <summary>Synchronous convenience wrapper for call sites that cannot await
        /// (e.g. UI button OnClick handlers) — fires the async load and does not block.</summary>
        public static void Load(string sceneName, LoadSceneMode mode = LoadSceneMode.Single)
        {
            _ = LoadAsync(sceneName, mode);
        }
    }
}
