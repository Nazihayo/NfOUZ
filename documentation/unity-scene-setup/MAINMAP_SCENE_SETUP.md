# MainMap Scene — Setup Specification (Sprint 4 additions)

Matches `NearbyPlayersTracker.cs`, `MarkerPool.cs`, `NearbyPlayerMarkerUi.cs`,
`NearbyPlayerSelection.cs`, and `ChallengeInteractionController.cs` delivered
in Sprint 4. Builds on top of the Sprint 3 `GPSLocationService`/`MapboxManager`
setup — this document only covers what Sprint 4 adds or changes.

---

## 1. Scene file

`Assets/_Project/Scenes/MainMap.unity`

---

## 2. Hierarchy (Sprint 4 delta)

```
MainMap (Scene root)
├── MapboxMapObject                     [existing, Sprint 3]
├── PlayerMarker                        [existing, Sprint 3]
├── MainCamera                          [Camera — tag "MainCamera"]
│     └── NearbyPlayerSelection.cs      [Component — NEW]
├── NearbyPlayersSystem                 [GameObject — NEW, empty parent]
│     ├── NearbyPlayersTracker.cs       [Component]
│     ├── MarkerPool.cs                 [Component]
│     └── MarkerPoolContainer           [Transform — inactive pooled markers parked here]
├── Canvas_HUD                          [existing]
│     └── MiniProfilePopup              [GameObject — NEW, inactive by default]
│           ├── UsernameLabel           [Text/TMP_Text]
│           ├── ClassLabel              [Text/TMP_Text]
│           └── ChallengeButton         [Button, text "تحدٍّ"]
└── Managers                            [existing empty parent from Sprint 3]
      ├── MapboxManager.cs              [existing]
      ├── GPSLocationService.cs         [existing]
      └── ChallengeInteractionController.cs   [Component — NEW, on Managers or its own object]
```

---

## 3. `NearbyPlayerMarkerPrefab` prefab

```
NearbyPlayerMarkerPrefab                [Prefab]
├── Visual (sprite/mesh representing the player on the map)
├── UsernameText                        [TMP_Text]
├── DistanceText                        [TMP_Text]
├── ControlledStatusIcon                [GameObject, inactive by default]
├── SelectionHighlight                  [GameObject, inactive by default — e.g. a ring/glow]
└── [Collider]                          [Required by NearbyPlayerMarkerUi's [RequireComponent] —
                                          use a small SphereCollider or BoxCollider sized to the
                                          marker's tap target, set to "Is Trigger" if using a 3D
                                          world Physics.Raycast against the "NearbyPlayerMarker" layer]
```

Attach `NearbyPlayerMarkerUi` to the prefab root and wire its serialized fields
(`usernameText`, `distanceText`, `controlledStatusIcon`, `selectionHighlight`)
to the children above.

**Layer:** assign this prefab (and its collider) to a dedicated `NearbyPlayerMarker`
physics layer, so `NearbyPlayerSelection.markerLayerMask` can raycast against
only these objects and not the terrain/other map geometry.

---

## 4. Inspector assignments

### `NearbyPlayersSystem` GameObject
| Field (on `NearbyPlayersTracker`) | Assignment |
|---|---|
| `mapboxManager` | drag `Managers/MapboxManager` |
| `markerPool` | drag `MarkerPool` component (sibling on the same GameObject) |
| `playerSelection` | drag `MainCamera/NearbyPlayerSelection` |
| `queryIntervalSeconds` | `6` (default) |
| `radiusMeters` | `1000` (default — matches backend `NEARBY_DEFAULT_RADIUS_METERS`) |

| Field (on `MarkerPool`) | Assignment |
|---|---|
| `markerPrefab` | drag `NearbyPlayerMarkerPrefab` asset |
| `poolParent` | drag `MarkerPoolContainer` child transform |
| `prewarmCount` | `10` |
| `maxPoolSize` | `200` |

### `MainCamera`
| Field (on `NearbyPlayerSelection`) | Assignment |
|---|---|
| `worldCamera` | leave empty — falls back to `Camera.main` (this object) |
| `markerLayerMask` | set to the `NearbyPlayerMarker` layer only |
| `maxRaycastDistance` | `500` |

### `ChallengeInteractionController`
| Field | Assignment |
|---|---|
| `selection` | drag `MainCamera/NearbyPlayerSelection` |
| `miniProfilePopup` | drag `Canvas_HUD/MiniProfilePopup` |
| `usernameLabel` | drag `MiniProfilePopup/UsernameLabel` |
| `classLabel` | drag `MiniProfilePopup/ClassLabel` |
| `challengeButton` | drag `MiniProfilePopup/ChallengeButton` |
| `maxChallengeDistanceMeters` | `20` |

---

## 5. Wiring `GPSLocationService` → `NearbyPlayersTracker`

`NearbyPlayersTracker.Bind(gpsService)` must be called once after both
components exist — add a two-line call in `MainMapController` (or whichever
scene-bootstrap script owns `MainMap.unity`'s `Start()`):

```csharp
nearbyPlayersTracker.Bind(gpsLocationService);
```

This is intentionally not auto-wired via `ServiceLocator`, since
`GPSLocationService` is scene-local (lives in `MainMap.unity`, not
`DontDestroyOnLoad`), unlike the process-wide services in `ServiceLocator`.

---

## 6. Pool configuration rationale

- `prewarmCount = 10`: covers the typical case (a handful of nearby players)
  without any `Instantiate` call during normal play.
- `maxPoolSize = 200`: hard ceiling matching `NEARBY_MAX_RESULTS` on the
  backend (`50`) with generous headroom — the pool will never need to grow
  anywhere near this in practice, it exists only to bound worst-case memory
  if the server-side cap is ever raised without a corresponding client update.

---

## 7. Verification steps

1. Enter Play mode with two test accounts moving within the configured radius of each other.
2. Confirm a marker appears for each within one `queryIntervalSeconds` cycle (6s), and the Console shows no `Instantiate` warnings beyond the initial prewarm.
3. Walk one test device out of the configured radius → confirm its marker is released (deactivated, not destroyed — verify via `MarkerPool.AvailableCount` increasing) rather than remaining stale.
4. Walk back into radius → confirm the same pooled instance is reused (`AvailableCount` decreases, no new `Instantiate`).
5. Tap a marker → confirm `MiniProfilePopup` shows the correct username/class and the highlight appears on the correct marker only.
6. Move within `maxChallengeDistanceMeters` of a selected, non-controlled, online target → confirm `ChallengeButton.interactable` becomes `true`; move away → confirm it becomes `false` again without needing to re-select.
7. Disable network connectivity mid-session → confirm existing markers remain in place (per `NearbyPlayersTracker`'s transport-failure handling) rather than disappearing on a single failed poll.

---

## 8. Sprint 5 addendum — `PhotonRoomLifecycle.cs`

Sprint 5 adds `PhotonRoomLifecycle.cs` to the `Managers` parent (alongside
`ChallengeInteractionController.cs`), NOT to `Battle.unity` — it must
already be subscribed to `ChallengeInteractionController.OnChallengeRequested`
before a challenge is ever sent, since that subscription is what triggers
`POST /battle/challenge`, the Photon room join, and the `Battle.unity`
scene load. See `BattleScene/BATTLE_SCENE_SETUP.md` section 6 for the full
cross-scene wiring rationale.

| Field (on `PhotonRoomLifecycle`) | Assignment |
|---|---|
| `challengeInteractionController` | drag `Managers/ChallengeInteractionController` (sibling on the same GameObject) |
