// A connection is one OpenRig daemon this mod talks to: { id, machine, daemonUrl, token, expectedHostId, openrigHome }.
// Its identity is (machine, hostId); the URL is only the transport. v0.5.0 PR 1 threads this object through with a list of ONE built
// from the legacy `daemonUrl` / `daemonMachine` keys, so nothing is rewritten and nothing changes for a single-daemon setup.
// Pure functions: nothing here reads a file, sends a request or touches Herdr.

/** The id of the connection built from the legacy keys. A generated `conn-<ULID>` would need a write; when connections are written
 *  later the first one keeps this id so the state stored under it continues. */
export const LEGACY_CONNECTION_ID = "conn-legacy";
const ID = /^conn-[A-Za-z0-9]{1,40}$/;
const HOST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export const NO_CONNECTION = "This needs to know which OpenRig it is for, and it didn't say. Nothing was sent.";
export const UNKNOWN_CONNECTION = "That OpenRig connection isn't set up any more. Nothing was sent.";
export const HOME_NEEDED = "With more than one OpenRig, each needs its own OpenRig home. Nothing was sent.";
export const EXPLICIT_ADDRESS_NEEDED = "With more than one OpenRig, each needs its own address. Nothing was sent.";

const text = (value) => (typeof value === "string" && value !== "" ? value : null);
const url = (value) => (typeof value === "string" && /^https?:\/\/[^\s]+$/.test(value) ? value.replace(/\/+$/, "") : null);

/** One connection from a raw record; null when it can't be one. `token` is reserved and always null: the mod sends no token today
 *  (reads are plain GETs, writes go through the rig CLI, which does its own authentication from its OpenRig home). */
export function normalizeConnection(raw, fallbackId = null) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = raw.id === undefined ? fallbackId : raw.id;
  if (typeof id !== "string" || !ID.test(id)) return null;
  const machine = raw.machine === undefined || raw.machine === "" || raw.machine === null ? null : raw.machine;
  if (machine !== null && (typeof machine !== "string" || !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(machine))) return null;
  const hostId = typeof raw.expectedHostId === "string" && HOST_ID.test(raw.expectedHostId) ? raw.expectedHostId : null;
  return { id, machine, daemonUrl: url(raw.daemonUrl), token: null, expectedHostId: hostId, openrigHome: text(raw.openrigHome) };
}

/** The connections a raw config.json describes: its `connections` array when it has a valid one, else the legacy keys as a list of
 *  one. Duplicate or invalid entries are dropped (never repaired). Returns { connections, legacy }. */
export function connectionsOf(raw) {
  if (raw && typeof raw === "object" && Array.isArray(raw.connections)) {
    const seen = new Set(), list = [];
    for (const entry of raw.connections) {
      const conn = normalizeConnection(entry);
      if (conn && !seen.has(conn.id)) { seen.add(conn.id); list.push(conn); }
    }
    if (list.length) return { connections: list, legacy: false };
  }
  const machine = raw && typeof raw === "object" ? raw.daemonMachine : undefined;
  const conn = normalizeConnection({ id: LEGACY_CONNECTION_ID, machine, daemonUrl: raw?.daemonUrl, openrigHome: raw?.openrigHome }, LEGACY_CONNECTION_ID)
    ?? { id: LEGACY_CONNECTION_ID, machine: null, daemonUrl: url(raw?.daemonUrl), token: null, expectedHostId: null, openrigHome: text(raw?.openrigHome) };
  return { connections: [conn], legacy: true };
}

/** The config one connection's code sees: the shared settings (person, rig argv, ...) with this connection's address, machine and
 *  OpenRig home, and its id. With a list of one this is exactly the legacy config plus `connectionId`. */
export function connectionConfig(base, conn) {
  const out = { ...(base ?? {}), connectionId: conn.id };
  // Address, machine and home are this connection's own: nothing of another connection's may remain, or a command would run
  // against the wrong daemon or authenticate from the wrong home. What the CLI found for another connection is not this one's.
  for (const key of ["daemonUrl", "daemonMachine", "openrigHome", "daemonUrlSource", "daemonState", "daemonMessage"]) delete out[key];
  if (conn.daemonUrl) out.daemonUrl = conn.daemonUrl;
  if (conn.machine) out.daemonMachine = conn.machine;
  if (conn.openrigHome) out.openrigHome = conn.openrigHome;
  return out;
}

/** Whether a config names its daemon in writing (as `cliEnv` decides): a URL the CLI found or a default is not. */
const hasWrittenAddress = (config) => Boolean(config?.daemonUrl && config?.daemonUrlSource !== "cli" && config?.daemonUrlSource !== "default");

/** The connection a target belongs to, from the target's own `conn` (stamped where the row came from), never a default.
 *  Returns { ok: true, conn, config } or { ok: false, reason }. `config` is the sidebar's config (it lists the connections). */
export function targetConnection(config, target) {
  const id = target?.conn;
  if (typeof id !== "string" || id === "") return { ok: false, reason: NO_CONNECTION };
  const conn = (config?.connections ?? []).find((c) => c.id === id);
  if (!conn) return { ok: false, reason: UNKNOWN_CONNECTION };
  const view = config.connectionId === id ? config : connectionConfig(config, conn);
  // With one OpenRig an address the CLI found is today's behaviour. With several, each command must name its own daemon: a command
  // that lets the CLI pick would act on whichever daemon it finds, which may be another machine's.
  if ((config.connections ?? []).length > 1 && !hasWrittenAddress(view)) return { ok: false, reason: EXPLICIT_ADDRESS_NEEDED };
  // Another connection's command runs with its own OpenRig home or none at all: the CLI authenticates from the home, and without one
  // it would send the inherited (another daemon's) credential. The legacy connection keeps today's behaviour.
  if (id !== LEGACY_CONNECTION_ID && !view.openrigHome) return { ok: false, reason: HOME_NEEDED };
  return { ok: true, conn, config: view };
}

/** A value kept per connection in a Herdr shared key: `{ [connectionId]: value }`. Until a key is first written in that shape the old
 *  flat value is read as the legacy connection's (read-through: nothing stored by an older version is lost). */
export function perConnection(stored, id) {
  if (stored === undefined || stored === null) return undefined;
  if (isMapShape(stored)) return stored.byConnection[id];
  return id === LEGACY_CONNECTION_ID ? stored : undefined; // an old flat value belongs to the legacy connection
}
/** The map shape written by `withConnection`. A marker field, so a flat legacy value is never mistaken for a map. */
export const isMapShape = (value) => Boolean(value) && typeof value === "object" && value.byConnection !== null && typeof value.byConnection === "object" && !Array.isArray(value.byConnection);
export function withConnection(stored, id, value) {
  const current = isMapShape(stored) ? stored.byConnection : stored === undefined || stored === null ? {} : { [LEGACY_CONNECTION_ID]: stored };
  return { byConnection: { ...current, [id]: value } };
}

/** Daemon JSON stamped with the connection it came from, where it enters the mod: each object of a list, and of an `items` list
 *  (Needs). The connection is always the fetching one: daemon data is untrusted and never chooses it (a row claiming another
 *  connection is overwritten). Anything else passes through untouched. */
export function stampConnection(json, id) {
  if (typeof id !== "string" || !id) return json;
  const one = (row) => (row && typeof row === "object" && !Array.isArray(row) ? { ...row, conn: id } : row);
  if (Array.isArray(json)) return json.map(one);
  if (json && typeof json === "object" && Array.isArray(json.items)) return { ...json, items: json.items.map(one) };
  return json;
}

const parseJson = (text) => { try { return JSON.parse(text ?? "null"); } catch { return null; } };

/** One connection's machine-consent record from the consent file's text. An older flat record is the legacy connection's. */
export function consentOf(text, id) {
  const value = parseJson(text);
  const record = perConnection(value, id);
  return record && typeof record === "object" && !Array.isArray(record) ? record : null;
}

/** The consent file's text after writing one connection's record (null stops using it). While the file is flat or absent and the
 *  connection is the legacy one, it stays exactly the shape older versions read; the map appears when a second connection is written. */
export function consentText(previousText, id, record) {
  const previous = parseJson(previousText);
  if (!isMapShape(previous) && id === LEGACY_CONNECTION_ID) return `${JSON.stringify(record ?? null)}\n`;
  return `${JSON.stringify(withConnection(previous, id, record ?? null))}\n`;
}

/** A persisted entry from before connections (a nav or selection entry stored by v0.4.x) names no connection. With exactly one
 *  connection configured it can only be that one, so it reads as that one; with several it stays unnamed and is refused when acted on. */
export const adoptConnection = (config, id) => (typeof id === "string" && id !== "" ? id : (config?.connections ?? []).length === 1 ? config.connections[0].id : undefined);

/** Stored state that PR 1 keeps flat (v0.4.x shapes, read as the legacy connection's) until PR 2 makes it per connection together with the
 *  grouping. Only the legacy connection may write it: a second connection writing here would overwrite the first's values. */
export const FLAT_STATE_KEYS = Object.freeze(["rig.data", "rig.order", "rig.open.sidebar", "rig.open.page"]);
export const FLAT_STORE_LEGACY_ONLY = "Only the first OpenRig keeps its state here for now; this one can't write it yet. Nothing was changed.";
export function assertFlatStoreWriter(key, connectionId) {
  if (FLAT_STATE_KEYS.includes(key) && connectionId !== undefined && connectionId !== null && connectionId !== LEGACY_CONNECTION_ID) throw new Error(FLAT_STORE_LEGACY_ONLY);
}
/** `setShared` that refuses a flat-state key for any connection but the legacy one. `connectionOf()` is the writer's connection id. */
export const guardFlatStore = (setShared, connectionOf) => (key, value) => { assertFlatStoreWriter(key, connectionOf()); return setShared(key, value); };
