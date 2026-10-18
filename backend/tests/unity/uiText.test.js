'use strict';

/**
 * Arabic UI checks for the Unity client (no Unity needed). Every
 * player-visible text in the project's scenes and prefabs is TextMeshPro, and
 * every label that can show Arabic is RTLTMPro, so Arabic letters are joined
 * and laid out right-to-left. Unity-side checks that need the Editor (font
 * coverage, loading each scene) are in Assets/_Project/Tests/EditMode.
 */

const fs = require('fs');
const path = require('path');
const {
  PROJECT,
  GUID,
  NAME_BY_GUID,
  TMP_TEXT_TYPES,
  RTL_TEXT_TYPES,
  ARABIC,
  ARABIC_BASE_LETTER,
  listFiles,
  metaGuid,
  unquote,
  field,
  localRef,
  scriptGuid,
  gameObjectOf,
  objectPath,
  loadAssets,
  loadScripts,
  serializedFieldsOfType,
  SCRIPTS_DIR,
} = require('./unityAssets');
const { stripComments } = require('../contract/unitySource');

const assets = loadAssets();
const scripts = loadScripts();

function componentsOf(type) {
  const out = [];
  for (const unity of assets) {
    for (const doc of unity.docs) {
      if (doc.classId !== 114 || doc.stripped) continue;
      const name = NAME_BY_GUID[scriptGuid(doc)];
      if (type(name)) out.push({ unity, doc, name, where: `${unity.rel}: ${objectPath(unity, gameObjectOf(doc))}` });
    }
  }
  return out;
}

const textComponents = componentsOf((n) => TMP_TEXT_TYPES.has(n));
const inputFields = componentsOf((n) => n === 'TMP_InputField');

/** fileIDs used as a TMP_InputField's text component (typed Latin input). */
const inputTextIds = new Set(inputFields.map(({ unity, doc }) => `${unity.rel}#${localRef(field(doc, 'm_TextComponent'))}`));

function textOf({ doc, name }) {
  return RTL_TEXT_TYPES.has(name) ? unquote(field(doc, 'originalText')) : unquote(field(doc, 'm_text'));
}

describe('Arabic UI: scenes and prefabs', () => {
  test('the project has scenes and prefabs to check', () => {
    expect(assets.length).toBeGreaterThanOrEqual(19);
    expect(textComponents.length).toBeGreaterThan(100);
  });

  test('no legacy UnityEngine.UI.Text or InputField is left', () => {
    const legacy = componentsOf((n) => n === 'Text' || n === 'InputField').map((c) => `${c.name} at ${c.where}`);
    expect(legacy).toEqual([]);
  });

  test('every label is RTLTMPro; only typed-input text components are left-to-right TextMeshPro', () => {
    const problems = [];
    for (const c of textComponents) {
      const isInputText = inputTextIds.has(`${c.unity.rel}#${c.doc.fileID}`);
      if (isInputText && c.name !== 'TextMeshProUGUI') problems.push(`${c.where}: input text should be TextMeshProUGUI, is ${c.name}`);
      if (!isInputText && !RTL_TEXT_TYPES.has(c.name)) problems.push(`${c.where}: label is ${c.name}, must be RTLTextMeshPro(3D)`);
      const text = textOf(c) || '';
      if (ARABIC.test(text) && !RTL_TEXT_TYPES.has(c.name)) problems.push(`${c.where}: Arabic text "${text}" on non-RTL ${c.name}`);
    }
    expect(problems).toEqual([]);
  });

  test('RTLTMPro components use Arabic settings and hold their shaped text', () => {
    const problems = [];
    for (const c of textComponents.filter((t) => RTL_TEXT_TYPES.has(t.name))) {
      const want = { farsi: '0', preserveNumbers: '1', fixTags: '1', forceFix: '0' };
      for (const [k, v] of Object.entries(want)) {
        if (field(c.doc, k) !== v) problems.push(`${c.where}: ${k} is ${field(c.doc, k)}, expected ${v}`);
      }
      const original = unquote(field(c.doc, 'originalText'));
      const shown = unquote(field(c.doc, 'm_text'));
      if (original === undefined) problems.push(`${c.where}: originalText missing`);
      else if (ARABIC.test(original)) {
        // RTLTextMeshPro stores the joined (presentation-form) text in m_text.
        if (field(c.doc, 'm_isRightToLeft') !== '1') problems.push(`${c.where}: Arabic text not marked right-to-left`);
        if (ARABIC_BASE_LETTER.test(shown || '')) problems.push(`${c.where}: m_text still has unjoined Arabic letters`);
      } else if (shown !== original) {
        problems.push(`${c.where}: m_text "${shown}" differs from originalText "${original}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('every text uses the project default font (TMP Settings) or a font asset that exists', () => {
    const problems = [];
    for (const c of textComponents) {
      const font = field(c.doc, 'm_fontAsset');
      if (font === undefined) {
        problems.push(`${c.where}: m_fontAsset missing`);
        continue;
      }
      const guid = (font.match(/guid: ([0-9a-f]{32})/) || [])[1];
      if (guid) {
        const found = listFiles(path.join(PROJECT, 'Assets'), '.meta').some((m) => metaGuid(m.slice(0, -5)) === guid);
        if (!found) problems.push(`${c.where}: font asset ${guid} is not in the repository`);
      } else if (font !== '{fileID: 0}') {
        problems.push(`${c.where}: unexpected m_fontAsset ${font}`);
      } else if (field(c.doc, 'm_sharedMaterial') !== '{fileID: 0}') {
        problems.push(`${c.where}: material set without a font asset`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('every TMP_InputField has its viewport, text component and placeholder wired', () => {
    const problems = [];
    for (const { unity, doc, where } of inputFields) {
      const viewport = unity.byId.get(localRef(field(doc, 'm_TextViewport')));
      const text = unity.byId.get(localRef(field(doc, 'm_TextComponent')));
      const placeholder = unity.byId.get(localRef(field(doc, 'm_Placeholder')));
      if (!viewport || viewport.classId !== 224) problems.push(`${where}: m_TextViewport is not a RectTransform`);
      if (!text || NAME_BY_GUID[scriptGuid(text)] !== 'TextMeshProUGUI') problems.push(`${where}: m_TextComponent is not TextMeshProUGUI`);
      if (!placeholder || NAME_BY_GUID[scriptGuid(placeholder)] !== 'RTLTextMeshPro') problems.push(`${where}: m_Placeholder is not RTLTextMeshPro`);
      const content = field(doc, 'm_ContentType');
      if (content === '7' && field(doc, 'm_InputType') !== '2') problems.push(`${where}: password field must use InputType.Password`);
      if (content === '6' && field(doc, 'm_CharacterValidation') !== '7') problems.push(`${where}: email field must use EmailAddress validation`);
    }
    expect(inputFields.length).toBe(7);
    expect(problems).toEqual([]);
  });

  test('every TMP_Text / TMP_InputField field on a project script points at a matching component', () => {
    const problems = [];
    let checked = 0;
    for (const unity of assets) {
      for (const doc of unity.docs) {
        if (doc.classId !== 114 || doc.stripped) continue;
        const script = scripts.get(scriptGuid(doc));
        if (!script) continue;
        const fields = serializedFieldsOfType(stripComments(script.source), ['TMP_Text', 'TMPro.TMP_Text', 'TMP_InputField', 'TMPro.TMP_InputField']);
        for (const f of fields) {
          checked++;
          const where = `${unity.rel}: ${script.name}.${f.name} (${objectPath(unity, gameObjectOf(doc))})`;
          const raw = field(doc, f.name);
          if (raw === undefined) {
            problems.push(`${where}: not serialized`);
            continue;
          }
          const target = localRef(raw);
          if (target === null) continue; // a reference into another asset; Unity resolves it
          const targetDoc = unity.byId.get(target);
          if (target === '0' || !targetDoc) {
            problems.push(`${where}: ${target === '0' ? 'not assigned' : `missing object ${target}`}`);
            continue;
          }
          const targetType = NAME_BY_GUID[scriptGuid(targetDoc)];
          const wantInput = f.type.endsWith('TMP_InputField');
          if (wantInput ? targetType !== 'TMP_InputField' : !TMP_TEXT_TYPES.has(targetType)) {
            problems.push(`${where}: points at ${targetType || `class ${targetDoc.classId}`}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(60);
    expect(problems).toEqual([]);
  });

  test('prefab-instance overrides of a text component name a field that component has', () => {
    // An override of the legacy Text field (m_Text) on a converted
    // component would silently stop applying: the label shows the
    // prefab's default text instead.
    const prefabsByGuid = new Map(assets.filter((u) => u.rel.endsWith('.prefab')).map((u) => [metaGuid(path.join(PROJECT, u.rel)), u]));
    const problems = [];
    let checked = 0;
    for (const unity of assets) {
      for (const doc of unity.docs.filter((d) => d.classId === 1001)) {
        const mods = doc.body.matchAll(/- target: \{fileID: (-?\d+), guid: ([0-9a-f]{32}), type: 3\}\r?\n\s+propertyPath: ([^\r\n]+)/g);
        for (const [, targetId, guid, propertyPath] of mods) {
          const prefab = prefabsByGuid.get(guid);
          const target = prefab && prefab.byId.get(targetId);
          if (!target || !TMP_TEXT_TYPES.has(NAME_BY_GUID[scriptGuid(target)])) continue;
          checked++;
          const root = propertyPath.split('.')[0];
          if (field(target, root) === undefined) {
            problems.push(`${unity.rel}: override "${propertyPath}" on ${prefab.rel} &${targetId} (${NAME_BY_GUID[scriptGuid(target)]}) matches no field`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test('scene/prefab structure: ascending fileIDs and no dangling local references', () => {
    const problems = [];
    for (const unity of assets) {
      // Unity resolves scene objects by binary search: out-of-order fileIDs
      // make children/components silently disappear (HANDOFF item 3).
      for (let i = 1; unity.rel.endsWith('.unity') && i < unity.docs.length; i++) {
        if (BigInt(unity.docs[i].fileID) <= BigInt(unity.docs[i - 1].fileID)) {
          problems.push(`${unity.rel}: fileID ${unity.docs[i].fileID} is not ascending`);
          break;
        }
      }
      for (const doc of unity.docs) {
        for (const m of doc.body.matchAll(/\{fileID: (-?\d+)\}/g)) {
          if (m[1] !== '0' && !unity.byId.has(m[1])) problems.push(`${unity.rel}: &${doc.fileID} references missing local object ${m[1]}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('Arabic UI: scripts', () => {
  const sources = listFiles(SCRIPTS_DIR, '.cs').map((f) => ({ rel: path.relative(PROJECT, f), code: stripComments(fs.readFileSync(f, 'utf8')) }));

  test('no script expects the legacy Text / InputField types', () => {
    const legacy = [];
    const decl = /^\s*(?:\[[^\]]*\]\s*)*(?:(?:private|public|protected|internal)\s+)?(?:UnityEngine\.UI\.)?(?:Text|InputField)(?:\[\])?\s+\w+\s*[;=]/m;
    const use = /(?:GetComponent(?:InChildren|InParent)?|AddComponent)<(?:UnityEngine\.UI\.)?(?:Text|InputField)>|UnityEngine\.UI\.(?:Text|InputField)\b/;
    for (const { rel, code } of sources) {
      code.split('\n').forEach((line, i) => {
        if (decl.test(line) || use.test(line)) legacy.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(legacy).toEqual([]);
  });

  test('sentence punctuation after a Latin word, number or {value} in Arabic text is preceded by U+200F', () => {
    // RTLTMPro would otherwise draw that punctuation on the wrong side
    // (e.g. "تم تجهيز item." showing the period between the two words).
    const problems = [];
    const literal = /\$?"((?:[^"\\\n]|\\.)*)"/g;
    for (const { rel, code } of sources) {
      for (const m of code.matchAll(literal)) {
        const body = m[1];
        if (!ARABIC.test(body)) continue;
        const decoded = body.replace(/\\u200F/g, '‏').replace(/\\"/g, '"');
        if (/[A-Za-z0-9)\]}"][.!?…:،؟]+(?=\s|$)/.test(decoded)) problems.push(`${rel}: "${body}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("the client's username rule is the backend's", () => {
    const cs = fs.readFileSync(path.join(SCRIPTS_DIR, 'Auth/UsernameRules.cs'), 'utf8');
    const csPattern = cs.match(/public const string Pattern = "([^"]+)";/)[1];
    const js = fs.readFileSync(path.join(PROJECT, 'backend/src/services/auth.service.js'), 'utf8');
    const jsPattern = js.match(/const USERNAME_REGEX = \/(.+)\/;/)[1];
    expect(csPattern).toBe(jsPattern);
  });
});

describe('Arabic UI: packages', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT, 'Packages/manifest.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(PROJECT, 'Packages/packages-lock.json'), 'utf8'));

  test('RTLTMPro is the Unity 6 v4.0.0 package, pinned by tag and lock hash', () => {
    expect(manifest.dependencies['com.nosuchstudio.rtltmpro']).toBe('https://github.com/hk1ll3r/RTLTMPro.git?path=/UPMPackage#v4.0.0');
    expect(lock.dependencies['com.nosuchstudio.rtltmpro']).toMatchObject({ source: 'git', hash: '69c9193fc27218f17679cc57382a61ac4a717b2b' });
    expect(manifest.dependencies['com.unity.ugui']).toBe('2.0.0');
  });

  test('no RTLTMPro demo resources or third-party fonts are imported into Assets', () => {
    expect(fs.existsSync(path.join(PROJECT, 'Assets/RTLTMPro'))).toBe(false);
    // A font may be added only next to its license file (see HANDOFF, Arabic
    // font); TMP Essentials ship "LiberationSans - OFL.txt" this way.
    const hasLicense = (dir) => fs.readdirSync(dir).some((n) => /(OFL|LICEN[CS]E)[^/]*\.(txt|md)$/i.test(n));
    const fonts = [...listFiles(path.join(PROJECT, 'Assets'), '.ttf'), ...listFiles(path.join(PROJECT, 'Assets'), '.otf')]
      .filter((f) => !hasLicense(path.dirname(f)));
    expect(fonts.map((f) => path.relative(PROJECT, f))).toEqual([]);
  });

  test('component GUIDs used by the checks are the ones in the scenes', () => {
    const used = new Set();
    for (const unity of assets) for (const doc of unity.docs) if (doc.classId === 114) used.add(scriptGuid(doc));
    expect(used.has(GUID.RTLTextMeshPro)).toBe(true);
    expect(used.has(GUID.TMP_InputField)).toBe(true);
    expect(used.has(GUID.TextMeshProUGUI)).toBe(true);
  });
});
