# Herdrig

Version: v0.4.1

**OpenRig Mod for Herdr**

> **EARLY DEVELOPMENT** — This mod is in early development. Contributions are welcome.

![Herdrig](preview.png)

Herdrig puts [OpenRig](https://github.com/mvschwarz/openrig) inside the `herdr` window: your rigs, their seats and the
decisions waiting for you, in a sidebar beside your own tabs. Select a row, then double-click or press Enter to open its page, and you can
act from there (answer a request, message a seat, attach to it) without leaving Herdr.

## Features

- **Seat now lines:** visible screen narration and tool status beside rig rows, with selectable cleaned lines on
  hover and on the seat page. Drafts, incoming messages and terminal seats are excluded; ambiguous input stays blank.
- **Calm status marks:** working dots stay visible without continuous animation; a seat starting work or a new
  request gets one brief pulse. Action spinners still show work in progress.

- **Archive and Restore:** hide a rig reversibly from its menu, then restore it stopped from Topology's Archived list.
- **Plain seat activity:** readable status and context, with copyable raw details in **How OpenRig knows**.
- **Sidebar tree** with six branches: **Topology** (host, rig, pod, seat, helper), **Specs**, **Scopes**,
  **Terminals**, **Needs** and **System**, each seat with its status and context usage.
- **The Page:** the full view of whatever you select. A rig, a seat card, a spec you can edit in place, or the files
  OpenRig reports.
- **Rig graphs:** saved rig specs start with a static Graph/YAML view and Launch. Running rigs show pod and seat
  routes, hover/keyboard selection and native handoff motion. Dense edges group by pod; the text Edges list stays
  available. Saved previews come from your connected OpenRig server, including a host-to-box tunnel.
- **Needs answered in place:** human requests render as Decision Cards (Approve, Deny with a reason, answer the
  questions, or reply in your own words), with quiet hours and modes in **System → People**.
- **Command palette** on `ctrl-alt-r`.
- **Right-click menus** on seats (send, queue, pause or resume, change model), Needs requests, specs and slices.
- **Attach** opens a live seat in its own tab, and Herdr's **Agents** section shows its status.
- **Follows your space:** the sidebar folds outside OpenRig's spaces, keeping Needs you and search visible. Click its
  header to expand until you change spaces. Pages go to their rig's existing space or the **OpenRig** home, which
  also holds the local TUI. Personal spaces stay free of new Rig tabs. Existing tabs offer **Move** or **Keep here**.
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

## Worker views (OpenRig 0.7.12 and later)

[The herdr-app provider](https://github.com/mvschwarz/openrig/pull/2744) opens worker
views in the Herdr window on the **same machine as OpenRig**. Worker view, **Show in worker view**, and saved-view
preview + Open turn on when that provider reports the window available. Herdrig checks availability and supported
verbs, not the version number alone. If Herdr runs on your computer and OpenRig runs on a box through a tunnel,
these worker views cannot reach your window: **Herdr must run on the same machine as OpenRig**.
Herdrig can't close those provider views yet: close one with `rig terminal close <view-id>` or close its Herdr tab.
With a custom app home, give the close command the same `--app-home` as the open command.
Opening a worker view can leave a progress spinner visible after the view has opened. Inspect the opened view
before retrying: another Open creates another view.
Attach, the TUI tab and Herdrig's own Seats grids use their separate connection paths.

The same release includes [pull-mode relay delivery](https://github.com/mvschwarz/openrig/pull/2844),
[unsetting a person's gateway binding](https://github.com/mvschwarz/openrig/pull/2812), and
[typing into writable tiles on older tmux](https://github.com/mvschwarz/openrig/pull/2821).
[Quoting session names in attach commands](https://github.com/mvschwarz/openrig/pull/2971) is not included.
Local Seats tiles fit their panes when alone and yield sizing to Attach when it is open (tmux 3.2+).
Sizing settles within about five seconds; a quicker Seats revisit can briefly resize Attach.
Remote Seats still use plain tmux sizing; visiting them can resize an Attach view until it receives input.

**Not yet in OpenRig:** Follow and auto-prune for herdr-app, custom worker-view grids (`--grid`/`--replace`), and
cell editing (`close --cell`) are not supported on upstream main yet. Those controls stay greyed out until OpenRig
adds the required support. The provider release alone will not enable them; no release date is promised.

## Known limitations

- **Provider worker views need one machine.** OpenRig's own provider must reach a Herdr window on its machine.
  Herdrig's configured remote-machine Attach and Seats grids are separate features.
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
