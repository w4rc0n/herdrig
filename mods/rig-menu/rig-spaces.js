import { errorDiagnostic } from "./rig-words.js";
import { tileTitle, gridViewerIdentity, gridViewerPayload } from "./rig-tile-title.js";
// Rig-owned viewer grids. Only Herdr's public commands, terminal labels and live lists are used.
import { isValidSessionName, isLoopbackDaemonUrl, tmuxServerArgsFrom, serverArgsRefusal, base64EncodeUtf8, rigSeatServers } from "./rig-lib.js";
import { machineId, machineLocalId, remoteFailure, goodHome, herdrIdentityOf } from "./rig-remote.js";
import { resolveRigSpace, unconfirmedRigSpace, unconfirmedSpaceReason, markRigSpace, rigSessions, rigOrigin, hostLabelValue, prepareRigSpaceAdoption } from "./rig-space-context.js";

const ROLE = "rig-grid";
const get = (host, key) => typeof host[key] === "function" ? host[key]() ?? [] : host[key] ?? [];
const labels = (t) => t?.labels ?? {};
const addr = (t) => t?.address ?? t?.terminal;
const origin = (config) => String(config?.daemonUrl ?? "").replace(/\/$/, "");
const belongsToOrigin = (l, rigName, expectedOrigin) => l["herdr-openrig.space"] === "1"
  && l["herdr-openrig.rig"] === rigName && expectedOrigin !== null && rigOrigin(l["herdr-openrig.origin"]) === expectedOrigin;
const belongs = (t, rig, url) => belongsToOrigin(labels(t), rig.name, rigOrigin(url));
/** A grid tile is live only while it runs the viewer its labels recorded; after a Herdr restart it comes back as a shell (labelled, not live). */
export const liveGridTile = (t) => { const v = labels(t)["herdr-openrig.viewer-argv"]; return Boolean(v) && v === JSON.stringify(t?.argv); };
const shell = (t, configured) => Array.isArray(t.argv) && (
  Array.isArray(configured) && configured.length > 0 && JSON.stringify(t.argv) === JSON.stringify(configured)
  || t.argv.length === 1 && /(?:^|\/)(?:sh|bash|dash|zsh|fish|ksh)$/.test(t.argv[0]));
// Exclude volatile presentation labels, but bind consent to every ownership/location label,
// the program, terminal incarnation and pane. A changed tile needs a new confirmation.
const tileSnapshot = (t, p, preReadLabels = null) => ({ terminal: addr(t), pane: p.pane, tab: p.tab,
  argv: [...(t?.argv ?? [])], pid: t?.pid, created: t?.created_ms,
  labels: Object.fromEntries(Object.entries(preReadLabels ?? labels(t)).filter(([k]) => k.startsWith("herdr-openrig.") || k === "herdr.space" || k === "herdr.tab").sort(([a], [b]) => a.localeCompare(b))) });
const localViewerProgram=(host,argv)=>{
  const actual=argv?.[0]==="env"&&/^HERDR_OPENRIG_GRID_TILE=[a-z0-9-]+$/.test(argv[1]??"")?argv.slice(2):argv;
  return actual?.[0]==="node"&&(host.viewerPath&&actual[1]===host.viewerPath&&actual.length===3
    ||host.padPath&&actual[1]===host.padPath&&actual.length===2);
};

/** One linear index per synchronous turn: O(1) terminal lookup per pane instead of cloning Herdr's lists inside pane loops. */
function buildGridIndex(host, rig, expectedOrigin, machine) {
  const rawTerms = get(host, "terminals");
  const rawPanes = get(host, "panes");
  const rawSpaces = get(host, "spaces");
  const byAddr = new Map();
  const labelsByAddr = new Map();
  const roleSet = new Set();
  const roleList = [];
  const claimedSet = new Set();
  const claimedList = [];
  const claimedBySpace = new Map();
  const ownSet = new Set();
  const prefix = machine ? `${machine}/` : null;
  for (const t of rawTerms) {
    const a = addr(t);
    if (!a || (prefix ? !a.startsWith(prefix) : a.includes("/"))) continue;
    const l = t?.labels ?? {};
    byAddr.set(a, t);
    labelsByAddr.set(a, l);
    if (l["herdr-openrig.role"] === ROLE && belongsToOrigin(l, rig.name, expectedOrigin)) {
      roleSet.add(a);
      roleList.push(t);
      const viewerArgv = l["herdr-openrig.viewer-argv"];
      if (viewerArgv) {
        claimedSet.add(a);
        claimedList.push(t);
        const spId = machineId(l["herdr.space"], machine);
        let bucket = claimedBySpace.get(spId);
        if (!bucket) { bucket = []; claimedBySpace.set(spId, bucket); }
        bucket.push(t);
        if (liveGridTile(t)) ownSet.add(a);
      }
    }
  }
  const panesByTab = new Map();
  for (const p of rawPanes) {
    let bucket = panesByTab.get(p?.tab);
    if (!bucket) { bucket = []; panesByTab.set(p?.tab, bucket); }
    bucket.push(p);
  }
  const spacesById = new Map();
  for (const s of rawSpaces) if (s?.id !== undefined) spacesById.set(s.id, s);
  return { rawPanes, rawSpaces, byAddr, labelsByAddr, roleSet, roleList, claimedSet, claimedList, claimedBySpace, ownSet, panesByTab, spacesById };
}

const daemonHostId = (host) => typeof host?.selfHostId === "function" ? host.selfHostId() : host?.selfHostId;
export function ownedRigSpace(host, rig, config) {
  // Background grid activation still requires its explicit marker; recognising legacy Attach alone never starts a grid.
  return resolveRigSpace(host,config,[rig.id,rig.name],{markedOnly:true,strictOrigin:true,sessions:rigSessions(rig),servers:rigSeatServers(rig),hostId:daemonHostId(host)});
}

/** Only a marked, same-origin Local grid can precede a configured box grid; display names prove nothing. */
export function rigSpaceRelocation(host,rig,config) {
  if(!config?.daemonMachine)return null;
  const source=ownedRigSpace(host,rig,{...config,daemonMachine:null});if(!source)return null;
  const idx=buildGridIndex(host,rig,rigOrigin(origin(config)),null);
  const sourceTabs=new Set((source.tabs??[]).map(t=>t.id));
  const panes=idx.rawPanes.filter(p=>sourceTabs.has(p.tab));
  const tiles=panes.flatMap(p=>{
    const t=idx.byAddr.get(p.terminal),l=idx.labelsByAddr.get(p.terminal);
    return t&&l&&idx.roleSet.has(p.terminal)&&l["herdr.space"]===source.id&&l["herdr.tab"]===p.tab?[tileSnapshot(t,p,l)]:[];
  });
  if(!tiles.length)return null;
  return {source:source.id,sourceName:source.name||rig.name,rig:rig.id,name:rig.name,machine:config.daemonMachine,origin:origin(config),tiles,
    panes:panes.map(p=>({pane:p.pane,tab:p.tab,terminal:p.terminal??null,mod:p.mod??null})),
    keptTabs:(source.tabs??[]).filter(tab=>panes.some(p=>p.tab===tab.id&&!tiles.some(t=>t.pane===p.pane)))
      .map(tab=>tab.name||"a terminal you opened")};
}

/** The sidebar issues consent for one exact dialog; shared-state callers cannot supply their own snapshot. */
export class RebuildConfirmations {
  constructor() { this.requests = new Map(); }
  issue(rigId, recovery, continuation = null) {
    for (const [token, value] of this.requests) if (value.rigId === rigId) this.requests.delete(token);
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    this.requests.set(token, { rigId, recovery: JSON.parse(JSON.stringify(recovery)), continuation: continuation ? JSON.parse(JSON.stringify(continuation)) : null }); return token;
  }
  take(request) {
    const value = this.requests.get(request?.token);
    if (!value || value.rigId !== request.rigId) return null;
    this.requests.delete(request.token); return value;
  }
}

const gridSeats = rig => (rig.pods ?? []).flatMap(pod => pod.seats ?? []);
const gridSeatAvailable = seat => !["stopped", "departed", "failed", "starting", "terminal_gone"].includes(seat.status);

export function rigGridPlan(rig, padPath, { selfHostId, viewerPath, openrigHome, remote = false, remoteViewer = null } = {}) {
  const local = (host) => !host || host === "local" || host === selfHostId;
  if (!selfHostId && (rig.host && rig.host !== "local" || (rig.pods ?? []).some((p) => p.seats?.some((s) => s.host && s.host !== "local")))) {
    throw new Error("Couldn't confirm this machine: OpenRig didn't report its own host ID. Refresh before opening a rig space.");
  }
  if (!local(rig.host)) throw new Error("This rig's seats run on another machine; rig spaces need their tmux here.");
  const seats = gridSeats(rig).filter(gridSeatAvailable);
  const tiles = seats.map((s) => {
    if (!local(s.host)) throw new Error("This rig's seats run on another machine; rig spaces need their tmux here.");
    if (s.native) throw new Error("This grid needs tmux seats on this machine; use Attach for native Herdr seats.");
    if (!isValidSessionName(s.session)) throw new Error("A grid seat has no valid session address.");
    const flags = tmuxServerArgsFrom(s.tmuxAttachCommand, s.session);
    if (!flags || !s.tmuxAttachCommand) throw new Error(serverArgsRefusal(s.tmuxAttachCommand, s.session));
    if (remote && (!goodHome(remoteViewer?.node) || !goodHome(remoteViewer?.path))) throw new Error("The remote grid relay has not been prepared and verified. No viewer was started.");
    const title = tileTitle(s,{label:s.session});
    const argv = remote ? [remoteViewer.node, remoteViewer.path, base64EncodeUtf8(JSON.stringify({ mode: "grid", session: s.session, serverArgs: flags, title }))]
      : viewerPath ? ["node", viewerPath, base64EncodeUtf8(JSON.stringify({ session: s.session, serverArgs: flags, openrigHome, title }))]
      : ["env", "-u", "TMUX", "TERM=xterm-256color", "tmux", ...flags, "attach-session", "-t", `=${s.session}`];
    return { session: s.session, serverArgs: flags, argv };
  });
  const cols = tiles.length ? Math.ceil(Math.sqrt(tiles.length)) : 0, rows = cols ? Math.ceil(tiles.length / cols) : 0;
  if (tiles.length < cols * rows && !padPath && !remote) throw new Error("The installed grid padding program is missing.");
  while (tiles.length < cols * rows) tiles.push({ session: "", argv: remote ? ["sleep", "2147483647"] : ["node", padPath] });
  return { tiles, cols, rows, signature: JSON.stringify(tiles.map(t=>({...t,argv:gridViewerIdentity(t.argv)}))) };
}

/** A loopback URL may be a tunnel. Check the actual local server before creating viewers. */
export async function localGridPreflight(host, plan) {
  const first = plan.tiles.find((tile) => tile.session);
  if (!first) return { ok: true };
  try {
    const result = await host.exec("tmux", [...first.serverArgs, "has-session", "-t", `=${first.session}`]);
    if (result?.code === 0) return { ok: true };
  } catch {}
  return { ok: false, reason: "Couldn't reach this rig's tmux sessions on this machine. If the seats run on another machine, Rig spaces and Attach need a remote connection." };
}

export class RigSpaces {
  constructor(host) { this.host = host; this.done = new Map(); this.doneMeta = new Map(); this.outagedTabs = new Map(); this.needsVerify = new Set(); this.pending = new Map(); this.closed = new Set(); this.failures = new Map(); }
  clearPending(rig, config) {
    const key = `${origin(config)}|${config?.daemonMachine || ""}|${rig.name}`;
    const entry = this.pending.get(key);
    if (entry) { this.pending.delete(key); entry.release?.(); }
    this.needsVerify.add(key);
  }
  sync(rig, config, { explicit = false, rebuild = null, closeAll = false, relocation = null } = {}) {
    if (config?.daemonMachine !== undefined && config.daemonMachine !== ""
      && (typeof config.daemonMachine !== "string" || !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(config.daemonMachine))) {
      return Promise.resolve({ ok: false, reason: "daemonMachine must name a Herdr machine. No local terminal was started or closed." });
    }
    const key = `${origin(config)}|${config?.daemonMachine || ""}|${rig.name}`;
    const prev = this.pending.get(key);
    const waitPrev = prev
      ? (this.host.waitQueue ? this.host.waitQueue(() => prev.settled) : prev.settled)
      : Promise.resolve();
    const job = waitPrev.then(async () => {
      if (!explicit && !closeAll && this.failures.has(key)) {
        const idx = buildGridIndex(this.host, rig, rigOrigin(origin(config)), config?.daemonMachine || null);
        const changedProgram = idx.roleList.some((t) => idx.labelsByAddr.get(addr(t))?.["herdr-openrig.viewer-argv"] !== JSON.stringify(t.argv));
        if (!changedProgram && this.ownedPanes(rig, config, idx).length) return this.failures.get(key);
      }
      this.failures.delete(key);
      const result = await (closeAll ? this.closeAll(rig, config, key) : relocation
        ?this.relocate(rig,config,key,relocation,explicit,rebuild):this.update(rig, config, explicit, key, rebuild));
      if (result.closeAvailable && !result.retryable) this.failures.set(key, result);
      return result;
    });
    let prevRef = prev, rawRelease;
    const released = new Promise((r) => { rawRelease = r; });
    const unregister = this.host.registerBarrier?.(rawRelease);
    const cleanup = () => { prevRef = null; unregister?.(); };
    const release = () => { const p = prevRef; cleanup(); p?.release?.(); rawRelease(); };
    const entry = { settled: Promise.race([job.catch(() => {}), released]).finally(cleanup), release };
    this.pending.set(key, entry);
    return job.finally(() => { if (this.pending.get(key) === entry) this.pending.delete(key); });
  }
  async relocate(rig,config,key,approved,explicit,rebuild=null) {
    const host=this.host,current=rigSpaceRelocation(host,rig,config);
    if(!explicit||!current||JSON.stringify(current)!==JSON.stringify(approved))
      return {ok:false,reason:"The old grid or OpenRig connection changed. Review the move again. Nothing was closed."};
    const result=await this.update(rig,config,true,key,rebuild,true);
    if(!result.ok||!result.space){
      const unfinished=ownedRigSpace(host,rig,config);
      if(unfinished)try{host.run("space.rename",{id:unfinished.id,name:`${rig.name} · move incomplete`});}catch{}
      return {...result,...(result.recovery?{relocation:approved}:{}),reason:result.reason||"The box grid did not open. Nothing on this computer changed."};
    }
    // The grid controller has adopted, labelled and sized every tile before returning success.
    const closed=[],changed=[],failed=[],changedReasons={};
    const keepChanged=(name,reason)=>{changed.push(name);changedReasons[name]=reason;};
    const configMatches=()=>!host.currentConfig||origin(host.currentConfig())===origin(config)
      &&host.currentConfig()?.daemonMachine===config.daemonMachine;
    const expectedOrigin=rigOrigin(origin(config));
    const liveTile=snapshot=>{
      const idx=buildGridIndex(host,rig,expectedOrigin,null);
      const tabPanes=idx.panesByTab.get(snapshot.tab)??[];
      const pane=tabPanes.find(p=>p.pane===snapshot.pane&&p.terminal===snapshot.terminal);
      const terminal=idx.byAddr.get(snapshot.terminal);
      const splitChanged=tabPanes.some(p=>!approved.panes.some(prior=>prior.pane===p.pane
        &&prior.tab===p.tab&&prior.terminal===(p.terminal??null)&&prior.mod===(p.mod??null)));
      return !splitChanged&&pane&&terminal&&JSON.stringify(tileSnapshot(terminal,pane,idx.labelsByAddr.get(snapshot.terminal)))===JSON.stringify(snapshot)?{pane,terminal}:null;
    };
    for(const snapshot of approved.tiles){
      const name=snapshot.labels["herdr-openrig.seat"]||"Empty tile";
      let live=liveTile(snapshot);
      if(!live){keepChanged(name,"its pane or split changed");continue;}
      if(!localViewerProgram(host,snapshot.argv)){keepChanged(name,"it is no longer a recognised viewer");continue;}
      if(snapshot.labels["herdr-openrig.viewer-argv"]!==JSON.stringify(snapshot.argv)){keepChanged(name,"its viewer labels changed");continue;}
      try{
        const response=await host.hc(["get","--json","--",snapshot.terminal]);
        const record=JSON.parse(response.stdout);
        if(!configMatches()||response.code!==0||!record||JSON.stringify(record.argv)!==JSON.stringify(snapshot.argv)
          ||snapshot.pid!==undefined&&record.pid!==snapshot.pid||snapshot.created!==undefined&&record.created_ms!==snapshot.created
          ||Object.entries(snapshot.labels).some(([key,value])=>record.labels?.[key]!==value)||!liveTile(snapshot)){
          keepChanged(name,!configMatches()?"OpenRig's connection changed":JSON.stringify(record?.argv)!==JSON.stringify(snapshot.argv)
            ?"its command changed":"its terminal identity, labels or split changed");continue;
        }
        const oldSpace=get(host,"spaces").find(s=>s.id===approved.source);
        const lastTab=oldSpace?.tabs?.length===1&&oldSpace.tabs[0].id===snapshot.tab;
        const lastPane=get(host,"panes").filter(p=>p.tab===snapshot.tab);
        if(lastTab&&lastPane.length===1&&lastPane[0].pane===snapshot.pane&&liveTile(snapshot)&&configMatches())
          host.run("tab.close",{id:snapshot.tab,confirmed:true});
        else host.run("pane.close",{pane:snapshot.pane});
        for(let n=0;n<60&&get(host,"panes").some(p=>p.pane===snapshot.pane);n++){
          if(!host.wait)break;await host.wait(100);
        }
        if(get(host,"panes").some(p=>p.pane===snapshot.pane))failed.push(name);else closed.push(name);
      }catch{failed.push(name);}
    }
    const old=get(host,"spaces").find(s=>s.id===approved.source);
    const kept=get(host,"panes").filter(p=>old?.tabs?.some(t=>t.id===p.tab));
    let namingError=null;
    try{
      if(old&&kept.length)host.run("space.rename",{id:old.id,name:`${rig.name} · this computer`});
      const collision=get(host,"spaces").some(s=>s.id!==approved.source&&s.id!==result.space&&s.name===rig.name);
      host.run("space.rename",{id:result.space,name:collision?`${rig.name} · ${config.daemonMachine}`:rig.name});
    }catch(error){namingError=errorDiagnostic(error);}
    this.closed.add(`${origin(config)}||${rig.name}`); // Polling must never rebuild the retired Local grid.
    const personal=kept.filter(p=>!approved.tiles.some(t=>t.pane===p.pane));
    return {...result,relocated:true,oldSpace:approved.source,count:closed.length,changed,changedReasons,failed,
      keptTabs:new Set(personal.map(p=>p.tab)).size,namingError};
  }
  ownedPanes(rig, config, prebuiltIndex = null) {
    const machine = config?.daemonMachine || null;
    const idx = prebuiltIndex ?? buildGridIndex(this.host, rig, rigOrigin(origin(config)), machine);
    return idx.rawPanes.filter((p) => {
      if (!idx.roleSet.has(p.terminal)) return false;
      const t = idx.byAddr.get(p.terminal);
      const l = idx.labelsByAddr.get(p.terminal);
      if (!t || !l || l["herdr-openrig.viewer-argv"] !== JSON.stringify(t.argv)) return false;
      if (machineId(l["herdr.tab"], machine) !== p.tab) return false;
      const s = idx.spacesById.get(machineId(l["herdr.space"], machine));
      return Boolean(s && (s.machine || null) === machine && s.tabs?.some((tab) => tab.id === p.tab));
    });
  }
  /** Whether a tab's panes are exactly the plan's tiles: each one a viewer this mod labelled (its recorded argv is its live argv) for that tile's seat
   *  and command, the same number as the plan, and nothing else in the tab. A split tile runs under a per-split `env HERDR_OPENRIG_GRID_TILE=…` prefix. */
  isPlannedGrid(plan, tabPanes, cur) {
    if (!plan.tiles.length || tabPanes.length !== plan.tiles.length) return false;
    const viewerOf = (argv) => (Array.isArray(argv) && argv[0] === "env" && String(argv[1] ?? "").startsWith("HERDR_OPENRIG_GRID_TILE=") ? argv.slice(2) : argv);
    const have = [];
    for (const p of tabPanes) {
      const t = cur.byAddr.get(p.terminal), l = cur.labelsByAddr.get(p.terminal);
      if (!t || !l || !cur.ownSet.has(p.terminal)) return false;
      have.push(JSON.stringify([l["herdr-openrig.seat"] ?? "", gridViewerIdentity(viewerOf(t.argv))]));
    }
    const want = plan.tiles.map((tile) => JSON.stringify([tile.session ?? "", gridViewerIdentity(tile.argv)]));
    return have.sort().join("\n") === want.sort().join("\n");
  }
  async closeAll(rig, config, key) {
    let closed = 0;
    this.closed.add(key);
    this.done.delete(key);
    this.doneMeta.delete(key);
    this.outagedTabs.delete(key);
    for (const pane of this.ownedPanes(rig, config)) {
      if (config?.daemonMachine) {
        const ready = await this.host.prepareRemote?.(config);
        if (!ready?.ok) return { ...ready, ok: false, closeAvailable: true, reason: ready?.reason || "The configured machine is unavailable. No tiles were closed." };
      }
      if (!this.ownedPanes(rig, config).some((p) => p.pane === pane.pane && p.terminal === pane.terminal && p.tab === pane.tab)) continue;
      this.host.run("pane.close", { pane: pane.pane });
      for (let n = 0; n < 60 && get(this.host, "panes").some((p) => p.pane === pane.pane); n++) {
        if (!this.host.wait) break;
        await this.host.wait(100);
      }
      if (get(this.host, "panes").some((p) => p.pane === pane.pane)) return { ok: false, closeAvailable: true, reason: "Herdr did not confirm a tile closed. The remaining tiles were left alone." };
      closed++;
    }
    return { ok: true, closed: true, count: closed };
  }
  async update(rig, config, explicit, key, rebuild, moving = false) {
    if (this.closed.has(key) && !explicit) return { ok: true, closed: true };
    if (explicit) this.closed.delete(key);
    const url = origin(config), machine = config?.daemonMachine || null;
    let cachedLists = null, snap = null;
    const dropIndex = () => { cachedLists = null; snap = null; };
    const makeTurnHost = (base) => ({
      ...base,
      spaces: () => (cachedLists ??= { spaces: get(base, "spaces"), terminals: get(base, "terminals"), panes: get(base, "panes") }).spaces,
      terminals: () => (cachedLists ??= { spaces: get(base, "spaces"), terminals: get(base, "terminals"), panes: get(base, "panes") }).terminals,
      panes: () => (cachedLists ??= { spaces: get(base, "spaces"), terminals: get(base, "terminals"), panes: get(base, "panes") }).panes,
      hc: base.hc ? async (...a) => { dropIndex(); try { return await base.hc(...a); } finally { dropIndex(); } } : undefined,
      exec: base.exec ? async (...a) => { dropIndex(); try { return await base.exec(...a); } finally { dropIndex(); } } : undefined,
      wait: base.wait ? async (ms) => { dropIndex(); try { return await base.wait(ms); } finally { dropIndex(); } } : undefined,
      health: base.health ? async (...a) => { dropIndex(); try { return await base.health(...a); } finally { dropIndex(); } } : undefined,
      probeHealth: base.probeHealth ? async (...a) => { dropIndex(); try { return await base.probeHealth(...a); } finally { dropIndex(); } } : undefined,
      prepareHome: base.prepareHome ? async (...a) => { dropIndex(); try { return await base.prepareHome(...a); } finally { dropIndex(); } } : undefined,
      prepareRemote: base.prepareRemote ? async (...a) => { dropIndex(); try { return await base.prepareRemote(...a); } finally { dropIndex(); } } : undefined,
    });
    let host = makeTurnHost({ ...this.host });
    if(explicit&&!moving){
      const relocation=rigSpaceRelocation(host,rig,config);
      if(relocation)return {ok:false,needsRelocation:true,relocation,reason:"Move the existing Local rig space before opening its box grid."};
    }
    const localId = (id) => machineLocalId(id, machine), qualified = (id) => machineId(id, machine);
    const adoption=explicit?await prepareRigSpaceAdoption(host,config,[rig.id,rig.name],{sessions:rigSessions(rig),servers:rigSeatServers(rig)}):{ok:true};
    if(!adoption.ok)return {recovery:null,...adoption}; // a refusal offers no tile recovery, the same shape as sync's other refusals
    if(adoption.host){dropIndex();host=makeTurnHost(adoption.host);}
    let space = adoption.space??ownedRigSpace(host, rig, config);
    if (!space && explicit) {
      // ONE RIG == ONE SPACE: a rig space an older herdrig left without the explicit mark is still the rig's space (the Rig page, Attach and the TUI already find it by the same labels,
      // origin and vouching rules), so "Open rig space" adopts and marks it instead of building a second one. Only the explicit open does: background activation still needs the mark.
      const vouch = { sessions: rigSessions(rig), servers: rigSeatServers(rig), hostId: daemonHostId(host), strictOrigin: true };
      const found = resolveRigSpace(host, config, [rig.id, rig.name], vouch);
      if (found) {
        try { await markRigSpace(host, config, [rig.id, rig.name], found, { sessions: rigSessions(rig), servers: rigSeatServers(rig), hostId: daemonHostId(host) }); }
        catch (error) { return { ok: false, reason: errorDiagnostic(error) }; }
        space = found;
      } else {
        // Several page-only spaces of this rig: ask, never guess which one is its space (nothing is built).
        const other = unconfirmedRigSpace(host, config, [rig.id, rig.name], vouch);
        if (other) return { ok: false, unconfirmedSpace: true, reason: unconfirmedSpaceReason(rig.name, machine, other.origin ?? null, config.daemonUrl, other) };
      }
    }
    if (space && machine && !adoption.space) {
      // Found across a different loopback spelling of the same daemon (confirmed by its own session list): label it with today's address.
      try { await markRigSpace(host, config, [rig.id, rig.name], space, { sessions: rigSessions(rig), servers: rigSeatServers(rig), hostId: daemonHostId(host) }); }
      catch (error) { return { ok: false, reason: errorDiagnostic(error) }; }
    }
    if (!space && explicit && machine) {
      const other = unconfirmedRigSpace(host, config, [rig.id, rig.name], { markedOnly: true, strictOrigin: true, sessions: rigSessions(rig), servers: rigSeatServers(rig), hostId: daemonHostId(host) });
      if (other) return { ok: false, unconfirmedSpace: true, reason: unconfirmedSpaceReason(rig.name, machine, other.origin, config.daemonUrl) };
    }
    // A closed space is never recreated by polling, even when membership changes.
    if (!space) this.outagedTabs.delete(key);
    if (!space && !explicit) { this.done.delete(key); this.doneMeta.delete(key); return { ok: true, closed: true }; }
    const seats = gridSeats(rig);
    if (seats.some(seat => seat.status === "terminal_gone") && (!explicit || !seats.some(gridSeatAvailable))) {
      const pane = space && this.ownedPanes(rig, config).find(p => space.tabs?.some(tab => tab.id === p.tab));
      if (pane) this.outagedTabs.set(key, { space: space.id, tab: pane.tab });
      return explicit
        ? { ok: false, retryable: true, closeAvailable: Boolean(pane), reason: "This rig's terminal server isn't answering." }
        : { ok: true, skipped: true };
    }
    const outaged = this.outagedTabs.get(key);
    const recovering = outaged?.space === space?.id && Boolean(outaged);
    // A machine's grid needs no daemon address: each tile runs the verified relay on that machine with only its tmux session, and the machine's
    // identity comes from prepareRemote. So a connection over Herdr's own connection (its herdr:// address naming its own machine and agreeing with its
    // record, which herdrIdentityOf checks) opens like a tunnel.
    if (!isLoopbackDaemonUrl(url) && !herdrIdentityOf(config)) return { ok: false, reason: "Rig spaces need a local OpenRig daemon." };
    const required = ["pane.split", "pane.close", "layout.resize", "space.rename", "space.select", "tab.rename", "tab.select"];
    const available = get(host, "commands");
    const missing = required.filter((name) => !available.some((c) => c.name === name));
    if (missing.length) return { ok: false, reason: `Herdr lacks the rig-space commands: ${missing.join(", ")}.` };
    const supports = (command, arg) => available.find((c) => c.name === command)?.args?.some((a) => a.name === arg);
    if (!supports("layout.resize", "weight") || !supports("pane.split", "pane") || !supports("pane.split", "argv")) {
      return { ok: false, reason: "This Herdr version lacks weighted resizing or targeted viewer splits; rig spaces need those public capabilities." };
    }
    const expectedOrigin = rigOrigin(url);
    const index = () => (snap ??= buildGridIndex(host, rig, expectedOrigin, machine));
    const run = (name, args) => { if (name !== "layout.resize") dropIndex(); return host.run(name, args); };
    let currentStep = "checking existing space";
    const step = (words, rebuilding = false) => { currentStep = words; host.onStep?.(words, rebuilding); };
    const formatStepFailure = (e, failure) => {
      const msg = String(failure?.reason ?? e?.message ?? e);
      const isRuntimeError = e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError || e instanceof SyntaxError || /interrupted/i.test(msg);
      const hasDomainContext = /(?:Herdr|OpenRig|tmux|machine|pane|grid|space|tile|viewer|relay|tunnel|settings)/i.test(msg);
      if ((isRuntimeError || !hasDomainContext) && currentStep && !msg.includes(currentStep)) {
        return { ...failure, reason: `Couldn't open ${rig.name} while ${currentStep}: ${msg}` };
      }
      return failure;
    };
    const claimedAt = (id) => index().claimedSet.has(id);
    const ownAt = (id) => index().ownSet.has(id);
    const panes = () => index().rawPanes;
    const gridTerms = () => index().claimedBySpace.get(space?.id) ?? [];
    const checkRemoteSessions = async (tiles, rebuilding = false) => {
      step("checking tmux sessions", rebuilding);
      const groups = new Map();
      for (const tile of tiles) {
        if (!tile.session) continue;
        const k = JSON.stringify(tile.serverArgs);
        if (!groups.has(k)) groups.set(k, { flags: tile.serverArgs, sessions: [] });
        groups.get(k).sessions.push(tile.session);
      }
      for (const { flags, sessions } of groups.values()) {
        const probe = await host.exec("tmux", [...flags, "list-sessions", "-F", "#{session_name}"], { on: machine, timeout: 10000 });
        dropIndex();
        if (probe?.code !== 0) throw new Error(`The tmux seat ${sessions[0]} is unavailable on ${machine}. Check the OpenRig user's tmux socket.`);
        const live = new Set(String(probe.stdout ?? "").split(/\r?\n/).filter(Boolean));
        const missingSeat = sessions.find((s) => !live.has(s));
        if (missingSeat) throw new Error(`The tmux seat ${missingSeat} is unavailable on ${machine}. Check the OpenRig user's tmux socket.`);
      }
    };
    const machineTuple = (row) => JSON.stringify([row?.target ?? "", row?.id ?? "", row?.via ?? "", row?.session ?? ""]);
    const hasMachineIdentityFields = (row) => Boolean(row && ("target" in row || "id" in row || "via" in row || "session" in row));
    const checkMachineLayout = () => {
      if (!machine) return null;
      const listRow = host.machines ? get(host, "machines").find((m) => m?.name === machine) : null;
      if (host.machines && (!listRow || listRow.layout !== "ready")) {
        throw Object.assign(new Error("The Herdr machine changed while this grid was being built. The remaining tiles were not started."), { retryable: true });
      }
      return listRow;
    };
    const readLiveMachineIdentity = async () => {
      if (!machine) return { hc: null, list: null };
      const listRow = checkMachineLayout();
      const list = hasMachineIdentityFields(listRow) ? machineTuple(listRow) : null;
      let hcTuple = null;
      if (host.hc && (host.machines || typeof remote?.machineIdentity === "string" || this.doneMeta.get(key)?.expectedMachine?.hc)) {
        const res = await host.hc(["machine", "ls", "--json"]);
        dropIndex();
        if (res?.code !== 0) {
          throw Object.assign(new Error("The Herdr machine changed while this grid was being built. The remaining tiles were not started."), { retryable: true });
        }
        let parsed = null;
        try { parsed = JSON.parse(String(res?.stdout ?? "{}")); } catch {
          throw Object.assign(new Error("The Herdr machine changed while this grid was being built. The remaining tiles were not started."), { retryable: true });
        }
        const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.machines) ? parsed.machines : null;
        if (rows) {
          const rec = rows.find((m) => m?.name === machine);
          if (!rec || rec.temporary !== false || rec.state !== "connected") {
            throw Object.assign(new Error("The Herdr machine changed while this grid was being built. The remaining tiles were not started."), { retryable: true });
          }
          hcTuple = machineTuple(rec);
        }
      }
      return { hc: hcTuple, list };
    };
    let plan = null, remote = null, expectedMachine = { hc: null, list: null }, fromFastPath = false;
    if (!rebuild && !recovering && space && !this.needsVerify.has(key) && this.done.has(key) && this.doneMeta.has(key)) {
      currentStep = "checking existing grid";
      const cur = index();
      const meta = this.doneMeta.get(key);
      const listRow = machine && host.machines ? get(host, "machines").find((m) => m?.name === machine) : null;
      const machineConnected = !machine || !host.machines || Boolean(listRow && listRow.layout === "ready"
        && (meta.expectedMachine?.list === null || (hasMachineIdentityFields(listRow) && machineTuple(listRow) === meta.expectedMachine?.list)));
      const settingsUnchanged = meta.gateToken === undefined || !host.gateCurrent || host.gateCurrent(meta.gateToken);
      const spaceTabs = new Set((space?.tabs ?? []).map((tb) => tb.id));
      const spaceClaimed = cur.claimedBySpace.get(space?.id) ?? [];
      let reuseTab = null;
      for (const t of spaceClaimed) {
        const candidateTab = qualified(cur.labelsByAddr.get(addr(t))?.["herdr.tab"]);
        if (spaceTabs.has(candidateTab)) { reuseTab = candidateTab; break; }
      }
      if (machineConnected && settingsUnchanged && reuseTab) {
        let fastPlan = null;
        try {
          fastPlan = rigGridPlan(rig, host.padPath, {
            selfHostId: meta.selfHostId ?? host.selfHostId?.(),
            viewerPath: machine ? null : host.viewerPath,
            openrigHome: machine ? null : config.openrigHome,
            remote: !!machine,
            remoteViewer: machine ? { node: meta.node, path: meta.relayPath } : null,
          });
        } catch { fastPlan = null; }
        const reusePanes = fastPlan ? (cur.panesByTab.get(reuseTab) ?? []) : [];
        const allHealthy = Boolean(fastPlan && fastPlan.tiles.length > 0
          && reusePanes.length === fastPlan.tiles.length
          && reusePanes.every((p) => cur.ownSet.has(p.terminal))
          && !spaceClaimed.some((t) => { const a = addr(t); return qualified(cur.labelsByAddr.get(a)?.["herdr.tab"]) === reuseTab && !cur.ownSet.has(a); }));
        const reuseStamp = fastPlan ? `${fastPlan.signature}|${reusePanes.map((p) => p.pane).sort().join(",")}` : "";
        if (allHealthy && this.done.get(key) === reuseStamp) {
          let identityCurrent = true;
          if (explicit && machine) {
            try {
              const live = await readLiveMachineIdentity();
              if ((meta.expectedMachine?.hc !== null && live.hc !== meta.expectedMachine?.hc)
                || (meta.expectedMachine?.list !== null && live.list !== meta.expectedMachine?.list)
                || (meta.expectedMachine?.list === null && live.list !== null)) {
                identityCurrent = false;
              }
            } catch {
              identityCurrent = false;
            }
            if (!identityCurrent) {
              this.needsVerify.add(key);
            } else {
              try { await checkRemoteSessions(fastPlan.tiles, false); }
              catch (e) {
                this.needsVerify.add(key);
                const failure = formatStepFailure(e, remoteFailure(e, machine));
                return { ...failure, ...(failure.retryable ? { retryable: true, preparationFailed: true } : { closeAvailable: this.ownedPanes(rig, config).length > 0 }) };
              }
            }
          }
          if (identityCurrent) {
            expectedMachine = meta.expectedMachine ?? { hc: null, list: null };
            plan = fastPlan;
            fromFastPath = true;
          }
        }
      }
    }
    const rebuildingExisting = Boolean(space);
    // An open the person asked for, and a background sync of a grid this session hasn't built yet (after a restart: a rebuild is almost certain and can
    // take a minute), say at once that they are rebuilding. A background sync of a grid already built says so only once it really rebuilds (below):
    // otherwise every idle refresh of a machine rig shows and clears a "Rebuilding" line, re-rendering every view twice, for a grid that is reused.
    // A background sync of a grid whose tab holds tiles this mod no longer owns (restored as shells after a Herdr restart, or running another program)
    // can only refuse until the person acts (below). It reads that from Herdr's own lists first, so it makes no remote check and shows no line.
    const refusesAnyway = !explicit && !rebuild && !plan && Boolean(space) && (() => {
      const cur = index(), here = new Set((space.tabs ?? []).map((t) => t.id));
      const gridTab = gridTerms().map((t) => qualified(cur.labelsByAddr.get(addr(t))?.["herdr.tab"])).find((id) => here.has(id));
      return Boolean(gridTab) && gridTerms().some((t) => { const a = addr(t); return qualified(cur.labelsByAddr.get(a)?.["herdr.tab"]) === gridTab && !ownAt(a); });
    })();
    const announceEarly = !refusesAnyway && rebuildingExisting && (explicit || !this.done.has(key));
    if (!plan && !refusesAnyway) {
      try {
        if (machine) {
          if (!host.prepareRemote) throw new Error("Open the Rig sidebar to use the configured Herdr machine. No local terminal was started.");
          if (announceEarly) host.onRebuildStart?.();
          remote = await host.prepareRemote(config);
          dropIndex();
          if (!remote.ok) { this.needsVerify.add(key); return { ...remote, retryable: true, preparationFailed: true }; }
          if (typeof remote.machineIdentity === "string") {
            const listRow = checkMachineLayout();
            expectedMachine = { hc: remote.machineIdentity, list: hasMachineIdentityFields(listRow) ? machineTuple(listRow) : null };
          } else {
            expectedMachine = await readLiveMachineIdentity();
          }
        }
        plan = rigGridPlan(rig, host.padPath, { selfHostId: remote?.selfHostId ?? host.selfHostId?.(), viewerPath: machine ? null : host.viewerPath, openrigHome: machine ? null : config.openrigHome, remote: !!machine,
          remoteViewer: machine ? { node: remote.node, path: remote.relayPath } : null });
        if (machine) await checkRemoteSessions(plan.tiles, announceEarly);
        this.needsVerify.delete(key);
      } catch (e) {
        this.needsVerify.add(key);
        const failure = formatStepFailure(e, remoteFailure(e, machine));
        return { ...failure, ...(failure.retryable ? { preparationFailed: true } : { closeAvailable: this.ownedPanes(rig, config).length > 0 }) };
      }
    }
    currentStep = "checking restored tiles";
    const spaceTabsSet = new Set((space?.tabs ?? []).map((t) => t.id));
    let tab = gridTerms().map((t) => qualified(index().labelsByAddr.get(addr(t))?.["herdr.tab"])).find((id) => spaceTabsSet.has(id));
    if (recovering && tab !== outaged.tab) {
      this.outagedTabs.delete(key);
      if (!explicit) return { ok: true, closed: true };
    }
    const tabPanes = () => index().panesByTab.get(tab) ?? [];
    const snapshot = () => { const cur = index(); return (cur.panesByTab.get(tab) ?? []).map((p) => tileSnapshot(cur.byAddr.get(p.terminal), p, cur.labelsByAddr.get(p.terminal))); };
    let stale = gridTerms().filter((t) => { const a = addr(t); return qualified(index().labelsByAddr.get(a)?.["herdr.tab"]) === tab && !ownAt(a); });
    const configured = stale.length && !machine ? await Promise.resolve().then(() => host.recoveryShell?.()).catch(() => null) : null;
    if (stale.length && !machine) dropIndex();
    stale = gridTerms().filter((t) => { const a = addr(t); return qualified(index().labelsByAddr.get(a)?.["herdr.tab"]) === tab && !ownAt(a); });
    const isShell = (t) => shell(t, configured);
    const recovery = stale.length && stale.every(isShell) && tabPanes().length && tabPanes().every((p) => { const cur = index(), t = cur.byAddr.get(p.terminal); return Boolean(t && cur.claimedSet.has(p.terminal) && (cur.ownSet.has(p.terminal) || isShell(t))); })
      ? { space: space.id, tab, tiles: snapshot() } : null;
    if (rebuild && (!explicit || !recovery || JSON.stringify(rebuild) !== JSON.stringify(recovery))) {
      return { ok: false, reason: "The grid changed since confirmation. Nothing was rebuilt; open the rig space and review its tiles again." };
    }
    if (stale.length && !rebuild) return { ok: false, recovery,
      reason: recovery ? "These tiles were restored as shells after a Herdr restart. Review them before rebuilding."
        : "A grid tile is running an unrecognised program; it was left alone. Save any work, close the affected panes yourself, then open the rig space again.",
      stale: stale.map((t) => ({ seat: index().labelsByAddr.get(addr(t))?.["herdr-openrig.seat"] || "Empty tile", shell: isShell(t) })) };
    if (refusesAnyway) return { ok: true, skipped: true }; // the tiles changed again since the first read: the next sync checks them properly
    const confirmed = (t, p, preLabels = null) => !!rebuild && Boolean(t) && claimedAt(addr(t)) && isShell(t)
      && rebuild.tiles.some((s) => JSON.stringify(s) === JSON.stringify(tileSnapshot(t, p, preLabels)));
    const isExplicit = () => explicit || Boolean(host.explicitRequested?.());
    const focused = () => index().rawSpaces.some((s) => s.active && s.tabs?.some((t) => t.id === tab && t.active))
      || tabPanes().some((p) => p.focused || (p.terminal && p.terminal === host.focused?.()?.terminal));
    // ONE operation for the whole build: the viewers' argv embeds the home and address this build began under, and `pane.split` is gated per call. When the host gives a token for the
    // settings the build began under, every close and split first checks they are still current: a change mid-build stops it rather than start the remaining tiles for the old home.
    const gateToken = host.gateToken?.();
    const guard = () => {
      if (gateToken !== undefined && host.gateCurrent && !host.gateCurrent(gateToken)) throw new Error("OpenRig's settings changed while this grid was being built, so the remaining tiles were not started. Open the rig space again.");
      if (!isExplicit() && !index().spacesById.has(space?.id)) throw new Error("space-closed");
      if (!isExplicit() && focused()) throw new Error("deferred-focus");
    };
    const ready = async () => {
      if (!machine) return;
      const live = await readLiveMachineIdentity();
      if ((expectedMachine.hc !== null && live.hc !== expectedMachine.hc)
        || (expectedMachine.list !== null && live.list !== expectedMachine.list)
        || (expectedMachine.list === null && live.list !== null)) {
        throw Object.assign(new Error("The Herdr machine changed while this grid was being built. The remaining tiles were not started."), { retryable: true });
      }
    };
    const waitFor = async (test, what, timeoutMessage = `Herdr did not confirm ${what}; the grid was not completed.`) => {
      for (let n = 0; n < 240; n++) { dropIndex(); const value = test(); if (value) return value; if (!host.wait) break; await host.wait(25); dropIndex(); }
      throw new Error(timeoutMessage);
    };
    const hc = async (args) => {
      const res = await host.hc(args);
      dropIndex();
      if (res?.code !== 0) throw new Error(res?.stderr || `Herdr couldn't do that step${machine ? ` on ${machine}` : ""} (it gave no reason). It didn't run: check the space before trying again.`);
      return res.stdout;
    };
    // New spaces carry the configured daemon's host id, so a later lookup compares an exact id instead of inferring.
    const hostStamp = hostLabelValue(remote?.selfHostId ?? host.selfHostId?.());
    const mark = (terminal, tile, argv) => hc(["label", terminal,
      "herdr-openrig.space=1", `herdr-openrig.rig=${rig.name}`, `herdr-openrig.origin=${url}`,
      `herdr-openrig.role=${ROLE}`, `herdr-openrig.seat=${tile.session}`, `herdr-openrig.viewer-argv=${JSON.stringify(argv)}`,
      ...(hostStamp ? [`herdr-openrig.host=${hostStamp}`] : [])]);
    const close = async (p) => {
      await ready();
      guard();
      // Re-check ownership against live labels immediately before every destructive operation.
      const cur = index();
      const livePane = (cur.panesByTab.get(p.tab) ?? []).find((n) => n.pane === p.pane && n.terminal === p.terminal);
      const liveTerm = cur.byAddr.get(p.terminal);
      const liveLabels = cur.labelsByAddr.get(p.terminal);
      if (rebuild && !(liveTerm && livePane && rebuild.tiles.some((s) => JSON.stringify(s) === JSON.stringify(tileSnapshot(liveTerm, livePane, liveLabels))))) throw new Error("A confirmed tile changed; it was left alone. Review the remaining tiles again.");
      if (!livePane || !(liveTerm && (cur.ownSet.has(p.terminal) || confirmed(liveTerm, livePane, liveLabels)))) throw new Error("A grid pane changed or is no longer owned by this mod; it was left alone.");
      run("pane.close", { pane: p.pane });
      await waitFor(() => !panes().some((n) => n.pane === p.pane), "pane close");
    };
    const builtOwned = new Map();
    let labelError = null;
    const labelJobs = [];
    const checkLabels = () => { if (labelError) throw labelError; };
    const isOwnedViewer = (terminalAddr) => {
      const cur = index();
      const live = cur.byAddr.get(terminalAddr);
      const built = builtOwned.get(terminalAddr);
      if (built) return !live || JSON.stringify(live.argv) === JSON.stringify(built.argv);
      return Boolean(live && cur.ownSet.has(terminalAddr));
    };
    try {
      if(moving&&space)run("space.rename",{id:space.id,name:`${rig.name} · moving`});
      if (tabPanes().some((p) => { const cur = index(), t = cur.byAddr.get(p.terminal); return !(t && (cur.ownSet.has(p.terminal) || confirmed(t, p, cur.labelsByAddr.get(p.terminal)))); })) throw new Error("The grid tab contains a personal pane; it was left alone.");
      if (!plan.tiles.length) {
        for (const p of tabPanes()) await close(p);
        this.done.delete(key);
        this.doneMeta.delete(key);
        return { ok: true, empty: true };
      }
      const stamp = () => `${plan.signature}|${tabPanes().map((p) => p.pane).sort().join(",")}`;
      // A grid this sidebar didn't build in this session (it was built before Herdr or the sidebar restarted) is taken as built when every pane in
      // its tab is a viewer this mod labelled and the viewers are exactly the plan's tiles. Otherwise each background sync rebuilt a healthy grid, or,
      // while the person had that grid in front of them, deferred the rebuild and forgot the grid again, so every refresh repeated the remote check.
      // What the fast path needs to reuse this grid later: this sync's own machine details and the settings it ran under.
      const recordBuilt = () => this.doneMeta.set(key, {
        selfHostId: remote?.selfHostId ?? host.selfHostId?.(),
        node: remote?.node ?? null,
        relayPath: remote?.relayPath ?? null,
        gateToken,
        expectedMachine,
      });
      if (!rebuild && !recovering && tab && !this.done.has(key) && !stale.length && this.isPlannedGrid(plan, tabPanes(), index())) {
        this.done.set(key, stamp());
        recordBuilt();
      }
      if (!rebuild && !recovering && tab && this.done.get(key) === stamp()) {
        // A reuse found by the slow path (after a settings change, or a machine check) records what it just checked, so the next sync can take the fast
        // path again. The fast path checked nothing new and keeps the record it read.
        if (!fromFastPath) recordBuilt();
        if (explicit && !machine) {
          step("checking tmux sessions", false);
          const preflight = await localGridPreflight(host, plan);
          dropIndex();
          if (!preflight.ok) return { ...preflight, closeAvailable: this.ownedPanes(rig, config).length > 0 };
        }
        let refreshedTiles = 0;
        // Upgrade only titleless viewers on a person's Open. Keep titled viewers,
        // even when their presentation metadata has since changed.
        if (explicit) for (const old of [...tabPanes()]) {
          const cur = index(), terminal = cur.byAddr.get(old.terminal), l = cur.labelsByAddr.get(old.terminal);
          if (!terminal || !cur.ownSet.has(old.terminal)) throw new Error("A tile changed while it was being renamed, so it was left as it was.");
          const payload = gridViewerPayload(terminal.argv);
          if (!payload || payload.title) continue;
          const tile = plan.tiles.find(t => t.session && t.session === l["herdr-openrig.seat"]
            && JSON.stringify(gridViewerIdentity(t.argv)) === JSON.stringify(gridViewerIdentity(terminal.argv)));
          if (!tile || !gridViewerPayload(tile.argv)?.title) continue;
          const snapshot = JSON.stringify(tileSnapshot(terminal, old, l));
          await ready(); guard(); dropIndex();
          const before = index(), live = before.byAddr.get(old.terminal);
          const livePane = (before.panesByTab.get(tab) ?? []).find(p => p.pane === old.pane && p.terminal === old.terminal);
          if (!live || !livePane || !before.ownSet.has(old.terminal)
            || JSON.stringify(tileSnapshot(live, livePane, before.labelsByAddr.get(old.terminal))) !== snapshot)
            throw new Error("A tile changed while it was being renamed, so it was left as it was.");
          const previous = new Set(panes().map(p => p.pane));
          const argv = ["env", `HERDR_OPENRIG_GRID_TILE=${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, ...tile.argv];
          const renameTimeout = "Herdr didn't confirm the renamed tile, so the old one was kept.";
          let next = null, record = null, oldClosed = false;
          try {
          run("pane.split", { pane: old.pane, direction: "right", argv });
          next = await waitFor(() => {
            const current = index();
            return (current.panesByTab.get(tab) ?? []).find(p => !previous.has(p.pane)
              && JSON.stringify(current.byAddr.get(p.terminal)?.argv) === JSON.stringify(argv));
          }, "refreshed viewer adoption");
          record = JSON.parse(await hc(["get", "--json", "--", next.terminal]));
          if (record.parent || record.terminal?.parent) throw new Error("Herdr didn't accept the renamed tile, so the old one was kept.");
          if (JSON.stringify(record.argv ?? record.terminal?.argv) !== JSON.stringify(argv))
            throw new Error("The renamed tile changed before it could be checked, so the old one was kept.");
          await mark(next.terminal, tile, argv);
          // hc acknowledges the label write before Herdr publishes its terminal list.
          await waitFor(() => index().ownSet.has(next.terminal), "replacement tile labels", renameTimeout);
          await ready(); guard(); dropIndex();
          const after = index(), oldTerm = after.byAddr.get(old.terminal);
          const oldPane = (after.panesByTab.get(tab) ?? []).find(p => p.pane === old.pane && p.terminal === old.terminal);
          if (!oldTerm || !oldPane || !after.ownSet.has(old.terminal) || !after.ownSet.has(next.terminal)
            || JSON.stringify(after.byAddr.get(next.terminal)?.argv) !== JSON.stringify(argv)
            || after.byAddr.get(next.terminal)?.pid !== (record.pid ?? record.terminal?.pid)
            || after.byAddr.get(next.terminal)?.created_ms !== (record.created_ms ?? record.terminal?.created_ms)
            || JSON.stringify(tileSnapshot(oldTerm, oldPane, after.labelsByAddr.get(old.terminal))) !== snapshot)
            throw new Error("A tile changed while it was being renamed.");
          // No await between the final identity check and closing this viewer.
          run("pane.close", { pane: old.pane });
          oldClosed = true;
          await waitFor(() => !panes().some(p => p.pane === old.pane), "old viewer close");
          // A same-axis split halves the old slot. Herdr gives its removed
          // share to the previous sibling, not necessarily this replacement.
          // Restore the same equal weights used when the grid was created.
          dropIndex();
          for (const pane of tabPanes()) {
            guard(); checkMachineLayout();
            if (!index().ownSet.has(pane.terminal)) throw new Error("A personal pane was left unchanged.");
            run("layout.resize", { id: pane.pane, weight: 1 });
          }
          refreshedTiles++;
          } catch (error) {
            if (oldClosed) {
              // The close was dispatched, so never retire the replacement:
              // the old pane may disappear later. Name a retained extra pane.
              dropIndex();
              if (tabPanes().some(p => p.pane === old.pane))
                throw new Error(`${errorDiagnostic(error)} An extra tile was left; close the extra one with Herdr's pane close.`);
              throw error;
            }
            let removed = false;
            // Even a failed label can leave our own nonce-tagged process.
            // Its original record must prove it parentless and unchanged;
            // foreign or changed ownership labels prevent cleanup.
            try {
              if (next && record && !record.parent && !record.terminal?.parent
                && JSON.stringify(record.argv ?? record.terminal?.argv) === JSON.stringify(argv)) {
                await ready(); guard();
                const fresh = JSON.parse(await hc(["get", "--json", "--", next.terminal]));
                dropIndex();
                const cur = index(), live = cur.byAddr.get(next.terminal), liveLabels = cur.labelsByAddr.get(next.terminal) ?? {};
                const expected = { "herdr.space": localId(space.id), "herdr.tab": localId(tab),
                  "herdr-openrig.space": "1", "herdr-openrig.rig": rig.name, "herdr-openrig.origin": url,
                  "herdr-openrig.role": ROLE, "herdr-openrig.seat": tile.session,
                  "herdr-openrig.viewer-argv": JSON.stringify(argv), ...(hostStamp ? { "herdr-openrig.host": hostStamp } : {}) };
                const sameLabels = Object.entries(liveLabels).every(([k,v]) =>
                  !(k.startsWith("herdr-openrig.") || k === "herdr.space" || k === "herdr.tab") || expected[k] === v);
                const pid = record.pid ?? record.terminal?.pid, created = record.created_ms ?? record.terminal?.created_ms;
                if (live && sameLabels && !fresh.parent && !fresh.terminal?.parent
                  && JSON.stringify(fresh.argv ?? fresh.terminal?.argv) === JSON.stringify(argv)
                  && JSON.stringify(live.argv) === JSON.stringify(argv)
                  && (fresh.pid ?? fresh.terminal?.pid) === pid && live.pid === pid
                  && (fresh.created_ms ?? fresh.terminal?.created_ms) === created && live.created_ms === created
                  && (cur.panesByTab.get(tab) ?? []).some(p => p.pane === next.pane && p.terminal === next.terminal)) {
                  // No await after this last nonce, incarnation and ownership check.
                  run("pane.close", { pane: next.pane });
                  await waitFor(() => !panes().some(p => p.pane === next.pane), "extra tile close");
                  removed = true;
                }
              }
            } catch { /* leave uncertain processes alone and report the extra tile */ }
            if (!removed && error?.message === renameTimeout)
              throw new Error(`${renameTimeout} An extra tile may have been left; close it with Herdr's pane close.`);
            if (!removed) throw new Error(`${errorDiagnostic(error)} An extra tile ${next ? "was" : "may have been"} left; close the extra one with Herdr's pane close.`);
            throw error;
          }
        }
        if (refreshedTiles) this.done.set(key, stamp());
        if (explicit) { dropIndex(); host.run("space.select", { id: space.id }); host.run("tab.select", { id: tab }); }
        return { ok: true, reused: true, space: space.id, tab, ...(refreshedTiles ? { refreshedTiles } : {}) };
      }
      if (rebuildingExisting && !explicit) host.onRebuildStart?.(); // a background sync that really rebuilds an existing grid says so from here
      guard();
      if (!machine) step("checking tmux sessions", rebuildingExisting);
      const preflight = machine ? { ok: true } : await localGridPreflight(host, plan);
      if (!machine) dropIndex();
      if (!preflight.ok) return { ...preflight, closeAvailable: this.ownedPanes(rig, config).length > 0 };
      guard();
      const first = plan.tiles[0];
      const sameViewer = (t) => {
        const argv = t.argv?.[0] === "env" && t.argv?.[1]?.startsWith("HERDR_OPENRIG_GRID_TILE=") ? t.argv.slice(2) : t.argv;
        return JSON.stringify(argv) === JSON.stringify(first.argv);
      };
      // A parked relay still looks like the previous viewer in Herdr's process list.
      let anchor = recovering ? null : tabPanes().find((p) => {
        const cur = index(), t = cur.byAddr.get(p.terminal), l = cur.labelsByAddr.get(p.terminal);
        return Boolean(t && cur.ownSet.has(p.terminal) && l?.["herdr-openrig.seat"] === first.session && sameViewer(t));
      });
      if (anchor) {
        const anchorTerm = index().byAddr.get(anchor.terminal);
        builtOwned.set(anchor.terminal, { argv: anchorTerm.argv });
      } else {
        const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const spaceId = space?.id ?? qualified(`sp-openrig-${nonce}`);
        tab ??= qualified(`tb-openrig-${nonce}`);
        await ready(); guard();
        step("starting the first viewer", rebuildingExisting);
        const out = await hc(["run", ...(machine ? ["--on", machine] : []), "--bg", "--json", "--no-parent", "--no-notify",
          "--label", `herdr.space=${localId(spaceId)}`, "--label", `herdr.tab=${localId(tab)}`,
          "--label", "herdr-openrig.space=1", "--label", `herdr-openrig.rig=${rig.name}`, "--label", `herdr-openrig.origin=${url}`,
          "--label", `herdr-openrig.role=${ROLE}`, "--label", `herdr-openrig.seat=${first.session}`,
          "--label", `herdr-openrig.viewer-argv=${JSON.stringify(first.argv)}`, ...(hostStamp ? ["--label", `herdr-openrig.host=${hostStamp}`] : []), "--", ...first.argv]);
        const terminal = JSON.parse(out)?.address;
        if (!terminal) throw new Error("Herdr returned no viewer terminal address.");
        anchor = await waitFor(() => (index().panesByTab.get(tab) ?? []).find((p) => p.terminal === terminal), "viewer adoption");
        builtOwned.set(terminal, { argv: first.argv });
        const created = !space;
        space = index().spacesById.get(spaceId);
        if (!space) throw new Error("Herdr returned no rig space.");
        if (created) {
          const title = String(rig.name ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 80).trim() || "Rig";
          const base=moving?`${title} · moving`:title;
          let name = base, suffix = 2;
          while (index().rawSpaces.some((s) => s.id !== spaceId && s.name === name)) name = `${base} ${suffix++}`;
          run("space.rename", { id: spaceId, name });
        }
      }
      // Name and focus immediately once the anchor viewer exists (including post-restart rebuilds before old panes close), then collapse and split.
      run("tab.rename", { id: tab, name: "Seats" });
      let selectedSpace = false;
      const focusNow = (explicit) => {
        if (selectedSpace) return;
        if (explicit) { selectedSpace = true; dropIndex(); host.run("space.select", { id: space.id }); host.run("tab.select", { id: tab }); }
      };
      focusNow(isExplicit());
      const stalePanes = tabPanes().filter((p) => p.pane !== anchor.pane);
      for (let i = 0; i < stalePanes.length; i++) {
        focusNow(isExplicit());
        step(`closing old tiles (${i + 1}/${stalePanes.length})`, true);
        await close(stalePanes[i]);
      }
      let openedCount = 1;
      const split = async (parent, direction, tile) => {
        focusNow(isExplicit());
        openedCount++;
        step(`opening seat tiles (${openedCount}/${plan.tiles.length})`, rebuildingExisting);
        checkLabels();
        await ready();
        await Promise.resolve();
        dropIndex();
        checkLabels();
        guard(); const before = new Set(panes().map((p) => p.pane));
        if (!isOwnedViewer(parent.terminal)) throw new Error("The split target is not a mod-owned viewer.");
        // Correlate the new pane by its exact argv, not merely by arrival order alongside personal activity.
        const argv = ["env", `HERDR_OPENRIG_GRID_TILE=${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, ...tile.argv];
        run("pane.split", { pane: parent.pane, direction, argv });
        const inspected = new Map();
        let pane = null;
        for (let n = 0; n < 240 && !pane; n++) {
          dropIndex();
          checkLabels();
          const cur = index();
          const candidates = (cur.panesByTab.get(tab) ?? []).filter((p) => !before.has(p.pane) && p.terminal);
          for (const candidate of candidates) {
            const inTerms = cur.byAddr.get(candidate.terminal);
            if (inTerms && JSON.stringify(inTerms.argv) === JSON.stringify(argv)) {
              if (machine && !inspected.has(candidate.terminal)) {
                inspected.set(candidate.terminal, JSON.parse(await hc(["get", "--json", "--", candidate.terminal])));
              }
              const rec = inspected.get(candidate.terminal);
              if (rec && (rec.parent || rec.terminal?.parent)) {
                throw new Error("Herdr created a grid split with a parent. The grid was stopped to protect the parent terminal.");
              }
              pane = candidate;
              break;
            }
            if (!inspected.has(candidate.terminal)) {
              const rec = JSON.parse(await hc(["get", "--json", "--", candidate.terminal]));
              inspected.set(candidate.terminal, rec);
              if (rec?.parent || rec?.terminal?.parent) {
                throw new Error("Herdr created a grid split with a parent. The grid was stopped to protect the parent terminal.");
              }
              const recArgv = rec?.argv ?? rec?.terminal?.argv;
              if (Array.isArray(recArgv) && JSON.stringify(recArgv) === JSON.stringify(argv)) {
                pane = candidate;
                break;
              }
            }
          }
          if (!pane) {
            if (!host.wait) break;
            await host.wait(25);
            dropIndex();
          }
        }
        if (!pane) throw new Error("Herdr did not confirm pane split; the grid was not completed.");
        checkLabels();
        builtOwned.set(pane.terminal, { argv });
        labelJobs.push(mark(pane.terminal, tile, argv).catch((err) => { labelError ??= err; }));
        return pane;
      };
      const columns = [anchor];
      for (let col = 1; col < plan.cols; col++) columns.push(await split(columns.at(-1), "right", plan.tiles[col]));
      const equalise = async (p) => {
        checkLabels();
        checkMachineLayout();
        guard();
        if (!isOwnedViewer(p.terminal)) throw new Error("A personal pane was left unchanged.");
        run("layout.resize", { id: p.pane, weight: 1 });
      };
      for (const p of columns) await equalise(p);
      for (let col = 0; col < plan.cols; col++) {
        let parent = columns[col];
        for (let row = 1; row < plan.rows; row++) parent = await split(parent, "down", plan.tiles[row * plan.cols + col]);
      }
      for (const p of tabPanes()) await equalise(p);
      step("applying tile labels", rebuildingExisting);
      await Promise.all(labelJobs);
      dropIndex();
      checkLabels();
      await ready();
      await waitFor(() => [...builtOwned.keys()].every((id) => index().ownSet.has(id)), "viewer labels");
      this.done.set(key, stamp());
      this.outagedTabs.delete(key);
      this.doneMeta.set(key, {
        selfHostId: remote?.selfHostId ?? host.selfHostId?.(),
        node: remote?.node ?? null,
        relayPath: remote?.relayPath ?? null,
        gateToken,
        expectedMachine,
      });
      return { ok: true, space: space.id, tab, cols: plan.cols, rows: plan.rows };
    } catch (e) {
      await Promise.allSettled(labelJobs);
      dropIndex();
      this.done.delete(key);
      this.doneMeta.delete(key);
      if (e.message === "deferred-focus") return { ok: true, deferred: true };
      if (e.message === "space-closed") return { ok: true, closed: true };
      if (machine) this.needsVerify.add(key);
      const failure = formatStepFailure(e, remoteFailure(e, machine)), retryable = e.retryable || failure.retryable;
      return { ...failure, ...(retryable ? { retryable: true, preparationFailed: true } : { closeAvailable: this.ownedPanes(rig, config).length > 0 }) };
    }
  }
}
