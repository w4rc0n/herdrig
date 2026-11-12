// OpenRig's Rig palette, opened by `mod.open rig-palette` (ctrl-alt-r in the Rig layout, or the sidebar).
// It is not herdr's palette. Its rows come from the TUI's own command registry (`rig tui commands --json`, cached per
// `rig --version`) and live names from the sidebar; Enter sends the typed line to `rig tui resolve`, the TUI's own
// grammar. A navigation opens on the Rig page; an action goes through rig-menu's confirmation (one-click ones run at once, and
// `reply <words>` fills the request's inline reply); an error stays inline.
// Local commands (`LOCAL_COMMANDS`): `open-page` opens/focuses the Rig Page tab, and `open-tui` / `tui` shows the active
// space's TUI (or opens one, with the recorded CLI).
import { View, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { appHome, readTextFile, theme, run, exec, shared, setShared, openOverlay, props, closeOverlay, spaces, panes, terminals, hc, layout, notify } from "herdr";
import { MOD_IDS, REMOTE_OPERATOR_REASON, parseConfig, discoverDaemonFromCli, readCommand, openOrFocusTui, attachToSeat, isLoopbackDaemonUrl, paletteRoute, resolveTuiLineFallback, fileEntry, draftKey, navPush, navBack, layoutHasMod, unsafeReadPath, launchFolderProblem, needTarget, startOneClick, LOCAL_COMMANDS, currentCapabilities, capabilityDisableReason, TUI_RESOLVE_REASON, expandAllTopology, collapseAllTopology, openOrFocusRigTab, attachRelayPath, waitWith } from "./rig-lib.js";

/** The palette's own commands, offered first when they match what is typed. */
import { registerRigRouting } from "./rig-lib.js";
export { LOCAL_COMMANDS };
const OWN = LOCAL_COMMANDS;

const STACK = "rig-work", PAGE = "rig-page";

export default class RigPalette extends View {
  init(_p, cx) {
    registerRigRouting(cx, context => ({ shared, setShared, run, spaces, panes, terminals, hc, layout, notify, config: this.config, wait: waitWith(context) }));
    this.input = InputState.new({ placeholder: "agent dev.design · :scopes · tab graph · /codex" });
    // An opener can start it with text (the Rig page's Filter… starts it at "/").
    if (typeof props()?.initial === "string") this.input.set_value(props().initial);
    this.selected = -1; // the row Up/Down chose; -1: Enter runs what is typed
    this.input.on("change", (_e, cx) => { this.error = null; this.note = null; this.selected = -1; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.choose(cx));
    this.input.focus();
    cx.timer.after(400, () => this.input.focus());
    this.registry = [];
    this.error = null;
    this.note = null; // an informational outcome, in the muted colour (an error is in the blocked colour)
    this.busy = false;
    cx.spawn(async (cx) => {
      this.config = parseConfig(await readTextFile(`${appHome()}/openrig/config.json`));
      const version = (await exec(...this.cli(["--version"]))).stdout.trim();
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem("registry") ?? "null"); } catch (_) { cached = null; }
      if (cached?.version === version && Array.isArray(cached.entries)) this.registry = cached.entries;
      else {
        const r = await exec(...this.cli(["tui", "commands", "--json"]));
        let entries = null;
        try { entries = JSON.parse(r.stdout); } catch (_) { entries = null; }
        // Anything but a list (an error object, another CLI) is said, never rendered as one: the rows would throw.
        if (Array.isArray(entries)) {
          this.registry = entries;
          try { localStorage.setItem("registry", JSON.stringify({ version, entries })); } catch (_) {}
        } else this.error = (r.stderr || (entries?.error?.message ?? entries?.error) || r.stdout || "rig tui commands gave no list").toString().trim();
      }
      cx.notify();
    });
  }

  cli(args) { const c = readCommand(this.config ?? parseConfig(null), args); return [c.command, c.args, { timeout: 30000 }]; }
  caps() { return currentCapabilities(this.config?.capabilities ?? shared, terminals?.() ?? [], shared("rig.capabilities")); }
  /** Closes the palette (named apart from close(), which herdr calls at teardown). */
  dismiss() { const id = props()?.overlay; if (id) closeOverlay(id); else run("mod.open", { name: MOD_IDS.palette }); }

  /** Rows for the current text: registry verbs (by name or alias) and live names to complete with. */
  rows() {
    const q = this.input.value().trim().toLowerCase();
    const [verb] = q.split(/\s+/);
    const data = shared("rig.data") ?? {};
    const names = [];
    for (const rig of data.topology ?? []) {
      names.push({ line: `rig ${rig.name}`, hint: "Rig card", navigation: true });
      for (const pod of rig.pods) for (const s of pod.seats) names.push({ line: `agent ${s.logicalId}`, hint: `Seat card · ${rig.name}`, navigation: true });
    }
    const verbs = this.registry.filter((e) => !q || e.name.startsWith(verb) || e.aliases.some((a) => a.startsWith(verb)) || e.name === "attention" && ["need", "needs"].some(a => a.startsWith(verb)))
      .map((e) => ({ line: e.sample || `${e.name} ${e.args}`.trim(), label: e.name === "attention" ? "Needs: requests and updates for you" : null, hint: e.name === "attention" ? "" : e.description, verb: e.name, args: e.args ?? "" }));
    const live = q ? names.filter((n) => n.line.toLowerCase().includes(q)) : [];
    const designReason = capabilityDisableReason("design-view", this.caps());
    const ownRows = OWN.map((o) => o.line === "view-design" && designReason ? { ...o, hint: designReason } : o);
    const designs = (data.topology ?? []).map((rig) => ({ line: `view-design ${rig.name}`, hint: designReason ?? `Design a worker view grid · ${rig.name}` }));
    const overviews = (data.topology ?? []).map((rig) => ({ line: `overview ${rig.name}`, hint: `Expand and focus ${rig.name} on Topology` }));
    const recents = (data.topology ?? []).map((rig) => ({ line: `recent ${rig.name}`, hint: `Recent queue transitions · ${rig.name}` }));
    const changeModels = (data.topology ?? []).flatMap((rig) => rig.pods.flatMap((p) => p.seats.map((s) => ({
      line: `change-model ${s.logicalId}`,
      hint: `Change harness, model, or effort · ${rig.name}`,
    }))));
    const own = q ? [...ownRows, ...designs, ...overviews, ...recents, ...changeModels].filter((o) => o.line.startsWith(q) || q.startsWith(o.line.split(" ")[0])) : [];
    return [...own, ...live.slice(0, 8), ...verbs.slice(0, 12)];
  }

  /** Enter and Ctrl+Enter alike: the row Up/Down chose, else what is typed. A chosen verb that needs an
   *  argument fills the input with the verb to type it after, rather than running its sample. */
  choose(cx) {
    const rows = this.rows(), index = this.selectionIndex(rows);
    const row = index >= 0 ? rows[index] : null;
    if (row?.verb && row.args && !row.args.startsWith("[")) {
      this.input.set_value(`${row.verb} `);
      this.selected = -1;
      cx.notify();
      return;
    }
    this.submit(cx, row ? row.line : this.input.value());
  }

  /** A plain live-name search selects its first local navigation result; typed grammar keeps its own semantics. */
  selectionIndex(rows = this.rows()) {
    if (this.selected >= 0) return this.selected;
    const line = this.input.value().trim();
    return line && !resolveTuiLineFallback(line) && rows[0]?.navigation ? 0 : -1;
  }

  /** Local palette commands (`operator`, `open-page`, `open-tui`, `tui`, `refresh`, `expand-all`, `collapse-all`, `view-design`, `change-model`, `notifications`). */
  own(cx, line) {
    const [verbRaw, arg] = line.trim().split(/\s+/);
    const verb = (verbRaw ?? "").toLowerCase();
    if ((verb === "help" || verb === "?") && !arg) {
      this.input.set_value(""); this.selected = -1; this.error = null; this.note = null; this.input.focus(); cx.notify(); return true;
    }
    if ((verb === "operator" || verb === ":operator" || verb === "open-operator") && !arg) {
      return this.openOperator(cx);
    }
    // The TUI's refresh re-reads its own view; here the sidebar re-reads (the page follows it).
    if (verb === "refresh" && !arg) { run("rig.refresh"); this.dismiss(); return true; }
    if (verb === "show-sidebar-here" && !arg) { run("rig.show-sidebar-here"); this.dismiss(); return true; }
    if ((verb === "open-page" || verb === ":open-page") && !arg) {
      const entry = shared("rig.sel")?.entry ?? shared("rig.nav")?.stack?.at(-1) ?? { section: "topology" };
      this.finishPage(openOrFocusRigTab({ shared, setShared, run, spaces, panes, layout }, entry));
      return true;
    }
    if ((verb === "tui" || verb === "open-tui" || verb === ":open-tui") && !arg) {
      // Wait for the sidebar's receipt, or complete the labelled local open here, before closing this palette.
      const inRigLayout = !!(function find(n) { return n && typeof n === "object" && (n.id === STACK || (n.children ?? []).some(find)); })(layout());
      const config = this.config ?? parseConfig(null);
      this.busy = true; cx.notify();
      cx.spawn(async (cx) => {
        try {
          const result = await openOrFocusTui({ spaces, panes, terminals, hc, run, layout, inRigLayout, wait: (ms) => new Promise((r) => cx.timer.after(ms, () => r())) }, config);
          if (result?.ok === false) notify({ title: "Open TUI", body: result.reason, level: "warning" });
        }
        finally { this.dismiss(); }
      });
      return true;
    }
    if ((verb === "expand-all" || verb === ":expand-all") && !arg) {
      setShared("rig.open.page", expandAllTopology(shared("rig.open.page"), shared("rig.data")?.topology ?? []));
      this.finishPage(openOrFocusRigTab({ run, spaces, panes, layout, section: "topology" }));
      return true;
    }
    if ((verb === "collapse-all" || verb === ":collapse-all") && !arg) {
      setShared("rig.open.page", collapseAllTopology(shared("rig.open.page"), shared("rig.data")?.topology ?? []));
      this.finishPage(openOrFocusRigTab({ run, spaces, panes, layout, section: "topology" }));
      return true;
    }
    if (verb === "view-design" || verb === "design-view") return this.design(cx, arg ?? null);
    if (verb === "change-model") return this.changeModel(cx, arg ?? null);
    if (verb === "notifications") {
      const route = paletteRoute({ line }, null, []);
      if (route.error) { this.error = route.error; this.note = null; cx.notify(); return true; }
      const cur = (shared("rig.settings")?.notifications ?? true) !== false;
      const next = route.value === "toggle" ? !cur : Boolean(route.value);
      setShared("rig.settings", { ...(shared("rig.settings") ?? {}), notifications: next });
      this.error = null;
      this.note = `Notifications ${next ? "on" : "off"}.`;
      cx.notify();
      return true;
    }
    if (
      verb === "usage-hosts" || verb === ":usage-hosts" ||
      verb === "pulse" || verb === ":pulse" ||
      verb === "overview" || verb === ":overview" ||
      verb === "recent" || verb === ":recent" ||
      verb === "projects" || verb === ":projects" ||
      (verb === "project" && arg) ||
      (verb === "tab" && (arg === "pulse" || arg === "overview" || arg === "recent"))
    ) {
      const nav = shared("rig.nav") ?? { stack: [] };
      const top = nav.stack?.at(-1) ?? { section: "topology" };
      const route = paletteRoute({ line }, top, shared("rig.data")?.topology ?? []);
      if (route.error) { this.error = route.error; cx.notify(); return true; }
      this.applyRoute(route);
      return true;
    }
    return false;
  }

  /** `view-design [rig]`: the worker-view designer for that rig (the one alone, or the one on the Rig page, when none is named). */
  design(cx, name) {
    const reason = capabilityDisableReason("design-view", this.caps());
    if (reason) { this.note = reason; cx.notify(); return true; }
    const rigs = shared("rig.data")?.topology ?? [];
    const top = (shared("rig.nav") ?? {}).stack?.at(-1);
    const rig = name ? rigs.find((r) => r.name === name) : rigs.find((r) => top?.kind === "rig" && r.id === top.rigId) ?? rigs[0];
    if (!rig) { this.error = name ? `No rig ${name} on this daemon.` : "No rig to design a view for."; cx.notify(); return true; }
    openOverlay({ mod: MOD_IDS.menu, kind: "dialog", modal: true, width: 680, height: 460, props: { target: { kind: "rig", rig: rig.name, rigId: rig.id, lifecycle: rig.lifecycle }, step: { action: "design-view" } } });
    this.dismiss();
    return true;
  }

  /** `change-model [seat]`: opens the harness/model/effort swap modal for the named seat (or the seat on the Rig page). */
  changeModel(cx, seatArg) {
    const rigs = shared("rig.data")?.topology ?? [];
    const allSeats = rigs.flatMap((rig) => (rig.pods ?? []).flatMap((p) => (p.seats ?? []).map((seat) => ({ rig, seat }))));
    const top = (shared("rig.nav") ?? {}).stack?.at(-1);
    const hit = seatArg
      ? allSeats.find(({ rig, seat }) => seat.logicalId === seatArg || seat.session === seatArg || seat.member === seatArg || `${seat.logicalId}@${rig.name}` === seatArg)
      : (allSeats.find(({ seat }) => top?.kind === "seat" && (seat.session === top.session || seat.logicalId === top.name)) ?? allSeats[0]);
    if (!hit) {
      this.error = seatArg ? `No seat ${seatArg} on this daemon.` : "No seat to change model or harness for.";
      cx.notify();
      return true;
    }
    const { rig, seat } = hit;
    openOverlay({
      mod: MOD_IDS.menu,
      kind: "dialog",
      modal: true,
      width: 520,
      height: 420,
      props: {
        target: {
          kind: "seat",
          rig: rig.name,
          rigId: rig.id,
          session: seat.session,
          logicalId: seat.logicalId,
          runtime: seat.runtime,
          model: seat.model,
          effort: seat.effort,
          lifecycle: rig.lifecycle,
        },
        step: { action: "change-model" },
      },
    });
    this.dismiss();
    return true;
  }

  submit(cx, line) {
    if (!line.trim()) return;
    if (this.own(cx, line)) return;
    this.busy = true; this.error = null; this.note = null; cx.notify();
    cx.spawn(async (cx) => {
      let res = null;
      if (this.caps().tuiResolve === false) {
        res = resolveTuiLineFallback(line);
        this.busy = false;
        if (!res) { this.note = TUI_RESOLVE_REASON; cx.notify(); return; }
      } else {
        const r = await exec(...this.cli(["tui", "resolve", ...line.trim().split(/\s+/), "--json"]));
        try { res = JSON.parse(r.stdout); } catch (_) { res = null; }
        this.busy = false;
        if (!res || typeof res.kind !== "string") {
          const errText = String(res?.error?.message ?? res?.error ?? (r.stderr || r.stdout || "rig tui resolve gave no answer")).trim();
          if (/(unknown command|too many arguments|unknown option)/i.test(errText)) {
            res = resolveTuiLineFallback(line);
            if (!res) { this.note = TUI_RESOLVE_REASON; cx.notify(); return; }
          } else {
            this.error = errText; cx.notify(); return;
          }
        }
      }
      if (res.kind === "error") { this.error = res.message; cx.notify(); return; }
      if (res.kind === "local" || res.kind === "noop") { this.error = `"${line}" is a TUI control; it does nothing here.`; cx.notify(); return; }
      if (!res.action || typeof res.action.type !== "string") { this.error = `rig tui resolve answered "${res.kind}" without saying what to do; is this the OpenRig that installed the Rig mods?`; cx.notify(); return; }
      const nav = shared("rig.nav") ?? { stack: [] };
      const top = nav.stack?.at(-1) ?? { section: "topology" };
      const route = paletteRoute({ ...res, line }, top, shared("rig.data")?.topology ?? []);
      if (route.error) { this.error = route.error; cx.notify(); return; }
      if (route.note) { this.note = route.note; cx.notify(); return; }
      if (route.back) { setShared("rig.nav", navBack(nav)); this.finishPage(openOrFocusRigTab({run,spaces,panes,layout})); return; }
      if (route.act) { await this.act(cx, route, top); return; }
      this.applyRoute(route);
    });
  }

  applyRoute(route) {
    if (route.open) setShared("rig.open.page", { ...(shared("rig.open.page") ?? {}), ...route.open });
    if (route.focus) setShared("rig.focus", route.focus);
    if (route.entry?.focusRig) setShared("rig.focusRig", route.entry.focusRig);
    if (route.project) {
      setShared("rig.project", route.project);
      const prior = (shared("rig.nav")?.stack ?? []).filter((e) => e?.section !== "scopes");
      setShared("rig.nav", { stack: [...prior, route.entry] });
      this.finishPage(openOrFocusRigTab({ run, spaces, panes, layout, section: "scopes" }));
      return;
    }
    this.show(route.entry);
  }

  /** Shows a page entry on the Rig page and closes the palette. */
  show(entry) {
    setShared("rig.nav", navPush(shared("rig.nav"), entry));
    this.finishPage(openOrFocusRigTab({ run, spaces, panes, layout, section: entry?.section ?? "topology" }));
  }

  finishPage(result) {
    Promise.resolve(result).catch(error=>notify({title:"OpenRig",body:String(error?.message??error),level:"warning"}))
      .finally(()=>this.dismiss());
  }

  openOperator(cx) {
    const config = this.config ?? parseConfig(null);
    const sharedUrl = shared("rig.data")?.config?.daemonUrl;
    const daemonUrl = config.daemonUrl ?? (sharedUrl && isLoopbackDaemonUrl(sharedUrl) ? sharedUrl : null);
    if (!isLoopbackDaemonUrl(daemonUrl)) {
      this.error = REMOTE_OPERATOR_REASON;
      this.note = null;
      cx.notify();
      return true;
    }
    const topo = shared("rig.data")?.topology ?? [];
    const kernelRig = topo.find((r) => r.name === "kernel");
    const operatorSeat = kernelRig?.pods?.flatMap((p) => p.seats ?? [])?.find((s) => s.logicalId === "operator.agent" || String(s.session ?? "").startsWith("operator-agent@"));
    const target = {
      kind: "seat",
      rig: "kernel",
      rigId: kernelRig?.id ?? "kernel",
      session: operatorSeat?.session ?? "operator-agent@kernel",
      logicalId: operatorSeat?.logicalId ?? "operator.agent",
      tmuxAttachCommand: operatorSeat?.tmuxAttachCommand ?? "tmux attach -t operator-agent@kernel",
      attachable: true,
    };
    this.busy = true; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const res = await attachToSeat({ exec, run, hc, spaces, panes, terminals: () => terminals?.() ?? [], layout, shared, setShared, wait: waitWith(cx), relayPath: attachRelayPath(appHome(), MOD_IDS.palette) }, target, { ...config, daemonUrl }, { name: "Operator", operator: true });
        if (res && res.ok === false && res.reason) notify({ title: "Open operator", body: res.reason, level: "warning" });
      } finally {
        this.dismiss();
      }
    });
    return true;
  }

  async resolveDaemonUrl() {
    if (this.config?.daemonUrl) return this.config.daemonUrl;
    // Another mod's shared state may name the daemon only when it's on this machine (loopback).
    const fromShared = shared("rig.data")?.config?.daemonUrl;
    if (fromShared && isLoopbackDaemonUrl(fromShared)) {
      this.config = { ...(this.config ?? parseConfig(null)), daemonUrl: fromShared, daemonUrlSource: "cli" };
      return fromShared;
    }
    const status = await discoverDaemonFromCli(this.config ?? parseConfig(null), exec);
    if (status.reachable && status.daemonUrl) {
      this.config = { ...(this.config ?? parseConfig(null)), daemonUrl: status.daemonUrl, daemonUrlSource: "cli" };
      return status.daemonUrl;
    }
    throw new Error(status.message || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up').");
  }

  async get(path) {
    const daemonUrl = await this.resolveDaemonUrl();
    const r = await fetch(`${daemonUrl}${path}`);
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
    return r.json();
  }

  /** The work a line asks for that isn't just a page (paletteRoute's acts). Errors stay inline. */
  async act(cx, route, top) {
    const fail = (message) => { this.error = message; cx.notify(); };
    const note = (message) => { this.note = message; cx.notify(); };
    try {
      if (route.act === "operator") { this.openOperator(cx); return; }
      if (route.act === "design-view") { this.design(cx, route.rig); return; }
      if (route.act === "change-model") { this.changeModel(cx, route.seat); return; }
      if (route.act === "notifications") {
        const cur = (shared("rig.settings")?.notifications ?? true) !== false;
        const next = route.value === "toggle" ? !cur : Boolean(route.value);
        setShared("rig.settings", { ...(shared("rig.settings") ?? {}), notifications: next });
        return note(`Notifications ${next ? "on" : "off"}.`);
      }
      if (route.act === "open-view") {
        const reason = capabilityDisableReason("open-view", this.caps());
        if (reason) return note(reason);
        // Opens at once (no one-item popup, no Working… dialog): the sidebar runs it and reports.
        startOneClick({ shared, setShared, run, layout, openOverlay }, { kind: "open-view", view: route.view }, "open-view");
        return this.dismiss();
      }
      if (route.act === "read") {
        // `read <root>/<path>`: the daemon's readable roots, as the TUI reads them; nothing outside them.
        const roots = (await this.get("/api/files/roots"))?.roots ?? [];
        const root = roots.find((r) => r.name === route.target.root);
        if (!root) return fail(`read: no readable root named "${route.target.root}" (${roots.map((r) => r.name).join(", ") || "none configured"}).`);
        if (unsafeReadPath(route.target.path)) return fail("Path must stay inside the readable root.");
        // The daemon's guarded read decides: `..`, absolute paths and symlinks out of the root are refused
        // there, and the file shown is the one it resolved.
        const daemonUrl = await this.resolveDaemonUrl();
        const url = `${daemonUrl}/api/files/read?root=${encodeURIComponent(route.target.root)}&path=${encodeURIComponent(route.target.path)}`;
        const r = await fetch(url);
        let body = null; try { body = await r.json(); } catch (_) { body = null; }
        if (!r.ok) return fail(`read: ${body?.message ?? body?.error ?? `the daemon refused it (${r.status})`}`);
        const at = typeof body?.absolutePath === "string" ? body.absolutePath : `${root.path.replace(/\/+$/, "")}/${route.target.path}`;
        return this.show({ ...fileEntry(at), ...(route.target.anchor ? { anchor: route.target.anchor } : {}) });
      }
      if (route.act === "slice-file") {
        const folder = ((await this.get("/api/slices"))?.slices ?? []).map((x) => x.slicePath).find((p) => typeof p === "string" && p.split(/[\\/]/).pop() === route.slice);
        if (!folder) return fail(`OpenRig doesn't say where ${route.slice} is on disk.`);
        return this.show(fileEntry(`${folder}/${route.file}`, `${route.file} · ${route.slice}`));
      }
      if (route.act === "reply") {
        // The request shown; away from one, the only one waiting. With several waiting, none is guessed and no draft is
        // overwritten: the person opens one first, as the TUI's reply asks.
        const items = ((await this.get("/api/attention"))?.items ?? []).map(needTarget).filter((n) => !n.update && n.reply !== "none");
        let target = null;
        if (top.section === "needs" && top.id) {
          target = items.find((n) => n.id === top.id);
          if (!target) return fail("The request shown no longer takes a reply.");
        } else if (items.length === 1) target = items[0];
        else if (!items.length) return note("No Needs-You request is waiting.");
        else return note(`${items.length} requests waiting — open one in Needs-You (:needs) first.`);
        // The words fill the request's inline reply box, opened and focused on the Rig page, to confirm with Answer or
        // Resolve there: the Needs list when it is shown, else the request's own page.
        setShared("rig.drafts", { ...(shared("rig.drafts") ?? {}), [draftKey(target, "reply")]: route.text });
        setShared("rig.open.page", { ...(shared("rig.open.page") ?? {}), [`needs:${target.id}`]: true });
        setShared("rig.replyFocus", { id: target.id, at: Date.now() });
        if (top.section === "needs" && (top.id === target.id || !top.id)) { return this.finishPage(openOrFocusRigTab({ run, spaces, panes, layout, section: "needs" })); }
        return this.show({ section: "needs", id: target.id, name: target.summary });
      }
      if (route.act === "launch") {
        // launch-folder / launch-host are remembered for the launch dialog; launch opens it for the spec shown.
        const drafts = { ...(shared("rig.drafts") ?? {}) };
        // A relative folder is refused, as the TUI's launch-folder does.
        const problem = route.folder !== undefined ? launchFolderProblem(route.folder) : null;
        if (problem) return fail(problem);
        if (route.folder !== undefined) drafts["launch-folder"] = route.folder;
        if (route.host !== undefined) drafts["launch-host"] = route.host;
        setShared("rig.drafts", drafts);
        if (route.folder !== undefined || route.host !== undefined) {
          // Remembered only; the launch itself stays one deliberate step in the dialog.
          return note(top.section === "specs" && (top.id || top.name) ? "Kept for the launch dialog: run launch, or use Launch rig from spec…" : "Kept for the launch dialog: open a rig spec (:specs), then launch.");
        }
        // A spec card opened by id, or by name (`spec <name>`).
        if (!(top.section === "specs" && (top.id || top.name))) return note("Open a rig spec (:specs), then launch.");
        const library = (await this.get("/api/specs/library")) ?? [];
        const named = top.id ? [] : library.filter((x) => x.name === top.name);
        const spec = top.id ? library.find((x) => x.id === top.id) : named.find((x) => x.kind === "rig") ?? named[0];
        if (!spec) return fail(`${top.name ?? top.id} isn't in the spec library any more.`);
        // Rig specs only, the rule the card and the menu use.
        if (spec.kind && spec.kind !== "rig") return note(`${spec.name} is an agent spec; launch takes a rig spec.`);
        openOverlay({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: 300, props: { target: { kind: "spec", id: spec.id, name: spec.name, sourcePath: spec.sourcePath ?? null, specKind: "rig" }, step: { action: "launch-spec" } } });
        return this.dismiss();
      }
    } catch (e) { fail(String(e?.message ?? e)); }
  }

  render(cx) {
    const t = theme();
    const rows = this.rows();
    return v_flex().id("rig-palette").size_full().bg(t.raised).border(1).border_color(t.border).rounded(10).p(8).gap(6).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") this.dismiss();
        // Up/Down choose a row, as herdr's own picker does; Enter in the input runs it.
        else if (e.key === "down" || e.key === "up") {
          const n = rows.length;
          this.selected = !n ? -1 : e.key === "down" ? Math.min(n - 1, this.selected + 1) : this.selected <= 0 ? -1 : this.selected - 1;
          cx.stop_propagation(); cx.notify();
        }
        // Enter submits in the input; Ctrl+Enter (Cmd+Enter on macOS) does too, as in every Rig text box.
        else if (e.key === "enter" && (e.modifiers?.control || e.modifiers?.platform)) { cx.stop_propagation(); this.choose(cx); }
      })
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(12).font_semibold().text_color(t.muted).child("Rig"))
        .child(div().flex_1().child(Input.new(this.input)))
        .child(div().text_size(11).text_color(t.dim).child(this.busy ? "…" : "esc")))
      .when(!!this.error, (el) => el.child(div().px(6).text_size(12).text_color(t.blocked).child(this.error)))
      .when(!this.error && !!this.note, (el) => el.child(div().px(6).text_size(12).text_color(t.muted).child(this.note)))
      .child(v_flex().id("rig-palette-rows").flex_1().overflow_y_scrollbar().children(rows.map((r, i) => h_flex().id(`row-${i}`).px(6).h(24).gap(10).items_center()
        .rounded(5).when(i === this.selectionIndex(rows), (el) => el.bg(t.selected).text_color(t.foreground)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.selected = i; this.choose(cx); })
        .child(div().w(r.label ? 280 : 200).truncate().text_size(12.5).tooltip(r.label ?? r.line).child(r.label ?? r.line))
        .child(div().flex_1().truncate().text_size(11.5).text_color(t.dim).child(r.hint ?? "")))))
      .when(!rows.length && !!this.input.value().trim(), el => el.child(v_flex().id("palette-no-matches").px(6).gap(4)
        .child(div().text_size(12).child(`No matches for “${this.input.value().trim()}”.`))
        .child(div().text_size(11.5).text_color(t.dim).child("Searches commands, rigs, seats and specs."))))
      .child(div().px(6).text_size(11).text_color(t.dim).child(":topology  :specs  :scopes  :terminals  :needs  :system"));
  }
}
