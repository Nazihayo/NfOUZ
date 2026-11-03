'use strict';

/**
 * Photon Fusion wiring checks that need no Unity (HANDOFF item 35).
 *
 * runner.Spawn(networkPlayerPrefab) only works when the prefab's root carries
 * Fusion's NetworkObject and Fusion lists the prefab in its prefab table
 * (the "FusionPrefab" asset label). Fusion only weaves [Networked]
 * properties and RPCs of assemblies named in NetworkProjectConfig.
 *
 * NetworkObject lives in Fusion.Runtime.dll, so a scene or prefab refers to
 * it by the DLL's GUID and a fileID derived from the class name: the first
 * four bytes, little-endian, of MD4("s\0\0\0" + "Fusion" + "NetworkObject").
 * The same rule gives Image -765806418 and Button 1392445389 in
 * com.unity.ugui, the well-known values.
 */

const fs = require('fs');
const path = require('path');
const { PROJECT, ASSETS, SCRIPTS_DIR, listFiles, parseUnityFile, field, localRef, metaGuid, scriptGuid } = require('./unityAssets');

const PREFAB = path.join(ASSETS, '_Project/Prefabs/Networking/NetworkPlayer.prefab');
const BATTLE = path.join(ASSETS, '_Project/Scenes/Battle.unity');
const FUSION_RUNTIME_DLL = path.join(ASSETS, 'Photon/Fusion/Assemblies/Fusion.Runtime.dll');
const FUSION_CONFIG = path.join(ASSETS, 'Photon/Fusion/Resources/NetworkProjectConfig.fusion');
const NETWORK_OBJECT_FILE_ID = '-1552182283';

function rootGameObject(unity) {
  return unity.docs.find((d) => d.classId === 1 && unity.docs.some(
    (t) => t.classId === 4 && field(t, 'm_GameObject') === `{fileID: ${d.fileID}}` && localRef(field(t, 'm_Father')) === '0'));
}

function componentIds(go) {
  return [...go.body.matchAll(/^ {2}- component: \{fileID: (-?\d+)\}/gm)].map((m) => m[1]);
}

describe('Photon Fusion: NetworkPlayer prefab', () => {
  const unity = parseUnityFile(PREFAB);
  const root = rootGameObject(unity);
  const fusionGuid = metaGuid(FUSION_RUNTIME_DLL);

  test('the root GameObject is NetworkPlayer', () => {
    expect(unquoteName(root)).toBe('NetworkPlayer');
  });

  test('the root carries exactly one Fusion NetworkObject, listed among its components', () => {
    const script = `{fileID: ${NETWORK_OBJECT_FILE_ID}, guid: ${fusionGuid}, type: 3}`;
    const networkObjects = unity.docs.filter((d) => d.classId === 114 && field(d, 'm_Script') === script);
    expect(networkObjects.length).toBe(1);
    expect(field(networkObjects[0], 'm_GameObject')).toBe(`{fileID: ${root.fileID}}`);
    expect(componentIds(root)).toContain(networkObjects[0].fileID);
  });

  test('every component the root lists exists in the prefab, Transform first', () => {
    const ids = componentIds(root);
    for (const id of ids) expect(unity.byId.has(id)).toBe(true);
    expect(unity.byId.get(ids[0]).classId).toBe(4);
  });

  test('fileIDs are unique', () => {
    expect(new Set(unity.docs.map((d) => d.fileID)).size).toBe(unity.docs.length);
  });

  // Fusion only ticks, syncs and runs RPCs on the behaviours its NetworkObject
  // lists. Until the prefab was re-saved in Unity on 2026-11-02 (2ed5b33) the
  // list was empty, so NetworkPlayerController would never have synced.
  test('the NetworkObject lists every NetworkBehaviour of ours on the prefab', () => {
    const script = `{fileID: ${NETWORK_OBJECT_FILE_ID}, guid: ${fusionGuid}, type: 3}`;
    const networkObject = unity.docs.find((d) => d.classId === 114 && field(d, 'm_Script') === script);
    const listed = [...networkObject.body.matchAll(/^ {2}NetworkedBehaviours:\r?\n((?: {2}- \{fileID: -?\d+\}\r?\n)*)/gm)]
      .flatMap((m) => [...m[1].matchAll(/fileID: (-?\d+)/g)].map((r) => r[1]));
    const behaviourGuids = networkBehaviourScriptGuids();
    const behaviours = unity.docs.filter((d) => d.classId === 114 && behaviourGuids.has(scriptGuid(d)));
    expect(behaviours.length).toBeGreaterThan(0);
    // Fusion's own behaviours (NetworkTransform, ...) may be listed too.
    for (const b of behaviours) expect(listed).toContain(b.fileID);
    for (const id of listed) expect(unity.byId.get(id)?.classId).toBe(114);
  });

  test('the prefab carries the FusionPrefab label, so Fusion lists it in its prefab table', () => {
    const meta = fs.readFileSync(`${PREFAB}.meta`, 'utf8');
    expect(/^labels:\r?\n(?:- .*\r?\n)*- FusionPrefab\r?$/m.test(meta)).toBe(true);
  });
});

describe('Photon Fusion: project wiring', () => {
  test('Battle spawns the NetworkPlayer prefab', () => {
    const text = fs.readFileSync(BATTLE, 'utf8');
    const guid = metaGuid(PREFAB);
    expect(text.includes(`networkPlayerPrefab: {fileID: ${rootGameObject(parseUnityFile(PREFAB)).fileID}, guid: ${guid}, type: 3}`)).toBe(true);
  });

  // Without PHOTON_FUSION_AVAILABLE the battle code compiles its offline stub
  // instead of Fusion. It used to live only in the laptop's working copy, and
  // a branch switch on 2026-11-02 silently reset it to this committed file.
  test('the Android build defines PHOTON_FUSION_AVAILABLE and MAPBOX_SDK_AVAILABLE', () => {
    const settings = fs.readFileSync(path.join(PROJECT, 'ProjectSettings/ProjectSettings.asset'), 'utf8');
    const m = settings.match(/^ {2}scriptingDefineSymbols:\r?\n(?: {4}\w+:.*\r?\n)*? {4}Android: ?(.*?)\r?$/m);
    expect(m).not.toBeNull();
    const defines = m[1].split(';');
    expect(defines).toContain('PHOTON_FUSION_AVAILABLE');
    expect(defines).toContain('MAPBOX_SDK_AVAILABLE');
  });

  test('Fusion weaves Nfouz.Runtime (the [Networked] properties and RPCs)', () => {
    const config = JSON.parse(fs.readFileSync(FUSION_CONFIG, 'utf8'));
    expect(config.AssembliesToWeave).toContain('Nfouz.Runtime');
  });
});

/**
 * Script GUIDs of the project's classes that derive, directly or through
 * another class of ours, from Fusion's NetworkBehaviour.
 */
function networkBehaviourScriptGuids() {
  const files = listFiles(SCRIPTS_DIR, '.cs');
  const decl = /\bclass\s+(\w+)\s*(?:<[^>]*>)?\s*:\s*(?:[\w.]+\.)?(\w+)/g;
  const baseOf = new Map();
  const fileOf = new Map();
  for (const file of files) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(decl)) {
      // A class may be declared once per #if branch (Fusion / offline stub).
      if (!baseOf.has(m[1])) baseOf.set(m[1], new Set());
      baseOf.get(m[1]).add(m[2]);
      fileOf.set(m[1], file);
    }
  }
  const derives = (cls, seen = new Set()) => {
    if (!baseOf.has(cls) || seen.has(cls)) return false;
    seen.add(cls);
    return [...baseOf.get(cls)].some((base) => base === 'NetworkBehaviour' || derives(base, seen));
  };
  const guids = new Set();
  for (const cls of baseOf.keys()) if (derives(cls)) guids.add(metaGuid(fileOf.get(cls)));
  return guids;
}

function unquoteName(go) {
  return (field(go, 'm_Name') || '').trim();
}
