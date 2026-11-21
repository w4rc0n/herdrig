import { errorDiagnostic } from "./rig-words.js";
// The sidebar owns reconciliation. Daemon previews are read-only; Herdr owns PTYs.
import {isValidSessionName,rigSeatServers} from "./rig-lib.js";
import {hostWorkerPlan,workerPad} from "./rig-worker-views.js";
import {machineId,machineLocalId} from "./rig-remote.js";
import {rigOrigin,resolveRigSpace,unconfirmedRigSpace,unconfirmedSpaceReason,openRigSpaceContext,sameDaemonOrigin,hostLabelValue,prepareRigSpaceAdoption} from "./rig-space-context.js";
import {rigSpaceRelocation,localGridPreflight} from "./rig-spaces.js";
import {LEGACY_CONNECTION_ID} from "./rig-connections.js";

const list=(host,key)=>(typeof host[key]==="function"?host[key]():host[key])??[];
// Another connection's worker views are its own even when it shares an address spelling; the legacy connection's keys are the old ones
// (stored views stay found).
const own=config=>config?.connectionId&&config.connectionId!==LEGACY_CONNECTION_ID?[config.connectionId]:[];
const identity=config=>JSON.stringify([rigOrigin(config?.daemonUrl),config?.daemonMachine,config?.rig??null,...own(config)]);
const keyFor=(config,view)=>JSON.stringify([rigOrigin(config?.daemonUrl),config?.daemonMachine,view,...own(config)]);
export {identity as workerIdentity,keyFor as workerViewKey};
const nonce=()=>`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
const addr=terminal=>terminal?.address??terminal?.terminal;
// Herdr's display/seen labels change during ordinary adoption. Bind only ownership labels.
const snapshot=(terminal,pane)=>JSON.stringify({address:addr(terminal),argv:terminal?.argv,labels:Object.fromEntries(Object.entries(terminal?.labels??{})
  .filter(([key])=>key.startsWith("herdr-openrig.")||key==="herdr.space"||key==="herdr.tab").sort(([a],[b])=>a.localeCompare(b))),
  pid:terminal?.pid,created:terminal?.created_ms,pane:pane?.pane,tab:pane?.tab});
// Splitting may overlap markRigSpace repairing this rig's labels. Accept only its one-way,
// verified transitions; all other identity fields and labels still bind the target. Close/prune
// continue comparing the original strict snapshot, with no repair tolerance.
export function sameSplitTarget(before,after,config,remote){
  const prior=JSON.parse(before.snapshot),next=JSON.parse(after.snapshot),a=prior.labels,b=next.labels;
  for(const key of ['herdr-openrig.space','herdr-openrig.origin','herdr-openrig.host']){
    if(a[key]===b[key])continue;
    if(key==='herdr-openrig.space'){
      if(b[key]!=='1')return false;
    }else if(key==='herdr-openrig.origin'){
      if(!a[key]||b[key]!==String(config.daemonUrl).replace(/\/$/,'')
        ||!sameDaemonOrigin(a[key],rigOrigin(config.daemonUrl),config.daemonMachine))return false;
    }else{
      const stamp=hostLabelValue(remote.selfHostId);
      if(a[key]||!stamp||b[key]!==stamp)return false;
    }
    a[key]=b[key];
  }
  prior.labels=Object.fromEntries(Object.entries(a).sort(([x],[y])=>x.localeCompare(y)));
  return JSON.stringify(prior)===JSON.stringify(next);
}
function payloadFrom(value){
  if(typeof value!=="string"||value.length>21848||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new Error("Invalid worker payload");
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";let bits=0,buffer=0,escaped="";
  for(const char of value.replace(/=+$/,"")){
    buffer=(buffer<<6)|alphabet.indexOf(char);bits+=6;
    if(bits>=8){bits-=8;escaped+="%"+((buffer>>bits)&255).toString(16).padStart(2,"0");buffer&=(1<<bits)-1;}
  }
  return JSON.parse(decodeURIComponent(escaped));
}
const inactive=node=>!node||node.sessionStatus!=="running"||["idle","idle-at-prompt","done","stopped","departed"]
  .includes(node.activityState?.activity??node.activityState?.display??node.agentActivity?.state);

export class HostWorkerViews{
  constructor(host){this.host=host;this.pending=new Map();this.entries=new Map(Object.entries(host.loadViews?.()??{}));this.wakeVersion=0;}
  sync(config,view,options={}){
    if(typeof view!=="string"||!view.trim()||view.length>256||/[\u0000-\u001f\u007f-\u009f]/.test(view))
      return Promise.resolve({ok:false,reason:"Choose a valid worker view."});
    const key=keyFor(config,view),running=this.pending.get(key);
    // Coalesced: while a refresh of this view runs, at most ONE more waits, and a newer request replaces it (an explicit open's
    // options are not replaced by a later event's). A burst of events gives one more refresh, not one per event.
    if(running){
      this.queued??=new Map();const waiting=this.queued.get(key);
      if(waiting){waiting.config=config;if(options.explicit||!waiting.options.explicit)waiting.options={...options,explicit:!!(options.explicit||waiting.options.explicit)};return waiting.promise;}
      const next={config,options};
      next.promise=running.catch(()=>{}).then(()=>{if(this.queued.get(key)===next)this.queued.delete(key);return this.sync(next.config,view,next.options);});
      this.queued.set(key,next);return next.promise;
    }
    const job=Promise.resolve().then(()=>this.update(config,view,key,options));this.pending.set(key,job);
    return job.finally(()=>{if(this.pending.get(key)===job)this.pending.delete(key);});
  }
  /** A read or Herdr call that doesn't answer in `ms` fails with `reason` (the view's catch keeps the tiles and pauses following). */
  timed(promise,ms,reason){
    if(!this.host.deadline)return promise; // a host without a clock for deadlines (a unit test) waits as before
    return Promise.race([promise,this.host.deadline(ms).then(()=>{throw new Error(reason);})]);
  }
  // The live settings of THIS config's own connection (with several OpenRigs, another connection's change leaves this one's work alone).
  current(config){
    if(this.closed||!rigOrigin(config.daemonUrl)||this.host.currentConfig&&identity(this.host.currentConfig(config))!==identity(config))
      throw new Error("OpenRig's connection changed. The worker view was left in place.");
  }
  // Every Herdr call goes through the synced connection's own send scope when the host offers one (an unscoped send is refused with several OpenRigs).
  run(config,name,args){return (this.host.runFor?this.host.runFor(config):this.host.run)(name,args);}
  async hc(args,config){
    const result=await this.timed((this.host.hcFor?this.host.hcFor(config):this.host.hc)(args),15000,"Herdr didn't answer in time. Couldn't refresh this view; tiles kept.");
    if(result?.code!==0)throw new Error(result?.stderr||"Herdr could not update this worker view.");
    return result.stdout;
  }
  async waitFor(test,description){
    for(let n=0;n<60;n++){const result=test();if(result)return result;if(!this.host.wait)break;await this.host.wait(100);}
    throw new Error(`Herdr did not confirm ${description}. Existing tiles were kept.`);
  }
  owned(config,view,remote){
    const expected=rigOrigin(config.daemonUrl),prefix=config.daemonMachine?config.daemonMachine+"/":"";
    return list(this.host,"panes").flatMap(pane=>{
      const terminal=list(this.host,"terminals").find(t=>addr(t)===pane.terminal),labels=terminal?.labels??{};
      if(!String(addr(terminal)??"").startsWith(prefix)||!String(pane.tab).startsWith(prefix)
        ||(!config.daemonMachine&&(String(addr(terminal)??"").includes("/")||String(pane.tab).includes("/")))
        ||labels["herdr-openrig.role"]!=="worker-view"||labels["herdr-openrig.view"]!==view
        ||(labels["herdr-openrig.machine"]??null)!==(config.daemonMachine??null)||rigOrigin(labels["herdr-openrig.origin"])!==expected
        // Rule Y: positive evidence. A stamped tile is ours only with THIS daemon's host id; an unstamped one (older herdrig) only for the legacy connection.
        ||(labels["herdr-openrig.host"]?labels["herdr-openrig.host"]!==hostLabelValue(remote.selfHostId):own(config).length>0)
        ||labels["herdr.tab"]!==machineLocalId(pane.tab,config.daemonMachine)
        ||!list(this.host,"spaces").some(s=>s.id===machineId(labels["herdr.space"],config.daemonMachine)&&s.tabs?.some(t=>t.id===pane.tab)))return [];
      let argv=terminal.argv;
      if(argv?.[0]==="env"&&/^HERDR_OPENRIG_VIEW_TILE=[a-z0-9-]+$/.test(argv[1]??""))argv=argv.slice(2);
      const program=argv?.length===3&&argv[0]===remote.node&&argv[1]===remote.relayPath
        ||argv?.length===2&&argv[0]==="sleep"&&argv[1]==="2147483647";
      if(!program||labels["herdr-openrig.viewer-argv"]!==JSON.stringify(terminal.argv))return [];
      if(argv[0]!=="sleep"){
        try{
          const payload=payloadFrom(argv[2]);
          // Core removes empty label values; absent and empty both mean no seat.
          const pad=payload.mode==="pad"&&labels["herdr-openrig.blank"]==="1"&&(labels["herdr-openrig.seat"]??"")===""
            &&JSON.stringify(argv)===JSON.stringify(workerPad(remote).argv);
          if(!pad&&(payload.mode!=="grid"||payload.session!==labels["herdr-openrig.seat"]||!isValidSessionName(payload.session)))return [];
        }catch{return [];}
      }
      return [{pane,terminal,programArgv:argv,session:labels["herdr-openrig.seat"]??"",page:Number(labels["herdr-openrig.page"]),
        blank:labels["herdr-openrig.blank"]==="1",snapshot:snapshot(terminal,pane)}];
    });
  }
  async update(config,view,key,options){
    let host=this.host;const previous=this.entries.get(key)??host.loadViews?.()?.[key]??null;
    if(!options.explicit&&previous?.paused)return {...previous,ok:false,paused:true};
    // Empty host lists during startup/restore are not evidence of a person's close.
    // Keep persisted membership and follow state until layout evidence is available.
    // If all worker tabs really closed and only mod panes remain, an empty terminal
    // list also keeps the dead view following until a terminal appears or an explicit
    // Worker view open reconciles it. Deferring is safer than inferring a close.
    if(!options.explicit&&previous&&["spaces","panes","terminals"].some(kind=>!list(host,kind).length))
      return {ok:false,reason:"Herdr's layout is still loading. Existing worker views were kept."};
    try{
      this.current(config);
      const remote=await host.prepareRemote(config);if(!remote.ok){
        if(previous){this.entries.set(key,{...previous,paused:true,error:remote.reason});await this.save();this.schedule();}return remote;
      }
      this.current(config);
      // One status source per (connection, rig): the view's own rig's seats when it names one.
      const rigId=(options.target??previous?.target)?.id??null;
      const [preview,nodes]=await this.timed(Promise.all([host.preview(config,view),host.nodes(config,rigId)]),10000,"Couldn't refresh this view; tiles kept.");
      this.current(config);
      if(options.expectedPlan&&preview?.planId!==options.expectedPlan)
        return {ok:false,reason:"This worker view changed since preview. Refresh it before opening."};
      const plan=hostWorkerPlan(preview,nodes,remote,view);
      if(remote.local){
        // A loopback daemon address may be a tunnel. Verify the exact local tmux server before creating any viewer.
        const preflight=await localGridPreflight({exec:host.execFor?host.execFor(config):host.exec},
          {tiles:plan.pages.flatMap(page=>page.tiles).filter(tile=>!tile.placeholder&&!tile.blank)});
        this.current(config);
        if(!preflight.ok)return preflight;
      }
      const target=options.target??previous?.target;
      const adoption=target&&options.explicit?await prepareRigSpaceAdoption(host,config,[target.id,target.name],{sessions:nodes.map(n=>n.canonicalSessionName).filter(Boolean),servers:rigSeatServers({seats:nodes})}):{ok:true};
      if(!adoption.ok)return adoption;
      if(adoption.host)host=adoption.host;
      const existing=this.owned(config,view,remote).filter(tile=>list(host,"panes").some(p=>p.pane===tile.pane.pane));
      const parked=new Set();
      for(const tile of existing.filter(t=>t.session&&t.programArgv[0]!=="sleep")){
        if(!options.explicit&&previous?.endedCheckedAt&&Date.now()-previous.endedCheckedAt<30000){
          if(previous.endedTerminals?.includes(tile.pane.terminal))parked.add(tile.pane.terminal);
          continue;
        }
        try{
          const screen=JSON.parse(await this.hc(["read","--json",tile.pane.terminal],config));
          // This suffix is a heuristic: seat output could quote it. An explicit reopen
          // can then reattach that same seat; ownership, argv and snapshots still bind it.
          if(String(screen.text??"").trimEnd().endsWith("Close this pane, then reopen the rig space to retry."))parked.add(tile.pane.terminal);
        }catch{} // an unreadable screen is not evidence that a tile may be replaced
      }
      for(const tile of existing.filter(t=>t.session&&t.programArgv[0]!=="sleep")){
        const wanted=plan.pages.flatMap(p=>p.tiles).find(t=>t.session===tile.session&&!t.placeholder);
        if(wanted&&!!payloadFrom(tile.programArgv[2]).readOnly!==wanted.readOnly)
          throw new Error(`The read-only mode changed for ${wanted.label}. Close its worker tab, then reopen this view. Existing tiles were kept.`);
      }
      if(!options.explicit&&previous&&!existing.length){
        this.entries.delete(key);await this.save();return {ok:true,closed:true};
      }
      // Another connection's entry keeps its own id and home, so its identity (and its events) stay its own; the legacy entry keeps its old shape.
      const entry={...previous,view,config:{daemonUrl:config.daemonUrl,daemonMachine:config.daemonMachine,...(config.rig?{rig:[...config.rig]}:{}),
        ...(own(config).length?{connectionId:config.connectionId,...(config.openrigHome?{openrigHome:config.openrigHome}:{})}:{})},target:options.target??previous?.target??null,
        following:options.following??previous?.following??plan.kind==="following",
        pruneMs:options.pruneMs??previous?.pruneMs??0,planId:plan.planId,name:plan.name,missing:plan.missing,
        members:plan.pages.flatMap(p=>p.tiles).filter(t=>!t.blank).map(({session,label,runtime,readOnly})=>({session,label,runtime,readOnly})),
        paused:false,inactiveSince:{...(previous?.inactiveSince??{})},pruned:{...(previous?.pruned??{})},ended:parked.size,
        endedTerminals:[...parked],endedCheckedAt:!options.explicit&&previous?.endedCheckedAt&&Date.now()-previous.endedCheckedAt<30000?previous.endedCheckedAt:Date.now(),
        closed:options.explicit?{}:{...(previous?.closed??{})}};
      if(!options.explicit)for(const member of previous?.members??[])if(!existing.some(t=>t.session===member.session)&&!entry.pruned[member.session])entry.closed[member.session]=true;
      if(!Number.isFinite(entry.pruneMs)||entry.pruneMs<0||entry.pruneMs>604800000)throw new Error("Choose a prune time from zero to seven days.");
      const now=host.now?.()??Date.now(),bySession=new Map(nodes.map(n=>[n.canonicalSessionName,n]));
      for(const tile of existing.filter(t=>t.session)){
        if(inactive(bySession.get(tile.session)))entry.inactiveSince[tile.session]??=now;
        else {delete entry.inactiveSince[tile.session];delete entry.pruned[tile.session];}
      }
      for(const session of Object.keys(entry.pruned))if(!inactive(bySession.get(session)))delete entry.pruned[session];
      const ready=async()=>{
        this.current(config);const checked=await host.prepareRemote(config);this.current(config);
        if(!checked.ok)throw new Error(checked.reason);
        if(JSON.stringify(checked)!==JSON.stringify(remote))throw new Error("The Herdr machine changed. Existing worker tiles were kept.");
      };
      let space=adoption.space??(existing.length?list(host,"spaces").find(s=>s.tabs?.some(t=>t.id===existing[0].pane.tab)):null);
      const rig=entry.target;
      if(!space&&rig){
        const move=rigSpaceRelocation(host,rig,config);
        if(move)return {ok:false,needsRelocation:true,relocation:move,reason:"Move the Local rig space before opening its worker view on the box."};
        // The same vouching inputs the pages and the grid use; a space that still can't be confirmed is asked about, never answered with a new one.
        const vouch={sessions:nodes.map(n=>n.canonicalSessionName).filter(Boolean),servers:rigSeatServers({seats:nodes}),hostId:remote.selfHostId,strictOrigin:true}; // rule Y (it writes hc run and pane.split into the space): an origin-less terminal counts only with our herdr-openrig.rig label. The tmux server too: a session name is unique only within one server
        space=resolveRigSpace(host,config,[rig.id,rig.name],vouch);
        if(!space){
          const other=unconfirmedRigSpace(host,config,[rig.id,rig.name],vouch);
          if(other)return {ok:false,unconfirmedSpace:true,reason:unconfirmedSpaceReason(rig.name,config.daemonMachine,other.origin,config.daemonUrl,other)};
        }
      }
      if(!space&&!rig)space=openRigSpaceContext(list(host,"spaces"),list(host,"terminals"),list(host,"panes"),host.routeState?.()??{})
        .find(c=>c.home&&c.id.startsWith(config.daemonMachine+"/")&&list(host,"terminals").some(t=>
          t.labels?.["herdr.space"]===machineLocalId(c.id,config.daemonMachine)&&rigOrigin(t.labels?.["herdr-openrig.origin"])===rigOrigin(config.daemonUrl)))?.space;
      const newSpace=!space,spaceId=space?.id??machineId("sp-worker-"+nonce(),config.daemonMachine);
      const labels=(tile,page,argv,tab)=>[
        `herdr.space=${machineLocalId(spaceId,config.daemonMachine)}`,`herdr.tab=${machineLocalId(tab,config.daemonMachine)}`,
        "herdr-openrig.role=worker-view",`herdr-openrig.view=${view}`,...(config.daemonMachine?[`herdr-openrig.machine=${config.daemonMachine}`]:[]),
        `herdr-openrig.origin=${config.daemonUrl}`,`herdr-openrig.seat=${tile.session??""}`,`herdr-openrig.page=${page}`,
        `herdr-openrig.blank=${tile.blank?"1":"0"}`,`herdr-openrig.viewer-argv=${JSON.stringify(argv)}`,
        ...(rig?[`herdr-openrig.rig=${rig.name}`]:["herdr-openrig.home=1"]),
        ...(hostLabelValue(remote.selfHostId)?[`herdr-openrig.host=${hostLabelValue(remote.selfHostId)}`]:[]), // the daemon's host id: which OpenRig these tiles show
      ];
      const fresh=new Set(),newTabs=new Set();let additionalPages=0;
      const start=async(tile,page,tab,parent=null,direction="right",replaceParked=false)=>{
        await ready();let pane;
        if(parent){
          const liveParent=this.owned(config,view,remote).find(t=>sameSplitTarget(parent,t,config,remote));
          if(!liveParent||liveParent.pane.focused&&!fresh.has(parent.pane.terminal)&&!replaceParked)throw new Error("The worker split target changed or has focus. It was left alone.");
          const before=new Set(list(host,"panes").map(p=>p.pane)),argv=["env",`HERDR_OPENRIG_VIEW_TILE=${nonce()}`,...tile.argv];
          this.run(config,"pane.split",{pane:parent.pane.pane,direction,argv});
          pane=await this.waitFor(()=>list(host,"panes").find(p=>p.tab===tab&&!before.has(p.pane)&&list(host,"terminals")
            .some(t=>addr(t)===p.terminal&&JSON.stringify(t.argv)===JSON.stringify(argv))),"worker tile adoption");
          const record=JSON.parse(await this.hc(["get","--json","--",pane.terminal],config));
          if(record.parent||record.terminal?.parent)throw new Error("Herdr assigned a parent to a worker tile. No parent was closed.");
          await this.hc(["label",pane.terminal,...labels(tile,page,argv,tab)],config);
        }else{
          const result=JSON.parse(await this.hc(["run",...(config.daemonMachine?["--on",config.daemonMachine]:[]),"--bg","--json","--no-parent","--no-notify",
            ...labels(tile,page,tile.argv,tab).flatMap(label=>["--label",label]),"--",...tile.argv],config));
          pane=await this.waitFor(()=>list(host,"panes").find(p=>p.terminal===result.address&&p.tab===tab),"worker page adoption");
        }
        fresh.add(pane.terminal);
        return this.waitFor(()=>this.owned(config,view,remote).find(t=>t.pane.pane===pane.pane),"worker tile labels");
      };
      let reattached=0;
      if(options.explicit)for(const old of [...existing].filter(t=>parked.has(t.pane.terminal))){
        const wanted=plan.pages.flatMap(p=>p.tiles).find(t=>t.session===old.session&&!t.placeholder);
        if(!wanted)continue;
        await ready();
        const live=this.owned(config,view,remote).find(t=>t.pane.pane===old.pane.pane);
        if(!live||live.snapshot!==old.snapshot)continue;
        const record=JSON.parse(await this.hc(["get","--json","--",old.pane.terminal],config));
        if(JSON.stringify(record.argv)!==JSON.stringify(old.terminal.argv)||record.pid!==old.terminal.pid||record.created_ms!==old.terminal.created_ms)continue;
        const next=await start(wanted,old.page,old.pane.tab,old,"right",true);
        await ready();
        const current=this.owned(config,view,remote).find(t=>t.pane.pane===old.pane.pane);
        if(!current||current.snapshot!==old.snapshot||!this.owned(config,view,remote).some(t=>t.pane.pane===next.pane.pane))continue;
        this.run(config,"pane.close",{pane:old.pane.pane});
        existing.splice(existing.indexOf(old),1,next);reattached++;
      }
      entry.ended-=reattached;
      entry.endedTerminals = entry.endedTerminals.filter(terminal => existing.some(tile => tile.pane.terminal === terminal));
      // Upgrade only our old inert blanks on an explicit reopen; retain every seat viewer.
      if(options.explicit)for(const old of existing.filter(t=>t.blank&&!t.session&&t.programArgv[0]==="sleep"&&!t.pane.focused)){
        const next=await start(workerPad(remote),old.page,old.pane.tab,old);
        await ready();
        const current=this.owned(config,view,remote).find(t=>t.pane.pane===old.pane.pane);
        if(!current||current.pane.focused||current.snapshot!==old.snapshot)
          throw new Error("An old empty tile changed during refresh. Both empty tiles were kept.");
        if(!this.owned(config,view,remote).some(t=>t.pane.pane===next.pane.pane&&t.blank))
          throw new Error("Herdr did not confirm the new empty tile. The old tile was kept.");
        this.run(config,"pane.close",{pane:old.pane.pane});
      }
      const desired=new Map(plan.pages.flatMap(p=>p.tiles).filter(t=>t.session).map(t=>[t.session,t])),retire=[];
      const present=new Set(existing.filter(t=>t.session).flatMap(t=>{
        const wanted=desired.get(t.session);
        if(t.programArgv?.[0]==="sleep"&&wanted&&!wanted.placeholder&&!t.pane.focused){retire.push(t);return [];}
        return [t.session];
      }));
      let pages=[...new Set(existing.map(t=>t.pane.tab))];
      for(let index=0;index<plan.pages.length;index++){
        const page=plan.pages[index],wanted=page.tiles.map(t=>t.session&&(present.has(t.session)||entry.pruned[t.session]||entry.closed[t.session])?workerPad(remote):t);
        let anchors=this.owned(config,view,remote).filter(t=>t.page===index),tab=anchors[0]?.pane.tab,pageIndex=index;
        const oldTitle=list(host,"spaces").flatMap(space=>space.tabs??[]).find(item=>item.id===tab)?.name;
        // Only migrate the generated old title; a person's renamed tab stays theirs.
        if(tab&&view.startsWith("rig:")&&(oldTitle===view||oldTitle===`${view} · ${index+1}/${plan.pages.length}`))
          this.run(config,"tab.rename",{id:tab,name:page.name});
        if(!wanted.some(t=>!t.blank))continue;
        if(anchors.length){
          for(const tile of wanted.filter(t=>!t.blank)){
            const parent=anchors.find(t=>!t.pane.focused);
            if(!parent){tab=machineId("tb-worker-"+nonce(),config.daemonMachine);pageIndex=pages.length;anchors=[await start(tile,pageIndex,tab)];pages.push(tab);newTabs.add(tab);additionalPages++;}
            else anchors.push(await start(tile,pageIndex,tab,parent,anchors.length%2?"right":"down"));
            present.add(tile.session);
          }
        }else{
          tab=machineId("tb-worker-"+nonce(),config.daemonMachine);pages.push(tab);newTabs.add(tab);
          const first=await start(wanted[0],index,tab),columns=[first];
          for(let col=1;col<page.columns;col++)columns.push(await start(wanted[col],index,tab,columns.at(-1),"right"));
          for(const tile of columns){this.current(config);this.run(config,"layout.resize",{id:tile.pane.pane,weight:1});}
          for(let col=0;col<page.columns;col++){
            let parent=columns[col];for(let row=1;row<page.rows;row++)parent=await start(wanted[row*page.columns+col],index,tab,parent,"down");
          }
          for(const tile of this.owned(config,view,remote).filter(t=>t.pane.tab===tab)){this.current(config);this.run(config,"layout.resize",{id:tile.pane.pane,weight:1});}
          for(const tile of wanted)if(tile.session)present.add(tile.session);
        }
        if(newTabs.has(tab))this.run(config,"tab.rename",{id:tab,name:pageIndex===index?page.name:`${plan.name} · ${pageIndex+1}`});
      }
      for(const tile of retire){
        await ready();const current=this.owned(config,view,remote).find(t=>t.pane.pane===tile.pane.pane);
        if(current&&!current.pane.focused&&current.snapshot===tile.snapshot
          &&this.owned(config,view,remote).some(t=>t.session===tile.session&&t.pane.pane!==tile.pane.pane&&t.programArgv?.[0]!=="sleep"))this.run(config,"pane.close",{pane:tile.pane.pane});
      }
      if(newSpace&&pages.length){
        const base=rig?.name??"OpenRig",collision=list(host,"spaces").some(s=>s.id!==spaceId&&s.name===base);
        this.run(config,"space.rename",{id:spaceId,name:collision?`${base} · ${config.daemonMachine}`:base});
      }
      for(const tile of this.owned(config,view,remote).filter(t=>t.session))if(inactive(bySession.get(tile.session)))entry.inactiveSince[tile.session]??=now;
      if(entry.following&&entry.pruneMs){
        for(const tile of this.owned(config,view,remote).filter(t=>t.session)){
          const since=entry.inactiveSince[tile.session];
          if(since===undefined||now-since<entry.pruneMs||tile.pane.focused||!inactive(bySession.get(tile.session)))continue;
          // Keep an inert pad so pruning the last viewer never closes a space or asks a destructive dialog.
          if(list(host,"panes").filter(p=>p.tab===tile.pane.tab).length===1)await start(workerPad(remote),tile.page,tile.pane.tab,tile);
          await ready();
          const current=this.owned(config,view,remote).find(t=>t.pane.pane===tile.pane.pane);
          if(!current||current.pane.focused||current.snapshot!==tile.snapshot)continue;
          const record=JSON.parse(await this.hc(["get","--json","--",tile.pane.terminal],config));
          if(JSON.stringify(record.argv)!==JSON.stringify(tile.terminal.argv)||record.pid!==tile.terminal.pid&&tile.terminal.pid!==undefined
            ||record.created_ms!==tile.terminal.created_ms&&tile.terminal.created_ms!==undefined)continue;
          const final=this.owned(config,view,remote).find(t=>t.pane.pane===tile.pane.pane);
          if(!final||final.pane.focused||final.snapshot!==tile.snapshot)continue;
          this.current(config);this.run(config,"pane.close",{pane:tile.pane.pane});entry.pruned[tile.session]=true;
        }
      }
      entry.pages=pages.map((tab,index)=>({tab,name:plan.pages[index]?.name??`${plan.name} · ${index+1}`}));entry.space=spaceId;
      this.entries.set(key,entry);await this.save();this.schedule();
      if(options.explicit&&entry.pages.length){this.run(config,"space.select",{id:spaceId});this.run(config,"tab.select",{id:entry.pages[0].tab});}
      const leftEnded = options.explicit ? parked.size - reattached : 0;
      const reasons=[];
      if(reattached||leftEnded)reasons.push(`Reattached ${reattached} ended tile${reattached===1?"":"s"}.${leftEnded?` ${leftEnded} left as they were: they changed.`:""}`);
      if(additionalPages)reasons.push(`Focused worker tiles were kept; opened ${additionalPages} additional page${additionalPages===1?'':'s'}.`);
      return {ok:true,...entry,reattached,...(reasons.length?{reason:reasons.join(' ')}:{})};
    }catch(error){
      if(previous){this.entries.set(key,{...previous,paused:true,error:errorDiagnostic(error)});await this.save();this.schedule();}
      return {ok:false,paused:!!previous,reason:errorDiagnostic(error),kept:true};
    }
  }
  async save(){await this.host.saveViews?.(Object.fromEntries(this.entries));this.host.changed?.(Object.fromEntries(this.entries));}
  schedule(){
    const version=++this.wakeVersion,now=this.host.now?.()??Date.now(),due=[],configs=new Map();
    for(const entry of this.entries.values())if(entry.following&&!entry.paused&&entry.pruneMs)
      for(const [session,since] of Object.entries(entry.inactiveSince))if(!entry.pruned[session]&&since+entry.pruneMs>now){due.push(since+entry.pruneMs);configs.set(identity(entry.config),entry.config);}
    // The wake refreshes each due entry's OWN connection, with that connection's live settings (a removed one has none and is left alone).
    if(due.length)this.host.after?.(Math.max(0,Math.min(...due)-now),async()=>{
      if(version!==this.wakeVersion)return;
      for(const saved of configs.values()){const live=this.host.currentConfig?this.host.currentConfig(saved):saved;if(live)await this.event(live);}
    });
  }
  async event(config){
    for(const entry of [...this.entries.values()])if(entry.following&&!entry.paused&&identity(entry.config)===identity(config))await this.sync(config,entry.view);
  }
  focusChanged(config,focus){
    // Remembered per connection: each connection's views are judged once per focus change, not only the first one asked.
    const key=JSON.stringify([focus?.pane,focus?.terminal]),id=identity(config);this.lastFocus??=new Map();if(this.lastFocus.get(id)===key)return;this.lastFocus.set(id,key);
    const now=this.host.now?.()??Date.now();
    if([...this.entries.values()].some(e=>identity(e.config)===identity(config)&&e.following&&!e.paused&&e.pruneMs
      &&Object.entries(e.inactiveSince??{}).some(([session,since])=>!e.pruned?.[session]&&since+e.pruneMs<=now)))
      this.host.after?.(0,()=>this.event(config));
  }
  stop(config,view){
    const key=keyFor(config,view),job=(this.pending.get(key)??Promise.resolve()).catch(()=>{}).then(async()=>{
      const entry=this.entries.get(key);if(entry){entry.following=false;await this.save();this.schedule();}
      return {ok:true,reason:"Stopped following; the tiles stay as they are."};
    });
    this.pending.set(key,job);return job.finally(()=>{if(this.pending.get(key)===job)this.pending.delete(key);});
  }
  dispose(){this.closed=true;this.wakeVersion++;}
}
