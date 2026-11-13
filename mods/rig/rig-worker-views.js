// Host-side worker views consume public composition data, never daemon programs.
import {isValidSessionName,tmuxServerArgsFrom,base64EncodeUtf8,hostOf} from "./rig-lib.js";
import {goodHome} from "./rig-remote.js";

const text=(value,max=160)=>String(value??"").replace(/[\u0000-\u001f\u007f-\u009f]/g," ").trim().slice(0,max);
const invalid=()=>{throw new Error("This OpenRig doesn't offer a supported view preview.");};
export function workerMissingReason(reason){
  if(/^tmux session .+ is not alive$/.test(reason??""))return "no live tmux session";
  if(["seat-not-running","stopped"].includes(reason))return "stopped";
  return text(reason)||"not available";
}
export function workerViewDetails(entry){
  const members=entry?.members??[],runtimes=[...new Set(members.map(m=>m.runtime).filter(Boolean))];
  const readOnly=members.filter(m=>m.readOnly).map(m=>m.label);
  return [runtimes.length?`Runtime: ${runtimes.join(", ")}`:null,readOnly.length?`read-only: ${readOnly.join(", ")}`:null].filter(Boolean).join(" · ");
}

/** Narrow projection: deliberately never inspect preview commands, roots or socket paths. */
function verifiedRemote(remote){
  if(!remote?.ok||!remote.machine||!remote.selfHostId||!goodHome(remote.node)||!goodHome(remote.relayPath))
    throw new Error("The remote worker-view destination has not been verified.");
}
export function workerPad(remote){
  verifiedRemote(remote);
  return {blank:true,session:"",label:"empty",title:"empty",argv:[remote.node,remote.relayPath,base64EncodeUtf8(JSON.stringify({mode:"pad"}))]};
}
export function hostWorkerPlan(preview,nodes,remote,view=null){
  verifiedRemote(remote);
  const descriptor=preview?.viewDescriptor,pages=preview?.composed?.pages,grids=preview?.grids;
  if(!preview||typeof preview.planId!=="string"||!preview.planId||preview.planId.length>256
    ||!["fixed","following"].includes(descriptor?.kind)||typeof descriptor.name!=="string"
    ||!Array.isArray(pages)||!Array.isArray(grids)||pages.length!==grids.length||pages.length>32
    ||pages.some(page=>!Array.isArray(page)||page.length>64)||pages.reduce((n,page)=>n+page.length,0)>256)invalid();
  const rawName=text(descriptor.name,80)||"Worker view";
  const name=typeof view==="string"&&view.startsWith("rig:")?`Workers · ${text(view.slice(4),80)}`:rawName,inventory=new Map();
  for(const node of Array.isArray(nodes)?nodes:[]){
    const session=node?.canonicalSessionName;
    if(typeof session==="string")inventory.set(session,inventory.has(session)?null:node);
  }
  const planned=pages.map((page,index)=>{
    const grid=grids[index],columns=grid?.columns,rows=grid?.rows,blanks=grid?.blanks;
    if(!Number.isSafeInteger(columns)||!Number.isSafeInteger(rows)||!Number.isSafeInteger(blanks)
      ||columns<1||rows<1||blanks<0||columns*rows>64||columns*rows!==page.length+blanks)invalid();
    const tiles=page.map(pane=>{
      if(!pane||typeof pane.seat!=="string"||typeof pane.label!=="string"||pane.runtime!==undefined&&typeof pane.runtime!=="string"
        ||typeof pane.readOnly!=="boolean")invalid();
      const session=pane.seat,label=text(pane.label)||text(session),node=inventory.get(session);
      const runtime=text(pane.runtime??node?.runtime??"unreported",40);
      const title=`${label} · ${runtime}${pane.readOnly?" · read-only":""}`;
      const serverArgs=node?.tmuxAttachCommand?tmuxServerArgsFrom(node.tmuxAttachCommand,session):null;
      let reason=null;
      if(!isValidSessionName(session)||!node)reason="no valid session";
      else if(node.sessionStatus!=="running"||node.intentionallyStopped)reason="seat is not running";
      else if(hostOf(node)&&hostOf(node)!=="local"&&hostOf(node)!==remote.selfHostId)reason="seat runs on another machine";
      else if(node.placement==="herdr"||node.attachmentType==="external_cli"||serverArgs===null)reason="no verified tmux session";
      const argv=reason?["sleep","2147483647"]:[remote.node,remote.relayPath,base64EncodeUtf8(JSON.stringify({
        mode:"grid",session,serverArgs,readOnly:pane.readOnly,title,
      }))];
      return {session,label,runtime,readOnly:pane.readOnly,title,argv,...(reason?{placeholder:true,reason}:{})};
    });
    for(let i=0;i<blanks;i++)tiles.push(workerPad(remote));
    return {name:pages.length>1?`${name} · ${index+1}/${pages.length}`:name,columns,rows,tiles};
  });
  const missing=[...(Array.isArray(preview.composed.absent)?preview.composed.absent:[]),
    ...(Array.isArray(preview.composed.degraded)?preview.composed.degraded:[])].map(item=>({
      label:text(item?.label??item?.seat)||"Seat",reason:text(item?.reason)||"not available",
    }));
  for(const tile of planned.flatMap(page=>page.tiles).filter(tile=>tile.placeholder))missing.push({label:tile.label,reason:tile.reason});
  return {planId:preview.planId,kind:descriptor.kind,name,pages:planned,missing};
}
