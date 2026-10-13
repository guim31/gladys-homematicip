// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names and the documentation. German says "du", never the
// polite "Sie".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { NAMES } from '../src/devices.js';
import {
  CONNECTION_TEXT,
  INIT_FAILED,
  MESSAGES,
  TRANSPORT_TEXT,
  allLanguages,
} from '../src/texts.js';
import { TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  section: 1000,
  message: 200,
  transport: 200,
  short: 24,
  status: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      // The store schema caps the catalog and widget descriptions, and widget
      // labels; a section text may be long.
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : /^manifest\.config_schema\[0\]\.description$/.test(path)
              ? MAX.section
              : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
  assert.deepEqual(Object.keys(MESSAGES), LANGS);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 50, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the brand, the same in every language', () => {
  assert.equal(manifest.name, 'Homematic IP');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});

test('the catalog description holds 10 characters at least in every language', () => {
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max, render = (value) => value) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

test('the feature names exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
});

test('the messages of the code exist in every language', () => {
  const render = (value) =>
    typeof value === 'function' ? value('HTTP 403 INVALID_PIN', 42) : value;
  assert.deepEqual(tableProblems(MESSAGES, 'MESSAGES', MAX.message, render), []);
  const found = [
    ...problems(INIT_FAILED, 'INIT_FAILED', MAX.message),
    ...Object.entries(CONNECTION_TEXT).flatMap(([key, value]) =>
      problems(value, `CONNECTION_TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(TRANSPORT_TEXT).flatMap(([key, value]) =>
      problems(value, `TRANSPORT_TEXT.${key}`, MAX.transport),
    ),
    ...problems(allLanguages('paired', 12, 3), 'paired report', MAX.message),
  ];
  assert.deepEqual(found, []);
});

test('the widget texts exist in every language, short where the widget is short', () => {
  const short = new Set([
    'outside',
    'heatingRooms',
    'startEco',
    'endEco',
    'windowOpen',
    'boost',
    'eco',
  ]);
  const found = Object.entries(TEXT).flatMap(([key, value]) => {
    const rendered = Object.fromEntries(
      Object.entries(value).map(([lang, text]) => [
        lang,
        typeof text === 'function' ? text('20 oct. 18:00') : text,
      ]),
    );
    return problems(rendered, `TEXT.${key}`, short.has(key) ? MAX.short : MAX.message);
  });
  assert.deepEqual(found, []);
});

test('the messages name the configuration fields and buttons as the manifest does', () => {
  const field = (key) => manifest.config_schema.find((entry) => entry.key === key);
  const action = (key) => manifest.actions.find((entry) => entry.key === key);
  for (const lang of LANGS) {
    assert.ok(MESSAGES[lang].alarmOff.includes(field('alarm_control').label[lang]), lang);
    assert.ok(MESSAGES[lang].requestSent.includes(action('confirm_pairing').label[lang]), lang);
    assert.ok(MESSAGES[lang].noPairing.includes(action('start_pairing').label[lang]), lang);
    assert.ok(CONNECTION_TEXT.notPaired[lang].includes(action('start_pairing').label[lang]), lang);
    // The alarm modes read the same on the device and in the scene action.
    const options = manifest.scene_actions.find((entry) => entry.key === 'set_alarm_mode').fields[0]
      .options;
    for (const option of options) {
      assert.equal(NAMES[lang][option.value], option.label[lang], `${lang} ${option.value}`);
    }
  }
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Heat', fr: 'Chauffe', de: 'Heizen' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: '', es: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Gerät', 'Ihre IP', 'mit Ihrem', 'Ihren', 'Ihrer']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_actions[1].fields[1].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_actions[1].fields[1].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation -------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

// The text as read: Prettier wraps lines anywhere, quotes start with "> ".
const flat = (markdown) => markdown.replace(/\n>\s*/g, ' ').replace(/\s+/g, ' ');

const headings = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four documentation files exist, with the same sections', () => {
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 300, `docs/${lang}.md is too short for the store`);
    assert.deepEqual(headings(docs[lang]), headings(docs.en), `docs/${lang}.md sections`);
  }
  assert.ok(headings(docs.en).length >= 10);
});

test('the documentation names every feature, trigger, action, option and widget button', () => {
  const features = [
    'temperature',
    'humidity',
    'co2',
    'illuminance',
    'wind',
    'rain',
    'opening',
    'motion',
    'presence',
    'smoke',
    'leak',
    'waterLevel',
    'batteryLow',
    'tamper',
    'switch',
    'power',
    'energy',
    'light',
    'brightness',
    'position',
    'movement',
    'button',
    'heating',
    'setPoint',
    'mode',
    'boost',
    'window',
    'absence',
    'alarmMode',
    'alarm',
    'automatic',
    'manual',
    'eco',
    'disarmed',
    'perimeter',
    'full',
  ];
  for (const lang of LANGS) {
    const doc = flat(docs[lang]);
    const items = [...manifest.scene_triggers, ...manifest.scene_actions, ...manifest.actions];
    for (const item of items) {
      assert.ok(doc.includes(item.label[lang]), `docs/${lang}.md: "${item.label[lang]}"`);
    }
    for (const key of features) {
      assert.ok(doc.includes(NAMES[lang][key]), `docs/${lang}.md: feature "${NAMES[lang][key]}"`);
    }
    for (const key of ['startEco', 'endEco', 'outside', 'heatingRooms']) {
      assert.ok(doc.includes(TEXT[key][lang]), `docs/${lang}.md: "${TEXT[key][lang]}"`);
    }
    for (const field of manifest.config_schema.filter((entry) => entry.type !== 'section')) {
      assert.ok(doc.includes(field.label[lang]), `docs/${lang}.md: "${field.label[lang]}"`);
    }
    for (const option of manifest.config_schema.find((entry) => entry.key === 'alarm_control')
      .options) {
      assert.ok(doc.includes(option.label[lang]), `docs/${lang}.md: "${option.label[lang]}"`);
    }
    for (const option of manifest.scene_triggers[0].fields[1].options) {
      assert.ok(doc.includes(option.label[lang]), `docs/${lang}.md: "${option.label[lang]}"`);
    }
    assert.ok(doc.includes(manifest.widgets[0].label[lang]), `docs/${lang}.md: widget`);
  }
});

test('the German documentation says "du"', () => {
  const polite = docs.de
    .split('\n')
    .filter((line) => !line.startsWith('`') && POLITE_GERMAN.test(line));
  assert.deepEqual(polite, []);
});

test('the documentation says it was developed without the hardware, and not affiliated', () => {
  for (const lang of LANGS) {
    assert.match(flat(docs[lang]), /Developed without the hardware: feedback welcome/);
    assert.match(docs[lang], /github\.com\/guim31\/gladys-homematicip\/issues/);
    assert.match(flat(docs[lang]), /eQ-3/);
  }
  assert.match(flat(docs.en), /not affiliated with eQ-3/);
});
