// All explicit opens and background grid reconciliation pass through this coordinator.
import { MOD_IDS, layoutHasMod, navPush, tuiArgv, isTuiArgv, attachToSeat, rigSeatServers } from "./rig-lib.js";
import { openRigSpaceContext, resolveRigSpace, unconfirmedRigSpace, unconfirmedSpaceReason, unconfirmedSpaceNextSteps, rigOrigin, rigSessions, homeCandidate, markHomeSpace, hostLabelValue, prepareRigSpaceAdoption } from "./rig-space-context.js";
import { machineId, machineLocalId } from "./rig-remote.js";
import { LEGACY_CONNECTION_ID, pickRig, AMBIGUOUS_NAME } from "./rig-connections.js";
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
  const routes=host.shared?.('rig.pageRoutes')??{};
  for(const page of context.pages??[]){
    const entry=routes[page.tab]??page.props?.entry??page.props;
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
const ROUTE_ACK_POLL_MS = 100;
// Leave one polling interval before expiry, including the final acknowledgement check.
const ROUTE_ACK_POLLS = Math.floor((ROUTE_REQUEST_EXPIRY_MS - ROUTE_ACK_POLL_MS) / ROUTE_ACK_POLL_MS);

async function adopted(host, predicate) {
  for (let n=0;n<100;n++) {
    const value=predicate(); if(value) return value;
    if (!host.wait && typeof setTimeout !== "function") break;
    await wait(host,100);
  }
  return null;
}

/** A receipt proves a live sidebar accepted the operation; its existing result notices report execution failures. */
export async function forwardRigOpen(host, request) {
  if (!host.shared || !host.setShared || !host.run || (!host.wait && typeof setTimeout !== "function"))
    return fail(request.kind==="attach" ? "Open the Rig sidebar to attach." : "Open the Rig sidebar, then try again.");
  const id="open-"+nonce();
  const expiresAt = Date.now() + ROUTE_REQUEST_EXPIRY_MS;
  host.setShared("rig.routeRequests",{...(host.shared("rig.routeRequests")??{}),[id]:{request,expiresAt}});
  let dispatched=false;
  for(let n=0;n<=ROUTE_ACK_POLLS && Date.now()<expiresAt;n++){
    // This lifecycle hint avoids Herdr's extra "unknown command" toast for a sidebar that never loaded.
    // A hint alone is never success: the consumed request's acknowledgement is still required.
    if(!dispatched && Object.values(host.shared("rig.routeReceivers")??{}).some(Boolean)){
      try { host.run(`rig.route:${id}`); dispatched=true; }
      catch(error){
        const pending={...(host.shared("rig.routeRequests")??{})};delete pending[id];host.setShared("rig.routeRequests",pending);
        return fail(String(error?.message??error));
      }
    }
    if(host.shared("rig.routeReplies")?.[id]){
      const replies={...(host.shared("rig.routeReplies")??{})}; delete replies[id]; host.setShared("rig.routeReplies",replies);
      return {ok:true,routed:true,accepted:true};
    }
    if(n<ROUTE_ACK_POLLS) await wait(host,ROUTE_ACK_POLL_MS);
  }
  const pending={...(host.shared("rig.routeRequests")??{})}; delete pending[id]; host.setShared("rig.routeRequests",pending);
  const replies={...(host.shared("rig.routeReplies")??{})}; delete replies[id]; host.setShared("rig.routeReplies",replies);
  return fail(request.kind==="attach" ? "Open the Rig sidebar to attach." : "Open the Rig sidebar, then try again.");
}

/** Consume before acknowledging: a second sidebar or a late delivery cannot run an open twice. */
export function acceptRigOpen(host, id) {
  if(typeof id!=="string") return null;
  const pending={...(host.shared("rig.routeRequests")??{})};
  const envelope=pending[id];
  if(!envelope) return null;
  delete pending[id]; host.setShared("rig.routeRequests",pending);
  if(!Number.isFinite(envelope.expiresAt) || envelope.expiresAt<=Date.now() || !envelope.request) return null;
  host.setShared("rig.routeReplies",{...(host.shared("rig.routeReplies")??{}),[id]:true});
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
      const entry=host.shared?.("rig.pageRoutes")?.[request.tabId]??host.shared?.("rig.nav")?.stack?.at(-1)??{section:"topology"};
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
    }catch(error){return fail(String(error?.message??error));}
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
      const entry=host.shared?.("rig.pageRoutes")?.[tab]??host.shared?.("rig.nav")?.stack?.at(-1)??{section:"topology"};
      const result=await routeOpen({...host,routeOwner:true},config,checked.panes.some(p=>p.mod===MOD_IDS.view)
        ?{kind:"page",entry,home:true}:{kind:"tui"});
      if(!result.ok){left.push({...checked,ok:false,replaceable:false,reason:result.reason});continue;}
      const current=await inspectMigrationTab(host,config,spaceId,tab);
      if(!current.ok||current.fingerprint!==checked.fingerprint){left.push({...checked,ok:false,replaceable:false,reason:"the original tab changed while opening its destination"});continue;}
      host.run("tab.close",{id:tab});
      if(!await adopted(host,()=>!list(host,"spaces").find(s=>s.id===spaceId)?.tabs?.some(t=>t.id===tab))){
        left.push({...checked,ok:false,replaceable:false,pendingClose:true,destination:result.space,reason:"its destination opened, but closing the original tab was not confirmed"});continue;
      }
      moved.push({...checked,destination:result.space});
    }catch(error){left.push({tabId:tab,name:list(host,"spaces").find(s=>s.id===spaceId)?.tabs?.find(t=>t.id===tab)?.name||tab,replaceable:false,reason:String(error?.message??error)});}
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
  if(checked.panes.some(p=>p.mod===MOD_IDS.view)){
    const entry=host.shared?.("rig.pageRoutes")?.[request.tabId]??host.shared?.("rig.nav")?.stack?.at(-1)??{section:"topology"};
    const page=await routeOpen({...host,routeOwner:true},config,{kind:"page",entry,home:true});
    if(!page.ok)return page;
  }
  const opened=await routeOpen({...host,routeOwner:true},config,{kind:"tui"});
  if(!opened.ok)return opened;
  try{
    const response=await host.hc(["get","--json","--",opened.terminal]);
    const fresh=JSON.parse(response.stdout);
    if(response.code!==0||!fresh||fresh.state&&!['live','running'].includes(fresh.state)||!isTuiArgv(fresh.foreground?.argv??fresh.argv,config))
      return fail("The fresh TUI didn't stay running. The original tab was left here.");
  }catch{return fail("Herdr could not verify the fresh TUI. The original tab was left here.");}
  const current=await inspectMigrationTab(host,config,request.spaceId,request.tabId);
  if(!current.replaceable||current.fingerprint!==checked.fingerprint)return fail("The original tab changed while its replacement opened. It was left here.");
  host.run("tab.close",{id:request.tabId,confirmed:true});
  if(!await adopted(host,()=>!list(host,"spaces").find(s=>s.id===request.spaceId)?.tabs?.some(t=>t.id===request.tabId)))
    return fail("The fresh TUI opened, but closing the original tab was not confirmed. Check the original before retrying.");
  const remaining=contexts(host).find(c=>c.id===request.spaceId);
  let error=null;
  if(source&&!remaining?.pages.length&&!remaining?.tuis.length)
    try{await recordMigrationComplete(host,config,source,opened.space);}catch(failure){error=`TUI replaced, but the migration choice could not be saved: ${failure.message}`;}
  return {ok:true,...opened,error};
}

function requestRig(host, request) {
  const entry=request.entry ?? {};
  const key=request.rigId ?? request.rig ?? request.seat?.rig ?? entry.rigId ?? entry.rig
    ?? (entry.kind==="rig" ? entry.name : null);
  const topology=host.topology?.() ?? host.shared?.("rig.data")?.topology ?? [];
  // An id is exact (and with its connection when the request has one); a name on two OpenRigs picks neither.
  const conn=request.conn ?? entry.conn;
  const byId=pickRig(topology,{rigId:key,conn}).rig;
  // A name on more than one OpenRig is not "no rig": it is refused by the caller (never a home or a space instead).
  const byName=byId?{}:pickRig(topology,{name:key,conn});
  return {rig:byId??byName.rig,key,ambiguous:Boolean(byName.ambiguous)};
}
const vouchOf=(host,rig)=>({sessions:rigSessions(rig),servers:rigSeatServers(rig),hostId:typeof host?.selfHostId==="function"?host.selfHostId():host?.selfHostId});
function rigSpace(host,config,rig,key,strictOrigin=false){
  return resolveRigSpace(host,config,[key,rig?.id,rig?.name],{...vouchOf(host,rig),strictOrigin});
}
/** A refusal for an unconfirmed space stays on the sidebar (the card there, with a Dismiss), not only in a toast that fades with its way
 *  forward cut off: it is published as that rig's space status, the same place the grid's own failures go. */
function publishUnconfirmed(host,rigId,result){
  if(!rigId||!result?.unconfirmedSpace||typeof host?.setShared!=="function")return result;
  host.setShared("rig.spaceStatus",{...(host.shared?.("rig.spaceStatus")??{}),[rigId]:result});
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

async function save(host,patch){
  const next={...state(host),...patch};
  host.setShared?.("rig.spaceState",next);
  if(host.saveRouteState) await host.saveRouteState(patch);
}

async function home(host,config,needTui=true){
  const key=homeKey(config),machine=config?.daemonMachine||null;
  if(homeJobs.has(key)) {
    const pending=homeJobs.get(key),result=await pending;
    if(result.ok && needTui && !result.tab) {
      if(homeJobs.get(key)===pending) homeJobs.delete(key);
      return home(host,config,true);
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
    const scoped=state(host).homeSpaces?.[key];
    // Only a home recorded for ANOTHER listed connection is hidden from this one. A home recorded under any other key (another spelling of this daemon's address,
    // a key an earlier version wrote) is this connection's own to find, as in v0.4.7: hiding it built a second home space for the same OpenRig.
    // The own entry is left out by ID, never by key: on a default install its entry has no address (key ["",null]) while the live key carries the address the CLI found.
    const siblingKeys=new Set((config?.connections??[]).filter(c=>c?.id!==config?.connectionId).map(c=>homeKey({daemonUrl:c?.daemonUrl,daemonMachine:c?.machine??c?.daemonMachine}))); siblingKeys.delete(key); // and never this connection's own key, even when a hand-written list gives another entry the same address
    const otherHomes=new Set(Object.entries(state(host).homeSpaces??{}).filter(([k])=>siblingKeys.has(k)).map(([,id])=>id));
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
        try{await markHomeSpace(host,config,found.terminals,{hostId:remote?.selfHostId});}catch(error){return fail(String(error?.message??error));}
        known=found.context;space=known.space;for(const t of found.terminals)adopt.add(t.address);
        await save(host,{...legacyHome(config,space.id),homeSpaces:{...(state(host).homeSpaces??{}),[key]:space.id}});
      }
    }
    if(!space&&multiple&&candidates.some(c=>c.home&&spaceMachine(c.space)===machine))
      return fail("This home space has no confirmed OpenRig connection. Choose its own connection or close it after saving work; no page or terminal was opened.");
    if(space && !needTui) return {ok:true,space:space.id};
    if(space){
      // Reuse only a live TUI still represented by a pane in this home, never retained terminal history.
      for(const terminal of known.tuis){
        if(!adopt.has(terminal.address) && terminal.labels?.["herdr-openrig.origin"] && rigOrigin(terminal.labels["herdr-openrig.origin"])!==rigOrigin(config.daemonUrl)) continue;
        const pane=list(host,"panes").find(p=>p.terminal===terminal.address && space.tabs?.some(t=>t.id===p.tab));
        if(!pane) continue;
        let record=null;
        try{record=JSON.parse((await host.hc(["get","--json","--",terminal.address])).stdout);}catch{}
        const argv=record?.foreground?.argv ?? record?.argv;
        if(record && (!record.state || ["live","running"].includes(record.state)) && isTuiArgv(argv,config))
          return {ok:true,reused:true,space:space.id,tab:pane.tab,terminal:terminal.address};
      }
    }
    if(typeof host.hc!=="function") return fail("Open the Rig sidebar to create OpenRig's home space.");
    const id=space?.id ?? machineId("sp-openrig-home-"+nonce(),machine), tab=machineId("tb-openrig-home-"+nonce(),machine);
    const argv=remote?["env","-i","--",`HOME=${remote.home}`,`PATH=${remote.searchPath}`,`OPENRIG_URL=${remote.daemonUrl}`,"rig","tui"] /* the machine's own default home: a connection's openrigHome is this computer's folder */:tuiArgv(config);
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

async function perform(host,config,request,rig,key,ambiguous=false){
  // ONE RIG == ONE SPACE: a rig named only by a name that two OpenRigs share cannot be told apart, so nothing is opened for it.
  if(ambiguous&&!request.background&&(request.kind==="grid"||request.kind==="page"&&!request.home))return fail(AMBIGUOUS_NAME);
  if(request.background){
    const destination=rigSpace(host,config,rig,key);
    if(!destination) return {ok:true,skipped:true};
    if(request.kind!=="grid" || !host.syncGrid) return fail("Unsupported background OpenRig operation.");
    return host.syncGrid(rig,{explicit:false});
  }
  if(request.kind==="attach"){
    const result=await attachToSeat({...host,routeOwner:true},request.seat,config,request.options??{});
    return publishUnconfirmed(host,rig?.id??request.seat?.rigId??request.rigId,result);
  }
  if(request.kind==="grid"){
    if(!rig || !host.syncGrid) return fail("OpenRig hasn't loaded this rig yet. Try again in a moment.");
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
  const adoption=!request.home&&key?await prepareRigSpaceAdoption(host,config,[key,rig?.id,rig?.name],vouchOf(host,rig)):{ok:true};
  if(!adoption.ok)return publishUnconfirmed(host,rig?.id??request.rigId,adoption);
  if(adoption.host)host=adoption.host;
  let destination=adoption.space??(request.home ? null : key ? rigSpace(host,config,rig,key,true) : null);
  // An unlabelled legacy page can still be selected. This does not authorise a new tab or adopt its space.
  if(!request.home&&!key&&!request.newPage&&source?.legacy&&!source.tuis.length&&source.pages.length
    &&spaceMachine(source.space)===(config?.daemonMachine||null)){destination=source.space;legacySelection=true;}
  if(!request.home&&!key&&source?.owned&&source.rigs.length){
    // A cross-rig page still belongs to its connection. Check only its source, using the same origin/host vouch as a keyed page.
    const scoped={...host,spaces:()=>list(host,"spaces").filter(s=>s.id===source.id)};
    const sourceRig=(host.topology?.()??[]).find(r=>source.rigs.some(name=>name===r.id||name===r.name));
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
    if(refusal)return publishUnconfirmed(host,rig?.id??request.rigId??request.entry?.rigId,{...refusal,unconfirmedSpace:true});
  }
  if(!destination){
    const result=await home(host,config,false); if(!result.ok) return result;
    destination=list(host,"spaces").find(s=>s.id===result.space);
  }
  if(!destination) return fail("OpenRig's destination space is no longer open. Try again.");
  const entry=request.entry ?? {section:"topology"};
  const show=async()=>{
  // This page job may have waited behind another one for the same destination: a connections list installed meanwhile refuses it before its first side effect.
  const live=host.currentConfig?.();
  if(live?.configInvalid) return fail(live.configInvalid);
  // ...and so does a CHANGED connection (another address, home or machine): the job still holds the rig and the space of the daemon it was queued for.
  if(!configUnchanged(host,config)) return fail("OpenRig's connection changed. No page was opened.");
  const current=list(host,"spaces").find(s=>s.id===destination.id);
  if(!current) return fail("OpenRig's destination space closed before its page could open. Try again.");
  let tab=request.newPage ? null : list(host,"panes").find(p=>p.mod===MOD_IDS.view && current.tabs?.some(t=>t.id===p.tab))?.tab;
  if(!tab&&legacySelection)return fail("The Rig page closed. Open it again.");
  if(!tab){
    host.run("tab.new",{space:destination.id,name:"Rig",mod:MOD_IDS.view,props:{entry,section:entry.section??"topology",...(entry.id?{id:entry.id}:{}),space:destination.id}}); // the tab's own space survives a restart
    tab=await adopted(host,()=>list(host,"panes").find(p=>p.mod===MOD_IDS.view
      && list(host,"spaces").find(s=>s.id===destination.id)?.tabs?.some(t=>t.id===p.tab))?.tab);
    if(!tab) return fail("Herdr has not opened the Rig page yet. Check its mod errors before retrying.");
  }
  const routes={...(host.shared?.("rig.pageRoutes")??{}),[tab]:entry}; host.setShared?.("rig.pageRoutes",routes);
  select(host,destination.id,tab);
  return {ok:true,space:destination.id,tab};
  };
  const previous=pageJobs.get(destination.id),job=(previous??Promise.resolve()).catch(()=>{}).then(show);
  pageJobs.set(destination.id,job);
  try{return await job;}finally{if(pageJobs.get(destination.id)===job)pageJobs.delete(destination.id);}
}

export async function routeOpen(host,config,request={}){
  // A refused connections list opens nothing, not even the local home space or a TUI that could not run: it has no address to open anything for.
  if(config?.configInvalid)return fail(config.configInvalid);
  if(config?.daemonMachine!==undefined&&config.daemonMachine!==""&&
    (typeof config.daemonMachine!=="string"||!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(config.daemonMachine)))
    return fail("daemonMachine must name a Herdr machine. No local terminal was started.");
  const selected={...request,sourceSpace:request.sourceSpace??active(host)};
  if(selected.kind==="page") host.setShared?.("rig.nav",navPush(host.shared?.("rig.nav"),selected.entry??{section:"topology"}));
  const tree=typeof host.layout==="function"?host.layout():host.layout;
  if(!host.routeOwner && layoutHasMod(tree,MOD_IDS.sidebar) && !selected.background)
    return forwardRigOpen(host,selected.kind==="page"&&!requestRig(host,selected).key&&config?.connectionId
      ?{...selected,conn:selected.conn??config.connectionId}:selected);
  const {rig,key,ambiguous}=requestRig(host,selected);
  const queueKey=JSON.stringify([rigOrigin(config?.daemonUrl)??origin(config),config?.daemonMachine??"",rig?.name??key??"home"]);
  const job=(jobs.get(queueKey)??Promise.resolve()).catch(()=>{}).then(()=>{
    // The request waited behind earlier work: a connections list installed meanwhile refuses it now, whatever config it was queued under.
    const current=host.currentConfig?.();
    if(current?.configInvalid)return fail(current.configInvalid);
    // ...and a CHANGED connection refuses it too: the captured rig and key belong to the daemon it was queued for (another address would open that rig's viewers in a space labelled for the new one).
    if(!configUnchanged(host,config))return fail("OpenRig's connection changed. Nothing was opened.");
    return perform(host,config,selected,rig,key,ambiguous);
  });
  jobs.set(queueKey,job);
  try{return await job;}catch(error){return fail(String(error?.message??error));}
  finally{if(jobs.get(queueKey)===job) jobs.delete(queueKey);}
}
