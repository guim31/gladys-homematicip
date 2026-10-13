// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `heating`.
//
// The Gladys device boxes show one room at a time. What the widget adds: the
// whole house at a glance — every heating room with its temperature, its set
// point and what it is doing (heating, boost, window open, eco) — the outside
// temperature the cloud knows for the home, and the eco mode (absence) of
// the whole home, one tap to start or end it.
//
// Budget (8 components, 2 texts, 1 status, 4 buttons): one caption, two
// tiles, one status list of 10 rooms at most, one button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { heatingGroups, indoorClimate, isAbsent } from './hmip/model.js';

const MAX_ROOMS = 10;

export const TEXT = {
  notPaired: {
    en: 'Pair the access point in the configuration of the integration first.',
    fr: "Appairez d'abord le point d'accès dans la configuration de l'intégration.",
    de: 'Kopple zuerst den Access Point in der Konfiguration der Integration.',
    es: 'Empareje primero el punto de acceso en la configuración de la integración.',
  },
  noRooms: {
    en: 'No heating room in the Homematic IP home.',
    fr: 'Aucune pièce chauffée dans la maison Homematic IP.',
    de: 'Kein Heizungsraum im Homematic IP Zuhause.',
    es: 'Ninguna habitación con calefacción en la casa Homematic IP.',
  },
  outside: { en: 'Outside', fr: 'Extérieur', de: 'Außen', es: 'Exterior' },
  heatingRooms: { en: 'Heating', fr: 'En chauffe', de: 'Heizt', es: 'Calentando' },
  startEco: { en: 'Eco mode', fr: 'Mode éco', de: 'Eco-Modus', es: 'Modo eco' },
  endEco: {
    en: 'End eco mode',
    fr: 'Fin du mode éco',
    de: 'Eco-Modus beenden',
    es: 'Fin del modo eco',
  },
  ecoOn: {
    en: 'Eco mode: the whole home is in absence.',
    fr: 'Mode éco : toute la maison est en absence.',
    de: 'Eco-Modus: Das ganze Zuhause ist auf Abwesenheit.',
    es: 'Modo eco: toda la casa está en ausencia.',
  },
  ecoUntil: {
    en: (end) => `Eco mode until ${end}.`,
    fr: (end) => `Mode éco jusqu'au ${end}.`,
    de: (end) => `Eco-Modus bis ${end}.`,
    es: (end) => `Modo eco hasta el ${end}.`,
  },
  vacationUntil: {
    en: (end) => `Vacation mode until ${end}.`,
    fr: (end) => `Mode vacances jusqu'au ${end}.`,
    de: (end) => `Urlaubsmodus bis ${end}.`,
    es: (end) => `Modo vacaciones hasta el ${end}.`,
  },
  windowOpen: { en: 'window', fr: 'fenêtre', de: 'Fenster', es: 'ventana' },
  boost: { en: 'boost', fr: 'boost', de: 'Boost', es: 'boost' },
  eco: { en: 'eco', fr: 'éco', de: 'Eco', es: 'eco' },
  ecoStarted: {
    en: 'Eco mode started',
    fr: 'Mode éco lancé',
    de: 'Eco-Modus gestartet',
    es: 'Modo eco iniciado',
  },
  ecoEnded: {
    en: 'Eco mode ended',
    fr: 'Mode éco terminé',
    de: 'Eco-Modus beendet',
    es: 'Modo eco terminado',
  },
};

const pick = (text, language) => text[language] ?? text.en;

function temperature(value, language) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '–';
  }
  const formatted = new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);
  return `${formatted} °C`;
}

/** "2026_10_20 18:00" (wall time of the home) as the user reads a date. */
export function readableEndTime(raw, language) {
  const match =
    typeof raw === 'string' ? raw.match(/^(\d{4})_(\d{2})_(\d{2}) (\d{2}):(\d{2})/) : null;
  if (!match) {
    return null;
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  // Formatted in UTC from UTC parts: the wall time stays what the cloud said.
  // English as in Europe, where Homematic IP is sold: 24-hour clock.
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(Date.UTC(year, month - 1, day, hour, minute)));
}

/** One status row: the room, its temperatures and what it is doing. */
function roomRow(group, language) {
  const flags = [];
  let color = WIDGET_COLORS.SUCCESS;
  if (group.controlMode === 'ECO') {
    flags.push(pick(TEXT.eco, language));
    color = WIDGET_COLORS.NEUTRAL;
  }
  if (typeof group.valvePosition === 'number' && group.valvePosition > 0) {
    color = WIDGET_COLORS.WARNING;
  }
  if (group.boostMode === true) {
    flags.push(pick(TEXT.boost, language));
    color = WIDGET_COLORS.DANGER;
  }
  if (typeof group.windowState === 'string' && group.windowState !== 'CLOSED') {
    flags.push(pick(TEXT.windowOpen, language));
    color = WIDGET_COLORS.INFO;
  }
  const measured = group.actualTemperature ?? group.valveActualTemperature;
  const value = `${temperature(measured, language)} → ${temperature(group.setPointTemperature, language)}`;
  return {
    label: String(group.label ?? '').slice(0, 40) || '?',
    value: (flags.length > 0 ? `${value} · ${flags.join(', ')}` : value).slice(0, 40),
    color,
  };
}

/** The content of the widget, from the hub's snapshot. */
export function heatingContent(hub, { settings = {}, language = 'en' } = {}) {
  const snapshot = hub.snapshot;
  if (!snapshot) {
    return {
      ttl_seconds: 60,
      components: [{ type: 'text', variant: 'body', text: pick(TEXT.notPaired, language) }],
    };
  }
  let groups = heatingGroups(snapshot);
  // The rooms chosen in the settings (room devices added to Gladys), if any.
  const chosen = Array.isArray(settings.rooms) ? settings.rooms : [];
  const chosenIds = new Set(
    chosen
      .map((externalId) => hub.devicesByExternalId.get(externalId))
      .filter((description) => description?.kind === 'room')
      .map((description) => description.sourceId),
  );
  if (chosenIds.size > 0) {
    groups = groups.filter((group) => chosenIds.has(group.id));
  }
  const components = [];
  const climate = indoorClimate(snapshot);
  const absent = isAbsent(snapshot);
  if (absent) {
    const end = readableEndTime(climate?.absenceEndTime, language);
    const text =
      climate?.absenceType === 'VACATION' && end
        ? pick(TEXT.vacationUntil, language)(end)
        : end
          ? pick(TEXT.ecoUntil, language)(end)
          : pick(TEXT.ecoOn, language);
    components.push({ type: 'text', variant: 'caption', text });
  }
  const outside = snapshot.home?.weather?.temperature;
  if (typeof outside === 'number' && Number.isFinite(outside)) {
    components.push({
      type: 'value',
      value: Math.round(outside * 10) / 10,
      unit: '°C',
      label: pick(TEXT.outside, language),
      icon: 'cloud',
    });
  }
  if (groups.length > 0) {
    const heating = groups.filter(
      (group) => typeof group.valvePosition === 'number' && group.valvePosition > 0,
    ).length;
    components.push({
      type: 'value',
      value: `${heating}/${groups.length}`,
      label: pick(TEXT.heatingRooms, language),
      icon: 'thermometer',
      color: heating > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
    components.push({
      type: 'status',
      items: groups.slice(0, MAX_ROOMS).map((group) => roomRow(group, language)),
    });
  } else {
    components.push({ type: 'text', variant: 'body', text: pick(TEXT.noRooms, language) });
  }
  if (climate?.active) {
    components.push(
      absent
        ? {
            type: 'button',
            label: pick(TEXT.endEco, language),
            icon: 'home',
            style: 'secondary',
            action: { key: 'end_absence' },
          }
        : {
            type: 'button',
            label: pick(TEXT.startEco, language),
            icon: 'moon',
            style: 'secondary',
            action: { key: 'start_absence', confirm: true },
          },
    );
  }
  return { ttl_seconds: 120, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(hub, request) {
      return heatingContent(hub, request);
    },

    async action(hub, { actionKey }) {
      if (actionKey === 'start_absence') {
        await hub.startAbsence(0);
        return TEXT.ecoStarted;
      }
      if (actionKey === 'end_absence') {
        await hub.endAbsence();
        return TEXT.ecoEnded;
      }
      throw new Error(`Unknown widget action "${actionKey}"`);
    },
  },
};
