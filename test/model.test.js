// -----------------------------------------------------------------------------
// The home model and the Gladys conventions of the values: stream messages,
// the alarm, the eco mode, and the meaning of each published number.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeAll, featureValue, COVER, KEY_PRESSES } from '../src/devices.js';
import {
  activationProblems,
  alarmCommand,
  alarmMode,
  alarmState,
  applyMessage,
  formatEndTime,
  isAbsent,
  parseState,
  HOME_COMMANDS,
} from '../src/hmip/model.js';
import { fixtureState } from './helpers/fakeCloud.js';
import { IDS, ROOM } from './helpers/world.js';

const snapshotOf = (mutate = () => {}) => {
  const state = fixtureState();
  mutate(state);
  return parseState(state);
};

/** The value of one feature of one device, as published. */
function valueOf(snapshot, sourceId, key, language = 'en') {
  const description = describeAll(snapshot, language).find((entry) => entry.sourceId === sourceId);
  const feature = description?.features.find((entry) => entry.key === key);
  assert.ok(feature, `${sourceId} has no feature ${key}`);
  return featureValue(feature, snapshot);
}

test('opening sensors follow Gladys: 0 = open, 1 = closed (tilted is open)', () => {
  const snapshot = snapshotOf((state) => {
    state.devices[IDS.contact].functionalChannels['1'].windowState = 'OPEN';
  });
  assert.equal(valueOf(snapshot, IDS.contact, '1-opening'), 0, 'open window → 0');
  snapshot.devices.get(IDS.contact).functionalChannels['1'].windowState = 'CLOSED';
  assert.equal(valueOf(snapshot, IDS.contact, '1-opening'), 1, 'closed window → 1');
  assert.equal(snapshot.devices.get(IDS.handle).functionalChannels['1'].windowState, 'TILTED');
  assert.equal(valueOf(snapshot, IDS.handle, '1-opening'), 0, 'tilted handle → open');
  // The room shows its window the same way.
  assert.equal(snapshot.groups.get(ROOM).windowState, 'OPEN');
  assert.equal(valueOf(snapshot, ROOM, 'window'), 0);
});

test('covers: Homematic IP level 0 is open, Gladys position 100 is open', () => {
  const snapshot = snapshotOf((state) => {
    state.devices[IDS.shutter].functionalChannels['1'].shutterLevel = 0;
  });
  assert.equal(valueOf(snapshot, IDS.shutter, '1-position'), 100);
  snapshot.devices.get(IDS.shutter).functionalChannels['1'].shutterLevel = 1;
  assert.equal(valueOf(snapshot, IDS.shutter, '1-position'), 0);
  snapshot.devices.get(IDS.shutter).functionalChannels['1'].shutterLevel = 0.25;
  assert.equal(valueOf(snapshot, IDS.shutter, '1-position'), 75);

  const description = describeAll(snapshot, 'en').find((entry) => entry.sourceId === IDS.shutter);
  const position = description.features.find((entry) => entry.key === '1-position');
  const movement = description.features.find((entry) => entry.key === '1-movement');
  assert.deepEqual(position.command(30).body.shutterLevel, 0.7);
  assert.equal(movement.command(COVER.OPEN).body.shutterLevel, 0);
  assert.equal(movement.command(COVER.CLOSE).body.shutterLevel, 1);
  assert.equal(movement.command(COVER.STOP).path, 'device/control/stop');
  // The sun-shading module drives its primary level.
  const shading = describeAll(snapshot, 'en').find((entry) => entry.sourceId === IDS.shading);
  const command = shading.features.find((entry) => entry.key === '1-position').command(100);
  assert.deepEqual(command, {
    path: 'device/control/setPrimaryShadingLevel',
    body: { deviceId: IDS.shading, channelIndex: 1, primaryShadingLevel: 0 },
  });
});

test('smoke is the alarm of this detector only, leaks and motions are 1 when detected', () => {
  const snapshot = snapshotOf();
  const smoke = snapshot.devices.get(IDS.smoke).functionalChannels['1'];
  assert.equal(valueOf(snapshot, IDS.smoke, '1-smoke'), 0);
  smoke.smokeDetectorAlarmType = 'PRIMARY_ALARM';
  assert.equal(valueOf(snapshot, IDS.smoke, '1-smoke'), 1);
  smoke.smokeDetectorAlarmType = 'SECONDARY_ALARM';
  assert.equal(valueOf(snapshot, IDS.smoke, '1-smoke'), 0, 'another detector rings');
  snapshot.devices.get(IDS.water).functionalChannels['1'].moistureDetected = true;
  assert.equal(valueOf(snapshot, IDS.water, '1-leak'), 1);
  assert.equal(valueOf(snapshot, IDS.motion, '1-motion'), 1);
});

test('thermostats: valve open is "heating", the room set point works by half degrees', () => {
  const snapshot = snapshotOf((state) => {
    state.devices[IDS.trv].functionalChannels['1'].valvePosition = 0.42;
  });
  assert.equal(valueOf(snapshot, IDS.trv, '1-heating'), 1);
  snapshot.devices.get(IDS.trv).functionalChannels['1'].valvePosition = 0;
  assert.equal(valueOf(snapshot, IDS.trv, '1-heating'), 0);
  const room = describeAll(snapshot, 'en').find((entry) => entry.sourceId === ROOM);
  const setPoint = room.features.find((entry) => entry.key === 'target-temperature');
  assert.deepEqual([setPoint.min, setPoint.max, setPoint.step], [5, 30, 0.5]);
  assert.deepEqual(setPoint.command(21.3), {
    path: 'group/heating/setSetPointTemperature',
    body: { groupId: ROOM, setPointTemperature: 21.5 },
  });
  assert.equal(setPoint.command(40).body.setPointTemperature, 30, 'clamped to the room maximum');
  const mode = room.features.find((entry) => entry.key === 'mode');
  assert.deepEqual(
    mode.supported_options.map((option) => option.value),
    ['AUTOMATIC', 'MANUAL', 'ECO'],
  );
  assert.deepEqual(valueOf(snapshot, ROOM, 'mode'), { text: 'AUTOMATIC' });
  assert.throws(() => mode.command('PARTY'), RangeError);
});

test('key presses: short, long press and release, the repeats are not sent', () => {
  assert.deepEqual(KEY_PRESSES, {
    KEY_PRESS_SHORT: 1,
    KEY_PRESS_LONG_START: 3,
    KEY_PRESS_LONG_STOP: 4,
  });
  assert.equal(KEY_PRESSES.KEY_PRESS_LONG, undefined);
});

test('stream messages update the snapshot and say what changed', () => {
  const snapshot = snapshotOf();
  const device = structuredClone(snapshot.devices.get(IDS.plug));
  device.functionalChannels['1'].on = false;
  const group = { ...snapshot.groups.get(ROOM), setPointTemperature: 21 };
  const result = applyMessage(snapshot, {
    events: {
      0: { pushEventType: 'DEVICE_CHANGED', device },
      1: { pushEventType: 'GROUP_CHANGED', group },
      2: {
        pushEventType: 'DEVICE_CHANNEL_EVENT',
        deviceId: IDS.remote,
        functionalChannelIndex: 2,
        channelEventType: 'KEY_PRESS_SHORT',
      },
      3: { pushEventType: 'SECURITY_JOURNAL_CHANGED' },
      4: 'garbage',
    },
  });
  assert.deepEqual([...result.devices], [IDS.plug]);
  assert.deepEqual([...result.groups], [ROOM]);
  assert.equal(result.structure, false);
  assert.deepEqual(result.channelEvents, [
    { deviceId: IDS.remote, channelIndex: 2, type: 'KEY_PRESS_SHORT' },
  ]);
  assert.equal(snapshot.devices.get(IDS.plug).functionalChannels['1'].on, false);
  assert.equal(snapshot.groups.get(ROOM).setPointTemperature, 21);

  const added = applyMessage(snapshot, {
    events: { 0: { pushEventType: 'DEVICE_REMOVED', id: IDS.plug } },
  });
  assert.equal(added.structure, true);
  assert.equal(snapshot.devices.has(IDS.plug), false);
  assert.deepEqual(applyMessage(snapshot, null).devices.size, 0);
});

test('the alarm: classic zones, request-based zones, causes, blocking sensors', () => {
  const snapshot = snapshotOf();
  const zone = (label) =>
    [...snapshot.groups.values()].find(
      (group) => group.type === 'SECURITY_ZONE' && group.label === label,
    );
  assert.equal(alarmMode(snapshot), 'disarmed');
  zone('EXTERNAL').active = true;
  assert.equal(alarmMode(snapshot), 'perimeter');
  zone('INTERNAL').active = true;
  assert.equal(alarmMode(snapshot), 'full');
  assert.deepEqual(alarmCommand(snapshot, 'perimeter'), {
    path: 'home/security/setZonesActivation',
    body: { zonesActivation: { EXTERNAL: true, INTERNAL: false } },
  });
  assert.deepEqual(alarmCommand(snapshot, 'disarmed').body.zonesActivation, {
    EXTERNAL: false,
    INTERNAL: false,
  });

  zone('INTERNAL').label = 'ABSENCE';
  zone('EXTERNAL').label = 'PRESENCE';
  zone('ABSENCE').active = false;
  assert.equal(alarmMode(snapshot), 'perimeter');
  assert.deepEqual(alarmCommand(snapshot, 'full'), {
    path: 'home/security/setExtendedZonesActivation',
    body: { zonesActivation: { PRESENCE: false, ABSENCE: true }, ignoreLowBat: true },
  });

  const security = snapshot.home.functionalHomes.SECURITY_AND_ALARM;
  security.alarmActive = true;
  security.alarmSecurityJournalEntryType = 'SMOKE_ALARM';
  assert.deepEqual(alarmState(snapshot), {
    active: true,
    timestamp: security.alarmEventTimestamp,
    cause: 'smoke',
    deviceId: security.alarmEventDeviceChannel.deviceId,
  });
  security.alarmSecurityJournalEntryType = 'SOMETHING_NEW';
  assert.equal(alarmState(snapshot).cause, 'other');

  assert.deepEqual(
    activationProblems(snapshot, {
      channelActivationProblems: { [`${IDS.contact}:1`]: ['WINDOW_OPEN'], 'UNKNOWN:1': [] },
    }),
    ['Fenster', 'UNKNOWN'],
  );
  assert.deepEqual(activationProblems(snapshot, {}), []);
  security.active = false;
  assert.equal(alarmMode(snapshot), null);
});

test('eco mode: absence and vacation, ended by their own call', () => {
  const snapshot = snapshotOf();
  const climate = snapshot.home.functionalHomes.INDOOR_CLIMATE;
  assert.equal(isAbsent(snapshot), false);
  climate.absenceType = 'PERMANENT';
  assert.equal(isAbsent(snapshot), true);
  assert.equal(HOME_COMMANDS.endAbsence(snapshot).path, 'home/heating/deactivateAbsence');
  climate.absenceType = 'VACATION';
  assert.equal(HOME_COMMANDS.endAbsence(snapshot).path, 'home/heating/deactivateVacation');
});

test('end times are written in the time zone of the home', () => {
  const date = new Date(Date.UTC(2026, 11, 31, 23, 30));
  assert.equal(formatEndTime(date, 'Europe/Berlin'), '2027_01_01 00:30');
  assert.equal(formatEndTime(date, 'UTC'), '2026_12_31 23:30');
  assert.match(formatEndTime(date, 'Not/AZone'), /^\d{4}_\d{2}_\d{2} \d{2}:\d{2}$/);
});
