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
