// The person's configured Herdr machine is the only remote authority. Daemon data never selects it.
import { isLoopbackDaemonUrl, parseDaemonStatusJson } from "./rig-lib.js";
export const RELAY_SHA256 = "a82da5dfb3d37644316bb36ad24102483473dad66ae9961d2709958ab5e81270";
const MACHINE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
// Attach and every rig space create separate callers. Serialize the whole preparation across them;
// each queued caller still rechecks its own config, consent, profile and bytes instead of sharing readiness.
const preparations = new Map();
// Metadata is read with fixed executable/argv calls; no shell or remotely evaluated source.
export const goodHome = (s) => typeof s === "string" && s.startsWith("/") && s !== "/" && !/[\x00-\x1f\x7f]/.test(s) && s.split("/").slice(1).every((p) => p && p !== "." && p !== "..");
const line = (value) => String(value ?? "").replace(/\r?\n$/, "");
export async function inspectRemote(run, expectedHome = null) {
  const output = async (cmd, args) => {
    const result = await run(cmd, args);
    if (result?.code !== 0) throw new Error(result?.stderr || `Remote ${cmd} failed.`);
    return line(result.stdout);
  };
  const test = async (flag, file) => {
    const result = await run("test", [flag, file]);
    if (result?.code !== 0 && result?.code !== 1) throw new Error(result?.stderr || "Remote path check failed.");
    return result.code === 0;
  };
  const home = await output("printenv", ["HOME"]);
  if (!goodHome(home) || (expectedHome !== null && home !== expectedHome)) throw new Error("Invalid or changed remote home.");
  if (await output("readlink", ["-f", "--", home]) !== home || !await test("-d", home)) throw new Error("Refused symlinked or invalid remote home.");
  let current = home, sha256 = null;
  const parts = [".local", "share", "herdr-openrig", "rig-attach-relay.cjs"];
  for (let i = 0; i < parts.length; i++) {
    current += "/" + parts[i];
    if (await test("-L", current)) throw new Error("Refused relay path: symlink.");
    if (await test("-e", current)) {
      if (!await test(i === parts.length - 1 ? "-f" : "-d", current)) throw new Error("Refused relay path: unexpected file type.");
      if (await output("readlink", ["-f", "--", current]) !== current) throw new Error("Refused symlinked relay path.");
      if (i === parts.length - 1) {
        const hash = await output("sha256sum", ["--", current]);
        if (!/^[a-f0-9]{64} [ *]/.test(hash)) throw new Error("Invalid remote relay hash.");
        sha256 = hash.slice(0, 64);
      }
    }
  }
  return { home, path: current, sha256 };
}
export async function remoteMetadata(run) {
  const info = await inspectRemote(run);
  const read = async (cmd, args) => {
    const r = await run(cmd, args);
    if (r?.code !== 0) throw new Error(r?.stderr || `Remote ${cmd} failed.`);
    return line(r.stdout);
  };
  const node = await read("which", ["node"]), user = await read("id", ["-un"]), searchPath = await read("printenv", ["PATH"]);
  if (!goodHome(node) || !user || /[\x00-\x1f\x7f]/.test(user) || !searchPath || /[\x00-\x1f\x7f]/.test(searchPath)) throw new Error("Invalid remote executable or account metadata.");
  return { ...info, node, user, searchPath };
}
const callList = (host, key) => typeof host[key] === "function" ? host[key]() ?? [] : host[key] ?? [];
const parse = (result, operation) => {
  if (result?.code !== 0) throw new Error(`${operation}: ${result?.stderr || "command failed"}`);
  try { return JSON.parse(result.stdout); } catch { throw new Error(`${operation}: invalid response.`); }
};
export const machineLocalId = (id, machine) => machine && String(id).startsWith(`${machine}/`) ? String(id).slice(machine.length + 1) : id;
export const machineId = (id, machine) => machine ? `${machine}/${machineLocalId(id, machine)}` : id;
const machineStateWords = (state, name) => {
  switch (state) {
    case "connected": return `${name} is connected.`;
    case "needs_login": return `${name} needs you to sign in again.`;
    case "needs_update": return `${name} needs a herdr-core update.`;
    case "unreachable": return `${name} is unreachable.`;
    case "connecting": return `${name} is connecting.`;
    default: return `${name} is not connected.`;
  }
};
const machineFix = (state, name) => `hc machine ${state === "needs_update" ? "update" : "login"} ${name}`;
export function remoteFailure(error, machine) {
  const reason = String(error?.message ?? error);
  if (error?.machineNotice) return { ok: false, reason, machineNotice: error.machineNotice };
  // The machine can still say connected while an in-flight call loses its core. Give all callers
  // the same notice during that transition, preserving integrity and other actionable errors.
  if (typeof machine === "string" && MACHINE.test(machine)
    && /core (?:is stopping|stopped)|lost the line/i.test(reason)) {
    return { ok: false, retryable: true,
      reason: `${machine} lost its connection. Run hc machine login ${machine}, then retry. No local terminal was started.`,
      machineNotice: { machine, body: `Run hc machine login ${machine}. ${machine} lost its connection.` } };
  }
  return { ok: false, reason };
}
export function machineProblem(record, name) {
  if (!record) return `Herdr machine ${name} is not configured. Add it in Herdr's Add machine first.`;
  if (record.temporary !== false) return `${name} is temporary or its persistence is unknown. Add a persistent Herdr machine before opening seats.`;
  if (record.state !== "connected") return `${machineStateWords(record.state, name)} Run ${machineFix(record.state, name)}, then retry. No local terminal was started.`;
  return null;
}

export class RemoteMachine {
  constructor(host) { this.host = host; }
  async ready(name) {
    if (typeof name !== "string" || !MACHINE.test(name)) throw new Error("daemonMachine must name a Herdr machine (letters, digits, dot, underscore or hyphen; at most 32 characters).");
    const body = parse(await this.host.hc(["machine", "ls", "--json"]), "Read Herdr machines");
    const rows = Array.isArray(body) ? body : body.machines;
    const record = rows?.find((m) => m.name === name);
    const reason = machineProblem(record, name);
    if (reason) {
      const error = new Error(reason);
      if (record?.temporary === false && record.state !== "connected") error.machineNotice = {
        machine: name, body: `Run ${machineFix(record.state, name)}. ${machineStateWords(record.state, name)}`,
      };
      throw error;
    }
    for (let i = 0; i < 30; i++) {
      if (callList(this.host, "machines").some((m) => m.name === name && m.layout === "ready")) return record;
      if (!this.host.wait) break; await this.host.wait(100);
    }
    throw new Error(`${name}'s layout is not ready in Herdr. Wait for the machine to connect, then retry.`);
  }
  prepare(config, options = {}) {
    const machine = config.daemonMachine;
    const job = (preparations.get(machine) ?? Promise.resolve()).catch(() => {}).then(() => this.prepareExclusive(config, options));
    preparations.set(machine, job);
    return job.finally(() => { if (preparations.get(machine) === job) preparations.delete(machine); });
  }
  async prepareExclusive(config, { consent = null, install = true } = {}) {
    try {
      const host = this.host, machine = config.daemonMachine, record = await this.ready(machine);
      if (!isLoopbackDaemonUrl(config.daemonUrl)) throw new Error("Remote seats need the configured OpenRig loopback tunnel URL.");
      const remoteExec = (cmd, args) => host.exec(cmd, args, { on: machine, timeout: 15000 });
      const info = await remoteMetadata(remoteExec);
      const statusResult = await remoteExec("env", ["-i", `HOME=${info.home}`, `PATH=${info.searchPath}`, "rig", "status", "--json"]);
      parse(statusResult, `Read OpenRig status on ${machine}`);
      const status = parseDaemonStatusJson(statusResult.stdout);
      if (!status.reachable || !status.daemonUrl || !isLoopbackDaemonUrl(status.daemonUrl)) throw new Error(`OpenRig is not reachable on ${machine}. Check rig status on that machine.`);
      const localHealth = await host.health(config.daemonUrl);
      const remoteHealthResult = await remoteExec("curl", ["--disable", "--noproxy", "*", "--fail", "--silent", "--show-error", "--max-time", "5", "--max-redirs", "0", `${status.daemonUrl}/healthz`]);
      if (remoteHealthResult?.code !== 0) throw Object.assign(new Error(`OpenRig isn't answering on ${machine}. Check rig status on that machine and the daemon tunnel, then retry. No local terminal was started.`),
        { machineNotice: { machine, body: `Check rig status on ${machine}. OpenRig isn't answering on ${machine}.` } });
      const remoteHealth = parse(remoteHealthResult, `Check OpenRig on ${machine}`);
      if (!localHealth?.selfHostId || localHealth.selfHostId !== remoteHealth.selfHostId) throw new Error("The tunnel and selected Herdr machine do not report the same OpenRig host ID. Check daemonMachine and the tunnel destination.");
      const localNode = config.rig?.[0]?.match(/(?:^|\/)node$/) ? config.rig[0] : "node";
      const fileHelper = host.relayPath.replace(/rig-attach-relay\.cjs$/, "rig-remote-files.cjs");
      const shipped = parse(await host.exec(localNode, [fileHelper, "inspect"]), "Verify shipped relay");
      if (shipped.sha256 !== RELAY_SHA256) throw new Error("The relay hash does not match this release. Reinstall the mod.");
      const identity = { machine, target: record.target ?? "", id: record.id ?? "", via: record.via ?? "", session: record.session ?? "", home: info.home, daemonUrl: config.daemonUrl, selfHostId: localHealth.selfHostId };
      const key = JSON.stringify(identity);
      const stored = await host.readConsent();
      if (stored?.key !== key && consent?.key !== key) return { ok: false, needsConsent: true,
        confirmation: { key, machine, target: record.target || info.user, user: info.user, folder: info.path.slice(0, info.path.lastIndexOf("/")), sha256: RELAY_SHA256 },
        reason: `Confirm first use of ${machine} before opening seats there.` };
      if (consent && consent.key !== key) throw new Error("The machine changed since confirmation. Review its details again.");
      // Re-read availability after the asynchronous identity and consent checks, immediately before writes.
      const current = await this.ready(machine);
      if (JSON.stringify([current.target, current.id, current.via, current.session]) !== JSON.stringify([record.target, record.id, record.via, record.session])) throw new Error("The Herdr machine changed during preparation. Retry and review it again.");
      if (install && info.sha256 !== RELAY_SHA256) {
        const written = parse(await host.exec(localNode, [fileHelper, "install", machine, info.home]), `Install relay on ${machine}`);
        if (written.path !== info.path) throw new Error("Remote relay write returned an unexpected path.");
      }
      // Also covers unchanged relays and install:false. Never return a stale initial hash as readiness.
      const verify = async () => {
        const verified = await inspectRemote(remoteExec, info.home);
        if (verified.path !== info.path || verified.sha256 !== RELAY_SHA256) throw new Error("Remote relay verification failed. No terminal was started.");
      };
      await verify();
      if (consent && stored?.key !== key) { await host.writeConsent({ key }); await verify(); }
      return { ok: true, machine, node: info.node, relayPath: info.path, daemonUrl: status.daemonUrl, selfHostId: localHealth.selfHostId };
    } catch (e) { return remoteFailure(e, config.daemonMachine); }
  }
}
