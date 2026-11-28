// Public graph projection and bounded native-motion state. No frame loop or periodic timer.
import {seatStatus} from "./rig-lib.js";
import {LEGACY_CONNECTION_ID,perConnection,withConnection} from "./rig-connections.js";
export const GRAPH_HOLD_MS=1600,GRAPH_FADE_MS=500,GRAPH_MAX_PATHS=8;
export function runningGraphTopology(data){
  const nodes=Array.isArray(data?.nodes)?data.nodes:[],edges=Array.isArray(data?.edges)?data.edges:[];
  return JSON.stringify([
    nodes.map(n=>JSON.stringify([n.id,n.parentId,n.type,n.data?.logicalId])).sort(),
    edges.map(e=>JSON.stringify([e.source??e.from,e.target??e.to,e.label??e.data?.kind??e.kind])).sort(),
  ]);
}
export function normalizeRunningGraph(data,fallback=[],spec=null){
  const nodes=Array.isArray(data?.nodes)?data.nodes:[],pods=[],byId=new Map(),refs=new Map();
  const live=new Map(fallback.map(n=>[n.logicalId,n]));
  const group=(id,label)=>{if(!byId.has(id)){const p={id,label:label||id,seats:[]};byId.set(id,p);pods.push(p);}return byId.get(id);};
  for(const n of nodes.filter(n=>n.type==="podGroup")){const d=n.data??n,id=String(d.logicalId??n.id);group(id,d.podLabel);refs.set(n.id,"pod:"+id);}
  const seats=nodes.filter(n=>n.type==="rigNode");
  // OpenRig's graph doesn't know a seat's tmux server stopped answering: the rig's model does (terminal_gone), and it wins on the card too.
  const gone=new Set((Array.isArray(fallback)?fallback:[]).filter(s=>s?.status==="terminal_gone").flatMap(s=>[s.session,s.logicalId]).filter(Boolean));
  for(const node of seats.length?seats:fallback){
    const raw=node.data??node,d={...live.get(raw.logicalId),...raw},lid=d.logicalId;if(typeof lid!=="string")continue;
    // Cached fallback seats have no graph IDs. Only a real pod-group parent overrides their own pod.
    const parentRef=node.parentId??d.parentId,parentGroup=parentRef==null?null:refs.get(parentRef);
    const parent=(parentGroup?.startsWith("pod:")?parentGroup.slice(4):null)??d.podNamespace??d.pod??lid.split(".")[0];
    // The public graph's status is the raw session status, not its working/needs activity.
    const sessionStatus=raw.sessionStatus??(["running","ready","stopped","detached","exited","completed"].includes(raw.status)?raw.status:null);
    const status=gone.has(d.canonicalSessionName??d.session)||gone.has(lid)?"terminal_gone"
      :sessionStatus?seatStatus({...d,sessionStatus}):raw.status??(d.sessionStatus?seatStatus(d):d.status??seatStatus(d));
    group(parent,d.podLabel).seats.push({lid,runtime:d.runtime,model:d.model,profile:d.profile,session:d.canonicalSessionName??d.session,status,node:d});if(typeof node.id==="string")refs.set(node.id,lid);refs.set(lid,lid);
  }
  const edges=(Array.isArray(data?.edges)?data.edges:[]).map(e=>({from:refs.get(e.source??e.from)??e.source??e.from,to:refs.get(e.target??e.to)??e.target??e.to,kind:e.label??e.data?.kind??e.kind??"edge"}));
  const order=new Map((Array.isArray(spec?.pods)?spec.pods:[]).map((p,i)=>[p?.id,i]));
  // A partial export can be from a different topology revision. Use one complete order.
  const complete=pods.every(p=>order.has(p.id));
  pods.sort((a,b)=>complete ? order.get(a.id)-order.get(b.id) : a.id<b.id ? -1 : a.id>b.id ? 1 : 0);
  return{pods,edges,seatCount:pods.reduce((n,p)=>n+p.seats.length,0)};
}
export function graphQueueEvent(event,now=Date.now()){
  const type=event?.type??event?.eventType,d=event?.data??event?.payload??event;
  const pair=type==="queue.created"?[d.sourceSession,d.destinationSession]:type==="queue.handed_off"?[d.fromSession,d.toSession]:type==="queue.updated"?[d.actorSession,d.closureTarget]:[];
  if(pair.length!==2||pair.some(s=>typeof s!=="string"||!s||!s.includes("@"))||pair[0]===pair[1])return null;
  return{type,from:pair[0],to:pair[1],at:event.at??event.timestamp??now};
}
/** The queue activity of one connection's stream, kept per connection (`{byConnection:{id:{origin,serial,events}}}`): a second stream
 *  must not reset the first. An older flat value reads as the legacy connection's. */
export function publishGraphActivity(shared,setShared,origin,event,conn=LEGACY_CONNECTION_ID){
  let data;try{data=typeof event.data==="string"?JSON.parse(event.data):event.data;}catch{return false;}
  const type=data?.type??event.event;if(typeof type!=='string'||!type.startsWith('queue.'))return false;
  const item=graphQueueEvent({...data,type});
  const stored=shared("rig.graphActivity"),old=perConnection(stored,conn),same=old?.origin===origin,serial=(same?old.serial??0:0)+1;
  setShared("rig.graphActivity",withConnection(stored,conn,{origin,serial,events:[...(same?old.events??[]:[]),...(item?[{...item,serial}]:[])].slice(-64)}));return true;
}
export const graphActivityOf=(shared,conn=LEGACY_CONNECTION_ID)=>perConnection(shared("rig.graphActivity"),conn);
export class GraphMotion{
  constructor(){this.epoch=0;this.sequence=0;this.paths=new Map();this.flashes=new Map();this.seen=new Set();this.generations=new Map();}
  enter(schedule,notify,count,{reducedMotion=false}={}){
    if(reducedMotion){this.epoch++;this.entering=false;this.started=true;return;}
    const epoch=++this.epoch;this.entering=true;this.started=false;
    schedule(16,()=>{if(this.epoch!==epoch)return;this.started=true;notify();});
    schedule(Math.min(count*50+100,2000)+316,()=>{if(this.epoch!==epoch)return;this.entering=false;notify();});
  }
  leave(){this.epoch++;this.paths.clear();this.flashes.clear();this.generations.clear();this.entering=false;this.started=true;}
  handoff(event,graph,pathFor,schedule,notify,{notifyStart=true,reducedMotion=false}={}){
    const identity=JSON.stringify([event.type,event.from,event.to,event.at]);if(this.seen.has(identity))return false;
    this.seen.add(identity);if(this.seen.size>256)this.seen.delete(this.seen.values().next().value);
    const seats=graph.pods.flatMap(p=>p.seats),source=seats.find(s=>s.session===event.from),target=seats.find(s=>s.session===event.to);
    if(!source&&!target)return false;
    const key=JSON.stringify([event.from,event.to]),epoch=this.epoch,version=++this.sequence,cross=!source||!target;
    const route=source&&target?pathFor(source.lid,target.lid):null;
    const path={key,version,event,source:source?.lid,target:target?.lid,cross,route,fading:false,reducedMotion};
    this.generations.set(key,version);
    if((cross||route)&&(this.paths.has(key)||this.paths.size<GRAPH_MAX_PATHS))this.paths.set(key,path);
    this.last={...event,source:source?.lid,target:target?.lid};
    if(source)this.flashes.set(source.lid,path);
    if(target)this.flashes.set(target.lid,path);
    if(notifyStart)notify();
    const valid=()=>epoch===this.epoch&&this.generations.get(key)===version;
    schedule(GRAPH_HOLD_MS,()=>{if(!valid())return;path.fading=true;notify();});
    schedule(GRAPH_HOLD_MS+GRAPH_FADE_MS,()=>{if(!valid())return;if(this.paths.get(key)?.version===version)this.paths.delete(key);
      for(const lid of [source?.lid,target?.lid])if(this.flashes.get(lid)?.version===version)this.flashes.delete(lid);this.generations.delete(key);notify();});
    return true;
  }
}
