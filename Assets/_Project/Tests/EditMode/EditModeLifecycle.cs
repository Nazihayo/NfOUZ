using System.Reflection;
using UnityEngine;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// In EditMode, Unity does not call Awake/OnEnable/OnDisable on a
    /// component added with AddComponent unless its class is marked
    /// [ExecuteAlways]. Tests that depend on what those methods set up
    /// (a cached GetComponent, a static event subscription) call them
    /// here instead, without changing the runtime scripts.
    /// Update() and coroutines still do not run in EditMode.
    /// </summary>
    internal static class EditModeLifecycle
    {
        private const BindingFlags InstanceMethods =
            BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

        /// <summary>Calls Awake, then OnEnable, if the component declares them.</summary>
        public static T Start<T>(T component) where T : MonoBehaviour
        {
            Invoke(component, "Awake");
            Invoke(component, "OnEnable");
            return component;
        }

        /// <summary>Calls OnDisable, so static event subscriptions made in
        /// OnEnable don't outlive the test (DestroyImmediate won't call it).</summary>
        public static void Stop(MonoBehaviour component)
        {
            Invoke(component, "OnDisable");
        }

        private static void Invoke(MonoBehaviour component, string methodName)
        {
            var method = component.GetType().GetMethod(methodName, InstanceMethods, null, System.Type.EmptyTypes, null);
            method?.Invoke(component, null);
        }
    }
}
