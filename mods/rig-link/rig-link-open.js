import { LEGACY_CONNECTION_ID, configOfConnection, connectionBoxLabel, connectionRows } from "./rig-connections.js";
import { followedConnection, spaceMachine } from "./rig-follow.js";
import { layoutHasMod, navPush, pushTabPage } from "./rig-core.js";
import { openRigSpaceContext, rigOrigin, sameDaemonOrigin } from "./rig-space-context.js";

export const LINK_AMBIGUOUS = "That link doesn't say which OpenRig it belongs to, and there are several. Copy it from the Rig sidebar.";
const needSidebar = "Open the Rig sidebar, then try again.";
const outsideNeeds = "This request isn't in Needs here. Open it from its seat.";

/** Choose a page without view registration, polling, or timers. */
export function openRigPageFromLink(host, config, entry, sourceSpace) {
  const spaces = host.spaces() ?? [];
  const panes = host.panes() ?? [];
  const terminals = typeof host.terminals === "function" ? (host.terminals() ?? []) : [];
  const active = spaces.find(space => space.active);
  const clicked = spaces.find(space => space.id === sourceSpace);
  const connections = config?.connections ?? [];
  const several = connections.length > 1;
  const targetConn = entry?.conn ?? config?.connectionId ?? LEGACY_CONNECTION_ID;
  const targetCfg = configOfConnection(config, targetConn) ?? config;
  const targetMachine = targetCfg?.daemonMachine || null;
  const targetUrl = targetCfg?.daemonUrl || null;
  const onTargetMachine = connections.filter(c => (c.machine ?? null) === targetMachine);
  const marks = host.shared?.("herdrig.spaces") ?? {};
  const spaceState = host.shared?.("rig.spaceState") ?? {};
  const tabPages = host.shared?.("rig.tabPages") ?? {};
  const pageRoutes = host.shared?.("rig.pageRoutes") ?? {};
  const pageOnScreen = host.shared?.("rig.pageOnScreen") ?? {};
  const contexts = new Map(openRigSpaceContext(spaces, terminals, panes, spaceState, "rig-view").map(c => [c.id, c]));

  const homeKeyOf = (cfg) => JSON.stringify([
    rigOrigin(cfg?.daemonUrl) ?? String(cfg?.daemonUrl ?? "").replace(/\/$/, ""),
    cfg?.daemonMachine || null,
  ]);
  const sharedHomeKey = (id) => {
    const k = homeKeyOf(configOfConnection(config, id));
    return connections.filter(c => homeKeyOf(configOfConnection(config, c.id)) === k).length > 1;
  };
  const homeRecordMatches = (spaceId, connId) => {
    const cfg = configOfConnection(config, connId);
    if (!cfg) return false;
    const homes = spaceState.homeSpaces ?? {};
    const recordedKeys = Object.entries(homes).filter(([, id]) => id === spaceId).map(([k]) => k);
    if (recordedKeys.length > 0) {
      const ownKey = homeKeyOf(cfg);
      const siblingKeys = new Set(connections.filter(c => c.id !== connId).map(c => homeKeyOf(configOfConnection(config, c.id))));
      siblingKeys.delete(ownKey);
      return recordedKeys.some(k => {
        if (siblingKeys.has(k)) return false;
        if (k === ownKey) return true;
        try {
          const [recOrigin, recMachine] = JSON.parse(k);
          if ((recMachine ?? null) !== (cfg.daemonMachine || null)) return false;
          return Boolean(recOrigin && cfg.daemonUrl && sameDaemonOrigin(recOrigin, cfg.daemonUrl, cfg.daemonMachine || null));
        } catch { return false; }
      });
    }
    if (spaceState.homeSpace === spaceId) return connId === LEGACY_CONNECTION_ID || !several;
    return false;
  };
  const spaceOwner = (space) => {
    if (!space) return null;
    const sm = spaceMachine(space);
    const mark = marks[space.id];
    const markConn = mark?.conn ?? mark?.spaceConn ?? null;
    if (markConn) {
      if (mark?.home && connections.some(c => c.id === markConn) && sharedHomeKey(markConn)) return null;
      return markConn;
    }
    const onSpaceMachine = connections.filter(c => (c.machine ?? null) === sm);
    if (onSpaceMachine.length === 1) return onSpaceMachine[0].id;
    if (onSpaceMachine.length > 1) {
      const ctx = contexts.get(space.id);
      const tuiLinks = (ctx?.tuis ?? []).map(t => ({ origin: t.labels?.["herdr-openrig.origin"] })).filter(l => l.origin);
      const links = [...(ctx?.rigLinks ?? []), ...tuiLinks];
      const picked = followedConnection({ connections: onSpaceMachine, space, links });
      if (picked.why === "space") {
        const ownCfg = configOfConnection(config, picked.id);
        if (!links.some(l => l.origin && !sameDaemonOrigin(l.origin, ownCfg?.daemonUrl, sm))) return picked.id;
      }
      const homeOwners = onSpaceMachine.filter(c => homeRecordMatches(space.id, c.id));
      if (homeOwners.length === 1 && !sharedHomeKey(homeOwners[0].id)) return homeOwners[0].id;
    }
    return null;
  };
  const compatibleSpace = (space) => {
    if (!space || spaceMachine(space) !== targetMachine) return false;
    const owner = spaceOwner(space);
    return !owner || owner === targetConn;
  };
  const tabCurrentConn = (tab, rigPane, space) => {
    const direct = tabPages[tab.id]?.stack?.at(-1)?.conn
      ?? pageRoutes[tab.id]?.conn
      ?? rigPane.props?.entry?.conn
      ?? rigPane.props?.conn
      ?? null;
    if (direct) return direct;
    const screen = pageOnScreen[tab.id];
    if (screen?.space === space.id) {
      const conns = [...new Set(Object.values(screen.views ?? {}).filter(Boolean))];
      if (conns.length === 1) return conns[0];
      if (conns.length > 1) return conns.find(c => c !== targetConn) ?? conns[0];
    }
    return null;
  };
  const compatibleTab = (space, tab, rigPane) => {
    const current = tabCurrentConn(tab, rigPane, space);
    if (current) return current === targetConn;
    const owner = spaceOwner(space);
    if (owner) return owner === targetConn;
    return onTargetMachine.length <= 1;
  };
  const isHomeSpaceForTarget = (space) => {
    if (!compatibleSpace(space)) return false;
    const mark = marks[space.id];
    if (mark?.home === true) {
      const mc = mark.conn ?? mark.spaceConn ?? null;
      return mc ? mc === targetConn : (!several || homeRecordMatches(space.id, targetConn));
    }
    if (homeRecordMatches(space.id, targetConn)) return true;
    const ctx = contexts.get(space.id);
    return Boolean(ctx?.home && (!several || spaceOwner(space) === targetConn));
  };
  const isRigSpaceForTarget = (space) => {
    if (!compatibleSpace(space)) return false;
    const mark = marks[space.id];
    if (mark?.rig) {
      const mc = mark.conn ?? mark.spaceConn ?? null;
      return mc ? mc === targetConn : !several;
    }
    const ctx = contexts.get(space.id);
    if (!ctx?.rigs?.length) return false;
    const links = ctx.rigLinks ?? [];
    if (links.some(l => l.origin)) {
      return Boolean(targetUrl) && links.some(l => l.origin && sameDaemonOrigin(l.origin, targetUrl, targetMachine));
    }
    return !several;
  };
  const isOpenRigSpaceForTarget = (space) => isHomeSpaceForTarget(space) || isRigSpaceForTarget(space);

  const rigIdentifiers = new Set([entry?.rigId, entry?.rig].filter(Boolean));
  const hasTargetRig = rigIdentifiers.size > 0;
  if (hasTargetRig) {
    const directMatch = spaces.some(space => {
      if (!isRigSpaceForTarget(space)) return false;
      const mark = marks[space.id], ctx = contexts.get(space.id);
      return Boolean((mark?.rigId && rigIdentifiers.has(mark.rigId)) || (mark?.rig && rigIdentifiers.has(mark.rig))
        || (ctx?.rigs ?? []).some(r => rigIdentifiers.has(r)));
    });
    if (!directMatch) {
      const topo = connectionRows(host.shared?.("rig.data"), targetConn)?.topology;
      if (Array.isArray(topo)) {
        for (const r of topo) {
          if (r?.conn && r.conn !== targetConn) continue;
          if ((r?.id && rigIdentifiers.has(r.id)) || (r?.name && rigIdentifiers.has(r.name))) {
            if (r.id) rigIdentifiers.add(r.id);
            if (r.name) rigIdentifiers.add(r.name);
          }
        }
      }
    }
  }
  const matchesTargetRig = (space) => {
    if (!hasTargetRig || !isRigSpaceForTarget(space)) return false;
    const mark = marks[space.id], ctx = contexts.get(space.id);
    return Boolean((mark?.rigId && rigIdentifiers.has(mark.rigId)) || (mark?.rig && rigIdentifiers.has(mark.rig))
      || (ctx?.rigs ?? []).some(r => rigIdentifiers.has(r)));
  };

  const log = () => host.setShared("rig.nav", navPush(host.shared("rig.nav"), entry));
  const targetRigSpace = spaces.find(matchesTargetRig) ?? null;
  const homeSpace = spaces.find(isHomeSpaceForTarget) ?? null;
  const reuseOrder = [...new Set([targetRigSpace, active, clicked, homeSpace, ...spaces].filter(Boolean))];
  for (const space of reuseOrder.filter(compatibleSpace)) {
    const owner = spaceOwner(space);
    for (const tab of space.tabs ?? []) {
      const rigPanes = panes.filter(pane => pane.tab === tab.id && pane.mod === "rig-view");
      if (rigPanes.length !== 1) continue;
      if (!compatibleTab(space, tab, rigPanes[0])) continue;
      if (!pushTabPage({ ...host, panes }, tab.id, entry, { spaceConn: owner })) continue;
      log();
      host.run("tab.select", { id: tab.id });
      return true;
    }
  }
  if (layoutHasMod(host.layout(), "rig-page") && (!active || compatibleSpace(active))) {
    log();
    host.run("layout.select", { stack: "rig-work", child: "rig-page" });
    return true;
  }
  const openRigSpaces = spaces.filter(isOpenRigSpaceForTarget);
  const candidates = hasTargetRig
    ? [targetRigSpace, homeSpace, clicked, active, ...openRigSpaces]
    : [clicked, active, homeSpace, ...openRigSpaces];
  const destination = candidates.find(space => space?.id && isOpenRigSpaceForTarget(space));
  if (!destination) return false;
  log();
  host.run("tab.new", { space: destination.id, name: "Rig", mod: "rig-view",
    props: { entry, section: entry.section, ...(entry.id ? { id: entry.id } : {}), space: destination.id } });
  return true;
}

function queueSeat(row, conn) {
  const session = row.destinationSession;
  if (typeof session !== "string") return null;
  const parts = /^([A-Za-z0-9][A-Za-z0-9._-]*)@([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(session);
  if (!parts || parts[2] === "external") return null;
  return { section: "topology", kind: "seat", seatTab: "queue", queueItem: row.qitemId ?? row.id, rig: parts[2], name: parts[1], session, conn };
}

/** Handle only already-resolved routes. fetch is a scoped GET supplied by the host. */
export async function handleResolvedRigLink(host, config, target, sourceSpace) {
  const notice = (body) => {
    host.notify({ title: "OpenRig link", body });
    return "handled";
  };
  if (!target.ok) return target.why === "ambiguous" ? notice(LINK_AMBIGUOUS) : "pass";
  let entry = target.entry;
  if (target.queue) {
    const { queue, conn, origin } = target;
    const box = connectionBoxLabel(config, conn);
    try {
      const q = await host.fetch(`${origin}/api/queue/${encodeURIComponent(queue)}`, conn);
      if (q.status === 404) return notice(`That request isn't in ${box}. Nothing was opened.`);
      if (!q.ok) return notice(`Couldn't check that request in ${box}. Nothing was opened.`);
      const body = await q.json(), row = body?.item ?? body?.qitem ?? body;
      if ((row?.qitemId ?? row?.id) !== queue) return notice(`Couldn't check that request in ${box}. Nothing was opened.`);
      const a = await host.fetch(`${origin}/api/attention`, conn);
      if (!a.ok) return notice(`Couldn't check that request in ${box}. Nothing was opened.`);
      const { items } = await a.json();
      if (!Array.isArray(items)) return notice(`Couldn't check that request in ${box}. Nothing was opened.`);
      const id = `queue:${queue}`;
      entry = items.some(item => item?.id === id) ? { section: "needs", id, view: "", conn } : queueSeat(row, conn);
      if (!entry) return notice(outsideNeeds);
    } catch {
      return notice(`Couldn't check that request in ${box}. Nothing was opened.`);
    }
  }
  return openRigPageFromLink(host, config, entry, sourceSpace) ? "handled" : notice(needSidebar);
}
