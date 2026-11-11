# Security Policy

Herdrig is in early development and maintained by one person. This page covers which versions get fixes, how to report a vulnerability privately, and what happens after you do.

## Supported versions

Only the latest release line gets security fixes. Fixes ship as a new release; there are no backports.

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2   | :x:                |

Versions before 0.1.3 have known, fixed vulnerabilities (see [Past security fixes](#past-security-fixes)). If you are on one, update first.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a security problem.**

Report it privately through GitHub: open this repository's **Security** tab and choose **Report a vulnerability**, or go straight to [the private report form](https://github.com/w4rc0n/herdrig/security/advisories/new).

Please include:

- Herdrig version (or commit), Herdr version and OpenRig version
- What an attacker can do, and what they need to do it (for example: a local user, a crafted spec file, or a malicious response from the OpenRig daemon)
- Steps to reproduce, or a proof of concept
- A suggested fix, if you have one

## What to expect

These are targets from a solo maintainer, not guarantees:

| Step | Target |
| ---- | ------ |
| Acknowledgement | Within 7 days |
| Assessment (accepted, declined or need more info) | Within 14 days |
| Status updates | At least every 14 days until resolved |

If the report is accepted, the fix is worked on privately in the GitHub advisory, released as a new version, and the advisory is published with a CVE where one applies. You are credited in the advisory unless you ask not to be.

If it is declined, you get the reason in the advisory thread.

Please keep the details private until a fixed release is out, or 90 days after your report, whichever comes first. If a fix needs longer, we can agree on a new date.

## Scope

In scope: everything in this repository, including the four mods (`mods/rig`, `mods/rig-view`, `mods/rig-palette`, `mods/rig-menu`), `rig-attach-relay.cjs`, and the steps `RECIPE.md` has an agent run.

Herdrig treats data from the OpenRig daemon as untrusted. Reports in these areas are especially welcome:

- Running a shell, or running a program with arguments an attacker controls (Attach, Operator, Start OpenRig)
- Reading or writing a file outside the spec folders the README names, including through symlinks or `..`
- Sending local file contents to the daemon, or any traffic to an address other than OpenRig's local one
- `RECIPE.md` steps that make the agent change more than they say (keys, layout, installs)

Out of scope:

- Vulnerabilities in OpenRig itself (the `rig` CLI or its daemon): report them to OpenRig
- Vulnerabilities in Herdr (`herdr-app`, `hc`) or its mod system: report them to Herdr
- Setups the README lists as unsupported, such as Herdr and OpenRig on different machines
- Attacks that need an attacker who already controls your user account

## Past security fixes

| Version | Fix |
| ------- | --- |
| 0.1.3 | Copy & edit for a spec could read a file the OpenRig daemon named and send it to the daemon. It now copies only the spec text OpenRig served. |
| 0.1.2 | Attach ran the daemon's attach command through a shell. Attach and Operator now start tmux directly and attach only to session names OpenRig makes. |
