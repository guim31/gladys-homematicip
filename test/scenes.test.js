// -----------------------------------------------------------------------------
// Scene actions: eco mode, vacation, end, and the alarm within its policy.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_POINT, FakeCloud, IDS, createWorld, settle } from './helpers/world.js';

async function world(t, options) {
  const created = await createWorld(options);
  t.after(() => created.app.stop());
  return created;
}

test('start_absence: for a number of hours, or until ended', async (t) => {
  const w = await world(t);
  assert.deepEqual(await w.fake.sceneAction('start_absence', { duration: 3 }), { success: true });
  assert.deepEqual(w.cloud.callsTo('home/heating/activateAbsenceWithDuration')[0].body, {
    duration: 180,
  });
  assert.equal((await w.fake.sceneAction('start_absence', { duration: 0 })).success, true);
  assert.equal(w.cloud.callsTo('home/heating/activateAbsencePermanent').length, 1);
  assert.equal(w.cloud.callsTo('home/heating/activateAbsencePermanent')[0].body, undefined);
});

test('start_vacation: an end date in the time zone of the home, a half-degree temperature', async (t) => {
  const now = Date.UTC(2026, 9, 13, 18, 0);
  const w = await world(t, { now: () => now });
  const ack = await w.fake.sceneAction('start_vacation', { days: 7, temperature: 16.2 });
  assert.equal(ack.success, true, ack.error);
  // The recorded home is in Europe/Vienna: UTC+2 in October.
  assert.deepEqual(w.cloud.callsTo('home/heating/activateVacation')[0].body, {
    endTime: '2026_10_20 20:00',
    temperature: 16,
  });
  await settle(w);
  assert.equal(w.hub.snapshot.home.functionalHomes.INDOOR_CLIMATE.absenceType, 'VACATION');
  assert.equal((await w.fake.sceneAction('end_absence', {})).success, true);
  assert.equal(w.cloud.callsTo('home/heating/deactivateVacation').length, 1);
});

test('end_absence ends an absence with its own call', async (t) => {
  const w = await world(t);
  await w.fake.sceneAction('start_absence', {});
  await settle(w);
  await w.fake.sceneAction('end_absence', {});
  assert.equal(w.cloud.callsTo('home/heating/deactivateAbsence').length, 1);
});

test('set_alarm_mode: refused by default, then applied, with the sensors that block it', async (t) => {
  const w = await world(t);
  const refused = await w.fake.sceneAction('set_alarm_mode', { mode: 'full' });
  assert.equal(refused.success, false);
  assert.match(refused.error, /disabled in the configuration/);

  await w.fake.configUpdated({ access_point: ACCESS_POINT, language: 'en', alarm_control: 'arm' });
  assert.deepEqual(await w.fake.sceneAction('set_alarm_mode', { mode: 'perimeter' }), {
    success: true,
    data: { outputs: { applied: true, blocking_sensors: '' } },
  });
  w.cloud.blockingSensors = [IDS.contact];
  assert.deepEqual(await w.fake.sceneAction('set_alarm_mode', { mode: 'full' }), {
    success: true,
    data: { outputs: { applied: false, blocking_sensors: 'Fenster' } },
  });
  const disarm = await w.fake.sceneAction('set_alarm_mode', { mode: 'disarmed' });
  assert.equal(disarm.success, false);
});

test('a home without heating or alarm says so', async (t) => {
  const cloud = new FakeCloud();
  cloud.state.home.functionalHomes.INDOOR_CLIMATE.active = false;
  cloud.state.home.functionalHomes.SECURITY_AND_ALARM.active = false;
  const w = await world(t, {
    cloud,
    config: { access_point: ACCESS_POINT, language: 'en', alarm_control: 'arm_disarm' },
  });
  assert.match((await w.fake.sceneAction('start_absence', {})).error, /no heating/);
  assert.match((await w.fake.sceneAction('set_alarm_mode', { mode: 'full' })).error, /no alarm/);
  const home = w.fake.discoveredDevices.find((device) => device.model === 'HOME');
  assert.equal(home, undefined, 'no home device without heating nor alarm');
});

test('not paired: the scene actions fail with the reason', async (t) => {
  const w = await world(t, { paired: false });
  const ack = await w.fake.sceneAction('end_absence', {});
  assert.equal(ack.success, false);
  assert.match(ack.error, /not paired/);
});
