// A connection is one OpenRig daemon this mod talks to: { id, machine, daemonUrl, token, expectedHostId, openrigHome }.
// Its identity is (machine, hostId); the URL is only the transport. A config without a connections list is a list of ONE built
// from the legacy `daemonUrl` / `daemonMachine` keys, so nothing is rewritten and nothing changes for a single-daemon setup.
// Pure functions: nothing here reads a file, sends a request or touches Herdr.

/** The id of the connection built from the legacy keys. A generated `conn-<ULID>` would need a write; when connections are written
 *  later the first one keeps this id so the state stored under it continues. */
/** The connections file cannot be parsed: said once, with what to do and that nothing was changed. */
export const CONFIG_NOT_JSON = "openrig/config.json can't be read: it isn't valid JSON. Fix the file, or move it aside to start over, then try again. Nothing was changed.";
export const LEGACY_CONNECTION_ID = "conn-legacy";
const ID = /^conn-[A-Za-z0-9]{1,40}$/;
const HOST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const connectionRowsMemo = new WeakMap();

/** Readers keep one projection per publication. Older publications already carry their own rows. */
export function connectionRows(published, conn) {
  if (!published || typeof published !== "object") return undefined;
  const entries = published.byConnection;
  if (!entries || typeof entries !== "object") return published;
  if (!Object.hasOwn(entries, conn)) return undefined;
  const entry = entries[conn];
  if (entry?.answering === false) return entry;
  if (typeof entry?.attentionAnswered !== "boolean") return Object.keys(entries).length === 1 ? published : entry;

  let projections = connectionRowsMemo.get(published);
  if (!projections) connectionRowsMemo.set(published, projections = new Map());
  if (!projections.has(conn)) {
    const own = rows => Array.isArray(rows) ? rows.filter(row => row?.conn === conn) : [];
    projections.set(conn, {
      ...entry,
      topology: own(published.topology),
      attentionItems: entry.attentionAnswered ? own(published.attentionItems) : null,
    });
  }
  return projections.get(conn);
}

/** A bracketed IPv6 host (its text between the brackets) as `URL` writes it, or null: hex groups of one to four digits, at most one `::`, no IPv4 tail, no zone;
 *  the longest run of two or more zero groups (the first, on a tie) is compressed and leading zeros dropped. */
function canonicalIPv6(inner) {
  if (!/^[0-9a-f:]+$/.test(inner)) return null;
  const halves = inner.split("::");
  if (halves.length > 2) return null;
  const side = (t) => (t === "" ? [] : t.split(":")), head = side(halves[0]), tail = halves.length === 2 ? side(halves[1]) : [], given = [...head, ...tail];
  if (!given.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  let groups;
  if (halves.length === 2) { if (given.length > 7) return null; groups = [...head, ...Array(8 - given.length).fill("0"), ...tail]; }
  else { if (given.length !== 8) return null; groups = head; }
  groups = groups.map((g) => Number.parseInt(g, 16).toString(16));
  let at = -1, run = 0;
  for (let i = 0; i < 8;) { if (groups[i] !== "0") { i++; continue; } let j = i; while (j < 8 && groups[j] === "0") j++; if (j - i > run) { at = i; run = j - i; } i = j; }
  return run < 2 ? groups.join(":") : `${groups.slice(0, at).join(":")}::${groups.slice(at + run).join(":")}`;
}
/** A host the way `URL` would keep it: a dotted quad of four plain decimal parts, a canonical bracketed IPv6, or a name of letters, digits, `_`, `~` and `-` in
 *  non-empty labels with no trailing dot and a last label that isn't a number (`URL` reads `127.1`, `0x7f.0.0.1` and `2130706433` as IPv4 and rewrites them). */
function canonicalHost(raw) {
  const host = raw.toLowerCase();
  if (host.startsWith("[")) { const v6 = host.endsWith("]") ? canonicalIPv6(host.slice(1, -1)) : null; return v6 === null ? null : `[${v6}]`; }
  if (/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(host)) return host.split(".").every((part) => Number(part) <= 255) ? host : null;
  if (!/^[a-z0-9_~-]+(?:\.[a-z0-9_~-]+)*$/.test(host)) return null;
  return /^(?:[0-9]+|0x[0-9a-f]*)$/.test(host.slice(host.lastIndexOf(".") + 1)) ? null : host;
}

/** An http(s) address as { protocol, hostname, port, host, origin }, read in plain JS: Herdr's mod runtime need not provide a browser's `URL`, and a
 *  `new URL` inside a catch turned that into a refusal or a silent null. It agrees with `URL` exactly where it answers (`port` is "" for the scheme's
 *  default, as `URL.port` is; `hostname` keeps an IPv6 address's brackets and is written the canonical way) and answers null where it can't be sure: no
 *  host, a user name, a backslash, a port outside 1-65535, another scheme, or a host `URL` would rewrite or reject (see canonicalHost). The gate refuses on
 *  null, so this is never looser than `URL`. */
export function addressParts(value) {
  const m = /^(https?):\/\/(\[[^\]\s/?#\\@]*\]|[^\s/:?#\\@\[\]]+)(?::([0-9]{1,5}))?(?:[/?#][^\s\\]*)?$/i.exec(typeof value === "string" ? value.trim() : "");
  if (!m) return null;
  const protocol = `${m[1].toLowerCase()}:`, hostname = canonicalHost(m[2]);
  if (hostname === null) return null;
  const number = m[3] === undefined ? null : Number(m[3]);
  if (number !== null && (number < 1 || number > 65535)) return null;
  const port = number === null || String(number) === (protocol === "https:" ? "443" : "80") ? "" : String(number);
  const host = port ? `${hostname}:${port}` : hostname;
  return { protocol, hostname, port, host, origin: `${protocol}//${host}` };
}

/** The sentence for an address herdrig can't check (see `addressParts`): it names the address and the forms to write. Stored and compared exactly as typed, so a form
 *  `URL` would rewrite (127.1, 0127.0.0.1 is 87.0.0.1) is asked for again, never mapped to another host. */
export const UNREADABLE_FORM = "Write it as http://127.0.0.1:<port>, a host name, or http://[::1]:<port>.";
export const unreadableAddress = (address) => `${String(address).slice(0, 80).replace(/[\x00-\x1f\x7f]+/g, " ")} isn't written in a form herdrig can check.`;
/** True for a written address (an http(s) text) that `addressParts` reads as nothing. */
const unreadable = (value) => typeof value === "string" && /^https?:\/\/[^\s]+$/.test(value) && addressParts(value.replace(/\/+$/, "")) === null;

export const NO_CONNECTION = "This needs to know which OpenRig it is for, and it didn't say. Nothing was sent.";
export const UNKNOWN_CONNECTION = "That OpenRig connection isn't set up any more. Nothing was sent.";
export const HOME_NEEDED = "This OpenRig needs its own OpenRig home in its connection settings, and none is set. Nothing was sent.";
/** A `connections` list that has no usable entry (empty, not a list, or every entry invalid) is an INVALID config: no connection opens and nothing is sent. It is never read as the
 *  legacy keys (a typo must not send to the legacy daemon). Said as one plain line. */
export const CONFIG_LIST_INVALID = "The connections list in config.json has no usable entry, so nothing was sent. Fix the list or remove it.";
/** A listed entry that is not used, named so the person can fix it. `n` is its 1-based place in the list. */
export const connectionNote = (n, why) => `Connection ${n} isn't used: ${why}.`;
export const EXPLICIT_ADDRESS_NEEDED = "With more than one OpenRig, each needs its own address. Nothing was sent.";

const text = (value) => (typeof value === "string" && value !== "" ? value : null);
const LOOPBACK_ADDRESS = /^https?:\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i;
const url = (value) => (typeof value === "string" && /^https?:\/\/[^\s]+$/.test(value) ? value.replace(/\/+$/, "") : null);
/** An OpenRig over Herdr's connection: exactly herdr://<machine>/<hostId>, no path. */
const herdrAddress = (value) => (typeof value === "string" && /^herdr:\/\/[a-z0-9][a-z0-9._-]{0,31}\/[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null);

/** One connection from a raw record; null when it can't be one. `token` is reserved and always null: the mod sends no token today
 *  (reads are plain GETs, writes go through the rig CLI, which does its own authentication from its OpenRig home). */
export function normalizeConnection(raw, fallbackId = null) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = raw.id === undefined ? fallbackId : raw.id;
  if (typeof id !== "string" || !ID.test(id)) return null;
  const machine = raw.machine === undefined || raw.machine === "" || raw.machine === null ? null : raw.machine;
  if (machine !== null && (typeof machine !== "string" || !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(machine))) return null;
  const hostId = typeof raw.expectedHostId === "string" && HOST_ID.test(raw.expectedHostId) ? raw.expectedHostId : null;
  // Over Herdr's connection the address names the machine and the OpenRig's host id: both must agree with the record, or it isn't a connection.
  const herdr = herdrAddress(raw.daemonUrl);
  if (herdr) {
    const [, onMachine, onHost] = /^herdr:\/\/([^/]+)\/(.+)$/.exec(herdr);
    if (machine !== onMachine || (hostId !== null && hostId !== onHost)) return null;
    // A connection switched from a tunnel keeps its old address (unused), so switching back is one click and its old labels stay its own (§3.1.3).
    const kept = url(raw.retainedDaemonUrl);
    return { id, machine, daemonUrl: herdr, token: null, expectedHostId: onHost, openrigHome: text(raw.openrigHome), transport: "herdr", ...(kept ? { retainedDaemonUrl: kept } : {}) };
  }
  // Switched back to its tunnel, it keeps the herdr:// address it left, only while that names this machine and its recorded host id.
  const left = herdrAddress(raw.retainedDaemonUrl), leftParts = left ? /^herdr:\/\/([^/]+)\/(.+)$/.exec(left) : null;
  const keptHerdr = leftParts && machine === leftParts[1] && hostId === leftParts[2] && url(raw.daemonUrl) ? left : null;
  return { id, machine, daemonUrl: url(raw.daemonUrl), token: null, expectedHostId: hostId, openrigHome: text(raw.openrigHome), ...(keptHerdr ? { retainedDaemonUrl: keptHerdr } : {}) };
}

/** The connections a raw config.json describes: its `connections` array when it has a usable one, else (only when there is NO `connections` key) the legacy keys as a list of
 *  one. An entry that is invalid, or whose id repeats an earlier one, is not used and is NAMED (`notes`), never silently repaired. A list with no usable entry is `invalid`: no
 *  connection (a typo never falls back to the legacy daemon). Returns { connections, legacy, notes, invalid }. */
export function connectionsOf(raw) {
  const present = raw && typeof raw === "object" && raw.connections !== undefined && raw.connections !== null;
  if (present) {
    const notes = [], seen = new Set(), list = [];
    if (!Array.isArray(raw.connections)) return { connections: [], legacy: false, notes, invalid: CONFIG_LIST_INVALID };
    raw.connections.forEach((entry, index) => {
      const n = index + 1;
      if (unreadable(entry?.daemonUrl)) { notes.push(connectionNote(n, `its address ${unreadableAddress(entry.daemonUrl)} ${UNREADABLE_FORM}`.replace(/\.$/, ""))); return; }
      const conn = normalizeConnection(entry);
      if (!conn || (!conn.daemonUrl && !conn.machine && !conn.openrigHome)) notes.push(connectionNote(n, "it needs an id (letters, digits, dots or dashes), and an address, machine, or OpenRig home"));
      else if (seen.has(conn.id)) notes.push(connectionNote(n, `the id ${conn.id} is already used by an earlier entry`));
      else { seen.add(conn.id); list.push(conn); }
    });
    return list.length ? { connections: list, legacy: false, notes, invalid: null } : { connections: [], legacy: false, notes, invalid: CONFIG_LIST_INVALID };
  }
  if (unreadable(raw?.daemonUrl)) return { connections: [], legacy: true, notes: [], invalid: `daemonUrl in config.json: ${unreadableAddress(raw.daemonUrl)} ${UNREADABLE_FORM} Nothing was sent.` };
  const machine = raw && typeof raw === "object" ? raw.daemonMachine : undefined;
  const conn = normalizeConnection({ id: LEGACY_CONNECTION_ID, machine, daemonUrl: raw?.daemonUrl, openrigHome: raw?.openrigHome }, LEGACY_CONNECTION_ID)
    ?? { id: LEGACY_CONNECTION_ID, machine: null, daemonUrl: url(raw?.daemonUrl), token: null, expectedHostId: null, openrigHome: text(raw?.openrigHome) };
  return { connections: [conn], legacy: true, notes: [], invalid: null };
}

/** The config one connection's code sees: the shared settings (person, rig argv, ...) with this connection's address, machine and
 *  OpenRig home, and its id. With a list of one this is exactly the legacy config plus `connectionId`. */
export function connectionConfig(base, conn) {
  const out = { ...(base ?? {}), connectionId: conn.id };
  // Address, machine and home are this connection's own: nothing of another connection's may remain, or a command would run
  // against the wrong daemon or authenticate from the wrong home. What the CLI found for another connection is not this one's.
  for (const key of ["daemonUrl", "daemonMachine", "openrigHome", "expectedHostId", "daemonUrlSource", "daemonState", "daemonMessage", "retainedDaemonUrl", "transport"]) delete out[key];
  if (conn.daemonUrl) out.daemonUrl = conn.daemonUrl;
  if (conn.machine) out.daemonMachine = conn.machine;
  if (conn.openrigHome) out.openrigHome = conn.openrigHome;
  if (conn.expectedHostId) out.expectedHostId = conn.expectedHostId; // the host id this connection recorded: a write checks its address still answers as it
  if (conn.retainedDaemonUrl) out.retainedDaemonUrl = conn.retainedDaemonUrl; // the address a switched connection left (its tunnel, or herdr:// after switching back)
  return out;
}

/** What a person calls a connection's box: its Herdr machine, else "this computer". Two connections that share a label (two OpenRigs on one machine) are told apart by their id. An id that is not listed
 *  (a removed connection) is never "this computer": it is named by its id as no longer set up. */
export function connectionBoxLabel(config, id) {
  const list = Array.isArray(config?.connections) ? config.connections : [];
  const name = (c) => c?.machine || "this computer";
  const one = list.find((c) => c.id === id);
  if (!one) return `${id ?? "an OpenRig"} (no longer set up)`;
  return list.filter((c) => name(c) === name(one)).length > 1 ? `${name(one)} (${one.id})` : name(one);
}

/** Legible host id for System > Overview/Connections, Usage, Sidebar host groups, and Add-a-machine: short ids (including OpenRig's
 *  13-character `host-xxxxxxxx` ids) show in full; longer ids keep their prefix and unique tail instead of slicing `host-…` to `"host…"`. */
export function formatHostId(id) {
  if (id === null || id === undefined || id === "") return "—";
  const text = String(id);
  return text.length > 16 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text;
}

/** The config of ONE listed connection, as a config that lists several describes it: the config itself when it is that connection's, `connectionConfig` of the listed entry for another, null when the
 *  id is not listed (a closed connection: nothing may be resolved for it, by name or otherwise). */
export function configOfConnection(config, id) {
  if (!config) return null;
  const own = config.connectionId ?? LEGACY_CONNECTION_ID;
  if (id === undefined || id === null || id === own) return config;
  const listed = (config.connections ?? []).find((c) => c.id === id);
  return listed ? connectionConfig(config, listed) : null;
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
  // Over Herdr's connection the helper runs on the machine with that machine's own OpenRig home: no local home is needed (or used).
  if (id !== LEGACY_CONNECTION_ID && !view.openrigHome && view.transport !== "herdr" && !String(view.daemonUrl ?? "").startsWith("herdr://")) return { ok: false, reason: HOME_NEEDED };
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


/** A `rig.<command>` for a target of `config`'s connection. herdr delivers a mod command as its NAME only (its args are dropped), so with several connections the
 *  connection goes in the name, `rig.<command>:<conn>|<target>`; the sidebar reads it back only for one of its own connections. One connection: `rig.<command>:<target>`. */
export const commandFor = (command, config, target) => `${command}:${(config?.connections?.length ?? 0) > 1 && config?.connectionId ? `${config.connectionId}|` : ""}${target}`;
/** The forwarded operator Attach for `config`'s connection: `rig.operator:<conn>` with several connections (the sidebar opens that OpenRig's operator), `rig.operator` with one. */
export const operatorCommandFor = (config) => ((config?.connections?.length ?? 0) > 1 && config?.connectionId ? `rig.operator:${config.connectionId}` : "rig.operator");
/** The TUI and Needs commands for `config`'s connection: `rig.tui:<conn>` / `rig.needs:<conn>` with several connections (the sidebar answers for that OpenRig, never for the box it happens to draw), the bare name with one. */
export const tuiCommandFor = (config) => ((config?.connections?.length ?? 0) > 1 && config?.connectionId ? `rig.tui:${config.connectionId}` : "rig.tui");
/** A request id that is on more than one OpenRig, asked for without a connection the sidebar can use. */
export const AMBIGUOUS_REQUEST = "That request is on more than one OpenRig. Open it from its row in the sidebar. Nothing was opened.";
/** A row or group key made specific to one connection, so two OpenRigs never share a fold, order or selection key. The legacy connection's
 *  keys are the old ones (stored state stays found). */
export const qualifyKey = (conn, key) => (conn && conn !== LEGACY_CONNECTION_ID ? `${conn}|${key}` : key);

/** The key of one rig's space status (the card on its row) and of its "opening" mark: the rig id alone with ONE OpenRig, exactly as it always was, and qualified by the
 *  connection with several, because two OpenRigs can hold a rig with the same id and one box's card must never be drawn on the other box's row. */
export const spaceStatusKey = (conn, rigId, many) => (many ? qualifyKey(conn, rigId) : rigId);

/** Said when a name the person typed (or a bare name a row carried) is on more than one OpenRig: it is refused, never picked. */
export const AMBIGUOUS_NAME = "That name is on more than one OpenRig. Pick it in the sidebar, which names the machine. Nothing was sent.";
const connsOf = (list) => new Set(list.map((r) => r?.conn ?? "")).size;
/** A row is on a connection unless it names another (a row without one comes from a single-OpenRig setup, where there is only one). */
const onConn = (row, conn) => !conn || !row?.conn || row.conn === conn;

/** The rig a reference means in the merged list of every connection's rigs: { rig } (undefined when there is none) or { ambiguous: true }.
 *  An id is exact (with its connection when given) and, with several OpenRigs, never falls back to a name; a name that is on more than one
 *  OpenRig is ambiguous (the same `demo` and `kernel` exist on every one). With one OpenRig this is the plain id-or-name lookup. */
export function pickRig(rigs, { rigId, conn, name } = {}) {
  const list = Array.isArray(rigs) ? rigs : [];
  if (rigId) {
    const hit = list.find((r) => r.id === rigId && onConn(r, conn));
    if (hit || connsOf(list) > 1) return { rig: hit };
  }
  if (!name) return { rig: undefined };
  const hits = list.filter((r) => r.name === name && onConn(r, conn));
  return connsOf(hits) > 1 ? { ambiguous: true } : { rig: hits[0] };
}

/** Matches a seat reference typed or chosen in the palette: canonical session (`dev-one@demo`), rig-qualified id (`dev.one@demo`,
 *  `demo/dev.one`, `demo/dev/dev.one`, `host/demo/dev/dev.one`), or bare logical/member id (`dev.one`, `one`). */
export function seatMatchesRef(seat, rig, pod, rawRef) {
  const ref = String(rawRef ?? "").trim();
  if (!ref || !seat) return false;
  if (seat.session === ref) return true;
  const at = ref.lastIndexOf("@");
  if (at > 0 && at < ref.length - 1) {
    const left = ref.slice(0, at), right = ref.slice(at + 1);
    return rig?.name === right && (seat.logicalId === left || seat.member === left);
  }
  if (ref.includes("/")) {
    const parts = ref.split("/");
    if (parts.length === 2) {
      const [wantRig, wantSeat] = parts;
      return (rig?.name === wantRig || rig?.id === wantRig) && (seat.logicalId === wantSeat || seat.member === wantSeat);
    }
    if (parts.length === 3) {
      const [wantRig, wantPod, wantSeat] = parts;
      return (rig?.name === wantRig || rig?.id === wantRig) && pod?.name === wantPod && (seat.logicalId === wantSeat || seat.member === wantSeat);
    }
    if (parts.length === 4) {
      const [wantHost, wantRig, wantPod, wantSeat] = parts;
      return (!rig?.host || rig.host === wantHost) && (rig?.name === wantRig || rig?.id === wantRig) && pod?.name === wantPod && (seat.logicalId === wantSeat || seat.member === wantSeat);
    }
    return false;
  }
  return seat.logicalId === ref || seat.member === ref;
}

/** Plain refusal when a seat name matches on more than one OpenRig or more than one rig/seat inside one connection. */
export function ambiguousSeatMessage(seatArg, picked, { prefix = "", write = false } = {}) {
  if (picked?.ambiguous === true) return AMBIGUOUS_NAME;
  const example = picked?.seats?.[0] ? `${prefix}${picked.seats[0]}` : `${prefix}<seat>@<rig>`;
  const tail = write ? " Nothing was sent." : "";
  if ((picked?.rigs?.length ?? 0) > 1) {
    return `More than one rig has a seat matching ${seatArg} (${picked.rigs.join(", ")}). Name the rig too, such as ${example}.${tail}`;
  }
  return `More than one seat matches ${seatArg} (${(picked?.seats ?? []).join(", ")}). Name the full seat, such as ${example}.${tail}`;
}

/** The seat a predicate means across the merged list: { rig, seat }, {} when none, { ambiguous: true } when it matches on more than one
 *  OpenRig (`dev-one@demo` exists on each), or { ambiguous: "rig", rigs, seats } when it matches more than one seat inside one connection. */
export function pickSeat(rigs, match, { conn, rigId, allowFirst = false } = {}) {
  const hits = [];
  for (const rig of Array.isArray(rigs) ? rigs : []) {
    if (!onConn(rig, conn)) continue;
    if (rigId && rig.id !== rigId) continue;
    for (const pod of rig.pods ?? []) for (const seat of pod.seats ?? []) if (match(seat, rig, pod)) hits.push({ rig, seat });
  }
  if (connsOf(hits.map((h) => h.rig)) > 1) return { ambiguous: true };
  if (!allowFirst && hits.length > 1) {
    return {
      ambiguous: "rig",
      rigs: [...new Set(hits.map((h) => h.rig?.name).filter(Boolean))],
      seats: hits.map((h) => `${h.seat?.logicalId ?? h.seat?.member ?? h.seat?.session}@${h.rig?.name}`),
    };
  }
  return hits[0] ?? {};
}

const MACHINE_NAME = /^[a-z0-9][a-z0-9._-]{0,31}$/;
/** The refusal for a connection's OpenRig home (a clean absolute folder path on THIS computer), or null when it is fine. */
export const openrigHomeProblem = (value) => (typeof value === "string" && /^\/[^\x00-\x1f\x7f]*[^/\x00-\x1f\x7f]$/.test(value) && !value.split("/").some((part) => part === "." || part === "..")
  ? null : "This connection needs its OpenRig home: an absolute folder path, such as /srv/openrig-home.");

const cleanHomeFolder = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.length > 1 ? value.replace(/\/+$/, "") : value;
  return openrigHomeProblem(trimmed) ? null : trimmed;
};
const pathOrChild = (p, root) => Boolean(root) && (p === root || p.startsWith(`${root}/`));
const hasTwoSegments = (p) => Boolean(p) && p.split("/").filter(Boolean).length >= 2;
const matchesMachineFolder = (p, folder) => Boolean(folder) && (p === folder || (hasTwoSegments(folder) && p.startsWith(`${folder}/`)));
/** An advisory warning for a syntactically valid OpenRig home path in Add a machine: when it looks like a path on the
 *  machine being added, or when no such folder exists on this computer yet. Returns a plain sentence, or null. */
export function openrigHomeWarning(value, { machine = null, exists = null, localHome = null, machineHome = null, workspaceRoot = null, machineFolders = [] } = {}) {
  if (openrigHomeProblem(value)) return null;
  const here = cleanHomeFolder(localHome);
  const there = cleanHomeFolder(machineHome);
  const ws = cleanHomeFolder(workspaceRoot);
  const wsParent = ws && ws.endsWith("/workspace") ? cleanHomeFolder(ws.slice(0, -"/workspace".length)) : null;
  const roots = [];
  if (ws) roots.push(ws);
  for (const raw of Array.isArray(machineFolders) ? machineFolders : []) {
    const f = cleanHomeFolder(raw);
    if (f) roots.push(f);
  }
  const underLocalHome = pathOrChild(value, here);
  const matchesWorkspaceParent = hasTwoSegments(wsParent) && (value === wsParent || (exists === false && value.startsWith(`${wsParent}/`)));
  const looksRemote = (Boolean(there) && (value === there || (!underLocalHome && value.startsWith(`${there}/`))))
    || (!underLocalHome && (matchesWorkspaceParent || roots.some((f) => matchesMachineFolder(value, f))));
  const m = typeof machine === "string" && machine ? machine : "that machine";
  if (looksRemote && exists === false) return `${value} looks like ${m}'s own path, and that folder doesn't exist on this computer. Choose a folder on this computer.`;
  if (looksRemote) return `${value} looks like ${m}'s own path. OpenRig home must be a folder on this computer, not on ${m}.`;
  if (exists === false) return `Folder ${value} doesn't exist on this computer. Create it here or choose an existing folder, not a path on ${m}.`;
  return null;
}

/** Adds a new connection for a machine the setup gate has already checked, as a compare-and-swap write
 *  against config.json -- the same `host.readConfig()` / `host.writeConfig(text, previous)` convention
 *  rig-machine-setup.js's approval flow already uses, so a config edited elsewhere between the read and this
 *  write is refused rather than silently overwritten. `before` is the exact text `host.readConfig()` returned
 *  right before this call (the setup gate's own CAS recheck happens first; this is the write-time CAS, belt
 *  and suspenders). The legacy `daemonUrl`/`daemonMachine` keys, if present, are left exactly as they are
 *  (§1: nothing is rewritten) -- only a `connections` key is added or appended to. `expectedHostId` is taken
 *  EXACTLY as given (the setup gate's own checked identity), never re-derived here. */
export async function addMachineConnection(host, before, { machine, daemonUrl, expectedHostId, openrigHome, legacyDaemonUrl } = {}) {
  if (typeof machine !== "string" || !MACHINE_NAME.test(machine)) throw new Error("A valid machine name is required.");
  const cleanUrl = url(daemonUrl);
  if (!cleanUrl) throw new Error("A valid daemon address is required.");
  if (typeof expectedHostId !== "string" || !HOST_ID.test(expectedHostId)) throw new Error("A checked host id is required.");
  // With more than one connection each entry needs its OWN OpenRig home as well as its address: without it the CLI would
  // authenticate from another daemon's home, so every command for this connection refuses (HOME_NEEDED). Saving one
  // without it would write a connection that cannot be used.
  const homeProblem = openrigHomeProblem(openrigHome);
  if (homeProblem) throw new Error(homeProblem);
  let raw;
  try { raw = before === null || before === undefined ? {} : JSON.parse(before); }
  catch { throw new Error(CONFIG_NOT_JSON); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("openrig/config.json must contain an object.");
  const { connections: found, invalid, legacy } = connectionsOf(raw);
  if (invalid) throw new Error(CONFIG_LIST_INVALID);
  let connections = found;
  // A one-connection (legacy-shaped) file may name no address: the CLI finds it, as it always did. With several connections each command must name its own
  // daemon, so the list that keeps this connection working has to write the address it uses now (the loopback one the caller read from the live config);
  // the legacy root keys themselves stay as they are. Without such an address the connection would be left unusable, so nothing is saved.
  if (legacy && !found[0].daemonUrl) {
    const live = url(legacyDaemonUrl);
    if (!live || !LOOPBACK_ADDRESS.test(live)) throw new Error("This computer's OpenRig address isn't known, so adding a machine would leave it without one. Nothing was saved.");
    connections = [{ ...found[0], daemonUrl: live }, ...found.slice(1)];
  }
  if (connections.some((c) => c.machine === machine)) throw new Error(`${machine} already has a connection.`);
  let id;
  do { id = `conn-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; } while (connections.some((c) => c.id === id));
  const next = { id, machine, daemonUrl: cleanUrl, token: null, expectedHostId, openrigHome: text(openrigHome) };
  const nextRaw = { ...raw, connections: [...connections, next] };
  await host.writeConfig(JSON.stringify(nextRaw, null, 2) + "\n", before);
  return next;
}

/** The next loopback address no connection already uses, as the setup screen's prefilled tunnel address:
 *  `http://127.0.0.N:<port>` with N from 2 up, where N is not the host of any existing connection (127.0.0.1, the primary's usual address, is never offered because the search starts at 2; the port is only the box's own,
 *  from its rig status; two tunnels never share a host here, so they never share an address either). null when none is free. */
export function nextTunnelAddress(connections, port) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return null;
  const taken = new Set();
  for (const c of Array.isArray(connections) ? connections : []) {
    const m = /^https?:\/\/(127\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?\/?$/i.exec(String(c?.daemonUrl ?? ""));
    if (m) taken.add(m[1]);
  }
  for (let n = 2; n <= 254; n++) if (!taken.has(`127.0.0.${n}`)) return `http://127.0.0.${n}:${p}`;
  return null;
}

/** The command the person copies to make the tunnel (herdrig never creates or guesses one). The destination is the Herdr machine's own
 *  target from Herdr's list when it is a plain `user@host` shape, else the machine name; both are checked for a shell-safe shape, so the
 *  text is safe to paste. Returns null when the address is not a loopback `http://127.x.y.z:<port>` or a name is unsafe. */
export function tunnelCommand(address, boxPort, machine, target = null) {
  const m = /^http:\/\/(127\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$/.exec(String(address ?? ""));
  const bp = Number(boxPort), lp = m ? Number(m[2]) : NaN;
  const ok = (n) => Number.isInteger(n) && n >= 1 && n <= 65535;
  if (!m || !ok(bp) || !ok(lp) || m[1].split(".").some((part) => Number(part) > 255)) return null;
  const safe = (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/.test(v);
  const destination = safe(target) ? target : machine;
  if (!safe(destination)) return null;
  return `ssh -N -L ${m[1]}:${lp}:127.0.0.1:${bp} ${destination}`;
}

/** Removes one connection from the list as a compare-and-swap write against config.json (the same readConfig/writeConfig(text, previous)
 *  convention as adding one). Only the entry with that id goes: every other entry, the legacy keys and every other key stay exactly as they are,
 *  and nothing on the machine, no tunnel and no space or tile is touched by it. A list always keeps at least one OpenRig. */
export async function removeConnection(host, before, id) {
  let raw;
  try { raw = JSON.parse(before ?? ""); } catch { throw new Error(CONFIG_NOT_JSON); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.connections)) throw new Error("This OpenRig has no connections list to remove from. Nothing was changed.");
  const matches = raw.connections.filter((c) => c && typeof c === "object" && !Array.isArray(c) && c.id === id);
  if (!matches.length) throw new Error("That connection is not in the configuration any more. Nothing was changed.");
  if (matches.length > 1) throw new Error("More than one entry in config.json uses that connection id. Fix the duplicate in config.json first. Nothing was changed.");
  const index = raw.connections.findIndex((c) => c && typeof c === "object" && !Array.isArray(c) && c.id === id);
  // Count USABLE entries, not raw ones: a list may hold null or unusable entries, and counting those allowed removing the last real
  // OpenRig (`[{conn-a}, null]` looked like two), leaving a list that reads as invalid - the person's only working setup gone.
  const remaining = raw.connections.filter((_, i) => i !== index);
  const usable = connectionsOf({ ...raw, connections: remaining }).connections;
  if (!usable.length) throw new Error("A connections list keeps at least one OpenRig, so this one was not removed.");
  const nextRaw = { ...raw, connections: remaining };
  await host.writeConfig(JSON.stringify(nextRaw, null, 2) + "\n", before);
  return { removed: id };
}

/** Whether herdrig offers to switch a connection to Herdr's connection ("Use Herdr's connection instead…" and its dialog).
 *  Off: the switching code stays in place but nothing offers or performs it; a connection that already uses Herdr's connection
 *  keeps working and can still switch back to its tunnel. Every entry point checks this one value. */
export const HERDR_CONNECTION_OFFERED = false;
/** Switches one connection from its tunnel to Herdr's connection (one click, never automatic; §3.1.3): its address becomes `herdrUrl`
 *  (herdr://<machine>/<hostId>, which the caller has verified reaches the same OpenRig as the tunnel), and the old address is kept, unused, as
 *  `retainedDaemonUrl` (the `verifiedTunnel` the caller checked), so switching back is one click. A compare-and-swap write like removeConnection. */
export const SWITCH_NOT_OFFERED = "This version of herdrig doesn't switch a connection away from its tunnel. Nothing was changed.";
export async function switchConnection(host, before, id, herdrUrl, verifiedTunnel, { offered = HERDR_CONNECTION_OFFERED } = {}) {
  if (!offered) throw new Error(SWITCH_NOT_OFFERED);
  let raw;
  try { raw = JSON.parse(before ?? ""); } catch { throw new Error("openrig/config.json is not valid JSON."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.connections)) throw new Error("This OpenRig has no connections list. Nothing was changed.");
  const index = raw.connections.findIndex((c) => c && typeof c === "object" && c.id === id);
  if (index < 0) throw new Error("That connection is not in the configuration any more. Nothing was changed.");
  const entry = raw.connections[index], m = /^herdr:\/\/([a-z0-9][a-z0-9._-]{0,31})\/([A-Za-z0-9._:-]{1,128})$/.exec(String(herdrUrl ?? ""));
  if (!m || entry.machine !== m[1]) throw new Error("That address isn't this connection's machine. Nothing was changed.");
  if (!url(entry.daemonUrl)) throw new Error("This connection doesn't use a tunnel, so there is nothing to switch. Nothing was changed.");
  // The tunnel kept is the one whose /healthz was just checked against the helper: an entry edited since then isn't switched.
  if (url(verifiedTunnel) !== url(entry.daemonUrl)) throw new Error("This connection's tunnel address changed while the switch was checked. Nothing was changed.");
  if (entry.expectedHostId && entry.expectedHostId !== m[2]) throw new Error(`${entry.machine} now answers as another OpenRig than this connection was set up for. Nothing was changed.`);
  const next = { ...entry, daemonUrl: herdrUrl, retainedDaemonUrl: url(verifiedTunnel), expectedHostId: m[2] };
  const connections = raw.connections.map((c, i) => (i === index ? next : c));
  if (!normalizeConnection(next)) throw new Error("The switched connection wouldn't be valid. Nothing was changed.");
  await host.writeConfig(JSON.stringify({ ...raw, connections }, null, 2) + "\n", before);
  return { switched: id, daemonUrl: herdrUrl };
}

export function localDaemonOrigin(value) {
  if (typeof value !== "string") return "";
  const m = /^(https?):\/\/(localhost|\[[0-9a-f:]+\]|0\.0\.0\.0|127\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::(\d{1,5}))?\/?$/i.exec(value.trim());
  if (!m) return "";
  const scheme = m[1].toLowerCase(), port = m[3] == null ? null : Number(m[3]);
  let host = m[2].toLowerCase();
  if (host.startsWith("[")) {
    if (canonicalIPv6(host.slice(1, -1)) !== "::1") return "";
    host = "[::1]";
  }
  if (host.startsWith("127.") && host.split(".").some((part) => Number(part) > 255 || String(Number(part)) !== part)) return "";
  if (port !== null && (port < 1 || port > 65535)) return "";
  return `${scheme}://${host}${port !== null && port !== (scheme === "https" ? 443 : 80) ? `:${port}` : ""}`;
}

// One key per loopback ADDRESS, so spellings of it compare equal: localhost, 127.0.0.1, [::1] and 0.0.0.0 with the same
// scheme and port are one address; any other loopback (127.0.0.4) stays its own.
export const addressKey = (value) => {
  const origin = localDaemonOrigin(value) || String(value).trim().replace(/\/+$/, ""); // localDaemonOrigin is "" (not null) for a non-loopback address: use the address itself
  const m = /^(https?):\/\/(\[[^\]]+\]|[^:/]+)(?::(\d+))?$/i.exec(origin);
  if (!m) return origin;
  const host = m[2].toLowerCase().replace(/\.$/, ""), alias = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(host);
  return `${m[1].toLowerCase()}|${alias ? "loopback" : host}|${m[3] ?? (m[1].toLowerCase() === "https" ? "443" : "80")}`;
};

/** Switches a connection back to the tunnel it kept (`retainedDaemonUrl`). The same compare-and-swap write. */
export async function switchBack(host, before, id) {
  let raw;
  try { raw = JSON.parse(before ?? ""); } catch { throw new Error("openrig/config.json is not valid JSON."); }
  const index = Array.isArray(raw?.connections) ? raw.connections.findIndex((c) => c && typeof c === "object" && c.id === id) : -1;
  if (index < 0) throw new Error("That connection is not in the configuration any more. Nothing was changed.");
  const entry = raw.connections[index], kept = url(entry.retainedDaemonUrl);
  if (!kept) throw new Error("This connection has no tunnel address to switch back to. Nothing was changed.");
  // Another connection may have been given this address since the switch: switching back would put two connections on one address.
  if (raw.connections.some((c, i) => i !== index && c && typeof c === "object" && typeof c.daemonUrl === "string" && addressKey(c.daemonUrl) === addressKey(kept))) throw new Error(`Another connection now uses ${kept}, so this one can't switch back to it. Nothing was changed.`);
  // The kept tunnel must still reach the same OpenRig: its /healthz names the connection's expected host id, or nothing is written.
  // A loopback tunnel is read with the plain loopback /healthz read (no bearer, no redirects): the connection's own gated read is scoped to the herdr://
  // address it still has, so it refuses the tunnel. Only "nothing answers" is said as not answering; any other refusal says what it is.
  let health = null;
  try {
    if (localDaemonOrigin(kept) && typeof host.setupFetch === "function") { const r = await host.setupFetch(`${kept}/healthz`); health = r?.ok ? JSON.parse(await r.text()) : null; }
    else health = typeof host.health === "function" ? await host.health(kept) : null;
  } catch (error) {
    if (error?.code !== "NO_ANSWER" && !(error instanceof SyntaxError)) throw new Error(`Herdr couldn't check the tunnel at ${kept}: ${error?.message ?? error} Nothing was changed.`);
    health = null;
  }
  if (typeof health?.selfHostId !== "string" || !health.selfHostId) throw new Error(`The tunnel at ${kept} doesn't answer, so this connection can't switch back to it. Nothing was changed.`);
  if (entry.expectedHostId && health.selfHostId !== entry.expectedHostId) throw new Error(`The tunnel at ${kept} now reaches another OpenRig (host ${formatHostId(health.selfHostId)}). Nothing was changed.`);
  const { retainedDaemonUrl: _kept, ...rest } = entry;
  // The herdr:// address it leaves is kept, so tabs Attached over Herdr's connection stay this connection's (one rig == one space).
  const left = herdrAddress(entry.daemonUrl);
  const connections = raw.connections.map((c, i) => (i === index ? { ...rest, daemonUrl: kept, ...(left ? { retainedDaemonUrl: left } : {}) } : c));
  await host.writeConfig(JSON.stringify({ ...raw, connections }, null, 2) + "\n", before);
  return { switchedBack: id, daemonUrl: kept };
}

/** An error of herdrig's own code (a missing name, a wrong type, a bad size, an answer that doesn't parse), as opposed to a machine or an OpenRig that
 *  failed. A catch that returns "nothing found" or says "not answering" must let these through or say them as what they are. */
export const CODE_ERRORS = new Set(["TypeError", "ReferenceError", "RangeError", "SyntaxError"]);
export const isCodeError = (e) => CODE_ERRORS.has(e?.name);
/** What an error of herdrig's own says: one line, at most 160 characters (a JSON SyntaxError can quote the answer it choked on, with its newlines). */
export const describeCodeError = (e) => {
  const text = `${e?.name}: ${e?.message}`.replace(/[\x00-\x1f\x7f\s]+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
};
export const codeErrorMessage = (e) => `herdrig couldn't read OpenRig: ${describeCodeError(e)}`;
/** The next step after any message about an error of herdrig's own. */
/** A refresh that failed because a connection over Herdr's connection needs its approval again (the machine, its account or the helper changed):
 *  said as that, with the one way out it has, never as "couldn't refresh". Anything else gets `fallback`. */
export const herdrReapprove = (offered = HERDR_CONNECTION_OFFERED, { single = false, machine = null } = {}) => offered
  ? (single ? `To approve it again, choose "Approve helper on ${machine ?? "the machine"}…" below.` // one connection: no Connections blocks to point at
    : "To approve it again, choose \"Approve helper…\" for it in the sidebar or in System › Connections.")
  : "To keep using it, switch back to its tunnel in System › Connections, or put its tunnel address back in openrig/config.json.";
/** "Approve helper…" while the switch is off: refused before any helper client is made (the same gate as the switch). */
export const HERDR_APPROVE_NOT_OFFERED = "Approving the helper over Herdr's connection isn't offered in this version. Nothing was approved.";
/** Whether a read's failure is a herdr:// connection asking for its helper approval again (it carries the machine's confirmation), so
 *  "Approve helper…" applies. Never for a tunnel or local connection, and never for any other refusal. */
export const needsHelperApproval = (error, config) => error?.needsConsent === true && !!error?.confirmation
  && String(config?.daemonUrl ?? "").startsWith("herdr://");
export const HERDR_REAPPROVE = herdrReapprove();
export function refreshFailureMessage(error, fallback, { single = false, machine = null } = {}) {
  if (error?.needsConsent === true) return `${String(error.message ?? "").trim() || "This connection needs your approval before herdrig uses OpenRig there over Herdr's connection."} ${single ? herdrReapprove(HERDR_CONNECTION_OFFERED, { single, machine }) : HERDR_REAPPROVE}`;
  return fallback;
}
export const CODE_ERROR_NEXT = "If it keeps happening, restart Herdr and report this message.";
/** The save-failure next step: a file problem the person can fix. */
export const SAVE_NEXT = "Check that herdrig can write to its app folder.";

const EXEC_TIMEOUT = /took longer than (\d+(?:\.\d+)?) ?s(?: on ([\w.-]+))? and was stopped/;
const EXEC_PREFIX = /^[`'"]?herdr\.exec[`'"]?:\s*/;
const loggedExecErrors = new WeakSet();

/** Logs the technical `herdr.exec` failure once to Herdr's script log (`console.log`), keeping internal call names out of user-facing notices. */
export function logExecError(error) {
  if (error && typeof error === "object") {
    if (loggedExecErrors.has(error)) return;
    loggedExecErrors.add(error);
  }
  const raw = String(error?.message ?? error ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!raw) return;
  try { globalThis.console?.log?.(`[herdrig] ${raw}`); } catch (_) {}
}

export function parseExecTimeout(error) {
  const m = EXEC_TIMEOUT.exec(String(error?.message ?? error ?? ""));
  return m ? { seconds: m[1], machine: m[2] ?? null } : null;
}

export function describeExecTimeout(error, { machine = null, kind = "remote", action = "save" } = {}) {
  const parsed = parseExecTimeout(error);
  if (!parsed) return null;
  const seconds = parsed.seconds, unit = seconds === "1" ? "second" : "seconds";
  const targetMachine = parsed.machine ?? (typeof machine === "string" && /^[\w.-]+$/.test(machine) ? machine : null);
  if (targetMachine && kind === "remote-write") {
    const what = action === "copy" ? "The copy may still have been made there" : "The save may still have happened there";
    return `Stopped: ${targetMachine} took longer than ${seconds} ${unit} to answer. ${what}: check before trying again. If it keeps happening, check that Herdr still reaches it (hc machine ls).`;
  }
  if (targetMachine && (kind === "attach" || kind === "remote")) {
    const lead = kind === "attach" ? "Attach stopped" : "Stopped";
    return `${lead}: ${targetMachine} took longer than ${seconds} ${unit} to answer, so nothing more was started there. If ${targetMachine} is busy, try again in a moment. If it keeps happening, check that Herdr still reaches it (hc machine ls).`;
  }
  if (kind === "local-attach") {
    return `OpenRig took longer than ${seconds} ${unit} to answer, so nothing was started. Try again in a moment.`;
  }
  if (kind === "write" || kind === "remote-write") {
    return `OpenRig took longer than ${seconds} ${unit} to answer, so herdrig stopped waiting. It may still have done it: check before trying again.`;
  }
  return `OpenRig took longer than ${seconds} ${unit} to answer, so herdrig stopped waiting. Try again in a moment.`;
}

const EXEC_NOT_STARTED = /^(?:[`'"]?herdr\.exec[`'"]?:\s*)?cannot run /;

/** Whether a thrown error happened before any write left this computer or ran on a machine. */
export function isKnownUnsentError(error) {
  if (!error || typeof error !== "object") return EXEC_NOT_STARTED.test(String(error ?? ""));
  if (error.outcomeUnknown === true) return false;
  if (error.code === "GATE_REFUSED") return error.dispatched !== true;
  return error.notSent === true
    || error.needsConsent === true
    || error.answered === true
    || EXEC_NOT_STARTED.test(String(error.message ?? ""));
}

/** Plain user-facing sentence for an error that happened before any write left. */
export function unsentErrorMessage(error) {
  return refreshFailureMessage(error, plainExecError(error, { kind: "read" }));
}

/** Plain user-facing sentence for a Herdr `exec` error, logging the technical `herdr.exec` detail when rewritten. */
export function plainExecError(error, options = {}) {
  const timeoutText = describeExecTimeout(error, options);
  if (timeoutText) {
    logExecError(error);
    return timeoutText;
  }
  const raw = String(error?.message ?? error ?? "");
  if (EXEC_PREFIX.test(raw)) {
    logExecError(error);
    return raw.replace(EXEC_PREFIX, "");
  }
  return raw;
}

/** A connections list with no entry for this computer: every entry names a Herdr machine (this computer's entry was removed, or the list was
 *  written that way). The way back to it, "This computer", is offered only then. A legacy config (no list) is this computer's own already. */
export const localConnectionMissing = (config) => Boolean(config?.connectionsList) && Array.isArray(config?.connections) && config.connections.length > 0
  && config.connections.every((c) => Boolean(c?.machine));
export const LOCAL_ALREADY_CONNECTED = "This computer is already connected. Nothing was saved.";
export const localTaken = (connection) => `That's the OpenRig, or the OpenRig home, that ${connection?.machine ?? "another connection"} already uses. Nothing was saved.`;
const homeKey = (value) => String(value ?? "").replace(/\/+$/, "");

/** Adds this computer's OpenRig back to a connections list, as one compare-and-swap append against config.json. The caller (the
 *  "Add this computer" check) has already read every value from that home's own OpenRig; this refuses on its own anyway: no list, a list that
 *  already has an entry for this computer, an address that isn't loopback, a bad host id or home, and an address, host id or OpenRig home another
 *  connection uses (`canonicalHomes`: the listed homes as the check resolved them). The entry has no machine key, which is what makes it this
 *  computer's; existing entries and unknown fields are preserved (never re-normalized), and it goes last, so the first
 *  connection stays the primary. Never loosens `addMachineConnection`. */
export async function addLocalConnection(host, before, { daemonUrl, expectedHostId, openrigHome, canonicalHomes = [] } = {}) {
  const cleanUrl = url(daemonUrl);
  if (!cleanUrl || !LOOPBACK_ADDRESS.test(cleanUrl)) throw new Error("This computer's OpenRig must answer on a loopback address. Nothing was saved.");
  if (typeof expectedHostId !== "string" || !HOST_ID.test(expectedHostId)) throw new Error("A checked host id is required. Nothing was saved.");
  const homeProblem = openrigHomeProblem(openrigHome);
  if (homeProblem) throw new Error(homeProblem);
  let raw;
  try { raw = JSON.parse(before ?? ""); } catch { throw new Error("openrig/config.json is not valid JSON."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("openrig/config.json must contain an object.");
  if (!Array.isArray(raw.connections)) throw new Error("This OpenRig has no connections list, so this computer is its connection already. Nothing was saved.");
  const { connections, invalid } = connectionsOf(raw);
  if (invalid) throw new Error(CONFIG_LIST_INVALID);
  if (connections.some((c) => !c.machine)) throw new Error(LOCAL_ALREADY_CONNECTED);
  const key = addressKey(cleanUrl), home = homeKey(openrigHome), canonical = new Set(canonicalHomes.map(homeKey));
  for (const c of connections) {
    if ((c.daemonUrl && addressKey(c.daemonUrl) === key) || c.expectedHostId === expectedHostId || (c.openrigHome && homeKey(c.openrigHome) === home)) throw new Error(localTaken(c));
  }
  if (canonical.has(home)) throw new Error(localTaken(null));
  let id;
  do { id = `conn-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; } while (connections.some((c) => c.id === id));
  const next = { id, daemonUrl: cleanUrl, token: null, expectedHostId, openrigHome };
  await host.writeConfig(JSON.stringify({ ...raw, connections: [...raw.connections, next] }, null, 2) + "\n", before);
  return next;
}
