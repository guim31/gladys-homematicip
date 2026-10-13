// -----------------------------------------------------------------------------
// A fake Homematic IP cloud, in memory: the lookup, the pairing calls, the
// full read, the commands (applied to its state, then pushed on the event
// stream like the real cloud does) and a WebSocket class for the stream.
// No network: `fetch` and `WebSocket` are handed to the integration.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { clientAuthToken, LOOKUP_URL } from '../../src/hmip/cloud.js';

export const ACCESS_POINT = '3014F711A000000BAD0CAAAA';
export const AUTH_TOKEN = 'FakeAuthToken0000000000000000000000000000000001';
export const REST_URL = 'https://rest.cloud.example';
export const WS_URL = 'wss://ws.cloud.example/ws';

const FIXTURE = JSON.parse(
  readFileSync(new URL('../fixtures/hmip/current-state.json', import.meta.url), 'utf8'),
);

/** A fresh copy of the recorded home. */
export const fixtureState = () => structuredClone(FIXTURE);

const json = (status, body) =>
  new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export class FakeCloud {
  constructor({ state = fixtureState(), tokens = [AUTH_TOKEN], pin = null } = {}) {
    this.state = state;
    this.tokens = new Set(tokens);
    this.pin = pin;
    /** Every REST call: { path, body, headers } */
    this.calls = [];
    this.requests = new Map();
    this.offline = false;
    this.failWith = null;
    this.blockingSensors = null;
    this.sockets = new Set();
    this.socketAttempts = 0;
    this.issuedToken = 'FreshAuthToken000000000000000000000000000000002';
    this.fetch = this.fetch.bind(this);
    this.WebSocket = makeWebSocketClass(this);
  }

  /** The calls to one path. */
  callsTo(path) {
    return this.calls.filter((call) => call.path === path);
  }

  async fetch(url, init = {}) {
    if (this.offline) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    const headers = init.headers ?? {};
    if (url === LOOKUP_URL) {
      this.calls.push({ path: 'lookup', body, headers });
      return json(200, { urlREST: REST_URL, urlWebSocket: WS_URL });
    }
    const prefix = `${REST_URL}/hmip/`;
    if (!url.startsWith(prefix)) {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    }
    const path = url.slice(prefix.length);
    this.calls.push({ path, body, headers });
    if (this.failWith) {
      return json(this.failWith, { errorCode: 'FAKE_FAILURE' });
    }
    if (
      headers['ACCESSPOINT-ID'] !== ACCESS_POINT ||
      headers.CLIENTAUTH !== clientAuthToken(ACCESS_POINT) ||
      headers.VERSION !== '12'
    ) {
      return json(403, { errorCode: 'INVALID_CLIENT' });
    }
    if (path.startsWith('auth/')) {
      return this.auth(path, body, headers);
    }
    if (!this.tokens.has(headers.AUTHTOKEN)) {
      return json(403, { errorCode: 'INVALID_AUTH_TOKEN' });
    }
    if (path === 'home/getCurrentState') {
      return json(200, structuredClone(this.state));
    }
    return this.command(path, body ?? {});
  }

  auth(path, body, headers) {
    switch (path) {
      case 'auth/connectionRequest':
        if (body.sgtin !== ACCESS_POINT) {
          return json(404, { errorCode: 'ACCESS_POINT_NOT_FOUND' });
        }
        if (this.pin && headers.PIN !== this.pin) {
          return json(403, { errorCode: 'INVALID_PIN' });
        }
        this.requests.set(body.deviceId, { name: body.deviceName, acknowledged: false });
        return json(200);
      case 'auth/isRequestAcknowledged': {
        const request = this.requests.get(body.deviceId);
        return request?.acknowledged ? json(200) : json(400, { errorCode: 'NOT_ACKNOWLEDGED' });
      }
      case 'auth/requestAuthToken': {
        const request = this.requests.get(body.deviceId);
        if (!request?.acknowledged) {
          return json(403, { errorCode: 'NOT_ACKNOWLEDGED' });
        }
        request.token = this.issuedToken;
        return json(200, { authToken: this.issuedToken });
      }
      case 'auth/confirmAuthToken': {
        const request = this.requests.get(body.deviceId);
        if (!request || request.token !== body.authToken) {
          return json(403, { errorCode: 'INVALID_AUTH_TOKEN' });
        }
        this.tokens.add(body.authToken);
        return json(200, { clientId: 'client-0001' });
      }
      default:
        return json(404);
    }
  }

  /** The user pressed the blue button of the access point. */
  pressBlueButton() {
    for (const request of this.requests.values()) {
      request.acknowledged = true;
    }
  }

  channel(deviceId, index) {
    return this.state.devices[deviceId].functionalChannels[String(index)];
  }

  group(id) {
    return this.state.groups[id];
  }

  zone(label) {
    return Object.values(this.state.groups).find(
      (group) => group.type === 'SECURITY_ZONE' && group.label === label,
    );
  }

  command(path, body) {
    const device = body.deviceId ? this.state.devices[body.deviceId] : null;
    const channel = device?.functionalChannels[String(body.channelIndex)];
    const group = body.groupId ? this.state.groups[body.groupId] : null;
    const climate = this.state.home.functionalHomes.INDOOR_CLIMATE;
    switch (path) {
      case 'device/control/setSwitchState':
        channel.on = body.on;
        break;
      case 'device/control/setDimLevel':
        channel.dimLevel = body.dimLevel;
        break;
      case 'device/control/setShutterLevel':
        channel.shutterLevel = body.shutterLevel;
        break;
      case 'device/control/setPrimaryShadingLevel':
        channel.primaryShadingLevel = body.primaryShadingLevel;
        break;
      case 'device/control/stop':
        break;
      case 'group/heating/setSetPointTemperature':
        group.setPointTemperature = body.setPointTemperature;
        break;
      case 'group/heating/setControlMode':
        group.controlMode = body.controlMode;
        break;
      case 'group/heating/setBoost':
        group.boostMode = body.boost;
        break;
      case 'home/heating/activateAbsencePermanent':
        climate.absenceType = 'PERMANENT';
        climate.absenceEndTime = null;
        break;
      case 'home/heating/activateAbsenceWithDuration':
        climate.absenceType = 'PERIOD';
        climate.absenceEndTime = '2026_10_14 08:00';
        break;
      case 'home/heating/activateVacation':
        climate.absenceType = 'VACATION';
        climate.absenceEndTime = body.endTime;
        break;
      case 'home/heating/deactivateAbsence':
      case 'home/heating/deactivateVacation':
        climate.absenceType = 'NOT_ABSENT';
        climate.absenceEndTime = null;
        break;
      case 'home/security/setZonesActivation':
        if (this.blockingSensors) {
          return json(200, {
            channelActivationProblems: Object.fromEntries(
              this.blockingSensors.map((id) => [`${id}:1`, ['WINDOW_OPEN']]),
            ),
          });
        }
        this.zone('INTERNAL').active = body.zonesActivation.INTERNAL;
        this.zone('EXTERNAL').active = body.zonesActivation.EXTERNAL;
        this.push(
          { pushEventType: 'GROUP_CHANGED', group: this.zone('INTERNAL') },
          { pushEventType: 'GROUP_CHANGED', group: this.zone('EXTERNAL') },
        );
        return json(200, {});
      default:
        return json(400, { errorCode: 'UNKNOWN_REQUEST' });
    }
    // Like the cloud: the new state of what changed comes on the stream.
    if (device) {
      this.push({ pushEventType: 'DEVICE_CHANGED', device });
    } else if (group) {
      this.push({ pushEventType: 'GROUP_CHANGED', group });
    } else {
      this.push({ pushEventType: 'HOME_CHANGED', home: this.state.home });
    }
    return json(200);
  }

  /** Sends events on every open stream, as one message. */
  push(...events) {
    const message = JSON.stringify({
      events: Object.fromEntries(events.map((event, index) => [String(index), event])),
      origin: { originType: 'DEVICE' },
    });
    for (const socket of this.sockets) {
      socket.receive(message);
    }
  }

  /** A change made elsewhere (the app, a wall switch): applied, then pushed. */
  changeDevice(deviceId, index, values) {
    Object.assign(this.channel(deviceId, index), values);
    this.push({ pushEventType: 'DEVICE_CHANGED', device: this.state.devices[deviceId] });
  }

  changeGroup(id, values) {
    Object.assign(this.group(id), values);
    this.push({ pushEventType: 'GROUP_CHANGED', group: this.group(id) });
  }

  changeHome(update) {
    update(this.state.home);
    this.push({ pushEventType: 'HOME_CHANGED', home: this.state.home });
  }

  pressKey(deviceId, channelIndex, type = 'KEY_PRESS_SHORT') {
    this.push({
      pushEventType: 'DEVICE_CHANNEL_EVENT',
      deviceId,
      channelIndex,
      channelEventType: type,
    });
  }

  /** Closes every stream, as a cloud restart would. */
  dropStreams() {
    for (const socket of [...this.sockets]) {
      socket.serverClose(1006);
    }
  }
}

function makeWebSocketClass(cloud) {
  return class FakeWebSocket {
    constructor(url, { headers = {} } = {}) {
      this.url = url;
      this.headers = headers;
      this.listeners = new Map();
      this.readyState = 0;
      cloud.socketAttempts += 1;
      setImmediate(() => {
        if (
          cloud.offline ||
          url !== WS_URL ||
          !cloud.tokens.has(headers.AUTHTOKEN) ||
          headers.CLIENTAUTH !== clientAuthToken(ACCESS_POINT)
        ) {
          this.emit('error', {});
          this.serverClose(1006);
          return;
        }
        this.readyState = 1;
        cloud.sockets.add(this);
        this.emit('open', {});
      });
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, []);
      }
      this.listeners.get(type).push(listener);
    }

    emit(type, event) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }

    receive(data) {
      if (this.readyState === 1) {
        this.emit('message', { data });
      }
    }

    serverClose(code) {
      if (this.readyState === 3) {
        return;
      }
      this.readyState = 3;
      cloud.sockets.delete(this);
      this.emit('close', { code });
    }

    close() {
      if (this.readyState === 3) {
        return;
      }
      this.readyState = 3;
      cloud.sockets.delete(this);
      this.emit('close', { code: 1000 });
    }
  };
}
