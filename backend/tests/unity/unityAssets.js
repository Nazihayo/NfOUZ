'use strict';

/**
 * Reads the Unity project's scenes, prefabs and C# sources (no Unity needed)
 * for the Arabic UI checks in uiText.test.js. Unity's text serialization is a
 * list of YAML documents, one per object:
 *
 *   --- !u!<classId> &<fileID>[ stripped]
 *   <Type>:
 *     m_GameObject: {fileID: ...}
 *     ...
 *
 * Only the shapes this project uses are understood; anything else is left
 * alone rather than guessed.
 */

const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname, '../../..');
const ASSETS = path.join(PROJECT, 'Assets');
const SCENES_DIR = path.join(ASSETS, '_Project/Scenes');
const PREFABS_DIR = path.join(ASSETS, '_Project/Prefabs');
const SCRIPTS_DIR = path.join(ASSETS, '_Project/Scripts');

/** Script GUIDs of the UI components (stable across Unity 6 / com.unity.ugui 2.0). */
const GUID = {
  Text: '5f7201a12d95ffc409449d95f23cf332',
  InputField: 'd199490a83bb2b844b9695cbf13b01ef',
  TextMeshProUGUI: 'f4688fdb7df04437aeb418b961361dc5',
  TextMeshPro: '9541d86e2fd84c1d9990edf0852d74ab',
  TMP_InputField: '2da0c512f12947e489f739169773d7ca',
  // com.nosuchstudio.rtltmpro 4.0.0 (Packages/manifest.json)
  RTLTextMeshPro: 'b9839c2d141529145a431aef4d757ff3',
  RTLTextMeshPro3D: '95f437e10ab3f2c44bf012dea583cbd1',
};
const NAME_BY_GUID = Object.fromEntries(Object.entries(GUID).map(([k, v]) => [v, k]));

const TMP_TEXT_TYPES = new Set(['TextMeshProUGUI', 'TextMeshPro', 'RTLTextMeshPro', 'RTLTextMeshPro3D']);
const RTL_TEXT_TYPES = new Set(['RTLTextMeshPro', 'RTLTextMeshPro3D']);

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const ARABIC_BASE_LETTER = /[ء-ي]/;

function listFiles(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out.sort();
}

function rel(p) {
  return path.relative(PROJECT, p).split(path.sep).join('/');
}

function metaGuid(assetPath) {
  const meta = `${assetPath}.meta`;
  if (!fs.existsSync(meta)) return null;
  const m = fs.readFileSync(meta, 'utf8').match(/^guid: ([0-9a-f]{32})$/m);
  return m ? m[1] : null;
}

/** Unquotes a YAML scalar the way Unity writes them (plain, '…' or "…"). */
function unquote(raw) {
  if (raw === undefined) return undefined;
  const s = raw.replace(/\r$/, '');
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return JSON.parse(s);
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/** Parses one scene/prefab into its documents. */
function parseUnityFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const docs = [];
  const re = /^--- !u!(\d+) &(-?\d+)( stripped)?\r?\n/gm;
  const heads = [];
  let m;
  while ((m = re.exec(text))) heads.push({ index: m.index, end: re.lastIndex, classId: Number(m[1]), fileID: m[2], stripped: !!m[3] });
  heads.forEach((h, i) => {
    const body = text.slice(h.end, i + 1 < heads.length ? heads[i + 1].index : text.length);
    docs.push({ ...h, body });
  });
  const byId = new Map(docs.map((d) => [d.fileID, d]));
  return { file, rel: rel(file), docs, byId };
}

/** A top-level field (two-space indent) of a document, raw. */
function field(doc, name) {
  const m = doc.body.match(new RegExp(`^  ${name}:(?: (.*))?$`, 'm'));
  if (!m) return undefined;
  return m[1] === undefined ? '' : m[1].replace(/\r$/, '');
}

/** The local fileID a `{fileID: N}` field points at ('0' for none), or null for an external reference. */
function localRef(raw) {
  if (raw === undefined) return undefined;
  const m = raw.match(/^\{fileID: (-?\d+)(, guid: [0-9a-f]+, type: \d+)?\}$/);
  if (!m) return undefined;
  return m[2] ? null : m[1];
}

function scriptGuid(doc) {
  const m = doc.body.match(/^  m_Script: \{fileID: \d+, guid: ([0-9a-f]{32}), type: 3\}/m);
  return m ? m[1] : null;
}

function gameObjectOf(doc) {
  return localRef(field(doc, 'm_GameObject'));
}

/** GameObject name path ("Canvas/Panel/Label") for messages. */
function objectPath(unity, goId) {
  const names = [];
  let current = goId;
  const parentTransformOf = new Map();
  const transformOfGo = new Map();
  for (const d of unity.docs) {
    if (d.classId === 4 || d.classId === 224) {
      const go = gameObjectOf(d);
      if (go) {
        transformOfGo.set(go, d);
        parentTransformOf.set(go, localRef(field(d, 'm_Father')));
      }
    }
  }
  const goOfTransform = new Map([...transformOfGo.entries()].map(([go, t]) => [t.fileID, go]));
  for (let guard = 0; current && current !== '0' && guard < 64; guard++) {
    const go = unity.byId.get(current);
    names.unshift(go ? unquote(field(go, 'm_Name')) : '?');
    const parentT = parentTransformOf.get(current);
    current = parentT && parentT !== '0' ? goOfTransform.get(parentT) : null;
  }
  return names.join('/');
}

function loadAssets() {
  const files = [...listFiles(SCENES_DIR, '.unity'), ...listFiles(PREFABS_DIR, '.prefab')];
  return files.map(parseUnityFile);
}

/** Project MonoBehaviour classes by script GUID, with their source text. */
function loadScripts() {
  const byGuid = new Map();
  for (const file of listFiles(SCRIPTS_DIR, '.cs')) {
    const guid = metaGuid(file);
    if (!guid) continue;
    byGuid.set(guid, { file, rel: rel(file), name: path.basename(file, '.cs'), source: fs.readFileSync(file, 'utf8') });
  }
  return byGuid;
}

/**
 * Serialized fields of a given set of types declared in a C# source:
 * `[SerializeField] private TMP_Text label;` and `public TMP_Text label;`.
 */
function serializedFieldsOfType(source, typeNames) {
  const alt = typeNames.map((t) => t.replace(/\./g, '\\.')).join('|');
  const re = new RegExp(`^\\s*(?:\\[[^\\]]*\\]\\s*)*(\\[SerializeField\\][^\\n;]*?\\s|public\\s+)(${alt})\\s+(\\w+)\\s*[;=]`, 'gm');
  const out = [];
  let m;
  while ((m = re.exec(source))) out.push({ type: m[2], name: m[3] });
  return out;
}

module.exports = {
  PROJECT,
  ASSETS,
  SCRIPTS_DIR,
  GUID,
  NAME_BY_GUID,
  TMP_TEXT_TYPES,
  RTL_TEXT_TYPES,
  ARABIC,
  ARABIC_BASE_LETTER,
  listFiles,
  rel,
  metaGuid,
  unquote,
  parseUnityFile,
  field,
  localRef,
  scriptGuid,
  gameObjectOf,
  objectPath,
  loadAssets,
  loadScripts,
  serializedFieldsOfType,
};
