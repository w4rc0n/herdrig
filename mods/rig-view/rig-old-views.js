import {configOfConnection,LEGACY_CONNECTION_ID} from './rig-connections.js';
import {publishedConfigFor,publishedUnder} from './rig-gate.js';
import {connectionCapabilities,discoverDaemonFromCli,isLoopbackDaemonUrl,writeCommand,writeOutcome,MOD_IDS,navKey} from './rig-lib.js';

const safeLayoutName=name=>typeof name==='string'&&name&&name!=='.'&&name!=='..'&&!/[\/\\\u0000-\u001f]/.test(name);
function layoutNodes(tree){
  const out=[];
  const walk=node=>{if(!node||typeof node!=='object')return;out.push(node);walk(node.header);walk(node.content?.pane?.header);for(const child of Array.isArray(node.children)?node.children:[])walk(child);};
  walk(tree);return out;
}
export const hasOldProviderStrip=tree=>layoutNodes(tree).some(node=>node.content?.mod==='rig-strip');
const cleanDisplay=value=>String(value??'').replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,'');
export const oldStripLayoutLabel=name=>name==='main'?'Herdr':cleanDisplay(name)||'that layout';
export const oldStripBusyTip="A cleanup of OpenRig's old strip is already running in this window.";
export function oldStripCleanupOwner(shared){
  const lock=shared('rig.oldViewsCloseLock');
  return lock?.until>Date.now()?lock.id:null;
}
export const oldStripCleanupBusy=shared=>Boolean(oldStripCleanupOwner(shared)||Object.values(shared('rig.oldViewsClose')??{}).some(request=>Date.now()-request.createdAt<=120000));
export function releaseOldStripCleanup(shared,setShared,id){
  if(shared('rig.oldViewsCloseLock')?.id===id)setShared('rig.oldViewsCloseLock',null);
}
function displayErrorLine(value){
  const text=cleanDisplay(value).trim();
  if(!text||/[\r\n]/.test(text)||text.length>180)return null;
  const line=text.replace(/^Error:\s*/,'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
  return !line?null:/[.!?]$/.test(line)?line:`${line}.`;
}
function closeReason(value){
  if(/^(?:Error:\s*)?(?:OpenRig )?Daemon (?:is )?not running\./i.test(cleanDisplay(value).trim()))return "OpenRig isn't running.";
  return displayErrorLine(value)??'OpenRig did not confirm the close.';
}
function failedViewNames(views){
  const counts=new Map();
  for(const view of views)counts.set(view.name,(counts.get(view.name)??0)+1);
  const entries=[...counts],shown=entries.slice(0,3).map(([name,count])=>count>1?`${name} (${count})`:name);
  const more=entries.slice(3).reduce((sum,[,count])=>sum+count,0);
  if(more)shown.push(`and ${more} more`);
  return shown.join(', ');
}
function closeFailureText(result){
  const unchecked=result.uncheckedViews??[];
  const uncheckedText=unchecked.length?`Not checked: ${failedViewNames(unchecked)}. herdrig couldn't read the old views again, so it didn't try to close them. They may still be open.`:'';
  if(!result.failedViews.length)return [result.closed?`Closed ${result.closed} old view${result.closed===1?'':'s'}.`:'',uncheckedText].filter(Boolean).join(' ');
  const total=result.closed+result.failedViews.length;
  const unknown="No OpenRig on this computer knows it.",unknownCount=result.failedViews.filter(view=>view.reason===unknown).length;
  const reasons=[...new Set(result.failedViews.map(view=>view.reason===unknown&&unknownCount>1?'No OpenRig on this computer knows them.':closeReason(view.reason)))];
  const reason=reasons.length>2?'OpenRig gave several reasons. Check these views before trying again.':reasons.join(' ');
  const count=result.closed?`Closed ${result.closed} of ${total} old views.`:"Couldn't close the old views.";
  return [`${count} Not confirmed: ${failedViewNames(result.failedViews)}. ${reason} They may still be open.`,uncheckedText].filter(Boolean).join(' ');
}
function canTraverseLayout(node){
  if(!node||typeof node!=='object'||Array.isArray(node))return false;
  const container=['row','column','stack'].includes(node.type);
  if(!container&&node.children===undefined)return true;
  return Array.isArray(node.children)&&node.children.every(canTraverseLayout);
}
async function readStripLayout(host,appHome,name){
  if(!safeLayoutName(name)||!(host.layouts?.()??[]).includes(name))return {state:'missing'};
  try{
    const tree=JSON.parse(await host.readTextFile(`${appHome}/layouts/${name}.json`));
    if(!canTraverseLayout(tree)||!['block','row','column','stack'].includes(tree.type))return {state:'unreadable'};
    if(!(host.layouts?.()??[]).includes(name))return {state:'missing'};
    return {state:hasOldProviderStrip(tree)?'strip':'ready',tree};
  }catch{return {state:'unreadable'};}
}
/** Only Herdr's public layout list and files; never the provider's journal or generated-file ownership markers. */
export async function oldStripLayouts(host,appHome){
  const choices=[];
  for(const name of host.layouts?.()??[]){
    if(!safeLayoutName(name))continue;
    if((await readStripLayout(host,appHome,name)).state==='ready')choices.push({name,label:oldStripLayoutLabel(name)});
  }
  return choices;
}

/** A layout-only page needs a native replacement before the old layout disappears. Existing tab pages stay as they are. */
async function keepRigPage(host,ensure=false){
  const page=layoutNodes(host.layout()).find(node=>node.content?.mod===MOD_IDS.view);
  if(!page&&!ensure)return;
  const pageProps=page?.content?.props??{};
  const tabs=()=>new Set((host.spaces?.()??[]).flatMap(space=>space.tabs??[]).map(tab=>tab.id));
  const before=tabs(),nav=host.shared?.('rig.nav');
  const run=async(name,args)=>{const result=await host.run(name,args);if(result?.error)throw Error(String(result.error));};
  // The layout's props are its opening route. Legacy navigation updates rig.nav.
  const stack=nav?.stack?.length?nav.stack:pageProps.entry?[pageProps.entry]:[];
  const pages=host.shared?.('rig.tabPages')??{},entry=stack.at(-1);
  const rigPanes=(host.panes?.()??[]).filter(pane=>pane.mod===MOD_IDS.view&&before.has(pane.tab));
  const native=rigPanes.filter(pane=>rigPanes.filter(other=>other.tab===pane.tab).length===1);
  const active=(host.spaces?.()??[]).find(space=>space.active)??host.spaces?.()[0];
  const existing=native.find(pane=>(entry||page&&pages[pane.tab])&&navKey(pages[pane.tab]?.stack?.at(-1))===navKey(entry))
    ??(!page&&native.find(pane=>active?.tabs?.some(tab=>tab.id===pane.tab)));
  if(existing){
    const held=pages[existing.tab]?.stack??[];
    if(entry&&navKey(held.at(-1))!==navKey(entry))host.setShared?.('rig.tabPages',{...pages,[existing.tab]:{stack:[...held,entry].slice(-30),at:Date.now()}});
    const space=(host.spaces?.()??[]).find(space=>space.tabs?.some(tab=>tab.id===existing.tab));
    if(space)await run('space.select',{id:space.id});
    await run('tab.select',{id:existing.tab});
    return existing.tab;
  }
  if(!(host.spaces?.()??[]).length){
    await run('space.new',{name:'OpenRig'});
    for(let i=0;i<20&&!(host.spaces?.()??[]).length;i++)await host.wait(50);
    if(!(host.spaces?.()??[]).length)throw Error('Herdr did not confirm a space for the Rig page.');
  }
  const destination=(host.spaces?.()??[]).find(space=>space.active)??host.spaces?.()[0];
  await run('tab.new',{name:'Rig',space:destination.id,mod:MOD_IDS.view,props:entry?{...pageProps,entry}:pageProps});
  for(let i=0;i<20;i++){
    const pane=(host.panes?.()??[]).find(p=>p.mod===MOD_IDS.view&&!before.has(p.tab));
    if(pane){
      host.setShared?.('rig.tabPages',{...(host.shared?.('rig.tabPages')??{}),[pane.tab]:{stack,at:Date.now()}});
      return pane.tab;
    }
    await host.wait(50);
  }
  throw Error('Herdr did not confirm the Rig page in a tab. The layout was not switched.');
}

/** Native pane mods survive layout replacement; layout-owned sidebars and pages do not. */
export async function ensureOldStripPage(host){
  const tab=await keepRigPage(host,true);
  const wrapper=layoutNodes(host.layout()).find(node=>node.header?.content?.mod==='rig-strip');
  const main=wrapper?.header.content.props?.main;
  const holdsTabs=child=>layoutNodes(child).some(node=>node.content?.tab==='active');
  const child=wrapper?.children?.find(child=>child.id===main&&holdsTabs(child))??wrapper?.children?.find(holdsTabs);
  if(child)await host.run('layout.select',{stack:wrapper.id,child:child.id});
  return tab;
}

/** Closing viewers and leaving their layout are separate effects. No provider files are ever changed here. */
export async function leaveOldStrip(host,config,views,appHome,capsFor,returnLayout){
  const label=oldStripLayoutLabel(returnLayout),lines=[];
  let result={ok:true,closed:0,failures:[]},switched=false;
  if((await readStripLayout(host,appHome,returnLayout)).state!=='ready')return{ok:false,closed:0,switched:false,title:"Still in OpenRig's old strip",text:`Couldn't switch to ${label}: that layout changed or is no longer available. Open the palette (Ctrl+Shift+P) and choose a Layout.\nYour seats keep running.`};
  if(views.length){
    const {candidates,pending}=oldViewAvailability(config,capsFor);
    if(!candidates.length&&!pending){
      result={ok:false,closed:0,failures:[]};lines.push("The old views weren't closed: this OpenRig can't close them from here.");
    }else{
      result=await closeOldViews(host,config,views,appHome,capsFor);
      if(result.ok)lines.push(result.closed?`Closed ${result.closed} old view${result.closed===1?'':'s'}.`:'Nothing needed closing.');
      else lines.push(closeFailureText(result));
    }
  }
  try{
    await host.beforeSwitch?.();
    if((await readStripLayout(host,appHome,returnLayout)).state!=='ready')throw Error('That layout changed or is no longer available');
    await keepRigPage(host);
    await host.beforeSwitch?.();
    const destination=await readStripLayout(host,appHome,returnLayout);
    if(destination.state==='unreadable'){
      lines.push(`Couldn't read ${label} just before switching, so the window stayed where it was. Pick a layout again.`);
      return{...result,ok:false,switched:false,title:"Still in OpenRig's old strip",text:[...lines,'Your seats keep running.'].join('\n')};
    }
    if(destination.state!=='ready')throw Error('That layout changed or is no longer available');
    host.checkActive?.();
    host.willSwitch?.();
    const reply=await host.run('layout.switch',{name:returnLayout});
    if(reply?.error)throw Error(String(reply.error));
    for(let i=0;i<20&&host.currentLayout?.()!==returnLayout&&!host.didSwitch?.();i++)await host.wait(50);
    // A successful run can remove the initiating sidebar before Herdr publishes its new public snapshot.
    if(!host.didSwitch?.()&&(host.currentLayout?.()!==returnLayout||hasOldProviderStrip(host.layout())))throw Error('Herdr did not confirm the layout switch.');
    switched=true;lines.push(returnLayout==='main'?"Now using Herdr. The Rig sidebar isn't in this layout.":`Now using ${label}.`);
  }catch(error){
    const detail=displayErrorLine(error?.message??error);
    if(!detail){
      const message=`Herdr didn't confirm the switch to ${label}. If the strip is still on screen, open the palette (Ctrl+Shift+P) and choose a Layout.`;
      return{...result,ok:false,switched:false,title:'Layout switch not confirmed',text:[message,...lines,'Your seats keep running.'].join('\n')};
    }
    lines.push(`Couldn't switch to ${label}: ${detail} Open the palette (Ctrl+Shift+P) and choose a Layout.`);
  }
  lines.push('Your seats keep running.');
  return{...result,ok:result.ok&&switched,switched,title:switched?"Left OpenRig's old strip":"Still in OpenRig's old strip",text:lines.join('\n')};
}

/** Old provider strips expose their view ids through Herdr's public layout props. No daemon-private labels or files. */
export function oldProviderViews(tree){
  const found=new Map();
  const walk=node=>{
    if(!node||typeof node!=='object')return;
    const content=node.content;
    if(content?.mod==='rig-strip')for(const view of Array.isArray(content.props?.views)?content.props.views:[]){
      if(typeof view?.id==='string'&&/^rv-[A-Za-z0-9_-]{1,160}$/.test(view.id)&&!found.has(view.id))
        found.set(view.id,{id:view.id,name:cleanDisplay(view.name??view.id).slice(0,160)||view.id});
    }
    walk(node.header);walk(content?.pane?.header);for(const child of Array.isArray(node.children)?node.children:[])walk(child);
  };walk(tree);return [...found.values()];
}
function localOldViewAuthorities(config){
  if(!config||config.configInvalid)return [];
  const list=config.connections?.length?config.connections.map(c=>configOfConnection(config,c.id)).filter(Boolean):[config];
  return list.filter(c=>!c.daemonMachine);
}
function oldViewAvailability(config,capsFor){
  const candidates=[];
  let pending=false;
  for(const authority of localOldViewAuthorities(config)){
    const caps=capsFor(authority.connectionId??LEGACY_CONNECTION_ID);
    if(caps?.probed===false||typeof caps?.herdrAppProvider!=='boolean')pending=true;
    else if(caps.herdrAppProvider)candidates.push(authority);
  }
  return{candidates,pending};
}
export function oldViewCandidates(config,capsFor){
  return oldViewAvailability(config,capsFor).candidates;
}
const authorityId=config=>config.connectionId??LEGACY_CONNECTION_ID;
const pinnedAddress=config=>config.daemonUrlSource==='cli'||config.daemonUrlSource==='default'?null:config.daemonUrl??null;
const authorityIdentity=(config,address,hostId)=>({id:authorityId(config),address,home:config.openrigHome??null,hostId:typeof hostId==='string'&&hostId?hostId:null});
const completeAuthority=identity=>Boolean(identity?.address&&identity?.hostId);
const receiptKey=identities=>JSON.stringify(identities.slice().sort((a,b)=>a.id.localeCompare(b.id)));
const readGone=shared=>shared?.('rig.oldProviderGone')?.receipts??{};
const sameAuthorities=(receipt,identities)=>receipt.scope===receiptKey(identities);

/** Display uses the sidebar's last resolution for each connection, scoped to its own raw settings. */
function publishedAuthorities(shared,config,capsFor,published=shared?.('rig.data')){
  const {candidates,pending}=oldViewAvailability(config,capsFor);
  if(pending||!candidates.length)return null;
  const identities=candidates.map(candidate=>{
    const current=publishedConfigFor(candidate,published);
    const own=published?.byConnection?.[authorityId(candidate)]??(current===published?.config?published:null);
    const matches=publishedUnder(candidate,published)&&own?.answering!==false;
    const pinned=pinnedAddress(candidate);
    const discovered=matches?current?.daemonUrl:null;
    const address=pinned??(discovered&&isLoopbackDaemonUrl(discovered)?discovered:null);
    const hostId=matches&&address===discovered?own?.healthz?.selfHostId:null;
    return authorityIdentity(candidate,address,hostId);
  });
  return identities.every(completeAuthority)?identities:null;
}
export function oldViewsGone(shared,config,capsFor=()=>({herdrAppProvider:true})){
  const receipts=readGone(shared);
  if(!Object.keys(receipts).length)return [];
  const identities=publishedAuthorities(shared,config,capsFor);
  return identities?Object.keys(receipts).filter(id=>sameAuthorities(receipts[id],identities)):[];
}
export function pruneOldViewsGone(shared,setShared,config,capsFor,published){
  const receipts=readGone(shared);
  if(!Object.keys(receipts).length)return;
  const identities=publishedAuthorities(shared,config,capsFor,published);
  if(!identities)return; // An incomplete publication cannot establish that an authority moved.
  const kept=Object.fromEntries(Object.entries(receipts).filter(([,receipt])=>sameAuthorities(receipt,identities)));
  if(Object.keys(kept).length!==Object.keys(receipts).length)setShared('rig.oldProviderGone',{receipts:kept});
}
export function visibleOldViewsGone(shared,config,terms){
  return oldViewsGone(shared,config,id=>connectionCapabilities(shared,config,id,terms));
}
async function verifyAuthority(host,config,address){
  if(host.fetchFor){
    try{
      const response=await host.fetchFor(config)(`${address}/healthz`);
      if(!response.ok)return null;
      return authorityIdentity(config,address,(await response.json())?.selfHostId);
    }catch{return null;}
  }
  return authorityIdentity(config,address,null);
}
async function resolveAuthority(host,config){
  const pinned=pinnedAddress(config);
  if(pinned)return verifyAuthority(host,config,pinned);
  const {daemonUrl,reachable}=await discoverDaemonFromCli(config,host.execFor(config));
  return reachable&&daemonUrl&&isLoopbackDaemonUrl(daemonUrl)?verifyAuthority(host,config,daemonUrl):null;
}
export function knownOldProviderViews(tree,cached=[],gone=[]){
  const found=new Map(cached.map(view=>[view.id,{...view,current:false}]));
  for(const view of oldProviderViews(tree))found.set(view.id,{...found.get(view.id),...view,current:true});
  return [...found.values()].filter(view=>!gone.includes(view.id));
}
/** Read-only dependency on Herdr's documented layouts/<name>.json format.
 * Unknown shapes, unreadable files and malformed JSON are skipped independently. */
async function scanOldProviderViews(host,appHome){
  const found=new Map(oldProviderViews(host.layout()).map(view=>[view.id,{...view,current:true,layouts:[]}]));
  const unreadable=new Set();
  for(const name of host.layouts?.()??[]){
    if(typeof name!=='string'||!name||name==='.'||name==='..'||/[\/\\\u0000-\u001f]/.test(name))continue;
    try{
      const tree=JSON.parse(await host.readTextFile(`${appHome}/layouts/${name}.json`));
      if(!canTraverseLayout(tree)||!['block','row','column','stack'].includes(tree.type)&&!hasOldProviderStrip(tree)){unreadable.add(name);continue;}
      for(const view of oldProviderViews(tree)){
        const prior=found.get(view.id)??{...view,current:false,layouts:[]};
        if(!prior.layouts.includes(name))prior.layouts.push(name);
        found.set(view.id,prior);
      }
    }catch{unreadable.add(name);}
  }
  return {views:[...found.values()],unreadable};
}
export async function readOldProviderViews(host,appHome){return (await scanOldProviderViews(host,appHome)).views;}
export function oldViewsLocationText(views){
  const current=views.filter(v=>v.current!==false).length,saved=views.length-current;
  const names=[...new Set(views.filter(v=>v.current===false).flatMap(v=>v.layouts??[]))];
  return `${views.length} old view${views.length===1?'':'s'}: ${current} in this window, ${saved} in saved layouts${names.length?` (${names.join(', ')})`:''}. Only their viewers end; your seats keep running.`;
}
/** A view-not-found is the only result that permits trying another local OpenRig. All other failures remain uncertain. */
/** Explicit fallback: close only the reviewed views; the current layout is never changed. */
export async function closeOldViewsOnly(host,config,views,appHome,capsFor){
  const result=await closeOldViews(host,config,views,appHome,capsFor);
  const text=result.ok?(result.closed?`Closed ${result.closed} old view${result.closed===1?'':'s'}.`:'Nothing needed closing.'):closeFailureText(result);
  return{...result,switched:false,title:result.ok?(result.closed?"Closed OpenRig's old views":'The old views were already gone'):result.closed||result.uncheckedViews.length?"Some old views weren't closed":"Couldn't close the old views",
    text:`${text}\nThe strip stays until you choose a layout from the palette (Ctrl+Shift+P, then Layout).\nYour seats keep running.`};
}
export async function closeOldViews(host,config,views,appHome,capsFor){
  const {candidates,pending}=oldViewAvailability(config,capsFor),failures=[],failedViews=[],uncheckedViews=[];let closed=0;
  const completed=new Map(),answering=new Map();
  let identities,scope=null;
  const fail=(view,reason)=>{failures.push(`${view.name}: ${reason}`);failedViews.push({id:view.id,name:view.name,reason:closeReason(reason)});};
  const readAuthorized=async candidate=>{
    const current=await host.currentConfig(),live=configOfConnection(current,authorityId(candidate));
    if(current?.configInvalid||Array.isArray(current?.connections)&&!current.connections.some(c=>c.id===authorityId(candidate))
      ||!live||live.daemonMachine||live.daemonUrl!==candidate.daemonUrl||live.openrigHome!==candidate.openrigHome)throw Error('OpenRig settings changed. Reopen this confirmation. Nothing was sent.');
    return live;
  };
  for(const reviewed of views){
    const view={...reviewed,name:cleanDisplay(reviewed.name).slice(0,160)||reviewed.id};
    const inventory=await scanOldProviderViews(host,appHome);
    if(!inventory.views.some(v=>v.id===view.id)){
      if(view.layouts?.some(name=>inventory.unreadable.has(name))||!view.layouts?.length&&inventory.unreadable.size)uncheckedViews.push(view);
      continue;
    }
    let known=false;
    const answered=[];
    if(!identities){
      identities=await Promise.all(candidates.map(async candidate=>{
        try{return await resolveAuthority(host,await readAuthorized(candidate));}
        catch{return null;} // The original authorization check still runs before a write.
      }));
      scope=!pending&&identities.length&&identities.every(completeAuthority)?receiptKey(identities):null;
    }
    const previous=readGone(host.shared)[view.id];
    if(previous&&scope===previous.scope)continue;
    if(previous&&scope&&host.setShared){
      const receipts={...readGone(host.shared)};delete receipts[view.id];host.setShared('rig.oldProviderGone',{receipts});
    }
    for(const [index,candidate] of candidates.entries()){
      try{
        const live=await readAuthorized(candidate),identity=identities[index];
        // The raw settings authorize the operation. When discovery can name
        // the local daemon, use that same address for the close and its receipt.
        const destination=identity&&!pinnedAddress(live)?{...live,daemonUrl:identity.address,daemonUrlSource:'configured'}:live;
        const command=writeCommand(destination,['terminal','close','--app-home',appHome,'--json','--',view.id]);
        if(!command)throw Error('This OpenRig cannot run the close command. Nothing was sent.');
        const receipt=await host.execFor(live)(command.command,command.args,{timeout:30000}),result=writeOutcome(receipt);
        // writeOutcome normalizes CLI words, but does not carry transport/producer uncertainty flags.
        if([receipt,result.json,result.json?.error].some(value=>value?.outcomeUnknown===true||value?.uncertain===true)){
          fail(view,'The close was not confirmed. Check this view before trying again.');known=true;break;
        }
        const notFound=result.json?.error?.code==='view_not_found'||result.json?.code==='view_not_found';
        if((result.ok||notFound)&&scope&&host.setShared){
          answering.set(identity,live);
          answered.push(identity);
        }
        if(result.ok){closed++;if(answered.length)completed.set(view.id,answered);known=true;break;}
        if(notFound)continue;
        fail(view,result.text||'The close was not confirmed.');known=true;break;
      }catch(error){fail(view,String(error?.message??error));known=true;break;}
    }
    if(!known){
      if(pending)fail(view,'herdrig is still checking whether every local OpenRig can close old views. Try again after it finishes.');
      else if(candidates.length){if(answered.length)completed.set(view.id,answered);}
      else fail(view,'No OpenRig on this computer knows it.');
    }
  }
  if(completed.size){
    const verified=new Set();
    await Promise.all([...answering].map(async([identity,live])=>{
      const current=await verifyAuthority(host,live,identity.address);
      if(current?.hostId===identity.hostId)verified.add(identity);
    }));
    const receipts=Object.fromEntries([...completed].filter(([,ids])=>ids.every(id=>verified.has(id)))
      .map(([id,answered])=>[id,{scope,answered}]));
    if(Object.keys(receipts).length)host.setShared('rig.oldProviderGone',{receipts:{...readGone(host.shared),...receipts}});
  }
  return{ok:failures.length===0&&uncheckedViews.length===0,text:`Closed ${closed} old view${closed===1?'':'s'}; seats keep running.${failures.length?'\n'+failures.join('\n'):''}`,closed,failures,failedViews,uncheckedViews};
}
