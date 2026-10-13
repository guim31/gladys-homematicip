// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, the fake Homematic IP cloud
// (REST and event stream) and a temporary /data, with the integration wired
// on top through registerHandlers. No timer runs unless asked: the tests read
// the home with `world.hub.refresh()`.
// -----------------------------------------------------------------------------

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { ACCESS_POINT, AUTH_TOKEN, FakeCloud } from './fakeCloud.js';

// The integration logs its life; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

// Fast reconnections of the event stream.
export const FAST_STREAM = { retryMinMs: 5, retryMaxMs: 20 };
// No waiting on the call bucket, except in the test of the bucket.
export const NO_BUCKET = { bucketSize: 1_000_000 };

// Device ids of the recorded home (test/fixtures/hmip/current-state.json).
export const IDS = {
  plug: '3014F7110000000000000008', // HmIP-PSM "Pc", switch + power + energy
  contact: '3014F7110000000000000001', // HmIP-SWDO "Fenster"
  handle: '3014F711AAAA000000000004', // HmIP-SRH, tilted
  trv: '3014F7110000000000000011', // HmIP-eTRV "Heizung"
  wallThermostat: '3014F7110000000000000022', // HmIP-WTH-2
  smoke: '3014F7110000000000000018', // HmIP-SWSD
  water: '3014F7110000000000000050', // HmIP-SWD
  motion: '3014F711000000000000BB11', // HmIP-SMI
  dimmer: '3014F711AAAA000000000005', // HmIP-BDT
  shutter: '3014F711ACBCDABCADCA66', // HmIP-BROLL
  shading: '3014F71100BLIND_MODULE00', // HmIP-HDM1
  remote: '3014F711ABCDEF0000000014', // HmIP-KRC4, 4 keys
  wallButton: '3014F711BBBBBBBBBBBBB017', // HmIP-WRC6
  accessPoint: '3014F711A000000BAD0CAAAA', // HmIP-HAP: no Gladys device
  sirenIndoor: '3014F7110000000000BBBBB8', // HmIP-ASIR: no Gladys device (not mapped)
};
export const ROOM = '00000000-0000-0000-0000-000000000012'; // heating group "Schlafzimmer"

/** A /data directory where the access point is already paired. */
export function pairedDataDir(
  { accessPoint = ACCESS_POINT, authToken = AUTH_TOKEN } = {},
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-homematicip-')),
) {
  writeFileSync(
    join(dataDir, 'homematicip.json'),
    JSON.stringify({ accessPoint, authToken, clientId: 'client-0000', deviceId: 'device-0000' }),
  );
  return dataDir;
}

/**
 * @param {object} [options]
 * @param {FakeCloud} [options.cloud]
 * @param {boolean} [options.paired] whether /data already holds the token
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.created] devices already created in Gladys
 * @param {boolean} [options.timers] the hub's own timers (off: the tests refresh)
 */
export async function createWorld({
  cloud = new FakeCloud(),
  paired = true,
  config = { access_point: '3014-F711-A000-000B-AD0C-AAAA', language: 'en' },
  created = [],
  connect = true,
  dataDir,
  timings = {},
  timers = false,
  cloudTimings = NO_BUCKET,
  now,
  sleep,
} = {}) {
  const directory =
    dataDir ?? (paired ? pairedDataDir() : mkdtempSync(join(tmpdir(), 'gladys-homematicip-')));
  const gladys = createFakeGladys({ config, devices: created });
  const app = registerHandlers(gladys, {
    store: new Store(directory),
    fetch: cloud.fetch,
    WebSocket: cloud.WebSocket,
    timers,
    timings,
    cloudTimings,
    streamTimings: FAST_STREAM,
    now,
    sleep,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    await settle({ app, hub: app.hub });
  }
  return { gladys, fake: gladys.fake, cloud, app, hub: app.hub, dataDir: directory };
}

export const deviceId = (gladys, id) => gladys.externalIds('device', id.toLowerCase()).device;
export const featureId = (gladys, id, key) =>
  gladys.externalIds('device', id.toLowerCase()).feature(key);
export const roomId = (gladys, id) => gladys.externalIds('room', id.toLowerCase()).device;
export const roomFeatureId = (gladys, id, key) =>
  gladys.externalIds('room', id.toLowerCase()).feature(key);
export const homeFeatureId = (gladys, key) =>
  gladys.externalIds('home', '00000000-0000-0000-0000-000000000001').feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await settle(world);
}

/** Let the event stream deliver what was pushed, then wait for the hub. */
export async function settle(world) {
  for (let round = 0; round < 3; round += 1) {
    for (let tick = 0; tick < 5; tick += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await world.hub.idle();
  }
}

export { ACCESS_POINT, AUTH_TOKEN, FakeCloud };
