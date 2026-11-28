import { errorDiagnostic } from "./rig-words.js";
// All explicit opens and background grid reconciliation pass through this coordinator.
import { MOD_IDS, OTHER_CONNECTION_REFUSAL, layoutShowsMod, navPush, tuiArgv, isTuiArgv, attachToSeat, rigSeatServers, pushTabPage, pickRigTab, machineSpaceConn, resolveNeedRig } from "./rig-lib.js";
/** The page a Rig tab shows: its own history's top, else the page the router last sent it, else (one OpenRig only) the last page opened anywhere. */
function tabPageOf(host,config,tab){
  const own=host.shared?.("rig.tabPages")?.[tab]?.stack?.at(-1)??host.shared?.("rig.pageRoutes")?.[tab];
  if(own)return own;
  return (config?.connections?.length??0)>1?{section:"topology",...(config?.connectionId?{conn:config.connectionId}:{})}:host.shared?.("rig.nav")?.stack?.at(-1)??{section:"topology"};
}
import { openRigSpaceContext, resolveRigSpace, unconfirmedRigSpace, unconfirmedSpaceReason, unconfirmedSpaceNextSteps, rigOrigin, rigSessions, homeCandidate, markHomeSpace, hostLabelValue, prepareRigSpaceAdoption } from "./rig-space-context.js";
import { machineId, machineLocalId } from "./rig-remote.js";
import { LEGACY_CONNECTION_ID, partitionRowsByConnection, resolveRig, STALE_RIG_REFUSAL, AMBIGUOUS_NAME, qualifyKey, spaceStatusKey } from "./rig-connections.js";
import { gateSameConfig, gateIdentity } from "./rig-gate.js";
/** The singular `homeSpace` is the legacy connection's record (older versions read only it). Another connection keeps its home in
 *  `homeSpaces[key]` alone, whose key is [origin, machine] and so is already its own. */
const legacyHome=(config,id)=>(config?.connectionId??LEGACY_CONNECTION_ID)===LEGACY_CONNECTION_ID?{homeSpace:id}:{};

const jobs = new Map(), homeJobs = new Map(), pageJobs = new Map();
const list = (host, key) => (typeof host[key] === "function" ? host[key]() : host[key]) ?? [];
const active = host => list(host, "spaces").find(s => s.active)?.id ?? null;
const state = host => host.routeState?.() ?? host.shared?.("rig.spaceState") ?? {};
const contexts = host => openRigSpaceContext(list(host,"spaces"),list(host,"terminals"),list(host,"panes"),state(host),MOD_IDS.view);
const origin = config => String(config?.daemonUrl ?? "").replace(/\/$/,"");
const spaceMachine = space => space?.machine??(String(space?.id??"").includes("/")?space.id.split("/")[0]:null);
export const homeKey = config => JSON.stringify([rigOrigin(config?.daemonUrl)??origin(config),config?.daemonMachine||null]);
// What a fingerprint kept between a review and a confirm says about the config: the gate's identity, so a CLI-found address (an enrichment) is not a change.
const configIdentity = config => gateIdentity(config);
// A route judges "did the settings change" by the SEND GATE's identity (the file's address, machine, home, rig command, refusal), never by a raw compare: on a default install the
// captured config has no address and the live one gains the address the CLI found, which is the same config enriched. A DIFFERENT address found or typed since is a change.
/** Whether `config` (captured when something began) and `live` (the config now) are still ONE connection: the send gate's identity, never the object (a refresh replaces
 *  the primary's object with an equal one on a default install, whose address the CLI finds), and a different address found or typed since is a change. Every
 *  "did the connection change during this" guard, in the routes and in the sidebar's own flows, asks THIS. */
export const sameConnectionConfig = (live,config) => {
  if(!live||!config) return live===config||(!live&&!config);
  if(live===config) return true;
  if(!gateSameConfig(live,config)) return false;
  return !(live.daemonUrl&&config.daemonUrl&&rigOrigin(live.daemonUrl)!==rigOrigin(config.daemonUrl));
};
const configUnchanged = (host,config) => {
  if(!host.currentConfig) return true;
  return sameConnectionConfig(host.currentConfig(),config);
};
export const needsTabMigration = (context,config) => !!context && (context.legacy || context.home && spaceMachine(context.space)!==(config?.daemonMachine||null));
/** Migration is for this OpenRig's old tabs, never a foreign or removed connection's home. Missing legacy labels stay compatible with one connection;
 *  positive origin, host, page-owner or saved-home evidence must all agree with the selected connection. */
export function migrationSourceMatches(host,config,context){
  if(!context)return false;
  const expected=rigOrigin(config?.daemonUrl),live=typeof host?.selfHostId==='function'?host.selfHostId():host?.selfHostId;
  let matched=false;
  for(const terminal of context.tuis??[]){
    const labels=terminal.labels??{};
    if(labels['herdr-openrig.origin']&&rigOrigin(labels['herdr-openrig.origin'])!==expected)return false;
    if(labels['herdr-openrig.host']&&labels['herdr-openrig.host']!==(live??config?.expectedHostId))return false;
    if(labels['herdr-openrig.origin']||labels['herdr-openrig.host'])matched=true;
  }
  for(const link of context.rigLinks??[])if(link.origin){if(rigOrigin(link.origin)!==expected)return false;matched=true;}
  const routes=host.shared?.('rig.pageRoutes')??{},tabPages=host.shared?.('rig.tabPages')??{};
  for(const page of context.pages??[]){
    const entry=tabPages[page.tab]?.stack?.at(-1)??routes[page.tab]??page.props?.entry??page.props;
    if(entry?.conn&&entry.conn!==(config?.connectionId??LEGACY_CONNECTION_ID))return false;
  }
  for(const [key,id]of Object.entries(state(host).homeSpaces??{})){
    if(id!==context.id)continue;
    try{if(rigOrigin(JSON.parse(key)[0])!==expected)return false;}catch{return false;}
  }
  return (config?.connections??[]).length<=1||matched;
}
export const migrationChoice = (saved,config,spaceId) => saved?.tabMigration?.[JSON.stringify([spaceId,homeKey(config)])]
  ?? (!config?.daemonMachine?saved?.tabMigration?.[spaceId]:null);
export function migrationChoices(saved,config,spaceId,choice) {
  return {...(saved?.tabMigration??{}),...(!config?.daemonMachine?{[spaceId]:choice}:{}),[JSON.stringify([spaceId,homeKey(config)])]:choice};
}
async function recordMigrationComplete(host,config,source,destination) {
  const saved=state(host),patch={tabMigration:migrationChoices(saved,config,source.id,"move")};
  if(source.home&&spaceMachine(source.space)!==(config?.daemonMachine||null)){
    patch.homeSpaces=Object.fromEntries(Object.entries(saved.homeSpaces??{}).filter(([,id])=>id!==source.id));
    if(saved.homeSpace===source.id)patch.homeSpace=destination;
  }
  await save(host,patch);
}
const fail = reason => ({ ok:false, reason });
const nonce = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const wait = (host, ms) => host.wait ? host.wait(ms) : new Promise(resolve => setTimeout(resolve,ms));
const ROUTE_REQUEST_EXPIRY_MS = 2000;
// A sidebar that has registered as a receiver can take longer than that to take the request: Herdr delivers rig.route:<id> to the
// sidebar's own command loop, which can run behind busy frames (a large expanded Topology). It gets this long before the open is given up.
const ROUTE_RECEIVER_EXPIRY_MS = 10000;
const ROUTE_ACK_POLL_MS = 100;
/** A sidebar is registered but did not take the request in time: not "open the sidebar", which is already open. */
export const SIDEBAR_NO_ANSWER = "The Rig sidebar didn't answer in time. Try again.";
const sidebarNeeded = request => request.kind==="attach" ? "Open the Rig sidebar to attach." : "Open the Rig sidebar, then try again.";
/** A sidebar entry in rig.routeReceivers is the time it last said it was alive (every minute); only a recent one earns the longer wait,
 *  so a sidebar that crashed without removing its entry fails fast instead of making every Attach wait. */
export const ROUTE_RECEIVER_HEARTBEAT_MS = 60000;
const ROUTE_RECEIVER_FRESH_MS = 75000;
/** Entries older than this, or not a time (older versions wrote true), are dropped when a sidebar writes its own. */
export const ROUTE_RECEIVER_PRUNE_MS = 120000;
/** The receivers map with `self` stamped now and leftovers pruned: what a sidebar writes when it says it is alive. */
export function receiversWithBeat(current, self, now = Date.now()) {
  const kept = Object.entries(current ?? {}).filter(([id, at]) => id !== self && Number.isFinite(at) && at <= now && now - at <= ROUTE_RECEIVER_PRUNE_MS);
  return { ...Object.fromEntries(kept), [self]: now };
}
export const ROUTE_REPLY_PRUNE_MS = 60000;
/** The replies map with `id` acknowledged now. A reply is the time it was written; one nobody read within ROUTE_REPLY_PRUNE_MS (its
 *  forwarder died or reloaded after the sidebar accepted), or one that isn't a time (older versions wrote true), is dropped. A forwarder
 *  waits ROUTE_RECEIVER_EXPIRY_MS at most, so a live one always finds its reply. */
export function repliesWithReply(current, id, now = Date.now()) {
  const kept = Object.entries(current ?? {}).filter(([key, at]) => key !== id && typeof at === "number" && now - at <= ROUTE_REPLY_PRUNE_MS);
  return { ...Object.fromEntries(kept), [id]: now };
}
const receiverLive = host => {const now=Date.now();return Object.values(host.shared?.("rig.routeReceivers")??{}).some(at => Number.isFinite(at) && at <= now && now - at <= ROUTE_RECEIVER_FRESH_MS);};

async function adopted(host, predicate) {
  for (let n=0;n<100;n++) {
    const value=predicate(); if(value) return value;
    if (!host.wait && typeof setTimeout !== "function") break;
    await wait(host,100);
  }
  return null;
}

/** The sidebar's acknowledgement for `id`, removed once read. */
function takeReply(host, id) {
  if(!host.shared("rig.routeReplies")?.[id]) return false;
  const replies={...(host.shared("rig.routeReplies")??{})}; delete replies[id]; host.setShared("rig.routeReplies",replies);
  return true;
}

/** A receipt proves a live sidebar accepted the operation; its existing result notices report execution failures. */
export async function forwardRigOpen(host, request) {
  if (!host.shared || !host.setShared || !host.run || (!host.wait && typeof setTimeout !== "function"))
    return fail(sidebarNeeded(request));
  const id="open-"+nonce(), started=Date.now();
  // Without a registered sidebar the request fails fast; with one it waits the longer bound (the request's own expiry follows, so a sidebar
  // can still take it). One polling interval is always left before expiry, including the final acknowledgement check.
  let budget = receiverLive(host) ? ROUTE_RECEIVER_EXPIRY_MS : ROUTE_REQUEST_EXPIRY_MS;
  let expiresAt = started + budget;
  host.setShared("rig.routeRequests",{...(host.shared("rig.routeRequests")??{}),[id]:{request,expiresAt}});
  let dispatched=false, waited=0, sawLive=budget===ROUTE_RECEIVER_EXPIRY_MS;
  for(;;){
    // This lifecycle hint avoids Herdr's extra "unknown command" toast for a sidebar that never loaded.
    // A hint alone is never success: the consumed request's acknowledgement is still required.
    if(!sawLive && receiverLive(host)) sawLive=true;
    if(!dispatched && receiverLive(host)){
      if(budget<ROUTE_RECEIVER_EXPIRY_MS && receiverLive(host)){ // a live sidebar registered while this request waited: it gets the longer bound too
        budget=ROUTE_RECEIVER_EXPIRY_MS; expiresAt=started+budget;
        const pending=host.shared("rig.routeRequests")??{};
        if(pending[id]) host.setShared("rig.routeRequests",{...pending,[id]:{request,expiresAt}});
      }
      try { host.run(`rig.route:${id}`); dispatched=true; }
      catch(error){
        const pending={...(host.shared("rig.routeRequests")??{})};delete pending[id];host.setShared("rig.routeRequests",pending);
        return fail(errorDiagnostic(error));
      }
    }
    // A reply is written only by acceptRigOpen, which refuses an expired request: any reply here was written in time, even when
    // this poll comes late (a wait that overran expiry). It is read before the expiry check, and once more below before cleanup.
    if(takeReply(host,id)) return {ok:true,routed:true,accepted:true};
    if(Date.now()>=expiresAt || waited+2*ROUTE_ACK_POLL_MS>budget) break;
    await wait(host,ROUTE_ACK_POLL_MS); waited+=ROUTE_ACK_POLL_MS;
  }
  if(takeReply(host,id)) return {ok:true,routed:true,accepted:true}; // taken during the last wait
  const pending={...(host.shared("rig.routeRequests")??{})}; delete pending[id]; host.setShared("rig.routeRequests",pending);
  // "Didn't answer" only when a live sidebar was seen while waiting; leftovers alone (a crashed sidebar's entry) mean no sidebar is open.
  return fail(dispatched && sawLive ? SIDEBAR_NO_ANSWER : sidebarNeeded(request));
}

/** Consume before acknowledging: a second sidebar or a late delivery cannot run an open twice. */
export function acceptRigOpen(host, id) {
  if(typeof id!=="string") return null;
  const pending={...(host.shared("rig.routeRequests")??{})};
  const envelope=pending[id];
  if(!envelope) return null;
  delete pending[id]; host.setShared("rig.routeRequests",pending);
  if(!Number.isFinite(envelope.expiresAt) || envelope.expiresAt<=Date.now() || !envelope.request) return null;
  host.setShared("rig.routeReplies",repliesWithReply(host.shared("rig.routeReplies"),id));
  return envelope.request;
}

const paneIdentity = panes => JSON.stringify(panes.map(p=>[p.pane,p.mod,p.terminal]));
const pageMoveJobs = new Map();
/** Herdr may finish its last-tab confirmation after our bounded wait. Observe, never retry the close. */
export function migrationReportNow(host,result) {
  if(!result)return result;
  const completed=(result.left??[]).filter(item=>item.pendingClose
    &&!list(host,"spaces").find(s=>s.id===result.spaceId)?.tabs?.some(t=>t.id===item.tabId));
  if(!completed.length)return result;
  return {...result,reason:null,left:result.left.filter(item=>!completed.includes(item)),moved:[...(result.moved??[]),...completed]};
}
function pageMigration(host,config,spaceId,tabId) {
  const source=contexts(host).find(c=>c.id===spaceId);
  const panes=list(host,"panes").filter(p=>p.tab===tabId),pages=panes.filter(p=>p.mod===MOD_IDS.view);
  if(!configUnchanged(host,config)||!needsTabMigration(source,config)||!source.space.tabs?.some(t=>t.id===tabId)||!pages.length||pages.length===panes.length
    ||pages.some(p=>!p.pane||p.terminal)||new Set(panes.map(p=>p.pane)).size!==panes.length)return null;
  return {pages,panes,pageOnly:true,pageFingerprint:JSON.stringify([paneIdentity(panes),configIdentity(config)])};
}

/** Explicit page-only Move never closes a terminal or its tab, even when the terminal cannot be identified. */
export async function moveMigrationPages(host,config,request) {
  const key=JSON.stringify([request.spaceId,request.tabId]);
  if(pageMoveJobs.has(key))return pageMoveJobs.get(key);
  const task=(async()=>{
    try{
      const checked=pageMigration(host,config,request.spaceId,request.tabId);
      if(!checked||checked.pageFingerprint!==request.pageFingerprint)return fail("The tab changed. Review it again before moving its Rig page.");
      const entry=tabPageOf(host,config,request.tabId);
      const destination=await routeOpen({...host,routeOwner:true},config,{kind:"page",entry,home:true});
      if(!destination.ok)return destination;
      const current=pageMigration(host,config,request.spaceId,request.tabId);
      if(!current||current.pageFingerprint!==checked.pageFingerprint)return fail("The original tab changed while its destination opened. Its panes were left here.");
      const remaining=[...checked.panes];
      for(const page of checked.pages){
        if(!configUnchanged(host,config)||paneIdentity(list(host,"panes").filter(p=>p.tab===request.tabId))!==paneIdentity(remaining))
          return fail("The original tab changed. Its remaining panes were left here.");
        host.run("pane.close",{pane:page.pane});
        if(!await adopted(host,()=>!list(host,"panes").some(p=>p.pane===page.pane)))
          return fail("The destination opened, but closing the original Rig page was not confirmed. Its terminal panes were left here.");
        remaining.splice(remaining.findIndex(p=>p.pane===page.pane),1);
      }
      return {ok:true,space:destination.space,terminalPanesKept:true};
    }catch(error){return fail(errorDiagnostic(error));}
  })();
  pageMoveJobs.set(key,task);
  try{return await task;}finally{if(pageMoveJobs.get(key)===task)pageMoveJobs.delete(key);}
}
const shellArgv = argv => Array.isArray(argv) && argv.length===1 && /^(?:-)?(?:ba|z|da|k|c|tc|fi)?sh$/.test(String(argv[0]).split("/").at(-1));

/** Read each actual core, including machine-qualified addresses; a label alone never proves a live TUI. */
export async function inspectMigrationTab(host,config,spaceId,tabId) {
  const tab=list(host,"spaces").find(s=>s.id===spaceId)?.tabs?.find(t=>t.id===tabId);
  const panes=list(host,"panes").filter(p=>p.tab===tabId);
  const result={spaceId,tabId,name:tab?.name||tabId,replaceable:false};
  const left=(reason,blockedPane=null)=>({...result,ok:false,reason,...(blockedPane?{blockedPane}:{})});
  if(!configUnchanged(host,config))return left("OpenRig's connection changed; review the tab again");
  if(!tab||!panes.length)return left("the tab is no longer open");
  const expected=paneIdentity(panes),records=[];let stale=false;
  for(const pane of panes){
    if(pane.mod===MOD_IDS.view){if(pane.terminal)return left("it includes another terminal pane");continue;}
    const terminal=list(host,"terminals").find(t=>t.address===pane.terminal);
    if(!terminal||!host.hc)return left("it includes a personal pane OpenRig didn't open");
    let record;
    try{const response=await host.hc(["get","--json","--",terminal.address]);if(response.code!==0)return left("Herdr could not read its terminal");record=JSON.parse(response.stdout);}catch{return left("Herdr could not read its terminal");}
    const labelled=terminal.labels?.["herdr-openrig.role"]==="tui"&&record?.labels?.["herdr-openrig.role"]==="tui";
    const machine=terminal.address.includes("/")?terminal.address.split("/")[0]:null;
    const rawSpace=machine&&spaceId.startsWith(machine+"/")?spaceId.slice(machine.length+1):spaceId;
    const rawTab=machine&&tabId.startsWith(machine+"/")?tabId.slice(machine.length+1):tabId;
    if(record?.labels&&(record.labels["herdr.space"]!==rawSpace||record.labels["herdr.tab"]!==rawTab))return left("its terminal moved or its labels changed");
    const labelOrigin=terminal.labels?.["herdr-openrig.origin"];
    if(labelOrigin&&rigOrigin(labelOrigin)!==rigOrigin(config?.daemonUrl))return left("its TUI belongs to another OpenRig connection");
    const argv=record?.foreground?.argv??record?.argv;
    if(!record||record.state&&!['live','running'].includes(record.state))return left("its TUI isn't running");
    // Older tab.new fallback TUIs had no role label; recognise only the actual TUI argv, never its tab name.
    if(!isTuiArgv(argv,config)){
      if(labelled&&record.keep===true&&shellArgv(argv)){stale=true;}
      else {
        const program=Array.isArray(argv)?argv[0]:null;
        const name=String(record.foreground?.name||program||"terminal").split("/").at(-1).replace(/[\u0000-\u001f\u007f-\u009f]/g,"").slice(0,64)||"terminal";
        return left(labelled?"its TUI command changed or isn't running":"it includes another terminal pane",name);
      }
    }
    records.push([terminal.address,terminal.labels,record.labels,record.state,record.pid,record.created_ms,record.argv,record.foreground?.pid,record.foreground?.argv??null]);
  }
  if(paneIdentity(list(host,"panes").filter(p=>p.tab===tabId))!==expected)return left("the tab changed while Herdr checked it");
  const fingerprint=JSON.stringify([expected,records,rigOrigin(config?.daemonUrl),config?.daemonMachine??null]);
  return {...result,ok:!stale,replaceable:stale,reason:stale?"its TUI isn't running (restored shell)":null,panes,fingerprint};
}

async function verifyLiveTui(host,config,terminal){
  try{
    const response=await host.hc(["get","--json","--",terminal]);
    const fresh=JSON.parse(response.stdout);
    if(response.code!==0||!fresh||fresh.state&&!['live','running'].includes(fresh.state)||!isTuiArgv(fresh.foreground?.argv??fresh.argv,config))
      return fail("The fresh TUI didn't stay running. The original tab was left here.");
    return {ok:true};
  }catch{return fail("Herdr could not verify the fresh TUI. The original tab was left here.");}
}

/** Synchronous pre-close check (zero awaits) that previously verified destination tabs, panes and terminals are still present in Herdr. */
function destinationPresent(host,{tui=null,page=null}){
  const spaces=list(host,"spaces"),panes=list(host,"panes"),terminals=list(host,"terminals");
  const hasTab=(spaceId,tabId)=>Boolean(spaceId&&tabId)&&spaces.some(s=>s.id===spaceId&&(s.tabs??[]).some(t=>t.id===tabId));
  if(tui){
    const liveTerm=terminals.some(t=>t.address===tui.terminal&&(!t.state||['live','running'].includes(t.state)));
    const livePane=panes.some(p=>p.tab===tui.tab&&p.terminal===tui.terminal);
    if(!hasTab(tui.space,tui.tab)||!livePane||!liveTerm)return fail("The fresh TUI didn't stay running. The original tab was left here.");
  }
  if(page){
    const livePage=panes.some(p=>p.tab===page.tab&&p.mod===MOD_IDS.view);
    if(!hasTab(page.space,page.tab)||!livePage)return fail("The destination Rig page closed before moving. The original tab was left here.");
  }
  return {ok:true};
}

/** Only explicit Move calls this; one refused tab never prevents another safe tab from moving. */
export async function migrateRigTabs(host, config, spaceId) {
  const source=contexts(host).find(c=>c.id===spaceId);
  if(!migrationSourceMatches(host,config,source))return fail("This space belongs to another OpenRig connection. Nothing was moved.");
  if(!needsTabMigration(source,config))return fail("Those OpenRig tabs have changed. Refresh before moving them.");
  const candidates=[...new Set([...source.pages.map(p=>p.tab),...source.tuis.map(t=>list(host,"panes").find(p=>p.terminal===t.address)?.tab)].filter(Boolean))];
  // v0.2.x's tab.new fallback carried only Herdr's adoption labels. Discover it by real argv on explicit Move,
  // inside the already-recognised legacy space; never infer ownership from a display name.
  for(const tab of source.space.tabs??[]){
    if(candidates.includes(tab.id))continue;
    const checked=await inspectMigrationTab(host,config,spaceId,tab.id);
    if(checked.ok)candidates.push(tab.id);
  }
  const moved=[],left=[];
  for(const tab of candidates){
    try {
      const checked=await inspectMigrationTab(host,config,spaceId,tab);
      if(!checked.ok){
        const page=pageMigration(host,config,spaceId,tab);
        left.push({...checked,...(page?{pageOnly:true,pageFingerprint:page.pageFingerprint,
          reason:checked.blockedPane?`${checked.blockedPane} in ${checked.name} stays here; you can move just the Rig page`:"other panes stay here; you can move just the Rig page"}:{})});continue;
      }
      const hasPage=checked.panes.some(p=>p.mod===MOD_IDS.view);
      const hasTui=checked.panes.some(p=>p.terminal);
      let result=null;
      let tuiDest=null;
      let pageDest=null;
      if(hasTui){
        const opened=await routeOpen({...host,routeOwner:true},config,{kind:"tui"});
        if(!opened.ok){left.push({...checked,ok:false,replaceable:false,reason:opened.reason});continue;}
        const verified=await verifyLiveTui(host,config,opened.terminal);
        if(!verified.ok){left.push({...checked,ok:false,replaceable:false,reason:verified.reason});continue;}
        result=opened;
        tuiDest={space:opened.space,tab:opened.tab,terminal:opened.terminal};
      }
      if(hasPage){
        const entry=tabPageOf(host,config,tab);
        const page=await routeOpen({...host,routeOwner:true},config,{kind:"page",entry,home:true});
        if(!page.ok){left.push({...checked,ok:false,replaceable:false,reason:page.reason});continue;}
        result=page;
        pageDest={space:page.space,tab:page.tab};
      }
      if(!result){left.push({...checked,ok:false,replaceable:false,reason:"the tab is no longer open"});continue;}
      if(tuiDest&&hasPage){
        const reverified=await verifyLiveTui(host,config,tuiDest.terminal);
        if(!reverified.ok){left.push({...checked,ok:false,replaceable:false,reason:reverified.reason});continue;}
      }
      const current=await inspectMigrationTab(host,config,spaceId,tab);
      if(!current.ok||current.fingerprint!==checked.fingerprint){left.push({...checked,ok:false,replaceable:false,reason:"the original tab changed while opening its destination"});continue;}
      const dest=destinationPresent(host,{tui:tuiDest,page:pageDest});
      if(!dest.ok){left.push({...checked,ok:false,replaceable:false,reason:dest.reason});continue;}
      host.run("tab.close",{id:tab});
      if(!await adopted(host,()=>!list(host,"spaces").find(s=>s.id===spaceId)?.tabs?.some(t=>t.id===tab))){
        left.push({...checked,ok:false,replaceable:false,pendingClose:true,destination:result.space,reason:"its destination opened, but closing the original tab was not confirmed"});continue;
      }
      moved.push({...checked,destination:result.space});
    }catch(error){left.push({tabId:tab,name:list(host,"spaces").find(s=>s.id===spaceId)?.tabs?.find(t=>t.id===tab)?.name||tab,replaceable:false,reason:errorDiagnostic(error)});}
  }
  let error=null;
  if(!left.length)try{
    await recordMigrationComplete(host,config,source,moved.at(-1)?.destination);
  }catch(failure){error=`Tabs moved, but the migration choice could not be saved: ${failure.message}`;}
  return {ok:moved.length>0||!left.length,moved,left,error,reason:left.map(item=>`Left ${item.name} here: ${item.reason}.`).join("\n")};
}

/** Call only after consuming a builder-owned confirmation. A fresh destination is verified before any close. */
export async function replaceMigrationTab(host,config,request) {
  const source=contexts(host).find(c=>c.id===request.spaceId);
  const checked=await inspectMigrationTab(host,config,request.spaceId,request.tabId);
  if(!checked.replaceable||checked.fingerprint!==request.fingerprint)return fail("The original tab changed. Review it again before replacing it.");
  let pageDest=null;
  if(checked.panes.some(p=>p.mod===MOD_IDS.view)){
    const entry=tabPageOf(host,config,request.tabId);
    const page=await routeOpen({...host,routeOwner:true},config,{kind:"page",entry,home:true});
    if(!page.ok)return page;
    pageDest={space:page.space,tab:page.tab};
  }
  const opened=await routeOpen({...host,routeOwner:true},config,{kind:"tui"});
  if(!opened.ok)return opened;
  const verified=await verifyLiveTui(host,config,opened.terminal);
  if(!verified.ok)return verified;
  const current=await inspectMigrationTab(host,config,request.spaceId,request.tabId);
  if(!current.replaceable||current.fingerprint!==checked.fingerprint)return fail("The original tab changed while its replacement opened. It was left here.");
  const dest=destinationPresent(host,{tui:{space:opened.space,tab:opened.tab,terminal:opened.terminal},page:pageDest});
  if(!dest.ok)return dest;
  host.run("tab.close",{id:request.tabId,confirmed:true});
  if(!await adopted(host,()=>!list(host,"spaces").find(s=>s.id===request.spaceId)?.tabs?.some(t=>t.id===request.tabId)))
    return fail("The fresh TUI opened, but closing the original tab was not confirmed. Check the original before retrying.");
  const remaining=contexts(host).find(c=>c.id===request.spaceId);
  let error=null;
  if(source&&!remaining?.pages.length&&!remaining?.tuis.length)
    try{await recordMigrationComplete(host,config,source,opened.space);}catch(failure){error=`TUI replaced, but the migration choice could not be saved: ${failure.message}`;}
  return {ok:true,...opened,error};
}

function topologyLoadedFor(host, sharedData, topology, conn, config) {
  if (typeof host?.topologyLoaded === "function") return Boolean(host.topologyLoaded(conn));
  const byConn = sharedData?.byConnection;
  if (byConn && typeof byConn === "object") {
    if (conn && Object.hasOwn(byConn, conn)) return byConn[conn]?.answering === true;
    const entries = Object.values(byConn);
    if (!conn && entries.length === 1) return entries[0]?.answering === true;
  }
  return partitionRowsByConnection(topology, null, { conn, config }).eligible.length > 0;
}

function requestRig(host, request, config = null) {
  const entry=request.entry ?? {};
  const sharedData=host.shared?.("rig.data");
  const topology=host.topology?.() ?? sharedData?.topology ?? [];
  const effectiveConfig=config ?? host.currentConfig?.() ?? host.config ?? sharedData?.config ?? (sharedData?.byConnection ? { connections: Object.keys(sharedData.byConnection).map((id) => ({ id })) } : null);
  // An id is exact (and with its connection when the request has one); a name or duplicate id on two OpenRigs picks neither.
  const conn=request.conn ?? entry.conn;
  let routeConn=conn;
  let key=request.rigId ?? request.rig ?? request.seat?.rig ?? entry.rigId ?? entry.rig
    ?? (entry.kind==="rig" ? entry.name : null);
  let explicitRigId=Boolean(request.rigId || entry.rigId);
  if(!key && entry.section==="needs" && entry.id){
    const items=host.attentionItems?.() ?? host.shared?.("rig.data")?.attentionItems ?? [];
    const needRig=resolveNeedRig(entry.id,{items,topology,conn,config:effectiveConfig});
    if(needRig?.ambiguous)return {rig:undefined,key:needRig.key,conn:null,ambiguous:true,...(needRig.unownedNeed?{unownedNeed:true}:{}),...(needRig.reason?{ambiguousReason:needRig.reason}:{})};
    key=needRig?.rigId ?? needRig?.rig ?? needRig?.key ?? null;
    if(needRig?.rigId) explicitRigId=true;
    if(!routeConn && needRig?.conn) routeConn=needRig.conn;
  }
  if(!key)return {rig:undefined,key:null,conn:routeConn??null,ambiguous:false};
  const byIdRes=resolveRig(topology,{rigId:key,conn:routeConn,config:effectiveConfig,allowNameFallback:false});
  if(byIdRes.ambiguous)return {rig:undefined,key,conn:null,ambiguous:true,...(byIdRes.reason?{ambiguousReason:byIdRes.reason}:{})};
  if(explicitRigId && byIdRes.staleIdNameCollision)return {rig:undefined,key:null,conn:routeConn??null,ambiguous:false,staleRigId:true};
  if(byIdRes.rig)return {rig:byIdRes.rig,key,conn:routeConn??byIdRes.conn??byIdRes.rig.conn??null,ambiguous:false};
  if(explicitRigId){
    const loaded=topologyLoadedFor(host,sharedData,topology,routeConn??config?.connectionId??effectiveConfig?.connectionId??null,effectiveConfig);
    if(loaded)return {rig:undefined,key:null,conn:routeConn??null,ambiguous:false,staleRigId:true};
    return {rig:undefined,key,conn:routeConn??null,ambiguous:false};
  }
  const byName=resolveRig(topology,{name:key,conn:routeConn,config:effectiveConfig});
  if(byName.ambiguous)return {rig:undefined,key,conn:null,ambiguous:true,...(byName.reason?{ambiguousReason:byName.reason}:{})};
  return {rig:byName.rig,key,conn:routeConn??byName.conn??byName.rig?.conn??null,ambiguous:false};
}
const vouchOf=(host,rig)=>({sessions:rigSessions(rig),servers:rigSeatServers(rig),hostId:typeof host?.selfHostId==="function"?host.selfHostId():host?.selfHostId});
function rigSpace(host,config,rig,key,strictOrigin=false){
  return resolveRigSpace(host,config,[key,rig?.id,rig?.name],{...vouchOf(host,rig),strictOrigin});
}
/** A refusal for an unconfirmed space stays on the sidebar (the card there, with a Dismiss), not only in a toast that fades with its way
 *  forward cut off: it is published as that rig's space status, the same place the grid's own failures go. */
function publishUnconfirmed(host,config,rigId,result){
  if(!rigId||!result?.unconfirmedSpace||typeof host?.setShared!=="function")return result;
  const key=spaceStatusKey(config?.connectionId,rigId,(config?.connections??[]).length>1); // this connection's own card, never another OpenRig's rig of the same id
  host.setShared("rig.spaceStatus",{...(host.shared?.("rig.spaceStatus")??{}),[key]:result});
  return result;
}
/** ONE RIG == ONE SPACE: when the rig has a space on the machine that can't be confirmed, the open says so and asks; it never goes to the home
 *  or to a new space instead. Returns the refusal, or null when there is no such space. */
function unconfirmedRefusal(host,config,rig,key,request){
  // The entry carries the rig's name too, so this holds even before the sidebar has published its topology.
  const entry=request.entry??{},named=rig?.name??request.rig??entry.rig??(entry.kind==="rig"?entry.name:null)??key;
  const other=unconfirmedRigSpace(host,config,[key,rig?.id,rig?.name,request.rig,entry.rig,entry.kind==="rig"?entry.name:null],{...vouchOf(host,rig),strictOrigin:true});
  return other?fail(unconfirmedSpaceReason(named,config?.daemonMachine,other.origin,config?.daemonUrl,other)):null;
}

const safeRecordKey = key => typeof key==="string" && key!=="" && key!=="__proto__" && key!=="constructor" && key!=="prototype";
/** Whether a cached `rig.spaceStatus` entry is a failed space check or preparation (as opposed to an unconfirmed-space refusal or background skip). */
export function isFailedSpaceStatus(status){
  if(!status||typeof status!=="object")return false;
  if(status.unconfirmedSpace||status.skipped||status.closed)return false;
  return Boolean(status.preparationFailed||status.retryable||status.machineNotice||status.closeAvailable||status.ok===false);
}
export function readRigSpaceStatus(statuses,rigId,config){
  if(!statuses||typeof statuses!=="object"||!safeRecordKey(rigId))return null;
  const conn=config?.connectionId??null,many=(config?.connections?.length??0)>1;
  const qualified=conn?qualifyKey(conn,rigId):rigId;
  if(safeRecordKey(qualified)&&Object.hasOwn(statuses,qualified))return statuses[qualified];
  if((!many||!conn||conn===LEGACY_CONNECTION_ID)&&Object.hasOwn(statuses,rigId))return statuses[rigId];
  return null;
}
function writeRigSpaceStatus(host,config,rigId,value){
  if(!safeRecordKey(rigId)||typeof host?.setShared!=="function")return;
  const current={...(host.shared?.("rig.spaceStatus")??{})},conn=config?.connectionId??null,many=(config?.connections?.length??0)>1;
  const qualified=many&&conn?qualifyKey(conn,rigId):rigId;
  if(value===undefined){
    if(safeRecordKey(qualified))delete current[qualified];
    if(!many||!conn||conn===LEGACY_CONNECTION_ID)delete current[rigId];
  }else if(safeRecordKey(qualified))current[qualified]=value;
  host.setShared("rig.spaceStatus",current);
}
export function readInPlaceOpen(spaceState,rigId,conn=null){
  const map=spaceState?.inPlaceOpen;
  if(!map||typeof map!=="object"||!safeRecordKey(rigId))return null;
  if(conn&&conn!==LEGACY_CONNECTION_ID&&safeRecordKey(`${conn}|${rigId}`)&&Object.hasOwn(map,`${conn}|${rigId}`)){
    const rec=map[`${conn}|${rigId}`];
    return rec&&typeof rec==="object"?rec:null;
  }
  if(Object.hasOwn(map,rigId)){
    const rec=map[rigId];
    if(rec&&typeof rec==="object"&&(!conn||(rec.conn||LEGACY_CONNECTION_ID)===conn))return rec;
  }
  return null;
}
export function activeInPlaceOpen(host,config,rigId){
  const rec=readInPlaceOpen(state(host),rigId,config?.connectionId??null);
  if(!rec)return null;
  if(rec.tab){
    const allSpaces=list(host,"spaces");
    if(allSpaces.length>0&&!allSpaces.some(s=>(s?.tabs??[]).some(t=>t?.id===rec.tab)))return null;
  }
  return rec;
}
/** Records an in-place open under `conn|rigId` when another connection already holds `rigId` (sole reader: `readInPlaceOpen`, which checks `conn` on both keys). */
export function withInPlaceOpen(spaceState,rigId,conn,record){
  if(!safeRecordKey(rigId))return spaceState?.inPlaceOpen;
  const next={};
  for(const [k,v]of Object.entries(spaceState?.inPlaceOpen??{}))if(safeRecordKey(k)&&v&&typeof v==="object")next[k]=v;
  const owner=conn||LEGACY_CONNECTION_ID,stamped={...record,conn:owner};
  if(owner!==LEGACY_CONNECTION_ID&&safeRecordKey(`${owner}|${rigId}`)&&Object.hasOwn(next,rigId)&&(!next[rigId]?.conn||next[rigId].conn!==owner)){
    next[`${owner}|${rigId}`]=stamped;
  }else{
    if(owner!==LEGACY_CONNECTION_ID)delete next[`${owner}|${rigId}`];
    const existing=Object.hasOwn(next,rigId)?next[rigId]:null;
    if(existing?.conn&&existing.conn!==LEGACY_CONNECTION_ID&&existing.conn!==owner&&safeRecordKey(`${existing.conn}|${rigId}`))
      next[`${existing.conn}|${rigId}`]=existing;
    next[rigId]=stamped;
  }
  return next;
}
export function withoutInPlaceOpen(spaceState,rigId,conn=null){
  const prev=spaceState?.inPlaceOpen;
  if(!prev||typeof prev!=="object"||!safeRecordKey(rigId))return undefined;
  const next={};
  for(const [k,v]of Object.entries(prev))if(safeRecordKey(k)&&v&&typeof v==="object")next[k]=v;
  if(conn&&conn!==LEGACY_CONNECTION_ID){
    const qualified=`${conn}|${rigId}`;
    if(Object.hasOwn(next,qualified)){delete next[qualified];return Object.keys(next).length?next:undefined;}
  }
  if(Object.hasOwn(next,rigId)&&(!conn||(next[rigId]?.conn||LEGACY_CONNECTION_ID)===conn))delete next[rigId];
  return Object.keys(next).length?next:undefined;
}
export const inPlaceSpaceRefusal=rigName=>`${rigName}'s page is open here; close it before opening ${rigName}'s space.`;
export function inPlaceFallbackNote(rigName,reason){
  const detail=String(reason||"the rig's space is not reachable").trim();
  return `Opened here — ${rigName}'s space couldn't be opened: ${detail}`;
}
async function retrySpacePreparation(host,config){
  try{
    if(config?.daemonMachine){
      if(typeof host.prepareHome==="function")return await host.prepareHome(config);
      if(typeof host.prepareRemote==="function")return await host.prepareRemote(config);
      return null;
    }
    if(!host.relayPath&&typeof host.prepareRemote==="function")return await host.prepareRemote(config);
    if(typeof host.health==="function"&&config?.daemonUrl){
      const info=await host.health(config.daemonUrl);
      return {ok:true,localHostId:info?.selfHostId??null};
    }
    return null;
  }catch(error){
    return {ok:false,retryable:true,preparationFailed:true,reason:errorDiagnostic(error)};
  }
}

async function save(host,patch){
  const next={...state(host),...patch};
  host.setShared?.("rig.spaceState",next);
  if(host.saveRouteState) await host.saveRouteState(patch);
}

/** A page that wasn't asked for with an explicit open (a tab or a link on a page, Back) never makes a space: only the explicit opens may. */
export const NO_HOME_SPACE = "OpenRig's home space isn't open, so nothing was opened. Open OpenRig from the Rig sidebar to make it.";
async function home(host,config,needTui=true,mayCreate=true){
  const key=homeKey(config),machine=config?.daemonMachine||null;
  if(homeJobs.has(key)) {
    const pending=homeJobs.get(key),result=await pending;
    if(result.ok && needTui && !result.tab) {
      if(homeJobs.get(key)===pending) homeJobs.delete(key);
      return home(host,config,true,mayCreate);
    }
    // A page request that may not build found no home: an explicit open waiting behind it builds the home itself.
    if(!result.ok && mayCreate && result.reason===NO_HOME_SPACE) {
      if(homeJobs.get(key)===pending) homeJobs.delete(key);
      return home(host,config,needTui,true);
    }
    return result;
  }
  const task=(async()=>{
    let remote=null;
    if(machine){
      if(typeof host.prepareHome!=="function")return fail("Open the Rig sidebar to check the configured Herdr machine. No local terminal was started.");
      remote=await host.prepareHome(config);if(!remote.ok)return remote;
      if(remote.machine!==machine)return fail("The configured Herdr machine changed. No terminal was started.");
    }
    // A recorded home that was closed since is no home: kept, it would hide every other candidate, and a new space would be built each time.
    const recordedHome=state(host).homeSpaces?.[key],scoped=recordedHome&&list(host,"spaces").some(s=>s.id===recordedHome)?recordedHome:undefined;
    // Only a home recorded for ANOTHER listed connection is hidden from this one. A home recorded under any other key (another spelling of this daemon's address,
    // a key an earlier version wrote) is this connection's own to find, as in v0.4.7: hiding it built a second home space for the same OpenRig.
    // The own entry is left out by ID, never by key: on a default install its entry has no address (key ["",null]) while the live key carries the address the CLI found.
    const siblingKeys=new Set((config?.connections??[]).filter(c=>c?.id!==config?.connectionId).map(c=>homeKey({daemonUrl:c?.daemonUrl,daemonMachine:c?.machine??c?.daemonMachine}))); siblingKeys.delete(key); // and never this connection's own key, even when a hand-written list gives another entry the same address
    const homes=state(host).homeSpaces??{},legacyId=state(host).homeSpace;
    const otherHomes=new Set(Object.entries(homes).filter(([k])=>siblingKeys.has(k)).map(([,id])=>id));
    if(legacyId&&(config?.connectionId??LEGACY_CONNECTION_ID)!==LEGACY_CONNECTION_ID&&!Object.values(homes).includes(legacyId)
      &&(config?.connections??[]).some(c=>c?.id===LEGACY_CONNECTION_ID&&siblingKeys.has(homeKey({daemonUrl:c?.daemonUrl,daemonMachine:c?.machine??c?.daemonMachine}))))otherHomes.add(legacyId);
    const candidates=contexts(host).filter(c=>!otherHomes.has(c.id));
    const multiple=(config?.connections??[]).filter(c=>(c.machine??c.daemonMachine??null)===machine).length>1;
    const liveHost=hostLabelValue(remote?.selfHostId??(typeof host.selfHostId==='function'?host.selfHostId():null));
    let known=candidates.find(c=>c.home&&spaceMachine(c.space)===machine
      &&(!scoped||c.id===scoped)&&(c.id===scoped||c.tuis.some(t=>rigOrigin(t.labels?.["herdr-openrig.origin"])===rigOrigin(config.daemonUrl)
        &&(!t.labels?.["herdr-openrig.host"]||t.labels["herdr-openrig.host"]===liveHost))
        ||!multiple&&(!c.tuis.length||c.tuis.some(t=>!t.labels?.["herdr-openrig.origin"])))), space=known?.space;
    // A home made with another spelling of this daemon's address (127.0.0.1 then, 127.0.0.3 now) is the same home only when vouched for;
    // otherwise no second home is built.
    const adopt=new Set();
    if(!space&&machine){
      const found=homeCandidate(candidates,config,{hostId:remote?.selfHostId});
      if(found.unconfirmed)return fail(`OpenRig's home space on ${machine} was made with the address ${found.unconfirmed.origin??"an earlier one"}. Herdr could not confirm it is the same OpenRig as ${config.daemonUrl}, so no second home was opened. ${unconfirmedSpaceNextSteps("OpenRig")}`);
      if(found.context){
        try{await markHomeSpace(host,config,found.terminals,{hostId:remote?.selfHostId});}catch(error){return fail(errorDiagnostic(error));}
        known=found.context;space=known.space;for(const t of found.terminals)adopt.add(t.address);
        await save(host,{...legacyHome(config,space.id),homeSpaces:{...(state(host).homeSpaces??{}),[key]:space.id}});
      }
    }
    if(!space&&multiple&&candidates.some(c=>c.home&&spaceMachine(c.space)===machine))
      return fail("This home space has no confirmed OpenRig connection. Choose its own connection or close it after saving work; no page or terminal was opened.");
    if(space && !needTui) return {ok:true,space:space.id};
    if(!space&&!mayCreate) return fail(NO_HOME_SPACE);
    if(typeof host.hc!=="function") return fail("Open the Rig sidebar to create OpenRig's home space.");
    const argv=remote?["env","-i","--",`HOME=${remote.home}`,`PATH=${remote.searchPath}`,`OPENRIG_URL=${remote.daemonUrl}`,"rig","tui"]:tuiArgv(config);
    let olderTui=false;
    if(space){
      // Reuse only a live TUI still represented by a pane in this home, never retained terminal history.
      for(const terminal of known.tuis){
        if(!adopt.has(terminal.address) && terminal.labels?.["herdr-openrig.origin"] && rigOrigin(terminal.labels["herdr-openrig.origin"])!==rigOrigin(config.daemonUrl)) continue;
        const pane=list(host,"panes").find(p=>p.terminal===terminal.address && space.tabs?.some(t=>t.id===p.tab));
        if(!pane) continue;
        let record=null;
        try{
          const response=await host.hc(["get","--json","--",terminal.address]);
          if(response.code===0)record=JSON.parse(response.stdout);
        }catch{}
        if(record && (!record.state || ["live","running"].includes(record.state)) && isTuiArgv(record.foreground?.argv??record.argv,config)){
          // The live foreground argv no longer includes the env wrapper after exec.
          // Only the original launch argv can prove this TUI started with ambient routing cleared.
          if(Array.isArray(record.argv)&&record.argv.length===argv.length&&argv.every((arg,index)=>record.argv[index]===arg))
            return {ok:true,reused:true,space:space.id,tab:pane.tab,terminal:terminal.address};
          olderTui=true;
        }
      }
    }
    const id=space?.id ?? machineId("sp-openrig-home-"+nonce(),machine), tab=machineId("tb-openrig-home-"+nonce(),machine);
    if(!configUnchanged(host,config))return fail("OpenRig's connection changed. No terminal was started.");
    if(remote){
      const checked=await host.prepareHome(config);if(!checked.ok)return checked;
      if(JSON.stringify(checked)!==JSON.stringify(remote))return fail("The remote machine changed while opening the TUI. No terminal was started.");
    }
    const started=await host.hc(["run",...(machine?["--on",machine]:[]),"--bg","--json","--no-parent",
      "--label",`herdr.space=${machineLocalId(id,machine)}`,"--label",`herdr.tab=${machineLocalId(tab,machine)}`,
      "--label","herdr-openrig.role=tui","--label","herdr-openrig.home=1",
      "--label",`herdr-openrig.origin=${origin(config)}`,...(hostLabelValue(remote?.selfHostId)?["--label",`herdr-openrig.host=${hostLabelValue(remote.selfHostId)}`]:[]),"--",...argv]);
    let address;try{address=JSON.parse(started?.stdout??"null")?.address;}catch{}
    if(!address || (machine?!String(address).startsWith(machine+"/"):String(address).includes("/")) || (started.code!==undefined && started.code!==0))
      return fail(`Herdr could not start OpenRig's TUI${machine?" on "+machine:" locally"}. No fallback tab was opened.`);
    const adoptedSpace=await adopted(host,()=>list(host,"spaces").find(s=>s.id===id
      && s.tabs?.some(t=>t.id===tab) && list(host,"panes").some(p=>p.tab===tab && p.terminal===address)));
    if(!adoptedSpace) return fail("Herdr has not adopted OpenRig's home terminal yet; check the local core before retrying.");
    if(!space) host.run("space.rename",{id,name:"OpenRig"});
    host.run("tab.rename",{id:tab,name:"Rig TUI"});
    await save(host,{...legacyHome(config,id),homeSpaces:{...(state(host).homeSpaces??{}),[key]:id}});
    if(olderTui)host.notify?.({title:"Started a new Rig TUI",body:"Your older Rig TUI tab can open OpenRig’s Rig layout here. Close it when you’re done with it.",level:"info"});
    return {ok:true,reused:false,space:id,tab,terminal:address};
  })();
  homeJobs.set(key,task);
  try{return await task;}finally{if(homeJobs.get(key)===task) homeJobs.delete(key);}
}

function select(host,space,tab,terminal){
  if(active(host)!==space) host.run("space.select",{id:space});
  if(tab) host.run("tab.select",{id:tab});
  if(terminal) host.run("pane.focus",{terminal});
}

async function perform(host,config,request,rig,key,ambiguous=false,ambiguousReason=null,staleRigId=false){
  // ONE RIG == ONE SPACE: a rig named only by a name that two OpenRigs share (or a bare seat in multiple rigs) cannot be told apart, so nothing is opened for it.
  if(ambiguous&&!request.background&&(request.kind==="grid"||request.kind==="page"&&!request.home))return fail(ambiguousReason||AMBIGUOUS_NAME);
  if(staleRigId&&!request.background&&(request.kind==="grid"||request.kind==="page"&&!request.home))return fail(STALE_RIG_REFUSAL);
  if(request.background){
    const targetRigId=rig?.id??request.rigId??key;
    if(targetRigId&&activeInPlaceOpen(host,config,targetRigId))return {ok:true,skipped:true};
    const destination=rigSpace(host,config,rig,key);
    if(!destination) return {ok:true,skipped:true};
    if(request.kind!=="grid" || !host.syncGrid) return fail("Unsupported background OpenRig operation.");
    return host.syncGrid(rig,{explicit:false});
  }
  if(request.kind==="attach"){
    const result=await attachToSeat({...host,routeOwner:true},request.seat,config,request.options??{});
    return publishUnconfirmed(host,config,rig?.id??request.seat?.rigId??request.rigId,result);
  }
  if(request.kind==="grid"){
    if(!rig || !host.syncGrid) return fail("OpenRig hasn't loaded this rig yet. Try again in a moment.");
    if(activeInPlaceOpen(host,config,rig.id))return fail(inPlaceSpaceRefusal(rig.name??rig.id));
    if(readInPlaceOpen(state(host),rig.id,config?.connectionId))await save(host,{inPlaceOpen:withoutInPlaceOpen(state(host),rig.id,config?.connectionId)});
    return host.syncGrid(rig,{explicit:true,...request.options});
  }
  if(request.kind==="tui"){
    const result=await home(host,config);
    if(result.ok) select(host,result.space,result.tab,result.terminal);
    return result;
  }
  if(request.kind!=="page") return fail("Unknown OpenRig open request.");
  const source=contexts(host).find(c=>c.id===request.sourceSpace);
  let legacySelection=false;
  const targetRigId=rig?.id??request.rigId??request.entry?.rigId??key;
  const entryRef=request.entry??{};
  const targetRigName=rig?.name??request.rig??entryRef.rig??(entryRef.kind==="rig"?entryRef.name:null)??targetRigId;
  const cachedStatus=!request.home&&key?readRigSpaceStatus(host.shared?.("rig.spaceStatus"),targetRigId,config):null;
  const priorInPlace=!request.home&&key?activeInPlaceOpen(host,config,targetRigId):null;
  let retryFailure=null,retriedOk=false;
  if(!request.home&&key&&(isFailedSpaceStatus(cachedStatus)||priorInPlace)){
    const progressId=config?.daemonMachine&&typeof host?.setShared==="function"?`space-retry-${nonce()}`:null;
    if(progressId)host.setShared("rig.status",{id:progressId,busy:true,ok:null,text:`Checking ${targetRigName}'s space on ${config.daemonMachine}…`,at:Date.now(),rig:targetRigName,rigId:targetRigId,conn:config.connectionId??null});
    let prep;
    try{prep=await retrySpacePreparation(host,config);}
    finally{if(progressId&&host.shared?.("rig.status")?.id===progressId)host.setShared("rig.status",null);}
    if(prep&&!prep.ok){
      retryFailure=prep;
      writeRigSpaceStatus(host,config,targetRigId,{...(cachedStatus??{}),...prep,ok:false,preparationFailed:true,retryable:prep.retryable??true,reason:prep.reason??cachedStatus?.reason});
    }else if(prep){
      retriedOk=true;
      const verifiedHostId=prep.selfHostId??prep.localHostId;
      if(verifiedHostId)host={...host,selfHostId:()=>verifiedHostId};
    }
  }
  let destination=null;
  if(!retryFailure){
    const adoption=!request.home&&key?await prepareRigSpaceAdoption(host,config,[key,rig?.id,rig?.name],vouchOf(host,rig)):{ok:true};
    if(!adoption.ok)return publishUnconfirmed(host,config,rig?.id??request.rigId,adoption);
    if(adoption.host)host=adoption.host;
    destination=adoption.space??(request.home ? null : key ? rigSpace(host,config,rig,key,true) : null);
    // An unlabelled legacy page can still be selected on a single-connection machine. With two connections on the machine, a page-only space could belong to the other OpenRig.
    const sameMachineConns=(config?.connections??[]).filter(c=>(c?.machine??null)===(config?.daemonMachine||null)).length;
    if(!request.home&&!key&&!request.newPage&&sameMachineConns<=1&&source?.legacy&&!source.tuis.length&&source.pages.length
      &&spaceMachine(source.space)===(config?.daemonMachine||null)){destination=source.space;legacySelection=true;}
    if(!request.home&&!key&&source?.owned&&source.rigs.length){
      // A cross-rig page still belongs to its connection. Check only its source, using the same origin/host vouch as a keyed page.
      const scoped={...host,spaces:()=>list(host,"spaces").filter(s=>s.id===source.id)};
      const sourceRig=source.rigs.map(ref=>{
        const byId=resolveRig(host.topology?.()??[],{rigId:ref,conn:config?.connectionId??null,config,allowNameFallback:false});
        if(byId.ambiguous)return null;
        if(byId.rig)return byId.rig;
        const byName=resolveRig(host.topology?.()??[],{name:ref,conn:config?.connectionId??null,config});
        return byName.ambiguous?null:(byName.rig??null);
      }).find(Boolean)??null;
      const vouch={...vouchOf(host,sourceRig),strictOrigin:true};
      const adopted=await prepareRigSpaceAdoption(scoped,config,source.rigs,vouch);
      if(!adopted.ok)return adopted;
      if(adopted.hostId)vouch.hostId=adopted.hostId;
      destination=adopted.space??resolveRigSpace(scoped,config,source.rigs,vouch);
      const other=unconfirmedRigSpace(scoped,config,source.rigs,vouch);
      if(!destination&&other)return fail(unconfirmedSpaceReason(source.space.name??source.rigs[0],config?.daemonMachine,other.origin,config?.daemonUrl,other));
    }
    if(!destination&&key&&!request.home){
      const refusal=unconfirmedRefusal(host,config,rig,key,request);
      if(refusal)return publishUnconfirmed(host,config,rig?.id??request.rigId??request.entry?.rigId,{...refusal,unconfirmedSpace:true});
      if(!retriedOk&&isFailedSpaceStatus(cachedStatus))retryFailure=cachedStatus;
    }
    if(destination&&!request.home&&key){
      if(isFailedSpaceStatus(cachedStatus))writeRigSpaceStatus(host,config,targetRigId,undefined);
      if(readInPlaceOpen(state(host),targetRigId,config?.connectionId))await save(host,{inPlaceOpen:withoutInPlaceOpen(state(host),targetRigId,config?.connectionId)});
    }else if(retriedOk&&isFailedSpaceStatus(cachedStatus)){
      writeRigSpaceStatus(host,config,targetRigId,undefined);
    }
  }
  // Asked from a Rig page (stayIfNoSpace) for a rig whose space check failed: the page already shows it, so nothing is selected or opened (the person may
  // have moved on while the machine was checked); the note says why the rig's own space didn't open.
  // The page is still recorded as this rig's in-place page in the Rig tab of the space it was asked from (its notice, and no space is built for the rig
  // while it is open), without selecting that tab.
  // The page as it is shown: with several OpenRigs it names the one it was opened for.
  const multi=(config?.connections?.length??0)>1,baseEntry=request.entry ?? {section:"topology"};
  const entry=multi&&config?.connectionId&&!baseEntry.conn?{...baseEntry,conn:config.connectionId}:baseEntry;
  // The Rig tab a page that stays goes onto: the one it was asked from when it is in the space it was asked from, else that space's pick.
  const stayTab=from=>{
    const fromTabs=from?list(host,"panes").filter(p=>p.mod===MOD_IDS.view&&(from.tabs??[]).some(t=>t.id===p.tab)).map(p=>p.tab):[];
    return fromTabs.includes(request.sourceTab)?request.sourceTab:pickRigTab(from,fromTabs,host.shared?.("rig.tabPages")??{});
  };
  // A machine space that shows one OpenRig takes no other OpenRig's page (pushTabPage refuses it): the page never stays in one, and no fallback picks one.
  const foreignMachine=space=>{const own=machineSpaceConn(config,space);return Boolean(own&&entry.conn&&entry.conn!==own);};
  const askedFrom=list(host,"spaces").find(s=>s.id===request.sourceSpace);
  if(retryFailure&&!destination&&request.stayIfNoSpace&&!request.home&&!foreignMachine(askedFrom)){
    const reason=retryFailure.reason||cachedStatus?.reason||"the rig's space is not reachable";
    const from=list(host,"spaces").find(s=>s.id===request.sourceSpace);
    const viewTab=stayTab(from);
    if(viewTab){
      pushTabPage(host,viewTab,entry,{spaceConn:machineSpaceConn(config,from)});
      await save(host,{inPlaceOpen:withInPlaceOpen(state(host),targetRigId,config?.connectionId,{at:Date.now(),reason,rigName:targetRigName,space:from.id,tab:viewTab})});
    }
    return {ok:true,stayed:true,inPlace:true,...(viewTab?{space:from.id,tab:viewTab}:{}),note:inPlaceFallbackNote(targetRigName,reason),reason};
  }
  if(retryFailure&&!destination){
    const spacesNow=list(host,"spaces"),panesNow=list(host,"panes");
    const activeSpace=spacesNow.find(s=>s.id===request.sourceSpace)??spacesNow.find(s=>s.active);
    const activeHasView=activeSpace&&!foreignMachine(activeSpace)&&panesNow.some(p=>p.mod===MOD_IDS.view&&(activeSpace.tabs??[]).some(t=>t.id===p.tab));
    destination=activeHasView?activeSpace
      :contexts(host).find(c=>c.home&&!foreignMachine(c.space)&&(!config?.daemonMachine||spaceMachine(c.space)!==config.daemonMachine))?.space
        ??[activeSpace,...spacesNow].find(s=>s&&!foreignMachine(s))??null;
    if(!destination&&!config?.daemonMachine){
      const result=await home(host,config,false,request.mayCreate===true||request.home===true);if(!result.ok)return result;
      destination=list(host,"spaces").find(s=>s.id===result.space);
    }
    if(!destination)return fail(retryFailure.reason||cachedStatus?.reason||"OpenRig's destination space is not reachable.");
  }
  // Asked from a Rig page on screen, for a rig that has no space of its own: the page opens in that Rig tab, in the space in view, not in the home space.
  if(!destination&&request.stayIfNoSpace&&!request.home&&!foreignMachine(askedFrom)){
    const from=askedFrom,viewTab=stayTab(from);
    if(viewTab)pushTabPage(host,viewTab,entry,{spaceConn:machineSpaceConn(config,from)});
    return {ok:true,stayed:true,...(viewTab?{space:from.id,tab:viewTab}:{})};
  }
  if(!destination){
    const result=await home(host,config,false,request.mayCreate===true||request.home===true); if(!result.ok) return result;
    destination=list(host,"spaces").find(s=>s.id===result.space);
  }
  if(!destination) return fail("OpenRig's destination space is no longer open. Try again.");
  const show=async()=>{
  // This page job may have waited behind another one for the same destination: a connections list installed meanwhile refuses it before its first side effect.
  const live=host.currentConfig?.();
  if(live?.configInvalid) return fail(live.configInvalid);
  // ...and so does a CHANGED connection (another address, home or machine): the job still holds the rig and the space of the daemon it was queued for.
  if(!configUnchanged(host,config)) return fail("OpenRig's connection changed. No page was opened.");
  const current=list(host,"spaces").find(s=>s.id===destination.id);
  if(!current) return fail("OpenRig's destination space closed before its page could open. Try again.");
  const routesNow=host.shared?.("rig.pageRoutes")??{},tabPagesNow=host.shared?.("rig.tabPages")??{};
  if(foreignMachine(current)) return fail("That space shows another OpenRig's pages, so this page wasn't opened there.");
  // The Rig tabs already in the destination: a new page is never put on one (the pick sees none), and the tab Herdr makes for it is the one not among them.
  const rigTabsHere=[...new Set(list(host,"panes").filter(p=>p.mod===MOD_IDS.view && current.tabs?.some(t=>t.id===p.tab)).map(p=>p.tab))];
  const viewTabs=request.newPage?[]:rigTabsHere;
  const foreignFallbackSpace=Boolean(retryFailure&&multi&&config?.connectionId&&(
    (config.daemonMachine||null)!==spaceMachine(current)
    ||(host.shared?.("herdrig.spaces")?.[current.id]?.conn&&host.shared("herdrig.spaces")[current.id].conn!==config.connectionId)
    ||(state(host).homeSpace===current.id&&config.connectionId!==LEGACY_CONNECTION_ID&&!Object.values(state(host).homeSpaces??{}).includes(current.id))
    ||(Object.values(state(host).homeSpaces??{}).includes(current.id)&&state(host).homeSpaces?.[homeKey(config)]!==current.id)
  ));
  // A tab's OpenRig is its own history's page, else the router's older record for it.
  const tabConn=id=>(tabPagesNow[id]?.stack?.at(-1)??routesNow[id])?.conn;
  // The tab the open came from when it is in the destination, else the space's active Rig tab, else the newest-changed unsettled one. In another
  // OpenRig's space reached by a fallback, only a Rig tab already on this OpenRig is reused; otherwise a new tab is made.
  let tab=request.newPage ? null : foreignFallbackSpace
    ? (viewTabs.includes(request.sourceTab)&&tabConn(request.sourceTab)===config.connectionId ? request.sourceTab : viewTabs.find(id=>tabConn(id)===config.connectionId)??null)
    : (viewTabs.includes(request.sourceTab) ? request.sourceTab : pickRigTab(current,viewTabs,tabPagesNow));
  if(!tab&&legacySelection)return fail("The Rig page closed. Open it again.");
  if(!tab){
    const existingTabs=new Set(rigTabsHere);
    host.run("tab.new",{space:destination.id,name:"Rig",mod:MOD_IDS.view,props:{entry,section:entry.section??"topology",...(entry.id?{id:entry.id}:{}),space:destination.id}}); // the tab's own space survives a restart
    tab=await adopted(host,()=>list(host,"panes").find(p=>p.mod===MOD_IDS.view && !existingTabs.has(p.tab)
      && list(host,"spaces").find(s=>s.id===destination.id)?.tabs?.some(t=>t.id===p.tab))?.tab);
    if(!tab) return fail("Herdr has not opened the Rig page yet. Check its mod errors before retrying.");
  }
  pushTabPage(host,tab,entry,{spaceConn:machineSpaceConn(config,current)});
  select(host,destination.id,tab);
  if(retryFailure){
    const reason=retryFailure.reason||cachedStatus?.reason||"the rig's space is not reachable";
    const note=inPlaceFallbackNote(targetRigName,reason);
    await save(host,{inPlaceOpen:withInPlaceOpen(state(host),targetRigId,config?.connectionId,{at:Date.now(),reason,rigName:targetRigName,space:destination.id,tab})});
    return {ok:true,inPlace:true,space:destination.id,tab,note,reason};
  }
  return {ok:true,space:destination.id,tab};
  };
  const previous=pageJobs.get(destination.id);
  const waitPage=previous?(host.waitQueue?host.waitQueue(()=>previous.settled):previous.settled):Promise.resolve();
  const job=waitPage.then(show);
  const pageEntry=queueBarrier(job,host,PAGE_JOB_HOLD_MS,previous);
  pageJobs.set(destination.id,pageEntry);
  try{return await job;}finally{if(pageJobs.get(destination.id)===pageEntry)pageJobs.delete(destination.id);}
}

export const PAGE_JOB_HOLD_MS = 15000;
function queueBarrier(promise, host, holdMs = 0, previous = null) {
  let prev = previous, rawRelease;
  const released = new Promise((r) => { rawRelease = r; });
  const unregister = host?.registerBarrier?.(rawRelease);
  const cleanup = () => { prev = null; unregister?.(); };
  const release = () => { const p = prev; cleanup(); p?.release?.(); rawRelease(); };
  const base = Promise.race([promise.catch(() => {}), released]).finally(cleanup);
  const holdTimer = host?.deadline; // polling hosts without an ownerless deadline clock wait on base as before
  return { promise, settled: holdMs > 0 && holdTimer ? Promise.race([base, holdTimer(holdMs)]) : base, release };
}

export function clearInterruptedRouteJob(config, rigNameOrKey = "home", spaceId = null) {
  const key = JSON.stringify([rigOrigin(config?.daemonUrl) ?? origin(config), config?.daemonMachine ?? "", rigNameOrKey]);
  const entry = jobs.get(key);
  if (entry) { jobs.delete(key); entry.release(); }
  const machine = config?.daemonMachine ?? "";
  for (const [id, p] of [...pageJobs.entries()]) {
    const sameMachine = spaceId ? id === spaceId : (machine ? String(id).startsWith(`${machine}/`) : !String(id).includes("/"));
    if (sameMachine) { pageJobs.delete(id); p.release(); }
  }
}

export async function routeOpen(host,config,request={}){
  // A refused connections list opens nothing, not even the local home space or a TUI that could not run: it has no address to open anything for.
  if(config?.configInvalid)return fail(config.configInvalid);
  if(config?.daemonMachine!==undefined&&config.daemonMachine!==""&&
    (typeof config.daemonMachine!=="string"||!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(config.daemonMachine)))
    return fail("daemonMachine must name a Herdr machine. No local terminal was started.");
  const selected={...request,sourceSpace:request.sourceSpace??active(host)};
  const preRig=selected.kind==="page"&&!selected.background&&!selected.home?requestRig(host,selected,config):null;
  if(preRig?.unownedNeed)return fail(preRig.ambiguousReason||AMBIGUOUS_NAME);
  // A page with no entry is Topology, stamped with this connection when several are set up (an unstamped page names no OpenRig there).
  if(selected.kind==="page") host.setShared?.("rig.nav",navPush(host.shared?.("rig.nav"),selected.entry??{section:"topology",...((config?.connections?.length??0)>1&&config?.connectionId?{conn:config.connectionId}:{})}));
  const tree=typeof host.layout==="function"?host.layout():host.layout;
  // Attach owns its normal open path unless a shown sidebar has a live lease; no envelope can cause a second open later.
  // Other request kinds also use their existing own path when the sidebar is not shown.
  const forward = selected.kind === "attach"
    ? receiverLive(host) && layoutShowsMod(tree,MOD_IDS.sidebar)
    : layoutShowsMod(tree,MOD_IDS.sidebar);
  if(!host.routeOwner && !selected.background && forward){
    const explicitConn=selected.conn??selected.entry?.conn??selected.seat?.conn;
    const routedRig=!explicitConn&&selected.kind==="page"?(preRig??requestRig(host,selected,config)):null;
    if(routedRig?.staleRigId)return fail(STALE_RIG_REFUSAL);
    const targetConn=explicitConn??(routedRig?.ambiguous?undefined:routedRig?.conn??(selected.kind==="page"&&!routedRig?.key?config?.connectionId:undefined));
    return forwardRigOpen(host,targetConn?{...selected,conn:targetConn}:selected);
  }
  const {rig,key,conn:rigConn,ambiguous,ambiguousReason,staleRigId}=preRig??requestRig(host,selected,config);
  if(!selected.background&&!ambiguous&&rigConn&&config?.connectionId&&rigConn!==config.connectionId)return fail(OTHER_CONNECTION_REFUSAL);
  const queueKey=JSON.stringify([rigOrigin(config?.daemonUrl)??origin(config),config?.daemonMachine??"",rig?.name??key??"home"]);
  const previous=jobs.get(queueKey);
  const waitJob=previous?(host.waitQueue?host.waitQueue(()=>previous.settled):previous.settled):Promise.resolve();
  const job=waitJob.then(()=>{
    // The request waited behind earlier work: a connections list installed meanwhile refuses it now, whatever config it was queued under.
    const current=host.currentConfig?.();
    if(current?.configInvalid)return fail(current.configInvalid);
    // ...and a CHANGED connection refuses it too: the captured rig and key belong to the daemon it was queued for (another address would open that rig's viewers in a space labelled for the new one).
    if(!configUnchanged(host,config))return fail("OpenRig's connection changed. Nothing was opened.");
    return perform(host,config,selected,rig,key,ambiguous,ambiguousReason,staleRigId);
  });
  const jobEntry=queueBarrier(job,host,0,previous);
  jobs.set(queueKey,jobEntry);
  try{return await job;}catch(error){
    const msg=errorDiagnostic(error),step=host.currentStep?.();
    return fail(step&&!msg.includes(step)?`Couldn't finish while ${step}: ${msg}`:msg);
  }
  finally{if(jobs.get(queueKey)===jobEntry) jobs.delete(queueKey);}
}
