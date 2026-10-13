// -----------------------------------------------------------------------------
// The Homematic IP home as the cloud describes it, kept up to date by the
// event stream: the home itself (its "functional homes": heating, security),
// the devices with their functional channels, and the groups (rooms for the
// heating, zones for the alarm).
//
// Pure functions: no I/O, no Gladys. The formats come from the cloud answers
// (see test/fixtures/hmip/README.md).
// -----------------------------------------------------------------------------

export const PUSH_EVENTS = {
  DEVICE_ADDED: 'DEVICE_ADDED',
  DEVICE_CHANGED: 'DEVICE_CHANGED',
  DEVICE_REMOVED: 'DEVICE_REMOVED',
  GROUP_ADDED: 'GROUP_ADDED',
  GROUP_CHANGED: 'GROUP_CHANGED',
  GROUP_REMOVED: 'GROUP_REMOVED',
  HOME_CHANGED: 'HOME_CHANGED',
  DEVICE_CHANNEL_EVENT: 'DEVICE_CHANNEL_EVENT',
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The snapshot of a `home/getCurrentState` answer. */
export function parseState(json) {
  const devices = new Map();
  for (const device of Object.values(isObject(json?.devices) ? json.devices : {})) {
    if (isObject(device) && typeof device.id === 'string') {
      devices.set(device.id, device);
    }
  }
  const groups = new Map();
  for (const group of Object.values(isObject(json?.groups) ? json.groups : {})) {
    if (isObject(group) && typeof group.id === 'string') {
      groups.set(group.id, group);
    }
  }
  return { home: isObject(json?.home) ? json.home : {}, devices, groups };
}

/** The channels of a device, by index, in order. */
export function channelsOf(device) {
  return Object.values(isObject(device?.functionalChannels) ? device.functionalChannels : {})
    .filter((channel) => isObject(channel) && Number.isInteger(channel.index))
    .sort((a, b) => a.index - b.index);
}

/** The base channel (index 0): battery, reachability, tamper. */
export const baseChannel = (device) => channelsOf(device).find((channel) => channel.index === 0);

export const isUnreachable = (device) => baseChannel(device)?.unreach === true;

/**
 * Applies one stream message to the snapshot (mutated).
 * @returns {{ devices: Set<string>, groups: Set<string>, home: boolean, structure: boolean,
 *   channelEvents: Array<{ deviceId: string, channelIndex: number, type: string }> }}
 */
export function applyMessage(snapshot, message) {
  const result = {
    devices: new Set(),
    groups: new Set(),
    home: false,
    structure: false,
    channelEvents: [],
  };
  const events = isObject(message?.events) ? Object.values(message.events) : [];
  for (const event of events) {
    if (!isObject(event)) {
      continue;
    }
    switch (event.pushEventType) {
      case PUSH_EVENTS.DEVICE_ADDED:
      case PUSH_EVENTS.DEVICE_CHANGED:
        if (isObject(event.device) && typeof event.device.id === 'string') {
          const previous = snapshot.devices.get(event.device.id);
          if (!previous || channelSignature(previous) !== channelSignature(event.device)) {
            result.structure = true;
          }
          snapshot.devices.set(event.device.id, event.device);
          result.devices.add(event.device.id);
        }
        break;
      case PUSH_EVENTS.DEVICE_REMOVED:
        if (snapshot.devices.delete(event.id)) {
          result.structure = true;
        }
        break;
      case PUSH_EVENTS.GROUP_ADDED:
      case PUSH_EVENTS.GROUP_CHANGED:
        if (isObject(event.group) && typeof event.group.id === 'string') {
          if (!snapshot.groups.has(event.group.id)) {
            result.structure = true;
          }
          snapshot.groups.set(event.group.id, event.group);
          result.groups.add(event.group.id);
        }
        break;
      case PUSH_EVENTS.GROUP_REMOVED:
        if (snapshot.groups.delete(event.id)) {
          result.structure = true;
        }
        break;
      case PUSH_EVENTS.HOME_CHANGED:
        if (isObject(event.home)) {
          snapshot.home = event.home;
          result.home = true;
        }
        break;
      case PUSH_EVENTS.DEVICE_CHANNEL_EVENT: {
        const channelIndex = Number.isInteger(event.channelIndex)
          ? event.channelIndex
          : event.functionalChannelIndex;
        if (
          typeof event.deviceId === 'string' &&
          Number.isInteger(channelIndex) &&
          typeof event.channelEventType === 'string'
        ) {
          result.channelEvents.push({
            deviceId: event.deviceId,
            channelIndex,
            type: event.channelEventType,
          });
        }
        break;
      }
      default:
        // SECURITY_JOURNAL_CHANGED, CLIENT_*, INCLUSION_REQUESTED...: nothing shown.
        break;
    }
  }
  return result;
}

/** What makes the features of a device: its channel types (and modes), its label. */
export function channelSignature(device) {
  return JSON.stringify([
    device?.label,
    channelsOf(device).map((channel) => [
      channel.index,
      channel.functionalChannelType,
      channel.multiModeInputMode ?? null,
      channel.label ?? null,
    ]),
  ]);
}

// --- Heating ---------------------------------------------------------------------

/** The heating groups (one per room with a thermostat), by name. */
export function heatingGroups(snapshot) {
  return [...snapshot.groups.values()]
    .filter((group) => group.type === 'HEATING')
    .sort((a, b) => String(a.label ?? '').localeCompare(String(b.label ?? '')));
}

export const indoorClimate = (snapshot) => snapshot.home?.functionalHomes?.INDOOR_CLIMATE ?? null;

/** True while the whole home is in eco mode: absence (timed or not) or vacation. */
export function isAbsent(snapshot) {
  const type = indoorClimate(snapshot)?.absenceType;
  return typeof type === 'string' && type !== 'NOT_ABSENT';
}

/**
 * An end time as the cloud wants it, "YYYY_MM_DD HH:MM", in the time zone of
 * the home (the access point applies it in its own time).
 */
export function formatEndTime(date, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
  } catch {
    // An unknown time zone name: the container's own (Gladys gives it TZ).
    return formatEndTime(date, undefined);
  }
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part('year')}_${part('month')}_${part('day')} ${part('hour')}:${part('minute')}`;
}

export const HOME_COMMANDS = {
  absencePermanent: () => ({ path: 'home/heating/activateAbsencePermanent' }),
  absenceFor: (minutes) => ({
    path: 'home/heating/activateAbsenceWithDuration',
    body: { duration: minutes },
  }),
  vacation: (endTime, temperature) => ({
    path: 'home/heating/activateVacation',
    body: { endTime, temperature },
  }),
  /** Ends what is running: a vacation and an absence have their own call. */
  endAbsence: (snapshot) =>
    indoorClimate(snapshot)?.absenceType === 'VACATION'
      ? { path: 'home/heating/deactivateVacation' }
      : { path: 'home/heating/deactivateAbsence' },
};

// --- Security ----------------------------------------------------------------------

export const ALARM_MODES = ['disarmed', 'perimeter', 'full'];

export const securityHome = (snapshot) =>
  snapshot.home?.functionalHomes?.SECURITY_AND_ALARM ?? null;

/** The security zones: classic (INTERNAL / EXTERNAL) or request-based (ABSENCE / PRESENCE). */
export function securityZones(snapshot) {
  const zones = {};
  for (const group of snapshot.groups.values()) {
    if (group.type === 'SECURITY_ZONE' && typeof group.label === 'string') {
      zones[group.label] = group;
    }
  }
  const requestBased = 'ABSENCE' in zones || 'PRESENCE' in zones;
  return { requestBased, zones };
}

/** 'disarmed', 'perimeter' (outer shell only) or 'full'; null without alarm system. */
export function alarmMode(snapshot) {
  if (!securityHome(snapshot)?.active) {
    return null;
  }
  const { requestBased, zones } = securityZones(snapshot);
  const active = (label) => zones[label]?.active === true;
  if (requestBased) {
    if (active('ABSENCE')) {
      return 'full';
    }
    return active('PRESENCE') ? 'perimeter' : 'disarmed';
  }
  if (active('INTERNAL')) {
    return 'full';
  }
  return active('EXTERNAL') ? 'perimeter' : 'disarmed';
}

/** The call that puts the alarm system in `mode`. */
export function alarmCommand(snapshot, mode) {
  const full = mode === 'full';
  const perimeter = mode === 'perimeter';
  if (securityZones(snapshot).requestBased) {
    return {
      path: 'home/security/setExtendedZonesActivation',
      body: { zonesActivation: { PRESENCE: perimeter, ABSENCE: full }, ignoreLowBat: true },
    };
  }
  return {
    path: 'home/security/setZonesActivation',
    body: { zonesActivation: { EXTERNAL: full || perimeter, INTERNAL: full } },
  };
}

/**
 * The sensors that kept the alarm from arming (an open window...), by
 * device label, from the answer of the activation call.
 */
export function activationProblems(snapshot, answer) {
  const problems = isObject(answer?.channelActivationProblems)
    ? answer.channelActivationProblems
    : {};
  const labels = Object.keys(problems).map((key) => {
    const deviceId = key.split(':')[0];
    return snapshot.devices.get(deviceId)?.label || deviceId;
  });
  if (labels.length === 0 && Array.isArray(answer?.activationProblems)) {
    return answer.activationProblems.filter((item) => typeof item === 'string');
  }
  return [...new Set(labels)];
}

// What set the alarm off, from the journal entry type the home reports.
const ALARM_CAUSES = {
  SENSOR_EVENT: 'intrusion',
  MOTION_EVENT: 'intrusion',
  HUMAN_EVENT: 'intrusion',
  MOTION_BY_CAMERA_EVENT: 'intrusion',
  NOISE_EVENT: 'intrusion',
  GLASS_BREAKAGE_DETECTION_EVENT: 'intrusion',
  OFFLINE_GLASS_BREAKAGE_DETECTION_EVENT: 'intrusion',
  SMOKE_ALARM: 'smoke',
  WATER_DETECTION_EVENT: 'water',
  MOISTURE_DETECTION_EVENT: 'water',
  OFFLINE_WATER_DETECTION_EVENT: 'water',
  SABOTAGE: 'sabotage',
};

export const ALARM_CAUSE_KEYS = ['intrusion', 'smoke', 'water', 'sabotage', 'other'];

/** The alarm as it stands: active or not, and when active, why and where. */
export function alarmState(snapshot) {
  const security = securityHome(snapshot);
  if (!security?.active) {
    return null;
  }
  const channel = isObject(security.alarmEventDeviceChannel)
    ? security.alarmEventDeviceChannel
    : null;
  return {
    active: security.alarmActive === true,
    timestamp: Number.isFinite(security.alarmEventTimestamp) ? security.alarmEventTimestamp : null,
    cause: ALARM_CAUSES[security.alarmSecurityJournalEntryType] ?? 'other',
    deviceId: typeof channel?.deviceId === 'string' ? channel.deviceId : null,
  };
}
