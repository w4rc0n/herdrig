import { errorDiagnostic } from "./rig-words.js";
// The person's configured Herdr machine is the only remote authority. Daemon data never selects it.
import { isLoopbackDaemonUrl, parseDaemonStatusJson, differentDaemons, parseDaemonHostJson, sameDaemon, cliEnv } from "./rig-lib.js";
import { gateConfigGeneration } from "./rig-gate.js";
import { localDaemonOrigin, addressKey, addMachineConnection, addLocalConnection, connectionsOf, LOCAL_ALREADY_CONNECTED, localTaken, CONFIG_LIST_INVALID, openrigHomeProblem, isCodeError, CONFIG_NOT_JSON, parseExecTimeout, describeExecTimeout, logExecError, plainExecError } from "./rig-connections.js";
// v0.4.7: the relay's content changed (the poll-storm fix: an in-flight guard, a fetch timeout, backoff and jitter);
// the person re-approves the new hook/hash once on update, as every relay change requires.
export const RELAY_SHA256 = "285a54561125c00964e607ce379bbbd5e7988dcdd768b61bd2daa9f9522f15ad";
const MACHINE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
// Attach and every rig space create separate callers. Serialize the whole preparation across them;
// each queued caller still rechecks its own config, consent, profile and bytes instead of sharing readiness.
const preparations = new Map();
// The longest one preparation holds the queue for the next caller. A slow or stuck job (a busy machine answers each remote
// call in 0.3-0.7 s, and a preparation makes about 45) never keeps every later Attach and space open waiting behind it.
export const PREPARE_HOLD_MS = 60000;
// Metadata is read with fixed executable/argv calls; no shell or remotely evaluated source.
export const goodHome = (s) => typeof s === "string" && s.startsWith("/") && s !== "/" && !/[\x00-\x1f\x7f]/.test(s) && s.split("/").slice(1).every((p) => p && p !== "." && p !== "..");
// The helper on a machine is not the copy herdrig installed (hash or path differs): said the same wherever it is found.
const HELPER_NOT_OURS = (at) => `herdrig's helper on ${at} isn't the copy it installed, so nothing was started. Attach again to reinstall it.`;
const line = (value) => String(value ?? "").replace(/\r?\n$/, "");
export async function inspectRemote(run, expectedHome = null, machine = null) {
  const at = machine ?? "the machine";
  const output = async (cmd, args) => {
    const result = await run(cmd, args);
    if (result?.code !== 0) throw new Error(result?.stderr || `A check on ${at} didn't work (${cmd} failed). Nothing was started.`);
    return line(result.stdout);
  };
  const test = async (flag, file) => {
    const result = await run("test", [flag, file]);
    if (result?.code !== 0 && result?.code !== 1) throw new Error(result?.stderr || `herdrig couldn't check its folder on ${at}. Nothing was started.`);
    return result.code === 0;
  };
  const home = await output("printenv", ["HOME"]);
  if (!goodHome(home) || (expectedHome !== null && home !== expectedHome)) throw new Error(`${at}'s home folder isn't the one herdrig set up, so nothing was started. If the account changed, approve ${at} again.`);
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
        if (!/^[a-f0-9]{64} [ *]/.test(hash)) throw new Error(HELPER_NOT_OURS(at));
        sha256 = hash.slice(0, 64);
      }
    }
  }
  return { home, path: current, sha256 };
}
export async function remoteMetadata(run, machine = null) {
  const at = machine ?? "the machine";
  const info = await inspectRemote(run, null, machine);
  const read = async (cmd, args) => {
    const r = await run(cmd, args);
    if (r?.code !== 0) throw new Error(r?.stderr || `A check on ${at} didn't work (${cmd} failed). Nothing was started.`);
    return line(r.stdout);
  };
  const node = await read("which", ["node"]), user = await read("id", ["-un"]), searchPath = await read("printenv", ["PATH"]);
  if (!goodHome(node) || !user || /[\x00-\x1f\x7f]/.test(user) || !searchPath || /[\x00-\x1f\x7f]/.test(searchPath)) throw new Error(`herdrig couldn't find Node or the user account on ${at}, so nothing was started. Check that Node is installed there.`);
  return { ...info, node, user, searchPath };
}
const callList = (host, key) => typeof host[key] === "function" ? host[key]() ?? [] : host[key] ?? [];
// `what` is the thing that was being done, in words ("list Herdr's machines"): what happened, then what it said, never a function name.
const firstLineOf = (text) => String(text ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
const parse = (result, what) => {
  if (result?.code !== 0) { const said = firstLineOf(result?.stderr); throw new Error(`Couldn't ${what} (${said ? `it said: ${said}` : "it gave no reason"}).`); }
  try { return JSON.parse(result.stdout); } catch { throw new Error(`Couldn't ${what}: the answer couldn't be read.`); }
};
// The setup gate's reads (rig status --json, healthz) are small, fixed-shape JSON; a 64KB cap is a sanity bound,
// not a real limit on either response. Over the cap REFUSES outright rather than truncating and parsing what's
// left: a truncated parse of untrusted remote output is its own small added risk.
const JSON_READ_CAP = 65536;
// The native mod runtime has no Buffer (rig-space-context.js says so): the size of a text in UTF-8 bytes, counted by hand.
export const utf8Length = (text) => { let n = 0; for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c < 0x80) n += 1; else if (c < 0x800) n += 2; else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3; } return n; };
const boundedParse = (result, operation, maxBytes = JSON_READ_CAP) => {
  if (result?.code === 0 && typeof result.stdout === "string" && utf8Length(result.stdout) > maxBytes) throw new Error(`Couldn't ${operation}: the answer was too large to read safely.`);
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
export function remoteFailure(error, machine, { attach = false } = {}) {
  const reason = errorDiagnostic(error);
  if (error?.machineNotice) return { ok: false, reason, machineNotice: error.machineNotice };
  const timeout = parseExecTimeout(error);
  if (timeout) {
    logExecError(error);
    return {
      ok: false,
      retryable: true,
      execTimeout: { seconds: timeout.seconds, machine: timeout.machine ?? machine ?? null },
      reason: describeExecTimeout(error, { machine, kind: attach ? "attach" : "remote" }),
    };
  }
  // The machine can still say connected while an in-flight call loses its core. Give all callers
  // the same notice during that transition, preserving integrity and other actionable errors.
  if (typeof machine === "string" && MACHINE.test(machine)
    && /core (?:is stopping|stopped)|lost the line/i.test(reason)) {
    return { ok: false, retryable: true,
      reason: `${machine} lost its connection. Run hc machine login ${machine}, then retry. No local terminal was started.`,
      machineNotice: { machine, body: `Run hc machine login ${machine}. ${machine} lost its connection.` } };
  }
  return { ok: false, reason: plainExecError(error, { machine, kind: attach ? "attach" : "remote" }) };
}
export function machineProblem(record, name) {
  if (!record) return `Herdr machine ${name} is not configured. Add it in Herdr's Add machine first.`;
  if (record.temporary !== false) return `${name} is temporary or its persistence is unknown. Add a persistent Herdr machine before opening seats.`;
  if (record.state !== "connected") return `${machineStateWords(record.state, name)} Run ${machineFix(record.state, name)}, then retry. No local terminal was started.`;
  return null;
}

/** A connection over Herdr's connection (herdr://<machine>/<hostId>) for this connection's own machine: the host id it recorded, else null. */
export function herdrIdentityOf(config){
  const m=/^herdr:\/\/([a-z0-9][a-z0-9._-]{0,31})\/([A-Za-z0-9._:-]{1,128})$/.exec(String(config?.daemonUrl??""));
  if(!m||m[1]!==config?.daemonMachine)return null;
  if(config.expectedHostId&&config.expectedHostId!==m[2])return null; // the record and the address disagree: not this connection's identity
  return {machine:m[1],hostId:m[2]};
}
const shortHostId=(id)=>`${String(id??"").slice(0,4)}…`;
/** The sentence for a machine whose OpenRig isn't the one this connection is for. */
function identityMismatch(config,local,remote){
  if(local?.recorded)return `${config.daemonMachine} now answers as another OpenRig (host ${shortHostId(remote?.selfHostId)}) than this connection was set up for (host ${shortHostId(local.selfHostId)}), so nothing was started. Switch back to the tunnel, or set this connection up again.`;
  return "The tunnel and selected Herdr machine do not report the same OpenRig host ID. Check daemonMachine and the tunnel destination.";
}

export class RemoteMachine {
  constructor(host) { this.host = host; }
  /** Names what the preparation is doing now (an Attach that takes long says it), and stops it once its caller gave up. */
  step(words) { this.stopIfCancelled(); this.host.onStep?.(words); }
  stopIfCancelled() { if (this.host.cancelled?.()) throw Object.assign(new Error("Stopped: the request took too long. Nothing was started."), { cancelled: true }); }
  async ready(name) {
    if (typeof name !== "string" || !MACHINE.test(name)) throw new Error("daemonMachine must name a Herdr machine (letters, digits, dot, underscore or hyphen; at most 32 characters).");
    const body = parse(await this.host.hc(["machine", "ls", "--json"]), "list Herdr's machines");
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
    const before = preparations.get(machine);
    if (before) this.host.onStep?.(`waiting for another check of ${machine} to finish`);
    const waitBefore = before
      ? (this.host.waitQueue ? this.host.waitQueue(() => before.settled) : before.settled)
      : Promise.resolve();
    // A queue release can drain under the previous caller's closing view.
    // Dialog hosts settle waitQueue inside their own view's callback instead.
    const job = waitBefore.then(() => this.prepareExclusive(config, options));
    let prevRef = before, rawRelease;
    const released = new Promise((r) => { rawRelease = r; });
    const unregister = this.host.registerBarrier?.(rawRelease);
    const cleanup = () => { prevRef = null; unregister?.(); };
    const release = () => { const p = prevRef; cleanup(); p?.release?.(); rawRelease(); };
    const baseSettled = Promise.race([job.catch(() => {}), released]).finally(cleanup);
    // The next caller waits for this job, or PREPARE_HOLD_MS at most (ownerless when available so a gone view still releases the queue).
    const holdTimer = this.host.deadline ?? this.host.wait;
    const entry = { settled: holdTimer ? Promise.race([baseSettled, holdTimer(PREPARE_HOLD_MS)]) : baseSettled, release };
    preparations.set(machine, entry);
    const clear = () => { if (preparations.get(machine) === entry) preparations.delete(machine); };
    // Owner release or the independent hold bound also retires a stranded job's
    // map entry; it must not retain a closed dialog until another caller arrives.
    entry.settled.then(clear,clear);
    return job.finally(clear);
  }
  /** Read-only identity check shared by detection and home TUI opens. No relay installation or consent writes. */
  async readIdentity(config, { defaultHome = false } = {}) {
    const host=this.host,machine=config.daemonMachine;
    this.step(`checking ${machine} in Herdr`);
    const record=await this.ready(machine);
    // Over Herdr's connection there is no tunnel to compare with: the OpenRig this connection is for is the host id it recorded when it switched
    // (after the tunnel and the helper named the same one), and the machine's own OpenRig must answer as that host below.
    const recorded=herdrIdentityOf(config);
    if(!recorded&&(!config.daemonUrl||!isLoopbackDaemonUrl(config.daemonUrl)))throw new Error(`Seats on ${machine} need the tunnel address in this connection's settings (http://127.0.0.x:port). Nothing was started.`);
    const remoteExec=(cmd,args)=>{this.stopIfCancelled();return host.exec(cmd,args,{on:machine,timeout:15000});};
    this.step(`reading ${machine}'s account and helper`);
    const info=await remoteMetadata(remoteExec,machine);
    // The machine's DEFAULT OpenRig, always: a connection's `openrigHome` is a folder on THIS computer (the local CLI's OPENRIG_HOME), never sent to a
    // machine. v0.5.0 supports one OpenRig per added machine; two on one machine would need a home on the machine itself.
    // `defaultHome` (the spec helper's caller) is kept for its callers and means the same now.
    void defaultHome;
    this.step(`checking OpenRig on ${machine}`);
    const statusResult=await remoteExec("env",["-i",`HOME=${info.home}`,`PATH=${info.searchPath}`,"rig","status","--json"]);
    parse(statusResult,`read OpenRig's status on ${machine}`);
    const status=parseDaemonStatusJson(statusResult.stdout);
    if(!status.reachable||!status.daemonUrl||!isLoopbackDaemonUrl(status.daemonUrl))throw new Error(`OpenRig is not reachable on ${machine}. Check rig status on that machine.`);
    const localHealth=recorded?{selfHostId:recorded.hostId,recorded:true}:await host.health(config.daemonUrl);
    const remoteHealthResult=await remoteExec("curl",["--disable","--noproxy","*","--fail","--silent","--show-error","--max-time","5","--max-redirs","0",`${status.daemonUrl}/healthz`]);
    if(remoteHealthResult?.code!==0)throw Object.assign(new Error(`OpenRig isn't answering on ${machine}. Check rig status on that machine and the daemon tunnel, then retry. No local terminal was started.`),
      {machineNotice:{machine,body:`Check rig status on ${machine}. OpenRig isn't answering on ${machine}.`}});
    const remoteHealth=parse(remoteHealthResult,`check OpenRig on ${machine}`);
    const current=await this.ready(machine);
    if(JSON.stringify([current.target,current.id,current.via,current.session])!==JSON.stringify([record.target,record.id,record.via,record.session]))throw new Error("The Herdr machine changed during preparation. Retry and review it again.");
    return {record,info,status,localHealth,remoteHealth,remoteExec};
  }
  /** The configured machine's account, home, PATH and node, read with fixed utilities there (no OpenRig involved). */
  async machineInfo(config) {
    const machine=config.daemonMachine;
    return remoteMetadata((cmd,args)=>this.host.exec(cmd,args,{on:machine,timeout:15000}));
  }
  async home(config) {
    try {
      const {record,info,status,localHealth,remoteHealth}=await this.readIdentity(config);
      if(!localHealth?.selfHostId||localHealth.selfHostId!==remoteHealth.selfHostId)throw new Error(identityMismatch(config,localHealth,remoteHealth));
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
      if(!localHealth?.selfHostId||localHealth.selfHostId!==remoteHealth.selfHostId)throw new Error(identityMismatch(config,localHealth,remoteHealth));
      if(differentDaemons(localHealth,remoteHealth))throw new Error(`The tunnel and selected Herdr machine reach two different OpenRigs that share host ID ${localHealth.selfHostId}. Check daemonMachine and the tunnel destination.`); // a host.name-seeded id can be shared on one machine
      this.step(`checking the helper for ${machine}`);
      const localNode = config.rig?.[0]?.match(/(?:^|\/)node$/) ? config.rig[0] : "node";
      const fileHelper = host.relayPath.replace(/rig-attach-relay\.cjs$/, "rig-remote-files.cjs");
      const shipped = parse(await host.exec(localNode, [fileHelper, "inspect"]), "check herdrig's helper before it is installed");
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
      const installed = Boolean(install && info.sha256 !== RELAY_SHA256);
      if (installed) {
        onProgress?.("install");
        const written = parse(await host.exec(localNode, [fileHelper, "install", machine, info.home]), `install herdrig's helper on ${machine}`);
        if (written.path !== info.path) throw new Error(`herdrig couldn't install its helper on ${machine} where it expected. Nothing was started.`);
      }
      // Also covers unchanged relays and install:false. When nothing was installed, readIdentity already walked every
      // path segment; re-checking canonical readlink -f, regular-file type and live SHA-256 catches any post-read change
      // without repeating the 20-call directory walk.
      const verify = async () => {
        if (installed) {
          const verified = await inspectRemote(remoteExec, info.home, machine);
          if (verified.path !== info.path || verified.sha256 !== RELAY_SHA256) throw new Error(HELPER_NOT_OURS(machine));
          return;
        }
        if (info.sha256 !== RELAY_SHA256) throw new Error(HELPER_NOT_OURS(machine));
        const canon = await host.exec("readlink", ["-f", "--", info.path], { on: machine, timeout: 15000 });
        const regular = await host.exec("test", ["-f", info.path], { on: machine, timeout: 15000 });
        const hashed = await host.exec("sha256sum", ["--", info.path], { on: machine, timeout: 15000 });
        if (canon?.code !== 0 || line(canon.stdout) !== info.path || regular?.code !== 0 || hashed?.code !== 0
          || !/^[a-f0-9]{64} [ *]/.test(line(hashed.stdout)) || line(hashed.stdout).slice(0, 64) !== RELAY_SHA256) {
          throw new Error(HELPER_NOT_OURS(machine));
        }
      };
      onProgress?.("verify");await verify();
      if (consent && stored?.key !== key) { await host.writeConsent({ key }); await verify(); }
      return { ok: true, machine, node: info.node, relayPath: info.path, daemonUrl: status.daemonUrl, selfHostId: localHealth.selfHostId,
        machineIdentity: JSON.stringify([record.target ?? "", record.id ?? "", record.via ?? "", record.session ?? ""]) };
    } catch (e) { return remoteFailure(e, config.daemonMachine); }
  }
}

/** A read-only offer, never an implicit routing decision. Only connected persistent profiles are probed. */
export async function detectDaemonMachine(host,config) {
  if(config?.daemonMachine||!config?.daemonUrl||!isLoopbackDaemonUrl(config.daemonUrl))return null;
  const body=parse(await host.hc(["machine","ls","--json"]),"list Herdr's machines");
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
async function readMachineOpenRig(host, machineName) {
  if (typeof machineName !== "string" || !MACHINE.test(machineName)) return null;
  try {
    const remoteExec = (cmd, args) => host.exec(cmd, args, { on: machineName, timeout: 15000 });
    const info = await remoteMetadata(remoteExec, machineName);
    const statusResult = await remoteExec("env", ["-i", `HOME=${info.home}`, `PATH=${info.searchPath}`, "rig", "status", "--json"]);
    const rawStatus = boundedParse(statusResult, `read OpenRig's status on ${machineName}`);
    const status = parseDaemonStatusJson(statusResult.stdout);
    if (!status.reachable || !status.daemonUrl || !isLoopbackDaemonUrl(status.daemonUrl)) return null;
    const healthResult = await remoteExec("curl", ["--disable", "--noproxy", "*", "--fail", "--silent", "--show-error", "--max-time", "5", "--max-redirs", "0", `${status.daemonUrl}/healthz`]);
    const health = boundedParse(healthResult, `check OpenRig on ${machineName}`);
    if (typeof health?.selfHostId !== "string" || !health.selfHostId) return null;
    const portMatch = String(status.daemonUrl).match(/^https?:\/\/[^/:?#]+:(\d{1,5})(?:[/?#]|$)/i), port = portMatch ? portMatch[1] : null; // no `URL`: the Herdr mod runtime has none
    const workspaceRoot = goodHome(rawStatus?.workspaceRoot?.value) ? rawStatus.workspaceRoot.value : null;
    return {
      found: { machine: machineName, daemonUrl: status.daemonUrl, selfHostId: health.selfHostId, port },
      paths: { home: info.home, workspaceRoot },
    };
  } catch (e) { if (isCodeError(e)) throw e; return null; } // what the machine does is "nothing found"; herdrig's own error is raised
}

export async function detectMachineOpenRig(host, machineName) {
  if (typeof machineName !== "string" || !MACHINE.test(machineName)) return null;
  const details = await readMachineOpenRig(host, machineName);
  return details ? details.found : null;
}

/** The offer for ONE machine, called once per connected machine that has no connection (never in a loop, never from daemon data):
 *  only a machine Herdr lists as persistent and connected is probed, and only its name from that list is used. Returns
 *  `{ machine, target, session, found }` where `found` is detectMachineOpenRig's answer (or null when nothing answered there), or
 *  null when Herdr does not list it as a connected persistent machine (nothing is run on it then). Read-only. */
export async function offerForMachine(host, machineName) {
  if (typeof machineName !== "string" || !MACHINE.test(machineName)) return null;
  let record;
  try {
    const body = boundedParse(await host.hc(["machine", "ls", "--json"]), "list Herdr's machines");
    record = (Array.isArray(body) ? body : body.machines)?.find((m) => m?.name === machineName);
  } catch (e) { if (isCodeError(e)) throw e; return null; }
  if (!record || record.temporary !== false || record.state !== "connected") return null;
  return { machine: machineName, target: record.target ?? null, session: record.session ?? null, found: await detectMachineOpenRig(host, machineName) };
}

/** The machines "Add a machine…" may offer: those Herdr lists as persistent and connected, with a name of the safe shape, that have no connection yet
 *  (`taken` is the machine names already used). Read from Herdr's own list only; each carries the {target, session} the gate pins. */
export async function listAddableMachines(host, taken = []) {
  const body = boundedParse(await host.hc(["machine", "ls", "--json"]), "list Herdr's machines");
  const rows = Array.isArray(body) ? body : body?.machines;
  if (!Array.isArray(rows)) return [];
  const used = new Set(taken.filter((n) => typeof n === "string"));
  return rows.filter((m) => m && typeof m.name === "string" && MACHINE.test(m.name) && m.temporary === false && m.state === "connected" && !used.has(m.name))
    .map((m) => ({ name: m.name, target: m.target ?? null, session: m.session ?? null }));
}

/** The Herdr machine record the setup gate pins at open: name plus `target` and `session` when present, read only
 *  from Herdr's own machine list (`hc machine ls --json`), never from config or daemon data. */
async function herdrMachineRecord(host, machineName) {
  const body = boundedParse(await host.hc(["machine", "ls", "--json"]), "list Herdr's machines");
  const rows = Array.isArray(body) ? body : body.machines;
  const record = rows?.find((m) => m?.name === machineName);
  return record ? { target: record.target ?? null, session: record.session ?? null } : null;
}
const sameMachineRecord = (a, b) => Boolean(a && b) && a.target === b.target && a.session === b.session;

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
      || (command === "curl" && a.length === PROBE_CURL.length + 1 && sameList(a.slice(0, PROBE_CURL.length), PROBE_CURL) && typeof a.at(-1) === "string" && a.at(-1).endsWith("/healthz") && localDaemonOrigin(a.at(-1).slice(0, -"/healthz".length)) === a.at(-1).slice(0, -"/healthz".length));
    if (!allowed) throw new Error("This screen only runs its fixed read-only checks on a machine.");
    return rawExec(command, [...a], { on: machine, timeout: 15000 });
  };
}

/** Fixed local directory-existence check for Add a machine's OpenRig home warning: runs only `test -d <folder>` on this
 *  computer (never on a machine) after `openrigHomeProblem` accepts the path shape. Returns true, false, or null if unknown. */
export function localDirectoryProbe(execFn) {
  if (typeof execFn !== "function") throw new Error("localDirectoryProbe needs an exec function.");
  return async (folder) => {
    if (openrigHomeProblem(folder)) return null;
    try {
      const result = await execFn("test", ["-d", folder], { timeout: 5000 });
      return result?.code === 0 ? true : result?.code === 1 ? false : null;
    } catch (_) { return null; }
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

/** The OpenRigs this computer already has, for one question: is an address one of them. The connections the file lists (a one-connection file is one), plus every
 *  address the caller's LIVE (CLI-enriched) config knows: a primary whose address the CLI found (a default install, no daemonUrl in the file) is not in the file,
 *  but it is still an OpenRig a new one must not be mistaken for. Used by Check (before any request) and by Save (the guard that cannot be skipped). */
function connectionsInUse(before, liveConfig) {
  let raw = {};
  try { raw = before ? JSON.parse(before) : {}; } catch (_) { throw new Error(CONFIG_NOT_JSON); }
  const existing = [...connectionsOf(raw).connections];
  // A connection switched to Herdr's connection still owns the tunnel address it kept for switching back: that address is in use too.
  for (const c of [...existing]) if (typeof c?.retainedDaemonUrl === "string" && c.retainedDaemonUrl) existing.push({ id: c.id ?? null, daemonUrl: c.retainedDaemonUrl, expectedHostId: null });
  if (liveConfig && typeof liveConfig === "object") {
    const live = [liveConfig.daemonUrl, ...(Array.isArray(liveConfig.connections) ? liveConfig.connections.map((c) => c?.daemonUrl) : [])];
    for (const daemonUrl of live) if (typeof daemonUrl === "string" && daemonUrl && !existing.some((c) => c.daemonUrl === daemonUrl)) existing.push({ id: null, daemonUrl, expectedHostId: null });
  }
  return existing;
}
const ADDRESS_IN_USE = "That address is already used by another OpenRig connection. Use a different tunnel address.";
// Loopback spellings of one address are one address (localhost, 127.0.0.1, [::1], 0.0.0.0 with the same scheme and port; 127.0.0.4 stays distinct). Over-matching only refuses, the safe direction.
const addressInUse = (existing, address) => { const key = addressKey(address); return existing.some((c) => c.daemonUrl && addressKey(c.daemonUrl) === key); };
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
  let expired = false, record = picked ? { target: picked.target ?? null, session: picked.session ?? null } : null, lastChecked = null, lastPaths = null, tunnel = null;
  const checkLive = () => {
    if (expired) throw new Error("This setup check has expired. Reopen the machine setup screen.");
    if (gateConfigGeneration() !== generation) throw new Error("OpenRig's settings changed while this was open. Reopen it and check again.");
  };
  const recheck = async () => {
    checkLive();
    const current = await herdrMachineRecord(host, machineName);
    checkLive();
    if (!current) throw new Error(`${machineName} is no longer in Herdr's machine list. Reopen the setup screen.`);
    if (record === null) record = current;
    else if (!sameMachineRecord(record, current)) throw new Error(`${machineName} was removed and re-added in Herdr while this was open. Reopen it and check again.`);
  };
  // The gate's one local operation: a plain GET of <origin>/healthz (no bearer, the 64KB refusal; loopbackHealthFetch ignores caller
  // options since Herdr's runtime rejects `redirect`, and refuses redirects by checking `response.url`), through host.setupFetch only.
  // Used for the person's tunnel and, read-only, for an existing connection's id (never a send of anything).
  const readHealthz = async (origin) => {
    const nothing = () => new Error(`Nothing answers at ${origin.replace(/^https?:\/\//, "")}. Start the tunnel (the command below), then check again.`);
    let text;
    try {
      const response = await host.setupFetch(`${origin}/healthz`, { redirect: "manual", method: "GET" });
      if (!response?.ok) throw nothing();
      text = await response.text();
    } catch (error) {
      if (error?.code === "NO_ANSWER" || error?.message?.startsWith("Nothing answers at")) throw nothing();
      throw new Error(`Herdr couldn't check ${origin.replace(/^https?:\/\//, "")}: ${errorDiagnostic(error)}`); // a real failure is shown as one, never as "nothing answers"
    }
    if (utf8Length(text) > JSON_READ_CAP) throw new Error(`${origin.replace(/^https?:\/\//, "")} answered with more than OpenRig's health ever holds.`);
    try { return JSON.parse(text); } catch (_) { throw new Error(`${origin.replace(/^https?:\/\//, "")} answered, but not like an OpenRig.`); }
  };
  return {
    /** The box side: does OpenRig run on this machine, and which host is it. `lastChecked.daemonUrl` is the BOX's own
     *  loopback address, meaningful only on the box (the remote curl); it is never a local address and is never saved. */
    async checkIdentity() {
      await recheck();
      const details = await readMachineOpenRig(host, machineName);
      await recheck();
      lastChecked = details ? details.found : null;
      lastPaths = details ? details.paths : null;
      tunnel = null; // a new box-side check invalidates an earlier tunnel check
      return lastChecked;
    },
    /** The checked remote home and workspaceRoot from the last successful `checkIdentity()`, or null. */
    machinePaths() { return lastPaths ? { ...lastPaths } : null; },
    /** This computer's side ([Check]): reads /healthz THROUGH the tunnel address the person gave and
     *  requires its selfHostId to equal the machine's own. This gate's one extra fixed operation: a plain GET of
     *  `<address>/healthz` (no bearer, redirects refused via `loopbackHealthFetch`'s final-address check, the same 64KB refusal), through `host.setupFetch`, and only
     *  to a loopback address. Returns the checked {address, selfHostId}; throws the refusal lines the screen shows (an address already in use among them). */
    async checkTunnel(address, { liveConfig } = {}) {
      if (!lastChecked) throw new Error("Check the machine before checking the tunnel.");
      const origin = localDaemonOrigin(address);
      if (!origin) throw new Error("The tunnel address must be a loopback address on this computer, such as http://127.0.0.1:7434.");
      if (typeof host.setupFetch !== "function") throw new Error("Herdr cannot check the tunnel from here.");
      // An address one of this computer's OpenRigs already uses is said here, before any request, so a tick is never shown for what Save will refuse.
      // A file that cannot be read or parsed is not this check's to judge: Save refuses it with its own line.
      let before = null; try { before = typeof host.readConfig === "function" ? (await host.readConfig()) ?? null : null; } catch (_) { before = null; }
      let used = []; try { used = connectionsInUse(before, liveConfig); } catch (_) { used = []; }
      if (addressInUse(used, origin)) throw new Error(ADDRESS_IN_USE);
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
      // The live config's addresses (a CLI-found primary) are compared too, and so is its live id further down.
      const existing = connectionsInUse(before, liveConfig);
      if (addressInUse(existing, tunnel.address)) throw new Error(ADDRESS_IN_USE);
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

/** The two rig reads the "Add this computer" check runs, for ONE home: the CLI environment a non-legacy connection gets (every inherited session,
 *  bearer, database, URL and home variable unset) with that home, then the rig program and the read. No OPENRIG_URL: the CLI asks only the daemon
 *  that home names, so the home's own token goes nowhere else. */
const LOCAL_PROBE_READS = { status: ["status", "--json"], daemonHost: ["config", "get", "daemon.host", "--json"] };
export const localProbeArgs = (home, rigArgv, read) => [...cliEnv({ connectionId: "conn-local-probe", openrigHome: home }), ...rigArgv, ...LOCAL_PROBE_READS[read]];
/** The only commands the "Add this computer" screen runs: a fixed-shape LOCAL probe, the local sibling of `machineProbeExec`.
 *  A home has no connection yet, so no gate scope can name it; this sink admits exactly, on this computer and nowhere else (no `on`):
 *  `printenv OPENRIG_HOME` (the prefill), `test -d <path>` and `realpath -- <path>` for the pinned home and the listed homes, and, with a home
 *  pinned, the two reads of `localProbeArgs` for that home. Anything else is refused before it reaches the host. */
export function localProbeExec(rawExec, { home = null, rigArgv = ["rig"], listedHomes = [] } = {}) {
  if (home !== null && openrigHomeProblem(home)) throw new Error("localProbeExec needs an absolute OpenRig home.");
  if (!Array.isArray(rigArgv) || !rigArgv.length || rigArgv.some((a) => typeof a !== "string" || !PROBE_VALUE.test(a))) throw new Error("localProbeExec needs the rig program.");
  if (rigArgv[0].includes("=")) throw new Error("This check needs the rig program first, without an environment assignment. Nothing was saved.");
  if(['sh','bash','dash','ash','zsh','ksh','fish','cmd','cmd.exe','powershell','pwsh','env'].includes(rigArgv[0].split(/[\\/]/).at(-1).toLowerCase()))throw new Error('This check needs the rig program directly, not a shell wrapper. Nothing was saved.');
  const paths = new Set([...(home === null ? [] : [home]), ...listedHomes.filter((h) => typeof h === "string" && !openrigHomeProblem(h))]);
  const reads = home === null ? [] : Object.keys(LOCAL_PROBE_READS).map((read) => localProbeArgs(home, rigArgv, read));
  return async (command, args, options) => {
    const a = Array.isArray(args) ? args : [];
    if (options?.on) throw new Error("Runs read-only checks on this computer only.");
    const allowed = (command === "printenv" && sameList(a, ["OPENRIG_HOME"]))
      || (command === "test" && a.length === 2 && a[0] === "-d" && paths.has(a[1])) // `test -d <path>`: GNU test reads a `--` here as a binary expression
      || (command === "realpath" && a.length === 2 && a[0] === "--" && paths.has(a[1]))
      || (command === "env" && reads.some((r) => sameList(a, r)));
    if (!allowed) throw new Error("Runs read-only checks on this computer only.");
    return rawExec(command, [...a], { timeout: 15000 });
  };
}

/** The "Add this computer" check and save. `host` gives `localProbe(options)` (a `localProbeExec`), `readDaemonState(home)` (the text of that home's daemon.json),
 *  `setupFetch` (the loopback-only /healthz read), `readConfig` and `writeConfig`. Check: the typed home must exist and is resolved to its canonical
 *  path BEFORE any rig read (the CLI may create a missing home); that home's own OpenRig is read through the probe pinned to the canonical path; its
 *  address must be loopback; its identity is read; and an OpenRig, address, host id or home another connection already uses is refused. Save: re-reads
 *  the identity (the same id, and pid when both have one) and appends exactly what Check saw, compare-and-swap against the file Check read. */
export function localSetupGate(host, { rigArgv = ["rig"] } = {}) {
  const generation = gateConfigGeneration();
  let expired = false, checked = null, epoch = 0;
  const recheck = (attempt=epoch) => {
    if(attempt!==epoch)throw new Error("The OpenRig home changed. Check again. Nothing was saved.");
    if (expired) throw new Error("This check has expired. Reopen the screen.");
    if (gateConfigGeneration() !== generation) throw new Error("OpenRig's settings changed while this was open. Reopen it and check again.");
  };
  const readHealthz = async (origin,request=host.setupFetch) => {
    const offline = () => new Error(`OpenRig doesn't answer at ${origin.replace(/^https?:\/\//, "")}. Check rig status, then check again.`);
    let text;
    try {
      const response = await request(`${origin}/healthz`, { method: "GET" });
      if (!response?.ok) throw offline();
      text = await response.text();
    } catch (error) {
      if (error?.code === "NO_ANSWER") throw offline();
      throw error;
    }
    if (utf8Length(text) > JSON_READ_CAP) throw new Error(`${origin.replace(/^https?:\/\//, "")} answered with more than OpenRig's health ever holds.`);
    try { return JSON.parse(text); } catch (_) { throw new Error(`${origin.replace(/^https?:\/\//, "")} answered, but not like an OpenRig.`); }
  };
  return {
    /** The prefill: this computer's own OPENRIG_HOME when it is set, else "" (never a guessed folder). */
    async prefill() {
      try { const r = await host.localProbe({ rigArgv })("printenv", ["OPENRIG_HOME"]); const v = r?.code === 0 ? String(r.stdout ?? "").trim() : ""; return openrigHomeProblem(v) ? "" : v; }
      catch (_) { return ""; }
    },
    async check(typedHome,request=host.setupFetch) {
      const attempt=++epoch;
      recheck(attempt);
      checked = null;
      const typed = String(typedHome ?? "").trim(), shape = openrigHomeProblem(typed);
      if (shape) throw new Error(shape);
      const before = await host.readConfig() ?? null;
      recheck(attempt);
      let raw;
      try { raw = JSON.parse(before ?? ""); } catch (_) { throw new Error("openrig/config.json is not valid JSON."); }
      if (!Array.isArray(raw?.connections)) throw new Error("This setup has no connections list, so this computer is already its only connection. Nothing was saved.");
      const { connections, invalid } = connectionsOf(raw);
      if (invalid) throw new Error(CONFIG_LIST_INVALID);
      if (connections.some((c) => !c.machine)) throw new Error(LOCAL_ALREADY_CONNECTED);
      const listed = connections.flatMap(connection => {
        const home = connection.openrigHome?.replace(/\/+$/, "");
        return openrigHomeProblem(home) ? [] : [{ connection, home }];
      });
      // The home exists and is canonical first (the CLI may create a missing one), and is not another connection's (compared as resolved).
      const paths = host.localProbe({ home: typed, rigArgv, listedHomes: listed.map(c => c.home) });
      if ((await paths("test", ["-d", typed]))?.code !== 0) throw new Error("That folder doesn't exist on this computer. Nothing was saved.");
      recheck(attempt);
      const resolved = await paths("realpath", ["--", typed]), home = String(resolved?.stdout ?? "").replace(/\n$/, "");
      recheck(attempt);
      if (resolved?.code !== 0 || openrigHomeProblem(home)) throw new Error("Herdr couldn't resolve that folder on this computer. Nothing was saved.");
      const canonicalHomes = [];
      for (const { connection, home: listedHome } of listed) {
        const r = await paths("realpath", ["--", listedHome]), real = r?.code === 0 ? String(r.stdout ?? "").replace(/\n$/, "") : listedHome;
        recheck(attempt);
        canonicalHomes.push(real);
        if (real === home || listedHome === home) throw new Error(localTaken(connection));
      }
      // The home's own daemon, as OpenRig records it (daemon.json: its pid and port), the same proof as the built-in folder copy. A home with no
      // record names no daemon of its own, so nothing is read for it: the CLI would fall back to a default port and find some other OpenRig there.
      let recorded = null;
      try { recorded = JSON.parse(await host.readDaemonState(home) ?? "null"); } catch (_) { recorded = null; }
      if (!recorded || !Number.isInteger(recorded.pid) || recorded.pid<1 || !Number.isInteger(recorded.port) || recorded.port<1 || recorded.port>65535) throw new Error("OpenRig isn't running for that home. Start it with rig daemon start, then check again.");
      recheck(attempt);
      // That home's own OpenRig, through the probe pinned to the canonical path.
      const probe = host.localProbe({ home, rigArgv });
      const statusRun = await probe("env", localProbeArgs(home, rigArgv, "status"));
      recheck(attempt);
      if(statusRun?.code!==0)throw new Error("OpenRig couldn't be read for that home. Nothing was saved.");
      if(utf8Length(String(statusRun.stdout??''))>JSON_READ_CAP)throw new Error("OpenRig's status answer was too large. Nothing was saved.");
      let status = parseDaemonStatusJson(statusRun?.stdout);
      if (status.reachable && status.port) {
        const hostRun = await probe("env", localProbeArgs(home, rigArgv, "daemonHost"));
        recheck(attempt);
        if(hostRun?.code!==0)throw new Error("OpenRig could not report its address for that home. Nothing was saved.");
        status = parseDaemonStatusJson(statusRun.stdout,parseDaemonHostJson(hostRun.stdout));
      }
      if (!status.reachable || !status.daemonUrl) throw new Error("OpenRig isn't running for that home. Start it with rig daemon start, then check again.");
      const origin = localDaemonOrigin(status.daemonUrl);
      if (!origin) throw new Error("That home's OpenRig doesn't answer on a loopback address of this computer, so it can't be added as this computer. Nothing was saved.");
      const health = await readHealthz(origin,request), id = typeof health?.selfHostId === "string" ? health.selfHostId : "";
      recheck(attempt);
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) throw new Error(`${origin.replace(/^https?:\/\//, "")} answered, but not like an OpenRig.`);
      const port = Number(/:(\d+)$/.exec(origin)?.[1] ?? (origin.startsWith("https:") ? 443 : 80));
      if (health?.pid !== recorded.pid || port !== recorded.port)
        throw new Error(`The OpenRig at ${origin.replace(/^https?:\/\//, "")} isn't the one that home records. Start that home's OpenRig with rig daemon start, then check again. Nothing was saved.`);
      for (const c of connections) if ((c.daemonUrl && addressKey(c.daemonUrl) === addressKey(origin)) || c.expectedHostId === id) throw new Error(localTaken(c));
      // A listed connection on a loopback address is read live too: the same daemon, or the same id, is the same OpenRig.
      for (const c of connections) {
        recheck(attempt);
        const o = localDaemonOrigin(c.daemonUrl ?? "");
        if (!o) continue;
        let other = null;
        try { other = await readHealthz(o,request); } catch (_) { continue; }
        if (other?.selfHostId === id || sameDaemon(other, health)) throw new Error(localTaken(c));
      }
      recheck(attempt);
      checked = { daemonUrl: origin, selfHostId: id, pid: recorded.pid, port, typed, home, canonicalHomes, before };
      return { daemonUrl: origin, selfHostId: id, home };
    },
    invalidate() { checked=null;epoch++; },
    expired() { return expired; },
    checked() { return checked ? { daemonUrl: checked.daemonUrl, selfHostId: checked.selfHostId, home: checked.home } : null; },
    expire() { expired=true;checked=null;epoch++; },
    /** Recheck the endpoint and home binding before the compare-and-swap against the file Check read. */
    async save(request=host.setupFetch) {
      if (!checked) throw new Error("Check this computer's OpenRig before adding it.");
      const snapshot=checked,attempt=epoch;
      recheck(attempt);
      const again = await readHealthz(snapshot.daemonUrl,request);
      if (again?.selfHostId !== snapshot.selfHostId || again?.pid !== snapshot.pid)
        throw new Error("OpenRig changed since the check. Check again. Nothing was saved.");
      recheck(attempt);
      const paths = host.localProbe({ home: snapshot.typed, rigArgv });
      const resolved = await paths("realpath", ["--", snapshot.typed]);
      recheck(attempt);
      if (resolved?.code !== 0 || String(resolved.stdout ?? "").replace(/\n$/, "") !== snapshot.home)
        throw new Error("The OpenRig home changed since the check. Check again. Nothing was saved.");
      let recorded = null;
      try { recorded = JSON.parse(await host.readDaemonState(snapshot.home) ?? "null"); } catch (_) { recorded = null; }
      recheck(attempt);
      if (recorded?.pid !== snapshot.pid || recorded?.port !== snapshot.port)
        throw new Error("The OpenRig home now records a different daemon. Check again. Nothing was saved.");
      const saved = await addLocalConnection({writeConfig:(text,before)=>host.writeConfig(text,before,()=>recheck(attempt))}, snapshot.before, { daemonUrl: snapshot.daemonUrl, expectedHostId: snapshot.selfHostId, openrigHome: snapshot.home, canonicalHomes: snapshot.canonicalHomes });
      expired = true;
      return saved;
    },
  };
}
