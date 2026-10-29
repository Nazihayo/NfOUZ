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
const { ASSETS, parseUnityFile, field, localRef, metaGuid } = require('./unityAssets');

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

  test('Fusion weaves Nfouz.Runtime (the [Networked] properties and RPCs)', () => {
    const config = JSON.parse(fs.readFileSync(FUSION_CONFIG, 'utf8'));
    expect(config.AssembliesToWeave).toContain('Nfouz.Runtime');
  });
});

function unquoteName(go) {
  return (field(go, 'm_Name') || '').trim();
}
