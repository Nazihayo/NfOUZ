using UnityEngine;

namespace Nfouz.Utils
{
    public enum ApiEnvironment
    {
        Development,
        Staging,
        Production,
    }

    /// <summary>
    /// Which backend the client talks to, per build context. Loaded from
    /// Resources/ApiEnvironmentSettings.asset by GameManager when it
    /// configures ApiClient. URLs are not secrets; credentials never go here.
    ///
    /// Safety rule: the Production API is never used from the Editor or from
    /// a Development Build, whatever the asset says — those contexts are
    /// redirected to Development. An environment with no URL set disables
    /// API calls (ApiClient refuses to send) instead of falling back to
    /// another environment.
    /// </summary>
    [CreateAssetMenu(fileName = "ApiEnvironmentSettings", menuName = "NFOUZ/API Environment Settings")]
    public class ApiEnvironmentSettings : ScriptableObject
    {
        public const string ResourcePath = "ApiEnvironmentSettings";

        [Header("Base URLs (no trailing slash)")]
        [Tooltip("Local backend (backend/: npm run dev). On a phone, use this machine's LAN address instead of localhost.")]
        [SerializeField] private string developmentBaseUrl = "http://localhost:3000";
        [Tooltip("Leave empty until a staging backend exists; selecting Staging with no URL disables API calls.")]
        [SerializeField] private string stagingBaseUrl = "";
        [SerializeField] private string productionBaseUrl = Constants.Api.BaseUrl;

        [Header("Environment per build context")]
        [SerializeField] private ApiEnvironment editorEnvironment = ApiEnvironment.Development;
        [SerializeField] private ApiEnvironment developmentBuildEnvironment = ApiEnvironment.Development;
        [SerializeField] private ApiEnvironment releaseBuildEnvironment = ApiEnvironment.Production;

        /// <summary>Base URL for the current run context, after the safety rule.
        /// Returns an empty string (API calls disabled) when the selected
        /// environment has no URL configured.</summary>
        public static string ResolveBaseUrl()
        {
            var settings = Resources.Load<ApiEnvironmentSettings>(ResourcePath);
            if (settings == null)
            {
                Debug.LogWarning($"[ApiEnvironment] Resources/{ResourcePath} not found — using built-in Development defaults.");
                settings = CreateInstance<ApiEnvironmentSettings>();
            }

            var isTestContext = Application.isEditor || Debug.isDebugBuild;
            var requested = Application.isEditor ? settings.editorEnvironment
                : Debug.isDebugBuild ? settings.developmentBuildEnvironment
                : settings.releaseBuildEnvironment;

            var environment = ApiEnvironmentResolver.Resolve(requested, isTestContext);
            if (environment != requested)
            {
                Debug.LogError($"[ApiEnvironment] {requested} API is blocked in the Editor and Development Builds — using {environment}.");
            }

            var baseUrl = settings.UrlFor(environment);
            if (string.IsNullOrWhiteSpace(baseUrl))
            {
                Debug.LogError($"[ApiEnvironment] No base URL set for {environment} in {ResourcePath} — API calls are disabled.");
                return string.Empty;
            }

            Debug.Log($"[ApiEnvironment] Using {environment} API: {baseUrl}");
            return baseUrl.Trim();
        }

        private string UrlFor(ApiEnvironment environment)
        {
            switch (environment)
            {
                case ApiEnvironment.Staging: return stagingBaseUrl;
                case ApiEnvironment.Production: return productionBaseUrl;
                default: return developmentBaseUrl;
            }
        }
    }

    /// <summary>
    /// Pure environment-selection rule, Unity-free so it can be exercised
    /// directly by an EditMode test (see ApiEnvironmentResolverTests).
    /// </summary>
    public static class ApiEnvironmentResolver
    {
        public static ApiEnvironment Resolve(ApiEnvironment requested, bool isTestContext)
        {
            if (requested == ApiEnvironment.Production && isTestContext)
            {
                return ApiEnvironment.Development;
            }

            return requested;
        }
    }
}
