// -----------------------------------------------------------------------------
// The cloud client: headers, lookup, pairing calls, error kinds, call bucket.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CloudError,
  HmipCloud,
  LOOKUP_URL,
  TokenBucket,
  clientAuthToken,
  clientCharacteristics,
} from '../src/hmip/cloud.js';
import { ACCESS_POINT, AUTH_TOKEN, FakeCloud, REST_URL, WS_URL } from './helpers/fakeCloud.js';
import { NO_BUCKET } from './helpers/world.js';

test('CLIENTAUTH is the upper-case SHA-512 of the SGTIN and the protocol salt', () => {
  const token = clientAuthToken(ACCESS_POINT);
  assert.match(token, /^[0-9A-F]{128}$/);
  assert.equal(token, clientAuthToken(ACCESS_POINT));
  assert.notEqual(token, clientAuthToken('3014F711A000000BAD0CAAAB'));
});

test('the lookup gives the REST and WebSocket hosts of the access point', async () => {
  const cloud = new FakeCloud();
  const client = new HmipCloud({ fetch: cloud.fetch, timings: NO_BUCKET });
  const session = await client.open(ACCESS_POINT, AUTH_TOKEN);
  assert.deepEqual(session, {
    accessPoint: ACCESS_POINT,
    authToken: AUTH_TOKEN,
    rest: REST_URL,
    websocket: WS_URL,
  });
  const [lookup] = cloud.calls;
  assert.equal(lookup.path, 'lookup');
  assert.deepEqual(lookup.body, clientCharacteristics(ACCESS_POINT));
  // The lookup carries no token.
  assert.equal(lookup.headers.AUTHTOKEN, undefined);
});

test('a lookup without usable hosts is refused', async () => {
  const client = new HmipCloud({
    fetch: async (url) => {
      assert.equal(url, LOOKUP_URL);
      return new Response(JSON.stringify({ urlREST: 'http://plain.example' }), { status: 200 });
    },
  });
  await assert.rejects(client.lookup(ACCESS_POINT), { name: 'CloudError', kind: 'invalid' });
});

test('every call carries the version, the SGTIN, CLIENTAUTH and the token', async () => {
  const cloud = new FakeCloud();
  const client = new HmipCloud({ fetch: cloud.fetch, timings: NO_BUCKET });
  await client.open(ACCESS_POINT, AUTH_TOKEN);
  const state = await client.getCurrentState();
  assert.ok(state.devices && state.home);
  const call = cloud.callsTo('home/getCurrentState')[0];
  assert.equal(call.headers.VERSION, '12');
  assert.equal(call.headers['ACCESSPOINT-ID'], ACCESS_POINT);
  assert.equal(call.headers.CLIENTAUTH, clientAuthToken(ACCESS_POINT));
  assert.equal(call.headers.AUTHTOKEN, AUTH_TOKEN);
  assert.equal(call.body.id, ACCESS_POINT);
});

test('the pairing: request (with the PIN), button, token, confirmation', async () => {
  const cloud = new FakeCloud({ pin: '1234' });
  const client = new HmipCloud({ fetch: cloud.fetch, timings: NO_BUCKET });
  const hosts = await client.lookup(ACCESS_POINT);
  client.session = { accessPoint: ACCESS_POINT, ...hosts };
  const pairing = { accessPoint: ACCESS_POINT, deviceId: 'device-1' };

  await assert.rejects(client.connectionRequest({ ...pairing, pin: '0000' }), {
    kind: 'auth',
    errorCode: 'INVALID_PIN',
  });
  await client.connectionRequest({ ...pairing, pin: '1234' });
  const request = cloud.callsTo('auth/connectionRequest').at(-1);
  assert.equal(request.headers.PIN, '1234');
  assert.equal(request.headers.AUTHTOKEN, undefined);
  assert.deepEqual(request.body, {
    deviceId: 'device-1',
    deviceName: 'Gladys',
    sgtin: ACCESS_POINT,
  });

  assert.equal(await client.isRequestAcknowledged(pairing), false);
  cloud.pressBlueButton();
  assert.equal(await client.isRequestAcknowledged(pairing), true);
  const token = await client.requestAuthToken(pairing);
  assert.equal(token, cloud.issuedToken);
  assert.equal(await client.confirmAuthToken({ ...pairing, authToken: token }), 'client-0001');
  assert.ok(cloud.tokens.has(token));
});

test('errors are sorted by kind, with the status and the error code, never a header', async () => {
  const cloud = new FakeCloud();
  const client = new HmipCloud({ fetch: cloud.fetch, timings: NO_BUCKET });
  await client.open(ACCESS_POINT, 'WrongToken');
  const refused = await client.getCurrentState().catch((err) => err);
  assert.ok(refused instanceof CloudError);
  assert.equal(refused.kind, 'auth');
  assert.equal(refused.status, 403);
  assert.equal(refused.errorCode, 'INVALID_AUTH_TOKEN');
  assert.ok(!refused.message.includes('WrongToken'));

  client.session.authToken = AUTH_TOKEN;
  cloud.failWith = 429;
  assert.equal((await client.getCurrentState().catch((err) => err)).kind, 'throttled');
  cloud.failWith = 502;
  assert.equal((await client.getCurrentState().catch((err) => err)).kind, 'http');
  cloud.failWith = null;
  cloud.offline = true;
  const offline = await client.getCurrentState().catch((err) => err);
  assert.equal(offline.kind, 'network');
  assert.match(offline.message, /ECONNREFUSED/);

  const slow = new HmipCloud({
    fetch: (url, init) =>
      new Promise((resolve, reject) => {
        // AbortSignal.timeout does not keep the process alive: this does.
        const alive = setTimeout(() => {}, 5000);
        init.signal.addEventListener('abort', () => {
          clearTimeout(alive);
          reject(init.signal.reason);
        });
      }),
    timings: { ...NO_BUCKET, requestTimeoutMs: 20 },
  });
  slow.session = { accessPoint: ACCESS_POINT, rest: REST_URL, websocket: WS_URL };
  assert.equal((await slow.post('home/getCurrentState', {}).catch((err) => err)).kind, 'timeout');
});

test('the bucket: ten calls at once, then one every 8 seconds; a command does not wait long', async () => {
  let clock = 0;
  const waits = [];
  const bucket = new TokenBucket({
    size: 10,
    refillMs: 8000,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  for (let call = 0; call < 10; call += 1) {
    assert.equal(await bucket.take(0), true);
  }
  assert.equal(await bucket.take(4000), false, 'a command gives up past its wait');
  assert.deepEqual(waits, []);
  assert.equal(await bucket.take(60_000), true, 'a read waits for the next token');
  assert.deepEqual(waits, [8000]);
  clock += 80_000;
  for (let call = 0; call < 10; call += 1) {
    assert.equal(await bucket.take(0), true, 'refilled after a pause');
  }
  assert.equal(await bucket.take(0), false, 'never more than ten');
});

test('a call refused by the bucket is a "busy" error, before reaching the cloud', async () => {
  const cloud = new FakeCloud();
  const client = new HmipCloud({
    fetch: cloud.fetch,
    timings: { bucketSize: 1, refillMs: 60_000, commandWaitMs: 0 },
  });
  await client.open(ACCESS_POINT, AUTH_TOKEN);
  await client.send({ path: 'device/control/stop', body: { deviceId: 'x', channelIndex: 1 } });
  const calls = cloud.calls.length;
  await assert.rejects(client.send({ path: 'device/control/stop', body: {} }), { kind: 'busy' });
  assert.equal(cloud.calls.length, calls);
});
