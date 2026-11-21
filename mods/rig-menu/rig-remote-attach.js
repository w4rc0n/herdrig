import { errorDiagnostic } from "./rig-words.js";
import { buildAttachRelayArgv, isValidSessionName, tmuxServerArgsFrom, rigSeatServers, layoutHasMod, MOD_IDS, relayIdentity } from "./rig-lib.js";
import { machineId, machineLocalId, remoteFailure } from "./rig-remote.js";
import { commandFor, operatorCommandFor } from "./rig-connections.js";
import { gatedOperationOrRefusal } from "./rig-gate.js";
import { resolveRigSpace, unconfirmedRigSpace, unconfirmedSpaceReason, topologyRig, rigSessions, markRigSpace, rigOrigin, hostLabelValue, prepareRigSpaceAdoption } from "./rig-space-context.js";

const list = (host, key) => (typeof host[key] === "function" ? host[key]() ?? [] : host[key] ?? []);
// A caller that gave up (its deadline passed) gets nothing started, focused or replaced afterwards.
const stopIfCancelled = (host) => { if (host.cancelled?.()) throw new Error("Stopped: the request took too long. Nothing was started."); };

// Called only for an explicitly configured daemonMachine. Every failure is terminal: never a local fallback.
export async function attachRemoteSeat(host, seat, config, options = {}) {
  const session = seat.session ?? seat.canonicalSessionName;
  if (!isValidSessionName(session)) return { ok: false, reason: "The seat has no valid session address." };
  if (["stopped", "departed", "failed"].includes(seat.status) && !seat.sessionAlive && !seat.attachable) return { ok: false, reason: "Stopped: seat has no running session to attach." };
  if (!host.prepareRemote) {
    if (typeof host.layout === "function" && layoutHasMod(host.layout(), MOD_IDS.sidebar)) {
      host.run(options.operator || session === "operator-agent@kernel" ? operatorCommandFor(config) : commandFor("rig.attach", config, session));
      return { ok: true, routed: true };
    }
    return { ok: false, reason: "Open the Rig sidebar to confirm and use the configured Herdr machine. No local terminal was started." };
  }
  // ONE operation for the whole flow, as the local Attach has: the preparations, the space marking and the stop of an older viewer all belong to the settings this Attach began
  // under. Per-send checks judge each send alone, and the origin check needs two connections, so with one an edit of the machine or address mid-flow went unseen and the
  // viewer started on the old machine. `changed()` is the last look before an act (null with no operation: the gate refuses every gated send itself).
  const op = gatedOperationOrRefusal(config?.connectionId);
  const changed = () => { if (op.since < 0) return null; try { op.check(); return null; } catch (error) { return { ok: false, disabled: true, reason: errorDiagnostic(error) }; } };
  const asAttachFailure = (res) => res?.execTimeout && typeof res.reason === "string"
    ? { ...res, reason: res.reason.replace(/^Stopped:/, "Attach stopped:") }
    : res;
  try {
    const remote = await host.prepareRemote(config);
    if (!remote.ok) return asAttachFailure(remote);
    if (seat.host && seat.host !== "local" && seat.host !== remote.selfHostId) throw new Error("This seat belongs to a different OpenRig host. No terminal was started.");
    const adoptionNames=[seat.rig,seat.rigId,session.slice(session.lastIndexOf("@")+1)],adoptionRig=topologyRig(host,adoptionNames,config);
    const adoption=await prepareRigSpaceAdoption(host,config,adoptionNames,{sessions:rigSessions(adoptionRig),servers:rigSeatServers(adoptionRig)});
    if(!adoption.ok)return adoption;
    if(adoption.host)host=adoption.host;
    const machine = remote.machine, origin = config.daemonUrl.replace(/\/$/, "");
    const local = (id) => machineLocalId(id, machine), qualified = (id) => machineId(id, machine);
    const terms = () => list(host, "terminals").filter((t) => t.address?.startsWith(`${machine}/`));
    const flags = tmuxServerArgsFrom(seat.tmuxAttachCommand, session);
    if (!seat.tmuxAttachCommand || !flags) throw new Error("The seat has no checked tmux attach command. Refresh OpenRig before attaching.");
    const probe = await host.exec("tmux", [...flags, "has-session", "-t", `=${session}`], { on: machine, timeout: 10000 });
    if (probe.code !== 0) throw new Error(`The seat's tmux session is unavailable on ${machine}. Connect as the user running OpenRig and check its tmux socket.`);
    const argv = buildAttachRelayArgv({ daemonUrl: remote.daemonUrl, rig: [remote.node], openrigHome: null }, seat, remote.relayPath);
    const existingViewer = () => terms().find((t) => t.labels?.["herdr-openrig.attach"] === session
      && rigOrigin(t.labels?.["herdr-openrig.origin"]) === rigOrigin(origin) && t.labels?.["herdr-openrig.role"] === "attach"
      && relayIdentity(t.argv) === relayIdentity(argv) && (!t.state || ["running", "live"].includes(t.state)));
    const reuse = async (existing) => {
      stopIfCancelled(host);
      const tab = qualified(existing.labels["herdr.tab"]);
      const destination=resolveRigSpace(host,config,[seat.rig,seat.rigId,session.slice(session.lastIndexOf("@")+1)],{strictOrigin:true});
      if(destination?.tabs?.some(item=>item.id===tab))await markRigSpace(host,config,[seat.rig,seat.rigId,session.slice(session.lastIndexOf("@")+1)],destination);
      stopIfCancelled(host);
      const movedBeforeFocus = changed(); if (movedBeforeFocus) return movedBeforeFocus; // the marking above awaited
      host.run("space.select", { id: qualified(existing.labels["herdr.space"]) });
      host.run("tab.select", { id: tab }); host.run("pane.focus", { terminal: existing.address });
      return { ok: true, reused: true, terminal: existing.address, tab };
    };
    const existing = existingViewer();
    if (existing) return await reuse(existing);
    // A tab kept open across an update runs the OLD relay (its `relayIdentity` moved with the poll interval),
    // so it is "running an older viewer", not "no longer running its viewer". Only a viewer that is really gone gets the
    // old message. Both offer the same replace the local path offers.
    const staleChangedViewer = () => {
      const changed = terms().find((t) => t.labels?.["herdr-openrig.attach"] === session
        && rigOrigin(t.labels?.["herdr-openrig.origin"]) === rigOrigin(origin) && t.labels?.["herdr-openrig.role"] === "attach"
        && relayIdentity(t.argv) !== null && relayIdentity(t.argv) !== relayIdentity(argv)
        && list(host, "panes").some((p) => p.terminal === t.address));
      if (!changed) return null;
      const pane = list(host, "panes").find((p) => p.terminal === changed.address);
      return { terminal: changed.address, tab: qualified(pane?.tab ?? changed.labels["herdr.tab"] ?? "") };
    };
    const staleViewerOffer = (stale) => ({ ok: false, needsViewerRefresh: true,
      reason: `The Attach tab for ${seat.logicalId ?? session} is running an older viewer, from before an update. Attach offers to replace it.`,
      staleViewer: stale });
    /** A same-session Attach tab whose viewer is gone entirely: the old message is true for it. */
    const goneViewer = () => terms().find((t) => t.labels?.["herdr-openrig.attach"] === session
      && rigOrigin(t.labels?.["herdr-openrig.origin"]) === rigOrigin(origin) && t.labels?.["herdr-openrig.role"] === "attach"
      && list(host, "panes").some((p) => p.terminal === t.address));
    const goneViewerRefusal = () => new Error(`Close that tab, then Attach again. Save any work before closing it: the Attach tab for ${seat.logicalId ?? session} is no longer running its viewer, possibly after a Herdr restart.`);
    // The decision is made HERE, before any space work: a stale viewer is an offer (nothing starts, stops or closes),
    // a gone viewer is the old refusal. With the person's approval (`options.replaceViewer`) the stale one is only
    // REMEMBERED here and stopped just before the fresh start, so a late failure never leaves a closed tab and no viewer.
    const early = staleChangedViewer();
    if (early && !options.replaceViewer) return staleViewerOffer(early);
    let pendingReplace = early ?? null;
    if (!early && goneViewer()) throw goneViewerRefusal();
    const rig = seat.rig ?? session.slice(session.lastIndexOf("@") + 1);
    const isOperator = options.operator || session === "operator-agent@kernel";
    // The same vouching inputs the pages and the grid use, so a space made with another spelling of this daemon's address is adopted when its
    // own stamps or the rig's seats vouch for it; when it still can't be confirmed, Attach asks instead of making a second space.
    // The tmux server each seat is on goes with the sessions, as it does for the pages and the grid: seats that match by name alone must not
    // confirm a space whose viewers run on another tmux server (two daemons on one machine). The topology is built once for both.
    const names = [rig, seat.rigId], listed = topologyRig(host, names, config), vouch = { sessions: rigSessions(listed), servers: rigSeatServers(listed), hostId: remote.selfHostId, strictOrigin: true };
    const space = adoption.space??resolveRigSpace(host,config,names,vouch);
    if (!space) {
      const other = unconfirmedRigSpace(host,config,names,vouch);
      if (other) return { ok: false, unconfirmedSpace: true, reason: unconfirmedSpaceReason(rig, machine, other.origin, config.daemonUrl, other) };
    }
    if(space&&!adoption.space)await markRigSpace(host,config,[rig,seat.rigId],space,vouch);
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const spaceId = space?.id ?? qualified(`sp-openrig-${nonce}`), tab = qualified(`tb-attach-${nonce}`);
    // Preparation revalidates the profile, identity and relay bytes immediately before launching.
    const checked = await host.prepareRemote(config);
    if (!checked.ok) return asAttachFailure(checked);
    if (JSON.stringify(checked) !== JSON.stringify(remote)) throw new Error("The remote machine changed during Attach. Retry.");
    const movedAfterPrepare = changed(); if (movedAfterPrepare) return movedAfterPrepare; // the preparation just awaited: the settings it ran under may be gone
    stopIfCancelled(host);
    const appeared = existingViewer();
    if (appeared) return await reuse(appeared);
    // The last look before the fresh start: with the person's approval the remembered stale viewer is stopped now, never
    // earlier (the revalidation above can still refuse, and a refused Attach leaves the old viewer running and its tab).
    // Once the person's click has stopped the old viewer and closed its tab, a failure in the fresh
    // start must say so — the generic line reads as if nothing happened. Single source: this flag is set only here.
    let replaced = false;
    stopIfCancelled(host); // before the old viewer is stopped, too
    if (pendingReplace) {
      const stillStale = staleChangedViewer();
      if (stillStale) {
        const movedBeforeStop = changed(); if (movedBeforeStop) return movedBeforeStop; // nothing is stopped for settings that are gone
        // No `--on`: herdr-core routes terminal-addressed verbs by the address's `machine/` prefix (remote.rs ON_A_TERMINAL),
        // so the kill reaches the right core without a cross-machine verb (security rule S32: only run, exec and the relay's
        // file write go to another machine explicitly). A refused or failed kill closes nothing and starts nothing.
        host.onStep?.("replacing the old viewer");
        const killed = await host.hc(["kill", "--", pendingReplace.terminal]);
        if (killed && killed.code !== undefined && killed.code !== 0) throw new Error("The older viewer could not be stopped, so nothing was changed.");
        // A kill of the relay often closes the seat's tab with it: close it only while it is still there, or herdr
        // toasts "tab.close failed · no tab …" after a replace that succeeded. Other close failures are still reported.
        if (pendingReplace.tab && list(host, "spaces").some((s) => (s.tabs ?? []).some((t) => t.id === pendingReplace.tab))) host.run("tab.close", { id: pendingReplace.tab, confirmed: true });
        replaced = true;
      } else if (goneViewer()) throw goneViewerRefusal(); // it stopped being a viewer at all while we waited
      pendingReplace = null;
    } else if (goneViewer()) throw goneViewerRefusal();
    const afterReplace = (reason) => replaced
      ? `The older viewer was stopped and its tab closed for this Attach, and the new one could not be confirmed. ${reason} Open Attach again.`
      : reason;
    // Nothing awaits between this check and the start: a caller that gave up during the replace above gets no viewer, and is told the old one was stopped.
    if (host.cancelled?.()) throw new Error(afterReplace("Stopped: the request took too long. Nothing more was started."));
    const movedBeforeStart = changed(); if (movedBeforeStart) return { ...movedBeforeStart, reason: afterReplace(movedBeforeStart.reason) }; // the last look: no await between it and the start
    host.onStep?.("starting the viewer");
    const started = await host.hc(["run", "--on", machine, "--bg", "--json", "--no-parent", "--no-notify",
      "--label", `herdr.space=${local(spaceId)}`, "--label", `herdr.tab=${local(tab)}`,
      "--label", "herdr-openrig.space=1", "--label", `herdr-openrig.rig=${rig}`,
      "--label", `herdr-openrig.origin=${origin}`, "--label", "herdr-openrig.role=attach",
      "--label", `herdr-openrig.attach=${session}`, "--label", `herdr-openrig.seat=${session}`,
      ...(hostLabelValue(checked.selfHostId) ? ["--label", `herdr-openrig.host=${hostLabelValue(checked.selfHostId)}`] : []), "--", ...argv]);
    if (started.code !== 0) throw new Error(afterReplace(started.stderr || `Could not start the seat on ${machine}.`));
    const address = JSON.parse(started.stdout).address;
    if (!address?.startsWith(`${machine}/`)) throw new Error(afterReplace("Herdr returned an unexpected remote terminal address."));
    for (let i = 0; i < 60 && !list(host, "panes").some((p) => p.terminal === address && p.tab === tab); i++) {
      if (!host.wait) break; await host.wait(100);
    }
    if (!list(host, "panes").some((p) => p.terminal === address && p.tab === tab)) throw new Error(afterReplace("Herdr has not adopted the remote terminal yet. Check the machine's connection before retrying."));
    // A rig's space is named after its rig, the operator's (kernel) too, as on this computer: "OpenRig" is the home space's name alone.
    if (!space) host.run("space.rename", { id: spaceId, name: rig });
    host.run("tab.rename", { id: tab, name: options.name ?? (isOperator ? "Operator" : seat.logicalId ?? session) });
    host.run("space.select", { id: spaceId }); host.run("tab.select", { id: tab }); host.run("pane.focus", { terminal: address });
    return { ok: true, terminal: address, tab };
  } catch (e) { return remoteFailure(e, config.daemonMachine, { attach: true }); }
}
