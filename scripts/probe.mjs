#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Homematic IP cloud, with the client of the integration,
// from a machine that has the network. Read only: it changes nothing on the
// devices, the rooms or the alarm. It prints counts and types, never a token,
// a PIN, a label or an id.
//
//   1. Pair once (creates a client called "Gladys probe" in the app, remove it
//      afterwards); the token goes to a file readable by you only:
//        HMIP_ACCESS_POINT=3014-F711-... [HMIP_PIN=1234] \
//          node scripts/probe.mjs pair ./probe-token.json
//      then press the blue button of the access point when asked.
//
//   2. Read the home, follow the event stream for a minute:
//        node scripts/probe.mjs read ./probe-token.json [seconds]
//
// What it reports: the device and channel types the cloud sends, how many
// Gladys devices and features the integration builds from them, the channel
// types it does not map, the event types seen on the stream.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { parseAccessPointId } from '../src/config.js';
import { describeAll, featureValue } from '../src/devices.js';
import { HmipCloud } from '../src/hmip/cloud.js';
import { EventStream } from '../src/hmip/events.js';
import {
  alarmMode,
  applyMessage,
  channelsOf,
  heatingGroups,
  parseState,
} from '../src/hmip/model.js';

const [command, file = './probe-token.json', seconds = '60'] = process.argv.slice(2);
const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const table = (map) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `  ${String(value).padStart(4)}  ${key}`)
    .join('\n');

async function pair() {
  const accessPoint = parseAccessPointId(process.env.HMIP_ACCESS_POINT ?? '');
  if (!accessPoint) {
    throw new Error('Set HMIP_ACCESS_POINT to the SGTIN printed under the access point');
  }
  const cloud = new HmipCloud();
  const hosts = await cloud.lookup(accessPoint);
  cloud.session = { accessPoint, ...hosts };
  const deviceId = randomUUID();
  await cloud.connectionRequest({ accessPoint, deviceId, pin: process.env.HMIP_PIN || null });
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  await prompt.question('Press the blue button of the access point, then Enter here... ');
  prompt.close();
  if (!(await cloud.isRequestAcknowledged({ accessPoint, deviceId }))) {
    throw new Error('Not acknowledged: press the blue button, then run "pair" again');
  }
  const authToken = await cloud.requestAuthToken({ accessPoint, deviceId });
  await cloud.confirmAuthToken({ accessPoint, deviceId, authToken });
  await writeFile(file, JSON.stringify({ accessPoint, authToken }), { mode: 0o600 });
  console.log(`Paired. Token written to ${file} (mode 600). Remove the client in the app later.`);
}

async function read() {
  const { accessPoint, authToken } = JSON.parse(await readFile(file, 'utf8'));
  const cloud = new HmipCloud();
  const started = Date.now();
  await cloud.open(accessPoint, authToken);
  const json = await cloud.getCurrentState();
  const snapshot = parseState(json);
  console.log(`Full read: ${Date.now() - started} ms, ${JSON.stringify(json).length} bytes`);

  const deviceTypes = new Map();
  const channelTypes = new Map();
  for (const device of snapshot.devices.values()) {
    count(deviceTypes, `${device.type} (${device.modelType})`);
    for (const channel of channelsOf(device)) {
      count(
        channelTypes,
        `${channel.functionalChannelType}${channel.multiModeInputMode ? ` [${channel.multiModeInputMode}]` : ''}`,
      );
    }
  }
  const groupTypes = new Map();
  for (const group of snapshot.groups.values()) {
    count(groupTypes, group.type);
  }
  console.log(`\nDevices (${snapshot.devices.size}):\n${table(deviceTypes)}`);
  console.log(`\nChannels:\n${table(channelTypes)}`);
  console.log(`\nGroups:\n${table(groupTypes)}`);
  console.log(`\nFunctional homes: ${Object.keys(snapshot.home.functionalHomes ?? {}).join(', ')}`);
  console.log(
    `Access point connected: ${snapshot.home.connected}, alarm mode: ${alarmMode(snapshot)}`,
  );
  console.log(`Heating rooms: ${heatingGroups(snapshot).length}`);

  const descriptions = describeAll(snapshot, 'en');
  const features = new Map();
  let missing = 0;
  for (const description of descriptions) {
    for (const feature of description.features) {
      count(features, `${feature.category}/${feature.type}`);
      if (!feature.event && feature.read && featureValue(feature, snapshot) === undefined) {
        missing += 1;
      }
    }
  }
  const mapped = new Set(descriptions.map((description) => description.sourceId));
  const unmapped = new Map();
  for (const device of snapshot.devices.values()) {
    if (!mapped.has(device.id)) {
      count(unmapped, `${device.type} (${device.modelType})`);
    }
  }
  console.log(`\nGladys devices: ${descriptions.length}, features without a value now: ${missing}`);
  console.log(`Features:\n${table(features)}`);
  console.log(`\nDevices not shown in Gladys:\n${table(unmapped) || '  none'}`);

  const events = new Map();
  const stream = new EventStream({
    target: async () => ({ url: cloud.session.websocket, headers: cloud.headers() }),
  });
  stream.on('open', () => console.log('\nEvent stream open'));
  stream.on('retry', ({ reason }) => console.log(`Event stream: ${reason}`));
  stream.on('message', (message) => {
    for (const event of Object.values(message?.events ?? {})) {
      count(
        events,
        `${event.pushEventType}${event.channelEventType ? ` ${event.channelEventType}` : ''}`,
      );
    }
    applyMessage(snapshot, message);
  });
  stream.start();
  await new Promise((resolve) => setTimeout(resolve, Number(seconds) * 1000));
  stream.stop();
  console.log(`Events in ${seconds} s:\n${table(events) || '  none'}`);
}

try {
  if (command === 'pair') {
    await pair();
  } else if (command === 'read') {
    await read();
  } else {
    console.log('Usage: node scripts/probe.mjs pair|read [token file] [seconds]');
    process.exitCode = 2;
  }
} catch (err) {
  // A CloudError says the path and the status, never a header.
  console.error(`Probe failed: ${err.message}`);
  process.exitCode = 1;
}
