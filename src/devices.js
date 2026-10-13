// -----------------------------------------------------------------------------
// From the Homematic IP home to Gladys devices.
//
// Three kinds of Gladys devices:
//   - one per Homematic IP device, its features read from its functional
//     channels (a channel type tells what the channel measures or drives,
//     whatever the model: a contact is a contact on an HmIP-SWDO or on a
//     wired input module);
//   - one per heating group (a room of the Homematic IP app): measured
//     temperature, set point, mode, boost, window, heating demand;
//   - one for the home: eco mode (absence) and the alarm system.
//
// External ids are forever: `device:<id>`, `room:<group id>`, `home:<home
// id>`, and each feature `<channel index>-<what>` (or `<what>` on rooms and
// home). Never change them.
//
// Gladys conventions applied here (server/utils/constants.js of the core):
//   - opening-sensor: 0 = open, 1 = closed (OPENING_SENSOR_STATE);
//   - shutter position: 0 = closed, 100 = open; Homematic IP counts the other
//     way (level 0 = open, 1 = closed);
//   - shutter state: 1 open, -1 close, 0 stop (COVER_STATE);
//   - button/click: 1 short press, 3 long press, 4 release (BUTTON_STATUS);
//   - thermostat operating state: 0 idle, 1 heating.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import {
  ALARM_MODES,
  HOME_COMMANDS,
  alarmMode,
  alarmState,
  baseChannel,
  channelsOf,
  heatingGroups,
  indoorClimate,
  isAbsent,
  securityHome,
} from './hmip/model.js';

const OPENING = { OPEN: 0, CLOSED: 1 };
export const COVER = { OPEN: 1, STOP: 0, CLOSE: -1 };
export const BUTTON = { SHORT: 1, LONG_PRESS: 3, LONG_RELEASE: 4 };
const OPERATING = { IDLE: 0, HEATING: 1 };

// Key press of the cloud → Gladys button value. KEY_PRESS_LONG repeats while
// the key is held: the start and the release are enough.
export const KEY_PRESSES = {
  KEY_PRESS_SHORT: BUTTON.SHORT,
  KEY_PRESS_LONG_START: BUTTON.LONG_PRESS,
  KEY_PRESS_LONG_STOP: BUTTON.LONG_RELEASE,
};

export const HEATING_MODES = ['AUTOMATIC', 'MANUAL', 'ECO'];

// Feature names, in the language of the configuration (frozen in Gladys once
// the device is added). German says "du", Spanish "usted" (not that a name
// needs either).
export const NAMES = {
  en: {
    temperature: 'Temperature',
    humidity: 'Humidity',
    co2: 'CO2',
    illuminance: 'Illuminance',
    wind: 'Wind speed',
    rain: 'Rain',
    opening: 'Opening',
    motion: 'Motion',
    presence: 'Presence',
    smoke: 'Smoke',
    leak: 'Water leak',
    waterLevel: 'Water level',
    batteryLow: 'Low battery',
    tamper: 'Tamper',
    switch: 'Switch',
    power: 'Power',
    energy: 'Energy',
    light: 'Light',
    brightness: 'Brightness',
    position: 'Position',
    movement: 'Open/close',
    button: 'Button',
    heating: 'Heating',
    setPoint: 'Set point',
    mode: 'Mode',
    boost: 'Boost',
    window: 'Window',
    absence: 'Eco mode (absence)',
    alarmMode: 'Alarm mode',
    alarm: 'Alarm',
    room: 'Heating',
    home: 'Homematic IP',
    automatic: 'Automatic',
    manual: 'Manual',
    eco: 'Eco',
    disarmed: 'Disarmed',
    perimeter: 'Perimeter protection',
    full: 'Full protection',
  },
  fr: {
    temperature: 'Température',
    humidity: 'Humidité',
    co2: 'CO2',
    illuminance: 'Éclairement',
    wind: 'Vitesse du vent',
    rain: 'Pluie',
    opening: 'Ouverture',
    motion: 'Mouvement',
    presence: 'Présence',
    smoke: 'Fumée',
    leak: "Fuite d'eau",
    waterLevel: "Niveau d'eau",
    batteryLow: 'Batterie faible',
    tamper: 'Sabotage',
    switch: 'Commutateur',
    power: 'Puissance',
    energy: 'Énergie',
    light: 'Lumière',
    brightness: 'Luminosité',
    position: 'Position',
    movement: 'Ouvrir/fermer',
    button: 'Bouton',
    heating: 'Chauffe',
    setPoint: 'Consigne',
    mode: 'Mode',
    boost: 'Boost',
    window: 'Fenêtre',
    absence: 'Mode éco (absence)',
    alarmMode: "Mode de l'alarme",
    alarm: 'Alarme',
    room: 'Chauffage',
    home: 'Homematic IP',
    automatic: 'Automatique',
    manual: 'Manuel',
    eco: 'Éco',
    disarmed: 'Désarmée',
    perimeter: 'Protection périphérique',
    full: 'Protection totale',
  },
  de: {
    temperature: 'Temperatur',
    humidity: 'Luftfeuchtigkeit',
    co2: 'CO2',
    illuminance: 'Beleuchtungsstärke',
    wind: 'Windgeschwindigkeit',
    rain: 'Regen',
    opening: 'Kontakt',
    motion: 'Bewegung',
    presence: 'Anwesenheit',
    smoke: 'Rauch',
    leak: 'Wasserleck',
    waterLevel: 'Wasserstand',
    batteryLow: 'Niedriger Batteriestand',
    tamper: 'Sabotage',
    switch: 'Schalter',
    power: 'Leistung',
    energy: 'Energie',
    light: 'Licht',
    brightness: 'Helligkeit',
    position: 'Position',
    movement: 'Öffnen/schließen',
    button: 'Taste',
    heating: 'Heizen',
    setPoint: 'Solltemperatur',
    mode: 'Modus',
    boost: 'Boost',
    window: 'Fenster',
    absence: 'Eco-Modus (Abwesenheit)',
    alarmMode: 'Alarmmodus',
    alarm: 'Alarm',
    room: 'Heizung',
    home: 'Homematic IP',
    automatic: 'Automatisch',
    manual: 'Manuell',
    eco: 'Eco',
    disarmed: 'Unscharf',
    perimeter: 'Hüllschutz',
    full: 'Vollschutz',
  },
  es: {
    temperature: 'Temperatura',
    humidity: 'Humedad',
    co2: 'CO2',
    illuminance: 'Iluminancia',
    wind: 'Velocidad del viento',
    rain: 'Lluvia',
    opening: 'Apertura',
    motion: 'Movimiento',
    presence: 'Presencia',
    smoke: 'Humo',
    leak: 'Fuga de agua',
    waterLevel: 'Nivel de agua',
    batteryLow: 'Batería baja',
    tamper: 'Manipulación',
    switch: 'Interruptor',
    power: 'Potencia',
    energy: 'Energía',
    light: 'Luz',
    brightness: 'Brillo',
    position: 'Posición',
    movement: 'Abrir/cerrar',
    button: 'Botón',
    heating: 'Calefacción',
    setPoint: 'Consigna',
    mode: 'Modo',
    boost: 'Boost',
    window: 'Ventana',
    absence: 'Modo eco (ausencia)',
    alarmMode: 'Modo de alarma',
    alarm: 'Alarma',
    room: 'Calefacción',
    home: 'Homematic IP',
    automatic: 'Automático',
    manual: 'Manual',
    eco: 'Eco',
    disarmed: 'Desarmada',
    perimeter: 'Protección perimetral',
    full: 'Protección total',
  },
};

export const namesFor = (language) => NAMES[language] ?? NAMES.fr;

// --- Value helpers -------------------------------------------------------------------

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const bool = (value) => (typeof value === 'boolean' ? (value ? 1 : 0) : undefined);
const number = (digits) => (value) => (isNumber(value) ? round(value, digits) : undefined);
const opening = (state) =>
  typeof state === 'string' ? (state === 'CLOSED' ? OPENING.CLOSED : OPENING.OPEN) : undefined;
// Homematic IP level (0 open, 1 closed) → Gladys position (0 closed, 100 open).
const position = (level) =>
  isNumber(level) ? clamp(Math.round((1 - level) * 100), 0, 100) : undefined;
const levelOf = (value) => clamp(round(1 - Number(value) / 100, 3), 0, 1);

// --- Feature blocks --------------------------------------------------------------------

const TEMPERATURE = {
  category: CATEGORY.TEMPERATURE_SENSOR,
  type: TYPE.SENSOR.DECIMAL,
  unit: UNIT.CELSIUS,
  min: -40,
  max: 80,
};
const sensor = (spec) => ({ read_only: true, has_feedback: false, keep_history: true, ...spec });
const binarySensor = (category, spec) =>
  sensor({ category, type: TYPE.SENSOR.BINARY, min: 0, max: 1, ...spec });

/** What one functional channel brings to its device. */
function channelFeatures(channel, device, names) {
  const at = (field) => (snapshot) => channelOf(snapshot, device.id, channel.index)?.[field];
  const key = (what) => `${channel.index}-${what}`;
  const target = { deviceId: device.id, channelIndex: channel.index };
  const features = [];
  const add = (spec) => features.push({ group: channel.index, ...spec });
  const has = (field) => channel[field] !== undefined && channel[field] !== null;

  // Measures, wherever a channel carries them.
  if (isNumber(channel.actualTemperature)) {
    add(
      sensor({
        key: key('temperature'),
        name: names.temperature,
        ...TEMPERATURE,
        read: at('actualTemperature'),
        value: number(1),
      }),
    );
  }
  if (channel.functionalChannelType === 'HEATING_THERMOSTAT_CHANNEL') {
    if (has('valveActualTemperature')) {
      add(
        sensor({
          key: key('temperature'),
          name: names.temperature,
          ...TEMPERATURE,
          read: at('valveActualTemperature'),
          value: number(1),
        }),
      );
    }
    if (has('valvePosition')) {
      add(
        sensor({
          key: key('heating'),
          name: names.heating,
          category: CATEGORY.THERMOSTAT,
          type: TYPE.THERMOSTAT.OPERATING_STATE,
          min: 0,
          max: 2,
          read: at('valvePosition'),
          value: (v) => (isNumber(v) ? (v > 0 ? OPERATING.HEATING : OPERATING.IDLE) : undefined),
        }),
      );
    }
  }
  if (channel.functionalChannelType === 'TEMPERATURE_SENSOR_2_EXTERNAL_DELTA_CHANNEL') {
    ['temperatureExternalOne', 'temperatureExternalTwo'].forEach((field, index) => {
      if (has(field)) {
        add(
          sensor({
            key: key(`temperature-${index + 1}`),
            name: `${names.temperature} ${index + 1}`,
            ...TEMPERATURE,
            read: at(field),
            value: number(1),
          }),
        );
      }
    });
  }
  if (isNumber(channel.humidity)) {
    add(
      sensor({
        key: key('humidity'),
        name: names.humidity,
        category: CATEGORY.HUMIDITY_SENSOR,
        type: TYPE.SENSOR.DECIMAL,
        unit: UNIT.PERCENT,
        min: 0,
        max: 100,
        read: at('humidity'),
        value: number(0),
      }),
    );
  }
  if (isNumber(channel.carbonDioxideConcentration)) {
    add(
      sensor({
        key: key('co2'),
        name: names.co2,
        category: CATEGORY.CO2_SENSOR,
        type: TYPE.SENSOR.INTEGER,
        unit: UNIT.PPM,
        min: 0,
        max: 10000,
        read: at('carbonDioxideConcentration'),
        value: number(0),
      }),
    );
  }
  const illuminance = ['illumination', 'currentIllumination'].find((field) =>
    isNumber(channel[field]),
  );
  if (illuminance) {
    add(
      sensor({
        key: key('illuminance'),
        name: names.illuminance,
        category: CATEGORY.LIGHT_SENSOR,
        type: TYPE.SENSOR.DECIMAL,
        unit: UNIT.LUX,
        min: 0,
        max: 100000,
        read: at(illuminance),
        value: number(1),
      }),
    );
  }
  if (isNumber(channel.windSpeed)) {
    add(
      sensor({
        key: key('wind'),
        name: names.wind,
        category: CATEGORY.SPEED_SENSOR,
        type: TYPE.SENSOR.DECIMAL,
        unit: UNIT.KILOMETER_PER_HOUR,
        min: 0,
        max: 250,
        read: at('windSpeed'),
        value: number(1),
      }),
    );
  }
  if (typeof channel.raining === 'boolean') {
    add(
      binarySensor(CATEGORY.RAIN_SENSOR, {
        key: key('rain'),
        name: names.rain,
        read: at('raining'),
        value: bool,
      }),
    );
  }

  switch (channel.functionalChannelType) {
    case 'SHUTTER_CONTACT_CHANNEL':
    case 'CONTACT_INTERFACE_CHANNEL':
    case 'ROTARY_HANDLE_CHANNEL':
      add(
        binarySensor(CATEGORY.OPENING_SENSOR, {
          key: key('opening'),
          name: names.opening,
          read: at('windowState'),
          value: opening,
        }),
      );
      break;
    case 'MULTI_MODE_INPUT_CHANNEL':
      // The same input module is a contact or a push button, as set up in the app.
      if (channel.multiModeInputMode === 'BINARY_BEHAVIOR') {
        add(
          binarySensor(CATEGORY.OPENING_SENSOR, {
            key: key('opening'),
            name: names.opening,
            read: at('windowState'),
            value: opening,
          }),
        );
      } else if (channel.multiModeInputMode === 'KEY_BEHAVIOR') {
        add(buttonFeature(channel, key, names));
      }
      break;
    case 'SINGLE_KEY_CHANNEL':
      add(buttonFeature(channel, key, names));
      break;
    case 'MOTION_DETECTION_CHANNEL':
      add(
        binarySensor(CATEGORY.MOTION_SENSOR, {
          key: key('motion'),
          name: names.motion,
          read: at('motionDetected'),
          value: bool,
        }),
      );
      break;
    case 'PRESENCE_DETECTION_CHANNEL':
      add(
        binarySensor(CATEGORY.PRESENCE_SENSOR, {
          key: key('presence'),
          name: names.presence,
          read: at('presenceDetected'),
          value: bool,
        }),
      );
      break;
    case 'SMOKE_DETECTOR_CHANNEL':
      // PRIMARY_ALARM: smoke seen by this detector. SECONDARY_ALARM is another
      // detector of the group ringing through this one: not smoke here.
      add(
        binarySensor(CATEGORY.SMOKE_SENSOR, {
          key: key('smoke'),
          name: names.smoke,
          read: at('smokeDetectorAlarmType'),
          value: (type) =>
            typeof type === 'string' ? (type === 'PRIMARY_ALARM' ? 1 : 0) : undefined,
        }),
      );
      break;
    case 'WATER_SENSOR_CHANNEL':
      add(
        binarySensor(CATEGORY.LEAK_SENSOR, {
          key: key('leak'),
          name: names.leak,
          read: at('moistureDetected'),
          value: bool,
        }),
      );
      add(
        binarySensor(CATEGORY.LEAK_SENSOR, {
          key: key('water-level'),
          name: names.waterLevel,
          read: at('waterlevelDetected'),
          value: bool,
        }),
      );
      break;
    case 'RAIN_DETECTION_CHANNEL':
      // `raining` handled above.
      break;
    case 'SWITCH_CHANNEL':
    case 'SWITCH_MEASURING_CHANNEL':
    case 'MULTI_MODE_INPUT_SWITCH_CHANNEL':
      if (typeof channel.on === 'boolean') {
        add({
          key: key('switch'),
          name: names.switch,
          category: CATEGORY.SWITCH,
          type: TYPE.SWITCH.BINARY,
          min: 0,
          max: 1,
          read_only: false,
          has_feedback: true,
          keep_history: true,
          read: at('on'),
          value: bool,
          command: (value) => ({
            path: 'device/control/setSwitchState',
            body: { ...target, on: Number(value) === 1 },
          }),
        });
      }
      if (isNumber(channel.currentPowerConsumption)) {
        add(
          sensor({
            key: key('power'),
            name: names.power,
            category: CATEGORY.SWITCH,
            type: TYPE.SWITCH.POWER,
            unit: UNIT.WATT,
            min: 0,
            max: 4000,
            read: at('currentPowerConsumption'),
            value: number(1),
          }),
        );
      }
      if (isNumber(channel.energyCounter)) {
        add(
          sensor({
            key: key('energy'),
            name: names.energy,
            category: CATEGORY.SWITCH,
            type: TYPE.SWITCH.ENERGY,
            unit: UNIT.KILOWATT_HOUR,
            min: 0,
            max: 1000000,
            read: at('energyCounter'),
            value: number(3),
          }),
        );
      }
      break;
    case 'DIMMER_CHANNEL':
    case 'MULTI_MODE_INPUT_DIMMER_CHANNEL':
      if (isNumber(channel.dimLevel)) {
        add({
          key: key('light'),
          name: names.light,
          category: CATEGORY.LIGHT,
          type: TYPE.LIGHT.BINARY,
          min: 0,
          max: 1,
          read_only: false,
          has_feedback: true,
          keep_history: true,
          read: at('dimLevel'),
          value: (level) => (isNumber(level) ? (level > 0 ? 1 : 0) : undefined),
          // Back on at the last level seen above 0, full when none was.
          command: (value, memory) => ({
            path: 'device/control/setDimLevel',
            body: { ...target, dimLevel: Number(value) === 1 ? (memory.lastDimLevel ?? 1) : 0 },
          }),
          remember: (level, memory) => {
            if (isNumber(level) && level > 0) {
              memory.lastDimLevel = level;
            }
          },
        });
        add({
          key: key('brightness'),
          name: names.brightness,
          category: CATEGORY.LIGHT,
          type: TYPE.LIGHT.BRIGHTNESS,
          unit: UNIT.PERCENT,
          min: 0,
          max: 100,
          read_only: false,
          has_feedback: true,
          keep_history: true,
          read: at('dimLevel'),
          value: (level) => (isNumber(level) ? clamp(Math.round(level * 100), 0, 100) : undefined),
          command: (value) => ({
            path: 'device/control/setDimLevel',
            body: { ...target, dimLevel: clamp(round(Number(value) / 100, 3), 0, 1) },
          }),
        });
      }
      break;
    case 'SHUTTER_CHANNEL':
    case 'BLIND_CHANNEL':
    case 'MULTI_MODE_INPUT_BLIND_CHANNEL':
      if (isNumber(channel.shutterLevel)) {
        features.push(
          ...coverFeatures(
            channel,
            key,
            names,
            at('shutterLevel'),
            (value) => ({
              path: 'device/control/setShutterLevel',
              body: { ...target, shutterLevel: value },
            }),
            target,
          ),
        );
      }
      break;
    case 'SHADING_CHANNEL':
      if (isNumber(channel.primaryShadingLevel)) {
        features.push(
          ...coverFeatures(
            channel,
            key,
            names,
            at('primaryShadingLevel'),
            (value) => ({
              path: 'device/control/setPrimaryShadingLevel',
              body: { ...target, primaryShadingLevel: value },
            }),
            target,
          ),
        );
      }
      break;
    default:
      break;
  }
  return features;
}

function buttonFeature(channel, key, names) {
  return {
    key: key('button'),
    name: `${names.button} ${channel.index}`,
    category: CATEGORY.BUTTON,
    type: TYPE.BUTTON.CLICK,
    min: 0,
    max: 4,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    // Pushed by the stream on each press (src/hub.js), never read.
    event: true,
    group: channel.index,
  };
}

function coverFeatures(channel, key, names, readLevel, setLevel, target) {
  return [
    {
      key: key('position'),
      name: names.position,
      category: CATEGORY.SHUTTER,
      type: TYPE.SHUTTER.POSITION,
      unit: UNIT.PERCENT,
      min: 0,
      max: 100,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      group: channel.index,
      read: readLevel,
      value: position,
      command: (value) => setLevel(levelOf(value)),
    },
    {
      key: key('movement'),
      name: names.movement,
      category: CATEGORY.SHUTTER,
      type: TYPE.SHUTTER.STATE,
      min: -1,
      max: 1,
      read_only: false,
      // The cloud says where the cover is, never where it is going.
      has_feedback: false,
      keep_history: false,
      group: channel.index,
      command: (value) => {
        const state = Number(value);
        if (state === COVER.OPEN) {
          return setLevel(0);
        }
        if (state === COVER.CLOSE) {
          return setLevel(1);
        }
        return { path: 'device/control/stop', body: { ...target } };
      },
    },
  ];
}

/** The snapshot channel a feature reads. */
export function channelOf(snapshot, deviceId, index) {
  return channelsOf(snapshot.devices.get(deviceId)).find((channel) => channel.index === index);
}

/**
 * Feature names unique on their device: a second "Switch" becomes
 * "Switch Kitchen" (the channel label from the app) or "Switch 2" (its index).
 */
function distinctNames(features, device) {
  const count = new Map();
  for (const feature of features) {
    count.set(feature.name, (count.get(feature.name) ?? 0) + 1);
  }
  const labels = new Map(
    channelsOf(device).map((channel) => [channel.index, channel.label?.trim()]),
  );
  const named = features.map((feature) => {
    if (count.get(feature.name) === 1) {
      return feature;
    }
    const label = labels.get(feature.group);
    return { ...feature, name: `${feature.name} ${label || feature.group}` };
  });
  const seen = new Map();
  for (const feature of named) {
    seen.set(feature.name, (seen.get(feature.name) ?? 0) + 1);
  }
  return named.map((feature) =>
    seen.get(feature.name) > 1
      ? { ...feature, name: `${feature.name} (${feature.group})` }
      : feature,
  );
}

/** A Homematic IP device; null when nothing of it shows in Gladys (the access point). */
export function describeDevice(device, names) {
  const features = [];
  const base = baseChannel(device);
  const at = (field) => (snapshot) => channelOf(snapshot, device.id, 0)?.[field];
  if (typeof base?.lowBat === 'boolean') {
    features.push(
      binarySensor(CATEGORY.BATTERY_LOW, {
        key: '0-battery-low',
        name: names.batteryLow,
        group: 0,
        read: at('lowBat'),
        value: bool,
      }),
    );
  }
  if (typeof base?.sabotage === 'boolean') {
    features.push(
      binarySensor(CATEGORY.TAMPER, {
        key: '0-tamper',
        name: names.tamper,
        group: 0,
        read: at('sabotage'),
        value: bool,
      }),
    );
  }
  for (const channel of channelsOf(device)) {
    if (channel.index > 0) {
      features.push(...channelFeatures(channel, device, names));
    }
  }
  // Battery and tamper alone: not worth a device in Gladys.
  if (features.every((feature) => feature.group === 0)) {
    return null;
  }
  return {
    kind: 'device',
    platformId: device.id.toLowerCase(),
    sourceId: device.id,
    name:
      (typeof device.label === 'string' && device.label.trim()) || device.modelType || device.type,
    model: device.modelType || device.type,
    features: distinctNames(features, device),
  };
}

/** A heating group: a room of the Homematic IP app, with its thermostats. */
export function describeRoom(group, names) {
  const at = (field) => (snapshot) => snapshot.groups.get(group.id)?.[field];
  const groupTarget = { groupId: group.id };
  const min = isNumber(group.minTemperature) ? group.minTemperature : 5;
  const max = isNumber(group.maxTemperature) ? group.maxTemperature : 30;
  const features = [];
  const temperatureField = isNumber(group.actualTemperature)
    ? 'actualTemperature'
    : 'valveActualTemperature';
  if (isNumber(group[temperatureField])) {
    features.push(
      sensor({
        key: 'temperature',
        name: names.temperature,
        ...TEMPERATURE,
        read: at(temperatureField),
        value: number(1),
      }),
    );
  }
  if (isNumber(group.humidity)) {
    features.push(
      sensor({
        key: 'humidity',
        name: names.humidity,
        category: CATEGORY.HUMIDITY_SENSOR,
        type: TYPE.SENSOR.DECIMAL,
        unit: UNIT.PERCENT,
        min: 0,
        max: 100,
        read: at('humidity'),
        value: number(0),
      }),
    );
  }
  features.push({
    key: 'target-temperature',
    name: names.setPoint,
    category: CATEGORY.THERMOSTAT,
    type: TYPE.THERMOSTAT.TARGET_TEMPERATURE,
    unit: UNIT.CELSIUS,
    min,
    max,
    step: 0.5,
    read_only: false,
    has_feedback: true,
    keep_history: true,
    read: at('setPointTemperature'),
    value: number(1),
    command: (value) => ({
      path: 'group/heating/setSetPointTemperature',
      // The thermostats work by half degrees.
      body: {
        ...groupTarget,
        setPointTemperature: clamp(Math.round(Number(value) * 2) / 2, min, max),
      },
    }),
  });
  const modes = HEATING_MODES.filter((mode) => mode !== 'ECO' || group.ecoAllowed !== false);
  features.push({
    key: 'mode',
    name: names.mode,
    category: CATEGORY.TEXT,
    type: TYPE.TEXT.SELECT,
    min: 0,
    max: 0,
    read_only: false,
    has_feedback: true,
    keep_history: false,
    supported_options: modes.map((mode, index) => ({
      value: mode,
      label: names[mode.toLowerCase()],
      sort_order: index,
    })),
    read: at('controlMode'),
    value: (mode) => (modes.includes(mode) ? { text: mode } : undefined),
    command: (value) => {
      if (!modes.includes(value)) {
        throw new RangeError(`Unknown heating mode "${value}"`);
      }
      return { path: 'group/heating/setControlMode', body: { ...groupTarget, controlMode: value } };
    },
  });
  if (group.boostAllowed !== false && typeof group.boostMode === 'boolean') {
    features.push({
      key: 'boost',
      name: names.boost,
      category: CATEGORY.SWITCH,
      type: TYPE.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      read: at('boostMode'),
      value: bool,
      command: (value) => ({
        path: 'group/heating/setBoost',
        body: { ...groupTarget, boost: Number(value) === 1 },
      }),
    });
  }
  if (typeof group.windowState === 'string') {
    features.push(
      binarySensor(CATEGORY.OPENING_SENSOR, {
        key: 'window',
        name: names.window,
        read: at('windowState'),
        value: opening,
      }),
    );
  }
  if (isNumber(group.valvePosition)) {
    features.push(
      sensor({
        key: 'heating',
        name: names.heating,
        category: CATEGORY.THERMOSTAT,
        type: TYPE.THERMOSTAT.OPERATING_STATE,
        min: 0,
        max: 2,
        read: at('valvePosition'),
        value: (v) => (isNumber(v) ? (v > 0 ? OPERATING.HEATING : OPERATING.IDLE) : undefined),
      }),
    );
  }
  const label =
    typeof group.label === 'string' && group.label.trim() ? group.label.trim() : group.id;
  return {
    kind: 'room',
    platformId: group.id.toLowerCase(),
    sourceId: group.id,
    name: `${names.room} ${label}`,
    model: 'HEATING',
    features,
  };
}

/** The home: eco mode for every room, and the alarm system. */
export function describeHome(snapshot, names) {
  const homeId = typeof snapshot.home?.id === 'string' ? snapshot.home.id : null;
  if (!homeId) {
    return null;
  }
  const features = [];
  if (indoorClimate(snapshot)?.active) {
    features.push({
      key: 'absence',
      name: names.absence,
      category: CATEGORY.SWITCH,
      type: TYPE.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      read: (current) => isAbsent(current),
      value: (absent) => (absent ? 1 : 0),
      command: (value, _memory, current) =>
        Number(value) === 1 ? HOME_COMMANDS.absencePermanent() : HOME_COMMANDS.endAbsence(current),
    });
  }
  if (securityHome(snapshot)?.active) {
    features.push({
      key: 'alarm-mode',
      name: names.alarmMode,
      category: CATEGORY.TEXT,
      type: TYPE.TEXT.SELECT,
      min: 0,
      max: 0,
      // Writable, but every change goes through the alarm policy of the
      // configuration (off by default): src/hub.js setAlarmMode.
      read_only: false,
      has_feedback: true,
      keep_history: false,
      supported_options: ALARM_MODES.map((mode, index) => ({
        value: mode,
        label: names[mode],
        sort_order: index,
      })),
      read: (current) => alarmMode(current),
      value: (mode) => (mode ? { text: mode } : undefined),
      alarm: true,
    });
    features.push(
      sensor({
        key: 'alarm',
        name: names.alarm,
        category: CATEGORY.SIREN,
        type: TYPE.SIREN.BINARY,
        min: 0,
        max: 1,
        read: (current) => alarmState(current)?.active,
        value: bool,
      }),
    );
  }
  if (features.length === 0) {
    return null;
  }
  return {
    kind: 'home',
    platformId: homeId.toLowerCase(),
    sourceId: homeId,
    name: names.home,
    model: 'HOME',
    features,
  };
}

/** Every Gladys device of the home, in a stable order. */
export function describeAll(snapshot, language) {
  const names = namesFor(language);
  const descriptions = [];
  const home = describeHome(snapshot, names);
  if (home) {
    descriptions.push(home);
  }
  for (const group of heatingGroups(snapshot)) {
    descriptions.push(describeRoom(group, names));
  }
  const devices = [...snapshot.devices.values()].sort((a, b) =>
    String(a.label ?? a.id).localeCompare(String(b.label ?? b.id)),
  );
  for (const device of devices) {
    const description = describeDevice(device, names);
    if (description) {
      descriptions.push(description);
    }
  }
  return descriptions;
}

/** The value a feature shows now; undefined when the cloud says nothing. */
export function featureValue(feature, snapshot) {
  if (typeof feature.read !== 'function') {
    return undefined;
  }
  const raw = feature.read(snapshot);
  return raw === undefined || raw === null ? undefined : feature.value(raw);
}

const GLADYS_FIELDS = [
  'name',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'step',
  'read_only',
  'has_feedback',
  'keep_history',
  'supported_options',
];

/** The Gladys device of a description, with its external ids. */
export function toGladysDevice(gladys, description) {
  const ids = gladys.externalIds(description.kind, description.platformId);
  return {
    name: description.name,
    external_id: ids.device,
    model: description.model,
    // Refreshed by the integration's own timer and event stream: see src/hub.js.
    should_poll: false,
    params: [{ name: 'homematic_ip_id', value: description.sourceId }],
    features: description.features.map((feature) => {
      const published = { external_id: ids.feature(feature.key) };
      for (const field of GLADYS_FIELDS) {
        if (feature[field] !== undefined) {
          published[field] = feature[field];
        }
      }
      return published;
    }),
  };
}

export { alarmMode };
