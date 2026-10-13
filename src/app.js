// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake) and
// returns the hub, so index.js stays a few lines and the tests drive the very
// same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { HmipCloud } from './hmip/cloud.js';
import { HomematicHub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { INIT_FAILED } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'homematicip-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, fetch, WebSocket, timers, timings,
 *   cloudTimings, streamTimings, now, sleep
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new HomematicHub({
    gladys,
    store: options.store ?? new Store(),
    cloud: new HmipCloud({
      fetch: options.fetch,
      timings: options.cloudTimings,
      now: options.now,
      sleep: options.sleep,
    }),
    WebSocket: options.WebSocket,
    timers: options.timers ?? true,
    timings: options.timings,
    streamTimings: options.streamTimings,
    now: options.now,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first read is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): re-sync what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(
    whenReady(async () => {
      await hub.refresh('scan');
      // Published again even when nothing changed: the user asked to see it.
      hub.publishedSignature = null;
      await hub.publishDevices();
    }),
  );

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  // The devices are published with should_poll: false (read by the hub's own
  // timer and event stream); this only serves a Gladys that would poll anyway.
  gladys.onPoll(whenReady(() => hub.poll()));

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  gladys.onAction(
    'start_pairing',
    whenReady(() => hub.startPairing()),
  );
  gladys.onAction(
    'confirm_pairing',
    whenReady(() => hub.confirmPairing()),
  );
  gladys.onAction(
    'refresh',
    whenReady(() => hub.refreshNow()),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields: fields ?? {} })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request ?? {})),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(hub, { actionKey, params, ...context }),
      ),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
