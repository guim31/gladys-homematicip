// -----------------------------------------------------------------------------
// What the container writes at the default level (info): the life of the
// cloud connection, of the access point and of Gladys, one line per user
// action, never one line per read, event or state; a repeated failure once,
// and its end once; never a token, a PIN or the client key.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { clientAuthToken } from '../src/hmip/cloud.js';
import {
  ACCESS_POINT,
  AUTH_TOKEN,
  FakeCloud,
  IDS,
  ROOM,
  createAll,
  createWorld,
  featureId,
  settle,
} from './helpers/world.js';

/** Everything written on stdout and stderr while `fn` runs, at `level`. */
async function capture(t, fn, level = 'info') {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = previous;
  }
  return lines;
}

async function createdWorld(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

test('logs: reads, stream events, key presses and widgets write nothing at the info level', async (t) => {
  const world = await createdWorld(t);
  const lines = await capture(t, async () => {
    for (let read = 0; read < 3; read += 1) {
      world.cloud.channel(IDS.plug, 1).currentPowerConsumption = 100 + read;
      await world.hub.refresh();
    }
    world.cloud.changeDevice(IDS.contact, 1, { windowState: 'OPEN' });
    world.cloud.changeGroup(ROOM, { setPointTemperature: 22 });
    world.cloud.pressKey(IDS.remote, 1);
    world.cloud.pressKey(IDS.remote, 1, 'KEY_PRESS_LONG');
    world.cloud.push({ pushEventType: 'SECURITY_JOURNAL_CHANGED' });
    await settle(world);
    await world.fake.widgetGet('heating', { settings: {}, language: 'en' });
    await world.fake.setValue(
      {},
      { external_id: featureId(world.gladys, IDS.plug, '1-switch') },
      0,
    );
    await settle(world);
  });
  assert.equal(world.fake.lastState(featureId(world.gladys, IDS.plug, '1-power')), 102);
  assert.deepEqual(lines, []);
});

test('logs: the cloud failing at every read is said once, and its return once', async (t) => {
  const world = await createdWorld(t);
  world.cloud.failWith = 503;
  const failing = await capture(t, async () => {
    for (let read = 0; read < 4; read += 1) {
      await world.hub.refresh();
    }
  });
  assert.equal(failing.length, 1, failing.join('\n'));
  assert.match(failing[0], /\[WARN\].*Homematic IP cloud unreachable: .*HTTP 503 FAKE_FAILURE/);

  world.cloud.failWith = null;
  const back = await capture(t, async () => {
    await world.hub.refresh();
    await world.hub.refresh();
  });
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /\[INFO\].*The Homematic IP cloud answers again/);
});

test('logs: Gladys refusing the states is said once, and its return once', async (t) => {
  const world = await createdWorld(t);
  const refusal = t.mock.method(world.gladys, 'publishChangedStates', async () => {
    throw new GladysApiError(503, 'SERVICE_UNAVAILABLE', 'Gladys is restarting');
  });
  const failing = await capture(t, async () => {
    for (const value of [20, 21, 22]) {
      world.cloud.changeGroup(ROOM, { setPointTemperature: value });
      await settle(world);
    }
  });
  assert.equal(failing.length, 1, failing.join('\n'));
  assert.match(
    failing[0],
    /\[WARN\].*Gladys does not take the Homematic IP updates: Gladys is restarting/,
  );
  refusal.mock.restore();
  const back = await capture(t, async () => {
    world.cloud.changeGroup(ROOM, { setPointTemperature: 23 });
    await settle(world);
  });
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /\[INFO\].*Gladys takes the Homematic IP updates again/);
});

test('logs: the stream lost is said once, its return once; the access point too', async (t) => {
  const world = await createdWorld(t);
  const lines = await capture(t, async () => {
    world.cloud.offline = true;
    world.cloud.dropStreams();
    await new Promise((resolve) => setTimeout(resolve, 60));
    world.cloud.offline = false;
    await new Promise((resolve) => setTimeout(resolve, 60));
    await settle(world);
    world.cloud.changeHome((home) => {
      home.connected = false;
    });
    await settle(world);
    world.cloud.changeHome((home) => {
      home.connected = false;
      home.dutyCycle = 3;
    });
    await settle(world);
    world.cloud.changeHome((home) => {
      home.connected = true;
    });
    await settle(world);
  });
  assert.equal(world.hub.stream.connected, true);
  assert.equal(lines.length, 4, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*event stream unavailable/);
  assert.match(lines[1], /\[INFO\].*event stream connected again/);
  assert.match(lines[2], /\[INFO\].*access point is offline/);
  assert.match(lines[3], /\[INFO\].*access point is online again/);
});

test('logs: one line per user action, and the alarm going off', async (t) => {
  const world = await createdWorld(t, {
    config: { access_point: ACCESS_POINT, language: 'en', alarm_control: 'arm' },
  });
  const lines = await capture(t, async () => {
    await world.fake.action('refresh', {});
    await world.fake.sceneAction('set_alarm_mode', { mode: 'full' });
    await settle(world);
    world.cloud.changeHome((home) => {
      home.functionalHomes.SECURITY_AND_ALARM.alarmActive = true;
      home.functionalHomes.SECURITY_AND_ALARM.alarmEventTimestamp = 1760000000000;
    });
    await settle(world);
  });
  assert.equal(lines.length, 3, lines.join('\n'));
  assert.match(lines[0], /Full read requested/);
  assert.match(lines[1], /Alarm mode "full" requested from Gladys/);
  assert.match(lines[2], /Alarm triggered \(intrusion, 3014F7110000000000000007\)/);
});

test('logs: no token, PIN or client key ever, even at the debug level and in the acks', async (t) => {
  const cloud = new FakeCloud({ tokens: [], pin: '8642' });
  const world = await createWorld({
    cloud,
    paired: false,
    config: { access_point: ACCESS_POINT, pin: '8642', language: 'en', alarm_control: 'arm' },
  });
  t.after(() => world.app.stop());
  const acks = [];
  const lines = await capture(
    t,
    async () => {
      acks.push(await world.fake.action('start_pairing', {}));
      acks.push(await world.fake.action('confirm_pairing', {}));
      cloud.pressBlueButton();
      acks.push(await world.fake.action('confirm_pairing', {}));
      await createAll(world);
      const feature = (key) => ({ external_id: featureId(world.gladys, IDS.plug, key) });
      acks.push(await world.fake.setValue({}, feature('1-switch'), 0));
      cloud.failWith = 500;
      acks.push(await world.fake.setValue({}, feature('1-switch'), 1));
      await world.hub.refresh();
      cloud.failWith = null;
      cloud.dropStreams();
      cloud.pressKey(IDS.remote, 1);
      await settle(world);
      cloud.tokens.clear();
      await world.hub.refresh();
      acks.push(await world.fake.setValue({}, feature('1-switch'), 1));
      acks.push(await world.fake.action('refresh', {}));
      await settle(world);
    },
    'debug',
  );
  assert.ok(lines.length >= 8, 'the debug level writes the details');
  const secrets = [AUTH_TOKEN, cloud.issuedToken, '8642', clientAuthToken(ACCESS_POINT)];
  const leaks = [...lines, ...acks.map((ack) => JSON.stringify(ack))].filter((line) =>
    secrets.some((secret) => line.includes(secret)),
  );
  assert.deepEqual(leaks, []);
  assert.ok(acks.some((ack) => ack.success === false));
});
