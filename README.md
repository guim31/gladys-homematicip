# Homematic IP for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[Homematic IP](https://homematic-ip.com) (eQ-3): thermostats and heating
rooms, contacts, sensors, plugs, dimmers, shutters, remote controls and the
alarm system, through the Homematic IP cloud of the access point (HmIP-HAP),
the way the official app reaches them.

> **Developed without the hardware: feedback welcome.** Everything was built
> from the public protocol and tested against recorded cloud answers served by
> a simulated cloud, not against a real access point. Please report what works
> and what does not on the [Gladys forum](https://community.gladysassistant.com)
> or in the [issues](https://github.com/guim31/gladys-homematicip/issues).

## Features

- **Guided pairing** from the Configuration screen: type the SGTIN printed
  under the access point, click **Start pairing**, press the blue button of
  the access point, click **I pressed the button**. The token stays in the
  integration's `/data` volume.
- **Live**: the integration follows the event stream of the cloud, so a change
  made in the app, on a wall switch or by a sensor shows in Gladys at once.
- **One Gladys device per Homematic IP device**, its features built from its
  functional channels whatever the model: temperature, humidity, CO2,
  illuminance, wind, rain, opening (window, door, handle), motion, presence,
  smoke, water, switch with power and energy, dimmer, shutter and blind
  position with open/close/stop, buttons (short and long presses), low battery,
  tamper.
- **One device per heating room**: temperature, humidity, set point, mode
  (automatic, manual, eco), boost, window, heating demand.
- **One device for the home**: eco mode (absence), alarm mode, alarm.
- **Alarm control is opt-in**: read only by default; arm only, or arm and
  disarm, when allowed in the configuration.
- **Scene trigger** _Homematic IP alarm triggered_, with the sensor and the
  cause (intrusion, smoke, water, sabotage).
- **Scene actions**: eco mode for a number of hours, vacation mode, end of
  either, alarm mode (with the sensors that kept it from arming).
- **Dashboard widget** _Homematic IP heating_: every room at a glance, the
  outside temperature, the eco mode in one tap.
- English, French, German and Spanish, in the interface, the device names and
  the [documentation](docs/en.md) ([fr](docs/fr.md), [de](docs/de.md),
  [es](docs/es.md)).

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- A Homematic IP access point (HmIP-HAP, or HmIP-DRAP) set up in the Homematic
  IP app, and its SGTIN.
- Internet access for Gladys. The Home Control Unit (HCU) and its local
  Connect API are not supported.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter
   `https://github.com/guim31/gladys-homematicip` (or install **Homematic IP**
   from the catalog once it is listed).
2. In **Configuration**, type the SGTIN of the access point and save, click
   **Start pairing**, press the blue button of the access point, then click
   **I pressed the button**.
3. Add the devices from the **Discovery** tab.

The [documentation](docs/en.md) details every feature, the widget, the
trigger, the actions, scene examples, the cloud limits and troubleshooting.

## How it works

- **Hosts**: `POST https://lookup.homematic.com:48335/getHost` gives the REST
  and WebSocket hosts of the access point. Every call carries
  `ACCESSPOINT-ID` (the SGTIN), `CLIENTAUTH` (a SHA-512 derived from it, the
  same for every client of the protocol), `VERSION: 12` and, once paired,
  `AUTHTOKEN`.
- **Pairing**: `auth/connectionRequest` (with the `PIN` header when one is
  set), the press on the blue button, `auth/isRequestAcknowledged`,
  `auth/requestAuthToken`, `auth/confirmAuthToken`.
- **Push**: one WebSocket on the host of the lookup, with the same headers;
  every message carries the complete new version of what changed (a device, a
  group, the home) or a channel event (a key press). It reopens with a growing
  delay (10 s to 10 min), and the hosts are looked up again after three
  failures in a row.
- **Reading**: `home/getCurrentState` at start, when the stream comes back,
  and every 30 minutes (every 5 minutes while the stream is down), by the
  integration's own timer: the devices are published with
  `should_poll: false` (the Gladys scheduler does not poll external devices
  reliably, GladysAssistant/Gladys#3198). Only the values that changed are
  sent, for the devices added to Gladys, plus a heartbeat every 6 hours.
- **Commands**: `device/control/*` (switch, dim level, shutter level, stop),
  `group/heating/*` (set point, control mode, boost), `home/heating/*` (eco
  mode, vacation), `home/security/*` (alarm zones). At most 10 calls at once,
  then one every 8 seconds, the pace of the reference client.
- `scripts/probe.mjs` checks the client against a real access point from a
  machine with network access (read only; it prints counts and types, never a
  token or a label).

## Checked, and what was not

Checked:

- a recorded home of 46 devices (from the Home Assistant tests) and its rooms
  and alarm, against the rules of the Gladys core (feature couples, bounds,
  units, poll frequencies, option values) in the four languages;
- the whole integration against the fake Gladys of the SDK and a simulated
  cloud (REST and event stream): pairing, discovery, states, commands, key
  presses, alarm policy and trigger, eco mode and vacation, widget, revoked
  token, unreachable cloud, offline access point, logs;
- the manifest with the store validator.

Not checked, for want of hardware, of an account or of a Gladys instance:

- the real cloud: the lookup, the pairing (the blue button, the PIN), the
  error codes, the event stream over time, the throttling;
- the key presses of each model (the cloud only reports some);
- the alarm on a real panel (zone names, activation problems);
- the rendering of the widget and of the scene cards in the Gladys interface.

## Limitations

- Cloud only: no Internet, no control.
- Not mapped in this version: door locks, sirens, floor heating actuators,
  energy sensor interfaces (HmIP-ESI), RGB lights, garage door modules, blind
  slats, heating profiles, cooling.
- The alarm trigger fires on the home alarm reported by the cloud; an alarm
  already ringing when the integration starts does not fire it.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the fake Gladys of the SDK
(`@gladysassistant/integration-sdk/testing`) and a simulated cloud
(`test/helpers/fakeCloud.js`): no network. Project rules for contributors and
coding assistants: [CLAUDE.md](CLAUDE.md).

Releases go through **Actions → Release** (it bumps the versions, the
changelog and the image tag).

## Credits

- The [Home Assistant Homematic IP Cloud integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/homematicip_cloud)
  (Apache License 2.0, © Home Assistant contributors): the entities exposed,
  and the recorded home of its tests, the source of `test/fixtures/hmip`
  (anonymized subset).
- [homematicip-rest-api](https://github.com/hahn-th/homematicip-rest-api)
  (GPL-3.0, © Thomas Hahn and contributors): read to understand
  the protocol; no code or file copied.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js).

## Disclaimer

This project is not affiliated with, endorsed by or connected to eQ-3 AG.
Homematic IP is a trademark of eQ-3 AG.

## License

[Apache License 2.0](LICENSE).
