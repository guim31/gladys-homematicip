// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ALARM_CONTROL, DEFAULT_CONFIG, LANGUAGES } from '../src/config.js';
import { TRIGGER, WIDGET_KEY } from '../src/hub.js';
import { ALARM_CAUSE_KEYS, ALARM_MODES } from '../src/hmip/model.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...(manifest.contact_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// Manifest fields older Gladys releases reject as unknown, with the first
// release accepting them. The store validator refuses a manifest whose
// `gladys_version` minimum is lower: these tests catch it before a release.
const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Minimum version of the manifest `gladys_version` range, e.g. [5, 1, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, cover, cloud transport, climate and security', () => {
  assert.equal(manifest.name, 'Homematic IP');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-homematicip:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-homematicip/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['climate', 'security']);
  assert.equal(manifest.network_discovery, undefined, 'the cloud needs no local discovery');
});

test('every manifest action has a handler, and none needs a field', async (t) => {
  const world = await createWorld({ paired: false, config: { language: 'en' } });
  t.after(() => world.app.stop());
  assert.deepEqual(keysOf(manifest.actions), ['start_pairing', 'confirm_pairing', 'refresh']);
  for (const action of manifest.actions) {
    // The core applies no default to an action and a secret cannot be typed
    // there (GladysAssistant/Gladys#3154, #3155): no field at all.
    assert.equal(action.fields, undefined, action.key);
    const ack = await world.fake.action(action.key, {});
    assert.ok(ack.success === true || typeof ack.error === 'string', `${action.key}: no handler`);
    assert.doesNotMatch(String(ack.error), /not implemented/);
  }
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(
    isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION),
    `categories requires gladys_version >= 4.86.0, got "${manifest.gladys_version}"`,
  );
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((field) => manifest[field] !== undefined);
  assert.deepEqual(declared, CAPABILITY_FIELDS);
  assert.ok(
    isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION),
    `${declared.join(', ')} requires gladys_version >= 5.1.0, got "${manifest.gladys_version}"`,
  );
  // No widget button opens a form (#3168, Gladys 5.2.0): 5.1.0 is enough.
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('the alarm trigger is the one the hub fires, with its filters and variables', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers), [TRIGGER]);
  const [trigger] = manifest.scene_triggers;
  // The event data the hub sends (src/hub.js checkAlarm).
  const data = ['cause', 'device', 'sensor'];
  for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
    assert.ok(data.includes(key), `"${key}" is in the event data`);
  }
  const cause = trigger.fields.find((field) => field.key === 'cause');
  assert.deepEqual(
    cause.options.map((option) => option.value),
    ALARM_CAUSE_KEYS,
  );
  const device = trigger.fields.find((field) => field.key === 'device');
  assert.equal(device.source, 'devices');
});

test('the scene actions: fields and outputs the handlers use', () => {
  const action = (key) => manifest.scene_actions.find((entry) => entry.key === key);
  assert.deepEqual(keysOf(action('start_absence').fields), ['duration']);
  assert.deepEqual(keysOf(action('start_vacation').fields), ['days', 'temperature']);
  assert.equal(action('end_absence').fields, undefined);
  const alarm = action('set_alarm_mode');
  assert.deepEqual(
    alarm.fields[0].options.map((option) => option.value),
    ALARM_MODES,
  );
  assert.deepEqual(keysOf(alarm.outputs), ['applied', 'blocking_sensors']);
  // Number fields are rendered without step: integer minimums and defaults only.
  for (const field of allFields.filter((entry) => entry.type === 'number')) {
    assert.ok(Number.isInteger(field.min), `${field.key}: integer min`);
    assert.ok(field.default === undefined || Number.isInteger(field.default), field.key);
  }
});

test('the widget is the one the code serves, set on rooms', () => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(keysOf(manifest.widgets[0].settings), ['rooms']);
});

test('the selects of the configuration offer what the code knows', () => {
  const field = (key) => manifest.config_schema.find((entry) => entry.key === key);
  assert.deepEqual(
    field('language').options.map((option) => option.value),
    LANGUAGES,
  );
  assert.deepEqual(
    field('alarm_control').options.map((option) => option.value),
    ALARM_CONTROL,
  );
  assert.equal(field('pin').type, 'secret');
  assert.equal(field('access_point').required, true);
});

test('every scene_actions key has an onSceneAction handler, and vice versa', () => {
  const declared = keysOf(manifest.scene_actions);
  for (const key of declared) {
    assert.equal(typeof SCENE_ACTIONS[key], 'function', `scene action "${key}" has no handler`);
  }
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.ok(declared.includes(key), `handler "${key}" is not declared in scene_actions`);
  }
});

test('every widgets key has an onWidgetGet handler, and vice versa', () => {
  const declared = keysOf(manifest.widgets);
  for (const key of declared) {
    assert.equal(typeof WIDGETS[key]?.get, 'function', `widget "${key}" has no content handler`);
  }
  for (const key of Object.keys(WIDGETS)) {
    assert.ok(declared.includes(key), `widget "${key}" is not declared in widgets`);
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0, 'the configuration opens with a section block');
  for (const section of sections) {
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(
      section.placeholder,
      undefined,
      `section "${section.key}" must not have a placeholder`,
    );
    assert.ok(section.label?.en, `section "${section.key}" needs an English label`);
    assert.ok(
      !(section.key in DEFAULT_CONFIG),
      `section "${section.key}" stores no value and must not appear in DEFAULT_CONFIG`,
    );
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0, 'the device fields are dynamic selects');
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices', 'the only core-defined source used is "devices"');
    assert.equal(
      field.options,
      undefined,
      `field "${field.key}": declaring source and options together rejects the manifest`,
    );
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  // The Release workflow writes all three: a mismatch means one was edited by
  // hand, and Gladys would offer a version whose image is another one.
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  assert.ok(manifest.description.en, 'the description needs an English text');
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('field placeholders are multi-language objects', () => {
  const withPlaceholder = allFields.filter((f) => f.placeholder !== undefined);
  assert.ok(withPlaceholder.length > 0, 'the SGTIN field has a placeholder');
  for (const field of withPlaceholder) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en, `field "${field.key}": placeholder needs an English text`);
  }
});
