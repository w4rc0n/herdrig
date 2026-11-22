// OpenRig's Explorer sidebar: a single 6-branch collapsible tree
// (Topology, Specs, Scopes, Terminals, Needs, System) with header pop-out icons for the
// Rig Page tab and Rig TUI tab, one-way Sidebar -> Page synchronization, sibling
// drag-to-rearrange within parent groups, and per-rig Views branches.
//
// - Data: GET /api/rigs/summary, /api/rigs/:id/nodes per rig, /api/attention. Shared with the Rig page and palette as
//   `shared("rig.data")`.
// - Live: the daemon's public /api/events stream (activity-only fallback on older daemons). Any event re-reads,
//   debounced 500 ms. The host ends a
//   socket read after 30 s without bytes; the daemon sends a keep-alive every 15 s. On any error or end it reconnects
//   with backoff and, while down, re-reads every 5 s and says so. Every (re)connect re-reads everything.
// - Never stale as live: after a failed read, rows are dimmed "as of HH:MM".
// - Tree fold state (`shared("rig.open.sidebar")`) and sibling order (`shared("rig.order")`) persist across restarts in
//   `<appHome>/openrig/state.json`.
// - One-click writes (`rig.oneclick`, rig-lib startOneClick) run here, as the person: this copy outlives the popup that
//   asked. Progress, success and failure go to `shared("rig.status")` and a toast.
import { stampConnection, spaceStatusKey, targetConnection, connectionConfig, qualifyKey, adoptConnection, consentOf, consentText, LEGACY_CONNECTION_ID, addressParts, EXPLICIT_ADDRESS_NEEDED, configOfConnection, UNKNOWN_CONNECTION, AMBIGUOUS_NAME, AMBIGUOUS_REQUEST, NO_CONNECTION, formatHostId, plainExecError, isKnownUnsentError, unsentErrorMessage } from "./rig-connections.js";
import {loadHostedMembers,HostedMembersReader,assistantsForRig,assistantTarget,assistantWord,assistantForNeed,assistantOwner,assistantActionRefusal,verifyAssistantTarget} from './rig-connected-assistants.js';
import {assistantGroup} from './rig-connected-assistants-view.js';
import {SYSTEM_PAGE_VIEWS} from './rig-page-nav.js';
import { View, div, svg } from "gpui-kit";
import { effectiveScopeProject, readScopeProject } from './rig-project.js';
import { workflowPath,workflowView,workflowEntry,workflowWord } from './rig-workflow.js';
import { resolveAskerSeat,relativeTimeText,requestFailed,requestWhat,focusTarget,releaseFocusTargets,liveFocus } from './rig-lib.js';
import { timezoneValue } from './rig-time.js';
import { healthCounts } from "./rig-health.js";
import { counted, plainError, statusWord, errorDiagnostic } from "./rig-words.js";
import {activationPair} from './rig-activation.js';
import { errorBlock, errorNotice } from "./rig-error-view.js";

import { publishRigData, filterAttentionHealth, isUpdateNeed, saveStateFile, stateSaveFailure, stateSaveReason } from "./rig-lib.js";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { revealAfterKey } from "./rig-scroll-reveal.js";
import { appHome, readTextFile, writeTextFile, props, theme, run as rawRun, exec as rawExec, layout, focused, openOverlay as rawOpenOverlay, closeOverlay, setShared as rawSetShared, shared, nextCommand, notify as rawNotify, playSound, settings, watchFolder, keys, window, spaces, panes, terminals, hc as rawHc, commands, machines } from "herdr";
const notify = value => errorNotice(rawNotify, value);
import { gatedFetch, gatedExec, gatedHc, gatedRun, gatedConnect, observeConfig, rethrowGate, gateSameConfig, gateIdentity, gatedOperationOrRefusal, numberedConfigReads, gateGeneration } from "./rig-gate.js";
// THE SEND GATE (rig-gate.js): every request, CLI run, process-starting Herdr command and stream connection below goes through it, checked at send time.
// ONE counter for every sidebar of this mod copy, like the gate it feeds (rig-gate.js is one per mod copy). Every config read that installs goes through it.
const configReads = numberedConfigReads();
const exec = (command, args, options) => gatedExec(rawExec, command, args, options, undefined, undefined, appHome());
const hc = (args, bytes) => gatedHc(rawHc, args, bytes);
const run = (name, args) => gatedRun(rawRun, name, args);
// A send for a CONNECTION names its gate scope (several OpenRigs: a bare sink refuses). `config` is that connection's own config.
const fetchFor = (config) => (url, init) => gatedFetch(url, init, undefined, config?.connectionId);
const execFor = (config) => (command, args, options) => gatedExec(rawExec, command, args, options, undefined, config?.connectionId, appHome());
const hcFor = (config) => (args, bytes) => gatedHc(rawHc, args, bytes, undefined, config?.connectionId);
const runFor = (config) => (name, args) => gatedRun(rawRun, name, args, config?.connectionId);

let flatOwner = null; // the view this mod copy is acting for
const setShared = rawSetShared; // several connections key their own state (qualifyKey); no flat-store guard
import { RemoteMachine, detectDaemonMachine, offerForMachine, machineProbeExec, herdrIdentityOf, loopbackHealthFetch, goodHome } from "./rig-remote.js";
import { knownOldProviderViews, readOldProviderViews, oldViewCandidates, closeOldViews } from "./rig-old-views.js";
import { layouts } from "herdr";
import { HostWorkerViews } from "./rig-worker-controller.js";
import {workerViewDetails} from "./rig-worker-views.js";
import { archivedElements, withArchivedHosts } from "./rig-archived.js";
import { RigSpaces, RebuildConfirmations, rigSpaceRelocation } from "./rig-spaces.js";
import { sameConnectionConfig, acceptRigOpen, receiversWithBeat, migrateRigTabs, replaceMigrationTab, moveMigrationPages, migrationReportNow, needsTabMigration, migrationSourceMatches, migrationChoice, migrationChoices, clearInterruptedRouteJob, activeInPlaceOpen, inPlaceSpaceRefusal } from "./rig-routing.js";
import { openRigSpaceContext, rigOrigin, syncRetainedOrigins, spaceContextSnapshot } from "./rig-space-context.js";
import { publishGraphActivity } from "./rig-graph-state.js";
import { DismissedUpdates, commitDismissal, dismissalScope, savedDismissalsFor, dismissalRecipient, liveDismissalItems, boundedDismissalRequest, requestDismissal, dismissible } from "./rig-dismiss.js";
import { PRIORITY_GROUPS, NeedsTracker, priorityElements, diffPriorityNotifications, needsMark } from "./rig-needs-view.js";
import { buildStickyScrollLayout, clampScrollTop, computeStickyTopology, nextScrollTopAfterReveal, revealTargetForSelection, stickySignature } from "./rig-sticky-topology.js";
import rawNet from "net";
const net = { connect: (host, port) => gatedConnect((h, p) => rawNet.connect(h, p), host, port) };
const netFor = (config) => (host, port) => gatedConnect((h, p) => rawNet.connect(h, p), host, port, config?.connectionId);
import {
  stampRows, rowsIdentityOf, ROWS_STALE, MOD_IDS, STATE_COPY, NO_PERSON, ACTION_REFUSED, TERMINAL_TOKEN_PROTECTED, REMOTE_OPERATOR_REASON, s1CopyLine, routeRigOpen, registerRigRouting,
  utf8, sseParser, parseConfig, sameConfig, preserveCliDiscoveredConfig, discoverDaemonFromCli, selectSidebarState, probeOpenRigState, formatOpenRigVersionLine,
  buildTopology, viewsForRig, rigFoldOpen, podFoldOpen, foldChoice,
  rigKey, podKey, branchKey, hostKey, viewsKey, branchFoldOpen, specNamespaceOf, hostOf,
  asOf, needTarget, iconsAt, paletteKey, openOrFocusTui, needsRequestCount, requestHeadline,
  readCommand, writeCommand, writeOutcome, actionArgs, actionTitle, doneWords, startOneClick, qualifyBusyKey, oneClickBusyKey, ONE_CLICK, PROVIDER_HOME_ACTIONS, providerHomeRefusal, appHomeArgsRefusal, listAddedMachine, RIG_SECTIONS, SECTION_TITLES, CONFIG_CATEGORIES,
  navPush, navBack, backTarget, navKey, onScreenRigTab, pushTabPage, tabPagesBack, machineSpaceConn,
  probeCapabilities, currentCapabilities, connectionCapabilities, capabilityDisableReason, herdrAppAvailability, isNeedsVisible, openNeed, worstHealthChip,
  isRigStopped, expandAllTopology, collapseAllTopology,
  viewsPropsFromLayout, hasRigWorkStack, openOrFocusRigTab, selectWorkerView, findRigTab,
  selectSidebarNode, isSelectionElsewhere, orderSiblings, applySiblingDrop, resetGroupOrder,
  parseSidebarState, serializeSidebarState, treeKeyNav, rigViewsBranch, attachToSeat, isLoopbackDaemonUrl, formatSeatContextPct, isSeatContextWarning,
  tierOf, sortNeedsByTier, enrichAttentionItems, quietModeHeaderChip, whoseQueueSummary, statusMark, statusMarkElement, pageRevealOpen,
  attachRelayPath, isValidSessionName, sessionNameRefusal,
  findAttachedSeat, seatTerminalIndex, seatOrigin, seatNameShared, newRigOverlay, rigSpaceMarks, waitWith } from "./rig-lib.js";
import { installHerdrTransport } from "./rig-openrig-wire.js";

/** This folder, for its own icons: derived from `MOD_IDS.sidebar` so a 1-line rename in `MOD_IDS` updates both cross-mod opens and icons. */
const ASSETS = `mods/${MOD_IDS.sidebar}`;
/** A JavaScript error thrown while a feed reads (herdrig's code, or an answer it can't parse), not a connection that failed: said as what it is, never as "couldn't reach". */
import { isCodeError, codeErrorMessage, describeCodeError, SAVE_NEXT, refreshFailureMessage, needsHelperApproval, HERDR_CONNECTION_OFFERED } from "./rig-connections.js";
const icon = iconsAt(ASSETS);

const STACK = "rig-work", PAGE = "rig-page";

/** The tree's geometry: one indent step per level, and a 12 px cell before every name, holding the
 *  chevron when the row expands and empty on a leaf, so names line up at each depth. */
const TREE_STEP = 12;
/** The most rows a sidebar list of requests or updates draws; the rest are behind one row that opens the Needs page. */
const SIDEBAR_ROW_CAP = 20;
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
/** What the person is looking at: the Rig page (PAGE) when the active tab holds one, any Rig tab of the space, not only its first; else the view or
 *  tab id. `lists`: Herdr's lists as a render already read them (hostLists), so a draw reads each once. */
const shownChild = (lists = null) => {
  const tree = layout();
  const stackNode = find(tree, (n) => n.id === STACK);
  if (stackNode?.active) return stackNode.active;
  const sp = lists?.spaces ?? (typeof spaces === "function" ? (spaces() ?? []) : []);
  const pn = lists?.panes ?? (typeof panes === "function" ? (panes() ?? []) : []);
  const activeSpace = sp.find((s) => s?.active) ?? sp[0] ?? null;
  const activeTab = (activeSpace?.tabs ?? []).find((t) => t?.active) ?? null;
  if (!activeTab?.id) return null;
  const rigTab = pn.some((p) => p?.mod === MOD_IDS.view && p.tab === activeTab.id)
    || (!activeTab.settled && (activeTab.mod === MOD_IDS.view || activeTab.content?.mod === MOD_IDS.view));
  if (rigTab) return PAGE;
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
export function openPage(entry, selKey = null, stateHost = null) {
  const key = selKey ?? navKey(entry) ?? entry?.section ?? "topology";
  // The page shows what was opened: its ancestors unfold in the page's folds, never the sidebar's.
  setShared("rig.open.page", pageRevealOpen(shared("rig.open.page"), entry));
  return selectSidebarNode({ shared:stateHost?.shared??shared, setShared:stateHost?.setShared??setShared, run, spaces, panes, layout }, key, entry);
}

import {openRigEventStream,pumpEvents} from "./rig-event-stream.js";
import {ConnectionFeed} from "./rig-feed.js";
import {followedConnection,spaceMachine} from "./rig-follow.js";
import {SIDEBAR_VIEW_FIELDS,cleanSidebarViews,cleanSidebarView,readSidebarView,writeSidebarView,cleanAwayStates,restoreAwayStateMap,cleanNotifiedNeeds,cleanNotifiedNeedsMap} from './rig-sidebar-view-state.js';
import {StatusMotion} from "./rig-status-motion.js";
/** A request whose OpenRig connection was removed or edited while it ran. */
// An Attach on a Herdr machine says what it is doing after 15 s and gives up after 120 s (a busy machine can take minutes).
const ATTACH_PROGRESS_MS = 15000, ATTACH_DEADLINE_MS = 120000, TIMED_OUT = Symbol("timed out");
/** A background sync still marked as running after this long lost its end (an interrupted job skips its finally): the next refresh may start one. */
const SYNC_STALE_MS = 2 * 60 * 1000;
const CONNECTION_CHANGED_DURING = "That OpenRig connection changed while this was running. Nothing more was done for it; check its space before trying again.";
/** Structural equality that allocates nothing: identical references return at once, so the arrays a refresh carried over compare in one step. */
function sameValue(a, b, activitySamples = false) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return Number.isNaN(a) && Number.isNaN(b);
  const arr = Array.isArray(a);
  if (arr !== Array.isArray(b)) return false;
  if (arr) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i],activitySamples)) return false; return true; }
  let n = 0;
  for (const k in a) {
    if (!Object.hasOwn(a, k)) continue;
    n++;if(!Object.hasOwn(b,k))return false;
    const same=k==="healthFinding"?sameValue(healthRecordContent(a[k]),healthRecordContent(b[k]))
      :k==="at"&&String(a.id??'').startsWith('health:')&&a.id===b.id?true
      :activitySamples&&k==="agentActivity"?sameExcept(a[k],b[k],["sampledAt"])
      :activitySamples&&k==="contextUsage"?sameExcept(a[k],b[k],["sampledAt"])
      :activitySamples&&k==="identityVerdict"?sameExcept(a[k],b[k],["observedAt"])
      :activitySamples&&k==="transcriptIngest"?sameTranscriptObservation(a[k],b[k])
      :sameValue(a[k],b[k],activitySamples);
    if(!same)return false;
  }
  for (const k in b) if (Object.hasOwn(b, k)) n--;
  return n === 0;
}
/** The same published rig.data apart from its refresh times (`at`, at the top and in each connection's entry). */
function sameExcept(a,b,ignored){
  if(a===b)return true;
  if(!a||!b||typeof a!=="object"||typeof b!=="object"||Array.isArray(a)||Array.isArray(b))return sameValue(a,b);
  for(const key of new Set([...Object.keys(a),...Object.keys(b)]))if(!ignored.includes(key)&&!sameValue(a[key],b[key]))return false;
  return true;
}
const withoutHealthClocks=(value,keys)=>value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key))):value;
/** Comparison only: retain the actual response for inspection. Episode identity, source state and actual usage remain significant. */
function healthRecordContent(record){
  if(!record||typeof record!=='object')return record;
  const out=withoutHealthClocks(record,['lastObservedAt']);
  if('window' in record)out.window=withoutHealthClocks(record.window,['startedAt','endedAt']);
  if('freshness' in record)out.freshness=withoutHealthClocks(record.freshness,['evaluatedAt','newestSourceAt','ageSeconds']);
  if(record.detector==='context.pressure'&&Array.isArray(record.evidence)){
    const seen=new Set();out.evidence=record.evidence.map(item=>item?.type==='context-usage'?withoutHealthClocks(item,['observedAt','sourceOrder']):item).filter(item=>{const key=JSON.stringify(item);if(seen.has(key))return false;seen.add(key);return true;});
  }
  return out;
}
function healthListContent(value){
  if(!value||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(healthRecordContent);
  const out=withoutHealthClocks(value,['evaluatedAt']);
  if(Array.isArray(value.records))out.records=value.records.map(healthRecordContent);
  if(Array.isArray(value.coverage))out.coverage=value.coverage.map(entry=>withoutHealthClocks(entry,['evaluatedAt']));
  return out;
}
const sameHealthRecords=(a,b)=>sameValue(a?.map?.(healthRecordContent)??a,b?.map?.(healthRecordContent)??b);
/** Only live capture freshness is a sample outcome; degraded/unavailable and unknown reasons remain significant. */
function sameTranscriptObservation(a,b){
  const liveReasons=["capture_fresh","capture_unchanged"];
  const live=a?.state==="live"&&b?.state==="live"&&liveReasons.includes(a.reason)&&liveReasons.includes(b.reason);
  return sameExcept(a,b,live?["lastCapturedAt","reason"]:["lastCapturedAt"]);
}
function sameDisplayHealth(a,b){
  if(a===b)return true;
  if(!a||!b)return sameValue(a,b);
  for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
    if(key==="routeTimings")continue; // raw request-duration samples are read on demand, not a display clock
    const ignored=key==="eventLoop"?["lagMeanMs","lagP99Ms","utilization","lastTickAgeMs"]
      :key==="stuckSweep"?["lastSweepAt"]:key==="wakeLadder"?["lastTickAt"]:[];
    if(!sameExcept(a[key],b[key],ignored))return false;
  }
  return true;
}
function sameRigData(a, b) {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === "at") continue;
    if (k !== "byConnection") { if (!(k==="attentionHealth"?sameHealthRecords(a[k],b[k]):k==="healthz"?sameDisplayHealth(a[k],b[k]):sameValue(a[k], b[k],k==="topology"||k==="nodesByRig"))) return false; continue; }
    const ids = new Set([...Object.keys(a.byConnection ?? {}), ...Object.keys(b.byConnection ?? {})]);
    for (const id of ids) {
      const x = a.byConnection?.[id], y = b.byConnection?.[id];
      if (!x || !y) return false;
      for (const f of new Set([...Object.keys(x), ...Object.keys(y)])) if (f !== "at" && !(f==="attentionHealth"?sameHealthRecords(x[f],y[f]):f==="healthz"?sameDisplayHealth(x[f],y[f]):sameValue(x[f], y[f],f==="topology"||f==="nodesByRig"))) return false;
    }
  }
  return true;
}
/** The parts of a feed's data a refresh reads again each time. One that reads the same as before keeps the previous value, so what was published
 *  compares by reference and the memos keyed on these arrays stay warm. The comparison runs once per refresh, never in a draw. */
const CARRIED_KEYS = ["topology", "hostedMembers", "attentionItems", "attentionRaw", "attentionHealth", "attentionPerspective", "attentionSources", "nodesByRig", "capabilities", "sidebarState", "healthz"];
function carryUnchanged(data, prev) {
  if (!data || !prev) return;
  for (const key of CARRIED_KEYS) if (key in data && key in prev && (key==='attentionHealth'?sameHealthRecords(data[key],prev[key]):sameValue(data[key], prev[key],key==="topology"||key==="nodesByRig"))) data[key] = prev[key];
}
/** A large OpenRig takes seconds to list everything that wants the person (its updates, proof judgments, mission outcomes, health), while
 *  its requests alone answer in milliseconds. So each refresh reads the requests (`?kind=action`), and the whole list is read in the
 *  background by one reader per connection: never two at once, and spaced by several times what the last one took. */
const ASKS_PATH = "/api/attention?kind=action";
const FULL_ATTENTION_PATH = "/api/attention";
/** A whole list that answered under this is read again at the next refresh, as it always was; a slower one waits this many times its own time. */
const FULL_ATTENTION_QUICK_MS = 1000;
const FULL_ATTENTION_GAP_FACTOR = 8;
/** Above this, the sidebar says that this OpenRig is slow to list its updates and how often they are read. */
const FULL_ATTENTION_SLOW_MS = 3000;
/** Whether an OpenRig honoured `kind=action`: one that does names the narrowed read among its sources; an older one ignores the parameter
 *  and answers with the whole list. */
const kindFiltered = (answer) => Array.isArray(answer?.sources) && answer.sources.some((s) => s?.source === "kind");
/** Which OpenRig a whole list belongs to: the connection's identity as the gate keeps it (its id, the address it names, its machine, its home and
 *  its rig command), the address it is read from and the host id it expects. Any change is another OpenRig. */
const fullAttentionKey = (config) => JSON.stringify([gateIdentity(config), config?.daemonUrl ?? null, config?.expectedHostId ?? null]);
/** The sources of a merged answer: the whole list's, with each one the requests read named again taken from that fresh read (so a queue that is
 *  down now says so, and nothing is pruned on it), without the narrowed read's own `kind` line (the answer holds every kind). */
function mergedSources(wholeSources, askSources) {
  const fresh = (Array.isArray(askSources) ? askSources : []).filter((s) => s?.source && s.source !== "kind");
  const byName = new Map(fresh.map((s) => [s.source, s]));
  const whole = (Array.isArray(wholeSources) ? wholeSources : []).filter((s) => s?.source !== "kind");
  return [...whole.map((s) => byName.get(s?.source) ?? s), ...fresh.filter((s) => !whole.some((w) => w?.source === s.source))];
}
/** One refresh's attention answer: fresh requests with the other items of the last whole list. Until a whole list has been read, only the
 *  requests and their own sources (partial, so nothing is pruned on them). `complete` says a whole list exists and is merged in, not that this
 *  refresh read one: its items other than requests can be as old as the reader's gap. */
function attentionAnswer(full, asks) {
  const whole = full.data && Array.isArray(full.data.items) ? full.data : null;
  if (!asks) return whole ? { items: whole.items, sources: whole.sources, perspective: whole.perspective, complete: true } : null;
  if (!Array.isArray(asks.items)) return null;
  return {
    items: whole ? [...asks.items, ...whole.items.filter((item) => item?.kind !== "action")] : asks.items,
    sources: whole ? mergedSources(whole.sources, asks.sources) : asks.sources,
    perspective: asks.perspective ?? whole?.perspective,
    complete: Boolean(whole),
  };
}
export default class RigSidebar extends View {
  /** A page opened from the sidebar belongs to the box the sidebar shows (with several connections): its entry names that connection unless it already names one. The page then reads, and acts on, that
   *  connection for as long as it is open, whichever box the sidebar follows later. One connection: the entry is untouched. */
  entryOf(entry) { const id = this.drawnConnId ?? this.follow?.shownId; return entry && this.feeds.length > 1 && id && !entry.conn ? { ...entry, conn: id } : entry; }
  /** Every overlay this instance opens is stamped with ITS OWN config (its rows were read under it), never the latest instance's. */
  open(spec) { return rawOpenOverlay(stampRows(spec, rowsIdentityOf(this.config, spec?.props?.target?.conn))); }
  init(_p, cx) {
    this.cleanupSession=`cleanup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.listScroll = ScrollHandle.new();
    // OpenRigs over Herdr's connection (herdr:// addresses): reads and the event stream go through the pinned helper on that machine.
    this.herdr = installHerdrTransport({ execFor: (scope) => execFor({ connectionId: scope }), hcFor: (scope) => hcFor({ connectionId: scope }), machines, wait: waitWith(cx), appHome, readTextFile, writeTextFile, config: () => this.config,
      bridgePath: () => attachRelayPath(appHome(), MOD_IDS.sidebar).replace(/rig-attach-relay\.cjs$/, "rig-openrig-transport.cjs") });
    registerRigRouting(cx, (context, conn) => {
      if (!this.primary.config) return { config: null, notify };
      if (this.primary.config.configInvalid) return { config: this.primary.config, notify };
      const feed = conn ? this.ownFeed(conn) : this.primary;
      return feed ? { ...(conn ? this.routeHost(context, null, feed) : this.routeHost(context)), config: feed.config, notify }
        : { config: { configInvalid: UNKNOWN_CONNECTION }, notify };
    });
    this.routeReceiverId=`sidebar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    setShared("rig.routeReceivers",receiversWithBeat(shared("rig.routeReceivers"),this.routeReceiverId)); // the time it last said it is alive (every 10 s), leftovers pruned
    this.statusMotion = new StatusMotion();
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
    this.treeStateConn = null;
    this.needsTracker = new NeedsTracker(typeof localStorage === "undefined" ? null : localStorage);
    this.focusHandle = typeof cx?.focus_handle === "function" ? cx.focus_handle() : null;
    cx.spawn(async (cx) => {
      this.workerHostCx=cx; // durable sidebar-owned task context, captured before the first await
      await this.loadSidebarState();
      const first = await this.readConfigText();
      if (!first.superseded()) this.config = first.config;
      this.restoreSidebarViews();
      this.syncFeeds(cx);
      cx.notify();
      try { await this.refresh(cx); } finally { this.syncFeeds(cx); } // the other connections' feeds start whatever the first one's refresh did
      this.stream(cx);
    });
    // Re-read the config whenever it may have changed: on any change under the app home, every second while missing, and every 5 s.
    cx.spawn(async (cx) => {
      for (;;) {
        const dir = this.config && !this.config.missing ? `${appHome()}/openrig` : appHome();
        try { await watchFolder(dir); } catch (_) { await new Promise((r) => cx.timer.after(5000, () => r())); }
        if (this.closed) return;
        try { await this.reloadConfig(cx); } catch (_) { /* one failed read must not end the watcher: the next event or the 5 s poll reads again */ }
      }
    });
    cx.spawn(async()=>{
      while(!this.closed){
        try{await watchFolder(`${appHome()}/layouts`);}catch{return;}
        if(this.closed)return;
        this.oldViewsDirty=true;this.oldViewsRevision=(this.oldViewsRevision??0)+1;
      }
    });
    cx.timer.every(1000, (cx) => {
      if (this.closed) return;
      this.checkInterruptedOpens(cx);
      if (narrow()) this.publishSpaceMarks(); // the rail skips them in its render
      // A route request whose rig.route:<id> command hasn't reached this loop yet (Herdr can deliver it behind busy frames): taken here too.
      // acceptRigOpen consumes it before acknowledging, so a command that arrives later finds nothing; the request keeps its own connection.
      for (const id of Object.keys(shared("rig.routeRequests") ?? {})) { const request = acceptRigOpen({ shared, setShared }, id); if (request) this.routeRequest(cx, request); }
      if (this.config?.missing) cx.spawn(async (cx) => this.reloadConfig(cx));
      if (this.dismissalModels?.size && !this.dismissFlushing) cx.spawn(async (cx) => {
        this.dismissFlushing = true;
        try {
          for (const feed of [...this.feeds]) {
            if (feed.closed) continue;
            const model = this.dismissalModel(feed);
            if (!model) continue;
            await model.flush((item) => this.commitDismissalFor(cx, item, model.scope), () => this.saveDismissals(model));
          }
        }
        catch (_) { setShared("rig.dismissSaveError", `Couldn't save which updates are dismissed. No further closes will be attempted for that update. ${SAVE_NEXT}`); }
        finally { this.dismissFlushing = false; this.publishDismissals(); }
      });
    });
    // rig.<command> (herdr-app do, keys.json): the sidebar is loaded whenever the Rig layout shows.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (this.closed) return;
        const cmdName = typeof c === "object" && c !== null ? String(c.name ?? c.command ?? "") : String(c ?? "");
        const cmdArgs = typeof c === "object" && c !== null ? (c.args ?? {}) : null;
        const section = cmdName.startsWith("open:") ? cmdName.slice(5) : cmdName;
        if (cmdName.startsWith("route:") || cmdName.startsWith("rig.route:") || cmdName === "route" || cmdName === "rig.route") {
          const id=cmdName.includes(":") ? cmdName.slice(cmdName.indexOf(":")+1) : cmdArgs?.id;
          const request = acceptRigOpen({ shared, setShared }, id);
          if (request) this.routeRequest(cx, request);
        }
        else if (cmdName === "palette") run("mod.open", { name: MOD_IDS.palette });
        else if (cmdName === "show-sidebar-here") this.showSidebarHere(cx);
        else if (cmdName === "focus-sidebar") this.focusSidebar(cx);
        else if (cmdName.startsWith("move-row:")) {
          const parts = cmdName.slice("move-row:".length).split(":");
          if (parts.length === 2 && ["-1", "1"].includes(parts[0]) && parts[1]) {
            let key;
            try { key = decodeURIComponent(parts[1]); } catch (_) { continue; }
            this.moveSidebarRow(cx, key, Number(parts[0]));
          }
        }
        else if (cmdName === "tui" || cmdName === "open-tui" || cmdName === "rig.open-tui") this.tui(cx);
        // A named connection (`tuiCommandFor`): that OpenRig's TUI only; exactFeed refuses one that isn't this sidebar's.
        else if (cmdName.startsWith("tui:")) this.tui(cx, cmdName.slice("tui:".length) || null);
        // The Needs section of a named connection (a toast's action): never the box the sidebar happens to draw.
        else if (cmdName.startsWith("needs:")) this.pickSection("needs", cx, { conn: cmdName.slice("needs:".length) || null, openInPage: true }); // an explicit open, routed to that OpenRig's tab
        else if (cmdName === "operator" || cmdName === "rig.operator" || cmdName === "open-operator") this.openOperator(cx);
        // A named connection (`operatorCommandFor`: a forwarded operator Attach, a space's home menu): that OpenRig's operator only; exactFeed refuses one that isn't this sidebar's.
        else if (cmdName.startsWith("operator:")) this.openOperator(cx, null, cmdName.slice("operator:".length) || null);
        else if (cmdName === "start-daemon" || cmdName === "rig.start-daemon") this.startDaemon(cx);
        else if (cmdName === "open-page" || cmdName === "rig.open-page" || cmdName === "open") {
          const fallbackEntry = this.viewState("rig.sel")?.entry ?? shared("rig.nav")?.stack?.at(-1) ?? { section: "topology" };
          openOrFocusRigTab({ shared, setShared, run, spaces, panes, layout, mayCreate: true }, this.entryOf(fallbackEntry)); // the shown box's page, never the first connection's
        }
        else if (cmdName.startsWith("update-action:")) this.updateAction(cx, cmdName.slice(14));
        else if (cmdName === "refresh") { this.oldViewsDirty=true; setShared('rig.projectCatalogRefresh',(shared('rig.projectCatalogRefresh')??0)+1); this.forceCapabilityProbe = true; for (const feed of this.feeds) { feed.forceHelpProbe = true; /* a person's Refresh reads the whole list again now, one at a time still */ if (feed.fullAttention) feed.fullAttention.nextAt = 0; } cx.spawn(async (cx) => { await this.reloadConfig(cx); await this.refreshFeeds(cx); }); }
        else if(cmdName==="choose-machine"){
          if(this.config?.connectionsList)this.open({mod:MOD_IDS.menu,kind:"dialog",width:600,height:680,props:{target:{kind:"machine"},step:{action:"add-machine"}}}); // a list adds a machine as a connection
          else{this.machineChoiceAvailable=true;this.machineSearchComplete=false;this.showMachineOffer(cx);}
        }
        else if (cmdName === "confirm-machine") {
          const token = shared("rig.machineConfirmation"); setShared("rig.machineConfirmation", null);
          const pending = this.machineConfirmations?.get(token);
          if (pending) { this.machineConfirmations.delete(token); cx.spawn(async cx=>{await this.reloadConfig(cx);this.daemonMachineOffer=null;this.machineChoiceAvailable=false;pending.resume(cx, pending.confirmation);cx.notify();}); }
        }
        else if (cmdName === "rebuild-space") {
          const request = shared("rig.rebuildRequest"); setShared("rig.rebuildRequest", null);
          const approved = this.rebuildConfirmations?.take(request);
          if (approved) this.openRigSpace(cx, approved.rigId, approved.recovery,null,approved.continuation?.relocation,approved.continuation?.worker,approved.continuation?.conn??null);
        }
        else if (cmdName === "move-grid") {
          const request=shared("rig.gridMoveRequest");setShared("rig.gridMoveRequest",null);
          const approved=this.gridMoveConfirmations?.take(request);
          if(approved)this.openRigSpace(cx,approved.rigId,approved.continuation?.rebuild??null,null,approved.recovery,approved.continuation?.worker,approved.continuation?.conn??null);
        }
        else if (cmdName.startsWith("space:")) { const [conn, rigId] = this.commandTarget(cmdName.slice(6)); this.openRigSpace(cx, rigId, null, null, null, null, conn); }
        else if (cmdName.startsWith("approve-helper:")) {
          const [conn, rigId] = this.commandTarget(cmdName.slice("approve-helper:".length));
          const feed = conn ? this.exactFeed(conn) : (this.feeds.length === 1 ? this.primary : null);
          const rig = (feed?.data?.topology ?? []).find((r) => r.id === rigId);
          const status = rig ? shared("rig.spaceStatus")?.[this.statusKey(rig)] : null;
          if (!rig || !feed) notify({ title: "Rig space", body: UNKNOWN_CONNECTION, level: "warning" });
          else if (status?.needsConsent && status.confirmation) this.reviewMachine(status, (cx, approval) => this.openRigSpace(cx, rig.id, null, approval, null, null, rig.conn), feed, rig.name);
          else this.openRigSpace(cx, rig.id, null, null, null, null, rig.conn);
        }
        else if (cmdName === "space" || cmdName === "rig.space") { const sel = this.viewState("rig.sel")?.entry; const fromSel = !(cmdArgs?.rigId ?? cmdArgs?.rig); this.openRigSpace(cx, cmdArgs?.rigId ?? cmdArgs?.rig ?? sel?.rigId,null,null,null,null,cmdArgs?.conn ?? (fromSel ? sel?.conn ?? null : null)); } // the selection names its own connection
        else if (cmdName === "oneclick") this.oneClicks(cx);
        else if (cmdName === "close-old-views") this.closeOldViewsRequests(cx);
        else if (cmdName.startsWith("open-seat:")) {
          const [conn, session] = this.commandTarget(cmdName.slice("open-seat:".length));
          this.openSeatBySession(cx, session, conn ?? cmdArgs?.conn ?? null);
        }
        else if (cmdName.startsWith("open-need:")) {
          const [conn, suffix] = this.commandTarget(cmdName.slice("open-need:".length));
          this.openNeedTarget(cx, suffix || null, conn ?? cmdArgs?.conn ?? null);
        }
        else if (cmdName === "open-need") {
          const fallbackId = cmdArgs && "id" in cmdArgs ? cmdArgs.id : (shared("rig.pendingNeed") ?? this.lastNeedId ?? null);
          this.openNeedTarget(cx, fallbackId, cmdArgs?.conn ?? null);
        }
        else if (cmdName === "back") {
          // The Rig tab on screen goes Back on its own history; a Rig page without one (a legacy layout) uses the shared one, as before.
          const tab = onScreenRigTab(spaces, panes), pages = shared("rig.tabPages") ?? {};
          if (tab && pages[tab]) {
            const next = tabPagesBack(pages, tab, { fallback: pages[tab].stack?.at(-1) ?? null });
            if (next !== pages) setShared("rig.tabPages", next);
          } else {
            const prevNav = shared("rig.nav");
            const backConn = this.feeds.length > 1 ? (prevNav?.stack?.at(-1)?.conn ?? this.follow?.shownId ?? null) : null;
            const target = backTarget(prevNav, backConn);
            const nextNav = navBack(prevNav, backConn);
            setShared("rig.nav", nextNav);
            const backEntry = target ?? nextNav.stack?.at(-1) ?? this.entryOf({ section: "topology" });
            openOrFocusRigTab({ run, spaces, panes, layout, section: backEntry?.section ?? "topology" }, backEntry);
          }
        }
        else if (["zoom","rig.zoom","close-cell","rig.close-cell"].includes(cmdName))
          this.notifyResult("Worker view",{ok:false,reason:"Use Herdr's pane and tab controls for worker pages. Nothing was changed."});
        else if (cmdName === "expand-all" || cmdName === "rig.expand-all") {
          const nextOpen = expandAllTopology(this.viewState("rig.open.sidebar"), this.data?.topology ?? shared("rig.data")?.topology ?? []);
          this.setViewState("rig.open.sidebar", nextOpen);
          this.persistSidebarState(nextOpen, shared("rig.order"));
        }
        else if (cmdName === "collapse-all" || cmdName === "rig.collapse-all") {
          const nextOpen = collapseAllTopology(this.viewState("rig.open.sidebar"), this.data?.topology ?? shared("rig.data")?.topology ?? []);
          this.setViewState("rig.open.sidebar", nextOpen);
          this.persistSidebarState(nextOpen, shared("rig.order"));
        }
        else if (cmdName.startsWith("reset-order:")) {
          const groupKey = cmdName.slice("reset-order:".length);
          const nextOrder = resetGroupOrder(shared("rig.order"), groupKey);
          setShared("rig.order", nextOrder);
          this.persistSidebarState(this.viewState("rig.open.sidebar"), nextOrder);
        }
        else if (cmdName.startsWith("attach:")) {
          const [conn, session] = this.commandTarget(cmdName.slice("attach:".length));
          this.attachSeatBySession(cx, session, null, conn);
        }
        else if (RIG_SECTIONS.includes(section)) this.pickSection(section, cx);
        cx.notify();
      }
    });
    // Still alive, so an Attach forwarded here waits for this sidebar (every 10 s: each change of shared state is written whole and redraws every mod).
    cx.timer.every(10000, () => { if (!this.closed) setShared("rig.routeReceivers", receiversWithBeat(shared("rig.routeReceivers"), this.routeReceiverId)); });
    // SSE accelerates updates; polling also covers lifecycle changes the stream does not announce.
    cx.timer.every(5000, (cx) => {
      if (this.closed) return;
      cx.spawn(async (cx) => { await this.reloadConfig(cx); await this.refreshFeeds(cx,true); });
    });
  }

  primaryStateId() { return this.primary.config?.connectionId ?? this.primary.id ?? LEGACY_CONNECTION_ID; }
  notifiedNeedsKey(connId) { return connId === this.primaryStateId() ? "rig.notifiedNeeds" : `${connId}|rig.notifiedNeeds`; }
  sidebarConnection() { return this.viewFeed?.id ?? this.follow?.shownId ?? this.primaryStateId(); }
  // Within a render each view field is read once (rig.sidebar.views is copied whole on every read); a write drops what was read.
  viewState(key,conn=this.sidebarConnection()) {
    const memo=this.renderMemo,id=`${key}\u0000${conn}`;
    if(memo?.views?.has(id))return memo.views.get(id);
    const value=readSidebarView(shared,key,conn,this.primaryStateId());
    if(memo)(memo.views??=new Map()).set(id,value);
    return value;
  }
  setViewState(key,value,conn=this.sidebarConnection()) {
    if(this.renderMemo)this.renderMemo.views=null;
    if(key==='rig.sel'&&value?.entry?.conn)conn=value.entry.conn;
    if(conn!==this.primaryStateId()&&!(this.primary.config?.connections??[]).some(c=>c.id===conn))return false;
    const changed=writeSidebarView({shared,setShared},key,value,conn,this.primaryStateId());
    if(changed&&key==='rig.sel'&&this.feeds.length>1)this.persistSidebarState();
    return changed;
  }
  restoreSidebarViews() {
    if(!this.primary.config)return;
    const id=this.primaryStateId(),views=cleanSidebarViews(shared('rig.sidebar.views'));
    const owner=shared('rig.sidebar.primary');
    views[id]=cleanSidebarView({...(owner===undefined||owner===id?{topologyView:shared('rig.topology.view')??'priority',open:shared('rig.open.sidebar')??{},selection:shared('rig.sel')}:{topologyView:'priority',open:{}}),...views[id]});
    setShared('rig.sidebar.views',views);
    for(const [key,field]of Object.entries(SIDEBAR_VIEW_FIELDS))setShared(key,views[id][field]??(field==='open'?{}:field==='topologyView'?'priority':null));
    setShared('rig.sidebar.primary',id);
    restoreAwayStateMap({ shared, setShared }, id);
    this.restoreNotifiedNeeds();
  }
  restoreNotifiedNeeds() {
    if (!this.primary.config) return;
    const primary = this.primaryStateId();
    const byConn = cleanNotifiedNeedsMap(shared("rig.notifiedNeeds.byConn"));
    const owner = shared("rig.notifiedNeeds.primary");
    const legacy = cleanNotifiedNeeds(shared("rig.notifiedNeeds"));
    if (legacy) {
      const target = owner ?? primary;
      if (!Object.hasOwn(byConn, target)) byConn[target] = legacy;
    }
    setShared("rig.notifiedNeeds", byConn[primary] ?? null);
    setShared("rig.notifiedNeeds.primary", primary);
    for (const [connId, entry] of Object.entries(byConn)) {
      if (connId === primary) continue;
      const key = this.notifiedNeedsKey(connId);
      const live = cleanNotifiedNeeds(shared(key));
      if (live) byConn[connId] = live;
      else setShared(key, entry);
    }
    setShared("rig.notifiedNeeds.byConn", byConn);
  }
  selectRow(entry,key) { entry=this.entryOf(entry);if(entry)this.setViewState('rig.sel',{key:key??navKey(entry),entry,at:Date.now()}); }
  openPage(entry,key) {
    entry=this.entryOf(entry);
    const conn=entry?.conn??this.sidebarConnection();
    if(entry?.showDismissed){
      const feed=this.exactFeed(conn),prevFeed=this.viewFeed;
      let model=null;
      if(feed){
        this.viewFeed=feed;
        try{model=this.dismissalModel(feed);}finally{this.viewFeed=prevFeed;}
      }
      if(model&&!model.show){
        model.show=true;
        this.publishDismissals();
        this.saveDismissals(model).catch(()=>{});
      }
    }
    return openPage(entry,key,{shared:k=>SIDEBAR_VIEW_FIELDS[k]?this.viewState(k,conn):shared(k),setShared:(k,v)=>SIDEBAR_VIEW_FIELDS[k]?this.setViewState(k,v,conn):setShared(k,v)});
  }

  async loadSidebarState() {
    if (typeof appHome !== "function" || typeof readTextFile !== "function") return;
    try {
      const receipt=consentOf(await readTextFile(`${appHome()}/openrig/machine-consent.json`).catch(()=>null),this.config?.connectionId??LEGACY_CONNECTION_ID);
      setShared("rig.machineSetup",receipt);
    }catch{setShared("rig.machineSetup",null);}
    try {
      const raw = await readTextFile(`${appHome()}/openrig/state.json`);
      if (!raw) return;
      const parsed = parseSidebarState(raw);
      try {
        const saved = JSON.parse(raw);
        const spaceState = { homeSpace: saved.homeSpace, homeSpaces:saved.homeSpaces, inPlaceOpen:saved.inPlaceOpen, machineDeclined:saved.machineDeclined,machineSearchDeclined:saved.machineSearchDeclined,machineAddDeclined:saved.machineAddDeclined,
          sidebarSize: saved.sidebarSize, autoFoldRetired: saved.autoFoldRetired, tabMigration: saved.tabMigration,workerViews:saved.workerViews };
        setShared("rig.spaceState", { ...spaceState, ...(shared("rig.spaceState") ?? {}) });
        setShared("rig.workerViews",shared("rig.spaceState")?.workerViews??{});
      } catch (_) {}
      try { this.dismissalOrigins = JSON.parse(raw).dismissedUpdates ?? {}; } catch (_) {}
      if (parsed.topologyView && !shared("rig.topology.view")) setShared("rig.topology.view", parsed.topologyView);
      if(parsed.sidebarViews)setShared('rig.sidebar.views',{...parsed.sidebarViews,...cleanSidebarViews(shared('rig.sidebar.views'))});
      if (parsed.notifiedNeeds && !shared("rig.notifiedNeeds")) setShared("rig.notifiedNeeds", parsed.notifiedNeeds);
      if (parsed.notifiedNeedsByConnection) {
        setShared("rig.notifiedNeeds.byConn", { ...parsed.notifiedNeedsByConnection, ...cleanNotifiedNeedsMap(shared("rig.notifiedNeeds.byConn")) });
      }
      if (parsed.awayStates) {
        setShared("rig.away.states", { ...parsed.awayStates, ...cleanAwayStates(shared("rig.away.states"), { keepEmpty: true }) });
      }
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

  /** A state save that could not be done is said once per distinct message, and a save that works clears it (the same failure on every later save is not said again). */
  sayStateSave(error) {
    if (!error) { this.stateSaveSaid = null; return; }
    const body = stateSaveFailure("the sidebar's folds, order and what you last saw", error);
    if (this.stateSaveSaid === body) return;
    this.stateSaveSaid = body;
    notify({ title: "OpenRig", level: "warning", body });
  }

  persistSidebarState(openMap = this.viewState("rig.open.sidebar"), orderMap = shared("rig.order")) {
    if (typeof appHome !== "function" || typeof writeTextFile !== "function") return;
    const path = `${appHome()}/openrig/state.json`;
    this.sidebarPersist=(this.sidebarPersist??Promise.resolve()).catch(()=>{}).then(async () => {
      const error = await saveStateFile({ path, read: (p) => readTextFile?.(p), write: writeTextFile, build: (prevText) => {
        const primary=this.primaryStateId(),views=cleanSidebarViews(shared('rig.sidebar.views'));
        views[primary]=cleanSidebarView({topologyView:this.viewState('rig.topology.view',primary),open:this.viewState('rig.open.sidebar',primary),selection:this.viewState('rig.sel',primary)});
        const prevParsed = parseSidebarState(prevText ?? "{}");
        const configuredIds = new Set([primary, ...(this.primary.config?.connections ?? []).map((c) => c.id)]);
        const rawByConn = cleanNotifiedNeedsMap(shared("rig.notifiedNeeds.byConn"));
        const primaryNeeds = cleanNotifiedNeeds(shared("rig.notifiedNeeds"));
        if (primaryNeeds) rawByConn[primary] = primaryNeeds;
        else delete rawByConn[primary];
        for (const f of this.feeds.slice(1)) {
          const entry = cleanNotifiedNeeds(shared(this.notifiedNeedsKey(f.id))) ?? rawByConn[f.id] ?? null;
          if (entry) rawByConn[f.id] = entry;
          else delete rawByConn[f.id];
        }
        const byConn = Object.fromEntries(Object.entries(rawByConn).filter(([id]) => configuredIds.has(id)));
        return serializeSidebarState(prevText, {
          open: this.viewState('rig.open.sidebar',this.primaryStateId()),
          order: orderMap ?? {},
          topologyView: this.viewState('rig.topology.view',this.primaryStateId()),
          sidebarViews: this.feeds.length>1||Object.keys(views).some(id=>id!==primary)?views:undefined,
          notifiedNeeds: shared("rig.notifiedNeeds"),
          notifiedNeedsByConnection: this.feeds.length > 1 || Object.keys(byConn).some((id) => id !== primary) || Boolean(prevParsed.notifiedNeedsByConnection) ? byConn : undefined,
          lastSeenNeedsAt: shared("rig.lastSeenNeedsAt"),
          needsView: shared("rig.needsView"),
          lastEndedModeApplicationId: shared("rig.lastEndedModeApplicationId"),
          lastActiveModeApplicationId: shared("rig.lastActiveModeApplicationId"),
        });
      } });
      this.sayStateSave(error);
    }).catch(() => {});
    return this.sidebarPersist;
  }

  /** Reads the config again; a change takes effect at once: a new daemon reconnects the stream. */
  /** One read of config.json through the module's numbered reads: the newest read that started installs (the gate sees it); an older one that lands after a newer install is `superseded` and the caller
   *  drops it (a refused connections list is never replaced by an allowed config); a newer read that FAILED never installed, so it cannot drop an older read's result (herdr's readTextFile throws on
   *  any error but NotFound). `config` is what this read parsed (the CLI-found address carried over when `keepCli`). */
  async readConfigText(keepCli = false) {
    let mine = null;
    const installed = await configReads(async () => { const parsed = parseConfig(await readTextFile(`${appHome()}/openrig/config.json`)); return (mine = keepCli ? preserveCliDiscoveredConfig(parsed, this.config) : parsed); });
    return { config: mine, superseded: () => installed !== mine };
  }
  async reloadConfig(cx) {
    const read = await this.readConfigText(true);
    if (read.superseded()) return; // a newer read has already installed: it wins
    const next = read.config;
    if (sameConfig(next, this.config)) return;
    const reconnect = !!this.config && next.daemonUrl !== this.config.daemonUrl;
    const rigChanged = !!this.config && JSON.stringify(next.rig) !== JSON.stringify(this.config.rig);
    // A settings change that is not just the same config enriched (the gate's own identity): the rows on screen came from the OLD daemon, and a row is something a person can
    // act on (Pause runs `rig down <name>` against whatever the config names now). They go at once, before the new daemon's first refresh publishes its own.
    const changed = !!this.config && !gateSameConfig(this.config, next);
    const prevPrimary = this.primaryStateId();
    this.config = next;
    if (changed) {
      this.data = null; this.live = false; this.lists = {}; this.primary.needsApproval = false; // another OpenRig: the old one's approval mark goes too
      this.healthz = null; this.cliVersion = null; // the old daemon's health and version are not the new one's; a failed read of the new one leaves them unknown (routeHost's selfHostId too)
      if (this.primaryStateId() === prevPrimary) {
        this.primary.prioritySeeded = false;
        setShared("rig.notifiedNeeds", null);
        const byConn = cleanNotifiedNeedsMap(shared("rig.notifiedNeeds.byConn"));
        delete byConn[prevPrimary];
        setShared("rig.notifiedNeeds.byConn", byConn);
      }
      this.setRigData({ topology: [], live: false, error: null, config: this.config });
      cx.notify();
    }
    this.restoreSidebarViews();
    this.syncFeeds(cx);
    if (reconnect || rigChanged) this.forceCapabilityProbe = true;
    if (reconnect) { try { this.sock?.close(); } catch (_) {} }
    try { await this.refresh(cx); } finally { this.syncFeeds(cx); } // the other connections' feeds start whatever the first one's refresh did
  }

  /** Expand a top-level branch in the tree and select it (`rig.<section>` command or branch click). */
  pickSection(section, cx, { openInPage = false, conn = null } = {}) {
    if (conn && !this.exactFeed(conn)) { notify({ title: "OpenRig", body: UNKNOWN_CONNECTION, level: "warning" }); return; } // a named connection that isn't this sidebar's: said, not replaced by another
    const stateConn = conn ?? undefined; // undefined: the box the sidebar shows
    const bKey = branchKey(section);
    const curOpen = this.viewState("rig.open.sidebar", stateConn) ?? {};
    const nextOpen = { ...curOpen, [bKey]: true };
    this.setViewState("rig.open.sidebar", nextOpen, stateConn);
    this.persistSidebarState(nextOpen, shared("rig.order"));
    const entry = this.entryOf(conn ? { section, conn } : { section }); // a section opened from the sidebar belongs to the box it shows, or to the one it names
    this.setViewState("rig.sel", { key: bKey, entry, at: Date.now() }, stateConn);
    if (openInPage) {
      openOrFocusRigTab({ shared, setShared, run, spaces, panes, layout, mayCreate: true }, entry);
    } else if (findRigTab(spaces?.() ?? [], panes?.() ?? []) || hasRigWorkStack(layout())) {
      // A Rig page already open follows the section (rig.<section> from the palette or keys), as a branch click does: the Rig tab on screen, when the
      // page may go there (a machine space with one OpenRig takes only its own); otherwise it is only logged.
      setShared("rig.nav", navPush(shared("rig.nav"), entry));
      const tab = onScreenRigTab(spaces, panes);
      if (tab) pushTabPage({ shared, setShared, panes }, tab, entry, { spaceConn: machineSpaceConn(this.config, spaces().find((s) => s?.active)) });
    }
    cx?.notify?.();
  }

  /** Click-to-inline-reply from a Needs-You toast (`rig.open-need`). */
  openNeedTarget(cx = null, idOrArgs = undefined, conn = null) {
    return this.openNeed(idOrArgs, cx, conn);
  }

  openNeed(idOrArgs = undefined, cx = null, conn = null) {
    const id = typeof idOrArgs === "object" && idOrArgs !== null
      ? (idOrArgs.id ?? null)
      : idOrArgs !== undefined
        ? idOrArgs
        : (shared("rig.pendingNeed") ?? this.lastNeedId ?? null);
    const all = this.data?.attentionItems ?? shared("rig.data")?.attentionItems ?? null;
    // The same ask id can exist on two OpenRigs: a toast names its connection, and the request opened is that connection's.
    let wanted = conn ?? (typeof idOrArgs === "object" && idOrArgs !== null ? idOrArgs.conn ?? null : null) ?? (id === this.lastNeedId ? this.lastNeedConn ?? null : null);
    // No connection named and the id is on more than one OpenRig: the one the sidebar shows if it has it, else none (never the first one's).
    if (!wanted && this.feeds.length > 1 && id && Array.isArray(all)) {
      const owners = [...new Set(all.filter((i) => String(i?.id ?? "") === String(id)).map((i) => i?.conn ?? this.primary.id))];
      if (owners.length > 1) {
        const shown = this.sidebarConnection();
        if (owners.includes(shown)) wanted = shown;
        else { notify({ title: "Request", body: AMBIGUOUS_REQUEST, level: "warning" }); if (shared("rig.pendingNeed")) setShared("rig.pendingNeed", null); cx?.notify?.(); return null; }
      }
    }
    const items = wanted && Array.isArray(all) ? all.filter((i) => (i?.conn ?? this.primary.id) === wanted) : all;
    const res = openNeed(id, { shared, setShared, run, items, layout, spaces, panes, conn: wanted });
    if (shared("rig.pendingNeed")) setShared("rig.pendingNeed", null);
    cx?.notify?.();
    return res;
  }

  /** The active space's Rig TUI, shown, or opened once (works without config.json). */
  tui(cx, conn = null) {
    // Before config.json has been read a refused list cannot be seen: wait, never fall back to a default config (it could open a home space and a TUI).
    if (!this.config) { notify({ title: "Open TUI", body: "OpenRig is still loading; try again in a moment", level: "warning" }); return; }
    const feed = conn ? this.exactFeed(conn) : this.followedFeed(); // a named connection is that OpenRig's TUI, exactly
    if (!feed) { notify({ title: "Open TUI", body: UNKNOWN_CONNECTION, level: "warning" }); return; }
    const config = feed.config, inRigLayout = inRigLayoutNow();
    cx.spawn(async (cx) => {
      const result = await openOrFocusTui({ spaces, panes, terminals, hc: hcFor(config), run: runFor(config), layout, inRigLayout, wait: (ms) => new Promise((r) => cx.timer.after(ms, () => r())) }, config);
      if (result?.ok === false) notify({ title: "Open TUI", body: result.reason, level: "warning" });
    });
  }

  /** Open `operator.agent` (`rig: "kernel"`) in a Herdr tab named `Operator`. */
  openOperator(cx, consent = null, conn = null) {
    // A named connection (a right-clicked space's) is that OpenRig's operator, exactly; never the box the sidebar shows instead. Unnamed: the box
    // the sidebar shows (the first with one connection), as before.
    const feed = conn ? this.exactFeed(conn) : this.followedFeed();
    if (!feed) { notify({ title: "Open operator", body: UNKNOWN_CONNECTION, level: "warning" }); return; }
    if (!feed.config?.daemonUrl) {
      notify({ title: "Open operator", body: "OpenRig is still loading; try again in a moment", level: "warning" });
      return;
    }
    const config = feed.config; // loaded: the guard above returned otherwise
    if (config?.daemonUrl && !isLoopbackDaemonUrl(config.daemonUrl) && !herdrIdentityOf(config)) { // a switched box's operator is reached like its seats
      notify({ title: "Open operator", body: REMOTE_OPERATOR_REASON, level: "warning" });
      cx?.notify?.();
      return;
    }
    const allSeats = (feed.data?.topology ?? []).flatMap((r) =>
      (r.pods ?? []).flatMap((p) => (p.seats ?? []).map((s) => ({ ...s, rig: r.name, rigId: r.id, conn: r.conn })))
    );
    const opSeat = allSeats.find((s) => s.logicalId === "operator.agent" || s.session === "operator-agent@kernel")
      ?? (feed.sidebarState?.operatorNode
          ? {
              ...feed.sidebarState.operatorNode,
              session: feed.sidebarState.operatorNode.canonicalSessionName ?? "operator-agent@kernel",
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
    const current = () => this.stillCurrent(feed, config); // the box this began for
    cx.spawn(async (cx) => {
      const res = await this.routeAttach((attempt) => this.routeHost(cx, consent, feed, attempt), config, { kind: "attach", seat: opSeat,
        options: { name: "Operator", operator: true, daemonUrl: config?.daemonUrl } }, "Open operator");
      if (res?.notified) { cx.notify(); return; } // its give-up already said it (one message per Attach)
      if (!current()) { notify({ title: "Open operator", body: CONNECTION_CHANGED_DURING, level: "warning" }); cx.notify(); return; }
      if (res?.needsConsent) this.reviewMachine(res, (cx, approval) => this.openOperator(cx, approval, feed.id), feed); // the approved retry is this box's, even when the click named none and the sidebar follows another box by then
      else if (res?.needsViewerRefresh) this.reviewViewerReplace(res, opSeat, { operator: true, name: "Operator" });
      else this.notifyResult("Open operator", res, true, { machine: config?.daemonMachine });
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
        const res = await execFor(config)(cmd.command, cmd.args, { timeout: 180000 });
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
        this.startDaemonError = plainExecError(e, { kind: "write" }).split("\n")[0];
        cx.notify();
      }
    });
  }

  /** `rig.attach:<session>`: a seat this sidebar knows, by its exact session name. Anything else is refused, never
   *  guessed (no stand-in seat, no command built from the name). */
  attachSeatBySession(cx, session, consent = null, conn = null) {
    if (!this.config?.daemonUrl) {
      notify({ title: "Attach", body: "OpenRig is still loading; try again in a moment", level: "warning" });
      return;
    }
    if (!isValidSessionName(session)) {
      notify({ title: "Attach", body: sessionNameRefusal(session), level: "warning" });
      return;
    }
    const seatsOf = (rigs) => rigs.flatMap((r) => r.pods.flatMap((p) => p.seats.map((s) => ({ ...s, rig: r.name, rigId: r.id, conn: r.conn }))));
    // The shown box first (a name two OpenRigs share, e.g. the kernel's operator, means the one on screen), then any other connection's: a bare name on two OpenRigs that the shown box lacks is refused, never picked.
    const all = seatsOf(this.data?.topology ?? []).filter((s) => s.session === session), shownId = this.shownConnId();
    // A forwarded Attach that names its connection is that OpenRig's seat only: never the shown box's same-named one.
    const seat = conn ? all.find((s) => (s.conn ?? this.primary.id) === conn) ?? null : all.find((s) => (s.conn ?? this.primary.id) === shownId) ?? (all.length === 1 ? all[0] : null);
    if (!seat) {
      notify({ title: `Attach ${session}`, body: all.length > 1 && !conn ? AMBIGUOUS_NAME : "That seat isn't in OpenRig's topology here.", level: "warning" });
      return;
    }
    // The seat's OWN connection, never the first in place of one removed meanwhile (feedOf falls back to the primary).
    const feed = this.exactFeed(seat.conn);
    if (!feed) { notify({ title: `Attach ${session}`, body: UNKNOWN_CONNECTION, level: "warning" }); return; }
    const config = feed.config, current = () => this.stillCurrent(feed, config);
    cx.spawn(async (cx) => {
      if (!current()) { notify({ title: `Attach ${session}`, body: CONNECTION_CHANGED_DURING, level: "warning" }); return; }
      const res = await this.routeAttach((attempt) => this.routeHost(cx, consent, feed, attempt), config, { kind: "attach", seat }, `Attach ${seat.logicalId ?? session}`);
      if (res?.notified) { cx.notify(); return; } // its give-up already said it (one message per Attach)
      // A late answer for a connection removed or edited during the await asks no approval and reports no result for it.
      if (!current()) { notify({ title: `Attach ${session}`, body: CONNECTION_CHANGED_DURING, level: "warning" }); cx.notify(); return; }
      if (res?.needsConsent) this.reviewMachine(res, (cx, approval) => this.attachSeatBySession(cx, session, approval, feed.id), feed); // the approved retry is for the same OpenRig's seat, even when the Attach named none
      else if (res?.needsViewerRefresh) this.reviewViewerReplace(res, seat);
      else this.notifyResult(`Attach ${seat.logicalId ?? session}`, res, true, { machine: config.daemonMachine });
      cx.notify();
    });
  }

  /** Is the connection this operation began for still the one drawn? The feed is live and its config is still the SAME CONNECTION (the gate's identity: id, address, home,
   *  machine, rig command), not the same object: on a default install every refresh replaces the primary's config object with an equal copy carrying the address the CLI found,
   *  and an object compare made each open, Attach and Operator report "connection changed" and drop its consent dialog and status card. */
  stillCurrent(feed, config) { return this.feeds.includes(feed) && !feed.closed && sameConnectionConfig(feed.config, config); }

  /** The feed of a connection id (the first when it names none or is unknown to this sidebar: a row never names a connection this sidebar lacks). */
  feedOf(conn) { return this.feeds.find((f) => f.id === conn) ?? this.primary; }
  /** The feed of exactly this connection id, or null: unlike feedOf, never the first connection in place of a removed one. With one connection, a
   *  row that names none (or names that one) is the first's. */
  exactFeed(conn) { return this.ownFeed(conn); }
  /** The open route (a seam at the await, so a test can hold it). */
  routeOpen(host, config, request) { return routeRigOpen(host, config, request); }
  /** An Attach on a Herdr machine: says what it is doing after ATTACH_PROGRESS_MS, and gives up at ATTACH_DEADLINE_MS with the step it was
   *  on. Once it gave up, the preparation stops at its next remote call and nothing is started, focused or replaced. Local attaches run as before. */
  async routeAttach(makeHost, config, request, title) {
    const machine = config?.daemonMachine, state = { step: null, done: false, cancelled: false }, host = makeHost(state);
    if (!machine || typeof host.wait !== "function") return this.routeOpen(host, config, request);
    const run = Promise.resolve().then(() => this.routeOpen(host, config, request)).finally(() => { state.done = true; });
    // Both timers belong to no view, and the give-up is said inside its own timer: neither a view that went away nor a lost continuation of
    // the open (a script interrupt drops the job it was running) can leave a failed Attach silent.
    const deadline = host.deadline ?? host.wait;
    deadline(ATTACH_PROGRESS_MS).then(() => {
      if (!state.done && !state.cancelled) notify({ title, body: `Still working on ${machine}: ${state.step ?? "starting"}.`, level: "info" });
    });
    let givenUp = null;
    const giveUp = deadline(ATTACH_DEADLINE_MS).then(() => {
      if (state.done) return null;
      state.cancelled = true;
      // A start already sent to Herdr can't be taken back: then the viewer may still appear.
      const next = state.step === "starting the viewer" ? "It may still appear; check before trying again."
        : state.step === "replacing the old viewer" ? "The old viewer may already be stopped; Attach again to start a new one." : "Nothing more will happen; try again.";
      givenUp = { ok: false, timedOut: true, notified: true, reason: `${title} didn't finish on ${machine} in ${ATTACH_DEADLINE_MS / 1000} s: it was ${state.step ?? "starting"}. ${next}` };
      notify({ title, body: givenUp.reason, level: "warning" });
      return TIMED_OUT;
    });
    const result = await Promise.race([run, giveUp]);
    if (result !== TIMED_OUT) return result;
    run.catch(() => {});
    return givenUp;
  }
  /** The connection the sidebar shows right now, for a lookup by NAME: with several, only a box that is actually shown (no fallback to the first); the only one with one connection. */
  shownConnId() { return this.feeds.length > 1 ? (this.drawnConnId ?? this.follow?.shownId ?? null) : this.primary.id; }
  /** `rig.open-seat:<session>`: the seat of the box the sidebar shows; a session name two OpenRigs hold and no shown box that has it is refused, never the first. */
  openSeatBySession(cx, session, conn = null) {
    const rows = this.priorityRows().filter((r) => r.seat?.session === session), shown = this.shownConnId();
    if (conn) { // a toast names its connection: that OpenRig's seat, never the shown box's same-named one
      const own = rows.find((r) => (r.rig?.conn ?? this.primary.id) === conn);
      if (own) this.seatClick(own.rig, own.seat, own.pod);
      else notify({ title: `Open ${session}`, body: `${session} isn't listed on that OpenRig any more.`, level: "warning" });
      return;
    }
    const row = rows.find((r) => (r.rig?.conn ?? this.primary.id) === shown) ?? (rows.length === 1 ? rows[0] : null);
    if (row) { this.seatClick(row.rig, row.seat, row.pod); return; }
    if (rows.length > 1) notify({ title: `Open ${session}`, body: AMBIGUOUS_NAME, level: "warning" });
  }
  /** The feed the sidebar's own header actions (Open TUI, Operator) act for: the box it shows (follow mode), the first when none is named, or null when the drawn connection was removed. */
  followedFeed() {
    const id = this.drawnConnId ?? this.follow?.shownId ?? null;
    if (!id) return this.primary;
    return this.feeds.find((f) => f.id === id) ?? null;
  }

  trackRouteOp(feed, attempt, countInflight, startPromise, { attemptOnly = false } = {}) {
    if (countInflight) {
      if (attempt) { attempt.inflight = (attempt.inflight ?? 0) + 1; attempt.lastBeat = Date.now(); }
      if (feed && !attemptOnly) feed.inflightRouteOps = (feed.inflightRouteOps ?? 0) + 1;
    } else if (attempt) {
      attempt.lastBeat = Date.now();
    }
    const done = () => {
      if (countInflight) {
        if (attempt) { attempt.inflight = Math.max(0, (attempt.inflight ?? 1) - 1); attempt.lastBeat = Date.now(); }
        if (feed && !attemptOnly) feed.inflightRouteOps = Math.max(0, (feed.inflightRouteOps ?? 1) - 1);
      } else if (attempt) {
        attempt.lastBeat = Date.now();
      }
    };
    try { return Promise.resolve(startPromise()).finally(done); }
    catch (error) { done(); throw error; }
  }

  /** One read for space adoption: whether the loopback address a rig space was made with still answers, and as which daemon (its pid). A GET of
   *  `<origin>/healthz` only, through loopbackHealthFetch: loopback addresses only, no headers (so no bearer), redirects refused, the body capped, the
   *  request and the read bounded by a timer. A request the runtime rejects (a refused connection, or any other failure to fetch) is NO_ANSWER (the daemon moved):
   *  the runtime's error doesn't say which. A request that ran out of time may be a slow daemon that is still running, so it, like any other outcome
   *  (a redirect, a non-ok answer, an oversized or unreadable one), is an error the caller treats as unproven (the person reviews the space). */
  healthProbe(cx) {
    return async (origin) => {
      let timedOut = false;
      const read = loopbackHealthFetch(globalThis.fetch.bind(globalThis), (ms, fn) => cx.timer.after(ms, () => { timedOut = true; fn(); }, { owner: null })); // made after awaits: no owner view, so another view's close can't drop the deadline
      let response;
      try { response = await read(`${origin}/healthz`); }
      catch (error) { if (timedOut) throw new Error(`${origin} did not answer in time, so it may still be running.`); throw error; }
      if (!response.ok) throw new Error(`${origin} answered without its health.`);
      return JSON.parse(await response.text());
    };
  }

  /** The host a connection's rig-space routing, attach and machine setup run through: every send is checked against THAT connection's gate scope (its address and home), never the first one's. */
  attachHost(cx, consent = null, feed = this.primary, attempt = null) {
    const config = feed.config, connectionId = config?.connectionId ?? LEGACY_CONNECTION_ID;
    const track = (fn, countInflight = true, opts) => this.trackRouteOp(feed, attempt, countInflight, fn, opts);
    const host = {
      onStep: (words, rebuilding = false) => {
        if (attempt) { attempt.step = words; attempt.lastBeat = Date.now(); attempt.onStepChange?.(words, rebuilding); }
      },
      onRebuildStart: () => { if (attempt) { attempt.lastBeat = Date.now(); attempt.onRebuildStart?.(); } },
      currentStep: () => attempt?.step ?? attempt?.defaultStep ?? null,
      cancelled: () => !!attempt?.cancelled,
      waitQueue: (fn) => track(fn, true, { attemptOnly: true }),
      registerBarrier: (release) => {
        if (attempt) (attempt.releases ??= new Set()).add(release);
        const own = (this.ownRouteReleases ??= new Set());
        own.add(release);
        return () => {
          attempt?.releases?.delete(release);
          own.delete(release);
        };
      },
      exec: (command, args, options) => track(() => execFor(config)(command, args, options)),
      spaces, panes, terminals,
      hc: (args, bytes) => track(() => hcFor(config)(args, bytes)),
      run: runFor(config), machines, layout, shared, setShared, routeOwner: true, seatShared: this.seatShared(), currentConfig: () => feed.config, openOverlay: spec => this.open(spec), closeOverlay,
      relayPath: attachRelayPath(appHome(), MOD_IDS.sidebar),
      wait: (ms) => track(() => new Promise((resolve) => cx.timer.after(ms, resolve)), ms < 10000),
      // A timer with no owner view: Herdr settles a view-owned timer only while its view lives, so a deadline must not depend on one.
      deadline: (ms) => new Promise((resolve) => cx.timer.after(ms, resolve, { owner: null })),
      probeHealth: this.healthProbe(cx), // adoption only: does the daemon a space was made with still answer, and as which process
      health: (url) => track(async () => { const r = await fetchFor(config)(`${url}/healthz`); if (!r.ok) throw new Error("Cannot read the tunnel's OpenRig health."); return r.json(); }),
      readConsent: () => track(async () => consentOf(await readTextFile(`${appHome()}/openrig/machine-consent.json`).catch(() => null), connectionId)),
      writeConsent: (value) => track(async () => {
        const path = `${appHome()}/openrig/machine-consent.json`;
        const previous = await readTextFile(path).catch(() => null);
        const text = consentText(previous, connectionId, value);
        await writeTextFile(path, previous === null ? text.trimEnd() : text.trimEnd(), previous);
      }) };
    const remote = new RemoteMachine(host);
    host.prepareRemote = (config, opts = {}) => remote.prepare(config, { ...opts, consent });
    host.prepareHome = config => remote.home(config);
    return host;
  }

  routeHost(cx, consent = null, feed = this.primary, attempt = null) {
    return { ...this.attachHost(cx, consent, feed, attempt), currentConfig:()=>feed.config, topology: () => feed.data?.topology ?? [], selfHostId: () => feed.healthz?.selfHostId,
      saveRouteState: patch => this.trackRouteOp(feed, attempt, true, () => this.saveSpaceState(patch)),
      syncGrid: (rig, options) => this.spaceController(cx, consent, feed, attempt).sync(rig, feed.config, options) };
  }

  async saveSpaceState(patch) {
    const path = `${appHome()}/openrig/state.json`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const previous = await readTextFile(path).catch(() => null);
      let parsed = {}; try { parsed = JSON.parse(previous ?? "{}"); } catch {}
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};
      try {
        await writeTextFile(path, JSON.stringify({ ...parsed, ...patch }, null, 2), previous);
        setShared("rig.spaceState", { ...(shared("rig.spaceState") ?? {}), ...patch });
        return;
      } catch (error) { if (attempt === 2) throw error; }
    }
  }

  /** The sidebar shows on every space (it folds only when the person folds Herdr's block). The command stays so an existing key binding still
   *  resolves; it just redraws. */
  showSidebarHere(cx) { cx.notify(); }
  /** Once: an area an earlier version folded to its 30 px header on a non-rig space gets its saved size back. Herdr keeps a block's size in its
   *  layout, so without this an upgrade on a personal space would stay folded. Recorded in state.json, so a fold the person makes later is kept. */
  retireAutoFold(block) {
    if (this.autoFoldChecked) return;
    const state = shared("rig.spaceState");
    if (!state) return; // state.json not read yet (or none: nothing was ever folded)
    // Not in the layout yet: look again on a later render. A block with no id is decided now: an earlier version could not fold it.
    if (!block) return;
    this.autoFoldChecked = true;
    if (state.autoFoldRetired) return;
    const saved = state.sidebarSize, size = saved && Number.isFinite(saved.px) && saved.px > 0 ? { px: saved.px } : saved && Number.isFinite(saved.weight) && saved.weight > 0 ? { weight: saved.weight } : null;
    if (block?.id && block.size?.px === 30 && size && size.px !== 30) run("layout.resize", { id: block.id, ...size });
    this.saveSpaceState({ autoFoldRetired: true }).catch(() => {});
  }

  showMachineOffer(cx) {
    this.showSidebarHere(cx);
    cx.timer.after(0,nextCx=>{liveFocus(this.machineOfferHandle)?.focus?.();nextCx.notify();}); // a released handle is skipped; the next draw makes a new one
  }

  migrationResultHere() {
    const result=migrationReportNow({spaces},this.migrationResult),id=this.activeSpaceContext?.id;
    return !!result&&!!id&&(result.spaceId===id||result.moved?.some(item=>item.destination===id));
  }

  migrationCard(t) {
    if(this.migrationResultHere())return this.migrationReport(t);
    const context=this.activeSpaceContext;
    if(!migrationSourceMatches({shared,selfHostId:this.healthz?.selfHostId},this.config,context))return null;
    const rig=this.relocationRigHere();
    if(rig&&!migrationChoice(shared("rig.spaceState"),this.config,context.id))return v_flex().id("rig-grid-move-card").mx(8).my(4).p(8).gap(6).rounded(6).bg(t.raised)
      .child(div().text_size(11.5).text_color(t.muted).child(`${rig.name}'s rig space is on this computer, but its seats now open on ${this.config.daemonMachine}.`))
      .child(h_flex().gap(8)
        .child(div().id("rig-grid-move").text_size(11.5).text_color(t.accent).cursor_pointer().child(`Move ${rig.name} to ${this.config.daemonMachine}`)
          .on_click((_e,cx)=>this.openRigSpace(cx,rig.id,null,null,null,null,rig.conn??null)))
        .child(div().id("rig-grid-keep").text_size(11.5).text_color(t.muted).cursor_pointer().child("Keep here").on_click((_e,cx)=>{
          cx.spawn(async cx=>{try{await this.saveSpaceState({tabMigration:migrationChoices(shared("rig.spaceState"),this.config,context.id,"keep")});}
            catch(error){notify({title:"Rig space",body:errorDiagnostic(error),level:"warning",where:"this computer"});}cx.notify();});
        })));
    if(!needsTabMigration(context,this.config) || migrationChoice(shared("rig.spaceState"),this.config,context.id)) return null;
    const choose=(choice,cx)=>{
      if(this.migratingTabs) return;
      this.migrationReplace=null;
      this.migratingTabs=context.id;
      cx.spawn(async cx=>{
      try {
        if(choice==="move") {
          const result=await migrateRigTabs(this.routeHost(cx),this.config,context.id);
          this.migrationResult={...result,spaceId:context.id};
        } else await this.saveSpaceState({tabMigration:migrationChoices(shared("rig.spaceState"),this.config,context.id,"keep")});
      } catch(error) { this.migrationResult={spaceId:context.id,left:[],moved:[],reason:errorDiagnostic(error)}; }
      finally { this.migratingTabs=null; cx.notify(); }
      });
    };
    return v_flex().id("rig-move-card").mx(8).my(4).p(8).gap(6).rounded(6).bg(t.raised)
      .child(div().text_size(11.5).text_color(t.muted).child(this.config?.daemonMachine
        ? `This space has OpenRig tabs. Move them to OpenRig's space on ${this.config.daemonMachine}?`
        : "This space has OpenRig tabs. Move them to OpenRig's space?"))
      .child(h_flex().gap(12)
        .child(div().id("rig-move-tabs").px(8).py(4).rounded(4).bg(t.hover).text_size(12).font_semibold().text_color(t.accent).cursor_pointer().hover(s=>s.bg(t.raised)).on_click((_e,cx)=>choose("move",cx)).child("Move"))
        .child(div().id("rig-keep-tabs").px(8).py(4).rounded(4).text_size(12).text_color(t.muted).cursor_pointer().hover(s=>s.bg(t.hover)).on_click((_e,cx)=>choose("keep",cx)).child("Keep here")));
  }

  observeDaemonMachines(cx) {
    if (this.viewFeed && this.viewFeed !== this.primary) return; // the machine offer belongs to the first connection; drawing another box must not reset it
    // The legacy one-connection offer (find where OpenRig runs, then set daemonMachine) is for the legacy config shape only: a connections list already
    // says where each OpenRig runs, and the offer's CLI discovery names no connection, so with several it would only draw the gate's refusal.
    if(!this.config?.daemonUrl||this.config?.daemonMachine||this.config?.connectionsList){this.machineChoiceAvailable=false;this.daemonMachineOffer=null;return;}
    if(this.machineObservedOrigin!==this.config.daemonUrl){
      this.machineObservedOrigin=this.config.daemonUrl;this.daemonMachineOffer=null;this.machineSearchComplete=false;
    }
    this.machineChoiceAvailable=machines().some(m=>m.name&&m.layout==="ready")
      &&!shared("rig.spaceState")?.machineSearchDeclined?.[rigOrigin(this.config.daemonUrl)];
    if(!this.machineChoiceAvailable){this.daemonMachineOffer=null;return;}
    if(this.machineAutoChecked)return;
    // One automatic decision per sidebar lifetime, not per refresh or machine-list revision.
    this.machineAutoChecked=true;
    const config={...this.config};
    cx.timer.after(0,nextCx=>nextCx.spawn(async cx=>{
      try{
        const local=await discoverDaemonFromCli(config,exec);
        if(this.closed||this.config?.daemonMachine||this.config?.daemonUrl!==config.daemonUrl)return;
        if(!local.reachable||rigOrigin(local.daemonUrl)!==rigOrigin(config.daemonUrl))await this.findDaemonMachine(cx,config);
      }catch(error){this.machineDetectionError=errorDiagnostic(error);}
      cx.notify(); // the next draw makes the card's focus handles (ensureMachineHandles)
    }));
  }

  /** The machine card's focus handles, made through a timer set from the draw (this sidebar's own call), never after an await; a released one is
   *  made again. */
  ensureMachineHandles(cx){
    const names=["machineOfferHandle","machineHintHandle","machineFindHandle","machineUseHandle","machineDeclineHandle"];
    if(this.machineHandlesPending||!cx?.timer?.after||names.every(name=>liveFocus(this[name])))return;
    this.machineHandlesPending=true;
    cx.timer.after(0,next=>{this.machineHandlesPending=false;if(this.closed||!next?.focus_handle)return;for(const name of names)if(!liveFocus(this[name]))this[name]=next.focus_handle();next.notify?.();});
  }
  async findDaemonMachine(cx,config={...this.config}) {
    if(this.machineFinding||config.daemonMachine)return;
    this.machineFinding=true;this.machineDetectionError=null;
    try{
      const offer=await detectDaemonMachine(this.attachHost(cx),config);
      if(this.closed||this.config?.daemonMachine||this.config?.daemonUrl!==config.daemonUrl)return;
      this.daemonMachineOffer=offer&&!shared("rig.spaceState")?.machineDeclined?.[offer.key]?{...offer,origin:config.daemonUrl}:null;
      this.machineSearchComplete=true;
      // The next draw makes the offer's focus handles (ensureMachineHandles), never this continuation.
    }catch(error){this.machineDetectionError=errorDiagnostic(error);}
    finally{this.machineFinding=false;cx.notify();}
  }

  machineOfferCard(t,cx) {
    this.ensureMachineHandles(cx);
    const offer=this.daemonMachineOffer;
    if(!offer)return v_flex().id("rig-daemon-machine-search").mx(8).my(4).p(8).gap(6).rounded(6).bg(t.raised)
      .when(!!this.machineOfferHandle,el=>el.track_focus(this.machineOfferHandle).tab_stop(true).tab_index(0))
      .child(div().text_size(11.5).text_color(t.muted).child(this.machineDetectionError?errorBlock(this,t,"machine-detection-error",this.machineDetectionError,{where:"this computer"}):(this.machineSearchComplete
        ? "No single machine matched. To choose one, add the key below to openrig/config.json." : "Choose where OpenRig's spaces open.")))
      .when(!!this.machineSearchComplete,el=>el.child(h_flex().gap(5).items_center()
        .child(div().font_family(settings()?.font_family??"monospace").text_size(11.5).text_color(t.muted).child("daemonMachine"))
        .child(div().id("rig-copy-machine-key").size(18).cursor_pointer().tooltip("Copy daemonMachine")
          .on_click((_e,cx)=>this.copyToClipboard(cx,"daemonMachine","machine-key"))
          .child(svg(icon("copy")).size(12).text_color(t.muted)))))
      .child(div().id("rig-find-daemon-machine").px(6).py(3).text_size(11.5).text_color(t.accent).cursor_pointer()
        .when(!!this.machineFindHandle,el=>el.track_focus(this.machineFindHandle).tab_stop(true).tab_index(0))
        .on_mouse_down('left',activationPair(this,'find-daemon-machine').pointer())
        .on_click(activationPair(this,'find-daemon-machine').click((_e,cx)=>cx.spawn(cx=>this.findDaemonMachine(cx))))
        .on_key_down(activationPair(this,'find-daemon-machine').key((event,cx)=>{if(!event.is_held&&["enter"," ","space"].includes(String(event.key??"").toLowerCase())){cx.stop_propagation();cx.spawn(cx=>this.findDaemonMachine(cx));}}))
        .child(this.machineFinding?"Finding…":"Find where OpenRig runs"));
    const act=(use,cx)=>{
      if(use){
        this.reviewMachine({confirmation:{machine:offer.machine}},()=>{});return;
      }
      if(this.machineOfferBusy)return;this.machineOfferBusy=true;
      cx.spawn(async cx=>{
        try{
          if(!use){
            await this.saveSpaceState({machineDeclined:{...(shared("rig.spaceState")?.machineDeclined??{}),[offer.key]:true},
              machineSearchDeclined:{...(shared("rig.spaceState")?.machineSearchDeclined??{}),[rigOrigin(this.config.daemonUrl)]:true}});
            this.daemonMachineOffer=null;this.machineChoiceAvailable=false;
          }
        }catch(error){this.machineOfferError=errorDiagnostic(error);}
        finally{this.machineOfferBusy=false;cx.notify();}
      });
    };
    return v_flex().id("rig-daemon-machine-offer").mx(8).my(4).p(8).gap(6).rounded(6).bg(t.raised)
      .when(!!this.machineOfferHandle,el=>el.track_focus(this.machineOfferHandle).tab_stop(true).tab_index(0))
      .when(!!liveFocus(this.machineOfferHandle)?.is_focused?.(),el=>el.border_1().border_color(t.accent))
      .child(div().text_size(11.5).text_color(t.muted).child(`OpenRig runs on ${offer.machine}. Put OpenRig's spaces and Attach there?`))
      .child(h_flex().gap(8)
        .child(div().id("rig-use-daemon-machine").px(6).py(3).rounded(4).text_size(11.5).text_color(t.accent).cursor_pointer()
          .when(!!this.machineUseHandle,el=>el.track_focus(this.machineUseHandle).tab_stop(true).tab_index(0))
          .on_mouse_down('left',activationPair(this,'use-daemon-machine').pointer())
          .on_key_down(activationPair(this,'use-daemon-machine').key((event,cx)=>{if(!event.is_held&&["enter"," ","space"].includes(String(event.key??"").toLowerCase())){cx.stop_propagation();act(true,cx);}}))
          .on_click(activationPair(this,'use-daemon-machine').click((_e,cx)=>act(true,cx))).child(`Use ${offer.machine}`))
        .child(div().id("rig-decline-daemon-machine").px(6).py(3).text_size(11.5).text_color(t.muted).cursor_pointer()
          .when(!!this.machineDeclineHandle,el=>el.track_focus(this.machineDeclineHandle).tab_stop(true).tab_index(0))
          .on_mouse_down('left',activationPair(this,'decline-daemon-machine').pointer())
          .on_key_down(activationPair(this,'decline-daemon-machine').key((event,cx)=>{if(!event.is_held&&["enter"," ","space"].includes(String(event.key??"").toLowerCase())){cx.stop_propagation();act(false,cx);}}))
          .on_click(activationPair(this,'decline-daemon-machine').click((_e,cx)=>act(false,cx))).child("Not now")))
      .when(!!this.machineOfferError,el=>el.child(errorBlock(this,t,"machine-offer-error",this.machineOfferError,{where:"this computer"})));
  }

  migrationReport(t) {
    const result=migrationReportNow({spaces},this.migrationResult);
    const quiet=(id,label,click)=>div().id(id).px(6).py(3).rounded(4).text_size(11.5).text_color(t.accent)
      .cursor_pointer().hover(s=>s.bg(t.hover)).on_click(click).child(label);
    const report=v_flex().id("rig-move-result").mx(8).my(4).p(8).gap(6).rounded(6).bg(t.raised)
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child("Move OpenRig tabs"));
    const movedNames=new Map();
    for(const item of result.moved??[])movedNames.set(item.name,(movedNames.get(item.name)??0)+1);
    for(const [name,count] of movedNames)report.child(div().text_size(11.5).text_color(t.muted).child(count>1?`Moved ${count} ${name} tabs.`:`Moved ${name}.`));
    for(const item of result.left??[])report.child(v_flex().gap(3)
      .child(errorBlock(this,t,`migration-left-${item.tabId}`,item.reason,{where:"this computer",prefix:`Left ${item.name} here: `}))
      .child(h_flex().gap(6)
        .child(quiet(`rig-show-left-${item.tabId}`,"Show tab",()=>{
          run("space.select",{id:result.spaceId});run("tab.select",{id:item.tabId});
        }))
        .when(!!item.pageOnly,el=>el.child(quiet(`rig-move-page-${item.tabId}`,"Move the Rig page only",(_e,cx)=>{
          if(this.migratingTabs)return;
          this.migratingTabs=result.spaceId;
          const config=this.config;
          cx.spawn(async cx=>{
            try{
              const opened=await moveMigrationPages(this.routeHost(cx),config,{...item,spaceId:result.spaceId});
              this.migrationResult=opened.ok?{...result,reason:null,left:result.left.filter(row=>row.tabId!==item.tabId),
                moved:[...(result.moved??[]),{name:`${item.name} (Rig page only; other panes stayed here)`,destination:opened.space}]}:
                {...result,left:result.left.map(row=>row.tabId===item.tabId?{...row,reason:opened.reason,pageOnly:false}:row)};
            }catch(error){this.migrationResult={...result,error:errorDiagnostic(error)};}
            finally{this.migratingTabs=null;cx.notify();}
          });
        })))
        .when(!!item.replaceable,el=>el.child(quiet(`rig-replace-left-${item.tabId}`,"Replace…",(_e,cx)=>{
          this.migrationConfirmations??=new RebuildConfirmations();
          const recovery={...item,origin:this.config?.daemonUrl,machine:this.config?.daemonMachine??null};
          const token=this.migrationConfirmations.issue(result.spaceId,recovery);
          this.migrationReplace={rigId:result.spaceId,token,name:item.name};cx.notify();
        })))));
    if(result.reason&&!(result.left?.length))report.child(errorBlock(this,t,"migration-reason",result.reason,{where:"this computer"}));
    if(result.error)report.child(errorBlock(this,t,"migration-error",result.error,{where:"this computer"}));
    if(this.migrationReplace){
      const request=this.migrationReplace;
      report.child(div().text_size(12).font_semibold().text_color(t.foreground).child(`Replace ${request.name}?`))
        .child(div().text_size(11.5).text_color(t.muted).child("Open a fresh TUI in OpenRig's space, then close this restored shell. Anything running or typed in this shell is lost. If this is its space's last tab, that space closes too."))
        .child(h_flex().gap(6)
          .child(quiet("rig-replace-cancel","Cancel",(_e,cx)=>{this.migrationConfirmations.take(request);this.migrationReplace=null;cx.notify();}))
          .child(quiet("rig-replace-confirm","Replace TUI",(_e,cx)=>{
            const approved=this.migrationConfirmations.take(request);this.migrationReplace=null;
            if(!approved||this.migratingTabs)return;
            if(approved.recovery.origin!==this.config?.daemonUrl||approved.recovery.machine!==(this.config?.daemonMachine??null)){
              this.migrationResult={...result,reason:"OpenRig's connection changed. Review the tab again.",left:[]};cx.notify();return;
            }
            this.migratingTabs=result.spaceId;
            cx.spawn(async cx=>{
              try{
                const opened=await replaceMigrationTab(this.routeHost(cx),this.config,{...approved.recovery,spaceId:result.spaceId});
                this.migrationResult=opened.ok?{...result,reason:null,error:opened.error,left:result.left.filter(row=>row.tabId!==approved.recovery.tabId),
                  moved:[...(result.moved??[]),{...approved.recovery,destination:opened.space,name:`${approved.recovery.name} (fresh TUI)`}]}:
                  {...result,left:result.left.map(row=>row.tabId===approved.recovery.tabId?{...row,reason:opened.reason,replaceable:false}:row)};
              }catch(error){this.migrationResult={...result,error:errorDiagnostic(error)};}
              finally{this.migratingTabs=null;cx.notify();}
            });
          })));
    }
    report.child(quiet("rig-move-result-dismiss","Dismiss",(_e,cx)=>{this.migrationResult=null;this.migrationReplace=null;cx.notify();}));
    return report;
  }

  routeRequest(cx, request, consent = null) {
    request = { ...request, conn: request.conn ?? request.entry?.conn ?? request.seat?.conn };
    // A forwarded route: command in the init window: there is no config to open anything for yet.
    if (!this.config) { this.notifyResult("OpenRig", { ok: false, reason: "OpenRig's settings are still loading. Try again in a moment." }); return; }
    cx.spawn(async (cx) => {
      try {
        // A caller supplies an identity, never authority to invent a seat or its command. Its options are allow-listed
        // (the replace the person approved must ride through), never inherited whole.
        const allowedOptions = (options) => Object.fromEntries(["replaceViewer", "operator", "name"].filter((key) => options?.[key] !== undefined).map((key) => [key, options[key]]));
        let selected = { ...request, options: allowedOptions(request.options), background: false };
        // The connection comes from the request (a rig's or a seat's own). With several OpenRigs one that names none is refused: it is never the first's by default.
        const pageNeedsConn = request.kind === "page" && request.entry?.section !== "system" && request.entry?.section !== "file";
        if ((this.primary.config?.connections?.length ?? this.feeds.length) > 1 && !request.conn && !request.seat?.conn && (request.kind !== "page" || pageNeedsConn)) { this.notifyResult("OpenRig", { ok: false, reason: NO_CONNECTION }); return; }
        // feedOf falls back to the primary for an id it lacks, so a request for a connection removed meanwhile is refused here, before any host is built.
        let feed = request.conn ? this.ownFeed(request.conn) : this.feedOf(null); // a page request with no connection is the first's, as before
        if (request.conn && !feed) { this.notifyResult("OpenRig", { ok: false, reason: UNKNOWN_CONNECTION }); return; }
        if (request.kind === "attach") {
          const session = request.seat?.session ?? request.seat?.canonicalSessionName;
          const wanted = request.conn ?? request.seat?.conn ?? null; // the request's connection decides which OpenRig's seat a shared name means
          const seat = (this.data?.topology ?? []).flatMap(r => (r.pods ?? []).flatMap(p => (p.seats ?? [])
            .map(s => ({ ...s, rig: r.name, rigId: r.id, conn: r.conn })))).find(s => s.session === session && (!wanted || s.conn === wanted));
          if (!seat) { this.notifyResult("Attach", { ok: false, reason: "That seat isn't in OpenRig's topology here." }); return; }
          // Identity comes from the seat, never from the caller: a caller's `operator` cannot make a plain seat look
          // like the operator. The rest of the allow-listed options ride through.
          selected = { ...selected, seat, options: { ...selected.options, operator: seat.logicalId === "operator.agent" } };
          feed = this.exactFeed(seat.conn);
        }
        if (!feed) { this.notifyResult("OpenRig", { ok: false, reason: UNKNOWN_CONNECTION }); return; }
        // The feed and config this request began with: re-checked after the await, so a removed or edited connection's late answer
        // asks no approval and reports nothing for it, and is never resolved to the first connection.
        const config = feed.config, current = () => this.stillCurrent(feed, config);
        const result = selected.kind === "attach" ? await this.routeAttach((attempt) => this.routeHost(cx, consent, feed, attempt), config, selected, "Attach")
          : await this.routeOpen(this.routeHost(cx, consent, feed), config, selected);
        if (result?.notified) return; // its give-up already said it (one message per Attach)
        if (!current()) { this.notifyResult(request.kind === "attach" ? "Attach" : "OpenRig", { ok: false, reason: CONNECTION_CHANGED_DURING }); return; }
        if (result.needsConsent) this.reviewMachine(result, (cx, approval) => this.routeRequest(cx, request, approval), feed);
        else if (result.needsViewerRefresh) this.reviewViewerReplace(result, selected.seat ?? request.seat ?? {}, selected.options ?? {});
        else this.notifyResult(request.kind === "attach" ? "Attach" : "OpenRig", result, true, { machine: config?.daemonMachine });
      } catch (error) {
        this.notifyResult("OpenRig", { ok: false, reason: errorDiagnostic(error) });
      } finally { cx.notify(); }
    });
  }

  reviewMachine(result, resume, feed = null, waitingForRig = null) {
    this.machineConfirmations ??= new Map();
    // One active first-use dialog per sidebar; a stale dialog cannot authorize a later request.
    this.machineConfirmations.clear();
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    this.machineConfirmations.set(token, { confirmation: result.confirmation, resume });
    setShared("rig.machineSetupToken",token);
    if(this.machineSetupOverlay)closeOverlay(this.machineSetupOverlay);
    const connProp = feed && this.feeds.length > 1 ? { conn: feed.id } : {};
    this.machineSetupOverlay=this.open({ mod: MOD_IDS.menu, kind: "dialog", modal: true, width: 600, height: 680,
      props: { target: { kind: "machine", ...connProp }, step: { action: "confirm-machine", token, confirmation: result.confirmation, ...(waitingForRig ? { waitingForRig } : {}), ...connProp } } }); // the connection the review is for: the dialog's checks and writes act for it
  }

  /** Whether one connection offers "Approve helper…": the switch is offered (`herdrOffered`, for tests, else the release's own value), the connection uses
   *  Herdr's connection, and its last read asked for the helper's approval again. */
  offersApproval(feed) {
    return (this.herdrOffered ?? HERDR_CONNECTION_OFFERED) === true && feed?.needsApproval === true && String(feed?.config?.daemonUrl ?? "").startsWith("herdr://");
  }
  /** The "Approve helper on <machine>…" action line: in the tree's refresh notice, and in the state views drawn when there is no data. */
  approveHelperLink(t, feed) {
    const activation=activationPair(this,`approve-helper-${feed.id}`);
    return div().id(`sidebar-approve-helper-${feed.id}`).tooltip(`Check the helper Herdrig uses on ${feed.config?.daemonMachine ?? "the machine"}, then approve it. Nothing is approved until you choose Approve.`).role("button").tab_stop(true).px(6).py(3).text_size(12).text_color(t.accent).cursor_pointer()
      .focus((el) => el.border_1().border_color(t.accent)).on_mouse_down('left',activation.pointer())
      .on_click(activation.click(() => this.openApproveHelper(feed)))
      .on_key_down(activation.key((event, cx) => { if (["enter", " ", "space"].includes(String(event.key ?? "").toLowerCase())) { cx.stop_propagation(); this.openApproveHelper(feed); } }))
      .child(`Approve helper on ${feed.config?.daemonMachine ?? "the machine"}…`);
  }
  /** "Approve helper…" for one herdr:// connection: the menu's review dialog for that connection (the approval it writes is that connection's alone). */
  openApproveHelper(feed) {
    if (!this.offersApproval(feed)) return;
    this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 560, height: 360,
      props: { target: { kind: "machine" }, step: { action: "approve-helper", id: feed.id, machine: feed.config?.daemonMachine ?? null } } });
  }

  /** An Attach tab from before an update runs an older viewer. The person is asked before anything is
   *  stopped or closed; the dialog's confirm re-runs Attach with the replace. Nothing else touches that tab. */
  reviewViewerReplace(result, target, options = {}) {
    this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: 320,
      props: { target, step: { action: "replace-viewer", staleViewer: result?.staleViewer ?? null,
        ...(options.operator ? { operator: true } : {}), ...(options.name ? { name: options.name } : {}) } } });
  }

  spaceController(cx, consent = null, feed = this.primary, attempt = null) {
    const key = feed.id ?? "", all = (this.rigSpacesBy ??= new Map());
    if (!all.has(key)) all.set(key, new RigSpaces({ spaces, panes, terminals, focused, commands, hc: hcFor(feed.config), run: runFor(feed.config),
      currentConfig:()=>feed.config, probeHealth: this.healthProbe(cx),
      gateToken: () => gateGeneration(feed.config?.connectionId), gateCurrent: (token) => gateGeneration(feed.config?.connectionId) === token, // the settings this build began under
      recoveryShell: () => this.trackRouteOp(feed, this.currentSpaceAttempt?.get(key) ?? null, true, async () => {
        const node = feed.config?.rig?.[0]?.match(/(?:^|\/)node$/) ? feed.config.rig[0] : "node";
        const result = await execFor(feed.config)(node, [`${appHome()}/mods/${MOD_IDS.sidebar}/rig-shell-config.cjs`]);
        return result.code === 0 ? JSON.parse(result.stdout) : null;
      }),
      padPath: `${appHome()}/mods/${MOD_IDS.sidebar}/rig-grid-pad.cjs`,
      viewerPath: `${appHome()}/mods/${MOD_IDS.sidebar}/rig-grid-viewer.cjs`, selfHostId: () => feed.healthz?.selfHostId,
      wait: (ms) => this.trackRouteOp(feed, this.currentSpaceAttempt?.get(key) ?? null, ms < 10000, () => new Promise((resolve) => cx.timer.after(ms, resolve))) }));
    (this.currentSpaceAttempt ??= new Map()).set(key, attempt);
    const controller = all.get(key);
    const attached = this.attachHost(cx, consent, feed, attempt);
    controller.host.prepareRemote = attached.prepareRemote;
    controller.host.prepareHome = attached.prepareHome;
    controller.host.health = attached.health;
    controller.host.exec = attached.exec;
    controller.host.hc = attached.hc;
    controller.host.onStep = attached.onStep;
    controller.host.onRebuildStart = attached.onRebuildStart;
    controller.host.currentStep = attached.currentStep;
    controller.host.deadline = attached.deadline;
    controller.host.probeHealth = attached.probeHealth; // this attempt's cx, like deadline and health
    controller.host.waitQueue = attached.waitQueue;
    controller.host.registerBarrier = attached.registerBarrier;
    controller.host.explicitRequested = () => Boolean(attempt?.rigKey && this.opening?.has(attempt.rigKey));
    controller.host.openOverlay = spec=>this.open(spec);
    controller.host.closeOverlay = closeOverlay;
    controller.host.shared = shared;controller.host.setShared = setShared;
    if (feed === this.primary) this.rigSpaces = controller;
    return controller;
  }

  gridSeatName(rig, session) {
    return (rig.pods ?? []).flatMap((p) => p.seats ?? []).find((s) => s.session === session)?.logicalId ?? (session || "Empty tile");
  }

  reviewRigRebuild(rig, result) {
    this.rebuildConfirmations ??= new RebuildConfirmations();
    const token = this.rebuildConfirmations.issue(rig.id, result.recovery,rig.conn||result.relocation||result.worker?{...(rig.conn?{conn:rig.conn}:{}),...(result.relocation?{relocation:result.relocation}:{}),...(result.worker?{worker:result.worker}:{})}:null);
    const focusedTile = panes().some((p) => result.recovery.tiles.some((tile) => tile.pane === p.pane)
      && (p.focused || p.terminal === focused()?.terminal));
    this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 480, height: Math.min(440, 250 + result.recovery.tiles.length * 20),
      props: { target: { kind: "rig", rig: rig.name, rigId: rig.id, conn: rig.conn }, step: { action: "rebuild-space", recovery: result.recovery,
        token, focusedTile, continueMove:!!result.relocation,
        tileNames: result.recovery.tiles.map((tile) => this.gridSeatName(rig, tile.labels["herdr-openrig.seat"])) } } });
  }

  reviewGridMove(rig,relocation,rebuild=null,worker=null) {
    this.gridMoveConfirmations??=new RebuildConfirmations();
    const token=this.gridMoveConfirmations.issue(rig.id,relocation,rig.conn||rebuild||worker?{...(rig.conn?{conn:rig.conn}:{}),...(rebuild?{rebuild}:{}),...(worker?{worker}:{})}:null);
    this.open({mod:MOD_IDS.menu,kind:"dialog",width:520,height:380,
      props:{target:{kind:"rig",rig:rig.name,rigId:rig.id,conn:rig.conn},step:{action:"move-grid",relocation,token}}});
  }

  gridMoveResultHere() {
    const r=this.gridMoveResult;
    return !!r&&[r.oldSpace,r.space].includes(this.activeSpaceContext?.id);
  }

  gridMoveReport(t) {
    const r=this.gridMoveResult;
    if(!this.gridMoveResultHere())return null;
    const oldOpen=spaces().some(s=>s.id===r.oldSpace);
    const action=(id,text,click)=>div().id(id).text_size(11.5).text_color(t.accent).cursor_pointer().child(text).on_click(click);
    return v_flex().id("rig-grid-move-report").mx(8).my(4).p(8).gap(5).rounded(6).bg(t.raised)
      .child(div().text_size(12).font_semibold().child(`Move ${r.name}`))
      .child(div().text_size(11.5).child(`Opened ${r.name} on ${r.machine}.`))
      .when(r.count>0,el=>el.child(div().text_size(11.5).child(`Closed ${r.count} old viewer${r.count===1?"":"s"}.`)))
      .when(!oldOpen,el=>el.child(div().text_size(11.5).child("The old space closed.")))
      .when(oldOpen&&!!r.keptTabs,el=>el.child(div().text_size(11.5).child(r.keptTabs===1?"Kept the old space for your tab.":`Kept the old space for your ${r.keptTabs} tabs.`)))
      .when(oldOpen&&!r.keptTabs&&!!r.changed?.length,el=>el.child(div().text_size(11.5).child("Kept the old space because a tile there changed.")))
      .when(oldOpen&&!!r.failed?.length,el=>el.child(div().text_size(11.5).child(`Old viewers didn't close: ${r.failed.join(", ")}.`))
        .child(action("rig-grid-move-retry","Close them again",(_e,cx)=>this.openRigSpace(cx,r.rigId,null,null,null,null,r.conn??null))))
      .when(oldOpen&&!!r.changed?.length,el=>el.children((r.changedRows??r.changed.map(name=>({name,reason:"it changed"}))).map(row=>
        errorBlock(this,t,`grid-move-left-${row.name}`,row.reason,{prefix:`Left ${row.name} here: `,suffix:" Close it yourself if you don't need it."}))))
      .when(!!r.namingError,el=>el.child(errorBlock(this,t,"grid-move-naming-error",r.namingError,{where:r.machine??"this computer"})))
      .when(oldOpen,el=>el.child(action("rig-grid-move-show","Show old space",()=>{
        if(spaces().some(s=>s.id===r.oldSpace))run("space.select",{id:r.oldSpace});
      })))
      .child(action("rig-grid-move-dismiss","Dismiss",(_e,cx)=>{this.gridMoveResult=null;cx.notify();}));
  }

  /** The key of this rig's space card and "opening" mark: the rig id with one OpenRig, qualified by its connection with several (two OpenRigs can hold the same rig id). */
  statusKey(rig) { return spaceStatusKey(rig?.conn, rig?.id, this.feeds.length > 1); }

  /** Compare with the current shared card, not a local memo: another sidebar can have changed it since our last result. */
  publishSpaceStatus(key, result, statuses = shared("rig.spaceStatus") ?? {}) {
    if (sameValue(statuses[key], result)) return false;
    setShared("rig.spaceStatus", { ...statuses, [key]: result });
    return true;
  }

  isWaitingConsent(status, config) {
    return Boolean(status?.needsConsent && (!status.confirmation
      || (status.confirmation.machine === config?.daemonMachine && status.confirmation.origin === config?.daemonUrl)));
  }

  /** Publishes the spinner lines of the spaces being opened or rebuilt, only when they changed: a background sync calls this once per rig per refresh,
   *  and each publish re-renders every mod. The status map is read only while a rebuild is pending. */
  publishSpaceOpening() {
    const next = {};
    for (const [k, a] of this.openingAttempts ?? []) {
      if (!a.settled && this.opening?.has(k)) next[k] = this.openingLine(a.rig);
    }
    if (this.gridSteps?.size) {
      const statuses = shared("rig.spaceStatus") ?? {};
      for (const [k, g] of this.gridSteps) {
        if (!next[k] && g?.rebuilding && !this.isWaitingConsent(statuses[k], this.feedOf(g.rig?.conn)?.config)) {
          next[k] = this.openingLine(g.rig, g.step, true);
        }
      }
    }
    if (this.publishedSpaceOpening && sameValue(next, this.publishedSpaceOpening)) return;
    this.publishedSpaceOpening = next;
    setShared("rig.spaceOpening", next);
  }

  /** Detect an open or background grid sync whose QuickJS continuation was interrupted mid-turn without settling its Promise. */
  checkInterruptedOpens(cx, now = Date.now()) {
    const OPEN_INTERRUPT_STALE_MS = 2000;
    const bg = this.activeBgSync;
    if (bg && !bg.settled && (bg.inflight ?? 0) === 0 && (bg.feed?.inflightRouteOps ?? 0) === 0 && now - bg.lastBeat >= OPEN_INTERRUPT_STALE_MS) {
      bg.settled = true;
      bg.interrupted = true;
      this.activeBgSync = null;
      this.spaceSyncing = false;
      this.gridSteps?.delete(bg.statusKey);
      for (const release of [...(bg.releases ?? [])]) release();
      clearInterruptedRouteJob(bg.config, bg.rig.name);
      this.rigSpacesBy?.get(bg.feed?.id ?? "")?.clearPending(bg.rig, bg.config);
      this.publishSpaceOpening();
      cx.notify();
    }
    if (!this.openingAttempts?.size) return;
    for (const [key, attempt] of [...this.openingAttempts.entries()]) {
      if (attempt.settled) { this.openingAttempts.delete(key); continue; }
      if ((attempt.inflight ?? 0) > 0 || (attempt.feed?.inflightRouteOps ?? 0) > 0) continue;
      if (now - attempt.lastBeat < OPEN_INTERRUPT_STALE_MS) continue;
      attempt.settled = true;
      attempt.interrupted = true;
      this.opening?.delete(key);
      this.openingNames?.delete(key);
      this.openingAttempts.delete(key);
      const step = this.gridSteps?.get(key)?.step ?? attempt.step ?? attempt.defaultStep;
      this.gridSteps?.delete(key);
      for (const release of [...(attempt.releases ?? [])]) release();
      clearInterruptedRouteJob(attempt.config, attempt.rig.name);
      this.rigSpacesBy?.get(attempt.feed?.id ?? "")?.clearPending(attempt.rig, attempt.config);
      this.publishSpaceOpening();
      if (this.stillCurrent(attempt.feed, attempt.config)) {
        const reason = `Opening ${attempt.rig.name} was interrupted while ${step}. Try opening the rig space again.`;
        const result = { ok: false, retryable: true, preparationFailed: true, interrupted: true, reason };
        this.publishSpaceStatus(key, result);
        notify({ title: `${attempt.rig.name} space`, body: reason, level: "warning" });
      }
      cx.notify();
    }
  }

  openRigSpace(cx, id, rebuild = null, consent = null, relocation = null, continueWorker = null, conn = null) {
    // By id first (unique per OpenRig); a bare NAME two OpenRigs share is refused, never the first one's.
    const topology = (this.data?.topology ?? []).filter(r=>!conn||(r.conn??this.primary.id)===conn), byId = topology.find((r) => r.id === id), named = topology.filter((r) => r.name === id);
    if (!byId && new Set(named.map((r) => r.conn ?? this.primary.id)).size > 1) { notify({ title: "Rig space", body: AMBIGUOUS_NAME, level: "warning" }); return; }
    // An id is unique within one OpenRig only: with no connection named, an id two OpenRigs both list is refused, never the first one's.
    if (!conn && byId && new Set(topology.filter((r) => r.id === id).map((r) => r.conn ?? this.primary.id)).size > 1) { notify({ title: "Rig space", body: "That rig is on more than one OpenRig. Open it from its row in the sidebar, which names the machine. Nothing was opened.", level: "warning" }); return; }
    const rig = byId ?? named[0];
    const feed = rig ? this.exactFeed(rig.conn) : null; // the rig's OWN connection, never the first in place of a removed one
    if (rig && !feed) { notify({ title: "Rig space", body: UNKNOWN_CONNECTION, level: "warning" }); return; }
    // A real error passes through unchanged: the rig's own feed's, or (no rig found yet) the sidebar's own, as before; the retry line only when nothing failed.
    const failure = rig ? feed.error : this.error;
    if (!rig || failure) { notify({ title: "Rig space", body: failure ? String(failure) : "OpenRig hasn't loaded this rig yet. Try again in a moment.", level: "warning" }); return; }
    const config = feed.config, current = () => this.stillCurrent(feed, config);
    if (activeInPlaceOpen({ spaces, panes, shared }, config, rig.id)) {
      notify({ title: `${rig.name} space`, body: inPlaceSpaceRefusal(rig.name), level: "warning" });
      return;
    }
    const statusKey = this.statusKey(rig);
    // Already building: a repeat click keeps the line and is a true no-op (no second open, no selection write).
    if ((this.opening ??= new Set()).has(statusKey)) return;
    this.setViewState("rig.sel", { key: rigKey(rig.id), entry: { section: "topology", kind: "rig", rigId: rig.id, conn: rig.conn, name: rig.name }, at: Date.now() });
    const attempt = {
      rig, feed, config, statusKey, rigKey: statusKey,
      step: null, defaultStep: "checking existing space",
      inflight: 0, lastBeat: Date.now(), settled: false,
      onStepChange: (words) => {
        (this.gridSteps ??= new Map()).set(statusKey, { rig, step: words, rebuilding: false });
        this.publishSpaceOpening();
        cx.notify();
      },
    };
    (this.openingAttempts ??= new Map()).set(statusKey, attempt);
    // A box grid takes 10-20 s to build: say so on the list until it is verified, so the click doesn't feel dead.
    this.opening.add(statusKey);
    (this.openingNames ??= new Map()).set(statusKey, rig.name);
    this.publishSpaceOpening();
    cx.notify();
    cx.spawn(async (cx) => {
      let result, alreadySettled = false;
      try {
        result = await this.routeOpen(this.routeHost(cx, consent, feed, attempt), config, { kind: "grid", rigId: rig.id, conn: rig.conn, options: { rebuild, relocation } });
      } catch (error) {
        const step = this.gridSteps?.get(statusKey)?.step ?? attempt.step ?? attempt.defaultStep;
        const msg = errorDiagnostic(error);
        result = { ok: false, retryable: true, preparationFailed: true, reason: msg.includes(step) ? msg : `Couldn't open ${rig.name} while ${step}: ${msg}` };
      } finally {
        alreadySettled = attempt.settled;
        attempt.settled = true;
        this.opening.delete(statusKey);
        this.openingNames?.delete(statusKey);
        if (this.openingAttempts?.get(statusKey) === attempt) this.openingAttempts.delete(statusKey);
        if (!this.gridSteps?.get(statusKey)?.rebuilding) this.gridSteps?.delete(statusKey);
        this.publishSpaceOpening();
      }
      if (alreadySettled) {
        if (result?.ok && current()) {
          const prevStatus = shared("rig.spaceStatus") ?? {};
          if (!prevStatus[statusKey] || prevStatus[statusKey]?.interrupted) {
            this.publishSpaceStatus(statusKey, result, prevStatus);
          }
          if (this.machineNotices && config?.daemonMachine && !result.closed) this.machineNotices.delete(config.daemonMachine);
          if (continueWorker) await this.hostWorkerAction(cx, continueWorker.id, continueWorker.target, continueWorker.action);
          cx.notify();
        }
        return;
      }
      // A late answer for a connection removed or edited during the build writes no card, asks nothing and continues no worker view (as Close all does).
      if (!current()) { notify({ title: `${rig.name} space`, body: CONNECTION_CHANGED_DURING, level: "warning" }); cx.notify(); return; }
      this.publishSpaceStatus(statusKey, result);
      if (result.needsRelocation) this.reviewGridMove(rig,result.relocation,rebuild,continueWorker);
      else if (result.needsConsent) {
        const activeSp = spaces().find((s) => s?.active);
        const viewPane = activeSp ? panes().find((p) => p.mod === MOD_IDS.view && activeSp.tabs?.some((tb) => tb.id === p.tab && !tb.settled)) : null;
        if (viewPane) {
          const rigEntry = this.entryOf({ section: "topology", kind: "rig", rigId: rig.id, conn: rig.conn, name: rig.name });
          setShared("rig.nav", navPush(shared("rig.nav"), rigEntry));
          pushTabPage({ shared, setShared, panes }, viewPane.tab, rigEntry, { spaceConn: machineSpaceConn(this.config, activeSp) });
          if (commands().some((c) => c.name === "tab.select")) run("tab.select", { id: viewPane.tab });
        }
        this.reviewMachine(result, (cx, approval) => this.openRigSpace(cx, id, rebuild, approval,relocation,continueWorker,conn), feed, rig.name);
      }
      else if (result.relocated)this.gridMoveResult={...result,name:rig.name,rigId:rig.id,conn:rig.conn,machine:config.daemonMachine,
        changedRows:(result.changed??[]).map(session=>({name:this.gridSeatName(rig,session),reason:result.changedReasons?.[session]??"it changed"})),
        failed:(result.failed??[]).map(session=>this.gridSeatName(rig,session))};
      else if (result.recovery) this.reviewRigRebuild(rig, {...result,worker:continueWorker});
      else this.notifyResult(`${rig.name} space`, result, true, { machine: config.daemonMachine });
      if(result.ok&&continueWorker)await this.hostWorkerAction(cx,continueWorker.id,continueWorker.target,continueWorker.action);
      cx.notify();
    });
  }

  /** What the list says while a rig's grid builds (the machine as Herdr names it, plus the live step once preparation or tile work starts). */
  openingLine(rig, explicitStep = null, rebuilding = false) {
    const machine = this.feedOf(rig?.conn).config?.daemonMachine;
    const key = rig?.id ? this.statusKey(rig) : null;
    const step = explicitStep ?? (key ? (this.gridSteps?.get(key)?.step ?? this.openingAttempts?.get(key)?.step ?? null) : null);
    const base = rebuilding
      ? (machine ? `Rebuilding ${rig.name} on ${machine}` : `Rebuilding ${rig.name}`)
      : (machine ? `Opening ${rig.name} on ${machine}` : `Opening ${rig.name}`);
    return step ? `${base} · ${step}…` : `${base}…`;
  }

  /** A result as a toast. A machine notice (a Herdr machine that lost its connection, an OpenRig not answering there) is shown once per machine
   *  for the BACKGROUND space sync; an action the person took (Attach, an open, a worker view) always shows its failure, the notice included.
   *  A success clears the notice of the result's own machine (`machine`: its connection's), not the first connection's. */
  notifyResult(title, result, changed = true, { background = false, machine = null } = {}) {
    if (result?.notified) return; // already said where it happened (an Attach's give-up toasts from its own timer)
    this.machineNotices ??= new Map();
    if (result.ok && !result.closed && !result.skipped && !result.inPlace && machine) this.machineNotices.delete(machine);
    if (result.inPlace && (result.note || result.reason)) {
      notify({ title, body: result.note ?? result.reason, level: "warning", where: machine??"OpenRig's machine" });
    } else if (result.machineNotice) {
      const { machine: noticeMachine, body } = result.machineNotice;
      const shown = this.machineNotices.has(noticeMachine);
      if (!shown) this.machineNotices.set(noticeMachine, body);
      if (!shown || !background) notify({ title: noticeMachine, body, level: "warning" });
    } else if (changed && (!result.ok || result.empty)) {
      notify({ title, body: result.reason ?? "No running seats in this rig.", level: "warning", where: machine??"OpenRig's machine" });
    }
  }

  relocationHintScope(feed) {
    return JSON.stringify([feed.id, gateGeneration(feed.config?.connectionId ?? feed.id), feed.config, feed.healthz?.selfHostId ?? null]);
  }

  /** Read-only display hints, rebuilt each sweep. These lists and answers never enter a grid/migration controller. */
  prepareRelocationHints(preflight = null) {
    const hints = new Map(), captured = {}, readers = { spaces, terminals, panes };
    const read = key => {
      if (!Object.hasOwn(captured, key)) captured[key] = readers[key]?.() ?? [];
      return captured[key];
    };
    const host = preflight ?? { spaces: () => read("spaces"), terminals: () => read("terminals"), panes: () => read("panes") };
    for (const feed of this.feeds) {
      if (feed.closed || feed.error || !feed.data || feed.config?.configInvalid) continue;
      const hint = { scope: this.relocationHintScope(feed), topology: feed.data.topology, bySource: new Map() };
      try {
        if (feed.config?.daemonMachine) for (const rig of feed.data.topology ?? []) {
          const source = rigSpaceRelocation(host, rig, feed.config)?.source;
          if (source && !hint.bySource.has(source)) hint.bySource.set(source, rig.id);
        }
      } catch (error) {
        hint.bySource.clear();
        hint.error = `Couldn't check existing Local rig spaces. ${errorDiagnostic(error)}`;
      }
      hints.set(feed.id, hint);
    }
    this.relocationHints = hints; // replacing the map retires removed feeds, rigs and old host snapshots
  }

  relocationHintFor(feed) {
    const hint = this.relocationHints?.get(feed.id);
    return hint && !feed.error && hint.topology === feed.data?.topology && hint.scope === this.relocationHintScope(feed) ? hint : null;
  }

  relocationRigHere() {
    const context = this.activeSpaceContext;
    // A relocation source is Local. A currently shown remote space cannot be that source, even with the same display name.
    if (!context?.id || spaceMachine(context.space) !== null) return null;
    const feed = this.viewFeed ?? this.primary;
    const rigId = this.relocationHintFor(feed)?.bySource.get(context.id);
    return rigId ? feed.data?.topology?.find(rig => rig.id === rigId) ?? null : null;
  }

  /** Capture once per change check; derived machine contexts survive only identical host bytes and routing state. */
  spaceSyncPreflight() {
    const lists={spaces:spaces?.()??[],terminals:terminals?.()??[],panes:panes?.()??[]};
    const state=shared("rig.spaceState")??{};
    // sampledAt is only the daemon's polling clock. No mod reads it; state, evidence and eventAt remain inputs.
    const topology=rows=>rows?.map(rig=>!rig.pods?rig:{...rig,pods:rig.pods.map(pod=>!pod.seats?pod:{...pod,seats:pod.seats.map(seat=>{
      if(!seat.agentActivity)return seat;
      const {sampledAt,...activity}=seat.agentActivity;return {...seat,agentActivity:activity};
    })})});
    const scope=this.feeds.map(feed=>[feed.id,gateGeneration(feed.config?.connectionId),feed.config,feed.error,feed.healthz?.selfHostId,topology(feed.data?.topology)]);
    const key=JSON.stringify([lists,state,scope,machines?.()??[]]);
    if(this.spacePreflightCache?.key!==key)this.spacePreflightCache={key,read:spaceContextSnapshot(lists,state)};
    return {key,spaces:()=>lists.spaces,terminals:()=>lists.terminals,panes:()=>lists.panes,routeState:()=>state,
      spaceContextSnapshot:this.spacePreflightCache.read};
  }

  syncRigSpaces(cx) {
    if (this.spaceSyncing && Date.now() - (this.spaceSyncingAt ?? 0) < SYNC_STALE_MS) { this.spaceAgain = true; return; }
    const sweep = {}; // only the latest sweep ends the turn: an older one that outlived SYNC_STALE_MS finishes without clearing it
    this.spaceSyncing = true; this.spaceSyncingAt = Date.now(); this.spaceSweep = sweep;
    cx.spawn(async (cx) => {
      const displayKey=()=>JSON.stringify([this.spaceSyncError??null,[...(this.relocationHints??[])].map(([id,hint])=>[id,hint.scope,hint.error??null,[...hint.bySource]])]);
      const beforeDisplay=displayKey();
      try {
        let preflight;
        try{preflight=this.spaceSyncPreflight();this.spaceSyncError=null;}
        catch(error){this.spaceSyncError=`Couldn't check existing rig spaces. ${errorDiagnostic(error)}`;this.completedSpaceSweep=null;return;}
        // Approval may be written by Attach or another view, without changing any structural input.
        // This only invalidates a read-only observation; the controller still re-reads authority before acting.
        const cards=shared("rig.spaceStatus")??{},waiting=[];
        for(const feed of this.feeds){
          if(feed.closed||feed.error||!feed.data||feed.config?.configInvalid)continue;
          for(const rig of feed.data.topology??[]){
            const result=cards[this.statusKey(rig)];
            if(result?.confirmation?.key&&this.isWaitingConsent(result,feed.config))waiting.push({connectionId:feed.config?.connectionId??LEGACY_CONNECTION_ID,key:result.confirmation.key});
          }
        }
        if(waiting.length){
          const text=await readTextFile?.(`${appHome?.()}/openrig/machine-consent.json`).catch(()=>null);
          if(waiting.some(({connectionId,key})=>consentOf(text,connectionId)?.key===key)){this.completedSpaceSweep=null;this.spaceSweepRetry=null;}
        }
        if(this.spaceSweepRetry?.key===preflight.key&&Date.now()<this.spaceSweepRetry.nextAt)return;
        const recorded=this.completedSpaceSweep===preflight.key;
        if(recorded&&this.feeds.every(feed=>feed.closed||feed.error||!feed.data||feed.config?.configInvalid||this.relocationHints?.has(feed.id))&&(this.completedSpaceRefusals??[]).every(({key,result})=>sameValue(cards?.[key],result))){
          // Equivalent fresh feed arrays still refer to the same proven display inputs; never retain a prior identity after an actual change.
          for(const feed of this.feeds){const hint=this.relocationHints?.get(feed.id);if(hint)hint.topology=feed.data?.topology;}
          return;
        }
        const sweepKey=preflight.key;
        let successful=true;const refusals=[];
        this.prepareRelocationHints(preflight);
        // Keep the owner with each snapshot row: removal can happen during the previous rig's await, and feedOf
        // deliberately falls back to the primary. A removed box must not become an attempted open on that primary.
        const work = this.feeds.flatMap(feed => (feed.data && !feed.error ? feed.data.topology ?? [] : [])
          .map(rig => ({ feed, config: feed.config, rig })));
        for (const [n, { feed, config, rig }] of work.entries()) {
          if (n) await new Promise(resolve=>cx.timer.after(0,()=>resolve(),{owner:null})); // only resolves: survives whichever view drains the preceding await
          const current = () => this.stillCurrent(feed, config);
          if (!current() || feed.error) continue;
          if (rig.nodesUnavailable) continue;
          if (activeInPlaceOpen({ spaces:preflight.spaces, panes:preflight.panes, shared }, config, rig.id)) continue;
          const statusKey = this.statusKey(rig);
          const prevStatus = (shared("rig.spaceStatus") ?? {})[statusKey];
          if (prevStatus?.confirmation?.key && this.isWaitingConsent(prevStatus, config)) {
            const stored = consentOf(
              await readTextFile?.(`${appHome?.()}/openrig/machine-consent.json`).catch(() => null),
              config?.connectionId ?? LEGACY_CONNECTION_ID,
            );
            if (stored?.key !== prevStatus.confirmation.key) continue;
          }
          const bgAttempt = {
            rig, feed, config, statusKey, rigKey: statusKey,
            step: null, defaultStep: "checking existing space",
            inflight: 0, lastBeat: Date.now(), settled: false, background: true,
            onRebuildStart: () => {
              (this.gridSteps ??= new Map()).set(statusKey, { rig, step: bgAttempt.step ?? "checking existing grid", rebuilding: true });
              this.publishSpaceOpening();
              cx.notify();
            },
            onStepChange: (words, rebuilding) => {
              const prev = this.gridSteps?.get(statusKey);
              if (rebuilding || prev?.rebuilding || this.opening?.has(statusKey)) {
                (this.gridSteps ??= new Map()).set(statusKey, { rig, step: words, rebuilding: Boolean(rebuilding || prev?.rebuilding) });
                this.publishSpaceOpening();
                cx.notify();
              }
            },
          };
          this.activeBgSync = bgAttempt;
          let result;
          try {
            const liveHost=this.routeHost(cx, null, feed, bgAttempt);
            const readHost={...liveHost,...preflight,syncGrid:async(...args)=>{
              // A positive preflight only forwards to the original controller, whose authority reads remain fresh.
              try{return await liveHost.syncGrid(...args);}finally{preflight=this.spaceSyncPreflight();}
            }};
            result = await routeRigOpen(readHost, config, { kind: "grid", rigId: rig.id, conn: rig.conn, background: true });
          } finally {
            bgAttempt.settled = true;
            if (this.activeBgSync === bgAttempt) this.activeBgSync = null;
            this.gridSteps?.delete(statusKey);
            this.publishSpaceOpening();
          }
          if (!current()) continue; // a late result cannot publish a card or toast for a removed or edited connection
          // Only known observation shapes are stable. Plain ok:false may be a transient Herdr exception.
          const stable=!result.error&&!result.machineNotice&&!result.preparationFailed&&(result.ok===true||result.needsConsent===true||result.unconfirmedSpace===true||result.needsRelocation===true||Boolean(result.recovery)||(Array.isArray(result.stale)&&result.stale.length>0));
          if(!stable)successful=false;
          else if(!result.ok||result.needsConsent)refusals.push({key:statusKey,result});
          const statuses = shared("rig.spaceStatus") ?? {};
          // A background skip means "nothing to update here". It must not wipe the card of a failed explicit open.
          if ((result.skipped || result.closed) && statuses[statusKey] && !statuses[statusKey].ok && !statuses[statusKey].skipped) continue;
          this.notifyResult(`${rig.name} space`, result, statuses[statusKey]?.reason !== result.reason, { background: true, machine: config?.daemonMachine });
          this.publishSpaceStatus(statusKey, result, statuses);
        }
        if(successful){this.completedSpaceSweep=sweepKey;this.completedSpaceRefusals=refusals;this.spaceSweepRetry=null;}
        else {this.completedSpaceSweep=null;const delay=this.spaceSweepRetry?.key===sweepKey?Math.min(this.spaceSweepRetry.delay*2,60000):5000;this.spaceSweepRetry={key:sweepKey,delay,nextAt:Date.now()+delay};}
      } finally {
        if (this.spaceSweep === sweep) {
          this.spaceSyncing = false;
          if (this.spaceAgain) { this.spaceAgain = false; if (!this.error) this.syncRigSpaces(cx); }
        }
        if(displayKey()!==beforeDisplay)cx.notify();
      }
    });
  }

  closeRigTiles(cx, rig) {
    const feed = this.feeds.find(f => f.id === rig?.conn) ?? (!rig?.conn && this.feeds.length === 1 ? this.primary : null);
    if (!feed) return;
    const config = feed.config;
    const current = () => this.stillCurrent(feed, config);
    cx.spawn(async (cx) => {
      if (!current()) return;
      const result = await this.spaceController(cx, null, feed).sync(rig, config, { explicit: true, closeAll: true });
      if (!current()) return;
      this.publishSpaceStatus(this.statusKey(rig), result);
      this.notifyResult(`${rig.name} space`, result, true, { machine: config.daemonMachine });
      cx.notify();
    });
  }

  /** Confirmed cleanup belongs to this sidebar, never to the disposable confirmation/result dialog. */
  closeOldViewsRequests(cx){
    const queued=shared('rig.oldViewsClose')??{};
    setShared('rig.oldViewsClose',{}); // consume synchronously before starting any task; a second command cannot repeat it
    this.cleanupSession??=`cleanup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    for(const [id,request]of Object.entries(queued))cx.spawn(async()=>{
      if(this.closed){
        const text='The Rig sidebar closed before cleanup started. Nothing was closed.';
        setShared('rig.status',{id,busy:false,ok:false,text,at:Date.now()});notify({title:'Old worker views',body:text,level:'warning'});return;
      }
      const title='Closing old views';
      // cx is the sidebar command-loop context. The ownerless job has no view to notify.
      const publish=result=>{
        setShared('rig.oldViewsCloseResult',{id,session:this.cleanupSession,expiresAt:Date.now()+120000,...result});
        setShared('rig.status',{id,busy:false,...result,at:Date.now()});notify({title:'Old worker views',body:result.text,level:result.ok?'info':'warning'});cx.notify();
        cx.timer?.after?.(120000,next=>{if(!this.closed&&shared('rig.oldViewsCloseResult')?.id===id){setShared('rig.oldViewsCloseResult',null);cx.notify();}},{owner:null});
      };
      if(!Number.isFinite(request?.createdAt)||Date.now()-request.createdAt>120000||request.createdAt>Date.now()+1000){publish({ok:false,text:'This cleanup confirmation expired. Nothing was started. Check the old views, then confirm again.'});return;}
      if(this.oldViewsClosing){
        if(this.oldViewsClosing.deadline<=Date.now()){
          const old=this.oldViewsClosing;old.expired=true;this.oldViewsClosing=null;this.inFlightActions?.delete(old.id);
          publish({ok:false,text:'The earlier close was not confirmed. Check the old views before confirming again. This confirmation was not started.'});
        }else publish({ok:false,text:'Old views are already being closed. Check the result in System.'});
        return;
      }
      const ticket={id,deadline:Date.now()+300000};this.oldViewsClosing=ticket;
      (this.inFlightActions??=new Map()).set(id,{title,clearBusy:()=>{},rig:null,rigId:null,conn:null});
      setShared('rig.oldViewsCloseResult',{id,session:this.cleanupSession,expiresAt:ticket.deadline,busy:true,text:'Closing old views…'});cx.notify();
      const deadline=cx.timer?.after?.(300000,()=>{
        if(this.closed||this.oldViewsClosing!==ticket)return;
        ticket.expired=true;this.oldViewsClosing=null;this.inFlightActions?.delete(id);
        publish({ok:false,text:'The close was not confirmed in time. Some views may have closed. Check before confirming again.'});
      },{owner:null});
      try{
        const reviewed=request?.config;
        const fresh=async()=>{
          if(this.closed||ticket.expired||Date.now()>=ticket.deadline)throw Error('The close was not confirmed in time. Check before confirming again.');
          const current=await configReads(async()=>parseConfig(await readTextFile(`${appHome()}/openrig/config.json`)));
          if(this.closed||ticket.expired||Date.now()>=ticket.deadline)throw Error('The close was not confirmed in time. Check before confirming again.');
          if(!reviewed||current.configInvalid||!gateSameConfig(reviewed,current)||(reviewed.person??null)!==(current.person??null)||JSON.stringify(reviewed.rig??null)!==JSON.stringify(current.rig??null))throw Error('OpenRig settings changed. Reopen this confirmation. Nothing was sent.');
          return current;
        };
        await fresh();
        const result=await closeOldViews({layout,layouts,readTextFile,currentConfig:fresh,execFor},reviewed,request.views??[],appHome(),conn=>connectionCapabilities(shared,reviewed,conn,terminals()));
        if(!this.closed&&!ticket.expired)publish(result);
      }catch(error){if(!this.closed&&!ticket.expired)publish({ok:false,text:String(error?.message??error)});}
      finally{deadline?.cancel?.();if(this.oldViewsClosing===ticket)this.oldViewsClosing=null;this.inFlightActions?.delete(id);}
    },{owner:null});
  }
  oldViewsCloseResult(){
    const result=shared('rig.oldViewsCloseResult');
    return result&&this.cleanupSession&&result.session===this.cleanupSession&&result.expiresAt>Date.now()?result:null;
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
        const invalidKey = oneClickBusyKey(target, action ?? "", actionKey);
        const cur = shared("rig.busyAction");
        if (cur === invalidKey || (action && cur === qualifyBusyKey(target?.conn, action))) setShared("rig.busyAction", null);
        continue;
      }
      cx.spawn(async (cx) => this.oneClick(cx, id, target, action, actionKey));
    }
  }

  async oneClick(cx, id, target, action, actionKey = null) {
    const busyKey = oneClickBusyKey(target, action, actionKey);
    const clearBusy = () => {
      const cur = shared("rig.busyAction");
      if (cur === busyKey || cur === qualifyBusyKey(target?.conn, action)) {
        setShared("rig.busyAction", null);
      }
    };
    // The rows this click came from were read under the settings their producer stamped; this sidebar acts under its own. A different identity refuses (the rows are from another address).
    if (target?.rowsConfig && this.config) {
      // Judged against the ROW'S OWN connection (a row of B against the config's own connection A would never match), as the menu does; a connection no longer listed refuses too.
      const now = configOfConnection(this.config, target.rowsConfig.connectionId);
      if (!now || !gateSameConfig(target.rowsConfig, now)) { clearBusy(); setShared("rig.status", { id, busy: false, ok: false, text: now ? ROWS_STALE : UNKNOWN_CONNECTION, at: Date.now() }); cx.notify(); return; }
    }
    const assistantReason=assistantActionRefusal(target,action);
    if(assistantReason){clearBusy();setShared('rig.status',{id,busy:false,ok:false,text:assistantReason,at:Date.now()});cx.notify();return;}
    if(target?.kind==='assistant'&&action==='queue'){
      // All assistant sends use the composer, including a stale one-click/palette target.
      // It obtains text and re-observes settings after roster verification before dispatch.
      clearBusy();
      const conn=targetConnection(this.config,target);
      if(!conn.ok){setShared('rig.status',{id,busy:false,ok:false,text:conn.reason,at:Date.now()});cx.notify();return;}
      this.open({mod:MOD_IDS.menu,kind:'dialog',modal:true,width:460,height:300,props:{target,step:{action:'queue',input:true,multiLine:true,placeholder:'One-line summary; the body follows on the next lines'}}});
      cx.notify();return;
    }
    const workerCaps=connectionCapabilities(shared,this.config,target?.conn??null,terminals())??{},hostActions=["open-view","follow","unfollow","prune","open-seat"];
    if(hostActions.includes(action)){
      const acting=targetConnection(this.config,{...target,conn:adoptConnection(this.config,target?.conn)});
      if(!acting.ok||!this.exactFeed(acting.config.connectionId??LEGACY_CONNECTION_ID)){
        setShared("rig.busyAction",null);setShared("rig.status",{id,busy:false,ok:false,text:acting.ok?UNKNOWN_CONNECTION:acting.reason,at:Date.now()});cx.notify();return;
      }
      clearBusy();
      if(action==="open-seat")return this.focusWorkerSeat(cx,target);
      const feed=this.ownFeed(acting.config.connectionId),caps=feed===this.primary?workerCaps:(feed?.data?.capabilities??{});
      if(caps.hostWorkerViews)return this.hostWorkerAction(cx,id,target,action);
      const view=target.view??(target.rig?`rig:${target.rig}`:null);
      if(action==="open-view"&&view?.startsWith("rig:")){
        const rig=(feed?.data?.topology??[]).find(r=>r.id===target.rigId||r.name===target.rig||r.name===view.slice(4));
        if (rig) {
          const conn=acting.config.connectionId;
          return this.openRigSpace(cx, rig.id, null, null, null, null, conn);
        }
      }
      const reason="Saved views and Follow need an OpenRig that can plan worker views.";
      setShared("rig.status",{id,busy:false,ok:false,text:reason,at:Date.now()});cx.notify();return {ok:false,reason};
    }
    const title = actionTitle(target, action);
    const actingCaps=connectionCapabilities(shared,this.config,target?.conn??null,terminals?.()??[]);
    const reason = actingCaps ? capabilityDisableReason(action, actingCaps) : null;
    if (reason) {
      clearBusy();
      setShared("rig.status", { id, busy: false, ok: false, text: `${title}: ${reason}`, at: Date.now() });
      notify({ title, body: reason, level: "warn" });
      cx.notify();
      return;
    }
    setShared("rig.busyAction", busyKey);
    setShared("rig.status", { id, busy: true, ok: null, text: `${title}…`, at: Date.now() });
    const ranFor = target?.rig ?? (typeof target?.view === "string" && target.view.startsWith("rig:") ? target.view.slice(4) : null);
    (this.inFlightActions ??= new Map()).set(id, { title, clearBusy, rig: ranFor, rigId: target?.rigId ?? null, conn: target?.conn ?? null }); // close() settles it
    let r;
    try {
      const config = this.config ?? parseConfig(await readTextFile(`${appHome()}/openrig/config.json`));
      // The connection is the target's own (stamped where its row came from), never a default: without one nothing is sent.
      const conn = targetConnection(config, target);
      const args = conn.ok ? actionArgs(target, action, "", appHome()) : null;
      const cmd = args && !appHomeArgsRefusal(conn.config, args) ? writeCommand(conn.config, args) : null;
      r = !conn.ok ? { ok: false, text: conn.reason } : args && appHomeArgsRefusal(conn.config, args) ? { ok: false, text: appHomeArgsRefusal(conn.config, args) }
        : cmd ? writeOutcome(await execFor(conn.config)(cmd.command, cmd.args, { timeout: 180000 }))
        : { ok: false, text: args ? NO_PERSON : ACTION_REFUSED };
    } catch (e) {
      const unsent = isKnownUnsentError(e);
      const line = unsent ? unsentErrorMessage(e).trimEnd() : plainExecError(e, { kind: "write" });
      r = { ok: false, ...(unsent ? { notSent: true } : {}), text: unsent && !/nothing was sent/i.test(line) ? `${line} Nothing was sent.` : line };
    }
    if (r.ok && action === "unarchive-rig") run("rig.refresh");
    const words = r.ok ? (action === "unarchive-rig" ? `${target.rig} restored. It's stopped; Resume it from its row.` : r.text || doneWords(target, action)) : (r.text || "It didn't work, and the CLI gave no reason.");
    const statusRig = target?.rig ?? (typeof target?.view === "string" && target.view.startsWith("rig:") ? target.view.slice(4) : null);
    const canResume = !r.ok
      && (action === "open-view" || action === "open-seat" || action === "follow")
      && Boolean(statusRig)
      && /no running|no attachable|stopped|recoverable|exited/i.test(words);
    this.inFlightActions?.delete(id);
    clearBusy();
    setShared("rig.status", {
      id,
      busy: false,
      ok: r.ok,
      text: r.ok ? words : `${title}: ${words}`,
      at: Date.now(),
      rig: statusRig,
      rigId: target?.rigId ?? null,
      conn: target?.conn ?? null,
      canResume,
    });
    if (r.ok && action === "unarchive-rig") notify({ title: `${target.rig} restored`, body: "It's stopped; Resume it from its row.", level: "success" });
    else if (r.ok) notify({ title, body: r.warning ? `${words} ${r.warning}` : words, level: "success" });
    else notify({ title, body: words, level: "warning" });
    cx.notify();
  }

  workerController(cx,consent=null){
    if(!this.workerHostCx)throw new Error("Worker views are still starting. Try again in a moment.");
    cx=this.workerHostCx;
    if(!this.workerViews){
      // Each sync is its own connection's: its live settings, its send scope, its daemon (the first connection's settings never judge another's work).
      this.workerViews=new HostWorkerViews({spaces,panes,terminals,hcFor,runFor,execFor,currentConfig:config=>config?configOfConnection(this.config,config.connectionId):this.config,
        routeState:()=>shared("rig.spaceState"),loadViews:()=>shared("rig.spaceState")?.workerViews??{},
        saveViews:views=>this.saveSpaceState({workerViews:views}),changed:views=>{setShared("rig.workerViews",views);cx.notify();},
        preview:(config,view)=>this.workerPreview(config,view), probeHealth: this.healthProbe(cx),
        nodes:async (config,rigId=null)=>{if(rigId)return this.workerRead(config,`/api/rigs/${encodeURIComponent(rigId)}/nodes`); // the view's own rig only
          const rigs=await this.workerRead(config,"/api/rigs/summary");
          return (await Promise.all(rigs.filter(r=>!r.archivedAt).map(r=>this.workerRead(config,`/api/rigs/${encodeURIComponent(r.id)}/nodes`)))).flat();},
      });
    }
    this.workerViews.host.prepareRemote=(config,opts)=>{ // the box helper of the synced connection's own machine, with its own consent
      const feed=this.ownFeed(config?.connectionId);
      if(feed&&!config.daemonMachine)return this.prepareLocalWorkers(config);
      return feed?this.attachHost(cx,consent,feed).prepareRemote(config,opts):Promise.resolve({ok:false,reason:UNKNOWN_CONNECTION});
    };
    this.workerViews.host.prepareHome=config=>{
      const feed=this.ownFeed(config?.connectionId);
      return feed?this.attachHost(cx,consent,feed).prepareHome(config):Promise.resolve({ok:false,reason:UNKNOWN_CONNECTION});
    };
    this.workerViews.host.openOverlay=spec=>this.open(spec);
    this.workerViews.host.closeOverlay=closeOverlay;
    this.workerViews.host.shared=shared;this.workerViews.host.setShared=setShared;
    // Controller continuations can resume under another view. Pure waits and
    // deferred dispatch must not borrow that view's lifetime.
    this.workerViews.host.wait=ms=>new Promise(resolve=>cx.timer.after(ms,resolve,{owner:null}));
    this.workerViews.host.deadline=ms=>new Promise(resolve=>cx.timer.after(ms,resolve,{owner:null})); // the read and Herdr-call limits
    this.workerViews.host.after=(ms,fn)=>cx.timer.after(ms,next=>next.spawn(async()=>{try{await fn();}catch(error){notify({title:"Worker view",body:errorDiagnostic(error),level:"warning"});}},{owner:null}),{owner:null});
    return this.workerViews;
  }
  async prepareLocalWorkers(config){
    const [health,node]=await Promise.all([this.workerRead(config,"/healthz"),execFor(config)("node",["-p","process.execPath"])]);
    const executable=String(node?.stdout??"").trim(),relayPath=attachRelayPath(appHome(),MOD_IDS.sidebar);
    if(node?.code!==0||!goodHome(executable)||!goodHome(relayPath)||!health?.selfHostId)
      return {ok:false,reason:"Couldn't verify this computer's worker viewer. Nothing was opened."};
    return {ok:true,local:true,node:executable,relayPath,selfHostId:health.selfHostId};
  }
  async workerPreview(config,view){
    const preview=await this.workerRead(config,`/api/terminal/preview?provider=herdr-app&view=${encodeURIComponent(view)}&viewportColumns=160`);
    if(!view.startsWith("saved:"))return preview;
    const views=await this.workerRead(config,"/api/terminal/views"),members=views.saved?.find(v=>v.id===view.slice(6))?.members??[];
    const names=new Map(members.map(m=>[m.seat,m.label]));
    return {...preview,composed:{...preview.composed,absent:preview.composed?.absent?.map(item=>({...item,label:names.get(item.seat)??item.label??item.seat}))}};
  }
  async workerRead(config,path){
    const response=await fetchFor(config)(config.daemonUrl+path); // this connection's own scope
    if(!response.ok)throw new Error(`Couldn't read the worker view (${response.status}). Tiles kept.`);
    return response.json();
  }
  /** The connection a worker view acts for: the target's own (stamped where its row came from). With one OpenRig an unstamped target keeps today's
   *  behaviour; with several, an unstamped or removed one refuses, never falling back to the first connection. The feed is that connection's own. */
  workerConnection(target){
    if((this.config?.connections??[]).length<=1&&!target?.conn)return {ok:true,config:this.config,feed:this.primary};
    const conn=targetConnection(this.config,target);
    if(!conn.ok)return conn;
    const feed=this.ownFeed(conn.config.connectionId);
    return feed?{ok:true,config:conn.config,feed}:{ok:false,reason:UNKNOWN_CONNECTION};
  }
  /** The feed of exactly this connection id, or null: unlike feedOf, never the first connection in place of a missing one. */
  ownFeed(id) {
    if (!this.primary || this.primary.config?.configInvalid) return null;
    if (id === undefined || id === null || id === "") return (this.primary.config?.connections ?? []).length <= 1 && this.feeds.length <= 1 ? this.primary : null;
    const firstId = this.primary.config ? (this.primary.config.connectionId ?? LEGACY_CONNECTION_ID) : this.primary.id;
    if (firstId && id === firstId) return this.primary;
    const conns = this.primary.config?.connections;
    if (Array.isArray(conns) && conns.length > 0 && !conns.some((c) => c.id === id)) return null;
    return this.feeds.slice(1).find((f) => f.id === id) ?? null;
  }
  async hostWorkerAction(cx,id,target,action,consent=null){
    const own=this.workerConnection(target);
    if(!own.ok){setShared("rig.status",{id,ok:false,busy:false,text:own.reason,at:Date.now()});cx.notify();return {ok:false,reason:own.reason};}
    const config=own.config;
    const view=target.view??target.target??(target.rig?`rig:${target.rig}`:null),controller=this.workerController(cx,consent);
    const progress={token:`${id}:${Date.now()}:${Math.random()}`,view,daemonUrl:config.daemonUrl,machine:config.daemonMachine};
    setShared("rig.workerProgress",progress);cx.notify();
    try{
    // Palette routes carry the view descriptor, while row buttons also carry the rig. Resolve both against this connection's topology.
    const rigName=target.rig??(view?.startsWith("rig:")?view.slice(4):null);
    const rig=(own.feed.data?.topology??[]).find(r=>r.id===target.rigId||r.name===rigName);
    let result;
    if(action==="unfollow")result=await controller.stop(config,view);
    else result=await controller.sync(config,view,{explicit:true,target:rig?{id:rig.id,name:rig.name}:null,
      ...(target.plan?{expectedPlan:target.plan}:{}),...(action==="follow"?{following:true}:{}),
      ...(action==="prune"?{pruneMs:({"5m":300000,"10m":600000,"30m":1800000,"never":0})[target.prune]??0}:{}),
    });
    if(result.needsConsent)this.reviewMachine(result,(cx,approval)=>cx.spawn(cx=>this.hostWorkerAction(cx,id,target,action,approval)),own.feed); // the approval is the target connection's own, as every other route asks it
    else if(result.needsRelocation)this.reviewGridMove(rig,result.relocation,null,{id,target,action});
    else{
      // The same card as the grid's failures, so the way forward stays on screen (see listRows).
      if(result.unconfirmedSpace&&rig)this.publishSpaceStatus(this.statusKey(rig),result);
      const pages = result.pages?.length ?? 0;
      const words=result.ok?(result.reason??(pages ? `Worker view open here: ${counted(pages, "page")}.` : "Worker view open here, with no pages yet.")):result.reason;
      const canResume=!result.ok&&Boolean(rig)&&['open-view','follow'].includes(action)&&/no running|no attachable|stopped|recoverable|exited/i.test(words??'');
      setShared("rig.status",{id,ok:result.ok,busy:false,text:words,rig:rig?.name??null,rigId:rig?.id??null,conn:config.connectionId,canResume,at:Date.now()});
      this.notifyResult("Worker view",result,true,{machine:config.daemonMachine});
    }
    cx.notify();return result;
    }finally{
      if(shared("rig.workerProgress")?.token===progress.token)setShared("rig.workerProgress",null);
      cx.notify();
    }
  }

  async focusWorkerSeat(cx,target,consent=null){
    const own=this.workerConnection(target);
    if(!own.ok)return this.notifyResult("Show in worker view",own);
    const rig=(own.feed.data?.topology??[]).find(r=>r.id===target.rigId||r.name===target.rig);
    const seat=rig?.pods?.flatMap(p=>p.seats??[]).find(s=>s.session===target.session||s.logicalId===target.logicalId);
    const session=target.session??seat?.session,config=own.config;
    const find=()=>{
      const ts=terminals(),ps=panes(),ss=spaces();
      for(const role of ["worker-view","attach"]){
        const tm=ts.find(t=>t.labels?.["herdr-openrig.role"]===role
          &&(role==="worker-view"?t.labels?.["herdr-openrig.seat"]:t.labels?.["herdr-openrig.attach"])===session
          &&rigOrigin(t.labels?.["herdr-openrig.origin"])===rigOrigin(config.daemonUrl)
          &&(config.daemonMachine?String(t.address).startsWith(config.daemonMachine+"/"):!String(t.address).includes("/")));
        const pane=tm&&ps.find(p=>p.terminal===tm.address),space=pane&&ss.find(s=>s.tabs?.some(t=>t.id===pane.tab));
        if(space)return{tm,pane,space};
      }
      return null;
    };
    const focus=hit=>{runFor(config)("space.select",{id:hit.space.id});runFor(config)("tab.select",{id:hit.pane.tab});runFor(config)("pane.focus",{terminal:hit.tm.address});return {ok:true};};
    const hit=find();if(hit)return focus(hit);
    if(!rig||!session)return this.notifyResult("Show in worker view",{ok:false,reason:"That seat is no longer listed. Nothing was opened."});
    const result=await this.routeOpen(this.routeHost(cx,consent,own.feed),config,{kind:"grid",rigId:rig.id,conn:config.connectionId});
    if(result.needsConsent){this.reviewMachine(result,(next,approval)=>next.spawn(next=>this.focusWorkerSeat(next,target,approval)),own.feed);return result;}
    const attached=result.ok&&find();if(attached)return focus(attached);
    return this.notifyResult("Show in worker view",{ok:false,reason:result.ok?`Seats opened, but ${target.logicalId??session}'s tile isn't there yet. Try again in a moment.`:result.reason??"Seats could not be opened."});
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
        const isCellColumn = rowChildren.some((k) => ["rig-cell-header", "herdrig-cell-header"].includes(k?.content?.mod) || k?.content?.terminal);
        if (isCellColumn) {
          const header = rowChildren.find((k) => ["rig-cell-header", "herdrig-cell-header"].includes(k?.content?.mod))?.content?.props ?? {};
          const viewer = rowChildren.find((k) => k?.content?.terminal)?.content?.terminal ?? header.terminal ?? null;
          const siblings = rows.filter((s) => s !== row && s?.id && !s.hidden).map((s) => s.id);
          allCells.push({ id: row.id, seat: header.seat ?? null, title: header.title ?? null, terminal: viewer, siblings });
        } else {
          for (const cellNode of rowChildren) {
            const kids = Array.isArray(cellNode?.children) ? cellNode.children : [];
            const header = kids.find((k) => ["rig-cell-header", "herdrig-cell-header"].includes(k?.content?.mod))?.content?.props ?? {};
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

  /** The OpenRig a focused worker cell belongs to: with several connections, the active space's own (follow mode's rule), else null, which
   *  the action then refuses plainly instead of aiming at the first connection. With one connection, that connection, as before. */
  cellConnection() {
    if (this.feeds.length <= 1) return this.config?.connectionId;
    const space = (spaces?.() ?? []).find((s) => s?.active) ?? null;
    const picked = followedConnection({ connections: this.config?.connections ?? [], space });
    return picked.why === "space" ? picked.id : null;
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
      conn: this.cellConnection(), // the OpenRig of the space the focused cell is in (never the first connection by default)
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

  async close() {
    this.closed = true;
    try { this.herdr?.release?.(); } catch (_) {} // this view's herdr:// transport registration ends with it
    releaseFocusTargets(this); // the follow hint's buttons
    // Herdr drops every continuation a gone view owns, so a write or a space build this copy started would never report. Say it now, while
    // it is still this copy's to say: the write may have finished, the build was cut short.
    for (const [id, a] of this.inFlightActions ?? []) {
      a.clearBusy();
      const text = `The Rig sidebar closed while ${a.title} ran; it may have finished. Check ${a.rig ?? "OpenRig"}.`;
      setShared("rig.status", { id, busy: false, ok: null, text, at: Date.now(), rig: a.rig, rigId: a.rigId, conn: a.conn });
      notify({ title: a.title, body: text, level: "warning" });
    }
    this.inFlightActions?.clear();
    for (const [key, name] of this.openingNames ?? []) {
      const reason = `The ${name} space build was cut short when the Rig sidebar closed; some tiles may have started. Open the space again.`;
      this.publishSpaceStatus(key, { ok: false, interrupted: true, reason });
      notify({ title: `${name} space`, body: reason, level: "warning" });
    }
    this.openingNames?.clear(); // close() is idempotent by consumption: both maps are cleared, so add nothing to them in here
    const hadInflightGrid = Boolean(this.openingAttempts?.size || this.activeBgSync || this.gridSteps?.size);
    for (const attempt of this.openingAttempts?.values() ?? []) {
      attempt.settled = true;
      attempt.interrupted = true;
      for (const release of [...(attempt.releases ?? [])]) release();
      clearInterruptedRouteJob(attempt.config, attempt.rig.name);
      this.rigSpacesBy?.get(attempt.feed?.id ?? "")?.clearPending(attempt.rig, attempt.config);
    }
    this.openingAttempts?.clear();
    this.opening?.clear();
    const bg = this.activeBgSync;
    if (bg) {
      bg.settled = true;
      bg.interrupted = true;
      this.activeBgSync = null;
      this.spaceSyncing = false;
      for (const release of [...(bg.releases ?? [])]) release();
      clearInterruptedRouteJob(bg.config, bg.rig.name);
      this.rigSpacesBy?.get(bg.feed?.id ?? "")?.clearPending(bg.rig, bg.config);
    }
    for (const release of [...(this.ownRouteReleases ?? [])]) release();
    this.ownRouteReleases?.clear();
    this.gridSteps?.clear();
    if (hadInflightGrid) this.publishSpaceOpening();
    this.cancelTreeReveal();
    for (const handle of this.listScrolls?.values() ?? []) handle?.release?.();
    this.listScrolls?.clear();
    this.workerViews?.dispose();
    this.statusMotion.close();
    const receivers={...(shared("rig.routeReceivers")??{})};delete receivers[this.routeReceiverId];setShared("rig.routeReceivers",receivers);
    try { this.sock?.close(); } catch (_) {}
  }

  dismissalModel(feed = this.viewFeed ?? this.primary) {
    const cfg = feed?.config;
    const origin = cfg?.daemonUrl;
    if (!origin) return null;
    const scope = dismissalScope(cfg);
    const key = cfg.connectionId || LEGACY_CONNECTION_ID;
    const models = (this.dismissalModels ??= new Map());
    let model = models.get(key);
    if (model?.scope !== scope) {
      const lookupCfg = this.primary.config?.connections && !cfg.connections ? { ...cfg, connections: this.primary.config.connections } : cfg;
      model = new DismissedUpdates(savedDismissalsFor(this.dismissalOrigins, lookupCfg));
      model.origin = origin;
      model.scope = scope;
      models.set(key, model);
    }
    if (feed === this.primary) this.dismissals = model;
    return model;
  }

  async saveDismissals(model = this.dismissals) {
    if (!model) return;
    this.dismissalOrigins = { ...this.dismissalOrigins, [model.scope]: model.saved() };
    const file = `${appHome()}/openrig/state.json`;
    // Compare-and-write preserves other views' state changes. A failed save prevents a remote commit.
    for (let i = 0; i < 3; i++) {
      const prev = await readTextFile(file).catch(() => null);
      let state = {}; try { state = JSON.parse(prev ?? "{}"); } catch (_) {}
      const next = { ...state, dismissedUpdates: { ...state.dismissedUpdates, ...this.dismissalOrigins } };
      try { await writeTextFile(file, JSON.stringify(next, null, 2) + "\n", prev); return; } catch (e) { if (i === 2) throw e; }
    }
  }

  /** Publishes every open connection's dismissal state, only when it changed. The dismiss loop calls this every second, and each publish makes
   *  herdr copy the value, write its whole shared file and re-render every mod: with several OpenRigs and hundreds of dismissed updates that
   *  was megabytes a second while nothing changed. The comparison reads each model's revision (new whenever one of its records changes, so
   *  hundreds of records are never re-read each second) and the receipts still inside their Undo window. */
  publishDismissals() {
    const byScope = {}, print = [];
    for (const feed of this.feeds) {
      if (feed.closed) continue;
      const m = this.dismissalModel(feed);
      if (!m) continue;
      const receipts = m.receiptRows();
      byScope[m.scope] = { ...m.saved(), receipts, origin: m.origin, scope: m.scope };
      print.push(m.scope, m.origin, m.show, receipts.map((r) => r.id).join(","), m.revision);
    }
    const primaryModel = this.dismissalModel(this.primary);
    if (!primaryModel && !Object.keys(byScope).length) return;
    const top = primaryModel ? byScope[primaryModel.scope] : Object.values(byScope)[0];
    print.push(top?.scope);
    const fingerprint = print.join("\n");
    if (fingerprint !== this.dismissalPrint) {
      this.dismissalPrint = fingerprint;
      setShared("rig.dismissedUpdates", { ...top, byScope });
    }
    // The request count follows the sidebar's own rows, so rig.data is published again only when that count moved, from what the sidebar
    // last published (never a copy read back from the shared store).
    if (this.data) {
      // The count follows the rows and requests only, never the dismissals, and this runs every second: it is computed again only when those arrays
      // are new (a refresh that read the same keeps them, and the merged view of several connections is rebuilt only when one of them changed).
      // With no request list (OpenRig didn't answer it) the count is unknown: the refresh published null, and it stays null rather than 0.
      const topology = this.data.topology, items = this.data.attentionItems, memo = this.attentionCount;
      const attention = !items ? (this.data.attention ?? null)
        : memo && memo.topology === topology && memo.items === items ? memo.count
        : (this.attentionCount = { topology, items, count: needsRequestCount(topology, items) }).count;
      this.data.attention = attention;
      if (this.publishedRigData && this.publishedRigData.attention !== attention) this.setRigData({ ...this.publishedRigData, attention });
    }
  }
  /** Every rig.data publish of the sidebar goes through here, so the dismissal path above patches the value that is actually published. */
  setRigData(value) {
    const previous=this.publishedRigData,versions=this.contentByConnection??{};
    this.publishedRigData = value;
    this.contentStamp=publishRigData(setShared, value);
    this.contentByConnection=Object.fromEntries(Object.entries(value.byConnection??{}).map(([id,entry])=>[id,sameRigData(entry,previous?.byConnection?.[id])?(versions[id]??this.contentStamp):this.contentStamp]));
    this.publishRefresh(value);
  }

  /** Successful-read heartbeat and content versions are separate: an unchanged read keeps pages fresh without invalidating their lists. */
  publishRefresh(value){
    const next={at:value.at??null,byConnection:Object.fromEntries(Object.entries(value.byConnection??{}).map(([id,entry])=>[id,entry.at??null])),dataStamp:this.contentStamp,dataByConnection:this.contentByConnection??{}};
    const previous=shared("rig.refreshed"),now=Date.now();
    // Herdr 0.1.16 refreshes every view on any changed shared write. Liveness gets one write a minute; content remains immediate.
    const changed=previous?.dataStamp!==next.dataStamp||!sameValue(previous?.dataByConnection,next.dataByConnection);
    if(!changed&&this.refreshPublishedAt!==undefined&&now>=this.refreshPublishedAt&&now-this.refreshPublishedAt<60000)return;
    if(!sameValue(previous,next)){setShared("rig.refreshed",next);this.refreshPublishedAt=now;}
  }

  updateAction(cx, id) {
    const requests = { ...(shared("rig.updateActions") ?? {}) }, req = requests[id]; delete requests[id];
    setShared("rig.updateActions", requests);
    const feed = req?.scope ? this.feeds.find((f) => !f.closed && f.config?.daemonUrl && dismissalScope(f.config) === req.scope) : null;
    const model = feed ? this.dismissalModel(feed) : null;
    if (!req || !model || req.scope !== model.scope) return;
    if (req.action === "dismiss") {
      const items = liveDismissalItems(Array.isArray(req.value) ? req.value : [req.value], feed.data?.attentionItems ?? [], model.records);
      if (model.dismiss(items).length) model.receipts = model.receipts.slice(-1);
    }
    else if (req.action === "undo") model.undo(req.value);
    else if (req.action === "restore") model.restore(req.value);
    else if (req.action === "show") model.show = !model.show;
    else if (req.action === "leave") model.leave();
    this.publishDismissals();
    cx.spawn(async (cx) => {
      try { await this.saveDismissals(model); }
      catch (_) { setShared("rig.dismissSaveError", `Couldn't save which updates are dismissed. They may come back after a restart. ${SAVE_NEXT}`); }
      cx.notify();
    });
  }

  /** One refresh's attention read (see ASKS_PATH): the requests now, with the other items of the connection's last whole list. An OpenRig that
   *  ignores `kind` answers with its whole list; that answer is used as one, and read again only when due. A failed read is null, as before. */
  async readAttention(feed, get) {
    const key = fullAttentionKey(feed.config);
    let full = feed.fullAttention;
    if (full?.key !== key) full = feed.fullAttention = { key, data: null, ms: 0, nextAt: 0, pending: false, unsupported: false };
    if (full.unsupported && Date.now() < full.nextAt) return attentionAnswer(full, null);
    const started = Date.now();
    const asks = await get(ASKS_PATH).catch(rethrowGate(null));
    if (!asks) {
      // The narrow read failed: the whole list is read as it always was (not beside a background read of it), and its own failure is the answer.
      if (full.pending) return attentionAnswer(full, null);
      const wholeStarted = Date.now();
      const whole = await get(FULL_ATTENTION_PATH).catch(rethrowGate(null));
      if (!Array.isArray(whole?.items)) return null;
      this.fullAttentionDone(full, Date.now() - wholeStarted, whole);
      return attentionAnswer(full, null);
    }
    if (!kindFiltered(asks)) {
      full.unsupported = true;
      this.fullAttentionDone(full, Date.now() - started, asks);
      return attentionAnswer(full, null);
    }
    full.unsupported = false;
    this.startFullAttention(feed);
    return attentionAnswer(full, asks);
  }

  /** Starts the connection's background whole-list read when one is due and none is running. Its answer is kept only for the connection it was
   *  read from, and is used by the next refresh (every five seconds), so nothing is published from here. */
  startFullAttention(feed) {
    const full = feed.fullAttention;
    if (!full || full.unsupported || full.pending || Date.now() < full.nextAt || feed.closed || !feed.config?.daemonUrl) return;
    if (full.key !== fullAttentionKey(feed.config)) return;
    const started = Date.now();
    full.pending = true;
    this.get(FULL_ATTENTION_PATH, feed).then((data) => ({ data }), (error) => ({ error })).then(({ data, error }) => {
      full.pending = false;
      if (feed.fullAttention !== full || feed.closed || fullAttentionKey(feed.config) !== full.key) return;
      this.fullAttentionDone(full, Date.now() - started, data, error);
    });
  }

  /** Records a whole-list read: its time, when the next is due, and its answer (a failed read keeps the last one). */
  fullAttentionDone(full, ms, data, error = null) {
    full.ms = ms;
    full.nextAt = Date.now() + (ms >= FULL_ATTENTION_QUICK_MS ? FULL_ATTENTION_GAP_FACTOR * ms : 0);
    if (Array.isArray(data?.items)) { full.data = data; full.error = null; }
    else full.error = error ? errorDiagnostic(error) : "OpenRig's list of what needs you had no items.";
  }

  /** The sentence for a connection whose whole list is slow, or null. */
  slowAttentionNote(feed) {
    const full = feed?.fullAttention;
    if (!full || full.ms < FULL_ATTENTION_SLOW_MS || full.key !== fullAttentionKey(feed.config)) return null;
    const secs = (ms) => Math.max(1, Math.round(ms / 1000));
    const every = secs(FULL_ATTENTION_GAP_FACTOR * full.ms);
    return full.unsupported
      ? `This OpenRig takes ${secs(full.ms)} s to list what needs you, so the list is read every ${every} s.`
      : `This OpenRig takes ${secs(full.ms)} s to list its updates, so they're read every ${every} s. Requests stay current.`;
  }

  async get(path, feed = this.primary, op = null) {
    if (!feed.config?.daemonUrl) {
      // With several OpenRigs a connection that names no address reads nothing: the CLI's own discovery could find any daemon (the gate refuses to record a found address then).
      if (this.feeds.length > 1) throw new Error(EXPLICIT_ADDRESS_NEEDED);
      const status = await discoverDaemonFromCli(feed.config, execFor(feed.config));
      if (status.reachable && status.daemonUrl) {
        const enriched = { ...feed.config, daemonUrl: status.daemonUrl, daemonUrlSource: "cli", daemonState: status.state, daemonMessage: undefined };
        if (feed === this.primary) this.config = enriched; else feed.config = enriched;
      } else {
        throw new Error(status.message || feed.config?.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up').");
      }
    }
    const scoped = op ?? gatedOperationOrRefusal(feed.config.connectionId); // every read is under the gate scope of ITS connection
    const r = await scoped.fetch(`${feed.config.daemonUrl}${path}`);
    if (!r.ok) throw new Error(requestFailed(requestWhat(path), r.status));
    return stampConnection(await r.json(), feed.config.connectionId);
  }

  /** An invalid config (a connections list with no usable entry) opens no connection: no read, probe or stream, nothing is shown as live, and the sidebar says one plain line. Called by every
   *  refresh and when the config changes into one. Every feed stops: none of them has a connection to read. */
  refuseInvalidConfig(cx) {
    for (const feed of this.feeds) { try { feed.sock?.close(); } catch (_) {} feed.sock = null; feed.data = null; feed.live = false; feed.error = null; feed.needsApproval = false; feed.sidebarState = null; if (feed !== this.primary) { feed.closed = true; const wake = feed.wake; feed.wake = null; wake?.(); } }
    this.feedList.splice(1);
    this.dismissalModels?.clear(); this.dismissals = null; this.dismissalPrint = null; setShared("rig.dismissedUpdates", null);
    this.setRigData({ topology: [], live: false, error: this.config.configInvalid, config: this.config });
    cx.notify();
  }

  async refreshOldViews(cx,force=false){
    const signature=JSON.stringify([layout(),layouts?.()??[]]);
    if(!force&&!this.oldViewsDirty&&this.oldViewsSignature===signature)return shared("rig.oldProviderViews")??[];
    const scan=this.oldViewsScan=(this.oldViewsScan??0)+1,revision=this.oldViewsRevision??0;
    const views=await readOldProviderViews({layout,layouts,readTextFile,currentLayout:()=>shared("layout")},appHome());
    if(scan!==this.oldViewsScan)return views;
    this.oldViewsSignature=signature;this.oldViewsDirty=(this.oldViewsRevision??0)!==revision;
    if(!sameValue(shared("rig.oldProviderViews"),views)){setShared("rig.oldProviderViews",views);cx.notify();}return views;
  }
  async refresh(cx, feed = this.primary) {
    if(feed===this.primary)await this.refreshOldViews(cx);
    let notifyArgs = null; // the needs notifications to run once the read is done (runNotifyNeeds)
    let observeRaw = false; // this feed's live updates were read: its dismissals are observed against them once the read is done (observeDismissals)
    let op = null; // this refresh's ONE gate operation (taken below, before its first request); every read of the feed goes through it
    const get = (path) => this.get(path, feed, op);
    if (!feed.config) {
      const read = await this.readConfigText();
      if (!read.superseded()) this.config = read.config;
    } else if (feed.config.missing) {
      const read = await this.readConfigText();
      const reread = read.config;
      if (!reread.missing && !read.superseded()) {
        this.config = reread;
      }
    }
    if (feed.config?.configInvalid) { this.refuseInvalidConfig(cx); return; }
    if (!feed.config || feed.refreshing) { feed.again = true; return; }
    feed.refreshing = true;
    let probed = null;
    // ONE operation for the whole refresh, taken before the first await: every read below goes through it, so a settings change that lands between two reads refuses the rest
    // instead of mixing two daemons' answers, and nothing is published for the config that is gone.
    op = gatedOperationOrRefusal(feed.config.connectionId); // the scope is this feed's connection (the gate keys by it)
    try {
      const startCfg = feed.config;
      const hasExplicitConfigUrl = Boolean(startCfg.daemonUrl && startCfg.daemonUrlSource !== "cli" && startCfg.daemonUrlSource !== "default");
      let unreachableState = false;
      if (!hasExplicitConfigUrl) {
        const probeFetch = (url, init) => {
          if (feed === this.primary && this.feeds.length === 1 && !this.primary.config?.configInvalid && gateSameConfig(this.primary.config, startCfg)) {
            const found = addressParts(String(url))?.origin ?? null;
            if (found && found !== this.primary.config?.daemonUrl) {
              this.config = { ...this.primary.config, daemonUrl: found, daemonUrlSource: "cli" };
              op = gatedOperationOrRefusal(this.primary.config.connectionId);
            }
          }
          return op.fetch(url, init);
        };
        probed = await probeOpenRigState(feed.config, { exec: execFor(feed.config), fetch: probeFetch, sidebarModId: MOD_IDS.sidebar });
        if (probed.cliVersion) feed.cliVersion = probed.cliVersion;
        if (probed.healthzProbe?.data) feed.healthz = probed.healthzProbe.data;
        if (!probed.daemonUrl || probed.state.id === "S1" || probed.state.id === "S2" || probed.state.id === "S3" || probed.state.id === "S7") {
          feed.sidebarState = probed.state;
          if (probed.state.id === "S1" || probed.state.id === "S2" || probed.state.id === "S7") {
            feed.data = null;
            feed.live = false;
            try { feed.sock?.close(); } catch (_) {}
            feed.sock = null;
            if (feed.config?.daemonUrlSource === "cli") {
              const resetCfg = { ...feed.config, daemonUrl: null };
              delete resetCfg.daemonUrlSource;
              delete resetCfg.daemonState;
              delete resetCfg.daemonMessage;
              this.config = resetCfg;
            }
          }
          feed.error = probed.state.id === "S3" || probed.state.id === "S7"
            ? (probed.state.detail || probed.state.headline || null)
            : null;
          unreachableState = true;
        } else {
          const nextCfg = {
            ...feed.config,
            daemonUrl: probed.daemonUrl,
            daemonUrlSource: "cli",
            daemonState: probed.statusProbe?.state ?? "running",
          };
          delete nextCfg.daemonMessage;
          this.config = nextCfg;
        }
      }
      if (!unreachableState) {
        feed.uiTimezone=timezoneValue(await get('/api/config/ui.timezone').catch(rethrowGate(null)));
        const summary = await get("/api/rigs/summary");
        feed.hostedReader??=new HostedMembersReader(); // one reader per connection: its 404 cache and identity are its own
        const hostedMembers=await feed.hostedReader.read(op.fetch,feed.config,(ms,done)=>cx.timer.after(ms,done));
        const nodesByRig = Object.create(null); // keyed by the daemon's rig ids: no prototype keys
        const unavailableRigs = new Set();
        await Promise.all(summary.filter((r) => !r.archivedAt).map(async (r) => {
          try { nodesByRig[r.id] = await get(`/api/rigs/${encodeURIComponent(r.id)}/nodes`); }
          catch { unavailableRigs.add(r.id); }
        }));
        const attention = await this.readAttention(feed, get);
        const attentionHealth = (attention?.items ?? []).some(i => String(i.id ?? "").startsWith("health:") || String(i.source ?? "").startsWith("/api/health/"))
          ? await get("/api/health").catch(rethrowGate(null)) : null;
        const attentionAgg = await get("/api/queue/attention-aggregate").catch(rethrowGate(null));
        const rawAttentionItems = Array.isArray(attention?.items) ? attention.items : null;
        const queueRows = Object.create(null);
        // Parked-on-person requests have no asker; their queue owner identifies the seat.
        await Promise.all((rawAttentionItems ?? []).filter((a) => a.answer?.verb === "resolve" && String(a.id).startsWith("queue:")).map(async (a) => {
          const id = a.id.slice(6);
          const row = await get(`/api/queue/${encodeURIComponent(id)}`).catch(rethrowGate(null));
          if (row) queueRows[id] = row.item ?? row.qitem ?? row;
        }));
        const attentionItems = rawAttentionItems ? enrichAttentionItems(rawAttentionItems, attentionAgg, queueRows, attentionHealth?.records ?? []) : null;
        if (rawAttentionItems && attention.complete) observeRaw = true; // after the read: see observeDismissals. Only a whole list says which updates are gone.
        const rawPerson = feed.config?.person || attention?.perspective?.personId || null;
        const personId = rawPerson ? String(rawPerson).replace(/@external$/i, "") : null;
        let quietRes = null;
        let modeRes = null;
        if (personId) {
          [quietRes, modeRes] = await Promise.all([
            get(`/api/gateway/human/${encodeURIComponent(personId)}/quiet`).catch(rethrowGate(null)),
            get(`/api/gateway/human/${encodeURIComponent(personId)}/mode`).catch(rethrowGate(null)),
          ]);
        }
        const quietModeChip = quietModeHeaderChip({ quiet: quietRes, mode: modeRes, timezone:feed.uiTimezone });
        const native = await get("/api/native-seats").catch(rethrowGate(null));
        if (hasExplicitConfigUrl) {
          const hzRes = await op.fetch(`${feed.config.daemonUrl}/healthz`).catch(rethrowGate(null));
          if (hzRes?.ok) {
            feed.healthz = await hzRes.json().catch(rethrowGate(() => feed.healthz));
          }
        }
        let kernelStatus = probed?.statusProbe?.kernel ?? null;
        if (!kernelStatus && feed.config.daemonUrl) {
          const krRes = await op.fetch(`${feed.config.daemonUrl}/api/kernel/status`).catch(rethrowGate(null));
          if (krRes?.ok) {
            kernelStatus = await krRes.json().catch(rethrowGate(null));
          }
        }
        let capabilities;
        const forceProbe = Boolean(feed.forceCapabilityProbe);
        feed.forceCapabilityProbe = false;
        {
          const forceHelp = Boolean(feed.forceHelpProbe); feed.forceHelpProbe = false;
          capabilities = await probeCapabilities(feed.config, {
            exec: execFor(feed.config), // the CLI runs for THIS feed's connection (a bare exec refuses with several)
            terminals: terminals?.() ?? [],
            hasNativeSeatsEndpoint: native !== null,
            force: forceHelp,
            cliVersion: probed ? probed.cliVersion : undefined,
          });
        }
        capabilities = await this.providerAvailability(feed, forceProbe, capabilities);
        if(feed.config.daemonMachine){
          const provider=await get("/api/terminal/status?provider=herdr-app").catch(rethrowGate(null));
          const measured=herdrAppAvailability(provider,feed.config.daemonMachine);
          if(measured.herdrAppAvailable!==null)capabilities={...capabilities,herdrAppProvider:true,...measured};
          capabilities.hostWorkerViews=await this.hostWorkerViewsOf(feed,get,summary,measured,forceProbe);
        }
        capabilities.hostWorkerViews=await this.hostWorkerViewsOf(feed,get,summary,{},forceProbe);
        op.check(); // everything read above belongs to the settings this refresh began under: if they changed, nothing of it is published (the next refresh reads the new daemon)
        if(!sameValue(shared("rig.capabilities"),capabilities))setShared("rig.capabilities", capabilities);
        const topology = buildTopology(summary, nodesByRig, native?.seats, feed.config?.connectionId);
        for (const rig of topology) {
          rig.nodesUnavailable = unavailableRigs.has(rig.id);
          const previous = feed.data?.daemonUrl === feed.config.daemonUrl
            ? feed.data.topology?.find(r => r.id === rig.id) : null;
          const knownHost = hostOf(summary.find(r => r.id === rig.id))
            || (nodesByRig[rig.id] ?? []).map(hostOf).find(Boolean)
            || (previous?.hostKnown ? previous.host : null);
          rig.hostKnown = Boolean(knownHost);
          if (rig.nodesUnavailable) rig.host = knownHost || "Host unknown";
        }
        if (attentionItems !== null) notifyArgs = [feed, topology, attentionItems, attention?.sources, quietModeChip]; // run after the read: see runNotifyNeeds
        const kernelRig = summary.find((r) => r && !r.archivedAt && r.name === "kernel") ?? null;
        const kernelNodes = kernelRig ? (nodesByRig[kernelRig.id] ?? null) : null;
        const strictKernel = Boolean(probed?.statusProbe || kernelStatus !== null || feed.config?.missing || feed.config?.daemonUrlSource === "cli");
        feed.sidebarState = selectSidebarState({
          versionProbe: probed?.versionProbe ?? { installed: true, code: 0, cliVersion: feed.cliVersion },
          statusProbe: probed?.statusProbe ?? null,
          healthzProbe: probed?.healthzProbe ?? (feed.healthz ? { ok: true, data: feed.healthz } : null),
          summary,
          kernelStatus,
          kernelNodes,
          capabilities,
          sidebarModId: MOD_IDS.sidebar,
          strictKernel,
        });
        const versionLine = formatOpenRigVersionLine({ healthz: feed.healthz, cliVersion: feed.cliVersion });
        const carryFrom = feed.data?.daemonUrl === feed.config.daemonUrl ? feed.data : null;
        feed.data = {
          daemonUrl: feed.config.daemonUrl,
          topology,
          hostedMembers,
          attention: attentionItems ? needsRequestCount(topology, attentionItems) : null,
          attentionItems,
          attentionRaw: rawAttentionItems ?? [],
          attentionHealth: attentionHealth?.records ?? [],
          attentionPerspective: attention?.perspective ?? null,
          // What a Rig page needs to use these items in place of its own read: their sources, and whether they hold every kind of item.
          attentionSources: attention?.sources ?? null,
          attentionComplete: attention?.complete === true,
          quietModeChip,
          at: new Date().toISOString(),
          nodesByRig,
          capabilities,
          sidebarState: feed.sidebarState,
          healthz: feed.healthz,
          cliVersion: feed.cliVersion,
          versionLine,
        };
        carryUnchanged(feed.data, carryFrom);
        feed.error = null; feed.needsApproval = false;
        for (const path of Object.keys(feed.lists)) feed.lists[path] = { ...feed.lists[path], stale: true };
        await this.refreshHealthList(feed,get,attentionHealth);
      }
    } catch (e) {
      // A gate refusal (the settings changed while this ran) is not a connection problem: the person gets its sentence.
      const runtimeError=isCodeError(e); // herdrig's own error while reading, not a connection problem
      const errMsg = e?.code === "GATE_REFUSED" ? e.message : runtimeError ? codeErrorMessage(e) : refreshFailureMessage(e, "Couldn't refresh OpenRig. Check the connection and retry.", { single: this.feeds.length < 2, machine: feed.config?.daemonMachine ?? null });
      feed.error = errMsg;
      feed.needsApproval = needsHelperApproval(e, feed.config); // a herdr:// connection asking for its helper approval again: "Approve helper…"
      if (!feed.data) {
        // Display only (what the sidebar says while the feed is down): a refusal here (several connections, a changed config) is not worth escaping the error handler for, and it must never
        // keep the other feeds from starting.
        // A herdr:// connection asking for its helper approval stays that state (S3, with "Approve helper…"): the local OpenRig's start-the-daemon states are not about it.
        const fallbackProbe = runtimeError || needsHelperApproval(e, feed.config) ? null : probed ?? await probeOpenRigState(
          { ...feed.config, daemonUrl: null, daemonUrlSource: "default" },
          { exec: execFor(feed.config), fetch: op.fetch, sidebarModId: MOD_IDS.sidebar },
        ).catch(() => null);
        if (fallbackProbe && (fallbackProbe.state.id === "S1" || fallbackProbe.state.id === "S2" || fallbackProbe.state.id === "S7")) {
          feed.sidebarState = fallbackProbe.state;
        } else {
          feed.sidebarState = { id: "S3", substate: null, headline: runtimeError ? "Couldn't read OpenRig: a herdrig error." : STATE_COPY.S3.headline, detail: errMsg };
        }
      } else {
        feed.sidebarState = { id: "S3", substate: null, headline: runtimeError ? "Couldn't read OpenRig: a herdrig error." : STATE_COPY.S3.headline, detail: errMsg };
      }
      if (!shared("rig.capabilities") && !feed.config?.capabilities) {
        setShared("rig.capabilities", { probed: false });
      }
    } finally {
      feed.refreshing = false;
    }
    // A list that became invalid while this refresh was in flight: whatever it read belongs to the config that is gone, so nothing of it is stored or published.
    if (this.config?.configInvalid) { this.refuseInvalidConfig(cx); return; }
    if (notifyArgs && feed.data && !feed.error) this.runNotifyNeeds(...notifyArgs);
    if (observeRaw && feed.data && !feed.error) await this.observeDismissals(feed);
    if (feed.data && !feed.error) this.prepareSidebarNeeds(feed);
    this.publishData(cx, feed);
    this.publishDismissals();
    if (!feed.error && feed.data) this.syncRigSpaces(cx);
    if (feed.again) { feed.again = false; await this.refresh(cx, feed); }
  }

  /** Refresh an observed Health read before publishing; only changed records/errors advance the connection's content version. */
  async refreshHealthList(feed,get,known=null){
    const previous=feed.lists['/api/health'],config=feed.config;
    if(known===null&&!this.healthConsumed(feed))return;
    let next;
    try{next={data:known??await get('/api/health'),at:new Date().toISOString()};}
    catch(e){if(e?.code==='GATE_REFUSED')throw e;next={...(previous??{}),error:errorDiagnostic(e),loading:false,stale:false};}
    if(!gateSameConfig(config,feed.config))return;
    if(!sameValue(healthListContent(previous?.data),healthListContent(next.data))||!sameValue(previous?.error,next.error))feed.healthRevision=(feed.healthRevision??0)+1;
    feed.lists['/api/health']=next;
  }

  healthConsumed(feed){
    const id=feed.id??feed.config?.connectionId,space=(spaces?.()??[]).find(s=>s?.active),tab=space?.tabs?.find(t=>t.active)??(space?.tabs?.length===1?space.tabs[0]:null);
    if(this.healthDrawn?.has(id)&&this.healthDrawScope?.space===space?.id&&this.healthDrawScope?.tab===tab?.id)return true;
    const shown=shared('rig.pageOnScreen')?.[tab?.id];
    return shown?.space===space?.id&&Object.entries(shown?.healthViews??{}).some(([token,conn])=>conn===id&&shown.views?.[token]===id);
  }

  /** Publishes `rig.data`: the primary feed's state, with the merged rows of every connection that answers when there are several. */
  publishData(cx, feed = this.primary) {
    // The requests are published once: merged at the top level, and each connection's own under its entry only with several connections (a page
    // reads its own entry then; with one it reads the top level). The raw rows kept for the dismissals are the sidebar's own and never published.
    const several = this.feeds.length > 1;
    const published = ({ attentionRaw: _raw, ...rest } = {}, own = false) => (own && !several ? (({ attentionItems: _items, ...entry }) => entry)(rest) : rest);
    const value = {
      ...published(this.data ?? {}),
      healthRevision:this.primary.healthRevision??0,
      live: feed.live,
      error: feed.error,
      retryDelayMs:feed.error?feed.refreshRetry?.delay??null:null,
      config: feed.config,
      sidebarState: feed.sidebarState,
      healthz: feed.healthz,
      cliVersion: feed.cliVersion,
      versionLine: formatOpenRigVersionLine({ healthz: feed.healthz, cliVersion: feed.cliVersion }),
      capabilities: feed.data?.capabilities ?? currentCapabilities(shared, terminals?.() ?? []),
      // Each connection's own state under its id: a second connection writes only its own entry, never another's (the readers above still see
      // the merged rows of the connections that answer).
      byConnection: Object.fromEntries(this.feeds.map((f) => [f.id ?? f.config?.connectionId ?? LEGACY_CONNECTION_ID, {
        machine: f.config?.daemonMachine ?? null, answering: Boolean(f.data) && !f.error, error: f.error, retryDelayMs:f.error?f.refreshRetry?.delay??null:null, needsApproval: f.needsApproval === true, live: f.live, config: f.config, healthz: f.healthz, healthRevision:f.healthRevision??0, ...(f.data && !f.error ? published(f.data, true) : {}), // no stale rows or roster of a connection that does not answer
      }])),
    };
    // rig.data is large and herdr copies it into every reader and rewrites its shared file on each change, so a refresh that read the same content
    // publishes nothing there. Small refresh times keep pages fresh; separate content versions decide when their live lists need invalidating.
    if (!sameRigData(value, this.publishedRigData)) {
      this.setRigData(value);
      cx.notify();
      return true;
    }
    this.publishRefresh(value);
    return false;
  }

  // ---- more than one connection (a hand-written `connections` list) ---------------------------------------------------------------
  /** The feeds for the configured connections: the first is the primary (the sidebar's own `config`, `data`, ...), each other gets its own. */
  syncFeeds(cx) {
    const base = this.primary.config;
    if (!base || base.configInvalid) return;
    const connections = base.connections ?? [];
    this.primary.id = base.connectionId ?? connections[0]?.id ?? LEGACY_CONNECTION_ID;
    if (base.missing) return;
    const wanted = connections.slice(1);
    let removedAny = false;
    for (const old of this.feedList.slice(1)) {
      if (wanted.some((c) => c.id === old.id)) continue;
      try { old.sock?.close(); } catch (_) {}
      old.closed = true; const wake = old.wake; old.wake = null; wake?.(); // its stream loop ends at once, not after its backoff
      this.dismissalModels?.delete(old.id);
      try { this.listScrolls?.get(old.id)?.release?.(); } catch (_) {} this.listScrolls?.delete(old.id); this.listScrollTops?.delete(old.id); // its scroll handle goes with it
      setShared(this.notifiedNeedsKey(old.id), null);
      const byConn = cleanNotifiedNeedsMap(shared("rig.notifiedNeeds.byConn"));
      if (Object.hasOwn(byConn, old.id)) { delete byConn[old.id]; setShared("rig.notifiedNeeds.byConn", byConn); }
      removedAny = true;
      this.feedList.splice(this.feedList.indexOf(old), 1);
    }
    if (removedAny) this.persistSidebarState();
    for (const connection of wanted) {
      const config = connectionConfig(base, connection);
      let feed = this.feedList.find((f) => f.id === connection.id);
      if (!feed) {
        feed = new ConnectionFeed(connection.id);
        feed.config = config;
        this.feedList.push(feed);
        // This box's own scroll handle is made by the draw that shows it (ensureListScroll), never here: syncFeeds runs after the config read's
        // await, and a handle made then would belong to whichever view drained the promise jobs.
        cx.spawn(async (cx) => { await this.refreshSecondary(cx, feed); this.stream(cx, feed); });
      } else if (!sameConfig(feed.config, config)) {
        const moved = feed.config?.daemonUrl !== config.daemonUrl, other = !gateSameConfig(feed.config, config); // another address, home or machine: another OpenRig
        feed.config = config;
        if (other) { // the old OpenRig's rows must not stay drawn (or be acted on under the new identity) while the new one is read, as the first connection's are not
          feed.moved(); this.listScrollTops?.delete(feed.id); this.dismissalModels?.delete(feed.id); setShared(this.notifiedNeedsKey(feed.id), null);
          const byConn = cleanNotifiedNeedsMap(shared("rig.notifiedNeeds.byConn"));
          delete byConn[feed.id]; setShared("rig.notifiedNeeds.byConn", byConn);
          this.persistSidebarState();
          this.publishData(cx); this.publishDismissals(); cx.notify();
        }
        if (moved) { try { feed.sock?.close(); } catch (_) {} }
        cx.spawn(async (cx) => this.refreshSecondary(cx, feed));
      }
    }
  }

  /** The raw requests of every answering connection but the first. */
  /** The connection a dismissal belongs to: the update's own `conn` (an older stored update has none: with exactly one connection it is
   *  that one). Unknown or missing otherwise: refused, never defaulted. */
  dismissalTarget(item) { return targetConnection(this.primary.config, { ...(item ?? {}), conn: adoptConnection(this.primary.config, item?.conn) }); }
  /** The bounded HTTP request function for one connection's dismissals: every call goes to that connection's own address. */
  dismissalRequester(cx, config) {
    return boundedDismissalRequest(async (req) => {
      const res = await fetchFor(config)(`${config.daemonUrl}${req.path}`, { method: req.method,
        ...(req.body ? { headers: req.headers, body: JSON.stringify(req.body) } : {}) });
      const data = await res.json().catch(rethrowGate(null));
      return { ok: res.ok, status: res.status, data };
    }, (ms, done) => cx.timer.after(ms, done));
  }
  /** One dismissal, committed through the update's OWN connection; an unknown or missing connection stays a local hide and sends nothing. */
  async commitDismissalFor(cx, item, expectedScope = null) {
    const target = this.dismissalTarget(item);
    if (!target.ok) return { status: "local", note: `Hidden here only; ${target.reason}` };
    const config = { ...target.config };
    const feed = this.feeds.find((f) => f.id === config.connectionId) ?? this.primary;
    const liveScope = this.dismissalModel(feed)?.scope ?? null;
    return commitDismissal(config, item, this.dismissalRequester(cx, config), {
      attentionItems: (expectedScope ?? liveScope) === liveScope ? feed.data?.attentionItems ?? [] : [],
      person: dismissalRecipient(config, feed.data?.attentionPerspective),
    });
  }

  /** Whether a rig belongs to a connection other than the first. A caller that can only act through the first
   *  connection refuses such a rig instead of routing it through the first connection's address. */
  otherConnection(rig) { return this.feeds.length > 1 && Boolean(rig?.conn) && rig.conn !== this.primary.id; }
  /** The machine a rig lives on, for the person: its connection's machine name, else "another OpenRig". */
  machineOf(rig) { return this.feeds.find((f) => f.id === rig?.conn)?.config?.daemonMachine ?? "another OpenRig"; }
  /** The first connection's rigs: what everything that is not per connection yet may look at. */
  primaryRigs() { return (this.data?.topology ?? []).filter((r) => !this.otherConnection(r)); }
  /** The machine a row lives on, as shown next to it ("This computer" for a connection with none). */
  machineLabelOf(rig) { const feed = this.feeds.find((f) => f.id === rig?.conn); return feed ? (feed.config?.daemonMachine ?? "This computer") : null; }
  refusePrimaryOnly(title, rig) { notify({ title, body: `This isn't available for ${this.machineOf(rig)} yet.`, level: "warning" }); }

  /** The connected-assistant roster of one connection (each OpenRig has its own: its members, its 404 cache, its identity). */
  rosterOf(conn) { const feed = this.feeds.find((f) => f.id === conn) ?? this.primary; return feed.data?.hostedMembers ?? null; }

  /** One refresh of one feed: the primary's full read, or a secondary connection's own read of its rows. */
  async refreshFeed(cx, feed, {automatic=false}={}) {
    if(feed.refreshing){feed.again=true;return;}
    const key=JSON.stringify([gateIdentity(feed.config),gateGeneration(feed.config?.connectionId)]),previous=feed.refreshRetry;
    if(automatic&&feed.error&&previous?.key===key&&Date.now()<previous.nextAt)return;
    if(!automatic){this.completedSpaceSweep=null;this.spaceSweepRetry=null;}
    await (feed===this.primary?this.refresh(cx,feed):this.refreshSecondary(cx,feed));
    if(feed.error){const delay=previous?.key===key?Math.min(previous.delay*2,60000):10000;feed.refreshRetry={key,delay,nextAt:Date.now()+delay};}
    else feed.refreshRetry=null;
    if(previous?.delay!==feed.refreshRetry?.delay){this.publishData(cx);cx.notify();}
  }

  /** Every feed, each failing on its own. */
  async refreshFeeds(cx,automatic=false) {
    await Promise.all(this.feeds.map((feed) => this.refreshFeed(cx, feed,{automatic}).catch(() => {})));
  }

  /** The live provider-availability read (`rig terminal status --provider herdr-app`, one CLI process), cached per connection for 30 s. It used
   *  to run on every 5 s refresh (27 processes in 130 s from an idle sidebar). It is read again at once when forced (a reconnect, the refresh
   *  command, Retry) or when the connection's settings change, so a window that starts or stops is still noticed. */
  async providerAvailability(feed, force, capabilities) {
    const key = JSON.stringify([feed.config?.rig ?? null, feed.config?.daemonUrl ?? null, feed.config?.daemonMachine ?? null, feed.config?.openrigHome ?? null, capabilities.herdrAppProvider]);
    const hit = feed.providerProbe, now = Date.now();
    if (!force && hit && hit.key === key && now - hit.at < 30_000) return { ...capabilities, ...hit.value };
    // The provider's window check names this computer's app home, so a machine connection from the list is never asked with it (see PROVIDER_HOME_ACTIONS); the legacy one keeps the released probe.
    const value = await probeCapabilities({ ...feed.config, capabilities }, { exec: execFor(feed.config), providerAppHome: listAddedMachine(feed.config) ? null : appHome() });
    const availability = {};
    for (const field of ["herdrAppAvailable", "herdrAppAvailabilityReason"]) if (field in value) availability[field] = value[field];
    feed.providerProbe = { key, at: now, value: availability };
    return value;
  }

  /** Whether THIS connection's OpenRig offers herdrig's host-built worker views: its herdr-app provider has no window on its machine and its
   *  daemon answers a worker-view preview with a plan (read once per daemon address, again when forced). Every connection measures its own:
   *  the page and the action read the connection's own capabilities, so a connection that never measured it never offers Worker view. */
  async hostWorkerViewsOf(feed,get,summary,measured,force){
    feed.workerPreviewSupport??=new Map();
    if(force)feed.workerPreviewSupport.delete(feed.config.daemonUrl);
    if(!feed.workerPreviewSupport.has(feed.config.daemonUrl)&&summary.length){
      const preview=await get(`/api/terminal/preview?provider=herdr-app&view=${encodeURIComponent("rig:"+summary[0].name)}&viewportColumns=160`).catch(rethrowGate(null));
      feed.workerPreviewSupport.set(feed.config.daemonUrl,!!preview?.planId&&["fixed","following"].includes(preview?.viewDescriptor?.kind)
        &&Array.isArray(preview?.composed?.pages)&&Array.isArray(preview?.grids));
    }
    return feed.workerPreviewSupport.get(feed.config.daemonUrl)===true;
  }

  /** Retry for one connection: its backoff starts over and it reads now (its stream, waiting out a backoff, is woken). */
  async retryFeed(cx, feed) {
    this.completedSpaceSweep=null;this.spaceSweepRetry=null;feed.refreshRetry=null;
    feed.delay = 1000; feed.forceCapabilityProbe = true; feed.forceHelpProbe = true;
    const wake = feed.wake; feed.wake = null; wake?.();
    await this.refreshFeed(cx, feed);
  }

  /** A secondary connection's read: its rigs, seats and requests, stamped with its own connection. A failure is this connection's alone:
   *  its data is dropped (never shown as live) and the others are untouched. */
  async refreshSecondary(cx, feed) {
    if (feed.closed) return;
    if (feed.refreshing) { feed.again = true; return; }
    feed.refreshing = true;
    const op = gatedOperationOrRefusal(feed.config?.connectionId); // ONE operation for this feed's refresh, under ITS scope
    const get = (path) => this.get(path, feed, op);
    let notifyArgs = null, observe = false;
    try {
      if (!feed.config?.daemonUrl) throw new Error(EXPLICIT_ADDRESS_NEEDED);
      feed.uiTimezone = timezoneValue(await get("/api/config/ui.timezone").catch(rethrowGate(null)));
      const summary = await get("/api/rigs/summary");
      const nodesByRig = Object.create(null), unavailable = new Set();
      await Promise.all(summary.filter((r) => !r.archivedAt).map(async (r) => {
        try { nodesByRig[r.id] = await get(`/api/rigs/${encodeURIComponent(r.id)}/nodes`); } catch { unavailable.add(r.id); }
      }));
      const attention = await this.readAttention(feed, get);
      const attentionHealth = (attention?.items ?? []).some((i) => String(i.id ?? "").startsWith("health:") || String(i.source ?? "").startsWith("/api/health/"))
        ? await get("/api/health").catch(rethrowGate(null)) : null;
      const attentionAgg = await get("/api/queue/attention-aggregate").catch(rethrowGate(null));
      const native = await get("/api/native-seats").catch(rethrowGate(null));
      // Quiet hours and the mode are this OpenRig's own: its toasts honour them like the first connection's do.
      const rawPerson = feed.config?.person || attention?.perspective?.personId || null, personId = rawPerson ? String(rawPerson).replace(/@external$/i, "") : null;
      let quietRes = null, modeRes = null;
      if (personId) [quietRes, modeRes] = await Promise.all([get(`/api/gateway/human/${encodeURIComponent(personId)}/quiet`).catch(rethrowGate(null)), get(`/api/gateway/human/${encodeURIComponent(personId)}/mode`).catch(rethrowGate(null))]);
      const quietChip = quietModeHeaderChip({ quiet: quietRes, mode: modeRes, timezone: feed.uiTimezone });
      const raw = Array.isArray(attention?.items) ? attention.items : null;
      const queueRows = Object.create(null);
      await Promise.all((raw ?? []).filter((a) => a.answer?.verb === "resolve" && String(a.id).startsWith("queue:")).map(async (a) => {
        const id = a.id.slice(6);
        const row = await get(`/api/queue/${encodeURIComponent(id)}`).catch(rethrowGate(null));
        if (row) queueRows[id] = row.item ?? row.qitem ?? row;
      }));
      const attentionItems = raw ? enrichAttentionItems(raw, attentionAgg, queueRows, attentionHealth?.records ?? []) : null;
      feed.hostedReader ??= new HostedMembersReader();
      const hostedMembers = await feed.hostedReader.read(op.fetch, feed.config, (ms, done) => cx.timer.after(ms, done));
      const topology = buildTopology(summary, nodesByRig, native?.seats, feed.config.connectionId);
      for (const rig of topology) {
        rig.nodesUnavailable = unavailable.has(rig.id);
        const known = hostOf(summary.find((r) => r.id === rig.id)) || (nodesByRig[rig.id] ?? []).map(hostOf).find(Boolean);
        rig.hostKnown = Boolean(known);
        if (rig.nodesUnavailable) rig.host = known || "Host unknown";
      }
      const hz = await op.fetch(`${feed.config.daemonUrl}/healthz`).catch(rethrowGate(null));
      if (hz?.ok) feed.healthz = await hz.json().catch(rethrowGate(() => feed.healthz));
      const kernelStatus = await get("/api/kernel/status").catch(rethrowGate(null));
      const providerStatus = await get("/api/terminal/status?provider=herdr-app").catch(rethrowGate(null));
      const measured = herdrAppAvailability(providerStatus, feed.config.daemonMachine), force = Boolean(feed.forceCapabilityProbe);
      feed.forceCapabilityProbe = false;
      const capabilities = currentCapabilities(feed.config.capabilities ?? {}, terminals?.() ?? [], measured);
      capabilities.hostWorkerViews = await this.hostWorkerViewsOf(feed, get, summary, measured, force);
      op.check(); // a change of this connection while the refresh ran: nothing of it is published
      const kernelRig = summary.find(r => !r.archivedAt && r.name === "kernel");
      feed.sidebarState = selectSidebarState({
        versionProbe: { installed: true, code: 0, cliVersion: feed.cliVersion },
        healthzProbe: feed.healthz ? { ok: true, data: feed.healthz } : null,
        summary, kernelStatus, kernelNodes: kernelRig ? nodesByRig[kernelRig.id] : null,
        strictKernel: kernelStatus !== null, sidebarModId: MOD_IDS.sidebar,
      });
      const carryFrom = feed.data?.daemonUrl === feed.config.daemonUrl ? feed.data : null;
      feed.data = { daemonUrl: feed.config.daemonUrl, topology, attention: attentionItems ? needsRequestCount(topology, attentionItems) : null, attentionItems, attentionRaw: raw ?? [], hostedMembers,
        attentionHealth: attentionHealth?.records ?? [], attentionPerspective: attention?.perspective ?? null,
        attentionSources: attention?.sources ?? null, attentionComplete: attention?.complete === true, at: new Date().toISOString(), nodesByRig, healthz: feed.healthz, capabilities };
      carryUnchanged(feed.data, carryFrom);
      feed.error = null; feed.needsApproval = false;
      for (const path of Object.keys(feed.lists)) feed.lists[path] = { ...feed.lists[path], stale: true }; // this connection's lazy reads (its System badge's /api/health) follow its own refresh, as the first connection's do
      await this.refreshHealthList(feed,get,attentionHealth);
      if (attentionItems !== null) notifyArgs = [feed, topology, attentionItems, attention?.sources, quietChip]; // this connection's own needs notifications, run after the read (runNotifyNeeds)
      observe = Boolean(raw && attention.complete); // only a whole list says which updates are gone
    } catch (e) {
      feed.data = null;
      feed.error = e?.code === "GATE_REFUSED" ? e.message : e?.message === EXPLICIT_ADDRESS_NEEDED ? EXPLICIT_ADDRESS_NEEDED : isCodeError(e) ? codeErrorMessage(e) : refreshFailureMessage(e, "Couldn't reach this OpenRig. Check the connection and retry.");
      feed.needsApproval = needsHelperApproval(e, feed.config);
    } finally {
      feed.refreshing = false;
    }
    if (notifyArgs && feed.data && !feed.error) this.runNotifyNeeds(...notifyArgs);
    // Each connection's dismissal model observes its own live list, after the read and in its own try (a failure is said, see observeDismissals).
    if (observe && feed.data && !feed.error) await this.observeDismissals(feed);
    if (feed.data && !feed.error) this.prepareSidebarNeeds(feed);
    this.publishData(cx);
    this.publishDismissals();
    if (feed.again) { feed.again = false; await this.refreshSecondary(cx, feed); }
  }

  /** herdr delivers `rig.<command>` to nextCommand() as its name only (the args of a toast action or a `run` are dropped), so a command for one of several
   *  connections carries the connection IN its name, `<conn>|<target>` (a toast, Attach forwarded from a page or menu, Move rig space). Read back only when the
   *  prefix is a connection of this sidebar; otherwise the whole text is the target. */
  commandTarget(rest) {
    const i = rest.indexOf("|"), conn = i > 0 ? rest.slice(0, i) : null;
    return conn && this.feeds.length > 1 && this.feeds.some((f) => f.id === conn) ? [conn, rest.slice(i + 1)] : [null, rest];
  }
  /** A toast action of `feed` that names it, in the command name herdr delivers (see `commandTarget`) and in the args. */
  toastAction(action, feed) {
    if (!action?.args) return action;
    const named = /^rig\.open-(seat|need):/.test(action.name ?? "") ? action.name.replace(":", `:${feed.id}|`) : action.name;
    return { ...action, name: named, args: { ...action.args, conn: feed.id } };
  }

  /** The machine a feed's toasts name, or null with one connection (a toast is what it always was). */
  toastWhere(feed) { return this.feeds.length > 1 ? feed?.config?.daemonMachine ?? "this computer" : null; }

  /** Retires one connection's saved dismissals whose update is no longer live in ITS OWN list (each connection has its own dismissal model), and saves the result: AFTER a read, in its own try. OpenRig answered, so a state file
   *  that can't be written is herdrig's trouble, never "not answering"; it is said once in words, the data stays, and the next round that saves clears it. */
  async observeDismissals(feed) {
    try {
      const model = this.dismissalModel(feed);
      if (!model) return;
      const before = JSON.stringify(model.saved());
      model.observe(feed.data?.attentionRaw ?? []);
      if (feed.dismissObserveFailed || before !== JSON.stringify(model.saved())) await this.saveDismissals(model);
      if (feed.dismissObserveFailed && shared("rig.dismissSaveError") === feed.dismissObserveFailed) setShared("rig.dismissSaveError", null);
      feed.dismissObserveFailed = null;
    } catch (e) {
      // Herdr's file write throws a plain Error with only a message, never a code, and that message may carry the file's private path: it is never printed. The
      // cause is told from the sentence it sends (stateSaveReason: a fixed phrase); herdrig's own error is said as that, cut short.
      const why = isCodeError(e) ? describeCodeError(e) : stateSaveReason(e);
      const text = `Couldn't save which updates are dismissed (${why}). They stay hidden for now and may come back after a restart. ${SAVE_NEXT}`;
      feed.dismissObserveFailed = text;
      setShared("rig.dismissSaveError", text);
    }
  }

  /** Runs a feed's needs notifications AFTER its read, in their own try: OpenRig answered, so a failure here is herdrig's, never "not answering". The
   *  data stays; the person is told once per distinct failure, and a round that works clears it. */
  runNotifyNeeds(feed, ...args) {
    try { this.notifyNeeds(feed, ...args); feed.notifyError = null; }
    catch (e) {
      const message = errorDiagnostic(e);
      if (feed.notifyError !== message) {
        feed.notifyError = message;
        const where = this.toastWhere(feed);
        notify({ title: "OpenRig", level: "warning",
          body: `Needs notifications stopped working${where ? ` on ${where}` : ""}: ${message}. The sidebar still shows OpenRig; this is a herdrig error, not a connection problem.` });
      }
    }
  }

  /** Needs notifications for ONE connection (every feed runs its own, whichever box is shown): its own seen-state, so an ask id another box also issued neither silences nor repeats this one's. The
   *  first feed keeps the original `rig.notifiedNeeds` key; another connection's is that key qualified by its id. A toast names the machine and its action names the connection. */
  notifyNeeds(feed, topology, attentionItems, sources, quietChip) {
    const connId = feed === this.primary ? this.primaryStateId() : feed.id;
    const stateKey = this.notifiedNeedsKey(connId);
    const lists = this.hostLists();
    const { toasts, nextState } = diffPriorityNotifications(topology, attentionItems, feed.prioritySeeded ? shared(stateKey) : null, {
      quiet: Boolean(quietChip), needsVisible: isNeedsVisible({ nav: this.shownNav(), activeChild: shownChild(lists) }), notificationsEnabled: (shared("rig.settings")?.notifications ?? true) !== false, sources,
      focusedSession: this.focusedSeat(topology, lists), terminals: lists.terminals, spaces: lists.spaces, config: this.config,
    });
    feed.prioritySeeded = true;
    if(!sameValue(shared(stateKey),nextState))setShared(stateKey, nextState);
    const byConn = cleanNotifiedNeedsMap(shared("rig.notifiedNeeds.byConn"));
    const cleanedNext = cleanNotifiedNeeds(nextState);
    if (cleanedNext) byConn[connId] = cleanedNext;
    else delete byConn[connId];
    if(!sameValue(shared("rig.notifiedNeeds.byConn"),byConn))setShared("rig.notifiedNeeds.byConn", byConn);
    if(shared("rig.notifiedNeeds.primary")!==this.primaryStateId())setShared("rig.notifiedNeeds.primary", this.primaryStateId());
    this.persistSidebarState();
    const where = this.toastWhere(feed);
    for (const t0 of toasts) {
      const t = where ? { ...t0, title: String(t0.title ?? "").includes(" needs you") ? String(t0.title).replace(" needs you", ` on ${where} needs you`) : `${t0.title} · ${where}`,
        action: this.toastAction(t0.action, feed) } : t0;
      if (t.action?.args?.id) { this.lastNeedId = t.action.args.id; this.lastNeedConn = where ? feed.id : null; setShared("rig.pendingNeed", t.action.args.id); }
      else { this.lastNeedId = null; this.lastNeedConn = null; setShared("rig.pendingNeed", null); }
      notify(t);
      if (settings()?.sounds?.enabled !== false) playSound("blocked");
    }
  }

  /** Toasts for a native seat that ended outside OpenRig (never relaunched on its own), and an agent's background open: from every connection, naming the machine when there are several. */
  toast(ev, feed = this.primary) {
    let d = {};
    try { d = JSON.parse(ev.data); } catch { return; }
    // The public event bus uses unnamed SSE messages; the legacy stream names its events.
    const kind=ev.event==="message"?d?.type:ev.event;
    if (kind !== "seat.native_ended" && kind !== "terminal.agent_opened") return;
    const hasStack = hasRigWorkStack(layout());
    if (kind === "seat.native_ended") {
      const where = this.toastWhere(feed);
      notify({ title: `${d.sessionName} ended${where ? ` on ${where}` : ""}`, body: "The herdr-core terminal closed outside OpenRig. Relaunch or Resume it from Needs-You.", level: "warning",
        action: hasStack ? { name: "layout.select", args: { stack: "rig-work", child: "rig-page" } } : { name: this.feeds.length > 1 ? `rig.needs:${feed.id}` : "rig.needs", args: {} } });
    } else {
      const where = this.toastWhere(feed);
      notify({ title: `${d.by} opened ${d.viewName ?? d.view}${where ? ` on ${where}` : ""}`, body: hasStack ? "In the Rig layout; nothing was moved." : "In a native tab; nothing was moved.", level: "info",
        action: !hasStack && d.tabId ? { name: "tab.select", args: { id: d.tabId } } : { name: "layout.select", args: { stack: "rig-work", child: d.viewId } } });
    }
  }

  /** One shared event stream, detected by its HTTP response; no subscription per page. */
  /** The live-updates loop reconnects after any failure: a dropped connection is that and nothing more. An error of herdrig's own code inside it (a toast,
   *  a refresh, the graph state) would reconnect forever in silence, so it is said once per distinct message for this connection. */
  sayStreamBug(feed, e) {
    if (!isCodeError(e)) return;
    const message = describeCodeError(e);
    if (feed.streamBug === message) return;
    feed.streamBug = message;
    const where = this.toastWhere(feed);
    notify({ title: "OpenRig", level: "warning", what: "live updates",
      body: `Live updates stopped working${where ? ` on ${where}` : ""}: ${message}. The sidebar still refreshes on its own; this is a herdrig error, not a connection problem. If it keeps happening, restart Herdr and report it, with the details from the log.` });
  }

  stream(cx, feed = this.primary) {
    cx.spawn(async (cx) => {
      while (!this.closed && !feed.closed) {
        if (!feed.config?.daemonUrl) { await new Promise((resolve) => cx.timer.after(1000, () => resolve(),{owner:null})); continue; }
        let pendingTimer=null;
        try {
          // herdr:// has no socket to parse: the helper's long-poll stands in (plain JS, the mod runtime need not have `URL`).
          const origin=feed.config.daemonUrl,url = String(origin??"").startsWith("herdr://") ? { protocol: "herdr:", origin } : addressParts(origin);
          if(!url)throw new Error("OpenRig's address is not an http address the event stream can read.");
          const opened=await openRigEventStream(netFor(feed.config),url,socket=>{feed.sock=socket;},()=>this.herdr.eventSocket(origin,feed.config?.connectionId)); // herdr://: the helper's long-poll
          if(this.closed||feed.closed||feed.config?.daemonUrl!==origin){opened.socket.close();continue;}
          feed.hostedReader?.reconnect(feed.config);
          let carry = new Uint8Array(0), pending = false;
          const parseEvents = sseParser((ev) => {
            if(feed.closed||feed.config?.daemonUrl!==origin)return;
            publishGraphActivity(shared,setShared,origin,ev,feed.config?.connectionId);
            this.toast(ev, feed); // every connection's events toast, naming the machine when there are several
            if (pending) return;
            pending = true;
            // The stream resumes outside a view call. These bounded tasks declare their
            // lifetime explicitly and recheck the feed instead of adopting an ambient tab.
            pendingTimer=cx.timer.after(500, (timerCx) => {
              pendingTimer=null;pending=false;
              if(this.closed||feed.closed||feed.config?.daemonUrl!==origin)return;
              // Publication needs the original stream task's sidebar-owned cx.
              // The bounded timer and dispatch task have no view owner themselves.
              timerCx.spawn(async () => {
                if(this.closed||feed.closed||feed.config?.daemonUrl!==origin)return;
                await this.refreshFeed(cx, feed,{automatic:true});
                if(!this.closed&&!feed.closed&&feed.config?.daemonUrl===origin)await this.workerController(cx).event(feed.config);
              },{owner:null});
            },{owner:null});
          });
          feed.live = true; feed.delay = 1000;
          if (feed.hadDisconnect) { feed.hadDisconnect = false; feed.forceCapabilityProbe = true; }
          await this.refreshFeed(cx, feed);
          await this.workerController(cx).event(feed.config); // every connection's events drive its own worker views
          if(opened.initial.length){let text;[text,carry]=utf8(opened.initial,carry);parseEvents(text);}
          // An idle read timeout (Herdr's 30 s) is not a disconnect: one health request, then the same socket is read again.
          await pumpEvents(feed.sock, {
            onChunk: (chunk) => { let text; [text, carry] = utf8(chunk, carry); parseEvents(text); },
            // Bounded: a peer that is gone without closing the socket must not hang the check (no answer in 10 s counts as failed).
            alive: () => new Promise((resolve) => {
              let done = false,deadline; const finish = (ok) => { if (!done) { done = true; deadline?.cancel?.();resolve(ok); } };
              deadline=cx.timer.after(10000, () => finish(false),{owner:null});
              try{fetchFor(feed.config)(`${origin}/healthz`).then((r) => finish(r.ok), () => finish(false));}catch{finish(false);} // this feed's own scope
            }),
            stop: () => this.closed || feed.closed || feed.config?.daemonUrl !== origin,
          });
        } catch (e) { this.sayStreamBug(feed, e); /* then reconnect below */ }
        finally{pendingTimer?.cancel?.();}
        try { feed.sock?.close(); } catch (_) {}
        // Publish the merged view (this connection's state goes under its own id): never replace rig.data with one connection's data.
        if (feed.live) { feed.live = false; feed.hadDisconnect = true; this.publishData(cx); }
        if (this.closed || feed.closed) return;
        // Each connection waits out its own backoff (1, 2, 4 ... 60 s); Retry wakes it at once.
        await new Promise((resolve) => { let timer;const wake=()=>{timer?.cancel?.();resolve();};feed.wake=wake;timer=cx.timer.after(feed.delay,wake,{owner:null}); });
        feed.wake = null;
        feed.delay = Math.min(feed.delay * 2, 60000);
      }
    });
  }

  menu(target, height = 320, rowKey = this.menuRowKey) {
    // A popup may consume the mouse-up that would otherwise end a row drag.
    this.cancelDrag();
    const reorder = this.reorderRows?.get(rowKey);
    const orderMap = shared("rig.order") ?? {};
    const hasCustomOrder = Boolean(target?.orderGroupKey && Array.isArray(orderMap[target.orderGroupKey]) && orderMap[target.orderGroupKey].length > 0);
    this.open({
      mod: MOD_IDS.menu,
      kind: "popup",
      width: 280,
      height: height + (hasCustomOrder ? 28 : 0) + (reorder ? 56 : 0),
      props: { target: { ...target, ...(target?.conn || this.feeds.length < 2 || !this.shownConnId() ? {} : { conn: this.shownConnId() }), hasCustomOrder, ...(reorder ? { reorder: { ...reorder, key: rowKey } } : {}) } },
    });
  }

  focusSidebar(cx) {
    this.showSidebarHere(cx);
    // The palette closes first; focus on the next tick so its dismissal cannot take it back.
    cx.timer.after(0, next => {
      this.focusHandle?.focus?.();
      const first = this.visibleTreeRows[0] ?? { key: branchKey("topology"), entry: { section: "topology" } };
      this.setViewState("rig.sel", { key: first.key, entry: first.entry, at: Date.now() });
      this.revealTreeSelection(next);next.notify();
    });
  }

  moveSidebarRow(cx, key, direction) {
    const row = this.reorderRows?.get(key);
    if (!row || ![-1, 1].includes(direction)) return;
    const order = shared("rig.order") ?? {};
    const ids = orderSiblings(row.siblingIds, row.groupKey, order, id => id);
    const index = ids.indexOf(row.itemId), destination = index + direction;
    if (index < 0 || destination < 0 || destination >= ids.length) return;
    const next = [...ids]; [next[index], next[destination]] = [next[destination], next[index]];
    const updated = { ...order, [row.groupKey]: next };
    setShared("rig.order", updated); this.persistSidebarState(this.viewState("rig.open.sidebar"), updated); cx.notify();
  }

  cancelDrag(cx) {
    if (!this.dragState) return;
    this.dragState = null; this.dropTarget = null; cx?.notify?.();
  }

  /** Clicking a seat row in the sidebar opens the seat page (`rig-view`) and selects the node. */
  seatClick(rig, seat, pod = null) {
    const h = this.hostLists();
    const attached = findAttachedSeat(h.terminals, h.spaces, seat.session, h.panes, { logicalId: seat.logicalId, rig: rig.name, origin: seatOrigin(this.config, rig.conn), shared: this.seatShared()?.(seat.session) === true }, h.index);
    if (attached) { run("terminal.peek", { terminal: attached.terminal }); return; }
    this.openPage(
      { section: "topology", kind: "seat", rig: rig.name, rigId: rig.id, conn: rig.conn, name: seat.logicalId, session: seat.session, ...(pod ? { pod } : {}) },
      `seat:${seat.session}`,
    );
  }

  /** herdr's terminals, spaces and panes, with the terminal index (seatTerminalIndex). Native herdr copies each list into the mod on every
   *  call, and finding the focused seat looks at every seat: within one render they are read once; outside a render (a click, a feed's
   *  notification) they are read now, once per call. */
  /** herdrig's Spaces list marks rig spaces from this, published only when it changes. Each connection marks its own spaces (a space on a machine
   *  belongs to that machine's connection); with one connection this is the original call. The marks are made again only when what they read
   *  changes (the spaces, the terminals' labels, the panes, the space state, a connection's topology, config or host id): with 30 spaces and 3
   *  OpenRigs, making them on every render cost about 22 ms. */
  publishSpaceMarks(lists = this.hostLists()) {
    const state = shared("rig.spaceState") ?? {};
    const sources = this.feeds.length > 1
      ? this.feeds.filter((f) => f.config && f.data && !f.error).map((f) => ({ topology: f.data.topology ?? [], config: f.config, hostId: f.healthz?.selfHostId }))
      : [{ topology: this.data?.topology ?? [], config: this.config ?? {}, hostId: this.healthz?.selfHostId }];
    const key = JSON.stringify([lists.spaces.map((s) => [s.id, s.machine ?? null, (s.tabs ?? []).map((tab) => tab.id)]),
      lists.terminals.map((tm) => [tm.address, tm.labels ?? null]), lists.panes.map((p) => [p.terminal, p.tab, p.mod ?? null]), state]);
    const marks = this.memoBy("spaceMarks", [key, ...sources.flatMap((x) => [x.topology, x.config, x.hostId])], () => {
      const contexts = openRigSpaceContext(lists.spaces, lists.terminals, lists.panes, state);
      const markWorld = { spaces: lists.spaces, terminals: lists.terminals, panes: lists.panes, state, contexts };
      return JSON.stringify(this.feeds.length > 1 ? Object.assign({}, ...sources.map((x) => rigSpaceMarks({ ...markWorld, ...x }))) : rigSpaceMarks({ ...markWorld, ...sources[0] }));
    });
    if (marks !== this.publishedMarks) { this.publishedMarks = marks; setShared("herdrig.spaces", JSON.parse(marks)); }
  }

  hostLists() {
    const read = () => { const tm = terminals?.() ?? [], pn = panes?.() ?? []; return { terminals: tm, spaces: spaces?.() ?? [], panes: pn, index: seatTerminalIndex(pn, tm) }; };
    const memo = this.renderMemo;
    return memo ? (memo.hostLists ??= read()) : read();
  }

  /** A value made from `deps` (compared by identity) and kept until one of them is replaced. A feed's arrays are replaced on each refresh, never
   *  changed in place, so the per-render work over every update (hundreds with a busy OpenRig) is done again only when its inputs are new. */
  memoBy(key, deps, make) {
    const memo = (this.derivedMemo ??= new Map()), hit = memo.get(key);
    if (hit && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i])) return hit.value;
    const value = make();
    memo.set(key, { deps, value });
    return value;
  }

  /** needsRequestCount for a feed's items and topology, counted once per read of them (a render asks for it in several places). */
  requestCountOf(topology, items) {
    if (!Array.isArray(items)) return needsRequestCount(topology, items);
    const memo = (this.requestCounts ??= new WeakMap()), hit = memo.get(items);
    if (hit && hit.topology === topology) return hit.count;
    const count = needsRequestCount(topology, items);
    memo.set(items, { topology, count });
    return count;
  }
  /** The dismissal records as one comparable value: the records change in place, so a memo over visible items compares this too. */
  dismissalRecordsKey(model) { return model ? model.records.map((r) => `${r.restored ? 1 : 0}${r.key}`).join("\n") : null; }
  /** The items without the dismissed ones. Each item goes through ITS OpenRig's own dismissals: a list that holds several OpenRigs' items (no single box
   *  is being drawn) is grouped by connection first, so a dismissal on one never hides or shows another's row of the same id and summary. */
  visibleItems(items) {
    if (this.feeds.length < 2 || this.viewFeed) return this.dismissalModel()?.visible(items) ?? items;
    const groups = new Map();
    for (const item of items) { const id = item?.conn || this.primary.id; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(item); }
    return [...groups].flatMap(([id, group]) => { const feed = this.feeds.find((f) => f.id === id); return feed ? this.dismissalModel(feed)?.visible(group) ?? group : group; });
  }
  /** The drawn box's items without the dismissed ones: ONE visible() pass a read and dismissal change, shared by the count and the Needs list
   *  (a cold render after a refresh made it twice). Filtered raw: an item's key is the same raw or as a target, so the Needs list then makes
   *  targets for the visible items only. */
  visibleRawItems(items) {
    // One slot per source: the feed's items (shared by the count and the list) and, when a Needs page had the list read, that read's own array.
    const source = items === this.data?.attentionItems ? "feed" : "list";
    return this.memoBy(`needs:visible:${source}:${this.viewFeed?.id ?? this.primary?.id ?? ""}`, [items, ...this.visibleItemsDeps()], () => this.visibleItems(items));
  }

  /** The same visible, enriched targets for one explicit feed, prepared by its read task rather than first made under the render budget. */
  sidebarNeedsItems(feed, items, merged = false) {
    const data = merged ? this.data : feed.data;
    const model = this.dismissalModel(feed), source = items === data?.attentionItems ? "feed" : "list";
    // The combined list still filters every item through its own connection's dismissals.
    const visible = merged ? this.visibleRawItems(items)
      : this.memoBy(`needs:visible:${source}:${feed.id ?? ""}`, [items, model, this.dismissalRecordsKey(model)], () => model?.visible(items) ?? items);
    return this.memoBy(`needs:${merged ? "merged" : feed.id ?? ""}`, [visible, data?.attentionItems], () => {
      const enrichedById = new Map((data?.attentionItems ?? []).filter(x => x?.id).map(x => [`${x.conn ?? ""}\0${x.id}`, x]));
      return sortNeedsByTier(visible.map(item => {
        const match = enrichedById.get(`${item?.conn ?? ""}\0${item?.id}`);
        return needTarget(match ? { ...item, ...match } : item);
      }));
    });
  }

  prepareSidebarNeeds(feed) {
    // Multi-feed renders always select one feed; single-feed renders use the primary. sidebar-updates-render.test.mjs pins both paths.
    // The compatibility merged-list helper remains separate and is not a selectable sidebar display.
    try {
      if (Array.isArray(feed.data?.attentionItems)) this.sidebarNeedsItems(feed, feed.data.attentionItems);
      // A page may already have read the lazy attention list. The sidebar uses that same list, including stale rows while a new read runs.
      for (const [path, result] of Object.entries(feed.lists)) {
        if (!path.startsWith("/api/attention") || !Array.isArray(result.data?.items)) continue;
        const items = this.memoBy(`attention:${feed.id ?? ""}:${path}`, [result.data.items, feed.data?.attentionHealth], () => filterAttentionHealth(result.data.items, feed.data?.attentionHealth ?? []));
        this.sidebarNeedsItems(feed, items);
      }
    } catch (error) { feed.error = codeErrorMessage(error); } // a preparation bug is visible, never reported as a successful fresh feed
  }
  /** What `visibleItems` depends on, for a memo: the one drawn box's model and records, or every box's when the list merges them. */
  visibleItemsDeps() {
    const models = this.feeds.length < 2 || this.viewFeed ? [this.dismissalModel()] : this.feeds.map((f) => this.dismissalModel(f));
    return models.flatMap((m) => [m, this.dismissalRecordsKey(m)]);
  }

  /** `session => boolean` over the merged topology of every connection; undefined with one. */
  seatShared() { return this.feeds.length > 1 ? (session) => seatNameShared(this.data?.topology, session) : undefined; }

  /** A status mark (`statusMark`: a seat's status, or a tone for a rig): the same marks the Rig page draws. */
  dot(t, key, cell = 14, identity = null, needs = []) {
    return statusMarkElement({ div, svg }, t, key, { cell, iconOf: icon, pulse: this.statusMotion?.observe(identity,key,needs) });
  }

  /** The seat being looked at, `{ session, conn }`: the same session name on another OpenRig is a different seat (its toast and Done stay its own). */
  /** The history of the Rig page on screen: the Rig tab's own when it keeps one, else the shared one (a legacy rig-work layout). */
  shownNav() {
    // Herdr's lists as this render read them (hostLists): a draw reads each list once, however many checks ask for the tab on screen.
    const h = this.hostLists(), tab = onScreenRigTab(() => h.spaces, () => h.panes);
    return (tab ? shared("rig.tabPages")?.[tab] : null) ?? shared("rig.nav");
  }
  focusedSeat(topology = this.data?.topology ?? [], lists = null) {
    const entry = this.shownNav()?.stack?.at(-1);
    if (shownChild(lists ?? this.hostLists()) === PAGE && entry?.kind === "seat") return entry.session ? { session: entry.session, conn: entry.conn ?? null } : null;
    const focus = focused();
    // herdr's lists once for every seat (hostLists, or the caller's own read of them), and each seat a lookup in their index.
    const h = lists ?? this.hostLists(), nameShared = this.seatShared();
    const pane = h.panes.find((p) => p.id === focus?.pane || p.focused);
    if (!pane?.terminal) return null;
    for (const rig of topology) for (const pod of rig.pods) for (const seat of pod.seats) {
      const attached = findAttachedSeat(h.terminals, h.spaces, seat.session, h.panes, { logicalId: seat.logicalId, rig: rig.name, origin: seatOrigin(this.config, rig.conn), shared: nameShared?.(seat.session) === true }, h.index);
      if (attached?.terminal === pane.terminal) return { session: seat.session, conn: rig.conn ?? null };
    }
    return null;
  }

  /** How many requests and updates the drawn box shows after dismissals (null without a dismissal model), once per read and dismissal change. */
  visibleNeedsCount() {
    const model = this.dismissalModel();
    if (!model) return null;
    const items = this.data?.attentionItems ?? [];
    // The drawn box's own model: the shared pass is the same list then; a merged list of several boxes keeps the drawn box's count.
    if (this.feeds.length < 2 || this.viewFeed) return this.visibleRawItems(items).length;
    return this.memoBy("needs:visible-count", [items, model, this.dismissalRecordsKey(model)], () => model.visible(items).length);
  }

  priorityRows() {
    // The tracker skips updates (isUpdateNeed): it is handed the requests alone, sorted out once per read instead of on every render.
    const items = this.data?.attentionItems ?? [];
    const asks = this.memoBy("needs:asks", [items], () => items.filter((ask) => !isUpdateNeed(ask)));
    return this.needsTracker?.update(this.data?.topology ?? [], asks, {
      focusedSession: this.focusedSeat(), terminals: this.hostLists().terminals, config: this.config,
    }) ?? [];
  }

  openPriority(row) {
    if (row.kind === "ask") this.openNeedTarget(null, row.ask.id, row.ask.conn);
    else this.seatClick(row.rig, row.seat, row.pod);
  }

  priorityView(t, cx) {
    const stateConn=this.sidebarConnection();
    const rows = this.priorityRows();
    if (this.sidebarState?.id === "S4" && !this.data?.topology?.some((r) => r.name !== "kernel")) return this.topologyRows(t, cx);
    const folds = this.viewState("rig.open.sidebar") ?? {};
    const reqCount = this.requestCountOf(this.data?.topology, this.data?.attentionItems);
    const many = rows.filter((r) => r.kind === "seat").length > 12;
    for (const group of PRIORITY_GROUPS) {
      const members = rows.filter((r) => r.rank === group.rank);
      if (!members.length) continue;
      const gKey = `priority:${group.rank}`;
      const expanded = folds[gKey] ?? (group.rank === 0 ? false : !(group.rank === 1 && many));
      if (expanded && this.stickyTopologySpecs) {
        this.stickyTopologySpecs.set(gKey, {
          key: gKey,
          foldKey: gKey,
          kind: "priority",
          isOpen: true,
          parentKey: "branch:topology",
          entry: null,
          title: group.label,
          tone: group.tone,
          count: String(group.rank === 4 && reqCount !== null ? reqCount : members.length),
          stateConn,
        });
      }
    }
    const registered=[];
    const elements=priorityElements({ div, svg, h_flex }, t, rows, {
      requestCount: reqCount,
      askOwner:ask=>{if(ask?.reply==='resolve'||ask?.answer?.verb==='resolve')return ask.waiting?.owner??ask.destinationSession??null;const member=assistantForNeed(ask,this.rosterOf(ask?.conn));return member?assistantOwner(member):null;},
      folds, selected: this.viewState("rig.sel")?.key, iconOf: icon,
      register: (row) => {this.visibleTreeRows.push(row);registered.push(row);},
      fold: (key, value, cx) => { this.fold(key, value,[],stateConn); cx.notify(); },
      open: (row, event, cx) => {
        if((event?.click_count??1)>=2) this.openPriority(row);
        else this.selectRow(row.kind === "ask" ? {section:"needs",id:row.ask.id,...(row.ask.conn?{conn:row.ask.conn}:{})}
          : {section:"topology",kind:"seat",rig:row.rig.name,rigId:row.rig.id,conn:row.rig.conn,name:row.seat.logicalId,session:row.seat.session},row.key);
        cx?.notify?.();
      },
      menu: (row) => this.menu(row.kind === "ask" ? needTarget(row.ask) : { ...row.seat, kind: "seat", rig: row.rig.name, rigId: row.rig.id, conn: row.rig.conn, lifecycle: row.rig.lifecycle }),
      helper: (child) => run("terminal.peek", { terminal: child.address }),
      hovered: this.priorityHovered, hover: (key, cx) => { this.priorityHovered = key; cx.notify(); },
      mark: row => needsMark({div,svg},t,row.mark,true,icon,this.statusMotion.observe(qualifyKey(row.rig?.conn,row.seat?.session??row.key),row.mark,row.asks.map(n=>n.id))),
      machineOf: null, // one connection is drawn: no machine label on its rows
    });
    return [...(this.data?.topology ?? []).filter(r => r.nodesUnavailable).map(r => this.rigSeatsUnavailable(t, cx, r)),
      ...elements.map((el,i)=>this.scrollRow(el,registered[i]?.key,registered[i]?.key?.startsWith("priority-helper:")?26:30)),...this.archivedRows(t,cx)];
  }

  archivedRows(t, cx, host = null, indent = 18) {
    const stateConn=this.sidebarConnection();
    // Documented archived listing: OpenRig docs/releases/v0.3.3.md, HTTP API examples.
    const got = this.list(cx, "/api/rigs/summary?archived=only"), key = `archived:${host ?? "all"}`;
    if (got.error) return [div().pl(indent).text_size(11.5).text_color(t.dim).child(errorBlock(this,t,"archived-rigs-error",got.error))];
    const records = withArchivedHosts(got.data, id => this.list(cx, `/api/rigs/${encodeURIComponent(id)}/nodes`).data, this.config?.connectionId);
    const showHost = host === null && new Set([...(this.data?.topology ?? []).map(r => hostOf(r) ?? "local"), ...records.flatMap(r => r.hosts)]).size > 1;
    const registered=[];
    const open = Boolean(this.viewState("rig.open.sidebar")?.[key]);
    const elements=archivedElements({ div, svg, h_flex }, t, records, { host, showHost, indent, icon,
      open, register: row => {this.visibleTreeRows.push(row);registered.push(row);},
      toggle: (_e, cx) => { this.fold(key, !this.viewState("rig.open.sidebar",stateConn)?.[key],[],stateConn); cx.notify(); },
      restore: r => startOneClick({ shared, setShared, run, layout, openOverlay: (spec) => this.open(spec) }, { kind: "rig", rig: r.name, rigId: r.id, conn: r.conn, archived: true, lifecycle: "stopped" }, "unarchive-rig"),
      menu: r => this.menu({ kind: "rig", rig: r.name, rigId: r.id, conn: r.conn, archived: true, lifecycle: "stopped" }),
    });
    return elements.map((el,i)=>this.scrollRow(el,registered[i]?.key ?? null,i===0?22:24,i===0?null:key));
  }

  revealPriorityNeeds(cx,conn=this.sidebarConnection()) {
    if (narrow()) {
      run("layout.resize", { id: "sidebar", px: Math.max(160, Number(shared("sidebar.width")) || 268) });
      setShared("sidebar.collapsed", false);
    }
    this.setViewState("rig.topology.view", "priority",conn);
    this.setViewState("rig.open.sidebar", { ...(this.viewState("rig.open.sidebar",conn) ?? {}), [branchKey("topology")]: true, "priority:4": true },conn);
    this.setViewState("rig.sel", { key: "priority:4", entry: null, at: Date.now() },conn);
    this.revealTreeSelection(cx);
    this.persistSidebarState();
    cx?.notify?.();
  }

  /** Header with `OpenRig` title, Needs-you badge, New rig (+), search/palette, Talk to the operator (S4 only), Page pop-out, TUI pop-out, expand/collapse all, and refresh. */
  compactFollowHeader() { return (this.headerWidth ?? 268) < 340; }
  header(t) {
    const stateConn=this.sidebarConnection();
    const compact = (this.headerWidth ?? 268) < 220 || Boolean(this.viewFeed && this.compactFollowHeader());
    const showTitle = !(this.activeSpaceContext?.rigs?.length && (this.headerWidth ?? 268) < 340);
    const key = paletteKey(keys(), window()?.platform);
    const needs = this.requestCountOf(this.data?.topology, this.data?.attentionItems);
    const showOperatorIcon = Boolean(this.sidebarState?.id === "S4");
    const remoteOperator = Boolean(this.config?.daemonUrl && !isLoopbackDaemonUrl(this.config.daemonUrl));
    const iconButton = (id, name, onClick, label = null) => h_flex().id(id).flex_none().px(compact ? 2 : 4).h(20).gap(3).rounded(4).items_center().text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(onClick).child(svg(icon(name)).size(compact ? 10 : 12).flex_none()).when(!!label, (el) => el.child(div().text_size(10.5).child(label)));
    return h_flex().id("rig-header").px(compact ? 6 : 10).h(30).items_center().justify_between().flex_none()
      .on_mouse_down("right",()=>this.open({mod:MOD_IDS.menu,kind:"popup",width:260,height:240,props:{target:{kind:"sidebar-header"}}}))
      .on_size_change((size, cx) => { if (this.headerWidth !== size.width) { this.headerWidth = size.width; cx.notify(); } })
      .child(h_flex().flex_1().min_w(0).overflow_hidden().gap(6).items_center()
        .when(showTitle || Boolean(this.viewFeed), el => el.child(this.followTitle(t) ?? div().id("rig-header-title").flex_1().min_w(0).truncate().text_size(12).font_semibold().text_color(t.muted).tooltip("OpenRig").child("OpenRig")))
        .when((this.activeSpaceContext?.rigs?.length ?? 0) > 0, el => el.child(div().id("rig-space-context").min_w(0).max_w(this.viewFeed && compact ? 24 : 88).truncate()
          .px(4).h(18).rounded(4).bg(t.raised).text_size(10.5).text_color(t.muted)
          .tooltip([this.activeSpaceContext.rigs.join(", "), !this.live ? "updates every 5 s" : null].filter(Boolean).join("\n")).child(this.activeSpaceContext.rigs.join(", "))))
        .when(needs > 0, (el) => el.child(h_flex().id("rig-needs").flex_none().px(5).h(18).gap(4).rounded(4).items_center().cursor_pointer()
          .bg(`${t.blocked}26`).text_color(t.blocked).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.revealPriorityNeeds(cx,stateConn);
          })
          .child(div().size(6).rounded(3).bg(t.blocked))
          .child(div().text_size(10.5).font_semibold().child(String(needs)))))
        .when(!this.live && Boolean(this.data), (el) => el.child(div().size(6).flex_none().rounded(3).bg(t.working).tooltip("Live updates paused; refreshing every 5 s."))))
      .child(h_flex().flex_none().gap(compact ? 1 : 2).items_center()
        .child(iconButton("rig-new-rig", "plus", (_e, cx) => {
          cx.stop_propagation();
          this.open(newRigOverlay(this.feeds.length > 1 ? stateConn : this.config?.connectionId)); // the box this header draws: at click time `this.config` is the first connection's
        }).tooltip("New rig…"))
        .when(showOperatorIcon, (el) => el.child(
          iconButton("rig-open-operator", "rig-operator", (_e, cx) => {
            cx.stop_propagation();
            this.openOperator(cx);
          }).tooltip("Talk to the operator").when(remoteOperator, (b) => b.opacity(0.45))
        ))
        .child(iconButton("rig-palette", "search", () => run("mod.open", { name: MOD_IDS.palette }))
          .tooltip(key ? `Search rigs, seats, commands (${key})` : "Search rigs, seats, commands"))
        .child(iconButton("rig-expand-all", "chevron-down", (_e, cx) => {
          cx.stop_propagation();
          const nextOpen = expandAllTopology(this.viewState("rig.open.sidebar"), this.data?.topology ?? []);
          this.setViewState("rig.open.sidebar", nextOpen);
          this.persistSidebarState(nextOpen, shared("rig.order"));
          cx.notify();
        }).tooltip("Expand all"))
        .child(iconButton("rig-collapse-all", "chevron-right", (_e, cx) => {
          cx.stop_propagation();
          const nextOpen = collapseAllTopology(this.viewState("rig.open.sidebar"), this.data?.topology ?? []);
          this.setViewState("rig.open.sidebar", nextOpen);
          this.persistSidebarState(nextOpen, shared("rig.order"));
          cx.notify();
        }).tooltip("Collapse all"))
        .child(iconButton("rig-header-menu","rig-more",()=>this.open({mod:MOD_IDS.menu,kind:"popup",width:260,height:240,props:{target:{kind:"sidebar-header"}}})).tooltip("OpenRig actions and settings")));
  }

  /** Render S5a–S5d banner above the tree when the daemon is up and the operator is not ready. */
  s5Banner(t) {
    if (this.sidebarState?.id !== "S5") return null;
    const sub = this.sidebarState.substate ?? "5d";
    const baseHeadline = this.sidebarState.headline ?? STATE_COPY[sub]?.headline ?? STATE_COPY["5d"].headline;
    const headline = this.feeds.length > 1 ? baseHeadline.replace(/^OpenRig\b/, `OpenRig on ${this.config?.daemonMachine ?? "this computer"}`) : baseHeadline;
    const copyText = this.sidebarState.copyText ?? STATE_COPY[sub]?.copyText ?? null;
    const actionLabel = this.sidebarState.actionLabel ?? STATE_COPY[sub]?.actionLabel ?? null;
    const stateWord = this.sidebarState.stateWord ?? null;
    const copied = this.copiedKey === `s5:${sub}`;
    return v_flex().id(`rig-banner-${sub}`).mx(8).my(4).p(8).gap(6).rounded(6).bg(t.raised)
      .child(h_flex().gap(6).items_center().justify_between()
        .child(v_flex().flex_1().min_w_0().gap(2)
          .child(div().text_size(11.5).text_color(t.muted).child(headline))
          .when(Boolean(stateWord), (el) => el.child(div().text_size(11).text_color(t.dim).child(statusWord(stateWord, "startup")))))
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

  retryNote(feed=this.viewFeed??this.primary){return feed.error&&feed.refreshRetry?` Automatic checks retry in about ${Math.ceil(feed.refreshRetry.delay/1000)} s. Retry checks now.`:"";}

  states(t) {
    // Follow mode, a connection that is not the first and does not answer: one row of its own with its own Retry (never the first connection's start-the-daemon states, never another box's rows).
    const shown = this.viewFeed;
    if (shown && shown !== this.primary && !shown.data && shown.error) {
      const label = shown.config?.daemonMachine ?? "This computer";
      const row = h_flex().id(`machine-down-${shown.id}`).px(10).py(6).min_h(22).gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.muted).tooltip(shown.config?.daemonUrl ?? "").child(`${label}: OpenRig isn't answering.${this.retryNote(shown)}`))
        .child(div().id(`machine-retry-${shown.id}`).px(6).h(20).rounded(4).bg(t.raised).flex().items_center().text_size(11).text_color(t.accent).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { cx.stop_propagation(); cx.spawn(async (cx) => this.retryFeed(cx, shown)); }).child("Retry"));
      return this.offersApproval(shown) ? v_flex().child(row).child(div().px(4).child(this.approveHelperLink(t, shown))) : row;
    }
    if (this.config?.configInvalid) {
      return v_flex().id("rig-state-connections-listed").p(10).gap(6).text_size(12).text_color(t.muted).child(div().child(this.config.configInvalid));
    }
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
            .when(this.startingDaemon, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.accent)
              .when(this.config?.reducedMotion !== true, icon => icon.spin(900))))
            .child(div().text_size(11.5).text_color(t.accent).child(this.startingDaemon ? "Starting…" : STATE_COPY.S2.actionLabel))
        ))
        .when(Boolean(this.startDaemonError), (el) => el.child(errorBlock(this,t,"rig-start-daemon-error",this.startDaemonError,{where:"this computer"})));
    }
    if (!this.data && st.id === "S7") {
      return v_flex().id("rig-state-s7").p(10).gap(6).text_size(12).text_color(t.muted)
        .child(div().child(STATE_COPY.S7.headline))
        .child(errorBlock(this,t,"rig-s7-error",st.detail || this.error || ""))
        .child(div().id("rig-retry").px(8).h(22).rounded(5).bg(t.raised).flex().items_center().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => cx.spawn(async (cx) => this.retryFeed(cx,this.viewFeed??this.primary))).child("Retry"));
    }
    if (!this.data && (this.error || st.id === "S3")) {
      return v_flex().id("rig-state-s3").p(10).gap(6).text_size(12).text_color(t.muted)
        .child(div().child(STATE_COPY.S3.headline))
        .child(errorBlock(this,t,"rig-s3-error",(st.detail || this.error || "")+this.retryNote()))
        .when(this.offersApproval(this.primary), (el) => el.child(this.approveHelperLink(t, this.primary))) // the error line's "below"
        .child(div().id("rig-retry").px(8).h(22).rounded(5).bg(t.raised).flex().items_center().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => cx.spawn(async (cx) => this.retryFeed(cx,this.viewFeed??this.primary))).child("Retry"));
    }
    if (!this.data) return renderS0();
    return null;
  }

  /** Toggle a fold key in `this.viewState("rig.open.sidebar")` and persist to `<appHome>/openrig/state.json`. */
  fold(key, open, seats,conn) {
    if(!conn)return false; // A rendered control must supply its owner; never borrow the live box.
    this.cancelTreeReveal();
    if (!open && [branchKey("needs"), "needs:updates"].includes(key)) {
      const feed = this.exactFeed(conn) ?? this.primary;
      this.dismissalModel(feed)?.leave();
      this.publishDismissals();
    }
    const nextOpen = foldChoice(this.viewState("rig.open.sidebar",conn), key, open, seats);
    this.setViewState("rig.open.sidebar", nextOpen,conn);
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
    showElsewhere = true,
    height = null,
  } = {}) {
    // Read once per render, not once per row: every row of a draw sees the same selection and navigation, and each read is a
    // native shared() call that converts the stored value (a sidebar with many rows ran past the render budget).
    const memo = this.renderMemo;
    if (memo && !memo.selRead) { memo.sel = this.viewState("rig.sel"); memo.nav = this.shownNav(); memo.selRead = true; }
    const sel = memo ? memo.sel : this.viewState("rig.sel");
    const nav = memo ? memo.nav : this.shownNav();
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
      .when(this.dragState?.moved && this.dragState.groupKey === groupKey && String(this.dragState.id) === String(itemId), s => s.opacity(0.5))
      .when(isSelected, (s) => s.bg(t.selection ?? `${t.accent}1f`).border_l(2).border_color(t.accent))
      .when(entry?.kind === "rig" && this.activeSpaceContext?.rigs?.some(name => name === entry.name || name === entry.rigId),
        s => s.border_l(2).border_color(t.accent))
      .when(isDropTarget, (s) => s.border_b(2).border_color(t.accent));
    // Double-click opens the row's page: the row keeps its single-click behaviour, and Enter opens too.
    const openOnDouble = (e, cx) => {
      if (!entry || (e?.click_count ?? 1) < 2) return false;
      if (entry.kind === "rig") this.openRigSpace(cx, entry.rigId ?? entry.name, null, null, null, null, entry.conn ?? null);
      else this.openPage(entry, rowKey);
      cx?.notify?.();
      return true;
    };

    if (groupKey && itemId && Array.isArray(siblingIds) && siblingIds.length > 1) {
      this.reorderRows ??= new Map();
      // A group's rows share one sibling list: its string form is made once per render, not once per row (that was quadratic in the group's size).
      let ids = memo?.siblingStrings.get(siblingIds);
      if (!ids) { ids = siblingIds.map(String); memo?.siblingStrings.set(siblingIds, ids); }
      this.reorderRows.set(rowKey, { groupKey, itemId: String(itemId), siblingIds: ids });
      out = out.when(isSelected, row => row.child(div().id(`reorder-${rowKey}`).size(18).flex_none().text_size(12).text_color(t.dim).cursor_pointer().tooltip("Move this row")
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.cancelDrag(cx); })
        .on_click((_e, cx) => { cx.stop_propagation(); this.menu({ kind: "sidebar-row", rowKind: entry?.kind ?? "row", name: entry?.name ?? itemId }, 320, rowKey); }).child("⋯")));
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
          cx.stop_propagation();
          const x = e?.position?.x ?? e?.x ?? this.dragState.currentX ?? 0;
          const y = e?.position?.y ?? e?.y ?? this.dragState.currentY ?? 0;
          // The release row decides the destination; an old hover target cannot survive a cross-group release.
          const drop = { groupKey, id: String(itemId), position: this.dropTarget?.position ?? "after", x, y };
          const res = applySiblingDrop(shared("rig.order") ?? {}, this.dragState, drop, this.dragState.siblingIds);
          this.dragState = null;
          this.dropTarget = null;
          if (res.accepted) {
            setShared("rig.order", res.order);
            this.persistSidebarState(this.viewState("rig.open.sidebar"), res.order);
            cx?.notify?.();
          }
        });
    } else if (entry) {
      out = out.on_mouse_down("left", (e, cx) => { openOnDouble(e, cx); });
    }

    if (elsewhere && showElsewhere) {
      out = out.child(div().id(`elsewhere-${rowKey}`).text_size(11).text_color(t.muted).child("·"));
    }
    return this.scrollRow(out, rowKey, height);
  }

  /** Render a top-level collapsible Explorer branch header (`Topology`, `Specs`, `Scopes`, `Terminals`, `Needs`, `System`). */
  branchHeader(t, cx, section, { openBranch, countBadge = null, badgeTone = null, extraLeftOfCount = null, extraRight = null, parentKey = null, groupKey = "tree:branches", siblingIds = RIG_SECTIONS } = {}) {
    const stateConn=this.sidebarConnection();
    const bKey = branchKey(section);
    const entry = { section };
    this.visibleTreeRows.push({ key: bKey, foldKey: bKey, expandable: true, isOpen: openBranch, parentKey, entry });
    const title = SECTION_TITLES[section] ?? section;
    const badgeColor = badgeTone ? (t[badgeTone] ?? t.dim) : t.dim;
    const row = h_flex().id(`rig-section-${section}`).px(8).h(24).gap(6).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        // Clicking the branch header toggles/expands the branch in the sidebar and sets selection (only the pop-out icon or a leaf/node click opens a Page tab when none is open).
        const nextOpenState = !openBranch;
        this.fold(bKey, nextOpenState,[],stateConn);
        this.setViewState("rig.sel", { key: bKey, entry, at: Date.now() },stateConn);
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu({ kind: "branch", section, name: title, orderGroupKey: groupKey }, 140, bKey))
      .child(div().id(`branch-fold-${section}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.fold(bKey, !openBranch,[],stateConn);
          cx.notify();
        })
        .child(svg(icon(openBranch ? "chevron-down" : "chevron-right")).size(11)))
      .child(div().flex_1().truncate().text_size(11.5).font_semibold().text_color(t.muted).tooltip(String(title??"")).child(title))
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
  rigSeatsUnavailable(t, cx, rig, indent = 18) {
    return v_flex().id(`rig-seats-unavailable-${rig.id}`).pl(indent).pr(8).py(4).gap(3)
      .child(div().text_size(12).text_color(t.foreground).child(rig.name))
      .child(h_flex().gap(5).items_center()
        .child(div().text_size(11.5).text_color(t.muted).child("Couldn't load seats."))
        .child(div().id(`rig-seats-retry-${rig.id}`).text_size(11.5).text_color(t.accent).cursor_pointer()
          .on_click((_e, ctx) => { ctx.stop_propagation(); ctx.spawn(async task => this.refresh(task)); }).child("Retry")));
  }

  topologyRows(t, cx) {
    const stateConn=this.sidebarConnection();
    const stale = !!this.error;
    const strip = stripProps();
    const folds = this.viewState("rig.open.sidebar") ?? {};
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
      out.push(...this.archivedRows(t, cx));
      return out;
    }
    const viewsData = this.lists["/api/terminal/views"]?.data ?? null;

    const renderRigSubtree = (rig, hostParentKey, rigSiblingIds, rigGroupKey, baseIndent = treeIndent(1)) => {
      // Match a rig name after its 12px chevron slot and 6px row gap.
      if (rig.nodesUnavailable) { out.push(this.rigSeatsUnavailable(t, cx, rig, baseIndent + 18)); return; }
      const rigSeats = rig.pods.flatMap((p) => p.seats);
      const rKey = rigKey(rig.id);
      const openRig = rigFoldOpen(rig, rigSeats, folds);
      const stoppedRig = isRigStopped(rig.lifecycle, rigSeats);
      const views = this.otherConnection(rig) ? [] : viewsForRig(strip, rig.pods.flatMap((p) => p.seats.map((s) => s.session)), rig.name); // worker views are not per connection yet
      const rigEntry = { section: "topology", kind: "rig", rigId: rig.id, conn: rig.conn, name: rig.name };
      this.visibleTreeRows.push({ key: rKey, foldKey: rKey, expandable: true, isOpen: openRig, parentKey: hostParentKey, entry: rigEntry });

      const rigRow = h_flex().id(`rig-${rig.id}`).pl(baseIndent).pr(8).h(24).gap(6).items_center().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.selectRow(rigEntry,rKey);cx.notify(); })
        .on_mouse_down("right", () => this.menu({ kind: "rig", rig: rig.name, rigId: rig.id, conn: rig.conn, lifecycle: rig.lifecycle, orderGroupKey: `rig:${rig.id}:pods` }, 320, rKey))
        .child(div().id(`rig-fold-${rig.id}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.fold(rKey, !openRig, rigSeats,stateConn); cx.notify(); })
          .child(svg(icon(openRig ? "chevron-down" : "chevron-right")).size(11)))
        .child(div().flex_1().truncate().text_size(12.5).font_semibold().text_color(stale || stoppedRig ? t.dim : t.foreground).tooltip(String(rig.name??"")).child(rig.name))
        .when(stoppedRig, (el) => el.child(div().text_size(10.5).text_color(t.dim).child("stopped"))
          .child(div().id(`rig-resume-${rig.id}`).px(5).h(18).rounded(4).bg(t.raised).flex().items_center().text_size(10.5).text_color(t.accent).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: 380, props: { target: { kind: "rig", rig: rig.name, rigId: rig.id, conn: rig.conn, lifecycle: rig.lifecycle }, step: { action: "resume", confirm: true } } });
            }).child("Resume…")))
        .child(this.dot(t, rig.tone))
        .child(div().text_size(11).text_color(t.dim).child(`${rig.activeCount ?? 0}/${rig.seatCount}`))
        .when(views.length > 0, (el) => el.child(div().id(`rig-views-${rig.id}`).px(4).rounded(4).text_size(11).text_color(t.muted).hover((s) => s.bg(t.raised))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            if (!openRig) { this.fold(rKey, true, rigSeats,stateConn); cx.notify(); }
            else if (views[0]?.id) { selectWorkerView(views[0].id, { run, layout, views, spaces, panes }); }
          })
          .on_mouse_down("right", () => this.menu({ kind: "views", rig: rig.name, rigId: rig.id, conn: rig.conn, views }))
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
      this.stickyTopologySpecs?.set(rKey, {
        key: rKey,
        foldKey: rKey,
        kind: "rig",
        isOpen: true,
        parentKey: hostParentKey,
        entry: rigEntry,
        indent: baseIndent,
        rig,
        seats: rigSeats,
        stoppedRig,
        stale,
        views,
        stateConn,
        onMenu: () => this.menu({ kind: "rig", rig: rig.name, rigId: rig.id, conn: rig.conn, lifecycle: rig.lifecycle, orderGroupKey: `rig:${rig.id}:pods` }, 320, rKey),
      });

      // Pods under Rig
      const podGroupKey = `rig:${rig.id}:pods`;
      const orderedPods = orderSiblings(rig.pods, podGroupKey, orderMap, (p) => p.name);
      const podSiblingIds = orderedPods.map((p) => p.name);
      for (const pod of orderedPods) {
        const key = `${rig.id}/${pod.name}`;
        const pKey = podKey(rig.id, pod.name);
        const openPod = podFoldOpen(rig.id, pod.name, pod.seats, folds);
        const podEntry = { section: "topology", kind: "pod", rig: rig.name, rigId: rig.id, conn: rig.conn, pod: pod.name, name: pod.name };
        this.visibleTreeRows.push({ key: pKey, foldKey: pKey, expandable: true, isOpen: openPod, parentKey: rKey, entry: podEntry });

        const podRow = h_flex().id(`pod-${key}`).pl(baseIndent + 12).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            this.fold(pKey, !openPod, pod.seats,stateConn);
            this.setViewState("rig.sel", { key: pKey, entry: podEntry, at: Date.now() });
            cx.notify();
          })
          .on_mouse_down("right", () => this.menu({ kind: "pod", rig: rig.name, rigId: rig.id, conn: rig.conn, pod: pod.name, lifecycle: rig.lifecycle, orderGroupKey: `pod:${key}:seats` }, 320, pKey))
          .child(div().id(`pod-fold-${key}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); this.fold(pKey, !openPod, pod.seats,stateConn); cx.notify(); })
            .child(svg(icon(openPod ? "chevron-down" : "chevron-right")).size(11).flex_none()))
          .child(div().flex_1().truncate().text_size(12).text_color(t.muted).tooltip(String((pod.name || "—")??"")).child(pod.name || "—"))
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
        this.stickyTopologySpecs?.set(pKey, {
          key: pKey,
          foldKey: pKey,
          kind: "pod",
          isOpen: true,
          parentKey: rKey,
          entry: podEntry,
          indent: baseIndent + 12,
          title: pod.name || "—",
          count: String(pod.seats.length),
          seats: pod.seats,
          stateConn,
          onMenu: () => this.menu({ kind: "pod", rig: rig.name, rigId: rig.id, conn: rig.conn, pod: pod.name, lifecycle: rig.lifecycle, orderGroupKey: `pod:${key}:seats` }, 320, pKey),
        });
        const seatGroupKey = `pod:${key}:seats`;
        const orderedSeats = orderSiblings(pod.seats, seatGroupKey, orderMap, (s) => s.session || s.logicalId);
        const seatSiblingIds = orderedSeats.map((s) => s.session || s.logicalId);
        for (const seat of orderedSeats) {
          const sess = qualifyKey(rig.conn, seat.session); // another OpenRig's same-named seat is its own row
          const sKey = `seat:${sess}`;
          const seatEntry = { section: "topology", kind: "seat", rig: rig.name, rigId: rig.id, conn: rig.conn, name: seat.logicalId, session: seat.session, pod: pod.name };
          // A seat with hc run helpers expands to them.
          const helpers = seat.native?.children ?? [];
          const hKey = `helpers:${sess}`;
          const openHelpers = helpers.length > 0 && branchFoldOpen(folds, hKey, true);
          this.visibleTreeRows.push(helpers.length
            ? { key: sKey, foldKey: hKey, expandable: true, isOpen: openHelpers, parentKey: pKey, entry: seatEntry }
            : { key: sKey, expandable: false, parentKey: pKey, entry: seatEntry });

          const ctxLabel = stale ? null : formatSeatContextPct(seat);
          const ctxWarn = !stale && isSeatContextWarning(seat);
          const seatRow = h_flex().id(`seat-${sess}`).pl(baseIndent + 2 * TREE_STEP).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
            .on_click((_e,cx) => { this.selectRow(seatEntry,sKey); cx?.notify?.(); })
            .on_mouse_down("right", () => this.menu({
              kind: "seat",
              rig: rig.name,
              rigId: rig.id, conn: rig.conn,
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
            }, 320, sKey))
            .child(helpers.length
              ? div().id(`seat-fold-${sess}`).w(12).flex_none().text_color(t.dim).hover((s) => s.text_color(t.foreground))
                .on_click((_e, cx) => { cx.stop_propagation(); this.fold(hKey, !openHelpers,[],stateConn); cx.notify(); })
                .child(svg(icon(openHelpers ? "chevron-down" : "chevron-right")).size(11))
              : leafCell())
            .child(this.dot(t, seat.status,14,seat.session,this.statusMotion.seatNeeds(seat.session,rig.name,seat.logicalId)))
            .child(div().flex_1().truncate().text_size(12).text_color(stale ? t.dim : seat.tone === "idle" || seat.tone === "done" ? t.muted : t.foreground).tooltip(String(seat.logicalId ?? seat.member??"")).child(seat.member))
            .child(div().text_size(11).text_color(t[statusMark(seat.status).word] ?? t.dim).child(stale ? "" : seat.word))
            .when(Boolean(ctxLabel), (el) => el.child(div().id(`seat-ctx-${sess}`).text_size(10.5).text_color(ctxWarn ? t.blocked : t.dim).child(ctxLabel)));

          out.push(this.decorateRow(t, seatRow, {
            rowKey: sKey,
            entry: seatEntry,
            popoutId: `popout-seat-${sess}`,
            groupKey: seatGroupKey,
            itemId: seat.session || seat.logicalId,
            siblingIds: seatSiblingIds,
          }));

          for (const child of openHelpers ? helpers : []) {
            out.push(this.scrollRow(h_flex().id(`child-${child.address}`).pl(baseIndent + 3 * TREE_STEP).pr(8).h(20).gap(6).items_center().hover((s) => s.bg(t.hover))
              .on_click(() => run("terminal.peek", { terminal: child.address }))
              .child(leafCell())
              .child(svg(icon("rig-helper")).size(11).flex_none().text_color(t.dim))
              .child(div().flex_1().truncate().text_size(11.5).text_color(t.muted).tooltip(String(child.label??"")).child(child.label)), null, 20, sKey));
          }
        }
      }

      const aKey = `assistants:${rig.conn}:${rig.id}`;
      const roster = this.rosterOf(rig.conn);
      const assistants=assistantGroup(t,cx,roster,rig,{prefix:'sidebar',icon,rows:this.visibleTreeRows,parentKey:rKey,indent:baseIndent+12,folds,
        append:(row,key)=>out.push(this.scrollRow(row,key,key?null:20,aKey)),
        fold:(key,open)=>this.fold(key,open,[],stateConn),select:(key,entry,cx)=>{this.selectRow(entry,key);cx?.notify?.();},open:entry=>this.openPage(entry),menu:target=>this.menu(target,180),decorate:(row,options)=>this.decorateRow(t,row,options)});
      if(assistants)out.push(assistants);
      if (folds?.[aKey] === true && this.visibleTreeRows.some((r) => r.key === aKey)) {
        const count = this.visibleTreeRows.filter((r) => r.parentKey === aKey).length;
        this.stickyTopologySpecs?.set(aKey, {
          key: aKey,
          foldKey: aKey,
          kind: "assistants",
          isOpen: true,
          parentKey: rKey,
          entry: rigEntry,
          indent: baseIndent + 12,
          title: "Connected assistants",
          count: String(count),
          stateConn,
        });
      }

      // Per-rig `Views` branch under each open rig: the saved views of the rig's OWN connection (its feed's views list). This
      // window's provider views (the strip, matched by session name) belong to the first connection only: another box's same-named seats never match them.
      // The views list is the drawn feed's own, so only the drawn box's own rigs get a branch (in follow mode that is every drawn rig).
      const drawnFeed = this.viewFeed ?? this.primary, otherRig = this.otherConnection(rig), rigFeed = otherRig ? this.ownFeed(rig.conn) : drawnFeed;
      if (!rigFeed || rigFeed !== drawnFeed) return; // a connection no longer set up, or another box's rig drawn in a merged list: no views
      const vBranch = rigViewsBranch(rig, null, viewsData);
      const nativeViews = Object.values(shared("rig.workerViews") ?? {}).filter(entry =>
        entry.target?.id === rig.id && (entry.config?.connectionId ?? LEGACY_CONNECTION_ID) === (rigFeed.config?.connectionId ?? LEGACY_CONNECTION_ID)
        && rigOrigin(entry.config?.daemonUrl) === rigOrigin(rigFeed.config?.daemonUrl)
        && (entry.config?.daemonMachine ?? null) === (rigFeed.config?.daemonMachine ?? null));
      const openItems = nativeViews.filter(entry => entry.pages?.some(page => spaces().some(space => space.tabs?.some(tab => tab.id === page.tab))))
        .map(entry => ({kind:"open-view",id:entry.view,name:entry.name,view:{id:entry.view,name:entry.name,rig:rig.name,
          native:entry,following:entry.following?{target:entry.view,enabled:true,pruneAfterMs:entry.pruneMs}:null}}));
      vBranch.items.unshift(...openItems); vBranch.openCount = openItems.length;
      const vKey = viewsKey(rig.id);
      const openViewsBranch = branchFoldOpen(folds, vKey, vBranch.openCount > 0);
      const viewsEntry = { section: "terminals", view: `rig:${rig.name}`, name: `rig:${rig.name}`, ...(this.feeds.length > 1 && rig.conn ? { conn: rig.conn } : {}) };
      this.visibleTreeRows.push({ key: vKey, foldKey: vKey, expandable: true, isOpen: openViewsBranch, parentKey: rKey, entry: viewsEntry });

      const viewsHeaderRow = h_flex().id(`views-branch-${rig.id}`).pl(baseIndent + 12).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          this.fold(vKey, !openViewsBranch,[],stateConn);
          cx.notify();
        })
        .on_mouse_down("right", () => this.menu({ kind: "views", rig: rig.name, rigId: rig.id, conn: rig.conn, views, orderGroupKey: `rig:${rig.id}:views` }, 320, vKey))
        .child(div().id(`views-fold-${rig.id}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.fold(vKey, !openViewsBranch,[],stateConn); cx.notify(); })
          .child(svg(icon(openViewsBranch ? "chevron-down" : "chevron-right")).size(11)))
        .child(div().flex_1().truncate().text_size(11.5).text_color(t.muted).tooltip("Views").child("Views"))
        .child(div().text_size(10.5).text_color(t.dim).child(`⬚ ${vBranch.openCount + vBranch.savedCount}`));

      out.push(this.decorateRow(t, viewsHeaderRow, {
        rowKey: vKey,
        entry: viewsEntry,
        popoutId: `popout-views-${rig.id}`,
      }));

      if (openViewsBranch) {
        this.stickyTopologySpecs?.set(vKey, {
          key: vKey,
          foldKey: vKey,
          kind: "views",
          isOpen: true,
          parentKey: rKey,
          entry: viewsEntry,
          indent: baseIndent + 12,
          title: "Views",
          count: `⬚ ${vBranch.openCount + vBranch.savedCount}`,
          stateConn,
          onMenu: () => this.menu({ kind: "views", rig: rig.name, rigId: rig.id, conn: rig.conn, views, orderGroupKey: `rig:${rig.id}:views` }, 320, vKey),
        });
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
              .on_click(() => {
                const entry = v.native, page = entry?.pages?.find(page => spaces().some(space => space.tabs?.some(tab => tab.id === page.tab)));
                if (page) { const scopedRun = runFor(rigFeed.config); scopedRun("space.select", {id:entry.space}); scopedRun("tab.select", {id:page.tab}); }
              })
              .on_mouse_down("right", () => this.menu({
                kind: v.following ? "following" : "strip-view",
                viewId: v.id,
                name: viewTitle,
                rig: v.rig ?? rig.name,
                rigId: rig.id, conn: rig.conn,
                grid: v.grid ?? null,
                cells: v.cells ?? [],
                following: v.following ?? null,
                ...(v.following ? {
                  target: v.following.target ?? `rig:${v.rig ?? rig.name}`,
                  enabled: Boolean(v.following.enabled ?? v.following),
                  pruneAfterMs: v.following.pruneAfterMs,
                } : {}),
              }, 320, itemKey))
              .child(leafCell())
              .child(div().text_size(11.5).text_color(t.accent).tooltip(`▦ ${viewTitle}`).child(`▦ ${viewTitle}`).flex_1().truncate())
              .child(div().text_size(10.5).text_color(t.dim).child(v.following ? "follow" : "open"));
            out.push(this.decorateRow(t, viewRow, {
              rowKey: itemKey,
              entry: itemEntry,
              popoutId: `popout-view-${v.id}`,
              groupKey: viewItemsGroupKey,
              itemId: item.id,
              siblingIds: viewSiblingIds,
            }));
            if (v.native?.ended > 0) out.push(this.scrollRow(h_flex().id(`reattach-${rig.id}-${v.id}`)
              .pl(baseIndent + 2 * TREE_STEP + 12).pr(8).h(22).gap(6).items_center()
              .child(div().text_size(11).text_color(t.muted).child(`${counted(v.native.ended,"tile")} ended`))
              .child(div().id(`reattach-action-${rig.id}-${v.id}`).text_size(11).text_color(t.accent).cursor_pointer().child("Reattach")
                .on_click((_event, clickCx) => clickCx.spawn(async taskCx => this.oneClick(taskCx,"open-view",{kind:"rig",rig:rig.name,rigId:rig.id,conn:rig.conn,view:v.id},"open-view")))),null,22,itemKey));
          } else if (item.kind === "saved-view") {
            const itemKey = `rig-saved-view:${rig.id}:${item.rawId}`;
            const itemEntry = { section: "terminals", view: item.id, name: item.name };
            this.visibleTreeRows.push({ key: itemKey, expandable: false, parentKey: vKey, entry: itemEntry });
            const savedRow = h_flex().id(`sidebar-saved-view-${rig.id}-${item.rawId}`).pl(baseIndent + 2 * TREE_STEP).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
              .on_click(() => this.selectRow(itemEntry, itemKey))
              .on_mouse_down("right", () => this.menu({ kind: "saved-view", rig: rig.name, conn: rig.conn, view: item.id, name: item.name, orderGroupKey: viewItemsGroupKey }, 140, itemKey))
              .child(leafCell())
              .child(div().text_size(11.5).text_color(t.foreground).tooltip(`⬚ ${item.name}`).child(`⬚ ${item.name}`).flex_1().truncate())
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

        // Worker pages are ordinary Herdr tabs in this rig's space.
        out.push(this.scrollRow(h_flex().id(`sidebar-design-view-${rig.id}`).pl(baseIndent + 2 * TREE_STEP).pr(8).h(20).gap(6).items_center().hover((s) => s.bg(t.hover))
          .on_click((_event, clickCx) => clickCx.spawn(async taskCx => this.oneClick(taskCx, "open-view", { kind: "rig", rig: rig.name, rigId: rig.id, conn: rig.conn }, "open-view")))
          .child(leafCell())
          .child(div().text_size(11).text_color(t.muted).tooltip("Worker view").child("Worker view").flex_1().truncate()), null, 20, vKey));
      }
    };

    // One list of rigs under one parent: grouped by OpenRig host when they are on more than one (as always), otherwise as they come.
    const renderRigList = (rigs, parentKey, depth, qual, withArchived) => {
      const archived = withArchived ? withArchivedHosts(this.list(cx, "/api/rigs/summary?archived=only").data, id => this.list(cx, `/api/rigs/${encodeURIComponent(id)}/nodes`).data, this.config?.connectionId) : [];
      const rawHosts = [...new Set([...rigs.map((r) => hostOf(r) || "local"), ...archived.flatMap(r => r.hosts)])];
      const multiHost = rawHosts.length > 1 || (rawHosts.length === 1 && rawHosts[0] !== "local");
      const hosts = orderSiblings(rawHosts, qualifyKey(qual, "topology:hosts"), orderMap, (h) => h);
    if (multiHost) {
        for (const h of hosts) {
          const hKey = qualifyKey(qual, hostKey(h));
          const openHost = branchFoldOpen(folds, hKey, true);
          const hostEntry = { section: "topology", kind: "host", hostId: h, name: h };
          this.visibleTreeRows.push({ key: hKey, foldKey: hKey, expandable: true, isOpen: openHost, parentKey, entry: hostEntry });
          const rigsOnHost = rigs.filter((r) => (hostOf(r) || "local") === h);
          const hostRow = h_flex().id(`host-${h}`).pl(treeIndent(depth)).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
            .on_click(() => this.selectRow(hostEntry, hKey))
            .on_mouse_down("right", () => this.menu({ kind: "host", hostId: h, name: h, orderGroupKey: `topology:rigs:${h}` }, 140, hKey))
            .child(div().id(`host-fold-${h}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => { cx.stop_propagation(); this.fold(hKey, !openHost,[],stateConn); cx.notify(); })
              .child(svg(icon(openHost ? "chevron-down" : "chevron-right")).size(11)))
            .child(div().flex_1().min_w(0).truncate().text_size(11.5).font_semibold().text_color(t.muted).tooltip(String(h??"")).child(formatHostId(h)))
            .child(div().text_size(10.5).text_color(t.dim).child(String(rigsOnHost.length)));
          out.push(this.decorateRow(t, hostRow, {
            rowKey: hKey,
            entry: hostEntry,
            popoutId: `popout-host-${h}`,
            groupKey: qualifyKey(qual, "topology:hosts"),
            itemId: h,
            siblingIds: hosts,
          }));
          if (!openHost) continue;
          this.stickyTopologySpecs?.set(hKey, {
            key: hKey,
            foldKey: hKey,
            kind: "host",
            isOpen: true,
            parentKey,
            entry: hostEntry,
            indent: treeIndent(depth),
            title: h,
            count: String(rigsOnHost.length),
            stateConn,
            onMenu: () => this.menu({ kind: "host", hostId: h, name: h, orderGroupKey: `topology:rigs:${h}` }, 140, hKey),
          });
          const rigGroupKey = qualifyKey(qual, `topology:rigs:${h}`);
          const orderedRigs = orderSiblings(rigsOnHost, rigGroupKey, orderMap, (r) => r.id);
          const rigSiblingIds = orderedRigs.map((r) => r.id);
          for (const rig of orderedRigs) {
            renderRigSubtree(rig, hKey, rigSiblingIds, rigGroupKey, treeIndent(depth + 1));
          }
          if (withArchived) out.push(...this.archivedRows(t, cx, h, treeIndent(depth + 1)));
        }
      } else {
        const rigGroupKey = qualifyKey(qual, "topology:rigs:local");
        const orderedRigs = orderSiblings(rigs, rigGroupKey, orderMap, (r) => r.id);
        const rigSiblingIds = orderedRigs.map((r) => r.id);
        for (const rig of orderedRigs) {
          renderRigSubtree(rig, parentKey, rigSiblingIds, rigGroupKey, treeIndent(depth));
        }
        if (withArchived) out.push(...this.archivedRows(t, cx));
      }
    };
    const shownFeed = this.viewFeed, shownQual = shownFeed && shownFeed !== this.primary ? shownFeed.id : null;
    renderRigList(this.data.topology, branchKey("topology"), 1, shownQual, true); // the drawn connection's rigs: with several, the followed one (follow mode)
    if (nonKernelRigs.length === 0 && this.sidebarState?.id === "S4") {
      out.push(renderNoTeamsRow());
    }
    return out;
  }

  /** Lazy-load a branch API list when first expanded and again on refresh. */
  list(cx, path, feed = this.viewFeed ?? this.primary) {
    if(path==='/api/health'&&this.renderMemo)this.renderMemo.healthDrawn?.add(feed.id??feed.config?.connectionId);
    if (path === FULL_ATTENTION_PATH && feed.fullAttention && !feed.fullAttention.unsupported && feed.fullAttention.key === fullAttentionKey(feed.config)) {
      // The whole list has one reader per connection (startFullAttention): this list shows its last answer and never starts a second read.
      // An OpenRig that ignores `kind` keeps the list's own read, as before.
      this.startFullAttention(feed);
      // The feed's own items are the fresh requests merged with the whole list, enriched and prepared after each refresh: the list is those.
      if (Array.isArray(feed.data?.attentionItems)) return { data: { items: feed.data.attentionItems, sources: feed.data.attentionSources ?? [], perspective: feed.data.attentionPerspective ?? null }, at: feed.data.at };
      const whole = feed.fullAttention.data;
      if (!whole) return feed.fullAttention.error && !feed.fullAttention.pending ? { error: feed.fullAttention.error } : { loading: true };
      return { data: { ...whole, items: this.memoBy(`attention:${feed.id ?? ""}:${path}`, [whole.items, feed.data?.attentionHealth], () => filterAttentionHealth(whole.items, feed.data?.attentionHealth ?? [])) } };
    }
    const startedConfig = feed.config;
    const get = (p) => this.get(p, feed);
    const hit = feed.lists[path];
    if ((!hit || hit.stale) && startedConfig && !hit?.loading) {
      feed.lists[path] = { ...(hit ?? {}), loading: true };
      cx.spawn(async (cx) => {
        try {
          const data = await get(path);
          if (!gateSameConfig(startedConfig, feed.config)) return;
          feed.lists[path] = { data, at: new Date().toISOString() };
          if (path.startsWith("/api/attention")) this.prepareSidebarNeeds(feed);
        } catch (e) {
          if (!gateSameConfig(startedConfig, feed.config)) return;
          feed.lists[path] = { ...(hit ?? {}), error: errorDiagnostic(e), stale: false };
        }
        cx.notify();
      });
    }
    const result = feed.lists[path] ?? { loading: true };
    return path.startsWith("/api/attention") && result.data?.items ? { ...result, data: { ...result.data,
      items: this.memoBy(`attention:${feed.id ?? ""}:${path}`, [result.data.items, feed.data?.attentionHealth], () => filterAttentionHealth(result.data.items, feed.data?.attentionHealth ?? [])) } } : result;
  }

  treeLeafRow(t, { id, rowKey, label, detail = "", tooltip = null, entry = null, onClick = null, onRight = null, indent = treeIndent(1), parentKey = null, groupKey = null, itemId = null, siblingIds = null, textColor = null } = {}) {
    this.visibleTreeRows.push({ key: rowKey ?? id, expandable: false, parentKey, entry });
    let el = h_flex().id(id).pl(indent).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
      .on_click(onClick ?? (() => entry && this.selectRow(entry, rowKey ?? id)));
    if (onRight) el = el.on_mouse_down("right", () => {
      this.menuRowKey = rowKey ?? id;
      try { onRight(); } finally { this.menuRowKey = null; }
    });
    if (tooltip) el = el.tooltip(tooltip);
    el = el
      .child(leafCell())
      .child(div().flex_1().truncate().text_size(12).text_color(textColor ?? t.foreground).tooltip([String(label ?? ""), tooltip].filter(Boolean).join("\n")).child(label))
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

  requestRowMark(t, tier) {
    const urgent = ["escalation", "alert"].includes(tier);
    // Match the 14 px status cell and 9 px diamond; align to the headline,
    // rather than centring a font glyph between the row's two text lines.
    return div().h(40).flex_none().pt(4).child(div().size(14).flex().items_center().justify_center()
      .child(urgent ? svg(icon("rig-diamond")).size(9).text_color(t.blocked)
        : div().size(6).rounded(3).bg(t.accent)));
  }

  sidebarUpdateAction(action, value, scope = dismissalScope((this.viewFeed ?? this.followedFeed()).config)) {
    const conn = (this.viewFeed ?? this.followedFeed())?.config?.connectionId;
    const stamp = (v) => (v && typeof v === "object" && !Array.isArray(v) && conn && !v.conn ? { ...v, conn } : v);
    const nextValue = action === "dismiss" ? (Array.isArray(value) ? value.map(stamp) : stamp(value)) : value;
    requestDismissal({ shared, setShared, run, scope }, action, nextValue);
  }

  /** The row that stands for the rows a capped sidebar list doesn't draw: it opens that OpenRig's Needs page on the list's own tab, which lists them all. */
  moreNeedsRow(t, cx, { id, label, conn, parentKey, tab, showDismissed = false }) {
    return this.moreRow(t, cx, { id, label, parentKey, entry: { section: "needs", needsTab: tab, ...(showDismissed ? { showDismissed: true } : {}), ...(conn ? { conn } : {}) } });
  }
  /** The "N more" row after a list the sidebar shows SIDEBAR_ROW_CAP of: it opens the page with the whole list. */
  moreRow(t, cx, { id, label, parentKey, entry: listEntry, indent = 1, conn = null }) {
    const rowKey = `more:${id}`, entry = conn && !listEntry.conn ? { ...listEntry, conn } : listEntry; // the page opens on the row's own OpenRig
    this.visibleTreeRows.push({ key: rowKey, expandable: false, parentKey, entry });
    return this.scrollRow(h_flex().id(id).pl(treeIndent(indent)).pr(8).h(24).gap(6).items_center().cursor_pointer().hover(s => s.bg(t.hover))
      .on_click((_e, ctx) => { this.openPage(entry, rowKey); (ctx ?? cx)?.notify?.(); })
      .child(leafCell()).child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.accent).child(label)), rowKey);
  }
  sidebarUpdates(t, cx, updates) {
    const stateConn=this.sidebarConnection();
    const rowConn = this.feeds.length > 1 ? ((this.viewFeed ?? this.primary)?.id ?? null) : undefined;
    const scope = dismissalScope((this.viewFeed ?? this.followedFeed()).config);
    const model = this.dismissalModel(), hidden = model?.hidden() ?? [], receipts = model?.receiptRows() ?? [];
    if (!updates.length && !hidden.length && !receipts.length) return [];
    const key = "needs:updates", expanded = branchFoldOpen(this.viewState("rig.open.sidebar") ?? {}, key, true);
    const selected = this.viewState("rig.sel")?.key;
    const hovered = (id) => this.hoveredUpdate === id || selected === id;
    const hover = (id) => (over, ctx) => { this.hoveredUpdate = over ? id : null; (ctx ?? cx).notify(); };
    const action = (verb, value) => (_e, ctx) => {
      (ctx ?? cx).stop_propagation(); this.sidebarUpdateAction(verb, value, scope); (ctx ?? cx).notify();
    };
    this.visibleTreeRows.push({ key, foldKey: key, expandable: true, isOpen: expanded, parentKey: branchKey("needs") });
    const head = h_flex().id("needs-updates-branch").pl(treeIndent(1)).pr(8).h(24).gap(6).items_center()
      .on_hover(hover(key)).hover(s => s.bg(t.hover))
      .on_click((_e, ctx) => { this.setViewState("rig.sel", { key }, stateConn); this.fold(key, !expanded,[],stateConn); (ctx ?? cx)?.notify?.(); })
      .on_mouse_down("right", () => this.menu({ kind: "updates-group", ...(stateConn ? { conn: stateConn } : {}), name: "Updates", items: updates }))
      .child(svg(icon(expanded ? "chevron-down" : "chevron-right")).size(11).text_color(t.dim))
      .child(div().flex_1().text_size(11.5).text_color(t.muted).child("Updates"));
    if (updates.length && hovered(key)) head.child(div().id("sidebar-dismiss-all").text_size(11).text_color(t.dim)
      .hover(s => s.text_color(t.foreground)).cursor_pointer().on_click(action("dismiss", updates)).child(updates.length === 1 ? "Dismiss" : `Dismiss all ${updates.length}`));
    else head.child(div().text_size(11).text_color(t.dim).child(String(updates.length)));
    const out = [this.scrollRow(head,key)];
    if (!expanded) return out;
    const updateIds = updates.map(item => item.id); // the group's sibling list, made once for every row
    const row = (n, record, position) => {
      const rowKey = record ? `dismissed:${record.key}` : `need:${n.id}`;
      const entry = { section: "needs", id: n.id, name: n.summary, ...(n.conn ? { conn: n.conn } : {}) };
      this.visibleTreeRows.push({ key: rowKey, expandable: false, parentKey: key, entry, update: record ? null : { ...n, dismissalPosition: position } });
      const el = h_flex().id(record ? `sidebar-hidden-${n.id}` : `need-${n.id}`).pl(treeIndent(1)).pr(8).h(24).gap(6).items_center()
        .on_hover(hover(rowKey)).hover(s => s.bg(t.hover))
        .on_click((_e, ctx) => { this.selectRow(entry, rowKey); (ctx ?? cx)?.notify?.(); })
        .on_mouse_down("right", () => this.menu({ ...(n.conn || !stateConn ? n : { ...n, conn: stateConn }), dismissed: !!record }))
        .child(leafCell()).child(div().flex_1().min_w(0).truncate().text_size(12).text_color(hovered(rowKey) ? t.foreground : t.dim).tooltip(String(n.summary??"")).child(n.summary));
      if (hovered(rowKey) && dismissible(n)) {
        el.child(div().id(`sidebar-${record ? "restore" : "dismiss"}-${n.id}`).size(16).flex_none().items_center().justify_center()
          .cursor_pointer().text_color(t.dim).hover(s => s.text_color(t.foreground))
          .tooltip(record ? "Restore update" : "Dismiss update (Delete)")
          .on_click(action(record ? "restore" : "dismiss", record ? record.key : { ...n, dismissalPosition: position }))
          .child(svg(icon(record ? "rig-restore" : "x")).size(12)));
      } else {
        const mins = Math.max(0, Math.floor((Date.now() - (Date.parse(n.at ?? "") || Date.now())) / 60000));
        el.child(div().text_size(10.5).text_color(t.dim).child(mins < 1 ? "<1m" : `${mins}m`));
      }
      return this.decorateRow(t, el, { rowKey, entry, groupKey: record ? null : "needs:items",
        itemId: n.id, siblingIds: updateIds, showElsewhere: !hovered(rowKey) });
    };
    // Receipts retain the dismissed row's position, including when the last update goes away.
    // A connection added later can bring hundreds of updates nobody dismissed: draw the first ones (newest, in the sidebar's own order) and one
    // row that opens the Needs page for the rest. Drawing them all ran past herdr's render budget.
    const rows = updates.slice(0, SIDEBAR_ROW_CAP).map((n, index) => row(n, null, index));
    for (const receipt of receipts) rows.splice(Math.min(receipt.position, rows.length), 0,
      h_flex().id(`sidebar-receipt-${receipt.id}`).pl(treeIndent(1)).pr(8).h(24).gap(4).items_center().text_size(11.5)
        .child(div().truncate().text_color(t.muted).tooltip(String((receipt.keys.length === 1 ? "✓ Dismissed ·" : `✓ Dismissed ${receipt.keys.length} ·`)??"")).child(receipt.keys.length === 1 ? "✓ Dismissed ·" : `✓ Dismissed ${receipt.keys.length} ·`))
        .child(div().id(`sidebar-undo-${receipt.id}`).text_color(t.accent).cursor_pointer().on_click(action("undo", receipt.id)).child("Undo")));
    out.push(...rows);
    if (updates.length > SIDEBAR_ROW_CAP) out.push(this.moreNeedsRow(t, cx, { id: "sidebar-updates-more", parentKey: key, tab: "updates", conn: updates[0]?.conn ?? rowConn ?? null,
      label: `${updates.length - SIDEBAR_ROW_CAP} more update${updates.length - SIDEBAR_ROW_CAP === 1 ? "" : "s"}` }));
    if (hidden.length) {
      out.push(div().id("sidebar-show-dismissed").pl(treeIndent(1)).h(24).text_size(11).text_color(t.dim).cursor_pointer()
        .on_click(action("show")).child(`${model.show ? "Hide" : "Show"} dismissed (${hidden.length})`));
      if (model.show) {
        out.push(...hidden.slice(0, SIDEBAR_ROW_CAP).map(record => row(record.item, record)));
        if (hidden.length > SIDEBAR_ROW_CAP) out.push(this.moreNeedsRow(t, cx, {
          id: "sidebar-dismissed-more", parentKey: key, tab: "updates", showDismissed: true,
          conn: hidden[0]?.item?.conn ?? rowConn ?? null,
          label: `${hidden.length - SIDEBAR_ROW_CAP} more dismissed`,
        }));
      }
    }
    return out;
  }

  /** Keep sidebar counts, rows and their workflow reads on one effective project. */
  scopesProject(cx) {
    const catalog = this.list(cx, "/api/scopes/projects").data;
    return effectiveScopeProject(null, readScopeProject(shared, this.primary.config ?? this.config, this.sidebarConnection(), catalog), catalog);
  }
  /** Render the children of `Specs`, `Scopes`, `Terminals`, `Needs`, or `System` when expanded. */
  sectionBranchChildren(t, cx, section) {
    const stateConn=this.sidebarConnection();
    // The connection these rows were read from (list()'s own feed), captured now: a right-click lands after the draw, when `this.config` is the
    // first connection's again. With one connection it is that connection, exactly as before.
    const rowFeed=this.viewFeed??this.primary, rowConn=this.feeds.length>1?rowFeed?.id??null:this.config?.connectionId, rowConfig=this.feeds.length>1?rowFeed?.config??this.config:this.config;
    const folds = this.viewState("rig.open.sidebar") ?? {};
    const orderMap = shared("rig.order") ?? {};
    const parentBranchKey = branchKey(section);

    if (section === "system") {
      const health = this.list(cx, "/api/health");
      const counts = healthCounts(health.data?.records);
      const sysItems = SYSTEM_PAGE_VIEWS.flatMap(([id,name])=>[
        {id,label:id==='health'&&counts.notes?`${name} · ${counted(counts.notes, "note")}`:name,
          entry:{section:'system',subview:id,name},
          ...(id==='config'?{expandable:true,foldKey:'system:config'}:{}),
          ...(id==='layout'?{tooltip:'Spaces list and layout'}:{})},
        ...(id==='usage'?[{id:'usage-hosts',label:'Usage · all hosts',entry:{section:'system',subview:'usage-hosts',openUsageHosts:true,name:'Usage · all hosts'}}]:[]),
      ]);
      const orderedSys = orderSiblings(sysItems, "system:items", orderMap, (x) => x.id);
      const sysSiblingIds = orderedSys.map((x) => x.id);
      const out = [];
      const cleanupResult=this.oldViewsCloseResult();
      if(cleanupResult?.text)out.push(div().id('system-old-worker-views-result').pl(treeIndent(1)).pr(8).text_size(12)
        .text_color(cleanupResult.ok===false?t.blocked:t.muted).child(cleanupResult.text));
      const oldViews = knownOldProviderViews(layout(),shared("rig.oldProviderViews")??[]);
      if (oldViews.length) {
        const closeActivation=activationPair(this,'system-close-old-worker-views');
        const openOldViews=()=>this.open({mod:MOD_IDS.menu,kind:"dialog",width:600,height:340,
          props:{target:{kind:"old-views"},step:{action:"close-old-views",views:oldViews,confirm:true}}});
        const canClose = oldViewCandidates(this.config, conn => connectionCapabilities(shared, this.config, conn, terminals())).length > 0;
        const label = canClose ? `OpenRig's old worker views: ${oldViews.length} · ` : "OpenRig's old worker views: close their Herdr tabs; seats keep running.";
        const oldRow = h_flex().id("system-old-worker-views").pl(treeIndent(1)).pr(8).h(22)
          .child(div().text_size(12).text_color(t.muted).tooltip(label).child(label).truncate());
        if (canClose) oldRow.child(div().id("system-close-old-worker-views").role("button").tab_stop(true)
          .text_size(12).text_color(t.accent).cursor_pointer().focus(el=>el.border_1().border_color(t.accent))
          .on_mouse_down('left',closeActivation.pointer())
          .on_key_down(closeActivation.key((event,cx)=>{if(['enter','space',' '].includes(String(event.key??'').toLowerCase())){cx.stop_propagation();openOldViews();}}))
          .on_click(closeActivation.click(openOldViews)).child("Close…"));
        out.push(oldRow);
      }
      for (const item of orderedSys) {
        if (item.expandable) {
          const openCfg = branchFoldOpen(folds, item.foldKey, false);
          const rowKey = `sys:${item.id}`;
          this.visibleTreeRows.push({ key: rowKey, foldKey: item.foldKey, expandable: true, isOpen: openCfg, parentKey: parentBranchKey, entry: item.entry });
          const cfgRow = h_flex().id(`sys-node-${item.id}`).pl(treeIndent(1)).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
            .on_click(() => this.selectRow(item.entry, rowKey))
            .on_mouse_down("right", () => this.menu({ kind: "system-config", name: "Configuration", orderGroupKey: "system:config:categories" }, 140, rowKey))
            .child(div().id(`sys-fold-${item.id}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => { cx.stop_propagation(); this.fold(item.foldKey, !openCfg,[],stateConn); cx.notify(); })
              .child(svg(icon(openCfg ? "chevron-down" : "chevron-right")).size(11)))
            .child(div().flex_1().truncate().text_size(12).text_color(t.foreground).tooltip(String(item.label??"")).child(item.label));
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
            tooltip: item.tooltip,
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

    const selectedProject=section==='scopes'?this.scopesProject(cx):null;
    const path = { specs: "/api/specs/library", scopes: "/api/scopes?counts=1"+(selectedProject?`&project=${encodeURIComponent(selectedProject)}`:''), terminals: "/api/terminal/views", needs: "/api/attention" }[section];
    const got = section === "needs" && Array.isArray(this.data?.attentionItems) && !this.lists[path]
      ? { data: { items: this.data.attentionItems }, at: this.data.at }
      : this.list(cx, path);
    const out = [];
    if (got.error) {
      if (section === "terminals" && /\b401\b/.test(String(got.error))) {
        out.push(div().id("terminals-token-protected").px(18).py(4).text_size(11.5).text_color(t.muted).child(TERMINAL_TOKEN_PROTECTED));
        return out;
      }
      out.push(errorBlock(this,t,`list-error-${section}`,got.error));
      out.push(div().id("rig-list-retry").mx(18).px(8).h(22).rounded(5).bg(t.raised).flex().items_center().text_size(12).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (path === FULL_ATTENTION_PATH && rowFeed.fullAttention && !rowFeed.fullAttention.unsupported) {
            // The whole list has its own reader: Retry makes it due and refreshes the connection, which reads it (never beside a read already running).
            delete rowFeed.lists[path]; rowFeed.fullAttention.nextAt = 0;
            cx.spawn(async (cx) => this.refreshFeed(cx, rowFeed));
          } else rowFeed.lists[path] = { ...got, stale: true };
          cx.notify();
        }).child("Retry"));
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
          .on_click(() => this.selectRow(kindEntry, gFoldKey))
          // The group's specs are ordered per namespace (specs:<kind>:<ns>), so Reset order looks at each.
          .on_mouse_down("right", () => this.menu({ kind: "specs-group", specKind: g.kind, name: g.title,
            orderGroupKeys: [...new Set(g.items.map((s) => specNamespaceOf(s)))].map((ns) => `specs:${g.kind}:${ns}`) }, 140))
          .child(div().id(`specs-kind-fold-${g.kind}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); this.fold(gFoldKey, !openKind,[],stateConn); cx.notify(); })
            .child(svg(icon(openKind ? "chevron-down" : "chevron-right")).size(11)))
          .child(div().flex_1().truncate().text_size(11.5).font_semibold().text_color(t.muted).tooltip(String(g.title??"")).child(g.title))
          .child(div().text_size(10.5).text_color(t.dim).child(String(g.items.length)));
        out.push(this.decorateRow(t, kindRow, {
          rowKey: gFoldKey,
          entry: kindEntry,
          popoutId: `popout-specs-kind-${g.kind}`,
        }));
        if (!openKind) continue;

        const namespaces = [...new Set(g.items.map((s) => specNamespaceOf(s)))];
        const multiNs = namespaces.length > 1;
        // A kind's specs show SIDEBAR_ROW_CAP rows across its namespaces; the rest are behind a "more" row that opens the Specs page.
        let drawnSpecs = 0, cappedSpecs = 0;
        for (const ns of namespaces) {
          const nsItems = g.items.filter((s) => specNamespaceOf(s) === ns);
          if (drawnSpecs >= SIDEBAR_ROW_CAP) { cappedSpecs += nsItems.length; continue; }
          const nsKey = `specs:ns:${g.kind}:${ns}`;
          const openNs = multiNs ? branchFoldOpen(folds, nsKey, true) : true;
          if (multiNs) {
            const nsEntry = { section: "specs", kindFilter: g.kind, namespace: ns, name: ns };
            this.visibleTreeRows.push({ key: nsKey, foldKey: nsKey, expandable: true, isOpen: openNs, parentKey: gFoldKey, entry: nsEntry });
            const nsRow = h_flex().id(`specs-ns-${g.kind}-${ns}`).pl(treeIndent(2)).pr(8).h(20).gap(6).items_center().hover((s) => s.bg(t.hover))
              .on_click(() => this.selectRow(nsEntry, nsKey))
              .child(div().id(`specs-ns-fold-${g.kind}-${ns}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
                .on_click((_e, cx) => { cx.stop_propagation(); this.fold(nsKey, !openNs,[],stateConn); cx.notify(); })
                .child(svg(icon(openNs ? "chevron-down" : "chevron-right")).size(11)))
              .child(div().flex_1().truncate().text_size(11).text_color(t.muted).tooltip(String(ns??"")).child(ns))
              .child(div().text_size(10).text_color(t.dim).child(String(nsItems.length)));
            out.push(this.decorateRow(t, nsRow, { rowKey: nsKey, entry: nsEntry }));
          }
          if (!openNs) continue;
          const specGroupKey = `specs:${g.kind}:${ns}`;
          const orderedSpecs = orderSiblings(nsItems, specGroupKey, orderMap, (s) => s.id);
          const specSiblingIds = orderedSpecs.map((s) => s.id);
          const shownSpecs = orderedSpecs.slice(0, SIDEBAR_ROW_CAP - drawnSpecs);
          drawnSpecs += shownSpecs.length; cappedSpecs += orderedSpecs.length - shownSpecs.length;
          for (const s of shownSpecs) {
            const specEntry = { section: "specs", id: s.id, name: s.name };
            out.push(this.treeLeafRow(t, {
              id: `spec-${s.id}`,
              rowKey: `spec:${s.id}`,
              label: s.name,
              detail: s.version ? `v${s.version}` : (s.kind ?? ""),
              entry: specEntry,
              onRight: () => this.menu({ kind: "spec", conn: rowConn, id: s.id, name: s.name, sourcePath: s.sourcePath ?? null, orderGroupKey: specGroupKey }, 180),
              indent: treeIndent(multiNs ? 3 : 2),
              parentKey: multiNs ? nsKey : gFoldKey,
              groupKey: specGroupKey,
              itemId: s.id,
              siblingIds: specSiblingIds,
            }));
          }
        }
        // The Specs list with this kind open, never the kind header's entry: its name ("Pods") would be read as a spec name.
        if (cappedSpecs) out.push(this.moreRow(t, cx, { conn: rowConn, id: `sidebar-specs-more-${g.kind}`, parentKey: gFoldKey, entry: { section: "specs", kindFilter: g.kind }, indent: 2,
          label: `${cappedSpecs} more ${g.kind} spec${cappedSpecs === 1 ? "" : "s"}` }));
      }
    } else if (section === "scopes") {
      const folders = new Map((this.list(cx, '/api/slices'+(selectedProject?`?project=${encodeURIComponent(selectedProject)}`:'')).data?.slices ?? []).filter((x) => typeof x.slicePath === "string").map((x) => [x.slicePath.split(/[\\/]/).pop(), x.slicePath]));
      const missions = orderSiblings(d.missions ?? [], "scopes:missions", orderMap, (m) => m.mission);
      const missionIds = missions.map((m) => m.mission);
      // The sidebar shows SIDEBAR_ROW_CAP missions and SIDEBAR_ROW_CAP slices of each; "more" rows open the Scopes or mission page.
      for (const m of missions.slice(0, SIDEBAR_ROW_CAP)) {
        const mKey = `mission:${m.mission}`;
        const openMission = branchFoldOpen(folds, mKey, true);
        const context={mission:m.mission,project:selectedProject??d.project?.id,projectRoot:d.project?.root};
        const missionEntry = { section: "scopes", ...(context.project?{project:context.project}:{}), mission: m.mission, name: m.mission };
        this.visibleTreeRows.push({ key: mKey, foldKey: mKey, expandable: true, isOpen: openMission, parentKey: parentBranchKey, entry: missionEntry });
        const slices = Array.isArray(m.slices) ? m.slices : [];
        const mRow = h_flex().id(`mission-${m.mission}`).pl(treeIndent(1)).pr(8).h(22).gap(6).items_center().hover((s) => s.bg(t.hover))
          .on_click(() => this.selectRow(missionEntry, mKey))
          .on_mouse_down("right", () => this.menu({ kind: "mission", mission: m.mission, name: m.mission, orderGroupKey: `mission:${m.mission}:slices` }, 160, mKey))
          .child(div().id(`mission-fold-${m.mission}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); this.fold(mKey, !openMission,[],stateConn); cx.notify(); })
            .child(svg(icon(openMission ? "chevron-down" : "chevron-right")).size(11)))
          .child(div().flex_1().truncate().text_size(11.5).font_semibold().text_color(t.muted).tooltip(String(m.mission??"")).child(m.mission))
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
        const workflowGot=this.list(cx,workflowPath(context));
        const workflows=workflowView(workflowGot.data,context);
        const workflowGroup=`workflow-group:${context.project??''}:${m.mission}`,workflowOpen=branchFoldOpen(folds,workflowGroup,true);
        if(workflows.instances.length){
          const groupEntry={...missionEntry,missionTab:'workflows'};
          this.visibleTreeRows.push({key:workflowGroup,foldKey:workflowGroup,expandable:true,isOpen:workflowOpen,parentKey:mKey,entry:groupEntry});
          out.push(this.decorateRow(t,h_flex().id(`workflows-${m.mission}`).pl(treeIndent(2)).pr(8).h(22).gap(6).items_center().cursor_pointer()
            .on_click(()=>this.selectRow(groupEntry,workflowGroup))
            .child(div().w(12).on_click((_e,ctx)=>{ctx.stop_propagation();this.fold(workflowGroup,!workflowOpen,[],stateConn);ctx.notify();})
              .child(svg(icon(workflowOpen?'chevron-down':'chevron-right')).size(11).text_color(t.dim)))
            .child(div().flex_1().text_size(11.5).text_color(t.muted).child('Workflows'))
            .child(div().text_size(10.5).text_color(t.dim).child(String(workflows.instances.length))),{rowKey:workflowGroup,entry:groupEntry}));
          if(workflowOpen)for(const [index,wf] of workflows.instances.entries()){
            const key=`workflow:${context.project??''}:${m.mission}:${wf.id}`,expanded=branchFoldOpen(folds,key,true),entry=workflowEntry(context,wf);
            const rowTopology=this.feeds.length>1?(rowFeed?.data?.topology??[]):(this.data?.topology??[]);
            const menuTarget=owner=>{
              const found=resolveAskerSeat(owner,rowTopology,this.feeds.length>1?rowConn:null),s=found.seat;
              const ownerConn=s?.conn??rowConn;
              return {kind:'workflow',...(this.feeds.length>1&&rowConn?{conn:rowConn}:{}),id:wf.id,name:wf.title,ownerEntry:found.found?{section:'topology',kind:'seat',rig:s.rig,rigId:s.rigId,...(ownerConn?{conn:ownerConn}:{}),name:s.logicalId,session:s.session}:null};
            };
            const owners=[...new Set(wf.packets.map(p=>p.owner).filter(Boolean))];
            this.visibleTreeRows.push({key,foldKey:key,expandable:wf.packets.length>0,isOpen:expanded,parentKey:workflowGroup,entry});
            out.push(this.decorateRow(t,h_flex().id(`workflow-row-${m.mission}-${index}`).pl(treeIndent(3)).pr(8).h(22).gap(6).items_center().cursor_pointer()
              .on_click(()=>this.selectRow(entry,key)).on_mouse_down('right',()=>this.menu(menuTarget(owners.length===1?owners[0]:null),120))
              .child(div().w(12).when(wf.packets.length>0,el=>el.on_click((_e,ctx)=>{ctx.stop_propagation();this.fold(key,!expanded,[],stateConn);ctx.notify();})
                .child(svg(icon(expanded?'chevron-down':'chevron-right')).size(11).text_color(t.dim))))
              .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(wf.finished?t.dim:t.foreground).tooltip(String(wf.title??"")).child(wf.title))
              .child(div().text_size(10.5).text_color(t.dim).child(statusWord(wf.status,"workflow"))),{rowKey:key,entry}));
            if(expanded)for(const [pi,p] of wf.packets.entries())out.push(this.treeLeafRow(t,{
              id:`workflow-packet-${m.mission}-${index}-${pi}`,rowKey:`${key}:packet:${p.packet_id}`,
              label:`${workflowWord(p.step_id)}${typeof p.owner==='string'&&p.owner.trim()?' · '+workflowWord(p.owner):''}`,detail:relativeTimeText(p.latest_transition?.ts),
              entry:workflowEntry(context,wf,p),onRight:()=>this.menu(menuTarget(p.owner),120),indent:treeIndent(4),parentKey:key
            }));
          }
        }
        const sliceGroupKey = `mission:${m.mission}:slices`;
        const slicesOpen=branchFoldOpen(folds,sliceGroupKey,true);
        this.visibleTreeRows.push({key:sliceGroupKey,foldKey:sliceGroupKey,expandable:true,isOpen:slicesOpen,parentKey:mKey,entry:{...missionEntry,missionTab:'slices'}});
        out.push(this.decorateRow(t,h_flex().id(`slices-group-${m.mission}`).pl(treeIndent(2)).pr(8).h(22).gap(6).items_center().cursor_pointer()
          .on_click(()=>this.selectRow({...missionEntry,missionTab:'slices'},sliceGroupKey))
          .child(div().w(12).on_click((_e,ctx)=>{ctx.stop_propagation();this.fold(sliceGroupKey,!slicesOpen,[],stateConn);ctx.notify();})
            .child(svg(icon(slicesOpen?'chevron-down':'chevron-right')).size(11).text_color(t.dim)))
          .child(div().flex_1().text_size(11.5).text_color(t.muted).child('Slices')).child(div().text_size(10.5).text_color(t.dim).child(String(slices.length))),{rowKey:sliceGroupKey,entry:{...missionEntry,missionTab:'slices'}}));
        if(!slicesOpen)continue;
        const orderedSlices = orderSiblings(slices, sliceGroupKey, orderMap, (s) => s.dirName);
        const sliceIds = orderedSlices.map((s) => s.dirName);
        for (const s of orderedSlices.slice(0, SIDEBAR_ROW_CAP)) {
          const sliceEntry = { ...missionEntry, slice: s.dirName, name: s.displayName ?? s.dirName };
          out.push(this.treeLeafRow(t, {
            id: `slice-${m.mission}-${s.dirName}`,
            rowKey: `slice:${m.mission}/${s.dirName}`,
            label: s.displayName ?? s.dirName,
            detail: s.status ?? "",
            entry: sliceEntry,
            onRight: () => this.menu({ kind: "slice", conn: rowConn, mission: m.mission, slice: s.dirName, name: s.displayName ?? s.dirName, id: s.id, slicePath: folders.get(s.dirName) ?? null, orderGroupKey: sliceGroupKey }, 220),
            indent: treeIndent(3),
            parentKey: sliceGroupKey,
            groupKey: sliceGroupKey,
            itemId: s.dirName,
            siblingIds: sliceIds,
          }));
        }
        const moreSlices = orderedSlices.length - SIDEBAR_ROW_CAP;
        if (moreSlices > 0) out.push(this.moreRow(t, cx, { conn: rowConn, id: `sidebar-slices-more-${m.mission}`, parentKey: sliceGroupKey, entry: { ...missionEntry, missionTab: "slices" }, indent: 3,
          label: `${moreSlices} more slice${moreSlices === 1 ? "" : "s"}` }));
      }
      const moreMissions = missions.length - SIDEBAR_ROW_CAP;
      if (moreMissions > 0) out.push(this.moreRow(t, cx, { conn: rowConn, id: "sidebar-missions-more", parentKey: parentBranchKey,
        entry: { section: "scopes", ...(selectedProject ? { project: selectedProject } : {}) }, label: `${moreMissions} more mission${moreMissions === 1 ? "" : "s"}` }));
    } else if (section === "terminals") {
      const savedList = orderSiblings(d.saved ?? [], "terminals:saved", orderMap, (s) => s.id);
      const savedIds = savedList.map((s) => s.id);
      // SIDEBAR_ROW_CAP saved and derived views each; "more" rows open the Terminals page.
      for (const s of savedList.slice(0, SIDEBAR_ROW_CAP)) {
        const entry = { section: "terminals", view: `saved:${s.id}`, name: s.name ?? s.id };
        out.push(this.treeLeafRow(t, {
          id: `view-saved-${s.id}`,
          tooltip:workerViewDetails(Object.values(shared("rig.workerViews")??{}).find(v=>v.view===`saved:${s.id}`&&v.config?.daemonMachine===rowConfig?.daemonMachine&&rigOrigin(v.config?.daemonUrl)===rigOrigin(rowConfig?.daemonUrl)))||null,
          rowKey: `view:saved:${s.id}`,
          label: s.name ?? s.id,
          detail: "saved",
          entry,
          indent: treeIndent(1),
          parentKey: parentBranchKey,
          onRight: () => this.menu({ kind: "terminal", conn: rowConn, view: entry.view, name: entry.name, orderGroupKey: "terminals:saved" }, 140),
          groupKey: "terminals:saved",
          itemId: s.id,
          siblingIds: savedIds,
        }));
      }
      if (savedList.length > SIDEBAR_ROW_CAP) out.push(this.moreRow(t, cx, { conn: rowConn, id: "sidebar-saved-views-more", parentKey: parentBranchKey, entry: { section: "terminals" },
        label: `${savedList.length - SIDEBAR_ROW_CAP} more saved view${savedList.length - SIDEBAR_ROW_CAP === 1 ? "" : "s"}` }));
      const derivedList = orderSiblings(d.rigs ?? [], "terminals:derived", orderMap, (r) => r);
      for (const r of derivedList.slice(0, SIDEBAR_ROW_CAP)) {
        const entry = { section: "terminals", view: `rig:${r}`, name: `rig:${r}` };
        out.push(this.treeLeafRow(t, {
          id: `view-rig-${r}`,
          tooltip:workerViewDetails(Object.values(shared("rig.workerViews")??{}).find(v=>v.view===`rig:${r}`&&v.config?.daemonMachine===rowConfig?.daemonMachine&&rigOrigin(v.config?.daemonUrl)===rigOrigin(rowConfig?.daemonUrl)))||null,
          rowKey: `view:rig:${r}`,
          label: `rig:${r}`,
          detail: "derived",
          entry,
          indent: treeIndent(1),
          parentKey: parentBranchKey,
          onRight: () => this.menu({ kind: "terminal", conn: rowConn, rig: r, view: entry.view, name: entry.name, orderGroupKey: "terminals:derived" }, 140),
          groupKey: "terminals:derived",
          itemId: r,
          siblingIds: derivedList,
        }));
      }
      if (derivedList.length > SIDEBAR_ROW_CAP) out.push(this.moreRow(t, cx, { conn: rowConn, id: "sidebar-rig-views-more", parentKey: parentBranchKey, entry: { section: "terminals" },
        label: `${derivedList.length - SIDEBAR_ROW_CAP} more rig view${derivedList.length - SIDEBAR_ROW_CAP === 1 ? "" : "s"}` }));
    } else if (section === "needs") {
      const perspective = d.perspective ?? this.data?.attentionPerspective ?? null;
      const whoseLine = whoseQueueSummary(perspective, this.config);
      if (whoseLine?.headline) {
        out.push(div().id("sidebar-needs-whose").px(18).py(2).text_size(10.5).text_color(t.dim).child(whoseLine.headline));
      }
      for (const f of !this.viewFeed && this.feeds.length > 1 ? this.feeds : [rowFeed]) {
        const note = this.slowAttentionNote(f), where = this.toastWhere(f);
        if (note) out.push(div().id(`sidebar-needs-slow-${f.id ?? "primary"}`).px(18).py(2).text_size(10.5).text_color(t.dim).child(where ? `${where}: ${note}` : note));
      }
      // Every request and update as a target, without the dismissed ones, sorted: made again only when the items, the enriched items or the
      // dismissals change (the records change in place, so their keys and restored marks are part of what is compared).
      const rawItems = this.sidebarNeedsItems(rowFeed, d.items ?? [], !this.viewFeed && this.feeds.length > 1);
      const orderedNeeds = orderSiblings(rawItems, "needs:items", orderMap, (n) => n.id);
      const needIds = orderedNeeds.map((n) => n.id);
      const requestCount = orderedNeeds.filter((n) => !n.update && !n.criticalHealth).length;
      let drawnRequests = 0;
      for (const n of orderedNeeds) {
        if (n.criticalHealth) {
          const entry = { section: "system", subview: "health", ...(n.conn ? { conn: n.conn } : {}) };
          out.push(this.treeLeafRow(t, { id: `need-${n.id}`, rowKey: `need:${n.id}`, label: `Critical: ${n.summary} · System → Health`,
            entry, indent: treeIndent(1), parentKey: parentBranchKey }));
          continue;
        }
        if (n.update) continue;
        if (drawnRequests >= SIDEBAR_ROW_CAP) continue; // the rest are behind the "more requests" row
        drawnRequests++;
        const entry = { section: "needs", id: n.id, name: n.summary, ...(n.conn ? { conn: n.conn } : {}) };
        const tier = n.tier ?? tierOf(n);
        const rowId = `need-${n.id}`;
        const rowKey = `need:${n.id}`;
        this.visibleTreeRows.push({ key: rowKey, expandable: false, parentKey: parentBranchKey, entry });
        if (!n.update) {
          const headline = requestHeadline(n);
          const assistant=assistantForNeed(n,this.rosterOf(n.conn));
          const owner = n.reply === "resolve" ? n.waiting?.owner ?? n.destinationSession : assistant?assistantOwner(assistant):n.asker ?? n.sourceSession;
          const mins = Math.max(0, Math.floor((Date.now() - (Date.parse(n.at ?? "") || Date.now())) / 60000));
          // With more than one OpenRig each request says which machine it is on.
          const needWhere = null; // one connection is drawn
          const needSub = `${owner ?? "OpenRig"}${needWhere ? ` · ${needWhere}` : ""} · ${mins < 1 ? "<1m" : `${mins}m`}`;
          const rowEl = h_flex().id(rowId).pl(treeIndent(1)).pr(8).h(40).gap(6).items_center().hover(s => s.bg(t.hover))
            .on_click(() => this.openPage({ ...entry, name: headline }, rowKey)).on_mouse_down("right", () => this.menu(n, 320, rowKey))
            .child(this.requestRowMark(t, tier))
            .child(v_flex().flex_1().min_w(0).gap(2)
              .child(div().truncate().text_size(12).text_color(t.foreground).tooltip(headline).child(headline))
              .child(div().truncate().text_size(11).text_color(t.dim).tooltip(needSub).child(needSub)));
          out.push(this.decorateRow(t, rowEl, { rowKey, entry: { ...entry, name: headline }, popoutId: `popout-${rowId}`, groupKey: "needs:items", itemId: n.id, siblingIds: needIds, height: 40 }));
          continue;
        }
      }
      if (requestCount > SIDEBAR_ROW_CAP) out.push(this.moreNeedsRow(t, cx, { id: "sidebar-requests-more", parentKey: parentBranchKey, tab: "requests",
        conn: orderedNeeds.find((n) => !n.update)?.conn ?? null, label: `${requestCount - SIDEBAR_ROW_CAP} more request${requestCount - SIDEBAR_ROW_CAP === 1 ? "" : "s"}` }));
      out.push(...this.sidebarUpdates(t, cx, orderedNeeds.filter((n) => n.update)));
      if (!orderedNeeds.length && !this.dismissalModel()?.hidden().length) {
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
    if (got.error) out.push(div().px(18).py(4).text_size(10.5).text_color(t.dim).child(asOf(got.at,this.uiTimezone)));
    return out;
  }

  /** Render the single 6-branch collapsible Explorer tree (`Topology`, `Specs`, `Scopes`, `Terminals`, `Needs`, `System`). */
  treeRows(t, cx) {
    const stateConn=this.sidebarConnection();
    this.treeStateConn=stateConn;
    this.visibleTreeRows = [];
    this.stickyTopologySpecs = new Map();
    this.reorderRows = new Map();
    const folds = this.viewState("rig.open.sidebar") ?? {};
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
          ? Boolean((this.visibleNeedsCount() ?? this.data?.attention ?? 0) > 0)
          : false;
      const openBranch = branchFoldOpen(folds, bKey, defaultOpen);

      if (section === "topology") {
        out.push(this.branchHeader(t, cx, "topology", {
          openBranch,
          countBadge: this.data?.topology?.length ?? 0,
          extraRight: h_flex().id("rig-topology-sort").px(3).gap(3).items_center().text_size(10).text_color(t.dim).cursor_pointer()
            .tooltip(this.viewState("rig.topology.view") === "rig" ? "By rig · switch to Priority" : "Priority · switch to By rig")
            .on_click((_e, cx) => { cx.stop_propagation(); this.setViewState("rig.topology.view", this.viewState("rig.topology.view",stateConn) === "rig" ? "priority" : "rig",stateConn); this.persistSidebarState(); cx.notify(); })
            .child(svg(icon(this.viewState("rig.topology.view") === "rig" ? "layers" : "clock")).size(11))
            .child(this.viewState("rig.topology.view") === "rig" ? "By rig" : "Priority"),
          siblingIds: orderedSections,
        }));
        if (openBranch) {
          out.push(...(this.viewState("rig.topology.view") === "rig" ? this.topologyRows(t, cx) : this.priorityView(t, cx)));
        }
      } else if (section === "needs") {
        const needsCount = this.requestCountOf(this.data?.topology, this.data?.attentionItems);
        const quietChip = this.data?.quietModeChip ?? null;
        const quietChipEl = quietChip?.label
          ? h_flex().id("rig-quiet-mode-chip").px(5).h(18).gap(4).rounded(4).items_center().cursor_pointer()
              .bg(t.raised).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
              .when(Boolean(quietChip.tooltip), (d) => d.tooltip(quietChip.tooltip))
              .on_click((_e, cx) => {
                cx.stop_propagation();
                this.openPage({ section: "system", subview: "people", name: "People" }, "sys:people");
                cx.notify();
              })
              .when(quietChip.kind === "quiet", (d) => d.child(svg(icon("rig-moon")).size(10).flex_none()))
              .child(div().max_w(110).truncate().text_size(10.5).tooltip(String(quietChip.label ?? quietChip.shortLabel ?? "")).child(quietChip.shortLabel ?? quietChip.label))
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
        const healthGot = Array.isArray(this.data?.health) ? { data: { records: this.data.health } } : this.list(cx, "/api/health");
        const chipRecords = healthGot.data?.status === "unknown" || healthGot.data?.state === "unknown" ? null : healthGot.data !== undefined
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
        const chipEl = chip.label ? div().id("sidebar-system-chip").px(6).py(1).rounded(4).bg(chipBg).text_size(10.5).text_color(chipColor).tooltip(chip.tooltip ?? "").child(chip.label) : null;
        out.push(this.branchHeader(t, cx, "system", {
          openBranch,
          extraRight: chipEl,
          siblingIds: orderedSections,
        }));
        if (openBranch) {
          out.push(...this.sectionBranchChildren(t, cx, "system"));
        }
      } else {
        const project=section==='scopes'?this.scopesProject(cx):null;
        const path = { specs: "/api/specs/library", scopes: '/api/scopes?counts=1'+(project?`&project=${encodeURIComponent(project)}`:''), terminals: "/api/terminal/views" }[section];
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

    // A herdr:// connection whose helper approval is missing or stale: "Approve helper on <machine>…" opens the machine's review (offered with the
    // switch only). The first connection's sits inside its refresh-error notice as the notice's action line; another connection's below it.
    const approveLink = (feed) => this.approveHelperLink(t, feed);
    const approving = this.feeds.filter((f) => this.offersApproval(f));
    if (this.error) {
      const block = errorBlock(this,t,"sidebar-refresh-error",this.error+this.retryNote(),{prefix:`${asOf(this.data.at,this.uiTimezone)} · ${STATE_COPY.S3.headline} · `});
      out.push(approving.includes(this.primary) ? block.child(approveLink(this.primary)) : block);
    }
    for (const feed of approving.filter((f) => f !== this.primary || !this.error)) out.push(approveLink(feed));
    return out;
  }

  scrollRow(el, key, height = null, parentKey = null) {
    if (key) {
      this.scrollRowKeys ??= new WeakMap();
      this.scrollRowKeys.set(el, key);
    }
    if (key || height !== null || parentKey !== null) {
      this.scrollRowMeta ??= new WeakMap();
      this.scrollRowMeta.set(el, { key: key ?? null, height, parentKey });
    }
    return el;
  }

  cancelTreeReveal() {
    this.cancelSidebarReveal?.();this.cancelSidebarReveal=null;this.keyRevealPending=false;
  }

  applySelectionRevealIndex(rawIndex) {
    if (!Number.isInteger(rawIndex) || rawIndex < 0) return -1;
    if (!Number.isFinite(this.listViewportHeight) || this.listViewportHeight <= 0) return rawIndex;
    const baseTop = Number.isFinite(this.revealBaseScrollTop) ? this.revealBaseScrollTop : this.listScrollTop;
    const { targetIndex, nextScrollTop } = revealTargetForSelection(this.scrollLayout, rawIndex, baseTop, this.listViewportHeight);
    this.listScrollTop = nextScrollTop;
    return targetIndex;
  }

  revealTreeSelection(cx) {
    this.cancelTreeReveal();
    if(!this.listScroll)return;
    this.keyRevealPending=true;this.renderRevealKey=null;
    this.revealBaseScrollTop=this.listScrollTop;
    this.cancelSidebarReveal=revealAfterKey(cx,this.listScroll,()=>{
      if(this.closed||!this.keyRevealPending)return -1;
      this.keyRevealPending=false;
      const rawIndex=this.scrollRowIndices?.get(this.viewState("rig.sel")?.key)??-1;
      return this.applySelectionRevealIndex(rawIndex);
    },this);
  }

  scrollChildren(content) {
    this.scrollRowIndices=new Map();
    this.noticeHeights ??= new Map();
    const measuredTokens = this.noticeHeightTokens = new Set();
    const layoutRows = [];
    const elements = content.map((el,i)=>{
      const meta = this.scrollRowMeta?.get(el);
      const key = meta?.key ?? this.scrollRowKeys?.get(el) ?? null;
      if(key)this.scrollRowIndices.set(key,i);
      const token = key ? `key:${key}` : `notice:${i}`;
      const fixedHeight = meta?.height ?? null;
      layoutRows.push({
        index: i,
        key,
        height: fixedHeight ?? (key ? null : this.noticeHeights.get(token) ?? null),
        parentKey: meta?.parentKey ?? null,
      });
      let row = div().id(`rig-scroll-row-${encodeURIComponent(token)}`).flex_none().w_full().child(el);
      if (!key && fixedHeight === null) {
        measuredTokens.add(token);
        row = row.on_size_change((size, cx) => {
          if (this.noticeHeightTokens !== measuredTokens) return; // a detached render cannot restore an obsolete measurement
          const zoom = Number(settings()?.zoom) || 1;
          const h = size.height / zoom;
          if (Math.abs((this.noticeHeights.get(token) ?? -1) - h) > 0.5) {
            this.noticeHeights.set(token, h);
            if ((this.listScrollTop ?? 0) > 0) cx.notify();
          }
        });
      }
      return row;
    });
    for (const token of this.noticeHeights.keys()) if (!measuredTokens.has(token)) this.noticeHeights.delete(token);
    this.scrollLayout = buildStickyScrollLayout(layoutRows, this.visibleTreeRows, this.stickyTopologySpecs);
    return elements;
  }

  /** From a draw (this sidebar's own call): one timer that makes connection `id`'s scroll handle while its feed exists. */
  ensureListScroll(cx, id) {
    if ((this.listScrollsPending ??= new Set()).has(id) || !cx?.timer?.after) return;
    this.listScrollsPending.add(id);
    cx.timer.after(0, (next) => {
      this.listScrollsPending.delete(id);
      if (this.closed || !this.feedList?.some((f) => f.id === id) || this.listScrolls?.get(id)) return;
      (this.listScrolls ??= new Map()).set(id, ScrollHandle.new());
      next?.notify?.();
    });
  }
  handleListScrollWheel(e, cx, connKey = this.scrollShown ?? "") {
    const dy = Number(e?.delta?.y) || 0;
    if (dy === 0) return;
    const zoom = Number(settings()?.zoom) || 1;
    const prev = this.listScrollTops?.get(connKey) ?? 0;
    const next = clampScrollTop(prev - dy / zoom, this.scrollLayout?.contentHeight ?? 0, this.listViewportHeight);
    (this.listScrollTops ??= new Map()).set(connKey, next);
    const sig = stickySignature(computeStickyTopology(this.scrollLayout, next, this.listViewportHeight));
    if (sig !== (this.renderedStickySignature ?? "")) {
      cx?.notify?.();
    }
  }

  renderStickyTopology(t, pinned) {
    if (!pinned?.length) {
      this.renderedStickySignature = "";
      return null;
    }
    this.renderedStickySignature = stickySignature(pinned);
    const connKey = this.scrollShown ?? "";
    const jumpTo = (spec, e, cx) => {
      cx?.stop_propagation?.();
      this.cancelTreeReveal();
      this.focusHandle?.focus?.();
      if ((e?.click_count ?? 1) >= 2 && spec.entry) {
        if (spec.entry.kind === "rig") this.openRigSpace(cx, spec.entry.rigId ?? spec.entry.name, null, null, null, null, spec.entry.conn ?? null);
        else this.openPage(spec.entry, spec.key);
        cx?.notify?.();
        return;
      }
      if (spec.entry) this.selectRow(spec.entry, spec.key);
      else this.setViewState("rig.sel", { key: spec.key, entry: null, at: Date.now() }, spec.stateConn);
      this.listScroll?.scroll_to_item(spec.rowIndex);
      const nextTop = nextScrollTopAfterReveal(this.scrollLayout, spec.rowIndex, this.listScrollTops?.get(connKey) ?? 0, this.listViewportHeight);
      (this.listScrollTops ??= new Map()).set(connKey, nextTop);
      cx?.notify?.();
    };
    const collapseSpec = (spec, cx) => {
      cx?.stop_propagation?.();
      this.cancelTreeReveal();
      this.focusHandle?.focus?.();
      this.fold(spec.foldKey, false, spec.seats ?? [], spec.stateConn);
      this.listScroll?.scroll_to_item(spec.rowIndex);
      const nextTop = nextScrollTopAfterReveal(this.scrollLayout, spec.rowIndex, this.listScrollTops?.get(connKey) ?? 0, this.listViewportHeight);
      (this.listScrollTops ??= new Map()).set(connKey, nextTop);
      cx?.notify?.();
    };
    const selKey = (this.renderMemo?.selRead ? this.renderMemo.sel : this.viewState("rig.sel"))?.key ?? null;
    const rows = pinned.map((spec) => {
      const isSelected = selKey === spec.key;
      if (spec.kind === "rig") {
        const { rig, stoppedRig, stale, views = [] } = spec;
        let row = h_flex().id(`sticky-row-${spec.key}`).pl(spec.indent).pr(8).h(24).gap(6).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
          .when(isSelected, (s) => s.bg(t.selection ?? `${t.accent}1f`).border_l(2).border_color(t.accent))
          .when(this.activeSpaceContext?.rigs?.some((name) => name === rig.name || name === rig.id), (s) => s.border_l(2).border_color(t.accent))
          .on_click((e, cx) => jumpTo(spec, e, cx));
        if (spec.onMenu) {
          row = row.on_mouse_down("right", (_e, cx) => { cx?.stop_propagation?.(); spec.onMenu(); });
        }
        return row
          .child(div().id(`sticky-fold-${spec.key}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => collapseSpec(spec, cx))
            .child(svg(icon("chevron-down")).size(11)))
          .child(div().flex_1().truncate().text_size(12.5).font_semibold().text_color(stale || stoppedRig ? t.dim : t.foreground).tooltip(String(rig.name ?? "")).child(rig.name))
          .when(stoppedRig, (el) => el.child(div().text_size(10.5).text_color(t.dim).child("stopped"))
            .child(div().id(`sticky-resume-${rig.id}`).px(5).h(18).rounded(4).bg(t.raised).flex().items_center().text_size(10.5).text_color(t.accent).hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => {
                cx.stop_propagation();
                this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: 380, props: { target: { kind: "rig", rig: rig.name, rigId: rig.id, conn: rig.conn, lifecycle: rig.lifecycle }, step: { action: "resume", confirm: true } } });
              }).child("Resume…")))
          .child(this.dot(t, rig.tone))
          .child(div().text_size(11).text_color(t.dim).child(`${rig.activeCount ?? 0}/${rig.seatCount}`))
          .when(views.length > 0, (el) => el.child(div().id(`sticky-views-${rig.id}`).px(4).rounded(4).text_size(11).text_color(t.muted).hover((s) => s.bg(t.raised))
            .on_click((_e, cx) => {
              cx.stop_propagation();
              if (views[0]?.id) selectWorkerView(views[0].id, { run, layout, views, spaces, panes });
            })
            .on_mouse_down("right", (_e, cx) => { cx?.stop_propagation?.(); this.menu({ kind: "views", rig: rig.name, rigId: rig.id, conn: rig.conn, views }); })
            .child(h_flex().gap(3).items_center().child(svg(icon("layers")).size(11)).child(String(views.length)))));
      }
      if (spec.kind === "priority") {
        return h_flex().id(`sticky-row-${spec.key}`).px(16).h(30).pt(8).gap(6).items_center().text_size(11).font_medium().cursor_pointer().hover((s) => s.bg(t.hover))
          .when(isSelected, (s) => s.bg(t.selection ?? `${t.accent}1f`).border_l(2).border_color(t.accent))
          .on_click((e, cx) => jumpTo(spec, e, cx))
          .child(div().text_color(t[spec.tone] ?? t.dim).child(spec.title))
          .child(div().text_color(t.dim).child(spec.count))
          .child(div().flex_1())
          .child(div().id(`sticky-fold-${spec.key}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => collapseSpec(spec, cx))
            .child(svg(icon("chevron-down")).size(11)));
      }
      let row = h_flex().id(`sticky-row-${spec.key}`).pl(spec.indent).pr(8).h(spec.height).gap(6).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
        .when(isSelected, (s) => s.bg(t.selection ?? `${t.accent}1f`).border_l(2).border_color(t.accent))
        .on_click((e, cx) => jumpTo(spec, e, cx));
      if (spec.onMenu) {
        row = row.on_mouse_down("right", (_e, cx) => { cx?.stop_propagation?.(); spec.onMenu(); });
      }
      return row
        .child(div().id(`sticky-fold-${spec.key}`).w(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => collapseSpec(spec, cx))
          .child(svg(icon("chevron-down")).size(11).flex_none()))
        .child(div().flex_1().truncate().text_size(spec.kind === "assistants" ? 12 : 11.5).when(spec.kind === "host" || spec.kind === "assistants", (el) => el.font_semibold()).text_color(t.muted).tooltip(String(spec.title ?? "")).child(spec.title))
        .when(Boolean(spec.count), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(spec.count)));
    });
    return v_flex().id("rig-sticky-topology").absolute().top(0).left(0).right(10).bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.cancelTreeReveal(); this.focusHandle?.focus?.(); })
      .on_mouse_up("left", (_e, cx) => { cx.stop_propagation(); this.cancelDrag(cx); })
      .on_mouse_down("right", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => cx.stop_propagation())
      .children(rows);
  }

  handleTreeKeyDown(e, cx) {
    const key = e?.key ?? "";
    const follow = this.feeds.length > 1 ? this.follow : null;
    if (follow) { // follow mode's picker: Alt+S opens it; while open the arrows move, Enter picks, Escape closes
      const lower = key.toLowerCase();
      if (e?.modifiers?.alt && lower === "s") { cx?.stop_propagation?.(); follow.pickerOpen = !follow.pickerOpen; follow.pickerIndex = Math.max(0, this.feeds.findIndex((f) => f.id === follow.shownId)); cx?.notify?.(); return; }
      if (follow.pickerOpen) {
        cx?.stop_propagation?.();
        if (["escape", "esc"].includes(lower)) follow.pickerOpen = false;
        else if (lower === "up" || lower === "arrowup") follow.pickerIndex = Math.max(0, follow.pickerIndex - 1);
        else if (lower === "down" || lower === "arrowdown") follow.pickerIndex = Math.min(this.feeds.length - 1, follow.pickerIndex + 1);
        else if (lower === "enter") { const feed = this.feeds[follow.pickerIndex]; if (feed) { this.followPick(feed.id, cx); return; } }
        cx?.notify?.(); return;
      }
    }
    if (["escape", "esc"].includes(key.toLowerCase()) && this.dragState) { cx?.stop_propagation?.(); this.cancelDrag(cx); return; }
    const stateConn=this.treeStateConn??this.sidebarConnection();
    const sel = this.viewState("rig.sel",stateConn);
    const selectedUpdate = this.visibleTreeRows.find((row) => row.key === sel?.key)?.update;
    if (key.toLowerCase() === "delete" && dismissible(selectedUpdate)) {
      cx?.stop_propagation?.();
      const feed = this.exactFeed(stateConn) ?? this.followedFeed();
      this.sidebarUpdateAction("dismiss", selectedUpdate, dismissalScope(feed.config));
      cx?.notify?.();
      return;
    }
    const act = treeKeyNav(this.visibleTreeRows, sel?.key ?? null, key, { openMap: this.viewState("rig.open.sidebar",stateConn) ?? {}, shift: Boolean(e.modifiers?.shift) });
    if (!act) return;
    if (act.type === "menu" && this.reorderRows?.has(act.key)) { this.menu({ kind: "sidebar-row", rowKind: act.row?.entry?.kind ?? "row", name: act.row?.entry?.name }, 320, act.key); return; }
    if (act.type === "move") {
      if(act.key===sel?.key)return;
      this.setViewState("rig.sel", { key: act.key, entry: act.row?.entry ?? null, at: Date.now() },stateConn);
      this.revealTreeSelection(cx);
      cx?.notify?.();
    } else if (act.type === "expand") {
      this.fold(act.foldKey, true,[],this.treeStateConn);
      cx?.notify?.();
    } else if (act.type === "collapse") {
      this.fold(act.foldKey, false,[],this.treeStateConn);
      cx?.notify?.();
    } else if (act.type === "activate") {
      const row = this.visibleTreeRows.find((r) => r.key === act.key);
      if (row?.priorityRow) { this.openPriority(row.priorityRow); cx?.notify?.(); return; }
      if (row?.helper) { run("terminal.peek", { terminal: row.helper.address }); return; }
      if (act.entry) {
        if (act.entry.kind === "rig") this.openRigSpace(cx, act.entry.rigId ?? act.entry.name, null, null, null, null, act.entry.conn ?? null);
        else this.openPage(act.entry, act.key);
        cx?.notify?.();
      }
    }
  }

  rail(t) {
    const stateConn=this.sidebarConnection();
    const rows = this.priorityRows();
    const needs = this.requestCountOf(this.data?.topology, this.data?.attentionItems);
    return v_flex().size_full().items_center().py(6).gap(8).bg(t.chrome)
      .child(div().id("rig-rail-needs").size(22).rounded(6).flex().items_center().justify_center().text_size(10.5).font_bold()
        .bg(needs ? t.blocked + "26" : "#00000000").text_color(needs ? t.blocked : t.dim)
        .on_click((_e, cx) => this.revealPriorityNeeds(cx,stateConn)).child(needs ? String(needs) : "·"))
      .children((this.data?.topology ?? []).map((rig) => div().id(`rig-rail-${rig.id}`).w(28).h(36).rounded(6).flex().items_center().justify_center()
        .bg(t.raised).text_size(11).font_semibold().text_color(t.foreground).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.openRigSpace(cx, rig.id, null, null, null, null, rig.conn ?? null))
        .on_mouse_down("right", () => this.menu({ kind: "rig", rig: rig.name, rigId: rig.id, conn: rig.conn, lifecycle: rig.lifecycle }))
        .tooltip(`${rig.name}${rows.some((r) => r.rig?.id === rig.id && r.rank === 4) ? " · Needs you" : ""}`)
        .child(v_flex().items_center().gap(2).child(div().child(rig.name.slice(0, 2)))
          .child(needsMark({ div, svg }, t, rows.find((r) => r.rig?.id === rig.id)?.mark ?? rig.tone, true, icon)))));
  }

  /** The sidebar draws ONE connection (follow mode, v0.5.0 PR 2b): everything it reads while drawing (`config`, `data`, `error`, `lists`, ...) is the followed feed's. With one connection
   *  nothing is swapped and the draw is what it always was. Clicks run later, outside the draw, and read the sidebar's own (first) connection as before. */
  render(cx) {
    // One read of herdr's lists for the whole render, the follow rule's included.
    this.renderMemo = { selRead: false, sel: undefined, nav: undefined, siblingStrings: new WeakMap(),healthDrawn:new Set() };
    // Everything after the memo opens is inside one try: whatever throws (the follow rule, a publish), the memo and the drawn feed are cleared.
    try {
    const shown = this.followFeed(cx);
    // The drawn box's scroll handle is made through a timer this draw sets (Herdr refuses native allocation while a view renders): ensureListScroll.
    // `scrollShown` stays the box drawn last, so a resize outside the draw replaces that box's handle.
    this.viewFeed = shown; this.scrollShown = shown && shown !== this.primary ? shown.id : undefined;
    if (this.scrollShown && !this.listScrolls?.get(this.scrollShown)) this.ensureListScroll(cx, this.scrollShown);
    this.drawnConnId = shown?.id ?? null; // the box this frame shows: a click lands on a frame, so it acts for this box even when the follow state moved on before the next draw
    // Other mods (the palette) open a section page on the box this sidebar follows: published when it changes, and only with several connections.
    const followedId = shown?.id ?? null;
    if (followedId !== (this.publishedFollowed ?? null)) { this.publishedFollowed = followedId; setShared("rig.followed", followedId); }
    const result=this.renderShown(cx);
    this.healthDrawn=this.renderMemo.healthDrawn;
    const healthSpace=this.hostLists().spaces.find(s=>s?.active),healthTab=healthSpace?.tabs?.find(t=>t.active)??(healthSpace?.tabs?.length===1?healthSpace.tabs[0]:null);
    this.healthDrawScope={space:healthSpace?.id,tab:healthTab?.id};
    return result;
    } finally { this.viewFeed = null; this.renderMemo = null; }
  }

  /** Whether `machine` already has a configured OpenRig connection (in the primary config, its connections list, or an active feed). */
  hasConfiguredMachine(machine) {
    if (!machine) return false;
    const base = this.primary.config;
    if ((base?.daemonMachine ?? null) === machine) return true;
    if ((base?.connections ?? []).some((c) => (c?.machine ?? c?.daemonMachine ?? null) === machine)) return true;
    return this.feeds.some((f) => (f.config?.daemonMachine ?? null) === machine);
  }

  /** Which feed the sidebar shows now, or null with one connection. See rig-follow.js for the rule; a change of box is applied after 150 ms so a fast run through spaces draws once. */
  followFeed(cx) {
    const feeds = this.feeds;
    const follow = (this.follow ??= { shownId: null, last: null, pinned: null, pending: null, hint: null, dismissed: new Set(), pickerOpen: false, pickerIndex: 0 });
    if (feeds.length < 2) {
      follow.shownId = null; follow.last = null; follow.pinned = null; follow.pending = null; follow.pickerOpen = false;
      if (!this.primary.config || this.primary.config.configInvalid) { follow.hint = null; return null; }
      // One connection has no follow mode (nothing to switch between), but a shown space on a machine with NO connection still gets the offer to add it:
      // the same rule as with several (a plain machine other than any configured one; a Local space says nothing).
      const focus = focused(), space = focus ? this.hostLists().spaces.find((sp) => sp.id === focus.space) : undefined, machine = spaceMachine(space);
      follow.hint = feeds.length === 1 && machine !== undefined && machine !== null && !this.hasConfiguredMachine(machine) ? machine : null;
      return null;
    }
    const { connections, space, links } = this.followInputs();
    if (follow.pinned && space && follow.pinned.spaceId !== space.id) follow.pinned = null; // the next space switch ends the picker's choice
    const want = followedConnection({ connections, space, links, last: follow.last, pinned: follow.pinned });
    const apply = (id, hint) => { follow.shownId = id; follow.last = id; follow.hint = hint; follow.pending = null; };
    if (!connections.some((c) => c.id === follow.shownId)) apply(want.id, want.hint); // first draw, or the shown connection was removed: no debounce
    else if (want.why === "pinned" || want.id === follow.shownId) { apply(want.id, want.hint); } // the person's own pick is immediate; the same box just refreshes the hint
    else if (follow.pending?.id !== want.id) {
      const pending = follow.pending = { id: want.id };
      cx.timer.after(150, (next) => { if (follow.pending !== pending) return; apply(want.id, want.hint); (next ?? cx).notify(); });
    }
    return feeds.find((f) => f.id === follow.shownId) ?? this.primary;
  }

  /** What the follow rule reads: the connections (config order), the shown space (null focus: none) and the origins its rigs were made with. */
  followInputs() {
    const connections = this.feeds.map((f) => ({ id: f.id, machine: f.config?.daemonMachine ?? null, daemonUrl: f.config?.daemonUrl ?? null }));
    const focus = focused(), h = this.hostLists(), space = focus ? h.spaces.find((sp) => sp.id === focus.space) : undefined;
    // The shown space's own context (each space's is worked out from its own terminals and tabs alone), not every space's.
    const links = space ? openRigSpaceContext([space], h.terminals, h.panes, shared("rig.spaceState") ?? {}, MOD_IDS.view)[0]?.rigLinks ?? [] : [];
    return { connections, space, links };
  }

  /** The picker's choice: that box until the next space switch (the sidebar's own pick is immediate, never debounced). Picking the box the space would show anyway pins nothing. */
  followPick(id, cx) {
    const follow = this.follow; if (!follow) return;
    const { connections, space, links } = this.followInputs();
    follow.pickerOpen = false;
    const natural = followedConnection({ connections, space, links, last: follow.last, pinned: null }).id;
    follow.pinned = id !== natural ? { id, spaceId: space?.id ?? null } : null;
    this.followNow(cx);
  }

  /** Apply the rule now (the person's own action: a pick, or the pinned ✕). */
  followNow(cx) {
    const follow = this.follow; if (!follow) return;
    const { connections, space, links } = this.followInputs();
    const want = followedConnection({ connections, space, links, last: follow.last, pinned: follow.pinned });
    follow.shownId = want.id; follow.last = want.id; follow.hint = want.hint; follow.pending = null;
    cx.notify();
  }

  /** The header's title in follow mode: which box is shown, the picker's arrow, the count of needs elsewhere, and "pinned" while the picker's choice holds. Null with one connection. */
  followTitle(t) {
    const shown = this.viewFeed, follow = this.follow;
    if (!shown || !follow) return null;
    const label = shown.config?.daemonMachine ?? "this computer";
    const elsewhere = this.elsewhereNeeds(shown);
    const compact = this.compactFollowHeader();
    return h_flex().flex_1().min_w(0).gap(6).items_center()
      .child(h_flex().id("rig-follow-picker").min_w(86).gap(3).items_center().cursor_pointer().hover((s) => s.bg(t.hover)).rounded(4).px(3)
        .tooltip("Show another OpenRig")
        .on_click((_e, cx) => { cx.stop_propagation(); follow.pickerOpen = !follow.pickerOpen; follow.pickerIndex = Math.max(0, this.feeds.indexOf(shown)); cx.notify(); })
        .child(div().min_w(70).truncate().text_size(12).font_semibold().text_color(t.muted).child(compact ? label : `OpenRig · ${label}`))
        .child(div().text_size(10).text_color(t.dim).child("▾")))
      .when(elsewhere > 0, (el) => el.child(div().id("rig-follow-elsewhere").flex_none().text_size(10.5).text_color(t.dim).tooltip("Needs on your other OpenRigs")
        .child(h_flex().gap(3).items_center().child(div().id("rig-follow-elsewhere-mark").text_color(t.blocked).child(`◆ ${elsewhere}`)).when(!compact, el => el.child(div().child("elsewhere"))))))
      .when(Boolean(follow.pinned), (el) => el.child(h_flex().id("rig-follow-pinned").flex_none().gap(3).items_center().text_size(10.5).text_color(t.dim)
        .child(div().child("· pinned"))
        .child(div().id("rig-follow-unpin").px(2).cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Follow the shown space again")
          .on_click((_e, cx) => { cx.stop_propagation(); follow.pinned = null; this.followNow(cx); }).child("✕"))));
  }

  /** The needs on the OTHER connections that answer (a box that does not answer contributes nothing: the picker says so). */
  elsewhereNeeds(shown) { return this.feeds.filter((f) => f !== shown && f.data && !f.error).reduce((n, f) => n + this.requestCountOf(f.data.topology, f.data.attentionItems), 0); }

  /** The picker: one row per connection (a state dot, its machine, its needs, a check on the shown one), in config order. */
  followPicker(t) {
    const follow = this.follow, shown = this.viewFeed;
    if (!follow?.pickerOpen || !shown) return null;
    return v_flex().id("rig-follow-menu").mx(8).mb(4).p(4).gap(1).rounded(6).bg(t.raised).border_1().border_color(t.border)
      .children(this.feeds.map((feed, index) => {
        const answering = Boolean(feed.data) && !feed.error, label = feed.config?.daemonMachine ?? "this computer";
        const needs = answering ? this.requestCountOf(feed.data.topology, feed.data.attentionItems) : 0;
        return h_flex().id(`rig-follow-pick-${feed.id}`).px(6).h(24).gap(6).items_center().rounded(4).cursor_pointer().hover((s) => s.bg(t.hover))
          .when(follow.pickerIndex === index, (el) => el.bg(t.hover))
          .on_click((_e, cx) => { cx.stop_propagation(); this.followPick(feed.id, cx); })
          .child(div().size(6).flex_none().rounded(3).bg(answering ? t.working : t.dim))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(answering ? t.foreground : t.dim).child(label))
          .when(!answering, (el) => el.child(div().text_size(10.5).text_color(t.dim).child("not answering")))
          .when(needs > 0, (el) => el.child(div().text_size(10.5).text_color(t.blocked).child(`◆ ${needs}`)))
          .when(feed === shown, (el) => el.child(div().text_size(11).text_color(t.accent).child("✓")));
      }));
  }

  renderShown(cx) {
    if (this.workerViews) { const now = focused(); for (const feed of this.feeds) if (feed.config) this.workerViews.focusChanged(feed.config, now); } // each connection's own views
    const t = theme();
    this.observeDaemonMachines(cx);
    this.statusMotion.begin(JSON.stringify([this.config?.daemonUrl,this.viewState("rig.topology.view"),narrow()]),cx,{attention:this.data?.attentionItems,reducedMotion:this.config?.reducedMotion===true});
    const lists = this.hostLists(); // herdr's lists once for this render (hostLists)
    const active = lists.spaces.find(s => s.active);
    // Only the active space's context: each space's context is its own, and making all of them on every render cost about 8 ms with 30 spaces.
    this.activeSpaceContext = active ? openRigSpaceContext([active], lists.terminals, lists.panes, shared("rig.spaceState") ?? {}, MOD_IDS.view)[0] : undefined;
    const block = find(layout(), n => n.content?.mod === MOD_IDS.sidebar);
    // The OpenRig area keeps its size on every space: it folds only when the person folds Herdr's own block. An area an earlier version folded
    // to its header on a non-rig space is given its size back once.
    this.retireAutoFold(block);
    if (narrow()) {this.reorderRows = new Map();this.cancelTreeReveal();}
    if (narrow()) return this.rail(t); // the rail draws no space marks; the 1 s timer keeps them current meanwhile
    this.publishSpaceMarks(lists);
    const state = this.states(t);
    const content=this.listRows(t,cx,state);
    const scrollChildren=this.scrollChildren(content);
    if(this.keyRevealPending&&this.renderRevealKey!==this.viewState("rig.sel")?.key){
      const rawIndex=this.scrollRowIndices?.get(this.viewState("rig.sel")?.key);
      if(Number.isInteger(rawIndex)){this.listScroll?.scroll_to_item(this.applySelectionRevealIndex(rawIndex));this.renderRevealKey=this.viewState("rig.sel")?.key;}
    }
    this.listScrollTop = clampScrollTop(this.listScrollTop, this.scrollLayout?.contentHeight ?? 0, this.listViewportHeight);
    const pinnedTopology = state ? [] : computeStickyTopology(this.scrollLayout, this.listScrollTop, this.listViewportHeight);
    const stickyEl = this.renderStickyTopology(t, pinnedTopology);
    const scrollConnKey = this.scrollShown ?? "";
    let root = v_flex().id("rig-sidebar-root").size_full().bg(t.chrome).text_color(t.foreground)
      .on_mouse_up("left", (_e, ctx) => this.cancelDrag(ctx))
      .on_mouse_down("left", () => {this.cancelTreeReveal();this.focusHandle?.focus?.();})
      .on_key_down((e, cx) => this.handleTreeKeyDown(e,cx));
    if (this.focusHandle) root = root.track_focus(this.focusHandle);
    return root
      .child(this.header(t))
      .when(Boolean(this.followPicker(t)), (el) => el.child(this.followPicker(t)))
      .child(div().h(1).bg(t.border).mx(8))
      .child(div().id("rig-list-viewport").relative().flex_1().min_h(0)
        .on_scroll_wheel((e, cx) => this.handleListScrollWheel(e, cx, scrollConnKey))
        .child(v_flex().id("rig-list").size_full().overflow_y_scrollbar().py(4)
          .when(!!this.listScroll,el=>el.track_scroll(this.listScroll))
          .on_size_change((size,cx)=>{
            const zoom = Number(settings()?.zoom) || 1;
            const vh = size.height / zoom;
            const vhChanged = Math.abs((this.listViewportHeight ?? -1) - vh) > 0.5;
            if (vhChanged) this.listViewportHeight = vh;
            if(this.keyRevealPending){
              const rawIndex=this.scrollRowIndices?.get(this.viewState("rig.sel")?.key);
              if(Number.isInteger(rawIndex))this.listScroll?.scroll_to_item(this.applySelectionRevealIndex(rawIndex));
              cx.notify();
              return;
            }
            if (vhChanged) {
              const clamped = clampScrollTop(this.listScrollTop, this.scrollLayout?.contentHeight ?? 0, vh);
              this.listScrollTop = clamped;
              const sig = stickySignature(computeStickyTopology(this.scrollLayout, clamped, vh));
              if (sig !== (this.renderedStickySignature ?? "")) cx.notify();
            }
          })
          .children(scrollChildren))
        .when(Boolean(stickyEl), (el) => el.child(stickyEl)));
  }

  /** One probe per machine, started from the follow hint and never repeated by a redraw, a refresh or a loop: it asks Herdr's own machine list, and only
   *  a machine it lists as connected is run on. Only the person's "Find where OpenRig runs" asks again. */
  probeAddOffer(cx, machine, { rescan = false } = {}) {
    const all = (this.addOffers ??= new Map());
    if (all.has(machine) && !rescan) return;
    // Herdr lists a machine before it is ready: an answer taken then would be a false "nothing here". Probe once it is listed ready (this runs on every draw, so it starts then).
    if (!machines().some((m) => m.name === machine && m.layout === "ready")) return;
    cx.timer.after(0, (next) => {
      if(this.closed||(all.has(machine)&&!rescan))return;
      all.set(machine, { status: "looking" });
      next.spawn(async (cx) => {
      let offer = null, failure = null;
      try { offer = await offerForMachine({ ...this.attachHost(cx), exec: machineProbeExec(rawExec, machine) }, machine); }
      catch (e) { if (isCodeError(e)) failure = describeCodeError(e); } // what the machine does is "none"; herdrig's own error is said as that
      if (this.closed) return;
      all.set(machine, offer?.found ? { status: "found", offer } : failure ? { status: "error", message: failure } : { status: "none" });
      cx.notify();
      });
    });
  }

  /** The dialog that adds a machine: the person's own pick from Herdr's list ({target, session} is the record the gate pins). */
  openAddMachine(machine, picked) {
    this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 600, height: 680, props: { target: { kind: "machine" }, step: { action: "add-machine", machine, picked } } });
  }

  /** Follow mode: the shown space is on a box with no OpenRig connection. When OpenRig answers there, the hint offers to add it; otherwise it keeps the
   *  last box and says so, with a way to look again. [Not now] is remembered per machine until the person looks again. Dismissed per box. */
  followHint(t, cx) {
    const follow = this.follow, machine = follow?.hint, feed = this.viewFeed ?? (this.feeds.length === 1 ? this.primary : null);
    if (!feed || !this.primary.config || this.primary.config.configInvalid || !machine || this.hasConfiguredMachine(machine) || follow.dismissed.has(machine)) return null;
    this.probeAddOffer(cx, machine);
    const state = this.addOffers?.get(machine), declined = Boolean(shared("rig.spaceState")?.machineAddDeclined?.[machine]);
    const label = feed.config?.daemonMachine ?? "this computer";
    const box = v_flex().id("rig-follow-hint").mx(8).my(4).p(8).gap(5).rounded(6).bg(t.raised);
    if (state?.status === "looking") return box.child(div().id("rig-follow-hint-looking").text_size(11.5).text_color(t.muted).child(`Looking for OpenRig on ${machine}…`));
    if (state?.status === "found" && !declined) {
      const offer = state.offer, add = () => this.openAddMachine(machine, { target: offer.target, session: offer.session });
      return box
        .child(div().id("rig-add-offer-text").text_size(11.5).text_color(t.muted).child(`OpenRig also runs on ${machine}. Show its rigs here too?`))
        .child(h_flex().id("rig-add-offer-buttons").gap(8).min_w(0)
          .child(focusTarget(this, cx, "rig-add-offer-add", div().id("rig-add-offer-add").min_w(0).truncate().px(6).py(3).rounded(4).text_size(12).text_color(t.accent).cursor_pointer().tooltip(`Add ${machine}`),
            () => add(), el => el.underline().bg(t.hover))
            .child(`Add ${machine}…`))
          .child(focusTarget(this, cx, "rig-add-offer-not-now", div().id("rig-add-offer-not-now").flex_none().px(6).py(3).rounded(4).text_size(12).text_color(t.muted).cursor_pointer(),
            (cx) => this.declineAddOffer(cx, machine), el => el.underline().bg(t.hover))
            .child("Not now")));
    }
    return box
      .child(state?.status === "error" ? errorBlock(this,t,`machine-probe-error-${machine}`,state.message,{where:machine,prefix:`The sidebar still shows ${label}. `})
        : div().text_size(11.5).text_color(t.muted).child(`${machine} has no OpenRig connection here, so the sidebar still shows ${label}.`))
      .child(h_flex().gap(8).flex_wrap()
        .child(focusTarget(this, cx, "rig-follow-hint-find", div().id("rig-follow-hint-find").rounded(4).text_size(12).text_color(t.accent).cursor_pointer().child("Find where OpenRig runs"),
          (cx) => this.rescanAddOffer(cx, machine), el => el.underline().bg(t.hover)))
        .child(focusTarget(this, cx, "rig-follow-hint-dismiss", div().id("rig-follow-hint-dismiss").rounded(4).text_size(12).text_color(t.accent).cursor_pointer().child("Dismiss"),
          (cx) => { follow.dismissed.add(machine); cx.notify(); }, el => el.underline().bg(t.hover))));
  }

  declineAddOffer(cx, machine) {
    cx.spawn(async (cx) => {
      try { await this.saveSpaceState({ machineAddDeclined: { ...(shared("rig.spaceState")?.machineAddDeclined ?? {}), [machine]: true } }); }
      catch (error) { this.machineOfferError = errorDiagnostic(error); }
      cx.notify();
    });
  }

  /** "Find where OpenRig runs": forgets an earlier Not now for this machine and asks once more. */
  rescanAddOffer(cx, machine) {
    cx.spawn(async (cx) => {
      const declined = { ...(shared("rig.spaceState")?.machineAddDeclined ?? {}) };
      if (declined[machine]) { delete declined[machine]; try { await this.saveSpaceState({ machineAddDeclined: declined }); } catch (error) { this.machineOfferError = errorDiagnostic(error); } }
      this.probeAddOffer(cx, machine, { rescan: true });
      cx.notify();
    });
  }

  listRows(t,cx,state) {
    const out=[];
    if(this.spaceSyncError)out.push(errorBlock(this,t,"rig-space-sync-read-error",this.spaceSyncError));
    const ownCards = !this.viewFeed || this.viewFeed === this.primary; // the cards below act through the first connection: they are not drawn for another box
    const relocationHint = ownCards ? this.relocationHintFor(this.primary) : null;
    if (relocationHint?.error) out.push(errorBlock(this,t,"rig-relocation-read-error",relocationHint.error));
    if(ownCards&&this.machineChoiceAvailable)out.push(this.machineOfferCard(t,cx));
    const hint = this.followHint(t, cx); if (hint) out.push(hint);
    if(ownCards&&this.gridMoveResultHere())out.push(this.gridMoveReport(t));
    if(ownCards&&(this.migrationResultHere() || (needsTabMigration(this.activeSpaceContext,this.config)
          ||this.relocationRigHere())
          && !migrationChoice(shared("rig.spaceState"),this.config,this.activeSpaceContext?.id)))out.push(this.migrationCard(t));
    out.push(...Object.entries(shared("rig.viewerRefreshNotices")??{}).filter(([,notice])=>notice.conn==null||notice.conn===this.sidebarConnection()).map(([space,notice])=>v_flex()
      .id(`viewer-refresh-${space}`).mx(8).my(4).p(8).gap(5).rounded(6).bg(t.raised)
      .child(errorBlock(this,t,`viewer-refresh-notice-${space}`,notice.reason))
      .child(div().id(`dismiss-viewer-refresh-${space}`).text_size(12).text_color(t.accent).cursor_pointer().child("Dismiss")
        .on_click((_e,cx)=>{const next={...(shared("rig.viewerRefreshNotices")??{})};delete next[space];setShared("rig.viewerRefreshNotices",next);cx.notify();}))));
    out.push(...(this.data?.topology ?? []).flatMap((rig) => {
          const statusKey = this.statusKey(rig);
          const status = shared("rig.spaceStatus")?.[statusKey];
          const rebuildEntry = this.gridSteps?.get(statusKey);
          const rigCfg = this.feedOf(rig.conn)?.config;
          const waitingConsent = this.isWaitingConsent(status, rigCfg);
          if (this.opening?.has(statusKey) || (rebuildEntry?.rebuilding && !waitingConsent)) {
            const rebuilding = !this.opening?.has(statusKey) && Boolean(rebuildEntry?.rebuilding);
            return [div().id(`opening-grid-${rig.id}`).mx(8).my(4).px(8).py(6).rounded(6).bg(t.raised).text_size(11.5).text_color(t.muted)
              .child(this.openingLine(rig, rebuildEntry?.step ?? null, rebuilding))];
          }
          if (status?.unconfirmedSpace) return [v_flex().id(`unconfirmed-space-${rig.id}`).mx(8).my(4).p(8).gap(5).rounded(6).bg(t.raised)
            .child(errorBlock(this,t,`rig-space-error-${rig.id}`,status.reason))
            .child(div().id(`dismiss-unconfirmed-${rig.id}`).text_size(12).text_color(t.accent).cursor_pointer().child("Dismiss")
              .on_click((_e, cx) => { const next = { ...(shared("rig.spaceStatus") ?? {}) }; delete next[this.statusKey(rig)]; setShared("rig.spaceStatus", next); cx.notify(); }))];
          if (status?.closeAvailable || status?.machineNotice || status?.preparationFailed || status?.interrupted) {
            const waitingMachine = status.needsConsent ? (status.confirmation?.machine ?? rigCfg?.daemonMachine ?? "the machine") : null;
            const approveHelper = (actCx = cx) => {
              const feed = this.exactFeed(rig.conn);
              if (!feed) { notify({ title: "Rig space", body: UNKNOWN_CONNECTION, level: "warning" }); return; }
              if (status.confirmation) this.reviewMachine(status, (resumeCx, approval) => this.openRigSpace(resumeCx, rig.id, null, approval, null, null, rig.conn), feed, rig.name);
              else this.openRigSpace(actCx, rig.id, null, null, null, null, rig.conn);
            };
            return [v_flex().id(`failed-grid-${rig.id}`).mx(8).my(4).p(8).gap(5).rounded(6).bg(t.raised)
            .child(div().text_size(11.5).text_color(t.muted).child(waitingMachine ? `${rig.name}: Waiting for you to approve the helper on ${waitingMachine}.` : errorBlock(this,t,`rig-space-status-${rig.id}`,status.reason,{prefix:`${rig.name}: `})))
            .when(!!status.needsConsent,el=>el.child(focusTarget(this,cx,`review-grid-machine-${statusKey}`,
              div().id(`review-grid-machine-${rig.id}`).px(6).py(3).rounded(4).text_size(12).text_color(t.accent).cursor_pointer(),
              (keyCx)=>approveHelper(keyCx),el=>el.underline().bg(t.hover)).child("Approve helper…")))
            .when(!!status.closeAvailable, el => el.child(div().id(`close-grid-${rig.id}`).text_size(12).text_color(t.accent).cursor_pointer()
              .on_click((_e, cx) => this.closeRigTiles(cx, rig)).child("Close all viewer tiles")))];
          }
          if (!status?.stale?.length) return [];
          return [v_flex().id(`stale-grid-${rig.id}`).mx(8).my(4).p(8).gap(5).rounded(6).bg(t.raised)
            .child(div().text_size(11.5).text_color(t.muted).child(status.recovery
              ? `${rig.name}'s grid lost ${status.stale.length} viewer${status.stale.length === 1 ? "" : "s"} when Herdr restarted (${status.stale.map((s) => this.gridSeatName(rig, s.seat)).join(", ")}); ${status.stale.length === 1 ? "that tile is a shell" : "those tiles are shells"} now.`
              : `${rig.name}: ${status.stale.map((s) => this.gridSeatName(rig, s.seat)).join(", ")} no longer runs the expected viewer. Save your work, close those panes yourself, then open the rig space again.`))
            .when(!!status.recovery, (el) => el.child(div().id(`rebuild-grid-${rig.id}`).text_size(12).text_color(t.accent).cursor_pointer()
              .on_click(() => this.reviewRigRebuild(rig, status)).child("Rebuild tiles…")))];
    }));
    out.push(...(state?[state]:this.treeRows(t,cx)));
    // A card that has nothing to say here answers null (the migration card for a space of another connection, once that box is picked): a null row is never drawn, the runtime's child() throws on it.
    return out.filter(Boolean);
  }
}

// The sidebar's connection state is its first (primary) feed's: with one OpenRig nothing else exists, and every existing read or write of
// `this.config`, `this.data`, ... is that feed's.
Object.defineProperty(RigSidebar.prototype, "primary", { get() { return (this.feedList ??= [new ConnectionFeed()])[0]; } });
Object.defineProperty(RigSidebar.prototype, "feeds", { get() { this.primary; return this.feedList; } });
// The send gate watches the primary's config: every assignment is seen at once (the class accessor above is replaced by the forwarding below, so the observer lives here).
// The getter reads the DRAWN feed's config (`viewFeed` is set only inside `render`, and cleared in its `finally`); the setter always writes the FIRST connection's (`primary`). Anything that reads or assigns
// `this.config` outside a draw means the first connection; do not read it after an await inside a draw path expecting the shown box's config.
Object.defineProperty(RigSidebar.prototype, "config", {
  get() { return (this.viewFeed ?? this.primary).config; },
  set(value) {
    this.primary.config = value;
    this.primary.id = value && !value.configInvalid ? (value.connectionId ?? value.connections?.[0]?.id ?? LEGACY_CONNECTION_ID) : null;
    observeConfig(value);
    syncRetainedOrigins(value); // a switched connection's old labels count as it
    this.herdr?.observe?.(value); // a changed connection forgets its prepared helper and event cursor
  },
  configurable: true,
});
for (const field of ["data", "error", "sidebarState", "cliVersion", "healthz", "live", "sock", "lists", "uiTimezone", "forceCapabilityProbe", "workerPreviewSupport", "refreshing", "again", "delay", "hadDisconnect"]) {
  Object.defineProperty(RigSidebar.prototype, field, { get() { return (this.viewFeed ?? this.primary)[field]; }, set(value) { this.primary[field] = value; }, configurable: true });
}
// With more than one connection `data` is the merged view: the primary's own data with every answering connection's rows and requests.
// A connection that fails contributes nothing (no last-known rows are shown as live). With one connection it is the feed's own object.
Object.defineProperty(RigSidebar.prototype, "data", {
  get() {
    if (this.viewFeed) return this.viewFeed.data; // follow mode: the drawn connection's own data, never the merged view
    const feeds = this.feeds;
    if (feeds.length < 2) return this.primary.data;
    const live = feeds.filter((f) => f.data && !f.error);
    const key = live.map((f) => f.data);
    if (this.mergedKey && this.mergedKey.length === key.length && this.mergedKey.every((d, i) => d === key[i]) && this.mergedFor === this.primary.data) return this.merged;
    const base = this.primary.data ?? (live[0]?.data ?? null);
    if (!base) return null;
    const topology = live.flatMap((f) => f.data.topology);
    const items = live.some((f) => Array.isArray(f.data.attentionItems)) ? live.flatMap((f) => f.data.attentionItems ?? []) : null;
    const nodesByRig = Object.create(null); for (const f of live) Object.assign(nodesByRig, f.data.nodesByRig);
    this.merged = { ...base, topology, attentionItems: items, attention: items ? needsRequestCount(topology, items) : base.attention,
      attentionHealth: live.flatMap((f) => f.data.attentionHealth ?? []), nodesByRig,
      connections: feeds.map((f) => ({ id: f.id, machine: f.config?.daemonMachine ?? null, answering: Boolean(f.data) && !f.error, error: f.error, needsApproval: f.needsApproval === true })) };
    this.mergedKey = key; this.mergedFor = this.primary.data;
    return this.merged;
  },
  set(value) { this.primary.data = value; },
  configurable: true,
});
// One scroll handle and tracked scroll offset per connection (follow mode): switching boxes returns each list where it was left. With one connection the handle is the one made in init.
Object.defineProperty(RigSidebar.prototype, "listScroll", {
  get() { return this.listScrolls?.get(this.scrollShown ?? ""); },
  set(value) { (this.listScrolls ??= new Map()).set(this.scrollShown ?? "", value); },
  configurable: true,
});
Object.defineProperty(RigSidebar.prototype, "listScrollTop", {
  get() { return this.listScrollTops?.get(this.scrollShown ?? "") ?? 0; },
  set(value) { (this.listScrollTops ??= new Map()).set(this.scrollShown ?? "", value); },
  configurable: true,
});
