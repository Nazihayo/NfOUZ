# Onboarding Scene — Setup Specification

Matches `OnboardingController.cs` (`Nfouz.Auth`) delivered in Sprint 2.

---

## 1. Scene file

`Assets/_Project/Scenes/Onboarding.unity` — added to Build Settings after `Login`.

---

## 2. Hierarchy

```
Onboarding (Scene root)
└── Canvas_Onboarding                  [Canvas, CanvasScaler, GraphicRaycaster]
      ├── ClassSelectionPanel          [GameObject, active by default]
      │     ├── ScoutCard              [ClassSelectionCard instance — see below]
      │     ├── RangerCard             [ClassSelectionCard instance]
      │     ├── TitanCard              [ClassSelectionCard instance]
      │     ├── UsernameInput          [TMP_InputField]
      │     └── ConfirmButton          [Button + TMP text "تأكيد"]
      └── ErrorMessageText             [TMP_Text, INACTIVE until first error]
```

`OnboardingController` sits on `Canvas_Onboarding`.

> AYAZ intro panel (formerly named NORA in the original UI/UX flow document — renamed per the global assistant rename) is **out of scope for Sprint 2** — this sprint implements only the functional registration path (class + username -> `/auth/register`). The AYAZ dialogue panel is a presentation-layer addition with no server dependency and can be added later without touching `OnboardingController.cs`.

---

## 3. `ClassSelectionCard` prefab (used 3×)

```
ClassSelectionCard                 [Prefab]
├── Background Image
├── ClassIcon Image
├── ClassNameText                  [TMP_Text — "Scout" / "Ranger" / "Titan"]
├── ClassDescriptionText           [TMP_Text]
└── SelectButton                   [Button, covers whole card]
```

Each of the 3 instances in the scene (`ScoutCard`, `RangerCard`, `TitanCard`) differs only in
its `ClassNameText`/`ClassDescriptionText`/`ClassIcon` content and in what its `SelectButton.OnClick`
forwards:

| Instance | `SelectButton.OnClick` calls |
|---|---|
| `ScoutCard` | `OnboardingController.OnClassSelected("Scout")` |
| `RangerCard` | `OnboardingController.OnClassSelected("Ranger")` |
| `TitanCard` | `OnboardingController.OnClassSelected("Titan")` |

Use `Constants.PlayerClass.Scout` / `.Ranger` / `.Titan` string constants when wiring this
via a bridge script rather than hardcoding string literals in the Inspector, to avoid typos
silently failing the `switch` in `OnboardingController.OnClassSelected`.

A simple visual "selected" highlight (e.g. toggling the `Background Image` color) is left to
the UI implementer — `OnboardingController` only tracks `_selectedClassType` internally, it
does not manage any visual selection state itself.

---

## 4. Inspector wiring

| UI Element | Event | Handler |
|---|---|---|
| Each card's `SelectButton.OnClick` | Button | `OnboardingController.OnClassSelected("Scout"\|"Ranger"\|"Titan")` |
| `ConfirmButton.OnClick` | Button | `OnboardingController.OnConfirmButtonPressed(UsernameInput.text)` — same bridge-script caveat as the Login scene (UnityEvent cannot forward `TMP_InputField.text` directly to a parameterized method reliably from the Inspector for arbitrary field references; a one-line bridge script reading `UsernameInput.text` and calling the controller is the standard pattern). |
| `OnboardingController.OnRegistrationError` | C# event | Sets `ErrorMessageText.text` + `SetActive(true)`. |
| `OnboardingController.OnRegistrationSucceeded` | C# event | Optional — scene already transitions to `MainMap` automatically inside `OnConfirmButtonPressed`; this event exists for any additional UI feedback (e.g. a brief success animation) before the scene unloads. |

---

## 5. Dependencies

- Requires an authenticated Firebase session already established in `Login.unity` — `ApiClient.SetAuthToken()` must have been called there; `OnboardingController` does not re-authenticate.
- `ServiceLocator.Instance.Get<ApiClient>()` must resolve — same `GameManager`/Boot dependency as every other scene.

---

## 6. Verification steps

1. Enter this scene fresh (e.g. via `Login.unity`'s registration path) with no class selected → press `تأكيد` directly → confirm `ErrorMessageText` shows "اختر فئة أولاً...", no network call attempted.
2. Select a class, enter a 1-character username → confirm the length validation error shows, no network call attempted.
3. Select a class, enter a valid unique username → confirm `POST /auth/register` fires, `PlayerSession.Current` is populated from the response, and the scene transitions to `MainMap.unity`.
4. Repeat step 3 with a username already taken by another test account → confirm the Arabic "اسم المستخدم مُستخدَم بالفعل" message appears (validates `USERNAME_TAKEN` → `TranslateError` mapping).
