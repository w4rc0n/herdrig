// OpenRig's actions: the right-click menu on Rig sidebar rows, Rig page rows, Needs-You items and worker
// cell headers, and the dialogs those actions need (a text box, a confirmation, a result).
//
// Every write runs the CLI as the person (`<name>@external` from `<appHome>/openrig/config.json`), with a seat's inherited
// OPENRIG_SESSION_NAME removed (rig-lib writeCommand); the CLI keeps owning tokens and sender identity. Results are
// shown verbatim; an error is not proof nothing happened, so Retry re-reads state before running again.
//
// One-click actions (snapshot, follow, open a view, …; rig-lib ONE_CLICK) open no dialog: the Rig sidebar runs them and
// reports in a toast and the Rig page's status line. Only a failure opens the result dialog here (step.failed), with Retry.
//
// Dialogs: a click beside one closes it (herdr's dialog), and a typed draft is kept per action and
// target until it is sent or cancelled, so an accidental close loses nothing. Ctrl+Enter (Cmd+Enter on macOS) sends.
//
// props: { target: { kind: "seat"|"rig"|"pod"|"need"|"cell"|"views"|"open-view"|"spec"|"slice", ... }, step?: dialog state }
// A need target comes from rig-lib needTarget.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, TextareaState, Textarea, InputState, Input } from "gpui-base";
import { appHome, readTextFile, writeTextFile, theme, run, exec, props, openOverlay, closeOverlay, notify, setShared, shared, layout, window, spaces, panes, terminals, hc } from "herdr";
import { MOD_IDS, NO_PERSON, ACTION_REFUSED, parseConfig, discoverDaemonFromCli, writeCommand, readCommand, personDisableReason, pauseSummary, pauseOutcome, resumeOutcome, sliceForSeat, draftKey, iconsAt, transcriptPath,
  fileEntry, launchSpecArgs, launchSpecEnv, launchFolderProblem, launchSourceProblem, navPush, actionArgs, writeOutcome, actionTitle, doneWords, startOneClick,
  autoGridForSeats, presetGrid, gridPlaceSeat, gridClearCell, gridRemoveCell, gridSplitCell, gridSeats, gridShells, gridPanes, gridFind, cloneGrid, isPad, isShell, cellLabel,
  reflowDesignerGrid, classifyDropZone, gridDockCell, resizeSiblingWeights,
  SWAP_RUNTIMES, SWAP_MODELS_BY_RUNTIME, SWAP_EFFORTS_BY_RUNTIME, filterAllowedModels, changeModelPlan,
  viewsPropsFromLayout, hasRigWorkStack, openOrFocusRigTab, closeRigInspection, selectWorkerView,
  currentCapabilities, capabilityDisableReason, isRigStopped, seatClickTarget, attachToSeat, resetGroupOrder, submitMissionActions, attachRelayPath, layoutHasMod, isLoopbackDaemonUrl } from "./rig-lib.js";

/** This folder, for its own icons: derived from `MOD_IDS.menu` so a 1-line rename in `MOD_IDS` updates both cross-mod opens and icons. */
const ASSETS = `mods/${MOD_IDS.menu}`;
const icon = iconsAt(ASSETS);

const STACK = "rig-work", PAGE = "rig-page";
const page = (entry) => {
  setShared("rig.nav", navPush(shared("rig.nav"), entry));
  openOrFocusRigTab({ run, spaces, panes, layout, section: entry?.section ?? "topology" });
};
/** A one-click action's dialog: the title, a two-line error and its hint, Retry and the footer fit unclipped. */
const RESULT_HEIGHT = 240;
/** Writes that may have arrived even when they failed (a timeout), or whose form stays on screen: never resent via Retry. */
const RESEND_UNSAFE = new Set(["send", "queue", "reply", "launch-spec", "change-model"]);
/** Reopens this mod as a dialog for a step (input, confirm, result). A click beside it closes it. */
const dialog = (target, step, height = 260) => openOverlay({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height, props: { target, step } });
const configNow = async () => {
  const cfg = parseConfig(await readTextFile(`${appHome()}/openrig/config.json`));
  if (cfg.daemonUrl) return cfg;
  // Another mod's shared state may name the daemon only when it's on this machine (loopback).
  const fromShared = shared("rig.data")?.config?.daemonUrl;
  if (fromShared && isLoopbackDaemonUrl(fromShared)) return { ...cfg, daemonUrl: fromShared, daemonUrlSource: cfg.daemonUrlSource ?? "cli" };
  const status = await discoverDaemonFromCli(cfg, exec);
  if (status.reachable && status.daemonUrl) return { ...cfg, daemonUrl: status.daemonUrl, daemonUrlSource: "cli" };
  return { ...cfg, daemonMessage: status.message || cfg.daemonMessage };
};
const info = (target, text) => dialog(target, { action: "info", text }, 160);
/** The worker-view designer: a modal dialog over a rig's seats and a grid (props.target.grid starts it on a view's current layout). */
const openDesigner = (target) => openOverlay({ mod: MOD_IDS.menu, kind: "dialog", modal: true, width: 680, height: 460, props: { target, step: { action: "design-view" } } });
/** 1:1 square preview canvas side length in pixels; the 680×460 designer dialog geometry and moveDividerDrag math both assume this single constant. */
export const DESIGN_SQUARE_PX = 240;
const colCursor = (el) => el.cursor_col_resize?.() ?? el;
const rowCursor = (el) => el.cursor_row_resize?.() ?? el;
const isStopped = (s) => s.status === "stopped" || s.status === "exited" || s.lifecycle === "stopped" || s.lifecycle === "recoverable" || s.attachable === false;
const designDraftKey = (target) => `designer:${target?.rig ?? "rig"}:${target?.replace ?? "new"}`;
/** A one-click action, run by the Rig sidebar: no dialog unless it fails (rig-lib startOneClick). */
const oneClick = (target, action) => startOneClick({ shared, setShared, run, layout, openOverlay }, target, action);

/** The slice folders the daemon knows (`/api/slices`: each with its `slicePath`), by folder name. */
async function slicePaths(config) {
  const r = await fetch(`${config.daemonUrl}/api/slices`);
  if (!r.ok) throw new Error(`GET /api/slices → ${r.status}`);
  const body = await r.json();
  return new Map((body?.slices ?? []).filter((s) => typeof s.slicePath === "string").map((s) => [s.slicePath.split(/[\\/]/).pop(), s.slicePath]));
}

/** The following view the strip shows for a followed target (rig:<name>, slice:<id>), if any. */
function followingFor(view) {
  const views = viewsPropsFromLayout(layout(), shared)?.views ?? [];
  return views.find((v) => v.following?.target === view) ?? null;
}
/** A view in the strip by viewId (or from shared("rig.views")), so cell-split / Edit layout can read its following state. */
function viewInStrip(viewId) {
  if (!viewId) return null;
  const views = viewsPropsFromLayout(layout(), shared)?.views ?? (Array.isArray(shared("rig.views")) ? shared("rig.views") : []);
  return views.find((v) => v.id === viewId) ?? null;
}
const PRUNE_PRESETS = [["5m", 300000], ["10m", 600000], ["30m", 1800000], ["never", null]];
/** "20s", "45m", "1h 30m": a TTL that isn't one of the presets. */
const ttlWords = (ms) => ms == null ? "never" : ms < 60000 ? `${Math.round(ms / 1000)}s` : ms < 3600000 ? `${Math.round(ms / 60000)}m`
  : `${Math.floor(ms / 3600000)}h${Math.round(ms / 60000) % 60 ? ` ${Math.round(ms / 60000) % 60}m` : ""}`;

/** Fills what a target's opener didn't know (a cell header knows the rig's name, not its id) from the sidebar's data. */
function complete(target) {
  if (!target || !target.rig) return target;
  const rig = (shared("rig.data")?.topology ?? []).find((r) => r.id === target.rigId || r.name === target.rig);
  if (!rig) return target;
  const seat = target.session
    ? rig.pods.flatMap((p) => p.seats).find((s) => s.session === target.session)
    : (target.logicalId ? rig.pods.flatMap((p) => p.seats).find((s) => s.logicalId === target.logicalId) : null);
  return {
    ...target,
    rigId: target.rigId ?? rig.id,
    lifecycle: target.lifecycle ?? rig.lifecycle,
    ...(seat ? {
      session: target.session ?? seat.session,
      logicalId: seat.logicalId,
      runtime: target.runtime ?? seat.runtime,
      model: target.model ?? seat.model,
      effort: target.effort ?? seat.effort,
      status: target.status ?? seat.status,
      word: target.word ?? seat.word,
      pod: target.pod ?? seat.pod,
      tmuxAttachCommand: target.tmuxAttachCommand ?? seat.tmuxAttachCommand,
      attachable: target.attachable ?? seat.attachable,
    } : {}),
  };
}

/** "Open its slice": the slice of the seat's open work (rig-lib sliceForSeat), else says there is none. With `file`, that
 *  file of the slice opens in the Files viewer instead of the slice's card. */
async function openSlice(target, file = null) {
  const config = await configNow();
  if (!config.daemonUrl) return info(target, config.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up').");
  try {
    const get = async (path) => { const r = await fetch(`${config.daemonUrl}${path}`); if (!r.ok) throw new Error(`GET ${path} → ${r.status}`); return r.json(); };
    const [rows, scopes] = await Promise.all([get(`/api/queue/list?destinationSession=${encodeURIComponent(target.session)}`), get("/api/scopes?counts=1")]);
    const hit = sliceForSeat(Array.isArray(rows) ? rows : rows?.items ?? [], scopes?.missions ?? []);
    if (!hit) return notify({ title: `${target.logicalId ?? target.session} has no open work naming a slice.`, level: "info" });
    if (!file) return page({ section: "scopes", mission: hit.mission, slice: hit.slice, name: hit.name });
    const folder = (await slicePaths(config)).get(hit.slice);
    if (!folder) return info(target, `OpenRig doesn't say where ${hit.name} is on disk.`);
    page(fileEntry(`${folder}/${file}`, `${file} · ${hit.name}`));
  } catch (e) { info(target, String(e?.message ?? e)); }
}

/** "Open mission…": the project's one mission's card; with several, the Scopes list to pick from. */
async function openMission(target) {
  const config = await configNow();
  if (!config.daemonUrl) return info(target, config.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up').");
  try {
    const r = await fetch(`${config.daemonUrl}/api/scopes?counts=1`);
    const missions = r.ok ? (await r.json())?.missions ?? [] : [];
    page(missions.length === 1 ? { section: "scopes", mission: missions[0].mission, name: missions[0].mission } : { section: "scopes" });
  } catch (e) { info(target, String(e?.message ?? e)); }
}

export default class RigMenu extends View {
  init(_p, cx) {
    this.config = null;
    this.busy = null;
    this.result = null;
    this.handle = cx.focus_handle?.() ?? null;
    this.typing = false;
    const step = props()?.step;
    cx.spawn(async (cx) => {
      this.config = parseConfig(await readTextFile(`${appHome()}/openrig/config.json`));
      cx.notify();
      // A one-click action that failed in the sidebar arrives with its failure, for Retry; without the sidebar one starts
      // once, here: never from render, where notify isn't allowed.
      if (step?.failed) { this.result = step.failed; cx.notify(); } else if (step?.run) this.go(cx, complete(props().target), step);
    });
    if (step?.action === "launch-spec") {
      // Where and on which host the rig starts: the palette's launch-folder / launch-host fill them.
      const drafts = shared("rig.drafts") ?? {};
      this.folder = InputState.new({ placeholder: "Working folder (an absolute path)", value: drafts["launch-folder"] ?? "" });
      this.host = InputState.new({ placeholder: "local (the default), or a registered host id", value: drafts["launch-host"] ?? "" });
      // Enter in either field launches, as Ctrl+Enter does anywhere in the dialog.
      for (const field of [this.folder, this.host]) {
        field.on("focus", () => { this.typing = true; });
        field.on("blur", () => { this.typing = false; });
        field.on("submit", (_e, cx) => { if (!this.result?.ok && !this.busy) this.go(cx, complete(props().target), props().step); });
      }
      this.folder.focus();
      this.typing = true;
    }
    if (step?.action === "design-view") {
      this.initDesigner(complete(props().target));
      this.handle?.focus?.();
    }
    if (step?.action === "change-model") {
      this.initChangeModel(complete(props().target));
      this.handle?.focus?.();
    }
    if (step?.input) {
      // The draft typed last time for this action and target, if it was never sent or cancelled.
      this.draft = draftKey(props()?.target, step.action);
      this.input = TextareaState.new({ placeholder: step.placeholder ?? "", rows: 4, value: (shared("rig.drafts") ?? {})[this.draft] ?? "" });
      this.input.on("focus", () => { this.typing = true; });
      this.input.on("blur", () => { this.typing = false; });
      this.input.on("change", (_e, cx) => {
        if (this.saving) return;
        this.saving = true;
        cx.timer.after(300, () => { this.saving = false; this.keepDraft(); });
      });
      // Enter adds a line; Ctrl+Enter (Cmd+Enter on macOS: GPUI's secondary-enter) sends.
      this.input.on("submit", (e, cx) => { if (e?.secondary && !this.result) this.go(cx, complete(props().target), props().step); });
      this.input.focus();
      this.typing = true;
      cx.timer.after(400, () => this.input.focus());
    }
    if (step?.load === "pause") this.loadPause(cx);
  }

  /** The designer's state: the grid, the seat picked or dragged, the shape of what is saved. */
  initDesigner(target) {
    const seats = this.rigSeats(target);
    const attachable = seats.filter((s) => !isStopped(s));
    this.designDraft = designDraftKey(target);
    this.baseGridJson = JSON.stringify(target.grid ?? null);
    const savedDraft = (shared("rig.drafts") ?? {})[this.designDraft];
    const validDraft = savedDraft?.rows?.length
      && (!target.replace || !target.grid?.rows?.length || savedDraft.baseGridJson === this.baseGridJson)
      ? savedDraft
      : null;
    if (savedDraft && !validDraft) {
      const all = { ...(shared("rig.drafts") ?? {}) };
      delete all[this.designDraft];
      setShared("rig.drafts", all);
    }
      this.grid = validDraft ? cloneGrid(validDraft)
      : target.grid?.rows?.length ? cloneGrid(target.grid)
      : target.cells?.length ? autoGridForSeats(target.cells.map((c) => c.seat)) : autoGridForSeats(attachable.map((s) => s.session));
    // A grid built before the sidebar's data arrived is rebuilt once it has seats, until the person edits it.
    this.autoGrid = !validDraft && !target.grid?.rows?.length && !target.cells?.length;
    this.customGrid = Boolean(validDraft?.customGrid || target.grid?.rows?.length);
    const initialPlaced = gridSeats(this.grid);
    this.checkedSeats = new Set(initialPlaced.length ? initialPlaced : attachable.map((s) => s.session));
    this.shellPanes = gridShells(this.grid).map((sh, i) => ({
      kind: "shell",
      cellId: sh.cellId ?? `shell-${i + 1}`,
      label: sh.label ?? `Shell ${i + 1}`,
      weight: sh.weight ?? 1,
    }));
    const rawFocus = target.focusCell ?? null;
    let initFocus = { row: 0, col: 0 };
    let focusedSeat = null;
    if (typeof rawFocus === "string") {
      for (const [r, row] of (this.grid.rows ?? []).entries()) {
        for (const [c, cell] of (row.cells ?? []).entries()) {
          if (cell.cellId === rawFocus || cell.seat === rawFocus) {
            initFocus = { row: r, col: c };
            focusedSeat = cell.seat ?? null;
            break;
          }
        }
      }
    } else if (rawFocus && typeof rawFocus === "object") {
      initFocus = { row: rawFocus.row ?? rawFocus.r ?? 0, col: rawFocus.col ?? rawFocus.c ?? 0 };
    }
    this.focusCell = this.clampFocusCell(initFocus);
    this.selectedSeat = focusedSeat ?? attachable[0]?.session ?? null;
    this.draggingSeat = null;
    this.hoveredCell = null;
    this.hoverZone = "center";
    this.designError = null;
    this.designStatus = null;
    this.viewName = InputState.new({ placeholder: "View name (optional)", value: target.name ?? "" });
    this.viewName.on("focus", () => { this.typing = true; });
    this.viewName.on("blur", () => { this.typing = false; });
    this.saveNamed = false;
    const stripView = viewInStrip(target.replace ?? target.viewId);
    const stripFollowing = Boolean(stripView?.following?.enabled ?? stripView?.following);
    this.wasFollowing = Boolean(target.following || (target.kind === "following" && target.enabled !== false) || stripFollowing);
    this.followWorkers = validDraft ? false : this.wasFollowing;
  }

  /** Seat harness / model / effort swap modal state ("Always via lead"). */
  initChangeModel(target) {
    const seats = this.rigSeats(target);
    const seat = seats.find((s) => s.session === target.session || s.logicalId === target.logicalId) ?? target;
    this.swapCurRuntime = seat?.runtime ?? target?.runtime ?? "claude-code";
    this.swapCurModel = seat?.model ?? target?.model ?? null;
    this.swapCurEffort = seat?.effort ?? target?.effort ?? null;
    this.swapRuntime = SWAP_RUNTIMES.includes(this.swapCurRuntime) ? this.swapCurRuntime : "claude-code";
    const allowed = filterAllowedModels(SWAP_MODELS_BY_RUNTIME[this.swapRuntime] ?? []);
    this.swapModel = this.swapCurModel && allowed.includes(this.swapCurModel) ? this.swapCurModel : (allowed[0] ?? null);
    const efforts = SWAP_EFFORTS_BY_RUNTIME[this.swapRuntime] ?? [];
    this.swapEffort = this.swapCurEffort && efforts.includes(this.swapCurEffort) ? this.swapCurEffort : (efforts[0] ?? null);
    this.swapConfirmed = false;
    this.swapError = null;
  }

  clampFocusCell(fc = this.focusCell) {
    const rows = this.grid?.rows ?? [];
    if (!rows.length) return { row: 0, col: 0 };
    const rawRow = typeof fc?.row === "number" ? fc.row : typeof fc?.r === "number" ? fc.r : 0;
    const row = Math.max(0, Math.min(rows.length - 1, rawRow));
    const maxCol = Math.max(0, (rows[row]?.cells?.length ?? 1) - 1);
    const rawCol = typeof fc?.col === "number" ? fc.col : typeof fc?.c === "number" ? fc.c : 0;
    const col = Math.max(0, Math.min(maxCol, rawCol));
    return { row, col };
  }

  /** The person edited the grid: it is no longer the automatic one, and manual edits pause auto-follow by default. */
  edited(cx) {
    this.autoGrid = false;
    this.followWorkers = false;
    this.designError = null;
    this.designStatus = null;
    if (this.designDraft && this.grid) {
      setShared("rig.drafts", { ...(shared("rig.drafts") ?? {}), [this.designDraft]: { ...cloneGrid(this.grid), customGrid: Boolean(this.customGrid), baseGridJson: this.baseGridJson ?? JSON.stringify(null) } });
    }
    cx?.notify();
  }

  /** Closes this popup or dialog. A typed draft is kept unless `discard` (Cancel) says otherwise. */
  dismiss(discard = false) {
    if (discard) this.dropDraft(); else this.keepDraft();
    const id = props()?.overlay; if (id) closeOverlay(id);
  }

  /** herdr's teardown (a click beside the dialog closes it): what was typed stays for next time. */
  async close() { this.keepDraft(); }

  keepDraft() {
    // While it is being sent, the text isn't a draft: a close then must not bring it back as one.
    if (!this.draft || !this.input || this.busy || this.result?.ok) return;
    const all = { ...(shared("rig.drafts") ?? {}) }, text = this.input.value();
    if ((all[this.draft] ?? "") === text) return;
    if (text.trim()) all[this.draft] = text; else delete all[this.draft];
    setShared("rig.drafts", all);
  }

  dropDraft() {
    const all = { ...(shared("rig.drafts") ?? {}) };
    let changed = false;
    if (this.draft && this.draft in all) { delete all[this.draft]; changed = true; }
    if (this.designDraft && this.designDraft in all) { delete all[this.designDraft]; changed = true; }
    if (changed) setShared("rig.drafts", all);
  }

  /** Runs one CLI write as the person; returns { ok, json, text }. */
  async write(args, options) {
    if (!args) return { ok: false, text: ACTION_REFUSED };
    const cmd = writeCommand(this.config, args, options);
    if (!cmd) return { ok: false, text: NO_PERSON };
    return writeOutcome(await exec(cmd.command, cmd.args, { timeout: 180000 }));
  }

  async read(args) {
    // Pin this machine on Retry's `ps` re-read so a saved remote `host.selected` never queries another host.
    const cmd = readCommand(this.config, [...args, "--json"], { env: ["OPENRIG_HOST_SELECTED=local"] });
    const r = await exec(cmd.command, cmd.args, { timeout: 60000 });
    try { return JSON.parse(r.stdout); } catch (_) { return null; }
  }

  run(cx, label, work) {
    this.busy = label; this.result = null; cx.notify();
    cx.spawn(async (cx) => {
      try { this.result = await work(); } catch (e) { this.result = { ok: false, text: String(e?.message ?? e) }; }
      // Sent: the draft is done with. Not sent: it stays, for a retry from the menu.
      if (this.result?.ok) this.dropDraft();
      this.busy = null; cx.notify();
    });
  }

  async loadPause(cx) {
    cx.spawn(async (cx) => {
      const t = complete(props().target);
      const config = await configNow();
      if (!config.daemonUrl) { this.pause = { error: config.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up')." }; cx.notify(); return; }
      try {
        const r = await fetch(`${config.daemonUrl}/api/rigs/${encodeURIComponent(t.rigId)}/nodes`);
        this.pause = pauseSummary(await r.json());
      } catch (e) { this.pause = { error: String(e?.message ?? e) }; }
      cx.notify();
    });
  }

  caps() { return currentCapabilities(this.config?.capabilities ?? shared, terminals?.() ?? []); }

  /** The actions offered for a target. Each has a vector icon (no font-dependent glyphs). */
  items(target) {
    const out = [];
    const caps = this.caps();
    const item = (iconName, label, act, actionName = null) => {
      const capReason = actionName ? capabilityDisableReason(actionName, caps) : null;
      const pReason = actionName && this.config ? personDisableReason(actionName === "reply-answer" ? "reply" : actionName, this.config) : null;
      const reason = capReason ?? pReason;
      out.push({ icon: iconName, label, act, disabled: !!reason, reason });
    };
    if (target.kind === "seat" || target.kind === "cell") {
      const stoppedSeat = isStopped(target);
      out.push({
        icon: "terminal",
        label: "Attach",
        // The sidebar outlives this popup and holds the config: hand it Attach (rig.attach). Without it, Attach runs here
        // with the config and this folder's relay.
        act: () => {
          if (layoutHasMod(layout(), MOD_IDS.sidebar)) { run(`rig.attach:${target.session}`); return; }
          void attachToSeat({ run, hc, spaces, panes, terminals, layout, notify, relayPath: attachRelayPath(appHome(), MOD_IDS.menu) }, target, this.config)
            .then((res) => { if (res && res.ok === false && res.reason) notify({ title: `Attach ${target.logicalId ?? target.session}`, body: res.reason, level: "warning" }); });
        },
        disabled: stoppedSeat,
        reason: stoppedSeat ? "Stopped: seat has no running session to attach" : null,
      });
      item("rig-target", "Focus pane", () => {
        const hit = seatClickTarget(viewsPropsFromLayout(layout(), shared), null, target.session, panes?.() ?? [], terminals?.() ?? []);
        if (hit.kind === "focus") {
          if (hit.stack && hit.child) run("layout.select", { stack: hit.stack, child: hit.child });
          if (hit.tab) run("tab.select", { id: hit.tab });
          if (hit.pane) run("pane.focus", { id: hit.pane });
          else if (hit.terminal) run("pane.focus", { terminal: hit.terminal });
          return;
        }
        oneClick(target, "open-seat");
      });
      item("rig-send", "Send message…", () => dialog(target, { input: true, placeholder: `Message to ${target.session}`, action: "send", multiLine: true }), "send");
      item("rig-queue", "Queue work…", () => dialog(target, { input: true, placeholder: "One-line summary; the body follows on the next lines", action: "queue", multiLine: true }, 300), "queue");
      item("rig-target", "Change model / harness…", () => openOverlay({ mod: MOD_IDS.menu, kind: "dialog", modal: true, width: 520, height: 420, props: { target, step: { action: "change-model" } } }), "change-model");
      item("rig-card", "Open seat card", () => page({ section: "topology", kind: "seat", rig: target.rig, rigId: target.rigId, name: target.logicalId, session: target.session }));
      item("rig-target", "Open slice", () => { openSlice(target); });
      // Files open in the Files-look-alike viewer.
      item("file-text", "Open slice SPEC.md", () => { openSlice(target, "SPEC.md"); });
      const transcript = transcriptPath(this.config, target.rig, target.session);
      if (transcript) item("file-text", "Open transcript", () => page(fileEntry(transcript, `Transcript · ${target.logicalId ?? target.session}`)));
      if (target.kind === "cell") item("rig-keyboard", "Take keyboard", () => oneClick(target, "keyboard"));
      else item("rig-view", "Show in worker view", () => oneClick(target, "open-seat"), "open-seat");
      // A native seat's `hc run` children: peek at one over the tab, herdr's own way.
      const children = Array.isArray(target.children) ? target.children : [];
      if (children.length) out.push({ divider: "Helpers (hc run)" });
      for (const child of children) item("rig-helper", `Peek ${child.label}`, () => run("terminal.peek", { terminal: child.address }));
    }
    if (target.kind === "rig" || target.kind === "pod" || target.kind === "seat") {
      // The popup's header already names a rig target; a seat's rig actions get their own label.
      out.push({ divider: target.kind === "seat" ? `Rig ${target.rig}` : "" });
      item("rig-view", "New worker view", () => oneClick({ ...target, view: `rig:${target.rig}` }, "open-view"), "open-view");
      item("rig-view", "Design worker view…", () => openDesigner(target), "design-view");
      // One Following view per rig in this window; the toggle turns its following on or off.
      const followed = followingFor(`rig:${target.rig}`);
      const on = !!followed?.following?.enabled;
      const followReason = capabilityDisableReason(on ? "unfollow" : "follow", caps);
      out.push({ icon: on ? "check" : "rig-follow", label: "Follow active workers", act: () => oneClick({ ...target, view: `rig:${target.rig}` }, on ? "unfollow" : "follow"), disabled: !!followReason, reason: followReason });
      item("rig-snapshot", "Snapshot now", () => oneClick(target, "snapshot"));
      item("rig-target", "Open mission…", () => { openMission(target); });
      out.push({ divider: "" });
      // Resume when paused, Pause when not; with the state unknown or mixed, both.
      const stoppedRig = isRigStopped(target.lifecycle, this.rigSeats(target));
      if (!stoppedRig && target.lifecycle !== "stopped") item("rig-pause", "Pause rig…", () => dialog(target, { action: "pause", load: "pause" }, 360));
      if (stoppedRig || target.lifecycle !== "running") item("rig-play", "Resume rig…", () => dialog(target, { action: "resume", confirm: true }, 380));
    }
    if (target.kind === "tui") {
      // Strip's TUI pill right-click menu — Focus TUI, Restart TUI, Close TUI.
      item("terminal", "Focus TUI", () => {
        if (hasRigWorkStack(layout())) run("layout.select", { stack: target.stack ?? STACK, child: target.childId ?? "main" });
        if (target.tab) run("tab.select", { id: target.tab });
        if (target.terminal) run("pane.focus", { terminal: target.terminal });
      });
      item("rig-refresh", "Restart TUI", () => {
        if (target.terminal) run("terminal.kill", { terminal: target.terminal });
        run("rig.tui");
      });
      item("x", "Close TUI", () => {
        if (target.terminal) run("terminal.kill", { terminal: target.terminal });
      });
    }
    if (target.kind === "spec") {
      // Rig specs only (an agent spec isn't a `rig up` source); a target without a kind is offered it.
      if ((target.sourcePath || target.name) && (!target.specKind || target.specKind === "rig")) item("rig-play", "Launch rig from spec…", () => dialog(target, { action: "launch-spec" }, 300));
      if (target.sourcePath) item("file-text", "Open spec file", () => page(fileEntry(target.sourcePath, `${target.name} · spec`)));
      item("rig-card", "Show spec card", () => page({ section: "specs", id: target.id, name: target.name }));
    }
    if (target.kind === "slice") {
      for (const file of ["SPEC.md", "PROGRESS.md"]) {
        if (target.slicePath) item("file-text", `Open ${file}`, () => page(fileEntry(`${target.slicePath}/${file}`, `${file} · ${target.name}`)));
      }
      item("rig-card", "Show slice card", () => page({ section: "scopes", mission: target.mission, slice: target.slice, name: target.name }));
      item("rig-follow", "Follow this slice", () => oneClick({ kind: "follow-target", view: `slice:${target.id ?? target.slice}`, name: target.name }, "follow"), "follow");
    }
    if (target.kind === "strip-view") {
      // A worker view's strip pill: close it, follow its rig's active workers, or reach the rig.
      item("rig-view", "Edit layout…", () => openDesigner(this.editTarget(target)), "design-view");
      item("x", "Close view", () => oneClick(target, "close-view"), "close-view");
      if (target.rig) item("rig-follow", "Follow active workers", () => oneClick({ ...target, view: `rig:${target.rig}` }, "follow"), "follow");
      this.viewExtras(target.rig, item);
    }
    if (target.kind === "following") {
      // A following view's strip menu: stop or resume, the TTL, close. Closing ends only its viewers.
      const view = { ...target, view: target.target };
      const followReason = capabilityDisableReason(target.enabled ? "unfollow" : "follow", caps);
      out.push(target.enabled
        ? { icon: "rig-pause", label: "Stop following", act: () => oneClick(view, "unfollow"), disabled: !!followReason, reason: followReason }
        : { icon: "rig-play", label: "Resume following", act: () => oneClick(view, "follow"), disabled: !!followReason, reason: followReason });
      const preset = PRUNE_PRESETS.some(([, ms]) => ms === target.pruneAfterMs);
      out.push({ divider: preset || target.pruneAfterMs === undefined ? "Prune idle tiles after" : `Prune idle tiles after (now ${ttlWords(target.pruneAfterMs)})` });
      const pruneReason = capabilityDisableReason("prune", caps);
      for (const [label, ms] of PRUNE_PRESETS) {
        out.push({ icon: target.pruneAfterMs === ms ? "check" : null, label, act: () => oneClick({ ...view, prune: label }, "prune"), disabled: !!pruneReason, reason: pruneReason });
      }
      out.push({ divider: "" });
      item("rig-view", "Edit layout…", () => openDesigner(this.editTarget(target)), "design-view");
      this.viewExtras(String(target.target ?? "").startsWith("rig:") ? target.target.slice(4) : null, item);
      item("x", "Close view", () => oneClick(target, "close-view"), "close-view");
    }
    if (target.kind === "views") {
      for (const v of target.views ?? []) item("rig-view", v.name, () => selectWorkerView(v.id, { run, layout, views: target.views ?? [], spaces, panes }));
      item("plus", "New worker view", () => oneClick({ ...target, view: `rig:${target.rig}` }, "open-view"), "open-view");
      item("rig-view", "Design worker view…", () => openDesigner(target), "design-view");
    }
    if (target.kind === "cell-split") {
      // Another seat of the rig joins this cell's row; the view is updated in place (--replace).
      const placed = new Set(target.placedSeats ?? []);
      const free = this.rigSeats(target).filter((s) => !placed.has(s.session) && !isStopped(s));
      out.push({ divider: free.length ? "Split with" : "Every running seat is already in this view" });
      for (const s of free) item("rig-view", s.logicalId ?? s.session, () => {
        const grid = cloneGrid(target.grid);
        const at = this.cellAt(grid, target) ?? gridFind(grid, target.seat);
        if (!at) return;
        const beforeJson = JSON.stringify(grid);
        const nextGrid = gridSplitCell(grid, at.r, at.c, s.session);
        if (JSON.stringify(nextGrid) === beforeJson) {
          notify({ title: "This view is full (4×4)", level: "warning" });
          return;
        }
        oneClick({ kind: "open-view", view: `rig:${target.rig}`, rig: target.rig, grid: nextGrid, replace: target.viewId }, "open-designed-view");
      }, "cell-split");
      out.push({ divider: "" });
      const stripView = viewInStrip(target.viewId);
      const following = Boolean(target.following || stripView?.following?.enabled || stripView?.following);
      item("rig-view", "Design worker view…", () => openDesigner({ ...target, kind: "strip-view", name: target.name, replace: target.viewId, following, focusCell: target.cellId || target.seat }), "design-view");
    }
    if (target.kind === "need") {
      // A native seat closed outside OpenRig. Offered, never done on its own.
      if (target.native) {
        item("rig-refresh", "Relaunch fresh…", () => dialog({ ...target, reason: "native seat closed outside OpenRig" }, { action: "fresh", confirm: true }, 220));
        item("rig-play", "Resume…", () => dialog({ kind: "rig", rig: target.rig }, { action: "resume", confirm: true }, 380));
      }
      if (target.reply !== "none") item("rig-reply", "Reply…", () => dialog(target, { input: true, placeholder: "Your answer, in your own words", action: "reply", multiLine: true }, 290), target.reply === "answer" ? "reply-answer" : "reply");
      item("rig-card", "Open this item", () => page({ section: "needs", id: target.id, name: target.summary }));
    }
    if (target.kind === "open-view") item("rig-view", `Open ${target.view}`, () => oneClick(target, "open-view"), "open-view");
    const customOrder = target.orderGroupKey ? (shared("rig.order") ?? {})[target.orderGroupKey] : null;
    if (target.orderGroupKey && (target.hasCustomOrder || (Array.isArray(customOrder) && customOrder.length > 0))) {
      if (out.length > 0) out.push({ divider: "" });
      item("rig-refresh", "Reset order", () => {
        const next = resetGroupOrder(shared("rig.order") ?? {}, target.orderGroupKey);
        setShared("rig.order", next);
        run(`rig.reset-order:${target.orderGroupKey}`);
      });
    }
    return out;
  }

  /** Alias for `items(target)`. */
  itemsFor(target) { return this.items(target); }

  /** A strip view's target for the designer: the rig it shows, the view to update in place, its grid, and its following state. */
  editTarget(target) {
    const followed = String(target.target ?? "");
    const stripView = viewInStrip(target.viewId);
    const following = Boolean(target.following || (target.kind === "following" && target.enabled !== false) || stripView?.following?.enabled || stripView?.following);
    return { ...target, rig: target.rig ?? (followed.startsWith("rig:") ? followed.slice(4) : null), replace: target.viewId, grid: target.grid ?? null, following };
  }

  /** The seats of a target's rig (the sidebar's topology), plus any a view being edited holds that it doesn't know. */
  rigSeats(target) {
    const rig = (shared("rig.data")?.topology ?? []).find((r) => (target.rigId && r.id === target.rigId) || r.name === target.rig);
    const seats = rig ? rig.pods.flatMap((p) => p.seats) : [];
    for (const c of target.cells ?? []) {
      if (c.seat && !seats.some((s) => s.session === c.seat)) seats.push({ session: c.seat, logicalId: String(c.seat).split("@")[0], status: "running", word: "in view" });
    }
    return seats;
  }

  /** Where a cell target's `cellId` sits in a grid ({ r, c }), if its cells carry ids. */
  cellAt(grid, target) {
    for (const [r, row] of grid.rows.entries()) for (const [c, cell] of row.cells.entries()) if (target.cellId && cell.cellId === target.cellId) return { r, c };
    return null;
  }

  /** What a strip view's menu adds for its rig: the rig card (with rigId when known), the TUI, a snapshot. */
  viewExtras(rig, item) {
    item("terminal", "Open or switch to the Rig TUI", () => run("rig.tui"));
    if (rig) item("rig-snapshot", "Snapshot now", () => oneClick({ kind: "rig", rig }, "snapshot"));
  }

  /** The CLI behind each action (rig-lib actionArgs, shared with the sidebar's one-click runs). */
  argsFor(target, action, text) { return actionArgs(target, action, text, appHome()); }

  // ---- views --------------------------------------------------------------------------------------------------------
  popup(t, target) {
    const items = this.items(target);
    const reasons = [...new Set(items.map((it) => it.reason).filter(Boolean))];
    return v_flex().id("rig-menu").size_full().p(4).bg(t.raised).border(1).border_color(t.border).rounded(8).text_size(12.5)
      .child(div().px(8).py(4).text_size(11).text_color(t.dim).child(target.kind === "seat" || target.kind === "cell" ? `Seat ${target.logicalId ?? target.session} · ${target.rig}`
        : target.kind === "need" ? (target.summary ?? "Needs you") : target.kind === "tui" ? "Rig TUI" : target.kind === "spec" ? `Spec ${target.name}`
        : target.kind === "slice" ? `Slice ${target.name}` : target.kind === "strip-view" || target.kind === "following" ? `View ${target.name ?? target.viewId}`
        : target.kind === "cell-split" ? `Split ${target.logicalId ?? target.seat}` : `Rig ${target.rig ?? ""}`))
      .children(items.map((it, i) => it.divider !== undefined
        ? v_flex().child(div().h(1).bg(t.border).my(3)).when(!!it.divider, (el) => el.child(div().px(8).py(2).text_size(11).text_color(t.dim).child(it.divider)))
        : h_flex().id(`rig-menu-${i}`).px(8).h(26).gap(8).rounded(5).items_center().text_color(it.disabled ? t.dim : t.foreground).hover((s) => s.bg(it.disabled ? t.raised : t.hover))
          .when(!!it.reason, (el) => el.tooltip(it.reason))
          .on_click(() => { if (!it.disabled) { it.act(); this.dismiss(); } })
          .child(it.icon ? svg(icon(it.icon)).size(13).flex_none().text_color(it.disabled ? t.dim : t.muted) : div().w(13).flex_none())
          .child(div().flex_1().truncate().child(it.label))))
      .when(reasons.length > 0, (el) => el.child(v_flex().id("rig-menu-reasons").px(8).py(4).gap(2).children(reasons.map((r, idx) => div().id(`rig-menu-reason-${idx}`).text_size(11).text_color(t.dim).child(r)))));
  }

  resultView(t, cx, target, step) {
    const r = this.result;
    if (this.busy) return div().text_size(12.5).text_color(t.muted).child(`${this.busy}…`);
    if (!r) return null;
    // A teardown result (even with a non-zero exit, as for a rig already stopped) reads as what it says.
    if (step.action === "pause" && r.json && "sessionsKilled" in r.json) {
      const out = pauseOutcome(r.json);
      return v_flex().gap(4)
        .child(div().text_size(13).font_semibold().text_color(out.ok ? t.foreground : t.blocked).child(out.headline))
        .children(out.notes.map((note) => div().text_size(11.5).text_color(note.startsWith("Error") ? t.blocked : t.dim).child(note)));
    }
    if (step.action === "resume" && r.json) {
      const out = resumeOutcome(r.json);
      const headline = out.ok ? `Resumed ${target.rig}` : out.partial ? `Resumed ${target.rig} · partially` : `${target.rig} wasn't resumed`;
      return v_flex().gap(6)
        .child(div().text_size(13).font_semibold().child(headline))
        .when(!!out.error, (el) => el.child(div().text_color(t.blocked).child(String(out.error?.fact ?? out.error?.message ?? out.error))))
        .children(out.seats.map((s, i) => v_flex().gap(1)
          .child(h_flex().gap(8).items_center()
            .child(svg(icon(s.ok ? "check" : s.needsFresh ? "rig-alert" : "x")).size(13).flex_none().text_color(s.ok ? t.working : t.blocked))
            .child(div().w(120).truncate().child(s.logicalId))
            .child(div().flex_1().truncate().text_color(t.muted).child(s.label))
            .when(s.needsFresh, (el) => el.child(div().id(`fresh-${i}`).px(8).h(22).rounded(5).bg(t.raised).flex().items_center().hover((x) => x.bg(t.hover))
              .on_click(() => dialog({ ...target, logicalId: s.logicalId }, { action: "fresh", confirm: true }, RESULT_HEIGHT)).child("Start fresh…"))))
          .when(!s.ok && !!s.error, (el) => el.child(div().pl(22).text_size(11.5).text_color(t.dim).child(s.error)))));
    }
    return v_flex().gap(6)
      .child(div().text_size(12.5).text_color(r.ok ? t.foreground : t.blocked).child(r.ok ? (r.text || this.doneWords(target, step.action)) : r.text || "It didn't work, and the CLI gave no reason."))
      .when(!!r.warning, (el) => el.child(div().text_size(11).text_color(t.dim).child(r.warning)))
      .when(!r.ok, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(step.action === "send" || step.action === "queue"
        ? "It may still have been delivered: check the seat or `rig queue` before trying again."
        : step.action === "reply" ? "It may still have arrived: check the request in Needs-You before answering again."
        : step.action === "launch-spec" ? "Fix the fields above and press Launch, or check the rig list if Launch timed out."
        : step.action === "pause" || step.action === "resume" ? "Check the current state before trying again; Retry re-reads it first." : "Retry runs it again.")))
      // A message or an answer is never resent from here: it may have arrived. Anything else runs again.
      .when(!r.ok && !RESEND_UNSAFE.has(step.action), (el) => el.child(div().id("rig-retry").px(10).h(24).rounded(6).bg(t.raised).flex().items_center().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.retry(cx, target, step)).child("Retry")));
  }

  /** What a success says when the CLI printed no message of its own. */
  doneWords(target, action) { return doneWords(target, action); }

  /** Run again: lifecycle actions re-read the rig first; a message or answer has no Retry; the rest re-run. */
  retry(cx, target, step) {
    if (RESEND_UNSAFE.has(step.action)) return;
    if (step.action === "pause" || step.action === "resume") {
      this.run(cx, "Re-reading the rig", async () => {
        const ps = await this.read(["ps", "--nodes", "--rig", target.rig]);
        const running = Array.isArray(ps) ? ps.filter((n) => n.sessionStatus === "running" || n.lifecycleState === "running").length : null;
        if (step.action === "pause" && running === 0) return { ok: true, text: `Already paused: no seat of ${target.rig} is running.` };
        if (step.action === "resume" && running !== null && Array.isArray(ps) && running === ps.length) return { ok: true, text: `Already running: every seat of ${target.rig} is up.` };
        return this.write(this.argsFor(target, step.action));
      });
    } else {
      this.result = null;
      this.go(cx, target, step);
    }
  }

  /** Runs the dialog's action once (a second press while it runs does nothing). */
  go(cx, target, step) {
    if (this.busy) return;
    const capAction = step.action === "design-view" ? "open-designed-view" : (step.action === "reply" && target?.reply === "answer" ? "reply-answer" : step.action);
    const disableReason = capabilityDisableReason(capAction, this.caps()) ?? (this.config ? personDisableReason(step.action, this.config) : null);
    if (disableReason) {
      if (step.action === "design-view") this.designError = disableReason;
      else this.result = { ok: false, text: disableReason };
      cx.notify();
      return;
    }
    if (step.action === "launch-spec") {
      const folder = this.folder?.value() ?? "", host = this.host?.value() ?? "";
      const source = target.sourcePath ?? target.name;
      const folderProblem = launchFolderProblem(folder);
      const problem = launchSourceProblem(source) ?? folderProblem;
      const args = launchSpecArgs(source, folder, host);
      const drafts = { ...(shared("rig.drafts") ?? {}), "launch-host": host.trim() };
      if (!folderProblem) drafts["launch-folder"] = folder.trim();
      setShared("rig.drafts", drafts);
      if (problem || !args) { this.result = { ok: false, text: problem ?? "Nothing to launch: the spec has no name or file." }; cx.notify(); return; }
      this.run(cx, "Launching", async () => { const r = await this.write(args, { env: launchSpecEnv(host) }); if (r.ok) run("rig.refresh"); return r; });
      return;
    }
    if (step.action === "design-view") {
      if (!gridSeats(this.grid).length && !gridShells(this.grid).length) {
        this.designError = "Place at least one seat in the grid before opening.";
        cx.notify();
        return;
      }
      if (!gridSeats(this.grid).length) {
        this.designError = "Place at least one seat in the grid before opening.";
        cx.notify();
        return;
      }
      const name = this.viewName.value().trim();
      const args = this.argsFor({ ...target, view: `rig:${target.rig}`, grid: this.grid, save: this.saveNamed ? (name || `${target.rig}-view`) : null,
        name: name || null, replace: target.replace ?? null, follow: this.followWorkers,
        noFollow: Boolean(target.replace && this.wasFollowing && !this.followWorkers) }, "open-designed-view");
      this.designError = null;
      this.result = null;
      this.run(cx, "Opening", async () => { const r = await this.write(args); if (r.ok) { run("rig.refresh"); this.dismiss(true); } return r; });
      return;
    }
    if (step.action === "change-model") {
      const seats = this.rigSeats(target);
      const plan = changeModelPlan(
        { ...target, runtime: this.swapCurRuntime, model: this.swapCurModel, effort: this.swapCurEffort },
        { runtime: this.swapRuntime, model: this.swapModel, effort: this.swapEffort },
        { seats },
      );
      if (!plan.recipient) {
        this.result = { ok: false, text: plan.routingError ?? "No lead or advisor seat found to route the change." };
        cx.notify();
        return;
      }
      if (plan.requiresConfirm && !this.swapConfirmed) {
        this.swapError = "Confirm the session transition checkbox before queueing.";
        cx.notify();
        return;
      }
      this.swapError = null;
      const args = this.argsFor({
        ...target,
        runtime: this.swapCurRuntime,
        model: this.swapCurModel,
        effort: this.swapCurEffort,
        nextRuntime: this.swapRuntime,
        nextModel: this.swapModel,
        nextEffort: this.swapEffort,
        seats,
      }, "change-model");
      this.run(cx, "Queueing", async () => {
        const r = await this.write(args);
        if (r.ok) run("rig.refresh");
        return r;
      });
      return;
    }
    const text = this.input ? this.input.value().trim() : "";
    if (step.input && !text) return;
    if (step.action === "reply") {
      this.run(cx, "Sending", async () => {
        const cfg = await configNow();
        if (!cfg.daemonUrl) return { ok: false, text: cfg.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up')." };
        const r = await submitMissionActions(cfg, target, {
          kind: target.reply === "resolve" ? "resolve" : "answer-text",
          text,
          revision: target.decisionRevision ?? null,
        }, fetch);
        if (r.ok) run("rig.refresh");
        return r;
      });
      return;
    }
    const label = { pause: "Pausing", resume: "Resuming", fresh: "Starting fresh" }[step.action] ?? "Working";
    this.run(cx, label, () => this.write(this.argsFor(target, step.action, text)));
  }

  /** Modal body: change seat harness, model, and effort ("Always via lead" + advisor for orch.lead). */
  changeModelView(t, cx, target) {
    const seats = this.rigSeats(target);
    const plan = changeModelPlan(
      { ...target, runtime: this.swapCurRuntime, model: this.swapCurModel, effort: this.swapCurEffort },
      { runtime: this.swapRuntime, model: this.swapModel, effort: this.swapEffort },
      { seats },
    );
    const models = filterAllowedModels(SWAP_MODELS_BY_RUNTIME[this.swapRuntime] ?? []);
    const efforts = SWAP_EFFORTS_BY_RUNTIME[this.swapRuntime] ?? [];
    const pill = (id, label, active, onClick) => div().id(id).px(8).h(24).rounded(5).flex().items_center().text_size(12).cursor_pointer()
      .bg(active ? t.accent : t.raised).text_color(active ? (t.solid_foreground ?? t.background) : t.muted).border_1().border_color(active ? t.accent : t.border)
      .hover((s) => s.bg(active ? t.accent : t.hover)).on_click((_e, cx) => { onClick(); cx.notify(); }).child(label);
    const toneColor = plan.tone === "working" ? (t.working ?? t.accent) : plan.tone === "warn" ? (t.ansi3 ?? t.blocked) : (t.blocked ?? t.foreground);
    return v_flex().id("change-model-view").gap(10)
      .child(div().text_size(11.5).text_color(t.muted).child(
        `Current: ${this.swapCurRuntime}${this.swapCurModel ? ` · ${this.swapCurModel}` : ""}${this.swapCurEffort ? ` · ${this.swapCurEffort}` : ""}`
      ))
      .child(v_flex().gap(4)
        .child(div().text_size(11).font_semibold().text_color(t.dim).child("Harness"))
        .child(h_flex().id("swap-runtimes").gap(4).flex_wrap().children(SWAP_RUNTIMES.map((r) => pill(`swap-runtime-${r}`, r, this.swapRuntime === r, () => {
          this.swapRuntime = r;
          const nextModels = filterAllowedModels(SWAP_MODELS_BY_RUNTIME[r] ?? []);
          this.swapModel = nextModels.includes(this.swapModel) ? this.swapModel : (nextModels[0] ?? null);
          const nextEfforts = SWAP_EFFORTS_BY_RUNTIME[r] ?? [];
          this.swapEffort = nextEfforts.includes(this.swapEffort) ? this.swapEffort : (nextEfforts[0] ?? null);
          this.swapConfirmed = false;
          this.swapError = null;
        })))))
      .child(this.swapRuntime === "agy"
        ? div().id("swap-agy-note").p(8).rounded(6).bg(t.raised).text_size(12).text_color(t.muted).child("agy's model and effort live in agy's own settings")
        : v_flex().gap(8)
            .child(v_flex().gap(4)
              .child(div().text_size(11).font_semibold().text_color(t.dim).child("Model"))
              .child(h_flex().id("swap-models").gap(4).flex_wrap().children(models.map((m) => pill(`swap-model-${m}`, m, this.swapModel === m, () => {
                this.swapModel = m;
                this.swapError = null;
              })))))
            .when(efforts.length > 0, (el) => el.child(v_flex().gap(4)
              .child(div().text_size(11).font_semibold().text_color(t.dim).child("Effort"))
              .child(h_flex().id("swap-efforts").gap(0).rounded(5).border_1().border_color(t.border).children(efforts.map((ef) =>
                div().id(`swap-effort-${ef}`).px(8).h(24).flex().items_center().text_size(12).cursor_pointer()
                  .bg(this.swapEffort === ef ? t.accent : t.raised).text_color(this.swapEffort === ef ? (t.solid_foreground ?? t.background) : t.muted)
                  .hover((s) => s.bg(this.swapEffort === ef ? t.accent : t.hover))
                  .on_click((_e, cx) => { this.swapEffort = ef; this.swapError = null; cx.notify(); })
                  .child(ef)
              ))))))
      .child(v_flex().id("swap-continuity").p(8).gap(4).rounded(6).bg(t.raised).border(1).border_color(t.border)
        .child(div().text_size(12).font_semibold().text_color(toneColor).child(plan.badge))
        .child(div().text_size(11.5).text_color(t.muted).child(plan.detail))
        .child(div().id("swap-routing").text_size(11).text_color(t.dim).child(
          plan.recipient
            ? `Routes via ${plan.recipientLogicalId} (${plan.recipient}) · OpenRig runs ${plan.cliPreview}`
            : (plan.routingError ?? "No lead or advisor seat found.")
        )))
      .when(plan.requiresConfirm, (el) => el.child(h_flex().id("swap-confirm").gap(6).items_center().cursor_pointer()
        .on_click((_e, cx) => { this.swapConfirmed = !this.swapConfirmed; this.swapError = null; cx.notify(); })
        .child(div().w(13).h(13).flex_none().rounded(3).border_1().border_color(this.swapConfirmed ? t.accent : t.border).flex().items_center().justify_center()
          .when(this.swapConfirmed, (box) => box.bg(t.accent).child(svg(icon("check")).size(10).text_color(t.solid_foreground ?? t.background))))
        .child(div().text_size(12).child(plan.continuity === "fresh"
          ? "I understand switching to or from agy starts a fresh session"
          : "I understand switching harnesses hands over to a new session"))))
      .when(!!this.swapError, (el) => el.child(div().id("swap-error").text_size(11.5).text_color(t.blocked).child(this.swapError)));
  }

  /** The designer's body: seat checklist + '+ Add shell pane' on the left; live-reflowing preview grid with continuous divider-drag on the right; separated bottom bar. */
  designView(t, cx, target) {
    const seats = this.rigSeats(target);
    const attachable = seats.filter((s) => !isStopped(s));
    if (this.autoGrid && !gridSeats(this.grid).length && attachable.length) {
      this.grid = autoGridForSeats(attachable.map((s) => s.session));
      this.checkedSeats = new Set(attachable.map((s) => s.session));
    }
    if (this.selectedSeat === null && attachable.length) this.selectedSeat = attachable[0].session;
    this.focusCell = this.clampFocusCell(this.focusCell);
    const grid = this.grid;
    const change = (cx, fn) => { this.typing = false; this.handle?.focus?.(); fn(); this.edited(cx); };
    const small = (id, label, act, on = true) => div().id(id).w(18).h(18).flex_none().rounded(4).flex().items_center().justify_center().text_size(12)
      .text_color(on ? t.muted : t.border).hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); if (on) act(cx); }).child(label);
    const chipButton = (id, label, act) => div().id(id).px(8).h(22).rounded(5).bg(t.raised).flex().items_center().text_size(12).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => act(cx)).child(label);
    const place = (cx, r, c, seat) => {
      if (seat) {
        change(cx, () => {
          this.checkedSeats?.add(seat);
          gridPlaceSeat(grid, r, c, seat);
        });
      }
    };
    const checkboxSquare = (on, disabled = false) => div().w(13).h(13).flex_none().rounded(3).border_1().border_color(disabled ? t.border : (on ? t.accent : t.border)).flex().items_center().justify_center()
      .when(on && !disabled, (box) => box.bg(t.accent).child(svg(icon("check")).size(10).text_color(t.solid_foreground ?? t.background)));
    const toggle = (id, label, on, flip) => h_flex().id(id).gap(6).items_center().cursor_pointer()
      .on_click((_e, cx) => { this.typing = false; this.handle?.focus?.(); flip(); cx.notify(); })
      .child(checkboxSquare(on))
      .child(div().text_size(12).child(label));
    const logicalOf = (session) => seats.find((s) => s.session === session)?.logicalId ?? String(session).split("@")[0];
    const spot = (seat) => { const at = gridFind(grid, seat); return at ? cellLabel(at.r, at.c) : null; };
    const toggleSeatChecked = (cx, session) => change(cx, () => {
      this.checkedSeats ??= new Set(gridSeats(this.grid));
      if (this.checkedSeats.has(session)) this.checkedSeats.delete(session);
      else this.checkedSeats.add(session);
      const orderedChecked = attachable.map((s) => s.session).filter((ss) => this.checkedSeats.has(ss));
      for (const ss of this.checkedSeats) if (!orderedChecked.includes(ss)) orderedChecked.push(ss);
      this.grid = reflowDesignerGrid(this.grid, orderedChecked, this.shellPanes ?? [], { preserveRows: this.customGrid });
      this.focusCell = this.clampFocusCell(this.focusCell);
    });
    const addShellPane = (cx) => change(cx, () => {
      this.shellPanes ??= [];
      const nextIdx = this.shellPanes.length + 1;
      const sh = { kind: "shell", cellId: `shell-${nextIdx}`, label: `Shell ${nextIdx}`, weight: 1 };
      this.shellPanes.push(sh);
      const orderedChecked = [...(this.checkedSeats ?? new Set(gridSeats(this.grid)))];
      this.grid = reflowDesignerGrid(this.grid, orderedChecked, this.shellPanes, { preserveRows: this.customGrid });
      this.focusCell = this.clampFocusCell(this.focusCell);
    });

    const seatList = v_flex().id("design-seats").w(200).flex_none().gap(2).overflow_y_scrollbar()
      .child(div().text_size(11).font_semibold().text_color(t.dim).child(`Seats (${target.rig})`))
      .children(seats.map((s) => {
        const stopped = isStopped(s), placed = spot(s.session), picked = this.selectedSeat === s.session;
        const isChecked = Boolean(placed || this.checkedSeats?.has(s.session));
        const lid = s.logicalId ?? s.session;
        return h_flex().id(`design-seat-${lid}`).px(6).h(26).gap(6).items_center().rounded(5).when(picked && !stopped, (el) => el.bg(t.selected))
          .when(stopped, (el) => el.opacity(0.5).tooltip("not running: no pane to attach")).hover((x) => x.bg(t.hover))
          .on_click((_e, cx) => { if (!stopped) { this.typing = false; this.handle?.focus?.(); this.selectedSeat = s.session; this.draggingSeat = null; cx.notify(); } })
          .on_mouse_down("left", (_e, cx) => { if (!stopped) { this.typing = false; this.handle?.focus?.(); this.draggingSeat = s.session; this.selectedSeat = s.session; cx.notify(); } })
          .on_mouse_up("left", (_e, cx) => { this.draggingSeat = null; cx.notify(); })
          .child(div().id(`design-seat-check-${lid}`).w(13).h(13).flex_none().rounded(3).border_1().border_color(stopped ? t.border : (isChecked ? t.accent : t.border)).flex().items_center().justify_center()
            .on_click((_e, cx) => { cx.stop_propagation(); if (!stopped) toggleSeatChecked(cx, s.session); })
            .when(isChecked && !stopped, (box) => box.bg(t.accent).child(svg(icon("check")).size(10).text_color(t.solid_foreground ?? t.background))))
          .child(div().size(7).flex_none().rounded(4).bg(t[s.tone] ?? t.dim))
          .child(div().flex_1().truncate().child(lid))
          .child(div().text_size(11).flex_none().text_color(t.dim).child(stopped ? "(stopped) · not running: no pane to attach" : placed ? `✓ ${placed}` : s.word ?? ""));
      }))
      .child(div().id("design-add-shell").mt(4).px(8).h(24).rounded(5).bg(t.raised).flex().items_center().text_size(11.5).text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => addShellPane(cx))
        .child("+ Add shell pane"));

    const cell = (r, c, row) => {
      const x = row.cells[c], pad = isPad(x), shell = isShell(x), over = this.hoveredCell?.r === r && this.hoveredCell?.c === c;
      const focused = (this.focusCell && this.focusCell.row === r && this.focusCell.col === c)
        || (typeof this.focusCell === "string" && (x.cellId === this.focusCell || x.seat === this.focusCell));
      const weight = x.weight ?? 1, label = cellLabel(r, c);
      const cellTitle = shell ? (x.label ?? "Shell") : pad ? "empty" : logicalOf(x.seat);
      return v_flex().id(`design-cell-${r}-${c}`).flex_grow(weight).flex_basis(0).min_w(0).h_full().p(4).gap(2).rounded(6).border(1)
        .border_color(over || focused ? t.accent : t.border).when(!pad, (el) => el.bg(t.raised)).when(pad, (el) => el.border_dashed())
        .on_hover((hovered, cx) => { this.hoveredCell = hovered ? { r, c, zone: this.hoverZone ?? "center" } : (over ? null : this.hoveredCell); cx.notify(); })
        .on_mouse_move((e, cx) => {
          if (this.draggingDivider) { this.moveDividerDrag(e, cx); return; }
          if (e?.local_position && e?.bounds) {
            const zone = classifyDropZone(e.local_position, e.bounds?.size ?? e.bounds);
            this.hoverZone = zone;
            if (!this.hoveredCell || this.hoveredCell.r !== r || this.hoveredCell.c !== c || this.hoveredCell.zone !== zone) {
              this.hoveredCell = { r, c, zone };
              cx.notify();
            }
          }
        })
        .on_click((_e, cx) => { this.typing = false; this.handle?.focus?.(); this.focusCell = { row: r, col: c }; place(cx, r, c, this.selectedSeat); })
        .on_mouse_down("left", (_e, cx) => { if (!pad) { this.typing = false; this.handle?.focus?.(); this.draggingSeat = x.seat ?? x.cellId ?? { r, c }; cx.notify(); } })
        .on_mouse_up("left", (e, cx) => {
          if (this.draggingDivider) { cx.stop_propagation(); this.finishDividerDrag(e, cx); return; }
          cx.stop_propagation();
          const dragged = this.draggingSeat;
          this.draggingSeat = null;
          if (!dragged) { cx.notify(); return; }
          const from = typeof dragged === "object" ? dragged : (gridFind(grid, dragged) ?? null);
          const zone = this.hoveredCell?.r === r && this.hoveredCell?.c === c && this.hoveredCell?.zone ? this.hoveredCell.zone : "center";
          if (from && !(from.r === r && from.c === c) && zone !== "center") {
            change(cx, () => { this.customGrid = true; this.grid = gridDockCell(grid, from, { r, c }, zone); });
          } else if (typeof dragged === "string" && !(from?.r === r && from?.c === c)) {
            place(cx, r, c, dragged);
          } else {
            cx.notify();
          }
        })
        .child(h_flex().gap(4).items_center()
          .child(div().text_size(10.5).text_color(t.dim).child(label))
          .child(div().flex_1())
          .when(!pad, (el) => el.child(small(`design-cell-clear-${r}-${c}`, "×", (cx) => change(cx, () => {
            if (shell) {
              this.shellPanes = (this.shellPanes ?? []).filter((sh) => sh.cellId !== x.cellId && sh.label !== x.label);
              this.grid = reflowDesignerGrid(this.grid, [...(this.checkedSeats ?? [])], this.shellPanes, { preserveRows: this.customGrid });
            } else {
              if (x.seat) this.checkedSeats?.delete(x.seat);
              gridRemoveCell(grid, r, c);
            }
          })))))
        .child(div().flex_1().truncate().text_size(12).text_color(pad ? t.dim : t.foreground).child(cellTitle));
    };

    const rowViews = [];
    for (const [r, row] of (grid.rows ?? []).entries()) {
      const colEls = [];
      for (const [c] of (row.cells ?? []).entries()) {
        colEls.push(cell(r, c, row));
        if (c + 1 < row.cells.length) {
          const activeColDrag = this.draggingDivider?.kind === "col" && this.draggingDivider.r === r && this.draggingDivider.c === c;
          colEls.push(colCursor(div().id(`design-col-div-${r}-${c}`).w(6).h_full().flex_none().rounded(2))
            .when(activeColDrag, (el) => el.bg(t.accent))
            .hover((s) => s.bg(t.accent))
            .tooltip("Drag or click gap to resize adjacent columns")
            .on_mouse_down("left", (e, cx) => {
              cx.stop_propagation();
              this.typing = false;
              this.handle?.focus?.();
              const pos = e?.position ?? e?.local_position ?? { x: 0, y: 0 };
              this.draggingDivider = {
                kind: "col", r, c,
                startX: Number(pos.x ?? 0), startY: Number(pos.y ?? 0),
                startW1: row.cells[c]?.weight ?? 1, startW2: row.cells[c + 1]?.weight ?? 1,
                moved: false,
              };
              cx.notify();
            })
            .on_mouse_move((e, cx) => { if (this.draggingDivider) this.moveDividerDrag(e, cx); })
            .on_mouse_up("left", (e, cx) => { cx.stop_propagation(); if (this.draggingDivider) this.finishDividerDrag(e, cx); })
            .on_click((_e, cx) => {
              if (this.suppressDividerClick) { this.suppressDividerClick = false; return; }
              change(cx, () => { this.customGrid = true; resizeSiblingWeights(row.cells, c, 1); });
            }));
        }
      }
      rowViews.push(h_flex().id(`design-row-${r}`).flex_grow(row.weight ?? 1).flex_basis(0).min_h(0).gap(0).items_center()
        .child(h_flex().flex_1().h_full().gap(0).children(colEls)));
      if (r + 1 < grid.rows.length) {
        const activeRowDrag = this.draggingDivider?.kind === "row" && this.draggingDivider.r === r;
        rowViews.push(rowCursor(div().id(`design-row-div-${r}`).h(6).w_full().flex_none().rounded(2))
          .when(activeRowDrag, (el) => el.bg(t.accent))
          .hover((s) => s.bg(t.accent))
          .tooltip("Drag or click gap to resize adjacent rows")
          .on_mouse_down("left", (e, cx) => {
            cx.stop_propagation();
            this.typing = false;
            this.handle?.focus?.();
            const pos = e?.position ?? e?.local_position ?? { x: 0, y: 0 };
            this.draggingDivider = {
              kind: "row", r, c: 0,
              startX: Number(pos.x ?? 0), startY: Number(pos.y ?? 0),
              startW1: grid.rows[r]?.weight ?? 1, startW2: grid.rows[r + 1]?.weight ?? 1,
              moved: false,
            };
            cx.notify();
          })
          .on_mouse_move((e, cx) => { if (this.draggingDivider) this.moveDividerDrag(e, cx); })
          .on_mouse_up("left", (e, cx) => { cx.stop_propagation(); if (this.draggingDivider) this.finishDividerDrag(e, cx); })
          .on_click((_e, cx) => {
            if (this.suppressDividerClick) { this.suppressDividerClick = false; return; }
            change(cx, () => { this.customGrid = true; resizeSiblingWeights(grid.rows, r, 1); });
          }));
      }
    }

    const paneCount = gridPanes(grid).length;
    const gridView = v_flex().id("design-grid").flex_1().min_w(0).h_full().gap(6).items_center()
      .on_mouse_move((e, cx) => { if (this.draggingDivider) this.moveDividerDrag(e, cx); })
      .child(div().w_full().text_size(11).font_semibold().text_color(t.dim).child(`Layout (${paneCount} pane${paneCount === 1 ? "" : "s"})`))
      .child(v_flex().id("design-square").w(DESIGN_SQUARE_PX).h(DESIGN_SQUARE_PX).flex_none().gap(0).children(rowViews));

    const preset = (id, label, name) => chipButton(id, label, (cx) => change(cx, () => {
      this.customGrid = name !== "auto";
      this.grid = presetGrid(name, this.placedOrAll(attachable));
    }));
    return v_flex().id("design-view").flex_1().min_h(0).gap(8)
      .on_mouse_move((e, cx) => { if (this.draggingDivider) this.moveDividerDrag(e, cx); })
      .on_mouse_up("left", (e, cx) => this.finishDrag(cx, e))
      .child(h_flex().gap(10).flex_1().min_h(0)
        .child(seatList)
        .child(div().w(1).h_full().bg(t.border).flex_none())
        .child(gridView))
      .child(v_flex().gap(6).pt(6).border_t(1).border_color(t.border)
        .child(h_flex().gap(6).items_center()
          .child(preset("design-preset-auto", "Auto grid", "auto")).child(preset("design-preset-lead", "Lead + 2×2", "lead-2x2")).child(preset("design-preset-wide", "Wide + stack", "wide-stack"))
          .child(div().flex_1().border(1).border_color(t.border).rounded(6).px(6).py(2).child(Input.new(this.viewName))))
        .child(h_flex().gap(14).items_center()
          .child(toggle("design-save-toggle", "Save as a named view", this.saveNamed, () => { this.saveNamed = !this.saveNamed; }))
          .child(toggle("design-follow-toggle", "Follow active workers", this.followWorkers, () => { this.followWorkers = !this.followWorkers; }))
          .when(!!this.designStatus && !this.designError, (el) => el.child(div().text_color(t.dim).child(this.designStatus)))
          .when(!!this.designError, (el) => el.child(div().text_color(t.blocked).child(this.designError)))));
  }

  /** Continuous divider drag in the designer preview canvas. */
  moveDividerDrag(e, cx) {
    const d = this.draggingDivider;
    if (!d || !this.grid?.rows) return;
    const pos = e?.position ?? e?.local_position ?? null;
    if (!pos) return;
    const dx = Number(pos.x ?? d.startX) - d.startX;
    const dy = Number(pos.y ?? d.startY) - d.startY;
    const deltaPx = d.kind === "col" ? dx : dy;
    if (Math.abs(deltaPx) < 2) return;
    d.moved = true;
    this.customGrid = true;
    const pairWeight = (Number(d.startW1) > 0 ? Number(d.startW1) : 1) + (Number(d.startW2) > 0 ? Number(d.startW2) : 1);
    if (d.kind === "col") {
      const row = this.grid.rows[d.r];
      if (row?.cells?.[d.c] && row?.cells?.[d.c + 1]) {
        const otherWeight = row.cells.reduce((sum, c, idx) => idx === d.c || idx === d.c + 1 ? sum : sum + (Number(c?.weight) > 0 ? Number(c.weight) : 1), 0);
        const totalWeight = Math.max(pairWeight, pairWeight + otherWeight);
        const totalPx = Math.max(40, Math.round(DESIGN_SQUARE_PX * (pairWeight / totalWeight)));
        const [wA, wB] = resizeSiblingWeights(d.startW1, d.startW2, deltaPx, totalPx);
        row.cells[d.c].weight = wA;
        row.cells[d.c + 1].weight = wB;
        this.edited(cx);
      }
    } else if (d.kind === "row") {
      if (this.grid.rows[d.r] && this.grid.rows[d.r + 1]) {
        const otherWeight = this.grid.rows.reduce((sum, r, idx) => idx === d.r || idx === d.r + 1 ? sum : sum + (Number(r?.weight) > 0 ? Number(r.weight) : 1), 0);
        const totalWeight = Math.max(pairWeight, pairWeight + otherWeight);
        const totalPx = Math.max(40, Math.round(DESIGN_SQUARE_PX * (pairWeight / totalWeight)));
        const [wA, wB] = resizeSiblingWeights(d.startW1, d.startW2, deltaPx, totalPx);
        this.grid.rows[d.r].weight = wA;
        this.grid.rows[d.r + 1].weight = wB;
        this.edited(cx);
      }
    }
  }

  /** Completes a divider drag on mouse-up. */
  finishDividerDrag(e, cx) {
    if (!this.draggingDivider) return;
    if (e && (e.position || e.local_position)) this.moveDividerDrag(e, cx);
    const wasMoved = Boolean(this.draggingDivider.moved);
    this.draggingDivider = null;
    this.suppressDividerClick = wasMoved;
    cx?.notify();
  }

  /** Completes or clears an active drag on mouse-up anywhere in `#design-view` or `#rig-dialog`. */
  finishDrag(cx, e = null) {
    if (this.draggingDivider) {
      this.finishDividerDrag(e, cx);
      return;
    }
    if (!this.draggingSeat) return;
    const seat = this.draggingSeat;
    this.draggingSeat = null;
    if (this.hoveredCell != null && this.grid) {
      const { r, c, zone = "center" } = this.hoveredCell;
      const from = typeof seat === "object" ? seat : gridFind(this.grid, seat);
      if (from && !(from.r === r && from.c === c) && zone !== "center") {
        this.focusCell = { row: r, col: c };
        this.customGrid = true;
        this.grid = gridDockCell(this.grid, from, { r, c }, zone);
        this.edited(cx);
        return;
      }
      if (typeof seat === "string" && !(from?.r === r && from?.c === c)) {
        this.focusCell = { row: r, col: c };
        this.checkedSeats?.add(seat);
        gridPlaceSeat(this.grid, r, c, seat);
        this.edited(cx);
        return;
      }
    }
    cx?.notify();
  }

  /** The seats (and shell panes) a preset arranges: those already in the grid, in reading order; with none placed, every attachable seat. */
  placedOrAll(attachable) {
    const placed = [...gridSeats(this.grid), ...gridShells(this.grid)];
    return placed.length ? placed : attachable.map((s) => s.session);
  }

  dialogView(t, cx, target, step) {
    const title = actionTitle(target, step.action);
    const go = (cx) => this.go(cx, target, step);
    let body = null;
    if (step.action === "design-view") {
      body = this.designView(t, cx, target);
    } else if (step.action === "change-model" && !this.result?.ok && !this.busy) {
      body = this.changeModelView(t, cx, target);
    } else if (step.action === "info") {
      body = div().text_color(t.muted).child(step.text ?? "");
    } else if (step.action === "reply" && !this.result && target.summary && target.summary !== target.id) {
      body = div().text_color(t.muted).child(target.summary);
    } else if (step.action === "pause" && !this.result && !this.busy) {
      const p = this.pause;
      body = !p ? div().text_color(t.muted).child("Reading the rig…") : p.error ? div().text_color(t.blocked).child(p.error)
        : v_flex().gap(3)
          .child(div().child(`This stops all ${p.total} agents. Work in progress stops with them:`))
          .children(p.busy.map((s) => h_flex().gap(8).child(div().size(7).flex_none().rounded(4).bg(t[s.tone] ?? t.dim)).child(div().w(130).truncate().child(s.logicalId))
            .child(div().text_color(t.muted).child(`${s.word}${s.owned ? ` · ${s.owned} owned item${s.owned === 1 ? "" : "s"}` : ""}`))))
          .child(div().text_color(t.dim).child("OpenRig snapshots first (best effort). Resume brings back each conversation where the harness allows."));
    } else if (step.action === "fresh" && !this.result && !this.busy) {
      body = div().child(`${target.logicalId} starts a new conversation; the old one is not resumed.`);
    } else if (step.action === "launch-spec" && !this.result?.ok && !this.busy) {
      const field = (label, state) => v_flex().gap(3).child(div().text_size(11.5).text_color(t.dim).child(label))
        .child(div().border(1).border_color(t.border).rounded(6).px(6).py(4).child(Input.new(state)));
      // The exact source rig up is given, not only the spec's name: what the person approves is what runs.
      const source = target.sourcePath ?? target.name;
      const sourceProblem = launchSourceProblem(source);
      body = v_flex().gap(8)
        .child(div().text_color(t.muted).child(`${target.name}: the seats start in the folder below and run until paused.`))
        .child(div().id("launch-source").text_size(11.5).text_color(sourceProblem ? t.blocked : t.dim).child(sourceProblem ?? `rig up -- ${source}`))
        .child(field("Working folder", this.folder)).child(field("Host (optional)", this.host));
    } else if (step.action === "resume" && !this.result && !this.busy) {
      body = div().child(`Each seat of ${target.rig} comes back from the saved conversation where the harness allows. Any that can't is listed; none starts fresh by itself.`);
    }
    const swapPlan = step.action === "change-model"
      ? changeModelPlan(
          { ...target, runtime: this.swapCurRuntime, model: this.swapCurModel, effort: this.swapCurEffort },
          { runtime: this.swapRuntime, model: this.swapModel, effort: this.swapEffort },
          { seats: this.rigSeats(target) },
        )
      : null;
    const confirmLabel = step.action === "change-model"
      ? (swapPlan?.isLeadSelf ? "Queue for advisor" : "Queue for lead")
      : { pause: "Pause rig", resume: "Resume rig", fresh: "Start fresh", "design-view": "Open", send: "Send", queue: "Queue", reply: "Reply", "launch-spec": "Launch" }[step.action];
    const done = !!this.result?.ok;
    // Only while the dialog offers its button: never re-runs a one-click action or a finished one; launch-spec keeps its fields and Launch button after a validation error.
    const canConfirm = !!confirmLabel && (step.action === "launch-spec" || step.action === "design-view" || step.action === "change-model" ? !this.result?.ok : !this.result) && !this.busy && !step.run;
    const mac = window()?.platform === "macos";
    return v_flex().id("rig-dialog").when(!!this.handle, (el) => el.track_focus(this.handle)).size_full().p(14).gap(10).bg(t.surface ?? t.panel ?? t.bg).text_color(t.foreground).text_size(12.5)
      .on_mouse_move((e, cx) => { if (step.action === "design-view" && this.draggingDivider) this.moveDividerDrag(e, cx); })
      .on_mouse_up("left", (e, cx) => { if (step.action === "design-view") this.finishDrag(cx, e); })
      // Esc cancels an active drag in the designer first; otherwise Esc closes (a draft is kept); Ctrl+Enter / Cmd+Enter sends from anywhere in the dialog.
      .on_key_down((e, cx) => {
        const key = String(e.key ?? "").toLowerCase();
        if (key === "escape") {
          cx.stop_propagation();
          if (step.action === "design-view" && (this.draggingSeat || this.draggingDivider)) {
            this.draggingSeat = null;
            this.draggingDivider = null;
            this.designStatus = "Drag cancelled";
            cx.notify();
            return;
          }
          this.dismiss();
        }
        else if ((key === "enter" || key === "return") && (e.modifiers?.control || e.modifiers?.platform) && canConfirm) {
          cx.stop_propagation();
          go(cx);
        }
        else if (step.action === "design-view" && !this.typing && !e.modifiers?.control && !e.modifiers?.platform && !e.modifiers?.alt) {
          if (key === "up" || key === "arrowup" || key === "down" || key === "arrowdown" || key === "left" || key === "arrowleft" || key === "right" || key === "arrowright") {
            cx.stop_propagation();
            const cur = this.clampFocusCell(this.focusCell);
            const dRow = (key === "up" || key === "arrowup") ? -1 : (key === "down" || key === "arrowdown") ? 1 : 0;
            const dCol = (key === "left" || key === "arrowleft") ? -1 : (key === "right" || key === "arrowright") ? 1 : 0;
            this.focusCell = this.clampFocusCell({ row: cur.row + dRow, col: cur.col + dCol });
            cx.notify();
          } else if (key === "enter" || key === "return") {
            cx.stop_propagation();
            const cur = this.clampFocusCell(this.focusCell);
            if (this.selectedSeat && this.grid?.rows?.[cur.row]?.cells?.[cur.col]) {
              gridPlaceSeat(this.grid, cur.row, cur.col, this.selectedSeat);
              this.edited(cx);
            }
          }
        }
      })
      .child(div().text_size(14).font_semibold().child(title))
      .when(!!body, (el) => el.child(body))
      .when(!!this.input && !this.result, (el) => el.child(div().flex_1().border(1).border_color(t.border).rounded(6).p(6).child(Textarea.new(this.input).h(96)))
        .child(div().text_size(11).text_color(t.dim).child(`${mac ? "⌘ Return" : "Ctrl+Enter"} sends · Esc or a click outside closes; your text is kept until you send or cancel`)))
      // A long result (a Resume list) scrolls inside the dialog; the buttons stay in view.
      .when(step.action !== "design-view" || !!this.result || !!this.busy, (el) => el.child(v_flex().id("rig-dialog-body").flex_1().min_h(0).overflow_y_scrollbar().child(this.resultView(t, cx, target, step) ?? div())))
      .child(h_flex().gap(8).justify_end()
        .child(div().id("rig-cancel").px(12).h(26).rounded(6).bg(t.raised).flex().items_center().hover((s) => s.bg(t.hover))
          .on_click(() => this.dismiss(!done)).child(done ? "Close" : "Cancel"))
        .when(canConfirm, (el) => el.child(div().id("rig-confirm").px(12).h(26).rounded(6)
          .bg(step.action === "pause" || step.action === "fresh" ? t.blocked : t.accent).text_color(t.background ?? "#fff").flex().items_center()
          .on_click((_e, cx) => go(cx)).child(confirmLabel))));
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    if (!p.target) return div();
    const target = complete(p.target);
    return p.step ? this.dialogView(t, cx, target, p.step) : this.popup(t, target);
  }
}
