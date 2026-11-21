import { errorDiagnostic } from "./rig-words.js";
// One approval owns helper installation, verification and the final local routing choice.
// Host file operations are injected only for the two fixed app-home files, never from remote metadata.
import {RemoteMachine} from "./rig-remote.js";
import {formatAbsoluteTime} from './rig-time.js';
import {LEGACY_CONNECTION_ID,consentOf,consentText} from './rig-connections.js';
import {parseConfig} from './rig-lib.js';

const parsed=text=>{
  const value=JSON.parse(text??"{}");
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("openrig/config.json must contain an object.");
  return value;
};
const connectionOf=config=>config?.connectionId??LEGACY_CONNECTION_ID;
const sameDaemonAddress=(a,b)=>{
  const left=parseConfig(JSON.stringify({daemonUrl:a})).daemonUrl,right=parseConfig(JSON.stringify({daemonUrl:b})).daemonUrl;
  return left===right&&(left!==null||a===b); // malformed text must not become an absent address
};
// With a connections list the machine lives in the connection's own record, which these flows don't edit yet (the setup screen for connections
// does, in v0.5.0): they refuse instead of saving a root key that nothing reads and reporting success.
export const MACHINE_SETUP_LIST="This OpenRig is set up with a connections list in its configuration. Choosing its machine here comes with the next version, so nothing was changed.";
const hasList=raw=>raw?.connections!==undefined&&raw?.connections!==null; // the loader's own rule: any value but absent or null is a list it refuses
const errorText=error=>errorDiagnostic(error);
// With a list, the machine lives in the connection's own record. That record is the choice: when it already names this machine and this address
// the approval is consent-only (the helper and its consent), and nothing in the config is written. Any other list is refused as before.
const listedMachine=(raw,config,machine)=>{
  const record=(Array.isArray(raw?.connections)?raw.connections:[]).find(c=>c&&typeof c==="object"&&c.id===config?.connectionId);
  return Boolean(record&&machine&&record.machine===machine&&sameDaemonAddress(record.daemonUrl,config.daemonUrl));
};
function connectionMatches(raw,config,machine){
  if(hasList(raw)){
    if(listedMachine(raw,config,machine))return "listed";
    throw new Error(MACHINE_SETUP_LIST);
  }
  if(!sameDaemonAddress(raw.daemonUrl??config.daemonUrl,config.daemonUrl)||raw.daemonMachine&&raw.daemonMachine!==machine)
    throw new Error("OpenRig's configuration changed. Refresh before choosing a machine.");
  return "root";
}
function transport(host,previous,stage,id){
  return {...host,readConsent:async()=>consentOf(previous,id),writeConsent:async value=>stage(value)};
}

export async function reviewMachineSetup(host,config,machine,initialConfirmation=null){
  try{
    const before=await host.readConfig()??null,raw=parsed(before),where=connectionMatches(raw,config,machine);
    const previous=await host.readConsentText()??null;
    if(initialConfirmation?.key&&initialConfirmation.machine===machine){
      const stored=consentOf(previous,connectionOf(config));
      return {ok:true,confirmation:initialConfirmation,approved:stored?.key===initialConfirmation.key,
        before,alreadyConfigured:where==="listed"||raw.daemonMachine===machine,config:{...config,daemonMachine:machine}};
    }
    const result=await new RemoteMachine(transport(host,previous,()=>{},connectionOf(config))).review({...config,daemonMachine:machine});
    if(!result.ok)return result;
    return {...result,before,alreadyConfigured:where==="listed"||raw.daemonMachine===machine,config:{...config,daemonMachine:machine}};
  }catch(error){return {ok:false,reason:errorText(error)};}
}

export async function approveMachineSetup(host,review,onProgress=()=>{}){
  let stage="checks";
  try{
    if(!review?.ok||!review.confirmation?.key)throw new Error("Check the machine before approving setup.");
    const {config,confirmation}=review;
    if((await host.readConfig()??null)!==review.before)throw new Error("OpenRig's configuration changed. Check again before approving.");
    const where=connectionMatches(parsed(review.before),config,confirmation.machine);
    const previous=await host.readConsentText()??null;let staged=null;
    const remote=new RemoteMachine(transport(host,previous,value=>{staged=value;},connectionOf(config)));
    // prepare reruns the full identity and shipped-file checks, validates the approval key, and hashes again.
    const prepared=await remote.prepare(config,{consent:confirmation,onProgress});
    if(!prepared.ok)return prepared;
    if(staged&&staged.key!==confirmation.key)throw new Error("The approved machine changed. Check again.");
    stage="verified";onProgress("save");
    const prior=consentOf(previous,connectionOf(config)),receipt={key:confirmation.key,...confirmation,
      verifiedAt:prior?.key===confirmation.key&&prior.verifiedAt?prior.verifiedAt:new Date().toISOString()};
    const text=consentText(previous,connectionOf(config),receipt);
    // A later config-save failure retains this verified consent; it does not enable routing.
    await host.writeConsentText(text,previous);
    stage="consent";
    if(where==="listed")return {ok:true,receipt,installed:confirmation.fileState!=="same"};
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
  let stage='checks';
  try{
    const before=await host.readConfig()??null,raw=parsed(before);
    if(hasList(raw))return {ok:false,reason:MACHINE_SETUP_LIST};
    if(raw.daemonMachine!==machine||!sameDaemonAddress(raw.daemonUrl??config.daemonUrl,config.daemonUrl))
      throw new Error("OpenRig's configuration changed. Refresh before stopping this machine.");
    const previous=await host.readConsentText()??null;
    stage='consent';
    await host.writeConsentText(consentText(previous,connectionOf(config),null),previous);
    const next={...raw};delete next.daemonMachine;
    stage='config';
    await host.writeConfig(JSON.stringify(next,null,2)+"\n",before);
    return {ok:true,previous:consentOf(previous,connectionOf(config))};
  }catch(error){return {ok:false,reason:stage==='consent'
    ?`Clearing this machine's approval was not confirmed. Check openrig/machine-consent.json before retrying; the routing choice was not written: ${errorText(error)}`
    :stage==='config'?`The machine approval was cleared, but saving the routing choice was not confirmed. Check openrig/config.json before retrying: ${errorText(error)}`
    :`${errorText(error)} Nothing was changed.`};}
}

export function machineSetupReceiptLabel(receipt,timezone=null){
  const date=new Date(receipt?.verifiedAt);
  const since=Number.isNaN(date.getTime())?"unknown":formatAbsoluteTime(date,{timezone,date:true});
  return `Using ${receipt.machine} · Attach helper verified (SHA-256 ${String(receipt.sha256??"").slice(0,6)}…) · since ${since}`;
}
