import { connectionBoxLabel } from "./rig-connections.js";
import { layoutHasMod, machineSpaceConn, navPush, pushTabPage } from "./rig-lib.js";

export const LINK_AMBIGUOUS = "That link doesn't say which OpenRig it belongs to, and there are several. Copy it from the Rig sidebar.";
const needSidebar = "Open the Rig sidebar, then try again.";
const outsideNeeds = "This request isn't in Needs here. Open it from its seat.";

/** Choose a page without view registration, polling, or timers. */
export function openRigPageFromLink(host, config, entry, sourceSpace) {
  const spaces = host.spaces(), panes = host.panes();
  const active = spaces.find(space => space.active);
  const clicked = spaces.find(space => space.id === sourceSpace);
  const compatible = space => {
    const owner = machineSpaceConn(config, space);
    return !owner || owner === entry.conn;
  };
  const log = () => host.setShared("rig.nav", navPush(host.shared("rig.nav"), entry));
  const ordered = active ? [active, ...spaces.filter(space => space !== active)] : spaces;
  for (const space of ordered.filter(compatible)) {
    for (const tab of space.tabs ?? []) {
      if (panes.filter(pane => pane.tab === tab.id && pane.mod === "rig-view").length !== 1) continue;
      if (!pushTabPage({ ...host, panes }, tab.id, entry, { spaceConn: machineSpaceConn(config, space) })) continue;
      log();
      host.run("tab.select", { id: tab.id });
      return true;
    }
  }
  if (layoutHasMod(host.layout(), "rig-page") && (!active || compatible(active))) {
    log();
    host.run("layout.select", { stack: "rig-work", child: "rig-page" });
    return true;
  }
  const destination = [clicked, active, ...ordered].find(space => space?.id && compatible(space));
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
