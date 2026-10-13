// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (test/fixtures/hmip): a recorded home of 46 Homematic IP devices
// (thermostats, contacts, sensors, plugs, dimmers, covers, remotes, weather
// stations...) with its heating rooms and its alarm — in every feature-name
// language, and in a variant with the other modes of the configurable devices.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakeCloud, fixtureState } from './helpers/fakeCloud.js';
import { createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

/** The recorded home with the other settings of its configurable devices. */
function variantState() {
  const state = fixtureState();
  // The flush-mount contact interface wired to a door contact, not a button.
  state.devices['3014F7110000000000000029'].functionalChannels['1'].multiModeInputMode =
    'BINARY_BEHAVIOR';
  // A request-based alarm panel (ABSENCE / PRESENCE zones).
  for (const group of Object.values(state.groups)) {
    if (group.type === 'SECURITY_ZONE') {
      group.label = group.label === 'INTERNAL' ? 'ABSENCE' : 'PRESENCE';
    }
  }
  // A room where eco is not allowed, and the home in vacation.
  state.groups['00000000-0000-0000-0000-000000000012'].ecoAllowed = false;
  state.home.functionalHomes.INDOOR_CLIMATE.absenceType = 'VACATION';
  return state;
}

const scenarios = [
  { label: 'default configuration (French names)', config: {} },
  { label: 'English names', config: { language: 'en' } },
  { label: 'German names', config: { language: 'de' } },
  { label: 'Spanish names', config: { language: 'es' } },
  { label: 'other device modes', config: { language: 'en' }, state: variantState },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const cloud = new FakeCloud(scenario.state ? { state: scenario.state() } : {});
    const { fake, app } = await createWorld({
      cloud,
      config: { access_point: '3014F711A000000BAD0CAAAA', ...scenario.config },
    });
    try {
      const devices = fake.discoveredDevices;
      assert.ok(devices.length >= 40, `only ${devices.length} devices discovered`);

      const deviceIds = new Set();
      for (const device of devices) {
        const where = `${device.name} (${device.model})`;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: ${feature.unit} for ${feature.category}`,
              );
            }
          }
          if (feature.step !== undefined) {
            assert.ok(Number.isFinite(feature.step) && feature.step > 0, `${at}: step`);
          }
          // The core refuses a blank, padded or duplicated option value;
          // string values on text/select only, integers elsewhere.
          if (feature.supported_options !== undefined) {
            const values = feature.supported_options.map((option) => String(option.value));
            assert.equal(new Set(values).size, values.length, `${at}: duplicate option values`);
            for (const option of feature.supported_options) {
              if (feature.category === 'text' && feature.type === 'select') {
                assert.ok(
                  typeof option.value === 'string' &&
                    option.value === option.value.trim() &&
                    option.value,
                  `${at}: option value "${option.value}"`,
                );
              } else {
                assert.ok(Number.isInteger(option.value), `${at}: option value "${option.value}"`);
              }
              assert.ok(option.label?.trim(), `${at}: option without label`);
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(feature.external_id.startsWith(`${device.external_id}:`), `${at}: external_id`);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
          assert.ok(feature.name.length <= 60, `${at}: name too long`);
        }
      }
    } finally {
      await app.stop();
    }
  });
}

test('the published states are within the bounds of their features', async () => {
  const world = await createWorld({ config: { access_point: '3014F711A000000BAD0CAAAA' } });
  try {
    for (const device of world.fake.discoveredDevices) {
      await world.fake.deviceCreated(device);
    }
    await world.hub.idle();
    const features = new Map(
      world.fake.discoveredDevices.flatMap((device) =>
        device.features.map((feature) => [feature.external_id, feature]),
      ),
    );
    assert.ok(world.fake.states.length > 100);
    for (const state of world.fake.states) {
      const feature = features.get(state.device_feature_external_id);
      assert.ok(feature, `state for an unknown feature ${state.device_feature_external_id}`);
      if (state.text !== undefined) {
        assert.equal(feature.type, 'select');
        assert.ok(feature.supported_options.some((option) => option.value === state.text));
        continue;
      }
      assert.ok(
        state.state >= feature.min && state.state <= feature.max,
        `${feature.name}: ${state.state} outside [${feature.min}, ${feature.max}]`,
      );
    }
  } finally {
    await world.app.stop();
  }
});
