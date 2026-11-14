import { CONFIG_SCHEMA, configDefinition, validateConfigValue } from "./rig-config-schema.js";
import { isLoopbackDaemonUrl } from "./rig-lib.js";

export const CONFIG_SAVE_TIMEOUT = 'The save did not answer; nothing was confirmed. Refresh before trying again.';
/** One deadline for fetch, JSON and every request in a save/Undo. Late responses never escape. */
export function configOperationRequest(request, after) {
  let expired=false,closed=false;
  const waiting=new Set();
  const error=()=>Object.assign(new Error(CONFIG_SAVE_TIMEOUT),{code:'CONFIG_DEADLINE'});
  after(15000,()=>{if(closed)return;expired=true;for(const reject of waiting)reject(error());waiting.clear();});
  const bounded=(...args)=>new Promise((resolve,reject)=>{
    if(expired||closed){reject(error());return;}
    waiting.add(reject);
    Promise.resolve().then(()=>{if(expired||closed)throw error();return request(...args);})
      .then(async response=>({ok:response.ok,status:response.status,data:await response.json()}))
      .then(({ok,status,data})=>{if(!expired&&!closed){waiting.delete(reject);resolve({ok,status,json:async()=>data});}},cause=>{waiting.delete(reject);reject(cause);});
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
