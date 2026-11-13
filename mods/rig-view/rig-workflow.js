// Public GET /api/views/execution projection, captured from private 0.7.12/0.7.13.
// This module never runs targeted_action or reads a daemon-supplied source path.
const list=value=>Array.isArray(value)?value:[];
const objects=value=>list(value).filter(v=>v&&typeof v==='object'&&!Array.isArray(v));
const text=value=>typeof value==='string'&&value.trim()&&value!=='INDETERMINATE'?value:null;
export const WORKFLOW_CAVEAT='This is lifecycle state, not product acceptance.';
export const RECEIPT_CAVEAT='Receipt recorded means an attributed evidence reference was recorded; it does not establish acceptance.';
export const WORKFLOW_PURPOSE_MISSING="Not declared by this workflow's spec";
export function workflowWord(value){return value==='INDETERMINATE'?'unknown':text(value)??'not reported';}
export function workflowPath({mission,project,projectRoot}={}){
  const fields=[['mission',mission],['project',project],['projectRoot',projectRoot]].filter(([,v])=>typeof v==='string'&&v);
  return '/api/views/execution?'+fields.map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
}
export function workflowEntry(context,workflow,packet=null){
  return {section:'scopes',...(context.project?{project:context.project}:{}),mission:context.mission,
    workflow:workflow.id,workflowName:workflow.title,...(packet?{packet:packet.packet_id,name:workflowWord(packet.step_id)}:{name:workflow.title})};
}
export function workflowView(data,{mission=null,project=null}={}){
  const row=list(data?.rows).find(r=>r&&(!mission||r.mission===mission)&&(!project||r.project===project));
  if(!row||!Array.isArray(row.lifecycle_instances))return {supported:false,instances:[],derivedAt:null};
  const instances=row.lifecycle_instances.filter(raw=>text(raw?.instance_id)).map(raw=>{
    const packets=list(raw.frontier_packets).filter(p=>text(p?.packet_id));
    const obligations=list(raw.boundary_obligations).filter(o=>text(o?.stepId));
    const steps=list(raw.steps).filter(s=>text(s?.id)).map(step=>{
      const current=packets.filter(p=>p.step_id===step.id),obligation=obligations.find(o=>o.stepId===step.id);
      const owners=[...new Set(current.map(p=>p.owner==='INDETERMINATE'?p.owner:text(p.owner)).filter(Boolean))];
      return {...step,objective:text(step.objective),state:workflowWord(obligation?.state),current:current.length>0,
        gate:current.find(p=>p.gate&&typeof p.gate==='object'&&!Array.isArray(p.gate))?.gate??null,owners,owner:owners.length===1?owners[0]:null,
        packets:current,receipt:obligation?.receipt??null};
    });
    return {...raw,id:raw.instance_id,title:text(raw.description)??text(raw.workflow_name)??raw.instance_id,
      status:workflowWord(raw.status),finished:['completed','aborted'].includes(raw.status),steps,packets,obligations,
      sources:objects(raw.sources),dependencies:objects(raw.dependencies),failures:objects(raw.failure_occurrences),unknowns:list(raw.unknowns)};
  });
  instances.sort((a,b)=>Number(a.finished)-Number(b.finished));
  return {supported:true,instances,derivedAt:text(row.derived_at),mission:row.mission,project:row.project};
}
export function packetNextSteps(workflow,packet){
  const ids=new Set(workflow.dependencies.filter(d=>list(d.dependsOn).includes(packet.step_id)).map(d=>d.stepId));
  const hop=text(workflow.steps.find(s=>s.id===packet.step_id)?.next_hop);
  if(hop)ids.add(hop);
  return workflow.steps.filter(s=>ids.has(s.id));
}
export function workflowSourceEntry(context,source){
  if(source?.kind!=='slice'||!text(source.path))return null;
  const match=source.path.replace(/\\/g,'/').match(/\/slices\/([^/]+)\/(?:slice\.(?:yaml|yml)|SPEC\.md)$/);
  return match?{section:'scopes',...(context.project?{project:context.project}:{}),mission:context.mission,slice:match[1],name:match[1]}:null;
}
