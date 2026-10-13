// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, the reports of the configuration buttons, the errors of
// the commands and scene actions. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks
// every table.
// -----------------------------------------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Shown by Gladys under the integration name when it is not connected.
export const CONNECTION_TEXT = {
  noAccessPoint: {
    en: 'Type the SGTIN of your access point (printed under it), save, then use "Start pairing".',
    fr: "Saisissez le SGTIN de votre point d'accès (imprimé dessous), enregistrez, puis utilisez « Démarrer l'appairage ».",
    de: 'Gib die SGTIN deines Access Points ein (steht auf der Unterseite), speichere und nutze dann „Kopplung starten“.',
    es: 'Introduzca el SGTIN de su punto de acceso (impreso debajo), guarde y luego use «Iniciar el emparejamiento».',
  },
  invalidAccessPoint: {
    en: 'This is not an SGTIN: 24 characters, digits and letters A to F (example: 3014-F711-A000-0000-0000-0001).',
    fr: "Ce n'est pas un SGTIN : 24 caractères, chiffres et lettres A à F (exemple : 3014-F711-A000-0000-0000-0001).",
    de: 'Das ist keine SGTIN: 24 Zeichen, Ziffern und Buchstaben A bis F (Beispiel: 3014-F711-A000-0000-0000-0001).',
    es: 'Esto no es un SGTIN: 24 caracteres, cifras y letras de la A a la F (ejemplo: 3014-F711-A000-0000-0000-0001).',
  },
  notPaired: {
    en: 'Access point not paired yet: use "Start pairing" below.',
    fr: "Point d'accès pas encore appairé : utilisez « Démarrer l'appairage » ci-dessous.",
    de: 'Access Point noch nicht gekoppelt: Nutze unten „Kopplung starten“.',
    es: 'Punto de acceso aún no emparejado: use «Iniciar el emparejamiento» abajo.',
  },
  revoked: {
    en: 'The Homematic IP cloud refuses the access of Gladys (removed in the app?): pair the access point again.',
    fr: "Le cloud Homematic IP refuse l'accès de Gladys (supprimé dans l'application ?) : appairez de nouveau le point d'accès.",
    de: 'Die Homematic IP Cloud verweigert Gladys den Zugriff (in der App entfernt?): Kopple den Access Point erneut.',
    es: 'La nube Homematic IP rechaza el acceso de Gladys (¿eliminado en la aplicación?): vuelva a emparejar el punto de acceso.',
  },
  unreachable: {
    en: 'The Homematic IP cloud does not answer. Gladys keeps trying.',
    fr: 'Le cloud Homematic IP ne répond pas. Gladys réessaie.',
    de: 'Die Homematic IP Cloud antwortet nicht. Gladys versucht es weiter.',
    es: 'La nube Homematic IP no responde. Gladys sigue intentándolo.',
  },
  accessPointOffline: {
    en: 'The access point is not connected to the Homematic IP cloud: check its power and its network cable.',
    fr: "Le point d'accès n'est pas connecté au cloud Homematic IP : vérifiez son alimentation et son câble réseau.",
    de: 'Der Access Point ist nicht mit der Homematic IP Cloud verbunden: Prüfe Stromversorgung und Netzwerkkabel.',
    es: 'El punto de acceso no está conectado a la nube Homematic IP: compruebe su alimentación y su cable de red.',
  },
};

// Tooltip of the orange dot on the device badges while the access point is
// offline: the cloud still answers with the last known values.
export const TRANSPORT_TEXT = {
  accessPointOffline: {
    en: 'Access point offline: last known values',
    fr: "Point d'accès hors ligne : dernières valeurs connues",
    de: 'Access Point offline: letzte bekannte Werte',
    es: 'Punto de acceso sin conexión: últimos valores conocidos',
  },
};

// The reports of the configuration buttons and the errors of the commands.
// Functions take the values they show; test/i18n.test.js renders them.
export const MESSAGES = {
  en: {
    noAccessPoint: 'Type the SGTIN of the access point in the field above and save first.',
    invalidAccessPoint: CONNECTION_TEXT.invalidAccessPoint.en,
    requestSent:
      'Request sent. Now press the blue button on top of the access point, then click "I pressed the button".',
    requestRefused: (detail) =>
      `The Homematic IP cloud refused the request (${detail}). Check the SGTIN and, if your access point has one, the PIN.`,
    noPairing: 'Click "Start pairing" first.',
    notAcknowledged:
      'The access point has not confirmed yet: press its blue button, then click "I pressed the button" again.',
    paired: (devices, rooms) =>
      `Paired: ${devices} device(s), ${rooms} room(s). Open the Discovery tab to add them to Gladys.`,
    pairingFailed: (detail) => `The pairing failed (${detail}). Start it again.`,
    refreshed: (devices, rooms) => `Read again: ${devices} device(s), ${rooms} room(s).`,
    notPaired: CONNECTION_TEXT.notPaired.en,
    cloudFailed: (detail) => `The Homematic IP cloud did not take the command (${detail}).`,
    busy: 'Too many Homematic IP commands in a row: the cloud allows about one every 8 seconds after ten. Try again.',
    unknownDevice: 'This device is not in the Homematic IP home any more.',
    readOnly: 'This value can only be read.',
    alarmOff:
      'Changing the alarm from Gladys is disabled in the configuration of the integration ("Alarm control").',
    disarmOff:
      'Disarming the alarm from Gladys is disabled in the configuration of the integration ("Alarm control").',
    noAlarm: 'This home has no alarm system.',
    alarmBlocked: (list) => `The alarm did not arm: ${list}.`,
    noHeating: 'This home has no heating managed by Homematic IP.',
  },
  fr: {
    noAccessPoint:
      "Saisissez d'abord le SGTIN du point d'accès dans le champ ci-dessus, puis enregistrez.",
    invalidAccessPoint: CONNECTION_TEXT.invalidAccessPoint.fr,
    requestSent:
      "Demande envoyée. Appuyez maintenant sur le bouton bleu sur le dessus du point d'accès, puis cliquez sur « J'ai appuyé sur le bouton ».",
    requestRefused: (detail) =>
      `Le cloud Homematic IP a refusé la demande (${detail}). Vérifiez le SGTIN et, si votre point d'accès en a un, le code PIN.`,
    noPairing: "Cliquez d'abord sur « Démarrer l'appairage ».",
    notAcknowledged:
      "Le point d'accès n'a pas encore confirmé : appuyez sur son bouton bleu, puis cliquez de nouveau sur « J'ai appuyé sur le bouton ».",
    paired: (devices, rooms) =>
      `Appairé : ${devices} appareil(s), ${rooms} pièce(s). Ouvrez l'onglet Découverte pour les ajouter à Gladys.`,
    pairingFailed: (detail) => `L'appairage a échoué (${detail}). Recommencez.`,
    refreshed: (devices, rooms) => `Relu : ${devices} appareil(s), ${rooms} pièce(s).`,
    notPaired: CONNECTION_TEXT.notPaired.fr,
    cloudFailed: (detail) => `Le cloud Homematic IP n'a pas pris la commande (${detail}).`,
    busy: 'Trop de commandes Homematic IP à la suite : le cloud en accepte environ une toutes les 8 secondes après dix. Réessayez.',
    unknownDevice: "Cet appareil n'est plus dans la maison Homematic IP.",
    readOnly: 'Cette valeur se lit seulement.',
    alarmOff:
      "Modifier l'alarme depuis Gladys est désactivé dans la configuration de l'intégration (« Pilotage de l'alarme »).",
    disarmOff:
      "Désarmer l'alarme depuis Gladys est désactivé dans la configuration de l'intégration (« Pilotage de l'alarme »).",
    noAlarm: "Cette maison n'a pas de système d'alarme.",
    alarmBlocked: (list) => `L'alarme ne s'est pas armée : ${list}.`,
    noHeating: "Cette maison n'a pas de chauffage géré par Homematic IP.",
  },
  de: {
    noAccessPoint: 'Gib zuerst die SGTIN des Access Points in das Feld oben ein und speichere.',
    invalidAccessPoint: CONNECTION_TEXT.invalidAccessPoint.de,
    requestSent:
      'Anfrage gesendet. Drücke jetzt die blaue Taste oben auf dem Access Point und klicke dann auf „Ich habe die Taste gedrückt“.',
    requestRefused: (detail) =>
      `Die Homematic IP Cloud hat die Anfrage abgelehnt (${detail}). Prüfe die SGTIN und, falls dein Access Point eine hat, die PIN.`,
    noPairing: 'Klicke zuerst auf „Kopplung starten“.',
    notAcknowledged:
      'Der Access Point hat noch nicht bestätigt: Drücke seine blaue Taste und klicke dann erneut auf „Ich habe die Taste gedrückt“.',
    paired: (devices, rooms) =>
      `Gekoppelt: ${devices} Gerät(e), ${rooms} Raum/Räume. Öffne den Tab „Entdecken“, um sie zu Gladys hinzuzufügen.`,
    pairingFailed: (detail) => `Die Kopplung ist fehlgeschlagen (${detail}). Starte sie erneut.`,
    refreshed: (devices, rooms) => `Neu gelesen: ${devices} Gerät(e), ${rooms} Raum/Räume.`,
    notPaired: CONNECTION_TEXT.notPaired.de,
    cloudFailed: (detail) => `Die Homematic IP Cloud hat den Befehl nicht angenommen (${detail}).`,
    busy: 'Zu viele Homematic IP Befehle hintereinander: Die Cloud nimmt nach zehn etwa einen alle 8 Sekunden an. Versuche es erneut.',
    unknownDevice: 'Dieses Gerät ist nicht mehr im Homematic IP Zuhause.',
    readOnly: 'Dieser Wert kann nur gelesen werden.',
    alarmOff:
      'Das Ändern der Alarmanlage aus Gladys ist in der Konfiguration der Integration deaktiviert („Steuerung der Alarmanlage“).',
    disarmOff:
      'Das Unscharfschalten der Alarmanlage aus Gladys ist in der Konfiguration der Integration deaktiviert („Steuerung der Alarmanlage“).',
    noAlarm: 'Dieses Zuhause hat keine Alarmanlage.',
    alarmBlocked: (list) => `Die Alarmanlage wurde nicht scharf geschaltet: ${list}.`,
    noHeating: 'Dieses Zuhause hat keine von Homematic IP gesteuerte Heizung.',
  },
  es: {
    noAccessPoint:
      'Introduzca primero el SGTIN del punto de acceso en el campo de arriba y guarde.',
    invalidAccessPoint: CONNECTION_TEXT.invalidAccessPoint.es,
    requestSent:
      'Solicitud enviada. Pulse ahora el botón azul de la parte superior del punto de acceso y luego haga clic en «He pulsado el botón».',
    requestRefused: (detail) =>
      `La nube Homematic IP ha rechazado la solicitud (${detail}). Compruebe el SGTIN y, si su punto de acceso tiene uno, el PIN.`,
    noPairing: 'Haga clic primero en «Iniciar el emparejamiento».',
    notAcknowledged:
      'El punto de acceso aún no ha confirmado: pulse su botón azul y vuelva a hacer clic en «He pulsado el botón».',
    paired: (devices, rooms) =>
      `Emparejado: ${devices} dispositivo(s), ${rooms} habitación(es). Abra la pestaña Descubrir para añadirlos a Gladys.`,
    pairingFailed: (detail) => `El emparejamiento ha fallado (${detail}). Vuelva a empezar.`,
    refreshed: (devices, rooms) =>
      `Leído de nuevo: ${devices} dispositivo(s), ${rooms} habitación(es).`,
    notPaired: CONNECTION_TEXT.notPaired.es,
    cloudFailed: (detail) => `La nube Homematic IP no ha aceptado el comando (${detail}).`,
    busy: 'Demasiados comandos Homematic IP seguidos: la nube acepta uno cada 8 segundos aproximadamente después de diez. Vuelva a intentarlo.',
    unknownDevice: 'Este dispositivo ya no está en la casa Homematic IP.',
    readOnly: 'Este valor solo se puede leer.',
    alarmOff:
      'Modificar la alarma desde Gladys está desactivado en la configuración de la integración («Control de la alarma»).',
    disarmOff:
      'Desarmar la alarma desde Gladys está desactivado en la configuración de la integración («Control de la alarma»).',
    noAlarm: 'Esta casa no tiene sistema de alarma.',
    alarmBlocked: (list) => `La alarma no se ha armado: ${list}.`,
    noHeating: 'Esta casa no tiene calefacción gestionada por Homematic IP.',
  },
};

/** The message table of a language (French by default, like the config). */
export const messagesFor = (language) => MESSAGES[language] ?? MESSAGES.fr;

/** One message in the four languages, for the action reports. */
export function allLanguages(key, ...args) {
  return Object.fromEntries(
    Object.entries(MESSAGES).map(([language, table]) => {
      const entry = table[key];
      return [language, typeof entry === 'function' ? entry(...args) : entry];
    }),
  );
}

/** An error whose message the user reads (action report, command failure). */
export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}
