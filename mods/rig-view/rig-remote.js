// The person's configured Herdr machine is the only remote authority. Daemon data never selects it.
import { isLoopbackDaemonUrl, parseDaemonStatusJson, differentDaemons, localDaemonOrigin } from "./rig-lib.js";
import { gateConfigGeneration } from "./rig-gate.js";
import { addMachineConnection, connectionsOf } from "./rig-connections.js";
// v0.4.7: the relay's content changed (the poll-storm fix: an in-flight guard, a fetch timeout, backoff and jitter);
// the person re-approves the new hook/hash once on update, as every relay change requires.
export const RELAY_SHA256 = "285a54561125c00964e607ce379bbbd5e7988dcdd768b61bd2daa9f9522f15ad";
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
// The setup gate's reads (rig status --json, healthz) are small, fixed-shape JSON; a 64KB cap is a sanity bound,
// not a real limit on either response. Over the cap REFUSES outright rather than truncating and parsing what's
// left: a truncated parse of untrusted remote output is its own small added risk.
const JSON_READ_CAP = 65536;
// The native mod runtime has no Buffer (rig-space-context.js says so): the size of a text in UTF-8 bytes, counted by hand.
export const utf8Length = (text) => { let n = 0; for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c < 0x80) n += 1; else if (c < 0x800) n += 2; else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3; } return n; };
const boundedParse = (result, operation, maxBytes = JSON_READ_CAP) => {
  if (result?.code === 0 && typeof result.stdout === "string" && utf8Length(result.stdout) > maxBytes) throw new Error(`${operation}: the response was too large to read safely.`);
  return parse(result, operation);
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
  /** Read-only identity check shared by detection and home TUI opens. No relay installation or consent writes. */
  async readIdentity(config, { defaultHome = false } = {}) {
    const host=this.host,machine=config.daemonMachine,record=await this.ready(machine);
    if(!config.daemonUrl||!isLoopbackDaemonUrl(config.daemonUrl))throw new Error("Remote seats need the configured OpenRig loopback tunnel URL.");
    const remoteExec=(cmd,args)=>host.exec(cmd,args,{on:machine,timeout:15000});
    const info=await remoteMetadata(remoteExec);
    // The machine's DEFAULT OpenRig, always: a connection's `openrigHome` is a folder on THIS computer (the local CLI's OPENRIG_HOME), never sent to a
    // machine. v0.5.0 supports one OpenRig per added machine; two on one machine would need a home on the machine itself.
    // `defaultHome` (the spec helper's caller) is kept for its callers and means the same now.
    void defaultHome;
    const statusResult=await remoteExec("env",["-i",`HOME=${info.home}`,`PATH=${info.searchPath}`,"rig","status","--json"]);
    parse(statusResult,`Read OpenRig status on ${machine}`);
    const status=parseDaemonStatusJson(statusResult.stdout);
    if(!status.reachable||!status.daemonUrl||!isLoopbackDaemonUrl(status.daemonUrl))throw new Error(`OpenRig is not reachable on ${machine}. Check rig status on that machine.`);
    const localHealth=await host.health(config.daemonUrl);
    const remoteHealthResult=await remoteExec("curl",["--disable","--noproxy","*","--fail","--silent","--show-error","--max-time","5","--max-redirs","0",`${status.daemonUrl}/healthz`]);
    if(remoteHealthResult?.code!==0)throw Object.assign(new Error(`OpenRig isn't answering on ${machine}. Check rig status on that machine and the daemon tunnel, then retry. No local terminal was started.`),
      {machineNotice:{machine,body:`Check rig status on ${machine}. OpenRig isn't answering on ${machine}.`}});
    const remoteHealth=parse(remoteHealthResult,`Check OpenRig on ${machine}`);
    const current=await this.ready(machine);
    if(JSON.stringify([current.target,current.id,current.via,current.session])!==JSON.stringify([record.target,record.id,record.via,record.session]))throw new Error("The Herdr machine changed during preparation. Retry and review it again.");
    return {record,info,status,localHealth,remoteHealth,remoteExec};
  }
  async home(config) {
    try {
      const {record,info,status,localHealth,remoteHealth}=await this.readIdentity(config);
      if(!localHealth?.selfHostId||localHealth.selfHostId!==remoteHealth.selfHostId)throw new Error("The tunnel and selected Herdr machine do not report the same OpenRig host ID. Check daemonMachine and the tunnel destination.");
      if(differentDaemons(localHealth,remoteHealth))throw new Error(`The tunnel and selected Herdr machine reach two different OpenRigs that share host ID ${localHealth.selfHostId}. Check daemonMachine and the tunnel destination.`); // a host.name-seeded id can be shared on one machine
      return {ok:true,machine:config.daemonMachine,profileId:record.id??record.name,home:info.home,searchPath:info.searchPath,daemonUrl:status.daemonUrl,selfHostId:localHealth.selfHostId,...(localHealth.selfHostIdSource?{selfHostIdSource:localHealth.selfHostIdSource}:{})};
    }catch(error){return remoteFailure(error,config.daemonMachine);}
  }
  /** Full setup checks without installing the helper or persisting an approval. */
  review(config) { return this.prepare(config,{review:true}); }
  async prepareExclusive(config, { consent = null, install = true, review = false, onProgress = null } = {}) {
    try {
      const host=this.host,machine=config.daemonMachine;
      const {record,info,status,localHealth,remoteHealth,remoteExec}=await this.readIdentity(config);
      if(!localHealth?.selfHostId||localHealth.selfHostId!==remoteHealth.selfHostId)throw new Error("The tunnel and selected Herdr machine do not report the same OpenRig host ID. Check daemonMachine and the tunnel destination.");
      if(differentDaemons(localHealth,remoteHealth))throw new Error(`The tunnel and selected Herdr machine reach two different OpenRigs that share host ID ${localHealth.selfHostId}. Check daemonMachine and the tunnel destination.`); // a host.name-seeded id can be shared on one machine
      const localNode = config.rig?.[0]?.match(/(?:^|\/)node$/) ? config.rig[0] : "node";
      const fileHelper = host.relayPath.replace(/rig-attach-relay\.cjs$/, "rig-remote-files.cjs");
      const shipped = parse(await host.exec(localNode, [fileHelper, "inspect"]), "Verify shipped relay");
      if (shipped.sha256 !== RELAY_SHA256) throw new Error("The relay hash does not match this release. Reinstall the mod.");
      const identity = { machine, target: record.target ?? "", id: record.id ?? "", via: record.via ?? "", session: record.session ?? "", home: info.home, daemonUrl: config.daemonUrl, selfHostId: localHealth.selfHostId };
      const key = JSON.stringify({ ...identity, sha256: RELAY_SHA256 });
      const stored = await host.readConsent();
      const confirmation={key,machine,target:record.target||info.user,user:info.user,folder:info.path.slice(0,info.path.lastIndexOf("/")),
        sha256:RELAY_SHA256,fileState:!info.sha256?"missing":info.sha256===RELAY_SHA256?"same":"older",
        profileId:record.id??record.name,selfHostId:localHealth.selfHostId,origin:config.daemonUrl};
      if(review)return {ok:true,confirmation,approved:stored?.key===key};
      if (stored?.key !== key && consent?.key !== key) return { ok: false, needsConsent: true,
        confirmation,
        reason: `${machine} needs your approval before seats open there.` };
      if (consent && consent.key !== key) throw new Error("The machine changed since confirmation. Review its details again.");
      // Re-read availability after the asynchronous identity and consent checks, immediately before writes.
      const current = await this.ready(machine);
      if (JSON.stringify([current.target, current.id, current.via, current.session]) !== JSON.stringify([record.target, record.id, record.via, record.session])) throw new Error("The Herdr machine changed during preparation. Retry and review it again.");
      if (install && info.sha256 !== RELAY_SHA256) {
        onProgress?.("install");
        const written = parse(await host.exec(localNode, [fileHelper, "install", machine, info.home]), `Install relay on ${machine}`);
        if (written.path !== info.path) throw new Error("Remote relay write returned an unexpected path.");
      }
      // Also covers unchanged relays and install:false. Never return a stale initial hash as readiness.
      const verify = async () => {
        const verified = await inspectRemote(remoteExec, info.home);
        if (verified.path !== info.path || verified.sha256 !== RELAY_SHA256) throw new Error("Remote relay verification failed. No terminal was started.");
      };
      onProgress?.("verify");await verify();
      if (consent && stored?.key !== key) { await host.writeConsent({ key }); await verify(); }
      return { ok: true, machine, node: info.node, relayPath: info.path, daemonUrl: status.daemonUrl, selfHostId: localHealth.selfHostId };
    } catch (e) { return remoteFailure(e, config.daemonMachine); }
  }
}

/** A read-only offer, never an implicit routing decision. Only connected persistent profiles are probed. */
export async function detectDaemonMachine(host,config) {
  if(config?.daemonMachine||!config?.daemonUrl||!isLoopbackDaemonUrl(config.daemonUrl))return null;
  const body=parse(await host.hc(["machine","ls","--json"]),"Read Herdr machines");
  const rows=Array.isArray(body)?body:body.machines,matches=[];
  for(const record of rows??[]){
    if(record.temporary!==false||record.state!=="connected"||!MACHINE.test(record.name??""))continue;
    const checked=await new RemoteMachine(host).home({...config,daemonMachine:record.name});
    if(checked.ok)matches.push({machine:record.name,profileId:checked.profileId,selfHostId:checked.selfHostId,
      key:JSON.stringify([checked.profileId,checked.selfHostId])});
  }
  return matches.length===1?matches[0]:null;
}

/** The "add a machine" offer: does OpenRig run on this ALREADY-CONNECTED Herdr machine at all, with no existing
 *  tunnel or daemonUrl to compare against (unlike `detectDaemonMachine`, which identifies the EXISTING primary
 *  connection's own machine)? Read-only: no relay install, no consent write, and no local health check, since there
 *  is no local connection yet to check it against. `machineName` must be the caller's own already-filtered Herdr
 *  machine-list entry (connected, persistent) -- never a name read back from daemon or discovery output -- so this
 *  never probes a machine the person did not already have connected in Herdr. */
export async function detectMachineOpenRig(host, machineName) {
  if (typeof machineName !== "string" || !MACHINE.test(machineName)) return null;
  try {
    const remoteExec = (cmd, args) => host.exec(cmd, args, { on: machineName, timeout: 15000 });
    const info = await remoteMetadata(remoteExec);
    const statusResult = await remoteExec("env", ["-i", `HOME=${info.home}`, `PATH=${info.searchPath}`, "rig", "status", "--json"]);
    boundedParse(statusResult, `Read OpenRig status on ${machineName}`);
    const status = parseDaemonStatusJson(statusResult.stdout);
    if (!status.reachable || !status.daemonUrl || !isLoopbackDaemonUrl(status.daemonUrl)) return null;
    const healthResult = await remoteExec("curl", ["--disable", "--noproxy", "*", "--fail", "--silent", "--show-error", "--max-time", "5", "--max-redirs", "0", `${status.daemonUrl}/healthz`]);
    const health = boundedParse(healthResult, `Check OpenRig on ${machineName}`);
    if (typeof health?.selfHostId !== "string" || !health.selfHostId) return null;
    const portMatch = String(status.daemonUrl).match(/^https?:\/\/[^/:?#]+:(\d{1,5})(?:[/?#]|$)/i), port = portMatch ? portMatch[1] : null; // no `URL`: the Herdr mod runtime has none
    return { machine: machineName, daemonUrl: status.daemonUrl, selfHostId: health.selfHostId, port };
  } catch (_) { return null; }
}

/** The offer for ONE machine, called once per connected machine that has no connection (never in a loop, never from daemon data):
 *  only a machine Herdr lists as persistent and connected is probed, and only its name from that list is used. Returns
 *  `{ machine, target, session, found }` where `found` is detectMachineOpenRig's answer (or null when nothing answered there), or
 *  null when Herdr does not list it as a connected persistent machine (nothing is run on it then). Read-only. */
export async function offerForMachine(host, machineName) {
  if (typeof machineName !== "string" || !MACHINE.test(machineName)) return null;
  let record;
  try {
    const body = boundedParse(await host.hc(["machine", "ls", "--json"]), "Read Herdr machines");
    record = (Array.isArray(body) ? body : body.machines)?.find((m) => m?.name === machineName);
  } catch (_) { return null; }
  if (!record || record.temporary !== false || record.state !== "connected") return null;
  return { machine: machineName, target: record.target ?? null, session: record.session ?? null, found: await detectMachineOpenRig(host, machineName) };
}

/** The machines "Add a machine…" may offer: those Herdr lists as persistent and connected, with a name of the safe shape, that have no connection yet
 *  (`taken` is the machine names already used). Read from Herdr's own list only; each carries the {target, session} the gate pins. */
export async function listAddableMachines(host, taken = []) {
  const body = boundedParse(await host.hc(["machine", "ls", "--json"]), "Read Herdr machines");
  const rows = Array.isArray(body) ? body : body?.machines;
  if (!Array.isArray(rows)) return [];
  const used = new Set(taken.filter((n) => typeof n === "string"));
  return rows.filter((m) => m && typeof m.name === "string" && MACHINE.test(m.name) && m.temporary === false && m.state === "connected" && !used.has(m.name))
    .map((m) => ({ name: m.name, target: m.target ?? null, session: m.session ?? null }));
}

/** The Herdr machine record the setup gate pins at open: name plus `target` and `session` when present, read only
 *  from Herdr's own machine list (`hc machine ls --json`), never from config or daemon data. */
async function herdrMachineRecord(host, machineName) {
  const body = boundedParse(await host.hc(["machine", "ls", "--json"]), "Read Herdr machines");
  const rows = Array.isArray(body) ? body : body.machines;
  const record = rows?.find((m) => m?.name === machineName);
  return record ? { target: record.target ?? null, session: record.session ?? null } : null;
}
const sameMachineRecord = (a, b) => Boolean(a && b) && a.target === b.target && a.session === b.session;

// One key per loopback ADDRESS, so spellings of it compare equal: localhost, 127.0.0.1, [::1] and 0.0.0.0 with the same
// scheme and port are one address; any other loopback (127.0.0.4) stays its own.
const addressKey = (value) => {
  const origin = localDaemonOrigin(value) ?? String(value);
  const m = /^(https?):\/\/(\[[^\]]+\]|[^:/]+)(?::(\d+))?$/i.exec(origin);
  if (!m) return origin;
  const host = m[2].toLowerCase(), alias = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(host);
  return `${m[1].toLowerCase()}|${alias ? "loopback" : host}|${m[3] ?? (m[1].toLowerCase() === "https" ? "443" : "80")}`;
};
/** The only commands the add-a-machine screen and the sidebar's offer run ON a machine that has no connection yet (so no gate scope can name it): the fixed,
 *  read-only checks of `detectMachineOpenRig` and nothing else. Each argument list must be exactly one of those shapes, and the machine must be the one it
 *  was made for; anything else is refused before it reaches Herdr. Used in place of a connection's gated exec, which refuses another machine by design. */
const PROBE_CURL = ["--disable", "--noproxy", "*", "--fail", "--silent", "--show-error", "--max-time", "5", "--max-redirs", "0"];
const PROBE_PATH = /^\/[^\x00-\x1f\x7f]*$/, PROBE_VALUE = /^[^\x00-\x1f\x7f]+$/;
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
export function machineProbeExec(rawExec, machine) {
  if (typeof machine !== "string" || !MACHINE.test(machine)) throw new Error("machineProbeExec needs a Herdr machine name.");
  return async (command, args, options) => {
    const a = Array.isArray(args) ? args : [];
    if (options?.on !== machine) throw new Error(`This screen only runs its checks on ${machine}.`);
    const allowed = (command === "printenv" && a.length === 1 && (a[0] === "HOME" || a[0] === "PATH"))
      || (command === "id" && sameList(a, ["-un"]))
      || (command === "which" && sameList(a, ["node"]))
      || (command === "readlink" && a.length === 3 && a[0] === "-f" && a[1] === "--" && PROBE_PATH.test(a[2]))
      || (command === "test" && a.length === 2 && ["-d", "-e", "-f", "-L"].includes(a[0]) && PROBE_PATH.test(a[1]))
      || (command === "sha256sum" && a.length === 2 && a[0] === "--" && PROBE_PATH.test(a[1]))
      || (command === "env" && a.length === 6 && a[0] === "-i" && /^HOME=/.test(a[1]) && PROBE_VALUE.test(a[1]) && /^PATH=/.test(a[2]) && PROBE_VALUE.test(a[2]) && sameList(a.slice(3), ["rig", "status", "--json"]))
      || (command === "curl" && a.length === PROBE_CURL.length + 1 && sameList(a.slice(0, PROBE_CURL.length), PROBE_CURL) && localDaemonOrigin(a.at(-1).slice(0, -"/healthz".length)) === a.at(-1).slice(0, -"/healthz".length));
    if (!allowed) throw new Error("This screen only runs its fixed read-only checks on a machine.");
    return rawExec(command, [...a], { on: machine, timeout: 15000 });
  };
}

/** The one local request the add-a-machine screen makes (what `host.setupFetch` must be): a plain GET of `<loopback origin>/healthz`
 *  and nothing else. It takes the raw fetch, never a connection's gated one (a new machine has no scope yet), and it sends no headers, so no
 *  bearer and no cookie can go with it. It reaches only the origin it was given (loopback, no credentials in the address, no other path or query)
 *  and gives up after `timeoutMs`. Whatever the caller passes as `init` is ignored.
 *
 *  What the Herdr mod runtime really is (native probe, official herdr-app 0.1.15, 2026-11-16): `fetch(url, options)` takes ONLY `method`, `headers`
 *  and `body` and throws `unknown option` for anything else (so no `redirect`, `credentials` or `signal`); it DOES follow a redirect (measured: a 302 to
 *  another address answered 200 with `url` set to the final address), so a redirect is caught by comparing the answer's `url` with the one asked for; the
 *  answer has `ok`, `status`, `url`, `text()` and `json()` and no headers or stream. There is no
 *  AbortSignal, AbortController, TextDecoder or TextEncoder. So: the options are `{ method: "GET" }` alone; the limit is a timer from `after(ms, fn)`
 *  (cx.timer.after) that bounds the request AND the reading of the body, and the host hands the body over whole, so the cap is applied to the text
 *  before anything parses it. A request that was made and failed (refused, timed out) is a `NO_ANSWER` error; anything else that throws is a real
 *  failure and stays one, so it is never shown as "nothing answers". */
const noAnswer = (message) => Object.assign(new Error(message), { code: "NO_ANSWER" });
export function loopbackHealthFetch(rawFetch, after, timeoutMs = 5000) {
  if (typeof after !== "function") throw new Error("loopbackHealthFetch needs a timer (cx.timer.after).");
  return async (url) => {
    const match = String(url).match(/^(.+)\/healthz$/), origin = match ? localDaemonOrigin(match[1]) : "";
    if (!origin) throw new Error("Only a loopback address's /healthz can be read from here.");
    return new Promise((resolve, reject) => {
      let settled = false, timer = null;
      const finish = (fn, value) => { if (settled) return; settled = true; try { timer?.cancel?.(); } catch (_) {} fn(value); };
      timer = after(timeoutMs, () => finish(reject, noAnswer("The address did not answer in time.")));
      const attempt = async () => {
        let response;
        try { response = await rawFetch(`${origin}/healthz`, { method: "GET" }); }
        catch (_) { throw noAnswer("The address did not answer."); } // the request WAS made and failed (a refused connection): nothing answers there
        // The runtime follows redirects and reports the final address: an answer that did not come from the address asked for is not used (no redirects).
        if (response?.url !== `${origin}/healthz`) throw new Error("That address redirected to another address, so it was not used.");
        if (!response?.ok) return { ok: false, status: response?.status ?? 0, text: async () => { throw noAnswer("The address did not answer."); } };
        const text = await response.text();
        if (utf8Length(text) > JSON_READ_CAP) throw new Error("The answer is too large.");
        return { ok: true, status: response.status, text: async () => text };
      };
      attempt().then((value) => finish(resolve, value), (error) => finish(reject, error));
    });
  };
}

/** The interactive setup screen: one gate per open screen. It exposes exactly one
 *  operation -- `checkIdentity()`, `detectMachineOpenRig`'s own fixed call sequence and nothing else, no generic
 *  exec/fetch/hc passthrough -- against ONE machine name captured once at open from the person's own pick in
 *  Herdr's machine list (never re-derived from a detection result or any daemon/discovery output).
 *
 * Every call rechecks, in order: (1) the gate hasn't expired; (2) the whole config hasn't been reassigned since
 * open (`gateConfigGeneration()`, a bare over-invalidating counter: a new connection has no scope of its own to
 * key a finer generation to); (3) the SAME Herdr machine record still backs this name (not just the name: a name
 * can be forgotten and re-added for a different host, target or session). `checkIdentity()` rechecks again after
 * its async round trip, immediately before returning, so a change mid-check is caught either side of the await.
 *
 * `expire()` must be called on save, on cancel, AND on the setup view unmounting: every method
 * called after it throws, so a gate kept alive by a stale closure or timer can never be replayed. */
export function machineSetupGate(host, machineName, picked = null) {
  if (typeof machineName !== "string" || !MACHINE.test(machineName)) throw new Error("machineSetupGate needs a Herdr machine name.");
  const generation = gateConfigGeneration();
  // `picked` is the {target, session} of the Herdr list row the person chose. With it, the record is pinned AT PICK
  // TIME and compared from the very first call; without it, the first call pins it (a machine removed and re-added
  // between the pick and the first check would then be pinned silently).
  let expired = false, record = picked ? { target: picked.target ?? null, session: picked.session ?? null } : null, lastChecked = null, tunnel = null;
  const recheck = async () => {
    if (expired) throw new Error("This setup check has expired. Reopen the machine setup screen.");
    if (gateConfigGeneration() !== generation) throw new Error("OpenRig's settings changed while this was open. Reopen it and check again.");
    const current = await herdrMachineRecord(host, machineName);
    if (!current) throw new Error(`${machineName} is no longer in Herdr's machine list. Reopen the setup screen.`);
    if (record === null) record = current;
    else if (!sameMachineRecord(record, current)) throw new Error(`${machineName} was removed and re-added in Herdr while this was open. Reopen it and check again.`);
  };
  // The gate's one local operation: a plain GET of <origin>/healthz (no bearer, redirect manual, the 64KB refusal), through
  // host.setupFetch only. Used for the person's tunnel and, read-only, for an existing connection's id (never a send of anything).
  const readHealthz = async (origin) => {
    const nothing = () => new Error(`Nothing answers at ${origin.replace(/^https?:\/\//, "")}. Start the tunnel (the command below), then check again.`);
    let text;
    try {
      const response = await host.setupFetch(`${origin}/healthz`, { redirect: "manual", method: "GET" });
      if (!response?.ok) throw nothing();
      text = await response.text();
    } catch (error) {
      if (error?.code === "NO_ANSWER" || error?.message?.startsWith("Nothing answers at")) throw nothing();
      throw new Error(`Herdr couldn't check ${origin.replace(/^https?:\/\//, "")}: ${String(error?.message ?? error)}`); // a real failure is shown as one, never as "nothing answers"
    }
    if (utf8Length(text) > JSON_READ_CAP) throw new Error(`${origin.replace(/^https?:\/\//, "")} answered with more than OpenRig's health ever holds.`);
    try { return JSON.parse(text); } catch (_) { throw new Error(`${origin.replace(/^https?:\/\//, "")} answered, but not like an OpenRig.`); }
  };
  return {
    /** The box side: does OpenRig run on this machine, and which host is it. `lastChecked.daemonUrl` is the BOX's own
     *  loopback address, meaningful only on the box (the remote curl); it is never a local address and is never saved. */
    async checkIdentity() {
      await recheck();
      const result = await detectMachineOpenRig(host, machineName);
      await recheck();
      lastChecked = result;
      tunnel = null; // a new box-side check invalidates an earlier tunnel check
      return result;
    },
    /** This computer's side ([Check]): reads /healthz THROUGH the tunnel address the person gave and
     *  requires its selfHostId to equal the machine's own. This gate's one extra fixed operation: a plain GET of
     *  `<address>/healthz` (no bearer, redirect: manual, the same 64KB refusal), through `host.setupFetch`, and only
     *  to a loopback address. Returns the checked {address, selfHostId}; throws the two refusal lines the screen shows. */
    async checkTunnel(address) {
      if (!lastChecked) throw new Error("Check the machine before checking the tunnel.");
      const origin = localDaemonOrigin(address);
      if (!origin) throw new Error("The tunnel address must be a loopback address on this computer, such as http://127.0.0.1:7434.");
      if (typeof host.setupFetch !== "function") throw new Error("Herdr cannot check the tunnel from here.");
      await recheck();
      const health = await readHealthz(origin);
      await recheck();
      const id = typeof health?.selfHostId === "string" ? health.selfHostId : "";
      if (!id || id !== lastChecked.selfHostId) throw new Error(`That address reaches a different OpenRig${id ? ` (host ${id})` : ""}, not ${machineName}'s. Check the tunnel's destination.`);
      tunnel = { address: origin, selfHostId: id };
      return { ...tunnel };
    },
    /** The exact checked identity this gate last saw. null until `checkIdentity()` has succeeded at least once. */
    checked() { return lastChecked; },
    tunnelChecked() { return tunnel ? { ...tunnel } : null; },
    expired() { return expired; },
    expire() { expired = true; },
    /** Saves the connection as a compare-and-swap write. It saves ONLY what `checkTunnel` verified:
     *  the person's tunnel address exactly as checked, with `expectedHostId` the id that check read, never the box-side
     *  address and never a fresh read. Refuses an address any existing connection already uses. Rechecks (expiry, config
     *  generation, machine record) right before writing, then expires the gate on success. */
    async save(before, { openrigHome, liveConfig } = {}) {
      if (!lastChecked || !tunnel) throw new Error("Check the machine and its tunnel before adding it.");
      // Required, so a caller that forgets it fails CLOSED: without the live (CLI-enriched) config a primary the CLI found is invisible here.
      if (!liveConfig || typeof liveConfig !== "object" || Array.isArray(liveConfig)) throw new Error("Saving needs this computer's live OpenRig settings, and none were given. Nothing was saved.");
      let raw = {};
      try { raw = before ? JSON.parse(before) : {}; } catch (_) { throw new Error("openrig/config.json is not valid JSON."); }
      const existing = [...connectionsOf(raw).connections];
      // The caller's LIVE config (CLI-enriched): a primary whose address the CLI found (a default install, no daemonUrl in the file)
      // is not in `before`, but it is still an OpenRig this one must not be mistaken for. Its address and live id are compared too.
      {
        const live = [liveConfig.daemonUrl, ...(Array.isArray(liveConfig.connections) ? liveConfig.connections.map((c) => c?.daemonUrl) : [])];
        for (const daemonUrl of live) if (typeof daemonUrl === "string" && daemonUrl && !existing.some((c) => c.daemonUrl === daemonUrl)) existing.push({ id: null, daemonUrl, expectedHostId: null });
      }
      // The address: loopback spellings of one address are one address (localhost, 127.0.0.1, [::1], 0.0.0.0 with the same
      // scheme and port; 127.0.0.4 stays distinct). Over-matching only refuses, the safe direction.
      const key = addressKey(tunnel.address);
      for (const c of existing) if (c.daemonUrl && addressKey(c.daemonUrl) === key) throw new Error("That address is already used by another OpenRig connection. Use a different tunnel address.");
      // The tunnel must still be what [Check] saw: re-read it right before the write (a tunnel re-pointed between [Check] and [Add]).
      const again = await readHealthz(tunnel.address);
      if (again?.selfHostId !== tunnel.selfHostId) throw new Error(`That address now reaches a different OpenRig${typeof again?.selfHostId === "string" ? ` (host ${again.selfHostId})` : ""}. Check the tunnel again.`);
      // The host id: two of the person's OpenRigs that report the same id cannot be told apart, so nothing is saved under it.
      // Existing ids are the stored expectedHostId, else the connection's live /healthz when it is a loopback address we can read.
      for (const c of existing) {
        let id = c.expectedHostId;
        if (!id && c.daemonUrl && localDaemonOrigin(c.daemonUrl)) { try { id = (await readHealthz(localDaemonOrigin(c.daemonUrl)))?.selfHostId; } catch (_) { id = null; } }
        if (id && id === tunnel.selfHostId) throw new Error(`Two of your OpenRigs report the same host id (${id}), so Herdr can't tell them apart. Give one a different host.name, then add it again.`);
      }
      await recheck();
      const saved = await addMachineConnection(host, before, {
        machine: machineName, daemonUrl: tunnel.address, expectedHostId: tunnel.selfHostId, openrigHome, legacyDaemonUrl: liveConfig.daemonUrl,
      });
      expired = true;
      return saved;
    },
  };
}
