import { CONFIG_SCHEMA, configDefinition, validateConfigValue } from "./rig-config-schema.js";
import { isLoopbackDaemonUrl } from "./rig-lib.js";

/** The table, never a daemon-provided route or arbitrary setting name, owns the URL. */
export function configRoute(key) {
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
export async function writeDaemonConfig({ origin, key, value, reset = false, entry, detected }, request = fetch) {
  // No token, CLI, file write, remote exec, retry, or fallback on any failure.
  if (!detected || !isLoopbackDaemonUrl(origin)) return { ok: false, error: "Configuration editing is not available on this connection" };
  let path;
  try { path = configRoute(key); } catch (error) { return { ok: false, error: error.message }; }
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
