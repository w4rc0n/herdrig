import { configWatchChanged } from "./rig-lib.js";
import { openRigSpaceContext, rigOrigin, sameDaemonOrigin, syncRetainedOrigins } from "./rig-space-context.js";
import {SeatTypingGuard} from './rig-typing-guard.js';
import {typingGuardState} from './rig-lib.js';
import { readInPlaceOpen, withoutInPlaceOpen, inPlaceFallbackNote, homeKey } from "./rig-routing.js";
import { followedConnection, spaceMachine } from "./rig-follow.js";
import {SeatCompaction,compactionRuntime,compactionVersion} from './rig-seat-compaction.js';
import { stampConnection, spaceStatusKey, adoptConnection, qualifyKey, connectionConfig, configOfConnection, connectionRows, targetConnection, UNKNOWN_CONNECTION, consentOf, consentText, LEGACY_CONNECTION_ID, addressParts, isCodeError, describeCodeError, connectionBoxLabel, formatHostId, commandFor, plainExecError, isKnownUnsentError, unsentErrorMessage,localConnectionMissing } from "./rig-connections.js";
import {workerViewDetails,workerMissingReason,TERMINAL_GONE_PLAN_REASON} from "./rig-worker-views.js";
import {migrateConnectionState,connectionIdentity} from './rig-connection-migration.js';
import { machineSetupReceiptLabel } from "./rig-machine-setup.js";
import { connectionBlocks, CONSENT_UNREADABLE } from "./rig-connections-view.js";
import { effectiveScopeProject, readScopeProject, writeScopeProject } from './rig-project.js';
import { workflowPath,workflowView } from './rig-workflow.js';
import { WorkflowPanel } from './rig-workflow-view.js';
import { asOf, focusTarget, releaseFocusTargets, liveFocus, needsYouText, needsYouWord } from './rig-lib.js';
import { formatAbsoluteTime, timezoneValue } from './rig-time.js';
import { canSkipReadAnswer } from './rig-read-content.js';
import { cleanAwayStates, readAwayState, restoreAwayStateMap, writeAwayState } from './rig-sidebar-view-state.js';
import {withFocusContext,focusHandleFor} from './rig-lib.js';
// OpenRig's Rig page: the on-demand inspection tab (`mod: "rig-view"`), showing what the
// sidebar, palette or a menu popped out. Navigation is a back stack in `shared("rig.nav")`; no layout write is needed to
// move. Reads with GET and local files. Writes run the CLI as the person: one-click actions through the Rig sidebar
// (rig-lib startOneClick), whose progress shows in this header's status line; a Needs-You reply here, inline.
//
// The sidebar is the single always-present OpenRig Explorer tree; this Page opens on demand as a native tab
// with separate Back, location/section menu, object tabs, page actions, Open in TUI, and ×. Navigating inside this Page never expands, collapses, or
// re-selects the sidebar tree (one-way sync: Sidebar → Page, never Page → Sidebar).
// Text files open in a viewer drawn like herdr's Files, with the same editor, font and colours.
// Needs-You: a request row expands in place to the request's words and a reply box (Answer or
// Resolve, Ctrl+Enter); the item page shows the same. Drafts are rig-menu's (`shared("rig.drafts")`, draftKey).
import { View, div, svg } from "gpui-kit";
import { sharedLoopbackDaemonUrl, sharedRigData, rigOperatorDisabled, stampRows, messageDialogSpace, rowsIdentityOf, RIG_DATA_STAMP } from "./rig-lib.js";
import { relativeTimeText, specRealpathAvailable, sameDaemon, listAddedMachine, requestFailed } from "./rig-lib.js";
import { counted, plainError, statusWord, errorDiagnostic } from "./rig-words.js";
import {activationPair} from './rig-activation.js';
import { errorBlock, errorNotice } from "./rig-error-view.js";

import { currentHealthRecords, healthCounts, healthForRig, groupHealthRecords, healthScopeTarget, healthQueueId, healthAge, validHealthQitemId, healthContextPercentage, classifyHealth, mergeHealthHistory } from "./rig-health.js";

import { filterAttentionHealth, isHealthAttention, saveStateFile, stateSaveFailure, terminalOutage, withTerminalOutage, TERMINAL_GONE_TOOLTIP, steadyHealthz, terminalOutageNotice, terminalServerRowText, terminalGoneSeatLine, TERMINAL_GONE_REASON, TERMINAL_GONE_SEND_NOTE, TERMINAL_GONE_RIG_REASON } from "./rig-lib.js";
import { h_flex, v_flex, TextView, Editor, EditorState, TextareaState, Textarea, HoverCard } from "gpui-base";
import { appHome, home, readTextFile, writeTextFile, theme, run as rawRun, exec as rawExec, props, shared, setShared as rawSetShared, settings, openOverlay as rawOpenOverlay, nextCommand, watchFolder, spaces, panes, terminals, hc as rawHc, layout, layouts, window, notify as rawNotify, machines } from "herdr";
const notify = value => errorNotice(rawNotify, value);
import { rigLayoutAppearance, rigLayoutCardState, rigLayoutCard, keepRigLayout, finishRigLayoutRestore, RESTORE_AFTER_MS, restoreLayoutOn } from "./rig-layout-notice.js";
import { installHerdrTransport } from "./rig-openrig-wire.js";
import { gatedFetch, gatedExec, gatedHc, gatedRun, gatedConnect, observeConfig, rethrowGate, gatedOperation, gatedOperationOrRefusal, numberedConfigReads, gateSameConfig } from "./rig-gate.js";
import {leaveOldStrip,hasOldProviderStrip,oldStripCleanupOwner,releaseOldStripCleanup,rememberOwnLayout} from './rig-old-views.js';
import {connectionCapabilities} from './rig-lib.js';
// THE SEND GATE (rig-gate.js): every request, CLI run, process-starting Herdr command and stream connection below goes through it, checked at send time.
// A read for one connection names that connection: with several, the gate refuses a bare request (it never defaults to the first OpenRig).
const fetchFor = (config) => (url, init) => gatedFetch(url, init, undefined, config?.connectionId);
// ONE counter for every page of this mod copy, like the gate it feeds (rig-gate.js is one per mod copy): a counter per page would let one page's older read re-open a connection another page's newer read removed.
const configReads = numberedConfigReads();
const exec = (command, args, options) => gatedExec(rawExec, command, args, options, undefined, undefined, appHome());
const hc = (args, bytes) => gatedHc(rawHc, args, bytes);
// A Rig sidebar command (`rig.<command>`) is sent only while the Rig sidebar is in the layout (rig-lib sidebarRun): without it,
// herdr would answer with a raw "unknown command" toast, so a person is told plainly and a background refresh is skipped.
const run = (name, args) => sidebarRun({ layout, notify }, (n, a) => gatedRun(rawRun, n, a), name, args);
const refreshSidebar = () => { if (layoutShowsMod(layout(), MOD_IDS.sidebar)) run("rig.refresh"); };
// A send for a CONNECTION names its gate scope (several OpenRigs: a bare sink refuses). `config` is that connection's own config: a page acts for the connection it shows.
const execFor = (config, operation = null) => (command, args, options) => gatedExec(rawExec, command, args, options, operation?.since, operation?.scope ?? config?.connectionId, appHome());
const hcFor = (config) => (args, bytes) => gatedHc(rawHc, args, bytes, undefined, config?.connectionId);
const runFor = (config) => (name, args) => sidebarRun({ layout, notify }, (n, a) => gatedRun(rawRun, n, a, config?.connectionId), name, args);

let flatOwner = null; // the view this mod copy is acting for
const setShared = rawSetShared; // several connections key their own state (qualifyKey); no flat-store guard
import { MOD_IDS, sidebarRun, sidebarRefusal, NO_PERSON, TERMINAL_TOKEN_PROTECTED, DECISION_TOKEN_PROTECTED, NETWORK_UNCONFIRMED_MESSAGE, parseConfig, sameConfig, preserveCliDiscoveredConfig, discoverDaemonFromCli, formatOpenRigVersionLine, personDisableReason, seatStatus, statusLook, needTarget, iconsAt, fileLanguage, fileEntry, transcriptPath, openOrFocusTui, labelledTui,
  configRows, crumbsFor, navPush, navBack, navKey, layoutHasMod, layoutShowsMod, startOneClick, qualifyBusyKey, writeCommand, cliRefusal, writeOutcome, peopleCliCommand, needDetailLines, needRecordedLines, draftKey, unsafeSpecWritePath, simpleHash, stripSecondaryEnterNewline,
  STATUS_MS, ERROR_STATUS_MS, hostOf, rigModel, statusCounts, rigFoldOpen, podFoldOpen, foldChoice, rigKey, podKey, orderRigs, seatClickTarget, seatTerminalIndex, worstTone,
  SLICE_FILES, MISSION_FILES, RIG_SECTIONS, SECTION_TITLES, RIG_TABS, currentCapabilities, capabilityDisableReason, capabilitiesSummaryDetail, capabilitiesSummaryRow,
  usagePercentBar, usageWindowTone, formatUsageRows, isUsageWindowsDisabled, normalizeUsageHosts, recentTransitionRows, singleLineText, computePulseCounts, matchesPulseFilter,
  isRigStopped, expandAllTopology, collapseAllTopology, normalizeTerminalPreview, statusMark, statusMarkElement, isTerminalSeat, rigTone, backTarget, entryTitle, treeKeyNav,
  rowStatusGlyph, formatHonestCount, attachToSeat, seatOrigin, seatSharedOf, SEAT_NAME_SHARED, rigOfConnection, requestMarkdownView, parkedWorkOwner, observeNeedDecision, attentionCoverage, requestCardText, requestHeadline, needsRowHeadline, needsRequestCount, isOpenNeed, providerSeatReason, seatRestartReason, escapedLines, sourceLines, openingRowChars, textLinesView, openingMoreText, TEXT_LINE_HEIGHT,
  tierOf, isUpdateNeed, tierStripFor, sortNeedsByTier, enrichAttentionItems, questionsState, submitMissionActions, missionActionPreflight, isDecisionAsk, resolveMissionVerb, formatSafeCloseConflict, sweepFinding, checkLabel, checkReason, checkSeat, needsCheckCount, sinceYouWereAwaySummary, quietModeHeaderChip, deadBindingNotice, whoseQueueSummary, resolveAskerSeat, parseSidebarState, serializeSidebarState,
  viewsPropsFromLayout, openOrFocusRigTab, rigPageOnScreen as rigPageOnScreenIn, closeRigInspection, selectWorkerView, openNeed, markStale, settleRead, formatStaleAge, attachRelayPath, waitWith, queueListPage,
  localSpecRoots, resolveInSpecRoots, specFolderRefusal, specCopyName, isLoopbackDaemonUrl, parseDaemonStatusJson, isValidSessionName, newRigOverlay } from "./rig-lib.js";
import { seatActivityDetails, seatActivityWords, seatQueuePaths, seatQueueDetails, seatUsageLimitWords } from "./rig-seat-details.js";
import { archivedElements, withArchivedHosts } from "./rig-archived.js";
import { dismissible, dismissalSnapshot, requestDismissal, updateKey, dismissalScope } from "./rig-dismiss.js";
import { HERDRIG_VERSION } from "./rig-version.js";
import { registerRigRouting, workerCapabilityText, tabPagesPush, tabPagesBack, tabPagesClose, tabPagesPrune } from "./rig-lib.js";
import { NowTailCache, nowTailPresentation } from "./rig-now.js";
import { RigGraph, GRAPH_EDGE_LOOK } from "./rig-graph.js";
import { pageBodyLayout } from "./rig-page-layout.js";
import {allSeatsView} from './rig-all-seats-view.js';
import {HostedMembersReader,assistantsForRig,assistantTarget,assistantWord,assistantSentence,assistantForNeed,assistantOwner,terminalAttention} from './rig-connected-assistants.js';
import {assistantGroup} from './rig-connected-assistants-view.js';
import { normalizeRunningGraph, runningGraphTopology, graphActivityOf } from "./rig-graph-state.js";
import { GraphWorkCache } from "./rig-graph-work.js";
import { pageViewKind, pageViewOptions, selectedPageView, entryWithPageView, compactLocationCrumbs, visiblePageTabs, pageSectionChoices } from "./rig-page-nav.js";
import { readRigSpecPreview, groupSpecLibrary, rowHeadline, rowTitle, rowTip, rowText, rowIdOnly } from "./rig-lib.js";
import { ConfigPanel } from "./rig-config-view.js";
import { RemoteSpecs, SPEC_SHA256 } from "./rig-spec-remote.js";
import { copyableSpecText, siblingFileNames, siblingFileNote } from "./rig-spec-copy.js";
import { detectMode, planMode, describeChange, isShippedLayout, shippedSpacesHasReveal, MODES, MODE_LABEL, BASE_HERDR } from "./rig-spaces-mode.js";
import { applySpacesMode, freeCopyName } from "./rig-spaces-apply.js";
import { copyBuiltinFolder, findExistingCopy, folderCopyable } from "./rig-spec-folder.js";

/** This folder, for its own icons: derived from `MOD_IDS.view` so a 1-line rename in `MOD_IDS` updates both cross-mod opens and icons. */
const ASSETS = `mods/${MOD_IDS.view}`;
const icon = iconsAt(ASSETS);

const STACK = "rig-work", PAGE = "rig-page";
// herdr gives a mod's render a fixed time budget; a Needs list draws one page of rows at a time, so its render stays the same size at any count.
const NEEDS_PAGE_ROWS = 50;
/** How recently the page must have seen its connection's sidebar refresh (rig.refreshed) for its own 5 s timer to leave re-reading to it. */
const SIDEBAR_FRESH_MS = 75_000;
/** Brief grace on unhide while the sidebar's catch-up refresh lands, so a page hidden > SIDEBAR_FRESH_MS does not double-fetch on frame 1. */
const HIDDEN_SIDEBAR_GRACE_MS = 10_000;
const windowHidden = () => window()?.visible === false;
/** Answers that land within this long of the last re-render share the next one (one frame at 60 Hz). */
const ANSWER_COALESCE_MS = 16;
const CONFIG = () => `${appHome()}/openrig/config.json`;

const nav = () => shared("rig.nav") ?? { stack: [] };
// With several OpenRigs each Rig tab shows only its OWN connection's pages (see RigView.shownEntry). A link clicked on a page belongs to the page
// that tab shows (`from`, the clicking view's own shown entry, via RigView.push), which may not be the shared stack's top.
function push(entry, from = null, sourceTab = null) {
  const shownTop = () => from ?? nav().stack?.at(-1);
  const shownBefore = shownTop(); // read before this push changes the stack: the page the link or tab was clicked on
  // One-way sync (Sidebar → Page, never Page → Sidebar). In-Page navigation only updates `shared("rig.nav")`
  // and never mutates the sidebar's `shared("rig.sel")`, `shared("rig.open.page")`, or `shared("rig.order")`.
  // v0.5.0: a link on a page belongs to that page's OpenRig. An entry that names no connection inherits the shown page's; one that names its own
  // keeps it. With one connection no page carries a `conn`, so nothing is added and the entry stays byte-identical.
  const shownConn = shownTop()?.conn;
  if (entry && typeof entry === "object" && entry.conn == null && shownConn) entry = { ...entry, conn: shownConn };
  if (entry?.section === "file" && !entry.from && from) entry = { ...entry, from: from.section === "file" ? from.from ?? null : from };
  if (entry && "focusRig" in entry) setShared("rig.focusRig", entry.focusRig ?? null);
  else if (shared("rig.focusRig")) setShared("rig.focusRig", null);
  setShared("rig.nav", navPush(nav(), entry));
  // A page that names no rig on this page's OpenRig, and a tab of the rig page on screen, are shown here (see openOrFocusRigTab); another rig's page
  // goes to that rig's own space if it has one. A page's own link or tab never makes a space.
  openOrFocusRigTab({ run, spaces, panes, layout, section: entry?.section ?? "topology", fromPage: true, fromEntry: shownBefore ?? null, ...(sourceTab ? { sourceTab } : {}) }, entry);
}
const rigPageOnScreen = () => rigPageOnScreenIn(spaces, panes);
/** Closes the inspection: closes or leaves the Rig tab or selects main on legacy rig-work stack. */
function closeInspection() {
  closeRigInspection({ shared, setShared, run, spaces, panes, layout, stackId: STACK, mainId: "main" });
}
/** A one-click write (snapshot, follow, open a view): the sidebar runs it; a dialog opens only when it fails. */
/** The Rig palette, started with text (Filter… starts it at the page's filter). */

/** Worker views and following state from shared("rig.views") or layout. */
const rigStack = () => (function find(n) { return !n || typeof n !== "object" ? null : n.id === STACK ? n : (n.children ?? []).map(find).find(Boolean) ?? null; })(layout());
const stripProps = () => viewsPropsFromLayout(layout(), shared);
const activeRigViewId = () => {
  const stackActive = rigStack()?.active;
  if (stackActive) return stackActive;
  const activeSpace = (spaces?.() ?? []).find((s) => s.active) ?? (spaces?.() ?? [])[0];
  const activeTab = (activeSpace?.tabs ?? []).find((t) => t.active);
  const title = String(activeTab?.title ?? "");
  for (const v of stripProps()?.views ?? []) {
    const vName = v.name ?? v.id?.replace(/^rig-view-/, "");
    if ((activeTab?.id && v.tabId === activeTab.id) || title === `Rig: ${vName}` || title.startsWith(`Rig: ${vName} (`) || title === v.title) {
      return v.id;
    }
  }
  return null;
};
// A health group lists this many findings until its "N more" row is opened (each finding draws a copy button).
const HEALTH_ROW_CAP = 20;
/** Folds (rigs, pods, health, edges, needs) are one model in `shared("rig.open.page")`, shared with the sidebar tree. */
const toggleOpen = (key, now, seats) => setShared("rig.open.page", seats ? foldChoice(shared("rig.open.page"), key, !now, seats) : { ...(shared("rig.open.page") ?? {}), [key]: !now });
const setOpen = (key, open) => setShared("rig.open.page", { ...(shared("rig.open.page") ?? {}), [key]: open });
const specDraftIdentity = config => config && [
  config.connectionId ?? LEGACY_CONNECTION_ID,
  ["cli", "default"].includes(config.daemonUrlSource) ? null : config.daemonUrl ?? null,
  config.daemonMachine ?? null, config.openrigHome ?? null, config.expectedHostId ?? null,
];
const specDraftKey = (id, config) => `spec-draft:${JSON.stringify([specDraftIdentity(config), id])}`;
const olderSpecDraftKey = (id, config) => {
  if (config === null) return `spec:no-connection:${id}`; // the page's connection is no longer set up: never another connection's key
  // The legacy connection's keys are the old ones (stored drafts stay found); another connection's carry its id.
  const own = config?.connectionId && config.connectionId !== LEGACY_CONNECTION_ID ? `${config.connectionId}:` : "";
  return config?.daemonMachine ? `remote-spec:${own}${encodeURIComponent(config.daemonUrl??"")}:${encodeURIComponent(config.daemonMachine)}:${id}` : `spec:${own}${id}`;
};
const setDraft = (key, draft) => {
  const all = { ...(shared("rig.drafts") ?? {}) };
  if (draft == null) delete all[key]; else all[key] = key.startsWith("spec-draft:") ? {...draft,at:Date.now()} : draft;
  setShared("rig.drafts", all);
};
const specDraft = raw => typeof raw === "string" ? { text: raw } : typeof raw?.text === "string" ? raw : null;
const inRigLayout = () => !!(function find(n) {
  return n && typeof n === "object" && (n.id === STACK || n.id === "rig-sidebar" || n.content?.mod === MOD_IDS.sidebar || (n.children ?? []).some(find));
})(layout());
const usd = (v) => typeof v === "number" ? `$${v.toFixed(2)}` : "—";

import {rigSpecLibraryPath, LAUNCH_DIALOG_HEIGHT} from "./rig-lib.js";
import {StatusMotion} from "./rig-status-motion.js";
/** How long a read may go unanswered before the page asks again. The mod runtime has no request timeout, so a lost answer (a tunnel gone half-open,
 *  a daemon stopped mid-request) would otherwise hold that path on skeletons for the life of the tab. Asking again does not give up on the older
 *  read: whichever answer comes back first is shown (a slow but live daemon still settles), and only an answer older than the one shown is dropped. */
const READ_LOST_MS = 30_000;
const seatStatusRead = path => /^\/api\/seat\/status\/[^/?]+$/.test(path);
/** The connection id of a page that names no OpenRig while several are set up: it matches none, so nothing is read or sent for it. */
const NO_PAGE_CONNECTION = "no-page-connection";

function filterAttentionItemsFor(self, rawItems, healthRecords = undefined) {
  if (!Array.isArray(rawItems)) return null;
  const cachedHealth = (self.cache ?? self.cacheFor?.(self.activeConnId?.()))?.["/api/health"];
  const records = healthRecords !== undefined ? healthRecords : (cachedHealth?.error ? null : cachedHealth?.data?.records ?? null);
  // The same filtered list until the items or the health records are read again: pages key their own per-read work on it.
  const memo = (self.healthFiltered ??= new WeakMap()), hit = memo.get(rawItems);
  const items = hit && hit.records === records ? hit.items : filterAttentionHealth(rawItems, records ?? []);
  if (!hit || hit.items !== items) memo.set(rawItems, { records, items });
  return items;
}

export default class RigView extends View {
  // The send gate watches this mod's config: every assignment (a reload, a test) is seen at once; null is a constructor's placeholder.
  get config() { return this._config; }
  set config(value) { this._config = value; observeConfig(value); syncRetainedOrigins(value); this.herdr?.observe?.(value); }
  /** Every overlay this instance opens is stamped with ITS OWN config (its rows were read under it), never the latest instance's. */
  open(spec) { return rawOpenOverlay(messageDialogSpace(stampRows(spec, rowsIdentityOf(this.config, spec?.props?.target?.conn)))); }
  /** A menu opened from this page acts for the page's own OpenRig (with several): a row that names its own box keeps it. */
  menu(target) {
    const own = (this.config?.connections ?? []).length > 1 ? this.activeConnId() : null;
    const stamped = target?.conn || !own || own === NO_PAGE_CONNECTION ? target : { ...target, conn: own };
    return this.open({ mod: MOD_IDS.menu, kind: "popup", width: 280, height: 320, props: { target: stamped } });
  }
  oneClick(target, action, actionKey = null) { return startOneClick({ shared, setShared, run, layout, openOverlay: (spec) => this.open(spec) }, target, action, actionKey); }
  palette(initial) { this.configPanel?.clearSelection();return this.open({ mod: MOD_IDS.palette, kind: "dialog", width: 560, height: 360, props: { initial } }); }
  time(value,options={}) { return formatAbsoluteTime(value,{timezone:this.uiTimezone,...options}); }
  init(p, cx) {
    // OpenRigs over Herdr's connection (herdr:// addresses): the page's reads go through the pinned helper on that machine.
    this.herdr = installHerdrTransport({ execFor: (scope) => execFor({ connectionId: scope }), hcFor: (scope) => hcFor({ connectionId: scope }), machines, appHome, readTextFile, writeTextFile, config: () => this.config,
      bridgePath: () => attachRelayPath(appHome(), MOD_IDS.view).replace(/rig-attach-relay\.cjs$/, "rig-openrig-transport.cjs") }, cx);
    const routingConfig = (conn) => conn && this.config ? (configOfConnection(this.config, conn) ?? { configInvalid: UNKNOWN_CONNECTION }) : this.config;
    registerRigRouting(cx, (context, conn) => { const cfg = routingConfig(conn); return { shared, setShared, run: runFor(cfg), spaces, panes, terminals, hc: hcFor(cfg), layout, notify, openOverlay:spec=>this.open(spec),config: cfg, currentConfig: () => routingConfig(conn), wait: waitWith(context) }; });
    this.statusMotion = new StatusMotion();
    this.pageViewMemory = {}; // Session only; never persisted with folds or navigation.
    this.pulseFilter = null; // Page-session only: never restore the legacy persisted shared filter.
    const hostProps = typeof props === "function" ? props() : null;
    const initProps = p && Object.keys(p).length > 0 ? p : (hostProps ?? p ?? null);
    this.initialEntry = initProps?.entry ?? null;
    this.initialConn = this.initialEntry?.conn ?? null;
    // The space this tab lives in. Herdrig names it in the tab's props when it makes the tab (`space`), and Herdr restores a tab with its
    // props (delivered through `herdr.props()`), so it holds after a restart. A tab made before that (or whose props space no longer exists)
    // takes the active space when it is DRAWN (render), never at init, because after a restart Herdr makes every restored tab's view while some other space is active.
    this.propsSpaceId = typeof initProps?.space === "string" && initProps.space ? initProps.space : null;
    try { this.ownSpace = this.propsSpaceId ? null : (spaces?.() ?? []).find((s) => s?.active) ?? null; } catch (_) { this.ownSpace = null; }
    this.config = null;
    this.resetNowTails(cx);
    this.cache = {}; // path → { data, error, at }
    this.files = {}; // file path → { state, error, text }
    this.present = {}; // file path → true | false (on disk)
    this.handle = cx.focus_handle();
    this.pagerHandles = Object.create(null);
    for (const k of ["needs", "updates", "dismissed"]) {
      this.pagerHandles[`${k}-page-previous`] = cx.focus_handle();
      this.pagerHandles[`${k}-page-next`] = cx.focus_handle();
    }
    this.replies = {}; // need id → { input, key, target, busy, result }: the inline reply boxes
    // Keyed by ids the daemon sends: null-prototype maps, so an id such as `__proto__` is just a key.
    this.answered = Object.create(null); // need id → { summary, words, at }: replies sent from here, said for a moment after the item goes
    this.refused = Object.create(null); // need id → { id, qitemId, summary, text, state, at, conn, listEpoch }: safe-close refusals kept visible if the row left Needs
    this.needsPageEpoch = 0;
    this.questionChoices = Object.create(null); // need id → { [questionId]: optionId }
    this.askerNotes = Object.create(null); // need id → string note when Open seat fails or seat isn't loaded
    this.peopleBusy = false;
    this.peopleResult = null;
    this.peopleForm = { quietUntil: "2h", quietStart: "22:00", quietEnd: "08:00", modeName: "sleep", modePolicy: "hold", modeDuration: "8h", showSaveMode: false, showQuietUntil: false, showQuietDaily: false };
    this.awayDismissed = Object.create(null);
    this.loadPersistedState(cx);
    this.loadConfig(cx);
    // A copy opened as a tab (tab.new {mod: "rig-view", props: {entry}}) shows that one entry.
    // The config is picked up the moment it is written into an open window, by watching the app
    // home (OpenRig's folder once it exists), and every second while it is missing, in case watching isn't available.
    cx.spawn(async (cx) => {
      for (;;) {
        const dir = this.config && !this.config.missing ? `${appHome()}/openrig` : appHome();
        let changed;
        try { changed = await watchFolder(dir); } catch (_) { await new Promise((r) => cx.timer.after(5000, () => r(), {owner:null})); }
        if (this.closed) return;
        if (!configWatchChanged(changed, appHome())) continue;
        try { await this.reloadConfig(cx); }
        catch (error) { this.sayConfigReadFailure(error); }
      }
    });
    cx.timer.every(1000, (cx) => { if (!windowHidden() && (!this.config || this.config.missing)) this.loadConfig(cx); });
    cx.timer.every(5000, (cx) => {
      if (this.closed) return;
      if (windowHidden()) { this.wasHidden = true; return; }
      this.loadConfig(cx);
      // A page can be open without the sidebar, and lifecycle changes need not emit SSE. While the sidebar is in the layout and this page saw its
      // connection's refresh in the last SIDEBAR_FRESH_MS, the sidebar supplies freshness and content versions: only changed content invalidates
      // the page. A second invalidation here would fetch unchanged lists and redraw an idle page.
      this.observeSidebarRefresh();
      const seen = this.refreshSeen;
      if (layoutHasMod(layout(), MOD_IDS.sidebar) && seen?.conn === this.activeConnId()
        && (Date.now() - seen.at <= SIDEBAR_FRESH_MS || Date.now() < (this.hiddenSidebarGraceUntil ?? 0))) { this.refreshUnmirrored(cx); return; }
      this.invalidateLiveReads({ seatStatus: true });
      cx.notify();
    });
    // The header's status line and a reply's confirmation come and go by time: redraw while one shows or a new one arrives.
    cx.timer.every(1000, (cx) => {
      this.checkRigLayoutNotice(cx);
      this.compaction?.tick(cx);
      this.consumeStripRecovery(cx);
      if (windowHidden()) return;
      if (this.ticking || shared("rig.status")?.at !== this.statusAt) cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        else if (c === "back") this.back();
        else if (c.startsWith("open:")) this.push({ section: c.slice(5) });
        cx.notify();
      }
    });
  }

  publishStripRecovery(job,result,cx=null){
    setShared('rig.oldViewsCloseResult',{id:job.id,session:job.session,tab:job.tab,recovery:true,expiresAt:Date.now()+120000,title:result.title??"Still in OpenRig's Rig layout",...result});
    setShared('rig.status',{id:job.id,busy:false,...result,at:Date.now()});
    notify({title:result.title??"Still in OpenRig's Rig layout",body:result.text,level:result.ok?'info':'warning'});
    if(cx&&!this.closed)cx.notify();
  }
/** OpenRig switched this window to its Rig layout: one toast per appearance, whichever herdrig copy sees it first (rig-layout-notice.js). */
  checkRigLayoutNotice(cx){
    // A hidden Rig page doesn't draw, so the person's layout is also recorded here (never OpenRig's Rig layout).
    rememberOwnLayout(shared,setShared,shared("layout"),layout());
    const event=rigLayoutAppearance(shared,setShared,shared("layout"),layout(),layouts?.()??[]);
    if(!event)return;
    if(event.kind==="toast"){notify(event.toast);return;}
    // Let OpenRig finish its open first (it counts a view as opened once shown and selected), then switch back. The timer
    // has no owner: it survives this view being replaced by the switch it makes.
    cx?.timer?.after?.(RESTORE_AFTER_MS,next=>next.spawn(async spawned=>{
      // The spawn's own cx stays valid across its awaits (the timer's does not).
      const wait=ms=>new Promise(done=>(spawned??next).timer.after(ms,done,{owner:null}));
      const toast=await finishRigLayoutRestore({layout,layouts,readTextFile,run,shared,setShared,wait,currentLayout:()=>shared("layout")},appHome(),event);
      if(toast)notify(toast);
    }),{owner:null});
  }
  /** The Rig layout card: Back (Herdr's built-in layout.switch), Close views… (the Leave dialog) and Keep. Shown here only when the layout has no Rig sidebar, so it never shows in both places. */
  rigLayoutNoticeCard(t,cx){
    const state=layoutShowsMod(layout(),MOD_IDS.sidebar)?null:rigLayoutCardState(shared,layout(),layouts?.()??[]);
    if(!state){this.rigLayoutBackFailed=false;return null;}
    return rigLayoutCard(this,t,cx,state,{
      back:cx=>this.rigLayoutBack(cx,state.target),
      closeViews:null, // closing needs the Rig sidebar (it runs the cleanup); the card says so instead of offering a refused confirmation
      keep:cx=>{keepRigLayout(shared,setShared);cx.notify();}});
  }
  /** Back only switches the layout; OpenRig's views stay open in its Rig layout (System lists them). The switch is checked, never assumed. */
  rigLayoutBack(cx,target){
    this.rigLayoutBackFailed=false;
    try{run("layout.switch",{name:target});}catch{this.rigLayoutBackFailed=true;cx.notify?.();return;}
    cx.timer?.after?.(1500,next=>{
      if(this.closed)return;
      if(shared("layout")!==target||hasOldProviderStrip(layout())){this.rigLayoutBackFailed=true;next?.notify?.();}
    },{owner:null});
  }

  stripRecoveryNotice(t){
    const result=shared('rig.oldViewsCloseResult');
    if(!result?.recovery||result.busy||result.tab!==this.tabId||result.expiresAt<=Date.now()||result.switched&&hasOldProviderStrip(layout()))return null;
    this.ticking=true;
    return v_flex().id('strip-recovery-result').gap(4).p(10).rounded(8).bg(t.raised).border_1().border_color(t.border)
      .child(div().font_semibold().text_size(12.5).child(result.title))
      .children(String(result.text??'').split('\n').map(line=>div().text_size(12).text_color(result.ok===false?t.blocked:t.muted).child(line)));
  }
  /** Called by this native page's init-owned timer, before any await: its application survives layout replacement. */
  consumeStripRecovery(cx){
    if(this.closed||!this.tabId||this.stripRecoveryJob)return;
    const pending=shared('rig.stripRecovery')??{},match=Object.entries(pending).find(([,request])=>request.tab===this.tabId);
    if(!match)return;
    if(oldStripCleanupOwner(shared)!==match[0])return;
    const [id,request]=match,next={...pending};delete next[id];setShared('rig.stripRecovery',next);
    const job={...request,id,deadline:Date.now()+300000};this.stripRecoveryJob=job;
    if(!Number.isFinite(request.createdAt)||Date.now()-request.createdAt>120000||request.createdAt>Date.now()+1000){
      this.publishStripRecovery(job,{ok:false,text:"This cleanup confirmation expired. Nothing was started. Check OpenRig's views, then confirm again."},cx);this.stripRecoveryJob=null;releaseOldStripCleanup(shared,setShared,id);return;
    }
    setShared('rig.oldViewsCloseResult',{id,session:job.session,recovery:true,expiresAt:job.deadline,busy:true,text:"Leaving OpenRig's Rig layout…"});
    const deadline=cx.timer.after(300000,next=>{
      if(this.stripRecoveryJob!==job)return;job.expired=true;
      this.publishStripRecovery(job,{ok:false,text:'The result was not confirmed in time. Some views may have closed. Check the layout before trying again. Your seats keep running.'},next);
    },{owner:null});
    cx.spawn(async(cx)=>{
      const checkActive=()=>{
        if(this.closed||job.expired||Date.now()>=job.deadline||oldStripCleanupOwner(shared)!==id)throw Error('The recovery result was not confirmed in time.');
      };
      const fresh=async()=>{
        checkActive();
        const current=await configReads(async()=>parseConfig(await readTextFile(CONFIG())));
        checkActive();
        if(current.configInvalid||!gateSameConfig(job.config,current)||(job.config.person??null)!==(current.person??null)||JSON.stringify(job.config.rig??null)!==JSON.stringify(current.rig??null))throw Error('OpenRig settings changed. Reopen this confirmation.');
        return current;
      };
      try{
        await fresh();
        const result=await leaveOldStrip({layout,layouts,readTextFile,currentConfig:fresh,execFor,fetchFor,run,spaces,panes,shared,setShared,
          currentLayout:()=>shared('layout'),wait:ms=>new Promise(done=>cx.timer.after(ms,done,{owner:null})),beforeSwitch:fresh,checkActive},
          job.config,job.views??[],appHome(),conn=>connectionCapabilities(shared,job.config,conn,terminals()),job.returnLayout);
        if(!this.closed&&!job.expired)this.publishStripRecovery(job,result,cx);
      }catch(error){if(!this.closed&&!job.expired)this.publishStripRecovery(job,{ok:false,text:`${String(error?.message??error)} Your seats keep running.`},cx);}
      finally{releaseOldStripCleanup(shared,setShared,id);deadline.cancel();if(this.stripRecoveryJob===job)this.stripRecoveryJob=null;}
    },{owner:null});
  }

  async forgetInPlaceOpen() {
    let rigId = this.shownInPlace?.rigId ?? null;
    let conn = this.shownInPlace?.conn ?? null;
    const ownSpaceId = this.tabSpace()?.id ?? this.propsSpaceId ?? this.ownSpace?.id ?? null;
    if (!rigId) {
      try {
        const entry = this.shownEntry() ?? this.openingEntry();
        rigId = entry?.rigId ?? (entry?.kind === "rig" ? entry.id : null) ?? null;
        conn = this.activeConnId();
      } catch (_) {}
    }
    if (!rigId || conn === NO_PAGE_CONNECTION) return;
    const spaceState = shared("rig.spaceState");
    const rec = readInPlaceOpen(spaceState, rigId, conn);
    if (!rec) return;
    if (rec.space && ownSpaceId && rec.space !== ownSpaceId) return;
    if (rec.tab && this.tabId && rec.tab !== this.tabId) return; // another Rig tab in this space holds the record: closing this one leaves it
    const nextInPlace = withoutInPlaceOpen(spaceState, rigId, conn);
    const nextState = { ...(spaceState ?? {}) };
    if (nextInPlace === undefined) delete nextState.inPlaceOpen; else nextState.inPlaceOpen = nextInPlace;
    setShared("rig.spaceState", nextState);
    if (typeof appHome !== "function" || typeof writeTextFile !== "function" || typeof readTextFile !== "function") return;
    const path = `${appHome()}/openrig/state.json`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const prev = await readTextFile(path).catch(() => null);
      let parsed = {}; try { parsed = JSON.parse(prev ?? "{}"); } catch {}
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};
      if (nextInPlace === undefined) delete parsed.inPlaceOpen; else parsed.inPlaceOpen = nextInPlace;
      try { await writeTextFile(path, JSON.stringify(parsed, null, 2), prev); return; }
      catch (err) { if (attempt === 2) break; }
    }
  }
  /** herdr's teardown: the watch loop ends with this copy; a reply typed and not sent stays as a draft. */
  /** Takes this page's own entry out of rig.pageOnScreen (it is closing): a page that is gone must not let another page change "stay" on its account. */
  forgetOnScreen() {
    this.heldMessagesView?.close();this.heldMessagesView=null;
    if (!this.viewToken) return;
    try {
      const all = shared("rig.pageOnScreen");
      if (!all || typeof all !== "object" || !Object.values(all).some((rec) => rec?.views && this.viewToken in rec.views)) return;
      const next = {};
      for (const [id, rec] of Object.entries(all)) { const views = { ...(rec?.views ?? {}) },healthViews={...(rec?.healthViews??{})}; delete views[this.viewToken];delete healthViews[this.viewToken]; if (Object.keys(views).length) next[id] = { ...rec, views,healthViews }; }
      setShared("rig.pageOnScreen", next);
    } catch (_) {}
  }
  async close() { this.compaction?.close(); this.graphWork?.close();try { this.herdr?.release?.(); } catch (_) {} this.forgetOnScreen(); this.configPanel?.close(); for (const h of Object.values(this.pagerHandles ?? {})) h?.release?.(); releaseFocusTargets(this); for (const h of this.connHandles ?? []) h?.release?.(); this.closed = true;if(this.stripRecoveryJob){this.publishStripRecovery(this.stripRecoveryJob,{ok:false,text:'The Rig page closed before the result was confirmed. Some views may have closed. Check the layout before trying again. Your seats keep running.'});this.stripRecoveryJob=null;} for(const box of Object.values(this.specBoxes??{}))box.secondaryEnterTask?.cancel?.();this.statusMotion.close(); this.nowTails?.close(); for(const graph of this.graphs?.values()??[])graph.reset(); if (this.previousNeedsScope) this.requestUpdateAction("leave", undefined, this.previousNeedsScope); else this.updateAction("leave"); for (const box of Object.values(this.replies)) this.keepDraft(box); await this.forgetInPlaceOpen(); }

  dismissalConfig() {
    const cfg = this.activeConfig();
    if (!cfg) return null;
    if (!cfg.daemonUrl && cfg === this.config) {
      const fromShared = sharedLoopbackDaemonUrl(cfg, this.rawRigData()); // the kept copy: a fresh one is a megabyte at scale
      if (fromShared) return { ...cfg, daemonUrl: fromShared };
    }
    return cfg;
  }
  requestUpdateAction(action, value, scope) {
    const refusal = sidebarRefusal(layout(), "rig.update-action");
    if (refusal) {
      if (action !== "leave") notify({ title: refusal, level: "info" });
      return;
    }
    requestDismissal({ shared, setShared, run, scope }, action, value);
  }
  updateAction(action, value) {
    const cfg = this.dismissalConfig();
    if (!cfg) return;
    const conn = cfg.connectionId;
    const stamp = (v) => (v && typeof v === "object" && !Array.isArray(v) && conn && !v.conn ? { ...v, conn } : v);
    const nextValue = action === "dismiss" ? (Array.isArray(value) ? value.map(stamp) : stamp(value)) : value;
    this.requestUpdateAction(action, nextValue, dismissalScope(cfg));
  }
  updateModel() {
    const cfg = this.dismissalConfig();
    if (!cfg) return dismissalSnapshot(null);
    const scope = dismissalScope(cfg), state = shared("rig.dismissedUpdates");
    const scoped = state?.byScope && Object.hasOwn(state.byScope, scope) ? state.byScope[scope] : (state?.scope === scope ? state : null);
    return dismissalSnapshot(scoped);
  }
  updateButton(t, id, label, onClick) {
    return h_flex().id(id).px(6).h(20).rounded(5).items_center().cursor_pointer()
      .bg(t.raised).border_1().border_color(t.border).text_size(11).text_color(t.muted)
      .on_click(onClick).child(label);
  }
  updateReceipt(t, receipt) {
    this.ticking = true;
    return h_flex().id(`dismiss-receipt-${receipt.id}`).px(8).py(6).gap(8).items_center()
      .child(div().flex_1().truncate().text_size(12).text_color(t.muted).tooltip(String((receipt.keys.length === 1
        ? `✓ Dismissed: ${rowHeadline(receipt.summary) || "update"}` : `✓ Dismissed ${receipt.keys.length} updates`)??"")).child(receipt.keys.length === 1
        ? `✓ Dismissed: ${rowHeadline(receipt.summary) || "update"}` : `✓ Dismissed ${receipt.keys.length} updates`))
      .child(div().id(`undo-${receipt.id}`).tooltip("Bring back the update you just dismissed").text_size(12).text_color(t.accent).cursor_pointer()
        .on_click(() => this.updateAction("undo", receipt.id)).child("Undo"));
  }

  primaryConnId() { return this.config?.connectionId ?? LEGACY_CONNECTION_ID; }
  awayConnId(conn = this.activeConnId()) { return typeof conn === "string" && conn !== "" && conn !== NO_PAGE_CONNECTION ? conn : null; }
  isAwayDismissed(conn = this.activeConnId()) { const id = this.awayConnId(conn); return Boolean(id && this.awayDismissed?.[id]); }
  setAwayDismissed(value, conn = this.activeConnId()) {
    const id = this.awayConnId(conn);
    if (!id) return;
    this.awayDismissed ??= Object.create(null);
    if (value) this.awayDismissed[id] = true;
    else delete this.awayDismissed[id];
  }
  awayState(key, conn = this.activeConnId()) {
    const id = this.awayConnId(conn);
    return id ? readAwayState(shared, key, id, this.primaryConnId()) : null;
  }
  restoreAwayStates() {
    if (!this.config) return;
    restoreAwayStateMap({ shared, setShared }, this.primaryConnId());
  }

  loadPersistedState(cx) {
    if (typeof appHome !== "function" || typeof readTextFile !== "function") return;
    cx.spawn(async (cx) => {
      try {
        const raw = await readTextFile(`${appHome()}/openrig/state.json`);
        if (!raw) return;
        const parsed = parseSidebarState(raw);
        let changed = false;
        if (parsed.awayStates) {
          setShared("rig.away.states", { ...parsed.awayStates, ...cleanAwayStates(shared("rig.away.states"), { keepEmpty: true }) });
          changed = true;
        }
        if (parsed.lastSeenNeedsAt && !shared("rig.lastSeenNeedsAt")) {
          setShared("rig.lastSeenNeedsAt", parsed.lastSeenNeedsAt);
          changed = true;
        }
        if (parsed.needsView && !shared("rig.needsView")) {
          setShared("rig.needsView", parsed.needsView);
          changed = true;
        }
        if (parsed.lastEndedModeApplicationId && !shared("rig.lastEndedModeApplicationId")) {
          setShared("rig.lastEndedModeApplicationId", parsed.lastEndedModeApplicationId);
          changed = true;
        }
        if (parsed.lastActiveModeApplicationId && !shared("rig.lastActiveModeApplicationId")) {
          setShared("rig.lastActiveModeApplicationId", parsed.lastActiveModeApplicationId);
          changed = true;
        }
        if (this.config) this.restoreAwayStates();
        if (changed) cx.notify();
      } catch (_) {}
    });
  }

  sayConfigReadFailure(error) {
    if (this.closed) return;
    const text = error ? plainError(error).text : null;
    if (text && text !== this.configReadFailure) notify({ title: "Couldn't reload OpenRig settings", body: text, level: "warning" });
    this.configReadFailure = text;
  }

  loadConfig(cx) {
    if (this.closed) return;
    return cx.spawn(next => this.reloadConfig(next).catch(error => this.sayConfigReadFailure(error)));
  }

  // The folder watcher already runs in this page's task. Reuse it after its await;
  // a nested implicit spawn there would belong to the view draining the jobs.
  async reloadConfig(cx) {
    if (this.closed) return;
    // Loads run concurrently (the watcher, the timers). The mod-wide numberedConfigReads
    // returns the newest installed config; a newer read that throws cannot drop an older successful one.
    let mine = null;
    const installed = await configReads(async () => (mine = preserveCliDiscoveredConfig(parseConfig(await readTextFile(CONFIG())), this.config)));
    // A newer read (this page's or another page's) installed while this one was reading: the page takes THAT config (what the file says now), never its own older one.
    if (this.closed) return;
    this.sayConfigReadFailure(null);
    const next = this.latestRead = installed === mine ? mine : preserveCliDiscoveredConfig(installed, this.config);
    if(!sameConfig(next,this.config)){
      const migration=migrateConnectionState({shared,setShared,migrateWorkers:false},next,this.config);
      this.initialEntry=migration.entry(this.initialEntry);
      this.initialConn=this.initialEntry?.conn??this.initialConn;
      const previous = this.config;
      const ids = new Set([...(previous?.connections ?? []), ...(next?.connections ?? [])].map(connection => connection.id));
      if (previous?.connectionId) ids.add(previous.connectionId);
      if (next?.connectionId) ids.add(next.connectionId);
      const identity = (cfg, id) => specDraftIdentity(configOfConnection(cfg, id));
      const changed = new Set([...ids].filter(id => JSON.stringify(identity(previous, id)) !== JSON.stringify(identity(next, id))));
      if (previous && changed.size) {
        this.cache = {}; this.cacheEpoch = (this.cacheEpoch ?? 0) + 1; this.resetNowTails(cx);this.graphWork?.close();this.graphWork=null;
        this.invalidateSpecEditors(changed);
      }
      // Publish before the consent await: otherwise each one-second missing-config retry
      // can overtake a valid initial load and leave the page on Reading forever.
      this.config=next;
      this.restoreAwayStates();
      this.specFoldersReady=false;
      this.specConsentMachine=null;
      cx.notify();
    }
    const warmConfig = this.config;
    let consentMachine = null;
    try{
      const consentConfig=this.activeConfig(),text=await readTextFile(`${appHome()}/openrig/spec-consent.json`);
      const saved=consentConfig?consentOf(text,consentConfig.connectionId??LEGACY_CONNECTION_ID):null,key=JSON.parse(saved?.key??"null");
      consentMachine=key?.sha256===SPEC_SHA256?key.machine:null;
    }catch{consentMachine=null;}
    // Approval is a separate file: it can change while connection settings stay identical. Refresh its display snapshot on the watcher/poll,
    // under this load's newest-read guard, rather than only when the Connections health probes restart.
    // Herdr's readTextFile answers null for a missing file ("nothing approved yet") and throws on any other error: that file says "Couldn't check",
    // never "Needs approval".
    const approvals = (name) => readTextFile(`${appHome()}/openrig/${name}`).catch(() => CONSENT_UNREADABLE);
    const connectionConsent = await approvals("machine-consent.json"), helperConsent = await approvals("openrig-consent.json");
    if (this.closed || this.config !== warmConfig) return;
    if (this.latestRead === next) {
      this.specConsentMachine=consentMachine;
      if (this.connConsent !== connectionConsent || this.helperConsent !== helperConsent) { this.connConsent = connectionConsent; this.helperConsent = helperConsent; cx.notify(); }
    }
    // A successful warmup belongs to the installed config. An identical poll shares its work.
    if (this.specFoldersReady || this.specFolderWarmup === warmConfig) return;
    this.specFolderWarmup = warmConfig;
    try {
      const pageCfg = this.activeConfig();
      if (pageCfg && !pageCfg.daemonMachine) {
        const warmed = await localSpecRoots(pageCfg, execFor(pageCfg), home());
        if (this.closed || this.config !== warmConfig) return;
        if (sameConfig(this.activeConfig(), pageCfg)) {
          this.specRoots = warmed; this.specRootsConn = pageCfg.connectionId ?? LEGACY_CONNECTION_ID; this.specRootsPublished = warmed;
        }
      }
      const realpathAvailable = await specRealpathAvailable(exec);
      if (this.closed || this.config !== warmConfig) return;
      this.specRealpathAvailable = realpathAvailable;
      this.specFoldersReady = true;
      cx.notify();
    } finally {
      if (this.specFolderWarmup === warmConfig) this.specFolderWarmup = null;
    }
  }

  invalidateSpecEditors(changed) {
    const graphKeys = [...(this.graphs?.keys() ?? [])].filter(key => key.startsWith("spec:")).map(key => key.slice(5));
    const keys = new Set([...Object.keys(this.specBoxes ?? {}), ...Object.keys(this.specCopyNotes ?? {}), ...(this.specAutoEdit ?? []), ...graphKeys]);
    for (const key of keys) {
      const conn = /^\["(conn-[^"]+)",/.exec(key)?.[1] ?? LEGACY_CONNECTION_ID;
      if (!changed.has(conn)) continue;
      const box = this.specBoxes?.[key];
      if (box) {
        box.invalidated = true;
        box.secondaryEnterTask?.cancel?.();
        box.pendingEditor = null;
        box.state?.release?.();
        box.state = null;
        delete this.specBoxes[key];
      }
      this.specAutoEdit?.delete(key);
      delete this.specCopyNotes?.[key];
      this.graphs?.get(`spec:${key}`)?.reset();
      this.graphs?.delete(`spec:${key}`);
    }
  }

  // A worker view is its own connection's: matched by that connection's machine, origin and id (the legacy entry carries no id).
  hostWorkerEntry(view,cfg=this.activeConfig()){
    const entry=cfg&&Object.values(shared("rig.workerViews")??{}).find(e=>e.view===view&&e.config?.daemonMachine===cfg.daemonMachine
      &&rigOrigin(e.config?.daemonUrl)===rigOrigin(cfg.daemonUrl)&&(e.config?.connectionId??LEGACY_CONNECTION_ID)===(cfg.connectionId??LEGACY_CONNECTION_ID));
    return entry&&entry.pages?.some(page=>this.drawSpaces().some(space=>space.tabs?.some(tab=>tab.id===page.tab)))?entry:null;
  }
  hostWorkerLine(t,rig,view=`rig:${rig.name}`){
    // The ROW's connection (another box's rig shows its own view, never the first connection's); a connection no longer set up shows none.
    const cfg=rig?.conn?configOfConnection(this.config,rig.conn):this.activeConfig();if(!cfg)return null;
    const progress=shared("rig.workerProgress");
    if(progress?.view===view&&progress.machine===cfg.daemonMachine
      &&rigOrigin(progress.daemonUrl)===rigOrigin(cfg.daemonUrl))
      return div().id(`host-worker-progress-${rig.id}`).text_size(11.5).text_color(t.muted)
        .child(`Updating ${view.startsWith("rig:")?`Workers · ${view.slice(4)}`:this.hostWorkerEntry(view,cfg)?.name??"worker view"}…`);
    const entry=this.hostWorkerEntry(view,cfg);if(!entry)return null;
    const pages=entry.pages.filter(page=>this.drawSpaces().some(space=>space.tabs?.some(tab=>tab.id===page.tab)));
    const where=(this.config?.connections?.length??0)>1&&cfg.daemonMachine?` Tiles run on ${cfg.daemonMachine}.`:""; // with several OpenRigs, which machine
    const details=workerViewDetails(entry);
    // Seats on an unreachable tmux server are counted on their own, with why; every other seat left out is named with its reason.
    const gone=(entry.missing??[]).filter(m=>m.reason===TERMINAL_GONE_PLAN_REASON).length,other=(entry.missing??[]).filter(m=>m.reason!==TERMINAL_GONE_PLAN_REASON);
    const missing=other.map(m=>`${m.label} (${workerMissingReason(m.reason)})`).join(", ");
    const goneLine=gone?` ${counted(gone,"seat","seats")} left out: ${gone===1?"its":"their"} terminal server isn't answering.`:"";
    const message=`Worker view open here: ${pages.length} page${pages.length===1?"":"s"}.${details?` ${details}.`:""}${missing?` ${other.length} seat${other.length===1?"":"s"} not shown: ${missing}.`:""}${goneLine}${where}`;
    return v_flex().id(`host-worker-${rig.id}`).gap(4)
      .child(div().text_size(11.5).text_color(t.dim).child(message))
      .when(!!entry.paused,el=>el.child(div().text_size(11.5).text_color(t.working??t.muted).child("Couldn't refresh this view; tiles kept.")
        .child(div().text_color(t.accent).cursor_pointer().tooltip("Try opening this rig's worker view again").child("Retry").on_click(()=>this.oneClick({kind:"open-view",view:entry.view,rig:rig.name,rigId:rig.id,conn:rig.conn},"open-view")))))
      .child(h_flex().gap(8).flex_wrap().children(pages.map((page,index)=>div().id(`host-worker-page-${rig.id}-${index}`).tooltip(`Go to page ${index+1} of this rig's worker view`).text_size(11.5).text_color(t.accent).cursor_pointer()
        .child(`Show page ${index+1}`).on_click(()=>{if(spaces().some(s=>s.id===entry.space&&s.tabs?.some(tab=>tab.id===page.tab))){run("space.select",{id:entry.space});run("tab.select",{id:page.tab});}}))))
      .child(div().text_size(11.5).text_color(t.accent).cursor_pointer().tooltip("Change how long a quiet tile stays before herdrig prunes it").child(`herdrig prune: ${entry.pruneMs?Math.round(entry.pruneMs/60000)+"m":"off"}…`)
        .on_click(()=>this.menu({kind:"following",target:entry.view,name:entry.name,rig:rig.name,rigId:rig.id,conn:rig.conn,enabled:entry.following,pruneAfterMs:entry.pruneMs||null})));
  }
  caps() {
    if ((this.config?.connections ?? []).length > 1) {
      const own = this.rawRigData()?.byConnection?.[this.activeConnId()]?.capabilities;
      return currentCapabilities(this.activeConfig()?.capabilities ?? own ?? {}, this.hostLists().terminals, own ?? {herdrAppAvailable:null});
    }
    return currentCapabilities(this.config?.capabilities ?? shared, this.hostLists().terminals, shared("rig.capabilities"));
  }

  /** Open or switch to the active space's TUI. The Rig sidebar does it (`rig.tui`), as the menu does: it outlives
   *  this page. Without it in the layout, a task of this view's own does, its own cx pacing the wait for a new tab:
   *  the click's cx is stale after the first await. */
  tui(cx) {
    // With several OpenRigs the sidebar's own command opens the box IT shows; a page belongs to the box it was opened for, so it asks for its own (the request names the connection).
    if (layoutShowsMod(layout(), MOD_IDS.sidebar) && !((this.config?.connections ?? []).length > 1)) return run("rig.tui");
    const config = this.activeConfig(), rigLayout = inRigLayout(); // the connection the page shows; none when it is no longer set up
    if (!config) { notify({ title: "Open TUI", body: UNKNOWN_CONNECTION, level: "warning" }); return; } // never another connection's TUI
    cx.spawn(async (cx) => {
      const result = await openOrFocusTui({ spaces, panes, terminals, hc: hcFor(config), run: runFor(config), layout, notify, inRigLayout: rigLayout, wait: waitWith(cx) }, config);
      if (result?.ok === false) notify({ title: "Open TUI", body: result.reason, level: "warning" });
    });
  }

  /** Attach to a seat through the seat's OWN connection (its address, its home, its gate scope), never the page's first one. An older row with no connection is the only one's; with several it is refused. */
  async attachTarget(cx, target) {
    const found = targetConnection(this.config, { conn: adoptConnection(this.config, target?.conn) });
    if (!found.ok) return { ok: false, reason: found.reason };
    const config = found.config;
    return attachToSeat({ exec: execFor(config), run: runFor(config), hc: hcFor(config), spaces, panes, terminals, layout, shared, setShared, openOverlay:spec=>this.open(spec), currentConfig:()=>configOfConnection(this.config,config.connectionId), seatShared: seatSharedOf(this.config, shared), wait: waitWith(cx), relayPath: attachRelayPath(appHome(), MOD_IDS.view) }, target, config);
  }

  /** An Attach tab from before an update runs an older viewer. The dialog's confirm re-runs Attach with
   *  the replace; nothing stops or closes the old viewer before the person clicks. */
  reviewViewerReplace(result, target) {
    this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: 320,
      props: { target, step: { action: "replace-viewer", staleViewer: result?.staleViewer ?? null } } });
  }

  /** Back to where `backTarget` says; with nowhere to go it does nothing (Esc and × close the page). */
  back() {
    this.invalidateDrawRoute();
    try { return this.backNow(); }
    finally { this.invalidateDrawRoute(); }
  }
  backNow() {
    this.syncSplitTab();
    if (this.perTab()) {
      // This tab's own visit order, never another tab's; at its bottom, the page's breadcrumb parent.
      const id = this.tabId;
      const all = this.tabPagesWithSeed(), fallback = this.shownEntry();
      if (!backTarget({ stack: all[id]?.stack ?? [] }, null, { fallback })) return;
      const next = tabPagesBack(all, id, { fallback });
      if (next !== all) setShared("rig.tabPages", next);
      return;
    }
    const raw = nav(), own = this.ownConn(), opts = { fallback: this.openingEntry(), primaryConn: this.config?.connectionId };
    if (!backTarget(raw, own, opts)) return;
    setShared("rig.nav", navBack(raw, own, opts));
  }

  closePage() {
    this.invalidateDrawRoute();
    try { return this.closePageNow(); }
    finally { this.invalidateDrawRoute(); }
  }
  closePageNow() {
    this.syncSplitTab();
    if (this.perTab()) {
      // Escape or ×: this tab's history goes (it shows "Nothing open"); other tabs keep theirs, and Herdr's own × closes the tab.
      const id = this.tabId, all = shared("rig.tabPages") ?? {};
      setShared("rig.tabPages", { ...tabPagesClose(all, id), [id]: { stack: [], at: Date.now() } });
      // ...and the router's older record for it, so nothing that still reads it falls back to the page this tab showed.
      const routes = shared("rig.pageRoutes");
      if (routes && id in routes) { const { [id]: _gone, ...rest } = routes; setShared("rig.pageRoutes", rest); }
      if (rigStack()) run("layout.select", { stack: STACK, child: "main" });
      return;
    }
    const own = this.ownConn();
    if (this.initialEntry?.conn) this.initialConn ??= this.initialEntry.conn;
    this.initialEntry = null;
    if (!own) { closeInspection(); return; }
    const stack = nav().stack ?? [];
    const primary = this.config?.connectionId;
    const kept = stack.filter((e, i) => !(e?.conn ? e.conn === own : i === stack.length - 1 && own === primary));
    setShared("rig.nav", { stack: kept });
    if (rigStack()) run("layout.select", { stack: STACK, child: "main" });
  }

  /** The section switch: a section pushes onto the nav stack, so Back returns. */
  goSection(section, conn = null) {
    const own = (this.config?.connections?.length ?? 0) > 1 ? (conn ?? this.awayConnId()) : null;
    this.push({ section, ...(own ? { conn: own } : {}) });
  }

  unresolvedConnection(t,cx,entry){
    const issue=entry.connectionIssue,old=entry.connectionIdentity?.machine||entry.connectionIdentity?.origin||issue?.oldId||'from before this version';
    const shownOld=issue?.kind==='missing-evidence'?'from before this version':old;
    const message=issue?.kind==='ambiguous'
      ? `More than one OpenRig matches this page's old connection: ${(issue.names??[]).join(', ')}. Choose the one it belongs to.`
      : `This page belongs to an OpenRig that's no longer set up here (${shownOld}). Nothing is read or sent for it.`;
    const choose=()=>this.navigationMenu((this.config?.connections??[]).map(conn=>{
      const config=connectionConfig(this.config,conn),next={...entry,conn:conn.id,connectionIdentity:connectionIdentity(config)};delete next.connectionIssue;
      return{label:conn.machine||conn.daemonUrl||conn.id,entry:next};
    }), 'Choose a connection');
    return this.card(t,'Connection',[this.dim(t,message),h_flex().gap(8)
      .child(this.button(t,'connection-migration-choose','Choose a connection…',choose,{small:true}))
      .child(this.button(t,'connection-migration-close','Close page',()=>this.closePage(),{small:true}))]);
  }
  navigationMenu(choices, title = "Sections") {
    // The popup has its own runtime: carry this page's connection in each destination instead of relying on the shared nav stack.
    const conn=(this.config?.connections?.length??0)>1?this.awayConnId():null; // a page that names no OpenRig stamps nothing
    if(conn)choices=choices.map(choice=>choice.entry&&!('conn' in choice.entry)?{...choice,entry:{...choice.entry,conn}}:choice);
    this.open({ mod: MOD_IDS.menu, kind: "popup", width: 260, height: Math.min(360, 42 + choices.length * 30),
      props: { target: { kind: "page-navigation", name: title, choices, from: this.shownEntry() ?? null, ...(this.perTab() ? { sourceTab: this.tabId } : {}) } } }); // a choice is a click on this page (see rig-menu page())
  }

  sectionMenu() {
    const data = this.pageRigData() ?? {}, topology = data.topology ?? [];
    const items = this.attentionRead(null).items;
    const health=data.health?.records??this.cache?.["/api/health"]?.data?.records;
    this.navigationMenu(pageSectionChoices({ topology: counted(topology.length, "rig"), specs: data.specs?.length??this.cache?.["/api/specs/library"]?.data?.length,
      terminals: (data.ps ?? []).length, needs: needsRequestCount(null, items),
      system: Array.isArray(health)?healthCounts(health).problems||"ok":null }));
  }

  objectTabs(t, entry, spec, {prefix="page",active=this.activePageView,cx=null}={}) {
    let counts = this.pageNeedsCounts;
    if (!counts && pageViewKind(entry) === "needs") {
      const attItems = this.attentionRead(null).items;
      counts = { requests: needsRequestCount(null, attItems), checks: needsCheckCount(attItems.filter(isOpenNeed)), updates: attItems.filter(isUpdateNeed).length };
    }
    const options = pageViewOptions(entry, spec, {...(counts ?? {}),...this.workflowCounts});
    if (!options.length) return null;
    const { tabs, more } = visiblePageTabs(options, this.pageWidth ?? 960);
    const choose = view => this.push(entryWithPageView(entry, view));
    const bar=h_flex().id(`${prefix}-object-tabs`).px(14).gap(16).h(34).items_center().border_b(1).border_color(t.border).flex_none()
      .when((this.pageWidth??960)<320,el=>el.h(68).flex_wrap().gap(8))
      .children(tabs.map(([id, label]) => focusTarget(this, cx, `${prefix}-tab-${id}`, div().id(`${prefix}-tab-${id}`).tooltip(`Show this page as ${label}`).h(34).flex_none().flex().items_center().cursor_pointer()
        .border_b(active === id ? 2 : 0).border_color(t.accent).text_size(12.5).text_color(active === id ? t.foreground : t.muted), () => choose(id), el => el.text_color(t.foreground).underline())
        .child(label)))
      .when(more.length > 0, el => {
        const openMore = () => this.navigationMenu(more.map(([id,label]) => ({ label, entry:entryWithPageView(entry,id) })), "Views");
        return el.child(focusTarget(this, cx, `${prefix}-tabs-more`, div().id(`${prefix}-tabs-more`).cursor_pointer().text_size(12.5).text_color(t.muted)
          .h(34).flex_none().flex().items_center().border_b(more.some(([id])=>id===active)?2:0).border_color(t.accent)
          .tooltip(more.find(([id])=>id===active)?.[1]??"More views"), openMore, e => e.text_color(t.foreground).underline())
          .child(`${more.find(([id])=>id===active)?.[1]??"More"} ▾`));
      });
    if(pageViewKind(entry)==='topology'&&active==='seats'){
      const choices=[['rig','By rig'],['status','By status']].map(([id,label])=>({label,entry:{...entry,topologyTab:'seats',seatsOrder:id}}));
      bar.child(div().flex_1());
      if((this.pageWidth??960)-28<460)bar.child(this.moreButton(t,'all-seats-order-menu',()=>this.navigationMenu(choices,'Seat order')));
      else bar.child(h_flex().id('all-seats-order').gap(8).items_center().children(choices.map(({label,entry:e})=>div().id(`all-seats-order-${e.seatsOrder}`).tooltip(`Order the seats by ${e.seatsOrder === "status" ? "status" : "rig"}`)
        .text_size(12).text_color((this.allSeatsOrder??'rig')===e.seatsOrder?t.foreground:t.muted).cursor_pointer().on_click(()=>this.push(e)).child(label))));
    }
    return bar;
  }

  /** The connection the page is showing: the shown entry's own `conn` (a request's, from the merged Needs; an older entry with none reads as the
   *  only connection), else the first. Overview pages have none and show the first connection. */
  /** This tab's own OpenRig: its machine space's, else the entry it was opened with (Herdr restores a tab with its props), else the single-owner
   *  local OpenRig home or rig space it lives in (`localSpaceConn`; a home shared by two connections with the same `homeKey` `[origin, machine]`
   *  stays unowned). Only with several connections: one connection's page is exactly as before. */
  ownConn() {
    if ((this.config?.connections?.length ?? 0) <= 1) return null;
    if (this.renderMemo && "ownConn" in this.renderMemo) return this.renderMemo.ownConn;
    const resolved = this.spaceConn() ?? this.initialEntry?.conn ?? this.initialConn ?? this.localSpaceConn() ?? null;
    if (this.renderMemo) this.renderMemo.ownConn = resolved;
    return resolved;
  }
  /** The OpenRig of the MACHINE space this tab lives in, when that machine has exactly one (one rig == one space, and each machine has its
   *  own home space: a Rig tab in box2's space is box2's, whatever entry it was first opened with: an unstamped one, or another box's page routed
   *  there). Null for a space on this computer or a machine with none or two OpenRigs: then `initialEntry` or `localSpaceConn` decides. */
  spaceConn() {
    const space = this.tabSpace();
    if (!space || !spaceMachine(space)) return null;
    const picked = followedConnection({ connections: this.config?.connections ?? [], space });
    return picked.why === "space" ? picked.id : null;
  }
  /** A single-owner OpenRig home or rig space on this computer (`herdrig.spaces` mark or `openRigSpaceContext`) whose Rig tab has no `entry.conn`
   *  (opened while one OpenRig was set up, restored from v0.5.1, or split in place): it belongs to that local OpenRig. A plain unmarked space, a
   *  home shared by two connections with the same `homeKey` `[origin, machine]`, or a space whose terminal links name another OpenRig stays unowned. */
  localSpaceConn() {
    const space = this.tabSpace();
    if (!space || spaceMachine(space) !== null) return null;
    const connections = this.config?.connections ?? [];
    const urlOf = (cfg) => cfg?.daemonUrl || sharedLoopbackDaemonUrl(cfg, this.rawRigData());
    const keyOf = (id) => { const cfg = configOfConnection(this.config, id); return homeKey({ ...cfg, daemonUrl: urlOf(cfg) }); };
    const sharedHome = (id) => { const k = keyOf(id); return connections.filter((c) => keyOf(c.id) === k).length > 1; };
    const mark = shared("herdrig.spaces")?.[space.id], markConn = mark?.conn ?? mark?.spaceConn ?? null;
    if (markConn) return !connections.some((c) => c.id === markConn) || (mark?.home && sharedHome(markConn)) ? null : markConn;
    const spaceState = shared("rig.spaceState") ?? {};
    const ctx = openRigSpaceContext([space], terminals?.() ?? [], this.drawPanes(), spaceState, MOD_IDS.view)[0];
    if (!ctx?.home && !(ctx?.rigs?.length > 0)) return null;
    const tuiLinks = (ctx?.tuis ?? []).map((t) => ({ origin: t.labels?.["herdr-openrig.origin"] })).filter((l) => l.origin);
    const links = [...(ctx?.rigLinks ?? []), ...tuiLinks];
    const picked = followedConnection({ connections, space, links });
    if (picked.why !== "space") return null;
    const own = configOfConnection(this.config, picked.id), ownUrl = urlOf(own);
    if (ctx.home && !(ctx?.rigs?.length > 0)) {
      if (sharedHome(picked.id)) return null;
      const homes = spaceState.homeSpaces ?? {};
      const recordedKeys = Object.entries(homes).filter(([, id]) => id === space.id).map(([k]) => k);
      if (recordedKeys.length > 0) {
        const siblingKeys = new Set(connections.filter((c) => c.id !== picked.id).map((c) => keyOf(c.id)));
        siblingKeys.delete(keyOf(picked.id));
        const matchesOwn = recordedKeys.some((k) => {
          if (siblingKeys.has(k)) return false;
          if (!ownUrl) return picked.id === LEGACY_CONNECTION_ID;
          try {
            const [recOrigin] = JSON.parse(k);
            return (!recOrigin && picked.id === LEGACY_CONNECTION_ID) || Boolean(recOrigin && sameDaemonOrigin(recOrigin, ownUrl, null));
          } catch (_) { return false; }
        });
        if (!matchesOwn) return null;
      } else if (spaceState.homeSpace === space.id && picked.id !== LEGACY_CONNECTION_ID
        && connections.some((c) => c.id === LEGACY_CONNECTION_ID && keyOf(c.id) !== keyOf(picked.id))) {
        return null;
      }
    }
    return links.some((l) => l.origin && !sameDaemonOrigin(l.origin, ownUrl, null)) ? null : picked.id;
  }
  openingEntry() {
    const entry = this.initialEntry;
    if (!entry) return null;
    const own = this.ownConn();
    return own && entry.conn && entry.conn !== own ? null : entry;
  }
  /** The entry this tab shows: the global back stack's top when it is this tab's own connection's (or names none), else this tab's most recent own
   *  page in the stack, else the page it was opened with. Never another box's page inside this box's rig space (one rig == one space). */
  /** The index in `stack` of the page this tab shows, or -1 for the initial entry. PURE over the stack it is given, so a caller that both
   *  locates and rewrites uses ONE read: natively `shared()` returns a fresh copy per read (herdr-app mods.rs `to_host`), so matching an
   *  entry by object identity across two reads never succeeds. */
  shownIndex(stack, rawNav = shared("rig.nav")) {
    const own = this.ownConn();
    if (!own) return stack.length - 1;
    const top = stack.at(-1);
    // An unstamped entry (the cross-box Needs page, an older one) reads as the FIRST connection's (activeConnId), so it is shown only in the
    // first connection's tab.
    const ownsTop = top?.conn ? top.conn === own : own === this.config?.connectionId;
    if (ownsTop) return stack.length - 1;
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i]?.conn === own) return i;
    return -1;
  }
  /** Native tabs (Herdr has spaces, or this tab names its own): each Rig tab draws its own history, `rig.tabPages[tabId]`. Without them (a legacy
   *  rig-work layout) the page keeps the one shared history, `rig.nav`, as before. */
  /** Herdr's spaces and panes, read once per draw (the render's memo) and fresh outside one: the per-tab checks ask for them many times a frame. */
  drawSpaces() { const read = () => { try { return spaces?.() ?? []; } catch (_) { return []; } }, memo = this.renderMemo; return memo ? (memo.spaces ??= read()) : read(); }
  drawPanes() { const read = () => { try { return panes?.() ?? []; } catch (_) { return []; } }, memo = this.renderMemo; return memo ? (memo.panes ??= read()) : read(); }
  nativeTabs() {
    if (this.propsSpaceId) return true;
    return this.drawSpaces().length > 0;
  }
  /** Per-tab pages apply once this tab knows its Herdr id; until its first draw it behaves as before. */
  perTab() { return Boolean(this.tabId) && this.nativeTabs(); }
  /** A latched tab that has been split (a second Rig pane in it) goes back to the shared history, where every open lands for split panes: its
   *  record goes, and the page it showed is carried into the shared history so it doesn't jump. Strictly more than one pane, so a list still
   *  being restored (none) never unlatches it. */
  syncSplitTab() {
    if (!this.tabId || this.syncingSplit) return;
    let split = false;
    split = this.drawPanes().filter((p) => p?.mod === MOD_IDS.view && p.tab === this.tabId).length > 1;
    if (!split) return;
    this.syncingSplit = true;
    try {
      const pages = shared("rig.tabPages") ?? {}, held = pages[this.tabId]?.stack?.at(-1) ?? null, id = this.tabId;
      if (pages[id]) setShared("rig.tabPages", tabPagesClose(pages, id));
      this.tabId = null;
      if (held && navKey(this.shownEntry()) !== navKey(held)) setShared("rig.nav", navPush(nav(), held));
    } finally { this.syncingSplit = false; }
  }
  /** This tab's Herdr id, learned once from its own render while its space and tab are active (only the active tab's view renders), never changed.
   *  Called only from render: a background tab's timer runs while another tab is active, and would take that tab's id. */
  latchTab() {
    if (this.tabId) return this.tabId;
    try {
      const space = this.drawSpaces().find((s) => s?.active), tab = (space?.tabs ?? []).find((t) => t?.active);
      const ownSpaceId = this.propsSpaceId ?? this.ownSpace?.id ?? null;
      // The tab must hold exactly one Rig page: this page is drawn inside its own tab, never in a tab of terminals. Two Rig pages split in one tab
      // can't tell their histories apart (a page can't learn its pane), so such a tab keeps the shared history, where each pane draws its own OpenRig.
      const rigPanes = this.drawPanes().filter((p) => p?.mod === MOD_IDS.view && p.tab === tab?.id).length;
      if (space && tab?.id && rigPanes === 1 && (ownSpaceId === null || ownSpaceId === space.id)) this.tabId = tab.id;
    } catch (_) {}
    return this.tabId ?? null;
  }
  /** The page a tab with no history yet starts from, and whether it may be saved: the router's record for the tab, else the entry the tab was
   *  opened with, else (one OpenRig) the last page opened anywhere. With several OpenRigs a page that names none is given one only when it can be
   *  told: the machine space's own OpenRig, or the one OpenRig whose data holds its rig or request, once every connection has answered. Until
   *  then it is drawn but not saved, and never as the first connection's. Nothing is saved before the settings load. */
  tabSeed(drawn = undefined) {
    const several = (this.config?.connections?.length ?? 0) > 1;
    // A tab from before each tab kept its own history starts from the shared one: with several OpenRigs, a tab with its own OpenRig takes that OpenRig's
    // newest page, any other its top (an unstamped top stays unsaved and draws the "names no OpenRig" notice, below). From then on it keeps its own.
    const own = this.config && several ? this.ownConn() : null;
    // An unstamped entry from before several OpenRigs were set up is the first connection's (pages then named none).
    const ownsEntry = (e) => (e?.conn ? e.conn === own : own === this.config?.connectionId);
    const logged = !this.config ? null : own ? [...(nav().stack ?? [])].reverse().find(ownsEntry) ?? null : nav().stack?.at(-1) ?? null;
    const entry = drawn ?? (this.tabId ? shared("rig.pageRoutes")?.[this.tabId] : null) ?? this.openingEntry() ?? logged;
    if (!entry || !this.config) return { entry, persist: false };
    if (!several || entry.conn || entry.section === "file" || entry.section === "system" && !entry.subview) return { entry, persist: true };
    const space = this.spaceConn();
    if (space) return { entry: { ...entry, conn: space }, persist: true };
    const held = this.dataStamp(entry);
    if (held) return { entry: { ...entry, conn: held }, persist: true };
    // A tab with its own OpenRig (its space belongs to one, or the router opened it for one) gives that OpenRig to the page it starts from.
    return own ? { entry: { ...entry, conn: own }, persist: true } : { entry, persist: false };
  }
  /** The one OpenRig whose published data holds this page's rig or request, read only once every connection has answered (a box that is down
   *  might hold it too); null otherwise. */
  dataStamp(entry) {
    const rigId = entry.rigId ?? null, needId = entry.section === "needs" ? entry.id ?? null : null;
    if (!rigId && !needId) return null;
    const published = this.rigData(), conns = this.config?.connections ?? [];
    const answered = conns.every((c) => { const e = published?.byConnection?.[c.id];
      return e?.answering === true && (!needId || e.attentionAnswered === true || Array.isArray(e.attentionItems)); });
    if (!answered) return null;
    const holders = new Set([...(rigId ? (published?.topology ?? []).filter((r) => r?.id === rigId) : []),
      ...(needId ? (published?.attentionItems ?? []).filter((i) => i?.id === needId) : [])].map((row) => row?.conn).filter(Boolean));
    return holders.size === 1 ? [...holders][0] : null;
  }
  /** Edits the history this page draws: its own tab's (seeded when new) on native tabs, else the shared one. `edit` returns the new stack, or null
   *  to leave it. */
  editShownStack(edit) {
    this.invalidateDrawRoute();
    try { return this.editShownStackNow(edit); }
    finally { this.invalidateDrawRoute(); }
  }
  editShownStackNow(edit) {
    this.syncSplitTab();
    if (this.perTab()) {
      const id = this.tabId, all = this.tabPagesWithSeed(), next = edit(all[id]?.stack ?? []);
      if (next) setShared("rig.tabPages", { ...all, [id]: { stack: next.slice(-30), at: Date.now() } });
      return;
    }
    const next = edit(nav().stack ?? []);
    if (next) setShared("rig.nav", { stack: next });
  }
  /** `rig.tabPages` with this tab's seed in place when it has no history yet (so Back and a rewrite start from the page it shows). */
  tabPagesWithSeed() {
    const all = shared("rig.tabPages") ?? {}, id = this.tabId;
    if (!id || all[id]) return all;
    const seed = this.tabSeed();
    return seed.entry ? { ...all, [id]: { stack: [seed.entry], at: Date.now() } } : all;
  }
  shownEntry() {
    const memo = this.renderMemo?.routeReady ? this.renderMemo : null;
    if (memo && "shownEntry" in memo) return memo.shownEntry;
    const entry = this.resolveShownEntry();
    if (memo) memo.shownEntry = entry;
    return entry;
  }
  resolveShownEntry() {
    if (this.perTab()) {
      const id = this.tabId;
      const record = shared("rig.tabPages")?.[id];
      return record ? record.stack?.at(-1) ?? null : this.tabSeed().entry;
    }
    const rawNav = shared("rig.nav"), stack = rawNav?.stack ?? [];
    if (rawNav == null) return this.openingEntry();
    const at = this.shownIndex(stack, rawNav);
    return at < 0 ? this.openingEntry() : stack[at];
  }
  /** The shown page without its filter (the control is drawn on the page it acts for, which may sit below the stack top). */
  clearFilter() { this.rewriteShownPage({ filter: "" }); }
  /** The System page without its `config <category>` / `setting <key>` narrowing (the page's filter stays). */
  clearConfigScope() { this.rewriteShownPage({ category: null, settingKey: null }); }
  /** Rewrite the page this tab shows, locating it by INDEX within a single `shared("rig.nav")` read. */
  rewriteShownPage(patch) {
    this.invalidateDrawRoute();
    try { return this.rewriteShownPageNow(patch); }
    finally { this.invalidateDrawRoute(); }
  }
  rewriteShownPageNow(patch) {
    this.syncSplitTab();
    if (this.perTab()) {
      const id = this.tabId, all = this.tabPagesWithSeed(), stack = all[id]?.stack ?? [];
      if (!stack.length) return;
      const next = stack.slice(); next[next.length - 1] = { ...stack.at(-1), ...patch };
      setShared("rig.tabPages", { ...all, [id]: { stack: next, at: Date.now() } });
      return;
    }
    const rawNav = shared("rig.nav"), stack = rawNav?.stack ?? [];
    const at = stack.length ? this.shownIndex(stack, rawNav) : -1;
    if (at < 0) {
      // The tab shows the page it was OPENED with (the stack holds only another connection's pages, or nothing): put the cleared page on top as this tab's own, only when the tab would show it there;
      // the other connections' entries stay as they are.
      const base = this.openingEntry();
      if (!base) return;
      const next = [...stack, { ...base, ...patch }];
      if (this.shownIndex(next, rawNav) === next.length - 1) setShared("rig.nav", { stack: next });
      return;
    }
    const next = stack.slice(); next[at] = { ...stack[at], ...patch };
    setShared("rig.nav", { stack: next });
  }
  /** A link on this tab belongs to the page this tab shows (or this tab's own connection when an older shown entry is unstamped): never another tab's. */
  push(entry) {
    this.invalidateDrawRoute();
    try {
      this.syncSplitTab();
      const from = this.shownEntry(), own = !from?.conn ? this.ownConn() : null;
      return push(entry, own ? { ...(from ?? {}), conn: own } : from, this.perTab() ? this.tabId : null);
    } finally { this.invalidateDrawRoute(); }
  }
  activeConnId() {
    const memo = this.renderMemo?.routeReady ? this.renderMemo : null;
    if (memo && "activeConnId" in memo) return memo.activeConnId;
    const conn = this.resolveActiveConnId();
    if (memo) memo.activeConnId = conn;
    return conn;
  }
  invalidateDrawRoute() {
    if (this.renderMemo) { delete this.renderMemo.shownEntry; delete this.renderMemo.activeConnId; }
  }
  resolveActiveConnId() {
    const entry = this.shownEntry();
    let id = entry?.conn;
    if (!id && entry?.section === "needs" && entry.id) {
      const owners=new Set((this.rawRigData()?.attentionItems??[]).filter(item=>item?.id===entry.id&&item?.conn).map(item=>item.conn));
      if(owners.size===1)id=[...owners][0];
    }
    if (!id) id = this.ownConn();
    const adopted = adoptConnection(this.config, id);
    // Several OpenRigs and a page that names none: it belongs to no box, so it reads and sends nothing (the System page lists them all and needs none).
    // A System page lists every OpenRig and needs none, except its per-OpenRig views (settings, health).
    const listsAll = entry?.section === "file" || entry?.section === "system" && !["config", "health"].includes(entry.subview);
    if (!adopted && entry && (this.config?.connections ?? []).length > 1 && !listsAll) return NO_PAGE_CONNECTION;
    return adopted ?? this.config?.connectionId ?? null;
  }
  /** The transcript link for the PAGE's own OpenRig. Null when the page's OpenRig is on a machine: its transcript lives on that
   *  box, and a link to this computer's identically-named file would open the wrong seat's log. */
  pageTranscriptPath(rig, session) {
    const cfg = this.activeConfig(); // the page's own: no fallback, a gone connection shows no link rather than another box's log
    if (!cfg || cfg.daemonMachine) return null;
    return transcriptPath(cfg, rig, session);
  }
  /** The config for the shown connection: this page's own for the first, that connection's own address and home for another, null when it is
   *  not set up any more (nothing is read or sent: never the first connection's). */
  activeConfig() {
    if(this.shownEntry()?.connectionIssue)return null;
    const id = this.activeConnId();
    if (!this.config || !id || id === this.config.connectionId) return this.config;
    const conn = (this.config.connections ?? []).find((c) => c.id === id);
    if (!conn) return null;
    const memo = this.configMemo ??= new Map();
    const hit = memo.get(id);
    if (hit && hit.base === this.config) return hit.view;
    const view = connectionConfig(this.config, conn);
    memo.set(id, { base: this.config, view });
    return view;
  }
  /** The config a spec write acts for: the connection this page shows, or null when it is no longer set up (nothing is sent, never the first's). */
  /** A page entry that names a connection is judged by it (a removed one gives null: nothing is sent, never another connection's, even when one
   *  connection is left); a page with none acts for its own config, exactly as before. */
  specConfig() { return this.shownEntry()?.conn ? this.activeConfig() : this.config; }
  /** A spec editor box (and its auto-edit mark) belongs to a connection as well as a spec: spec ids are path-derived, so two OpenRigs can show the same id.
   *  The legacy connection keeps the bare id (one connection is unchanged); every other connection's boxes carry its id. A page whose connection is no
   *  longer set up still names it in its entry, so its box (and the note that nothing more is sent) stays found there. An operation that awaited passes
   *  the connection it began under. */
  specBoxKey(id, config = this.specConfig()) {
    const conn = config === null ? this.shownEntry()?.conn ?? null : config?.connectionId;
    return conn && conn !== LEGACY_CONNECTION_ID ? JSON.stringify([conn, id]) : id;
  }
  /** A spec operation: the connection it began on, captured once and synchronously, before its first await. Everything the operation does after an
   *  await goes through this object, never through whatever the page shows by then: its boxes, drafts, notes, read cache, daemon address, folder
   *  refusal and library re-read. `onPage()` is the one guard for a step that acts on the PAGE (moving it to a copy, unfolding a row, writing into
   *  the folders the page holds): it is true only while this tab still shows the connection the operation began on. Null when the page's connection is no longer set up (nothing is sent). */
  specOperation(config = this.specConfig(), fromConn = this.shownEntry()?.conn ?? null) {
    if (!config) return null;
    const base = config === this.config;
    const identity = JSON.stringify(specDraftIdentity(config));
    const sameIdentity = other => JSON.stringify(specDraftIdentity(other)) === identity;
    // The page's own config may learn its address after the operation began (a CLI discovery on a default install replaces it): the same connection's
    // newer copy is used then, never another connection's.
    const current = () => (base && sameIdentity(this.config) ? this.config : config);
    return {
      config, fromConn,
      boxKey: (id) => this.specBoxKey(id, config),
      draftKey: (id) => specDraftKey(id, config),
      stillConfigured: () => sameIdentity(configOfConnection(this.config, config.connectionId)),
      cache: () => this.cacheFor(config.connectionId),
      daemonUrl: () => this.resolveDaemonUrl(current()),
      rereadLibrary: (cx) => this.read(cx, "/api/specs/library", true, null, current(), true),
      refusal: () => this.specRefusal(config),
      // A page whose connection is no longer set up shows nothing: no operation is on it (the legacy id included).
      onPage: () => sameIdentity(this.specConfig()),
    };
  }
  /** The connection a row or menu target on this page names: the page entry's own (passed as is: the menu dispatcher judges it, a stale one is
   *  refused there), else the page's config. Never adopted to a live connection here, which would hide a stale claim. */
  shownConnId() { const conn = this.shownEntry()?.conn; return conn ?? ((this.config?.connections?.length ?? 0) > 1 ? null : this.config?.connectionId); }
  /** One focus handle per connection block, created after the first render as the SDK requires and kept on the view. */
  connectionHandles(cx) {
    const need = (this.config?.connections ?? []).length * 4 + 1; // Remove and three connection actions per block, plus Add a machine
    this.connHandles ??= [];
    if (this.connHandles.length < need && !this.connHandleTask) this.connHandleTask = cx.timer.after(0, (next) => {
      if(this.closed){this.connHandleTask=null;return;}
      while (this.connHandles.length < need) this.connHandles.push(next.focus_handle());
      this.connHandleTask = null; next.notify();
    });
    return this.connHandles;
  }
  connectionActionHandles(cx){
    const connections=this.config?.connections??[],handles=this.connectionHandles(cx),out={};
    connections.forEach((connection,i)=>['switch','approve','switch-back'].forEach((action,j)=>{
      out[`connection-${action}-${connection.id}`]=handles[connections.length+1+i*3+j];
    }));
    return out;
  }
  /** Each connection's state for System > Connections: ONE read of its /healthz (under its own gate scope) per settings change, never a loop.
   *  Consent display is refreshed independently by loadConfig. Drawn only with two or more connections. */
  connectionStates(cx) {
    const config = this.config, list = config?.connections ?? [];
    const current = () => Object.fromEntries(list.map(c => {
      const checked = this.connStates?.[c.id] ?? { status: "checking" };
      const published = sharedRigData(configOfConnection(config, c.id), this.sharedOnce)?.byConnection?.[c.id];
      // The sidebar's latest refresh is authoritative; the one-time health read remains a fallback when no matching feed is published.
      const state = checked.status === "error" || typeof published?.answering !== "boolean" ? checked : published.answering
        ? { ...checked, status: "connected", hostId: published.healthz?.selfHostId ?? checked.hostId }
        : { ...checked, status: "down" };
      // The sidebar's read said this herdr:// connection's helper approval is missing or stale: its block offers "Approve helper…".
      // Its approvals file couldn't be read: herdrig's own error ("Check failed", "isn't a connection problem"), never "Not answering".
      if (published?.approvalsUnreadable === true) return [c.id, { ...state, status: "error", message: "its approvals file couldn't be read" }];
      return [c.id, published?.needsApproval === true ? { ...state, needsApproval: true } : state];
    }));
    if (list.length < 2 || this.connStatesFor === config) return current();
    this.connStatesFor = config; this.connStates = Object.fromEntries(list.map((c) => [c.id, { status: "checking" }]));
    cx.timer.after(0, (next) => next.spawn(async (cx) => {
      await Promise.all(list.map(async (c) => {
        let state = { status: "down" };
        try {
          const r = c.daemonUrl ? await fetchFor({ connectionId: c.id })(`${c.daemonUrl}/healthz`) : null;
          if (r?.ok) { const body = await r.json(); state = { status: "connected", hostId: typeof body?.selfHostId === "string" ? body.selfHostId : null }; }
        } catch (e) { if (isCodeError(e)) state = { status: "error", message: describeCodeError(e) }; } // a connection that doesn't answer is "down"; herdrig's own error is said as that
        if (this.connStatesFor === config) this.connStates = { ...this.connStates, [c.id]: state };
      }));
      cx.notify();
    }));
    return current();
  }
  /** A write operation for `cfg`: with several connections it is scoped to that connection; with one, exactly as before (the gate's only scope). */
  writeOperation(cfg) { return gatedOperation((this.config?.connections ?? []).length > 1 ? cfg?.connectionId : undefined); }
  /** A read operation for the connection this page shows (refusal-shaped, as the page's other reads). */
  readOperation(cfg = this.activeConfig()) { return gatedOperationOrRefusal((this.config?.connections ?? []).length > 1 ? cfg?.connectionId : undefined); }
  /** The page's read cache of the shown connection: one per connection, so two OpenRigs never answer each other's paths. */
  cacheFor(id) { return (this.caches ??= {})[id ?? ""] ??= {}; }

  /** Address-discovery messages belong to the config that was probed, never another connection's page. */
  daemonMessageFor(cfg) { return cfg===this.config ? this.lastDaemonMessage||cfg?.daemonMessage : cfg?.daemonMessage; }

  async resolveDaemonUrl(cfg = this.activeConfig()) {
    if (!cfg) return null;
    if (cfg !== this.config) return cfg.daemonUrl ?? null; // another connection: its own written address
    if (!this.config) return null;
    if (this.config.configInvalid) { this.lastDaemonMessage = this.config.configInvalid; return null; } // a refused list has no address, from anywhere
    if (this.config.daemonUrl) return this.config.daemonUrl;
    // Another mod's shared state may name the daemon only when it's on this machine (loopback).
    const fromShared = sharedLoopbackDaemonUrl(this.config, this.rawRigData());
    if (fromShared) {
      const nextCfg = { ...this.config, daemonUrl: fromShared, daemonUrlSource: this.config.daemonUrlSource ?? "cli" };
      delete nextCfg.daemonMessage;
      this.config = nextCfg;
      return fromShared;
    }
    let status;
    // The config can turn refused (or change) while the CLI answers (loadConfig installs it): the answer is for the config that asked, so it is dropped
    // and the reason is the gate's own sentence.
    try { status = await discoverDaemonFromCli(this.config, exec); }
    catch (error) { if (error?.code === "GATE_REFUSED") { this.lastDaemonMessage = error.message; return null; } throw error; }
    if (this.config?.configInvalid) { this.lastDaemonMessage = this.config.configInvalid; return null; }
    if (status.reachable && status.daemonUrl) {
      const nextCfg = { ...this.config, daemonUrl: status.daemonUrl, daemonUrlSource: "cli", daemonState: status.state };
      delete nextCfg.daemonMessage;
      this.config = nextCfg;
      return status.daemonUrl;
    }
    this.lastDaemonMessage = status.message || this.config.daemonMessage;
    return null;
  }

  /** A cached GET: returns what's known now and fetches in the background when missing, stale or asked again. What it
   *  had stays drawn until the new answer replaces it (the sidebar's `list` does the same). */
  read(cx, path, force = false, onData = null, as = null, inTask = false, fence = false) {
    if(path==='/api/health'&&this.renderMemo)this.renderMemo.healthRead=true;
    // `as`: a spec operation's own connection (its library re-read after a write), never the page shown when the write ends.
    const conn = as ? as.connectionId : this.activeConnId(), cache = this.cacheFor(conn), cfg = as ?? this.activeConfig();
    this.reading?.add(path);
    // The whole attention list is slow on a large OpenRig: while this connection's sidebar is running and holds it, the page uses its copy.
    const served = path === "/api/attention" && !force && !as && conn && this.attentionFromSidebar === conn ? this.sidebarAttention(conn, cache[path]) : null;
    if (served) cache[path] = served;
    const hit = cache[path];
    const lost = Boolean(hit?.loading) && Number.isFinite(hit.startedAt) && Date.now() - hit.startedAt > READ_LOST_MS;
    // A spec write or conflict refusal needs an observation made after it; fence off earlier in-flight reads as soon as that GET starts.
    const fenced = Boolean(fence || (inTask && force && path === "/api/specs/library"));
    if (!served && (!hit || force || hit.stale || lost) && cfg && (!hit?.loading || lost || fenced)) {
      const published = sharedRigData(cfg, this.sharedOnce);
      const sharedAt = (this.config?.connections?.length ?? 0) > 1 ? published?.byConnection?.[cfg?.connectionId]?.at : published?.at;
      // The read belongs to the daemon and connection it started against: a late answer, after the configuration moved, is dropped.
      const epoch = this.cacheEpoch ?? 0;
      // Each read of a path is numbered. Any outstanding read's answer settles a loading entry; once an answer is shown, an older one is dropped.
      const seq = (hit?.seq ?? 0) + 1;
      const readGeneration = fenced ? Symbol() : hit?.readGeneration;
      const older = () => readGeneration !== cache[path]?.readGeneration || seq < (cache[path]?.shownSeq ?? 0);
      let answerChanged = false;
      const generation = readGeneration ? { readGeneration } : {};
      cache[path] = { ...(hit ?? {}), ...generation, stale: false, loading: true, startedAt: Date.now(), seq };
      const finish = (outcome) => {
        const pending = cache[path];
        if (older()) return;
        // A cached successful read can advance observation metadata without redrawing the same content. Explicit reads, callbacks,
        // first load, lost reads and errors still announce completion; no operation or permission is cached here.
        answerChanged = Boolean(force || onData || as || lost || hit?.data === undefined || hit?.error || !outcome.ok
          || (hit?.status !== undefined && hit.status !== outcome.status) || !canSkipReadAnswer(path, hit.data, outcome.data)
          || hit?.queuePage?.limit !== outcome.queuePage?.limit || hit?.queuePage?.truncated !== outcome.queuePage?.truncated);
        const queuePage = outcome.ok ? outcome.queuePage : pending?.queuePage;
        cache[path] = {
          ...settleRead(pending, outcome),
          ...(queuePage && { queuePage }),
          ...generation,
          sharedAt: outcome.ok ? sharedAt : pending?.sharedAt,
          // Consume invalidation when starting, not when finishing: another update may arrive mid-read.
          ...(pending?.stale ? { stale: true } : {}),
          seq: Math.max(pending?.seq ?? seq, seq), shownSeq: seq,
        };
        if (path.startsWith("/api/queue/")) {
          const readConn = adoptConnection(this.config, conn) ?? null; // the row is this read's OpenRig's: only its own requests' boxes observe it
          if (outcome.ok && typeof outcome.data?.qitemId === "string") {
            const row = outcome.data, at = cache[path].at;
            for (const [id, box] of Object.entries(this.replies ?? {})) {
              if (box.target?.qitemId !== row?.qitemId || (adoptConnection(this.config, box.target?.conn) ?? null) !== readConn) continue;
              if (box.result?.conflict && box.result?.unknownTerminalState
                && typeof box.result.refineMinSeq === "number" && seq >= box.result.refineMinSeq
                && typeof row.state === "string" && row.state.trim()) {
                const st = row.state.trim();
                const refined = formatSafeCloseConflict({
                  code: "qitem_already_terminal",
                  currentState: st,
                  expectedState: box.result.expectedState ?? null,
                  idx: box.result.stepsCompleted ?? 0,
                  total: box.result.totalSteps ?? 1,
                });
                box.result = { ...box.result, text: refined, unknownTerminalState: false };
                if (this.refused?.[id] && !this.refused[id].state) this.refused[id] = { ...this.refused[id], text: refined, state: st };
              }
              if (observeNeedDecision(box, row, at, { readSeq: seq })) {
                delete this.answered[id];
                delete this.questionChoices[id];
              }
            }
          } else if (!outcome.ok) {
            let readQid = null;
            try { readQid = decodeURIComponent(path.slice("/api/queue/".length).split("?")[0]); } catch (_) { readQid = null; }
            if (readQid) {
              for (const box of Object.values(this.replies ?? {})) {
                if (box.target?.qitemId !== readQid || (adoptConnection(this.config, box.target?.conn) ?? null) !== readConn) continue;
                if (typeof box.conflictAwaitingRefresh === "number" && seq >= box.conflictAwaitingRefresh) {
                  box.conflictAwaitingRefresh = false;
                }
                if (box.result?.unknownTerminalState && typeof box.result.refineMinSeq === "number" && seq >= box.result.refineMinSeq) {
                  box.result = { ...box.result, unknownTerminalState: false };
                }
              }
            }
          }
        }
      };
      const receive = async (cx) => {
        try {
          const op = gatedOperationOrRefusal(cfg?.connectionId); // the read's own connection
          const daemonUrl = await this.resolveDaemonUrl(cfg);
          if (!daemonUrl) {
            throw new Error(this.daemonMessageFor(cfg) || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up').");
          }
          const r = await op.fetch(`${daemonUrl}${path}`);
          const body = await r.text();
          if (epoch !== (this.cacheEpoch ?? 0) || older()) return; // the config moved, or a newer answer is already shown
          let data = null; try { data = stampConnection(JSON.parse(body), cfg?.connectionId); } catch (_) { data = body; }
          // onData runs here, after the await: outside render, so it may create view state (an EditorState).
          if (r.ok && onData) onData(data);
          finish(r.ok
            ? { ok: true, data, status: r.status, ...(path.startsWith("/api/queue/list?") && { queuePage: queueListPage(r) }) }
            : { ok: false, error: `GET ${path} → ${r.status}${data?.error ? `: ${errorDiagnostic(data.error)}` : ""}`, status: r.status, errorData: data });
        } catch (e) { if (epoch === (this.cacheEpoch ?? 0)) { const failure = plainError(e); finish({ ok: false, error: failure.text, errorDetail: failure.detail }); } }
        if (answerChanged) this.noteAnswer(cx);
      };
      // Spec-write tasks keep their own page context until this read settles.
      if (inTask) return receive(cx);
      cx.spawn(async (cx) => { await receive(cx); });
    }
    if (inTask) return;
    // A stored page can name a connection that is not configured any more: say so, instead of a skeleton that never ends. (No config yet is
    // still "loading".)
    const result = cache[path] ?? (this.config && !cfg ? { error: UNKNOWN_CONNECTION, status: 0 } : { loading: true });
    if (path.startsWith("/api/attention") && result.data?.items) {
      const health = this.read(cx, "/api/health"), records = health.error ? null : health.data?.records ?? null;
      return { ...result, data: { ...result.data, items: filterAttentionItemsFor(this, result.data.items, records) } };
    }
    return result;
  }

  /** Observe a small successful-read heartbeat without invalidating content or requesting a draw. */
  observeSidebarRefresh(published=null){
    const refreshed=shared("rig.refreshed"),conn=this.activeConnId(),several=(this.config?.connections?.length??0)>1;
    const at=(several?refreshed?.byConnection?.[conn]:refreshed?.at)??(several?published?.byConnection?.[conn]?.at:published?.at);
    // The heartbeat is throttled to one minute. Its successful-read time, including the first one seen, expires after 75 s;
    // observing an unchanged leftover value never renews it. A missing sidebar still takes the immediate fallback above.
    const readAt=Date.parse(at),now=Date.now();
    if(Number.isFinite(readAt)&&readAt<=now&&now-readAt<=SIDEBAR_FRESH_MS){this.refreshSeen={conn,at:readAt};this.hiddenSidebarGraceUntil=0;}
    if(at&&(at!==this.dataAt||conn!==this.dataAtConn)){this.dataAt=at;this.dataAtConn=conn;}
    return {refreshed,conn,several};
  }

  /** The sidebar's whole attention list for this page's connection, as a read's cache entry, or null: only while that sidebar is running
   *  (`attentionFromSidebar`, set once per render) and its list holds every kind of item. The same list keeps the same entry, so memos stay warm. */
  sidebarAttention(conn, prev) {
    if (!conn || this.attentionFromSidebar !== conn) return null;
    const own = this.pageRigData();
    if (own?.attentionComplete !== true || !Array.isArray(own.attentionItems)) return null;
    // As of: this connection's successful-read heartbeat, independent of its content version.
    const readAt = this.dataAtConn === conn && this.dataAt ? this.dataAt : own.at ?? null;
    // The page's own read (one it forced after an answer) is kept while it runs and until the sidebar has refreshed after it: the answered request
    // must not come back from an older list.
    const sidebarAt = Date.parse(readAt) || 0;
    if (prev && !prev.fromSidebar && (prev.loading || (Number.isFinite(prev.at) && prev.at > sidebarAt))) return null;
    if (prev?.fromSidebar && prev.data?.items === own.attentionItems && prev.data?.sources === own.attentionSources && prev.data?.readAt === readAt) return prev;
    return { data: { items: own.attentionItems, sources: own.attentionSources ?? [], perspective: own.attentionPerspective ?? null, readAt }, status: 200,
      at: sidebarAt || Date.now(), sharedAt: own.at, fromSidebar: true };
  }

  filterAttentionItems(rawItems, healthRecords = undefined) {
    return filterAttentionItemsFor(this, rawItems, healthRecords);
  }

  /** Whether a file is on disk (read once; a file card lists only those that are). */
  exists(cx, path) {
    if (!(path in this.present)) {
      this.present[path] = null;
      cx.spawn(async (cx) => { this.present[path] = (await readTextFile(path).catch(() => null)) !== null; cx.notify(); });
    }
    return this.present[path];
  }

  /** Explicit selection wins; a sole catalog entry needs no picker or daemon default. */
  scopesProject(cx, explicit=null) {
    const catalog = this.read(cx, "/api/scopes/projects").data;
    return effectiveScopeProject(explicit, readScopeProject(shared, this.config, this.awayConnId(), catalog), catalog);
  }
  /** The slice folders on disk, by folder name, scoped to the effective project. */
  slicePaths(cx, project = null) {
    const proj = this.scopesProject(cx,project);
    const path = proj ? `/api/slices?project=${encodeURIComponent(proj)}` : "/api/slices";
    const got = this.read(cx, path);
    const fallback = proj && got.error && got.data === undefined ? this.read(cx, "/api/slices") : null;
    const slices = got.data?.slices ?? fallback?.data?.slices ?? this.cache["/api/slices"]?.data?.slices ?? [];
    return new Map(slices.filter((s) => typeof s.slicePath === "string").map((s) => [s.slicePath.split(/[\\/]/).pop(), s.slicePath]));
  }

  // ---- building blocks (herdr's own panels) -------------------------------------------------------------------------
  /** Escaped HTML gives plain text a native selectable TextView, without interpreting daemon text as markup. Several lines
   *  keep their lines (textLinesView); the style sits on the column so callers' restyling reaches every line. */
  plain(t, text, id = null) {
    const key = id ?? `rig-text-${this.textSeq = (this.textSeq ?? 0) + 1}`, lines = escapedLines(text ?? "—");
    return (lines.length === 1 ? TextView.html(key, lines[0]).selectable(true).scrollable(false) : textLinesView(lines, { TextView, v_flex, id: key }))
      .text_size(12.5).text_color(t.foreground);
  }
  copyButton(t, text, id, label = "value", { tip = null } = {}) {
    return div().id(`copy-${id}`).size(20).flex_none().rounded(4).cursor_pointer().hover((el) => el.bg(t.hover))
      .tooltip(tip ?? `Copy ${label}`).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(String(text ?? ""));
        this.copied = id; cx.notify(); cx.timer?.after(1500, (cx) => { if (this.copied === id) this.copied = null; cx.notify(); }); })
      .child(svg(icon(this.copied === id ? "check" : "rig-copy")).size(12).text_color(t.dim));
  }
  copyValue(t, text, id, label = "value") {
    return h_flex().gap(6).items_start().min_w(0)
      .child(div().flex_1().min_w(0).child(this.plain(t, text, `text-${id}`)))
      .child(this.copyButton(t, text, id, label));
  }
  title(t, text) { return this.plain(t, text).text_size(15).font_semibold(); }
  dim(t, text) { return this.plain(t, text).text_size(12).text_color(t.dim); }
  workerCapabilityMessage() { const caps=this.caps(); return workerCapabilityText(capabilitiesSummaryDetail(caps).reason ?? "",caps); }
  workerCapabilityNote(t, reason, id = null) {
    const words=workerCapabilityText(reason,this.caps());
    return div().when(!!id,el=>el.id(id)).text_size(11.5).text_color(t.dim).tooltip(words).child(words);
  }
  card(t, title, children, meta = null) {
    const { compact, tight } = pageBodyLayout(this.pageWidth);
    return v_flex().rounded(10).bg(t.background).border_1().border_color(t.border).p(tight ? 10 : 12).gap(8)
      .when(!!title, (el) => el.child((compact ? v_flex() : h_flex()).when(!compact, e => e.items_center()).gap(compact ? 4 : 0).child(div().when(!compact, e => e.flex_1()).text_size(12.5).font_semibold().text_color(t.foreground).child(title))
        .when(!!meta, (h) => h.child(typeof meta === "string" ? div().text_size(11.5).text_color(t.dim).child(meta) : meta))))
      .children(children.filter(child => child != null));
  }
  button(t, id, label, onClick, { primary = false, iconName = null, small = false, disabled = false, tooltip = null, tip = null, actionKey = null, conn = this.shownConnId() } = {}) {
    tooltip ??= tip;
    if(this.inPageActions&&(this.pageWidth??960)<480&&iconName&&!primary){tooltip??=label;label="";}
    const busyKey = shared("rig.busyAction");
    const busy = Boolean(busyKey && (busyKey === qualifyBusyKey(conn, id) || (actionKey && busyKey === qualifyBusyKey(conn, actionKey))));
    return h_flex().id(id).px(small ? 10 : 12).h(small ? 24 : 28).gap(6).rounded(8).items_center().text_size(12).flex_none()
      .bg(primary && !disabled ? t.solid : t.raised).text_color(disabled ? t.dim : primary ? t.solid_foreground : t.foreground)
      .when(!primary, (el) => el.border_1().border_color(t.border)).hover((s) => s.bg(primary && !disabled ? t.solid : disabled ? t.raised : t.hover))
      .when(!!tooltip, (el) => el.tooltip(tooltip))
      .on_click((e, cx) => { if (!disabled) onClick?.(e, cx); })
      .when(busy, (el) => el.child(svg(icon("rig-refresh")).size(11).flex_none().text_color(t.accent)
        .when(this.config?.reducedMotion !== true, icon => icon.spin(900))))
      .when(!busy && !!iconName, (el) => el.child(svg(icon(iconName)).size(13).flex_none()))
      .child(label);
  }
  /** A status mark (`statusMark`: a seat's status, or a tone for counts and a rig): the same marks the sidebar draws. */
  dot(t, key, cell = 14, identity = null, needs = []) {
    return statusMarkElement({ div, svg }, t, key, { cell, iconOf: icon, pulse: this.statusMotion?.observe(identity,key,needs) });
  }
  /** A plain coloured dot, for what isn't a seat status (a Needs-You item's tier). */
  plainDot(t, tone) {
    return div().size(7).flex_none().rounded(4).bg(t[tone] ?? t.dim);
  }
  chip(t, look, status = null) {
    if (look.tone === "blocked") return div().px(6).h(18).rounded(5).flex().items_center().bg(t.blocked + "26").text_color(t.blocked).text_size(10.5).font_semibold().child(look.word);
    const key = status ?? look.tone;
    return h_flex().gap(6).items_center().child(this.dot(t, key)).child(div().text_size(12).text_color(t[statusMark(key).word] ?? t.muted).child(look.word));
  }
  kv(t, rows) {
    const { compact } = pageBodyLayout(this.pageWidth);
    const group = this.textSeq = (this.textSeq ?? 0) + 1;
    const exact = (key, value) => value != null && !["", "—", "not a file on disk"].includes(String(value))
      && ["session", "attach:", "attach command", "queue item", "target", "rig id", "request id", "slice", "mission", "view", "terminal", "address", "sender", "recipient", "cwd", "file", "path"].includes(String(key).toLowerCase());
    return v_flex().gap(compact ? 6 : 4).children(rows.filter(Boolean).map(([k, v, mono, tip], i) => (compact ? v_flex() : h_flex()).id(`kv-row-${group}-${i}`).gap(compact ? 2 : 10).items_start()
      .child(div().when(!compact, el => el.w(120).flex_none()).text_size(compact ? 11 : 12).text_color(t.dim).child(k))
      .child(div().when(compact, el => el.w_full()).when(!compact, el => el.flex_1()).min_w(0).when(!!mono, (el) => el.font_family(settings()?.font_family ?? "monospace"))
        .child(tip ? div().id(`field-${group}-${i}`).min_w(0).truncate().tooltip(tip).text_size(12.5).text_color(t.foreground).child(String(v))
          : exact(k, v) ? this.copyValue(t, String(v), `field-${group}-${i}`, k) : this.plain(t, v, `field-${group}-${i}`)))));
  }
  skeleton(t) { return v_flex().gap(6).children([0, 1, 2].map((i) => div().h(12).w(220 - i * 40).rounded(3).bg(t.raised))); }
  /** What a read looks like while loading or failed; null when there is data (a failed refresh of drawn data is the
   *  page's `refreshNote` instead). */
  status(t, cx, path, got) {
    if (got.error && got.data === undefined) {
      return v_flex().rounded(10).border_1().border_color(t.blocked).p(12).gap(8)
        .child(this.errorText(t, `read-${path}`, got.errorDetail ?? got.error))
        .child(h_flex().gap(8).items_center().child(this.button(t, `retry-${path}`, "Retry", (_e, cx) => { this.read(cx, path, true); cx.notify(); }, { tip: "Read this again from OpenRig" }))
          .when(!!got.at, (el) => el.child(this.dim(t, `as of ${this.time(got.at)}`))));
    }
    if (got.data === undefined) return this.skeleton(t);
    return null;
  }
  inPlaceBanner(t, entry) {
    const conn = this.activeConnId();
    if (!entry || conn === NO_PAGE_CONNECTION) return null;
    let rigId = entry.rigId ?? (entry.kind === "rig" ? entry.id : null) ?? null;
    if (!rigId && (entry.rig || entry.kind === "rig" && entry.name)) {
      const targetName = entry.rig ?? entry.name;
      rigId = (this.pageRigData()?.topology ?? this.rigData()?.topology ?? []).find((r) => r?.name === targetName)?.id ?? null;
    }
    if (!rigId) return null;
    const inPlace = readInPlaceOpen(shared("rig.spaceState"), rigId, conn);
    if (!inPlace) return null;
    const ownSpaceId = this.tabSpace()?.id ?? this.propsSpaceId ?? this.ownSpace?.id ?? null;
    if (inPlace.space && ownSpaceId && inPlace.space !== ownSpaceId) return null;
    if (inPlace.tab && this.tabId && inPlace.tab !== this.tabId) return null; // the record is another Rig tab's
    this.shownInPlace = { rigId, conn, space: inPlace.space ?? ownSpaceId };
    const rigName = inPlace.rigName ?? entry.rig ?? (entry.kind === "rig" ? entry.name : null) ?? rigId;
    return h_flex().id("rig-inplace-notice").gap(8).items_center().px(10).py(6).rounded(8).border_1().border_color(t.border).bg(t.raised)
      .child(svg(icon("rig-alert")).size(12).flex_none().text_color(t.ansi3 ?? t.accent))
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted)
        .child(this.errorText(t,"inplace-fallback-note",inPlaceFallbackNote(rigName, inPlace.reason))));
  }
  staleReadSummary() {
    const failed = [...(this.reading ?? [])].filter((p) => this.cache[p]?.error && this.cache[p].data !== undefined);
    if (!failed.length) return null;
    const oldestAt = failed.reduce((min, p) => {
      const at = this.cache[p]?.at;
      return Number.isFinite(at) && (min === null || at < min) ? at : min;
    }, null);
    return { failed, first: this.cache[failed[0]], oldestAt, ageText: formatStaleAge(oldestAt) };
  }
  /** Reads this page drew that failed to refresh: their last good answer stays drawn, and this says so, with Retry. */
  refreshNote(t) {
    const stale = this.staleReadSummary();
    if (!stale) return null;
    const { failed, first, oldestAt, ageText } = stale;
    const asOf = oldestAt ? this.time(oldestAt, { seconds: true }) : null;
    return h_flex().id("rig-refresh-error").gap(8).items_center().px(10).py(6).rounded(8).border_1().border_color(t.blocked)
      .child(svg(icon("rig-alert")).size(12).flex_none().text_color(t.blocked))
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.blocked)
        .child(this.errorText(t, "rig-refresh-error", first.errorDetail ?? first.error,
          { prefix: "Couldn't refresh: ", suffix: `${failed.length > 1 ? ` (and ${failed.length - 1} more)` : ""} Showing stale data (${ageText}${asOf ? `, ${asOf}` : ""}).` })))
      .child(this.button(t, "rig-refresh-retry", "Retry", (_e, cx) => { for (const p of failed) this.read(cx, p, true); cx.notify(); }, { small: true, tip: "Read everything that failed again from OpenRig" }));
  }
  errorText(t, id, error, { where = "OpenRig's machine", prefix = "", suffix = "" } = {}) {
    return errorBlock(this, t, id, error, { where, prefix, suffix });
  }
  /** A table: `cols` are [label, width?, "right"?]; the first without a width takes the rest. A row with onClick shows
   *  a chevron. A palette filter (`/codex`) narrows it, as the TUI's does. */
  table(t, idPrefix, cols, rows, emptyText = "No records found.") {
    const f = this.filter?.toLowerCase();
    // A row may name more than it shows (a rig's pods, hosts and specs) so `pod`, `host` and `running` find it.
    if (f) rows = rows.filter((r) => [...r.cells, ...(r.match ?? [])].some((c) => typeof c !== "object" && String(c ?? "").toLowerCase().includes(f)));
    const cell = (c, i, header, rowId = "") => {
      const [, w, align] = cols[i] ?? [];
      return div().when(!w, (d) => d.flex_1().min_w(0)).when(!!w, (d) => d.w(w).flex_none()).truncate().when(align === "right", (d) => d.text_right())
        .text_size(header ? 11 : 12.5).text_color(header ? t.dim : i === 0 ? t.foreground : t.muted)
        .when(c === null || typeof c !== "object", el => el.tooltip(String(c??"")))
        // A row is one line high: a cell's own line breaks become spaces (its tooltip keeps the text as sent).
        .child(c && typeof c === "object" ? c : header ? String(c ?? "") : this.plain(t, String(c ?? "").replace(/\s*(?:\r\n?|\n)\s*/g, " "), `cell-${idPrefix}-${rowId}-${i}`));
    };
    return v_flex()
      .child(h_flex().px(8).h(24).gap(10).items_center().border_b(1).border_color(t.border).children(cols.map(([label], i) => cell(label, i, true))).child(div().w(12)))
      .children(rows.length ? rows.map((r, i) => {
        const key = `table:${idPrefix}:${i}`;
        this.pageRows?.push({ key, open: r.onClick ? () => r.onClick() : null });
        let el = h_flex().id(`${idPrefix}-${i}`).px(8).h(30).overflow_hidden().gap(10).items_center().rounded(6).hover((s) => s.bg(t.hover))
          .when(this.pageSel === key, row => row.bg(t.selection ?? `${t.accent}1f`))
          .when(!!r.tip, el => el.tooltip(r.tip))
          .on_click(r.onClick ?? ((_e, cx) => this.selectPageRow(key, cx)));
        if (r.onRight) el = el.on_mouse_down("right", r.onRight);
        return el.children(r.cells.map((c, j) => cell(c, j, false, i)))
          .child(r.onClick ? svg(icon("chevron-right")).size(12).flex_none().text_color(t.dim) : div().w(12));
      }) : [div().p(10).text_size(12).text_color(t.dim).child(f ? `No matches for /${this.filter}.` : emptyText)]);
  }
  fileRow(t, id, path, label, tip = `Open ${path.split(/[\\/]/).pop()} here`) {
    return h_flex().id(id).tooltip(tip).px(8).h(28).gap(8).items_center().rounded(6).hover((s) => s.bg(t.hover)).on_click(() => this.push(fileEntry(path, label)))
      .child(svg(icon("file-text")).size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).tooltip(String(path.split(/[\\/]/).pop()??"")).child(path.split(/[\\/]/).pop()))
      .child(this.copyButton(t, path, `path-${id}`, "path"))
      .child(div().text_size(11.5).text_color(t.dim).child("Open"));
  }
  /** The files of a folder that are on disk, as rows that open them; null until known. */
  filesCard(t, cx, folder, names, label) {
    const rows = names.map((name) => [name, `${folder}/${name}`, this.exists(cx, `${folder}/${name}`)]);
    const known = rows.filter(([, , on]) => on === true);
    const reading = rows.some(([, , on]) => on === null);
    return this.card(t, "Files", known.length ? known.map(([name, path], i) => this.fileRow(t, `file-${i}-${name}`, path, `${name} · ${label}`))
      : [this.dim(t, reading ? "Looking…" : "None of the files are on disk.")], folder);
  }

  // ---- the file viewer: herdr's Files, look-alike -------------------------------------------------------------------
  fileView(t, cx, entry) {
    // The viewer reads THIS computer's files: a page of an OpenRig on a machine shows none (that file is on the machine, and a file at the same
    // path here is another computer's).
    // A page whose connection is no longer set up shows nothing: its entry keeps only the connection's id, so whether the file was on a
    // machine can't be told, and a file at that path here may be another computer's (as spec pages do).
    const pageConfig = this.activeConfig();
    if (this.config && !pageConfig) return this.dim(t, "This page's OpenRig is no longer set up, so its file isn't shown here.");
    const machine = pageConfig?.daemonMachine;
    if (machine) return this.dim(t, `This file is on ${machine}, so it isn't shown here.`);
    const path = entry.path;
    let f = this.files[path];
    if (!f) {
      f = this.files[path] = { reading: true };
      cx.spawn(async (cx) => {
        await Promise.resolve();
        try {
          const text = await readTextFile(path);
          if (text === null) this.files[path] = { error: "This file is no longer available" };
          else if (text.includes("\0")) this.files[path] = { error: "Binary file · no text preview" };
          // The text only: the editor state is made by the next draw, as this page's own (never after this await).
          else this.files[path] = { text: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text };
        } catch (_) { this.files[path] = { error: "Cannot preview this file (binary, too large, or unreadable)" }; }
        cx.notify();
      });
    }
    if (f.text != null && !f.state && !f.statePending && cx?.timer?.after) {
      f.statePending = true;
      cx.timer.after(0, (next) => {
        f.statePending = false;
        if (this.files[path] !== f || f.state) return;
        const th = theme();
        // The component, font and syntax colours of herdr's Files viewer (defaults/mods/files/main.js).
        f.state = EditorState.new({ language: fileLanguage(path), readonly: true, value: f.text, font_family: settings().font_family, font_size: 12,
          syntax: { keyword: th.ansi5, string: th.ansi2, comment: th.dim, function: th.ansi4, type: th.ansi3, number: th.ansi1, constant: th.ansi6 } });
        f.text = null;
        next?.notify?.();
      });
    }
    return v_flex().id("rig-file").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_key_down(()=>{this.typing=true;})
      .child(f.state ? Editor.new(f.state).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(f.error ? this.errorText(t,"file-read-error",f.error,{where:"this computer"}) : "Loading file…"));
  }

  /** A file page's one header, as herdr's Files draws it: Back, "Files", reload, the path, and ×. */
  fileHeader(t, entry) {
    const path = entry.path;
    return h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().id("rig-back").tooltip("Back to the page you came from (Backspace)").cursor_pointer().on_click(() => this.back()).child(svg(icon("chevron-left")).size(14).text_color(t.muted)))
      .child(div().font_semibold().text_size(13).child("Files"))
      .child(div().id("rig-file-reload").tooltip("Read the file again from disk").cursor_pointer().on_click((_e, cx) => { this.files[path]?.state?.release?.(); delete this.files[path]; cx.notify(); })
        .child(svg(icon("rig-refresh")).size(12).text_color(t.dim)))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).tooltip(String(path??"")).child(path))
      .child(this.copyButton(t, path, "file-path", "path"))
      .child(div().id("rig-close").tooltip(this.perTab() ? "Close" : "Close the file").cursor_pointer().on_click(() => this.perTab() ? this.closePage() : closeInspection()).child(svg(icon("x")).size(14).text_color(t.muted)));
  }

  /** herdr's lists a seat row needs (worker views, the shown view, panes, terminals and their index). Native herdr copies each list into the mod
   *  on every call, and a page draws a chip per seat: within one render they are read once; outside a render (a click) they are read now. */
  hostLists() {
    const read = () => {
      const pn = this.drawPanes(), tm = terminals?.() ?? [];
      return { strip: stripProps(), activeView: activeRigViewId(), panes: pn, terminals: tm, index: seatTerminalIndex(pn, tm) };
    };
    const memo = this.renderMemo;
    return memo ? (memo.hostLists ??= read()) : read();
  }
  /** Where a click on this seat goes (seatClickTarget over hostLists). */
  seatTarget(session, conn) {
    const h = this.hostLists();
    return seatClickTarget(h.strip, h.activeView, session, h.panes, h.terminals, seatOrigin(this.config, conn ?? this.activeConnId()),
      seatSharedOf(this.config, this.sharedOnce)?.(session) === true, h.index);
  }
  /** shared("rig.data"): every connection's rigs, seats and attention, copied whole on each read. The page keeps the copy it read and reads it
   *  again only when the sidebar's publish stamp (RIG_DATA_STAMP) changes: every writer (publishRigData) sets a new stamp with the data, and
   *  each fresh copy is about a megabyte at scale and resets every memo keyed on it, so most renders read only the small stamp. Within one render the stamp is read once; with no stamp (no
   *  sidebar publishes one), every read is current. The kept copy is shared, so nothing may change it in place. */
  rawRigData() {
    const memo = this.renderMemo;
    if (memo && "rigData" in memo) return memo.rigData;
    const stamp = shared(RIG_DATA_STAMP), kept = this.rigDataKept;
    const reuse = stamp !== undefined && kept?.stamp === stamp;
    const value = reuse ? kept.value : shared("rig.data");
    this.rigDataKept = stamp === undefined ? null : reuse ? kept : { stamp, value };
    if (memo) memo.rigData = value;
    return value;
  }
  /** `shared` with rig.data through the once-per-render read; for helpers that take a shared function. */
  get sharedOnce() { return (key) => key === "rig.data" ? this.rawRigData() : shared(key); }
  /** rig.data as published under this page's settings (sharedRigData), through the same once-per-render read. */
  rigData() { return sharedRigData(this.config, this.sharedOnce); }

  // ---- sections --------------------------------------------------------------------------------------------------
  /** The attention items a Topology page counts with (a connected assistant's requests left out: terminalAttention), their targets and a
   *  seat's first request, made once per read of the items and roster. A draw asks for them in every rig block, pod and seat, and the list
   *  holds every update (hundreds with a busy OpenRig); herdr's mod runtime is an interpreter, where redoing that each render is costly. */
  pageAttention(raw, roster) {
    const list = Array.isArray(raw) ? raw : [];
    const memo = (this.attentionMemo ??= new WeakMap()), hit = memo.get(list);
    if (hit && hit.roster === roster) return hit;
    const made = { roster, items: terminalAttention(list, roster), targetList: null, firstBySession: null, firstBySeat: null };
    made.targets = () => (made.targetList ??= made.items.map(needTarget));
    /** The first request (not an update) for this seat, in list order: by its session, or by its rig and logical id. */
    made.seatNeed = (session, rigName, logicalId) => {
      if (!made.firstBySession) {
        // Built in locals and kept only when complete: a throw while building leaves nothing half-made for the next render to trust.
        const bySession = new Map(), bySeat = new Map();
        made.targets().forEach((it, i) => {
          if (it.update) return;
          if (!bySession.has(it.session)) bySession.set(it.session, i);
          const byLogical = bySeat.get(it.rig) ?? new Map();
          if (!byLogical.has(it.logicalId)) byLogical.set(it.logicalId, i);
          bySeat.set(it.rig, byLogical);
        });
        made.firstBySeat = bySeat; made.firstBySession = bySession;
      }
      const a = made.firstBySession.get(session), b = made.firstBySeat.get(rigName)?.get(logicalId);
      const i = a === undefined ? b : b === undefined ? a : Math.min(a, b);
      return i === undefined ? undefined : made.targetList[i];
    };
    memo.set(list, made);
    return made;
  }

  /** Single per-draw attention source: `/api/attention` read when `cx` is given (or health-filtered cache outside render), falling back to `pageRigData().attentionItems`. */
  attentionRead(cx = null) {
    const memo = this.renderMemo;
    if (memo?.attentionSource && (memo.attentionSource.fromRead || !cx)) return memo.attentionSource;
    const got = cx ? this.read(cx, "/api/attention") : null;
    const cachedItems = got ? got.data?.items : this.filterAttentionItems(this.cache?.["/api/attention"]?.data?.items);
    const own = this.pageRigData();
    const items = cachedItems ?? own?.attentionItems ?? own?.attention?.items ?? [];
    const source = { got, items, fromRead: Boolean(cx) };
    if (memo) memo.attentionSource = source;
    return source;
  }
  drawAttention(cx = null) {
    const memo = this.renderMemo;
    if (memo?.drawAttention && (memo.drawAttentionFromRead || !cx)) return memo.drawAttention;
    const { items } = this.attentionRead(cx);
    const made = this.pageAttention(items, cx ? this.hostedMembers(cx) : null);
    if (memo) { memo.drawAttention = made; memo.drawAttentionFromRead = Boolean(cx); }
    return made;
  }

  hostedMembers(cx){
    const config=this.activeConfig(); // the shown connection's roster: each OpenRig has its own
    if(!config?.connectionId||!config.daemonUrl)return null;
    const rig=this.rigData(), supplied=rig?.byConnection?.[config.connectionId]?.hostedMembers??rig?.hostedMembers;
    if(supplied?.conn===config.connectionId&&supplied.origin===config.daemonUrl)return supplied;
    const cache=this.cacheFor(config.connectionId),key=`/api/queue/hosted-members:${config.connectionId}`,cached=cache[key];
    if((!cached||cached.stale)&&!cached?.loading&&typeof cx?.spawn==='function'){
      cache[key]={loading:true};
      cx.spawn(async task=>{
        try{(this.hostedReaders??={})[config.connectionId]??=new HostedMembersReader();const data=await this.hostedReaders[config.connectionId].read(fetchFor(config),config,(ms,done)=>task.timer.after(ms,done));
          const now=this.activeConfig(),same=now?.connectionId===config.connectionId&&now?.daemonUrl===config.daemonUrl;
          if(same||this.config?.connectionId===config.connectionId)cache[key]={data,at:Date.now(),...(cache[key]?.stale?{stale:true}:{})};
        }finally{
          // A read that was dropped (the page moved to another connection) or failed never leaves its marker: it would block every later read.
          if(cache[key]?.loading)delete cache[key];
          this.noteAnswer(task);
        }});
    }
    const got=cache[key]?.data;
    return got?.conn===config.connectionId&&got.origin===config.daemonUrl?got:null;
  }

  assistantCard(t,cx,entry){
    if(!entry.conn||entry.conn!==this.activeConnId())return this.dim(t,'This assistant belongs to another OpenRig connection. Open it from that connection.');
    const roster=this.hostedMembers(cx);
    if(!roster)return this.dim(t,'Reading connected assistants…');
    if(roster.state==='unavailable')return this.dim(t,roster.line);
    const member=roster.members.find(m=>!m.invalid&&m.seat===entry.session&&m.conn===entry.conn);
    if(!member)return this.dim(t,'This assistant is not in this OpenRig\'s connected roster.');
    const target=assistantTarget(member,{id:entry.rigId}),last=member.lastCheckInAt?this.time(member.lastCheckInAt):null,word=assistantWord(member.status);
    this.pageHeading={title:member.name,icon:'rig-queue',status:`Connected assistant · ${member.rig}`};
    this.pageActions=h_flex().gap(8).items_center().flex_wrap()
      .child(this.button(t,'assistant-queue','Queue work…',()=>this.open({mod:MOD_IDS.menu,kind:'dialog',width:460,height:300,props:{target,step:{input:true,placeholder:'One-line summary; the body follows on the next lines',action:'queue',multiLine:true}}}),{ tip: "Give this assistant a task: opens Queue work",iconName:'rig-queue'}))
      .child(this.button(t,'assistant-open-rig','Open rig page',()=>this.push({section:'topology',kind:'rig',conn:member.conn,rigId:entry.rigId,name:member.rig}),{ tip: "Open the rig this assistant belongs to",small:true}));
    // Use the running sidebar's version when available. The assistant card reads only its queue.
    const paths=seatQueuePaths(member.seat,this.pageHealthz(null)?.semver),got=this.read(cx,paths.open),queue=seatQueueDetails(got.data,null,{...got.queuePage,requested:paths.openLimit});
    const records=[...queue.current,...queue.pending,...queue.blocked];
    const sentence=assistantSentence(member,value=>this.time(value));
    return v_flex().id('assistant-detail').gap(12)
      .child(this.card(t,'Check-in',[this.dim(t,sentence),this.kv(t,[['Address',member.seat,true],['Last check-in',member.lastCheckInAt?this.time(member.lastCheckInAt,{exact:true}):'No check-in yet'],
        ['Expected cadence',member.expectedMinutes?`Every ${member.expectedMinutes} min`:member.onRequest?'On request':'Not reported'],['Evidence',member.reporter==='openrig-observed'?'Observed by OpenRig':['openrig-adapter','outside-adapter'].includes(member.reporter)?'Reported by an adapter':'Not reported'],...(member.reason?[['Reason',member.reason]]:[])])]))
      .child(this.card(t,'Queued to it',got.error?[this.dim(t,'Queue unavailable.')]:!got.data?[this.dim(t,'Reading queue…')]:records.length?[
        ...(queue.partial?[this.dim(t,`Open queue: at least ${queue.count} items.`).id('assistant-queue-partial')]:[]),
        ...records.map(item=>
        v_flex().id(`assistant-queue-${item.qitemId??item.id}`).gap(3).child(div().text_size(12).text_color(t.foreground).child(rowTitle(item.summary, item.body)))
          .child(this.dim(t,statusWord(item.state??'not reported',"queue"))))]:[this.dim(t,'No open queue items.')]));
  }

  topology(t, cx, entry) {
    if (entry.kind === 'assistant') return this.assistantCard(t,cx,entry);
    if (entry.kind === "seat") return this.seatCard(t, cx, entry);
    if (entry.kind === "host") return this.hostCard(t, cx, entry);
    if (entry.kind === "pod") return this.podCard(t, cx, entry);
    const summary = this.read(cx, "/api/rigs/summary");
    // The attention model (filtered and mapped over every request and update: hundreds) is made only for a page that draws it, never for the
    // skeleton shown while the rig list loads.
    const attention = () => { const { got } = this.attentionRead(cx), pageAttn = this.drawAttention(cx); return { att: got, pageAttn, attentionItems: pageAttn.targets() }; };
    // One rig (`Topology › factory`): the same block, alone. It reads its own seats at once.
    if (entry.kind === "rig" && entry.rigId) {
      const { pageAttn, attentionItems } = attention();
      const one = (summary.data ?? []).find((r) => r.id === entry.rigId) ?? {
        id: entry.rigId, name: entry.name ?? entry.rig ?? "Rig", ...(entry.conn ? { conn: entry.conn } : {}),
      };
      return this.rigBlock(t, cx, one, { entry, rigCount: summary.data?.length ?? 1, attentionItems, pageAttention: pageAttn });
    }
    const wait = this.status(t, cx, "/api/rigs/summary", summary);
    if (wait) return wait;
    const { att, pageAttn, attentionItems } = attention();
    const rigs = summary.data.filter((r) => !r.archivedAt);
    if (entry.kind === "rig") {
      const one = rigs.find((r) => r.name === entry.name);
      return one ? this.rigBlock(t, cx, one, { entry, rigCount: rigs.length, attentionItems, pageAttention: pageAttn }) : this.dim(t, `No rig ${entry.name} on this daemon.`);
    }
    const focusTarget = entry.focusRig ?? shared("rig.focusRig") ?? shared("rig.focus") ?? entry.focus ?? null;
    const loadedModels=rigs.map((r)=>{const nodesState=this.nodesOf(cx,r.id);return {rig:r,...this.rigModelOf(r,nodesState.data),nodesState};});
    const modelList = orderRigs(loadedModels, focusTarget);
    const allSeats = modelList.flatMap((m) => m.seats);
    const models = modelList.map((m) => m.rig);
    const countReads = [summary, att, ...modelList.map((m) => m.nodesState)].filter(Boolean);
    const staleReads = countReads.filter((r) => r.error && r.data !== undefined);
    const oldestAt = (staleReads.length ? staleReads : countReads).reduce((min, r) => (Number.isFinite(r.at) && (min === null || r.at < min) ? r.at : min), null);
    // A failed node read has its own group error; retained cache rows are not live chip counts.
    const strip = this.pulseStrip(t, modelList.filter((m) => !m.nodesState?.error), attentionItems, oldestAt ?? summary.at, entry, { stale: staleReads.length > 0 });
    this.topologyStrip=strip;
    if((entry.topologyTab??this.activePageView)==='seats'){
      this.allSeatsOrder=entry.seatsOrder??this.allSeatsOrder??'rig';
      return allSeatsView(this,t,cx,loadedModels,attentionItems,{navigate:entry=>this.push(entry),menu:(t)=>this.menu(t),hostedMembers:this.hostedMembers(cx),orderMap:shared('rig.order')??{},openSpecs:()=>this.push({section:'specs'}),
        attach:(target,cx)=>cx.spawn(async cx=>{
          const result=await this.attachTarget(cx,target);
          if(result?.needsViewerRefresh)this.reviewViewerReplace(result,target);
          else if(result?.ok===false)notify({title:`Attach ${target.logicalId}`,body:result.reason,level:'warning'});
        })});
    }
    const missingFocusRig = entry.focusRig && !rigs.some((r) => (r.id === entry.focusRig || r.name === entry.focusRig))
      ? div().id("topology-missing-rig").text_size(12).text_color(t.blocked).child(`No rig "${entry.focusRig}" found.`)
      : null;
    const blocks = models.map((r) => this.rigBlock(t, cx, r, { entry, rigCount: rigs.length, attentionItems, pageAttention: pageAttn, allSeats, allowPulseFilter: true })).filter(Boolean);
    return v_flex().gap(12)
      .when(Boolean(this.pulseFilter), el => el.child(this.pulseFilterBar(t, modelList, attentionItems, cx)))
      .child(this.topologyRecent(t, cx, rigs))
      .when(!!missingFocusRig, (el) => el.child(missingFocusRig))
      .children(blocks.length ? blocks : [this.dim(t, this.filter ? `No matches for /${this.filter}.` : "No rigs registered — run rig up <spec> to launch a team.")])
      // A new rig, from a spec in the library or with one seat.
      .child(h_flex().child(this.button(t, "topology-new-rig", "New rig…", () => {
        if(!this.activeConfig()){notify({title:"New rig",body:"This page's connection isn't set up any more. Open Topology from the sidebar before creating a rig.",level:"warning"});return;}
        this.open(newRigOverlay(this.activeConnId()));
      }, { tip: "Start a new rig from a spec", small: true, iconName: "plus" })));
  }

  /** TUI parity: bounded recorded queue chronology, never a synthetic log of activity-change notifications. */
  topologyRecent(t, cx, rigs) {
    const instancePath = "/api/queue/recent-transitions?scope=instance&limit=20";
    const instance = this.read(cx, instancePath);
    // 0.7.9 requires rig=. Newer daemons support the instance query. Detect the response, not a version string.
    const legacy = instance.status === 400;
    const reads = legacy ? rigs.map((rig) => {
      const path = `/api/queue/recent-transitions?rig=${encodeURIComponent(rig.name)}&limit=20`;
      return { path, rig: rig.name, got: this.read(cx, path) };
    }) : [{ path: instancePath, got: instance }];
    const unsupported = reads.some(({ got }) => [404, 405, 501].includes(got.status) && got.data === undefined);
    const failed = reads.find(({ got }) => got.error && got.data === undefined);
    const loading = reads.some(({ got }) => got.data === undefined && !got.error);
    const badShape = reads.some(({ got }) => got.data !== undefined && !Array.isArray(got.data));
    let content;
    if (unsupported) content = this.dim(t, "Recent activity is not available from this OpenRig daemon.");
    else if (failed) content = this.status(t, cx, failed.path, failed.got);
    else if (badShape) content = this.dim(t, "Recent activity returned an unsupported response; no history can be shown.");
    else if (loading) content = this.skeleton(t);
    else {
      const unique = new Map();
      for (const { got, rig } of reads) for (const row of got.data ?? []) unique.set(String(row.transitionId), { ...row, rig: row.rig ?? rig });
      const all = [...unique.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)) || Number(a.transitionId) - Number(b.transitionId)).slice(-20);
      const rows = this.recentExpanded ? all : all.slice(-5);
      const workText = (value) => rowIdOnly(value) ? "" : rowText(value);
      content = v_flex().gap(6)
        .child(this.dim(t, "Recorded queue changes · oldest to newest"))
        .children(rows.map((row) => {
          const key = String(row.transitionId);
          // A text that is only a row id is a real row with no words (rowTitle's "Untitled row"); only an empty one served no work.
          const summary = (workText(row.summary) || workText(row.bodyPreview) || (rowIdOnly(row.summary) || rowIdOnly(row.bodyPreview) ? "Untitled row" : "No work served")).slice(0, 240);
          const selected = this.recentSelected?.transitionId === row.transitionId;
          return v_flex().gap(4)
            .child(h_flex().id(`topology-recent-event-${key}`).tooltip("Show or hide this event's details").gap(8).px(6).py(4).rounded(6).items_center().cursor_pointer().hover((el) => el.bg(t.hover))
              .on_click((_e, cx) => { this.recentSelected = selected ? null : { ...row }; cx.notify(); })
              .child(svg(icon(selected ? "chevron-down" : "chevron-right")).size(11).text_color(t.dim))
              .child(div().min_w(70).flex_none().text_size(11).text_color(t.dim).child(this.time(row.ts,{seconds:true})))
              .child(v_flex().flex_1().min_w(0).gap(2)
                .child(div().truncate().text_size(12).text_color(t.muted).tooltip(`${row.actorSession || "Actor unknown"} · ${row.change || "Change unknown"}`).child(`${row.actorSession || "Actor unknown"} · ${row.change || "Change unknown"}`))
                .child(div().truncate().text_size(12.5).text_color(t.foreground).tooltip(String(summary??"")).child(summary))))
            .when(selected, (el) => el.child(this.kv(t, [
              ["Event", key], ["When", this.time(row.ts,{exact:true})], ["Actor", row.actorSession], ["Change", row.change],
              ["Work", row.summary || row.bodyPreview || "No work served"], ["Queue item", row.qitemId],
              ["Target", row.target ? `${row.targetKind ?? "work"}: ${row.target}` : row.qitemId], ["Rig", row.rig ?? "not served"],
              ["Record", "This is the recorded change, not an independent check of its outcome."],
            ])));
        }))
        .when(!rows.length, (el) => el.child(this.dim(t, "No recorded transitions in the current window.")))
        .when(all.length > 5, (el) => el.child(this.button(t, "topology-recent-expand", this.recentExpanded ? "Show latest 5" : `Show ${all.length}`, (_e, cx) => { this.recentExpanded = !this.recentExpanded; cx.notify(); }, { tip: this.recentExpanded ? "Show only the latest 5 events" : `Show all ${all.length} events`, small: true })));
    }
    return div().id("topology-recent").child(this.card(t, "Recent activity", [content]));
  }

  /** Host inspection page (`Topology › host <name>`). */
  hostCard(t, cx, entry) {
    const hostId = entry.host ?? entry.name ?? "local";
    const summary = this.read(cx, "/api/rigs/summary");
    const archived = this.read(cx, "/api/rigs/summary?archived=only");
    const hostsRes = this.read(cx, "/api/hosts");
    const wait = this.status(t, cx, "/api/rigs/summary", summary);
    if (wait) return wait;
    const rigs = (summary.data ?? []).filter((r) => !r.archivedAt);
    const hostRecords = Array.isArray(hostsRes.data) ? hostsRes.data : (Array.isArray(hostsRes.data?.hosts) ? hostsRes.data.hosts : []);
    const hostRec = hostRecords.find((h) => (h.id ?? h.hostId ?? h.name) === hostId) ?? null;
    const hostRigs = [];
    let seatCount = 0;
    for (const r of rigs) {
      const m = this.rigModelOf(r, this.nodesOf(cx, r.id).data);
      const seatsOnHost = m.seats.filter((s) => (s.host ?? "local") === hostId);
      if (seatsOnHost.length || (m.seats.length === 0 && (r.host ?? "local") === hostId)) {
        hostRigs.push({ rig: r, model: m, seatsOnHost });
        seatCount += seatsOnHost.length;
      }
    }
    return v_flex().id(`host-page-${hostId}`).gap(12)
      .child(this.title(t, `Host ${hostId}`))
      .child(this.card(t, "Host", [this.kv(t, [
        ["Host", hostId],
        ["Status", statusWord(hostRec?.status ?? hostRec?.state ?? "online", "daemon")],
        ["Rigs on host", String(hostRigs.length)],
        ["Seats on host", String(seatCount)],
      ])]))
      .child(this.card(t, "Rigs", [this.table(
        t,
        `host-rigs-${hostId}`,
        [["Rig"], ["Lifecycle", 110], ["Seats", 80, "right"]],
        hostRigs.map(({ rig, model, seatsOnHost }) => ({
          cells: [rig.name, model.lifecycle ?? "running", String(seatsOnHost.length)], tip: `Open ${rig.name}'s page`,
          onClick: () => this.push({ section: "topology", kind: "rig", rigId: rig.id, conn: rig.conn, name: rig.name }),
        })),
        `No rigs on host ${hostId}.`,
      )]))
      .children(archivedElements({ div, svg, h_flex }, t, withArchivedHosts(archived.data, id => this.read(cx, `/api/rigs/${encodeURIComponent(id)}/nodes`).data, this.activeConnId()), { host: hostId, icon, open: Boolean(this.archivedOpen?.[hostId]),
        focusOwner:this,focusFor:id=>focusHandleFor(this,cx,id),
        toggle: (_e, cx) => { (this.archivedOpen ??= {})[hostId] = !this.archivedOpen?.[hostId]; cx.notify(); },
        restore: r => this.oneClick({ kind: "rig", rig: r.name, rigId: r.id, conn: r.conn, archived: true, lifecycle: "stopped" }, "unarchive-rig"),
        menu: r => this.menu({ kind: "rig", rig: r.name, rigId: r.id, conn: r.conn, archived: true, lifecycle: "stopped" }),
      }));
  }

  /** Pod inspection page (`Topology › <rig> › pod <name>`). */
  podCard(t, cx, entry) {
    const known = this.withRigId(t, cx, entry, entry.rig);
    if (known.view) return known.view;
    entry = known.entry;
    const podName = entry.pod ?? entry.name ?? "default";
    const nodesPath = `/api/rigs/${encodeURIComponent(entry.rigId)}/nodes`;
    const nodes = this.nodesOf(cx, entry.rigId);
    const wait = this.status(t, cx, nodesPath, nodes);
    if (wait) return wait;
    // The same rig row while the page names the same rig, so its model is reused across re-renders (rigModelOf keys on the row).
    const rigKey = JSON.stringify([entry.rigId, entry.rig, entry.conn ?? null, entry.lifecycle ?? "running"]);
    if (this.podRig?.key !== rigKey) this.podRig = { key: rigKey, rig: { id: entry.rigId, name: entry.rig, ...(entry.conn ? { conn: entry.conn } : {}), lifecycleState: entry.lifecycle ?? "running" } };
    const model = this.rigModelOf(this.podRig.rig, nodes.data);
    const podSeats = model.seats.filter((s) => s.pod === podName);
    const nativeSeats = this.read(cx, `/api/native-seats?rig=${encodeURIComponent(entry.rig)}`).data?.seats ?? [];
    const nativeBySession = new Map(nativeSeats.map((ns) => [ns.sessionName, ns]));
    const pageAttention = this.drawAttention(cx), attentionItems = pageAttention.targets();
    const counts = computePulseCounts([{rig:this.podRig.rig,...model,countSeats:podSeats}],attentionItems);
    return v_flex().id(`pod-page-${entry.rigId ?? entry.rig}-${podName}`).gap(12)
      .child(this.title(t, `Pod ${podName} · ${entry.rig}`))
      .child(this.card(t, "Pod", [this.kv(t, [
        ["Rig", entry.rig],
        ["Pod", podName],
        ["Seats", `${podSeats.length} (${counts.working} working · ${needsYouText(counts.needs)}${counts.gone?` · ${counts.gone} unreachable`:""} · ${counts.idle} idle${counts.unreported?` · ${counts.unreported} not reported`:""})`],
      ])]))
      .child(this.card(t, "Seats", podSeats.length
        ? podSeats.map((s) => {
            const ns = nativeBySession.get(s.session);
            const seatNeed = pageAttention.seatNeed(s.session, entry.rig, s.logicalId);
            return this.seatChip(t, this.podRig.rig, s, model.lifecycle, { nativeSeat: ns, seatNeed });
          })
        : [this.dim(t, `No seats in pod ${podName}.`)]));
  }

  /** One-line clickable pulse status strip at top of Topology. */
  pulseStrip(t, modelList, attentionItems, updatedAt, entry = {}, { stale = false } = {}) {
    const counts = computePulseCounts(modelList, attentionItems);
    const pulseFilter = this.pulseFilter ?? null;
    const focused = shared("rig.focus") === "pulse" || entry?.focus === "pulse";
    const topoForFold = modelList.map((m) => ({
      id: m.rig.id,
      name: m.rig.name,
      pods: (m.pods ?? []).map((p) => (Array.isArray(p) ? { name: p[0], seats: p[1] } : p)),
    }));
    const toggleFilter = (key) => {
      const cur = this.pulseFilter ?? null;
      this.pulseFilter = cur === key ? null : key;
    };
    const seg = (id, key, label, color, mark = null) => {
      const active = key === null ? !pulseFilter : pulseFilter === key;
      return h_flex().id(id).px(8).h(22).gap(5).items_center().cursor_pointer()
        .bg(active ? t.accent : t.raised)
        .hover((s) => s.bg(active ? t.accent : t.hover))
        .on_click((_e, cx) => { if (key === null) this.pulseFilter = null; else toggleFilter(key); cx?.notify?.(); })
        .tooltip(key === "gone" ? TERMINAL_GONE_TOOLTIP : key === null ? "Show every seat again" : key === "needs" ? "Show only the seats waiting on you (click again for all)" : key === "idle" ? "Show only the idle, done or stopped seats (click again for all)" : key === "unreported" ? "Show only the seats that haven't reported a status (click again for all)" : `Show only the seats that are ${key} (click again for all)`)
        .when(!!mark, (el) => el.child(this.dot(t, mark, 12)))
        .child(div().text_size(11.5).text_color(active ? (t.solid_foreground ?? t.background) : color).font_medium().child(label));
    };
    const ageSec = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : 0;
    const seatsTab=(entry.topologyTab??this.activePageView)==='seats';
    return h_flex().id("topology-pulse-strip").px(10).py(6).min_h(34).gap(8).flex_wrap().items_center().rounded(8)
      .bg(t.background).border_1().border_color(focused ? t.accent : t.border)
      .child(h_flex().id("pulse-filter-group").gap(0).flex_wrap().rounded(6).border_1().border_color(t.border).items_center()
        .child(seg("pulse-filter-all", null, "All", t.foreground))
        .child(seg("pulse-filter-working", "working", `${counts.working} working`, t.ansi2, "working"))
        .child(seg("pulse-filter-blocked", "blocked", `${counts.blocked} blocked`, t.blocked, "blocked"))
        .child(seg("pulse-filter-needs", "needs", needsYouText(counts.needs), t.blocked, "needs_input"))
        .child(seg("pulse-filter-idle", "idle", `${counts.idle} idle`, t.muted, "idle"))
        .when(counts.gone>0,el=>el.child(seg("pulse-filter-gone","gone",`${counts.gone} unreachable`,t.blocked,"terminal_gone"))) // only while a tmux server is gone
        .when(counts.unreported>0,el=>el.child(seg("pulse-filter-unreported","unreported",`${counts.unreported} not reported`,t.dim,"unknown"))))
      .child(div().flex_1())
      .when(!seatsTab,el=>el.child(h_flex().id("topology-expand-all").tooltip("Open every rig and pod").px(8).h(22).items_center().rounded(6).cursor_pointer()
        .bg(t.raised).border_1().border_color(t.border).hover((s) => s.bg(t.hover))
        .on_click(() => setShared("rig.open.page", expandAllTopology(shared("rig.open.page"), topoForFold)))
        .child(div().text_size(11.5).text_color(t.foreground).child("Expand all"))))
      .when(!seatsTab,el=>el.child(h_flex().id("topology-collapse-all").tooltip("Close every rig and pod").px(8).h(22).items_center().rounded(6).cursor_pointer()
        .bg(t.raised).border_1().border_color(t.border).hover((s) => s.bg(t.hover))
        .on_click(() => setShared("rig.open.page", collapseAllTopology(shared("rig.open.page"), topoForFold)))
        .child(div().text_size(11.5).text_color(t.foreground).child("Collapse all"))))
      .child(stale
        ? div().id("topology-pulse-stale").text_size(11).text_color(t.blocked).child(`stale · ${formatStaleAge(updatedAt)}`)
        : div().text_size(11).text_color(t.dim).child(`updated ${ageSec}s ago`));
  }

  pulseFilterBar(t, models, attentionItems) {
    const filter = this.pulseFilter;
    const hidden = models.reduce((n, model) => n + model.seats.filter(seat => !matchesPulseFilter(seat, model, filter, attentionItems)).length, 0);
    const label = { idle: "Idle", working: "Working", blocked: "Blocked", needs: "Needs you", unreported:"Not reported", gone: "Unreachable" }[filter] ?? filter;
    return h_flex().id("pulse-filter-notice").gap(8).items_center().text_size(12).text_color(t.muted)
      .child(`Showing ${label} · ${hidden} hidden`)
      .child(div().id("pulse-show-all").tooltip("Clear the filter and show every seat").text_color(t.accent).cursor_pointer()
        .on_click((_e, cx) => { this.pulseFilter = null; cx.notify(); }).child("Show all"));
  }

  /** An entry that names its rig only by name (a cell header's, say) gets the id from the rig list; else a status view. */
  withRigId(t, cx, entry, rigName) {
    if (entry.rigId) return { entry };
    const summary = this.read(cx, "/api/rigs/summary");
    const wait = this.status(t, cx, "/api/rigs/summary", summary);
    if (wait) return { view: wait };
    const rig = summary.data.find((r) => r.name === rigName || r.id === rigName);
    return rig ? { entry: { ...entry, rigId: rig.id, conn: rig.conn } } : { view: this.dim(t, `No rig ${rigName} on this daemon.`) };
  }

  /** The sidebar's published rows for the connection this page shows. The top-level rows merge every connection, and names repeat across
   *  OpenRigs (every one has a kernel rig, and seats can share names), so a lookup by name reads this connection's own entry. One connection:
   *  the publication itself, as before. */
  pageRigData() {
    const published = this.rigData();
    if ((this.config?.connections?.length ?? 0) <= 1) return published;
    return published?.byConnection ? connectionRows(published, this.activeConnId()) : undefined;
  }
  /** A rig's model, built once per data change and shared by every block that draws the rig: kept per rig row and reused while the same nodes array
   *  and connection come back. Unchanged reads and the sidebar's snapshot keep their identity, so an idle re-render rebuilds nothing; a new read or
   *  snapshot is a new array and builds the model again. rigModel reads nothing else (no clock, no shared state).
   *  The model is shared by every block that draws the rig: a rig row, its nodes array and the returned model are never changed in place. */
  rigModelOf(rig, nodes, conn = this.activeConnId()) {
    if (!rig || typeof rig !== "object") return rigModel(rig, nodes, [], conn);
    const memo = this.rigModels ??= new WeakMap(), hit = memo.get(rig);
    if (hit && hit.nodes === nodes && hit.conn === conn) return hit.model;
    const model = rigModel(rig, nodes, [], conn);
    memo.set(rig, { nodes, conn, model });
    return model;
  }
  /** A rig's nodes: this page's read, else what the sidebar already holds (so a block isn't empty while its own read lands). */
  nodesOf(cx, rigId) {
    const got = this.read(cx, `/api/rigs/${encodeURIComponent(rigId)}/nodes`);
    const snapshot = this.pageRigData();
    const nodes = snapshot?.nodesByRig?.[rigId];
    const picked = nodes !== undefined && (got.data === undefined || (!got.error && snapshot?.at && got.sharedAt !== snapshot.at))
      ? { ...got, data: nodes } : got;
    // The seats of a tmux server this connection's OpenRig reports unreachable read "unreachable", from the page's own read too. Its health
    // is the running sidebar's copy, else the page's own read of /healthz (never a closed sidebar's last one, which would keep seats gone).
    const marked = this.markedNodes(picked.data, this.pageHealthz(cx, snapshot), rigId);
    return marked === picked.data ? picked : { ...picked, data: marked };
  }
  /** This connection's `/healthz` as the page uses it: the running sidebar's copy, else the page's own read (never a closed sidebar's last one). */
  pageHealthz(cx, snapshot = this.pageRigData()) {
    return this.attentionFromSidebar === this.activeConnId() ? snapshot?.healthz : cx ? steadyHealthz(this.read(cx, "/healthz").data) : null;
  }
  /** System › Health's rows: one per tmux server this connection's OpenRig reports unreachable, with its seat count (from every rig's
   *  nodes); the socket path is in the tooltip only. None without an outage, for an older OpenRig, or a server reading anything else. */
  terminalServerRows(t, cx, rigs, nodes) {
    const healthz = this.pageHealthz(cx);
    if (!(healthz?.terminals?.servers ?? []).some((s) => s?.state === "unreachable")) return [];
    // This connection's seats only (the page's own snapshot, never the merged one), and no archived rig.
    const all = { ...(this.pageRigData()?.nodesByRig ?? {}) };
    const ownRigs = this.read(cx, "/api/rigs/summary").data ?? this.pageRigData()?.topology ?? []; // this connection's rigs, never the merged list
    for (const r of ownRigs) if (r?.id && !r.archivedAt && all[r.id] === undefined) all[r.id] = this.nodesOf(cx, r.id).data ?? [];
    const outage = terminalOutage(healthz, all);
    return (outage?.servers ?? []).map((server, i) => h_flex().id(`health-terminal-server-row-${i}`).gap(8).items_center()
      .child(div().id(`health-terminal-server-${i}`).flex_1().min_w(0).text_size(12).text_color(t.blocked)
        .tooltip(`${server.socket}${server.cause ? ` · ${server.cause}` : ""}`).child(terminalServerRowText(server)))
      .child(div().id(`health-terminal-server-copy-${i}`).flex_none().px(6).py(3).rounded(4).text_size(12).text_color(t.accent).cursor_pointer()
        .hover((s) => s.bg(t.hover)).tooltip("Copy OpenRig's own report on this machine").on_click((_e, cx) => cx.write_to_clipboard("rig doctor")).child("Copy rig doctor")));
  }
  /** The Rig page's notice when `n` of its seats sit on an unreachable tmux server (pulse count `gone`), with Copy rig doctor. */
  terminalOutageNotice(t, n) {
    if (!n) return null;
    const machine = this.activeConfig()?.daemonMachine ?? null;
    return h_flex().id("rig-terminal-outage-notice").gap(8).items_center().px(10).py(6).rounded(6).bg(t.raised)
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.blocked).child(terminalOutageNotice(n, machine)))
      .child(div().id("rig-terminal-outage-copy").flex_none().px(6).py(3).rounded(4).text_size(12).text_color(t.accent).cursor_pointer()
        .hover((s) => s.bg(t.hover)).tooltip("Copy OpenRig's own report on this machine").on_click((_e, cx) => cx.write_to_clipboard("rig doctor")).child("Copy rig doctor"));
  }
  /** `nodes` with the seats of `healthz`'s unreachable tmux servers marked (withTerminalOutage), kept per nodes array and outage (which seats
   *  are gone), so the rig's model is built again only when the nodes or the outage change, not on every health read during one. */
  markedNodes(nodes, healthz, rigId) {
    if (!Array.isArray(nodes)) return nodes;
    const outage = terminalOutage(healthz, { [rigId]: nodes });
    if (!outage) return nodes;
    const key = JSON.stringify(outage.servers.map((s) => [s.socket, s.seats]));
    const memo = this.markedNodeMemo ??= new WeakMap(), hit = memo.get(nodes);
    if (hit && hit.key === key) return hit.marked;
    const marked = withTerminalOutage(nodes, outage);
    memo.set(nodes, { key, marked });
    return marked;
  }

  // ---- visible screen narration: public transcript tails, never runtime/harness files -----------------------------
  resetNowTails(cx) {
    this.nowTails?.close(); this.nowDue = true; this.nowWidths = Object.create(null); this.nowSignature = null;
    this.nowTails = new NowTailCache(async seat => {
      // The seat's own connection (named when it was queued), as the settings say now: never the page shown when the request leaves.
      const cfg = seat.conn ? configOfConnection(this.config, seat.conn) : this.activeConfig();
      if (!cfg) return { ok: false, error: "This seat's OpenRig is no longer set up." };
      const op = gatedOperationOrRefusal(cfg?.connectionId);
      const origin = await this.resolveDaemonUrl(cfg);
      if (!origin) return { ok: false, error: "OpenRig daemon is unavailable." };
      const response = await op.fetch(`${origin}/api/transcripts/${encodeURIComponent(seat.session)}/tail?lines=40`);
      const data = await response.json(); return { ok: response.ok, status: response.status, data };
    }, () => this.noteAnswer(cx));
  }
  refreshNowTails(cx) {
    if (!this.nowTails || this.closed || !this.config || this.config.missing) return;
    const seats = [...(this.nowSeats?.values() ?? [])], signature = seats.map(s => `${s.key}:${s.open ? "open" : s.status}`).join("|");
    if (!this.nowDue && signature === this.nowSignature) return;
    this.nowDue = false; this.nowSignature = signature;
    // This is called only by native render, not by a poll callback. The current page has no virtual-range API:
    // use the approved expanded-rig/pod fallback, bounded by NowTailCache to 12 seats and four requests.
    cx.spawn(async () => { this.nowTails?.refresh(seats); });
  }
  /** A seat as the screen-text cache knows it: its connection and session (two OpenRigs can run seats with the same name). The legacy
   *  connection keeps the bare session, so one connection is unchanged. */
  nowSeat(seat) {
    const conn = seat.conn ?? this.activeConnId() ?? LEGACY_CONNECTION_ID;
    return { ...seat, conn, key: conn === LEGACY_CONNECTION_ID ? seat.session : JSON.stringify([conn, seat.session]) };
  }
  nowLines(t, state, key) {
    return v_flex().max_h(240).overflow_y_scrollbar().p(8).gap(3).rounded(6).bg(t.raised)
      .children(state.lines.map((line, i) => this.plain(t, line, `now-lines-${key}-${i}`).font_family("Geist Mono").text_size(11.5)));
  }
  nowTranscript(seat) {
    const file = this.pageTranscriptPath(seat.rig, seat.session); // the page's own OpenRig, and none on a machine
    return file ? () => this.push(fileEntry(file, `${seat.logicalId ?? seat.session} transcript`)) : null;
  }
  nowRow(t, seat, openSeat) {
    const state = nowTailPresentation(this.nowTails?.records.get(this.nowSeat(seat).key),Date.now(),this.uiTimezone);
    const openTranscript = this.nowTranscript(seat);
    const line = h_flex().w_full().h(20).min_w(0).gap(4).items_center().overflow_hidden().text_size(12)
      .when(state.stale, el => el.child(div().flex_none().text_color(t.dim).child(state.prefix)));
    const rowText = seat.word === "working" || seat.status === "active" || seat.status === "working"
      ? state.line.replace(/^Working\s*/, "") : state.line;
    const working = state.working && !state.stale ? state.line.split(" · ")[0] : "";
    const rowWorking = working ? rowText.split(" · ")[0] : "";
    if (rowWorking) line.child(div().flex_none().text_color(t.ansi2 ?? t.working).child(rowWorking));
    // The existing HoverCard below reveals the full line and transcript; keep one hover channel.
    line.child(div().flex_1().min_w(0).truncate().text_color(state.stale ? t.dim : t.muted).child(rowWorking ? rowText.slice(rowWorking.length) : rowText));
    const link = (id, label, act, tip) => div().id(id).tooltip(tip).text_size(12).text_color(act ? t.accent : t.dim)
      .when(!!act, el => el.cursor_pointer()).on_click((_e, cx) => { cx.stop_propagation(); act?.(); }).child(label);
    const hover = v_flex().w(420).p(12).gap(8).rounded(8).bg(t.background).border_1().border_color(t.border)
      .child(div().text_size(12).text_color(t.muted).child(`${seat.logicalId} · ${state.state} · as of ${state.asOf}`))
      .child(div().text_size(12).text_color(state.stale ? t.dim : t.foreground).child(`${state.prefix}${state.line}`))
      .child(this.nowLines(t, state, `hover-${seat.session}`))
      .child(h_flex().gap(12).child(link(`now-seat-${seat.session}`, "Open seat", openSeat, `Open ${seat.logicalId}'s page`))
        .child(link(`now-transcript-${seat.session}`, "Open transcript", openTranscript, `Open ${seat.logicalId}'s transcript`)));
    return div().id(`seat-now-${seat.session}`).flex_1().min_w(0)
      .on_size_change((size, cx) => {
        const visible = size.width >= 160;
        if (this.nowWidths?.[seat.session] !== visible) { (this.nowWidths ??= Object.create(null))[seat.session] = visible; cx.notify(); }
      })
      .when(Boolean(state.line) && this.nowWidths?.[seat.session] !== false, el => el.child(HoverCard.new(`now-hover-${seat.session}`).open_delay(600).trigger(line).content(hover)));
  }
  nowBlock(t, seat, openTranscript) {
    const state = nowTailPresentation(this.nowTails?.records.get(this.nowSeat(seat).key),Date.now(),this.uiTimezone);
    const { compact } = pageBodyLayout(this.pageWidth);
    return this.card(t, "Now", [
      (compact ? v_flex() : h_flex()).id("seat-now-meta").w_full().gap(8).when(!compact, el => el.items_center()).child(div().when(!compact, el => el.flex_1()).min_w(0)
        .child(this.plain(t, `as of ${state.asOf} · ${state.state}${state.stale || state.state === "withheld" ? ` · ${state.reason}` : ""}`, "seat-now-state").text_size(11.5).text_color(t.muted)))
        .child(div().flex_none().id("seat-now-open-transcript").tooltip("Open this seat's transcript").text_size(12).text_color(t.accent).cursor_pointer().on_click(openTranscript).child("Open transcript")),
      div().id("seat-now-summary").text_size(12.5).text_color(state.stale ? t.dim : t.foreground)
        .child(state.line ? `${state.prefix}${state.line}` : "No recent screen text from OpenRig."),
      ...(state.errorDetail ? [this.errorText(t,`seat-now-error-${seat.session}`,state.errorDetail)] : []),
      ...(state.lines.length ? [this.nowLines(t, state, `page-${seat.session}`)] : []),
    ]);
  }

  invalidateLiveReads({ seatStatus = false } = {}) {
    this.nowDue = true;
    // /healthz is the page's own read only while no running sidebar is its source (a sidebar refresh carries its reading): with one, a
    // refresh re-reads nothing extra, as before; without one, at most once per live refresh.
    const ownHealth = !this.attentionFromSidebar || this.attentionFromSidebar !== this.activeConnId();
    const cache=this.cache;
    const retrySpec=path=>Boolean(cache[path]?.error)&&![404,405,410,501].includes(cache[path].status);
    markStale(cache, (path) => (seatStatus && seatStatusRead(path)) || path==='/api/config/ui.timezone' || (ownHealth && path === '/healthz') || path.startsWith('/api/views/execution?') || (path.startsWith("/api/rigs")&&(!path.endsWith("/spec.json")||retrySpec(path))) || path.startsWith("/api/attention") || path.startsWith("/api/health") || path.startsWith("/api/native-seats") || path.startsWith("/api/queue") || path.startsWith("/api/gateway"));
  }

  /** The sidebar doesn't mirror handoff history, workflow execution or request detail. Keep those shown-page reads live without polling full attention. */
  refreshUnmirrored(cx) {
    if(this.closed)return;
    const live=this.drawSpaces(),space=live.find(s=>s?.active),own=this.propsSpaceId??this.ownSpace?.id;
    if(live.length&&(!space||(own&&space.id!==own)))return;
    if(this.tabId&&!(space?.tabs??[]).some(t=>t.id===this.tabId&&(t.active===true||space.tabs.length===1)))return;
    const conn=this.activeConnId(),now=Date.now(),last=(this.unmirroredAt??={})[conn];
    if(last===undefined){this.unmirroredAt[conn]=now;return;}
    if(now>=last&&now-last<60000)return;
    this.unmirroredAt[conn]=now;
    const matches=path=>seatStatusRead(path)||path==='/api/health'||path==='/api/health?status=cleared'||/^\/api\/rigs\/[^/]+\/graph$/.test(path)||path.startsWith('/api/views/execution?')||path.startsWith('/api/queue/recent-transitions?')||path.startsWith('/api/queue/hosted-members:')||(/^\/api\/queue\/[^/?]+$/.test(path)&&path!=='/api/queue/attention-aggregate');
    if(!Object.keys(this.cache).some(matches))return;
    markStale(this.cache,matches);cx.notify();
  }

  /** One rig as a block: header with status counts, action bar, health banner, Edges, then pods as lines of seat chips.
   *  Used on the Topology page and, alone, in the inspector. A filter that leaves nothing of the rig leaves its header, dim. */
  rigBlock(t, cx, rig, { entry = {}, rigCount = 1, attentionItems = null, pageAttention = null, allSeats = [], allowPulseFilter = false } = {}) {
    const { compact, tight, graphHidden } = pageBodyLayout(this.pageWidth);
    const pageAttn = pageAttention ?? this.drawAttention(cx);
    attentionItems = attentionItems ?? pageAttn.targets();
    const nodesPath = `/api/rigs/${encodeURIComponent(rig.id)}/nodes`;
    const nodes = this.nodesOf(cx, rig.id);
    const model = this.rigModelOf(rig, nodes.data);
    const lifecycle = model.lifecycle;
    const knownLifecycle=['running','stopped','recoverable','degraded','attention_required'].includes(lifecycle);
    const stoppedRig = isRigStopped(lifecycle, model.seats);
    const focusRig = entry.focusRig ?? shared("rig.focusRig");
    const focusKey = shared("rig.focus") ?? entry.focus;
    const focused = (focusRig != null && (focusRig === rig.id || focusRig === rig.name)) ||
      focusKey === `rig:${rig.id}` || focusKey === `rig:${rig.name}`;
    const here = (entry.kind === "rig" && (entry.rigId === rig.id || entry.name === rig.name)) || focused;
    const dedicated=entry.kind==="rig"&&(entry.rigId===rig.id||entry.name===rig.name);
    const open = shared("rig.open.page") ?? {};
    const explicitById = open[rigKey(rig.id)];
    const explicitByName = open[rigKey(rig.name)];
    const explicitOpen = explicitById !== undefined ? explicitById : explicitByName;
    const expanded = explicitOpen === undefined && here
      ? true
      : explicitOpen !== undefined && explicitById === undefined
        ? Boolean(explicitOpen) || model.seats.filter((s) => s.tone === "blocked").length > (open[`${rigKey(rig.name)}:blocked`] ?? 0)
        : rigFoldOpen(rig, model.seats, open);
    let seats = model.seats;
    const f = this.filter?.toLowerCase();
    const pulseFilter = allowPulseFilter ? this.pulseFilter ?? null : null;
    let noMatch = false;
    if (f) {
      const has = (v) => String(v ?? "").toLowerCase().includes(f);
      const rigHit = [rig.name, lifecycle, ...model.seats.flatMap((s) => [s.host, s.spec])].some(has);
      if (!rigHit) seats = seats.filter((s) => [s.logicalId, s.pod, s.host, s.spec, s.runtime, s.word, s.tone, s.tone === "blocked" ? "needs you" : null].some(has));
      noMatch = !seats.length;
    }
    if (pulseFilter) {
      seats = seats.filter((s) => matchesPulseFilter(s, model, pulseFilter, attentionItems, allSeats.length ? allSeats : model.seats));
      noMatch = !seats.length;
    }
    const counts = computePulseCounts([{ rig, ...model }], attentionItems);
    // Seats whose tmux server stopped answering, by their own status: the pulse counts put one that owns a request under needs you instead.
    const goneSeats = model.seats.filter((s) => s.status === "terminal_gone").length;
    const tone = counts.needs ? "needs_input" : counts.blocked ? "blocked" : counts.gone ? "gone" : counts.working ? "working" : rigTone(model.seats);
    const target = { kind: "rig", rig: rig.name, rigId: rig.id, conn: rig.conn, lifecycle };
    const operatorDisabled = rigOperatorDisabled(this.config, this.sharedOnce, target);
    if (operatorDisabled) target.operatorDisabled = true;
    const canResume = !operatorDisabled && knownLifecycle && (stoppedRig || lifecycle !== "running");
    const viewTarget = { kind: "rig", rig: rig.name, rigId: rig.id, conn: rig.conn, view: `rig:${rig.name}` };
    const dialog = (step, height) => this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height, props: { target, step } });
    const more = () => this.moreButton(t, `rig-more-${rig.id}`, () => this.menu(target));
    const showBody = dedicated || expanded && (!noMatch || Boolean(pulseFilter));
    const rigRowKey = rigKey(rig.id);
    const rigEntry = { section: "topology", kind: "rig", rigId: rig.id, conn: rig.conn, name: rig.name };
    this.pageRows?.push({ key: rigRowKey, foldKey: rigRowKey, expandable: true, isOpen: expanded, entry: rigEntry, target, seats: model.seats });
    const rigSelected = this.pageSel === rigRowKey;
    const resume = () => this.button(t, `rig-resume-${rig.id}`, "Resume…", () => dialog({ action: "resume", confirm: true }, 380), { tip: `Resume ${rig.name}: asks before starting its seats`, small: true, iconName: "rig-play" });
    const operatorOff = () => div().id(`rig-operator-off-${rig.id}`).text_size(12).text_color(t.dim)
      .tooltip("OpenRig was started with its operator turned off, so there's nothing to resume here.").child("operator off");
    // A count filters the page to seats in that state.
    const count = (n, word, color, key, shown = word) => n ? h_flex().id(`rig-count-${key}-${rig.name}`).tooltip(key === "gone" ? TERMINAL_GONE_TOOLTIP : key === "needs" ? `Show only ${rig.name}'s seats that need you` : key === "unreported" ? `Show only ${rig.name}'s seats that haven't reported a status` : `Show only ${rig.name}'s seats that are ${word}`).gap(4).items_center().cursor_pointer().on_click(() => { this.push({ ...(entry.section ? entry : { section: "topology" }), filter: word }); })
      .child(div().text_size(11.5).text_color(color === "working" ? (t.ansi2 ?? t.working) : color === "blocked" ? t.blocked : color==="dim"?t.dim:t.muted).child(`${n} ${shown}`)) : null;
    const lifecycleText = knownLifecycle ? statusWord(lifecycle, "rig") : "state not reported";
    if(dedicated)this.pageHeading={title:rig.name,tone,status:`${lifecycleText} · ${counted(model.seats.length, "seat")} · ${counts.working} working · ${needsYouText(counts.needs)}${counts.gone?` · ${counts.gone} unreachable`:""} · ${counts.idle} idle${counts.unreported?` · ${counts.unreported} not reported`:""}`};
    const head = h_flex().id(`rig-head-${rig.id}`).tooltip(`Double-click to open ${rig.name}'s page; right-click for its actions`).px(4).when(!compact, el => el.h(30)).when(compact, el => el.flex_wrap().py(4)).gap(8).items_center().rounded(6).hover((s) => s.bg(t.hover))
      .when(rigSelected, (e) => e.bg(t.selection ?? `${t.accent}1f`).border_l(2).border_color(t.accent))
      .on_click((e, cx) => { if ((e?.click_count ?? 1) >= 2) this.push(rigEntry); else this.selectPageRow(rigRowKey, cx); })
      .on_mouse_down("right", () => this.menu(target))
      .child(div().id(`rig-fold-${rig.id}`).tooltip(`${expanded ? "Close" : "Open"} ${rig.name}`).w(14).flex_none().text_color(t.dim).on_click((_e, cx) => { cx?.stop_propagation?.(); toggleOpen(rigKey(rig.id), expanded, model.seats); })
        .child(svg(icon(expanded ? "chevron-down" : "chevron-right")).size(12)))
      .child(this.dot(t, tone))
      .child(div().id(`rig-name-${rig.id}`).text_size(13).font_semibold().text_color(t.foreground).cursor_pointer().hover(el=>el.underline())
        .tooltip(`Open ${rig.name}`).on_click((_e,cx)=>{cx.stop_propagation();this.push({...rigEntry,tab:"table"});}).child(rig.name))
      .when(!tight, el => el.child(div().text_size(12).text_color(t.muted).child(`${lifecycleText} · ${counted(model.seats.length, "seat")}`)))
      .child(h_flex().id(`rig-counts-${rig.id}`).gap(8).when(compact, el => el.w_full().flex_wrap())
        .children([count(counts.working, "working", "working", "working"), count(counts.blocked, "blocked", "blocked", "blocked"), count(counts.needs, "needs you", "blocked", "needs", needsYouWord(counts.needs)), count(counts.gone ?? 0, "unreachable", "blocked", "gone"), count(counts.idle, "idle", "idle", "idle"),count(counts.unreported,"not reported","dim","unreported")].filter(Boolean)))
      .when(noMatch, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("no matching seats")))
      .child(div().flex_1())
      .when(!showBody && canResume, (el) => el.child(resume()))
      .when(!showBody && operatorDisabled, (el) => el.child(operatorOff()))
      .when(!showBody, (el) => el.child(more()));
    const body = [];
    if (showBody) {
      const rigConnCfg = rig.conn ? configOfConnection(this.config, rig.conn) : this.activeConfig();
      const followed = (this.hostLists().strip?.views ?? []).find((v) => v.following?.target === `rig:${rig.name}`);
      const on = this.hostWorkerEntry(`rig:${rig.name}`, rig.conn ? configOfConnection(this.config, rig.conn) : this.config)?.following??!!followed?.following?.enabled;
      const caps = this.caps();
      // Every seat sits on a tmux server that stopped answering: a worker view or Follow would only fail (some seats still reachable: kept).
      const rigGone = model.seats.length > 0 && goneSeats === model.seats.length ? TERMINAL_GONE_RIG_REASON : null;
      const workerReason = rigGone ?? capabilityDisableReason("open-view", caps);
      const workerMachine = rigConnCfg?.daemonMachine || (isLoopbackDaemonUrl(rigConnCfg?.daemonUrl) ? "this computer" : "OpenRig's machine");
      const followReason = (on ? null : rigGone) ?? capabilityDisableReason(on ? "unfollow" : "follow", caps); // turning Follow off needs no tmux server
      this.inPageActions=dedicated;
      const actionBar=h_flex().gap(6).items_center().flex_wrap()
        .child(this.button(t, `rig-worker-view-${rig.id}`, "Worker view", () => this.oneClick(viewTarget, "open-view", `rig-worker-view-${rig.id}`), { small: true, iconName: "rig-view", disabled: !!workerReason, tooltip: workerReason??(caps.hostWorkerViews?`Opens ${rig.name}'s seats as tiles in Herdr tabs. Tiles run on ${workerMachine}.`:null), tip: `Open ${rig.name}'s seats as tiles in a worker view`, actionKey: "open-view", conn: rig.conn ?? this.shownConnId() }))
        .child(this.button(t, `rig-follow-${rig.id}`, on ? "Following" : "Follow", () => this.oneClick(viewTarget, on ? "unfollow" : "follow", `rig-follow-${rig.id}`), { tip: on ? `Stop updating ${rig.name}'s worker view; the view stays open as it is` : `Keep a worker view of ${rig.name} open and up to date`, small: true, iconName: on ? "check" : "rig-follow", disabled: !!followReason, tooltip: followReason, actionKey: on ? "unfollow" : "follow", conn: rig.conn ?? this.shownConnId() }))
        .child(this.button(t, `rig-snapshot-${rig.id}`, "Snapshot", () => this.oneClick({ kind: "rig", rig: rig.name, rigId: rig.id, conn: rig.conn }, "snapshot", `rig-snapshot-${rig.id}`), { tip: `Take a snapshot of ${rig.name} now, to restore later`, small: true, iconName: "rig-snapshot", actionKey: "snapshot", conn: rig.conn ?? this.shownConnId() }))
        .when(knownLifecycle && !stoppedRig && lifecycle !== "stopped", (el) => el.child(this.button(t, `rig-pause-${rig.id}`, "Pause…", () => dialog({ action: "pause", load: "pause" }, 360), { tip: `Pause ${rig.name}: asks before stopping its seats`, small: true, iconName: "rig-pause" })))
        .when(canResume, (el) => el.child(resume()))
        .child(div().flex_1()).when(operatorDisabled, (el) => el.child(operatorOff())).child(more());
      this.inPageActions=false;
      if(dedicated)this.pageActions=actionBar;else body.push(actionBar);
      if(!knownLifecycle)body.push(this.dim(t,"OpenRig hasn't reported this rig's state yet, so Pause and Resume aren't offered."));
      if (dedicated && goneSeats) body.push(this.terminalOutageNotice(t, goneSeats)); // its seats' tmux server stopped answering
      const rigStatusKey = spaceStatusKey(rig.conn ?? this.activeConnId(), rig.id, (this.config?.connections ?? []).length > 1);
      const rigSpaceOpening = shared("rig.spaceOpening")?.[rigStatusKey];
      const rigSpaceStatus = shared("rig.spaceStatus")?.[rigStatusKey];
      if (rigSpaceOpening) {
        body.push(h_flex().id(`opening-rig-space-${rig.id}`).px(10).py(8).gap(10).rounded(6).bg(t.raised).items_center().flex_wrap()
          .child(div().flex_1().min_w(180).text_size(12).text_color(t.muted).child(String(rigSpaceOpening))));
      } else if (rigSpaceStatus?.needsConsent && rigConnCfg && (!rigSpaceStatus.confirmation?.origin || rigOrigin(rigSpaceStatus.confirmation.origin) === rigOrigin(rigConnCfg.daemonUrl))) {
        const waitingMachine = rigSpaceStatus.confirmation?.machine ?? rigConnCfg.daemonMachine ?? "the machine";
        body.push(h_flex().id(`waiting-helper-${rig.id}`).px(10).py(8).gap(10).rounded(6).bg(t.raised).items_center().flex_wrap()
          .child(div().flex_1().min_w(180).text_size(12).text_color(t.foreground).child(`Waiting for you to approve the helper on ${waitingMachine}`))
          .child(this.button(t, `approve-helper-${rig.id}`, "Approve helper…", () => runFor(rigConnCfg)(commandFor("rig.approve-helper", rigConnCfg, rig.id)), { tip: `Approve herdrig's helper on ${waitingMachine} so this rig's actions can run there`, small: true })));
      }
      const workerLine=this.hostWorkerLine(t,rig);if(workerLine)body.push(workerLine);
      const capReasons = [...new Set([workerReason, followReason].filter(Boolean))];
      if (capReasons.length) {
        body.push(this.workerCapabilityNote(t, capReasons.join(" · "), `rig-cap-note-${rig.id}`));
      }
      if(!dedicated)body.push(this.objectTabs(t,{...rigEntry,tab:"table"},null,{prefix:`rig-${rig.id}`,active:"table",cx}));
      if (dedicated) {
        const activeRigTab = entry.tab ?? (entry.openRecent ? "recent" : "table");
        if (activeRigTab === "overview") {
          const distinctHosts = [...new Set(model.seats.map((s) => s.host ?? "local"))].join(", ") || "local";
          const podNames = [...new Set(model.seats.map((s) => s.pod ?? "default"))].join(", ") || "—";
          body.push(v_flex().id(`rig-overview-${rig.id}`).child(this.card(t, "Overview", [this.kv(t, [
            ["Rig", rig.name],
            ["Rig ID", rig.id, true],
            ["Lifecycle", lifecycleText],
            ["Spec", rig.specName ?? rig.spec ?? model.seats[0]?.spec ?? "—"],
            ["Hosts", distinctHosts],
            ["Pods", podNames],
            ["Seats", `${model.seats.length} (${counts.working} working · ${needsYouText(counts.needs)}${counts.gone?` · ${counts.gone} unreachable`:""} · ${counts.idle} idle${counts.unreported?` · ${counts.unreported} not reported`:""})`],
          ])])));
        } else if (activeRigTab === "graph") {
          const graphPath = `/api/rigs/${encodeURIComponent(rig.id)}/graph`;
          const graphGot = this.read(cx, graphPath);
          const graphView=this.graphFor(`running:${rig.id}`);
          const graphConn=this.activeConnId();
          let topologyChanged=false;
          if(graphGot.data&&graphView.publicData!==graphGot.data){
            const topology=runningGraphTopology(graphGot.data);
            topologyChanged=graphView.orderConnection===graphConn&&graphView.topology!=null&&graphView.topology!==topology;
            graphView.topology=topology;
            graphView.orderConnection=graphConn;
          }
          const exported=this.read(cx,`/api/rigs/${encodeURIComponent(rig.id)}/spec.json`,topologyChanged,null,null,false,topologyChanged);
          const spec=exported.error?null:exported.data;
          const awaitingOrder=exported.loading&&!spec&&!graphView.projection;
          this.wideGraph=true;
          // Made again when the graph, the rig's seats or the live nodes change: a tmux server going or coming back changes the seats, not the graph.
          const liveNodes=nodes.data;
          if(graphGot.data&&!awaitingOrder&&(graphView.publicData!==graphGot.data||graphView.modelSeats!==model.seats||graphView.liveNodes!==liveNodes||graphView.spec!==spec)){
            graphView.projection=normalizeRunningGraph(graphGot.data,model.seats,spec);
            graphView.publicData=graphGot.data;graphView.modelSeats=model.seats;graphView.liveNodes=liveNodes;graphView.spec=spec;
          }
          if(graphHidden)body.push(this.dim(t,"Widen the pane to see the graph.").id(`rig-graph-narrow-${rig.id}`));
          else if(awaitingOrder)body.push(this.skeleton(t));
          else if(graphGot.data){const work=this.graphWorkRows(cx,rig);body.push(graphView.render(t,cx,graphView.projection,{
            id:`rig-graph-${rig.id}`,assets:ASSETS,running:true,reducedMotion:this.config?.reducedMotion===true,
            events:graphActivityOf(shared,this.activeConnId())?.origin===this.activeConfig()?.daemonUrl?graphActivityOf(shared,this.activeConnId()).events:[],
            workRows:work.rows,workReady:work.received===true,
            open:s=>this.push({section:"topology",kind:"seat",rig:rig.name,rigId:rig.id,conn:rig.conn,name:s.lid}),
            menu:s=>this.menu({...s.node,kind:"seat",session:s.session,rig:rig.name,rigId:rig.id,conn:rig.conn,logicalId:s.lid,status:model.seats.find(m=>m.session===s.session)?.status??s.node?.status}),
          }));if(work.error)body.push(this.dim(t,`Work lines couldn't refresh: ${work.error}${work.rows.length?' (showing the last read)':''}`));}
          else body.push(this.status(t,cx,graphPath,graphGot)??this.skeleton(t));
        }
      }
      if(!dedicated||entry.tab!=="overview")body.push(this.rigHealthEdges(t, cx, rig, { entry, rigCount, open }));
      if (nodes.data === undefined) {
        const nodesStatus = this.status(t, cx, nodesPath, nodes);
        if (nodesStatus) body.push(nodesStatus);
      }
      else if(!dedicated||entry.tab==="table")body.push(this.rigPods(t, cx, rig, model, seats, { lifecycle, open, preserveHidden: Boolean(pulseFilter), pageAttention: pageAttn, attentionItems }));
      if(!dedicated||entry.tab==='table'){
        const group=assistantGroup(t,cx,this.hostedMembers(cx),{...rig,conn:rig.conn??this.activeConnId()},{prefix:'page',icon,rows:this.pageRows,folds:shared('rig.open.page')??{},
          fold:(key,open,cx)=>{setShared('rig.open.page',{...(shared('rig.open.page')??{}),[key]:open});this.persistStatePatch(cx);},
          select:(key,_entry,cx)=>this.selectPageRow(key,cx),open:entry=>this.push(entry),menu:(t)=>this.menu(t)});
        if(group)body.push(group);
      }
    }
    return v_flex().id(`rig-block-${rig.id}`).rounded(10).bg(t.background).border_1().border_color(focused ? t.accent : t.border).p(compact ? 4 : 10).gap(6).when(!dedicated,el=>el.child(head))
      .children(body.length ? [v_flex().gap(8)
        .when(!dedicated||entry.tab!=="graph",el=>el.ml(compact ? 8 : 22).pl(compact ? 6 : 10).border_l(1).border_color(t.border))
        .children(body)] : []);
  }

  /** The findings banner (only when the rig has findings), Recent activity disclosure, and Edges disclosure. */
  rigHealthEdges(t, cx, rig, { entry, rigCount, open }) {
    const here = entry.kind === "rig" && (entry.rigId === rig.id || entry.name === rig.name);
    const health = this.read(cx, "/api/health");
    const findings = healthForRig(health.data?.records, rig, this.nodesOf(cx, rig.id).data ?? []).filter(r=>classifyHealth(r).actionable);
    // The graph already draws the relationships. Keep the copyable text list on explicit request.
    const edgesOpen = here && entry.tab === "graph" && pageBodyLayout(this.pageWidth).graphHidden || (open[`edges:${rig.id}`] ?? false);
    const graphPath=`/api/rigs/${encodeURIComponent(rig.id)}/graph`;
    const graph=this.read(cx,graphPath);
    const knownEdges=Array.isArray(graph.data?.edges)?graph.data.edges:null;
    const recentKey = `rig-recent:${rig.name}`;
    const recentOpen = here&&entry.tab==="recent" || (open[recentKey] ?? open[`rig-recent:${rig.id}`] ??
      (entry.openRecent === rig.name || entry.openRecent === rig.id));
    const row = (id, text, on, key, color) => h_flex().id(id).tooltip(`Show or hide ${rig.name}'s edges as text you can copy`).gap(4).items_center().cursor_pointer().on_click(() => toggleOpen(key, on))
      .child(svg(icon(on ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim))
      .child(div().text_size(12).text_color(color).child(text));
    const toggleRecent = () => {
      const cur = shared("rig.open.page") ?? {};
      const next = !recentOpen;
      setShared("rig.open.page", {
        ...cur,
        [recentKey]: next,
        ...(rig.id ? { [`rig-recent:${rig.id}`]: next } : {}),
      });
    };
    const out = [];
    if ((!here||entry.tab==="health"||entry.tab==="table")&&findings.length > 0) {
      const counts = healthCounts(findings);
      const text = counts.problems ? `${counts.problems} problem${counts.problems === 1 ? "" : "s"}` : counts.notes ? `${counts.notes} note${counts.notes === 1 ? "" : "s"}` : "Health";
      out.push(v_flex().id(`rig-health-group-${rig.id}`).gap(4)
        .child(h_flex().id(`rig-health-toggle-${rig.id}`).tooltip(`Open System › Health for ${rig.name}'s ${text}`).gap(6).items_center().cursor_pointer()
          .on_click(() => this.push({ section: "system", subview: "health", healthRigId: rig.id, healthRigName: rig.name }))
          .child(svg(icon(counts.worst === 2 ? "rig-diamond" : counts.problems ? "rig-warning" : "rig-info")).size(12).text_color(counts.worst === 2 ? t.blocked : counts.worst === 1 ? t.working : t.muted))
          .child(div().text_size(12).text_color(counts.worst === 2 ? t.blocked : counts.worst === 1 ? t.working : t.muted).child(`${text} in System → Health`))));
    }
    const recentGroup = v_flex().id(`rig-recent-group-${rig.name}`).gap(4)
      .child(h_flex().id(`rig-recent-toggle-${rig.name}`).tooltip(`Show or hide ${rig.name}'s recent activity`).gap(4).items_center().cursor_pointer().on_click(toggleRecent)
        .child(svg(icon(recentOpen ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim))
        .child(div().text_size(12).text_color(t.muted).child("Recent activity")));
    if (recentOpen) {
      const recentPath = `/api/queue/recent-transitions?scope=rig&rig=${encodeURIComponent(rig.name)}&limit=10`;
      const recentGot = this.read(cx, recentPath);
      recentGroup.child(this.recentTransitionsBlock(t, cx, `rig-recent-${rig.name}`, recentPath, recentGot));
    }
    if(!here||entry.tab==="recent")out.push(recentGroup);
    if(here&&entry.tab==="health"&&!findings.length)out.push(this.dim(t,"No health findings for this rig."));
    const edgesGroup = v_flex().id(`rig-edges-group-${rig.id}`).gap(4)
      .child(row(`rig-edges-toggle-${rig.id}`, `Edges as text (${knownEdges?knownEdges.length:"…"})`, edgesOpen, `edges:${rig.id}`, t.muted));
    if (edgesOpen) {
      const edges = graph.data?.edges ?? [];
      const names=new Map((graph.data?.nodes??[]).map(n=>[n.id,n.data?.logicalId??n.logicalId??n.id]));
      const openGraph=()=>this.push({section:"topology",kind:"rig",rigId:rig.id,conn:rig.conn,name:rig.name,tab:"graph"});
      edgesGroup.child(this.inlineLink(t, cx, `rig-open-graph-${rig.id}`, "Open the graph", openGraph, `Open ${rig.name}'s graph`));
      edgesGroup.child(this.status(t, cx, graphPath, graph) ?? (edges.length
        ? v_flex().gap(pageBodyLayout(this.pageWidth).compact ? 10 : 2).children(edges.map((e, i) => (pageBodyLayout(this.pageWidth).compact ? v_flex() : h_flex()).id(`edge-${rig.id}-${i}`).gap(pageBodyLayout(this.pageWidth).compact ? 2 : 8).px(4).text_size(12).text_color(t.muted)
          .child(this.copyValue(t, `${names.get(e.source)??e.source} → ${names.get(e.target)??e.target}`, `edge-${rig.id}-${i}`, "edge addresses"))
          .child(div().id(`edge-kind-${rig.id}-${i}`).when(pageBodyLayout(this.pageWidth).compact, el => el.pl(8)).text_color(t.dim)
            .child(String(pageBodyLayout(this.pageWidth).compact ? GRAPH_EDGE_LOOK[e.data?.kind ?? e.label]?.word ?? e.data?.kind ?? e.label ?? "" : e.data?.kind ?? e.label ?? "")))))
        : this.dim(t, "No edges.")));
    }
    if(!here||entry.tab==="graph")out.push(edgesGroup);
    return v_flex().gap(6).children(out);
  }

  /** Render the 10 most recent queue transitions for a rig block or System disclosure. */
  recentTransitionsBlock(t, cx, idPrefix, path, got) {
    const activeProject = this.scopesProject(cx);
    const scopePath = activeProject ? `/api/scopes?detail=1&project=${encodeURIComponent(activeProject)}` : "/api/scopes?detail=1";
    const scopesGot = this.read(cx, scopePath);
    const attGot = this.read(cx, "/api/attention");
    const wait = this.status(t, cx, path, got);
    if (wait) return wait;
    const cachedRigs = Array.isArray(this.cache["/api/rigs/summary"]?.data) ? this.cache["/api/rigs/summary"].data : [];
    const fallbackTopology = cachedRigs.map((rig) => ({
      id: rig.id,
      name: rig.name,
      pods: [{
        id: "default",
        seats: (this.cache[`/api/rigs/${encodeURIComponent(rig.id)}/nodes`]?.data ?? []).map((n) => ({
          session: n.canonicalSessionName ?? n.session,
          logicalId: n.logicalId ?? n.name,
        })),
      }],
    }));
    // The page's own connection's rows: a seat is matched by session or name, and those repeat across OpenRigs (every kernel has an operator).
    const own = this.pageRigData();
    const topo = (own?.topology?.length ? own.topology : null) ?? fallbackTopology;
    const missions = Array.isArray(scopesGot.data?.missions) ? scopesGot.data.missions : null;
    const attentionItems = Array.isArray(attGot.data?.items)
      ? attGot.data.items
      : (Array.isArray(own?.attention?.items) ? own.attention.items : null);
    const rows = recentTransitionRows(got.data, topo, { missions, attentionItems, timezone:this.uiTimezone });
    if (!rows.length) return this.dim(t, "Nothing yet.");
    return v_flex().id(`${idPrefix}-list`).gap(2).children(rows.map((r, i) => {
      let el = h_flex().id(`${idPrefix}-row-${i}`).px(6).h(26).overflow_hidden().gap(8).items_center().rounded(6).text_size(12);
      if (r.navEntry) {
        el = el.tooltip("Open what this change was about").cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.push(r.navEntry));
      }
      return el
        .child(div().min_w(70).flex_none().text_color(t.dim).child(r.ts))
        .child(div().w(140).flex_none().truncate().text_color(t.muted).tooltip(String(r.actor??"")).child(r.actor))
        .child(div().w(120).flex_none().truncate().text_color(t.accent).tooltip(String(r.change??"")).child(r.change))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).tooltip(String(r.label??"")).child(r.label))
        .when(!!r.navEntry, (rowEl) => rowEl.child(svg(icon("chevron-right")).size(11).flex_none().text_color(t.dim)));
    }));
  }

  /** Pods and seats as an indented tree (rig > pod > seat > helper) matching the sidebar grammar. */
  rigPods(t, cx, rig, model, seats, { lifecycle, open, preserveHidden = false, pageAttention: passedAttention = null, attentionItems: passedItems = null }) {
    const sharedRig = this.pageRigData()?.topology?.find((row) => row.id === rig.id);
    const detail = sharedRig ? null : this.read(cx, `/api/rigs/${encodeURIComponent(rig.id)}`).data;
    const representative = sharedRig
      ? sharedRig.pods.flatMap((pod) => pod.seats).find((seat) => seat.isRepresentative)?.session
      : detail?.rig?.id === rig.id ? detail.representative : null;
    const { compact, tight } = pageBodyLayout(this.pageWidth);
    if (!seats.length && !preserveHidden) return this.dim(t, this.filter ? "No matching seats." : "No seats.");
    const nativeSeats = this.read(cx, `/api/native-seats?rig=${encodeURIComponent(rig.name)}`).data?.seats
      ?? this.cache["/api/native-seats"]?.data?.seats
      ?? [];
    const nativeBySession = new Map(nativeSeats.map((ns) => [ns.sessionName, ns]));
    const pageAttention = passedAttention ?? this.drawAttention(cx), attentionItems = passedItems ?? pageAttention.targets();
    const hosts = [...new Set(model.seats.map((s) => s.host ?? "local"))];
    const sourceSeats = preserveHidden ? model.seats : seats;
    const groups = hosts.length > 1 ? hosts.map((h) => [h, sourceSeats.filter((s) => (s.host ?? "local") === h)]).filter(([, list]) => list.length) : [[null, sourceSeats]];
    const podLines = (list, host) => {
      const pods = new Map();
      for (const s of list) { if (!pods.has(s.pod)) pods.set(s.pod, []); pods.get(s.pod).push(s); }
      return [...pods].map(([name, source]) => {
        const podSeats = preserveHidden ? source.filter(s => seats.includes(s)) : source;
        const all = model.seats.filter((s) => s.pod === name && (!host || (s.host ?? "local") === host));
        const countText = podSeats.length < all.length ? `${podSeats.length} of ${all.length} shown` : `${all.length} seat${all.length === 1 ? "" : "s"}`;
        const key = podKey(rig.id, name);
        // A filter that matched seats shows them, however big the pod.
        const podOpen = this.filter && open[key] === undefined ? true : podFoldOpen(rig.id, name, all, open);
        const label = name || "—";
        const podId = `${rig.id}-${host ? `${host}-` : ""}${name}`;
        const c = computePulseCounts([{ rig, ...model, countSeats: all }], attentionItems);
        const podEntry = { section: "topology", kind: "pod", rig: rig.name, rigId: rig.id, conn: rig.conn, pod: name, name };
        this.pageRows?.push({ key, foldKey: key, expandable: true, isOpen: podOpen, parentKey: rigKey(rig.id), entry: podEntry, seats: all,
          target: { kind: "pod", rig: rig.name, rigId: rig.id, conn: rig.conn, pod: name, lifecycle } });
        const podSelected = this.pageSel === key;
        const countPills = [[c.working, "working", "working"], [c.blocked, "blocked", "blocked"], [c.needs, "needs you", "blocked", needsYouWord(c.needs)], [c.gone ?? 0, "unreachable", "blocked"], [c.idle, "idle", "idle"],[c.unreported,"not reported","dim"]].filter(([n]) => n)
          .map(([n, word, tone, shown = word]) => div().id(`pod-count-${word.replaceAll(" ", "-")}-${podId}`).text_size(11.5).when(word === "unreachable", (el) => el.tooltip(TERMINAL_GONE_TOOLTIP))
            .text_color(tone === "working" ? (t.ansi2 ?? t.working) : tone === "blocked" ? t.blocked : tone==="dim"?t.dim:t.muted).child(`${n} ${shown}`));
        if (!podOpen && podSeats.length) {
          return h_flex().id(`pod-summary-${podId}`).tooltip(`Open the ${label} pod`).pl(compact ? 0 : 8).pr(compact ? 0 : 8).when(!compact, el => el.h(26)).when(compact, el => el.flex_wrap().py(4)).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
            .when(podSelected, (e) => e.bg(t.selection ?? `${t.accent}1f`).border_l(2).border_color(t.accent))
            .on_click(() => toggleOpen(key, false, all))
            .child(svg(icon("chevron-right")).size(11).flex_none().text_color(t.dim))
            .child(div().text_size(12).font_medium().text_color(t.muted).child(tight ? label : `${label} · ${countText}`))
            .child(h_flex().id(`pod-counts-${podId}`).gap(8).when(compact, el => el.w_full().flex_wrap()).children(countPills))
            .child(div().flex_1()).child(div().text_size(11.5).text_color(t.accent).child("Show all"));
        }
        return v_flex().id(`pod-tree-${podId}`).gap(2)
          .child(h_flex().id(`topo-pod-${podId}`).tooltip(`${podOpen ? "Close" : "Open"} the ${label} pod`).pl(compact ? 0 : 8).pr(compact ? 0 : 8).when(!compact, el => el.h(26)).when(compact, el => el.flex_wrap().py(4)).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
            .when(podSelected, (e) => e.bg(t.selection ?? `${t.accent}1f`).border_l(2).border_color(t.accent))
            .on_click(() => toggleOpen(key, podOpen, all))
            .child(svg(icon(podOpen ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim))
            .child(div().text_size(12).font_medium().text_color(t.foreground).child(label))
            .when(!tight, el => el.child(div().text_size(11.5).text_color(t.dim).child(`· ${countText}`)))
            .child(h_flex().id(`pod-counts-${podId}`).gap(8).when(compact, el => el.w_full().flex_wrap()).children(countPills))
            .child(div().flex_1())
            .when(all.length > 12, (el) => el.child(div().id(`pod-collapse-${podId}`).tooltip(`Close the ${label} pod`).text_size(11.5).text_color(t.dim).cursor_pointer()
              .on_click((_e, cx) => { cx?.stop_propagation?.(); toggleOpen(key, true, all); }).child("Collapse"))))
          .when(!podSeats.length && preserveHidden, el => el.child(div().text_size(12).text_color(t.dim).child(`${all.length === 1 ? "The seat is" : `All ${all.length} seats`} hidden by the filter`)))
          .child(v_flex().gap(2).children(podSeats.map((s) => {
            const ns = nativeBySession.get(s.session);
            const seatNeed = pageAttention.seatNeed(s.session, rig.name, s.logicalId);
            return this.seatChip(t, rig, { ...s, isRepresentative: Boolean(representative && s.session === representative) }, lifecycle, { nativeSeat: ns, seatNeed });
          })));
      });
    };
    return v_flex().gap(6).children(groups.flatMap(([host, list]) => [
      ...(host ? [div().text_size(11).text_color(t.dim).child(`host ${host}`)] : []), ...podLines(list, host)]));
  }

  /** A seat as an indented tree row (rig > pod > seat > helper) with runtime/model badge, slice badge, and quick actions. */
  seatChip(t, rig, s, lifecycle, { nativeSeat = null, seatNeed = null } = {}) {
    const { compact, tight } = pageBodyLayout(this.pageWidth);
    const showNeed = seatNeed && s.status !== "stopping" && !s.restartNeedsAttention;
    const rowStatus = showNeed ? "needs_input" : s.status;
    const limit = rowStatus === "unknown" ? seatUsageLimitWords(s, Date.now(), this.uiTimezone) : null;
    if (!s.terminal) { const seat = this.nowSeat(s); this.nowSeats?.set(seat.key, seat); }
    // With herdr's panes and terminals, as the sidebar passes them: an attached seat tab is found and focused, not skipped.
    const click = this.seatTarget(s.session, s.conn);
    const seatTarget = {
      kind: "seat",
      rig: rig.name,
      rigId: rig.id, ...(rig.conn ? { conn: rig.conn } : {}),
      session: s.session,
      logicalId: s.logicalId,
      lifecycle,
      runtime: s.runtime,
      model: s.model,
      effort: s.effort,
      terminal: s.terminal,
      status: s.status, // the menu reads it (an unreachable seat's terminal actions say why)
    };
    const go = () => {
      if (click.kind === "focus") {
        if (click.stack && click.child) run("layout.select", { stack: click.stack, child: click.child });
        if (click.tab) run("tab.select", { id: click.tab });
        if (click.pane) run("pane.focus", { id: click.pane });
        else run("pane.focus", { terminal: click.terminal });
      }
      else if (click.kind === "select-then-focus") {
        selectWorkerView({ viewId: click.view, viewsProps: stripProps(), spaces, panes, layout, run, stackId: STACK });
        run("pane.focus", { terminal: click.terminal });
      }
      else this.push({ section: "topology", kind: "seat", rig: rig.name, rigId: rig.id, ...(rig.conn ? { conn: rig.conn } : {}), name: s.logicalId, session: s.session });
    };
    const runtimeBadge = [s.runtime, s.model, s.effort].filter(Boolean).join(" · ");
    const helpers = nativeSeat?.children ?? [];
    const sendReason = personDisableReason("send", this.config);
    const queueReason = personDisableReason("queue", this.config);
    const modelReason = personDisableReason("change-model", this.config);
    const quickBtn = (id, label, onClick, { primary = false, disabled = false, tooltip = null } = {}) =>
      h_flex().id(id).px(6).h(20).rounded(5).items_center().cursor_pointer()
        .bg(primary ? t.solid : t.raised).border_1().border_color(t.border)
        .when(disabled, (e) => e.opacity(0.45))
        .when(!disabled, (e) => e.hover((st) => st.bg(primary ? t.solid : t.hover)))
        .text_size(11).text_color(disabled ? t.dim : (primary ? t.solid_foreground : t.muted))
        .when(Boolean(tooltip), (e) => e.tooltip(tooltip))
        .on_click((_e, cx) => { cx?.stop_propagation?.(); if (!disabled) onClick(); })
        .child(label);
    const seatEntry = { section: "topology", kind: "seat", rig: rig.name, rigId: rig.id, ...(rig.conn ? { conn: rig.conn } : {}), name: s.logicalId, session: s.session, pod: s.pod };
    const rowKey = `seat:${s.session}`;
    const hKey = `helpers:${s.session}`;
    const openHelpers = helpers.length > 0 && (shared("rig.open.page") ?? {})[hKey] !== false;
    // A row for the page's keys: ↑/↓, ←/→, Enter opens, S and Q, the Menu key.
    this.pageRows?.push(helpers.length
      ? { key: rowKey, foldKey: hKey, expandable: true, isOpen: openHelpers, parentKey: podKey(rig.id, s.pod), entry: seatEntry, target: seatTarget, open: go }
      : { key: rowKey, expandable: false, parentKey: podKey(rig.id, s.pod), entry: seatEntry, target: seatTarget, open: go });
    const selected = this.pageSel === rowKey;
    const sendGone = s.status === "terminal_gone";
    const send = () => this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: sendGone ? 290 : 260, props: { target: seatTarget, step: { input: true, placeholder: `Message to ${s.session}`, action: "send", multiLine: true, ...(sendGone ? { note: TERMINAL_GONE_SEND_NOTE } : {}) } } });
    const queue = () => this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: 300, props: { target: seatTarget, step: { input: true, placeholder: "One-line summary; the body follows on the next lines", action: "queue", multiLine: true } } });
    const answer = () => quickBtn(`seat-answer-${s.session}`, "Answer", () => {
      openNeed(seatNeed.id, { shared, setShared, run, spaces, panes, layout, items: [seatNeed], conn: seatNeed.conn ?? this.activeConnId(), stay: rigPageOnScreen(), ...(this.perTab() ? { tabId: this.tabId } : {}) });
    }, { primary: true, tooltip: `Answer ${s.logicalId}'s open request` });
    this.seatActions[rowKey] = { send: s.terminal || sendReason ? null : send, queue: s.terminal || queueReason ? null : queue };
    return v_flex().id(`topo-seat-${s.session}`).gap(2)
      // One pattern per row: quiet unless selected; a click on the body selects, a double-click or the
      // name opens; the selected row shows Send… and Queue…; ⋯ is the right-click menu.
      .child(h_flex().id(`topo-seat-row-${s.session}`).tooltip(`Double-click to open ${s.logicalId}; right-click for its actions`).pl(compact ? 0 : 12).pr(compact ? 0 : 8).h(28).gap(compact ? 4 : 6).items_center().rounded(6).cursor_pointer().hover((e) => e.bg(t.hover))
        .when(selected, (e) => e.bg(t.selection ?? `${t.accent}1f`).border_l(2).border_color(t.accent))
        .on_click((e, cx) => { if ((e?.click_count ?? 1) >= 2) go(); else this.selectPageRow(rowKey, cx); })
        .on_mouse_down("right", () => this.menu(seatTarget))
        .child(helpers.length
          ? div().id(`topo-seat-fold-${s.session}`).tooltip(`Show or hide ${s.logicalId}'s helper terminals`).w(12).flex_none().text_color(t.dim)
            .on_click((_e, cx) => { cx?.stop_propagation?.(); setOpen(hKey, !openHelpers); })
            .child(svg(icon(openHelpers ? "chevron-down" : "chevron-right")).size(12))
          : div().w(compact ? 0 : 12).flex_none())
        .child(h_flex().id(`seat-chip-${s.session}`).flex_1().min_w(0).h(24).gap(6).items_center()
          .child(this.dot(t, rowStatus,14,s.session,this.statusMotion.seatNeeds(s.session,rig.name,s.logicalId)).when(!!limit, el => el.tooltip(limit.line)))
          .child(div().id(`seat-name-${s.session}`).tooltip(`Open ${s.logicalId}'s page`).text_size(12.5).text_color(t.foreground).hover((e) => e.text_color(t.accent))
            .when(compact, el => el.flex_1().min_w(0).truncate())
            .on_click((_e, cx) => { cx?.stop_propagation?.(); go(); })
            .child(tight ? s.logicalId?.split(".").at(-1) ?? s.logicalId : s.logicalId))
          .when(Boolean(s.isRepresentative), el => el.child(div().text_size(11).text_color(t.dim).tooltip("This rig's lead, as OpenRig reports it.").child("Lead")))
          .when(!tight, el => el.child(div().id(`seat-status-${s.session}`).text_size(11.5).text_color(t[statusMark(rowStatus).word] ?? t.muted)
            .when(!showNeed && s.status === "terminal_gone", (w) => w.tooltip(TERMINAL_GONE_TOOLTIP))
            .when(!showNeed && Boolean(s.statusLine), (w) => w.tooltip(s.statusLine)).child(showNeed ? "needs you" : limit?.word ?? s.word)))
          .when(!!runtimeBadge && !compact, (el) => el.child(div().id(`seat-runtime-${s.session}`).px(6).h(18).rounded(4).flex().items_center().bg(t.raised)
            .font_family(settings().font_family).text_size(11).text_color(t.dim).child(runtimeBadge)))
          .when(!!s.slice && !compact, (el) => el.child(div().id(`seat-slice-${s.session}`).tooltip(`Open slice ${s.slice} in Scopes`).px(6).h(18).rounded(4).flex().items_center().bg(t.raised)
            .text_size(11).text_color(t.accent).cursor_pointer()
            .on_click((_e, cx) => { cx?.stop_propagation?.(); this.push({ section: "scopes", slice: s.slice }); })
            .child(String(s.slice))))
          .when(!s.terminal && !compact, el => el.child(this.nowRow(t, { ...s, rig: rig.name }, () => this.push(seatEntry))))
          .when(click.kind === "card" && !tight, (el) => el.child(div().id(`seat-go-${s.session}`).tooltip(`Open ${s.logicalId}'s page`).text_size(12).text_color(t.dim)
            .on_click((_e, cx) => { cx?.stop_propagation?.(); go(); }).child("›"))))
        .child(h_flex().gap(4).items_center().flex_none()
          // Answer can't wait: it stays on the row whenever the seat has an open request.
          .when(!!seatNeed && !compact, (el) => el.child(answer()))
          // A terminal seat is a person's shell, not an agent: no message or work to give it.
          .when(selected && !s.terminal && !compact, (el) => el
            .child(quickBtn(`seat-send-${s.session}`, "Send…", send, { disabled: !!sendReason, tooltip: sendReason ?? `Send ${s.logicalId} a message` }))
            .child(quickBtn(`seat-queue-${s.session}`, "Queue…", queue, { disabled: !!queueReason, tooltip: queueReason ?? `Queue a task for ${s.logicalId}` })))
          .child(this.moreButton(t, `seat-more-${s.session}`, () => this.menu(seatTarget)))))
      .when(!!seatNeed && compact, el => el.child(h_flex().id(`seat-answer-line-${s.session}`).pl(18).pb(4).child(answer())))
      .children(openHelpers ? helpers.map((child, idx) =>
        h_flex().id(`topo-helper-${s.session}-${idx}`).tooltip("Peek at this helper terminal (read only)").pl(36).pr(8).h(24).gap(6).items_center().rounded(6).cursor_pointer().hover((e) => e.bg(t.hover))
          .on_click(() => run("terminal.peek", { terminal: child.address }))
          .child(div().w(12).flex_none())
          .child(svg(icon("rig-helper")).size(12).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).tooltip(String((child.name || (Array.isArray(child.argv) ? child.argv.join(" ") : "") || child.address)??"")).child(child.name || (Array.isArray(child.argv) ? child.argv.join(" ") : "") || child.address))
          .child(div().text_size(11).text_color(t.dim).child(statusWord(child.status ?? "","seat")))) : []);
  }

  /** The quiet ⋯ icon button: the row's menu (the right-click and the Menu key open the same). */
  seatCompactionController(){
    if(this.compaction)return this.compaction;
    this.compaction=new SeatCompaction({
      timezone:()=>this.uiTimezone,
      readUnconfirmed:key=>shared('rig.unconfirmedCompactions')?.[key],
      writeUnconfirmed:(key,record)=>{
        const records={...shared('rig.unconfirmedCompactions')};
        if(record)records[key]=record;else delete records[key];
        setShared('rig.unconfirmedCompactions',records);
      },
      identity:config=>JSON.stringify([config?.connectionId,config?.daemonUrl,config?.daemonMachine,config?.openrigHome,config?.rig]),
      currentConfig:config=>configOfConnection(this.config,config?.connectionId),
      cliReason:config=>cliRefusal({...config,person:null}),
      operation:config=>gatedOperation(config?.connectionId),
      get:async(config,path,op)=>{const response=await op.fetch(`${config.daemonUrl}${path}`);if(!response.ok)throw Error(`OpenRig's compaction check failed (error ${response.status}).`);return response.json();},
      trigger:async(config,body,op)=>{
        const response=await op.fetch(`${config.daemonUrl}/api/compaction/trigger`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
        return {status:response.status,data:await response.json()};
      },
      help:async(config,op)=>{const command=writeCommand({...config,person:null},['compact','--help']);const r=await execFor(config,op)(command.command,command.args,{timeout:15000});return r.code===0?/--state/.test(r.stdout):null;},
      exec:(command,op,timeout)=>execFor({connectionId:op.scope},op)(command.command,command.args,{timeout}),
      notify:cx=>{if(!this.closed)cx.notify();},
      visible:e=>{const shown=this.shownEntry();if(!shown||shown.name!==e.node.logicalId||(shown.seatTab??'activity')!=='activity'||shown.conn&&shown.conn!==e.config.connectionId)return false;const space=this.drawSpaces().find(s=>s.active),tab=space?.tabs?.find(t=>t.active);return !this.tabId||tab?.id===this.tabId;},
      confirm:(e,token,copy,start)=>this.open({mod:MOD_IDS.menu,kind:'dialog',width:500,height:300,props:{target:{kind:'seat',session:e.node.canonicalSessionName,conn:e.config.connectionId},step:{action:'confirm-seat-compaction',token,copy,start}}}),
      decision:token=>{
        const all=shared('rig.compactionDecisions')??{},value=all[token];
        if(value?.status==='allow')return value;
        if(value&&(typeof value==='string'||value.status==='expired')){
          const next={...all};delete next[token];setShared('rig.compactionDecisions',next);return value;
        }
      },
      reportStart:(token,status,text,uncertain=false)=>{
        const all=shared('rig.compactionDecisions')??{},current=all[token];
        if(!current||typeof current!=='object'||current.status==='expired'
          ||(status==='checking'&&current.status!=='allow')||(status==='dispatched'&&current.status!=='checking')
          ||(status==='rechecking'&&current.status!=='dispatched')
          ||(status!=='error'&&Date.now()>=current.deadline))return false;
        setShared('rig.compactionDecisions',{...all,[token]:{deadline:current.deadline,status:status==='rechecking'?'checking':status,
          dispatched:status!=='rechecking'&&(current.dispatched||status==='dispatched'),...(text?{text}:{}),...(uncertain?{uncertain}:{})}});
        return true;
      },
    });return this.compaction;
  }
  compactContext(t,cx,n){
    if(!compactionRuntime(n))return null;
    const version=compactionVersion(this.pageHealthz(cx));
    const controller=this.seatCompactionController(),e=controller.show(cx,this.activeConfig(),n,version),view=controller.view(e),reason=controller.reason(e);
    return v_flex().id('seat-compaction').gap(5)
      .child(focusTarget(this,cx,'seat-compact-now',this.button(t,'seat-compact-now','Compact now…',()=>controller.review(e),{small:true,primary:Number(n.contextUsage?.usedPercentage)>=85,disabled:!!reason,tooltip:reason??"Ask OpenRig to compact this seat",tip:"Ask OpenRig to compact this seat"}),()=>controller.review(e),el=>el.border_1().border_color(t.accent)))
      .when(!!view.text,el=>el.child(div().id('seat-compaction-status').text_size(12).text_color(e.error?t.blocked:t.muted).child(view.text)))
      .when(!!view.evidence,el=>el.child(div().id('seat-compaction-evidence').text_size(12).text_color(t.muted).child(view.evidence)))
      .when(!!e.pollError,el=>el.child(div().id('seat-compaction-read-error').text_size(12).text_color(t.blocked).child("Couldn't refresh compaction status. Check again to retry.")))
      .children(view.guidance.map((line,i)=>div().id(`seat-compaction-guidance-${i}`).text_size(12).text_color(t.blocked).child(line)))
      .when(view.cancel,el=>el.child(focusTarget(this,cx,'seat-compact-cancel',this.button(t,'seat-compact-cancel','Cancel…',()=>controller.review(e,true),{small:true,disabled:e.cancelling,tip:'Stop preparation and restore steps still to come'}),()=>controller.review(e,true),el=>el.border_1().border_color(t.accent))))
      .when(!!(view.text||e.pollError)&&!e.busy&&!e.start&&!e.checking,el=>el.child(focusTarget(this,cx,'seat-compact-check',this.button(t,'seat-compact-check','Check again',null,{small:true,tip:"Check compaction support and read OpenRig's state. Nothing is sent to the seat."}),click=>click.spawn(task=>controller.check(e,task)),el=>el.border_1().border_color(t.accent))))
      .when(!!view.recovery,el=>{
        const resendReason=controller.reason(e,true);
        return el
          .child(focusTarget(this,cx,'seat-compact-resend',this.button(t,'seat-compact-resend','Send again anyway…',null,{small:true,disabled:!!resendReason,tooltip:resendReason??'Review before sending another request'}),()=>controller.review(e,false,true),node=>node.border_1().border_color(t.accent)))
          .child(focusTarget(this,cx,'seat-compact-clear',this.button(t,'seat-compact-clear','Clear this',null,{small:true,disabled:e.checking||!!e.review||e.busy,tip:"You've checked the seat yourself. This hides the warning and sends nothing."}),click=>controller.clearRecovery(e,click),node=>node.border_1().border_color(t.accent)));
      });
  }
  moreButton(t, id, onClick, { tip = "More actions" } = {}) {
    return h_flex().id(id).size(20).rounded(5).items_center().justify_center().flex_none().cursor_pointer().text_color(t.dim)
      .hover((e) => e.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_click((_e, cx) => { cx?.stop_propagation?.(); onClick(); })
      .child(svg(icon("rig-more")).size(14));
  }

  /** Select a row on the page (a click on its body, or the keys); the page takes the keyboard. */
  selectPageRow(key, cx) {
    this.configPanel?.clearSelection();
    this.pageSel = key;
    this.handle?.focus?.();
    cx?.notify?.();
  }

  /** The page's tree keys over the rows it drew, with the page's own folds. */
  pageTreeKey(e, cx) {
    const rows = this.pageRows ?? [];
    if (!rows.length || e.modifiers?.alt || e.modifiers?.control || e.modifiers?.platform) return false;
    const act = treeKeyNav(rows, this.pageSel, e.key, { openMap: shared("rig.open.page") ?? {}, shift: Boolean(e.modifiers?.shift) });
    if (!act) return false;
    const row = act.row ?? rows.find((r) => r.key === act.key);
    if (act.type === "move") this.selectPageRow(act.key,cx);
    else if (act.type === "expand" || act.type === "collapse") {
      if (row?.setOpen) row.setOpen(act.type === "expand");
      else toggleOpen(act.foldKey, act.type === "collapse", row?.seats);
    }
    else if (act.type === "activate") { if (row?.open) row.open(cx); else if (row?.entry) this.push(row.entry); }
    else if (act.type === "action") { const fn = this.seatActions?.[act.key]?.[act.action]; if (fn) fn(); }
    else if (act.type === "menu") { if (row?.target) this.menu(row.target); }
    cx?.notify?.();
    return true;
  }

  heldBody(t,text,id) {
    // Never parse held text as markup: native HTML raw-text tags can decode escaped input twice.
    return v_flex().id(id).gap(0).w_full().min_w(0).children(sourceLines(text??'').map((line,index)=>
      div().id(`${id}-line-${index}`).w_full().min_w(0).whitespace_normal().line_height('20px').text_size(12.5).text_color(t.foreground)
        .child(line.replace(/^ +/,spaces=>'\u00a0'.repeat(spaces.length)).replace(/ {2,}/g,spaces=>' '+'\u00a0'.repeat(spaces.length-1))||'\u00a0')));
  }
  heldMessagesRouteKey(entry) {
    if (entry?.section !== "topology" || entry.kind !== "seat" || entry.connectionIssue) return null;
    const known = this.cache["/api/rigs/summary"]?.data;
    const rigId = entry.rigId ?? (Array.isArray(known) ? known.find(rig => rig.name === entry.rig || rig.id === entry.rig)?.id : undefined);
    return navKey({ ...entry, rigId, conn: entry.conn ?? this.activeConnId() });
  }

  heldMessagesCard(t,cx,entry,guard) {
    if(!guard?.heldCount&&!this.heldMessagesOpen)return null;
    const cfg=this.activeConfig(),seat=entry.session??`${entry.name}@${entry.rig}`,key=JSON.stringify([cfg?.connectionId,cfg?.daemonUrl,cfg?.openrigHome,seat]);
    if(this.heldMessagesKey!==key){this.heldMessagesView?.close();this.heldMessagesKey=key;this.heldMessagesView=null;}
    const start=(eventCx,work)=>{
      if(typeof eventCx?.spawn!=='function')return;
      eventCx.spawn(async taskCx=>{
        if(this.closed||this.heldMessagesKey!==key)return;
        const after=(ms,fn)=>taskCx.timer.after(ms,fn,{owner:null});
        await work(after);if(!this.closed&&this.heldMessagesKey===key)taskCx.notify();
      },{owner:null});
    };
    if(!this.heldMessagesView&&cfg){
      const view=new SeatTypingGuard({fetch:(url)=>gatedOperationOrRefusal(cfg.connectionId).fetch(url),closed:()=>this.closed||this.heldMessagesKey!==key,
        currentConfig:()=>this.activeConfig()},cfg,seat);
      this.heldMessagesView=view;this.heldMessagesRoute=this.heldMessagesRouteKey(entry);start(cx,after=>view.more(after));
    }
    const view=this.heldMessagesView;
    const selected=view?.selected;
    const copyLabel=selected?.truncated?(selected.hiddenLines>0?`Copy whole message (${selected.copyLines} lines; ${selected.hiddenLines} not shown)`:'Copy whole message (more text than shown)'):'Copy message';
    const button=(id,label,act,{disabled=false,tip=null}={})=>{
      const el=h_flex().id(id).role('button').px(10).h(26).min_w(0).rounded(6).items_center().bg(t.raised)
        .text_size(12).text_color(disabled?t.dim:t.foreground).child(div().truncate().child(label));
      return disabled?el.tooltip(tip??'Reading…'):focusTarget(this,cx,id,el,act,null,tip);
    };
    return this.card(t,`HELD MESSAGES · ${guard?.heldCount??view?.total??0}`, [
      ...(view?.items??[]).map(item=>button(`held-message-${item.id}`,`${item.time} · ${item.sender} · ${item.summary}`,eventCx=>start(eventCx,after=>view.detail(item.id,after)),{tip:'Read this held message'})),
      ...(view?.loading?[this.dim(t,'Reading held messages…')]:[]),
      ...(view?.error?[this.dim(t,view.error)]:[]),
      ...(selected?[button('held-message-copy',copyLabel,eventCx=>eventCx.write_to_clipboard(selected.copyText),{tip:'Copy the whole sanitized held message (control characters removed)'}),this.heldBody(t,selected.text,`held-body-${selected.id}`),...(selected.truncated?[this.dim(t,`${selected.lineLimit?'Showing the first 400 lines.':'Truncated.'} Read the rest with rig seat held-messages ${seat} --id ${selected.id}.`)]:[])]:[]),
      ...(view&&(view.scanned??0)<view.total?[button('held-messages-more','Show more',eventCx=>start(eventCx,after=>view.more(after)),{tip:'Read up to 20 older held messages',disabled:view.loading})]:[]),
      ...(view?[button('held-messages-refresh','Refresh',eventCx=>{view.close();start(eventCx,after=>view.more(after));},{tip:'Read the newest held messages again',disabled:view.loading})]:[]),
      this.dim(t,"Held messages stay here until someone retires them with rig seat retire-held-message from a seat. Turning the guard off doesn't send them."),
    ]);
  }

  seatCard(t, cx, entry) {
    const known = this.withRigId(t, cx, entry, entry.rig);
    if (known.view) return known.view;
    entry = known.entry;
    const nodesPath = `/api/rigs/${encodeURIComponent(entry.rigId)}/nodes`;
    const nodes = this.nodesOf(cx, entry.rigId);
    const wait = this.status(t, cx, nodesPath, nodes);
    if (wait) return wait;
    const n = nodes.data.find((x) => x.logicalId === entry.name || x.canonicalSessionName === entry.session);
    if (!n) return this.dim(t, `${entry.name} isn't in ${entry.rig} any more.`);
    const account=typeof n.configuredAccount==='string'?n.configuredAccount.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,'').trim():'';
    const accountConfig=this.activeConfig();
    const accountMachine=accountConfig?.daemonMachine||(isLoopbackDaemonUrl(accountConfig?.daemonUrl)?'this machine':"OpenRig's machine");
    const accountLabel=account==='login'?`Claude login on ${accountMachine}`:account;
    const accountTip=`${account==='login'?'':account+'\n\n'}The Claude account this seat is set to launch with. It isn't a check of who is signed in now.`;
    const rawStatus = seatStatus(n);
    if (!isTerminalSeat(n)) { const seat = this.nowSeat({ session: n.canonicalSessionName, runtime: n.runtime, status: rawStatus, open: true }); this.nowSeats?.set(seat.key, seat); }
    const look = statusLook(rawStatus);
    const tab=entry.seatTab??"activity";
    const stoppedSeat = rawStatus === "stopped" || rawStatus === "exited" || n.lifecycleState === "stopped" || n.lifecycleState === "recoverable" || n.attachable === false;
    const usage = n.contextUsage;
    const rawCtx = usage?.usedPercentage;
    const ctx = typeof rawCtx === "number" && Number.isFinite(rawCtx) ? Math.round(rawCtx) : null;
    const ctxWarn = typeof rawCtx === "number" && Number.isFinite(rawCtx) && rawCtx > 85;
    const inputTokens = usage?.totalInputTokens ?? null;
    const outputTokens = usage?.totalOutputTokens ?? null;
    const contextWindow = usage?.contextWindowSize ?? null;
    const fmtTok = (v) => typeof v === "number" ? (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)) : String(v ?? "");
    const piTokens = n.runtime === "pi" && ctx == null && contextWindow == null
      && usage?.availability === "known" && usage.source === "pi_usage_entries"
      && [inputTokens, outputTokens].every(value => Number.isFinite(value) && value >= 0);
    const fmtPiTokens = value => {
      if (value < 1000) return String(value);
      const thousands = Math.round(value / 100) / 10;
      return thousands >= 1000 ? `${Math.round(value / 100_000) / 10}M` : `${thousands}k`;
    };
    let contextUnavailable = "Not reported by this runtime";
    if (tab === "activity" && n.runtime === "pi" && ctx == null && usage?.availability === "unknown" && usage.reason === "no_data") {
      // Earlier daemons return the same no_data shape for Pi, without collecting its totals.
      const version = this.pageHealthz(cx)?.semver;
      const parts = typeof version === "string" ? /^(\d+)\.(\d+)\.(\d+)(?:\+[^\s]+)?$/.exec(version) : null;
      if (parts) {
        const [major, minor, patch] = parts.slice(1).map(Number);
        if (major > 0 || minor > 7 || minor === 7 && patch >= 21) {
          contextUnavailable = "Not known until this session's first usage report";
        }
      }
    }

    const inlineEffort = n.effort ?? n.reasoningEffort ?? null;
    const effortPath = `/api/seat/effort/${encodeURIComponent(`${entry.name}@${entry.rig}`)}`;
    const effortGot = inlineEffort ? null : this.read(cx, effortPath);
    const effortText = inlineEffort ?? effortGot?.data?.effort ?? effortGot?.data?.currentEffort ?? (effortGot?.loading ? "loading…" : "default");

    // Shown for the person to read or copy; never run. Attach builds its own argv from the checked session.
    const attachCmd = n.tmuxAttachCommand ?? (isValidSessionName(n.canonicalSessionName) ? `tmux attach -t ${n.canonicalSessionName}` : "—");
    const transcript = this.pageTranscriptPath(entry.rig, n.canonicalSessionName); // the page's own OpenRig, and none on a machine

    const healthGot = this.read(cx, "/api/health");
    const seatFindings = (healthGot.data?.records ?? []).filter((r) => classifyHealth(r).actionable && (
      r.scope?.seatId === n.nodeId ||
      r.scope?.nodeId === n.nodeId ||
      r.scope?.seat === n.logicalId ||
      r.scope?.sessionName === n.canonicalSessionName ||
      r.scope?.session === n.canonicalSessionName),
    );

    const queuePaths = seatQueuePaths(n.canonicalSessionName, this.pageHealthz(cx)?.semver);
    const qGot = this.read(cx, queuePaths.open), finishedGot = this.read(cx, queuePaths.finished);
    const queue = seatQueueDetails(qGot.data, finishedGot.data, { ...qGot.queuePage, requested: queuePaths.openLimit });
    const currentWork = queue.current, upNext = queue.pending, blockedWork = queue.blocked, recentlyFinished = queue.finished;
    const queueWarnings = [qGot.error, finishedGot.error].filter(Boolean);
    const depthText = queue.partial ? `at least ${queue.count}` : formatHonestCount(queue.count, { unknown: !queue.available });
    const ownedText = depthText;
    const basisText = qGot.error ? (queue.available ? `last successful read · ${`as of ${this.time(qGot.at)}`}` : "unavailable") : queue.available ? "live queue" : "reading…";
    const queueEmpty = (text) => queue.available ? text : qGot.error ? "Queue unavailable." : "Reading queue…";
    const activity = seatActivityDetails(n,Date.now(),this.uiTimezone);
    const activityWords = seatActivityWords(n,Date.now(),this.uiTimezone);

    const allNeeds = this.pageAttention(this.attentionRead(cx).items, null).targets(); // every item (no roster filter here, as before)
    const seatNeeds = allNeeds.filter((it) => !it.update && (it.session === n.canonicalSessionName || (it.rig === entry.rig && it.logicalId === entry.name)));
    const seatChecks = needsCheckCount(seatNeeds);
    const seatRequests = seatNeeds.length - seatChecks;

    const podName = n.pod ?? n.podNamespace ?? "default";
    const cwdText = n.cwd ?? n.workingDirectory ?? n.workspacePath ?? "—";

    const target = {
      kind: "seat",
      rig: entry.rig,
      rigId: entry.rigId, conn: entry.conn,
      session: n.canonicalSessionName,
      logicalId: entry.name,
      status: rawStatus,
      word: look.word,
      pod: podName,
      runtime: n.runtime,
      terminal: isTerminalSeat(n),
      model: n.model ?? n.resolvedModel ?? null,
      effort: inlineEffort,
      tmuxAttachCommand: n.tmuxAttachCommand ?? null,
      attachable: !stoppedSeat,
    };
    const dialog = (step, height) => this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height, props: { target, step } });
    const live = this.seatTarget(n.canonicalSessionName, n.conn);
    const seatViewReason = capabilityDisableReason("open-seat", this.caps());
    const outageGone = n.terminalServerGone === true; // its tmux server stopped answering: nothing can reach its terminal
    const attachReason = outageGone ? TERMINAL_GONE_REASON : stoppedSeat ? "Stopped: seat has no running session to attach" : null;
    const sendReason = personDisableReason("send", this.config);
    const queueReason = personDisableReason("queue", this.config);
    const modelReason = personDisableReason("change-model", this.config);

    const doAttach = (_e, cx) => {
      // As a task, so the wait outlives the click: the tab is named and selected once herdr has adopted it. A refusal (a
      // name OpenRig doesn't make, an attach command not in OpenRig's shape) says why.
      cx.spawn(async (cx) => {
        const res = await this.attachTarget(cx, target);
        if (res?.needsViewerRefresh) this.reviewViewerReplace(res, target);
        else if (res && res.ok === false && res.reason) notify({ title: `Attach ${target.logicalId ?? target.session}`, body: res.reason, level: "warning" });
      });
    };
    // Focusing a pane the seat already has needs nothing from OpenRig; with none, Focus pane opens a view, which needs
    // OpenRig's herdr provider (seatViewReason), like Open terminal beside it.
    const focusReason = outageGone ? TERMINAL_GONE_REASON : live.kind === "focus" || live.kind === "select-then-focus" ? null : seatViewReason;
    const doFocusPane = () => {
      const hit = this.seatTarget(n.canonicalSessionName, n.conn);
      if (hit.kind === "focus") {
        if (hit.stack && hit.child) run("layout.select", { stack: hit.stack, child: hit.child });
        if (hit.tab) run("tab.select", { id: hit.tab });
        if (hit.pane) run("pane.focus", { id: hit.pane });
        else if (hit.terminal) run("pane.focus", { terminal: hit.terminal });
        return;
      }
      if (hit.kind === "select-then-focus") {
        selectWorkerView({ viewId: hit.view, viewsProps: stripProps(), spaces, panes, layout, run, stackId: STACK });
        run("pane.focus", { terminal: hit.terminal });
        return;
      }
      if (hit.kind === "ambiguous") { notify({ title: "Focus pane", body: hit.reason ?? SEAT_NAME_SHARED, level: "warning" }); return; }
      this.oneClick(target, "open-seat", "seat-focus-pane");
    };

    const typing=tab==='activity'&&!isTerminalSeat(n)?this.read(cx,`/api/seat/status/${encodeURIComponent(n.canonicalSessionName??`${entry.name}@${entry.rig}`)}`).data?.typingGuard:null;
    const typingState=typingGuardState(typing);
    const limit = !seatRequests && rawStatus === "unknown" ? seatUsageLimitWords(n, Date.now(), this.uiTimezone) : null;
    const restart = seatRestartReason(n, rawStatus);
    const restartFailure = restart?.lastError ? plainError(restart.lastError).text : null;
    const showSeatNeeds = seatRequests && rawStatus !== "stopping" && !restart?.needsAttention;
    const providerReason = showSeatNeeds ? null : providerSeatReason(n, rawStatus);
    this.pageHeading={title:entry.name,tone:showSeatNeeds?"needs_input":rawStatus,session:n.canonicalSessionName,status:[showSeatNeeds?"needs you":providerReason?.word ?? restart?.word ?? limit?.word ?? look.word,n.runtime,n.model??n.resolvedModel,entry.rig].filter(Boolean).join(" · ")};
    this.inPageActions=true;
    const terminalAction = live.kind !== "card"
      ? this.button(t, "seat-focus-pane", "Focus pane", doFocusPane, { tip: "Show this seat's pane in Herdr", primary: true, small: true, iconName: "rig-target", disabled: !!focusReason, tooltip: focusReason })
      : this.button(t, "seat-attach", "Attach", doAttach, { tip: "Attach to this seat's terminal in a new tab", primary: !attachReason, small: true, iconName: "terminal", disabled: !!attachReason, tooltip: attachReason });
    const showProviderLine = tab === "activity" && Boolean(providerReason);
    this.pageActions=h_flex().gap(6).items_center().flex_none()
        .when((this.pageWidth??960)<320,el=>el.flex_wrap().max_w(Math.max(100,this.pageWidth-28)))
        .when(!showProviderLine, el => el.child(terminalAction))
        // A terminal seat is a person's shell, not an agent: no message, work or model to give it.
        .when(!isTerminalSeat(n), (el) => el
          .child(this.button(t, "seat-act-send", "Send…", () => dialog({ input: true, placeholder: `Message to ${target.session}`, action: "send", multiLine: true, ...(outageGone ? { note: TERMINAL_GONE_SEND_NOTE } : {}) }, outageGone ? 290 : 260), { tip: "Send this seat a message", small: true, iconName: "rig-send", disabled: !!sendReason, tooltip: sendReason }))
          .child(this.button(t, "seat-act-queue", "Queue…", () => dialog({ input: true, placeholder: "One-line summary; the body follows on the next lines", action: "queue", multiLine: true }, 300), { tip: "Queue a task for this seat", small: true, iconName: "rig-queue", disabled: !!queueReason, tooltip: queueReason })))
        .child(this.button(t, "seat-act-more", "⋯", () => this.menu(target), { tip: "More actions for this seat", small: true }));
    this.inPageActions=false;
    return v_flex().id(`seat-page-${entry.name}`).gap(12)
      .when(outageGone, (el) => el.child(div().id("seat-terminal-outage").text_size(12).text_color(t.blocked).child(terminalGoneSeatLine(n.canonicalSessionName))))
      .when(tab === "activity" && !isTerminalSeat(n), el => el.child(this.nowBlock(t, { session: n.canonicalSessionName, logicalId: n.logicalId }, () => transcript && this.push(fileEntry(transcript, `${entry.name} transcript`)))))
      .when(!!seatViewReason, (el) => el.child(this.workerCapabilityNote(t, seatViewReason)))
      // 1. CONTEXT section
      .when(tab === "activity", el => el.child(v_flex().id("seat-section-context").child(this.card(t, ctx != null ? `CONTEXT · ${ctx}%` : "CONTEXT", [
        (pageBodyLayout(this.pageWidth).compact ? v_flex() : h_flex()).id("seat-context-bar").gap(10).when(!pageBodyLayout(this.pageWidth).compact, el => el.items_center())
          .child(div().when(!pageBodyLayout(this.pageWidth).compact, el => el.w(120)).text_size(12).text_color(t.dim).child("Context"))
          .child(ctx == null
            ? piTokens
              ? div().id("seat-context-tokens").text_size(12.5)
                .tooltip("This runtime reports token totals but not its context window, so herdrig can't show how full it is.")
                .child(`${fmtPiTokens(inputTokens)} input · ${fmtPiTokens(outputTokens)} output tokens · no context window reported`)
                .when(usage.fresh === false, el => el.child(div().text_size(12).text_color(t.muted).child("May be out of date: the last report is old.")))
              : div().text_size(12.5).child(contextUnavailable)
            : h_flex().gap(8).items_center().when(pageBodyLayout(this.pageWidth).compact, el => el.w_full().flex_wrap())
                .child(div().w(pageBodyLayout(this.pageWidth).compact ? 80 : 160).h(6).rounded(3).bg(t.raised).child(div().h_full().rounded(3).w(Math.max(2, Math.min(pageBodyLayout(this.pageWidth).compact ? 80 : 160, (pageBodyLayout(this.pageWidth).compact ? .8 : 1.6) * rawCtx))).bg(ctxWarn ? t.blocked : t.accent)))
                .child(div().id("seat-context-pct").text_size(12).text_color(ctxWarn ? t.blocked : t.muted).when(ctxWarn, (d) => d.font_semibold()).child(`${ctx}%`))
                // One bar: the token counts sit on its row.
                .when(contextWindow != null, (el) => el.child(div().id("seat-context-tokens").when(pageBodyLayout(this.pageWidth).compact, e => e.w_full()).text_size(12).text_color(t.muted).child(
                  `${fmtTok(contextWindow)} token window${inputTokens != null ? ` · ${fmtTok(inputTokens)} input` : ""}${outputTokens != null ? ` · ${fmtTok(outputTokens)} output` : ""}`)))),
        this.compactContext(t,cx,n),
        this.kv(t, [
          ["Runtime", statusWord(n.runtime, "runtime")],
          ...(account.trim()?[["Account",accountLabel,false,accountTip]]:[]),
          ["Model", n.model ?? n.resolvedModel ?? "default"],
          ["Session", n.canonicalSessionName, true],
          ["Effort", effortText],
          ...(n.keepAlive === true ? [["Restarts", "On: OpenRig restarts it if it stops"]] : []),
          ...(typingState?[["Typing guard",`${typingState.word}${typingState.pending?(typing.desiredMode==='off'?' · turning off…':' · turning on…'):''}${typingState.heldCount?` · ${typingState.heldCount} held`:''}`]]:[]),
          ["Attach command", attachCmd, true],
        ]),
        ...(!stoppedSeat && seatViewReason ? [] : [outageGone
          // Its tmux server stopped answering: say why instead of offering a terminal that can't open.
          ? (pageBodyLayout(this.pageWidth).compact ? v_flex() : h_flex()).id("seat-open-terminal-link").tooltip(TERMINAL_GONE_REASON).gap(6).when(!pageBodyLayout(this.pageWidth).compact, el => el.items_center())
              .child(div().when(!pageBodyLayout(this.pageWidth).compact, el => el.w(120)).text_size(12).text_color(t.dim).child("Terminal"))
              .child(div().text_size(12.5).text_color(t.dim).child("Open terminal"))
          : stoppedSeat
          ? div().id("seat-open-terminal-link").text_size(12).text_color(t.dim)
            .tooltip(seatViewReason ?? "")
            .child("This seat has no running terminal to attach.")
          : (pageBodyLayout(this.pageWidth).compact ? v_flex() : h_flex()).id("seat-open-terminal-link").tooltip("Open this seat's terminal").gap(6).when(!pageBodyLayout(this.pageWidth).compact, el => el.items_center()).cursor_pointer()
              .on_click(() => this.oneClick(target, "open-seat", "seat-open-terminal"))
              .child(div().when(!pageBodyLayout(this.pageWidth).compact, el => el.w(120)).text_size(12).text_color(t.dim).child("Terminal"))
              .child(div().text_size(12.5).text_color(t.accent).child("Open terminal ▸"))]),
      ]))))
      .when(tab==='activity'&&!isTerminalSeat(n)&&Boolean(typingState?.heldCount||this.heldMessagesOpen),el=>el.child(this.heldMessagesCard(t,cx,{...entry,session:n.canonicalSessionName},typingState)))
      // 2. CURRENT ACTIVITY section
      .when(tab === "activity", el => el.child(v_flex().id("seat-section-activity").child(this.card(t, "CURRENT ACTIVITY", [
        showProviderLine ? h_flex().w_full().min_w(0).gap(8).items_center()
          .child(div().flex_1().min_w(0).whitespace_normal().text_size(12.5).child(providerReason.line))
          .child(terminalAction) : div().text_size(12.5).child(limit?.line ?? restart?.line ?? activityWords.line),
        ...(restart && (showProviderLine || limit) ? [div().whitespace_normal().text_size(12.5).child(restart.line)] : []),
        ...(restartFailure ? [div().truncate().text_size(12).text_color(t.dim).tooltip(restartFailure).child(`Last error: ${restartFailure}`)] : []),
        ...[activityWords.note, activityWords.changed, activityWords.stale].filter(Boolean).map(text => this.dim(t, text)),
        h_flex().id("seat-evidence-fold").tooltip("Show or hide how OpenRig knows this seat's activity").gap(5).items_center().cursor_pointer().text_color(t.muted)
          .on_click((_e, cx) => { this.activityEvidenceOpen = !this.activityEvidenceOpen; cx.notify(); })
          .child(svg(icon(this.activityEvidenceOpen ? "chevron-down" : "chevron-right")).size(11))
          .child(div().text_size(12).child("How OpenRig knows")),
        ...(this.activityEvidenceOpen ? [this.kv(t, [
          ["Context", n.contextUsage?.reason ?? "—", true],
          ["state", activity.state],
          ["evidence", activity.evidence],
          ["reason", activity.reason],
          ["decided by", activity.decidedBy],
          ["signal", activity.signal],
          ["changed", activity.changed],
        ].map(([key, value]) => [key, value, true]))] : []),
      ]))))
      // 3. HEALTH section
      .when(tab === "activity", el => el.child(v_flex().id("seat-section-health").child(this.card(t, "HEALTH", seatFindings.length
        ? seatFindings.map((f, i) => h_flex().id(`seat-health-finding-${i}`).tooltip("Open this finding in System › Health").px(6).h(26).overflow_hidden().gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click(() => this.push({ section: "system", subview: "health" }))
            .child(div().text_size(12).text_color(t.blocked).child(statusWord(f.severity ?? "warning", "severity")))
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).tooltip(String(singleLineText(f.summary ?? f.id ?? "finding")??"")).child(singleLineText(f.summary ?? f.id ?? "finding")))
            .child(div().text_size(11.5).text_color(t.dim).child(statusWord(f.status ?? "open", "health")))
            .child(svg(icon("chevron-right")).size(11).flex_none().text_color(t.dim)))
        : [this.dim(t, "No health findings for this seat.")]))))
      // 4. CURRENT WORK section
      .when(tab === "queue", el => el.child(v_flex().id("seat-section-current-work").child(this.card(t, `CURRENT WORK · ${currentWork.length}`, currentWork.length
        ? currentWork.map((it, i) => h_flex().id(`seat-work-current-${i}`).gap(8).items_center().text_size(12.5)
            .child(div().font_family(settings().font_family).text_size(11.5).text_color(t.dim).child(String(it.qitemId ?? `work-${i}`)))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).tooltip(rowTip(it.summary ?? it.title)).child(rowTitle(it.summary ?? it.title, it.body)))
            .when(!!it.sourceSession, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(singleLineText(`from ${it.sourceSession}`))))
            .when(!!it.priority, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(String(it.priority)))))
        : [this.dim(t, queueEmpty("No active claimed work."))]))))
      // 5. QUEUE section (warnings, depth, basis, UP NEXT, NEEDS YOU, RECENTLY FINISHED)
      .when(tab === "queue" && Boolean(entry.queueItem), el => el.child(this.queueItemCard(t, cx, entry.queueItem, n.canonicalSessionName)))
      .when(tab === "queue", el => el.child(v_flex().id("seat-section-queue").child(this.card(t, "QUEUE", [
        ...queueWarnings.map((w, i) => div().id(`seat-queue-warn-${i}`).text_size(12).text_color(t.blocked).child(String(w))),
        this.kv(t, [
          ["Owned work", ownedText],
          ["depth:", depthText],
          ["basis:", basisText],
        ]),
        v_flex().id("seat-section-up-next").gap(4).pt(4).border_t(1).border_color(t.border)
          .child(div().text_size(11.5).font_semibold().text_color(t.muted).child(`UP NEXT · ${upNext.length}${(() => { const n = upNext.filter((it) => sweepFinding(it)).length; return n ? ` · including ${n} ${n === 1 ? "check" : "checks"}` : ""; })()}`))
          .children(upNext.length
            ? [
                ...upNext.slice(0, 3).map((it, i) => {
                  // OpenRig's check on another row: a "check" chip and its label, with an Open link to the row (or the seat's queue) it names.
                  const check = sweepFinding(it);
                  if (check) {
                    const label = checkLabel(check, [...upNext, ...currentWork, ...blockedWork]), seat = check.backlogSeat ? checkSeat(check) : null;
                    const open = () => seat ? this.push({ section: "topology", kind: "seat", seatTab:"queue", ...(seat.rig ? { rig: seat.rig } : {}), name: seat.name, ...(seat.session ? { session: seat.session } : {}), ...(entry.conn?{conn:entry.conn}:{}) })
                      : this.openCheckedQueueRow(check, allNeeds, entry.conn);
                    return h_flex().id(`seat-up-next-${i}`).gap(8).items_center().text_size(12)
                      .child(div().id(`seat-up-next-check-${i}`).text_size(11).text_color(t.dim).tooltip("OpenRig's check on another row, not new work").child("check"))
                      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).tooltip(label).child(label))
                      .child(focusTarget(this, cx, `seat-up-next-open-${i}`, div().id(`seat-up-next-open-${i}`).text_size(11.5).text_color(t.accent).cursor_pointer(),
                        () => open(), (el) => el.underline(), seat ? `Open ${seat.name}'s queue` : "Open the row this check is about").child("Open"));
                  }
                  return h_flex().id(`seat-up-next-${i}`).gap(8).items_center().text_size(12)
                  .child(div().font_family(settings().font_family).text_size(11.5).text_color(t.dim).child(String(it.qitemId ?? `q-${i}`)))
                  .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).tooltip(rowTip(it.summary ?? it.title)).child(rowTitle(it.summary ?? it.title, it.body)));
                }),
                ...(upNext.length > 3 ? [div().id("seat-up-next-more").text_size(11.5).text_color(t.dim).child(`+${upNext.length - 3} more`)] : []),
              ]
            : [this.dim(t, queueEmpty("None queued."))]),
        v_flex().id("seat-section-blocked").gap(4).pt(4).border_t(1).border_color(t.border)
          .child(div().text_size(11.5).font_semibold().text_color(t.muted).child(`BLOCKED · ${blockedWork.length}`))
          .children(blockedWork.length ? blockedWork.map((it, i) => v_flex().id(`seat-blocked-${i}`).gap(2)
            .child(div().text_size(12).text_color(t.foreground).child(rowTitle(it.summary, it.body)))
            .when(!!it.blockedOn, (el) => el.child(div().text_size(11).text_color(t.dim).child(`Waiting on ${it.blockedOn}`))))
            : [this.dim(t, queueEmpty("None blocked."))]),
        v_flex().id("seat-section-needs-you").gap(4).pt(4).border_t(1).border_color(t.border)
          .child(div().text_size(11.5).font_semibold().text_color(t.muted).child(`NEEDS YOU · ${seatRequests}${seatChecks ? ` · ${seatChecks} ${seatChecks === 1 ? "check" : "checks"}` : ""}`))
          .children(seatNeeds.length
            ? [
                ...seatNeeds.slice(0, 3).map((it, i) => {
                  const check = sweepFinding(it);
                  const name = check ? checkLabel(check, allNeeds) : rowTitle(it.summary, it.body);
                  return h_flex().id(`seat-need-item-${i}`).tooltip(check ? "Open this check in Needs" : "Open this request in Needs").px(6).h(24).overflow_hidden().gap(8).items_center().rounded(5).cursor_pointer().hover((s) => s.bg(t.hover))
                    .on_click(() => this.push({ section: "needs", id: it.id, name: check ? name : rowTitle(it.summary), ...(it.conn ? { conn: it.conn } : {}) }))
                    .child(div().text_size(11.5).text_color(check ? t.muted : t.blocked).child(check ? "check" : `[${it.urgency ?? "normal"}]`))
                    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).tooltip(check ? name : rowTip(it.summary)).child(name));
                }),
                ...(seatNeeds.length > 3 ? [div().id("seat-needs-more").text_size(11.5).text_color(t.dim).child(`+${seatNeeds.length - 3} more`)] : []),
              ]
            : [this.dim(t, "None pending.")]),
        v_flex().id("seat-section-recently-finished").gap(4).pt(4).border_t(1).border_color(t.border)
          .child(div().text_size(11.5).font_semibold().text_color(t.muted).child("RECENTLY FINISHED"))
          .children(recentlyFinished.length
            ? recentlyFinished.slice(0, 3).map((it, i) => h_flex().id(`seat-finished-${i}`).gap(8).items_center().text_size(12)
                .child(div().font_family(settings().font_family).text_size(11.5).text_color(t.dim).child(String(it.qitemId ?? `done-${i}`)))
                .child(div().flex_1().min_w(0).truncate().text_color(t.muted).tooltip(rowTip(it.summary ?? it.title)).child(rowTitle(it.summary ?? it.title, it.body))))
            : [this.dim(t, queue.finishedAvailable ? "None recent." : finishedGot.error ? "Finished work unavailable." : "Reading finished work…")]),
      ]))))
      // 6. SEAT section (host, rig, pod, cwd + placement)
      .when(tab === "files", el => el.child(v_flex().id("seat-section-seat").child(this.card(t, "SEAT", [
        this.kv(t, [
          ["Host", hostOf(n) ?? "this machine"],
          ["Rig", entry.rig],
          ["Pod", podName],
          ["cwd", cwdText, true],
        ]),
        h_flex().gap(8).items_center().flex_wrap()
          .child(h_flex().id("seat-link-host").tooltip(`Open host ${hostOf(n) ?? "local"}'s page`).px(8).h(22).rounded(5).bg(t.raised).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click(() => this.push({ section: "topology", kind: "host", host: hostOf(n) ?? "local", name: hostOf(n) ?? "local" }))
            .child(div().text_size(11.5).text_color(t.accent).child(`host ${hostOf(n) ?? "local"} ▸`)))
          .child(h_flex().id("seat-link-rig").tooltip(`Open rig ${entry.rig}'s page`).px(8).h(22).rounded(5).bg(t.raised).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click(() => this.push({ section: "topology", kind: "rig", rigId: entry.rigId, conn: entry.conn, name: entry.rig }))
            .child(div().text_size(11.5).text_color(t.accent).child(`rig ${entry.rig} ▸`)))
          .child(h_flex().id("seat-link-pod").tooltip(`Open pod ${podName}'s page`).px(8).h(22).rounded(5).bg(t.raised).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click(() => this.push({ section: "topology", kind: "pod", rig: entry.rig, rigId: entry.rigId, conn: entry.conn, pod: podName, name: podName }))
            .child(div().text_size(11.5).text_color(t.accent).child(`pod ${podName} ▸`))),
        this.nativePart(t, cx, entry.rig, n.canonicalSessionName),
      ]))))
      // 7. SPEC section (linked spec or (not in library), profile, version, source hash, basis)
      .when(tab === "files", el => el.child(v_flex().id("seat-section-spec").child(this.card(t, "SPEC", [
        n.resolvedSpecName
          ? h_flex().id("seat-spec").tooltip("Open this seat's spec in Specs").gap(8).items_center().cursor_pointer()
              .on_click(() => this.push({ section: "specs", specOf: n.logicalId, name: `spec of ${n.logicalId}` }))
              .child(svg(icon("file-text")).size(13).text_color(t.muted))
              .child(div().text_size(12.5).text_color(t.accent).child(`${n.resolvedSpecName}${n.resolvedSpecVersion ? ` · ${n.resolvedSpecVersion}` : ""}`))
              .child(svg(icon("chevron-right")).size(12).text_color(t.dim))
          : div().id("seat-spec").text_size(12.5).text_color(t.dim).child("(not in library)"),
        this.kv(t, [
          ["profile", n.resolvedSpecProfile ?? n.profile ?? "—"],
          ["version", n.resolvedSpecVersion ?? "—"],
          ["source hash", n.resolvedSpecHash ?? n.sourceHash ?? "—", true],
          ["basis", n.resolvedSpecBasis ?? n.specBasis ?? (n.resolvedSpecName ? "resolved at launch" : "none")],
        ]),
      ]))))
      .when(tab === "activity", el => el.child(this.helpersPart(t, cx, entry.rig, n.canonicalSessionName)))
      .when(tab === "files" && !!transcript, (el) => el.child(this.card(t, "Files", [this.fileRow(t, "seat-transcript", transcript, `Transcript · ${entry.name}`, "Open this seat's transcript")])));
  }

  /** Placement: a native seat's terminal and how it ends. */
  nativeSeat(cx, rig, session) {
    const got = this.read(cx, `/api/native-seats?rig=${encodeURIComponent(rig)}`);
    return Array.isArray(got.data?.seats) ? got.data.seats.find((s) => s.sessionName === session) ?? null : null;
  }
  nativePart(t, cx, rig, session) {
    const seat = this.nativeSeat(cx, rig, session);
    if (!seat) return this.kv(t, [["Placement", "tmux"]]);
    return v_flex().gap(6).child(this.kv(t, [["Placement", `herdr (native) · terminal ${seat.address}${seat.live ? "" : " · ended"}`]]))
      .child(this.dim(t, "Closing this seat's herdr pane, tab or space ends the agent; OpenRig then offers Relaunch / Resume."))
      .when(!seat.live && !seat.stoppedByOpenrig && !!seat.endedAt, (el) => el.child(div().text_size(12.5).text_color(t.blocked)
        .child(`Ended outside OpenRig (${seat.endReason ?? "closed"}). Relaunch or Resume it from Needs-You.`)));
  }
  /** A native seat's `hc run` children: nesting needs the seat's own terminal as their parent. */
  helpersPart(t, cx, rig, session) {
    const seat = this.nativeSeat(cx, rig, session);
    if (!seat) return this.card(t, "Helpers", [this.dim(t, "Sub-agents started with hc run appear here when the seat runs natively in herdr-app; this seat runs in tmux.")]);
    const kids = seat.children ?? [];
    return this.card(t, "Helpers", [kids.length
      ? v_flex().children(kids.map((c, i) => h_flex().id(`native-child-${i}`).tooltip("Peek at this helper terminal (read only)").px(8).h(28).gap(8).items_center().rounded(6).hover((s) => s.bg(t.hover))
        .on_click(() => run("terminal.peek", { terminal: c.address }))
        .child(svg(icon("rig-helper")).size(13).flex_none().text_color(t.dim))
        .child(div().flex_1().truncate().text_size(12.5).tooltip(String((c.name || c.argv.join(" ") || c.address)??"")).child(c.name || c.argv.join(" ") || c.address))
        .child(div().text_size(11.5).text_color(t.dim).child(statusWord(c.status ?? "","seat")))
        .child(div().text_size(11.5).text_color(t.dim).font_family(settings().font_family).child(c.address))
        .child(this.copyButton(t, c.address, `helper-${c.address}`, "terminal address"))))
      : this.dim(t, seat.live ? "No hc run sub-agents running." : "None: the seat isn't running.")]);
  }

  specs(t, cx, entry) {
    const lib = this.read(cx, "/api/specs/library");
    if (entry.specOf && !entry.id) {
      // `spec-of <agent>`: the seat's resolved agent spec (its node's resolvedSpecName), found in the library.
      const wait = this.status(t, cx, "/api/specs/library", lib);
      if (wait) return wait;
      const want = entry.specOf;
      // The seat is found among the page's OWN connection's nodes: two OpenRigs can run seats with the same name and different specs.
      const node = Object.values(this.pageRigData()?.nodesByRig ?? {}).flat()
        .find((n) => n.logicalId === want || n.canonicalSessionName === want || n.logicalId?.split(".").pop() === want);
      if (!node?.resolvedSpecName) return this.dim(t, node ? `${want} names no agent spec.` : `No seat ${want} in the rigs this window reads.`);
      const hit = lib.data.find((x) => x.kind === "agent" && x.name === node.resolvedSpecName && (!node.resolvedSpecVersion || x.version === node.resolvedSpecVersion))
        ?? lib.data.find((x) => x.name === node.resolvedSpecName);
      if (!hit) return this.dim(t, `${want} runs ${node.resolvedSpecName}${node.resolvedSpecVersion ? `@${node.resolvedSpecVersion}` : ""}, which isn't in the spec library.`);
      return this.specs(t, cx, { ...entry, id: hit.id, specFor: node.logicalId });
    }
    if (entry.name && !entry.id) {
      // A name alone (the palette's `spec <name>`): the library names the id; names repeat across kinds.
      const wait = this.status(t, cx, "/api/specs/library", lib);
      if (wait) return wait;
      const hits = lib.data.filter((s) => s.name === entry.name);
      if (hits.length === 1) return this.specs(t, cx, { ...entry, id: hits[0].id });
      return this.card(t, entry.name, [hits.length ? this.table(t, "spec-hits", [["Spec"], ["Kind", 90], ["Version", 80], ["Source", 80]], hits.map((s) => ({ cells: [s.name, s.kind, s.version,
        div().text_size(11).text_color(t.dim).child(s.sourceType === "builtin" || !s.sourcePath ? "Built-in" : "Yours")],
        tip: "Open this spec", onClick: () => this.push({ section: "specs", id: s.id, name: s.name }) }))) : this.dim(t, `No spec named ${entry.name} in the library.`)]);
    }
    if (entry.id) {
      // One spec, opened by id (sidebar, palette, `spec-of`): the same expanded body the list shows in place.
      const wait = this.status(t, cx, "/api/specs/library", lib);
      if (wait) return wait;
      const known = lib.data.find((s) => s.id === entry.id);
      if (!known) return this.dim(t, `${entry.name ?? entry.id} isn't in the spec library.`);
      this.pageSpec=known;
      this.activePageView=selectedPageView(entry,this.pageViewMemory??={},known);
      return v_flex().gap(12)
        .when(!!entry.specFor, (el) => el.child(this.dim(t, `Spec for ${entry.specFor}`)))
        .child(this.specBody(t, cx, known, true));
    }
    const wait = this.status(t, cx, "/api/specs/library", lib);
    if (wait) return wait;
    const f = this.filter?.trim().toLowerCase();
    const groups = groupSpecLibrary(lib.data, f);
    const open = shared("rig.open.page") ?? {};
    const toggle = (id) => { const now = shared("rig.open.page") ?? {}; setShared("rig.open.page", { ...now, [`spec:${id}`]: !now[`spec:${id}`] }); };
    return this.card(t, "Specs", [v_flex()
      .child(h_flex().px(8).h(24).gap(10).items_center().border_b(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(div().w(12)).child(div().flex_1().child("Spec")).child(div().w(80).flex_none().child("Version")))
      .children(groups.length ? groups.map(g => {
        // A kind the page was opened for (the sidebar's "N more pod specs") starts open; the person's own fold still wins.
        // The sidebar's "pod" specs are every kind but rig (agents, workflows and any other), which this page lists by their own kind.
        const asked = entry.kindFilter === "pod" ? g.kind !== "rig" : g.kind === entry.kindFilter;
        const key = `spec-kind:${g.kind}`, expanded = !!f || (open[key] ?? (entry.kindFilter ? asked : g.kind === "rig"));
        const toggleKind = () => { this.pageSel = key; if (!f) { const now = shared("rig.open.page") ?? {}; setShared("rig.open.page", { ...now, [key]: !expanded }); } };
        this.pageRows?.push({ key, foldKey: key, expandable: true, isOpen: expanded, open: toggleKind,
          setOpen: value => { if (!f) setShared("rig.open.page", { ...(shared("rig.open.page") ?? {}), [key]: value }); } });
        return v_flex().id(`spec-kind-group-${g.kind}`)
          .child(h_flex().id(key).tooltip(`Show or hide the ${g.kind} specs`).px(8).h(30).gap(6).items_center().rounded(6).when(this.pageSel === key, el => el.bg(t.selection)).hover(x => x.bg(t.hover))
            .on_click(toggleKind)
            .child(svg(icon(expanded ? "chevron-down" : "chevron-right")).size(12).text_color(t.dim))
            .child(div().text_size(12.5).font_semibold().text_color(t.muted).child(g.title))
            .child(div().text_size(11.5).text_color(t.dim).child(`${g.items.length}${f ? ` of ${g.total}` : ""}${g.yours ? ` · ${g.yours} yours` : ""}`)))
          .when(expanded, el => el.children(g.items.map((s, i) => {
        const shown = !!open[`spec:${s.id}`], box = this.specBoxes?.[this.specBoxKey(s.id)];
        const builtin = s.sourceType === "builtin" || !s.sourcePath;
        const key = `spec:${s.id}`;
        this.pageRows?.push({ key, foldKey: key, parentKey: `spec-kind:${g.kind}`, expandable: true, isOpen: shown, open: () => toggle(s.id) });
        return v_flex()
          .when(builtin && i === g.yours && i > 0, el => el.child(div().id(`spec-divider-${g.kind}`).mx(8).h(1).bg(t.border)))
          .child(h_flex().id(`specs-${lib.data.indexOf(s)}`).tooltip(`${shown ? "Close" : "Open"} ${s.name}; right-click for its actions`).pl(24).pr(8).h(30).gap(10).items_center().rounded(6).when(this.pageSel === key, el => el.bg(t.selection)).hover((x) => x.bg(t.hover))
            .on_click(() => { this.pageSel = key; toggle(s.id); }).on_mouse_down("right", () => this.menu({ kind: "spec", conn: this.shownConnId(), id: s.id, name: s.name, sourcePath: s.sourcePath, specKind: s.kind }))
            .child(svg(icon(shown ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim))
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).tooltip(String(s.name??"")).child(s.name))
            .when(this.specDirty(box), (el) => el.child(div().text_size(11.5).text_color(t.working).flex_none().child("● Unsaved changes")))
            .when(builtin, el => el.child(div().text_size(10.5).text_color(t.dim).child("built-in")))
            .child(div().w(80).flex_none().truncate().text_size(12.5).text_color(t.muted).tooltip(String(s.version ?? ""??"")).child(s.version ?? "")))
          .when(shown, (el) => el.child(v_flex().ml(22).pl(10).py(6).border_l(1).border_color(t.border).child(this.specBody(t, cx, s, false))));
      })));
      }) : [div().p(10).text_size(12).text_color(t.dim).child(f ? `No matches for /${this.filter}.` : "No specifications found.")])]);
  }

  specDirty(box) { return !!box?.state && box.state.value() !== box.loaded; }

  /** The paths the library lists as the person's own files: the only ones Save may write. */
  /** Running rigs that use a spec: a rig spec's rigs by name, an agent spec's by the seats that resolve to it. */
  runningRigsOf(cx, s) {
    const rigs = (this.read(cx, "/api/rigs/summary").data ?? []).filter((r) => !r.archivedAt && (r.lifecycleState ?? r.lifecycle) === "running");
    const nodes = this.pageRigData()?.nodesByRig ?? {};
    return rigs.filter((r) => [r.name, r.specName, r.spec].includes(s.name) || (nodes[r.id] ?? []).some((n) => n.resolvedSpecName === s.name));
  }

  /** A pill's click: that rig on Topology (one-way sync — pushes to rig.nav without mutating rig.open). */
  openRigFromSpec(r) {
    this.push({ section: "topology", kind: "rig", rigId: r.id, conn: r.conn, name: r.name });
  }

  graphFor(key) {
    this.graphs??=new Map();if(!this.graphs.has(key))this.graphs.set(key,new RigGraph());return this.graphs.get(key);
  }
  graphWorkRows(cx,rig) {
    const config=this.activeConfig(),conn=this.activeConnId(),origin=config?.daemonUrl;
    if(!config||!origin)return {rows:[],error:null};
    const activity=graphActivityOf(shared,conn),own=activity?.origin===origin?activity:null;
    const cache=this.graphWork??=new GraphWorkCache(),serial=own?.serial??0;
    const pending=cache.touch({conn,origin,rig:rig.id,serial});
    if(pending.request)cx.spawn(async live=>{
      let rows,error;
      try {
        const op=gatedOperationOrRefusal(conn),url=await this.resolveDaemonUrl(config);
        if(!url)throw Error('OpenRig is not connected.');
        // One compact work snapshot per connection. The server's rig filter misses @rig@host addresses;
        // graphWorkLines matches both normalized endpoints to this graph's seats instead.
        const response=await op.fetch(`${url}/api/queue/list?state=in-progress&limit=-1&compact=1`);
        if(!response.ok)throw Error(`OpenRig queue returned ${response.status}.`);
        rows=JSON.parse(await response.text());
      }catch(e){error=e;}
      pending.finish(rows,error);
      // This completion only notifies. A trailing read/backstop can begin only on the next native DRAWN frame.
      this.noteAnswer(live);
    });
    return pending.record;
  }

  loadSpecGraph(cx,s,box,spec=this.specOperation()) {
    box.graphLoading=true;
    cx.spawn(cx=>this.reloadSpecGraph(cx,s,box,spec));
  }

  async reloadSpecGraph(cx,s,box,spec=this.specOperation()) {
    if(this.closed||this.specBoxes?.[spec?.boxKey(s.id)??this.specBoxKey(s.id)]!==box)return;
    const request=box.graphRequest={};
    const current=()=>!this.closed&&box.graphRequest===request&&this.specBoxes?.[spec?.boxKey(s.id)??this.specBoxKey(s.id)]===box;
    box.graphLoading=true;box.graphError=null;box.graph=null;
    try{
        if(!current())return;
        if(!spec)throw new Error("This page's OpenRig is no longer set up, so its spec graph can't be read. Reopen the page.");
        const op=this.readOperation(spec.config);
        const url=await spec.daemonUrl();if(!url)throw new Error("Connect OpenRig before opening the saved spec graph.");
        if(!current())return;
        // This is the same public structured review used by rig specs preview in OpenRig0.7.11.
        // It stays on the person's existing HTTP/tunnel origin and needs no local or remote CLI.
        const graph=await readRigSpecPreview(op.fetch,url,s);
        if(current())box.graph=graph;
    }catch(error){if(current())box.graphError=singleLineText(error?.message??error).slice(0,240);}
    finally{if(current()){box.graphLoading=false;cx.notify();}}
  }

  /** A spec opened in place is read-only first, with Graph/YAML for rig specs.
   *  `Edit` enters edit mode (`Cancel edit` exits with inline discard confirmation); `Edit` on a built-in creates an
   *  editable copy in the user library; `Launch` lives on the row's right-click menu and the palette. */
  specBody(t, cx, s, single) {
    const config=this.activeConfig();
    if(!config)return this.dim(t,"This page's connection isn't set up any more, so its spec isn't shown and nothing is sent from here. Open the spec again from the sidebar.");
    const isBuiltin = s.sourceType === "builtin" || !s.sourcePath;
    const sfx = (name, plain = false) => (single && plain ? name : `${name}-${s.id}`);
    let box = (this.specBoxes ??= Object.create(null))[this.specBoxKey(s.id)];
    if (!box) {
      const startEditing = Boolean(this.specAutoEdit?.delete?.(this.specBoxKey(s.id))) && !isBuiltin;
      box = this.specBoxes[this.specBoxKey(s.id)] = { loading: true, editing: startEditing };
      this.loadSpec(cx, s, isBuiltin, box);
    }
    this.ensureSpecEditor(cx, box);
    const mac = window()?.platform === "macos";
    const dirty = this.specDirty(box);
    const editing = Boolean(box.editing) && !isBuiltin;
    const rigSpec=s.kind==="rig",graphView=rigSpec&&(single&&this.activePageView?this.activePageView:box.view??(editing?"yaml":"graph"))==="graph";
    if(graphView)this.wideGraph=true;
    if(rigSpec&&!box.graph&&!box.graphLoading&&!box.graphError)this.loadSpecGraph(cx,s,box);
    const pills = this.runningRigsOf(cx, s);
    const editLabel = isBuiltin
      ? (box.copying ? "Copying…" : "Copy & edit")
      : (editing ? "Cancel edit" : "Edit");
    const copyReason = isBuiltin ? personDisableReason("specs-add", config) : null;
    const remoteEdit = !isBuiltin && Boolean(config.daemonMachine);
    const guidance = box.note || (remoteEdit ? this.remoteSpecGuidance() : null);
    const copyNote = this.specCopyNotes?.[this.specBoxKey(s.id)];
    const saveDisabled = isBuiltin || !editing || !dirty || Boolean(box.saving || box.awaitingPermission);
    const openDisabled = !s.sourcePath || Boolean(config.daemonMachine);
    const toolbar = h_flex().gap(8).items_center().flex_wrap()
      .when(rigSpec&&!single,el=>el.child(h_flex().rounded(6).border_1().border_color(t.border).children(["graph","yaml"].map(view=>
        this.button(t,`spec-view-${view}-${s.id}`,view==="graph"?"Graph":"YAML",(_e,cx)=>{box.view=view;cx.notify();},{ tip: view === "graph" ? "Show this spec as a graph" : "Show this spec as YAML",small:true})
          .when((view==="graph")===graphView,el=>el.bg(t.accent).text_color(t.solid_foreground)
            .hover(st=>st.bg(t.accent)))))))
      .child(this.button(t, sfx(isBuiltin ? "spec-copy" : "spec-edit", true), editLabel, (_e, cx) => this.toggleEditSpec(cx, s, isBuiltin), { tip: isBuiltin ? (box.copying ? "Making your copy…" : "Make your own copy of this built-in spec to edit") : editing ? "Stop editing and discard your edits (asks first if you changed anything)" : "Edit this spec here",
        primary: !editing && !copyReason,
        iconName: editing ? "x" : "layers",
        disabled: Boolean(box.loading || box.copying || box.saving || box.awaitingPermission || copyReason),
        tooltip: remoteEdit ? `Edit on ${config.daemonMachine}` : copyReason,
      }))
      .when(!graphView,el=>el.child(this.button(t, sfx("spec-save", true), box.saving ? "Saving…" : `Save ${mac ? "⌘↵" : "Ctrl+↵"}`, (_e, cx) => this.saveSpec(cx, s), { tip: `Save your edits${config.daemonMachine ? ` on ${config.daemonMachine}` : ""} (⌘↵ / Ctrl+↵)`,
        primary: editing && dirty,
        iconName: "check",
        disabled: saveDisabled,
      })))
      .child(this.button(t, sfx("spec-open", true), "Open file", () => {
        if (s.sourcePath && !config.daemonMachine) this.push(fileEntry(s.sourcePath, `${s.name} · spec`));
      }, { tip: "Open the spec file here, read only",
        iconName: "file-text",
        disabled: openDisabled,
        tooltip: config.daemonMachine ? `This file is on ${config.daemonMachine}.` : openDisabled ? "Built-in spec has no file path on disk" : null,
      }))
      .children(pills.map((r) => h_flex().id(`spec-rig-pill-${s.id}-${r.name}`).tooltip(`Open ${r.name}, running from this spec`).px(8).h(24).gap(5).items_center().rounded(12).text_size(12).cursor_pointer()
        .bg(t.raised).border_1().border_color(t.border).hover((e) => e.bg(t.hover)).on_click(() => this.openRigFromSpec(r))
        .child(div().text_color(t.working).child("●")).child(r.name)))
      .when(isBuiltin, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Built-in specs can't be edited; copy one to make your own.")))
      .when(!isBuiltin && !editing, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Read-only")))
      .when(dirty, (el) => el.child(div().text_size(11.5).text_color(t.working).child("● Unsaved changes")))
      .when(rigSpec,el=>el.child(div().flex_1()).child(this.button(t,`spec-launch-${s.id}`,"Launch…",()=>this.open({mod:MOD_IDS.menu,kind:"dialog",width:460,height:LAUNCH_DIALOG_HEIGHT,
        props:{target:{kind:"spec",id:s.id,conn:config.connectionId,name:s.name,sourcePath:s.sourcePath??null,specKind:"rig"},step:{action:"launch-spec"}}}),{ tip: "Start a rig from this spec: asks where and on which host first",primary:true,iconName:"rig-play"})))
      .when(!!box.restoredDraft && dirty, (el) => el.child(h_flex().gap(6).items_center().flex_wrap().child(div().text_size(11.5).text_color(t.muted).child(config.daemonMachine
        ? `Restored your unsaved edits from ${this.time(box.draftAt??Date.now())}.` : "Restored unsaved edits"))
        .child(this.button(t, `spec-discard-draft-${s.id}`, config.daemonMachine?"Discard edits":"Discard", (_e, cx) => this.discardDraft(cx, s), { tip: "Throw away the unsaved edits you had left here", small: true }))));
    const errors = box.errors ?? [];
    const olderKey = olderSpecDraftKey(s.id, config);
    const olderDraft = !isBuiltin && !box.loading && !box.error && !box.olderDraft
      ? specDraft((shared("rig.drafts") ?? {})[olderKey]) : null;
    const currentDraft = this.specDirty(box) || Boolean(specDraft((shared("rig.drafts") ?? {})[specDraftKey(s.id, config)]));
    if(single){this.pageActions=toolbar;this.pageHeading={title:s.name,status:`${s.kind??"spec"}${s.version?` · ${s.version}`:""}`};}
    return v_flex().gap(8)
      .child(this.kv(t, [["Kind", s.kind], ["Version", s.version], ["Summary", s.summary], ["File", `${s.sourcePath ?? "not a file on disk"}${config.daemonMachine ? ` · on ${config.daemonMachine}` : ""}`, true]]))
      .when(!single,el=>el.child(toolbar))
      .when(!!olderDraft, el => el.child(h_flex().gap(6).items_center().flex_wrap()
        .child(this.dim(t, currentDraft ? "An earlier draft of this spec also exists." : "An earlier draft of this spec was found. herdrig can't tell which OpenRig it was written for."))
        .child(this.button(t, `spec-restore-older-${s.id}`, box.showOlderDraft ? "Hide it" : currentDraft ? "View it" : "Open it to check…",
          (_e, cx) => this.openOlderSpecDraft(cx, s, box, config), { small: true }))))
      .when(!!olderDraft && !!box.showOlderDraft, el => el.child(this.plain(t, olderDraft.text)))
      .when(!!box.olderDraft, el => el.child(this.dim(t, "This text came from an earlier draft that may have been written for a different OpenRig. Check it before saving.")))
      .when(!!box.builtinEditNote && !guidance, (el) => el.child(this.dim(t, box.builtinEditNote)))
      .when(Boolean(box.confirmDiscardEdit || box.confirmRevert), (el) => el.child(
        h_flex().id(`spec-discard-bar-${s.id}`).gap(8).items_center()
          .child(div().text_size(12).text_color(t.blocked).child("Discard edits?"))
          .child(this.button(t, `spec-discard-confirm-${s.id}`, "Discard", (_e, cx) => this.confirmDiscardEditSpec(cx, s, isBuiltin), { tip: "Throw away your edits and show the saved spec", small: true }))
          .child(this.button(t, `spec-keep-edit-${s.id}`, "Keep editing", (_e, cx) => { box.confirmDiscardEdit = false; box.confirmRevert = false; cx.notify(); }, { tip: "Keep your edits and go on editing", small: true })),
      ))
      .when(!!box.savedText && !dirty, (el) => el.child(this.dim(t, box.savedText)))
      .when(!!guidance, (el) => el.child(this.specNoteView(t, guidance, s.id)))
      .when(!!copyNote, (el) => el.child(this.specNoteView(t, copyNote, s.id, /^(?:An earlier copy|You already have a copy)/.test(copyNote))))
      .when(!!box.conflict, (el) => el.child(v_flex().gap(6).min_w(0).child(div().text_size(12).text_color(t.blocked).child(box.conflict))
        .child(h_flex().gap(8).items_center().flex_wrap()
        .child(this.button(t, `spec-reload-${s.id}`, box.confirmReload ? "Click Reload again to discard edits" : "Reload", (_e, cx) => this.reloadSpec(cx, s, isBuiltin), { tip: `Read the spec again from disk${box.confirmReload ? "; click again to throw away your edits" : ""}` }))
        .child(this.button(t, `spec-keep-editing-${s.id}`, "Keep editing", (_e, cx) => this.keepEditing(cx, s), { tip: "Keep your edits; the next Save replaces the file as it is now" })))))
      .children(errors.map((e, i) => div().id(`spec-error-${s.id}-${i}`).text_size(12).text_color(t.blocked).child(this.errorText(t,`spec-error-detail-${s.id}-${i}`,e,{where:config.daemonMachine??"this computer"}))))
      .when(graphView&&dirty,el=>el.child(this.dim(t,"Showing the saved spec. Save to update the graph.")))
      .child(graphView ? (box.graph?this.graphFor(`spec:${this.specBoxKey(s.id)}`).render(t,cx,box.graph,{id:`spec-graph-${s.id}`,assets:ASSETS})
        :box.graphError?v_flex().gap(6).child(this.errorText(t,`spec-graph-error-${s.id}`,box.graphError))
          .child(this.button(t,`spec-graph-retry-${s.id}`,"Retry",(_e,cx)=>this.loadSpecGraph(cx,s,box),{small:true,tip:"Try drawing the graph again"})):this.skeleton(t)) : box.state
        ? div().id(`spec-editor-${s.id}`).h(320).border_1().border_color(editing ? t.accent : t.border).rounded(6)
          // Clicks and keys typed in the YAML are the editor's: stop left-mouse-down from bubbling to rig-view-root's handle.focus().
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_key_down(() => { this.typing = true; }).child(Editor.new(box.state))
        : box.error ? this.errorText(t,`spec-read-error-${s.id}`,box.error) : this.skeleton(t))
      .when(!isBuiltin, (el) => el.child(this.dim(t, "Applies to future launches; running rigs keep their current topology.")));
  }

  /** Creates and wires an EditorState for a spec box with the requested `readonly` state. */
  /** After an await, an editor state made right there would belong to whichever view drained the promise jobs, and go when that view closes.
   *  The continuation queues what it wants; the spec's next draw makes it (ensureSpecEditor). */
  queueSpecEditorState(s, box, value, readonly, config = this.specConfig()) {
    box.pendingEditor = { s, value, readonly, config };
    // New text: the old editor must not stay live under the new base until the draw (a Save would write its text, a draft would keep it). It is
    // released and dropped now (releasing allocates nothing); every handler bails without a state. The same text (a save's read-only swap) keeps it.
    if (box.state && box.state.value() !== value) {
      box.secondaryEnterTask?.cancel?.(); box.secondaryEnterBase = null;
      try { box.state.release?.(); } catch (_) {}
      box.state = null;
    }
  }
  /** From the spec's draw (the page's own call): one timer that makes the queued editor state. */
  ensureSpecEditor(cx, box) {
    if (!box?.pendingEditor || box.pendingEditorTimer || !cx?.timer?.after) return;
    box.pendingEditorTimer = true;
    cx.timer.after(0, (next) => {
      box.pendingEditorTimer = false;
      const want = box.pendingEditor;
      if (!want || this.closed) return;
      this.makeSpecEditorState(want.s, box, want.value, want.readonly, want.config);
      next?.notify?.();
    });
  }
  makeSpecEditorState(s, box, value, readonly, config = this.specConfig()) {
    box.pendingEditor = null; // a state made now replaces one still queued
    const key = specDraftKey(s.id,config); // an operation that awaited passes the connection it began on: the editor's drafts are that connection's
    box.secondaryEnterTask?.cancel?.();box.secondaryEnterBase=null;
    box.state?.release?.();
    const state = EditorState.new({ language: "yaml", value, readonly: Boolean(readonly), font_family: settings().font_family });
    state.on("change", (_e, cx) => {
      if (box.invalidated || box.state !== state) return;
      const now = state.value();
      const previous=box.lastText??value;
      const pending=box.secondaryEnterBase;
      // Newline and auto-indent may arrive as separate changes in one input turn.
      // Keep one pre-insertion snapshot, never a history of unrelated user edits.
      box.secondaryEnterBase=pending!=null && stripSecondaryEnterNewline(pending,now)===pending ? pending
        : now!==previous && stripSecondaryEnterNewline(previous,now)===previous ? previous : null;
      box.secondaryEnterTask?.cancel?.();
      if(box.secondaryEnterBase!=null)box.secondaryEnterTask=cx.timer.after(0,()=>{if(box.state===state)box.secondaryEnterBase=null;});
      box.prevText = box.lastText; box.lastText = now;
      this.setSpecEditorDraft(box, key, now === box.loaded ? null : { text: now, baseText: box.loaded, baseHash: simpleHash(box.loaded), ...(box.olderDraft ? { olderDraft: box.olderDraft } : {}) });
      box.confirmRevert = false; box.confirmDiscardEdit = false; box.confirmReload = false; box.savedText = null;
      cx?.notify?.();
    });
    // Ctrl+Enter puts a newline in the text before it submits: Save gets the text without it.
    state.on("submit", (e, cx) => {
      if (!e?.secondary || box.invalidated || box.state !== state || specDraftKey(s.id, this.specConfig()) !== key) return;
      box.secondaryEnterTask?.cancel?.();
      const cleaned = box.secondaryEnterBase==null ? state.value() : stripSecondaryEnterNewline(box.secondaryEnterBase, state.value());
      box.secondaryEnterBase=null;
      if (cleaned !== state.value()) { state.set_value(cleaned); box.lastText = cleaned; }
      this.saveSpec(cx, s);
    });
    box.state = state;
    return state;
  }

  /** The local spec folders for ONE connection, resolved NOW from local facts (never the daemon's list) and published to the flat field so a
   *  synchronous reader - and writeSpecCopy's write path - sees the ACTED-ON connection's folders. They
   *  used to be resolved once per config load for whichever page was then shown, so a tab whose first load ran while another machine's page was
   *  on top kept none and every local Save and Copy & edit was refused. Resolving per acted-on connection at use time removes that dependency.
   *
   *  No cache: a call per use is a handful of local execs, and a cache is what let the field hold the PREVIOUS connection's folders on a hit
   *  (A, B, A, B and B's copy landed in A's). Resolving every time makes the field correct by construction, and the security rule
   *  (`spec-write-path`) can trace this assignment to localSpecRoots().
   *
   *  A connection on a machine has its specs there, so it resolves to and publishes NO local folders: a write cannot reach folders another
   *  page held. */
  async specRootsFor(config, { publish = true } = {}) {
    if (!config) return [];
    const publishing = publish && (this.activeConfig()?.connectionId ?? config.connectionId ?? LEGACY_CONNECTION_ID)
      === (config.connectionId ?? LEGACY_CONNECTION_ID);
    if (config.daemonMachine) {
      // Publish [] as OURS (owner and published mark), not as a caller's choice: an unmarked [] reads as "someone chose no folders", so a local
      // page after any machine page action would skip resolving and refuse (fail-closed).
      // The field and the published mark must be the SAME array: two `[]` literals are never `===`, so the field would look
      // CALLER-CHOSEN and a later local Copy would skip resolving and refuse. The security rule wants
      // the assignment written as a literal here, so `this.specRoots = []` and the mark follows it by identity.
      if (publishing) {
        this.specRoots = [];
        this.specRootsPublished = this.specRoots;
        this.specRootsConn = config.connectionId ?? LEGACY_CONNECTION_ID;
      }
      return [];
    }
    const roots = await localSpecRoots(config, execFor(config), home());
    // Decided again after the await: the page may show another connection by now, and the flat field is the page's (its readers check the owner too).
    if (publishing && (this.activeConfig()?.connectionId ?? config.connectionId ?? LEGACY_CONNECTION_ID) === (config.connectionId ?? LEGACY_CONNECTION_ID)) { this.specRoots = roots; this.specRootsConn = config.connectionId ?? LEGACY_CONNECTION_ID; this.specRootsPublished = roots; }
    return roots;
  }
  /** The page's own folders for a synchronous reader: what the last resolution published (the load's, or specRootsFor's). Empty on a
   *  connection on a machine, whose specs are there. */
  pageSpecRoots(cfg = this.activeConfig()) {
    if (cfg?.daemonMachine) return [];
    // The field wins when it was NOT this file's own publish (a caller or a test that chose folders, including an empty list meaning "none"), and
    // it belongs to the acted-on connection. A field this file published for ANOTHER connection is never handed over: that was the review's finding, a
    // copy on B writing into A's folder.
    const key = cfg?.connectionId ?? LEGACY_CONNECTION_ID;
    // The field wins when it is not this file's own publish (a caller or test that chose folders, including [] for "none").
    if (Array.isArray(this.specRoots) && this.specRoots !== this.specRootsPublished) return this.specRoots;
    // Otherwise it must belong to THIS page's connection: a field this file published for another connection is never read (the A, B, A, B case).
    if (Array.isArray(this.specRoots) && (this.specRootsConn == null || this.specRootsConn === key)) return this.specRoots;
    return []; // nothing resolved for this page yet: the async paths resolve for it
  }
  /** Explain a local edit refusal without inferring locality from missing folders. */
  specRefusal(config = this.activeConfig()) {
    return specFolderRefusal(this.pageSpecRoots(config), { machine: config?.daemonMachine, listed: (this.config?.connections?.length ?? 0) > 1, realpathAvailable: this.specRealpathAvailable }); // the page's own OpenRig, or an operation's
  }

  specNoteView(t, note, id, information = false) {
    const machine=this.activeConfig()?.daemonMachine,command=`hc machine login ${machine}`;
    if(machine&&note.startsWith(`${machine} is unreachable, so nothing was saved.`)&&note.includes(command)){
      const [before,after]=note.split(command);
      return h_flex().gap(4).items_center().flex_wrap().text_size(12).text_color(t.blocked)
        .child(div().child(before)).child(div().id(`spec-reconnect-${id}`).font_family(settings()?.font_family??"monospace").child(command))
        .child(this.copyButton(t,command,`spec-reconnect-${id}`,"reconnect command")).child(div().child(after));
    }
    const marker = "daemonMachine";
    const guidance = note === this.specRefusal() || note === this.remoteSpecGuidance();
    const tone = guidance || information ? t.muted : /^(?:Your copy of .*Copy & edit didn't overwrite it\.|The copied spec at .*Your copy was kept;)/.test(note) ? t.working : t.blocked;
    if (!guidance || !note.includes(marker)) return information || tone === t.working ? div().text_size(12).text_color(tone).child(note) : this.errorText(t,`spec-note-error-${id}`,note,{where:this.activeConfig()?.daemonMachine??"this computer"}).text_size(12).text_color(tone);
    const [before, after] = note.split(marker);
    return h_flex().gap(4).items_center().flex_wrap().text_size(12).text_color(tone)
      .child(div().child(before)).child(div().id(`spec-config-key-${id}`).font_family(settings()?.font_family ?? "monospace").child(marker))
      .child(this.copyButton(t, marker, `spec-config-${id}`, "configuration key"))
      .child(div().child(after));
  }

  remoteSpecGuidance(){
    const cfg=this.activeConfig(); if(!cfg) return "This page's OpenRig is no longer set up, so its spec can't be saved from here."; // no fallback
    const machine=cfg.daemonMachine;
    // A page on this computer says so plainly rather than naming an empty machine.
    return `Save writes this spec on ${machine ?? "this computer"}.`+(this.specConsentMachine===machine?"":" The first save asks for permission.");
  }

  specConflictMessage(config=this.activeConfig()){
    const machine=config?.daemonMachine; // the page's own OpenRig (or an operation's), no fallback
    return machine?`The spec changed on ${machine} since you opened it. Reload shows the new version and discards your unsaved edits. Keep editing keeps your version; saving then replaces the change on ${machine}.`:"The file changed on disk since you opened it.";
  }

  /** Toggle editable mode; Copy & edit copies a built-in into the user library. */
  toggleEditSpec(cx, s, isBuiltin) {
    const box = this.specBoxes?.[this.specBoxKey(s.id)];
    if (!box) return;
    box.view="yaml";
    const current=this.shownEntry(); // the page THIS tab shows (with its connection), never the shared stack's top, which can be another tab's page
    if(current?.section==="specs"&&(current.id===s.id||current.name===s.name))this.push({...current,specTab:"yaml"});
    if (isBuiltin) {
      box.builtinEditNote = "Copy & edit makes your own copy; the built-in stays unchanged.";
      this.copySpec(cx, s);
      return;
    }
    if (!box.editing) {
      box.editing = true;
      box.confirmDiscardEdit = false;
      box.confirmRevert = false;
      box.savedText = null;
      if (box.state) {
        const cur = box.state.value();
        this.makeSpecEditorState(s, box, cur, false).focus?.();
      }
      cx.notify();
      return;
    }
    if (this.specDirty(box) && !box.confirmDiscardEdit) {
      box.confirmDiscardEdit = true;
      cx.notify();
      return;
    }
    this.confirmDiscardEditSpec(cx, s, isBuiltin);
  }

  confirmDiscardEditSpec(cx, s, isBuiltin) {
    const box = this.specBoxes?.[this.specBoxKey(s.id)];
    if (!box) return;
    setDraft(specDraftKey(s.id,this.specConfig()), null);
    box.olderDraft = null;
    box.editing = false;
    box.confirmDiscardEdit = false;
    box.confirmRevert = false;
    box.errors = null;
    box.conflict = null;
    box.restoredDraft = false;
    box.loaded = box.diskText ?? box.loaded;
    box.diskText = null;
    box.lastText = box.prevText = box.loaded;
    if (box.state) this.makeSpecEditorState(s, box, box.loaded, true);
    cx.notify();
  }

  /** Reads a spec's YAML (a user file first, otherwise the library's copy) and makes its editor, outside render. A saved draft
   *  comes back only against the text it was started from: if the file moved on since, the draft stays against its own
   *  base and the conflict says so, so Save can't overwrite the newer file unseen. */
  loadSpec(cx, s, isBuiltin, box) {
    const spec = this.specOperation(); // the text, the restored draft and the editor belong to the connection this load began for
    cx.spawn(async (cx) => {
      await Promise.resolve();
      try {
        if (!spec) throw new Error("This page's OpenRig is no longer set up, so its spec can't be read. Reopen the page.");
        const text = await this.specText(s, null, spec);
        if (this.closed || box.invalidated) return;
        const raw = isBuiltin ? undefined : (shared("rig.drafts") ?? {})[spec.draftKey(s.id)];
        box.draftRecord = JSON.stringify(raw);
        const draft = specDraft(raw);
        const initial = this.applySpecDraft(box, text, draft, spec.config);
        box.editing = Boolean(box.editing) && !isBuiltin;
        box.lastText = box.prevText = initial;
        this.queueSpecEditorState(s, box, initial, isBuiltin || !box.editing, spec.config);
        box.loading = false; box.error = null;
      } catch (e) { box.loading = false; box.error = errorDiagnostic(e); }
      cx.notify();
    });
  }

  applySpecDraft(box, text, draft, config) {
    box.loaded = text; box.diskText = null; box.restoredDraft = false;
    box.olderDraft = draft?.olderDraft ?? null;
    if (!draft || draft.text === text) return text;
    box.draftAt = draft.at;
    box.editing = true;
    if (draft.baseText === text || (draft.baseHash && draft.baseHash === simpleHash(text))) box.restoredDraft = true;
    else {
      box.loaded = draft.baseText ?? text;
      box.diskText = text;
      box.conflict = this.specConflictMessage(config);
    }
    return draft.text;
  }

  openOlderSpecDraft(cx, s, box, config) {
    const spec = this.specOperation(config);
    if (!spec?.onPage() || box.invalidated || this.specBoxes?.[spec.boxKey(s.id)] !== box || !box.state) return;
    const drafts = shared("rig.drafts") ?? {}, key = olderSpecDraftKey(s.id, config), raw = drafts[key], older = specDraft(raw);
    if (!older) return;
    if (box.showOlderDraft) {
      box.showOlderDraft = false;
    } else if (older.text === box.loaded || this.specDirty(box) || specDraft(drafts[spec.draftKey(s.id)])) {
      box.showOlderDraft = true;
    } else {
      const draft = { ...older, baseText: older.baseText ?? (older.baseHash ? undefined : box.loaded), olderDraft: { key, raw } };
      const text = this.applySpecDraft(box, box.loaded, draft, config);
      this.setSpecEditorDraft(box, spec.draftKey(s.id), draft);
      box.view = "yaml";
      const current = this.shownEntry();
      if (current?.section === "specs" && (current.id === s.id || current.name === s.name)) this.push({ ...current, specTab: "yaml" });
      this.makeSpecEditorState(s, box, text, false, config);
    }
    cx.notify();
  }

  setSpecEditorDraft(box, key, draft) {
    // Shared state is copied across editors. A stamp distinguishes another editor writing the same text.
    const record = draft && { ...draft, editStamp: Math.random().toString(36).slice(2) };
    setDraft(key, record);
    const stored = (shared("rig.drafts") ?? {})[key];
    // The host normalizes fields. Read its representation only if this editor's write survived.
    const own = record ? stored?.editStamp === record.editStamp : stored === undefined;
    box.draftRecord = own ? JSON.stringify(stored) : undefined;
  }

  reconcileSavedSpecDraft(box, key, id, config, saved) {
    const record = (shared("rig.drafts") ?? {})[key];
    const draftText = box.invalidated ? specDraft(record)?.text ?? box.lastText : null;
    const text = box.state?.value() ?? draftText ?? saved;
    if (JSON.stringify(record) === box.draftRecord) {
      this.forgetSavedOlderSpecDraft(box, id, config);
      this.setSpecEditorDraft(box, key, text === saved ? null : { text, baseText: saved, baseHash: simpleHash(saved) });
    }
    return text;
  }

  finishRemoteSpecSave(box, s, spec, draftKey, content, synced) {
    const config = spec.config;
    const now = this.reconcileSavedSpecDraft(box, draftKey, s.id, config, content);
    if (box.invalidated) return;
    box.loaded = content;
    box.diskText = null;
    box.conflict = null;
    box.errors = null;
    box.restoredDraft = false;
    box.savedText = synced?.ok ? `Saved on ${config.daemonMachine}.`
      : synced?.refused ? `Saved on ${config.daemonMachine}; the library wasn't re-indexed because OpenRig's settings changed. Refresh to catch up.`
        : `Saved on ${config.daemonMachine}; library re-index failed.`;
    delete this.specCopyNotes?.[spec.boxKey(s.id)];
    if (box.state && now === content) {
      box.editing = false;
      this.queueSpecEditorState(s, box, content, true, config);
    }
  }

  forgetSavedOlderSpecDraft(box, id, config) {
    const older = box.olderDraft;
    if (!older) return;
    box.olderDraft = null;
    if (older.key === olderSpecDraftKey(id, config) &&
        JSON.stringify((shared("rig.drafts") ?? {})[older.key]) === JSON.stringify(older.raw)) setDraft(older.key, null);
  }

  /** Reload from disk, losing the edits: with edits it asks first (a second press discards them). */
  reloadSpec(cx, s, isBuiltin) {
    const box = this.specBoxes[this.specBoxKey(s.id)];
    if (this.specDirty(box) && !box.confirmReload) { box.confirmReload = true; cx.notify(); return; }
    setDraft(specDraftKey(s.id,this.specConfig()), null);
    this.specBoxes[this.specBoxKey(s.id)] = { loading: true, editing: false, view:box.view };
    this.loadSpec(cx, s, isBuiltin, this.specBoxes[this.specBoxKey(s.id)]);
    box.state?.release?.();
    cx.notify();
  }

  /** The conflict banner's other way out: keep the text, and let the next Save replace the file as it is now. */
  keepEditing(cx, s) {
    const box = this.specBoxes?.[this.specBoxKey(s.id)];
    if (!box) return;
    box.conflict = null; box.confirmReload = false; box.editing = true;
    box.loaded = box.diskText ?? box.loaded; box.diskText = null;
    if (box.state) this.setSpecEditorDraft(box, specDraftKey(s.id,this.specConfig()), this.specDirty(box) ? { text: box.state.value(), baseText: box.loaded, baseHash: simpleHash(box.loaded), ...(box.olderDraft ? { olderDraft: box.olderDraft } : {}) } : null);
    cx.notify();
  }

  /** The restored edits' Discard: back to the file's text, draft gone, and return to read-only. */
  discardDraft(cx, s) {
    const box = this.specBoxes?.[this.specBoxKey(s.id)];
    if (!box?.state) return;
    setDraft(specDraftKey(s.id,this.specConfig()), null);
    box.olderDraft = null;
    box.restoredDraft = false; box.confirmRevert = false; box.confirmDiscardEdit = false; box.editing = false;
    box.loaded = box.diskText ?? box.loaded;
    box.diskText = null;
    box.conflict = null;
    this.makeSpecEditorState(s, box, box.loaded, true);
    cx.notify();
  }

  /** Revert asks first when there are edits (a second press discards them); nothing to discard reverts at once. */
  revertSpec(cx, s) {
    const box = this.specBoxes?.[this.specBoxKey(s.id)];
    if (!box?.state) return;
    if (this.specDirty(box) && !box.confirmRevert) { box.confirmRevert = true; cx.notify(); return; }
    box.state.set_value(box.loaded);
    setDraft(specDraftKey(s.id,this.specConfig()), null);
    box.olderDraft = null;
    box.confirmRevert = false; box.confirmDiscardEdit = false; box.errors = null; box.conflict = null; box.restoredDraft = false;
    cx.notify();
  }

  /** Save = validate (daemon, by kind) → compare-and-swap write → sync the library → re-read. Invalid is never written.
   *  Its checks run at once; the rest runs as a task, whose own `cx` every later notify and read uses. */
  saveSpec(cx, s) {
    const box = this.specBoxes?.[this.specBoxKey(s.id)];
    if (!box?.state || box.saving || !box.editing || s.sourceType === "builtin" || !s.sourcePath || !this.specDirty(box)) return;
    const edited = box.state.value();
    box.errors = null; box.conflict = null; box.note = null; box.savedText = null;
    const refused = this.specRefusal();
    const spec = this.specOperation(), shown = spec?.config; // the connection this page shows decides the route, never the first connection
    if (!shown) { box.note = "This page's OpenRig changed, so nothing more is sent from it. Reopen the page to use the new one. Unsaved text stays here."; cx.notify(); return; }
    if (shown.daemonMachine) {
      this.remoteSpecWrite(cx,s,{verb:"save",target:s.sourcePath,baseText:box.loaded,content:edited});return;
    }
    // loadConfig keeps the previous folders while it resolves the new ones: a save now would resolve its file against folders the new config no longer lists.
    if (this.specFoldersReady === false) { box.note = "The spec folders are still loading. Try saving again."; cx.notify(); return; }
    if (unsafeSpecWritePath(s.sourcePath)) { box.note = refused; cx.notify(); return; }
    if (!this.config) { box.note = "The daemon address isn't known yet."; cx.notify(); return; }
    // One operation, begun here with the connection captured: the address and the validation belong to the config this save began under. If the
    // settings change in between (a list installed, an address edited), the save was NOT validated: nothing is written, and the person is told why.
    let op; try { op = this.writeOperation(shown); } catch (e) { box.note = errorDiagnostic(e); cx.notify(); return; }
    const draftKey = spec.draftKey(s.id);
    box.saving = true; cx.notify();
    const conflict = (onDisk) => { box.conflict = "The file changed on disk since you opened it."; if (onDisk != null) box.diskText = onDisk; };
    cx.spawn(async (cx) => {
      let reread;
      try {
        // Written only inside the local spec folders, at the resolved path: a symlink out of them is refused.
        const roots = await this.specRootsFor(shown); // THIS acted-on connection's own folders, keyed by connection
        const file = await resolveInSpecRoots(s.sourcePath, roots, execFor(shown));
        if (!file) { box.note = refused; return; }
        const daemonUrl = await spec.daemonUrl(); // the save's own connection, not the page shown after the folder checks
        if (!daemonUrl) { box.note = "The daemon address isn't known yet."; return; }
        const route = s.kind === "agent" ? "/api/agents/validate" : "/api/rigs/import/validate";
        const r = await op.fetch(`${daemonUrl}${route}`, { method: "POST", headers: { "content-type": "text/yaml" }, body: edited });
        let data = null; try { data = JSON.parse(await r.text()); } catch (e) { data = rethrowGate(null)(e); }
        if (!r.ok || data?.valid === false) {
          box.errors = Array.isArray(data?.errors) && data.errors.length ? data.errors : [data?.error ?? data?.message ?? `Validation failed (${r.status})`];
          return;
        }
        const onDisk = await readTextFile(file).catch(() => null);
        if (onDisk != null && onDisk !== box.loaded) { conflict(onDisk); return; }
        op.check(); // the validation above is only good for the config it was asked under
        try { await writeTextFile(file, edited, box.loaded); } catch (e) {
          // A changed file is a conflict; any other failure (permissions, I/O) says what it was.
          const now = await readTextFile(file).catch(() => null);
          if (now != null && now !== box.loaded) conflict(now); else box.errors = [errorDiagnostic(e)];
          return;
        }
        const synced = await this.syncLibrary(op, daemonUrl);
        const now = this.reconcileSavedSpecDraft(box, draftKey, s.id, shown, edited);
        if (box.invalidated) return;
        box.loaded = edited; box.diskText = null; box.errors = null; box.conflict = null; box.restoredDraft = false;
        box.savedText = synced?.ok ? "Saved." : synced?.refused ? "Saved; the library wasn't re-indexed because OpenRig's settings changed. Refresh to catch up." : "Saved; library re-index failed.";
        delete this.specCopyNotes?.[spec.boxKey(s.id)];
        if(synced?.ok&&s.kind==="rig"){
          const preview=this.reloadSpecGraph(cx,s,box,spec),request=box.graphRequest;
          const reportPreviewError=message=>{
            if(this.closed||this.specBoxes?.[spec.boxKey(s.id)]!==box||box.graphRequest!==request)return;
            if(!message)return;
            // The task context may have been refused; report without asking it to redraw again.
            try{notify({title:"Couldn't refresh the spec graph",body:message,level:"warning"});}
            catch{console.error(message);}
          };
          preview.then(
            ()=>reportPreviewError(box.graphError),
            error=>reportPreviewError(box.graphError??singleLineText(error?.message??error).slice(0,240))
          );
        }
        // Keys typed while it saved stay: their draft is kept, now against what was written.
        if (box.state && now === edited) {
          box.editing = false;
          this.queueSpecEditorState(s, box, edited, true, shown);
        }
        reread = spec.rereadLibrary(cx);
        refreshSidebar();
      } catch (e) { box.note = plainExecError(e, { kind: "read" }); }
      finally { box.saving = false; cx.notify(); }
      await reread;
    });
  }

  /** The library sync that FOLLOWS a write that already happened: a gate refusal here (the settings changed) is `{ ok: false, refused: true }`, never an exception that would
   *  skip recording what was written and call it "not used". Another failure is null, as before. */
  async syncLibrary(op, daemonUrl) {
    try { return await op.fetch(`${daemonUrl}/api/specs/library/sync`, { method: "POST" }); }
    catch (e) { return e?.code === "GATE_REFUSED" ? { ok: false, refused: true } : null; }
  }

  /** User specs may read their file inside the local spec folders with symlinks resolved. All other entries use only
   *  the daemon's own copy, even when their sourcePath happens to name a local spec. */
  async specText(s, outer = null, spec = this.specOperation()) {
    // The read belongs to the spec operation that asked (its connection, captured before any await), else to the page as it is now.
    const cfg = spec?.config ?? null;
    const op = outer ?? this.readOperation(cfg); // the address resolved below belongs to the connection and config this read began under
    const path=rigSpecLibraryPath(s);if(!path)throw new Error("This library entry has no usable spec id.");
    // That connection decides, and its realpath runs through that connection's exec (realpath isn't a daemon command,
    // so the gate doesn't scope it either way). No fallback to the sidebar's config: a page whose connection is gone has no spec to read, so refuse plainly.
    if (!cfg) throw new Error("This page's OpenRig is no longer set up, so its spec can't be read. Reopen the page.");
    // The page's roots as it holds them; resolved only when it holds none (a page opened after a load ran for another machine's page).
    // This page's own folders, resolved only when it has none - never over folders a caller (or the page) already chose.
    const chosen = Array.isArray(this.specRoots) && this.specRoots !== this.specRootsPublished;
    const roots = chosen ? this.specRoots : await this.specRootsFor(cfg);
    const file = !cfg.daemonMachine && s.sourceType === "user_file" && s.sourcePath ? await resolveInSpecRoots(s.sourcePath, roots, execFor(cfg)) : null;
    let text = file ? await readTextFile(file).catch(() => null) : null;
    if (text == null && this.config) {
      const daemonUrl = await spec.daemonUrl(); // after the folder awaits: still the read's own connection
      if (daemonUrl) {
        const r = await op.fetch(`${daemonUrl}${path}`);
        const body = await r.text();
        if (!r.ok) throw new Error(requestFailed("that spec", r.status));
        let data = null; try { data = JSON.parse(body); } catch (_) { data = body; }
        text = typeof data === "string" ? data : data?.yaml ?? JSON.stringify(data, null, 2);
      }
    }
    if (text == null) throw new Error("The spec's YAML couldn't be read.");
    return text;
  }

  /** Writes `text` as a new file in the first local spec folder, under a name made from the spec's (never a path the
   *  daemon sent), taking a name free in every local spec folder because the CLI also copies into its library.
   *  Returns the file written. */
  async writeSpecCopy(s, text, op = null, spec = null) {
    // The copy belongs to the OpenRig it BEGAN for (`spec`, the operation copySpec started; a bare config from a direct caller): a page switch in
    // between must never pick the other OpenRig's folder and leave a file there. Its folders are resolved for that connection (`config`); without
    // one it is the page's own.
    const began = typeof spec?.boxKey === "function" ? spec : spec ? this.specOperation(spec) : null;
    const config = began?.config ?? this.activeConfig();
    const pageChanged = () => Boolean(began && !began.onPage()); // the operation's one guard: the tab no longer shows the connection the copy began on
    const changed = "The page changed while the copy was starting, so nothing was written. Copy it again from this page.";
    const refused = cliRefusal(config); // a connection without its own OpenRig home writes nothing (HOME_NEEDED), whatever folders the page holds
    if (refused) throw new Error(refused);
    if (pageChanged()) throw new Error(changed);
    // A page opened after a load that resolved for another machine's page holds no folders, so resolve
    // for THIS page when it holds none. The folders stay in `this.specRoots`, which is what every path check below reads - and folders it
    // already holds are respected, never re-resolved over (a caller may have chosen them, and a new address is a new load anyway).
    // The page's roots as it holds them: a caller (and the test that clicks Copy) reads roots from THIS field, so the copy must land where
    // it says. Resolved only when the page holds none: a page opened after a load ran for another machine's page.
    // Resolve for THIS page, then read the published field - the security rule traces `this.specRoots[0]` as a write path,
    // and a local alias would lose that trace.
    // Resolve only when the field does not already hold THIS page's folders or a caller's chosen ones: re-resolving over a caller's choice is
    // what made a copy land somewhere other than where the page said.
    const fieldIsChosen = Array.isArray(this.specRoots) && this.specRoots !== this.specRootsPublished;
    if (!fieldIsChosen) await this.specRootsFor(config); // the connection the copy began under; else a caller already put this page's folders here
    if (pageChanged()) throw new Error(changed); // re-checked after the await: a switch while the folders resolved would write into the other OpenRig's folder
    const roots = this.specRoots ?? [];
    if (!roots[0]) throw new Error(this.specRefusal(config));
    // The folders the page now holds must still be that connection's: a tab switched to another OpenRig meanwhile publishes ITS folders, and the
    // copy would land there. Nothing is written then (a caller's own chosen folders are its choice).
    if (!fieldIsChosen && (this.specRootsConn ?? LEGACY_CONNECTION_ID) !== (config?.connectionId ?? LEGACY_CONNECTION_ID))
      throw new Error("This page now shows another OpenRig, so the copy wasn't made. Open the spec again to copy it.");
    const root = this.specRoots[0]; // read from the field: the security rule traces this shape as a write path
    if (!root) throw new Error(this.specRefusal(config));
    const base = specCopyName(s.name);
    for (let i = 0; i < 20; i++) {
      const name = `${base}${i === 0 ? "" : i === 1 ? "-copy" : `-copy-${i}`}.yaml`;
      const file = `${root}/${name}`;
      const existing = await Promise.all(roots.map((r) => readTextFile(`${r}/${name}`)));
      if (existing.some((text) => text != null)) continue;
      // Create-only: herdr refuses if the file appeared meanwhile, and the next name is tried.
      op?.check(); // the name checks above awaited: the copy is only created under the settings it began with
      try { await writeTextFile(file, text, null); } catch (_) { continue; }
      return file;
    }
    throw new Error(`No free file name for a copy of ${base} in ${root}.`);
  }

  /** A built-in's Edit (Copy & edit): the daemon's own YAML is written as a new file in the local spec folder,
   *  and `rig specs add` registers that file: never a path
   *  the daemon named, which the CLI would read on this machine and upload. Then sync, re-read, and open the user copy
   *  in edit mode. */
  copySpec(cx, s) {
    const box = this.specBoxes?.[this.specBoxKey(s.id)];
    if (!box || box.copying) return;
    if (!this.config?.person) { box.note = NO_PERSON; cx.notify(); return; }
    // A built-in rig spec that has a folder of its own is copied as that whole folder, so the copy can launch.
    if (folderCopyable(s)) { this.copyFolder(cx, s); return; }
    const spec = this.specOperation(), shown = spec?.config; // the connection this page shows decides the route
    if (!shown) { box.note = "This page's OpenRig changed, so nothing more is sent from it. Reopen the page to use the new one."; cx.notify(); return; }
    const fromConn = spec.fromConn; // the page the copy began on: only that page moves to the copy, which keeps its connection
    if(shown.daemonMachine){
      this.remoteSpecWrite(cx,s,{verb:"copy",name:s.name});return;
    }
    // Begun with the captured connection, before the task: the library re-read below belongs to the connection and config this copy began under.
    let op; try { op = this.writeOperation(shown); } catch (e) { box.note = errorDiagnostic(e); cx.notify(); return; }
    box.copying = true; box.note = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const source = s.sourceType === "user_file" ? box.loaded ?? await this.specText(s, op, spec) : await this.specText(s, op, spec);
        // Agent refs relative to the original's folder are made absolute (text only); a copy that couldn't find its agents is never written.
        const prepared = copyableSpecText(source, s.sourcePath);
        if (prepared.refused) { box.note = prepared.refused; return; }
        const text = prepared.text;
        const written = await this.writeSpecCopy(s, text, op, spec);
        // Registered only at its resolved path inside the local spec folders: a link planted at that name is refused.
        const roots = await this.specRootsFor(shown); // THIS acted-on connection's own folders
        const file = await resolveInSpecRoots(written, roots, execFor(shown));
        if (!file) { box.note = spec.refusal(); return; }
        if (cliRefusal(shown)) { box.note = cliRefusal(shown); return; } // no home of its own: no CLI run, and the person is told
        op.check(); // the path resolution above awaited
        const cmd = writeCommand(shown, ["specs", "add", "--", file]);
        if (!cmd) { box.note = NO_PERSON; return; }
        const r = writeOutcome(await execFor(shown)(cmd.command, cmd.args, { timeout: 180000 }));
        if (!r.ok) { box.note = r.text; return; }
        const daemonUrl = await spec.daemonUrl();
        const copySynced = daemonUrl ? await this.syncLibrary(op, daemonUrl) : null;
        if (copySynced?.refused) { box.note = "The copy was made, but OpenRig's settings changed before the library could be updated. Refresh the library to see it."; return; }
        let made = s.id, copy = null;
        try {
          const res = daemonUrl ? await op.fetch(`${daemonUrl}/api/specs/library`) : null;
          const list = res ? JSON.parse(await res.text()) : null;
          if (res?.ok && Array.isArray(list)) {
            spec.cache()["/api/specs/library"] = { data: list, at: Date.now() }; // the copy's own connection's cache, not the page's by now
            copy = list.find((x) => x.name === s.name && x.kind === s.kind && x.sourceType !== "builtin" && x.sourcePath) ?? null;
            made = copy?.id ?? s.id;
          }
        } catch (e) { rethrowGate(null)(e); /* a gate refusal stops the copy flow; otherwise the list stays as it was */ }
        if (made !== s.id) {
          delete this.specBoxes?.[spec.boxKey(made)];
          (this.specAutoEdit ??= new Set()).add(spec.boxKey(made));
          const lacking = s.sourceType === "user_file" ? null : siblingFileNote(siblingFileNames(text));
          if (lacking) (this.specCopyNotes ??= Object.create(null))[spec.boxKey(made)] = lacking;
        }
        if (!spec.onPage()) return; // the tab shows another page by now: the copy is made and marked, and that page is left alone
        setOpen(`spec:${made}`, true);
        // On the one-spec page the page itself moves to the copy.
        this.editShownStack((stack) => { const top = stack.at(-1);
          return copy && top?.section === "specs" && top.id === s.id && (top.conn ?? null) === fromConn
            ? [...stack.slice(0, -1), { section: "specs", id: made, name: copy.name ?? s.name, ...(fromConn ? { conn: fromConn } : {}) }] : null; });
      } catch (e) { box.note = plainExecError(e, { kind: "write" }); }
      finally { box.copying = false; cx.notify(); }
    });
  }

  // ---- herdrig's Spaces list: System > Layout ------------------------------------------------------------------------
  /** Reads, at most every few seconds, what the Layout card needs from files: the way back herdrig recorded, whether herdr's shipped
   *  Spaces mod already keeps the active space in view (by shape), and whether our own copy is installed. */
  refreshSpacesList(cx) {
    const info = (this.spacesList ??= {});
    if (info.reading || Date.now() - (info.at ?? 0) < 5000) return;
    info.reading = true;
    cx.spawn(async (cx) => {
      try {
        const saved = await readTextFile(`${appHome()}/openrig/spaces-list.json`);
        info.state = saved ? JSON.parse(saved) : null;
        info.reveal = shippedSpacesHasReveal((await readTextFile(`${appHome()}/mods/spaces/main.js`)) ?? "");
        info.installed = (await readTextFile(`${appHome()}/mods/rig-spaces/main.js`)) != null;
      } catch (_) { /* the card shows what it has */ }
      info.at = Date.now(); info.reading = false; cx.notify();
    });
  }

  /** The opt-in screen for one change. Nothing is sent until its button; the layout shown now is what it names. */
  chooseSpacesMode(cx, target) {
    const info = (this.spacesList ??= {});
    if (info.busy || this.spacesPending) return;
    if (info.at && info.installed === false) { info.note = "herdrig's Spaces list isn't installed. Reinstall herdrig."; cx.notify(); return; }
    const name = shared("layout"), tree = layout(), plan = planMode(tree, target);
    if (!plan.ok) { info.note = plan.reason; cx.notify(); return; }
    const token = `spaces-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.spacesPending = { token, target, shown: { layout: name, tree: JSON.parse(JSON.stringify(tree)) }, expires: Date.now() + 300000 };
    this.armDecisionPoll(cx);
    info.note = null;
    this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 560, height: 540,
      props: { target: { kind: "spaces-list" }, step: { action: "spaces-list", token, copy: describeChange({ layout: name, shipped: isShippedLayout(name), copy: isShippedLayout(name) ? freeCopyName(name, layouts()) : null, from: plan.from, to: target, lines: plan.lines }) } } });
    cx.notify();
  }

  armDecisionPoll(cx) {
    if((!this.spacesPending&&!this.specPermission)||this.closed)return;
    if(this.decisionPollPending&&Date.now()<this.decisionPollPending.until)return;
    const ticket={until:Date.now()+1000};
    this.decisionPollPending=ticket;
    cx.timer.after(250,next=>{
      if(this.decisionPollPending!==ticket)return;
      this.decisionPollPending=null;
      if(this.closed||!next)return;
      this.pollSpacesDecision(next);this.pollSpecDecision(next);
      this.armDecisionPoll(next);
    });
  }

  pollSpecDecision(cx) {
    const pending=this.specPermission;if(!pending)return;
    const decisions=shared("rig.specWriteDecisions")??{},decision=decisions[pending.token];
    if(!decision&&Date.now()<pending.expires)return;
    this.specPermission=null;const rest={...decisions};delete rest[pending.token];setShared("rig.specWriteDecisions",rest);
    pending.box.awaitingPermission=false;
    if(decision==="allow"){
      const again=pending.began?this.specOperation(configOfConnection(this.config,pending.began.config.connectionId),pending.began.fromConn):null;
      if(pending.began&&(!again||!pending.began.stillConfigured())){pending.box.note="This page's OpenRig changed, so nothing more is sent from it. Reopen the page to use the new one.";cx.notify();return;}
      if(pending.request?.verb==="copy-folder")this.copyFolder(cx,pending.spec,pending.confirmation,again);else this.remoteSpecWrite(cx,pending.spec,pending.request,pending.confirmation,again);
    }else {pending.box.note="Nothing was saved on the box.";cx.notify();}
  }

  pollSpacesDecision(cx) {
    const pending = this.spacesPending;
    if (!pending) return;
    const decisions = shared("rig.spacesListDecisions") ?? {}, decision = decisions[pending.token];
    if (!decision && Date.now() < pending.expires) return;
    this.spacesPending = null;
    const rest = { ...decisions }; delete rest[pending.token]; setShared("rig.spacesListDecisions", rest);
    if (decision === "allow") cx.spawn(task => this.runSpacesChange(task, pending));
    else { (this.spacesList ??= {}).note = "Nothing was changed."; cx.notify(); }
  }

  async runSpacesChange(cx, pending) {
    const info = (this.spacesList ??= {});
    info.busy = true; info.note = null; cx.notify();
    const host = {
      layout: () => layout(), layoutName: () => shared("layout"), layouts: () => layouts(), run, wait: waitWith(cx),
      writeState: async (state) => { const path = `${appHome()}/openrig/spaces-list.json`, previous = await readTextFile(path); await writeTextFile(path, JSON.stringify({ ...state, keep: info.state?.keep === true }), previous ?? null); },
    };
    let result;
    try { result = await applySpacesMode(host, pending.shown, pending.target); }
    catch (error) { result = { ok: false, reason: errorDiagnostic(error) }; }
    info.busy = false; info.at = 0; info.noteLayout = result.layout ?? pending.shown.layout;
    info.note = result.ok
      ? (pending.target === "herdr" ? `✓ ${result.layout} uses Herdr's Spaces list again.` : `✓ ${result.layout} now shows ${pending.target === "both" ? "Herdr's list and the Rig spaces block" : "herdrig's Spaces list"}. The way back is on this row.`)
      : result.reason;
    cx.notify();
  }

  /** The Layout card: which Spaces list this layout shows and the choice between Herdr's, herdrig's and both. */
  layoutCard(t, cx) {
    this.refreshSpacesList(cx);
    const info = (this.spacesList ??= {}), name = shared("layout"), now = detectMode(layout());
    const mode = now.mode;
    const why = info.at && info.installed === false ? "herdrig's Spaces list isn't installed. Reinstall herdrig."
      : mode === "none" ? "This layout has no Spaces block, so there's nothing to change."
      : mode === "custom" ? "This layout mixes Herdr's Spaces list and herdrig's in a way herdrig didn't make, so it leaves it alone." : null;
    const kept = info.state?.keep === true;
    const card = [
      v_flex().id("system-spaces-list").gap(6)
        .child(h_flex().gap(8).items_center().flex_wrap()
          .child(div().text_size(12).child('Spaces list'))
          .child(h_flex().gap(2).p(2).rounded(8).bg(t.raised).children(MODES.map(m=>{
            const blocked=!!why||!!info.busy||!!this.spacesPending,selected=m===mode;
            return div().id(`spaces-list-${m}`).tooltip(`Use ${m === "herdr" ? "Herdr's" : m === "herdrig" ? "herdrig's" : "both"} Spaces list in the layout`).px(10).h(24).flex().items_center().rounded(6).text_size(12)
              .bg(selected?t.accent:t.raised).text_color(selected?t.solid_foreground:t.foreground)
              .when(blocked,el=>el.opacity(.45)).when(!blocked,el=>el.cursor_pointer())
              .hover(el=>el.bg(selected?t.accent:blocked?t.raised:t.hover))
              .on_click((_e,ctx)=>{if(!blocked&&!selected)this.chooseSpacesMode(ctx??cx,m);}).child(MODE_LABEL[m]);
          }))))
        .when(!!why, (el) => el.child(div().id("spaces-list-why").text_size(11.5).text_color(t.muted).child(why)))
        .when(mode === "herdrig" || mode === "both", (el) => el.child(div().id("spaces-list-where").text_size(11.5).text_color(t.muted)
          .child(`herdrig's copy of Herdr's list, in layout ${name} · based on Herdr ${BASE_HERDR}`)))
        .when(!!info.busy, (el) => el.child(div().text_size(11.5).text_color(t.muted).child("Changing the layout…")))
        .when(!!info.note && (!info.noteLayout || info.noteLayout === name), (el) => el.child(div().id("spaces-list-note").text_size(11.5).text_color(/^✓/.test(info.note) ? t.muted : t.blocked).child(/^✓/.test(info.note) ? info.note : this.errorText(t,"spaces-list-note-detail",info.note,{where:"this computer"}))))
        .when((mode === "herdrig" || mode === "both") && info.reveal === true && !kept, (el) => el.child(v_flex().id("spaces-list-upstream").gap(6).p(8).rounded(6).bg(t.raised)
          .child(div().text_size(11.5).child("Herdr now keeps the active space in view itself. herdrig's list adds rig marks and actions; keep it, or switch back to Herdr's."))
          .child(h_flex().gap(8)
            .child(this.button(t, "spaces-list-keep", "Keep", (_e, ctx) => this.keepSpacesList(ctx ?? cx), { tip: "Keep herdrig's Spaces list and hide this note", small: true }))
            .child(this.button(t, "spaces-list-switch-back", "Switch back", (_e, ctx) => this.chooseSpacesMode(ctx ?? cx, "herdr"), { tip: "Go back to Herdr's own Spaces list", small: true }))))),
      // OpenRig's Rig layout shouldn't stay on screen: on by default; off brings back the notice and card.
      v_flex().id("system-restore-layout").gap(4)
        .child(h_flex().gap(8).items_center().flex_wrap()
          .child(div().text_size(12).child("Keep my layout when OpenRig opens views"))
          .child(this.restoreLayoutPill(t)))
        .child(div().id("system-restore-layout-note").text_size(11.5).text_color(t.muted).child(restoreLayoutOn(shared)
          ? "herdrig switches back to your layout and leaves OpenRig's views open in the background."
          : "OpenRig's Rig layout stays until you leave it.")),
    ];
    return this.card(t, "Layout", card);
  }

  /** "Keep" on the card that says herdr now has the fix: remembered, and the row's choices stay. */
  keepSpacesList(cx) {
    const info = (this.spacesList ??= {});
    cx.spawn(async (cx) => {
      try {
        const path = `${appHome()}/openrig/spaces-list.json`, previous = await readTextFile(path);
        const next = { ...(previous ? JSON.parse(previous) : {}), keep: true };
        await writeTextFile(path, JSON.stringify(next), previous ?? null);
        info.state = next;
      } catch (error) { info.note = errorDiagnostic(error); }
      cx.notify();
    });
  }

  /** What the folder-copy steps need from this page (see rig-spec-folder.js). The folder is copied on the box when a machine is
   *  configured, else on this computer; the daemon only ever supplies text. */
  folderHost(cx, config, daemonUrl, op = gatedOperation()) {
    // `op` was created by the caller at the moment it captured `config` (before any await): every send of this copy flow belongs to that config.
    const post = (path, init) => op.fetch(`${daemonUrl}${path}`, { method: "POST", ...init });
    return {
      specText: (spec) => this.specText(spec, op, this.specOperation(config)), // read for the copy's own connection, not the page shown when it is asked
      validate: async (text) => {
        const checked = await post("/api/rigs/import/validate", { headers: { "content-type": "text/yaml" }, body: text });
        let v; try { v = JSON.parse(await checked.text()); } catch (e) { v = rethrowGate(null)(e); }
        return { ok: checked.ok && v?.valid !== false, errors: v?.errors ?? (v?.error ? [v.error] : undefined) };
      },
      addFolder: (request, grant) => config.daemonMachine
        ? this.remoteSpecController(cx, null, config).perform(config, { verb: "copy-folder", ...request }, grant)
        : this.localAddFolder(request, daemonUrl, cx, config, op),
      library: async (fresh) => {
        if (fresh) await post("/api/specs/library/sync").catch(rethrowGate(null));
        const res = await op.fetch(`${daemonUrl}/api/specs/library`);
        if (!res.ok) throw new Error("The copy was made, but the library couldn't be read. Refresh before copying again.");
        const list = JSON.parse(await res.text());
        this.cacheFor(config.connectionId)["/api/specs/library"] = { data: list, at: Date.now() }; // the copy's own connection's cache
        return list;
      },
      rename: async (id, name) => {
        const res = await post(`/api/specs/library/${encodeURIComponent(id)}/rename`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
        let data; try { data = JSON.parse(await res.text()); } catch (e) { data = rethrowGate(null)(e); }
        if (!res.ok) throw new Error(`The copy was made but couldn't be renamed${data?.error ?? data?.message ? `: ${errorDiagnostic(data?.error ?? data?.message)}` : ` (error ${res.status}).`}`);
        return data?.entry ?? null;
      },
    };
  }

  /** No machine configured: this computer's own OpenRig copies the folder through the shipped helper, after checking the
   *  daemon this page talks to is this computer's (a copy made here is invisible to another machine's daemon). */
  async localAddFolder(request, daemonUrl, cx, config = this.config, op = gatedOperationOrRefusal()) {
    op.check(); // the CLI and the helper run under the settings this copy began with (the gate judges each result; the operation judges the start)
    const health = async (url) => { const r = await op.fetch(`${url}/healthz`); if (!r.ok) throw new Error("OpenRig isn't answering."); return JSON.parse(await r.text()); };
    const notHere = "The OpenRig this page reads isn't this computer's own, so a copy made here would never be seen by it. Set up the machine first.";
    const several = (config?.connections?.length ?? 0) > 1;
    const helper = attachRelayPath(appHome(), MOD_IDS.view).replace(/rig-attach-relay\.cjs$/, "rig-spec-files.cjs");
    if (several) {
      // With several OpenRigs the gate makes `rig status` carry this page's own address, so it would only echo that address back. The proof comes from
      // the copy's own destination instead: the helper's `rig` copies into ITS spec library (the helper reports its folders first), which must be one of
      // this page's connection's spec folders, and the daemon that library's OpenRig home records (daemon.json: its pid and port) must be the one this
      // page reads.
      const answer = await execFor(config)("node", [helper, "roots"], { timeout: 30000 });
      op.check();
      let library = null; try { library = JSON.parse(answer.stdout)?.roots?.[0] ?? null; } catch (_) { library = null; }
      const mine = await this.specRootsFor(config);
      op.check();
      if (typeof library !== "string" || !/\/specs$/.test(library) || !mine.includes(library))
        throw new Error(`With more than one OpenRig, Copy & edit of a built-in's folder works on this computer only for the OpenRig whose spec library \`rig\` copies into here${typeof library === "string" ? ` (${library})` : ""}. Nothing was copied.`);
      let recorded = null; try { recorded = JSON.parse(await readTextFile(`${library.replace(/\/specs$/, "")}/daemon.json`) ?? "null"); } catch (_) { recorded = null; }
      op.check();
      if (!recorded || !Number.isInteger(recorded.pid) || !Number.isInteger(recorded.port)) throw new Error("OpenRig isn't running on this computer, so a built-in's folder can't be copied here.");
      const there = await health(daemonUrl), parts = addressParts(daemonUrl), port = parts ? Number(parts.port || (parts.protocol === "https:" ? 443 : 80)) : NaN;
      if (there?.pid !== recorded.pid || port !== recorded.port || !isLoopbackDaemonUrl(daemonUrl)) throw new Error(notHere);
    } else {
      const status = parseDaemonStatusJson((await exec("rig", ["status", "--json"], { timeout: 15000 })).stdout);
      op.check();
      if (!status.reachable || !status.daemonUrl) throw new Error("OpenRig isn't running on this computer, so a built-in's folder can't be copied here.");
      const localHealth = async (url) => { const r = await op.localHealth(`${url}/healthz`); if (!r.ok) throw new Error("OpenRig isn't answering."); return JSON.parse(await r.text()); };
      const [here, there] = await Promise.all([localHealth(status.daemonUrl), health(daemonUrl)]);
      if (!sameDaemon(here, there)) // the same host id isn't enough: a host.name-seeded id can be shared by two OpenRigs on this computer
        throw new Error(notHere);
    }
    op.check();
    // With several OpenRigs the helper runs under this page's own connection; with one, as it always did.
    const r = several ? await execFor(config)("node", [helper, "copy-folder", "--local", "--", request.sourcePath], { timeout: 150000 }) : await this.localCopyHelper(helper, request);
    op.check();
    let out; try { out = JSON.parse(r.stdout); } catch (_) { throw new Error(r.stderr || "The copy helper gave no answer."); }
    if (out.error) throw Object.assign(new Error(out.error), { code: out.code, folder: out.folder });
    const roots = await this.specRootsFor(config); // the connection this copy began for
    const file = await resolveInSpecRoots(out.path, roots, execFor(config));
    if (!file) throw new Error(this.specRefusal(config));
    const current = await readTextFile(file);
    if (current == null) throw new Error("The copied spec couldn't be read back.");
    const conflict = `The copied spec at ${file} changed before it could be rewritten. Your copy was kept; reopen it to review the changes.`;
    if (!/^[a-f0-9]{64}$/.test(out.sha256 ?? "") || await this.remoteSpecController(cx, null, config).hashText(config, current) !== out.sha256)
      throw new Error(conflict);
    op.check(); // the helper, the realpath and the readback awaited: the rewrite belongs to the settings this copy began under
    try { await writeTextFile(file, request.content, current); }
    catch { throw new Error(conflict); }
    return { ok: true, path: out.path, folder: out.folder };
  }

  /** One connection: the shipped helper copies the folder on this computer (its exec is the page's own, as one connection always had). */
  async localCopyHelper(helper, request) {
    const r = await exec("node", [helper, "copy-folder", "--local", "--", request.sourcePath], { timeout: 150000 });
    return r;
  }

  /** Copy & edit of a built-in rig spec as a whole folder, then open the copy in edit mode. */
  /** The whole-folder copy (a seam, so a test can hold it at its await). */
  copyBuiltinFolderFor(host, s, consent) { return copyBuiltinFolder(host, s, consent); }
  copyFolder(cx, s, consent = null, began = null) {
    // `began`: the operation a permission dialog was opened for; its answer continues THAT copy, whatever the tab shows when it comes back.
    const spec = began ?? this.specOperation(), shown = spec?.config;
    const box = this.specBoxes?.[spec ? spec.boxKey(s.id) : this.specBoxKey(s.id)];
    if (!box || box.copying || box.awaitingPermission) return;
    if (!shown) { box.note = "This page's OpenRig changed, so nothing more is sent from it. Reopen the page to use the new one."; cx.notify(); return; }
    const refused = shown.daemonMachine ? cliRefusal(shown) : null; if (refused) { box.note = refused; cx.notify(); return; } // a box connection without its own home: HOME_NEEDED
    const config = { ...shown };
    // The operation begins where the config is captured, synchronously: a settings change while the address is resolved (a CLI discovery on a default
    // install) must not pair this config's machine and home with the new address.
    let op; try { op = this.writeOperation(config); } catch (error) { box.note = errorDiagnostic(error); cx.notify(); return; }
    box.copying = true; box.note = null; box.errors = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const daemonUrl = await this.resolveDaemonUrl(config);
        if (!daemonUrl) throw new Error("The daemon address isn't known yet.");
        op.check(); // the address resolved above is for the config that asked
        const host = this.folderHost(cx, config, daemonUrl, op);
        const out = await this.copyBuiltinFolderFor(host, s, consent);
        if (out.needsConsent) {
          if (this.specPermission) throw new Error("Finish the open spec permission dialog first.");
          const token = `spec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          box.awaitingPermission = true;
          this.specPermission = { token, spec: s, request: { verb: "copy-folder" }, box, confirmation: out.confirmation, expires: Date.now() + 300000, began: spec };
          this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 560, height: 420, props: { target: { kind: "spec", id: s.id }, step: { action: "confirm-spec-write", token, confirmation: out.confirmation } } });
          return;
        }
        if (out.exists) { await this.openExistingCopy(cx, s, host, out.folder, box, spec); return; }
        if (!out.ok) { box.errors = out.errors ?? null; box.note = out.reason; return; }
        if (config.daemonMachine) this.specConsentMachine = config.daemonMachine;
        this.showSpecCopy(cx, out.copy, null, spec);
      } catch (error) {
        box.note = error?.folder && /differs from the built-in/.test(String(error.message))
          ? `Your copy of ${s.name} at ${error.folder} was changed since it was made, so Copy & edit didn't overwrite it.`
          : error?.machineNotice && String(error.message).startsWith(`${config.daemonMachine} is unreachable.`)
          ? `${config.daemonMachine} is unreachable, so nothing was copied. Run hc machine login ${config.daemonMachine}, then try again.`
          : plainExecError(error, { machine: config.daemonMachine, kind: config.daemonMachine ? "remote-write" : "write", action: "copy" });
      } finally { box.copying = false; cx.notify(); }
    });
  }

  /** The copy's page, in edit mode, with an optional note above its editor. */
  showSpecCopy(cx, copy, note = null, spec = this.specOperation()) {
    // `spec`: the copy's operation (a bare config from a direct caller). Its marks are that connection's; the page moves to the copy only while
    // this tab still shows the page the copy began on, and the copy's page names the copy's connection.
    const op = typeof spec?.boxKey === "function" ? spec : null, config = op ? op.config : spec;
    if (op && !op.stillConfigured()) return;
    const key = this.specBoxKey(copy.id, config);
    if (!this.specDirty(this.specBoxes?.[key])) delete this.specBoxes?.[key];
    (this.specAutoEdit ??= new Set()).add(key);
    if (note) (this.specCopyNotes ??= Object.create(null))[key] = note;
    else delete this.specCopyNotes?.[key];
    const conn = op ? op.fromConn : config?.connectionId && config.connectionId !== this.config?.connectionId ? config.connectionId : null;
    if (!op || op.onPage()) this.push({ section: "specs", id: copy.id, name: copy.name, specTab: "yaml", ...(conn ? { conn } : {}) });
    this.read(cx, "/api/specs/library", true, null, config ?? null); refreshSidebar();
  }

  /** The built-in's folder already has a copy: open a finished one, finish an unfinished one (its fixed text is put in the editor;
   *  the person's Save is the write), and never overwrite or delete anything. */
  async openExistingCopy(cx, s, host, folder, box, spec = this.specOperation()) {
    const config = typeof spec?.boxKey === "function" ? spec.config : spec; // the copy's own connection (an operation, or a bare config)
    const found = await findExistingCopy(host, s, folder);
    if (box.invalidated || spec?.stillConfigured?.() === false) return;
    if (found.state === "unindexed") {
      box.note = found.reason ?? "You already have a copy folder for this built-in, but the spec library doesn't list it yet. Refresh the library, then try again.";
      return;
    }
    if (found.state === "finished") { this.showSpecCopy(cx, found.entry, `You already have a copy of ${s.name}; this is it.`, spec); return; }
    const key=specDraftKey(found.entry.id,config),draft=(shared("rig.drafts")??{})[key];
    const retained=this.specDirty(this.specBoxes?.[this.specBoxKey(found.entry.id, config)]) || specDraft(draft)
      || specDraft((shared("rig.drafts") ?? {})[olderSpecDraftKey(found.entry.id, config)]);
    if(!retained)setDraft(key, { text: found.rewritten, baseText: found.baseText, baseHash: simpleHash(found.baseText) });
    this.showSpecCopy(cx, found.entry, retained ? null
      : `An earlier copy of ${s.name} wasn't finished. The fixed agent paths are in the editor; press Save to finish it.`, spec);
  }

  remoteSpecController(cx, op = null, config = this.specConfig()) {
    const bridge=attachRelayPath(appHome(),MOD_IDS.view).replace(/rig-attach-relay\.cjs$/,"rig-spec-transport.cjs");
    // With the write's operation, every helper call first checks it: once the settings it began under are gone it refuses to START (each call otherwise takes the generation current at its own start).
    const cfg=config; // the write's own connection (the page's when none is passed): its own gate scope for the helper calls
    if(!cfg){const refuse=async()=>{throw Error(UNKNOWN_CONNECTION);};return{perform:refuse,hashText:refuse,checked:refuse};} // a removed connection: nothing runs, never another connection's
    const isTransferRemove = (a, o) => !o?.on && Array.isArray(a) && a[0] === bridge && a[1] === "remove" && a[2] === appHome()
      && (a.length === 3 || (a.length === 4 && a[3] === "--if-empty"));
    return new RemoteSpecs({exec:op?async(c,a,o)=>{if(!isTransferRemove(a,o))op.check();return execFor(cfg)(c,a,o);}:execFor(cfg),hc:op?async(a,b)=>{op.check();return hcFor(cfg)(a,b);}:hcFor(cfg),machines,wait:waitWith(cx),appHome:appHome(),specBridgePath:bridge,
      health:async url=>{const r=await this.writeOperation(cfg).fetch(`${url}/healthz`);if(!r.ok)throw Error("OpenRig isn't answering.");return JSON.parse(await r.text());},
      currentConfig:async()=>preserveCliDiscoveredConfig(parseConfig(await readTextFile(CONFIG())),this.config),
      // The connection the write began for, as the file says it NOW: another connection's own view; a removed one reads as none, so the write's identity check refuses.
      connectionOf:base=>!cfg||cfg.connectionId===base?.connectionId||!(base?.connections??[]).length?base:((c=>c?connectionConfig(base,c):{})(base.connections.find(c=>c.id===cfg.connectionId))),
      writeText:writeTextFile,
      readSpecConsent:async()=>consentOf(await readTextFile(`${appHome()}/openrig/spec-consent.json`),cfg?.connectionId??LEGACY_CONNECTION_ID),
      writeSpecConsent:async value=>{
        const path=`${appHome()}/openrig/spec-consent.json`,previous=await readTextFile(path);
        return writeTextFile(path,consentText(previous,cfg?.connectionId??LEGACY_CONNECTION_ID,value).trimEnd(),previous??null);
      },
    });
  }

  /** Remote targets go only to the pinned box helper; registration is HTTP-only. */
  remoteSpecWrite(cx,s,request,consent=null,began=null) {
    // `began`: the operation a permission dialog was opened for; its answer continues THAT write, whatever the tab shows when it comes back.
    const spec=began??this.specOperation(),shown=spec?.config;
    const box=this.specBoxes?.[spec?spec.boxKey(s.id):this.specBoxKey(s.id)];if(!box||box.saving||box.copying||box.awaitingPermission)return;
    if(!shown){box.note="This page's OpenRig changed, so nothing more is sent from it. Reopen the page to use the new one. Unsaved text stays here.";cx.notify();return;}
    const refused=cliRefusal(shown);if(refused){box.note=refused;cx.notify();return;} // a connection without its own OpenRig home: HOME_NEEDED, nothing sent
    const config={...shown},fromConn=spec.fromConn;
    const saving = request.verb === "save", draftKey = saving ? spec.draftKey(s.id) : null;
    // Begun with the captured connection, before the task: the validation below is only good for the connection and config this write began under.
    let op;try{op=this.writeOperation(config);}catch(e){box.note=errorDiagnostic(e);cx.notify();return;}
    box[request.verb==="copy"?"copying":"saving"]=true;box.note=null;cx.notify();
    cx.spawn(async cx=>{
      let reread;
      try{
        const daemonUrl=await this.resolveDaemonUrl(config);if(!daemonUrl)throw Error("The daemon address isn't known yet.");
        let content=request.content??await this.specText(s,op,spec);
        if(request.verb==="copy"){
          const prepared=copyableSpecText(content,s.sourcePath);
          if(prepared.refused)throw Error(prepared.refused);
          content=prepared.text;
        }
        const operation={...request,content};
        const route=s.kind==="agent"?"/api/agents/validate":"/api/rigs/import/validate";
        const checked=await op.fetch(`${daemonUrl}${route}`,{method:"POST",headers:{"content-type":"text/yaml"},body:content});
        let validation;try{validation=JSON.parse(await checked.text());}catch(e){validation=rethrowGate(undefined)(e);}
        if(!checked.ok||validation?.valid===false){box.errors=validation?.errors??[validation?.error??"Validation failed."];return;}
        op.check();
        let result;
        try { result=await this.remoteSpecController(cx,op,config).perform(config,operation,consent); }
        catch (error) {
          if (saving && error?.code === "GATE_REFUSED" && error.confirmedSpecSave === true) {
            this.finishRemoteSpecSave(box, s, spec, draftKey, content, { refused: true });
            return;
          }
          throw error;
        }
        if (box.invalidated) {
          if (saving && result.ok && !result.needsConsent) this.reconcileSavedSpecDraft(box, draftKey, s.id, config, content);
          return;
        }
        if(result.needsConsent){
          if(this.specPermission)throw Error("Finish the open spec permission dialog first.");
          const token=`spec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          box.awaitingPermission=true;
          this.specPermission={token,spec:s,request:operation,box,confirmation:result.confirmation,expires:Date.now()+300000,began:spec};
          this.open({mod:MOD_IDS.menu,kind:"dialog",width:560,height:340,props:{target:{kind:"spec",id:s.id},step:{action:"confirm-spec-write",token,confirmation:result.confirmation}}});return;
        }
        if(!result.ok)throw Error(result.reason??"The box did not confirm the write.");
        this.specConsentMachine=config.daemonMachine;
        const synced=await this.syncLibrary(op,daemonUrl);
        if (saving) this.finishRemoteSpecSave(box, s, spec, draftKey, content, synced);
        if (box.invalidated) return;
        if (!saving) {
          if(!synced?.ok)throw Error(synced?.refused?`The copy was saved on ${config.daemonMachine}, but OpenRig's settings changed before the library could be updated. Refresh the library before copying again.`:`The copy was saved on ${config.daemonMachine}, but library re-index failed. Refresh the library before copying again.`);
          const response=await op.fetch(`${daemonUrl}/api/specs/library`);if(!response.ok)throw Error("The copy was saved, but the library couldn't be read. Refresh before copying again.");
          const list=JSON.parse(await response.text()),copy=list.find(x=>x.sourceType==="user_file"&&x.sourcePath===result.path);
          if(!copy)throw Error("The copy was saved, but isn't indexed yet. Refresh before copying again.");
          spec.cache()["/api/specs/library"]={data:list,at:Date.now()}; // the copy's own connection's cache, not the page's by now
          (this.specAutoEdit??=new Set()).add(spec.boxKey(copy.id));delete this.specBoxes[spec.boxKey(copy.id)];
          const lacking=s.sourceType==="user_file"?null:siblingFileNote(siblingFileNames(content));
          if(lacking)(this.specCopyNotes??=Object.create(null))[spec.boxKey(copy.id)]=lacking;
          if(spec.onPage())this.push({section:"specs",id:copy.id,name:copy.name,specTab:"yaml",...(fromConn?{conn:fromConn}:{})});
        }
        reread = spec.rereadLibrary(cx);refreshSidebar();
      }catch(error){
        if(error.code==="conflict"){
          box.conflict=this.specConflictMessage(config);
          try{box.diskText=await this.specText(s,null,spec);}catch{}
        }else if(error.machineNotice&&String(error.message).startsWith(`${config.daemonMachine} is unreachable.`)){
          box.note=`${config.daemonMachine} is unreachable, so nothing was saved. Your edits are still here. Run hc machine login ${config.daemonMachine}, then save again.`;
        }else box.note=plainExecError(error,{machine:config.daemonMachine,kind:config.daemonMachine?"remote-write":"write",action:request.verb==="copy"?"copy":"save"});
      }finally{box.saving=false;box.copying=false;cx.notify();}
      await reread;
    });
  }

  /** "Launch rig from spec…": rig specs only, with or without a file (the menu and palette use the same rule). */
  launchButton(t, spec, id = "spec-launch") {
    return this.button(t, id, "Launch rig from spec…", () => this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: LAUNCH_DIALOG_HEIGHT,
      props: { target: { kind: "spec", id: spec.id, conn: this.shownConnId(), name: spec.name, sourcePath: spec.sourcePath ?? null, specKind: "rig" }, step: { action: "launch-spec" } } }), { iconName: "rig-play" });
  }

  scopes(t, cx, entry) {
    const projectsRes = this.read(cx, "/api/scopes/projects");
    const projList = Array.isArray(projectsRes.data?.projects) ? projectsRes.data.projects : [];
    const pageConn = this.awayConnId(entry?.conn ?? this.activeConnId());
    const activeProject = effectiveScopeProject(entry.project, readScopeProject(shared, this.config, pageConn, projectsRes.data), projectsRes.data);
    // `/api/scopes?detail=1`: { missions: [{ mission, slices: [{ dirName, displayName, status, stage, intent,
    // miniRequirements, proofContract, narrative (PROGRESS.md) }] }] }.
    const scopePath = activeProject ? `/api/scopes?detail=1&project=${encodeURIComponent(activeProject)}` : "/api/scopes?detail=1";
    const scopes = this.read(cx, scopePath);
    const selectedProjId = activeProject
      ?? scopes.data?.project?.id
      ?? scopes.data?.projectId
      ?? projList.find((p) => p.isDefault)?.id
      ?? projList[0]?.id
      ?? null;
    const selectedProj = projList.find((p) => p.id === selectedProjId) ?? null;
    const focusProjects = shared("rig.focus") === "scopes-projects" || !!entry.focusProjects;
    const projectBar = projList.length > 1
      ? v_flex().gap(6)
        .child(h_flex().id("scopes-project-bar").px(10).py(6).gap(6).items_center().flex_wrap().rounded(8).bg(t.raised)
          .border_1().border_color(focusProjects ? t.accent : t.border)
          .child(div().text_size(11.5).text_color(t.muted).child("Scopes ▸ project:"))
          .children(projList.map((p) => {
            const on = p.id === selectedProjId;
            return h_flex().id(`scopes-project-${p.id}`).px(8).h(24).gap(5).rounded(6).items_center().cursor_pointer().tooltip(`Show ${p.name ?? p.id}'s missions in Scopes`)
              .bg(on ? t.accent : t.raised).border_1().border_color(on ? t.accent : t.border).hover((s) => s.bg(on ? t.accent : t.hover))
              .text_size(11.5).font_semibold().text_color(p.error ? t.blocked : on ? (t.solid_foreground ?? t.background) : t.muted)
              .on_click((_e, ctx) => {
                // A new project drops this connection's Scopes drill-downs (as before) and opens that project's Scopes page for the SAME
                // connection; another connection's Scopes pages (another tab's) stay as they are.
                const conn = entry?.conn ?? this.shownEntry()?.conn ?? null;
                writeScopeProject({ shared, setShared }, this.config, conn ?? pageConn, p.id);
                this.editShownStack((stack) => [...stack.filter((e) => e?.section !== "scopes" || (e.conn ?? null) !== conn), { section: "scopes", project: p.id, ...(conn ? { conn } : {}) }]);
                this.read(ctx ?? cx, `/api/scopes?detail=1&project=${encodeURIComponent(p.id)}`, true); // the click's own cx: this render's is gone by then
              })
              .child(p.name ?? p.id)
              .when(!!p.error, (el) => el.child(div().text_size(11).text_color(t.blocked).child("⚠")));
          })))
        .when(!!selectedProj?.error, (el) => el.child(div().id("scopes-project-error").px(10).py(6).rounded(6).border_1().border_color(t.blocked).text_size(12).text_color(t.blocked).child(this.errorText(t,"scopes-project-error-detail",selectedProj.error))))
      : null;
    const paths = this.slicePaths(cx, activeProject);
    const wait = this.status(t, cx, scopePath, scopes);
    if (wait) return projectBar ? v_flex().gap(12).child(projectBar).child(wait) : wait;
    const missions = scopes.data.missions ?? [];
    const sliceTarget = (m, s) => ({
      kind: "slice",
      conn: this.shownConnId(), // a scope belongs to the connection this page shows
      mission: m.mission ?? m.id ?? m.name,
      slice: s.dirName ?? s.id ?? s.slug,
      name: s.displayName ?? s.dirName ?? s.id ?? s.slug,
      id: s.id,
      slicePath: s.slicePath ?? paths.get(s.dirName) ?? paths.get(s.id) ?? null,
    });
    if (entry.slice) {
      const candidateMissions = entry.mission
        ? missions.filter((x) => x.mission === entry.mission || x.id === entry.mission || x.name === entry.mission)
        : missions;
      const s = candidateMissions
        .flatMap((x) => x.slices ?? [])
        .find((x) => x.dirName === entry.slice || x.id === entry.slice || x.slug === entry.slice);
      if (!s) {
        const missing = this.dim(t, `${entry.slice} isn't in ${entry.mission ?? "this project"} any more.`);
        return projectBar ? v_flex().gap(12).child(projectBar).child(missing) : missing;
      }
    } else if (entry.mission) {
      const m = missions.find((x) => x.mission === entry.mission || x.id === entry.mission || x.name === entry.mission);
      if (!m) {
        const missing = this.dim(t, `${entry.mission} isn't in this project any more.`);
        return projectBar ? v_flex().gap(12).child(projectBar).child(missing) : missing;
      }
    }
    let workflowUnavailable=null;
    if(entry.mission&&!entry.slice){
      const project=selectedProjId,root=selectedProj?.root??scopes.data?.project?.root;
      const path=workflowPath({mission:entry.mission,project,projectRoot:root}),got=this.read(cx,path);
      const model=workflowView(got.data,{mission:entry.mission,project});
      const selectedWorkflow=model.instances.find(w=>w.id===entry.workflow);
      if(selectedWorkflow)this.pageCrumbEntry={...entry,workflowName:selectedWorkflow.title,...(!entry.packet?{name:selectedWorkflow.title}:{})};
      this.workflowCounts={workflowsSupported:model.supported,workflows:model.instances.length};
      this.activePageView=selectedPageView(entry,this.pageViewMemory??={},null,this.workflowCounts);
      if(got.loading&&got.data===undefined)return this.dim(t,'Reading workflows…');
      const resolved={...entry,project:project??entry.project};
      if(entry.workflow||this.activePageView==='workflows'){
        const panel=new WorkflowPanel(this,{navigate:entry=>this.push(entry),monoFamily:settings()?.font_family??'JetBrains Mono',ownerEntry:session=>{
          const found=resolveAskerSeat(session,this.currentTopology(cx),entry.conn??null,this.config);if(!found.found)return null;
          const s=found.seat;return {section:'topology',kind:'seat',rig:s.rig,rigId:s.rigId,conn:s.conn,name:s.logicalId,session:s.session,pod:s.pod};
        },queueEntry:id=>validHealthQitemId(id)?{section:'system',subview:'health',healthQitem:id}:null,
        time:(value,exact=false)=>value==='INDETERMINATE'?'unknown':value==null?'not reported':this.time?this.time(value,{exact}):asOf(value).replace(/^as of /,'')});
        if(!entry.workflow)this.pageHeading={title:entry.mission,status:`${model.instances.length} workflow${model.instances.length===1?'':'s'}`};
        return panel.render(t,cx,resolved,model);
      }
      if(!model.supported)workflowUnavailable=this.dim(t,"This OpenRig doesn't serve workflow views.");
    }
    // A proof item is checked only when evidence cites it (ProofContractItem.paired).
    const checklist = (items) => v_flex().gap(4).children((items ?? []).map((x) => {
      const text = typeof x === "string" ? x : x.text;
      const done = typeof x === "object" && x.paired;
      return h_flex().gap(8).items_start()
        .child(done ? svg(icon("check")).size(13).flex_none().text_color(t.working) : div().mt(3).size(9).flex_none().rounded(5).border(1.5).border_color(t.dim))
        .child(div().flex_1().child(this.plain(t, text)));
    }));
    const open = shared("rig.open.page") ?? {};
    const f = this.filter?.toLowerCase();
    let expandedSliceCount = 0;
    const renderMissionCard = (m, mi) => {
      const mKey = m.id ?? m.mission ?? m.name ?? `m-${mi}`;
      const mTitle = m.mission ?? m.name ?? m.id ?? mKey;
      const workflowProject=selectedProjId,workflowRoot=selectedProj?.root??scopes.data?.project?.root;
      const missionWorkflows=this.read(cx,workflowPath({mission:mTitle,project:workflowProject,projectRoot:workflowRoot}));
      const hasWorkflows=workflowView(missionWorkflows.data,{mission:mTitle,project:workflowProject}).instances.length>0;
      const firstSlicePath = (m.slices ?? []).map((s) => s.slicePath ?? paths.get(s.dirName) ?? paths.get(s.id)).find(Boolean);
      const missionFolder = m.missionPath ?? (firstSlicePath ? firstSlicePath.split(/[\\/]/).slice(0, -2).join("/") : null);
      // Mission and slice files are read on THIS computer: an OpenRig on a machine has its files there, so its page offers no file chips.
      const filesOn = this.activeConfig()?.daemonMachine ?? null;
      const missionFiles = filesOn ? []
        : Array.isArray(m.files)
        ? m.files.map((name) => [name, missionFolder ? `${missionFolder}/${name}` : name])
        : missionFolder
          ? MISSION_FILES.map((name) => [name, `${missionFolder}/${name}`, this.exists(cx, `${missionFolder}/${name}`)]).filter(([, , on]) => on === true)
          : [];
      const missionFocused = Boolean(
        (entry.mission && (entry.mission === m.mission || entry.mission === mKey)) ||
        shared("rig.focus") === `mission:${mKey}` ||
        shared("rig.focus") === `mission:${mTitle}`,
      );
      let slices = m.slices ?? [];
      if (f) {
        slices = slices.filter((s) => [s.displayName, s.dirName, s.id, s.slug, s.status, s.stage, s.intent, mTitle].some((c) => String(c ?? "").toLowerCase().includes(f)));
      }
      const headerMeta = h_flex().gap(6).items_center().flex_wrap()
        .children(missionFiles.map(([name, filePath]) =>
          h_flex().id(`mission-file-${mKey}-${name}`).px(7).h(20).gap(4).items_center().rounded(5).cursor_pointer().tooltip(`Open ${name}`)
            .bg(t.raised).border_1().border_color(t.border).hover((x) => x.bg(t.hover))
            .on_click((_e, cx) => { cx?.stop_propagation?.(); this.push(fileEntry(filePath, `${name} · ${mTitle}`)); })
            .child(svg(icon("file-text")).size(11).flex_none().text_color(t.muted))
            .child(div().text_size(11).text_color(t.foreground).child(name))
            .child(this.copyButton(t, filePath, `mission-file-${mKey}-${name}`, "path"))))
        .when(Boolean(filesOn) && Boolean(missionFolder || m.files), (el) => el.child(div().id(`mission-files-on-${mKey}`).text_size(11).text_color(t.dim).child(`Files are on ${filesOn}`)))
        .child(div().text_size(11.5).text_color(t.dim).child(`${(m.slices ?? []).length} slice${m.slices?.length===1?"":"s"}`));
      const rows = slices.map((s, si) => {
        const sKey = s.id ?? s.slug ?? s.dirName ?? `s-${si}`;
        const sDir = s.dirName ?? sKey;
        const sName = s.displayName ?? sDir;
        const openKey = `slice:${mKey}/${sKey}`;
        const altOpenKey = `slice:${mTitle}/${sDir}`;
        const routeTargeted = Boolean(entry.slice && (entry.slice === sDir || entry.slice === sKey || entry.slice === s.slug) && (!entry.mission || entry.mission === mTitle || entry.mission === mKey));
        const shown = (open[openKey] ?? open[altOpenKey]) !== undefined
          ? Boolean(open[openKey] ?? open[altOpenKey])
          : routeTargeted;
        const isFirstExpanded = shown && expandedSliceCount++ === 0;
        const sliceFocused = routeTargeted || shared("rig.focus") === openKey || shared("rig.focus") === altOpenKey || shared("rig.focus") === `slice:${sKey}` || shared("rig.focus") === `slice:${sDir}`;
        const toggleSlice = (_e, cx) => {
          cx?.stop_propagation?.();
          const cur = shared("rig.open.page") ?? {};
          const next = !shown;
          setShared("rig.open.page", { ...cur, [openKey]: next, [altOpenKey]: next });
        };
        const folder = s.slicePath ?? paths.get(sDir) ?? paths.get(sKey) ?? null;
        const knownFiles = filesOn ? []
          : Array.isArray(s.files)
          ? s.files.map((name) => [name, folder ? `${folder}/${name}` : name])
          : folder
            ? SLICE_FILES.map((name) => [name, `${folder}/${name}`, this.exists(cx, `${folder}/${name}`)]).filter(([, , on]) => on === true)
            : [];
        const readingFiles = !filesOn && !Array.isArray(s.files) && folder
          ? SLICE_FILES.some((name) => this.exists(cx, `${folder}/${name}`) === null)
          : false;
        const followReason = capabilityDisableReason("follow", this.caps());
        const doFollow = (_e, cx) => {
          cx?.stop_propagation?.();
          this.oneClick({ kind: "follow-target", conn: this.shownConnId(), view: `slice:${s.id ?? sDir}`, name: sName }, "follow", `slice-follow-${sKey}`);
        };
        return v_flex().id(`slices-${mi}-${si}`).when(sliceFocused, (el) => el.rounded(6).border_1().border_color(t.accent))
          .child(h_flex().id(`slice-row-${mKey}-${sKey}`).px(8).h(30).gap(10).items_center().rounded(6).cursor_pointer().hover((x) => x.bg(t.hover))
            .tooltip(`${shown ? "Close" : "Open"} slice ${sName}; right-click for its actions`).on_click(toggleSlice)
            .on_mouse_down("right", () => this.menu(sliceTarget(m, s)))
            .child(svg(icon(shown ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim))
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).tooltip(String(sName??"")).child(sName))
            .child(this.copyButton(t, sKey, `slice-id-${sKey}`, "slice id"))
            .child(div().w(100).flex_none().truncate().text_size(12.5).text_color(t.muted).tooltip(statusWord(s.status ?? "","startup")).child(statusWord(s.status ?? "","startup")))
            .child(div().w(100).flex_none().truncate().text_size(12.5).text_color(t.muted).tooltip(String(s.stage ?? ""??"")).child(s.stage ?? "")))
          .when(shown, (el) => el.child(v_flex().id(`slice-expand-${sKey}`).ml(22).pl(10).py(8).gap(8).border_l(1).border_color(sliceFocused ? t.accent : t.border)
            .on_click((_e, cx) => cx?.stop_propagation?.())
            .child(h_flex().gap(10).items_center().child(div().text_size(11.5).font_semibold().text_color(t.muted).child("Readiness")).child(div().text_size(12.5).font_semibold().child(statusWord(s.status ?? "—","startup"))).child(this.dim(t, statusWord(s.stage ?? "","startup"))))
            .when(!!s.intent, (c) => c.child(this.plain(t, s.intent).text_color(t.muted)))
            .when(!!s.miniRequirements?.length, (c) => c.child(v_flex().gap(4).child(div().text_size(11.5).text_color(t.dim).child("Mini-requirements")).child(checklist(s.miniRequirements))))
            .when(!!s.proofContract?.length, (c) => c.child(v_flex().gap(4).child(div().text_size(11.5).text_color(t.dim).child("Proof contract")).child(checklist(s.proofContract))))
            .child(knownFiles.length
              ? h_flex().gap(6).items_center().flex_wrap().children(knownFiles.map(([name, filePath], fi) => {
                  const openFile = (_e, cx) => { cx?.stop_propagation?.(); this.push(fileEntry(filePath, `${name} · ${sName}`)); };
                  const compatFileId = isFirstExpanded ? `file-${fi}-${name}` : `file-${sKey}-${fi}-${name}`;
                  return div().id(`slice-file-${sKey}-${name}`).tooltip(`Open ${name}`).on_click(openFile).child(
                    h_flex().id(compatFileId).px(8).h(24).gap(5).items_center().rounded(6).cursor_pointer()
                      .bg(t.raised).border_1().border_color(t.border).hover((x) => x.bg(t.hover))
                      .tooltip(`Open ${name}`).on_click(openFile)
                      .child(svg(icon("file-text")).size(12).flex_none().text_color(t.muted))
                      .child(div().text_size(11.5).text_color(t.foreground).child(name))
                      .child(this.copyButton(t, filePath, `slice-file-${sKey}-${fi}`, "path")),
                  );
                }))
              : this.dim(t, !folder ? "OpenRig doesn't say where this slice is on disk." : readingFiles ? "Looking…" : "None of the files are on disk."))
            .child(h_flex().gap(8).items_center()
              .child(div().id(isFirstExpanded ? "follow-slice" : `follow-slice-${sKey}`).tooltip(followReason ?? "Keep a worker view of this slice open and up to date").on_click((_e, cx) => { if (!followReason) doFollow(_e, cx); }).child(
                this.button(t, `slice-follow-${sKey}`, "Follow this slice", doFollow, { primary: true, small: true, iconName: "rig-follow", disabled: !!followReason, tooltip: followReason, tip: "Keep a worker view of this slice open and up to date", actionKey: "follow" }),
              ))
              .when(!!followReason, (c) => c.child(this.workerCapabilityNote(t, followReason))))));
      });
      return v_flex().id(`mission-card-${mKey}`).rounded(10).bg(t.background).border_1().border_color(missionFocused ? t.accent : t.border).p(12).gap(8)
        .child(h_flex().gap(8).items_center().flex_wrap()
          .child(div().id(`mission-open-${mKey}`).flex_1().text_size(12.5).font_semibold().text_color(t.accent).cursor_pointer()
            .tooltip("Open mission").on_click(()=>this.push({section:"scopes",...(workflowProject?{project:workflowProject}:{}),mission:mTitle,missionTab:hasWorkflows?"workflows":"slices"})).child(mTitle))
          .child(this.copyButton(t, mKey, `mission-${mKey}`, "mission id"))
          .child(headerMeta))
        .when(!!m.error, (el) => el.child(this.errorText(t,"scope-mission-error",m.error)))
        .child(v_flex()
          .child(h_flex().px(8).h(24).gap(10).items_center().border_b(1).border_color(t.border).text_size(11).text_color(t.dim)
            .child(div().w(12)).child(div().flex_1().child("Slice")).child(div().w(100).flex_none().child("Status")).child(div().w(100).flex_none().child("Stage")))
          .children(rows.length ? rows : [div().p(10).text_size(12).text_color(t.dim).child(f ? `No matches for /${this.filter}.` : "No slices in this mission.")]));
    };
    return v_flex().gap(12)
      .when(!!projectBar, (el) => el.child(projectBar))
      .when(!!workflowUnavailable,el=>el.child(workflowUnavailable))
      .children(missions.length ? missions.filter(m=>!entry.mission||[m.mission,m.id,m.name].includes(entry.mission)).map((m, i) => renderMissionCard(m, i)) : [this.dim(t, "No missions or slices in this project.")]);
  }

  terminalPreviewBody(t, cx, viewKey, isFirstExpanded = true) {
    const caps = this.caps();
    if (caps.probed === false) return this.dim(t, "Checking OpenRig's view-preview support…");
    const capReason = caps.hostWorkerViews ? null : "Saved views and Follow need an OpenRig that can plan worker views.";
    if (capReason) return this.workerCapabilityNote(t, capReason);
    const fullPath = `/api/terminal/preview?view=${encodeURIComponent(viewKey)}&provider=herdr-app&viewportColumns=160`;
    const preview = this.read(cx, fullPath);
    if (preview.status === 401 || /\b401\b/.test(String(preview.error ?? ""))) {
      return this.dim(t, TERMINAL_TOKEN_PROTECTED);
    }
    const wait = this.status(t, cx, fullPath, preview);
    if (wait) return wait;
    const normalized = normalizeTerminalPreview(preview.data?.composed, viewKey, this.pageRigData()?.topology ?? []); // the page's own rigs: a rig is found by name
    const opened = normalized.opened;
    const absent = normalized.absent;
    const degraded = normalized.degraded;
    const pages = normalized.pages;
    const rigName = normalized.rigName;
    const rigEntry = rigName ? rigOfConnection(this.rigData()?.topology ?? [], rigName, this.activeConnId(), this.config) : null; // within the page's own connection
    const noAttachableReason = opened.length === 0
      ? `No attachable seats (${absent.length} absent${degraded.length ? `, ${degraded.length} degraded` : ""})`
      : null;
    const openReason = capReason ?? noAttachableReason;
    const doOpen = (_e, cx) => {
      cx?.stop_propagation?.();
      this.oneClick({ kind: "open-view", view: viewKey, plan: preview.data?.planId, rig: rigName, rigId: rigEntry?.id ?? null, conn: rigEntry?.conn ?? this.activeConnId() }, "open-view", `open-view-${viewKey}`);
    };
    const doResume = (_e, cx) => {
      cx?.stop_propagation?.();
      if (!rigName) return;
      this.open({
        mod: MOD_IDS.menu,
        kind: "dialog",
        width: 460,
        height: 380,
        props: {
          target: { kind: "rig", rig: rigName, rigId: rigEntry?.id ?? null, conn: rigEntry?.conn ?? this.activeConnId(), lifecycle: rigEntry?.lifecycleState ?? rigEntry?.lifecycle ?? "stopped" },
          step: { action: "resume", confirm: true },
        },
      });
    };
    const openWrapperId = isFirstExpanded ? "open-view" : `open-view-wrap-${viewKey}`;
    const pagePrefix = isFirstExpanded ? "page" : `page-${viewKey}`;
    const workerLine=this.hostWorkerLine(t,rigEntry??{id:encodeURIComponent(viewKey),name:viewKey},viewKey);
    return v_flex().gap(8)
      .when(!!workerLine,el=>el.child(workerLine))
      .child(h_flex().gap(10).items_center().flex_wrap()
        .child(this.dim(t, `${opened.length} attachable · ${absent.length} absent${degraded.length ? ` · ${degraded.length} degraded` : ""} · ${pages.length} page${pages.length===1?"":"s"}`))
        .child(div().flex_1())
        .when(opened.length === 0 && Boolean(rigName) && Boolean(normalized.rigStopped), (el) => el.child(
          this.button(t, `resume-terminal-rig-${rigName}`, "Rig is stopped · Resume…", doResume, { primary: true, small: true, iconName: "rig-play", tip: `Resume ${rigName} so this view can open: asks first` }),
        ))
        .child(div().id(openWrapperId).tooltip(openReason ?? "Open this worker view").on_click((_e, cx) => { if (!openReason) doOpen(_e, cx); }).child(
          this.button(t, `open-view-${viewKey}`, caps.hostWorkerViews?"Worker view":"Open", doOpen, { primary: opened.length > 0, small: true, iconName: "rig-view", disabled: !!openReason, tooltip: openReason, tip: "Open this worker view", actionKey: "open-view", conn: rigEntry?.conn ?? this.activeConnId() }),
        )))
      .when(!!openReason, (el) => el.child(this.dim(t, openReason)))
      .when(absent.length > 0, (el) => el.child(this.card(t, `Absent seats (${absent.length})`, [
        this.table(
          t,
          `term-absent-${viewKey}`,
          [["Seat"], ["Reason", 180]],
          absent.map((a) => ({ cells: [a.label ?? a.logicalId ?? a.seat ?? a.sessionName ?? "—", a.reason ?? "seat-not-running"] })),
          "No absent seats.",
        ),
      ])))
      .when(degraded.length > 0, (el) => el.child(this.card(t, `Degraded seats (${degraded.length})`, [
        this.table(
          t,
          `term-degraded-${viewKey}`,
          [["Seat", 160], ["Reason"]],
          degraded.map((seat) => ({ cells: [seat.label ?? seat.logicalId ?? seat.seat ?? seat.sessionName ?? "—", seat.reason ?? "OpenRig reported a degraded seat"] })),
          "No degraded seats.",
        ),
      ])))
      .children(pages.map((page, i) => this.card(t, `Page ${i + 1}`, [this.table(t, `${pagePrefix}-${i}`, [["Seat"], ["Mode", 110]], page.map((p) => ({ cells: [p.label, p.readOnly ? "read-only" : "interactive"] })), "No panes in this page.")])));
  }

  terminals(t, cx, entry) {
    const views = this.read(cx, "/api/terminal/views");
    if (views.status === 401 || /\b401\b/.test(String(views.error ?? ""))) {
      return this.card(t, "Terminals", [div().id("terminals-token-protected").text_size(12).text_color(t.dim).child(TERMINAL_TOKEN_PROTECTED)]);
    }
    if (!entry.view) {
      const wait = this.status(t, cx, "/api/terminal/views", views);
      if (wait) return wait;
    }
    const rows = [
      ...(views.data?.saved ?? []).map((s) => ({ view: `saved:${s.id}`, name: s.name ?? s.id, kind: "saved" })),
      ...(views.data?.rigs ?? []).map((r) => ({ view: `rig:${r}`, name: r, kind: "rig" })),
    ];
    if (entry.view && !rows.some((r) => r.view === entry.view)) {
      rows.push({ view: entry.view, name: entry.name ?? entry.view, kind: entry.view.startsWith("saved:") ? "saved" : "rig" });
    }
    const f = this.filter?.toLowerCase();
    const list = f ? rows.filter((r) => [r.name, r.view, r.kind].some((c) => String(c ?? "").toLowerCase().includes(f))) : rows;
    const open = shared("rig.open.page") ?? {};
    const toggle = (viewKey) => {
      const cur = shared("rig.open.page") ?? {};
      const curShown = cur[`term-view:${viewKey}`] !== undefined
        ? Boolean(cur[`term-view:${viewKey}`])
        : entry.view === viewKey;
      setShared("rig.open.page", { ...cur, [`term-view:${viewKey}`]: !curShown });
    };
    let expandedTermCount = 0;
    return this.card(t, "Terminals", [v_flex()
      .child(h_flex().px(8).h(24).gap(10).items_center().border_b(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(div().w(12)).child(div().flex_1().child("View")).child(div().w(90).flex_none().child("Kind")))
      .children(list.length ? list.map((r, i) => {
        const shown = open[`term-view:${r.view}`] !== undefined
          ? Boolean(open[`term-view:${r.view}`])
          : entry.view === r.view;
        const isFirstExpanded = shown && expandedTermCount++ === 0;
        const toggleRow = (_e, cx) => { cx?.stop_propagation?.(); toggle(r.view); };
        return v_flex().id(`views-${i}`)
          .child(h_flex().id(`term-row-${r.view}`).px(8).h(30).gap(10).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
            .tooltip(`${shown ? "Close" : "Open"} ${r.name}; right-click for its actions`).on_click(toggleRow)
            .on_mouse_down("right", () => this.menu({ kind: "terminal", conn: this.shownConnId(), view: r.view, name: r.name, ...(r.kind === "rig" ? { rig: r.name } : {}) }))
            .child(svg(icon(shown ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim))
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).tooltip(String(r.name??"")).child(r.name))
            .child(this.copyButton(t, r.view, `view-id-${r.view}`, "view id"))
            .child(div().w(90).flex_none().truncate().text_size(12.5).text_color(t.muted).tooltip(String(r.kind??"")).child(r.kind)))
          .when(shown, (el) => el.child(v_flex().id(`term-preview-${r.view}`).ml(22).pl(10).py(8).border_l(1).border_color(t.border)
            .on_click((_e, cx) => cx?.stop_propagation?.())
            .child(this.terminalPreviewBody(t, cx, r.view, isFirstExpanded))));
      }) : [div().p(10).text_size(12).text_color(t.dim).child(f ? `No matches for /${this.filter}.` : "No saved or active terminal views.")])]);
  }

  currentTopology(cx) {
    const fromShared = this.config?.configInvalid ? null : this.rigData()?.topology; // a refused list shows no rows another mod left behind
    if (Array.isArray(fromShared) && fromShared.length > 0) return fromShared;
    const summaryCfg = this.activeConfig();
    // Consume completed reads on the next draw, whose context owns the node reads.
    const summary = this.cache["/api/rigs/summary"]?.data ?? this.read(cx, "/api/rigs/summary", false, null, summaryCfg).data ?? [];
    return (Array.isArray(summary) ? summary : []).filter((r) => r && !r.archivedAt).map((r) => this.rigModelOf(r, this.nodesOf(cx, r.id).data));
  }

  openAskerSeat(cx, n) {
    const asker = n?.asker ?? (n?.logicalId && n?.rig ? `${n.logicalId}@${n.rig}` : null);
    const assistant=assistantForNeed({...n,asker},this.hostedMembers(cx));
    if(assistant){const rig=this.currentTopology(cx).find(r=>r.name===assistant.rig&&r.conn===assistant.conn);this.push({section:'topology',kind:'assistant',session:assistant.seat,conn:assistant.conn,rig:assistant.rig,rigId:rig?.id,name:assistant.name});return;}
    const resolved = resolveAskerSeat(asker, this.currentTopology(cx), n?.conn ?? null, this.config); // the request's OWN connection: a name two OpenRigs share is never the first one's
    if (!resolved.found) {
      this.askerNotes[this.replyKey(n)] = resolved.message;
      cx?.notify?.();
      return;
    }
    delete this.askerNotes[this.replyKey(n)];
    cx.spawn(async (cx) => {
      const res = await this.attachTarget(cx, resolved.seat);
      if (res?.needsViewerRefresh) { this.reviewViewerReplace(res, resolved.seat); }
      else if (res && res.ok === false && res.reason) {
        this.askerNotes[this.replyKey(n)] = res.reason;
      }
      cx.notify();
    });
  }

  persistStatePatch(cx, patch = {}, conn = this.awayConnId()) {
    const primary = this.primaryConnId();
    const targetConn = this.awayConnId(conn);
    const hasAwayPatch = patch.lastSeenNeedsAt !== undefined || patch.lastEndedModeApplicationId !== undefined || patch.lastActiveModeApplicationId !== undefined;
    if (hasAwayPatch && targetConn) {
      writeAwayState({ shared, setShared }, patch, targetConn, primary);
    }
    if (patch.needsView !== undefined) setShared("rig.needsView", patch.needsView);
    const statePath = `${appHome()}/openrig/state.json`;
    // An ownerless task (herdr drops a closed view's tasks): the read-then-write lands even when the tab is closed right after the change. It waits for the write before it by itself,
    // inside the task and with the task's own cx: a second change made while the first still writes must not start its task from this handler's cx, which is gone by then.
    const before = this.statePersist ?? Promise.resolve();
    // spawn returns a TaskHandle, not a Promise. Keep the serialization barrier separate.
    let finish;
    this.statePersist = new Promise(resolve => { finish = resolve; });
    try { return cx.spawn(async (cx) => {
      try {
        await before.catch(() => {});
        const error = await saveStateFile({ path: statePath, read: readTextFile, write: writeTextFile, build: (prev) => {
          const parsed = parseSidebarState(prev ?? "{}");
          const memAway = cleanAwayStates(shared("rig.away.states"), { keepEmpty: true });
          const mergedAway = cleanAwayStates({ ...(parsed.awayStates ?? {}), ...memAway });
          const multiAway = (this.config?.connections ?? []).length > 1
            || Object.keys(mergedAway).some((id) => id !== primary)
            || Boolean(parsed.awayStates);
          return serializeSidebarState(prev ?? "{}", {
            open: shared("rig.open.page") ?? parsed.open ?? {},
            order: shared("rig.order") ?? parsed.order ?? {},
            awayStates: multiAway ? mergedAway : undefined,
            lastSeenNeedsAt: targetConn === primary && patch.lastSeenNeedsAt !== undefined ? patch.lastSeenNeedsAt : (shared("rig.lastSeenNeedsAt") ?? parsed.lastSeenNeedsAt),
            needsView: patch.needsView !== undefined ? patch.needsView : (shared("rig.needsView") ?? parsed.needsView),
            lastEndedModeApplicationId: targetConn === primary && patch.lastEndedModeApplicationId !== undefined ? patch.lastEndedModeApplicationId : (shared("rig.lastEndedModeApplicationId") ?? parsed.lastEndedModeApplicationId),
            lastActiveModeApplicationId: targetConn === primary && patch.lastActiveModeApplicationId !== undefined ? patch.lastActiveModeApplicationId : (shared("rig.lastActiveModeApplicationId") ?? parsed.lastActiveModeApplicationId),
          });
        } });
        this.sayStateSave(error);
        try { cx.notify(); } catch (_) { /* no view left to redraw */ }
      } finally { finish(); }
    }, { owner: null });
    } catch (error) { finish(); throw error; }
  }

  /** A state save that could not be done is said once per distinct message (the same failure on every later save is not said again), and a save that works clears it. */
  sayStateSave(error) {
    if (!error) { this.stateSaveSaid = null; return; }
    const body = stateSaveFailure("the Needs view and what you last saw", error);
    if (this.stateSaveSaid === body) return;
    this.stateSaveSaid = body;
    notify({ title: "OpenRig", level: "warning", body });
  }

  whoseQueueRow(t, cx, perspective, item = null) {
    const whose = whoseQueueSummary(perspective, this.config, item);
    if (!whose) return null;
    const curView = shared("rig.needsView") ?? (whose.basis === "all" ? "all" : whose.basis === "default" ? "default" : (whose.personId ?? "default"));
    const setView = (nextView, cx) => {
      setShared("rig.needsView", nextView);
      this.persistStatePatch(cx, { needsView: nextView });
      const path = nextView ? `/api/attention?view=${encodeURIComponent(nextView)}` : "/api/attention";
      this.read(cx, path, true);
      cx.notify();
    };
    const pill = (id, key, label, disabled = false, tip = null) => {
      const on = curView === key || (!shared("rig.needsView") && key === "default" && whose.basis === "default");
      return h_flex().id(id).px(7).h(20).rounded(5).items_center().cursor_pointer().tooltip(tip)
        .bg(on ? t.accent : t.raised).border_1().border_color(on ? t.accent : t.border)
        .hover((s) => s.bg(on ? t.accent : disabled ? t.raised : t.hover))
        .text_size(11).text_color(disabled ? t.dim : on ? (t.solid_foreground ?? t.background) : t.muted)
        .on_click((_e, cx) => { if (!disabled) setView(key, cx); })
        .child(label);
    };
    return h_flex().id("needs-whose-queue").px(10).h(26).gap(8).items_center().rounded(6).bg(t.background).border_1().border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).tooltip(String((whose.onSomeoneElsesAsk ? `${whose.headline} · ${whose.onSomeoneElsesAsk}` : whose.headline)??"")).child(
        whose.onSomeoneElsesAsk ? `${whose.headline} · ${whose.onSomeoneElsesAsk}` : whose.headline
      ))
      .child(h_flex().gap(4).items_center()
        .child(pill("needs-view-mine", whose.personId ?? "mine", "Mine", !whose.personId, "Show only requests addressed to you"))
        .child(pill("needs-view-default", "default", "Default", false, "Show the requests herdrig thinks you'll care about"))
        .child(pill("needs-view-all", "all", "Everyone", false, "Show every request, whoever it is for")));
  }

  warmPersonAwayData(cx, awayConn = this.awayConnId(), cfg = this.activeConfig()) {
    if (!awayConn || !cfg) return null;
    const rawPerson = typeof cfg?.person === "string" ? cfg.person.trim().replace(/@external$/, "") : null;
    const participants = this.cacheFor(awayConn)["/api/gateway/participants"]?.data?.participants ?? [];
    const firstHuman = participants.find((p) => p?.kind === "human" || String(p?.address ?? "").endsWith("@external"));
    const personId = rawPerson || (firstHuman?.entityId ?? (firstHuman?.address ? String(firstHuman.address).replace(/@external$/, "") : null));
    if (!personId) return null;
    const warmEndedApp = (appId) => {
      if (!appId) return;
      this.read(cx, `/api/gateway/human/${encodeURIComponent(personId)}/mode/applications/${encodeURIComponent(appId)}/account`, false, null, cfg);
      this.read(cx, `/api/gateway/human/${encodeURIComponent(personId)}/mode/applications/${encodeURIComponent(appId)}/decisions`, false, null, cfg);
    };
    const syncModeAppState = (mData) => {
      const activeAppId = mData?.current?.applicationId ?? null;
      if (activeAppId) {
        if (this.awayState("rig.lastActiveModeApplicationId", awayConn) !== activeAppId) {
          this.persistStatePatch(cx, { lastActiveModeApplicationId: activeAppId }, awayConn);
        }
      } else if (mData && "current" in mData && !mData.current) {
        const prevActive = this.awayState("rig.lastActiveModeApplicationId", awayConn);
        if (prevActive) {
          this.setAwayDismissed(false, awayConn);
          this.persistStatePatch(cx, { lastEndedModeApplicationId: prevActive, lastActiveModeApplicationId: null }, awayConn);
        }
      }
    };
    // Follow-up work starts during a draw, never from a read's late callback.
    const modeRes = this.read(cx, `/api/gateway/human/${encodeURIComponent(personId)}/mode`, false, null, cfg);
    if (modeRes?.data) syncModeAppState(modeRes.data);
    const roomRes = this.read(cx, `/api/gateway/human/${encodeURIComponent(personId)}/decision-room`, false, null, cfg);
    const endedAppId = roomRes?.data?.latestEndedApplication?.applicationId
      ?? roomRes?.data?.latestEndedApplication?.id
      ?? (Array.isArray(modeRes?.data?.recentApplications) ? modeRes.data.recentApplications.find((a) => a?.status === "ended")?.applicationId : null)
      ?? (!modeRes?.data?.current ? (this.awayState("rig.lastEndedModeApplicationId", awayConn) ?? null) : null)
      ?? null;
    if (endedAppId) warmEndedApp(endedAppId);
    return { personId, endedAppId };
  }

  sinceYouWereAwayCard(t, cx, items) {
    const awayConn = this.awayConnId();
    const cfg = this.activeConfig();
    if (!awayConn || !cfg || this.isAwayDismissed(awayConn)) return null;
    const lastSeenNeedsAt = this.awayState("rig.lastSeenNeedsAt", awayConn);
    const warmed = this.warmPersonAwayData(cx, awayConn, cfg);
    let endedModeAccount = null;
    let endedModeDecisions = null;
    if (warmed?.personId && warmed?.endedAppId) {
      const acctPath = `/api/gateway/human/${encodeURIComponent(warmed.personId)}/mode/applications/${encodeURIComponent(warmed.endedAppId)}/account`;
      const decPath = `/api/gateway/human/${encodeURIComponent(warmed.personId)}/mode/applications/${encodeURIComponent(warmed.endedAppId)}/decisions`;
      endedModeAccount = this.read(cx, acctPath, false, null, cfg).data ?? null;
      endedModeDecisions = this.read(cx, decPath, false, null, cfg).data ?? null;
    }
    const digest = sinceYouWereAwaySummary(items, {
      lastSeenNeedsAt, timezone:this.uiTimezone,
      endedModeAccount,
      endedModeDecisions,
    });
    if (!digest || !digest.show) return null;
    const markSeen = (_e, cx) => {
      this.setAwayDismissed(true, awayConn);
      this.persistStatePatch(cx, { lastSeenNeedsAt: new Date().toISOString(), lastEndedModeApplicationId: null }, awayConn);
    };
    const tierOrder = [
      ["escalation", "Escalations", t.blocked],
      ["alert", "Alerts", t.blocked],
      ["routine", "Routine", t.accent],
      ["update", "Updates", t.dim],
    ];
    return v_flex().id("needs-since-away-card").rounded(10).bg(t.background).border_1().border_color(t.accent).p(12).gap(8)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(12.5).font_semibold().text_color(t.foreground).child(digest.header))
        .child(this.button(t, "needs-mark-seen", "Mark seen", markSeen, { small: true, tip: "Mark these as seen; the card comes back with new ones" })))
      .children(tierOrder.filter(([k]) => (digest.groups[k] ?? []).length > 0).map(([k, label, color]) =>
        h_flex().id(`needs-away-group-${k}`).gap(8).items_center().text_size(12)
          .child(div().w(95).flex_none().font_semibold().text_color(color).child(`${label} (${digest.groups[k].length})`))
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).tooltip(digest.groups[k].map((x) => rowTitle(x.summary)).join(" · ")).child(digest.groups[k].map((x) => rowTitle(x.summary)).join(" · ")))
      ))
      .when(digest.decisions.length > 0, (el) => el.child(v_flex().id("needs-coming-back-account").gap(6).pt(6).border_t(1).border_color(t.border)
        .child(div().text_size(12).font_semibold().text_color(t.foreground).child(digest.modeHeading ?? "Decided for you while away"))
        .children(digest.decisions.map((d, i) =>
          v_flex().id(`needs-away-decision-${i}`).rounded(6).bg(t.raised).p(8).gap(3).cursor_pointer().tooltip("Open this decision's request in Needs")
            .on_click(() => { if (d.qitemId) this.push({ section: "needs", id: `queue:${d.qitemId}`, name: rowTitle(d.summary), ...((this.config?.connections?.length ?? 0) > 1 ? { conn: awayConn } : {}) }); })
            .child(h_flex().gap(8).items_center()
              .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().text_color(t.foreground).tooltip(rowTip(d.summary) || d.qitemId || "").child(rowTitle(d.summary)))
              .child(div().px(6).h(18).rounded(4).flex().items_center().bg(t.background).text_size(10.5).text_color(d.reversible ? t.muted : t.blocked).child(d.reversibilityLabel))
              .child(div().text_size(11).text_color(t.dim).child(`by ${d.decidedBy}`)))
            .when(!!d.choices, (c) => c.child(div().text_size(11.5).text_color(t.foreground).child(`Chose: ${d.choices}`)))
            .when(!!d.reason, (c) => c.child(div().text_size(11.5).text_color(t.muted).child(d.reason)))
        ))));
  }

  needs(t, cx, entry) {
    const viewParam = entry.view ?? shared("rig.needsView") ?? null;
    const itemPath = entry.id ? `/api/attention?item=${encodeURIComponent(entry.id)}${viewParam ? `&view=${encodeURIComponent(viewParam)}` : ""}` : null;
    // Terminal links set an explicit Everyone view. Use their exact read before
    // drawing the card because the sidebar's published list may predate the link.
    const linkedRequest = entry.view === "" && String(entry.id).startsWith("queue:");
    const attPath = linkedRequest ? itemPath : viewParam ? `/api/attention?view=${encodeURIComponent(viewParam)}` : "/api/attention";
    let att = this.read(cx, attPath);
    if (viewParam && att.status === 404) {
      att = this.read(cx, "/api/attention");
    }
    const agg = this.read(cx, "/api/queue/attention-aggregate");
    if (this.config && !this.cache["/api/gateway/participants"]) {
      this.read(cx, "/api/gateway/participants");
    }
    this.currentTopology(cx);
    if (!entry.id) this.warmPersonAwayData(cx);
    if (entry.id) {
      if (!linkedRequest) this.read(cx, itemPath);
      if (String(entry.id).startsWith("queue:")) {
        this.read(cx, `/api/queue/${encodeURIComponent(String(entry.id).slice(6))}`);
      }
    }
    const wait = this.status(t, cx, attPath, linkedRequest && att.error ? { ...att, data: undefined } : att);
    if (wait) return wait;
    // Every item as a target, made again only when the items, their aggregate or a cached queue row they merge from is read again (the
    // queue rows cached are the requests opened, a few): not every update on every render.
    const queueRows = Object.keys(this.cache).filter((k) => k.startsWith("/api/queue/")).sort().map((k) => this.cache[k]?.data);
    const targetsHit = this.needsTargetsMemo;
    const sameRead = targetsHit && targetsHit.items === att.data?.items && targetsHit.agg === agg.data && targetsHit.queueRows.length === queueRows.length
      && targetsHit.queueRows.every((row, i) => row === queueRows[i]);
    const allItems = sameRead ? targetsHit.allItems : enrichAttentionItems(att.data?.items ?? [], agg.data).map((raw) => {
      const qid = raw?.answer?.qitemId ?? (String(raw?.id ?? "").startsWith("queue:") ? String(raw.id).slice(6) : null);
      const cachedQueue = qid ? this.cache[`/api/queue/${encodeURIComponent(qid)}`]?.data : null;
      const merged = cachedQueue && typeof cachedQueue === "object" && !cachedQueue.error
        ? {
            ...raw,
            tags: raw.tags ?? cachedQueue.tags,
            ownerNotificationLevel: raw.ownerNotificationLevel ?? cachedQueue.ownerNotificationLevel,
            priority: raw.priority ?? cachedQueue.priority,
            decisionRevision: cachedQueue.decisionRevision ?? raw.decisionRevision,
            humanQuestions: cachedQueue.humanQuestions ?? raw.humanQuestions,
            humanAnswers: cachedQueue.humanAnswers ?? raw.humanAnswers,
          }
        : raw;
      return needTarget(merged);
    });
    if (!sameRead) this.needsTargetsMemo = { items: att.data?.items, agg: agg.data, queueRows, allItems, visible: null };
    const dismissals = this.updateModel(), recordsKey = dismissals.records.map((r) => `${r.restored ? 1 : 0}${r.key}`).join("\n");
    const kept = this.needsTargetsMemo;
    if (kept.visible?.recordsKey !== recordsKey) kept.visible = { recordsKey, items: dismissals.visible(allItems) };
    const items = kept.visible.items;
    this.visibleUpdates = []; // the Updates rows drawn on the shown page (needRows sets them): Delete acts only on one of those
    this.drawnNeedKeys = new Set(); // likewise the requests drawn, by their key (their OpenRig and id; requestRows sets them)
    const whoseRow = this.whoseQueueRow(t, cx, att.data?.perspective, entry.id ? items.find((x) => x.id === entry.id) : null);
    if (entry.id) {
      // One item (sidebar or toast click): the full Decision Card, here; no menu or dialog between.
      const n = items.find((x) => x.id === entry.id);
      if (!n) {
        if (isHealthAttention({ id: entry.id })) return div().id("need-health-fallback").tooltip("Open System › Health")
          .on_click(() => this.push({ section: "system", subview: "health" }))
          .child(this.dim(t, "Health findings are in System → Health."));
        const receipt = dismissals.receiptRows().find((r) => r.keys.some((key) => dismissals.records.find((v) => v.key === key)?.item.id === entry.id));
        if (receipt) return this.updateReceipt(t, receipt);
        const hidden = dismissals.hidden().find((r) => r.item.id === entry.id);
        if (hidden) return v_flex().gap(8).child(this.dim(t, hidden.note ?? "Dismissed here."))
          .child(this.button(t, "restore-open-update", "Restore", () => this.updateAction("restore", hidden.key), { small: true, tip: "Bring this update back to the Updates list" }));
        const entryConn = entry.conn ?? ((this.config?.connections?.length ?? 0) > 1 ? this.awayConnId() : null);
        const entryKey = this.replyKey(entryConn ? { ...entry, conn: entryConn } : entry); // the page's request: its id on its own OpenRig
        const refused = this.refused?.[entryKey];
        if (refused) {
          const qid = refused.qitemId ?? (String(entry.id).startsWith("queue:") ? String(entry.id).slice(6) : null);
          const qRes = qid ? this.read(cx, `/api/queue/${encodeURIComponent(qid)}`) : null;
          const qRow = !qRes?.error && qRes?.data && typeof qRes.data === "object" && !qRes.data.error ? qRes.data : null;
          const qBody = typeof qRow?.body === "string" && qRow.body.trim() ? qRow.body.trim() : null;
          const qResText = typeof qRow?.resolution === "string" && qRow.resolution.trim() ? qRow.resolution.trim() : null;
          return v_flex().gap(10).min_w(0)
            .child(this.title(t, rowTitle(qRow?.summary || refused.summary)))
            .child(h_flex().id(`need-result-${entry.id}`).gap(6).items_start().min_w(0)
              .child(svg(icon("rig-alert")).size(12).flex_none().text_color(t.blocked))
              .child(div().flex_1().min_w(0).text_size(12).text_color(t.blocked).child(this.errorText(t, `need-result-error-${entry.id}`, refused.text))))
            .when(Boolean(qRow), (el) => el.child(v_flex().id(`need-refused-current-${entry.id}`).gap(8).p(12).rounded(8).border_1().border_color(t.border).bg(t.raised)
              .child(this.kv(t, [
                ["State", statusWord(qRow.state ?? "not reported", "queue")],
                ...(qRow.sourceSession ? [["From", qRow.sourceSession]] : []),
                ...(qRow.destinationSession ? [["To", qRow.destinationSession]] : []),
                ...(qResText ? [["Resolution", qResText]] : []),
              ]))
              .when(Boolean(qBody), (c) => c.child(requestMarkdownView(qBody, { TextView, div, v_flex, id: `need-refused-body-${entry.id}` }).text_size(12.5).text_color(t.foreground)))))
            .when(!qRow && Boolean(qRes?.loading), (el) => el.child(this.dim(t, "Reading current request…")))
            .when(!qRow && !qRes?.loading, (el) => el.child(this.dim(t, "It has left Needs.")));
        }
        const answered = this.answered[entryKey];
        if (answered?.text) return v_flex().gap(10).child(this.title(t, rowTitle(answered.summary)))
          .child(h_flex().id(`need-result-${entry.id}`).gap(6).items_start().min_w(0)
            .child(svg(icon("check")).size(12).flex_none().text_color(t.working)).child(this.dim(t, answered.text).flex_1().min_w(0)));
        return this.dim(t, linkedRequest ? "OpenRig did not report that request in Needs." : "This request was already answered.");
      }
      if (n.criticalHealth) return this.healthNeedsLine(t, n);
      const check = sweepFinding(n);
      const name = check ? checkLabel(check, allItems) : rowTitle(n.summary, n.body);
      this.pageCrumbEntry = { ...entry, name };
      return v_flex().gap(12)
        .when(!!whoseRow, (el) => el.child(whoseRow))
        .child(this.decisionCard(t, cx, n, { standalone: true, perspective: att.data?.perspective, ...(linkedRequest ? { viewParam } : {}) }))
        ;
    }
    // Replies sent from here whose item has left the list: said for a moment, then gone.
    // Each is said on its own OpenRig's page only, and only while no listed item is that request (both by the request's key).
    const pageConn = adoptConnection(this.config, this.activeConnId()) ?? null;
    const gone = Object.entries(this.answered).filter(([key, a]) => Date.now() - a.at < STATUS_MS && (a.conn ?? pageConn) === pageConn
      && !items.some((n) => this.replyKey(n) === key));
    if (gone.length) this.ticking = true;
    const refusedStubs = Object.entries(this.refused ?? {}).filter(([key, r]) =>
      (r.conn ?? pageConn) === pageConn && r.listEpoch === (this.needsPageEpoch ?? 0)
      && !items.some((n) => this.replyKey(n) === key));
    // The daemon names each source it read; one that is down makes an empty list unknown, not empty.
    const coverage = attentionCoverage(att.data.sources ?? []);
    const awayCard = this.sinceYouWereAwayCard(t, cx, items);
    const actionableItems = sortNeedsByTier(items.filter(isOpenNeed));
    const updateItems = items.filter((n) => n.update);
    const promptOnly = !actionableItems.length && needsRequestCount(this.pageRigData()?.topology ?? this.currentTopology(cx)) > 0;
    this.pageNeedsCounts={requests:needsRequestCount(null,actionableItems),checks:needsCheckCount(actionableItems),updates:updateItems.length};
    const requestsView=(entry.needsTab??"requests")==="requests";
    if(requestsView){this.selectedUpdate=null;this.visibleUpdates=[];}
    const updateDisplay = [...updateItems];
    const receipts = dismissals.receiptRows();
    for (const receipt of receipts.filter((r) => r.keys.length === 1)) updateDisplay.splice(Math.min(receipt.position, updateDisplay.length), 0, { receipt });
    this.needUnfilteredPositions = Object.create(null);
    actionableItems.forEach((n, idx) => { this.needUnfilteredPositions[this.replyKey(n)] = idx; });
    return v_flex().gap(12)
      .when(!!whoseRow, (el) => el.child(whoseRow))
      .when(!!awayCard&&requestsView, (el) => el.child(awayCard))
      .when(!!entry.notice, (el) => el.child(div().id("need-expired-notice").text_size(12).text_color(t.muted).child(entry.notice)))
      .when(requestsView,el=>el.child(this.card(t, "Requests", [...gone.map(([id, a]) => h_flex().id(`need-answered-${id}`).px(8).gap(8).items_center()
        .child(svg(icon("check")).size(12).flex_none().text_color(t.working)).child(div().flex_1().truncate().text_size(12).text_color(t.muted).tooltip(String(a.text ?? a.summary??"")).child(a.text ?? a.summary))),
        this.needRows(t, cx, "needs", actionableItems, att.data?.perspective, refusedStubs),
        ...(promptOnly ? [this.dim(t, "Answer seat prompts in their terminal from Topology.")] : [])])))
      .when(!requestsView,el=>{
        const dismissedRows = dismissals.show && dismissals.hidden().length ? [
          this.dim(t, "Dismissed"),
          this.needRows(t, cx, "dismissed", dismissals.hidden().map((r) => ({ ...(r.item.conn || !pageConn ? r.item : { ...r.item, conn: pageConn }), dismissed: true, dismissalNote: r.note })), att.data?.perspective),
        ] : [];
        const activeRows = [
          ...(entry.showDismissed && dismissedRows.length && updateDisplay.length ? [this.dim(t, "Active updates")] : []),
          this.needRows(t, cx, "updates", updateDisplay, att.data?.perspective),
        ];
        return el.child(this.card(t, `Updates (${updateItems.length})`, [
          ...receipts.filter((r) => r.keys.length > 1).map((r) => this.updateReceipt(t, r)),
          ...(entry.showDismissed ? [...dismissedRows, ...activeRows] : [...activeRows, ...dismissedRows]),
          ...(shared("rig.dismissSaveError") ? [this.dim(t, shared("rig.dismissSaveError"))] : []),
        ], h_flex().gap(8).items_center()
          .when(updateItems.length > 0, (el) => el.child(this.updateButton(t, "dismiss-all-updates", updateItems.length === 1 ? "Dismiss" : `Dismiss all ${updateItems.length}`, () => this.updateAction("dismiss", updateItems)).tooltip(`Dismiss ${updateItems.length === 1 ? "the update" : `all ${updateItems.length} updates`}; you can bring them back from Show dismissed`)))
          .when(dismissals.hidden().length > 0, (el) => el.child(div().id("show-dismissed-updates").text_size(12).text_color(t.accent).cursor_pointer()
            .tooltip(`${dismissals.show ? "Hide" : "Show"} the ${dismissals.hidden().length} updates you dismissed`).on_click(() => this.updateAction("show")).child(`${dismissals.show ? "Hide" : "Show"} dismissed (${dismissals.hidden().length})`)))));
      })
      .children(coverage.errors.map((s, i) => div().id(`need-source-${i}`).text_size(11.5).text_color(t.blocked).child(s.detail ? this.errorText(t,`need-source-error-${i}`,s.detail,{prefix:`${s.source}: ${statusWord(s.state,"health")} · `}) : `${s.source}: ${statusWord(s.state,"health")}`)))
      .when(coverage.incomplete, (el) => el.child(v_flex().gap(4)
        .child(h_flex().id("need-coverage-toggle").gap(6).items_center().text_size(11.5).text_color(t.dim).cursor_pointer()
          .tooltip("Show or hide which sources couldn't be read").on_click(() => setOpen("needs:coverage", !(shared("rig.open.page") ?? {})["needs:coverage"]))
          .child(svg(icon((shared("rig.open.page") ?? {})["needs:coverage"] ? "chevron-down" : "chevron-right")).size(11).flex_none())
          .child("Coverage · results may be incomplete"))
        .when(Boolean((shared("rig.open.page") ?? {})["needs:coverage"]), (fold) => fold.children(coverage.partial.map((s, i) =>
          this.plain(t, `${s.source}: ${s.state}${s.detail ? ` · ${s.detail}` : ""}`, `need-coverage-${i}`).text_color(t.dim))))))
      .child(div().id("needs-read-time").tooltip(this.time(att.data.readAt,{exact:true}))
        .child(this.dim(t, `Read ${relativeTimeText(att.data.readAt)}. Viewing is not approval.`)));
  }

  pagerFocusHandle(id, cx) {
    if (liveFocus(this.pagerHandles?.[id])) return this.pagerHandles[id];
    if (this.pagerHandles?.[id]) delete this.pagerHandles[id]; // released elsewhere: made again below
    this.pagerHandles ??= Object.create(null);
    this.pendingPagerHandles ??= new Set();
    if (!this.pendingPagerHandles.has(id) && cx?.timer?.after && cx?.focus_handle) {
      this.pendingPagerHandles.add(id);
      cx.timer.after(0, (next) => {
        this.pendingPagerHandles.delete(id);
        if (this.closed) return;
        this.pagerHandles[id] = next.focus_handle();
        next.notify?.();
      });
    }
    return this.pagerHandles[id] ?? null;
  }

  /** One page of a Needs list: its rows, their offset in the whole list, and the pager line (null when everything fits on one page). The page is
   *  kept per OpenRig and list, and a list that shrank shows its last page. */
  needsListPage(t, cx, listKey, list) {
    const pages = Math.max(1, Math.ceil(list.length / NEEDS_PAGE_ROWS)), key = `${this.activeConnId() ?? ""}:${listKey}`;
    const pageNo = Math.min(Math.max(0, (this.needsPages ??= {})[key] ?? 0), pages - 1), offset = pageNo * NEEDS_PAGE_ROWS;
    const rows = list.slice(offset, offset + NEEDS_PAGE_ROWS);
    if (pages === 1) return { rows, offset, pager: null };
    const prevId = `${listKey}-page-previous`, nextId = `${listKey}-page-next`;
    const prevHandle = this.pagerFocusHandle(prevId, cx), nextHandle = this.pagerFocusHandle(nextId, cx);
    // A page change drops the selection: a key (Delete, Up/Down, Enter) must never act on a row that is no longer on screen.
    const activate = (to, isPrev, ctx) => {
      ctx?.stop_propagation?.();
      this.needsPages[key] = to;
      this.selectedUpdate = null;
      this.selectedNeed = undefined;
      this.selectedNeedId = undefined;
      const ownHandle = isPrev ? prevHandle : nextHandle;
      const otherHandle = isPrev ? nextHandle : prevHandle;
      const stillEnabled = isPrev ? to - 1 >= 0 : to + 1 < pages;
      const otherEnabled = isPrev ? to + 1 < pages : to - 1 >= 0;
      if (ownHandle?.is_focused?.() && !stillEnabled) {
        if (otherEnabled && otherHandle) otherHandle.focus?.();
        else this.handle?.focus?.();
      }
      ctx?.notify?.();
    };
    const link = (id, label, to, isPrev) => {
      if (to < 0 || to >= pages) {
        return div().px(6).py(2).rounded(6).border(2).border_color("#00000000").text_size(12).text_color(t.dim).child(label);
      }
      const handle = isPrev ? prevHandle : nextHandle;
      const focused = Boolean(handle?.is_focused?.());
      const paired=activationPair(this,id);
      return div().id(id).px(6).py(2).rounded(6).border(2).border_color(focused ? t.accent : "#00000000")
        .role("button").tooltip(isPrev ? "Previous page" : "Next page")
        .when(!!handle, (el) => el.track_focus(handle))
        .tab_stop(true).tab_index(0)
        .focus((el) => el.border_color(t.accent))
        .hover((el) => el.bg(t.hover))
        .text_size(12).text_color(t.accent).cursor_pointer()
        .on_mouse_down("left", paired.pointer((_e, ctx) => { ctx?.stop_propagation?.(); liveFocus(handle)?.focus?.(); }))
        .on_click(paired.click((_e, ctx) => activate(to, isPrev, ctx)))
        .on_key_down(paired.key((e, ctx) => {
          if (e.modifiers?.alt || e.modifiers?.control || e.modifiers?.platform) return;
          const k = String(e.key ?? "").toLowerCase();
          if (k === "enter" || k === "space" || e.key === " ") {
            ctx?.stop_propagation?.();
            if (!e.is_held) activate(to, isPrev, ctx);
          } else if (k === "left" || k === "right") {
            ctx?.stop_propagation?.();
            if (k === "left" && !isPrev && pageNo - 1 >= 0) { prevHandle?.focus?.(); ctx?.notify?.(); }
            else if (k === "right" && isPrev && pageNo + 1 < pages) { nextHandle?.focus?.(); ctx?.notify?.(); }
          }
        }))
        .child(label);
    };
    const pager = h_flex().id(`${listKey}-pager`).px(8).h(28).gap(6).items_center()
      .child(div().flex_1().text_size(12).text_color(t.muted).child(`${offset + 1}–${offset + rows.length} of ${list.length}`))
      .child(link(prevId, "Previous", pageNo - 1, true)).child(link(nextId, "Next", pageNo + 1, false));
    return { rows, offset, pager };
  }

  /** Needs-You rows: a click opens the Decision Card in place (`shared("rig.open.page")`, `needs:<id>`, so the palette and the
   *  sidebar agree); right-click is the menu. A palette filter narrows them, as it does a table. */
  needRows(t, cx, idPrefix, list, perspective = null, refusedStubs = []) {
    if (idPrefix === "needs") return this.requestRows(t, cx, list, perspective, refusedStubs);
    const f = this.filter?.toLowerCase();
    if (f) list = list.filter((n) => [n.summary, n.urgency, n.asker, n.scope, n.tier].some((c) => String(c ?? "").toLowerCase().includes(f)));
    const open = shared("rig.open.page") ?? {};
    const focusNeed = shared("rig.focusNeed");
    const { rows, offset, pager } = this.needsListPage(t, cx, idPrefix, list);
    if (idPrefix === "updates") this.visibleUpdates = rows.filter((n) => !n.receipt && dismissible(n));
    const toggle = (n) => {
      this.selectedUpdate = dismissible(n) ? n : null;
      const now = shared("rig.open.page") ?? {}, next = !now[`needs:${n.id}`];
      if (next && n.reply !== "none") this.replies[this.replyKey(n)] ??= this.makeReply(n);
      if (!next && shared("rig.focusNeed") === n.id) setShared("rig.focusNeed", null);
      setShared("rig.open.page", { ...now, [`needs:${n.id}`]: next });
    };
    const width = this.pageWidth ?? 960;
    const showAnswer = width >= 620;
    const showInlineCopy = width >= 420;
    const showSince = width >= 380;
    const sinceWidth = showAnswer ? 150 : 84;
    const rowGap = showAnswer ? 10 : 8;
    return v_flex()
      .child(h_flex().px(8).h(24).gap(rowGap).items_center().border_b(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(div().w(12)).child(div().flex_1().min_w(0).child("What"))
        .when(showAnswer, (el) => el.child(div().w(140).flex_none().child("Answer")))
        .when(showSince, (el) => el.child(div().w(sinceWidth).flex_none().child("Since"))))
      .children(list.length ? rows.map((n, at) => {
        const i = offset + at;
        if (n.receipt) return this.updateReceipt(t, n.receipt);
        if (dismissible(n)) n = { ...n, dismissalPosition: i };
        const shown = !!open[`needs:${n.id}`];
        const focused = focusNeed === n.id;
        const tier = n.tier ?? tierOf(n);
        const isEscalation = tier === "escalation";
        const isAlert = tier === "alert";
        const dismissedTone = this.selectedUpdate?.id === n.id ? t.muted : t.dim;
        const rowTheme = n.dismissed ? { ...t, muted: dismissedTone, dim: dismissedTone } : t;
        const actionLabel = n.native
          ? "Relaunch / Resume…"
          : n.verb === "approve"
            ? "Respond" // the list has no queue row: opening the card decides between a request and a decision
            : n.reply === "resolve"
              ? "Resolve"
              : n.reply === "answer"
                ? "Answer"
                : isUpdateNeed(n) ? "no action needed" : "Needs you";
        return v_flex().when(focused, (el) => el.border_1().border_color(t.accent).rounded(6))
          .child(h_flex().id(`${idPrefix}-${i}`).px(8).h(30).overflow_hidden().gap(rowGap).items_center().rounded(6).hover((s) => s.bg(t.hover))
            .when(dismissible(n) && this.selectedUpdate?.id === n.id, (el) => el.bg(t.selection ?? t.raised))
            .when(isEscalation, (el) => el.border_l(2).border_color(t.blocked))
            .tooltip(`${shown ? "Close" : "Open"} this update; right-click for its actions`).on_click(() => toggle(n)).on_mouse_down("right", () => this.menu(n))
            .child(svg(icon(shown ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(rowTheme.dim))
            .when(isEscalation, (el) => el.child(div().px(5).h(16).rounded(4).flex().items_center().bg(t.blocked + "26").text_color(t.blocked).text_size(10).font_semibold().child("ESCALATION")))
            .when(!isEscalation && tier !== "update", (el) => el.child(this.plainDot(t, isAlert ? "blocked" : "accent")))
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(n.dismissed ? dismissedTone : tier === "update" ? t.muted : t.foreground).when(isEscalation || isAlert, (d) => d.font_semibold()).tooltip(rowTip(n.summary)).child(rowTitle(n.summary)))
            .when(showAnswer, (el) => el.child(div().w(140).flex_none().truncate().text_size(12.5).text_color(rowTheme.muted).tooltip(String(actionLabel??"")).child(actionLabel)))
            .when(showInlineCopy, (el) => el.child(this.copyButton(rowTheme, n.qitemId ?? n.id, `need-id-${n.id}`, "request id")))
            .when(dismissible(n) && this.selectedUpdate?.id === n.id, (el) => el.child(this.updateButton(t, `dismiss-${idPrefix}-${i}`, n.dismissed ? "Restore" : "Dismiss", (_e, cx) => {
              cx.stop_propagation(); this.updateAction(n.dismissed ? "restore" : "dismiss", n.dismissed ? updateKey(n) : n);
            }).tooltip(n.dismissed ? "Bring this update back" : "Dismiss this update")))
            .child(this.updateButton(rowTheme, `need-menu-${idPrefix}-${i}`, "⋯", (_e, cx) => { cx.stop_propagation(); this.menu(n); }).tooltip("More actions for this update"))
            .when(showSince, (el) => el.child(div().w(sinceWidth).flex_none().truncate().text_size(12.5).text_color(rowTheme.muted).tooltip(this.time(n.at,{exact:true})).child(relativeTimeText(n.at)))))
          .when(shown, (el) => el.child(v_flex().ml(22).pl(10).py(6).border_l(1).border_color(focused ? t.accent : t.border).child(n.dismissed ? this.dim(t, n.dismissalNote ?? "Hidden here only.") : this.needBody(t, cx, n, perspective))));
      }) : [div().p(10).text_size(12).text_color(t.dim).child(f ? `No matches for /${this.filter}.` : idPrefix === "updates" ? "No recent updates." : "No pending Needs-You requests.")])
      .when(!!pager, (el) => el.child(pager));
  }

  /** A request opened in place or on its own item page: renders the full Decision Card. */
  requestRows(t, cx, items, perspective, refusedStubs = []) {
    const filter = this.filter?.toLowerCase() ?? "";
    const matchesFilter = (summary, asker) => [summary, asker].some(s => String(s ?? "").toLowerCase().includes(filter));
    if (filter) items = items.filter(n => matchesFilter(n.summary, n.asker));
    const visibleStubs = filter
      ? refusedStubs.filter(([, r]) => matchesFilter(r.summary, r.asker))
      : refusedStubs;
    const display = [...items];
    const stubPos = (r) => (filter && r.filter === filter ? r.position : r.unfilteredPosition) ?? display.length;
    for (const [key, r] of [...visibleStubs].sort((a, b) => stubPos(a[1]) - stubPos(b[1]))) {
      display.splice(Math.min(stubPos(r), display.length), 0, { refusedStub: { key, ...r } });
    }
    const toggle = (n) => { if (n.refusedStub) return; if (n.criticalHealth) { this.push({ section: "system", subview: "health", ...(n.conn ? { conn: n.conn } : {}) }); return; } this.selectedNeed = this.replyKey(n); this.selectedNeedId = n.id; if (n.reply !== "none") this.replies[this.replyKey(n)] ??= this.makeReply(n); setOpen(`needs:${n.id}`, !(shared("rig.open.page") ?? {})[`needs:${n.id}`]); };
    const open = shared("rig.open.page") ?? {};
    const { rows, offset, pager } = this.needsListPage(t, cx, "needs", display);
    const liveRows = rows.filter((n) => !n.refusedStub);
    this.drawnNeedKeys = new Set(liveRows.map((n) => this.replyKey(n))); // the requests on screen: a card key acts only on one of them (routeNeedKey)
    this.needPositions ??= Object.create(null);
    return v_flex().id("need-request-list").on_key_down((e, cx) => {
      if (!["up", "down", "enter"].includes(e.key)) return;
      cx.stop_propagation();
      // Up, Down and Enter move over the shown page's rows only; Previous / Next change the page.
      let i = liveRows.findIndex(n => this.replyKey(n) === this.selectedNeed);
      if (e.key === "enter") { if (i >= 0) toggle(liveRows[i]); }
      else if (liveRows.length) { i = Math.max(0, Math.min(liveRows.length - 1, i + (e.key === "down" ? 1 : -1))); this.selectedNeed = liveRows[i] ? this.replyKey(liveRows[i]) : undefined; this.selectedNeedId = liveRows[i]?.id; }
      cx.notify();
    }).children(display.length ? rows.map((n, at) => {
      const i = offset + at;
      if (n.refusedStub) {
        const r = n.refusedStub;
        return v_flex().id(`need-refused-stub-${r.id}`).gap(6).p(10).rounded(8).border_1().border_color(t.border).bg(t.raised).opacity(0.85)
          .child(div().text_size(12.5).text_color(t.muted).truncate().child(r.summary || r.id))
          .child(h_flex().gap(6).items_start().min_w(0)
            .child(svg(icon("rig-alert")).size(12).flex_none().text_color(t.blocked))
            .child(div().flex_1().min_w(0).text_size(12).text_color(t.blocked).child(this.errorText(t, `need-refused-error-${r.id}`, r.text))))
          .child(h_flex().child(this.button(t, `need-refused-ok-${r.id}`, "OK", (_e, cx) => {
            delete this.refused?.[r.key];
            cx.notify();
          }, { small: true, tip: "Dismiss this notice" })));
      }
      this.needPositions[this.replyKey(n)] = i;
      if (n.criticalHealth) return this.healthNeedsLine(t, n);
      // A blank summary needs the same body the expanded card uses; fetch it only for these rows.
      const queue = n.summaryIsFallback && !n.body && n.qitemId ? this.read(cx, `/api/queue/${encodeURIComponent(n.qitemId)}`).data : null;
      const headline = needsRowHeadline(n, queue?.body);
      const tier = tierOf(n), urgent = ["alert", "escalation"].includes(tier);
      const assistant=assistantForNeed(n,this.hostedMembers(cx));
      const owner = n.reply === "resolve" || n.answer?.verb === "resolve" ? parkedWorkOwner(n) : assistant?assistantOwner(assistant):n.asker ?? n.sourceSession;
      const age = Date.parse(n.at ?? ""), mins = Number.isFinite(age) ? Math.max(0, Math.floor((Date.now() - age) / 60000)) : null;
      const shown = Boolean(open[`needs:${n.id}`]);
      // OpenRig's check on another row: labelled by that row, with "check" where a request shows who asked (its sender asked nothing).
      const check = sweepFinding(n), rowLabel = check ? checkLabel(check, items) : headline;
      return v_flex().min_w(0).child(h_flex().id(`needs-${i}`).px(8).h(34).overflow_hidden().gap(8).items_center().rounded(6).cursor_pointer().hover(s => s.bg(t.hover))
        .when(this.selectedNeed === this.replyKey(n), el => el.bg(t.selection ?? t.raised))
        .tooltip(`${shown ? "Close" : "Open"} this ${check?'check':'request'}; right-click for its actions`).on_click(() => toggle(n)).on_mouse_down("right", () => this.menu(n))
        .child(div().w(12).text_size(12).text_color(urgent ? t.blocked : t.accent).child(urgent ? "◆" : "●"))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).tooltip(check ? rowLabel : rowText(n.summary) || headline).child(rowLabel))
        .child(check ? div().id(`need-check-chip-${i}`).max_w(180).text_size(11.5).text_color(t.muted).tooltip("OpenRig's check on another row, not a new request").child("check")
          : div().max_w(180).truncate().text_size(11.5).text_color(t.muted).tooltip(String(String(owner ?? "")??"")).child(String(owner ?? "")))
        .child(div().text_size(11).text_color(t.dim).tooltip(this.time(n.at,{exact:true})).child(mins === null ? "" : mins < 1 ? "<1m" : `${mins}m`))
        .child(this.updateButton(t, `need-menu-needs-${i}`, "⋯", (_e, cx) => { cx.stop_propagation(); this.menu(n); }).tooltip(check?"More actions for this check":"More actions for this request")))
        .when(shown, el => el.child(this.decisionCard(t, cx, n, { perspective })));
    }) : [this.dim(t, filter ? "No matching requests." : "No pending Needs-You requests.")])
      .when(!!pager, (el) => el.child(pager));
  }

  needBody(t, cx, n, perspective = null) {
    return this.decisionCard(t, cx, n, { standalone: false, perspective });
  }

  healthNeedsLine(t, n) {
    const started = Date.parse(n.healthFinding?.startedAt ?? "");
    const minutes = Number.isFinite(started) ? Math.max(0, Math.floor((Date.now() - started) / 60000)) : null;
    return h_flex().id(`critical-health-${n.id}`).px(8).h(34).gap(8).items_center().text_size(12.5).cursor_pointer().hover(el => el.bg(t.hover))
      .tooltip("Open this critical finding in System › Health").on_click(() => this.push({ section: "system", subview: "health", ...(n.conn ? { conn: n.conn } : {}) })) // the finding's own OpenRig (the Needs page lists every box)
      .child(div().w(12).text_color(t.blocked).child("◆"))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).tooltip(rowTip(n.summary)).child(rowTitle(n.summary)))
      .child(div().max_w(180).truncate().text_size(11.5).text_color(t.muted).tooltip("health · critical").child("health · critical"))
      .child(div().text_size(11.5).text_color(t.dim).tooltip(this.time(n.healthFinding?.startedAt,{exact:true})).child(minutes === null ? "—" : minutes < 1 ? "<1m" : `${minutes}m`))
      .child(div().text_size(11.5).text_color(t.accent).child("System → Health"));
  }

  checkedRequest(check, rows, conn) {
    return rows.find(row => (!conn || row.conn === conn) && (row.qitemId === check.about || row.id === `queue:${check.about}`));
  }

  openCheckedQueueRow(check, rows, conn) {
    if (!validHealthQitemId(check.about)) {
      notify({ title: "Can't open the checked row", body: "This check points to an invalid queue item ID.", level: "warning" });
      return;
    }
    const scope = conn ? { conn } : {};
    if (this.checkedRequest(check, rows, conn)) {
      this.push({ section: "needs", id: `queue:${check.about}`, name: checkLabel(check, rows).replace(/^Check on: /, ""), ...scope });
    } else {
      this.push({ section: "system", subview: "health", healthQitem: check.about, ...scope });
    }
  }

  prepareNeedFocus(cx, box, keys) {
    if (!box || box.focusPreparing || !cx?.timer?.after) return;
    const missing = keys.filter(key => !liveFocus(box.cardHandles?.[key]));
    if (!missing.length) return;
    box.focusPreparing = true;
    // Set from the draw, so the timer and the handles it makes are this page's own (never after an await: see liveFocus in rig-lib).
    cx.timer.after(0, (next) => {
      box.focusPreparing = false;
      if (!next?.focus_handle) return;
      box.cardHandles ??= Object.create(null);
      for (const key of missing) if (!liveFocus(box.cardHandles[key])) box.cardHandles[key] = next.focus_handle();
      next.notify?.();
    });
  }

  routeNeedKey(e, cx, entry) {
    if (e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt || !["r", "d", "escape"].includes(String(e.key).toLowerCase())) return false;
    // The selection is kept as the request's key (its OpenRig and id); the open fold is kept by id.
    const id = entry.id ?? (this.selectedNeed ? this.selectedNeedId : null) ?? shared("rig.focusNeed");
    if (!id || (!entry.id && !(shared("rig.open.page") ?? {})[`needs:${id}`])) return false;
    // The card's box is the request's on its own OpenRig: the page's request, else the row selected in the list (with its connection).
    const entryConn = entry.id ? (entry.conn ?? ((this.config?.connections?.length ?? 0) > 1 ? this.awayConnId() : null)) : null;
    const boxKey = entry.id ? this.replyKey(entryConn ? { ...entry, conn: entryConn } : entry) : this.selectedNeed && id === this.selectedNeedId ? this.selectedNeed : this.replyKey({ id });
    if (!entry.id && !this.drawnNeedKeys?.has(boxKey)) return false; // an open card on another page, or another tab, isn't on screen: its keys don't reach it
    const key = this.replies[boxKey]?.cardKey;
    if (!key) return false;
    key(e, cx); return true;
  }

  /** Requests use a short opening and an explicit action; the complete source stays in safe folded Details. */
  requestCard(t, cx, { n, queueRow, detailItem, detailLines, recordedLines, evidenceFiles, qState, box, standalone, asker, perspective }) {
    if (box) box.cardMode = true;
    const id = n.id, width = this.needCardWidths?.[id] ?? 800, narrow = width < 480;
    // The measured width is physical; text scales with the person's zoom (settings().zoom), so rows hold width/zoom of it.
    const zoom = Number(settings()?.zoom) > 0 ? Number(settings().zoom) : 1;
    const text = requestCardText(n, detailLines.join("\n\n"), { perRow: openingRowChars(width / zoom) });
    // Two headline rows at the card's logical width (the measured width is physical; text scales with zoom).
    const logicalWidth = width / zoom, headlineLimit = Math.max(20, Math.floor((logicalWidth - 40) * 2 / ((narrow ? 15.5 : 17) * 0.55))); // the size the headline is drawn at
    const displayHeadline = text.headline.length <= headlineLimit ? text.headline : `${text.headline.slice(0, headlineLimit - 1).replace(/\s+\S*$/, "")}…`;
    const verb = n.answer?.verb ?? n.verb ?? (n.reply === "resolve" ? "resolve" : n.reply === "answer" ? "answer" : null);
    const resolve = verb === "resolve", tier = tierOf(n);
    const tone = tier === "escalation" || tier === "alert" ? t.blocked : t.accent;
    const tierWord = tier === "escalation" ? "Escalation · stuck work" : tier === "alert" ? "Needs you now" : "Routine";
    // OpenRig sends every ask without questions as approve; only a queue row saying humanIntent "decision" makes it one. Anything else, or a row
    // not read yet, is a request: answered in words that go back to the asker, never closed by one click.
    // OpenRig's stuck-sweep finding is a check on another row (its tags say so): one action that opens that row, none of a request's.
    const check = sweepFinding(n) ?? sweepFinding({...queueRow,...(n.conn?{conn:n.conn}:{})}), checkRows = check ? (this.drawAttention(cx)?.targets?.() ?? []) : [];
    const checkInNeeds = Boolean(check?.about && this.checkedRequest(check, checkRows, check.conn));
    const decision = !check && isDecisionAsk(n, queueRow), request = !check && verb === "approve" && !qState.totalCount && !decision;
    const rowTags = Array.isArray(queueRow?.tags) ? queueRow.tags : typeof queueRow?.tags === "string" ? queueRow.tags.split(",").map(x => x.trim()) : [];
    const ownerRun = rowTags.includes("owner-run") || rowTags.includes("gate:human");
    const kind = check ? "OpenRig check" : resolve ? "Parked · needs your words" : qState.totalCount ? "Decision" : verb === "approve" ? (decision ? "Approval" : "Request") : "Question";
    const owner = resolve ? parkedWorkOwner(queueRow ?? n) : asker;
    const resolved = resolveAskerSeat(owner, this.currentTopology(cx), n.conn ?? null, this.config);
    const logical = resolved.found ? resolved.seat.logicalId : String(owner ?? "the asking seat").split("@")[0].replace(/-/g, ".");
    const requestLine = ownerRun ? `${logical} is asking you to do this yourself. Reply with what you did or what you found, or say why not.` : `Reply to ${logical} with your answer, or what you did.`;
    const rig = resolved.found ? resolved.seat.rig : String(owner ?? "").split("@").slice(1).join("@");
    const at = n.at ?? queueRow?.tsUpdated, timestamp = Date.parse(at ?? ""), elapsed = Math.max(0, Date.now() - timestamp);
    const age = !Number.isFinite(timestamp) ? "unknown duration" : elapsed < 60000 ? "less than a minute" : elapsed < 3600000 ? `${Math.floor(elapsed / 60000)} min` : `${Math.floor(elapsed / 3600000)} h`;
    const projectName = typeof n.project === "string" ? n.project : n.project?.name ?? n.project?.id;
    const project = projectName && !/^(default|unknown|none)$/i.test(projectName.trim()) ? projectName : null;
    const humanDetail = queueRow?.humanDetail ?? n.humanDetail;
    const detailsKey = `need-details:${id}`, detailsOpen = Boolean((shared("rig.open.page") ?? {})[detailsKey]);
    const recordedKey = `need-recorded:${id}`, recordedOpen = Boolean((shared("rig.open.page") ?? {})[recordedKey]);
    const busy = Boolean(box?.busy), receipt = box?.result?.ok && qState.openCount === 0 && !qState.needsResume;
    const whose = whoseQueueSummary(perspective, this.config, n);
    const targetBox = () => this.replies[this.replyKey(n)] ??= this.makeReply(n);
    const snapshotShown = () => ({
      revision: queueRow?.decisionRevision ?? detailItem?.decisionRevision ?? n.decisionRevision ?? null,
      state: queueRow?.state ?? detailItem?.state ?? n.state ?? null,
      hadRow: Boolean(queueRow),
    });
    const openComposer = (cx, denying = false) => {
      if (!verb || n.native || busy || check) return;
      const b = targetBox(); b.cardMode = true; b.composerOpen = true; b.denying = denying; b.result = null;
      b.composerSnapshot = snapshotShown();
      delete this.refused?.[this.replyKey(n)];
      this.bindReplyInput(b, denying ? `Why not? ${asker ?? "the asking seat"} reads this.` : resolve ? "Your decision, in your own words" : request ? "Your answer, what you did, or the output it asked for" : "Your answer, in your own words");
      b.input.focus(); cx?.notify?.();
    };
    const send = (act, cx) => { if (!busy) this.submitCardDecision(cx, n, detailItem, queueRow, act); };
    // Mark done (a request) and Approve (a decision) ask first, with Cancel focused; Mark done needs the person's words.
    const openConfirm = (cx, which) => {
      if (!verb || n.native || busy) return;
      const b = targetBox(); b.cardMode = true; b.confirm = which; b.result = null;
      b.confirmSnapshot = snapshotShown();
      delete this.refused?.[this.replyKey(n)];
      if (which === "done" && !b.doneInput) {
        b.doneInput = TextareaState.new({ placeholder: "What you did", rows: 2, value: "" });
        b.doneInput.on("change", (_e, cx) => cx?.notify?.());
      }
      liveFocus(b.cardHandles?.["confirm-cancel"])?.focus?.(); cx?.notify?.();
    };
    const optionKeys = qState.questions.flatMap(q => q.options.map(o => `option:${q.id}:${o.id}`));
    this.prepareNeedFocus(cx, box, ["card", ...(check ? ["open-row"] : []), ...(request ? ["mark-done"] : ["approve"]), "deny", "resolve", "answer", "reply", "details", "resume", "confirm-cancel", "confirm-go", ...optionKeys]);
    const action = (key, label, click, { primary = false, recommended = false, disabled = false, tip = null } = {}) => {
      const handle = liveFocus(box?.cardHandles?.[key]);
      const activation=activationPair(this,`need-${key}-${id}`);
      return h_flex().id(`need-${key}-${id}`).h(32).px(12).gap(8).items_center().justify_center().rounded(6)
        .tooltip(whose?.onSomeoneElsesAsk ?? tip ?? (key === "resume" ? `Answer and let ${logical} go on` : key.startsWith("option:") ? "Answer with this option" : key === "approve" ? `Approve what ${logical} asked for (asks first)`
          : request && key === "answer" ? `Send ${logical} your words. They go back to ${logical}, and this request closes.` : key === "mark-done" ? `Tell ${logical} what you did and close this request (asks first)`
          : key === "confirm-cancel" ? "Go back without sending anything" : key === "confirm-go" ? (box?.confirm === "done" ? `Send ${logical} what you did and close this request` : `Close this request as approved`) : key === "deny" ? `Say no: ${logical} reads your reason` : `${key === "resolve" ? "Send your decision" : "Send your answer"} to ${logical}`))
        .when(narrow, el => el.w_full()).when(!narrow, el => el.flex_none())
        // A disabled control looks it (muted, no hover or pointer) and says why in its tooltip, instead of staying silently inert.
        .bg(primary && !disabled ? (t.solid ?? t.accent) : t.raised).text_color(disabled ? t.muted : primary ? (t.solid_foreground ?? t.background) : t.foreground)
        .border_1().border_color(primary && !disabled ? (t.solid ?? t.accent) : t.border).text_size(13)
        .when(!busy && !disabled, el => el.cursor_pointer().hover(s => s.bg(primary ? t.accent : t.hover)))
        .when(!!handle, el => el.track_focus(handle).tab_stop(true).tab_index(0))
        .when(Boolean(handle?.is_focused?.()), el => el.border_color(t.accent).border_2())
        .on_mouse_down("left", activation.pointer((_e, cx) => { cx.stop_propagation(); liveFocus(handle)?.focus?.(); }))
        .on_key_down(activation.key((e, cx) => { if (handle?.is_focused?.() && ["enter", "space", " "].includes(e.key)) { cx.stop_propagation(); if (!busy && !disabled) click(cx); } }))
        .on_click(activation.click((_e, cx) => { cx.stop_propagation(); if (!busy && !disabled) click(cx); }))
        .child(label).when(recommended, el => el.child(div().text_size(10.5).child("Recommended")));
    };
    const actions = [];
    if (check) {
      const seat = check.backlogSeat ? checkSeat(check) : null;
      const label = seat ? `Open ${seat.name}'s queue` : checkInNeeds ? "Open that request" : "Open the row";
      // Open the original queue row or, for a backlog notice, the seat's queue.
      const openRow = () => seat
        ? this.push({ section: "topology", kind: "seat", seatTab:"queue", ...(seat.rig ? { rig: seat.rig } : {}), name: seat.name, ...(seat.session ? { session: seat.session } : {}), ...(n.conn ? { conn: n.conn } : {}) })
        : this.openCheckedQueueRow(check, checkRows, check.conn);
      actions.push(action("open-row", label, () => openRow(), { primary: true, tip: seat ? `Open ${seat.name}'s page and queue; this check closes once ${seat.name} claims the rows.` : "Act on the row itself; this check then closes." }));
    }
    else if (n.native) actions.push(action("resume", "Relaunch / Resume…", () => this.menu(n), { primary: true }));
    else if (qState.totalCount && verb) {
      for (const q of qState.questions) {
        if (q.answered) continue;
        const options = [...q.options].sort((a, b) => Number(b.recommended) - Number(a.recommended));
        actions.push(v_flex().gap(6).child(this.plain(t, q.question, `need-question-${id}-${q.id}`))
          .child((narrow ? v_flex() : h_flex()).gap(8).flex_wrap().children(options.map(o =>
            action(`option:${q.id}:${o.id}`, o.label, cx => send({ mode: "choices", choices: [{ questionId: q.id, optionId: o.id }] }, cx), { primary: o.recommended, recommended: o.recommended })))));
      }
      if (qState.needsResume) actions.push(action("resume", "Send answers back", cx => send({ mode: "resume" }, cx), { primary: true }));
    } else if (verb === "approve" && decision) actions.push((narrow ? v_flex() : h_flex()).gap(8)
      .child(action("approve", "Approve…", cx => openConfirm(cx, "approve"), { primary: true }))
      .child(action("deny", "Deny…", cx => openComposer(cx, true))));
    else if (request) actions.push((narrow ? v_flex() : h_flex()).gap(8)
      .child(action("answer", "Reply…", cx => openComposer(cx), { primary: true }))
      .child(action("mark-done", "Mark done…", cx => openConfirm(cx, "done")))
      .child(action("deny", "Deny…", cx => openComposer(cx, true))));
    else if (resolve || verb === "answer") {
      if (!box?.composerOpen) actions.push((narrow ? v_flex() : h_flex()).child(action(resolve ? "resolve" : "answer", resolve ? "Resolve with my words…" : "Answer…", cx => openComposer(cx), { primary: true })));
    }
    else actions.push(this.dim(t, "This request still needs you. No response action was provided here; use Open in TUI to respond."));
    const confirming = box?.confirm === "done" || box?.confirm === "approve" ? box.confirm : null;
    const doneWords = confirming === "done" ? String(box.doneInput?.value() ?? "").trim() : "";
    const confirmReady = confirming === "approve" || !!doneWords;
    const closeConfirm = (cx) => { if (box) { box.confirm = null; box.confirmSnapshot = null; } this.typing = false; cx?.notify?.(); };
    const confirmGo = (cx) => {
      if (busy || !confirming || !confirmReady) return;
      const which = confirming, snap = box.confirmSnapshot ?? null;
      box.confirm = null; box.confirmSnapshot = null; this.typing = false;
      const snapOpts = snap ? { expectedRevision: snap.revision, expectedState: snap.state, snapshotHadRow: snap.hadRow } : {};
      // Mark done sends the person's words as their answer, so the asker hears; it never sends approve.
      if (which === "done") send({ mode: "answer-text", text: `Done: ${doneWords}`, doneResult: `Sent to ${logical}. This request is closed.`, ...snapOpts }, cx);
      else send({ mode: "approve", ...snapOpts }, cx);
    };
    const confirmPanel = confirming ? v_flex().id(`need-confirm-${id}`).gap(8).p(12).rounded(6).border_1().border_color(t.border).bg(t.raised)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); closeConfirm(cx); } })
      .child(div().text_size(13).text_color(t.foreground).child(confirming === "done" ? "Mark this done?" : "Approve this?"))
      .child(div().text_size(12).text_color(t.muted).child(confirming === "done"
        ? `Only if you've done what it asks. What you write goes back to ${logical}, and this request closes.`
        : `This closes the request as approved. ${logical} sees it as done; nothing else is sent back. To add a note, use Reply instead.`))
      .when(confirming === "done" && !!box?.doneInput, el => el.child(div().id(`need-confirm-words-${id}`).border_1().border_color(t.border).rounded(6).p(6)
        .on_key_down(() => { this.typing = true; }).child(Textarea.new(box.doneInput).h(52))))
      .child(h_flex().gap(8).flex_wrap()
        .child(action("confirm-cancel", "Cancel", cx => closeConfirm(cx)))
        .child(action("confirm-go", confirming === "done" ? "Mark done" : "Approve", cx => confirmGo(cx), { primary: true, disabled: !confirmReady, tip: confirmReady ? null : "Write what you did first" })))
      : null;
    const markDown = (body, key) => requestMarkdownView(body, { TextView, div, v_flex, id: key }).text_size(12.5).text_color(t.foreground);
    const cardKey = (e, cx) => {
      if (this.typing && e.key !== "escape") return;
      if (["enter", "space", " "].includes(e.key)) { cx.stop_propagation(); return; }
      if (e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt) return;
      if (String(e.key).toLowerCase() === "r") { cx.stop_propagation(); openComposer(cx); }
      else if (String(e.key).toLowerCase() === "d") { cx.stop_propagation(); setOpen(detailsKey, !detailsOpen); }
      else if (e.key === "escape") { cx.stop_propagation(); this.typing = false; if (box?.composerOpen) this.closeReply(cx, box, n); else if (standalone) this.goSection("needs", n?.conn ?? null); else setOpen(`needs:${id}`, false); cx.notify(); }
    };
    if (box) box.cardKey = cardKey;
    const connectedAsker=assistantForNeed({...n,asker:owner},this.hostedMembers(cx));
    return v_flex().id(`decision-card-${id}`).relative().rounded(8).bg(t.background).border_1().border_color(t.border)
      .py(16).px(narrow ? 16 : 20).gap(10).min_w(0)
      .child(div().id(`need-tier-bar-${id}`).absolute().left(0).top(6).bottom(6).w(3).bg(tone))
      .on_size_change((size, cx) => { if (Math.abs((this.needCardWidths?.[id] ?? 0) - size.width) > 1) { (this.needCardWidths ??= Object.create(null))[id] = size.width; cx.notify(); } })
      .when(!!box?.cardHandles?.card, el => el.track_focus(box.cardHandles.card))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); box?.cardHandles?.card?.focus(); })
      .on_key_down(cardKey)
      .child(h_flex().gap(8).items_center().flex_wrap()
        .child(div().text_size(10.5).text_color(tone).child(tierWord.toUpperCase()))
        .child(div().flex_1().text_size(11.5).text_color(t.dim).child(kind))
        .child(this.copyButton(t, text.source, `need-body-${id}`, check?"check body source":"request body source")))
      .child(div().id(`need-headline-${id}`).text_size(narrow ? 15.5 : 17).line_height(1.3).font_semibold().text_color(t.foreground).tooltip(check ? checkLabel(check, checkRows) : rowText(n.summary) || text.headline).child(check ? checkLabel(check, checkRows) : displayHeadline))
      .when(!!check, el => el.child(div().id(`need-check-line-${id}`).text_size(12).text_color(t.muted).child(check.backlogSeat
        ? `Rows are waiting for ${checkSeat(check).name} and nobody has picked them up. This isn't a new request; it closes once ${checkSeat(check).name} claims them.`
        : `OpenRig noticed this row is stuck${checkReason(n) ? `: ${checkReason(n)}` : ""}. This isn't a new request; it closes by itself once that row moves.`)))
      .when(request, el => el.child(div().id(`need-request-line-${id}`).text_size(12).text_color(t.muted).child(requestLine)))
      .when(Boolean(box?.changedSinceAnswered), el => el.child(h_flex().gap(6).items_center().text_size(12).text_color(t.muted)
        .child(svg(icon("rig-refresh")).size(12)).child("Changed since you answered")))
      // The opening was cut to what three rows hold at this width (openingRowChars); what was cut starts Details, and this line
      // says so. The box never clips: a heading or list renders taller than its rows, and then the card grows instead of hiding words.
      .when(Boolean(text.opening), el => {
        const more = openingMoreText(text.openingMoreLines, text.openingCut);
        return el.child(div().id(`need-opening-${id}`).line_height(`${TEXT_LINE_HEIGHT}px`)
          .child(markDown(text.opening, `need-opening-text-${id}`)))
          .when(!!more, el => el.child(div().id(`need-opening-more-${id}`).text_size(12).text_color(t.accent).cursor_pointer()
            .tooltip("Show the full message").on_click((_e, cx) => { cx.stop_propagation(); setOpen(detailsKey, true); cx.notify(); }).child(more)));
      })
      .child(h_flex().id(`need-context-${id}`).gap(6).items_center().flex_wrap().text_size(12).text_color(t.muted)
        .child(svg(icon(connectedAsker?'rig-queue':"rig-seat")).size(12).flex_none()).child(connectedAsker?assistantOwner(connectedAsker):`${logical}${rig ? ` · ${rig}` : ""}`)
        .child(div().tooltip(this.time(at,{exact:true})).child(`· waiting ${age}`))
        .when(Boolean(owner), el => el.child(focusTarget(this,cx,`need-open-asker-${id}`,div().id(`need-open-asker-${id}`).tooltip(`Open ${logical}'s page`).text_color(t.accent).cursor_pointer().child(connectedAsker?'Open assistant page':"Open seat"),cx=>{cx.stop_propagation();this.openAskerSeat(cx,{...n,asker:owner});},el=>el.border_1().border_color(t.accent))
          .on_mouse_down('left',activationPair(this,`need-open-asker-${id}`).pointer((_e,cx)=>{cx.stop_propagation();liveFocus(this.focusTargets?.get(`need-open-asker-${id}`))?.focus?.();}))))
        .when(Boolean(project), el => el.child(`· ${project}`)))
      .when(Boolean(this.askerNotes[this.replyKey(n)]), el => el.child(div().id(`need-asker-note-${id}`).text_size(11.5).text_color(t.muted).child(this.askerNotes[this.replyKey(n)])))
      .when(Boolean(whose?.onSomeoneElsesAsk), el => el.child(this.dim(t, whose.onSomeoneElsesAsk)))
      // The open composer owns its result below its buttons. A closed composer, receipt or uncertain send uses this card line.
      .when(Boolean(box?.result) && !(box?.composerOpen && !receipt && !box?.result?.networkError), el => el.child(h_flex().id(`need-result-${id}`).gap(6).items_start()
        .child(svg(icon(box.result.ok ? "check" : "rig-alert")).size(12).text_color(box.result.ok ? t.working : t.blocked))
        .child(div().flex_1().text_size(12).text_color(box.result.ok ? t.muted : t.blocked).child(box.result.ok ? box.result.text : this.errorText(t,`need-result-error-${id}`,box.result.text)))))
      .when(Boolean(box?.result?.networkError && box.result.retryAct), el => el.child(this.button(t, `need-check-and-finish-${id}`, "Check and finish",
        (_e, cx) => { if (!busy) this.submitCardDecision(cx, box.target ?? n, detailItem, queueRow, box.result.retryAct); }, { small: true, disabled: busy, tip: "The send may not have arrived: check and finish it without sending twice" })))
      .when(!receipt && !box?.result?.networkError, el => el.children(actions).when(!!confirmPanel, el => el.child(confirmPanel))
        .when(!n.native && !check && (qState.totalCount > 0 || (verb === "approve" && !request)), el => el.child(focusTarget(this,cx,`need-reply-link-${id}`,div().id(`need-reply-link-${id}`).tooltip("Answer in your own words").text_size(12).text_color(t.accent).cursor_pointer()
          .child("Reply in your own words"),cx=>{cx.stop_propagation();openComposer(cx);},el=>el.border_1().border_color(t.accent))
          .on_mouse_down('left',activationPair(this,`need-reply-link-${id}`).pointer((_e,cx)=>{cx.stop_propagation();liveFocus(this.focusTargets?.get(`need-reply-link-${id}`))?.focus?.();}))))
        .when(Boolean(box?.composerOpen), el => el.child(this.replyBox(t, cx, n, { detailItem, queueRow, onSomeoneAskText: whose?.onSomeoneElsesAsk }))
          .child(this.dim(t, "A response is not approval. What you send is recorded as your words; the asking seat reads it and decides."))))
      .when(!n.native && !n.decisionRevision, el => el.child(div().id(`need-no-revision-note-${id}`).text_size(11).text_color(t.dim)
        .child("OpenRig < 0.7.9 (no decisionRevision): a changed request won't be caught before sending.")))
      .child(v_flex().pt(10).border_t(1).border_color(t.border).gap(8)
        .child(h_flex().id(`need-details-toggle-${id}`).gap(6).items_center().cursor_pointer()
          .tooltip("Show or hide the request's details (D)").on_click((_e, cx) => { cx.stop_propagation(); setOpen(detailsKey, !detailsOpen); })
          .child(svg(icon(detailsOpen ? "chevron-down" : "chevron-right")).size(11).text_color(t.dim))
          .child(div().text_size(12).text_color(t.muted).child("Details"))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).tooltip(String(text.detailHint??"")).child(text.detailHint)))
        .when(detailsOpen, el => el.child(v_flex().id(`need-details-${id}`).gap(10)
          .when(Boolean(text.details), el => el.child(markDown(text.details, `need-details-text-${id}`)))
          .when(Boolean(humanDetail), el => el.child(this.dim(t, `More from ${asker ?? "the asker"}`)).child(markDown(typeof humanDetail === "string" ? humanDetail : JSON.stringify(humanDetail, null, 2), `need-human-detail-${id}`)))
          .when(Boolean(n.unblocks), el => el.child(this.dim(t, `Unblocks: ${n.unblocks}`)))
          .children(evidenceFiles.map((file, i) => {
            const path = typeof file === "string" ? file : file.path ?? "";
            return h_flex().gap(6).child(div().id(`need-evidence-${id}-${i}`).flex_1().text_size(12).text_color(t.accent).cursor_pointer().tooltip(`Open ${typeof file === "object" ? file.label ?? path : path}`)
              // The request's own OpenRig names the file (the Needs page lends no connection): a file of a box's request is never read here.
              .on_click(() => this.push({ ...fileEntry(path, typeof file === "object" ? file.label : path.split("/").pop()), ...((this.config?.connections ?? []).length > 1 && n.conn ? { conn: n.conn } : {}) })).child(path))
              .child(this.copyButton(t, path, `need-evidence-path-${id}-${i}`, "evidence path"));
          }))
          .child(v_flex().gap(4).child(h_flex().id(`need-recorded-toggle-${id}`).gap(6).items_center().text_size(11.5).text_color(t.dim).cursor_pointer()
            .tooltip(`Show or hide what OpenRig recorded for this ${check?'check':'request'}`).on_click(() => setOpen(recordedKey, !recordedOpen))
            .child(svg(icon(recordedOpen ? "chevron-down" : "chevron-right")).size(11)).child("What OpenRig recorded"))
            .when(recordedOpen, el => el.children(recordedLines.map((line, i) => this.plain(t, line, `need-recorded-${id}-${i}`)))
              .child(this.copyValue(t, `Inspect: rig queue show ${n.qitemId ?? id} --full`, `need-inspect-${id}`, "inspect command")))))));
  }

  decisionCard(t, cx, n, { standalone = false, perspective = null, viewParam = shared("rig.needsView") ?? null } = {}) {
    const itemPath = `/api/attention?item=${encodeURIComponent(n.id)}${viewParam ? `&view=${encodeURIComponent(viewParam)}` : ""}`;
    let got = this.read(cx, itemPath);
    if (viewParam && got.status === 404) {
      got = this.read(cx, `/api/attention?item=${encodeURIComponent(n.id)}`);
    }
    const queuePath = n.qitemId ? `/api/queue/${encodeURIComponent(n.qitemId)}` : null;
    const queueRes = queuePath ? this.read(cx, queuePath) : null;
    const queueRow = queueRes?.data && typeof queueRes.data === "object" && !queueRes.data.error ? queueRes.data : null;
    const detail = got.data?.detail ?? null;
    const detailItem = detail?.item && typeof detail.item === "object" ? detail.item : null;

    const mergedItem = {
      ...n,
      ...(detailItem ?? {}),
      ...(queueRow ? {
        waiting: queueRow.waiting,
        destinationSession: queueRow.destinationSession,
        state: queueRow.state,
        blockedOn: queueRow.blockedOn,
        body: queueRow.body,
        tags: queueRow.tags ?? detailItem?.tags ?? n.tags,
        ownerNotificationLevel: queueRow.ownerNotificationLevel ?? n.ownerNotificationLevel,
        priority: queueRow.priority ?? n.priority,
        decisionRevision: queueRow.decisionRevision ?? detailItem?.decisionRevision ?? n.decisionRevision,
        humanQuestions: queueRow.humanQuestions ?? detailItem?.humanQuestions ?? n.humanQuestions,
        humanAnswers: queueRow.humanAnswers ?? detailItem?.humanAnswers ?? n.humanAnswers,
      } : {}),
      id: n.id,
      qitemId: n.qitemId ?? detailItem?.answer?.qitemId ?? queueRow?.id ?? null,
    };

    const box = !isUpdateNeed(mergedItem) ? this.replyFor(cx, mergedItem) : null;
    if (box && queueRow && observeNeedDecision(box, queueRow, queueRes.at, { readSeq: queueRes.shownSeq ?? null })) {
      delete this.answered[this.replyKey(n)];
      delete this.questionChoices[this.replyKey(n)];
    }
    const strip = tierStripFor(mergedItem);
    const stripColor = strip.tone === "blocked" ? t.blocked : strip.tone === "accent" ? t.accent : t.dim;
    const detailLines = needDetailLines(detail);
    const recordedLines = needRecordedLines(detail);
    const evidenceFiles = Array.isArray(detail?.files) ? detail.files : [];
    const qState = questionsState(mergedItem, queueRow);
    const whose = whoseQueueSummary(perspective ?? got.data?.perspective, this.config, mergedItem);

    const asker = mergedItem.asker ?? mergedItem.sourceSession ?? queueRow?.sourceSession ?? (n.native && n.logicalId && n.rig ? `${n.logicalId}@${n.rig}` : null);
    const recipient = mergedItem.recipient ?? queueRow?.destinationSession ?? null;
    const scope = String(mergedItem.scope ?? n.scope ?? "").replace(/\bproject unknown\b/g, "Not linked to a project") || null;
    const since = mergedItem.at ?? n.at ?? null;
    const unblocks = mergedItem.unblocks ?? n.unblocks ?? null;
    const askerNote = this.askerNotes[this.replyKey(n)] ?? null;

    if (!isUpdateNeed(mergedItem)) return this.requestCard(t, cx, {
      n: mergedItem, queueRow, detailItem, detailLines, recordedLines, evidenceFiles, qState, box, standalone,
      asker, perspective: perspective ?? got.data?.perspective,
    });

    // Updates keep their existing read-only body and dismissal controls; request actions have one renderer above.
    const open = shared("rig.open.page") ?? {}, recordedOpen = Boolean(open[`need-recorded:${n.id}`]);
    const lines = detailLines[0] === "Informational update; no action needed. Viewing is not approval or proof of delivery."
      ? detailLines.slice(1) : detailLines;
    return v_flex().id(`decision-card-${n.id}`).gap(8).pl(10).py(4).border_l(2).border_color(t.dim)
      .when(standalone, el => el.child(this.title(t, rowText(n.summary))).child(this.dim(t, "Update")))
      .child(h_flex().gap(6).items_center().flex_wrap().text_size(11.5).text_color(t.muted)
        .when(Boolean(asker), el => el.child(focusTarget(this,cx,`need-open-asker-${n.id}`,div().id(`need-open-asker-${n.id}`).tooltip(`Open ${asker}'s page`).text_color(t.accent).cursor_pointer()
          .child(`From ${asker}`),cx=>{cx.stop_propagation();this.openAskerSeat(cx,{...mergedItem,asker});},el=>el.border_1().border_color(t.accent))))
        .when(Boolean(recipient), el => el.child(`· to ${recipient}`))
        .when(Boolean(scope), el => el.child(`· ${scope}`)).when(Boolean(since), el => el.child(`· since ${since}`)))
      .when(Boolean(askerNote), el => el.child(this.dim(t, askerNote)))
      .child(v_flex().id(`need-body-${n.id}`).gap(6).children(lines.flatMap(line => line.split(/\r?\n/)).filter(line => line.trim())
        .map((line, i) => this.plain(t, line, `need-body-line-${n.id}-${i}`))))
      .when(Boolean(unblocks), el => el.child(this.dim(t, `Unblocks: ${unblocks}`)))
      .child(div().id(`need-update-note-${n.id}`).text_size(12).text_color(t.dim).child("No action needed. Viewing isn't approval or proof of delivery."))
      .when(dismissible(n), el => el.child(h_flex().child(this.updateButton(t, `dismiss-open-${n.id}`, "Dismiss", () => this.updateAction("dismiss", n)).tooltip("Dismiss this update; you can bring it back from Show dismissed"))))
      .when(Boolean(this.updateModel().records.find(r => r.key === updateKey(n) && r.restored && r.status === "closed")), el => el.child(this.dim(t, "Restored here; OpenRig still has it closed.")))
      .child(v_flex().gap(4).child(h_flex().id(`need-recorded-toggle-${n.id}`).gap(6).items_center().cursor_pointer()
        .tooltip("Show or hide what OpenRig recorded for this update").on_click(() => setOpen(`need-recorded:${n.id}`, !recordedOpen))
        .child(svg(icon(recordedOpen ? "chevron-down" : "chevron-right")).size(11).text_color(t.dim))
        .child(this.dim(t, "What OpenRig recorded")))
        .when(recordedOpen, el => el.children(recordedLines.map((line, i) => this.plain(t, line, `need-recorded-line-${n.id}-${i}`)))
          .child(this.copyValue(t, `rig queue show ${n.qitemId ?? n.id} --full`, `inspect-${n.id}`, "inspect command"))));
  }

  /** The reply box for a request, made outside render (herdr forbids making state there) on first sight; the palette's
   *  `reply <words>` (`shared("rig.replyFocus")`) refills and focuses it. */
  replyFor(cx, n) {
    const f = shared("rig.replyFocus");
    const want = f?.id === n.id && f.at !== this.focusSeen;
    if (want) this.focusSeen = f.at;
    if ((!this.replies[this.replyKey(n)] && !this.making?.has(this.replyKey(n))) || want) {
      (this.making ??= new Set()).add(this.replyKey(n));
      // A timer set from this draw: the box's input is this page's own (after an await it would be whichever view drained the promise jobs).
      cx.timer.after(0, (next) => {
        try {
          const box = this.replies[this.replyKey(n)] ??= this.makeReply(n);
          if (want && !box.busy) {
            box.composerOpen = true;
            const qid = n?.qitemId ?? (String(n?.id ?? "").startsWith("queue:") ? String(n.id).slice(6) : null);
            const row = qid ? this.cacheFor(adoptConnection(this.config, n?.conn) ?? this.activeConnId())[`/api/queue/${encodeURIComponent(qid)}`]?.data : null;
            box.composerSnapshot = { revision: row?.decisionRevision ?? n?.decisionRevision ?? null, state: row?.state ?? n?.state ?? null, hadRow: Boolean(row) };
            delete this.refused?.[this.replyKey(n)];
          }
          if (want && !box.busy) { box.input.set_value((shared("rig.drafts") ?? {})[box.key] ?? ""); box.result = null; box.input.focus(); }
        } finally { this.making.delete(this.replyKey(n)); } // a box that failed to be made is tried again on the next render, never stuck
        next?.notify?.();
      });
    }
    const box = this.replies[this.replyKey(n)];
    if (box) box.target = n;
    // A placeholder change asked for after an await (a denial that was sent) is made here, from the draw, never in that continuation.
    if (box?.pendingPlaceholder && !box.rebindTimer && cx?.timer?.after) {
      box.rebindTimer = true;
      cx.timer.after(0, (next) => {
        box.rebindTimer = false;
        const placeholder = box.pendingPlaceholder; box.pendingPlaceholder = null;
        if (placeholder && !this.closed) { this.bindReplyInput(box, placeholder); next?.notify?.(); }
      });
    }
    return box ?? null;
  }

  bindReplyInput(box, placeholder) {
    const val = box.input ? box.input.value() : ((shared("rig.drafts") ?? {})[box.key] ?? "");
    try { box.input?.release?.(); } catch (_) {}
    const input = TextareaState.new({ placeholder, rows: 3, value: val });
    box.discardDraftVisible = Boolean(val);
    // The draft is kept as it is typed (300 ms after the last change), as the reply dialog keeps it.
    input.on("change", (_e, cx) => {
      if (box.discardDraftVisible !== Boolean(input.value())) { box.discardDraftVisible = Boolean(input.value()); cx.notify?.(); }
      if (box.discardDraftUntil) { box.discardDraftUntil = 0; cx.notify?.(); }
      if (box.confirmResolve) { box.confirmResolve = false; cx.notify?.(); }
      if (box.saving) return;
      box.saving = true;
      cx.timer.after(300, () => { box.saving = false; this.keepDraft(box); });
    });
    // Enter adds a line; Ctrl+Enter (Cmd+Enter on macOS: GPUI's secondary-enter) sends.
    input.on("submit", (e, cx) => { if (e?.secondary) this.sendReply(cx, box); });
    box.input = input;
    return input;
  }

  /** A request's reply state (its box and typed text, its answered note, chosen options, asker note) belongs to its OpenRig and id: two connected
   *  OpenRigs can hold the same queue id (a queue copied, restored or snapshotted from the other). The legacy connection keeps the bare id. */
  replyKey(n) { return qualifyKey(adoptConnection(this.config, n?.conn), n?.id); }
  makeReply(n) {
    const key = draftKey(n, "reply");
    const box = { input: null, key, target: n, busy: false, result: null, denying: false, stepProgress: null, recordedChoiceByQuestion: {} };
    this.bindReplyInput(box, n.reply === "resolve" ? "Your decision, in your own words" : "Your answer, in your own words");
    return box;
  }

  keepDraft(box) {
    // While it is being sent, the text isn't a draft.
    if (!box?.input || box.busy) return;
    const all = { ...(shared("rig.drafts") ?? {}) }, text = box.input.value();
    if ((all[box.key] ?? "") === text) return;
    if (text.trim()) all[box.key] = text; else delete all[box.key];
    setShared("rig.drafts", all);
  }

  closeReply(cx, box, n) {
    if (box.busy) return;
    box.discardDraftUntil = 0;
    this.keepDraft(box);
    if (box.cardMode) {
      box.composerOpen = false; box.confirmResolve = false; box.denying = false; box.composerSnapshot = null;
    } else if (box.denying) {
      box.denying = false; box.result = null;
      this.bindReplyInput(box, n.reply === "resolve" || n.verb === "resolve" ? "Your decision, in your own words" : "Your answer, in your own words");
    } else {
      if (shared("rig.focusNeed") === n.id) setShared("rig.focusNeed", null);
      box.composerOpen = false; box.confirmResolve = false; box.result = null; box.composerSnapshot = null;
      setOpen(`needs:${n.id}`, false);
    }
    this.typing = false;
    cx.notify();
  }

  discardReply(cx, box, n) {
    if (box.busy || !box.input.value()) return;
    const text = box.input.value();
    if (!(box.discardDraftUntil > Date.now() && box.discardDraftText === text)) {
      const until = Date.now() + 4000;
      box.discardDraftUntil = until; box.discardDraftText = text;
      cx.timer.after(4000, (cx) => {
        if (box.discardDraftUntil !== until) return;
        box.discardDraftUntil = 0; cx.notify();
      });
      cx.notify();
      return;
    }
    box.input.set_value("");
    this.keepDraft(box);
    box.denying = false;
    this.closeReply(cx, box, n);
  }

  /** What the card says when the decision's flow threw. Every POST and its own refusals are worded inside `submitMissionActions`; a gate refusal that escapes BEFORE the POST callback started (the operation,
   *  the address, the revision read, which is a GET) sent nothing. After it started a POST may have been recorded whatever the error says, so that is unconfirmed (with Retry), and so is any error that is not a gate refusal. */
  cardFailure(error, act, posted) {
    if (!posted && (error?.code === "GATE_REFUSED" || isKnownUnsentError(error))) return this.notSentResult(unsentErrorMessage(error));
    return { ok: false, networkError: true, retryAct: { ...act }, text: NETWORK_UNCONFIRMED_MESSAGE };
  }
  /** A decision result for a refusal that happened before anything left: says so once (a sentence that already does is left as it is) and carries `notSent` so the card adds no "may still have arrived". */
  notSentResult(text) { const line = String(text ?? "").trimEnd(); return { ok: false, notSent: true, text: /nothing was sent/i.test(line) ? line : `${line} Nothing was sent.` }; }

  /**
   * Submit a Decision Card action (`approve`, `deny`, `choices`, `freeform`, `resume`, `resolve`) via
   * `POST /api/mission-control/action`.
   * Never uses `X-OpenRig-Session` or `rig queue answer`.
   */
  submitCardDecision(cx, n, detailItem, queueRow, act) {
    const box = this.replies[this.replyKey(n)] ??= this.makeReply(n);
    if (box.busy) return;
    // A box holds the text typed for ITS request: an answer is sent only for a request on the same OpenRig as the box's own.
    if ((adoptConnection(this.config, box.target?.conn) ?? null) !== (adoptConnection(this.config, n?.conn) ?? null)) {
      box.result = this.notSentResult("This answer box belongs to a request on another OpenRig."); cx.notify(); return;
    }
    this.keepDraft(box);
    box.busy = true;
    box.stepProgress = null;
    box.result = null;
    // The answer goes to the OpenRig the request came from (its own `conn`, bound here, not to whatever the page shows by the time it is sent);
    // a request without one is refused with two or more connections, never defaulted.
    const target = targetConnection(this.config, { conn: adoptConnection(this.config, n?.conn) });
    if (!target.ok) { box.busy = false; box.result = this.notSentResult(target.reason); cx.notify(); return; }
    const config = target.config;
    cx.notify();
    cx.spawn(async (cx) => {
      let posted = false;
      try {
        // One operation: the address, the revision read and the POST belong to the config this decision began under. If the address changed while the
        // revision was read, nothing is POSTed to the old daemon.
        const op = gatedOperation(config?.connectionId); // the decision's own connection
        const daemonUrl = await this.resolveDaemonUrl(config);
        if (!daemonUrl) {
          box.busy = false;
          box.stepProgress = null;
          box.result = this.notSentResult(this.daemonMessageFor(config) || "OpenRig daemon is not running."); // resolveDaemonUrl turns a gate refusal into null: this is its only trace
          cx.notify();
          return;
        }
        const refused = await missionActionPreflight({ ...config, daemonUrl }, op);
        if (refused) {
          box.busy = false;
          box.stepProgress = null;
          box.result = refused;
          cx.notify();
          return;
        }
        const qid = n.qitemId ?? detailItem?.answer?.qitemId ?? queueRow?.id ?? (String(n.id ?? "").startsWith("queue:") ? String(n.id).slice(6) : null);
        const hasSnapRev = act.expectedRevision !== undefined;
        let latestRevision = hasSnapRev ? act.expectedRevision : (queueRow?.decisionRevision ?? detailItem?.decisionRevision ?? n.decisionRevision ?? null);
        const expectedState = act.expectedState ?? queueRow?.state ?? detailItem?.state ?? n.state ?? null;
        if ((latestRevision === null || latestRevision === undefined) && qid) {
          try {
            const qr = await op.fetch(`${daemonUrl}/api/queue/${encodeURIComponent(qid)}`);
            if (qr.ok) {
              const qd = await qr.json();
              if (qd && (typeof qd.decisionRevision === "number" || typeof qd.decisionRevision === "string")) {
                latestRevision = qd.decisionRevision;
                this.cacheFor(config.connectionId)[`/api/queue/${encodeURIComponent(qid)}`] = { data: qd, status: qr.status, at: Date.now() };
              }
            }
          } catch (e) { rethrowGate(null)(e); /* a gate refusal stops the decision; other failures: expectedRevision is omitted in missionAction when decisionRevision is unavailable */ }
        }
        const itemForAction = {
          ...n,
          ...(detailItem ?? {}),
          waiting: queueRow?.waiting ?? n.waiting,
          destinationSession: queueRow?.destinationSession ?? n.destinationSession,
          qitemId: qid,
          decisionRevision: latestRevision ?? undefined,
          ...(expectedState ? { state: expectedState } : {}),
        };
        const actWithProgress = {
          ...act,
          expectedRevision: latestRevision ?? undefined,
          ...(expectedState ? { expectedState } : {}),
          queueRow, // the guard in submitMissionActions sends approve only for a row saying humanIntent "decision"
          onStep: (step, total) => {
            box.stepProgress = { step, total };
            cx.notify();
          },
          onStepDone: (_step, _total, qId, optId) => {
            if (qId && optId) {
              box.recordedChoiceByQuestion = { ...(box.recordedChoiceByQuestion ?? {}), [qId]: optId };
              cx.notify();
            }
          },
        };
        // Guaranteed vs best-effort boundary:
        // - Daemon-atomic: every revision-changing transition (closed, blocked, body/question/answer edits) via `expectedRevision`,
        //   plus `pending -> in-progress` on Mark done / Reply / Choices / Resume (`verb: "answer"`, rejected by daemon `answerAsk`).
        // - Client best-effort pre-check (below): OpenRig's `POST /api/mission-control/action` has no `expectState` parameter, and
        //   `decisionRevision` collapses `pending` and `in-progress` into `phase: "open"` while `approve`/`deny` allow `in-progress`.
        //   When the daemon supports `decisionRevision` and we snapshotted the shown state, verify `GET /api/queue/:qid` before POSTing
        //   and refuse honestly on any mismatch or failed/malformed read (never silently falling through to POST). A transition landing
        //   between this GET and the POST that keeps the same open-phase revision cannot be rejected atomically on this API.
        let outcome = null;
        const resolvedVerb = resolveMissionVerb(itemForAction, actWithProgress);
        const isRetry = Boolean(typeof actWithProgress.operationHashPrefix === "string" && actWithProgress.operationHashPrefix);
        if ((resolvedVerb === "approve" || resolvedVerb === "deny")
          && (resolvedVerb !== "approve" || isDecisionAsk(itemForAction, queueRow))
          && latestRevision !== null && latestRevision !== undefined && expectedState && qid) {
          const stateCheckFailed = (reason) => isRetry
            // A retry follows an earlier uncertain POST that may have committed: never claim "Nothing was sent." or drop Check and finish.
            ? {
                ok: false,
                status: 0,
                code: "network_error",
                networkError: true,
                conflict: false,
                operationHashPrefix: actWithProgress.operationHashPrefix,
                message: NETWORK_UNCONFIRMED_MESSAGE,
                text: NETWORK_UNCONFIRMED_MESSAGE,
                committedQuestionIds: [],
                stepsCompleted: 0,
              }
            : {
                ok: false,
                status: 0,
                code: "state_check_failed",
                conflict: false,
                notSent: true,
                message: reason,
                text: reason,
                committedQuestionIds: [],
                stepsCompleted: 0,
              };
          try {
            const qr = await op.fetch(`${daemonUrl}/api/queue/${encodeURIComponent(qid)}`);
            if (!qr.ok) {
              outcome = stateCheckFailed(qr.status === 404
                ? "That request isn't in OpenRig's queue any more. Nothing was sent."
                : `OpenRig couldn't check this request's current state (HTTP ${qr.status}). Nothing was sent.`);
            } else {
              let qd = null;
              try { qd = await qr.json(); } catch (_) { qd = null; }
              if (!qd || typeof qd !== "object" || qd.error || typeof qd.state !== "string" || !qd.state.trim()) {
                outcome = stateCheckFailed("OpenRig returned an unreadable queue row while checking its current state. Nothing was sent.");
              } else {
                this.cacheFor(config.connectionId)[`/api/queue/${encodeURIComponent(qid)}`] = { data: qd, status: qr.status, at: Date.now() };
                const stateMoved = qd.state !== expectedState;
                const hasRev = qd.decisionRevision !== undefined && qd.decisionRevision !== null;
                const revMoved = hasRev && String(qd.decisionRevision) !== String(latestRevision);
                const revConfirmedSame = hasRev && String(qd.decisionRevision) === String(latestRevision);
                // On a retry (Check and finish), a moved/absent revision may be our own earlier committed operation:
                // forward to OpenRig so its operationId replay check reconciles 200 or rejects 409 authoritatively.
                // Only refuse locally on retry when decisionRevision is confirmed unchanged (so Approve/Deny never committed) and state moved.
                if (isRetry ? (revConfirmedSame && stateMoved) : (stateMoved || revMoved)) {
                  const code = stateMoved ? "qitem_state_changed" : "decision_revision_changed";
                  const message = formatSafeCloseConflict({ code, currentState: qd.state, expectedState });
                  outcome = {
                    ok: false,
                    status: 409,
                    code,
                    conflict: true,
                    notSent: true,
                    currentState: qd.state,
                    message,
                    text: message,
                    data: qd,
                    committedQuestionIds: [],
                    stepsCompleted: 0,
                  };
                }
              }
            }
          } catch (e) {
            rethrowGate(null)(e);
            outcome = stateCheckFailed("OpenRig couldn't be checked for this request's current state. Nothing was sent.");
          }
        }
        if (!outcome) {
          outcome = await submitMissionActions(config, itemForAction, actWithProgress, async (req) => {
            posted = true; // from here a POST may have left: nothing that escapes later is "nothing was sent"
            const r = await op.fetch(`${daemonUrl}${req.path}`, {
              method: req.method ?? "POST",
              headers: req.headers ?? { "content-type": "application/json" },
              body: JSON.stringify(req.body),
            });
            let data = null;
            const rawText = await r.text();
            try { data = JSON.parse(rawText); } catch (_) { data = { error: rawText }; }
            return { ok: r.ok, status: r.status, data, error: data?.error ?? data?.message ?? null };
          });
        }

        box.busy = false;
        box.stepProgress = null;
        if (outcome.ok) {
          delete this.refused?.[this.replyKey(n)];
          if (act.mode === "choices") {
            const nextChoices = { ...(this.questionChoices[this.replyKey(n)] ?? {}) };
            for (const c of act.choices ?? []) delete nextChoices[c.questionId];
            this.questionChoices[this.replyKey(n)] = nextChoices;
          } else {
            const all = { ...(shared("rig.drafts") ?? {}) };
            delete all[box.key];
            setShared("rig.drafts", all);
            box.input.set_value("");
            if (box.denying) {
              box.denying = false;
              // After the POST's await: the next draw makes the new input (replyFor), never this continuation.
              box.pendingPlaceholder = (n.reply === "resolve" || n.verb === "resolve") ? "Your decision, in your own words" : "Your answer, in your own words";
            }
            box.confirmResolve = false;
            box.composerSnapshot = null;
            delete this.questionChoices[this.replyKey(n)];
          }
          if (shared("rig.focusNeed") === n.id) setShared("rig.focusNeed", null);
          const sentText = this.sentNeedConfirmation(itemForAction, queueRow, act);
          const confirmation = act.doneResult ? `${act.doneResult}${outcome.text && /kept|Already answered/.test(outcome.text) ? ` ${outcome.text}` : ""}` : `${sentText} ${outcome.text}`;
          if (act.doneResult) box.doneInput?.set_value("");
          this.answered[this.replyKey(n)] = { summary: requestHeadline(n), text: confirmation, at: Date.now(), conn: adoptConnection(this.config, n?.conn) ?? null };
          box.composerOpen = false; box.changedSinceAnswered = false;
          box.result = { ok: true, text: confirmation };
          box.receipt = { at: Date.now(), revision: outcome.decisionRevision, body: queueRow?.body,
            state: act.mode === "resolve" || n.reply === "resolve" ? "in-progress" : null };
          refreshSidebar();
          const viewParam = shared("rig.needsView") ?? null;
          const rereadCfg = configOfConnection(this.config, config.connectionId);
          if (rereadCfg) {
            this.read(cx, viewParam ? `/api/attention?view=${encodeURIComponent(viewParam)}` : "/api/attention", true, null, rereadCfg);
            this.read(cx, `/api/attention?item=${encodeURIComponent(n.id)}`, true, null, rereadCfg);
            if (qid) this.read(cx, `/api/queue/${encodeURIComponent(qid)}`, true, null, rereadCfg);
          }
        } else {
          if (outcome.conflict) {
            box.conflictAwaitingRefresh = false;
            box.composerSnapshot = null;
            (this.refused ??= Object.create(null))[this.replyKey(n)] = {
              id: n.id,
              qitemId: qid,
              summary: requestHeadline(n),
              asker: n.asker ?? n.sourceSession ?? queueRow?.sourceSession ?? null,
              text: outcome.text || "Not recorded: the request changed while you had it open. Here it is now; check it and answer again.",
              state: outcome.currentState ?? outcome.data?.state ?? null,
              at: Date.now(),
              conn: adoptConnection(this.config, n?.conn) ?? null,
              listEpoch: this.needsPageEpoch ?? 0,
              filter: this.filter?.toLowerCase() ?? "",
              position: this.needPositions?.[this.replyKey(n)] ?? 0,
              unfilteredPosition: this.needUnfilteredPositions?.[this.replyKey(n)] ?? this.needPositions?.[this.replyKey(n)] ?? 0,
            };
            refreshSidebar();
          }
          let conflictReadSeq = false;
          if (outcome.conflict || outcome.settingsChanged || outcome.partial) { // a settings change or partial stop mid-answer also leaves recorded steps: the card drops them and re-reads the item
            if (Array.isArray(outcome.committedQuestionIds) && outcome.committedQuestionIds.length > 0) {
              const nextChoices = { ...(this.questionChoices[this.replyKey(n)] ?? {}) };
              for (const qId of outcome.committedQuestionIds) delete nextChoices[qId];
              this.questionChoices[this.replyKey(n)] = nextChoices;
            }
            const viewParam = shared("rig.needsView") ?? null;
            const rereadCfg = configOfConnection(this.config, config.connectionId);
            if (rereadCfg) {
              if (outcome.conflict) this.read(cx, viewParam ? `/api/attention?view=${encodeURIComponent(viewParam)}` : "/api/attention", true, null, rereadCfg);
              this.read(cx, `/api/attention?item=${encodeURIComponent(n.id)}`, true, null, rereadCfg);
              if (qid) {
                const qPath = `/api/queue/${encodeURIComponent(qid)}`;
                // Fence off any pre-refusal in-flight queue GET so stale pre-refusal data can neither refine the refusal nor consume its refresh arm.
                this.read(cx, qPath, true, null, rereadCfg, false, Boolean(outcome.conflict));
                if (outcome.conflict) {
                  const qCache = this.cacheFor(rereadCfg.connectionId)[qPath];
                  conflictReadSeq = qCache?.loading && typeof qCache.seq === "number" ? qCache.seq : false;
                  box.conflictAwaitingRefresh = conflictReadSeq;
                }
              }
            }
          }
          if (outcome.networkError) {
            box.result = {
              ok: false,
              networkError: true,
              retryAct: { ...act, expectedRevision: latestRevision ?? undefined, ...(expectedState ? { expectedState } : {}), operationHashPrefix: outcome.operationHashPrefix },
              text: outcome.text || NETWORK_UNCONFIRMED_MESSAGE,
            };
          } else {
            const unknownTerminalState = Boolean(outcome.conflict && outcome.code === "qitem_already_terminal" && !outcome.currentState && typeof conflictReadSeq === "number");
            box.result = {
              ok: false,
              conflict: Boolean(outcome.conflict),
              tokenProtected: Boolean(outcome.tokenProtected),
              daemonRefused: Boolean(outcome.daemonRefused),
              unconfirmed: Boolean(outcome.unconfirmed),
              notSent: Boolean(outcome.notSent || outcome.stepNotSent || (outcome.settingsChanged && !outcome.unconfirmed)), // refused before the step left: the text already says what was and was not sent
              ...(unknownTerminalState ? {
                unknownTerminalState: true,
                refineMinSeq: conflictReadSeq,
                expectedState: expectedState ?? null,
                stepsCompleted: outcome.stepsCompleted ?? 0,
                totalSteps: outcome.totalSteps ?? 1,
              } : {}),
              text: outcome.text || "It didn't work, and the daemon gave no reason.",
            };
          }
        }
      } catch (_e) {
        box.busy = false;
        box.stepProgress = null;
        box.result = this.cardFailure(_e, act, posted);
      }
      cx.notify();
    });
  }

  /** Called only after a confirmed action; the local receipt survives removal from attention. */
  sentNeedConfirmation(item, queueRow, act) {
    const questions = questionsState(item, queueRow).questions;
    const labels = (act.choices ?? []).map(c => questions.find(q => q.id === c.questionId)?.options.find(o => o.id === c.optionId)?.label ?? c.optionId);
    const words = String(act.decision ?? act.text ?? (labels.length ? labels.join("; ")
      : act.mode === "approve" ? "Approved" : act.mode === "deny" ? "Denied" : "Answers sent")).trim();
    return `Sent: ${words}${/[.!?]$/.test(words) ? "" : "."}`;
  }

  /** Sends the own-words box via `POST /api/mission-control/action`. */
  sendReply(cx, box) {
    const text = box.input.value().trim();
    if (box.busy || !text) return;
    const n = box.target;
    const qid = n?.qitemId ?? (String(n?.id ?? "").startsWith("queue:") ? String(n.id).slice(6) : null);
    const cache = this.cacheFor(adoptConnection(this.config, n?.conn) ?? this.activeConnId()); // the request's own OpenRig's reads, not the page shown now
    const queueRow = qid ? cache[`/api/queue/${encodeURIComponent(qid)}`]?.data : null;
    const detailItem = cache[`/api/attention?item=${encodeURIComponent(n.id)}`]?.data?.detail?.item ?? null;
    const snap = box.composerSnapshot ?? null;
    const snapOpts = snap ? { expectedRevision: snap.revision, expectedState: snap.state, snapshotHadRow: snap.hadRow } : {};
    if (box.denying) {
      this.submitCardDecision(cx, n, detailItem, queueRow, { mode: "deny", decision: text, ...snapOpts });
      return;
    }
    if (n?.reply === "resolve" || n?.verb === "resolve") {
      this.submitCardDecision(cx, n, detailItem, queueRow, { mode: "resolve", decision: text, ...snapOpts });
      return;
    }
    this.submitCardDecision(cx, n, detailItem, queueRow, { mode: "freeform", decision: text, ...snapOpts });
  }

  replyBox(t, cx, n, { detailItem = null, queueRow = null, onSomeoneAskText = null } = {}) {
    const box = this.replyFor(cx, n);
    if (!box) return this.dim(t, "…");
    box.target = { ...n, ...(detailItem ?? {}), ...(queueRow ? { decisionRevision: queueRow.decisionRevision ?? n.decisionRevision } : {}) };
    const isResolve = n.reply === "resolve" || n.verb === "resolve";
    const isDenying = Boolean(box.denying);
    const hasReasonText = Boolean(box.input.value().trim());
    const askerLabel = n.asker ?? detailItem?.asker ?? queueRow?.sourceSession ?? "the asking seat";
    const sendLabel = box.busy
      ? (isDenying ? "Denying…" : isResolve ? "Resolving…" : "Answering…")
      : isDenying
        ? "Deny with this reason"
        : box.confirmResolve
          ? "Confirm?"
          : isResolve
            ? "Resolve with these words"
            : "Send as my answer";
    const mac = window()?.platform === "macos";
    const r = box.result;
    return v_flex().id(`need-reply-${n.id}`).gap(6)
      // Clicks and keys typed here are the reply's: stop left-mouse-down from bubbling to rig-view-root's handle.focus().
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_key_down((e, cx) => {
        if (e.key === "escape") { cx.stop_propagation(); this.closeReply(cx, box, n); }
        else this.typing = true;
      })
      .when(isDenying, (el) => el.child(div().text_size(11.5).font_semibold().text_color(t.blocked).child(`Deny closes this request as denied. ${askerLabel} gets your reason.`)))
      .child(div().border_1().border_color(isDenying ? t.blocked : t.border).rounded(6).p(6).child(Textarea.new(box.input).h(72)))
      .child(h_flex().gap(8).items_center().flex_wrap()
        // Resolve asks once before sending (`Confirm?`); Ctrl+Enter sends at once.
        .child(this.button(t, isDenying ? `need-deny-confirm-${n.id}` : `need-send-${n.id}`, sendLabel, (_e, cx) => {
          if (isResolve && !isDenying && !box.confirmResolve && !box.busy && box.input.value().trim()) {
            box.confirmResolve = true;
            cx.notify();
            return;
          }
          box.confirmResolve = false;
          this.sendReply(cx, box);
        }, { primary: true, iconName: "rig-reply", disabled: box.busy || (isDenying && !hasReasonText), tooltip: onSomeoneAskText, tip: `${isDenying ? "Send the no" : "Send"} to ${askerLabel}` }))
        .child(this.button(t, `need-cancel-${n.id}`, isDenying ? "Back" : "Cancel", (_e, cx) => {
          this.closeReply(cx, box, n);
        }, { disabled: box.busy, tip: isDenying ? "Back to the answer choices; nothing is sent" : "Close the reply box; your text is kept as a draft" }))
        .when(!isDenying && Boolean(box.input.value()), el => el.child(this.button(t, `need-discard-${n.id}`,
          box.discardDraftUntil > Date.now() && box.discardDraftText === box.input.value() ? "Click again to discard" : "Discard draft",
          (_e, cx) => this.discardReply(cx, box, n),
          { disabled: box.busy, tip: "Throw away your reply; asks you to click again first" })
          .bg("#00000000").border_color("#00000000").text_color(box.busy ? t.dim : t.muted)))
        .child(this.dim(t, `${mac ? "⌘ Return" : "Ctrl+Enter"} sends · the text is kept until you send or discard it`)))
      .when(!!r, (el) => el.child(v_flex().gap(4)
        .child(h_flex().gap(6).items_center().child(svg(icon(r.ok ? "check" : "rig-alert")).size(12).flex_none().text_color(r.ok ? t.working : t.blocked))
          .child(div().flex_1().text_size(12).text_color(r.ok ? t.muted : t.blocked).child(r.ok ? r.text : this.errorText(t,`reply-result-error-${n.id}`,r.text))))
        .when(!r.ok && !r.conflict && !r.tokenProtected && !r.daemonRefused && !r.unconfirmed && !r.networkError && !r.notSent, (c) => c.child(this.dim(t, "It may still have arrived: check the request before answering again.")))
        .when(!r.ok && Boolean(r.networkError && r.retryAct), (c) => c.child(
          h_flex().child(this.button(
            t,
            `need-check-and-finish-${n.id}`,
            "Check and finish",
            (_e, cx) => {
              if (!box.busy) this.submitCardDecision(cx, box.target ?? n, detailItem, queueRow, r.retryAct);
            },
            { small: true, iconName: "rig-refresh", disabled: box.busy, tip: "The send may not have arrived: check and finish it without sending twice" },
          ))
        ))));
  }

  toggleNotifications(cx) {
    const cur = (shared("rig.settings")?.notifications ?? true) !== false;
    const next = !cur;
    setShared("rig.settings", { ...(shared("rig.settings") ?? {}), notifications: next });
    cx?.notify?.();
    return next;
  }

  /** Rig page → System → Layout: "Keep my layout when OpenRig opens views" (rig.settings.restoreLayout, default on). Turning it on
   *  applies from OpenRig's next open; the card's Back covers a Rig layout already shown. */
  toggleRestoreLayout(cx) {
    const next = !restoreLayoutOn(shared);
    setShared("rig.settings", { ...(shared("rig.settings") ?? {}), restoreLayout: next });
    cx?.notify?.();
    return next;
  }

  restoreLayoutPill(t) {
    const on = restoreLayoutOn(shared);
    return h_flex().id("system-restore-layout-toggle").px(8).h(24).gap(6).rounded(6).items_center().flex_none().cursor_pointer()
      .tooltip(on ? "Leave OpenRig's Rig layout on screen when it opens views" : "Switch back to your layout when OpenRig opens views")
      .bg(t.raised).border_1().border_color(t.border).hover((s) => s.bg(t.hover))
      .text_size(11.5).text_color(on ? t.foreground : t.dim)
      .on_click((_e, cx) => this.toggleRestoreLayout(cx))
      .child(div().w(13).h(13).flex_none().rounded(3).border_1().border_color(on ? t.accent : t.border).flex().items_center().justify_center()
        .when(on, (box) => box.bg(t.accent).child(svg(icon("check")).size(10).text_color(t.solid_foreground ?? t.background))))
      .child(on ? "On" : "Off");
  }

  notifyTogglePill(t, id = "needs-notify-toggle") {
    const on = (shared("rig.settings")?.notifications ?? true) !== false;
    return h_flex().id(id).px(8).h(24).gap(6).rounded(6).items_center().flex_none().cursor_pointer().tooltip(`Turn herdrig's notifications ${on ? "off" : "on"}`)
      .bg(t.raised).border_1().border_color(t.border).hover((s) => s.bg(t.hover))
      .text_size(11.5).text_color(on ? t.foreground : t.dim)
      .on_click((_e, cx) => this.toggleNotifications(cx))
      .child(div().w(13).h(13).flex_none().rounded(3).border_1().border_color(on ? t.accent : t.border).flex().items_center().justify_center()
        .when(on, (box) => box.bg(t.accent).child(svg(icon("check")).size(10).text_color(t.solid_foreground ?? t.background))))
      .child(svg(icon("bell")).size(12).flex_none().text_color(on ? t.foreground : t.dim))
      .child(on ? "On" : "Off");
  }

  refreshUsageHosts(cx) {
    if (this.usageRefreshing || !this.config) return;
    this.usageRefreshing = true;
    this.usageRefreshNote = null;
    const noteConn = this.activeConnId(), refreshCfg = this.activeConfig(); // the note and re-reads belong to THIS page's OpenRig
    const say = (note) => { this.usageRefreshNote = { ...note, conn: noteConn }; };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (!refreshCfg) { say({ ok: false, text: "This page's OpenRig is no longer set up, so nothing was refreshed." }); return; }
        const op = gatedOperationOrRefusal(refreshCfg.connectionId); // the page's own connection, never the followed one
        const daemonUrl = await this.resolveDaemonUrl(refreshCfg);
        if (!daemonUrl) {
          say({ ok: false, text: "The daemon address isn't known yet." });
          return;
        }
        const r = await op.fetch(`${daemonUrl}/api/provider/usage/hosts/refresh`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ providers: ["codex", "claude"] }),
        });
        let data = null; try { data = JSON.parse(await r.text()); } catch (e) { data = rethrowGate(null)(e); }
        if (r.status === 409 || isUsageWindowsDisabled({ status: r.status, data, error: data?.error })) {
          say({ ok: false, text: "Usage windows are off (provider.usage_windows = false)." });
        } else if (!r.ok) {
          say({ ok: false, text: data?.error ?? data?.message ?? `OpenRig couldn't refresh usage (error ${r.status}). The readings shown are from before.` });
        } else {
          const refreshLegs = Array.isArray(data?.refresh) ? data.refresh : (Array.isArray(data?.results) ? data.results : []);
          const hostEntries = Array.isArray(data?.hosts) ? data.hosts : [];
          const failedLeg = refreshLegs.find((l) => l && (l.ok === false || l.error || l.status === "failed" || l.status === "unreachable"))
            ?? hostEntries.find((h) => h && (h.ok === false || h.error || h.status === "unreachable" || h.status === "failed"));
          if (failedLeg) {
            const detail = failedLeg.error ?? failedLeg.reason ?? failedLeg.status ?? null;
            say({
              ok: false,
              text: detail ? `Refreshed (some hosts/providers failed: ${errorDiagnostic(detail)}).` : "Refreshed (some hosts/providers failed).",
            });
          } else {
            say({ ok: true, text: "Refreshed." });
          }
        }
        const rereadCfg = configOfConnection(this.config, refreshCfg.connectionId);
        if (rereadCfg) {
          this.read(cx, "/api/provider/usage", true, null, rereadCfg);
          const ownCache = this.cacheFor(rereadCfg.connectionId);
          if (ownCache["/api/provider/usage/hosts"] || (shared("rig.open.page") ?? {})["usage:hosts"] || (shared("rig.open.page") ?? {})["sys:usage-hosts"]) {
            this.read(cx, "/api/provider/usage/hosts", true, null, rereadCfg);
          }
        }
      } catch (e) {
        say({ ok: false, text: errorDiagnostic(e) });
      } finally {
        this.usageRefreshing = false;
        cx.notify();
      }
    });
  }

  usageDisabledNote(t) {
    return h_flex().id("usage-windows-disabled").gap(8).items_center().flex_wrap()
      .child(this.dim(t, "Usage windows are off (provider.usage_windows = false)."))
      .child(this.button(t, "usage-open-config", "Open config", () => {
        this.editShownStack((stack) => [...stack.slice(0, -1), { ...(stack.at(-1) ?? { section: "system" }), section: "system", settingKey: "provider.usage_windows" }]);
      }, { small: true, tip: "Open the setting that turns usage on" }));
  }

  usageHostsBlock(t, cx) {
    const got = this.read(cx, "/api/provider/usage/hosts");
    if (isUsageWindowsDisabled(got)) return this.usageDisabledNote(t);
    const wait = this.status(t, cx, "/api/provider/usage/hosts", got);
    if (wait) return wait;
    const hosts = normalizeUsageHosts(got.data);
    if (!hosts.length) return this.dim(t, "No per-host usage records.");
    return v_flex().id("usage-hosts-list").gap(8).children(hosts.map((h) => {
      const hid = h.hostId;
      const allowances = h.allowances ?? [];
      const observations = h.observations ?? [];
      const notes = h.notes ?? [];
      return v_flex().id(`usage-host-${hid}`).rounded(8).bg(t.raised).border_1().border_color(t.border).p(10).gap(6)
        .child(h_flex().gap(8).items_center()
          .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child(h.label))
          .child(div().px(6).h(18).rounded(4).flex().items_center().bg(t.background).text_size(11).text_color(h.error ? t.blocked : t.muted).child(statusWord(h.status ?? "online","daemon")))
          .when(!!h.usageReason, (el) => el.child(div().px(6).h(18).rounded(4).flex().items_center().bg(t.background).text_size(11).text_color(t.dim).child(h.usageReason)))
          .child(div().flex_1())
          .when(!!h.readAt, (el) => el.child(this.dim(t, `as of ${this.time(h.readAt,{exact:true})}`))))
        .when(!!h.error, (el) => el.child(h_flex().id(`usage-host-error-${hid}`).gap(8).items_center()
          .child(div().flex_1().text_size(12).text_color(t.blocked).child(this.errorText(t,"usage-host-error",h.error)))
          .child(this.button(t, `usage-host-retry-${hid}`, "Retry", (_e, cx) => this.refreshUsageHosts(cx), { small: true, tip: "Read this host's usage again" }))))
        .when(notes.length > 0, (el) => el.child(v_flex().gap(2).children(notes.map((n, ni) =>
          div().id(`usage-host-note-${hid}-${ni}`).text_size(11.5).text_color(t.muted).child(String(n))
        ))))
        .when(allowances.length > 0, (el) => el.child(v_flex().gap(4).children(allowances.map((a, ai) => {
          const pct = typeof a.utilizationPercent === "number" ? a.utilizationPercent : (typeof a.usedPercent === "number" ? a.usedPercent : null);
          const bar = usagePercentBar(pct) ?? (a.unknownReason ? String(a.unknownReason) : "—");
          const tone = usageWindowTone({ usedPercent: pct, state: a.state, anomalies: a.anomalies, unknownReason: a.unknownReason });
          const color = tone === "blocked" ? t.blocked : (tone === "warn" || tone === "warning") ? t.ansi3 : tone === "muted" ? t.muted : t.foreground;
          const isConflict = a.linkage === "conflict" || (Array.isArray(a.anomalies) && a.anomalies.includes("conflict"));
          return h_flex().id(`usage-allowance-${hid}-${ai}`).gap(8).items_center().text_size(12)
            .child(div().w(100).flex_none().truncate().text_color(t.muted).tooltip(String(String(a.provider ?? "")??"")).child(String(a.provider ?? "")))
            .child(div().w(90).flex_none().truncate().text_color(t.dim).tooltip(String(String(a.windowLabel ?? a.window ?? a.id ?? "window")??"")).child(String(a.windowLabel ?? a.window ?? a.id ?? "window")))
            .child(div().w(150).flex_none().truncate().text_color(color).tooltip(String(bar??"")).child(bar))
            .when(!!a.sharedAcrossProviders, (rowEl) => rowEl.child(div().px(5).h(16).rounded(4).flex().items_center().bg(t.background).text_size(10.5).text_color(t.muted).child("shared")))
            .when(isConflict, (rowEl) => rowEl.child(this.chip(t, { tone: "blocked", word: "conflict" })))
            .child(div().flex_1().min_w(0).truncate().text_right().text_color(t.dim).tooltip(String(this.time(a.resetsAt,{exact:true})??"")).child(this.time(a.resetsAt,{exact:true})));
        }))))
        .when(observations.length > 0, (el) => el.child(v_flex().gap(2).pt(2).border_t(1).border_color(t.border).children(observations.map((o, oi) =>
          h_flex().id(`usage-obs-${hid}-${oi}`).gap(8).items_center().text_size(11.5).text_color(t.muted)
            .child(div().w(100).flex_none().truncate().text_color(t.foreground).tooltip(statusWord(o.runtime ?? "","runtime")).child(statusWord(o.runtime ?? "","runtime")))
            .child(div().w(140).flex_none().truncate().tooltip(String(String(o.accountLabel ?? o.account ?? "")??"")).child(String(o.accountLabel ?? o.account ?? "")))
            .child(div().w(90).flex_none().truncate().text_color(t.dim).tooltip(statusWord(o.status ?? "","seat")).child(statusWord(o.status ?? "","seat")))
            .child(div().flex_1().min_w(0).truncate().text_right().text_color(t.dim).tooltip(String(this.time(o.lastObservedAt ?? o.updatedAt,{exact:true})??"")).child(this.time(o.lastObservedAt ?? o.updatedAt,{exact:true})))
        ))));
    }));
  }

  runPeopleAction(cx, subargs, entityId = null) {
    if (this.peopleBusy) return;
    const resultConn = this.activeConnId(); // the result is about THIS page's OpenRig: another OpenRig's page never shows it
    const config = this.activeConfig(); // the connection the page shows: its CLI, its home; none when it is no longer set up
    if (!config) { this.peopleResult = { ok: false, text: UNKNOWN_CONNECTION, conn: resultConn }; return; } // never another connection's CLI
    const personReason = personDisableReason("people", config);
    if (personReason) {
      this.peopleResult = { ok: false, text: personReason, conn: resultConn };
      cx.notify();
      return;
    }
    const cmd = peopleCliCommand(config, subargs);
    if (!cmd) {
      this.peopleResult = { ok: false, text: NO_PERSON, conn: resultConn };
      cx.notify();
      return;
    }
    const actionConn = config.connectionId ?? LEGACY_CONNECTION_ID;
    const actionCache = this.cacheFor(actionConn);
    const priorActiveAppId = entityId
      ? (actionCache[`/api/gateway/human/${encodeURIComponent(entityId)}/mode`]?.data?.current?.applicationId
        ?? actionCache[`/api/gateway/human/${encodeURIComponent(entityId)}/modes`]?.data?.current?.applicationId
        ?? this.awayState("rig.lastActiveModeApplicationId", actionConn)
        ?? null)
      : (this.awayState("rig.lastActiveModeApplicationId", actionConn) ?? null);
    this.peopleBusy = true;
    this.peopleResult = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let r;
      let rawRes = null;
      try {
        rawRes = await execFor(config)(cmd.command, cmd.args, { timeout: 60000 });
        r = writeOutcome(rawRes);
      } catch (e) {
        const unsent = isKnownUnsentError(e);
        const line = unsent ? unsentErrorMessage(e).trimEnd() : plainExecError(e, { kind: "write" });
        r = { ok: false, ...(unsent ? { notSent: true } : {}), text: unsent && !/nothing was (?:sent|changed)/i.test(line) ? `${line} Nothing was sent.` : line };
      }
      this.peopleBusy = false;
      this.peopleResult = { ok: r.ok, text: r.text || (r.ok ? "Updated." : "That didn't work, and OpenRig gave no reason. Nothing was changed."), conn: resultConn };
      if (r.ok) {
        const rereadCfg = configOfConnection(this.config, actionConn);
        if (!rereadCfg) { cx.notify(); return; } // the completed action's connection was removed; no state or reads belong to it now
        let parsedStdout = null;
        try { parsedStdout = JSON.parse(String(rawRes?.stdout ?? "").trim()); } catch (_) { parsedStdout = null; }
        if (subargs[0] === "mode" && subargs[1] === "apply") {
          const appliedAppId = parsedStdout?.application?.applicationId ?? null;
          const endedAppId = parsedStdout?.ended?.applicationId ?? null;
          const patch = {};
          if (appliedAppId) patch.lastActiveModeApplicationId = appliedAppId;
          if (endedAppId) {
            this.setAwayDismissed(false, actionConn);
            patch.lastEndedModeApplicationId = endedAppId;
          }
          if (Object.keys(patch).length > 0) this.persistStatePatch(cx, patch, actionConn);
        } else if (subargs[0] === "mode" && subargs[1] === "end") {
          const endedAppId = parsedStdout?.ended?.applicationId ?? priorActiveAppId ?? null;
          this.setAwayDismissed(false, actionConn);
          this.persistStatePatch(cx, {
            lastEndedModeApplicationId: endedAppId,
            lastActiveModeApplicationId: null,
          }, actionConn);
        }
        refreshSidebar();
        if (entityId) {
          this.read(cx, `/api/gateway/human/${encodeURIComponent(entityId)}/quiet`, true, null, rereadCfg);
          this.read(cx, `/api/gateway/human/${encodeURIComponent(entityId)}/modes`, true, null, rereadCfg);
          this.read(cx, `/api/gateway/human/${encodeURIComponent(entityId)}/mode`, true, null, rereadCfg);
          this.read(cx, `/api/gateway/human/${encodeURIComponent(entityId)}/readiness`, true, null, rereadCfg);
          this.read(cx, `/api/gateway/human/${encodeURIComponent(entityId)}/decision-room`, true, null, rereadCfg);
        }
        this.read(cx, "/api/gateway/participants", true, null, rereadCfg);
        this.read(cx, "/api/gateway/connections", true, null, rereadCfg);
      }
      cx.notify();
    });
  }

  peopleSection(t, cx, conn) {
    const participants = this.read(cx, "/api/gateway/participants");
    const rawHumans = [
      ...((participants.data?.participants ?? []).filter((p) => p?.kind === "human" || String(p?.address ?? "").endsWith("@external"))),
      ...((conn?.data?.humans ?? [])),
    ];
    const seenIds = new Set();
    const humans = [];
    for (const h of rawHumans) {
      const id = String(h?.entityId ?? h?.id ?? (h?.address ? String(h.address).replace(/@external$/, "") : "")).trim();
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      humans.push({ entityId: id, address: h?.address ?? `${id}@external`, record: h });
    }
    const pageCfg = this.activeConfig();
    const configPersonRaw = typeof pageCfg?.person === "string" ? pageCfg.person.trim() : "";
    const configPersonId = /^[^@\s]+@external$/.test(configPersonRaw) ? configPersonRaw.replace(/@external$/, "") : null;
    if (configPersonId && !seenIds.has(configPersonId)) {
      seenIds.add(configPersonId);
      humans.unshift({ entityId: configPersonId, address: configPersonRaw, record: null });
    }
    const activeId = this.selectedPersonId && seenIds.has(this.selectedPersonId)
      ? this.selectedPersonId
      : (configPersonId ?? humans[0]?.entityId ?? null);
    const activeHuman = humans.find((h) => h.entityId === activeId) ?? null;

    const readiness = activeId ? this.read(cx, `/api/gateway/human/${encodeURIComponent(activeId)}/readiness`) : null;
    const quiet = activeId ? this.read(cx, `/api/gateway/human/${encodeURIComponent(activeId)}/quiet`) : null;
    const modes = activeId ? this.read(cx, `/api/gateway/human/${encodeURIComponent(activeId)}/modes`) : null;
    const mode = activeId ? this.read(cx, `/api/gateway/human/${encodeURIComponent(activeId)}/mode`) : null;
    const decisionRoom = activeId ? this.read(cx, `/api/gateway/human/${encodeURIComponent(activeId)}/decision-room`) : null;

    const readinessObj = readiness?.data?.readiness ?? readiness?.data ?? null;
    const isOtherPerson = Boolean(configPersonId && activeId && activeId !== configPersonId);
    const otherName = activeHuman?.record?.displayName ?? activeId ?? "that person";
    const actorAddr = configPersonId ? `${configPersonId}@external` : (activeHuman?.address ?? (activeId ? `${activeId}@external` : "you"));
    const deadNotice = activeId ? deadBindingNotice(activeId, readinessObj, activeHuman?.record, {
      isOtherPerson,
      displayName: otherName,
    }) : null;
    const personReason = personDisableReason("people", pageCfg);
    const editDisabled = this.peopleBusy || !!personReason || isOtherPerson;
    const editTooltip = isOtherPerson ? `Only ${otherName} changes ${otherName}'s quiet hours and modes.` : personReason;
    const quietState = quiet?.data?.state ?? quiet?.data ?? null;
    const quietWin = quiet?.data?.window ?? null;
    const isQuietActive = Boolean(quietState?.active);
    const curMode = mode?.data?.current ?? modes?.data?.current ?? (mode?.data?.modeName ? mode.data : null);
    const peopleConn = this.awayConnId();
    if (!isOtherPerson && peopleConn && curMode?.applicationId && this.awayState("rig.lastActiveModeApplicationId", peopleConn) !== curMode.applicationId) {
      this.persistStatePatch(cx, { lastActiveModeApplicationId: curMode.applicationId }, peopleConn);
    }
    const rawSavedModes = [
      ...(Array.isArray(modes?.data?.modes) ? modes.data.modes : []),
      ...(Array.isArray(modes?.data?.saved) ? modes.data.saved : []),
      ...(Array.isArray(modes?.data?.presets) ? modes.data.presets : []),
      ...(Array.isArray(modes?.data) ? modes.data : []),
    ];
    const seenModeNames = new Set();
    const savedModes = rawSavedModes.filter((m) => {
      const mName = String(m?.name ?? m?.modeName ?? "").trim();
      if (!mName || seenModeNames.has(mName)) return false;
      seenModeNames.add(mName);
      return true;
    });
    const hasReadyConnector = readinessObj?.state === "ready";
    const hasBindingOnPerson = Boolean(
      readinessObj?.connector?.kind ||
      readinessObj?.connector?.ref ||
      activeHuman?.record?.bindings?.primary ||
      (Array.isArray(activeHuman?.record?.connectorBindings) && activeHuman.record.connectorBindings.length > 0)
    );
    const readinessLabel = readinessObj?.state === "not-ready" && !hasBindingOnPerson
      ? "Feed & Steering only (no connector)"
      : (readinessObj?.state ?? (readiness?.loading ? "reading…" : "unconfigured"));
    const chip = quietModeHeaderChip({ quiet: quiet?.data, mode: mode?.data, timezone:this.uiTimezone });
    const rawRoom = curMode?.settings?.decisionRoom?.words
      ?? curMode?.settings?.decision?.room
      ?? curMode?.decisionRoom?.words
      ?? (typeof curMode?.decisionRoom === "string" ? curMode.decisionRoom : null)
      ?? decisionRoom?.data?.decisionRoom?.words
      ?? (typeof decisionRoom?.data?.decisionRoom === "string" ? decisionRoom.data.decisionRoom : null)
      ?? decisionRoom?.data?.activeRoom?.roomId
      ?? null;
    const decisionRoomWords = typeof rawRoom === "string" && rawRoom.trim() ? rawRoom.trim() : null;

    return v_flex().id("system-people-section").child(
      v_flex().id("system-people-card").min_w(0).rounded(10).bg(t.background).border_1().border_color(t.border).p(pageBodyLayout(this.pageWidth).tight ? 10 : 12).gap(10)
        .child((pageBodyLayout(this.pageWidth).compact ? v_flex() : h_flex()).id("people-title-row").gap(8).when(!pageBodyLayout(this.pageWidth).compact, el => el.items_center())
          .child(div().min_w(0).when(pageBodyLayout(this.pageWidth).compact, el => el.w_full()).when(!pageBodyLayout(this.pageWidth).compact, el => el.flex_1()).text_size(12.5).font_semibold().text_color(t.foreground).child("People · Quiet Hours & Modes"))
          .when(!!chip, (el) => el.child(div().id("people-active-chip").px(8).h(20).rounded(5).flex().items_center().bg(t.selected).text_size(11).font_medium().text_color(t.foreground).child(`${chip.glyph} ${chip.label}`))))
        .child(this.kv(t, [
          ["Acting as", configPersonId ? `${configPersonId}@external` : "this terminal (human@host (unattributed))"],
          ["Registered people", humans.length ? humans.map((h) => h.address).join(", ") : "none"],
          ...(activeId ? [["Delivery readiness", readinessLabel]] : []),
        ]))
        .when(humans.length > 1, (el) => el.child(h_flex().id("people-selector").gap(6).items_center().flex_wrap()
          .children(humans.map((h) => {
            const on = h.entityId === activeId;
            return h_flex().id(`people-select-${h.entityId}`).px(8).h(22).rounded(5).items_center().cursor_pointer().tooltip(`Show ${h.address}'s quiet hours and modes`)
              .bg(on ? t.accent : t.raised).border_1().border_color(on ? t.accent : t.border)
              .text_size(11.5).text_color(on ? (t.solid_foreground ?? t.background) : t.muted)
              .on_click((_e, cx) => { this.selectedPersonId = h.entityId; cx.notify(); })
              .child(h.address);
          }))))
        .when(isOtherPerson, (el) => el.child(
          div().id("people-other-person-note").text_size(11.5).text_color(t.dim).child(
            `Only ${otherName} changes ${otherName}'s quiet hours and modes.`
          )
        ))
        .when(!!deadNotice, (el) => el.child(
          v_flex().id(`people-dead-binding-${activeId}`).rounded(8).bg(t.raised).border_1().border_color(t.ansi3 ?? t.border).p(10).gap(4)
            .child(div().id("people-dead-binding-notice").text_size(12).text_color(t.foreground).child(deadNotice))
        ))
        .when(!!personReason, (el) => el.child(
          div().id("people-no-person-note").text_size(11.5).text_color(t.dim).child(personReason)
        ))
        .when(!!activeId, (el) => el.child(
          v_flex().id("people-quiet-card").rounded(8).bg(t.raised).border_1().border_color(t.border).p(pageBodyLayout(this.pageWidth).tight ? 6 : 10).gap(8)
            .child((pageBodyLayout(this.pageWidth).compact ? v_flex() : h_flex()).id("people-quiet-title").gap(8).when(!pageBodyLayout(this.pageWidth).compact, el => el.items_center())
              .child(div().when(!pageBodyLayout(this.pageWidth).compact, el => el.flex_1()).text_size(12).font_semibold().text_color(t.foreground).child("Quiet hours"))
              .child(div().text_size(11.5).text_color(isQuietActive ? t.accent : t.muted).child(
                isQuietActive
                  ? (chip?.kind === "quiet" ? chip.label : "Quiet active")
                  : quietWin?.start && quietWin?.end
                    ? `Daily ${quietWin.start}–${quietWin.end}${quietWin.timezone ? ` (${quietWin.timezone})` : ""} · not in quiet hours`
                    : "At desk (off)"
              )))
            .child(div().id("people-quiet-honest-note").text_size(11.5).text_color(t.dim).child(
              hasReadyConnector
                ? "While quiet, routine requests wait and post when it ends. Escalations still reach you."
                : "OpenRig posts nothing to you, so it has nothing to hold. While quiet, this mod holds its own toasts for routine requests and shows them when quiet ends. Escalations still show. Requests stay in Needs either way."
            ))
            .child(h_flex().gap(6).items_center().flex_wrap()
              .children([1, 2].map(hours => this.button(t, `people-quiet-until-${hours}h`, `Quiet for ${hours}h`, (_e, cx) => {
                const until = new Date(Date.now() + hours * 3600_000).toISOString();
                this.runPeopleAction(cx, ["quiet", "set", activeId, "--until", until], activeId);
              }, { small: true, disabled: editDisabled, tooltip: editTooltip, tip: `Quiet for ${hours} hour${hours === 1 ? "" : "s"}: notifications wait until then` })))
              .child(this.button(t, "people-quiet-daily", "Daily 22:00–08:00", (_e, cx) => {
                const daily = `${this.peopleForm.quietStart || "22:00"}-${this.peopleForm.quietEnd || "08:00"}`;
                this.runPeopleAction(cx, ["quiet", "set", activeId, "--daily", daily], activeId);
              }, { small: true, disabled: editDisabled, tooltip: editTooltip, tip: "Set daily quiet hours" }))
              .when(isQuietActive, (bEl) => bEl.child(
                this.button(t, `people-quiet-end-${activeId}`, "I'm back", (_e, cx) => {
                  this.runPeopleAction(cx, ["quiet", "end", activeId], activeId);
                }, { primary: true, small: true, disabled: editDisabled, tooltip: editTooltip, tip: "End quiet hours now" })
              ))
              .when(Boolean(quietWin || isQuietActive), (bEl) => bEl.child(
                this.button(t, `people-quiet-clear-${activeId}`, "Remove", (_e, cx) => {
                  this.runPeopleAction(cx, ["quiet", "clear", activeId], activeId);
                }, { small: true, disabled: editDisabled, tooltip: editTooltip, tip: "Clear these quiet hours" })
              )))
        ))
        .when(!!activeId, (el) => el.child(
          v_flex().id("people-modes-card").rounded(8).bg(t.raised).border_1().border_color(t.border).p(pageBodyLayout(this.pageWidth).tight ? 6 : 10).gap(8)
            .child((pageBodyLayout(this.pageWidth).compact ? v_flex() : h_flex()).id("people-mode-title").gap(8).when(!pageBodyLayout(this.pageWidth).compact, el => el.items_center())
              .child(div().when(!pageBodyLayout(this.pageWidth).compact, el => el.flex_1()).text_size(12).font_semibold().text_color(t.foreground).child("Modes"))
              .child(div().text_size(11.5).text_color(curMode ? t.accent : t.muted).child(
                curMode?.modeName
                  ? `${curMode.modeName}${curMode.settings?.decision?.policy ? ` · ${statusWord(curMode.settings.decision.policy, "policy")}` : ""}`
                  : "At desk (no mode active)"
              ))
              .when(Boolean(curMode?.modeName), (mEl) => mEl.child(
                this.button(t, `people-mode-end-${activeId}`, "I'm back", (_e, cx) => {
                  this.runPeopleAction(cx, ["mode", "end", activeId], activeId);
                }, { primary: true, small: true, disabled: editDisabled, tooltip: editTooltip, tip: "End this mode now" })
              )))
            .when(Boolean(decisionRoomWords), (rEl) => rEl.child(
              v_flex().id("people-decision-room-note").gap(2)
                .child(div().text_size(11).font_semibold().text_color(t.muted).child("The team may decide for you:"))
                .child(div().text_size(11.5).text_color(t.foreground).child(String(decisionRoomWords)))
            ))
            .children(savedModes.length ? savedModes.map((m) => {
              const mName = String(m?.name ?? m?.modeName ?? "");
              const mPolicy = m?.settings?.decision?.policy ?? m?.policy ?? (m?.decisionRoom?.words || m?.settings?.decisionRoom?.words ? "auto_decide" : "hold");
              const mBack = m?.availability?.expectedBack ?? m?.settings?.availability?.expectedBack ?? m?.expectedBack ?? null;
              const needsUntil = m?.delivery?.quiet?.kind === "until-end"
                || m?.settings?.delivery?.quiet?.kind === "until-end"
                || m?.quiet === "until-end";
              return h_flex().id(`people-mode-row-${mName}`).px(8).h(28).gap(8).items_center().rounded(6).bg(t.background).border_1().border_color(t.border)
                .child(div().flex_1().min_w(0).truncate().text_size(12).font_medium().text_color(t.foreground).tooltip(String(mName??"")).child(mName))
                .child(div().text_size(11.5).text_color(t.muted).child(`${statusWord(mPolicy, "policy")}${mBack ? ` · back ${mBack}` : ""}`))
                .child(this.button(t, `people-mode-preset-${activeId}-${mName}`, "Apply", (_e, cx) => {
                  const applyArgs = ["mode", "apply", activeId, mName];
                  if (needsUntil) {
                    applyArgs.push("--until", new Date(Date.now() + 7200_000).toISOString());
                  }
                  this.runPeopleAction(cx, applyArgs, activeId);
                }, { small: true, primary: curMode?.modeName !== mName, disabled: editDisabled, tooltip: editTooltip, tip: `Turn on ${mName}` }));
            }) : [this.dim(t, "No saved modes yet.")])
            .child(h_flex().gap(6).items_center().flex_wrap()
              .child(this.button(t, "people-mode-save-sleep", "Save sleep mode (hold)", (_e, cx) => {
                this.runPeopleAction(cx, ["mode", "save", activeId, "sleep", "--availability", "off", "--quiet", "22:00-08:00"], activeId);
              }, { small: true, disabled: editDisabled, tooltip: editTooltip, tip: `Save a Sleep mode for ${otherName}: away, with quiet hours 22:00 to 08:00` }))
              .child(this.button(t, "people-mode-save-focus", "Save focus mode (auto_decide)", (_e, cx) => {
                this.runPeopleAction(cx, [
                  "mode", "save", activeId, "focus",
                  "--availability", "focus",
                  "--expected-back", "in 2h",
                  "--quiet", "until-end",
                  "--decision-room", "Proceed on reversible routine work; escalate irreversible or prod-affecting changes.",
                ], activeId);
              }, { small: true, disabled: editDisabled, tooltip: editTooltip, tip: `Save a Focus mode for ${otherName}: focused, back in 2 h, quiet until it ends; seats go on with reversible routine work and ask first about anything irreversible` })))
            .child(this.dim(t, `Changes are made as ${actorAddr} with rig gateway human quiet and mode. OpenRig's quiet show and mode current show the same.`))
        ))
        .when(!!this.peopleResult && this.peopleResult.conn === this.activeConnId(), (el) => el.child(
          h_flex().id("people-action-result").gap(6).items_center()
            .child(svg(icon(this.peopleResult.ok ? "check" : "rig-alert")).size(12).flex_none().text_color(this.peopleResult.ok ? t.working : t.blocked))
            .child(div().flex_1().text_size(12).text_color(this.peopleResult.ok ? t.muted : t.blocked).child(this.peopleResult.ok ? this.peopleResult.text : this.errorText(t,"people-result-error",this.peopleResult.text)))
        )),
    );
  }

  /** An accent text link the keyboard can use (see focusTarget in rig-lib.js): Tab reaches it, it shows focus, and Enter or Space acts while
   *  it holds focus. */
  inlineLink(t, cx, id, label, act, tip = null) {
    return focusTarget(this, cx, id, div().id(id).text_size(12).text_color(t.accent).cursor_pointer().rounded(3).hover(el => el.underline()), act,
      el => el.underline().bg(t.hover), tip).child(label);
  }

  queueItemCard(t, cx, qid, destination = null, backControl = null) {
    if (!validHealthQitemId(qid)) return this.card(t, "Queue item", [this.dim(t, "Invalid queue item id. Choose a valid item.")]);
    const path = `/api/queue/${encodeURIComponent(qid)}`, queue = this.read(cx, path);
    const row = queue.data?.item ?? queue.data?.qitem ?? queue.data;
    const matches = (row?.qitemId ?? row?.id) === qid && (!destination || row.destinationSession === destination);
    const failure = this.status(t, cx, path, queue) ?? (matches ? null : this.dim(t, "Couldn't read queue item: OpenRig returned no matching row."));
    return this.card(t, "Queue item", [
      ...(backControl ? [backControl] : []),
      ...(failure ? [failure] : [this.copyValue(t, qid, "health-queue-id", "queue item id"),
        this.plain(t, row?.summary ?? "No summary reported.", "health-queue-summary"),
        this.kv(t, [["State", statusWord(row?.state ?? "not reported", "queue")], ["From", row?.sourceSession ?? "not reported"], ["To", row?.destinationSession ?? "not reported"]]),
        requestMarkdownView(row?.body ?? "No body reported.", { TextView, div, v_flex, id: "health-queue-body" }),
      ]),
    ]);
  }

  healthFindingsCard(t, cx, got, entry = {}) {
    // A health subject may belong to another seat or be closed; it needn't exist in human /api/attention.
    if (entry.healthQitem) {
      const back = { ...entry }; delete back.healthQitem;
      return this.queueItemCard(t, cx, entry.healthQitem, null,
        h_flex().child(this.button(t, "health-queue-back", "‹ Health", () => this.push(back), { small: true, tip: "Back to System › Health" })));
    }
    const findingId = entry.healthFinding;
    const showAll = () => this.button(t, "health-finding-back", "Show all findings", () => {
      const next = { ...entry }; delete next.healthFinding; this.push(next);
    }, { small: true });
    if (findingId) {
      const path = `/api/health/${encodeURIComponent(findingId)}`;
      const exact = this.read(cx, path);
      if (exact.status === 404) return this.card(t, "Health", [this.dim(t, "OpenRig did not report that finding."), showAll()]);
      const wait = this.status(t, cx, path, exact);
      if (wait || exact.data?.id !== findingId) return this.card(t, "Health", [
        wait ?? this.dim(t, "Couldn't read that finding: OpenRig returned a different result."), showAll(),
      ]);
      got = { data: { records: [exact.data] } };
    }
    if (got.error || (got.data !== undefined && !Array.isArray(got.data?.records))) return this.card(t, "Health", [
      this.dim(t, `Couldn't read health: ${got.error ?? "OpenRig returned no records list."}`),
      this.button(t, "health-retry", "Retry", (_e, ctx) => this.read(ctx ?? cx, "/api/health", true), { small: true, tip: "Read Health again from OpenRig" }),
    ]);
    if (got.data === undefined) return this.card(t, "Health", [this.dim(t, "Checking health…")]);
    const data = got.data, open = shared("rig.open.page") ?? {};
    // 0.7.11 omits cleared records from its default list. This optional read uses
    // the existing health cache/refresh, only on System → Health, never a timer.
    const history = entry.subview === "health" && !findingId ? this.read(cx, "/api/health?status=cleared") : null;
    const allRecords = mergeHealthHistory(data.records, history?.error ? null : history?.data);
    const rigs = this.read(cx, "/api/rigs/summary").data ?? this.pageRigData()?.topology ?? [];
    const nodes = { ...(this.pageRigData()?.nodesByRig ?? {}) };
    for (const id of new Set(allRecords.map(r => r.scope?.rigId).filter(Boolean))) nodes[id] = this.nodesOf(cx, id).data ?? nodes[id] ?? [];
    const rig = entry.healthRigId ? rigs.find(r => r.id === entry.healthRigId) ?? { id: entry.healthRigId, name: entry.healthRigName ?? entry.healthRigId } : null;
    const records = rig && !findingId ? healthForRig(allRecords, rig, nodes[rig.id] ?? [], true, true) : allRecords;
    const counts = healthCounts(records), groups = groupHealthRecords(records);
    const partial = (Array.isArray(data.coverage) ? data.coverage : data.coverage ? [data.coverage] : []).filter(c => c.partial);
    const coverage = partial.map(c => Number.isFinite(c.evaluated) && Number.isFinite(c.total) ? `partial check (${c.evaluated} of ${c.total})` : "partial check").join(" · ");
    const age = Math.max(...records.map(r => r.freshness?.ageSeconds).filter(Number.isFinite));
    const checked = typeof data.evaluatedAt === "string" ? `checked ${this.time(data.evaluatedAt)} · ${healthAge(age)}` : "Check time not reported";
    const plural = counted;
    const worstContext = groups.find(g => g.worst)?.records.find(r => r.detector === "context.pressure");
    const worstContextText = worstContext ? `${healthScopeTarget(worstContext, rigs, nodes).label.replace(/^Seat /, "")} at ${healthContextPercentage(worstContext)} context` : null;
    const summary = counts.problems ? `${plural(counts.problems, "problem")} need${counts.problems === 1 ? "s" : ""} a look. ${groups.find(g => g.worst)?.title ?? ""}.`
      : `No problems found.${counts.notes ? ` ${plural(counts.notes, "note")} available for reference.` : ""}`;
    const serverRows = rig ? [] : this.terminalServerRows(t, cx, rigs, nodes); // OpenRig 0.7.20: tmux servers it can't reach
    return this.card(t, `Health · ${plural(counts.problems, "problem")} · ${plural(counts.notes, "note")}`, [
      ...(findingId ? [showAll()] : []),
      ...serverRows,
      ...(rig ? [h_flex().id("health-rig-filter").gap(6).items_center().cursor_pointer().tooltip(`Show findings for every rig, not only ${rig.name}`)
        .on_click(() => this.push({ section: "system", subview: "health" }))
        .child(div().text_size(12).text_color(t.muted).child(rig.name))
        .child(svg(icon("x")).size(11).text_color(t.dim))] : []),
      this.plain(t, `${summary}${worstContextText ? ` · ${worstContextText}` : ""}${coverage ? ` · ${coverage}` : ""}`, "health-summary").text_color(t.muted),
      ...(history && (history.error || history.data !== undefined && !Array.isArray(history.data?.records))
        ? [this.dim(t,"Cleared history is unavailable on this OpenRig.")] : []),
      ...groups.map((g, index) => {
        const key = `sys:health:${g.key}`, shown = open[key] ?? (Boolean(findingId) || (!g.cleared && index === 0));
        const detailKey = `sys:health-details:${g.key}`, details = Boolean(open[detailKey]);
        const allKey = `sys:health-all:${g.key}`, allShown = Boolean(open[allKey]), hiddenRecords = allShown ? 0 : Math.max(0, g.records.length - HEALTH_ROW_CAP);
        const tone = g.worst === 2 ? t.blocked : g.worst === 1 ? t.working : t.muted;
        const scopes = [...new Map(g.records.map(r => { const target = healthScopeTarget(r, rigs, nodes); return [JSON.stringify(target), target]; })).values()];
        const confidence = [...new Set(g.records.map(r => r.confidence).filter(Boolean))].join(", ") || "not reported";
        const evidence = g.records.flatMap(r => r.evidence ?? []);
        const raw = JSON.stringify({ records: g.records.map(r => ({ id: r.id, detector: r.detector, category: r.category,
          severity: r.severity, confidence: r.confidence, status: r.status, indeterminateReason: r.indeterminateReason,
          summary: r.summary, scope: r.scope, threshold: r.threshold, explanation: r.explanation, window: r.window, freshness: r.freshness })),
          coverage: data.coverage, evidence: evidence.slice(0, 5), ...(evidence.length > 5 ? { moreEvidence: `+${evidence.length - 5} more` } : {}) }, null, 2);
        return v_flex().id(`health-group-${index}`).gap(6).pb(8).border_b(1).border_color(t.border)
          .child(h_flex().id(`health-toggle-${index}`).gap(8).items_center().cursor_pointer().tooltip("Show or hide these findings").on_click(() => toggleOpen(key, shown))
            .child(svg(icon(shown ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim))
            .child(svg(icon(g.worst === 2 ? "rig-diamond" : g.worst === 1 ? "rig-warning" : "rig-info")).size(13).flex_none().text_color(tone))
            .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.foreground).child(g.title))
            .child(div().text_size(11).text_color(tone).child(g.cleared ? "history" : g.worst === 2 ? "critical" : g.worst === 1 ? "warning" : "note"))
            .child(div().text_size(11.5).text_color(t.dim).child(String(g.records.length)))
            .when(Boolean(g.startedAt), el => el.child(div().text_size(11).text_color(t.dim).tooltip(this.time(g.startedAt,{exact:true})).child(`since ${this.time(g.startedAt,{date:true})}`))))
          .when(shown, el => el.child(v_flex().ml(24).gap(8)
            .child(this.plain(t, g.what, `health-what-${index}`))
            .child(h_flex().gap(6).items_center().flex_wrap().children(scopes.map((scope, i) => div().id(`health-scope-${index}-${i}`).text_size(12)
              .text_color(scope.entry ? t.accent : t.muted).when(Boolean(scope.entry), el => el.cursor_pointer().tooltip(`Open ${scope.label}'s page`).on_click(() => this.push(scope.entry))).child(scope.label)))
              .child(div().id(`health-freshness-${index}`).text_size(11.5).text_color(g.stale ? t.dim : t.muted).child(`· confidence ${confidence} · data ${healthAge(g.ageSeconds)}`)))
            .when(!g.cleared, el => el.child(this.plain(t, `What to do: ${g.todo}`, `health-todo-${index}`).text_color(t.muted)))
            .when(g.records[0].detector === "context.pressure" || !(g.records.length === 1 && g.records[0].scope?.type === "seat" && !healthQueueId(g.records[0])), el => el.child(v_flex().ml(8).pl(10).border_l(1).border_color(t.border).gap(4).children((hiddenRecords ? g.records.slice(0, HEALTH_ROW_CAP) : g.records).map((r, i) => {
              const qid = healthQueueId(r), target = healthScopeTarget(r, rigs, nodes), subject = qid ?? target.label ?? r.id;
              const count = String(r.explanation ?? "").match(/^(\d+) coordination transitions\b/)?.[1];
              const time = [r.startedAt, r.lastObservedAt].filter(Boolean).map(s => this.time(s,{date:true})).join(" – ");
              return h_flex().id(`health-item-${index}-${i}`).gap(8).items_center().flex_wrap()
                .when(!g.cleared && r.detector === "context.pressure", el => el.child(svg(icon("rig-info")).size(11).text_color(tone)))
                .child(div().text_size(12).text_color(qid || target.entry ? t.accent : t.muted)
                  .when(Boolean(qid || target.entry), el => el.cursor_pointer().tooltip(`Open ${subject}`).on_click(() => this.push(qid ? { ...entry, section: "system", subview: "health", healthQitem: qid } : target.entry))).child(subject))
                .when(Boolean(count), el => el.child(div().text_size(11.5).text_color(t.muted).child(counted(count, "queue change"))))
                .when(!g.cleared && r.detector === "context.pressure", el => el.child(div().text_size(11.5).text_color(tone).child(`${healthContextPercentage(r)} of the context used (${statusWord(r.severity, "severity").toLowerCase()})`)))
                .child(div().text_size(11).text_color(t.dim).child(time))
                .child(div().flex_1())
                .child(this.copyButton(t, qid ?? r.id, `health-item-${index}-${i}`, qid ? "queue item id" : "finding id"));
            })).when(hiddenRecords > 0, list => list.child(this.inlineLink(t, cx, `health-more-${index}`, `${hiddenRecords} more finding${hiddenRecords === 1 ? "" : "s"}`,
              () => toggleOpen(allKey, false), `Show all ${g.records.length} findings in this group`)))))
            .child(h_flex().id(`health-details-toggle-${index}`).gap(6).items_center().cursor_pointer().tooltip("Show or hide the raw details").on_click(() => toggleOpen(detailKey, details))
              .child(svg(icon(details ? "chevron-down" : "chevron-right")).size(11).text_color(t.dim))
              .child(div().flex_1().text_size(12).text_color(t.muted).child("Details"))
              .when(details, el => el.child(this.copyButton(t, raw, `health-details-${index}`, "health details"))))
            .when(details, el => el.child(v_flex().id(`health-details-${index}`).gap(1).children(raw.split("\n").map(line =>
              div().font_family(settings().font_family).text_size(11).text_color(t.dim).child(line)))))));
      }),
    ], div().text_size(11).text_color(t.dim).child(checked));
  }

  system(t, cx, entry = {}) {
    const health = entry.healthFinding ? null : this.read(cx, "/api/health");
    const healthz = this.read(cx, "/healthz");
    // The daemon's settings, as `rig config` resolves them (the TUI's :config). `config <category>` and
    // `setting <key>` narrow this card only, with their own ×; the other cards stay whole.
    const config = this.read(cx, "/api/config?view=browser");
    const configProbe = this.read(cx, "/api/config/daemon.port");
    this.configPanel ??= new ConfigPanel(this);
    const conn = this.read(cx, "/api/gateway/connections");
    const usage = this.read(cx, "/api/provider/usage");
    const hostsList = this.read(cx, "/api/hosts");
    const cost = this.read(cx, "/api/telemetry/usage/cost");
    // Severity chips: critical in the blocked colour, warnings in amber, the rest dim.
    const sev = (s) => div().px(6).h(18).rounded(5).flex().items_center().text_size(10.5).font_semibold()
      .text_color(/crit|error|high/i.test(s) ? t.blocked : /warn|medium/i.test(s) ? t.ansi3 : t.dim).child(String(s ?? ""));
    const seats = cost.data?.seats ?? [];
    const total = seats.reduce((sum, s) => sum + (typeof s.costUsd === "number" ? s.costUsd : 0), 0);
    const capDetail = capabilitiesSummaryDetail(this.caps());
    // The version of the OpenRig this page SHOWS: another connection's published line isn't this page's, so it falls back to the page's own /healthz.
    const shownCfg = this.activeConfig(), published = sharedRigData(shownCfg, this.sharedOnce);
    const own = (this.config?.connections ?? []).length > 1 ? published?.byConnection?.[shownCfg?.connectionId] : published; // several OpenRigs: only that connection's own entry, never the first's top-level line
    const versionLine = own?.versionLine || formatOpenRigVersionLine({
      healthz: healthz.data,
      cliVersion: own?.cliVersion ?? null,
    });
    const open = shared("rig.open.page") ?? {};
    const focus = shared("rig.focus");
    const hostsOpen = open["usage:hosts"] !== undefined
      ? Boolean(open["usage:hosts"])
      : open["sys:usage-hosts"] !== undefined
        ? Boolean(open["sys:usage-hosts"])
        : Boolean(entry.openUsageHosts || entry.subview === "usage-hosts");
    const hostsFocused = focus === "usage:hosts" || focus === "sys:usage-hosts" || entry.subview === "usage-hosts";
    const usageDisabled = isUsageWindowsDisabled(usage) || isUsageWindowsDisabled(this.cache["/api/provider/usage/hosts"]);
    const usageWait = usageDisabled ? null : this.status(t, cx, "/api/provider/usage", usage);
    const usageRows = usageDisabled || usageWait ? [] : formatUsageRows(usage.data?.hostUsage ?? []);
    const narrowUsageRows = (this.pageWidth ?? 960) < 660 && this.filter
      ? usageRows.filter(r => [r.host, r.provider, r.window, r.usedText, r.resetsAt, r.asOf]
        .some(value => String(value ?? "").toLowerCase().includes(this.filter.toLowerCase())))
      : usageRows;
    if (!usageDisabled && !usageWait && usageRows.length === 0) {
      this.read(cx, "/api/provider/usage/hosts");
    }
    const registeredHostCount = Array.isArray(hostsList.data)
      ? hostsList.data.length
      : (Array.isArray(hostsList.data?.hosts) ? hostsList.data.hosts.length : null);
    const usageHostsCount = this.cache["/api/provider/usage/hosts"]?.data?.hosts?.length
      ?? this.cache["/api/provider/usage/hosts"]?.data?.totalHosts
      ?? null;
    const distinctUsageHosts = new Set((usage.data?.hostUsage ?? []).map((u) => u.hostId ?? u.host ?? "local")).size;
    const hostCount = registeredHostCount ?? usageHostsCount ?? distinctUsageHosts;
    const usageAsOf = usage.data?.asOf ?? usageRows.find((r) => r.asOf)?.asOf ?? null;
    const toggleUsageHosts = () => {
      const cur = shared("rig.open.page") ?? {};
      const next = !hostsOpen;
      setShared("rig.open.page", { ...cur, "usage:hosts": next, "sys:usage-hosts": next });
    };
    const sysRecentOpen = open["sys:recent"] !== undefined ? Boolean(open["sys:recent"]) : entry.openRecent === "instance";
    const sysRecentFocused = focus === "sys:recent";
    const activeSubview = entry.subview === "usage-hosts" ? "usage" : entry.subview === "overview" ? null : (entry.subview ?? null);
    // Each card is built only when its subview shows it (Overview shows all): a subview never pays for the cards it hides.
    const configCard = () => this.card(t, "Configuration", [
      !this.activeConfig() ? div().id("config-not-set-up").text_size(12).text_color(t.muted).child("This page's connection isn't set up any more, so its settings aren't shown and nothing is sent from here. Open Configuration again from the sidebar.") : // never a removed connection's cached rows
      this.status(t, cx, "/api/config?view=browser", config) ?? (entry.category === "sources"
        ? this.table(t,"sys-config",[["Setting",260],["Value"],["Group",90],["Source",80]],configRows(config.data,{category:"sources"}).map(r=>({cells:[r.key,r.value,r.group,r.source]})))
        : v_flex().id("sys-config").gap(4).key_context('HerdrigSettings')
          .on_action('herdrig_settings_next',(_e,ctx)=>{if(this.configPanel?.tabControl(false,ctx))ctx.stop_propagation();})
          .on_action('herdrig_settings_previous',(_e,ctx)=>{if(this.configPanel?.tabControl(true,ctx))ctx.stop_propagation();})
          .on_key_down((event,ctx)=>{if(event.key==='tab'&&!event.modifiers?.control&&!event.modifiers?.platform&&!event.modifiers?.alt&&this.configPanel?.tabControl(Boolean(event.modifiers?.shift),ctx))ctx.stop_propagation();})
          .children(this.configPanel.render(t,cx,config.data,configProbe,{category:entry.category,settingKey:entry.settingKey}))),
    ],
      entry.settingKey || entry.category ? h_flex().id("rig-clear-config").px(8).h(22).gap(6).rounded(6).items_center().flex_none().cursor_pointer().tooltip(`Clear the ${entry.settingKey ? "setting" : "category"} filter`)
        .bg(t.selected).text_size(11.5).text_color(t.foreground).on_click(() => this.clearConfigScope())
        .child(entry.settingKey ? `setting ${entry.settingKey}` : `category ${entry.category}`).child(svg(icon("x")).size(11).text_color(t.muted)) : null);
    const healthCard = () => this.healthFindingsCard(t, cx, health, entry);
    const connectionsCard = () => this.card(t, "Connections", [
      v_flex().id("system-herdr-machine").gap(5)
        .child(div().text_size(12).child(`Herdr machine: ${shownCfg?.daemonMachine??"this computer"}`))
        .when(!!shownCfg?.daemonMachine&&shared("rig.machineSetup")?.machine===shownCfg.daemonMachine
          &&shared("rig.machineSetup")?.origin===shownCfg.daemonUrl&&!!shared("rig.machineSetup")?.verifiedAt,
          el=>el.child(div().text_size(11).text_color(t.muted).child(machineSetupReceiptLabel(shared("rig.machineSetup"),this.uiTimezone))))
        // The legacy one-connection actions (choose or stop using daemonMachine) are for the legacy config shape. A connections list adds and removes
        // machines as connections: its own rows below with two or more, and Add a machine… with one.
        .when(!this.config?.connectionsList,el=>el.child(div().id("system-choose-machine").text_color(t.accent).cursor_pointer().tooltip(`${this.config?.daemonMachine ? `Stop using ${this.config.daemonMachine} for OpenRig` : "Choose which Herdr machine runs OpenRig"}: asks first`).child(this.config?.daemonMachine?`Stop using ${this.config.daemonMachine}…`:"Choose machine…")
          .on_click(()=>{if(this.config?.daemonMachine)this.open({mod:MOD_IDS.menu,kind:"dialog",width:560,height:400,
            props:{target:{kind:"machine"},step:{action:"stop-machine",machine:this.config.daemonMachine}}});else run("rig.choose-machine");})))
        .when(localConnectionMissing(this.config),el=>el.child(h_flex().id('system-add-local').gap(6).text_size(12)
          .child(div().text_color(t.muted).child("This computer isn't connected."))
          .child(focusTarget(this,cx,'system-add-local-open',div().id('system-add-local-open').role('button').text_color(t.accent).cursor_pointer().child('Add it…'),
            ()=>this.open({mod:MOD_IDS.menu,kind:'dialog',width:600,height:680,props:{target:{kind:'machine'},step:{action:'add-machine',local:true}}})))))
        .when(!!this.config?.connectionsList&&(this.config?.connections??[]).length<2,el=>el.child(div().id("system-add-machine").text_color(t.accent).cursor_pointer().tooltip("Add another Herdr machine's OpenRig").child("Add a machine…")
          .on_click(()=>this.open({mod:MOD_IDS.menu,kind:"dialog",width:600,height:680,props:{target:{kind:"machine"},step:{action:"add-machine"}}})))),
      // Connections the config named but this version doesn't use (an address it can't check, a repeated id, ...): said here, with the reason, so a connection never just goes missing.
      ...((this.config?.connectionNotes ?? []).length ? [v_flex().id("system-connection-notes").gap(3).children(this.config.connectionNotes.map((note, i) => div().id(`system-connection-note-${i}`).text_size(11.5).text_color(t.blocked).child(String(note))))] : []),
      ...((this.config?.connections ?? []).length > 1 ? [connectionBlocks(t, { connections: this.config.connections, activationOwner:this, states: this.connectionStates(cx), consentText: this.connConsent ?? null, openrigConsentText: this.helperConsent ?? null,timezone:this.uiTimezone,
        mono: settings()?.font_family ?? "monospace", selected: this.connSelected ?? null, onSelect: (i, cx) => { this.connSelected = i; cx.notify(); }, handles: this.connectionHandles(cx),actionHandles:this.connectionActionHandles(cx),
        onRemove: (c) => this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 520, height: 260, props: { target: { kind: "machine" }, step: { action: "remove-connection", id: c.id, machine: c.machine ?? null } } }),
        onAdd: () => this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 600, height: 680, props: { target: { kind: "machine" }, step: { action: "add-machine" } } }),
        onSwitch: (c) => this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 560, height: 320, props: { target: { kind: "machine" }, step: { action: "switch-connection", id: c.id, machine: c.machine ?? null } } }),
        onSwitchBack: (c) => this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 520, height: 240, props: { target: { kind: "machine" }, step: { action: "switch-back", id: c.id, machine: c.machine ?? null } } }),
        onApprove: (c) => this.open({ mod: MOD_IDS.menu, kind: "dialog", width: 560, height: 360, props: { target: { kind: "machine" }, step: { action: "approve-helper", id: c.id, machine: c.machine ?? null } } }) })] : []),
      this.kv(t, [
        ["Herdrig Version", `herdrig v${HERDRIG_VERSION}`],
        ["OpenRig Version", versionLine],
        ["OpenRig Capabilities", capDetail.line],
        ...(capDetail.reason ? [["Capability Note", this.workerCapabilityMessage()]] : []),
      ]).tooltip(plainError(capDetail.reason ?? "").text),
      ...(capDetail.suggestedUpgrade ? [div().id("system-suggested-upgrade").text_size(11).text_color(t.dim).child(capDetail.suggestedUpgrade)] : []),
      this.status(t, cx, "/api/gateway/connections", conn) ?? this.kv(t, [["Slack", `${statusWord(conn.data.state ?? "", "gateway")}${conn.data.nextAction ? ` · ${statusWord(conn.data.nextAction, "gateway")}` : ""}`],
        ["People registered", `${(conn.data.humans ?? []).length}${(conn.data.humans ?? []).length ? ` · ${(conn.data.humans ?? []).map((h) => h.address).join(", ")}` : ""}`]]),
    ]);
    const usageCard = () => this.card(t, "Usage", [
      ...(this.usageRefreshNote && this.usageRefreshNote.conn === this.activeConnId() ? [div().id("usage-refresh-note").text_size(11.5).text_color(this.usageRefreshNote.ok ? t.muted : t.blocked).child(this.usageRefreshNote.ok ? this.usageRefreshNote.text : this.errorText(t,"usage-refresh-note-detail",this.usageRefreshNote.text))] : []),
      usageDisabled
        ? this.usageDisabledNote(t)
        : (usageWait ?? v_flex().gap(8)
          .child(usageRows.length > 0
            ? ((this.pageWidth ?? 960) < 660
              ? v_flex().gap(6).children(narrowUsageRows.length ? narrowUsageRows.map((r, i) => {
                  const color = r.tone === "blocked" ? t.blocked : (r.tone === "warn" || r.tone === "warning") ? t.ansi3 : r.tone === "muted" ? t.muted : t.foreground;
                  return v_flex().id(`usage-${i}`).px(8).py(6).gap(3).rounded(6).bg(t.raised)
                    .child(h_flex().gap(8).items_center()
                      .child(div().id(`usage-host-label-${i}`).flex_1().min_w(0).truncate().text_size(12.5).font_medium().text_color(t.foreground).tooltip(String(r.host ?? "")).child(formatHostId(r.host)))
                      .child(div().flex_none().text_size(11.5).text_color(t.muted).child(`${r.provider} · ${r.window}`)))
                    .child(h_flex().gap(8).items_center()
                      .child(div().text_size(12).text_color(color).child(r.usedText))
                      .child(div().flex_1())
                      .child(div().text_size(11.5).text_color(t.dim).child(this.time(r.resetsAt,{exact:true}))));
                }) : [this.dim(t, `No matches for /${this.filter}.`)])
              : this.table(t, "usage", [["Host"], ["Provider", 96], ["Window", 76], ["Used", 136], ["Resets", 160, "right"]],
                usageRows.map((r) => {
                  const color = r.tone === "blocked" ? t.blocked : (r.tone === "warn" || r.tone === "warning") ? t.ansi3 : r.tone === "muted" ? t.muted : t.foreground;
                  return {
                    cells: [
                      div().min_w(0).truncate().tooltip(String(r.host ?? "")).child(formatHostId(r.host)),
                      r.provider,
                      r.window,
                      div().text_size(12.5).text_color(color).child(r.usedText),
                      this.time(r.resetsAt,{exact:true}),
                    ],
                    match: [r.host, r.provider, r.window, r.usedText, r.resetsAt, r.asOf],
                  };
                })))
            : this.dim(t, "No usage readings yet."))
          .when(!!usageAsOf && usageRows.length > 0, (el) => el.child(this.dim(t, `as of ${this.time(usageAsOf,{exact:true})}`)))
          .when(hostCount > 1 || hostsOpen, (el) => el.child(v_flex().gap(6).when(hostsFocused, (d) => d.rounded(6).border_1().border_color(t.accent).p(6))
            .child(h_flex().id("usage-hosts-toggle").gap(4).items_center().cursor_pointer().tooltip("Show or hide usage per host").on_click(toggleUsageHosts)
              .child(svg(icon(hostsOpen ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim))
              .child(div().text_size(12).text_color(t.muted).child(`Per host${hostCount > 0 ? ` (${hostCount})` : ""}`)))
            .when(hostsOpen, (d) => d.child(this.usageHostsBlock(t, cx)))))),
    ], this.button(t, "usage-hosts-refresh", this.usageRefreshing ? "Refreshing…" : "Refresh", (_e, cx) => this.refreshUsageHosts(cx), { small: true, iconName: "rig-refresh", disabled: !!this.usageRefreshing, tip: "Read every host's usage again" }));
    const costCard = () => this.card(t, "Cost", [this.status(t, cx, "/api/telemetry/usage/cost", cost) ?? v_flex().gap(6)
      .child(this.table(t, "cost", [["Seat"], ["Status", 100], ["Estimate", 90, "right"]], seats.map((s) => ({ cells: [s.seatSession, statusWord(s.status,"seat"), usd(s.costUsd)] }))))
      .child(h_flex().px(8).child(div().flex_1().text_size(12).text_color(t.dim).child(cost.data.note ?? "")).child(div().w(90).text_right().text_size(12.5).font_semibold().child(`Total ${usd(total)}`))) ]);
    const recentCard = () => v_flex().rounded(10).bg(t.background).border_1().border_color(sysRecentFocused ? t.accent : t.border).p(12).gap(8)
      .child(h_flex().id("sys-recent-toggle").gap(6).items_center().cursor_pointer().tooltip("Show or hide recent activity").on_click(() => toggleOpen("sys:recent", sysRecentOpen))
        .child(svg(icon(sysRecentOpen ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim))
        .child(div().flex_1().text_size(12.5).font_semibold().text_color(t.foreground).child("Recent activity")))
      .when(sysRecentOpen, (el) => {
        const recentPath = "/api/queue/recent-transitions?scope=instance&limit=10";
        return el.child(this.recentTransitionsBlock(t, cx, "sys-recent", recentPath, this.read(cx, recentPath)));
      });
    const peopleCard = () => this.peopleSection(t, cx, conn);
    const orderedCards = [
      ["people", peopleCard],
      ["config", configCard],
      ["health", healthCard],
      ["connections", connectionsCard],
      ["layout", () => this.layoutCard(t, cx)],
      ["usage", usageCard],
      ["cost", costCard],
      ["recent", recentCard],
      ["notifications", () => this.card(t,"Notifications",[this.notifyTogglePill(t,"system-notifications-toggle")])],
    ];
    const visibleCards = (activeSubview ? orderedCards.filter(([k]) => k === activeSubview) : orderedCards).map(([, build]) => build());
    return v_flex().gap(12)
      .children(visibleCards);
  }

  // ---- the header ------------------------------------------------------------------------------------------------
  /** The menu target for what is shown (the header's Actions), or null when it has none. */
  targetFor(cx, entry) {
    if (entry.connectionIssue) return null;
    if (this.activeConnId() === NO_PAGE_CONNECTION) return null; // a page that names no OpenRig acts for none: no Actions, no reads
    if(entry.section==='topology'&&entry.kind==='assistant'){
      const member=this.hostedMembers(cx)?.members?.find(m=>!m.invalid&&m.seat===entry.session&&m.conn===entry.conn);
      return member?assistantTarget(member,{id:entry.rigId}):null;
    }
    if (entry.section === "topology" && entry.kind === "rig") return { kind: "rig", rig: entry.name, rigId: entry.rigId, conn: adoptConnection(this.config, entry.conn) };
    if (entry.section === "topology" && entry.kind === "seat") {
      // From the nodes this page already read: a terminal seat's menu offers no agent actions, and Attach knows whether
      // the seat runs and how OpenRig attaches it, without the sidebar's shared data.
      const n = this.nodesOf(cx, entry.rigId).data?.find?.((x) => x.canonicalSessionName === entry.session || x.logicalId === entry.name); // marked as the rest of the page
      if (!n) return { kind: "seat", rig: entry.rig, rigId: entry.rigId, conn: adoptConnection(this.config, entry.conn), session: entry.session, logicalId: entry.name };
      const status = seatStatus(n);
      const stopped = status === "stopped" || status === "exited" || n.lifecycleState === "stopped" || n.lifecycleState === "recoverable" || n.attachable === false;
      return { kind: "seat", rig: entry.rig, rigId: entry.rigId, conn: adoptConnection(this.config, entry.conn), session: entry.session, logicalId: entry.name, runtime: n.runtime, terminal: isTerminalSeat(n),
        status, attachable: !stopped, sessionAlive: n.sessionAlive ?? !stopped, tmuxAttachCommand: n.tmuxAttachCommand ?? null };
    }
    if (entry.section === "specs" && entry.id) {
      const known = (this.cache["/api/specs/library"]?.data ?? []).find?.((s) => s.id === entry.id);
      return { kind: "spec", conn: this.shownConnId(), id: entry.id, name: entry.name, sourcePath: known?.sourcePath ?? null, specKind: known?.kind ?? null };
    }
    if (entry.section === "scopes" && entry.slice) return { kind: "slice", conn: this.shownConnId(), mission: entry.mission, slice: entry.slice, name: entry.name, slicePath: this.slicePaths(cx, entry.project).get(entry.slice) ?? null };
    if (entry.section === "needs" && entry.id) return ((this.cache["/api/attention"]?.data?.items) ?? []).map(needTarget).find((n) => n.id === entry.id) ?? null;
    return null;
  }

  /** A one-click action's progress and result (`shared("rig.status")`, set by the sidebar that runs it): a spinner, then
   *  the CLI's words for a few seconds; a stopped-rig failure offers an inline Resume… pill. */
  statusLine(t) {
    const s = shared("rig.status");
    const recovery=shared('rig.oldViewsCloseResult');
    if(recovery?.recovery&&recovery.id===s?.id)return null;
    const ttl = s?.ok === false ? ERROR_STATUS_MS : STATUS_MS;
    if (!s || (!s.busy && Date.now() - s.at >= ttl)) return null;
    const words = s.ok === false ? plainError(s.text, {where:s.where??"OpenRig's machine"}) : {text:s.text};
    if (s.ok === false && this.loggedStatusAt !== s.at) { this.loggedStatusAt=s.at; console.error(words.detail); }
    this.ticking = true;
    return h_flex().id("rig-status").max_w(420).min_w(0).gap(6).items_center().flex_none()
      .child(s.busy ? svg(icon("spinner")).size(12).flex_none().text_color(t.working)
        .when(this.config?.reducedMotion !== true, icon => icon.spin(900))
        : svg(icon(s.ok ? "check" : "rig-alert")).size(12).flex_none().text_color(s.ok ? t.working : t.blocked))
      .child(div().min_w(0).truncate().text_size(12).text_color(s.ok === false ? t.blocked : t.muted).when(Boolean(words.text), (el) => el.tooltip(words.text)).child(words.text))
      .when(s.ok === false,el=>el.child(this.copyButton(t,words.detail,`status-error-${s.id}`,"error details")))
      .when(s.ok === false && Boolean(s.canResume && s.rig), (el) => el.child(
        this.button(
          t,
          `status-resume-${s.rig}`,
          "Resume…",
          () => this.open({
            mod: MOD_IDS.menu,
            kind: "dialog",
            width: 460,
            height: 380,
            props: {
              target: { kind: "rig", rig: s.rig, rigId: s.rigId ?? null, conn: s.conn, lifecycle: "stopped" },
              step: { action: "resume", confirm: true },
            },
          }),
          { small: true, iconName: "rig-play", tip: `Resume ${s.rig}: asks before starting its seats` },
        ),
      ));
  }

  header(t, cx, stack, entry) {
    // With several OpenRigs the crumb names the box the page belongs to (Topology ▾ › box2 › demo); with one (or NO_PAGE_CONNECTION) there is nothing to name.
    const shownConn = this.awayConnId(), base = crumbsFor(entry), several = (this.config?.connections ?? []).length > 1 && Boolean(shownConn) && entry?.section !== "file" && base.length > 0;
    const crumbs = compactLocationCrumbs(several ? [base[0], { text: connectionBoxLabel(this.config, shownConn), entry: null }, ...base.slice(1)] : base, this.pageWidth ?? 960);
    const target = this.targetFor(cx, entry), backTo = this.perTab()
      ? backTarget({ stack: this.tabPagesWithSeed()[this.tabId]?.stack ?? [] }, null, { fallback: entry })
      : backTarget({ stack }, this.ownConn(), { fallback: this.openingEntry(), primaryConn: this.config?.connectionId });
    const status = this.statusLine(t);
    const staleHeader = !this.topologyStrip ? this.staleReadSummary() : null;
    const narrow = (this.pageWidth ?? 960) < 480;
    const tiny = (this.pageWidth ?? 960) < 320;
    const tuiLabel = labelledTui(terminals(), this.drawSpaces(), this.config) ? "Switch to TUI" : "Open in TUI";
    // herdrig's TUI opens its views in a window of its own; seats show here through Attach and Open rig space.
    const tuiTip = tuiLabel === "Open in TUI" ? "OpenRig's TUI in a tab. To see seats here, use Attach or Open rig space." : tuiLabel;
    return v_flex().flex_none()
      .child(h_flex().id("page-location-bar").h(38).px(14).gap(8).items_center()
        .when(!tiny, row => row.child(div().id("rig-back").size(24).flex().items_center().justify_center().flex_none()
          .text_color(backTo ? t.muted : t.dim).when(!!backTo, el => el.cursor_pointer().on_click(() => this.back()))
          .tooltip("Back (Backspace)").child(svg(icon("chevron-left")).size(13))))
        .child(h_flex().flex_1().min_w(0).gap(6).items_center().overflow_hidden().children(crumbs.flatMap((c,i) => {
          const last=i===crumbs.length-1;
          const crumb=div().id(`crumb-${i}`).min_w(0).when(tiny&&crumbs.length>2&&i===0,el=>el.max_w(48)).when(last,el=>el.flex_1()).truncate().text_size(12).text_color(last?t.foreground:t.muted)
            .tooltip([String(c.text ?? ""), i === 0 ? "Sections (Alt+S)" : null].filter(Boolean).join("\n"))
            .when(i===0,el=>el.cursor_pointer().on_click(()=>this.sectionMenu()))
            .when(i>0&&!!c.ancestors,el=>el.cursor_pointer().on_click(()=>this.navigationMenu(c.ancestors.map(c=>({label:c.text,entry:c.entry})),"Location")))
            .when(i>0&&!last&&!!c.entry,el=>el.cursor_pointer().on_click(()=>this.push(c.entry)))
            .child(`${c.text??""}${i===0?" ▾":""}`);
          return i?[svg(icon("chevron-right")).size(10).flex_none().text_color(t.dim),crumb]:[crumb];
        })))
        .when(!!entry.filter,el=>el.child(div().id("rig-clear-filter").text_size(12).text_color(t.accent).cursor_pointer()
          .tooltip(`Clear the filter /${entry.filter}`).on_click(()=>this.clearFilter()).child(`/${entry.filter} ×`)))
        .when(!tiny,el=>el.child(this.button(t,"rig-filter-btn","",()=>this.palette(entry.filter?`/${entry.filter}`:"/"),{iconName:"search",tooltip:"Search this page (/)"})))
        .when(!tiny&&!!this.activeConfig(),el=>el.child(this.button(t,"rig-open-tui",narrow?"":tuiLabel,(_e,cx)=>this.tui(cx),{iconName:"terminal",tooltip:tuiTip})))
        .when(!tiny,el=>el.child(div().id("rig-close").size(24).flex_none().flex().items_center().justify_center().cursor_pointer().tooltip("Close")
          .on_click(()=>this.closePage()).child(svg(icon("x")).size(14).text_color(t.muted)))))
      // Below 320 px, controls get their own row so the remaining location links still take clicks.
      .when(tiny,el=>el.child(h_flex().id("page-compact-controls").px(14).pb(6).gap(6).items_center()
        .child(this.button(t,"rig-back","",()=>this.back(),{iconName:"chevron-left",tooltip:"Back (Backspace)",disabled:!backTo}).px(6))
        .child(this.button(t,"rig-filter-btn","",()=>this.palette(entry.filter?`/${entry.filter}`:"/"),{iconName:"search",tooltip:"Search this page (/)"}).px(6))
        .when(!!this.activeConfig(),row=>row.child(this.button(t,"rig-open-tui","",(_e,cx)=>this.tui(cx),{iconName:"terminal",tooltip:tuiTip}).px(6)))
        .child(div().id("rig-close").size(20).flex_none().cursor_pointer().tooltip("Close").on_click(()=>this.closePage()).child(svg(icon("x")).size(14).text_color(t.muted)))))
      .child(h_flex().id("page-title-bar").px(14).pb(10).gap(12).items_center().flex_wrap()
        .child(v_flex().flex_1().min_w(Math.min(240, Math.max(80, (this.pageWidth ?? 960) - 28))).gap(3)
          .child(h_flex().gap(6).items_center().min_w(0)
            .when(!!this.pageHeading?.icon,el=>el.child(svg(icon(this.pageHeading.icon)).size(16).text_color(t.foreground)))
            .when(!!this.pageHeading?.tone,el=>el.child(this.dot(t,this.pageHeading.tone,14,this.pageHeading.session)))
            .child(div().id("page-title").truncate().text_size(18).font_semibold().text_color(t.foreground).tooltip(String(this.pageHeading?.title??entryTitle(entry)??"")).child(this.pageHeading?.title??entryTitle(entry))))
          .when(!!this.pageHeading?.status,el=>el.child(this.pageHeading.statusView??div().id("page-status").truncate().text_size(12).text_color(t.muted).tooltip(this.pageHeading.status).child(this.pageHeading.status)))
          .when(!!staleHeader,el=>el.child(div().id("page-stale-age").truncate().text_size(11.5).text_color(t.blocked).child(`stale · ${staleHeader.ageText}`))))
        .when(!!this.pageActions,el=>el.child(this.pageActions))
        .when(!!target&&!this.pageActions,el=>el.child(this.button(t,"rig-actions","⋯",()=>this.menu(target),{tooltip:"Page actions"}))))
      .when(!!status,el=>el.child(div().px(14).pb(6).child(status)));
  }
  /** This tab's space: the one its props name (live, so it is found once Herdr has restored it), else the one it was last drawn in. */
  tabSpace() {
    if (!this.propsSpaceId) return this.ownSpace ?? null;
    return this.drawSpaces().find((s) => s?.id === this.propsSpaceId) ?? this.ownSpace ?? null;
  }
  render(cx) {return withFocusContext(this,cx,()=>this.renderFocused(cx));}
  renderFocused(cx) {
    rememberOwnLayout(shared, setShared, shared("layout"), layout()); // Leave offers this layout again
    this.configPanel?.consumeWriteWatches?.(cx);
    // Values read once per render (see rawRigData); cleared after it, so nothing outside a render sees a stale one.
    this.renderMemo = {};
    // A permission can arrive after an await drained by another view: only this page's draw/click owns its poll.
    this.armDecisionPoll(cx);
    this.answerDirty = false; // this render draws every answer that has landed
    try { const result=this.renderPage(cx);this.publishHealthConsumer();return result; } finally { this.renderMemo = null; this.armAnswerCheck(cx); }
  }
  /** Presence only, no sample clock: a hidden tab's old marker cannot keep its connection polling. */
  publishHealthConsumer(){
    const space=this.drawSpaces().find(s=>s?.active),tab=space?.tabs?.find(t=>t.active)??(space?.tabs?.length===1?space.tabs[0]:null);
    const own=this.tabSpace()?.id??this.propsSpaceId??this.ownSpace?.id,conn=this.activeConnId();
    if(!space||!tab?.id||own&&own!==space.id||this.tabId&&this.tabId!==tab.id||!conn||conn===NO_PAGE_CONNECTION)return;
    const all=shared('rig.pageOnScreen')??{},mine=all[tab.id],used=this.renderMemo?.healthRead===true;
    if(!used&&!mine?.healthViews?.[this.viewToken])return;
    const token=this.viewToken??=`v${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
    const views=mine?.space===space.id?{...mine.views}:{},healthViews=mine?.space===space.id?{...mine.healthViews}:{};
    views[token]=conn;if(used)healthViews[token]=conn;else delete healthViews[token];
    if(mine?.space===space.id&&mine.views?.[token]===conn&&JSON.stringify(mine.healthViews??{})===JSON.stringify(healthViews))return;
    const live=new Set(this.drawSpaces().flatMap(s=>(s.tabs??[]).map(t=>t.id)));
    const kept=Object.fromEntries(Object.entries(all).filter(([id])=>live.has(id)));
    setShared('rig.pageOnScreen',{...kept,[tab.id]:{...(mine?.space===space.id?mine:{}),space:space.id,views,healthViews}});
  }
  /** An answer (a read, a transcript tail, the hosted members) asks for a re-render at once unless the page re-rendered for another answer in
   *  the last ANSWER_COALESCE_MS; then it only marks the page dirty, and the trailing check draws it. No timer is made here: this runs after
   *  an await, where Herdr would give a new timer to whichever view drained the promise jobs, and that view's close would drop it. */
  noteAnswer(cx) {
    if (this.closed) return;
    const now = Date.now();
    const since = now - (this.answerNotifiedAt ?? -Infinity); // negative after a clock step back: re-render at once
    if (since < 0) this.answerCheckAt = null; // a check armed under the old clock would otherwise keep the next window from arming its own
    if (since >= ANSWER_COALESCE_MS || since < 0) { this.answerNotifiedAt = now; this.answerDirty = false; cx.notify(); }
    else this.answerDirty = true;
  }
  /** From the page's render: an answer is held back only within ANSWER_COALESCE_MS of the re-render another answer asked for, and that
   *  re-render is this render. So while that window is open it arms one timer for the window's end, which draws an answer held back in it.
   *  The timer is made here, in the page's own call, never in an answer's continuation; it doesn't re-arm itself. */
  armAnswerCheck(cx) {
    if (this.closed || !cx?.timer?.after) return;
    const end = (this.answerNotifiedAt ?? -Infinity) + ANSWER_COALESCE_MS, left = end - Date.now();
    // One check per window end: a check still pending for an earlier window (late under load) doesn't cover a later one.
    if (!(left > 0) || (this.answerCheckAt ?? -Infinity) >= end) return;
    this.answerCheckAt = end;
    cx.timer.after(Math.ceil(left), (next) => {
      if (this.closed) return;
      // Nothing held: close this window (if it is still the current one), so an answer landing now re-renders at once. A timer can wake a
      // fraction of a millisecond early, and an answer just before the window's end would otherwise wait for the next notify.
      if (!this.answerDirty) { if ((this.answerNotifiedAt ?? -Infinity) + ANSWER_COALESCE_MS === end) this.answerNotifiedAt = -Infinity; return; }
      this.answerDirty = false; this.answerNotifiedAt = Date.now(); next.notify();
    });
  }
  renderPage(cx) {
    // A tab with no `space` prop (or whose `propsSpaceId` no longer matches any live space) learns its space when drawn: only a shown tab is drawn, so the active space is its own.
    try {
      const all = this.drawSpaces();
      if (!this.propsSpaceId || !all.some((s) => s?.id === this.propsSpaceId)) {
        const shown = all.find((s) => s?.active);
        if (shown) this.ownSpace = shown;
      }
    } catch (_) {}
    // This tab learns its id now, before anything reads its page; a tab with no history saves the page it starts from once that can be told.
    this.syncSplitTab();
    const drewBefore = !this.tabId ? this.legacyShown : undefined; // a pane that drew the shared history before it could latch (a split tab that lost a pane)
    if (this.nativeTabs() && this.latchTab()) {
      const pages = shared("rig.tabPages") ?? {};
      if (!pages[this.tabId]) {
        const seed = drewBefore ? this.tabSeed(drewBefore) : this.tabSeed();
        if (seed.entry && seed.persist) setShared("rig.tabPages", { ...pages, [this.tabId]: { stack: [seed.entry], at: Date.now() } });
      } else if (drewBefore && navKey(pages[this.tabId].stack?.at(-1)) !== navKey(drewBefore)) {
        // The tab kept a record from a pane that has gone: this pane goes on showing its own page, on top of that history.
        setShared("rig.tabPages", tabPagesPush(pages, this.tabId, drewBefore));
      }
    }
    // Only tabs that still exist keep a record. Pruned only when Herdr's list holds this tab (a list still being restored is not read as closed tabs).
    if (this.perTab()) {
      const live = this.drawSpaces().flatMap((s) => (s?.tabs ?? []).map((t) => t?.id)).filter(Boolean);
      if (live.includes(this.tabId)) for (const key of ["rig.tabPages", "rig.pageRoutes"]) {
        const all = shared(key);
        if (all && typeof all === "object") { const kept = tabPagesPrune(all, live); if (kept !== all) setShared(key, kept); }
      }
    }
    this.topologyStrip=null;
    this.wideGraph=false;
    this.pageHeading=null;
    this.pageCrumbEntry=null;
    this.pageActions=null;
    this.pageSpec=null;
    this.pageNeedsCounts=null;
    this.workflowCounts={};
    // Tab/history synchronization above may change the route. Only the synchronous drawing below reuses it;
    // events and operations resolve it afresh after render's finally has cleared the memo.
    if (this.renderMemo) this.renderMemo.routeReady = true;
    const graphShown=this.shownEntry(),graphNav=navKey(graphShown)+":"+(graphShown?.tab??"");
    if(this.graphNav!==graphNav){
      if(this.graphNav!==undefined){
        this.needsPageEpoch=(this.needsPageEpoch??0)+1;
        if(this.refused)for(const[k,v]of Object.entries(this.refused))if(v.listEpoch!==this.needsPageEpoch)delete this.refused[k];
      }
      for(const graph of this.graphs?.values()??[])graph.reset();this.graphWork?.leave();this.graphNav=graphNav;
    }
    this.textSeq = 0;
    // Collect only rows the active native render actually builds (expanded rigs/pods and the open seat).
    // Existing timers merely mark refresh due; hidden page copies never start tail reads from a timer.
    this.nowSeats = new Map();
    // The rows this frame draws, for the page's keys; each seat's Send/Queue for S and Q.
    this.pageRows = [];
    this.seatActions = {};
    const t = theme();
    // Set again by what shows a timed line (the status line, a reply's confirmation) as it draws.
    this.ticking = false;
    this.statusAt = shared("rig.status")?.at;
    this.reading = new Set();
    this.uiTimezone=timezoneValue(this.read(cx,'/api/config/ui.timezone').data);
    // The sidebar re-reads on every activity event: mark this page's copies of what it re-read stale, so a card never
    // lags it. Stale, not deleted: a deleted read draws the skeleton in place of the page until the fetch lands, which
    // collapsed the scroll to the top, dropped a focused text box and flashed the page on every event (the reported flash bug).
    // With several OpenRigs, the shown connection's own refresh stamp: another connection's refresh must not re-read this page, and this one's must.
    // rig.refreshed carries successful-read heartbeats separately from per-connection content versions.
    // The catalog changes on explicit Refresh, not on every activity publication or idle timer. Invalidate existing connection caches once;
    // hidden pages/connections read lazily when shown. Config changes already reset the caches in loadConfig.
    const catalogRefresh=shared('rig.projectCatalogRefresh')??0;
    if(catalogRefresh!==this.catalogRefreshSeen){
      this.catalogRefreshSeen=catalogRefresh;
      for(const cache of Object.values(this.caches??{}))markStale(cache,path=>path==='/api/scopes/projects');
    }
    const published=this.rigData(),{refreshed,conn,several}=this.observeSidebarRefresh(published);
    // Older publishers have only refresh times; retain their invalidation contract as a fallback.
    const version=several?refreshed?.dataByConnection?.[conn]??refreshed?.byConnection?.[conn]??published?.byConnection?.[conn]?.at:refreshed?.dataStamp??refreshed?.at??published?.at;
    if(version&&(version!==this.contentAt||conn!==this.contentAtConn)){
      this.contentAt=version;this.contentAtConn=conn;
      this.invalidateLiveReads();
    }
    {
      // Track visibility so unhide grants a brief grace window while the sidebar's catch-up lands and triggers one coalesced page catch-up.
      const hidden = windowHidden();
      if (hidden) this.wasHidden = true;
      else if (this.wasHidden) {
        this.wasHidden = false;
        const conn = this.activeConnId();
        if (conn && this.refreshSeen?.conn === conn && layoutHasMod(layout(), MOD_IDS.sidebar)) {
          this.hiddenSidebarGraceUntil = Date.now() + HIDDEN_SIDEBAR_GRACE_MS;
        }
        if (!this.resumeCatchUpPending && cx?.timer?.after) {
          this.resumeCatchUpPending = true;
          cx.timer.after(0, (next) => {
            this.resumeCatchUpPending = false;
            if (this.closed) return;
            if (windowHidden()) { this.wasHidden = true; return; }
            this.loadConfig(next);
            this.refreshUnmirrored(next);
          });
        }
      }
      // Whether this connection's sidebar is running now (its refresh was seen advancing lately and it is in the layout): read once per render.
      const conn = this.activeConnId(), seen = this.refreshSeen, now = Date.now();
      this.attentionFromSidebar = conn && seen?.conn === conn
        && (now - seen.at <= SIDEBAR_FRESH_MS || now < (this.hiddenSidebarGraceUntil ?? 0))
        && layoutHasMod(layout(), MOD_IDS.sidebar) ? conn : null;
    }
    const rawNav = shared("rig.nav");
    const stack = rawNav?.stack ?? [];
    let entry = this.shownEntry(); // this tab's own connection's page (the global top only when it is this tab's)
    if(this.heldMessagesView&&this.heldMessagesRoute!==this.heldMessagesRouteKey(entry)){
      this.heldMessagesView.close();this.heldMessagesView=null;this.heldMessagesKey=null;this.heldMessagesOpen=false;
    }
    if (!this.perTab()) this.legacyShown = entry ?? undefined; // what this pane drew from the shared history, kept if it latches later
    const settingsScope=JSON.stringify([entry?.section,entry?.subview,entry?.category,entry?.settingKey,entry?.filter,this.activeConfig()?.connectionId,this.activeConfig()?.daemonUrl,this.activeConfig()?.daemonMachine]);
    if(this.settingsScope!==settingsScope){if(this.configPanel)this.configPanel.selected=null;this.settingsScope=settingsScope;}
    const settingsShown=entry?.section==='system'&&(!entry.subview||['overview','config'].includes(entry.subview));
    const library=this.cache?.["/api/specs/library"]?.data??[];
    const spec=entry?.section==="specs"?library.find(s=>s.id===entry.id)??library.filter(s=>s.name===entry.name).find((s,_,a)=>a.length===1):null;
    if(spec&&!entry.id)entry={...entry,id:spec.id};
    this.activePageView=selectedPageView(entry??{},this.pageViewMemory??= {},spec);
    // Mission workflow support is discovered by its body read; do not replace
    // an explicit Workflows choice with Slices before that shape is known.
    if(entry&&this.activePageView&&pageViewKind(entry)!=='mission')entry=entryWithPageView(entry,this.activePageView,{preserveScope:true});
    const currentNeedsScope = entry?.section === "needs" && this.dismissalConfig() ? dismissalScope(this.dismissalConfig()) : null;
    if (this.previousNeedsScope && this.previousNeedsScope !== currentNeedsScope) this.requestUpdateAction("leave", undefined, this.previousNeedsScope);
    this.previousNeedsScope = currentNeedsScope;
    if (this.previousUpdateEntry !== navKey(entry)) this.selectedUpdate = null;
    this.previousUpdateEntry = navKey(entry);
    this.previousSection = entry?.section;
    this.filter = entry?.filter ?? null;
    // Which OpenRig this page draws, for a page change made over the tab on screen (openOrFocusRigTab decides at that moment). Each page writes only its own
    // entry (rig.pageOnScreen[tab].views[this page]) and only when that entry differs, so panes split in one tab, or tabs taking turns, never overwrite each
    // other and a steady redraw writes nothing. Only the page of the active space writes, under the active tab.
    if ((this.config?.connections?.length ?? 0) > 1) {
      const shownConn = this.activeConnId(), space = this.drawSpaces().find((s) => s?.active), ownSpaceId = this.tabSpace()?.id ?? this.propsSpaceId ?? this.ownSpace?.id ?? null;
      const tab = (space?.tabs ?? []).find((t) => t?.active);
      if (shownConn && shownConn !== NO_PAGE_CONNECTION && space && tab?.id && (ownSpaceId === null || ownSpaceId === space.id)) {
        const all = shared("rig.pageOnScreen"), mine = all?.[tab.id], token = this.viewToken ??= `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        if (mine?.space !== space.id || mine?.views?.[token] !== shownConn) {
          const live = new Set(this.drawSpaces().flatMap((s) => (s?.tabs ?? []).map((t) => t?.id)));
          const kept = Object.fromEntries(Object.entries(all && typeof all === "object" ? all : {}).filter(([id, rec]) => live.has(id) && rec && typeof rec === "object" && rec.views));
          const views = mine?.space === space.id ? { ...mine.views } : {};
          views[token] = shownConn;
          setShared("rig.pageOnScreen", { ...kept, [tab.id]: { ...(mine?.space===space.id?mine:{}),space: space.id, views } });
        }
      }
    }
    this.statusMotion.begin(JSON.stringify([this.config?.daemonUrl,navKey(entry)]),cx,{
      reducedMotion:this.config?.reducedMotion===true,
      attention: this.attentionRead(null).items,
    });
    let body;
    if (!this.config) body = this.dim(t, "Reading OpenRig's settings…");
    else if (!entry) body = this.dim(t, "Nothing open. Pick a rig, seat, spec or slice in the Rig sidebar.");
    else if(entry.connectionIssue) body=this.unresolvedConnection(t,cx,entry);
    else if (this.activeConnId() === NO_PAGE_CONNECTION) body = this.dim(t, "This page names no OpenRig, and several are set up, so nothing is shown or sent for it. Open it again from a row in the Rig sidebar.");
    else if (entry.section === "file") body = this.fileView(t, cx, entry);
    else if (entry.section === "topology") body = this.topology(t, cx, entry);
    else if (entry.section === "specs") body = this.specs(t, cx, entry);
    else if (entry.section === "scopes") body = this.scopes(t, cx, entry);
    else if (entry.section === "terminals") body = this.terminals(t, cx, entry);
    else if (entry.section === "needs") body = this.needs(t, cx, entry);
    else body = this.system(t, cx, entry);
    const file = entry?.section === "file";
    const inPlaceNote = file ? null : this.inPlaceBanner(t, entry);
    // After the body: its reads are what the note checks.
    const note = file ? null : this.refreshNote(t);
    const recoveryNotice=file?null:this.stripRecoveryNotice(t);
    const layoutCard=file?null:this.rigLayoutNoticeCard(t,cx);
    this.refreshNowTails(cx);
    return v_flex().id("rig-view-root").size_full().bg(t.surface).text_color(t.foreground).track_focus(this.handle)
      .when(entry?.section==='system'&&entry.subview==='config',el=>el.key_context('HerdrigSettings')
        .on_action('herdrig_settings_next',(_e,ctx)=>{if(this.configPanel?.tabControl(false,ctx))ctx.stop_propagation();})
        .on_action('herdrig_settings_previous',(_e,ctx)=>{if(this.configPanel?.tabControl(true,ctx))ctx.stop_propagation();}))
      .on_size_change((size,cx)=>{if(size.width>0&&this.pageWidth!==size.width){this.pageWidth=size.width;cx.notify();}})
      // A click outside text takes the page keyboard, so Esc and Backspace work after it.
      .on_mouse_down("left", () => {this.configPanel?.clearSelection();this.handle.focus();})
      .on_key_down((e, cx) => {
        // The next Configuration input does not exist yet. Its queued typing
        // owns these edits before the old input flag or page Backspace history.
        if(settingsShown&&this.configPanel?.hasQueuedEditor()&&this.configPanel.keyDown(e,cx))return;
        // A key typed in a reply box is the reply's (replyBox marks it on the way up).
        if (this.typing) { this.typing = false; return; }
        // Herdr owns Alt+Left for pane navigation; Backspace is history outside text.
        if (e.key === "backspace" && !e.modifiers?.control && !e.modifiers?.platform && !e.modifiers?.alt) this.back();
        else if (e.modifiers?.alt && String(e.key).toLowerCase()==="s")this.sectionMenu();
        else if (entry?.section === "needs" && this.routeNeedKey(e, cx, entry)) { /* open card consumes its shortcuts */ }
        else if (settingsShown&&(entry.subview==='config'||this.configPanel?.hasFocus()||e.key==='escape'&&this.configPanel?.ownsEscape())&&this.configPanel?.keyDown(e,cx)) { /* activation needs actual Settings focus; Escape belongs to the topmost visible edit */ }
        else if (e.key === "escape" && entry?.section === "topology" && !entry.kind && this.pulseFilter) { this.pulseFilter = null; cx.notify(); }
        else if (e.key === "escape") this.closePage();
        else if (e.key === "delete" && entry?.section === "needs" && !entry.id && dismissible(this.selectedUpdate) && !this.selectedUpdate.dismissed
          && this.visibleUpdates?.some((n) => updateKey(n) === updateKey(this.selectedUpdate)))
          this.updateAction("dismiss", this.selectedUpdate);
        // `/` filters a page's tables; a file page has none, so it does nothing there, as Filter… isn't offered.
        else if (e.key === "/" && entry?.section !== "file" && !e.modifiers?.control && !e.modifiers?.platform && !e.modifiers?.alt) this.palette(entry?.filter ? `/${entry.filter}` : "/");
        // Otherwise the rows' keys: ↑/↓, ←/→, Home/End, Enter, S, Q, the Menu key or Shift+F10.
        else this.pageTreeKey(e, cx);
      })
      .child(file ? this.fileHeader(t, entry) : this.header(t, cx, stack, this.pageCrumbEntry??entry??{ section: "topology" }))
      .when(!!this.topologyStrip,el=>el.child(div().px(14).pb(6).child(this.topologyStrip)))
      .when(!file, (el) => {const resolved=this.pageSpec?{...entry,id:this.pageSpec.id}:entry;
        const tabs=this.objectTabs(t,resolved??{section:"topology"},this.pageSpec??spec,{cx});return tabs?el.child(tabs):el;})
      .child(file ? v_flex().id("rig-view-body").flex_1().min_h(0).child(body)
        : v_flex().id(entry?.section === "system" && entry.subview === "health" ? `rig-view-body-health-${entry.healthRigId ?? "all"}` : "rig-view-body").flex_1().min_h(0).overflow_y_scrollbar().p(pageBodyLayout(this.pageWidth).padding).child(v_flex().when(!this.wideGraph,el=>el.max_w(960)).when(this.wideGraph,el=>el.w_full()).gap(12).when(!!inPlaceNote, (el) => el.child(inPlaceNote)).when(!!note, (el) => el.child(note)).when(!!layoutCard,el=>el.child(layoutCard)).when(!!recoveryNotice,el=>el.child(recoveryNotice)).child(body)));
  }
}

// The page's read cache is the shown connection's: `this.cache` keeps meaning "the cache of what is on screen" while each connection has its own
// (one OpenRig's rig, queue and attention paths never answer another's). Assigning resets them all.
Object.defineProperty(RigView.prototype, "cache", {
  get() { return this.cacheFor(this.activeConnId()); },
  set(value) { this.caches = {}; if (value && Object.keys(value).length) this.caches[this.activeConnId() ?? ""] = value; },
  configurable: true,
});
