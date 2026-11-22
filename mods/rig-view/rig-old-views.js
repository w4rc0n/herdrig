import {configOfConnection,LEGACY_CONNECTION_ID} from './rig-connections.js';
import {writeCommand,writeOutcome,MOD_IDS,navKey} from './rig-lib.js';

const safeLayoutName=name=>typeof name==='string'&&name&&name!=='.'&&name!=='..'&&!/[\/\\\u0000-\u001f]/.test(name);
function layoutNodes(tree){
  const out=[];
  const walk=node=>{if(!node||typeof node!=='object')return;out.push(node);walk(node.header);walk(node.content?.pane?.header);for(const child of Array.isArray(node.children)?node.children:[])walk(child);};
  walk(tree);return out;
}
export const hasOldProviderStrip=tree=>layoutNodes(tree).some(node=>node.content?.mod==='rig-strip');
export const oldStripLayoutLabel=name=>name==='main'?'Herdr':name;
function closeReason(value){
  const text=String(value??'').trim();
  if(/^(?:Error:\s*)?(?:OpenRig )?Daemon (?:is )?not running\./i.test(text))return "OpenRig isn't running.";
  if(!text||/[\r\n]/.test(text)||text.length>180)return 'OpenRig did not confirm the close.';
  const line=text.replace(/^Error:\s*/,'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
  return /[.!?]$/.test(line)?line:`${line}.`;
}
function failedViewNames(views){
  const counts=new Map();
  for(const view of views)counts.set(view.name,(counts.get(view.name)??0)+1);
  const entries=[...counts],shown=entries.slice(0,3).map(([name,count])=>count>1?`${name} (${count})`:name);
  const more=entries.slice(3).reduce((sum,[,count])=>sum+count,0);
  if(more)shown.push(`and ${more} more`);
  return shown.join(', ');
}
function closeFailureText(result,total){
  const unknown="No OpenRig on this computer knows it.",unknownCount=result.failedViews.filter(view=>view.reason===unknown).length;
  const reasons=[...new Set(result.failedViews.map(view=>view.reason===unknown&&unknownCount>1?'No OpenRig on this computer knows them.':closeReason(view.reason)))];
  const reason=reasons.length>2?'OpenRig gave several reasons. Check these views before trying again.':reasons.join(' ');
  const count=result.closed?`Closed ${result.closed} of ${total} old views.`:"Couldn't close the old views.";
  return `${count} Not confirmed: ${failedViewNames(result.failedViews)}. ${reason} They may still be open.`;
}
/** Only Herdr's public layout list and files; never the provider's journal or generated-file ownership markers. */
export async function oldStripLayouts(host,appHome){
  const choices=[];
  for(const name of host.layouts?.()??[]){
    if(!safeLayoutName(name))continue;
    try{
      const tree=JSON.parse(await host.readTextFile(`${appHome}/layouts/${name}.json`));
      if(tree&&['block','row','column','stack'].includes(tree.type)&&!hasOldProviderStrip(tree))choices.push({name,label:oldStripLayoutLabel(name)});
    }catch{} // A missing/unreadable layout cannot be selected for recovery.
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
  const pages=host.shared?.('rig.tabPages')??{},entry=pageProps.entry??nav?.stack?.at(-1);
  const rigPanes=(host.panes?.()??[]).filter(pane=>pane.mod===MOD_IDS.view&&before.has(pane.tab));
  const native=rigPanes.filter(pane=>rigPanes.filter(other=>other.tab===pane.tab).length===1);
  const active=(host.spaces?.()??[]).find(space=>space.active)??host.spaces?.()[0];
  const existing=native.find(pane=>entry&&navKey(pages[pane.tab]?.stack?.at(-1))===navKey(entry))
    ??native.find(pane=>active?.tabs?.some(tab=>tab.id===pane.tab));
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
  await run('tab.new',{name:'Rig',space:destination.id,mod:MOD_IDS.view,props:pageProps});
  for(let i=0;i<20;i++){
    const pane=(host.panes?.()??[]).find(p=>p.mod===MOD_IDS.view&&!before.has(p.tab));
    if(pane){
      if(nav?.stack)host.setShared?.('rig.tabPages',{...(host.shared?.('rig.tabPages')??{}),[pane.tab]:{stack:nav.stack,at:Date.now()}});
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
  if(!(await oldStripLayouts(host,appHome)).some(choice=>choice.name===returnLayout))return{ok:false,closed:0,switched:false,title:"Still in OpenRig's old strip",text:`Couldn't switch to ${label}: that layout changed or is no longer available. Open the palette (Ctrl+Shift+P) and choose a Layout.\nYour seats keep running.`};
  if(views.length){
    if(!oldViewCandidates(config,capsFor).length){
      result={ok:false,closed:0,failures:[]};lines.push("The old views weren't closed: this OpenRig can't close them from here.");
    }else{
      result=await closeOldViews(host,config,views,appHome,capsFor);
      if(result.ok)lines.push(`Closed ${result.closed} old views.`);
      else lines.push(closeFailureText(result,views.length));
    }
  }
  try{
    await host.beforeSwitch?.();
    if(!(await oldStripLayouts(host,appHome)).some(choice=>choice.name===returnLayout))throw Error('That layout changed or is no longer available.');
    await keepRigPage(host);
    await host.beforeSwitch?.();
    host.willSwitch?.();
    const reply=await host.run('layout.switch',{name:returnLayout});
    if(reply?.error)throw Error(String(reply.error));
    for(let i=0;i<20&&host.currentLayout?.()!==returnLayout&&!host.didSwitch?.();i++)await host.wait(50);
    // A successful run can remove the initiating sidebar before Herdr publishes its new public snapshot.
    if(!host.didSwitch?.()&&(host.currentLayout?.()!==returnLayout||hasOldProviderStrip(host.layout())))throw Error('Herdr did not confirm the layout switch.');
    switched=true;lines.push(returnLayout==='main'?"Now using Herdr. The Rig sidebar isn't in this layout.":`Now using ${label}.`);
  }catch(error){lines.push(`Couldn't switch to ${label}: ${String(error?.message??error)}. Open the palette (Ctrl+Shift+P) and choose a Layout.`);}
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
        found.set(view.id,{id:view.id,name:String(view.name??view.id).slice(0,160)});
    }
    walk(node.header);walk(content?.pane?.header);for(const child of Array.isArray(node.children)?node.children:[])walk(child);
  };walk(tree);return [...found.values()];
}
export function oldViewCandidates(config,capsFor){
  if(!config||config.configInvalid)return [];
  const list=config.connections?.length?config.connections.map(c=>configOfConnection(config,c.id)).filter(Boolean):[config];
  return list.filter(c=>!c.daemonMachine&&capsFor(c.connectionId??LEGACY_CONNECTION_ID)?.herdrAppProvider===true);
}
export function knownOldProviderViews(tree,cached=[]){
  const found=new Map(cached.map(view=>[view.id,{...view,current:false}]));
  for(const view of oldProviderViews(tree))found.set(view.id,{...found.get(view.id),...view,current:true});
  return [...found.values()];
}
/** Read-only dependency on Herdr's documented layouts/<name>.json format.
 * Unknown shapes, unreadable files and malformed JSON are skipped independently. */
export async function readOldProviderViews(host,appHome){
  const found=new Map(oldProviderViews(host.layout()).map(view=>[view.id,{...view,current:true,layouts:[]}]));
  for(const name of host.layouts?.()??[]){
    if(typeof name!=='string'||!name||name==='.'||name==='..'||/[\/\\\u0000-\u001f]/.test(name))continue;
    try{
      const tree=JSON.parse(await host.readTextFile(`${appHome}/layouts/${name}.json`));
      for(const view of oldProviderViews(tree)){
        const prior=found.get(view.id)??{...view,current:false,layouts:[]};
        if(!prior.layouts.includes(name))prior.layouts.push(name);
        found.set(view.id,prior);
      }
    }catch{} // A stale or unrecognized layout is not authority to mutate it.
  }
  return [...found.values()];
}
export function oldViewsLocationText(views){
  const current=views.filter(v=>v.current!==false).length,saved=views.length-current;
  const names=[...new Set(views.filter(v=>v.current===false).flatMap(v=>v.layouts??[]))];
  return `${views.length} old view${views.length===1?'':'s'}: ${current} in this window, ${saved} in saved layouts${names.length?` (${names.join(', ')})`:''}. Only their viewers end; your seats keep running.`;
}
/** A view-not-found is the only result that permits trying another local OpenRig. All other failures remain uncertain. */
export async function closeOldViews(host,config,views,appHome,capsFor){
  const candidates=oldViewCandidates(config,capsFor),failures=[],failedViews=[];let closed=0;
  const fail=(view,reason)=>{failures.push(`${view.name}: ${reason}`);failedViews.push({id:view.id,name:view.name,reason:closeReason(reason)});};
  for(const view of views){
    if(!(await readOldProviderViews(host,appHome)).some(v=>v.id===view.id))continue;
    let known=false;
    for(const candidate of candidates){
      try{
        const current=await host.currentConfig(),live=configOfConnection(current,candidate.connectionId??LEGACY_CONNECTION_ID);
        if(current?.configInvalid||Array.isArray(current?.connections)&&!current.connections.some(c=>c.id===(candidate.connectionId??LEGACY_CONNECTION_ID))
          ||!live||live.daemonMachine||live.daemonUrl!==candidate.daemonUrl||live.openrigHome!==candidate.openrigHome)throw Error('OpenRig settings changed. Reopen this confirmation. Nothing was sent.');
        const command=writeCommand(live,['terminal','close','--app-home',appHome,'--json','--',view.id]);
        if(!command)throw Error('This OpenRig cannot run the close command. Nothing was sent.');
        const receipt=await host.execFor(live)(command.command,command.args,{timeout:30000}),result=writeOutcome(receipt);
        // writeOutcome normalizes CLI words, but does not carry transport/producer uncertainty flags.
        if([receipt,result.json,result.json?.error].some(value=>value?.outcomeUnknown===true||value?.uncertain===true)){
          fail(view,'The close was not confirmed. Check this view before trying again.');known=true;break;
        }
        if(result.ok){closed++;known=true;break;}
        if(result.json?.error?.code==='view_not_found'||result.json?.code==='view_not_found')continue;
        fail(view,result.text||'The close was not confirmed.');known=true;break;
      }catch(error){fail(view,String(error?.message??error));known=true;break;}
    }
    if(!known)fail(view,'No OpenRig on this computer knows it.');
  }
  return{ok:failures.length===0,text:`Closed ${closed} old view${closed===1?'':'s'}; seats keep running.${failures.length?'\n'+failures.join('\n'):''}`,closed,failures,failedViews};
}
