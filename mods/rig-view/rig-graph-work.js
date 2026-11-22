// Live work is a queue snapshot, separate from the short handoff flash. No frame timer or per-seat reads.
const sessionKey=value=>typeof value==='string'&&value.includes('@')?value.split('@').slice(0,2).join('@'):null;
const field=(row,camel,snake)=>row?.[camel]??row?.[snake];
const parseStamp=value=>{const at=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(at)?at:null;};
const rowAt=row=>parseStamp(field(row,'claimedAt','claimed_at')??row.tsUpdated??row.ts_updated);
const shortSummary=value=>{
 const text=String(value??'Task').replace(/\s+/g,' ').trim()||'Task';if(text.length<=80)return text;
 const prefix=text.slice(0,79).replace(/[\uD800-\uDBFF]$/u,''),space=prefix.lastIndexOf(' ');
 return (space>0?prefix.slice(0,space):prefix)+'…';
};
const SNAPSHOT_GAP_MS=3000;
export const WORK_BURST_MS=4800;
const claimKey=row=>JSON.stringify([field(row,'qitemId','qitem_id')??row.id??null,parseStamp(field(row,'claimedAt','claimed_at'))]);
export function graphWorkLines(graph,rows,now){
 const seats=new Map(graph.pods.flatMap(p=>p.seats).map(s=>[sessionKey(s.session),s]).filter(([key])=>key)),pairs=new Map();
 for(const row of rows??[]){
  if(row.state!=='in-progress')continue;
  const source=seats.get(sessionKey(field(row,'sourceSession','source_session'))),target=seats.get(sessionKey(field(row,'destinationSession','destination_session')));
  if(!source||!target||source===target)continue;
  const key=JSON.stringify([source.lid,target.lid]);if(!pairs.has(key))pairs.set(key,{key,source:source.lid,target:target.lid,seat:target,rows:[]});pairs.get(key).rows.push(row);
 }
 for(const line of pairs.values()){
  line.nextChangeAt=Infinity;
  const status=line.seat.status??'unknown';line.status=status;line.pulse=false;line.dashed=status==='idle';
  if(status==='idle'){
   const changed=line.seat.node?.activityState?.changedAt;
   const stamp=parseStamp(changed),validStamp=stamp!==null&&stamp<=now;
   const seconds=validStamp?Math.max(0,Math.floor((now-stamp)/1000)):0;
   line.chip=validStamp&&seconds>=60?`idle ${Math.floor(seconds/60)} min`:'idle';
   if(validStamp)line.nextChangeAt=stamp+(Math.floor((now-stamp)/60000)+1)*60000;
  }else if(status==='active'){line.chip=line.rows.length>1?String(line.rows.length):null;}
  else if(['blocked','needs_input','attention_required'].includes(status))line.chip='needs you';
  else if(['detached','failed','stopped','exited','completed'].includes(status))line.chip='seat stopped';
  line.color=line.chip==='needs you'?'blocked':line.chip==='seat stopped'?'muted':'working';
  line.opacity=status==='active' ? .8 : line.color==='blocked' ? .9 : status==='idle' ? .6 : .35;
  const times=new Map(line.rows.map(row=>[row,rowAt(row)]));
  line.rows.sort((a,b)=>{const x=times.get(a),y=times.get(b);return x===y?0:x===null?1:y===null?-1:y-x;});
  line.tip=`${line.source} → ${line.target} · ${line.rows.length} task${line.rows.length===1?'':'s'} in progress`+line.rows.slice(0,8).map(row=>{
   const at=times.get(row),minutes=at===null?null:Math.max(0,Math.floor((now-at)/60000)),age=minutes===null?'claim time not reported':minutes===0?'just now':`${minutes} min ago`;
   if(at!==null)line.nextChangeAt=Math.min(line.nextChangeAt,at+(minutes+1)*60000);
   return `\n${shortSummary(row.summary)} · ${age}`;
  }).join('')+(line.rows.length>8?`\n+ ${line.rows.length-8} more`:'');
 }
 return [...pairs.values()];
}

/** Reuse only pure data. Native elements remain single-use values built by each draw. */
export class GraphWorkProjection{
 constructor(){this.reset();}
 reset(){this.graph=null;this.rows=null;this.at=-Infinity;this.until=-Infinity;this.value={lines:[],taskCount:0};this.states=new Map();this.started=false;}
 read(graph,rows,now,{ready=true,reducedMotion=false}={}){
  if(this.graph===graph&&this.rows===rows&&this.ready===ready&&this.reducedMotion===reducedMotion&&now>=this.at&&now<this.until)return this.value;
  const lines=graphWorkLines(graph,rows,now),nextStates=new Map();
  if(ready)for(const line of lines){
   const previous=this.states.get(line.key),claims=new Set(line.rows.map(claimKey)),activityAt=parseStamp(line.seat.node?.activityState?.changedAt);
   const activityChanged=previous&&previous.activityAt!==null&&activityAt!==null&&activityAt<=now&&activityAt>previous.activityAt;
   const changed=this.started&&(!previous||previous.status!=='active'||activityChanged||line.rows.length>previous.count||[...claims].some(key=>!previous.claims.has(key)));
   const until=line.status==='active'&&!reducedMotion?(changed?now+WORK_BURST_MS:previous?.until??0):0;
   line.pulse=until>now;line.pulseUntil=line.pulse?until:null;
   if(line.pulse)line.nextChangeAt=Math.min(line.nextChangeAt,until);
   nextStates.set(line.key,{status:line.status,activityAt,claims,count:line.rows.length,until});
  }
  if(ready){this.states=nextStates;this.started=true;}
  this.ready=ready;this.reducedMotion=reducedMotion;
  this.graph=graph;this.rows=rows;this.at=now;this.until=lines.reduce((next,line)=>Math.min(next,line.nextChangeAt),Infinity);
  this.value={lines,taskCount:lines.reduce((count,line)=>count+line.rows.length,0)};
  return this.value;
 }
 expire(deadline){for(const state of this.states.values())if(state.until<=deadline)state.until=0;this.until=-Infinity;}
}

/** Called only by a drawn graph. One request per connection, at least 3s between starts; a trailing read waits for a drawn frame.
 * Existing page redraws supply the 60s backstop; hidden tabs never launch work from a timer or completion callback. */
export class GraphWorkCache{
 constructor(){this.records=new Map();this.busy=new Set();this.started=new Map();this.closed=false;}
 touch({conn,origin,serial=0},now=Date.now()){
  const key=JSON.stringify([conn,origin]);let record=this.records.get(key);
  if(!record){record={rows:[],serial:null,at:null,received:false};this.records.set(key,record);}
  // A leave invalidates snapshot readiness, even if an old in-flight read
  // completed while hidden. The first fresh reopen answer is a baseline.
  if(record.serial===null)record.received=false;
  const last=this.started.get(conn),ready=last===undefined||now<last||now-last>=SNAPSHOT_GAP_MS;
  const request=!this.closed&&!this.busy.has(conn)&&ready&&(record.serial!==serial||record.at===null||now-record.at>=60000);
  if(request){this.busy.add(conn);this.started.set(conn,now);record.serial=serial;record.at=now;record.loading=true;}
  return {record,request,finish:(rows,error)=>{
   record.loading=false;this.busy.delete(conn);
   if(error)record.error=String(error?.message??error);
   else if(!Array.isArray(rows))record.error='OpenRig returned no queue list.';
   else{record.rows=rows;record.error=null;record.received=true;}
  }};
 }
 leave(){for(const record of this.records.values()){record.serial=null;record.received=false;}}
 close(){this.closed=true;}
}
