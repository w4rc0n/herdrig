// One approval owns helper installation, verification and the final local routing choice.
// Host file operations are injected only for the two fixed app-home files, never from remote metadata.
import {RemoteMachine} from "./rig-remote.js";
import {formatAbsoluteTime} from './rig-time.js';

const parsed=text=>{
  const value=JSON.parse(text??"{}");
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("openrig/config.json must contain an object.");
  return value;
};
const consent=text=>{try{return JSON.parse(text??"null");}catch{return null;}};
const errorText=error=>String(error?.message??error);
function connectionMatches(raw,config,machine){
  if((raw.daemonUrl??config.daemonUrl)!==config.daemonUrl||raw.daemonMachine&&raw.daemonMachine!==machine)
    throw new Error("OpenRig's configuration changed. Refresh before choosing a machine.");
}
function transport(host,previous,stage){
  return {...host,readConsent:async()=>consent(previous),writeConsent:async value=>stage(value)};
}

export async function reviewMachineSetup(host,config,machine){
  try{
    const before=await host.readConfig()??null,raw=parsed(before);connectionMatches(raw,config,machine);
    const previous=await host.readConsentText()??null;
    const result=await new RemoteMachine(transport(host,previous,()=>{})).review({...config,daemonMachine:machine});
    if(!result.ok)return result;
    return {...result,before,alreadyConfigured:raw.daemonMachine===machine,config:{...config,daemonMachine:machine}};
  }catch(error){return {ok:false,reason:errorText(error)};}
}

export async function approveMachineSetup(host,review,onProgress=()=>{}){
  let stage="checks";
  try{
    if(!review?.ok||!review.confirmation?.key)throw new Error("Check the machine before approving setup.");
    const {config,confirmation}=review;
    if((await host.readConfig()??null)!==review.before)throw new Error("OpenRig's configuration changed. Check again before approving.");
    connectionMatches(parsed(review.before),config,confirmation.machine);
    const previous=await host.readConsentText()??null;let staged=null;
    const remote=new RemoteMachine(transport(host,previous,value=>{staged=value;}));
    // prepare reruns the full identity and shipped-file checks, validates the approval key, and hashes again.
    const prepared=await remote.prepare(config,{consent:confirmation,onProgress});
    if(!prepared.ok)return prepared;
    if(staged&&staged.key!==confirmation.key)throw new Error("The approved machine changed. Check again.");
    stage="verified";onProgress("save");
    const prior=consent(previous),receipt={key:confirmation.key,...confirmation,
      verifiedAt:prior?.key===confirmation.key&&prior.verifiedAt?prior.verifiedAt:new Date().toISOString()};
    const text=JSON.stringify(receipt)+"\n";
    // A later config-save failure retains this verified consent; it does not enable routing.
    await host.writeConsentText(text,previous);
    stage="consent";
    const raw=parsed(review.before);
    await host.writeConfig(JSON.stringify({...raw,daemonMachine:confirmation.machine},null,2)+"\n",review.before);
    return {ok:true,receipt,installed:confirmation.fileState!=="same"};
  }catch(error){
    return {ok:false,reason:stage==="consent"
      ?`The helper was verified, but saving the machine choice failed. Check openrig/config.json before retrying: ${errorText(error)}`
      :errorText(error),helperVerified:stage!=="checks"};
  }
}

export async function stopUsingMachine(host,config,machine){
  try{
    const before=await host.readConfig()??null,raw=parsed(before);
    if(raw.daemonMachine!==machine||(raw.daemonUrl??config.daemonUrl)!==config.daemonUrl)
      throw new Error("OpenRig's configuration changed. Refresh before stopping this machine.");
    const previous=await host.readConsentText()??null;
    await host.writeConsentText("null\n",previous);
    const next={...raw};delete next.daemonMachine;
    await host.writeConfig(JSON.stringify(next,null,2)+"\n",before);
    return {ok:true,previous:consent(previous)};
  }catch(error){return {ok:false,reason:`Could not finish stopping this machine. Check openrig/config.json before retrying: ${errorText(error)}`};}
}

export function machineSetupReceiptLabel(receipt,timezone=null){
  const date=new Date(receipt?.verifiedAt);
  const since=Number.isNaN(date.getTime())?"unknown":formatAbsoluteTime(date,{timezone,date:true});
  return `Using ${receipt.machine} · Attach helper verified (SHA-256 ${String(receipt.sha256??"").slice(0,6)}…) · since ${since}`;
}
