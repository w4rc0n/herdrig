import { buildAttachRelayArgv, isValidSessionName, tmuxServerArgsFrom, layoutHasMod, MOD_IDS } from "./rig-lib.js";
import { machineId, machineLocalId, remoteFailure } from "./rig-remote.js";
import { resolveRigSpace, unconfirmedRigSpace, unconfirmedSpaceReason, topologyRig, rigSessions, markRigSpace, rigOrigin, hostLabelValue } from "./rig-space-context.js";

const list = (host, key) => typeof host[key] === "function" ? host[key]() ?? [] : host[key] ?? [];

// Portable base64/UTF-8 decode: the native mod runtime has neither Node's Buffer nor browser atob.
// Only the relay's first-paint activity is transient; every other payload field and both program paths match.
function relayIdentity(argv) {
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

// Called only for an explicitly configured daemonMachine. Every failure is terminal: never a local fallback.
export async function attachRemoteSeat(host, seat, config, options = {}) {
  const session = seat.session ?? seat.canonicalSessionName;
  if (!isValidSessionName(session)) return { ok: false, reason: "The seat has no valid session address." };
  if (["stopped", "departed", "failed"].includes(seat.status) && !seat.sessionAlive && !seat.attachable) return { ok: false, reason: "Stopped: seat has no running session to attach." };
  if (!host.prepareRemote) {
    if (typeof host.layout === "function" && layoutHasMod(host.layout(), MOD_IDS.sidebar)) {
      host.run(options.operator || session === "operator-agent@kernel" ? "rig.operator" : `rig.attach:${session}`);
      return { ok: true, routed: true };
    }
    return { ok: false, reason: "Open the Rig sidebar to confirm and use the configured Herdr machine. No local terminal was started." };
  }
  try {
    const remote = await host.prepareRemote(config);
    if (!remote.ok) return remote;
    if (seat.host && seat.host !== "local" && seat.host !== remote.selfHostId) throw new Error("This seat belongs to a different OpenRig host. No terminal was started.");
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
      const tab = qualified(existing.labels["herdr.tab"]);
      const destination=resolveRigSpace(host,config,[seat.rig,seat.rigId,session.slice(session.lastIndexOf("@")+1)]);
      if(destination?.tabs?.some(item=>item.id===tab))await markRigSpace(host,config,[seat.rig,seat.rigId,session.slice(session.lastIndexOf("@")+1)],destination);
      host.run("space.select", { id: qualified(existing.labels["herdr.space"]) });
      host.run("tab.select", { id: tab }); host.run("pane.focus", { terminal: existing.address });
      return { ok: true, reused: true, terminal: existing.address, tab };
    };
    const existing = existingViewer();
    if (existing) return await reuse(existing);
    const refuseChangedViewer = () => {
      const changed = terms().find((t) => t.labels?.["herdr-openrig.attach"] === session
        && rigOrigin(t.labels?.["herdr-openrig.origin"]) === rigOrigin(origin) && t.labels?.["herdr-openrig.role"] === "attach"
        && list(host, "panes").some((p) => p.terminal === t.address));
      if (changed) throw new Error(`Close that tab, then Attach again. Save any work before closing it: the Attach tab for ${seat.logicalId ?? session} is no longer running its viewer, possibly after a Herdr restart.`);
    };
    refuseChangedViewer();
    const rig = seat.rig ?? session.slice(session.lastIndexOf("@") + 1);
    const isOperator = options.operator || session === "operator-agent@kernel";
    // The same vouching inputs the pages and the grid use, so a space made with another spelling of this daemon's address is adopted when its
    // own stamps or the rig's seats vouch for it; when it still can't be confirmed, Attach asks instead of making a second space.
    const names = [rig, seat.rigId], vouch = { sessions: rigSessions(topologyRig(host, names)), hostId: remote.selfHostId };
    const space = resolveRigSpace(host,config,names,vouch);
    if (!space) {
      const other = unconfirmedRigSpace(host,config,names,vouch);
      if (other) return { ok: false, unconfirmedSpace: true, reason: unconfirmedSpaceReason(rig, machine, other.origin, config.daemonUrl) };
    }
    if(space)await markRigSpace(host,config,[rig,seat.rigId],space,vouch);
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const spaceId = space?.id ?? qualified(`sp-openrig-${nonce}`), tab = qualified(`tb-attach-${nonce}`);
    // Preparation revalidates the profile, identity and relay bytes immediately before launching.
    const checked = await host.prepareRemote(config);
    if (!checked.ok) return checked;
    if (JSON.stringify(checked) !== JSON.stringify(remote)) throw new Error("The remote machine changed during Attach. Retry.");
    const appeared = existingViewer();
    if (appeared) return await reuse(appeared);
    refuseChangedViewer();
    const started = await host.hc(["run", "--on", machine, "--bg", "--json", "--no-parent", "--no-notify",
      "--label", `herdr.space=${local(spaceId)}`, "--label", `herdr.tab=${local(tab)}`,
      "--label", "herdr-openrig.space=1", "--label", `herdr-openrig.rig=${rig}`,
      "--label", `herdr-openrig.origin=${origin}`, "--label", "herdr-openrig.role=attach",
      "--label", `herdr-openrig.attach=${session}`, "--label", `herdr-openrig.seat=${session}`,
      ...(hostLabelValue(checked.selfHostId) ? ["--label", `herdr-openrig.host=${hostLabelValue(checked.selfHostId)}`] : []), "--", ...argv]);
    if (started.code !== 0) throw new Error(started.stderr || `Could not start the seat on ${machine}.`);
    const address = JSON.parse(started.stdout).address;
    if (!address?.startsWith(`${machine}/`)) throw new Error("Herdr returned an unexpected remote terminal address.");
    for (let i = 0; i < 60 && !list(host, "panes").some((p) => p.terminal === address && p.tab === tab); i++) {
      if (!host.wait) break; await host.wait(100);
    }
    if (!list(host, "panes").some((p) => p.terminal === address && p.tab === tab)) throw new Error("Herdr has not adopted the remote terminal yet. Check the machine's connection before retrying.");
    if (!space) host.run("space.rename", { id: spaceId, name: isOperator ? "OpenRig" : rig });
    host.run("tab.rename", { id: tab, name: options.name ?? (isOperator ? "Operator" : seat.logicalId ?? session) });
    host.run("space.select", { id: spaceId }); host.run("tab.select", { id: tab }); host.run("pane.focus", { terminal: address });
    return { ok: true, terminal: address, tab };
  } catch (e) { return remoteFailure(e, config.daemonMachine); }
}
