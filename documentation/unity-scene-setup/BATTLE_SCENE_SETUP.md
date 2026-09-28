# Battle Scene — Setup Specification (Sprint 5)

Matches `PhotonConnectionManager.cs`, `PhotonRoomLifecycle.cs`,
`NetworkPlayerController.cs`, `NetworkPlayerSpawner.cs`,
`BattleLoadingController.cs`, `NetworkInputData.cs`, and
`BattleSessionData.cs` delivered in Sprint 5. Scope: movement
synchronization + session lifecycle (loading, ready, countdown, session
start/end, disconnect/reconnect/forfeit) only — no combat UI (Sprint 6).

**Mode note:** this scene is built for Fusion **Host Mode** (approved
Alpha mode — see `PhotonConnectionManager.cs` class remarks, TDD v1.0
section 1, and Photon & Mapbox Integration v1.0 section 1.1). Do not wire
this scene for a Dedicated Server topology.

---

## 1. Scene file

`Assets/_Project/Scenes/Battle.unity`

(Referenced as `Constants.Scenes.Battle` = `"Battle"` — already present in
`Utils/Constants.cs` since Sprint 1; this sprint is the first to actually
build the scene it names.)

---

## 2. Hierarchy

```
Battle (Scene root)
├── NetworkRunner_Placeholder           [GameObject — NOT pre-placed in the scene]
│     (PhotonConnectionManager creates its own "NetworkRunner_{roomName}"
│      GameObject at runtime via JoinRoomAsync — see Networking/PhotonConnectionManager.cs.
│      It is DontDestroyOnLoad and owned by the Boot-scene-registered
│      PhotonConnectionManager singleton, so nothing Photon-related needs
│      to be hand-placed in this scene's hierarchy for the runner itself.)
├── BattleSystems                       [GameObject — empty parent, NEW]
│     ├── PhotonRoomLifecycle.cs        [Component]
│     ├── NetworkPlayerSpawner.cs       [Component]
│     └── BattleLoadingController.cs    [Component]
├── SpawnPoints                         [GameObject — empty parent, NEW]
│     ├── AttackerSpawnPoint            [Transform — empty GameObject, positioned at one
│     │                                  end of the 15x15m arena per Battle System v1.0 §1]
│     └── DefenderSpawnPoint            [Transform — empty GameObject, opposite end]
├── Arena                               [GameObject — NEW, placeholder geometry for the
│     │                                  fixed 15x15m arena (Battle System v1.0 §1);
│     │                                  art/collision detail is out of Sprint 5 scope]
│     └── ArenaFloor                    [Plane/Mesh, 15x15m]
├── BattleCamera                        [Camera — NEW, tag "MainCamera" while this scene
│                                        is loaded (MainMap's camera is unloaded with the
│                                        scene per SceneLoader.LoadAsync's Single mode)]
└── Canvas_Battle                       [Canvas — NEW]
      ├── LoadingPanel                  [GameObject — active by default on scene entry]
      │     └── LoadingLabel            [Text/TMP_Text, e.g. "جارٍ الاتصال..."]
      ├── CountdownPanel                [GameObject — inactive by default]
      │     └── CountdownLabel          [Text/TMP_Text — shows 3/2/1]
      ├── ReadyStatusPanel              [GameObject — NEW, shows both players' ready state
      │     │                            while LoadingPanel is active]
      │     ├── SelfReadyIndicator      [Image/Icon — reflects local BattleSession.Current.attacker_ready
      │     │                            or .defender_ready depending on which side this client is]
      │     └── OpponentReadyIndicator  [Image/Icon — reflects the other side's ready flag]
      ├── DisconnectPanel               [GameObject — NEW, inactive by default]
      │     ├── DisconnectLabel         [Text/TMP_Text, e.g. "الخصم فقد الاتصال..."]
      │     └── ReconnectCountdownLabel [Text/TMP_Text — counts down Constants.Battle.DisconnectGraceSeconds]
      └── ReconnectedToast              [GameObject — NEW, inactive by default, briefly shown
                                          on OnPlayerReconnected then auto-hidden]
```

---

## 3. `NetworkPlayerPrefab` prefab requirements

```
NetworkPlayerPrefab                     [Prefab]
├── NetworkPlayerController.cs          [Component — REQUIRED at prefab root]
├── [NetworkObject]                     [Fusion component — REQUIRED once
│                                         PHOTON_FUSION_AVAILABLE is defined;
│                                         NetworkBehaviour requires its
│                                         GameObject to carry a NetworkObject
│                                         for Fusion to track/replicate it.
│                                         Not addable in stub mode — add this
│                                         component when the Fusion SDK
│                                         package is imported.]
├── Visual                              [Mesh/sprite representing the player
│                                         avatar in the arena — placeholder
│                                         capsule acceptable for Sprint 5,
│                                         since combat visuals are Sprint 6]
├── UsernameLabel (world-space)         [TMP_Text — optional for Sprint 5,
│                                         reads from PlayerSession/BattleSession,
│                                         not from a Networked property yet]
└── [CharacterController or Rigidbody]  [Required for NetworkPlayerController's
                                          transform.position writes in
                                          FixedUpdateNetwork/ApplyLocalInput
                                          to interact with arena geometry —
                                          movement synchronization only, no
                                          combat collision layers yet]
```

Two instances of this SAME prefab are spawned by `NetworkPlayerSpawner` —
one at `AttackerSpawnPoint`, one at `DefenderSpawnPoint` — there is no
separate attacker/defender prefab variant.

---

## 4. Inspector assignments

### `BattleSystems` GameObject

| Field (on `PhotonRoomLifecycle`) | Assignment |
|---|---|
| `challengeInteractionController` | This field is only meaningful in `MainMap.unity`, where `ChallengeInteractionController` actually lives — `PhotonRoomLifecycle` itself is instantiated in `MainMap.unity` (or a `DontDestroyOnLoad` systems object created in `Boot.unity`), NOT in `Battle.unity`, since it must already be subscribed to `OnChallengeRequested` *before* the challenge is sent and the Battle scene is loaded. See §6 below — this row is listed here only to avoid a missing-file cross-reference; do not add a second `PhotonRoomLifecycle` instance inside `Battle.unity` itself (see §7 duplication rules). |

| Field (on `NetworkPlayerSpawner`) | Assignment |
|---|---|
| `networkPlayerPrefab` | drag `NetworkPlayerPrefab` asset |
| `attackerSpawnPoint` | drag `SpawnPoints/AttackerSpawnPoint` |
| `defenderSpawnPoint` | drag `SpawnPoints/DefenderSpawnPoint` |

| Field (on `BattleLoadingController`) | Assignment |
|---|---|
| `playerSpawner` | drag `BattleSystems/NetworkPlayerSpawner` (sibling component) |
| `loadingPanel` | drag `Canvas_Battle/LoadingPanel` |
| `countdownPanel` | drag `Canvas_Battle/CountdownPanel` |

### `Canvas_Battle`

| Field | Assignment |
|---|---|
| Render Mode | `Screen Space - Overlay` |
| `ReadyStatusPanel` | child of `LoadingPanel` or a sibling shown alongside it — active whenever `LoadingPanel` is active |
| `DisconnectPanel` | wired to `PhotonRoomLifecycle.OnPlayerDisconnected`/`OnPlayerReconnected`-driven UI script (not a separate component delivered this sprint — a thin `BattleSessionUiBinder` MonoBehaviour subscribing to those events and to `BattleSession.OnSessionUpdated` is the natural place for this wiring, but is UI-polish and intentionally left as a follow-up rather than invented here without a spec) |

---

## 5. `BattleCamera`

| Field | Assignment |
|---|---|
| Tag | `MainCamera` |
| Position | Framed on the midpoint between `AttackerSpawnPoint` and `DefenderSpawnPoint`, far enough back to keep the full 15x15m arena in frame |
| Projection | Perspective (matches `MainMap.unity`'s camera per Scene Architecture v1.0) |

No camera-follow/combat-cam logic is implemented in Sprint 5 — a static
framing of the arena is sufficient for movement-synchronization testing.

---

## 6. Cross-scene wiring: where `PhotonRoomLifecycle` actually lives

`PhotonRoomLifecycle` subscribes to
`ChallengeInteractionController.OnChallengeRequested`, which is only
raised in `MainMap.unity`, and it is what triggers `SceneLoader.LoadAsync(Constants.Scenes.Battle)`.
It must therefore be instantiated in **`MainMap.unity`** (see
`MAINMAP_SCENE_SETUP.md`'s `Managers` parent — add `PhotonRoomLifecycle.cs`
there, alongside `ChallengeInteractionController.cs`), not in `Battle.unity`.
Once the Battle scene loads, `BattleLoadingController` (which DOES live in
`Battle.unity`, per §2 above) takes over the in-scene flow by reading the
already-populated `BattleSession.Current` / `PlayerSession.Current` static
state — no cross-scene object reference is needed at that point.

This mirrors the existing precedent of `PhotonConnectionManager` living in
`Boot.unity` (registered once via `GameManager`/`ServiceLocator`) while the
scenes that use it (`MainMap.unity`, `Battle.unity`) only reference it
through `ServiceLocator.Instance.Get<PhotonConnectionManager>()`.

---

## 7. Duplication rules (do not violate)

- **Exactly one `PhotonConnectionManager`** exists for the lifetime of the
  application — registered once in `Boot.unity` by `GameManager`. It is
  now self-enforcing: a second instance destroys itself on `Awake()` (see
  `PhotonConnectionManager.cs`). Never add a second one to `Battle.unity`
  or any other scene.
- **Exactly one `NetworkRunner`** exists at a time, owned exclusively by
  `PhotonConnectionManager`. Never call `gameObject.AddComponent<NetworkRunner>()`
  anywhere else in the project.
- **Exactly one `NetworkPlayerSpawner`** may be active in `Battle.unity` at
  a time — also self-enforcing (see `NetworkPlayerSpawner.cs` `Awake()`).
  If a future scene variant needs a second arena instance (e.g. spectator
  mode, post-Alpha), that requires a corresponding code change to scope
  the singleton per-arena, not just adding a second component in the
  Inspector.

---

## 8. Verification steps

1. Two test accounts: Player A selects Player B in `MainMap.unity` and
   presses Challenge → confirm `POST /battle/challenge` succeeds and both
   clients receive the same `photon_room_name` (format `battle_{battle_id}`,
   NOT a random token — see Sprint 5 correction pass).
2. Confirm both clients load `Battle.unity` and `LoadingPanel` is visible
   immediately, with `ReadyStatusPanel` showing both indicators unready.
3. Confirm each client's `NetworkPlayerSpawner.SpawnLocalPlayer` places
   their avatar at the correct spawn point (attacker vs defender) — verify
   via `NetworkPlayerController.NetworkedClass`/`NetworkedFaction`/`NetworkedWeapon`
   matching each player's `PlayerSession.Current`.
4. Confirm `POST /battle/{battleId}/ready` fires from both clients and,
   once both `attacker_ready`/`defender_ready` are `true`, `CountdownPanel`
   appears with a synchronized 3-2-1 countdown on both clients.
5. Move one client's avatar — confirm the other client sees the movement
   reflected via `NetworkedPosition`/`NetworkedYaw` (Host Mode replication),
   with no combat interaction possible (Sprint 6 is not wired in).
6. Force-quit one client mid-battle → confirm the other client's
   `DisconnectPanel` appears, the reconnect countdown matches
   `Constants.Battle.DisconnectGraceSeconds` (15s), and the backend's
   `attacker_reconnect_deadline`/`defender_reconnect_deadline` (via
   `GET /battle/{battleId}`) agrees with the client-side countdown within
   normal network latency.
7. Relaunch the force-quit client within the grace period → confirm
   `POST /battle/{battleId}/reconnect` succeeds and `DisconnectPanel` hides.
8. Repeat step 6 but wait past the grace period before relaunching →
   confirm the battle's `status` becomes `forfeited` with `forfeited_by`
   set to the disconnected player's id, and reconnecting afterward is
   rejected with `RECONNECT_WINDOW_EXPIRED`.
9. Confirm only one `NetworkRunner_*` GameObject ever exists at a time
   (inspect the DontDestroyOnLoad hierarchy in the Editor) across a full
   challenge → battle → forfeit/end cycle repeated twice in the same play session.
