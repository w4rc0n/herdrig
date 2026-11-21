import {configOfConnection,LEGACY_CONNECTION_ID} from './rig-connections.js';
import {writeCommand,writeOutcome} from './rig-lib.js';

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
  const candidates=oldViewCandidates(config,capsFor),failures=[];let closed=0;
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
          failures.push(`${view.name}: The close was not confirmed. Check this view before trying again.`);known=true;break;
        }
        if(result.ok){closed++;known=true;break;}
        if(result.json?.error?.code==='view_not_found'||result.json?.code==='view_not_found')continue;
        failures.push(`${view.name}: ${result.text||'The close was not confirmed.'}`);known=true;break;
      }catch(error){failures.push(`${view.name}: ${String(error?.message??error)}`);known=true;break;}
    }
    if(!known)failures.push(`${view.name}: no OpenRig on this computer has it; close its Herdr tab.`);
  }
  const savedLayouts=[...new Set(views.flatMap(view=>view.layouts??[]))];
  const leftovers=savedLayouts.length?` In ${savedLayouts.join(', ')}, close any leftover tab with Herdr's tab close.`:'';
  return{ok:failures.length===0,text:`Closed ${closed} old view${closed===1?'':'s'}; seats keep running.${leftovers}${failures.length?'\n'+failures.join('\n'):''}`,closed,failures};
}
