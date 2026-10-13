// -----------------------------------------------------------------------------
// The Homematic IP cloud REST API, as the access point's own app uses it.
//
// Every call is a POST with a JSON body. The host is not fixed: a lookup on
// lookup.homematic.com gives the REST and WebSocket hosts of an access point
// (they move when eQ-3 rebalances its servers). Three headers identify the
// client: ACCESSPOINT-ID (the SGTIN printed under the access point),
// CLIENTAUTH (a SHA-512 derived from it, the same for every client of the
// protocol) and, once paired, AUTHTOKEN (the token the pairing returned).
//
// The cloud throttles busy clients (HTTP 429): every call takes a token from a
// bucket of 10 refilled one every 8 seconds, the pace of the reference client
// (hahn-th/homematicip-rest-api) that Home Assistant uses.
//
// Nothing here logs: the errors carry the path and the HTTP status, never a
// header, so no token can leak through them.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export const LOOKUP_URL = 'https://lookup.homematic.com:48335/getHost';
export const API_VERSION = '12';
// The protocol constant every client appends to the SGTIN to build CLIENTAUTH.
const CLIENT_AUTH_SALT = 'jiLpVitHvWnIGD1yo7MA';
export const CLIENT_NAME = 'Gladys';
const APPLICATION_ID = 'gladys-homematicip';

export const CLOUD_TIMINGS = {
  requestTimeoutMs: 15_000,
  // The full state of a large home weighs a few megabytes.
  stateTimeoutMs: 45_000,
  bucketSize: 10,
  refillMs: 8_000,
  // A command waits that long for a token, then fails: past 5 seconds Gladys
  // stops waiting for its answer anyway.
  commandWaitMs: 4_000,
  readWaitMs: 60_000,
};

/** Why a call failed, in a form the hub can act on. */
export class CloudError extends Error {
  /**
   * @param {'network'|'timeout'|'auth'|'throttled'|'busy'|'http'|'invalid'} kind
   * @param {string} message
   * @param {{ status?: number, errorCode?: string }} [details]
   */
  constructor(kind, message, { status, errorCode } = {}) {
    super(message);
    this.name = 'CloudError';
    this.kind = kind;
    this.status = status;
    this.errorCode = errorCode;
  }
}

/** CLIENTAUTH for an access point: SHA-512 of SGTIN + salt, upper-case hex. */
export function clientAuthToken(accessPoint) {
  return createHash('sha512')
    .update(`${accessPoint}${CLIENT_AUTH_SALT}`, 'utf8')
    .digest('hex')
    .toUpperCase();
}

/** What the cloud learns about this client (shown nowhere, required by the lookup). */
export function clientCharacteristics(accessPoint) {
  return {
    clientCharacteristics: {
      apiVersion: '10',
      applicationIdentifier: APPLICATION_ID,
      applicationVersion: '1.0',
      deviceManufacturer: 'none',
      deviceType: 'Computer',
      language: 'en_US',
      osType: 'Linux',
      osVersion: 'container',
    },
    id: accessPoint,
  };
}

/** A token bucket: `size` calls at once, then one every `refillMs`. */
export class TokenBucket {
  constructor({ size, refillMs, now = () => Date.now(), sleep = defaultSleep }) {
    this.size = size;
    this.refillMs = refillMs;
    this.now = now;
    this.sleep = sleep;
    this.tokens = size;
    this.updatedAt = now();
  }

  refill() {
    if (this.tokens >= this.size) {
      // A full bucket earns nothing: the refill clock starts at the next take.
      this.updatedAt = this.now();
      return;
    }
    const earned = Math.floor((this.now() - this.updatedAt) / this.refillMs);
    if (earned > 0) {
      this.tokens = Math.min(this.size, this.tokens + earned);
      this.updatedAt += earned * this.refillMs;
    }
  }

  /** Takes a token, waiting at most `maxWaitMs`; false when none came in time. */
  async take(maxWaitMs) {
    const deadline = this.now() + maxWaitMs;
    for (;;) {
      this.refill();
      if (this.tokens > 0) {
        this.tokens -= 1;
        return true;
      }
      const wait = this.updatedAt + this.refillMs - this.now();
      if (this.now() + wait > deadline) {
        return false;
      }
      await this.sleep(Math.max(wait, 1));
    }
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HmipCloud {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch]
   * @param {object} [options.timings] CLOUD_TIMINGS overrides
   * @param {() => number} [options.now]
   * @param {(ms: number) => Promise<void>} [options.sleep]
   */
  constructor({ fetch: fetchImpl, timings, now, sleep } = {}) {
    this.fetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.timings = { ...CLOUD_TIMINGS, ...timings };
    this.bucket = new TokenBucket({
      size: this.timings.bucketSize,
      refillMs: this.timings.refillMs,
      now,
      sleep,
    });
    /** @type {{ accessPoint: string, authToken?: string, rest: string, websocket: string } | null} */
    this.session = null;
  }

  /** The REST and WebSocket hosts of an access point. */
  async lookup(accessPoint) {
    const json = await this.request(LOOKUP_URL, clientCharacteristics(accessPoint), {
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      label: 'lookup',
      limited: false,
    });
    const rest = typeof json?.urlREST === 'string' ? json.urlREST.replace(/\/+$/, '') : null;
    const websocket = typeof json?.urlWebSocket === 'string' ? json.urlWebSocket : null;
    if (!rest || !/^https:\/\//.test(rest) || !websocket || !/^wss?:\/\//.test(websocket)) {
      throw new CloudError('invalid', 'The Homematic IP lookup returned no usable host');
    }
    return { rest, websocket };
  }

  /** Looks the hosts up and remembers the session the next calls use. */
  async open(accessPoint, authToken) {
    const hosts = await this.lookup(accessPoint);
    this.session = { accessPoint, authToken, ...hosts };
    return this.session;
  }

  /** The headers of a call; AUTHTOKEN only once paired. */
  headers(accessPoint = this.session?.accessPoint, authToken = this.session?.authToken) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json',
      VERSION: API_VERSION,
      CLIENTAUTH: clientAuthToken(accessPoint),
      'ACCESSPOINT-ID': accessPoint,
    };
    if (authToken) {
      headers.AUTHTOKEN = authToken;
    }
    return headers;
  }

  /**
   * A call on the REST host of the session.
   * @param {string} path e.g. 'home/getCurrentState'
   * @param {object} [body] JSON body; none when undefined
   * @param {{ headers?: object, wait?: number, timeoutMs?: number, rest?: string }} [options]
   *   `rest`: another REST host than the session's (a pairing in progress)
   */
  async post(path, body, { headers, wait, timeoutMs, rest } = {}) {
    const host = rest ?? this.session?.rest;
    if (!host) {
      throw new CloudError('invalid', 'Not connected to the Homematic IP cloud');
    }
    return this.request(`${host}/hmip/${path}`, body, {
      headers: headers ?? this.headers(),
      label: path,
      wait: wait ?? this.timings.commandWaitMs,
      timeoutMs,
    });
  }

  async request(url, body, { headers, label, wait = 0, limited = true, timeoutMs } = {}) {
    if (limited && !(await this.bucket.take(wait))) {
      throw new CloudError('busy', `Too many Homematic IP calls in a row (${label})`);
    }
    let response;
    try {
      response = await this.fetch(url, {
        method: 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs ?? this.timings.requestTimeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new CloudError('timeout', `The Homematic IP cloud did not answer (${label})`);
      }
      const code = err?.cause?.code ? ` (${err.cause.code})` : '';
      throw new CloudError('network', `Cannot reach the Homematic IP cloud${code} (${label})`);
    }
    const text = await response.text().catch(() => '');
    let json = null;
    if (text.trim() !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (response.ok) {
      return json;
    }
    const errorCode = typeof json?.errorCode === 'string' ? json.errorCode : undefined;
    const detail = errorCode ? `HTTP ${response.status} ${errorCode}` : `HTTP ${response.status}`;
    const kind =
      response.status === 429
        ? 'throttled'
        : response.status === 401 || response.status === 403
          ? 'auth'
          : 'http';
    throw new CloudError(kind, `The Homematic IP cloud answered ${detail} (${label})`, {
      status: response.status,
      errorCode,
    });
  }

  // --- Pairing ---------------------------------------------------------------
  // The four calls of the official pairing: a connection request (with the
  // PIN when one is set), the press on the blue button of the access point,
  // then the token, which only works once confirmed. They take the REST host
  // of the lookup (`rest`), so a session in use is left alone.

  async connectionRequest({ accessPoint, deviceId, pin, rest }) {
    const headers = this.headers(accessPoint, null);
    if (pin) {
      headers.PIN = pin;
    }
    await this.post(
      'auth/connectionRequest',
      { deviceId, deviceName: CLIENT_NAME, sgtin: accessPoint },
      { headers, rest },
    );
  }

  /** True once the blue button was pressed; the cloud answers an error before. */
  async isRequestAcknowledged({ accessPoint, deviceId, rest }) {
    try {
      await this.post(
        'auth/isRequestAcknowledged',
        { deviceId, accessPointId: accessPoint },
        { headers: this.headers(accessPoint, null), rest },
      );
      return true;
    } catch (err) {
      if (err instanceof CloudError && (err.kind === 'auth' || err.kind === 'http')) {
        return false;
      }
      throw err;
    }
  }

  async requestAuthToken({ accessPoint, deviceId, rest }) {
    const json = await this.post(
      'auth/requestAuthToken',
      { deviceId },
      { headers: this.headers(accessPoint, null), rest },
    );
    if (typeof json?.authToken !== 'string' || json.authToken === '') {
      throw new CloudError('invalid', 'The Homematic IP cloud returned no token');
    }
    return json.authToken;
  }

  async confirmAuthToken({ accessPoint, deviceId, authToken, rest }) {
    const json = await this.post(
      'auth/confirmAuthToken',
      { deviceId, authToken },
      { headers: this.headers(accessPoint, null), rest },
    );
    if (typeof json?.clientId !== 'string' || json.clientId === '') {
      throw new CloudError('invalid', 'The Homematic IP cloud did not confirm the token');
    }
    return json.clientId;
  }

  // --- Reading -----------------------------------------------------------------

  /** Everything: the home, its devices, its groups and its clients. */
  async getCurrentState() {
    const json = await this.post(
      'home/getCurrentState',
      clientCharacteristics(this.session?.accessPoint),
      { wait: this.timings.readWaitMs, timeoutMs: this.timings.stateTimeoutMs },
    );
    if (!json || typeof json !== 'object' || !json.home || typeof json.devices !== 'object') {
      throw new CloudError('invalid', 'The Homematic IP cloud returned an unexpected state');
    }
    return json;
  }

  /** A command built by src/devices.js or src/hmip/model.js: `{ path, body }`. */
  async send(command) {
    return this.post(command.path, command.body);
  }
}
