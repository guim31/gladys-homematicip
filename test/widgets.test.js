// -----------------------------------------------------------------------------
// The heating widget: content within the core vocabulary and budget, rooms
// chosen in the settings, eco mode button, and its refresh nudges.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { readableEndTime } from '../src/widgets.js';
import { ROOM, createAll, createWorld, roomId, settle } from './helpers/world.js';

async function world(t, options) {
  const created = await createWorld(options);
  t.after(() => created.app.stop());
  return created;
}

const content = async (w, settings = {}, language = 'en') => {
  const ack = await w.fake.widgetGet('heating', { settings, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
};

test('every room at a glance, the outside temperature, the eco button', async (t) => {
  const w = await world(t);
  w.cloud.changeGroup(ROOM, { valvePosition: 0.4, boostMode: false, windowState: 'CLOSED' });
  await settle(w);
  const widget = await content(w);
  assert.deepEqual(validateWidgetContent(widget), []);
  const [outside, heating] = widget.components.filter((component) => component.type === 'value');
  assert.deepEqual(outside, {
    type: 'value',
    value: 16.6,
    unit: '°C',
    label: 'Outside',
    icon: 'cloud',
  });
  assert.equal(heating.value, '1/8');
  const status = widget.components.find((component) => component.type === 'status');
  assert.equal(status.items.length, 8);
  const bedroom = status.items.find((item) => item.label === 'Schlafzimmer');
  assert.deepEqual(bedroom, { label: 'Schlafzimmer', value: '24.7 °C → 5 °C', color: 'warning' });
  const living = status.items.find((item) => item.label === 'Wohnzimmer');
  assert.equal(living.value, '23.6 °C → 5 °C · window');
  assert.equal(living.color, 'info');
  const button = widget.components.find((component) => component.type === 'button');
  assert.deepEqual(button.action, { key: 'start_absence', confirm: true });
  assert.notEqual(button.style, 'primary', 'invisible in dark mode');
});

test('the rooms chosen in the settings only, in French with French decimals', async (t) => {
  const w = await world(t);
  await createAll(w);
  const widget = await content(w, { rooms: [roomId(w.gladys, ROOM), 'ext:unknown'] }, 'fr');
  const status = widget.components.find((component) => component.type === 'status');
  assert.deepEqual(
    status.items.map((item) => item.label),
    ['Schlafzimmer'],
  );
  assert.equal(status.items[0].value, '24,7 °C → 5 °C · fenêtre');
  assert.equal(
    widget.components.find((component) => component.type === 'button').label,
    'Mode éco',
  );
});

test('the eco mode from the widget: started, shown, ended', async (t) => {
  const w = await world(t);
  const started = await w.fake.widgetAction('heating', 'start_absence', {}, { settings: {} });
  assert.equal(started.success, true, started.error);
  assert.equal(started.data.message.fr, 'Mode éco lancé');
  await settle(w);
  const widget = await content(w);
  assert.equal(widget.components[0].type, 'text');
  assert.equal(widget.components[0].text, 'Eco mode: the whole home is in absence.');
  const button = widget.components.find((component) => component.type === 'button');
  assert.equal(button.action.key, 'end_absence');
  assert.equal(
    (await w.fake.widgetAction('heating', 'end_absence', {}, { settings: {} })).success,
    true,
  );
  assert.equal(w.cloud.callsTo('home/heating/deactivateAbsence').length, 1);
  assert.equal((await w.fake.widgetAction('heating', 'nope', {}, { settings: {} })).success, false);
});

test('a vacation shows its end, in the wall time of the home', async (t) => {
  const w = await world(t);
  w.cloud.changeHome((home) => {
    Object.assign(home.functionalHomes.INDOOR_CLIMATE, {
      absenceType: 'VACATION',
      absenceEndTime: '2026_10_20 18:00',
    });
  });
  await settle(w);
  const widget = await content(w);
  assert.match(widget.components[0].text, /^Vacation mode until 20 Oct.*18:00\.$/);
  assert.equal(readableEndTime('nonsense', 'en'), null);
  assert.match(readableEndTime('2026_10_20 18:00', 'de'), /20\. Okt\.?.*18:00/);
});

test('not paired: a single text says what to do', async (t) => {
  const w = await world(t, { paired: false });
  const widget = await content(w, {}, 'de');
  assert.deepEqual(widget.components, [
    {
      type: 'text',
      variant: 'body',
      text: 'Kopple zuerst den Access Point in der Konfiguration der Integration.',
    },
  ]);
});

test('room changes nudge the widget, at most once per interval', async (t) => {
  const w = await world(t);
  const before = w.fake.widgetRefreshes.length;
  w.cloud.changeGroup(ROOM, { setPointTemperature: 20 });
  w.cloud.changeGroup(ROOM, { setPointTemperature: 21 });
  await settle(w);
  // Timers are off in the tests: every nudge goes; the interval is tested below.
  assert.ok(w.fake.widgetRefreshes.length > before);
  assert.ok(w.fake.widgetRefreshes.every((key) => key === 'heating'));
});

test('with timers, the nudges are spaced', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await world(t, { timers: true });
  const before = w.fake.widgetRefreshes.length;
  w.cloud.changeGroup(ROOM, { setPointTemperature: 20 });
  await settle(w);
  w.cloud.changeGroup(ROOM, { setPointTemperature: 21 });
  await settle(w);
  assert.equal(w.fake.widgetRefreshes.length, before, 'waits for the interval');
  t.mock.timers.tick(15_000);
  assert.equal(w.fake.widgetRefreshes.length, before + 1, 'one nudge for both changes');
});
