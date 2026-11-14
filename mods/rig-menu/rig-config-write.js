import { CONFIG_SCHEMA, configDefinition, validateConfigValue } from "./rig-config-schema.js";
import { isLoopbackDaemonUrl } from "./rig-lib.js";

export const CONFIG_SAVE_TIMEOUT = 'The save did not answer; nothing was confirmed. Refresh before trying again.';
// Raw requests outlive an editor's 15 s UI deadline. A replacement panel must see the same lock.
// Herdr reloads each view's modules under a new generation, inside the window's same JS runtime.
// Keep the registry on that runtime too, so a newly loaded module cannot bypass the raw request.
const registryKey=Symbol.for('herdrig.configWrites.v1');
const configWrites=globalThis[registryKey]??(globalThis[registryKey]=new Map());
const writeRecord=identity=>{let r=configWrites.get(identity);if(!r){r={pending:new Set(),owners:new Map(),uncertain:false,failed:false,idle:new Set(),waiters:new Set()};configWrites.set(identity,r);}return r;};
export function closeConfigWrites(owner){for(const[identity,r]of configWrites){
  if(r.pending.size&&r.owners?.has(owner)){r.ownerClosed=true;r.uncertain=true;r.daemonLabel=r.owners.get(owner);}
  else if(r.reconcileOwner===owner&&r.reconciling)finishConfigReconcile(identity,r,r.reconciling,null,new Error('The Settings page closed during verification'));
}}
export function configWriteState(identity){
  const r=configWrites.get(identity);if(!r)return null;
  const reason=r.ownerClosed?`A save on ${r.daemonLabel||'this OpenRig'} was still unanswered when its Settings tab closed. Saving stays paused until Herdr restarts. You can still use rig config in a terminal on OpenRig’s machine.`
    :r.pending.size?'A save is waiting for OpenRig to answer. Saving is paused; reopening this page will not clear the pending request.'
    :r.failed&&!r.reconciling?'OpenRig’s current value could not be confirmed on this page. Reopen this page before saving again.'
    :'The last save was not confirmed. Saving resumes once OpenRig confirms the current value.';
  return {blocked:r.uncertain||r.pending.size>0,pending:r.pending.size,uncertain:r.uncertain,ownerClosed:r.ownerClosed===true,failed:r.failed&&!r.reconciling,reason};
}
export function waitForConfigWrites(identity){const r=configWrites.get(identity);return !r||!r.pending.size?Promise.resolve(r):new Promise(resolve=>r.idle.add(resolve));}
export function beginConfigReconcile(identity,r,owner){if(!r||configWrites.get(identity)!==r||!r.uncertain||r.ownerClosed||r.pending.size||r.reconciling)return null;r.failed=false;r.result=null;r.reconcileOwner=owner;return r.reconciling={};}
export function finishConfigReconcile(identity,r,token,data,error){
  if(!r||r.reconciling!==token)return;
  r.reconciling=null;r.reconcileOwner=null;r.failed=!!error;r.result=error?{ok:false}:{ok:true,data};
  if(!error&&configWrites.get(identity)===r&&!r.pending.size)configWrites.delete(identity);
  for(const resolve of r.waiters)resolve(r.result);r.waiters.clear();
}
export function failConfigReconcile(identity,r){if(configWrites.get(identity)===r&&!r.reconciling){r.failed=true;r.result={ok:false};}}
export function configReconcileResult(r){return r?.result?Promise.resolve(r.result):r?.reconciling?new Promise(resolve=>r.waiters.add(resolve)):Promise.resolve({ok:false});}
/** One deadline for fetch, JSON and every request in a save/Undo. Late responses never escape. */
export function configOperationRequest(request, after, identity=null, owner=null, daemonLabel='this OpenRig') {
  let expired=false,closed=false,didWrite=false;
  const waiting=new Set();
  const error=()=>Object.assign(new Error(CONFIG_SAVE_TIMEOUT),{code:'CONFIG_DEADLINE'});
  after(15000,()=>{if(closed)return;expired=true;if(didWrite&&identity)writeRecord(identity).uncertain=true;for(const reject of waiting)reject(error());waiting.clear();});
  const bounded=(...args)=>new Promise((resolve,reject)=>{
    if(expired||closed){reject(error());return;}
    waiting.add(reject);
    let record;
    const raw=Promise.resolve().then(async()=>{
      if(expired||closed)throw error();
      if(identity&&['POST','DELETE'].includes(args[1]?.method)){
        const state=configWriteState(identity);if(state?.blocked)throw new Error(state.reason);
        record=writeRecord(identity);record.pending.add(raw);if(owner)record.owners.set(owner,daemonLabel);didWrite=true;
      }
      const response=await request(...args);return {ok:response.ok,status:response.status,data:await response.json()};
    });
    const settled=()=>{if(record){record.pending.delete(raw);if(!record.pending.size){for(const resolve of record.idle)resolve(record);record.idle.clear();if(!record.uncertain&&configWrites.get(identity)===record)configWrites.delete(identity);}}};
    raw.then(({ok,status,data})=>{settled();if(!expired&&!closed){waiting.delete(reject);resolve({ok,status,json:async()=>data});}},cause=>{if(record)record.uncertain=true;settled();waiting.delete(reject);reject(cause);});
  });
  bounded.expired=()=>expired;
  bounded.finish=()=>{closed=true;waiting.clear();};
  return bounded;
}

/** The reviewed table or validated metadata key owns the fixed URL; metadata never supplies a route. */
export function configRoute(key, entry) {
  if(entry&&configDefinition(entry).metadata){
    if(entry.key!==key||configDefinition(entry).readOnly)throw new Error("This setting is not editable here");
    return `/api/config/${encodeURIComponent(key)}`;
  }
  if (!Object.hasOwn(CONFIG_SCHEMA, key) || CONFIG_SCHEMA[key].readOnly) throw new Error("This setting is not editable here");
  return `/api/config/${encodeURIComponent(key)}`;
}
export async function detectConfigEditing(origin, request = fetch) {
  if (!isLoopbackDaemonUrl(origin)) return { ok: false, error: "Use the configured loopback OpenRig connection" };
  try {
    const response = await request(`${origin.replace(/\/$/, "")}${configRoute("daemon.port")}`);
    const data = await response.json();
    return response.ok && Object.hasOwn(data ?? {}, "value") && ["file", "env", "default"].includes(data?.source)
      ? { ok: true } : { ok: false, error: configWriteError(response.status, data) };
  } catch (error) { return { ok: false, error: `Could not detect configuration editing: ${error.message}` }; }
}
export function configWriteError(status, data) {
  if (typeof data?.error === "string") return data.error;
  if ([404, 405].includes(status)) return "This OpenRig doesn't support editing settings from Herdr. Use rig config set on that machine.";
  if ([401, 403].includes(status)) return "This OpenRig requires authorisation to change settings.";
  return `OpenRig refused the configuration request (${status ?? "no response"}).`;
}
/** Fresh per-key read used only to verify an in-memory Undo receipt. */
export async function readDaemonConfig({origin,key,entry,detected},request=fetch){
  if(!detected||!isLoopbackDaemonUrl(origin))return {ok:false,error:'Configuration editing is not available on this connection'};
  try{
    if(entry?.key!==key||configDefinition(entry).readOnly)return {ok:false,error:'This setting is not editable here'};
    const response=await request(`${origin.replace(/\/$/,'')}${configRoute(key,entry)}`),data=await response.json();
    if(!response.ok||!Object.hasOwn(data??{},'value')||!['file','default','env'].includes(data.source))return {ok:false,error:configWriteError(response.status,data)};
    return {ok:true,resolved:{value:data.value,source:data.source}};
  }catch(error){return {ok:false,error:`Could not verify Undo: ${error.message}`};}
}
export async function writeDaemonConfig({ origin, key, value, reset = false, entry, detected }, request = fetch) {
  // No token, CLI, file write, remote exec, retry, or fallback on any failure.
  if (!detected || !isLoopbackDaemonUrl(origin)) return { ok: false, error: "Configuration editing is not available on this connection" };
  let path;
  try { path = configRoute(key,entry); } catch (error) { return { ok: false, error: error.message }; }
  const def = configDefinition(entry);
  const error = entry?.key !== key ? "Setting identity changed; refresh configuration" : def.readOnly || (!reset && validateConfigValue(def, value));
  if (error) return { ok: false, error };
  try {
    const response = await request(`${origin.replace(/\/$/, "")}${path}`, {
      method: reset ? "DELETE" : "POST", ...(reset ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) }),
    });
    const data = await response.json();
    if (!response.ok || data?.ok !== true || !Object.hasOwn(data?.resolved??{},"value") || !["file","env","default"].includes(data?.resolved?.source))
      return { ok: false, status:response.status, error: configWriteError(response.status, data) };
    return { ok: true, resolved: data.resolved, savedValue: value };
  } catch (error) { return { ok: false, error: `Configuration save was not confirmed: ${error.message}. Refresh before trying again.` }; }
}
