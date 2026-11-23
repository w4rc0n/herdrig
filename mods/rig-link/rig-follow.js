// Follow mode (v0.5.0 PR 2b): which connection the sidebar shows. The sidebar renders ONE connection; this is the rule that picks it, from the shown space.
// Pure: no host calls, nothing stored. The sidebar owns the state (last shown box, the picker's pin) per window and passes it in.
import { sameDaemonOrigin } from "./rig-space-context.js";

/** The machine a space lives on: its own `machine` (the `hc machine ls` name), else the prefix of a machine-qualified id, else null (this computer).
 *  `undefined` when no space is shown at all (that is not "this computer": nothing changes). */
export function spaceMachine(space) {
  if (!space) return undefined;
  if (space.machine !== undefined && space.machine !== null) return space.machine;
  const id = String(space.id ?? "");
  return id.includes("/") ? id.slice(0, id.indexOf("/")) : null;
}

/** The connection to show, as { id, why, hint }.
 *  Order: the picker's choice while its space is still the shown one; the shown space's machine (one connection on it: that one; two on one machine: the one whose address the space's rig
 *  was made with, by the same identity rule as everything else, else the last shown among them, never a guess); then the last shown box; at first start the connection for this
 *  computer, else the first. `hint` names a machine that has no connection (the space is on it): the sidebar keeps the last box and says so.
 *  connections: [{ id, machine, daemonUrl }] in config order. links: the shown space's rig origins [{ rig, origin }]. */
export function followedConnection({ connections = [], space, links = [], last = null, pinned = null }) {
  const listed = (id) => connections.find((c) => c.id === id);
  const fallback = () => {
    const kept = listed(last);
    if (kept) return { id: kept.id, why: "kept" };
    const local = connections.find((c) => (c.machine ?? null) === null) ?? connections[0];
    return { id: local?.id ?? null, why: "default" };
  };
  if (pinned && listed(pinned.id) && pinned.spaceId === (space?.id ?? null)) return { id: pinned.id, why: "pinned", hint: null };
  const machine = spaceMachine(space);
  if (machine === undefined) return { ...fallback(), hint: null };
  const onMachine = connections.filter((c) => (c.machine ?? null) === machine);
  if (onMachine.length === 1) return { id: onMachine[0].id, why: "space", hint: null };
  if (onMachine.length > 1) {
    const named = onMachine.filter((c) => links.some((link) => link?.origin && sameDaemonOrigin(link.origin, c.daemonUrl, machine)));
    if (named.length === 1) return { id: named[0].id, why: "space", hint: null };
    const kept = onMachine.find((c) => c.id === last);
    return kept ? { id: kept.id, why: "kept", hint: null } : { id: onMachine[0].id, why: "default", hint: null };
  }
  // No connection for this machine: a plain box (it gets the hint) or a Local space with no connection for this computer (nothing to say).
  return { ...fallback(), hint: machine === null ? null : machine };
}
