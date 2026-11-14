import {rigOrigin} from "./rig-space-context.js";
import { stampConnection, adoptConnection, consentOf, consentText, LEGACY_CONNECTION_ID } from "./rig-connections.js";
import {workerViewDetails,workerMissingReason} from "./rig-worker-views.js";
import { machineSetupReceiptLabel } from "./rig-machine-setup.js";
import { effectiveScopeProject } from './rig-project.js';
import { workflowPath,workflowView } from './rig-workflow.js';
import { WorkflowPanel } from './rig-workflow-view.js';
import { asOf } from './rig-lib.js';
import { formatAbsoluteTime, timezoneValue } from './rig-time.js';
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
import { sharedLoopbackDaemonUrl, sharedRigData } from "./rig-lib.js";
import { relativeTimeText, specRealpathAvailable } from "./rig-lib.js";

import { currentHealthRecords, healthCounts, healthForRig, groupHealthRecords, healthScopeTarget, healthQueueId, healthAge, validHealthQitemId, healthContextPercentage, classifyHealth, mergeHealthHistory } from "./rig-health.js";

import { filterAttentionHealth, isHealthAttention } from "./rig-lib.js";
import { h_flex, v_flex, TextView, Editor, EditorState, TextareaState, Textarea, HoverCard } from "gpui-base";
import { appHome, home, readTextFile, writeTextFile, theme, run, exec, shared, setShared as rawSetShared, settings, openOverlay, nextCommand, watchFolder, spaces, panes, terminals, hc, layout, layouts, window, notify, machines } from "herdr";
import { guardFlatStore } from "./rig-connections.js";
let flatOwner = null; // the view whose connection is writing: the flat stores accept only the legacy connection (PR 1)
const setShared = guardFlatStore(rawSetShared, () => flatOwner?.config?.connectionId);
import { MOD_IDS, NO_PERSON, TERMINAL_TOKEN_PROTECTED, DECISION_TOKEN_PROTECTED, NETWORK_UNCONFIRMED_MESSAGE, parseConfig, sameConfig, preserveCliDiscoveredConfig, discoverDaemonFromCli, formatOpenRigVersionLine, personDisableReason, seatStatus, statusLook, needTarget, iconsAt, fileLanguage, fileEntry, transcriptPath, openOrFocusTui, labelledTui,
  configRows, crumbsFor, navPush, navBack, navKey, layoutHasMod, startOneClick, writeCommand, cliRefusal, writeOutcome, peopleCliCommand, needDetailLines, needRecordedLines, draftKey, unsafeSpecWritePath, simpleHash, stripSecondaryEnterNewline,
  STATUS_MS, ERROR_STATUS_MS, hostOf, rigModel, statusCounts, rigFoldOpen, podFoldOpen, foldChoice, rigKey, podKey, orderRigs, seatClickTarget, worstTone,
  SLICE_FILES, MISSION_FILES, RIG_SECTIONS, SECTION_TITLES, RIG_TABS, currentCapabilities, capabilityDisableReason, capabilitiesSummaryDetail, capabilitiesSummaryRow,
  usagePercentBar, usageWindowTone, formatUsageRows, isUsageWindowsDisabled, normalizeUsageHosts, recentTransitionRows, singleLineText, computePulseCounts, matchesPulseFilter,
  isRigStopped, expandAllTopology, collapseAllTopology, normalizeTerminalPreview, statusMark, statusMarkElement, isTerminalSeat, rigTone, backTarget, entryTitle, treeKeyNav,
  rowStatusGlyph, formatHonestCount, attachToSeat, requestMarkdownView, parkedWorkOwner, observeNeedDecision, attentionCoverage, requestCardText, requestHeadline, needsRequestCount,
  tierOf, isUpdateNeed, tierStripFor, sortNeedsByTier, enrichAttentionItems, questionsState, submitMissionActions, sinceYouWereAwaySummary, quietModeHeaderChip, deadBindingNotice, whoseQueueSummary, resolveAskerSeat, parseSidebarState, serializeSidebarState,
  viewsPropsFromLayout, openOrFocusRigTab, closeRigInspection, selectWorkerView, openNeed, markStale, settleRead, attachRelayPath, waitWith,
  localSpecRoots, resolveInSpecRoots, specFolderRefusal, specCopyName, isLoopbackDaemonUrl, parseDaemonStatusJson, isValidSessionName, newRigOverlay } from "./rig-lib.js";
import { seatActivityDetails, seatActivityWords, seatQueuePaths, seatQueueDetails } from "./rig-seat-details.js";
import { archivedElements, withArchivedHosts } from "./rig-archived.js";
import { dismissible, dismissalSnapshot, requestDismissal, updateKey, dismissalScope } from "./rig-dismiss.js";
import { HERDRIG_VERSION } from "./rig-version.js";
import { registerRigRouting, workerCapabilityText } from "./rig-lib.js";
import { NowTailCache, nowTailPresentation } from "./rig-now.js";
import { RigGraph, GRAPH_EDGE_LOOK } from "./rig-graph.js";
import { pageBodyLayout } from "./rig-page-layout.js";
import {allSeatsView} from './rig-all-seats-view.js';
import {HostedMembersReader,assistantsForRig,assistantTarget,assistantWord,assistantSentence,assistantForNeed,assistantOwner} from './rig-connected-assistants.js';
import {assistantGroup} from './rig-connected-assistants-view.js';
import { normalizeRunningGraph, graphActivityOf } from "./rig-graph-state.js";
import { pageViewKind, pageViewOptions, selectedPageView, entryWithPageView, compactLocationCrumbs, visiblePageTabs, pageSectionChoices } from "./rig-page-nav.js";
import { readRigSpecPreview, groupSpecLibrary } from "./rig-lib.js";
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
const CONFIG = () => `${appHome()}/openrig/config.json`;

const nav = () => shared("rig.nav") ?? { stack: [] };
function push(entry) {
  // One-way sync (Sidebar → Page, never Page → Sidebar). In-Page navigation only updates `shared("rig.nav")`
  // and never mutates the sidebar's `shared("rig.sel")`, `shared("rig.open.page")`, or `shared("rig.order")`.
  if (entry && "focusRig" in entry) setShared("rig.focusRig", entry.focusRig ?? null);
  else if (shared("rig.focusRig")) setShared("rig.focusRig", null);
  setShared("rig.nav", navPush(nav(), entry));
  openOrFocusRigTab({ run, spaces, panes, layout, section: entry?.section ?? "topology" });
}
/** Closes the inspection: closes or leaves the Rig tab or selects main on legacy rig-work stack. */
function closeInspection() {
  closeRigInspection({ shared, setShared, run, spaces, panes, layout, stackId: STACK, mainId: "main" });
}
const menu = (target) => openOverlay({ mod: MOD_IDS.menu, kind: "popup", width: 280, height: 320, props: { target } });
/** A one-click write (snapshot, follow, open a view): the sidebar runs it; a dialog opens only when it fails. */
const oneClick = (target, action, actionKey = null) => startOneClick({ shared, setShared, run, layout, openOverlay }, target, action, actionKey);
/** The Rig palette, started with text (Filter… starts it at the page's filter). */
const palette = (initial) => openOverlay({ mod: MOD_IDS.palette, kind: "dialog", width: 560, height: 360, props: { initial } });
/** The shown page without its filter. */
function clearFilter() {
  const stack = nav().stack ?? [];
  const top = stack.at(-1);
  if (top) setShared("rig.nav", { stack: [...stack.slice(0, -1), { ...top, filter: "" }] });
}
/** The System page without its `config <category>` / `setting <key>` narrowing (the page's filter stays). */
function clearConfigScope() {
  const stack = nav().stack ?? [];
  const top = stack.at(-1);
  if (top) setShared("rig.nav", { stack: [...stack.slice(0, -1), { ...top, category: null, settingKey: null }] });
}
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
/** Folds (rigs, pods, health, edges, needs) are one model in `shared("rig.open.page")`, shared with the sidebar tree. */
const toggleOpen = (key, now, seats) => setShared("rig.open.page", seats ? foldChoice(shared("rig.open.page"), key, !now, seats) : { ...(shared("rig.open.page") ?? {}), [key]: !now });
const setOpen = (key, open) => setShared("rig.open.page", { ...(shared("rig.open.page") ?? {}), [key]: open });
/** Remote drafts belong to a connection and spec, never another daemon with the same path-derived id. */
const specDraftKey = (id, config) => {
  // The legacy connection's keys are the old ones (stored drafts stay found); another connection's carry its id.
  const own = config?.connectionId && config.connectionId !== LEGACY_CONNECTION_ID ? `${config.connectionId}:` : "";
  return config?.daemonMachine ? `remote-spec:${own}${encodeURIComponent(config.daemonUrl??"")}:${encodeURIComponent(config.daemonMachine)}:${id}` : `spec:${own}${id}`;
};
const setDraft = (key, draft) => {
  const all = { ...(shared("rig.drafts") ?? {}) };
  if (draft == null) delete all[key]; else all[key] = key.startsWith("remote-spec:") ? {...draft,at:Date.now()} : draft;
  setShared("rig.drafts", all);
};
const inRigLayout = () => !!(function find(n) {
  return n && typeof n === "object" && (n.id === STACK || n.id === "rig-sidebar" || n.content?.mod === MOD_IDS.sidebar || (n.children ?? []).some(find));
})(layout());
const usd = (v) => typeof v === "number" ? `$${v.toFixed(2)}` : "—";

import {rigSpecLibraryPath} from "./rig-lib.js";
import {StatusMotion} from "./rig-status-motion.js";
export default class RigView extends View {
  time(value,options={}) { return formatAbsoluteTime(value,{timezone:this.uiTimezone,...options}); }
  init(p, cx) {
    registerRigRouting(cx, context => ({ shared, setShared, run, spaces, panes, terminals, hc, layout, notify, config: this.config, wait: waitWith(context) }));
    this.statusMotion = new StatusMotion();
    this.pageViewMemory = {}; // Session only; never persisted with folds or navigation.
    this.pulseFilter = null; // Page-session only: never restore the legacy persisted shared filter.
    this.initialEntry = p?.entry ?? null;
    this.config = null;
    flatOwner = this;
    this.resetNowTails(cx);
    this.cache = {}; // path → { data, error, at }
    this.files = {}; // file path → { state, error, text }
    this.present = {}; // file path → true | false (on disk)
    this.handle = cx.focus_handle();
    this.replies = {}; // need id → { input, key, target, busy, result }: the inline reply boxes
    // Keyed by ids the daemon sends: null-prototype maps, so an id such as `__proto__` is just a key.
    this.answered = Object.create(null); // need id → { summary, words, at }: replies sent from here, said for a moment after the item goes
    this.questionChoices = Object.create(null); // need id → { [questionId]: optionId }
    this.askerNotes = Object.create(null); // need id → string note when Open seat fails or seat isn't loaded
    this.peopleBusy = false;
    this.peopleResult = null;
    this.peopleForm = { quietUntil: "2h", quietStart: "22:00", quietEnd: "08:00", modeName: "sleep", modePolicy: "hold", modeDuration: "8h", showSaveMode: false, showQuietUntil: false, showQuietDaily: false };
    this.awayDismissed = false;
    this.loadPersistedState(cx);
    this.loadConfig(cx);
    // A copy opened as a tab (tab.new {mod: "rig-view", props: {entry}}) shows that one entry.
    // The config is picked up the moment it is written into an open window, by watching the app
    // home (OpenRig's folder once it exists), and every second while it is missing, in case watching isn't available.
    cx.spawn(async (cx) => {
      for (;;) {
        const dir = this.config && !this.config.missing ? `${appHome()}/openrig` : appHome();
        try { await watchFolder(dir); } catch (_) { await new Promise((r) => cx.timer.after(5000, () => r())); }
        if (this.closed) return;
        this.loadConfig(cx);
      }
    });
    cx.timer.every(1000, (cx) => { if (!this.config || this.config.missing) this.loadConfig(cx); });
    cx.timer.every(5000, (cx) => {
      if (this.closed) return;
      this.loadConfig(cx);
      // A page can be open without the sidebar, and lifecycle changes need not emit SSE.
      this.invalidateLiveReads();
      cx.notify();
    });
    // The header's status line and a reply's confirmation come and go by time: redraw while one shows or a new one arrives.
    cx.timer.every(1000, (cx) => { if (this.ticking || shared("rig.status")?.at !== this.statusAt) cx.notify(); });
    cx.timer.every(250, (cx) => this.pollSpacesDecision(cx));
    cx.timer.every(250, (cx) => {
      const pending=this.specPermission;if(!pending)return;
      const decisions=shared("rig.specWriteDecisions")??{},decision=decisions[pending.token];
      if(!decision&&Date.now()<pending.expires)return;
      this.specPermission=null;const rest={...decisions};delete rest[pending.token];setShared("rig.specWriteDecisions",rest);
      pending.box.awaitingPermission=false;
      if(decision==="allow"){if(pending.request?.verb==="copy-folder")this.copyFolder(cx,pending.spec,pending.confirmation);else this.remoteSpecWrite(cx,pending.spec,pending.request,pending.confirmation);}
      else {pending.box.note="Nothing was saved on the box.";cx.notify();}
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        else if (c === "back") this.back();
        else if (c.startsWith("open:")) push({ section: c.slice(5) });
        cx.notify();
      }
    });
  }

  /** herdr's teardown: the watch loop ends with this copy; a reply typed and not sent stays as a draft. */
  async close() { this.configPanel?.close();this.closed = true; for(const box of Object.values(this.specBoxes??{}))box.secondaryEnterTask?.cancel?.();this.statusMotion.close(); this.nowTails?.close(); for(const graph of this.graphs?.values()??[])graph.reset(); this.updateAction("leave"); for (const box of Object.values(this.replies)) this.keepDraft(box); }

  updateAction(action, value) { requestDismissal({ shared, setShared, run, scope: dismissalScope(this.config) }, action, value); }
  updateModel() {
    const state = shared("rig.dismissedUpdates");
    return dismissalSnapshot(state?.scope === dismissalScope(this.config) ? state : null);
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
        ? `✓ Dismissed: ${receipt.summary ?? "update"}` : `✓ Dismissed ${receipt.keys.length} updates`)??"")).child(receipt.keys.length === 1
        ? `✓ Dismissed: ${receipt.summary ?? "update"}` : `✓ Dismissed ${receipt.keys.length} updates`))
      .child(div().id(`undo-${receipt.id}`).text_size(12).text_color(t.accent).cursor_pointer()
        .on_click(() => this.updateAction("undo", receipt.id)).child("Undo"));
  }

  loadPersistedState(cx) {
    if (typeof appHome !== "function" || typeof readTextFile !== "function") return;
    cx.spawn(async (cx) => {
      try {
        const raw = await readTextFile(`${appHome()}/openrig/state.json`);
        if (!raw) return;
        const parsed = parseSidebarState(raw);
        let changed = false;
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
        if (changed) cx.notify();
      } catch (_) {}
    });
  }

  loadConfig(cx) {
    cx.spawn(async (cx) => {
      const next = preserveCliDiscoveredConfig(parseConfig(await readTextFile(CONFIG())), this.config);
      try{
        const saved=consentOf(await readTextFile(`${appHome()}/openrig/spec-consent.json`),this.config?.connectionId??LEGACY_CONNECTION_ID),key=JSON.parse(saved?.key??"null");
        this.specConsentMachine=key?.sha256===SPEC_SHA256?key.machine:null;
      }catch{this.specConsentMachine=null;}
      if (sameConfig(next, this.config)) return;
      if (this.config && (next.daemonUrl !== this.config.daemonUrl || next.daemonMachine !== this.config.daemonMachine || next.connectionId !== this.config.connectionId)) {
        this.cache = {}; this.cacheEpoch = (this.cacheEpoch ?? 0) + 1; this.resetNowTails(cx); // reads still in flight belong to the old daemon (or the old connection at the same address)
        for(const box of Object.values(this.specBoxes??{}))box.state?.release?.();
        this.specBoxes={};
      }
      this.config = next;
      // The spec editor's folders, from local facts only (never the daemon's list).
      if(!next.daemonMachine)this.specRoots = await localSpecRoots(next, exec, home());
      this.specRealpathAvailable = await specRealpathAvailable(exec);
      cx.notify();
    });
  }

  hostWorkerEntry(view){
    const entry=Object.values(shared("rig.workerViews")??{}).find(e=>e.view===view&&e.config?.daemonMachine===this.config?.daemonMachine
      &&rigOrigin(e.config?.daemonUrl)===rigOrigin(this.config?.daemonUrl));
    return entry&&entry.pages?.some(page=>spaces().some(space=>space.tabs?.some(tab=>tab.id===page.tab)))?entry:null;
  }
  hostWorkerLine(t,rig,view=`rig:${rig.name}`){
    const progress=shared("rig.workerProgress");
    if(progress?.view===view&&progress.machine===this.config?.daemonMachine
      &&rigOrigin(progress.daemonUrl)===rigOrigin(this.config?.daemonUrl))
      return div().id(`host-worker-progress-${rig.id}`).text_size(11.5).text_color(t.muted)
        .child(`Updating ${view.startsWith("rig:")?`Workers · ${view.slice(4)}`:this.hostWorkerEntry(view)?.name??"worker view"}…`);
    const entry=this.hostWorkerEntry(view);if(!entry)return null;
    const pages=entry.pages.filter(page=>spaces().some(space=>space.tabs?.some(tab=>tab.id===page.tab)));
    const details=workerViewDetails(entry);
    const missing=entry.missing?.map(m=>`${m.label} (${workerMissingReason(m.reason)})`).join(", ");
    const message=`Worker view open here: ${pages.length} page${pages.length===1?"":"s"}.${details?` ${details}.`:""}${missing?` ${entry.missing.length} seat${entry.missing.length===1?"":"s"} not shown: ${missing}.`:""}`;
    return v_flex().id(`host-worker-${rig.id}`).gap(4)
      .child(div().text_size(11.5).text_color(t.dim).child(message))
      .when(!!entry.paused,el=>el.child(div().text_size(11.5).text_color(t.working??t.muted).child("Couldn't refresh this view; tiles kept.")
        .child(div().text_color(t.accent).cursor_pointer().child("Retry").on_click(()=>oneClick({kind:"open-view",view:entry.view,rig:rig.name,rigId:rig.id,conn:rig.conn},"open-view")))))
      .child(h_flex().gap(8).flex_wrap().children(pages.map((page,index)=>div().id(`host-worker-page-${rig.id}-${index}`).text_size(11.5).text_color(t.accent).cursor_pointer()
        .child(`Show page ${index+1}`).on_click(()=>{if(spaces().some(s=>s.id===entry.space&&s.tabs?.some(tab=>tab.id===page.tab))){run("space.select",{id:entry.space});run("tab.select",{id:page.tab});}}))))
      .child(div().text_size(11.5).text_color(t.accent).cursor_pointer().child(`herdrig prune: ${entry.pruneMs?Math.round(entry.pruneMs/60000)+"m":"off"}…`)
        .on_click(()=>menu({kind:"following",target:entry.view,name:entry.name,rig:rig.name,rigId:rig.id,conn:rig.conn,enabled:entry.following,pruneAfterMs:entry.pruneMs||null})));
  }
  caps() { return currentCapabilities(this.config?.capabilities ?? shared, terminals?.() ?? [], shared("rig.capabilities")); }

  /** Open or switch to the active space's TUI. The Rig sidebar does it (`rig.tui`), as the menu does: it outlives
   *  this page. Without it in the layout, a task of this view's own does, its own cx pacing the wait for a new tab:
   *  the click's cx is stale after the first await. */
  tui(cx) {
    if (layoutHasMod(layout(), MOD_IDS.sidebar)) return run("rig.tui");
    const config = this.config, rigLayout = inRigLayout();
    cx.spawn(async (cx) => {
      const result = await openOrFocusTui({ spaces, panes, terminals, hc, run, layout, inRigLayout: rigLayout, wait: (ms) => new Promise((r) => cx.timer.after(ms, () => r())) }, config);
      if (result?.ok === false) notify({ title: "Open TUI", body: result.reason, level: "warning" });
    });
  }

  /** Back to where `backTarget` says; with nowhere to go it does nothing (Esc and × close the page). */
  back() {
    if (!backTarget(nav())) return;
    setShared("rig.nav", navBack(nav()));
  }

  /** The section switch: a section pushes onto the nav stack, so Back returns. */
  goSection(section) {
    push({ section });
  }

  navigationMenu(choices, title = "Sections") {
    openOverlay({ mod: MOD_IDS.menu, kind: "popup", width: 260, height: Math.min(360, 42 + choices.length * 30),
      props: { target: { kind: "page-navigation", name: title, choices } } });
  }

  sectionMenu() {
    const data = sharedRigData(this.config, shared) ?? {}, topology = data.topology ?? [];
    const items = data.attentionItems ?? this.cache?.["/api/attention"]?.data?.items ?? [];
    const health=data.health?.records??this.cache?.["/api/health"]?.data?.records;
    this.navigationMenu(pageSectionChoices({ topology: `${topology.length} rigs`, specs: data.specs?.length??this.cache?.["/api/specs/library"]?.data?.length,
      terminals: (data.ps ?? []).length, needs: needsRequestCount(topology, items),
      system: Array.isArray(health)?healthCounts(health).problems||"ok":null }));
  }

  objectTabs(t, entry, spec, {prefix="page",active=this.activePageView}={}) {
    const data=sharedRigData(this.config, shared)??{};
    const counts=this.pageNeedsCounts??{requests:needsRequestCount(data.topology,data.attentionItems),updates:(data.attentionItems??[]).filter(isUpdateNeed).length};
    const options = pageViewOptions(entry, spec, {...counts,...this.workflowCounts});
    if (!options.length) return null;
    const { tabs, more } = visiblePageTabs(options, this.pageWidth ?? 960);
    const choose = view => push(entryWithPageView(entry, view));
    const keyChoose=(e,cx,act)=>{if(e.key==="enter"){cx.stop_propagation();act();}};
    const bar=h_flex().id(`${prefix}-object-tabs`).px(14).gap(16).h(34).items_center().border_b(1).border_color(t.border).flex_none()
      .when((this.pageWidth??960)<320,el=>el.h(68).flex_wrap().gap(8))
      .children(tabs.map(([id, label]) => div().id(`${prefix}-tab-${id}`).tab_stop(true).h(34).flex_none().flex().items_center().cursor_pointer()
        .border_b(active === id ? 2 : 0).border_color(t.accent).text_size(12.5).text_color(active === id ? t.foreground : t.muted)
        .on_click(() => choose(id)).on_key_down((e,cx)=>keyChoose(e,cx,()=>choose(id))).child(label)))
      .when(more.length > 0, el => el.child(div().id(`${prefix}-tabs-more`).tab_stop(true).cursor_pointer().text_size(12.5).text_color(t.muted)
        .h(34).flex_none().flex().items_center().border_b(more.some(([id])=>id===active)?2:0).border_color(t.accent)
        .tooltip(more.find(([id])=>id===active)?.[1]??"More views")
        .on_click(() => this.navigationMenu(more.map(([id,label]) => ({ label, entry:entryWithPageView(entry,id) })), "Views"))
        .on_key_down((e,cx)=>keyChoose(e,cx,()=>this.navigationMenu(more.map(([id,label])=>({label,entry:entryWithPageView(entry,id)})),"Views")))
        .child(`${more.find(([id])=>id===active)?.[1]??"More"} ▾`)));
    if(pageViewKind(entry)==='topology'&&active==='seats'){
      const choices=[['rig','By rig'],['status','By status']].map(([id,label])=>({label,entry:{...entry,topologyTab:'seats',seatsOrder:id}}));
      bar.child(div().flex_1());
      if((this.pageWidth??960)-28<460)bar.child(this.moreButton(t,'all-seats-order-menu',()=>this.navigationMenu(choices,'Seat order')));
      else bar.child(h_flex().id('all-seats-order').gap(8).items_center().children(choices.map(({label,entry:e})=>div().id(`all-seats-order-${e.seatsOrder}`)
        .text_size(12).text_color((this.allSeatsOrder??'rig')===e.seatsOrder?t.foreground:t.muted).cursor_pointer().on_click(()=>push(e)).child(label))));
    }
    return bar;
  }

  async resolveDaemonUrl() {
    if (!this.config) return null;
    if (this.config.connectionsRefused) { this.lastDaemonMessage = this.config.connectionsRefused; return null; } // a refused list has no address, from anywhere
    if (this.config.daemonUrl) return this.config.daemonUrl;
    // Another mod's shared state may name the daemon only when it's on this machine (loopback).
    const fromShared = sharedLoopbackDaemonUrl(this.config, shared("rig.data"));
    if (fromShared) {
      const nextCfg = { ...this.config, daemonUrl: fromShared, daemonUrlSource: this.config.daemonUrlSource ?? "cli" };
      delete nextCfg.daemonMessage;
      this.config = nextCfg;
      return fromShared;
    }
    const status = await discoverDaemonFromCli(this.config, exec);
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
  read(cx, path, force = false, onData = null) {
    this.reading?.add(path);
    const hit = this.cache[path];
    if ((!hit || force || hit.stale) && this.config && !hit?.loading) {
      const sharedAt = sharedRigData(this.config, shared)?.at;
      // The read belongs to the daemon and connection it started against: a late answer, after the configuration moved, is dropped.
      const epoch = this.cacheEpoch ?? 0, connId = this.config?.connectionId;
      this.cache[path] = { ...(hit ?? {}), stale: false, loading: true };
      const finish = (outcome) => {
        const pending = this.cache[path];
        this.cache[path] = {
          ...settleRead(pending, outcome),
          sharedAt: outcome.ok ? sharedAt : pending?.sharedAt,
          // Consume invalidation when starting, not when finishing: another update may arrive mid-read.
          ...(pending?.stale ? { stale: true } : {}),
        };
        if (outcome.ok && typeof outcome.data?.qitemId === "string" && path.startsWith("/api/queue/")) {
          const row = outcome.data, at = this.cache[path].at;
          for (const [id, box] of Object.entries(this.replies ?? {})) {
            if (box.target?.qitemId === row?.qitemId && observeNeedDecision(box, row, at)) {
              delete this.answered[id];
              delete this.questionChoices[id];
            }
          }
        }
      };
      cx.spawn(async (cx) => {
        try {
          const daemonUrl = await this.resolveDaemonUrl();
          if (!daemonUrl) {
            throw new Error(this.lastDaemonMessage || this.config.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up').");
          }
          const r = await fetch(`${daemonUrl}${path}`);
          const body = await r.text();
          if (epoch !== (this.cacheEpoch ?? 0)) return;
          let data = null; try { data = stampConnection(JSON.parse(body), connId); } catch (_) { data = body; }
          // onData runs here, after the await: outside render, so it may create view state (an EditorState).
          if (r.ok && onData) onData(data);
          finish(r.ok
            ? { ok: true, data, status: r.status }
            : { ok: false, error: `GET ${path} → ${r.status}${data?.error ? `: ${data.error}` : ""}`, status: r.status, errorData: data });
        } catch (e) { if (epoch === (this.cacheEpoch ?? 0)) finish({ ok: false, error: String(e?.message ?? e) }); }
        cx.notify();
      });
    }
    const result = this.cache[path] ?? { loading: true };
    if (path.startsWith("/api/attention") && result.data?.items) {
      const health = this.read(cx, "/api/health");
      return { ...result, data: { ...result.data, items: filterAttentionHealth(result.data.items, health.error ? [] : health.data?.records ?? []) } };
    }
    return result;
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
    return effectiveScopeProject(explicit,shared('rig.project'),this.read(cx,'/api/scopes/projects').data);
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
  /** Escaped HTML gives plain text a native selectable TextView, without interpreting daemon text as markup. */
  plain(t, text, id = null) {
    const escaped = String(text ?? "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\n/g, "<br>");
    return TextView.html(id ?? `rig-text-${this.textSeq = (this.textSeq ?? 0) + 1}`, escaped).selectable(true).scrollable(false).text_size(12.5).text_color(t.foreground);
  }
  copyButton(t, text, id, label = "value") {
    return div().id(`copy-${id}`).size(20).flex_none().rounded(4).cursor_pointer().hover((el) => el.bg(t.hover))
      .tooltip(`Copy ${label}`).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
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
    if(this.caps().hostWorkerViews)return div().when(!!id,el=>el.id(id)).text_size(11.5).text_color(t.dim).child(reason);
    return div().when(!!id, el => el.id(id)).text_size(11.5).text_color(t.dim)
      .tooltip(`${reason}\nProvider: https://github.com/mvschwarz/openrig/pull/2744\nFollow and custom grids need additional upstream support; see the README's Worker views section.`)
      .child(this.workerCapabilityMessage());
  }
  card(t, title, children, meta = null) {
    const { compact, tight } = pageBodyLayout(this.pageWidth);
    return v_flex().rounded(10).bg(t.background).border_1().border_color(t.border).p(tight ? 10 : 12).gap(8)
      .when(!!title, (el) => el.child((compact ? v_flex() : h_flex()).when(!compact, e => e.items_center()).gap(compact ? 4 : 0).child(div().when(!compact, e => e.flex_1()).text_size(12.5).font_semibold().text_color(t.foreground).child(title))
        .when(!!meta, (h) => h.child(typeof meta === "string" ? div().text_size(11.5).text_color(t.dim).child(meta) : meta))))
      .children(children);
  }
  button(t, id, label, onClick, { primary = false, iconName = null, small = false, disabled = false, tooltip = null, actionKey = null } = {}) {
    if(this.inPageActions&&(this.pageWidth??960)<480&&iconName&&!primary){tooltip??=label;label="";}
    const busyKey = shared("rig.busyAction");
    const busy = Boolean(busyKey && (busyKey === id || (actionKey && busyKey === actionKey)));
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
    return v_flex().gap(compact ? 6 : 4).children(rows.filter(Boolean).map(([k, v, mono], i) => (compact ? v_flex() : h_flex()).id(`kv-row-${group}-${i}`).gap(compact ? 2 : 10).items_start()
      .child(div().when(!compact, el => el.w(120).flex_none()).text_size(compact ? 11 : 12).text_color(t.dim).child(k))
      .child(div().when(compact, el => el.w_full()).when(!compact, el => el.flex_1()).min_w(0).when(!!mono, (el) => el.font_family(settings()?.font_family ?? "monospace"))
        .child(exact(k, v) ? this.copyValue(t, String(v), `field-${group}-${i}`, k) : this.plain(t, v, `field-${group}-${i}`)))));
  }
  skeleton(t) { return v_flex().gap(6).children([0, 1, 2].map((i) => div().h(12).w(220 - i * 40).rounded(3).bg(t.raised))); }
  /** What a read looks like while loading or failed; null when there is data (a failed refresh of drawn data is the
   *  page's `refreshNote` instead). */
  status(t, cx, path, got) {
    if (got.error && got.data === undefined) {
      return v_flex().rounded(10).border_1().border_color(t.blocked).p(12).gap(8)
        .child(div().text_size(12).text_color(t.blocked).child(got.error))
        .child(h_flex().gap(8).items_center().child(this.button(t, `retry-${path}`, "Retry", (_e, cx) => { this.read(cx, path, true); cx.notify(); }))
          .when(!!got.at, (el) => el.child(this.dim(t, `as of ${this.time(got.at)}`))));
    }
    if (got.data === undefined) return this.skeleton(t);
    return null;
  }
  /** Reads this page drew that failed to refresh: their last good answer stays drawn, and this says so, with Retry. */
  refreshNote(t) {
    const failed = [...(this.reading ?? [])].filter((p) => this.cache[p]?.error && this.cache[p].data !== undefined);
    if (!failed.length) return null;
    const first = this.cache[failed[0]];
    const asOf = first.at ? this.time(first.at) : null;
    return h_flex().id("rig-refresh-error").gap(8).items_center().px(10).py(6).rounded(8).border_1().border_color(t.blocked)
      .child(svg(icon("rig-alert")).size(12).flex_none().text_color(t.blocked))
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.blocked)
        .child(`Couldn't refresh: ${first.error}${failed.length > 1 ? ` (and ${failed.length - 1} more)` : ""}.${asOf ? ` Showing what was read at ${asOf}.` : ""}`))
      .child(this.button(t, "rig-refresh-retry", "Retry", (_e, cx) => { for (const p of failed) this.read(cx, p, true); cx.notify(); }, { small: true }));
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
        .child(c && typeof c === "object" ? c : header ? String(c ?? "") : this.plain(t, String(c ?? ""), `cell-${idPrefix}-${rowId}-${i}`));
    };
    return v_flex()
      .child(h_flex().px(8).h(24).gap(10).items_center().border_b(1).border_color(t.border).children(cols.map(([label], i) => cell(label, i, true))).child(div().w(12)))
      .children(rows.length ? rows.map((r, i) => {
        const key = `table:${idPrefix}:${i}`;
        this.pageRows?.push({ key, open: r.onClick ? () => r.onClick() : null });
        let el = h_flex().id(`${idPrefix}-${i}`).px(8).h(30).overflow_hidden().gap(10).items_center().rounded(6).hover((s) => s.bg(t.hover))
          .when(this.pageSel === key, row => row.bg(t.selection ?? `${t.accent}1f`))
          .on_click(r.onClick ?? ((_e, cx) => this.selectPageRow(key, cx)));
        if (r.onRight) el = el.on_mouse_down("right", r.onRight);
        return el.children(r.cells.map((c, j) => cell(c, j, false, i)))
          .child(r.onClick ? svg(icon("chevron-right")).size(12).flex_none().text_color(t.dim) : div().w(12));
      }) : [div().p(10).text_size(12).text_color(t.dim).child(f ? `No matches for /${this.filter}.` : emptyText)]);
  }
  fileRow(t, id, path, label) {
    return h_flex().id(id).px(8).h(28).gap(8).items_center().rounded(6).hover((s) => s.bg(t.hover)).on_click(() => push(fileEntry(path, label)))
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
          else {
            const th = theme();
            // The component, font and syntax colours of herdr's Files viewer (defaults/mods/files/main.js).
            this.files[path] = { state: EditorState.new({ language: fileLanguage(path), readonly: true,
              value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
              font_family: settings().font_family, font_size: 12,
              syntax: { keyword: th.ansi5, string: th.ansi2, comment: th.dim, function: th.ansi4, type: th.ansi3, number: th.ansi1, constant: th.ansi6 } }) };
          }
        } catch (_) { this.files[path] = { error: "Cannot preview this file (binary, too large, or unreadable)" }; }
        cx.notify();
      });
    }
    return v_flex().id("rig-file").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_key_down(()=>{this.typing=true;})
      .child(f.state ? Editor.new(f.state).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(f.error || "Loading file…"));
  }

  /** A file page's one header, as herdr's Files draws it: Back, "Files", reload, the path, and ×. */
  fileHeader(t, entry) {
    const path = entry.path;
    return h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().id("rig-back").cursor_pointer().on_click(() => this.back()).child(svg(icon("chevron-left")).size(14).text_color(t.muted)))
      .child(div().font_semibold().text_size(13).child("Files"))
      .child(div().id("rig-file-reload").cursor_pointer().on_click((_e, cx) => { this.files[path]?.state?.release?.(); delete this.files[path]; cx.notify(); })
        .child(svg(icon("rig-refresh")).size(12).text_color(t.dim)))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).tooltip(String(path??"")).child(path))
      .child(this.copyButton(t, path, "file-path", "path"))
      .child(div().id("rig-close").cursor_pointer().on_click(() => closeInspection()).child(svg(icon("x")).size(14).text_color(t.muted)));
  }

  // ---- sections --------------------------------------------------------------------------------------------------
  hostedMembers(cx){
    const config=this.config;
    if(!config?.connectionId||!config.daemonUrl)return null;
    const supplied=sharedRigData(this.config, shared)?.hostedMembers;
    if(supplied?.conn===config.connectionId&&supplied.origin===config.daemonUrl)return supplied;
    const key=`/api/queue/hosted-members:${config.connectionId}`,cached=this.cache[key];
    if((!cached||cached.stale)&&!cached?.loading&&typeof cx?.spawn==='function'){
      this.cache[key]={loading:true};
      cx.spawn(async task=>{this.hostedReader??=new HostedMembersReader();const data=await this.hostedReader.read(fetch,config,(ms,done)=>task.timer.after(ms,done));
        if(this.config?.connectionId===config.connectionId&&this.config?.daemonUrl===config.daemonUrl)this.cache[key]={data,at:Date.now(),...(this.cache[key]?.stale?{stale:true}:{})};
        task.notify();});
    }
    const got=this.cache[key]?.data;
    return got?.conn===config.connectionId&&got.origin===config.daemonUrl?got:null;
  }

  assistantCard(t,cx,entry){
    if(!entry.conn||entry.conn!==this.config?.connectionId)return this.dim(t,'This assistant belongs to another OpenRig connection. Open it from that connection.');
    const roster=this.hostedMembers(cx);
    if(!roster)return this.dim(t,'Reading connected assistants…');
    if(roster.state==='unavailable')return this.dim(t,roster.line);
    const member=roster.members.find(m=>!m.invalid&&m.seat===entry.session&&m.conn===entry.conn);
    if(!member)return this.dim(t,'This assistant is not in this OpenRig\'s connected roster.');
    const target=assistantTarget(member,{id:entry.rigId}),last=member.lastCheckInAt?this.time(member.lastCheckInAt):null,word=assistantWord(member.status);
    this.pageHeading={title:member.name,icon:'rig-queue',status:`Connected assistant · ${member.rig}`};
    this.pageActions=h_flex().gap(8).items_center().flex_wrap()
      .child(this.button(t,'assistant-queue','Queue work…',()=>openOverlay({mod:MOD_IDS.menu,kind:'dialog',width:460,height:300,props:{target,step:{input:true,placeholder:'One-line summary; the body follows on the next lines',action:'queue',multiLine:true}}}),{iconName:'rig-queue'}))
      .child(this.button(t,'assistant-open-rig','Open rig page',()=>push({section:'topology',kind:'rig',conn:member.conn,rigId:entry.rigId,name:member.rig}),{small:true}));
    const path=seatQueuePaths(member.seat).open,got=this.read(cx,path),queue=seatQueueDetails(got.data,null);
    const records=[...queue.current,...queue.pending,...queue.blocked];
    const sentence=assistantSentence(member,value=>this.time(value));
    return v_flex().id('assistant-detail').gap(12)
      .child(this.card(t,'Check-in',[this.dim(t,sentence),this.kv(t,[['Address',member.seat,true],['Last check-in',member.lastCheckInAt?this.time(member.lastCheckInAt,{exact:true}):'No check-in yet'],
        ['Expected cadence',member.expectedMinutes?`Every ${member.expectedMinutes} min`:member.onRequest?'On request':'Not reported'],['Evidence',member.reporter==='openrig-observed'?'Observed by OpenRig':['openrig-adapter','outside-adapter'].includes(member.reporter)?'Reported by an adapter':'Not reported'],...(member.reason?[['Reason',member.reason]]:[])])]))
      .child(this.card(t,'Queued to it',got.error?[this.dim(t,'Queue unavailable.')]:!got.data?[this.dim(t,'Reading queue…')]:records.length?records.map(item=>
        v_flex().id(`assistant-queue-${item.qitemId??item.id}`).gap(3).child(div().text_size(12).text_color(t.foreground).child(item.summary??item.body??'Queue item'))
          .child(this.dim(t,item.state??'not reported'))):[this.dim(t,'No open queue items.')]));
  }

  topology(t, cx, entry) {
    if (entry.kind === 'assistant') return this.assistantCard(t,cx,entry);
    if (entry.kind === "seat") return this.seatCard(t, cx, entry);
    if (entry.kind === "host") return this.hostCard(t, cx, entry);
    if (entry.kind === "pod") return this.podCard(t, cx, entry);
    const summary = this.read(cx, "/api/rigs/summary");
    const att = this.read(cx, "/api/attention");
    const attentionItems = att.data?.items ?? sharedRigData(this.config, shared)?.attention?.items ?? [];
    // One rig (`Topology › factory`): the same block, alone. It reads its own seats at once.
    if (entry.kind === "rig" && entry.rigId) {
      const one = (summary.data ?? []).find((r) => r.id === entry.rigId) ?? { id: entry.rigId, name: entry.name };
      return this.rigBlock(t, cx, one, { entry, rigCount: summary.data?.length ?? 1, attentionItems });
    }
    const wait = this.status(t, cx, "/api/rigs/summary", summary);
    if (wait) return wait;
    const rigs = summary.data.filter((r) => !r.archivedAt);
    if (entry.kind === "rig") {
      const one = rigs.find((r) => r.name === entry.name);
      return one ? this.rigBlock(t, cx, one, { entry, rigCount: rigs.length, attentionItems }) : this.dim(t, `No rig ${entry.name} on this daemon.`);
    }
    const focusTarget = entry.focusRig ?? shared("rig.focusRig") ?? shared("rig.focus") ?? entry.focus ?? null;
    const loadedModels=rigs.map((r)=>{const nodesState=this.nodesOf(cx,r.id);return {rig:r,...rigModel(r,nodesState.data,[],this.config?.connectionId),nodesState};});
    const modelList = orderRigs(loadedModels, focusTarget);
    const allSeats = modelList.flatMap((m) => m.seats);
    const models = modelList.map((m) => m.rig);
    // A failed node read has its own group error; retained cache rows are not live chip counts.
    const strip = this.pulseStrip(t, modelList.filter(m=>!m.nodesState?.error), attentionItems, summary.at, entry);
    this.topologyStrip=strip;
    if((entry.topologyTab??this.activePageView)==='seats'){
      this.allSeatsOrder=entry.seatsOrder??this.allSeatsOrder??'rig';
      return allSeatsView(this,t,cx,loadedModels,attentionItems,{navigate:push,menu,hostedMembers:this.hostedMembers(cx),orderMap:shared('rig.order')??{},openSpecs:()=>push({section:'specs'}),
        attach:(target,cx)=>cx.spawn(async cx=>{
          const result=await attachToSeat({exec,run,hc,spaces,panes,terminals,layout,shared,setShared,wait:waitWith(cx),relayPath:attachRelayPath(appHome(),MOD_IDS.view)},target,this.config);
          if(result?.ok===false)notify({title:`Attach ${target.logicalId}`,body:result.reason,level:'warning'});
        })});
    }
    const missingFocusRig = entry.focusRig && !rigs.some((r) => r.id === entry.focusRig || r.name === entry.focusRig)
      ? div().id("topology-missing-rig").text_size(12).text_color(t.blocked).child(`No rig "${entry.focusRig}" found.`)
      : null;
    const blocks = models.map((r) => this.rigBlock(t, cx, r, { entry, rigCount: rigs.length, attentionItems, allSeats, allowPulseFilter: true })).filter(Boolean);
    return v_flex().gap(12)
      .when(Boolean(this.pulseFilter), el => el.child(this.pulseFilterBar(t, modelList, attentionItems, cx)))
      .child(this.topologyRecent(t, cx, rigs))
      .when(!!missingFocusRig, (el) => el.child(missingFocusRig))
      .children(blocks.length ? blocks : [this.dim(t, this.filter ? `No matches for /${this.filter}.` : "No rigs registered — run rig up <spec> to launch a team.")])
      // A new rig, from a spec in the library or with one seat.
      .child(h_flex().child(this.button(t, "topology-new-rig", "New rig…", () => openOverlay(newRigOverlay(this.config?.connectionId)), { small: true, iconName: "plus" })));
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
      content = v_flex().gap(6)
        .child(this.dim(t, "Recorded queue changes · oldest to newest"))
        .children(rows.map((row) => {
          const key = String(row.transitionId), summary = String(row.summary || row.bodyPreview || "No work served").replace(/\s+/g, " ").slice(0, 240);
          const selected = this.recentSelected?.transitionId === row.transitionId;
          return v_flex().gap(4)
            .child(h_flex().id(`topology-recent-event-${key}`).gap(8).px(6).py(4).rounded(6).items_center().cursor_pointer().hover((el) => el.bg(t.hover))
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
        .when(all.length > 5, (el) => el.child(this.button(t, "topology-recent-expand", this.recentExpanded ? "Show latest 5" : `Show ${all.length}`, (_e, cx) => { this.recentExpanded = !this.recentExpanded; cx.notify(); }, { small: true })));
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
      const m = rigModel(r, this.nodesOf(cx, r.id).data, [], this.config?.connectionId);
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
        ["Status", hostRec?.status ?? hostRec?.state ?? "online"],
        ["Rigs on host", String(hostRigs.length)],
        ["Seats on host", String(seatCount)],
      ])]))
      .child(this.card(t, "Rigs", [this.table(
        t,
        `host-rigs-${hostId}`,
        [["Rig"], ["Lifecycle", 110], ["Seats", 80, "right"]],
        hostRigs.map(({ rig, model, seatsOnHost }) => ({
          cells: [rig.name, model.lifecycle ?? "running", String(seatsOnHost.length)],
          onClick: () => push({ section: "topology", kind: "rig", rigId: rig.id, conn: rig.conn, name: rig.name }),
        })),
        `No rigs on host ${hostId}.`,
      )]))
      .children(archivedElements({ div, svg, h_flex }, t, withArchivedHosts(archived.data, id => this.read(cx, `/api/rigs/${encodeURIComponent(id)}/nodes`).data, this.config?.connectionId), { host: hostId, icon, open: Boolean(this.archivedOpen?.[hostId]),
        toggle: (_e, cx) => { (this.archivedOpen ??= {})[hostId] = !this.archivedOpen?.[hostId]; cx.notify(); },
        restore: r => oneClick({ kind: "rig", rig: r.name, rigId: r.id, conn: r.conn, archived: true, lifecycle: "stopped" }, "unarchive-rig"),
        menu: r => menu({ kind: "rig", rig: r.name, rigId: r.id, conn: r.conn, archived: true, lifecycle: "stopped" }),
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
    const rigObj = { id: entry.rigId, name: entry.rig, lifecycleState: entry.lifecycle ?? "running" };
    const model = rigModel(rigObj, nodes.data, [], this.config?.connectionId);
    const podSeats = model.seats.filter((s) => s.pod === podName);
    const counts = statusCounts(podSeats);
    const nativeSeats = this.read(cx, `/api/native-seats?rig=${encodeURIComponent(entry.rig)}`).data?.seats ?? [];
    const nativeBySession = new Map(nativeSeats.map((ns) => [ns.sessionName, ns]));
    const attentionItems = (this.cache["/api/attention"]?.data?.items ?? sharedRigData(this.config, shared)?.attention?.items ?? []).map(needTarget);
    return v_flex().id(`pod-page-${entry.rigId ?? entry.rig}-${podName}`).gap(12)
      .child(this.title(t, `Pod ${podName} · ${entry.rig}`))
      .child(this.card(t, "Pod", [this.kv(t, [
        ["Rig", entry.rig],
        ["Pod", podName],
        ["Seats", `${podSeats.length} (${counts.working} working · ${counts.needs} needs you · ${counts.idle} idle${counts.unreported?` · ${counts.unreported} not reported`:""})`],
      ])]))
      .child(this.card(t, "Seats", podSeats.length
        ? podSeats.map((s) => {
            const ns = nativeBySession.get(s.session);
            const seatNeed = attentionItems.find((it) => !it.update && (it.session === s.session || (it.rig === entry.rig && it.logicalId === s.logicalId)));
            return this.seatChip(t, rigObj, s, model.lifecycle, { nativeSeat: ns, seatNeed });
          })
        : [this.dim(t, `No seats in pod ${podName}.`)]));
  }

  /** One-line clickable pulse status strip at top of Topology. */
  pulseStrip(t, modelList, attentionItems, updatedAt, entry = {}) {
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
        .when(key === "idle", el => el.tooltip("Idle, done or stopped"))
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
        .child(seg("pulse-filter-needs", "needs", `${counts.needs} needs you`, t.blocked, "needs_input"))
        .child(seg("pulse-filter-idle", "idle", `${counts.idle} idle`, t.muted, "idle"))
        .when(counts.unreported>0,el=>el.child(seg("pulse-filter-unreported","unreported",`${counts.unreported} not reported`,t.dim,"unknown"))))
      .child(div().flex_1())
      .when(!seatsTab,el=>el.child(h_flex().id("topology-expand-all").px(8).h(22).items_center().rounded(6).cursor_pointer()
        .bg(t.raised).border_1().border_color(t.border).hover((s) => s.bg(t.hover))
        .on_click(() => setShared("rig.open.page", expandAllTopology(shared("rig.open.page"), topoForFold)))
        .child(div().text_size(11.5).text_color(t.foreground).child("Expand all"))))
      .when(!seatsTab,el=>el.child(h_flex().id("topology-collapse-all").px(8).h(22).items_center().rounded(6).cursor_pointer()
        .bg(t.raised).border_1().border_color(t.border).hover((s) => s.bg(t.hover))
        .on_click(() => setShared("rig.open.page", collapseAllTopology(shared("rig.open.page"), topoForFold)))
        .child(div().text_size(11.5).text_color(t.foreground).child("Collapse all"))))
      .child(div().text_size(11).text_color(t.dim).child(`updated ${ageSec}s ago`));
  }

  pulseFilterBar(t, models, attentionItems) {
    const filter = this.pulseFilter;
    const hidden = models.reduce((n, model) => n + model.seats.filter(seat => !matchesPulseFilter(seat, model, filter, attentionItems)).length, 0);
    const label = { idle: "Idle", working: "Working", blocked: "Blocked", needs: "Needs you", unreported:"Not reported" }[filter] ?? filter;
    return h_flex().id("pulse-filter-notice").gap(8).items_center().text_size(12).text_color(t.muted)
      .child(`Showing ${label} · ${hidden} hidden`)
      .child(div().id("pulse-show-all").text_color(t.accent).cursor_pointer()
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

  /** A rig's nodes: this page's read, else what the sidebar already holds (so a block isn't empty while its own read lands). */
  nodesOf(cx, rigId) {
    const got = this.read(cx, `/api/rigs/${encodeURIComponent(rigId)}/nodes`);
    const snapshot = sharedRigData(this.config, shared);
    const nodes = snapshot?.nodesByRig?.[rigId];
    return nodes !== undefined && (got.data === undefined || got.sharedAt !== snapshot.at)
      ? { ...got, data: nodes } : got;
  }

  // ---- visible screen narration: public transcript tails, never runtime/harness files -----------------------------
  resetNowTails(cx) {
    this.nowTails?.close(); this.nowDue = true; this.nowWidths = Object.create(null); this.nowSignature = null;
    this.nowTails = new NowTailCache(async seat => {
      const origin = await this.resolveDaemonUrl();
      if (!origin) return { ok: false, error: "OpenRig daemon is unavailable." };
      const response = await fetch(`${origin}/api/transcripts/${encodeURIComponent(seat.session)}/tail?lines=40`);
      const data = await response.json(); return { ok: response.ok, status: response.status, data };
    }, () => { if (!this.closed) cx.notify(); });
  }
  refreshNowTails(cx) {
    if (!this.nowTails || this.closed || !this.config || this.config.missing) return;
    const seats = [...(this.nowSeats?.values() ?? [])], signature = seats.map(s => `${s.session}:${s.open ? "open" : s.status}`).join("|");
    if (!this.nowDue && signature === this.nowSignature) return;
    this.nowDue = false; this.nowSignature = signature;
    // This is called only by native render, not by a poll callback. The current page has no virtual-range API:
    // use the approved expanded-rig/pod fallback, bounded by NowTailCache to 12 seats and four requests.
    cx.spawn(async () => { this.nowTails?.refresh(seats); });
  }
  nowLines(t, state, key) {
    return v_flex().max_h(240).overflow_y_scrollbar().p(8).gap(3).rounded(6).bg(t.raised)
      .children(state.lines.map((line, i) => this.plain(t, line, `now-lines-${key}-${i}`).font_family("Geist Mono").text_size(11.5)));
  }
  nowTranscript(seat) {
    const file = transcriptPath(this.config, seat.rig, seat.session);
    return file ? () => push(fileEntry(file, `${seat.logicalId ?? seat.session} transcript`)) : null;
  }
  nowRow(t, seat, openSeat) {
    const state = nowTailPresentation(this.nowTails?.records.get(seat.session),Date.now(),this.uiTimezone);
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
    const link = (id, label, act) => div().id(id).text_size(12).text_color(act ? t.accent : t.dim)
      .when(!!act, el => el.cursor_pointer()).on_click((_e, cx) => { cx.stop_propagation(); act?.(); }).child(label);
    const hover = v_flex().w(420).p(12).gap(8).rounded(8).bg(t.background).border_1().border_color(t.border)
      .child(div().text_size(12).text_color(t.muted).child(`${seat.logicalId} · ${state.state} · as of ${state.asOf}`))
      .child(div().text_size(12).text_color(state.stale ? t.dim : t.foreground).child(`${state.prefix}${state.line}`))
      .child(this.nowLines(t, state, `hover-${seat.session}`))
      .child(h_flex().gap(12).child(link(`now-seat-${seat.session}`, "Open seat", openSeat))
        .child(link(`now-transcript-${seat.session}`, "Open transcript", openTranscript)));
    return div().id(`seat-now-${seat.session}`).flex_1().min_w(0)
      .on_size_change((size, cx) => {
        const visible = size.width >= 160;
        if (this.nowWidths?.[seat.session] !== visible) { (this.nowWidths ??= Object.create(null))[seat.session] = visible; cx.notify(); }
      })
      .when(Boolean(state.line) && this.nowWidths?.[seat.session] !== false, el => el.child(HoverCard.new(`now-hover-${seat.session}`).open_delay(600).trigger(line).content(hover)));
  }
  nowBlock(t, seat, openTranscript) {
    const state = nowTailPresentation(this.nowTails?.records.get(seat.session),Date.now(),this.uiTimezone);
    const { compact } = pageBodyLayout(this.pageWidth);
    return this.card(t, "Now", [
      (compact ? v_flex() : h_flex()).id("seat-now-meta").w_full().gap(8).when(!compact, el => el.items_center()).child(div().when(!compact, el => el.flex_1()).min_w(0)
        .child(this.plain(t, `as of ${state.asOf} · ${state.state}${state.stale || state.state === "withheld" ? ` · ${state.reason}` : ""}`, "seat-now-state").text_size(11.5).text_color(t.muted)))
        .child(div().flex_none().id("seat-now-open-transcript").text_size(12).text_color(t.accent).cursor_pointer().on_click(openTranscript).child("Open transcript")),
      div().id("seat-now-summary").text_size(12.5).text_color(state.stale ? t.dim : t.foreground)
        .child(state.line ? `${state.prefix}${state.line}` : "No recent screen text from OpenRig."),
      ...(state.lines.length ? [this.nowLines(t, state, `page-${seat.session}`)] : []),
    ]);
  }

  invalidateLiveReads() {
    this.nowDue = true;
    markStale(this.cache, (path) => path==='/api/config/ui.timezone' || path.startsWith('/api/views/execution?') || path.startsWith("/api/rigs") || path.startsWith("/api/attention") || path.startsWith("/api/health") || path.startsWith("/api/native-seats") || path.startsWith("/api/queue") || path.startsWith("/api/gateway"));
  }

  /** One rig as a block: header with status counts, action bar, health banner, Edges, then pods as lines of seat chips.
   *  Used on the Topology page and, alone, in the inspector. A filter that leaves nothing of the rig leaves its header, dim. */
  rigBlock(t, cx, rig, { entry = {}, rigCount = 1, attentionItems = [], allSeats = [], allowPulseFilter = false } = {}) {
    const { compact, tight, graphHidden } = pageBodyLayout(this.pageWidth);
    const nodesPath = `/api/rigs/${encodeURIComponent(rig.id)}/nodes`;
    const nodes = this.nodesOf(cx, rig.id);
    const model = rigModel(rig, nodes.data, [], this.config?.connectionId);
    const lifecycle = model.lifecycle;
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
    const tone = counts.needs ? "needs_input" : counts.blocked ? "blocked" : counts.working ? "working" : rigTone(model.seats);
    const target = { kind: "rig", rig: rig.name, rigId: rig.id, conn: rig.conn, lifecycle };
    const viewTarget = { kind: "rig", rig: rig.name, rigId: rig.id, conn: rig.conn, view: `rig:${rig.name}` };
    const dialog = (step, height) => openOverlay({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height, props: { target, step } });
    const more = () => this.moreButton(t, `rig-more-${rig.id}`, () => menu(target));
    const showBody = dedicated || expanded && (!noMatch || Boolean(pulseFilter));
    const rigRowKey = rigKey(rig.id);
    const rigEntry = { section: "topology", kind: "rig", rigId: rig.id, conn: rig.conn, name: rig.name };
    this.pageRows?.push({ key: rigRowKey, foldKey: rigRowKey, expandable: true, isOpen: expanded, entry: rigEntry, target, seats: model.seats });
    const rigSelected = this.pageSel === rigRowKey;
    const resume = () => this.button(t, `rig-resume-${rig.id}`, "Resume…", () => dialog({ action: "resume", confirm: true }, 380), { small: true, iconName: "rig-play" });
    // A count filters the page to seats in that state.
    const count = (n, word, color, key) => n ? h_flex().id(`rig-count-${key}-${rig.name}`).gap(4).items_center().cursor_pointer().on_click(() => { push({ ...(entry.section ? entry : { section: "topology" }), filter: word }); })
      .child(div().text_size(11.5).text_color(color === "working" ? (t.ansi2 ?? t.working) : color === "blocked" ? t.blocked : color==="dim"?t.dim:t.muted).child(`${n} ${word}`)) : null;
    const lifecycleText = stoppedRig && lifecycle === "recoverable" ? "stopped (recoverable)" : (lifecycle ?? "unknown");
    if(dedicated)this.pageHeading={title:rig.name,tone,status:`${lifecycleText} · ${model.seats.length} seats · ${counts.working} working · ${counts.needs} needs you · ${counts.idle} idle${counts.unreported?` · ${counts.unreported} not reported`:""}`};
    const head = h_flex().id(`rig-head-${rig.id}`).px(4).when(!compact, el => el.h(30)).when(compact, el => el.flex_wrap().py(4)).gap(8).items_center().rounded(6).hover((s) => s.bg(t.hover))
      .when(rigSelected, (e) => e.bg(t.selection ?? `${t.accent}1f`).border_l(2).border_color(t.accent))
      .on_click((e, cx) => { if ((e?.click_count ?? 1) >= 2) push(rigEntry); else this.selectPageRow(rigRowKey, cx); })
      .on_mouse_down("right", () => menu(target))
      .child(div().id(`rig-fold-${rig.id}`).w(14).flex_none().text_color(t.dim).on_click((_e, cx) => { cx?.stop_propagation?.(); toggleOpen(rigKey(rig.id), expanded, model.seats); })
        .child(svg(icon(expanded ? "chevron-down" : "chevron-right")).size(12)))
      .child(this.dot(t, tone))
      .child(div().id(`rig-name-${rig.id}`).text_size(13).font_semibold().text_color(t.foreground).cursor_pointer().hover(el=>el.underline())
        .tooltip(`Open ${rig.name}`).on_click((_e,cx)=>{cx.stop_propagation();push({...rigEntry,tab:"table"});}).child(rig.name))
      .when(!tight, el => el.child(div().text_size(12).text_color(t.muted).child(`${lifecycleText} · ${model.seats.length} seat${model.seats.length === 1 ? "" : "s"}`)))
      .child(h_flex().id(`rig-counts-${rig.id}`).gap(8).when(compact, el => el.w_full().flex_wrap())
        .children([count(counts.working, "working", "working", "working"), count(counts.blocked, "blocked", "blocked", "blocked"), count(counts.needs, "needs you", "blocked", "needs"), count(counts.idle, "idle", "idle", "idle"),count(counts.unreported,"not reported","dim","unreported")].filter(Boolean)))
      .when(noMatch, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("no matching seats")))
      .child(div().flex_1())
      .when(!showBody && (stoppedRig || lifecycle !== "running"), (el) => el.child(resume()))
      .when(!showBody, (el) => el.child(more()));
    const body = [];
    if (showBody) {
      const followed = (stripProps()?.views ?? []).find((v) => v.following?.target === `rig:${rig.name}`);
      const on = this.hostWorkerEntry(`rig:${rig.name}`)?.following??!!followed?.following?.enabled;
      const caps = this.caps();
      const workerReason = capabilityDisableReason("open-view", caps);
      const designReason = capabilityDisableReason("design-view", caps);
      const followReason = capabilityDisableReason(on ? "unfollow" : "follow", caps);
      this.inPageActions=dedicated;
      const actionBar=h_flex().gap(6).items_center().flex_wrap()
        .child(this.button(t, `rig-worker-view-${rig.id}`, "Worker view", () => oneClick(viewTarget, "open-view", `rig-worker-view-${rig.id}`), { small: true, iconName: "rig-view", disabled: !!workerReason, tooltip: workerReason??(caps.hostWorkerViews?`Opens here; tiles run on ${this.config.daemonMachine}.`:null), actionKey: "open-view" }))
        .child(this.button(t, `rig-act-design-${rig.name}`, "Design view…", () => openOverlay({ mod: MOD_IDS.menu, kind: "dialog", modal: true, width: 680, height: 460, props: { target, step: { action: "design-view" } } }), { small: true, iconName: "rig-view", disabled: !!designReason, tooltip: designReason }))
        .child(this.button(t, `rig-follow-${rig.id}`, on ? "Following" : "Follow", () => oneClick(viewTarget, on ? "unfollow" : "follow", `rig-follow-${rig.id}`), { small: true, iconName: on ? "check" : "rig-follow", disabled: !!followReason, tooltip: followReason, actionKey: on ? "unfollow" : "follow" }))
        .child(this.button(t, `rig-snapshot-${rig.id}`, "Snapshot", () => oneClick({ kind: "rig", rig: rig.name, rigId: rig.id, conn: rig.conn }, "snapshot", `rig-snapshot-${rig.id}`), { small: true, iconName: "rig-snapshot", actionKey: "snapshot" }))
        .when(!stoppedRig && lifecycle !== "stopped", (el) => el.child(this.button(t, `rig-pause-${rig.id}`, "Pause…", () => dialog({ action: "pause", load: "pause" }, 360), { small: true, iconName: "rig-pause" })))
        .when(stoppedRig || lifecycle !== "running", (el) => el.child(resume()))
        .child(div().flex_1()).child(more());
      this.inPageActions=false;
      if(dedicated)this.pageActions=actionBar;else body.push(actionBar);
      const workerLine=this.hostWorkerLine(t,rig);if(workerLine)body.push(workerLine);
      const capReasons = [...new Set([workerReason, followReason, designReason].filter(Boolean))];
      if (capReasons.length) {
        body.push(this.workerCapabilityNote(t, capReasons.join(" · "), `rig-cap-note-${rig.id}`));
      }
      if(!dedicated)body.push(this.objectTabs(t,{...rigEntry,tab:"table"},null,{prefix:`rig-${rig.id}`,active:"table"}));
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
            ["Seats", `${model.seats.length} (${counts.working} working · ${counts.needs} needs you · ${counts.idle} idle${counts.unreported?` · ${counts.unreported} not reported`:""})`],
          ])])));
        } else if (activeRigTab === "graph") {
          const graphPath = `/api/rigs/${encodeURIComponent(rig.id)}/graph`;
          const graphGot = this.read(cx, graphPath);
          const graphView=this.graphFor(`running:${rig.id}`);
          this.wideGraph=true;
          if(graphGot.data&&graphView.publicData!==graphGot.data){graphView.projection=normalizeRunningGraph(graphGot.data,model.seats);graphView.publicData=graphGot.data;}
          if(graphHidden)body.push(this.dim(t,"Widen the pane to see the graph.").id(`rig-graph-narrow-${rig.id}`));
          else if(graphGot.data)body.push(graphView.render(t,cx,graphView.projection,{
            id:`rig-graph-${rig.id}`,assets:ASSETS,running:true,reducedMotion:this.config?.reducedMotion===true,
            events:graphActivityOf(shared,this.config?.connectionId)?.origin===this.config?.daemonUrl?graphActivityOf(shared,this.config?.connectionId).events:[],
            open:s=>push({section:"topology",kind:"seat",rig:rig.name,rigId:rig.id,conn:rig.conn,name:s.lid}),
            menu:s=>menu({...s.node,kind:"seat",session:s.session,rig:rig.name,rigId:rig.id,conn:rig.conn,logicalId:s.lid}),
          }));
          else body.push(this.status(t,cx,graphPath,graphGot)??this.skeleton(t));
        }
      }
      if(!dedicated||entry.tab!=="overview")body.push(this.rigHealthEdges(t, cx, rig, { entry, rigCount, open }));
      if (nodes.data === undefined) body.push(this.status(t, cx, nodesPath, nodes));
      else if(!dedicated||entry.tab==="table")body.push(this.rigPods(t, cx, rig, model, seats, { lifecycle, open, preserveHidden: Boolean(pulseFilter) }));
      if(!dedicated||entry.tab==='table'){
        const group=assistantGroup(t,cx,this.hostedMembers(cx),{...rig,conn:rig.conn??this.config?.connectionId},{prefix:'page',icon,rows:this.pageRows,folds:shared('rig.open.page')??{},
          fold:(key,open)=>{setShared('rig.open.page',{...(shared('rig.open.page')??{}),[key]:open});this.persistStatePatch(cx);},
          select:(key,_entry,cx)=>this.selectPageRow(key,cx),open:push,menu});
        if(group)body.push(group);
      }
    }
    return v_flex().id(`rig-block-${rig.id}`).rounded(10).bg(t.background).border_1().border_color(focused ? t.accent : t.border).p(compact ? 4 : 10).gap(6).when(!dedicated,el=>el.child(head))
      .children(body.length ? [v_flex().ml(compact ? 8 : 22).pl(compact ? 6 : 10).gap(8).border_l(1).border_color(t.border).children(body)] : []);
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
    const row = (id, text, on, key, color) => h_flex().id(id).gap(4).items_center().cursor_pointer().on_click(() => toggleOpen(key, on))
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
        .child(h_flex().id(`rig-health-toggle-${rig.id}`).gap(6).items_center().cursor_pointer()
          .on_click(() => push({ section: "system", subview: "health", healthRigId: rig.id, healthRigName: rig.name }))
          .child(svg(icon(counts.worst === 2 ? "rig-diamond" : counts.problems ? "rig-warning" : "rig-info")).size(12).text_color(counts.worst === 2 ? t.blocked : counts.worst === 1 ? t.working : t.muted))
          .child(div().text_size(12).text_color(counts.worst === 2 ? t.blocked : counts.worst === 1 ? t.working : t.muted).child(`${text} in System → Health`))));
    }
    const recentGroup = v_flex().id(`rig-recent-group-${rig.name}`).gap(4)
      .child(h_flex().id(`rig-recent-toggle-${rig.name}`).gap(4).items_center().cursor_pointer().on_click(toggleRecent)
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
      const openGraph=()=>push({section:"topology",kind:"rig",rigId:rig.id,conn:rig.conn,name:rig.name,tab:"graph"});
      edgesGroup.child(div().id(`rig-open-graph-${rig.id}`).tab_stop(true).text_size(12).text_color(t.accent).cursor_pointer().hover(el=>el.underline())
        .on_click(openGraph).on_key_down((e,cx)=>{if(e.key==="enter"){cx.stop_propagation();openGraph();}}).child("Open the graph"));
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
    const topo = (sharedRigData(this.config, shared)?.topology?.length ? sharedRigData(this.config, shared).topology : null) ?? fallbackTopology;
    const missions = Array.isArray(scopesGot.data?.missions) ? scopesGot.data.missions : null;
    const attentionItems = Array.isArray(attGot.data?.items)
      ? attGot.data.items
      : (Array.isArray(sharedRigData(this.config, shared)?.attention?.items) ? sharedRigData(this.config, shared).attention.items : null);
    const rows = recentTransitionRows(got.data, topo, { missions, attentionItems, timezone:this.uiTimezone });
    if (!rows.length) return this.dim(t, "Nothing yet.");
    return v_flex().id(`${idPrefix}-list`).gap(2).children(rows.map((r, i) => {
      let el = h_flex().id(`${idPrefix}-row-${i}`).px(6).h(26).overflow_hidden().gap(8).items_center().rounded(6).text_size(12);
      if (r.navEntry) {
        el = el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => push(r.navEntry));
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
  rigPods(t, cx, rig, model, seats, { lifecycle, open, preserveHidden = false }) {
    const { compact, tight } = pageBodyLayout(this.pageWidth);
    if (!seats.length && !preserveHidden) return this.dim(t, this.filter ? "No matching seats." : "No seats.");
    const nativeSeats = this.read(cx, `/api/native-seats?rig=${encodeURIComponent(rig.name)}`).data?.seats
      ?? this.cache["/api/native-seats"]?.data?.seats
      ?? [];
    const nativeBySession = new Map(nativeSeats.map((ns) => [ns.sessionName, ns]));
    const attentionItems = (this.cache["/api/attention"]?.data?.items ?? sharedRigData(this.config, shared)?.attention?.items ?? []).map(needTarget);
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
        const countPills = [[c.working, "working", "working"], [c.blocked, "blocked", "blocked"], [c.needs, "needs you", "blocked"], [c.idle, "idle", "idle"],[c.unreported,"not reported","dim"]].filter(([n]) => n)
          .map(([n, word, tone]) => div().id(`pod-count-${word.replaceAll(" ", "-")}-${podId}`).text_size(11.5)
            .text_color(tone === "working" ? (t.ansi2 ?? t.working) : tone === "blocked" ? t.blocked : tone==="dim"?t.dim:t.muted).child(`${n} ${word}`));
        if (!podOpen && podSeats.length) {
          return h_flex().id(`pod-summary-${podId}`).pl(compact ? 0 : 8).pr(compact ? 0 : 8).when(!compact, el => el.h(26)).when(compact, el => el.flex_wrap().py(4)).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
            .when(podSelected, (e) => e.bg(t.selection ?? `${t.accent}1f`).border_l(2).border_color(t.accent))
            .on_click(() => toggleOpen(key, false, all))
            .child(svg(icon("chevron-right")).size(11).flex_none().text_color(t.dim))
            .child(div().text_size(12).font_medium().text_color(t.muted).child(tight ? label : `${label} · ${countText}`))
            .child(h_flex().id(`pod-counts-${podId}`).gap(8).when(compact, el => el.w_full().flex_wrap()).children(countPills))
            .child(div().flex_1()).child(div().text_size(11.5).text_color(t.accent).child("Show all"));
        }
        return v_flex().id(`pod-tree-${podId}`).gap(2)
          .child(h_flex().id(`topo-pod-${podId}`).pl(compact ? 0 : 8).pr(compact ? 0 : 8).when(!compact, el => el.h(26)).when(compact, el => el.flex_wrap().py(4)).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
            .when(podSelected, (e) => e.bg(t.selection ?? `${t.accent}1f`).border_l(2).border_color(t.accent))
            .on_click(() => toggleOpen(key, podOpen, all))
            .child(svg(icon(podOpen ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim))
            .child(div().text_size(12).font_medium().text_color(t.foreground).child(label))
            .when(!tight, el => el.child(div().text_size(11.5).text_color(t.dim).child(`· ${countText}`)))
            .child(h_flex().id(`pod-counts-${podId}`).gap(8).when(compact, el => el.w_full().flex_wrap()).children(countPills))
            .child(div().flex_1())
            .when(all.length > 12, (el) => el.child(div().id(`pod-collapse-${podId}`).text_size(11.5).text_color(t.dim).cursor_pointer()
              .on_click((_e, cx) => { cx?.stop_propagation?.(); toggleOpen(key, true, all); }).child("Collapse"))))
          .when(!podSeats.length && preserveHidden, el => el.child(div().text_size(12).text_color(t.dim).child(`${all.length === 1 ? "The seat is" : `All ${all.length} seats`} hidden by the filter`)))
          .child(v_flex().gap(2).children(podSeats.map((s) => {
            const ns = nativeBySession.get(s.session);
            const seatNeed = attentionItems.find((it) => !it.update && (it.session === s.session || (it.rig === rig.name && it.logicalId === s.logicalId)));
            return this.seatChip(t, rig, s, lifecycle, { nativeSeat: ns, seatNeed });
          })));
      });
    };
    return v_flex().gap(6).children(groups.flatMap(([host, list]) => [
      ...(host ? [div().text_size(11).text_color(t.dim).child(`host ${host}`)] : []), ...podLines(list, host)]));
  }

  /** A seat as an indented tree row (rig > pod > seat > helper) with runtime/model badge, slice badge, and quick actions. */
  seatChip(t, rig, s, lifecycle, { nativeSeat = null, seatNeed = null } = {}) {
    const { compact, tight } = pageBodyLayout(this.pageWidth);
    const rowStatus = seatNeed ? "needs_input" : s.status;
    if (!s.terminal) this.nowSeats?.set(s.session, s);
    // With herdr's panes and terminals, as the sidebar passes them: an attached seat tab is found and focused, not skipped.
    const click = seatClickTarget(stripProps(), activeRigViewId(), s.session, panes?.() ?? [], terminals?.() ?? []);
    const seatTarget = {
      kind: "seat",
      rig: rig.name,
      rigId: rig.id, conn: rig.conn,
      session: s.session,
      logicalId: s.logicalId,
      lifecycle,
      runtime: s.runtime,
      model: s.model,
      effort: s.effort,
      terminal: s.terminal,
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
      else push({ section: "topology", kind: "seat", rig: rig.name, rigId: rig.id, conn: rig.conn, name: s.logicalId, session: s.session });
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
    const seatEntry = { section: "topology", kind: "seat", rig: rig.name, rigId: rig.id, conn: rig.conn, name: s.logicalId, session: s.session, pod: s.pod };
    const rowKey = `seat:${s.session}`;
    const hKey = `helpers:${s.session}`;
    const openHelpers = helpers.length > 0 && (shared("rig.open.page") ?? {})[hKey] !== false;
    // A row for the page's keys: ↑/↓, ←/→, Enter opens, S and Q, the Menu key.
    this.pageRows?.push(helpers.length
      ? { key: rowKey, foldKey: hKey, expandable: true, isOpen: openHelpers, parentKey: podKey(rig.id, s.pod), entry: seatEntry, target: seatTarget, open: go }
      : { key: rowKey, expandable: false, parentKey: podKey(rig.id, s.pod), entry: seatEntry, target: seatTarget, open: go });
    const selected = this.pageSel === rowKey;
    const send = () => openOverlay({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: 260, props: { target: seatTarget, step: { input: true, placeholder: `Message to ${s.session}`, action: "send", multiLine: true } } });
    const queue = () => openOverlay({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: 300, props: { target: seatTarget, step: { input: true, placeholder: "One-line summary; the body follows on the next lines", action: "queue", multiLine: true } } });
    const answer = () => quickBtn(`seat-answer-${s.session}`, "Answer", () => {
      openNeed(setShared, { section: "needs", id: seatNeed.id });
      openOrFocusRigTab({ run, spaces, panes, layout, section: "needs" });
    }, { primary: true });
    this.seatActions[rowKey] = { send: s.terminal || sendReason ? null : send, queue: s.terminal || queueReason ? null : queue };
    return v_flex().id(`topo-seat-${s.session}`).gap(2)
      // One pattern per row: quiet unless selected; a click on the body selects, a double-click or the
      // name opens; the selected row shows Send… and Queue…; ⋯ is the right-click menu.
      .child(h_flex().id(`topo-seat-row-${s.session}`).pl(compact ? 0 : 12).pr(compact ? 0 : 8).h(28).gap(compact ? 4 : 6).items_center().rounded(6).cursor_pointer().hover((e) => e.bg(t.hover))
        .when(selected, (e) => e.bg(t.selection ?? `${t.accent}1f`).border_l(2).border_color(t.accent))
        .on_click((e, cx) => { if ((e?.click_count ?? 1) >= 2) go(); else this.selectPageRow(rowKey, cx); })
        .on_mouse_down("right", () => menu(seatTarget))
        .child(helpers.length
          ? div().id(`topo-seat-fold-${s.session}`).w(12).flex_none().text_color(t.dim)
            .on_click((_e, cx) => { cx?.stop_propagation?.(); setOpen(hKey, !openHelpers); })
            .child(svg(icon(openHelpers ? "chevron-down" : "chevron-right")).size(12))
          : div().w(compact ? 0 : 12).flex_none())
        .child(h_flex().id(`seat-chip-${s.session}`).flex_1().min_w(0).h(24).gap(6).items_center()
          .child(this.dot(t, rowStatus,14,s.session,this.statusMotion.seatNeeds(s.session,rig.name,s.logicalId)))
          .child(div().id(`seat-name-${s.session}`).text_size(12.5).text_color(t.foreground).hover((e) => e.text_color(t.accent))
            .when(compact, el => el.flex_1().min_w(0).truncate().tooltip(s.logicalId))
            .on_click((_e, cx) => { cx?.stop_propagation?.(); go(); })
            .child(tight ? s.logicalId?.split(".").at(-1) ?? s.logicalId : s.logicalId))
          .when(!tight, el => el.child(div().id(`seat-status-${s.session}`).text_size(11.5).text_color(t[statusMark(rowStatus).word] ?? t.muted).child(seatNeed ? "needs you" : s.word)))
          .when(!!runtimeBadge && !compact, (el) => el.child(div().id(`seat-runtime-${s.session}`).px(6).h(18).rounded(4).flex().items_center().bg(t.raised)
            .font_family(settings().font_family).text_size(11).text_color(t.dim).child(runtimeBadge)))
          .when(!!s.slice && !compact, (el) => el.child(div().id(`seat-slice-${s.session}`).px(6).h(18).rounded(4).flex().items_center().bg(t.raised)
            .text_size(11).text_color(t.accent).cursor_pointer()
            .on_click((_e, cx) => { cx?.stop_propagation?.(); push({ section: "scopes", slice: s.slice }); })
            .child(String(s.slice))))
          .when(!s.terminal && !compact, el => el.child(this.nowRow(t, { ...s, rig: rig.name }, () => push(seatEntry))))
          .when(click.kind === "card" && !tight, (el) => el.child(div().id(`seat-go-${s.session}`).text_size(12).text_color(t.dim)
            .on_click((_e, cx) => { cx?.stop_propagation?.(); go(); }).child("›"))))
        .child(h_flex().gap(4).items_center().flex_none()
          // Answer can't wait: it stays on the row whenever the seat has an open request.
          .when(!!seatNeed && !compact, (el) => el.child(answer()))
          // A terminal seat is a person's shell, not an agent: no message or work to give it.
          .when(selected && !s.terminal && !compact, (el) => el
            .child(quickBtn(`seat-send-${s.session}`, "Send…", send, { disabled: !!sendReason, tooltip: sendReason }))
            .child(quickBtn(`seat-queue-${s.session}`, "Queue…", queue, { disabled: !!queueReason, tooltip: queueReason })))
          .child(this.moreButton(t, `seat-more-${s.session}`, () => menu(seatTarget)))))
      .when(!!seatNeed && compact, el => el.child(h_flex().id(`seat-answer-line-${s.session}`).pl(18).pb(4).child(answer())))
      .children(openHelpers ? helpers.map((child, idx) =>
        h_flex().id(`topo-helper-${s.session}-${idx}`).pl(36).pr(8).h(24).gap(6).items_center().rounded(6).cursor_pointer().hover((e) => e.bg(t.hover))
          .on_click(() => run("terminal.peek", { terminal: child.address }))
          .child(div().w(12).flex_none())
          .child(svg(icon("rig-helper")).size(12).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).tooltip(String((child.name || (Array.isArray(child.argv) ? child.argv.join(" ") : "") || child.address)??"")).child(child.name || (Array.isArray(child.argv) ? child.argv.join(" ") : "") || child.address))
          .child(div().text_size(11).text_color(t.dim).child(child.status ?? ""))) : []);
  }

  /** The quiet ⋯ icon button: the row's menu (the right-click and the Menu key open the same). */
  moreButton(t, id, onClick) {
    return h_flex().id(id).size(20).rounded(5).items_center().justify_center().flex_none().cursor_pointer().text_color(t.dim)
      .hover((e) => e.bg(t.hover).text_color(t.foreground))
      .tooltip("More actions")
      .on_click((_e, cx) => { cx?.stop_propagation?.(); onClick(); })
      .child(svg(icon("rig-more")).size(14));
  }

  /** Select a row on the page (a click on its body, or the keys); the page takes the keyboard. */
  selectPageRow(key, cx) {
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
    if (act.type === "move") this.pageSel = act.key;
    else if (act.type === "expand" || act.type === "collapse") {
      if (row?.setOpen) row.setOpen(act.type === "expand");
      else toggleOpen(act.foldKey, act.type === "collapse", row?.seats);
    }
    else if (act.type === "activate") { if (row?.open) row.open(cx); else if (row?.entry) push(row.entry); }
    else if (act.type === "action") { const fn = this.seatActions?.[act.key]?.[act.action]; if (fn) fn(); }
    else if (act.type === "menu") { if (row?.target) menu(row.target); }
    cx?.notify?.();
    return true;
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
    const rawStatus = seatStatus(n);
    if (!isTerminalSeat(n)) this.nowSeats?.set(n.canonicalSessionName, { session: n.canonicalSessionName, runtime: n.runtime, status: rawStatus, open: true });
    const look = statusLook(rawStatus);
    const stoppedSeat = rawStatus === "stopped" || rawStatus === "exited" || n.lifecycleState === "stopped" || n.lifecycleState === "recoverable" || n.attachable === false;
    const rawCtx = n.contextUsage?.usedPercentage;
    const ctx = typeof rawCtx === "number" && Number.isFinite(rawCtx) ? Math.round(rawCtx) : null;
    const ctxWarn = typeof rawCtx === "number" && Number.isFinite(rawCtx) && rawCtx > 85;
    const inputTokens = n.contextUsage?.totalInputTokens ?? null;
    const outputTokens = n.contextUsage?.totalOutputTokens ?? null;
    const contextWindow = n.contextUsage?.contextWindowSize ?? null;
    const fmtTok = (v) => typeof v === "number" ? (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)) : String(v ?? "");

    const inlineEffort = n.effort ?? n.reasoningEffort ?? null;
    const effortPath = `/api/seat/effort/${encodeURIComponent(`${entry.name}@${entry.rig}`)}`;
    const effortGot = inlineEffort ? null : this.read(cx, effortPath);
    const effortText = inlineEffort ?? effortGot?.data?.effort ?? effortGot?.data?.currentEffort ?? (effortGot?.loading ? "loading…" : "default");

    // Shown for the person to read or copy; never run. Attach builds its own argv from the checked session.
    const attachCmd = n.tmuxAttachCommand ?? (isValidSessionName(n.canonicalSessionName) ? `tmux attach -t ${n.canonicalSessionName}` : "—");
    const transcript = transcriptPath(this.config, entry.rig, n.canonicalSessionName);

    const healthGot = this.read(cx, "/api/health");
    const seatFindings = (healthGot.data?.records ?? []).filter((r) => classifyHealth(r).actionable && (
      r.scope?.seatId === n.nodeId ||
      r.scope?.nodeId === n.nodeId ||
      r.scope?.seat === n.logicalId ||
      r.scope?.sessionName === n.canonicalSessionName ||
      r.scope?.session === n.canonicalSessionName),
    );

    const queuePaths = seatQueuePaths(n.canonicalSessionName);
    const qGot = this.read(cx, queuePaths.open), finishedGot = this.read(cx, queuePaths.finished);
    const queue = seatQueueDetails(qGot.data, finishedGot.data);
    const currentWork = queue.current, upNext = queue.pending, blockedWork = queue.blocked, recentlyFinished = queue.finished;
    const queueWarnings = [qGot.error, finishedGot.error].filter(Boolean);
    const depthText = queue.partial ? `at least ${queue.count}` : formatHonestCount(queue.count, { unknown: !queue.available });
    const ownedText = depthText;
    const basisText = qGot.error ? (queue.available ? `last successful read · ${`as of ${this.time(qGot.at)}`}` : "unavailable") : queue.available ? "live queue" : "reading…";
    const queueEmpty = (text) => queue.available ? text : qGot.error ? "Queue unavailable." : "Reading queue…";
    const activity = seatActivityDetails(n,Date.now(),this.uiTimezone);
    const activityWords = seatActivityWords(n,Date.now(),this.uiTimezone);

    const attGot = this.read(cx, "/api/attention");
    const allNeeds = (attGot.data?.items ?? sharedRigData(this.config, shared)?.attention?.items ?? []).map(needTarget);
    const seatNeeds = allNeeds.filter((it) => !it.update && (it.session === n.canonicalSessionName || (it.rig === entry.rig && it.logicalId === entry.name)));

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
    const dialog = (step, height) => openOverlay({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height, props: { target, step } });
    const live = seatClickTarget(stripProps(), activeRigViewId(), n.canonicalSessionName, panes?.() ?? [], terminals?.() ?? []);
    const seatViewReason = capabilityDisableReason("open-seat", this.caps());
    const attachReason = stoppedSeat ? "Stopped: seat has no running session to attach" : null;
    const sendReason = personDisableReason("send", this.config);
    const queueReason = personDisableReason("queue", this.config);
    const modelReason = personDisableReason("change-model", this.config);

    const doAttach = (_e, cx) => {
      // As a task, so the wait outlives the click: the tab is named and selected once herdr has adopted it. A refusal (a
      // name OpenRig doesn't make, an attach command not in OpenRig's shape) says why.
      const config = this.config;
      cx.spawn(async (cx) => {
        const res = await attachToSeat({ exec, run, hc, spaces, panes, terminals, layout, shared, setShared, wait: waitWith(cx), relayPath: attachRelayPath(appHome(), MOD_IDS.view) }, target, config);
        if (res && res.ok === false && res.reason) notify({ title: `Attach ${target.logicalId ?? target.session}`, body: res.reason, level: "warning" });
      });
    };
    // Focusing a pane the seat already has needs nothing from OpenRig; with none, Focus pane opens a view, which needs
    // OpenRig's herdr provider (seatViewReason), like Open terminal beside it.
    const focusReason = live.kind === "focus" || live.kind === "select-then-focus" ? null : seatViewReason;
    const doFocusPane = () => {
      const hit = seatClickTarget(stripProps(), activeRigViewId(), n.canonicalSessionName, panes?.() ?? [], terminals?.() ?? []);
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
      oneClick(target, "open-seat", "seat-focus-pane");
    };

    const tab=entry.seatTab??"activity";
    this.pageHeading={title:entry.name,tone:seatNeeds.length?"needs_input":rawStatus,session:n.canonicalSessionName,status:[seatNeeds.length?"needs you":look.word,n.runtime,n.model??n.resolvedModel,entry.rig].filter(Boolean).join(" · ")};
    this.inPageActions=true;
    this.pageActions=h_flex().gap(6).items_center().flex_none()
        .when((this.pageWidth??960)<320,el=>el.flex_wrap().max_w(Math.max(100,this.pageWidth-28)))
        .child(live.kind !== "card"
          ? this.button(t, "seat-focus-pane", "Focus pane", doFocusPane, { primary: true, small: true, iconName: "rig-target", disabled: !!focusReason, tooltip: focusReason })
          : this.button(t, "seat-attach", "Attach", doAttach, { primary: !stoppedSeat, small: true, iconName: "terminal", disabled: stoppedSeat, tooltip: attachReason }))
        // A terminal seat is a person's shell, not an agent: no message, work or model to give it.
        .when(!isTerminalSeat(n), (el) => el
          .child(this.button(t, "seat-act-send", "Send…", () => dialog({ input: true, placeholder: `Message to ${target.session}`, action: "send", multiLine: true }, 260), { small: true, iconName: "rig-send", disabled: !!sendReason, tooltip: sendReason }))
          .child(this.button(t, "seat-act-queue", "Queue…", () => dialog({ input: true, placeholder: "One-line summary; the body follows on the next lines", action: "queue", multiLine: true }, 300), { small: true, iconName: "rig-queue", disabled: !!queueReason, tooltip: queueReason })))
        .child(this.button(t, "seat-act-more", "⋯", () => menu(target), { small: true }));
    this.inPageActions=false;
    return v_flex().id(`seat-page-${entry.name}`).gap(12)
      .when(tab === "activity" && !isTerminalSeat(n), el => el.child(this.nowBlock(t, { session: n.canonicalSessionName, logicalId: n.logicalId }, () => transcript && push(fileEntry(transcript, `${entry.name} transcript`)))))
      .when(!!seatViewReason, (el) => el.child(this.workerCapabilityNote(t, seatViewReason)))
      // 1. CONTEXT section
      .when(tab === "activity", el => el.child(v_flex().id("seat-section-context").child(this.card(t, ctx != null ? `CONTEXT · ${ctx}%` : "CONTEXT", [
        (pageBodyLayout(this.pageWidth).compact ? v_flex() : h_flex()).id("seat-context-bar").gap(10).when(!pageBodyLayout(this.pageWidth).compact, el => el.items_center())
          .child(div().when(!pageBodyLayout(this.pageWidth).compact, el => el.w(120)).text_size(12).text_color(t.dim).child("Context"))
          .child(ctx == null
            ? div().text_size(12.5).child("Not reported by this runtime")
            : h_flex().gap(8).items_center().when(pageBodyLayout(this.pageWidth).compact, el => el.w_full().flex_wrap())
                .child(div().w(pageBodyLayout(this.pageWidth).compact ? 80 : 160).h(6).rounded(3).bg(t.raised).child(div().h_full().rounded(3).w(Math.max(2, Math.min(pageBodyLayout(this.pageWidth).compact ? 80 : 160, (pageBodyLayout(this.pageWidth).compact ? .8 : 1.6) * rawCtx))).bg(ctxWarn ? t.blocked : t.accent)))
                .child(div().id("seat-context-pct").text_size(12).text_color(ctxWarn ? t.blocked : t.muted).when(ctxWarn, (d) => d.font_semibold()).child(`${ctx}%`))
                // One bar: the token counts sit on its row.
                .when(contextWindow != null, (el) => el.child(div().id("seat-context-tokens").when(pageBodyLayout(this.pageWidth).compact, e => e.w_full()).text_size(12).text_color(t.muted).child(
                  `${fmtTok(contextWindow)} token window${inputTokens != null ? ` · ${fmtTok(inputTokens)} input` : ""}${outputTokens != null ? ` · ${fmtTok(outputTokens)} output` : ""}`)))),
        this.kv(t, [
          ["Runtime", n.runtime],
          ["Model", n.model ?? n.resolvedModel ?? "default"],
          ["Session", n.canonicalSessionName, true],
          ["Effort", effortText],
          ["Attach command", attachCmd, true],
        ]),
        ...(!stoppedSeat && seatViewReason ? [] : [stoppedSeat
          ? div().id("seat-open-terminal-link").text_size(12).text_color(t.dim)
            .tooltip(seatViewReason ?? "")
            .child("This seat has no running terminal to attach.")
          : (pageBodyLayout(this.pageWidth).compact ? v_flex() : h_flex()).id("seat-open-terminal-link").gap(6).when(!pageBodyLayout(this.pageWidth).compact, el => el.items_center()).cursor_pointer()
              .on_click(() => oneClick(target, "open-seat", "seat-open-terminal"))
              .child(div().when(!pageBodyLayout(this.pageWidth).compact, el => el.w(120)).text_size(12).text_color(t.dim).child("Terminal"))
              .child(div().text_size(12.5).text_color(t.accent).child("Open terminal ▸"))]),
      ]))))
      // 2. CURRENT ACTIVITY section
      .when(tab === "activity", el => el.child(v_flex().id("seat-section-activity").child(this.card(t, "CURRENT ACTIVITY", [
        div().text_size(12.5).child(activityWords.line),
        ...[activityWords.note, activityWords.changed, activityWords.stale].filter(Boolean).map(text => this.dim(t, text)),
        h_flex().id("seat-evidence-fold").gap(5).items_center().cursor_pointer().text_color(t.muted)
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
        ? seatFindings.map((f, i) => h_flex().id(`seat-health-finding-${i}`).px(6).h(26).overflow_hidden().gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click(() => push({ section: "system", subview: "health" }))
            .child(div().text_size(12).text_color(t.blocked).child(`[${f.severity ?? "warn"}]`))
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).tooltip(String(singleLineText(f.summary ?? f.id ?? "finding")??"")).child(singleLineText(f.summary ?? f.id ?? "finding")))
            .child(div().text_size(11.5).text_color(t.dim).child(f.status ?? "open"))
            .child(svg(icon("chevron-right")).size(11).flex_none().text_color(t.dim)))
        : [this.dim(t, "No health findings for this seat.")]))))
      // 4. CURRENT WORK section
      .when(tab === "queue", el => el.child(v_flex().id("seat-section-current-work").child(this.card(t, `CURRENT WORK · ${currentWork.length}`, currentWork.length
        ? currentWork.map((it, i) => h_flex().id(`seat-work-current-${i}`).gap(8).items_center().text_size(12.5)
            .child(div().font_family(settings().font_family).text_size(11.5).text_color(t.dim).child(String(it.qitemId ?? `work-${i}`)))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).tooltip(String(singleLineText(it.summary ?? it.title ?? "—")??"")).child(singleLineText(it.summary ?? it.title ?? "—")))
            .when(!!it.sourceSession, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(singleLineText(`from ${it.sourceSession}`))))
            .when(!!it.priority, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(String(it.priority)))))
        : [this.dim(t, queueEmpty("No active claimed work."))]))))
      // 5. QUEUE section (warnings, depth, basis, UP NEXT, NEEDS YOU, RECENTLY FINISHED)
      .when(tab === "queue", el => el.child(v_flex().id("seat-section-queue").child(this.card(t, "QUEUE", [
        ...queueWarnings.map((w, i) => div().id(`seat-queue-warn-${i}`).text_size(12).text_color(t.blocked).child(String(w))),
        this.kv(t, [
          ["Owned work", ownedText],
          ["depth:", depthText],
          ["basis:", basisText],
        ]),
        v_flex().id("seat-section-up-next").gap(4).pt(4).border_t(1).border_color(t.border)
          .child(div().text_size(11.5).font_semibold().text_color(t.muted).child(`UP NEXT · ${upNext.length}`))
          .children(upNext.length
            ? [
                ...upNext.slice(0, 3).map((it, i) => h_flex().id(`seat-up-next-${i}`).gap(8).items_center().text_size(12)
                  .child(div().font_family(settings().font_family).text_size(11.5).text_color(t.dim).child(String(it.qitemId ?? `q-${i}`)))
                  .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).tooltip(String(singleLineText(it.summary ?? it.title ?? "—")??"")).child(singleLineText(it.summary ?? it.title ?? "—")))),
                ...(upNext.length > 3 ? [div().id("seat-up-next-more").text_size(11.5).text_color(t.dim).child(`+${upNext.length - 3} more`)] : []),
              ]
            : [this.dim(t, queueEmpty("None queued."))]),
        v_flex().id("seat-section-blocked").gap(4).pt(4).border_t(1).border_color(t.border)
          .child(div().text_size(11.5).font_semibold().text_color(t.muted).child(`BLOCKED · ${blockedWork.length}`))
          .children(blockedWork.length ? blockedWork.map((it, i) => v_flex().id(`seat-blocked-${i}`).gap(2)
            .child(div().text_size(12).text_color(t.foreground).child(it.summary ?? it.qitemId))
            .when(!!it.blockedOn, (el) => el.child(div().text_size(11).text_color(t.dim).child(`Waiting on ${it.blockedOn}`))))
            : [this.dim(t, queueEmpty("None blocked."))]),
        v_flex().id("seat-section-needs-you").gap(4).pt(4).border_t(1).border_color(t.border)
          .child(div().text_size(11.5).font_semibold().text_color(t.muted).child(`NEEDS YOU · ${seatNeeds.length}`))
          .children(seatNeeds.length
            ? [
                ...seatNeeds.slice(0, 3).map((it, i) => h_flex().id(`seat-need-item-${i}`).px(6).h(24).overflow_hidden().gap(8).items_center().rounded(5).cursor_pointer().hover((s) => s.bg(t.hover))
                  .on_click(() => push({ section: "needs", id: it.id, name: it.summary }))
                  .child(div().text_size(11.5).text_color(t.blocked).child(`[${it.urgency ?? "normal"}]`))
                  .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).tooltip(String(singleLineText(it.summary ?? it.id)??"")).child(singleLineText(it.summary ?? it.id)))),
                ...(seatNeeds.length > 3 ? [div().id("seat-needs-more").text_size(11.5).text_color(t.dim).child(`+${seatNeeds.length - 3} more`)] : []),
              ]
            : [this.dim(t, "None pending.")]),
        v_flex().id("seat-section-recently-finished").gap(4).pt(4).border_t(1).border_color(t.border)
          .child(div().text_size(11.5).font_semibold().text_color(t.muted).child("RECENTLY FINISHED"))
          .children(recentlyFinished.length
            ? recentlyFinished.slice(0, 3).map((it, i) => h_flex().id(`seat-finished-${i}`).gap(8).items_center().text_size(12)
                .child(div().font_family(settings().font_family).text_size(11.5).text_color(t.dim).child(String(it.qitemId ?? `done-${i}`)))
                .child(div().flex_1().min_w(0).truncate().text_color(t.muted).tooltip(String(singleLineText(it.summary ?? it.title ?? "—")??"")).child(singleLineText(it.summary ?? it.title ?? "—"))))
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
          .child(h_flex().id("seat-link-host").px(8).h(22).rounded(5).bg(t.raised).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click(() => push({ section: "topology", kind: "host", host: hostOf(n) ?? "local", name: hostOf(n) ?? "local" }))
            .child(div().text_size(11.5).text_color(t.accent).child(`host ${hostOf(n) ?? "local"} ▸`)))
          .child(h_flex().id("seat-link-rig").px(8).h(22).rounded(5).bg(t.raised).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click(() => push({ section: "topology", kind: "rig", rigId: entry.rigId, conn: entry.conn, name: entry.rig }))
            .child(div().text_size(11.5).text_color(t.accent).child(`rig ${entry.rig} ▸`)))
          .child(h_flex().id("seat-link-pod").px(8).h(22).rounded(5).bg(t.raised).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click(() => push({ section: "topology", kind: "pod", rig: entry.rig, rigId: entry.rigId, conn: entry.conn, pod: podName, name: podName }))
            .child(div().text_size(11.5).text_color(t.accent).child(`pod ${podName} ▸`))),
        this.nativePart(t, cx, entry.rig, n.canonicalSessionName),
      ]))))
      // 7. SPEC section (linked spec or (not in library), profile, version, source hash, basis)
      .when(tab === "files", el => el.child(v_flex().id("seat-section-spec").child(this.card(t, "SPEC", [
        n.resolvedSpecName
          ? h_flex().id("seat-spec").gap(8).items_center().cursor_pointer()
              .on_click(() => push({ section: "specs", specOf: n.logicalId, name: `spec of ${n.logicalId}` }))
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
      .when(tab === "files" && !!transcript, (el) => el.child(this.card(t, "Files", [this.fileRow(t, "seat-transcript", transcript, `Transcript · ${entry.name}`)])));
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
      ? v_flex().children(kids.map((c, i) => h_flex().id(`native-child-${i}`).px(8).h(28).gap(8).items_center().rounded(6).hover((s) => s.bg(t.hover))
        .on_click(() => run("terminal.peek", { terminal: c.address }))
        .child(svg(icon("rig-helper")).size(13).flex_none().text_color(t.dim))
        .child(div().flex_1().truncate().text_size(12.5).tooltip(String((c.name || c.argv.join(" ") || c.address)??"")).child(c.name || c.argv.join(" ") || c.address))
        .child(div().text_size(11.5).text_color(t.dim).child(c.status ?? ""))
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
      const node = Object.values(sharedRigData(this.config, shared)?.nodesByRig ?? {}).flat()
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
        onClick: () => push({ section: "specs", id: s.id, name: s.name }) }))) : this.dim(t, `No spec named ${entry.name} in the library.`)]);
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
        const key = `spec-kind:${g.kind}`, expanded = !!f || (open[key] ?? g.kind === "rig");
        const toggleKind = () => { this.pageSel = key; if (!f) { const now = shared("rig.open.page") ?? {}; setShared("rig.open.page", { ...now, [key]: !expanded }); } };
        this.pageRows?.push({ key, foldKey: key, expandable: true, isOpen: expanded, open: toggleKind,
          setOpen: value => { if (!f) setShared("rig.open.page", { ...(shared("rig.open.page") ?? {}), [key]: value }); } });
        return v_flex().id(`spec-kind-group-${g.kind}`)
          .child(h_flex().id(key).px(8).h(30).gap(6).items_center().rounded(6).when(this.pageSel === key, el => el.bg(t.selection)).hover(x => x.bg(t.hover))
            .on_click(toggleKind)
            .child(svg(icon(expanded ? "chevron-down" : "chevron-right")).size(12).text_color(t.dim))
            .child(div().text_size(12.5).font_semibold().text_color(t.muted).child(g.title))
            .child(div().text_size(11.5).text_color(t.dim).child(`${g.items.length}${f ? ` of ${g.total}` : ""}${g.yours ? ` · ${g.yours} yours` : ""}`)))
          .when(expanded, el => el.children(g.items.map((s, i) => {
        const shown = !!open[`spec:${s.id}`], box = this.specBoxes?.[s.id];
        const builtin = s.sourceType === "builtin" || !s.sourcePath;
        const key = `spec:${s.id}`;
        this.pageRows?.push({ key, foldKey: key, parentKey: `spec-kind:${g.kind}`, expandable: true, isOpen: shown, open: () => toggle(s.id) });
        return v_flex()
          .when(builtin && i === g.yours && i > 0, el => el.child(div().id(`spec-divider-${g.kind}`).mx(8).h(1).bg(t.border)))
          .child(h_flex().id(`specs-${lib.data.indexOf(s)}`).pl(24).pr(8).h(30).gap(10).items_center().rounded(6).when(this.pageSel === key, el => el.bg(t.selection)).hover((x) => x.bg(t.hover))
            .on_click(() => { this.pageSel = key; toggle(s.id); }).on_mouse_down("right", () => menu({ kind: "spec", conn: this.config?.connectionId, id: s.id, name: s.name, sourcePath: s.sourcePath, specKind: s.kind }))
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
    const nodes = sharedRigData(this.config, shared)?.nodesByRig ?? {};
    return rigs.filter((r) => [r.name, r.specName, r.spec].includes(s.name) || (nodes[r.id] ?? []).some((n) => n.resolvedSpecName === s.name));
  }

  /** A pill's click: that rig on Topology (one-way sync — pushes to rig.nav without mutating rig.open). */
  openRigFromSpec(r) {
    push({ section: "topology", kind: "rig", rigId: r.id, conn: r.conn, name: r.name });
  }

  graphFor(key) {
    this.graphs??=new Map();if(!this.graphs.has(key))this.graphs.set(key,new RigGraph());return this.graphs.get(key);
  }

  loadSpecGraph(cx,s,box) {
    box.graphLoading=true;box.graphError=null;box.graph=null;
    cx.spawn(async cx=>{
      try{
        const url=await this.resolveDaemonUrl();if(!url)throw new Error("Connect OpenRig before opening the saved spec graph.");
        // This is the same public structured review used by rig specs preview in OpenRig0.7.11.
        // It stays on the person's existing HTTP/tunnel origin and needs no local or remote CLI.
        box.graph=await readRigSpecPreview(fetch,url,s);
      }catch(error){box.graphError=singleLineText(error?.message??error).slice(0,240);}
      finally{box.graphLoading=false;cx.notify();}
    });
  }

  /** A spec opened in place is read-only first, with Graph/YAML for rig specs.
   *  `Edit` enters edit mode (`Cancel edit` exits with inline discard confirmation); `Edit` on a built-in creates an
   *  editable copy in the user library; `Launch` lives on the row's right-click menu and the palette. */
  specBody(t, cx, s, single) {
    const isBuiltin = s.sourceType === "builtin" || !s.sourcePath;
    const sfx = (name, plain = false) => (single && plain ? name : `${name}-${s.id}`);
    let box = (this.specBoxes ??= Object.create(null))[s.id];
    if (!box) {
      const startEditing = Boolean(this.specAutoEdit?.delete?.(s.id)) && !isBuiltin;
      box = this.specBoxes[s.id] = { loading: true, editing: startEditing };
      this.loadSpec(cx, s, isBuiltin, box);
    }
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
    const copyReason = isBuiltin ? personDisableReason("specs-add", this.config) : null;
    const remoteEdit = !isBuiltin && Boolean(this.config?.daemonMachine);
    const guidance = box.note || (remoteEdit ? this.remoteSpecGuidance() : null);
    const copyNote = this.specCopyNotes?.[s.id];
    const saveDisabled = isBuiltin || !editing || !dirty || Boolean(box.saving || box.awaitingPermission);
    const openDisabled = !s.sourcePath || Boolean(this.config?.daemonMachine);
    const toolbar = h_flex().gap(8).items_center().flex_wrap()
      .when(rigSpec&&!single,el=>el.child(h_flex().rounded(6).border_1().border_color(t.border).children(["graph","yaml"].map(view=>
        this.button(t,`spec-view-${view}-${s.id}`,view==="graph"?"Graph":"YAML",(_e,cx)=>{box.view=view;cx.notify();},{small:true})
          .when((view==="graph")===graphView,el=>el.bg(t.accent).text_color(t.solid_foreground)
            .hover(st=>st.bg(t.accent)))))))
      .child(this.button(t, sfx(isBuiltin ? "spec-copy" : "spec-edit", true), editLabel, (_e, cx) => this.toggleEditSpec(cx, s, isBuiltin), {
        primary: !editing && !copyReason,
        iconName: editing ? "x" : "layers",
        disabled: Boolean(box.loading || box.copying || box.saving || box.awaitingPermission || copyReason),
        tooltip: remoteEdit ? `Edit on ${this.config.daemonMachine}` : copyReason,
      }))
      .when(!graphView,el=>el.child(this.button(t, sfx("spec-save", true), box.saving ? "Saving…" : `Save ${mac ? "⌘↵" : "Ctrl+↵"}`, (_e, cx) => this.saveSpec(cx, s), {
        primary: editing && dirty,
        iconName: "check",
        disabled: saveDisabled,
      })))
      .child(this.button(t, sfx("spec-open", true), "Open file", () => {
        if (s.sourcePath && !this.config?.daemonMachine) push(fileEntry(s.sourcePath, `${s.name} · spec`));
      }, {
        iconName: "file-text",
        disabled: openDisabled,
        tooltip: this.config?.daemonMachine ? `This file is on ${this.config.daemonMachine}.` : openDisabled ? "Built-in spec has no file path on disk" : null,
      }))
      .children(pills.map((r) => h_flex().id(`spec-rig-pill-${s.id}-${r.name}`).px(8).h(24).gap(5).items_center().rounded(12).text_size(12).cursor_pointer()
        .bg(t.raised).border_1().border_color(t.border).hover((e) => e.bg(t.hover)).on_click(() => this.openRigFromSpec(r))
        .child(div().text_color(t.working).child("●")).child(r.name)))
      .when(isBuiltin, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Built-in specs can't be edited; copy one to make your own.")))
      .when(!isBuiltin && !editing, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Read-only")))
      .when(dirty, (el) => el.child(div().text_size(11.5).text_color(t.working).child("● Unsaved changes")))
      .when(rigSpec,el=>el.child(div().flex_1()).child(this.button(t,`spec-launch-${s.id}`,"Launch…",()=>openOverlay({mod:MOD_IDS.menu,kind:"dialog",width:460,height:300,
        props:{target:{kind:"spec",id:s.id,conn:this.config?.connectionId,name:s.name,sourcePath:s.sourcePath??null,specKind:"rig"},step:{action:"launch-spec"}}}),{primary:true,iconName:"rig-play"})))
      .when(!!box.restoredDraft && dirty, (el) => el.child(h_flex().gap(6).items_center().flex_wrap().child(div().text_size(11.5).text_color(t.muted).child(this.config?.daemonMachine
        ? `Restored your unsaved edits from ${this.time(box.draftAt??Date.now())}.` : "Restored unsaved edits"))
        .child(this.button(t, `spec-discard-draft-${s.id}`, this.config?.daemonMachine?"Discard edits":"Discard", (_e, cx) => this.discardDraft(cx, s), { small: true }))));
    const errors = box.errors ?? [];
    if(single){this.pageActions=toolbar;this.pageHeading={title:s.name,status:`${s.kind??"spec"}${s.version?` · ${s.version}`:""}`};}
    return v_flex().gap(8)
      .child(this.kv(t, [["Kind", s.kind], ["Version", s.version], ["Summary", s.summary], ["File", `${s.sourcePath ?? "not a file on disk"}${this.config?.daemonMachine ? ` · on ${this.config.daemonMachine}` : ""}`, true]]))
      .when(!single,el=>el.child(toolbar))
      .when(!!box.builtinEditNote && !guidance, (el) => el.child(this.dim(t, box.builtinEditNote)))
      .when(Boolean(box.confirmDiscardEdit || box.confirmRevert), (el) => el.child(
        h_flex().id(`spec-discard-bar-${s.id}`).gap(8).items_center()
          .child(div().text_size(12).text_color(t.blocked).child("Discard edits?"))
          .child(this.button(t, `spec-discard-confirm-${s.id}`, "Discard", (_e, cx) => this.confirmDiscardEditSpec(cx, s, isBuiltin), { small: true }))
          .child(this.button(t, `spec-keep-edit-${s.id}`, "Keep editing", (_e, cx) => { box.confirmDiscardEdit = false; box.confirmRevert = false; cx.notify(); }, { small: true })),
      ))
      .when(!!box.savedText && !dirty, (el) => el.child(this.dim(t, box.savedText)))
      .when(!!guidance, (el) => el.child(this.specNoteView(t, guidance, s.id)))
      .when(!!copyNote, (el) => el.child(this.specNoteView(t, copyNote, s.id, /^(?:An earlier copy|You already have a copy)/.test(copyNote))))
      .when(!!box.conflict, (el) => el.child(v_flex().gap(6).min_w(0).child(div().text_size(12).text_color(t.blocked).child(box.conflict))
        .child(h_flex().gap(8).items_center().flex_wrap()
        .child(this.button(t, `spec-reload-${s.id}`, box.confirmReload ? "Click Reload again to discard edits" : "Reload", (_e, cx) => this.reloadSpec(cx, s, isBuiltin)))
        .child(this.button(t, `spec-keep-editing-${s.id}`, "Keep editing", (_e, cx) => this.keepEditing(cx, s))))))
      .children(errors.map((e, i) => div().id(`spec-error-${s.id}-${i}`).text_size(12).text_color(t.blocked).child(String(e))))
      .when(graphView&&dirty,el=>el.child(this.dim(t,"Showing the saved spec. Save to update the graph.")))
      .child(graphView ? (box.graph?this.graphFor(`spec:${s.id}`).render(t,cx,box.graph,{id:`spec-graph-${s.id}`,assets:ASSETS})
        :box.graphError?v_flex().gap(6).child(div().text_size(12).text_color(t.blocked).child(box.graphError))
          .child(this.button(t,`spec-graph-retry-${s.id}`,"Retry",(_e,cx)=>this.loadSpecGraph(cx,s,box),{small:true})):this.skeleton(t)) : box.state
        ? div().id(`spec-editor-${s.id}`).h(320).border_1().border_color(editing ? t.accent : t.border).rounded(6)
          // Clicks and keys typed in the YAML are the editor's: stop left-mouse-down from bubbling to rig-view-root's handle.focus().
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_key_down(() => { this.typing = true; }).child(Editor.new(box.state))
        : box.error ? div().text_size(12).text_color(t.blocked).child(box.error) : this.skeleton(t))
      .when(!isBuiltin, (el) => el.child(this.dim(t, "Applies to future launches; running rigs keep their current topology.")));
  }

  /** Creates and wires an EditorState for a spec box with the requested `readonly` state. */
  makeSpecEditorState(s, box, value, readonly) {
    const key = specDraftKey(s.id,this.config);
    box.secondaryEnterTask?.cancel?.();box.secondaryEnterBase=null;
    box.state?.release?.();
    const state = EditorState.new({ language: "yaml", value, readonly: Boolean(readonly), font_family: settings().font_family });
    state.on("change", (_e, cx) => {
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
      setDraft(key, now === box.loaded ? null : { text: now, baseText: box.loaded, baseHash: simpleHash(box.loaded) });
      box.confirmRevert = false; box.confirmDiscardEdit = false; box.confirmReload = false; box.savedText = null;
      cx?.notify?.();
    });
    // Ctrl+Enter puts a newline in the text before it submits: Save gets the text without it.
    state.on("submit", (e, cx) => {
      if (!e?.secondary) return;
      box.secondaryEnterTask?.cancel?.();
      const cleaned = box.secondaryEnterBase==null ? state.value() : stripSecondaryEnterNewline(box.secondaryEnterBase, state.value());
      box.secondaryEnterBase=null;
      if (cleaned !== state.value()) { state.set_value(cleaned); box.lastText = cleaned; }
      this.saveSpec(cx, s);
    });
    box.state = state;
    return state;
  }

  /** Explain a local edit refusal without inferring locality from missing folders. */
  specRefusal() {
    return specFolderRefusal(this.specRoots, { machine: this.config?.daemonMachine, realpathAvailable: this.specRealpathAvailable });
  }

  specNoteView(t, note, id, information = false) {
    const machine=this.config?.daemonMachine,command=`hc machine login ${machine}`;
    if(machine&&note.startsWith(`${machine} is unreachable, so nothing was saved.`)&&note.includes(command)){
      const [before,after]=note.split(command);
      return h_flex().gap(4).items_center().flex_wrap().text_size(12).text_color(t.blocked)
        .child(div().child(before)).child(div().id(`spec-reconnect-${id}`).font_family(settings()?.font_family??"monospace").child(command))
        .child(this.copyButton(t,command,`spec-reconnect-${id}`,"reconnect command")).child(div().child(after));
    }
    const marker = "daemonMachine";
    const guidance = note === this.specRefusal() || note === this.remoteSpecGuidance();
    const tone = guidance || information ? t.muted : /^(?:Your copy of .*Copy & edit didn't overwrite it\.|The copied spec at .*Your copy was kept;)/.test(note) ? t.working : t.blocked;
    if (!guidance || !note.includes(marker)) return div().text_size(12).text_color(tone).child(note);
    const [before, after] = note.split(marker);
    return h_flex().gap(4).items_center().flex_wrap().text_size(12).text_color(tone)
      .child(div().child(before)).child(div().id(`spec-config-key-${id}`).font_family(settings()?.font_family ?? "monospace").child(marker))
      .child(this.copyButton(t, marker, `spec-config-${id}`, "configuration key"))
      .child(div().child(after));
  }

  remoteSpecGuidance(){
    const machine=this.config?.daemonMachine;
    return `Save writes this spec on ${machine}.`+(this.specConsentMachine===machine?"":" The first save asks for permission.");
  }

  specConflictMessage(){
    const machine=this.config?.daemonMachine;
    return machine?`The spec changed on ${machine} since you opened it. Reload shows the new version and discards your unsaved edits. Keep editing keeps your version; saving then replaces the change on ${machine}.`:"The file changed on disk since you opened it.";
  }

  /** Toggle editable mode; Copy & edit copies a built-in into the user library. */
  toggleEditSpec(cx, s, isBuiltin) {
    const box = this.specBoxes?.[s.id];
    if (!box) return;
    box.view="yaml";
    const current=nav().stack?.at(-1);
    if(current?.section==="specs"&&(current.id===s.id||current.name===s.name))push({...current,specTab:"yaml"});
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
    const box = this.specBoxes?.[s.id];
    if (!box) return;
    setDraft(specDraftKey(s.id,this.config), null);
    box.editing = false;
    box.confirmDiscardEdit = false;
    box.confirmRevert = false;
    box.errors = null;
    box.conflict = null;
    box.restoredDraft = false;
    box.lastText = box.prevText = box.loaded;
    if (box.state) this.makeSpecEditorState(s, box, box.loaded, true);
    cx.notify();
  }

  /** Reads a spec's YAML (a user file first, otherwise the library's copy) and makes its editor, outside render. A saved draft
   *  comes back only against the text it was started from: if the file moved on since, the draft stays against its own
   *  base and the conflict says so, so Save can't overwrite the newer file unseen. */
  loadSpec(cx, s, isBuiltin, box) {
    cx.spawn(async (cx) => {
      await Promise.resolve();
      try {
        const text = await this.specText(s);
        const key = specDraftKey(s.id,this.config), raw = (shared("rig.drafts") ?? {})[key];
        const draft = typeof raw === "string" ? { text: raw, baseText: text } : raw && typeof raw.text === "string" ? raw : null;
        let initial = text;
        box.loaded = text; box.diskText = null; box.restoredDraft = false;
        if (draft && !isBuiltin && draft.text !== text) {
          box.draftAt=draft.at;
          initial = draft.text;
          box.editing = true;
          if (draft.baseText === text || (draft.baseHash && draft.baseHash === simpleHash(text))) box.restoredDraft = true;
          else {
            box.loaded = draft.baseText ?? text; box.diskText = text;
            box.conflict = this.specConflictMessage();
          }
        }
        box.editing = Boolean(box.editing) && !isBuiltin;
        box.lastText = box.prevText = initial;
        this.makeSpecEditorState(s, box, initial, isBuiltin || !box.editing);
        box.loading = false; box.error = null;
      } catch (e) { box.loading = false; box.error = String(e?.message ?? e); }
      cx.notify();
    });
  }

  /** Reload from disk, losing the edits: with edits it asks first (a second press discards them). */
  reloadSpec(cx, s, isBuiltin) {
    const box = this.specBoxes[s.id];
    if (this.specDirty(box) && !box.confirmReload) { box.confirmReload = true; cx.notify(); return; }
    setDraft(specDraftKey(s.id,this.config), null);
    this.specBoxes[s.id] = { loading: true, editing: false, view:box.view };
    this.loadSpec(cx, s, isBuiltin, this.specBoxes[s.id]);
    box.state?.release?.();
    cx.notify();
  }

  /** The conflict banner's other way out: keep the text, and let the next Save replace the file as it is now. */
  keepEditing(cx, s) {
    const box = this.specBoxes?.[s.id];
    if (!box) return;
    box.conflict = null; box.confirmReload = false; box.editing = true;
    box.loaded = box.diskText ?? box.loaded; box.diskText = null;
    if (box.state) setDraft(specDraftKey(s.id,this.config), this.specDirty(box) ? { text: box.state.value(), baseText: box.loaded, baseHash: simpleHash(box.loaded) } : null);
    cx.notify();
  }

  /** The restored edits' Discard: back to the file's text, draft gone, and return to read-only. */
  discardDraft(cx, s) {
    const box = this.specBoxes?.[s.id];
    if (!box?.state) return;
    setDraft(specDraftKey(s.id,this.config), null);
    box.restoredDraft = false; box.confirmRevert = false; box.confirmDiscardEdit = false; box.editing = false;
    this.makeSpecEditorState(s, box, box.loaded, true);
    cx.notify();
  }

  /** Revert asks first when there are edits (a second press discards them); nothing to discard reverts at once. */
  revertSpec(cx, s) {
    const box = this.specBoxes?.[s.id];
    if (!box?.state) return;
    if (this.specDirty(box) && !box.confirmRevert) { box.confirmRevert = true; cx.notify(); return; }
    box.state.set_value(box.loaded);
    setDraft(specDraftKey(s.id,this.config), null);
    box.confirmRevert = false; box.confirmDiscardEdit = false; box.errors = null; box.conflict = null; box.restoredDraft = false;
    cx.notify();
  }

  /** Save = validate (daemon, by kind) → compare-and-swap write → sync the library → re-read. Invalid is never written.
   *  Its checks run at once; the rest runs as a task, whose own `cx` every later notify and read uses. */
  saveSpec(cx, s) {
    const box = this.specBoxes?.[s.id];
    if (!box?.state || box.saving || !box.editing || s.sourceType === "builtin" || !s.sourcePath || !this.specDirty(box)) return;
    const edited = box.state.value();
    box.errors = null; box.conflict = null; box.note = null; box.savedText = null;
    const refused = this.specRefusal();
    if (this.config?.daemonMachine) {
      this.remoteSpecWrite(cx,s,{verb:"save",target:s.sourcePath,baseText:box.loaded,content:edited});return;
    }
    if (unsafeSpecWritePath(s.sourcePath)) { box.note = refused; cx.notify(); return; }
    if (!this.config) { box.note = "The daemon address isn't known yet."; cx.notify(); return; }
    box.saving = true; cx.notify();
    const conflict = (onDisk) => { box.conflict = "The file changed on disk since you opened it."; if (onDisk != null) box.diskText = onDisk; };
    cx.spawn(async (cx) => {
      try {
        // Written only inside the local spec folders, at the resolved path: a symlink out of them is refused.
        const file = await resolveInSpecRoots(s.sourcePath, this.specRoots, exec);
        if (!file) { box.note = refused; return; }
        const daemonUrl = await this.resolveDaemonUrl();
        if (!daemonUrl) { box.note = "The daemon address isn't known yet."; return; }
        const route = s.kind === "agent" ? "/api/agents/validate" : "/api/rigs/import/validate";
        const r = await fetch(`${daemonUrl}${route}`, { method: "POST", headers: { "content-type": "text/yaml" }, body: edited });
        let data = null; try { data = JSON.parse(await r.text()); } catch (_) { data = null; }
        if (!r.ok || data?.valid === false) {
          box.errors = Array.isArray(data?.errors) && data.errors.length ? data.errors : [data?.error ?? data?.message ?? `Validation failed (${r.status})`];
          return;
        }
        const onDisk = await readTextFile(file).catch(() => null);
        if (onDisk != null && onDisk !== box.loaded) { conflict(onDisk); return; }
        try { await writeTextFile(file, edited, box.loaded); } catch (e) {
          // A changed file is a conflict; any other failure (permissions, I/O) says what it was.
          const now = await readTextFile(file).catch(() => null);
          if (now != null && now !== box.loaded) conflict(now); else box.errors = [String(e?.message ?? e)];
          return;
        }
        const synced = await fetch(`${daemonUrl}/api/specs/library/sync`, { method: "POST" }).catch(() => null);
        box.loaded = edited; box.diskText = null; box.errors = null; box.conflict = null; box.restoredDraft = false;
        box.savedText = synced?.ok ? "Saved." : "Saved; library re-index failed.";
        delete this.specCopyNotes?.[s.id];
        if(synced?.ok&&s.kind==="rig")this.loadSpecGraph(cx,s,box);
        // Keys typed while it saved stay: their draft is kept, now against what was written.
        const key = specDraftKey(s.id,this.config), now = box.state.value();
        setDraft(key, now === edited ? null : { text: now, baseText: edited, baseHash: simpleHash(edited) });
        if (now === edited) {
          box.editing = false;
          this.makeSpecEditorState(s, box, edited, true);
        }
        this.read(cx, "/api/specs/library", true);
        run("rig.refresh");
      } catch (e) { box.note = String(e?.message ?? e); }
      finally { box.saving = false; cx.notify(); }
    });
  }

  /** User specs may read their file inside the local spec folders with symlinks resolved. All other entries use only
   *  the daemon's own copy, even when their sourcePath happens to name a local spec. */
  async specText(s) {
    const path=rigSpecLibraryPath(s);if(!path)throw new Error("This library entry has no usable spec id.");
    const file = !this.config?.daemonMachine && s.sourceType === "user_file" && s.sourcePath ? await resolveInSpecRoots(s.sourcePath, this.specRoots, exec) : null;
    let text = file ? await readTextFile(file).catch(() => null) : null;
    if (text == null && this.config) {
      const daemonUrl = await this.resolveDaemonUrl();
      if (daemonUrl) {
        const r = await fetch(`${daemonUrl}${path}`);
        const body = await r.text();
        if (!r.ok) throw new Error(`GET /api/specs/library/${s.id} → ${r.status}`);
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
  async writeSpecCopy(s, text) {
    const root = this.specRoots?.[0];
    if (!root) throw new Error(this.specRefusal());
    const base = specCopyName(s.name);
    for (let i = 0; i < 20; i++) {
      const name = `${base}${i === 0 ? "" : i === 1 ? "-copy" : `-copy-${i}`}.yaml`;
      const file = `${root}/${name}`;
      const existing = await Promise.all(this.specRoots.map((r) => readTextFile(`${r}/${name}`)));
      if (existing.some((text) => text != null)) continue;
      // Create-only: herdr refuses if the file appeared meanwhile, and the next name is tried.
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
    const box = this.specBoxes?.[s.id];
    if (!box || box.copying) return;
    if (!this.config?.person) { box.note = NO_PERSON; cx.notify(); return; }
    // A built-in rig spec that has a folder of its own is copied as that whole folder, so the copy can launch.
    if (folderCopyable(s)) { this.copyFolder(cx, s); return; }
    if(this.config.daemonMachine){
      this.remoteSpecWrite(cx,s,{verb:"copy",name:s.name});return;
    }
    box.copying = true; box.note = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const source = s.sourceType === "user_file" ? box.loaded ?? await this.specText(s) : await this.specText(s);
        // Agent refs relative to the original's folder are made absolute (text only); a copy that couldn't find its agents is never written.
        const prepared = copyableSpecText(source, s.sourcePath);
        if (prepared.refused) { box.note = prepared.refused; return; }
        const text = prepared.text;
        const written = await this.writeSpecCopy(s, text);
        // Registered only at its resolved path inside the local spec folders: a link planted at that name is refused.
        const file = await resolveInSpecRoots(written, this.specRoots, exec);
        if (!file) { box.note = this.specRefusal(); return; }
        if (cliRefusal(this.config)) { box.note = cliRefusal(this.config); return; } // no home of its own: no CLI run, and the person is told
        const cmd = writeCommand(this.config, ["specs", "add", "--", file]);
        if (!cmd) { box.note = NO_PERSON; return; }
        const r = writeOutcome(await exec(cmd.command, cmd.args, { timeout: 180000 }));
        if (!r.ok) { box.note = r.text; return; }
        const daemonUrl = await this.resolveDaemonUrl();
        if (daemonUrl) await fetch(`${daemonUrl}/api/specs/library/sync`, { method: "POST" }).catch(() => null);
        let made = s.id, copy = null;
        try {
          const res = daemonUrl ? await fetch(`${daemonUrl}/api/specs/library`) : null;
          const list = res ? JSON.parse(await res.text()) : null;
          if (res?.ok && Array.isArray(list)) {
            this.cache["/api/specs/library"] = { data: list, at: Date.now() };
            copy = list.find((x) => x.name === s.name && x.kind === s.kind && x.sourceType !== "builtin" && x.sourcePath) ?? null;
            made = copy?.id ?? s.id;
          }
        } catch (_) { /* the list stays as it was */ }
        if (made !== s.id) {
          delete this.specBoxes?.[made];
          (this.specAutoEdit ??= new Set()).add(made);
          const lacking = s.sourceType === "user_file" ? null : siblingFileNote(siblingFileNames(text));
          if (lacking) (this.specCopyNotes ??= Object.create(null))[made] = lacking;
        }
        setOpen(`spec:${made}`, true);
        // On the one-spec page the page itself moves to the copy.
        const stack = nav().stack ?? [], top = stack.at(-1);
        if (copy && top?.section === "specs" && top.id === s.id) setShared("rig.nav", { stack: [...stack.slice(0, -1), { section: "specs", id: made, name: copy.name ?? s.name }] });
      } catch (e) { box.note = String(e?.message ?? e); }
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
    info.note = null;
    openOverlay({ mod: MOD_IDS.menu, kind: "dialog", width: 560, height: 540,
      props: { target: { kind: "spaces-list" }, step: { action: "spaces-list", token, copy: describeChange({ layout: name, shipped: isShippedLayout(name), copy: isShippedLayout(name) ? freeCopyName(name, layouts()) : null, from: plan.from, to: target, lines: plan.lines }) } } });
    cx.notify();
  }

  pollSpacesDecision(cx) {
    const pending = this.spacesPending;
    if (!pending) return;
    const decisions = shared("rig.spacesListDecisions") ?? {}, decision = decisions[pending.token];
    if (!decision && Date.now() < pending.expires) return;
    this.spacesPending = null;
    const rest = { ...decisions }; delete rest[pending.token]; setShared("rig.spacesListDecisions", rest);
    if (decision === "allow") this.runSpacesChange(cx, pending);
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
    catch (error) { result = { ok: false, reason: String(error?.message ?? error) }; }
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
            return div().id(`spaces-list-${m}`).px(10).h(24).flex().items_center().rounded(6).text_size(12)
              .bg(selected?t.accent:t.raised).text_color(selected?t.solid_foreground:t.foreground)
              .when(blocked,el=>el.opacity(.45)).when(!blocked,el=>el.cursor_pointer())
              .hover(el=>el.bg(selected?t.accent:blocked?t.raised:t.hover))
              .on_click(()=>{if(!blocked&&!selected)this.chooseSpacesMode(cx,m);}).child(MODE_LABEL[m]);
          }))))
        .when(!!why, (el) => el.child(div().id("spaces-list-why").text_size(11.5).text_color(t.muted).child(why)))
        .when(mode === "herdrig" || mode === "both", (el) => el.child(div().id("spaces-list-where").text_size(11.5).text_color(t.muted)
          .child(`herdrig's copy of Herdr's list, in layout ${name} · based on Herdr ${BASE_HERDR}`)))
        .when(!!info.busy, (el) => el.child(div().text_size(11.5).text_color(t.muted).child("Changing the layout…")))
        .when(!!info.note && (!info.noteLayout || info.noteLayout === name), (el) => el.child(div().id("spaces-list-note").text_size(11.5).text_color(/^✓/.test(info.note) ? t.muted : t.blocked).child(info.note)))
        .when((mode === "herdrig" || mode === "both") && info.reveal === true && !kept, (el) => el.child(v_flex().id("spaces-list-upstream").gap(6).p(8).rounded(6).bg(t.raised)
          .child(div().text_size(11.5).child("Herdr now keeps the active space in view itself. herdrig's list adds rig marks and actions; keep it, or switch back to Herdr's."))
          .child(h_flex().gap(8)
            .child(this.button(t, "spaces-list-keep", "Keep", () => this.keepSpacesList(cx), { small: true }))
            .child(this.button(t, "spaces-list-switch-back", "Switch back", () => this.chooseSpacesMode(cx, "herdr"), { small: true }))))),
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
      } catch (error) { info.note = String(error?.message ?? error); }
      cx.notify();
    });
  }

  /** What the folder-copy steps need from this page (see rig-spec-folder.js). The folder is copied on the box when a machine is
   *  configured, else on this computer; the daemon only ever supplies text. */
  folderHost(cx, config, daemonUrl) {
    const post = (path, init) => fetch(`${daemonUrl}${path}`, { method: "POST", ...init });
    return {
      specText: (spec) => this.specText(spec),
      validate: async (text) => {
        const checked = await post("/api/rigs/import/validate", { headers: { "content-type": "text/yaml" }, body: text });
        let v; try { v = JSON.parse(await checked.text()); } catch (_) { v = null; }
        return { ok: checked.ok && v?.valid !== false, errors: v?.errors ?? (v?.error ? [v.error] : undefined) };
      },
      addFolder: (request, grant) => config.daemonMachine
        ? this.remoteSpecController(cx).perform(config, { verb: "copy-folder", ...request }, grant)
        : this.localAddFolder(request, daemonUrl, cx),
      library: async (fresh) => {
        if (fresh) await post("/api/specs/library/sync").catch(() => null);
        const res = await fetch(`${daemonUrl}/api/specs/library`);
        if (!res.ok) throw new Error("The copy was made, but the library couldn't be read. Refresh before copying again.");
        const list = JSON.parse(await res.text());
        this.cache["/api/specs/library"] = { data: list, at: Date.now() };
        return list;
      },
      rename: async (id, name) => {
        const res = await post(`/api/specs/library/${encodeURIComponent(id)}/rename`, { headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
        let data; try { data = JSON.parse(await res.text()); } catch (_) { data = null; }
        if (!res.ok) throw new Error(`The copy was made but couldn't be renamed: ${data?.error ?? data?.message ?? `HTTP ${res.status}`}`);
        return data?.entry ?? null;
      },
    };
  }

  /** No machine configured: this computer's own OpenRig copies the folder through the shipped helper, after checking the
   *  daemon this page talks to is this computer's (a copy made here is invisible to another machine's daemon). */
  async localAddFolder(request, daemonUrl, cx) {
    const status = parseDaemonStatusJson((await exec("rig", ["status", "--json"], { timeout: 15000 })).stdout);
    if (!status.reachable || !status.daemonUrl) throw new Error("OpenRig isn't running on this computer, so a built-in's folder can't be copied here.");
    const health = async (url) => { const r = await fetch(`${url}/healthz`); if (!r.ok) throw new Error("OpenRig isn't answering."); return JSON.parse(await r.text()); };
    const [here, there] = await Promise.all([health(status.daemonUrl), health(daemonUrl)]);
    if (!here?.selfHostId || here.selfHostId !== there?.selfHostId)
      throw new Error("The OpenRig this page reads isn't this computer's own, so a copy made here would never be seen by it. Set up the machine first.");
    const helper = attachRelayPath(appHome(), MOD_IDS.view).replace(/rig-attach-relay\.cjs$/, "rig-spec-files.cjs");
    const r = await exec("node", [helper, "copy-folder", "--local", "--", request.sourcePath], { timeout: 150000 });
    let out; try { out = JSON.parse(r.stdout); } catch (_) { throw new Error(r.stderr || "The copy helper gave no answer."); }
    if (out.error) throw Object.assign(new Error(out.error), { code: out.code, folder: out.folder });
    const file = await resolveInSpecRoots(out.path, this.specRoots, exec);
    if (!file) throw new Error(this.specRefusal());
    const current = await readTextFile(file);
    if (current == null) throw new Error("The copied spec couldn't be read back.");
    const conflict = `The copied spec at ${file} changed before it could be rewritten. Your copy was kept; reopen it to review the changes.`;
    if (!/^[a-f0-9]{64}$/.test(out.sha256 ?? "") || await this.remoteSpecController(cx).hashText(this.config, current) !== out.sha256)
      throw new Error(conflict);
    try { await writeTextFile(file, request.content, current); }
    catch { throw new Error(conflict); }
    return { ok: true, path: out.path, folder: out.folder };
  }

  /** Copy & edit of a built-in rig spec as a whole folder, then open the copy in edit mode. */
  copyFolder(cx, s, consent = null) {
    const box = this.specBoxes?.[s.id];
    if (!box || box.copying || box.awaitingPermission) return;
    const config = { ...this.config };
    box.copying = true; box.note = null; box.errors = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const daemonUrl = await this.resolveDaemonUrl();
        if (!daemonUrl) throw new Error("The daemon address isn't known yet.");
        const host = this.folderHost(cx, config, daemonUrl);
        const out = await copyBuiltinFolder(host, s, consent);
        if (out.needsConsent) {
          if (this.specPermission) throw new Error("Finish the open spec permission dialog first.");
          const token = `spec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          box.awaitingPermission = true;
          this.specPermission = { token, spec: s, request: { verb: "copy-folder" }, box, confirmation: out.confirmation, expires: Date.now() + 300000 };
          openOverlay({ mod: MOD_IDS.menu, kind: "dialog", width: 560, height: 420, props: { target: { kind: "spec", id: s.id }, step: { action: "confirm-spec-write", token, confirmation: out.confirmation } } });
          return;
        }
        if (out.exists) { await this.openExistingCopy(cx, s, host, out.folder, box); return; }
        if (!out.ok) { box.errors = out.errors ?? null; box.note = out.reason; return; }
        if (config.daemonMachine) this.specConsentMachine = config.daemonMachine;
        this.showSpecCopy(cx, out.copy);
      } catch (error) {
        box.note = error?.folder && /differs from the built-in/.test(String(error.message))
          ? `Your copy of ${s.name} at ${error.folder} was changed since it was made, so Copy & edit didn't overwrite it.`
          : error?.machineNotice && String(error.message).startsWith(`${config.daemonMachine} is unreachable.`)
          ? `${config.daemonMachine} is unreachable, so nothing was copied. Run hc machine login ${config.daemonMachine}, then try again.`
          : String(error?.message ?? error);
      } finally { box.copying = false; cx.notify(); }
    });
  }

  /** The copy's page, in edit mode, with an optional note above its editor. */
  showSpecCopy(cx, copy, note = null) {
    if (!this.specDirty(this.specBoxes?.[copy.id])) delete this.specBoxes?.[copy.id];
    (this.specAutoEdit ??= new Set()).add(copy.id);
    if (note) (this.specCopyNotes ??= Object.create(null))[copy.id] = note;
    else delete this.specCopyNotes?.[copy.id];
    push({ section: "specs", id: copy.id, name: copy.name, specTab: "yaml" });
    this.read(cx, "/api/specs/library", true); run("rig.refresh");
  }

  /** The built-in's folder already has a copy: open a finished one, finish an unfinished one (its fixed text is put in the editor;
   *  the person's Save is the write), and never overwrite or delete anything. */
  async openExistingCopy(cx, s, host, folder, box) {
    const found = await findExistingCopy(host, s, folder);
    if (found.state === "unindexed") {
      box.note = found.reason ?? "You already have a copy folder for this built-in, but the spec library doesn't list it yet. Refresh the library, then try again.";
      return;
    }
    if (found.state === "finished") { this.showSpecCopy(cx, found.entry, `You already have a copy of ${s.name}; this is it.`); return; }
    const key=specDraftKey(found.entry.id,this.config),draft=(shared("rig.drafts")??{})[key];
    const retained=this.specDirty(this.specBoxes?.[found.entry.id]) || typeof draft==='string' || typeof draft?.text==='string';
    if(!retained)setDraft(key, { text: found.rewritten, baseText: found.baseText, baseHash: simpleHash(found.baseText) });
    this.showSpecCopy(cx, found.entry, retained ? null
      : `An earlier copy of ${s.name} wasn't finished. The fixed agent paths are in the editor; press Save to finish it.`);
  }

  remoteSpecController(cx) {
    const bridge=attachRelayPath(appHome(),MOD_IDS.view).replace(/rig-attach-relay\.cjs$/,"rig-spec-transport.cjs");
    return new RemoteSpecs({exec,hc,machines,wait:waitWith(cx),appHome:appHome(),specBridgePath:bridge,
      health:async url=>{const r=await fetch(`${url}/healthz`);if(!r.ok)throw Error("OpenRig isn't answering.");return JSON.parse(await r.text());},
      currentConfig:async()=>preserveCliDiscoveredConfig(parseConfig(await readTextFile(CONFIG())),this.config),
      writeText:writeTextFile,
      readSpecConsent:async()=>consentOf(await readTextFile(`${appHome()}/openrig/spec-consent.json`),this.config?.connectionId??LEGACY_CONNECTION_ID),
      writeSpecConsent:async value=>{
        const path=`${appHome()}/openrig/spec-consent.json`,previous=await readTextFile(path);
        return writeTextFile(path,consentText(previous,this.config?.connectionId??LEGACY_CONNECTION_ID,value).trimEnd(),previous??null);
      },
    });
  }

  /** Remote targets go only to the pinned box helper; registration is HTTP-only. */
  remoteSpecWrite(cx,s,request,consent=null) {
    const box=this.specBoxes?.[s.id];if(!box||box.saving||box.copying||box.awaitingPermission)return;
    const config={...this.config};box[request.verb==="copy"?"copying":"saving"]=true;box.note=null;cx.notify();
    cx.spawn(async cx=>{
      try{
        const daemonUrl=await this.resolveDaemonUrl();if(!daemonUrl)throw Error("The daemon address isn't known yet.");
        let content=request.content??await this.specText(s);
        if(request.verb==="copy"){
          const prepared=copyableSpecText(content,s.sourcePath);
          if(prepared.refused)throw Error(prepared.refused);
          content=prepared.text;
        }
        const operation={...request,content};
        const route=s.kind==="agent"?"/api/agents/validate":"/api/rigs/import/validate";
        const checked=await fetch(`${daemonUrl}${route}`,{method:"POST",headers:{"content-type":"text/yaml"},body:content});
        let validation;try{validation=JSON.parse(await checked.text());}catch{}
        if(!checked.ok||validation?.valid===false){box.errors=validation?.errors??[validation?.error??"Validation failed."];return;}
        const result=await this.remoteSpecController(cx).perform(config,operation,consent);
        if(result.needsConsent){
          if(this.specPermission)throw Error("Finish the open spec permission dialog first.");
          const token=`spec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          box.awaitingPermission=true;
          this.specPermission={token,spec:s,request:operation,box,confirmation:result.confirmation,expires:Date.now()+300000};
          openOverlay({mod:MOD_IDS.menu,kind:"dialog",width:560,height:340,props:{target:{kind:"spec",id:s.id},step:{action:"confirm-spec-write",token,confirmation:result.confirmation}}});return;
        }
        if(!result.ok)throw Error(result.reason??"The box did not confirm the write.");
        this.specConsentMachine=config.daemonMachine;
        const synced=await fetch(`${daemonUrl}/api/specs/library/sync`,{method:"POST"}).catch(()=>null);
        if(request.verb==="save"){
          box.loaded=content;box.diskText=null;box.conflict=null;box.errors=null;box.restoredDraft=false;
          box.savedText=synced?.ok?`Saved on ${config.daemonMachine}.`:`Saved on ${config.daemonMachine}; library re-index failed.`;
          delete this.specCopyNotes?.[s.id];
          const now=box.state.value();setDraft(specDraftKey(s.id,this.config),now===content?null:{text:now,baseText:content,baseHash:simpleHash(content)});
          if(now===content){box.editing=false;this.makeSpecEditorState(s,box,content,true);}
        }else{
          if(!synced?.ok)throw Error(`The copy was saved on ${config.daemonMachine}, but library re-index failed. Refresh the library before copying again.`);
          const response=await fetch(`${daemonUrl}/api/specs/library`);if(!response.ok)throw Error("The copy was saved, but the library couldn't be read. Refresh before copying again.");
          const list=JSON.parse(await response.text()),copy=list.find(x=>x.sourceType==="user_file"&&x.sourcePath===result.path);
          if(!copy)throw Error("The copy was saved, but isn't indexed yet. Refresh before copying again.");
          this.cache["/api/specs/library"]={data:list,at:Date.now()};
          (this.specAutoEdit??=new Set()).add(copy.id);delete this.specBoxes[copy.id];
          const lacking=s.sourceType==="user_file"?null:siblingFileNote(siblingFileNames(content));
          if(lacking)(this.specCopyNotes??=Object.create(null))[copy.id]=lacking;
          push({section:"specs",id:copy.id,name:copy.name,specTab:"yaml"});
        }
        this.read(cx,"/api/specs/library",true);run("rig.refresh");
      }catch(error){
        if(error.code==="conflict"){
          box.conflict=this.specConflictMessage();
          try{box.diskText=await this.specText(s);}catch{}
        }else if(error.machineNotice&&String(error.message).startsWith(`${config.daemonMachine} is unreachable.`)){
          box.note=`${config.daemonMachine} is unreachable, so nothing was saved. Your edits are still here. Run hc machine login ${config.daemonMachine}, then save again.`;
        }else box.note=String(error.message??error);
      }finally{box.saving=false;box.copying=false;cx.notify();}
    });
  }

  /** "Launch rig from spec…": rig specs only, with or without a file (the menu and palette use the same rule). */
  launchButton(t, spec, id = "spec-launch") {
    return this.button(t, id, "Launch rig from spec…", () => openOverlay({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: 300,
      props: { target: { kind: "spec", id: spec.id, conn: this.config?.connectionId, name: spec.name, sourcePath: spec.sourcePath ?? null, specKind: "rig" }, step: { action: "launch-spec" } } }), { iconName: "rig-play" });
  }

  scopes(t, cx, entry) {
    const projectsRes = this.read(cx, "/api/scopes/projects");
    const projList = Array.isArray(projectsRes.data?.projects) ? projectsRes.data.projects : [];
    const activeProject = effectiveScopeProject(entry.project,shared('rig.project'),projectsRes.data);
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
            return h_flex().id(`scopes-project-${p.id}`).px(8).h(24).gap(5).rounded(6).items_center().cursor_pointer()
              .bg(on ? t.accent : t.raised).border_1().border_color(on ? t.accent : t.border).hover((s) => s.bg(on ? t.accent : t.hover))
              .text_size(11.5).font_semibold().text_color(p.error ? t.blocked : on ? (t.solid_foreground ?? t.background) : t.muted)
              .on_click(() => {
                setShared("rig.project", p.id);
                const prior = (nav().stack ?? []).filter((e) => e?.section !== "scopes");
                setShared("rig.nav", { stack: [...prior, { section: "scopes", project: p.id }] });
                this.read(cx, `/api/scopes?detail=1&project=${encodeURIComponent(p.id)}`, true);
              })
              .child(p.name ?? p.id)
              .when(!!p.error, (el) => el.child(div().text_size(11).text_color(t.blocked).child("⚠")));
          })))
        .when(!!selectedProj?.error, (el) => el.child(div().id("scopes-project-error").px(10).py(6).rounded(6).border_1().border_color(t.blocked).text_size(12).text_color(t.blocked).child(selectedProj.error)))
      : null;
    const paths = this.slicePaths(cx, activeProject);
    const wait = this.status(t, cx, scopePath, scopes);
    if (wait) return projectBar ? v_flex().gap(12).child(projectBar).child(wait) : wait;
    const missions = scopes.data.missions ?? [];
    const sliceTarget = (m, s) => ({
      kind: "slice",
      conn: this.config?.connectionId, // a scope belongs to the page's own connection (one in PR 1)
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
        const panel=new WorkflowPanel(this,{navigate:push,monoFamily:settings()?.font_family??'JetBrains Mono',ownerEntry:session=>{
          const found=resolveAskerSeat(session,this.currentTopology(cx));if(!found.found)return null;
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
      const missionFiles = Array.isArray(m.files)
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
          h_flex().id(`mission-file-${mKey}-${name}`).px(7).h(20).gap(4).items_center().rounded(5).cursor_pointer()
            .bg(t.raised).border_1().border_color(t.border).hover((x) => x.bg(t.hover))
            .on_click((_e, cx) => { cx?.stop_propagation?.(); push(fileEntry(filePath, `${name} · ${mTitle}`)); })
            .child(svg(icon("file-text")).size(11).flex_none().text_color(t.muted))
            .child(div().text_size(11).text_color(t.foreground).child(name))
            .child(this.copyButton(t, filePath, `mission-file-${mKey}-${name}`, "path"))))
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
        const knownFiles = Array.isArray(s.files)
          ? s.files.map((name) => [name, folder ? `${folder}/${name}` : name])
          : folder
            ? SLICE_FILES.map((name) => [name, `${folder}/${name}`, this.exists(cx, `${folder}/${name}`)]).filter(([, , on]) => on === true)
            : [];
        const readingFiles = !Array.isArray(s.files) && folder
          ? SLICE_FILES.some((name) => this.exists(cx, `${folder}/${name}`) === null)
          : false;
        const followReason = capabilityDisableReason("follow", this.caps());
        const doFollow = (_e, cx) => {
          cx?.stop_propagation?.();
          oneClick({ kind: "follow-target", conn: this.config?.connectionId, view: `slice:${s.id ?? sDir}`, name: sName }, "follow", `slice-follow-${sKey}`);
        };
        return v_flex().id(`slices-${mi}-${si}`).when(sliceFocused, (el) => el.rounded(6).border_1().border_color(t.accent))
          .child(h_flex().id(`slice-row-${mKey}-${sKey}`).px(8).h(30).gap(10).items_center().rounded(6).cursor_pointer().hover((x) => x.bg(t.hover))
            .on_click(toggleSlice)
            .on_mouse_down("right", () => menu(sliceTarget(m, s)))
            .child(svg(icon(shown ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim))
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).tooltip(String(sName??"")).child(sName))
            .child(this.copyButton(t, sKey, `slice-id-${sKey}`, "slice id"))
            .child(div().w(100).flex_none().truncate().text_size(12.5).text_color(t.muted).tooltip(String(s.status ?? ""??"")).child(s.status ?? ""))
            .child(div().w(100).flex_none().truncate().text_size(12.5).text_color(t.muted).tooltip(String(s.stage ?? ""??"")).child(s.stage ?? "")))
          .when(shown, (el) => el.child(v_flex().id(`slice-expand-${sKey}`).ml(22).pl(10).py(8).gap(8).border_l(1).border_color(sliceFocused ? t.accent : t.border)
            .on_click((_e, cx) => cx?.stop_propagation?.())
            .child(h_flex().gap(10).items_center().child(div().text_size(11.5).font_semibold().text_color(t.muted).child("Readiness")).child(div().text_size(12.5).font_semibold().child(s.status ?? "—")).child(this.dim(t, s.stage ?? "")))
            .when(!!s.intent, (c) => c.child(this.plain(t, s.intent).text_color(t.muted)))
            .when(!!s.miniRequirements?.length, (c) => c.child(v_flex().gap(4).child(div().text_size(11.5).text_color(t.dim).child("Mini-requirements")).child(checklist(s.miniRequirements))))
            .when(!!s.proofContract?.length, (c) => c.child(v_flex().gap(4).child(div().text_size(11.5).text_color(t.dim).child("Proof contract")).child(checklist(s.proofContract))))
            .child(knownFiles.length
              ? h_flex().gap(6).items_center().flex_wrap().children(knownFiles.map(([name, filePath], fi) => {
                  const openFile = (_e, cx) => { cx?.stop_propagation?.(); push(fileEntry(filePath, `${name} · ${sName}`)); };
                  const compatFileId = isFirstExpanded ? `file-${fi}-${name}` : `file-${sKey}-${fi}-${name}`;
                  return div().id(`slice-file-${sKey}-${name}`).on_click(openFile).child(
                    h_flex().id(compatFileId).px(8).h(24).gap(5).items_center().rounded(6).cursor_pointer()
                      .bg(t.raised).border_1().border_color(t.border).hover((x) => x.bg(t.hover))
                      .on_click(openFile)
                      .child(svg(icon("file-text")).size(12).flex_none().text_color(t.muted))
                      .child(div().text_size(11.5).text_color(t.foreground).child(name))
                      .child(this.copyButton(t, filePath, `slice-file-${sKey}-${fi}`, "path")),
                  );
                }))
              : this.dim(t, !folder ? "OpenRig doesn't say where this slice is on disk." : readingFiles ? "Looking…" : "None of the files are on disk."))
            .child(h_flex().gap(8).items_center()
              .child(div().id(isFirstExpanded ? "follow-slice" : `follow-slice-${sKey}`).on_click((_e, cx) => { if (!followReason) doFollow(_e, cx); }).child(
                this.button(t, `slice-follow-${sKey}`, "Follow this slice", doFollow, { primary: true, small: true, iconName: "rig-follow", disabled: !!followReason, tooltip: followReason, actionKey: "follow" }),
              ))
              .when(!!followReason, (c) => c.child(this.workerCapabilityNote(t, followReason))))));
      });
      return v_flex().id(`mission-card-${mKey}`).rounded(10).bg(t.background).border_1().border_color(missionFocused ? t.accent : t.border).p(12).gap(8)
        .child(h_flex().gap(8).items_center().flex_wrap()
          .child(div().id(`mission-open-${mKey}`).flex_1().text_size(12.5).font_semibold().text_color(t.accent).cursor_pointer()
            .tooltip("Open mission").on_click(()=>push({section:"scopes",...(workflowProject?{project:workflowProject}:{}),mission:mTitle,missionTab:hasWorkflows?"workflows":"slices"})).child(mTitle))
          .child(this.copyButton(t, mKey, `mission-${mKey}`, "mission id"))
          .child(headerMeta))
        .when(!!m.error, (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(m.error)))
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
    const capReason = capabilityDisableReason("open-view", caps);
    if (capReason) return this.workerCapabilityNote(t, capReason);
    const fullPath = `/api/terminal/preview?view=${encodeURIComponent(viewKey)}&provider=herdr-app${caps.hostWorkerViews?"&viewportColumns=160":`&appHome=${encodeURIComponent(appHome())}`}`;
    const preview = this.read(cx, fullPath);
    if (preview.status === 401 || /\b401\b/.test(String(preview.error ?? ""))) {
      return this.dim(t, TERMINAL_TOKEN_PROTECTED);
    }
    const wait = this.status(t, cx, fullPath, preview);
    if (wait) return wait;
    const normalized = normalizeTerminalPreview(preview.data?.composed, viewKey, sharedRigData(this.config, shared)?.topology ?? []);
    const opened = normalized.opened;
    const absent = normalized.absent;
    const pages = normalized.pages;
    const rigName = normalized.rigName;
    const rigEntry = rigName ? (sharedRigData(this.config, shared)?.topology ?? []).find((r) => r.name === rigName || r.id === rigName) : null;
    const noAttachableReason = opened.length === 0
      ? `No attachable seats (${absent.length} absent)`
      : null;
    const openReason = capReason ?? noAttachableReason;
    const doOpen = (_e, cx) => {
      cx?.stop_propagation?.();
      oneClick({ kind: "open-view", view: viewKey, plan: preview.data?.planId, rig: rigName, rigId: rigEntry?.id ?? null, conn: rigEntry?.conn ?? this.config?.connectionId }, "open-view", `open-view-${viewKey}`);
    };
    const doResume = (_e, cx) => {
      cx?.stop_propagation?.();
      if (!rigName) return;
      openOverlay({
        mod: MOD_IDS.menu,
        kind: "dialog",
        width: 460,
        height: 380,
        props: {
          target: { kind: "rig", rig: rigName, rigId: rigEntry?.id ?? null, conn: rigEntry?.conn ?? this.config?.connectionId, lifecycle: rigEntry?.lifecycleState ?? rigEntry?.lifecycle ?? "stopped" },
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
        .child(this.dim(t, `${opened.length} attachable · ${absent.length} absent · ${pages.length} page${pages.length===1?"":"s"}`))
        .child(div().flex_1())
        .when(opened.length === 0 && Boolean(rigName) && Boolean(normalized.rigStopped), (el) => el.child(
          this.button(t, `resume-terminal-rig-${rigName}`, "Rig is stopped · Resume…", doResume, { primary: true, small: true, iconName: "rig-play" }),
        ))
        .child(div().id(openWrapperId).on_click((_e, cx) => { if (!openReason) doOpen(_e, cx); }).child(
          this.button(t, `open-view-${viewKey}`, caps.hostWorkerViews?"Worker view":"Open", doOpen, { primary: opened.length > 0, small: true, iconName: "rig-view", disabled: !!openReason, tooltip: openReason, actionKey: "open-view" }),
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
            .on_click(toggleRow)
            .on_mouse_down("right", () => menu({ kind: "terminal", view: r.view, name: r.name, ...(r.kind === "rig" ? { rig: r.name } : {}) }))
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
    const fromShared = this.config?.connectionsRefused ? null : sharedRigData(this.config, shared)?.topology; // a refused list shows no rows another mod left behind
    if (Array.isArray(fromShared) && fromShared.length > 0) return fromShared;
    const summary = this.cache["/api/rigs/summary"]?.data ?? this.read(cx, "/api/rigs/summary", false, (sData) => {
      if (Array.isArray(sData)) {
        for (const r of sData) {
          if (r?.id && !r.archivedAt) this.nodesOf(cx, r.id);
        }
      }
    }).data ?? [];
    return (Array.isArray(summary) ? summary : []).filter((r) => r && !r.archivedAt).map((r) => rigModel(r, this.nodesOf(cx, r.id).data, [], this.config?.connectionId));
  }

  openAskerSeat(cx, n) {
    const asker = n?.asker ?? (n?.logicalId && n?.rig ? `${n.logicalId}@${n.rig}` : null);
    const assistant=assistantForNeed({...n,asker},this.hostedMembers(cx));
    if(assistant){const rig=this.currentTopology(cx).find(r=>r.name===assistant.rig&&r.conn===assistant.conn);push({section:'topology',kind:'assistant',session:assistant.seat,conn:assistant.conn,rig:assistant.rig,rigId:rig?.id,name:assistant.name});return;}
    const resolved = resolveAskerSeat(asker, this.currentTopology(cx));
    if (!resolved.found) {
      this.askerNotes[n.id] = resolved.message;
      cx?.notify?.();
      return;
    }
    delete this.askerNotes[n.id];
    const config = this.config;
    cx.spawn(async (cx) => {
      const res = await attachToSeat({ exec, run, hc, spaces, panes, terminals, layout, shared, setShared, wait: waitWith(cx), relayPath: attachRelayPath(appHome(), MOD_IDS.view) }, resolved.seat, config);
      if (res && res.ok === false && res.reason) {
        this.askerNotes[n.id] = res.reason;
      }
      cx.notify();
    });
  }

  persistStatePatch(cx, patch = {}) {
    if (patch.lastSeenNeedsAt !== undefined) setShared("rig.lastSeenNeedsAt", patch.lastSeenNeedsAt);
    if (patch.needsView !== undefined) setShared("rig.needsView", patch.needsView);
    if (patch.lastEndedModeApplicationId !== undefined) setShared("rig.lastEndedModeApplicationId", patch.lastEndedModeApplicationId);
    if (patch.lastActiveModeApplicationId !== undefined) setShared("rig.lastActiveModeApplicationId", patch.lastActiveModeApplicationId);
    const statePath = `${appHome()}/openrig/state.json`;
    cx.spawn(async (cx) => {
      try {
        const prev = await readTextFile(statePath).catch(() => null);
        const parsed = parseSidebarState(prev ?? "{}");
        const nextText = serializeSidebarState(prev ?? "{}", {
          open: shared("rig.open.page") ?? parsed.open ?? {},
          order: shared("rig.order") ?? parsed.order ?? {},
          lastSeenNeedsAt: patch.lastSeenNeedsAt !== undefined ? patch.lastSeenNeedsAt : (shared("rig.lastSeenNeedsAt") ?? parsed.lastSeenNeedsAt),
          needsView: patch.needsView !== undefined ? patch.needsView : (shared("rig.needsView") ?? parsed.needsView),
          lastEndedModeApplicationId: patch.lastEndedModeApplicationId !== undefined ? patch.lastEndedModeApplicationId : (shared("rig.lastEndedModeApplicationId") ?? parsed.lastEndedModeApplicationId),
          lastActiveModeApplicationId: patch.lastActiveModeApplicationId !== undefined ? patch.lastActiveModeApplicationId : (shared("rig.lastActiveModeApplicationId") ?? parsed.lastActiveModeApplicationId),
        });
        await writeTextFile(statePath, nextText, prev).catch(() => null);
      } catch (_) { /* ignore state write error */ }
      cx.notify();
    });
  }

  whoseQueueRow(t, cx, perspective, item = null) {
    const whose = whoseQueueSummary(perspective, this.config, item);
    if (!whose) return null;
    const curView = shared("rig.needsView") ?? (whose.basis === "all" ? "all" : whose.basis === "default" ? "default" : (whose.personId ?? "default"));
    const setView = (nextView) => {
      setShared("rig.needsView", nextView);
      this.persistStatePatch(cx, { needsView: nextView });
      const path = nextView ? `/api/attention?view=${encodeURIComponent(nextView)}` : "/api/attention";
      this.read(cx, path, true);
      cx.notify();
    };
    const pill = (id, key, label, disabled = false) => {
      const on = curView === key || (!shared("rig.needsView") && key === "default" && whose.basis === "default");
      return h_flex().id(id).px(7).h(20).rounded(5).items_center().cursor_pointer()
        .bg(on ? t.accent : t.raised).border_1().border_color(on ? t.accent : t.border)
        .hover((s) => s.bg(on ? t.accent : disabled ? t.raised : t.hover))
        .text_size(11).text_color(disabled ? t.dim : on ? (t.solid_foreground ?? t.background) : t.muted)
        .on_click(() => { if (!disabled) setView(key); })
        .child(label);
    };
    return h_flex().id("needs-whose-queue").px(10).h(26).gap(8).items_center().rounded(6).bg(t.background).border_1().border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).tooltip(String((whose.onSomeoneElsesAsk ? `${whose.headline} · ${whose.onSomeoneElsesAsk}` : whose.headline)??"")).child(
        whose.onSomeoneElsesAsk ? `${whose.headline} · ${whose.onSomeoneElsesAsk}` : whose.headline
      ))
      .child(h_flex().gap(4).items_center()
        .child(pill("needs-view-mine", whose.personId ?? "mine", "Mine", !whose.personId))
        .child(pill("needs-view-default", "default", "Default"))
        .child(pill("needs-view-all", "all", "Everyone")));
  }

  warmPersonAwayData(cx) {
    const rawPerson = typeof this.config?.person === "string" ? this.config.person.trim().replace(/@external$/, "") : null;
    const participants = this.cache["/api/gateway/participants"]?.data?.participants ?? [];
    const firstHuman = participants.find((p) => p?.kind === "human" || String(p?.address ?? "").endsWith("@external"));
    const personId = rawPerson || (firstHuman?.entityId ?? (firstHuman?.address ? String(firstHuman.address).replace(/@external$/, "") : null));
    if (!personId) return null;
    const warmEndedApp = (appId) => {
      if (!appId) return;
      this.read(cx, `/api/gateway/human/${encodeURIComponent(personId)}/mode/applications/${encodeURIComponent(appId)}/account`);
      this.read(cx, `/api/gateway/human/${encodeURIComponent(personId)}/mode/applications/${encodeURIComponent(appId)}/decisions`);
    };
    const syncModeAppState = (mData) => {
      const activeAppId = mData?.current?.applicationId ?? null;
      if (activeAppId) {
        if (shared("rig.lastActiveModeApplicationId") !== activeAppId) {
          this.persistStatePatch(cx, { lastActiveModeApplicationId: activeAppId });
        }
      } else if (mData && "current" in mData && !mData.current) {
        const prevActive = shared("rig.lastActiveModeApplicationId");
        if (prevActive) {
          this.persistStatePatch(cx, { lastEndedModeApplicationId: prevActive, lastActiveModeApplicationId: null });
        }
      }
    };
    const modeRes = this.read(cx, `/api/gateway/human/${encodeURIComponent(personId)}/mode`, false, (mData) => {
      syncModeAppState(mData);
      const appId = (Array.isArray(mData?.recentApplications) ? mData.recentApplications.find((a) => a?.status === "ended")?.applicationId : null)
        ?? (!mData?.current ? (shared("rig.lastEndedModeApplicationId") ?? null) : null);
      warmEndedApp(appId);
    });
    if (modeRes?.data) syncModeAppState(modeRes.data);
    const roomRes = this.read(cx, `/api/gateway/human/${encodeURIComponent(personId)}/decision-room`, false, (rData) => {
      const appId = rData?.latestEndedApplication?.applicationId ?? rData?.latestEndedApplication?.id ?? null;
      warmEndedApp(appId);
    });
    const endedAppId = roomRes?.data?.latestEndedApplication?.applicationId
      ?? roomRes?.data?.latestEndedApplication?.id
      ?? (Array.isArray(modeRes?.data?.recentApplications) ? modeRes.data.recentApplications.find((a) => a?.status === "ended")?.applicationId : null)
      ?? (!modeRes?.data?.current ? (shared("rig.lastEndedModeApplicationId") ?? null) : null)
      ?? null;
    if (endedAppId) warmEndedApp(endedAppId);
    return { personId, endedAppId };
  }

  sinceYouWereAwayCard(t, cx, items) {
    if (this.awayDismissed) return null;
    const lastSeenNeedsAt = shared("rig.lastSeenNeedsAt") ?? null;
    const warmed = this.warmPersonAwayData(cx);
    let endedModeAccount = null;
    let endedModeDecisions = null;
    if (warmed?.personId && warmed?.endedAppId) {
      const acctPath = `/api/gateway/human/${encodeURIComponent(warmed.personId)}/mode/applications/${encodeURIComponent(warmed.endedAppId)}/account`;
      const decPath = `/api/gateway/human/${encodeURIComponent(warmed.personId)}/mode/applications/${encodeURIComponent(warmed.endedAppId)}/decisions`;
      endedModeAccount = this.read(cx, acctPath).data ?? null;
      endedModeDecisions = this.read(cx, decPath).data ?? null;
    }
    const digest = sinceYouWereAwaySummary(items, {
      lastSeenNeedsAt, timezone:this.uiTimezone,
      endedModeAccount,
      endedModeDecisions,
    });
    if (!digest || !digest.show) return null;
    const markSeen = (_e, cx) => {
      this.awayDismissed = true;
      this.persistStatePatch(cx, { lastSeenNeedsAt: new Date().toISOString(), lastEndedModeApplicationId: null });
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
        .child(this.button(t, "needs-mark-seen", "Mark seen", markSeen, { small: true })))
      .children(tierOrder.filter(([k]) => (digest.groups[k] ?? []).length > 0).map(([k, label, color]) =>
        h_flex().id(`needs-away-group-${k}`).gap(8).items_center().text_size(12)
          .child(div().w(95).flex_none().font_semibold().text_color(color).child(`${label} (${digest.groups[k].length})`))
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).tooltip(String(digest.groups[k].map((x) => x.summary).join(" · ")??"")).child(digest.groups[k].map((x) => x.summary).join(" · ")))
      ))
      .when(digest.decisions.length > 0, (el) => el.child(v_flex().id("needs-coming-back-account").gap(6).pt(6).border_t(1).border_color(t.border)
        .child(div().text_size(12).font_semibold().text_color(t.foreground).child(digest.modeHeading ?? "Decided for you while away"))
        .children(digest.decisions.map((d, i) =>
          v_flex().id(`needs-away-decision-${i}`).rounded(6).bg(t.raised).p(8).gap(3).cursor_pointer()
            .on_click(() => { if (d.qitemId) push({ section: "needs", id: `queue:${d.qitemId}`, name: d.summary ?? d.qitemId }); })
            .child(h_flex().gap(8).items_center()
              .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().text_color(t.foreground).tooltip(String(d.summary ?? d.qitemId??"")).child(d.summary ?? d.qitemId))
              .child(div().px(6).h(18).rounded(4).flex().items_center().bg(t.background).text_size(10.5).text_color(d.reversible ? t.muted : t.blocked).child(d.reversibilityLabel))
              .child(div().text_size(11).text_color(t.dim).child(`by ${d.decidedBy}`)))
            .when(!!d.choices, (c) => c.child(div().text_size(11.5).text_color(t.foreground).child(`Chose: ${d.choices}`)))
            .when(!!d.reason, (c) => c.child(div().text_size(11.5).text_color(t.muted).child(d.reason)))
        ))));
  }

  needs(t, cx, entry) {
    const viewParam = entry.view ?? shared("rig.needsView") ?? null;
    const attPath = viewParam ? `/api/attention?view=${encodeURIComponent(viewParam)}` : "/api/attention";
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
      const itemPath = `/api/attention?item=${encodeURIComponent(entry.id)}${viewParam ? `&view=${encodeURIComponent(viewParam)}` : ""}`;
      this.read(cx, itemPath);
      if (String(entry.id).startsWith("queue:")) {
        this.read(cx, `/api/queue/${encodeURIComponent(String(entry.id).slice(6))}`);
      }
    }
    const wait = this.status(t, cx, attPath, att);
    if (wait) return wait;
    const rawItems = enrichAttentionItems(att.data?.items ?? [], agg.data);
    const allItems = rawItems.map((raw) => {
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
    const dismissals = this.updateModel();
    const items = dismissals.visible(allItems);
    this.visibleUpdates = items.filter(dismissible);
    const whoseRow = this.whoseQueueRow(t, cx, att.data?.perspective, entry.id ? items.find((x) => x.id === entry.id) : null);
    if (entry.id) {
      // One item (sidebar or toast click): the full Decision Card, here; no menu or dialog between.
      const n = items.find((x) => x.id === entry.id);
      if (!n) {
        if (isHealthAttention({ id: entry.id })) return this.dim(t, "Health findings are in System → Health.")
          .on_click(() => push({ section: "system", subview: "health" }));
        const receipt = dismissals.receiptRows().find((r) => r.keys.some((key) => dismissals.records.find((v) => v.key === key)?.item.id === entry.id));
        if (receipt) return this.updateReceipt(t, receipt);
        const hidden = dismissals.hidden().find((r) => r.item.id === entry.id);
        if (hidden) return v_flex().gap(8).child(this.dim(t, hidden.note ?? "Dismissed here."))
          .child(this.button(t, "restore-open-update", "Restore", () => this.updateAction("restore", hidden.key), { small: true }));
        const answered = this.answered[entry.id];
        if (answered?.text) return v_flex().gap(10).child(this.title(t, answered.summary))
          .child(h_flex().id(`need-result-${entry.id}`).gap(6).items_start().min_w(0)
            .child(svg(icon("check")).size(12).flex_none().text_color(t.working)).child(this.dim(t, answered.text).flex_1().min_w(0)));
        return this.dim(t, "This request was already answered.");
      }
      if (n.criticalHealth) return this.healthNeedsLine(t, n);
      return v_flex().gap(12)
        .when(!!whoseRow, (el) => el.child(whoseRow))
        .child(this.decisionCard(t, cx, n, { standalone: true, perspective: att.data?.perspective }))
        ;
    }
    // Replies sent from here whose item has left the list: said for a moment, then gone.
    const gone = Object.entries(this.answered).filter(([id, a]) => Date.now() - a.at < STATUS_MS && !items.some((n) => n.id === id));
    if (gone.length) this.ticking = true;
    // The daemon names each source it read; one that is down makes an empty list unknown, not empty.
    const coverage = attentionCoverage(att.data.sources ?? []);
    const awayCard = this.sinceYouWereAwayCard(t, cx, items);
    const actionableItems = sortNeedsByTier(items.filter((n) => !n.update));
    const updateItems = items.filter((n) => n.update);
    this.pageNeedsCounts={requests:needsRequestCount(this.currentTopology(cx),items),updates:updateItems.length};
    const requestsView=(entry.needsTab??"requests")==="requests";
    if(requestsView){this.selectedUpdate=null;this.visibleUpdates=[];}
    const updateDisplay = [...updateItems];
    const receipts = dismissals.receiptRows();
    for (const receipt of receipts.filter((r) => r.keys.length === 1)) updateDisplay.splice(Math.min(receipt.position, updateDisplay.length), 0, { receipt });
    return v_flex().gap(12)
      .when(!!whoseRow, (el) => el.child(whoseRow))
      .when(!!awayCard&&requestsView, (el) => el.child(awayCard))
      .when(!!entry.notice, (el) => el.child(div().id("need-expired-notice").text_size(12).text_color(t.muted).child(entry.notice)))
      .when(requestsView,el=>el.child(this.card(t, "Requests", [...gone.map(([id, a]) => h_flex().id(`need-answered-${id}`).px(8).gap(8).items_center()
        .child(svg(icon("check")).size(12).flex_none().text_color(t.working)).child(div().flex_1().truncate().text_size(12).text_color(t.muted).tooltip(String(a.text ?? a.summary??"")).child(a.text ?? a.summary))),
        this.needRows(t, cx, "needs", actionableItems, att.data?.perspective)])))
      .when(!requestsView,el=>el.child(this.card(t, `Updates (${updateItems.length})`, [
        ...receipts.filter((r) => r.keys.length > 1).map((r) => this.updateReceipt(t, r)),
        this.needRows(t, cx, "updates", updateDisplay, att.data?.perspective),
        ...(dismissals.show && dismissals.hidden().length ? [this.dim(t, "Dismissed"),
          this.needRows(t, cx, "dismissed", dismissals.hidden().map((r) => ({ ...r.item, dismissed: true, dismissalNote: r.note })), att.data?.perspective)] : []),
        ...(shared("rig.dismissSaveError") ? [this.dim(t, shared("rig.dismissSaveError"))] : []),
      ], h_flex().gap(8).items_center()
        .when(updateItems.length > 0, (el) => el.child(this.updateButton(t, "dismiss-all-updates", "Dismiss all", () => this.updateAction("dismiss", updateItems))))
        .when(dismissals.hidden().length > 0, (el) => el.child(div().id("show-dismissed-updates").text_size(12).text_color(t.accent).cursor_pointer()
          .on_click(() => this.updateAction("show")).child(`${dismissals.show ? "Hide" : "Show"} dismissed (${dismissals.hidden().length})`))))))
      .children(coverage.errors.map((s, i) => div().id(`need-source-${i}`).text_size(11.5).text_color(t.blocked).child(`${s.source}: ${s.state}${s.detail ? ` · ${s.detail}` : ""}`)))
      .when(coverage.incomplete, (el) => el.child(v_flex().gap(4)
        .child(h_flex().id("need-coverage-toggle").gap(6).items_center().text_size(11.5).text_color(t.dim).cursor_pointer()
          .on_click(() => setOpen("needs:coverage", !(shared("rig.open.page") ?? {})["needs:coverage"]))
          .child(svg(icon((shared("rig.open.page") ?? {})["needs:coverage"] ? "chevron-down" : "chevron-right")).size(11).flex_none())
          .child("Coverage · results may be incomplete"))
        .when(Boolean((shared("rig.open.page") ?? {})["needs:coverage"]), (fold) => fold.children(coverage.partial.map((s, i) =>
          this.plain(t, `${s.source}: ${s.state}${s.detail ? ` · ${s.detail}` : ""}`, `need-coverage-${i}`).text_color(t.dim))))))
      .child(this.dim(t, `Read ${relativeTimeText(att.data.readAt)}. Viewing is not approval.`).id("needs-read-time").tooltip(this.time(att.data.readAt,{exact:true})));
  }

  /** Needs-You rows: a click opens the Decision Card in place (`shared("rig.open.page")`, `needs:<id>`, so the palette and the
   *  sidebar agree); right-click is the menu. A palette filter narrows them, as it does a table. */
  needRows(t, cx, idPrefix, list, perspective = null) {
    if (idPrefix === "needs") return this.requestRows(t, cx, list, perspective);
    const f = this.filter?.toLowerCase();
    if (f) list = list.filter((n) => [n.summary, n.urgency, n.asker, n.scope, n.tier].some((c) => String(c ?? "").toLowerCase().includes(f)));
    const open = shared("rig.open.page") ?? {};
    const focusNeed = shared("rig.focusNeed");
    const toggle = (n) => {
      this.selectedUpdate = dismissible(n) ? n : null;
      const now = shared("rig.open.page") ?? {}, next = !now[`needs:${n.id}`];
      if (next && n.reply !== "none") this.replies[n.id] ??= this.makeReply(n);
      if (!next && shared("rig.focusNeed") === n.id) setShared("rig.focusNeed", null);
      setShared("rig.open.page", { ...now, [`needs:${n.id}`]: next });
    };
    return v_flex()
      .child(h_flex().px(8).h(24).gap(10).items_center().border_b(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(div().w(12)).child(div().flex_1().child("What")).child(div().w(140).flex_none().child("Answer")).child(div().w(150).flex_none().child("Since")))
      .children(list.length ? list.map((n, i) => {
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
            ? "Approve / Answer"
            : n.reply === "resolve"
              ? "Resolve"
              : n.reply === "answer"
                ? "Answer"
                : isUpdateNeed(n) ? "no action needed" : "Needs you";
        return v_flex().when(focused, (el) => el.border_1().border_color(t.accent).rounded(6))
          .child(h_flex().id(`${idPrefix}-${i}`).px(8).h(30).overflow_hidden().gap(10).items_center().rounded(6).hover((s) => s.bg(t.hover))
            .when(dismissible(n) && this.selectedUpdate?.id === n.id, (el) => el.bg(t.selection ?? t.raised))
            .when(isEscalation, (el) => el.border_l(2).border_color(t.blocked))
            .on_click(() => toggle(n)).on_mouse_down("right", () => menu(n))
            .child(svg(icon(shown ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(rowTheme.dim))
            .when(isEscalation, (el) => el.child(div().px(5).h(16).rounded(4).flex().items_center().bg(t.blocked + "26").text_color(t.blocked).text_size(10).font_semibold().child("ESCALATION")))
            .when(!isEscalation && tier !== "update", (el) => el.child(this.plainDot(t, isAlert ? "blocked" : "accent")))
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(n.dismissed ? dismissedTone : tier === "update" ? t.muted : t.foreground).when(isEscalation || isAlert, (d) => d.font_semibold()).tooltip(String(singleLineText(n.summary)??"")).child(singleLineText(n.summary)))
            .child(div().w(140).flex_none().truncate().text_size(12.5).text_color(rowTheme.muted).tooltip(String(actionLabel??"")).child(actionLabel))
            .child(this.copyButton(rowTheme, n.qitemId ?? n.id, `need-id-${n.id}`, "request id"))
            .when(dismissible(n) && this.selectedUpdate?.id === n.id, (el) => el.child(this.updateButton(t, `dismiss-${idPrefix}-${i}`, n.dismissed ? "Restore" : "Dismiss", (_e, cx) => {
              cx.stop_propagation(); this.updateAction(n.dismissed ? "restore" : "dismiss", n.dismissed ? updateKey(n) : n);
            })))
            .child(this.updateButton(rowTheme, `need-menu-${idPrefix}-${i}`, "⋯", (_e, cx) => { cx.stop_propagation(); menu(n); }))
            .child(div().w(150).flex_none().truncate().text_size(12.5).text_color(rowTheme.muted).tooltip(this.time(n.at,{exact:true})).child(relativeTimeText(n.at))))
          .when(shown, (el) => el.child(v_flex().ml(22).pl(10).py(6).border_l(1).border_color(focused ? t.accent : t.border).child(n.dismissed ? this.dim(t, n.dismissalNote ?? "Hidden here only.") : this.needBody(t, cx, n, perspective))));
      }) : [div().p(10).text_size(12).text_color(t.dim).child(f ? `No matches for /${this.filter}.` : idPrefix === "updates" ? "No recent updates." : "No pending Needs-You requests.")]);
  }

  /** A request opened in place or on its own item page: renders the full Decision Card. */
  requestRows(t, cx, items, perspective) {
    const filter = this.filter?.toLowerCase();
    if (filter) items = items.filter(n => [n.summary, n.asker].some(s => String(s ?? "").toLowerCase().includes(filter)));
    const toggle = (n) => { if (n.criticalHealth) { push({ section: "system", subview: "health" }); return; } this.selectedNeed = n.id; if (n.reply !== "none") this.replies[n.id] ??= this.makeReply(n); setOpen(`needs:${n.id}`, !(shared("rig.open.page") ?? {})[`needs:${n.id}`]); };
    return v_flex().id("need-request-list").on_key_down((e, cx) => {
      if (!["up", "down", "enter"].includes(e.key)) return;
      cx.stop_propagation();
      let i = items.findIndex(n => n.id === this.selectedNeed);
      if (e.key === "enter") { if (i >= 0) toggle(items[i]); }
      else { i = Math.max(0, Math.min(items.length - 1, i + (e.key === "down" ? 1 : -1))); this.selectedNeed = items[i]?.id; }
      cx.notify();
    }).children(items.length ? items.map((n, i) => {
      if (n.criticalHealth) return this.healthNeedsLine(t, n);
      // A blank summary needs the same body the expanded card uses; fetch it only for these rows.
      const queue = n.summaryIsFallback && !n.body && n.qitemId ? this.read(cx, `/api/queue/${encodeURIComponent(n.qitemId)}`).data : null;
      const text = requestCardText(n, queue?.body), tier = tierOf(n), urgent = ["alert", "escalation"].includes(tier);
      const assistant=assistantForNeed(n,this.hostedMembers(cx));
      const owner = n.reply === "resolve" || n.answer?.verb === "resolve" ? parkedWorkOwner(n) : assistant?assistantOwner(assistant):n.asker ?? n.sourceSession;
      const age = Date.parse(n.at ?? ""), mins = Number.isFinite(age) ? Math.max(0, Math.floor((Date.now() - age) / 60000)) : null;
      const shown = Boolean((shared("rig.open.page") ?? {})[`needs:${n.id}`]);
      return v_flex().min_w(0).child(h_flex().id(`needs-${i}`).px(8).h(34).overflow_hidden().gap(8).items_center().rounded(6).cursor_pointer().hover(s => s.bg(t.hover))
        .when(this.selectedNeed === n.id, el => el.bg(t.selection ?? t.raised))
        .on_click(() => toggle(n)).on_mouse_down("right", () => menu(n))
        .child(div().w(12).text_size(12).text_color(urgent ? t.blocked : t.accent).child(urgent ? "◆" : "●"))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).tooltip(String(n.summary ?? text.headline)).child(text.headline))
        .child(div().max_w(180).truncate().text_size(11.5).text_color(t.muted).tooltip(String(String(owner ?? "")??"")).child(String(owner ?? "")))
        .child(div().text_size(11).text_color(t.dim).tooltip(this.time(n.at,{exact:true})).child(mins === null ? "" : mins < 1 ? "<1m" : `${mins}m`))
        .child(this.updateButton(t, `need-menu-needs-${i}`, "⋯", (_e, cx) => { cx.stop_propagation(); menu(n); })))
        .when(shown, el => el.child(this.decisionCard(t, cx, n, { perspective })));
    }) : [this.dim(t, filter ? "No matching requests." : "No pending Needs-You requests.")]);
  }

  needBody(t, cx, n, perspective = null) {
    return this.decisionCard(t, cx, n, { standalone: false, perspective });
  }

  healthNeedsLine(t, n) {
    const started = Date.parse(n.healthFinding?.startedAt ?? "");
    const minutes = Number.isFinite(started) ? Math.max(0, Math.floor((Date.now() - started) / 60000)) : null;
    return h_flex().id(`critical-health-${n.id}`).px(8).h(34).gap(8).items_center().text_size(12.5).cursor_pointer().hover(el => el.bg(t.hover))
      .on_click(() => push({ section: "system", subview: "health" }))
      .child(div().w(12).text_color(t.blocked).child("◆"))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).tooltip(String(n.summary??"")).child(n.summary))
      .child(div().max_w(180).truncate().text_size(11.5).text_color(t.muted).tooltip("health · critical").child("health · critical"))
      .child(div().text_size(11.5).text_color(t.dim).tooltip(this.time(n.healthFinding?.startedAt,{exact:true})).child(minutes === null ? "—" : minutes < 1 ? "<1m" : `${minutes}m`))
      .child(div().text_size(11.5).text_color(t.accent).child("System → Health"));
  }

  prepareNeedFocus(cx, box, keys) {
    if (!box || box.focusPreparing || !cx?.focus_handle) return;
    const missing = keys.filter(key => !box.cardHandles?.[key]);
    if (!missing.length) return;
    box.focusPreparing = true;
    cx.spawn(async (cx) => {
      await Promise.resolve();
      box.cardHandles ??= Object.create(null);
      for (const key of missing) box.cardHandles[key] ??= cx.focus_handle();
      box.focusPreparing = false; cx.notify();
    });
  }

  routeNeedKey(e, cx, entry) {
    if (e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt || !["r", "d", "escape"].includes(String(e.key).toLowerCase())) return false;
    const id = entry.id ?? this.selectedNeed ?? shared("rig.focusNeed");
    if (!id || (!entry.id && !(shared("rig.open.page") ?? {})[`needs:${id}`])) return false;
    const key = this.replies[id]?.cardKey;
    if (!key) return false;
    key(e, cx); return true;
  }

  /** Requests use a short opening and an explicit action; the complete source stays in safe folded Details. */
  requestCard(t, cx, { n, queueRow, detailItem, detailLines, recordedLines, evidenceFiles, qState, box, standalone, asker, perspective }) {
    if (box) box.cardMode = true;
    const id = n.id, width = this.needCardWidths?.[id] ?? 800, narrow = width < 480;
    const text = requestCardText(n, detailLines.join("\n\n"), { openingLimit: Math.floor((width - 40) * 4 / 7) });
    const headlineLimit = Math.max(20, Math.floor((width - 40) * 2 / ((narrow ? 15.5 : 17) * 0.55)));
    const displayHeadline = text.headline.length <= headlineLimit ? text.headline : `${text.headline.slice(0, headlineLimit - 1).replace(/\s+\S*$/, "")}…`;
    const verb = n.answer?.verb ?? n.verb ?? (n.reply === "resolve" ? "resolve" : n.reply === "answer" ? "answer" : null);
    const resolve = verb === "resolve", tier = tierOf(n);
    const tone = tier === "escalation" || tier === "alert" ? t.blocked : t.accent;
    const tierWord = tier === "escalation" ? "Escalation · stuck work" : tier === "alert" ? "Needs you now" : "Routine";
    const kind = resolve ? "Parked · needs your words" : qState.totalCount ? "Decision" : verb === "approve" ? "Approval" : "Question";
    const owner = resolve ? parkedWorkOwner(queueRow ?? n) : asker;
    const resolved = resolveAskerSeat(owner, this.currentTopology(cx));
    const logical = resolved.found ? resolved.seat.logicalId : String(owner ?? "the asking seat").split("@")[0].replace(/-/g, ".");
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
    const targetBox = () => this.replies[id] ??= this.makeReply(n);
    const openComposer = (cx, denying = false) => {
      if (!verb || n.native || busy) return;
      const b = targetBox(); b.cardMode = true; b.composerOpen = true; b.denying = denying; b.result = null;
      this.bindReplyInput(b, denying ? `Why not? ${asker ?? "the asking seat"} reads this.` : resolve ? "Your decision, in your own words" : "Your answer, in your own words");
      b.input.focus(); cx?.notify?.();
    };
    const send = (act, cx) => { if (!busy) this.submitCardDecision(cx, n, detailItem, queueRow, act); };
    const optionKeys = qState.questions.flatMap(q => q.options.map(o => `option:${q.id}:${o.id}`));
    this.prepareNeedFocus(cx, box, ["card", "approve", "deny", "resolve", "answer", "reply", "details", "resume", ...optionKeys]);
    const action = (key, label, click, { primary = false, recommended = false } = {}) => {
      const handle = box?.cardHandles?.[key];
      return h_flex().id(`need-${key}-${id}`).h(32).px(12).gap(8).items_center().justify_center().rounded(6)
        .when(Boolean(whose?.onSomeoneElsesAsk), el => el.tooltip(whose.onSomeoneElsesAsk))
        .when(narrow, el => el.w_full()).when(!narrow, el => el.flex_none())
        .bg(primary ? (t.solid ?? t.accent) : t.raised).text_color(primary ? (t.solid_foreground ?? t.background) : t.foreground)
        .border_1().border_color(primary ? (t.solid ?? t.accent) : t.border).text_size(13)
        .when(!busy, el => el.cursor_pointer().hover(s => s.bg(primary ? t.accent : t.hover)))
        .when(!!handle, el => el.track_focus(handle).tab_stop(true).tab_index(0))
        .when(Boolean(handle?.is_focused?.()), el => el.border_color(t.accent).border_2())
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); handle?.focus(); })
        .on_key_down((e, cx) => { if (handle?.is_focused?.() && ["enter", "space", " "].includes(e.key)) { cx.stop_propagation(); if (!busy) click(cx); } })
        .on_click((_e, cx) => { cx.stop_propagation(); if (!busy) click(cx); })
        .child(label).when(recommended, el => el.child(div().text_size(10.5).child("Recommended")));
    };
    const actions = [];
    if (n.native) actions.push(action("resume", "Relaunch / Resume…", () => menu(n), { primary: true }));
    else if (qState.totalCount && verb) {
      for (const q of qState.questions) {
        if (q.answered) continue;
        const options = [...q.options].sort((a, b) => Number(b.recommended) - Number(a.recommended));
        actions.push(v_flex().gap(6).child(this.plain(t, q.question, `need-question-${id}-${q.id}`))
          .child((narrow ? v_flex() : h_flex()).gap(8).flex_wrap().children(options.map(o =>
            action(`option:${q.id}:${o.id}`, o.label, cx => send({ mode: "choices", choices: [{ questionId: q.id, optionId: o.id }] }, cx), { primary: o.recommended, recommended: o.recommended })))));
      }
      if (qState.needsResume) actions.push(action("resume", "Send answers back", cx => send({ mode: "resume" }, cx), { primary: true }));
    } else if (verb === "approve") actions.push((narrow ? v_flex() : h_flex()).gap(8)
      .child(action("approve", "Approve", cx => send({ mode: "approve" }, cx), { primary: true }))
      .child(action("deny", "Deny…", cx => openComposer(cx, true))));
    else if (resolve || verb === "answer") {
      if (!box?.composerOpen) actions.push((narrow ? v_flex() : h_flex()).child(action(resolve ? "resolve" : "answer", resolve ? "Resolve with my words…" : "Answer…", cx => openComposer(cx), { primary: true })));
    }
    else actions.push(this.dim(t, "This request still needs you. No response action was provided here; use Open in TUI to respond."));
    const markDown = (body, key) => requestMarkdownView(body, { TextView, div, v_flex, id: key }).text_size(12.5).text_color(t.foreground);
    const cardKey = (e, cx) => {
      if (this.typing && e.key !== "escape") return;
      if (["enter", "space", " "].includes(e.key)) { cx.stop_propagation(); return; }
      if (e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt) return;
      if (String(e.key).toLowerCase() === "r") { cx.stop_propagation(); openComposer(cx); }
      else if (String(e.key).toLowerCase() === "d") { cx.stop_propagation(); setOpen(detailsKey, !detailsOpen); }
      else if (e.key === "escape") { cx.stop_propagation(); this.typing = false; if (box?.composerOpen) { box.composerOpen = false; box.confirmResolve = false; this.keepDraft(box); } else if (standalone) this.goSection("needs"); else setOpen(`needs:${id}`, false); cx.notify(); }
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
        .child(this.copyButton(t, text.source, `need-body-${id}`, "request body source")))
      .child(div().id(`need-headline-${id}`).text_size(narrow ? 15.5 : 17).line_height(1.3).font_semibold().text_color(t.foreground).tooltip(String(n.summary ?? text.headline)).child(displayHeadline))
      .when(Boolean(box?.changedSinceAnswered), el => el.child(h_flex().gap(6).items_center().text_size(12).text_color(t.muted)
        .child(svg(icon("rig-refresh")).size(12)).child("Changed since you answered")))
      .when(Boolean(text.opening), el => el.child(div().id(`need-opening-${id}`).max_h(76).overflow_hidden().child(markDown(text.opening, `need-opening-text-${id}`))))
      .child(h_flex().id(`need-context-${id}`).gap(6).items_center().flex_wrap().text_size(12).text_color(t.muted)
        .child(svg(icon(connectedAsker?'rig-queue':"rig-seat")).size(12).flex_none()).child(connectedAsker?assistantOwner(connectedAsker):`${logical}${rig ? ` · ${rig}` : ""}`)
        .child(div().tooltip(this.time(at,{exact:true})).child(`· waiting ${age}`))
        .when(Boolean(owner), el => el.child(div().id(`need-open-asker-${id}`).text_color(t.accent).cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); this.openAskerSeat(cx, { ...n, asker: owner }); }).child(connectedAsker?'Open assistant page':"Open seat")))
        .when(Boolean(project), el => el.child(`· ${project}`)))
      .when(Boolean(this.askerNotes[id]), el => el.child(div().id(`need-asker-note-${id}`).text_size(11.5).text_color(t.muted).child(this.askerNotes[id])))
      .when(Boolean(whose?.onSomeoneElsesAsk), el => el.child(this.dim(t, whose.onSomeoneElsesAsk)))
      .when(Boolean(box?.result), el => el.child(h_flex().id(`need-result-${id}`).gap(6).items_start()
        .child(svg(icon(box.result.ok ? "check" : "rig-alert")).size(12).text_color(box.result.ok ? t.working : t.blocked))
        .child(div().flex_1().text_size(12).text_color(box.result.ok ? t.muted : t.blocked).child(box.result.text))))
      .when(Boolean(box?.result?.networkError && box.result.retryAct), el => el.child(this.button(t, `need-check-and-finish-${id}`, "Check and finish",
        (_e, cx) => { if (!busy) this.submitCardDecision(cx, box.target ?? n, detailItem, queueRow, box.result.retryAct); }, { small: true, disabled: busy })))
      .when(!receipt && !box?.result?.networkError, el => el.children(actions)
        .when(!n.native && (qState.totalCount > 0 || verb === "approve"), el => el.child(div().id(`need-reply-link-${id}`).text_size(12).text_color(t.accent).cursor_pointer()
          .on_click((_e, cx) => { cx.stop_propagation(); openComposer(cx); }).child("Reply in your own words")))
        .when(Boolean(box?.composerOpen), el => el.child(this.replyBox(t, cx, n, { detailItem, queueRow, onSomeoneAskText: whose?.onSomeoneElsesAsk }))
          .child(this.dim(t, "A response is not approval. What you send is recorded as your words; the asking seat reads it and decides."))))
      .when(!n.native && !n.decisionRevision, el => el.child(div().id(`need-no-revision-note-${id}`).text_size(11).text_color(t.dim)
        .child("OpenRig < 0.7.9 (no decisionRevision): a changed request won't be caught before sending.")))
      .child(v_flex().pt(10).border_t(1).border_color(t.border).gap(8)
        .child(h_flex().id(`need-details-toggle-${id}`).gap(6).items_center().cursor_pointer()
          .on_click((_e, cx) => { cx.stop_propagation(); setOpen(detailsKey, !detailsOpen); })
          .child(svg(icon(detailsOpen ? "chevron-down" : "chevron-right")).size(11).text_color(t.dim))
          .child(div().text_size(12).text_color(t.muted).child("Details"))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).tooltip(String(text.detailHint??"")).child(text.detailHint)))
        .when(detailsOpen, el => el.child(v_flex().id(`need-details-${id}`).gap(10)
          .when(Boolean(text.details), el => el.child(markDown(text.details, `need-details-text-${id}`)))
          .when(Boolean(humanDetail), el => el.child(this.dim(t, `More from ${asker ?? "the asker"}`)).child(markDown(typeof humanDetail === "string" ? humanDetail : JSON.stringify(humanDetail, null, 2), `need-human-detail-${id}`)))
          .when(Boolean(n.unblocks), el => el.child(this.dim(t, `Unblocks: ${n.unblocks}`)))
          .children(evidenceFiles.map((file, i) => {
            const path = typeof file === "string" ? file : file.path ?? "";
            return h_flex().gap(6).child(div().id(`need-evidence-${id}-${i}`).flex_1().text_size(12).text_color(t.accent).cursor_pointer()
              .on_click(() => push(fileEntry(path, typeof file === "object" ? file.label : path.split("/").pop()))).child(path))
              .child(this.copyButton(t, path, `need-evidence-path-${id}-${i}`, "evidence path"));
          }))
          .child(v_flex().gap(4).child(h_flex().id(`need-recorded-toggle-${id}`).gap(6).items_center().text_size(11.5).text_color(t.dim).cursor_pointer()
            .on_click(() => setOpen(recordedKey, !recordedOpen))
            .child(svg(icon(recordedOpen ? "chevron-down" : "chevron-right")).size(11)).child("What OpenRig recorded"))
            .when(recordedOpen, el => el.children(recordedLines.map((line, i) => this.plain(t, line, `need-recorded-${id}-${i}`)))
              .child(this.copyValue(t, `Inspect: rig queue show ${n.qitemId ?? id} --full`, `need-inspect-${id}`, "inspect command")))))));
  }

  decisionCard(t, cx, n, { standalone = false, perspective = null } = {}) {
    const viewParam = shared("rig.needsView") ?? null;
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
    if (box && queueRow && observeNeedDecision(box, queueRow, queueRes.at)) {
      delete this.answered[n.id];
      delete this.questionChoices[n.id];
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
    const askerNote = this.askerNotes[n.id] ?? null;

    if (!isUpdateNeed(mergedItem)) return this.requestCard(t, cx, {
      n: mergedItem, queueRow, detailItem, detailLines, recordedLines, evidenceFiles, qState, box, standalone,
      asker, perspective: perspective ?? got.data?.perspective,
    });

    // Updates keep their existing read-only body and dismissal controls; request actions have one renderer above.
    const open = shared("rig.open.page") ?? {}, recordedOpen = Boolean(open[`need-recorded:${n.id}`]);
    const lines = detailLines[0] === "Informational update; no action needed. Viewing is not approval or proof of delivery."
      ? detailLines.slice(1) : detailLines;
    return v_flex().id(`decision-card-${n.id}`).gap(8).pl(10).py(4).border_l(2).border_color(t.dim)
      .when(standalone, el => el.child(this.title(t, n.summary)).child(this.dim(t, "Update")))
      .child(h_flex().gap(6).items_center().flex_wrap().text_size(11.5).text_color(t.muted)
        .when(Boolean(asker), el => el.child(div().id(`need-open-asker-${n.id}`).text_color(t.accent).cursor_pointer()
          .on_click((_e, cx) => { cx.stop_propagation(); this.openAskerSeat(cx, { ...mergedItem, asker }); }).child(`From ${asker}`)))
        .when(Boolean(recipient), el => el.child(`· to ${recipient}`))
        .when(Boolean(scope), el => el.child(`· ${scope}`)).when(Boolean(since), el => el.child(`· since ${since}`)))
      .when(Boolean(askerNote), el => el.child(this.dim(t, askerNote)))
      .child(v_flex().id(`need-body-${n.id}`).gap(6).children(lines.flatMap(line => line.split(/\r?\n/)).filter(line => line.trim())
        .map((line, i) => this.plain(t, line, `need-body-line-${n.id}-${i}`))))
      .when(Boolean(unblocks), el => el.child(this.dim(t, `Unblocks: ${unblocks}`)))
      .child(div().id(`need-update-note-${n.id}`).text_size(12).text_color(t.dim).child("No action needed. Viewing isn't approval or proof of delivery."))
      .when(dismissible(n), el => el.child(h_flex().child(this.updateButton(t, `dismiss-open-${n.id}`, "Dismiss", () => this.updateAction("dismiss", n)))))
      .when(Boolean(this.updateModel().records.find(r => r.key === updateKey(n) && r.restored && r.status === "closed")), el => el.child(this.dim(t, "Restored here; OpenRig still has it closed.")))
      .child(v_flex().gap(4).child(h_flex().id(`need-recorded-toggle-${n.id}`).gap(6).items_center().cursor_pointer()
        .on_click(() => setOpen(`need-recorded:${n.id}`, !recordedOpen))
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
    if ((!this.replies[n.id] && !this.making?.has(n.id)) || want) {
      (this.making ??= new Set()).add(n.id);
      cx.spawn(async (cx) => {
        await Promise.resolve();
        const box = this.replies[n.id] ??= this.makeReply(n);
        this.making.delete(n.id);
        if (want && !box.busy) box.composerOpen = true;
        if (want && !box.busy) { box.input.set_value((shared("rig.drafts") ?? {})[box.key] ?? ""); box.result = null; box.input.focus(); }
        cx.notify();
      });
    }
    const box = this.replies[n.id];
    if (box) box.target = n;
    return box ?? null;
  }

  bindReplyInput(box, placeholder) {
    const val = box.input ? box.input.value() : ((shared("rig.drafts") ?? {})[box.key] ?? "");
    try { box.input?.release?.(); } catch (_) {}
    const input = TextareaState.new({ placeholder, rows: 3, value: val });
    // The draft is kept as it is typed (300 ms after the last change), as the reply dialog keeps it.
    input.on("change", (_e, cx) => {
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

  /**
   * Submit a Decision Card action (`approve`, `deny`, `choices`, `freeform`, `resume`, `resolve`) via
   * `POST /api/mission-control/action`.
   * Never uses `X-OpenRig-Session` or `rig queue answer`.
   */
  submitCardDecision(cx, n, detailItem, queueRow, act) {
    const box = this.replies[n.id] ??= this.makeReply(n);
    if (box.busy) return;
    this.keepDraft(box);
    box.busy = true;
    box.stepProgress = null;
    box.result = null;
    cx.notify();
    const config = this.config;
    cx.spawn(async (cx) => {
      try {
        const daemonUrl = await this.resolveDaemonUrl();
        if (!daemonUrl) {
          box.busy = false;
          box.stepProgress = null;
          box.result = { ok: false, text: this.lastDaemonMessage || config?.daemonMessage || "OpenRig daemon is not running." };
          cx.notify();
          return;
        }
        const qid = n.qitemId ?? detailItem?.answer?.qitemId ?? queueRow?.id ?? (String(n.id ?? "").startsWith("queue:") ? String(n.id).slice(6) : null);
        let latestRevision = queueRow?.decisionRevision ?? detailItem?.decisionRevision ?? n.decisionRevision ?? null;
        if ((latestRevision === null || latestRevision === undefined) && qid) {
          try {
            const qr = await fetch(`${daemonUrl}/api/queue/${encodeURIComponent(qid)}`);
            if (qr.ok) {
              const qd = await qr.json();
              if (qd && (typeof qd.decisionRevision === "number" || typeof qd.decisionRevision === "string")) {
                latestRevision = qd.decisionRevision;
                this.cache[`/api/queue/${encodeURIComponent(qid)}`] = { data: qd, status: qr.status, at: Date.now() };
              }
            }
          } catch (_) { /* expectedRevision is omitted in missionAction when decisionRevision is unavailable */ }
        }
        const itemForAction = {
          ...n,
          ...(detailItem ?? {}),
          waiting: queueRow?.waiting ?? n.waiting,
          destinationSession: queueRow?.destinationSession ?? n.destinationSession,
          qitemId: qid,
          decisionRevision: latestRevision ?? undefined,
        };
        const actWithProgress = {
          ...act,
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
        const outcome = await submitMissionActions(config, itemForAction, actWithProgress, async (req) => {
          const r = await fetch(`${daemonUrl}${req.path}`, {
            method: req.method ?? "POST",
            headers: req.headers ?? { "content-type": "application/json" },
            body: JSON.stringify(req.body),
          });
          let data = null;
          const rawText = await r.text();
          try { data = JSON.parse(rawText); } catch (_) { data = { error: rawText }; }
          return { ok: r.ok, status: r.status, data, error: data?.error ?? data?.message ?? null };
        });

        box.busy = false;
        box.stepProgress = null;
        if (outcome.ok) {
          if (act.mode === "choices") {
            const nextChoices = { ...(this.questionChoices[n.id] ?? {}) };
            for (const c of act.choices ?? []) delete nextChoices[c.questionId];
            this.questionChoices[n.id] = nextChoices;
          } else {
            const all = { ...(shared("rig.drafts") ?? {}) };
            delete all[box.key];
            setShared("rig.drafts", all);
            box.input.set_value("");
            if (box.denying) {
              box.denying = false;
              this.bindReplyInput(box, (n.reply === "resolve" || n.verb === "resolve") ? "Your decision, in your own words" : "Your answer, in your own words");
            }
            box.confirmResolve = false;
            delete this.questionChoices[n.id];
          }
          if (shared("rig.focusNeed") === n.id) setShared("rig.focusNeed", null);
          const sentText = this.sentNeedConfirmation(itemForAction, queueRow, act);
          const confirmation = `${sentText} ${outcome.text}`;
          this.answered[n.id] = { summary: requestHeadline(n), text: confirmation, at: Date.now() };
          box.composerOpen = false; box.changedSinceAnswered = false;
          box.result = { ok: true, text: confirmation };
          box.receipt = { at: Date.now(), revision: outcome.decisionRevision, body: queueRow?.body,
            state: act.mode === "resolve" || n.reply === "resolve" ? "in-progress" : null };
          run("rig.refresh");
          const viewParam = shared("rig.needsView") ?? null;
          this.read(cx, viewParam ? `/api/attention?view=${encodeURIComponent(viewParam)}` : "/api/attention", true);
          this.read(cx, `/api/attention?item=${encodeURIComponent(n.id)}`, true);
          if (qid) this.read(cx, `/api/queue/${encodeURIComponent(qid)}`, true);
        } else {
          if (outcome.conflict) {
            if (Array.isArray(outcome.committedQuestionIds) && outcome.committedQuestionIds.length > 0) {
              const nextChoices = { ...(this.questionChoices[n.id] ?? {}) };
              for (const qId of outcome.committedQuestionIds) delete nextChoices[qId];
              this.questionChoices[n.id] = nextChoices;
            }
            this.read(cx, `/api/attention?item=${encodeURIComponent(n.id)}`, true);
            if (qid) this.read(cx, `/api/queue/${encodeURIComponent(qid)}`, true);
          }
          if (outcome.networkError) {
            box.result = {
              ok: false,
              networkError: true,
              retryAct: { ...act, operationHashPrefix: outcome.operationHashPrefix },
              text: outcome.text || NETWORK_UNCONFIRMED_MESSAGE,
            };
          } else {
            box.result = {
              ok: false,
              conflict: Boolean(outcome.conflict),
              tokenProtected: Boolean(outcome.tokenProtected),
              text: outcome.text || "It didn't work, and the daemon gave no reason.",
            };
          }
        }
      } catch (_e) {
        box.busy = false;
        box.stepProgress = null;
        box.result = {
          ok: false,
          networkError: true,
          retryAct: { ...act },
          text: NETWORK_UNCONFIRMED_MESSAGE,
        };
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
    const queueRow = qid ? this.cache[`/api/queue/${encodeURIComponent(qid)}`]?.data : null;
    const detailItem = this.cache[`/api/attention?item=${encodeURIComponent(n.id)}`]?.data?.detail?.item ?? null;
    if (box.denying) {
      this.submitCardDecision(cx, n, detailItem, queueRow, { mode: "deny", decision: text });
      return;
    }
    if (n?.reply === "resolve" || n?.verb === "resolve") {
      this.submitCardDecision(cx, n, detailItem, queueRow, { mode: "resolve", decision: text });
      return;
    }
    this.submitCardDecision(cx, n, detailItem, queueRow, { mode: "freeform", decision: text });
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
      .on_key_down(() => { this.typing = true; })
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
        }, { primary: true, iconName: "rig-reply", disabled: box.busy || (isDenying && !hasReasonText), tooltip: onSomeoneAskText }))
        .child(this.button(t, `need-cancel-${n.id}`, isDenying ? "Back" : "Cancel", (_e, cx) => {
          if (box.cardMode) { this.keepDraft(box); box.composerOpen = false; box.confirmResolve = false; box.denying = false; cx.notify(); return; }
          if (isDenying) {
            box.denying = false;
            box.result = null;
            this.bindReplyInput(box, isResolve ? "Your decision, in your own words" : "Your answer, in your own words");
            cx.notify();
            return;
          }
          const all = { ...(shared("rig.drafts") ?? {}) }; delete all[box.key]; setShared("rig.drafts", all);
          if (shared("rig.focusNeed") === n.id) setShared("rig.focusNeed", null);
          box.input.set_value(""); box.confirmResolve = false; box.result = null;
          setOpen(`needs:${n.id}`, false);
          cx.notify();
        }, { disabled: box.busy }))
        .child(this.dim(t, `${mac ? "⌘ Return" : "Ctrl+Enter"} sends · the text is kept until sent`)))
      .when(!!r, (el) => el.child(v_flex().gap(4)
        .child(h_flex().gap(6).items_center().child(svg(icon(r.ok ? "check" : "rig-alert")).size(12).flex_none().text_color(r.ok ? t.working : t.blocked))
          .child(div().flex_1().text_size(12).text_color(r.ok ? t.muted : t.blocked).child(r.text)))
        .when(!r.ok && !r.conflict && !r.tokenProtected && !r.networkError, (c) => c.child(this.dim(t, "It may still have arrived: check the request before answering again.")))
        .when(!r.ok && Boolean(r.networkError && r.retryAct), (c) => c.child(
          h_flex().child(this.button(
            t,
            `need-check-and-finish-${n.id}`,
            "Check and finish",
            (_e, cx) => {
              if (!box.busy) this.submitCardDecision(cx, box.target ?? n, detailItem, queueRow, r.retryAct);
            },
            { small: true, iconName: "rig-refresh", disabled: box.busy },
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

  notifyTogglePill(t, id = "needs-notify-toggle") {
    const on = (shared("rig.settings")?.notifications ?? true) !== false;
    return h_flex().id(id).px(8).h(24).gap(6).rounded(6).items_center().flex_none().cursor_pointer()
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
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const daemonUrl = await this.resolveDaemonUrl();
        if (!daemonUrl) {
          this.usageRefreshNote = { ok: false, text: "The daemon address isn't known yet." };
          return;
        }
        const r = await fetch(`${daemonUrl}/api/provider/usage/hosts/refresh`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ providers: ["codex", "claude"] }),
        });
        let data = null; try { data = JSON.parse(await r.text()); } catch (_) { data = null; }
        if (r.status === 409 || isUsageWindowsDisabled({ status: r.status, data, error: data?.error })) {
          this.usageRefreshNote = { ok: false, text: "Usage windows are off (provider.usage_windows = false)." };
        } else if (!r.ok) {
          this.usageRefreshNote = { ok: false, text: data?.error ?? data?.message ?? `POST /api/provider/usage/hosts/refresh → ${r.status}` };
        } else {
          const refreshLegs = Array.isArray(data?.refresh) ? data.refresh : (Array.isArray(data?.results) ? data.results : []);
          const hostEntries = Array.isArray(data?.hosts) ? data.hosts : [];
          const failedLeg = refreshLegs.find((l) => l && (l.ok === false || l.error || l.status === "failed" || l.status === "unreachable"))
            ?? hostEntries.find((h) => h && (h.ok === false || h.error || h.status === "unreachable" || h.status === "failed"));
          if (failedLeg) {
            const detail = failedLeg.error ?? failedLeg.reason ?? failedLeg.status ?? null;
            this.usageRefreshNote = {
              ok: false,
              text: detail ? `Refreshed (some hosts/providers failed: ${detail}).` : "Refreshed (some hosts/providers failed).",
            };
          } else {
            this.usageRefreshNote = { ok: true, text: "Refreshed." };
          }
        }
        this.read(cx, "/api/provider/usage", true);
        if (this.cache["/api/provider/usage/hosts"] || (shared("rig.open.page") ?? {})["usage:hosts"] || (shared("rig.open.page") ?? {})["sys:usage-hosts"]) {
          this.read(cx, "/api/provider/usage/hosts", true);
        }
      } catch (e) {
        this.usageRefreshNote = { ok: false, text: String(e?.message ?? e) };
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
        const stack = nav().stack ?? [];
        const top = stack.at(-1) ?? { section: "system" };
        setShared("rig.nav", { stack: [...stack.slice(0, -1), { ...top, section: "system", settingKey: "provider.usage_windows" }] });
      }, { small: true }));
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
          .child(div().px(6).h(18).rounded(4).flex().items_center().bg(t.background).text_size(11).text_color(h.error ? t.blocked : t.muted).child(String(h.status ?? "online")))
          .when(!!h.usageReason, (el) => el.child(div().px(6).h(18).rounded(4).flex().items_center().bg(t.background).text_size(11).text_color(t.dim).child(h.usageReason)))
          .child(div().flex_1())
          .when(!!h.readAt, (el) => el.child(this.dim(t, `as of ${this.time(h.readAt,{exact:true})}`))))
        .when(!!h.error, (el) => el.child(h_flex().id(`usage-host-error-${hid}`).gap(8).items_center()
          .child(div().flex_1().text_size(12).text_color(t.blocked).child(String(h.error)))
          .child(this.button(t, `usage-host-retry-${hid}`, "Retry", (_e, cx) => this.refreshUsageHosts(cx), { small: true }))))
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
            .child(div().w(100).flex_none().truncate().text_color(t.foreground).tooltip(String(String(o.runtime ?? "")??"")).child(String(o.runtime ?? "")))
            .child(div().w(140).flex_none().truncate().tooltip(String(String(o.accountLabel ?? o.account ?? "")??"")).child(String(o.accountLabel ?? o.account ?? "")))
            .child(div().w(90).flex_none().truncate().text_color(t.dim).tooltip(String(String(o.status ?? "")??"")).child(String(o.status ?? "")))
            .child(div().flex_1().min_w(0).truncate().text_right().text_color(t.dim).tooltip(String(this.time(o.lastObservedAt ?? o.updatedAt,{exact:true})??"")).child(this.time(o.lastObservedAt ?? o.updatedAt,{exact:true})))
        ))));
    }));
  }

  runPeopleAction(cx, subargs, entityId = null) {
    if (this.peopleBusy) return;
    const personReason = personDisableReason("people", this.config);
    if (personReason) {
      this.peopleResult = { ok: false, text: personReason };
      cx.notify();
      return;
    }
    const cmd = peopleCliCommand(this.config, subargs);
    if (!cmd) {
      this.peopleResult = { ok: false, text: NO_PERSON };
      cx.notify();
      return;
    }
    const priorActiveAppId = entityId
      ? (this.cache[`/api/gateway/human/${encodeURIComponent(entityId)}/mode`]?.data?.current?.applicationId
        ?? this.cache[`/api/gateway/human/${encodeURIComponent(entityId)}/modes`]?.data?.current?.applicationId
        ?? shared("rig.lastActiveModeApplicationId")
        ?? null)
      : (shared("rig.lastActiveModeApplicationId") ?? null);
    this.peopleBusy = true;
    this.peopleResult = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let r;
      let rawRes = null;
      try {
        rawRes = await exec(cmd.command, cmd.args, { timeout: 60000 });
        r = writeOutcome(rawRes);
      } catch (e) {
        r = { ok: false, text: String(e?.message ?? e) };
      }
      this.peopleBusy = false;
      this.peopleResult = { ok: r.ok, text: r.text || (r.ok ? "Updated." : "Command failed.") };
      if (r.ok) {
        let parsedStdout = null;
        try { parsedStdout = JSON.parse(String(rawRes?.stdout ?? "").trim()); } catch (_) { parsedStdout = null; }
        if (subargs[0] === "mode" && subargs[1] === "apply") {
          const appliedAppId = parsedStdout?.application?.applicationId ?? null;
          const endedAppId = parsedStdout?.ended?.applicationId ?? null;
          const patch = {};
          if (appliedAppId) patch.lastActiveModeApplicationId = appliedAppId;
          if (endedAppId) {
            this.awayDismissed = false;
            patch.lastEndedModeApplicationId = endedAppId;
          }
          if (Object.keys(patch).length > 0) this.persistStatePatch(cx, patch);
        } else if (subargs[0] === "mode" && subargs[1] === "end") {
          const endedAppId = parsedStdout?.ended?.applicationId ?? priorActiveAppId ?? null;
          this.awayDismissed = false;
          this.persistStatePatch(cx, {
            lastEndedModeApplicationId: endedAppId,
            lastActiveModeApplicationId: null,
          });
        }
        run("rig.refresh");
        if (entityId) {
          this.read(cx, `/api/gateway/human/${encodeURIComponent(entityId)}/quiet`, true);
          this.read(cx, `/api/gateway/human/${encodeURIComponent(entityId)}/modes`, true);
          this.read(cx, `/api/gateway/human/${encodeURIComponent(entityId)}/mode`, true);
          this.read(cx, `/api/gateway/human/${encodeURIComponent(entityId)}/readiness`, true);
          this.read(cx, `/api/gateway/human/${encodeURIComponent(entityId)}/decision-room`, true);
        }
        this.read(cx, "/api/gateway/participants", true);
        this.read(cx, "/api/gateway/connections", true);
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
    const configPersonRaw = typeof this.config?.person === "string" ? this.config.person.trim() : "";
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
    const personReason = personDisableReason("people", this.config);
    const editDisabled = this.peopleBusy || !!personReason || isOtherPerson;
    const editTooltip = isOtherPerson ? `Only ${otherName} changes ${otherName}'s quiet hours and modes.` : personReason;
    const quietState = quiet?.data?.state ?? quiet?.data ?? null;
    const quietWin = quiet?.data?.window ?? null;
    const isQuietActive = Boolean(quietState?.active);
    const curMode = mode?.data?.current ?? modes?.data?.current ?? (mode?.data?.modeName ? mode.data : null);
    if (!isOtherPerson && curMode?.applicationId && shared("rig.lastActiveModeApplicationId") !== curMode.applicationId) {
      this.persistStatePatch(cx, { lastActiveModeApplicationId: curMode.applicationId });
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
            return h_flex().id(`people-select-${h.entityId}`).px(8).h(22).rounded(5).items_center().cursor_pointer()
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
              .child(this.button(t, "people-quiet-until-1h", "Quiet for 1h", (_e, cx) => {
                const until = new Date(Date.now() + 3600_000).toISOString();
                this.runPeopleAction(cx, ["quiet", "set", activeId, "--until", until], activeId);
              }, { small: true, disabled: editDisabled, tooltip: editTooltip }))
              .child(this.button(t, "people-quiet-until-2h", "Quiet for 2h", (_e, cx) => {
                const until = new Date(Date.now() + 7200_000).toISOString();
                this.runPeopleAction(cx, ["quiet", "set", activeId, "--until", until], activeId);
              }, { small: true, disabled: editDisabled, tooltip: editTooltip }))
              .child(this.button(t, "people-quiet-daily", "Daily 22:00–08:00", (_e, cx) => {
                const daily = `${this.peopleForm.quietStart || "22:00"}-${this.peopleForm.quietEnd || "08:00"}`;
                this.runPeopleAction(cx, ["quiet", "set", activeId, "--daily", daily], activeId);
              }, { small: true, disabled: editDisabled, tooltip: editTooltip }))
              .when(isQuietActive, (bEl) => bEl.child(
                this.button(t, `people-quiet-end-${activeId}`, "I'm back", (_e, cx) => {
                  this.runPeopleAction(cx, ["quiet", "end", activeId], activeId);
                }, { primary: true, small: true, disabled: editDisabled, tooltip: editTooltip })
              ))
              .when(Boolean(quietWin || isQuietActive), (bEl) => bEl.child(
                this.button(t, `people-quiet-clear-${activeId}`, "Remove", (_e, cx) => {
                  this.runPeopleAction(cx, ["quiet", "clear", activeId], activeId);
                }, { small: true, disabled: editDisabled, tooltip: editTooltip })
              )))
        ))
        .when(!!activeId, (el) => el.child(
          v_flex().id("people-modes-card").rounded(8).bg(t.raised).border_1().border_color(t.border).p(pageBodyLayout(this.pageWidth).tight ? 6 : 10).gap(8)
            .child((pageBodyLayout(this.pageWidth).compact ? v_flex() : h_flex()).id("people-mode-title").gap(8).when(!pageBodyLayout(this.pageWidth).compact, el => el.items_center())
              .child(div().when(!pageBodyLayout(this.pageWidth).compact, el => el.flex_1()).text_size(12).font_semibold().text_color(t.foreground).child("Modes"))
              .child(div().text_size(11.5).text_color(curMode ? t.accent : t.muted).child(
                curMode?.modeName
                  ? `${curMode.modeName}${curMode.settings?.decision?.policy ? ` · ${curMode.settings.decision.policy}` : ""}`
                  : "At desk (no mode active)"
              ))
              .when(Boolean(curMode?.modeName), (mEl) => mEl.child(
                this.button(t, `people-mode-end-${activeId}`, "I'm back", (_e, cx) => {
                  this.runPeopleAction(cx, ["mode", "end", activeId], activeId);
                }, { primary: true, small: true, disabled: editDisabled, tooltip: editTooltip })
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
                .child(div().text_size(11.5).text_color(t.muted).child(`policy: ${mPolicy}${mBack ? ` · back ${mBack}` : ""}`))
                .child(this.button(t, `people-mode-preset-${activeId}-${mName}`, "Apply", (_e, cx) => {
                  const applyArgs = ["mode", "apply", activeId, mName];
                  if (needsUntil) {
                    applyArgs.push("--until", new Date(Date.now() + 7200_000).toISOString());
                  }
                  this.runPeopleAction(cx, applyArgs, activeId);
                }, { small: true, primary: curMode?.modeName !== mName, disabled: editDisabled, tooltip: editTooltip }));
            }) : [this.dim(t, "No saved modes yet.")])
            .child(h_flex().gap(6).items_center().flex_wrap()
              .child(this.button(t, "people-mode-save-sleep", "Save sleep mode (hold)", (_e, cx) => {
                this.runPeopleAction(cx, ["mode", "save", activeId, "sleep", "--availability", "off", "--quiet", "22:00-08:00"], activeId);
              }, { small: true, disabled: editDisabled, tooltip: editTooltip }))
              .child(this.button(t, "people-mode-save-focus", "Save focus mode (auto_decide)", (_e, cx) => {
                this.runPeopleAction(cx, [
                  "mode", "save", activeId, "focus",
                  "--availability", "focus",
                  "--expected-back", "in 2h",
                  "--quiet", "until-end",
                  "--decision-room", "Proceed on reversible routine work; escalate irreversible or prod-affecting changes.",
                ], activeId);
              }, { small: true, disabled: editDisabled, tooltip: editTooltip })))
            .child(this.dim(t, `Changes are made as ${actorAddr} with rig gateway human quiet and mode. OpenRig's quiet show and mode current show the same.`))
        ))
        .when(!!this.peopleResult, (el) => el.child(
          h_flex().id("people-action-result").gap(6).items_center()
            .child(svg(icon(this.peopleResult.ok ? "check" : "rig-alert")).size(12).flex_none().text_color(this.peopleResult.ok ? t.working : t.blocked))
            .child(div().flex_1().text_size(12).text_color(this.peopleResult.ok ? t.muted : t.blocked).child(this.peopleResult.text))
        )),
    );
  }

  healthFindingsCard(t, cx, got, entry = {}) {
    // A health subject may belong to another seat or be closed; it needn't exist in human /api/attention.
    if (entry.healthQitem) {
      if (!validHealthQitemId(entry.healthQitem)) return this.card(t, "Queue item", [this.dim(t, "Invalid queue item id. Open Health and choose a valid item.")]);
      const qid = String(entry.healthQitem), path = `/api/queue/${encodeURIComponent(qid)}`, queue = this.read(cx, path);
      const wait = this.status(t, cx, path, queue), row = queue.data?.item ?? queue.data?.qitem ?? queue.data;
      const failure = wait ?? (String(row?.qitemId ?? row?.id ?? "") !== qid ? this.dim(t, "Couldn't read queue item: OpenRig returned no matching row.") : null);
      const back = { ...entry }; delete back.healthQitem;
      return this.card(t, "Queue item", [
        h_flex().child(this.button(t, "health-queue-back", "‹ Health", () => push(back), { small: true })),
        ...(failure ? [failure] : [this.copyValue(t, qid, "health-queue-id", "queue item id"),
          this.plain(t, row?.summary ?? "No summary reported.", "health-queue-summary"),
          this.kv(t, [["State", row?.state ?? "not reported"], ["From", row?.sourceSession ?? "not reported"], ["To", row?.destinationSession ?? "not reported"]]),
          requestMarkdownView(row?.body ?? "No body reported.", { TextView, div, v_flex, id: "health-queue-body" }),
        ]),
      ]);
    }
    if (got.error || (got.data !== undefined && !Array.isArray(got.data?.records))) return this.card(t, "Health", [
      this.dim(t, `Couldn't read health: ${got.error ?? "OpenRig returned no records list."}`),
      this.button(t, "health-retry", "Retry", () => this.read(cx, "/api/health", true), { small: true }),
    ]);
    if (got.data === undefined) return this.card(t, "Health", [this.dim(t, "Checking health…")]);
    const data = got.data, open = shared("rig.open.page") ?? {};
    // 0.7.11 omits cleared records from its default list. This optional read uses
    // the existing health cache/refresh, only on System → Health, never a timer.
    const history = entry.subview === "health" ? this.read(cx, "/api/health?status=cleared") : null;
    const allRecords = mergeHealthHistory(data.records, history?.error ? null : history?.data);
    const rigs = this.read(cx, "/api/rigs/summary").data ?? sharedRigData(this.config, shared)?.topology ?? [];
    const nodes = { ...(sharedRigData(this.config, shared)?.nodesByRig ?? {}) };
    for (const id of new Set(allRecords.map(r => r.scope?.rigId).filter(Boolean))) nodes[id] = this.nodesOf(cx, id).data ?? nodes[id] ?? [];
    const rig = entry.healthRigId ? rigs.find(r => r.id === entry.healthRigId) ?? { id: entry.healthRigId, name: entry.healthRigName ?? entry.healthRigId } : null;
    const records = rig ? healthForRig(allRecords, rig, nodes[rig.id] ?? [], true, true) : allRecords;
    const counts = healthCounts(records), groups = groupHealthRecords(records);
    const partial = (Array.isArray(data.coverage) ? data.coverage : data.coverage ? [data.coverage] : []).filter(c => c.partial);
    const coverage = partial.map(c => Number.isFinite(c.evaluated) && Number.isFinite(c.total) ? `partial check (${c.evaluated} of ${c.total})` : "partial check").join(" · ");
    const age = Math.max(...records.map(r => r.freshness?.ageSeconds).filter(Number.isFinite));
    const checked = typeof data.evaluatedAt === "string" ? `checked ${this.time(data.evaluatedAt)} · ${healthAge(age)}` : "Check time not reported";
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const worstContext = groups.find(g => g.worst)?.records.find(r => r.detector === "context.pressure");
    const worstContextText = worstContext ? `${healthScopeTarget(worstContext, rigs, nodes).label.replace(/^Seat /, "")} at ${healthContextPercentage(worstContext)} context` : null;
    const summary = counts.problems ? `${plural(counts.problems, "problem")} need${counts.problems === 1 ? "s" : ""} a look. ${groups.find(g => g.worst)?.title ?? ""}.`
      : `No problems found.${counts.notes ? ` ${plural(counts.notes, "note")} available for reference.` : ""}`;
    return this.card(t, `Health · ${plural(counts.problems, "problem")} · ${plural(counts.notes, "note")}`, [
      ...(rig ? [h_flex().id("health-rig-filter").gap(6).items_center().cursor_pointer()
        .on_click(() => push({ section: "system", subview: "health" }))
        .child(div().text_size(12).text_color(t.muted).child(rig.name))
        .child(svg(icon("x")).size(11).text_color(t.dim))] : []),
      this.plain(t, `${summary}${worstContextText ? ` · ${worstContextText}` : ""}${coverage ? ` · ${coverage}` : ""}`, "health-summary").text_color(t.muted),
      ...(history && (history.error || history.data !== undefined && !Array.isArray(history.data?.records))
        ? [this.dim(t,"Cleared history is unavailable on this OpenRig.")] : []),
      ...groups.map((g, index) => {
        const key = `sys:health:${g.key}`, shown = open[key] ?? (!g.cleared && index === 0);
        const detailKey = `sys:health-details:${g.key}`, details = Boolean(open[detailKey]);
        const tone = g.worst === 2 ? t.blocked : g.worst === 1 ? t.working : t.muted;
        const scopes = [...new Map(g.records.map(r => { const target = healthScopeTarget(r, rigs, nodes); return [JSON.stringify(target), target]; })).values()];
        const confidence = [...new Set(g.records.map(r => r.confidence).filter(Boolean))].join(", ") || "not reported";
        const evidence = g.records.flatMap(r => r.evidence ?? []);
        const raw = JSON.stringify({ records: g.records.map(r => ({ id: r.id, detector: r.detector, category: r.category,
          severity: r.severity, confidence: r.confidence, status: r.status, indeterminateReason: r.indeterminateReason,
          summary: r.summary, scope: r.scope, threshold: r.threshold, explanation: r.explanation, window: r.window, freshness: r.freshness })),
          coverage: data.coverage, evidence: evidence.slice(0, 5), ...(evidence.length > 5 ? { moreEvidence: `+${evidence.length - 5} more` } : {}) }, null, 2);
        return v_flex().id(`health-group-${index}`).gap(6).pb(8).border_b(1).border_color(t.border)
          .child(h_flex().id(`health-toggle-${index}`).gap(8).items_center().cursor_pointer().on_click(() => toggleOpen(key, shown))
            .child(svg(icon(shown ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim))
            .child(svg(icon(g.worst === 2 ? "rig-diamond" : g.worst === 1 ? "rig-warning" : "rig-info")).size(13).flex_none().text_color(tone))
            .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.foreground).child(g.title))
            .child(div().text_size(11).text_color(tone).child(g.cleared ? "history" : g.worst === 2 ? "critical" : g.worst === 1 ? "warning" : "note"))
            .child(div().text_size(11.5).text_color(t.dim).child(String(g.records.length)))
            .when(Boolean(g.startedAt), el => el.child(div().text_size(11).text_color(t.dim).tooltip(this.time(g.startedAt,{exact:true})).child(`since ${this.time(g.startedAt,{date:true})}`))))
          .when(shown, el => el.child(v_flex().ml(24).gap(8)
            .child(this.plain(t, g.what, `health-what-${index}`))
            .child(h_flex().gap(6).items_center().flex_wrap().children(scopes.map((scope, i) => div().id(`health-scope-${index}-${i}`).text_size(12)
              .text_color(scope.entry ? t.accent : t.muted).when(Boolean(scope.entry), el => el.cursor_pointer().on_click(() => push(scope.entry))).child(scope.label)))
              .child(div().id(`health-freshness-${index}`).text_size(11.5).text_color(g.stale ? t.dim : t.muted).child(`· confidence ${confidence} · data ${healthAge(g.ageSeconds)}`)))
            .when(!g.cleared, el => el.child(this.plain(t, `What to do: ${g.todo}`, `health-todo-${index}`).text_color(t.muted)))
            .when(g.records[0].detector === "context.pressure" || !(g.records.length === 1 && g.records[0].scope?.type === "seat" && !healthQueueId(g.records[0])), el => el.child(v_flex().ml(8).pl(10).border_l(1).border_color(t.border).gap(4).children(g.records.map((r, i) => {
              const qid = healthQueueId(r), target = healthScopeTarget(r, rigs, nodes), subject = qid ?? target.label ?? r.id;
              const count = String(r.explanation ?? "").match(/^(\d+) coordination transitions\b/)?.[1];
              const time = [r.startedAt, r.lastObservedAt].filter(Boolean).map(s => this.time(s,{date:true})).join(" – ");
              return h_flex().id(`health-item-${index}-${i}`).gap(8).items_center().flex_wrap()
                .when(!g.cleared && r.detector === "context.pressure", el => el.child(svg(icon("rig-info")).size(11).text_color(tone)))
                .child(div().text_size(12).text_color(qid || target.entry ? t.accent : t.muted)
                  .when(Boolean(qid || target.entry), el => el.cursor_pointer().on_click(() => push(qid ? { ...entry, section: "system", subview: "health", healthQitem: qid } : target.entry))).child(subject))
                .when(Boolean(count), el => el.child(div().text_size(11.5).text_color(t.muted).child(`${count} queue changes`)))
                .when(!g.cleared && r.detector === "context.pressure", el => el.child(div().text_size(11.5).text_color(tone).child(`${healthContextPercentage(r)} context used · ${r.severity}`)))
                .child(div().text_size(11).text_color(t.dim).child(time))
                .child(div().flex_1())
                .child(this.copyButton(t, qid ?? r.id, `health-item-${index}-${i}`, qid ? "queue item id" : "finding id"));
            }))))
            .child(h_flex().id(`health-details-toggle-${index}`).gap(6).items_center().cursor_pointer().on_click(() => toggleOpen(detailKey, details))
              .child(svg(icon(details ? "chevron-down" : "chevron-right")).size(11).text_color(t.dim))
              .child(div().flex_1().text_size(12).text_color(t.muted).child("Details"))
              .when(details, el => el.child(this.copyButton(t, raw, `health-details-${index}`, "health details"))))
            .when(details, el => el.child(v_flex().id(`health-details-${index}`).gap(1).children(raw.split("\n").map(line =>
              div().font_family(settings().font_family).text_size(11).text_color(t.dim).child(line)))))));
      }),
    ], div().text_size(11).text_color(t.dim).child(checked));
  }

  system(t, cx, entry = {}) {
    const health = this.read(cx, "/api/health");
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
    const versionLine = sharedRigData(this.config, shared)?.versionLine || formatOpenRigVersionLine({
      healthz: healthz.data,
      cliVersion: sharedRigData(this.config, shared)?.cliVersion ?? null,
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
    const configCard = this.card(t, "Configuration", [
      this.status(t, cx, "/api/config?view=browser", config) ?? (entry.category === "sources"
        ? this.table(t,"sys-config",[["Setting",260],["Value"],["Group",90],["Source",80]],configRows(config.data,{category:"sources"}).map(r=>({cells:[r.key,r.value,r.group,r.source]})))
        : v_flex().id("sys-config").gap(4).children(this.configPanel.render(t,cx,config.data,configProbe,{category:entry.category,settingKey:entry.settingKey}))),
    ],
      entry.settingKey || entry.category ? h_flex().id("rig-clear-config").px(8).h(22).gap(6).rounded(6).items_center().flex_none().cursor_pointer()
        .bg(t.selected).text_size(11.5).text_color(t.foreground).on_click(() => clearConfigScope())
        .child(entry.settingKey ? `setting ${entry.settingKey}` : `category ${entry.category}`).child(svg(icon("x")).size(11).text_color(t.muted)) : null);
    const healthCard = this.healthFindingsCard(t, cx, health, entry);
    const connectionsCard = this.card(t, "Connections", [
      v_flex().id("system-herdr-machine").gap(5)
        .child(div().text_size(12).child(`Herdr machine: ${this.config?.daemonMachine??"this computer"}`))
        .when(!!this.config?.daemonMachine&&shared("rig.machineSetup")?.machine===this.config.daemonMachine
          &&shared("rig.machineSetup")?.origin===this.config.daemonUrl&&!!shared("rig.machineSetup")?.verifiedAt,
          el=>el.child(div().text_size(11).text_color(t.muted).child(machineSetupReceiptLabel(shared("rig.machineSetup"),this.uiTimezone))))
        .child(div().id("system-choose-machine").text_color(t.accent).cursor_pointer().child(this.config?.daemonMachine?`Stop using ${this.config.daemonMachine}…`:"Choose machine…")
          .on_click(()=>{if(this.config?.daemonMachine)openOverlay({mod:MOD_IDS.menu,kind:"dialog",width:560,height:400,
            props:{target:{kind:"machine"},step:{action:"stop-machine",machine:this.config.daemonMachine}}});else run("rig.choose-machine");})),
      this.kv(t, [
        ["Herdrig Version", `herdrig v${HERDRIG_VERSION}`],
        ["OpenRig Version", versionLine],
        ["OpenRig Capabilities", capDetail.line],
        ...(capDetail.reason ? [["Capability Note", this.workerCapabilityMessage()]] : []),
      ]).tooltip(capDetail.reason ?? ""),
      ...(capDetail.suggestedUpgrade ? [div().id("system-suggested-upgrade").text_size(11).text_color(t.dim).child(capDetail.suggestedUpgrade)] : []),
      this.status(t, cx, "/api/gateway/connections", conn) ?? this.kv(t, [["Slack", `${conn.data.state ?? ""}${conn.data.nextAction ? ` · ${conn.data.nextAction}` : ""}`],
        ["People registered", `${(conn.data.humans ?? []).length}${(conn.data.humans ?? []).length ? ` · ${(conn.data.humans ?? []).map((h) => h.address).join(", ")}` : ""}`]]),
    ]);
    const usageCard = this.card(t, "Usage", [
      ...(this.usageRefreshNote ? [div().id("usage-refresh-note").text_size(11.5).text_color(this.usageRefreshNote.ok ? t.muted : t.blocked).child(this.usageRefreshNote.text)] : []),
      usageDisabled
        ? this.usageDisabledNote(t)
        : (usageWait ?? v_flex().gap(8)
          .child(usageRows.length > 0
            ? this.table(t, "usage", [["Host"], ["Provider", 110], ["Window", 90], ["Used", 150], ["Resets", 130, "right"]],
              usageRows.map((r) => {
                const color = r.tone === "blocked" ? t.blocked : (r.tone === "warn" || r.tone === "warning") ? t.ansi3 : r.tone === "muted" ? t.muted : t.foreground;
                return {
                  cells: [
                    r.host,
                    r.provider,
                    r.window,
                    div().text_size(12.5).text_color(color).child(r.usedText),
                    this.time(r.resetsAt,{exact:true}),
                  ],
                  match: [r.host, r.provider, r.window, r.usedText, r.resetsAt, r.asOf],
                };
              }))
            : this.dim(t, "No usage readings yet."))
          .when(!!usageAsOf && usageRows.length > 0, (el) => el.child(this.dim(t, `as of ${this.time(usageAsOf,{exact:true})}`)))
          .when(hostCount > 1 || hostsOpen, (el) => el.child(v_flex().gap(6).when(hostsFocused, (d) => d.rounded(6).border_1().border_color(t.accent).p(6))
            .child(h_flex().id("usage-hosts-toggle").gap(4).items_center().cursor_pointer().on_click(toggleUsageHosts)
              .child(svg(icon(hostsOpen ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim))
              .child(div().text_size(12).text_color(t.muted).child(`Per host${hostCount > 0 ? ` (${hostCount})` : ""}`)))
            .when(hostsOpen, (d) => d.child(this.usageHostsBlock(t, cx)))))),
    ], this.button(t, "usage-hosts-refresh", this.usageRefreshing ? "Refreshing…" : "Refresh", (_e, cx) => this.refreshUsageHosts(cx), { small: true, iconName: "rig-refresh", disabled: !!this.usageRefreshing }));
    const costCard = this.card(t, "Cost", [this.status(t, cx, "/api/telemetry/usage/cost", cost) ?? v_flex().gap(6)
      .child(this.table(t, "cost", [["Seat"], ["Status", 100], ["Estimate", 90, "right"]], seats.map((s) => ({ cells: [s.seatSession, s.status, usd(s.costUsd)] }))))
      .child(h_flex().px(8).child(div().flex_1().text_size(12).text_color(t.dim).child(cost.data.note ?? "")).child(div().w(90).text_right().text_size(12.5).font_semibold().child(`Total ${usd(total)}`))) ]);
    const recentCard = v_flex().rounded(10).bg(t.background).border_1().border_color(sysRecentFocused ? t.accent : t.border).p(12).gap(8)
      .child(h_flex().id("sys-recent-toggle").gap(6).items_center().cursor_pointer().on_click(() => toggleOpen("sys:recent", sysRecentOpen))
        .child(svg(icon(sysRecentOpen ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim))
        .child(div().flex_1().text_size(12.5).font_semibold().text_color(t.foreground).child("Recent activity")))
      .when(sysRecentOpen, (el) => {
        const recentPath = "/api/queue/recent-transitions?scope=instance&limit=10";
        return el.child(this.recentTransitionsBlock(t, cx, "sys-recent", recentPath, this.read(cx, recentPath)));
      });
    const peopleCard = this.peopleSection(t, cx, conn);
    const orderedCards = [
      ["people", peopleCard],
      ["config", configCard],
      ["health", healthCard],
      ["connections", connectionsCard],
      ["layout", this.layoutCard(t, cx)],
      ["usage", usageCard],
      ["cost", costCard],
      ["recent", recentCard],
      ["notifications", this.card(t,"Notifications",[this.notifyTogglePill(t,"system-notifications-toggle")])],
    ];
    const visibleCards = activeSubview
      ? orderedCards.filter(([k]) => k === activeSubview).map(([, c]) => c)
      : orderedCards.map(([, c]) => c);
    return v_flex().gap(12)
      .children(visibleCards);
  }

  // ---- the header ------------------------------------------------------------------------------------------------
  /** The menu target for what is shown (the header's Actions), or null when it has none. */
  targetFor(cx, entry) {
    if(entry.section==='topology'&&entry.kind==='assistant'){
      const member=this.hostedMembers(cx)?.members?.find(m=>!m.invalid&&m.seat===entry.session&&m.conn===entry.conn);
      return member?assistantTarget(member,{id:entry.rigId}):null;
    }
    if (entry.section === "topology" && entry.kind === "rig") return { kind: "rig", rig: entry.name, rigId: entry.rigId, conn: adoptConnection(this.config, entry.conn) };
    if (entry.section === "topology" && entry.kind === "seat") {
      // From the nodes this page already read: a terminal seat's menu offers no agent actions, and Attach knows whether
      // the seat runs and how OpenRig attaches it, without the sidebar's shared data.
      const n = this.cache[`/api/rigs/${encodeURIComponent(entry.rigId)}/nodes`]?.data?.find?.((x) => x.canonicalSessionName === entry.session || x.logicalId === entry.name);
      if (!n) return { kind: "seat", rig: entry.rig, rigId: entry.rigId, conn: adoptConnection(this.config, entry.conn), session: entry.session, logicalId: entry.name };
      const status = seatStatus(n);
      const stopped = status === "stopped" || status === "exited" || n.lifecycleState === "stopped" || n.lifecycleState === "recoverable" || n.attachable === false;
      return { kind: "seat", rig: entry.rig, rigId: entry.rigId, conn: adoptConnection(this.config, entry.conn), session: entry.session, logicalId: entry.name, runtime: n.runtime, terminal: isTerminalSeat(n),
        status, attachable: !stopped, sessionAlive: n.sessionAlive ?? !stopped, tmuxAttachCommand: n.tmuxAttachCommand ?? null };
    }
    if (entry.section === "specs" && entry.id) {
      const known = (this.cache["/api/specs/library"]?.data ?? []).find?.((s) => s.id === entry.id);
      return { kind: "spec", conn: this.config?.connectionId, id: entry.id, name: entry.name, sourcePath: known?.sourcePath ?? null, specKind: known?.kind ?? null };
    }
    if (entry.section === "scopes" && entry.slice) return { kind: "slice", conn: this.config?.connectionId, mission: entry.mission, slice: entry.slice, name: entry.name, slicePath: this.slicePaths(cx, entry.project).get(entry.slice) ?? null };
    if (entry.section === "needs" && entry.id) return ((this.cache["/api/attention"]?.data?.items) ?? []).map(needTarget).find((n) => n.id === entry.id) ?? null;
    return null;
  }

  /** A one-click action's progress and result (`shared("rig.status")`, set by the sidebar that runs it): a spinner, then
   *  the CLI's words for a few seconds; a stopped-rig failure offers an inline Resume… pill. */
  statusLine(t) {
    const s = shared("rig.status");
    const ttl = s?.ok === false ? ERROR_STATUS_MS : STATUS_MS;
    if (!s || (!s.busy && Date.now() - s.at >= ttl)) return null;
    this.ticking = true;
    return h_flex().id("rig-status").max_w(420).min_w(0).gap(6).items_center().flex_none()
      .child(s.busy ? svg(icon("spinner")).size(12).flex_none().text_color(t.working)
        .when(this.config?.reducedMotion !== true, icon => icon.spin(900))
        : svg(icon(s.ok ? "check" : "rig-alert")).size(12).flex_none().text_color(s.ok ? t.working : t.blocked))
      .child(div().min_w(0).truncate().text_size(12).text_color(s.ok === false ? t.blocked : t.muted).when(Boolean(s.text), (el) => el.tooltip(s.text)).child(s.text))
      .when(s.ok === false && Boolean(s.canResume && s.rig), (el) => el.child(
        this.button(
          t,
          `status-resume-${s.rig}`,
          "Resume…",
          () => openOverlay({
            mod: MOD_IDS.menu,
            kind: "dialog",
            width: 460,
            height: 380,
            props: {
              target: { kind: "rig", rig: s.rig, rigId: s.rigId ?? null, conn: s.conn, lifecycle: "stopped" },
              step: { action: "resume", confirm: true },
            },
          }),
          { small: true, iconName: "rig-play" },
        ),
      ));
  }

  header(t, cx, stack, entry) {
    const crumbs = compactLocationCrumbs(crumbsFor(entry), this.pageWidth ?? 960);
    const target = this.targetFor(cx, entry), backTo = backTarget({ stack });
    const status = this.statusLine(t);
    const narrow = (this.pageWidth ?? 960) < 480;
    const tiny = (this.pageWidth ?? 960) < 320;
    const tuiLabel = labelledTui(terminals(), spaces(), this.config) ? "Switch to TUI" : "Open in TUI";
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
            .when(i>0&&!last&&!!c.entry,el=>el.cursor_pointer().on_click(()=>push(c.entry)))
            .child(`${c.text??""}${i===0?" ▾":""}`);
          return i?[svg(icon("chevron-right")).size(10).flex_none().text_color(t.dim),crumb]:[crumb];
        })))
        .when(!!entry.filter,el=>el.child(div().id("rig-clear-filter").text_size(12).text_color(t.accent).cursor_pointer()
          .on_click(()=>clearFilter()).child(`/${entry.filter} ×`)))
        .when(!tiny,el=>el.child(this.button(t,"rig-filter-btn","",()=>palette(entry.filter?`/${entry.filter}`:"/"),{iconName:"search",tooltip:"Search"})))
        .when(!tiny&&!!this.config,el=>el.child(this.button(t,"rig-open-tui",narrow?"":tuiLabel,(_e,cx)=>this.tui(cx),{iconName:"terminal",tooltip:tuiLabel})))
        .when(!tiny,el=>el.child(div().id("rig-close").size(24).flex_none().flex().items_center().justify_center().cursor_pointer().tooltip("Close")
          .on_click(()=>closeInspection()).child(svg(icon("x")).size(14).text_color(t.muted)))))
      // Below 320 px, controls get their own row so the remaining location links still take clicks.
      .when(tiny,el=>el.child(h_flex().id("page-compact-controls").px(14).pb(6).gap(6).items_center()
        .child(this.button(t,"rig-back","",()=>this.back(),{iconName:"chevron-left",tooltip:"Back (Backspace)",disabled:!backTo}).px(6))
        .child(this.button(t,"rig-filter-btn","",()=>palette(entry.filter?`/${entry.filter}`:"/"),{iconName:"search",tooltip:"Search"}).px(6))
        .when(!!this.config,row=>row.child(this.button(t,"rig-open-tui","",(_e,cx)=>this.tui(cx),{iconName:"terminal",tooltip:tuiLabel}).px(6)))
        .child(div().id("rig-close").size(20).flex_none().cursor_pointer().tooltip("Close").on_click(()=>closeInspection()).child(svg(icon("x")).size(14).text_color(t.muted)))))
      .child(h_flex().id("page-title-bar").px(14).pb(10).gap(12).items_center().flex_wrap()
        .child(v_flex().flex_1().min_w(Math.min(240, Math.max(80, (this.pageWidth ?? 960) - 28))).gap(3)
          .child(h_flex().gap(6).items_center().min_w(0)
            .when(!!this.pageHeading?.icon,el=>el.child(svg(icon(this.pageHeading.icon)).size(16).text_color(t.foreground)))
            .when(!!this.pageHeading?.tone,el=>el.child(this.dot(t,this.pageHeading.tone,14,this.pageHeading.session)))
            .child(div().id("page-title").truncate().text_size(18).font_semibold().text_color(t.foreground).tooltip(String(this.pageHeading?.title??entryTitle(entry)??"")).child(this.pageHeading?.title??entryTitle(entry))))
          .when(!!this.pageHeading?.status,el=>el.child(this.pageHeading.statusView??div().id("page-status").truncate().text_size(12).text_color(t.muted).tooltip(this.pageHeading.status).child(this.pageHeading.status))))
        .when(!!this.pageActions,el=>el.child(this.pageActions))
        .when(!!target&&!this.pageActions,el=>el.child(this.button(t,"rig-actions","⋯",()=>menu(target),{tooltip:"Page actions"}))))
      .when(!!status,el=>el.child(div().px(14).pb(6).child(status)));
  }
  render(cx) {
    this.topologyStrip=null;
    this.wideGraph=false;
    this.pageHeading=null;
    this.pageCrumbEntry=null;
    this.pageActions=null;
    this.pageSpec=null;
    this.pageNeedsCounts={};
    this.workflowCounts={};
    const graphNav=navKey(nav().stack?.at(-1))+":"+(nav().stack?.at(-1)?.tab??"");
    if(this.graphNav!==graphNav){for(const graph of this.graphs?.values()??[])graph.reset();this.graphNav=graphNav;}
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
    const at = sharedRigData(this.config, shared)?.at;
    if (at && at !== this.dataAt) {
      this.dataAt = at;
      this.invalidateLiveReads();
    }
    const rawNav = shared("rig.nav");
    const stack = rawNav?.stack ?? [];
    let entry = stack.at(-1) ?? (rawNav == null ? this.initialEntry : null);
    const library=this.cache?.["/api/specs/library"]?.data??[];
    const spec=entry?.section==="specs"?library.find(s=>s.id===entry.id)??library.filter(s=>s.name===entry.name).find((s,_,a)=>a.length===1):null;
    if(spec&&!entry.id)entry={...entry,id:spec.id};
    this.activePageView=selectedPageView(entry??{},this.pageViewMemory??= {},spec);
    // Mission workflow support is discovered by its body read; do not replace
    // an explicit Workflows choice with Slices before that shape is known.
    if(entry&&this.activePageView&&pageViewKind(entry)!=='mission')entry=entryWithPageView(entry,this.activePageView,{preserveScope:true});
    if (this.previousSection === "needs" && entry?.section !== "needs") this.updateAction("leave");
    if (this.previousUpdateEntry !== navKey(entry)) this.selectedUpdate = null;
    this.previousUpdateEntry = navKey(entry);
    this.previousSection = entry?.section;
    this.filter = entry?.filter ?? null;
    this.statusMotion.begin(JSON.stringify([this.config?.daemonUrl,navKey(entry)]),cx,{
      reducedMotion:this.config?.reducedMotion===true,
      attention: this.cache["/api/attention"]?.data?.items ?? sharedRigData(this.config, shared)?.attentionItems,
    });
    let body;
    if (!this.config) body = this.dim(t, "Reading OpenRig's settings…");
    else if (!entry) body = this.dim(t, "Nothing open. Pick a rig, seat, spec or slice in the Rig sidebar.");
    else if (entry.section === "file") body = this.fileView(t, cx, entry);
    else if (entry.section === "topology") body = this.topology(t, cx, entry);
    else if (entry.section === "specs") body = this.specs(t, cx, entry);
    else if (entry.section === "scopes") body = this.scopes(t, cx, entry);
    else if (entry.section === "terminals") body = this.terminals(t, cx, entry);
    else if (entry.section === "needs") body = this.needs(t, cx, entry);
    else body = this.system(t, cx, entry);
    const file = entry?.section === "file";
    // After the body: its reads are what the note checks.
    const note = file ? null : this.refreshNote(t);
    this.refreshNowTails(cx);
    return v_flex().id("rig-view-root").size_full().bg(t.surface ?? t.panel ?? t.bg).text_color(t.foreground).track_focus(this.handle)
      .on_size_change((size,cx)=>{if(size.width>0&&this.pageWidth!==size.width){this.pageWidth=size.width;cx.notify();}})
      // A click outside text takes the page keyboard, so Esc and Backspace work after it.
      .on_mouse_down("left", () => this.handle.focus())
      .on_key_down((e, cx) => {
        // A key typed in a reply box is the reply's (replyBox marks it on the way up).
        if (this.typing) { this.typing = false; return; }
        // Herdr owns Alt+Left for pane navigation; Backspace is history outside text.
        if (e.key === "backspace" && !e.modifiers?.control && !e.modifiers?.platform && !e.modifiers?.alt) this.back();
        else if (e.modifiers?.alt && String(e.key).toLowerCase()==="s")this.sectionMenu();
        else if (entry?.section === "needs" && this.routeNeedKey(e, cx, entry)) { /* open card consumes its shortcuts */ }
        else if (entry?.section === "system" && this.configPanel?.keyDown(e,cx)) { /* configuration editor owns its Enter/Esc */ }
        else if (e.key === "escape" && entry?.section === "topology" && !entry.kind && this.pulseFilter) { this.pulseFilter = null; cx.notify(); }
        else if (e.key === "escape") closeInspection();
        else if (e.key === "delete" && entry?.section === "needs" && !entry.id && dismissible(this.selectedUpdate) && !this.selectedUpdate.dismissed
          && this.visibleUpdates?.some((n) => updateKey(n) === updateKey(this.selectedUpdate)))
          this.updateAction("dismiss", this.selectedUpdate);
        // `/` filters a page's tables; a file page has none, so it does nothing there, as Filter… isn't offered.
        else if (e.key === "/" && entry?.section !== "file" && !e.modifiers?.control && !e.modifiers?.platform && !e.modifiers?.alt) palette(entry?.filter ? `/${entry.filter}` : "/");
        // Otherwise the rows' keys: ↑/↓, ←/→, Home/End, Enter, S, Q, the Menu key or Shift+F10.
        else this.pageTreeKey(e, cx);
      })
      .child(file ? this.fileHeader(t, entry) : this.header(t, cx, stack, this.pageCrumbEntry??entry??{ section: "topology" }))
      .when(!!this.topologyStrip,el=>el.child(div().px(14).pb(6).child(this.topologyStrip)))
      .when(!file, (el) => {const resolved=this.pageSpec?{...entry,id:this.pageSpec.id}:entry;
        const tabs=this.objectTabs(t,resolved??{section:"topology"},this.pageSpec??spec);return tabs?el.child(tabs):el;})
      .child(file ? v_flex().id("rig-view-body").flex_1().min_h(0).child(body)
        : v_flex().id(entry?.section === "system" && entry.subview === "health" ? `rig-view-body-health-${entry.healthRigId ?? "all"}` : "rig-view-body").flex_1().min_h(0).overflow_y_scrollbar().p(pageBodyLayout(this.pageWidth).padding).child(v_flex().when(!this.wideGraph,el=>el.max_w(960)).when(this.wideGraph,el=>el.w_full()).gap(12).when(!!note, (el) => el.child(note)).child(body)));
  }
}
