import { boundedDismissalRequest } from "./rig-dismiss.js";
// Connected assistants are queue-checking roster members, never terminal/activity seats.
// Keep the projection independent of terminal status, pulse counts, and transport commands.
const words={'checking-in':'checking in','check-in-overdue':'overdue','no-check-in-yet':'no check-in yet','on-request':'on request',disconnected:'disconnected',unknown:'unknown'};
const plain=(value,max=240)=>typeof value==='string'?value.slice(0,max).replace(/[\x00-\x1f\x7f]/g,' '):'';
// The existing session charset/200-character cap, further restricted to exactly member@rig.
export const assistantAddress=seat=>typeof seat==='string'&&seat.length<=200&&/^[A-Za-z0-9._][A-Za-z0-9._-]*@[A-Za-z0-9._][A-Za-z0-9._-]*$/.test(seat);
export const assistantWord=status=>Object.hasOwn(words,status)?words[status]:'unknown';
/** Public check-in prose from the API's status fields (the same words `rig ps` presents), not activity inference. */
export function assistantSentence(member,time=value=>value){
 const last=member.lastCheckInAt?`last check-in ${time(member.lastCheckInAt)}`:null;
 const cadence=member.expectedMinutes?`expected every ${member.expectedMinutes} min`:member.onRequest?'checks in when a person asks it':'no check-in cadence declared';
 const details={
  'checking-in':()=>`Checking in: ${last??'last check-in not reported'}, ${cadence}`,
  'check-in-overdue':()=>`Overdue: ${last??'last check-in not reported'}, ${cadence}; its schedule may be off or waiting for an approval`,
  'no-check-in-yet':()=>`No check-in yet; ${cadence}`,
  'on-request':()=>`On request: it checks its queue when a person asks it${last?`; ${last}`:''}`,
  disconnected:()=> 'Disconnected: its connection was revoked or removed',
  unknown:()=>`Unknown (${member.reason||"its check-in status couldn't be read"})${last?`; ${last}`:''}`,
 };
 const sentence=(Object.hasOwn(details,member.status)?details[member.status]:details.unknown)();return /[.!?]$/.test(sentence)?sentence:sentence+'.';
}
const unavailable=reason=>({state:'unavailable',members:[],reason,line:`Connected assistants: check-in unavailable (${reason})`});
async function readHostedMembersUnbounded(fetch,config,expectedHostId){
 try{
  const result=await fetch(`${config.daemonUrl}/api/queue/hosted-members`);
  if(result.status===404)return{state:'off',members:[]};
  if(result.status!==200)return unavailable(`the read failed: HTTP ${result.status}`);
  const body=await result.json();
  if(!body||!Array.isArray(body.members))return unavailable('the answer was not a roster');
  const validHost=id=>typeof id==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(id);
  if(!validHost(expectedHostId)||!validHost(body.hostId))return unavailable("this OpenRig's identity could not be checked");
  if(body.hostId!==expectedHostId)return unavailable('this answer came from a different OpenRig');
  const seen=new Set(),members=[];
  for(const raw of body.members.slice(0,200)){
   if(!assistantAddress(raw?.seat)){
    members.push({invalid:true,conn:config.connectionId,label:'Connected assistant unavailable (invalid address)'});continue;
   }
   if(seen.has(raw.seat))continue;seen.add(raw.seat);
   const [name,rig]=raw.seat.split('@');
   members.push({kind:'assistant',conn:config.connectionId,hostId:body.hostId,origin:config.daemonUrl,seat:raw.seat,session:raw.seat,name,rig,status:Object.hasOwn(words,raw.status)?raw.status:'unknown',
    lastCheckInAt:typeof raw.lastCheckInAt==='string'&&raw.lastCheckInAt.length<=64&&Number.isFinite(Date.parse(raw.lastCheckInAt))?raw.lastCheckInAt:null,
    expectedMinutes:Number.isFinite(raw.expectedMinutes)&&raw.expectedMinutes>0&&raw.expectedMinutes<=525600?raw.expectedMinutes:null,
    onRequest:raw.onRequest===true,rung:raw.rung===true,reporter:plain(raw.reporter,80),reason:plain(raw.reason)});
  }
  return{state:'ready',conn:config.connectionId,hostId:body.hostId,members,truncated:body.members.length>200};
 }catch{return unavailable('the read failed');}
}
/** A legacy connection has no recorded host yet: only its own fresh health response can supply it. */
async function loadHostedMembersUnbounded(fetch,config){
 let response;
 try{response=await fetch(`${config.daemonUrl}/api/queue/hosted-members`);}catch{return{...unavailable('the read failed'),conn:config.connectionId,origin:config.daemonUrl};}
 let expected=config?.connections?.find(c=>c.id===config.connectionId)?.expectedHostId;
 if(response.status===200&&!expected){
  try{const r=await fetch(`${config.daemonUrl}/healthz`);expected=r.ok?(await r.json())?.selfHostId:null;}catch{expected=null;}
 }
 return {...await readHostedMembersUnbounded(async()=>response,config,expected),conn:config.connectionId,origin:config.daemonUrl};
}
/** One deadline covers the fetch, both JSON bodies, and the legacy health identity read.
 * Runtime callers supply cx.timer; no browser timer or unbounded fallback exists in QuickJS.
 */
export const ASSISTANT_READ_TIMEOUT_MS=15000;
async function boundedRosterRead(request,config,after){
 const stamp={conn:config.connectionId,origin:config.daemonUrl};
 if(typeof after!=='function')return{...unavailable('the read could not be scheduled'),...stamp};
 let expired=false;
 try{return await boundedDismissalRequest(request,(ms,done)=>after(ms,()=>{expired=true;done();}),ASSISTANT_READ_TIMEOUT_MS)();}
 catch{return{...unavailable(expired?'the read did not answer':'the read failed'),...stamp};}
}
export function loadHostedMembers(fetch,config,after){return boundedRosterRead(()=>loadHostedMembersUnbounded(fetch,config),config,after);}
export function readHostedMembers(fetch,config,expectedHostId,after){return boundedRosterRead(()=>readHostedMembersUnbounded(fetch,config,expectedHostId),config,after);}
export const assistantsForRig=(roster,rig,conn)=>roster?.state==='ready'?roster.members.filter(m=>!m.invalid&&m.rig===rig&&m.conn===conn):[];
export function assistantTarget(member,rig){
 if(member?.invalid||!assistantAddress(member?.seat)||typeof member.conn!=='string'||!member.conn)return null;
 return{kind:'assistant',conn:member.conn,hostId:member.hostId,origin:member.origin,session:member.seat,logicalId:member.name,rig:member.rig,rigId:rig?.id,name:member.name};
}
export function assistantForNeed(need,roster){
 if(roster?.state!=='ready'||typeof need?.conn!=='string')return null;
 const seat=need.asker??need.sourceSession;
 return roster.members.find(m=>!m.invalid&&m.conn===need.conn&&m.seat===seat)??null;
}
export const assistantOwner=member=>`${member.name} · ${member.rig} (connected assistant)`;
export const ASSISTANT_ACTION_REFUSED='Connected assistants check their own queue; terminal and model actions do not apply.';
export function assistantActionRefusal(target,action){
 if(target?.kind!=='assistant')return null;
 if(!assistantAddress(target.session))return 'This connected assistant has an invalid address. Nothing was sent.';
 return action==='queue'?null:ASSISTANT_ACTION_REFUSED;
}
export async function verifyAssistantTarget(fetch,config,target,after){
 const reason='This connected assistant could not be verified on its OpenRig. Nothing was sent.';
 if(!assistantAddress(target?.session)||target.conn!==config?.connectionId||!target.hostId||target.origin!==config.daemonUrl)return{ok:false,reason};
 const roster=await loadHostedMembers(fetch,config,after);
 return roster.state==='ready'&&roster.hostId===target.hostId&&roster.members.some(m=>!m.invalid&&m.seat===target.session&&m.conn===target.conn)?{ok:true}:{ok:false,reason:roster.reason==='the read did not answer'?'This connected assistant could not be verified: the read did not answer. Nothing was sent.':reason};
}
/** Only unsupported detection is cached. A successful event-stream reconnect invalidates it for that connection. */
export class HostedMembersReader {
 constructor(){this.off=new Map();}
 key(config){return JSON.stringify([config.connectionId,config.daemonUrl]);}
 reconnect(config){this.off.delete(this.key(config));}
 async read(fetch,config,after){
  const key=this.key(config);if(this.off.has(key))return this.off.get(key);
  const result=await loadHostedMembers(fetch,config,after);if(result.state==='off')this.off.set(key,result);return result;
 }
}
