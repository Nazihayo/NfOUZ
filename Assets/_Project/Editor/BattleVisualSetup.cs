using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace Nfouz.EditorTools
{
    /// <summary>
    /// Editor only. Gives the Battle scene a more natural look without
    /// touching gameplay: a procedural sky, a warm low sun with soft shadows,
    /// a sky/equator/ground ambient, and one global post-processing Volume
    /// (ACES tonemapping, light bloom, small contrast and saturation lift,
    /// soft vignette) on the battle camera. Mobile budget: one uber post pass
    /// plus a low-quality bloom; no screen-space effects.
    ///
    /// Idempotent: run it again and it updates the same objects and assets.
    /// Tools → NFOUZ → Battle Visuals → Apply to Battle scene, or batchmode:
    /// -executeMethod Nfouz.EditorTools.BattleVisualSetup.ApplyBatch
    /// </summary>
    public static class BattleVisualSetup
    {
        public const string ScenePath = "Assets/_Project/Scenes/Battle.unity";
        public const string Folder = "Assets/_Project/Art/Rendering";
        public const string ProfilePath = Folder + "/BattleVolumeProfile.asset";
        public const string SkyPath = Folder + "/BattleSky.mat";
        public const string VolumeName = "BattleVolume";

        [MenuItem("Tools/NFOUZ/Battle Visuals/Apply to Battle scene")]
        public static void ApplyFromMenu()
        {
            var scene = SceneManager.GetActiveScene();
            if (scene.path != ScenePath)
            {
                if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
                scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            }
            Apply(scene);
            Debug.Log("[BattleVisualSetup] Applied. Review the scene, then File > Save.");
        }

        /// <summary>Batchmode entry: opens Battle, applies, saves.</summary>
        public static void ApplyBatch()
        {
            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            Apply(scene);
            EditorSceneManager.SaveScene(scene);
            AssetDatabase.SaveAssets();
            Debug.Log("[BattleVisualSetup] Applied and saved " + ScenePath);
        }

        public static void Apply(Scene scene)
        {
            EnsureFolder();
            var sun = FindSun(scene);
            ApplySun(sun);
            ApplySkyAndAmbient(sun);
            var profile = CreateOrUpdateProfile();
            EnsureVolume(scene, profile);
            EnableCameraPostProcessing(scene);
            EditorSceneManager.MarkSceneDirty(scene);
        }

        private static void EnsureFolder()
        {
            if (!AssetDatabase.IsValidFolder(Folder))
                AssetDatabase.CreateFolder("Assets/_Project/Art", "Rendering");
        }

        private static Light FindSun(Scene scene)
        {
            foreach (var root in scene.GetRootGameObjects())
                foreach (var light in root.GetComponentsInChildren<Light>(true))
                    if (light.type == LightType.Directional) return light;
            return null;
        }

        private static void ApplySun(Light sun)
        {
            if (sun == null)
            {
                Debug.LogWarning("[BattleVisualSetup] No directional light in Battle; sun settings skipped.");
                return;
            }
            Undo.RecordObject(sun, "Battle sun");
            Undo.RecordObject(sun.transform, "Battle sun");
            // Late-afternoon sun: low enough for long readable shadows.
            sun.transform.rotation = Quaternion.Euler(38f, -35f, 0f);
            sun.color = new Color(1f, 0.92f, 0.8f);
            sun.intensity = 1.3f;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = 0.85f;
        }

        private static void ApplySkyAndAmbient(Light sun)
        {
            var sky = AssetDatabase.LoadAssetAtPath<Material>(SkyPath);
            if (sky == null)
            {
                var shader = Shader.Find("Skybox/Procedural");
                if (shader == null)
                {
                    Debug.LogWarning("[BattleVisualSetup] Skybox/Procedural shader not found; sky skipped.");
                }
                else
                {
                    sky = new Material(shader) { name = "BattleSky" };
                    AssetDatabase.CreateAsset(sky, SkyPath);
                }
            }
            if (sky != null)
            {
                sky.SetFloat("_SunSize", 0.035f);
                sky.SetFloat("_AtmosphereThickness", 1.1f);
                sky.SetColor("_SkyTint", new Color(0.52f, 0.6f, 0.7f));
                sky.SetColor("_GroundColor", new Color(0.33f, 0.31f, 0.29f));
                sky.SetFloat("_Exposure", 1.15f);
                EditorUtility.SetDirty(sky);
                RenderSettings.skybox = sky;
            }
            if (sun != null) RenderSettings.sun = sun;

            // Trilight: cheap on phones and does not depend on baked probes.
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.55f, 0.62f, 0.72f);
            RenderSettings.ambientEquatorColor = new Color(0.42f, 0.42f, 0.4f);
            RenderSettings.ambientGroundColor = new Color(0.2f, 0.18f, 0.16f);

            // Light haze so the far edge of the arena does not end in a hard line.
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = new Color(0.7f, 0.74f, 0.78f);
            RenderSettings.fogStartDistance = 25f;
            RenderSettings.fogEndDistance = 120f;
        }

        private static VolumeProfile CreateOrUpdateProfile()
        {
            var profile = AssetDatabase.LoadAssetAtPath<VolumeProfile>(ProfilePath);
            if (profile == null)
            {
                profile = ScriptableObject.CreateInstance<VolumeProfile>();
                AssetDatabase.CreateAsset(profile, ProfilePath);
            }

            var tone = Get<Tonemapping>(profile);
            tone.mode.Override(TonemappingMode.ACES);

            var bloom = Get<Bloom>(profile);
            bloom.threshold.Override(1.1f);
            bloom.intensity.Override(0.35f);
            bloom.scatter.Override(0.6f);
            bloom.highQualityFiltering.Override(false);

            var color = Get<ColorAdjustments>(profile);
            color.postExposure.Override(0.15f);
            color.contrast.Override(12f);
            color.saturation.Override(8f);

            var vignette = Get<Vignette>(profile);
            vignette.intensity.Override(0.22f);
            vignette.smoothness.Override(0.45f);

            EditorUtility.SetDirty(profile);
            AssetDatabase.SaveAssets();
            return profile;
        }

        // Volume components must be sub-assets of the profile, or they are
        // lost when the project reloads.
        private static T Get<T>(VolumeProfile profile) where T : VolumeComponent
        {
            if (profile.TryGet(out T existing)) return existing;
            var added = profile.Add<T>(true);
            added.name = typeof(T).Name;
            AssetDatabase.AddObjectToAsset(added, profile);
            return added;
        }

        private static void EnsureVolume(Scene scene, VolumeProfile profile)
        {
            GameObject go = null;
            foreach (var root in scene.GetRootGameObjects())
                if (root.name == VolumeName) { go = root; break; }
            if (go == null)
            {
                go = new GameObject(VolumeName);
                SceneManager.MoveGameObjectToScene(go, scene);
                Undo.RegisterCreatedObjectUndo(go, "Battle volume");
            }
            // Not `??`: Unity's fake-null for a missing component is not C# null.
            var volume = go.GetComponent<Volume>();
            if (volume == null) volume = go.AddComponent<Volume>();
            volume.isGlobal = true;
            volume.priority = 10f;
            volume.weight = 1f;
            volume.sharedProfile = profile;
            EditorUtility.SetDirty(volume);
        }

        private static void EnableCameraPostProcessing(Scene scene)
        {
            var count = 0;
            foreach (var root in scene.GetRootGameObjects())
                foreach (var cam in root.GetComponentsInChildren<Camera>(true))
                {
                    var data = cam.GetUniversalAdditionalCameraData();
                    data.renderPostProcessing = true;
                    data.antialiasing = AntialiasingMode.FastApproximateAntialiasing;
                    EditorUtility.SetDirty(data);
                    count++;
                }
            if (count == 0)
                Debug.LogWarning("[BattleVisualSetup] No camera in Battle; post-processing not enabled.");
        }
    }
}
