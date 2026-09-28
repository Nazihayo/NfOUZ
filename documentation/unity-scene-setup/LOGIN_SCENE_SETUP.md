# Login Scene — Setup Specification

Matches `AuthController.cs` (`Nfouz.Auth`) delivered in Sprint 2.

---

## 1. Scene file

`Assets/_Project/Scenes/Login.unity` — add to Build Settings immediately after `Boot`.

---

## 2. Hierarchy

```
Login (Scene root)
└── Canvas_Login                       [Canvas, CanvasScaler, GraphicRaycaster]
      ├── LoginPanel                   [GameObject, active by default]
      │     ├── UsernameInput          -> actually EmailInput (TMP_InputField)
      │     ├── PasswordInput          [TMP_InputField, Content Type: Password]
      │     ├── LoginButton            [Button + TMP text "تسجيل الدخول"]
      │     └── SwitchToRegisterButton [Button + TMP text "إنشاء حساب جديد"]
      ├── RegisterPanel                [GameObject, INACTIVE by default]
      │     ├── EmailInput             [TMP_InputField]
      │     ├── PasswordInput          [TMP_InputField, Content Type: Password]
      │     ├── ConfirmPasswordInput   [TMP_InputField, Content Type: Password]
      │     └── RegisterButton         [Button + TMP text "تسجيل"]
      └── ErrorMessageText             [TMP_Text, INACTIVE until first error]
```

`AuthController` sits on `Canvas_Login` itself (one component, not a MonoBehaviour per panel).

---

## 3. Inspector wiring

| UI Element | Event | Handler |
|---|---|---|
| `LoginButton.OnClick` | Button | `AuthController.OnLoginButtonPressed(EmailInput.text, PasswordInput.text)` — wire via a small local wrapper script or UnityEvent with dynamic string args, since `OnClick` cannot pass two TMP field values directly: add a one-line `LoginPanelBridge.cs` (trivial, not shown here) or call from a wrapper method with no parameters that reads the fields itself. |
| `RegisterButton.OnClick` | Button | Same pattern, calling `AuthController.OnRegisterButtonPressed(...)`. |
| `SwitchToRegisterButton.OnClick` | Button | Toggles `LoginPanel.SetActive(false)` / `RegisterPanel.SetActive(true)`. |
| `AuthController.OnAuthError` | C# event | Subscribed by a small UI script that sets `ErrorMessageText.text` and `SetActive(true)`. |

> Practical note: since `UnityEvent` in the Inspector cannot forward two `TMP_InputField.text` values as parameters to `AuthController`'s methods, the standard pattern is a thin scene-local script (e.g. `LoginPanelBridge : MonoBehaviour`) with a public parameterless `OnLoginClicked()` that reads its own serialized `TMP_InputField` references and forwards to `AuthController`. This bridge is UI glue, not domain logic, and is intentionally left for the UI implementer to wire per the team's exact prefab layout.

---

## 4. Dependencies

- `GameManager` (from Boot) must already be alive — `AuthController.Awake()` calls `ServiceLocator.Instance.Get<FirebaseManager>()` and `Get<ApiClient>()`, both of which throw a logged error if `ServiceLocator` hasn't been populated yet.
- Requires `FIREBASE_AUTH_AVAILABLE` scripting define + imported Firebase SDK to actually authenticate; without it, `FirebaseManager` methods return `(false, "Firebase SDK not available in this build.")` and `AuthController` surfaces that via `OnAuthError`.

---

## 5. Verification steps

1. Press Play on `Login.unity` directly (with `Boot` having run at least once, or via the full Boot → Login flow).
2. Enter an invalid email → confirm `ErrorMessageText` shows the Arabic validation message, no network call is attempted.
3. With `FIREBASE_AUTH_AVAILABLE` defined and a real project configured: register a new account → scene transitions to `Onboarding.unity`. Sign in with an existing account that has no player row yet → also transitions to `Onboarding.unity`. Sign in with a fully registered account → transitions to `MainMap.unity`.
