// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// The authorization token is not here: the pairing writes it under /data
// (src/store.js), it never goes through the Gladys configuration.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Who may change the alarm system from Gladys. Off by default: arming and,
// above all, disarming a security system is the user's explicit choice.
export const ALARM_CONTROL = ['off', 'arm', 'arm_disarm'];

export const DEFAULT_CONFIG = {
  access_point: '',
  pin: '',
  language: 'fr',
  alarm_control: 'off',
};

/**
 * The access point SGTIN as the cloud expects it: 24 hexadecimal characters,
 * upper case. The label under the access point prints it in groups
 * (3014-F711-A000-...): dashes, spaces and dots are dropped.
 * @returns {string | null} null when it is not one
 */
export function parseAccessPointId(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const compact = raw.replace(/[\s.:_-]/g, '').toUpperCase();
  return /^[0-9A-F]{24}$/.test(compact) ? compact : null;
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const typed = typeof source.access_point === 'string' ? source.access_point.trim() : '';
  const pin = typeof source.pin === 'string' ? source.pin.trim() : '';
  return {
    accessPoint: parseAccessPointId(typed),
    // What the user typed, when it is not an SGTIN: said in the status.
    invalidAccessPoint: typed !== '' && parseAccessPointId(typed) === null,
    pin: pin === '' ? null : pin,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
    alarmControl: ALARM_CONTROL.includes(source.alarm_control)
      ? source.alarm_control
      : DEFAULT_CONFIG.alarm_control,
  };
}
