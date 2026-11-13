// Spec permission is independent of Attach permission. Every operation checks the
// configured machine and freshly resolved box roots, including after a dialog.
import { RemoteMachine } from './rig-remote.js';
import { specCopyName } from './rig-lib.js';
export const SPEC_SHA256 = '162d0c552afc5c86e5d9918d9bbb51cf11c40fcb386ebb386efbc5e39ced2330';
const jobs = new Map();
const identity = r => [r.target ?? '', r.id ?? '', r.via ?? '', r.session ?? ''];
const parse = r => {
 let data;try { data=JSON.parse(r.stdout); } catch { throw Error(r.stderr || 'Invalid spec helper response.'); }
 if(r.code!==0 || data.error)throw Object.assign(Error(data.error || r.stderr || 'The spec operation failed.'),{code:data.code});
 return data;
};
export class RemoteSpecs {
 constructor(host) { this.host=host; }
 call(config, mode, args=[]) {
  const node=config.rig?.[0]?.match(/(?:^|\/)node$/)?config.rig[0]:'node';
  return this.host.exec(node,[this.host.specBridgePath,mode,...args],{timeout:60000}).then(parse);
 }
 async checked(config, consent=null) {
  const host=this.host,machine=config.daemonMachine;
  const state=await new RemoteMachine(host).readIdentity(config);
  if(!state.localHealth?.selfHostId || state.localHealth.selfHostId!==state.remoteHealth?.selfHostId)
   throw Error('The tunnel and selected Herdr machine do not report the same OpenRig host ID. Check daemonMachine and the tunnel destination.');
  const {info,record}=state;
  const shipped=await this.call(config,'inspect');
  if(shipped.sha256!==SPEC_SHA256)throw Error('The spec helper differs from this release. Reinstall the mod.');
  const preview=await this.call(config,'preview',[machine,info.home,info.searchPath,JSON.stringify(record)]);
  if(!Array.isArray(preview.roots)||!preview.roots.length)throw Error('No user spec folder was found on the box.');
  const key=JSON.stringify({machine,profile:identity(record),home:info.home,user:info.user,daemonUrl:config.daemonUrl,
   selfHostId:state.localHealth.selfHostId,sha256:SPEC_SHA256,roots:preview.roots});
  if(consent && consent.key!==key)throw Error('The machine, helper or spec folders changed since confirmation. Review spec-save permission again.');
  const stored=await host.readSpecConsent();
  if(stored?.key!==key && consent?.key!==key)return{ok:false,needsConsent:true,confirmation:{key,machine,user:info.user,roots:preview.roots,sha256:SPEC_SHA256,helperPath:`${info.home}/.local/share/herdr-openrig/rig-spec-files.cjs`}};
  await this.unchanged(config,record);
  await this.call(config,'install',[machine,info.home,JSON.stringify(record)]);
  const prepared={config,machine,home:info.home,node:info.node,record,roots:preview.roots,key};
  const roots=await this.remote(prepared,'roots');
  if(JSON.stringify(roots.roots)!==JSON.stringify(preview.roots))throw Error('The spec folders changed. Review spec-save permission again.');
  if(consent && stored?.key!==key)await host.writeSpecConsent({key});
  return{ok:true,...prepared};
 }
 async unchanged(config,record){
  const current=await this.host.currentConfig();
  if(current.daemonMachine!==config.daemonMachine || current.daemonUrl!==config.daemonUrl)
   throw Error('The OpenRig connection changed. Nothing was written.');
  const fresh=await new RemoteMachine(this.host).ready(config.daemonMachine);
  if(JSON.stringify(identity(fresh))!==JSON.stringify(identity(record)))throw Error('The Herdr machine changed. Nothing was written.');
 }
 remote(p,verb,target='',expectedSha256=''){
  return this.call(p.config,'run',[this.host.appHome,p.machine,p.home,p.node,verb,target,expectedSha256,JSON.stringify(p.roots),JSON.stringify(p.record)]);
 }
 async transfer(config,text,operation){
  // O_EXCL in the bridge also serializes separate mod runtimes/windows. Only
  // remove a transfer this operation successfully created.
  await this.call(config,'prepare',[this.host.appHome]);
  try{
   await this.host.writeText(`${this.host.appHome}/openrig/spec-transfer.txt`,text,'');
   return await operation();
  }finally{await this.call(config,'remove',[this.host.appHome]);}
 }
 perform(config, request, consent=null){
  const key=this.host.appHome;
  const job=(jobs.get(key)??Promise.resolve()).catch(()=>{}).then(async()=>{
   const p=await this.checked(config,consent);if(!p.ok)return p;
   if(!['save','copy'].includes(request.verb))throw Error('Unknown spec operation.');
   await this.unchanged(config,p.record);
   if(request.verb==='save'){
    const base=await this.transfer(config,request.baseText,()=>this.call(config,'digest',[key]));
    await this.unchanged(config,p.record);
    return this.transfer(config,request.content,()=>this.remote(p,'save',request.target,base.sha256));
   }
   const base=specCopyName(request.name);
   for(let i=0;i<20;i++){
    const target=`${p.roots[0]}/${base}${i===0?'':i===1?'-copy':`-copy-${i}`}.yaml`;
    try{return await this.transfer(config,request.content,()=>this.remote(p,'copy',target));}
    catch(error){if(error.code!=='copy_exists')throw error;}
   }
   throw Error('No free copy name was found in the box spec folders.');
  });
  jobs.set(key,job);return job.finally(()=>{if(jobs.get(key)===job)jobs.delete(key);});
 }
}
