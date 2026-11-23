// OpenRig's actions: the right-click menu on Rig sidebar rows, Rig page rows, Needs-You items and worker
// cell headers, and the dialogs those actions need (a text box, a confirmation, a result).
//
// Every write runs the CLI as the person (`<name>@external` from `<appHome>/openrig/config.json`), with a seat's inherited
// OPENRIG_SESSION_NAME removed (rig-lib writeCommand); the CLI keeps owning tokens and sender identity. Results are
// shown in plain words with original diagnostics under Details; an error is not proof nothing happened, so Retry re-reads state before running again.
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
import {readRestorePlan,readConversationRollCall,restorePlanIdentity,restorePlanView,rollCallView} from './rig-resume.js';
import { sharedLoopbackDaemonUrl, sharedRigData, requestFailed, requestWhat, withFocusContext, releaseFocusTargets } from "./rig-lib.js";
import { registerRigRouting, stampRows, messageDialogSpace, ROWS_STALE, tabPagesScrub } from "./rig-lib.js";
import { targetConnection, pickRig, configOfConnection, adoptConnection, UNKNOWN_CONNECTION, NO_CONNECTION, commandFor, operatorCommandFor, tuiCommandFor, connectionBoxLabel, logExecError, plainExecError, parseExecTimeout, isKnownUnsentError, unsentErrorMessage } from "./rig-connections.js";
import { typeahead } from "./rig-typeahead.js";
import { revealAfterKey } from "./rig-scroll-reveal.js";
import { dismissible, requestDismissal, updateKey, dismissalScope } from "./rig-dismiss.js";
import { workerCapabilityText, rowTitle, rowTip, rowText, rowIdIn, sweepFinding, checkLabel, TERMINAL_GONE_REASON, TERMINAL_GONE_SEND_NOTE, TERMINAL_GONE_RIG_REASON, rigTerminalsGone } from "./rig-lib.js";
import {knownOldProviderViews,readOldProviderViews,hasOldProviderStrip,oldStripLayouts,oldViewsGone,oldStripCleanupBusy,oldStripBusyTip} from './rig-old-views.js';
import {layouts} from 'herdr';
import { rigOrigin, syncRetainedOrigins } from "./rig-space-context.js";
import { MachineSetupPanel } from "./rig-machine-setup-view.js";
import { AddMachinePanel, AddMachineChooser } from "./rig-add-machine-view.js";
import {AddLocalPanel} from './rig-add-local-view.js';
import { RemoveConnectionPanel } from "./rig-remove-connection-view.js";
import { SwitchConnectionPanel } from "./rig-switch-connection-view.js";
import { RemoteOpenRig } from "./rig-openrig-remote.js";
import { consentOf as openrigConsentOf, consentText as openrigConsentText, HERDR_CONNECTION_OFFERED, SWITCH_NOT_OFFERED, HERDR_APPROVE_NOT_OFFERED } from "./rig-connections.js";
import { loopbackHealthFetch, machineProbeExec, localDirectoryProbe,localProbeExec } from "./rig-remote.js";
import { rigSpaceRelocation } from "./rig-spaces.js";
import { h_flex, v_flex, TextView, TextareaState, Textarea, InputState, Input, ScrollHandle, Scrollbar } from "gpui-base";
import { appHome, home, readTextFile, writeTextFile, watchFolder, theme, run as rawRun, exec as rawExec, props, openOverlay as rawOpenOverlay, closeOverlay, notify as rawNotify, setShared as rawSetShared, shared, layout, window, spaces, panes, terminals, hc as rawHc, settings, machines } from "herdr";
import { counted, plainError, statusWord, errorDiagnostic } from "./rig-words.js";
import {activationPair} from './rig-activation.js';
import {SeatTypingGuard,typingGuardReview,TYPING_GUARD_UNSUPPORTED,TYPING_GUARD_TIP} from './rig-typing-guard.js';
import { errorBlock, errorNotice } from "./rig-error-view.js";
const notify = value => errorNotice(rawNotify, value);
import { gatedFetch, gatedExec, gatedHc, gatedRun, gatedConnect, observeConfig, gateSameConfig, gateGeneration, CONFIG_CHANGED_OPEN, GateRefusal, gatedOperation, numberedConfigReads } from "./rig-gate.js";
// A gate refusal is the answer, not a failure to swallow: the person is told it before the menu closes.
const sayRefusal = (error) => { if (error?.code === "GATE_REFUSED") notify({ title: "OpenRig", body: error.message, level: "warning" }); };
// THE SEND GATE (rig-gate.js): every request, CLI run, process-starting Herdr command and stream connection below goes through it, checked at send time.
const exec = (command, args, options) => gatedExec(rawExec, command, args, options, undefined, undefined, appHome());
const hc = (args, bytes) => gatedHc(rawHc, args, bytes);
// A Rig sidebar command (`rig.<command>`) is sent only while the Rig sidebar is in the layout (rig-lib sidebarRun): without it,
// herdr would answer with a raw "unknown command" toast, so a person is told plainly and a background refresh is skipped.
const run = (name, args) => sidebarRun({ layout, notify }, (n, a) => gatedRun(rawRun, n, a), name, args);
const refreshSidebar = () => { if (layoutShowsMod(layout(), MOD_IDS.sidebar)) run("rig.refresh"); };
const sidebarShownOrGuidance = command => {
  const refusal = sidebarRefusal(layout(), command);
  if (refusal) notify({ title: refusal, level: "info" });
  return !refusal;
};
// Refuse before publishing: a hidden sidebar cannot consume the queued dismissal.
const requestVisibleDismissal = (scope, action, value) => {
  if (!sidebarShownOrGuidance("rig.update-action")) return;
  requestDismissal({ shared, setShared, run, scope }, action, value);
};
// A send for a CONNECTION names its gate scope (several OpenRigs: a bare sink refuses). `config` is that connection's own config.
import { installHerdrTransport } from "./rig-openrig-wire.js";
const execFor = (config) => (command, args, options) => gatedExec(rawExec, command, args, options, undefined, config?.connectionId, appHome());
const fetchFor = (config) => (url, init) => gatedFetch(url, init, undefined, config?.connectionId);
const hcFor = (config) => (args, bytes) => gatedHc(rawHc, args, bytes, undefined, config?.connectionId);
const runFor = (config) => (name, args) => sidebarRun({ layout, notify }, (n, a) => gatedRun(rawRun, n, a, config?.connectionId), name, args);

let flatOwner = null; // the view this mod copy is acting for
const setShared = rawSetShared; // several connections key their own state (qualifyKey); no flat-store guard
const openOverlay = (spec) => rawOpenOverlay(messageDialogSpace(stampRows(spec, props()?.target?.rowsConfig ?? null))); // a dialog opened from a menu keeps the stamp of the target it was opened for
import { MOD_IDS, sidebarRun, sidebarRefusal, NO_PERSON, ACTION_REFUSED, parseConfig, discoverDaemonFromCli, writeCommand, readCommand, personDisableReason, pauseSummary, pauseOutcome, resumeOutcome, sliceForSeat, draftKey, iconsAt, transcriptPath, isTerminalSeat,
  fileEntry, launchSpecArgs, launchSpecEnv, launchFolderProblem, launchSourceProblem, LAUNCH_DIALOG_HEIGHT, navPush, actionArgs, appHomeArgsRefusal, writeOutcome, actionTitle, doneWords, startOneClick,
  autoGridForSeats, presetGrid, gridPlaceSeat, gridClearCell, gridRemoveCell, gridSplitCell, gridSeats, gridShells, gridPanes, gridFind, cloneGrid, isPad, isShell, cellLabel,
  reflowDesignerGrid, classifyDropZone, gridDockCell, resizeSiblingWeights,
  SWAP_RUNTIMES, changeModelPlan, filterAllowedModels,
  viewsPropsFromLayout, hasRigWorkStack, openOrFocusRigTab, closeRigInspection, selectWorkerView,
  currentCapabilities, connectionCapabilities, capabilityDisableReason, isRigStopped, seatClickTarget, seatOrigin, seatSharedOf, SEAT_NAME_SHARED, attachToSeat, resetGroupOrder, submitMissionActions, missionActionPreflight, attachRelayPath, waitWith, layoutShowsMod, isLoopbackDaemonUrl,
  statusMarkElement, deleteOutcome, rigNameProblem, newRigFromSpecArgs, newRigOneSeatArgs, commandLine, NEW_RIG_RUNTIMES,
  readRigSpecPreview, singleLineText } from "./rig-lib.js";

/** This folder, for its own icons: derived from `MOD_IDS.menu` so a 1-line rename in `MOD_IDS` updates both cross-mod opens and icons. */
const ASSETS = `mods/${MOD_IDS.menu}`;
const icon = iconsAt(ASSETS);

const STACK = "rig-work", PAGE = "rig-page";
// An open menu has no config watcher and keeps the config it loaded: a connections list installed later is only seen when something reads the file. Opening a Rig page
// (a Herdr UI command the send gate does not stop) reads it first.
// With several connections a page opened from a row belongs to the row's connection (its target names it): the page reads and acts on that OpenRig, not the first one. One connection: untouched.
const stamped = (entry) => { const conn = props()?.target?.conn; return entry && conn && !entry.conn && (flatOwner?.config?.connections ?? []).length > 1 ? { ...entry, conn } : entry; };
/** `from`: the page a Rig page's own dropdown (its Location crumbs, Sections) was opened on. A choice there is a click on that page, like its links and tabs:
 *  a page of the rig on screen stays there, and it never makes a space. Without it the choice is an explicit open. */
const page = async (entry0, from = null, sourceTab = null) => {
  const entry = stamped(entry0);
  setShared("rig.nav", navPush(shared("rig.nav"), entry)); // as before: the page the person asked for is where the Rig page goes when it opens
  const fresh = await freshFileConfig();
  if (fresh.configInvalid) { notify({ title: "OpenRig", body: fresh.configInvalid, level: "warning" }); return { ok: false, reason: fresh.configInvalid }; }
  return openOrFocusRigTab({ run, spaces, panes, layout, section: entry?.section ?? "topology", ...(sourceTab ? { sourceTab } : {}), ...(from ? { fromPage: true, fromEntry: from } : { mayCreate: true }) }, entry);
};
/** A one-click action's dialog: the title, a two-line error and its hint, Retry and the footer fit unclipped. */
const RESULT_HEIGHT = 240;
/** What a shell or launcher prints when it could not find or run the command (exit 127 or 126): nothing ran. */
const LAUNCHER_COULD_NOT_RUN = /not found|no such file|permission denied|cannot execute|not executable/i;
const receiptUncertain = result => Boolean(result?.uncertain || result?.outcomeUnknown || result?.json?.uncertain || result?.json?.outcomeUnknown);
const knownHeldReceipt = (result, action) => ["send", "queue", "reply"].includes(action) && result?.undelivered === true && !receiptUncertain(result);

/** The seats of a rig by their logical ids, sorted: what a delete confirmation was shown, compared again before a Retry of that delete. */
const seatIdsOf = (nodes) => nodes.map((n) => String(n.logicalId ?? n.canonicalSessionName ?? "")).sort();
/** The host's own wording when its exec timeout ended the child (herdr-app src/mods.rs): the child started and was stopped, so what it was doing may have finished. */
const HOST_STOPPED_CHILD = /took longer than [\d.]+ s( on .+)? and was stopped/;
/** Writes that may have arrived even when they failed (a timeout), or whose form stays on screen: never resent via Retry. */
const RESEND_UNSAFE = new Set(["send", "queue", "reply", "launch-spec", "change-model", "new-rig"]);
/** Reopens this mod as a dialog for a step (input, confirm, result). A click beside it closes it. */
const dialog = (target, step, height = 260) => openOverlay({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height, props: { target, step } });
/** A fresh read of config.json, seen by the send gate. The menu has no config watcher (it is a dialog that opens and closes), so a list installed while
 *  one is open is only seen when something reads the file: every action that sends reads it first. It keeps no address the CLI found
 *  (the file has none), and the gate does not forget the one it knows. */
// Reads are numbered (rig-gate.js numberedConfigReads): only the NEWEST completed read installs (the gate sees it); an older read that lands later returns the installed config.
const configReads = numberedConfigReads();
const freshFileConfig = () => configReads(async () => parseConfig(await readTextFile(`${appHome()}/openrig/config.json`)));
/** Whether config.json still says what it said when this dialog opened, for everything a send acts on: the gate's identity (connection, the file\'s address,
 *  machine, home) and who the action is attributed to and which CLI it runs. (The person and the command stay out of the gate's identity on purpose.) */
/** The rows a menu acts on (a rig, a seat, a pod) were published by the sidebar under the settings it held then (`rig.data.config`). The connection id is the same before and
 *  after an address edit, so a row published under A would resolve to B through this menu's own fresh read of config.json: Pause would stop B's rig of the same name. Until
 *  the sidebar has re-published (the folder watcher or a refresh), such a row is refused. Judged by the gate's identity, so a CLI-found address or a person edit is no change. */
/** A review that could not be read says why when the reason is a plain sentence (a timeout, the helper's own answer, our own read checks,
 *  Herdr's connection), never a raw error and never a guess at the cause; the raw detail goes to Herdr's script log. Nothing was stopped. */
const pauseReviewFailed = (error) => {
  const timeout = parseExecTimeout(error), plain = timeout || error?.plain === true || error?.answered === true || error?.needsConsent === true;
  if (!plain) { logExecError(error); return "OpenRig couldn't show this rig's agents. Nothing was stopped. Close this and try again."; }
  const reason = plainExecError(error, { kind: "read" }).trim();
  return `OpenRig couldn't show this rig's agents: ${reason}${/[.!?]$/.test(reason) ? "" : "."} Nothing was stopped.`;
};
const rowsPublishedUnder = (target, fresh) => {
  if (!target) return null;
  // The rows were read under the settings their PRODUCER stamped on the target: the ROW'S OWN connection identity. Only that stamp is judged, against that connection's fresh config: another
  // connection's edit is no change to it, and a stamp for a connection that is no longer listed refuses (never re-resolved by name).
  const stamp = target.rowsConfig;
  if (!stamp) return null;
  const now = configOfConnection(fresh, stamp.connectionId);
  if (!now) return UNKNOWN_CONNECTION;
  return gateSameConfig(stamp, now) ? null : ROWS_STALE;
};
/** The check for an action that does NOT go through this menu's `write()` (the one-click hand-off to the sidebar, the menu's own Attach) and must stay immediate: the rows are judged
 *  against the settings THIS menu read when it opened (`openedOn`), which needs no new read. A menu opened after an edit holds the new settings while the rows are still the old
 *  ones; a menu opened before it hands the action to the sidebar, which acts under its own settings and rows (consistent) until it re-publishes. Returns the sentence or null. */
const rowRefusalNow = (target) => (flatOwner?.openedOn ? rowsPublishedUnder(target, flatOwner.openedOn) : null);
// Same dialog settings: the gate's identity of the dialog's config, who the action is attributed to, the CLI it runs, and (a dialog for a connection other than the config's own) THAT
// connection's identity: an edit to another connection is no change to it, an edit to its own is.
const sameDialogConfig = (a, b, conn) => gateSameConfig(a, b) && (a.person ?? null) === (b.person ?? null) && JSON.stringify(a.rig ?? null) === JSON.stringify(b.rig ?? null)
  && (!conn || conn === (a.connectionId ?? null) || ((ca, cb) => (!ca && !cb) || (ca && cb && gateSameConfig(ca, cb)))(configOfConnection(a, conn), configOfConnection(b, conn))); // an id listed in neither is the send's own refusal to make
const configNow = async () => {
  const cfg = await freshFileConfig(); // a fresh read of config.json is the current config, whoever holds it
  const gen = gateGeneration(cfg?.connectionId);
  if (cfg.configInvalid) return { ...cfg, daemonMessage: cfg.configInvalid }; // a refused list has no address, from anywhere
  if (cfg.daemonUrl) return cfg;
  const adoptCli = (daemonUrl) => {
    const next = { ...cfg, daemonUrl, daemonUrlSource: cfg.daemonUrlSource ?? "cli" };
    if (flatOwner && (cfg.connections ?? []).length <= 1 && gateGeneration(cfg?.connectionId) === gen) flatOwner.config = next;
    return next;
  };
  // Another mod's shared state may name the daemon only when it's on this machine (loopback).
  const fromShared = sharedLoopbackDaemonUrl(cfg, shared("rig.data"));
  if (fromShared) return adoptCli(fromShared);
  let status;
  try { status = await discoverDaemonFromCli(cfg, exec); }
  catch (error) { if (error?.code === "GATE_REFUSED") return { ...cfg, daemonMessage: error.message }; throw error; } // the settings changed: say so, not "unreachable"
  if (status.reachable && status.daemonUrl) return adoptCli(status.daemonUrl);
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
const oneClick = (requested, action) => {
  // A target the menu REBUILDS for a one-click (Open in herdr, Follow this slice, a worker view ...) names only the fields it needs and would drop the row's settings stamp, so the check below
  // (and the sidebar's) would pass for a row read under earlier settings. It inherits the stamp of the menu target it was built from.
  const stamp = props()?.target?.rowsConfig;
  const target = requested?.rowsConfig || !stamp ? requested : { ...requested, rowsConfig: stamp };
  const refusal = rowRefusalNow(target);
  if (refusal) { notify({ title: "OpenRig", body: refusal, level: "warning" }); return { ok: false, reason: refusal }; }
  return startOneClick({ shared, setShared, run, layout, openOverlay }, target, action);
};

/** The slice folders the daemon knows (`/api/slices`: each with its `slicePath`), by folder name. */
async function slicePaths(config, op = gatedOperation(config?.connectionId)) {
  const r = await op.fetch(`${config.daemonUrl}/api/slices`);
  if (!r.ok) throw new Error(requestFailed("the slice list", r.status));
  const body = await r.json();
  return new Map((body?.slices ?? []).filter((s) => typeof s.slicePath === "string").map((s) => [s.slicePath.split(/[\\/]/).pop(), s.slicePath]));
}

/** The following view the strip shows for a followed target (rig:<name>, slice:<id>), if any. */
function followingFor(view,conn=null,base=null) {
  if((base?.connections?.length??0)>1&&(!conn||!configOfConnection(base,conn)))return null;
  const own=(base?.connections?.length??0)>1&&conn; // with several OpenRigs, the target's own connection's views, never the first's
  const measured=own?shared("rig.data")?.byConnection?.[conn]?.capabilities:shared("rig.capabilities");
  if(measured?.hostWorkerViews){
    const config=own?configOfConnection(base,conn):shared("rig.config"),entry=Object.values(shared("rig.workerViews")??{}).find(e=>e.view===view
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
function complete(target, config) {
  if (!target || !target.rig || target.archived) return target;
  // By id and connection, never by the name of an earlier rig of another OpenRig; a bare name on two OpenRigs finds nothing (the action is then
  // refused for want of a connection, never defaulted).
  const { rig } = pickRig(sharedRigData(config, shared)?.topology ?? [], { rigId: target.rigId, conn: target.conn, name: target.rig });
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
/** The config a READ for a row may run under (Open slice, Open mission): the same fresh checks a send makes before it asks a daemon anything: the config is valid, this menu's settings are unchanged for the row's
 *  connection, the row's own stamp still holds, and the daemon is the ROW'S connection's (never the first one's by default). A row that names no connection (a single-OpenRig setup's older row) keeps the
 *  config the menu has. Throws the gate's sentence on a refusal. */
async function rowConfig(target) {
  const fresh = await freshFileConfig();
  if (fresh.configInvalid) throw new GateRefusal(fresh.configInvalid);
  if (flatOwner?.openedOn && !sameDialogConfig(flatOwner.openedOn, fresh, target?.conn)) throw new GateRefusal(CONFIG_CHANGED_OPEN);
  const stale = rowsPublishedUnder(target, fresh);
  if (stale) throw new GateRefusal(stale);
  if (!target?.conn) { if ((fresh.connections ?? []).length >= 2) throw new GateRefusal(NO_CONNECTION); return configNow(); } // several connections: a row that names none is not the primary's (adoptConnection's rule)
  const conn = targetConnection(fresh, target);
  if (!conn.ok) throw new GateRefusal(conn.reason);
  return conn.config.daemonUrl || conn.config.connectionId !== fresh.connectionId ? conn.config : configNow(); // the config's own connection with no written address: the CLI finds it (one connection only)
}
async function openSlice(target, file = null) {
  let config;
  try { config = await rowConfig(target); } catch (e) { return info(target, errorDiagnostic(e)); }
  if (!config.daemonUrl) return info(target, config.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up').");
  const op = gatedOperation(config.connectionId); // the address above is this operation's: every request below refuses to go once the settings change
  try {
    const get = async (path) => { const r = await op.fetch(`${config.daemonUrl}${path}`); if (!r.ok) throw new Error(requestFailed(requestWhat(path), r.status)); return r.json(); };
    const [rows, scopes] = await Promise.all([get(`/api/queue/list?destinationSession=${encodeURIComponent(target.session)}`), get("/api/scopes?counts=1")]);
    const hit = sliceForSeat(Array.isArray(rows) ? rows : rows?.items ?? [], scopes?.missions ?? []);
    if (!hit) return notify({ title: `${target.logicalId ?? target.session} has no open work naming a slice.`, level: "info" });
    if (!file) return page({ section: "scopes", mission: hit.mission, slice: hit.slice, name: hit.name });
    const folder = (await slicePaths(config, op)).get(hit.slice);
    if (!folder) return info(target, `OpenRig doesn't say where ${hit.name} is on disk.`);
    return page(fileEntry(`${folder}/${file}`, `${file} · ${hit.name}`));
  } catch (e) { info(target, errorDiagnostic(e)); }
}

/** "Open mission…": the project's one mission's card; with several, the Scopes list to pick from. */
async function openMission(target) {
  let config;
  try { config = await rowConfig(target); } catch (e) { return info(target, errorDiagnostic(e)); }
  if (!config.daemonUrl) return info(target, config.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up').");
  try {
    const r = await fetchFor(config)(`${config.daemonUrl}/api/scopes?counts=1`);
    const missions = r.ok ? (await r.json())?.missions ?? [] : [];
    return page(missions.length === 1 ? { section: "scopes", mission: missions[0].mission, name: missions[0].mission } : { section: "scopes" });
  } catch (e) { info(target, errorDiagnostic(e)); }
}

export default class RigMenu extends View {
  // The send gate watches this mod's config: every assignment (a reload, a test) is seen at once; null is a constructor's placeholder.
  get config() { return this._config; }
  set config(value) { this._config = value; observeConfig(value); syncRetainedOrigins(value); this.herdr?.observe?.(value); } // its own Herdr transport forgets a changed connection's helper and cursor
  init(_p, cx) {
    // OpenRigs over Herdr's connection (herdr:// addresses): the menu's own reads and writes (a pause's review, archive, delete, a new rig) go through
    // the pinned helper on that machine, like the sidebar's and the page's; without this they could never reach a switched OpenRig.
    this.herdr = installHerdrTransport({ execFor: (scope) => execFor({ connectionId: scope }), hcFor: (scope) => hcFor({ connectionId: scope }), machines, wait: waitWith(cx), appHome, readTextFile, writeTextFile, config: () => this.config,
      bridgePath: () => attachRelayPath(appHome(), MOD_IDS.menu).replace(/rig-attach-relay\.cjs$/, "rig-openrig-transport.cjs") });
    const routingConfig = (conn) => conn && this.config ? (configOfConnection(this.config, conn) ?? { configInvalid: UNKNOWN_CONNECTION }) : this.config;
    registerRigRouting(cx, (context, conn) => { const cfg = routingConfig(conn); return { shared, setShared, run: runFor(cfg), spaces, panes, terminals, hc: hcFor(cfg), layout, notify, openOverlay,closeOverlay,config: cfg, currentConfig: () => routingConfig(conn), wait: waitWith(context) }; });
    this.config = null;
    this.gone = false;
    flatOwner = this;
    this.busy = null;
    this.result = null;
    this.handle = cx.focus_handle?.() ?? null;
    this.menuIndex = -1;
    this.menuScroll = ScrollHandle.new();
    if(!props()?.step)this.handle?.focus?.();
    this.typing = false;
    const step = props()?.step;
    this.swapLeadPending = step?.action === "change-model";
    if(step){
      cx.bind_keys?.([{keystroke:'tab',action:'rig-dialog-next',context:'RigDialog'},{keystroke:'shift-tab',action:'rig-dialog-prev',context:'RigDialog'}]);
      this.dialogCancelHandle=cx.focus_handle?.();
      this.dialogConfirmHandle=cx.focus_handle?.();
      this.dialogArchiveHandle=cx.focus_handle?.();
      this.dialogOpenSpaceHandle=cx.focus_handle?.();
      this.heldCopyHandle=cx.focus_handle?.();
      this.heldRowCopyHandle=cx.focus_handle?.();
      this.heldTextHandle=cx.focus_handle?.();
      cx.bind_keys?.([{keystroke:'tab',action:'rig-held-next',context:'RigHeldText'},{keystroke:'shift-tab',action:'rig-held-prev',context:'RigHeldText'},{keystroke:'escape',action:'rig-held-close',context:'RigHeldText'}]);
      // Made here, with the dialog, never after an await below: a handle made there would belong to whichever view drained the promise jobs.
      this.dialogRetryHandle=cx.focus_handle?.();
      this.dialogCopyHandles=Object.fromEntries(['Folder','SHA-256','Command'].map(label=>[label,cx.focus_handle?.()]));
    }
    cx.spawn(async (cx) => {
      // The daemon's address as the other mods find it (config.json, a loopback address in shared state, then the CLI),
      // so Attach and Retry work without the sidebar too.
      try {
        this.openedOn = await freshFileConfig(); // what config.json said when this dialog opened: a later send compares against it
        this.config = await configNow();
      } catch (error) {
        if (this.gone) return;
        this.swapLeadPending = false;
        const text = errorDiagnostic(error);
        this.result = { ok: false, text };
        notify({ title: "Couldn't read OpenRig settings", body: text, level: "warning" });
        cx.notify(); return;
      }
      if (this.gone) return;
      if (step?.action === "change-model" && !this.swapRequest) {
        this.queueSwapCatalog(complete(props().target, this.config));
        await this.readSwapCatalogs(cx);
        if (this.gone) return;
      }
      setShared("rig.oldProviderViews",await readOldProviderViews({layout,layouts,readTextFile,currentLayout:()=>shared("layout")},appHome()));
      if(step?.action==='close-old-views'){
        this.oldStripChoices=await oldStripLayouts({layouts,readTextFile},appHome());
        if(this.gone)return;
        this.pendingDialogFocus=()=>this.dialogCancelHandle?.focus?.();cx.notify();
      }
      if(step?.action==="confirm-machine"||step?.action==="setup-machine"||step?.action==="stop-machine"){
        const setupConfig=step.conn?configOfConnection(this.config,step.conn):this.config; // the dialog acts for the connection the review was for
        if(!setupConfig){notify({title:"Machine setup",body:"That OpenRig is no longer in the configuration. Nothing was changed.",level:"warning"});this.dismiss();return;}
        this.machineConfirmationToken=step.action==='confirm-machine'?step.token:null;
        this.setupPanel=new MachineSetupPanel(this.machineSetupHost(cx,setupConfig),setupConfig,step.machine??step.confirmation?.machine,{
          mono:settings()?.font_family??"monospace",copyIcon:icon("rig-copy"),stop:step.action==="stop-machine",
          initialConfirmation:step.action==="confirm-machine"?(step.confirmation??null):null,
          waitingForRig:step.waitingForRig??null,
          continuationText:this.machineConfirmationToken?()=>this.machineContinuationText(step):null,
          cancelHandle:this.dialogCancelHandle,primaryHandle:this.dialogConfirmHandle,retryHandle:this.dialogRetryHandle,
          copyHandles:this.dialogCopyHandles,
          cancel:()=>this.dismiss(),done:(doneCx)=>{
            if(this.completeMachineConfirmation())this.dismiss();
            else doneCx.notify();
          }});
        if(step.action!=="stop-machine")await this.setupPanel.check(cx,Boolean(step.action==="confirm-machine"&&step.confirmation));
        this.pendingDialogFocus=()=>(step.action==='stop-machine'?this.dialogCancelHandle:this.dialogConfirmHandle)?.focus?.();
      }
      if(step?.action==="add-machine"){
        // A machine with no connection yet. The panel works against ONE Herdr machine the person picked, through one gate, and saves only what it checked.
        // With no machine named ("Add a machine…" in System) the person picks one first.
        const makePanel=(machine,picked)=>new AddMachinePanel({...this.machineSetupHost(cx,this.config),exec:machineProbeExec(rawExec,machine),saved:async()=>{refreshSidebar();}},machine,picked,{
          liveConfig:()=>this.config,mono:settings()?.font_family??"monospace",copyIcon:icon("rig-copy"),
          cancelHandle:this.dialogCancelHandle,primaryHandle:this.dialogConfirmHandle,
          copyHandles:{Command:this.dialogCopyHandles?.Command},
          cancel:()=>this.dismiss(),done:()=>{notify({title:"Machine added",body:`Added ${machine}. Its rigs show in the sidebar in its spaces; its first Attach asks you to approve the helper there.`,level:"info"});this.dismiss();}});
        const makeLocalPanel=ownerCx=>new AddLocalPanel({
          ...this.machineSetupHost(ownerCx,this.config),...this.localSetupHost(),
          localProbe:options=>localProbeExec(rawExec,options),
          requestFor:task=>this.machineSetupHost(task,this.config).setupFetch,
          saved:async()=>{refreshSidebar();},
        },{rigArgv:Array.isArray(this.config?.rig)&&this.config.rig.length?this.config.rig:['rig'],mono:settings()?.font_family??'monospace',
          cancelHandle:this.dialogCancelHandle,primaryHandle:this.dialogConfirmHandle,cancel:()=>this.dismiss(),
          done:()=>{notify({title:'Added this computer',body:"This computer's OpenRig is connected again. Its rigs show in the sidebar.",level:'info'});this.dismiss();}});
        if(step.local)this.pendingLocalPanel=makeLocalPanel; // native state is made by this dialog's next draw-set timer
        else if(step.machine){this.setupPanel=makePanel(step.machine,step.picked??null);await this.setupPanel.check(cx);}
        else{
          this.setupPanel=new AddMachineChooser({hc:hcFor(this.config)},{liveConfig:()=>this.config,makePanel,makeLocalPanel,cancel:()=>this.dismiss(),cancelHandle:this.dialogCancelHandle,primaryHandle:this.dialogConfirmHandle});
          await this.setupPanel.load(cx);
        }
      }
      if(step?.action==="remove-connection"){
        const connection=(this.config?.connections??[]).find(c=>c.id===step.id);
        if(!connection){notify({title:"Connections",body:"That connection is no longer in the configuration. Nothing was changed.",level:"warning"});this.dismiss();return;}
        this.setupPanel=new RemoveConnectionPanel({...this.machineSetupHost(cx,this.config),saved:async()=>{refreshSidebar();}},connection,{
          cancelHandle:this.dialogCancelHandle,primaryHandle:this.dialogConfirmHandle,
          cancel:()=>this.dismiss(),done:()=>{notify({title:"Connection removed",body:`Removed ${connection.machine??"the connection"}. Its spaces were left as they are.`,level:"info"});this.dismiss();}});
        this.pendingDialogFocus=()=>this.dialogCancelHandle?.focus?.(); // Cancel is focused first
      }
      // Use Herdr's connection instead of the tunnel, or switch back: one click each, asked here, never automatic.
      if(step?.action==="switch-connection"||step?.action==="switch-back"||step?.action==="approve-helper"){
        const connection=(this.config?.connections??[]).find(c=>c.id===step.id),conn=connection?configOfConnection(this.config,connection.id):null;
        if(!connection||!conn){notify({title:"Connections",body:"That connection is no longer in the configuration. Nothing was changed.",level:"warning"});this.dismiss();return;}
        // Not offered in this version: no dialog, no helper, no approval. Switching back stays available.
        if(step.action==="switch-connection"&&!HERDR_CONNECTION_OFFERED){notify({title:"Connections",body:SWITCH_NOT_OFFERED,level:"warning"});this.dismiss();return;}
        const approveOffered=(this.herdrOffered??HERDR_CONNECTION_OFFERED)===true; // `herdrOffered`: for tests; the release's own value otherwise
        if(step.action==="approve-helper"&&!approveOffered){notify({title:"Connections",body:HERDR_APPROVE_NOT_OFFERED,level:"warning"});this.dismiss();return;}
        const consentFile=`${appHome()}/openrig/openrig-consent.json`;
        // The helper's runs are gated under THIS connection's scope, and its approval lives in its own file (never a spec-save or Attach grant).
        const makeRemote=()=>new RemoteOpenRig({exec:execFor(conn),hc:hcFor(conn),machines,wait:waitWith(cx),appHome:appHome(),writeText:writeTextFile,
          openrigBridgePath:attachRelayPath(appHome(),MOD_IDS.menu).replace(/rig-attach-relay\.cjs$/,"rig-openrig-transport.cjs"),
          readOpenRigConsent:async()=>openrigConsentOf(await readTextFile(consentFile).catch(()=>null),connection.id),
          writeOpenRigConsent:async value=>{const previous=await readTextFile(consentFile).catch(()=>null);return writeTextFile(consentFile,openrigConsentText(previous,connection.id,value).trimEnd(),previous??null);}});
        const back=step.action==="switch-back",approve=step.action==="approve-helper";
        this.setupPanel=new SwitchConnectionPanel(this.machineSetupHost(cx,conn),connection,{direction:approve?"approve":back?"back":"herdr",makeRemote,rig:conn.rig??null,...(approve?{offered:approveOffered,checkOnFirstDraw:true}:{}), // approve: the check starts from the dialog's first draw
          cancelHandle:this.dialogCancelHandle,primaryHandle:this.dialogConfirmHandle,cancel:()=>this.dismiss(),
          done:(_cx,_conn,result)=>{notify(approve?{title:"Helper approved",body:result?.alreadyApproved?`The helper on ${connection.machine} was already approved. Reading its OpenRig again.`:`The helper on ${connection.machine} is approved. Reading its OpenRig again.`,level:"info"}
            :{title:"Connection switched",body:back?`${connection.machine} uses its tunnel again.`:`${connection.machine} now uses Herdr's connection. Its tunnel address is kept for switching back.`,level:"info"});
            refreshSidebar();this.dismiss();}});
        this.pendingDialogFocus=()=>this.dialogCancelHandle?.focus?.(); // Cancel is focused first
      }

      if (step?.action === "resume") await this.loadResumePlan(cx);
      if (step?.action === "change-model") await this.loadSwapRepresentative();
      if (this.gone) return;
      const guardTarget=props()?.target;
      if((!step||step.action==='typing-guard')&&guardTarget?.session&&['seat','cell'].includes(guardTarget.kind)&&!guardTarget.terminal&&!isTerminalSeat(guardTarget)){
        this.typingGuardRefusal=rowsPublishedUnder(guardTarget,this.config);
        const own=this.typingGuardRefusal?{ok:false}:targetConnection(this.config,guardTarget);
        if(own.ok){
          const cfg=own.config;
          const published=sharedRigData(cfg,shared);
          const healthz=published?.byConnection?published.byConnection[cfg.connectionId]?.healthz:published?.healthz;
          this.typingGuard=new SeatTypingGuard({fetch:fetchFor(cfg),exec:execFor(cfg),after:(ms,fn)=>cx.timer.after(ms,fn,{owner:null}),closed:()=>this.gone,
            currentConfig:()=>configOfConnection(this.config,cfg.connectionId),
            sameConfig:(before,after)=>sameDialogConfig(before,after,cfg.connectionId),
            readConfig:async()=>configOfConnection(await freshFileConfig(),cfg.connectionId)},cfg,guardTarget.session,
            {version:healthz?.semver??healthz?.openrigVersion?.semver??null,label:guardTarget.logicalId??guardTarget.session});
          await this.typingGuard.load();
          if(this.gone)return;
        }
        else if(!this.typingGuardRefusal)this.typingGuardRefusal=own.reason??UNKNOWN_CONNECTION;
      }
      cx.notify();
      // A one-click action that failed in the sidebar arrives with its failure, for Retry; without the sidebar one starts
      // once, here: never from render, where notify isn't allowed.
      if (step?.failed) { this.result = step.failed; cx.notify(); } else if (step?.run) this.go(cx, complete(props().target, this.config), step);
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
        field.on("submit", (_e, cx) => { if (!this.result?.ok && !this.busy) this.go(cx, complete(props().target, this.config), props().step); });
      }
      this.dialogFocusedField=this.folder;this.folder.focus();
      this.typing = true;
    }
    if (step?.action === "new-rig") this.initNewRig(cx);
    if (step?.action === "design-view") {
      this.initDesigner(complete(props().target, this.config));
      cx.timer.after(0,nextCx=>{this.dialogConfirmHandle?.focus?.();nextCx.notify();});
    }
    if (step?.action === "change-model") {
      this.initChangeModel(complete(props().target, this.config));
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
      this.input.on("submit", (e, cx) => { if (e?.secondary && this.inputCanSend(props().step)) this.go(cx, complete(props().target, this.config), props().step); });
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
      // The library comes from the OpenRig this dialog was opened for, the one it will launch on (never the first connection's); with several connections and none named, or one that is gone, it says so.
      let config;
      try { config = await rowConfig(props().target); }
      catch (e) {
        this.newSpecs = { error: errorDiagnostic(e) };
        this.pendingDialogFocus=()=>{if(!this.newFocusTouched)this.dialogCancelHandle?.focus?.();};cx.notify(); return;
      }
      if (!config.daemonUrl) { this.newSpecs = { error: config.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start')." }; this.pendingDialogFocus=()=>{if(!this.newFocusTouched)this.dialogCancelHandle?.focus?.();};cx.notify(); return; }
      try {
        const r = await fetchFor(config)(`${config.daemonUrl}/api/specs/library`);
        const body = await r.json();
        const list = Array.isArray(body) ? body : Array.isArray(body?.specs) ? body.specs : [];
        // Rig specs only: an agent spec isn't a `rig up` source.
        this.newSpecs = list.filter((s) => s && (s.name || s.sourcePath) && (!s.kind || s.kind === "rig"));
        this.newSpec=this.newSpecs[0]??null;
      } catch (e) { this.newSpecs = { error: errorDiagnostic(e) }; }
      this.pendingDialogFocus=()=>{if(!this.newFocusTouched&&this.newMode==='spec')(this.newSpec?this.newSpecHandle:this.dialogCancelHandle)?.focus?.();};
      cx.notify();
    });
  }

  /** Clears the shown result for a form change, except after a launch or create that may have gone through: that result (and its way out) stays. */
  forgetResult() { if (!this.uncertainAttempt) this.result = null; }

  pickNewSpec(cx, spec, toggle = false) {
    this.newSpec = spec; this.forgetResult();
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
        const config = await rowConfig(props().target); // the same OpenRig as the library and the launch
        this.newSpecPreviews.set(spec, { data: await readRigSpecPreview(fetchFor(config),config.daemonUrl,spec) });
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
      .child(errorBlock(this,t,"menu-spec-read-error",got.error,{prefix:"Couldn't read this spec: "}))
      .child(div().id("new-rig-spec-retry").text_size(12).text_color(t.accent).cursor_pointer()
        .on_click((_e, cx) => this.loadNewSpecPreview(cx, spec, true)).child("Retry"));
    const data = got.data;
    return v_flex().gap(4)
      .when(!!data.summary, (el) => el.child(div().truncate().text_size(11.5).text_color(t.dim).tooltip(rowTip(data.summary)).child(rowTitle(data.summary))))
      .child(div().text_size(11.5).text_color(t.dim).child(`${data.pods.length} pod${data.pods.length === 1 ? "" : "s"} · ${data.seatCount} seat${data.seatCount === 1 ? "" : "s"}`))
      .children(data.pods.map((pod) => v_flex().gap(2).pt(3)
        .child(div().text_size(11.5).font_semibold().text_color(t.muted).child(pod.label))
        .children(pod.seats.map((seat) => h_flex().gap(6).pl(8).items_center()
          .child(div().min_w(0).truncate().text_size(12).text_color(t.foreground).tooltip(String(seat.lid??"")).child(seat.lid))
          .when(!!seat.runtime || !!seat.model, (el) => el.child(div().px(5).py(1).rounded(4).bg(t.raised).font_family("monospace").text_size(10.5).text_color(t.dim)
            .child([seat.runtime ? statusWord(seat.runtime,"runtime") : null, seat.model].filter(Boolean).join(" · "))))
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
    if (target?.archived) return false;
    return !(isRigStopped(target.lifecycle, this.rigSeats(target)) || target.lifecycle === "stopped");
  }

  /** Archive, the reversible choice beside Delete: a running rig is paused first (`rig down`), then `rig archive`. */
  archive(cx, target) {
    if (this.gone || this.busy || target.rig === "kernel" || !this.reviewReady()) return;
    const reason = capabilityDisableReason("archive-rig", this.caps(target));
    if (reason) { this.result = { ok: false, notSent: true, kind: "archive", text: reason }; cx.notify(); return; } // refused before anything was sent
    const running = this.rigRunning(target);
    const reviewedSeats = this.pauseSeatIds;
    this.run(cx, running ? `Pausing and archiving ${target.rig}` : `Archiving ${target.rig}`, async () => {
      const rosterProblem = await this.checkReviewedRoster(target, reviewedSeats, "archiving");
      if (rosterProblem) return { ok: false, notSent: true, kind: "archive", text: rosterProblem };
      let paused = null;
      if (running) {
        let d;
        try { d = await this.write(this.argsFor(target, "pause")); } catch (e) { if (e && typeof e === "object") e.stage = "pause"; throw e; }
        paused = d.json && "sessionsKilled" in d.json ? pauseOutcome(d.json) : null;
        if (!d.ok && !paused?.ok) {
          // The host stopped the pause at its timeout (or it was killed): it may have paused, so never say it wasn't.
          if (d.uncertain) return { ok: false, uncertain: true, kind: "archive", stage: "pause", paused, text: `${target.rig} may have been paused (OpenRig didn't answer in time), and it wasn't archived. Check the rig list before trying again.` };
          return { ok: false, ...(d.notSent ? { notSent: true } : {}), kind: "archive", paused, text: `${target.rig} wasn't paused, so it wasn't archived: ${d.text || "the CLI gave no reason."}` };
        }
      }
      let a;
      try { a = await this.write(this.argsFor(target, "archive-rig")); }
      catch (e) {
        if (!running) throw e;
        if (isKnownUnsentError(e)) {
          const why = unsentErrorMessage(e).trimEnd().replace(/\s*Nothing was sent\.?$/i, "");
          return { ok: false, kind: "archive", paused, text: `${target.rig} was paused, but it wasn't archived: ${why || "nothing was archived."}` };
        }
        return { ok: false, uncertain: true, kind: "archive", paused, text: `${target.rig} was paused. Archiving ${target.rig} may still have happened (${plainExecError(e, { kind: "read" })}): check the rig list before trying again.` };
      }
      if (a.ok) {
        // Only this OpenRig's pages of the rig: another OpenRig's rig of the same name keeps its pages (an unstamped page matches, as before).
        const sameConn = (entry) => !target.conn || !entry.conn || entry.conn === target.conn;
        const nav = shared("rig.nav");
        if (Array.isArray(nav?.stack)) {
          const stack = nav.stack.filter(entry => !(sameConn(entry) && (entry.rig === target.rig || (target.rigId && entry.rigId === target.rigId) || (entry.kind === "rig" && entry.name === target.rig))));
          setShared("rig.nav", { ...nav, stack: stack.length ? stack : [this.topologyFallback(target)] });
        }
        this.scrubTabPages(target, (entry) => sameConn(entry) && (entry.rig === target.rig || (target.rigId && entry.rigId === target.rigId) || (entry.kind === "rig" && entry.name === target.rig)));
        refreshSidebar();
      }
      // The pause already ran: whatever stopped the archive, "Nothing was sent." would be false, so the result says the pause ran and the archive did not.
      // The host stopped the archive at its timeout (or it was killed): it may have completed, so never say it wasn't archived.
      if (!a.ok && a.uncertain) return { ok: false, uncertain: true, kind: "archive", paused, text: `${running ? `${target.rig} was paused. ` : ""}Archiving ${target.rig} didn't answer in time, so it may have been archived: check the rig list before trying again.` };
      if (running && !a.ok) {
        const { notSent, ...rest } = a;
        const why = String(a.text ?? "").trimEnd().replace(/\s*Nothing was sent\.?$/i, "");
        return { ...rest, kind: "archive", paused, text: `${target.rig} was paused, but it wasn't archived: ${why || "the CLI gave no reason."}` };
      }
      return { ...a, kind: "archive", paused };
    }, { kind: "archive" });
  }

  /** Undo an archive: `rig unarchive`. */
  unarchive(cx, target) {
    const reason = capabilityDisableReason("unarchive-rig", this.caps(target));
    if (reason) { this.result = { ok: false, notSent: true, kind: "unarchive", text: reason }; cx.notify(); return; } // refused before anything was sent
    this.run(cx, `Bringing ${target.rig} back`, async () => {
      const r = await this.write(this.argsFor(target, "unarchive-rig"));
      if (r.ok) { refreshSidebar(); notify({ title: `${target.rig} restored. It's stopped; Resume it from its row.`, level: "info" }); }
      return { ...r, kind: "unarchive", text: r.ok ? `${target.rig} restored. It's stopped; Resume it from its row.` : r.text };
    }, { dismissOnSuccess: true, kind: "unarchive" });
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
    this.swapModel = this.swapCurModel;
    this.swapEffort = this.swapCurEffort;
    this.swapCatalog = { status: "loading" };
    this.swapModelInput = InputState.new({ placeholder: "Model ID", value: "" });
    this.swapModelInput.on("change", (_event, cx) => {
      this.swapManual = true;
      this.selectSwapModel(this.swapModelInput.value().trim() || null);
      cx.notify();
    });
    this.swapConfirmed = false;
    this.swapError = null;
  }

  selectSwapModel(model) {
    if (this.swapModel !== model) this.swapEffort = null;
    if (model === this.swapCurModel && this.swapRuntime === this.swapCurRuntime) this.swapEffort ??= this.swapCurEffort;
    this.swapModel = model;
    this.swapError = null;
  }

  queueSwapCatalog(target) {
    this.swapCatalog = { status: "loading" };
    this.swapRequest = { target, runtime: this.swapRuntime };
  }

  refreshSwapCatalog(cx, target) {
    this.queueSwapCatalog(target);
    cx.notify();
    cx.spawn(task => this.readSwapCatalogs(task));
  }

  async readSwapCatalogs(cx) {
    if (this.swapReading) return;
    this.swapReading = true;
    try {
      while (!this.gone && this.swapRequest !== this.swapRead) {
        const request = this.swapRead = this.swapRequest;
        const result = await this.loadSwapCatalog(request);
        if (!this.gone && this.swapRequest === request) {
          this.swapCatalog = result;
          const current = this.swapRuntime === this.swapCurRuntime;
          const selected = result.models?.find(model => model.id === this.swapModel);
          if (!this.swapManual && !selected && (!current || this.swapModel !== this.swapCurModel)) {
            this.swapModel = current ? this.swapCurModel : null;
          }
          const levels = selected?.efforts ?? result.runtimeEfforts;
          if (!levels?.includes(this.swapEffort)) {
            this.swapEffort = current && this.swapModel === this.swapCurModel ? this.swapCurEffort : null;
          }
          cx.notify();
        }
      }
    } finally {
      this.swapReading = false;
    }
  }

  async loadSwapCatalog({ target, runtime }) {
    const unavailable = reason => ({ status: "unavailable", reason });
    const source = ({ codex:"codex-cache", "claude-code":"claude-help", pi:"pi-cli", omp:"omp-cli" })[runtime];
    if (!source) return unavailable("This harness doesn't expose a supported model list.");
    const own = targetConnection(this.config, target);
    if (!own.ok) return unavailable("The seat's OpenRig connection couldn't be resolved.");
    const cfg = own.config;
    if (cfg.daemonMachine || !cfg.daemonUrl || !isLoopbackDaemonUrl(cfg.daemonUrl)) {
      return unavailable("The list is only read on this computer.");
    }
    try {
      const op = gatedOperation(cfg.connectionId);
      let accountHome = source === "claude-help" ? home() : undefined;
      if (source !== "claude-help") {
        if (runtime !== this.swapCurRuntime || !target.session) return unavailable("The target harness's account home isn't known.");
        const response = await op.fetch(`${cfg.daemonUrl}/api/seat/status/${encodeURIComponent(target.session)}`);
        if (!response.ok) return unavailable("OpenRig couldn't read the seat's account home.");
        const seat = await response.json();
        const reported = seat.runtime_home;
        const variable = runtime === "codex" ? "CODEX_HOME" : "PI_CODING_AGENT_DIR";
        if (seat.current_occupant !== target.session || seat.runtime !== runtime
          || (target.rigId && seat.rig_id !== target.rigId)
          || (target.logicalId && seat.logical_id !== target.logicalId)
          || reported?.variable !== variable || reported.ignored || typeof reported.home !== "string"
          || !reported.home.startsWith("/")) return unavailable("OpenRig didn't report this seat's account home.");
        accountHome = reported.home;
      }
      if (this.gone || this.swapRuntime !== runtime) return unavailable("The harness changed.");
      const helper = attachRelayPath(appHome(), MOD_IDS.menu)?.replace(/rig-attach-relay\.cjs$/, "rig-model-catalog.cjs");
      if (!helper) return unavailable("The installed catalog reader couldn't be located.");
      op.check();
      const result = await execFor(cfg)("env", ["-i", "PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        "LANG=C.UTF-8", "node", helper, source, ...(accountHome ? [accountHome] : [])], { timeout: 10000 });
      op.check();
      if (result.code !== 0 || typeof result.stdout !== "string" || result.stdout.length > 1024 * 1024) {
        return unavailable("The local catalog reader didn't return a list.");
      }
      const list = JSON.parse(result.stdout);
      if (list?.status === "ready" && Array.isArray(list.models)) {
        return { ...list, ...(source === "codex-cache" ? { watchHome:accountHome } : {}) };
      }
      return unavailable(typeof list?.reason === "string" ? singleLineText(list.reason).slice(0, 160) : "The local list wasn't readable.");
    } catch {
      return unavailable("The local list couldn't be checked.");
    }
  }

  watchSwapCatalog(cx, target) {
    const watchHome = this.swapCatalog?.watchHome;
    if (!watchHome || this.swapWatchedHome === watchHome) return;
    this.swapWatchedHome = watchHome;
    cx.timer.after(0, next => {
      if (this.gone) return;
      next.spawn(async task => {
        while (!this.gone && this.swapWatchedHome === watchHome) {
          let files;
          try { files = await watchFolder(watchHome); } catch { return; }
          if (this.gone || this.swapWatchedHome !== watchHome) return;
          if (this.swapRuntime === "codex" && files.some(file => file === "models_cache.json" || file === `${watchHome}/models_cache.json`)) {
            this.queueSwapCatalog(target);
            task.notify();
            await this.readSwapCatalogs(task);
          }
        }
      });
    });
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
    Promise.resolve(r).catch(sayRefusal).then(() => { this.pending = null; this.dismiss(); });
  }

  /** A page-navigation choice: open the page, THEN close the popup (herdr drops a closed popup's runtime, and page() now reads the config first). One at a time. */
  navigate(entry, cx) {
    if (this.pending) return;
    this.pending = "Opening";
    const target = props()?.target, from = target?.kind === "page-navigation" && target.from && typeof target.from === "object" ? target.from : null;
    const sourceTab = from && typeof target?.sourceTab === "string" ? target.sourceTab : null; // the Rig tab the dropdown was opened on
    Promise.resolve(page(entry, from, sourceTab)).catch(sayRefusal).then(() => { this.pending = null; this.dismiss(); });
  }

  /** A step that sends something was still running when this dialog closed (Esc, a click beside it, a reload). herdr drops a closed dialog's tasks, so the step's
   *  result is never seen: a failed send would lose the typed text with no word. Said once, in words, with the start of what was typed so a send that did not go can be typed again. The text is
   *  deliberately NOT kept as a draft: a send that did go through must not come back to be sent twice. */
  sayInFlight() {
    const running = this.running;
    if (!running) return;
    this.running = null; // `busy` stays set: keepDraft() then keeps nothing, as before
    // A notice that cannot be shown must never skip the teardown that follows (herdr may be tearing down right now): everything below stays inside this guard.
    try {
      const typed = this.input ? String(this.input.value() ?? "").replace(/\s+/g, " ").trim() : "", said = typed.length > 60 ? `${typed.slice(0, 57)}...` : typed;
      const quote = said ? ` You typed: "${said}".` : "";
      notify({ title: "OpenRig", level: "warning", body: running.action === "replace-viewer"
        ? "The Attach viewer was still being replaced when you closed this. The old one may be stopped without a new one started: check the seat's tab, and Attach again if it is gone."
        : `What you started (${String(running.label).toLowerCase()}) was still going when you closed this. It may still go through: check before you do it again.${quote}` });
    } catch (_) { /* nothing more can be said */ }
  }

  releaseCompactionReview() {
    const step=props()?.step;
    if(step?.action!=='confirm-seat-compaction'||!step.token||this.compactionConfirmed||this.compactionReviewReleased)return;
    this.compactionReviewReleased=true;
    setShared('rig.compactionDecisions',{...(shared('rig.compactionDecisions')??{}),[step.token]:'cancel'});
  }

  dismiss(discard = false) {
    this.releaseCompactionReview();
    this.sayInFlight();
    this.gone = true;
    this.resumeRollCallTimer?.cancel?.();this.resumeRollCallTimer=null;
    this.cancelSpecPermission();
    if (discard) this.dropDraft(); else this.keepDraft();
    const id = props()?.overlay; if (id) closeOverlay(id);
  }

  /** The page left when pruning a rig's pages empties the history: Topology, stamped with the OpenRig the archive or delete ran on when several
   *  are set up (an unstamped page names no OpenRig there, and a later link from it would push another unstamped one). A connection that is set up
   *  is named even before it can run a command (no address or home written yet); one that isn't stays unstamped rather than guess one. */
  topologyFallback(target) {
    const connections = this.config?.connections ?? [];
    if (connections.length <= 1) return { section: "topology" };
    const id = target?.conn;
    return typeof id === "string" && connections.some((c) => c?.id === id) ? { section: "topology", conn: id } : { section: "topology" };
  }
  machineContinuationText(step) {
    if(shared("rig.machineSetupToken")!==this.machineConfirmationToken)return "The original action is no longer waiting. Repeat the original action from the Rig sidebar.";
    if(!layoutShowsMod(layout(),MOD_IDS.sidebar))return "Show the Rig sidebar, then choose Done to continue.";
    return step.continuationText??"What you started continues when you close this.";
  }

  completeMachineConfirmation({closing=false}={}) {
    const token=this.machineConfirmationToken;
    if(this.gone||this.machineConfirmationEmitted||!token)return true;
    const ownsAction=shared("rig.machineSetupToken")===token;
    const visible=layoutShowsMod(layout(),MOD_IDS.sidebar);
    if(!ownsAction||!visible){
      if(closing||!ownsAction)notify({title:`${this.setupPanel?.machine??this.setupPanel?.config?.daemonMachine??'Machine'} is set up`,
        body:visible?"Repeat the original action from the Rig sidebar.":"The Rig sidebar is hidden. Show it and repeat the original action.",level:"info"});
      return !ownsAction;
    }
    this.machineConfirmationEmitted=true;
    setShared("rig.machineConfirmation",token);
    run("rig.confirm-machine");
    return true;
  }

  async close() {
    this.resumeRollCallTimer?.cancel?.();this.resumeRollCallTimer=null;
    // Herdr's reserved Escape closes the overlay before a panel key handler runs.
    this.releaseCompactionReview();
    // Treat only a settled successful approval as Done; a busy close is cancellation.
    if(this.setupPanel?.phase==='done'&&!this.setupPanel.busy&&!this.setupPanel.followUpBusy)this.completeMachineConfirmation({closing:true});
    this.sayInFlight(); try { this.herdr?.release?.(); } catch (_) {} this.gone = true; releaseFocusTargets(this);
    for(const release of this.machinePreparationReleases??[])release();
    this.machinePreparationReleases?.clear();
    this.machineQueueTimer?.cancel?.();this.machineQueueTimer=null;
    this.compactionStartTimer?.cancel?.();this.compactionStartTimer=null;
    if(this.compactionStarting){
      const token=props()?.step?.token,all={...(shared('rig.compactionDecisions')??{})},record=all[token];
      if(record){
        if(record.dispatched)delete all[token];
        else all[token]={...record,status:'expired'};
        setShared('rig.compactionDecisions',all);
      }
    }
    for(const ticket of this.machineQueueWaits??[])ticket.reject(new Error('This machine setup was closed. No further action was started.'));
    this.machineQueueWaits?.clear();
    this.heldCopyTimer?.cancel?.(); this.setupPanel?.expire?.();this.dialogBoundaryTask?.cancel?.();this.setupPanel?.focusTask?.cancel?.();this.dialogHandleTask?.cancel?.();for(const handle of this.dialogButtonHandles??[])handle.release?.();this.cancelMenuReveal?.();this.cancelSpecReveal?.();this.newSpecScroll?.release?.(); this.menuScroll?.release?.(); this.cancelSpecPermission(); this.keepDraft();
  }

  cancelSpecPermission() {
    const step=props()?.step;
    if(step?.action==="adopt-address-space"&&step.token){
      const decided=shared("rig.spaceAdoptionDecisions")??{};
      if(!decided[step.token])setShared("rig.spaceAdoptionDecisions",{...decided,[step.token]:"cancel"});
      return;
    }
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
    if (!this.draft || !this.input || this.busy || this.result?.ok || knownHeldReceipt(this.result, props()?.step?.action)) return;
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

  /** The config an action may send under: this dialog's own, but only while config.json still says the same (a list or another address typed since the
   *  dialog opened refuses; the dialog's connection is not used for a send after that). */
  async currentConfig() {
    const fresh = await freshFileConfig();
    if (fresh.configInvalid) throw new GateRefusal(fresh.configInvalid);
    if (this.openedOn && !sameDialogConfig(this.openedOn, fresh, props()?.target?.conn)) throw new GateRefusal(CONFIG_CHANGED_OPEN);
    const stale = rowsPublishedUnder(props()?.target, fresh);
    if (stale) throw new GateRefusal(stale);
    return this.config ?? configNow();
  }

  /** Runs one CLI write as the person; returns { ok, json, text, warning }, plus `uncertain: true` when it may have finished without us hearing, `notSent: true` only on a pre-send refusal, or `undelivered: true` when OpenRig recorded/retained it without delivery. Only a pre-send refusal re-arms Send. */
  async write(args, options, cx) {
    if (this.gone || !args) return { ok: false, notSent: true, text: ACTION_REFUSED };
    const fresh = await freshFileConfig();
    if (this.gone) return { ok: false, notSent: true, text: ACTION_REFUSED };
    if (fresh.configInvalid) return { ok: false, notSent: true, text: fresh.configInvalid }; // a list installed while this dialog was open
    if (this.openedOn && !sameDialogConfig(this.openedOn, fresh, props()?.target?.conn)) return { ok: false, notSent: true, text: CONFIG_CHANGED_OPEN }; // the connection below is the one this dialog opened on
    const staleRows = rowsPublishedUnder(props()?.target, fresh);
    if (staleRows) return { ok: false, notSent: true, text: staleRows }; // the row is from the old address, the connection below would resolve it to the new one
    // The connection is the target's own, from the row it came from: never a default. Without one nothing is sent.
    const conn = targetConnection(this.config, props()?.target);
    if (!conn.ok) return { ok: false, notSent: true, text: conn.reason };
    const homeRefusal = appHomeArgsRefusal(conn.config, args); // this computer's app home never goes to a list-added machine's daemon
    if (homeRefusal) return { ok: false, notSent: true, text: homeRefusal };
    const target=props()?.target;
    if(target?.kind==='assistant'){
      if(args[0]!=='queue'||args[1]!=='create'||args[args.indexOf('--destination')+1]!==target.session)return{ok:false,notSent:true,text:'Connected assistants only accept queued work.'};
      const verified=await verifyAssistantTarget(fetchFor(conn.config),conn.config,target,cx?.timer?(ms,done)=>cx.timer.after(ms,done,{owner:null}):null);if(!verified.ok)return{ok:false,notSent:true,text:verified.reason};
      // The roster await can outlive a config-file edit; observing it here also updates the send gate.
      const afterVerify=await freshFileConfig();
      if(this.gone)return{ok:false,notSent:true,text:ACTION_REFUSED};
      if(afterVerify.configInvalid)return{ok:false,notSent:true,text:afterVerify.configInvalid};
      if(!sameDialogConfig(this.openedOn??fresh,afterVerify,props()?.target?.conn))return{ok:false,notSent:true,text:CONFIG_CHANGED_OPEN};
    }
    const cmd = writeCommand(conn.config, args, options);
    if (!cmd) return { ok: false, notSent: true, text: NO_PERSON };
    // Uncertain = the CLI may have run to the end without us hearing. Only what the HOST reports says so: its exec rejects with "<cmd> took longer than N s and was stopped" when its own timeout ends the child, and
    // reports code -1 for a child killed by a signal (or a remote result with no code). A message the CLI printed is not evidence about whether it left. A host that could not start the CLI ("cannot run ...") is not uncertain: nothing ran.
    let raw;
    try { raw = await execFor(conn.config)(cmd.command, cmd.args, { timeout: 180000 }); } catch (e) {
      if (!isKnownUnsentError(e) && HOST_STOPPED_CHILD.test(String(e?.message ?? e))) { logExecError(e); return { ok: false, uncertain: true, text: "OpenRig didn't answer in time." }; }
      throw e;
    }
    const out = writeOutcome(raw);
    if (!out.ok && (raw?.code === 127 || raw?.code === 126) && !String(raw?.stdout ?? "").trim() && LAUNCHER_COULD_NOT_RUN.test(String(raw?.stderr ?? ""))) return { ...out, notSent: true }; // the shell could not find or run `rig` (its own words on stderr): nothing ran. A bare 127 from a child `rig` forwards is not enough
    return !out.ok && (raw?.code == null || raw.code === -1) ? { ...out, uncertain: true } : out;
  }

  async read(args) {
    // Pin this machine on Retry's `ps` re-read so a saved remote `host.selected` never queries another host.
    const fresh = await freshFileConfig();
    if (fresh.configInvalid) return null; // a list installed while this dialog was open
    if (this.openedOn && !sameDialogConfig(this.openedOn, fresh, props()?.target?.conn)) return null; // the settings changed since this dialog opened: its connection is stale
    if (rowsPublishedUnder(props()?.target, fresh)) return null;
    const conn = targetConnection(this.config, props()?.target);
    if (!conn.ok) return null;
    const cmd = readCommand(conn.config, [...args, "--json"], { env: ["OPENRIG_HOST_SELECTED=local"] });
    const r = await execFor(conn.config)(cmd.command, cmd.args, { timeout: 60000 });
    try { return JSON.parse(r.stdout); } catch (_) { return null; }
  }

  /** Runs one step of a dialog on its own task. `kind` names the step: it is on EVERY result, including one built from a throw, so the dialog always knows which step a failed result came from (a Retry re-runs that step and no other). */
  run(cx, label, work, { dismissOnSuccess = false, kind = null } = {}) {
    if (this.gone) return;
    this.busy = label; this.result = null; this.running = { label, action: props()?.step?.action ?? null }; cx.notify(); // `running`: a step that sends, said if this closes first (sayInFlight)
    cx.spawn(async (cx) => {
      if (this.gone) { this.busy = null; this.running = null; return; }
      try { this.result = await work(cx); } catch (e) {
        // A refusal raised BEFORE anything left (an undispatched gate refusal, a transport/consent/host refusal before the write ran, or a host that could not start the CLI) is known unsent.
        // One raised after the send, and any other throw, is not known either way: `uncertain` keeps a launch or create from being offered again (the menu's launch and new rig read it).
        const unsent = isKnownUnsentError(e);
        const msg = unsent ? unsentErrorMessage(e) : plainExecError(e, { kind: "read" });
        this.result = { ok: false, text: msg, ...(kind ? { kind } : {}), ...(e?.stage ? { stage: e.stage } : {}), ...(unsent ? { notSent: true } : { uncertain: true }) };
      }
      this.running = null;
      if (this.gone && this.result?.notSent) { this.busy = null; this.result = null; return; }
      // Sent: the draft is done with. Not sent: it stays, for a retry from the menu.
      // A launch or create that may have gone through is remembered for this dialog: a form change (a spec pick, the mode) clears the result but never this.
      if (this.result && !this.result.ok && this.result.uncertain) this.uncertainAttempt = true; // read only by launch and new rig (a dialog has one action)
      if (this.result?.ok || knownHeldReceipt(this.result, props()?.step?.action)) this.dropDraft();
      this.busy = null;
      if (this.gone) return;
      if (dismissOnSuccess && this.result?.ok) { this.dismiss(); return; }
      cx.notify();
      if(this.dialogCancelHandle)this.pendingDialogFocus=()=>{
        if(this.gone)return;
        const openSpace=props()?.step?.action==='new-rig'&&this.result?.ok&&typeof this.result?.createdRig==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(this.result.createdRig);
        (openSpace?this.dialogOpenSpaceHandle:this.dialogCancelHandle)?.focus?.();
      };
      if(props()?.step?.action==='resume'&&this.result?.json?.status==='restored')await this.loadResumeRollCall(cx);
    });
  }

  async loadPause(cx) {
    this.pause = null; this.pauseSeatIds = null; // A new review cannot reuse an earlier successful result while its read is pending.
    cx.notify();
    cx.spawn(async (cx) => {
      const t = complete(props().target, this.config);
      // The confirmation shows the target's own daemon's seats (the write goes there too), never the default one's.
      let conn;
      try { conn = targetConnection(await this.currentConfig(), t); } catch (e) { this.pause = { error: errorDiagnostic(e) }; cx.notify(); return; }
      if (!conn.ok) { this.pause = { error: conn.reason }; cx.notify(); return; }
      const config = conn.config;
      if (!config.daemonUrl) { this.pause = { error: config.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up')." }; cx.notify(); return; }
      try {
        const r = await fetchFor(config)(`${config.daemonUrl}/api/rigs/${encodeURIComponent(t.rigId)}/nodes`);
        if (!r.ok) throw Object.assign(new Error(r.status === 404 ? "this OpenRig has no such rig now; it may have been removed or archived" : `OpenRig answered with error ${r.status}`), { plain: true });
        const nodes = await r.json();
        if (!Array.isArray(nodes)) throw Object.assign(new Error("OpenRig's answer wasn't a list of seats"), { plain: true });
        this.pause = pauseSummary(nodes); this.pauseSeatIds = seatIdsOf(nodes);
      } catch (e) {
        // A review that could not be read says so in a plain sentence and leaves its action disabled: the person cannot approve what they cannot see. A settings change already has its own sentence.
        this.pause = { error: e?.code === "GATE_REFUSED" ? String(e.message) : pauseReviewFailed(e) };
      }
      cx.notify();
    });
  }

  async readResumePlan(target, reviewedConfig = null) {
    const root = await this.currentConfig();
    if (reviewedConfig && !sameDialogConfig(reviewedConfig, root, target.conn)) throw new Error(CONFIG_CHANGED_OPEN);
    const conn = targetConnection(root,target);
    if (!conn.ok) throw new Error(conn.reason);
    const plan = await readRestorePlan({exec:execFor(conn.config),fetch:fetchFor(conn.config)},target,conn.config);
    if (!sameDialogConfig(root, await this.currentConfig(), target.conn)) throw new Error(CONFIG_CHANGED_OPEN);
    return {plan, root};
  }

  async loadResumePlan(cx) {
    const ticket=this.resumePlanTicket={};this.resumePlan={loading:true};cx.notify();
    try{
      const {plan, root}=await this.readResumePlan(complete(props().target,this.config));
      if(this.gone||this.resumePlanTicket!==ticket)return;
      this.resumePlan=plan;this.resumePlanConfig=root;
    }catch(error){if(!this.gone&&this.resumePlanTicket===ticket)this.resumePlan={error:plainExecError(error,{kind:'read'})};}
    if(!this.gone&&this.resumePlanTicket===ticket)cx.notify();
  }

  resetResumeRollCall() {
    this.resumeRollCallTimer?.cancel?.();this.resumeRollCallTimer=null;
    this.resumeRollCall=null;this.resumeRollCallTicket=null;
    this.resumeRollCallAutoUsed=false;this.resumeRollCallAutoPending=false;
    this.resumeRollCallEpoch={};
  }

  async loadResumeRollCall(cx) {
    if(this.gone)return;
    const ticket=this.resumeRollCallTicket={};this.resumeRollCall={loading:true};cx.notify();
    try{
      const target=complete(props().target,this.config),root=await this.currentConfig(),conn=targetConnection(root,target);
      if(!conn.ok)throw new Error(conn.reason);
      const rollTarget={...target,rigId:this.result?.json?.rigId??this.resumePlan?.rigId??target.rigId};
      const value=await readConversationRollCall({exec:execFor(conn.config),fetch:fetchFor(conn.config)},rollTarget,conn.config);
      const now=await this.currentConfig();
      if(!sameDialogConfig(root,now,target.conn))throw new Error(CONFIG_CHANGED_OPEN);
      if(this.gone||this.resumeRollCallTicket!==ticket)return;
      this.resumeRollCall=value;
      if(value.unknown&&!this.resumeRollCallAutoUsed)this.resumeRollCallAutoPending=true;
    }catch(error){if(!this.gone&&this.resumeRollCallTicket===ticket)this.resumeRollCall={error:plainExecError(error,{kind:'read'})};}
    if(!this.gone&&this.resumeRollCallTicket===ticket)cx.notify();
  }

  requestResumeRead(cx,kind) {
    if(this.gone||this.busy)return;
    if(kind==='rollcall'){this.resumeRollCallTimer?.cancel?.();this.resumeRollCallTimer=null;this.resumeRollCallAutoPending=false;}
    cx.spawn(async next=>{try{await (kind==='plan'?this.loadResumePlan(next):this.loadResumeRollCall(next));}catch(error){if(!this.gone)notify({title:'Resume rig',body:errorDiagnostic(error),level:'warning'});}});
  }

  resumeReadView(t,cx,target,kind) {
    const button=(id,label,read)=>this.dialogButton(t,div().id(id).px(8).h(24).rounded(5).bg(t.raised).cursor_pointer(),null,(_e,next)=>this.requestResumeRead(next,read),false,label);
    const {rig,rigId,conn,rowsConfig}=target;
    const fresh=(id,logicalId)=>this.dialogButton(t,div().id(id).px(8).h(24).rounded(5).bg(t.raised).cursor_pointer(),null,()=>dialog(
      {kind:"seat",rig,rigId,conn,logicalId,...(rowsConfig?{rowsConfig}:{})},{action:'fresh',confirm:true},RESULT_HEIGHT),false,'Start fresh…');
    return kind==='plan'?restorePlanView(t,this.resumePlan,target.rig,button,fresh):rollCallView(t,this.resumeRollCall,button,fresh);
  }

  /** Re-reads `/api/rigs/:id/nodes` and compares `seatIdsOf(nodes)` against the roster the person reviewed (`reviewedSeats`). */
  async checkReviewedRoster(target, reviewedSeats, verb, missingHint = "") {
    try {
      const t = complete(target, this.config), conn = targetConnection(await this.currentConfig(), t);
      if (!conn.ok || !conn.config.daemonUrl) return `${target.rig} can't be read any more${missingHint}. Check the rig list. Nothing was sent.`;
      const r = await fetchFor(conn.config)(`${conn.config.daemonUrl}/api/rigs/${encodeURIComponent(t.rigId)}/nodes`);
      const nodes = r.ok ? await r.json() : null;
      if (!Array.isArray(nodes)) return `${target.rig} can't be read any more${missingHint}. Check the rig list. Nothing was sent.`;
      if (!Array.isArray(reviewedSeats) || JSON.stringify(seatIdsOf(nodes)) !== JSON.stringify(reviewedSeats)) {
        return `${target.rig} has changed since you confirmed ${verb} it. Nothing was sent. Close this and open it again to confirm again.`;
      }
      return null;
    } catch (e) {
      return e?.code === "GATE_REFUSED"
        ? `${String(e.message)}${/nothing was sent/i.test(String(e.message))?'':' Nothing was sent.'}`
        : `${target.rig} could not be checked. Nothing was sent. Close this and open it again to confirm again.`;
    }
  }

  /** A target's own connection's capabilities when it names one (with several OpenRigs); else this menu's config's, as before. */
  /** The capabilities of the target's OpenRig. While a draw runs they are read once per connection (each read goes through all of the published data and copies the terminal list, and a draw asks
   *  at several points, the footer once per disabled item); outside a draw, a click or a key, nothing is kept: they are read as they are then. */
  caps(target = null) {
    const key = target?.conn ?? target?.spaceConn ?? null, memo = this.capsDraw;
    if (memo?.has(key)) return memo.get(key);
    const value = connectionCapabilities(shared, this.config, key, terminals?.() ?? []);
    memo?.set(key, value);
    return value;
  }

  reviewReady() { return Number.isInteger(this.pause?.total) && this.pause.total >= 0 && !this.pause.error && Array.isArray(this.pauseSeatIds); }

  /** The actions offered for a target. Each has a vector icon (no font-dependent glyphs). */
  items(target) {
    const out = [];
    const caps = this.caps(target); // null: the target's OpenRig isn't read yet; no early refusal (its dispatcher judges it)
    const capReasonOf = (action) => caps ? capabilityDisableReason(action, caps) : null;
    const item = (iconName, label, act, actionName = null, dynamicLabel = false) => {
      if(["design-view","open-designed-view","cell-split","cell-swap","cell-zoom","close-cell","keyboard"].includes(actionName)||["Take keyboard","Edit layout…","Design worker view…"].includes(label))return;
      if(label==="New worker view")label="Worker view";
      const capReason = actionName ? capReasonOf(actionName) : null;
      const pReason = actionName && this.config ? personDisableReason(actionName === "reply-answer" ? "reply" : actionName, this.config) : null;
      const reason = capReason ?? pReason;
      out.push({ icon: iconName, label, act, disabled: !!reason, reason, dynamicLabel });
    };
    // An item the Rig sidebar runs (`rig.<command>`): with no Rig sidebar in the layout it is shown disabled, with the plain reason.
    const sidebarItem = (iconName, label, command, act, dynamicLabel = false) => { const reason = sidebarRefusal(layout(), command); out.push({ icon: iconName, label, act, disabled: !!reason, reason, dynamicLabel }); };
    const oldStripItem=()=>{
      if(!hasOldProviderStrip(layout()))return;
      const views=knownOldProviderViews(layout(),shared("rig.oldProviderViews")??[],oldViewsGone(shared,this.config)).filter(view=>view.current);
      const disabled=oldStripCleanupBusy(shared);
      out.push({icon:"x",label:"Leave OpenRig's old strip…",disabled,reason:disabled?oldStripBusyTip:null,
        act:()=>dialog({kind:"old-views"},{action:"close-old-views",views,confirm:true},480)});
    };
    if(target.kind==='assistant'){
      if(!assistantAddress(target.session)||!targetConnection(this.config,target).ok)return out;
      item('rig-queue','Queue work…',()=>dialog(target,{input:true,placeholder:'One-line summary; the body follows on the next lines',action:'queue',multiLine:true},300),'queue');
      item('rig-copy','Copy address',cx=>{if(assistantAddress(target.session)&&targetConnection(this.config,target).ok)cx.write_to_clipboard(target.session);});
      item('rig-card','Open rig page',()=>page({section:'topology',kind:'rig',conn:target.conn,rigId:target.rigId,name:target.rig}));
      return out;
    }
    if(target.kind==="sidebar-header"){
      oldStripItem();
      const enabled=(shared("rig.settings")?.notifications??true)!==false;
      item("rig-bell",enabled?"Turn notifications off":"Turn notifications on",()=>{
        setShared("rig.settings",{...(shared("rig.settings")??{}),notifications:!enabled});
      });
      item("rig-bell","Notification settings",()=>page({section:"system",subview:"notifications"}));
      sidebarItem("rig-popout","Open the Rig page","rig.open-page",()=>run("rig.open-page"));
      sidebarItem("rig-terminal-prompt","Open the TUI","rig.open-tui",()=>run("rig.open-tui"));
      item("rig-target","Add a machine…",()=>openOverlay({mod:MOD_IDS.menu,kind:"dialog",width:600,height:680,props:{target:{kind:"machine"},step:{action:"add-machine"}}})); // by hand: with ONE connection System shows no Connections, and detection may not reach a machine
      sidebarItem("rig-refresh","Refresh","rig.refresh",()=>run("rig.refresh"));
      return out;
    }
    if (target.kind === "rig" && target.archived) {
      item("rig-play", "Restore rig", () => oneClick(target, "unarchive-rig"), "unarchive-rig");
      item("rig-trash", "Delete rig…", () => dialog(target, { action: "delete-rig", load: "pause" }, 540), "delete-rig");
      return out;
    }
    if (target.kind === "seat" || target.kind === "cell") {
      const stoppedSeat = isStopped(target);
      let typingGuardItem=null;
      if(target.allSeats){
        item('rig-card','Open rig page',()=>page({section:'topology',kind:'rig',rigId:target.rigId,conn:target.conn,name:target.rig}));
        if(target.session)item('rig-copy','Copy session name',cx=>cx.write_to_clipboard(target.session));
      }
      // The row's own actions first: ⋯, the right-click and the Menu key open this same list.
      // A terminal seat is a person's shell, not an agent: no message, work or model to give it.
      if (!(target.terminal === true || isTerminalSeat(target))) {
        const guard=this.typingGuard,state=guard?.state;
        const previous=guard?.guard?.effectiveLevel??guard?.guard?.desiredLevel??guard?.guard?.effectiveMode;
        const review=typingGuardReview(guard?.guard);
        typingGuardItem={icon:state?.checked?'check':'rig-keyboard',label:'Quiet while I type',checked:!!state?.checked,
          disabled:!guard||!!guard.checking||!state||!!guard.reason||!!state.pending,reason:this.typingGuardRefusal??(!guard||guard.checking?'Checking this seat’s typing guard…':guard.reason??(!state?TYPING_GUARD_UNSUPPORTED:state.pending?'The typing guard is changing. Wait for its current operation to finish.':null)),tip:TYPING_GUARD_TIP+(state&&previous&&!['off','queue-only'].includes(previous)?` Current typing guard: ${state.word}. Choosing Quiet replaces it.`:''),
          act:()=>{
            if(!guard||guard.reason)return;
            const mode=state?.checked?'off':'queue-only';
            if(mode==='queue-only'&&previous&&previous!=='off'&&previous!=='queue-only'){
              dialog(target,{action:'typing-guard',mode,review,confirmationText:`Replace the typing guard for ${target.logicalId??target.session} with Quiet while I type? Current setting: ${state.word}. Turning Quiet off later sets the seat to Off. Restore the previous setting separately in OpenRig.`},320);return;
            }
            return guard.set(mode,{review}).then(result=>{
              notify({title:'Typing guard',body:result.text,level:result.ok?'info':'warning'});
              if(result.treatedAsHold)dialog(target,{action:'typing-guard',mode:'off',review:typingGuardReview(guard.guard),treatedAsHold:true,confirmationText:`This OpenRig treated it as hold: managed compaction is paused for ${target.logicalId??target.session}. Turn it off?`},320);
            });
          }};
        item("rig-send", "Send message…", () => dialog(target, { input: true, placeholder: `Message to ${target.session}`, action: "send", multiLine: true, ...(target.status === "terminal_gone" ? { note: TERMINAL_GONE_SEND_NOTE } : {}) }, target.status === "terminal_gone" ? 290 : 260), "send"); // the note needs the page's taller dialog
        item("rig-queue", "Queue work…", () => dialog(target, { input: true, placeholder: "One-line summary; the body follows on the next lines", action: "queue", multiLine: true }, 300), "queue");
        item("rig-swap", "Change model / harness…", () => openOverlay({ mod: MOD_IDS.menu, kind: "dialog", modal: true, width: 520, height: 420, props: { target, step: { action: "change-model" } } }), "change-model");
      }
      item("rig-seat", "Open seat page", () => page({ section: "topology", kind: "seat", rig: target.rig, rigId: target.rigId, conn: target.conn, name: target.logicalId, session: target.session }));
      if(typingGuardItem)out.push(typingGuardItem);
      if (target.session&&!target.allSeats) item("rig-copy", "Copy session address", (cx) => cx.write_to_clipboard(target.session));
      out.push({
        icon: "terminal",
        label: "Attach",
        // The sidebar outlives this popup and has the config: hand it Attach (rig.attach), so closing the popup can't
        // cut it short. Without the sidebar, Attach runs here with the config and this folder's relay, and finishes
        // before the popup closes; a refusal says why. It runs as a task: the click's cx goes stale at the first await,
        // and the wait for herdr to adopt the tab needs a cx that doesn't.
        act: (cx) => {
          const refusal = rowRefusalNow(target);
          if (refusal) { notify({ title: `Attach ${target.logicalId ?? target.session}`, body: refusal, level: "warning" }); return { ok: false, reason: refusal }; }
          // The row's own connection: its address and home (never the menu's first), and every send of the attach is checked against THAT connection's gate scope.
          const found = targetConnection(this.config, { conn: adoptConnection(this.config, target.conn) }); // an older row with no connection is the only one's; with several it is refused, never defaulted
          if (!found.ok) { notify({ title: `Attach ${target.logicalId ?? target.session}`, body: found.reason, level: "warning" }); return { ok: false, reason: found.reason }; }
          const config = found.config;
          const attach = (wait) => attachToSeat({ exec: execFor(config), run: runFor(config), hc: hcFor(config), spaces, panes, terminals, layout, shared, setShared, notify, openOverlay,closeOverlay,currentConfig:()=>configOfConnection(this.config,config.connectionId),seatShared: seatSharedOf(this.config, shared), wait, relayPath: attachRelayPath(appHome(), MOD_IDS.menu) }, target, config)
            .then((res) => {
              // An Attach tab from before an update runs an older viewer — ask before anything is stopped
              // or closed (the confirm dialog re-runs Attach with the replace), never reuse it silently and never touch it.
              if (res?.needsViewerRefresh) dialog(target, { action: "replace-viewer", staleViewer: res.staleViewer ?? null }, 320);
              else if (res && res.ok === false && res.reason) notify({ title: `Attach ${target.logicalId ?? target.session}`, body: res.reason, level: "warning" });
              return res;
            });
          if (typeof cx?.spawn !== "function") return attach(undefined);
          return new Promise((resolve) => { cx.spawn(async (cx) => { resolve(await attach(waitWith(cx)).catch((error) => { sayRefusal(error); return null; })); }); });
        },
        disabled: stoppedSeat || target.status === "terminal_gone",
        reason: target.status === "terminal_gone" ? TERMINAL_GONE_REASON : stoppedSeat ? "Stopped: seat has no running session to attach" : null,
      });
      if(target.allSeats&&target.compactActions){const index=out.findIndex(item=>item.label==='Attach');if(index>=0)out.unshift(...out.splice(index,1));}
      // Focusing a pane the seat already has needs nothing from OpenRig; with none, Focus pane opens a view, which needs
      // OpenRig's herdr provider ("open-seat"), as on the seat page.
      const live = seatClickTarget(viewsPropsFromLayout(layout(), shared), null, target.session, panes?.() ?? [], terminals?.() ?? [], seatOrigin(this.config, target.conn), seatSharedOf(this.config, shared)?.(target.session) === true);
      item("rig-target", "Focus pane", () => {
        const hit = seatClickTarget(viewsPropsFromLayout(layout(), shared), null, target.session, panes?.() ?? [], terminals?.() ?? [], seatOrigin(this.config, target.conn), seatSharedOf(this.config, shared)?.(target.session) === true);
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
        if (hit.kind === "ambiguous") { notify({ title: "Focus pane", body: hit.reason ?? SEAT_NAME_SHARED, level: "warning" }); return; }
        oneClick(target, "open-seat");
      }, live.kind === "focus" || live.kind === "select-then-focus" ? null : "open-seat");
      item("rig-view", "Open terminal", () => oneClick(target, "open-seat"), "open-seat");
      if (target.kind === "seat" && live.kind !== "card" && live.kind !== "ambiguous") item("rig-keyboard", "Take keyboard", () => oneClick({ ...target, kind: "cell", terminal: live.terminal }, "keyboard"));
      item("rig-target", "Open slice", () => openSlice(target));
      // Files open in the Files-look-alike viewer.
      item("file-text", "Open slice SPEC.md", () => openSlice(target, "SPEC.md"));
      // The TARGET's own connection decides, and a connection on a machine has no local transcript to open - the same rule
      // pageTranscriptPath applies on the page, so the menu and the page agree instead of the menu opening this computer's same-named log.
      const transcriptConfig = target.conn ? configOfConnection(this.config, target.conn) : this.config;
      const transcript = transcriptConfig && !transcriptConfig.daemonMachine ? transcriptPath(transcriptConfig, target.rig, target.session) : null;
      if (transcript) item("file-text", "Open transcript", () => page(fileEntry(transcript, `Transcript · ${target.logicalId ?? target.session}`)));
      if (target.kind === "cell") item("rig-keyboard", "Take keyboard", () => oneClick(target, "keyboard"));
      else item("rig-view", "Show in worker view", () => oneClick(target, "open-seat"), "open-seat");
      // Its tmux server stopped answering: every action that needs the seat's terminal says why instead of failing with an unrelated warning.
      if (target.status === "terminal_gone") for (const it of out) if (["Attach", "Focus pane", "Open terminal", "Show in worker view", "Take keyboard"].includes(it.label)) { it.disabled = true; it.reason = TERMINAL_GONE_REASON; }
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
      const spaceConn = target.conn ?? target.spaceConn;
      const rigTarget = { kind: "rig", rig: target.rig, rigId: target.rigId, conn: target.conn, name: target.rig,
        lifecycle: pickRig(sharedRigData(this.config, shared)?.topology ?? [], { rigId: target.rigId, conn: spaceConn, name: target.rig }).rig?.lifecycle ?? null };
      // A space's own OpenRig: its home or origin-matched space opens that OpenRig's page and operator, not the shown or first one's; rig writes still require topology ownership (`target.conn`).
      item("rig-popout", "Open Rig page", () => page(target.home ? { section: "topology", ...(spaceConn ? { conn: spaceConn } : {}) } : { section: "topology", kind: "rig", rig: target.rig, rigId: target.rigId, ...(spaceConn ? { conn: spaceConn } : {}), name: target.rig }));
      sidebarItem("rig-operator", "Attach operator", "rig.operator", () => {
        if (spaceConn) return run(operatorCommandFor({ ...this.config, connectionId: spaceConn }));
        if ((this.config?.connections ?? []).length > 1) return notify({ title: "Attach operator", body: NO_CONNECTION, level: "warning" });
        return run("rig.operator");
      });
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
      sidebarItem("rig-view", "Open rig space", "rig.space", () => { const command = this.spaceCommand(target, target.rigId ?? target.rig); if (command) run(command); }); // the row's own OpenRig, in the name herdr delivers
      const moveConnection=targetConnection(this.config,{...target,conn:adoptConnection(this.config,target.conn)});
      if(moveConnection.ok&&rigSpaceRelocation({spaces,panes,terminals},{id:target.rigId,name:target.rig},moveConnection.config))
        sidebarItem("rig-view",`Move rig space to ${moveConnection.config.daemonMachine}…`,"rig.space",()=>runFor(moveConnection.config)(commandFor("rig.space",moveConnection.config,target.rigId??target.rig)),true); // herdr drops a mod command's args: the target goes in its name
      item("rig-view", "New worker view", () => oneClick({ ...target, view: `rig:${target.rig}` }, "open-view"), "open-view");
      item("rig-view", "Design worker view…", () => openDesigner(target), "design-view");
      // One Following view per rig in this window; the toggle turns its following on or off.
      const followed = followingFor(`rig:${target.rig}`, target.conn, this.config);
      const on = !!followed?.following?.enabled;
      const followReason = capReasonOf(on ? "unfollow" : "follow");
      out.push({ icon: on ? "check" : "rig-follow", label: "Follow active workers", act: () => oneClick({ ...target, view: `rig:${target.rig}` }, on ? "unfollow" : "follow"), disabled: !!followReason, reason: followReason });
      // Every seat of this rig sits on a tmux server that stopped answering: its rig space, a worker view or Follow would only fail.
      if (rigTerminalsGone(pickRig(sharedRigData(this.config, shared)?.topology ?? [], { rigId: target.rigId, conn: target.conn, name: target.rig }).rig))
        for (const it of out) if (["Open rig space", "Worker view", "New worker view"].includes(it.label) || (it.label === "Follow active workers" && !on)) { it.disabled = true; it.reason = TERMINAL_GONE_RIG_REASON; } // turning Follow off needs no tmux server
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
      sidebarItem("rig-refresh", "Restart TUI", "rig.tui", () => {
        if (target.terminal) run("terminal.kill", { terminal: target.terminal });
        run(target.conn ? tuiCommandFor({ ...this.config, connectionId: target.conn }) : "rig.tui"); // that OpenRig's TUI, not the shown box's
      });
      item("x", "Close TUI", () => {
        if (target.terminal) run("terminal.kill", { terminal: target.terminal });
      });
    }
    if (target.kind === "spec") {
      // Rig specs only (an agent spec isn't a `rig up` source); a target without a kind is offered it.
      if ((target.sourcePath || target.name) && (!target.specKind || target.specKind === "rig")) item("rig-play", "Launch rig from spec…", () => dialog(target, { action: "launch-spec" }, LAUNCH_DIALOG_HEIGHT));
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
      oldStripItem();
      // A worker view's strip pill: close it, follow its rig's active workers, or reach the rig.
      item("rig-view", "Edit layout…", () => openDesigner(this.editTarget(target)), "design-view");
      if (target.rig) item("rig-follow", "Follow active workers", () => oneClick({ ...target, view: `rig:${target.rig}` }, "follow"), "follow");
      this.viewExtras(target.rig, item, target.conn, sidebarItem);
    }
    if (target.kind === "following") {
      // A following view's strip menu: stop or resume, the TTL, close. Closing ends only its viewers.
      const view = { ...target, view: target.target };
      const followReason = capReasonOf(target.enabled ? "unfollow" : "follow");
      out.push(target.enabled
        ? { icon: "rig-pause", label: "Stop following", act: () => oneClick(view, "unfollow"), disabled: !!followReason, reason: followReason }
        : { icon: "rig-play", label: "Resume following", act: () => oneClick(view, "follow"), disabled: !!followReason, reason: followReason });
      const preset = PRUNE_PRESETS.some(([, ms]) => ms === target.pruneAfterMs);
      out.push({ divider: caps?.hostWorkerViews?"herdrig prune idle tiles after":preset || target.pruneAfterMs === undefined ? "Prune idle tiles after" : `Prune idle tiles after (now ${ttlWords(target.pruneAfterMs)})` });
      const pruneReason = capReasonOf("prune");
      for (const [label, ms] of PRUNE_PRESETS) {
        out.push({ icon: target.pruneAfterMs === ms ? "check" : null, label, act: () => oneClick({ ...view, prune: label }, "prune"), disabled: !!pruneReason, reason: pruneReason });
      }
      out.push({ divider: "" });
      item("rig-view", "Edit layout…", () => openDesigner(this.editTarget(target)), "design-view");
      this.viewExtras(String(target.target ?? "").startsWith("rig:") ? target.target.slice(4) : null, item, target.conn, sidebarItem);
      // Worker pages use Herdr's native tab close control. Old provider views have the separately confirmed cleanup action.
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
    const targetDismissalTarget = () => {
      if (!this.config) return { scope: undefined, conn: target.conn };
      const conn = adoptConnection(this.config, target.conn);
      if ((this.config.connections?.length ?? 0) > 1 && !conn) return null;
      const cfg = conn ? configOfConnection(this.config, conn) : this.config;
      return cfg ? { scope: dismissalScope(cfg), conn: conn ?? cfg.connectionId } : null;
    };
    if (target.kind === "need") {
      if (dismissible(target)) item("check", target.dismissed ? "Restore update" : "Dismiss update", () => {
        const resolved = targetDismissalTarget();
        if (resolved === null) return;
        const scopedTarget = target.conn || !resolved.conn ? target : { ...target, conn: resolved.conn };
        requestVisibleDismissal(resolved.scope, target.dismissed ? "restore" : "dismiss", target.dismissed ? updateKey(scopedTarget) : scopedTarget);
      });
      // A native seat closed outside OpenRig. Offered, never done on its own.
      if (target.native) {
        item("rig-refresh", "Relaunch fresh…", () => dialog({ ...target, reason: "native seat closed outside OpenRig" }, { action: "fresh", confirm: true }, 220));
        item("rig-play", "Resume…", () => dialog({ kind: "rig", rig: target.rig, conn: target.conn }, { action: "resume", confirm: true }, 380));
      }
      if (target.reply !== "none" && !sweepFinding(target)) item("rig-reply", "Reply…", () => dialog(target, { input: true, placeholder: "Your answer, in your own words", action: "reply", multiLine: true }, 290), target.reply === "answer" ? "reply-answer" : "reply");
      const check = sweepFinding(target);
      item("rig-card", "Open this item", () => page({ section: "needs", id: target.id, name: check ? checkLabel(check, shared("rig.data")?.attentionItems) : rowTitle(target.summary) }));
      const copyId = String(target.answer?.qitemId || target.qitemId || rowIdIn(target.id) || target.id || ""); // the bare row id, not the queue:/queue-update: page id
      if (copyId) item("rig-copy", "Copy request id", (cx) => cx.write_to_clipboard(copyId));
    }
    if (target.kind === "updates-group") {
      const items = target.items ?? [];
      if (items.length) item("check", items.length === 1 ? "Dismiss" : `Dismiss all ${items.length} updates`, () => {
        const resolved = targetDismissalTarget();
        if (resolved === null) return;
        const scopedItems = resolved.conn ? items.map((it) => (it?.conn ? it : { ...it, conn: resolved.conn })) : items;
        requestVisibleDismissal(resolved.scope, "dismiss", scopedItems);
      });
    }
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
    if (target?.archived) return [];
    const { rig } = pickRig(sharedRigData(this.config, shared)?.topology ?? [], { rigId: target.rigId, conn: target.conn, name: target.rig });
    const seats = rig ? rig.pods.flatMap((p) => p.seats) : [];
    for (const c of target.cells ?? []) {
      if (c.seat && !seats.some((s) => s.session === c.seat)) seats.push({ session: c.seat, logicalId: String(c.seat).split("@")[0], status: "running", word: "in view" });
    }
    return seats;
  }

  async loadSwapRepresentative() {
    const target = complete(props()?.target, this.config);
    try {
      const conn = targetConnection(await this.currentConfig(), target);
      if (!conn.ok || !target?.rigId) return;
      const response = await fetchFor(conn.config)(`${conn.config.daemonUrl}/api/rigs/${encodeURIComponent(target.rigId)}`);
      const detail = response.ok ? await response.json() : null;
      if (this.gone || detail?.rig?.id !== target.rigId) return;
      if (detail.representative === target.session) {
        const roster = await fetchFor(conn.config)(`${conn.config.daemonUrl}/api/rigs/${encodeURIComponent(target.rigId)}/nodes`);
        const nodes = roster.ok ? await roster.json() : null;
        if (Array.isArray(nodes)) this.swapSeats = nodes.map((node) => ({ logicalId: node.logicalId, session: node.canonicalSessionName }));
      }
      if (!this.gone) this.swapRepresentative = detail.representative;
    } catch { /* An unreadable route leaves queueing disabled. */ }
    finally { this.swapLeadPending = false; }
  }

  swapPlan(target) {
    return changeModelPlan(
      { ...target, runtime: this.swapCurRuntime, model: this.swapCurModel, effort: this.swapCurEffort },
      { runtime: this.swapRuntime, model: this.swapModel, effort: this.swapEffort },
      { seats: this.swapSeats ?? this.rigSeats(target), representative: this.swapRepresentative, catalog: this.swapCatalog },
    );
  }

  /** Where a cell target's `cellId` sits in a grid ({ r, c }), if its cells carry ids. */
  cellAt(grid, target) {
    for (const [r, row] of grid.rows.entries()) for (const [c, cell] of row.cells.entries()) if (target.cellId && cell.cellId === target.cellId) return { r, c };
    return null;
  }

  /** What a strip view's menu adds for its rig: the rig card (with rigId when known), the TUI, a snapshot. */
  viewExtras(rig, item, conn, sidebarItem) {
    sidebarItem("terminal", "Open or switch to the Rig TUI", "rig.tui", () => run(conn ? tuiCommandFor({ ...this.config, connectionId: conn }) : "rig.tui"));
    if (rig) item("rig-snapshot", "Snapshot now", () => oneClick({ kind: "rig", rig, conn }, "snapshot"));
  }

  /** The CLI behind each action (rig-lib actionArgs, shared with the sidebar's one-click runs). */
  argsFor(target, action, text) { return actionArgs(target, action, text, appHome()); }

  // ---- views --------------------------------------------------------------------------------------------------------
  // Links such as error Details are built before the footer. Include only their
  // drawn handles, in construction order, alongside dialog fields and buttons.
  focusTargetDrawn(_id,handle){
    if(!this.dialogRenderCx||!handle)return;
    this.dialogFirstControl??=handle;this.dialogLastControl=handle;
  }
  dialogTab(e,cx){
    if(String(e.key).toLowerCase()!=='tab'||e.modifiers?.control||e.modifiers?.platform||e.modifiers?.alt)return false;
    cx.stop_propagation();
    if(this.newMode!==undefined)this.newFocusTouched=true;
    const heldAt=this.heldFocusControls?.findIndex(handle=>handle?.is_focused?.())??-1;
    if(heldAt>=0){
      const handles=this.heldFocusControls,next=handles[(heldAt+(e.modifiers?.shift?-1:1)+handles.length)%handles.length];
      this.dialogBoundaryTask?.cancel?.();
      this.dialogBoundaryTask=cx.timer.after(16,nextCx=>{if(!this.gone){next.focus();nextCx.notify();}});
      return true;
    }
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
    const activation=activationPair(this,`dialog-button-${index}`);
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
      .when(!!handle&&!disabled,el=>el.track_focus(handle)).tab_stop(!disabled)
      .focus(el=>el.border_color(t.accent)).on_mouse_down('left',activation.pointer()).on_key_down(activation.key(key))
      .child(element.on_mouse_down('left',activation.pointer()).on_click(activation.click((event,cx)=>{if(!disabled)act(event,cx);})).on_key_down(activation.key(key)).when(content!==undefined,el=>el.child(content)));
  }

  adoptionReviewPending() {
    return this.pending==="Attach"&&Object.values(shared("rig.spaceAdoptionReviews")??{}).some(review=>!review.settledAt);
  }

  menuKey(e,cx,items) {
    if(this.adoptionReviewPending()){cx.stop_propagation();return;}
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
        // The rows have no focus handle of their own, so Enter and Space arrive here: both open the highlighted choice, once (a held repeat does nothing).
        else if(["enter"," ","space"].includes(String(e.key??"").toLowerCase())){cx.stop_propagation();if(!e.is_held)this.navigate(choices[this.navChoiceIndex??0].entry,cx);}
        else if(e.key==="escape"){cx.stop_propagation();this.dismiss();}})
      .children((target.choices ?? []).map((choice,i) => h_flex().id(`page-navigation-${i}`).tab_stop(true).px(8).h(30).gap(12).items_center().rounded(5).cursor_pointer()
        .when(i===(this.navChoiceIndex??0),el=>el.bg(t.selection??t.hover)).hover(el => el.bg(t.hover))
        .on_mouse_down('left',activationPair(this,`page-navigation-${i}`).pointer())
        .on_click(activationPair(this,`page-navigation-${i}`).click((_e,cx) => this.navigate(choice.entry,cx)))
        .on_key_down(activationPair(this,`page-navigation-${i}`).key((e,cx)=>{if(!e.is_held&&["enter"," ","space"].includes(String(e.key??"").toLowerCase())){cx.stop_propagation();this.navigate(choice.entry,cx);}}))
        .child(div().flex_1().text_size(12.5).text_color(t.foreground).child(choice.label))
        .when(choice.count !== null && choice.count !== undefined, el => el.child(div().text_size(11.5).text_color(t.dim).child(String(choice.count))))));
    if (this.pending) return v_flex().id("rig-menu").size_full().p(4).bg(t.raised).border(1).border_color(t.border).rounded(8).text_size(12.5)
      .on_key_down((e,cx)=>{if(this.adoptionReviewPending())this.menuKey(e,cx,[]);})
      .when(this.adoptionReviewPending(),el=>el.opacity(0.45))
      .child(div().id("rig-menu-pending").px(8).py(6).text_color(t.muted).child(`${this.pending}…`));
    const items = this.items(target);
    const check = target.kind === "need" ? sweepFinding(target) : null;
    if(!items[this.menuIndex]?.act){
      this.menuIndex=items.findIndex(it=>it.act&&!it.disabled);
      if(this.menuIndex<0)this.menuIndex=items.findIndex(it=>it.divider===undefined);
    }
    if(this.menuIndex>=0&&this.menuRevealed!==this.menuIndex){this.menuScroll?.scroll_to_item(this.menuIndex);this.menuRevealed=this.menuIndex;}
    // Herdr fits the popup to its content. A separate scrollbar lets the list
    // measure its own rows before shrinking to the popup's height cap.
    const actions = v_flex().id('rig-action-list').min_h(0).overflow_y_scroll().track_scroll(this.menuScroll)
      .on_size_change((_size,cx)=>{if(this.menuIndex>=0)this.menuScroll?.scroll_to_item(this.menuIndex);cx.notify();})
      .children(items.map((it, i) => {
        if (it.divider !== undefined) return v_flex().flex_none().child(div().h(1).bg(t.border).my(3))
          .when(!!it.divider, el => el.child(div().px(8).py(2).text_size(11).text_color(t.dim).child(it.divider)));
        // The explanation stays with its row, keeping pointer targets stable as focus changes.
        const reason = it.reason ? workerCapabilityText(it.reason, this.caps(target)) : "";
        const tip = it.reason && it.reason !== reason ? it.reason : it.tip;
        return v_flex().id(`rig-menu-${i}`).flex_none().px(8).rounded(5).text_color(it.disabled ? t.dim : t.foreground)
          .when(i===this.menuIndex,el=>el.bg(t.selection??t.hover)).hover(s=>s.bg(t.hover))
          .on_mouse_move((_e,cx)=>{if(this.menuIndex!==i){this.menuIndex=i;cx.notify();}})
          .when(!!tip && tip !== reason, el => el.tooltip(plainError(tip).text))
          .on_click((_e, cx) => this.choose(it, cx))
          .child(h_flex().h(26).gap(8).items_center()
            .child(it.icon ? svg(icon(it.icon)).size(13).flex_none().text_color(it.disabled ? t.dim : t.muted) : div().w(13).flex_none())
            .child(div().flex_1().truncate().when(!!it.dynamicLabel, el => el.tooltip(String(it.label ?? ""))).child(it.label)))
          .when(!!reason, el => el.child(div().id(`rig-menu-reason-${i}`).pl(21).pb(4).min_w(0)
            .whitespace_normal().text_size(11).text_color(t.dim).child(reason)));
      }));
    return v_flex().id("rig-menu").w_full().min_h(0).p(4).bg(t.raised).border(1).border_color(t.border).rounded(8).text_size(12.5)
      .when(!!this.handle,el=>el.track_focus(this.handle))
      .on_key_down((e,cx)=>this.menuKey(e,cx,items))
      .child(div().flex_none().px(8).py(4).text_size(11).text_color(t.dim).child(target.kind === "seat" || target.kind === "cell" ? `Seat ${target.logicalId ?? target.session} · ${target.rig}`
        : target.kind === "sidebar-row" ? `${(target.rowKind ?? "row").replace(/^./, c => c.toUpperCase())} ${target.name ?? ""}`
        : target.kind === "need" ? (check ? checkLabel(check, shared("rig.data")?.attentionItems) : target.summary ?? "Needs you") : target.kind === "tui" ? "Rig TUI" : target.kind === "spec" ? `Spec ${target.name}`
        : target.kind === "slice" ? `Slice ${target.name}` : target.kind === "strip-view" || target.kind === "following" ? `View ${target.name ?? target.viewId}`
        : target.kind === "cell-split" ? `Split ${target.logicalId ?? target.seat}` : target.kind === "pod" ? `Pod ${target.pod} · ${target.rig}`
        : target.kind === "host" ? `Host ${target.name}` : target.kind === "mission" ? `Mission ${target.name}` : target.kind === "branch" ? target.name
        : target.kind === "specs-group" ? `${target.name} specs` : target.kind === "system-config" || target.kind === "system" ? target.name
        : target.kind === 'assistant' ? `Connected assistant ${target.logicalId ?? target.name}`
        : target.kind === "saved-view" || target.kind === "terminal" ? `View ${target.name ?? target.view}` : `Rig ${target.rig ?? ""}`))
      .child(v_flex().relative().min_h(0)
        .child(actions)
        .child(Scrollbar.vertical('rig-action-list').absolute().inset_0()));
  }

  resultView(t, cx, target, step) {
    const r = this.result;
    const origin = targetConnection(this.config,target);
    const where = origin.ok ? origin.config.daemonMachine ?? "this computer" : "OpenRig's machine";
    if (this.busy) return div().text_size(12.5).text_color(t.muted).child(`${this.busy}…`);
    if (!r) return null;
    if (step.action === "new-rig" && r.ok) return div().text_size(12.5).child(r.text);
    if (step.action === "delete-rig" && r.kind === "delete" && r.json && "sessionsKilled" in r.json) {
      const out = deleteOutcome(r.json, target.rig);
      return v_flex().id("delete-result").gap(4)
        .child(div().text_size(13).font_semibold().text_color(out.ok ? t.foreground : t.blocked).child(out.headline))
        .children(out.notes.map((note,i) => note.startsWith("Error") ? errorBlock(this,t,`delete-note-${i}`,note,{where}) : div().text_size(11.5).text_color(t.dim).child(note)));
    }
    if ((step.action === "delete-rig" || step.action === "archive-rig") && r.kind === "archive") {
      const paused = r.paused;
      return v_flex().id("archive-result").gap(4)
        .child(div().text_size(13).font_semibold().text_color(r.ok ? t.foreground : t.blocked).child(r.ok ? `Archived ${target.rig}` : r.uncertain ? (r.stage === "pause" ? `${target.rig} may have been paused` : `${target.rig} may have been archived`) : `${target.rig} wasn't archived`))
        .when(!!paused, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(paused.headline))
          .children(paused.notes.map((note,i) => note.startsWith("Error") ? errorBlock(this,t,`archive-pause-note-${i}`,note,{where}) : div().text_size(11.5).text_color(t.dim).child(note))))
        .child(r.ok ? div().text_size(11.5).text_color(t.dim).child(`${target.rig} archived. Restore it any time from Topology → Archived.`)
          : errorBlock(this,t,"archive-result-error",r.text || "It didn't work, and the CLI gave no reason.",{where,outcomeUnknown:r.outcomeUnknown || r.uncertain}))
        .when(!r.ok && r.notSent && !/nothing was sent/i.test(String(r.text ?? "")), (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Nothing was sent.")))
        .when(r.ok, (el) => el.child(h_flex().child(this.dialogButton(t,div().id("rig-unarchive").px(10).h(24).rounded(6).bg(t.raised).flex().items_center().hover((s) => s.bg(t.hover)),null,
          () => { oneClick(target, "unarchive-rig"); this.dismiss(); },false,"Undo"))));
    }
    // A teardown result (even with a non-zero exit, as for a rig already stopped) reads as what it says.
    if (step.action === "pause" && r.json && "sessionsKilled" in r.json) {
      const out = pauseOutcome(r.json);
      return v_flex().gap(4)
        .child(div().text_size(13).font_semibold().text_color(out.ok ? t.foreground : t.blocked).child(out.headline))
        .children(out.notes.map((note,i) => note.startsWith("Error") ? errorBlock(this,t,`pause-note-${i}`,note,{where}) : div().text_size(11.5).text_color(t.dim).child(note)));
    }
    if (step.action === "resume" && r.json) {
      const out = resumeOutcome(r.json, r.ok);
      const missing=this.resumeRollCall?.didNotStart??0;
      const headline = missing>0&&r.json.status==='restored'?`Resumed ${target.rig} · ${missing} seat${missing===1?'':'s'} didn't start`:out.ok ? `Resumed ${target.rig}` : out.partial ? `Resumed ${target.rig} · partially` : `${target.rig} wasn't resumed`;
      return v_flex().gap(6)
        .child(div().text_size(13).font_semibold().child(headline))
        .when(!!out.error, (el) => el.child(errorBlock(this,t,"resume-error",out.error?.fact ?? out.error?.message ?? out.error,{where})))
        .children((out.notes ?? []).map((note,i) => errorBlock(this,t,`resume-note-${i}`,note,{where,tone:t.dim})))
        .children(out.seats.map((s, i) => v_flex().gap(1)
          .child(h_flex().gap(8).items_center()
            .child(svg(icon(s.ok ? "check" : s.status === "failed" ? "x" : "rig-alert")).size(13).flex_none().text_color(s.ok ? t.working : t.blocked))
            .child(div().w(120).truncate().tooltip(String(s.logicalId??"")).child(s.logicalId))
            .child(div().flex_1().truncate().text_color(t.muted).tooltip(String(s.label??"")).child(s.label))
            .when(s.needsFresh, (el) => el.child(this.dialogButton(t,div().id(`fresh-${i}`).px(8).h(22).rounded(5).bg(t.raised).flex().items_center().hover((x) => x.bg(t.hover)),null,
              () => dialog({ ...target, logicalId: s.logicalId }, { action: "fresh", confirm: true }, RESULT_HEIGHT),false,"Start fresh…"))))
          .when(!s.ok && !!s.error, (el) => el.child(errorBlock(this,t,`resume-seat-error-${i}`,s.error,{where})))))
        .when(r.json.status==='restored',el=>el.child(this.resumeReadView(t,cx,target,'rollcall')));
    }
    const replyAlreadyWorded = step.action === "reply" && Boolean(r.conflict || r.tokenProtected || r.daemonRefused || r.networkError || r.unconfirmed);
    const knownHold = knownHeldReceipt(r, step.action);
    return v_flex().gap(6)
      .child(r.ok ? div().text_size(12.5).text_color(t.foreground).child(r.text || this.doneWords(target, step.action)) : errorBlock(this,t,"menu-result-error",r.text || "It didn't work, and the CLI gave no reason.",{where,outcomeUnknown:r.outcomeUnknown || r.uncertain,tone:knownHold?t.ansi3:undefined}))
      .when(!!r.warning, (el) => el.child(div().text_size(11).text_color(t.dim).child(r.warning)))
      // A refusal that happened before anything left says so, for EVERY action; the uncertain line is only for a request that did leave (the CLI ran, or a refusal came after the send).
      .when(!r.ok && r.notSent && !/nothing was sent/i.test(String(r.text ?? "")),
        (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Nothing was sent.")))
      .when(!r.ok && !r.notSent && !r.undelivered && !replyAlreadyWorded, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(step.action === "send" || step.action === "queue"
        ? "It may still have been delivered: check the seat or `rig queue` before trying again."
        : step.action === "reply" ? "It may still have arrived: check the request in Needs-You before answering again."
        : step.action === "change-model" ? `The change may already have been queued: check ${this.changeQueuedFor ? `${this.changeQueuedFor}'s queue` : "the queue it was sent to"} (\`rig queue\`) before queueing it again.`
        : step.action === "launch-spec" ? (r.uncertain ? "The launch may already have started: check the rig list before launching again." : "Fix the fields above and press Launch, or check the rig list if Launch timed out.")
        : step.action === "new-rig" ? (r.uncertain ? "The rig may already have been created: check the rig list before creating it again." : "Check the rig list before trying again.")
        : step.action === "delete-rig" ? "Check the rig list before trying again; Retry runs the delete again."
        : step.action === "pause" || step.action === "resume" ? "Check the current state before trying again; Retry re-reads it first." : "Retry runs it again.")))
      // A launch or create that may have gone through offers the rig list instead of a second try; closing and reopening the dialog starts a fresh attempt.
      .when(!r.ok && r.uncertain && (step.action === "launch-spec" || step.action === "new-rig"), (el) => el.child(this.dialogButton(t,div().id("rig-check-list").px(10).h(24).rounded(6).bg(t.raised).flex().items_center().hover((s) => s.bg(t.hover)),null,
        (_e,cx)=>{ refreshSidebar(); this.navigate({ section: "topology" }, cx); },false,"Check the rig list")))
      // A message or an answer is never resent from here: it may have arrived. Anything else runs again.
      .when(this.retryable(step), (el) => el.child(this.dialogButton(t,div().id("rig-retry").px(10).h(24).rounded(6).bg(t.raised).flex().items_center().hover((s) => s.bg(t.hover)),null,
        (_e,cx)=>this.retry(cx,target,step),false,step.action === "delete-rig" ? "Retry delete" : "Retry")));
  }

  /** Retry of the delete the person confirmed: the same step, redone on purpose. It re-reads the rig first and refuses (sending nothing) when the rig is gone or its seats are not the ones the person confirmed; the OpenRig settings are checked by `write()` itself. */
  retryDelete(cx, target, step) {
    if (this.gone || this.busy) return;
    const confirmed = this.deleteConfirmed;
    this.busy = "Checking the rig"; cx.notify();
    cx.spawn(async (cx) => {
      const problem = await this.checkReviewedRoster(target, confirmed?.seats, "deleting", ", so it may already be deleted");
      this.busy = null;
      if (this.gone) return;
      if (problem) { this.result = { ok: false, notSent: true, text: problem }; cx.notify(); return; }
      this.result = null; this.go(cx, target, step);
    });
  }

  /** Whether the failed result may be retried from this dialog. A Retry re-runs the step that failed and never a later, more destructive one: in the Delete dialog (which also offers Archive, with its own pause) only a result that came from the DELETE step has a Retry, so a failed pause or archive can never lead to `rig down --delete` without the person pressing Delete. */
  retryable(step) {
    const r = this.result;
    if (!r || r.ok || RESEND_UNSAFE.has(step.action)) return false;
    if (step.action === "delete-rig") return r.kind === "delete";
    return true;
  }

  /** What a success says when the CLI printed no message of its own. */
  doneWords(target, action) {
    return action === "change-model" && this.changeQueuedFor
      ? `Queued for ${this.changeQueuedFor}.` : doneWords(target, action);
  }

  /** Run again: lifecycle actions re-read the rig first; a message or answer has no Retry; the rest re-run. */
  retry(cx, target, step) {
    if (RESEND_UNSAFE.has(step.action)) return;
    if(step.action==='resume')this.resetResumeRollCall();
    if (step.action === "delete-rig") { if (this.retryable(step)) this.retryDelete(cx, target, step); return; } // only the delete step has a Retry here (see retryable)
    if(step.action==='resume'&&this.resumePlan?.supported){this.result=null;this.requestResumeRead(cx,'plan');return;}
    if (step.action === "pause" || step.action === "resume") {
      const reviewedSeats = this.pauseSeatIds;
      this.run(cx, "Re-reading the rig", async () => {
        const rosterProblem = step.action === "pause" ? await this.checkReviewedRoster(target, reviewedSeats, "pausing") : null;
        if (rosterProblem) return { ok: false, notSent: true, text: rosterProblem };
        const ps = await this.read(["ps", "--nodes", "--rig", target.rig]);
        if (!Array.isArray(ps)) return { ok: false, text: "OpenRig couldn't read the rig's current agents. Nothing was run. Close this and open it again from the list." };
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

  inputCanSend(step) {
    return !this.result || (["send", "queue", "reply"].includes(step?.action) && !this.result.ok && !this.result.uncertain && !this.result.outcomeUnknown && this.result.notSent === true);
  }

  waitForCompactionStart(cx,step){
    const poll=next=>{
      this.compactionStartTimer=null;
      if(this.gone)return;
      const all={...(shared('rig.compactionDecisions')??{})},record=all[step.token];
      if(record?.status==='started'){
        delete all[step.token];setShared('rig.compactionDecisions',all);
        this.compactionStarting=false;this.dismiss();return;
      }
      if(record?.status==='error'||Date.now()>=this.compactionDeadline){
        this.compactionStarting=false;
        this.compactionStartMessage=record?.text??(record?.dispatched?step.start.uncertain:step.start.unsent);
        if(record?.status==='allow'||record?.status==='checking')all[step.token]={...record,status:'expired'};
        else delete all[step.token];
        setShared('rig.compactionDecisions',all);
        this.dialogCancelHandle?.focus?.();next.notify();return;
      }
      this.compactionStartTimer=next.timer.after(250,poll,{owner:null});
    };
    // close() cancels this wait even when the host drains a promise in another view.
    this.compactionStartTimer=cx.timer.after(250,poll,{owner:null});
  }

  oldStripCloseAvailable(){
    if(!this.config)return null;
    const local=(this.config.connections?.length?this.config.connections.map(c=>configOfConnection(this.config,c.id)).filter(Boolean):[this.config]).filter(c=>!c.daemonMachine);
    let unknown=false;
    for(const config of local){
      const caps=this.caps({conn:config.connectionId});
      const measured=this.config.connections?.length>1?shared('rig.data')?.byConnection?.[config.connectionId]?.capabilities:shared('rig.capabilities')??shared('rig.data')?.capabilities;
      if(!caps||caps.probed===false||!(config.capabilities??measured)){unknown=true;continue;}
      if(caps.herdrAppProvider===true)return true;
    }
    return unknown?null:false;
  }
  oldStripCloseOnly(step){
    return this.oldStripChoices?.length===0&&!!this.config&&!!step.views?.length
      &&this.oldStripCloseAvailable()===true;
  }
  /** Runs the dialog's action once (a second press while it runs does nothing). */
  go(cx, target, step) {
    if(step.action==='typing-guard'){
      if(!this.typingGuard||this.busy)return;
      this.busy='Updating typing guard';cx.notify();
      cx.spawn(async taskCx=>{
        if(this.gone)return;
        const result=await this.typingGuard.set(step.mode,{review:step.review??null});
        if(this.gone)return;
        this.busy=null;this.result={...result,kind:'typing-guard'};taskCx.notify();
      },{owner:null});
      return;
    }
    if (this.gone || this.busy) return;
    if(step.action==='confirm-seat-compaction'){
      if(!step.token||this.compactionConfirmed)return;
      this.compactionConfirmed=true;
      const now=Date.now();
      const decisions=Object.fromEntries(Object.entries(shared('rig.compactionDecisions')??{})
        .filter(([,record])=>!(record?.deadline<now)));
      if(step.start){
        this.compactionStarting=true;
        this.compactionDeadline=now+step.start.waitMs;
        decisions[step.token]={status:'allow',deadline:this.compactionDeadline};
        setShared('rig.compactionDecisions',decisions);
        this.waitForCompactionStart(cx,step);cx.notify();
      }else{
        setShared('rig.compactionDecisions',{...decisions,[step.token]:'allow'});
        this.dismiss();
      }
      return;
    }
    if(step.action==='resume'&&(this.resumePlan?.ready!==true||this.result))return;
    if(step.action==='resume')this.resetResumeRollCall();
    if(step.action==="close-old-views"){
      step={...step,views:(step.views??[]).filter(view=>!oldViewsGone(shared,this.config).includes(view.id))};
      if(this.cleanupQueued)return;
      if(oldStripCleanupBusy(shared)){
        this.cleanupQueued=true;
        this.result={ok:false,text:'A cleanup is already running in this window. Wait for its result.'};
        cx.notify();return;
      }
      if(!layoutShowsMod(layout(),MOD_IDS.sidebar)){this.result={ok:false,notSent:true,text:"Open the Rig sidebar, then try again. Nothing was closed."};cx.notify();return;}
      const closeOnly=this.oldStripCloseOnly(step);
      if(!closeOnly&&!this.oldStripChoices?.some(choice=>choice.name===this.oldStripLayout))return;
      this.cleanupQueued=true;
      // Hand off before any await: closing this result must not cancel the confirmed operation or release its transport.
      const id=`old-views-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setShared('rig.oldViewsClose',{...(shared('rig.oldViewsClose')??{}),[id]:{createdAt:Date.now(),config:this.openedOn??this.config,views:step.views??[],...(!closeOnly?{returnLayout:this.oldStripLayout}:{})}});
      run('rig.close-old-views');
      this.result={ok:true,text:closeOnly?`Closing OpenRig's old view${step.views.length===1?'':'s'}… The Rig sidebar will report the result; you can close this dialog. The strip stays until you choose a layout from the palette (Ctrl+Shift+P, then Layout). Your seats keep running.`:"Leaving OpenRig's old strip… The result will show when it finishes; you can close this dialog. Your seats keep running."};cx.notify();return;
    }
    if (["send", "queue", "reply"].includes(step?.action) && !this.inputCanSend(step)) return;
    if ((step?.action === "launch-spec" || step?.action === "new-rig") && this.uncertainAttempt) return; // a launch or create that may have gone through is never run again from this dialog (Enter in a field comes here too)
    if ((step?.load === "pause" || ["pause", "archive-rig", "delete-rig"].includes(step?.action)) && !this.reviewReady()) return;
    const assistantReason=assistantActionRefusal(target,step.action);
    if(assistantReason){this.result={ok:false,notSent:true,text:assistantReason};cx.notify();return;}
    if(['open-view','open-seat','follow','unfollow','prune'].includes(step.action)){
      if(layoutShowsMod(layout(),MOD_IDS.sidebar)){oneClick(target,step.action);this.dismiss();}
      else{this.result={ok:false,notSent:true,text:"Worker view needs Herdrig's Rig sidebar. Open it, then try again. Nothing was opened."};cx.notify();}
      return;
    }
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
    if(step.action==="adopt-address-space"){
      if(!step.token||this.spaceAdoptionSubmitted)return;
      this.spaceAdoptionSubmitted=true;
      setShared("rig.spaceAdoptionDecisions",{...(shared("rig.spaceAdoptionDecisions")??{}),[step.token]:"allow"});
      this.dismiss();return;
    }
    if (step.action === "unarchive-rig") { this.unarchive(cx, target); return; }
    if (step.action === "confirm-machine") {
      if (!step.token) return;
      if (!sidebarShownOrGuidance("rig.confirm-machine")) return;
      setShared("rig.machineConfirmation", step.token);
      run("rig.confirm-machine"); this.dismiss(); return;
    }
    if (step.action === "replace-viewer") {
      // The person's click: only now is the old Attach viewer stopped and its tab closed, and the fresh
      // one started in its place. Cancel keeps everything exactly as it is.
      const found = targetConnection(this.config, { conn: adoptConnection(this.config, target.conn) });
      if (!found.ok) { this.result = { ok: false, notSent: true, text: found.reason }; cx.notify(); return; }
      this.run(cx, "Replacing", async (cx) => {
        const attach = (wait) => attachToSeat({ exec: execFor(found.config), run: runFor(found.config), hc: hcFor(found.config), spaces, panes, terminals, layout, shared, setShared, notify, seatShared: seatSharedOf(this.config, shared), wait, relayPath: attachRelayPath(appHome(), MOD_IDS.menu) },
          complete(target, this.config), found.config, { replaceViewer: true, ...(step.operator ? { operator: true } : {}), ...(step.name ? { name: step.name } : {}) });
        const res = await attach(waitWith(cx));
        // A routed result is a receipt that the Rig sidebar took the request, not proof the viewer was replaced:
        // never claim the tab is current unless the replace actually ran here.
        if (res?.ok && !res.routed) return { ok: true, text: "The Attach tab now runs the current viewer." };
        if (res?.routed) return { ok: true, text: "The Rig sidebar is replacing the older viewer. Check the seat's tab there for the result." };
        const text = res?.reason ?? "The Attach viewer could not be replaced.";
        const acted = Boolean(res?.unconfirmed || /older viewer was stopped|may already have started/i.test(text));
        return { ok: false, ...(acted ? { uncertain: true } : { notSent: true }), text };
      }, { dismissOnSuccess: true });
      return;
    }
    if (step.action === "rebuild-space") {
      if (!step.recovery?.tiles?.length || !step.token) return;
      if (!sidebarShownOrGuidance("rig.rebuild-space")) return;
      this.busy = "Rebuilding";
      setShared("rig.rebuildRequest", { rigId: target.rigId, token: step.token });
      run("rig.rebuild-space"); this.dismiss(); return;
    }
    if(step.action==="move-grid") {
      if(!step.token||!step.relocation?.source)return;
      if(!sidebarShownOrGuidance("rig.move-grid"))return;
      setShared("rig.gridMoveRequest",{rigId:target.rigId,token:step.token});
      run("rig.move-grid");this.dismiss();return;
    }
    const capAction = step.action === "design-view" ? "open-designed-view" : (step.action === "reply" && target?.reply === "answer" ? "reply-answer" : step.action);
    const disableReason = capabilityDisableReason(capAction, this.caps(target)) ?? (this.config ? personDisableReason(step.action, this.config) : null);
    if (disableReason) {
      if (step.action === "design-view") this.designError = disableReason;
      else this.result = { ok: false, notSent: true, text: disableReason };
      cx.notify();
      return;
    }
    if (step.action === "delete-rig") {
      this.deleteConfirmed = { seats: this.pauseSeatIds ?? null }; // what the person confirmed (the dialog is for one rig, read by its id): the seats a Retry of this delete must still find
      if (target.rig === "kernel") { this.result = { ok: false, notSent: true, text: "The kernel is OpenRig's own rig: it isn't deleted or archived from here." }; cx.notify(); return; }
      this.run(cx, `Deleting ${target.rig}`, async () => {
        const r = await this.write(this.argsFor(target, "delete-rig"));
        if (r.json?.deleted) {
          // A deleted rig's inspection cannot refresh. Remove its history entries while keeping other pages.
          const nav = shared("rig.nav");
          if (nav?.stack) {
            const sameConn = (entry) => !target.conn || !entry.conn || entry.conn === target.conn;
            const stack = nav.stack.filter((entry) => target.archived
              ? !(sameConn(entry) && target.rigId && entry.rigId === target.rigId)
              : !(sameConn(entry) && (entry.rig === target.rig || (target.rigId && entry.rigId === target.rigId) || (entry.kind === "rig" && entry.name === target.rig))));
            setShared("rig.nav", { ...nav, stack: stack.length ? stack : [this.topologyFallback(target)] });
          }
          const sameConn = (entry) => !target.conn || !entry.conn || entry.conn === target.conn;
          this.scrubTabPages(target, (entry) => target.archived
            ? sameConn(entry) && target.rigId && entry.rigId === target.rigId
            : sameConn(entry) && (entry.rig === target.rig || (target.rigId && entry.rigId === target.rigId) || (entry.kind === "rig" && entry.name === target.rig)));
          refreshSidebar();
        }
        return { ...r, kind: "delete" };
      }, { kind: "delete" });
      return;
    }
    if (step.action === "new-rig") {
      const createReason = this.newMode === "seat" ? capabilityDisableReason("create-rig", this.caps(target)) : null;
      const { problem, args } = this.newRigArgs();
      if (createReason || problem || !args) {
        this.newProblem = createReason ?? problem ?? "Nothing to run.";
        this.newProblemField = this.newMode === "spec" && /spec|\.yaml/i.test(this.newProblem) ? "spec"
          : /rig.*name|name.*rig/i.test(this.newProblem) ? "name" : /folder|path.*absolute/i.test(this.newProblem) ? "folder" : "spec";
        this.forgetResult(); cx.notify(); return;
      }
      this.newProblem = null;
      const folder = (this.folder?.value() ?? "").trim(), name = (this.rigName?.value() ?? "").trim();
      setShared("rig.drafts", { ...(shared("rig.drafts") ?? {}), "launch-folder": folder });
      const fromSpec = this.newMode === "spec", spec = this.newSpec?.name ?? this.newSpec?.sourcePath, runtime = this.newRuntime;
      this.run(cx, fromSpec ? "Launching" : "Creating", async () => {
        const r = await this.write(args, fromSpec ? { env: launchSpecEnv("") } : undefined);
        if (r.ok) refreshSidebar();
        const createdRig = r.json?.rig?.id ?? r.json?.rigId ?? r.json?.rig?.name ?? r.json?.name ?? (name || spec);
        return r.ok ? { ...r, kind: "new-rig", createdRig, text: fromSpec ? `${spec} launched${name ? ` as ${name}` : ""}.` : `${name} created with one ${runtime} seat.` }
          : r.notSent ? r /* refused before anything was sent: its own sentence, not "OpenRig refused" */ : { ...r, text: r.uncertain || /timed? ?out|timeout/i.test(r.text ?? "") ? "OpenRig didn't answer in time. Check the rig list before trying again." : `OpenRig refused: ${r.text || "no reason was reported."}` };
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
      if (problem || !args) { this.result = { ok: false, notSent: true, text: problem ?? "Nothing to launch: the spec has no name or file." }; cx.notify(); return; }
      this.run(cx, "Launching", async () => { const r = await this.write(args, { env: launchSpecEnv(host) }); if (r.ok) refreshSidebar(); return r; });
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
      this.run(cx, "Opening", async () => { const r = await this.write(args); if (r.ok) refreshSidebar(); return r; }, { dismissOnSuccess: true }); // closes itself once the step is over: closing from inside the work would say it was still going
      return;
    }
    if (step.action === "change-model") {
      if (this.swapRuntime !== "agy" && this.swapCatalog?.status === "loading") return;
      const seats = this.swapSeats ?? this.rigSeats(target);
      const plan = this.swapPlan(target);
      if (plan.error || !plan.isAgy && !plan.nextModel) {
        this.swapError = plan.error ?? "Pick or type a model first.";
        cx.notify();
        return;
      }
      if (!plan.recipient) {
        this.result = { ok: false, notSent: true, text: plan.routingError ?? "No lead or advisor seat found to route the change." };
        cx.notify();
        return;
      }
      if (plan.requiresConfirm && !this.swapConfirmed) {
        this.swapError = "Confirm the session transition checkbox before queueing.";
        cx.notify();
        return;
      }
      this.swapError = null;
      this.changeQueuedFor = plan.recipient; // the queue the change goes to: named if it may have left
      const args = this.argsFor({
        ...target,
        runtime: this.swapCurRuntime,
        model: this.swapCurModel,
        effort: this.swapCurEffort,
        nextRuntime: this.swapRuntime,
        nextModel: this.swapModel,
        nextEffort: this.swapEffort,
        representative: this.swapRepresentative,
        seats,
        catalog: this.swapCatalog,
      }, "change-model");
      this.run(cx, "Queueing", async () => {
        const r = await this.write(args);
        if (r.ok) refreshSidebar();
        return r;
      });
      return;
    }
    const text = this.input ? this.input.value().trim() : "";
    if (["send","queue","reply"].includes(step.action)) this.submittedText=text;
    if (step.input && !text) return;
    if (step.action === "reply") {
      this.run(cx, "Sending", async () => {
        // To the target's own daemon, resolved the way `write` resolves it; nothing is sent when it can't be.
        const conn = targetConnection(await this.currentConfig(), target);
        if (!conn.ok) return { ok: false, notSent: true, text: conn.reason };
        const cfg = conn.config;
        if (!cfg.daemonUrl) return { ok: false, notSent: true, text: cfg.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up')." };
        const op = gatedOperation(cfg.connectionId);
        const refused = await missionActionPreflight(cfg, op);
        if (refused) return refused;
        const r = await submitMissionActions(cfg, target, {
          kind: target.reply === "resolve" ? "resolve" : "answer-text",
          text,
          revision: target.decisionRevision ?? null,
        }, { fetch: op.fetch });
        if (r.ok) refreshSidebar();
        if (!r.ok && r.code === "decision_revision_changed" && !r.partial) {
          const msg = "The request changed since you opened it. Open it in Needs-You to read the latest version before answering.";
          return { ...r, message: msg, text: msg };
        }
        return r;
      });
      return;
    }
    if (step.action === "pause") {
      const reviewedSeats = this.pauseSeatIds;
      this.run(cx, "Pausing", async (taskCx) => {
        const rosterProblem = await this.checkReviewedRoster(target, reviewedSeats, "pausing");
        if (rosterProblem) return { ok: false, notSent: true, text: rosterProblem };
        return this.write(this.argsFor(target, "pause", text), undefined, taskCx);
      });
      return;
    }
    const label = { resume: "Resuming", fresh: "Starting fresh" }[step.action] ?? "Working";
    const reviewed = step.action === "resume" && this.resumePlan?.supported ? this.resumePlan : null;
    this.run(cx, label, async taskCx => {
      if (reviewed) {
        try {
          const {plan} = await this.readResumePlan(target, this.resumePlanConfig);
          if (this.gone) return null;
          if (!plan.supported) throw new Error("OpenRig no longer offers a restore plan. Nothing was started.");
          if (restorePlanIdentity(plan) !== restorePlanIdentity(reviewed)) {
            this.resumePlan = { ...plan, changed: true };
            return null;
          }
        } catch (error) {
          if (!this.gone) this.resumePlan = { error: plainExecError(error, {kind:"read"}) };
          return null;
        }
      }
      return this.write(this.argsFor(target, step.action, text),undefined,taskCx);
    });
  }

  /** Modal body: change seat harness, model, and effort (via the lead, or the advisor for a lead change). */
  /** `rig.space:<conn>|<rig>` for a rig of the OpenRig `target` names. herdr delivers a mod command by NAME only, so with several OpenRigs the connection is in the name and a target that names none, or one no longer
   *  listed, sends nothing: the person is told, never a bare command. One connection: `rig.space:<rig>`. Used by the row menu and by the New rig result. */
  spaceCommand(target, rig) {
    const several = (this.config?.connections?.length ?? 0) > 1;
    if (several && !(target?.conn && configOfConnection(this.config, target.conn))) { notify({ title: "Open rig space", body: target?.conn ? UNKNOWN_CONNECTION : NO_CONNECTION, level: "warning" }); return null; }
    return commandFor("rig.space", target?.conn ? { ...this.config, connectionId: target.conn } : this.config, rig);
  }

  /** An archived or deleted rig's pages leave every Rig tab's own history. A tab left with nothing shows that OpenRig's Topology, never a page
   *  that names no OpenRig when several are set up. */
  scrubTabPages(target, drop) {
    const all = shared("rig.tabPages");
    if (!all || typeof all !== "object") return;
    const several = (this.config?.connections?.length ?? 0) > 1;
    const next = tabPagesScrub(all, drop, { conn: several ? target.conn ?? null : null, several });
    if (next !== all) setShared("rig.tabPages", next);
  }

  changeModelView(t, cx, target) {
    const plan = this.swapPlan(target);
    const catalog = this.swapCatalog ?? { status: "loading" };
    const same = this.swapRuntime === this.swapCurRuntime;
    const sameModel = same && this.swapModel === this.swapCurModel;
    const load = catalog.status === "loading";
    const failed = catalog.status === "unavailable";
    const failureReason = catalog.reason?.replace(/[.!?]+$/, "") ?? "the list does not report effort levels for this model";
    const models = [...plan.allowedModels];
    if (same && filterAllowedModels([this.swapCurModel]).length && !models.includes(this.swapCurModel)) models.unshift(this.swapCurModel);
    const efforts = [...plan.allowedEfforts];
    if (sameModel && this.swapCurEffort && !efforts.includes(this.swapCurEffort)) efforts.unshift(this.swapCurEffort);
    const pill = (id, label, active, onClick, tooltip) => this.dialogButton(t,div().id(id).px(8).h(24).rounded(5).flex().items_center().text_size(12).cursor_pointer()
      .bg(active ? t.accent : t.raised).text_color(active ? (t.solid_foreground ?? t.background) : t.muted).border_1().border_color(active ? t.accent : t.border)
      .hover((s) => s.bg(active ? t.accent : t.hover)).when(!!tooltip, el=>el.tooltip(tooltip)),null,(_e,cx)=>{onClick(cx);cx.notify();},false,label);
    const currentLabel = (value, current, listed, markCurrent = same) => markCurrent && value === current
      ? `${value} · current${listed || load ? "" : " · not listed"}` : value;
    const sourceAge = catalog.fetchedAt && catalog.fetchedAt <= Date.now()
      ? `updated ${Math.floor((Date.now()-catalog.fetchedAt)/60000)} min ago` : "may be out of date";
    const effortKnown = Array.isArray(catalog.runtimeEfforts) || Array.isArray(catalog.models?.find(model => model.id === this.swapModel)?.efforts);
    const muted = (id, text) => div().id(id).text_size(11.5).text_color(t.muted).child(text);
    const toneColor = plan.tone === "working" ? (t.working ?? t.accent) : plan.tone === "warn" ? (t.ansi3 ?? t.blocked) : (t.blocked ?? t.foreground);
    return v_flex().id("change-model-view").gap(10)
      // With several OpenRigs the dialog says which one the seat is on: a name two boxes share must never be changed on the wrong one unseen.
      .when((this.config?.connections?.length ?? 0) > 1 && !!target.conn, (el) => el.child(div().id("change-model-box").text_size(11.5).text_color(t.dim).child(`${target.logicalId ?? target.session} on ${connectionBoxLabel(this.config, target.conn)}`)))
      .child(div().text_size(11.5).text_color(t.muted).child(
        `Current: ${this.swapCurRuntime}${this.swapCurModel ? ` · ${this.swapCurModel}` : ""}${this.swapCurEffort ? ` · ${this.swapCurEffort}` : ""}`
      ))
      .child(v_flex().gap(4)
        .child(div().text_size(11).font_semibold().text_color(t.dim).child("Harness"))
        .child(h_flex().id("swap-runtimes").gap(4).flex_wrap().children(SWAP_RUNTIMES.map((r) => pill(`swap-runtime-${r}`, r, this.swapRuntime === r, next => {
          if (this.swapRuntime === r) return;
          this.swapRuntime = r;
          this.swapModelInput.set_value("");
          this.swapManual = false;
          this.swapModel = r === this.swapCurRuntime ? this.swapCurModel : null;
          this.swapEffort = r === this.swapCurRuntime ? this.swapCurEffort : null;
          this.swapConfirmed = false;
          this.swapError = null;
          this.refreshSwapCatalog(next, target);
        })))))
      .child(this.swapRuntime === "agy"
        ? div().id("swap-agy-note").p(8).rounded(6).bg(t.raised).text_size(12).text_color(t.muted).child("agy's model and effort live in agy's own settings")
        : v_flex().gap(8)
            .child(v_flex().gap(4)
              .child(div().text_size(11).font_semibold().text_color(t.dim).child("Model"))
              .when(!same && !!this.swapCurModel, el=>el.child(muted("swap-old-model", `The current model (${this.swapCurModel}) is ${this.swapCurRuntime}'s; pick one for ${this.swapRuntime}.`)))
              .when(load, el=>el.child(muted("swap-catalog-loading", `Reading ${this.swapRuntime}'s models…`)))
              .when(failed, el=>el.child(muted("swap-catalog-error", `Couldn't read ${this.swapRuntime}'s model list: ${failureReason}. Type a model ID instead.`))
                .child(pill("swap-read-again","Read again",false,next=>this.refreshSwapCatalog(next,target))))
              .when(catalog.source === "codex-local-model-list", el=>el.child(muted("swap-catalog-source", `From Codex's local model list · ${sourceAge}`)))
              .child(h_flex().id("swap-models").gap(4).flex_wrap().children(models.map(model => {
                const listed = plan.allowedModels.includes(model);
                const tooltip = !listed && !load ? `${model} isn't in ${this.swapRuntime}'s list right now. Keep it, or pick another.`
                  : catalog.source === "claude-help" && listed ? "An alias from Claude's own help; Claude picks the model it names." : null;
                return pill(`swap-model-${model}`, currentLabel(model,this.swapCurModel,listed), this.swapModel===model, () => {
                  this.swapManual=false;
                  this.selectSwapModel(model);
                }, tooltip);
              })).when(!failed&&!load,el=>el.child(pill("swap-other-model","Other model…",this.swapManual,()=>{
                this.swapManual=true;
                this.selectSwapModel(this.swapModelInput.value().trim()||null);
                this.swapModelInput.focus();
              }))))
              .when(failed||this.swapManual,el=>el.child(div().id("swap-manual-model").child(this.dialogField(this.swapModelInput,Input)))
                .child(muted("swap-model-id-help", `Sent to ${this.swapRuntime} as you type it; ${this.swapRuntime} checks the name when the seat starts.`))))
            .child(v_flex().gap(4)
              .when(efforts.length>0,el=>el.child(div().text_size(11).font_semibold().text_color(t.dim).child("Effort"))
                .child(h_flex().id("swap-efforts").gap(4).flex_wrap().children(efforts.map(level=>pill(
                  `swap-effort-${level}`,currentLabel(level,this.swapCurEffort,plan.allowedEfforts.includes(level),sameModel),this.swapEffort===level,
                  ()=>{this.swapEffort=level;this.swapError=null;},
                  plan.allowedEfforts.includes(level)||load?null:`${level} isn't in ${this.swapRuntime}'s effort list right now. Keep it, or pick another.`,
                )))))
              .when(!load&&!effortKnown&&(failed||!!this.swapModel),el=>el.child(muted("swap-effort-unavailable",
                `Couldn't read ${this.swapRuntime}'s effort levels: ${failureReason}. ${same?"The seat keeps its current effort.":"Its default effort applies."}`)))
              .when(!load&&effortKnown&&!plan.allowedEfforts.length,el=>el.child(muted("swap-effort-unsupported",`${this.swapRuntime} has no effort setting.`)))))
      .when(plan.nextRuntime!==this.swapCurRuntime||plan.nextModel!==this.swapCurModel||plan.nextEffort!==this.swapCurEffort,
        el=>el.child(muted("swap-will-use", `Will use: ${[plan.nextRuntime,plan.nextModel,plan.nextEffort].filter(Boolean).join(" · ")}`)))
      .child(v_flex().id("swap-continuity").p(8).gap(4).rounded(6).bg(t.raised).border(1).border_color(t.border)
        .child(div().text_size(12).font_semibold().text_color(toneColor).child(plan.badge))
        .child(div().text_size(11.5).text_color(t.muted).child(plan.detail))
        .child(div().id("swap-routing").text_size(11).text_color(t.dim).child(
          plan.recipient
            ? `Routes via ${plan.recipientLogicalId} (${plan.recipient}) · OpenRig runs ${plan.cliPreview}`
            : this.swapLeadPending ? "Reading the rig's lead…" : plainError(plan.routingError ?? "No lead or advisor seat found.").text
        )))
      .when(plan.requiresConfirm, (el) => el.child(h_flex().id("swap-confirm").gap(6).items_center().cursor_pointer()
        .on_click((_e, cx) => { this.swapConfirmed = !this.swapConfirmed; this.swapError = null; cx.notify(); })
        .child(div().w(13).h(13).flex_none().rounded(3).border_1().border_color(this.swapConfirmed ? t.accent : t.border).flex().items_center().justify_center()
          .when(this.swapConfirmed, (box) => box.bg(t.accent).child(svg(icon("check")).size(10).text_color(t.solid_foreground ?? t.background))))
        .child(div().text_size(12).child(plan.continuity === "fresh"
          ? "I understand switching to or from agy starts a fresh session"
          : "I understand switching harnesses hands over to a new session"))))
      .when(!!this.swapError, (el) => el.child(div().id("swap-error").child(errorBlock(this,t,"swap-error-detail",this.swapError))));
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
          .when(!!this.designError, (el) => el.child(errorBlock(this,t,"design-error",this.designError)))));
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
    if(step.action==='close-old-views')step={...step,views:(step.views??[]).filter(view=>!oldViewsGone(shared,this.config).includes(view.id))};
    this.dialogRenderCx=cx;this.dialogButtonIndex=0;
    this.dialogFirstControl=step.action==='design-view'?this.handle:null;
    this.dialogLastControl=null;
    const result = this.result;
    const title = ["delete-rig", "archive-rig", "unarchive-rig"].includes(step.action) && result
      ? result.kind === "archive" ? (result.ok ? `${target.rig} archived` : result.uncertain ? `${target.rig} may be archived` : `Couldn't archive ${target.rig}`)
        : result.kind === "unarchive" ? (result.ok ? `${target.rig} restored` : `Couldn't restore ${target.rig}`)
        : result.ok && result.json?.deleted && !result.json?.deleteBlocked && !result.json?.errors?.length
          ? `${target.rig} deleted` : `Couldn't delete ${target.rig}`
      : step.action === 'confirm-seat-compaction' ? step.copy?.title??'Compact this seat?'
      : step.action === "typing-guard" ? "Typing guard"
      : step.action === "close-old-views" ? "Leave OpenRig's old strip?"
      : step.action === "spaces-list" ? (step.copy?.title ?? "Spaces list")
      : step.action === "confirm-spec-write" ? (step.confirmation?.capability === "copy-folder" ? `Copy built-in specs on ${step.confirmation?.machine}?` : `Save specs on ${step.confirmation?.machine}?`)
      : step.action === "adopt-address-space" ? "Use this existing rig space?"
      : step.action === "confirm-machine" ? `Open seats on ${step.confirmation?.machine}?`
      : step.action === "replace-viewer" ? `Replace ${target.logicalId ?? target.session}'s Attach viewer?`
      : step.action === "move-grid" ? `Move ${target.rig} to ${step.relocation?.machine}?`
      : step.action === "rebuild-space" ? `Rebuild ${target.rig}'s tiles?` : actionTitle(target, step.action);
    const go = (cx) => this.go(cx, target, step);
    let body = null;
    if(step.action==='confirm-seat-compaction')body=div().text_size(12).text_color(this.compactionStartMessage?t.blocked:t.muted)
      .child(this.compactionStartMessage??(this.compactionStarting?step.start.starting:step.copy?.body??''));
    else if(step.action==='typing-guard')body=this.result?null:div().child(step.confirmationText??TYPING_GUARD_TIP);
    else if(step.action==="close-old-views"){
      const choices=this.oldStripChoices;
      const count=step.views?.length??0,available=this.oldStripCloseAvailable(),canClose=available===true;
      const switchText='This switches this window to the layout you pick.';
      const intro=!count||available===null?switchText:canClose?`This closes OpenRig's ${count} old worker view${count===1?'':'s'} and switches this window to the layout you pick.`:
        `${switchText} ${count===1?"The old view can't be closed from here, so it may stay open.":`The ${count} old views can't be closed from here, so they may stay open.`}`;
      if(choices?.length===1&&choices[0].name==='main'&&!this.oldStripLayout)this.oldStripLayout='main';
      body=v_flex().gap(8).text_size(12).text_color(t.muted)
        .child(div().child(intro+' Your seats keep running, and the Rig page stays open.'));
      if(!choices)body.child(div().child('Reading layouts…'));
      else if(!choices.length){
        const count=step.views?.length??0,closeOnly=this.oldStripCloseOnly(step);
        const text=closeOnly?`herdrig couldn't find a layout to switch to, so this window stays in OpenRig's old layout. You can still close ${count===1?'the old view':`the ${count} old views`}; the strip stays until you choose a layout from the palette (Ctrl+Shift+P, then Layout). Your seats keep running.`
          :`herdrig couldn't find a layout to switch to${count&&available===false?`, and the old view${count===1?'':'s'} can't be closed from here`:''}. Open the palette (Ctrl+Shift+P) and choose a Layout. Your seats keep running.`;
        body=v_flex().gap(8).text_size(12).text_color(t.muted).child(div().child(text));
      }
      else body.child(div().child('Switch to')).children(choices.map(choice=>this.dialogButton(t,
        v_flex().id(`old-strip-layout-${choice.name}`).gap(2).p(6).rounded(5).bg(this.oldStripLayout===choice.name?t.selected:t.raised),null,
        (_e,cx)=>{this.oldStripLayout=choice.name;cx.notify();},false,
        v_flex().gap(2).child(div().child(choice.label)).when(choice.name==='main',el=>el.child(div().text_size(11).child("Herdr's standard layout, without the Rig sidebar"))))))
        .child(div().child("Pick the layout you used before. herdrig can't tell which one that was."));
    }
    else if(step.action==="confirm-spec-write"){
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
    } else if(step.action==="adopt-address-space"){
      body=v_flex().gap(10)
        .child(div().child(`This space was made with ${step.confirmation?.origin}. The selected OpenRig is now at ${step.confirmation?.daemonUrl}.`))
        .child(div().child("Its host stamp matches, but Herdr cannot independently confirm its seats. Use it only if this is the same OpenRig at a new address."))
        .child(div().child("Use it updates the address on its viewers. Its tabs and seats stay open. Cancel leaves everything unchanged."));
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
    } else if(step.action==="replace-viewer"){
      body=v_flex().gap(8)
        .child(div().child(`The Attach tab for ${target.logicalId ?? target.session} is running a viewer from before an update.`))
        .child(div().text_color(t.muted).child("Replacing it stops that old viewer and closes its tab, then starts the current one. The seat keeps running either way."))
    } else if (step.action === "move-grid") {
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
      body = errorBlock(this,t,"menu-info",step.text ?? "",{where:"this computer"});
    } else if (step.action === "reply" && this.inputCanSend(step) && target.summary && target.summary !== target.id) {
      body = div().id("rig-reply-summary").flex_none().h(20).truncate().tooltip(rowTip(target.summary)).text_color(t.muted).child(rowText(target.summary));
    } else if (step.action === "pause" && !this.result && !this.busy) {
      const p = this.pause;
      body = !p ? div().text_color(t.muted).child("Reading the rig…") : p.error ? errorBlock(this,t,"pause-error",p.error)
        : v_flex().gap(3)
          .child(div().child(p.total === 0 ? "It has no running agents, so nothing is stopped." : `${p.total === 1 ? "This stops its one agent." : `This stops all ${counted(p.total, "agent")}.`} Work in progress stops with them:`))
          .children(p.busy.map((s) => h_flex().gap(8).child(statusMarkElement({ div, svg }, t, s.status ?? s.tone, { iconOf: icon })).child(div().w(130).truncate().tooltip(String(s.logicalId??"")).child(s.logicalId))
            .child(div().text_color(t.muted).child(`${s.word}${s.owned ? ` · ${s.owned} owned item${s.owned === 1 ? "" : "s"}` : ""}`))))
          .child(div().text_color(t.dim).child("OpenRig snapshots first (best effort). Resume brings back each conversation where the harness allows."));
    } else if (step.action === "archive-rig" && !this.result && !this.busy) {
      body = !this.pause ? div().text_color(t.muted).child("Reading the rig…") : this.pause.error ? errorBlock(this,t,"delete-pause-error",this.pause.error)
        : div().text_color(t.muted).child(this.rigRunning(target)
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
      const launchConnection = targetConnection(this.config, { ...target, conn: adoptConnection(this.config, target.conn) });
      body = v_flex().gap(8)
        .child(div().text_color(t.muted).child(`${target.name}: the seats start in the folder below and run until paused.`))
        .child(div().id("launch-source").text_size(11.5).text_color(sourceProblem ? t.blocked : t.dim).child(sourceProblem ?? `rig up -- ${source}`))
        .child(field("Working folder", this.folder))
        .child(div().id("launch-folder-machine").text_size(11.5).text_color(t.dim).child(`This folder must exist on ${launchConnection.ok && launchConnection.config.daemonMachine || "the machine running OpenRig"}.`))
        .child(field("Host (optional)", this.host));
    } else if (step.action === "resume" && !this.result && !this.busy) {
      body = this.resumeReadView(t,cx,target,'plan');
    }
    const swapPlan = step.action === "change-model" ? this.swapPlan(target) : null;
    const confirmLabel = step.action === "change-model"
      ? swapPlan.buttonLabel
      : step.action === 'confirm-seat-compaction' ? step.copy?.confirm??'Compact now'
      : step.action === "typing-guard" ? (step.mode==='off'?'Turn it off':'Replace')
      : step.action === "close-old-views" ? (this.oldStripChoices?.length===0?(this.oldStripCloseOnly(step)?`Close the old view${step.views.length===1?'':'s'}`:null):"Leave the strip")
      : step.action === "spaces-list" ? (step.copy?.confirm ?? "Change")
      : step.action === "confirm-spec-write" ? (step.confirmation?.capability === "copy-folder" ? "Allow built-in copies" : "Allow spec saves")
      : step.action === "adopt-address-space" ? "Use it"
      : step.action === "confirm-machine" ? `Allow this machine`
      : step.action === "replace-viewer" ? "Replace viewer"
      : step.action === "move-grid" ? `Move ${target.rig}`
      : step.action === "rebuild-space" ? `Rebuild ${step.recovery?.tiles?.length ?? 0} tile${step.recovery?.tiles?.length===1?"":"s"}${step.continueMove?" and continue Move":""}`
      : step.action === "new-rig" ? (this.newMode === "seat" ? "Create" : "Launch")
      : step.action === "archive-rig" ? "Archive"
      : step.action === "delete-rig" ? `Delete ${target.rig}`
      : { pause: "Pause rig", resume: "Resume rig", fresh: "Start fresh", "design-view": "Open", send: "Send", queue: "Queue", reply: "Reply", "launch-spec": "Launch" }[step.action];
    const done = !!this.result?.ok;
    // Only while the dialog offers its button: never re-runs a one-click action or a finished one; launch-spec keeps its fields and Launch button after a validation error.
    const swapProblem = swapPlan?.error || (swapPlan && !swapPlan.isAgy
      ? this.swapCatalog?.status === "loading" ? "Wait for the model list" : !swapPlan.nextModel ? "Pick or type a model first" : null
      : null);
    const swapTooltip = (!this.swapLeadPending && swapPlan?.routingError) || swapProblem;
    const reviewFailed = !!swapProblem || Boolean(swapPlan && !swapPlan.recipient) || step.action==='resume'&&this.resumePlan?.ready!==true
      ||(step.load === "pause" || ["pause", "archive-rig", "delete-rig"].includes(step.action)) && !this.reviewReady()
      ||step.action==='close-old-views'&&!this.oldStripCloseOnly(step)&&!this.oldStripChoices?.some(choice=>choice.name===this.oldStripLayout); // No implicit layout choice.
    // change-model: after a failure that MAY have left, no second queue button (RESEND_UNSAFE); after a refusal that sent nothing it stays (nothing could have arrived).
    const canConfirm = !!confirmLabel && !(step.action==='close-old-views'&&this.cleanupQueued) && !(step.action==='confirm-seat-compaction'&&this.compactionConfirmed)
      && (step.action === "change-model" ? (!this.result || (!this.result.ok && this.result.notSent)) : (step.action === "launch-spec" || step.action === "new-rig" ? (!this.result?.ok && !this.uncertainAttempt) : step.action === "design-view" ? !this.result?.ok : this.inputCanSend(step))) && !this.busy && !step.run;
    const archiveReason = step.action === "delete-rig" ? capabilityDisableReason("archive-rig", this.caps(target)) : null;
    const heldUncertain = receiptUncertain(this.result);
    const heldDraft = !!this.input && knownHeldReceipt(this.result, step.action);
    const fixedResumePlan=step.action==='resume'&&!this.result&&!this.busy&&!!body&&this.resumePlan?.supported===true&&this.resumePlan?.ready===true;
    this.heldFocusControls=null;
    const messageComposer = !!this.input && (this.inputCanSend(step) || ["send","queue","reply"].includes(step.action) && heldUncertain);
    const mac = window()?.platform === "macos";
    return v_flex().id("rig-dialog").when(!!this.handle, (el) => el.track_focus(this.handle)).tab_stop(step.action==='design-view').size_full().p(14).gap(10).bg(t.surface).text_color(t.foreground).text_size(12.5)
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
          if(this.compactionStarting)return;
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
      // Read why the send was refused before editing it. This viewport is bounded; the draft owns spare height.
      .when((messageComposer || heldDraft) && (!!this.result || !!this.busy), el => el.child(v_flex().id("rig-dialog-body").flex_none().max_h(96).min_h(24)
        // The native scrollbar helper adds a size-full area. A plain capped scroll keeps short held receipts intrinsic.
        .when(heldDraft, content=>content.overflow_y_scroll()).when(!heldDraft, content=>content.overflow_y_scrollbar())
        .child(this.resultView(t, cx, target, step) ?? div())))
      .when(!!body && !["change-model","new-rig","confirm-spec-write","spaces-list","launch-spec","resume","close-old-views"].includes(step.action), (el) => el.child(body))
      .when(typeof step.note === "string" && !!step.note, (el) => el.child(div().id("rig-dialog-note").text_size(12).text_color(t.blocked).child(step.note)))
      .when(messageComposer, (el) => el.child(div().flex_1().min_h(108).border(1).border_color(t.border).rounded(6).p(6).child(this.dialogField(this.input,Textarea).size_full().min_h(96)))
        .child(div().text_size(11).text_color(t.dim).child(this.inputCanSend(step) ? `${mac ? "⌘ Return" : "Ctrl+Enter"} sends · Esc or a click outside closes; your text is kept until you send or cancel` : "Check whether it arrived before sending again. Your draft is kept.")))
      .when(heldDraft, el => el.child(this.heldDraftView(t,cx,target,step)))
      // Resume's explanation stays above its own scrolling seat rows, never inside another scroll area.
      .when(fixedResumePlan,el=>el.child(v_flex().id('rig-resume-review').flex_1().min_h(0).child(body)))
      // Long results and the model/harness form scroll; the action footer never shrinks into the body.
      .when(!messageComposer && !heldDraft && !fixedResumePlan && (step.action !== "design-view" || !!this.result || !!this.busy), (el) => el.child(v_flex().id("rig-dialog-body").flex_1().min_h(0).overflow_y_scrollbar()
        .when(["change-model","new-rig","confirm-spec-write","spaces-list","launch-spec","resume","close-old-views"].includes(step.action) && !!body&&(step.action!=='close-old-views'||!this.result), (content) => content.child(body))
        .child(this.resultView(t, cx, target, step) ?? div())))
      .child(h_flex().id("rig-dialog-footer").flex_none().gap(8).justify_end()
        .child(this.dialogButton(t,div().id("rig-cancel").px(12).h(26).rounded(6).bg(t.raised).flex().items_center().hover((s) => s.bg(t.hover)),this.dialogCancelHandle,
          () => { if(!done&&step.action==="rebuild-space"&&step.continueMove)notify({title:"Move not continued",body:"Both grids were left in place."});this.dismiss(!done); },!!this.compactionStarting,
          done || heldDraft || this.compactionConfirmed || step.action==='resume'&&this.result&&!this.result.notSent || step.action==='close-old-views'&&(this.cleanupQueued||this.oldStripChoices?.length===0&&!this.oldStripCloseOnly(step)) ? "Close"
            : step.action==='confirm-seat-compaction' ? step.copy?.dismiss??'Cancel' : step.action==='typing-guard'&&step.treatedAsHold ? "Keep" : "Cancel"))
        .when(done && step.action === "new-rig" && typeof result.createdRig === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(result.createdRig), el => el.child(
          this.dialogButton(t,div().id("new-rig-open-space").px(12).h(26).rounded(6).bg(t.accent).text_color(t.background ?? "#fff").flex().items_center().cursor_pointer(),this.dialogOpenSpaceHandle,
            () => { const command = this.spaceCommand(target, result.createdRig); if (command) { run(command); this.dismiss(); } },false,"Open rig space")))
        .when(heldDraft, el => el.child(div().id("rig-held-send").px(12).h(26).rounded(6).opacity(0.45).tooltip(step.action === "queue" ? "This row is already recorded." : "OpenRig already holds this message. Sending again would deliver it twice.").child(step.action === "queue" ? "Queue" : "Send")))
        .when(canConfirm && step.action === "delete-rig" && !target?.archived, (el) => el.child(this.dialogButton(t,div().id("rig-archive").px(12).h(26).rounded(6).bg(t.raised).border_1().border_color(t.border)
          .flex().items_center().hover((s) => s.bg(t.hover)).when(!!archiveReason, (b) => b.opacity(0.45).tooltip(archiveReason))
          ,this.dialogArchiveHandle,(_e,cx)=>this.archive(cx,target),!!archiveReason||reviewFailed,this.rigRunning(target) ? "Pause and archive" : "Archive")))
        .when(canConfirm, (el) => el.child(this.dialogButton(t,div().id("rig-confirm").px(12).h(26).rounded(6).when(reviewFailed, (b) => b.opacity(0.45).when(step.action==='close-old-views',el=>el.tooltip('Pick a layout first')))
          .when(!!swapTooltip, el=>el.tooltip(swapTooltip))
          .bg(step.action === "pause" || step.action === "fresh" || step.action === "delete-rig" ? t.blocked : t.accent)
          .text_color(step.action === "delete-rig" ? (t.surface ?? t.background ?? "#fff") : (t.background ?? "#fff")).flex().items_center(),this.dialogConfirmHandle,
          (_e,cx)=>go(cx),reviewFailed,confirmLabel))));
  }

  heldDraftView(t,cx,target,step) {
    this.dialogFirstControl??=this.heldTextHandle;
    const receipt=this.result?.json??{};
    // Released receipts describe custody, not the message body. Never mistake a status sentence for held text.
    const held=this.submittedText??this.input.value();
    const row=receipt.qitemId??receipt.qitem?.qitemId??receipt.qitem?.id??receipt.row?.id??null;
    this.heldFocusControls=[this.heldTextHandle,this.heldCopyHandle,...(step.action==="queue"&&row?[this.heldRowCopyHandle]:[]),this.dialogCancelHandle].filter(Boolean);
    const label=step.action==="queue" ? `Recorded${row?` as ${row}`:""} · its notice wasn't delivered`
      : step.action==="reply" ? `Your answer is recorded · not delivered to ${receipt.sessionName??target.session??target.asker??"the seat"} yet`
      : "Held by OpenRig · not delivered yet";
    // A fence longer than any submitted run makes all text literal, while native code text keeps real lines and spaces.
    const fence='`'.repeat(Math.max(3,...(String(held).match(/`+/g)??[]).map(run=>run.length+1)));
    const document=`${fence}\n${held}\n${fence}`;
    const leaveText=(backward,eventCx)=>{
      eventCx.stop_propagation();const target=backward?this.dialogCancelHandle:this.heldCopyHandle;
      this.dialogBoundaryTask?.cancel?.();
      this.dialogBoundaryTask=eventCx.timer.after(16,nextCx=>{if(!this.gone){target?.focus?.();nextCx.notify();}});
    };
    const copy=(value,key,eventCx)=>{
      eventCx.write_to_clipboard(value);this.heldCopied=key;this.heldCopyTimer?.cancel?.();
      this.heldCopyTimer=eventCx.timer.after(2000,nextCx=>{if(!this.gone){this.heldCopied=null;nextCx.notify();}});eventCx.notify();
    };
    return v_flex().id("rig-held-draft").flex_1().min_h(108).gap(6)
      .child(h_flex().gap(8).child(div().flex_1().text_size(11).text_color(t.dim).child(label))
        .child(this.dialogButton(t,div().id("rig-held-copy").px(6).h(24),this.heldCopyHandle,(_e,eventCx)=>copy(held,"text",eventCx),false,this.heldCopied==="text"?"Copied":"Copy"))
        .when(step.action==="queue"&&!!row,el=>el.child(this.dialogButton(t,div().id("rig-held-row-copy").px(6).h(24),this.heldRowCopyHandle,(_e,eventCx)=>copy(String(row),"row",eventCx),false,this.heldCopied==="row"?"Copied":"Copy row id"))))
      .child(div().id('rig-held-text-focus').flex_1().min_h(0).p(2).border(2).border_color('#00000000').rounded(6)
        .when(!!this.heldTextHandle,el=>el.track_focus(this.heldTextHandle)).tab_stop(true).focus(el=>el.border_color(t.accent))
        .key_context('RigHeldText').on_action('rig-held-next',(_event,eventCx)=>leaveText(false,eventCx))
        .on_action('rig-held-prev',(_event,eventCx)=>leaveText(true,eventCx))
        .on_action('rig-held-close',(_event,eventCx)=>{eventCx.stop_propagation();this.dismiss();})
        .on_key_down((event,eventCx)=>{if(String(event.key).toLowerCase()==='tab')leaveText(Boolean(event.modifiers?.shift),eventCx);})
        .child(TextView.markdown('rig-held-text',document).size_full().selectable(true).scrollable(true)));
  }

  /** Delete's confirmation: what stops (every seat, with its state and owned work), the command, and Archive instead. */
  deleteView(t, target) {
    const p = this.pause;
    const seats = p?.seats ?? [];
    const what = p && !p.error ? `${target.rig}'s ${seats.length} seat${seats.length === 1 ? "" : "s"}` : `every seat of ${target.rig}`;
    const list = !p ? div().text_color(t.muted).child("Reading the rig…") : p.error ? errorBlock(this,t,"rig-roster-error",p.error)
      : v_flex().id("delete-seats").gap(3).children(seats.map((s, i) => h_flex().id(`delete-seat-${i}`).gap(8).items_center()
        .child(statusMarkElement({ div, svg }, t, s.status ?? s.tone, { iconOf: icon })).child(div().w(130).truncate().tooltip(String(s.logicalId??"")).child(s.logicalId))
        .child(div().text_color(t.muted).child(`${s.word}${s.owned ? ` · ${s.owned} owned item${s.owned === 1 ? "" : "s"}` : ""}`))));
    return v_flex().id("delete-view").gap(8)
      .child(div().child(`${this.rigRunning(target) ? `This stops ${what} and deletes the rig. OpenRig takes a snapshot first.` : `This removes the stopped rig ${target.rig}.`} The rig can't be brought back by name afterwards.`))
      .child(list)
      .child(div().id("delete-command").text_size(11.5).text_color(t.dim).child(commandLine(this.argsFor(target, "delete-rig"))))
      .child(div().text_size(11).text_color(t.dim).child("Seats joined with rig attach keep running; the result lists them."))
      .when(!target?.archived, (el) => el.child(v_flex().id("delete-archive-box").gap(2).p(8).rounded(6).bg(t.raised).border_1().border_color(t.border)
        .child(div().font_semibold().child("Want it back later?"))
        .child(div().text_color(t.muted).child("Archive hides the rig and keeps everything. A running rig is paused first."))));
  }

  /** New rig: a two-choice control (from a spec, or one seat), its fields, and the command it will run. */
  newRigView(t) {
    const pill = (id, label, active, onClick) => this.dialogButton(t,div().id(id).px(8).h(24).rounded(5).flex().items_center().text_size(12).cursor_pointer()
      .bg(active ? t.accent : t.raised).text_color(active ? (t.solid_foreground ?? t.background) : t.muted).border_1().border_color(active ? t.accent : t.border)
      .hover((s) => s.bg(active ? t.accent : t.hover)),null,(_e,cx)=>{this.newFocusTouched=true;onClick();cx.notify();},false,label);
    const label = (text) => div().text_size(11.5).text_color(t.dim).child(text);
    const field = (text, state) => v_flex().gap(3).child(label(text)).child(div().border(1).border_color(t.border).rounded(6).px(6).py(4).child(this.dialogField(state,Input)));
    const seat = this.newMode === "seat";
    const createReason = seat ? capabilityDisableReason("create-rig", this.caps(props()?.target)) : null;
    const specs = this.newSpecs;
    const specList = !specs ? div().text_color(t.muted).child("Reading the spec library…")
      : specs.error ? errorBlock(this,t,"new-rig-specs-error",specs.error)
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
        .child(pill("new-rig-mode-spec", "From a spec", !seat, () => { this.newMode = "spec"; this.newProblem = null; this.forgetResult(); }))
        .child(pill("new-rig-mode-seat", "One seat", seat, () => { this.newMode = "seat"; this.newProblem = null; this.forgetResult(); })))
      .when(!seat, (el) => el.child(v_flex().gap(3).child(label("Spec")).child(specList)
        .when(!!this.newProblem && this.newProblemField === "spec", x => x.child(div().id("new-rig-spec-error").text_size(11.5).text_color(t.blocked).child(this.newProblem))))
        .child(field("Working folder", this.folder))
        .when(!!this.newProblem && this.newProblemField === "folder", x => x.child(div().text_size(11.5).text_color(t.blocked).child(this.newProblem)))
        .child(field("Name (optional: run a spec twice under another name)", this.rigName))
        .when(!!this.newProblem && this.newProblemField === "name", x => x.child(div().text_size(11.5).text_color(t.blocked).child(this.newProblem))))
      .when(seat, (el) => el.child(field("Name", this.rigName))
        .when(!!this.newProblem && this.newProblemField === "name", x => x.child(div().id("new-rig-name-error").text_size(11.5).text_color(t.blocked).child(this.newProblem)))
        .child(v_flex().gap(3).child(label("Runtime")).child(h_flex().id("new-rig-runtimes").gap(4)
          .children(NEW_RIG_RUNTIMES.map((r) => pill(`new-rig-runtime-${r}`, statusWord(r,"runtime"), this.newRuntime === r, () => { this.newRuntime = r; })))))
        .child(field("Working folder", this.folder))
        .when(!!this.newProblem && this.newProblemField === "folder", x => x.child(div().id("new-rig-folder-error").text_size(11.5).text_color(t.blocked).child(this.newProblem)))
        .when(!!createReason, (x) => x.child(div().text_size(11.5).text_color(t.blocked).child(createReason))))
      .child(div().id("new-rig-command").text_size(11.5).text_color(t.dim).child(commandLine(this.newRigPreview())));
  }

  localSetupHost(){
    const path=`${appHome()}/openrig/config.json`;
    return{
      readDaemonState:home=>readTextFile(`${home}/daemon.json`).catch(()=>null),
      writeConfig:async(text,before,validate)=>{
        const current=await readTextFile(path).catch(()=>null);
        if(current!==before)throw Object.assign(new Error("OpenRig's settings changed while this was open. Check again. Nothing was saved."),{code:'CONFIG_CHANGED'});
        validate?.(); // a close, field edit or config change during the read refuses before the CAS write
        try{await writeTextFile(path,text,before);}
        catch(error){
          const actual=await readTextFile(path).catch(()=>null);
          if(actual===text)return; // a lost acknowledgement, but the exact intended file is present
          throw Object.assign(new Error("Couldn't confirm whether the connection was saved. Check Connections before trying again."),{uncertain:true,cause:error});
        }
      },
      closedOutcome:result=>notify(result.ok?{title:'Connection saved',body:"It finished saving after the dialog closed. Check it in Connections.",level:'info'}
        :{title:'Connection save not confirmed',body:'The dialog closed before Herdr heard back. Check Connections before adding it again.',level:'warning'}),
    };
  }
  machineSetupHost(cx,config=this.config){
    const configPath=`${appHome()}/openrig/config.json`,consentPath=`${appHome()}/openrig/machine-consent.json`;
    let completedConfig=this.openedOn;
    const beforeApprove=()=>{
      if(this.gone)throw new Error('This machine setup was closed. No further action was started.');
      const token=props()?.step?.token;
      if(token&&shared("rig.machineSetupToken")!==token)throw new Error("This setup was replaced by a newer request. Close it and use the newer screen.");
    };
    const currentChoice=async()=>{
      const fresh=await freshFileConfig();beforeApprove();
      if(!completedConfig||fresh.configInvalid||fresh.connectionsRefused||!sameDialogConfig(completedConfig,fresh,config.connectionId))throw new Error(CONFIG_CHANGED_OPEN);
    };
    const exec=execFor(config),hc=hcFor(config);
    return {exec:(...args)=>{beforeApprove();return exec(...args);},hc:(...args)=>{beforeApprove();return hc(...args);},machines,beforeApprove,
      cancelled:()=>this.gone,
      registerBarrier:release=>{
        if(this.gone){release();return()=>{};}
        (this.machinePreparationReleases??=new Set()).add(release);
        return()=>this.machinePreparationReleases?.delete(release);
      },
      deadline:ms=>new Promise(resolve=>cx.timer.after(ms,resolve,{owner:null})),
      waitQueue:read=>new Promise((resolve,reject)=>{
        beforeApprove();
        const ticket={resolve,reject,ready:false};
        (this.machineQueueWaits??=new Set()).add(ticket);
        Promise.resolve().then(read).then(value=>{ticket.value=value;ticket.ready=true;},error=>{ticket.error=error;ticket.failed=true;ticket.ready=true;});
        cx.notify();
      }),
      setupFetch:loopbackHealthFetch(globalThis.fetch.bind(globalThis),(ms,fn)=>cx.timer.after(ms,fn,{owner:null})),relayPath:attachRelayPath(appHome(),MOD_IDS.menu),wait:waitWith(cx),
      stillChosen:currentChoice, // Approve helper: the settings still name the connection this dialog opened on
      localFolderExists:localDirectoryProbe(execFor(config)),localHome:()=>home(),
      machineFolders:name=>[...(spaces()??[]).filter(s=>s?.machine===name).map(s=>s.folder),...(panes()??[]).filter(p=>typeof p?.pane==="string"&&p.pane.startsWith(`${name}/`)).map(p=>p.cwd)],
      health:async url=>{const r=await fetchFor(config)(`${url}/healthz`);if(!r.ok)throw new Error("Cannot read the tunnel's OpenRig health.");return r.json();},
      readConfig:()=>{beforeApprove();return readTextFile(configPath).catch(()=>null);},writeConfig:async(text,previous)=>{
        beforeApprove();
        try{await writeTextFile(configPath,text,previous);}
        catch(error){const now=await readTextFile(configPath).catch(()=>null);if(now!==previous)throw Object.assign(new Error("OpenRig's settings changed while this was open."),{code:"CONFIG_CHANGED"});throw error;} // the file is not what was read: say so plainly
        completedConfig=parseConfig(text);},
      readConsentText:()=>{beforeApprove();return readTextFile(consentPath).catch(()=>null);},writeConsentText:(text,previous)=>{beforeApprove();return writeTextFile(consentPath,text,previous);},
      saved:async(result,stop)=>{
        await currentChoice();
        let declined,search;
        if(stop){
          const path=`${appHome()}/openrig/state.json`,before=await readTextFile(path).catch(()=>null),state=JSON.parse(before??"{}");
          declined={...(state.machineDeclined??{})};search={...(state.machineSearchDeclined??{})};
          const receipt=result.previous;
          if(receipt?.profileId&&receipt?.selfHostId)delete declined[JSON.stringify([receipt.profileId,receipt.selfHostId])];
          delete search[rigOrigin(this.config.daemonUrl)];
          const next={...state,machineDeclined:declined,machineSearchDeclined:search};
          await currentChoice(); // state read may have waited while another machine choice replaced this one
          await writeTextFile(path,JSON.stringify(next,null,2)+"\n",before);
        }
        await currentChoice(); // a completed state write must not clear a newer shared receipt
        if(stop)setShared("rig.spaceState",{...(shared("rig.spaceState")??{}),machineDeclined:declined,machineSearchDeclined:search});
        setShared("rig.machineSetup",stop?null:result.receipt);refreshSidebar();}};
  }

  consumeMachineQueue(cx) {
    if(this.gone||this.machineQueueTimer||!this.machineQueueWaits?.size)return;
    // Arm from this view's draw; resolving in its timer drains the preparation
    // continuation under the successor, never the predecessor's close/task.
    const poll=next=>{
      this.machineQueueTimer=null;
      if(this.gone)return;
      for(const ticket of this.machineQueueWaits){
        if(!ticket.ready)continue;
        this.machineQueueWaits.delete(ticket);
        if(ticket.failed)ticket.reject(ticket.error);else ticket.resolve(ticket.value);
      }
      if(this.machineQueueWaits.size)this.machineQueueTimer=next.timer.after(100,poll);
    };
    this.machineQueueTimer=cx.timer.after(100,poll);
  }

  render(cx) {return withFocusContext(this,cx,()=>this.renderFocused(cx));}
  renderFocused(cx) {
    this.consumeMachineQueue(cx);
    if(this.resumeRollCallAutoPending&&!this.resumeRollCallTimer&&!this.gone){
      this.resumeRollCallAutoPending=false;this.resumeRollCallAutoUsed=true;
      const epoch=this.resumeRollCallEpoch;
      this.resumeRollCallTimer=cx.timer.after(10000,next=>{if(this.gone||this.resumeRollCallEpoch!==epoch)return;this.resumeRollCallTimer=null;this.requestResumeRead(next,'rollcall');});
    }
    const t = theme();
    const p = props() ?? {};
    if (p.step?.action === "change-model") this.watchSwapCatalog(cx, complete(p.target, this.config));
    if(this.pendingLocalPanel&&!this.localPanelPending){
      this.localPanelPending=true;cx.timer.after(0,next=>{
        this.localPanelPending=false;const make=this.pendingLocalPanel;this.pendingLocalPanel=null;
        if(!make||this.gone||this.setupPanel)return;
        this.setupPanel=make(next);next.spawn(task=>this.setupPanel.open(task));next.notify();
      });
    }
    // Async completions request focus; only the dialog's own draw creates its timer.
    if(this.pendingDialogFocus){const focus=this.pendingDialogFocus;this.pendingDialogFocus=null;this.dialogFocusTask?.cancel?.();this.dialogFocusTask=cx.timer.after(0,next=>{this.dialogFocusTask=null;if(this.gone)return;focus();next.notify();});}
    if(this.setupPanel)return this.setupPanel.render(t,cx);
    if(p.step&&["confirm-machine","setup-machine","stop-machine","add-machine","remove-connection","switch-connection","switch-back","approve-helper"].includes(p.step.action)){
      this.dialogFirstControl=this.dialogLastControl=this.dialogCancelHandle;
      return div().id('machine-config-loading').p(14).key_context('RigDialog')
        .on_action('rig-dialog-next',(_e,cx)=>this.dialogTab({key:'tab',modifiers:{}},cx))
        .on_action('rig-dialog-prev',(_e,cx)=>this.dialogTab({key:'tab',modifiers:{shift:true}},cx))
        .on_key_down((e,cx)=>this.dialogTab(e,cx))
        .when(!!this.dialogCancelHandle,el=>el.track_focus(this.dialogCancelHandle).tab_stop(true)).child("Checking OpenRig configuration…");
    }
    if (!p.target) return div();
    const target = complete(p.target, this.config);
    this.capsDraw = new Map();
    let tree;
    try { tree = p.step ? this.dialogView(t, cx, target, p.step) : this.popup(t, target); } finally { this.capsDraw = null;this.dialogRenderCx=null; }
    return tree;
  }
}
