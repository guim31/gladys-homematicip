# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Homematic IP (eQ-3) devices in Gladys through the Homematic IP cloud of the
  access point (HmIP-HAP): a guided pairing from the configuration screen
  ("Start pairing", a press on the blue button, "I pressed the button").
- Live updates from the cloud event stream, and a full read every 30 minutes
  (every 5 minutes while the stream is down).
- Radiator and wall thermostats, climate, CO2, light and weather sensors,
  window and door contacts and handles, motion, presence, smoke and water
  sensors, plugs and switch actuators with their power and energy, dimmers,
  shutters, blinds and sun shading, wall switches and remote controls (key
  presses), low battery and tamper.
- One device per heating room: temperature, humidity, set point, mode
  (automatic, manual, eco), boost, window, heating demand.
- One device for the home: eco mode (absence), alarm mode and alarm.
- The alarm can be armed or disarmed from Gladys only when allowed in the
  configuration ("Alarm control", read only by default).
- Scene trigger "Homematic IP alarm triggered", with the sensor and the cause.
- Scene actions: eco mode for a number of hours, vacation mode, end of either,
  alarm mode (with the sensors that blocked it).
- Dashboard widget "Homematic IP heating": every room at a glance, the outside
  temperature, the eco mode in one tap.
- Feature names, messages, widget and documentation in English, French,
  German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-homematicip/commits/main
