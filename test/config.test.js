import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseAccessPointId } from '../src/config.js';

test('the SGTIN is accepted as printed (groups, dashes, lower case)', () => {
  assert.equal(parseAccessPointId('3014-F711-A000-000B-AD0C-AAAA'), '3014F711A000000BAD0CAAAA');
  assert.equal(parseAccessPointId(' 3014 f711 a000 000b ad0c aaaa '), '3014F711A000000BAD0CAAAA');
  assert.equal(parseAccessPointId('3014F711A000000BAD0CAAA'), null, '23 characters');
  assert.equal(parseAccessPointId('3014F711A000000BAD0CAAAG'), null, 'not hexadecimal');
  assert.equal(parseAccessPointId(42), null);
});

test('the defaults: no access point, French names, alarm read only', () => {
  assert.deepEqual(normalizeConfig(), {
    accessPoint: null,
    invalidAccessPoint: false,
    pin: null,
    language: 'fr',
    alarmControl: 'off',
  });
  assert.deepEqual(normalizeConfig(null), normalizeConfig({}));
  assert.equal(DEFAULT_CONFIG.alarm_control, 'off');
});

test('the values are checked, the unknown ones fall back to the defaults', () => {
  const config = normalizeConfig({
    access_point: 'not an sgtin',
    pin: ' 1234 ',
    language: 'it',
    alarm_control: 'everything',
  });
  assert.equal(config.accessPoint, null);
  assert.equal(config.invalidAccessPoint, true);
  assert.equal(config.pin, '1234');
  assert.equal(config.language, 'fr');
  assert.equal(config.alarmControl, 'off');
  assert.equal(normalizeConfig({ alarm_control: 'arm_disarm' }).alarmControl, 'arm_disarm');
  assert.equal(normalizeConfig({ pin: '   ' }).pin, null);
});
