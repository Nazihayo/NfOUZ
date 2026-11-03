'use strict';

/**
 * Map marker size (STATUS.md D1). The MainMap camera looks at the map from
 * roughly 700 units away (y 500, z -500, FOV 77) and Mapbox draws one unit per
 * metre, so a person-sized marker (about 2 units) was under one pixel and no
 * player could see another. Since c8dcec1 both marker roots are scaled x20;
 * this fails if either goes back to a size that cannot be seen at map zoom.
 */

const path = require('path');
const { ASSETS, parseUnityFile, field, localRef } = require('./unityAssets');

const MIN_ROOT_SCALE = 10;

function rootScale(file) {
  const unity = parseUnityFile(file);
  const root = unity.docs.find((d) => d.classId === 4 && localRef(field(d, 'm_Father')) === '0');
  const m = field(root, 'm_LocalScale').match(/\{x: ([\d.]+), y: ([\d.]+), z: ([\d.]+)\}/);
  return m.slice(1).map(Number);
}

describe('Map markers are large enough to see at map zoom', () => {
  for (const name of ['PlayerMarker', 'NearbyPlayerMarker']) {
    test(`${name} root scale is at least ${MIN_ROOT_SCALE}`, () => {
      for (const axis of rootScale(path.join(ASSETS, `_Project/Prefabs/Map/${name}.prefab`))) {
        expect(axis).toBeGreaterThanOrEqual(MIN_ROOT_SCALE);
      }
    });
  }
});

/**
 * STATUS.md D3: the markers used Unity's built-in Default-Material, which URP
 * draws pink. Every renderer in both prefabs must point at a project material
 * that uses URP Lit.
 */
const fs = require('fs');
const { listFiles, metaGuid } = require('./unityAssets');

const URP_LIT_SHADER = '{fileID: 4800000, guid: 933532a4fcc9baf4fa0491de14d08ed7, type: 3}';

describe('Map markers use URP materials', () => {
  const materialByGuid = new Map(
    listFiles(path.join(ASSETS, '_Project/Art/Materials'), '.mat').map((f) => [metaGuid(f), f]));

  for (const name of ['PlayerMarker', 'NearbyPlayerMarker']) {
    // Text renderers keep their font's SDF material (a sub-asset of the font).
    test(`${name}: no built-in material; every mesh material is URP Lit from Art/Materials`, () => {
      const text = fs.readFileSync(path.join(ASSETS, `_Project/Prefabs/Map/${name}.prefab`), 'utf8');
      const refs = [...text.matchAll(/^ {2}m_Materials:\r?\n((?: {2}- .*\r?\n)+)/gm)]
        .flatMap((m) => m[1].trim().split(/\r?\n/).map((l) => l.trim().slice(2)));
      expect(refs.length).toBeGreaterThan(0);
      expect(refs.filter((r) => r.includes('guid: 0000000000000000f000000000000000'))).toEqual([]);
      const meshMaterials = refs.map((r) => r.match(/^\{fileID: 2100000, guid: ([0-9a-f]{32}), type: 2\}$/)).filter(Boolean);
      expect(meshMaterials.length).toBeGreaterThan(0);
      for (const m of meshMaterials) {
        expect(materialByGuid.has(m[1])).toBe(true);
        expect(fs.readFileSync(materialByGuid.get(m[1]), 'utf8')).toContain(`m_Shader: ${URP_LIT_SHADER}`);
      }
    });
  }
});
