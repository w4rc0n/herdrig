// Rig-owned viewer grids. Only Herdr's public commands, terminal labels and live lists are used.
import { isValidSessionName, isLoopbackDaemonUrl, tmuxServerArgsFrom, serverArgsRefusal, base64EncodeUtf8 } from "./rig-lib.js";
import { machineId, machineLocalId, remoteFailure } from "./rig-remote.js";

const ROLE = "rig-grid";
const get = (host, key) => typeof host[key] === "function" ? host[key]() ?? [] : host[key] ?? [];
const labels = (t) => t?.labels ?? {};
const addr = (t) => t?.address ?? t?.terminal;
const origin = (config) => String(config?.daemonUrl ?? "").replace(/\/$/, "");
const belongs = (t, rig, url) => labels(t)["herdr-openrig.space"] === "1"
  && labels(t)["herdr-openrig.rig"] === rig.name && labels(t)["herdr-openrig.origin"] === url;
const shell = (t, configured) => Array.isArray(t.argv) && (
  Array.isArray(configured) && configured.length > 0 && JSON.stringify(t.argv) === JSON.stringify(configured)
  || t.argv.length === 1 && /(?:^|\/)(?:sh|bash|dash|zsh|fish|ksh)$/.test(t.argv[0]));
// Exclude volatile presentation labels, but bind consent to every ownership/location label,
// the program, terminal incarnation and pane. A changed tile needs a new confirmation.
const tileSnapshot = (t, p) => ({ terminal: addr(t), pane: p.pane, tab: p.tab,
  argv: [...(t.argv ?? [])], pid: t.pid, created: t.created_ms,
  labels: Object.fromEntries(Object.entries(labels(t)).filter(([k]) => k.startsWith("herdr-openrig.") || k === "herdr.space" || k === "herdr.tab").sort(([a], [b]) => a.localeCompare(b))) });

export function ownedRigSpace(host, rig, config) {
  const machine = config?.daemonMachine || null;
  const ids = new Set(get(host, "terminals").filter((t) => belongs(t, rig, origin(config))
    && (machine ? addr(t)?.startsWith(`${machine}/`) : !addr(t)?.includes("/"))).map((t) => machineId(labels(t)["herdr.space"], machine)));
  return get(host, "spaces").find((s) => (s.machine || null) === machine && ids.has(s.id)) ?? null;
}

/** The sidebar issues consent for one exact dialog; shared-state callers cannot supply their own snapshot. */
export class RebuildConfirmations {
  constructor() { this.requests = new Map(); }
  issue(rigId, recovery) {
    for (const [token, value] of this.requests) if (value.rigId === rigId) this.requests.delete(token);
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    this.requests.set(token, { rigId, recovery: JSON.parse(JSON.stringify(recovery)) }); return token;
  }
  take(request) {
    const value = this.requests.get(request?.token);
    if (!value || value.rigId !== request.rigId) return null;
    this.requests.delete(request.token); return value;
  }
}

export function rigGridPlan(rig, padPath, { selfHostId, viewerPath, openrigHome, remote = false } = {}) {
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
    return { session: s.session, serverArgs: flags, argv };
  });
  const cols = tiles.length ? Math.ceil(Math.sqrt(tiles.length)) : 0, rows = cols ? Math.ceil(tiles.length / cols) : 0;
  if (tiles.length < cols * rows && !padPath && !remote) throw new Error("The installed grid padding program is missing.");
  while (tiles.length < cols * rows) tiles.push({ session: "", argv: remote ? ["sleep", "2147483647"] : ["node", padPath] });
  return { tiles, cols, rows, signature: JSON.stringify(tiles) };
}

/** A loopback URL may be a tunnel. Check the actual local server before creating viewers. */
export async function localGridPreflight(host, plan) {
  const first = plan.tiles.find((tile) => tile.session);
  if (!first) return { ok: true };
  try {
    const result = await host.exec("tmux", [...first.serverArgs, "has-session", "-t", `=${first.session}`]);
    if (result?.code === 0) return { ok: true };
  } catch {}
  return { ok: false, reason: "Couldn't reach this rig's tmux sessions on this machine. If the seats run on another machine, Rig spaces and Attach need a remote connection." };
}

export class RigSpaces {
  constructor(host) { this.host = host; this.done = new Map(); this.pending = new Map(); this.closed = new Set(); this.failures = new Map(); }
  sync(rig, config, { explicit = false, rebuild = null, closeAll = false } = {}) {
    if (config?.daemonMachine !== undefined && config.daemonMachine !== ""
      && (typeof config.daemonMachine !== "string" || !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(config.daemonMachine))) {
      return Promise.resolve({ ok: false, reason: "daemonMachine must name a Herdr machine. No local terminal was started or closed." });
    }
    const key = `${origin(config)}|${config?.daemonMachine || ""}|${rig.name}`;
    const job = (this.pending.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const changedProgram = get(this.host, "terminals").some((t) => belongs(t, rig, origin(config))
        && labels(t)["herdr-openrig.role"] === ROLE && labels(t)["herdr-openrig.viewer-argv"] !== JSON.stringify(t.argv));
      if (!explicit && !closeAll && !changedProgram && this.failures.has(key) && this.ownedPanes(rig, config).length) return this.failures.get(key);
      this.failures.delete(key);
      const result = await (closeAll ? this.closeAll(rig, config, key) : this.update(rig, config, explicit, key, rebuild));
      if (result.closeAvailable && !result.retryable) this.failures.set(key, result);
      return result;
    });
    this.pending.set(key, job);
    return job.finally(() => { if (this.pending.get(key) === job) this.pending.delete(key); });
  }
  ownedPanes(rig, config) {
    const machine = config?.daemonMachine || null;
    const ts = get(this.host, "terminals").filter((t) => machine ? addr(t)?.startsWith(`${machine}/`) : !addr(t)?.includes("/"));
    return get(this.host, "panes").filter((p) => ts.some((t) => addr(t) === p.terminal
      && belongs(t, rig, origin(config)) && labels(t)["herdr-openrig.role"] === ROLE
      && machineId(labels(t)["herdr.tab"], machine) === p.tab
      && get(this.host, "spaces").some((s) => (s.machine || null) === machine && s.id === machineId(labels(t)["herdr.space"], machine) && s.tabs?.some((tab) => tab.id === p.tab))
      && labels(t)["herdr-openrig.viewer-argv"] === JSON.stringify(t.argv)));
  }
  async closeAll(rig, config, key) {
    let closed = 0;
    this.closed.add(key);
    this.done.delete(key);
    for (const pane of this.ownedPanes(rig, config)) {
      if (config?.daemonMachine) {
        const ready = await this.host.prepareRemote?.(config);
        if (!ready?.ok) return { ...ready, ok: false, closeAvailable: true, reason: ready?.reason || "The configured machine is unavailable. No tiles were closed." };
      }
      if (!this.ownedPanes(rig, config).some((p) => p.pane === pane.pane && p.terminal === pane.terminal && p.tab === pane.tab)) continue;
      this.host.run("pane.close", { pane: pane.pane });
      for (let n = 0; n < 60 && get(this.host, "panes").some((p) => p.pane === pane.pane); n++) {
        if (!this.host.wait) break;
        await this.host.wait(100);
      }
      if (get(this.host, "panes").some((p) => p.pane === pane.pane)) return { ok: false, closeAvailable: true, reason: "Herdr did not confirm a tile closed. The remaining tiles were left alone." };
      closed++;
    }
    return { ok: true, closed: true, count: closed };
  }
  async update(rig, config, explicit, key, rebuild) {
    if (this.closed.has(key) && !explicit) return { ok: true, closed: true };
    if (explicit) this.closed.delete(key);
    const host = { ...this.host }, url = origin(config), machine = config?.daemonMachine || null;
    const localId = (id) => machineLocalId(id, machine), qualified = (id) => machineId(id, machine);
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
    let plan, remote;
    try {
      if (machine) {
        if (!host.prepareRemote) throw new Error("Open the Rig sidebar to use the configured Herdr machine. No local terminal was started.");
        remote = await host.prepareRemote(config); if (!remote.ok) return { ...remote, retryable: true, preparationFailed: true };
      }
      plan = rigGridPlan(rig, host.padPath, { selfHostId: remote?.selfHostId ?? host.selfHostId?.(), viewerPath: machine ? null : host.viewerPath, openrigHome: machine ? null : config.openrigHome, remote: !!machine });
      if (machine) for (const tile of plan.tiles.filter((t) => t.session)) {
        const flags = tile.serverArgs;
        const probe = await host.exec("tmux", [...flags, "has-session", "-t", `=${tile.session}`], { on: machine, timeout: 10000 });
        if (probe.code !== 0) throw new Error(`The tmux seat ${tile.session} is unavailable on ${machine}. Check the OpenRig user's tmux socket.`);
      }
    } catch (e) {
      const failure = remoteFailure(e, machine);
      return { ...failure, ...(failure.retryable ? { preparationFailed: true } : { closeAvailable: this.ownedPanes(rig, config).length > 0 }) };
    }
    const claimed = (t) => belongs(t, rig, url) && labels(t)["herdr-openrig.role"] === ROLE && !!labels(t)["herdr-openrig.viewer-argv"];
    const own = (t) => claimed(t)
      && labels(t)["herdr-openrig.viewer-argv"] === JSON.stringify(t.argv);
    const terms = () => get(host, "terminals").filter((t) => machine ? addr(t)?.startsWith(`${machine}/`) : !addr(t)?.includes("/"));
    const panes = () => get(host, "panes");
    const gridTerms = () => terms().filter((t) => claimed(t) && qualified(labels(t)["herdr.space"]) === space?.id);
    let tab = gridTerms().map((t) => qualified(labels(t)["herdr.tab"])).find((id) => space?.tabs?.some((t) => t.id === id));
    const tabPanes = () => panes().filter((p) => p.tab === tab);
    const snapshot = () => tabPanes().map((p) => tileSnapshot(terms().find((t) => addr(t) === p.terminal), p));
    let stale = gridTerms().filter((t) => qualified(labels(t)["herdr.tab"]) === tab && !own(t));
    const configured = stale.length && !machine ? await Promise.resolve().then(() => host.recoveryShell?.()).catch(() => null) : null;
    stale = gridTerms().filter((t) => qualified(labels(t)["herdr.tab"]) === tab && !own(t));
    const isShell = (t) => shell(t, configured);
    const recovery = stale.length && stale.every(isShell) && tabPanes().length && tabPanes().every((p) => terms().some((t) => addr(t) === p.terminal && claimed(t) && (own(t) || isShell(t))))
      ? { space: space.id, tab, tiles: snapshot() } : null;
    if (rebuild && (!explicit || !recovery || JSON.stringify(rebuild) !== JSON.stringify(recovery))) {
      return { ok: false, reason: "The grid changed since confirmation. Nothing was rebuilt; open the rig space and review its tiles again." };
    }
    if (stale.length && !rebuild) return { ok: false, recovery,
      reason: recovery ? "These tiles were restored as shells after a Herdr restart. Review them before rebuilding."
        : "A grid tile is running an unrecognised program; it was left alone. Save any work, close the affected panes yourself, then open the rig space again.",
      stale: stale.map((t) => ({ seat: labels(t)["herdr-openrig.seat"] || "Empty tile", shell: isShell(t) })) };
    const confirmed = (t, p) => !!rebuild && claimed(t) && isShell(t)
      && rebuild.tiles.some((s) => JSON.stringify(s) === JSON.stringify(tileSnapshot(t, p)));
    const focused = () => get(host, "spaces").some((s) => s.active && s.tabs?.some((t) => t.id === tab && t.active))
      || tabPanes().some((p) => p.focused || (p.terminal && p.terminal === host.focused?.()?.terminal));
    const guard = () => { if (!explicit && focused()) throw new Error("deferred-focus"); };
    const ready = async () => {
      if (!machine) return;
      const current = await host.prepareRemote(config);
      if (!current.ok) throw Object.assign(new Error(current.reason), { machineNotice: current.machineNotice, retryable: true });
      if (JSON.stringify(current) !== JSON.stringify(remote)) throw new Error("The machine changed while updating this grid. Retry.");
    };
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
      await ready();
      guard();
      // Re-check ownership against live labels immediately before every destructive operation.
      const livePane = panes().find((n) => n.pane === p.pane && n.terminal === p.terminal && n.tab === p.tab);
      if (rebuild && !terms().some((t) => addr(t) === p.terminal && livePane && rebuild.tiles.some((s) => JSON.stringify(s) === JSON.stringify(tileSnapshot(t, livePane))))) throw new Error("A confirmed tile changed; it was left alone. Review the remaining tiles again.");
      if (!livePane || !terms().some((t) => addr(t) === p.terminal && (own(t) || confirmed(t, livePane)))) throw new Error("A grid pane changed or is no longer owned by this mod; it was left alone.");
      host.run("pane.close", { pane: p.pane });
      await waitFor(() => !panes().some((n) => n.pane === p.pane), "pane close");
    };
    try {
      if (tabPanes().some((p) => !terms().some((t) => addr(t) === p.terminal && (own(t) || confirmed(t, p))))) throw new Error("The grid tab contains a personal pane; it was left alone.");
      if (!plan.tiles.length) {
        for (const p of tabPanes()) await close(p);
        this.done.delete(key);
        return { ok: true, empty: true };
      }
      const stamp = () => `${plan.signature}|${tabPanes().map((p) => p.pane).sort().join(",")}`;
      if (!rebuild && tab && this.done.get(key) === stamp()) {
        if (explicit && !machine) {
          const preflight = await localGridPreflight(host, plan);
          if (!preflight.ok) return { ...preflight, closeAvailable: this.ownedPanes(rig, config).length > 0 };
        }
        if (explicit) { host.run("space.select", { id: space.id }); host.run("tab.select", { id: tab }); }
        return { ok: true, reused: true, space: space.id, tab };
      }
      guard();
      const preflight = machine ? { ok: true } : await localGridPreflight(host, plan);
      if (!preflight.ok) return { ...preflight, closeAvailable: this.ownedPanes(rig, config).length > 0 };
      guard();
      const first = plan.tiles[0];
      const sameViewer = (t) => {
        const argv = t.argv?.[0] === "env" && t.argv?.[1]?.startsWith("HERDR_OPENRIG_GRID_TILE=") ? t.argv.slice(2) : t.argv;
        return JSON.stringify(argv) === JSON.stringify(first.argv);
      };
      let anchor = tabPanes().find((p) => terms().some((t) => addr(t) === p.terminal && own(t) && labels(t)["herdr-openrig.seat"] === first.session && sameViewer(t)));
      if (!anchor) {
        const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const spaceId = space?.id ?? qualified(`sp-openrig-${nonce}`);
        tab ??= qualified(`tb-openrig-${nonce}`);
        await ready(); guard();
        const out = await hc(["run", ...(machine ? ["--on", machine] : []), "--bg", "--json", "--no-parent", "--no-notify",
          "--label", `herdr.space=${localId(spaceId)}`, "--label", `herdr.tab=${localId(tab)}`,
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
        await ready();
        guard(); const before = new Set(panes().map((p) => p.pane));
        if (!terms().some((t) => addr(t) === parent.terminal && own(t))) throw new Error("The split target is not a mod-owned viewer.");
        // Correlate the new pane by its exact argv, not merely by arrival order alongside personal activity.
        const argv = ["env", `HERDR_OPENRIG_GRID_TILE=${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, ...tile.argv];
        host.run("pane.split", { pane: parent.pane, direction, argv });
        const pane = await waitFor(() => panes().find((p) => p.tab === tab && !before.has(p.pane)
          && terms().some((t) => addr(t) === p.terminal && JSON.stringify(t.argv) === JSON.stringify(argv))), "pane split");
        if (!pane.terminal) throw new Error("Herdr split did not create a viewer terminal.");
        if (machine) {
          const record = JSON.parse(await hc(["get", "--json", "--", pane.terminal]));
          if (record.parent || record.terminal?.parent) throw new Error("Herdr created a grid split with a parent. The grid was stopped to protect the parent terminal.");
        }
        await mark(pane.terminal, tile, argv);
        await waitFor(() => terms().some((t) => addr(t) === pane.terminal && own(t)), "viewer labels");
        return pane;
      };
      const columns = [anchor];
      for (let col = 1; col < plan.cols; col++) columns.push(await split(columns.at(-1), "right", plan.tiles[col]));
      const equalise = async (p) => {
        await ready();
        guard();
        if (!terms().some((t) => addr(t) === p.terminal && own(t))) throw new Error("A personal pane was left unchanged.");
        host.run("layout.resize", { id: p.pane, weight: 1 });
      };
      for (const p of columns) await equalise(p);
      for (let col = 0; col < plan.cols; col++) {
        let parent = columns[col];
        for (let row = 1; row < plan.rows; row++) parent = await split(parent, "down", plan.tiles[row * plan.cols + col]);
      }
      for (const p of tabPanes()) await equalise(p);
      host.run("tab.rename", { id: tab, name: "Seats" });
      this.done.set(key, stamp());
      if (explicit) { host.run("space.select", { id: space.id }); host.run("tab.select", { id: tab }); }
      return { ok: true, space: space.id, tab, cols: plan.cols, rows: plan.rows };
    } catch (e) {
      this.done.delete(key);
      if (e.message === "deferred-focus") return { ok: true, deferred: true };
      const failure = remoteFailure(e, machine), retryable = e.retryable || failure.retryable;
      return { ...failure, ...(retryable ? { retryable: true, preparationFailed: true } : { closeAvailable: this.ownedPanes(rig, config).length > 0 }) };
    }
  }
}
