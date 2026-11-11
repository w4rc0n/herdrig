# Herdrig

Version: v0.3.0

**OpenRig Mod for Herdr**

> **EARLY DEVELOPMENT** — This mod is in early development. Contributions are welcome.

![Herdrig](preview.png)

Herdrig puts [OpenRig](https://github.com/mvschwarz/openrig) inside the `herdr` window: your rigs, their seats and the
decisions waiting for you, in a sidebar beside your own tabs. Every row opens a full page in its own tab, and you can
act from there (answer a request, message a seat, attach to it) without leaving Herdr.

## Features

- **Sidebar tree** with six branches: **Topology** (host, rig, pod, seat, helper), **Specs**, **Scopes**,
  **Terminals**, **Needs** and **System**, each seat with its status and context usage.
- **The Page:** the full view of whatever you select. A rig, a seat card, a spec you can edit in place, or the files
  OpenRig reports.
- **Needs answered in place:** human requests render as Decision Cards (Approve, Deny with a reason, answer the
  questions, or reply in your own words), with quiet hours and modes in **System → People**.
- **Command palette** on `ctrl-alt-r`.
- **Right-click menus** on seats (send, queue, pause or resume, change model), Needs requests, specs and slices.
- **Attach** opens a live seat in its own tab, and Herdr's **Agents** section shows its status.
- **Works with or without OpenRig running:** when OpenRig is missing, stopped or unhealthy, the sidebar says so in
  plain words, with the fix (for example **Start OpenRig**). Controls your OpenRig version doesn't support are greyed
  out, each with its reason.

## Install

In Herdr, tell your agent:

```
Read ~/.config/herdr-app/AGENTS.md, then add this mod: herdr.dev/mods/w4rc0n/herdrig
```

Or give [`RECIPE.md`](RECIPE.md) to your `herdr` agent. It checks for OpenRig (and installs it with OpenRig's own guide
only on your yes), copies the four mod folders (`mods/rig`, `mods/rig-view`, `mods/rig-palette`, `mods/rig-menu`)
into `<appHome>/mods/`, merges `ctrl-alt-r` into `keys.json`, and adds `{ "mod": "rig" }` to your layout after telling
you.

Herdr doesn't review mods: check what your agent runs and which keys it changes.

## Updating

Replace the four folders `rig`, `rig-view`, `rig-palette` and `rig-menu` in `<appHome>/mods/` with the new
release's folders, one at a time. Replace only those named folders; never use `--delete` on the whole mods folder.
Restart herdr-app after all four are copied. Your folds and settings are kept outside those folders.
Check the `Version:` line in the README you copied, or open System and read **Herdrig Version**.

## Requirements

- **Herdr:** `herdr-app` and `hc`.
- **OpenRig:** the `rig` CLI and its local daemon, used exactly as you have it set up (its home, port and sign-in).
  - Decision Cards and browsing: OpenRig `0.7.7` or later.
  - The concurrency guard (`expectedRevision`, which keeps your draft if a request changed while open) and the
    `operationId` retry (**Check and finish**): `0.7.9` or later.
  - On an older OpenRig, the controls it can't support are disabled with their reason; the rest works.

## What it does on your machine

- **Network:** only OpenRig's local address (`127.0.0.1:7433` unless your OpenRig uses another port), over HTTP and SSE.
  It reads live state, and sends a `POST` only when you click an action:
  - a Decision Card act;
  - a usage refresh;
  - spec validation and library sync, when you save a spec or copy one to the library.

  Nothing leaves the machine.
- **Programs:** `rig` (and `rig daemon start` when you click **Start OpenRig**); for Attach, `hc` starts `node` on the
  mod's own `rig-attach-relay.cjs`, which runs `tmux attach-session -t =<session>` directly, with no shell, for a
  session name OpenRig makes; `hc` also opens the TUI tab. For the spec editor, `printenv OPENRIG_HOME` and `realpath`.
- **Files:** it reads `<appHome>/openrig/config.json` (optional: your OpenRig name), `<appHome>/openrig/state.json`,
  and the spec and slice files you open in its viewer. It writes `<appHome>/openrig/state.json` and the user spec files
  you edit and save in its spec editor. Those are only files in this machine's spec folders, with symlinks resolved:
  OpenRig's spec library `<OpenRig home>/specs`, and `workspace.specs_root` from the local `rig`. The home is
  `openrigHome` if you set it, else `OPENRIG_HOME` in Herdr's environment, else `~/.openrig`, so a default install
  edits with no setup. A link out of those folders, or a path only the daemon names, is refused. It reads none of
  OpenRig's own files.

The full list, with every route, is in [`RECIPE.md`](RECIPE.md) under **Built from**.

## Security update

**Update now.** Earlier versions ran the daemon's attach command through a shell. This version starts `tmux` itself,
with no shell, and attaches only to session names OpenRig makes.

Earlier versions' **Copy & edit** for a spec could read a file the OpenRig daemon named on your machine and send it
to the daemon. This version copies only the spec text OpenRig served.

## Waiting on the next OpenRig release

**Turns on with the next OpenRig release:** basic worker-view open and close, **Show in worker view**, and saved-view
previews need the herdr-app provider. It is [merged upstream](https://github.com/mvschwarz/openrig/pull/2744) but is
not in the current OpenRig release, 0.7.11. Update to a release that includes it and these controls turn on
automatically: Herdrig detects support, so no Herdrig update is needed. Check `rig --version` and the control's tooltip.
Attach, the TUI tab and Herdrig's own Seats grids already work.

**Not yet in OpenRig:** Follow and auto-prune for herdr-app, custom worker-view grids (`--grid`/`--replace`), and
cell editing (`close --cell`) are not supported on upstream main yet. Those controls stay greyed out until OpenRig
adds the required support. The provider release alone will not enable them; no release date is promised.

## Known limitations

- **OpenRig and Herdr on one machine.** The mod talks to OpenRig's local address and runs the local `rig`. A Herdr
  window on another machine than its OpenRig isn't supported.
- **With upstream OpenRig's own `herdr-app` provider** serving the window, the four mods work with less chrome: no
  cell-level seat identity, follow countdown or per-view row.
- **Follow and auto-prune** require herdr-app support plus both `--follow` and `--prune-after` in `rig terminal open`.
- **Some actions need your OpenRig name.** Sending, queueing, changing a seat's model, and editing quiet hours or
  modes stay disabled with a hint until `<appHome>/openrig/config.json` names you. Decision Cards work without it.
- **Only `ctrl-alt-r` is bound.** Merge it, and ask before replacing a key you already use.
- **The sidebar wants 260 px.** It's cramped between 160 and 260 px, and becomes a rail of rig chips below 160.
- **The four folders go together.** Copying only some leaves menus and the palette opening nothing. Don't rename them
  without editing the `MOD_IDS` map in each folder's `rig-lib.js` (see **Watch out** in the recipe).

## Contributing

Issues and pull requests are welcome.

## Colors

The Rig panes draw a working seat in your theme's green (`ansi2`). herdr's own lists (its Agents section and tab dots) use herdr's `working` color, yellow in the shipped themes. To make them match, add `"colors": { "working": "ansi2" }` to your layout's root node. It names a theme color, so it works in light and dark.

## License

[MIT](LICENSE) — Copyright (c) 2026 w4rc0n, except the Apache-2.0 derived file below.

## Third-party code

Part of the sidebar's priority view is derived from herdr-app (Apache-2.0), see
[LICENSES/herdr-app-Apache-2.0.txt](LICENSES/herdr-app-Apache-2.0.txt). Its modified code is in `rig-needs-view.js`.
