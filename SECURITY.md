# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration keeps and where:

- **`/data/homematicip.json`**, in the integration's volume (readable by the
  container user only): the SGTIN of the paired access point, the
  authorization token the Homematic IP cloud gave at the pairing, and the
  client ids of that pairing. The token lets anyone who reads it read and
  control the home through the cloud (alarm included); it never appears in the
  configuration, the logs or the messages sent to Gladys. Remove the "Gladys"
  client in the Homematic IP app to revoke it. Deleting the file means pairing
  again.
- **Configuration** (in Gladys): the SGTIN of the access point, its PIN when
  one is set (a `secret` field, used for the pairing only), the language and
  the alarm policy.

The alarm can only be changed from Gladys when the user allowed it in the
configuration ("Alarm control": read only by default, arm only, or arm and
disarm).

Network: HTTPS and secure WebSocket to the Homematic IP cloud
(`lookup.homematic.com` on port 48335, then the hosts it returns), and the
Gladys host API. No inbound connection, nothing on the local network.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Homematic IP cloud, the access point and the devices, and their firmware.
