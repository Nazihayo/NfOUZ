'use strict';

/**
 * Code that uses UnityEditor must never reach a player build, or the Android
 * build fails to compile. Every project C# file that says `using UnityEditor`
 * must be either wrapped in `#if UNITY_EDITOR`, or compiled only for the
 * Editor: inside an asmdef whose includePlatforms is exactly ["Editor"], or,
 * with no asmdef above it, inside a folder named `Editor` (Unity's
 * Assembly-CSharp-Editor). Guards Assets/_Project/Editor/BattleVisualSetup.cs
 * and any editor tool added later.
 */

const fs = require('fs');
const path = require('path');
const { ASSETS, listFiles } = require('./unityAssets');

const PROJECT_DIR = path.join(ASSETS, '_Project');

function nearestAsmdef(file) {
  for (let dir = path.dirname(file); dir.startsWith(ASSETS); dir = path.dirname(dir)) {
    const found = fs.readdirSync(dir).find((n) => n.endsWith('.asmdef'));
    if (found) return path.join(dir, found);
  }
  return null;
}

function editorOnly(file, source) {
  if (/^\s*#if\s+UNITY_EDITOR\b/m.test(source)) return true;
  const asmdef = nearestAsmdef(file);
  if (asmdef) {
    const platforms = JSON.parse(fs.readFileSync(asmdef, 'utf8')).includePlatforms || [];
    return platforms.length === 1 && platforms[0] === 'Editor';
  }
  return path.relative(ASSETS, file).split(path.sep).includes('Editor');
}

describe('UnityEditor code stays out of player builds', () => {
  const files = listFiles(PROJECT_DIR, '.cs').filter((f) =>
    /^\s*using\s+UnityEditor\b/m.test(fs.readFileSync(f, 'utf8')));

  test('the project has editor code to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    test(`${path.relative(ASSETS, file)} is editor-only`, () => {
      expect(editorOnly(file, fs.readFileSync(file, 'utf8'))).toBe(true);
    });
  }
});
