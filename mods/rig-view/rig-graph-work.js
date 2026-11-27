// Live work is a queue snapshot, separate from the short handoff flash. No frame timer or per-seat reads: a working line's breath is Herdr's
// native loop.
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
/** A worker reported idle for this long stops its line breathing (the short gaps between an agent's turns don't flicker it). */
export const WORK_IDLE_DEBOUNCE_MS=15000;
/** The breath of a line whose work is being done: slow, narrow, one shared phase for every working line. */
export const WORK_PULSE={from:.55,to:.9,period:2000,easing:'ease-in-out'};
export function graphWorkForSeat(rows,seat){
 const target=sessionKey(seat.session);
 return target?rows.filter(row=>row.state==="in-progress"&&sessionKey(field(row,"destinationSession","destination_session"))===target)
   .sort((a,b)=>(rowAt(b)??-Infinity)-(rowAt(a)??-Infinity)):[];
}
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
  if(status==='idle')line.chip='idle';else if(status==='active'){line.chip=line.rows.length>1?String(line.rows.length):null;}
  else if(['blocked','needs_input','attention_required'].includes(status))line.chip='needs you';
  else if(status==='terminal_gone')line.chip='seat unreachable';
  else if(['detached','failed','stopped','exited','completed'].includes(status))line.chip='seat stopped';
  // The sidebar's marks: working green (ansi2), waiting on someone amber (ansi3), stopped muted. Herdr's own `working` is ANSI yellow.
  line.color=line.chip==='needs you'?'ansi3':line.chip==='seat stopped'||status==='terminal_gone'?'muted':'ansi2';
  line.chipColor=line.chip==='needs you'?'blocked':null; // the "needs you" chip keeps its own needs colour
  line.opacity=status==='active' ? .8 : line.color==='ansi3' ? .9 : status==='idle' ? .6 : .35;
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
 reset(){this.graph=null;this.rows=null;this.at=-Infinity;this.until=-Infinity;this.value={lines:[],taskCount:0};this.states=new Map();}
 read(graph,rows,now,{ready=true,reducedMotion=false}={}){
  if(this.graph===graph&&this.rows===rows&&this.ready===ready&&this.reducedMotion===reducedMotion&&now>=this.at&&now<this.until)return this.value;
  const lines=graphWorkLines(graph,rows,now),nextStates=new Map();
  // A line breathes for as long as its work is being done: the row is in progress and the worker is working. A worker reported idle keeps it
  // breathing for WORK_IDLE_DEBOUNCE_MS (from its idle stamp, else from the idle this graph saw it turn), then it goes dashed and dim with one
  // redraw at pulseUntil (with reduced motion too: the line still changes look). Waiting on someone or stopped changes at once. The breath is Herdr's native loop: nothing here wakes while it runs.
  for(const line of lines){
   const previous=this.states.get(line.key);let idleSince=null;line.pulseUntil=null;
   if(line.status==='idle'){
    const stamp=parseStamp(line.seat.node?.activityState?.changedAt);
    // OpenRig 0.7.11-0.7.20 send no changedAt: the debounce then starts only at an idle this graph saw happen (working before), never for a seat
    // already idle when the graph opened or reopened, which would breathe a false 15 s on every Graph visit.
    idleSince=stamp!==null&&stamp<=now?stamp:previous?.status==='active'?now:previous?.idleSince??-Infinity;
    if(Number.isFinite(idleSince)){
     const minutes=Math.floor((now-idleSince)/60000);
     if(minutes>=1)line.chip=`idle ${minutes} min`;
     line.nextChangeAt=Math.min(line.nextChangeAt,idleSince+(minutes+1)*60000);
    }
    if(now-idleSince<WORK_IDLE_DEBOUNCE_MS){
     line.dashed=false;line.color='ansi2';line.opacity=.8;line.chip=line.rows.length>1?String(line.rows.length):null;
     line.pulseUntil=idleSince+WORK_IDLE_DEBOUNCE_MS;line.nextChangeAt=Math.min(line.nextChangeAt,line.pulseUntil);
     line.pulse=!reducedMotion;
    }
   }else if(line.status==='active')line.pulse=!reducedMotion;
   nextStates.set(line.key,{status:line.status,idleSince});
  }
  this.states=nextStates;
  this.ready=ready;this.reducedMotion=reducedMotion;
  this.graph=graph;this.rows=rows;this.at=now;this.until=lines.reduce((next,line)=>Math.min(next,line.nextChangeAt),Infinity);
  this.value={lines,taskCount:lines.reduce((count,line)=>count+line.rows.length,0)};
  return this.value;
 }
 /** The end of an idle debounce: the next read recomputes, so the line stops breathing. */
 expire(){this.until=-Infinity;}
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
