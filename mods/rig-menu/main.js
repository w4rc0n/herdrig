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
// props: { target: { kind: "seat"|"assistant"|"rig"|"pod"|"need"|"cell"|"views"|"open-view"|"spec"|"slice", ... }, step?: dialog state }
import {assistantAddress,assistantActionRefusal,verifyAssistantTarget} from './rig-connected-assistants.js';
// A need target comes from rig-lib needTarget.
import { View, div, svg } from "gpui-kit";
import { registerRigRouting } from "./rig-lib.js";
import { targetConnection } from "./rig-connections.js";
import { typeahead } from "./rig-typeahead.js";
import { revealAfterKey } from "./rig-scroll-reveal.js";
import { dismissible, requestDismissal, updateKey, dismissalScope } from "./rig-dismiss.js";
import { workerCapabilityText } from "./rig-lib.js";
import { rigOrigin } from "./rig-space-context.js";
import { MachineSetupPanel } from "./rig-machine-setup-view.js";
import { rigSpaceRelocation } from "./rig-spaces.js";
import { h_flex, v_flex, TextareaState, Textarea, InputState, Input, ScrollHandle } from "gpui-base";
import { appHome, readTextFile, writeTextFile, theme, run, exec, props, openOverlay, closeOverlay, notify, setShared as rawSetShared, shared, layout, window, spaces, panes, terminals, hc, settings, machines } from "herdr";
import { guardFlatStore } from "./rig-connections.js";
let flatOwner = null; // the view whose connection is writing: the flat stores accept only the legacy connection (PR 1)
const setShared = guardFlatStore(rawSetShared, () => flatOwner?.config?.connectionId);
import { MOD_IDS, NO_PERSON, ACTION_REFUSED, parseConfig, discoverDaemonFromCli, writeCommand, readCommand, personDisableReason, pauseSummary, pauseOutcome, resumeOutcome, sliceForSeat, draftKey, iconsAt, transcriptPath, isTerminalSeat,
  fileEntry, launchSpecArgs, launchSpecEnv, launchFolderProblem, launchSourceProblem, navPush, actionArgs, writeOutcome, actionTitle, doneWords, startOneClick,
  autoGridForSeats, presetGrid, gridPlaceSeat, gridClearCell, gridRemoveCell, gridSplitCell, gridSeats, gridShells, gridPanes, gridFind, cloneGrid, isPad, isShell, cellLabel,
  reflowDesignerGrid, classifyDropZone, gridDockCell, resizeSiblingWeights,
  SWAP_RUNTIMES, SWAP_MODELS_BY_RUNTIME, SWAP_EFFORTS_BY_RUNTIME, filterAllowedModels, changeModelPlan,
  viewsPropsFromLayout, hasRigWorkStack, openOrFocusRigTab, closeRigInspection, selectWorkerView,
  currentCapabilities, capabilityDisableReason, isRigStopped, seatClickTarget, attachToSeat, resetGroupOrder, submitMissionActions, attachRelayPath, waitWith, layoutHasMod, isLoopbackDaemonUrl,
  statusMarkElement, deleteOutcome, rigNameProblem, newRigFromSpecArgs, newRigOneSeatArgs, commandLine, NEW_RIG_RUNTIMES,
  readRigSpecPreview, singleLineText } from "./rig-lib.js";

/** This folder, for its own icons: derived from `MOD_IDS.menu` so a 1-line rename in `MOD_IDS` updates both cross-mod opens and icons. */
const ASSETS = `mods/${MOD_IDS.menu}`;
const icon = iconsAt(ASSETS);

const STACK = "rig-work", PAGE = "rig-page";
const page = (entry) => {
  setShared("rig.nav", navPush(shared("rig.nav"), entry));
  return openOrFocusRigTab({ run, spaces, panes, layout, section: entry?.section ?? "topology" });
};
/** A one-click action's dialog: the title, a two-line error and its hint, Retry and the footer fit unclipped. */
const RESULT_HEIGHT = 240;
/** Writes that may have arrived even when they failed (a timeout), or whose form stays on screen: never resent via Retry. */
const RESEND_UNSAFE = new Set(["send", "queue", "reply", "launch-spec", "change-model", "new-rig"]);
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
  const measured=shared("rig.capabilities");
  if(measured?.hostWorkerViews){
    const config=shared("rig.config"),entry=Object.values(shared("rig.workerViews")??{}).find(e=>e.view===view
      &&(!config||e.config?.daemonMachine===config.daemonMachine&&rigOrigin(e.config?.daemonUrl)===rigOrigin(config.daemonUrl)));
    if(entry)return {following:{target:view,enabled:entry.following}};
  }
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
    return page(fileEntry(`${folder}/${file}`, `${file} · ${hit.name}`));
  } catch (e) { info(target, String(e?.message ?? e)); }
}

/** "Open mission…": the project's one mission's card; with several, the Scopes list to pick from. */
async function openMission(target) {
  const config = await configNow();
  if (!config.daemonUrl) return info(target, config.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up').");
  try {
    const r = await fetch(`${config.daemonUrl}/api/scopes?counts=1`);
    const missions = r.ok ? (await r.json())?.missions ?? [] : [];
    return page(missions.length === 1 ? { section: "scopes", mission: missions[0].mission, name: missions[0].mission } : { section: "scopes" });
  } catch (e) { info(target, String(e?.message ?? e)); }
}

export default class RigMenu extends View {
  init(_p, cx) {
    registerRigRouting(cx, context => ({ shared, setShared, run, spaces, panes, terminals, hc, layout, notify, config: this.config, wait: waitWith(context) }));
    this.config = null;
    flatOwner = this;
    this.busy = null;
    this.result = null;
    this.handle = cx.focus_handle?.() ?? null;
    this.menuIndex = -1;
    this.menuScroll = ScrollHandle.new();
    if(!props()?.step)this.handle?.focus?.();
    this.typing = false;
    const step = props()?.step;
    if(step){
      cx.bind_keys?.([{keystroke:'tab',action:'rig-dialog-next',context:'RigDialog'},{keystroke:'shift-tab',action:'rig-dialog-prev',context:'RigDialog'}]);
      this.dialogCancelHandle=cx.focus_handle?.();
      this.dialogConfirmHandle=cx.focus_handle?.();
      this.dialogArchiveHandle=cx.focus_handle?.();
      this.dialogOpenSpaceHandle=cx.focus_handle?.();
    }
    cx.spawn(async (cx) => {
      // The daemon's address as the other mods find it (config.json, a loopback address in shared state, then the CLI),
      // so Attach and Retry work without the sidebar too.
      this.config = await configNow();
      if(step?.action==="confirm-machine"||step?.action==="setup-machine"||step?.action==="stop-machine"){
        this.setupPanel=new MachineSetupPanel(this.machineSetupHost(cx),this.config,step.machine??step.confirmation?.machine,{
          mono:settings()?.font_family??"monospace",copyIcon:icon("rig-copy"),stop:step.action==="stop-machine",
          cancelHandle:this.dialogCancelHandle,primaryHandle:this.dialogConfirmHandle,
          copyHandles:Object.fromEntries(['Folder','SHA-256','Command'].map(label=>[label,cx.focus_handle?.()])),
          cancel:()=>this.dismiss(),done:(_cx,result)=>{
            if(step.token){setShared("rig.machineConfirmation",step.token);run("rig.confirm-machine");}
            this.dismiss();
          }});
        if(step.action!=="stop-machine")await this.setupPanel.check(cx);
        cx.timer.after(0,nextCx=>{(step.action==='stop-machine'?this.dialogCancelHandle:this.dialogConfirmHandle)?.focus?.();nextCx.notify();});
      }

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
      this.dialogFocusedField=this.folder;this.folder.focus();
      this.typing = true;
    }
    if (step?.action === "new-rig") this.initNewRig(cx);
    if (step?.action === "design-view") {
      this.initDesigner(complete(props().target));
      cx.timer.after(0,nextCx=>{this.dialogConfirmHandle?.focus?.();nextCx.notify();});
    }
    if (step?.action === "change-model") {
      this.initChangeModel(complete(props().target));
      cx.timer.after(0,nextCx=>{this.dialogConfirmHandle?.focus?.();nextCx.notify();});
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
      this.dialogFocusedField=this.input;this.input.focus();
      this.typing = true;
      cx.timer.after(400, () => this.input.focus());
    }
    if (step?.load === "pause") this.loadPause(cx);
    if(step&&!step.input&&!['new-rig','launch-spec','design-view','change-model','confirm-machine','setup-machine','stop-machine'].includes(step.action)){
      cx.timer.after(0,nextCx=>{
        const cancel=step.run||['pause','fresh','delete-rig','archive-rig','rebuild-space'].includes(step.action)||!['resume','move-grid','confirm-spec-write','spaces-list'].includes(step.action);
        (cancel?this.dialogCancelHandle:this.dialogConfirmHandle)?.focus?.();nextCx.notify();
      });
    }
  }

  /** New rig: from a spec in the library (`rig up`) or one seat (`rig create`); the folder is the last one launched in. */
  initNewRig(cx) {
    const drafts = shared("rig.drafts") ?? {};
    this.newMode = "spec";
    // Set by field changes, Tab navigation, field focus, mode clicks and pointer-down in the dialog.
    this.newFocusTouched=false;
    this.newRuntime = NEW_RIG_RUNTIMES[0];
    this.newSpec = null;
    this.newSpecs = null;
    this.newSpecPreviews = new Map();
    this.newExpandedSpec = null;
    this.newSpecFocus = 0;
    this.newSpecHandle = cx.focus_handle?.() ?? null;
    this.newSpecScroll=ScrollHandle.new();
    this.folder = InputState.new({ placeholder: "Working folder (an absolute path)", value: drafts["launch-folder"] ?? "" });
    this.rigName = InputState.new({ placeholder: "Rig name" });
    for (const field of [this.folder, this.rigName]) {
      field.on("focus", () => { this.typing = true; });
      field.on("blur", () => { this.typing = false; });
      field.on("change", (_e, cx) => { this.newFocusTouched=true;this.newProblem = null; cx.notify(); });
      field.on("submit", (_e, cx) => { if (!this.result?.ok && !this.busy) this.go(cx, props().target, props().step); });
    }
    cx.spawn(async (cx) => {
      const config = await configNow();
      if (!config.daemonUrl) { this.newSpecs = { error: config.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start')." }; cx.timer.after(0,nextCx=>{if(!this.newFocusTouched)this.dialogCancelHandle?.focus?.();nextCx.notify();});cx.notify(); return; }
      try {
        const r = await fetch(`${config.daemonUrl}/api/specs/library`);
        const body = await r.json();
        const list = Array.isArray(body) ? body : Array.isArray(body?.specs) ? body.specs : [];
        // Rig specs only: an agent spec isn't a `rig up` source.
        this.newSpecs = list.filter((s) => s && (s.name || s.sourcePath) && (!s.kind || s.kind === "rig"));
        this.newSpec=this.newSpecs[0]??null;
      } catch (e) { this.newSpecs = { error: String(e?.message ?? e) }; }
      cx.timer.after(0,nextCx=>{if(!this.newFocusTouched&&this.newMode==='spec')(this.newSpec?this.newSpecHandle:this.dialogCancelHandle)?.focus?.();nextCx.notify();});
      cx.notify();
    });
  }

  pickNewSpec(cx, spec, toggle = false) {
    this.newSpec = spec; this.result = null;
    this.newSpecFocus = this.newSpecs?.indexOf(spec) ?? 0;
    this.newExpandedSpec = toggle && this.newExpandedSpec === spec ? null : spec;
    if (this.newExpandedSpec) this.loadNewSpecPreview(cx, spec);
    if(this.newSpecScroll){this.cancelSpecReveal?.();this.cancelSpecReveal=revealAfterKey(cx,this.newSpecScroll,()=>this.newSpecFocus,this);}
    cx.notify();
  }

  loadNewSpecPreview(cx, spec, retry = false) {
    if (!retry && this.newSpecPreviews.has(spec)) return;
    this.newSpecPreviews.set(spec, { loading: true });
    cx.spawn(async (cx) => {
      try {
        const config = this.config ?? await configNow();
        this.newSpecPreviews.set(spec, { data: await readRigSpecPreview(fetch,config.daemonUrl,spec) });
      } catch (e) { this.newSpecPreviews.set(spec, { error: singleLineText(e?.message ?? e).slice(0, 240) }); }
      cx.notify();
    });
  }

  newSpecKey(e, cx) {
    if (e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt || !Array.isArray(this.newSpecs) || !this.newSpecs.length) return;
    const key = String(e.key ?? "").toLowerCase();
    if (!["up", "arrowup", "down", "arrowdown", "left", "arrowleft", "right", "arrowright", "enter", "return"].includes(key)) {
      const next=typeahead(this.newSpecSearch,e,this.newSpecs.map(s=>s.name??s.id??''),this.newSpecFocus);
      if(!next)return;this.newSpecSearch=next;this.newSpecFocus=next.index;
      cx.stop_propagation();this.pickNewSpec(cx,this.newSpecs[next.index]);return;
    }
    cx.stop_propagation();
    if (key === "left" || key === "arrowleft") { this.newExpandedSpec = null; cx.notify(); return; }
    const delta = key === "up" || key === "arrowup" ? -1 : key === "down" || key === "arrowdown" ? 1 : 0;
    this.newSpecFocus = Math.max(0, Math.min(this.newSpecs.length - 1, this.newSpecFocus + delta));
    this.pickNewSpec(cx, this.newSpecs[this.newSpecFocus]);
  }

  newSpecPreviewView(t, spec) {
    const got = this.newSpecPreviews?.get(spec);
    if (!got || got.loading) return div().text_size(12).text_color(t.dim).child("Reading the spec…");
    if (got.error) return v_flex().gap(4)
      .child(div().text_size(12).text_color(t.blocked).child(`Couldn't read this spec: ${got.error}`))
      .child(div().id("new-rig-spec-retry").text_size(12).text_color(t.accent).cursor_pointer()
        .on_click((_e, cx) => this.loadNewSpecPreview(cx, spec, true)).child("Retry"));
    const data = got.data;
    return v_flex().gap(4)
      .when(!!data.summary, (el) => el.child(div().truncate().text_size(11.5).text_color(t.dim).tooltip(String(data.summary??"")).child(data.summary)))
      .child(div().text_size(11.5).text_color(t.dim).child(`${data.pods.length} pod${data.pods.length === 1 ? "" : "s"} · ${data.seatCount} seat${data.seatCount === 1 ? "" : "s"}`))
      .children(data.pods.map((pod) => v_flex().gap(2).pt(3)
        .child(div().text_size(11.5).font_semibold().text_color(t.muted).child(pod.label))
        .children(pod.seats.map((seat) => h_flex().gap(6).pl(8).items_center()
          .child(div().min_w(0).truncate().text_size(12).text_color(t.foreground).tooltip(String(seat.lid??"")).child(seat.lid))
          .when(!!seat.runtime || !!seat.model, (el) => el.child(div().px(5).py(1).rounded(4).bg(t.raised).font_family("monospace").text_size(10.5).text_color(t.dim)
            .child([seat.runtime, seat.model].filter(Boolean).join(" · "))))
          .when(!!seat.profile, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(seat.profile)))))));
  }

  /** What New rig would run, and what's wrong with the fields if anything. */
  newRigArgs() {
    const folder = this.folder?.value() ?? "", name = this.rigName?.value() ?? "";
    if (this.newMode === "spec") {
      const problem = !this.newSpec ? "Pick a spec from the library." : launchSourceProblem(this.newSpec.sourcePath ?? this.newSpec.name) ?? launchFolderProblem(folder) ?? rigNameProblem(name, { optional: true });
      return { problem, args: problem ? null : newRigFromSpecArgs(this.newSpec.sourcePath ?? this.newSpec.name, folder, name) };
    }
    const problem = rigNameProblem(name) ?? launchFolderProblem(folder);
    return { problem, args: problem ? null : newRigOneSeatArgs(name, this.newRuntime, folder) };
  }

  /** The command New rig shows before it runs, with placeholders for what isn't filled in yet. */
  newRigPreview() {
    const folder = (this.folder?.value() ?? "").trim() || "<folder>";
    const name = (this.rigName?.value() ?? "").trim();
    if (this.newMode === "spec") return ["up", "--cwd", folder, ...(name ? ["--name", name] : []), "--yes", "--", this.newSpec ? (this.newSpec.sourcePath ?? this.newSpec.name) : "<spec>"];
    return ["create", "--runtime", this.newRuntime, "--cwd", folder, "--", name || "<name>"];
  }

  /** Whether the rig has seats running, so Archive pauses it first (OpenRig refuses to archive a running rig). */
  rigRunning(target) {
    return !(isRigStopped(target.lifecycle, this.rigSeats(target)) || target.lifecycle === "stopped");
  }

  /** Archive, the reversible choice beside Delete: a running rig is paused first (`rig down`), then `rig archive`. */
  archive(cx, target) {
    if (this.busy || target.rig === "kernel") return;
    const reason = capabilityDisableReason("archive-rig", this.caps());
    if (reason) { this.result = { ok: false, kind: "archive", text: reason }; cx.notify(); return; }
    const running = this.rigRunning(target);
    this.run(cx, running ? `Pausing and archiving ${target.rig}` : `Archiving ${target.rig}`, async () => {
      let paused = null;
      if (running) {
        const d = await this.write(this.argsFor(target, "pause"));
        paused = d.json && "sessionsKilled" in d.json ? pauseOutcome(d.json) : null;
        if (!d.ok && !paused?.ok) return { ok: false, kind: "archive", paused, text: `${target.rig} wasn't paused, so it wasn't archived: ${d.text || "the CLI gave no reason."}` };
      }
      const a = await this.write(this.argsFor(target, "archive-rig"));
      if (a.ok) {
        const nav = shared("rig.nav");
        if (Array.isArray(nav?.stack)) {
          const stack = nav.stack.filter(entry => entry.rig !== target.rig && !(target.rigId && entry.rigId === target.rigId) && !(entry.kind === "rig" && entry.name === target.rig));
          setShared("rig.nav", { ...nav, stack: stack.length ? stack : [{ section: "topology" }] });
        }
        run("rig.refresh");
      }
      return { ...a, kind: "archive", paused };
    });
  }

  /** Undo an archive: `rig unarchive`. */
  unarchive(cx, target) {
    const reason = capabilityDisableReason("unarchive-rig", this.caps());
    if (reason) { this.result = { ok: false, kind: "unarchive", text: reason }; cx.notify(); return; }
    this.run(cx, `Bringing ${target.rig} back`, async () => {
      const r = await this.write(this.argsFor(target, "unarchive-rig"));
      if (r.ok) { run("rig.refresh"); notify({ title: `${target.rig} restored. It's stopped; Resume it from its row.`, level: "info" }); }
      return { ...r, kind: "unarchive", text: r.ok ? `${target.rig} restored. It's stopped; Resume it from its row.` : r.text };
    }, { dismissOnSuccess: true });
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
  /** Runs a menu item. One that returns a promise (Open slice, Open mission, Attach without the sidebar) finishes before the
   *  popup closes: herdr drops a closed popup's runtime, which would cut the work off half done. */
  choose(it, cx) {
    if (it.disabled || this.pending) return;
    const r = it.act(cx);
    if (!r || typeof r.then !== "function") { this.dismiss(); return; }
    this.pending = it.label;
    cx?.notify?.();
    Promise.resolve(r).catch(() => {}).then(() => { this.pending = null; this.dismiss(); });
  }

  dismiss(discard = false) {
    this.cancelSpecPermission();
    if (discard) this.dropDraft(); else this.keepDraft();
    const id = props()?.overlay; if (id) closeOverlay(id);
  }

  /** herdr's teardown (a click beside the dialog closes it): what was typed stays for next time. */
  async close() { this.dialogBoundaryTask?.cancel?.();this.setupPanel?.focusTask?.cancel?.();this.dialogHandleTask?.cancel?.();for(const handle of this.dialogButtonHandles??[])handle.release?.();this.cancelMenuReveal?.();this.cancelSpecReveal?.();this.newSpecScroll?.release?.(); this.menuScroll?.release?.(); this.cancelSpecPermission(); this.keepDraft(); }

  cancelSpecPermission() {
    const step=props()?.step;
    if(step?.action==="spaces-list"&&step.token){
      const decided=shared("rig.spacesListDecisions")??{};
      if(!decided[step.token])setShared("rig.spacesListDecisions",{...decided,[step.token]:"cancel"});
      return;
    }
    if(step?.action!=="confirm-spec-write"||!step.token)return;
    const decisions=shared("rig.specWriteDecisions")??{};
    if(!decisions[step.token])setShared("rig.specWriteDecisions",{...decisions,[step.token]:"cancel"});
  }

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
  async write(args, options, cx) {
    if (!args) return { ok: false, text: ACTION_REFUSED };
    // The connection is the target's own, from the row it came from: never a default. Without one nothing is sent.
    const conn = targetConnection(this.config, props()?.target);
    if (!conn.ok) return { ok: false, text: conn.reason };
    const target=props()?.target;
    if(target?.kind==='assistant'){
      if(args[0]!=='queue'||args[1]!=='create'||args[args.indexOf('--destination')+1]!==target.session)return{ok:false,text:'Connected assistants only accept queued work.'};
      const verified=await verifyAssistantTarget(fetch,conn.config,target,cx?.timer?(ms,done)=>cx.timer.after(ms,done):null);if(!verified.ok)return{ok:false,text:verified.reason};
    }
    const cmd = writeCommand(conn.config, args, options);
    if (!cmd) return { ok: false, text: NO_PERSON };
    return writeOutcome(await exec(cmd.command, cmd.args, { timeout: 180000 }));
  }

  async read(args) {
    // Pin this machine on Retry's `ps` re-read so a saved remote `host.selected` never queries another host.
    const conn = targetConnection(this.config, props()?.target);
    if (!conn.ok) return null;
    const cmd = readCommand(conn.config, [...args, "--json"], { env: ["OPENRIG_HOST_SELECTED=local"] });
    const r = await exec(cmd.command, cmd.args, { timeout: 60000 });
    try { return JSON.parse(r.stdout); } catch (_) { return null; }
  }

  run(cx, label, work, { dismissOnSuccess = false } = {}) {
    this.busy = label; this.result = null; cx.notify();
    cx.spawn(async (cx) => {
      try { this.result = await work(); } catch (e) { this.result = { ok: false, text: String(e?.message ?? e) }; }
      // Sent: the draft is done with. Not sent: it stays, for a retry from the menu.
      if (this.result?.ok) this.dropDraft();
      this.busy = null;
      if (dismissOnSuccess && this.result?.ok) { this.dismiss(); return; }
      cx.notify();
      if(this.dialogCancelHandle)cx.timer.after(0,nextCx=>{
        const openSpace=props()?.step?.action==='new-rig'&&this.result?.ok&&typeof this.result?.createdRig==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(this.result.createdRig);
        (openSpace?this.dialogOpenSpaceHandle:this.dialogCancelHandle)?.focus?.();nextCx.notify();
      });
    });
  }

  async loadPause(cx) {
    cx.spawn(async (cx) => {
      const t = complete(props().target);
      // The confirmation shows the target's own daemon's seats (the write goes there too), never the default one's.
      const conn = targetConnection(this.config ?? await configNow(), t);
      if (!conn.ok) { this.pause = { error: conn.reason }; cx.notify(); return; }
      const config = conn.config;
      if (!config.daemonUrl) { this.pause = { error: config.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up')." }; cx.notify(); return; }
      try {
        const r = await fetch(`${config.daemonUrl}/api/rigs/${encodeURIComponent(t.rigId)}/nodes`);
        this.pause = pauseSummary(await r.json());
      } catch (e) { this.pause = { error: String(e?.message ?? e) }; }
      cx.notify();
    });
  }

  caps() { return currentCapabilities(this.config?.capabilities ?? shared, terminals?.() ?? [], shared("rig.capabilities")); }

  /** The actions offered for a target. Each has a vector icon (no font-dependent glyphs). */
  items(target) {
    const out = [];
    const caps = this.caps();
    const item = (iconName, label, act, actionName = null, dynamicLabel = false) => {
      const capReason = actionName ? capabilityDisableReason(actionName, caps) : null;
      const pReason = actionName && this.config ? personDisableReason(actionName === "reply-answer" ? "reply" : actionName, this.config) : null;
      const reason = capReason ?? pReason;
      out.push({ icon: iconName, label, act, disabled: !!reason, reason, dynamicLabel });
    };
    if(target.kind==='assistant'){
      if(!assistantAddress(target.session)||!targetConnection(this.config,target).ok)return out;
      item('rig-queue','Queue work…',()=>dialog(target,{input:true,placeholder:'One-line summary; the body follows on the next lines',action:'queue',multiLine:true},300),'queue');
      item('rig-copy','Copy address',cx=>{if(assistantAddress(target.session)&&targetConnection(this.config,target).ok)cx.write_to_clipboard(target.session);});
      item('rig-card','Open rig page',()=>page({section:'topology',kind:'rig',conn:target.conn,rigId:target.rigId,name:target.rig}));
      return out;
    }
    if(target.kind==="sidebar-header"){
      const enabled=(shared("rig.settings")?.notifications??true)!==false;
      item("rig-bell",enabled?"Turn notifications off":"Turn notifications on",()=>{
        setShared("rig.settings",{...(shared("rig.settings")??{}),notifications:!enabled});
      });
      item("rig-bell","Notification settings",()=>page({section:"system",subview:"notifications"}));
      item("rig-popout","Open the Rig page",()=>run("rig.open-page"));
      item("rig-terminal-prompt","Open the TUI",()=>run("rig.open-tui"));
      item("rig-refresh","Refresh",()=>run("rig.refresh"));
      return out;
    }
    if (target.kind === "rig" && target.archived) {
      item("rig-play", "Restore rig", () => oneClick(target, "unarchive-rig"), "unarchive-rig");
      item("rig-trash", "Delete rig…", () => dialog(target, { action: "delete-rig", load: "pause" }, 540), "delete-rig");
      return out;
    }
    if (target.kind === "seat" || target.kind === "cell") {
      const stoppedSeat = isStopped(target);
      if(target.allSeats){
        item('rig-card','Open rig page',()=>page({section:'topology',kind:'rig',rigId:target.rigId,conn:target.conn,name:target.rig}));
        if(target.session)item('rig-copy','Copy session name',cx=>cx.write_to_clipboard(target.session));
      }
      // The row's own actions first: ⋯, the right-click and the Menu key open this same list.
      // A terminal seat is a person's shell, not an agent: no message, work or model to give it.
      if (!(target.terminal === true || isTerminalSeat(target))) {
        item("rig-send", "Send message…", () => dialog(target, { input: true, placeholder: `Message to ${target.session}`, action: "send", multiLine: true }), "send");
        item("rig-queue", "Queue work…", () => dialog(target, { input: true, placeholder: "One-line summary; the body follows on the next lines", action: "queue", multiLine: true }, 300), "queue");
        item("rig-swap", "Change model / harness…", () => openOverlay({ mod: MOD_IDS.menu, kind: "dialog", modal: true, width: 520, height: 420, props: { target, step: { action: "change-model" } } }), "change-model");
      }
      item("rig-seat", "Open seat page", () => page({ section: "topology", kind: "seat", rig: target.rig, rigId: target.rigId, conn: target.conn, name: target.logicalId, session: target.session }));
      if (target.session&&!target.allSeats) item("rig-copy", "Copy session address", (cx) => cx.write_to_clipboard(target.session));
      out.push({
        icon: "terminal",
        label: "Attach",
        // The sidebar outlives this popup and has the config: hand it Attach (rig.attach), so closing the popup can't
        // cut it short. Without the sidebar, Attach runs here with the config and this folder's relay, and finishes
        // before the popup closes; a refusal says why. It runs as a task: the click's cx goes stale at the first await,
        // and the wait for herdr to adopt the tab needs a cx that doesn't.
        act: (cx) => {
          const config = this.config;
          const attach = (wait) => attachToSeat({ exec, run, hc, spaces, panes, terminals, layout, shared, setShared, notify, wait, relayPath: attachRelayPath(appHome(), MOD_IDS.menu) }, target, config)
            .then((res) => { if (res && res.ok === false && res.reason) notify({ title: `Attach ${target.logicalId ?? target.session}`, body: res.reason, level: "warning" }); return res; });
          if (typeof cx?.spawn !== "function") return attach(undefined);
          return new Promise((resolve) => { cx.spawn(async (cx) => { resolve(await attach(waitWith(cx)).catch(() => null)); }); });
        },
        disabled: stoppedSeat,
        reason: stoppedSeat ? "Stopped: seat has no running session to attach" : null,
      });
      if(target.allSeats&&target.compactActions){const index=out.findIndex(item=>item.label==='Attach');if(index>=0)out.unshift(...out.splice(index,1));}
      // Focusing a pane the seat already has needs nothing from OpenRig; with none, Focus pane opens a view, which needs
      // OpenRig's herdr provider ("open-seat"), as on the seat page.
      const live = seatClickTarget(viewsPropsFromLayout(layout(), shared), null, target.session, panes?.() ?? [], terminals?.() ?? []);
      item("rig-target", "Focus pane", () => {
        const hit = seatClickTarget(viewsPropsFromLayout(layout(), shared), null, target.session, panes?.() ?? [], terminals?.() ?? []);
        if (hit.kind === "focus") {
          if (hit.stack && hit.child) run("layout.select", { stack: hit.stack, child: hit.child });
          if (hit.tab) run("tab.select", { id: hit.tab });
          if (hit.pane) run("pane.focus", { id: hit.pane });
          else if (hit.terminal) run("pane.focus", { terminal: hit.terminal });
          return;
        }
        // A pane in another worker view: select that view's tab, then the seat's pane.
        if (hit.kind === "select-then-focus") {
          if (hit.tab) run("tab.select", { id: hit.tab });
          run("pane.focus", { terminal: hit.terminal });
          return;
        }
        oneClick(target, "open-seat");
      }, live.kind === "focus" || live.kind === "select-then-focus" ? null : "open-seat");
      item("rig-view", "Open terminal", () => oneClick(target, "open-seat"), "open-seat");
      if (target.kind === "seat" && live.kind !== "card") item("rig-keyboard", "Take keyboard", () => oneClick({ ...target, kind: "cell", terminal: live.terminal }, "keyboard"));
      item("rig-target", "Open slice", () => openSlice(target));
      // Files open in the Files-look-alike viewer.
      item("file-text", "Open slice SPEC.md", () => openSlice(target, "SPEC.md"));
      const transcript = transcriptPath(this.config, target.rig, target.session);
      if (transcript) item("file-text", "Open transcript", () => page(fileEntry(transcript, `Transcript · ${target.logicalId ?? target.session}`)));
      if (target.kind === "cell") item("rig-keyboard", "Take keyboard", () => oneClick(target, "keyboard"));
      else item("rig-view", "Show in worker view", () => oneClick(target, "open-seat"), "open-seat");
      // A native seat's `hc run` children: peek at one over the tab, herdr's own way.
      const children = Array.isArray(target.children) ? target.children : [];
      if (children.length) out.push({ divider: "Helpers (hc run)" });
      for (const child of children) item("rig-helper", `Peek ${child.label}`, () => run("terminal.peek", { terminal: child.address }), null, true);
    }
    if (target.kind === "pod") {
      item("rig-card", "Show pod card", () => page({ section: "topology", kind: "pod", rig: target.rig, rigId: target.rigId, conn: target.conn, pod: target.pod, name: target.pod }));
    }
    if (target.kind === "rigspace") {
      // herdrig's Spaces list: herdr's own two actions for any space first (herdr's own commands, with herdr's own confirmation for
      // Close), then the rig's actions with the same verbs and confirmations as the Rig block's menu.
      item("square-pen", "Rename", () => run("space.rename", { id: target.space }));
      item("x", "Close", () => run("space.close", { id: target.space }));
      out.push({ divider: "" }); // the popup header already names the rig
      const rigTarget = { kind: "rig", rig: target.rig, rigId: target.rigId, conn: target.conn, name: target.rig,
        lifecycle: (shared("rig.data")?.topology ?? []).find((r) => (target.rigId && r.id === target.rigId) || r.name === target.rig)?.lifecycle ?? null };
      item("rig-popout", "Open Rig page", () => page(target.home ? { section: "topology" } : { section: "topology", kind: "rig", rig: target.rig, rigId: target.rigId, conn: target.conn, name: target.rig }));
      item("rig-operator", "Attach operator", () => run("rig.operator"));
      if (!target.home && target.rig) {
        item("rig-snapshot", "Snapshot now", () => oneClick(rigTarget, "snapshot"));
        const stoppedRig = isRigStopped(rigTarget.lifecycle, this.rigSeats(rigTarget));
        if (!stoppedRig && rigTarget.lifecycle !== "stopped") item("rig-pause", "Pause rig…", () => dialog(rigTarget, { action: "pause", load: "pause" }, 360));
        if (stoppedRig || rigTarget.lifecycle !== "running") item("rig-play", "Resume rig…", () => dialog(rigTarget, { action: "resume", confirm: true }, 380));
      }
    }
    if (target.kind === "rig" || target.kind === "pod" || target.kind === "seat") {
      // The popup's header already names a rig target; a seat's or a pod's rig actions get their own label.
      out.push({ divider: target.kind === "seat" || target.kind === "pod" ? `Rig ${target.rig}` : "" });
      if (target.rigId) item("rig-copy", "Copy rig id", (cx) => cx.write_to_clipboard(target.rigId));
      item("rig-view", "Open rig space", () => run(`rig.space:${target.rigId ?? target.rig}`));
      if(rigSpaceRelocation({spaces,panes,terminals},{id:target.rigId,name:target.rig},this.config))
        item("rig-view",`Move rig space to ${this.config.daemonMachine}…`,()=>run(`rig.space:${target.rigId??target.rig}`),null,true);
      item("rig-view", "New worker view", () => oneClick({ ...target, view: `rig:${target.rig}` }, "open-view"), "open-view");
      item("rig-view", "Design worker view…", () => openDesigner(target), "design-view");
      // One Following view per rig in this window; the toggle turns its following on or off.
      const followed = followingFor(`rig:${target.rig}`);
      const on = !!followed?.following?.enabled;
      const followReason = capabilityDisableReason(on ? "unfollow" : "follow", caps);
      out.push({ icon: on ? "check" : "rig-follow", label: "Follow active workers", act: () => oneClick({ ...target, view: `rig:${target.rig}` }, on ? "unfollow" : "follow"), disabled: !!followReason, reason: followReason });
      item("rig-snapshot", "Snapshot now", () => oneClick(target, "snapshot"));
      item("rig-target", "Open mission…", () => openMission(target));
      out.push({ divider: "" });
      // Resume when paused, Pause when not; with the state unknown or mixed, both.
      const stoppedRig = isRigStopped(target.lifecycle, this.rigSeats(target));
      if (!stoppedRig && target.lifecycle !== "stopped") item("rig-pause", "Pause rig…", () => dialog(target, { action: "pause", load: "pause" }, 360));
      if (stoppedRig || target.lifecycle !== "running") item("rig-play", "Resume rig…", () => dialog(target, { action: "resume", confirm: true }, 380));
      // Delete, with Archive beside it as the reversible choice. Never for the kernel: it's the daemon's own rig.
      if (target.rig !== "kernel" && !target.archived) item("rig-archive", "Archive rig…", () => dialog(target, { action: "archive-rig", load: "pause" }, 320), "archive-rig");
      if (target.rig !== "kernel") item("rig-trash", "Delete rig…", () => dialog(target, { action: "delete-rig", load: "pause" }, 540), "delete-rig");
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
      item("rig-follow", "Follow this slice", () => oneClick({ kind: "follow-target", conn: target.conn, view: `slice:${target.id ?? target.slice}`, name: target.name }, "follow"), "follow");
    }
    if (target.kind === "strip-view") {
      // A worker view's strip pill: close it, follow its rig's active workers, or reach the rig.
      item("rig-view", "Edit layout…", () => openDesigner(this.editTarget(target)), "design-view");
      item("x", "Close view", () => oneClick(target, "close-view"), "close-view");
      if (target.rig) item("rig-follow", "Follow active workers", () => oneClick({ ...target, view: `rig:${target.rig}` }, "follow"), "follow");
      this.viewExtras(target.rig, item, target.conn);
    }
    if (target.kind === "following") {
      // A following view's strip menu: stop or resume, the TTL, close. Closing ends only its viewers.
      const view = { ...target, view: target.target };
      const followReason = capabilityDisableReason(target.enabled ? "unfollow" : "follow", caps);
      out.push(target.enabled
        ? { icon: "rig-pause", label: "Stop following", act: () => oneClick(view, "unfollow"), disabled: !!followReason, reason: followReason }
        : { icon: "rig-play", label: "Resume following", act: () => oneClick(view, "follow"), disabled: !!followReason, reason: followReason });
      const preset = PRUNE_PRESETS.some(([, ms]) => ms === target.pruneAfterMs);
      out.push({ divider: caps.hostWorkerViews?"herdrig prune idle tiles after":preset || target.pruneAfterMs === undefined ? "Prune idle tiles after" : `Prune idle tiles after (now ${ttlWords(target.pruneAfterMs)})` });
      const pruneReason = capabilityDisableReason("prune", caps);
      for (const [label, ms] of PRUNE_PRESETS) {
        out.push({ icon: target.pruneAfterMs === ms ? "check" : null, label, act: () => oneClick({ ...view, prune: label }, "prune"), disabled: !!pruneReason, reason: pruneReason });
      }
      out.push({ divider: "" });
      item("rig-view", "Edit layout…", () => openDesigner(this.editTarget(target)), "design-view");
      this.viewExtras(String(target.target ?? "").startsWith("rig:") ? target.target.slice(4) : null, item, target.conn);
      item("x", "Close view", () => oneClick(target, "close-view"), "close-view");
    }
    if (target.kind === "views") {
      for (const v of target.views ?? []) item("rig-view", v.name, () => selectWorkerView(v.id, { run, layout, views: target.views ?? [], spaces, panes }), null, true);
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
        oneClick({ kind: "open-view", conn: target.conn, view: `rig:${target.rig}`, rig: target.rig, grid: nextGrid, replace: target.viewId }, "open-designed-view");
      }, "cell-split", true);
      out.push({ divider: "" });
      const stripView = viewInStrip(target.viewId);
      const following = Boolean(target.following || stripView?.following?.enabled || stripView?.following);
      item("rig-view", "Design worker view…", () => openDesigner({ ...target, kind: "strip-view", name: target.name, replace: target.viewId, following, focusCell: target.cellId || target.seat }), "design-view");
    }
    if (target.kind === "need") {
      if (dismissible(target)) item("check", target.dismissed ? "Restore update" : "Dismiss update", () =>
        requestDismissal({ shared, setShared, run, scope: this.config ? dismissalScope(this.config) : undefined }, target.dismissed ? "restore" : "dismiss", target.dismissed ? updateKey(target) : target));
      // A native seat closed outside OpenRig. Offered, never done on its own.
      if (target.native) {
        item("rig-refresh", "Relaunch fresh…", () => dialog({ ...target, reason: "native seat closed outside OpenRig" }, { action: "fresh", confirm: true }, 220));
        item("rig-play", "Resume…", () => dialog({ kind: "rig", rig: target.rig, conn: target.conn }, { action: "resume", confirm: true }, 380));
      }
      if (target.reply !== "none") item("rig-reply", "Reply…", () => dialog(target, { input: true, placeholder: "Your answer, in your own words", action: "reply", multiLine: true }, 290), target.reply === "answer" ? "reply-answer" : "reply");
      item("rig-card", "Open this item", () => page({ section: "needs", id: target.id, name: target.summary }));
    }
    if (target.kind === "updates-group") item("check", "Dismiss all updates", () =>
      requestDismissal({ shared, setShared, run, scope: this.config ? dismissalScope(this.config) : undefined }, "dismiss", target.items ?? []));
    if (target.kind === "open-view") item("rig-view", `Open ${target.view}`, () => oneClick(target, "open-view"), "open-view", true);
    // Sidebar rows that are places: each opens its page; a saved or rig view also opens in herdr.
    if (target.kind === "branch") {
      item("rig-popout", `Open ${target.name} in the Rig page`, () => page({ section: target.section }), null, true);
      if(target.section==='topology')item('rig-seat','All seats',()=>page({section:'topology',topologyTab:'seats'}));
    }
    if (target.kind === "host") item("rig-card", "Show host card", () => page({ section: "topology", kind: "host", hostId: target.hostId, name: target.name }));
    if (target.kind === "mission") item("rig-card", "Show mission card", () => page({ section: "scopes", mission: target.mission, name: target.name }));
    if(target.kind==='workflow'){
      item('rig-copy','Copy instance id',cx=>cx.write_to_clipboard(String(target.id??'')));
      if(target.ownerEntry)item('rig-seat',"Open owner's seat",()=>page(target.ownerEntry));
    }
    if (target.kind === "specs-group") item("rig-popout", `Open ${target.name} specs in the Rig page`, () => page({ section: "specs", kindFilter: target.specKind, name: target.name }), null, true);
    if (target.kind === "system-config") item("rig-popout", "Open Configuration", () => page({ section: "system", subview: "config", name: "Configuration" }));
    if (target.kind === "system" && target.entry) item("rig-popout", `Open ${target.name}`, () => page(target.entry), null, true);
    if (target.kind === "saved-view" || target.kind === "terminal") {
      item("rig-card", "Show view", () => page({ section: "terminals", view: target.view, name: target.name }));
      item("rig-view", "Open in herdr", () => oneClick({ kind: "open-view", conn: target.conn, view: target.view, rig: target.rig }, "open-view"), "open-view");
    }
    // A group's order can live under several keys (Specs: one per namespace): Reset clears every one that has an order.
    if (target.reorder) {
      const row = target.reorder, index = row.siblingIds?.indexOf(row.itemId) ?? -1;
      for (const [label, direction] of [["Move up", -1], ["Move down", 1]]) {
        item(direction < 0 ? "rig-arrow-open-up" : "rig-arrow-open-down", label, () => run(`rig.move-row:${direction}:${encodeURIComponent(row.key)}`));
        const unavailable = index < 0 || index + direction < 0 || index + direction >= (row.siblingIds?.length ?? 0);
        if (unavailable) Object.assign(out.at(-1), { disabled: true, reason: direction < 0 ? "Already first in this group" : "Already last in this group" });
      }
    }
    const orderKeys = target.orderGroupKeys ?? (target.orderGroupKey ? [target.orderGroupKey] : []);
    const ordered = orderKeys.filter((k) => { const o = (shared("rig.order") ?? {})[k]; return Array.isArray(o) && o.length > 0; });
    if (orderKeys.length && (target.hasCustomOrder || ordered.length)) {
      if (out.length > 0) out.push({ divider: "" });
      item("rig-refresh", "Reset order", () => {
        let next = shared("rig.order") ?? {};
        for (const k of target.hasCustomOrder ? orderKeys : ordered) next = resetGroupOrder(next, k);
        setShared("rig.order", next);
        for (const k of target.hasCustomOrder ? orderKeys : ordered) run(`rig.reset-order:${k}`);
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
  viewExtras(rig, item, conn) {
    item("terminal", "Open or switch to the Rig TUI", () => run("rig.tui"));
    if (rig) item("rig-snapshot", "Snapshot now", () => oneClick({ kind: "rig", rig, conn }, "snapshot"));
  }

  /** The CLI behind each action (rig-lib actionArgs, shared with the sidebar's one-click runs). */
  argsFor(target, action, text) { return actionArgs(target, action, text, appHome()); }

  // ---- views --------------------------------------------------------------------------------------------------------
  dialogTab(e,cx){
    if(String(e.key).toLowerCase()!=='tab'||e.modifiers?.control||e.modifiers?.platform||e.modifiers?.alt)return false;
    cx.stop_propagation();
    if(this.newMode!==undefined)this.newFocusTouched=true;
    const first=this.dialogFirstControl,last=this.dialogLastControl;
    const boundary=e.modifiers?.shift&&first?.is_focused?.()?last:!e.modifiers?.shift&&last?.is_focused?.()?first:null;
    if(boundary){
      this.dialogBoundaryTask?.cancel?.();
      this.dialogBoundaryTask=cx.timer.after(16,nextCx=>{boundary.focus();nextCx.notify();});
    }else if(e.modifiers?.shift)globalThis.window.focus_prev();else globalThis.window.focus_next();
    return true;
  }
  dialogField(state,Widget){
    this.dialogObservedFields??=new Set();
    if(!this.dialogObservedFields.has(state)){
      this.dialogObservedFields.add(state);
      state.on('focus',()=>{this.typing=true;this.dialogFocusedField=state;if(this.newMode!==undefined)this.newFocusTouched=true;});
      state.on('blur',()=>{this.typing=false;if(this.dialogFocusedField===state)this.dialogFocusedField=null;});
    }
    this.dialogFirstControl??={focus:()=>state.focus(),is_focused:()=>this.dialogFocusedField===state};
    return Widget.new(state);
  }
  dialogButton(t,element,handle,act,disabled=false,content){
    const index=this.dialogButtonIndex++;
    if(!handle&&this.dialogRenderCx){
      this.dialogButtonHandles??=[];
      handle=this.dialogButtonHandles[index];
      if(!handle){
        this.dialogHandleCount=Math.max(this.dialogHandleCount??0,index+1);
        // Handles are retained on the view and created after render, as the SDK requires.
        if(!this.dialogHandleTask)this.dialogHandleTask=this.dialogRenderCx.timer.after(0,nextCx=>{
          while(this.dialogButtonHandles.length<this.dialogHandleCount)this.dialogButtonHandles.push(nextCx.focus_handle());
          this.dialogHandleTask=null;nextCx.notify();
        });
      }
    }
    if(!disabled&&!this.dialogFirstControl)this.dialogFirstControl=handle;
    if(!disabled&&handle)this.dialogLastControl=handle;
    const key=(event,cx)=>{
        if(this.dialogTab(event,cx))return;
        if(disabled||event.modifiers?.control||event.modifiers?.platform||event.modifiers?.alt)return;
        if(!['enter','return','space',' '].includes(String(event.key).toLowerCase()))return;
        cx.stop_propagation();act(event,cx);
      };
    return div().id(`dialog-focus-${index}`).p(2).border(2).border_color('#00000000').rounded(8).flex_none()
      .when(!!handle,el=>el.track_focus(handle)).tab_stop(!disabled)
      .focus(el=>el.border_color(t.accent)).on_key_down(key)
      .child(element.on_click((event,cx)=>{if(!disabled)act(event,cx);}).on_key_down(key).when(content!==undefined,el=>el.child(content)));
  }

  menuKey(e,cx,items) {
    if(e.key==='escape'){cx.stop_propagation();this.dismiss();return;}
    const indices=items.flatMap((item,i)=>item.divider===undefined?[i]:[]);
    if(!indices.length)return;
    const at=Math.max(0,indices.indexOf(this.menuIndex??indices[0]));
    if(e.key==='down'||e.key==='up')this.menuIndex=indices[(at+(e.key==='down'?1:-1)+indices.length)%indices.length];
    else if(e.key==='home')this.menuIndex=indices[0];
    else if(e.key==='end')this.menuIndex=indices.at(-1);
    else if(e.key==='enter')this.choose(items[indices[at]],cx);
    else {
      const next=typeahead(this.menuSearch,e,indices.map(i=>items[i].label),at);
      if(!next)return;
      this.menuSearch=next;this.menuIndex=indices[next.index];
    }
    this.menuRevealed=null;
    this.cancelMenuReveal?.();
    if(e.key!=='enter')this.cancelMenuReveal=revealAfterKey(cx,this.menuScroll,()=>this.menuIndex,this);
    cx.stop_propagation();cx.notify();
  }

  popup(t, target) {
    if (target.kind === "page-navigation") return v_flex().id("page-navigation-menu").size_full().p(4).bg(t.raised).border_1().border_color(t.border).rounded(8)
      .when(!!this.handle,el=>el.track_focus(this.handle))
      .on_key_down((e,cx)=>{const choices=target.choices??[];if(!choices.length)return;
        if(e.key==="down"||e.key==="up"){this.navChoiceIndex=((this.navChoiceIndex??0)+(e.key==="down"?1:-1)+choices.length)%choices.length;cx.stop_propagation();cx.notify();}
        else if(e.key==="enter"){cx.stop_propagation();page(choices[this.navChoiceIndex??0].entry);this.dismiss();}
        else if(e.key==="escape"){cx.stop_propagation();this.dismiss();}})
      .children((target.choices ?? []).map((choice,i) => h_flex().id(`page-navigation-${i}`).tab_stop(true).px(8).h(30).gap(12).items_center().rounded(5).cursor_pointer()
        .when(i===(this.navChoiceIndex??0),el=>el.bg(t.selection??t.hover)).hover(el => el.bg(t.hover))
        .on_click(() => { page(choice.entry); this.dismiss(); })
        .on_key_down((e,cx)=>{if(e.key==="enter"){cx.stop_propagation();page(choice.entry);this.dismiss();}})
        .child(div().flex_1().text_size(12.5).text_color(t.foreground).child(choice.label))
        .when(choice.count !== null && choice.count !== undefined, el => el.child(div().text_size(11.5).text_color(t.dim).child(String(choice.count))))));
    if (this.pending) return v_flex().id("rig-menu").size_full().p(4).bg(t.raised).border(1).border_color(t.border).rounded(8).text_size(12.5)
      .child(div().id("rig-menu-pending").px(8).py(6).text_color(t.muted).child(`${this.pending}…`));
    const items = this.items(target);
    if(!items[this.menuIndex]?.act){
      this.menuIndex=items.findIndex(it=>it.act&&!it.disabled);
      if(this.menuIndex<0)this.menuIndex=items.findIndex(it=>it.divider===undefined);
    }
    if(this.menuIndex>=0&&this.menuRevealed!==this.menuIndex){this.menuScroll?.scroll_to_item(this.menuIndex);this.menuRevealed=this.menuIndex;}
    const selectedReason=items[this.menuIndex]?.reason;
    const rawReasons=[...new Set(items.map(it=>it.reason).filter(reason=>reason&&reason!==selectedReason))];
    const workerReasons=rawReasons.filter(r=>workerCapabilityText(r)!==r);
    const reasons=rawReasons.filter(r=>!workerReasons.includes(r));
    if(workerReasons.length)reasons.push(workerReasons.join('\n'));
    return v_flex().id("rig-menu").size_full().min_h(0).p(4).bg(t.raised).border(1).border_color(t.border).rounded(8).text_size(12.5)
      .when(!!this.handle,el=>el.track_focus(this.handle))
      .on_key_down((e,cx)=>this.menuKey(e,cx,items))
      .child(div().flex_none().px(8).py(4).text_size(11).text_color(t.dim).child(target.kind === "seat" || target.kind === "cell" ? `Seat ${target.logicalId ?? target.session} · ${target.rig}`
        : target.kind === "sidebar-row" ? `${(target.rowKind ?? "row").replace(/^./, c => c.toUpperCase())} ${target.name ?? ""}`
        : target.kind === "need" ? (target.summary ?? "Needs you") : target.kind === "tui" ? "Rig TUI" : target.kind === "spec" ? `Spec ${target.name}`
        : target.kind === "slice" ? `Slice ${target.name}` : target.kind === "strip-view" || target.kind === "following" ? `View ${target.name ?? target.viewId}`
        : target.kind === "cell-split" ? `Split ${target.logicalId ?? target.seat}` : target.kind === "pod" ? `Pod ${target.pod} · ${target.rig}`
        : target.kind === "host" ? `Host ${target.name}` : target.kind === "mission" ? `Mission ${target.name}` : target.kind === "branch" ? target.name
        : target.kind === "specs-group" ? `${target.name} specs` : target.kind === "system-config" || target.kind === "system" ? target.name
        : target.kind === 'assistant' ? `Connected assistant ${target.logicalId ?? target.name}`
        : target.kind === "saved-view" || target.kind === "terminal" ? `View ${target.name ?? target.view}` : `Rig ${target.rig ?? ""}`))
      .child(v_flex().id('rig-action-list').min_h(0).h(Math.min(260,items.length*26+reasons.length*40)).overflow_y_scrollbar().track_scroll(this.menuScroll)
        .on_size_change((_size,cx)=>{if(this.menuIndex>=0)this.menuScroll?.scroll_to_item(this.menuIndex);cx.notify();})
      .children(items.map((it, i) => it.divider !== undefined
        ? v_flex().child(div().h(1).bg(t.border).my(3)).when(!!it.divider, (el) => el.child(div().px(8).py(2).text_size(11).text_color(t.dim).child(it.divider)))
        : h_flex().id(`rig-menu-${i}`).flex_none().px(8).h(26).gap(8).rounded(5).items_center().text_color(it.disabled ? t.dim : t.foreground)
          .when(i===this.menuIndex,el=>el.bg(t.selection??t.hover)).hover(s=>s.bg(t.hover))
          .on_mouse_move((_e,cx)=>{if(this.menuIndex!==i){this.menuIndex=i;cx.notify();}})
          .when(!!it.reason, (el) => el.tooltip(it.reason))
          .on_click((_e, cx) => this.choose(it, cx))
          .child(it.icon ? svg(icon(it.icon)).size(13).flex_none().text_color(it.disabled ? t.dim : t.muted) : div().w(13).flex_none())
          .child(div().flex_1().truncate().when(!!(it.dynamicLabel || it.reason), el=>el.tooltip([String(it.label ?? ""), it.reason].filter(Boolean).join("\n"))).child(it.label))))
        .when(reasons.length>0,el=>el.child(v_flex().id('rig-menu-reasons').flex_none().px(8).py(4).gap(2).children(reasons.map((r,i)=>div().id(`rig-menu-reason-${i}`).text_size(11).text_color(t.dim).tooltip(r).child(workerCapabilityText(r,this.caps())))))))
      .when(!!selectedReason,el=>el.child(div().id('rig-menu-selected-reason').flex_none().border_t(1).border_color(t.border).px(8).py(4).text_size(11).text_color(t.dim).child(workerCapabilityText(selectedReason,this.caps()))));
  }

  resultView(t, cx, target, step) {
    const r = this.result;
    if (this.busy) return div().text_size(12.5).text_color(t.muted).child(`${this.busy}…`);
    if (!r) return null;
    if (step.action === "new-rig" && r.ok) return div().text_size(12.5).child(r.text);
    if (step.action === "delete-rig" && r.kind === "delete" && r.json && "sessionsKilled" in r.json) {
      const out = deleteOutcome(r.json, target.rig);
      return v_flex().id("delete-result").gap(4)
        .child(div().text_size(13).font_semibold().text_color(out.ok ? t.foreground : t.blocked).child(out.headline))
        .children(out.notes.map((note) => div().text_size(11.5).text_color(note.startsWith("Error") ? t.blocked : t.dim).child(note)));
    }
    if ((step.action === "delete-rig" || step.action === "archive-rig") && r.kind === "archive") {
      const paused = r.paused;
      return v_flex().id("archive-result").gap(4)
        .child(div().text_size(13).font_semibold().text_color(r.ok ? t.foreground : t.blocked).child(r.ok ? `Archived ${target.rig}` : `${target.rig} wasn't archived`))
        .when(!!paused, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(paused.headline))
          .children(paused.notes.map((note) => div().text_size(11.5).text_color(note.startsWith("Error") ? t.blocked : t.dim).child(note))))
        .child(div().text_size(11.5).text_color(r.ok ? t.dim : t.blocked).child(r.ok
          ? `${target.rig} archived. Restore it any time from Topology → Archived.`
          : r.text || "It didn't work, and the CLI gave no reason."))
        .when(r.ok, (el) => el.child(h_flex().child(this.dialogButton(t,div().id("rig-unarchive").px(10).h(24).rounded(6).bg(t.raised).flex().items_center().hover((s) => s.bg(t.hover)),null,
          () => { oneClick(target, "unarchive-rig"); this.dismiss(); },false,"Undo"))));
    }
    // A teardown result (even with a non-zero exit, as for a rig already stopped) reads as what it says.
    if (step.action === "pause" && r.json && "sessionsKilled" in r.json) {
      const out = pauseOutcome(r.json);
      return v_flex().gap(4)
        .child(div().text_size(13).font_semibold().text_color(out.ok ? t.foreground : t.blocked).child(out.headline))
        .children(out.notes.map((note) => div().text_size(11.5).text_color(note.startsWith("Error") ? t.blocked : t.dim).child(note)));
    }
    if (step.action === "resume" && r.json) {
      const out = resumeOutcome(r.json, r.ok);
      const headline = out.ok ? `Resumed ${target.rig}` : out.partial ? `Resumed ${target.rig} · partially` : `${target.rig} wasn't resumed`;
      return v_flex().gap(6)
        .child(div().text_size(13).font_semibold().child(headline))
        .when(!!out.error, (el) => el.child(div().text_color(t.blocked).child(String(out.error?.fact ?? out.error?.message ?? out.error))))
        .children(out.seats.map((s, i) => v_flex().gap(1)
          .child(h_flex().gap(8).items_center()
            .child(svg(icon(s.ok ? "check" : s.needsFresh ? "rig-alert" : "x")).size(13).flex_none().text_color(s.ok ? t.working : t.blocked))
            .child(div().w(120).truncate().tooltip(String(s.logicalId??"")).child(s.logicalId))
            .child(div().flex_1().truncate().text_color(t.muted).tooltip(String(s.label??"")).child(s.label))
            .when(s.needsFresh, (el) => el.child(this.dialogButton(t,div().id(`fresh-${i}`).px(8).h(22).rounded(5).bg(t.raised).flex().items_center().hover((x) => x.bg(t.hover)),null,
              () => dialog({ ...target, logicalId: s.logicalId }, { action: "fresh", confirm: true }, RESULT_HEIGHT),false,"Start fresh…"))))
          .when(!s.ok && !!s.error, (el) => el.child(div().pl(22).text_size(11.5).text_color(t.dim).child(s.error)))));
    }
    return v_flex().gap(6)
      .child(div().text_size(12.5).text_color(r.ok ? t.foreground : t.blocked).child(r.ok ? (r.text || this.doneWords(target, step.action)) : r.text || "It didn't work, and the CLI gave no reason."))
      .when(!!r.warning, (el) => el.child(div().text_size(11).text_color(t.dim).child(r.warning)))
      .when(!r.ok, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(step.action === "send" || step.action === "queue"
        ? "It may still have been delivered: check the seat or `rig queue` before trying again."
        : step.action === "reply" ? "It may still have arrived: check the request in Needs-You before answering again."
        : step.action === "launch-spec" ? "Fix the fields above and press Launch, or check the rig list if Launch timed out."
        : step.action === "new-rig" ? "Check the rig list before trying again."
        : step.action === "delete-rig" ? "Check the rig list before trying again; Retry runs the delete again."
        : step.action === "pause" || step.action === "resume" ? "Check the current state before trying again; Retry re-reads it first." : "Retry runs it again.")))
      // A message or an answer is never resent from here: it may have arrived. Anything else runs again.
      .when(!r.ok && !RESEND_UNSAFE.has(step.action), (el) => el.child(this.dialogButton(t,div().id("rig-retry").px(10).h(24).rounded(6).bg(t.raised).flex().items_center().hover((s) => s.bg(t.hover)),null,
        (_e,cx)=>this.retry(cx,target,step),false,"Retry")));
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
    const assistantReason=assistantActionRefusal(target,step.action);
    if(assistantReason){this.result={ok:false,text:assistantReason};cx.notify();return;}
    if(step.action==="confirm-spec-write"){
      if(!step.token)return;
      setShared("rig.specWriteDecisions",{...(shared("rig.specWriteDecisions")??{}),[step.token]:"allow"});
      this.dismiss();return;
    }
    if(step.action==="spaces-list"){
      if(!step.token)return;
      setShared("rig.spacesListDecisions",{...(shared("rig.spacesListDecisions")??{}),[step.token]:"allow"});
      this.dismiss();return;
    }
    if (step.action === "archive-rig") { this.archive(cx, target); return; }
    if (step.action === "unarchive-rig") { this.unarchive(cx, target); return; }
    if (step.action === "confirm-machine") {
      if (!step.token) return;
      setShared("rig.machineConfirmation", step.token);
      run("rig.confirm-machine"); this.dismiss(); return;
    }
    if (step.action === "rebuild-space") {
      if (!step.recovery?.tiles?.length || !step.token) return;
      this.busy = "Rebuilding";
      setShared("rig.rebuildRequest", { rigId: target.rigId, token: step.token });
      run("rig.rebuild-space"); this.dismiss(); return;
    }
    if(step.action==="move-grid") {
      if(!step.token||!step.relocation?.source)return;
      setShared("rig.gridMoveRequest",{rigId:target.rigId,token:step.token});
      run("rig.move-grid");this.dismiss();return;
    }
    const capAction = step.action === "design-view" ? "open-designed-view" : (step.action === "reply" && target?.reply === "answer" ? "reply-answer" : step.action);
    const disableReason = capabilityDisableReason(capAction, this.caps()) ?? (this.config ? personDisableReason(step.action, this.config) : null);
    if (disableReason) {
      if (step.action === "design-view") this.designError = disableReason;
      else this.result = { ok: false, text: disableReason };
      cx.notify();
      return;
    }
    if (step.action === "delete-rig") {
      if (target.rig === "kernel") { this.result = { ok: false, text: "The kernel is OpenRig's own rig: it isn't deleted or archived from here." }; cx.notify(); return; }
      this.run(cx, `Deleting ${target.rig}`, async () => {
        const r = await this.write(this.argsFor(target, "delete-rig"));
        if (r.json?.deleted) {
          // A deleted rig's inspection cannot refresh. Remove its history entries while keeping other pages.
          const nav = shared("rig.nav");
          if (nav?.stack) {
            const stack = nav.stack.filter((entry) => entry.rig !== target.rig &&
              !(target.rigId && entry.rigId === target.rigId) &&
              !(entry.kind === "rig" && entry.name === target.rig));
            setShared("rig.nav", { ...nav, stack: stack.length ? stack : [{ section: "topology" }] });
          }
          run("rig.refresh");
        }
        return { ...r, kind: "delete" };
      });
      return;
    }
    if (step.action === "new-rig") {
      const createReason = this.newMode === "seat" ? capabilityDisableReason("create-rig", this.caps()) : null;
      const { problem, args } = this.newRigArgs();
      if (createReason || problem || !args) {
        this.newProblem = createReason ?? problem ?? "Nothing to run.";
        this.newProblemField = this.newMode === "spec" && /spec|\.yaml/i.test(this.newProblem) ? "spec"
          : /rig.*name|name.*rig/i.test(this.newProblem) ? "name" : /folder|path.*absolute/i.test(this.newProblem) ? "folder" : "spec";
        this.result = null; cx.notify(); return;
      }
      this.newProblem = null;
      const folder = (this.folder?.value() ?? "").trim(), name = (this.rigName?.value() ?? "").trim();
      setShared("rig.drafts", { ...(shared("rig.drafts") ?? {}), "launch-folder": folder });
      const fromSpec = this.newMode === "spec", spec = this.newSpec?.name ?? this.newSpec?.sourcePath, runtime = this.newRuntime;
      this.run(cx, fromSpec ? "Launching" : "Creating", async () => {
        const r = await this.write(args, fromSpec ? { env: launchSpecEnv("") } : undefined);
        if (r.ok) run("rig.refresh");
        const createdRig = r.json?.rig?.id ?? r.json?.rigId ?? r.json?.rig?.name ?? r.json?.name ?? (name || spec);
        return r.ok ? { ...r, kind: "new-rig", createdRig, text: fromSpec ? `${spec} launched${name ? ` as ${name}` : ""}.` : `${name} created with one ${runtime} seat.` }
          : { ...r, text: /timed? ?out|timeout/i.test(r.text ?? "") ? "OpenRig didn't answer in time. Check the rig list before trying again." : `OpenRig refused: ${r.text || "no reason was reported."}` };
      });
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
        // To the target's own daemon, resolved the way `write` resolves it; nothing is sent when it can't be.
        const conn = targetConnection(this.config ?? await configNow(), target);
        if (!conn.ok) return { ok: false, text: conn.reason };
        const cfg = conn.config;
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
    this.run(cx, label, () => this.write(this.argsFor(target, step.action, text),undefined,cx));
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
    const pill = (id, label, active, onClick) => this.dialogButton(t,div().id(id).px(8).h(24).rounded(5).flex().items_center().text_size(12).cursor_pointer()
      .bg(active ? t.accent : t.raised).text_color(active ? (t.solid_foreground ?? t.background) : t.muted).border_1().border_color(active ? t.accent : t.border)
      .hover((s) => s.bg(active ? t.accent : t.hover)),null,(_e,cx)=>{onClick();cx.notify();},false,label);
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
    const small = (id, label, act, on = true) => this.dialogButton(t,div().id(id).w(18).h(18).flex_none().rounded(4).flex().items_center().justify_center().text_size(12)
      .text_color(on ? t.muted : t.border).hover((s) => s.bg(t.hover)),null,(_e,cx)=>{cx.stop_propagation();act(cx);},!on,label);
    const chipButton = (id, label, act) => this.dialogButton(t,div().id(id).px(8).h(22).rounded(5).bg(t.raised).flex().items_center().text_size(12).hover((s) => s.bg(t.hover)),null,(_e,cx)=>act(cx),false,label);
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
    const toggle = (id, label, on, flip) => this.dialogButton(t,h_flex().id(id).gap(6).items_center().cursor_pointer()
      .child(checkboxSquare(on)).child(div().text_size(12).child(label)),null,
      (_e, cx) => { this.typing = false; flip(); cx.notify(); });
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
          .on_mouse_down("left", (e, cx) => { if (!stopped) { this.typing = false; this.handle?.focus?.(); this.beginSeatPress(s.session,e); this.selectedSeat = s.session; cx.notify(); } })
          .on_mouse_up("left", (_e, cx) => { this.pressedSeat=null;this.draggingSeat = null; cx.notify(); })
          .child(div().id(`design-seat-check-${lid}`).w(13).h(13).flex_none().rounded(3).border_1().border_color(stopped ? t.border : (isChecked ? t.accent : t.border)).flex().items_center().justify_center()
            .on_click((_e, cx) => { cx.stop_propagation(); if (!stopped) toggleSeatChecked(cx, s.session); })
            .when(isChecked && !stopped, (box) => box.bg(t.accent).child(svg(icon("check")).size(10).text_color(t.solid_foreground ?? t.background))))
          .child(div().size(7).flex_none().rounded(4).bg(t[s.tone] ?? t.dim))
          .child(div().flex_1().truncate().tooltip(String(lid??"")).child(lid))
          .child(div().text_size(11).flex_none().text_color(t.dim).child(stopped ? "(stopped) · not running: no pane to attach" : placed ? `✓ ${placed}` : s.word ?? ""));
      }))
      .child(this.dialogButton(t,div().id("design-add-shell").mt(4).px(8).h(24).rounded(5).bg(t.raised).flex().items_center().text_size(11.5).text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        ,null,(_e,cx)=>addShellPane(cx),false,"+ Add shell pane"));

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
        .on_mouse_down("left", (e, cx) => { if (!pad) { this.typing = false; this.handle?.focus?.(); this.beginSeatPress(x.seat ?? x.cellId ?? {r,c},e); cx.notify(); } })
        .on_mouse_up("left", (e, cx) => {
          if (this.draggingDivider) { cx.stop_propagation(); this.finishDividerDrag(e, cx); return; }
          cx.stop_propagation();
          this.advanceSeatDrag(e,cx);this.pressedSeat=null;
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
        .child(div().flex_1().truncate().text_size(12).text_color(pad ? t.dim : t.foreground).tooltip(String(cellTitle??"")).child(cellTitle));
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
          .child(div().flex_1().border(1).border_color(t.border).rounded(6).px(6).py(2).child(this.dialogField(this.viewName,Input))))
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
  beginSeatPress(value,event){
    const point=event?.position??event;
    this.draggingSeat=null;
    this.pressedSeat={value,start:Number.isFinite(point?.x)&&Number.isFinite(point?.y)?{x:point.x,y:point.y}:null};
  }

  advanceSeatDrag(event,cx){
    const press=this.pressedSeat,point=event?.position??event;
    if(!press||!Number.isFinite(point?.x)||!Number.isFinite(point?.y))return;
    if(!press.start){press.start={x:point.x,y:point.y};return;}
    if(Math.hypot(point.x-press.start.x,point.y-press.start.y)<3)return;
    this.draggingSeat=press.value;this.pressedSeat=null;cx.notify();
  }

  finishDrag(cx, e = null) {
    if (this.draggingDivider) {
      this.finishDividerDrag(e, cx);
      return;
    }
    this.advanceSeatDrag(e,cx);this.pressedSeat=null;
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
    this.dialogRenderCx=cx;this.dialogButtonIndex=0;
    this.dialogFirstControl=step.action==='design-view'?this.handle:null;
    this.dialogLastControl=null;
    const result = this.result;
    const title = ["delete-rig", "archive-rig", "unarchive-rig"].includes(step.action) && result
      ? result.kind === "archive" ? (result.ok ? `${target.rig} archived` : `Couldn't archive ${target.rig}`)
        : result.kind === "unarchive" ? (result.ok ? `${target.rig} restored` : `Couldn't restore ${target.rig}`)
        : result.ok && result.json?.deleted && !result.json?.deleteBlocked && !result.json?.errors?.length
          ? `${target.rig} deleted` : `Couldn't delete ${target.rig}`
      : step.action === "spaces-list" ? (step.copy?.title ?? "Spaces list")
      : step.action === "confirm-spec-write" ? (step.confirmation?.capability === "copy-folder" ? `Copy built-in specs on ${step.confirmation?.machine}?` : `Save specs on ${step.confirmation?.machine}?`)
      : step.action === "confirm-machine" ? `Open seats on ${step.confirmation?.machine}?`
      : step.action === "move-grid" ? `Move ${target.rig} to ${step.relocation?.machine}?`
      : step.action === "rebuild-space" ? `Rebuild ${target.rig}'s tiles?` : actionTitle(target, step.action);
    const go = (cx) => this.go(cx, target, step);
    let body = null;
    if(step.action==="confirm-spec-write"){
      const c=step.confirmation??{};
      const exact=(label,value,id)=>h_flex().gap(8).items_center()
        .child(div().w(100).flex_none().text_color(t.muted).child(label))
        .child(div().flex_1().min_w(0).font_family(settings()?.font_family??"monospace").text_size(10.5).child(value))
        .child(this.dialogButton(t,div().id(id).size(20).flex_none().cursor_pointer().tooltip(`Copy ${label}`),null,
          (_e,cx)=>{cx.stop_propagation();cx.write_to_clipboard(value);},false,svg(icon("rig-copy")).size(12).text_color(t.dim)));
      const folderCopy=c.capability==="copy-folder";
      body=v_flex().gap(10)
        .child(div().child(folderCopy
          ? `Copy a built-in spec's whole folder on ${c.machine} as ${c.user}, with OpenRig's own rig specs add, then make that copy's agent paths absolute. Herdr writes only inside the folders below and installs its spec helper on ${c.machine}.`
          : `Save specs on ${c.machine} as ${c.user}. Herdr writes only inside the folders below and installs its spec helper on ${c.machine}.`))
        .when(folderCopy&&!!c.from,el=>el.child(exact("Copies",c.from,"copy-spec-from")))
        .when(folderCopy&&!!c.into,el=>el.child(exact("Into",c.into,"copy-spec-into")))
        .children((c.roots??[]).map((root,i)=>exact(i?"":"Writes only inside",root,`copy-spec-root-${i}`)))
        .child(exact("Helper",c.helperPath,"copy-spec-helper"))
        .child(exact("SHA-256",c.sha256,"copy-spec-hash"))
        .child(div().text_color(t.muted).child(folderCopy
          ? "The built-in itself is never changed, and an existing copy is never overwritten. A changed helper or spec folder asks again. This permission is separate from saving specs and from opening seats."
          : "Built-in specs are never overwritten. A changed helper or spec folder asks again. This permission is separate from opening seats."));
    } else if (step.action === "spaces-list") {
      const c = step.copy ?? {}, row = (label, value, mono) => h_flex().gap(8).items_start()
        .child(div().w(70).flex_none().text_color(t.muted).child(label))
        .child(div().flex_1().min_w(0).when(mono, (el) => el.font_family(settings()?.font_family ?? "monospace").text_size(11)).child(value));
      const section = (id, head, text) => v_flex().id(id).gap(3).child(div().text_size(11.5).font_semibold().text_color(t.muted).child(head)).child(div().child(text));
      body = v_flex().gap(12)
        .child(div().id("spaces-list-intro").child(c.intro ?? ""))
        .when(!!c.note, (el) => el.child(div().id("spaces-list-shipped").text_color(t.muted).child(c.note)))
        .child(v_flex().id("spaces-list-changes").gap(5).child(div().text_size(11.5).font_semibold().text_color(t.muted).child("What changes"))
          .children((c.changes ?? []).map(([label, value, mono]) => row(label, value, mono)))
          .child(div().text_color(t.muted).child(c.unchanged ?? "")))
        .child(section("spaces-list-stays", "What stays as it is", c.stays ?? ""))
        .when(!!c.good, (el) => el.child(section("spaces-list-good", "Good to know", c.good)))
        .child(section("spaces-list-back", "The way back", c.wayBack ?? ""));
    } else if (step.action === "confirm-machine") {
      const c = step.confirmation ?? {};
      body = v_flex().gap(10)
        .child(div().child(`Machine: ${c.machine} · Account: ${c.user} on ${c.target}`))
        .child(div().child("Herdr machine access gives local programs full shell access to this account: its commands, files and terminals."))
        .child(div().child(`Confirm before opening seats or installing the Attach relay in ${c.folder}. The mod checks the file hash before use and asks again when the helper's checksum changes.`))
        .child(div().child(c.fileState === "older" ? "Older version: this replaces it" : c.fileState === "same" ? "Already installed: nothing is written." : "Not installed: this installs it."))
        .child(h_flex().gap(4).items_center()
          .child(div().flex_1().min_w(0).font_family(settings().font_family).text_size(10.5).child(`SHA-256: ${c.sha256}`))
          .child(div().id("copy-relay-hash").size(20).flex_none().rounded(4).cursor_pointer().tooltip("Copy SHA-256")
            .hover(el => el.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(c.sha256); })
            .child(svg(icon("rig-copy")).size(12).text_color(t.dim))))
        .child(div().text_color(t.muted).child("Attach and Operator run there. Grid tiles use that machine's tmux. A failed connection never starts a local terminal."));
    } else if(step.action==="move-grid") {
      const move=step.relocation,viewers=move.tiles.filter(t=>t.labels["herdr-openrig.seat"]).length,pads=move.tiles.length-viewers;
      body=v_flex().gap(10)
        .child(div().child(`Herdr opens ${target.rig}'s grid on ${move.machine} first. Then it closes the old viewers on this computer. The seats keep running; only the windows onto them move. Personal tabs in the old space stay where they are.`))
        .child(div().text_color(t.muted).child(`${viewers} seat viewer${viewers===1?"":"s"} and ${pads} empty tile${pads===1?"":"s"} in ${target.rig}`))
        .when(!move.keptTabs.length,el=>el.child(div().text_color(t.muted).child(`If no other tabs or changed tiles remain, the old space “${move.sourceName}” closes too.`)))
        .when(!!move.keptTabs.length,el=>el.child(div().text_color(t.muted).child(`Stays: ${move.keptTabs.join(", ")}.`)));
    } else if (step.action === "rebuild-space") {
      body = v_flex().gap(8)
        .when(step.continueMove,el=>el.child(div().child("After rebuilding these shells, Herdr continues the Move you approved. The old grid stays until the rebuilt grid is ready.")))
        .child(div().child("This rebuilds the grid's viewers; a viewer that can be reused stays open. The seats keep running. Anything running or typed in these shells is lost."))
        .when(step.focusedTile, (el) => el.child(div().text_color(t.blocked).child("A tile in this grid has focus. Work you are typing in its shell will be lost.")))
        .child(v_flex().max_h(160).overflow_y_scrollbar().children((step.recovery?.tiles ?? []).map((tile, i) => div().text_size(12).child(`${step.tileNames?.[i] || tile.labels["herdr-openrig.seat"] || "Empty tile"} · ${tile.terminal}`))))
        .child(div().text_color(t.muted).child("Cancel to keep working in these shells. Changed tiles are left alone."));
    } else if (step.action === "design-view") {
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
          .children(p.busy.map((s) => h_flex().gap(8).child(statusMarkElement({ div, svg }, t, s.status ?? s.tone, { iconOf: icon })).child(div().w(130).truncate().tooltip(String(s.logicalId??"")).child(s.logicalId))
            .child(div().text_color(t.muted).child(`${s.word}${s.owned ? ` · ${s.owned} owned item${s.owned === 1 ? "" : "s"}` : ""}`))))
          .child(div().text_color(t.dim).child("OpenRig snapshots first (best effort). Resume brings back each conversation where the harness allows."));
    } else if (step.action === "archive-rig" && !this.result && !this.busy) {
      body = div().text_color(t.muted).child(this.rigRunning(target)
        ? `It pauses its agents${this.pause?.total != null ? ` (${this.pause.total})` : ""}, takes a snapshot first (best effort), and hides the rig from the list. Nothing is deleted. You can restore it any time from Archived.`
        : "It hides the stopped rig from the list. Nothing is deleted. You can restore it any time from Archived.");
    } else if (step.action === "delete-rig" && !this.result && !this.busy) {
      body = this.deleteView(t, target);
    } else if (step.action === "new-rig" && !this.result?.ok && !this.busy) {
      body = this.newRigView(t);
    } else if (step.action === "fresh" && !this.result && !this.busy) {
      body = div().child(`${target.logicalId} starts a new conversation; the old one is not resumed.`);
    } else if (step.action === "launch-spec" && !this.result?.ok && !this.busy) {
      const field = (label, state) => v_flex().gap(3).child(div().text_size(11.5).text_color(t.dim).child(label))
        .child(div().border(1).border_color(t.border).rounded(6).px(6).py(4).child(this.dialogField(state,Input)));
      // The exact source rig up is given, not only the spec's name: what the person approves is what runs.
      const source = target.sourcePath ?? target.name;
      const sourceProblem = launchSourceProblem(source);
      body = v_flex().gap(8)
        .child(div().text_color(t.muted).child(`${target.name}: the seats start in the folder below and run until paused.`))
        .child(div().id("launch-source").text_size(11.5).text_color(sourceProblem ? t.blocked : t.dim).child(sourceProblem ?? `rig up -- ${source}`))
        .child(field("Working folder", this.folder))
        .child(div().id("launch-folder-machine").text_size(11.5).text_color(t.dim).child(`This folder must exist on ${this.config?.daemonMachine || "the machine running OpenRig"}.`))
        .child(field("Host (optional)", this.host));
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
      : step.action === "spaces-list" ? (step.copy?.confirm ?? "Change")
      : step.action === "confirm-spec-write" ? (step.confirmation?.capability === "copy-folder" ? "Allow built-in copies" : "Allow spec saves")
      : step.action === "confirm-machine" ? "Allow this machine"
      : step.action === "move-grid" ? `Move ${target.rig}`
      : step.action === "rebuild-space" ? `Rebuild ${step.recovery?.tiles?.length ?? 0} tile${step.recovery?.tiles?.length===1?"":"s"}${step.continueMove?" and continue Move":""}`
      : step.action === "new-rig" ? (this.newMode === "seat" ? "Create" : "Launch")
      : step.action === "archive-rig" ? "Archive"
      : step.action === "delete-rig" ? `Delete ${target.rig}`
      : { pause: "Pause rig", resume: "Resume rig", fresh: "Start fresh", "design-view": "Open", send: "Send", queue: "Queue", reply: "Reply", "launch-spec": "Launch" }[step.action];
    const done = !!this.result?.ok;
    // Only while the dialog offers its button: never re-runs a one-click action or a finished one; launch-spec keeps its fields and Launch button after a validation error.
    const canConfirm = !!confirmLabel && (step.action === "launch-spec" || step.action === "new-rig" || step.action === "design-view" || step.action === "change-model" ? !this.result?.ok : !this.result) && !this.busy && !step.run;
    const archiveReason = step.action === "delete-rig" ? capabilityDisableReason("archive-rig", this.caps()) : null;
    const mac = window()?.platform === "macos";
    return v_flex().id("rig-dialog").when(!!this.handle, (el) => el.track_focus(this.handle)).tab_stop(step.action==='design-view').size_full().p(14).gap(10).bg(t.surface ?? t.panel ?? t.bg).text_color(t.foreground).text_size(12.5)
      .key_context('RigDialog')
      .on_action('rig-dialog-next',(_e,cx)=>this.dialogTab({key:'tab',modifiers:{}},cx))
      .on_action('rig-dialog-prev',(_e,cx)=>this.dialogTab({key:'tab',modifiers:{shift:true}},cx))
      .on_mouse_move((e, cx) => { if(step.action==='design-view'){this.advanceSeatDrag(e,cx);if(this.draggingDivider)this.moveDividerDrag(e,cx);} })
      .on_mouse_up("left", (e, cx) => { if (step.action === "design-view") this.finishDrag(cx, e); })
      // Esc cancels an active drag in the designer first; otherwise Esc closes (a draft is kept); Ctrl+Enter / Cmd+Enter sends from anywhere in the dialog.
      .on_key_down((e, cx) => {
        const key = String(e.key ?? "").toLowerCase();
        if(key==='tab'&&!e.modifiers?.control&&!e.modifiers?.platform&&!e.modifiers?.alt){
          this.dialogTab(e,cx);return;
        }
        if (key === "escape") {
          cx.stop_propagation();
          if (step.action === "design-view" && (this.draggingSeat || this.pressedSeat || this.draggingDivider)) {
            this.draggingSeat = null;
            this.pressedSeat=null;
            this.draggingDivider = null;
            this.designStatus = "Drag cancelled";
            cx.notify();
            return;
          }
          this.dismiss();
        }
        // Ctrl+Enter confirms, except Delete: a rig is only deleted by its own button.
        else if ((key === "enter" || key === "return") && (e.modifiers?.control || e.modifiers?.platform) && canConfirm && step.action !== "delete-rig") {
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
      .child(div().id("rig-dialog-title").flex_none().text_size(14).font_semibold().child(title))
      .when(!!body && !["change-model","new-rig","confirm-spec-write","spaces-list"].includes(step.action), (el) => el.child(body))
      .when(!!this.input && !this.result, (el) => el.child(div().flex_1().border(1).border_color(t.border).rounded(6).p(6).child(this.dialogField(this.input,Textarea).h(96)))
        .child(div().text_size(11).text_color(t.dim).child(`${mac ? "⌘ Return" : "Ctrl+Enter"} sends · Esc or a click outside closes; your text is kept until you send or cancel`)))
      // Long results and the model/harness form scroll; the action footer never shrinks into the body.
      .when(step.action !== "design-view" || !!this.result || !!this.busy, (el) => el.child(v_flex().id("rig-dialog-body").flex_1().min_h(0).overflow_y_scrollbar()
        .when(["change-model","new-rig","confirm-spec-write","spaces-list"].includes(step.action) && !!body, (content) => content.child(body))
        .child(this.resultView(t, cx, target, step) ?? div())))
      .child(h_flex().id("rig-dialog-footer").flex_none().gap(8).justify_end()
        .child(this.dialogButton(t,div().id("rig-cancel").px(12).h(26).rounded(6).bg(t.raised).flex().items_center().hover((s) => s.bg(t.hover)),this.dialogCancelHandle,
          () => { if(!done&&step.action==="rebuild-space"&&step.continueMove)notify({title:"Move not continued",body:"Both grids were left in place."});this.dismiss(!done); },false,done ? "Close" : "Cancel"))
        .when(done && step.action === "new-rig" && typeof result.createdRig === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(result.createdRig), el => el.child(
          this.dialogButton(t,div().id("new-rig-open-space").px(12).h(26).rounded(6).bg(t.accent).text_color(t.background ?? "#fff").flex().items_center().cursor_pointer(),this.dialogOpenSpaceHandle,
            () => { run(`rig.space:${result.createdRig}`); this.dismiss(); },false,"Open rig space")))
        .when(canConfirm && step.action === "delete-rig", (el) => el.child(this.dialogButton(t,div().id("rig-archive").px(12).h(26).rounded(6).bg(t.raised).border_1().border_color(t.border)
          .flex().items_center().hover((s) => s.bg(t.hover)).when(!!archiveReason, (b) => b.opacity(0.45).tooltip(archiveReason))
          ,this.dialogArchiveHandle,(_e,cx)=>this.archive(cx,target),!!archiveReason,this.rigRunning(target) ? "Pause and archive" : "Archive")))
        .when(canConfirm, (el) => el.child(this.dialogButton(t,div().id("rig-confirm").px(12).h(26).rounded(6)
          .bg(step.action === "pause" || step.action === "fresh" || step.action === "delete-rig" ? t.blocked : t.accent)
          .text_color(step.action === "delete-rig" ? (t.surface ?? t.background ?? "#fff") : (t.background ?? "#fff")).flex().items_center(),this.dialogConfirmHandle,
          (_e,cx)=>go(cx),false,confirmLabel))));
  }

  /** Delete's confirmation: what stops (every seat, with its state and owned work), the command, and Archive instead. */
  deleteView(t, target) {
    const p = this.pause;
    const seats = p?.seats ?? [];
    const what = p && !p.error ? `${target.rig}'s ${seats.length} seat${seats.length === 1 ? "" : "s"}` : `every seat of ${target.rig}`;
    const list = !p ? div().text_color(t.muted).child("Reading the rig…") : p.error ? div().text_color(t.blocked).child(p.error)
      : v_flex().id("delete-seats").gap(3).children(seats.map((s, i) => h_flex().id(`delete-seat-${i}`).gap(8).items_center()
        .child(statusMarkElement({ div, svg }, t, s.status ?? s.tone, { iconOf: icon })).child(div().w(130).truncate().tooltip(String(s.logicalId??"")).child(s.logicalId))
        .child(div().text_color(t.muted).child(`${s.word}${s.owned ? ` · ${s.owned} owned item${s.owned === 1 ? "" : "s"}` : ""}`))));
    return v_flex().id("delete-view").gap(8)
      .child(div().child(`${this.rigRunning(target) ? `This stops ${what} and deletes the rig. OpenRig takes a snapshot first.` : `This removes the stopped rig ${target.rig}.`} The rig can't be brought back by name afterwards.`))
      .child(list)
      .child(div().id("delete-command").text_size(11.5).text_color(t.dim).child(commandLine(this.argsFor(target, "delete-rig"))))
      .child(div().text_size(11).text_color(t.dim).child("Seats joined with rig attach keep running; the result lists them."))
      .child(v_flex().id("delete-archive-box").gap(2).p(8).rounded(6).bg(t.raised).border_1().border_color(t.border)
        .child(div().font_semibold().child("Want it back later?"))
        .child(div().text_color(t.muted).child("Archive hides the rig and keeps everything. A running rig is paused first.")));
  }

  /** New rig: a two-choice control (from a spec, or one seat), its fields, and the command it will run. */
  newRigView(t) {
    const pill = (id, label, active, onClick) => this.dialogButton(t,div().id(id).px(8).h(24).rounded(5).flex().items_center().text_size(12).cursor_pointer()
      .bg(active ? t.accent : t.raised).text_color(active ? (t.solid_foreground ?? t.background) : t.muted).border_1().border_color(active ? t.accent : t.border)
      .hover((s) => s.bg(active ? t.accent : t.hover)),null,(_e,cx)=>{this.newFocusTouched=true;onClick();cx.notify();},false,label);
    const label = (text) => div().text_size(11.5).text_color(t.dim).child(text);
    const field = (text, state) => v_flex().gap(3).child(label(text)).child(div().border(1).border_color(t.border).rounded(6).px(6).py(4).child(this.dialogField(state,Input)));
    const seat = this.newMode === "seat";
    const createReason = seat ? capabilityDisableReason("create-rig", this.caps()) : null;
    const specs = this.newSpecs;
    const specList = !specs ? div().text_color(t.muted).child("Reading the spec library…")
      : specs.error ? div().text_color(t.blocked).child(specs.error)
      : !specs.length ? div().text_color(t.muted).child("The spec library has no rig specs. Add one to the library, or make a one-seat rig.")
      : v_flex().id("new-rig-specs").gap(2).h(this.newExpandedSpec ? 360 : 132).flex_none().overflow_y_scrollbar().mode("always").track_scroll(this.newSpecScroll)
        .on_size_change((_size,cx)=>{this.newSpecScroll?.scroll_to_item(this.newSpecFocus);cx.notify();})
        .when(!!this.newSpecHandle, (el) => el.track_focus(this.newSpecHandle)).tab_stop(true).focus(el=>el.border(1).border_color(t.accent))
        .on_key_down((e, cx) => this.newSpecKey(e, cx)).children(specs.map((s, i) => {
        const on = this.newSpec === s;
        return v_flex().flex_none().gap(3).child(h_flex().id(`new-rig-spec-${i}`).px(6).h(24).gap(8).rounded(5).items_center().cursor_pointer()
          .bg(on ? (t.selection ?? `${t.accent}1f`) : t.raised).hover((x) => x.bg(t.hover))
          .on_click((_e, cx) => { this.typing = false; this.newSpecHandle?.focus?.(); this.pickNewSpec(cx, s, true); })
          .child(svg(icon(on ? "check" : "rig-card")).size(12).flex_none().text_color(on ? t.accent : t.muted))
          .child(div().flex_1().truncate().tooltip(String(s.name ?? s.id ?? "Unnamed spec"??"")).child(s.name ?? s.id ?? "Unnamed spec")))
          .when(this.newExpandedSpec === s, (el) => el.child(v_flex().id(`new-rig-spec-preview-${i}`).ml(14).pb(4).child(this.newSpecPreviewView(t, s))));
      }));
    return v_flex().id("new-rig-view").gap(8).on_mouse_down('left',()=>{this.newFocusTouched=true;})
      .child(h_flex().id("new-rig-mode").gap(4)
        .child(pill("new-rig-mode-spec", "From a spec", !seat, () => { this.newMode = "spec"; this.newProblem = null; this.result = null; }))
        .child(pill("new-rig-mode-seat", "One seat", seat, () => { this.newMode = "seat"; this.newProblem = null; this.result = null; })))
      .when(!seat, (el) => el.child(v_flex().gap(3).child(label("Spec")).child(specList)
        .when(!!this.newProblem && this.newProblemField === "spec", x => x.child(div().id("new-rig-spec-error").text_size(11.5).text_color(t.blocked).child(this.newProblem))))
        .child(field("Working folder", this.folder))
        .when(!!this.newProblem && this.newProblemField === "folder", x => x.child(div().text_size(11.5).text_color(t.blocked).child(this.newProblem)))
        .child(field("Name (optional: run a spec twice under another name)", this.rigName))
        .when(!!this.newProblem && this.newProblemField === "name", x => x.child(div().text_size(11.5).text_color(t.blocked).child(this.newProblem))))
      .when(seat, (el) => el.child(field("Name", this.rigName))
        .when(!!this.newProblem && this.newProblemField === "name", x => x.child(div().id("new-rig-name-error").text_size(11.5).text_color(t.blocked).child(this.newProblem)))
        .child(v_flex().gap(3).child(label("Runtime")).child(h_flex().id("new-rig-runtimes").gap(4)
          .children(NEW_RIG_RUNTIMES.map((r) => pill(`new-rig-runtime-${r}`, r, this.newRuntime === r, () => { this.newRuntime = r; })))))
        .child(field("Working folder", this.folder))
        .when(!!this.newProblem && this.newProblemField === "folder", x => x.child(div().id("new-rig-folder-error").text_size(11.5).text_color(t.blocked).child(this.newProblem)))
        .when(!!createReason, (x) => x.child(div().text_size(11.5).text_color(t.blocked).child(createReason))))
      .child(div().id("new-rig-command").text_size(11.5).text_color(t.dim).child(commandLine(this.newRigPreview())));
  }

  machineSetupHost(cx){
    const configPath=`${appHome()}/openrig/config.json`,consentPath=`${appHome()}/openrig/machine-consent.json`;
    return {exec,hc,machines,beforeApprove:()=>{
      const token=props()?.step?.token;
      if(token&&shared("rig.machineSetupToken")!==token)throw new Error("This setup was replaced by a newer request. Close it and use the newer screen.");
    },relayPath:attachRelayPath(appHome(),MOD_IDS.menu),wait:waitWith(cx),
      health:async url=>{const r=await fetch(`${url}/healthz`);if(!r.ok)throw new Error("Cannot read the tunnel's OpenRig health.");return r.json();},
      readConfig:()=>readTextFile(configPath).catch(()=>null),writeConfig:(text,previous)=>writeTextFile(configPath,text,previous),
      readConsentText:()=>readTextFile(consentPath).catch(()=>null),writeConsentText:(text,previous)=>writeTextFile(consentPath,text,previous),
      saved:async(result,stop)=>{
        if(stop){
          const path=`${appHome()}/openrig/state.json`,before=await readTextFile(path).catch(()=>null),state=JSON.parse(before??"{}");
          const declined={...(state.machineDeclined??{})},search={...(state.machineSearchDeclined??{})};
          const receipt=result.previous;
          if(receipt?.profileId&&receipt?.selfHostId)delete declined[JSON.stringify([receipt.profileId,receipt.selfHostId])];
          delete search[rigOrigin(this.config.daemonUrl)];
          const next={...state,machineDeclined:declined,machineSearchDeclined:search};
          await writeTextFile(path,JSON.stringify(next,null,2)+"\n",before);
          setShared("rig.spaceState",{...(shared("rig.spaceState")??{}),machineDeclined:declined,machineSearchDeclined:search});
        }
        setShared("rig.machineSetup",stop?null:result.receipt);run("rig.refresh");}};
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    if(this.setupPanel)return this.setupPanel.render(t,cx);
    if(p.step&&["confirm-machine","setup-machine","stop-machine"].includes(p.step.action))return div().p(14).child("Checking OpenRig configuration…");
    if (!p.target) return div();
    const target = complete(p.target);
    const tree=p.step ? this.dialogView(t, cx, target, p.step) : this.popup(t, target);
    this.dialogRenderCx=null;
    return tree;
  }
}
