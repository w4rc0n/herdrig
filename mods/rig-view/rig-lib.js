// Shared by OpenRig's Rig mods (rig, rig-view, rig-palette, rig-menu). Authored once and kept
// byte-identical inside each of those mod folders, so every
// folder works after a plain copy. Pure: no `herdr` import, so tests import it directly. Everything a mod
// needs from the host (fetch, exec, terminals) is passed in.
import { attachRemoteSeat } from "./rig-remote-attach.js";
import {activationPair} from './rig-activation.js';
import { formatAbsoluteTime } from './rig-time.js';
import { routeOpen, homeKey } from "./rig-routing.js";
import { gatedFetch, gatedOperationOrRefusal, rethrowGate, CONFIG_LOADING, publishedUnder, publishedConfigFor } from "./rig-gate.js";
import { healthCounts, classifyHealth } from "./rig-health.js";
import { resolveRigSpace, unconfirmedRigSpace, unconfirmedSpaceReason, markRigSpace, rigOrigin, openRigSpaceContext, sameDaemonOrigin, vouchedSpace, rigSessions, prepareRigSpaceAdoption, topologyRig } from "./rig-space-context.js";
import { followedConnection, spaceMachine } from "./rig-follow.js";
import { localDaemonOrigin, connectionsOf, LEGACY_CONNECTION_ID, HOME_NEEDED, configOfConnection, AMBIGUOUS_NAME, pickSeat, seatMatchesRef, ambiguousSeatMessage, qualifyKey, plainExecError, isKnownUnsentError, unsentErrorMessage } from "./rig-connections.js";
import { assistantActionRefusal } from './rig-connected-assistants.js';
import { SYSTEM_PAGE_VIEWS } from './rig-page-nav.js';
import { counted as countWords, plainError as errorWords, statusWord as stateWords, requestFailed as failedWords, requestWhat as requestWords } from './rig-words.js';
import {
  parseConfig as coreParseConfig,
  isLoopbackDaemonUrl as coreIsLoopbackDaemonUrl,
  sharedLoopbackDaemonUrl as coreSharedLoopbackDaemonUrl,
  layoutHasMod as coreLayoutHasMod,
  machineSpaceConn as coreMachineSpaceConn,
  navKey as coreNavKey,
  navPush as coreNavPush,
  tabPagesPush as coreTabPagesPush,
  pushTabPage as corePushTabPage,
} from "./rig-core.js";
// Local wrapper exports avoid indirect re-exports through the existing module cycles in QuickJS.
export const counted = (n, one, many) => countWords(n, one, many);
export const plainError = (error, options) => errorWords(error, options);
export const statusWord = (token, kind) => stateWords(token, kind);
export const parseConfig = (text) => coreParseConfig(text);
export const isLoopbackDaemonUrl = (daemonUrl) => coreIsLoopbackDaemonUrl(daemonUrl);
export const sharedLoopbackDaemonUrl = (config, published) => coreSharedLoopbackDaemonUrl(config, published);
export const layoutHasMod = (node, mod) => coreLayoutHasMod(node, mod);
export const machineSpaceConn = (config, space) => coreMachineSpaceConn(config, space);
export const navKey = (entry) => coreNavKey(entry);
export const navPush = (nav, entry) => coreNavPush(nav, entry);
export const tabPagesPush = (all, tabId, entry, options) => coreTabPagesPush(all, tabId, entry, options);
export const pushTabPage = (host, tabId, entry, options = {}) => corePushTabPage(host, tabId, entry, { viewMod: MOD_IDS.view, ...options });
import { cleanSidebarViews, cleanAwayStates, cleanNotifiedNeeds, cleanNotifiedNeedsMap } from './rig-sidebar-view-state.js';
const SYSTEM_VIEW_LABELS = new Map(SYSTEM_PAGE_VIEWS);

/** The single space-routing entry point for pages, the TUI, Attach and rig grids. */
let routingEnvironment = null;
/** The settings a producer's rows were read under, reduced to the fields that make a config a different one for the send gate (see rig-gate.js identity). */
export const ROWS_STALE = "OpenRig's settings changed since these rows were loaded. Wait for the list to refresh, then try again.";
export const rowsIdentityOf = (config, conn) => (config ? ((c) => ({ connectionId: c.connectionId, daemonUrl: c.daemonUrl, daemonUrlSource: c.daemonUrlSource, daemonMachine: c.daemonMachine,
  openrigHome: c.openrigHome, rig: c.rig, configInvalid: c.configInvalid }))(conn && conn !== config.connectionId ? (configOfConnection(config, conn) ?? { connectionId: conn }) : config) : null); // the stamp is the ROW's connection identity (a row of B is judged against B, never against the primary)
/** Every producer of a menu target stamps the settings ITS rows were read under (`rowsConfig`) before it opens the menu: the sidebar, the Rig page, All seats, the palette and the Needs
 *  cards each read their own rows under their own config, and the menu judges the target by its own stamp against a fresh read of config.json (a stamp-less target is not judged:
 *  no sidebar, no rig.data, nothing to compare). A stamp already on the target (a dialog opened from a menu) is kept. */
export function stampRows(spec, identity) {
  if (!identity || spec?.mod !== MOD_IDS.menu || !spec.props?.target || typeof spec.props.target !== "object" || spec.props.target.rowsConfig) return spec;
  return { ...spec, props: { ...spec.props, target: { ...spec.props.target, rowsConfig: identity } } };
}
/** A message's editor and refusal stay together in one host dialog. At 260px the editor, title, hint and footer
 * leave no result viewport, even with flex_none. Apply it wherever the dialog opens, before the host fixes its size. */
export function messageDialogSpace(spec) {
  if (spec?.mod !== MOD_IDS.menu || spec.kind !== "dialog" || !spec.props?.step?.input
    || !["send", "queue", "reply"].includes(spec.props.step.action)) return spec;
  return { ...spec, height: Math.max(440, Number(spec.height) || 0) };
}
export function registerRigRouting(cx, environment) {
  // init/render contexts expire when their call returns. Keep waits on a view-owned asynchronous task instead.
  cx.spawn(async context => {
    routingEnvironment = conn => environment(context, conn);
    await new Promise(() => {});
  });
}
/** Rig spaces, attach, the operator and worker views are not per connection yet: a target of another connection than the config it was given
 *  is refused (never routed through that config's address). */
export const OTHER_CONNECTION_REFUSAL = "This is on another OpenRig, and opening it from here comes in a later update. Nothing was opened.";
export const crossesConnections = (config, target) => Boolean(target?.conn && config?.connectionId && target.conn !== config.connectionId);

export function routeRigOpen(host, config, request) {
  if (crossesConnections(config, request) || crossesConnections(config, request?.entry) || crossesConnections(config, request?.seat)) return Promise.resolve({ ok: false, reason: OTHER_CONNECTION_REFUSAL });
  const environment = routingEnvironment?.(request?.conn ?? request?.entry?.conn ?? request?.seat?.conn ?? config?.connectionId) ?? {};
  return routeOpen({ ...environment, ...host }, config ?? environment.config, request);
}

/**
 * The folder names the Rig mods open each other by. A person's installer that renamed a folder because the name was
 * taken changes the matching value here, in every mod folder's copy of this file; nothing else names another mod.
 */
export const MOD_IDS = Object.freeze({ sidebar: "rig", view: "rig-view", palette: "rig-palette", menu: "rig-menu" });

// Queue text is daemon-supplied and drawn on every redraw, so these patterns must stay linear: `[^\S\n]` is whitespace that
// can't cross a line, and no two adjacent quantifiers may match the same characters (njsscan regex_dos triage, v0.4.4).
const requestPlain = (s) => String(s ?? "").replace(/^[^\S\n]*(?:#{1,6}[^\S\n]+|>[^\S\n]*|[-*][^\S\n]+|\d+\.[^\S\n]+)/gm, "")
  .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1")
  .replace(/(^|\s)_([^_\n]+)_(?=$|\s|[.,!?])/g, "$1$2").replace(/`([^`\n]+)`/g, "$1").trim();
const requestCap = (s, max) => {
  if (s.length <= max) return s;
  const chunk = s.slice(0, max - 1), boundary = chunk.lastIndexOf(" ");
  if (max >= 320) {
    const ends = [...chunk.matchAll(/[.!?](?=\s+[A-Z0-9])/g)].map(m => m.index + 1);
    if (ends.at(-1) > max / 2) return `${chunk.slice(0, ends.at(-1))}…`;
  }
  return `${chunk.slice(0, boundary > max / 2 ? boundary : chunk.length).trimEnd()}…`;
};
/** First prose sentence, skipping leading fenced/indented code. Version/file/URL periods stay inside tokens. */
export function requestFirstSentence(source, max = 140) {
  let s = String(source ?? "").replace(/^\n+/, "");
  while (/^(?:```|~~~| {4}|\t|#{1,6}\s[^\n]*\n|>[^\n]*\n)/.test(s)) {
    if (/^(?:#{1,6}\s|>)/.test(s)) {
      // Body headings/quotes are blocks, not prefixes to the following prose. A one-line summary stays text.
      s = s.slice(s.indexOf("\n") + 1).trimStart();
    } else if (/^(?:```|~~~)/.test(s)) {
      const fence = s.slice(0, 3), end = s.indexOf(`\n${fence}`, 3);
      if (end < 0) return "";
      s = s.slice(s.indexOf("\n", end + 1) < 0 ? s.length : s.indexOf("\n", end + 1) + 1).trimStart();
    } else {
      const end = s.indexOf("\n\n"); if (end < 0) return ""; s = s.slice(end + 2).trimStart();
    }
  }
  s = requestPlain(s.split(/\n\s*\n/)[0] ?? "");
  const space = (c) => c !== undefined && /\s/.test(c);
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ":" && (i === s.length - 1 || s[i + 1] === "\n")) return requestCap(singleLineText(s.slice(0, i + 1)), max);
    if (!/[.!?]/.test(s[i])) continue;
    // A sentence ends here at the end of the text, before a newline, or before whitespace and then a capital or digit. Scanned by index,
    // not by slicing the rest of the text, so a long run of initials ("A. A. …") stays linear.
    if (i + 1 < s.length && s[i + 1] !== "\n") {
      let j = i + 1;
      while (j < s.length && space(s[j])) j++;
      if (j === i + 1 || j >= s.length || !/[A-Z0-9]/.test(s[j])) continue;
    }
    let k = i;
    while (k > 0 && !space(s[k - 1])) k--;
    const token = s.slice(k, i + 1);
    // Abbreviations that are never a sentence end ("vs. B", "Acme Inc. Then"); "no.", "st." and "co." are left out, as they also end real sentences.
    if (/^(?:e\.g\.|i\.e\.|[A-Z]\.|(?:vs|etc|inc|ltd|corp|mr|mrs|ms|dr|approx|cf)\.)$/i.test(token)) continue;
    return requestCap(singleLineText(s.slice(0, i + 1)), max);
  }
  return requestCap(singleLineText(s), max);
}

/** A line that is only a "Details" heading (`## Details`, `**Details**:`, `Details:`), matched one line at a time. */
const DETAILS_LINE = /^[^\S\n]*(?:#{1,6}[^\S\n]+Details[^\S\n]*|\*\*Details\*\*[^\S\n]*(?::[^\S\n]*)?|Details[^\S\n]*(?::[^\S\n]*)?)$/i;
/** Where the first Details line is: `{ index, 0: line }` like a regex match, or null. */
function detailsLine(source) {
  let at = 0;
  for (const line of source.split("\n")) {
    if (DETAILS_LINE.test(line)) return { index: at, 0: line };
    at += line.length + 1;
  }
  return null;
}

/** How much of a body (or a summary) a headline reads. A headline is at most 140 characters, so this leaves ample room for leading
 *  headings, quotes and short code blocks, while a 100 KB request costs no more per redraw than a short one. */
const HEADLINE_SCAN = 4096;
/** A need's headline, for rows that show only that (the sidebar's needs rows and Priority list, notifications). It reads the body
 *  only when the request has no summary, and then only its start. The same text as a parsed card's headline except for a
 *  request whose first sentence starts after HEADLINE_SCAN characters (then it says who asked). */
export function requestHeadline(item = {}, body = "") {
  const raw = item.summaryIsFallback && item.summary === item.id ? "" : item.summary ?? item.title ?? "";
  const summary = rowText(requestPlain(String(raw ?? "").slice(0, HEADLINE_SCAN)));
  const headline = summary
    ? summary.length <= 140 ? summary : requestFirstSentence(summary)
    : requestFirstSentence(withoutRowIds(String(body || item.body || item.bodyPreview || "").slice(0, HEADLINE_SCAN).replace(/\r\n?/g, "\n").replace(/^\n+/, "").trimEnd()));
  return headline || `Request from ${item.asker ?? item.sourceSession ?? "the asking seat"}`;
}

/** Parsed cards by request, so a redraw with the same request and text doesn't parse a long body again. Each entry keeps the exact
 *  inputs it was parsed from; any change parses again. A small bound: entries for requests that left the list fall out. */
const CARD_CACHE = new Map(), CARD_CACHE_MAX = 64;

/** Presentation only: never rewrites ids, generates a decision, or drops the original body from Details. The result is shared
 *  between redraws and callers (frozen): read it, don't change it. */
export function requestCardText(item = {}, body = "", { openingLimit = 320, perRow = null } = {}) {
  const rowChars = perRow ?? Math.floor(Math.min(320, Math.max(40, openingLimit)) / REQUEST_OPENING_LINES);
  const text = body || item.body || item.bodyPreview || "";
  const inputs = [item.summary, item.title, item.summaryIsFallback, item.asker, item.sourceSession, text];
  const key = typeof item.id === "string" && item.id ? `${item.id}\u0000${rowChars}\u0000${String(text).length}` : null;
  const hit = key ? CARD_CACHE.get(key) : null;
  if (hit && hit.inputs.every((value, i) => value === inputs[i])) return hit.result;
  const result = Object.freeze(parseRequestCard(item, text, rowChars));
  if (key) {
    CARD_CACHE.delete(key);
    CARD_CACHE.set(key, { inputs, result });
    if (CARD_CACHE.size > CARD_CACHE_MAX) CARD_CACHE.delete(CARD_CACHE.keys().next().value);
  }
  return result;
}

function parseRequestCard(item, body, rowChars) {
  const source = String(body || item.body || item.bodyPreview || "").replace(/\r\n?/g, "\n").replace(/^\n+/, "").trimEnd();
  const summary = requestPlain(item.summaryIsFallback && item.summary === item.id ? "" : item.summary ?? item.title ?? "");
  // Shown text carries no queue row ids; the full summary and the rest of the message, ids included, stay in Details.
  const shownSummary = rowText(summary), summaryHadIds = shownSummary !== singleLineText(summary);
  const headline = (shownSummary ? shownSummary.length <= 140 ? shownSummary : requestFirstSentence(shownSummary) : requestFirstSentence(withoutRowIds(source.slice(0, HEADLINE_SCAN))))
    || `Request from ${item.asker ?? item.sourceSession ?? "the asking seat"}`;
  const match = detailsLine(source);
  let opening = match ? source.slice(0, match.index).trim() : source.split(/\n\s*\n/)[0] ?? "";
  let rest = match ? source.slice(match.index + match[0].length).trim() : source.slice(opening.length).trim();
  const first = requestFirstSentence(opening, 10000);
  const sameProse = s => requestPlain(s).toLowerCase().replace(/[.!?:]+$/, "");
  if (first && sameProse(rowText(first)) === sameProse(headline)) {
    // Remove only a source prefix we can match to the headline. Leave an ambiguous prefix intact.
    const firstLine = opening.split("\n", 1)[0];
    const wrapped = ["**", "__", "_", "`"].map(mark => `${mark}${first}${mark}`).find(prefix => opening.startsWith(prefix));
    const duplicate = sameProse(rowText(firstLine)) === sameProse(headline) ? firstLine
      : wrapped ?? (opening.startsWith(first) ? first : "");
    if (duplicate) {
      const summaryIds = new Set(summary.match(ROW_ID) ?? []);
      if ((duplicate.match(ROW_ID) ?? []).some(id => !summaryIds.has(id))) {
        rest = [duplicate, rest].filter(Boolean).join("\n\n");
      }
      opening = opening.slice(duplicate.length).replace(/^[^\S\n]*(?:\n|$)|^[^\S\n]+/, "");
    }
  }
  // The opening is cut to what its box shows (three rows at the card's width), so nothing is hidden: the rest of a cut line
  // and every later line start Details, and the card says how many lines moved, or "More in Details".
  const strippedOpening = withoutRowIds(opening);
  const cut = cutToRows(strippedOpening, REQUEST_OPENING_LINES, rowChars);
  const laterLines = rest.split("\n").filter(line => line.trim()).length;
  const openingDetails = strippedOpening !== opening ? opening : cut.rest;
  if (openingDetails) rest = [openingDetails, rest].filter(Boolean).join("\n\n");
  opening = cut.shown;
  const openingMoreLines = cut.moreLines + laterLines, openingCut = cut.cut;
  const details = [summary.length > 140 || summaryHadIds ? `Full summary:\n${String(item.summary ?? item.title)}` : "", rest].filter(Boolean).join("\n\n");
  const headings = [...details.matchAll(/^(?:#{1,6}\s+(.+)|\*\*(.+?)\*\*)\s*$/gm)].map(m => requestPlain(m[1] ?? m[2])).slice(0, 3);
  return { headline, opening, openingMoreLines, openingCut, details, detailHint: headings.join(" · ") || "the full message", source };
}
/** How many rows (and so at most how many source lines) a request card's opening shows before "<n> more lines in Details". */
export const REQUEST_OPENING_LINES = 3;
/** Characters a row of the opening holds at a card width: a deliberately wide 7.5 px a character (Geist at 12.5 px averages
 *  about 6.3, and wrapping breaks at words), so the estimate never fits more than the box shows; at most 106 (a 320 cap). */
export function openingRowChars(width, narrow = width < 480) {
  return Math.max(20, Math.min(106, Math.floor((width - (narrow ? 32 : 40)) / 7.5)));
}
/** The first `rows` rows of `text` at `perRow` characters a row: whole lines while they fit, then the start of the next line
 *  at a word with "…". `rest` is exactly what was not shown (the cut line's remainder, then the later lines). */
function cutToRows(text, rows, perRow) {
  const lines = text.split("\n"), shown = [];
  let left = rows, i = 0, tail = "";
  for (; i < lines.length && left > 0; i++) {
    const need = Math.max(1, Math.ceil(lines[i].length / perRow));
    if (need <= left) { shown.push(lines[i]); left -= need; continue; }
    const room = left * perRow - 1, head = lines[i].slice(0, room), space = head.lastIndexOf(" ");
    const keep = space > room / 2 ? head.slice(0, space) : head;
    shown.push(`${keep.trimEnd()}…`); tail = lines[i].slice(keep.length).trimStart(); i++;
    break;
  }
  const after = lines.slice(i);
  return { shown: shown.join("\n"), rest: [tail, ...after].filter((line, j) => j > 0 || line).join("\n"), moreLines: after.length, cut: Boolean(tail) };
}
/** The muted line under a cut opening: "<n> more lines in Details", or "More in Details" when only wrapping overflows. */
export function openingMoreText(moreLines, wrapsOver) {
  return moreLines > 0 ? `${moreLines} more ${moreLines === 1 ? "line" : "lines"} in Details` : wrapsOver ? "More in Details" : null;
}

/** One request id each, plus prompt-only seats. A seat's attributed asks replace its extra prompt count. */
export function needsRequestCount(topology = [], items = []) {
  const ids = new Set(), attributed = new Set();
  for (const item of filterAttentionHealth(items)) {
    if (!item?.id || isUpdateNeed(item) || ["done", "closed", "denied", "canceled", "handed-off"].includes(item.state)) continue;
    if (sweepFinding(item)) continue; // OpenRig's check on another row: counted apart (needsCheckCount), and its sender asked nothing
    ids.add(item.id);
    const session = item.answer?.verb === "resolve" || item.reply === "resolve" ? item.waiting?.owner ?? item.destinationSession : item.asker ?? item.sourceSession;
    if (session) attributed.add(session);
  }
  for (const rig of topology ?? []) for (const pod of rig.pods ?? []) for (const seat of pod.seats ?? []) {
    if (!seat.terminal && !["terminal", "stopped", "detached", "exited", "unknown"].includes(seat.status)
      && !["stopped", "detached", "exited"].includes(seat.sessionStatus) && ["needs_input", "attention_required", "failed"].includes(seat.status)
      && !attributed.has(seat.session)) ids.add(`prompt:${seat.session}`);
  }
  return ids.size;
}

/** The height of one line of page text (12.5 px type), and of the empty line a blank source line draws. */
export const TEXT_LINE_HEIGHT = 20;
const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
/** Already-escaped line HTML with its leading and repeated spaces visible; an empty line keeps its row. */
const visibleSpaces = (html) => html.replace(/^ +/, (s) => "&nbsp;".repeat(s.length)).replace(/ {2,}/g, (s) => ` ${"&nbsp;".repeat(s.length - 1)}`) || "&nbsp;";
/** A text's lines as people wrote them; one trailing line ending ends the last line rather than starting an empty one. */
export function sourceLines(text) {
  return String(text).replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
}
/** Daemon text escaped for TextView.html, one entry per source line. A single line stays exactly one escaped run. */
export function escapedLines(text) {
  const lines = sourceLines(text);
  return lines.length === 1 ? [escapeHtml(lines[0])] : lines.map((line) => visibleSpaces(escapeHtml(line)));
}
/** Lines as people wrote them: one selectable TextView per line, stacked with no gap at TEXT_LINE_HEIGHT. Herdr's HTML view
 *  draws <br> as an empty block and runs the lines around it together, and gives separate HTML blocks a paragraph gap, so
 *  neither keeps the source's lines. A blank source line is one empty line, the only paragraph break. The column carries no
 *  text style of its own: callers style it (title, dim, a colour or font) and every line inherits that. */
export function textLinesView(lines, { TextView, v_flex, id }) {
  return v_flex().id(id).gap(0).min_w(0).line_height(`${TEXT_LINE_HEIGHT}px`)
    .children(lines.map((html, i) => TextView.html(`${id}-line-${i}`, html).selectable(true).scrollable(false)));
}
/** OpenRig's stuck-sweep finding: its check on another row, not a new request. Known only by the daemon's own tags (`stuck-sweep-finding`,
 *  with `recovery-for:<row>` for one stuck row, or `stuck-sweep:unclaimed-backlog:<seat>` for a seat's unclaimed rows), never by its summary
 *  text, and never by its sender (the stuck row's own creator). Null for anything else. */
export const SWEEP_FINDING_TAG = "stuck-sweep-finding";
const RECOVERY_FOR = "recovery-for:", BACKLOG_OF = "stuck-sweep:unclaimed-backlog:";
export function sweepFinding(item) {
  const tags = Array.isArray(item?.tags) ? item.tags.filter((tag) => typeof tag === "string") : [];
  if (!tags.includes(SWEEP_FINDING_TAG)) return null;
  const about = tags.find((tag) => tag.startsWith(RECOVERY_FOR))?.slice(RECOVERY_FOR.length) || null;
  const backlogSeat = about ? null : tags.find((tag) => tag.startsWith(BACKLOG_OF))?.slice(BACKLOG_OF.length) || null;
  return { about, backlogSeat, ...(item.conn?{conn:item.conn}:{}) };
}
/** A seat as people read it: the logical id from its session (`api-worker@demo` reads `api.worker`). */
const seatWord = (session) => String(session ?? "").split("@")[0].replace(/-/g, ".") || "a seat";
/** The seat a backlog notice is about, as people read it, with its rig (from `<seat>@<rig>`). */
export function checkSeat(finding) {
  const session = String(finding?.backlogSeat ?? ""), at = session.lastIndexOf("@");
  return { name: seatWord(session), session: session || null, rig: at > 0 ? session.slice(at + 1) : null };
}
/** The row a check names, as its headline (id-free, like any row text), from the rows at hand; "a stalled row" when it isn't loaded. */
export function checkedRowHeadline(finding, rows = []) {
  const row = finding?.about ? (rows ?? []).find((r) => r && (!finding.conn||r.conn===finding.conn) && (r.qitemId === finding.about || r.id === `queue:${finding.about}` || r.id === finding.about)) : null;
  return row ? requestHeadline(row) : "a stalled row";
}
/** A check's label in every list: "Check on: <row>", or for a seat's unclaimed rows "Check on: <seat>'s unclaimed rows". */
export function checkLabel(finding, rows = []) {
  return finding?.backlogSeat ? `Check on: ${seatWord(finding.backlogSeat)}'s unclaimed rows` : `Check on: ${checkedRowHeadline(finding, rows)}`;
}
/** Why OpenRig made the check: its summary after the first colon ("it stalled after it was picked up (63 minutes)"), id-free. */
export function checkReason(item) {
  const text = rowText(item?.summary ?? ""), at = text.indexOf(":");
  return at >= 0 ? text.slice(at + 1).trim() : "";
}
/** The open checks among Needs items, each once. */
export function needsCheckCount(items = []) {
  return new Set((items ?? []).filter((item) => item?.id && !isUpdateNeed(item) && sweepFinding(item)
    && !["done", "closed", "denied", "canceled", "handed-off"].includes(item.state)).map((item) => item.id)).size;
}
/** " · 1 check" / " · 3 checks" after a requests count, and nothing when there are none. */
export const checksSuffix = (n) => n > 0 ? ` · ${n} ${n === 1 ? "check" : "checks"}` : "";

/** Small request-detail Markdown view. Host constructors are injected to keep this library host-independent.
 * Daemon text is escaped FIRST. Only our p/br/strong/code/ul/ol/li tags can enter TextView.html;
 * links, images, raw HTML and entities never become active content. TextView paragraphs stay selectable;
 * standalone bold headings use native semibold rows because TextView's strong loses weight with Geist on this
 * Linux build. Inline strong remains native. Callers' Copy body control retains the complete original source. */
export function requestMarkdownView(text, { TextView, div, v_flex, id = "request-markdown" }) {
  const escaped = String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const inline = (s) => s.split(/(`[^`\n]+`)/g).map((part) => part.startsWith("`") && part.endsWith("`")
    ? `<code>${part.slice(1, -1)}</code>` : part.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")).join("");
  // Each block remembers whether a blank source line came before it: that, and only that, is a paragraph break.
  let html = "", paragraph = [], list = null, blank = false, htmlBlank = false, paraBlank = false;
  const blocks = [];
  const flushHtml = () => { if (html) { blocks.push({ html, afterBlank: htmlBlank }); html = ""; } };
  // A paragraph of several lines keeps them, one TextView per line with no gap (see textLinesView); one line stays one <p>.
  const flushParagraph = () => { if (paragraph.length) { if (paragraph.length === 1) { htmlBlank = paraBlank; html += `<p>${inline(paragraph[0])}</p>`; } else { flushHtml(); blocks.push({ lines: paragraph.map((line) => visibleSpaces(inline(line))), afterBlank: paraBlank }); } paragraph = []; flushHtml(); } };
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of escaped.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) { flushParagraph(); closeList(); flushHtml(); blank = true; continue; }
    const heading = /^\s*(?:\*\*([^*]+)\*\*\s*|#{1,6}\s+(.+?))\s*$/.exec(line);
    if (heading) {
      flushParagraph(); closeList(); flushHtml();
      // Decode only the entities we introduced, once; div.child is plain text, never HTML.
      const plain = (heading[1] ?? heading[2]).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
      blocks.push({ heading: plain, size: /^\s*#\s/.test(line) ? 15 : 14, afterBlank: blank }); blank = false; continue;
    }
    const bullet = /^\s*(?:([-*])\s+|(\d+)\.\s+)(.*)$/.exec(line);
    if (bullet) {
      flushParagraph(); const kind = bullet[1] ? "ul" : "ol";
      if (!html) { htmlBlank = blank; blank = false; }
      if (list !== kind) { closeList(); html += kind === "ol" ? `<ol start="${Number(bullet[2]) || 1}">` : "<ul>"; list = kind; }
      html += `<li>${inline(bullet[3])}</li>`;
    } else { closeList(); flushHtml(); if (!paragraph.length) { paraBlank = blank; blank = false; } paragraph.push(line); }
  }
  flushParagraph(); closeList(); flushHtml();
  // A blank source line is one empty line (TEXT_LINE_HEIGHT), as in plain() text; blocks with no blank line between them keep 6 px.
  // The space sits on the block itself (a top margin); only a native TextView, which takes no margin, gets a wrapper.
  return v_flex().id(id).gap(0).children(blocks.map((block, i) => {
    const space = i === 0 ? 0 : block.afterBlank ? TEXT_LINE_HEIGHT : 6;
    if (block.heading !== undefined) return div().id(`${id}-${i}`).font_semibold().text_size(block.size).pt(8).pb(2).mt(space).child(block.heading);
    if (block.lines) return textLinesView(block.lines, { TextView, v_flex, id: `${id}-${i}` }).mt(space);
    const view = TextView.html(`${id}-${i}`, block.html).selectable(true).scrollable(false);
    return space ? div().mt(space).child(view) : view;
  }));
}

/** The current parked work belongs to its destination, independently of who asked or answers. */
export function parkedWorkOwner(item) {
  return item?.waiting?.owner ?? item?.destinationSession ?? "the owning seat";
}

/** An authoritative queue decision/park identity, not just its durable qitem id. */
export function needDecisionIdentity(item) {
  return JSON.stringify([item?.decisionRevision ?? null, item?.state ?? null, item?.blockedOn ?? null,
    item?.body ?? null, item?.summary ?? null]);
}

/** Observe a completed read, retaining only the immediate receipt of our own resulting revision.
 * Cached pre-action data is not a new authoritative decision. A new park can arrive before the first poll. */
export function observeNeedDecision(box, row, readAt = 0) {
  if (!row || box.busy) return false;
  const identity = needDecisionIdentity(row);
  const receipt = box.receipt;
  if (receipt && readAt <= receipt.at) return false;
  const changed = receipt
    ? (row.decisionRevision !== receipt.revision || (receipt.state && row.state !== receipt.state)
      || (receipt.body !== undefined && row.body !== receipt.body))
    : Boolean(box.observedIdentity && box.observedIdentity !== identity);
  box.observedIdentity = identity;
  if (!changed) return false;
  box.changedSinceAnswered = Boolean(receipt || box.result?.ok);
  box.result = null; box.receipt = null; box.confirmResolve = false;
  box.composerOpen = false;
  box.recordedChoiceByQuestion = {};
  return true;
}

/** Partial bounded scans are incomplete coverage; unavailable/unknown sources remain clear errors. */
export function attentionCoverage(sources = []) {
  const partial = sources.filter((s) => s.state === "partial");
  const errors = sources.filter((s) => s.state !== "available" && s.state !== "partial");
  return { partial, errors, incomplete: partial.length > 0 || errors.length > 0 };
}

/** UTF-8 bytes to text (the mod runtime has no TextDecoder). A sequence split across reads is carried to the next. */
export function utf8(bytes, carry = new Uint8Array(0)) {
  const all = carry.length ? Uint8Array.from([...carry, ...bytes]) : bytes;
  let out = "", i = 0;
  while (i < all.length) {
    const b = all[i];
    const n = b < 0x80 ? 1 : b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    if (i + n > all.length) break;
    let cp = n === 1 ? b : b & (0xff >> (n + 1));
    for (let k = 1; k < n; k++) cp = (cp << 6) | (all[i + k] & 0x3f);
    out += String.fromCodePoint(cp);
    i += n;
  }
  return [out, all.slice(i)];
}

/** An SSE reader: feed it text as it arrives; it calls onEvent({event, data}) per complete event. Comment lines (the
 *  daemon's keep-alive) and the HTTP response head are skipped. */
export function sseParser(onEvent) {
  let buffer = "", head = true, event = "", data = [];
  return (text) => {
    buffer += text;
    if (head) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      buffer = buffer.slice(end + 4);
      head = false;
    }
    // Chunked transfer: size lines are hex on their own line; they're framing, not SSE fields.
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (line === "") {
        if (data.length || event) onEvent({ event: event || "message", data: data.join("\n") });
        event = ""; data = [];
      } else if (line.startsWith(":")) {
        // comment: keep-alive
      } else if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      else if (/^[0-9a-fA-F]+$/.test(line)) { /* chunk size */ }
    }
  };
}

/** Said when an action attributes an actor in OpenRig and `config.person` is absent. */
export const NO_PERSON = 'Needs your OpenRig name. Ask your agent: "Register me in OpenRig and tell the Herdr mod my name."';

/** Said when `/api/terminal/*` returns 401 on a token-protected OpenRig. */
export const TERMINAL_TOKEN_PROTECTED = "This OpenRig protects its terminal views with a token; open them with rig terminal views.";

/** Suggested upgrade line on `System → Connections` when any capability flag is false. */
export const SUGGESTED_UPGRADE_LINE = "Some controls need a newer OpenRig. Ask your agent to upgrade it the OpenRig way.";

/** Disabled reason for `Open operator` when `daemonUrl` is not loopback. */
export const REMOTE_OPERATOR_REASON = "The operator runs on another machine; open it there.";

/** One-line copy string when OpenRig is not installed, pointing at the sidebar folder's `RECIPE-OPENRIG.md`. */
export function s1CopyLine(sidebarModId = MOD_IDS.sidebar) {
  const mod = String(sidebarModId || MOD_IDS.sidebar || "rig");
  return `Read ~/.config/herdr-app/mods/${mod}/RECIPE-OPENRIG.md, then install OpenRig and open its operator in a Herdr tab.`;
}
export const S1_COPY_LINE = s1CopyLine(MOD_IDS.sidebar);

/** Exact sidebar state copy table. */
export const STATE_COPY = Object.freeze({
  S0: Object.freeze({ id: "S0", headline: "Looking for OpenRig…" }),
  S1: Object.freeze({
    id: "S1",
    headline: "OpenRig isn't installed.",
    detail: "Your coding agent can install it. Give it this line:",
    copyText: S1_COPY_LINE,
    actionLabel: "Copy",
  }),
  S2: Object.freeze({
    id: "S2",
    headline: "OpenRig is installed, but it isn't running.",
    detail: "rig daemon start starts it and its operator.",
    actionLabel: "Start OpenRig",
    command: "rig daemon start",
  }),
  S3: Object.freeze({ id: "S3", headline: "OpenRig isn't answering." }),
  S4: Object.freeze({
    id: "S4",
    headline: null,
    noRigsText: "No teams yet. Tell the operator what you want built.",
    actionLabel: "Open operator",
  }),
  S5: Object.freeze({ id: "S5", headline: null }),
  "5a": Object.freeze({ id: "5a", headline: "OpenRig's operator is starting.", actionLabel: null, copyText: null }),
  "5b": Object.freeze({
    id: "5b",
    headline: "OpenRig is running without its operator.",
    actionLabel: "Copy fix",
    copyText: "rig up kernel --existing",
  }),
  "5c": Object.freeze({
    id: "5c",
    headline: "The operator can't start: no Claude Code or Codex sign-in.",
    actionLabel: "Copy fix",
    copyText: "rig doctor",
  }),
  "5d": Object.freeze({
    id: "5d",
    headline: "The operator isn't running.",
    actionLabel: "Copy fix",
    copyText: "rig ps --nodes --rig kernel",
  }),
  S6: Object.freeze({ id: "S6", headline: null, suggestedUpgrade: SUGGESTED_UPGRADE_LINE }),
  S7: Object.freeze({ id: "S7", headline: "The rig command failed." }),
});

/**
 * Parse `rig config get daemon.host --json` output.
 * Defaults to `"127.0.0.1"` when absent or wildcard (`0.0.0.0`, `::`).
 */
export function parseDaemonHostJson(stdout) {
  let host = "127.0.0.1";
  try {
    const parsed = JSON.parse(String(stdout ?? ""));
    const raw = typeof parsed === "string" ? parsed : parsed?.value;
    if (typeof raw === "string" && raw.trim()) {
      const h = raw.trim();
      host = h === "0.0.0.0" || h === "::" ? "127.0.0.1" : h;
    }
  } catch {
    const trimmed = String(stdout ?? "").trim();
    if (trimmed && !trimmed.startsWith("{") && !/\s/.test(trimmed)) {
      host = trimmed === "0.0.0.0" || trimmed === "::" ? "127.0.0.1" : trimmed;
    }
  }
  return host;
}

/**
 * Parse `rig status --json` output.
 * Uses `daemon.state`, `daemon.reachable`, `daemon.port`, `kernel`, and `rigs`; never falls back to `:7433`.
 */
export function parseDaemonStatusJson(stdout, host = "127.0.0.1") {
  let parsed = null;
  try { parsed = JSON.parse(String(stdout ?? "")); } catch { parsed = null; }
  const d = parsed?.daemon && typeof parsed.daemon === "object" ? parsed.daemon : null;
  const kernel = parsed?.kernel && typeof parsed.kernel === "object" ? parsed.kernel : null;
  const rigs = Array.isArray(parsed?.rigs) ? parsed.rigs : null;
  if (!d) {
    return {
      reachable: false,
      state: "unreachable",
      port: null,
      daemonUrl: null,
      kernel: null,
      rigs: null,
      message: "OpenRig daemon is not running (run 'rig daemon start' or 'rig up').",
    };
  }
  const rawState = typeof d.state === "string" && d.state ? d.state : "unreachable";
  const healthy = d.healthy !== false;
  const state = rawState === "running" && !healthy ? "unhealthy" : rawState;
  const reachable = d.reachable === true && healthy;
  const portNum = Number(d.port);
  const port = Number.isInteger(portNum) && portNum > 0 && portNum <= 65535 ? portNum : null;
  const hostText = typeof host === "string" && host.trim() ? host.trim() : "127.0.0.1";
  const cleanHost = /^[0-9a-f]*:[0-9a-f:]+$/i.test(hostText) ? `[${hostText}]` : hostText;
  // A host is not a URL: reject port/path/userinfo/query fragments before adding the discovered port.
  if (!/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])$/i.test(cleanHost)) {
    return { reachable: false, state: "unreachable", port, daemonUrl: null, kernel, rigs,
      message: "OpenRig returned an invalid daemon host; daemon.host must be a hostname or IP address, without a port or path." };
  }
  const msg = typeof d.message === "string" && d.message
    ? d.message
    : (typeof d.reason === "string" && d.reason ? d.reason : null);
  if (reachable && port !== null) {
    return {
      reachable: true,
      state,
      port,
      daemonUrl: `http://${cleanHost}:${port}`,
      kernel,
      rigs,
      message: msg,
    };
  }
  const startable = state === "stopped" || state === "stale";
  return {
    reachable: false,
    state,
    port,
    daemonUrl: null,
    kernel,
    rigs,
    message: msg
      ? msg
      : startable
        ? `OpenRig isn't reachable: ${statusWord(state, "daemon")}. Run 'rig daemon start' or 'rig up'.`
        : state === "unknown" ? "OpenRig isn't reachable; its state wasn't reported. Run 'rig status' to inspect."
        : `OpenRig isn't reachable: ${statusWord(state, "daemon")}. Run 'rig status' to inspect.`,
  };
}

function isEnoentExecResult(res, err = null) {
  if (err && (err.code === "ENOENT" || /\benoent\b|not found|no such file/i.test(String(err.message ?? err)))) return true;
  if (!res || typeof res !== "object") return false;
  if (res.enoent === true || res.code === 127 || res.error?.code === "ENOENT") return true;
  if (res.code !== 0 && res.code !== undefined) {
    const combined = `${res.stderr ?? ""}\n${res.stdout ?? ""}\n${res.error ?? ""}`;
    if (/\benoent\b|command not found|not found:\s*rig|no such file or directory/i.test(combined)) return true;
  }
  return false;
}

/**
 * Discover the live OpenRig daemon via `rig status --json` (and `rig config get daemon.host --json`) through the host `exec` function.
 * Never reads `daemon.json` or `<openrigHome>/config.json`, and never defaults to `:7433`.
 */
export async function discoverDaemonFromCli(config, execFn, { timeoutKind = "read" } = {}) {
  // No OpenRig home of its own: nothing runs, and the real cause is named (not "the daemon isn't running").
  const refused = cliRefusal(config);
  if (refused) return { reachable: false, state: "unreachable", homeNeeded: true, port: null, daemonUrl: null, kernel: null, rigs: null, message: refused };
  if (typeof execFn !== "function") {
    return {
      reachable: false,
      state: "unreachable",
      port: null,
      daemonUrl: null,
      kernel: null,
      rigs: null,
      message: config?.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up').",
    };
  }
  const baseConfig = { ...(config ?? {}), daemonUrl: null, daemonUrlSource: "default" };
  const cmd = readCommand(baseConfig, ["status", "--json"]);
  try {
    const res = await execFn(cmd.command, cmd.args);
    if (isEnoentExecResult(res)) {
      return {
        reachable: false,
        state: "not_installed",
        enoent: true,
        port: null,
        daemonUrl: null,
        kernel: null,
        rigs: null,
        message: STATE_COPY.S1.headline,
      };
    }
    if (res && typeof res.stdout === "string" && res.stdout.trim()) {
      let parsed = null;
      try { parsed = JSON.parse(res.stdout); } catch { parsed = null; }
      if (parsed && typeof parsed === "object" && parsed.daemon) {
        let host = "127.0.0.1";
        if (parsed.daemon.reachable === true && parsed.daemon.port) {
          try {
            const hostCmd = readCommand(baseConfig, ["config", "get", "daemon.host", "--json"]);
            const hostRes = await execFn(hostCmd.command, hostCmd.args);
            if (hostRes && hostRes.code === 0 && typeof hostRes.stdout === "string" && hostRes.stdout.trim()) {
              host = parseDaemonHostJson(hostRes.stdout);
            }
          } catch (hostError) {
            if (hostError?.code === "GATE_REFUSED") throw hostError; // the settings changed: not a reason to assume 127.0.0.1
            host = "127.0.0.1";
          }
        }
        return parseDaemonStatusJson(res.stdout, host);
      }
    }
    const stderrMsg = typeof res?.stderr === "string" ? res.stderr.trim() : "";
    const stdoutMsg = typeof res?.stdout === "string" ? res.stdout.trim() : "";
    const firstLine = (stderrMsg || stdoutMsg).split("\n").map((l) => l.trim()).find(Boolean) || "";
    if (res && res.code !== undefined && res.code !== 0) {
      return {
        reachable: false,
        state: "cli_failed",
        cliFailed: true,
        port: null,
        daemonUrl: null,
        kernel: null,
        rigs: null,
        detail: firstLine || rigStoppedBare(res.code),
        message: firstLine || rigStoppedBare(res.code),
      };
    }
    return {
      reachable: false,
      state: "unreachable",
      port: null,
      daemonUrl: null,
      kernel: null,
      rigs: null,
      message: firstLine || config?.daemonMessage || "OpenRig daemon is not running (run 'rig daemon start' or 'rig up').",
    };
  } catch (err) {
    if (err?.code === "GATE_REFUSED") throw err; // "settings changed" or a refused list is not "the daemon is unreachable": the caller says what it is
    if (isEnoentExecResult(null, err)) {
      return {
        reachable: false,
        state: "not_installed",
        enoent: true,
        port: null,
        daemonUrl: null,
        kernel: null,
        rigs: null,
        message: STATE_COPY.S1.headline,
      };
    }
    const msg = plainExecError(err, { machine: config?.daemonMachine, kind: timeoutKind }).split("\n")[0];
    return {
      reachable: false,
      state: "cli_failed",
      cliFailed: true,
      port: null,
      daemonUrl: null,
      kernel: null,
      rigs: null,
      detail: msg,
      message: msg,
    };
  }
}

/**
 * Pure state selector for the seven sidebar states (`S0`–`S7`) and four `S5` sub-states (`5a`–`5d`).
 */
export function selectSidebarState({
  versionProbe = null,
  statusProbe = null,
  healthzProbe = null,
  summary = null,
  kernelStatus = null,
  kernelNodes = null,
  capabilities = null,
  sidebarModId = MOD_IDS.sidebar,
  strictKernel = true,
} = {}) {
  if (!versionProbe && !statusProbe && !healthzProbe && !summary && !kernelStatus) {
    return { id: "S0", substate: null, headline: STATE_COPY.S0.headline };
  }
  if (versionProbe) {
    if (versionProbe.enoent === true || versionProbe.installed === false || isEnoentExecResult(versionProbe)) {
      return {
        id: "S1",
        substate: null,
        headline: STATE_COPY.S1.headline,
        detail: STATE_COPY.S1.detail,
        copyText: s1CopyLine(sidebarModId),
        actionLabel: STATE_COPY.S1.actionLabel,
      };
    }
    if ((versionProbe.code !== undefined && versionProbe.code !== 0) || versionProbe.cliFailed === true || versionProbe.error) {
      const detail = String(versionProbe.detail ?? versionProbe.stderr ?? versionProbe.stdout ?? versionProbe.error ?? "")
        .split("\n").map((l) => l.trim()).find(Boolean) || "OpenRig's command stopped without saying why.";
      return {
        id: "S7",
        substate: null,
        headline: STATE_COPY.S7.headline,
        detail,
      };
    }
  }
  if (statusProbe) {
    if (statusProbe.enoent === true || statusProbe.state === "not_installed") {
      return {
        id: "S1",
        substate: null,
        headline: STATE_COPY.S1.headline,
        detail: STATE_COPY.S1.detail,
        copyText: s1CopyLine(sidebarModId),
        actionLabel: STATE_COPY.S1.actionLabel,
      };
    }
    if (statusProbe.cliFailed === true || statusProbe.state === "cli_failed") {
      return {
        id: "S7",
        substate: null,
        headline: STATE_COPY.S7.headline,
        detail: statusProbe.detail || statusProbe.message || "rig status failed",
      };
    }
    if (statusProbe.state === "stopped" || statusProbe.state === "stale") {
      return {
        id: "S2",
        substate: null,
        headline: STATE_COPY.S2.headline,
        detail: STATE_COPY.S2.detail,
        actionLabel: STATE_COPY.S2.actionLabel,
        command: STATE_COPY.S2.command,
      };
    }
    if (
      statusProbe.state === "unreachable" ||
      statusProbe.state === "unhealthy" ||
      statusProbe.state === "unverified" ||
      statusProbe.reachable === false
    ) {
      return {
        id: "S3",
        substate: null,
        headline: STATE_COPY.S3.headline,
        detail: statusProbe.message || null,
      };
    }
  }
  if (healthzProbe && healthzProbe.ok === false) {
    return {
      id: "S3",
      substate: null,
      headline: STATE_COPY.S3.headline,
      detail: healthzProbe.message || statusProbe?.message || null,
    };
  }

  const k = kernelStatus ?? statusProbe?.kernel ?? null;
  const kState = typeof k?.state === "string"
    ? k.state
    : (typeof k?.kernel_state === "string" ? k.kernel_state : null);

  if (kState === "booting") {
    return {
      id: "S5",
      substate: "5a",
      headline: STATE_COPY["5a"].headline,
      actionLabel: null,
      copyText: null,
    };
  }
  if (kState === "skipped") {
    return {
      id: "S5",
      substate: "5b",
      headline: STATE_COPY["5b"].headline,
      actionLabel: STATE_COPY["5b"].actionLabel,
      copyText: STATE_COPY["5b"].copyText,
    };
  }
  if (kState === "auth_blocked") {
    return {
      id: "S5",
      substate: "5c",
      headline: STATE_COPY["5c"].headline,
      actionLabel: STATE_COPY["5c"].actionLabel,
      copyText: STATE_COPY["5c"].copyText,
    };
  }
  if (kState === "bootstrap_failed" || kState === "degraded" || kState === "spec_missing") {
    return {
      id: "S5",
      substate: "5d",
      headline: STATE_COPY["5d"].headline,
      stateWord: kState,
      actionLabel: STATE_COPY["5d"].actionLabel,
      copyText: STATE_COPY["5d"].copyText,
    };
  }

  const summaryList = Array.isArray(summary) ? summary : (Array.isArray(statusProbe?.rigs) ? statusProbe.rigs : null);
  const kernelRig = Array.isArray(summaryList)
    ? summaryList.find((r) => r && !r.archivedAt && (r.name === "kernel" || (k?.rigId && r.id === k.rigId)))
    : null;

  if (Array.isArray(summaryList) && !kernelRig && strictKernel) {
    return {
      id: "S5",
      substate: "5b",
      headline: STATE_COPY["5b"].headline,
      actionLabel: STATE_COPY["5b"].actionLabel,
      copyText: STATE_COPY["5b"].copyText,
    };
  }

  const nodes = Array.isArray(kernelNodes) ? kernelNodes : (Array.isArray(k?.nodes) ? k.nodes : null);
  let operatorNode = null;
  if (Array.isArray(nodes)) {
    operatorNode = nodes.find((n) => n && (n.logicalId === "operator.agent" || String(n.canonicalSessionName ?? "").startsWith("operator-agent@"))) ?? null;
    if (!operatorNode) {
      return {
        id: "S5",
        substate: "5d",
        headline: STATE_COPY["5d"].headline,
        stateWord: kState && kState !== "ready" && kState !== "running" ? kState : "stopped",
        actionLabel: STATE_COPY["5d"].actionLabel,
        copyText: STATE_COPY["5d"].copyText,
      };
    }
    const opRunning = (
      operatorNode.sessionStatus === "running" ||
      operatorNode.sessionStatus === "ready" ||
      (operatorNode.sessionStatus === undefined && operatorNode.sessionAlive !== false)
    ) && operatorNode.sessionAlive !== false && operatorNode.startupStatus !== "failed";
    if (!opRunning) {
      const stateWord = operatorNode.startupStatus === "failed"
        ? "failed"
        : (operatorNode.sessionStatus && operatorNode.sessionStatus !== "running" && operatorNode.sessionStatus !== "ready"
            ? operatorNode.sessionStatus
            : "stopped");
      return {
        id: "S5",
        substate: "5d",
        headline: STATE_COPY["5d"].headline,
        stateWord,
        actionLabel: STATE_COPY["5d"].actionLabel,
        copyText: STATE_COPY["5d"].copyText,
      };
    }
  } else if (kernelRig && (kernelRig.lifecycleState === "stopped" || kernelRig.hasLiveAgents === false)) {
    return {
      id: "S5",
      substate: "5d",
      headline: STATE_COPY["5d"].headline,
      stateWord: kernelRig.lifecycleState || "stopped",
      actionLabel: STATE_COPY["5d"].actionLabel,
      copyText: STATE_COPY["5d"].copyText,
    };
  }

  const nonKernelRigs = Array.isArray(summaryList)
    ? summaryList.filter((r) => r && !r.archivedAt && r.name !== "kernel")
    : [];
  const s6 = Boolean(
    capabilities &&
    typeof capabilities === "object" &&
    capabilities.probed !== false &&
    Object.keys(DEFAULT_CAPABILITIES).some((key) => capabilities[key] === false)
  );
  return {
    id: "S4",
    substate: null,
    headline: null,
    hasOperator: true,
    operatorNode,
    noRigs: Array.isArray(summaryList) && nonKernelRigs.length === 0,
    noRigsText: STATE_COPY.S4.noRigsText,
    actionLabel: STATE_COPY.S4.actionLabel,
    s6,
    suggestedUpgrade: s6 ? SUGGESTED_UPGRADE_LINE : null,
  };
}

/**
 * Format the `OpenRig Version` row on `System → Connections`:
 * `OpenRig <semver> (<commit7>)` from `/healthz`, plus ` · CLI <cliVersion>` when they differ.
 */
export function formatOpenRigVersionLine({ healthz = null, cliVersion = null } = {}) {
  const ov = healthz?.openrigVersion && typeof healthz.openrigVersion === "object"
    ? healthz.openrigVersion
    : (healthz && typeof healthz === "object" && typeof healthz.semver === "string" ? healthz : null);
  const semver = typeof ov?.semver === "string" && ov.semver.trim() ? ov.semver.trim() : null;
  const commit = typeof ov?.commit === "string" && ov.commit.trim() && ov.commit.trim() !== "unknown"
    ? ov.commit.trim().slice(0, 7)
    : null;
  const cleanCli = typeof cliVersion === "string" && cliVersion.trim()
    ? cliVersion.trim().replace(/^rig\s+/i, "").trim()
    : null;
  if (semver) {
    const base = commit ? `OpenRig ${semver} (${commit})` : `OpenRig ${semver}`;
    return cleanCli && cleanCli !== semver ? `${base} · CLI ${cleanCli}` : base;
  }
  if (cleanCli) return `OpenRig ${cleanCli}`;
  return "unknown";
}

/**
 * Run the public detection probes (`rig --version`, `rig status --json`, `rig config get daemon.host --json`,
 * `GET /healthz`) and return `{ cliVersion, versionProbe, statusProbe, healthzProbe, daemonUrl, state }`.
 */
export async function probeOpenRigState(config, { exec, fetch: fetchFn, sidebarModId = MOD_IDS.sidebar } = {}) {
  // A connection that has no OpenRig home of its own runs no CLI: say so, never "OpenRig isn't installed".
  const refused = cliRefusal(config);
  if (refused) return { cliVersion: null, versionProbe: null, statusProbe: null, healthzProbe: null, daemonUrl: null, state: { id: "S3", substate: null, headline: STATE_COPY.S3.headline, detail: refused } };
  const baseConfig = { ...(config ?? {}), daemonUrl: null, daemonUrlSource: "default" };
  let versionProbe = null;
  let cliVersion = null;
  if (typeof exec === "function") {
    const verCmd = readCommand(baseConfig, ["--version"]);
    try {
      const res = await exec(verCmd.command, verCmd.args);
      if (isEnoentExecResult(res)) {
        versionProbe = { enoent: true, installed: false, code: res?.code ?? 127, stderr: res?.stderr ?? "" };
      } else if (res && res.code !== undefined && res.code !== 0) {
        const firstLine = `${res.stderr ?? ""}\n${res.stdout ?? ""}`.split("\n").map((l) => l.trim()).find(Boolean) || rigStoppedBare(res.code);
        versionProbe = { installed: true, cliFailed: true, code: res.code, detail: firstLine, stderr: res.stderr ?? "", stdout: res.stdout ?? "" };
      } else {
        const rawVer = String(res?.stdout ?? "").trim().split("\n")[0]?.replace(/^rig\s+/i, "").trim() || null;
        // When a fake exec in unit tests returns `{ stdout: "{}" }`, treat `rig` as installed without a synthetic "{}" version string.
        cliVersion = rawVer && rawVer !== "{}" ? rawVer : null;
        versionProbe = { installed: true, code: 0, cliVersion };
      }
    } catch (err) {
      if (err?.code === "GATE_REFUSED") throw err; // not "the rig command failed"
      if (isEnoentExecResult(null, err)) {
        versionProbe = { enoent: true, installed: false, code: 127, error: String(err?.message ?? err) };
      } else {
        const detail = String(err?.message ?? err ?? "rig --version failed").split("\n")[0];
        versionProbe = { installed: true, cliFailed: true, code: 1, detail, error: detail };
      }
    }
  }
  if (versionProbe && (versionProbe.enoent || versionProbe.cliFailed)) {
    const state = selectSidebarState({ versionProbe, sidebarModId });
    return { cliVersion: null, versionProbe, statusProbe: null, healthzProbe: null, daemonUrl: null, state };
  }

  const statusProbe = await discoverDaemonFromCli(config, exec);
  if (!statusProbe.reachable || !statusProbe.daemonUrl) {
    const state = selectSidebarState({ versionProbe, statusProbe, sidebarModId });
    return { cliVersion, versionProbe, statusProbe, healthzProbe: null, daemonUrl: null, state };
  }

  const daemonUrl = config?.daemonUrl && config?.daemonUrlSource !== "cli" && config?.daemonUrlSource !== "default"
    ? config.daemonUrl
    : statusProbe.daemonUrl;
  let healthzProbe = null;
  if (typeof fetchFn === "function" && daemonUrl) {
    try {
      const hr = await fetchFn(`${daemonUrl}/healthz`);
      if (hr.ok) {
        const data = await hr.json().catch(rethrowGate({ ok: true })); // a gate refusal while the body is read is not a healthy probe
        healthzProbe = { ok: data?.ok !== false, status: hr.status, data };
      } else if (hr.status !== 404) {
        healthzProbe = { ok: false, status: hr.status, message: `OpenRig answered its health check with error ${hr.status}.` };
      }
    } catch (err) {
      if (err?.code === "GATE_REFUSED") throw err; // a settings change is not an unhealthy daemon
      healthzProbe = { ok: false, message: String(err?.message ?? err ?? "OpenRig daemon did not answer /healthz.") };
    }
  }
  const state = selectSidebarState({ versionProbe, statusProbe, healthzProbe, sidebarModId });
  return { cliVersion, versionProbe, statusProbe, healthzProbe, daemonUrl, state };
}

export const LOCAL_COMMANDS = [
  { line: "focus-sidebar", label: "OpenRig: Focus sidebar", hint: "Select the first sidebar row" },
  { line: "all-seats", label: "OpenRig: All seats", hint: "Seats across every rig", navigation: true },
  { line: "operator", hint: "Open the operator in a tab" },
  { line: "open-page", hint: "Open in Page tab" },
  { line: "open-tui", hint: "Open Rig TUI tab" },
  { line: "tui", hint: "Open or switch to the Rig TUI" },
  { line: "notifications", hint: "Toggle Needs-You desktop notifications (on/off)" },
  { line: "notifications on", hint: "Enable Needs-You desktop notifications" },
  { line: "notifications off", hint: "Disable Needs-You desktop notifications" },
  { line: "usage-hosts", hint: "Per-host usage on System" },
  { line: "projects", hint: "Switch project on Scopes" },
  { line: "project", hint: "Select a project on Scopes (project <id>)" },
  { line: "overview", hint: "Expand and focus a rig block on Topology" },
  { line: "recent", hint: "Recent queue transitions on Topology or System" },
  { line: "recent instance", hint: "Recent queue transitions across the daemon" },
  { line: "pulse", hint: "Focus the pulse status strip on Topology" },
  { line: "expand-all", hint: "Expand all branches in the OpenRig sidebar tree" },
  { line: "collapse-all", hint: "Collapse branches in the OpenRig sidebar tree (keeps Needs visible)" },
  { line: "change-model", hint: "Switch a seat's harness, model, or effort via the lead (change-model <seat>)" },
  { line: "people", hint: "People, quiet hours, and modes on System" },
  { line: "spaces-list", hint: "Choose Herdr's, herdrig's or both Spaces lists (System → Layout)" },
];

/** Two configs that read the same (a re-read that changed nothing changes nothing). */
export function sameConfig(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }

/**
 * Marks the cached reads whose path matches as stale, keeping their data, so the next read refetches in the background
 * while the page still draws what it had. Deleting them instead made every view draw its loading skeleton for a frame:
 * the Rig page flashed, jumped to the top and dropped a focused text box on every activity event.
 */
export function markStale(cache, matches) {
  for (const path of Object.keys(cache)) if (matches(path)) cache[path] = { ...cache[path], stale: true };
  return cache;
}

/**
 * A cached read's next entry once its fetch settles. A good answer replaces everything. A failure keeps the last good
 * answer drawn and carries the error beside it (`error`, `errorAt`), so a network blip says so in a note instead of
 * swapping the page for an error card; with nothing read yet, the error is the whole entry. The sidebar's `list` does
 * the same.
 */
export function settleRead(prev, outcome, now = Date.now()) {
  if (outcome.ok) return { data: outcome.data, status: outcome.status, at: now };
  const failure = { error: outcome.error, ...(outcome.status !== undefined ? { status: outcome.status } : {}),
    ...(outcome.errorData !== undefined ? { errorData: outcome.errorData } : {}) };
  if (prev?.data === undefined) return { ...failure, at: now };
  return { data: prev.data, at: prev.at, ...failure, errorAt: now };
}

/** Honest age label for a cached entry kept after a failed refresh (`"last updated N s ago"`). */
export function formatStaleAge(at, now = Date.now()) {
  if (!Number.isFinite(at)) return "refresh failed";
  const sec = Math.max(0, Math.round((now - at) / 1000));
  if (sec < 60) return `last updated ${sec} s ago`;
  if (sec < 3600) return `last updated ${Math.floor(sec / 60)}m ago`;
  return `last updated ${Math.floor(sec / 3600)}h ago`;
}

/** Whether two configs name the same OpenRig for address discovery: the same connection, machine, OpenRig home and `rig` command (the gate's own identity, minus the address that is being discovered). */
const sameDiscoveryIdentity = (a, b) => (a?.connectionId ?? null) === (b?.connectionId ?? null) && (a?.daemonMachine ?? null) === (b?.daemonMachine ?? null)
  && (a?.openrigHome ?? null) === (b?.openrigHome ?? null) && JSON.stringify(a?.rig ?? null) === JSON.stringify(b?.rig ?? null);

/**
 * When `<appHome>/openrig/config.json` is absent or has no explicit `daemonUrl`, a config reload
 * (`parseConfig(...)` -> `{ daemonUrl: null, ... }`) must preserve a CLI-discovered `daemonUrl`
 * (`daemonUrlSource === "cli"`), so the 1 s/5 s reload timer does not close SSE or wipe the cache.
 */
export function preserveCliDiscoveredConfig(next, prev) {
  if (!next || !prev) return next;
  if (next.configInvalid) return next; // a refused list has no address, not even one the CLI found earlier
  // The found address belongs to the OpenRig it was found for: a changed home, machine, `rig` command or connection is another one, and the new config rediscovers its own.
  if (!sameDiscoveryIdentity(next, prev)) return next;
  if (!next.daemonUrl && prev.daemonUrlSource === "cli" && prev.daemonUrl) {
    const merged = {
      ...next,
      daemonUrl: prev.daemonUrl,
      daemonUrlSource: "cli",
      ...(prev.daemonState !== undefined ? { daemonState: prev.daemonState } : {}),
    };
    if (prev.daemonMessage !== undefined) merged.daemonMessage = prev.daemonMessage;
    else delete merged.daemonMessage;
    return merged;
  }
  return next;
}

/**
 * What every command's environment drops (a seat's identity, database, and `OPENRIG_URL` herdr-app may have inherited)
 * and sets (`OPENRIG_URL` is exported ONLY when `daemonUrl` was explicitly configured in `config.json`).
 */
/** What other mods published in the shared `rig.data` (rows, nodes, needs, versions), as a reader may RENDER or SUGGEST it. A refused connections list
 *  has none: whatever a sidebar published before the list was added is stale, and the sidebar replaces it only when its own refresh runs. Every
 *  reader of the shared rows goes through this (`undefined` reads like a sidebar that has published nothing). */
/** `rig.data` (every connection's rigs, seats, roster and attention) is large, and native herdr copies a shared value into a mod on every read.
 *  The sidebar, its only writer, publishes it through `publishRigData`: the data, then a new `rig.dataStamp`. A reader that keeps a copy may
 *  reuse it while the stamp is the same (the data is written first, so a new stamp never comes with old data). */
export const RIG_DATA_STAMP = "rig.dataStamp";
export function publishRigData(setSharedFn, value) {
  setSharedFn("rig.data", value);
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  setSharedFn(RIG_DATA_STAMP, stamp);
  return stamp;
}
export function sharedRigData(config, shared) {
  // No config yet (a mod's first moments, before it has read config.json) cannot rule a refused list out, so it reads nothing either.
  if (!config || config.configInvalid) return undefined;
  const published = shared("rig.data");
  return published && !publishedUnder(config, published) ? undefined : published; // rows published under other settings are not this reader's (it falls back to its own reads)
}
/** Why the CLI must not run for this config, or null. A connection other than the legacy one authenticates from its OpenRig home alone (the
 *  inherited home and bearer variables are unset), so without a home of its own the CLI would fall back to the default home (~/.openrig)
 *  and send that home's terminal token to whatever address the connection names. Every command, a read as much as a write, is refused. */
/** Said for a rig CLI run on a connection over Herdr's connection that the helper's rig verb doesn't carry (terminal views, specs add, CLI reads). */
export const HERDR_CLI_NOT_YET = "This isn't available over Herdr's connection yet. Nothing was sent.";
export function cliRefusal(config) {
  if (config?.configInvalid) return config.configInvalid; // a refused connections list: nothing of OpenRig's runs
  // Over Herdr's connection the CLI never runs here: the gate hands its argv to the helper's rig verb on the machine (or refuses it plainly), and
  // the machine's own OpenRig home applies, so no home on this computer is needed.
  if (typeof config?.daemonUrl === "string" && config.daemonUrl.startsWith("herdr://")) return null;
  return config?.connectionId && config.connectionId !== LEGACY_CONNECTION_ID && !config.openrigHome ? HOME_NEEDED : null;
}
/** A command that runs nothing of OpenRig's and fails (`false`: no shell, no output). The words for the person are `cliRefusal`'s, shown by the
 *  callers that report to the person (the state probe, spec Add); every other caller treats it as a command that failed. */
const refusedCommand = () => ({ command: "false", args: [] });

export function cliEnv(config) {
  const hasExplicitUrl = Boolean(config?.daemonUrl && config?.daemonUrlSource !== "cli" && config?.daemonUrlSource !== "default");
  const isolated = Boolean(config?.connectionId && config.connectionId !== LEGACY_CONNECTION_ID);
  // RIGGED_* are the legacy names the CLI still reads for the same things. A seat's node id goes too: with it, `rig tui`
  // asks the daemon about that seat's permissions and exits when herdr-app inherited it from a seat.
  // OpenRig can recover a sender from a bound tmux pane when no session env remains.
  return ["-u", "TMUX_PANE", "-u", "OPENRIG_SESSION_NAME", "-u", "RIGGED_SESSION_NAME", "-u", "OPENRIG_NODE_ID", "-u", "RIGGED_NODE_ID",
    "-u", "OPENRIG_ACTIVITY_HOOK_TOKEN", "-u", "RIGGED_ACTIVITY_HOOK_TOKEN", "-u", "OPENRIG_OCCUPANT_GENERATION",
    "-u", "OPENRIG_DB", "-u", "RIGGED_DB", "-u", "OPENRIG_URL",
    "-u", "OPENRIG_HOST", "-u", "OPENRIG_PORT", "-u", "RIGGED_URL", "-u", "RIGGED_HOST", "-u", "RIGGED_PORT",
    // An unpinned legacy connection can still discover its home using either convention.
    ...(isolated || config?.openrigHome ? ["-u", "RIGGED_HOME"] : []),
    // Another connection never inherits a credential: the CLI sends the home's terminal token (and these bearer variables) to whatever
    // OPENRIG_URL names.
    ...(isolated ? ["-u", "OPENRIG_HOME", "-u", "OPENRIG_TERMINAL_BEARER_TOKEN", "-u", "OPENRIG_AUTH_BEARER_TOKEN"] : []),
    ...(hasExplicitUrl ? [`OPENRIG_URL=${config.daemonUrl}`] : []),
    ...(config?.openrigHome ? [`OPENRIG_HOME=${config.openrigHome}`] : []),
    // Defence in depth for anything that builds an environment from such a config without going through the builders below: a path beneath
    // a file, where no home can be read or created, so the CLI cannot fall back to ~/.openrig.
    ...(cliRefusal(config) ? ["OPENRIG_HOME=/dev/null/openrig-home-needed"] : [])];
}

/**
 * Whether a CLI write requires `config.person`.
 * Send (`send`), Queue (`queue create`), Change model (`queue create`), Specs add (`specs add`),
 * and People quiet/mode writes (`gateway human quiet|mode`) attribute an actor in OpenRig and require `person`.
 * Replies/decisions (`POST /api/mission-control/action`) do not go through the CLI and work with or without `person`.
 * Snapshot (`snapshot`), Pause (`down`), Resume (`up --existing`), Fresh (`seat launch --fresh`),
 * Open view / Follow / Prune / Close (`terminal open | close | keyboard`), and Start OpenRig (`daemon start`)
 * do not attribute an actor and are allowed without `person`.
 */
const typingGuardWords = new Map([
  ["off", "Off"],
  ["draft-aware", "Protect drafts"],
  ["openrig-urgent", "OpenRig and urgent messages"],
  ["urgent-only", "Urgent messages only"],
  ["sends-only", "Direct messages only"],
  ["queue-only", "Quiet while I type"],
  ["hold", "Hold all messages and notices"],
]);

/** Released guards store interruption levels over coarse hold, not in a `mode` field. */
export function typingGuardState(value) {
  if (!value || typeof value !== "object" || !["off","draft-aware","hold"].includes(value.desiredMode) || !["off","draft-aware","hold"].includes(value.effectiveMode)) return null;
  const level = value.effectiveLevel ?? value.desiredLevel ?? value.effectiveMode ?? value.desiredMode;
  return { word: typingGuardWords.get(level) ?? "Unrecognized setting",
    checked: value.desiredLevel === "queue-only" && value.effectiveLevel === "queue-only" && !value.pending,
    pending: value.pending === true, heldCount: Number.isSafeInteger(value.heldCount) && value.heldCount > 0 ? value.heldCount : 0,
    treatedAsHold: value.desiredMode === "hold" && !value.desiredLevel };
}

export function heldMessageText(value, limit = 65536, {body=false,maxLines=400} = {}) {
  const raw=String(value??"");
  const clean = body ? raw.replace(/\r\n?|[\u2028\u2029]/g,"\n").replace(/\t/g," ").replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "").replace(/\n(?: *\n){3,}/g,"\n\n\n")
    : raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "");
  let text = "", bytes = 0, lines = 1;
  for (const char of clean) {
    if(body&&char==='\n'&&lines>=maxLines)return{text,truncated:true,lineLimit:true};
    const point = char.codePointAt(0);
    if (point >= 0xd800 && point <= 0xdfff) continue;
    const width = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
    if (bytes + width > limit) return { text, truncated: true };
    bytes += width; text += char;if(char==='\n')lines++;
  }
  return { text, truncated: false };
}

export function heldMessagePage(total, shown = 0) {
  const remaining = Math.max(0, (Number.isSafeInteger(total) ? total : 0) - shown);
  const limit = Math.min(20, remaining);
  return { offset: Math.max(0, remaining - limit), limit };
}

/** Deliberately unattributed: unlike a send, a preference must never impersonate an inherited seat or the person. */
export function typingGuardCommand(config, seat, mode) {
  if (!config || config.configInvalid || !["off", "queue-only"].includes(mode) || !isValidSessionName(seat) || String(config?.daemonUrl ?? "").startsWith("herdr://")) return null;
  return writeCommand({ ...config, person: null }, ["seat", "set-typing-guard", "--mode", mode, "--reason",
    mode === "queue-only" ? "Quiet while typing (set from Herdrig)" : "Quiet while typing turned off (set from Herdrig)", "--", seat]);
}

export function requiresPersonForWrite(args = []) {
  const first = String(args?.[0] ?? "");
  const second = String(args?.[1] ?? "");
  return first === "send" || first === "queue" || first === "specs" || (first === "gateway" && second === "human");
}

/** Return `NO_PERSON` when `action` requires `config.person` and none is configured, else `null`. */
export function personDisableReason(action, config) {
  if (config?.person) return null;
  const a = String(action ?? "");
  if (
    a === "send" ||
    a === "queue" ||
    a === "change-model" ||
    a === "specs-add" ||
    a === "people" ||
    a === "spaces-list" ||
    a === "quiet" ||
    a === "mode"
  ) {
    return NO_PERSON;
  }
  return null;
}

/** The CLI options the mods pass that take a value: the token after one is its value, never an option of its own. */
const VALUE_OPTIONS = new Set(["--actor", "--app-home", "--availability", "--body", "--cell", "--cwd", "--daily", "--decision-room",
  "--destination", "--expected-back", "--expected-plan", "--grid", "--host", "--label", "--name", "--provider", "--prune-after",
  "--quiet", "--reason", "--replace", "--rig", "--save", "--summary", "--until"]);

/**
 * The command a write runs: the CLI against the mods' daemon and OpenRig home. A seat's identity and
 * database inherited by herdr-app are removed first, so nothing is attributed to a managed seat.
 * Identity-attributing writes (`send`, `queue`, `specs`, `gateway human`) return `null` without `config.person`; lifecycle and view
 * writes (`down`, `up`, `seat launch`, `snapshot`, `terminal`) run without `OPENRIG_SESSION_NAME`.
 * `gateway human` writes never set `OPENRIG_SESSION_NAME` (which would stamp `X-OpenRig-Session` as transport:v1);
 * instead they pass `--actor <person>@external` with both `OPENRIG_SESSION_NAME` and `RIGGED_SESSION_NAME` unset by `cliEnv`.
 */
export function writeCommand(config, args, { env = [] } = {}) {
  const refused = cliRefusal(config);
  if (refused) return refusedCommand();
  if (!Array.isArray(args)) return null;
  const hasPerson = Boolean(config?.person);
  if (!hasPerson && requiresPersonForWrite(args)) return null;
  const isGatewayHuman = args?.[0] === "gateway" && args?.[1] === "human";
  const baseArgs = isGatewayHuman && hasPerson && !args.includes("--actor")
    ? [...args, "--actor", config.person]
    : args;
  // --json goes before a `--` (everything after it is an argument: `rig up … -- <spec> --json` is refused), and only to
  // a command that has it: `rig snapshot` prints words and refuses --json.
  const end = baseArgs.indexOf("--");
  const withJson = baseArgs.includes("--json") || NO_JSON.has(baseArgs[0]) ? baseArgs : end < 0 ? [...baseArgs, "--json"] : [...baseArgs.slice(0, end), "--json", ...baseArgs.slice(end)];
  // Pin this machine unless `--host` names another, so a saved remote `host.selected` in config.json never redirects a
  // local write such as Pause, Resume, Send or Fresh.
  // Only an option names a host: a `--host` after `--`, or as the value of another option (`--cell --host`), is an
  // argument, and leaves the pin in place.
  const optionArgs = end < 0 ? baseArgs : baseArgs.slice(0, end);
  const namesHost = optionArgs.some((a, i) => a === "--host" && !VALUE_OPTIONS.has(optionArgs[i - 1]));
  const hostPin = namesHost || env.some((e) => e.startsWith("OPENRIG_HOST_SELECTED=")) ? [] : ["OPENRIG_HOST_SELECTED=local"];
  const personEnv = hasPerson && !isGatewayHuman ? [`OPENRIG_SESSION_NAME=${config.person}`] : [];
  return { command: "env", args: [...cliEnv(config), ...personEnv, ...hostPin, ...env, ...(config?.rig ?? ["rig"]), ...withJson] };
}

/**
 * Build a headerless CLI write command for `System -> People` (`rig gateway human quiet|mode ...`):
 * requires `config.person` (`<id>@external`), removes inherited seat identity, and passes `--actor <person>@external`.
 */
export function peopleCliCommand(config, subargs = [], { env = [] } = {}) {
  if (!config?.person || !/^[^@\s]+@external$/.test(String(config.person).trim())) return null;
  const list = Array.isArray(subargs) ? subargs.map(String) : [];
  if (!list.length) return null;
  return writeCommand(config, ["gateway", "human", ...list], { env });
}

/** The CLI commands the mods run that have no --json. */
export const NO_JSON = new Set(["snapshot"]);

/**
 * The actions that need no input or confirmation: they run at once, report in a status line or
 * a toast, and open the result dialog only when they fail. Pause, Resume, Relaunch fresh, Send, Queue, Reply and
 * Launch keep their dialogs.
 */
/** The actions whose CLI command carries `--app-home <this computer's app home>` for OpenRig's herdr-app provider (see actionArgs). */
export const PROVIDER_HOME_ACTIONS = new Set(["open-view", "open-seat", "keyboard", "follow", "unfollow", "prune", "close-view", "close-cell", "open-designed-view"]);
/** A machine connection's provider worker views would need a window on that machine: said plainly, with nothing sent. */
export const machineWorkerViewsRefusal = (machine) => `Worker views for ${machine} aren't available from this computer yet. Nothing was sent.`;
/** A machine connection added through the connections list (not the legacy one, which keeps the released behaviour). */
export const listAddedMachine = (config) => Boolean(config?.daemonMachine) && (config.connectionId ?? LEGACY_CONNECTION_ID) !== LEGACY_CONNECTION_ID;
/** The one rule: this computer's app home never reaches a list-added machine's daemon. By action (the sidebar's dispatcher) ... */
export const providerHomeRefusal = (config, action) => listAddedMachine(config) && PROVIDER_HOME_ACTIONS.has(action) ? machineWorkerViewsRefusal(config.daemonMachine) : null;
/** ... and by the command itself (every runner's last check before exec: whatever built it, `--app-home` to such a daemon is refused). */
export const appHomeArgsRefusal = (config, args) => Array.isArray(args) && args.includes("--app-home") && listAddedMachine(config) ? machineWorkerViewsRefusal(config.daemonMachine) : null;
export const ONE_CLICK = new Set(["snapshot", "unarchive-rig", "follow", "unfollow", "prune", "close-view", "keyboard", "open-view", "open-seat", "close-cell", "open-designed-view"]);

// ---- worker-view grids (designer and cell controls) ----------------------------------------------------------------
// A grid is `{ rows: [{ weight?, cells: [{ seat?, pad?, weight?, cellId? }] }] }`, the shape `rig terminal open --grid` takes.
// A cell's weight belongs to its slot: swapping or moving seats never changes the view's geometry. These helpers change the
// grid they are given and return it; callers pass a `cloneGrid` when they need the old one.

/** The weights the designer steps a cell or a row through. */
export const DESIGN_WEIGHTS = [1, 1.5, 2, 3];
const MAX_SIDE = 4;
const seatOf = (x) => (typeof x === "string" ? x : x?.seat ?? x?.session ?? null);
/** Normalize an input item (seat string, seat cell, or shell cell) into a grid cell object. */
function cellItemOf(x) {
  if (!x) return null;
  if (typeof x === "string") return { seat: x };
  if (x.kind === "shell") {
    return {
      kind: "shell",
      cellId: x.cellId ?? x.id ?? "shell-1",
      ...(x.label ? { label: x.label } : {}),
      ...(x.weight ? { weight: x.weight } : {}),
      ...(x.shell ? { shell: x.shell } : {}),
    };
  }
  const seat = seatOf(x);
  if (!seat) return null;
  return {
    seat,
    ...(x.cellId ? { cellId: x.cellId } : {}),
    ...(x.weight ? { weight: x.weight } : {}),
  };
}
const wrap = (cell, weight) => (weight === undefined || weight === null ? cell : { ...cell, weight });

export const cloneGrid = (grid) => JSON.parse(JSON.stringify(grid ?? { rows: [] }));
/** A shell pane cell (`kind === "shell"`). */
export const isShell = (cell) => Boolean(cell && cell.kind === "shell");
/** A cell that holds neither a seat nor a shell pane. */
export const isPad = (cell) => !cell || cell.pad === true || (!cell.seat && !isShell(cell));

/** The grid as `--grid` takes it: rows of { seat | kind:"shell" | pad, weight? }. */
export function exportGrid(grid) {
  return {
    rows: (grid?.rows ?? []).map((row) => ({
      ...(row.weight ? { weight: row.weight } : {}),
      cells: row.cells.map((c) => {
        if (isShell(c) && !c.pad) {
          return {
            kind: "shell",
            cellId: c.cellId ?? c.seat ?? "shell-1",
            ...(c.weight ? { weight: c.weight } : {}),
            ...(c.shell ? { shell: c.shell } : {}),
          };
        }
        return {
          ...(c.seat && !c.pad ? { seat: c.seat } : { pad: true }),
          ...(c.weight ? { weight: c.weight } : {}),
        };
      }),
    })),
  };
}

/**
 * Ragged row distribution for zero negative space:
 * - N = 3 -> `[1, 2]` (1 over 2, fuller row last)
 * - N = 5 -> `[2, 3]` (2 over 3, fuller row last)
 * - Other N -> rows of `cols` (`ceil(sqrt(N))` capped at 4) with the remainder row stretching full width (`7 -> [3, 3, 1]`, `8 -> [3, 3, 2]`).
 */
export function rowCounts(count, cols) {
  if (count <= 0) return [1];
  const n = Math.min(count, MAX_SIDE * MAX_SIDE);
  if (!cols) {
    if (n === 3) return [1, 2];
    if (n === 5) return [2, 3];
  }
  const c = Math.min(MAX_SIDE, Math.max(1, cols || Math.ceil(Math.sqrt(n))));
  const out = [];
  let rem = n;
  while (rem > 0 && out.length < MAX_SIDE) {
    const take = Math.min(c, rem);
    out.push(take);
    rem -= take;
  }
  return out;
}

/**
 * Seats (and/or shell cells) arranged with zero negative space:
 * short rows stretch to full width with zero `{ pad: true }` cells when `seats.length > 0`.
 */
export function autoGridForSeats(seats, cols) {
  const list = (seats ?? []).map(cellItemOf).filter(Boolean).slice(0, MAX_SIDE * MAX_SIDE);
  if (list.length === 0) {
    return { rows: [{ cells: [{ pad: true }] }] };
  }
  const counts = rowCounts(list.length, cols);
  let offset = 0;
  const rows = counts.map((count) => {
    const cells = list.slice(offset, offset + count).map((item) => ({ ...item }));
    offset += count;
    return { cells };
  });
  return { rows };
}

/** The designer's presets: auto, lead-2x2 (the lead seat double width, over two rows), wide-stack (one wide row over the rest), with zero pad cells. */
export function presetGrid(preset, seats) {
  const rawList = (seats ?? []).map(cellItemOf).filter(Boolean).slice(0, MAX_SIDE * MAX_SIDE);
  if (!rawList.length) return autoGridForSeats([]);
  const leadItem = rawList.find((x) => x.seat && /(?:^|[._-])lead(?:@|$)/i.test(x.seat)) ?? rawList[0];
  const list = leadItem ? [leadItem, ...rawList.filter((x) => x !== leadItem)] : [];
  const chunk = (items, w) => {
    const out = [];
    for (let i = 0; i < items.length; i += MAX_SIDE) {
      out.push({ cells: items.slice(i, i + MAX_SIDE).map((item) => ({ ...item, ...(w ? { weight: w } : {}) })) });
    }
    return out;
  };
  if (preset === "lead-2x2") {
    const [lead, ...rest] = list;
    const rows = [{ cells: [{ ...lead, weight: 2 }, ...rest.slice(0, 2).map((item) => ({ ...item, weight: 1 }))] }];
    if (rest.length > 2) {
      const r2 = rest.slice(2, 5);
      rows.push({ cells: [{ ...r2[0], weight: 2 }, ...r2.slice(1).map((item) => ({ ...item, weight: 1 }))] });
    }
    if (rest.length > 5) rows.push(...chunk(rest.slice(5), 0).slice(0, MAX_SIDE - 2));
    return { rows };
  }
  if (preset === "wide-stack" || preset === "1-stack") {
    const [first, ...rest] = list;
    const rows = [{ weight: 2, cells: [{ ...first, weight: 2 }] }];
    if (rest.length) rows.push(...chunk(rest, 0).slice(0, MAX_SIDE - 1));
    return { rows };
  }
  return autoGridForSeats(rawList);
}

/** Where a seat or shell cell (`cellId`) sits in the grid, as `{ r, c }`, or null. */
export function gridFind(grid, seatOrId) {
  if (!seatOrId) return null;
  const key = typeof seatOrId === "object" ? (seatOrId.cellId ?? seatOrId.seat) : seatOrId;
  if (!key) return null;
  for (const [r, row] of (grid?.rows ?? []).entries()) {
    for (const [c, cell] of (row.cells ?? []).entries()) {
      if (cell.seat === key || cell.cellId === key) return { r, c };
    }
  }
  return null;
}

/** The seats placed, in reading order. */
export const gridSeats = (grid) => (grid?.rows ?? []).flatMap((row) => (row.cells ?? []).map((c) => c.seat).filter(Boolean));
/** The shell panes placed in the grid, in reading order. */
export const gridShells = (grid) => (grid?.rows ?? []).flatMap((row) => (row.cells ?? []).filter((c) => isShell(c) && !c.pad));
/** Every non-pad pane in the grid (seat or shell), in reading order. */
export const gridPanes = (grid) => (grid?.rows ?? []).flatMap((row) => (row.cells ?? []).filter((c) => !isPad(c)));

/** True when `grid` has custom row counts or non-1 row/cell weights relative to `autoGridForSeats`. */
export function isCustomDesignerGrid(grid) {
  const rows = grid?.rows ?? [];
  if (!rows.length) return false;
  const panes = gridPanes(grid);
  if (!panes.length) return false;
  const hasWeights = rows.some((r) => (r.weight && r.weight !== 1) || (r.cells ?? []).some((c) => c.weight && c.weight !== 1));
  if (hasWeights) return true;
  const curCounts = rows.map((r) => (r.cells ?? []).filter((c) => !isPad(c)).length).filter((n) => n > 0);
  const autoCounts = rowCounts(panes.length);
  return curCounts.join(",") !== autoCounts.join(",");
}

/**
 * Reflow the designer grid when seats are checked/unchecked or shell panes are added/removed.
 * - Pane count = checked seats + shell panes; zero empty/pad cells when count > 0.
 * - When the grid has a custom multi-row layout or weights (`preserveRows` or `isCustomDesignerGrid(grid)`), removes unchecked
 *   cells in place (pruning empty rows) and appends newly checked seats or shells to the last row (< 4) or a new row,
 *   preserving the custom row structure and weights.
 * - Otherwise reflows via `autoGridForSeats`.
 */
export function reflowDesignerGrid(grid, checkedSeats, explicitShells = null, opts = {}) {
  const wantedSeats = new Set((checkedSeats ?? []).map(seatOf).filter(Boolean));
  const preserve = Boolean(opts?.preserveRows || isCustomDesignerGrid(grid));
  if (preserve && grid?.rows?.length) {
    const seenSeats = new Set();
    const wantedShells = Array.isArray(explicitShells)
      ? explicitShells.map((sh) => cellItemOf({ ...sh, kind: "shell" })).filter(Boolean)
      : null;
    const usedShellIdxs = new Set();
    const rows = [];
    for (const row of grid.rows) {
      const nextCells = [];
      for (const cell of row.cells ?? []) {
        if (isPad(cell)) continue;
        if (isShell(cell)) {
          if (wantedShells === null) {
            nextCells.push({ ...cell });
          } else {
            const idx = wantedShells.findIndex((sh, i) => !usedShellIdxs.has(i) && (sh.cellId === cell.cellId || (sh.label && sh.label === cell.label)));
            if (idx >= 0) {
              usedShellIdxs.add(idx);
              nextCells.push({ ...cell, ...wantedShells[idx], ...(cell.weight ? { weight: cell.weight } : {}) });
            }
          }
        } else if (cell.seat && wantedSeats.has(cell.seat) && !seenSeats.has(cell.seat)) {
          seenSeats.add(cell.seat);
          nextCells.push({ ...cell });
        }
      }
      if (nextCells.length > 0) {
        rows.push({ ...(row.weight ? { weight: row.weight } : {}), cells: nextCells });
      }
    }
    const appendItem = (item) => {
      const last = rows[rows.length - 1];
      if (last && last.cells.length < MAX_SIDE) {
        last.cells.push(item);
      } else if (rows.length < MAX_SIDE) {
        rows.push({ cells: [item] });
      } else {
        const openRow = rows.find((r) => r.cells.length < MAX_SIDE);
        if (openRow) openRow.cells.push(item);
      }
    };
    for (const seat of wantedSeats) {
      if (!seenSeats.has(seat)) {
        seenSeats.add(seat);
        appendItem({ seat });
      }
    }
    if (wantedShells) {
      for (const [i, sh] of wantedShells.entries()) {
        if (!usedShellIdxs.has(i)) appendItem(sh);
      }
    }
    return rows.length > 0 ? { rows } : autoGridForSeats([]);
  }
  const existingPanes = gridPanes(grid);
  const kept = [];
  const seenSeats = new Set();
  for (const cell of existingPanes) {
    if (isShell(cell)) {
      if (explicitShells === null) kept.push({ ...cell });
    } else if (cell.seat && wantedSeats.has(cell.seat) && !seenSeats.has(cell.seat)) {
      seenSeats.add(cell.seat);
      kept.push({ ...cell });
    }
  }
  for (const seat of wantedSeats) {
    if (!seenSeats.has(seat)) {
      seenSeats.add(seat);
      kept.push({ seat });
    }
  }
  if (Array.isArray(explicitShells)) {
    for (const sh of explicitShells) {
      const item = cellItemOf({ ...sh, kind: "shell" });
      if (item) kept.push(item);
    }
  }
  return autoGridForSeats(kept);
}

/** Classify pointer position inside a designer preview cell into a drop zone (`"left" | "right" | "top" | "bottom" | "center"`). */
export function classifyDropZone(localPos, bounds, edgeRatio = 0.24) {
  const w = Number(bounds?.width ?? bounds?.size?.width ?? 0);
  const h = Number(bounds?.height ?? bounds?.size?.height ?? 0);
  const x = Number(localPos?.x ?? 0);
  const y = Number(localPos?.y ?? 0);
  if (w <= 0 || h <= 0) return "center";
  const rx = Math.max(0, Math.min(1, x / w));
  const ry = Math.max(0, Math.min(1, y / h));
  const distLeft = rx;
  const distRight = 1 - rx;
  const distTop = ry;
  const distBottom = 1 - ry;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);
  if (minDist > edgeRatio) return "center";
  if (minDist === distLeft) return "left";
  if (minDist === distRight) return "right";
  if (minDist === distTop) return "top";
  return "bottom";
}

/**
 * Dock a seat or shell pane onto `targetPos = { r, c }` with drop zone `"center" | "left" | "right" | "top" | "bottom"`.
 * - `"center"`: swaps with the target cell (or places into a pad cell).
 * - `"left"` / `"right"`: splits beside the target cell in row `r` (removing from its old slot and pruning empty rows).
 * - `"top"` / `"bottom"`: inserts a row above/below row `r` (removing from its old slot and pruning empty rows).
 */
export function gridDockCell(grid, source, targetPos, zone = "center") {
  if (!grid?.rows?.length || !targetPos) return grid;
  const item = cellItemOf(source);
  if (!item) return grid;
  const key = item.cellId ?? item.seat;
  const from = gridFind(grid, key);
  const r = targetPos.r ?? targetPos.row ?? 0;
  const c = targetPos.c ?? targetPos.col ?? 0;
  if (!grid.rows[r]?.cells?.[c]) return grid;
  if (zone === "center" || !zone) {
    if (from) {
      return gridSwapCells(grid, from, { r, c });
    }
    if (item.seat) return gridPlaceSeat(grid, r, c, item.seat);
    grid.rows[r].cells[c] = { ...item, weight: grid.rows[r].cells[c].weight ?? 1 };
    return grid;
  }
  if (from && from.r === r && from.c === c && grid.rows[r].cells.length === 1 && (zone === "top" || zone === "bottom")) {
    return grid;
  }
  let movedCell = { ...item, weight: 1 };
  let targetCellRef = grid.rows[r].cells[c];
  if (from) {
    const existing = grid.rows[from.r]?.cells?.[from.c];
    if (existing) movedCell = { ...existing, weight: 1 };
    if (from.r === r && from.c === c) return grid;
    grid.rows[from.r].cells.splice(from.c, 1);
    if (grid.rows[from.r].cells.length === 0 && grid.rows.length > 1) {
      grid.rows.splice(from.r, 1);
    }
  }
  let tr = grid.rows.findIndex((row) => row.cells.includes(targetCellRef));
  if (tr < 0) tr = Math.min(r, grid.rows.length - 1);
  let tc = grid.rows[tr].cells.indexOf(targetCellRef);
  if (tc < 0) tc = Math.min(c, Math.max(0, grid.rows[tr].cells.length - 1));

  if (zone === "left" || zone === "right") {
    const insertAt = zone === "left" ? tc : tc + 1;
    if (grid.rows[tr].cells.length < MAX_SIDE) {
      grid.rows[tr].cells.splice(insertAt, 0, movedCell);
    } else if (grid.rows.length < MAX_SIDE) {
      grid.rows.splice(tr + 1, 0, { weight: 1, cells: [movedCell] });
    }
  } else if (zone === "top" || zone === "bottom") {
    const rowInsertAt = zone === "top" ? tr : tr + 1;
    if (grid.rows.length < MAX_SIDE) {
      grid.rows.splice(rowInsertAt, 0, { weight: 1, cells: [movedCell] });
    } else if (grid.rows[tr].cells.length < MAX_SIDE) {
      grid.rows[tr].cells.splice(tc + 1, 0, movedCell);
    }
  }
  grid.rows = grid.rows.filter((row) => Array.isArray(row.cells) && row.cells.length > 0);
  if (!grid.rows.length) grid.rows = [{ cells: [movedCell] }];
  return grid;
}

/**
 * Continuous divider-drag resize between two adjacent cells or rows.
 * Redistributes `wA` and `wB` proportionally to `deltaPx / totalPx` while preserving `wA + wB` and clamping to `[minWeight, maxWeight]`.
 */
export function resizeSiblingWeights(wA = 1, wB = 1, deltaPx = 0, totalPx = 200, minWeight = 0.25) {
  if (Array.isArray(wA)) {
    const items = wA;
    const idx = Number(wB ?? 0);
    const left = items[idx];
    const right = items[idx + 1];
    if (!left || !right) return items;
    const rawDelta = Number(deltaPx ?? 1);
    const pxDelta = Math.abs(rawDelta) <= 2 ? rawDelta * 30 : rawDelta;
    const [nextA, nextB] = resizeSiblingWeights(left.weight ?? 1, right.weight ?? 1, pxDelta, totalPx, minWeight);
    left.weight = nextA;
    right.weight = nextB;
    return [nextA, nextB];
  }
  const a = Number(wA) > 0 ? Number(wA) : 1;
  const b = Number(wB) > 0 ? Number(wB) : 1;
  const sum = a + b;
  const span = Number(totalPx) > 0 ? Number(totalPx) : 200;
  const deltaWeight = (Number(deltaPx) / span) * sum;
  const clampedMin = Math.min(minWeight, sum / 2);
  const nextA = Math.round(Math.max(clampedMin, Math.min(sum - clampedMin, a + deltaWeight)) * 100) / 100;
  const nextB = Math.round(Math.max(clampedMin, sum - nextA) * 100) / 100;
  return [nextA, nextB];
}

/** "A1": the column letter then the row number, as the designer labels a slot. */
export const cellLabel = (r, c) => `${String.fromCharCode(65 + c)}${r + 1}`;

/** Puts `seat` at [r, c]: from another slot it swaps with what is there (a seat) or leaves a pad behind (an empty slot). */
export function gridPlaceSeat(grid, r, c, seat) {
  const row = grid?.rows?.[r];
  if (!row || !seat || c < 0 || c >= row.cells.length) return grid;
  const from = gridFind(grid, seat);
  const target = row.cells[c];
  const keep = (cell) => { const { seat: _s, pad: _p, ...rest } = cell ?? {}; return rest; };
  if (from && from.r === r && from.c === c) return grid;
  if (from) {
    const src = grid.rows[from.r].cells[from.c];
    grid.rows[from.r].cells[from.c] = isPad(target) ? { ...keep(src), pad: true } : { ...keep(src), seat: target.seat };
  }
  row.cells[c] = { ...keep(target), seat };
  return grid;
}

/** Swaps the seats of two slots, each given as { r, c }, { seat } or { cellId }. The slots keep their weights. */
export function gridSwapCells(grid, a, b) {
  const find = (x) => {
    if (x && Number.isInteger(x.r) && Number.isInteger(x.c)) return x;
    for (const [r, row] of (grid?.rows ?? []).entries()) for (const [c, cell] of row.cells.entries()) if ((x?.cellId && cell.cellId === x.cellId) || (x?.seat && cell.seat === x.seat)) return { r, c };
    return null;
  };
  const pa = find(a), pb = find(b);
  const ca = grid?.rows?.[pa?.r]?.cells?.[pa?.c], cb = grid?.rows?.[pb?.r]?.cells?.[pb?.c];
  if (!ca || !cb) return grid;
  const lone = (cell) => { const { weight: _w, ...rest } = cell; return rest; };
  grid.rows[pa.r].cells[pa.c] = wrap(lone(cb), ca.weight);
  grid.rows[pb.r].cells[pb.c] = wrap(lone(ca), cb.weight);
  return grid;
}

/** Empties a slot; it keeps its weight. */
export function gridClearCell(grid, r, c) {
  const row = grid?.rows?.[r];
  if (row?.cells?.[c]) row.cells[c] = wrap({ pad: true }, row.cells[c].weight);
  return grid;
}

/** Splits a slot: `newSeat` goes right after it in the row, or in a new row below when the row already has four cells (capped at 4×4). */
export function gridSplitCell(grid, r, c, newSeat, dir) {
  const row = grid?.rows?.[r];
  if (!row || !newSeat) return grid;
  if (dir !== "down" && row.cells.length < MAX_SIDE) {
    row.cells.splice(c + 1, 0, { seat: newSeat, weight: 1 });
    return grid;
  }
  if (grid.rows.length < MAX_SIDE) {
    grid.rows.splice(r + 1, 0, { cells: [{ seat: newSeat, weight: 1 }] });
    return grid;
  }
  const openRow = grid.rows.find((x) => x.cells.length < MAX_SIDE);
  if (openRow) openRow.cells.push({ seat: newSeat, weight: 1 });
  return grid;
}

/** Removes a slot; a row left with no seat goes too, but the grid keeps one row. */
export function gridRemoveCell(grid, r, c) {
  const row = grid?.rows?.[r];
  if (!row?.cells?.[c]) return grid;
  row.cells.splice(c, 1);
  if (!row.cells.some((x) => !isPad(x))) {
    if (grid.rows.length > 1) grid.rows.splice(r, 1);
    else if (!row.cells.length) row.cells.push({ pad: true });
  }
  return grid;
}

/** Resizes to `numRows` × `numCols` (each 1..4): what fits stays, new slots are pads. */
export function gridResizeShape(grid, numRows, numCols) {
  const clamp = (n) => Math.min(MAX_SIDE, Math.max(1, Math.round(Number(n) || 1)));
  const rows = clamp(numRows), cols = clamp(numCols);
  const next = (grid?.rows ?? []).slice(0, rows).map((row) => ({ ...row, cells: row.cells.slice(0, cols) }));
  while (next.length < rows) next.push({ cells: [] });
  for (const row of next) while (row.cells.length < cols) row.cells.push({ pad: true });
  grid.rows = next;
  return grid;
}

/** A followed target as people read it: the rig's name without `rig:`. */
export const followName = (view) => String(view ?? "").replace(/^rig:/, "");

/** Harnesses offered in the seat hot-swap dialog. */
export const SWAP_RUNTIMES = Object.freeze(["claude-code", "codex", "copilot", "agy", "omp", "pi"]);

const SWAP_EFFORT_TOKENS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const swapModelId = value => typeof value === "string" && /^[a-z0-9][a-z0-9._:/-]{0,159}$/i.test(value);

/** Filter a model list so `Fable` is never offered in the UI or any launcher path. */
export function filterAllowedModels(models) {
  return (Array.isArray(models) ? models : [])
    .map((m) => String(m ?? "").trim())
    .filter((m) => swapModelId(m) && !/fable/i.test(m));
}

/**
 * Compute the seat hot-swap plan, continuity tier, and lead/advisor queue payload.
 * - Every request routes via a durable queue item (`queue create`) to the rig's lead, or to its advisor
 *   when the target seat is the lead.
 * - Tier 1 (same harness): Lossless (`requiresConfirm: false`).
 * - Tier 2 (`codex <-> claude-code`): Handover (`requiresConfirm: true`).
 * - Tier 3 (cross-harness involving `agy`, `copilot`, `omp`, `pi`): Re-import (`requiresConfirm: true`).
 */
/** One line of plain text: control characters and newlines become spaces. */
function oneLine(v) {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

/** A shell-style single-quoted word, for command lines in text an agent reads. */
function shq(v) {
  return `'${String(v ?? "").replace(/'/g, "'\\''")}'`;
}

export function changeModelPlan(target = {}, pick = {}, extra = null) {
  // The names go into text a lead agent reads and runs: one line each, and quoted in every command.
  const rig = oneLine(target.rig ?? (typeof target.session === "string" && target.session.includes("@") ? target.session.slice(target.session.lastIndexOf("@") + 1) : "rig"));
  const logicalId = oneLine(target.logicalId ?? (typeof target.session === "string" ? target.session.split("@")[0].replace(/-/g, ".") : "seat"));
  const session = oneLine(target.session ?? `${logicalId.replace(/\./g, "-")}@${rig}`);
  const pod = oneLine(String(target.pod ?? (logicalId.includes(".") ? logicalId.split(".")[0] : "dev")).trim() || "dev");
  const representative = Object.hasOwn(extra ?? {}, "representative") ? extra.representative : target.representative;
  const leadSession = isValidSessionName(representative) && /^[^@]+@[^@]+$/.test(representative) ? representative : null;
  const isLeadTarget = session === leadSession;
  const seats = Array.isArray(extra)
    ? (extra.find((r) => r.name === rig || r.id === rig)?.pods ?? []).flatMap((p) => p.seats ?? [])
    : (Array.isArray(extra?.seats ?? target.seats) ? (extra?.seats ?? target.seats) : []);
  const advisorSeat = seats.find((s) => s.logicalId === "orch.advisor" || String(s.session ?? "").startsWith("orch-advisor@"));
  const destinationRole = isLeadTarget ? "advisor" : "lead";
  const destinationLogicalId = isLeadTarget ? advisorSeat?.logicalId ?? "advisor"
    : seats.find((s) => s.session === leadSession)?.logicalId ?? "lead";
  const destinationSession = isLeadTarget
    ? advisorSeat?.session ?? null
    : leadSession;
  const routingError = destinationSession
    ? null
    : typeof representative === "string" && representative && !leadSession
      ? `OpenRig reported a lead herdrig can't address (${oneLine(representative).slice(0, 200)}). Nothing was queued.`
    : !isLeadTarget ? `OpenRig didn't report a lead for ${rig}. Nothing was queued.`
    : `No running ${destinationLogicalId} seat found in ${rig} to route the swap.`;
  const buttonLabel = isLeadTarget ? "Queue for advisor" : "Queue for lead";
  const routeNote = routingError
    ? routingError
    : isLeadTarget
      ? `Routes to ${destinationSession}; the advisor applies the swap because the lead cannot safely swap mid-turn.`
      : `Routes to ${destinationSession}; the lead applies the swap around in-flight work.`;

  const curRuntime = String(target.runtime || target.currentRuntime || "claude-code").trim();
  const curModel = target.model ?? target.currentModel ?? null;
  const curEffort = target.effort ?? target.currentEffort ?? null;
  const nextRuntime = String(pick.runtime || curRuntime).trim();
  const sameHarness = nextRuntime === curRuntime;
  const isAgy = nextRuntime === "agy";
  const requestedModel = pick.model === undefined ? (sameHarness ? curModel : null) : pick.model;
  const error = requestedModel && /fable/i.test(requestedModel)
    ? "Fable is not offered in the model picker or launcher."
    : requestedModel && !swapModelId(requestedModel) ? "Enter a model ID with letters, numbers, or model ID punctuation."
    : !SWAP_RUNTIMES.includes(nextRuntime) ? "This harness isn't available for a swap." : null;
  const models = Array.isArray(extra?.catalog?.models) ? extra.catalog.models : [];
  const allowedModels = filterAllowedModels(models.map(model => model?.id));
  const nextModel = isAgy || error ? null : requestedModel || null;
  const reportedEfforts = models.find(model => model?.id === nextModel)?.efforts ?? extra?.catalog?.runtimeEfforts;
  const allowedEfforts = Array.isArray(reportedEfforts) ? reportedEfforts.filter(level => SWAP_EFFORT_TOKENS.has(level)) : [];
  const sameModel = sameHarness && nextModel === curModel;
  const requestedEffort = pick.effort === undefined ? (sameModel ? curEffort : null) : pick.effort;
  const knownEffort = SWAP_EFFORT_TOKENS.has(requestedEffort)
    && (!Array.isArray(reportedEfforts) || allowedEfforts.includes(requestedEffort) || sameModel && requestedEffort === curEffort);
  const nextEffort = isAgy || !knownEffort ? null : requestedEffort;
  const reason = String(pick.reason ?? target.reason ?? "").trim() || "hot-swap from the Rig mod";
  const updateSpec = pick.updateSpec !== false;

  const isNativePair = (curRuntime === "codex" && nextRuntime === "claude-code") || (curRuntime === "claude-code" && nextRuntime === "codex");
  const isFreshCross = !sameHarness && (isAgy || curRuntime === "agy");

  let tier = 1;
  let badge = "Lossless — nothing restarts, same conversation";
  let carriesOver = "Everything — same conversation, nothing restarts (set-effort / set-model + live /model in the pane).";
  let requiresConfirm = false;
  let confirmLabel = null;
  let agyNote = null;

  if (isAgy) {
    agyNote = "agy's model and effort live in agy's own settings";
  }

  if (sameHarness) {
    tier = 1;
    badge = "Lossless — nothing restarts, same conversation";
    carriesOver = isAgy
      ? "agy's model and effort live in agy's own settings"
      : "Everything — applies in the live conversation without restarting the seat.";
    requiresConfirm = false;
  } else if (isNativePair) {
    tier = 2;
    badge = "Handover — same seat identity, new conversation";
    carriesOver = "Address, nodeId, edges, queue rows and claims, and handover packet — a fresh session primed with the handover, NOT the same conversation.";
    requiresConfirm = true;
    confirmLabel = "I understand this starts a new conversation primed with the handover packet";
  } else {
    tier = 3;
    badge = isFreshCross
      ? "Re-import (fresh session) — same address and queue rows, new nodeId, new conversation"
      : "Re-import — same address and queue rows, new nodeId, new conversation";
    carriesOver = "Session address, queue rows/outbox history, re-declared edges, and handover packet — new nodeId, tenure resets to generation 1, new conversation.";
    requiresConfirm = true;
    confirmLabel = "I understand this re-imports the seat (new nodeId and new conversation primed from a handover packet)";
  }

  const pickDesc = [
    nextRuntime,
    ...(nextModel ? [nextModel] : []),
    ...(nextEffort ? [`effort:${nextEffort}`] : []),
  ].join(" · ");
  const tierShort = tier === 1 ? "Lossless" : tier === 2 ? "Handover" : "Re-import";
  const tierLabel = `Tier ${tier} · ${badge}`;
  const setCmd = `rig seat set ${shq(`${logicalId}@${rig}`)} --runtime ${nextRuntime}${nextModel ? ` --model ${nextModel}` : ""}${nextEffort ? ` --effort ${nextEffort}` : ""}`;
  const summary = `[model-swap] ${logicalId}: Seat hot-swap (${tierShort}) → ${pickDesc}`;
  const fallbackRecipient = destinationSession;
  const procedureLines = tier === 1
    ? [
        ...(nextEffort ? [`rig seat set-effort ${shq(session)} --effort ${nextEffort}`] : []),
        ...(nextModel ? [`rig seat set-model ${shq(session)} --model ${nextModel}`, `rig send ${shq(session)} ${shq(`/model ${nextModel}`)}`] : []),
      ]
    : tier === 2
      ? [
          `rig seat set-runtime ${shq(session)} --runtime ${nextRuntime}${nextModel ? ` --model ${nextModel}` : ""}${nextEffort ? ` --effort ${nextEffort}` : ""} --reason ${shq(reason)}`,
        ]
      : [
          `1. Save handover packet: rig transcript ${shq(session)} --tail 120 > ${shq(`workspace/handover/${logicalId}-${nextRuntime}.md`)}`,
          `2. Update rig/rig.yaml member ${JSON.stringify(logicalId)} runtime to ${nextRuntime}${nextModel ? ` (model: ${nextModel})` : ""}`,
          `3. rig snapshot ${shq(rig)}`,
          `4. rig remove ${shq(rig)} ${shq(logicalId)} --fallback ${shq(fallbackRecipient)}`,
          `5. rig add ${shq(rig)} ${shq(pod)} <member-fragment.yaml>`,
          `6. rig send ${shq(session)} ${shq(`Read handover packet workspace/handover/${logicalId}-${nextRuntime}.md`)}`,
        ];
  const cliPreview = procedureLines[0] ?? setCmd;
  const continuity = tier === 1 ? "lossless" : isFreshCross ? "fresh" : "handover";
  const tone = tier === 1 ? "working" : tier === 2 ? "warn" : "blocked";
  const targetEffort = nextEffort ?? (isAgy ? "agy-settings" : sameHarness && nextModel && !sameModel ? "unchanged" : "default");
  const body = [
    `Seat hot-swap request from the Rig mod (D7):`,
    `- seat: ${JSON.stringify(logicalId)} (${JSON.stringify(session)})`,
    `- rig: ${JSON.stringify(rig)}`,
    `- from: runtime=${curRuntime}, model=${curModel ?? "default"}, effort=${curEffort ?? "default"}`,
    `- target: runtime=${nextRuntime}, model=${nextModel ?? (isAgy ? "agy-settings" : "default")}, effort=${targetEffort}`,
    `- continuity: Tier ${tier} — ${badge}`,
    `- carries over: ${carriesOver}`,
    `- update spec file: ${updateSpec ? "yes" : "no"}`,
    `- reason: ${reason}`,
    `- command: ${setCmd}`,
    ``,
    `Runbook for ${destinationLogicalId}:`,
    ...procedureLines.map((l) => `  ${l}`),
  ].join("\n");

  return {
    rig,
    pod,
    logicalId,
    session,
    isLead: isLeadTarget,
    isLeadSelf: isLeadTarget,
    isLeadTarget,
    destinationRole,
    destinationLogicalId,
    destinationSession,
    recipient: destinationSession,
    recipientLogicalId: destinationLogicalId,
    routingError,
    buttonLabel,
    routeNote,
    curRuntime,
    nextRuntime,
    nextModel,
    nextEffort,
    allowedModels,
    allowedEfforts,
    isAgy,
    agyNote,
    error,
    reason,
    updateSpec,
    tier,
    tierLabel,
    badge,
    carriesOver,
    detail: carriesOver,
    continuity,
    tone,
    cliPreview,
    procedureLines,
    setCmd,
    requiresConfirm,
    confirmLabel,
    summary,
    body,
  };
}

/** What an action says when `actionArgs` refused what the daemon named (null). */
export const ACTION_REFUSED = "Refused: OpenRig named a seat, cell or plan this action won't pass on (it must not start with -).";

/** The CLI behind each menu action (`home` is the app home the herdr-app provider writes to); null when a value the
 *  daemon named can't be passed on safely. */
export function actionArgs(target, action, text, home) {
  if (assistantActionRefusal(target, action)) return null;
  const appHomeArgs = ["--app-home", home];
  // Options first, then `--`, then what the daemon named (a rig, a view, a terminal): a value such as `--host` stays an
  // argument and can't become an option. A session must also be a name OpenRig makes, and a value the daemon named that
  // goes in an option (a cell, an expected plan) mustn't start with `-`.
  const session = target?.session;
  if ((action === "send" || action === "queue") && !isValidSessionName(session)) return null;
  const cell = target?.cellId ?? target?.seat ?? target?.terminal;
  if (action === "close-cell" && (typeof cell !== "string" || cell === "" || cell.startsWith("-"))) return null;
  if (action === "open-view" && target?.plan && String(target.plan).startsWith("-")) return null;
  switch (action) {
    case "send": return ["send", "--", session, text];
    case "queue": {
      const [summary, ...rest] = text.split("\n");
      return ["queue", "create", "--destination", session, "--summary", summary.trim(), "--body", (rest.join("\n").trim() || summary.trim())];
    }
    case "change-model": {
      const plan = changeModelPlan(target, {
        runtime: target.nextRuntime ?? target.swapRuntime ?? target.runtime,
        model: target.nextModel !== undefined ? target.nextModel : target.swapModel,
        effort: target.nextEffort !== undefined ? target.nextEffort : target.swapEffort,
        reason: text || target.reason,
        updateSpec: target.updateSpec,
      }, { seats: target.seats, catalog: target.catalog });
      if (plan.error || !isValidSessionName(plan.destinationSession)) return null;
      return ["queue", "create", "--destination", plan.destinationSession, "--summary", plan.summary, "--body", plan.body];
    }
    case "open-view": case "open-seat": case "follow": case "unfollow": case "prune": case "open-designed-view": return null;
    case "keyboard": return ["terminal", "keyboard", ...appHomeArgs, "--", target.terminal];
    case "snapshot": return ["snapshot", "--", target.rig];
    case "close-view": return ["terminal", "close", ...appHomeArgs, "--", target.viewId];
    case "pause": return ["down", "--yes", "--", target.rig];
    case "resume": return ["up", "--existing", "--", target.rig];
    case "delete-rig": {
      // OpenRig resolves archived rigs by exact id only (name matching excludes archivedAt != null): never fall back to target.rig.
      if (!target.archived) return ["down", "--delete", "--yes", "--", target.rig];
      const id = target.rigId;
      return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(id) ? ["down", "--delete", "--yes", "--", id] : null;
    }
    case "archive-rig": return ["archive", "--", target.rig];
    case "unarchive-rig": {
      const id = target.rigId ?? target.rig;
      return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(id) ? ["unarchive", "--", id] : null;
    }
    case "fresh": return freshArgs(target.logicalId, target.rig, target.reason ?? "fresh-prime after restore");
    default: return null;
  }
}

/** What one CLI write said, from `exec`'s { code, stdout, stderr }: { ok, json, text, warning }. The CLI's own words (its
 *  message or error); a JSON body with neither is data, so how the CLI ended is said instead. A command that prints
 *  words, not JSON (`rig snapshot`: "Snapshot created: <id>"), says what happened in its first line. */
export function writeOutcome(r) {
  let json = null; try { json = JSON.parse(r?.stdout); } catch (_) { json = null; }
  // OpenRig can record or retain a send and exit zero without delivering it, or report in its own error receipt that nothing left
  // (a stopped daemon, a refused connection before dispatch, or a create refused before writing). Those receipts are authoritative,
  // unlike a timeout: keep the draft and never show success or speculate that it may have been delivered.
  const undelivered = ["recorded", "retained"].includes(json?.outcome) && json?.sent === false
    || !json && /^(?:Recorded|Retained), not delivered to /u.test(String(r?.stdout ?? "").trimStart());
  const consequence = typeof json?.error?.consequence === "string" ? json.error.consequence.trim() : "";
  const stderrText = String(r?.stderr ?? "");
  const reason = json?.error?.fact ?? json?.error?.message ?? (typeof json?.error === "string" ? json.error : null) ?? json?.message;
  // Installed OpenRig 0.7.19's session/transport refusals carry this pair. Older receipts may only carry its exact
  // sentence. Neither proof can override custody, a reached input phase, or an explicitly uncertain outcome.
  const cannotRetry = r?.outcomeUnknown === true || json?.outcomeUnknown === true || json?.uncertain === true
    || ["recorded", "retained"].includes(json?.outcome) || json?.sent === true
    || (typeof json?.inputPhase === "string" && json.inputPhase !== "not_reached");
  const inputNotReached = json?.ok === false && json?.sent === false && json?.inputPhase === "not_reached";
  const noTextReceipt = Number.isInteger(r?.code) && r.code > 0 && (json?.ok === false || !json)
    && /(?:^|[.!?]\s+)No text was sent\.(?:\s|$)/u.test(String(json ? reason ?? "" : stderrText));
  const cliUnsent = /^(?:The message was not sent\.|The command was not delivered\.(?:\s|$)|This command needs a running daemon\.|(?:The (?:queue|coordination) command|rig [a-z -]+) did not run[;,] (?:the )?daemon was not contacted(?:, and nothing was persisted)?\.)$/i.test(consequence)
    || (!json && /^Error: Daemon not running\.\s+This command needs a running daemon\./m.test(stderrText))
    || /^No row was created:/m.test(stderrText);
  const notSent = (inputNotReached || noTextReceipt || cliUnsent) && !undelivered && !cannotRetry;
  const failed = r?.code !== 0 || json?.ok === false || notSent || undelivered;
  const text = undelivered ? (json ? [`${json.outcome === "retained" ? "Retained" : "Recorded"}, not delivered to ${json.sessionName ?? json.destinationStatus?.destinationSession ?? "the destination"}.`, json.destinationStatus?.message].filter(Boolean).join("\n") : r.stdout)
    : failed ? (reason ?? (json ? rigStoppedMaybeDone(r?.code) : (r?.stderr || r?.stdout || rigStoppedMaybeDone(r?.code)))) : (json ? json.message ?? "" : plainOutcome(r?.stdout));
  // Queue creation is successful when its row persists even if the destination cannot be nudged. Keep that success,
  // but show the daemon's destination advisory instead of implying the seat is available.
  const advisories = Array.isArray(json?.advisories) ? json.advisories : [];
  const warning = [json?.warning, ...advisories.filter(a => ["destination_status", "unmatched_destination_seat"].includes(a?.code)).map(a => a.message)].filter(v => typeof v === "string" && v.trim()).join("\n") || null;
  const line = String(text).trim();
  // A CLI receipt that proves no request left says so in every result. Recorded/retained sends did contact OpenRig:
  // their "not delivered" receipt must never acquire a "nothing was sent" claim.
  const words = notSent && !/nothing was sent/i.test(line) ? `${line} Nothing was sent.` : line;
  return { ok: !failed, json, text: words, warning, ...(notSent ? { notSent: true } : {}), ...(undelivered ? { undelivered: true } : {}) };
}

/** What a menu action is called in a title, a status line or a toast. */
export function actionTitle(target, action) {
  return { "launch-spec": `Launch ${target.name}?`, send: `Send to ${target.session}`, queue: `Queue work for ${target.session}`,
    "change-model": `${target.logicalId ?? target.session} · ${target.rig ?? ""}`.replace(/ · $/, ""),
    // The request answered is always named: who asked, else its id.
    reply: `Reply to ${target.asker || target.qitemId || target.id}`, pause: `Pause ${target.rig}?`,
    resume: `Resume ${target.rig}?`, "archive-rig": `Archive ${target.rig}?`, "unarchive-rig": `Restore ${target.rig}?`, "delete-rig": `Delete ${target.rig}?`, "new-rig": "New rig", fresh: `Start ${target.logicalId} fresh?`, "open-view": `Open ${target.view}`, "open-seat": `Show ${target.logicalId}`,
    snapshot: `Snapshot ${target.rig}`, keyboard: "Take keyboard", info: "Open slice", follow: `Follow ${followName(target.view)}`, unfollow: `Stop following ${followName(target.view)}`,
    prune: `Prune after ${target.prune}`, "close-view": `Close ${target.name ?? target.viewId}`,
    "design-view": target.replace ? `Edit layout · ${target.name ?? target.replace}` : `Design worker view · ${target.rig}`,
    "close-cell": `Close ${target.name ?? target.cellId ?? target.seat}`, "open-designed-view": target.replace ? "Update worker view" : `Open ${target.name ?? target.view ?? "worker view"}` }[action] ?? "Rig";
}

/** What a success says when the CLI printed no message of its own. */
export function doneWords(target, action) {
  const plan = action === "change-model" ? changeModelPlan(target, {}) : null;
  return { send: `Sent to ${target.session}.`, queue: `Queued for ${target.session}.`,
    "change-model": `Queued for ${plan?.destinationSession ?? "lead"}.`,
    reply: target.reply === "resolve" ? "Resolved." : "Answer sent.", fresh: `${target.logicalId} started fresh.`,
    snapshot: `Snapshot of ${target.rig} taken.`, keyboard: "This cell now takes your keys.", "open-view": `${target.view} opened.`,
    "open-seat": `${target.logicalId} shown in a worker view.`, follow: `Following ${followName(target.view)}: working seats and those that need you join; idle ones leave.`,
    unfollow: `Stopped following ${followName(target.view)}; the tiles stay as they are.`, prune: `Idle tiles now leave after ${target.prune}.`,
    "close-view": "View closed; only the viewers ended, no agent was stopped.",
    "close-cell": "Cell closed; only its viewer ended, no agent was stopped.", "open-designed-view": target.replace ? "Worker view updated." : "Worker view opened.", "launch-spec": `${target.name} launched.` }[action] ?? "Done.";
}

/** How long a one-click success stays in the Rig page's status line. */
export const STATUS_MS = 6000;
/** How long a one-click error stays in the Rig page's status line. */
export const ERROR_STATUS_MS = 12000;

/** Connection-qualifies a one-click busy key (`conn|key` for non-legacy connections; idempotent when already qualified). */
export function qualifyBusyKey(conn, key) {
  if (!key || !conn || conn === LEGACY_CONNECTION_ID) return key;
  const prefix = `${conn}|`;
  return typeof key === "string" && key.startsWith(prefix) ? key : `${prefix}${key}`;
}

export function oneClickBusyKey(target, action, actionKey = null) {
  const raw = actionKey ?? target?.actionKey ?? `${action}:${target?.rig ?? target?.view ?? target?.session ?? ""}:${target?.viewId ?? ""}:${target?.cellId ?? ""}`;
  return qualifyBusyKey(target?.conn, raw);
}

/**
 * Starts a one-click action (ONE_CLICK) without a dialog. The Rig sidebar runs it (`rig.oneclick`): it outlives the popup
 * that asked, so closing the popup never cancels the write. Without the sidebar in the layout, the action's result
 * dialog runs it, as before. `host` is { shared, setShared, run, layout, openOverlay }; the request queue is
 * `shared("rig.oneclick")`, keyed by a request id so two senders never drop each other's.
 */
export function startOneClick(host, target, action, actionKey = null) {
  if (!layoutShowsMod(host.layout(), MOD_IDS.sidebar)) {
    return host.openOverlay({ mod: MOD_IDS.menu, kind: "dialog", width: 460, height: 240, props: { target, step: { action, run: true } } });
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const busyKey = oneClickBusyKey(target, action, actionKey);
  host.setShared("rig.busyAction", busyKey);
  host.setShared("rig.oneclick", { ...(host.shared("rig.oneclick") ?? {}), [id]: { target, action, actionKey: busyKey } });
  host.run("rig.oneclick");
  return id;
}

/** A write's outcome in words: the CLI's JSON message, else (a command that prints words) its first line. */
export function plainOutcome(stdout) {
  return String(stdout ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

/** A read command (no identity needed): the CLI against the mods' daemon and OpenRig home. */
export function readCommand(config, args, { env = [] } = {}) {
  const refused = cliRefusal(config);
  if (refused) return refusedCommand();
  return { command: "env", args: [...cliEnv(config), ...env, ...(config.rig ?? ["rig"]), ...args] };
}

/** Exact library identity: dot segments must never let URL normalization select a sibling endpoint. */
export function rigSpecLibraryPath(spec) {
  const id=spec?.id;
  return typeof id==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(id)
    ? `/api/specs/library/${encodeURIComponent(id)}` : null;
}
export function rigSpecReviewPath(spec) {
  const path=rigSpecLibraryPath(spec);return path?path+"/review":null;
}

/** The same public parsed review used by OpenRig0.7.11's CLI. No host CLI, remote exec, YAML or source paths. */
export async function readRigSpecPreview(fetcher,daemonUrl,spec) {
  const path=rigSpecReviewPath(spec);if(!path)throw new Error("This library entry has no usable spec id.");
  if(typeof daemonUrl!=="string"||!daemonUrl)throw new Error("Connect OpenRig before opening the saved spec preview.");
  const response=await fetcher(`${daemonUrl.replace(/\/$/,"")}${path}`);
  if(!response.ok)throw new Error(`OpenRig could not review this saved spec (${response.status}).`);
  return normalizeRigSpecPreview(await response.json());
}

/** Public specs preview JSON -> {summary,pods:[{id,label,seats:[{lid,runtime,model,profile}]}],edges:[{from,to,kind}],seatCount}.
 * Shared by the New rig accordion and rig graph. Only pod-local bare member refs are qualified; qualified refs and
 * pod:<id> refs retain their meaning. Source paths, raw YAML, agentRef and startup instructions are never projected.
 */
export function normalizeRigSpecPreview(data) {
  if (!data || !Array.isArray(data.pods)) throw new Error("OpenRig returned no rig pods in the spec preview.");
  const edges = [];
  const edge = (e, pod = null) => {
    if (!e || typeof e.from !== "string" || typeof e.to !== "string") throw new Error("OpenRig returned an invalid spec edge.");
    const qualify = (ref) => pod && !ref.includes(".") && !ref.startsWith("pod:") ? `${pod}.${ref}` : ref;
    return { from: qualify(e.from), to: qualify(e.to), kind: singleLineText(e.kind) };
  };
  const pods = data.pods.map((p) => {
    if (!p || typeof p.id !== "string" || !Array.isArray(p.members)) throw new Error("OpenRig returned an invalid spec pod.");
    const id = singleLineText(p.id);
    const seats = p.members.map((m) => {
      if (!m || typeof m.id !== "string") throw new Error("OpenRig returned an invalid spec member.");
      return { lid: `${id}.${singleLineText(m.id)}`, runtime: singleLineText(m.runtime) || null,
        model: typeof m.model === "string" ? singleLineText(m.model) || null : null,
        profile: m.profile && !["default", "none"].includes(m.profile) ? singleLineText(m.profile) || null : null };
    });
    edges.push(...(Array.isArray(p.edges) ? p.edges.map((e) => edge(e, id)) : []));
    return { id, label: singleLineText(p.label) || id, seats };
  });
  edges.push(...(Array.isArray(data.edges) ? data.edges.map((e) => edge(e)) : []));
  return { summary: singleLineText(data.summary), pods, edges, seatCount: pods.reduce((n, p) => n + p.seats.length, 0) };
}

/** A terminal seat (`nodeKind: "infrastructure"` or `runtime: "terminal"`), such as the kernel's operator.human: a plain
 *  shell, not an agent. OpenRig samples its window for motion, so a redrawing screen reads as "working"; that isn't an
 *  agent at work. */
export function isTerminalSeat(node) {
  return node?.nodeKind === "infrastructure" || node?.runtime === "terminal";
}

/** The tmux socket a seat's node names with `-S` in `tmuxServerArgs` (OpenRig 0.7.20 nodes), else null (`-L name` or the default server). */
export function tmuxSocketOf(node) {
  const args = Array.isArray(node?.tmuxServerArgs) ? node.tmuxServerArgs : [];
  const at = args.indexOf("-S");
  return at >= 0 && typeof args[at + 1] === "string" && args[at + 1] ? args[at + 1] : null;
}
/** The tmux servers an OpenRig reports unreachable (`/healthz.terminals`, 0.7.20), each with the seats on it, or null when there is none: an
 *  older OpenRig (no `terminals`), its healthy readings, and a server back to `reachable` (OpenRig keeps a recovered server listed) all read null.
 *  A seat is on a server when its node's `-S` socket is the server's socket; a seat with no `-S` only when exactly one server is listed (else
 *  no seat is guessed, and the server is still reported). `nodesByRig`: rig id -> nodes. */
export function terminalOutage(healthz, nodesByRig = {}) {
  const servers = Array.isArray(healthz?.terminals?.servers) ? healthz.terminals.servers.filter((s) => s && typeof s.socket === "string") : [];
  const gone = servers.filter((s) => s.state === "unreachable");
  if (!gone.length) return null;
  const nodes = Object.values(nodesByRig ?? {}).flatMap((list) => (Array.isArray(list) ? list : []));
  const only = servers.length === 1;
  const nameOf = (socket) => (only ? "this OpenRig's tmux server" : socket.split("/").filter(Boolean).slice(-2).join("/"));
  return { servers: gone.map((s) => ({ socket: s.socket, name: nameOf(s.socket), since: s.since ?? null, cause: s.cause ?? null,
    // A tmux seat with no -S: attachmentType "tmux" (OpenRig omits tmuxServerArgs on its default server), or args with no attachment named
    // (never another attachment type's node). A paused or downed seat has no attachment and no args, so it is never marked.
    seats: [...new Set(nodes.filter((n) => n?.canonicalSessionName
      && (tmuxSocketOf(n) ? tmuxSocketOf(n) === s.socket : only && (n.attachmentType === "tmux" || (!n.attachmentType && Array.isArray(n.tmuxServerArgs))))).map((n) => n.canonicalSessionName))] })) };
}
/** `nodes` with the seats of `outage` marked `terminalServerGone`: the same array when none is affected (so what is built from it stays as it
 *  was), else a new one where only the affected nodes are copies. */
export function withTerminalOutage(nodes, outage) {
  if (!outage || !Array.isArray(nodes)) return nodes;
  const gone = new Set(outage.servers.flatMap((s) => s.seats));
  if (!nodes.some((n) => gone.has(n?.canonicalSessionName))) return nodes;
  return nodes.map((n) => (gone.has(n?.canonicalSessionName) ? { ...n, terminalServerGone: true } : n));
}
/** `/healthz` as herdrig keeps it: the terminal servers without `lastCheckedAt`, which OpenRig moves on every probe (every 5 s during an outage)
 *  and herdrig never shows. What is kept (state, since, cause, transitions) changes only when something did, so a refresh that read the same
 *  outage publishes nothing new and what is built from it is reused. Everything else is as read. */
export function steadyHealthz(healthz) {
  const servers = healthz?.terminals?.servers;
  if (!Array.isArray(servers)) return healthz;
  return { ...healthz, terminals: { ...healthz.terminals, servers: servers.map((s) => { if (!s || typeof s !== "object") return s; const { lastCheckedAt: _probe, ...kept } = s; return kept; }) } };
}
/** The words an "unreachable" seat's status carries on hover. */
export const TERMINAL_GONE_TOOLTIP = "This seat's tmux server stopped answering. OpenRig holds automatic messages to it and checks again on its own; it doesn't restart the server.";
/** Why Focus pane, Attach and Open terminal are off for an unreachable seat. */
export const TERMINAL_GONE_REASON = "Its terminal server isn't answering.";
/** The line Send's dialog adds for an unreachable seat: OpenRig holds only automatic delivery, so an explicit send is still tried. */
export const TERMINAL_GONE_SEND_NOTE = "Its terminal isn't answering. OpenRig will try once, but it may not arrive.";
/** The Rig page's notice for `n` unreachable seats; on another machine it says where to run `rig doctor`. */
export function terminalOutageNotice(n, machine = null) {
  const lead = n === 1 ? "1 seat can't be reached: its terminal server stopped answering. OpenRig is holding automatic messages to it and checking again on its own."
    : `${counted(n, "seat", "seats")} can't be reached: their terminal server stopped answering. OpenRig is holding automatic messages to them and checking again on its own.`;
  return machine ? `${lead} Run rig doctor on ${machine}.` : lead;
}
/** System › Health's row for one unreachable server of terminalOutage (its socket goes in the tooltip, never in the text). */
export function terminalServerRowText(server) {
  const who = server.name === "this OpenRig's tmux server" ? "This OpenRig's tmux server" : `Terminal server ${server.name}`;
  return `${who} isn't answering · ${counted(server.seats.length, "seat", "seats")} · OpenRig keeps checking on its own`;
}
/** The seat page's line under its heading while its server isn't answering. */
export function terminalGoneSeatLine(session) {
  return `The terminal server holding ${session} stopped answering. OpenRig holds automatic messages to it and checks again on its own. Its conversation may still be there once the server is back.`;
}
/** The one notification when a server's seats stop being reachable: a short title (a toast truncates it), and a body naming the rigs and,
 *  for a connection on another machine, where. */
export function terminalLossTitle(n) {
  return `${counted(n, "seat", "seats")} can't be reached`;
}
/** One toast line of about 45 characters, the cause first so only a long rig name is cut: "tmux not answering: demo", "… demo and lab", or
 *  "… demo and 2 more", in the order given. A connection on another machine names it ("tmux on box2 not answering: …"). The Rig page notice
 *  says what OpenRig does meanwhile. */
export function terminalLossBody(rigs, machine = null) {
  const names = (Array.isArray(rigs) ? rigs : [rigs]).filter(Boolean);
  const list = names.length <= 1 ? (names[0] ?? "") : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} more`;
  return `tmux ${machine ? `on ${machine} ` : ""}not answering: ${list}`;
}
/** Why a rig's Worker view and Follow are off: every one of its seats sits on a tmux server that stopped answering. */
export const TERMINAL_GONE_RIG_REASON = "This rig's terminal server isn't answering.";
/** Whether every seat of a rig (a topology entry with pods of seats) reads unreachable; false for a rig with no seats. */
export function rigTerminalsGone(rig) {
  const seats = (rig?.pods ?? []).flatMap((pod) => pod?.seats ?? []);
  return seats.length > 0 && seats.every((seat) => seat?.status === "terminal_gone");
}

/** The TUI's seat status (tui/src/hydrate.ts, the maintained web projection), from one `/api/rigs/:id/nodes` row. A
 *  running terminal seat is `terminal`, never `active`: its attention and lifecycle states still show. A seat whose tmux server OpenRig reports
 *  unreachable (`terminalServerGone`, see withTerminalOutage) is `terminal_gone`, over every other state: it says why nothing reaches it. */
export function seatStatus(node) {
  if (node?.terminalServerGone === true) return "terminal_gone";
  const act = node.activityState ?? {};
  if (node.identityVerdict?.reason === "session_missing" && node.sessionStatus === "detached" && node.lifecycleState !== "attention_required") return "detached";
  if (node.startupStatus === "failed") return "failed";
  if (node.needsAttention == null && (node.lifecycleState === "attention_required" || node.startupStatus === "attention_required")) return "attention_required";
  if (node.needsAttention === true) return (node.arbitratedNeedsInput ?? node.agentActivity?.state === "needs_input") ? "needs_input" : "attention_required";
  if (node.needsAttention == null && (act.display === "needs-input" || node.agentActivity?.state === "needs_input")) return "needs_input";
  if (isTerminalSeat(node)) return node.sessionStatus === "running" || node.sessionStatus === "ready" ? "terminal" : (node.sessionStatus ?? "unknown");
  if (node.sessionStatus === "running" || node.sessionStatus === "ready") {
    if (act.display === "blocked") return "blocked";
    if (act.display === "working") return "active";
    if (act.display === "idle") return "idle";
    if (node.terminalActive === true || (node.terminalActive == null && node.agentActivity?.state === "running")) return "active";
    // OpenRig 0.7.13 TUI hydrate: a served activity object owns the fallback,
    // even when empty or stale. Only an absent word retains legacy screen-idle.
    return node.communityHarness || node.activityState ? "unknown" : "idle";
  }
  return node.sessionStatus ?? "unknown";
}

/** herdr's status vocabulary (theme().working, .blocked, .idle, .done) and the word shown, for a TUI status. */
export function statusLook(status) {
  switch (status) {
    case "needs_input": return { tone: "blocked", word: "needs you" };
    case "attention_required": return { tone: "blocked", word: "needs you" };
    case "failed": return { tone: "blocked", word: "failed" };
    case "blocked": return { tone: "blocked", word: "blocked" };
    case "active": return { tone: "working", word: "working" };
    case "idle": return { tone: "idle", word: "idle" };
    // Its own tone: drawn in the needs colour, never counted as needs you (it isn't a request) nor as idle.
    case "terminal_gone": return { tone: "gone", word: "unreachable" };
    case "unknown": return { tone: "done", word: "not reported" };
    // Neutral: not counted as working, needs you or idle, and never raises a rig's dot.
    case "terminal": return { tone: "done", word: "terminal" };
    case "detached": return { tone: "done", word: "detached" };
    case "stopped": return { tone: "done", word: "stopped" };
    case "exited": return { tone: "done", word: "exited" };
    default: return { tone: "idle", word: statusWord(status, "seat") };
  }
}

/**
 * Exact TUI status glyph vocabulary (`rowStatusGlyph`):
 * - `✕` failed
 * - `◐` attention_required | needs_input
 * - `●` active (tone: working)
 * - `●` idle (tone: idle)
 * - `○` everything else (including unknown — never a fabricated `●`)
 */
export function rowStatusGlyph(status) {
  switch (status) {
    case "failed":
      return { glyph: "✕", tone: "blocked" };
    case "attention_required":
    case "needs_input":
      return { glyph: "◐", tone: "blocked" };
    case "active":
      return { glyph: "●", tone: "working" };
    case "idle":
      return { glyph: "●", tone: "idle" };
    default:
      return { glyph: "○", tone: "done" };
  }
}

/**
 * The mark the sidebar and the page draw for a status (from seatStatus) or a tone (statusLook's, for counts and a rig's dot), told
 * apart by shape as well as colour. `color` and `word` name theme() tokens:
 * - `glow` working: an 8 px dot on a 14 px halo that glows natively; the theme's green (`ansi2`)
 * - `diamond` needs you, attention, blocked; `cross` failed (its ✕)
 * - `ring` idle; `check` done; `square` stopped, detached, exited (and a rig with nothing running)
 * - `prompt` a terminal seat, never animated
 */
export function statusMark(key) {
  switch (key) {
    case "active": case "working": return { shape: "glow", color: "ansi2", word: "ansi2" };
    case "needs_input": case "attention_required": case "blocked": return { shape: "diamond", color: "blocked", word: "blocked" };
    case "failed": return { shape: "cross", color: "blocked", word: "blocked" };
    case "terminal_gone": case "gone": return { shape: "cross", color: "blocked", word: "blocked" };
    case "completed": return { shape: "check", color: "done", word: "done" };
    // The tone "done" is statusLook's for every seat that isn't running, so as a tone it reads stopped, not finished.
    case "done": case "stopped": case "detached": case "exited": return { shape: "square", color: "muted", word: "muted" };
    case "terminal": return { shape: "prompt", color: "muted", word: "muted" };
    case "unknown": return { shape: "dashed-ring", color: "muted", word: "dim" };
    default: return { shape: "ring", color: "muted", word: "muted" };
  }
}

/**
 * Draw `statusMark(key)` in a fixed `cell` (so names line up), with the mod's own `div` and `svg` (`ui`) and icon paths
 * (`iconOf`). Status marks are calm at rest; an observed change can supply one bounded native pulse.
 */
export const WORKING_STATUS_PULSE_MS=900,NEED_STATUS_PULSE_MS=1200;
export function statusMarkElement(ui, t, key, { cell = 14, iconOf, pulse = null } = {}) {
  const { div, svg } = ui;
  const m = statusMark(key);
  const c = t[m.color] ?? t.muted;
  const box = div().size(cell).flex_none().flex().items_center().justify_center()
    .when(pulse?.kind==="need",e=>e.relative().child(statusNeedHalo(ui,t,pulse,cell)));
  const dot = Math.round(cell * 8 / 14);
  switch (m.shape) {
    case "glow":
      return box.relative()
        .child(div().absolute().inset_0().rounded(cell).bg(c).opacity(pulse?.kind==="working" && !pulse.started ? .60 : .28)
          .when(pulse?.kind==="working",e=>e.id(pulse.elementId).transition("opacity",{duration:WORKING_STATUS_PULSE_MS,easing:"ease-out"})))
        .child(div().size(dot).rounded(dot).bg(c));
    case "diamond": return box.child(svg(iconOf("rig-diamond")).size(Math.round(cell * 0.64)).text_color(c));
    case "cross": return (key === "terminal_gone" || key === "gone" ? box.tooltip(TERMINAL_GONE_TOOLTIP) : box).child(div().text_size(Math.round(cell * 0.75)).text_color(c).child("✕"));
    case "check": return box.child(svg(iconOf("check")).size(Math.round(cell * 0.8)).text_color(c));
    case "square": return box.child(div().size(Math.round(cell / 2)).rounded(1).border(1.5).border_color(c));
    case "prompt": return box.child(svg(iconOf("rig-terminal-prompt")).size(Math.round(cell * 0.8)).text_color(c));
    case "dashed-ring": return box.tooltip("OpenRig is running this seat but hasn't reported whether it's working.")
      .child(svg(iconOf("rig-unreported")).size(dot+2).text_color(c));
    default: return box.child(div().size(dot).rounded(dot).border(1.5).border_color(c));
  }
}

/** A new actionable need draws one bounded halo around its existing mark, including Priority's compact mark. */
export function statusNeedHalo({div},t,pulse,cell=14){
  return div().id(pulse.elementId).absolute().inset_0().rounded(cell).bg(t.blocked).opacity(pulse.started?0:.55)
    .transition("opacity",{duration:NEED_STATUS_PULSE_MS,easing:"ease-out"});
}

/**
 * TUI 4-state count honesty rule:
 * - known non-zero (`n`)
 * - genuinely zero (`·`, never `0`)
 * - lower bound when `incomplete` (`n+` when `count > 0`, else `?`)
 * - unknown (`?` when `count == null` or `unknown: true`)
 */
export function formatHonestCount(count, { incomplete = false, unknown = false } = {}) {
  if (unknown || count === null || count === undefined || typeof count === "boolean" || Number.isNaN(Number(count))) {
    return "?";
  }
  const n = Number(count);
  if (incomplete) {
    return n > 0 ? `${n}+` : "?";
  }
  return n === 0 ? "·" : String(n);
}

/** Whether a rig is stopped/paused (`lifecycle === "stopped"`, or `"recoverable"` when no seat is running/working). */
export function isRigStopped(lifecycle, seats = []) {
  if (lifecycle === "stopped") return true;
  if (lifecycle === "recoverable") {
    const list = Array.isArray(seats) ? seats : [];
    return !list.some((s) => s.tone === "working" || s.status === "active" || s.status === "running" || s.status === "ready");
  }
  return false;
}

/** The worst status among seats, for a rig's dot. */
export function worstTone(tones) {
  // A seat whose tmux server stopped answering is worse than working or idle (nothing reaches it), though not a request.
  const rank = { blocked: 4, gone: 3, working: 2, idle: 1, done: 0 };
  return tones.reduce((worst, t) => (rank[t] ?? 0) > (rank[worst] ?? -1) ? t : worst, "done");
}

/** A rig's dot from its seats' tones: the worst agent's. A rig whose running seats are all terminals reads `terminal`
 *  (it runs, though no agent counts); the square ("done") stays for a rig with nothing running. */
export function rigTone(seats) {
  const list = seats ?? [];
  const agents = list.filter((s) => !s.terminal);
  const worst = agents.length ? worstTone(agents.map((s) => s.tone)) : "done";
  // Terminal seats count here too: a terminal-only rig whose tmux server is gone reads gone, not stopped.
  if (worst !== "blocked" && list.some((s) => s.tone === "gone")) return "gone";
  return worst === "done" && list.some((s) => s.terminal && s.status === "terminal") ? "terminal" : worst;
}

/** A node's host: `/api/ps` entries carry `hostSelfId`; older shapes `host` or `hostId`. */
export const hostOf = (n) => n?.host ?? n?.hostSelfId ?? n?.hostId ?? null;

/** Rigs → pods → seats, from `/api/rigs/summary` and each rig's `/api/rigs/:id/nodes`. */
/** OpenRig's representative can change with the rig roster, not with seat activity. */
export async function readRigRepresentative(feed, get, rigId, nodes) {
  if (!Array.isArray(nodes)) return null;
  const roster = nodes.map((node) => JSON.stringify([node.nodeId, node.canonicalSessionName])).sort();
  const key = JSON.stringify([feed.config?.daemonUrl, feed.config?.daemonMachine, feed.config?.openrigHome, roster]);
  const cache = feed.rigRepresentatives ??= new Map();
  const hit = cache.get(rigId);
  if (hit?.key === key) return hit.session;
  const detail = await get(`/api/rigs/${encodeURIComponent(rigId)}`).catch(rethrowGate(null));
  if (detail?.rig?.id !== rigId || (detail.representative !== null && !isValidSessionName(detail.representative))) return null;
  const session = detail.representative;
  cache.set(rigId, { key, session });
  return session;
}

export function buildTopology(summary, nodesByRig, nativeSeats = [], conn = null, representatives = {}) {
  // Native seats (placement: herdr) by session, with their live `hc run` children.
  const native = new Map((Array.isArray(nativeSeats) ? nativeSeats : []).map((s) => [s.sessionName, s]));
  return (summary ?? []).filter((r) => !r.archivedAt).map((rig) => {
    const nodes = (nodesByRig[rig.id] ?? []).filter((n) => n.nodeKind !== "service");
    const pods = new Map();
    for (const n of nodes) {
      const pod = n.podNamespace ?? n.podId ?? "";
      const status = seatStatus(n);
      const look = statusLook(status);
      const glyphInfo = rowStatusGlyph(status);
      if (!pods.has(pod)) pods.set(pod, []);
      pods.get(pod).push({
        ...(conn ? { conn } : {}),
        logicalId: n.logicalId,
        member: n.logicalId.includes(".") ? n.logicalId.slice(n.logicalId.indexOf(".") + 1) : n.logicalId,
        session: n.canonicalSessionName,
        ...(representatives[rig.id] && n.canonicalSessionName === representatives[rig.id] ? { isRepresentative: true } : {}),
        sessionStatus: n.sessionStatus ?? null,
        runtime: n.runtime ?? null,
        terminal: isTerminalSeat(n),
        model: n.model ?? null,
        effort: n.effort ?? null,
        role: n.role ?? null,
        slice: n.slice ?? n.activeSlice ?? null,
        status,
        ...look,
        glyph: glyphInfo.glyph,
        glyphTone: glyphInfo.tone,
        work: n.assignedWorkCount ?? 0,
        assignedWorkCount: n.assignedWorkCount ?? null,
        pendingWorkCount: n.pendingWorkCount ?? null,
        inProgressWorkCount: n.inProgressWorkCount ?? null,
        blockedWorkCount: n.blockedWorkCount ?? null,
        host: hostOf(n),
        pod,
        cwd: n.cwd ?? null,
        profile: n.profile ?? null,
        spec: n.resolvedSpecName ?? null,
        resolvedSpecName: n.resolvedSpecName ?? null,
        resolvedSpecVersion: n.resolvedSpecVersion ?? null,
        resolvedSpecHash: n.resolvedSpecHash ?? null,
        tmuxAttachCommand: n.tmuxAttachCommand ?? null,
        nodeId: n.nodeId,
        context: n.contextUsage?.usedPercentage ?? null,
        contextUsage: n.contextUsage ?? null,
        agentActivity: n.agentActivity ?? null,
        activityState: n.activityState ?? null,
        needsAttention: n.needsAttention ?? null,
        arbitratedNeedsInput: n.arbitratedNeedsInput ?? null,
        needsInputEvidence: n.needsInputEvidence ?? null,
        communityHarness: n.communityHarness ?? false,
        ...(native.has(n.canonicalSessionName) ? { native: nativeInfo(native.get(n.canonicalSessionName)) } : {}),
      });
    }
    const seats = [...pods.values()].flat();
    const rigHost = rig.host ?? rig.hostId ?? seats.find((s) => s.host)?.host ?? "local";
    return {
      id: rig.id,
      ...(conn ? { conn } : {}),
      name: rig.name,
      host: rigHost,
      lifecycle: rig.lifecycleState,
      seatCount: seats.length,
      tone: rigTone(seats),
      pods: [...pods].map(([name, podSeats]) => ({ name, seats: podSeats, ...(conn ? { conn } : {}) })),
    };
  });
}

/** One rig for the Topology block, from its summary row and `/api/rigs/:id/nodes`: seats with what a filter matches on, grouped by pod. */
export function formatSeatContextPct(seat) {
  const raw = seat?.context ?? seat?.contextUsage?.usedPercentage;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return `${Math.round(raw)}%`;
}

export function isSeatContextWarning(seat) {
  const raw = seat?.context ?? seat?.contextUsage?.usedPercentage;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 85;
}

export function rigModel(rig, nodes, nativeSeats = [], conn = null) {
  const native = new Map((Array.isArray(nativeSeats) ? nativeSeats : []).map((s) => [s.sessionName, s]));
  const seats = (nodes ?? []).filter((n) => n.nodeKind !== "service").map((n) => {
    const status = seatStatus(n);
    const look = statusLook(status);
    const glyphInfo = rowStatusGlyph(status);
    return {
      ...(conn ? { conn } : {}),
      logicalId: n.logicalId,
      member: n.logicalId?.includes(".") ? n.logicalId.slice(n.logicalId.indexOf(".") + 1) : n.logicalId,
      session: n.canonicalSessionName,
      runtime: n.runtime ?? null,
      terminal: isTerminalSeat(n),
      model: n.model ?? null,
      effort: n.effort ?? null,
      role: n.role ?? null,
      slice: n.slice ?? n.activeSlice ?? null,
      host: hostOf(n),
      pod: n.podNamespace ?? n.podId ?? "",
      cwd: n.cwd ?? null,
      profile: n.profile ?? null,
      spec: n.resolvedSpecName ?? null,
      resolvedSpecName: n.resolvedSpecName ?? null,
      resolvedSpecVersion: n.resolvedSpecVersion ?? null,
      resolvedSpecHash: n.resolvedSpecHash ?? null,
      tmuxAttachCommand: n.tmuxAttachCommand ?? null,
      work: n.assignedWorkCount ?? 0,
      assignedWorkCount: n.assignedWorkCount ?? null,
      pendingWorkCount: n.pendingWorkCount ?? null,
      inProgressWorkCount: n.inProgressWorkCount ?? null,
      blockedWorkCount: n.blockedWorkCount ?? null,
      context: n.contextUsage?.usedPercentage ?? null,
      contextUsage: n.contextUsage ?? null,
      agentActivity: n.agentActivity ?? null,
      activityState: n.activityState ?? null,
      needsAttention: n.needsAttention ?? null,
      arbitratedNeedsInput: n.arbitratedNeedsInput ?? null,
      needsInputEvidence: n.needsInputEvidence ?? null,
      status,
      ...look,
      glyph: glyphInfo.glyph,
      glyphTone: glyphInfo.tone,
      ...(n.native ? { native: n.native } : native.has(n.canonicalSessionName) ? { native: nativeInfo(native.get(n.canonicalSessionName)) } : {}),
    };
  });
  const pods = new Map();
  for (const s of seats) { if (!pods.has(s.pod)) pods.set(s.pod, []); pods.get(s.pod).push(s); }
  const rigHost = rig.host ?? rig.hostId ?? seats.find((s) => s.host)?.host ?? "local";
  return { id: rig.id, ...(conn ? { conn } : {}), name: rig.name, host: rigHost, lifecycle: rig.lifecycleState ?? rig.lifecycle ?? null, seats, pods: [...pods].map(([name, list]) => ({ name, seats: list, ...(conn ? { conn } : {}) })) };
}

/** A "needs you" count with its verb agreeing: "1 needs you", "0 need you", "7 need you". `needsYouWord` is the words alone. */
export const needsYouWord = (n) => (n === 1 ? "needs you" : "need you");
export const needsYouText = (n) => `${n} ${needsYouWord(n)}`;
/** Seat counts by status for a header or pod line: working, needs you (blocked), idle. */
export function statusCounts(seats) {
  const n = (tone) => seats.filter((s) => s.tone === tone).length;
  return { working: n("working"), needs: n("blocked"), idle: n("idle"), unreported: seats.filter(s=>s.status==="unknown").length, ...(n("gone") ? { gone: n("gone") } : {}) };
}

/** What herdrig's Spaces list shows for rig spaces, published as the shared key `herdrig.spaces`: space id -> `{ home: true }` for the
 *  OpenRig home, or `{ rig, rigId, status, needs }` for a rig's own grid space (marked as ours, from the same OpenRig as `config`).
 *  Recognised by the labels and the home record herdrig already keeps, never by a space's name. `status` is the rig's own: "needs" when
 *  a seat needs the person, else "working" when one works, else "idle". Plain data: the list only reads it. */
export function rigSpaceMarks({ spaces = [], terminals = [], panes = [], state = {}, topology = [], config = {}, hostId = null, contexts = null } = {}) {
  const expected = rigOrigin(config?.daemonUrl), rigs = new Map((topology ?? []).map((r) => [r.name, r]));
  const machine = config?.daemonMachine || null, out = {};
  const machineOf = (context) => context.space.machine ?? (String(context.id ?? "").includes("/") ? String(context.id).split("/")[0] : null);
  // `contexts`: the spaces' contexts made once for every connection (they don't depend on the connection).
  for (const context of contexts ?? openRigSpaceContext(spaces, terminals, panes, state)) {
    if (context.home) {
      // With several OpenRigs each feed marks only ITS OWN home, stamped with its connection, so the Spaces menu (Open Rig page, Attach
      // operator) acts on that OpenRig, never the one the sidebar happens to show. Ownership is the recorded home, never a name: its
      // homeSpaces entry, else the legacy record (the first connection's) when no entry claims the space. One connection: unchanged.
      if ((config?.connections?.length ?? 0) < 2) { out[context.id] = { home: true }; continue; }
      const homes = state?.homeSpaces ?? {}, own = homes[homeKey(config)] === context.id
        || (state?.homeSpace === context.id && !Object.values(homes).includes(context.id) && (config?.connectionId ?? LEGACY_CONNECTION_ID) === LEGACY_CONNECTION_ID);
      if (own) out[context.id] = { home: true, conn: config.connectionId };
      continue;
    }
    // The machine restriction applies to BOTH branches below. Without it, two machines answering on the same
    // loopback URL with a same-named rig cross-wire here — and these marks drive the Spaces menu, so an action could reach the other
    // machine's rig. `resolveRigSpace` filters by machine before choosing a space; this must agree with it.
    // With no machine configured this still filters to local spaces, which is exactly what `lookup` does: a mark must agree with
    // what `resolveRigSpace` would open, and with no daemonMachine that is only a local space. A box space getting the local rig id
    // would offer a menu action the open would not use.
    if (machineOf(context) !== machine) continue;
    let links = context.markedRigLinks.filter((l) => !l.origin || rigOrigin(l.origin) === expected);
    // The same vouching the open uses (v0.4.3), read-only: a space made under another loopback spelling of this daemon's address is
    // the rig's own space when its host stamp equals the daemon's, or (older spaces) the daemon lists every seat in it. Nothing is written.
    if (!links.length && expected && machine && machineOf(context) === machine) {
      links = context.markedRigLinks.filter((l) => {
        const rig = rigs.get(l.rig);
        return rig && sameDaemonOrigin(l.origin, config.daemonUrl, machine)
          && vouchedSpace({ terminals }, context.space, new Set([l.rig]), { sessions: rigSessions(rig), servers: rigSeatServers(rig), hostId }) === "same";
      });
    }
    const link = links.find((l) => rigs.has(l.rig)) ?? links[0];
    if (!link) continue;
    const found = rigs.get(link.rig), counts = found ? statusCounts(found.seats ?? (found.pods ?? []).flatMap((p) => p.seats ?? [])) : { needs: 0, working: 0 };
    const uniqueSpaceOwner = !found && (config?.connections?.length ?? 0) >= 2 && link.origin && expected && rigOrigin(link.origin) === expected && config.connectionId
      && config.connections.filter((c) => (c?.machine || null) === machine && rigOrigin(c?.daemonUrl) === expected).length === 1;
    const spaceConn = uniqueSpaceOwner ? config.connectionId : null;
    out[context.id] = { rig: link.rig, rigId: found?.id ?? null, ...(found?.conn ? { conn: found.conn } : spaceConn ? { spaceConn } : {}), status: counts.needs ? "needs" : counts.working ? "working" : "idle", needs: counts.needs };
  }
  return out;
}

/** A rig starts open when it runs or any seat needs the person; a stopped rig with no needs is one line. */
export function rigOpenDefault(rig, seats = []) {
  return !isRigStopped(rig.lifecycleState ?? rig.lifecycle, seats) || seats.some((s) => s.tone === "blocked");
}
/** A pod past 12 seats starts as a summary line unless a seat needs the person. */
export const POD_FOLD_AT = 12;
export function podOpenDefault(seats = []) {
  return seats.length <= POD_FOLD_AT || seats.some((s) => s.tone === "blocked");
}
/** The fold keys: one model, two states. The sidebar keeps `shared("rig.open.sidebar")` (persisted), the page
 *  `shared("rig.open.page")` (in memory), so folding on one never folds the other. */
export const branchKey = (section) => `branch:${section}`;
export const hostKey = (host) => `host:${host}`;
export const rigKey = (rigId) => `rig:${rigId}`;
export const viewsKey = (rigId) => `views:${rigId}`;
export const podKey = (rigId, pod) => `pod:${rigId}/${pod}`;
const blockedCount = (seats) => seats.filter((s) => s.tone === "blocked").length;

/** The page folds to open so a target opened from the sidebar shows: its rig, and for a seat or pod its pod. Only the
 *  page's state changes; the sidebar's folds are its own. */
export function pageRevealOpen(open, entry) {
  const next = { ...(open ?? {}) };
  const rigId = entry?.rigId;
  if (!rigId || (entry.kind !== "rig" && entry.kind !== "pod" && entry.kind !== "seat")) return next;
  next[rigKey(rigId)] = true;
  const pod = entry.kind === "pod" ? entry.pod ?? entry.name : entry.pod;
  if (pod) next[podKey(rigId, pod)] = true;
  return next;
}
/** Whether a fold is open: a stored choice wins, except that a collapse never hides a seat that started needing the
 *  person after it was made (the count of blocked seats at collapse time is kept beside it). */
function foldOpen(stored, key, openMap, seats, fallback) {
  if (stored === undefined) return fallback;
  return stored || blockedCount(seats) > (openMap[`${key}:blocked`] ?? 0);
}
export function branchFoldOpen(first, second = {}, third = undefined) {
  let openMap;
  let key;
  let fallback;
  if (typeof first === "object" && first !== null && typeof second === "string") {
    openMap = first;
    key = second.includes(":") ? second : branchKey(second);
    fallback = typeof third === "boolean" ? third : (key === "branch:topology");
  } else {
    const section = String(first ?? "");
    key = section.includes(":") ? section : branchKey(section);
    openMap = second && typeof second === "object" ? second : {};
    const hasNeeds = typeof third === "boolean" ? third : Boolean(third?.hasNeeds);
    fallback = typeof third === "boolean" ? third : (key === "branch:topology" || (key === "branch:needs" && hasNeeds));
  }
  const stored = openMap?.[key];
  if (stored === undefined) return Boolean(fallback);
  return Boolean(stored);
}
export function rigFoldOpen(rig, seats = [], openMap = {}) {
  const key = rigKey(rig.id);
  return foldOpen(openMap[key], key, openMap, seats, rigOpenDefault(rig, seats));
}
export function podFoldOpen(rigId, podName, seats = [], openMap = {}) {
  const key = podKey(rigId, podName);
  return foldOpen(openMap[key], key, openMap, seats, podOpenDefault(seats));
}
/** The fold map after a choice; a collapse notes how many seats need the person right then. */
export function foldChoice(openMap, key, open, seats = []) {
  return { ...(openMap ?? {}), [key]: open, [`${key}:blocked`]: blockedCount(seats) };
}

/** Expand every branch, host, rig, views folder, pod, spec folder, mission, terminal group, and system sub-branch. */
export function expandAllTopology(openMap = {}, models = [], extra = {}) {
  let next = { ...(openMap ?? {}) };
  for (const sec of RIG_SECTIONS) next[branchKey(sec)] = true;
  for (const m of Array.isArray(models) ? models : []) {
    if (!m || typeof m !== "object") continue;
    const rigId = m.id ?? m.rig?.id;
    const rigName = m.name ?? m.rig?.name;
    const h = m.host ?? m.rig?.host ?? "local";
    next[hostKey(h)] = true;
    if (!rigId) continue;
    const pods = Array.isArray(m.pods) ? m.pods : [];
    const rigSeats = Array.isArray(m.seats) ? m.seats : pods.flatMap((p) => p?.seats ?? []);
    next = foldChoice(next, rigKey(rigId), true, rigSeats);
    next[viewsKey(rigId)] = true;
    if (rigName && rigName !== rigId && rigKey(rigName) in next) {
      next = foldChoice(next, rigKey(rigName), true, rigSeats);
    }
    for (const pod of pods) {
      const podName = pod?.name ?? "";
      next = foldChoice(next, podKey(rigId, podName), true, pod?.seats ?? []);
    }
  }
  for (const kind of ["rig", "agent", "workflow"]) next[`specs-kind:${kind}`] = true;
  for (const s of Array.isArray(extra?.specs) ? extra.specs : []) {
    const ns = specNamespaceOf(s?.name ?? s?.id);
    if (ns) next[`folder:${ns}`] = true;
  }
  for (const p of Array.isArray(extra?.projects) ? extra.projects : []) {
    const pid = p?.id ?? p?.project ?? p;
    if (pid) next[`project:${pid}`] = true;
  }
  for (const m of Array.isArray(extra?.missions) ? extra.missions : []) {
    if (m?.mission) next[`mission:${m.mission}`] = true;
  }
  next["terminals:saved"] = true;
  next["terminals:derived"] = true;
  next["needs:action"] = true;
  next["needs:update"] = true;
  next["system:config"] = true;
  for (const k of Object.keys(next)) {
    if ((k.startsWith("folder:") || k.startsWith("mission:") || k.startsWith("project:") || k.startsWith("views:") || k.startsWith("host:")) && next[k] === false) {
      next[k] = true;
    }
  }
  return next;
}

/** Collapse branches, rigs, and pods in `models`, skipping any branch, host, rig, or pod that has a needs-you item. */
export function collapseAllTopology(openMap = {}, models = [], extra = {}) {
  let next = { ...(openMap ?? {}) };
  const hasActionableNeeds = Number(extra?.attentionCount ?? 0) > 0
    || (Array.isArray(extra?.attentionItems) && extra.attentionItems.some((i) => i && i.kind !== "update" && !i.update));
  let anyBlockedRig = false;
  const blockedHosts = new Set();
  for (const m of Array.isArray(models) ? models : []) {
    if (!m || typeof m !== "object") continue;
    const rigId = m.id ?? m.rig?.id;
    const rigName = m.name ?? m.rig?.name;
    const h = m.host ?? m.rig?.host ?? "local";
    if (!rigId) continue;
    const pods = Array.isArray(m.pods) ? m.pods : [];
    const rigSeats = Array.isArray(m.seats) ? m.seats : pods.flatMap((p) => p?.seats ?? []);
    const rigHasBlocked = rigSeats.some((s) => s?.tone === "blocked");
    if (rigHasBlocked) {
      anyBlockedRig = true;
      blockedHosts.add(h);
      next = foldChoice(next, rigKey(rigId), true, rigSeats);
      if (rigName && rigName !== rigId && rigKey(rigName) in next) {
        next = foldChoice(next, rigKey(rigName), true, rigSeats);
      }
    } else {
      next = foldChoice(next, rigKey(rigId), false, rigSeats);
      if (rigName && rigName !== rigId && rigKey(rigName) in next) {
        next = foldChoice(next, rigKey(rigName), false, rigSeats);
      }
    }
    next[viewsKey(rigId)] = false;
    for (const pod of pods) {
      const podName = pod?.name ?? "";
      const podSeats = pod?.seats ?? [];
      const podHasBlocked = podSeats.some((s) => s?.tone === "blocked");
      next = foldChoice(next, podKey(rigId, podName), podHasBlocked, podSeats);
    }
    next[hostKey(h)] = blockedHosts.has(h);
  }
  for (const sec of RIG_SECTIONS) {
    if (sec === "topology") next[branchKey(sec)] = anyBlockedRig;
    else if (sec === "needs") next[branchKey(sec)] = hasActionableNeeds;
    else next[branchKey(sec)] = false;
  }
  for (const k of Object.keys(next)) {
    if (k.startsWith("specs-kind:") || k.startsWith("folder:") || k.startsWith("project:") || k.startsWith("mission:") || k.startsWith("terminals:") || k === "system:config") {
      next[k] = false;
    }
  }
  next["needs:action"] = hasActionableNeeds;
  next["needs:update"] = false;
  return next;
}

/** Extract the namespace prefix of an agent spec (`foo/bar` -> `foo`, else `null` for root). */
export function specNamespaceOf(specOrName) {
  const s = typeof specOrName === "object" && specOrName !== null
    ? String(specOrName.name ?? specOrName.id ?? "")
    : String(specOrName ?? "");
  const slash = s.indexOf("/");
  return slash > 0 ? s.slice(0, slash) : null;
}

/** Rigs that need the person first, then running, then stopped; stable within each group.
 *  When `focusRig` (rig id, rig name, or `rig:<id|name>`) is given, that rig floats to index 0. */
export function orderRigs(models, focusRig = null) {
  const target = typeof focusRig === "string" && focusRig.startsWith("rig:") ? focusRig.slice(4) : focusRig;
  const isFocused = (m) => Boolean(target && (m.id === target || m.name === target || m.rig?.id === target || m.rig?.name === target));
  const rank = (m) => isFocused(m) ? -1 : (m.seats ?? []).some((s) => s.tone === "blocked") ? 0 : isRigStopped(m.lifecycle ?? m.rig?.lifecycleState ?? m.rig?.lifecycle, m.seats ?? []) ? 2 : 1;
  return models.map((m, i) => [m, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([m]) => m);
}

/** Worst health severity chip for the Sidebar `System` row. */
export function worstHealthChip(records, { loading = false, error = null } = {}) {
  if (error) return { label: "unavailable", tone: "dim", count: 0, tooltip: error };
  if (records === null) return { label: "?", tone: "dim", count: 0, tooltip: "OpenRig didn't report its health." };
  if (!Array.isArray(records)) return { label: null, tone: "dim", count: 0 };
  const { problems, worst } = healthCounts(records);
  const label = `${problems} issue${problems === 1 ? "" : "s"}`;
  if (problems > 0) return { label, tone: worst === 2 ? "danger" : "warning", count: problems };
  return { label: "ok", tone: "dim", count: 0 };
}

/** A native seat as the sidebar shows it: its terminal, whether it's live, and its children's labels. */
export function nativeInfo(seat) {
  return { address: seat.address, live: !!seat.live,
    children: (seat.children ?? []).map((c) => ({ address: c.address, label: c.name || (c.argv ?? []).join(" ").slice(0, 60) || c.address })) };
}

/** The TUI's eleven sections folded into the Rig's six (as the TUI's own SYSTEM_SECTIONS group them). */
export const RIG_SECTIONS = ["topology", "specs", "scopes", "terminals", "needs", "system"];
export const SECTION_TITLES = { topology: "Topology", specs: "Specs", scopes: "Scopes", terminals: "Terminals", needs: "Needs", system: "System" };

/**
 * Normalize `/api/terminal/preview` `composed` data for a view.
 * When a `rig:<name>` view reports no opened, absent or degraded seats against a daemon that dropped unattached seats,
 * synthesizes `absent` entries (`reason: "seat-not-running"`) from the rig's topology seats so preview never reports `0 absent`.
 */
export function normalizeTerminalPreview(composed, viewKey, topology = []) {
  const rawOpened = Array.isArray(composed?.opened) ? composed.opened : [];
  const rawAbsent = Array.isArray(composed?.absent) ? composed.absent : [];
  const rawDegraded = Array.isArray(composed?.degraded) ? composed.degraded.filter((seat) => seat && typeof seat === "object") : [];
  const rawPages = Array.isArray(composed?.pages) ? composed.pages : [];
  const rigName = String(viewKey ?? "").startsWith("rig:") ? String(viewKey).slice(4) : null;
  const rig = rigName
    ? (Array.isArray(topology) ? topology : []).find((r) => r.name === rigName || r.id === rigName) ?? null
    : null;
  const rigSeats = rig
    ? (Array.isArray(rig.seats) ? rig.seats : (rig.pods ?? []).flatMap((p) => p?.seats ?? []))
    : [];
  const labelledUnavailable = (rows) => rows.map((a) => {
    if (!a || typeof a !== "object") return a;
    if (a.label) return a;
    const rawSeat = a.seat ?? a.sessionName ?? a.logicalId ?? null;
    const matched = rawSeat
      ? rigSeats.find((s) => s.session === rawSeat || s.canonicalSessionName === rawSeat || s.logicalId === rawSeat)
      : null;
    const derivedLabel = matched?.logicalId ?? a.logicalId ?? (typeof rawSeat === "string" ? rawSeat.split("@")[0].replace(/-/g, ".") : null);
    return derivedLabel ? { ...a, label: derivedLabel } : a;
  });
  const synthesizedAbsent = !rawOpened.length && !rawAbsent.length && !rawDegraded.length && rigSeats.length
    ? rigSeats.map((s) => ({
        seat: s.session ?? s.canonicalSessionName ?? s.logicalId,
        label: s.logicalId ?? s.member ?? s.session,
        reason: "seat-not-running",
      }))
    : labelledUnavailable(rawAbsent);
  const allAbsentStopped = rawOpened.length === 0
    && synthesizedAbsent.length > 0
    && synthesizedAbsent.every((a) => a.reason === "seat-not-running" || /not alive/i.test(String(a.reason ?? "")));
  const rigStopped = rig
    ? isRigStopped(rig.lifecycle ?? rig.lifecycleState, rigSeats)
      || ((rig.lifecycle ?? rig.lifecycleState) !== "running" && allAbsentStopped)
    : Boolean(rigName) && allAbsentStopped;
  return {
    opened: rawOpened,
    absent: synthesizedAbsent,
    degraded: labelledUnavailable(rawDegraded),
    pages: rawPages,
    rigName,
    rig,
    rigStopped,
  };
}

/** Whether a layout tree contains the legacy `rig-work` stack (`false` on native-tab layouts). */
export function hasRigWorkStack(node) {
  if (!node || typeof node !== "object") return false;
  if (node.id === "rig-work") return true;
  return Array.isArray(node.children) && node.children.some(hasRigWorkStack);
}

/** Extract `{ revision, views }` from a layout (`pane.header` or `rig-sidebar`), a legacy `rig-work` header, or `shared("rig.views")`. */
export function viewsPropsFromLayout(node, sharedFn = null) {
  let found = null;
  const walk = (n) => {
    if (!n || typeof n !== "object" || found) return;
    const paneHeader = n.content?.pane?.header?.content;
    if (["rig-cell-header", "herdrig-cell-header"].includes(paneHeader?.mod) && Array.isArray(paneHeader.props?.views)) {
      found = paneHeader.props;
      return;
    }
    if ((n.id === "rig-sidebar" || n.content?.mod === MOD_IDS.sidebar) && Array.isArray(n.content?.props?.views)) {
      found = n.content.props;
      return;
    }
    if (n.id === "rig-work" && Array.isArray(n.header?.content?.props?.views)) {
      found = n.header.content.props;
      return;
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(node);
  if (found) return found;
  const sharedViews = typeof sharedFn === "function" ? sharedFn("rig.views") : null;
  if (Array.isArray(sharedViews)) return { views: sharedViews };
  return null;
}

/** Find an open native tab in the active space that displays `mod === MOD_IDS.view`. */
export function findRigTab(spaces = [], panes = []) {
  const spList = Array.isArray(spaces) ? spaces : [];
  const pnList = Array.isArray(panes) ? panes : [];
  const activeSpace = spList.find((s) => s?.active) ?? spList[0] ?? null;
  const tabs = activeSpace?.tabs ?? [];
  const tabIds = new Set(tabs.map((t) => t?.id).filter(Boolean));
  const paneHit = pnList.find((p) => p?.mod === MOD_IDS.view && (!tabIds.size || tabIds.has(p.tab)));
  if (paneHit?.tab) return paneHit.tab;
  const tabHit = tabs.find((t) => !t?.settled && (t?.mod === MOD_IDS.view || t?.content?.mod === MOD_IDS.view));
  return tabHit?.id ?? null;
}

/** Explicit page navigation uses the shared space router; failure is visible and personal tabs stay untouched. */
/** Whether the active space's active tab is a Rig page. */
export function rigPageOnScreen(spaces, panes) {
  try {
    const space = (spaces?.() ?? []).find((s) => s?.active), tab = (space?.tabs ?? []).find((t) => t?.active);
    return Boolean(tab?.id && (panes?.() ?? []).some((p) => p?.mod === MOD_IDS.view && p.tab === tab.id));
  } catch (_) { return false; }
}
/** The id of the Rig tab on screen (the active space's active tab, when it holds a Rig page), else null. */
export function onScreenRigTab(spaces, panes) {
  try {
    const space = (spaces?.() ?? []).find((s) => s?.active), tab = (space?.tabs ?? []).find((t) => t?.active);
    // Exactly one Rig pane: a tab with Rig panes split in it keeps the shared history, so it has no tab history of its own.
    return tab?.id && (panes?.() ?? []).filter((p) => p?.mod === MOD_IDS.view && p.tab === tab.id).length === 1 ? tab.id : null;
  } catch (_) { return null; }
}
/** The Rig page on screen and the OpenRig(s) it shows, read now: null when no Rig page is on screen; `{ single: true }` with one OpenRig; else `{ conns }`, the
 *  OpenRigs the tab on screen draws (several when panes are split). A machine's space is that machine's OpenRig (the rule the page itself uses); any other space
 *  is what the Rig pages in the active tab say (`rig.pageOnScreen[tab].views`, each page writing only its own entry, trusted only for the space it names). */
export function onScreenRigPage(host, environment, read) {
  try {
    const spaces = host.spaces ?? environment.spaces, panes = host.panes ?? environment.panes;
    if (!rigPageOnScreen(spaces, panes)) return null;
    const config = host.currentConfig?.() ?? environment.currentConfig?.() ?? host.config ?? environment.config;
    const connections = config?.connections ?? [];
    if (connections.length === 0) return { conns: [] }; // the settings are not known here: nothing can be said to belong to the tab
    if (connections.length === 1) return { single: true };
    const space = (spaces?.() ?? []).find((s) => s?.active), tab = (space?.tabs ?? []).find((t) => t?.active);
    if (spaceMachine(space)) {
      const picked = followedConnection({ connections, space });
      if (picked.why === "space") return { conns: [picked.id] };
    }
    const record = read?.("rig.pageOnScreen")?.[tab?.id];
    return { conns: record?.space === space?.id ? Object.values(record.views ?? {}).filter(Boolean) : [] };
  } catch (_) { return null; }
}
/** The Rig tab in a space that an open with no source lands in: the active tab when it's a Rig tab, else the newest-changed unsettled one, else
 *  the first unsettled, else a settled one. */
export function pickRigTab(space, rigTabIds, tabPages = {}) {
  const tabs = (space?.tabs ?? []).filter((t) => rigTabIds.includes(t?.id));
  if (!tabs.length) return null;
  const active = tabs.find((t) => t.active);
  if (active) return active.id;
  const unsettled = tabs.filter((t) => !t.settled);
  const newest = [...unsettled].sort((a, b) => (tabPages?.[b.id]?.at ?? -1) - (tabPages?.[a.id]?.at ?? -1))[0];
  return (newest && tabPages?.[newest.id] ? newest : unsettled[0] ?? tabs[0]).id;
}
export function openOrFocusRigTab(host = {}, entry = null) {
  const environment = routingEnvironment?.(entry?.conn) ?? {};
  // The default page names its OpenRig when several are set up: an unstamped one names none there (activeConnId).
  const defaultConfig = host.config ?? environment.config, defaultConn = (defaultConfig?.connections?.length ?? 0) > 1 ? defaultConfig?.connectionId ?? null : null;
  const current = entry ?? host.shared?.("rig.nav")?.stack?.at(-1) ?? environment.shared?.("rig.nav")?.stack?.at(-1)
    ?? { section: host.section ?? "topology", ...(defaultConn ? { conn: defaultConn } : {}) };
  const publish = host.setShared ?? environment.setShared;
  const read = host.shared ?? environment.shared;
  // A page change made over a Rig page that is already on screen (the palette, a menu, the page's own links) is shown there. Routing it would open and select the
  // connection's home space for a page that names no rig, moving the person out of the rig's own space. It is decided here, now, from the tab on screen: a page that
  // names no rig and sits on that tab's own OpenRig stays; a rig's page, another OpenRig's page, and any page while no Rig page is on screen are routed to.
  const onScreen = onScreenRigPage(host, environment, read);
  // A tab or link clicked on a Rig page that is on screen (`fromPage`) is on that tab whatever the settings say: a page for the same OpenRig (or one that
  // names none, as the page didn't) is shown there even while the tab can't be read (no settings yet, an unstamped page, a machine with no single connection).
  const fromPage = host.fromPage === true, from = fromPage ? host.fromEntry ?? null : null;
  const onTab = Boolean(onScreen) && (onScreen.single === true || (Boolean(current?.conn) && onScreen.conns.includes(current.conn))
    || fromPage && (current?.conn ?? null) === (from?.conn ?? null));
  // ...and a tab of the rig page on screen (Graph, Health, Recent) is that same page: it stays too, with no read of any space and no jump.
  const sameRig = Boolean(from) && Boolean(current?.rigId || current?.rig) && (current.rigId ? current.rigId === from.rigId : current.rig === from.rig);
  const stays = onTab && (sameRig || !current?.rigId && !current?.rig);
  publish?.("rig.nav", navPush(read?.("rig.nav"), current)); // the log of the last page opened anywhere; tabs don't draw from it
  // The tab the open came from: the clicking page's own tab, else the Rig tab on screen. A page that stays goes onto that tab only.
  const sourceTab = host.sourceTab ?? onScreenRigTab(host.spaces ?? environment.spaces, host.panes ?? environment.panes);
  if (stays) {
    const config = host.currentConfig?.() ?? environment.currentConfig?.() ?? host.config ?? environment.config;
    const space = (((host.spaces ?? environment.spaces)?.()) ?? []).find((s) => (s?.tabs ?? []).some((t) => t?.id === sourceTab));
    pushTabPage({ shared: read, setShared: publish, panes: host.panes ?? environment.panes }, sourceTab, current, { spaceConn: machineSpaceConn(config, space) });
    return Promise.resolve({ ok: true, stayed: true });
  }
  const loading = routingNotReady(host, null);
  if (loading) {
    (host.notify ?? environment.notify)?.({ title: "OpenRig", body: loading, level: "warning" });
    return Promise.resolve({ ok: false, reason: loading });
  }
  // A rig's page is routed to that rig's own space; a rig with none opens in the Rig tab on screen (stayIfNoSpace) rather than in the home space.
  // Only an explicit open (the sidebar, the palette, a menu, a need) may make a space; a page's own tab or link never does.
  return routeRigOpen(host, null, { kind: "page", entry: current, ...(onTab ? { stayIfNoSpace: true } : {}), ...(sourceTab ? { sourceTab } : {}), ...(host.mayCreate === true && !fromPage ? { mayCreate: true } : {}) }).then(result => {
    if (!result.ok || result.inPlace) {
      (host.notify ?? environment.notify)?.({ title: "OpenRig", body: result.note ?? result.reason, level: "warning" });
    }
    return result;
  });
}

/** Whether herdr has a space open: `tab.new` needs one, and `space.new` makes one (with its first tab, when given). */
export function hasSpace(spaces) {
  return Array.isArray(spaces) && spaces.length > 0;
}

/**
 * Close a Rig inspection (`×` or `Esc`).
 * Clears `rig.nav`; on legacy `rig-work` stacks selects `main`, while on native tabs leaves tab closing to Herdr's native tab `×`.
 */
export function closeRigInspection(host = {}) {
  host.setShared?.("rig.nav", { stack: [] });
  const layoutTree = typeof host.layout === "function" ? host.layout() : host.layout;
  if (!layoutTree || hasRigWorkStack(layoutTree)) {
    host.run?.("layout.select", { stack: "rig-work", child: "main" });
  }
}

/**
 * Select an open worker view `viewId` (`rv-*`):
 * - On native tabs, finds the native tab whose panes or terminals belong to `viewId` (or whose tab id/name matches) and runs `tab.select`.
 * - On legacy `rig-work` stacks, runs `layout.select { stack: "rig-work", child: viewId }`.
 */
export function selectWorkerView(first = {}, second = null, third = null) {
  let host;
  let viewId;
  let viewObj = third;
  if (typeof first === "string") {
    viewId = first;
    host = second && typeof second === "object" ? second : {};
  } else {
    host = first && typeof first === "object" ? first : {};
    viewId = typeof second === "string" ? second : host.viewId;
    if (!viewObj && second && typeof second === "object") viewObj = second;
  }
  const layoutTree = typeof host.layout === "function" ? host.layout() : host.layout;
  const sp = typeof host.spaces === "function" ? host.spaces() : (host.spaces ?? []);
  const pn = typeof host.panes === "function" ? host.panes() : (host.panes ?? []);
  const tm = typeof host.terminals === "function" ? host.terminals() : (host.terminals ?? []);
  const viewsProps = host.viewsProps ?? (Array.isArray(host.views) ? { views: host.views } : viewsPropsFromLayout(layoutTree, host.shared));
  const view = viewObj ?? (viewsProps?.views ?? []).find((v) => v?.id === viewId) ?? null;
  const viewTerminals = new Set([
    ...(view?.cells ?? []).map((c) => c?.terminal).filter(Boolean),
    ...tm.filter((t) => t?.labels?.["openrig.view"] === viewId).map((t) => t.address),
  ]);
  const paneInView = pn.find((p) => p?.terminal && viewTerminals.has(p.terminal));
  const activeSpace = (Array.isArray(sp) ? sp : []).find((s) => s?.active) ?? sp?.[0] ?? null;
  const tabMatch = view?.tabId
    ?? paneInView?.tab
    ?? (activeSpace?.tabs ?? []).find((t) => t?.id === viewId || (view?.name && (t?.name === view.name || t?.title === `Rig: ${view.name}` || String(t?.title ?? "").startsWith(`Rig: ${view.name} (`))))?.id
    ?? null;
  if (tabMatch) {
    host.run?.("tab.select", { id: tabMatch });
    return { kind: "tab.select", id: tabMatch };
  }
  if (!layoutTree || hasRigWorkStack(layoutTree)) {
    host.run?.("layout.select", { stack: host.stackId ?? "rig-work", child: viewId });
    return { kind: "layout.select", child: viewId };
  }
  host.run?.("tab.select", { id: viewId });
  return { kind: "tab.select", id: viewId };
}

/** Where a seat has a live cell in the open worker views, from the view props (`views[].cells`). */
export function cellsForSeat(stripProps, session) {
  const out = [];
  for (const view of stripProps?.views ?? []) {
    for (const cell of view.cells ?? []) if (cell.seat === session && cell.terminal) out.push({ view: view.id, terminal: cell.terminal });
  }
  return out;
}

/** herdr's panes and terminals indexed once, for a page that resolves many seats in one draw (`seatClickTarget`'s `index`): each pane by its
 *  terminal (the first, as `find` gives), and each terminal (with its position in the list) under every label a seat can be found by. A seat
 *  then looks at its few candidates instead of every terminal and every pane. */
export function seatTerminalIndex(panes = [], terminals = []) {
  const pn = Array.isArray(panes) ? panes : [], tm = Array.isArray(terminals) ? terminals : [];
  const paneByTerminal = new Map(), byLabel = new Map();
  for (const p of pn) if (p?.terminal && !paneByTerminal.has(p.terminal)) paneByTerminal.set(p.terminal, p);
  const add = (key, entry) => { const list = byLabel.get(key); if (list) list.push(entry); else byLabel.set(key, [entry]); };
  tm.forEach((t, at) => {
    const l = t?.labels; if (!l) return;
    if (l["herdr-openrig.role"] === "attach" && l["herdr-openrig.attach"]) add(`attach:${l["herdr-openrig.attach"]}`, { t, at });
    if (l["openrig.role"] === "seat") {
      if (l["openrig.session"]) add(`seat:${l["openrig.session"]}`, { t, at });
      if (l["openrig.seat"] && l["openrig.seat"] !== l["openrig.session"]) add(`seat:${l["openrig.seat"]}`, { t, at });
    }
  });
  return { panes: pn, terminals: tm, paneByTerminal, byLabel };
}

/** Resolve a seat's live pane target in an open worker view or attached/native seat tab, or `{ kind: "card" }` when none is open. With `index`
 *  (seatTerminalIndex of the same panes and terminals) only the terminals a seat can match are checked, in their list order: the same answer. */
export function seatClickTarget(stripProps, shownChild, session, panes = [], terminals = [], origin = undefined, shared = false, index = null) {
  const cells = cellsForSeat(stripProps, session);
  const pn = Array.isArray(panes) ? panes : (Array.isArray(panes?.panes) ? panes.panes : []);
  const tm = Array.isArray(terminals) ? terminals : (Array.isArray(panes?.terminals) ? panes.terminals : []);
  const paneOf = index ? (address) => index.paneByTerminal.get(address) : (address) => pn.find((p) => p?.terminal === address);
  const sess = String(session ?? "").trim();
  const atIdx = sess.lastIndexOf("@");
  const logicalId = atIdx > 0 ? sess.slice(0, atIdx).replace(/-/g, ".") : sess;
  const rig = atIdx > 0 ? sess.slice(atIdx + 1) : "";
  for (const c of cells) {
    const paneHit = paneOf(c.terminal);
    if (paneHit?.tab) c.tab = paneHit.tab;
  }
  let ambiguousReason = null;
  // Every terminal that can match carries one of these labels (the checks below decide); without an index, every terminal is checked.
  const candidates = index ? [...new Map([`attach:${sess}`, `seat:${sess}`, `seat:${logicalId}`].flatMap((key) => index.byLabel.get(key) ?? []).map((e) => [e.at, e.t])).entries()]
    .sort((a, b) => a[0] - b[0]).map(([, t]) => t) : tm;
  for (const t of candidates) {
    if (!t?.address || (t.state !== undefined && t.state !== "live" && t.state !== "running")) continue;
    if (!sameOrigin(t, origin)) continue;
    const isAttach = t.labels?.["herdr-openrig.role"] === "attach" && t.labels?.["herdr-openrig.attach"] === sess;
    const isNativeSeat = t.labels?.["openrig.role"] === "seat" && (
      t.labels?.["openrig.session"] === sess ||
      t.labels?.["openrig.seat"] === sess ||
      (t.labels?.["openrig.seat"] === logicalId && (!rig || !t.labels?.["openrig.rig"] || t.labels?.["openrig.rig"] === rig))
    );
    if (!isAttach && !isNativeSeat) continue;
    // A native-namespace terminal is never focused (rule Y: nothing on it names this daemon); an unlabeled attach terminal
    // with a shared name on several OpenRigs cannot be tied to this box either.
    if (isNativeSeat && !isAttach) { if (shared && origin !== undefined) ambiguousReason ??= SEAT_NAME_SHARED; continue; }
    if (isAttach && !t.labels?.["herdr-openrig.origin"] && shared && origin !== undefined && origin !== null) { ambiguousReason = ATTACH_TAB_UNLABELED; continue; }
    if (cells.some((c) => c.terminal === t.address)) continue;
    const paneHit = paneOf(t.address);
    const tab = paneHit?.tab ?? t.labels?.["herdr.tab"] ?? null;
    if (tab || paneHit) {
      cells.push({ view: tab ?? t.address, ...(tab ? { tab } : {}), terminal: t.address });
    }
  }
  const here = cells.find((c) => c.view === shownChild || (c.tab && c.tab === shownChild));
  if (here) return { kind: "focus", terminal: here.terminal };
  if (cells[0]) return { kind: "select-then-focus", view: cells[0].view, ...(cells[0].tab ? { tab: cells[0].tab } : {}), terminal: cells[0].terminal };
  return ambiguousReason ? { kind: "ambiguous", reason: ambiguousReason } : { kind: "card" };
}

/** The open worker views that include any seat of a rig (for the sidebar's Views branch and badge). */
export function viewsForRig(stripProps, sessions, rigName = null) {
  const set = new Set(sessions);
  return (stripProps?.views ?? []).filter((v) =>
    (v.cells ?? []).some((c) => set.has(c.seat)) ||
    (rigName && (v.rig === rigName || v.following?.target === `rig:${rigName}`))
  ).map((v) => ({
    id: v.id,
    name: v.name ?? v.title ?? v.id,
    ...(v.title ? { title: v.title } : {}),
    ...(v.rig ? { rig: v.rig } : {}),
    ...(v.grid ? { grid: v.grid } : {}),
    ...(v.cells ? { cells: v.cells } : {}),
    ...(v.following ? { following: v.following } : {}),
  }));
}

/** "as of 12:04" for rows from the last good read, after a failed refresh. */
export function asOf(date,timezone=null) {
  return `as of ${formatAbsoluteTime(date,{timezone})}`;
}

/** How the marker names the followed OpenRig when there are several: its machine, "This computer" for a local (or empty) address, and
 *  "OpenRig's machine" for an unnamed remote one, as worker views name it. */
export function followedOpenRigName(config) {
  return config?.daemonMachine || (!config?.daemonUrl || isLoopbackDaemonUrl(config.daemonUrl) ? "This computer" : "OpenRig's machine");
}

/** The always-visible sidebar marker after a failed refresh while the sidebar still holds data: a fixed clock time from the last good
 *  read (never "N min ago", so an outage never redraws it), the followed OpenRig's name when there are several, and a tooltip whose
 *  first sentence is the failure's own plain reason when it has one. No good read yet: null (the cold-start state speaks instead). */
export function notAnsweringMarker({at,timezone=null,name=null,reason=null}={}) {
  if (!at) return null;
  const time=formatAbsoluteTime(at,{timezone});
  const first=String(reason??"").trim().match(/^[^.!?]*[.!?]/)?.[0]?.trim()??"";
  const plain=first&&!/^Couldn't refresh OpenRig\b/i.test(first)?`${first} `:"";
  return {
    text:`${name?`${name} isn't answering`:"Not answering"} · as of ${time}`,
    time,
    tooltip:`${plain}OpenRig hasn't answered since ${time}. The rows below show what it said then. herdrig keeps checking on its own; Retry checks now.`,
  };
}

/** Relative UI time with the exact source timestamp retained by the caller's tooltip. */
export function relativeTimeText(at, now = Date.now()) {
  const stamp = typeof at === "number" ? at : Date.parse(at ?? "");
  if (!Number.isFinite(stamp) || !Number.isFinite(now)) return "time not reported";
  const seconds = (now - stamp) / 1000, elapsed = Math.abs(seconds);
  if (elapsed < 60) return "just now";
  const [n, unit] = elapsed < 3600 ? [Math.floor(elapsed / 60), "min"] : elapsed < 86400
    ? [Math.floor(elapsed / 3600), "hr"] : [Math.floor(elapsed / 86400), "day"];
  const label = `${n} ${unit}${unit === "day" && n !== 1 ? "s" : ""}`;
  return seconds < 0 ? `in ${label}` : `${label} ago`;
}

/** The Pause confirmation's list: every seat that would stop, with what it is doing and owns. A terminal seat is listed as
 *  a terminal (rig down stops it too), never as a busy agent. */
export function pauseSummary(nodes) {
  const seats = (nodes ?? []).filter((n) => n.nodeKind !== "service").map((n) => {
    const status = seatStatus(n);
    return { logicalId: n.logicalId, status, word: statusLook(status).word, tone: statusLook(status).tone, owned: n.assignedWorkCount ?? 0,
      terminal: isTerminalSeat(n) };
  });
  const busy = seats.filter((s) => s.terminal || s.tone !== "idle" && s.tone !== "done" || s.owned > 0);
  return { total: seats.length, busy, seats };
}

/** What a teardown left behind, beside what it stopped: sessions joined with rig attach (`leftRunning`), sessions OpenRig
 *  didn't start and so released instead of stopping (`released`: still running as their owner's), and panes stopped whose
 *  harness's own processes may keep running (`paneOnly`). One note per list. Once anything was released, the headline counts
 *  the released and rig-attach sessions as left running. */
function teardownLeft(json) {
  const list = (key) => (Array.isArray(json?.[key]) ? json[key].filter((s) => typeof s === "string" && s) : []);
  const left = list("leftRunning"), released = list("released"), paneOnly = list("paneOnly");
  const notes = [
    ...(left.length ? [`Still running (joined with rig attach, which OpenRig doesn't stop): ${left.join(", ")}`] : []),
    ...(released.length ? [`Released, not stopped (OpenRig didn't start these, so it leaves them running): ${released.join(", ")}`] : []),
    ...(paneOnly.length ? [`Pane stopped; the agent's own processes may keep running: ${paneOnly.join(", ")}`] : []),
  ];
  // Counted once anything was released: then the released sessions and those joined with rig attach are both still running.
  const stillRunning = released.length ? `, ${released.length + left.length} left running` : "";
  return { notes, stillRunning };
}

/** `rig down <rig> --yes --json` (`TeardownResult`) in the person's words, with what didn't stop. */
export function pauseOutcome(json) {
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  const n = Number(json?.sessionsKilled ?? 0);
  const left = teardownLeft(json);
  const headline = json?.alreadyStopped && !left.stillRunning ? "Already paused: nothing was running."
    : `Paused · ${n} agent${n === 1 ? "" : "s"} stopped${left.stillRunning}`;
  const notes = [
    json?.snapshotId ? `Snapshot ${json.snapshotId} taken first.` : "No snapshot was taken.",
    ...left.notes,
    ...errors.map((e) => `Error: ${e}`),
  ];
  return { ok: errors.length === 0, headline, notes };
}

/** `rig down <rig> --delete --yes --json` (`TeardownResult` with `deleted` / `deleteBlocked`) in the person's words. */
export function deleteOutcome(json, rig) {
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  const n = Number(json?.sessionsKilled ?? 0);
  const deleted = json?.deleted === true;
  const left = teardownLeft(json);
  const headline = deleted ? (json?.alreadyStopped && !left.stillRunning ? `Removed stopped rig ${rig}`
      : n > 0 || left.stillRunning ? `Deleted ${rig} · ${n} agent${n === 1 ? "" : "s"} stopped${left.stillRunning}` : `Deleted ${rig}`)
    : json?.deleteBlocked ? `${rig} wasn't deleted: some sessions couldn't be stopped`
    : `${rig} wasn't deleted`;
  const notes = [
    json?.snapshotId ? `Snapshot ${json.snapshotId} taken first.` : "No snapshot was taken.",
    ...left.notes,
    ...errors.map((e) => `Error: ${e}`),
  ];
  return { ok: deleted && errors.length === 0, headline, notes };
}

/** A rig name OpenRig can make (it goes into every seat's session name, `<member>@<rig>`): letters, digits, `.`, `_`
 *  and `-`, starting with a letter or digit, at most 64. Returns the problem, or null. */
export function rigNameProblem(name, { optional = false } = {}) {
  const n = String(name ?? "").trim();
  if (!n) return optional ? null : "Give the rig a name.";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(n)) return "A rig name is letters, digits, '.', '_' and '-', starting with a letter or digit (at most 64).";
  return null;
}

/** New rig from a spec: `rig up --cwd <folder> [--name <rig>] --yes -- <spec>`. */
export function newRigFromSpecArgs(spec, folder, name = "") {
  const source = String(spec ?? "").trim();
  if (launchSourceProblem(source) || launchFolderProblem(folder) || rigNameProblem(name, { optional: true })) return null;
  return ["up", "--cwd", String(folder).trim(), ...(String(name ?? "").trim() ? ["--name", String(name).trim()] : []), "--yes", "--", source];
}

/** New one-seat rig: `rig create --runtime <runtime> --cwd <folder> -- <name>`. */
export function newRigOneSeatArgs(name, runtime, folder) {
  const rt = String(runtime ?? "").trim() || "claude-code";
  if (rigNameProblem(name) || launchFolderProblem(folder) || !/^[A-Za-z0-9._-]{1,32}$/.test(rt)) return null;
  return ["create", "--runtime", rt, "--cwd", String(folder).trim(), "--", String(name).trim()];
}

/** A command as the person would type it, for a dialog to show before it runs (display only, never executed). */
export function commandLine(args) {
  return ["rig", ...(args ?? [])].map((a) => (/^[A-Za-z0-9_./:=@,+-]+$/.test(a) ? a : `'${String(a).replace(/'/g, "'\\''")}'`)).join(" ");
}

/** The New rig dialog, for `openOverlay`: from the sidebar's `+` and from the Topology page. */
export function newRigOverlay(conn = null) {
  return { mod: MOD_IDS.menu, kind: "dialog", modal: true, width: 480, height: 700, props: { target: { kind: "new-rig", ...(conn ? { conn } : {}) }, step: { action: "new-rig" } } };
}

/** The runtimes the New rig dialog offers for one seat; `rig create --runtime` takes any OpenRig knows. */
export const NEW_RIG_RUNTIMES = Object.freeze(["claude-code", "codex", "terminal"]);

/**
 * `rig up <rig> --existing --json` (`RestoreResult`: `rigResult`, `nodes[]`, `warnings[]`, `excludedNodes[]`),
 * per seat, in the person's words.
 * - Running whole: `resumed`, `rebuilt`, `operator_recovered`; `fresh`/`fresh-primed` (started fresh by seat policy, said so).
 *   Running seats with `guidanceGaps` or `restoreGaps` stay running (`needsFresh: false`) and show their gap (`ok: false`).
 * - `left_attached` (0.7.17 `NON_RUNNING_LAUNCH_STATUSES`): joined with `rig attach`; nothing was launched (`ok: false`, `needsFresh: false`).
 * - Couldn't resume: `awaiting-decision` and `failed` offer the explicit Start fresh.
 * - `attention_required`: live prompt-blocked seats say to answer in the pane; non-prompt reasons (such as an unconfirmed
 *   blank-session rollback stop or a cleanup owner change in OpenRig 0.7.17) say `"needs attention"` so the label agrees with the reason below it.
 */
const PROMPT_ATTENTION_REASON = /\b(?:waiting for (?:you|model|hook|workspace)|selection prompt|choose in the seat's pane)\b/i;
export function resumeOutcome(json, commandOk = true) {
  const nodes = Array.isArray(json?.nodes) ? json.nodes : [];
  const warnings = Array.isArray(json?.warnings) ? json.warnings.filter((w) => typeof w === "string" && w.trim()) : [];
  const RUNNING_LABEL = { resumed: "resumed", rebuilt: "rebuilt", operator_recovered: "recovered", fresh: "started fresh (seat policy)",
    "fresh-primed": "started fresh (seat policy)" };
  const usedWarnings = new Set();
  const takeGuidanceWarning = (logicalId) => {
    const p1 = `Restore: ${logicalId} is running without part of its guidance:`;
    const p2 = `Restore: ${logicalId}: could not check its guidance:`;
    const hit = warnings.find((w) => !usedWarnings.has(w) && (w.startsWith(p1) || w.startsWith(p2)));
    if (!hit) return null;
    usedWarnings.add(hit);
    return hit.replace(/^Restore:\s*/, "");
  };
  const seats = nodes.map((n) => {
    const logicalId = n.logicalId ?? n.logical_id ?? "?";
    const status = n.status ?? "unknown";
    const guidanceGaps = Array.isArray(n.guidanceGaps) ? n.guidanceGaps.filter((g) => typeof g === "string" && g.trim()) : [];
    const restoreGaps = Array.isArray(n.restoreGaps) ? n.restoreGaps.filter((g) => typeof g === "string" && g.trim()) : [];
    const hasGaps = guidanceGaps.length > 0 || restoreGaps.length > 0;
    const running = status in RUNNING_LABEL;
    const ok = running && !hasGaps;
    const needsFresh = status === "awaiting-decision" || status === "failed";
    const rawError = n.error ?? n.reason ?? null;
    const gapTags = [
      ...(guidanceGaps.length ? [guidanceGaps.length === 1 && guidanceGaps[0] === "(guidance check failed)" ? "guidance check failed" : "missing guidance"] : []),
      ...(restoreGaps.length ? ["restore gap"] : []),
    ];
    const baseLabel = running ? RUNNING_LABEL[status]
      : status === "left_attached" ? "left attached (joined with rig attach)"
      : status === "attention_required" ? (!rawError || PROMPT_ATTENTION_REASON.test(rawError) ? "running, waiting on a prompt: answer it in the pane" : "needs attention")
      : needsFresh ? (status === "failed" ? "failed" : "couldn't resume") : status;
    const label = gapTags.length ? `${baseLabel} · ${gapTags.join(", ")}` : baseLabel;
    const guidanceNote = guidanceGaps.length
      ? (takeGuidanceWarning(logicalId) ?? (guidanceGaps.length === 1 && guidanceGaps[0] === "(guidance check failed)"
        ? "Could not check this seat's guidance." : `Missing guidance blocks: ${guidanceGaps.join(", ")}.`))
      : null;
    const restoreNotes = restoreGaps.map((g) => {
      const hookWarn = warnings.find((w) => !usedWarnings.has(w) && w.startsWith("Restore activity hooks:") && w.includes(logicalId));
      if (hookWarn) usedWarnings.add(hookWarn);
      const ctxWarn = warnings.find((w) => !usedWarnings.has(w) && w.startsWith(`Restore: ${logicalId}: no saved startup context`));
      if (ctxWarn) usedWarnings.add(ctxWarn);
      return g;
    });
    const details = [
      ...(rawError ? [String(rawError)] : status === "left_attached" ? ["Joined with rig attach as an external CLI; nothing was launched in its place."] : []),
      ...(guidanceNote ? [guidanceNote] : []),
      ...restoreNotes,
    ];
    return { logicalId, status, label, error: details.length ? details.join("\n") : null, ok, needsFresh };
  });
  const skipped = (Array.isArray(json?.excludedNodes) ? json.excludedNodes : [])
    .filter((ex) => ex?.reason === "current_seat_not_in_intended_roster" && (ex.logicalId ?? ex.logical_id))
    .map((ex) => ex.logicalId ?? ex.logical_id);
  const failed = seats.filter((s) => !s.ok).length;
  const rigResult = typeof json?.rigResult === "string" ? json.rigResult : null;
  const ok = commandOk && !json?.error && json?.ok !== false
    && (rigResult ? rigResult === "fully_restored" : seats.length > 0 && failed === 0 && skipped.length === 0);
  const partial = rigResult ? rigResult === "partially_restored" : (failed > 0 && failed < seats.length) || (failed === 0 && seats.length > 0 && skipped.length > 0);
  const freshLost = partial ? nodes.filter((n) => (n.status === "fresh" || n.status === "fresh-primed") && !n.noConversation)
    .map((n) => n.logicalId ?? n.logical_id ?? "?") : [];
  const notes = [
    ...(skipped.length ? [`Skipped (not in this restore's roster): ${skipped.join(", ")}`] : []),
    ...(freshLost.length && failed === 0 ? [`Started fresh without prior conversation: ${freshLost.join(", ")}`] : []),
  ];
  if (partial && failed === 0 && notes.length === 0) {
    const rest = warnings.filter((w) => !usedWarnings.has(w));
    notes.push(...(rest.length ? rest : ["OpenRig reported a partial restore without naming a seat gap."]));
  }
  return { ok, partial, rigResult, seats, notes, error: json?.error ?? null };
}

/**
 * Classify a Needs-You row into one of four visual/toast tiers:
 * - `"escalation"`: `tags` includes `"escalation"` or `"wake-escalation"`
 * - `"alert"`: `ownerNotificationLevel === "ALERT"` (`--alert`), parked `resolve`, ended native seat, or urgent/critical priority
 * - `"routine"`: other actionable `kind: "action"` rows
 * - `"update"`: `kind === "update"` or `update === true`
 */
/** A missing response verb is not an informational update. Normalized tiers retain their meaning. */
export function isUpdateNeed(row) {
  if (!row || typeof row !== "object") return false;
  if (row.criticalHealth === true) return false;
  if (row.tier) return row.tier === "update";
  if (row.kind === "update" || row.update === true) return true;
  return ["queue-update:", "human-update:", "proof:", "workflow:", "health:"].some((prefix) => String(row.id ?? "").startsWith(prefix));
}

export function tierOf(row) {
  if (!row || typeof row !== "object") return "routine";
  if (["routine", "alert", "escalation", "update"].includes(row.tier)) return row.tier;
  if (isUpdateNeed(row)) return "update";
  const tags = Array.isArray(row.tags) ? row.tags : [];
  const notifLevel = String(row.ownerNotificationLevel ?? "").toLowerCase();
  if (tags.includes("escalation") || tags.includes("wake-escalation") || notifLevel === "escalation") {
    return "escalation";
  }
  const verb = row.answer?.verb ?? null;
  if (
    notifLevel === "alert" ||
    row.humanAlert === true ||
    verb === "resolve" ||
    row.reply === "resolve" ||
    row.native === true ||
    row.reply === "native" ||
    row.urgency === "urgent" ||
    row.urgency === "critical" ||
    row.urgency === "high" ||
    row.priority === "urgent" ||
    row.priority === "critical" ||
    row.severity === "critical"
  ) {
    return "alert";
  }
  return "routine";
}

/** Visual strip metadata for a Decision Card. */
export function tierStripFor(rowOrTier) {
  const tier = typeof rowOrTier === "string" ? rowOrTier : tierOf(rowOrTier);
  if (tier === "escalation") return { tier: "escalation", tone: "blocked", text: "Escalation · stuck work needs you", badge: "ESCALATION" };
  if (tier === "alert") return { tier: "alert", tone: "blocked", text: "Needs you now", badge: null };
  if (tier === "update") return { tier: "update", tone: "dim", text: "Update · no action needed", badge: null };
  return { tier: "routine", tone: "accent", text: null, badge: null };
}

const TIER_RANK = Object.freeze({ escalation: 0, alert: 1, routine: 2, update: 3 });

/** Sort Needs rows: Escalation, then Alert, then Routine (each by `at` descending), then Updates. */
export function sortNeedsByTier(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, idx) => ({
      item,
      idx,
      tier: tierOf(item),
      at: String(item?.at ?? item?.tsUpdated ?? item?.tsCreated ?? ""),
    }))
    .sort((a, b) => {
      const rA = TIER_RANK[a.tier] ?? 2;
      const rB = TIER_RANK[b.tier] ?? 2;
      if (rA !== rB) return rA - rB;
      if (a.at !== b.at) return a.at > b.at ? -1 : 1;
      return a.idx - b.idx;
    })
    .map((x) => x.item);
}

/**
 * Enrich `/api/attention` items with queue row fields (`tags`, `ownerNotificationLevel`, `decisionRevision`, `humanQuestions`, `humanAnswers`, `state`)
 * from `/api/queue/attention-aggregate` and any cached `/api/queue/<qitemId>` reads.
 */
export function enrichAttentionItems(attentionItems = [], aggregateData = null, queueRowsById = {}, healthRecords = null) {
  const list = filterAttentionHealth(attentionItems, healthRecords);
  const aggItems = Array.isArray(aggregateData?.items)
    ? aggregateData.items
    : (Array.isArray(aggregateData?.attentionRows)
        ? aggregateData.attentionRows
        : (Array.isArray(aggregateData) ? aggregateData : []));
  const byQitemId = new Map();
  for (const q of aggItems) {
    const qid = q?.qitemId ?? (typeof q?.id === "string" && q.id.startsWith("queue:") ? q.id.slice(6) : q?.id);
    if (qid) byQitemId.set(String(qid), q);
  }
  if (queueRowsById && typeof queueRowsById === "object") {
    for (const [k, v] of Object.entries(queueRowsById)) {
      if (v && typeof v === "object") {
        const qid = k.startsWith("queue:") ? k.slice(6) : k;
        byQitemId.set(qid, { ...(byQitemId.get(qid) ?? {}), ...v });
      }
    }
  }
  return list.map((item) => {
    if (!item || typeof item !== "object") return item;
    const rawId = String(item.id ?? "");
    const qitemId = item.qitemId ?? (rawId.startsWith("queue:") ? rawId.slice(6) : (rawId.startsWith("queue-update:") ? rawId.slice(13) : null));
    const qRow = qitemId ? byQitemId.get(qitemId) : null;
    if (!qRow) return item;
    return {
      ...item,
      qitemId: qitemId ?? item.qitemId ?? null,
      tags: Array.isArray(qRow.tags) ? qRow.tags : (Array.isArray(item.tags) ? item.tags : []),
      ownerNotificationLevel: qRow.ownerNotificationLevel ?? (qRow.humanAlert ? "ALERT" : null) ?? item.ownerNotificationLevel ?? null,
      decisionRevision: qRow.decisionRevision ?? item.decisionRevision ?? null,
      humanQuestions: item.humanQuestions ?? qRow.humanQuestions ?? null,
      humanAnswers: qRow.humanAnswers ?? item.humanAnswers ?? null,
      state: qRow.state ?? item.state ?? null,
      closureReason: qRow.closureReason ?? item.closureReason ?? null,
      closureTarget: qRow.closureTarget ?? item.closureTarget ?? null,
      blockedOn: qRow.blockedOn ?? item.blockedOn ?? null,
      waiting: qRow.waiting ?? item.waiting ?? null,
      sourceSession: qRow.sourceSession ?? item.asker ?? null,
      destinationSession: qRow.destinationSession ?? item.recipient ?? null,
      body: qRow.body ?? item.body ?? item.bodyPreview ?? "",
    };
  });
}

/** A Needs-You item's one-line summary, as its target (`needTarget`) carries it: the summary, else the title, else the id. */
export function needSummary(item) {
  return singleLineText(item?.summary) || singleLineText(item?.title) || String(item?.id ?? "");
}

/**
 * A Needs-You item (`/api/attention` items) as a menu/card target:
 * replies and decisions go through `POST /api/mission-control/action` (`missionAction`).
 */
/** Makes `el` a keyboard target. Herdr sends a key only along the focus path, so an element with a key handler but no focus handle never
 *  hears one: this gives `el` its own handle (one per `id`, kept on `owner`; made outside a draw, since Herdr refuses to make one while a
 *  view renders), a Tab stop, a press that focuses it, and Enter, Space or " " that act only while it holds focus. `focusedStyle` draws the
 *  focus. The owner calls releaseFocusTargets(owner) in its close(). */
// Owns BOTH activation handlers. Callers must not replace on_click afterward.
export function focusHandleFor(owner,cx,id){
  const handles = (owner.focusTargets ??= new Map());
  let handle = handles.get(id);
  if (handle && !liveFocus(handle)) { handles.delete(id); handle = undefined; } // released elsewhere: made again below
  if (!handle && cx?.timer?.after && !(owner.focusTargetsPending ??= new Set()).has(id)) {
    owner.focusTargetsPending.add(id);
    // Set from the draw, so the timer and the handle it makes are this view's own (see liveFocus).
    cx.timer.after(0, (next) => {
      owner.focusTargetsPending.delete(id);
      if (owner.closed || owner.gone || owner.expired || owner.disposed || owner.left || handles.has(id) || !next?.focus_handle) return; // the owner closed while the handle was on its way
      handles.set(id, next.focus_handle()); next.notify?.();
    });
  }
  return handle;
}
export function focusTarget(owner, cx, id, el, act, focusedStyle = null, tip = null) {
  const activation=activationPair(owner,id),handle=focusHandleFor(owner,cx,id);
  owner.focusTargetDrawn?.(id,handle);
  return el.when(!!tip, e => e.tooltip(tip)).when(!!handle, e => e.track_focus(handle).tab_stop(true).tab_index(0))
    .when(Boolean(focusedStyle && handle?.is_focused?.()), e => focusedStyle(e))
    .on_mouse_down("left", activation.pointer((_event,cx) => { cx.stop_propagation?.(); liveFocus(handle)?.focus?.(); }))
    .on_click(activation.click((_event,cx)=>act(cx)))
    .on_key_down(activation.key((e, cx) => { if (handle?.is_focused?.() && ["enter", "space", " "].includes(e.key)) { cx.stop_propagation(); act(cx); } }));
}
/** The handle when it can still be used, else null. Herdr releases a handle together with the view that owns it, and is_focused() on a released
 *  one throws ("this focus handle has been released"): a draw that finds one released drops it and makes a new one. */
export function liveFocus(handle) {
  if (!handle) return null;
  try { handle.is_focused?.(); return handle; } catch (_) { return null; }
}
/* Herdr gives a handle or state, and a timer or task, to the view whose call is running when it is made. After an `await` that is whichever
 * view's call drained the promise jobs (often another mod's timer), and when that view closes (a layout switch closes the sidebar) what it
 * owns goes with it. So async work keeps its RESULT, and the next draw (the view's own call) makes the handle or state, through a timer it
 * sets there. */
/** Releases every handle focusTarget made for `owner`. */
export function releaseFocusTargets(owner) {
  for (const handle of owner.focusTargets?.values() ?? []) { try { handle?.release?.(); } catch (_) {} }
  owner.focusTargets?.clear();
}

/** Error builders can run several helpers below render(). Expose only that
 * synchronous draw's context; never retain it for an async continuation. */
export function withFocusContext(owner,cx,draw){
  const previous=owner.focusRenderCx;owner.focusRenderCx=cx;
  try{return draw();}finally{owner.focusRenderCx=previous;}
}

export function needTarget(item) {
  const id = String(item?.id ?? "");
  const qitemId = item?.qitemId ?? (id.startsWith("queue:") ? id.slice("queue:".length) : id.startsWith("queue-update:") ? id.slice(13) : null);
  const verb = item?.answer?.verb ?? null;
  const reply = qitemId && verb === "resolve"
    ? "resolve"
    : qitemId && verb
      ? "answer"
      : (item?.reply === "answer" || item?.reply === "resolve")
        ? item.reply
        : "none";
  // A native seat that ended outside OpenRig (`native-seat:<node>`, asker `<logicalId>@<rig>`): Relaunch / Resume.
  const native = id.startsWith("native-seat:") && typeof item?.asker === "string" && item.asker.includes("@")
    ? { native: true, logicalId: item.asker.slice(0, item.asker.lastIndexOf("@")), rig: item.asker.slice(item.asker.lastIndexOf("@") + 1) }
    : (item?.native === true || item?.reply === "native")
      ? {
          native: true,
          logicalId: item.logicalId ?? item.seat ?? (typeof item?.asker === "string" && item.asker.includes("@") ? item.asker.slice(0, item.asker.lastIndexOf("@")) : item?.asker ?? null),
          rig: item.rig ?? item.scope ?? (typeof item?.asker === "string" && item.asker.includes("@") ? item.asker.slice(item.asker.lastIndexOf("@") + 1) : null),
        }
      : {};
  const tier = tierOf(item);
  return {
    kind: "need",
    ...(item?.conn ? { conn: item.conn } : {}),
    ...(item?.criticalHealth ? { criticalHealth: true, healthFinding: item.healthFinding, source: item.source } : {}),
    id,
    qitemId,
    reply,
    verb: verb ?? (reply === "resolve" ? "resolve" : reply === "answer" ? (Array.isArray(item?.humanQuestions) && item.humanQuestions.length > 0 ? "answer" : "approve") : null),
    tier,
    answer: item?.answer ?? null,
    recipient: item?.recipient ?? item?.destinationSession ?? null,
    decisionRevision: item?.decisionRevision ?? null,
    humanQuestions: item?.humanQuestions ?? null,
    humanAnswers: item?.humanAnswers ?? null,
    tags: Array.isArray(item?.tags) ? item.tags : [],
    ownerNotificationLevel: item?.ownerNotificationLevel ?? null,
    summary: needSummary(item),
    summaryIsFallback: item?.summaryIsFallback === true || !(singleLineText(item?.summary) || singleLineText(item?.title)),
    body: item?.body ?? item?.bodyPreview ?? "",
    urgency: item?.urgency ?? null,
    asker: typeof item?.asker === "string" ? item.asker : (typeof item?.sourceSession === "string" ? item.sourceSession : null),
    rig: item?.rig ?? null,
    seat: item?.seat ?? item?.logicalId ?? null,
    session: item?.session ?? (typeof item?.asker === "string" && item.asker.includes("@") ? item.asker : null),
    scope: item?.scope ?? null,
    at: item?.at ?? item?.tsUpdated ?? item?.tsCreated ?? null,
    update: item?.kind === "update" || tier === "update",
    unblocks: typeof item?.unblocks === "string" ? item.unblocks : null,
    ...native,
  };
}

/**
 * Quiet rule: true when the user is actively viewing `:needs` in `rig-view`.
 * - `nav`: `shared("rig.nav")` (`{ stack: [...] }` or array)
 * - `activeChild`: active tab or child (`"rig-page"`, `"rig-view"`, etc., or `null` when layout is unreadable)
 */
export function isNeedsVisible({ nav = null, activeChild = null } = {}) {
  if (activeChild !== "rig-page" && activeChild !== MOD_IDS.view) return false;
  const stack = Array.isArray(nav) ? nav : nav?.stack;
  const top = Array.isArray(stack) ? stack.at(-1) : null;
  return top?.section === "needs";
}

/**
 * Build a Needs-You notification candidate for an `/api/attention` item, or `null` when non-actionable.
 * - Escalation (`tier === "escalation"`): `level: "error"`, `timeout: 12000`, bypasses quiet hours.
 * - Alert (`tier === "alert"`): `level: "warning"`, `timeout: 12000`, held in quiet hours.
 * - Routine (`tier === "routine"`): `level: "info"`, `timeout: 8000`, held in quiet hours.
 * - Update (`tier === "update"`): never toasts (`null`).
 */
export function needsToastFor(rawItem) {
  if (!rawItem || typeof rawItem !== "object") return null;
  if (isHealthAttention(rawItem)) {
    if (!filterAttentionHealth([rawItem]).length) return null;
    return { id: rawItem.id, at: "", tier: "alert", isUrgent: true, isEscalation: false,
      toast: { title: "Critical problem in System → Health", body: rowHeadline(rawItem.summary) || rawItem.summary, level: "warning", timeout: 12000,
        action: { name: `rig.open-need:${rawItem.id}`, args: { id: rawItem.id } } } };
  }
  const target = needTarget(rawItem);
  if (!target.id || target.update) return null;
  if (sweepFinding(rawItem)) return null; // a check toasts nothing: the row it names has its own toast if it's the person's
  const reply = target.native || rawItem.reply === "native"
    ? "native"
    : (target.reply === "answer" || target.reply === "resolve")
      ? target.reply
      : "none";
  if (reply !== "answer" && reply !== "resolve" && reply !== "native") return null;
  const tier = tierOf(rawItem);
  if (tier === "update") return null;
  const isEscalation = tier === "escalation";
  const isUrgent = isEscalation || tier === "alert" || reply === "native";
  const level = isEscalation ? "error" : isUrgent ? "warning" : "info";
  const timeout = isUrgent ? 12000 : 8000;
  const asker = typeof rawItem.asker === "string" ? rawItem.asker : target.asker;
  const askerRig = asker && asker.includes("@") ? asker.slice(asker.lastIndexOf("@") + 1) : null;
  const askerSeat = asker ? (asker.includes("@") ? asker.slice(0, asker.lastIndexOf("@")) : asker) : null;
  const rig = rawItem.rig || target.rig || askerRig || rawItem.scope || target.scope || "OpenRig";
  const seat = rawItem.seat || target.logicalId || askerSeat || "";
  const title = reply === "native"
    ? `Seat ended · ${seat || rig || "OpenRig"}`
    : `${isEscalation ? "Escalation" : "Needs you"} · ${rig || "OpenRig"}`;
  const body = requestHeadline(rawItem, rawItem.body ?? "");
  const at = String(rawItem.at ?? rawItem.tsUpdated ?? rawItem.tsCreated ?? "");
  return {
    id: target.id,
    at,
    reply,
    tier,
    isEscalation,
    isUrgent,
    toast: {
      title,
      body,
      level,
      timeout,
      action: { name: `rig.open-need:${target.id}`, args: { id: target.id } },
    },
  };
}

/**
 * Pure diff for Needs-You notifications.
 * - First successful read (`!prevState` or `!prevState.seeded`): seeds `seen` with current actionable IDs and emits zero toasts.
 * - Subsequent reads: toasts unseen IDs and seen IDs with a newer `at` timestamp (`at > seen[id]`).
 * - Prunes IDs no longer in `/api/attention` (unless any source in `sources` is degraded) and caps `seen` at `maxSeen` (200) newest entries.
 * - On fetch error (`!Array.isArray(items)`): preserves `prevState` unchanged and emits zero toasts.
 * - When `notificationsEnabled === false` or `needsVisible === true`: updates `seen` silently and emits zero toasts.
 * - When `quiet === true`: routine and alert toasts are held (`seen` updates silently), while `escalation` (`tier === "escalation"`) bypasses quiet and still toasts with `level: "error"`.
 * - Batch cap (`maxToasts = 3`): if >3 items qualify in one refresh, emits first 2 individual toasts (escalation/urgent first) + 1 summary toast.
 */
export function diffNeedsNotifications(items, prevState = null, { quiet = false, needsVisible = false, notificationsEnabled = true, maxToasts = 3, maxSeen = 200, sources = null, candidates: suppliedCandidates = null, transitionOnly = false } = {}) {
  if (!Array.isArray(items)) {
    return { toasts: [], nextState: prevState };
  }
  const isSeeded = Boolean(
    prevState &&
    typeof prevState === "object" &&
    (prevState.seeded === true || (!("seeded" in prevState) && prevState.seen && typeof prevState.seen === "object"))
  );
  const prevSeen = isSeeded ? (prevState.seen ?? prevState ?? {}) : {};
  const hasDegradedSource = Array.isArray(sources) && sources.some((s) => s && s.state && s.state !== "available");

  const actionable = suppliedCandidates ?? items.map(needsToastFor).filter(Boolean);
  const mergedMap = Object.assign(Object.create(null), hasDegradedSource ? prevSeen : {});
  for (const c of actionable) mergedMap[c.id] = c.at;

  let entries = Object.entries(mergedMap).map(([id, at], idx) => ({ id, at, idx }));
  if (entries.length > maxSeen) {
    entries = [...entries]
      .sort((a, b) => (a.at === b.at ? a.idx - b.idx : a.at < b.at ? -1 : 1))
      .slice(-maxSeen);
  }
  const nextSeen = Object.create(null);
  for (const e of entries) nextSeen[e.id] = e.at;

  // A plain copy for storage: spreading a null-prototype map makes each id, even `__proto__`, an own key.
  const nextState = { seeded: true, seen: { ...nextSeen } };
  if (!isSeeded) {
    return { toasts: [], nextState };
  }
  const rawCandidates = actionable.filter((c) => {
    if (!Object.prototype.hasOwnProperty.call(prevSeen, c.id)) return true;
    const prevAt = prevSeen[c.id];
    return !transitionOnly && Boolean(c.at && prevAt && c.at > prevAt);
  });
  if (!notificationsEnabled || needsVisible || rawCandidates.length === 0) {
    return { toasts: [], nextState };
  }
  const candidates = rawCandidates.filter((c) => !c.silent && (!quiet || c.isEscalation));
  if (candidates.length === 0) {
    return { toasts: [], nextState };
  }
  const ordered = [
    ...candidates.filter((c) => c.isEscalation),
    ...candidates.filter((c) => !c.isEscalation && c.isUrgent),
    ...candidates.filter((c) => !c.isUrgent),
  ];
  if (ordered.length > maxToasts) {
    const keepCount = Math.max(1, maxToasts - 1);
    const individual = ordered.slice(0, keepCount).map((c) => c.toast);
    const rest = ordered.slice(keepCount);
    const restEscalation = rest.some((c) => c.isEscalation);
    const restUrgent = rest.some((c) => c.isUrgent);
    return {
      toasts: [
        ...individual,
        {
          title: "Needs you · OpenRig",
          body: `+${rest.length} more items waiting — click to review`,
          level: restEscalation ? "error" : restUrgent ? "warning" : "info",
          timeout: restUrgent ? 12000 : 8000,
          action: { name: "rig.open-need:", args: {} },
        },
      ],
      nextState,
    };
  }
  return { toasts: ordered.map((c) => c.toast), nextState };
}

/**
 * Handle `rig.open-need`:
 * - Expands `shared("rig.open.page")["needs:" + id] = true` (the page's own folds)
 * - Sets `shared("rig.focusNeed", id)`
 * - Pushes `{ section: "needs", id, name }` onto `shared("rig.nav")` and selects `rig-page` in `rig-work`
 * - If `id` is absent (summary toast), opens `:needs` without expanding a specific row
 * - If `Array.isArray(items)` is passed and a non-health `id` is no longer present, opens `:needs` with `notice: "This request was already answered"`
 * - Missing `health:` ids keep the item route and connection so the page can offer its System → Health fallback
 */
export function openNeed(id, { shared, setShared, run, items = null, layout = undefined, spaces = undefined, panes = undefined, conn = null, stay = false, tabId = null } = {}) {
  const rawId = typeof id === "object" && id !== null ? (id.id ?? null) : id;
  const targetId = typeof rawId === "string" && rawId.trim() ? rawId.trim() : null;
  const nav = shared?.("rig.nav") ?? { stack: [] };
  const activateRigPage = entry => {
    // Asked from a Rig page that is on screen: it shows the page in its own tab, in its own space.
    if (stay) { if (tabId) pushTabPage({ shared, setShared, panes }, tabId, entry); return; }
    if (layout !== undefined) {
      openOrFocusRigTab({ shared, setShared, run, spaces, panes, layout, section: "needs", mayCreate: true, ...(tabId ? { sourceTab: tabId } : {}) }, entry);
    } else {
      run?.("layout.select", { stack: "rig-work", child: "rig-page" });
    }
  };
  if (!targetId) {
    setShared?.("rig.focusNeed", null);
    const entry={ section: "needs", ...(conn?{conn}:{}) };
    setShared?.("rig.nav", navPush(nav, entry));
    activateRigPage(entry);
    return { opened: "needs", id: null, expired: false };
  }
  if (Array.isArray(items) && !isHealthAttention({ id: targetId }) && !items.some((x) => String(x?.id ?? "") === targetId)) {
    setShared?.("rig.focusNeed", null);
    const entry={ section: "needs", expiredId: targetId, notice: "This request was already answered", ...(conn?{conn}:{}) };
    setShared?.("rig.nav", navPush(nav, entry));
    activateRigPage(entry);
    return { opened: "needs", id: targetId, expired: true };
  }
  const hit = Array.isArray(items) ? items.find((x) => String(x?.id ?? "") === targetId) : null;
  const check = sweepFinding(hit);
  const name = check ? checkLabel(check, items) : hit?.summary ?? hit?.title ?? targetId;
  setShared?.("rig.open.page", { ...(shared?.("rig.open.page") ?? {}), [`needs:${targetId}`]: true });
  setShared?.("rig.focusNeed", targetId);
  const owner=conn??hit?.conn;
  const entry={ section: "needs", id: targetId, name, ...(owner?{conn:owner}:{}) };
  setShared?.("rig.nav", navPush(nav, entry));
  activateRigPage(entry);
  return { opened: "item", id: targetId, expired: false };
}

/** The words of a request (`/api/attention?item=<id>` detail lines): its body and supplemental detail, before the
 *  bookkeeping (State, To, From, history) that `rig queue show` has in full. */
export function needDetailLines(detail) {
  const lines = Array.isArray(detail?.lines) ? detail.lines.map((l) => String(l ?? "")) : [];
  const end = lines.findIndex((l) => l.startsWith("State: "));
  return (end < 0 ? lines : lines.slice(0, end)).filter((l) => l.trim() && l !== "Request:");
}

/** The bookkeeping lines from `/api/attention?item=<id>` (`State:`, `To:`, `From:`, `Slack:`, `Decision route:`, `Queue history:`) for the "What OpenRig recorded" fold. */
export function needRecordedLines(detail) {
  const lines = Array.isArray(detail?.lines) ? detail.lines.map((l) => String(l ?? "")) : [];
  const start = lines.findIndex((l) => l.startsWith("State: "));
  return start < 0 ? [] : lines.slice(start).filter((l) => l.trim());
}

/**
 * Per-question state (`unanswered`, `answered`, `words`), option list with `recommended`, and whether all questions are answered.
 */
export function questionsState(item, queueRow = null) {
  const rawQuestions = Array.isArray(queueRow?.humanQuestions)
    ? queueRow.humanQuestions
    : (Array.isArray(item?.humanQuestions) ? item.humanQuestions : []);
  const rawAnswers = (queueRow?.humanAnswers && typeof queueRow.humanAnswers === "object")
    ? queueRow.humanAnswers
    : ((item?.humanAnswers && typeof item.humanAnswers === "object") ? item.humanAnswers : {});
  const questions = rawQuestions.map((q) => {
    const qid = String(q?.id ?? "");
    const hasOwn = Object.prototype.hasOwnProperty.call(rawAnswers, qid) && rawAnswers[qid] != null;
    const ans = hasOwn ? rawAnswers[qid] : null;
    const options = (Array.isArray(q?.options) ? q.options : []).map((o) => ({
      id: String(o?.id ?? ""),
      label: String(o?.label ?? o?.id ?? ""),
      recommended: Boolean(o?.recommended),
    }));
    if (!hasOwn) {
      return {
        id: qid,
        question: String(q?.question ?? qid),
        options,
        state: "unanswered",
        answered: false,
        stateLabel: "unanswered",
        chosenOptionId: null,
        chosenLabel: null,
        typedText: null,
      };
    }
    if (typeof ans === "string") {
      const opt = options.find((o) => o.id === ans);
      const chosenLabel = opt?.label ?? ans;
      return {
        id: qid,
        question: String(q?.question ?? qid),
        options,
        state: "answered",
        answered: true,
        stateLabel: `answered: ${chosenLabel}`,
        chosenOptionId: ans,
        chosenLabel,
        typedText: null,
      };
    }
    const text = String(ans?.text ?? "");
    return {
      id: qid,
      question: String(q?.question ?? qid),
      options,
      state: "words",
      answered: true,
      stateLabel: `answered in their words: ${text}`,
      chosenOptionId: null,
      chosenLabel: null,
      typedText: text,
    };
  });
  const unansweredCount = questions.filter((q) => q.state === "unanswered").length;
  const totalCount = questions.length;
  const allAnswered = totalCount > 0 && unansweredCount === 0;
  const rowState = String(queueRow?.state ?? item?.state ?? "pending");
  const needsResume = allAnswered && rowState === "pending";
  return {
    hasQuestions: totalCount > 0,
    questions,
    unansweredCount,
    openCount: unansweredCount,
    totalCount,
    allAnswered,
    needsResume,
  };
}

/** Deterministic hash prefix `"herdr-mod:<hash>:"` for `(qitemId, revision, payload)`. */
export function operationHashPrefix(qitemId, revision, payload) {
  const input = JSON.stringify([String(qitemId ?? ""), String(revision ?? ""), payload ?? null]);
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < input.length; i++) {
    const ch = input.codePointAt(i);
    h1 = ((h1 * 33) ^ ch) >>> 0;
    h2 = ((h2 * 31) ^ ch) >>> 0;
  }
  const hash = `${h1.toString(36)}${h2.toString(36)}`;
  return `herdr-mod:${hash}:`;
}

/** Deterministic `operationId` `"herdr-mod:<hash>:<step>"` for safe retries and multi-question submissions. */
export function operationId(qitemId, revision, payload, step = 1) {
  return `${operationHashPrefix(qitemId, revision, payload)}${Math.max(1, Number(step) || 1)}`;
}

/** Shown when `POST /api/mission-control/action` returns HTTP 401. */
export const DECISION_TOKEN_PROTECTED = "This OpenRig protects decisions with a token; answer in the TUI's Feed (rig) or with rig queue resolve.";

/** "Your earlier part (1 of 3) was" / "Your earlier parts (1 and 2 of 3) were": names every part that was recorded, not only the last one's number. */
const earlierParts = (done, total) => done === 1 ? `Your earlier part (1 of ${total}) was` : `Your earlier parts (${done === 2 ? "1 and 2" : `1 to ${done}`} of ${total}) were`;
/** A message with the parts recorded before the failing one named (nothing added when none was recorded). */
const withEarlierParts = (message, done, total) => (done > 0 ? `${/[.!?]$/.test(message) ? message : `${message}.`} ${earlierParts(done, total)} recorded.` : message); // daemon text with no full stop ("HTTP 502", "boom") gets one, so the parts sentence stands alone

/** Shown when `POST /api/mission-control/action` fails due to a network error. */
export const NETWORK_UNCONFIRMED_MESSAGE = "Not confirmed. It may have been recorded: check the request before sending again.";

function resolveMissionVerb(item, act = {}) {
  if (typeof act?.verb === "string" && act.verb.trim()) return act.verb.trim();
  const mode = act?.mode ?? act?.kind ?? null;
  if (mode === "approve") return "approve";
  if (mode === "deny") return "deny";
  if (mode === "resolve") return "resolve";
  if (mode === "choices" || mode === "freeform" || mode === "resume" || mode === "answer-text") return "answer";
  return (item?.answer?.verb === "resolve" || item?.reply === "resolve") ? "resolve" : "answer";
}

function normalizeRevision(val) {
  if (typeof val === "string" && val.trim()) return val.trim();
  if (typeof val === "number" && Number.isFinite(val)) return String(val);
  return undefined;
}

/**
 * Build a headerless `POST /api/mission-control/action` request for `answer` (choice, words, or resume), `resolve`, `approve`, and `deny`.
 * - Never sets `X-OpenRig-Session`.
 * - When `config.person` is a valid `<id>@external` address, sends `{ actorSession: config.person }` and NO `authority` field.
 * - When `config.person` is absent/null, sends `{ actorSession: item?.answer?.actorSession ?? "human@host", authority: "primary-user" }`.
 */
export function missionAction(config, item, act = {}) {
  const rawId = String(act?.qitemId ?? item?.qitemId ?? item?.id ?? "").trim();
  const qitemId = rawId.startsWith("queue:") ? rawId.slice("queue:".length) : rawId;
  const rawPerson = typeof config?.person === "string" ? config.person.trim() : "";
  const validExternalPerson = /^[^@\s]+@external$/.test(rawPerson) ? rawPerson : null;
  const fallbackActor = (typeof item?.answer?.actorSession === "string" && item.answer.actorSession.trim())
    ? item.answer.actorSession.trim()
    : "human@host";
  const actorSession = validExternalPerson ?? fallbackActor;
  const authority = validExternalPerson ? null : "primary-user";

  const verb = resolveMissionVerb(item, act);
  const isResume = Boolean(act?.resume || act?.mode === "resume");
  const expectedRevision = normalizeRevision(act?.expectedRevision ?? act?.revision ?? item?.decisionRevision);

  const step = Math.max(1, Number(act?.step) || 1);
  const payloadForHash = act?.batchPayload !== undefined
    ? act.batchPayload
    : (act?.questionId !== undefined
        ? { verb, questionId: act.questionId, optionId: act.optionId }
        : { verb, decision: act?.decision ?? act?.text ?? null, reason: act?.reason ?? null, resume: isResume });
  const opId = typeof act?.operationId === "string" && act.operationId
    ? act.operationId
    : operationId(qitemId, act?.initialRevision ?? expectedRevision ?? "", payloadForHash, step);

  const body = {
    verb,
    qitemId,
    actorSession,
    ...(authority ? { authority } : {}),
  };
  if (verb === "approve") {
    const r = String(act?.reason ?? "").trim();
    if (r) body.reason = r;
  } else if (verb === "deny") {
    body.reason = String(act?.reason ?? act?.decision ?? act?.text ?? "").trim();
  } else if (verb === "resolve") {
    body.decision = String(act?.decision ?? act?.text ?? "").trim();
  } else if (verb === "answer") {
    if (act?.questionId !== undefined && act?.optionId !== undefined && act?.questionId !== null && act?.optionId !== null) {
      body.questionId = String(act.questionId);
      body.optionId = String(act.optionId);
    } else if (!isResume && (act?.decision !== undefined || act?.text !== undefined)) {
      const words = String(act?.decision ?? act?.text ?? "").trim();
      if (words) body.decision = words;
    }
  }
  if (expectedRevision !== undefined) {
    body.expectedRevision = expectedRevision;
  }
  body.auditNotes = { route: "herdr-app-mod", ...(act?.auditNotes ?? {}), operationId: opId };

  return {
    path: "/api/mission-control/action",
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  };
}

/** Format the factual outcome line after a Mission Control action. */
export function formatMissionActionOutcome(item, act = {}, resData = {}, config = null) {
  const verb = String(resData?.verb ?? resolveMissionVerb(item, act));
  const rawPerson = typeof config?.person === "string" ? config.person.trim() : "";
  const validExternalPerson = /^[^@\s]+@external$/.test(rawPerson) ? rawPerson : null;
  const actorLabel = validExternalPerson ?? (typeof act?.actorSession === "string" && /^[^@\s]+@external$/.test(act.actorSession) ? act.actorSession : "human@host (unattributed)");
  const answerMessage = typeof resData?.answer?.message === "string" && resData.answer.message.trim() ? ` ${resData.answer.message}` : "";
  if (resData?.answer?.outcome === "recorded") {
    const openList = Array.isArray(resData.answer.unanswered) ? resData.answer.unanswered : [];
    return `Recorded as ${actorLabel}. ${openList.length} question${openList.length === 1 ? "" : "s"} still open${openList.length ? `: ${openList.join("; ")}` : ""}.${answerMessage}`;
  }
  if (verb === "approve") {
    return `Recorded as ${actorLabel}: approved. Closed as done.`;
  }
  if (verb === "deny") {
    return `Recorded as ${actorLabel}: denied, with your reason. Closed as denied.`;
  }
  if (verb === "resolve") {
    const owner = parkedWorkOwner(item?.waiting?.owner || item?.destinationSession ? item : resData?.closedQitem);
    return `Recorded as ${actorLabel}. Unparked; ${owner} still owns it.`;
  }
  if (verb === "answer") {
    return `Recorded as ${actorLabel}: your answer.${answerMessage}`;
  }
  return `Recorded as ${actorLabel}.`;
}

/** A read-only check before any Reply POST. Herdr's native fetch error cannot distinguish a refused connection from a
 * written request whose answer was lost. A failed GET proves only that we have not attempted the Reply POST yet.
 * Keep the caller's operation for both check and write; never repeat this check between multipart steps. */
export async function missionActionPreflight(config, op) {
  const base = String(config?.daemonUrl ?? "").replace(/\/$/, "");
  if (/^herdr:\/\//i.test(base)) return null; // the dormant machine-helper route retains its own preparation/receipts
  try {
    const response = await op.fetch(`${base}/healthz`, { method: "GET" });
    if (response?.ok) return null;
    const status = Number.isInteger(response?.status) ? ` (HTTP ${response.status})` : "";
    return { ok: false, notSent: true, text: `OpenRig's check failed${status} before sending this reply. Nothing was sent.` };
  } catch (error) {
    const reason = error?.code === "GATE_REFUSED" ? String(error.message).trim() : "OpenRig couldn't be checked before sending this reply.";
    return { ok: false, notSent: true, text: /nothing was sent/i.test(reason) ? reason : `${reason} Nothing was sent.` };
  }
}

/**
 * Execute a single or multi-question Mission Control action (`POST /api/mission-control/action`),
 * chaining `expectedRevision` from each step's response `decisionRevision`.
 */
/** Whether a person's ask may be approved: only when its queue row says humanIntent "decision". OpenRig sends every ask without questions
 *  with verb approve, and approve closes the row as done while sending nothing back to the asker, so anything else (no intent, or a row
 *  not read yet or unreadable) is a request the person answers in words. */
export function isDecisionAsk(_item, queueRow) {
  return queueRow?.humanIntent === "decision";
}
export const REQUEST_NOT_A_DECISION = "This request asks you to do something; mark it done from its card. Nothing was sent.";

export async function submitMissionActions(config, item, act = {}, postOrOpts = {}) {
  // Approve only a decision: refused before any read or send, so a request is never closed with nothing sent back to its asker.
  if (resolveMissionVerb(item, act) === "approve" && !isDecisionAsk(item, act?.queueRow)) {
    return { ok: false, notSent: true, code: "not_a_decision", conflict: false, message: REQUEST_NOT_A_DECISION, text: REQUEST_NOT_A_DECISION, committedQuestionIds: [], stepsCompleted: 0 };
  }
  // ONE operation for the whole answer, taken before the address is read: every POST of a multi-question answer is sent under the generation the first one began
  // with, so a settings change between two POSTs refuses the rest (a bare `gatedFetch` would start a new generation per request and send the second to the old daemon).
  const op = gatedOperationOrRefusal(config?.connectionId); // the answer's own connection (several OpenRigs: a bare operation refuses)
  let runReq;
  if (typeof postOrOpts?.post === "function") {
    runReq = (req) => postOrOpts.post(req.path, req.body, req.headers);
  } else if (typeof postOrOpts === "function" && postOrOpts !== gatedFetch && postOrOpts.name !== "fetch" && postOrOpts.name !== "gatedFetch") {
    runReq = async (req) => {
      const r = await postOrOpts(req);
      if (r && typeof r === "object" && "status" in r && typeof r.text === "function" && !("data" in r)) {
        const rawText = await r.text();
        let data = null;
        try { data = JSON.parse(rawText); } catch (_) { data = { error: rawText }; }
        return { ok: r.ok, status: r.status, data, error: data?.error ?? data?.message ?? null };
      }
      return r;
    };
  } else {
    const given = (typeof postOrOpts === "function" ? postOrOpts : postOrOpts?.fetch) ?? gatedFetch;
    const fetchFn = given === gatedFetch ? op.fetch : given; // a caller's own operation fetch is used as it is
    if (typeof fetchFn !== "function") {
      throw new Error("submitMissionActions requires a post function or fetch");
    }
    const baseUrl = String(config?.daemonUrl ?? "").replace(/\/$/, "");
    runReq = async (req) => {
      const r = await fetchFn(`${baseUrl}${req.path}`, {
        method: req.method ?? "POST",
        headers: req.headers ?? { "content-type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const rawText = typeof r.text === "function" ? await r.text() : JSON.stringify(await r.json());
      let data = null;
      try { data = JSON.parse(rawText); } catch (_) { data = { error: rawText }; }
      return { ok: r.ok, status: r.status, data, error: data?.error ?? data?.message ?? null };
    };
  }

  const rawId = String(act?.qitemId ?? item?.qitemId ?? item?.id ?? "").trim();
  const qitemId = rawId.startsWith("queue:") ? rawId.slice("queue:".length) : rawId;
  const initialRevision = normalizeRevision(act?.expectedRevision ?? act?.revision ?? item?.decisionRevision);

  const choices = Array.isArray(act?.choices) && act.choices.length > 0 ? act.choices : null;
  const resolvedVerb = resolveMissionVerb(item, act);
  const isResume = Boolean(act?.resume || act?.mode === "resume");
  const steps = choices
    ? choices.map((c) => ({ verb: "answer", questionId: c.questionId, optionId: c.optionId }))
    : [{ ...act, verb: resolvedVerb, resume: isResume }];
  const batchPayload = choices
    ? choices.map((c) => ({ questionId: String(c.questionId), optionId: String(c.optionId) }))
    : (act?.questionId !== undefined
        ? [{ questionId: String(act.questionId), optionId: String(act.optionId) }]
        : { verb: resolvedVerb, decision: act?.decision ?? act?.text ?? null, reason: act?.reason ?? null, resume: isResume });
  const hashPrefix = (typeof act?.operationHashPrefix === "string" && act.operationHashPrefix)
    ? act.operationHashPrefix
    : operationHashPrefix(qitemId, initialRevision ?? "", batchPayload);
  const onStepFn = typeof postOrOpts?.onStep === "function"
    ? postOrOpts.onStep
    : (typeof act?.onStep === "function" ? act.onStep : null);
  const onStepDoneFn = typeof postOrOpts?.onStepDone === "function"
    ? postOrOpts.onStepDone
    : (typeof act?.onStepDone === "function" ? act.onStepDone : null);

  let currentRevision = initialRevision;
  let lastData = null;

  for (let idx = 0; idx < steps.length; idx++) {
    const stepNum = idx + 1;
    if (onStepFn) {
      onStepFn(stepNum, steps.length);
    }
    const req = missionAction(config, item, {
      ...steps[idx],
      qitemId,
      expectedRevision: currentRevision,
      initialRevision: initialRevision ?? "",
      batchPayload,
      step: stepNum,
      operationId: `${hashPrefix}${stepNum}`,
    });
    const committedQuestionIds = choices ? choices.slice(0, idx).map((c) => String(c.questionId)) : [];
    let res;
    try {
      res = await runReq(req);
    } catch (error) {
      if (error?.code === "GATE_REFUSED") {
        // The settings changed (or a connections list arrived). Raised BEFORE the step left, it is known unsent; raised AFTER (its answer, or its failure, came under settings that are gone) the
        // daemon may have recorded it: that step is UNCONFIRMED and the item must be read again. Only the steps that never left are said to be unsent. This is NOT a network error.
        const line = String(error.message).trimEnd();
        if (error.dispatched === true) {
          const later = steps.length - idx - 1;
          const lead = steps.length > 1 ? `Step ${stepNum} of ${steps.length} may have been recorded` : "It may have been recorded";
          const earlier = idx > 0 ? ` ${earlierParts(idx, steps.length)} recorded.` : "";
          const unsent = later > 0 ? ` The remaining part${later > 1 ? "s were" : " was"} not sent.` : "";
          const message = `${line} ${lead}: check this request again before answering.${earlier}${unsent}`;
          return { ok: false, status: 0, code: "settings_changed", settingsChanged: true, unconfirmed: true, unconfirmedStep: stepNum, conflict: false, tokenProtected: false, partial: idx > 0,
            operationHashPrefix: hashPrefix, message, text: message, committedQuestionIds, stepsCompleted: idx };
        }
        const baseLine = idx > 0 ? line.replace(/\s*Nothing was sent\.?$/i, "") : line;
        const went = idx > 0 ? ` ${earlierParts(idx, steps.length)} recorded; the rest was not sent.` : (/nothing was sent/i.test(baseLine) ? "" : " Nothing was sent.");
        const message = `${baseLine}${went}`;
        return { ok: false, status: 0, code: "settings_changed", settingsChanged: true, ...(idx === 0 ? { notSent: true } : { stepNotSent: true }), conflict: false, tokenProtected: false, partial: idx > 0,
          operationHashPrefix: hashPrefix, message, text: message, committedQuestionIds, stepsCompleted: idx };
      }
      if (isKnownUnsentError(error)) {
        const rawLine = unsentErrorMessage(error).trimEnd();
        const baseLine = idx > 0 ? rawLine.replace(/\s*Nothing was sent\.?$/i, "") : rawLine;
        const went = idx > 0 ? ` ${earlierParts(idx, steps.length)} recorded; the rest was not sent.` : (/nothing was sent/i.test(baseLine) ? "" : " Nothing was sent.");
        const message = `${baseLine}${went}`;
        return {
          ok: false,
          status: 0,
          code: "not_sent",
          ...(idx === 0 ? { notSent: true } : { stepNotSent: true }),
          conflict: false,
          tokenProtected: false,
          partial: idx > 0,
          operationHashPrefix: hashPrefix,
          message,
          text: message,
          committedQuestionIds,
          stepsCompleted: idx,
        };
      }
      return {
        ok: false,
        status: 0,
        code: "network_error",
        networkError: true,
        conflict: false,
        tokenProtected: false,
        operationHashPrefix: hashPrefix,
        message: withEarlierParts(NETWORK_UNCONFIRMED_MESSAGE, idx, steps.length),
        text: withEarlierParts(NETWORK_UNCONFIRMED_MESSAGE, idx, steps.length),
        committedQuestionIds,
        stepsCompleted: idx,
      };
    }
    const status = Number(res?.status ?? (res?.ok ? 200 : 500));
    const data = res?.data ?? res?.errorData ?? null;
    if (status === 401) {
      return {
        ok: false,
        status: 401,
        code: "token_protected",
        tokenProtected: true,
        conflict: false,
        operationHashPrefix: hashPrefix,
        message: withEarlierParts(DECISION_TOKEN_PROTECTED, idx, steps.length),
        text: withEarlierParts(DECISION_TOKEN_PROTECTED, idx, steps.length), // the card shows ONLY this sentence for a token refusal: it names the parts already recorded
        committedQuestionIds,
        stepsCompleted: idx,
      };
    }
    if (!res?.ok) {
      const errCode = data?.error ?? "action_failed";
      if (status === 409 && errCode === "decision_revision_changed") {
        const lastOpId = String(data?.lastAction?.auditNotes?.operationId ?? "");
        const partial = idx > 0 || Boolean(hashPrefix && lastOpId.startsWith(hashPrefix));
        const message = partial
          ? (idx > 1 ? `${earlierParts(idx, steps.length)} recorded; choose the rest again.` : "Your earlier part was recorded; choose the rest again.") // one recorded part keeps the sentence it always had
          : "The request changed since you opened it. Here it is now.";
        return {
          ok: false,
          status: 409,
          code: "decision_revision_changed",
          conflict: true,
          tokenProtected: false,
          partial,
          operationHashPrefix: hashPrefix,
          message,
          text: message,
          data,
          committedQuestionIds,
          stepsCompleted: idx,
        };
      }
      if (status === 409 && errCode === "qitem_already_terminal") {
        const settledState = String(data?.state ?? data?.currentState ?? "done");
        const message = withEarlierParts(`This request was already settled: ${settledState === "handed-off" ? "it was " : ""}${statusWord(settledState, "queue")}.`, idx, steps.length); // parts recorded before it was settled are named too
        return {
          ok: false,
          status: 409,
          code: errCode,
          conflict: true,
          tokenProtected: false,
          partial: idx > 0,
          operationHashPrefix: hashPrefix,
          message,
          text: message,
          data,
          committedQuestionIds,
          stepsCompleted: idx,
        };
      }
      const message = withEarlierParts([data?.message, data?.error, res?.error].map((v) => String(v ?? "").trim()).find(Boolean) ?? `OpenRig answered with error ${status}.`, idx, steps.length); // an empty or blank body falls back to the status, never to ". Your earlier part..."
      return {
        ok: false,
        status,
        code: errCode,
        conflict: status === 409,
        ...(status >= 400 && status < 500 && status !== 409 ? { daemonRefused: true } : {}),
        tokenProtected: false,
        operationHashPrefix: hashPrefix,
        message,
        text: message,
        data,
        committedQuestionIds,
        stepsCompleted: idx,
      };
    }
    lastData = data;
    if (onStepDoneFn) {
      onStepDoneFn(stepNum, steps.length, steps[idx]?.questionId, steps[idx]?.optionId);
    }
    const nextRev = normalizeRevision(data?.decisionRevision);
    if (nextRev) {
      currentRevision = nextRev;
    }
  }

  const message = formatMissionActionOutcome(item, { ...act, verb: resolvedVerb }, lastData, config);
  return {
    ok: true,
    status: 200,
    data: lastData,
    decisionRevision: currentRevision ?? normalizeRevision(lastData?.decisionRevision) ?? null,
    operationHashPrefix: hashPrefix,
    outcome: lastData?.answer?.outcome ?? "closed",
    message,
    text: message,
    conflict: false,
    tokenProtected: false,
    committedQuestionIds: choices ? choices.map((c) => String(c.questionId)) : [],
    stepsCompleted: steps.length,
  };
}

function formatShortTime(isoOrTime, timezone = null) {
  if (!isoOrTime) return null;
  const s = String(isoOrTime).trim();
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return formatAbsoluteTime(d,{timezone});
  }
  return s;
}

/**
 * Build the "Since you were away" digest and coming-back account model.
 * Returns `null` when the user was not away (>1h gap with new items, or a mode/quiet window ended).
 */
export function sinceYouWereAwaySummary(items = [], {
  lastSeenNeedsAt = null,
  nowMs = Date.now(),
  modeEnded = false,
  quietEnded = false,
  endedModeAccount = null,
  endedModeDecisions = null,
  timezone = null,
} = {}) {
  const acct = endedModeAccount?.account ?? endedModeAccount ?? null;
  const rawDecisions = Array.isArray(endedModeDecisions?.decisions)
    ? endedModeDecisions.decisions
    : (Array.isArray(endedModeDecisions) ? endedModeDecisions : (Array.isArray(acct?.decisions) ? acct.decisions : []));
  const hasEndedMode = Boolean(modeEnded || acct || rawDecisions.length > 0);
  const stamp = lastSeenNeedsAt ?? acct?.mode?.startedAt ?? null;
  const stampMs = stamp ? Date.parse(stamp) : NaN;
  const gapOverHour = Number.isFinite(stampMs) && (nowMs - stampMs) > 3600_000;

  const list = Array.isArray(items) ? items : [];
  const filtered = list.filter((i) => {
    if (!i || typeof i !== "object") return false;
    const at = String(i.at ?? i.tsUpdated ?? i.tsCreated ?? "");
    if (stamp && at) return at > stamp;
    return hasEndedMode || quietEnded;
  });
  const sorted = sortNeedsByTier(filtered);

  if (!hasEndedMode && !quietEnded && !(gapOverHour && sorted.length > 0)) {
    return null;
  }

  const checks = sorted.filter((i) => tierOf(i) !== "update" && sweepFinding(i)).length;
  const requests = sorted.filter((i) => tierOf(i) !== "update").length - checks;
  const updates = sorted.filter((i) => tierOf(i) === "update").length;
  const sinceTime = formatShortTime(stamp,timezone) ?? "you were away";
  const header = `Since ${sinceTime}: ${requests} request${requests === 1 ? "" : "s"}${checksSuffix(checks)}, ${updates} update${updates === 1 ? "" : "s"}`;

  const groups = {
    escalation: sorted.filter((i) => tierOf(i) === "escalation"),
    alert: sorted.filter((i) => tierOf(i) === "alert"),
    routine: sorted.filter((i) => tierOf(i) === "routine"),
    update: sorted.filter((i) => tierOf(i) === "update"),
  };

  const modeName = acct?.mode?.modeName
    ?? acct?.mode?.settings?.name
    ?? endedModeDecisions?.modeName
    ?? (typeof modeEnded === "string" ? modeEnded : null);
  const decisions = rawDecisions.map((d) => {
    const dec = d?.decision ?? d ?? {};
    const choices = Array.isArray(dec.choices)
      ? dec.choices.map((c) => c?.questionId ? `${c.questionId}=${c.chosen}` : String(c?.chosen ?? "")).join(", ")
      : String(dec.chose ?? dec.choices ?? "");
    const reversible = Boolean(dec.reversible);
    return {
      qitemId: String(d?.qitemId ?? ""),
      summary: d?.summary ? String(d.summary) : null,
      sourceSession: d?.sourceSession ? String(d.sourceSession) : null,
      decidedBy: String(dec.decidedBy ?? "agent"),
      reversible,
      reversibilityLabel: reversible ? "reversible" : "can't be undone",
      choices,
      reason: String(dec.reason ?? ""),
    };
  });

  return {
    show: true,
    stamp,
    sinceTime,
    header,
    requests,
    checks,
    updates,
    items: sorted,
    groups,
    modeName: modeName ?? null,
    modeHeading: modeName ? `Decided for you while ${modeName} was on` : (decisions.length ? "Decided for you while away" : null),
    decisions,
  };
}

/**
 * Compact header chip for active quiet hours or mode in the `RIG` sidebar header:
 * - Mode on: `<Mode name> · back <expectedBack>` (or `<Mode name>`)
 * - Quiet on: `Quiet until <HH:MM>`
 * - At desk with no active quiet: `null` (no chip)
 */
export function quietModeHeaderChip({ quiet = null, mode = null, timezone = null } = {}) {
  const curMode = mode?.current ?? (mode?.modeName ? mode : null);
  if (curMode && curMode.modeName) {
    const name = String(curMode.modeName);
    const tz = curMode.settings?.delivery?.quiet?.timezone ?? null;
    const expectedBack = curMode.settings?.availability?.expectedBack
      ?? curMode.availability?.expectedBack
      ?? (curMode.scheduledEnd ? formatShortTime(curMode.scheduledEnd, timezone) : null);
    const shortLabel = expectedBack ? `${name} · ${expectedBack}` : name;
    const label = expectedBack ? `${name} · back ${expectedBack}` : name;
    return { kind: "mode", modeName: name, expectedBack: expectedBack ?? null, shortLabel, label, tooltip: label, glyph: "☾" };
  }
  const quietState = quiet?.state ?? quiet;
  const quietWindow = quiet?.window ?? null;
  if (quietState?.active) {
    const tz = quietWindow?.timezone ?? null;
    const boundaryAt = quietState.nextBoundary?.at ?? quietWindow?.until ?? quietWindow?.end ?? null;
    const until = formatShortTime(boundaryAt, timezone) ?? "later";
    const label = `Quiet until ${until}`;
    const tooltip = `Quiet until ${until}${tz ? ` (${tz})` : ""}. This mod holds routine toasts until then; escalations still show.`;
    return { kind: "quiet", until, timezone: tz, shortLabel: until, label, tooltip, glyph: "☾" };
  }
  return null;
}

/**
 * Factual notice when a person's connector binding is not ready.
 * Never mutates or removes the binding.
 */
export function deadBindingNotice(entityId, readiness, humanRecord = null, { isOtherPerson = false, displayName = null } = {}) {
  const r = readiness?.readiness ?? readiness;
  if (!r || r.state !== "not-ready") return null;
  const hasBinding = Boolean(
    r.connector?.kind ||
    r.connector?.ref ||
    humanRecord?.bindings?.primary ||
    (Array.isArray(humanRecord?.connectorBindings) && humanRecord.connectorBindings.length > 0)
  );
  if (!hasBinding) return null;
  const kind = r.connector?.kind
    ?? humanRecord?.bindings?.primary?.kind
    ?? humanRecord?.connectorBindings?.[0]?.kind
    ?? "slack";
  const ref = r.connector?.ref
    ?? humanRecord?.bindings?.primary?.connectorRef
    ?? humanRecord?.connectorBindings?.[0]?.connectorRef
    ?? "default";
  const id = String(entityId ?? humanRecord?.entityId ?? "").replace(/@external$/, "");
  const name = displayName || humanRecord?.displayName || id;
  if (isOtherPerson) {
    return `OpenRig still expects to reach ${name} through ${kind} (${ref}), which isn't set up, so it reports ${name}'s requests as undelivered. Removing that binding is ${name}'s call: rig gateway human show ${id}.`;
  }
  return `Your OpenRig still expects to reach you through ${kind} (${ref}), which isn't set up, so it reports your requests as undelivered. You're reading them here. Removing that binding is your call: rig gateway human show ${id}.`;
}

/**
 * Whose Queue summary for `Needs` when `perspective` is returned by `/api/attention`.
 */
export function whoseQueueSummary(perspective, config = null, item = null) {
  if (!perspective || typeof perspective !== "object") return null;
  const rawPerson = typeof config?.person === "string" ? config.person.trim() : "";
  const hasPerson = /^[^@\s]+@external$/.test(rawPerson);
  const actorAddress = hasPerson ? rawPerson : "human@host";
  const actorLabel = hasPerson ? rawPerson : "human@host (unattributed)";
  const personId = hasPerson ? rawPerson.replace(/@external$/, "") : (perspective.actingAs?.person ?? null);
  const viewing = perspective.viewing ?? (perspective.basis === "all" ? "everyone" : perspective.basis === "default" ? "default" : "everyone");
  const recipient = item?.recipient ?? item?.destinationSession ?? null;
  const recipientNorm = typeof recipient === "string" ? recipient.trim() : null;
  const isDifferentRecipient = Boolean(
    recipientNorm &&
    recipientNorm !== actorAddress &&
    (!personId || (recipientNorm !== personId && recipientNorm !== `${personId}@external`))
  );
  const onSomeoneElsesAsk = isDifferentRecipient ? `on ${recipientNorm}'s ask` : null;
  return {
    viewing,
    basis: perspective.basis ?? "default",
    actorLabel,
    actorAddress,
    hasPerson,
    personId,
    onSomeoneElsesAsk,
    headline: `Viewing ${viewing} · you act as ${actorLabel}`,
  };
}

/**
 * Resolve an `asker` (`<logicalId>@<rig>`) against the loaded `topology`.
 * Returns `{ found: true, seat }` or `{ found: false, message: "<asker> isn't in this OpenRig's loaded teams." }`.
 */
/** A rig by name or id within ONE connection (the page's, the one an action acts for): never the first match of another connection's rows. Rows that name no connection (one OpenRig) match any. */
export const rigOfConnection = (topology, ref, conn = null) => (Array.isArray(topology) ? topology : []).find((r) => r && (r.name === ref || r.id === ref) && (!conn || !r.conn || r.conn === conn));

export function resolveAskerSeat(asker, topology = [], conn = null) {
  const raw = String(asker ?? "").trim();
  if (!raw) return { found: false, message: "No asking seat recorded on this item." };
  const atIdx = raw.lastIndexOf("@");
  const wantLogical = atIdx > 0 ? raw.slice(0, atIdx).replace(/-/g, ".") : raw.replace(/-/g, ".");
  const wantRig = atIdx > 0 ? raw.slice(atIdx + 1) : null;
  // The merged rows of several OpenRigs share names (every one has a `demo` and a kernel): a seat is looked up in the connection it is asked for, and a name two connections both hold with no
  // connection named is refused, never taken from whichever comes first.
  const hits = [];
  for (const rig of Array.isArray(topology) ? topology : []) {
    if (!rig || typeof rig !== "object") continue;
    if (conn && rig.conn !== conn) continue;
    const rigMatch = !wantRig || rig.name === wantRig || rig.id === wantRig;
    const seats = Array.isArray(rig.seats)
      ? rig.seats
      : (rig.pods ?? []).flatMap((p) => p?.seats ?? []);
    for (const s of seats) {
      if (!s || typeof s !== "object") continue;
      if (
        s.session === raw ||
        (rigMatch && (s.logicalId === wantLogical || s.logicalId === raw || `${s.logicalId}@${rig.name}` === raw))
      ) {
        hits.push({ ...s, rig: rig.name, rigId: rig.id, conn: rig.conn });
        break;
      }
    }
  }
  if (new Set(hits.map((h) => h.conn ?? "")).size > 1) return { found: false, ambiguous: true, message: AMBIGUOUS_NAME };
  if (hits.length) return { found: true, seat: hits[0] };
  return {
    found: false,
    message: `${raw} isn't in this OpenRig's loaded teams.`,
  };
}

/**
 * The slice of a seat's open work ("Open its slice"): its queue rows' `slice:<id>` tags, in-progress first,
 * matched to `/api/scopes?counts=1` missions by slice id or folder name. Null when no open row names a known slice.
 */
export function sliceForSeat(rows, missions) {
  const order = { "in-progress": 0, blocked: 1, pending: 2 };
  const open = (Array.isArray(rows) ? rows : []).filter((r) => r && r.state in order).sort((a, b) => order[a.state] - order[b.state]);
  for (const row of open) {
    for (const tag of row.tags ?? []) {
      if (typeof tag !== "string" || !tag.startsWith("slice:")) continue;
      const want = tag.slice("slice:".length);
      for (const m of missions ?? []) {
        const s = (m.slices ?? []).find((x) => x.id === want || x.dirName === want);
        if (s) return { mission: m.mission, slice: s.dirName, name: s.displayName ?? s.dirName };
      }
    }
  }
  return null;
}

/** A Markdown doc without its leading YAML frontmatter (Markdown would read its closing `---` as a heading rule). */
export function withoutFrontmatter(text) {
  const s = String(text ?? "");
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(s);
  return m ? s.slice(m[0].length).replace(/^\s+/, "") : s;
}

/** The exact recipe for starting one seat fresh (the CLI's own, `cli/src/fresh-seat-command.ts`). */
export function freshArgs(logicalId, rig, reason) {
  return ["seat", "launch", "--fresh", "--reason", reason, "--", `${logicalId}@${rig}`];
}

/** `rig tui` as the configured CLI runs it: the recorded node and entry, pinned to the mods' daemon and
 *  OpenRig home, never whatever `rig` a PATH finds. An argv for `tab.new`. */
export function tuiArgv(config) {
  const cmd = readCommand(config, ["tui"]);
  return [cmd.command, ...cmd.args];
}

/** A process argv that is OpenRig's TUI: `rig tui`, or the recorded CLI's entry followed by `tui`,
 *  at command position (with an optional leading `env` wrapper as launched by `tuiArgv` / remote `home()`). */
export function isTuiArgv(argv, config) {
  const a = (Array.isArray(argv) ? argv : []).map(String);
  if (a.length < 2) return false;
  const baseOf = (token) => token.split("/").pop();
  let cmd = 0;
  if (baseOf(a[0]) === "env") {
    cmd = 1;
    while (cmd < a.length) {
      if (a[cmd] === "--" || a[cmd] === "-") { cmd++; break; }
      if (a[cmd] === "-i" || a[cmd] === "--ignore-environment" || a[cmd].startsWith("--unset=")) { cmd++; continue; }
      if (a[cmd] === "-u" || a[cmd] === "--unset") { cmd += 2; continue; }
      break;
    }
    while (cmd < a.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(a[cmd])) cmd++;
  }
  if (cmd + 1 >= a.length) return false;
  const configured = Array.isArray(config?.rig) && config.rig.length ? config.rig.map(String) : ["rig"];
  const entries = new Set(configured.slice(-1));
  const token = a[cmd];
  if (a[cmd + 1] === "tui" && (baseOf(token) === "rig" || entries.has(token))) return true;
  if (configured.length >= 2 && cmd + configured.length < a.length && a[cmd + configured.length] === "tui") {
    const binMatches = token === configured[0]
      || (/^(?:node|nodejs)(?:\.exe)?$/.test(baseOf(configured[0])) && /^(?:node|nodejs)(?:\.exe)?$/.test(baseOf(token)));
    if (binMatches && configured.slice(1).every((part, idx) => a[cmd + 1 + idx] === part)) return true;
  }
  if (cmd + 2 < a.length && a[cmd + 2] === "tui" && /^(?:node|nodejs)(?:\.exe)?$/.test(baseOf(token))) {
    const entry = a[cmd + 1];
    // The installed `rig` symlink resolves to this Node entry in core's live
    // foreground argv. Require the package path and Node position, not merely
    // any script named bin-wrapper.js or a path after Node evaluation flags.
    const installedEntry = entry.startsWith("/") && !entry.split("/").includes("..")
      && /\/@openrig\/cli\/dist\/bin-wrapper\.js$/.test(entry);
    if (baseOf(entry) === "rig" || entries.has(entry) || installedEntry) return true;
  }
  return false;
}

/**
 * The live TUI in the active space, if any: one labelled `herdr-openrig.role=tui`, else
 * one whose foreground process is OpenRig's TUI. `panes` are herdr's (`panes()`), `tabs` the active space's tab ids,
 * `records` core's terminal records by address (`hc get`). Null when there is none: then one is opened.
 */
export function findTui(panes, tabs, records, config) {
  const here = (panes ?? []).filter((p) => p.terminal && tabs.includes(p.tab));
  const live = (p) => { const r = records[p.terminal]; return r && (r.state === undefined || r.state === "live") ? r : null; };
  const pick = (test) => here.find((p) => { const r = live(p); return r && test(r); });
  const hit = pick((r) => r.labels?.["herdr-openrig.role"] === "tui" && tuiRunning(r, config)) ?? pick((r) => isTuiArgv(r.foreground?.argv, config));
  return hit ? { terminal: hit.terminal, tab: hit.tab, pane: hit.pane } : null;
}

/** Whether a terminal (a core record, or herdr's `terminals()` row) is running OpenRig's TUI now. A kept terminal whose
 *  TUI ended (quit, or failed to start) is replaced in place by a shell and keeps its labels: the label
 *  alone doesn't say. Its foreground process does when known; else a shell program says it isn't. */
export function tuiRunning(record, config) {
  if (!record || (record.state !== undefined && record.state !== "live")) return false;
  if (Array.isArray(record.foreground?.argv) && record.foreground.argv.length) return isTuiArgv(record.foreground.argv, config);
  if (record.program?.shell === true) return false;
  if (typeof record.command === "string" && record.command.trim()) {
    const first = record.command.trim().split(/\s+/)[0].split("/").pop() ?? "";
    if (/^(-)?(ba|z|da|k|c|tc|fi)?sh$/i.test(first)) return false;
  }
  return true;
}

/** A keys.json chord (`ctrl-alt-r`) as people read it on this platform: `⌃⌥R` on macOS, `Ctrl+Alt+R` elsewhere. */
export function chordLabel(chord, platform) {
  const mac = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", super: "⌘" };
  const other = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: platform === "windows" ? "Win" : "Super", super: platform === "windows" ? "Win" : "Super" };
  const parts = String(chord ?? "").split("-").filter(Boolean);
  if (!parts.length) return "";
  const key = parts.pop();
  const name = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
  return platform === "macos" ? parts.map((m) => mac[m] ?? m).join("") + name : [...parts.map((m) => other[m] ?? m), name].join("+");
}

/** The key that opens the Rig palette, as bound in keys.json (`keys()` rows), for this platform; null when unbound (it
 *  is bound only by `--keys`). */
export function paletteKey(keys, platform) {
  const row = (keys ?? []).find((k) => k.action === "mod.open:rig-palette");
  return row ? chordLabel(row.keys, platform) : null;
}

/** A text box's draft key: the action and what it is for (a draft outlives an accidental close). */
export function draftKey(target, action) {
  // The legacy connection's drafts keep their old key (stored drafts stay found); another connection's are its own, so the same
  // seat name on two OpenRigs (every kernel has operator-agent@kernel) never shares a draft.
  const own = target?.conn && target.conn !== LEGACY_CONNECTION_ID ? `${target.conn}:` : "";
  return `${own}${action ?? ""}::${target?.qitemId ?? target?.session ?? target?.rig ?? target?.id ?? ""}`;
}

/** The editor language for a file, as herdr's Files viewer picks it (defaults/mods/files LANG). */
export function fileLanguage(file) {
  const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html", yml: "yaml", log: "txt" };
  const name = String(file ?? "").split(/[\\/]/).pop();
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "txt";
  return LANG[ext] ?? ext;
}

/** A slice's own files, in the order its Files card lists them (those present on disk are shown). */
export const SLICE_FILES = ["SPEC.md", "PROGRESS.md", "slice.yaml", "PROOF.md"];
/** A mission's own files. */
export const MISSION_FILES = ["SPEC.md", "NOTES.md", "PROGRESS.md", "mission.yaml"];

/** A seat's transcript (`<openrig home>/transcripts/<rig>/<session>.log`), when the config knows the OpenRig home. */
export function transcriptPath(config, rig, session) {
  return config?.openrigHome && rig && session ? `${config.openrigHome}/transcripts/${rig}/${session}.log` : null;
}

/** The Rig page entry that shows a file in the Files-look-alike viewer. */
export function fileEntry(path, title) {
  return { section: "file", path, name: title ?? String(path).split(/[\\/]/).pop() };
}

/** The breadcrumb trail for the page shown: where the page sits, never the pages visited before it. Each
 *  crumb is `{ text, entry }`; an ancestor's entry opens it. At most four: section › parent › child › file. */
export function crumbsFor(entry) {
  if (!entry) return [];
  const e = entry;
  const conn = e.conn ? { conn: e.conn } : {};
  const section = (s) => ({ text: SECTION_TITLES[s] ?? s, entry: { section: s, ...conn } });
  if (e.section === "file") {
    const own = { text: e.name ?? String(e.path ?? "").split(/[\\/]/).pop(), entry: e };
    return e.from ? [...crumbsFor(e.from).slice(0, 3), own] : [{ text: "Files", entry: null }, own];
  }
  if (e.section === "topology") {
    if (e.kind === "host") return [section("topology"), { text: e.name ?? e.hostId ?? e.host, entry: e }];
    if (e.kind === "rig") return [section("topology"), { text: e.name ?? e.rigId, entry: e }];
    if (e.kind === "pod") return [section("topology"), { text: e.rig ?? e.rigId, entry: { section: "topology", kind: "rig", rigId: e.rigId, ...conn, name: e.rig ?? e.rigId } }, { text: e.name ?? e.pod, entry: e }];
    if (e.kind === "seat" || e.kind === 'assistant') return [section("topology"), { text: e.rig, entry: { section: "topology", kind: "rig", rigId: e.rigId, ...conn, name: e.rig } }, { text: e.name, entry: e, icon: e.kind==='assistant'?'rig-queue':"rig-seat" }];
    if (e.focus === "pulse" || e.subview === "pulse") return [section("topology"), { text: "Pulse", entry: e }];
    return [section("topology")];
  }
  if (e.section === "scopes") {
    if(e.workflow){
      const mission={section:'scopes',...(e.project?{project:e.project}:{}),...conn,mission:e.mission,name:e.mission,missionTab:'workflows'};
      const workflow={...e};delete workflow.packet;workflow.name=e.workflowName??e.workflow;
      return [section('scopes'),{text:e.mission,entry:mission},{text:e.workflowName??e.workflow,entry:workflow},...(e.packet?[{text:e.name??e.packet,entry:e}]:[])];
    }
    if (e.slice) return [section("scopes"), { text: e.mission, entry: { section: "scopes", ...conn, mission: e.mission, name: e.mission } }, { text: e.name ?? e.slice, entry: e }];
    if (e.mission) return [section("scopes"), { text: e.name ?? e.mission, entry: e }];
    if (e.project) return [section("scopes"), { text: e.name ?? e.project, entry: e }];
    return [section("scopes")];
  }
  if (e.section === "specs") {
    if (e.id || e.specOf || (e.name && !e.kindFilter && !e.namespace)) return [section("specs"), { text: e.name ?? e.specOf ?? e.id, entry: e }];
    if (e.namespace) return [section("specs"), ...(e.kindFilter ? [{ text: e.kindFilter === "rig" ? "Rigs" : "Pods", entry: { section: "specs", ...conn, kindFilter: e.kindFilter, name: e.kindFilter === "rig" ? "Rigs" : "Pods" } }] : []), { text: e.namespace, entry: e }];
    if (e.kindFilter) return [section("specs"), { text: e.name ?? (e.kindFilter === "rig" ? "Rigs" : "Agents and workflows"), entry: e }];
    return [section("specs")];
  }
  if (e.section === "terminals") {
    if (e.view) return [section("terminals"), { text: e.name ?? e.view, entry: e }];
    if (e.group) return [section("terminals"), { text: e.name ?? e.group, entry: e }];
    return [section("terminals")];
  }
  if (e.section === "needs") {
    if (e.id) return [section("needs"), { text: rowHeadline(e.name ?? e.id) || "Request", entry: e }];
    if (e.category) return [section("needs"), { text: e.name ?? e.category, entry: e }];
    return [section("needs")];
  }
  if (e.section === "system") {
    if (e.settingKey) return [section("system"), { text: "Configuration", entry: { section: "system", ...conn, subview: "config", name: "Configuration" } }, { text: e.settingKey, entry: e }];
    if (e.category) return [section("system"), { text: "Configuration", entry: { section: "system", ...conn, subview: "config", name: "Configuration" } }, { text: e.category, entry: e }];
    if (e.subview) return [section("system"), { text: e.name ?? (SYSTEM_VIEW_LABELS.get(e.subview) ?? e.subview), entry: e }];
    if (e.openUsageHosts) return [section("system"), { text: "Usage · all hosts", entry: e }];
    return [section("system")];
  }
  return [section(e.section)];
}

function navConnIndices(stack, conn, primaryConn = null) {
  const out = [];
  for (let i = 0; i < stack.length; i++) {
    const e = stack[i];
    if (e?.conn ? e.conn === conn : i === stack.length - 1 && primaryConn && conn === primaryConn) out.push(i);
  }
  return out;
}

/** Where Back goes: the page before, else the shown page's breadcrumb parent; null when there's
 *  nowhere to go, and then Back isn't drawn. The same target `navBack` moves to. */
export function backTarget(nav, conn = null, { fallback = null, primaryConn = null } = {}) {
  const stack = nav?.stack ?? [];
  if (conn) {
    const idx = navConnIndices(stack, conn, primaryConn);
    const own = idx.length ? idx.map((i) => stack[i]) : (fallback ? [fallback] : []);
    if (own.length > 1) return own[own.length - 2];
    return crumbsFor(own[0]).slice(0, -1).reverse().find((c) => c.entry)?.entry ?? null;
  }
  const own = stack.length ? stack : (fallback ? [fallback] : []);
  if (own.length > 1) return own[own.length - 2];
  return crumbsFor(own[0]).slice(0, -1).reverse().find((c) => c.entry)?.entry ?? null;
}

/** A page's title, as its last breadcrumb names it. */
export function entryTitle(entry) {
  const crumbs = crumbsFor(entry ?? { section: "topology" });
  return String(crumbs[crumbs.length - 1]?.text ?? SECTION_TITLES[entry?.section] ?? "");
}

/** `‹` and `back`: the page before, else the shown page's parent (its breadcrumb before it), else nothing changes. */
export function navBack(nav, conn = null, { fallback = null, primaryConn = null } = {}) {
  const stack = nav?.stack ?? [];
  if (conn) {
    const idx = navConnIndices(stack, conn, primaryConn);
    if (idx.length > 1) {
      const last = idx[idx.length - 1];
      return { stack: [...stack.slice(0, last), ...stack.slice(last + 1)] };
    }
    const base = idx.length === 1 ? stack[idx[0]] : fallback;
    const parent = crumbsFor(base).slice(0, -1).reverse().find((c) => c.entry)?.entry;
    if (!parent) return { stack };
    if (idx.length === 1) {
      const next = stack.slice();
      next[idx[0]] = parent;
      return { stack: next };
    }
    return { stack: [...stack.slice(-29), parent] };
  }
  if (stack.length > 1) return { stack: stack.slice(0, -1) };
  const parent = crumbsFor(stack[0] ?? fallback).slice(0, -1).reverse().find((c) => c.entry)?.entry;
  return parent ? { stack: [parent] } : { stack };
}

/** Back on one tab: its own visit order (never another tab's), else its page's breadcrumb parent. */
export function tabPagesBack(all, tabId, { fallback = null, at = Date.now() } = {}) {
  if (!tabId) return all ?? {};
  const before = all?.[tabId]?.stack ?? [];
  const { stack } = navBack({ stack: before }, null, { fallback });
  if (stack === before || (stack.length === before.length && stack.every((e, i) => e === before[i]))) return all ?? {};
  return { ...(all ?? {}), [tabId]: { stack, at } };
}

/** Escape or ×: this tab's history goes; other tabs keep theirs. */
export function tabPagesClose(all, tabId) {
  if (!tabId || !all || !Object.hasOwn(all, tabId)) return all ?? {};
  const { [tabId]: _closed, ...rest } = all;
  return rest;
}

/** Only the tabs that still exist keep a record. */
export function tabPagesPrune(all, liveIds) {
  const live = new Set(liveIds ?? []);
  const kept = Object.entries(all ?? {}).filter(([id]) => live.has(id));
  return kept.length === Object.keys(all ?? {}).length ? all ?? {} : Object.fromEntries(kept);
}

/** Removes the entries `drop` matches (an archived or deleted rig's pages) from every tab. A stack left empty shows Topology:
 *  stamped with `conn` when it's known; with several OpenRigs and no `conn`, nothing at all, never a page that names no OpenRig. */
export function tabPagesScrub(all, drop, { conn = null, several = false, at = Date.now() } = {}) {
  let changed = false;
  const out = {};
  for (const [id, rec] of Object.entries(all ?? {})) {
    const before = rec?.stack ?? [];
    const stack = before.filter((entry) => !drop(entry));
    if (stack.length === before.length) { out[id] = rec; continue; }
    changed = true;
    out[id] = { stack: stack.length ? stack : conn ? [{ section: "topology", conn }] : several ? [] : [{ section: "topology" }], at };
  }
  return changed ? out : all ?? {};
}

/** Icon paths for `svg(...)` from one mod folder (`base` = e.g. `mods/${MOD_IDS.view}`): the Rig icons that folder
 *  ships (`rig-*`, and `bell`), else herdr's own (`workspace-chrome`). Per folder, so a renamed folder still finds them. */
export function iconsAt(base) {
  return (name) => {
    if (name === "bell") return `${base}/rig-bell.svg`;
    return name.startsWith("rig-") ? `${base}/${name}.svg` : `mods/workspace-chrome/${name}.svg`;
  };
}

/** An icon's path for `svg(...)`: the Rig mods' own (shipped in `mods/${modId}`) or herdr's (`workspace-chrome`). */
export function icon(name, modId = MOD_IDS.sidebar) {
  return iconsAt(`mods/${modId}`)(name);
}

/** The active space's TUI that the mod knows by its label (`herdr-openrig.role=tui`), from herdr's live `terminals()`: no
 *  process is started to find it, so the Open / Switch label can be decided on every render. */
export function labelledTui(terminals, spaces, config) {
  const space = (spaces ?? []).find((s) => s.active);
  if (!space) return null;
  const hit = (terminals ?? []).find((t) => t?.labels?.["herdr-openrig.role"] === "tui" && t.labels?.["herdr.space"] === space.id && tuiRunning(t, config));
  return hit ? { terminal: hit.address, tab: hit.labels?.["herdr.tab"] ?? null } : null;
}

/** The live TUI in the active space, on a press only: the labelled one, else one whose foreground process is OpenRig's
 *  TUI, read from core's record of each terminal there (`hc get`). A match found that way is labelled, so it is known
 *  from then on without asking again. */
export async function findTuiNow(host, config) {
  const get = async (address) => { try { return JSON.parse((await host.hc(["get", "--json", address])).stdout); } catch (_) { return null; } };
  const panes = host.panes() ?? [];
  // The labelled one is checked with core before it is used: its TUI may have ended into a shell.
  const known = labelledTui(host.terminals?.(), host.spaces(), config);
  const knownRecord = known ? await get(known.terminal) : null;
  if (known && tuiRunning(knownRecord, config)) return { ...known, tab: known.tab ?? panes.find((p) => p.terminal === known.terminal)?.tab ?? null };
  const space = (host.spaces() ?? []).find((s) => s.active);
  const tabs = (space?.tabs ?? []).map((t) => t.id);
  const records = {};
  for (const p of panes) {
    if (!p.terminal || !tabs.includes(p.tab)) continue;
    const r = await get(p.terminal);
    if (r) records[p.terminal] = r;
  }
  // A label left on a terminal that no longer runs the TUI is removed, so it is never shown as the TUI again.
  const stale = new Set(Object.entries(records).filter(([, r]) => r.labels?.["herdr-openrig.role"] === "tui" && !tuiRunning(r, config)).map(([a]) => a));
  if (knownRecord && !tuiRunning(knownRecord, config)) stale.add(known.terminal);
  for (const address of stale) await host.hc(["label", address, "herdr-openrig.role="]).catch(() => null);
  const found = findTui(panes, tabs, records, config);
  if (found && records[found.terminal]?.labels?.["herdr-openrig.role"] !== "tui") await host.hc(["label", found.terminal, "herdr-openrig.role=tui"]).catch(() => null);
  return found;
}

/** Command recipients in the published layout: hidden ancestors and inactive stack children do not receive commands.
 * Stack headers and non-hidden floats on shown nodes do. An absent or malformed layout is not evidence of a recipient. */
export function layoutShowsMod(node, mod) {
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!object(node) || (node.hidden !== undefined && typeof node.hidden !== "boolean") || node.hidden) return false;
  if (!["block", "row", "column", "stack"].includes(node.type)) return false;
  if (node.type === "block" ? !object(node.content) : !Array.isArray(node.children)) return false;
  if (node.floating !== undefined && !Array.isArray(node.floating)) return false;
  const floating = (node.floating ?? []).some(item => object(item) && (item.hidden === undefined || item.hidden === false) && item.content?.mod === mod);
  if (node.type === "block") return floating || node.content.mod === mod;
  if (node.type === "stack") {
    if (node.active !== undefined && node.active !== null && typeof node.active !== "string") return false;
    const visible = node.children.filter(child => object(child) && child.hidden !== true);
    const child = visible.find(item => item.id === node.active) ?? visible[0];
    return floating || node.header?.content?.mod === mod || layoutShowsMod(child, mod);
  }
  return floating || node.children.some(child => layoutShowsMod(child, mod));
}

/** herdr delivers a mod command ("<mod>.<command>") only to that mod's nextCommand(): every `rig.<command>` is the Rig sidebar's.
 *  With no Rig sidebar in the layout, herdr answers one with a raw "unknown command" toast, and `commands()` never lists a mod's own
 *  commands, so only the layout can tell whether it would arrive. */
export const isSidebarCommand = (name) => typeof name === "string" && name.startsWith(`${MOD_IDS.sidebar}.`);

const SIDEBAR_NEEDED = [
  [/^rig\.space(:|$)/, "open rig spaces", "Nothing was opened."],
  [/^rig\.(operator|open-operator)(:|$)/, "attach the operator", "No terminal was started."],
  [/^rig\.attach(:|$)/, "attach", "No terminal was started."],
  [/^rig\.(tui|open-tui)$/, "open the TUI", "Nothing was opened."],
  [/^rig\.open-page$/, "open the Rig page", "Nothing was opened."],
  [/^rig\.open-need(:|$)/, "open this request", "Nothing was opened."],
  [/^rig\.open-seat(:|$)/, "open this seat", "Nothing was opened."],
  [/^rig\.(choose-machine|confirm-machine)$/, "choose a machine", "Nothing was changed."],
  [/^rig\.rebuild-space$/, "rebuild the tiles", "Nothing was changed."],
  [/^rig\.move-grid$/, "move the rig space", "Nothing was moved."],
  [/^rig\.update-action(:|$)/, "dismiss updates", "Nothing was changed."],
  [/^rig\.(move-row|reset-order)(:|$)/, "reorder its rows", "Nothing was changed."],
  [/^rig\.refresh$/, "refresh it", "Nothing was sent."],
];

/** The plain guidance for a Rig sidebar command when no Rig sidebar is in the layout. */
export function sidebarNeeded(name) {
  const hit = SIDEBAR_NEEDED.find(([pattern]) => pattern.test(String(name ?? "")));
  return hit ? `Open the Rig sidebar to ${hit[1]}. ${hit[2]}` : "Open the Rig sidebar to do this. Nothing was sent.";
}

/** Why a Rig sidebar command can't run from here (the layout has no Rig sidebar), or null when it can. */
export function sidebarRefusal(node, name) {
  return isSidebarCommand(name) && !layoutShowsMod(node, MOD_IDS.sidebar) ? sidebarNeeded(name) : null;
}

/** A page's, menu's or palette's `run`: a Rig sidebar command is sent only while the Rig sidebar is in the layout. Without it, a
 *  person's action is told plainly what to do (`notify`); a background refresh (`quiet`) is just not sent. Other commands pass. */
export function sidebarRun(host, send, name, args, { quiet = false } = {}) {
  const refusal = sidebarRefusal(host.layout?.(), name);
  if (!refusal) return send(name, args);
  if (!quiet) host.notify?.({ title: refusal, level: "info" });
  return null;
}

/** Open or select the labelled local TUI in the recorded OpenRig home, independently of focused machine or space. */
/** A mod that registered its routing (every Rig mod does, at init) but has not read config.json yet has no config to open anything for. A bare host with no
 *  registered routing supplies everything itself and is not asked. Null when there is nothing to say. */
function routingNotReady(host, config) {
  if (!routingEnvironment) return null;
  const environment = routingEnvironment() ?? {};
  return (config ?? host?.config ?? environment.config) ? null : CONFIG_LOADING;
}
export async function openOrFocusTui(host, config) {
  const loading = routingNotReady(host, config);
  if (loading) { (host?.notify)?.({ title: "OpenRig", body: loading, level: "warning" }); return { ok: false, reason: loading }; }
  return routeRigOpen(host, config, { kind: "tui", ...(config?.connectionId && (config.connections ?? []).length > 1 ? { conn: config.connectionId } : {}) }); // with several OpenRigs the request names the one it is for
}

/** The rig page's tabs (matching TUI `tab table | recent | overview | graph | health`). */
export const RIG_TABS = ["table", "recent", "overview", "graph", "health"];

/** Compact progress bar + percentage (`▓▓▓▓░░ 62%`), or `null` when `pct` is null/undefined/NaN. */
export function usagePercentBar(pct, width = 6) {
  if (pct === null || pct === undefined || typeof pct === "boolean" || Number.isNaN(Number(pct))) return null;
  const p = Math.max(0, Math.min(100, Math.round(Number(pct))));
  const filled = Math.max(0, Math.min(width, Math.round((p / 100) * width)));
  return `${"▓".repeat(filled)}${"░".repeat(width - filled)} ${p}%`;
}

/** Tone (`"blocked" | "warn" | "ok" | "muted"`) for one usage window row based on `state`, `anomalies`, `unknownReason`, and `usedPercent`. */
export function usageWindowTone(win) {
  if (!win || typeof win !== "object") return "muted";
  const pct = typeof win.usedPercent === "number" ? win.usedPercent : (typeof win.utilizationPercent === "number" ? win.utilizationPercent : null);
  const state = String(win.state ?? "").toLowerCase();
  const anomalies = Array.isArray(win.anomalies) ? win.anomalies : [];
  if (
    state === "exceeded" || state === "exhausted" || state === "critical" || state === "error" || state === "blocked" ||
    win.linkage === "conflict" ||
    (pct !== null && pct >= 90) ||
    anomalies.some((a) => /exceed|exhaust|crit|error|block|conflict|rate_limit/i.test(String(a?.kind ?? a?.code ?? a?.severity ?? a)))
  ) {
    return "blocked";
  }
  if (
    (state && state !== "ok" && state !== "available" && state !== "normal") ||
    (pct !== null && pct >= 75) ||
    anomalies.length > 0
  ) {
    return "warn";
  }
  if (pct === null && (win.unknownReason || !win.used)) return "muted";
  return "ok";
}

/**
 * Flatten `HostUsageRow[]` (`/api/provider/usage` `hostUsage` or per-host `observations[]`) into display rows.
 * Renders one row per `windows[]` entry (`host`, `provider`, `window`, `usedText`, `resetsAt`, `asOf`, `state`, `anomalies`, `tone`),
 * falling back to top-level `u.used ?? u.summary` when `windows` is absent.
 */
export function formatUsageRows(hostUsage) {
  const rows = [];
  for (const u of Array.isArray(hostUsage) ? hostUsage : []) {
    if (!u || typeof u !== "object") continue;
    const host = u.hostId ?? u.host ?? "this machine";
    const wins = Array.isArray(u.windows) && u.windows.length ? u.windows : null;
    if (wins) {
      for (const w of wins) {
        if (!w || typeof w !== "object") continue;
        const bar = usagePercentBar(w.usedPercent);
        const usedText = bar ?? (w.unknownReason ? String(w.unknownReason) : String(u.used ?? u.summary ?? "unknown"));
        rows.push({
          host,
          provider: String(w.provider ?? u.provider ?? ""),
          window: String(w.window ?? w.label ?? "default"),
          usedPercent: typeof w.usedPercent === "number" ? w.usedPercent : null,
          usedText,
          resetsAt: String(w.resetsAt ?? ""),
          asOf: String(w.asOf ?? u.asOf ?? u.readAt ?? ""),
          state: String(w.state ?? u.state ?? "ok"),
          anomalies: Array.isArray(w.anomalies) ? w.anomalies : [],
          unknownReason: w.unknownReason ?? null,
          tone: usageWindowTone(w),
        });
      }
    } else {
      const bar = usagePercentBar(u.usedPercent);
      const usedText = bar ?? (u.unknownReason ? String(u.unknownReason) : String(u.used ?? u.summary ?? ""));
      rows.push({
        host,
        provider: String(u.provider ?? ""),
        window: String(u.window ?? "—"),
        usedPercent: typeof u.usedPercent === "number" ? u.usedPercent : null,
        usedText,
        resetsAt: String(u.resetsAt ?? ""),
        asOf: String(u.asOf ?? u.readAt ?? ""),
        state: String(u.state ?? "ok"),
        anomalies: Array.isArray(u.anomalies) ? u.anomalies : [],
        unknownReason: u.unknownReason ?? null,
        tone: usageWindowTone(u),
      });
    }
  }
  return rows;
}

/** True when a `/api/provider/usage` or `/api/provider/usage/hosts` read returned HTTP 409 (`usage_windows_disabled`). */
export function isUsageWindowsDisabled(got) {
  if (!got || typeof got !== "object") return false;
  if (got.status === 409) return true;
  if (got.data?.error === "usage_windows_disabled" || got.data?.code === "usage_windows_disabled") return true;
  if (got.errorData?.error === "usage_windows_disabled" || got.errorData?.code === "usage_windows_disabled") return true;
  return /\b409\b|usage_windows_disabled/i.test(String(got.error ?? ""));
}

/**
 * Normalize `GET /api/provider/usage/hosts` (`UsageAcrossHosts`) into per-host records by joining
 * top-level `data.items` (`UsageAllowanceGroup[]`) and `data.seatAccounts` onto `data.hosts`.
 * Falls back to inline `h.allowances` / `h.observations` when top-level `items` / `seatAccounts` are absent.
 */
export function normalizeUsageHosts(data) {
  if (!data || typeof data !== "object") return [];
  const rawHosts = Array.isArray(data.hosts) ? data.hosts : [];
  const items = Array.isArray(data.items) ? data.items : null;
  const seatAccounts = Array.isArray(data.seatAccounts) ? data.seatAccounts : null;
  const asOf = data.asOf ?? data.updatedAt ?? null;
  return rawHosts.map((h, i) => {
    const hid = h?.hostId ?? h?.label ?? `host-${i}`;
    let allowances = [];
    const groupNotes = [];
    if (items) {
      for (const g of items) {
        if (!g || typeof g !== "object") continue;
        const obsList = Array.isArray(g.observations) ? g.observations : [];
        for (const obs of obsList) {
          if ((obs?.hostId ?? obs?.host) !== hid) continue;
          if ((g.linkage === "conflict" || (Array.isArray(g.notes) && g.notes.length > 0)) && Array.isArray(g.notes)) {
            for (const n of g.notes) {
              if (n && !groupNotes.includes(String(n))) groupNotes.push(String(n));
            }
          }
          const row = obs?.row ?? obs;
          const wins = Array.isArray(row?.windows) ? row.windows : [];
          if (wins.length > 0) {
            for (const w of wins) {
              allowances.push({
                id: g.id ?? null,
                provider: String(row?.provider ?? g.provider ?? ""),
                window: String(w.window ?? w.windowLabel ?? g.label ?? "window"),
                windowLabel: String(w.windowLabel ?? w.window ?? g.label ?? "window"),
                usedPercent: typeof w.usedPercent === "number" ? w.usedPercent : (typeof w.utilizationPercent === "number" ? w.utilizationPercent : null),
                resetsAt: String(w.resetsAt ?? ""),
                state: String(w.level ?? w.state ?? row?.status ?? "ok"),
                unknownReason: w.levelReason ?? w.unknownReason ?? row?.unknownReason ?? null,
                anomalies: Array.isArray(row?.anomalies) ? row.anomalies : (Array.isArray(w.anomalies) ? w.anomalies : []),
                linkage: g.linkage ?? null,
                notes: Array.isArray(g.notes) ? g.notes : [],
                sharedAcrossProviders: g.linkage === "same" || Boolean(w.sharedAcrossProviders),
              });
            }
          } else if (row?.unknownReason || (row?.status && row.status !== "ok")) {
            allowances.push({
              id: g.id ?? null,
              provider: String(row?.provider ?? g.provider ?? ""),
              window: String(g.label ?? "—"),
              windowLabel: String(g.label ?? "—"),
              usedPercent: null,
              resetsAt: "",
              state: String(row?.status ?? "unknown"),
              unknownReason: String(row.unknownReason ?? row.status ?? ""),
              anomalies: Array.isArray(row?.anomalies) ? row.anomalies : [],
              linkage: g.linkage ?? null,
              notes: Array.isArray(g.notes) ? g.notes : [],
              sharedAcrossProviders: g.linkage === "same",
            });
          }
        }
      }
    }
    if (!allowances.length && Array.isArray(h?.allowances)) {
      allowances = h.allowances.map((a) => ({
        id: a.id ?? null,
        provider: String(a.provider ?? ""),
        window: String(a.windowLabel ?? a.window ?? a.id ?? "window"),
        windowLabel: String(a.windowLabel ?? a.window ?? a.id ?? "window"),
        usedPercent: typeof a.utilizationPercent === "number" ? a.utilizationPercent : (typeof a.usedPercent === "number" ? a.usedPercent : null),
        resetsAt: String(a.resetsAt ?? ""),
        state: String(a.state ?? "ok"),
        unknownReason: a.unknownReason ?? null,
        anomalies: Array.isArray(a.anomalies) ? a.anomalies : [],
        linkage: a.linkage ?? null,
        notes: Array.isArray(a.notes) ? a.notes : [],
        sharedAcrossProviders: Boolean(a.sharedAcrossProviders || a.linkage === "same"),
      }));
    }
    let observations = [];
    if (seatAccounts) {
      const sa = seatAccounts.find((x) => (x?.hostId ?? x?.host) === hid);
      if (sa && Array.isArray(sa.seats)) {
        observations = sa.seats.map((s) => ({
          seatSession: String(s.seatSession ?? ""),
          runtime: String(s.runtime ?? ""),
          accountLabel: String(s.configured?.profileRef ?? s.configured?.home ?? s.configured?.reason ?? s.accountLabel ?? s.seatSession ?? ""),
          status: String(s.configured?.source ?? s.status ?? ""),
          lastObservedAt: String(s.observed?.lastSampledAt ?? s.configured?.recordedAt ?? s.lastObservedAt ?? ""),
        }));
      }
    }
    if (!observations.length && Array.isArray(h?.observations)) {
      observations = h.observations;
    }
    const usageStatus = h?.usage && h.usage !== "served" ? String(h.usageReason ?? h.usage) : null;
    return {
      hostId: hid,
      label: String(h?.label ?? h?.hostId ?? "local"),
      status: String(h?.status ?? "online"),
      usage: h?.usage ?? null,
      usageReason: usageStatus,
      readAt: h?.readAt ?? h?.updatedAt ?? asOf ?? null,
      error: h?.error ?? null,
      notes: groupNotes,
      allowances,
      observations,
    };
  });
}

/** Resolve a navigation entry for a `RecentTransitionSnap` row when it targets a slice, mission, seat, or queue item. */
export function recentTransitionTarget(tr, topologyOrOpts = [], extraOpts = {}) {
  if (!tr || typeof tr !== "object") return null;
  const isOptsObj = topologyOrOpts && !Array.isArray(topologyOrOpts) && typeof topologyOrOpts === "object";
  const topology = isOptsObj ? (topologyOrOpts.topology ?? []) : (Array.isArray(topologyOrOpts) ? topologyOrOpts : []);
  const opts = isOptsObj ? topologyOrOpts : (extraOpts ?? {});
  const missions = Array.isArray(opts.missions) ? opts.missions : null;
  const attentionItems = Array.isArray(opts.attentionItems) ? opts.attentionItems : null;
  const kind = String(tr.targetKind ?? "").toLowerCase();
  const target = typeof tr.target === "string" ? tr.target.trim() : "";
  if (kind === "slice" || target.startsWith("slice:") || tr.slice) {
    const raw = String(tr.slice ?? (target.startsWith("slice:") ? target.slice(6) : target)).trim();
    if (!raw) return null;
    const slash = raw.indexOf("/");
    const rawMission = slash > 0 ? raw.slice(0, slash) : (tr.mission ?? undefined);
    const rawSlice = slash > 0 ? raw.slice(slash + 1) : raw;
    if (missions) {
      let matchedMission = null;
      let matchedSlice = null;
      for (const m of missions) {
        if (rawMission && m.mission !== rawMission) continue;
        const hit = (m.slices ?? []).find((s) =>
          s.dirName === rawSlice || s.id === rawSlice || s.sliceId === rawSlice || s.name === rawSlice || s.slug === rawSlice ||
          s.dirName === raw || s.id === raw || s.sliceId === raw
        );
        if (hit) {
          matchedMission = m.mission;
          matchedSlice = hit.dirName ?? rawSlice;
          break;
        }
      }
      if (!matchedSlice) return null;
      return { section: "scopes", mission: matchedMission, slice: matchedSlice, name: matchedSlice };
    }
    return { section: "scopes", ...(rawMission ? { mission: rawMission } : {}), slice: rawSlice, name: rawSlice };
  }
  if (kind === "mission" || target.startsWith("mission:") || (tr.mission && !tr.slice)) {
    const mission = String(tr.mission ?? (target.startsWith("mission:") ? target.slice(8) : target)).trim();
    return mission ? { section: "scopes", mission, name: mission } : null;
  }
  if (kind === "seat" || kind === "agent" || target.startsWith("seat:") || target.includes("@")) {
    const raw = target.startsWith("seat:") ? target.slice(5) : (target || String(tr.actorSession ?? ""));
    const all = (topology ?? []).flatMap((rig) => (rig.pods ?? []).flatMap((p) => (p.seats ?? []).map((s) => ({ rig, s }))));
    const hit = all.find(({ rig, s }) =>
      s.session === raw || s.logicalId === raw || `${rig.name}/${s.logicalId}` === raw || `${s.logicalId}@${rig.name}` === raw
    );
    if (hit) {
      return { section: "topology", kind: "seat", rig: hit.rig.name, rigId: hit.rig.id, conn: hit.rig.conn, name: hit.s.logicalId, session: hit.s.session };
    }
    if (raw.includes("@")) {
      const at = raw.lastIndexOf("@");
      const name = raw.slice(0, at).replace("-", ".");
      const rig = raw.slice(at + 1);
      return { section: "topology", kind: "seat", rig, ...(tr.rigId ? { rigId: tr.rigId, conn: tr.conn } : {}), name, session: raw };
    }
    if (raw.includes("/")) {
      const [rig, name] = raw.split("/", 2);
      return { section: "topology", kind: "seat", rig, name };
    }
  }
  if (kind === "need" || kind === "attention" || kind === "queue" || kind === "qitem" || tr.qitemId || target.startsWith("queue:") || target.startsWith("qitem-")) {
    const rawId = String((target.startsWith("queue:") || target.startsWith("qitem-") || kind === "need" || kind === "attention" || kind === "qitem") && target ? target : (tr.qitemId ?? target)).trim();
    if (!rawId) return null;
    const id = rawId.startsWith("queue:") ? rawId : `queue:${rawId}`;
    const bareId = rawId.startsWith("queue:") ? rawId.slice(6) : rawId;
    if (attentionItems) {
      const matched = attentionItems.find((item) => item && (item.id === id || item.id === bareId || item.qitemId === bareId));
      if (!matched) return null;
      return { section: "needs", id: matched.id ?? id, name: String(tr.summary || tr.bodyPreview || matched.summary || rawId) };
    }
    return { section: "needs", id, name: String(tr.summary || tr.bodyPreview || rawId) };
  }
  return null;
}

/** Normalize `/api/queue/recent-transitions` payload into display rows. */
/** Display text for one-line rows; retain full source text for detail views and copying. */
export function singleLineText(value) {
  return String(value ?? "").replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim();
}

/** The prefix of OpenRig's queue row ids, as people paste them into a row's text (the full id, or one shortened with an ellipsis). */
const ROW_ID_PREFIX = "qitem-";
const ROW_ID_SOURCE = `${ROW_ID_PREFIX}(?:[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*(?:…|\\.\\.\\.)?|…|\\.\\.\\.)`;
const ROW_ID = new RegExp(`\\b(?:queue(?:-update)?:)?${ROW_ID_SOURCE}`, "g"); // a pasted page id (queue:<id>) goes whole
/** An id in the sentence itself reads as "a row" ("see <id> for the trace" → "see a row for the trace"); after "row" or "item" it just goes. */
const BARE_ROW_ID = new RegExp(`(\\b(?:rows?|items?|qitems?)\\s+)?\\b(?:queue(?:-update)?:)?${ROW_ID_SOURCE}`, "gi");
/** "a row" starts with a capital at the start of the text or after a sentence end ("<id> is blocked" → "A row is blocked"). */
const sentenceStart = (text, at) => at === 0 || /[.!?]["')\]]*\s+$/.test(text.slice(Math.max(0, at - 8), at)); // only the few characters before the id: constant per id
const bareRowIds = (s) => s.replace(BARE_ROW_ID, (_m, lead, at, whole) => lead ? lead.trimEnd() : sentenceStart(whole, at) ? "A row" : "a row")
  // Ids joined only by "and", "or", "," or "/" read as a count: "a row and a row" → "two rows", three or more → "rows".
  .replace(/\b([Aa]) row((?:\s*(?:,|\/|\band\b|\bor\b)\s*a row)+)/g, (_m, a, more) => { const n = 1 + (more.match(/a row/g) ?? []).length; const word = n === 2 ? "two rows" : "rows"; return a === "A" ? word[0].toUpperCase() + word.slice(1) : word; });
/** Text without queue row ids, line breaks kept: a parenthetical that holds only ids (and a few joining words such as "row", "see" or "and")
 *  goes whole, and an id elsewhere reads as "a row". The row's id stays in its Details and its menu's Copy row id. */
export function withoutRowIds(value) {
  let s = String(value ?? "");
  if (!s.includes(ROW_ID_PREFIX)) return s;
  // Every whitespace pass starts only at the start of a horizontal run ((?<![^\S\n])), so a long run of spaces or tabs is scanned once, not once per space.
  s = s.replace(/(?<![^\S\n])[^\S\n]*\(([^()\n]*)\)/g, (whole, inner) => {
    if (!inner.includes(ROW_ID_PREFIX)) return whole;
    const rest = inner.replace(ROW_ID, " ").replace(/\b(?:rows?|items?|qitems?|see|was|is|and|or|from|in|by|of)\b/gi, " ").replace(/[\s,;:·/&+-]+/g, "");
    return rest ? ` (${bareRowIds(inner).trim()})` : "";
  });
  s = bareRowIds(s);
  return s.replace(/\([^\S\n]*\)/g, "").replace(/(?<![^\S\n])[^\S\n]+(?=[.,;:!?])/g, "").replace(/(?<![^\S\n])[^\S\n]{2,}/g, " ").replace(/^[^\S\n]+|(?<![^\S\n])[^\S\n]+$/gm, "");
}
/** The first whole queue row id in a text (a need's id such as `queue:<id>`), or null. */
export function rowIdIn(value) { return String(value ?? "").match(new RegExp(`${ROW_ID_PREFIX}[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*`))?.[0] ?? null; }
/** A row's text for display on one line, without queue row ids (see `withoutRowIds`). */
export function rowText(value) { return withoutRowIds(singleLineText(value)).trim(); }
/** A row's text where only a line fits (a sidebar row, its tooltip, a toast, a list row): the first sentence of `rowText`. */
/** True when a text holds queue row ids and nothing else worth showing (only joining words or punctuation besides them). */
export function rowIdOnly(value) {
  const text = singleLineText(value);
  if (!text.includes(ROW_ID_PREFIX)) return false;
  return !text.replace(ROW_ID, " ").replace(/\b(?:rows?|items?|qitems?|see|and|or)\b/gi, " ").replace(/[\s,;:·/&+().!?-]+/g, "").length;
}
/** A row's title where only a line fits: its first sentence without ids; for an id-only text, the body's first line, then "Untitled row".
 *  Never the raw id: that stays in the tooltip (rowTip), Details and Copy request id. */
export function rowTitle(value, body = "") {
  return rowHeadline(value) || rowHeadline(String(body ?? "").split(/\r\n|[\n\r\u2028\u2029]/).map(singleLineText).find(Boolean) ?? "") || "Untitled row";
}
/** The tooltip for a row title: the plain text without ids, or for an id-only text the original (so the id is still one hover away). */
export function rowTip(value) { return rowIdOnly(value) ? singleLineText(value) : rowText(value); }
export function rowHeadline(value) {
  if (rowIdOnly(value)) return "";
  const text = rowText(value);
  return requestFirstSentence(text) || text;
}

export function recentTransitionRows(data, topologyOrOpts = [], extraOpts = {}) {
  const list = Array.isArray(data) ? data : (data?.transitions ?? data?.entries ?? data?.items ?? []);
  return (Array.isArray(list) ? list : []).slice(0, 10).map((tr) => {
    const rawTs = singleLineText(tr?.ts ?? tr?.at ?? "");
    const opts=Array.isArray(topologyOrOpts)?extraOpts:topologyOrOpts;
    const ts = rawTs.includes("T") ? formatAbsoluteTime(rawTs,{timezone:opts?.timezone,seconds:true}) : (rawTs || "—");
    const actor = singleLineText(tr?.actorSession ?? tr?.actor ?? "—");
    const change = singleLineText(tr?.change ? String(tr.change).split(/\s*→\s*/).map(value => statusWord(value, "queue")).join(" → ") : tr?.fromState && tr?.toState ? `${statusWord(tr.fromState, "queue")} → ${statusWord(tr.toState, "queue")}` : statusWord(tr?.toState ?? tr?.state ?? "", "queue"));
    const bodyLine = String(tr?.bodyPreview ?? "").split(/\r\n|[\n\r\u2028\u2029]/).map(singleLineText).find(Boolean);
    const label = rowHeadline(tr?.summary) || (bodyLine && rowHeadline(bodyLine)) || (tr?.qitemId || tr?.transitionId ? "Untitled row" : "—"); // never the raw id (it stays in qitemId)
    return {
      transitionId: tr?.transitionId ?? null,
      qitemId: tr?.qitemId ?? null,
      ts,
      actor,
      change,
      label,
      rig: tr?.rig ?? null,
      navEntry: recentTransitionTarget(tr, topologyOrOpts, extraOpts),
    };
  });
}

function isSeatNeedsYou(seat, rigName, actionableNeeds) {
  if (seat?.status === "needs_input" || seat?.word === "needs you") return true;
  return actionableNeeds.some((item) => {
    const resolving=item?.answer?.verb==='resolve'||item?.reply==='resolve';
    const asker = String(resolving?(item?.waiting?.owner??item?.destinationSession??''):(item?.asker??''));
    const itemSeat = resolving?'':String(item?.seat ?? item?.logicalId ?? "");
    if (seat?.session && (asker === seat.session || itemSeat === seat.session)) return true;
    if (seat?.logicalId && (itemSeat === seat.logicalId || asker === seat.logicalId || (rigName && asker === `${seat.logicalId}@${rigName}`))) return true;
    return false;
  });
}

function isPulseBlockedSeat(s) {
  if (!s || typeof s !== "object") return false;
  return s.status === "blocked" || s.status === "attention_required" || s.status === "failed" ||
    s.word === "blocked" || s.word === "attention" || s.word === "failed" ||
    (s.tone === "blocked" && s.word !== "needs you" && s.status !== "needs_input");
}

/**
 * Compute counts for the Topology pulse status strip (`working`, `blocked`, `needs`, `idle`) across live rigs.
 * Uses the exact same predicate as `matchesPulseFilter` so segment counts strictly match filtered seat rows.
 */
export function computePulseCounts(models, attentionItems = []) {
  const modelList = Array.isArray(models) ? models : [];
  const allSeats = modelList.flatMap((m) => m?.seats ?? []);
  let working = 0, blocked = 0, needs = 0, idle = 0, unreported = 0, gone = 0;
  for (const m of modelList) {
    const rigObj = { ...(m?.rig ?? {}), ...m, name: m?.name ?? m?.rig?.name ?? m?.id ?? "" };
    // Pod headers may count a subset while retaining the whole rig for ask attribution/fallback.
    for (const s of m?.countSeats ?? m?.seats ?? []) {
      if (matchesPulseFilter(s, rigObj, "working", attentionItems, allSeats)) working++;
      if (matchesPulseFilter(s, rigObj, "blocked", attentionItems, allSeats)) blocked++;
      if (matchesPulseFilter(s, rigObj, "needs", attentionItems, allSeats)) needs++;
      if (matchesPulseFilter(s, rigObj, "idle", attentionItems, allSeats)) idle++;
      if (matchesPulseFilter(s, rigObj, "unreported", attentionItems, allSeats)) unreported++;
      if (matchesPulseFilter(s, rigObj, "gone", attentionItems, allSeats)) gone++;
    }
  }
  return { working, blocked, needs, idle, unreported, ...(gone ? { gone } : {}) }; // `gone` only when a tmux server is gone: otherwise the counts are as they always were
}

/** The requests among a list of attention items (updates dropped). A Topology draw asks this for every seat and every pulse bucket with the same
 *  list, which holds every update too: it is worked out once per list. */
const actionableNeedsCache = new WeakMap();
function actionableNeedsOf(attentionItems) {
  if (!Array.isArray(attentionItems)) return [];
  let hit = actionableNeedsCache.get(attentionItems);
  if (!hit || hit.length !== attentionItems.length) {
    hit = { length: attentionItems.length, needs: attentionItems.filter((i) => i && !isUpdateNeed(i) && !sweepFinding(i) && !["done", "closed", "denied", "canceled", "handed-off"].includes(i.state)) };
    actionableNeedsCache.set(attentionItems, hit);
  }
  return hit.needs;
}

/** Buckets partition seats; unreported activity is separate from known idle and stopped states. */
/** Whether any seat of a rig owns one of the requests. Every seat's every pulse bucket asks this with the same seats and requests (the
 *  "needs" fallback, reached up to eight times a seat), which made a count seats² x requests: 228 ms for 100 seats in QuickJS. It is worked out
 *  once per (seats, requests, rig name); the arrays are compared by identity, as a render passes the same ones to every seat. Like
 *  actionableNeedsOf, it assumes those arrays are never edited in place: a change arrives as a new array. */
const rigNeedsSeatCache = new WeakMap();
function rigHasNeedsSeat(seats, rigName, actionableNeeds) {
  if (!Array.isArray(seats) || !Array.isArray(actionableNeeds)) return (seats ?? []).some((s) => isSeatNeedsYou(s, rigName, actionableNeeds));
  let bySeats = rigNeedsSeatCache.get(seats);
  if (!bySeats) { bySeats = new WeakMap(); rigNeedsSeatCache.set(seats, bySeats); }
  let byNeeds = bySeats.get(actionableNeeds);
  if (!byNeeds) { byNeeds = new Map(); bySeats.set(actionableNeeds, byNeeds); }
  if (!byNeeds.has(rigName)) byNeeds.set(rigName, seats.some((s) => isSeatNeedsYou(s, rigName, actionableNeeds)));
  return byNeeds.get(rigName);
}

export function matchesPulseFilter(seat, rig, pulseFilter, attentionItems = [], _allSeats = []) {
  if (!pulseFilter) return true;
  // Neutral lifecycle states have a home in Idle; their individual row marks stay unchanged.
  if (["detached", "stopped", "exited"].includes(seat.status)) return pulseFilter === "idle";
  const actionableNeeds = actionableNeedsOf(attentionItems);
  const rigName = rig?.name ?? rig?.id ?? "";
  // A seat whose tmux server stopped answering has its own bucket: never idle or working. A request it owns still needs the person.
  if (seat.status === "terminal_gone") {
    const needs = isSeatNeedsYou({ ...seat, status: "idle", word: "idle" }, rigName, actionableNeeds);
    return pulseFilter === "needs" ? needs : pulseFilter === "gone" && !needs;
  }
  if (pulseFilter === "gone") return false; // only a terminal-gone seat is in that bucket
  // A live terminal can own a human request even when its activity word is idle. Keep counts aligned with its row.
  if(seat.terminal||seat.status==="terminal"){
    const needs=isSeatNeedsYou({...seat,status:"terminal",word:"terminal"},rigName,actionableNeeds);
    return pulseFilter==="needs"?needs:pulseFilter==="idle"&&!needs;
  }
  if(pulseFilter==="unreported")return seat.status==="unknown"&&!matchesPulseFilter(seat,rig,"needs",attentionItems);
  if (pulseFilter === "working") {
    return !matchesPulseFilter(seat, rig, "needs", attentionItems) && !isPulseBlockedSeat(seat)
      && (seat.tone === "working" || seat.status === "active" || seat.word === "working");
  }
  if (pulseFilter === "blocked") {
    return !matchesPulseFilter(seat, rig, "needs", attentionItems) && isPulseBlockedSeat(seat);
  }
  if (pulseFilter === "needs") {
    if (isSeatNeedsYou(seat, rigName, actionableNeeds)) return true;
    const rigHasMatchedSeat = rigHasNeedsSeat(rig?.seats ?? [], rigName, actionableNeeds);
    if (!rigHasMatchedSeat) {
      return actionableNeeds.some((item) => {
        const resolving=item?.answer?.verb==='resolve'||item?.reply==='resolve';
        const asker = String(resolving?(item?.waiting?.owner??item?.destinationSession??''):(item?.asker??''));
        const itemRig = String((resolving?null:item?.rig??item?.scope) ?? (asker.includes("@") ? asker.slice(asker.lastIndexOf("@") + 1) : ""));
        return Boolean(rigName && itemRig && itemRig === rigName);
      });
    }
    return false;
  }
  if (pulseFilter === "idle") {
    return !["working", "blocked", "needs", "unreported"].some(key => matchesPulseFilter(seat, rig, key, attentionItems));
  }
  return true;
}

/**
 * Fallback parser for TUI command lines when connected to stock OpenRig (`rig tui resolve` absent on 0.7.7).
 * Parses the TUI navigation and palette grammar in JS so `:topology`, `:specs`, `:scopes`, `:terminals`, `:needs`, `:system`,
 * `/filter`, `find`, `rig`, `pod`, `agent`, `spec`, `spec-of`, `running`, `mission`, `slice`, `host`, `tab`, `graph`, `back`,
 * `config`, `setting`, `reqs`, `narrative`, `read`, `reply`, `launch`, `launch-folder`, `launch-host`, `terminal-preview`,
 * `terminal`, `view-design`, `usage-hosts`, `project`, `projects`, `overview`, `recent`, and `pulse` work on stock OpenRig 0.7.7.
 */
export function resolveTuiLineFallback(line) {
  const s = String(line ?? "").trim();
  if (!s) return null;
  if (s.startsWith(":")) {
    const raw = s.slice(1).trim().toLowerCase();
    if (raw === "usage-hosts") return { kind: "nav", line: s, area: "system", action: { type: "usage-hosts" } };
    if (raw === "people") return { kind: "nav", line: s, area: "system", action: { type: "people" } };
    if (raw === "spaces-list") return { kind: "nav", line: s, area: "system", action: { type: "spaces-list" } };
    if (raw === "pulse") return { kind: "nav", line: s, area: "topology", action: { type: "pulse" } };
    if (raw === "overview") return { kind: "nav", line: s, area: "topology", action: { type: "overview", rig: null } };
    if (raw === "recent") return { kind: "nav", line: s, area: "topology", action: { type: "recent", target: null } };
    if (raw === "projects") return { kind: "nav", line: s, area: "scopes", action: { type: "scopes-projects" } };
    const map = {
      topology: "topology",
      specs: "specs",
      scopes: "scopes",
      terminals: "terminals",
      needs: "needs",
      "needs-you": "needs",
      system: "system",
    };
    const area = map[raw];
    return area ? { kind: "nav", line: s, area, action: { type: "jump" } } : null;
  }
  if (s.startsWith("/")) {
    return { kind: "nav", line: s, action: { type: "filter", text: s.slice(1) } };
  }
  const space = s.search(/\s/);
  const verb = (space < 0 ? s : s.slice(0, space)).toLowerCase();
  const rest = space < 0 ? "" : s.slice(space + 1).trim();
  const pages = { terminals: "terminals", attention: "needs", system: "system" };
  if (!rest && Object.hasOwn(pages, verb)) return { kind: "nav", line: s, area: pages[verb], action: { type: "jump" } };
  if (verb === "config" && !rest) return { kind: "nav", line: s, area: "system", action: { type: "config-open" } };
  if (verb === "view-design" || verb === "design-view") return null;
  if (verb === "open-page" && !rest) {
    return { kind: "action", line: s, action: { type: "open-page" } };
  }
  if (verb === "open-tui" && !rest) {
    return { kind: "action", line: s, action: { type: "open-tui" } };
  }
  if (verb === "operator" && !rest) {
    return { kind: "action", line: s, action: { type: "operator" } };
  }
  if (verb === "change-model") {
    return { kind: "action", line: s, action: { type: "change-model", seat: rest || null } };
  }
  if (verb === "usage-hosts" && !rest) return { kind: "nav", line: s, area: "system", action: { type: "usage-hosts" } };
  if (verb === "people" && !rest) return { kind: "nav", line: s, area: "system", action: { type: "people" } };
  if (verb === "spaces-list" && !rest) return { kind: "nav", line: s, area: "system", action: { type: "spaces-list" } };
  if (verb === "pulse" && !rest) return { kind: "nav", line: s, area: "topology", action: { type: "pulse" } };
  if (verb === "overview") return { kind: "nav", line: s, area: "topology", action: { type: "overview", rig: rest || null } };
  if (verb === "recent") return { kind: "nav", line: s, area: rest === "instance" ? "system" : "topology", action: { type: "recent", target: rest || null } };
  if (verb === "projects" && !rest) return { kind: "nav", line: s, area: "scopes", action: { type: "scopes-projects" } };
  if (verb === "project" && rest) return { kind: "nav", line: s, area: "scopes", action: { type: "scopes-project", project: rest } };
  if (verb === "find" && rest) return { kind: "nav", line: s, action: { type: "filter", text: rest } };
  if (verb === "back" && !rest) return { kind: "nav", line: s, action: { type: "back" } };
  if (verb === "graph" && !rest) return { kind: "nav", line: s, action: { type: "tab", tab: "graph" } };
  if (verb === "tab" && rest) return { kind: "nav", line: s, action: { type: "tab", tab: rest } };
  if ((verb === "rig" || verb === "pod" || verb === "agent" || verb === "spec" || verb === "host") && rest) {
    return { kind: "nav", line: s, area: verb === "spec" ? "specs" : "topology", action: { type: "drill", resource: verb, name: rest } };
  }
  if (verb === "spec-of" && rest) return { kind: "nav", line: s, area: "specs", action: { type: "cross", kind: "spec-of", name: rest } };
  if (verb === "running" && rest) return { kind: "nav", line: s, area: "topology", action: { type: "cross", kind: "running", name: rest } };
  if (verb === "mission" && rest) return { kind: "nav", line: s, area: "scopes", action: { type: "scopes-mission-open", mission: rest } };
  if (verb === "slice" && rest) {
    const slash = rest.indexOf("/");
    const mission = slash > 0 ? rest.slice(0, slash) : undefined;
    const slice = slash > 0 ? rest.slice(slash + 1) : rest;
    return { kind: "nav", line: s, area: "scopes", action: { type: "scopes-open", ...(mission ? { mission } : {}), slice } };
  }
  if (verb === "reqs" && !rest) return { kind: "nav", line: s, area: "scopes", action: { type: "scopes-reqs" } };
  if (verb === "narrative" && !rest) return { kind: "nav", line: s, area: "scopes", action: { type: "scopes-narrative" } };
  if (verb === "config" && rest) return { kind: "nav", line: s, area: "system", action: { type: "config-category", category: rest } };
  if (verb === "setting" && rest) return { kind: "nav", line: s, area: "system", action: { type: "config-setting", key: rest } };
  if (verb === "terminal-preview" && rest) return { kind: "nav", line: s, area: "terminals", action: { type: "terminal-preview", view: rest } };
  if (verb === "terminal" && rest) return { kind: "action", line: s, area: "terminals", action: { type: "act", act: "open-terminal", view: rest } };
  if (verb === "reply" && rest) return { kind: "action", line: s, area: "needs", action: { type: "attention-reply", text: rest } };
  if (verb === "launch" && !rest) return { kind: "action", line: s, area: "specs", action: { type: "spec-launch" } };
  if (verb === "launch-folder" && rest) return { kind: "action", line: s, area: "specs", action: { type: "launch-folder", folder: rest } };
  if (verb === "launch-host" && rest) return { kind: "action", line: s, area: "specs", action: { type: "launch-host", host: rest } };
  if (verb === "read" && rest) {
    const slash = rest.indexOf("/");
    if (slash > 0) return { kind: "nav", line: s, action: { type: "file-open", target: { root: rest.slice(0, slash), path: rest.slice(slash + 1) } } };
  }
  const menuVerbs = new Set(["pause", "resume", "fresh", "send", "queue", "resolve", "answer", "snapshot", "follow", "unfollow", "prune", "close"]);
  if (menuVerbs.has(verb)) {
    return { kind: "action", line: s, action: { type: verb } };
  }
  return null;
}

function resolveOverviewRoute(targetArg, top, topology = []) {
  const hit = targetArg
    ? topology.find((r) => r.name === targetArg || r.id === targetArg)
    : (topology.find((r) => r.id === (top?.rigId ?? top?.rig) || r.name === (top?.rig ?? top?.name)) ?? topology[0] ?? null);
  const rigId = hit?.id ?? targetArg ?? top?.rigId ?? top?.name ?? null;
  const rigName = hit?.name ?? targetArg ?? top?.name ?? top?.rig ?? null;
  const focusTarget = rigName ?? rigId;
  const open = {
    ...(rigId ? { [`rig:${rigId}`]: true } : {}),
    ...(rigName ? { [`rig:${rigName}`]: true } : {}),
  };
  return {
    entry: { section: "topology", ...(rigId || rigName ? { focusRig: rigId ?? rigName } : {}) },
    open,
    focus: focusTarget ? `rig:${focusTarget}` : "topology",
  };
}

function resolveRecentRoute(targetArg, top, topology = []) {
  if (targetArg === "instance" || (!targetArg && top?.section === "system")) {
    return {
      entry: { section: "system", openRecent: "instance" },
      open: { "sys:recent": true },
      focus: "sys:recent",
    };
  }
  const hit = targetArg
    ? topology.find((r) => r.name === targetArg || r.id === targetArg)
    : (topology.find((r) => r.id === (top?.rigId ?? top?.rig) || r.name === (top?.rig ?? top?.name)) ?? topology[0] ?? null);
  const rigName = hit?.name ?? targetArg ?? top?.name ?? top?.rig ?? null;
  const rigId = hit?.id ?? top?.rigId ?? rigName ?? null;
  const open = {
    ...(rigId ? { [`rig:${rigId}`]: true, [`rig-recent:${rigId}`]: true } : {}),
    ...(rigName ? { [`rig:${rigName}`]: true, [`rig-recent:${rigName}`]: true } : {}),
  };
  return {
    entry: { section: "topology", ...(rigId || rigName ? { focusRig: rigId ?? rigName, openRecent: rigName ?? rigId } : {}) },
    open,
    focus: rigName ? `rig-recent:${rigName}` : "topology",
  };
}

/**
 * Where a line the TUI's grammar resolved (`rig tui resolve --json` or `resolveTuiLineFallback`) goes in the Rig mods.
 * Pure: `top` is the page shown now, `topology` the sidebar's rigs. Returns one of:
 * - `{ entry }`: a page to show (optionally with `open`, `focus`, `project` state updates);
 * - `{ error }`: said inline, nothing moves;
 * - `{ act, ... }`: work the palette does (`read` a file from a readable root, open the slice's `slice-file`, `reply` to a
 *   Needs-You request, `launch` a spec, `open-view`).
 */
export function paletteRoute(res, top, topology = []) {
  const resolved = typeof res === "string"
    ? resolveTuiLineFallback(res)
    : (res && typeof res === "object" && !res.action && typeof res.line === "string" ? (resolveTuiLineFallback(res.line) ?? res) : res);
  const a = resolved?.action ?? {};
  const rawLine = typeof res === "string" ? res : String(resolved?.line ?? res?.line ?? "");
  const [typedRaw, typedRig] = rawLine.trim().split(/\s+/);
  const typed = (typedRaw ?? "").toLowerCase();
  if (typed === "view-design" || typed === "design-view") return null;
  if (typed === "open-page" || a.type === "open-page") return { act: "open-page" };
  if (typed === "open-tui" || a.type === "open-tui") return { act: "open-tui" };
  if (typed === "operator" || a.type === "operator") return { act: "operator" };
  if (typed === "change-model" || a.type === "change-model") return { act: "change-model", seat: a.seat ?? typedRig ?? null };
  if (typed === "notifications") {
    const mode = (typedRig ?? "").toLowerCase();
    if (!mode) return { kind: "notifications", act: "notifications", value: "toggle" };
    if (mode === "on") return { kind: "notifications", act: "notifications", value: true };
    if (mode === "off") return { kind: "notifications", act: "notifications", value: false };
    return { error: "notifications takes on or off (or no argument to toggle)." };
  }
  if (typed === "usage-hosts" || typed === ":usage-hosts" || a.type === "usage-hosts" || resolved?.area === "usage-hosts") {
    return { entry: { section: "system", openUsageHosts: true }, open: { "usage:hosts": true, "sys:usage-hosts": true }, focus: "sys:usage-hosts" };
  }
  if (typed === "people" || typed === ":people" || a.type === "people" || resolved?.area === "people") {
    return { entry: { section: "system", subview: "people", name: "People" }, open: { "branch:system": true }, focus: "sys:people" };
  }
  if (typed === "spaces-list" || typed === ":spaces-list" || a.type === "spaces-list" || resolved?.area === "spaces-list") {
    return { entry: { section: "system", subview: "layout", name: "Layout" }, open: { "branch:system": true }, focus: "sys:layout" };
  }
  if (typed === "pulse" || typed === ":pulse" || a.type === "pulse" || resolved?.area === "pulse") {
    return { entry: { section: "topology", focus: "pulse" }, focus: "pulse" };
  }
  if (typed === "overview" || typed === ":overview" || a.type === "overview") {
    return resolveOverviewRoute(a.rig ?? typedRig ?? null, top, topology);
  }
  if (typed === "recent" || typed === ":recent" || a.type === "recent") {
    return resolveRecentRoute(a.target ?? typedRig ?? null, top, topology);
  }
  if (typed === "projects" || typed === ":projects" || a.type === "scopes-projects") {
    return { entry: { section: "scopes", focusProjects: true }, focus: "scopes-projects" };
  }
  if ((typed === "project" && typedRig) || a.type === "scopes-project") {
    const proj = String(a.project ?? typedRig ?? "").trim();
    return { entry: { section: "scopes", project: proj }, project: proj };
  }
  const rigCard = top?.section === "topology" && top?.kind === "rig";
  if (resolved?.kind === "action") {
    if (a.type === "act" && a.act === "open-terminal") return { act: "open-view", view: a.view };
    if (a.type === "attention-reply") return { act: "reply", text: String(a.text ?? "") };
    if (a.type === "spec-launch" || (a.type === "act" && a.act === "launch-spec")) return { act: "launch" };
    if (a.type === "launch-folder") return { act: "launch", folder: String(a.folder ?? "") };
    if (a.type === "launch-host") return { act: "launch", host: String(a.host ?? "") };
    return { error: `"${resolved.line ?? a.type}" is an action the Rig page offers from the menus; open the item and right-click it.` };
  }
  switch (a.type) {
    case "jump": return { entry: { section: resolved.area ?? "topology" } };
    case "drill":
      if (a.resource === "agent") {
        const wantConn = res && typeof res === "object" && res.conn ? res.conn : top?.conn;
        const scoped = wantConn ? topology.filter((r) => !r.conn || r.conn === wantConn) : topology;
        const picked = pickSeat(scoped, (s, rig, pod) => seatMatchesRef(s, rig, pod, a.name), { rigId: res && typeof res === "object" ? res.rigId : undefined });
        if (picked.ambiguous) return { error: ambiguousSeatMessage(a.name, picked, { prefix: "agent " }) };
        return {
          entry: picked.seat
            ? { section: "topology", kind: "seat", rig: picked.rig.name, rigId: picked.rig.id, conn: picked.rig.conn, name: picked.seat.logicalId, session: picked.seat.session }
            : { section: "topology", filter: a.name },
        };
      }
      if (a.resource === "rig") {
        const rig = topology.find((r) => r.name === a.name);
        return { entry: rig ? { section: "topology", kind: "rig", rigId: rig.id, conn: rig.conn, name: rig.name } : { section: "topology", filter: a.name } };
      }
      if (a.resource === "spec") return { entry: { section: "specs", name: a.name } };
      // A pod or host: opens the dedicated Pod/Host page when matched in topology, else narrows the rig card or topology filter.
      if (a.resource === "pod") {
        const slash = String(a.name ?? "").indexOf("/");
        const wantRig = slash > 0 ? a.name.slice(0, slash) : (top?.rig ?? (rigCard ? top?.name : null));
        const wantPod = slash > 0 ? a.name.slice(slash + 1) : a.name;
        const hitRig = (topology ?? []).find((r) => (wantRig ? (r.name === wantRig || r.id === wantRig) : true) && (r.pods ?? []).some((p) => p.name === wantPod));
        if (hitRig) {
          return { entry: { section: "topology", kind: "pod", rig: hitRig.name, rigId: hitRig.id, conn: hitRig.conn, pod: wantPod, name: wantPod } };
        }
        return { entry: rigCard ? { ...top, tab: "table", filter: a.name } : { section: "topology", filter: a.name } };
      }
      if (a.resource === "host") {
        const hitHost = (topology ?? []).some((r) => r.host === a.name || (r.pods ?? []).some((p) => (p.seats ?? []).some((s) => s.host === a.name)));
        if (hitHost) {
          return { entry: { section: "topology", kind: "host", host: a.name, name: a.name } };
        }
        return { entry: rigCard ? { ...top, tab: "table", filter: a.name } : { section: "topology", filter: a.name } };
      }
      return { entry: { section: resolved.area ?? "topology", filter: a.name } };
    case "cross":
      return { entry: a.kind === "spec-of" ? { section: "specs", specOf: a.name, name: `spec of ${a.name}` } : { section: "topology", filter: a.name } };
    case "tab":
      if (RIG_TABS.includes(a.tab) && rigCard) return { entry: { ...top, tab: a.tab } };
      if (a.tab === "health") return { entry: { section: "system" } };
      if (a.tab === "yaml" && top?.section === "specs" && top?.id) return { entry: top };
      if (a.tab === "pulse") return { entry: { section: "topology", focus: "pulse" }, focus: "pulse" };
      if (a.tab === "overview") return resolveOverviewRoute(null, top, topology);
      if (a.tab === "recent") return resolveRecentRoute(null, top, topology);
      return { error: `Tab "${a.tab}" isn't a separate view here. Rig blocks show inline on Topology; try tab graph (Edges) or tab health (findings).` };
    case "back": return { back: true };
    case "terminal-preview": return { entry: { section: "terminals", view: a.view } };
    case "filter": return { entry: { ...(top ?? { section: "topology" }), filter: a.text } };
    case "scopes-mission-open": return { entry: { section: "scopes", mission: a.mission, name: a.mission } };
    case "scopes-open": return { entry: { section: "scopes", mission: a.mission ?? top?.mission ?? null, slice: a.slice, name: a.slice } };
    case "scopes-reqs":
      return { note: top?.section === "scopes" && top?.slice ? "The requirements are on this slice page." : "Open a slice first (:scopes), then run reqs." };
    case "scopes-narrative":
      if (top?.section === "scopes" && top?.slice) return { act: "slice-file", mission: top.mission, slice: top.slice, file: "PROGRESS.md" };
      return { note: "Open a slice first (:scopes), then run narrative." };
    case "file-open":
      if (unsafeReadPath(a.target?.path)) return { error: "Path must stay inside the readable root." };
      return { act: "read", target: a.target ?? {} };
    // Narrow the Configuration card only, never the page's other tables.
    case "config-open": return { entry: { section: "system", subview: "config" } };
    case "config-category":
      if (!CONFIG_CATEGORIES.includes(a.category)) return { error: `config takes a category: ${CONFIG_CATEGORIES.join(", ")}.` };
      return { entry: { section: "system", category: a.category } };
    case "config-setting": return { entry: { section: "system", settingKey: a.key } };
    default: return { entry: { section: resolved?.area ?? top?.section ?? "topology" } };
  }
}

/** `rig up` for a spec into a folder, optionally on a host: the TUI's own recipe
 *  (`up --cwd <folder> [--host <h>] -- <source>`), with `--yes` because the person confirmed it in the dialog and the
 *  mods run it with no terminal to answer in. `writeCommand` adds `--json`. Null when spec or folder is missing. */
export function launchSpecArgs(source, folder, host) {
  const s = String(source ?? "").trim(), f = String(folder ?? "").trim(), h = String(host ?? "").trim();
  if (launchSourceProblem(s) || launchFolderProblem(f)) return null;
  return ["up", "--cwd", f, ...(h && h !== "local" ? ["--host", h] : []), "--yes", "--", s];
}

/** The Launch rig from spec dialog's height: the form and a two-line `rig up` path fit without scrolling. */
export const LAUNCH_DIALOG_HEIGHT = 360;
/** Why a spec source can't go to `rig up`, or null. The daemon names it, so only two shapes pass: a bare library name,
 *  or a plain absolute `.yaml` / `.yml` path with no `..` (which the daemon reads on its own machine). A GitHub link
 *  or a bundle would be downloaded or installed, and a relative path or anything starting with `-` misread. */
export function launchSourceProblem(source) {
  const s = String(source ?? "").trim();
  if (!s) return "Nothing to launch: the spec has no name or file.";
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(s) && !/\.(rigbundle|ya?ml)$/i.test(s)) return null;
  if (s.startsWith("/") && /\.ya?ml$/i.test(s) && !s.split(/[\\/]/).includes("..") && !/[\0\r\n]/.test(s)) return null;
  return `Refused: "${s.slice(0, 120)}" isn't a spec name or a plain .yaml path, so it isn't launched from here.`;
}

/** The file name for a copy of a spec in a local spec folder, from its name: letters, digits, `.`, `_` and `-` only, so
 *  a name the daemon sends can't make a path. */
export function specCopyName(name) {
  const base = String(name ?? "").replace(/\.ya?ml$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 64);
  return base || "spec";
}

/** Why a launch folder can't be used, or null: it must be absolute, as the TUI requires. */
export function launchFolderProblem(folder) {
  const f = String(folder ?? "").trim();
  if (!f) return "A working folder is needed: the rig's seats start there.";
  if (!f.startsWith("/")) return "Working folder must be an absolute path (starting with /).";
  return null;
}

/** The environment a launch runs with: an empty or `local` host pins this machine, so a remote
 *  `host.selected` in OpenRig's config can't take the launch elsewhere. */
export function launchSpecEnv(host) {
  const h = String(host ?? "").trim();
  return !h || h === "local" ? ["OPENRIG_HOST_SELECTED=local"] : [];
}

/** A `read <root>/<path>` path that could leave its root: absolute, or with a `..` segment. The daemon's
 *  read checks again, symlinks included (`/api/files/read`). */
export function unsafeReadPath(path) {
  const p = String(path ?? "");
  return p.startsWith("/") || p.startsWith("\\") || p.split(/[\\/]/).includes("..");
}

/** A spec file path the mod must not write: not absolute, or with a `..` segment, or not a path the
 *  library lists as the person's own file. `allowed` is a folder (string) or the list of known user-file paths; none given
 *  checks the shape only. The write is also compare-and-swap, so it only ever replaces the file the person opened. */
export function unsafeSpecWritePath(sourcePath, allowed = null) {
  const p = String(sourcePath ?? "");
  if (!p.startsWith("/") || p.split(/[\\/]/).includes("..")) return true;
  if (!/\.ya?ml$/i.test(p)) return true;
  if (allowed == null) return false;
  if (Array.isArray(allowed) || allowed instanceof Set) return ![...allowed].includes(p);
  const dir = String(allowed).replace(/\/+$/, "");
  return !(p === dir || p.startsWith(`${dir}/`));
}

/** An absolute path with no `..` segment, without its trailing slashes; otherwise null. */
function plainAbsolute(p) {
  return typeof p === "string" && p.startsWith("/") && !p.split("/").includes("..") ? p.replace(/(.)\/+$/, "$1") : null;
}

/** A path with every symlink resolved, by this machine's `realpath` (a mod has no file system calls); null when it
 *  can't be resolved, so the caller refuses. */
async function realPath(execFn, p) {
  try {
    const r = await execFn("realpath", ["--", p]);
    const out = String(r?.stdout ?? "").replace(/\n$/, "");
    return r?.code === 0 && !out.includes("\n") ? plainAbsolute(out) : null;
  } catch (_) { return null; }
}

/**
 * The spec folders the spec editor may read and write: local facts only, never the daemon's list.
 * - OpenRig's instance spec library, `<home>/specs` (OpenRig's documented instance layout), where the home is the
 *   mods' configured `openrigHome`, else `OPENRIG_HOME` in Herdr's own environment, else `$HOME/.openrig`;
 * - `workspace.specs_root` from this machine's `rig` CLI (`rig config get`, which reads OpenRig's local settings, not
 *   the daemon).
 * Each folder is returned with its symlinks resolved; a folder that doesn't resolve is left out.
 */
export async function localSpecRoots(config, execFn, homeDir) {
  let ohome = plainAbsolute(config?.openrigHome || null);
  if (!ohome) {
    try {
      const r = await execFn("printenv", ["OPENRIG_HOME"]);
      if (r?.code === 0) ohome = plainAbsolute(String(r.stdout ?? "").trim());
    } catch (_) { /* no printenv: the default home */ }
  }
  if (!ohome && plainAbsolute(homeDir)) ohome = `${plainAbsolute(homeDir).replace(/\/$/, "")}/.openrig`;
  const wanted = ohome ? [`${ohome}/specs`] : [];
  try {
    const { command, args } = readCommand(config ?? {}, ["config", "get", "workspace.specs_root", "--json"]);
    const r = await execFn(command, args);
    const v = plainAbsolute(JSON.parse(String(r?.stdout ?? "{}"))?.value);
    if (v) wanted.push(v);
  } catch (_) { /* no CLI: only the home root */ }
  const roots = [];
  for (const w of new Set(wanted)) {
    const real = await realPath(execFn, w);
    if (real && real !== "/") roots.push(real);
  }
  return [...new Set(roots)];
}

/** A spec path outside the local spec folders (`localSpecRoots`): not absolute, a `..` segment, not YAML, or under none
 *  of them. Compared by path segment (`<root>/`), so `/a/specs-evil` isn't inside `/a/specs`. */
export function outsideSpecRoots(sourcePath, roots) {
  const p = String(sourcePath ?? "");
  if (!p.startsWith("/") || p.split(/[\\/]/).includes("..") || !/\.ya?ml$/i.test(p)) return true;
  return !(Array.isArray(roots) ? roots : []).some((r) => typeof r === "string" && r.startsWith("/") && p.startsWith(`${r}/`));
}

/** Why the spec editor refused a file, with what to do: no folder resolved at all (no `realpath`, which macOS has from
 *  13 on, or no spec folder yet), or the file is elsewhere (a home outside the default needs `openrigHome`). */
export async function specRealpathAvailable(execFn) {
  try {
    const result = await execFn("realpath", ["--", "/"]);
    return result?.code === 0 ? true : result?.code === 127 ? false : null;
  } catch (error) { return /ENOENT|not found/i.test(String(error?.message ?? error)) ? false : null; }
}
export function specFolderRefusal(roots, { machine = null, realpathAvailable = null, listed = false } = {}) {
  if (typeof machine === "string" && /^[a-z0-9][a-z0-9._-]{0,31}$/.test(machine)) {
    return `OpenRig's spec library is on ${machine}. Herdr can't edit files there yet; edit them on ${machine}.`;
  }
  if (realpathAvailable === false) return "The spec editor can't check paths on this computer: realpath is missing (available on macOS 13 or later).";
  if (!Array.isArray(roots) || roots.length === 0) {
    // With a connections list the machine of an OpenRig is its `machine`, never daemonMachine, and the folders are resolved the moment the page is used: asking again is the first thing to try.
    if (listed) return "No OpenRig spec folder was found on this computer for this OpenRig yet. Try again in a moment; if it runs on another machine, edit its specs there.";
    return "No OpenRig spec folder was found on this computer. If OpenRig runs on another machine, edit specs there, or add daemonMachine to openrig/config.json.";
  }
  return "Refused: the spec file isn't in this machine's spec folders. If your OpenRig home is somewhere other than the default, set openrigHome in <appHome>/openrig/config.json.";
}

/** The spec file to read or write, with its symlinks resolved, when it is inside a local spec folder after resolving:
 *  a link from a spec folder to a file elsewhere is refused. Null means refuse (outside, or it didn't resolve). */
export async function resolveInSpecRoots(sourcePath, roots, execFn) {
  const p = String(sourcePath ?? "");
  if (!p.startsWith("/") || p.split(/[\\/]/).includes("..") || !/\.ya?ml$/i.test(p)) return null;
  const real = await realPath(execFn, p);
  return real && !outsideSpecRoots(real, roots) ? real : null;
}

/** A short hash of a spec's text, to tell which file contents a draft was started from. */
export function simpleHash(text) {
  let h = 5381;
  for (const ch of String(text ?? "")) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return h.toString(36);
}

/** Ctrl+Enter in a multiline editor first inserts a newline (and the line's indent), then submits. When `now` is `prev` with
 *  exactly one `\n[ \t]*` inserted anywhere, returns `prev`; else `now` unchanged (a value set whole is left alone). */
export function stripSecondaryEnterNewline(prev, now) {
  const a = String(prev ?? ""), b = String(now ?? "");
  if (b.length <= a.length) return b;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const extra = b.length - a.length;
  const matches = at => /^\r?\n[ \t]*$/.test(b.slice(at, at + extra)) && b.slice(0, at) + b.slice(at + extra) === a;
  if (matches(i)) return a;
  // A shared existing newline/indent can be swallowed by the common prefix.
  // Try its start too, so inserting before an existing line stays unambiguous.
  while(i>0 && (a[i-1]===' ' || a[i-1]==='\t'))i--;
  if(i>0 && a[i-1]==='\n'){i--;if(i>0&&a[i-1]==='\r')i--;}
  return matches(i) ? a : b;
}

/** The TUI's configuration categories (tui/src/config/config-model.ts CONFIG_CATEGORIES). */
export const CONFIG_CATEGORIES = ["instance", "context", "display", "waiting", "recovery", "activity", "agents", "slack", "all", "sources"];

/** An entry's TUI category, exactly as the TUI derives it (config-model.ts configCategory). */
export function configCategory(entry) {
  if (entry.group === "slack" || entry.group === "people") return "slack";
  if (entry.group === "hosts") return "instance";
  if (entry.group === "health") return "context";
  const key = String(entry.key ?? "");
  if (/^(daemon|host|db|workspace|files|progress)\./.test(key)) return "instance";
  if (/^(topology|context|skills|onboarding|health)\./.test(key)) return "context";
  if (/^(ui|terminal)\./.test(key)) return "display";
  if (/^(workflow|queue|policies\.idle_gate_qitem)\./.test(key)) return "waiting";
  if (/^(recovery|snapshots|policies\.claude_compaction)\./.test(key)) return "recovery";
  if (/^(transcripts|feed|retention)\./.test(key)) return "activity";
  if (/^(agents|runtime)\./.test(key)) return "agents";
  return "all";
}

/** The System page's Configuration rows from `/api/config?view=browser` (`entries`): a withheld value says so.
 *  `category` narrows to a TUI category (`all`: everything; `sources`: the sources OpenRig read), `settingKey` to keys
 *  containing it. */
export function configRows(browser, { category = null, settingKey = null } = {}) {
  if (category === "sources") {
    return (Array.isArray(browser?.sources) ? browser.sources : []).map((src) => ({
      key: String(src.id ?? ""), group: "sources", source: String(src.path ?? ""), value: [src.state, src.detail].filter(Boolean).join(" · ") }));
  }
  const normKey = (s) => String(s ?? "").toLowerCase().replace(/[._]/g, ".");
  const want = settingKey ? normKey(settingKey) : null;
  const wantAlt = want?.startsWith("provider.") ? want.slice("provider.".length) : null;
  return (Array.isArray(browser?.entries) ? browser.entries : [])
    .filter((e) => {
      if (category && category !== "all" && configCategory(e) !== category) return false;
      if (!want) return true;
      const k = normKey(e.key);
      return k.includes(want) || (wantAlt ? k.includes(wantAlt) : false);
    })
    .map((e) => ({
    key: String(e.key ?? ""), group: configCategory(e), source: String(e.source ?? ""),
    value: e.visibility === "withheld" ? `withheld${e.reason ? ` (${e.reason})` : ""}` : e.visibility === "unavailable" ? "unavailable"
      : e.value !== null && typeof e.value === "object" ? JSON.stringify(e.value) : String(e.value ?? ""),
  }));
}

/** One-line reason shown when the connected OpenRig CLI lacks the `herdr-app` terminal provider (stock OpenRig 0.7.7). */
export const RIG_DELETE_REASON = "Your OpenRig's `rig down` can't delete a rig (no --delete). Update OpenRig to delete one here.";
export const RIG_ARCHIVE_REASON = "Your OpenRig has no `rig archive`. Update OpenRig to archive a rig here.";
export const RIG_CREATE_REASON = "Your OpenRig has no `rig create`. Start a rig from a spec instead, or update OpenRig.";
export const STOCK_PROVIDER_REASON = "Your OpenRig does not include the herdr-app provider. Update OpenRig to open worker views. Attach and the TUI tab still work.";
export const HERDR_APP_UNAVAILABLE_REASON = "Worker views open in a Herdr window on OpenRig's machine, and none is running there. Attach and the TUI tab still work.";
export const HERDR_APP_UNCONFIRMED_REASON = "Couldn't check for a Herdr window on OpenRig's machine. Refresh to try again; Attach and the TUI tab still work.";

/** One-line reason shown when `herdr-app` provider is present without `--follow` / `--prune-after`. */
export const FOLLOW_PRUNE_REASON = "Follow and auto-prune for herdr-app are not yet available in upstream OpenRig (need --follow and --prune-after support).";

/** One-line reason shown when `herdr-app` provider is present without saved-view grid geometry (`--grid`/`--replace`/`--cell`). */
export const GRID_GEOMETRY_REASON = "Custom worker-view grids and cell editing are not yet available in upstream OpenRig (need --grid/--replace and close --cell support).";

/** Compact copy shared by page notes and popup footers; original reasons remain available in tooltips. */
export function workerCapabilityText(reason = "", caps = null) {
  if (caps && ([STOCK_PROVIDER_REASON,FOLLOW_PRUNE_REASON,GRID_GEOMETRY_REASON,HERDR_APP_UNAVAILABLE_REASON,HERDR_APP_UNCONFIRMED_REASON].some(value=>reason.includes(value))
    || typeof caps.herdrAppAvailabilityReason==='string' && caps.herdrAppAvailabilityReason.length>0 && reason.includes(caps.herdrAppAvailabilityReason)))
    return caps.hostWorkerViews ? "" : "Saved views and Follow need an OpenRig that can plan worker views.";
  if (reason.includes(STOCK_PROVIDER_REASON)) return "Worker views need a newer OpenRig.";
  if (caps?.herdrAppProvider && (reason.includes(FOLLOW_PRUNE_REASON) || reason.includes(GRID_GEOMETRY_REASON))) {
    const names = [!caps.followPrune && "Follow", (!caps.gridGeometry || !caps.cellClose) && "Design view"].filter(Boolean);
    if (names.length) return `${names.join(" and ")} ${names.length === 1 ? "isn't" : "aren't"} in this OpenRig yet.`;
  }
  if (reason.includes(FOLLOW_PRUNE_REASON) || reason.includes(GRID_GEOMETRY_REASON)) return "These worker-view controls need more OpenRig support.";
  return reason;
}

/** One-line reason shown when a palette command requires `rig tui resolve` on stock OpenRig. */
export const TUI_RESOLVE_REASON = "Your OpenRig doesn't have rig tui resolve yet.";

/** Default capability set when connected to a full `herdr-integration` OpenRig daemon and CLI. */
export const DEFAULT_CAPABILITIES = Object.freeze({
  herdrAppProvider: true,
  followPrune: true,
  gridGeometry: true,
  cellClose: true,
  nativeSeats: true,
  mcpTerminalTools: true,
  tuiResolve: true,
  rigDelete: true,
  rigArchive: true,
  rigUnarchive: true,
  rigCreate: true,
});

const capabilitiesCache = new Map();
const confirmedCapabilities = new Map();
const capabilityVersions = new Map();
const capabilityFailures = new Map();
const CAPABILITY_VERSION_TTL_MS = 60_000;
const CAPABILITY_RETRY_TTL_MS = 20_000;

/** Clear cached CLI capability probe results (used on manual refresh, daemon reconnect, and tests). */
export function clearCapabilitiesCache() {
  capabilitiesCache.clear();
  confirmedCapabilities.clear();
  capabilityVersions.clear();
  capabilityFailures.clear();
}

/** Public `terminal status --provider herdr-app` reply. Plain status omits this provider even when available. */
export function herdrAppAvailability(status, machine = null) {
  const place = typeof machine === "string" && /^[a-z0-9][a-z0-9._-]{0,31}$/.test(machine) ? machine : "OpenRig's machine";
  const matches = Array.isArray(status?.providers) ? status.providers.filter(p => p?.name === "herdr-app") : [];
  const value = matches.length === 1 ? matches[0] : null;
  if (value?.status?.provider !== "herdr-app" || typeof value.status.available !== "boolean") {
    return { herdrAppAvailable: null, herdrAppAvailabilityReason: HERDR_APP_UNCONFIRMED_REASON };
  }
  const available = value.status.available && value.liveness?.alive !== false;
  return { herdrAppAvailable: available, herdrAppAvailabilityReason: available ? null : HERDR_APP_UNAVAILABLE_REASON.replace("OpenRig's machine",place) };
}

/**
 * Derive OpenRig capability flags from CLI `--help` outputs and live seat terminals.
 * - `herdrAppProvider`: `rig terminal open --help` advertises `herdr-app`.
 * - `followPrune`: `herdrAppProvider` and `rig terminal open --help` includes `--follow` and `--prune-after`.
 * - `gridGeometry`: `herdrAppProvider` and `rig terminal open --help` includes `--grid` and `--replace`.
 * - `cellClose`: `herdrAppProvider` and `rig terminal close --help` includes `--cell`.
 * - `nativeSeats`: `herdrAppProvider` and any live seat terminal carries `openrig.role=seat` (or `hasNativeSeatsEndpoint` / `nativeSeatsSupported`).
 * - `mcpTerminalTools`: `herdrAppProvider` is true (or `rig mcp` exposes `rig_terminal_open` / `rig_terminal_prune`).
 * - `tuiResolve`: `rig tui --help` advertises `resolve` (falls back to `herdrAppProvider` when `tuiHelp` is omitted).
 */
export function rigCapabilities({
  openHelp = "",
  closeHelp = "",
  tuiHelp = "",
  mcpHelp = "",
  hasNativeSeatsEndpoint = null,
  nativeSeatsSupported = null,
  hasLiveSeat = null,
  terminals = [],
  downHelp = "",
  archiveHelp = "",
  rigHelp = "",
  createHelp = "",
} = {}) {
  const open = String(openHelp ?? "");
  const close = String(closeHelp ?? "");
  const tui = String(tuiHelp ?? "");
  const mcp = String(mcpHelp ?? "");
  const herdrAppProvider = /\bherdr-app\b/.test(open);
  const followPrune = Boolean(herdrAppProvider && open.includes("--follow") && open.includes("--prune-after"));
  const gridGeometry = Boolean(herdrAppProvider && open.includes("--grid") && open.includes("--replace"));
  const cellClose = Boolean(herdrAppProvider && close.includes("--cell"));
  const liveSeat = hasLiveSeat !== null && hasLiveSeat !== undefined
    ? Boolean(hasLiveSeat)
    : (terminals ?? []).some((t) => t?.labels?.["openrig.role"] === "seat");
  const endpointFlag = hasNativeSeatsEndpoint !== null && hasNativeSeatsEndpoint !== undefined ? hasNativeSeatsEndpoint : nativeSeatsSupported;
  const nativeSeats = Boolean(herdrAppProvider && (liveSeat || (endpointFlag !== null && endpointFlag !== undefined ? endpointFlag : gridGeometry && cellClose)));
  const mcpTerminalTools = Boolean(herdrAppProvider || /\brig_terminal_(open|prune)\b/.test(mcp));
  const tuiResolve = tui.trim() && tui.trim() !== "{}" ? /\bresolve\b/.test(tui) : herdrAppProvider;
  // The rig lifecycle verbs, from their own help: a help that answered and lacks the verb or flag turns it off; no answer
  // leaves it on, and the CLI's own error says why if it fails.
  const answered = (h) => { const s = String(h ?? "").trim(); return s && s !== "{}"; };
  const missing = (h) => answered(h) && /\bunknown command\b/i.test(String(h));
  const rigDelete = !answered(downHelp) || (!missing(downHelp) && String(downHelp).includes("--delete"));
  const rigArchive = !missing(archiveHelp);
  const rigUnarchive = !answered(rigHelp) || /^[^\S\n]*unarchive(?:\s|$)/m.test(rigHelp);
  const rigCreate = !missing(createHelp);
  return { herdrAppProvider, followPrune, gridGeometry, cellClose, nativeSeats, mcpTerminalTools, tuiResolve, rigDelete, rigArchive, rigUnarchive, rigCreate };
}

/**
 * Cache measured help per connection and CLI version answer. Versions identify a cache entry;
 * capability flags still come from help, never a version threshold. Failed probes are retried.
 */
export async function probeCapabilities(config, { exec, terminals = [], hasNativeSeatsEndpoint = null, nativeSeatsSupported = null, force = false, providerAppHome = null, cliVersion = undefined } = {}) {
  // Help capabilities are cached; provider availability is live and must recover when the window starts/stops.
  const availableNow = async caps => {
    if (!caps.herdrAppProvider || typeof providerAppHome !== "string" || !providerAppHome) return caps;
    let status = null;
    try {
      const cmd = readCommand(config, ["terminal", "status", "--provider", "herdr-app", "--app-home", providerAppHome, "--json"]);
      const result = await exec(cmd.command, cmd.args, { timeout: 15000 });
      if (result?.code === 0) status = JSON.parse(result.stdout);
    } catch (_) { /* An unavailable read is unconfirmed, never permission to open a view. */ }
    return { ...caps, ...herdrAppAvailability(status, config?.daemonMachine) };
  };
  const endpointFlag = hasNativeSeatsEndpoint !== null && hasNativeSeatsEndpoint !== undefined ? hasNativeSeatsEndpoint : nativeSeatsSupported;
  if (config?.capabilities && typeof config.capabilities === "object") {
    const hasLiveSeat = (terminals ?? []).some((t) => t?.labels?.["openrig.role"] === "seat");
    const merged = { ...DEFAULT_CAPABILITIES, ...config.capabilities };
    return availableNow(merged.herdrAppProvider && hasLiveSeat && !merged.nativeSeats ? { ...merged, nativeSeats: true } : merged);
  }
  const key = JSON.stringify([config?.rig ?? ["rig"], config?.connectionId ?? null, config?.daemonUrl ?? null, config?.daemonMachine ?? null, config?.openrigHome ?? null]);
  if (typeof exec !== "function") return availableNow({ ...DEFAULT_CAPABILITIES });
  const unconfirmed = () => {
    const previous = confirmedCapabilities.get(key);
    const identity = capabilityVersions.get(key);
    if (identity?.version && identity.until > Date.now() && previous?.version === identity.version) {
      const cached = previous.value;
      const hasLiveSeat = (terminals ?? []).some(t => t?.labels?.["openrig.role"] === "seat");
      return availableNow({ ...cached, usingLastConfirmed: true, nativeSeats: Boolean(cached.herdrAppProvider && (cached.nativeSeats || hasLiveSeat || endpointFlag)) });
    }
    return availableNow({ ...DEFAULT_CAPABILITIES, probed: false });
  };
  if (force) { capabilitiesCache.delete(key); capabilityVersions.delete(key); capabilityFailures.delete(key); }
  const failureUntil = capabilityFailures.get(key) ?? 0;
  const failedIdentity = capabilityVersions.get(key);
  // Keep the help retry window, but revalidate a known version at its own expiry: falling back to
  // permissive defaults here would otherwise make unsupported controls flap during a slow outage.
  if (failureUntil > Date.now() && (!failedIdentity?.version || failedIdentity.until > Date.now())) return unconfirmed();
  if (failureUntil <= Date.now()) capabilityFailures.delete(key);
  if (cliVersion === null) {
    capabilitiesCache.delete(key); capabilityVersions.delete(key);
    capabilityFailures.set(key, Date.now() + CAPABILITY_RETRY_TTL_MS);
    return unconfirmed(); // the current state probe could not identify this CLI; do not fan out into help
  }
  // A minute bounds additional CLI processes while noticing upgrades. Failed/unconfirmed reads retry after
  // twenty seconds (not every refresh); explicit Refresh/Retry bypasses both limits. Existing state probes stay fresh.
  let identity = capabilityVersions.get(key);
  if ((cliVersion !== undefined && cliVersion !== identity?.version) || !identity || identity.until <= Date.now()) {
    let version = cliVersion, failed = false;
    if (version === undefined) {
      try {
        const cmd = readCommand(config, ["--version"]), result = await exec(cmd.command, cmd.args, { timeout: 15000 });
        failed = !result || result.code !== 0;
        version = failed ? null : String(result.stdout ?? "").trim();
      } catch (error) {
        capabilitiesCache.delete(key); capabilityVersions.delete(key);
        if (error?.code === "GATE_REFUSED") throw error;
        failed = true;
      }
    }
    if (failed) {
      capabilitiesCache.delete(key); capabilityVersions.delete(key);
      capabilityFailures.set(key, Date.now() + CAPABILITY_RETRY_TTL_MS);
      return unconfirmed(); // no seven-command fan-out when the CLI version itself could not answer
    }
    version = typeof version === "string" && version.trim() && version.trim() !== "{}" ? version.trim() : null;
    if (!version) capabilitiesCache.delete(key); // an unknown identity is reused only inside its short window
    identity = { version, until: Date.now() + (version ? CAPABILITY_VERSION_TTL_MS : CAPABILITY_RETRY_TTL_MS) };
    capabilityVersions.set(key, identity);
  }
  const version = identity.version;
  if (!version || confirmedCapabilities.get(key)?.version !== version) confirmedCapabilities.delete(key);
  if (failureUntil > Date.now()) return unconfirmed(); // version only; never fan out into help before its retry boundary
  if (!force && capabilitiesCache.has(key) && capabilitiesCache.get(key).version === version) {
    const cached = capabilitiesCache.get(key).value;
    const hasLiveSeat = (terminals ?? []).some((t) => t?.labels?.["openrig.role"] === "seat");
    return availableNow({
      ...cached,
      nativeSeats: Boolean(cached.herdrAppProvider && (cached.nativeSeats || hasLiveSeat || endpointFlag)),
    });
  }
  capabilitiesCache.delete(key); // a new version or a failed help read must not expose an older entry
  const probeExec = (cmd) => Promise.resolve(exec(cmd.command, cmd.args, { timeout: 15000 })).catch(rethrowGate(null)); // a refusal is not "nothing available": it must not be cached
  const openCmd = readCommand(config, ["terminal", "open", "--help"]);
  const closeCmd = readCommand(config, ["terminal", "close", "--help"]);
  const tuiCmd = readCommand(config, ["tui", "--help"]);
  const [openRes, closeRes, tuiRes, downRes, archiveRes, createRes, rigRes] = await Promise.all([
    probeExec(openCmd),
    probeExec(closeCmd),
    probeExec(tuiCmd),
    probeExec(readCommand(config, ["down", "--help"])),
    probeExec(readCommand(config, ["archive", "--help"])),
    probeExec(readCommand(config, ["create", "--help"])),
    probeExec(readCommand(config, ["--help"])),
  ]);
  const helpOf = (res) => `${res?.stdout ?? ""}\n${res?.stderr ?? ""}`.trim();
  const openHelp = `${openRes?.stdout ?? ""}\n${openRes?.stderr ?? ""}`.trim();
  const closeHelp = `${closeRes?.stdout ?? ""}\n${closeRes?.stderr ?? ""}`.trim();
  const tuiHelp = `${tuiRes?.stdout ?? ""}\n${tuiRes?.stderr ?? ""}`.trim();
  const replies = [openRes, closeRes, tuiRes, downRes, archiveRes, createRes, rigRes];
  const answered = res => res && helpOf(res) && (res.code === 0 || /\bunknown command\b/i.test(helpOf(res)));
  if (replies.some(res => !answered(res))) {
    capabilityFailures.set(key, Date.now() + CAPABILITY_RETRY_TTL_MS);
    return unconfirmed();
  }
  // In unit tests with an unconfigured fake exec (`stdout: "{}"`), keep full capabilities unless `/api/native-seats` was absent.
  if ((!openHelp || openHelp === "{}") && (!closeHelp || closeHelp === "{}") && endpointFlag !== false) {
    if (!version) capabilitiesCache.set(key, { version, value: { ...DEFAULT_CAPABILITIES } });
    return availableNow({ ...DEFAULT_CAPABILITIES });
  }
  const caps = rigCapabilities({ openHelp, closeHelp, tuiHelp, hasNativeSeatsEndpoint: endpointFlag, terminals,
    downHelp: helpOf(downRes), archiveHelp: helpOf(archiveRes), rigHelp: helpOf(rigRes), createHelp: helpOf(createRes) });
  if (replies.every(res => helpOf(res) && helpOf(res) !== "{}")) {
    capabilitiesCache.set(key, { version, value: caps });
    if (version) confirmedCapabilities.set(key, { version, value: caps });
  }
  return availableNow(caps);
}

/** Resolve the active capability flags from `shared` (or a capabilities/data object) and live `terminals()`. */
export function currentCapabilities(sharedOrData, terminals = [], measured = null) {
  const raw = typeof sharedOrData === "function"
    ? (sharedOrData("rig.capabilities") ?? sharedOrData("rig.data")?.capabilities)
    : (sharedOrData?.capabilities ?? sharedOrData);
  if (raw && typeof raw === "object" && raw.probed === false) {
    return { ...DEFAULT_CAPABILITIES, probed: false };
  }
  const base = raw && typeof raw === "object" && "herdrAppProvider" in raw
    ? { ...DEFAULT_CAPABILITIES, ...raw }
    : { ...DEFAULT_CAPABILITIES };
  // Configured verb flags cannot override the live availability of the provider's target window.
  if (Object.hasOwn(measured ?? {}, "herdrAppAvailable")) {
    base.herdrAppAvailable = measured.herdrAppAvailable;
    base.herdrAppAvailabilityReason = measured.herdrAppAvailabilityReason;
  }
  if(Object.hasOwn(measured??{},"hostWorkerViews"))base.hostWorkerViews=measured.hostWorkerViews;
  const hasLiveSeat = (terminals ?? []).some((t) => t?.labels?.["openrig.role"] === "seat");
  return base.herdrAppProvider && hasLiveSeat && !base.nativeSeats ? { ...base, nativeSeats: true } : base;
}

/** The capabilities of ONE connection's OpenRig. With several, its own measured flags (the sidebar's `rig.data.byConnection`) over its
 *  configured ones, never the first connection's. `null` when that connection's OpenRig hasn't been read yet (no sidebar, or its first refresh
 *  is still running): its flags are unknown, so a caller makes no early refusal and leaves the decision to the action's own dispatcher, which
 *  judges that connection itself. With one connection, exactly as before. */
export function connectionCapabilities(sharedFn, config, connId, terms = []) {
  if ((config?.connections?.length ?? 0) > 1 && connId) {
    const own = sharedFn("rig.data")?.byConnection?.[connId]?.capabilities;
    if (!own) return null;
    return currentCapabilities(configOfConnection(config, connId)?.capabilities ?? own, terms, own);
  }
  return currentCapabilities(config?.capabilities ?? sharedFn, terms, sharedFn("rig.capabilities"));
}

/**
 * Return the one-line disable reason for an action under `caps`, or `null` when the action is supported.
 * - Stock OpenRig (`herdrAppProvider === false`): disables `open-view`, `open-seat`, `follow`, `unfollow`, `prune`,
 *   `close-view`, `design-view`, `open-designed-view`, `close-cell`, `cell-swap`, `cell-split`, `cell-zoom`.
 *   Reasons distinguish the merged provider from follow/grid/cell support still absent upstream.
 * - Provider-only OpenRig (`herdrAppProvider === true`, `followPrune === false`): disables `follow`, `unfollow`, `prune`
 *   with `FOLLOW_PRUNE_REASON`.
 * - Provider-only OpenRig (`herdrAppProvider === true`, `gridGeometry === false` / `cellClose === false`):
 *   `open-view` and `cell-zoom` remain enabled; `design-view` /
 *   `open-designed-view` and `cell-swap`, `cell-split`, `close-cell` degrade with `GRID_GEOMETRY_REASON`.
 * - Needs replies/decisions use `POST /api/mission-control/action` and never require a CLI capability.
 */
export function capabilityDisableReason(action, caps = DEFAULT_CAPABILITIES) {
  const c = caps ?? DEFAULT_CAPABILITIES;
  if(["open-view","open-seat"].includes(action))return null; // Seats is always the fallback.
  if(["follow","unfollow","prune"].includes(action))return c.hostWorkerViews?null:"Saved views and Follow need an OpenRig that can plan worker views.";
  if(c.hostWorkerViews===true&&c.herdrAppAvailable===false&&["open-view","follow","unfollow","prune"].includes(action))return null;
  if(c.hostWorkerViews===true&&c.herdrAppAvailable===false&&["design-view","open-designed-view"].includes(action))return "Design view needs a Herdr window on OpenRig's machine.";
  if(c.hostWorkerViews===true&&c.herdrAppAvailable===false&&action==="close-view")return "Close these worker pages with Herdr's tab close controls; their seats keep running.";
  if (action === "tui-resolve" && c.tuiResolve === false) {
    return TUI_RESOLVE_REASON;
  }
  const providerActions = new Set([
    "open-view", "open-seat", "follow", "unfollow", "prune", "close-view",
    "design-view", "open-designed-view", "close-cell", "cell-swap", "cell-split",
    "cell-zoom",
  ]);
  if (!c.herdrAppProvider && providerActions.has(action)) {
    if (["follow", "unfollow", "prune"].includes(action)) return FOLLOW_PRUNE_REASON;
    if (["design-view", "open-designed-view", "close-cell", "cell-swap", "cell-split"].includes(action)) return GRID_GEOMETRY_REASON;
    return STOCK_PROVIDER_REASON;
  }
  if (c.herdrAppProvider && !c.followPrune && (action === "follow" || action === "unfollow" || action === "prune")) {
    return FOLLOW_PRUNE_REASON;
  }
  if (c.herdrAppProvider && !c.gridGeometry && (action === "design-view" || action === "open-designed-view" || action === "cell-swap" || action === "cell-split")) {
    return GRID_GEOMETRY_REASON;
  }
  if (c.herdrAppProvider && !c.cellClose && (action === "close-cell" || action === "cell-close")) {
    return GRID_GEOMETRY_REASON;
  }
  if (c.herdrAppProvider && Object.hasOwn(c, "herdrAppAvailable") && c.herdrAppAvailable !== true && providerActions.has(action)) {
    return c.herdrAppAvailabilityReason ?? HERDR_APP_UNCONFIRMED_REASON;
  }
  if (action === "delete-rig" && c.rigDelete === false) return RIG_DELETE_REASON;
  if (action === "archive-rig" && c.rigArchive === false) return RIG_ARCHIVE_REASON;
  if (action === "unarchive-rig" && c.rigUnarchive === false) return "Your OpenRig has no `rig unarchive`. Update OpenRig to restore an archived rig here.";
  if (action === "create-rig" && c.rigCreate === false) return RIG_CREATE_REASON;
  return null;
}

/**
 * Structured capability summary (`{ line, reason }`) for `:system` under Connections (`OpenRig Capabilities` + `Capability Note`).
 * When `caps` is `null` or `{ probed: false }`, returns `{ line: "unknown — refresh to check", reason: null }`.
 */
export function capabilitiesSummaryDetail(caps = DEFAULT_CAPABILITIES) {
  if (caps === null || (caps && typeof caps === "object" && caps.probed === false)) {
    return { line: "unknown — refresh to check", reason: null };
  }
  const c = caps ?? DEFAULT_CAPABILITIES;
  const mark = (ok) => (ok ? "✓" : "—");
  const line = c.usingLastConfirmed === true ? "Using the last answer from OpenRig (it didn't answer just now)" : [
    `herdr-app provider ${mark(c.herdrAppProvider)}`,
    `follow/prune ${mark(c.followPrune)}`,
    `custom grids ${mark(c.gridGeometry && c.cellClose)}`,
    `native seats ${mark(c.nativeSeats)}`,
  ].join(" · ");
  const reason = !c.herdrAppProvider
    ? STOCK_PROVIDER_REASON
    : Object.hasOwn(c, "herdrAppAvailable") && c.herdrAppAvailable !== true
      ? c.herdrAppAvailabilityReason ?? HERDR_APP_UNCONFIRMED_REASON
    : !c.followPrune
      ? FOLLOW_PRUNE_REASON
      : (!c.gridGeometry || !c.cellClose)
        ? GRID_GEOMETRY_REASON
        : null;
  const anyMissing = Object.keys(DEFAULT_CAPABILITIES).some((k) => c[k] === false);
  return {
    line,
    reason,
    ...(anyMissing ? { suggestedUpgrade: SUGGESTED_UPGRADE_LINE } : {}),
  };
}

/** Compact one-line summary for `:system` (`OpenRig Capabilities`). */
export function capabilitiesSummaryRow(caps = DEFAULT_CAPABILITIES) {
  const { line, reason } = capabilitiesSummaryDetail(caps);
  return reason ? `${line} (${reason})` : line;
}

/**
 * Snapshot of the person's native Herdr workspace (spaces, tabs, panes, non-viewer terminals, and focus)
 * used to detect when the person selects a native tab/space/agent or opens a new native
 * tab/pane/terminal while a Rig stack child covers `"main"`.
 */
export function snapshotNativeWorkspace({ props = {}, spaces = [], panes = [], terminals = [], focused = null, layout = null } = {}) {
  const sp = Array.isArray(spaces) ? spaces : [];
  const pn = Array.isArray(panes) ? panes : [];
  const tm = Array.isArray(terminals) ? terminals : [];
  const f = focused && typeof focused === "object" ? focused : null;
  const viewTerms = new Set(
    (props?.views ?? []).flatMap((v) => [
      ...(v?.rows ?? []).flat(),
      ...(v?.cells ?? []).map((c) => c?.terminal),
    ]).filter(Boolean)
  );
  const collectLayoutTerminals = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.content?.terminal === "string") viewTerms.add(node.content.terminal);
    for (const child of node.children ?? []) collectLayoutTerminals(child);
  };
  collectLayoutTerminals(layout);
  const paneTerms = new Set(pn.map((x) => x?.terminal).filter(Boolean));
  const isViewer = (addr, rec) => Boolean(
    (addr && viewTerms.has(addr)) ||
    rec?.labels?.["openrig.role"] === "viewer" ||
    rec?.labels?.["openrig.view"]
  );
  const isBackgroundSeat = (addr, rec) => Boolean(
    !rec?.labels?.["herdr.tab"] &&
    !(addr && paneTerms.has(addr)) &&
    (rec?.labels?.["openrig.role"] === "seat" || Boolean(rec?.parent))
  );
  const activeSpace = sp.find((s) => s?.active) ?? (f?.space ? sp.find((s) => s?.id === f.space) : null) ?? sp[0] ?? null;
  const activeSpaceId = activeSpace?.id ?? f?.space ?? null;
  const unsettledTabs = (activeSpace?.tabs ?? []).filter((t) => !t?.settled);
  const activeSpaceTab = unsettledTabs.find((t) => t?.active) ?? (activeSpace?.tabs ?? []).find((t) => t?.active) ?? null;
  const activeSpaceTabId = activeSpaceTab?.id ?? null;
  const focusedTabId = f?.tab ?? null;
  const activeTabId = activeSpaceTabId ?? focusedTabId ?? unsettledTabs[0]?.id ?? (activeSpace?.tabs ?? [])[0]?.id ?? null;
  const spaceIds = sp.map((s) => s?.id).filter(Boolean);
  const tabKeys = sp.flatMap((s) => (s?.tabs ?? []).filter((t) => !t?.settled).map((t) => `${s?.id ?? ""}:${t?.id ?? ""}`)).filter((k) => k !== ":");
  const paneKeys = pn
    .filter((x) => {
      const addr = x?.terminal;
      if (!addr) return true;
      const rec = tm.find((t) => t?.address === addr);
      return !isViewer(addr, rec) && !isBackgroundSeat(addr, rec);
    })
    .map((x) => `${x?.pane ?? x?.id ?? ""}:${x?.tab ?? ""}:${x?.terminal ?? x?.mod ?? ""}`)
    .filter((k) => k !== "::");
  const nativeTerminals = new Set(
    tm.filter((t) => {
      if (!t?.address || t.state === "finished" || t.state === "exited") return false;
      if (isViewer(t.address, t) || isBackgroundSeat(t.address, t)) return false;
      return true;
    }).map((t) => t.address)
  );
  for (const addr of paneTerms) {
    const rec = tm.find((t) => t?.address === addr);
    if (!isViewer(addr, rec) && !isBackgroundSeat(addr, rec)) nativeTerminals.add(addr);
  }
  const fTerm = f?.terminal ?? null;
  const fRec = fTerm ? tm.find((t) => t?.address === fTerm) : null;
  const focusedNativeTerminal = fTerm && !isViewer(fTerm, fRec) && !isBackgroundSeat(fTerm, fRec) ? fTerm : null;
  const fPaneRec = f?.pane ? pn.find((x) => (x?.pane ?? x?.id) === f.pane) : null;
  const fPaneTerm = fPaneRec?.terminal ?? fTerm;
  const fPaneTermRec = fPaneTerm ? tm.find((t) => t?.address === fPaneTerm) : null;
  const focusedNativePane = f?.pane && !(fPaneTerm && (isViewer(fPaneTerm, fPaneTermRec) || isBackgroundSeat(fPaneTerm, fPaneTermRec)))
    ? f.pane
    : null;
  const focusedAgent = f?.agent && !isViewer(f.agent, tm.find((t) => t?.address === f.agent)) ? f.agent : null;
  return {
    activeSpaceId,
    activeSpaceTabId,
    focusedTabId,
    activeTabId,
    spaceIds,
    tabKeys,
    paneKeys,
    nativeTerminals: [...nativeTerminals],
    focusedNativePane,
    focusedNativeTerminal,
    focusedAgent,
  };
}

/**
 * Decide whether to run `layout.select { stack, child: main }` because the person selected
 * a native Herdr space/tab/pane/agent or opened a new native tab/pane/terminal while `shown !== main`.
 */
export function shouldSelectMainOnNativeChange(prev, cur, { shown, main = "main" } = {}) {
  if (!prev || !cur || !shown || shown === main) return false;
  if (cur.activeSpaceId && prev.activeSpaceId && cur.activeSpaceId !== prev.activeSpaceId) return true;
  const prevSpaceTab = prev.activeSpaceTabId ?? prev.activeTabId;
  if (cur.activeSpaceTabId && prevSpaceTab && cur.activeSpaceTabId !== prevSpaceTab) return true;
  const prevFocusedTab = prev.focusedTabId ?? prev.activeTabId;
  if (cur.focusedTabId && prevFocusedTab && cur.focusedTabId !== prevFocusedTab) return true;
  if (cur.activeTabId && prev.activeTabId && cur.activeTabId !== prev.activeTabId) return true;
  const prevSpaces = new Set(prev.spaceIds ?? []);
  if ((cur.spaceIds ?? []).some((id) => !prevSpaces.has(id))) return true;
  const prevTabs = new Set(prev.tabKeys ?? []);
  if ((cur.tabKeys ?? []).some((k) => !prevTabs.has(k))) return true;
  const prevPanes = new Set(prev.paneKeys ?? []);
  if ((cur.paneKeys ?? []).some((k) => !prevPanes.has(k))) return true;
  const prevTerms = new Set(prev.nativeTerminals ?? []);
  if ((cur.nativeTerminals ?? []).some((addr) => !prevTerms.has(addr))) return true;
  const sameShown = prev.shown === shown;
  if (sameShown) {
    if (cur.focusedNativePane && cur.focusedNativePane !== prev.focusedNativePane) return true;
    if (cur.focusedNativeTerminal && cur.focusedNativeTerminal !== prev.focusedNativeTerminal) return true;
    if (cur.focusedAgent && cur.focusedAgent !== prev.focusedAgent) return true;
  } else {
    if (cur.focusedNativePane && prev.lastModelPane && cur.focusedNativePane !== prev.lastModelPane) return true;
    if (cur.focusedNativeTerminal && prev.lastModelTerminal && cur.focusedNativeTerminal !== prev.lastModelTerminal) return true;
  }
  return false;
}

/**
 * One-way Sidebar -> Page synchronization:
 * Clicking or pressing `Enter` on a sidebar tree node sets `shared("rig.sel")` and navigates `rig-view` (`shared("rig.nav")`).
 * Never mutates `rig.open`, `rig.order`, or `rig.focusRig`.
 */
export function selectSidebarNode(host = {}, key, entry) {
  const k = String(key ?? "");
  const sel = { key: k, entry: entry ?? null, at: Date.now() };
  host.setShared?.("rig.sel", sel);
  if (entry) {
    return openOrFocusRigTab({ ...host, mayCreate: true }, entry);
  }
  return { kind: "select", key: k };
}

/**
 * True when `rig-view`'s current top entry (`nav.stack.at(-1)`) differs from the sidebar's selected node (`sel.entry`),
 * so the sidebar renders a subtle muted `·` affix on the selected row without moving or scrolling the tree.
 */
export function isSelectionElsewhere(sel, nav) {
  if (!sel || typeof sel !== "object" || !sel.entry) return false;
  const stack = Array.isArray(nav) ? nav : nav?.stack;
  const top = Array.isArray(stack) ? stack.at(-1) : null;
  if (!top) return false;
  const selKey = navKey(sel.entry);
  const topKey = navKey(top);
  return Boolean(selKey && topKey && selKey !== topKey);
}

/**
 * Order sibling items within `groupKey` using `orderMap[groupKey]` (`shared("rig.order")`),
 * preserving natural order for any newly appeared items not listed in `orderMap[groupKey]`.
 */
export function orderSiblings(items = [], groupKey = "", orderMap = null, idOf = (x) => x?.id ?? x?.name ?? String(x ?? "")) {
  const list = Array.isArray(items) ? items : [];
  if (list.length <= 1 || !groupKey || !orderMap || typeof orderMap !== "object") return [...list];
  const saved = Array.isArray(orderMap[groupKey]) ? orderMap[groupKey].map(String) : null;
  if (!saved || saved.length === 0) return [...list];
  const indexById = new Map();
  saved.forEach((id, idx) => {
    if (!indexById.has(id)) indexById.set(id, idx);
  });
  return list
    .map((item, naturalIdx) => {
      const id = String(idOf(item) ?? "");
      const savedIdx = indexById.has(id) ? indexById.get(id) : null;
      return { item, naturalIdx, savedIdx };
    })
    .sort((a, b) => {
      if (a.savedIdx !== null && b.savedIdx !== null) return a.savedIdx - b.savedIdx;
      if (a.savedIdx !== null) return -1;
      if (b.savedIdx !== null) return 1;
      return a.naturalIdx - b.naturalIdx;
    })
    .map((x) => x.item);
}

/** Pure sibling ID array move: moves `fromId` `"before"` or `"after"` `toId` within `currentIds`. */
export function reorderSiblingIds(currentIds = [], fromId, toId, position = "after") {
  const ids = (Array.isArray(currentIds) ? currentIds : []).map(String);
  const from = String(fromId ?? "");
  const to = String(toId ?? "");
  if (!from || !to || from === to) return [...ids];
  const fromIdx = ids.indexOf(from);
  const toIdx = ids.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return [...ids];
  const without = ids.filter((x) => x !== from);
  const targetIdx = without.indexOf(to);
  if (targetIdx < 0) return [...ids];
  const insertIdx = position === "before" ? targetIdx : targetIdx + 1;
  without.splice(insertIdx, 0, from);
  return without;
}

/**
 * Validate and apply a sibling drag-drop in the sidebar tree:
 * - Requires >4px pointer travel (`moved === true` or `Math.hypot(dx, dy) > 4`) so an ordinary click never reorders.
 * - Enforces `dragState.groupKey === dropTarget.groupKey`; cross-parent drops are rejected.
 */
export function applySiblingDrop(orderMap = {}, dragState = null, dropTarget = null, currentSiblingIds = []) {
  const prev = orderMap && typeof orderMap === "object" ? orderMap : {};
  if (!dragState || !dropTarget) return { accepted: false, reason: "no-drag", order: prev };
  const dx = Number(dropTarget.x ?? dragState.currentX ?? dragState.startX ?? 0) - Number(dragState.startX ?? 0);
  const dy = Number(dropTarget.y ?? dragState.currentY ?? dragState.startY ?? 0) - Number(dragState.startY ?? 0);
  const moved = dragState.moved === true || Math.hypot(dx, dy) > 4;
  if (!moved) return { accepted: false, reason: "below-threshold", order: prev };
  if (!dragState.groupKey || dragState.groupKey !== dropTarget.groupKey) {
    return { accepted: false, reason: "cross-group", order: prev };
  }
  if (!dragState.id || !dropTarget.id || String(dragState.id) === String(dropTarget.id)) {
    return { accepted: false, reason: "same-item", order: prev };
  }
  const nextIds = reorderSiblingIds(currentSiblingIds, dragState.id, dropTarget.id, dropTarget.position ?? "after");
  return {
    accepted: true,
    groupKey: dragState.groupKey,
    order: { ...prev, [dragState.groupKey]: nextIds },
  };
}

/** Remove custom sibling ordering for `groupKey` ("Reset order" on parent node's context menu). */
export function resetGroupOrder(orderMap = {}, groupKey = "") {
  const prev = orderMap && typeof orderMap === "object" ? { ...orderMap } : {};
  if (groupKey && groupKey in prev) delete prev[groupKey];
  return prev;
}

/** Parse `<appHome>/openrig/state.json` into `{ open, order, lastSeenNeedsAt, needsView, lastEndedModeApplicationId, lastActiveModeApplicationId }`, defaulting safely on missing or corrupt JSON. */
export function parseSidebarState(text) {
  try {
    const raw = JSON.parse(String(text ?? "{}"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { open: {}, order: {} };
    const open = {};
    if (raw.open && typeof raw.open === "object" && !Array.isArray(raw.open)) {
      for (const [k, v] of Object.entries(raw.open)) {
        if (typeof v === "boolean") open[k] = v;
      }
    }
    const order = {};
    if (raw.order && typeof raw.order === "object" && !Array.isArray(raw.order)) {
      for (const [k, v] of Object.entries(raw.order)) {
        if (Array.isArray(v)) order[k] = v.map(String);
      }
    }
    const out = { open, order };
    if(raw.sidebarViews&&typeof raw.sidebarViews==='object'&&!Array.isArray(raw.sidebarViews))out.sidebarViews=cleanSidebarViews(raw.sidebarViews);
    if (["priority", "rig"].includes(raw.topologyView)) out.topologyView = raw.topologyView;
    if (raw.notifiedNeeds && typeof raw.notifiedNeeds === "object") {
      const cleanedNeeds = cleanNotifiedNeeds(raw.notifiedNeeds);
      if (cleanedNeeds) out.notifiedNeeds = cleanedNeeds;
    }
    if (raw.notifiedNeedsByConnection && typeof raw.notifiedNeedsByConnection === "object" && !Array.isArray(raw.notifiedNeedsByConnection)) {
      const cleanedByConn = cleanNotifiedNeedsMap(raw.notifiedNeedsByConnection);
      if (Object.keys(cleanedByConn).length > 0) out.notifiedNeedsByConnection = cleanedByConn;
    }
    if (raw.awayStates && typeof raw.awayStates === "object" && !Array.isArray(raw.awayStates)) {
      const cleanedAway = cleanAwayStates(raw.awayStates);
      if (Object.keys(cleanedAway).length > 0) out.awayStates = cleanedAway;
    }
    if (typeof raw.lastSeenNeedsAt === "string" && raw.lastSeenNeedsAt) out.lastSeenNeedsAt = raw.lastSeenNeedsAt;
    if (typeof raw.needsView === "string" && raw.needsView) out.needsView = raw.needsView;
    if (typeof raw.lastEndedModeApplicationId === "string" && raw.lastEndedModeApplicationId) out.lastEndedModeApplicationId = raw.lastEndedModeApplicationId;
    if (typeof raw.lastActiveModeApplicationId === "string" && raw.lastActiveModeApplicationId) out.lastActiveModeApplicationId = raw.lastActiveModeApplicationId;
    return out;
  } catch (_) {
    return { open: {}, order: {} };
  }
}

/** Serialize `{ open, order, lastSeenNeedsAt, needsView, lastEndedModeApplicationId, lastActiveModeApplicationId }` into `<appHome>/openrig/state.json`, preserving any unrelated keys in `prevText`. */
export function serializeSidebarState(prevText, { open = {}, order = {}, lastSeenNeedsAt, needsView, lastEndedModeApplicationId, lastActiveModeApplicationId, topologyView, sidebarViews, notifiedNeeds, notifiedNeedsByConnection, awayStates } = {}) {
  let base = {};
  try {
    const parsed = JSON.parse(String(prevText ?? "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) base = parsed;
  } catch (_) {
    base = {};
  }
  const cleanOpen = {};
  if (open && typeof open === "object") {
    for (const [k, v] of Object.entries(open)) {
      if (typeof v === "boolean") cleanOpen[k] = v;
    }
  }
  const cleanOrder = {};
  if (order && typeof order === "object") {
    for (const [k, v] of Object.entries(order)) {
      if (Array.isArray(v) && v.length > 0) cleanOrder[k] = v.map(String);
    }
  }
  const next = { ...base, open: cleanOpen, order: cleanOrder };
  if(sidebarViews!==undefined)next.sidebarViews=cleanSidebarViews(sidebarViews);
  if (["priority", "rig"].includes(topologyView)) next.topologyView = topologyView;
  if (notifiedNeeds !== undefined) {
    const cleanedNeeds = cleanNotifiedNeeds(notifiedNeeds);
    if (cleanedNeeds) next.notifiedNeeds = cleanedNeeds;
    else delete next.notifiedNeeds;
  }
  if (notifiedNeedsByConnection !== undefined) {
    const cleanedByConn = cleanNotifiedNeedsMap(notifiedNeedsByConnection);
    if (Object.keys(cleanedByConn).length > 0) next.notifiedNeedsByConnection = cleanedByConn;
    else delete next.notifiedNeedsByConnection;
  }
  if (awayStates !== undefined) {
    const cleanedAway = cleanAwayStates(awayStates);
    if (Object.keys(cleanedAway).length > 0) next.awayStates = cleanedAway;
    else delete next.awayStates;
  }
  if (lastSeenNeedsAt !== undefined) {
    if (lastSeenNeedsAt) next.lastSeenNeedsAt = String(lastSeenNeedsAt);
    else delete next.lastSeenNeedsAt;
  }
  if (needsView !== undefined) {
    if (needsView) next.needsView = String(needsView);
    else delete next.needsView;
  }
  if (lastEndedModeApplicationId !== undefined) {
    if (lastEndedModeApplicationId) next.lastEndedModeApplicationId = String(lastEndedModeApplicationId);
    else delete next.lastEndedModeApplicationId;
  }
  if (lastActiveModeApplicationId !== undefined) {
    if (lastActiveModeApplicationId) next.lastActiveModeApplicationId = String(lastActiveModeApplicationId);
    else delete next.lastActiveModeApplicationId;
  }
  return `${JSON.stringify(next, null, 2)}\n`;
}

/**
 * Keyboard navigation over the visible sidebar tree rows:
 * - `up` / `ArrowUp`: move selection to previous visible row
 * - `down` / `ArrowDown`: move selection to next visible row
 * - `right` / `ArrowRight`: expand closed foldable row, or move to its first child when already open
 * - `left` / `ArrowLeft`: collapse open foldable row, or move selection to its parent row when already closed/leaf
 * - `enter` / `Enter`: activate the selected row (`selectSidebarNode` or row action)
 * - `home` / `end`: the first / last visible row
 * - `s` / `q`: the selected row's Send… / Queue… (`{ type: "action" }`; the page offers them, the sidebar ignores them)
 * - the Menu key or Shift+F10: the selected row's menu (`{ type: "menu" }`)
 * The WAI-ARIA Authoring Practices "Tree View" keys, with S, Q and the menu added.
 */
export function treeKeyNav(visibleRows = [], selectedKey = null, key = "", { openMap = {}, shift = false } = {}) {
  const rows = Array.isArray(visibleRows) ? visibleRows : [];
  if (!rows.length) return null;
  const k = String(key ?? "").toLowerCase();
  const idx = selectedKey ? rows.findIndex((r) => r?.key === selectedKey) : -1;
  const curIdx = idx >= 0 ? idx : 0;
  const cur = rows[curIdx];
  if (["pageup", "pagedown", "page_up", "page_down"].includes(k)) {
    const next = idx < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, curIdx + (k === "pageup" || k === "page_up" ? -10 : 10)));
    return { type: "move", key: rows[next].key, row: rows[next] };
  }
  if (k === "down" || k === "arrowdown" || k === "j") {
    const nextIdx = idx < 0 ? 0 : Math.min(rows.length - 1, curIdx + 1);
    const row = rows[nextIdx];
    return { type: "move", key: row.key, row };
  }
  if (k === "up" || k === "arrowup" || k === "k") {
    const prevIdx = idx < 0 ? 0 : Math.max(0, curIdx - 1);
    const row = rows[prevIdx];
    return { type: "move", key: row.key, row };
  }
  if (k === "right" || k === "arrowright" || k === "l") {
    if (!cur) return null;
    const foldKey = cur.foldKey ?? (cur.expandable ? cur.key : null);
    if (cur.expandable && foldKey) {
      const isOpen = openMap && foldKey in openMap
        ? Boolean(openMap[foldKey])
        : cur.isOpen !== undefined
          ? Boolean(cur.isOpen)
          : branchFoldOpen(openMap, foldKey, Boolean(cur.defaultOpen));
      if (!isOpen) {
        return { type: "expand", key: cur.key, foldKey, row: cur };
      }
      const next = rows[curIdx + 1];
      if (next && next.parentKey === cur.key) {
        return { type: "move", key: next.key, row: next };
      }
    }
    return null;
  }
  if (k === "left" || k === "arrowleft" || k === "h") {
    if (!cur) return null;
    const foldKey = cur.foldKey ?? (cur.expandable ? cur.key : null);
    if (cur.expandable && foldKey) {
      const isOpen = openMap && foldKey in openMap
        ? Boolean(openMap[foldKey])
        : cur.isOpen !== undefined
          ? Boolean(cur.isOpen)
          : branchFoldOpen(openMap, foldKey, Boolean(cur.defaultOpen));
      if (isOpen) {
        return { type: "collapse", key: cur.key, foldKey, row: cur };
      }
    }
    if (cur.parentKey) {
      const parent = rows.find((r) => r?.key === cur.parentKey);
      if (parent) return { type: "move", key: parent.key, row: parent };
    }
    return null;
  }
  if (k === "enter" || k === "return") {
    if (!cur) return null;
    return { type: "activate", key: cur.key, entry: cur.entry ?? null, row: cur };
  }
  if (k === "home") return { type: "move", key: rows[0].key, row: rows[0] };
  if (k === "end") return { type: "move", key: rows[rows.length - 1].key, row: rows[rows.length - 1] };
  if ((k === "s" || k === "q") && !shift && idx >= 0) return { type: "action", action: k === "s" ? "send" : "queue", key: cur.key, row: cur };
  if (k === "menu" || k === "contextmenu" || k === "apps" || (k === "f10" && shift)) return idx >= 0 ? { type: "menu", key: cur.key, row: cur } : null;
  return null;
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Pure JS UTF-8 to base64 encoder (safe in Herdr's mod runtime where `Buffer` may be absent). */
export function base64EncodeUtf8(str) {
  const bytes = [];
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) {
    let cp = s.codePointAt(i);
    if (cp > 0xffff) i++;
    if (cp <= 0x7f) {
      bytes.push(cp);
    } else if (cp <= 0x7ff) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp <= 0xffff) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const trip = (b0 << 16) | (b1 << 8) | b2;
    out += B64_ALPHABET[(trip >> 18) & 0x3f];
    out += B64_ALPHABET[(trip >> 12) & 0x3f];
    out += i + 1 < bytes.length ? B64_ALPHABET[(trip >> 6) & 0x3f] : "=";
    out += i + 2 < bytes.length ? B64_ALPHABET[trip & 0x3f] : "=";
  }
  return out;
}

/**
 * Map an OpenRig seat node or status string to Herdr's OSC 7501 `state` (`"working" | "blocked" | "idle" | "done"`), or
 * `"clear"` for a terminal seat: it isn't an agent, so herdr shows no agent status for it.
 */
export function mapSeatStateToOsc7501(nodeOrStatus) {
  if (nodeOrStatus === "terminal" || (nodeOrStatus && typeof nodeOrStatus === "object" && (isTerminalSeat(nodeOrStatus) || nodeOrStatus.terminal === true))) return "clear";
  const status = typeof nodeOrStatus === "string"
    ? nodeOrStatus
    : (nodeOrStatus?.status && typeof nodeOrStatus.status === "string" && !("sessionAlive" in nodeOrStatus) && !("lifecycleState" in nodeOrStatus))
      ? nodeOrStatus.status
      : seatStatus(nodeOrStatus ?? {});
  const s = String(status ?? "").toLowerCase();
  if (s === "active" || s === "working") return "working";
  if (s === "needs_input" || s === "attention_required" || s === "blocked" || s === "failed" || s === "needs you") return "blocked";
  if (s === "done" || s === "completed") return "done";
  return "idle";
}

/**
 * A tmux session name the mod will use anywhere (UI, labels, the relay's argv): OpenRig's own session charset
 * (`[a-zA-Z0-9-_.@]`, its validateSessionName), tightened to no leading `-` or `@`, not empty, at most 200 chars. tmux
 * matches `-t` by prefix and glob; this charset has no `*`, `?`, `:` or whitespace, and the relay targets `=<name>`.
 * The relay (`rig-attach-relay.cjs`) checks the same rule again.
 */
export const SESSION_NAME_RE = /^[A-Za-z0-9._][A-Za-z0-9._@-]{0,199}$/;
export function isValidSessionName(session) {
  return typeof session === "string" && SESSION_NAME_RE.test(session);
}

/** Why a session name is refused, in the person's words. */
export function sessionNameRefusal(session) {
  return `Refused: "${String(session ?? "").slice(0, 80)}" isn't a tmux session name OpenRig makes (letters, digits, . _ - @, not starting with - or @).`;
}

/**
 * The tmux server flags in OpenRig's `tmuxAttachCommand`, parsed into the exact shapes OpenRig writes
 * (`tmux attach -t <session>`, `tmux -L <name> attach -t <session>`, `tmux -S <path> attach -t <session>`), with the
 * session equal to the one already checked. Returns `[]`, `["-L", name]` or `["-S", path]`; null for anything else.
 * Nothing in the string is ever run: only these two checked values reach the relay's argv.
 */
export function tmuxServerArgsFrom(tmuxAttachCommand, session) {
  if (tmuxAttachCommand === undefined || tmuxAttachCommand === null || tmuxAttachCommand === "") return [];
  const m = /^tmux(?: -L ([A-Za-z0-9._][A-Za-z0-9._-]{0,63})| -S (\/[A-Za-z0-9._\/-]{1,255}))? attach(?:-session)? -t (\S+)$/.exec(String(tmuxAttachCommand));
  if (!m || m[3] !== session || !isValidSessionName(session)) return null;
  if (m[1]) return ["-L", m[1]];
  if (m[2]) return m[2].split("/").includes("..") ? null : ["-S", m[2]];
  return [];
}

/** Session -> tmux server flags for the seats the configured daemon lists for a rig (topology rig: flat `seats` or `pods[].seats`), parsed
 *  with `tmuxServerArgsFrom`. A seat with no attach command, or one that is not the plain attach OpenRig writes, is left out (nothing to compare). */
export function rigSeatServers(rig) {
  const seats = Array.isArray(rig?.seats) ? rig.seats : (rig?.pods ?? []).flatMap((pod) => pod?.seats ?? []);
  const out = new Map();
  for (const seat of seats) {
    const session = seat?.session ?? seat?.canonicalSessionName;
    if (!session || !seat?.tmuxAttachCommand) continue;
    const serverArgs = tmuxServerArgsFrom(seat.tmuxAttachCommand, session);
    if (serverArgs) out.set(session, serverArgs);
  }
  return out;
}

/** Why `tmuxServerArgsFrom` refused, in the person's words: a socket path with a character it doesn't pass on (a space or
 *  `@` in a home folder's name) says so; anything else isn't the plain attach OpenRig writes. */
export function serverArgsRefusal(tmuxAttachCommand, session) {
  const sock = /^tmux -S (\/.+) attach(?:-session)? -t (\S+)$/.exec(String(tmuxAttachCommand ?? ""));
  if (sock && sock[2] === session && /[^A-Za-z0-9._\/-]/.test(sock[1]) && !sock[1].split("/").includes("..")) {
    return "Refused: the tmux socket path in OpenRig's attach command for this seat has a space or a character such as @, which the mod doesn't pass on (only letters, digits, ., _, - and /).";
  }
  return "Refused: OpenRig's attach command for this seat isn't the plain tmux attach it writes.";
}

/**
 * What makes two Attach viewers the same viewer: its program and relay payload, minus `initialState` (only the relay's
 * first-paint activity). Local and remote Attach both compare this before reusing a tab: a tab kept
 * open across an update runs the OLD relay (`hc run --bg --no-parent` outlives app and core restarts), and its payload
 * differs from the current release's. Returns null for anything that isn't a relay argv, which never counts as stale.
 * Portable base64/UTF-8 decode: the native mod runtime has neither Node's Buffer nor browser atob.
 */
export function relayIdentity(argv) {
  if (!Array.isArray(argv) || argv.length !== 3 || !argv.every(v => typeof v === "string")
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(argv[2])) return null;
  try {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let value = 0, bits = 0, escaped = "";
    for (const ch of argv[2].replace(/=+$/, "")) {
      value = (value << 6) | alphabet.indexOf(ch); bits += 6;
      if (bits >= 8) { bits -= 8; escaped += "%" + ((value >>> bits) & 255).toString(16).padStart(2, "0"); }
    }
    const payload = JSON.parse(decodeURIComponent(escaped));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return JSON.stringify([argv[0], argv[1], Object.keys(payload).filter(k => k !== "initialState").sort().map(k => [k, payload[k]])]);
  } catch { return null; }
}

/** Where a mod folder's relay file is, for `node <path>`: `<appHome>/mods/<modId>/rig-attach-relay.cjs`. */
export function attachRelayPath(appHomeDir, modId) {
  const home = String(appHomeDir ?? "");
  return home.startsWith("/") ? `${home.replace(/\/+$/, "")}/mods/${modId}/rig-attach-relay.cjs` : null;
}

/**
 * The argv for an Attach terminal: `[node, <relayPath>, <base64 JSON payload>]`, run by herdr with no shell. The relay
 * (`rig-attach-relay.cjs`, shipped in each mod folder) starts `tmux [server flags] attach-session -t =<session>` directly
 * and reports the seat's state as OSC 7501. The payload is data only (no command string): the checked session, the
 * checked server flags, and what to show. Throws, with the reason to show, on a name or flags it won't use.
 */
export function buildAttachRelayArgv(config, seat = {}, relayPath = null) {
  const nodeBin = Array.isArray(config?.rig) && config.rig.length > 0 && /(?:^|\/)node(?:\.exe)?$/i.test(String(config.rig[0]))
    ? config.rig[0]
    : "node";
  const session = String(seat.session ?? seat.canonicalSessionName ?? "");
  if (!isValidSessionName(session)) throw new Error(sessionNameRefusal(session));
  const serverArgs = tmuxServerArgsFrom(seat.tmuxAttachCommand, session);
  if (serverArgs === null) throw new Error(serverArgsRefusal(seat.tmuxAttachCommand, session));
  if (typeof relayPath !== "string" || !relayPath.startsWith("/") || !relayPath.endsWith("/rig-attach-relay.cjs")) {
    throw new Error("Attach can't find the mod's relay file (rig-attach-relay.cjs); reinstall the mod.");
  }
  const logicalId = String(seat.logicalId ?? seat.member ?? (session.includes("@") ? session.split("@")[0].replace(/-/g, ".") : session) ?? "seat");
  const rig = String(seat.rig ?? (session.includes("@") ? session.slice(session.lastIndexOf("@") + 1) : ""));
  const rigId = String(seat.rigId ?? "");
  const runtime = String(seat.runtime ?? "openrig").replace(/[^A-Za-z0-9_.+\-,/=]/g, "").slice(0, 32);
  const title = rig ? `${logicalId}@${rig}` : logicalId;
  const payload = base64EncodeUtf8(JSON.stringify({
    daemonUrl: config?.daemonUrl ?? "",
    // The mod's own config (local): where the relay may look for a private tmux server when OpenRig names none.
    openrigHome: typeof config?.openrigHome === "string" ? config.openrigHome : "",
    session,
    serverArgs,
    logicalId,
    rig,
    rigId,
    app: runtime || "openrig",
    titleB64: base64EncodeUtf8(title),
    initialState: mapSeatStateToOsc7501(seat),
    // v0.4.7: matches the relay's own default (rig-attach-relay.cjs DEFAULT_POLL_INTERVAL_MS); kept explicit here too
    // so a seat override (seat.pollIntervalMs) still takes effect, and so this default moves with that one.
    pollIntervalMs: Number(seat.pollIntervalMs ?? 4000) || 4000,
  }));
  return [nodeBin, relayPath, payload];
}

/** With several OpenRigs a seat NAME is not unique: an attach terminal that names another OpenRig's address is not this seat's, and when
 * the seat name is shared across OpenRigs an unlabeled terminal cannot be tied to this box either. `origin` is undefined with one connection
 * (nothing is filtered) and a value that matches no terminal for a connection that isn't listed. */
const sameOrigin = (terminal, origin, shared = false) => {
  if (origin === undefined || origin === null) return true;
  const label = terminal?.labels?.["herdr-openrig.origin"];
  if (!label) return !shared;
  return rigOrigin(label) !== null && rigOrigin(label) === rigOrigin(origin);
};
export const SEAT_NAME_SHARED = "This seat name exists on more than one OpenRig; open it from its box.";
export const ATTACH_TAB_UNLABELED = "An older Attach tab for this seat does not say which OpenRig it belongs to. Close that tab, then Attach again.";
/** Whether `session` is held by seats of more than one CONNECTION in a merged topology (rigs carry `conn`). */
export function seatNameShared(topology, session) {
  const conns = new Set();
  for (const rig of topology ?? []) for (const pod of rig.pods ?? []) for (const seat of pod.seats ?? []) if (seat.session === session) conns.add(rig.conn ?? null);
  return conns.size > 1;
}
/** Why a terminal for a shared `session` cannot be tied to this box (no origin label): `ATTACH_TAB_UNLABELED` when an unlabeled Attach tab blocks it,
 *  `SEAT_NAME_SHARED` when only a native-placement seat terminal matches, or `null` when nothing ambiguous is open. */
function ambiguousSeatReason(terminals, session, meta = {}) {
  if (!meta?.shared || meta.origin === undefined || meta.origin === null) return null;
  const sess = String(session ?? "").trim(), at = sess.lastIndexOf("@"), logicalId = at > 0 ? sess.slice(0, at).replace(/-/g, ".") : sess, rig = at > 0 ? sess.slice(at + 1) : "";
  let nativeHit = false;
  for (const t of Array.isArray(terminals) ? terminals : []) {
    if (!t?.address || (t.state !== undefined && t.state !== "live" && t.state !== "running")) continue;
    if (t.labels?.["herdr-openrig.role"] === "attach" && t.labels?.["herdr-openrig.attach"] === sess && !t.labels?.["herdr-openrig.origin"]) return ATTACH_TAB_UNLABELED;
    if (t.labels?.["openrig.role"] === "seat"
      && (t.labels?.["openrig.session"] === sess || t.labels?.["openrig.seat"] === sess || (t.labels?.["openrig.seat"] === logicalId && (!rig || !t.labels?.["openrig.rig"] || t.labels?.["openrig.rig"] === rig)))) {
      nativeHit = true;
    }
  }
  return nativeHit ? SEAT_NAME_SHARED : null;
}
export function nativeSeatAmbiguous(terminals, session, meta = {}) {
  return Boolean(ambiguousSeatReason(terminals, session, meta));
}
/** `session => boolean`: whether the name is held by more than one OpenRig. Only with several connections (undefined with one: nothing changes). */
export function seatSharedOf(config, sharedFn) {
  if (!Array.isArray(config?.connections) || config.connections.length < 2) return undefined;
  return (session) => seatNameShared(sharedRigData(config, sharedFn)?.topology, session);
}
/** The origin to match a seat's panes against: the row's own connection, only when there are several. */
export function seatOrigin(config, conn) {
  if (!Array.isArray(config?.connections) || config.connections.length < 2) return undefined;
  const own = configOfConnection(config, conn ?? undefined);
  return own?.daemonUrl ?? "unknown:";
}

/**
 * Find an already-open Attach tab or native `herdr` seat terminal for `seatSession` in the active space (or across spaces).
 * With `index` (seatTerminalIndex of the same panes and terminals) only the terminals carrying this seat's attach label are
 * checked, in list order, with the same checks: the same answer, for a caller that looks up many seats in one draw.
 */
export function findAttachedSeat(terminals = [], spaces = [], seatSession = "", panes = [], seatMeta = {}, index = null) {
  const session = String(seatSession ?? "").trim();
  if (!session) return null;
  const atIdx = session.lastIndexOf("@");
  const logicalId = String(seatMeta?.logicalId ?? (atIdx > 0 ? session.slice(0, atIdx).replace(/-/g, ".") : session));
  const rig = String(seatMeta?.rig ?? (atIdx > 0 ? session.slice(atIdx + 1) : ""));
  const tm = Array.isArray(terminals) ? terminals : [];
  const sp = Array.isArray(spaces) ? spaces : [];
  const pn = Array.isArray(panes) ? panes : [];
  const activeSpace = sp.find((s) => s?.active) ?? sp[0] ?? null;
  const activeTabs = new Set((activeSpace?.tabs ?? []).filter((t) => !t?.settled).map((t) => t?.id).filter(Boolean));
  const origin = seatMeta?.origin, shared = Boolean(seatMeta?.shared);
  const candidates = (index ? (index.byLabel.get(`attach:${session}`) ?? []).map((e) => e.t) : tm).filter((t) => {
    if (!t?.address || (t.state !== undefined && t.state !== "live" && t.state !== "running")) return false;
    if (!sameOrigin(t, origin, shared)) return false;
    const isAttach = t.labels?.["herdr-openrig.role"] === "attach" && t.labels?.["herdr-openrig.attach"] === session;
    // Only OUR herdr-openrig.* labels count (rule Y, every caller: Attach reuse focuses the hit, needs-view's silent flag is set by it). A terminal labelled only in OpenRig's native namespace (openrig.role=seat,
    // openrig.seat, ...) carries nothing that names this daemon, and a same-named rig on another OpenRig has the same seat names, so it is never "this seat's terminal". Native seats are not released (v0.5.0: by openrig.node).
    return isAttach;
  });
  if (!candidates.length) return null;
  const resolveTab = (t) => {
    const paneHit = index ? index.paneByTerminal.get(t.address) : pn.find((p) => p?.terminal === t.address);
    return paneHit?.tab ?? t.labels?.["herdr.tab"] ?? null;
  };
  const inActiveSpace = candidates.find((t) => {
    const tab = resolveTab(t);
    return (activeSpace && t.labels?.["herdr.space"] === activeSpace.id) || (tab && activeTabs.has(tab));
  });
  const hit = inActiveSpace ?? candidates[0];
  return {
    terminal: hit.address,
    tab: resolveTab(hit),
    role: hit.labels?.["herdr-openrig.role"] ?? hit.labels?.["openrig.role"] ?? "attach",
  };
}

/** True when two /healthz answers both report a process id and the ids differ: two daemons, whatever host id they share. */
export const differentDaemons = (a, b) => Number.isInteger(a?.pid) && Number.isInteger(b?.pid) && a.pid !== b.pid;

/** True when two /healthz answers that must come from ONE daemon on one machine do. The host id alone isn't enough: an id seeded from the
 *  operator's host.name ("named") can be shared by two OpenRigs on that machine, so the process id must match too. Without both pids (an older
 *  daemon), only ids that both report as "generated" are trusted. */
export function sameDaemon(a, b) {
  if (!a?.selfHostId || a.selfHostId !== b?.selfHostId) return false;
  if (Number.isInteger(a.pid) && Number.isInteger(b.pid)) return !differentDaemons(a, b);
  return a.selfHostIdSource === "generated" && b.selfHostIdSource === "generated";
}

/**
 * Pure polling waits use a task context and must settle even if an unrelated
 * view drains the preceding promise and then closes.
 */
export function waitWith(cx) {
  return (ms) => typeof cx?.timer?.after === "function"
    ? new Promise(resolve => cx.timer.after(ms, resolve, { owner: null }))
    : cx?.sleep?.(ms) ?? Promise.resolve();
}

/**
 * Attach to a seat in a native Herdr tab:
 * - If the seat is already attached (`herdr-openrig.role=attach`, `herdr-openrig.attach=<session>`) or is a native `placement: herdr`
 *   seat (`openrig.role=seat`, `openrig.seat=<session>`), selects its tab and focuses its pane without spawning a duplicate.
 * - For `operator.agent` on a non-loopback `daemonUrl`, returns `{ ok: false, disabled: true, reason: REMOTE_OPERATOR_REASON }`.
 * - If the seat is stopped, returns `{ ok: false, disabled: true, reason: "Stopped: seat has no running session to attach" }`.
 * - For a running `tmux` seat, spawns a dedicated Herdr tab named `<logicalId>` (or `"Operator"` for `operator.agent` / `options.name`)
 *   via `hc run` with labels `herdr-openrig.role=attach`, `herdr-openrig.attach=<session>`, `herdr-openrig.rig=<rig>`,
 *   `herdr-openrig.seat=<session>`, running `buildAttachRelayArgv(config, seat)`.
 */
// Serialize complete opens, including terminal adoption. A later caller must see the first caller's viewer;
// each still performs its own validation and consent checks, rather than inheriting another request's result.
const seatAttachQueue = new Map();
export async function attachToSeat(first = {}, second = {}, config = null, options = {}) {
  const isFirstHost = Boolean(typeof first?.run === "function" || typeof first?.hc === "function" || typeof first?.spaces === "function" || Array.isArray(first?.spaces));
  const host = isFirstHost ? first : second;
  const seat = { ...(isFirstHost ? second : first) };
  const refused = assistantActionRefusal(seat, 'attach');
  if (refused) return { ok: false, reason: refused };
  if (crossesConnections(config, seat)) return { ok: false, reason: OTHER_CONNECTION_REFUSAL };
  const notReady = routingNotReady(host, config);
  if (notReady) return { ok: false, reason: notReady };
  if (!host.routeOwner && !host.prepareRemote && typeof host.layout === "function" && layoutShowsMod(host.layout(), MOD_IDS.sidebar)) {
    const session = seat.session ?? seat.canonicalSessionName;
    if (!isValidSessionName(session)) return { ok: false, reason: sessionNameRefusal(session) };
    return routeRigOpen(host, config, { kind: "attach", seat, options });
  }
  config = config ? { ...config, ...(Array.isArray(config.rig) ? { rig: [...config.rig] } : {}) } : config;
  options = { ...options };
  const key = JSON.stringify([config?.daemonMachine ?? "", rigOrigin(config?.daemonUrl??options?.daemonUrl)??config?.daemonUrl??options?.daemonUrl??"", config?.openrigHome ?? "", seat?.session ?? seat?.canonicalSessionName ?? ""]);
  const job = (seatAttachQueue.get(key) ?? Promise.resolve()).catch(() => {}).then(() => attachSeatOnce(host, seat, config, options));
  seatAttachQueue.set(key, job);
  return job.finally(() => { if (seatAttachQueue.get(key) === job) seatAttachQueue.delete(key); });
}

async function attachSeatOnce(host, seat, config, options) {
  if (config?.daemonMachine !== undefined && config.daemonMachine !== "") return attachRemoteSeat(host, seat, config, options);
  // Pass the host identity like the grid does (rig-spaces.js's own daemonHostId): without it, a space vouched for
  // only by its host stamp (a foreign-origin space on the SAME local machine, from a second OpenRig daemon) can
  // never be told apart from one that is genuinely ours at a new address, so local Attach was stuck always asking
  // instead of safely building its own space beside a confirmed-foreign one.
  const hostId = typeof host?.selfHostId === "function" ? host.selfHostId() : host?.selfHostId;
  const session = String(seat?.session ?? seat?.canonicalSessionName ?? "").trim();
  const logicalId = String(seat?.logicalId ?? seat?.name ?? (session.includes("@") ? session.split("@")[0].replace(/-/g, ".") : session) ?? "seat");
  const rigName = String(seat?.rig ?? (session.includes("@") ? session.slice(session.lastIndexOf("@") + 1) : ""));
  // The session is checked before any use: labels, the relay's argv, the tab.
  if (!isValidSessionName(session)) return { ok: false, disabled: true, reason: sessionNameRefusal(session) };
  const isOperator = logicalId === "operator.agent" || session === "operator-agent@kernel" || options?.operator === true;
  const tabDisplayName = String(options?.name ?? seat?.tabName ?? (isOperator ? "Operator" : logicalId));
  let effectiveDaemonUrl = config?.daemonUrl ?? options?.daemonUrl ?? null;
  if (isOperator && effectiveDaemonUrl && !isLoopbackDaemonUrl(effectiveDaemonUrl)) {
    return { ok: false, disabled: true, reason: REMOTE_OPERATOR_REASON };
  }
  const live = (key) => (typeof host[key] === "function" ? host[key]() : host[key] ?? []).filter((item) =>
    key === "spaces" ? !item.machine && !String(item.id ?? "").includes("/")
      : key === "terminals" ? !String(item.address ?? "").includes("/")
        && (!item.labels?.["herdr-openrig.origin"] || rigOrigin(effectiveDaemonUrl)!==null&&rigOrigin(item.labels["herdr-openrig.origin"])===rigOrigin(effectiveDaemonUrl))
      : !String(item.terminal ?? "").includes("/"));
  let sp = live("spaces"), pn = live("panes"), tm = live("terminals");
  // The viewer this Attach would run right now: `attachSeatOnce`'s discovery can happen BEFORE this point
  // (the early reuse checks above run on the terminals known when the call started), so a tab kept open across an update
  // runs the old relay. Its identity is compared like remote Attach compares it; a difference is never a silent reuse.
  const currentViewerArgv = (() => {
    try {
      if (!effectiveDaemonUrl) return null;
      return buildAttachRelayArgv({ ...config, daemonUrl: localDaemonOrigin(effectiveDaemonUrl) }, { ...seat, session, logicalId, rig: rigName }, host.relayPath ?? options?.relayPath ?? null);
    } catch (_) { return null; }
  })();
  /** A same-session Attach viewer whose relay differs from `expectedArgv`: the old viewer of a pre-update tab (or of
   *  another mod folder's relay). Native seat terminals are not viewers and never count. */
  const staleViewerOf = (found, expectedArgv) => {
    if (!found || found.role !== "attach" || !expectedArgv) return null;
    const record = tm.find((t) => t.address === found.terminal);
    const known = relayIdentity(record?.argv);
    if (known === null || known === relayIdentity(expectedArgv)) return null;
    // The mod entry points ship identical relay copies.
    // Compare the full payload when Attach came through another copy in that same app home.
    const copies = Object.values(MOD_IDS).map((id) => `/mods/${id}/rig-attach-relay.cjs`);
    const expectedPath = expectedArgv[1];
    const suffix = copies.find((copy) => expectedPath.endsWith(copy));
    const sameInstall = suffix && copies.some((copy) => record.argv[1] === expectedPath.slice(0, -suffix.length) + copy);
    return sameInstall && known === relayIdentity([expectedArgv[0], record.argv[1], expectedArgv[2]]) ? null : found;
  };
  /** The person's replace: stop that viewer and close its tab — only on their click — then Attach
   *  starts a fresh one below. Never closes a tab the person didn't ask to close: this runs solely from the offer's button. */
  const replaceStaleViewer = async (stale) => {
    // A refused or failed kill stops nothing further: closing the tab would leave the person with no viewer at all and
    // the fresh start would run beside a viewer still holding the seat.
    if (stale?.terminal) {
      const killed = await Promise.resolve(host.hc(["kill", "--", stale.terminal]));
      if (killed && killed.code !== undefined && killed.code !== 0) return { ok: false, reason: `The older viewer could not be stopped, so nothing was changed.` };
    }
    // A kill of the relay often closes the seat's tab with it. Closing a tab that is already gone errors in herdr's own
    // toast ("tab.close failed · no tab …") after a replace that actually succeeded, so look first: the tab is closed
    // only while it is still there. (A close that fails for any other reason is still reported: the check is the tab's
    // existence, not a swallowed error.)
    const spacesNow = (typeof host.spaces === "function" ? host.spaces() : sp) ?? [];
    if (stale?.tab && spacesNow.some((s) => (s.tabs ?? []).some((t) => t.id === stale.tab))) host.run?.("tab.close", { id: stale.tab, confirmed: true });
    return { ok: true, replaced: true };
  };
  const staleViewerOffer = (stale) => ({ ok: false, needsViewerRefresh: true,
    reason: `The Attach tab for ${logicalId} is running an older viewer, from before an update. Attach offers to replace it.`,
    staleViewer: { terminal: stale.terminal, tab: stale.tab } });
  /** The person-approved replacement, stopped just before the fresh relay starts: never before, so a late failure leaves
   *  the old viewer running and never without a fresh start, so nothing is closed unasked. */
  let pendingReplace = null;
  // Set once the person's click has actually stopped the old viewer and closed its tab: the failure messages below must
  // say so, because the generic line reads as if nothing happened. The single source of truth is
  // replaceStaleViewer's own return (no second state variable to drift).
  let replaced = null;
  // ONE operation for the whole flow: the discovery (its own exec is judged after the send), the space marking (markRigSpace awaits) and the relay start all belong to the settings this
  // Attach began under. The last look is right before the relay starts, so a change anywhere in between refuses instead of starting it with the old home and address; with no change it is silent.
  const op = gatedOperationOrRefusal(config?.connectionId);
  const stale = () => { if (op.since < 0) return null; /* no operation (config not loaded, or no connection named): the gate refuses every gated send itself */ try { op.check(); return null; } catch (error) { return { ok: false, disabled: true, reason: String(error?.message ?? error) }; } };

  const adoptionNames=[rigName,seat.rigId],adoptionRig=topologyRig(host,adoptionNames,config);
  const adoption=await prepareRigSpaceAdoption(host,config,adoptionNames,{sessions:rigSessions(adoptionRig),servers:rigSeatServers(adoptionRig)});
  if(!adoption.ok)return adoption;
  if(adoption.host){host=adoption.host;sp=live("spaces");pn=live("panes");tm=live("terminals");}

  const reuse = async (existing) => {
    const destination=resolveRigSpace(host,{...config,daemonUrl:effectiveDaemonUrl},[rigName,seat.rigId],{strictOrigin:true,hostId});
    if(!adoption.space&&destination?.tabs?.some(tab=>tab.id===existing.tab)){
      try{await markRigSpace(host,{...config,daemonUrl:effectiveDaemonUrl},[rigName,seat.rigId],destination,{hostId});}
      catch(error){return{ok:false,reason:String(error?.message??error)};}
    }
    if (existing.tab) host.run?.("tab.select", { id: existing.tab });
    host.run?.("pane.focus", { terminal: existing.terminal });
    return { ok: true, reused: true, ...existing };
  };
  const meta = { logicalId, rig: rigName, ...(typeof host.seatShared === "function" ? { origin: effectiveDaemonUrl ?? "unknown:", shared: host.seatShared(session) === true } : {}) };
  const initialAmbiguous = ambiguousSeatReason(tm, session, meta);
  if (initialAmbiguous) return { ok: false, reason: initialAmbiguous }; // an unlabeled terminal can't be tied to its box when the name is shared: open nothing
  const existing = findAttachedSeat(tm, sp, session, pn, meta);
  if (existing) {
    const staleViewer = staleViewerOf(existing, currentViewerArgv);
    if (staleViewer) {
      if (!options.replaceViewer) return staleViewerOffer(staleViewer);
      pendingReplace = staleViewer; // the person approved it: it is stopped just before the fresh start below
    } else return reuse(existing);
  }

  const isRunning = Boolean(
    seat?.sessionAlive ||
    seat?.attachable ||
    ((seat?.terminal === true || isTerminalSeat(seat)) && ["running", "ready"].includes(seat?.sessionStatus)) ||
    seat?.status === "active" ||
    seat?.status === "working" ||
    seat?.status === "running" ||
    seat?.status === "ready" ||
    seat?.status === "idle" ||
    seat?.status === "needs_input" ||
    seat?.status === "attention_required" ||
    seat?.status === "blocked" ||
    seat?.status === "starting" ||
    seat?.status === "unknown"
  );
  if (!isRunning || (!seat?.tmuxAttachCommand && seat?.placement !== "herdr" && !session)) {
    return { ok: false, disabled: true, reason: "Stopped: seat has no running session to attach" };
  }

  let argv;
  try {
    if (!effectiveDaemonUrl) {
      if (typeof host.exec !== "function") return { ok: false, disabled: true, reason: "Attach cannot determine the local daemon URL: configure daemonUrl or provide CLI discovery." };
      const found = await discoverDaemonFromCli(config, host.exec, { timeoutKind: "local-attach" });
      if (!found.daemonUrl) return { ok: false, disabled: true, reason: found.message };
      effectiveDaemonUrl = found.daemonUrl;
    }
    effectiveDaemonUrl = localDaemonOrigin(effectiveDaemonUrl);
    if (!effectiveDaemonUrl) {
      return { ok: false, disabled: true, reason: "Attach needs a local HTTP(S) daemon origin on this machine, without a path, query or fragment." };
    }
    argv = buildAttachRelayArgv({ ...config, daemonUrl: effectiveDaemonUrl }, { ...seat, session, logicalId, rig: rigName }, host.relayPath ?? options?.relayPath ?? null);
  } catch (e) {
    return { ok: false, disabled: true, reason: plainExecError(e, { kind: "local-attach" }) };
  }
  const liveMeta = typeof host.seatShared === "function" ? { ...meta, origin: effectiveDaemonUrl, shared: host.seatShared(session) === true } : meta;
  const liveAmbiguous = ambiguousSeatReason(live("terminals"), session, liveMeta);
  if (liveAmbiguous) return { ok: false, reason: liveAmbiguous };
  const appeared = findAttachedSeat(live("terminals"), live("spaces"), session, live("panes"), liveMeta);
  if (appeared) {
    const staleViewer = staleViewerOf(appeared, argv);
    if (staleViewer) {
      if (!options.replaceViewer) return staleViewerOffer(staleViewer);
      pendingReplace = staleViewer; // the person approved it: it is stopped just before the fresh start below
    } else return reuse(appeared);
  }
  if (typeof host.hc !== "function") return { ok: false, reason: "Attach needs Herdr's labelled terminal start. Open the Rig sidebar and try again; no terminal was started." };
  const rigSpace = adoption.space??resolveRigSpace(host,{...config,daemonUrl:effectiveDaemonUrl},[rigName,seat.rigId],{strictOrigin:true,hostId});
  if(rigSpace&&!adoption.space){
    try{await markRigSpace(host,{...config,daemonUrl:effectiveDaemonUrl},[rigName,seat.rigId],rigSpace,{hostId});}
    catch(error){return{ok:false,reason:String(error?.message??error)};}
  }
  if(!rigSpace){
    // Several page-only spaces of this rig: Attach asks instead of building a second one (or guessing which).
    const other=unconfirmedRigSpace(host,{...config,daemonUrl:effectiveDaemonUrl},[rigName,seat.rigId],{strictOrigin:true,hostId});
    if(other)return{ok:false,unconfirmedSpace:true,reason:unconfirmedSpaceReason(rigName,null,other.origin??null,effectiveDaemonUrl,other)};
  }
  const newRigSpace = !rigSpace;
  // Local mode never derives a machine or destination from focus, including Operator.
  const activeSpace = rigSpace ?? { id: `sp-openrig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` };
  if (activeSpace && !activeSpace.machine && typeof host.hc === "function") {
    const slug = (isOperator ? "operator" : logicalId).replace(/[^a-zA-Z0-9_-]/g, "-");
    const tab = `tb-rig-attach-${slug}-${Date.now().toString(36)}`;
    const hcArgs = [
      "run", "--bg", "--json", "--no-parent",
      ...(seat?.cwd ? ["--cwd", seat.cwd] : activeSpace.folder ? ["--cwd", activeSpace.folder] : []),
      "--label", `herdr.space=${activeSpace.id}`,
      "--label", `herdr.tab=${tab}`,
      "--label", "herdr-openrig.role=attach",
      "--label", "herdr-openrig.space=1", "--label", `herdr-openrig.origin=${effectiveDaemonUrl}`,
      "--label", `herdr-openrig.attach=${session}`,
      ...(rigName ? ["--label", `herdr-openrig.rig=${rigName}`] : []),
      ...(session ? ["--label", `herdr-openrig.seat=${session}`] : []),
      "--",
      ...argv,
    ];
    const changedBeforeStart = stale(); if (changedBeforeStart) return changedBeforeStart; // the last look before the relay starts
    if (pendingReplace) { const done = await replaceStaleViewer(pendingReplace); if (!done?.ok) return { ok: false, reason: "The old Attach viewer could not be stopped, so nothing was changed." }; replaced = done; }
    // Once the person's click has stopped the old viewer and closed its tab, a failure in the fresh
    // start must say so — the generic line reads as if nothing happened. Only when `replaced` is set (carry
    // replaceStaleViewer's own return; no second source of truth).
    const afterReplace = (reason) => replaced ? `The older viewer was stopped and its tab closed for this Attach, and the new one could not be confirmed. ${reason} Open Attach again.` : reason;
    let started = null;
    try { started = await Promise.resolve(host.hc(hcArgs)); }
    catch (error) {
      if (error?.code === "GATE_REFUSED") {
        // The gate's sentence, not a generic failure. A refusal raised AFTER the relay start was dispatched (its answer came under settings that are gone) does not mean nothing started.
        return { ok: false, reason: error.dispatched === true ? `${String(error.message).trimEnd()} A viewer may already have started: check Herdr's tabs before opening it again.` : afterReplace(error.message), ...(error.dispatched === true ? { unconfirmed: true } : {}) };
      }
      started = null;
    }
    let address = null;
    try { address = JSON.parse(started?.stdout ?? "null")?.address ?? null; } catch (_) { address = null; }
    if (address && !String(address).includes("/") && (started?.code === undefined || started.code === 0)) {
      for (let i = 0; i < 30 && host.wait && !((typeof host.spaces === "function" ? host.spaces() : sp) ?? []).some((s) => (s.tabs ?? []).some((t) => t.id === tab)); i++) {
        await host.wait(100);
      }
      host.run?.("tab.rename", { id: tab, name: tabDisplayName });
      if (newRigSpace) {
        let name = rigName || "OpenRig", suffix = 2;
        const currentSpaces = typeof host.spaces === "function" ? host.spaces() : sp;
        while (currentSpaces.some((s) => s.id !== activeSpace.id && s.name === name)) name = `${rigName} ${suffix++}`;
        host.run?.("space.rename", { id: activeSpace.id, name });
      }
      if (rigSpace || newRigSpace) host.run?.("space.select", { id: activeSpace.id });
      host.run?.("tab.select", { id: tab });
      host.run?.("pane.focus", { terminal: address });
      return { ok: true, reused: false, terminal: address, tab };
    }
  }
  return { ok: false, reason: replaced ? `The older viewer was stopped and its tab closed for this Attach, and the new one could not be confirmed. Herdr could not confirm a labelled local Attach terminal. Open Attach again.` : "Herdr could not confirm a labelled local Attach terminal. No fallback tab was opened; check the local core and try again." };
}

/**
 * Per-rig `Views` branch under each rig in the sidebar:
 * Returns `{ items, openCount, savedCount }` where `items` contains:
 * 1. Open/following worker views for `rig` (`kind: "open-view"`, `id`, `name`, `following`, `cellCount`, `rig`),
 * 2. Saved views for `rig` from `/api/terminal/views` not currently open (`kind: "saved-view"`, `id`, `name`, `rig`, `grid`),
 * 3. Always ends with `{ kind: "new-view", id: "+new-view:<rigName>", name: "+ New worker view…", rig: rig.name, rigId: rig.id }`.
 */
export function rigViewsBranch(rig, stripProps = null, terminalViewsData = null) {
  const rigName = String(rig?.name ?? rig?.id ?? "");
  const rigId = String(rig?.id ?? rigName);
  const sessions = Array.isArray(rig?.seats)
    ? rig.seats.map((s) => s.session).filter(Boolean)
    : (rig?.pods ?? []).flatMap((p) => (p.seats ?? []).map((s) => s.session)).filter(Boolean);
  const sessionSet = new Set(sessions);
  const openViews = viewsForRig(stripProps, sessions, rigName).map((v) => ({
    kind: "open-view",
    id: v.id,
    name: v.name ?? v.title ?? v.id,
    rig: rigName,
    rigId,
    ...(rig?.conn ? { conn: rig.conn } : {}),
    open: true,
    following: Boolean(v.following),
    cellCount: Array.isArray(v.cells) ? v.cells.filter((c) => c?.seat || c?.kind === "shell").length : 0,
    view: v,
  }));
  const openIds = new Set(openViews.map((v) => v.id));
  const openNames = new Set(openViews.map((v) => v.name));
  // GET /api/terminal/views answers { following, saved, rigs }; `views` and a bare list are older shapes.
  const rawSaved = Array.isArray(terminalViewsData?.saved)
    ? terminalViewsData.saved
    : Array.isArray(terminalViewsData?.views)
      ? terminalViewsData.views
      : (Array.isArray(terminalViewsData) ? terminalViewsData : []);
  const savedViews = rawSaved
    .filter((sv) => {
      if (!sv || typeof sv !== "object") return false;
      const svId = String(sv.id ?? sv.name ?? "");
      const svName = String(sv.name ?? sv.title ?? svId);
      if (openIds.has(svId) || openIds.has(`rv-${svId}`) || openNames.has(svName)) return false;
      if (sv.rig === rigName || sv.rig === rigId) return true;
      if (svId === rigName || svId === `saved:${rigName}` || svName === rigName) return true;
      const memberSeats = [
        ...(Array.isArray(sv.seats) ? sv.seats : []),
        ...(Array.isArray(sv.members) ? sv.members.map((m) => (typeof m === "string" ? m : m?.seat)) : []),
      ].filter(Boolean);
      return memberSeats.some((s) => sessionSet.has(s) || String(s).endsWith(`@${rigName}`));
    })
    .map((sv) => {
      const svId = String(sv.id ?? sv.name ?? "");
      return {
        kind: "saved-view",
        id: svId.startsWith("saved:") ? svId : `saved:${svId}`,
        rawId: svId,
        name: String(sv.name ?? sv.title ?? svId),
        rig: rigName,
        rigId,
        open: false,
        saved: true,
        grid: sv.grid ?? null,
        view: sv,
      };
    });
  const newViewAction = {
    kind: "new-view",
    id: `+new-view:${rigName}`,
    name: "+ New worker view…",
    rig: rigName,
    rigId,
  };
  return {
    openCount: openViews.length,
    savedCount: savedViews.length,
    items: [...openViews, ...savedViews, newViewAction],
  };
}
/** Health stays in System, except a joined active critical finding that is not context pressure.
 * /api/attention has no detector/status on 0.7.11: never infer either from its human summary.
 * A supplied records array is authoritative; null rechecks the joined record retained by normalization.
 */
export const isHealthAttention = item => String(item?.id ?? "").startsWith("health:") || /^\/api\/health\//.test(String(item?.source ?? ""));
export function filterAttentionHealth(items = [], records = null) {
  const byId = new Map((Array.isArray(records) ? records : []).map(r => [r.id, r]));
  return (Array.isArray(items) ? items : []).flatMap(item => {
    if (!isHealthAttention(item)) return [item];
    const source = String(item.source ?? "");
    let id = String(item.id ?? "").startsWith("health:") ? String(item.id).slice(7) : null;
    if (/^\/api\/health\/[^/?#]+$/.test(source)) {
      try { const fromSource = decodeURIComponent(source.slice(12)); if (id && id !== fromSource) return []; id ??= fromSource; } catch { return []; }
    }
    const record = records === null && item.criticalHealth === true ? item.healthFinding : byId.get(id);
    if (!record || record.id !== id || record.severity !== "critical" || !classifyHealth(record).actionable || !record.detector) return [];
    return [{ ...item, kind: "action", update: false, tier: "alert", urgency: "critical", criticalHealth: true,
      healthFinding: record, summary: record.summary ?? item.summary }];
  });
}

/** Specs retain every daemon kind; filtering never changes the remembered disclosure state. */
export function groupSpecLibrary(specs, filter = "") {
  const query = String(filter).trim().toLowerCase(), byKind = new Map();
  for (const spec of specs ?? []) {
    const kind = String(spec.kind ?? "unknown");
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(spec);
  }
  const preferred = ["rig", "agent", "workflow"];
  const builtin = s => s.sourceType === "builtin" || !s.sourcePath;
  return [...byKind].sort(([a], [b]) => {
    const ai = preferred.indexOf(a), bi = preferred.indexOf(b);
    return (ai < 0 ? 3 : ai) - (bi < 0 ? 3 : bi) || a.localeCompare(b);
  }).map(([kind, all]) => {
    const items = all.filter(s => !query || [s.name, s.kind, s.version].some(v => String(v ?? "").toLowerCase().includes(query)))
      .sort((a, b) => Number(builtin(a)) - Number(builtin(b)) || String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
    return { kind, title: ({ rig: "Rigs", agent: "Agents", workflow: "Workflows" })[kind] ?? kind,
      total: all.length, items, yours: items.filter(s => !builtin(s)).length };
  }).filter(g => g.items.length);
}

/** Ignore only known state-only folder batches. Roots, mixed and unknown batches
 * remain conservative so config/approval changes and watch overflow still reload. */
export function configWatchChanged(paths, appDir) {
  if (!Array.isArray(paths) || !paths.length) return true;
  const state = `${String(appDir).replace(/\/+$/, "")}/openrig/state.json`;
  return !paths.every(path => typeof path === "string" && path === state);
}

/** A read-modify-write of one state file with compare-and-write: a write that lost a race (the file changed since it was read) is tried again from a
 *  fresh read, up to `tries` times. `build(previousText)` makes the new text from what was just read, so every attempt merges the latest. Returns null
 *  when it was saved or already byte-identical after a successful read, else the last error. */
export async function saveStateFile({ path, read, write, build, tries = 3 }) {
  let last = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    let previous = null, readError = null;
    try { previous = (await read(path)) ?? null; } catch (error) { previous = null; readError = error; }
    try {
      const next = build(previous);
      if (!readError && next === previous) return null;
      await write(path, next, previous); return null;
    }
    // A read that failed leaves the write expecting a file that isn't there, which reads as a lost race: when the last attempt's READ failed, that is the cause.
    catch (error) { last = readError ? { message: String(readError?.message ?? readError), during: "read" } : error; }
  }
  return last;
}
/** What a person is told when a state file can't be saved: what was not saved and a fixed phrase for the cause (`stateSaveReason`), never the error's own
 *  message (that can carry the file's private path). */
export const stateSaveFailure = (what, error) => `Couldn't save ${what} (${stateSaveReason(error)}). Check that herdrig can write to its app folder.`;
/** The cause of a failed state-file write, as a FIXED phrase (the message is never printed: it can carry the file's private path). Herdr's file write
 *  throws a plain Error with only a message, no code, so the cause is read from the sentences it actually sends: its own compare-and-write and size
 *  sentences, and Rust's io::Error text for the rest. Anything else is "could not be written", never a guess at a race. */
export function stateSaveReason(error) {
  const message = String(error?.message ?? error ?? "");
  if (/exceeds 1 MiB/i.test(message)) return "it is too large";
  if (error?.during === "read") return "it could not be read";
  if (/changed (?:outside Herdr|while saving)/i.test(message)) return "the file kept changing";
  if (/os error 28\)|no space left/i.test(message)) return "the disk is full";
  if (/os error 30\)|read-only file system/i.test(message)) return "the folder is read-only";
  if (/os error (?:1|13)\)|permission denied|operation not permitted/i.test(message)) return "it is not writable";
  return "it could not be written";
}

/** A request to OpenRig that was refused or failed with only a status: said in words (what could not be done and the error number), never the method and path. */
export const requestFailed = (what, status) => failedWords(what, status);
/** The words for a daemon path, for requestFailed. */
export function requestWhat(path) {
  return requestWords(path);
}
/** A rig command that stopped with no message. A read-only probe has nothing to warn about. */
export const rigStoppedBare = (code) => `OpenRig's command stopped without saying why (exit ${code}).`;
/** A rig command that changes things and stopped with no message: part of the work may have been done. */
/** `rig up --json`'s own account of a launch, read over the exit code (OpenRig 0.7.22 exits 1 for a partial launch, 0.7.20 exited 0;
 *  both exit 2 for a failed one). "partial": the rig exists with some seats; say which started and which didn't, with OpenRig's reason.
 *  "failed": OpenRig's reasons from `errors`. Both carry `launchStatus`: OpenRig's own words, which no wording guess may replace.
 *  Anything else is the write's own outcome, unchanged. */
export function launchOutcome(r) {
  const json = r?.json && typeof r.json === "object" ? r.json : null, status = String(json?.status ?? "");
  if (status !== "partial" && status !== "failed") return r;
  const firstSentence = (value) => { const s = singleLineText(value).trim(); const m = /^(.*?[.;!?])(?:\s|$)/u.exec(s); return (m ? m[1] : s).replace(/[.;]+$/u, "."); };
  const reasons = (Array.isArray(json.errors) ? json.errors : []).filter((e) => typeof e === "string" && e.trim()).map(firstSentence);
  if (status === "failed") return { ...r, ok: false, launchStatus: status, text: reasons.length ? reasons.join(" ") : r.text };
  const nodes = (Array.isArray(json.stages) ? json.stages : []).flatMap((stage) => (Array.isArray(stage?.detail?.nodes) ? stage.detail.nodes : []));
  const started = nodes.filter((n) => n?.status === "launched").map((n) => n.logicalId).filter(Boolean);
  const stopped = nodes.filter((n) => n?.status && n.status !== "launched");
  const parts = [started.length ? `Started: ${started.join(", ")}.` : "",
    ...stopped.map((n) => `${n.logicalId ?? "A seat"} didn't start: ${firstSentence(String(n.error ?? "").trim() || n.status)}`),
    ...(stopped.length ? [] : reasons)].filter(Boolean);
  return { ...r, ok: false, partial: true, launchStatus: status, text: `Only part of the rig started. ${parts.join(" ")}`.trim() };
}
export const rigStoppedMaybeDone = (code) => `OpenRig's command stopped without saying why (exit ${code}). Check before trying again: it may have done part of the work.`;
