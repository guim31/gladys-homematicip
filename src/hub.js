// -----------------------------------------------------------------------------
// The Homematic IP hub: pairs with the access point through the cloud, reads
// the whole home, follows the cloud event stream, publishes the devices and
// their states to Gladys, runs the commands and fires the alarm trigger.
//
// Push first: the WebSocket of the cloud sends every change (a window opened,
// a set point changed, a key pressed) as it happens. A full read
// (`home/getCurrentState`) at start, when the stream comes back, and every
// 30 minutes (5 while the stream is down) catches what the stream may have
// missed and re-sends the unchanged values as a heartbeat. Gladys never polls
// these devices (should_poll: false): the core's polling cannot be trusted
// (GladysAssistant/Gladys#3198), and the cloud would not like it either.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { GladysApiError, createLogger } from '@gladysassistant/integration-sdk';
import { KEY_PRESSES, describeAll, featureValue, namesFor, toGladysDevice } from './devices.js';
import { CloudError } from './hmip/cloud.js';
import { EventStream } from './hmip/events.js';
import {
  ALARM_MODES,
  HOME_COMMANDS,
  activationProblems,
  alarmCommand,
  alarmMode,
  alarmState,
  applyMessage,
  formatEndTime,
  heatingGroups,
  indoorClimate,
  isUnreachable,
  parseState,
  securityHome,
} from './hmip/model.js';
import { ProblemLog } from './problems.js';
import { CONNECTION_TEXT, TRANSPORT_TEXT, UserError, allLanguages, messagesFor } from './texts.js';

const logger = createLogger({ name: 'homematicip-hub' });

export const WIDGET_KEY = 'heating';
export const TRIGGER = 'alarm_triggered';

export const HUB_TIMINGS = {
  // Full read while the stream is up: a safety net, and the heartbeat.
  refreshMs: 30 * 60_000,
  // Full read while the stream is down: the only way to see changes then.
  fallbackRefreshMs: 5 * 60_000,
  // A full read this recent is enough (the stream opening, onPoll).
  recentReadMs: 60_000,
  // Read again shortly after a command, when no stream will say it worked.
  afterCommandMs: 3_000,
  // Stream failures in a row before the hosts are looked up again.
  lookupAfterFailures: 3,
  // An unchanged value is sent again this often, so Gladys never shows it
  // as stale (it does after 48 h).
  heartbeatMs: 6 * 60 * 60_000,
  // Widget refresh nudges: the core takes one every 10 s.
  widgetRefreshMs: 15_000,
  // States sent at once; Gladys takes 300 a minute.
  statesPerMinute: 250,
};

const PUBLISH_BATCH = 100;
const describe = (err) => err?.message ?? String(err);

/**
 * Gladys refused a call or did not answer (restart, network, rate limit): a
 * passing condition, unlike a bug in the integration.
 */
const isGladysFailure = (err) =>
  err instanceof GladysApiError ||
  err?.name === 'TimeoutError' ||
  err?.name === 'AbortError' ||
  (err instanceof TypeError && err.message === 'fetch failed');

const chunks = (list, size) => {
  const result = [];
  for (let index = 0; index < list.length; index += size) {
    result.push(list.slice(index, index + size));
  }
  return result;
};

export class HomematicHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake)
   * @param {object} options.store persistence (src/store.js)
   * @param {import('./hmip/cloud.js').HmipCloud} options.cloud
   * @param {typeof WebSocket} [options.WebSocket] for the event stream
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {object} [options.streamTimings] STREAM_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, cloud, WebSocket, timers = true, timings, streamTimings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.cloud = cloud;
    this.WebSocket = WebSocket;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.streamTimings = streamTimings;
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.pairing = {};
    this.pendingPairing = null;
    this.snapshot = null;
    /** @type {Array<object>} descriptions of src/devices.js */
    this.descriptions = [];
    /** @type {Map<string, { description: object, feature: object }>} by feature external id */
    this.features = new Map();
    /** @type {Map<string, object>} descriptions by Gladys device external id */
    this.devicesByExternalId = new Map();
    this.publishedSignature = null;
    this.transports = new Map();
    this.memory = new Map();
    this.stream = null;
    this.status = null;
    this.lastReadAt = 0;
    this.refreshTimer = null;
    this.commandReadTimer = null;
    this.widgetTimer = null;
    this.laterStates = new Set();
    this.lastWidgetRefresh = 0;
    this.reading = null;
    this.pending = new Set();
    this.stopped = false;
    this.connectedOnce = false;
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    this.pairing = await this.store.load();
    logger.info(
      this.credentials()
        ? 'Homematic IP integration started, access point paired'
        : 'Homematic IP integration started, access point not paired yet',
    );
    await this.connect();
  }

  /** Gladys came back (restart, network): it may have lost what was published. */
  async resync(config) {
    this.config = config;
    this.gladys.forgetPublishedStates();
    this.transports.clear();
    this.publishedSignature = null;
    if (this.snapshot) {
      await this.publishDevices();
      await this.publishStates(this.descriptions);
      await this.publishTransports();
    }
    await this.publishStatus(true);
    this.requestWidgetRefresh();
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (previous?.accessPoint !== config.accessPoint) {
      logger.info('Access point changed in the configuration');
      await this.connect();
      return;
    }
    if (previous?.language !== config.language && this.snapshot) {
      // Names in another language for the Discovery list.
      this.describe();
      await this.publishDevices();
    }
    await this.publishStatus(true);
    this.requestWidgetRefresh();
  }

  async stop() {
    this.stopped = true;
    this.clearTimers();
    this.stream?.stop();
    this.stream = null;
    await this.idle();
    await this.store.flush();
  }

  clearTimers() {
    clearTimeout(this.refreshTimer);
    clearTimeout(this.commandReadTimer);
    clearTimeout(this.widgetTimer);
    for (const timer of this.laterStates) {
      clearTimeout(timer);
    }
    this.laterStates.clear();
    this.refreshTimer = null;
    this.commandReadTimer = null;
    this.widgetTimer = null;
  }

  /** Runs a background task; its failures are logged, never thrown. */
  track(promise) {
    const tracked = Promise.resolve(promise)
      .catch((err) => {
        if (isGladysFailure(err)) {
          this.gladysFailed(err);
        } else {
          logger.error('Background task failed', err);
        }
      })
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
    return tracked;
  }

  /** Resolves once the background tasks started so far are done. */
  async idle() {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  gladysFailed(err) {
    this.problems.fail('gladys', `Gladys does not take the Homematic IP updates: ${describe(err)}`);
  }

  gladysRecovered() {
    this.problems.recover('gladys', 'Gladys takes the Homematic IP updates again');
  }

  // --- Connection ------------------------------------------------------------

  /** The pairing of the configured access point, if any. */
  credentials() {
    const accessPoint = this.config?.accessPoint;
    if (
      accessPoint &&
      this.pairing.accessPoint === accessPoint &&
      typeof this.pairing.authToken === 'string' &&
      this.pairing.authToken !== ''
    ) {
      return { accessPoint, authToken: this.pairing.authToken };
    }
    return null;
  }

  /** (Re)starts everything for the configured access point. */
  async connect() {
    this.clearTimers();
    this.stream?.stop();
    this.stream = null;
    this.cloud.session = null;
    const previousSnapshot = this.snapshot;
    this.snapshot = null;
    this.descriptions = [];
    this.features.clear();
    this.devicesByExternalId.clear();
    if (!this.credentials()) {
      if (previousSnapshot) {
        // Another access point: its devices are not this one's.
        this.publishedSignature = null;
        await this.publishDevices();
      }
      await this.publishStatus(true);
      return;
    }
    await this.refresh('connect');
    this.startStream();
    this.scheduleRefresh();
  }

  /** The status shown under the integration name; sent when it changes. */
  async publishStatus(force = false) {
    let status;
    if (!this.config?.accessPoint) {
      status = this.config?.invalidAccessPoint
        ? { connected: false, message: CONNECTION_TEXT.invalidAccessPoint }
        : { connected: false, message: CONNECTION_TEXT.noAccessPoint };
    } else if (!this.credentials()) {
      status = { connected: false, message: CONNECTION_TEXT.notPaired };
    } else if (this.revoked) {
      status = { connected: false, message: CONNECTION_TEXT.revoked };
    } else if (!this.snapshot || this.cloudDown) {
      status = { connected: false, message: CONNECTION_TEXT.unreachable };
    } else if (this.snapshot.home?.connected === false) {
      status = { connected: false, message: CONNECTION_TEXT.accessPointOffline };
    } else {
      status = { connected: true };
    }
    const key = JSON.stringify(status);
    if (!force && key === this.status) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.status = key;
    } catch (err) {
      if (!isGladysFailure(err)) {
        throw err;
      }
      this.gladysFailed(err);
    }
  }

  /** Opens the cloud session: the hosts of the access point. */
  async openSession() {
    const credentials = this.credentials();
    if (!credentials) {
      throw new UserError(messagesFor(this.config?.language).notPaired);
    }
    if (!this.cloud.session || this.cloud.session.accessPoint !== credentials.accessPoint) {
      await this.cloud.open(credentials.accessPoint, credentials.authToken);
    }
    return this.cloud.session;
  }

  /**
   * Reads the whole home and publishes what changed. Concurrent callers share
   * the read in progress.
   * @returns {Promise<boolean>} whether the read worked
   */
  refresh(reason = 'timer') {
    if (!this.reading) {
      this.reading = this.read(reason).finally(() => {
        this.reading = null;
      });
    }
    return this.reading;
  }

  async read(reason) {
    if (!this.credentials()) {
      return false;
    }
    let json;
    try {
      await this.openSession();
      json = await this.cloud.getCurrentState();
    } catch (err) {
      await this.cloudFailed(err, 'read');
      return false;
    }
    logger.debug(`Full read (${reason})`);
    this.lastReadAt = this.now();
    this.cloudDown = false;
    this.revoked = false;
    this.problems.recover('read', 'The Homematic IP cloud answers again');
    const previous = this.snapshot;
    this.snapshot = parseState(json);
    if (!this.connectedOnce) {
      this.connectedOnce = true;
      logger.info(
        `Connected to the Homematic IP cloud: ${this.snapshot.devices.size} device(s), ${heatingGroups(this.snapshot).length} heating room(s)`,
      );
    }
    this.watchAccessPoint();
    this.describe();
    await this.publishDevices();
    await this.publishStates(this.descriptions);
    await this.publishTransports();
    await this.publishStatus();
    if (previous) {
      await this.checkAlarm(alarmState(previous));
    }
    this.requestWidgetRefresh();
    return true;
  }

  /** A cloud call failed: log it once, show it, mark the devices. */
  async cloudFailed(err, what) {
    if (!(err instanceof CloudError)) {
      throw err;
    }
    if (err.kind === 'auth') {
      if (!this.revoked) {
        logger.error(
          'The Homematic IP cloud refuses the authorization token: pair the access point again',
        );
      }
      this.revoked = true;
      this.stream?.stop();
      this.stream = null;
    } else {
      this.cloudDown = true;
      this.problems.fail(what, `Homematic IP cloud unreachable: ${err.message}`);
      // The hosts may have moved: look them up again next time.
      this.cloud.session = null;
    }
    await this.publishTransports();
    await this.publishStatus();
  }

  watchAccessPoint() {
    if (this.snapshot?.home?.connected === false) {
      this.problems.fail(
        'access-point',
        'The access point is offline (not connected to the Homematic IP cloud)',
        'info',
      );
    } else {
      this.problems.recover('access-point', 'The access point is online again');
    }
  }

  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    if (!this.timersEnabled || this.stopped || !this.credentials() || this.revoked) {
      return;
    }
    const delay = this.stream?.connected ? this.timings.refreshMs : this.timings.fallbackRefreshMs;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.track(this.refresh('timer').finally(() => this.scheduleRefresh()));
    }, delay);
  }

  // --- Event stream ----------------------------------------------------------

  startStream() {
    if (this.stopped || !this.credentials() || this.revoked || !this.WebSocketAvailable()) {
      return;
    }
    const stream = new EventStream({
      WebSocket: this.WebSocket,
      timings: this.streamTimings,
      target: async () => {
        // After a few failures in a row the host may have moved.
        if (stream.failures >= this.timings.lookupAfterFailures) {
          this.cloud.session = null;
        }
        const session = await this.openSession();
        return { url: session.websocket, headers: this.cloud.headers() };
      },
    });
    stream.on('open', () => this.track(this.streamOpened()));
    stream.on('close', (reason) => this.streamClosed(reason));
    stream.on('retry', ({ reason, failures }) => {
      if (failures === 1) {
        this.problems.fail('stream', `Homematic IP event stream unavailable (${reason}), retrying`);
      } else {
        logger.debug(`Event stream retry ${failures} (${reason})`);
      }
    });
    stream.on('message', (message) => this.track(this.onStreamMessage(message)));
    stream.on('invalid', () => logger.debug('Event stream: a message is not JSON, ignored'));
    this.stream = stream;
    stream.start();
  }

  WebSocketAvailable() {
    return typeof (this.WebSocket ?? globalThis.WebSocket) === 'function';
  }

  async streamOpened() {
    this.problems.recover('stream', 'Homematic IP event stream connected again');
    logger.debug('Event stream open');
    this.scheduleRefresh();
    // What happened while the stream was down: read it all, unless just read.
    if (this.now() - this.lastReadAt > this.timings.recentReadMs) {
      await this.refresh('stream-open');
    }
  }

  streamClosed(reason) {
    logger.debug(`Event stream closed (${reason})`);
    // Read more often until it is back.
    this.scheduleRefresh();
  }

  async onStreamMessage(message) {
    if (!this.snapshot) {
      return;
    }
    const before = alarmState(this.snapshot);
    const homeConnected = this.snapshot.home?.connected;
    const changes = applyMessage(this.snapshot, message);
    const touched = new Set();
    if (changes.structure) {
      this.describe();
      await this.publishDevices();
      // A new device or group: everything it has.
      for (const description of this.descriptions) {
        touched.add(description);
      }
    }
    for (const description of this.descriptions) {
      if (
        (description.kind === 'device' && changes.devices.has(description.sourceId)) ||
        (description.kind === 'room' && changes.groups.has(description.sourceId)) ||
        (description.kind === 'home' && (changes.home || changes.groups.size > 0))
      ) {
        touched.add(description);
      }
    }
    if (touched.size > 0) {
      await this.publishStates([...touched]);
    }
    if (changes.channelEvents.length > 0) {
      await this.publishKeyPresses(changes.channelEvents);
    }
    if (changes.devices.size > 0 || changes.home) {
      await this.publishTransports();
    }
    if (changes.home) {
      if (this.snapshot.home?.connected !== homeConnected) {
        this.watchAccessPoint();
        await this.publishStatus();
      }
      await this.checkAlarm(before);
    }
    if (changes.home || changes.groups.size > 0) {
      this.requestWidgetRefresh();
    }
  }

  // --- Publishing ---------------------------------------------------------------

  /** Builds the descriptions of the current snapshot and their indexes. */
  describe() {
    this.descriptions = this.snapshot ? describeAll(this.snapshot, this.config.language) : [];
    this.features.clear();
    this.devicesByExternalId.clear();
    for (const description of this.descriptions) {
      const ids = this.gladys.externalIds(description.kind, description.platformId);
      description.externalId = ids.device;
      this.devicesByExternalId.set(ids.device, description);
      for (const feature of description.features) {
        feature.externalId = ids.feature(feature.key);
        this.features.set(feature.externalId, { description, feature });
      }
    }
  }

  /** The Discovery list; sent again only when it changed. */
  async publishDevices() {
    const devices = this.descriptions.map((description) =>
      toGladysDevice(this.gladys, description),
    );
    const signature = JSON.stringify(devices);
    if (signature === this.publishedSignature) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.publishedSignature = signature;
      this.gladysRecovered();
    } catch (err) {
      if (!isGladysFailure(err)) {
        throw err;
      }
      this.gladysFailed(err);
    }
  }

  /** The external ids of the devices the user added to Gladys. */
  createdIds() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  /**
   * The states of these descriptions, for the devices added to Gladys only:
   * Gladys drops the others, and a large home would hit its 300 states per
   * minute for nothing.
   */
  async publishStates(descriptions) {
    if (!this.snapshot) {
      return;
    }
    const created = this.createdIds();
    const states = [];
    for (const description of descriptions) {
      if (!created.has(description.externalId)) {
        continue;
      }
      for (const feature of description.features) {
        const raw = typeof feature.read === 'function' ? feature.read(this.snapshot) : undefined;
        feature.remember?.(raw, this.memoryOf(feature));
        const value = featureValue(feature, this.snapshot);
        if (value === undefined) {
          continue;
        }
        states.push(
          typeof value === 'object'
            ? { device_feature_external_id: feature.externalId, text: value.text }
            : { device_feature_external_id: feature.externalId, state: value },
        );
      }
    }
    // Gladys takes 300 states a minute: a large home sends the rest later.
    const [first, ...later] = chunks(states, this.timings.statesPerMinute);
    if (first) {
      await this.publishChangedStates(first);
    }
    later.forEach((batch, index) => {
      if (!this.timersEnabled) {
        this.track(this.publishChangedStates(batch));
        return;
      }
      const timer = setTimeout(
        () => {
          this.laterStates.delete(timer);
          this.track(this.publishChangedStates(batch));
        },
        (index + 1) * 61_000,
      );
      this.laterStates.add(timer);
    });
  }

  async publishChangedStates(states) {
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.gladysRecovered();
    } catch (err) {
      if (!isGladysFailure(err)) {
        throw err;
      }
      this.gladysFailed(err);
    }
  }

  memoryOf(feature) {
    let memory = this.memory.get(feature.externalId);
    if (!memory) {
      memory = {};
      this.memory.set(feature.externalId, memory);
    }
    return memory;
  }

  /**
   * Key presses: each one is a new state, even the same value twice (two
   * short presses), so never deduplicated.
   */
  async publishKeyPresses(events) {
    const created = this.createdIds();
    const states = [];
    for (const event of events) {
      const value = KEY_PRESSES[event.type];
      const description = this.descriptions.find(
        (entry) => entry.kind === 'device' && entry.sourceId === event.deviceId,
      );
      const feature = description?.features.find(
        (entry) => entry.event && entry.group === event.channelIndex,
      );
      if (value === undefined || !feature || !created.has(description.externalId)) {
        logger.debug(
          `Channel event ${event.type} on ${event.deviceId}:${event.channelIndex} ignored`,
        );
        continue;
      }
      states.push({ device_feature_external_id: feature.externalId, state: value });
    }
    for (const batch of chunks(states, PUBLISH_BATCH)) {
      try {
        await this.gladys.publishStates(batch);
        this.gladysRecovered();
      } catch (err) {
        if (!isGladysFailure(err)) {
          throw err;
        }
        this.gladysFailed(err);
      }
    }
  }

  /**
   * The transport badge of the added devices: cloud, or unreachable when the
   * device, the access point or the cloud is out of reach.
   */
  async publishTransports() {
    const created = this.createdIds();
    const offline = this.snapshot?.home?.connected === false;
    const entries = [];
    for (const description of this.descriptions) {
      if (!created.has(description.externalId)) {
        continue;
      }
      let entry;
      if (this.cloudDown || this.revoked || !this.snapshot) {
        entry = { external_id: description.externalId, transport: 'unreachable' };
      } else if (
        description.kind === 'device' &&
        isUnreachable(this.snapshot.devices.get(description.sourceId))
      ) {
        entry = { external_id: description.externalId, transport: 'unreachable' };
      } else if (offline) {
        entry = {
          external_id: description.externalId,
          transport: 'cloud',
          degraded: true,
          message: TRANSPORT_TEXT.accessPointOffline,
        };
      } else {
        entry = { external_id: description.externalId, transport: 'cloud' };
      }
      const key = JSON.stringify(entry);
      if (this.transports.get(description.externalId) !== key) {
        entries.push({ entry, key });
      }
    }
    for (const batch of chunks(entries, PUBLISH_BATCH)) {
      try {
        await this.gladys.publishTransports(batch.map(({ entry }) => entry));
        for (const { entry, key } of batch) {
          this.transports.set(entry.external_id, key);
        }
      } catch (err) {
        if (!isGladysFailure(err)) {
          throw err;
        }
        this.gladysFailed(err);
      }
    }
  }

  /** The user added (or updated) a device: send everything it has now. */
  async onDeviceCreated(device) {
    const description = this.devicesByExternalId.get(device?.external_id);
    if (!description) {
      return;
    }
    this.gladys.forgetPublishedStates(description.externalId);
    this.transports.delete(description.externalId);
    await this.publishStates([description]);
    await this.publishTransports();
    this.requestWidgetRefresh(true);
  }

  requestWidgetRefresh(now = false) {
    if (this.widgetTimer) {
      return;
    }
    const wait = now
      ? 0
      : Math.max(0, this.lastWidgetRefresh + this.timings.widgetRefreshMs - this.now());
    const send = () => {
      this.widgetTimer = null;
      this.lastWidgetRefresh = this.now();
      try {
        this.gladys.requestWidgetRefresh(WIDGET_KEY);
      } catch (err) {
        logger.debug(`Widget refresh not sent: ${describe(err)}`);
      }
    };
    if (wait === 0 || !this.timersEnabled) {
      send();
      return;
    }
    this.widgetTimer = setTimeout(send, wait);
  }

  // --- Alarm trigger ------------------------------------------------------------

  /** Fires the scene trigger when the alarm goes off (not when it already was). */
  async checkAlarm(before) {
    const after = alarmState(this.snapshot);
    if (!after?.active) {
      return;
    }
    const isNew =
      before?.active !== true || (after.timestamp !== null && after.timestamp !== before.timestamp);
    if (!isNew) {
      return;
    }
    const device = after.deviceId ? this.snapshot.devices.get(after.deviceId) : null;
    const description = device
      ? this.descriptions.find((entry) => entry.kind === 'device' && entry.sourceId === device.id)
      : null;
    const sensor = (device?.label || after.deviceId || '').slice(0, 200);
    logger.info(`Alarm triggered (${after.cause}${sensor ? `, ${sensor}` : ''})`);
    try {
      await this.gladys.publishSceneEvent(TRIGGER, {
        cause: after.cause,
        device: description?.externalId ?? null,
        sensor: sensor || null,
      });
      this.gladysRecovered();
    } catch (err) {
      if (!isGladysFailure(err)) {
        throw err;
      }
      this.gladysFailed(err);
    }
  }

  // --- Commands ------------------------------------------------------------------

  /** onSetValue: a feature changed from the Gladys interface or a scene. */
  async setValue(device, deviceFeature, value) {
    const t = messagesFor(this.config?.language);
    const entry = this.features.get(deviceFeature?.external_id);
    if (!entry) {
      if (!this.credentials()) {
        throw new UserError(t.notPaired);
      }
      // Not read yet (the cloud did not answer since the start): say so.
      throw new UserError(this.snapshot ? t.unknownDevice : t.cloudFailed('getCurrentState'));
    }
    const { feature } = entry;
    if (feature.alarm) {
      const { problems } = await this.setAlarmMode(String(value));
      if (problems.length > 0) {
        throw new UserError(t.alarmBlocked(problems.join(', ')));
      }
      return;
    }
    if (typeof feature.command !== 'function') {
      throw new UserError(t.readOnly);
    }
    const command = feature.command(value, this.memoryOf(feature), this.snapshot);
    logger.debug(`Command ${command.path} for ${feature.externalId}`);
    await this.send(command);
  }

  /** Sends a command; the stream (or a read soon after) brings the new state. */
  async send(command) {
    const t = messagesFor(this.config?.language);
    try {
      await this.openSession();
      const answer = await this.cloud.send(command);
      this.scheduleCommandRead();
      return answer;
    } catch (err) {
      if (err instanceof UserError) {
        throw err;
      }
      if (!(err instanceof CloudError)) {
        throw err;
      }
      if (err.kind === 'auth') {
        await this.cloudFailed(err, 'command');
      }
      throw new UserError(
        err.kind === 'busy' ? t.busy : t.cloudFailed(err.errorCode ?? err.status ?? err.kind),
      );
    }
  }

  scheduleCommandRead() {
    if (this.stream?.connected || !this.timersEnabled || this.commandReadTimer) {
      return;
    }
    this.commandReadTimer = setTimeout(() => {
      this.commandReadTimer = null;
      this.track(this.refresh('command'));
    }, this.timings.afterCommandMs);
  }

  /**
   * Arms or disarms the alarm system, within what the configuration allows.
   * @returns {Promise<{ mode: string, problems: string[] }>}
   */
  async setAlarmMode(mode) {
    const t = messagesFor(this.config?.language);
    if (!this.snapshot) {
      throw new UserError(t.notPaired);
    }
    if (!securityHome(this.snapshot)?.active) {
      throw new UserError(t.noAlarm);
    }
    if (!ALARM_MODES.includes(mode)) {
      throw new UserError(`${mode}?`);
    }
    const control = this.config?.alarmControl ?? 'off';
    if (control === 'off') {
      throw new UserError(t.alarmOff);
    }
    if (mode === 'disarmed' && control !== 'arm_disarm') {
      throw new UserError(t.disarmOff);
    }
    const answer = await this.send(alarmCommand(this.snapshot, mode));
    const problems = activationProblems(this.snapshot, answer);
    logger.info(
      problems.length > 0
        ? `Alarm mode "${mode}" requested from Gladys, refused by the access point (${problems.length} sensor(s))`
        : `Alarm mode "${mode}" requested from Gladys`,
    );
    return { mode, problems };
  }

  async startAbsence(minutes) {
    this.requireHeating();
    const duration = Math.round(Number(minutes));
    await this.send(
      Number.isFinite(duration) && duration > 0
        ? HOME_COMMANDS.absenceFor(duration)
        : HOME_COMMANDS.absencePermanent(),
    );
    logger.info('Eco mode (absence) started from Gladys');
  }

  async startVacation(days, temperature) {
    this.requireHeating();
    const end = new Date(this.now() + Math.max(1, Math.round(Number(days))) * 24 * 3600_000);
    const set = Math.min(30, Math.max(5, Math.round(Number(temperature) * 2) / 2));
    await this.send(
      HOME_COMMANDS.vacation(formatEndTime(end, this.snapshot.home?.timeZoneId), set),
    );
    logger.info('Vacation mode started from Gladys');
  }

  async endAbsence() {
    this.requireHeating();
    await this.send(HOME_COMMANDS.endAbsence(this.snapshot));
    logger.info('Eco mode (absence) ended from Gladys');
  }

  requireHeating() {
    const t = messagesFor(this.config?.language);
    if (!this.snapshot) {
      throw new UserError(t.notPaired);
    }
    if (!indoorClimate(this.snapshot)?.active) {
      throw new UserError(t.noHeating);
    }
  }

  // --- Pairing -----------------------------------------------------------------------

  /** "Start pairing": the connection request, before the press on the blue button. */
  async startPairing() {
    const t = messagesFor(this.config?.language);
    if (!this.config?.accessPoint) {
      throw new UserError(this.config?.invalidAccessPoint ? t.invalidAccessPoint : t.noAccessPoint);
    }
    const accessPoint = this.config.accessPoint;
    const deviceId = randomUUID();
    let rest;
    try {
      // The pairing calls go to the REST host of the access point too.
      ({ rest } = await this.cloud.lookup(accessPoint));
      await this.cloud.connectionRequest({ accessPoint, deviceId, pin: this.config.pin, rest });
    } catch (err) {
      if (!(err instanceof CloudError)) {
        throw err;
      }
      logger.info(`Pairing request refused: ${err.message}`);
      throw new UserError(t.requestRefused(err.errorCode ?? err.status ?? err.kind));
    }
    this.pendingPairing = { accessPoint, deviceId, rest };
    logger.info('Pairing started: waiting for the blue button of the access point');
    return allLanguages('requestSent');
  }

  /** "I pressed the button": the token, saved under /data, then the first read. */
  async confirmPairing() {
    const t = messagesFor(this.config?.language);
    const pending = this.pendingPairing;
    if (!pending || pending.accessPoint !== this.config?.accessPoint) {
      throw new UserError(t.noPairing);
    }
    let authToken;
    let clientId;
    try {
      if (!(await this.cloud.isRequestAcknowledged(pending))) {
        throw new UserError(t.notAcknowledged);
      }
      authToken = await this.cloud.requestAuthToken(pending);
      clientId = await this.cloud.confirmAuthToken({ ...pending, authToken });
    } catch (err) {
      if (err instanceof UserError || !(err instanceof CloudError)) {
        throw err;
      }
      logger.info(`Pairing failed: ${err.message}`);
      throw new UserError(t.pairingFailed(err.errorCode ?? err.status ?? err.kind));
    }
    this.pendingPairing = null;
    this.pairing = {
      accessPoint: pending.accessPoint,
      authToken,
      clientId,
      deviceId: pending.deviceId,
      pairedAt: new Date(this.now()).toISOString(),
    };
    this.revoked = false;
    this.connectedOnce = false;
    await this.store.save(this.pairing).catch(() => {});
    logger.info('Access point paired');
    await this.connect();
    if (!this.snapshot) {
      throw new UserError(messagesFor(this.config?.language).cloudFailed('getCurrentState'));
    }
    return allLanguages('paired', this.countDevices(), heatingGroups(this.snapshot).length);
  }

  /** "Refresh": a full read now, and what was found. */
  async refreshNow() {
    const t = messagesFor(this.config?.language);
    if (!this.credentials()) {
      throw new UserError(t.notPaired);
    }
    if (this.revoked || !this.stream) {
      // A token refused before, or no stream: start over.
      this.revoked = false;
      await this.connect();
    } else {
      await this.refresh('action');
    }
    if (!this.snapshot || this.cloudDown || this.revoked) {
      throw new UserError(
        this.revoked
          ? (CONNECTION_TEXT.revoked[this.config.language] ?? CONNECTION_TEXT.revoked.fr)
          : t.cloudFailed('getCurrentState'),
      );
    }
    logger.info('Full read requested from the configuration screen');
    return allLanguages('refreshed', this.countDevices(), heatingGroups(this.snapshot).length);
  }

  countDevices() {
    return this.descriptions.filter((description) => description.kind === 'device').length;
  }

  /** onPoll (fallback only: the devices are published with should_poll false). */
  async poll() {
    if (this.now() - this.lastReadAt >= this.timings.recentReadMs) {
      await this.refresh('poll');
    }
  }

  /** For the widget and the scene actions: the language names. */
  names() {
    return namesFor(this.config?.language);
  }

  /** The current mode of the alarm, for the widget and the tests. */
  alarmMode() {
    return this.snapshot ? alarmMode(this.snapshot) : null;
  }
}
