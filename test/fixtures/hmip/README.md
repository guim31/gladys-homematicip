# Homematic IP fixtures

`current-state.json` is an answer of `home/getCurrentState`, the full read of
the Homematic IP cloud: the home (its functional homes: heating, security,
light and shadow, weather), the devices with their functional channels, the
groups and the clients.

Source: the recorded home of the Home Assistant Homematic IP Cloud tests,
[`tests/components/homematicip_cloud/fixtures/homematicip_cloud.json`](https://github.com/home-assistant/core/blob/dev/tests/components/homematicip_cloud/fixtures/homematicip_cloud.json)
(Apache License 2.0, © Home Assistant contributors), reduced to 46 devices
covering every channel type the integration maps (and a few it does not: the
access point, a door lock, a siren, a tilt sensor, an external light), with
all the heating, security zone and room groups.

Anonymized: the device and group ids of the source are already made up
(`3014F711...`, `00000000-...`); the location of the home is replaced by
`Example City` at 0.0, 0.0, the client labels by `Example client`. The room
and device labels are the German ones of the source.

The tests change copies of it (`fixtureState()` in `test/helpers/fakeCloud.js`)
rather than keeping variants on disk.
