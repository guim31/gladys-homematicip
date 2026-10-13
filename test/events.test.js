// -----------------------------------------------------------------------------
// The event stream: headers, messages, reconnection with backoff, the host
// asked again before each attempt, and the silent connection closed.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventStream } from '../src/hmip/events.js';
import { AUTH_TOKEN, FakeCloud, WS_URL } from './helpers/fakeCloud.js';
import { clientAuthToken } from '../src/hmip/cloud.js';

const headers = (token = AUTH_TOKEN) => ({
  AUTHTOKEN: token,
  CLIENTAUTH: clientAuthToken('3014F711A000000BAD0CAAAA'),
  'ACCESSPOINT-ID': '3014F711A000000BAD0CAAAA',
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, ms = 1000) {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) {
      throw new Error('condition not met in time');
    }
    await wait(2);
  }
}

test('the stream opens with the headers and hands over the parsed messages', async () => {
  const cloud = new FakeCloud();
  const stream = new EventStream({
    WebSocket: cloud.WebSocket,
    target: async () => ({ url: WS_URL, headers: headers() }),
    timings: { retryMinMs: 5, retryMaxMs: 20 },
  });
  const messages = [];
  stream.on('message', (message) => messages.push(message));
  let invalid = 0;
  stream.on('invalid', () => {
    invalid += 1;
  });
  stream.start();
  await until(() => stream.connected);
  cloud.pressKey('3014F711ABCDEF0000000014', 1);
  [...cloud.sockets][0].receive('not json');
  await until(() => messages.length === 1 && invalid === 1);
  assert.equal(messages[0].events['0'].channelEventType, 'KEY_PRESS_SHORT');
  stream.stop();
  assert.equal(cloud.sockets.size, 0);
});

test('a refused or dropped stream retries with a growing delay, asking the host again', async () => {
  const cloud = new FakeCloud();
  let token = 'NotYetValid';
  let targets = 0;
  const stream = new EventStream({
    WebSocket: cloud.WebSocket,
    target: async () => {
      targets += 1;
      return { url: WS_URL, headers: headers(token) };
    },
    timings: { retryMinMs: 5, retryMaxMs: 40 },
  });
  const retries = [];
  stream.on('retry', (retry) => retries.push(retry));
  const events = [];
  stream.on('open', () => events.push('open'));
  stream.on('close', (reason) => events.push(`close ${reason}`));
  stream.start();
  await until(() => retries.length >= 3);
  assert.deepEqual(
    retries.slice(0, 3).map((retry) => retry.delay),
    [5, 10, 20],
  );
  assert.ok(targets >= 3);
  token = AUTH_TOKEN;
  await until(() => stream.connected);
  assert.equal(stream.failures, 0);
  cloud.dropStreams();
  await until(() => events.length >= 3 && stream.connected);
  assert.deepEqual(events.slice(0, 3), ['open', 'close closed (code 1006)', 'open']);
  stream.stop();
});

test('a connection silent for too long is closed and opened again', async () => {
  const cloud = new FakeCloud();
  const stream = new EventStream({
    WebSocket: cloud.WebSocket,
    target: async () => ({ url: WS_URL, headers: headers() }),
    timings: { retryMinMs: 5, retryMaxMs: 20, staleMs: 30 },
  });
  const closes = [];
  stream.on('close', (reason) => closes.push(reason));
  stream.start();
  await until(() => closes.length === 1);
  assert.equal(closes[0], 'silent for too long');
  await until(() => stream.connected);
  stream.stop();
  assert.equal(closes.at(-1), 'stopped');
});

test('a target that fails is retried, a stopped stream stays stopped', async () => {
  let calls = 0;
  const stream = new EventStream({
    WebSocket: class {
      constructor() {
        throw new Error('never built');
      }
    },
    target: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('lookup failed');
      }
      return { url: WS_URL, headers: headers() };
    },
    timings: { retryMinMs: 5, retryMaxMs: 10 },
  });
  const reasons = [];
  stream.on('retry', ({ reason }) => reasons.push(reason));
  stream.start();
  await until(() => reasons.length >= 2);
  assert.deepEqual(reasons.slice(0, 2), ['lookup failed', 'never built']);
  stream.stop();
  const count = calls;
  await wait(30);
  assert.equal(calls, count);
});
