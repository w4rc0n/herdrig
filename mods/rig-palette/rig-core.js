// Pure config, loopback, layout, and navigation-history helpers shared by rig-lib and lightweight mods.
import { LEGACY_CONNECTION_ID, connectionsOf, localDaemonOrigin } from "./rig-connections.js";
import { followedConnection, spaceMachine } from "./rig-follow.js";
import { publishedConfigFor, publishedUnder } from "./rig-gate.js";

/**
 * Parse `<appHome>/openrig/config.json`. Returns defaults with `missing: true` when absent or unreadable.
 * Only `person` (`<name>@external`), `daemonUrl` (`http(s)://…` or `herdr://…`), `rig` (`string[]`),
 * `openrigHome` (absolute path), and `connections` are accepted.
 */
export function parseConfig(text) {
  let raw = null;
  try { raw = JSON.parse(text ?? "null"); } catch { raw = null; }
  if (!raw || typeof raw !== "object") { const { connections } = connectionsOf(null); return { person: null, daemonUrl: null, rig: ["rig"], openrigHome: null, missing: true, connectionId: connections[0].id, connections }; }
  const person = typeof raw.person === "string" && /^[^@\s]+@external$/.test(raw.person) ? raw.person : null;
  const daemonUrl = typeof raw.daemonUrl === "string" && /^https?:\/\/[^\s]+$/.test(raw.daemonUrl) ? raw.daemonUrl.replace(/\/+$/, "")
    : typeof raw.daemonUrl === "string" && /^herdr:\/\/[a-z0-9][a-z0-9._-]{0,31}\/[A-Za-z0-9._:-]{1,128}$/.test(raw.daemonUrl) ? raw.daemonUrl : null;
  const daemonUrlSource = typeof raw.daemonUrlSource === "string" && raw.daemonUrlSource ? raw.daemonUrlSource : undefined;
  const daemonState = typeof raw.daemonState === "string" && raw.daemonState ? raw.daemonState : undefined;
  const daemonMessage = typeof raw.daemonMessage === "string" && raw.daemonMessage ? raw.daemonMessage : undefined;
  const rig = Array.isArray(raw.rig) && raw.rig.length && raw.rig.every((x) => typeof x === "string" && x.length) ? raw.rig : ["rig"];
  const openrigHome = typeof raw.openrigHome === "string" && raw.openrigHome.startsWith("/") ? raw.openrigHome : null;
  const capabilities = raw.capabilities && typeof raw.capabilities === "object" && !Array.isArray(raw.capabilities) ? raw.capabilities : undefined;
  const { connections, legacy, notes, invalid } = connectionsOf(raw);
  if (invalid) return { person, daemonUrl: null, rig, openrigHome: null, missing: false, connectionId: LEGACY_CONNECTION_ID, connections: [], configInvalid: invalid, connectionNotes: notes, ...(raw.reducedMotion === true ? { reducedMotion: true } : {}) };
  const first = connections[0];
  return {
    person, daemonUrl: legacy ? daemonUrl : first.daemonUrl, rig, openrigHome: legacy ? openrigHome : first.openrigHome, missing: false,
    connectionId: first.id, connections, connectionsList: !legacy, ...(notes.length ? { connectionNotes: notes } : {}), ...(!legacy && first.expectedHostId ? { expectedHostId: first.expectedHostId } : {}),
    ...(legacy ? (raw.daemonMachine !== undefined && raw.daemonMachine !== "" ? { daemonMachine: raw.daemonMachine } : {}) : (first.machine ? { daemonMachine: first.machine } : {})),
    ...(daemonUrlSource ? { daemonUrlSource } : {}),
    ...(daemonState ? { daemonState } : {}),
    ...(daemonMessage ? { daemonMessage } : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(raw.reducedMotion === true ? { reducedMotion: true } : {}),
  };
}

/** True when `daemonUrl` is a local HTTP(S) origin (or absent, pending discovery). */
export function isLoopbackDaemonUrl(daemonUrl) {
  return daemonUrl == null || daemonUrl === "" || Boolean(localDaemonOrigin(daemonUrl));
}

/** The loopback daemon address another mod published in the shared `rig.data` config, for a mod whose own config names none. */
export function sharedLoopbackDaemonUrl(config, published) {
  if (config?.configInvalid || !publishedUnder(config, published)) return null;
  const url = publishedConfigFor(config, published)?.daemonUrl;
  return url && isLoopbackDaemonUrl(url) ? url : null;
}

/** Whether the shown layout has a mod in it (`content: { mod }` anywhere in the tree). */
export function layoutHasMod(node, mod) {
  return !!node && typeof node === "object" && (node.content?.mod === mod || (node.children ?? []).some((c) => layoutHasMod(c, mod)) || layoutHasMod(node.header, mod));
}

/** The OpenRig of a machine space with exactly one OpenRig there, else null (a space on this computer, or a machine with none or two). */
export function machineSpaceConn(config, space) {
  const connections = config?.connections ?? [];
  if (connections.length <= 1 || !space || !spaceMachine(space)) return null;
  const picked = followedConnection({ connections, space });
  return picked.why === "space" ? picked.id : null;
}

/** What a page entry is, apart from how it is shown (its filter, tab or config narrowing): two entries with one key
 *  are the same page. */
export function navKey(entry) {
  if (!entry) return "";
  const e = entry;
  const base = (() => {
    if (e.section === "file") return `file:${e.path ?? ""}`;
    if (e.section === "topology") {
      if (e.kind === "seat") return `seat:${e.rigId ?? e.rig}:${e.name}`;
      if (e.kind === "pod") return `pod:${e.rigId ?? e.rig}:${e.pod ?? e.name}`;
      if (e.kind === "rig") return `rig:${e.rigId ?? e.name}`;
      if (e.kind === "host") return `host:${e.hostId ?? e.host ?? e.name}`;
      if (e.focus === "pulse" || e.subview === "pulse") return "topology:pulse";
      return "topology";
    }
    if (e.section === "specs") {
      if (e.id) return `spec:${e.id}`;
      if (e.specOf) return `spec-of:${e.specOf}`;
      if (e.name && !e.kindFilter && !e.namespace) return `spec-name:${e.name}`;
      if (e.namespace) return `specs:ns:${e.kindFilter ?? "all"}:${e.namespace}`;
      if (e.kindFilter) return `specs:kind:${e.kindFilter}`;
      return "specs";
    }
    if (e.section === "scopes") {
      if (e.workflow) return `workflow:${e.project ?? ""}:${e.mission}:${e.workflow}${e.packet ? `:packet:${e.packet}` : ""}`;
      if (e.slice) return `slice:${e.mission}/${e.slice}`;
      if (e.mission) return `mission:${e.mission}`;
      if (e.project) return `project:${e.project}`;
      return "scopes";
    }
    if (e.section === "terminals") {
      if (e.view) return `view:${e.view}`;
      if (e.group) return `terminals:${e.group}`;
      return "terminals";
    }
    if (e.section === "needs") {
      if (e.id) return `need:${e.id}`;
      if (e.category) return `needs:${e.category}`;
      return "needs";
    }
    if (e.section === "system") {
      if (e.subview === "health") {
        if (e.healthQitem) return `system:health:qitem:${e.healthQitem}`;
        if (e.healthFinding) return `system:health:finding:${e.healthFinding}`;
      }
      if (e.subview) return `system:${e.subview}`;
      return "system";
    }
    return e.section ?? "";
  })();
  return e.conn ? `${e.conn}|${base}` : base;
}

/** Opening a page: the back history gains it, bounded; the same page again replaces the top instead of
 *  stacking a copy; a file remembers the page it was opened from, for its breadcrumbs. */
export function navPush(nav, entry) {
  const stack = nav?.stack ?? [];
  const top = stack.at(-1);
  let next = entry;
  if (entry?.section === "file" && !entry.from && top) next = { ...entry, from: top.section === "file" ? top.from ?? null : top };
  if (next?.conn) {
    let ownAt = -1;
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i]?.conn === next.conn) { ownAt = i; break; }
    if (ownAt >= 0 && navKey(stack[ownAt]) === navKey(next)) {
      return { stack: [...stack.slice(0, ownAt), ...stack.slice(ownAt + 1), next] };
    }
  }
  if (top && navKey(top) === navKey(next)) return { stack: [...stack.slice(0, -1), next] };
  return { stack: [...stack.slice(-29), next] };
}

/** Each Rig tab's own page history, `{ [tabId]: { stack, at } }`: a tab draws the last entry of its own stack, and nothing here
 *  changes another tab's record. `at` is when the record last changed. Each function returns the same object when nothing changes. */
export function tabPagesPush(all, tabId, entry, { spaceConn = null, at = Date.now() } = {}) {
  if (!tabId || !entry) return all ?? {};
  if (spaceConn && entry.conn && entry.conn !== spaceConn) return all ?? {};
  return { ...(all ?? {}), [tabId]: { stack: navPush(all?.[tabId], entry).stack, at } };
}

/** Appends a page to one Rig tab's own history. A tab with no history yet starts from the page the router last sent it (so Back returns there).
 *  A machine space with one OpenRig refuses another OpenRig's page. True when the page was added. */
export function pushTabPage(host, tabId, entry, { spaceConn = null, viewMod = "rig-view" } = {}) {
  if (!tabId || !entry) return false;
  try {
    const list = typeof host?.panes === "function" ? host.panes() : Array.isArray(host?.panes) ? host.panes : [];
    if (list.filter((p) => p?.mod === viewMod && p.tab === tabId).length > 1) {
      if (!(spaceConn && entry.conn && entry.conn !== spaceConn)) host.setShared?.("rig.nav", navPush(host.shared?.("rig.nav"), entry));
      return false;
    }
  } catch (_) {}
  const all = host.shared?.("rig.tabPages") ?? {};
  const routed = host.shared?.("rig.pageRoutes")?.[tabId];
  const base = all[tabId] || !routed ? all : { ...all, [tabId]: { stack: [routed], at: Date.now() } };
  const next = tabPagesPush(base, tabId, entry, { spaceConn });
  if (next === base) return false;
  host.setShared?.("rig.tabPages", next);
  return true;
}
