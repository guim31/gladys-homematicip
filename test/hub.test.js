// -----------------------------------------------------------------------------
// The integration end to end, against the fake cloud and the SDK's fake
// Gladys: pairing, discovery, states, commands, the event stream, key
// presses, the alarm and its trigger, the transport badges, the failures.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONNECTION_TEXT } from '../src/texts.js';
import { ALARM_MODES } from '../src/hmip/model.js';
import {
  ACCESS_POINT,
  FakeCloud,
  IDS,
  ROOM,
  createAll,
  createWorld,
  deviceId,
  featureId,
  homeFeatureId,
  roomFeatureId,
  roomId,
  settle,
} from './helpers/world.js';

async function createdWorld(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

const setValue = (world, featureExternalId, value) =>
  world.fake.setValue(
    { external_id: featureExternalId.split(':').slice(0, -1).join(':') },
    { external_id: featureExternalId },
    value,
  );

// --- Configuration and pairing -------------------------------------------------

test('without an SGTIN, the status says to type it, and nothing is read', async (t) => {
  const cloud = new FakeCloud();
  const world = await createWorld({ cloud, paired: false, config: { language: 'en' } });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus, {
    connected: false,
    message: CONNECTION_TEXT.noAccessPoint,
  });
  assert.equal(cloud.calls.length, 0);
  assert.deepEqual(world.fake.discoveredDevices, []);

  const ack = await world.fake.action('start_pairing', {});
  assert.equal(ack.success, false);
  assert.match(ack.error, /Type the SGTIN/);

  await world.fake.configUpdated({ access_point: '1234', language: 'en' });
  assert.deepEqual(world.fake.connectionStatus.message, CONNECTION_TEXT.invalidAccessPoint);
});

test('pairing: request, blue button, token saved under /data, then the home', async (t) => {
  const cloud = new FakeCloud({ tokens: [] });
  const world = await createWorld({ cloud, paired: false });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus.message, CONNECTION_TEXT.notPaired);

  const early = await world.fake.action('confirm_pairing', {});
  assert.equal(early.success, false);
  assert.match(early.error, /Click "Start pairing" first/);

  const started = await world.fake.action('start_pairing', {});
  assert.equal(started.success, true, started.error);
  assert.match(started.data.message.en, /press the blue button/);
  assert.match(started.data.message.de, /blaue Taste/);
  assert.equal(cloud.callsTo('auth/connectionRequest')[0].body.sgtin, ACCESS_POINT);

  const tooSoon = await world.fake.action('confirm_pairing', {});
  assert.equal(tooSoon.success, false);
  assert.match(tooSoon.error, /has not confirmed yet/);

  cloud.pressBlueButton();
  const paired = await world.fake.action('confirm_pairing', {});
  assert.equal(paired.success, true, paired.error);
  assert.match(paired.data.message.en, /^Paired: \d+ device\(s\), 8 room\(s\)/);
  assert.match(paired.data.message.fr, /^Appairé : \d+ appareil\(s\), 8 pièce\(s\)/);
  await settle(world);

  const file = join(world.dataDir, 'homematicip.json');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.accessPoint, ACCESS_POINT);
  assert.equal(saved.authToken, cloud.issuedToken);
  assert.equal(statSync(file).mode & 0o777, 0o600, 'the token file is private');

  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.ok(world.fake.discoveredDevices.length >= 40);
  assert.equal(world.hub.stream.connected, true);
});

test('pairing: a wrong PIN is refused with the reason', async (t) => {
  const cloud = new FakeCloud({ tokens: [], pin: '1234' });
  const world = await createWorld({
    cloud,
    paired: false,
    config: { access_point: ACCESS_POINT, pin: '9999', language: 'fr' },
  });
  t.after(() => world.app.stop());
  const ack = await world.fake.action('start_pairing', {});
  assert.equal(ack.success, false);
  assert.match(ack.error, /INVALID_PIN/);
  assert.match(ack.error, /code PIN/);
});

test('a paired access point is read at start; another SGTIN in the config needs a pairing', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  const devices = world.fake.discoveredDevices;
  assert.ok(devices.some((device) => device.external_id === deviceId(world.gladys, IDS.plug)));
  assert.ok(devices.some((device) => device.external_id === roomId(world.gladys, ROOM)));
  // The access point itself and the unmapped siren show nothing.
  for (const id of [IDS.accessPoint, IDS.sirenIndoor]) {
    assert.ok(!devices.some((device) => device.external_id === deviceId(world.gladys, id)), id);
  }
  assert.ok(devices.every((device) => device.should_poll === false));

  await world.fake.configUpdated({ access_point: '3014F711A000000BAD0CBBBB', language: 'en' });
  assert.deepEqual(world.fake.connectionStatus.message, CONNECTION_TEXT.notPaired);
  assert.deepEqual(world.fake.discoveredDevices, []);
  assert.equal(world.hub.stream, null);
});

test('the language of the configuration names the features, and changes them', async (t) => {
  const world = await createWorld({ config: { access_point: ACCESS_POINT } });
  t.after(() => world.app.stop());
  const room = () =>
    world.fake.discoveredDevices.find(
      (device) => device.external_id === roomId(world.gladys, ROOM),
    );
  assert.equal(room().name, 'Chauffage Schlafzimmer');
  assert.ok(room().features.some((feature) => feature.name === 'Consigne'));
  await world.fake.configUpdated({ access_point: ACCESS_POINT, language: 'de' });
  assert.equal(room().name, 'Heizung Schlafzimmer');
  assert.ok(room().features.some((feature) => feature.name === 'Solltemperatur'));
});

// --- States ------------------------------------------------------------------------

test('states are sent for the devices added to Gladys only, all of them on creation', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(world.fake.states.length, 0, 'nothing added yet');
  const plug = world.fake.discoveredDevices.find(
    (device) => device.external_id === deviceId(world.gladys, IDS.plug),
  );
  await world.fake.deviceCreated(plug);
  await settle(world);
  assert.equal(world.fake.lastState(featureId(world.gladys, IDS.plug, '1-switch')), 1);
  assert.equal(world.fake.lastState(featureId(world.gladys, IDS.plug, '1-power')), 195.3);
  assert.equal(world.fake.lastState(featureId(world.gladys, IDS.plug, '1-energy')), 35.536);
  assert.ok(
    world.fake.states.every((state) =>
      state.device_feature_external_id.startsWith(deviceId(world.gladys, IDS.plug)),
    ),
  );
  assert.deepEqual(world.fake.transports, [
    { device_external_id: deviceId(world.gladys, IDS.plug), transport: 'cloud' },
  ]);
});

test('the stream brings the changes made elsewhere; unchanged values are not sent again', async (t) => {
  const world = await createdWorld(t);
  const before = world.fake.states.length;
  world.cloud.changeDevice(IDS.contact, 1, { windowState: 'OPEN' });
  world.cloud.changeGroup(ROOM, { setPointTemperature: 21.5, actualTemperature: 20.1 });
  await settle(world);
  assert.equal(world.fake.lastState(featureId(world.gladys, IDS.contact, '1-opening')), 0);
  assert.equal(world.fake.lastState(roomFeatureId(world.gladys, ROOM, 'target-temperature')), 21.5);
  assert.equal(world.fake.lastState(roomFeatureId(world.gladys, ROOM, 'temperature')), 20.1);
  assert.equal(world.fake.states.length, before + 3, 'only what changed');
  world.cloud.changeDevice(IDS.contact, 1, { windowState: 'OPEN' });
  await settle(world);
  assert.equal(world.fake.states.length, before + 3);
});

test('a full read every 30 minutes (5 while the stream is down), without any onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = await createdWorld(t, { timers: true });
  assert.ok(world.fake.discoveredDevices.every((device) => device.should_poll === false));
  assert.ok(world.fake.discoveredDevices.every((device) => device.poll_frequency === undefined));
  const reads = () => world.cloud.callsTo('home/getCurrentState').length;
  const start = reads();

  // Changed without an event (a lost message): only a read can see it.
  world.cloud.channel(IDS.plug, 1).currentPowerConsumption = 12.5;
  t.mock.timers.tick(29 * 60_000);
  await settle(world);
  assert.equal(reads(), start, 'not before the interval');
  t.mock.timers.tick(60_000);
  await settle(world);
  assert.equal(reads(), start + 1);
  assert.equal(world.fake.lastState(featureId(world.gladys, IDS.plug, '1-power')), 12.5);
  assert.equal(
    world.fake.requests.filter((request) => request.path.includes('poll')).length,
    0,
    'Gladys never polled',
  );

  // The stream goes away: reads every 5 minutes until it is back.
  world.hub.stream.stop();
  world.hub.scheduleRefresh();
  t.mock.timers.tick(5 * 60_000);
  await settle(world);
  assert.equal(reads(), start + 2);
});

test('Gladys restarting gets everything again', async (t) => {
  const world = await createdWorld(t);
  const before = world.fake.states.length;
  await world.gladys.disconnect();
  await world.gladys.connect();
  await settle(world);
  assert.ok(world.fake.states.length >= before * 2 - 5, 'every state sent again');
});

test('a device added in the app shows in the Discovery list at once', async (t) => {
  const world = await createdWorld(t);
  const count = world.fake.discoveredDevices.length;
  const device = structuredClone(world.cloud.state.devices[IDS.plug]);
  device.id = '3014F7110000000000000777';
  device.label = 'New plug';
  for (const channel of Object.values(device.functionalChannels)) {
    channel.deviceId = device.id;
  }
  world.cloud.state.devices[device.id] = device;
  world.cloud.push({ pushEventType: 'DEVICE_ADDED', device });
  await settle(world);
  assert.equal(world.fake.discoveredDevices.length, count + 1);
  assert.ok(world.fake.discoveredDevices.some((entry) => entry.name === 'New plug'));
});

// --- Commands ----------------------------------------------------------------------

test('commands reach the cloud, and the stream brings the new state', async (t) => {
  const world = await createdWorld(t);
  const ok = async (key, value, id = IDS.plug) => {
    const ack = await setValue(world, featureId(world.gladys, id, key), value);
    assert.equal(ack.success, true, ack.error);
    await settle(world);
  };
  await ok('1-switch', 0);
  assert.deepEqual(world.cloud.callsTo('device/control/setSwitchState').at(-1).body, {
    deviceId: IDS.plug,
    channelIndex: 1,
    on: false,
  });
  assert.equal(world.fake.lastState(featureId(world.gladys, IDS.plug, '1-switch')), 0);

  // A dimmer comes back on at its last level.
  await ok('1-brightness', 40, IDS.dimmer);
  await ok('1-light', 0, IDS.dimmer);
  await ok('1-light', 1, IDS.dimmer);
  const levels = world.cloud
    .callsTo('device/control/setDimLevel')
    .map((call) => call.body.dimLevel);
  assert.deepEqual(levels, [0.4, 0, 0.4]);
  assert.equal(world.fake.lastState(featureId(world.gladys, IDS.dimmer, '1-brightness')), 40);

  await ok('1-position', 25, IDS.shutter);
  assert.equal(world.cloud.channel(IDS.shutter, 1).shutterLevel, 0.75);
  await ok('1-movement', 0, IDS.shutter);
  assert.equal(world.cloud.callsTo('device/control/stop').length, 1);

  const room = async (key, value) => {
    const ack = await setValue(world, roomFeatureId(world.gladys, ROOM, key), value);
    assert.equal(ack.success, true, ack.error);
    await settle(world);
  };
  await room('target-temperature', 20.7);
  assert.equal(world.cloud.group(ROOM).setPointTemperature, 20.5);
  await room('mode', 'MANUAL');
  assert.equal(world.fake.lastState(roomFeatureId(world.gladys, ROOM, 'mode')), 'MANUAL');
  await room('boost', 1);
  assert.equal(world.fake.lastState(roomFeatureId(world.gladys, ROOM, 'boost')), 1);

  const absence = await setValue(world, homeFeatureId(world.gladys, 'absence'), 1);
  assert.equal(absence.success, true, absence.error);
  await settle(world);
  assert.equal(world.fake.lastState(homeFeatureId(world.gladys, 'absence')), 1);
  await setValue(world, homeFeatureId(world.gladys, 'absence'), 0);
  await settle(world);
  assert.equal(world.fake.lastState(homeFeatureId(world.gladys, 'absence')), 0);
});

test('a refused command says why; a read-only feature cannot be set', async (t) => {
  const world = await createdWorld(t);
  world.cloud.failWith = 500;
  const refused = await setValue(world, featureId(world.gladys, IDS.plug, '1-switch'), 1);
  assert.equal(refused.success, false);
  assert.match(refused.error, /did not take the command \(FAKE_FAILURE\)/);
  world.cloud.failWith = null;
  const readOnly = await setValue(world, featureId(world.gladys, IDS.plug, '1-power'), 1);
  assert.equal(readOnly.success, false);
  assert.match(readOnly.error, /can only be read/);
  const unknown = await setValue(
    world,
    featureId(world.gladys, '3014F7110000000000000999', '1-switch'),
    1,
  );
  assert.match(unknown.error, /not in the Homematic IP home/);
});

// --- Key presses ----------------------------------------------------------------------

test('key presses become button states, each press sent even when the same', async (t) => {
  const world = await createdWorld(t);
  const button = featureId(world.gladys, IDS.remote, '2-button');
  const presses = () =>
    world.fake.states.filter((state) => state.device_feature_external_id === button);
  world.cloud.pressKey(IDS.remote, 2, 'KEY_PRESS_SHORT');
  world.cloud.pressKey(IDS.remote, 2, 'KEY_PRESS_SHORT');
  world.cloud.pressKey(IDS.remote, 2, 'KEY_PRESS_LONG_START');
  world.cloud.pressKey(IDS.remote, 2, 'KEY_PRESS_LONG');
  world.cloud.pressKey(IDS.remote, 2, 'KEY_PRESS_LONG');
  world.cloud.pressKey(IDS.remote, 2, 'KEY_PRESS_LONG_STOP');
  await settle(world);
  assert.deepEqual(
    presses().map((state) => state.state),
    [1, 1, 3, 4],
  );
  // A button of a remote not added to Gladys: nothing.
  await world.fake.deviceDeleted({ external_id: deviceId(world.gladys, IDS.wallButton) });
  world.cloud.pressKey(IDS.wallButton, 1);
  await settle(world);
  const wallButton = featureId(world.gladys, IDS.wallButton, '1-button');
  assert.ok(!world.fake.states.some((state) => state.device_feature_external_id === wallButton));
});

// --- Alarm -------------------------------------------------------------------------------

const triggerAlarm = (
  cloud,
  { cause = 'SENSOR_EVENT', device = IDS.contact, at = 1760000000000 } = {},
) =>
  cloud.changeHome((home) => {
    Object.assign(home.functionalHomes.SECURITY_AND_ALARM, {
      alarmActive: true,
      alarmSecurityJournalEntryType: cause,
      alarmEventDeviceChannel: { deviceId: device, channelIndex: 1 },
      alarmEventTimestamp: at,
    });
  });

test('the alarm going off fires the trigger once, with its sensor and cause', async (t) => {
  const world = await createdWorld(t);
  triggerAlarm(world.cloud);
  await settle(world);
  assert.deepEqual(world.fake.sceneEvents, [
    {
      key: 'alarm_triggered',
      data: { cause: 'intrusion', device: deviceId(world.gladys, IDS.contact), sensor: 'Fenster' },
    },
  ]);
  assert.equal(world.fake.lastState(homeFeatureId(world.gladys, 'alarm')), 1);
  // The same alarm again (a home change while ringing): no new event.
  world.cloud.changeHome((home) => {
    home.dutyCycle = 9;
  });
  await settle(world);
  assert.equal(world.fake.sceneEvents.length, 1);
  // A new alarm (another timestamp) while still active: a new event.
  triggerAlarm(world.cloud, { cause: 'SMOKE_ALARM', device: IDS.smoke, at: 1760000999000 });
  await settle(world);
  assert.equal(world.fake.sceneEvents.length, 2);
  assert.equal(world.fake.sceneEvents[1].data.cause, 'smoke');
});

test('an alarm already ringing at start is not fired', async (t) => {
  const cloud = new FakeCloud();
  cloud.state.home.functionalHomes.SECURITY_AND_ALARM.alarmActive = true;
  const world = await createdWorld(t, { cloud });
  await world.hub.refresh();
  assert.deepEqual(world.fake.sceneEvents, []);
  assert.equal(world.fake.lastState(homeFeatureId(world.gladys, 'alarm')), 1);
});

test('the alarm mode follows the configuration: read only by default', async (t) => {
  const world = await createdWorld(t);
  const mode = homeFeatureId(world.gladys, 'alarm-mode');
  assert.equal(world.fake.lastState(mode), 'disarmed');
  const off = await setValue(world, mode, 'full');
  assert.equal(off.success, false);
  assert.match(off.error, /disabled in the configuration/);
  assert.equal(world.cloud.callsTo('home/security/setZonesActivation').length, 0);

  await world.fake.configUpdated({
    access_point: ACCESS_POINT,
    language: 'en',
    alarm_control: 'arm',
  });
  const armed = await setValue(world, mode, 'full');
  assert.equal(armed.success, true, armed.error);
  await settle(world);
  assert.equal(world.fake.lastState(mode), 'full');
  const disarm = await setValue(world, mode, 'disarmed');
  assert.equal(disarm.success, false);
  assert.match(disarm.error, /Disarming the alarm from Gladys is disabled/);

  await world.fake.configUpdated({
    access_point: ACCESS_POINT,
    language: 'en',
    alarm_control: 'arm_disarm',
  });
  assert.equal((await setValue(world, mode, 'disarmed')).success, true);
  await settle(world);
  assert.equal(world.fake.lastState(mode), 'disarmed');
  assert.deepEqual(
    world.cloud
      .callsTo('home/security/setZonesActivation')
      .map((call) => call.body.zonesActivation),
    [
      { EXTERNAL: true, INTERNAL: true },
      { EXTERNAL: false, INTERNAL: false },
    ],
  );
  assert.ok(ALARM_MODES.includes(world.hub.alarmMode()));
});

test('an alarm kept from arming by an open window says which', async (t) => {
  const world = await createdWorld(t, {
    config: { access_point: ACCESS_POINT, language: 'en', alarm_control: 'arm' },
  });
  world.cloud.blockingSensors = [IDS.contact, IDS.handle];
  const ack = await setValue(world, homeFeatureId(world.gladys, 'alarm-mode'), 'perimeter');
  assert.equal(ack.success, false);
  assert.equal(ack.error, 'The alarm did not arm: Fenster, Fenstergriffsensor.');
});

// --- Reachability --------------------------------------------------------------------------

test('badges: an unreachable device, the access point offline, the cloud down and back', async (t) => {
  const world = await createdWorld(t);
  const plug = deviceId(world.gladys, IDS.plug);
  const last = (id) =>
    world.fake.transports.filter((entry) => entry.device_external_id === id).at(-1);
  assert.equal(last(plug).transport, 'cloud');

  world.cloud.changeDevice(IDS.plug, 0, { unreach: true });
  await settle(world);
  assert.equal(last(plug).transport, 'unreachable');
  world.cloud.changeDevice(IDS.plug, 0, { unreach: false });
  await settle(world);
  assert.equal(last(plug).transport, 'cloud');

  world.cloud.changeHome((home) => {
    home.connected = false;
  });
  await settle(world);
  assert.equal(last(plug).degraded, true);
  assert.deepEqual(world.fake.connectionStatus.message, CONNECTION_TEXT.accessPointOffline);
  world.cloud.changeHome((home) => {
    home.connected = true;
  });
  await settle(world);
  assert.equal(last(plug).degraded, undefined);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });

  world.cloud.offline = true;
  assert.equal(await world.hub.refresh(), false);
  assert.equal(last(plug).transport, 'unreachable');
  assert.deepEqual(world.fake.connectionStatus.message, CONNECTION_TEXT.unreachable);
  world.cloud.offline = false;
  assert.equal(await world.hub.refresh(), true);
  assert.equal(last(plug).transport, 'cloud');
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('a token removed in the app: the status says to pair again, the stream stops', async (t) => {
  const world = await createdWorld(t);
  world.cloud.tokens.clear();
  assert.equal(await world.hub.refresh(), false);
  assert.deepEqual(world.fake.connectionStatus.message, CONNECTION_TEXT.revoked);
  assert.equal(world.hub.stream, null);
  const ack = await world.fake.action('refresh', {});
  assert.equal(ack.success, false);
});

test('the stream coming back reads what happened meanwhile', async (t) => {
  const world = await createdWorld(t, { timings: { recentReadMs: 0 } });
  const reads = world.cloud.callsTo('home/getCurrentState').length;
  world.cloud.channel(IDS.plug, 1).on = false;
  world.cloud.dropStreams();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await settle(world);
  assert.equal(world.hub.stream.connected, true);
  assert.ok(world.cloud.callsTo('home/getCurrentState').length > reads);
  assert.equal(world.fake.lastState(featureId(world.gladys, IDS.plug, '1-switch')), 0);
});

test('the "Read the home again" button reports what it found; scan publishes the list', async (t) => {
  const world = await createdWorld(t);
  const ack = await world.fake.action('refresh', {});
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.message.en, /^Read again: \d+ device\(s\), 8 room\(s\)\.$/);
  const published = world.fake.requests.filter(
    (request) => request.path === '/discovered_device',
  ).length;
  await world.fake.scanRequest();
  assert.equal(
    world.fake.requests.filter((request) => request.path === '/discovered_device').length,
    published + 1,
  );
});

test('pairing again while connected leaves the running session alone', async (t) => {
  const world = await createdWorld(t);
  const started = await world.fake.action('start_pairing', {});
  assert.equal(started.success, true, started.error);
  // The home is still read with the current token while the user walks to the access point.
  assert.equal(await world.hub.refresh(), true);
  assert.equal(world.hub.revoked, false);
  world.cloud.pressBlueButton();
  const paired = await world.fake.action('confirm_pairing', {});
  assert.equal(paired.success, true, paired.error);
  assert.equal(
    world.cloud.callsTo('home/getCurrentState').at(-1).headers.AUTHTOKEN,
    world.cloud.issuedToken,
  );
});

test('a command before the first read says the cloud did not answer', async (t) => {
  const cloud = new FakeCloud();
  cloud.offline = true;
  const world = await createWorld({ cloud });
  t.after(() => world.app.stop());
  const ack = await setValue(world, featureId(world.gladys, IDS.plug, '1-switch'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /did not take the command/);
});
