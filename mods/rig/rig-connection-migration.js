// Remember identity, not authority: a match only moves display/controller state.
// Every subsequent controller operation still validates its live destination.
import {connectionsOf,connectionConfig,LEGACY_CONNECTION_ID} from './rig-connections.js';
import {rigOrigin} from './rig-space-context.js';
import {workerViewKey} from './rig-worker-identity.js';

export function connectionIdentity(config){
 const origin=rigOrigin(config?.daemonUrl);
 return origin?{origin,machine:config.daemonMachine??null,home:config.openrigHome??null,host:config.expectedHostId??null}:null;
}
const same=(a,b)=>!!a&&!!b&&a.origin===b.origin&&a.machine===b.machine&&a.home===b.home&&a.host===b.host;
const listOf=config=>config.connectionsList===false||config.missing?connectionsOf({...config,connections:undefined}).connections:connectionsOf(config).connections;
const configurations=config=>config&&!config.configInvalid?listOf(config).map(conn=>
 conn.id===LEGACY_CONNECTION_ID&&!config.connectionsList&&config.daemonUrlSource==='cli'
  ?connectionConfig(config,{...conn,daemonUrl:config.daemonUrl})
  :connectionConfig(config,conn)):[];
const label=config=>config.daemonMachine||config.daemonUrl||config.connectionId;
export function resolveConnectionIdentity(identity,oldId,configs){
 if(!identity){const exact=configs.find(config=>config.connectionId===oldId);return exact?{kind:'matched',config:exact}:{kind:'missing-evidence',oldId};}
 const matches=configs.filter(config=>same(identity,connectionIdentity(config)));
 // An existing id disambiguates equal destinations; a rename cannot do that.
 const exact=matches.find(config=>config.connectionId===oldId);
 if(exact)return{kind:'matched',config:exact};
 return matches.length===1?{kind:'matched',config:matches[0]}:
  {kind:matches.length?'ambiguous':'removed',oldId,names:matches.map(label)};
}
const changed=(a,b)=>JSON.stringify(a)!==JSON.stringify(b);
export function migrateConnectionState({shared,setShared,migrateWorkers=true},next,previous=null){
 if(!next||next.configInvalid)return{workersChanged:false,entry:entry=>entry};
 const saved=shared('rig.connectionIdentities')??{};
 // Capture persisted pre-upgrade publication before the caller replaces it.
 const prior=previous??shared('rig.data')?.config;
 const before={...saved};
 const priorConfigs=configurations(prior);
 for(const config of priorConfigs){
  const identity=connectionIdentity(config);
  if(identity||config.connectionId!==LEGACY_CONNECTION_ID)before[config.connectionId]=identity;
 }
 const configs=configurations(next);
 const legacyAddressPending=!next.connectionsList&&configs.some(config=>config.connectionId===LEGACY_CONNECTION_ID&&!config.daemonUrl);
 const resolve=(identity,id)=>{
  const result=resolveConnectionIdentity(identity,id,configs);
  if(result.kind==='matched'&&result.config.connectionId!==id&&priorConfigs.filter(config=>same(identity,connectionIdentity(config))).length>1)
   return{kind:'ambiguous',oldId:id,names:configs.filter(config=>same(identity,connectionIdentity(config))).map(label)};
  return result;
 };
 const mapEntry=(entry,depth=0)=>{
  if(!entry||typeof entry!=='object'||depth>8)return entry;
  const from=entry.from?mapEntry(entry.from,depth+1):entry.from;
  const preserved=from!==entry.from?{...entry,from}:entry;
  // A route with no binding is deliberately dynamic. An existing id keeps its
  // established meaning; config reload already drops cached data and gates.
  // The sidebar can still be on A while this page has independently moved to B.
  if(!entry.conn)return preserved;
  const current=configs.find(config=>config.connectionId===entry.conn);
  if(current){
   if(!entry.connectionIssue)return preserved;
   const recorded=entry.connectionIdentity??entry.connectionIssue.identity;
   if(!same(recorded,connectionIdentity(current)))return preserved;
   const restored={...preserved};delete restored.connectionIssue;delete restored.connectionIdentity;return restored;
  }
  if(entry.connectionIssue?.kind==='ambiguous')return preserved; // rereading config is not a person's ownership choice
  const id=entry.conn??LEGACY_CONNECTION_ID;
  const identity=entry.connectionIdentity??(entry.connectionIssue&&Object.hasOwn(entry.connectionIssue,'identity')?entry.connectionIssue.identity:before[id]);
  // Untargeted pages opened on the current version retain their normal routing.
  if(!entry.conn&&!identity)return entry;
  const result=resolve(identity,id);
  const out={...entry};
  if(result.kind==='matched'){
   out.conn=result.config.connectionId;out.connectionIdentity=connectionIdentity(result.config);delete out.connectionIssue;
  }else out.connectionIssue={...result,identity:identity??null};
  if(entry.from)out.from=from;
  return changed(entry,out)?out:entry;
 };
 const nav=shared('rig.nav');
 if(Array.isArray(nav?.stack)){
  const nextNav={...nav,stack:nav.stack.map(entry=>mapEntry(entry))};
  if(changed(nav,nextNav))setShared('rig.nav',nextNav);
 }
 const pages=shared('rig.tabPages');
 if(pages&&typeof pages==='object'){
  const mapped=Object.fromEntries(Object.entries(pages).map(([key,page])=>[key,Array.isArray(page?.stack)?{...page,stack:page.stack.map(entry=>mapEntry(entry))}:page]));
  if(changed(pages,mapped))setShared('rig.tabPages',mapped);
 }
 const routes=shared('rig.pageRoutes');
 if(routes&&typeof routes==='object'){
  const mapped=Object.fromEntries(Object.entries(routes).map(([key,entry])=>[key,mapEntry(entry)]));
  if(changed(routes,mapped))setShared('rig.pageRoutes',mapped);
 }
 const stored=shared('rig.spaceState')?.workerViews??shared('rig.workerViews')??{};
 const workers={...stored},plans=[];
 const workerEvidence=config=>{
  let identity=connectionIdentity(config);
  const id=config.connectionId??LEGACY_CONNECTION_ID,prior=before[id];
  // Historical serializers omitted host, and legacy entries also omitted home.
  // Recover only absent evidence from the same id's recorded destination.
  // A stored host is always strict; no evidence comes from the new target.
  if(!identity||!prior||identity.origin!==prior.origin||identity.machine!==prior.machine)return identity;
  if(id===LEGACY_CONNECTION_ID&&config.openrigHome==null&&(config.expectedHostId==null||identity.host===prior.host))identity={...identity,home:prior.home};
  if(config.expectedHostId==null&&identity.home===prior.home)identity={...identity,host:prior.host};
  return identity;
 };
 for(const [key,entry] of Object.entries(migrateWorkers?stored:{})){
  if(!entry?.config||!entry.view)continue;
  if(legacyAddressPending&&(entry.config.connectionId??LEGACY_CONNECTION_ID)===LEGACY_CONNECTION_ID)continue;
  const identity=workerEvidence(entry.config);
  if(entry.connectionIssue?.kind==='ambiguous'&&!configs.some(config=>config.connectionId===entry.config.connectionId&&same(connectionIdentity(config),identity)))continue;
  const result=resolve(identity,entry.config.connectionId??LEGACY_CONNECTION_ID);
  if(result.kind!=='matched'){
   workers[key]={...entry,paused:true,connectionIssue:{...result,wasPaused:entry.connectionIssue?.wasPaused??entry.paused??false}};
   continue;
  }
  const config=result.config,newKey=workerViewKey(config,entry.view);
  plans.push({key,newKey,entry,config});
 }
 const counts=new Map();for(const plan of plans)counts.set(plan.newKey,(counts.get(plan.newKey)??0)+1);
 for(const {key,newKey,entry,config} of plans){
  if(newKey!==key&&(stored[newKey]||counts.get(newKey)>1)){
   workers[key]={...entry,paused:true,connectionIssue:{kind:'collision',name:label(config),wasPaused:entry.connectionIssue?.wasPaused??entry.paused??false}};
   continue;
  }
  const legacy=(config.connectionId??LEGACY_CONNECTION_ID)===LEGACY_CONNECTION_ID;
  const bound={...entry.config,daemonUrl:config.daemonUrl,daemonMachine:config.daemonMachine};
  if(legacy)delete bound.connectionId;else bound.connectionId=config.connectionId;
  if(Array.isArray(config.rig))bound.rig=[...config.rig];else delete bound.rig;
  for(const field of ['openrigHome','expectedHostId']){
   if(field==='openrigHome'&&legacy&&!Object.hasOwn(entry.config,field)){delete bound[field];continue;}
   if(config[field])bound[field]=config[field];else delete bound[field];
  }
  const migrated={...entry,config:bound,paused:entry.connectionIssue?.wasPaused??entry.paused};
  delete migrated.connectionIssue;
  if(key!==newKey)delete workers[key];
  workers[newKey]=migrated;
 }
 const workersChanged=changed(stored,workers);
 if(workersChanged){
  setShared('rig.workerMigrationGeneration',(shared('rig.workerMigrationGeneration')??0)+1);
  setShared('rig.workerViews',workers);
  setShared('rig.spaceState',{...(shared('rig.spaceState')??{}),workerViews:workers});
 }
 const identities={...before};
 for(const config of configs){
  if(legacyAddressPending&&config.connectionId===LEGACY_CONNECTION_ID)continue;
  identities[config.connectionId]=connectionIdentity(config);
 }
 if(changed(saved,identities))setShared('rig.connectionIdentities',identities);
 return{workersChanged,entry:mapEntry};
}
