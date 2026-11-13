// Projection only: no fetch, terminal tail, or alternative status vocabulary.
import {computePulseCounts,matchesPulseFilter,needTarget,isUpdateNeed,orderSiblings} from './rig-lib.js';
export const allSeatsLayout=width=>({runtime:width>=680,compact:width<460,attach:width>=760,minText:120});
const ranks={needs_input:0,attention_required:1,blocked:1,failed:1,active:2,done:3,completed:3,idle:4,terminal:4,stopped:5,exited:5,detached:5,unknown:6};
export function allSeatsModel(models=[],attention=[],{order='rig',pulse=null,filter='',orderMap={}}={}){
 const asks=attention.filter(n=>n&&!isUpdateNeed(n)&&!['done','closed','canceled'].includes(n.state)).map(needTarget);
 const hosts=orderSiblings([...new Set(models.map(m=>m.host||'local'))],'topology:hosts',orderMap,h=>h);
 const ordered=hosts.flatMap(host=>orderSiblings(models.filter(m=>(m.host||'local')===host),`topology:rigs:${host}`,orderMap,m=>m.rig.id));
 const groups=ordered.map((model,rigIndex)=>{
  const rig=model.rig, state=model.nodesState?.error?'failed':model.nodesState?.data===undefined?'loading':'ready';
  // The Rig table uses this projection order; only rig order follows the sidebar overrides.
  const seats=(model.pods??[]).flatMap(p=>p.seats);
  const rows=(state==='ready'?seats:[]).filter(s=>matchesPulseFilter(s,model,pulse,attention)&&(!filter||[s.logicalId,rig.name,s.runtime,s.model,s.word].some(v=>String(v??'').toLowerCase().includes(filter.toLowerCase())))).map(seat=>{
   const ids=[...new Set(asks.filter(n=>n.session===seat.session||(n.rig===rig.name&&(n.logicalId??n.seat)===seat.logicalId)).map(n=>n.id))];
   const status=matchesPulseFilter(seat,model,'needs',attention)?'needs_input':seat.status;
   const raw=model.nodesState?.data?.find(n=>n.canonicalSessionName===seat.session)??{};
   return {rig,seat,status,needIds:ids,rigIndex,key:`all-seat:${rig.id}:${seat.session??seat.logicalId}`,
    since:raw.activityState?.since??raw.agentActivity?.eventAt??raw.lastActivityAt??null,
    attachable:!!seat.session&&raw.attachable!==false&&raw.sessionAlive!==false&&!['stopped','exited','detached'].includes(seat.status)&&!['stopped','recoverable'].includes(raw.lifecycleState)};
  });
  return {rig,rows,state,counts:computePulseCounts([model],attention),total:model.seats.length,error:model.nodesState?.error};
 });
 let rows=groups.flatMap(g=>g.rows);
 if(order==='status')rows=[...rows].sort((a,b)=>(ranks[a.status]??6)-(ranks[b.status]??6)||a.rigIndex-b.rigIndex||String(a.seat.logicalId).localeCompare(String(b.seat.logicalId)));
 return {groups,rows,rigWidth:Math.min(160,Math.max(120,...models.map(m=>String(m.rig.name??'').length*7+12)))};
}
