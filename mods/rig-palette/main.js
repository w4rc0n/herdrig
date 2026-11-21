// OpenRig's Rig palette, opened by `mod.open rig-palette` (ctrl-alt-r in the Rig layout, or the sidebar).
// It is not herdr's palette. Its rows come from the TUI's own command registry (`rig tui commands --json`, cached per
// `rig --version`) and live names from the sidebar; Enter sends the typed line to `rig tui resolve`, the TUI's own
// grammar. A navigation opens on the Rig page; an action goes through rig-menu's confirmation (one-click ones run at once, and
// `reply <words>` fills the request's inline reply); an error stays inline.
// Local commands (`LOCAL_COMMANDS`): `open-page` opens/focuses the Rig Page tab, and `open-tui` / `tui` shows the active
// space's TUI (or opens one, with the recorded CLI).
import { stampConnection, pickRig, pickSeat, seatMatchesRef, ambiguousSeatMessage, AMBIGUOUS_NAME, configOfConnection, NO_CONNECTION, UNKNOWN_CONNECTION, EXPLICIT_ADDRESS_NEEDED, LEGACY_CONNECTION_ID, connectionBoxLabel, plainExecError } from "./rig-connections.js";
import { View, div } from "gpui-kit";
import { effectiveScopeProject, readScopeProject, writeScopeProject } from './rig-project.js';
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { syncRetainedOrigins } from "./rig-space-context.js";
import { appHome, readTextFile, writeTextFile, machines, theme, run as rawRun, exec as rawExec, shared, setShared as rawSetShared, openOverlay as rawOpenOverlay, props, closeOverlay, spaces, focused, panes, terminals, hc as rawHc, layout, notify as rawNotify } from "herdr";
import { plainError, errorDiagnostic } from "./rig-words.js";
import { errorBlock, errorNotice } from "./rig-error-view.js";
const notify = value => errorNotice(rawNotify, value);
import { followedConnection, spaceMachine } from "./rig-follow.js";
import { herdrIdentityOf } from "./rig-remote.js";
import { knownOldProviderViews, readOldProviderViews, oldViewCandidates } from "./rig-old-views.js";
import { layouts } from "herdr";
import { gatedExec, gatedHc, gatedRun, gatedConnect, observeConfig, rethrowGate, gatedOperationOrRefusal, gateSameConfig, CONFIG_CHANGED, numberedConfigReads } from "./rig-gate.js";
// THE SEND GATE (rig-gate.js): every request, CLI run, process-starting Herdr command and stream connection below goes through it, checked at send time.
const exec = (command, args, options) => gatedExec(rawExec, command, args, options, undefined, undefined, appHome());
const hc = (args, bytes) => gatedHc(rawHc, args, bytes);
// A Rig sidebar command (`rig.<command>`) is sent only while the Rig sidebar is in the layout (rig-lib sidebarRun): without it,
// herdr would answer with a raw "unknown command" toast, so a person is told plainly and a background refresh is skipped.
const run = (name, args) => sidebarRun({ layout, notify }, (n, a) => gatedRun(rawRun, n, a), name, args);
// A send for a CONNECTION names its gate scope (several OpenRigs: a bare sink refuses). `config` is that connection's own config.
import { isHerdrUrl } from "./rig-openrig-http.js";
import { installHerdrTransport } from "./rig-openrig-wire.js";
const execFor = (config) => (command, args, options) => gatedExec(rawExec, command, args, options, undefined, config?.connectionId, appHome());
const hcFor = (config) => (args, bytes) => gatedHc(rawHc, args, bytes, undefined, config?.connectionId);
const runFor = (config) => (name, args) => sidebarRun({ layout, notify }, (n, a) => gatedRun(rawRun, n, a, config?.connectionId), name, args);

let flatOwner = null; // the view this mod copy is acting for
const configReads = numberedConfigReads(); // numbered config reads (see init)
const setShared = rawSetShared; // several connections key their own state (qualifyKey); no flat-store guard
import { MOD_IDS, sidebarRun, LAUNCH_DIALOG_HEIGHT, REMOTE_OPERATOR_REASON, parseConfig, discoverDaemonFromCli, readCommand, openOrFocusTui, attachToSeat, rigOfConnection, isLoopbackDaemonUrl, paletteRoute, resolveTuiLineFallback, fileEntry, draftKey, navPush, navBack, backTarget, layoutHasMod, unsafeReadPath, launchFolderProblem, needTarget, startOneClick, LOCAL_COMMANDS, currentCapabilities, connectionCapabilities, capabilityDisableReason, TUI_RESOLVE_REASON, expandAllTopology, collapseAllTopology, openOrFocusRigTab, attachRelayPath, waitWith } from "./rig-lib.js";

/** The palette's own commands, offered first when they match what is typed. */
import { sharedLoopbackDaemonUrl, sharedRigData, requestFailed, requestWhat } from "./rig-lib.js";
import { readSidebarView, writeSidebarView } from "./rig-sidebar-view-state.js";
import { registerRigRouting, stampRows, rowsIdentityOf, onScreenRigTab, tabPagesBack, tabPagesScrub } from "./rig-lib.js";
const OWN = LOCAL_COMMANDS;
const OWN_EXACT = new Set(OWN.map((o) => o.line));

const STACK = "rig-work", PAGE = "rig-page";

const COLON_COMMANDS = [
  { line: ":topology", title: "Topology", scope: "page" },
  { line: ":specs", title: "Specs", scope: "page" },
  { line: ":scopes", title: "Scopes", scope: "page" },
  { line: ":terminals", title: "Terminals", scope: "page" },
  { line: ":needs", aliases: [":needs-you"], title: "Needs", scope: "page" },
  { line: ":system", title: "System", scope: "page" },
  { line: ":pulse", title: "Topology · Pulse", scope: "page" },
  { line: ":overview", title: "Topology · Overview", scope: "page" },
  { line: ":recent", title: "Recent transitions", scope: "page" },
  { line: ":projects", title: "Scopes · Projects", scope: "page" },
  { line: ":usage-hosts", title: "System · Usage across hosts", scope: "page" },
  { line: ":people", title: "System · People", scope: "page" },
  { line: ":spaces-list", title: "System · Layout", scope: "page" },
  { line: ":all-seats", label: "OpenRig: All seats", scope: "page", hint: "Seats across every rig" },
  { line: ":focus-sidebar", label: "OpenRig: Focus sidebar", scope: "local", hint: "Select the first sidebar row" },
  { line: ":open-page", label: "Open in Page tab", scope: "page", hint: "Open or focus the Rig page tab" },
  { line: ":open-tui", label: "Open Rig TUI tab", scope: "acting", hint: "Open or switch to the Rig TUI" },
  { line: ":operator", label: "Open the operator in a tab", scope: "acting", hint: "Attach to the operator seat" },
  { line: ":expand-all", label: "Expand all sidebar branches", scope: "page", hint: "Expand branches in the sidebar tree" },
  { line: ":collapse-all", label: "Collapse sidebar branches", scope: "page", hint: "Collapse branches in the sidebar tree" },
];

const CONFIG_LOADING = "OpenRig's settings are still loading. Try again in a moment.";
export default class RigPalette extends View {
  // The send gate watches this mod's config: every assignment (a reload, a test) is seen at once; null is a constructor's placeholder.
  get config() { return this._config; }
  set config(value) { this._config = value; observeConfig(value); syncRetainedOrigins(value); this.herdr?.observe?.(value); } // its own Herdr transport forgets a changed connection's helper and cursor
  /** Every overlay this instance opens is stamped with ITS OWN config (its rows were read under it), never the latest instance's. */
  open(spec) { return rawOpenOverlay(stampRows(spec, rowsIdentityOf(this.config, spec?.props?.target?.conn))); }
  init(_p, cx) {
    flatOwner = this;
    // OpenRigs over Herdr's connection (herdr:// addresses): what the palette runs (a send, a queue row, a launch) goes through the pinned helper on
    // that machine, like the sidebar's and the page's.
    this.herdr = installHerdrTransport({ execFor: (scope) => execFor({ connectionId: scope }), hcFor: (scope) => hcFor({ connectionId: scope }), machines, wait: waitWith(cx), appHome, readTextFile, writeTextFile, config: () => this.config,
      bridgePath: () => attachRelayPath(appHome(), MOD_IDS.palette).replace(/rig-attach-relay\.cjs$/, "rig-openrig-transport.cjs") });
    const routingConfig = (conn) => conn && this.config ? (configOfConnection(this.config, conn) ?? { configInvalid: UNKNOWN_CONNECTION }) : this.config;
    registerRigRouting(cx, (context, conn) => { const cfg = routingConfig(conn); return { shared, setShared, run: runFor(cfg), spaces, panes, terminals, hc: hcFor(cfg), layout, notify, openOverlay:spec=>this.open(spec),closeOverlay,config: cfg, currentConfig: () => routingConfig(conn), wait: waitWith(context) }; });
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
      setShared("rig.oldProviderViews",await readOldProviderViews({layout,layouts,readTextFile,currentLayout:()=>shared("layout")},appHome()));
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem("registry") ?? "null"); } catch (_) { cached = null; }
      const grammar = this.grammarConfig();
      if (isHerdrUrl(grammar?.daemonUrl)) {
        if (Array.isArray(cached?.entries)) this.registry = cached.entries;
      } else {
        const version = (await this.cliRun(["--version"], grammar)).stdout.trim();
        if (cached?.version === version && Array.isArray(cached.entries)) this.registry = cached.entries;
        else {
          const r = await this.cliRun(["tui", "commands", "--json"], grammar);
          let entries = null;
          try { entries = JSON.parse(r.stdout); } catch (_) { entries = null; }
          // Anything but a list (an error object, another CLI) is said, never rendered as one: the rows would throw.
          if (Array.isArray(entries)) {
            this.registry = entries;
            try { localStorage.setItem("registry", JSON.stringify({ version, entries })); } catch (_) {}
          } else this.error = (r.stderr || (entries?.error?.message ?? entries?.error) || r.stdout || "rig tui commands gave no list").toString().trim();
        }
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
    const memo = this.drawMemo;
    if (memo && "shownPage" in memo) return memo.shownPage;
    const compute = () => {
      // The Rig tab on screen with its own history: its page, never whatever was opened last elsewhere.
      const tabPages = this.onScreenTabPages();
      if (tabPages) {
        const drawn = tabPages.stack?.at(-1) ?? null;
        return drawn?.conn && this.perBox() && !configOfConnection(this.config, drawn.conn) ? { ...drawn, conn: undefined, goneConn: drawn.conn } : drawn;
      }
      const raw = (shared("rig.nav") ?? {}).stack ?? [];
      if (!this.perBox()) return raw.at(-1) ?? null;
      const stack = raw.filter((entry) => !entry?.conn || configOfConnection(this.config, entry.conn)), top = stack.at(-1) ?? null, space = this.focusedSpace();
      const tabState = space ? this.pageTabState(space) : { hasTab: true, entry: null };
      // No Rig page tab in the space in view (a rig space of its own, a grid): no page is drawn there, so nothing on the stack is "the page"; the followed box decides.
      if (space && !tabState.hasTab) return null;
      // The page tab's OWN OpenRig, by the rule the tab itself uses: its space's OpenRig, else the OpenRig its opening entry names (a tab opened from the sidebar or the palette with 2+ OpenRigs names one).
      const opened = tabState.entry, own = this.spaceConn(space) ?? (typeof opened?.conn === "string" && configOfConnection(this.config, opened.conn) ? opened.conn : null);
      if (!own) { // the tab draws the stack's top, whoever's it is: a top whose connection is gone is the page in view, so an act that needs a page refuses (`goneConn`) while navigation and typed names go on for the followed box
        const drawn = raw.at(-1);
        return drawn?.conn && !configOfConnection(this.config, drawn.conn) ? { ...drawn, conn: undefined, goneConn: drawn.conn } : top;
      }
      if (top?.conn ? top.conn === own : own === this.primaryViewId()) return top;
      return [...stack].reverse().find((entry) => entry?.conn === own) ?? (opened?.conn === own ? opened : null); // else the tab draws the entry it was opened with
    };
    const result = compute();
    if (memo) memo.shownPage = result;
    return result;
  }
  /** The history of the Rig tab on screen, when it has its own (a Rig page drawn there keeps it), else null. */
  onScreenTabPages() {
    const tab = onScreenRigTab(() => this.drawSpaces(), () => this.drawPanes());
    return tab ? shared("rig.tabPages")?.[tab] ?? null : null;
  }
  /** Reads `panes()` once for both `hasPageTab` and `pageTabEntry`. */
  pageTabState(space) {
    try {
      const tabs = new Set((space?.tabs ?? []).map((tab) => tab?.id)), focus = focused?.();
      const pages = this.drawPanes().filter((pane) => pane?.mod === MOD_IDS.view && tabs.has(pane.tab));
      if (!pages.length) return { hasTab: false, entry: null };
      const page = pages.find((pane) => pane.tab === focus?.tab) ?? pages[0];
      return { hasTab: true, entry: page?.props?.entry ?? null };
    } catch (_) { return { hasTab: true, entry: null }; }
  }
  /** The entry the Rig page tab in that space was opened with (Herdr keeps a tab's props), the focused tab's first, else null. */
  pageTabEntry(space) { return this.pageTabState(space).entry; }
  /** The space in view (the focused one), or null. */
  focusedSpace() {
    try { const focus = focused?.(); return focus ? this.drawSpaces().find((sp) => sp.id === focus.space) ?? null : null; } catch (_) { return null; }
  }
  /** Herdr's spaces and panes, read once per draw (each read is a native call that copies the list). */
  drawSpaces() { const memo = this.drawMemo; if (!memo) return spaces?.() ?? []; return (memo.spaces ??= spaces?.() ?? []); }
  drawPanes() { const memo = this.drawMemo; if (!memo) return panes?.() ?? []; return (memo.panes ??= panes?.() ?? []); }
  /** Whether a Rig page tab (mod rig-view) is in that space: the only thing in a space that draws a page. */
  hasPageTab(space) { return this.pageTabState(space).hasTab; }
  /** The OpenRig of the MACHINE space in view, when that machine has exactly one; else null (a space on this computer, a machine with none or several). */
  spaceConn(space = this.focusedSpace()) {
    if (!space || !spaceMachine(space)) return null;
    const picked = followedConnection({ connections: this.config?.connections ?? [], space });
    return picked.why === "space" ? picked.id : null;
  }
  /** The refusal for an act that needs the shown page when that page belongs to a removed connection (`shownPage` marks it), else null. */
  gonePage(top) { return top?.goneConn ? UNKNOWN_CONNECTION : null; }
  /** Whether the connection an action started with is still listed and unchanged: re-checked after an await. */
  async stillActing(acting) {
    // The palette read config.json once, when it opened: re-read it now, so a connection removed or edited while the line resolved is seen (a compare against the old copy could never differ).
    try { this.config = await configReads(async () => parseConfig(await readTextFile(`${appHome()}/openrig/config.json`))); } catch (_) { return false; }
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
  /** The connection the command registry (the grammar) is read through: it names no daemon data, so the followed box when not `herdr://`, else the first non-`herdr://` connection, else the first. */
  grammarConfig() {
    const followed = shared("rig.followed"), own = followed && configOfConnection(this.config, followed);
    if (own && !isHerdrUrl(own.daemonUrl)) return own;
    const local = (this.config?.connections ?? []).find((c) => !isHerdrUrl(c?.daemonUrl));
    return (local && configOfConnection(this.config, local.id)) || own || this.config;
  }
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
  /** Reads `shared("rig.data")` at most once per draw (`drawMemo.rigData`). */
  rawRigData() {
    const memo = this.drawMemo;
    if (memo && "rigData" in memo) return memo.rigData;
    const value = shared("rig.data");
    if (memo) memo.rigData = value;
    return value;
  }
  /** The acting connection's own capabilities when one is named (with several OpenRigs); else this palette's config's, as before.
   *  Over Herdr's connection (`herdr://`), `HerdrTransport.cli` carries only the allowlisted write shapes, so `tuiResolve` is `false`. */
  caps(conn = null) {
    const memo = this.drawMemo;
    const compute = (sharedFn, terms) => {
      const val = connectionCapabilities(sharedFn, this.config, conn, terms);
      const cfg = conn ? configOfConnection(this.config, conn) : this.config;
      return val && isHerdrUrl(cfg?.daemonUrl) ? { ...val, tuiResolve: false } : val;
    };
    if (!memo) return compute(shared, terminals?.() ?? []);
    const key = conn ?? "";
    if (memo.caps?.has(key)) return memo.caps.get(key);
    memo.terms ??= terminals?.() ?? [];
    const sharedFn = (k) => (k === "rig.data" ? this.rawRigData() : k === "rig.capabilities" ? ("rawCaps" in memo ? memo.rawCaps : (memo.rawCaps = shared("rig.capabilities"))) : shared(k));
    const val = compute(sharedFn, memo.terms);
    (memo.caps ??= new Map()).set(key, val);
    return val;
  }
  /** Closes the palette (named apart from close(), which herdr calls at teardown). */
  dismiss() { this.sayInFlight(); const id = props()?.overlay; if (id) closeOverlay(id); else run("mod.open", { name: MOD_IDS.palette }); }
  /** herdr's teardown (a click beside the palette, a reload): what is running is said first, as dismiss() does. */
  async close() { this.sayInFlight(); try { this.herdr?.release?.(); } catch (_) {} }
  /** Open operator or Open TUI was still running when the palette closed (Esc, a click beside it). herdr drops a closed palette's tasks, so the step's result is never seen: a viewer may be
   *  half started and a failure would go unsaid. Said once, in words; a step that finishes clears `running` before it dismisses the palette itself, so it says nothing then. */
  sayInFlight() {
    const running = this.running;
    if (!running) return;
    this.running = null;
    try {
      notify({ title: "OpenRig", level: "warning", body: running === "operator"
        ? "Open operator was still running when you closed the palette. The operator's tab may be half started: check it, and use Open operator again if it is missing."
        : "Open TUI was still opening when you closed the palette. Check its tab, and use Open TUI again if it is missing." });
    } catch (_) { /* nothing more can be said */ }
  }

  /** Box label for `"page"` (`actingOn(shownPage())`) or `"acting"` (`acting()`) commands when several OpenRigs are configured, else null. */
  boxName(scope = "page") {
    if (!this.perBox() || scope === "local") return null;
    const acting = scope === "page" ? this.actingOn(this.shownPage()) : this.acting();
    return acting?.ok && acting.config?.connectionId ? connectionBoxLabel(this.config, acting.config.connectionId) : null;
  }

  /** Top row(s) derived from the TUI grammar (`resolveTuiLineFallback` + `paletteRoute`) so valid typed lines never say "No matches" or drift from `submit()`. */
  typedRows(typed, designReason) {
    if (!typed) return [];
    const q = typed.toLowerCase();
    let pageBox, actingBox;
    const getPageBox = () => (pageBox === undefined ? (pageBox = this.boxName("page")) : pageBox);
    const getActingBox = () => (actingBox === undefined ? (actingBox = this.boxName("acting")) : actingBox);
    if (q.startsWith(":")) {
      const boxSuffix = (scope) => {
        const b = scope === "local" ? null : scope === "page" ? getPageBox() : getActingBox();
        return b ? ` on ${b}` : "";
      };
      const labelOf = (c) => c.title ? `Go to ${c.title}${boxSuffix(c.scope)}` : `${c.label}${boxSuffix(c.scope)}`;
      const exact = COLON_COMMANDS.filter((c) => c.line === q || c.aliases?.includes(q))
        .map((c) => ({ line: typed, label: labelOf(c), hint: c.scope === "local" ? (c.hint ?? "Enter runs it") : "Enter opens it", wide: true }));
      const prefixes = COLON_COMMANDS.filter((c) => c.line !== q && !c.aliases?.includes(q) && (c.line.startsWith(q) || c.aliases?.some((a) => a.startsWith(q))))
        .map((c) => ({ line: c.line, label: labelOf(c), hint: c.hint ?? c.line, wide: true }));
      return [...exact, ...prefixes.slice(0, 12)];
    }
    const space = typed.search(/\s/);
    const verb = (space < 0 ? typed : typed.slice(0, space)).toLowerCase();
    const rest = space < 0 ? "" : typed.slice(space + 1).trim();
    if (!rest && OWN_EXACT.has(verb)) return [];
    // Palette-local verbs handled directly in `own()` outside `resolveTuiLineFallback`.
    if (!rest && verb === "refresh") return [{ line: typed, label: "Refresh OpenRig data", hint: "Re-read sidebar and page data", verb: "refresh", args: "", wide: true }];
    if (!rest && (verb === "help" || verb === "?")) return [{ line: typed, label: "Clear command input", hint: "Show all palette commands", verb: "help", args: "", wide: true }];
    if (!rest && verb === "open-operator") {
      const b = getActingBox();
      return [{ line: typed, label: `Open the operator in a tab${b ? ` on ${b}` : ""}`, hint: "Attach to the operator seat", verb: "open-operator", args: "", wide: true }];
    }
    if (verb === "notifications" && rest) {
      const notifRoute = paletteRoute({ line: typed }, null, []);
      return notifRoute.error ? [] : [{ line: typed, label: `Turn notifications ${notifRoute.value ? "on" : "off"}`, hint: "Enter updates setting", wide: true }];
    }
    const resolved = resolveTuiLineFallback(typed);
    if (!resolved) return [];
    const a = resolved.action ?? {};
    if (typed.startsWith("/") && !a.text) return [];
    const shown = this.shownPage();
    if (a.type === "tab") {
      const validTab = !paletteRoute(resolved, { section: "topology", kind: "rig" }, []).error
        || !paletteRoute(resolved, { section: "specs", id: "spec" }, []).error;
      if (!validTab) return [];
    } else if (a.type === "file-open") {
      if (!a.target?.path?.trim() || paletteRoute(resolved, shown, []).error) return [];
    } else if (paletteRoute(resolved, shown, []).error) {
      return [];
    }
    const pb = getPageBox();
    const onPage = pb ? ` on ${pb}` : "", dotPage = pb ? ` · ${pb}` : "";
    const row = (label, hint, bareVerb = null) => [{
      line: typed,
      label,
      hint,
      ...(bareVerb ? { verb: bareVerb, args: "" } : {}),
      wide: true,
    }];
    switch (a.type) {
      case "filter": return row(`Filter this page: ${typed.startsWith("/") ? typed : a.text}${dotPage}`, "Enter applies it");
      case "drill": return row(`Open ${{ agent: "seat" }[a.resource] ?? a.resource} ${a.name}${onPage}`, "Enter opens it");
      case "cross": return row(a.kind === "spec-of" ? `Open spec of ${a.name}${onPage}` : `Filter Topology by spec ${a.name}${onPage}`, "Enter opens it");
      case "scopes-mission-open": return row(`Open mission ${a.mission}${onPage}`, "Enter opens it");
      case "scopes-open": return row(`Open slice ${rest}${onPage}`, "Enter opens it");
      case "scopes-project": return row(`Select project ${a.project}${onPage}`, "Enter opens Scopes");
      case "scopes-projects": return row(`Go to Scopes · Projects${onPage}`, "Switch project on Scopes", "projects");
      case "scopes-reqs": return row(`Slice requirements${onPage}`, "Check requirements on the shown slice", "reqs");
      case "scopes-narrative": return row(`Open slice PROGRESS.md${onPage}`, "Read PROGRESS.md on the shown slice", "narrative");
      case "tab": return row(`Switch view tab to ${a.tab}${onPage}`, !rest ? "Open the topology graph view" : "Enter switches it", !rest ? "graph" : null);
      case "back": return row("Back to previous page", "Return to the previous view", "back");
      case "jump":
        if (resolved.area === "terminals") return row(`Go to Terminals${onPage}`, "Saved and active terminal views", "terminals");
        if (resolved.area === "needs") return row(`Needs: requests and updates for you${dotPage}`, "", "attention");
        if (resolved.area === "system") return row(`Go to System${onPage}`, "Health, Configuration and Connections", "system");
        return row(`Go to ${resolved.area}${onPage}`, "Enter opens it", !rest ? verb : null);
      case "config-open": return row(`Go to System · Configuration${onPage}`, "Browse instance settings", "config");
      case "config-category": return row(`Go to System · Configuration (${a.category})${onPage}`, "Enter opens it");
      case "config-setting": return row(`Open setting ${a.key}${onPage}`, "Enter opens it");
      case "terminal-preview": return row(`Preview terminal view ${a.view}${onPage}`, "Enter opens Terminals");
      case "act": return row(`Open terminal view ${a.view}${onPage}`, "Enter opens it");
      case "file-open": return row(`Read ${rest}${onPage}`, "Enter opens it");
      case "attention-reply": return row(`Draft reply${onPage}: ${a.text}`, "Enter fills the request reply");
      case "spec-launch": return row(`Launch rig from spec${onPage}`, "Open Launch dialog for the shown rig spec", "launch");
      case "launch-folder": return row(`Set launch folder: ${a.folder}`, "Enter remembers it for Launch");
      case "launch-host": return row(`Set launch host: ${a.host}`, "Enter remembers it for Launch");
      case "overview": return row(a.rig ? `Expand and focus ${a.rig}${onPage}` : `Go to Topology · Overview${onPage}`, "Enter opens Topology");
      case "recent": return row(!a.target || a.target === "instance" ? `Recent queue transitions${onPage}` : `Recent queue transitions for ${a.target}${onPage}`, "Enter opens it");
      case "design-view": {
        const dr = typeof designReason === "function" ? designReason() : designReason;
        return row(a.rig ? `Design worker view for ${a.rig}${onPage}` : `Design worker view${onPage}`, dr ?? "Enter opens designer");
      }
      case "change-model": return row(a.seat ? `Change model or harness for ${a.seat}${onPage}` : `Change model or harness${onPage}`, "Enter opens dialog");
      default: return row(`Run ${typed}${onPage}`, "Enter runs it", !rest ? verb : null);
    }
  }

  /** Rows for the current text: registry verbs (by name or alias) and live names to complete with. */
  rows() {
    const typed = this.input.value().trim();
    if (!typed) {
      return this.registry.slice(0, 12).map((e) => ({
        line: e.sample || `${e.name} ${e.args}`.trim(),
        label: e.name === "attention" ? "Needs: requests and updates for you" : null,
        hint: e.name === "attention" ? "" : e.description,
        verb: e.name,
        args: e.args ?? "",
      }));
    }
    const ownsMemo = !this.drawMemo;
    if (ownsMemo) this.drawMemo = {};
    try {
      const q = typed.toLowerCase();
      const hasArg = /\s/.test(q);
      const [verb] = q.split(/\s+/);
      let actingCapsLoaded = false, actingCaps = null, actingDesignReason;
      const getActingCaps = () => {
        if (!actingCapsLoaded) {
          actingCapsLoaded = true;
          const pageActing = this.actingOn(this.shownPage());
          actingCaps = pageActing.ok ? this.caps(pageActing.config?.connectionId) : (this.perBox() ? null : this.caps(this.config?.connectionId));
        }
        return actingCaps;
      };
      const getActingDesignReason = () => {
        if (actingDesignReason === undefined) {
          const c = getActingCaps();
          actingDesignReason = c ? capabilityDisableReason("design-view", c) : null;
        }
        return actingDesignReason;
      };
      const head = this.typedRows(typed, getActingDesignReason);
      if (q.startsWith(":")) return head;
      const sharedOnce = (k) => (k === "rig.data" ? this.rawRigData() : shared(k));
      const data = sharedRigData(this.config, sharedOnce) ?? {};
      const perBox = this.perBox();
      const boxLabels = new Map();
      const boxLabel = (conn) => {
        if (!boxLabels.has(conn)) boxLabels.set(conn, connectionBoxLabel(this.config, conn));
        return boxLabels.get(conn);
      };
      // With several connections every row names its box: the label shows it and the row carries the connection it is for (choosing it acts for THAT box).
      const boxed = (rig, text) => (perBox && rig.conn ? { conn: rig.conn, label: `${text} · ${boxLabel(rig.conn)}` } : {});
      const notExactUnboxed = (hasConn, lineLower) => hasConn || !head.length || lineLower !== q;
      const live = [];
      for (const rig of data.topology ?? []) {
        if (live.length >= 8) break;
        const hasConn = Boolean(perBox && rig.conn);
        const rigLine = `rig ${rig.name}`, rigLower = rigLine.toLowerCase();
        if (rigLower.includes(q) && notExactUnboxed(hasConn, rigLower)) {
          live.push({ line: rigLine, rigId: rig.id, hint: "Rig card", navigation: true, ...boxed(rig, rig.name) });
        }
        for (const pod of rig.pods) {
          if (live.length >= 8) break;
          for (const s of pod.seats) {
            if (live.length >= 8) break;
            const seatRef = `${s.logicalId}@${rig.name}`;
            const seatLine = `agent ${seatRef}`, seatLower = seatLine.toLowerCase();
            if (seatLower.includes(q) && notExactUnboxed(hasConn, seatLower)) {
              live.push({ line: seatLine, rigId: rig.id, hint: `Seat card · ${rig.name}`, navigation: true, ...boxed(rig, seatRef) });
            }
          }
        }
      }
      const headVerbs = new Set(head.map((r) => r.verb).filter(Boolean));
      const verbs = (hasArg && head.length) || (typed.length > 1 && typed.startsWith("/"))
        ? []
        : this.registry.filter((e) => !headVerbs.has(e.name) && (hasArg ? e.name === verb || e.aliases.includes(verb) : e.name.startsWith(verb) || e.aliases.some((a) => a.startsWith(verb)) || e.name === "attention" && ["need", "needs"].some(a => a.startsWith(verb))))
          .slice(0, 12)
          .map((e) => ({ line: hasArg ? typed : (e.sample || `${e.name} ${e.args}`.trim()), label: e.name === "attention" ? "Needs: requests and updates for you" : null, hint: e.name === "attention" ? "" : e.description, verb: e.name, args: hasArg ? "" : (e.args ?? "") }));
      const matchesOwn = (line, firstWord, label, hasConn) => {
        const ll = line.toLowerCase();
        return (ll.startsWith(q) || q.startsWith(firstWord) || Boolean(label && label.toLowerCase().includes(q))) && notExactUnboxed(hasConn, ll);
      };
      const own = [];
      if (knownOldProviderViews(layout(),shared("rig.oldProviderViews")??[]).length && oldViewCandidates(this.config, conn => this.caps(conn)).length
        && "close old worker views".includes(q)) {
        own.push({line:"close-old-worker-views",label:"Close OpenRig's old views",hint:"Only their viewers end; your seats keep running"});
      }
      for (const o of OWN) {
        if (matchesOwn(o.line, o.line.split(" ")[0], o.label, Boolean(o.conn))) {
          own.push(o);
        }
      }
      const topology = data.topology ?? [];
      for (const rig of topology) {
        const hasConn = Boolean(perBox && rig.conn);
        const line = `overview ${rig.name}`;
        const label = hasConn ? `${line} · ${boxLabel(rig.conn)}` : undefined;
        if (matchesOwn(line, "overview", label, hasConn)) {
          own.push({ line, rigId: rig.id, hint: `Expand and focus ${rig.name} on Topology`, ...(hasConn ? { conn: rig.conn, label } : {}) });
        }
      }
      for (const rig of topology) {
        const hasConn = Boolean(perBox && rig.conn);
        const line = `recent ${rig.name}`;
        const label = hasConn ? `${line} · ${boxLabel(rig.conn)}` : undefined;
        if (matchesOwn(line, "recent", label, hasConn)) {
          own.push({ line, rigId: rig.id, hint: `Recent queue transitions · ${rig.name}`, ...(hasConn ? { conn: rig.conn, label } : {}) });
        }
      }
      for (const rig of topology) {
        const hasConn = Boolean(perBox && rig.conn);
        const suffix = hasConn ? ` · ${boxLabel(rig.conn)}` : "";
        for (const p of rig.pods) for (const s of p.seats) {
          const seatRef = `${s.logicalId}@${rig.name}`;
          const line = `change-model ${seatRef}`;
          const label = hasConn ? `${line}${suffix}` : undefined;
          if (matchesOwn(line, "change-model", label, hasConn)) {
            own.push({ line, rigId: rig.id, hint: `Change harness, model, or effort · ${rig.name}`, ...(hasConn ? { conn: rig.conn, label } : {}) });
          }
        }
      }
      return [...head, ...own, ...live, ...verbs];
    } finally {
      if (ownsMemo) this.drawMemo = null;
    }
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
    this.submit(cx, row ? row.line : this.input.value(), {
      ...(row?.conn ? { conn: row.conn } : {}),
      ...(row?.rigId ? { rigId: row.rigId } : {}),
    });
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
    if ((verb === "all-seats" || verb === ":all-seats") && !arg) {
      const top = this.shownPage();
      const acting = this.actingOn(top, opts);
      if (!acting.ok) { this.error = acting.reason; this.note = null; cx.notify(); return true; }
      this.applyRoute({ entry: { section: "topology", topologyTab: "seats" } }, acting);
      return true;
    }
    if ((verb === "help" || verb === "?") && !arg) {
      this.input.set_value(""); this.selected = -1; this.error = null; this.note = null; this.input.focus(); cx.notify(); return true;
    }
    if ((verb === "operator" || verb === ":operator" || verb === "open-operator") && !arg) {
      return this.openOperator(cx);
    }
    // The TUI's refresh re-reads its own view; here the sidebar re-reads (the page follows it).
    if (verb === "refresh" && !arg) { run("rig.refresh"); this.dismiss(); return true; }
    if (verb === "close-old-worker-views" && !arg) {
      const views = knownOldProviderViews(layout(),shared("rig.oldProviderViews")??[]);
      if (!views.length || !oldViewCandidates(this.config, conn => this.caps(conn)).length) {
        this.error = views.length ? "Close OpenRig's old worker views with their Herdr tabs; seats keep running." : "There are no old worker views in this window.";
        cx.notify(); return true;
      }
      this.open({mod:MOD_IDS.menu,kind:"dialog",width:600,height:340,
        props:{target:{kind:"old-views"},step:{action:"close-old-views",views,confirm:true}}});
      this.dismiss(); return true;
    }
    if ((verb === "open-page" || verb === ":open-page") && !arg) {
      const shown = this.shownPage();
      const acting = this.actingOn(shown, opts); // the page's box when a Rig tab is in view, else the box the sidebar follows
      if (!acting.ok) { this.error = acting.reason; this.note = null; cx.notify(); return true; }
      const conn = acting.config?.connectionId;
      const ownShown = shown && !shown.goneConn && (!this.perBox() || !shown.conn || shown.conn === conn) ? shown : null;
      const ownStackTop = this.onScreenTabPages() ? this.onScreenTabPages().stack?.at(-1) : this.perBox()
        ? [...(shared("rig.nav")?.stack ?? [])].reverse().find((e) => (e?.conn ? e.conn === conn : conn === this.primaryViewId()))
        : shared("rig.nav")?.stack?.at(-1);
      const entry = this.stamped(this.viewRead("rig.sel", acting)?.entry ?? ownShown ?? ownStackTop ?? { section: "topology" }, acting);
      this.finishPage(this.openTab(entry, acting));
      return true;
    }
    if ((verb === "tui" || verb === "open-tui" || verb === ":open-tui") && !arg) {
      // Wait for the sidebar's receipt, or complete the labelled local open here, before closing this palette.
      const inRigLayout = !!(function find(n) { return n && typeof n === "object" && (n.id === STACK || (n.children ?? []).some(find)); })(layout());
      const acting = this.acting(); // taken now: the box the sidebar follows (the first only with one connection)
      if (!acting.ok) { this.error = acting.reason; this.note = null; cx.notify(); return true; }
      const config = acting.config;
      this.busy = true; this.running = "tui"; cx.notify();
      cx.spawn(async (cx) => {
        try {
          const result = await openOrFocusTui({ spaces, panes, terminals, hc: hcFor(config), run: runFor(config), layout, inRigLayout, wait: (ms) => new Promise((r) => cx.timer.after(ms, () => r())) }, config);
          if (result?.ok === false) notify({ title: "Open TUI", body: result.reason, level: "warning" });
        }
        finally { this.running = null; this.dismiss(); }
      });
      return true;
    }
    if ((verb === "expand-all" || verb === ":expand-all" || verb === "collapse-all" || verb === ":collapse-all") && !arg) {
      if (this.config?.configInvalid) { this.error = this.config.configInvalid; cx.notify(); return true; } // a refused list opens no Rig page tab
      const top = this.shownPage();
      const acting = this.actingOn(top, opts);
      if (!acting.ok) { this.error = acting.reason; this.note = null; cx.notify(); return true; }
      const fn = verb.includes("expand") ? expandAllTopology : collapseAllTopology;
      setShared("rig.open.page", fn(shared("rig.open.page"), this.rigsOf(acting)));
      const entry = top?.section === "topology" && !top.goneConn && !top.rigId && !top.rig ? top : { section: "topology" };
      this.show(entry, acting);
      return true;
    }
    if (verb === "view-design" || verb === "design-view") {
      this.error = "Worker views use Herdr's tabs. Open Worker view from the rig.";
      this.note = null; cx.notify(); return true;
    }
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
    const all = sharedRigData(this.config, shared)?.topology ?? [];
    const top = this.shownPage();
    let picked;
    if (name) { // a NAME resolves among the acting box's rigs (the chosen row's, else the followed one's)
      const acting = this.actingOn(top, opts); // the row's box, else the page's, else the followed one's
      if (!acting.ok) { this.error = acting.reason; this.note = null; cx.notify(); return true; }
      const caps = this.caps(acting.config?.connectionId);
      const reason = caps ? capabilityDisableReason("design-view", caps) : null;
      if (reason) { this.note = reason; cx.notify(); return true; }
      picked = pickRig(this.rigsOf(acting), { name, conn: opts.conn, rigId: opts.rigId });
    } else if (this.gonePage(top)) { this.error = this.gonePage(top); this.note = null; cx.notify(); return true; } // the page in view belongs to a removed connection
    else if (top?.kind === "rig") {
      const caps = this.caps(top.conn ?? null);
      const reason = caps ? capabilityDisableReason("design-view", caps) : null;
      if (reason) { this.note = reason; cx.notify(); return true; }
      picked = pickRig(all, { rigId: top.rigId, conn: top.conn }); // no name: the rig the PAGE shows, on its own box
    } else if (this.perBox()) { this.error = "Name a rig (view-design <rig>), or open its page first: this palette works across several OpenRigs."; this.note = null; cx.notify(); return true; } // never the first
    else {
      const caps = this.caps(this.config?.connectionId);
      const reason = capabilityDisableReason("design-view", caps);
      if (reason) { this.note = reason; cx.notify(); return true; }
      picked = { rig: all[0] };
    }
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
      picked = pickSeat(this.rigsOf(acting), (seat, rig, pod) => seatMatchesRef(seat, rig, pod, seatArg), { conn: opts.conn, rigId: opts.rigId });
    } else {
      // No name: the seat the PAGE shows, on its own box (never searched in another box).
      if (this.gonePage(top)) { this.error = this.gonePage(top); this.note = null; cx.notify(); return true; } // the page in view belongs to a removed connection
      const shownSeat = top?.kind === "seat"
        ? pickSeat(
            all,
            (seat, rig) => (top.session ? seat.session === top.session : seat.logicalId === top.name) && (!top.rig || rig.name === top.rig),
            { conn: top.conn, rigId: top.rigId },
          )
        : {};
      if (shownSeat.seat || shownSeat.ambiguous) picked = shownSeat;
      else if (this.perBox()) { this.error = "Name a seat (change-model <seat>), or open its page first: this palette works across several OpenRigs."; this.note = null; cx.notify(); return true; } // never the first
      else picked = pickSeat(all, () => true, { allowFirst: true });
    }
    if (picked.ambiguous) {
      this.error = ambiguousSeatMessage(seatArg ?? top?.name ?? "seat", picked, { write: true });
      cx.notify();
      return true;
    }
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
        const actingCaps = this.caps(acting.config?.connectionId);
        if (isHerdrUrl(acting.config?.daemonUrl) || actingCaps?.tuiResolve === false) {
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
        if (!(await this.stillActing(acting))) { this.error = CONFIG_CHANGED; cx.notify(); return; }
        if (res.kind === "error") { this.error = res.message; cx.notify(); return; }
        if (res.kind === "local" || res.kind === "noop") { this.error = `"${line}" is a TUI control; it does nothing here.`; cx.notify(); return; }
        if (!res.action || typeof res.action.type !== "string") { console.error(`rig tui resolve answered "${res.kind}" without an action`); this.error = "The Rig palette couldn't open this: OpenRig's TUI answered with a step it doesn't support here."; cx.notify(); return; }
        const nav = shared("rig.nav") ?? { stack: [] };
        // The page the line was typed on, as `acting` is its OpenRig: a page shown by the time the resolve answers never re-aims the act.
        const top = pageTop ?? { section: "topology" };
        const route = paletteRoute({ ...res, line, ...(opts.conn ? { conn: opts.conn } : {}), ...(opts.rigId ? { rigId: opts.rigId } : {}) }, top, this.rigsOf(acting));
        if (route.error) { this.error = route.error; cx.notify(); return; }
        if (route.note) { this.note = route.note; cx.notify(); return; }
        if (route.back) { this.goBack(nav, pageTop, acting); return; }
        if (route.act) { await this.act(cx, route, top, acting); return; }
        this.applyRoute(route, acting);
      } catch (error) {
        // A gate refusal (the settings changed while the CLI ran) is intentional; it ends the wait and says so instead of leaving the palette busy.
        this.busy = false; this.error = plainExecError(error, { kind: "read" }); cx.notify();
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
      const stampedEntry = this.stamped(route.entry, acting);
      const conn = stampedEntry?.conn ?? acting?.config?.connectionId ?? null;
      writeScopeProject({ shared, setShared }, this.config, conn, route.project);
      const prior = (shared("rig.nav")?.stack ?? []).filter((e) => e?.section !== "scopes" || (e.conn ?? null) !== (stampedEntry?.conn ?? null));
      setShared("rig.nav", { stack: [...prior, stampedEntry] });
      // ...and from every Rig tab's own history: Back after a project switch never returns to the old project's mission or slice.
      const tabs = shared("rig.tabPages");
      if (tabs && typeof tabs === "object") {
        const several = (this.config?.connections?.length ?? 0) > 1;
        const scrubbed = tabPagesScrub(tabs, (e) => e?.section === "scopes" && (e.conn ?? null) === (stampedEntry?.conn ?? null), { conn: several ? conn : null, several });
        if (scrubbed !== tabs) setShared("rig.tabPages", scrubbed);
      }
      this.finishPage(this.openTab(stampedEntry, acting));
      return;
    }
    this.show(route.entry, acting);
  }

  /** Shows a page entry on the Rig page and closes the palette. */
  /** A page the palette opens belongs to a connection: a row's own (the palette is cross-box), else, with several connections, the box the sidebar follows. One connection: untouched. */
  stamped(entry, acting = this.acting()) { return entry && !entry.conn && acting?.ok && (this.config?.connections ?? []).length > 1 ? { ...entry, conn: acting.config.connectionId } : entry; }

  openTab(entry0, acting = this.acting()) {
    const entry = this.stamped(entry0, acting);
    const cfg = acting?.config ?? this.config;
    const conn = entry?.conn ?? cfg?.connectionId;
    const routingConfig = () => (conn && this.config ? (configOfConnection(this.config, conn) ?? { configInvalid: UNKNOWN_CONNECTION }) : this.config);
    return openOrFocusRigTab({ shared, setShared, run: runFor(cfg), spaces, panes, layout, config: cfg, currentConfig: routingConfig, section: entry?.section ?? "topology", mayCreate: true }, entry);
  }

  goBack(nav, pageTop, acting = this.acting()) {
    // Back on the Rig tab on screen: its own visit order, never another tab's.
    const tab = onScreenRigTab(spaces, panes), pages = shared("rig.tabPages") ?? {};
    if (tab && pages[tab]) {
      const next = tabPagesBack(pages, tab, { fallback: pages[tab].stack?.at(-1) ?? null });
      if (next !== pages) setShared("rig.tabPages", next);
      this.finishPage({ ok: true, stayed: true });
      return;
    }
    const backConn = this.perBox() ? (acting?.config?.connectionId ?? pageTop?.conn ?? null) : null;
    const fallback = pageTop && !pageTop.goneConn ? this.stamped(pageTop, acting) : null;
    const navOpts = { fallback, primaryConn: this.primaryViewId() };
    const target = backTarget(nav, backConn, navOpts);
    const nextNav = navBack(nav, backConn, navOpts);
    const ownLast = backConn
      ? [...(nextNav.stack ?? [])].reverse().find((e) => (e?.conn ? e.conn === backConn : backConn === this.primaryViewId()))
      : nextNav.stack?.at(-1);
    const backEntry = this.stamped(target ?? ownLast ?? fallback ?? { section: "topology" }, acting);
    setShared("rig.nav", nextNav.stack?.length ? nextNav : { stack: [backEntry] });
    this.finishPage(this.openTab(backEntry, acting));
  }

  show(entry0, acting = this.acting()) {
    const entry = this.stamped(entry0, acting);
    setShared("rig.nav", navPush(shared("rig.nav"), entry));
    this.finishPage(this.openTab(entry, acting));
  }

  finishPage(result) {
    Promise.resolve(result).catch(error=>notify({title:"OpenRig",body:errorDiagnostic(error),level:"warning"}))
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

  openOperator(cx, opts = {}) {
    if (!this.config) { this.error = CONFIG_LOADING; this.note = null; cx.notify(); return true; }
    const acting = opts.conn ? this.actingFor(opts.conn) : this.acting(); // taken now, used for everything below
    if (!acting.ok) { this.error = acting.reason; this.note = null; cx.notify(); return true; }
    const config = acting.config;
    if (config.configInvalid) { this.error = config.configInvalid; this.note = null; cx.notify(); return true; }
    const daemonUrl = config.daemonUrl ?? sharedLoopbackDaemonUrl(config, shared("rig.data"));
    if (!isLoopbackDaemonUrl(daemonUrl) && !herdrIdentityOf({ ...config, daemonUrl })) { // a switched box's operator is reached like its seats
      this.error = REMOTE_OPERATOR_REASON;
      this.note = null;
      cx.notify();
      return true;
    }
    const target = this.operatorTarget(config, sharedRigData(config, shared)?.topology ?? []);
    this.busy = true; this.running = "operator"; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const res = await attachToSeat({ exec: execFor(config), run: runFor(config), hc: hcFor(config), spaces, panes, terminals: () => terminals?.() ?? [], layout, shared, setShared, openOverlay:spec=>this.open(spec),closeOverlay,currentConfig:()=>configOfConnection(this.config,config.connectionId),wait: waitWith(cx), relayPath: attachRelayPath(appHome(), MOD_IDS.palette) }, target, { ...config, daemonUrl }, { name: "Operator", operator: true });
        // Ask before the old viewer is stopped or closed; the confirm re-runs Attach with the replace.
        if (res?.needsViewerRefresh) this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: 320,
          props: { target, step: { action: "replace-viewer", staleViewer: res.staleViewer ?? null, operator: true, name: "Operator" } } });
        else if (res && res.ok === false && res.reason) notify({ title: "Open operator", body: res.reason, level: "warning" });
      } finally {
        this.running = null;
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
    if (!r.ok) throw new Error(requestFailed(requestWhat(path), r.status));
    return stampConnection(await r.json(), config?.connectionId);
  }

  /** The work a line asks for that isn't just a page (paletteRoute's acts). Errors stay inline. */
  async act(cx, route, top, acting = this.acting()) {
    const fail = (message) => { this.error = message; cx.notify(); };
    if (["read", "slice-file", "reply", "launch"].includes(route.act) && this.gonePage(top)) return fail(this.gonePage(top)); // these act on the page in view
    const note = (message) => { this.note = message; cx.notify(); };
    try {
      if (route.act === "operator") { this.openOperator(cx, { conn: acting.config?.connectionId }); return; }
      if (route.act === "design-view") { this.design(cx, route.rig, { conn: acting.config?.connectionId }); return; }
      if (route.act === "change-model") { this.changeModel(cx, route.seat, { conn: acting.config?.connectionId }); return; }
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
        const catalog = await this.get("/api/scopes/projects", acting.config);
        const topProject = !top?.conn || !acting?.config?.connectionId || top.conn === acting.config.connectionId ? top?.project : null;
        const project = effectiveScopeProject(topProject, readScopeProject(shared, this.config, acting?.config?.connectionId, catalog), catalog);
        const folder = ((await this.get('/api/slices'+(project?`?project=${encodeURIComponent(project)}`:''), acting.config))?.slices ?? []).map((x) => x.slicePath).find((p) => typeof p === "string" && p.split(/[\\/]/).pop() === route.slice);
        if (!folder) return fail(`OpenRig doesn't say where ${route.slice} is on disk.`);
        return this.show(fileEntry(`${folder}/${route.file}`, `${route.file} · ${route.slice}`), acting);
      }
      if (route.act === "reply") {
        // The request shown; away from one, the only one waiting. With several waiting, none is guessed and no draft is
        // overwritten: the person opens one first, as the TUI's reply asks.
        // Requests only (an OpenRig that ignores kind lists everything; the updates are filtered out below). A failed narrow read reads the whole list, as before.
        const asks = await this.get("/api/attention?kind=action", acting.config).catch(rethrowGate(null)) ?? await this.get("/api/attention", acting.config);
        const items = (asks?.items ?? []).map(needTarget).filter((n) => !n.update && n.reply !== "none");
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
        if (top.section === "needs" && (top.id === target.id || !top.id)) { return this.show(top, acting); }
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
    } catch (e) { fail(errorDiagnostic(e)); }
  }

  render(cx) {
    this.drawMemo = {};
    try {
      const t = theme();
      const rows = this.rows();
      const selectedIndex = this.selectionIndex(rows);
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
        .when(!!this.error, (el) => el.child(errorBlock(this,t,"palette-error",this.error)))
        .when(!this.error && !!this.note, (el) => el.child(errorBlock(this,t,"palette-note",this.note,{tone:t.muted})))
        .child(v_flex().id("rig-palette-rows").flex_1().overflow_y_scrollbar().children(rows.map((r, i) => h_flex().id(`row-${i}`).px(6).h(24).gap(10).items_center()
          .rounded(5).when(i === selectedIndex, (el) => el.bg(t.selected).text_color(t.foreground)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.selected = i; this.choose(cx); })
          .child(div().w(r.wide ? 360 : r.label ? 280 : 200).truncate().text_size(12.5).tooltip(r.label ?? r.line).child(r.label ?? r.line))
          .child(div().flex_1().truncate().text_size(11.5).text_color(t.dim).tooltip(String(r.hint ?? ""??"")).child(r.hint ?? "")))))
        .when(!rows.length && this.input.value().trim() === "/", el => el.child(div().id("palette-filter-hint").px(6).text_size(11.5).text_color(t.dim)
          .child("Type after / to filter this page, or press Enter to clear the filter.")))
        .when(!rows.length && !!this.input.value().trim() && this.input.value().trim() !== "/", el => el.child(v_flex().id("palette-no-matches").px(6).gap(4)
          .child(div().text_size(12).child(`No matches for “${this.input.value().trim()}”.`))
          .child(div().text_size(11.5).text_color(t.dim).child("Searches commands, rigs, seats and specs."))))
        .child(div().px(6).text_size(11).text_color(t.dim).child(":topology  :specs  :scopes  :terminals  :needs  :system"));
    } finally {
      this.drawMemo = null;
    }
  }
}
