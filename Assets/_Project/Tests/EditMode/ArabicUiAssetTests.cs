using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using NUnit.Framework;
using RTLTMPro;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// Editor-only checks of the Arabic UI as Unity loads it: every scene in
    /// Build Settings and every project prefab uses TextMeshPro/RTLTMPro, and
    /// the project font (TMP Settings → Default Font Asset, plus its
    /// fallbacks) has every glyph the UI draws. The same rules are checked
    /// without Unity by backend/tests/unity/uiText.test.js.
    /// </summary>
    public class ArabicUiAssetTests
    {
        private const string PrefabsFolder = "Assets/_Project/Prefabs";

        private static IEnumerable<GameObject> PrefabRoots()
        {
            foreach (var guid in AssetDatabase.FindAssets("t:Prefab", new[] { PrefabsFolder }))
            {
                yield return AssetDatabase.LoadAssetAtPath<GameObject>(AssetDatabase.GUIDToAssetPath(guid));
            }
        }

        /// <summary>Runs check on every Build Settings scene (opened additively
        /// and closed again; a scene already open in the Editor is used as is).</summary>
        private static void ForEachScene(Action<string, GameObject[]> check)
        {
            foreach (var entry in EditorBuildSettings.scenes.Where(s => s.enabled))
            {
                var loaded = SceneManager.GetSceneByPath(entry.path);
                var openedHere = !loaded.isLoaded;
                var scene = openedHere ? EditorSceneManager.OpenScene(entry.path, OpenSceneMode.Additive) : loaded;
                try
                {
                    check(entry.path, scene.GetRootGameObjects());
                }
                finally
                {
                    if (openedHere)
                    {
                        EditorSceneManager.CloseScene(scene, true);
                    }
                }
            }
        }

        private static void CheckComponents(string where, GameObject root, List<string> problems, List<string> texts)
        {
            foreach (var legacy in root.GetComponentsInChildren<UnityEngine.UI.Text>(true))
            {
                problems.Add($"{where}: legacy Text on {legacy.name}");
            }

            foreach (var legacy in root.GetComponentsInChildren<UnityEngine.UI.InputField>(true))
            {
                problems.Add($"{where}: legacy InputField on {legacy.name}");
            }

            var inputTexts = new HashSet<TMP_Text>();
            foreach (var input in root.GetComponentsInChildren<TMP_InputField>(true))
            {
                if (input.textComponent == null || input.textViewport == null || input.placeholder == null)
                {
                    problems.Add($"{where}: TMP_InputField {input.name} is missing its text component, viewport or placeholder");
                    continue;
                }

                inputTexts.Add(input.textComponent);
            }

            foreach (var text in root.GetComponentsInChildren<TMP_Text>(true))
            {
                var isRtl = text is RTLTextMeshPro || text is RTLTextMeshPro3D;
                if (!isRtl && !inputTexts.Contains(text))
                {
                    problems.Add($"{where}: {text.name} is {text.GetType().Name}, labels must be RTLTextMeshPro");
                }

                texts.Add(text is RTLTextMeshPro rtl ? rtl.OriginalText : text is RTLTextMeshPro3D rtl3D ? rtl3D.OriginalText : text.text);
            }
        }

        [Test]
        public void ScenesAndPrefabs_UseTextMeshProAndRtlLabelsOnly()
        {
            var problems = new List<string>();
            var texts = new List<string>();
            ForEachScene((path, roots) =>
            {
                foreach (var root in roots)
                {
                    CheckComponents(path, root, problems, texts);
                }
            });
            foreach (var prefab in PrefabRoots())
            {
                CheckComponents(AssetDatabase.GetAssetPath(prefab), prefab, problems, texts);
            }

            Assert.IsEmpty(problems, string.Join("\n", problems));
        }

        /// <summary>Arabic string literals in the project's scripts — the
        /// messages code puts on screen.</summary>
        private static IEnumerable<string> ScriptMessages()
        {
            var literal = new Regex("\\$?\"((?:[^\"\\\\\\n]|\\\\.)*)\"");
            var hole = new Regex("\\{[^{}]*\\}");
            foreach (var file in Directory.GetFiles(Path.Combine(Application.dataPath, "_Project/Scripts"), "*.cs", SearchOption.AllDirectories))
            {
                foreach (var line in File.ReadAllLines(file))
                {
                    if (line.TrimStart().StartsWith("//", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    foreach (Match m in literal.Matches(line))
                    {
                        var body = m.Groups[1].Value;
                        if (!Regex.IsMatch(body, "[\u0600-\u06FF]"))
                        {
                            continue;
                        }

                        body = hole.Replace(body, "100").Replace("\\u200F", "\u200F").Replace("\\\"", "\"").Replace("\\n", "\n");
                        yield return body;
                    }
                }
            }
        }

        private static string Shaped(string text)
        {
            if (string.IsNullOrEmpty(text) || !TextUtils.IsRTLInput(text))
            {
                return text ?? string.Empty;
            }

            var output = new FastStringBuilder(RTLSupport.DefaultBufferSize);
            RTLSupport.FixRTL(text, output, false, true, true);
            return output.ToString();
        }

        [Test]
        public void ProjectFont_HasEveryGlyphTheUiDraws()
        {
            Assert.IsNotNull(TMP_Settings.instance, "TMP Settings not found: import Window > TextMeshPro > Import TMP Essential Resources.");
            var font = TMP_Settings.defaultFontAsset;
            Assert.IsNotNull(font, "TMP Settings has no Default Font Asset (see HANDOFF, Arabic font).");

            var texts = new List<string>();
            var ignored = new List<string>();
            ForEachScene((path, roots) =>
            {
                foreach (var root in roots)
                {
                    CheckComponents(path, root, ignored, texts);
                }
            });
            foreach (var prefab in PrefabRoots())
            {
                CheckComponents(AssetDatabase.GetAssetPath(prefab), prefab, ignored, texts);
            }

            texts.AddRange(ScriptMessages());

            var needed = new StringBuilder();
            foreach (var text in texts)
            {
                foreach (var c in Shaped(text))
                {
                    if (!char.IsWhiteSpace(c) && !char.IsControl(c) && c != '\u200F')
                    {
                        needed.Append(c);
                    }
                }
            }

            var all = new string(needed.ToString().Distinct().OrderBy(c => c).ToArray());
            var complete = font.HasCharacters(all, out uint[] missing, true, false);
            var report = missing == null ? "(font has no character table)" : string.Join(" ", missing.Select(u => $"U+{u:X4} '{char.ConvertFromUtf32((int)u)}'"));
            Assert.IsTrue(complete,
                $"Font '{font.name}' (with its fallbacks) is missing {missing?.Length} of {all.Length} characters the UI draws: {report}");
        }
    }
}
