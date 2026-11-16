// OpenRig's Rig palette, opened by `mod.open rig-palette` (ctrl-alt-r in the Rig layout, or the sidebar).
// It is not herdr's palette. Its rows come from the TUI's own command registry (`rig tui commands --json`, cached per
// `rig --version`) and live names from the sidebar; Enter sends the typed line to `rig tui resolve`, the TUI's own
// grammar. A navigation opens on the Rig page; an action goes through rig-menu's confirmation (one-click ones run at once, and
// `reply <words>` fills the request's inline reply); an error stays inline.
// Local commands (`LOCAL_COMMANDS`): `open-page` opens/focuses the Rig Page tab, and `open-tui` / `tui` shows the active
// space's TUI (or opens one, with the recorded CLI).
import { stampConnection, pickRig, pickSeat, AMBIGUOUS_NAME, configOfConnection, NO_CONNECTION, UNKNOWN_CONNECTION, EXPLICIT_ADDRESS_NEEDED, LEGACY_CONNECTION_ID, connectionBoxLabel } from "./rig-connections.js";
import { View, div } from "gpui-kit";
import { effectiveScopeProject } from './rig-project.js';
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { appHome, readTextFile, theme, run as rawRun, exec as rawExec, shared, setShared as rawSetShared, openOverlay as rawOpenOverlay, props, closeOverlay, spaces, focused, panes, terminals, hc as rawHc, layout, notify } from "herdr";
import { followedConnection, spaceMachine } from "./rig-follow.js";
import { gatedExec, gatedHc, gatedRun, gatedConnect, observeConfig, rethrowGate, gatedOperationOrRefusal, gateSameConfig, CONFIG_CHANGED, numberedConfigReads } from "./rig-gate.js";
// THE SEND GATE (rig-gate.js): every request, CLI run, process-starting Herdr command and stream connection below goes through it, checked at send time.
const exec = (command, args, options) => gatedExec(rawExec, command, args, options);
const hc = (args, bytes) => gatedHc(rawHc, args, bytes);
const run = (name, args) => gatedRun(rawRun, name, args);
// A send for a CONNECTION names its gate scope (several OpenRigs: a bare sink refuses). `config` is that connection's own config.
const execFor = (config) => (command, args, options) => gatedExec(rawExec, command, args, options, undefined, config?.connectionId);
const hcFor = (config) => (args, bytes) => gatedHc(rawHc, args, bytes, undefined, config?.connectionId);
const runFor = (config) => (name, args) => gatedRun(rawRun, name, args, config?.connectionId);

let flatOwner = null; // the view this mod copy is acting for
const configReads = numberedConfigReads(); // numbered config reads (see init)
const setShared = rawSetShared; // several connections key their own state (qualifyKey); no flat-store guard
import { MOD_IDS, LAUNCH_DIALOG_HEIGHT, REMOTE_OPERATOR_REASON, parseConfig, discoverDaemonFromCli, readCommand, openOrFocusTui, attachToSeat, rigOfConnection, isLoopbackDaemonUrl, paletteRoute, resolveTuiLineFallback, fileEntry, draftKey, navPush, navBack, layoutHasMod, unsafeReadPath, launchFolderProblem, needTarget, startOneClick, LOCAL_COMMANDS, currentCapabilities, connectionCapabilities, capabilityDisableReason, TUI_RESOLVE_REASON, expandAllTopology, collapseAllTopology, openOrFocusRigTab, attachRelayPath, waitWith } from "./rig-lib.js";

/** The palette's own commands, offered first when they match what is typed. */
import { sharedLoopbackDaemonUrl, sharedRigData } from "./rig-lib.js";
import { readSidebarView, writeSidebarView } from "./rig-sidebar-view-state.js";
import { registerRigRouting, stampRows, rowsIdentityOf } from "./rig-lib.js";
export { LOCAL_COMMANDS };
const OWN = LOCAL_COMMANDS;

const STACK = "rig-work", PAGE = "rig-page";

const CONFIG_LOADING = "OpenRig's settings are still loading. Try again in a moment.";
export default class RigPalette extends View {
  // The send gate watches this mod's config: every assignment (a reload, a test) is seen at once; null is a constructor's placeholder.
  get config() { return this._config; }
  set config(value) { this._config = value; observeConfig(value); }
  /** Every overlay this instance opens is stamped with ITS OWN config (its rows were read under it), never the latest instance's. */
  open(spec) { return rawOpenOverlay(stampRows(spec, rowsIdentityOf(this.config, spec?.props?.target?.conn))); }
  init(_p, cx) {
    flatOwner = this;
    registerRigRouting(cx, context => ({ shared, setShared, run, spaces, panes, terminals, hc, layout, notify, openOverlay:spec=>this.open(spec),closeOverlay,config: this.config, currentConfig: () => this.config, wait: waitWith(context) }));
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
      // Reads are numbered across every palette of this mod copy (rig-gate.js numberedConfigReads): an older palette's read that lands after a newer one gets the INSTALLED config, never its own stale one.
      this.config = await configReads(async () => parseConfig(await readTextFile(`${appHome()}/openrig/config.json`)));
      const version = (await this.cliRun(["--version"])).stdout.trim();
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem("registry") ?? "null"); } catch (_) { cached = null; }
      if (cached?.version === version && Array.isArray(cached.entries)) this.registry = cached.entries;
      else {
        const r = await this.cliRun(["tui", "commands", "--json"]);
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

  /** The connection the palette's own CLI reads (the command registry, resolve) act for: the box the sidebar follows (several connections), else the first. The palette's rows stay cross-box. */
  /** The ONE connection an action acts for, taken when the action STARTS and carried through its awaits: the box the sidebar follows when it is listed; the first only when there is exactly one
   *  connection; otherwise none (refused: never the first by default, and never re-read after an await). */
  acting() {
    const followed = shared("rig.followed"), own = followed ? configOfConnection(this.config, followed) : null;
    if (own) return { ok: true, config: own };
    if ((this.config?.connections ?? []).length <= 1) return { ok: true, config: this.config };
    return { ok: false, reason: NO_CONNECTION };
  }
  /** The connection a CHOSEN ROW names (rows carry their box with several connections): that connection when it is listed, else refused. */
  actingFor(conn) {
    const own = conn ? configOfConnection(this.config, conn) : null;
    return own ? { ok: true, config: own } : { ok: false, reason: UNKNOWN_CONNECTION };
  }
  /** The page the person SEES. The shared nav stack is global: its top is the last page opened anywhere, not the page of the space in view. In a space on a machine that has exactly one
   *  OpenRig that OpenRig's page is the one drawn (the same rule the page's own tab uses): the stack's top when it is that OpenRig's (or names none and that OpenRig is the first), else its most recent page in
   *  the stack, else none. In a space on this computer any connection's page can be drawn, so the top. An entry naming a connection that is gone is ignored, never acted for. One connection: the top. */
  shownPage() {
    const raw = (shared("rig.nav") ?? {}).stack ?? [];
    if (!this.perBox()) return raw.at(-1) ?? null;
    const stack = raw.filter((entry) => !entry?.conn || configOfConnection(this.config, entry.conn)), top = stack.at(-1) ?? null, space = this.focusedSpace();
    // No Rig page tab in the space in view (a rig space of its own, a grid): no page is drawn there, so nothing on the stack is "the page"; the followed box decides.
    if (space && !this.hasPageTab(space)) return null;
    const own = this.spaceConn(space);
    if (!own) { // the tab draws the stack's top, whoever's it is: a top whose connection is gone is the page in view, so an act that needs a page refuses (`goneConn`) while navigation and typed names go on for the followed box
      const drawn = raw.at(-1);
      return drawn?.conn && !configOfConnection(this.config, drawn.conn) ? { ...drawn, conn: undefined, goneConn: drawn.conn } : top;
    }
    if (top?.conn ? top.conn === own : own === this.primaryViewId()) return top;
    return [...stack].reverse().find((entry) => entry?.conn === own) ?? null;
  }
  /** The space in view (the focused one), or null. */
  focusedSpace() {
    try { const focus = focused?.(); return focus ? (spaces?.() ?? []).find((sp) => sp.id === focus.space) ?? null : null; } catch (_) { return null; }
  }
  /** Whether a Rig page tab (mod rig-view) is in that space: the only thing in a space that draws a page. */
  hasPageTab(space) {
    try { const tabs = new Set((space?.tabs ?? []).map((tab) => tab?.id)); return (panes?.() ?? []).some((pane) => pane?.mod === MOD_IDS.view && tabs.has(pane.tab)); } catch (_) { return true; }
  }
  /** The OpenRig of the MACHINE space in view, when that machine has exactly one; else null (a space on this computer, a machine with none or several). */
  spaceConn(space = this.focusedSpace()) {
    if (!space || !spaceMachine(space)) return null;
    const picked = followedConnection({ connections: this.config?.connections ?? [], space });
    return picked.why === "space" ? picked.id : null;
  }
  /** The refusal for an act that needs the shown page when that page belongs to a removed connection (`shownPage` marks it), else null. */
  gonePage(top) { return top?.goneConn ? UNKNOWN_CONNECTION : null; }
  /** Whether the connection an action started with is still listed and unchanged: re-checked after an await. */
  stillActing(acting) {
    const now = acting?.config ? configOfConnection(this.config, acting.config.connectionId) : null;
    return !!now && gateSameConfig(acting.config, now);
  }
  /** The acting connection for a line acting on a PAGE: the chosen row's box, else the PAGE's own, else the box the sidebar follows.
   *  A plain space switch or a toast-opened page leaves the drawn page and the followed box out of step, and every page-relative act must use the
   *  page it was chosen from. `top` is the page entry (`{section, id?, name?, conn?}`) or null away from a page. */
  actingOn(top, opts = {}) {
    if (opts.conn) return this.actingFor(opts.conn);
    // A page that NAMES a connection decides even when it no longer resolves: refused, never the followed box. A page naming none
    // (a section page, or one drawn before the connection was added) still acts for the followed box, as typed text does.
    if (top?.conn) return this.actingFor(top.conn);
    return this.acting();
  }
  /** The rigs a typed or chosen NAME resolves among: with several connections only the acting box's (never the first match of the merged data); with one, all, as before. */
  rigsOf(acting) {
    const rigs = sharedRigData(this.config, shared)?.topology ?? [];
    return this.perBox() && acting?.config?.connectionId ? rigs.filter((r) => r.conn === acting.config.connectionId) : rigs;
  }
  /** The connection the command registry (the grammar) is read through: it names no daemon data, so the followed box, else the first. */
  grammarConfig() { const followed = shared("rig.followed"); return (followed && configOfConnection(this.config, followed)) || this.config; }
  /** The palette's view-state lines (the selection `open-page` opens, the fold and selection a system route sets) belong to ONE box's sidebar view: the box the palette acts for (the one the sidebar
   *  follows). With several connections they go through the per-box helper; with one they are the legacy keys exactly as before (no per-box store appears). */
  perBox() { return (this.config?.connections ?? []).length > 1; }
  primaryViewId() { return this.config?.connectionId ?? LEGACY_CONNECTION_ID; }
  viewRead(key, acting) { return this.perBox() && acting?.config?.connectionId ? readSidebarView(shared, key, acting.config.connectionId, this.primaryViewId()) : shared(key); }
  viewWrite(key, value, acting) {
    if (this.perBox() && acting?.config?.connectionId) return writeSidebarView({ shared, setShared }, key, value, acting.config.connectionId, this.primaryViewId());
    setShared(key, value); return true;
  }
  cliRun(args, config = this.grammarConfig()) { const [command, rest, options] = this.cli(args, config); return execFor(config)(command, rest, options); }
  cli(args, config = this.grammarConfig()) { const c = config ? readCommand(config, args) : { command: "false", args: [] }; // never a default config before config.json is read
    return [c.command, c.args, { timeout: 30000 }]; }
  /** The acting connection's own capabilities when one is named (with several OpenRigs); else this palette's config's, as before. */
  caps(conn = null) { return connectionCapabilities(shared, this.config, conn, terminals?.() ?? []); }
  /** Closes the palette (named apart from close(), which herdr calls at teardown). */
  dismiss() { const id = props()?.overlay; if (id) closeOverlay(id); else run("mod.open", { name: MOD_IDS.palette }); }

  /** Rows for the current text: registry verbs (by name or alias) and live names to complete with. */
  rows() {
    const q = this.input.value().trim().toLowerCase();
    const [verb] = q.split(/\s+/);
    const data = sharedRigData(this.config, shared) ?? {};
    const names = [];
    // With several connections every row names its box: the label shows it and the row carries the connection it is for (choosing it acts for THAT box).
    const boxed = (rig, text) => this.perBox() && rig.conn ? { conn: rig.conn, label: `${text} · ${connectionBoxLabel(this.config, rig.conn)}` } : {};
    for (const rig of data.topology ?? []) {
      names.push({ line: `rig ${rig.name}`, hint: "Rig card", navigation: true, ...boxed(rig, rig.name) });
      for (const pod of rig.pods) for (const s of pod.seats) names.push({ line: `agent ${s.logicalId}`, hint: `Seat card · ${rig.name}`, navigation: true, ...boxed(rig, s.logicalId) });
    }
    const verbs = this.registry.filter((e) => !q || e.name.startsWith(verb) || e.aliases.some((a) => a.startsWith(verb)) || e.name === "attention" && ["need", "needs"].some(a => a.startsWith(verb)))
      .map((e) => ({ line: e.sample || `${e.name} ${e.args}`.trim(), label: e.name === "attention" ? "Needs: requests and updates for you" : null, hint: e.name === "attention" ? "" : e.description, verb: e.name, args: e.args ?? "" }));
    const live = q ? names.filter((n) => n.line.toLowerCase().includes(q)) : [];
    const designReason = capabilityDisableReason("design-view", this.caps());
    const ownRows = OWN.map((o) => o.line === "view-design" && designReason ? { ...o, hint: designReason } : o);
    const designs = (data.topology ?? []).map((rig) => ({ line: `view-design ${rig.name}`, hint: designReason ?? `Design a worker view grid · ${rig.name}`, ...boxed(rig, `view-design ${rig.name}`) }));
    const overviews = (data.topology ?? []).map((rig) => ({ line: `overview ${rig.name}`, hint: `Expand and focus ${rig.name} on Topology`, ...boxed(rig, `overview ${rig.name}`) }));
    const recents = (data.topology ?? []).map((rig) => ({ line: `recent ${rig.name}`, hint: `Recent queue transitions · ${rig.name}`, ...boxed(rig, `recent ${rig.name}`) }));
    const changeModels = (data.topology ?? []).flatMap((rig) => rig.pods.flatMap((p) => p.seats.map((s) => ({
      line: `change-model ${s.logicalId}`,
      hint: `Change harness, model, or effort · ${rig.name}`,
      ...boxed(rig, `change-model ${s.logicalId}`),
    }))));
    const own = q ? [...ownRows, ...designs, ...overviews, ...recents, ...changeModels].filter((o) => o.line.startsWith(q) || q.startsWith(o.line.split(" ")[0]) || o.label?.toLowerCase().includes(q)) : [];
    // `/text` is the grammar's page filter: offer it as a row, so typing it never reads as "No matches" before Enter applies it.
    const typed = this.input.value().trim();
    const filter = typed.length > 1 && typed.startsWith("/") ? [{ line: typed, label: `Filter this page: ${typed}`, hint: "Enter applies it" }] : [];
    return [...filter, ...own, ...live.slice(0, 8), ...verbs.slice(0, 12)];
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
    this.submit(cx, row ? row.line : this.input.value(), row?.conn ? { conn: row.conn } : {});
  }

  /** A plain live-name search selects its first local navigation result; typed grammar keeps its own semantics. */
  selectionIndex(rows = this.rows()) {
    if (this.selected >= 0) return this.selected;
    const line = this.input.value().trim();
    // Explicit local arguments belong to the typed command, even when invalid.
    if(/\s/.test(line)&&OWN.some(row=>row.line.split(/\s+/)[0]===line.split(/\s+/)[0].toLowerCase()))return -1;
    return line && !resolveTuiLineFallback(line) && rows.length ? 0 : -1;
  }

  /** Local palette commands (`operator`, `open-page`, `open-tui`, `tui`, `refresh`, `expand-all`, `collapse-all`, `view-design`, `change-model`, `notifications`). */
  own(cx, line, opts = {}) {
    const [verbRaw, arg] = line.trim().split(/\s+/);
    const verb = (verbRaw ?? "").toLowerCase();
    if ((verb === "focus-sidebar" || verb === ":focus-sidebar") && !arg) {
      this.dismiss(); run("rig.focus-sidebar"); return true;
    }
    if((verb==='all-seats'||verb===':all-seats')&&!arg){this.applyRoute({entry:{section:'topology',topologyTab:'seats'}});return true;}
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
      const acting = this.acting(); // the box the sidebar follows: its own selection, never the first box's
      if (!acting.ok) { this.error = acting.reason; this.note = null; cx.notify(); return true; }
      const entry = this.viewRead("rig.sel", acting)?.entry ?? shared("rig.nav")?.stack?.at(-1) ?? { section: "topology" };
      this.finishPage(openOrFocusRigTab({ shared, setShared, run, spaces, panes, layout }, entry));
      return true;
    }
    if ((verb === "tui" || verb === "open-tui" || verb === ":open-tui") && !arg) {
      // Wait for the sidebar's receipt, or complete the labelled local open here, before closing this palette.
      const inRigLayout = !!(function find(n) { return n && typeof n === "object" && (n.id === STACK || (n.children ?? []).some(find)); })(layout());
      const acting = this.acting(); // taken now: the box the sidebar follows (the first only with one connection)
      if (!acting.ok) { this.error = acting.reason; this.note = null; cx.notify(); return true; }
      const config = acting.config;
      this.busy = true; cx.notify();
      cx.spawn(async (cx) => {
        try {
          const result = await openOrFocusTui({ spaces, panes, terminals, hc: hcFor(config), run: runFor(config), layout, inRigLayout, wait: (ms) => new Promise((r) => cx.timer.after(ms, () => r())) }, config);
          if (result?.ok === false) notify({ title: "Open TUI", body: result.reason, level: "warning" });
        }
        finally { this.dismiss(); }
      });
      return true;
    }
    if ((verb === "expand-all" || verb === ":expand-all") && !arg) {
      if (this.config?.configInvalid) { this.error = this.config.configInvalid; cx.notify(); return true; } // a refused list opens no Rig page tab
      setShared("rig.open.page", expandAllTopology(shared("rig.open.page"), sharedRigData(this.config, shared)?.topology ?? []));
      this.finishPage(openOrFocusRigTab({ run, spaces, panes, layout, section: "topology" }));
      return true;
    }
    if ((verb === "collapse-all" || verb === ":collapse-all") && !arg) {
      if (this.config?.configInvalid) { this.error = this.config.configInvalid; cx.notify(); return true; } // a refused list opens no Rig page tab
      setShared("rig.open.page", collapseAllTopology(shared("rig.open.page"), sharedRigData(this.config, shared)?.topology ?? []));
      this.finishPage(openOrFocusRigTab({ run, spaces, panes, layout, section: "topology" }));
      return true;
    }
    if (verb === "view-design" || verb === "design-view") return this.design(cx, arg ?? null, opts);
    if (verb === "change-model") return this.changeModel(cx, arg ?? null, opts);
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
      verb === "spaces-list" || verb === ":spaces-list" ||
      verb === "pulse" || verb === ":pulse" ||
      verb === "overview" || verb === ":overview" ||
      verb === "recent" || verb === ":recent" ||
      verb === "projects" || verb === ":projects" ||
      (verb === "project" && arg) ||
      (verb === "tab" && (arg === "pulse" || arg === "overview" || arg === "recent"))
    ) {
      const top = this.shownPage() ?? { section: "topology" };
      const acting = this.actingOn(top, opts); // the row's box, else the page's, else the followed one's, never the merged list
      if (!acting.ok) { this.error = acting.reason; this.note = null; cx.notify(); return true; }
      const route = paletteRoute({ line }, top, this.rigsOf(acting));
      if (route.error) { this.error = route.error; cx.notify(); return true; }
      this.applyRoute(route, acting);
      return true;
    }
    return false;
  }

  /** `view-design [rig]`: the worker-view designer for that rig (the one alone, or the one on the Rig page, when none is named). */
  design(cx, name, opts = {}) {
    const reason = capabilityDisableReason("design-view", this.caps());
    if (reason) { this.note = reason; cx.notify(); return true; }
    const all = sharedRigData(this.config, shared)?.topology ?? [];
    const top = this.shownPage();
    let picked;
    if (name) { // a NAME resolves among the acting box's rigs (the chosen row's, else the followed one's)
      const acting = this.actingOn(top, opts); // the row's box, else the page's, else the followed one's
      if (!acting.ok) { this.error = acting.reason; this.note = null; cx.notify(); return true; }
      picked = pickRig(this.rigsOf(acting), { name, conn: opts.conn });
    } else if (this.gonePage(top)) { this.error = this.gonePage(top); this.note = null; cx.notify(); return true; } // the page in view belongs to a removed connection
    else if (top?.kind === "rig") picked = pickRig(all, { rigId: top.rigId, conn: top.conn }); // no name: the rig the PAGE shows, on its own box
    else if (this.perBox()) { this.error = "Name a rig (view-design <rig>), or open its page first: this palette works across several OpenRigs."; this.note = null; cx.notify(); return true; } // never the first
    else picked = { rig: all[0] };
    if (picked.ambiguous) { this.error = AMBIGUOUS_NAME; cx.notify(); return true; }
    const rig = picked.rig;
    if (!rig) { this.error = name ? `No rig ${name} on this daemon.` : "No rig to design a view for."; cx.notify(); return true; }
    this.open({ mod: MOD_IDS.menu, kind: "dialog", modal: true, width: 680, height: 460, props: { target: { kind: "rig", rig: rig.name, rigId: rig.id, conn: rig.conn, lifecycle: rig.lifecycle }, step: { action: "design-view" } } });
    this.dismiss();
    return true;
  }

  /** `change-model [seat]`: opens the harness/model/effort swap modal for the named seat (or the seat on the Rig page). */
  changeModel(cx, seatArg, opts = {}) {
    const all = sharedRigData(this.config, shared)?.topology ?? [];
    const top = this.shownPage();
    let picked;
    if (seatArg) { // a NAME resolves among the acting box's seats (the chosen row's, else the followed one's): `dev-one@demo` exists on each box
      const acting = this.actingOn(top, opts); // the row's box, else the page's, else the followed one's
      if (!acting.ok) { this.error = acting.reason; this.note = null; cx.notify(); return true; }
      picked = pickSeat(this.rigsOf(acting), (seat, rig) => seat.logicalId === seatArg || seat.session === seatArg || seat.member === seatArg || `${seat.logicalId}@${rig.name}` === seatArg, { conn: opts.conn });
    } else {
      // No name: the seat the PAGE shows, on its own box (never searched in another box).
      if (this.gonePage(top)) { this.error = this.gonePage(top); this.note = null; cx.notify(); return true; } // the page in view belongs to a removed connection
      const shownSeat = top?.kind === "seat" ? pickSeat(all, (seat) => seat.session === top.session || seat.logicalId === top.name, { conn: top.conn }) : {};
      if (shownSeat.seat || shownSeat.ambiguous) picked = shownSeat;
      else if (this.perBox()) { this.error = "Name a seat (change-model <seat>), or open its page first: this palette works across several OpenRigs."; this.note = null; cx.notify(); return true; } // never the first
      else picked = pickSeat(all, () => true);
    }
    if (picked.ambiguous) { this.error = AMBIGUOUS_NAME; cx.notify(); return true; }
    const hit = picked.seat ? picked : null;
    if (!hit) {
      this.error = seatArg ? `No seat ${seatArg} on this daemon.` : "No seat to change model or harness for.";
      cx.notify();
      return true;
    }
    const { rig, seat } = hit;
    this.open({
      mod: MOD_IDS.menu,
      kind: "dialog",
      modal: true,
      width: 520,
      height: 420,
      props: {
        target: {
          kind: "seat",
          rig: rig.name,
          rigId: rig.id, conn: rig.conn,
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

  submit(cx, line, opts = {}) {
    if (!line.trim()) return;
    // Before config.json has been read a refused list cannot be seen: wait, never fall back to a default config.
    if (!this.config) { this.error = CONFIG_LOADING; this.note = null; cx.notify(); return; }
    if (this.own(cx, line, opts)) return;
    // ONE acting connection for this whole submit (resolve, stamp, open-view, reads), taken now: a switch of the followed box while the line resolves cannot re-aim it.
    // The PAGE's box wins over the followed one. A space switch or a toast-opened page leaves the drawn page and the followed
    // box out of step, and every page-relative act (launch on a spec card, reply on a need, …) must act for the page it was chosen from. The
    // followed box still decides when the page names no connection, so typed text away from a page behaves as before.
    const pageTop = this.shownPage();
    const acting = this.actingOn(pageTop, opts); // a chosen row names its own box; then the page's; else the followed one
    if (!acting.ok) { this.error = acting.reason; this.note = null; cx.notify(); return; }
    this.busy = true; this.error = null; this.note = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        let res = null;
        if (this.caps().tuiResolve === false) {
          res = resolveTuiLineFallback(line);
          this.busy = false;
          if (!res) { this.note = `No matches for “${line.trim()}”. Try a section name or choose a result above.`; cx.notify(); return; }
        } else {
          const r = await this.cliRun(["tui", "resolve", ...line.trim().split(/\s+/), "--json"], acting.config);
          try { res = JSON.parse(r.stdout); } catch (_) { res = null; }
          this.busy = false;
          if (!res || typeof res.kind !== "string") {
            const errText = String(res?.error?.message ?? res?.error ?? (r.stderr || r.stdout || "rig tui resolve gave no answer")).trim();
            if (/(unknown command|too many arguments|unknown option)/i.test(errText)) {
              res = resolveTuiLineFallback(line);
              if (!res) { this.note = `No matches for “${line.trim()}”. Try a section name or choose a result above.`; cx.notify(); return; }
            } else {
              this.error = errText; cx.notify(); return;
            }
          }
        }
        // The connection this line started under is re-checked after the resolve await: a removed or edited one refuses, it never acts for another box.
        if (!this.stillActing(acting)) { this.error = CONFIG_CHANGED; cx.notify(); return; }
        if (res.kind === "error") { this.error = res.message; cx.notify(); return; }
        if (res.kind === "local" || res.kind === "noop") { this.error = `"${line}" is a TUI control; it does nothing here.`; cx.notify(); return; }
        if (!res.action || typeof res.action.type !== "string") { this.error = `rig tui resolve answered "${res.kind}" without saying what to do; is this the OpenRig that installed the Rig mods?`; cx.notify(); return; }
        const nav = shared("rig.nav") ?? { stack: [] };
        const top = this.shownPage() ?? { section: "topology" };
        const route = paletteRoute({ ...res, line }, top, this.rigsOf(acting));
        if (route.error) { this.error = route.error; cx.notify(); return; }
        if (route.note) { this.note = route.note; cx.notify(); return; }
        if (route.back) { setShared("rig.nav", navBack(nav)); this.finishPage(openOrFocusRigTab({run,spaces,panes,layout})); return; }
        if (route.act) { await this.act(cx, route, top, acting); return; }
        this.applyRoute(route, acting);
      } catch (error) {
        // A gate refusal (the settings changed while the CLI ran) is intentional; it ends the wait and says so instead of leaving the palette busy.
        this.busy = false; this.error = String(error?.message ?? error); cx.notify();
      }
    });
  }

  applyRoute(route, acting = this.acting()) {
    if(route.entry?.section==='system'){
      const entry=route.entry;
      const view=entry.openUsageHosts?'usage-hosts':entry.category||entry.settingKey?'config':entry.openRecent?'overview':entry.subview??'overview';
      route={...route,entry:{...entry,subview:view}};
      this.viewWrite('rig.open.sidebar',{...(this.viewRead('rig.open.sidebar',acting)??{}),'branch:system':true},acting);
      this.viewWrite('rig.sel',{key:`sys:${view}`,entry:route.entry,at:Date.now()},acting);
    }
    if (route.open) setShared("rig.open.page", { ...(shared("rig.open.page") ?? {}), ...route.open });
    if (route.focus) setShared("rig.focus", route.focus);
    if (route.entry?.focusRig) setShared("rig.focusRig", route.entry.focusRig);
    if (route.project) {
      setShared("rig.project", route.project);
      const prior = (shared("rig.nav")?.stack ?? []).filter((e) => e?.section !== "scopes");
      setShared("rig.nav", { stack: [...prior, this.stamped(route.entry, acting)] });
      this.finishPage(openOrFocusRigTab({ run, spaces, panes, layout, section: "scopes" }));
      return;
    }
    this.show(route.entry, acting);
  }

  /** Shows a page entry on the Rig page and closes the palette. */
  /** A page the palette opens belongs to a connection: a row's own (the palette is cross-box), else, with several connections, the box the sidebar follows. One connection: untouched. */
  stamped(entry, acting = this.acting()) { return entry && !entry.conn && acting?.ok && (this.config?.connections ?? []).length > 1 ? { ...entry, conn: acting.config.connectionId } : entry; }

  show(entry0, acting = this.acting()) {
    const entry = this.stamped(entry0, acting);
    setShared("rig.nav", navPush(shared("rig.nav"), entry));
    this.finishPage(openOrFocusRigTab({ run, spaces, panes, layout, section: entry?.section ?? "topology" }));
  }

  finishPage(result) {
    Promise.resolve(result).catch(error=>notify({title:"OpenRig",body:String(error?.message??error),level:"warning"}))
      .finally(()=>this.dismiss());
  }

  /** The operator seat of the kernel of the connection the palette acts for (the merged data holds every connection's kernel: never the first one's). */
  operatorTarget(config, topology) {
    const kernelRig = rigOfConnection(topology, "kernel", config?.connectionId);
    const operatorSeat = kernelRig?.pods?.flatMap((p) => p.seats ?? [])?.find((s) => s.logicalId === "operator.agent" || String(s.session ?? "").startsWith("operator-agent@"));
    return {
      kind: "seat",
      rig: "kernel",
      rigId: kernelRig?.id ?? "kernel",
      conn: kernelRig?.conn ?? config?.connectionId, // topology not loaded yet: the connection it acts for
      session: operatorSeat?.session ?? "operator-agent@kernel",
      logicalId: operatorSeat?.logicalId ?? "operator.agent",
      tmuxAttachCommand: operatorSeat?.tmuxAttachCommand ?? "tmux attach -t operator-agent@kernel",
      attachable: true,
    };
  }

  openOperator(cx) {
    if (!this.config) { this.error = CONFIG_LOADING; this.note = null; cx.notify(); return true; }
    const acting = this.acting(); // taken now, used for everything below
    if (!acting.ok) { this.error = acting.reason; this.note = null; cx.notify(); return true; }
    const config = acting.config;
    if (config.configInvalid) { this.error = config.configInvalid; this.note = null; cx.notify(); return true; }
    const daemonUrl = config.daemonUrl ?? sharedLoopbackDaemonUrl(config, shared("rig.data"));
    if (!isLoopbackDaemonUrl(daemonUrl)) {
      this.error = REMOTE_OPERATOR_REASON;
      this.note = null;
      cx.notify();
      return true;
    }
    const target = this.operatorTarget(config, sharedRigData(config, shared)?.topology ?? []);
    this.busy = true; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const res = await attachToSeat({ exec: execFor(config), run: runFor(config), hc: hcFor(config), spaces, panes, terminals: () => terminals?.() ?? [], layout, shared, setShared, openOverlay:spec=>this.open(spec),closeOverlay,currentConfig:()=>configOfConnection(this.config,config.connectionId),wait: waitWith(cx), relayPath: attachRelayPath(appHome(), MOD_IDS.palette) }, target, { ...config, daemonUrl }, { name: "Operator", operator: true });
        // Ask before the old viewer is stopped or closed; the confirm re-runs Attach with the replace.
        if (res?.needsViewerRefresh) this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: 320,
          props: { target, step: { action: "replace-viewer", staleViewer: res.staleViewer ?? null, operator: true, name: "Operator" } } });
        else if (res && res.ok === false && res.reason) notify({ title: "Open operator", body: res.reason, level: "warning" });
      } finally {
        this.dismiss();
      }
    });
    return true;
  }

  async resolveDaemonUrl(config = this.config) {
    if (!this.config) throw new Error(CONFIG_LOADING);
    if (this.config.configInvalid) throw new Error(this.config.configInvalid); // a refused list has no address, from anywhere
    if (config?.daemonUrl) return config.daemonUrl;
    // With several OpenRigs each names its own address: the CLI is never asked to pick a daemon (it could find another box's).
    if ((this.config.connections ?? []).length > 1) throw new Error(EXPLICIT_ADDRESS_NEEDED);
    // Another mod's shared state may name the daemon only when it's on this machine (loopback).
    const fromShared = sharedLoopbackDaemonUrl(this.config, shared("rig.data"));
    if (fromShared) {
      this.config = { ...this.config, daemonUrl: fromShared, daemonUrlSource: "cli" };
      return fromShared;
    }
    const askedUnder = this.config;
    const status = await discoverDaemonFromCli(this.config, exec);
    // The config can turn refused while the CLI answers (a list added meanwhile): the answer is for the config that asked, so it is dropped.
    if (this.config?.configInvalid) throw new Error(this.config.configInvalid);
    // And a config of another identity (another home, machine or address) must not be given this config's answer.
    if (!gateSameConfig(this.config, askedUnder)) throw new Error(CONFIG_CHANGED);
    if (status.reachable && status.daemonUrl) {
      this.config = { ...this.config, daemonUrl: status.daemonUrl, daemonUrlSource: "cli" };
      return status.daemonUrl;
    }
    throw new Error(status.message || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up').");
  }

  async get(path, config = this.acting().config) {
    const op = gatedOperationOrRefusal(config?.connectionId); // the address below belongs to the config it was resolved under: the request refuses to go if the settings changed meanwhile
    const daemonUrl = await this.resolveDaemonUrl(config);
    const r = await op.fetch(`${daemonUrl}${path}`);
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
    return stampConnection(await r.json(), config?.connectionId);
  }

  /** The work a line asks for that isn't just a page (paletteRoute's acts). Errors stay inline. */
  async act(cx, route, top, acting = this.acting()) {
    const fail = (message) => { this.error = message; cx.notify(); };
    if (["read", "slice-file", "reply", "launch"].includes(route.act) && this.gonePage(top)) return fail(this.gonePage(top)); // these act on the page in view
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
        const caps = this.caps(acting.config?.connectionId); // null: that OpenRig isn't read yet; the sidebar or the menu's dialog judges it
        const reason = caps ? capabilityDisableReason("open-view", caps) : null;
        if (reason) return note(reason);
        // Opens at once (no one-item popup, no Working… dialog): the sidebar runs it and reports.
        startOneClick({ shared, setShared, run, layout, openOverlay: (spec) => this.open(spec) }, { kind: "open-view", view: route.view, conn: acting.config?.connectionId }, "open-view");
        return this.dismiss();
      }
      if (route.act === "read") {
        // `read <root>/<path>`: the daemon's readable roots, as the TUI reads them; nothing outside them.
        const roots = (await this.get("/api/files/roots", acting.config))?.roots ?? [];
        const root = roots.find((r) => r.name === route.target.root);
        if (!root) return fail(`read: no readable root named "${route.target.root}" (${roots.map((r) => r.name).join(", ") || "none configured"}).`);
        if (unsafeReadPath(route.target.path)) return fail("Path must stay inside the readable root.");
        // The daemon's guarded read decides: `..`, absolute paths and symlinks out of the root are refused
        // there, and the file shown is the one it resolved.
        const op = gatedOperationOrRefusal(acting.config?.connectionId);
        const daemonUrl = await this.resolveDaemonUrl(acting.config);
        const url = `${daemonUrl}/api/files/read?root=${encodeURIComponent(route.target.root)}&path=${encodeURIComponent(route.target.path)}`;
        const r = await op.fetch(url);
        let body = null; try { body = await r.json(); } catch (e) { body = rethrowGate(null)(e); }
        if (!r.ok) return fail(`read: ${body?.message ?? body?.error ?? `the daemon refused it (${r.status})`}`);
        const at = typeof body?.absolutePath === "string" ? body.absolutePath : `${root.path.replace(/\/+$/, "")}/${route.target.path}`;
        return this.show({ ...fileEntry(at), ...(route.target.anchor ? { anchor: route.target.anchor } : {}) }, acting); // the connection the read began with, not one followed since
      }
      if (route.act === "slice-file") {
        const project=effectiveScopeProject(top?.project,shared('rig.project'),await this.get('/api/scopes/projects', acting.config));
        const folder = ((await this.get('/api/slices'+(project?`?project=${encodeURIComponent(project)}`:''), acting.config))?.slices ?? []).map((x) => x.slicePath).find((p) => typeof p === "string" && p.split(/[\\/]/).pop() === route.slice);
        if (!folder) return fail(`OpenRig doesn't say where ${route.slice} is on disk.`);
        return this.show(fileEntry(`${folder}/${route.file}`, `${route.file} · ${route.slice}`), acting);
      }
      if (route.act === "reply") {
        // The request shown; away from one, the only one waiting. With several waiting, none is guessed and no draft is
        // overwritten: the person opens one first, as the TUI's reply asks.
        const items = ((await this.get("/api/attention", acting.config))?.items ?? []).map(needTarget).filter((n) => !n.update && n.reply !== "none");
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
        return this.show({ section: "needs", id: target.id, name: target.summary }, acting); // the need came from acting's attention: its page is acting's
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
        const library = (await this.get("/api/specs/library", acting.config)) ?? [];
        const named = top.id ? [] : library.filter((x) => x.name === top.name);
        const spec = top.id ? library.find((x) => x.id === top.id) : named.find((x) => x.kind === "rig") ?? named[0];
        if (!spec) return fail(`${top.name ?? top.id} isn't in the spec library any more.`);
        // Rig specs only, the rule the card and the menu use.
        if (spec.kind && spec.kind !== "rig") return note(`${spec.name} is an agent spec; launch takes a rig spec.`);
        this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: LAUNCH_DIALOG_HEIGHT, props: { target: { kind: "spec", id: spec.id, conn: acting.config?.connectionId, name: spec.name, sourcePath: spec.sourcePath ?? null, specKind: "rig" }, step: { action: "launch-spec" } } });
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
        .child(div().flex_1().truncate().text_size(11.5).text_color(t.dim).tooltip(String(r.hint ?? ""??"")).child(r.hint ?? "")))))
      .when(!rows.length && !!this.input.value().trim(), el => el.child(v_flex().id("palette-no-matches").px(6).gap(4)
        .child(div().text_size(12).child(`No matches for “${this.input.value().trim()}”.`))
        .child(div().text_size(11.5).text_color(t.dim).child("Searches commands, rigs, seats and specs."))))
      .child(div().px(6).text_size(11).text_color(t.dim).child(":topology  :specs  :scopes  :terminals  :needs  :system"));
  }
}
