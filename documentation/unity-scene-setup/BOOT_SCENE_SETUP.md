# Boot Scene — Setup Specification

> A `.unity` scene is a binary/YAML asset tied to Unity's internal GUIDs — it cannot be
> hand-authored as portable text and applied to an arbitrary project. This document is
> the exact, step-by-step spec to build `Boot.unity` in the Editor so it matches the
> scripts delivered in this Sprint 1 package byte-for-byte in behavior.

---

## 1. Scene file

`Assets/_Project/Scenes/Boot.unity` — add as **index 0** in Build Settings (File > Build Settings > Scenes In Build), so it is always the first scene to load on device.

---

## 2. Hierarchy

```
Boot (Scene root)
└── GameManager                    [GameObject]
      ├── GameManager.cs           [Component]
      ├── ServiceLocator.cs        [Component]
      └── (children, added at runtime by GameManager.Awake — nothing under it in the editor)
```

Only **one** GameObject is required in this scene: `GameManager`. Everything else
(`ApiClient`, `FirebaseManager`) is created at runtime by `GameManager.RegisterCoreServices()`
either from an assigned prefab or, if none is assigned, via `AddComponent` on the same object.

---

## 3. GameObject: `GameManager`

| Property | Value |
|---|---|
| Name | `GameManager` |
| Tag | `Untagged` |
| Layer | `Default` |
| Transform | Position (0,0,0) — irrelevant, never rendered |

**Components attached (in this order):**
1. `Transform` (default, cannot be removed)
2. `GameManager` (script)
3. `ServiceLocator` (script) — required by `[RequireComponent(typeof(ServiceLocator))]` on `GameManager`; Unity auto-adds it if missing, but add it explicitly to avoid ordering surprises in `Awake()`.

---

## 4. Inspector assignments on `GameManager` component

| Field | Type | Assignment for Sprint 1 |
|---|---|---|
| `Api Client Prefab` | `ApiClient` | Leave **empty** for Sprint 1 (no prefab exists yet — `GameManager` falls back to `AddComponent<ApiClient>()`). Assign a prefab here once Phase 2+ needs an `ApiClient` prefab variant with pre-set inspector values. |
| `Firebase Manager Prefab` | `FirebaseManager` | Leave **empty** for Sprint 1, same reasoning as above. |

No other Inspector fields exist on `GameManager` in this sprint.

---

## 5. Required Prefabs (Sprint 1)

**None are required to ship Sprint 1.** The two optional prefab slots above exist so that
later sprints (Phase 2 — Authentication onward) can swap in a pre-configured `ApiClient`
or `FirebaseManager` prefab (e.g. one with a staging vs. production base URL baked in)
without touching `GameManager.cs` again.

When such a prefab is introduced later, it lives at:
```
Assets/_Project/Prefabs/Core/ApiClient_Prefab.prefab
Assets/_Project/Prefabs/Core/FirebaseManager_Prefab.prefab
```

---

## 6. Scripting Define Symbols

Add `FIREBASE_AUTH_AVAILABLE` to **Project Settings > Player > Scripting Define Symbols**
(per platform: Android and iOS) **only after** the Firebase Unity SDK package has been
imported into the project. Until then, leave it undefined — `FirebaseManager.cs` compiles
and runs in stub mode (`IsInitialized` stays `false`, every auth call returns a graceful
failure) so the rest of the team is never blocked waiting on SDK import.

---

## 7. Verification steps (manual QA for this scene alone)

1. Open `Boot.unity`, press Play.
2. Console should show, in order:
   - `[GameManager] Core services registered.`
   - `[FirebaseManager] FIREBASE_AUTH_AVAILABLE not defined — running in stub mode...` (expected until the SDK is imported)
   - `[GameManager] Boot sequence ready. Awaiting SessionBootstrap.`
3. Stop Play mode, re-enter Play mode: no duplicate `GameManager` should ever appear in the Hierarchy (validates the singleton guard in `Awake()`).
4. Confirm `GameManager` survives a manual `SceneManager.LoadScene` call to any other scene added later (validates `DontDestroyOnLoad`).

---

*This spec accompanies `GameManager.cs`, `ServiceLocator.cs`, `ApiClient.cs`, and `FirebaseManager.cs` in this Sprint 1 package. No other scene or prefab work is in scope for Sprint 1 per the Unity MVP Implementation Plan v1.0, Phase 1.*
