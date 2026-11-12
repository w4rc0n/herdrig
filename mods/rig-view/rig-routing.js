// All explicit opens and background grid reconciliation pass through this coordinator.
import { MOD_IDS, layoutHasMod, navPush, tuiArgv, isTuiArgv, attachToSeat } from "./rig-lib.js";
import { openRigSpaceContext, resolveRigSpace, rigOrigin } from "./rig-space-context.js";

const jobs = new Map(), homeJobs = new Map(), pageJobs = new Map();
const list = (host, key) => (typeof host[key] === "function" ? host[key]() : host[key]) ?? [];
const active = host => list(host, "spaces").find(s => s.active)?.id ?? null;
const state = host => host.routeState?.() ?? host.shared?.("rig.spaceState") ?? {};
const contexts = host => openRigSpaceContext(list(host,"spaces"),list(host,"terminals"),list(host,"panes"),state(host),MOD_IDS.view);
const origin = config => String(config?.daemonUrl ?? "").replace(/\/$/,"");
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

/** Only the explicit Move button calls this; mixed tabs and replaced TUI shells are never closed. */
export async function migrateRigTabs(host, config, spaceId) {
  const source=contexts(host).find(c=>c.id===spaceId);
  if(!source?.legacy) return fail("Those OpenRig tabs have changed. Refresh before moving them.");
  const candidates=[...new Set([...source.pages.map(p=>p.tab),...source.tuis.map(t=>list(host,"panes").find(p=>p.terminal===t.address)?.tab)].filter(Boolean))];
  const validate=async tab=>{
    const space=list(host,"spaces").find(s=>s.id===spaceId);
    if(!space?.tabs?.some(t=>t.id===tab)) return null;
    const panes=list(host,"panes").filter(p=>p.tab===tab);
    if(!panes.length) return null;
    const expected=JSON.stringify(panes.map(p=>[p.pane,p.mod,p.terminal]));
    for(const pane of panes){
      if(pane.mod===MOD_IDS.view) continue;
      const terminal=list(host,"terminals").find(t=>t.address===pane.terminal && t.labels?.["herdr-openrig.role"]==="tui");
      if(!terminal || !host.hc) return null;
      let record;try{record=JSON.parse((await host.hc(["get","--json","--",terminal.address])).stdout);}catch{return null;}
      if(!record || (record.state && !["live","running"].includes(record.state)) || !isTuiArgv(record.foreground?.argv??record.argv,config)) return null;
    }
    // Re-read after async checks; compare identities, not a cached tabs array.
    const now=list(host,"panes").filter(p=>p.tab===tab);
    if(JSON.stringify(now.map(p=>[p.pane,p.mod,p.terminal]))!==expected) return null;
    return panes;
  };
  for(const tab of candidates){
    const panes=await validate(tab);
    if(!panes) return fail("This tab includes a personal pane or a changed TUI. It was left where it is.");
    const entry=host.shared?.("rig.pageRoutes")?.[tab] ?? host.shared?.("rig.nav")?.stack?.at(-1) ?? {section:"topology"};
    const result=await routeOpen({...host,routeOwner:true},config,panes.some(p=>p.mod===MOD_IDS.view)
      ? {kind:"page",entry,home:true,newPage:true} : {kind:"tui"});
    if(!result.ok) return result;
    if(!await validate(tab)) return fail("The original tab changed while opening its replacement. It was left where it is.");
    host.run("tab.close",{id:tab});
  }
  await save(host,{tabMigration:{...(state(host).tabMigration??{}),[spaceId]:"move"}});
  return {ok:true};
}

function requestRig(host, request) {
  const entry=request.entry ?? {};
  const key=request.rigId ?? request.rig ?? request.seat?.rig ?? entry.rigId ?? entry.rig
    ?? (entry.kind==="rig" ? entry.name : null);
  const topology=host.topology?.() ?? host.shared?.("rig.data")?.topology ?? [];
  const rig=topology.find(r=>r.id===key || r.name===key);
  return {rig,key};
}
function rigSpace(host,config,rig,key){
  return resolveRigSpace(host,config,[key,rig?.id,rig?.name]);
}

async function save(host,patch){
  const next={...state(host),...patch};
  host.setShared?.("rig.spaceState",next);
  if(host.saveRouteState) await host.saveRouteState(patch);
}

async function home(host,config,needTui=true){
  const key=origin(config);
  if(homeJobs.has(key)) {
    const pending=homeJobs.get(key),result=await pending;
    if(result.ok && needTui && !result.tab) {
      if(homeJobs.get(key)===pending) homeJobs.delete(key);
      return home(host,config,true);
    }
    return result;
  }
  const task=(async()=>{
    let known=contexts(host).find(c=>c.home), space=known?.space;
    if(space && !needTui) return {ok:true,space:space.id};
    if(space){
      // Reuse only a live TUI still represented by a pane in this home, never retained terminal history.
      for(const terminal of known.tuis){
        if(terminal.labels?.["herdr-openrig.origin"] && terminal.labels["herdr-openrig.origin"].replace(/\/$/,"")!==key) continue;
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
    const id=space?.id ?? "sp-openrig-home-"+nonce(), tab="tb-openrig-home-"+nonce();
    const started=await host.hc(["run","--bg","--json","--no-parent",
      "--label",`herdr.space=${id}`,"--label",`herdr.tab=${tab}`,
      "--label","herdr-openrig.role=tui","--label","herdr-openrig.home=1",
      "--label",`herdr-openrig.origin=${key}`,"--",...tuiArgv(config)]);
    let address;try{address=JSON.parse(started?.stdout??"null")?.address;}catch{}
    if(!address || String(address).includes("/") || (started.code!==undefined && started.code!==0))
      return fail("Herdr could not start OpenRig's local TUI. No fallback tab was opened.");
    const adoptedSpace=await adopted(host,()=>list(host,"spaces").find(s=>s.id===id
      && s.tabs?.some(t=>t.id===tab) && list(host,"panes").some(p=>p.tab===tab && p.terminal===address)));
    if(!adoptedSpace) return fail("Herdr has not adopted OpenRig's home terminal yet; check the local core before retrying.");
    if(!space) host.run("space.rename",{id,name:"OpenRig"});
    host.run("tab.rename",{id:tab,name:"Rig TUI"});
    await save(host,{homeSpace:id});
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

async function perform(host,config,request,rig,key){
  if(request.background){
    const destination=rigSpace(host,config,rig,key);
    if(!destination) return {ok:true,skipped:true};
    if(request.kind!=="grid" || !host.syncGrid) return fail("Unsupported background OpenRig operation.");
    return host.syncGrid(rig,{explicit:false});
  }
  if(request.kind==="attach"){
    const result=await attachToSeat({...host,routeOwner:true},request.seat,config,request.options??{});
    return result;
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
  let destination=request.home ? null : key ? rigSpace(host,config,rig,key) : source?.owned ? source.space : null;
  if(!destination){
    const result=await home(host,config,false); if(!result.ok) return result;
    destination=list(host,"spaces").find(s=>s.id===result.space);
  }
  if(!destination) return fail("OpenRig's destination space is no longer open. Try again.");
  const entry=request.entry ?? {section:"topology"};
  const show=async()=>{
  const current=list(host,"spaces").find(s=>s.id===destination.id);
  if(!current) return fail("OpenRig's destination space closed before its page could open. Try again.");
  let tab=request.newPage ? null : list(host,"panes").find(p=>p.mod===MOD_IDS.view && current.tabs?.some(t=>t.id===p.tab))?.tab;
  if(!tab){
    host.run("tab.new",{space:destination.id,name:"Rig",mod:MOD_IDS.view,props:{entry,section:entry.section??"topology",...(entry.id?{id:entry.id}:{})}});
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
  const selected={...request,sourceSpace:request.sourceSpace??active(host)};
  if(selected.kind==="page") host.setShared?.("rig.nav",navPush(host.shared?.("rig.nav"),selected.entry??{section:"topology"}));
  const tree=typeof host.layout==="function"?host.layout():host.layout;
  if(!host.routeOwner && layoutHasMod(tree,MOD_IDS.sidebar) && !selected.background)
    return forwardRigOpen(host,selected);
  const {rig,key}=requestRig(host,selected);
  const queueKey=JSON.stringify([rigOrigin(config?.daemonUrl)??origin(config),config?.daemonMachine??"",rig?.name??key??"home"]);
  const job=(jobs.get(queueKey)??Promise.resolve()).catch(()=>{}).then(()=>perform(host,config,selected,rig,key));
  jobs.set(queueKey,job);
  try{return await job;}catch(error){return fail(String(error?.message??error));}
  finally{if(jobs.get(queueKey)===job) jobs.delete(queueKey);}
}
