// The sidebar owns reconciliation. Daemon previews are read-only; Herdr owns PTYs.
import {isValidSessionName} from "./rig-lib.js";
import {hostWorkerPlan,workerPad} from "./rig-worker-views.js";
import {machineId,machineLocalId} from "./rig-remote.js";
import {rigOrigin,resolveRigSpace,openRigSpaceContext,sameDaemonOrigin,hostLabelValue} from "./rig-space-context.js";
import {rigSpaceRelocation} from "./rig-spaces.js";

const list=(host,key)=>(typeof host[key]==="function"?host[key]():host[key])??[];
const identity=config=>JSON.stringify([rigOrigin(config?.daemonUrl),config?.daemonMachine,config?.rig??null]);
const keyFor=(config,view)=>JSON.stringify([rigOrigin(config?.daemonUrl),config?.daemonMachine,view]);
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
    const key=keyFor(config,view),prior=this.pending.get(key)??Promise.resolve();
    const job=prior.catch(()=>{}).then(()=>this.update(config,view,key,options));this.pending.set(key,job);
    return job.finally(()=>{if(this.pending.get(key)===job)this.pending.delete(key);});
  }
  current(config){
    if(this.closed||!config?.daemonMachine||!rigOrigin(config.daemonUrl)||this.host.currentConfig&&identity(this.host.currentConfig())!==identity(config))
      throw new Error("OpenRig's connection changed. The worker view was left in place.");
  }
  async hc(args){
    const result=await this.host.hc(args);
    if(result?.code!==0)throw new Error(result?.stderr||"Herdr could not update this worker view.");
    return result.stdout;
  }
  async waitFor(test,description){
    for(let n=0;n<60;n++){const result=test();if(result)return result;if(!this.host.wait)break;await this.host.wait(100);}
    throw new Error(`Herdr did not confirm ${description}. Existing tiles were kept.`);
  }
  owned(config,view,remote){
    const expected=rigOrigin(config.daemonUrl),prefix=config.daemonMachine+"/";
    return list(this.host,"panes").flatMap(pane=>{
      const terminal=list(this.host,"terminals").find(t=>addr(t)===pane.terminal),labels=terminal?.labels??{};
      if(!String(addr(terminal)??"").startsWith(prefix)||!String(pane.tab).startsWith(prefix)
        ||labels["herdr-openrig.role"]!=="worker-view"||labels["herdr-openrig.view"]!==view
        ||labels["herdr-openrig.machine"]!==config.daemonMachine||rigOrigin(labels["herdr-openrig.origin"])!==expected
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
    const host=this.host,previous=this.entries.get(key)??host.loadViews?.()?.[key]??null;
    if(!options.explicit&&previous?.paused)return {...previous,ok:false,paused:true};
    try{
      this.current(config);
      const remote=await host.prepareRemote(config);if(!remote.ok){
        if(previous){this.entries.set(key,{...previous,paused:true,error:remote.reason});await this.save();this.schedule();}return remote;
      }
      this.current(config);
      const [preview,nodes]=await Promise.all([host.preview(config,view),host.nodes(config)]);
      this.current(config);
      if(options.expectedPlan&&preview?.planId!==options.expectedPlan)
        return {ok:false,reason:"This worker view changed since preview. Refresh it before opening."};
      const plan=hostWorkerPlan(preview,nodes,remote,view);
      const existing=this.owned(config,view,remote);
      for(const tile of existing.filter(t=>t.session&&t.programArgv[0]!=="sleep")){
        const wanted=plan.pages.flatMap(p=>p.tiles).find(t=>t.session===tile.session&&!t.placeholder);
        if(wanted&&!!payloadFrom(tile.programArgv[2]).readOnly!==wanted.readOnly)
          throw new Error(`The read-only mode changed for ${wanted.label}. Close its worker tab, then reopen this view. Existing tiles were kept.`);
      }
      if(!options.explicit&&previous&&!existing.length){
        this.entries.delete(key);await this.save();return {ok:true,closed:true};
      }
      const entry={...previous,view,config:{daemonUrl:config.daemonUrl,daemonMachine:config.daemonMachine,...(config.rig?{rig:[...config.rig]}:{})},target:options.target??previous?.target??null,
        following:options.following??previous?.following??plan.kind==="following",
        pruneMs:options.pruneMs??previous?.pruneMs??0,planId:plan.planId,name:plan.name,missing:plan.missing,
        members:plan.pages.flatMap(p=>p.tiles).filter(t=>!t.blank).map(({session,label,runtime,readOnly})=>({session,label,runtime,readOnly})),
        paused:false,inactiveSince:{...(previous?.inactiveSince??{})},pruned:{...(previous?.pruned??{})}};
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
      let space=existing.length?list(host,"spaces").find(s=>s.tabs?.some(t=>t.id===existing[0].pane.tab)):null;
      const rig=entry.target;
      if(!space&&rig){
        const move=rigSpaceRelocation(host,rig,config);
        if(move)return {ok:false,needsRelocation:true,relocation:move,reason:"Move the Local rig space before opening its worker view on the box."};
        space=resolveRigSpace(host,config,[rig.id,rig.name]);
      }
      if(!space&&!rig)space=openRigSpaceContext(list(host,"spaces"),list(host,"terminals"),list(host,"panes"),host.routeState?.()??{})
        .find(c=>c.home&&c.id.startsWith(config.daemonMachine+"/")&&list(host,"terminals").some(t=>
          t.labels?.["herdr.space"]===machineLocalId(c.id,config.daemonMachine)&&rigOrigin(t.labels?.["herdr-openrig.origin"])===rigOrigin(config.daemonUrl)))?.space;
      const newSpace=!space,spaceId=space?.id??machineId("sp-worker-"+nonce(),config.daemonMachine);
      const labels=(tile,page,argv,tab)=>[
        `herdr.space=${machineLocalId(spaceId,config.daemonMachine)}`,`herdr.tab=${machineLocalId(tab,config.daemonMachine)}`,
        "herdr-openrig.role=worker-view",`herdr-openrig.view=${view}`,`herdr-openrig.machine=${config.daemonMachine}`,
        `herdr-openrig.origin=${config.daemonUrl}`,`herdr-openrig.seat=${tile.session??""}`,`herdr-openrig.page=${page}`,
        `herdr-openrig.blank=${tile.blank?"1":"0"}`,`herdr-openrig.viewer-argv=${JSON.stringify(argv)}`,
        ...(rig?[`herdr-openrig.rig=${rig.name}`]:["herdr-openrig.home=1"]),
      ];
      const fresh=new Set(),newTabs=new Set();
      const start=async(tile,page,tab,parent=null,direction="right")=>{
        await ready();let pane;
        if(parent){
          const liveParent=this.owned(config,view,remote).find(t=>sameSplitTarget(parent,t,config,remote));
          if(!liveParent||liveParent.pane.focused&&!fresh.has(parent.pane.terminal))throw new Error("The worker split target changed or has focus. It was left alone.");
          const before=new Set(list(host,"panes").map(p=>p.pane)),argv=["env",`HERDR_OPENRIG_VIEW_TILE=${nonce()}`,...tile.argv];
          host.run("pane.split",{pane:parent.pane.pane,direction,argv});
          pane=await this.waitFor(()=>list(host,"panes").find(p=>p.tab===tab&&!before.has(p.pane)&&list(host,"terminals")
            .some(t=>addr(t)===p.terminal&&JSON.stringify(t.argv)===JSON.stringify(argv))),"worker tile adoption");
          const record=JSON.parse(await this.hc(["get","--json","--",pane.terminal]));
          if(record.parent||record.terminal?.parent)throw new Error("Herdr assigned a parent to a worker tile. No parent was closed.");
          await this.hc(["label",pane.terminal,...labels(tile,page,argv,tab)]);
        }else{
          const result=JSON.parse(await this.hc(["run","--on",config.daemonMachine,"--bg","--json","--no-parent","--no-notify",
            ...labels(tile,page,tile.argv,tab).flatMap(label=>["--label",label]),"--",...tile.argv]));
          pane=await this.waitFor(()=>list(host,"panes").find(p=>p.terminal===result.address&&p.tab===tab),"worker page adoption");
        }
        fresh.add(pane.terminal);
        return this.waitFor(()=>this.owned(config,view,remote).find(t=>t.pane.pane===pane.pane),"worker tile labels");
      };
      // Upgrade only our old inert blanks on an explicit reopen; retain every seat viewer.
      if(options.explicit)for(const old of existing.filter(t=>t.blank&&!t.session&&t.programArgv[0]==="sleep"&&!t.pane.focused)){
        const next=await start(workerPad(remote),old.page,old.pane.tab,old);
        await ready();
        const current=this.owned(config,view,remote).find(t=>t.pane.pane===old.pane.pane);
        if(!current||current.pane.focused||current.snapshot!==old.snapshot)
          throw new Error("An old empty tile changed during refresh. Both empty tiles were kept.");
        if(!this.owned(config,view,remote).some(t=>t.pane.pane===next.pane.pane&&t.blank))
          throw new Error("Herdr did not confirm the new empty tile. The old tile was kept.");
        host.run("pane.close",{pane:old.pane.pane});
      }
      const desired=new Map(plan.pages.flatMap(p=>p.tiles).filter(t=>t.session).map(t=>[t.session,t])),retire=[];
      const present=new Set(existing.filter(t=>t.session).flatMap(t=>{
        const wanted=desired.get(t.session);
        if(t.programArgv?.[0]==="sleep"&&wanted&&!wanted.placeholder&&!t.pane.focused){retire.push(t);return [];}
        return [t.session];
      }));
      let pages=[...new Set(existing.map(t=>t.pane.tab))];
      for(let index=0;index<plan.pages.length;index++){
        const page=plan.pages[index],wanted=page.tiles.map(t=>t.session&&(present.has(t.session)||entry.pruned[t.session])?workerPad(remote):t);
        let anchors=this.owned(config,view,remote).filter(t=>t.page===index),tab=anchors[0]?.pane.tab,pageIndex=index;
        const oldTitle=list(host,"spaces").flatMap(space=>space.tabs??[]).find(item=>item.id===tab)?.name;
        // Only migrate the generated old title; a person's renamed tab stays theirs.
        if(tab&&view.startsWith("rig:")&&(oldTitle===view||oldTitle===`${view} · ${index+1}/${plan.pages.length}`))
          host.run("tab.rename",{id:tab,name:page.name});
        if(!wanted.some(t=>!t.blank))continue;
        if(anchors.length){
          for(const tile of wanted.filter(t=>!t.blank)){
            const parent=anchors.find(t=>!t.pane.focused);
            if(!parent){tab=machineId("tb-worker-"+nonce(),config.daemonMachine);pageIndex=pages.length;anchors=[await start(tile,pageIndex,tab)];pages.push(tab);newTabs.add(tab);}
            else anchors.push(await start(tile,pageIndex,tab,parent,anchors.length%2?"right":"down"));
            present.add(tile.session);
          }
        }else{
          tab=machineId("tb-worker-"+nonce(),config.daemonMachine);pages.push(tab);newTabs.add(tab);
          const first=await start(wanted[0],index,tab),columns=[first];
          for(let col=1;col<page.columns;col++)columns.push(await start(wanted[col],index,tab,columns.at(-1),"right"));
          for(const tile of columns){this.current(config);host.run("layout.resize",{id:tile.pane.pane,weight:1});}
          for(let col=0;col<page.columns;col++){
            let parent=columns[col];for(let row=1;row<page.rows;row++)parent=await start(wanted[row*page.columns+col],index,tab,parent,"down");
          }
          for(const tile of this.owned(config,view,remote).filter(t=>t.pane.tab===tab)){this.current(config);host.run("layout.resize",{id:tile.pane.pane,weight:1});}
          for(const tile of wanted)if(tile.session)present.add(tile.session);
        }
        if(newTabs.has(tab))host.run("tab.rename",{id:tab,name:page.name});
      }
      for(const tile of retire){
        await ready();const current=this.owned(config,view,remote).find(t=>t.pane.pane===tile.pane.pane);
        if(current&&!current.pane.focused&&current.snapshot===tile.snapshot
          &&this.owned(config,view,remote).some(t=>t.session===tile.session&&t.pane.pane!==tile.pane.pane&&t.programArgv?.[0]!=="sleep"))host.run("pane.close",{pane:tile.pane.pane});
      }
      if(newSpace&&pages.length){
        const base=rig?.name??"OpenRig",collision=list(host,"spaces").some(s=>s.id!==spaceId&&s.name===base);
        host.run("space.rename",{id:spaceId,name:collision?`${base} · ${config.daemonMachine}`:base});
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
          const record=JSON.parse(await this.hc(["get","--json","--",tile.pane.terminal]));
          if(JSON.stringify(record.argv)!==JSON.stringify(tile.terminal.argv)||record.pid!==tile.terminal.pid&&tile.terminal.pid!==undefined
            ||record.created_ms!==tile.terminal.created_ms&&tile.terminal.created_ms!==undefined)continue;
          const final=this.owned(config,view,remote).find(t=>t.pane.pane===tile.pane.pane);
          if(!final||final.pane.focused||final.snapshot!==tile.snapshot)continue;
          this.current(config);host.run("pane.close",{pane:tile.pane.pane});entry.pruned[tile.session]=true;
        }
      }
      entry.pages=pages.map((tab,index)=>({tab,name:plan.pages[index]?.name??`${plan.name} · ${index+1}`}));entry.space=spaceId;
      this.entries.set(key,entry);await this.save();this.schedule();
      if(options.explicit&&entry.pages.length){host.run("space.select",{id:spaceId});host.run("tab.select",{id:entry.pages[0].tab});}
      return {ok:true,...entry};
    }catch(error){
      if(previous){this.entries.set(key,{...previous,paused:true,error:String(error?.message??error)});await this.save();this.schedule();}
      return {ok:false,paused:!!previous,reason:String(error?.message??error),kept:true};
    }
  }
  async save(){await this.host.saveViews?.(Object.fromEntries(this.entries));this.host.changed?.(Object.fromEntries(this.entries));}
  schedule(){
    const version=++this.wakeVersion,now=this.host.now?.()??Date.now(),due=[];
    for(const entry of this.entries.values())if(entry.following&&!entry.paused&&entry.pruneMs)
      for(const [session,since] of Object.entries(entry.inactiveSince))if(!entry.pruned[session]&&since+entry.pruneMs>now)due.push(since+entry.pruneMs);
    if(due.length)this.host.after?.(Math.max(0,Math.min(...due)-now),()=>{if(version===this.wakeVersion)this.event(this.host.currentConfig());});
  }
  async event(config){
    for(const entry of [...this.entries.values()])if(entry.following&&!entry.paused&&identity(entry.config)===identity(config))await this.sync(config,entry.view);
  }
  focusChanged(config,focus){
    const key=JSON.stringify([focus?.pane,focus?.terminal]);if(this.lastFocus===key)return;this.lastFocus=key;
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
