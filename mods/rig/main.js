// OpenRig's Explorer sidebar: a single 6-branch collapsible tree
// (Topology, Specs, Scopes, Terminals, Needs, System) with header pop-out icons for the
// Rig Page tab and Rig TUI tab, one-way Sidebar -> Page synchronization, sibling
// drag-to-rearrange within parent groups, and per-rig Views branches.
//
// - Data: GET /api/rigs/summary, /api/rigs/:id/nodes per rig, /api/attention. Shared with the Rig page and palette as
//   `shared("rig.data")`.
// - Live: the daemon's /api/activity/events stream over `net` (any event re-reads, debounced 500 ms). The host ends a
//   socket read after 30 s without bytes; the daemon sends a keep-alive every 15 s. On any error or end it reconnects
//   with backoff and, while down, re-reads every 5 s and says so. Every (re)connect re-reads everything.
// - Never stale as live: after a failed read, rows are dimmed "as of HH:MM".
// - Tree fold state (`shared("rig.open.sidebar")`) and sibling order (`shared("rig.order")`) persist across restarts in
//   `<appHome>/openrig/state.json`.
// - One-click writes (`rig.oneclick`, rig-lib startOneClick) run here, as the person: this copy outlives the popup that
//   asked. Progress, success and failure go to `shared("rig.status")` and a toast.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, readTextFile, writeTextFile, props, theme, run, exec, layout, focused, openOverlay, setShared, shared, nextCommand, notify, playSound, settings, watchFolder, keys, window, spaces, panes, terminals, hc, commands } from "herdr";
import { RigSpaces } from "./rig-spaces.js";
import { NeedsTracker, priorityElements, diffPriorityNotifications, needsMark } from "./rig-needs-view.js";
import net from "net";
import {
  MOD_IDS, STATE_COPY, NO_PERSON, ACTION_REFUSED, TERMINAL_TOKEN_PROTECTED, REMOTE_OPERATOR_REASON, s1CopyLine,
  utf8, sseParser, parseConfig, sameConfig, preserveCliDiscoveredConfig, discoverDaemonFromCli, selectSidebarState, probeOpenRigState, formatOpenRigVersionLine,
  buildTopology, viewsForRig, rigFoldOpen, podFoldOpen, foldChoice,
  rigKey, podKey, branchKey, hostKey, viewsKey, branchFoldOpen, specNamespaceOf, hostOf,
  asOf, needTarget, iconsAt, paletteKey, openOrFocusTui,
  readCommand, writeCommand, writeOutcome, actionArgs, actionTitle, doneWords, ONE_CLICK, RIG_SECTIONS, SECTION_TITLES, CONFIG_CATEGORIES,
  navPush, navBack, navKey,
  probeCapabilities, currentCapabilities, capabilityDisableReason, isNeedsVisible, openNeed, worstHealthChip,
  isRigStopped, expandAllTopology, collapseAllTopology,
  viewsPropsFromLayout, hasRigWorkStack, openOrFocusRigTab, selectWorkerView, findRigTab,
  selectSidebarNode, isSelectionElsewhere, orderSiblings, applySiblingDrop, resetGroupOrder,
  parseSidebarState, serializeSidebarState, treeKeyNav, rigViewsBranch, attachToSeat, isLoopbackDaemonUrl, formatSeatContextPct, isSeatContextWarning,
  tierOf, sortNeedsByTier, enrichAttentionItems, quietModeHeaderChip, whoseQueueSummary, statusMark, statusMarkElement, pageRevealOpen,
  attachRelayPath, isValidSessionName, sessionNameRefusal,
  findAttachedSeat, newRigOverlay } from "./rig-lib.js";

/** This folder, for its own icons: derived from `MOD_IDS.sidebar` so a 1-line rename in `MOD_IDS` updates both cross-mod opens and icons. */
const ASSETS = `mods/${MOD_IDS.sidebar}`;
const icon = iconsAt(ASSETS);

const STACK = "rig-work", PAGE = "rig-page";

/** The tree's geometry: one indent step per level, and a 12 px cell before every name, holding the
 *  chevron when the row expands and empty on a leaf, so names line up at each depth. */
const TREE_STEP = 12;
const treeIndent = (depth) => 8 + depth * TREE_STEP;
const leafCell = () => div().w(12).flex_none();

function find(node, pred) {
  if (!node || typeof node !== "object") return null;
  if (pred(node)) return node;
  for (const child of node.children ?? []) { const hit = find(child, pred); if (hit) return hit; }
  return null;
}
const stripProps = () => viewsPropsFromLayout(layout(), shared) ?? (typeof props === "function" ? props() : null) ?? null;
const inRigLayoutNow = () => Boolean(find(layout(), (n) => n.id === STACK || n.id === "rig-sidebar" || n.content?.mod === MOD_IDS.sidebar));
const shownChild = () => {
  const tree = layout();
  const stackNode = find(tree, (n) => n.id === STACK);
  if (stackNode?.active) return stackNode.active;
  const sp = typeof spaces === "function" ? (spaces() ?? []) : [];
  const pn = typeof panes === "function" ? (panes() ?? []) : [];
  const activeSpace = sp.find((s) => s?.active) ?? sp[0] ?? null;
  const activeTab = (activeSpace?.tabs ?? []).find((t) => t?.active) ?? null;
  if (!activeTab?.id) return null;
  const rigTabId = findRigTab(sp, pn);
  if (rigTabId && activeTab.id === rigTabId) return PAGE;
  const matchedView = (stripProps()?.views ?? []).find((v) => v?.tab && v.tab === activeTab.id);
  if (matchedView?.id) return matchedView.id;
  return activeTab.id;
};
// The sidebar's rail goes by its width, as herdr's own sidebar (agents/main.js).
const narrow = () => (find(layout(), (n) => n.id === "sidebar")?.size?.px ?? Infinity) < 160;

/**
 * Show a page of the Rig view: select the node (when `selKey` is given) and push `entry` onto `shared("rig.nav")`,
 * opening or focusing the Rig Page tab. Never mutates `rig.open`, `rig.order`, or `rig.focusRig`.
 */
export function openPage(entry, selKey = null) {
  const key = selKey ?? navKey(entry) ?? entry?.section ?? "topology";
  // The page shows what was opened: its ancestors unfold in the page's folds, never the sidebar's.
  setShared("rig.open.page", pageRevealOpen(shared("rig.open.page"), entry));
  return selectSidebarNode({ shared, setShared, run, spaces, panes, layout }, key, entry);
}

export default class RigSidebar extends View {
  init(_p, cx) {
    this.config = null;
    this.data = null; // { topology, attention, at }
    this.error = null; // last read error
    this.sidebarState = { id: "S0", substate: null, headline: STATE_COPY.S0.headline };
    this.startingDaemon = false;
    this.startDaemonError = null;
    this.copiedKey = null;
    this.cliVersion = null;
    this.healthz = null;
    this.live = false;
    this.lists = {}; // path → { data, error, at } for lazy-loaded branch lists
    this.delay = 1000;
    this.closed = false;
    this.dragState = null;
    this.dropTarget = null;
    this.visibleTreeRows = [];
    this.needsTracker = new NeedsTracker(typeof localStorage === "undefined" ? null : localStorage);
    this.prioritySeeded = false;
    this.focusHandle = typeof cx?.focus_handle === "function" ? cx.focus_handle() : null;
    cx.spawn(async (cx) => {
      await this.loadSidebarState();
      this.config = parseConfig(await readTextFile(`${appHome()}/openrig/config.json`));
      await this.refresh(cx);
      this.stream(cx);
    });
    // Re-read the config whenever it may have changed: on any change under the app home, every second while missing, and every 5 s.
    cx.spawn(async (cx) => {
      for (;;) {
        const dir = this.config && !this.config.missing ? `${appHome()}/openrig` : appHome();
        try { await watchFolder(dir); } catch (_) { await new Promise((r) => cx.timer.after(5000, () => r())); }
        if (this.closed) return;
        await this.reloadConfig(cx);
      }
    });
    cx.timer.every(1000, (cx) => {
      if (this.closed) return;
      if (this.config?.missing) cx.spawn(async (cx) => this.reloadConfig(cx));
    });
    // rig.<command> (herdr-app do, keys.json): the sidebar is loaded whenever the Rig layout shows.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const cmdName = typeof c === "object" && c !== null ? String(c.name ?? c.command ?? "") : String(c ?? "");
        const cmdArgs = typeof c === "object" && c !== null ? (c.args ?? {}) : null;
        const section = cmdName.startsWith("open:") ? cmdName.slice(5) : cmdName;
        if (cmdName === "palette") run("mod.open", { name: MOD_IDS.palette });
        else if (cmdName === "tui" || cmdName === "open-tui" || cmdName === "rig.open-tui") this.tui(cx);
        else if (cmdName === "operator" || cmdName === "rig.operator" || cmdName === "open-operator") this.openOperator(cx);
        else if (cmdName === "start-daemon" || cmdName === "rig.start-daemon") this.startDaemon(cx);
        else if (cmdName === "open-page" || cmdName === "rig.open-page" || cmdName === "open") {
          const fallbackEntry = shared("rig.sel")?.entry ?? shared("rig.nav")?.stack?.at(-1) ?? { section: "topology" };
          openOrFocusRigTab({ shared, setShared, run, spaces, panes, layout }, fallbackEntry);
        }
        else if (cmdName === "refresh") { this.forceCapabilityProbe = true; cx.spawn(async (cx) => this.refresh(cx)); }
        else if (cmdName.startsWith("space:")) this.openRigSpace(cx, cmdName.slice(6));
        else if (cmdName === "space" || cmdName === "rig.space") this.openRigSpace(cx, cmdArgs?.rigId ?? cmdArgs?.rig ?? shared("rig.sel")?.entry?.rigId);
        else if (cmdName === "oneclick") this.oneClicks(cx);
        else if (cmdName.startsWith("open-seat:")) {
          const session = cmdName.slice("open-seat:".length);
          const row = this.priorityRows().find((r) => r.seat?.session === session);
          if (row) this.seatClick(row.rig, row.seat, row.pod);
        }
        else if (cmdName.startsWith("open-need:")) {
          const suffix = cmdName.slice("open-need:".length);
          this.openNeedTarget(cx, suffix || null);
        }
        else if (cmdName === "open-need") {
          const fallbackId = cmdArgs && "id" in cmdArgs ? cmdArgs.id : (shared("rig.pendingNeed") ?? this.lastNeedId ?? null);
          this.openNeedTarget(cx, fallbackId);
        }
        else if (cmdName === "back") {
          setShared("rig.nav", navBack(shared("rig.nav")));
          openOrFocusRigTab({ run, spaces, panes, layout, section: "topology" });
        }
        else if (cmdName === "zoom" || cmdName === "rig.zoom") void this.handleZoomCommand(cx, cmdArgs);
        else if (cmdName === "close-cell" || cmdName === "rig.close-cell") void this.handleCloseCellCommand(cx, cmdArgs);
        else if (cmdName === "expand-all" || cmdName === "rig.expand-all") {
          const nextOpen = expandAllTopology(shared("rig.open.sidebar"), this.data?.topology ?? shared("rig.data")?.topology ?? []);
          setShared("rig.open.sidebar", nextOpen);
          this.persistSidebarState(nextOpen, shared("rig.order"));
        }
        else if (cmdName === "collapse-all" || cmdName === "rig.collapse-all") {
          const nextOpen = collapseAllTopology(shared("rig.open.sidebar"), this.data?.topology ?? shared("rig.data")?.topology ?? []);
          setShared("rig.open.sidebar", nextOpen);
          this.persistSidebarState(nextOpen, shared("rig.order"));
        }
        else if (cmdName.startsWith("reset-order:")) {
          const groupKey = cmdName.slice("reset-order:".length);
          const nextOrder = resetGroupOrder(shared("rig.order"), groupKey);
          setShared("rig.order", nextOrder);
          this.persistSidebarState(shared("rig.open.sidebar"), nextOrder);
        }
        else if (cmdName.startsWith("attach:")) {
          const session = cmdName.slice("attach:".length);
          this.attachSeatBySession(cx, session);
        }
        else if (RIG_SECTIONS.includes(section)) this.pickSection(section, cx);
        cx.notify();
      }
    });
    // SSE accelerates updates; polling also covers lifecycle changes the stream does not announce.
    cx.timer.every(5000, (cx) => {
      if (this.closed) return;
      cx.spawn(async (cx) => { await this.reloadConfig(cx); await this.refresh(cx); });
    });
  }

  async loadSidebarState() {
    if (typeof appHome !== "function" || typeof readTextFile !== "function") return;
    try {
      const raw = await readTextFile(`${appHome()}/openrig/state.json`);
      if (!raw) return;
      const parsed = parseSidebarState(raw);
      if (parsed.topologyView && !shared("rig.topology.view")) setShared("rig.topology.view", parsed.topologyView);
      if (parsed.notifiedNeeds && !shared("rig.notifiedNeeds")) setShared("rig.notifiedNeeds", parsed.notifiedNeeds);
      if (Object.keys(parsed.open).length > 0) {
        setShared("rig.open.sidebar", { ...parsed.open, ...(shared("rig.open.sidebar") ?? {}) });
      }
      if (Object.keys(parsed.order).length > 0) {
        setShared("rig.order", { ...parsed.order, ...(shared("rig.order") ?? {}) });
      }
      if (parsed.lastSeenNeedsAt && !shared("rig.lastSeenNeedsAt")) {
        setShared("rig.lastSeenNeedsAt", parsed.lastSeenNeedsAt);
      }
      if (parsed.needsView && !shared("rig.needsView")) {
        setShared("rig.needsView", parsed.needsView);
      }
      if (parsed.lastEndedModeApplicationId && !shared("rig.lastEndedModeApplicationId")) {
        setShared("rig.lastEndedModeApplicationId", parsed.lastEndedModeApplicationId);
      }
      if (parsed.lastActiveModeApplicationId && !shared("rig.lastActiveModeApplicationId")) {
        setShared("rig.lastActiveModeApplicationId", parsed.lastActiveModeApplicationId);
      }
    } catch (_) {}
  }

  persistSidebarState(openMap = shared("rig.open.sidebar"), orderMap = shared("rig.order")) {
    if (typeof appHome !== "function" || typeof writeTextFile !== "function") return;
    const path = `${appHome()}/openrig/state.json`;
    Promise.resolve(readTextFile?.(path))
      .catch(() => null)
      .then((prevText) => {
        const nextText = serializeSidebarState(prevText, {
          open: openMap ?? {},
          order: orderMap ?? {},
          topologyView: shared("rig.topology.view") ?? "priority",
          notifiedNeeds: shared("rig.notifiedNeeds"),
          lastSeenNeedsAt: shared("rig.lastSeenNeedsAt"),
          needsView: shared("rig.needsView"),
          lastEndedModeApplicationId: shared("rig.lastEndedModeApplicationId"),
          lastActiveModeApplicationId: shared("rig.lastActiveModeApplicationId"),
        });
        return writeTextFile(path, nextText, prevText);
      })
      .catch(() => {});
  }

  /** Reads the config again; a change takes effect at once: a new daemon reconnects the stream. */
  async reloadConfig(cx) {
    const next = preserveCliDiscoveredConfig(parseConfig(await readTextFile(`${appHome()}/openrig/config.json`)), this.config);
    if (sameConfig(next, this.config)) return;
    const reconnect = !!this.config && next.daemonUrl !== this.config.daemonUrl;
    const rigChanged = !!this.config && JSON.stringify(next.rig) !== JSON.stringify(this.config.rig);
    this.config = next;
    if (reconnect || rigChanged) this.forceCapabilityProbe = true;
    if (reconnect) { try { this.sock?.close(); } catch (_) {} }
    await this.refresh(cx);
  }

  /** Expand a top-level branch in the tree and select it (`rig.<section>` command or branch click). */
  pickSection(section, cx, { openInPage = false } = {}) {
    const bKey = branchKey(section);
    const curOpen = shared("rig.open.sidebar") ?? {};
    const nextOpen = { ...curOpen, [bKey]: true };
    setShared("rig.open.sidebar", nextOpen);
    this.persistSidebarState(nextOpen, shared("rig.order"));
    const entry = { section };
    setShared("rig.sel", { key: bKey, entry, at: Date.now() });
    if (openInPage) {
      openOrFocusRigTab({ shared, setShared, run, spaces, panes, layout }, entry);
    } else if (findRigTab(spaces?.() ?? [], panes?.() ?? []) || hasRigWorkStack(layout())) {
      // A Rig page already open follows the section (rig.<section> from the palette or keys), as a branch click does.
      setShared("rig.nav", navPush(shared("rig.nav"), entry));
    }
    cx?.notify?.();
  }

  /** Click-to-inline-reply from a Needs-You toast (`rig.open-need`). */
  openNeedTarget(cx = null, idOrArgs = undefined) {
    return this.openNeed(idOrArgs, cx);
  }

  openNeed(idOrArgs = undefined, cx = null) {
    const id = typeof idOrArgs === "object" && idOrArgs !== null
      ? (idOrArgs.id ?? null)
      : idOrArgs !== undefined
        ? idOrArgs
        : (shared("rig.pendingNeed") ?? this.lastNeedId ?? null);
    const items = this.data?.attentionItems ?? shared("rig.data")?.attentionItems ?? null;
    const res = openNeed(id, { shared, setShared, run, items, layout, spaces, panes });
    if (shared("rig.pendingNeed")) setShared("rig.pendingNeed", null);
    cx?.notify?.();
    return res;
  }

  /** The active space's Rig TUI, shown, or opened once (works without config.json). */
  tui(cx) {
    const config = this.config ?? parseConfig(null), inRigLayout = inRigLayoutNow();
    cx.spawn(async (cx) => {
      await openOrFocusTui({ spaces, panes, terminals, hc, run, layout, inRigLayout, wait: (ms) => new Promise((r) => cx.timer.after(ms, () => r())) }, config);
    });
  }

  /** Open `operator.agent` (`rig: "kernel"`) in a Herdr tab named `Operator`. */
  openOperator(cx) {
    const config = this.config ?? parseConfig(null);
    if (config?.daemonUrl && !isLoopbackDaemonUrl(config.daemonUrl)) {
      notify({ title: "Open operator", body: REMOTE_OPERATOR_REASON, level: "warning" });
      cx?.notify?.();
      return;
    }
    const allSeats = (this.data?.topology ?? []).flatMap((r) =>
      (r.pods ?? []).flatMap((p) => (p.seats ?? []).map((s) => ({ ...s, rig: r.name, rigId: r.id })))
    );
    const opSeat = allSeats.find((s) => s.logicalId === "operator.agent" || s.session === "operator-agent@kernel")
      ?? (this.sidebarState?.operatorNode
          ? {
              ...this.sidebarState.operatorNode,
              session: this.sidebarState.operatorNode.canonicalSessionName ?? "operator-agent@kernel",
              logicalId: "operator.agent",
              rig: "kernel",
              sessionAlive: true,
            }
          : {
              session: "operator-agent@kernel",
              logicalId: "operator.agent",
              rig: "kernel",
              sessionAlive: true,
              tmuxAttachCommand: "tmux attach-session -t operator-agent@kernel",
            });
    cx.spawn(async (cx) => {
      const res = await attachToSeat(
        { exec, spaces, panes, terminals, hc, run, relayPath: attachRelayPath(appHome(), MOD_IDS.sidebar), wait: (ms) => new Promise((r) => cx.timer.after(ms, () => r())) },
        opSeat,
        config,
        { name: "Operator", operator: true, daemonUrl: config?.daemonUrl },
      );
      if (!res?.ok && res?.reason) {
        notify({ title: "Open operator", body: res.reason, level: "warning" });
      }
      cx.notify();
    });
  }

  /** Copy `text` to the clipboard and flip the `Copy` / `Copy fix` pill to `Copied` for 2 s. */
  copyToClipboard(cx, text, key = "copy") {
    try { cx?.write_to_clipboard?.(text); } catch (_) {}
    this.copiedKey = key;
    cx?.notify?.();
    cx?.timer?.after?.(2000, (cx) => {
      if (this.copiedKey === key) {
        this.copiedKey = null;
        cx?.notify?.();
      }
    });
  }

  /** Start the OpenRig daemon from S2 (`rig daemon start`, 180 s timeout). */
  startDaemon(cx) {
    if (this.startingDaemon) return;
    this.startingDaemon = true;
    this.startDaemonError = null;
    cx?.notify?.();
    cx.spawn(async (cx) => {
      try {
        const config = this.config ?? parseConfig(await readTextFile(`${appHome()}/openrig/config.json`));
        const cmd = readCommand({ ...config, daemonUrlSource: config.daemonUrlSource ?? "default" }, ["daemon", "start"]);
        const res = await exec(cmd.command, cmd.args, { timeout: 180000 });
        if (res && res.code === 0) {
          this.startingDaemon = false;
          this.startDaemonError = null;
          await this.refresh(cx);
        } else {
          const errLine = `${res?.stderr ?? ""}\n${res?.stdout ?? ""}`.split("\n").map((l) => l.trim()).find(Boolean)
            || `rig daemon start exited ${res?.code ?? 1}`;
          this.startingDaemon = false;
          this.startDaemonError = errLine;
          cx.notify();
        }
      } catch (e) {
        this.startingDaemon = false;
        this.startDaemonError = String(e?.message ?? e ?? "Failed to start OpenRig.").split("\n")[0];
        cx.notify();
      }
    });
  }

  /** `rig.attach:<session>`: a seat this sidebar knows, by its exact session name. Anything else is refused, never
   *  guessed (no stand-in seat, no command built from the name). */
  attachSeatBySession(cx, session) {
    if (!isValidSessionName(session)) {
      notify({ title: "Attach", body: sessionNameRefusal(session), level: "warning" });
      return;
    }
    const allSeats = (this.data?.topology ?? []).flatMap((r) => r.pods.flatMap((p) => p.seats.map((s) => ({ ...s, rig: r.name, rigId: r.id }))));
    const seat = allSeats.find((s) => s.session === session);
    if (!seat) {
      notify({ title: `Attach ${session}`, body: "That seat isn't in OpenRig's topology here.", level: "warning" });
      return;
    }
    const config = this.config;
    cx.spawn(async (cx) => {
      const res = await attachToSeat({ exec, spaces, panes, terminals, hc, run, relayPath: attachRelayPath(appHome(), MOD_IDS.sidebar), wait: (ms) => new Promise((r) => cx.timer.after(ms, () => r())) }, seat, config);
      if (!res?.ok && res?.reason) {
        notify({ title: `Attach ${seat.logicalId ?? session}`, body: res.reason, level: "warning" });
      }
      cx.notify();
    });
  }

  spaceController(cx) {
    if (!this.rigSpaces) this.rigSpaces = new RigSpaces({ spaces, panes, terminals, focused, commands, hc, run,
      padPath: `${appHome()}/mods/${MOD_IDS.sidebar}/rig-grid-pad.cjs`,
      viewerPath: `${appHome()}/mods/${MOD_IDS.sidebar}/rig-grid-viewer.cjs`, selfHostId: () => this.healthz?.selfHostId,
      wait: (ms) => new Promise((resolve) => cx.timer.after(ms, resolve)) });
    return this.rigSpaces;
  }

  openRigSpace(cx, id) {
    const rig = this.data?.topology?.find((r) => r.id === id || r.name === id);
    if (!rig || this.error) { notify({ title: "Rig space", body: "Refresh OpenRig before opening this rig's space.", level: "warning" }); return; }
    setShared("rig.sel", { key: rigKey(rig.id), entry: { section: "topology", kind: "rig", rigId: rig.id, name: rig.name }, at: Date.now() });
    cx.spawn(async (cx) => {
      const result = await this.spaceController(cx).sync(rig, this.config, { explicit: true });
      if (!result.ok || result.empty) notify({ title: `${rig.name} space`, body: result.reason ?? "No running seats in this rig.", level: "warning" });
      cx.notify();
    });
  }

  syncRigSpaces(cx) {
    if (this.spaceSyncing) { this.spaceAgain = true; return; }
    this.spaceSyncing = true;
    cx.spawn(async (cx) => {
      try {
        for (const rig of this.data?.topology ?? []) {
          if (this.error) break;
          const result = await this.spaceController(cx).sync(rig, this.config);
          const statuses = shared("rig.spaceStatus") ?? {};
          if (!result.ok && statuses[rig.id]?.reason !== result.reason) notify({ title: `${rig.name} space`, body: result.reason, level: "warning" });
          setShared("rig.spaceStatus", { ...statuses, [rig.id]: result });
        }
      } finally {
        this.spaceSyncing = false;
        if (this.spaceAgain) { this.spaceAgain = false; if (!this.error) this.syncRigSpaces(cx); }
        cx.notify();
      }
    });
  }

  /** Runs every queued one-click request (rig-lib ONE_CLICK), each in a task of its own; one taken is never run twice. */
  oneClicks(cx) {
    const queued = shared("rig.oneclick") ?? {};
    const ids = Object.keys(queued);
    if (!ids.length) return;
    const rest = { ...(shared("rig.oneclick") ?? {}) };
    for (const id of ids) delete rest[id];
    setShared("rig.oneclick", rest);
    for (const id of ids) {
      const { target, action, actionKey } = queued[id] ?? {};
      if (!target || !ONE_CLICK.has(action)) {
        setShared("rig.busyAction", null);
        continue;
      }
      cx.spawn(async (cx) => this.oneClick(cx, id, target, action, actionKey));
    }
  }

  async oneClick(cx, id, target, action, actionKey = null) {
    const title = actionTitle(target, action);
    const busyKey = actionKey ?? target?.actionKey ?? `${action}:${target?.rig ?? target?.view ?? target?.session ?? ""}:${target?.viewId ?? ""}:${target?.cellId ?? ""}`;
    const clearBusy = () => {
      const cur = shared("rig.busyAction");
      if (cur === busyKey || cur === action || (typeof cur === "string" && cur.startsWith(`${action}:`))) {
        setShared("rig.busyAction", null);
      }
    };
    const reason = capabilityDisableReason(action, currentCapabilities(shared, terminals?.()));
    if (reason) {
      clearBusy();
      setShared("rig.status", { id, busy: false, ok: false, text: `${title}: ${reason}`, at: Date.now() });
      notify({ title, body: reason, level: "warn" });
      cx.notify();
      return;
    }
    setShared("rig.busyAction", busyKey);
    setShared("rig.status", { id, busy: true, ok: null, text: `${title}…`, at: Date.now() });
    let r;
    try {
      const config = this.config ?? parseConfig(await readTextFile(`${appHome()}/openrig/config.json`));
      const args = actionArgs(target, action, "", appHome());
      const cmd = args ? writeCommand(config, args) : null;
      r = cmd ? writeOutcome(await exec(cmd.command, cmd.args, { timeout: 180000 }))
        : { ok: false, text: args ? NO_PERSON : ACTION_REFUSED };
    } catch (e) { r = { ok: false, text: String(e?.message ?? e) }; }
    const words = r.ok ? (r.text || doneWords(target, action)) : (r.text || "It didn't work, and the CLI gave no reason.");
    const statusRig = target?.rig ?? (typeof target?.view === "string" && target.view.startsWith("rig:") ? target.view.slice(4) : null);
    const canResume = !r.ok
      && (action === "open-view" || action === "open-seat" || action === "follow")
      && Boolean(statusRig)
      && /no running|no attachable|stopped|recoverable|exited/i.test(words);
    clearBusy();
    setShared("rig.status", {
      id,
      busy: false,
      ok: r.ok,
      text: r.ok ? words : `${title}: ${words}`,
      at: Date.now(),
      rig: statusRig,
      rigId: target?.rigId ?? null,
      canResume,
    });
    if (r.ok) notify({ title, body: r.warning ? `${words} ${r.warning}` : words, level: "success" });
    else notify({ title, body: words, level: "warning" });
    cx.notify();
  }

  /** Resolve the active worker view and its focused cell for `rig.zoom` / `rig.close-cell`. */
  async resolveActiveWorkerCell(cmdArgs = null, { requireExplicitFocus = false } = {}) {
    const viewId = cmdArgs?.viewId ?? shownChild();
    if (!viewId || viewId === "main" || viewId === PAGE) return null;
    const tree = layout();
    const viewNode = find(tree, (n) => n.id === viewId);
    const stripView = (stripProps()?.views ?? []).find((v) => v.id === viewId) ?? null;
    const allCells = [];
    if (viewNode) {
      const rows = Array.isArray(viewNode.children) ? viewNode.children : [];
      for (const row of rows) {
        const rowChildren = Array.isArray(row?.children) ? row.children : [];
        const isCellColumn = rowChildren.some((k) => k?.content?.mod === "rig-cell-header" || k?.content?.terminal);
        if (isCellColumn) {
          const header = rowChildren.find((k) => k?.content?.mod === "rig-cell-header")?.content?.props ?? {};
          const viewer = rowChildren.find((k) => k?.content?.terminal)?.content?.terminal ?? header.terminal ?? null;
          const siblings = rows.filter((s) => s !== row && s?.id && !s.hidden).map((s) => s.id);
          allCells.push({ id: row.id, seat: header.seat ?? null, title: header.title ?? null, terminal: viewer, siblings });
        } else {
          for (const cellNode of rowChildren) {
            const kids = Array.isArray(cellNode?.children) ? cellNode.children : [];
            const header = kids.find((k) => k?.content?.mod === "rig-cell-header")?.content?.props ?? {};
            const viewer = kids.find((k) => k?.content?.terminal)?.content?.terminal ?? cellNode?.content?.terminal ?? header.terminal ?? null;
            const siblings = [
              ...rows.filter((r) => r !== row && r?.id && !r.hidden).map((r) => r.id),
              ...rowChildren.filter((s) => s !== cellNode && s?.id && !s.hidden).map((s) => s.id),
            ];
            allCells.push({ id: cellNode.id, seat: header.seat ?? null, title: header.title ?? null, terminal: viewer, siblings });
          }
        }
      }
    }
    if (!allCells.length && Array.isArray(stripView?.cells)) {
      const pn = typeof panes === "function" ? (panes() ?? []) : [];
      for (const [idx, c] of stripView.cells.entries()) {
        const matchedPane = (c.pane && pn.find((p) => p.pane === c.pane))
          ?? (c.terminal && pn.find((p) => p.terminal === c.terminal))
          ?? null;
        allCells.push({
          id: c.cellId ?? c.id ?? `${viewId}-cell-${idx}`,
          pane: c.pane ?? matchedPane?.pane ?? null,
          seat: c.seat ?? null,
          title: c.title ?? c.seat ?? null,
          terminal: c.terminal ?? matchedPane?.terminal ?? null,
          siblings: [],
        });
      }
    }
    if (!allCells.length) return null;
    const focusTerm = cmdArgs?.terminal ?? focused()?.terminal ?? null;
    const focusPane = cmdArgs?.pane ?? focused()?.pane ?? null;
    const focusCellId = cmdArgs?.cellId ?? shared(`rig.zoom:${viewId}`)?.cellId ?? null;
    const explicitCell = (focusCellId && allCells.find((c) => c.id === focusCellId))
      ?? (focusPane && allCells.find((c) => c.pane === focusPane))
      ?? (focusTerm && allCells.find((c) => c.terminal === focusTerm))
      ?? null;
    if (requireExplicitFocus) {
      return { viewId, cell: explicitCell, allCells, explicitFocus: Boolean(explicitCell) };
    }
    if (explicitCell) {
      return { viewId, cell: explicitCell, allCells, explicitFocus: true };
    }
    const picked = allCells.find((c) => c.terminal || c.seat) ?? allCells[0];
    return { viewId, cell: picked, allCells, explicitFocus: false };
  }

  async handleZoomCommand(_cx, cmdArgs = null) {
    const resolved = await this.resolveActiveWorkerCell(cmdArgs);
    if (!resolved?.cell) return null;
    const { viewId, cell } = resolved;
    const tree = layout();
    const viewNode = find(tree, (n) => n.id === viewId);
    if (!viewNode && cell.pane) {
      run("pane.zoom", { pane: cell.pane });
      return { viewId, cellId: cell.id, pane: cell.pane };
    }
    const zoomKey = `rig.zoom:${viewId}`;
    const current = shared(zoomKey);
    const hid = Array.isArray(current?.hid) ? current.hid : [];
    const isZoomed = Boolean(current && hid.some((id) => find(tree, (n) => n.id === id)?.hidden));
    if (isZoomed) {
      for (const id of hid) if (find(tree, (n) => n.id === id)) run("layout.show", { id });
      setShared(zoomKey, null);
      return { viewId, cellId: cell.id, zoomed: false };
    }
    for (const id of cell.siblings) run("layout.hide", { id });
    const nextState = { cellId: cell.id, terminal: cell.terminal ?? null, seat: cell.seat ?? null, hid: cell.siblings, zoomed: true };
    setShared(zoomKey, nextState);
    return nextState;
  }

  async handleCloseCellCommand(cx, cmdArgs = null) {
    const resolved = await this.resolveActiveWorkerCell(cmdArgs, { requireExplicitFocus: true });
    if (!resolved) return null;
    if (!resolved.cell) {
      const msg = "No focused cell in the active view.";
      this.note = msg;
      setShared("rig.status", { id: `close-cell-${Date.now().toString(36)}`, busy: false, ok: false, text: msg, at: Date.now() });
      cx?.notify?.();
      return null;
    }
    const { viewId, cell } = resolved;
    const target = {
      kind: "cell-close",
      viewId,
      cellId: cell.id,
      seat: cell.seat ?? null,
      terminal: cell.terminal ?? null,
      name: cell.title ?? cell.seat ?? cell.id,
    };
    const id = `close-cell-${Date.now().toString(36)}`;
    await this.oneClick(cx, id, target, "close-cell", "close-cell");
    return target;
  }

  async close() { this.closed = true; try { this.sock?.close(); } catch (_) {} }

  async get(path) {
    if (!this.config?.daemonUrl) {
      const status = await discoverDaemonFromCli(this.config, exec);
      if (status.reachable && status.daemonUrl) {
        this.config = { ...this.config, daemonUrl: status.daemonUrl, daemonUrlSource: "cli", daemonState: status.state, daemonMessage: undefined };
      } else {
        throw new Error(status.message || this.config?.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up').");
      }
    }
    const r = await fetch(`${this.config.daemonUrl}${path}`);
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
    return r.json();
  }

  async refresh(cx) {
    if (!this.config) {
      this.config = parseConfig(await readTextFile(`${appHome()}/openrig/config.json`));
    } else if (this.config.missing) {
      const reread = parseConfig(await readTextFile(`${appHome()}/openrig/config.json`));
      if (!reread.missing) {
        this.config = reread;
      }
    }
    if (!this.config || this.refreshing) { this.again = true; return; }
    this.refreshing = true;
    let probed = null;
    try {
      const hasExplicitConfigUrl = Boolean(this.config.daemonUrl && this.config.daemonUrlSource !== "cli" && this.config.daemonUrlSource !== "default");
      let unreachableState = false;
      if (!hasExplicitConfigUrl) {
        probed = await probeOpenRigState(this.config, { exec, fetch, sidebarModId: MOD_IDS.sidebar });
        if (probed.cliVersion) this.cliVersion = probed.cliVersion;
        if (probed.healthzProbe?.data) this.healthz = probed.healthzProbe.data;
        if (!probed.daemonUrl || probed.state.id === "S1" || probed.state.id === "S2" || probed.state.id === "S3" || probed.state.id === "S7") {
          this.sidebarState = probed.state;
          if (probed.state.id === "S1" || probed.state.id === "S2" || probed.state.id === "S7") {
            this.data = null;
            this.live = false;
            try { this.sock?.close(); } catch (_) {}
            this.sock = null;
            if (this.config?.daemonUrlSource === "cli") {
              const resetCfg = { ...this.config, daemonUrl: null };
              delete resetCfg.daemonUrlSource;
              delete resetCfg.daemonState;
              delete resetCfg.daemonMessage;
              this.config = resetCfg;
            }
          }
          this.error = probed.state.id === "S3" || probed.state.id === "S7"
            ? (probed.state.detail || probed.state.headline || null)
            : null;
          unreachableState = true;
        } else {
          const nextCfg = {
            ...this.config,
            daemonUrl: probed.daemonUrl,
            daemonUrlSource: "cli",
            daemonState: probed.statusProbe?.state ?? "running",
          };
          delete nextCfg.daemonMessage;
          this.config = nextCfg;
        }
      }
      if (!unreachableState) {
        const summary = await this.get("/api/rigs/summary");
        const nodesByRig = Object.create(null); // keyed by the daemon's rig ids: no prototype keys
        await Promise.all(summary.filter((r) => !r.archivedAt).map(async (r) => { nodesByRig[r.id] = await this.get(`/api/rigs/${encodeURIComponent(r.id)}/nodes`); }));
        const attention = await this.get("/api/attention").catch(() => null);
        const attentionAgg = await this.get("/api/queue/attention-aggregate").catch(() => null);
        const rawAttentionItems = Array.isArray(attention?.items) ? attention.items : null;
        const queueRows = Object.create(null);
        // Parked-on-person requests have no asker; their queue owner identifies the seat.
        await Promise.all((rawAttentionItems ?? []).filter((a) => a.answer?.verb === "resolve" && String(a.id).startsWith("queue:")).map(async (a) => {
          const id = a.id.slice(6);
          const row = await this.get(`/api/queue/${encodeURIComponent(id)}`).catch(() => null);
          if (row) queueRows[id] = row.item ?? row.qitem ?? row;
        }));
        const attentionItems = rawAttentionItems ? enrichAttentionItems(rawAttentionItems, attentionAgg, queueRows) : null;
        const rawPerson = this.config?.person || attention?.perspective?.personId || null;
        const personId = rawPerson ? String(rawPerson).replace(/@external$/i, "") : null;
        let quietRes = null;
        let modeRes = null;
        if (personId) {
          [quietRes, modeRes] = await Promise.all([
            this.get(`/api/gateway/human/${encodeURIComponent(personId)}/quiet`).catch(() => null),
            this.get(`/api/gateway/human/${encodeURIComponent(personId)}/mode`).catch(() => null),
          ]);
        }
        const quietModeChip = quietModeHeaderChip({ quiet: quietRes, mode: modeRes });
        const native = await this.get("/api/native-seats").catch(() => null);
        if (hasExplicitConfigUrl && typeof fetch === "function") {
          const hzRes = await fetch(`${this.config.daemonUrl}/healthz`).catch(() => null);
          if (hzRes?.ok) {
            this.healthz = await hzRes.json().catch(() => this.healthz);
          }
        }
        let kernelStatus = probed?.statusProbe?.kernel ?? null;
        if (!kernelStatus && typeof fetch === "function" && this.config.daemonUrl) {
          const krRes = await fetch(`${this.config.daemonUrl}/api/kernel/status`).catch(() => null);
          if (krRes?.ok) {
            kernelStatus = await krRes.json().catch(() => null);
          }
        }
        let capabilities;
        const forceProbe = Boolean(this.forceCapabilityProbe);
        this.forceCapabilityProbe = false;
        if (native === null || forceProbe || this.config?.capabilities) {
          capabilities = await probeCapabilities(this.config, {
            exec,
            terminals: terminals?.() ?? [],
            hasNativeSeatsEndpoint: native !== null,
            force: forceProbe,
          });
          setShared("rig.capabilities", capabilities);
        } else {
          capabilities = currentCapabilities(shared, terminals?.() ?? []);
          if (!shared("rig.capabilities")) setShared("rig.capabilities", capabilities);
        }
        const topology = buildTopology(summary, nodesByRig, native?.seats);
        if (attentionItems !== null) {
          const needsVisible = isNeedsVisible({
            nav: shared("rig.nav"),
            activeChild: shownChild(),
          });
          const quiet = Boolean(quietModeChip);
          const notificationsEnabled = (shared("rig.settings")?.notifications ?? true) !== false;
          const { toasts, nextState } = diffPriorityNotifications(
            topology, attentionItems,
            this.prioritySeeded ? shared("rig.notifiedNeeds") : null,
            { quiet, needsVisible, notificationsEnabled, sources: attention?.sources,
              focusedSession: this.focusedSeat(topology), terminals: terminals(), spaces: spaces() },
          );
          this.prioritySeeded = true;
          setShared("rig.notifiedNeeds", nextState);
          this.persistSidebarState();
          for (const t of toasts) {
            if (t.action?.args?.id) {
              this.lastNeedId = t.action.args.id;
              setShared("rig.pendingNeed", t.action.args.id);
            } else {
              this.lastNeedId = null;
              setShared("rig.pendingNeed", null);
            }
            notify(t);
            if (settings()?.sounds?.enabled !== false) playSound("blocked");
          }
        }
        const kernelRig = summary.find((r) => r && !r.archivedAt && r.name === "kernel") ?? null;
        const kernelNodes = kernelRig ? (nodesByRig[kernelRig.id] ?? null) : null;
        const strictKernel = Boolean(probed?.statusProbe || kernelStatus !== null || this.config?.missing || this.config?.daemonUrlSource === "cli");
        this.sidebarState = selectSidebarState({
          versionProbe: probed?.versionProbe ?? { installed: true, code: 0, cliVersion: this.cliVersion },
          statusProbe: probed?.statusProbe ?? null,
          healthzProbe: probed?.healthzProbe ?? (this.healthz ? { ok: true, data: this.healthz } : null),
          summary,
          kernelStatus,
          kernelNodes,
          capabilities,
          sidebarModId: MOD_IDS.sidebar,
          strictKernel,
        });
        const versionLine = formatOpenRigVersionLine({ healthz: this.healthz, cliVersion: this.cliVersion });
        this.data = {
          topology,
          attention: attentionItems?.length ?? null,
          attentionItems,
          attentionPerspective: attention?.perspective ?? null,
          quietModeChip,
          at: new Date().toISOString(),
          nodesByRig,
          capabilities,
          sidebarState: this.sidebarState,
          healthz: this.healthz,
          cliVersion: this.cliVersion,
          versionLine,
        };
        this.error = null;
        for (const path of Object.keys(this.lists)) this.lists[path] = { ...this.lists[path], stale: true };
      }
    } catch (e) {
      const errMsg = String(e?.message ?? e);
      this.error = errMsg;
      if (!this.data) {
        const fallbackProbe = probed ?? await probeOpenRigState(
          { ...this.config, daemonUrl: null, daemonUrlSource: "default" },
          { exec, fetch, sidebarModId: MOD_IDS.sidebar },
        ).catch(() => null);
        if (fallbackProbe && (fallbackProbe.state.id === "S1" || fallbackProbe.state.id === "S2" || fallbackProbe.state.id === "S7")) {
          this.sidebarState = fallbackProbe.state;
        } else {
          this.sidebarState = { id: "S3", substate: null, headline: STATE_COPY.S3.headline, detail: errMsg };
        }
      } else {
        this.sidebarState = { id: "S3", substate: null, headline: STATE_COPY.S3.headline, detail: errMsg };
      }
      if (!shared("rig.capabilities") && !this.config?.capabilities) {
        setShared("rig.capabilities", { probed: false });
      }
    } finally {
      this.refreshing = false;
    }
    setShared("rig.data", {
      ...(this.data ?? {}),
      live: this.live,
      error: this.error,
      config: this.config,
      sidebarState: this.sidebarState,
      healthz: this.healthz,
      cliVersion: this.cliVersion,
      versionLine: formatOpenRigVersionLine({ healthz: this.healthz, cliVersion: this.cliVersion }),
      capabilities: this.data?.capabilities ?? currentCapabilities(shared, terminals?.() ?? []),
    });
    cx.notify();
    if (!this.error && this.data) this.syncRigSpaces(cx);
    if (this.again) { this.again = false; await this.refresh(cx); }
  }

  /** Toasts for a native seat that ended outside OpenRig (never relaunched on its own), and an agent's background open. */
  toast(ev) {
    if (ev.event !== "seat.native_ended" && ev.event !== "terminal.agent_opened") return;
    let d = {};
    try { d = JSON.parse(ev.data); } catch { return; }
    const hasStack = hasRigWorkStack(layout());
    if (ev.event === "seat.native_ended") {
      notify({ title: `${d.sessionName} ended`, body: "The herdr-core terminal closed outside OpenRig. Relaunch or Resume it from Needs-You.", level: "warning",
        action: hasStack ? { name: "layout.select", args: { stack: "rig-work", child: "rig-page" } } : { name: "rig.needs", args: {} } });
    } else {
      notify({ title: `${d.by} opened ${d.viewName ?? d.view}`, body: hasStack ? "In the Rig layout; nothing was moved." : "In a native tab; nothing was moved.", level: "info",
        action: !hasStack && d.tabId ? { name: "tab.select", args: { id: d.tabId } } : { name: "layout.select", args: { stack: "rig-work", child: d.viewId } } });
    }
  }

  /** Holds the activity stream; reconnects for as long as this copy lives. */
  stream(cx) {
    cx.spawn(async (cx) => {
      while (!this.closed) {
        if (!this.config?.daemonUrl) { await new Promise((resolve) => cx.timer.after(1000, () => resolve())); continue; }
        try {
          const url = new URL(this.config.daemonUrl);
          this.sock = await net.connect(url.hostname, Number(url.port || 80));
          await this.sock.write(`GET /api/activity/events HTTP/1.1\r\nHost: ${url.host}\r\nAccept: text/event-stream\r\n\r\n`);
          let carry = new Uint8Array(0), pending = false;
          const feed = sseParser((ev) => {
            this.toast(ev);
            if (pending) return;
            pending = true;
            cx.timer.after(500, (cx) => { pending = false; cx.spawn(async (cx) => this.refresh(cx)); });
          });
          let first = true;
          for (;;) {
            const chunk = await this.sock.read(65536);
            if (chunk === null || this.closed) break;
            if (first) {
              first = false;
              this.live = true; this.delay = 1000;
              if (this.hadDisconnect) { this.hadDisconnect = false; this.forceCapabilityProbe = true; }
              await this.refresh(cx);
            }
            let text;
            [text, carry] = utf8(chunk, carry);
            feed(text);
          }
        } catch (_) { /* reconnect below */ }
        try { this.sock?.close(); } catch (_) {}
        if (this.live) { this.live = false; this.hadDisconnect = true; setShared("rig.data", { ...(this.data ?? {}), live: false, error: this.error, config: this.config, sidebarState: this.sidebarState, capabilities: this.data?.capabilities ?? currentCapabilities(shared, terminals?.() ?? []) }); cx.notify(); }
        if (this.closed) return;
        await new Promise((resolve) => cx.timer.after(this.delay, () => resolve()));
        this.delay = Math.min(this.delay * 2, 30000);
      }
    });
  }

  menu(target, height = 320) {
    const orderMap = shared("rig.order") ?? {};
    const hasCustomOrder = Boolean(target?.orderGroupKey && Array.isArray(orderMap[target.orderGroupKey]) && orderMap[target.orderGroupKey].length > 0);
    openOverlay({
      mod: MOD_IDS.menu,
      kind: "popup",
      width: 280,
      height: hasCustomOrder ? height + 28 : height,
      props: { target: { ...target, hasCustomOrder } },
    });
  }

  /** Clicking a seat row in the sidebar opens the seat page (`rig-view`) and selects the node. */
  seatClick(rig, seat, pod = null) {
    const attached = findAttachedSeat(terminals(), spaces(), seat.session, panes(), { logicalId: seat.logicalId, rig: rig.name });
    if (attached) { run("terminal.peek", { terminal: attached.terminal }); return; }
    openPage(
      { section: "topology", kind: "seat", rig: rig.name, rigId: rig.id, name: seat.logicalId, session: seat.session, ...(pod ? { pod } : {}) },
      `seat:${seat.session}`,
    );
  }

  /** A status mark (`statusMark`: a seat's status, or a tone for a rig): the same marks the Rig page draws. */
  dot(t, key, cell = 14) {
    return statusMarkElement({ div, svg }, t, key, { cell, iconOf: icon });
  }

  focusedSeat(topology = this.data?.topology ?? []) {
    const entry = shared("rig.nav")?.stack?.at(-1);
    if (shownChild() === PAGE && entry?.kind === "seat") return entry.session ?? null;
    const focus = focused();
    const pane = panes().find((p) => p.id === focus?.pane || p.focused);
    if (!pane?.terminal) return null;
    for (const rig of topology) for (const pod of rig.pods) for (const seat of pod.seats) {
      const attached = findAttachedSeat(terminals(), spaces(), seat.session, panes(), { logicalId: seat.logicalId, rig: rig.name });
      if (attached?.terminal === pane.terminal) return seat.session;
    }
    return null;
  }

  priorityRows() {
    return this.needsTracker?.update(this.data?.topology ?? [], this.data?.attentionItems ?? [], {
      focusedSession: this.focusedSeat(), terminals: terminals(),
    }) ?? [];
  }

  openPriority(row) {
    if (row.kind === "ask") this.openNeedTarget(null, row.ask.id);
    else this.seatClick(row.rig, row.seat, row.pod);
  }

  priorityView(t, cx) {
    const rows = this.priorityRows();
    if (this.sidebarState?.id === "S4" && !this.data?.topology?.some((r) => r.name !== "kernel")) return this.topologyRows(t, cx);
    return priorityElements({ div, svg, h_flex }, t, rows, {
      folds: shared("rig.open.sidebar") ?? {}, selected: shared("rig.sel")?.key, iconOf: icon,
      register: (row) => this.visibleTreeRows.push(row),
      fold: (key, value, cx) => { this.fold(key, value); cx.notify(); },
      open: (row) => this.openPriority(row),
      menu: (row) => this.menu(row.kind === "ask" ? needTarget(row.ask) : { ...row.seat, kind: "seat", rig: row.rig.name, rigId: row.rig.id, lifecycle: row.rig.lifecycle }),
      helper: (child) => run("terminal.peek", { terminal: child.address }),
      hovered: this.priorityHovered, hover: (key, cx) => { this.priorityHovered = key; cx.notify(); },
    });
  }

  revealPriorityNeeds(cx) {
    if (narrow()) {
      run("layout.resize", { id: "sidebar", px: Math.max(160, Number(shared("sidebar.width")) || 268) });
      setShared("sidebar.collapsed", false);
    }
    setShared("rig.topology.view", "priority");
    setShared("rig.open.sidebar", { ...(shared("rig.open.sidebar") ?? {}), [branchKey("topology")]: true, "priority:4": true });
    setShared("rig.sel", { key: "priority:4", entry: null, at: Date.now() });
    // Ordinary scroll containers have no public scroll-to-item handle. A new identity resets to their top.
    this.priorityReveal = (this.priorityReveal ?? 0) + 1;
    this.persistSidebarState();
    cx?.notify?.();
  }

  /** Header with `OpenRig` title, Needs-you badge, New rig (+), search/palette, Talk to the operator (S4 only), Page pop-out, TUI pop-out, expand/collapse all, and refresh. */
  header(t) {
    const key = paletteKey(keys(), window()?.platform);
    const needs = this.priorityRows().filter((r) => r.rank === 4).length;
    const showOperatorIcon = Boolean(this.sidebarState?.id === "S4");
    const remoteOperator = Boolean(this.config?.daemonUrl && !isLoopbackDaemonUrl(this.config.daemonUrl));
    const iconButton = (id, name, onClick, label = null) => h_flex().id(id).px(4).h(20).gap(3).rounded(4).items_center().text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(onClick).child(svg(icon(name)).size(12).flex_none()).when(!!label, (el) => el.child(div().text_size(10.5).child(label)));
    return h_flex().id("rig-header").px(10).h(30).items_center().justify_between().flex_none()
      .child(h_flex().gap(6).items_center()
        .child(div().id("rig-header-title").text_size(12).font_semibold().text_color(t.muted).child("OpenRig"))
        .when(needs > 0, (el) => el.child(h_flex().id("rig-needs").px(5).h(18).gap(4).rounded(4).items_center().cursor_pointer()
          .bg(`${t.blocked}26`).text_color(t.blocked).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.revealPriorityNeeds(cx);
          })
          .child(div().size(6).rounded(3).bg(t.blocked))
          .child(div().text_size(10.5).font_semibold().child(String(needs)))))
        .when(!this.live && Boolean(this.data), (el) => el.child(div().text_size(10).text_color(t.dim).child("updates every 5 s"))))
      .child(h_flex().gap(2).items_center()
        .child(iconButton("rig-new-rig", "plus", (_e, cx) => {
          cx.stop_propagation();
          openOverlay(newRigOverlay());
        }).tooltip("New rig…"))
        .when(showOperatorIcon, (el) => el.child(
          iconButton("rig-open-operator", "rig-operator", (_e, cx) => {
            cx.stop_propagation();
            this.openOperator(cx);
          }).tooltip("Talk to the operator").when(remoteOperator, (b) => b.opacity(0.45))
        ))
        .child(iconButton("rig-palette", "search", () => run("mod.open", { name: MOD_IDS.palette }))
          .tooltip(key ? `Search rigs, seats, commands (${key})` : "Search rigs, seats, commands"))
        .child(iconButton("rig-open-page", "rig-popout", (_e, cx) => {
          cx.stop_propagation();
          const fallbackEntry = shared("rig.sel")?.entry ?? shared("rig.nav")?.stack?.at(-1) ?? { section: "topology" };
          openOrFocusRigTab({ shared, setShared, run, spaces, panes, layout }, fallbackEntry);
          cx.notify();
        }).tooltip("Open the Rig page"))
        .child(iconButton("rig-open-tui", "rig-terminal-prompt", (_e, cx) => {
          cx.stop_propagation();
          this.tui(cx);
        }).tooltip("Open the TUI"))
        .child(iconButton("rig-expand-all", "chevron-down", (_e, cx) => {
          cx.stop_propagation();
          const nextOpen = expandAllTopology(shared("rig.open.sidebar"), this.data?.topology ?? []);
          setShared("rig.open.sidebar", nextOpen);
          this.persistSidebarState(nextOpen, shared("rig.order"));
          cx.notify();
        }).tooltip("Expand all"))
        .child(iconButton("rig-collapse-all", "chevron-right", (_e, cx) => {
          cx.stop_propagation();
          const nextOpen = collapseAllTopology(shared("rig.open.sidebar"), this.data?.topology ?? []);
          setShared("rig.open.sidebar", nextOpen);
          this.persistSidebarState(nextOpen, shared("rig.order"));
          cx.notify();
        }).tooltip("Collapse all"))
        .child(iconButton("rig-refresh", "rig-refresh", (_e, cx) => cx.spawn(async (cx) => { this.forceCapabilityProbe = true; await this.reloadConfig(cx); await this.refresh(cx); })).tooltip("Refresh")));
  }

  /** Render S5a–S5d banner above the tree when the daemon is up and the operator is not ready. */
  s5Banner(t) {
    if (this.sidebarState?.id !== "S5") return null;
    const sub = this.sidebarState.substate ?? "5d";
    const headline = this.sidebarState.headline ?? STATE_COPY[sub]?.headline ?? STATE_COPY["5d"].headline;
    const copyText = this.sidebarState.copyText ?? STATE_COPY[sub]?.copyText ?? null;
    const actionLabel = this.sidebarState.actionLabel ?? STATE_COPY[sub]?.actionLabel ?? null;
    const stateWord = this.sidebarState.stateWord ?? null;
    const copied = this.copiedKey === `s5:${sub}`;
    return v_flex().id(`rig-banner-${sub}`).mx(8).my(4).p(8).gap(6).rounded(6).bg(t.raised)
      .child(h_flex().gap(6).items_center().justify_between()
        .child(v_flex().flex_1().min_w_0().gap(2)
          .child(div().text_size(11.5).text_color(t.muted).child(headline))
          .when(Boolean(stateWord), (el) => el.child(div().text_size(11).text_color(t.dim).child(String(stateWord)))))
        .when(Boolean(actionLabel && copyText), (el) => el.child(
          div().id(`rig-s5-copy-${sub}`).flex_none().px(7).h(20).rounded(4).bg(t.chrome).flex().items_center().cursor_pointer()
            .text_size(11).text_color(copied ? (t.working ?? t.accent) : t.accent).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.copyToClipboard(cx, copyText, `s5:${sub}`);
            })
            .child(copied ? "Copied" : actionLabel)
        )));
  }

  states(t) {
    const st = this.sidebarState ?? { id: "S0", headline: STATE_COPY.S0.headline };
    const renderS0 = () => v_flex().id("rig-state-s0").p(10).gap(6)
      .child(div().text_size(12).text_color(t.muted).child(STATE_COPY.S0.headline))
      .children([0, 1, 2].map((i) => div().h(12).w(180 - i * 35).rounded(3).bg(t.raised)));
    if (!this.config || (st.id === "S0" && !this.data && !this.error)) {
      return renderS0();
    }
    if (!this.data && st.id === "S1") {
      const copyLine = st.copyText || s1CopyLine(MOD_IDS.sidebar);
      const copied = this.copiedKey === "s1";
      return v_flex().id("rig-state-s1").p(10).gap(6).text_size(12).text_color(t.muted)
        .child(div().child(STATE_COPY.S1.headline))
        .child(div().text_size(11).text_color(t.dim).child(STATE_COPY.S1.detail))
        .child(v_flex().p(8).gap(6).rounded(10).bg(t.raised).border_1().border_color(t.input ?? t.border)
          .child(div().id("rig-s1-line").text_size(11).text_color(t.foreground).child(copyLine))
          .child(h_flex().child(
            div().id("rig-s1-copy").px(8).h(22).rounded(5).bg(t.chrome).flex().items_center().cursor_pointer()
              .text_size(11.5).text_color(copied ? (t.working ?? t.accent) : t.accent).hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => {
                cx.stop_propagation();
                this.copyToClipboard(cx, copyLine, "s1");
              })
              .child(copied ? "Copied" : STATE_COPY.S1.actionLabel)
          )));
    }
    if (!this.data && st.id === "S2") {
      return v_flex().id("rig-state-s2").p(10).gap(6).text_size(12).text_color(t.muted)
        .child(div().child(STATE_COPY.S2.headline))
        .child(div().text_size(11).text_color(t.dim).child(STATE_COPY.S2.detail))
        .child(h_flex().child(
          h_flex().id("rig-start-daemon").px(8).h(22).gap(5).rounded(5).bg(t.raised).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.startDaemon(cx);
            })
            .when(this.startingDaemon, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.accent).spin(900)))
            .child(div().text_size(11.5).text_color(t.accent).child(this.startingDaemon ? "Starting…" : STATE_COPY.S2.actionLabel))
        ))
        .when(Boolean(this.startDaemonError), (el) => el.child(div().id("rig-start-daemon-error").text_size(11).text_color(t.blocked).child(this.startDaemonError)));
    }
    if (!this.data && st.id === "S7") {
      return v_flex().id("rig-state-s7").p(10).gap(6).text_size(12).text_color(t.muted)
        .child(div().child(STATE_COPY.S7.headline))
        .child(div().text_size(11).text_color(t.blocked).child(st.detail || this.error || ""))
        .child(div().id("rig-retry").px(8).h(22).rounded(5).bg(t.raised).flex().items_center().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => cx.spawn(async (cx) => this.refresh(cx))).child("Retry"));
    }
    if (!this.data && (this.error || st.id === "S3")) {
      return v_flex().id("rig-state-s3").p(10).gap(6).text_size(12).text_color(t.muted)
        .child(div().child(STATE_COPY.S3.headline))
        .child(div().text_size(11).text_color(t.dim).child(st.detail || this.error || ""))
        .child(div().id("rig-retry").px(8).h(22).rounded(5).bg(t.raised).flex().items_center().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => cx.spawn(async (cx) => this.refresh(cx))).child("Retry"));
    }
    if (!this.data) return renderS0();
    return null;
  }

  /** Toggle a fold key in `shared("rig.open.sidebar")` and persist to `<appHome>/openrig/state.json`. */
  fold(key, open, seats = []) {
    const nextOpen = foldChoice(shared("rig.open.sidebar"), key, open, seats);
    setShared("rig.open.sidebar", nextOpen);
    this.persistSidebarState(nextOpen, shared("rig.order"));
  }

  /** Apply selection highlight, muted `·` "elsewhere" indicator, hover Page pop-out icon, and drag-reorder handlers to a tree row. */
  decorateRow(t, el, {
    rowKey,
    entry = null,
    popoutId = null,
    groupKey = null,
    itemId = null,
    siblingIds = null,
  } = {}) {
    const sel = shared("rig.sel");
    const nav = shared("rig.nav");
    const isSelected = Boolean(
      sel && (sel.key === rowKey || (entry && sel.entry && navKey(sel.entry) === navKey(entry) && sel.key === rowKey))
    );
    const elsewhere = isSelected && isSelectionElsewhere(sel, nav);
    const isDropTarget = Boolean(
      this.dragState?.moved &&
      this.dropTarget &&
      groupKey &&
      this.dragState.groupKey === groupKey &&
      this.dropTarget.groupKey === groupKey &&
      String(this.dropTarget.id) === String(itemId) &&
      String(this.dragState.id) !== String(itemId)
    );
    let out = el
      .when(isSelected, (s) => s.bg(t.selection ?? `${t.accent}1f`).border_l(2).border_color(t.accent))
      .when(isDropTarget, (s) => s.border_b(2).border_color(t.accent));
    // Double-click opens the row's page: the row keeps its single-click behaviour, and Enter opens too.
    const openOnDouble = (e, cx) => {
      if (!entry || (e?.click_count ?? 1) < 2) return false;
      if (entry.kind === "rig") this.openRigSpace(cx, entry.rigId ?? entry.name);
      else openPage(entry, rowKey);
      cx?.notify?.();
      return true;
    };

    if (groupKey && itemId && Array.isArray(siblingIds) && siblingIds.length > 1) {
      out = out
        .on_mouse_down("left", (e, cx) => {
          if (openOnDouble(e, cx)) return;
          const x = e?.position?.x ?? e?.x ?? 0;
          const y = e?.position?.y ?? e?.y ?? 0;
          this.dragState = { groupKey, id: String(itemId), siblingIds: siblingIds.map(String), startX: x, startY: y, currentX: x, currentY: y, moved: false };
          this.dropTarget = null;
        })
        .on_mouse_move((e, cx) => {
          if (!this.dragState || this.dragState.groupKey !== groupKey) return;
          const x = e?.position?.x ?? e?.x ?? 0;
          const y = e?.position?.y ?? e?.y ?? 0;
          this.dragState.currentX = x;
          this.dragState.currentY = y;
          if (Math.hypot(x - this.dragState.startX, y - this.dragState.startY) > 4) {
            this.dragState.moved = true;
            this.dropTarget = { groupKey, id: String(itemId), position: "after", x, y };
            cx?.notify?.();
          }
        })
        .on_mouse_up("left", (e, cx) => {
          if (!this.dragState) return;
          const x = e?.position?.x ?? e?.x ?? this.dragState.currentX ?? 0;
          const y = e?.position?.y ?? e?.y ?? this.dragState.currentY ?? 0;
          const drop = this.dropTarget ?? { groupKey, id: String(itemId), position: "after", x, y };
          const res = applySiblingDrop(shared("rig.order") ?? {}, this.dragState, drop, this.dragState.siblingIds);
          this.dragState = null;
          this.dropTarget = null;
          if (res.accepted) {
            setShared("rig.order", res.order);
            this.persistSidebarState(shared("rig.open.sidebar"), res.order);
            cx?.notify?.();
          }
        });
    } else if (entry) {
      out = out.on_mouse_down("left", (e, cx) => { openOnDouble(e, cx); });
    }

    if (elsewhere) {
      out = out.child(div().id(`elsewhere-${rowKey}`).text_size(11).text_color(t.muted).child("·"));
    }
    return out;
  }

  /** Render a top-level collapsible Explorer branch header (`Topology`, `Specs`, `Scopes`, `Terminals`, `Needs`, `System`). */
  branchHeader(t, cx, section, { openBranch, countBadge = null, badgeTone = null, extraLeftOfCount = null, extraRight = null, parentKey = null, groupKey = "tree:branches", siblingIds = RIG_SECTIONS } = {}) {
    const bKey = branchKey(section);
    const entry = { section };
    this.visibleTreeRows.push({ key: bKey, foldKey: bKey, expandable: true, isOpen: openBranch, parentKey, entry });
    const title = SECTION_TITLES[section] ?? section;
    const badgeColor = badgeTone ? (t[badgeTone] ?? t.dim) : t.dim;
    const row = h_flex().id(`rig-section-${section}`).px(8).h(24).gap(6).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        // Clicking the branch header toggles/expands the branch in the sidebar and sets selection (only the pop-out icon or a leaf/node click opens a Page tab when none is open).
        const nextOpenState = !openBranch;
        this.fold(bKey, nextOpenState);
        setShared("rig.sel", { key: bKey, entry, at: Date.now() });
        if (findRigTab(spaces?.() ?? [], panes?.() ?? []) || hasRigWorkStack(layout())) {
          setShared("rig.nav", navPush(shared("rig.nav"), entry));
        }
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu({ kind: "branch", section, name: title, orderGroupKey: groupKey }, 140))
      .child(div().id(`branch-fold-${section}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.fold(bKey, !openBranch);
          cx.notify();
        })
        .child(svg(icon(openBranch ? "chevron-down" : "chevron-right")).size(11)))
      .child(div().flex_1().truncate().text_size(11.5).font_semibold().text_color(t.muted).child(title))
      .when(Boolean(extraLeftOfCount), (el) => el.child(extraLeftOfCount))
      .when(countBadge !== null && countBadge !== undefined && countBadge !== "", (el) =>
        el.child(div().id(`branch-count-${section}`).text_size(10.5).text_color(badgeColor).child(String(countBadge))))
      .when(Boolean(extraRight), (el) => el.child(extraRight));
    return this.decorateRow(t, row, {
      rowKey: bKey,
      entry,
      popoutId: `popout-branch-${section}`,
      groupKey,
      itemId: section,
      siblingIds,
    });
  }

  /** Render the `Topology` branch's children (`Host -> Rig -> Pod -> Seat -> helper` and per-rig `Views`). */
  topologyRows(t, cx) {
    const stale = !!this.error;
    const strip = stripProps();
    const folds = shared("rig.open.sidebar") ?? {};
    const orderMap = shared("rig.order") ?? {};
    const out = [];
    const nonKernelRigs = this.data.topology.filter((r) => r.name !== "kernel");
    const remoteOperator = Boolean(this.config?.daemonUrl && !isLoopbackDaemonUrl(this.config.daemonUrl));
    const renderNoTeamsRow = () => v_flex().id("topology-no-teams").px(18).py(4).gap(5).text_size(11.5).text_color(t.dim)
      .child(div().child(STATE_COPY.S4.noRigsText))
      .when(this.sidebarState?.id === "S4", (el) => el.child(h_flex().child(
        div().id("topology-open-operator").px(7).h(20).rounded(4).bg(t.raised).flex().items_center().cursor_pointer()
          .text_size(11).text_color(t.accent).hover((s) => s.bg(t.hover))
          .when(remoteOperator, (b) => b.opacity(0.45))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.openOperator(cx);
          })
          .child(STATE_COPY.S4.actionLabel)
      )));
    if (!this.data.topology.length) {
      out.push(renderNoTeamsRow());
      return out;
    }
    const viewsData = this.lists["/api/terminal/views"]?.data ?? null;
    const rawHosts = [...new Set(this.data.topology.map((r) => hostOf(r) || "local"))];
    const multiHost = rawHosts.length > 1 || (rawHosts.length === 1 && rawHosts[0] !== "local");
    const hosts = orderSiblings(rawHosts, "topology:hosts", orderMap, (h) => h);

    const renderRigSubtree = (rig, hostParentKey, rigSiblingIds, rigGroupKey, baseIndent = treeIndent(1)) => {
      const rigSeats = rig.pods.flatMap((p) => p.seats);
      const rKey = rigKey(rig.id);
      const openRig = rigFoldOpen(rig, rigSeats, folds);
      const stoppedRig = isRigStopped(rig.lifecycle, rigSeats);
      const views = viewsForRig(strip, rig.pods.flatMap((p) => p.seats.map((s) => s.session)), rig.name);
      const rigEntry = { section: "topology", kind: "rig", rigId: rig.id, name: rig.name };
      this.visibleTreeRows.push({ key: rKey, foldKey: rKey, expandable: true, isOpen: openRig, parentKey: hostParentKey, entry: rigEntry });

      const rigRow = h_flex().id(`rig-${rig.id}`).pl(baseIndent).pr(8).h(24).gap(6).items_center().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.openRigSpace(cx, rig.id))
        .on_mouse_down("right", () => this.menu({ kind: "rig", rig: rig.name, rigId: rig.id, lifecycle: rig.lifecycle, orderGroupKey: `rig:${rig.id}:pods` }))
        .child(div().id(`rig-fold-${rig.id}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.fold(rKey, !openRig, rigSeats); cx.notify(); })
          .child(svg(icon(openRig ? "chevron-down" : "chevron-right")).size(11)))
        .child(div().flex_1().truncate().text_size(12.5).font_semibold().text_color(stale || stoppedRig ? t.dim : t.foreground).child(rig.name))
        .when(stoppedRig, (el) => el.child(div().text_size(10.5).text_color(t.dim).child("stopped"))
          .child(div().id(`rig-resume-${rig.id}`).px(5).h(18).rounded(4).bg(t.raised).flex().items_center().text_size(10.5).text_color(t.accent).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => {
              cx.stop_propagation();
              openOverlay({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: 380, props: { target: { kind: "rig", rig: rig.name, rigId: rig.id, lifecycle: rig.lifecycle }, step: { action: "resume", confirm: true } } });
            }).child("Resume…")))
        .child(this.dot(t, rig.tone))
        .child(div().text_size(11).text_color(t.dim).child(`${rig.activeCount ?? 0}/${rig.seatCount}`))
        .when(views.length > 0, (el) => el.child(div().id(`rig-views-${rig.id}`).px(4).rounded(4).text_size(11).text_color(t.muted).hover((s) => s.bg(t.raised))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            if (!openRig) { this.fold(rKey, true, rigSeats); cx.notify(); }
            else if (views[0]?.id) { selectWorkerView(views[0].id, { run, layout, views, spaces, panes }); }
          })
          .on_mouse_down("right", () => this.menu({ kind: "views", rig: rig.name, rigId: rig.id, views }))
          .child(h_flex().gap(3).items_center().child(svg(icon("layers")).size(11)).child(String(views.length)))));

      out.push(this.decorateRow(t, rigRow, {
        rowKey: rKey,
        entry: rigEntry,
        popoutId: `popout-rig-${rig.id}`,
        groupKey: rigGroupKey,
        itemId: rig.id,
        siblingIds: rigSiblingIds,
      }));

      if (!openRig) return;

      // Pods under Rig
      const podGroupKey = `rig:${rig.id}:pods`;
      const orderedPods = orderSiblings(rig.pods, podGroupKey, orderMap, (p) => p.name);
      const podSiblingIds = orderedPods.map((p) => p.name);
      for (const pod of orderedPods) {
        const key = `${rig.id}/${pod.name}`;
        const pKey = podKey(rig.id, pod.name);
        const openPod = podFoldOpen(rig.id, pod.name, pod.seats, folds);
        const podEntry = { section: "topology", kind: "pod", rig: rig.name, rigId: rig.id, pod: pod.name, name: pod.name };
        this.visibleTreeRows.push({ key: pKey, foldKey: pKey, expandable: true, isOpen: openPod, parentKey: rKey, entry: podEntry });

        const podRow = h_flex().id(`pod-${key}`).pl(baseIndent + 12).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            this.fold(pKey, !openPod, pod.seats);
            setShared("rig.sel", { key: pKey, entry: podEntry, at: Date.now() });
            if (findRigTab(spaces?.() ?? [], panes?.() ?? []) || hasRigWorkStack(layout())) {
              setShared("rig.nav", navPush(shared("rig.nav"), podEntry));
            }
            cx.notify();
          })
          .on_mouse_down("right", () => this.menu({ kind: "pod", rig: rig.name, rigId: rig.id, pod: pod.name, lifecycle: rig.lifecycle, orderGroupKey: `pod:${key}:seats` }))
          .child(div().id(`pod-fold-${key}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); this.fold(pKey, !openPod, pod.seats); cx.notify(); })
            .child(svg(icon(openPod ? "chevron-down" : "chevron-right")).size(11).flex_none()))
          .child(div().flex_1().truncate().text_size(12).text_color(t.muted).child(pod.name || "—"))
          .child(div().text_size(10.5).text_color(t.dim).child(String(pod.seats.length)));

        out.push(this.decorateRow(t, podRow, {
          rowKey: pKey,
          entry: podEntry,
          popoutId: `popout-pod-${rig.id}-${pod.name}`,
          groupKey: podGroupKey,
          itemId: pod.name,
          siblingIds: podSiblingIds,
        }));

        if (!openPod) continue;
        const seatGroupKey = `pod:${key}:seats`;
        const orderedSeats = orderSiblings(pod.seats, seatGroupKey, orderMap, (s) => s.session || s.logicalId);
        const seatSiblingIds = orderedSeats.map((s) => s.session || s.logicalId);
        for (const seat of orderedSeats) {
          const sKey = `seat:${seat.session}`;
          const seatEntry = { section: "topology", kind: "seat", rig: rig.name, rigId: rig.id, name: seat.logicalId, session: seat.session, pod: pod.name };
          // A seat with hc run helpers expands to them.
          const helpers = seat.native?.children ?? [];
          const hKey = `helpers:${seat.session}`;
          const openHelpers = helpers.length > 0 && branchFoldOpen(folds, hKey, true);
          this.visibleTreeRows.push(helpers.length
            ? { key: sKey, foldKey: hKey, expandable: true, isOpen: openHelpers, parentKey: pKey, entry: seatEntry }
            : { key: sKey, expandable: false, parentKey: pKey, entry: seatEntry });

          const ctxLabel = stale ? null : formatSeatContextPct(seat);
          const ctxWarn = !stale && isSeatContextWarning(seat);
          const seatRow = h_flex().id(`seat-${seat.session}`).pl(baseIndent + 2 * TREE_STEP).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
            .on_click(() => this.seatClick(rig, seat, pod.name))
            .on_mouse_down("right", () => this.menu({
              kind: "seat",
              rig: rig.name,
              rigId: rig.id,
              session: seat.session,
              logicalId: seat.logicalId,
              lifecycle: rig.lifecycle,
              placement: seat.placement,
              tmuxAttachCommand: seat.tmuxAttachCommand,
              cwd: seat.cwd,
              sessionAlive: seat.sessionAlive,
              status: seat.status,
              runtime: seat.runtime,
              terminal: seat.terminal,
            }))
            .child(helpers.length
              ? div().id(`seat-fold-${seat.session}`).w(12).flex_none().text_color(t.dim).hover((s) => s.text_color(t.foreground))
                .on_click((_e, cx) => { cx.stop_propagation(); this.fold(hKey, !openHelpers); cx.notify(); })
                .child(svg(icon(openHelpers ? "chevron-down" : "chevron-right")).size(11))
              : leafCell())
            .child(this.dot(t, seat.status))
            .child(div().flex_1().truncate().text_size(12).text_color(stale ? t.dim : seat.tone === "idle" || seat.tone === "done" ? t.muted : t.foreground).child(seat.member))
            .child(div().text_size(11).text_color(t[statusMark(seat.status).word] ?? t.dim).child(stale ? "" : seat.word))
            .when(Boolean(ctxLabel), (el) => el.child(div().id(`seat-ctx-${seat.session}`).text_size(10.5).text_color(ctxWarn ? t.blocked : t.dim).child(ctxLabel)));

          out.push(this.decorateRow(t, seatRow, {
            rowKey: sKey,
            entry: seatEntry,
            popoutId: `popout-seat-${seat.session}`,
            groupKey: seatGroupKey,
            itemId: seat.session || seat.logicalId,
            siblingIds: seatSiblingIds,
          }));

          for (const child of openHelpers ? helpers : []) {
            out.push(h_flex().id(`child-${child.address}`).pl(baseIndent + 3 * TREE_STEP).pr(8).h(20).gap(6).items_center().hover((s) => s.bg(t.hover))
              .on_click(() => run("terminal.peek", { terminal: child.address }))
              .child(leafCell())
              .child(svg(icon("rig-helper")).size(11).flex_none().text_color(t.dim))
              .child(div().flex_1().truncate().text_size(11.5).text_color(t.muted).child(child.label)));
          }
        }
      }

      // Per-rig `Views` branch under each open rig
      const vBranch = rigViewsBranch(rig, strip, viewsData);
      const vKey = viewsKey(rig.id);
      const openViewsBranch = branchFoldOpen(folds, vKey, vBranch.openCount > 0);
      const viewsEntry = { section: "terminals", view: `rig:${rig.name}`, name: `rig:${rig.name}` };
      this.visibleTreeRows.push({ key: vKey, foldKey: vKey, expandable: true, isOpen: openViewsBranch, parentKey: rKey, entry: viewsEntry });

      const viewsHeaderRow = h_flex().id(`views-branch-${rig.id}`).pl(baseIndent + 12).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          this.fold(vKey, !openViewsBranch);
          cx.notify();
        })
        .on_mouse_down("right", () => this.menu({ kind: "views", rig: rig.name, rigId: rig.id, views, orderGroupKey: `rig:${rig.id}:views` }))
        .child(div().id(`views-fold-${rig.id}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.fold(vKey, !openViewsBranch); cx.notify(); })
          .child(svg(icon(openViewsBranch ? "chevron-down" : "chevron-right")).size(11)))
        .child(div().flex_1().truncate().text_size(11.5).text_color(t.muted).child("Views"))
        .child(div().text_size(10.5).text_color(t.dim).child(`⬚ ${vBranch.openCount + vBranch.savedCount}`));

      out.push(this.decorateRow(t, viewsHeaderRow, {
        rowKey: vKey,
        entry: viewsEntry,
        popoutId: `popout-views-${rig.id}`,
      }));

      if (openViewsBranch) {
        const viewItemsGroupKey = `rig:${rig.id}:views`;
        const viewItems = vBranch.items.filter((x) => x.kind !== "new-view");
        const orderedViewItems = orderSiblings(viewItems, viewItemsGroupKey, orderMap, (x) => x.id);
        const viewSiblingIds = orderedViewItems.map((x) => x.id);

        for (const item of orderedViewItems) {
          if (item.kind === "open-view") {
            const v = item.view;
            const viewTitle = v.title || v.name || v.id;
            const itemKey = `rig-view:${rig.id}:${v.id}`;
            const itemEntry = { section: "terminals", view: v.id, name: viewTitle };
            this.visibleTreeRows.push({ key: itemKey, expandable: false, parentKey: vKey, entry: itemEntry });
            const viewRow = h_flex().id(`sidebar-view-${v.id}`).pl(baseIndent + 2 * TREE_STEP).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
              .on_click(() => selectWorkerView(v.id, { run, layout, views, spaces, panes }))
              .on_mouse_down("right", () => this.menu({
                kind: v.following ? "following" : "strip-view",
                viewId: v.id,
                name: viewTitle,
                rig: v.rig ?? rig.name,
                rigId: rig.id,
                grid: v.grid ?? null,
                cells: v.cells ?? [],
                following: v.following ?? null,
                ...(v.following ? {
                  target: v.following.target ?? `rig:${v.rig ?? rig.name}`,
                  enabled: Boolean(v.following.enabled ?? v.following),
                  pruneAfterMs: v.following.pruneAfterMs,
                } : {}),
              }))
              .child(leafCell())
              .child(div().text_size(11.5).text_color(t.accent).child(`▦ ${viewTitle}`).flex_1().truncate())
              .child(div().text_size(10.5).text_color(t.dim).child(v.following ? "follow" : "open"));
            out.push(this.decorateRow(t, viewRow, {
              rowKey: itemKey,
              entry: itemEntry,
              popoutId: `popout-view-${v.id}`,
              groupKey: viewItemsGroupKey,
              itemId: item.id,
              siblingIds: viewSiblingIds,
            }));
          } else if (item.kind === "saved-view") {
            const itemKey = `rig-saved-view:${rig.id}:${item.rawId}`;
            const itemEntry = { section: "terminals", view: item.id, name: item.name };
            this.visibleTreeRows.push({ key: itemKey, expandable: false, parentKey: vKey, entry: itemEntry });
            const savedRow = h_flex().id(`sidebar-saved-view-${rig.id}-${item.rawId}`).pl(baseIndent + 2 * TREE_STEP).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
              .on_click(() => openPage(itemEntry, itemKey))
              .on_mouse_down("right", () => this.menu({ kind: "saved-view", rig: rig.name, view: item.id, name: item.name, orderGroupKey: viewItemsGroupKey }, 140))
              .child(leafCell())
              .child(div().text_size(11.5).text_color(t.foreground).child(`⬚ ${item.name}`).flex_1().truncate())
              .child(div().text_size(10.5).text_color(t.dim).child("saved"));
            out.push(this.decorateRow(t, savedRow, {
              rowKey: itemKey,
              entry: itemEntry,
              popoutId: `popout-saved-view-${rig.id}-${item.rawId}`,
              groupKey: viewItemsGroupKey,
              itemId: item.id,
              siblingIds: viewSiblingIds,
            }));
          }
        }

        // Always expose `+ New worker view…` under a rig's Views branch
        out.push(h_flex().id(`sidebar-design-view-${rig.id}`).pl(baseIndent + 2 * TREE_STEP).pr(8).h(20).gap(6).items_center().hover((s) => s.bg(t.hover))
          .on_click(() => openOverlay({
            mod: MOD_IDS.menu,
            kind: "dialog",
            modal: true,
            width: 680,
            height: 460,
            props: {
              target: { kind: "rig", rig: rig.name, rigId: rig.id, lifecycle: rig.lifecycle },
              step: { action: "design-view" },
            },
          }))
          .child(leafCell())
          .child(div().text_size(11).text_color(t.muted).child("+ New worker view…").flex_1().truncate()));
      }
    };

    if (multiHost) {
      for (const h of hosts) {
        const hKey = hostKey(h);
        const openHost = branchFoldOpen(folds, hKey, true);
        const hostEntry = { section: "topology", kind: "host", hostId: h, name: h };
        this.visibleTreeRows.push({ key: hKey, foldKey: hKey, expandable: true, isOpen: openHost, parentKey: branchKey("topology"), entry: hostEntry });
        const rigsOnHost = this.data.topology.filter((r) => (hostOf(r) || "local") === h);
        const hostRow = h_flex().id(`host-${h}`).pl(treeIndent(1)).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
          .on_click(() => openPage(hostEntry, hKey))
          .on_mouse_down("right", () => this.menu({ kind: "host", hostId: h, name: h, orderGroupKey: `topology:rigs:${h}` }, 140))
          .child(div().id(`host-fold-${h}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); this.fold(hKey, !openHost); cx.notify(); })
            .child(svg(icon(openHost ? "chevron-down" : "chevron-right")).size(11)))
          .child(div().flex_1().truncate().text_size(11.5).font_semibold().text_color(t.muted).child(h))
          .child(div().text_size(10.5).text_color(t.dim).child(String(rigsOnHost.length)));
        out.push(this.decorateRow(t, hostRow, {
          rowKey: hKey,
          entry: hostEntry,
          popoutId: `popout-host-${h}`,
          groupKey: "topology:hosts",
          itemId: h,
          siblingIds: hosts,
        }));
        if (!openHost) continue;
        const rigGroupKey = `topology:rigs:${h}`;
        const orderedRigs = orderSiblings(rigsOnHost, rigGroupKey, orderMap, (r) => r.id);
        const rigSiblingIds = orderedRigs.map((r) => r.id);
        for (const rig of orderedRigs) {
          renderRigSubtree(rig, hKey, rigSiblingIds, rigGroupKey, treeIndent(2));
        }
      }
    } else {
      const rigGroupKey = "topology:rigs:local";
      const orderedRigs = orderSiblings(this.data.topology, rigGroupKey, orderMap, (r) => r.id);
      const rigSiblingIds = orderedRigs.map((r) => r.id);
      for (const rig of orderedRigs) {
        renderRigSubtree(rig, branchKey("topology"), rigSiblingIds, rigGroupKey, treeIndent(1));
      }
    }
    if (nonKernelRigs.length === 0 && this.sidebarState?.id === "S4") {
      out.push(renderNoTeamsRow());
    }
    return out;
  }

  /** Lazy-load a branch API list when first expanded and again on refresh. */
  list(cx, path) {
    const hit = this.lists[path];
    if ((!hit || hit.stale) && this.config && !hit?.loading) {
      this.lists[path] = { ...(hit ?? {}), loading: true };
      cx.spawn(async (cx) => {
        try { this.lists[path] = { data: await this.get(path), at: new Date().toISOString() }; }
        catch (e) { this.lists[path] = { ...(hit ?? {}), error: String(e?.message ?? e), stale: false }; }
        cx.notify();
      });
    }
    return this.lists[path] ?? { loading: true };
  }

  treeLeafRow(t, { id, rowKey, label, detail = "", entry = null, onClick = null, onRight = null, indent = treeIndent(1), parentKey = null, groupKey = null, itemId = null, siblingIds = null, textColor = null } = {}) {
    this.visibleTreeRows.push({ key: rowKey ?? id, expandable: false, parentKey, entry });
    let el = h_flex().id(id).pl(indent).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
      .on_click(onClick ?? (() => entry && openPage(entry, rowKey ?? id)));
    if (onRight) el = el.on_mouse_down("right", onRight);
    el = el
      .child(leafCell())
      .child(div().flex_1().truncate().text_size(12).text_color(textColor ?? t.foreground).child(label))
      .when(Boolean(detail), (s) => s.child(div().text_size(10.5).text_color(t.dim).child(String(detail))));
    return this.decorateRow(t, el, {
      rowKey: rowKey ?? id,
      entry,
      popoutId: entry ? `popout-${id}` : null,
      groupKey,
      itemId,
      siblingIds,
    });
  }

  /** Render the children of `Specs`, `Scopes`, `Terminals`, `Needs`, or `System` when expanded. */
  sectionBranchChildren(t, cx, section) {
    const folds = shared("rig.open.sidebar") ?? {};
    const orderMap = shared("rig.order") ?? {};
    const parentBranchKey = branchKey(section);

    if (section === "system") {
      const sysItems = [
        { id: "health", label: "Health", entry: { section: "system", subview: "health", name: "Health" } },
        { id: "config", label: "Configuration", expandable: true, foldKey: "system:config", entry: { section: "system", subview: "config", name: "Configuration" } },
        { id: "connections", label: "Connections", entry: { section: "system", subview: "connections", name: "Connections" } },
        { id: "people", label: "People", entry: { section: "system", subview: "people", name: "People" } },
        { id: "usage", label: "Usage", entry: { section: "system", subview: "usage", name: "Usage" } },
        { id: "usage-hosts", label: "Usage · all hosts", entry: { section: "system", subview: "usage-hosts", openUsageHosts: true, name: "Usage · all hosts" } },
        { id: "cost", label: "Cost", entry: { section: "system", subview: "cost", name: "Cost" } },
      ];
      const orderedSys = orderSiblings(sysItems, "system:items", orderMap, (x) => x.id);
      const sysSiblingIds = orderedSys.map((x) => x.id);
      const out = [];
      for (const item of orderedSys) {
        if (item.expandable) {
          const openCfg = branchFoldOpen(folds, item.foldKey, false);
          const rowKey = `sys:${item.id}`;
          this.visibleTreeRows.push({ key: rowKey, foldKey: item.foldKey, expandable: true, isOpen: openCfg, parentKey: parentBranchKey, entry: item.entry });
          const cfgRow = h_flex().id(`sys-node-${item.id}`).pl(treeIndent(1)).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
            .on_click(() => openPage(item.entry, rowKey))
            .on_mouse_down("right", () => this.menu({ kind: "system-config", name: "Configuration", orderGroupKey: "system:config:categories" }, 140))
            .child(div().id(`sys-fold-${item.id}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => { cx.stop_propagation(); this.fold(item.foldKey, !openCfg); cx.notify(); })
              .child(svg(icon(openCfg ? "chevron-down" : "chevron-right")).size(11)))
            .child(div().flex_1().truncate().text_size(12).text_color(t.foreground).child(item.label));
          out.push(this.decorateRow(t, cfgRow, {
            rowKey,
            entry: item.entry,
            popoutId: `popout-sys-${item.id}`,
            groupKey: "system:items",
            itemId: item.id,
            siblingIds: sysSiblingIds,
          }));
          if (openCfg) {
            const orderedCats = orderSiblings(CONFIG_CATEGORIES, "system:config:categories", orderMap, (c) => c);
            for (const cat of orderedCats) {
              const catEntry = { section: "system", subview: "config", category: cat, name: cat };
              out.push(this.treeLeafRow(t, {
                id: `sys-config-${cat}`,
                rowKey: `sys:config:${cat}`,
                label: cat,
                entry: catEntry,
                indent: treeIndent(2),
                parentKey: rowKey,
                onRight: () => this.menu({ kind: "system", name: cat, entry: catEntry, orderGroupKey: "system:config:categories" }, 140),
                groupKey: "system:config:categories",
                itemId: cat,
                siblingIds: orderedCats,
              }));
            }
          }
        } else {
          out.push(this.treeLeafRow(t, {
            id: `sys-node-${item.id}`,
            rowKey: `sys:${item.id}`,
            label: item.label,
            entry: item.entry,
            indent: treeIndent(1),
            parentKey: parentBranchKey,
            onRight: () => this.menu({ kind: "system", name: item.label, entry: item.entry, orderGroupKey: "system:items" }, 140),
            groupKey: "system:items",
            itemId: item.id,
            siblingIds: sysSiblingIds,
          }));
        }
      }
      return out;
    }

    const path = { specs: "/api/specs/library", scopes: "/api/scopes?counts=1", terminals: "/api/terminal/views", needs: "/api/attention" }[section];
    const got = section === "needs" && Array.isArray(this.data?.attentionItems) && !this.lists[path]
      ? { data: { items: this.data.attentionItems }, at: this.data.at }
      : this.list(cx, path);
    const out = [];
    if (got.error) {
      if (section === "terminals" && /\b401\b/.test(String(got.error))) {
        out.push(div().id("terminals-token-protected").px(18).py(4).text_size(11.5).text_color(t.muted).child(TERMINAL_TOKEN_PROTECTED));
        return out;
      }
      out.push(div().px(18).py(4).text_size(11.5).text_color(t.blocked).child(got.error));
      out.push(div().id("rig-list-retry").mx(18).px(8).h(22).rounded(5).bg(t.raised).flex().items_center().text_size(12).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.lists[path] = { ...got, stale: true }; cx.notify(); }).child("Retry"));
      if (!got.data) return out;
    } else if (got.data === undefined) {
      return [div().px(18).py(4).text_size(12).text_color(t.dim).child("Reading…")];
    }
    const d = got.data;

    if (section === "specs") {
      const specsList = Array.isArray(d) ? d : [];
      const rigSpecs = specsList.filter((s) => s?.kind === "rig");
      const podSpecs = specsList.filter((s) => s?.kind !== "rig");
      const groups = [
        { kind: "rig", title: "Rigs", items: rigSpecs },
        { kind: "pod", title: "Pods", items: podSpecs },
      ].filter((g) => g.items.length > 0);

      for (const g of groups) {
        const gFoldKey = `specs:kind:${g.kind}`;
        const openKind = branchFoldOpen(folds, gFoldKey, true);
        const kindEntry = { section: "specs", kindFilter: g.kind, name: g.title };
        this.visibleTreeRows.push({ key: gFoldKey, foldKey: gFoldKey, expandable: true, isOpen: openKind, parentKey: parentBranchKey, entry: kindEntry });
        const kindRow = h_flex().id(`specs-kind-${g.kind}`).pl(treeIndent(1)).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
          .on_click(() => openPage(kindEntry, gFoldKey))
          // The group's specs are ordered per namespace (specs:<kind>:<ns>), so Reset order looks at each.
          .on_mouse_down("right", () => this.menu({ kind: "specs-group", specKind: g.kind, name: g.title,
            orderGroupKeys: [...new Set(g.items.map((s) => specNamespaceOf(s)))].map((ns) => `specs:${g.kind}:${ns}`) }, 140))
          .child(div().id(`specs-kind-fold-${g.kind}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); this.fold(gFoldKey, !openKind); cx.notify(); })
            .child(svg(icon(openKind ? "chevron-down" : "chevron-right")).size(11)))
          .child(div().flex_1().truncate().text_size(11.5).font_semibold().text_color(t.muted).child(g.title))
          .child(div().text_size(10.5).text_color(t.dim).child(String(g.items.length)));
        out.push(this.decorateRow(t, kindRow, {
          rowKey: gFoldKey,
          entry: kindEntry,
          popoutId: `popout-specs-kind-${g.kind}`,
        }));
        if (!openKind) continue;

        const namespaces = [...new Set(g.items.map((s) => specNamespaceOf(s)))];
        const multiNs = namespaces.length > 1;
        for (const ns of namespaces) {
          const nsItems = g.items.filter((s) => specNamespaceOf(s) === ns);
          const nsKey = `specs:ns:${g.kind}:${ns}`;
          const openNs = multiNs ? branchFoldOpen(folds, nsKey, true) : true;
          if (multiNs) {
            const nsEntry = { section: "specs", kindFilter: g.kind, namespace: ns, name: ns };
            this.visibleTreeRows.push({ key: nsKey, foldKey: nsKey, expandable: true, isOpen: openNs, parentKey: gFoldKey, entry: nsEntry });
            const nsRow = h_flex().id(`specs-ns-${g.kind}-${ns}`).pl(treeIndent(2)).pr(8).h(20).gap(6).items_center().hover((s) => s.bg(t.hover))
              .on_click(() => openPage(nsEntry, nsKey))
              .child(div().id(`specs-ns-fold-${g.kind}-${ns}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
                .on_click((_e, cx) => { cx.stop_propagation(); this.fold(nsKey, !openNs); cx.notify(); })
                .child(svg(icon(openNs ? "chevron-down" : "chevron-right")).size(11)))
              .child(div().flex_1().truncate().text_size(11).text_color(t.muted).child(ns))
              .child(div().text_size(10).text_color(t.dim).child(String(nsItems.length)));
            out.push(this.decorateRow(t, nsRow, { rowKey: nsKey, entry: nsEntry }));
          }
          if (!openNs) continue;
          const specGroupKey = `specs:${g.kind}:${ns}`;
          const orderedSpecs = orderSiblings(nsItems, specGroupKey, orderMap, (s) => s.id);
          const specSiblingIds = orderedSpecs.map((s) => s.id);
          for (const s of orderedSpecs) {
            const specEntry = { section: "specs", id: s.id, name: s.name };
            out.push(this.treeLeafRow(t, {
              id: `spec-${s.id}`,
              rowKey: `spec:${s.id}`,
              label: s.name,
              detail: s.version ? `v${s.version}` : (s.kind ?? ""),
              entry: specEntry,
              onRight: () => this.menu({ kind: "spec", id: s.id, name: s.name, sourcePath: s.sourcePath ?? null, orderGroupKey: specGroupKey }, 180),
              indent: treeIndent(multiNs ? 3 : 2),
              parentKey: multiNs ? nsKey : gFoldKey,
              groupKey: specGroupKey,
              itemId: s.id,
              siblingIds: specSiblingIds,
            }));
          }
        }
      }
    } else if (section === "scopes") {
      const folders = new Map((this.list(cx, "/api/slices").data?.slices ?? []).filter((x) => typeof x.slicePath === "string").map((x) => [x.slicePath.split(/[\\/]/).pop(), x.slicePath]));
      const missions = orderSiblings(d.missions ?? [], "scopes:missions", orderMap, (m) => m.mission);
      const missionIds = missions.map((m) => m.mission);
      for (const m of missions) {
        const mKey = `mission:${m.mission}`;
        const openMission = branchFoldOpen(folds, mKey, true);
        const missionEntry = { section: "scopes", mission: m.mission, name: m.mission };
        this.visibleTreeRows.push({ key: mKey, foldKey: mKey, expandable: true, isOpen: openMission, parentKey: parentBranchKey, entry: missionEntry });
        const slices = Array.isArray(m.slices) ? m.slices : [];
        const mRow = h_flex().id(`mission-${m.mission}`).pl(treeIndent(1)).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
          .on_click(() => openPage(missionEntry, mKey))
          .on_mouse_down("right", () => this.menu({ kind: "mission", mission: m.mission, name: m.mission, orderGroupKey: `mission:${m.mission}:slices` }, 160))
          .child(div().id(`mission-fold-${m.mission}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); this.fold(mKey, !openMission); cx.notify(); })
            .child(svg(icon(openMission ? "chevron-down" : "chevron-right")).size(11)))
          .child(div().flex_1().truncate().text_size(11.5).font_semibold().text_color(t.muted).child(m.mission))
          .child(div().text_size(10.5).text_color(t.dim).child(String(slices.length)));
        out.push(this.decorateRow(t, mRow, {
          rowKey: mKey,
          entry: missionEntry,
          popoutId: `popout-mission-${m.mission}`,
          groupKey: "scopes:missions",
          itemId: m.mission,
          siblingIds: missionIds,
        }));
        if (!openMission) continue;
        const sliceGroupKey = `mission:${m.mission}:slices`;
        const orderedSlices = orderSiblings(slices, sliceGroupKey, orderMap, (s) => s.dirName);
        const sliceIds = orderedSlices.map((s) => s.dirName);
        for (const s of orderedSlices) {
          const sliceEntry = { section: "scopes", mission: m.mission, slice: s.dirName, name: s.displayName ?? s.dirName };
          out.push(this.treeLeafRow(t, {
            id: `slice-${m.mission}-${s.dirName}`,
            rowKey: `slice:${m.mission}/${s.dirName}`,
            label: s.displayName ?? s.dirName,
            detail: s.status ?? "",
            entry: sliceEntry,
            onRight: () => this.menu({ kind: "slice", mission: m.mission, slice: s.dirName, name: s.displayName ?? s.dirName, id: s.id, slicePath: folders.get(s.dirName) ?? null, orderGroupKey: sliceGroupKey }, 220),
            indent: treeIndent(2),
            parentKey: mKey,
            groupKey: sliceGroupKey,
            itemId: s.dirName,
            siblingIds: sliceIds,
          }));
        }
      }
    } else if (section === "terminals") {
      const savedList = orderSiblings(d.saved ?? [], "terminals:saved", orderMap, (s) => s.id);
      const savedIds = savedList.map((s) => s.id);
      for (const s of savedList) {
        const entry = { section: "terminals", view: `saved:${s.id}`, name: s.name ?? s.id };
        out.push(this.treeLeafRow(t, {
          id: `view-saved-${s.id}`,
          rowKey: `view:saved:${s.id}`,
          label: s.name ?? s.id,
          detail: "saved",
          entry,
          indent: treeIndent(1),
          parentKey: parentBranchKey,
          onRight: () => this.menu({ kind: "terminal", view: entry.view, name: entry.name, orderGroupKey: "terminals:saved" }, 140),
          groupKey: "terminals:saved",
          itemId: s.id,
          siblingIds: savedIds,
        }));
      }
      const derivedList = orderSiblings(d.rigs ?? [], "terminals:derived", orderMap, (r) => r);
      for (const r of derivedList) {
        const entry = { section: "terminals", view: `rig:${r}`, name: `rig:${r}` };
        out.push(this.treeLeafRow(t, {
          id: `view-rig-${r}`,
          rowKey: `view:rig:${r}`,
          label: `rig:${r}`,
          detail: "derived",
          entry,
          indent: treeIndent(1),
          parentKey: parentBranchKey,
          onRight: () => this.menu({ kind: "terminal", rig: r, view: entry.view, name: entry.name, orderGroupKey: "terminals:derived" }, 140),
          groupKey: "terminals:derived",
          itemId: r,
          siblingIds: derivedList,
        }));
      }
    } else if (section === "needs") {
      const perspective = d.perspective ?? this.data?.attentionPerspective ?? null;
      const whoseLine = whoseQueueSummary(perspective, this.config);
      if (whoseLine?.headline) {
        out.push(div().id("sidebar-needs-whose").px(18).py(2).text_size(10.5).text_color(t.dim).child(whoseLine.headline));
      }
      const enrichedById = new Map((this.data?.attentionItems ?? []).filter((x) => x?.id).map((x) => [x.id, x]));
      const mergedItems = (d.items ?? []).map((it) => {
        const match = enrichedById.get(it.id);
        return needTarget(match ? { ...it, ...match } : it);
      });
      const rawItems = sortNeedsByTier(mergedItems);
      const orderedNeeds = orderSiblings(rawItems, "needs:items", orderMap, (n) => n.id);
      const needIds = orderedNeeds.map((n) => n.id);
      for (const n of orderedNeeds) {
        const entry = { section: "needs", id: n.id, name: n.summary };
        const tier = n.tier ?? tierOf(n);
        const rowId = `need-${n.id}`;
        const rowKey = `need:${n.id}`;
        this.visibleTreeRows.push({ key: rowKey, expandable: false, parentKey: parentBranchKey, entry });
        let rowEl = h_flex().id(rowId).pl(treeIndent(1)).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
          .on_click(() => openPage(entry, rowKey))
          .on_mouse_down("right", () => this.menu({ ...n, orderGroupKey: "needs:items" }))
          .child(leafCell());
        if (tier === "escalation") {
          rowEl = rowEl.border_l_2().border_color(t.blocked)
            .child(div().px(4).py(1).rounded(3).bg(`${t.blocked}26`).text_size(9.5).font_semibold().text_color(t.blocked).child("ESCALATION"))
            .child(div().flex_1().truncate().text_size(12).font_semibold().text_color(t.foreground).child(n.summary));
        } else if (tier === "alert") {
          rowEl = rowEl
            .child(div().size(6).flex_none().rounded(3).bg(t.blocked))
            .child(div().flex_1().truncate().text_size(12).font_semibold().text_color(t.foreground).child(n.summary));
        } else if (tier === "update") {
          rowEl = rowEl
            .child(div().flex_1().truncate().text_size(12).text_color(t.dim).child(n.summary))
            .child(div().text_size(10.5).text_color(t.dim).child("update"));
        } else {
          rowEl = rowEl
            .child(div().size(6).flex_none().rounded(3).bg(t.accent))
            .child(div().flex_1().truncate().text_size(12).text_color(t.foreground).child(n.summary));
        }
        if (tier !== "update" && n.urgency) {
          rowEl = rowEl.child(div().text_size(10.5).text_color(t.dim).child(String(n.urgency)));
        }
        out.push(this.decorateRow(t, rowEl, {
          rowKey,
          entry,
          popoutId: `popout-${rowId}`,
          groupKey: "needs:items",
          itemId: n.id,
          siblingIds: needIds,
        }));
      }
      if (!orderedNeeds.length) {
        out.push(div().px(18).py(4).text_size(12).text_color(t.dim).child("No pending Needs-You requests."));
      }
    }

    if (!out.length) {
      out.push(div().px(18).py(4).text_size(12).text_color(t.dim).child(
        {
          specs: "No specifications found.",
          scopes: "No missions or slices in this project.",
          terminals: "No saved or active terminal views.",
          needs: "No pending Needs-You requests.",
        }[section]
      ));
    }
    if (got.error) out.push(div().px(18).py(4).text_size(10.5).text_color(t.dim).child(asOf(got.at)));
    return out;
  }

  /** Render the single 6-branch collapsible Explorer tree (`Topology`, `Specs`, `Scopes`, `Terminals`, `Needs`, `System`). */
  treeRows(t, cx) {
    this.visibleTreeRows = [];
    const folds = shared("rig.open.sidebar") ?? {};
    const orderMap = shared("rig.order") ?? {};
    const orderedSections = orderSiblings(RIG_SECTIONS, "tree:branches", orderMap, (s) => s);
    const out = [];
    const banner = this.s5Banner(t);
    if (banner) out.push(banner);

    for (const section of orderedSections) {
      const bKey = branchKey(section);
      const defaultOpen = section === "topology"
        ? true
        : section === "needs"
          ? Boolean((this.data?.attention ?? 0) > 0)
          : false;
      const openBranch = branchFoldOpen(folds, bKey, defaultOpen);

      if (section === "topology") {
        out.push(this.branchHeader(t, cx, "topology", {
          openBranch,
          countBadge: this.data?.topology?.length ?? 0,
          extraRight: h_flex().id("rig-topology-sort").px(3).gap(3).items_center().text_size(10).text_color(t.dim).cursor_pointer()
            .tooltip(shared("rig.topology.view") === "rig" ? "By rig · switch to Priority" : "Priority · switch to By rig")
            .on_click((_e, cx) => { cx.stop_propagation(); setShared("rig.topology.view", shared("rig.topology.view") === "rig" ? "priority" : "rig"); this.persistSidebarState(); cx.notify(); })
            .child(svg(icon(shared("rig.topology.view") === "rig" ? "layers" : "clock")).size(11))
            .child(shared("rig.topology.view") === "rig" ? "By rig" : "Priority"),
          siblingIds: orderedSections,
        }));
        if (openBranch) {
          out.push(...(shared("rig.topology.view") === "rig" ? this.topologyRows(t, cx) : this.priorityView(t, cx)));
        }
      } else if (section === "needs") {
        const needsCount = this.data?.attention ?? 0;
        const quietChip = this.data?.quietModeChip ?? null;
        const quietChipEl = quietChip?.label
          ? h_flex().id("rig-quiet-mode-chip").px(5).h(18).gap(4).rounded(4).items_center().cursor_pointer()
              .bg(t.raised).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
              .when(Boolean(quietChip.tooltip), (d) => d.tooltip(quietChip.tooltip))
              .on_click((_e, cx) => {
                cx.stop_propagation();
                openPage({ section: "system", subview: "people", name: "People" }, "sys:people");
                cx.notify();
              })
              .when(quietChip.kind === "quiet", (d) => d.child(svg(icon("rig-moon")).size(10).flex_none()))
              .child(div().max_w(110).truncate().text_size(10.5).child(quietChip.shortLabel ?? quietChip.label))
          : null;
        out.push(this.branchHeader(t, cx, "needs", {
          openBranch,
          extraLeftOfCount: quietChipEl,
          countBadge: needsCount > 0 ? `● ${needsCount}` : "0",
          badgeTone: needsCount > 0 ? "blocked" : null,
          siblingIds: orderedSections,
        }));
        if (openBranch) {
          out.push(...this.sectionBranchChildren(t, cx, "needs"));
        }
      } else if (section === "system") {
        const healthGot = Array.isArray(this.data?.health) ? { data: { records: this.data.health } } : (openBranch ? this.list(cx, "/api/health") : (this.lists["/api/health"] ?? {}));
        const chipRecords = healthGot.data !== undefined
          ? (Array.isArray(healthGot.data) ? healthGot.data : (healthGot.data?.records ?? null))
          : (healthGot.error ? null : undefined);
        const chip = worstHealthChip(chipRecords, { loading: Boolean(healthGot.loading), error: healthGot.error ?? null });
        const chipColor = chip.tone === "danger" || chip.tone === "blocked"
          ? (t.blocked ?? t.danger ?? t.foreground)
          : chip.tone === "warning"
            ? (t.ansi3 ?? t.blocked ?? t.warning ?? t.foreground)
            : t.dim;
        const chipBg = (chip.tone === "danger" || chip.tone === "blocked" || chip.tone === "warning") && chipColor
          ? `${chipColor}26`
          : t.raised;
        const chipEl = div().id("sidebar-system-chip").px(6).py(1).rounded(4).bg(chipBg).text_size(10.5).text_color(chipColor).child(chip.label);
        out.push(this.branchHeader(t, cx, "system", {
          openBranch,
          extraRight: chipEl,
          siblingIds: orderedSections,
        }));
        if (openBranch) {
          out.push(...this.sectionBranchChildren(t, cx, "system"));
        }
      } else {
        const path = { specs: "/api/specs/library", scopes: "/api/scopes?counts=1", terminals: "/api/terminal/views" }[section];
        const cached = this.lists[path]?.data;
        const badge = section === "specs" && Array.isArray(cached)
          ? cached.length
          : section === "scopes" && Array.isArray(cached?.missions)
            ? cached.missions.length
            : section === "terminals" && cached
              ? ((cached.saved?.length ?? 0) + (cached.rigs?.length ?? 0))
              : null;
        out.push(this.branchHeader(t, cx, section, {
          openBranch,
          countBadge: badge,
          siblingIds: orderedSections,
        }));
        if (openBranch) {
          out.push(...this.sectionBranchChildren(t, cx, section));
        }
      }
    }

    if (this.error) {
      out.push(div().px(10).py(4).text_size(10.5).text_color(t.dim).child(`${asOf(this.data.at)} · ${STATE_COPY.S3.headline} · ${this.error}`));
    }
    return out;
  }

  handleTreeKeyDown(e, cx) {
    const key = e?.key ?? "";
    const sel = shared("rig.sel");
    const act = treeKeyNav(this.visibleTreeRows, sel?.key ?? null, key, { openMap: shared("rig.open.sidebar") ?? {} });
    if (!act) return;
    if (act.type === "move") {
      setShared("rig.sel", { key: act.key, entry: act.row?.entry ?? null, at: Date.now() });
      cx?.notify?.();
    } else if (act.type === "expand") {
      this.fold(act.foldKey, true);
      cx?.notify?.();
    } else if (act.type === "collapse") {
      this.fold(act.foldKey, false);
      cx?.notify?.();
    } else if (act.type === "activate") {
      const row = this.visibleTreeRows.find((r) => r.key === act.key);
      if (row?.priorityRow) { this.openPriority(row.priorityRow); cx?.notify?.(); return; }
      if (row?.helper) { run("terminal.peek", { terminal: row.helper.address }); return; }
      if (act.entry) {
        if (act.entry.kind === "rig") this.openRigSpace(cx, act.entry.rigId ?? act.entry.name);
        else openPage(act.entry, act.key);
        cx?.notify?.();
      }
    }
  }

  rail(t) {
    const rows = this.priorityRows();
    const needs = rows.filter((r) => r.rank === 4).length;
    return v_flex().size_full().items_center().py(6).gap(8).bg(t.chrome)
      .child(div().id("rig-rail-needs").size(22).rounded(6).flex().items_center().justify_center().text_size(10.5).font_bold()
        .bg(needs ? t.blocked + "26" : "#00000000").text_color(needs ? t.blocked : t.dim)
        .on_click((_e, cx) => this.revealPriorityNeeds(cx)).child(needs ? String(needs) : "·"))
      .children((this.data?.topology ?? []).map((rig) => div().id(`rig-rail-${rig.id}`).w(28).h(36).rounded(6).flex().items_center().justify_center()
        .bg(t.raised).text_size(11).font_semibold().text_color(t.foreground).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.openRigSpace(cx, rig.id))
        .on_mouse_down("right", () => this.menu({ kind: "rig", rig: rig.name, rigId: rig.id, lifecycle: rig.lifecycle }))
        .tooltip(`${rig.name}${rows.some((r) => r.rig?.id === rig.id && r.rank === 4) ? " · Needs you" : ""}`)
        .child(v_flex().items_center().gap(2).child(div().child(rig.name.slice(0, 2)))
          .child(needsMark({ div, svg }, t, rows.find((r) => r.rig?.id === rig.id)?.mark ?? rig.tone, true, icon)))));
  }

  render(cx) {
    const t = theme();
    if (narrow()) return this.rail(t);
    const state = this.states(t);
    let root = v_flex().id("rig-sidebar-root").size_full().bg(t.chrome).text_color(t.foreground)
      .on_mouse_down("left", () => this.focusHandle?.focus?.())
      .on_key_down((e, cx) => this.handleTreeKeyDown(e, cx));
    if (this.focusHandle) root = root.track_focus(this.focusHandle);
    return root
      .child(this.header(t))
      .child(div().h(1).bg(t.border).mx(8))
      .child(v_flex().id(this.priorityReveal ? `rig-list-reveal-${this.priorityReveal}` : "rig-list").flex_1().overflow_y_scrollbar().py(4).children(state ? [state] : this.treeRows(t, cx)));
  }
}
