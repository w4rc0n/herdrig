// Rig-owned viewer grids. Only Herdr's public commands, terminal labels and live lists are used.
import { isValidSessionName, isLoopbackDaemonUrl, tmuxServerArgsFrom, serverArgsRefusal, base64EncodeUtf8 } from "./rig-lib.js";

const ROLE = "rig-grid";
const get = (host, key) => typeof host[key] === "function" ? host[key]() ?? [] : host[key] ?? [];
const labels = (t) => t?.labels ?? {};
const addr = (t) => t?.address ?? t?.terminal;
const origin = (config) => String(config?.daemonUrl ?? "").replace(/\/$/, "");
const belongs = (t, rig, url) => labels(t)["herdr-openrig.space"] === "1"
  && labels(t)["herdr-openrig.rig"] === rig.name && labels(t)["herdr-openrig.origin"] === url;

export function ownedRigSpace(host, rig, config) {
  const ids = new Set(get(host, "terminals").filter((t) => belongs(t, rig, origin(config))).map((t) => labels(t)["herdr.space"]));
  return get(host, "spaces").find((s) => !s.machine && ids.has(s.id)) ?? null;
}

export function rigGridPlan(rig, padPath, { selfHostId, viewerPath, openrigHome } = {}) {
  const local = (host) => !host || host === "local" || host === selfHostId;
  if (!selfHostId && (rig.host && rig.host !== "local" || (rig.pods ?? []).some((p) => p.seats?.some((s) => s.host && s.host !== "local")))) {
    throw new Error("Couldn't confirm this machine: OpenRig didn't report its own host ID. Refresh before opening a rig space.");
  }
  if (!local(rig.host)) throw new Error("This rig's seats run on another machine; rig spaces need their tmux here.");
  const seats = (rig.pods ?? []).flatMap((p) => p.seats ?? []).filter((s) => !["stopped", "departed", "failed", "starting"].includes(s.status));
  const tiles = seats.map((s) => {
    if (!local(s.host)) throw new Error("This rig's seats run on another machine; rig spaces need their tmux here.");
    if (s.native) throw new Error("This grid needs tmux seats on this machine; use Attach for native Herdr seats.");
    if (!isValidSessionName(s.session)) throw new Error("A grid seat has no valid session address.");
    const flags = tmuxServerArgsFrom(s.tmuxAttachCommand, s.session);
    if (!flags || !s.tmuxAttachCommand) throw new Error(serverArgsRefusal(s.tmuxAttachCommand, s.session));
    const argv = viewerPath ? ["node", viewerPath, base64EncodeUtf8(JSON.stringify({ session: s.session, serverArgs: flags, openrigHome }))]
      : ["env", "-u", "TMUX", "TERM=xterm-256color", "tmux", ...flags, "attach-session", "-t", `=${s.session}`];
    return { session: s.session, argv };
  });
  const cols = tiles.length ? Math.ceil(Math.sqrt(tiles.length)) : 0, rows = cols ? Math.ceil(tiles.length / cols) : 0;
  if (tiles.length < cols * rows && !padPath) throw new Error("The installed grid padding program is missing.");
  while (tiles.length < cols * rows) tiles.push({ session: "", argv: ["node", padPath] });
  return { tiles, cols, rows, signature: JSON.stringify(tiles) };
}

export class RigSpaces {
  constructor(host) { this.host = host; this.done = new Map(); this.pending = new Map(); }
  sync(rig, config, { explicit = false } = {}) {
    const key = `${origin(config)}|${rig.name}`;
    const job = (this.pending.get(key) ?? Promise.resolve()).catch(() => {}).then(() => this.update(rig, config, explicit, key));
    this.pending.set(key, job);
    return job.finally(() => { if (this.pending.get(key) === job) this.pending.delete(key); });
  }
  async update(rig, config, explicit, key) {
    const host = this.host, url = origin(config);
    let space = ownedRigSpace(host, rig, config);
    // A closed space is never recreated by polling, even when membership changes.
    if (!space && !explicit) { this.done.delete(key); return { ok: true, closed: true }; }
    if (!isLoopbackDaemonUrl(url)) return { ok: false, reason: "Rig spaces need a local OpenRig daemon." };
    const required = ["pane.split", "pane.close", "layout.resize", "space.rename", "space.select", "tab.rename", "tab.select"];
    const available = get(host, "commands");
    const missing = required.filter((name) => !available.some((c) => c.name === name));
    if (missing.length) return { ok: false, reason: `Herdr lacks the rig-space commands: ${missing.join(", ")}.` };
    const supports = (command, arg) => available.find((c) => c.name === command)?.args?.some((a) => a.name === arg);
    if (!supports("layout.resize", "weight") || !supports("pane.split", "pane") || !supports("pane.split", "argv")) {
      return { ok: false, reason: "This Herdr version lacks weighted resizing or targeted viewer splits; rig spaces need those public capabilities." };
    }
    let plan;
    try { plan = rigGridPlan(rig, host.padPath, { selfHostId: host.selfHostId?.(), viewerPath: host.viewerPath, openrigHome: config.openrigHome }); } catch (e) { return { ok: false, reason: e.message }; }
    const own = (t) => belongs(t, rig, url) && labels(t)["herdr-openrig.role"] === ROLE
      && labels(t)["herdr-openrig.viewer-argv"] === JSON.stringify(t.argv);
    const terms = () => get(host, "terminals");
    const panes = () => get(host, "panes");
    const gridTerms = () => terms().filter((t) => own(t) && labels(t)["herdr.space"] === space?.id);
    let tab = gridTerms().map((t) => labels(t)["herdr.tab"]).find((id) => space?.tabs?.some((t) => t.id === id));
    const tabPanes = () => panes().filter((p) => p.tab === tab);
    const focused = () => get(host, "spaces").some((s) => s.active && s.tabs?.some((t) => t.id === tab && t.active))
      || tabPanes().some((p) => p.focused || (p.terminal && p.terminal === host.focused?.()?.terminal));
    const guard = () => { if (!explicit && focused()) throw new Error("deferred-focus"); };
    const waitFor = async (test, what) => {
      for (let n = 0; n < 60; n++) { const value = test(); if (value) return value; if (!host.wait) break; await host.wait(100); }
      throw new Error(`Herdr did not confirm ${what}; the grid was not completed.`);
    };
    const hc = async (args) => {
      const res = await host.hc(args);
      if (res?.code !== 0) throw new Error(res?.stderr || "Herdr core command failed.");
      return res.stdout;
    };
    const mark = async (terminal, tile, argv) => hc(["label", terminal,
      "herdr-openrig.space=1", `herdr-openrig.rig=${rig.name}`, `herdr-openrig.origin=${url}`,
      `herdr-openrig.role=${ROLE}`, `herdr-openrig.seat=${tile.session}`, `herdr-openrig.viewer-argv=${JSON.stringify(argv)}`]);
    const close = async (p) => {
      guard();
      // Re-check ownership against live labels immediately before every destructive operation.
      if (!terms().some((t) => addr(t) === p.terminal && own(t))) throw new Error("A grid pane is no longer owned by this mod; it was left alone.");
      host.run("pane.close", { pane: p.pane });
      await waitFor(() => !panes().some((n) => n.pane === p.pane), "pane close");
    };
    try {
      if (tabPanes().some((p) => !terms().some((t) => addr(t) === p.terminal && own(t)))) throw new Error("The grid tab contains a personal pane; it was left alone.");
      if (!plan.tiles.length) {
        for (const p of tabPanes()) await close(p);
        this.done.delete(key);
        return { ok: true, empty: true };
      }
      const stamp = () => `${plan.signature}|${tabPanes().map((p) => p.pane).sort().join(",")}`;
      if (tab && this.done.get(key) === stamp()) {
        if (explicit) { host.run("space.select", { id: space.id }); host.run("tab.select", { id: tab }); }
        return { ok: true, reused: true, space: space.id, tab };
      }
      guard();
      const first = plan.tiles[0];
      const sameViewer = (t) => {
        const argv = t.argv?.[0] === "env" && t.argv?.[1]?.startsWith("HERDR_OPENRIG_GRID_TILE=") ? t.argv.slice(2) : t.argv;
        return JSON.stringify(argv) === JSON.stringify(first.argv);
      };
      let anchor = tabPanes().find((p) => terms().some((t) => addr(t) === p.terminal && own(t) && labels(t)["herdr-openrig.seat"] === first.session && sameViewer(t)));
      if (!anchor) {
        const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const spaceId = space?.id ?? `sp-openrig-${nonce}`;
        tab ??= `tb-openrig-${nonce}`;
        const out = await hc(["run", "--bg", "--json", "--no-parent",
          "--label", `herdr.space=${spaceId}`, "--label", `herdr.tab=${tab}`,
          "--label", "herdr-openrig.space=1", "--label", `herdr-openrig.rig=${rig.name}`, "--label", `herdr-openrig.origin=${url}`,
          "--label", `herdr-openrig.role=${ROLE}`, "--label", `herdr-openrig.seat=${first.session}`,
          "--label", `herdr-openrig.viewer-argv=${JSON.stringify(first.argv)}`, "--", ...first.argv]);
        const terminal = JSON.parse(out)?.address;
        if (!terminal) throw new Error("Herdr returned no viewer terminal address.");
        anchor = await waitFor(() => panes().find((p) => p.terminal === terminal && p.tab === tab), "viewer adoption");
        const created = !space;
        space = get(host, "spaces").find((s) => s.id === spaceId);
        if (!space) throw new Error("Herdr returned no rig space.");
        if (created) {
          const title = String(rig.name ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 80).trim() || "Rig";
          let name = title, suffix = 2;
          while (get(host, "spaces").some((s) => s.id !== spaceId && s.name === name)) name = `${title} ${suffix++}`;
          host.run("space.rename", { id: spaceId, name });
        }
      }
      // Collapse to one owned viewer, then rebuild columns before rows. No internal container IDs are needed.
      for (const p of tabPanes().filter((p) => p.pane !== anchor.pane)) await close(p);
      const split = async (parent, direction, tile) => {
        guard(); const before = new Set(panes().map((p) => p.pane));
        if (!terms().some((t) => addr(t) === parent.terminal && own(t))) throw new Error("The split target is not a mod-owned viewer.");
        // Correlate the new pane by its exact argv, not merely by arrival order alongside personal activity.
        const argv = ["env", `HERDR_OPENRIG_GRID_TILE=${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, ...tile.argv];
        host.run("pane.split", { pane: parent.pane, direction, argv });
        const pane = await waitFor(() => panes().find((p) => p.tab === tab && !before.has(p.pane)
          && terms().some((t) => addr(t) === p.terminal && JSON.stringify(t.argv) === JSON.stringify(argv))), "pane split");
        if (!pane.terminal) throw new Error("Herdr split did not create a viewer terminal.");
        await mark(pane.terminal, tile, argv);
        await waitFor(() => terms().some((t) => addr(t) === pane.terminal && own(t)), "viewer labels");
        return pane;
      };
      const columns = [anchor];
      for (let col = 1; col < plan.cols; col++) columns.push(await split(columns.at(-1), "right", plan.tiles[col]));
      const equalise = (p) => {
        guard();
        if (!terms().some((t) => addr(t) === p.terminal && own(t))) throw new Error("A personal pane was left unchanged.");
        host.run("layout.resize", { id: p.pane, weight: 1 });
      };
      for (const p of columns) equalise(p);
      for (let col = 0; col < plan.cols; col++) {
        let parent = columns[col];
        for (let row = 1; row < plan.rows; row++) parent = await split(parent, "down", plan.tiles[row * plan.cols + col]);
      }
      for (const p of tabPanes()) equalise(p);
      host.run("tab.rename", { id: tab, name: "Seats" });
      this.done.set(key, stamp());
      if (explicit) { host.run("space.select", { id: space.id }); host.run("tab.select", { id: tab }); }
      return { ok: true, space: space.id, tab, cols: plan.cols, rows: plan.rows };
    } catch (e) {
      this.done.delete(key);
      return e.message === "deferred-focus" ? { ok: true, deferred: true } : { ok: false, reason: e.message };
    }
  }
}
