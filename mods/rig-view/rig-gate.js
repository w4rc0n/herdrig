// THE SEND GATE (v0.4.5 RC8). One choke point for everything a Rig mod sends to an OpenRig daemon or runs for one: HTTP requests, event-stream
// connections, the OpenRig CLI, and the Herdr commands that start a process. Every one is checked at SEND time against the CURRENT config (never one
// captured before an await), and its result is dropped if the config changed while it ran.
//
// Why: a connections list is refused in v0.4.5 (rig-connections.js), and rounds 2 to 5 of review each found one more place that checked a refusal
// BEFORE an await and used the answer AFTER it. A per-site check can't end that; a gate every sink goes through can.
//
// How it knows the current config: each mod's view class has a `config` accessor that calls `observeConfig(value)` on every assignment (so a test or
// a reload that sets `view.config` is seen at once). A null or undefined assignment is ignored; a mod that has never been given a config is
// UNLOADED, and an unloaded mod sends nothing. The state is per module copy (each mod folder has its own copy of this file), shared by that mod's
// instances; the most recent non-null config wins.
//
// What it does NOT cover (documented, each by reason): the .cjs helpers (rig-attach-relay.cjs, rig-spec-files.cjs, rig-remote-files.cjs,
// rig-spec-transport.cjs) run in other processes (a terminal, the box), started only through gatedHc/gatedExec with an argv the mod built.
// rig-spec-files.cjs and rig-remote-files.cjs carry no daemon destination in a payload (a folder and a hash, never an address): nothing for the gate to compare. If one ever does, the attach relay's shape
// applies: its payload is read with rig-relay-payload.js and judged by the token after the script (test/relay-payload-parity.test.mjs pins that reading to the real relay).
//
// A refused call THROWS `GateRefusal`: every caller already has a catch for a failed request, and its message is the sentence for the person.
import { LEGACY_CONNECTION_ID, NO_CONNECTION, UNKNOWN_CONNECTION, UNREADABLE_FORM, addressParts, unreadableAddress, isKnownUnsentError } from "./rig-connections.js";
import { decodeRelayToken, relayDaemonOrigin } from "./rig-relay-payload.js";
import { isHerdrUrl, parseHerdrUrl } from "./rig-herdr-url.js";

export const CONFIG_LOADING = "OpenRig's settings are still loading. Try again in a moment.";
export const CONFIG_CHANGED_OPEN = "OpenRig's settings changed while this was open. Close it and open it again.";
export const CONFIG_CHANGED = "OpenRig's settings changed while this was running, so its answer was not used.";

export class GateRefusal extends Error {
  /** `dispatched`: the refusal was raised AFTER the request, process or command had left (its answer came back, or failed, under settings that are gone). The daemon may have acted;
   *  a caller must not say "nothing was sent" for it. A refusal that stopped the send first leaves it false. */
  constructor(message, { dispatched = false } = {}) { super(message); this.name = "GateRefusal"; this.code = "GATE_REFUSED"; this.dispatched = dispatched; }
}

/** Commands that are not the OpenRig CLI and talk to no daemon: local read utilities a refused or unloaded config may still run. Everything else
 *  (`env`, which carries the rig CLI, `rig`, `node` running it) is refused. Listed by name so a new one is a decision, not an accident. */
export const NON_DAEMON_COMMANDS = Object.freeze(["false", "git", "printenv", "realpath", "test", "tmux", "which"]);
// SCOPES (v0.5.0, several connections; DESIGN-gate-per-connection.md rev 3). One scope per connection id. A scope's IDENTITY is [id, the address the FILE names,
// machine, OpenRig home] plus the configured `rig` argv; a change to any element of ONE connection's tuple moves THAT scope's generation and no other. An address the
// CLI found is not file identity (a default install's first discovery must not drop calls that began before it finished) and is recorded only while exactly ONE scope is
// open (with several, the CLI could find any daemon). A scope whose id leaves the list is closed: every call naming it refuses.
const scopes = new Map(); // id -> { id, tuple, generation, open, address, home, machine, discovered }
let loaded = false;
let invalid = null; // the line of an invalid config (a connections list with no usable entry): nothing is sent under it
let rigJson = "null";
// A bare "was the config reassigned at all" counter, for a caller with no connection scope yet to key a generation
// to (the machine-setup gate: adding a connection has no id until it is saved). It over-invalidates on purpose
// (any reassignment bumps it, even one that leaves this one connection's own tuple unchanged) rather than under-
// invalidating, which is the safe direction for a recheck. Never scope it to one field: a caller that needs that
// precision has an existing connection id and belongs on the per-scope generation above instead.
let configGeneration = 0;
export const gateConfigGeneration = () => configGeneration;

const fileAddress = (config) => (config?.daemonUrlSource === "cli" || config?.daemonUrlSource === "default" ? null : (config?.daemonUrl ?? null));
/** The connection descriptors a config lists: its `connections`, or (a config that carries none) the one connection it is. */
const descriptorsOf = (config) => {
  const own = { id: config?.connectionId ?? LEGACY_CONNECTION_ID, address: fileAddress(config), machine: config?.daemonMachine ?? null, home: config?.openrigHome ?? null };
  if (!(Array.isArray(config?.connections) && config.connections.length)) return [own];
  // The config's own connection is what its top-level fields say (they are what the mod acts on, and what an enrichment or a test edits); the others are as listed.
  return config.connections.map((c) => (c.id === own.id ? own : { id: c.id, address: c.daemonUrl ?? null, machine: c.machine ?? null, home: c.openrigHome ?? null }));
};
const tupleOf = (d) => JSON.stringify([d.id, d.address, d.machine, d.home, rigJson]);

/** What makes a config a different one for what is in flight, for ITS OWN connection: the connection, the address the file names, the machine, the OpenRig home and the configured
 *  rig command. (Another connection's edit is not this one's change.) */
const identity = (config) => { if (config?.configInvalid) return JSON.stringify(["invalid", config.configInvalid]); const [d] = descriptorsOf(config?.connections ? { ...config, connections: config.connections.filter((c) => c.id === (config.connectionId ?? c.id)) } : config); return JSON.stringify([d.id, d.address, d.machine, d.home, JSON.stringify(config?.rig ?? null)]); };
export const gateSameConfig = (a, b) => identity(a) === identity(b);
/** The same identity as a string, for a fingerprint a flow keeps between a review and a later confirm. */
export const gateIdentity = (config) => identity(config ?? {});

/** Called by every assignment of a mod's `config`. Null and undefined are ignored (a constructor's placeholder is not a config). It reconciles the scope map from the
 *  connections the config lists: a new id opens a scope, a changed identity moves that scope's generation, an unchanged one keeps its scope, a removed id closes it. */
export function observeConfig(config) {
  if (config === null || config === undefined || typeof config !== "object") return;
  configGeneration++; // every real assignment, including one that turns out invalid below
  loaded = true;
  invalid = config.configInvalid ?? null;
  if (invalid) { for (const s of scopes.values()) if (s.open) { s.open = false; s.generation++; } return; } // an invalid config opens no scope: everything in flight is dropped
  const nextRig = JSON.stringify(config.rig ?? null), rigMoved = nextRig !== rigJson; rigJson = nextRig;
  const listed = descriptorsOf(config), ids = new Set(listed.map((d) => d.id));
  for (const d of listed) {
    const tuple = tupleOf(d), had = scopes.get(d.id);
    if (!had) scopes.set(d.id, { id: d.id, tuple, generation: 1, open: true, address: d.address, home: d.home, machine: d.machine, discovered: null });
    else if (had.tuple !== tuple || !had.open || rigMoved) { Object.assign(had, { tuple, generation: had.generation + 1, open: true, address: d.address, home: d.home, machine: d.machine, discovered: null }); }
  }
  for (const s of scopes.values()) if (!ids.has(s.id) && s.open) { s.open = false; s.generation++; }
  // The address the CLI found: recorded only with exactly one open scope. null to an address is the same config being enriched; one address to another is the daemon moving.
  const open = [...scopes.values()].filter((s) => s.open);
  // The moment a SECOND scope is open, no found address stands: the CLI could have found any daemon, so a found address is forgotten (and calls that began under it are dropped).
  if (open.length >= 2) for (const s of open) if (s.discovered !== null) { s.discovered = null; s.generation++; }
  if (config.daemonUrlSource === "cli" && config.daemonUrl && open.length === 1) {
    const s = open[0];
    if (s.discovered !== null && s.discovered !== config.daemonUrl) s.generation++;
    s.discovered = config.daemonUrl;
  }
}
/** Numbered config reads for ONE mod copy (the menu, the palette): the returned function takes a loader (`() => parsed config`) and number each call when it STARTS. Only the newest completed read is
 *  installed (observed by the gate); an older read that finishes after a newer one has installed returns the INSTALLED config instead and observes nothing, so it can never re-open a connection a newer
 *  read closed. One helper for every reader, so a new reader cannot forget it. */
export function numberedConfigReads() {
  let started = 0, installedAt = 0, installed = null;
  return async (load) => {
    const mine = ++started;
    const cfg = await load();
    if (mine < installedAt && installed) return installed;
    installedAt = mine; installed = cfg; observeConfig(cfg);
    return cfg;
  };
}
/** Test seam only: forgets everything (a fresh module). */
export function resetGate() { scopes.clear(); loaded = false; invalid = null; rigJson = "null"; configGeneration = 0; }
export const gateGeneration = (id) => (id === undefined ? (soleOpen()?.generation ?? 0) : (scopes.get(id)?.generation ?? 0));
const soleOpen = () => { const open = [...scopes.values()].filter((s) => s.open); return open.length === 1 ? open[0] : null; };
/** Why nothing may be sent now, or null: "still loading" for a mod that has never been given a config. */
export function gateRefusal() { return loaded ? invalid : CONFIG_LOADING; }
/** Whether rows or an address another mod published (`rig.data`) belong to the reader's settings: the same connection (when the publisher names one: the sidebar always does), machine and OpenRig home, and (when both name one) the same address. A reader that has
 *  no address yet (the CLI has not found it) reads its home's rows; a publication that carries no config is not judged (nothing to compare). */
export function publishedConfigFor(config, published) {
  const id = config?.connectionId, entries = published?.byConnection;
  if (entries && id && entries[id]?.config) return entries[id].config;
  if (entries && id && !entries[id] && published?.config?.connectionId !== id && published?.config) return null;
  return published?.config ?? null;
}
export function publishedUnder(config, published) {
  // With several connections the sidebar publishes each connection's own state (and config) under `byConnection[id]`: a reader is judged against the entry for ITS connection, never
  // against another's (a connection that is not published is not this reader's). A publication with no per-connection entries is judged by its own config.
  const id = config?.connectionId;
  const entries = published?.byConnection;
  const p = entries && id && entries[id]?.config ? entries[id].config : (entries && id && !entries[id] && published?.config?.connectionId !== id && published?.config ? null : published?.config);
  if (p === null) return false;
  if (!p) return true;
  const n = (v) => v ?? null;
  if ((p.connectionId && n(config?.connectionId) !== p.connectionId) || n(config?.daemonMachine) !== n(p.daemonMachine) || n(config?.openrigHome) !== n(p.openrigHome)) return false;
  // The configured rig command (another wrapper can select another OpenRig home): a publication that names one is judged on it, as the gate's own identity is.
  if (Array.isArray(p.rig) && JSON.stringify(p.rig) !== JSON.stringify(config?.rig ?? null)) return false;
  return !(config?.daemonUrl && p.daemonUrl && config.daemonUrl !== p.daemonUrl);
}

/** The scope a send belongs to. A scope id is named by the caller; with none, it resolves only when exactly ONE scope is open (a single-connection install) and
 *  otherwise refuses: a bare sink never defaults to the first or the legacy connection. */
const scopeFor = (id) => {
  if (!loaded) throw new GateRefusal(CONFIG_LOADING);
  if (invalid) throw new GateRefusal(invalid);
  if (id === undefined || id === null) { const only = soleOpen(); if (!only) throw new GateRefusal(NO_CONNECTION); return only; }
  const s = scopes.get(id);
  if (!s || !s.open) throw new GateRefusal(UNKNOWN_CONNECTION);
  return s;
};
// After an await: the answer belongs to the config (the scope's identity) it was asked under.
const stillCurrent = (s, started) => { if (!loaded) throw new GateRefusal(CONFIG_LOADING); if (invalid) throw new GateRefusal(invalid); if (!s.open) throw new GateRefusal(UNKNOWN_CONNECTION); if (started !== s.generation) throw new GateRefusal(CONFIG_CHANGED); };
// The same check AFTER the thing was sent: its refusal says so (the outcome is unconfirmed, not "not sent").
// A failure known to have sent nothing (isKnownUnsentError: notSent, a gate refusal before sending, an exec that never started) is checked with
// stillCurrent instead, so its refusal stays known-unsent.
const stillCurrentAfterSend = (s, started) => { try { stillCurrent(s, started); } catch (error) { if (error instanceof GateRefusal) error.dispatched = true; throw error; } };
const before = (s, since) => { if (since !== undefined && since !== s.generation) throw new GateRefusal(CONFIG_CHANGED); return since ?? s.generation; };

const basename = (command) => String(command ?? "").split("/").pop();

// THE DESTINATION CHECK (one function): a send that names an OpenRig must name the scope's own. Exact after parsing (scheme, host, port); no equivalence logic.
// An OpenRig over Herdr's connection is known by its machine AND its host id (herdr://<machine>/<hostId>): a request built for another OpenRig on
// the same machine is another destination.
const originOf = (url) => (isHerdrUrl(String(url)) ? parseHerdrUrl(url)?.origin ?? null : addressParts(url)?.origin ?? null); // plain JS: the mod runtime need not have `URL`
// Every view of a mod registers a transport from its init, so the registrations are a list, oldest first: the gate uses the newest one still open. A view ends its own
// registration when it closes (the function `registerHerdrTransport` returns), so a closed view's transport, whose config no longer updates, is never the one in use.
const herdrRegistrations = [];
// The registration for a request: the newest whose transport knows the request's connection and address (a view whose config moved on doesn't, and is skipped); when none does,
// the newest, whose own check then refuses plainly. A transport with no `knows` is always taken.
const liveHerdr = (scope, url) => {
  const newest = herdrRegistrations.at(-1) ?? null;
  if (scope === undefined) return newest;
  for (let i = herdrRegistrations.length - 1; i >= 0; i--) {
    const knows = herdrRegistrations[i].transport.knows;
    if (typeof knows !== "function" || knows.call(herdrRegistrations[i].transport, scope, url)) return herdrRegistrations[i];
  }
  return newest;
};
/** The transport a mod registers for herdr:// connections (rig-openrig-http.js): `fetch(url, init, scope)`. Without one such a request sends nothing.
 *  `bridgePath()` names this mod's own copy of the local bridge (rig-openrig-transport.cjs), which the gate then knows by its exact path.
 *  Returns the function that ends this registration; registering `null` ends every registration. */
export function registerHerdrTransport(transport, { bridgePath = null } = {}) {
  if (!transport) { herdrRegistrations.length = 0; return () => {}; }
  const entry = { transport, bridgePath: typeof bridgePath === "function" ? bridgePath : null };
  herdrRegistrations.push(entry);
  return () => { const at = herdrRegistrations.indexOf(entry); if (at >= 0) herdrRegistrations.splice(at, 1); };
}
const BRIDGE_MODES = ["inspect", "prepare", "remove", "install", "stat", "post", "rig"]; // stat: the read-only check of the installed helper before each read
/** The local OpenRig bridge, exactly: a Node binary running THIS mod's registered bridge file in one of its fixed modes, with no OPENRIG_* in the argv.
 *  It names no OpenRig address of its own (it reaches the machine with hc exec and checks the machine, the pinned helper and the host id itself), so it is
 *  not judged as the rig CLI: its "rig" mode is the helper's fixed write verb, not the CLI, and a write's values (a rig named "rig", a message "rig") are
 *  data. Anything else that merely contains "rig" is judged as before. */
const isHerdrBridge = (tokens) => {
  const bridge = liveHerdr()?.bridgePath, path = bridge ? String(bridge() ?? "") : "";
  return path !== "" && tokens.length >= 3 && /(^|\/)node$/.test(String(tokens[0])) && tokens[1] === path && BRIDGE_MODES.includes(tokens[2])
    && !tokens.some((t) => /^OPENRIG_[A-Z_]+=/.test(String(t)));
};
export const HERDR_NOT_READY = "This connection reaches OpenRig over Herdr's connection, which this view can't use yet. Nothing was sent.";
/** Over Herdr's connection the rig CLI can't start a process here (a TUI tab, a terminal view): only the helper's writes are carried. */
export const HERDR_PROCESS_REFUSED = "This isn't available over Herdr's connection yet. Nothing was sent.";
const herdrCli = (value) => flatten(value).some((t) => t.startsWith("OPENRIG_URL=herdr://"));
const herdrCliRun = async (command, args, scope) => { const transport = liveHerdr(scope)?.transport; if (!transport?.cli) throw Object.assign(new Error(HERDR_NOT_READY), { notSent: true }); return transport.cli(command, args, scope); };
/** Two listed OpenRigs on one machine: v0.5.0 reaches each added machine's default OpenRig, so it can't tell them apart there. */
export const TWO_ON_ONE_MACHINE = (machine) => `Two OpenRigs on ${machine} need a home for each; this version supports one per machine. Nothing was sent.`;
/** A connection whose own address herdrig can't check (see `addressParts`): said as that, not as a request built for another OpenRig. */
const UNREADABLE = (address) => `${unreadableAddress(address)} ${UNREADABLE_FORM} Nothing was sent.`;
const WRONG_DESTINATION = (expected) => `That request was built for a different OpenRig than the one it was about to reach${expected ? ` (this one is ${expected})` : ""}. Nothing was sent.`;
const BAD_REQUEST_PATH = "That request used an unexpected OpenRig API path, so nothing was sent.";
const knownAddress = (s) => s.address ?? s.discovered ?? null;
const checkOrigin = (s, url, singleToo = false) => {
  if (!singleToo && soleOpenCount() < 2) return null;
  const known = knownAddress(s), expected = known ? originOf(known) : null;
  if (known && expected === null) throw new GateRefusal(UNREADABLE(known));
  if (typeof url !== "string" || /[\x00-\x20\x7f#]/.test(url)) throw new GateRefusal(WRONG_DESTINATION(expected));
  // herdr://<machine>/<hostId> is read by its own parser (machine AND host id), never as an http address.
  const parts = isHerdrUrl(url) ? parseHerdrUrl(url) : addressParts(url), target = parts?.origin ?? null;
  if (target === null) throw new GateRefusal(WRONG_DESTINATION(expected));
  if (expected !== null) {
    if (target !== expected) throw new GateRefusal(WRONG_DESTINATION(expected));
  } else if (soleOpenCount() !== 1) {
    throw new GateRefusal(WRONG_DESTINATION(null)); // several scopes and none knows its address: nothing reaches a daemon
  }
  return parts;
};
const checkUrl = (s, url) => {
  checkOrigin(s, url, true);
  // For herdr://<machine>/<hostId>/api/... the path starts after the host id, which is part of the origin, not of the path.
  const herdr = isHerdrUrl(url) ? parseHerdrUrl(url) : null;
  const authStart = herdr ? herdr.origin.length : url.indexOf("://") + 3;
  const pathStart = herdr ? (url.startsWith(herdr.origin) && url.charAt(herdr.origin.length) === "/" ? herdr.origin.length : -1) : authStart > 2 ? url.indexOf("/", authStart) : -1;
  const firstQuery = authStart > 2 ? url.indexOf("?", authStart) : -1;
  if (pathStart < 0 || (firstQuery >= 0 && firstQuery < pathStart)) throw new GateRefusal(BAD_REQUEST_PATH);
  const rest = url.slice(pathStart);
  const qAt = rest.indexOf("?");
  const rawPath = qAt >= 0 ? rest.slice(0, qAt) : rest;
  const search = qAt >= 0 ? rest.slice(qAt) : "";
  if (
    !(rawPath.startsWith("/api/") || (rawPath === "/healthz" && search === ""))
    || rawPath.includes("//")
    || rawPath.includes("\\")
    || rawPath.includes("..")
    || rawPath.split("/").some((seg) => seg === "." || seg === "..")
    || /%(?:2e|2f|5c|00|0a|0d)/i.test(rawPath)
  ) {
    throw new GateRefusal(BAD_REQUEST_PATH);
  }
};
const soleOpenCount = () => [...scopes.values()].filter((s) => s.open).length;
const flatten = (value) => (Array.isArray(value) ? value.flatMap(flatten) : [String(value ?? "")]);
const envValues = (tokens, name) => tokens.filter((t) => t.startsWith(name + "=")).map((t) => t.slice(name.length + 1));
/** The rig CLI's destination in an argv (as `cliEnv(config)` writes it): OPENRIG_URL and OPENRIG_HOME. ABSENCE is not a match when several scopes are open. */
const checkArgv = (s, tokens) => {
  if (soleOpenCount() < 2) return;
  const urls = envValues(tokens, "OPENRIG_URL"), homes = envValues(tokens, "OPENRIG_HOME"), several = soleOpenCount() > 1;
  const known = knownAddress(s), expected = known ? originOf(known) : null;
  if (known && expected === null) throw new GateRefusal(UNREADABLE(known));
  if (urls.length > 1 || homes.length > 1) throw new GateRefusal(WRONG_DESTINATION(expected));
  if (urls.length === 1) { if (originOf(urls[0]) === null || expected === null || originOf(urls[0]) !== expected) throw new GateRefusal(WRONG_DESTINATION(expected)); }
  else if (several || (expected !== null && s.address)) { if (several) throw new GateRefusal(WRONG_DESTINATION(expected)); }
  if (homes.length === 1) { if (s.home === null || homes[0] !== s.home) throw new GateRefusal(WRONG_DESTINATION(expected)); }
  else if (several && s.home !== null && s.id !== LEGACY_CONNECTION_ID) throw new GateRefusal(WRONG_DESTINATION(expected));
};
/** A command run on a Herdr machine: its destination is that machine, which must be the scope's own (the identity of a connection includes its machine). One scope: unchanged. */
const checkOnMachine = (s, on) => {
  if (soleOpenCount() < 2) return;
  if (s.machine === null || s.machine === undefined || on !== s.machine) throw new GateRefusal(WRONG_DESTINATION(knownAddress(s) ? originOf(knownAddress(s)) : null));
};
/** Whether an argv runs the OpenRig CLI (it carries OPENRIG_* settings or `rig`): the payloads that name an OpenRig destination. */
const carriesOpenRig = (tokens) => {
  let configured = []; try { configured = JSON.parse(rigJson) ?? []; } catch (_) { configured = []; }
  // The CONFIGURED rig command (`rig: ["/usr/bin/node", "/opt/openrig/cli.mjs"]`) is the rig CLI whatever its name: every element of it in the argv.
  if (Array.isArray(configured) && configured.length && (configured.every((x) => tokens.includes(String(x))) || (configured.length > 1 && tokens.includes(String(configured.at(-1)))))) return true; // the script alone is enough: another interpreter path is the same CLI
  return tokens.some((t) => /^OPENRIG_(URL|HOME)=/.test(t) || t === "rig" || /(^|\/)rig$/.test(t) || /rig\.js$/.test(t));
};

/** The home a rig CLI argv names must be the scope's own (absence refuses for a non-legacy scope with several scopes): the same rule as checkArgv's home half, for a command run ON a machine (no tunnel address there). */
const checkHomeOnly = (s, tokens) => {
  if (soleOpenCount() < 2) return;
  const homes = envValues(tokens, "OPENRIG_HOME"), expected = knownAddress(s) ? originOf(knownAddress(s)) : null;
  // No address check here: on a machine the CLI names that MACHINE's own daemon (an alias of the tunnel, never equal to it).
  // On a machine the CLI reaches that machine's DEFAULT OpenRig: a connection's `openrigHome` is a folder on THIS computer and never names an
  // OpenRig there (v0.5.0 supports one OpenRig per added machine; a home on the machine itself is not supported yet). So any OPENRIG_HOME
  // on a machine is refused: it is either this computer's path or another OpenRig's home.
  if (homes.length > 0) throw new GateRefusal(WRONG_DESTINATION(expected));
  // Without a home the CLI reaches the machine's DEFAULT OpenRig, which is right for ONE OpenRig per machine. With two listed connections on the
  // same machine it could be the other one's: refused plainly until a home on the machine is supported, and nothing is sent.
  if (s.machine && [...scopes.values()].filter((o) => o.open && o.machine === s.machine).length > 1) throw new GateRefusal(TWO_ON_ONE_MACHINE(s.machine));
};
/** The attach relay's destination (the payload decoder and the relay's own loopback rule are shared with the relay's parity test): its argv is [node, <...>/rig-attach-relay.cjs, base64 JSON].
 *  Returns the payload's daemon as the relay would read it (an origin, or "" when it names no local daemon: it reaches nothing), null for a relay whose payload can't be read, undefined when the argv is no relay. */
const isRelayPayload = (p) => p !== null && (typeof p.session === "string" || p.mode === "grid" || p.mode === "pad");
const relayDestinations = (tokens) => {
  // The relay reads the token AFTER its own script: with the file name present that token alone is judged (an earlier relay-shaped token is not what runs). Without the name, EVERY token a relay
  // would read as a payload is judged. Each result is an origin, "" (the payload names no local daemon: it reaches nothing) or null (an unreadable payload on a relay file).
  const named = tokens.findIndex((t) => /(^|\/)rig-attach-relay\.cjs$/.test(t));
  if (named >= 0) { const payload = decodeRelayToken(tokens[named + 1]); return [payload === null ? null : relayDaemonOrigin(payload.daemonUrl)]; }
  const found = [];
  for (let i = 1; i < tokens.length; i++) { const p = decodeRelayToken(tokens[i]); if (isRelayPayload(p)) found.push(relayDaemonOrigin(p.daemonUrl)); }
  return found;
};
/** Every process-starting sink: the rig CLI is checked by its OPENRIG_* tokens, an attach relay by the daemon its payload names. */
const checkProcess = (s, tokens, on, viaExec = false) => {
  if (!viaExec && tokens.some((t) => t.startsWith("OPENRIG_URL=herdr://"))) throw new GateRefusal(HERDR_PROCESS_REFUSED);
  if (viaExec && (on === undefined || on === null || on === "") && isHerdrBridge(tokens)) return; // the bridge checks its machine, helper and host id itself
  // Started ON a Herdr machine (`hc run --on box`): where it runs is its destination (a relay there names that machine's own daemon, not the tunnel), and a rig CLI there must carry the scope's home.
  if (typeof on === "string" && on !== "") { checkOnMachine(s, on); if (carriesOpenRig(tokens)) checkHomeOnly(s, tokens); return; }
  if (carriesOpenRig(tokens)) checkArgv(s, tokens);
  for (const relay of relayDestinations(tokens)) {
    if (relay === null) { if (soleOpenCount() > 1) throw new GateRefusal(WRONG_DESTINATION(knownAddress(s) ? originOf(knownAddress(s)) : null)); }
    else if (relay !== "") checkOrigin(s, relay); // "": the relay reaches no daemon, nothing to be mistaken for
  }
};

const wrapFetchResponse = (response, s, started) => new Proxy(response, {
  get(target, prop) {
    if (prop === "json" || prop === "text") {
      return async (...args) => {
        let value;
        try { value = await target[prop](...args); }
        catch (error) { stillCurrentAfterSend(s, started); throw error; } // a body that fails to read under settings that are gone is not a parse error to fall back from
        stillCurrentAfterSend(s, started);
        return value;
      };
    }
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

/** An HTTP request. The body of the answer is read under the same check, so a settings change that arrives while it is read still drops it. */
export async function gatedFetch(url, init, since, scope) {
  const s = scopeFor(scope);
  // `since`: the generation an operation began under (gatedOperation). An address captured before an await belongs to that generation, so a send
  // after the config changed is refused BEFORE it reaches the old daemon, not merely checked when its answer comes back.
  const started = before(s, since);
  checkUrl(s, url);
  let response;
  // A request that fails after the settings changed failed for the old settings: the caller gets the gate's refusal, never an ordinary error.
  try {
    if (isHerdrUrl(String(url))) { const transport = liveHerdr(s.id, String(url))?.transport; if (!transport) throw Object.assign(new Error(HERDR_NOT_READY), { notSent: true }); response = await transport.fetch(String(url), init, s.id); }
    else response = await globalThis.fetch(url, init);
  }
  catch (error) { (isKnownUnsentError(error) ? stillCurrent : stillCurrentAfterSend)(s, started); throw error; }
  stillCurrentAfterSend(s, started);
  return wrapFetchResponse(response, s, started);
}

/** A read-only loopback `/healthz` GET for this computer's default OpenRig (single-connection localAddFolder identity check):
 *  requires exactly one open scope, an exact `http://127.0.0.1:<port>/healthz` URL with no normalization, and checks the scope's generation before and after. */
export async function gatedLocalHealth(url, since, scope) {
  const s = scopeFor(scope);
  const started = before(s, since);
  const m = typeof url === "string" ? /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/healthz$/.exec(url) : null;
  const port = m ? Number(m[1]) : 0;
  if (soleOpenCount() !== 1 || !m || port < 1 || port > 65535) throw new GateRefusal(BAD_REQUEST_PATH);
  let response;
  try { response = await globalThis.fetch(url); }
  catch (error) { stillCurrentAfterSend(s, started); throw error; }
  stillCurrentAfterSend(s, started);
  if (response?.url !== url) throw new GateRefusal("That local health check redirected or did not confirm its final address, so its answer was not used.", { dispatched: true });
  return wrapFetchResponse(response, s, started);
}

const SPEC_BRIDGE_MODS = ["rig", "rig-view", "rig-palette", "rig-menu"];
/** Local cleanup of the private spec-transfer scratch file (`node <appHome>/mods/<mod>/rig-spec-transport.cjs remove <appHome> [--if-empty]`):
 *  talks to no daemon, starts nothing on a machine, and carries no OPENRIG_* env, so a refused, closed or changed scope
 *  still removes the file a transfer created before the refusal. */
const isLocalSpecTransferCleanup = (command, args, on, appHome) => {
  if (!(on === undefined || on === null || on === "")) return false;
  const cmd = String(command ?? "");
  const nodeOk = cmd === "node" || (cmd.startsWith("/") && !cmd.includes("\0") && !cmd.split("/").some((s) => s === "." || s === "..") && /\/node$/.test(cmd));
  if (!nodeOk || !Array.isArray(args)) return false;
  if (!(args.length === 3 || (args.length === 4 && args[3] === "--if-empty")) || args[1] !== "remove") return false;
  if (typeof appHome !== "string" || args[2] !== appHome) return false;
  const home = typeof args[2] === "string" && args[2].startsWith("/") && !args[2].includes("\0") && !args[2].split("/").some((s) => s === "." || s === "..")
    ? args[2].replace(/\/+$/, "")
    : null;
  if (!home || !SPEC_BRIDGE_MODS.some((m) => args[0] === `${home}/mods/${m}/rig-spec-transport.cjs`)) return false;
  return !flatten([command, args]).some((t) => /^OPENRIG_[A-Z_]+=/.test(String(t)));
};

// A stale Save reply can only prove that this exact spec was written. Never pass
// the reply back through the gate or authorize any follow-on operation with it.
function confirmsSpecSave(command, args, on, appHome, result) {
  if (basename(command) !== "node" || on || !appHome || !Array.isArray(args) || args.length !== 12 ||
      args[0] !== `${appHome}/mods/rig-view/rig-spec-transport.cjs` || args[1] !== "run" ||
      args[2] !== appHome || args[6] !== "save" || !/^[a-f0-9]{64}$/.test(args[11]) ||
      result?.code !== 0 || typeof result.stdout !== "string" || result.stdout.length > 65536) return false;
  try {
    const receipt = JSON.parse(result.stdout);
    return receipt?.ok === true && !receipt.error && receipt.path === args[7] && receipt.sha256 === args[11];
  } catch { return false; }
}

/** A process run for the mod (the OpenRig CLI is `env ... rig ...`). Local utilities pass; everything else names an OpenRig and is checked against the scope. */
export async function gatedExec(rawExec, command, args, options, since, scope, appHome) {
  const on = options && typeof options === "object" ? options.on : undefined;
  const local = ((basename(command) !== "test" || !on) && NON_DAEMON_COMMANDS.includes(basename(command)))
    || isLocalSpecTransferCleanup(command, args, on, appHome);
  let s = null, started = 0;
  if (!local) {
    s = scopeFor(scope); started = before(s, since);
    const tokens = flatten([command, args]);
    // A command run ON a Herdr machine is aimed by WHERE it runs: it carries no tunnel address (its rig CLI reads that machine's own OpenRig), so the machine is the destination and it must be the
    // scope's own. Anything else is judged like every other sink: only an argv that carries an OpenRig destination (the rig CLI, or OPENRIG_*) is checked; a helper that is not the rig CLI names none.
    // The same judgement as every other process sink: on a machine (machine AND home), otherwise the rig CLI's tokens and an attach relay's payload.
    checkProcess(s, tokens, on, true);
  }
  let result;
  // A process that fails after the settings changed failed for the old settings: the caller gets the gate's refusal, never an ordinary error it could
  // read as "that command does not work, use the default".
  // A rig CLI aimed at an OpenRig over Herdr's connection never runs here: the transport carries it to the helper's rig verb on the machine.
  try { result = !local && herdrCli([command, args]) ? await herdrCliRun(command, args, s.id) : await rawExec(command, args, options); }
  catch (error) { if (!local) (isKnownUnsentError(error) ? stillCurrent : stillCurrentAfterSend)(s, started); throw error; }
  if (!local) {
    try { stillCurrentAfterSend(s, started); }
    catch (error) {
      if (error instanceof GateRefusal && confirmsSpecSave(command, args, on, appHome, result)) error.confirmedSpecSave = true;
      throw error;
    }
  }
  return result;
}

/** A Herdr command. Verbs that only drive Herdr itself (ls, get, label, space, tab, pane, machine...) send nothing to a daemon and start no process:
 *  they pass. `run` and `exec` start a process (a TUI, an attach relay, a spec helper): they are checked against the scope when their argv runs the rig CLI. */
export const PROCESS_VERBS = Object.freeze(["run", "exec", "file"]); // `file` writes on another machine
export async function gatedHc(rawHc, args, bytes, since, scope) {
  const verb = Array.isArray(args) ? args[0] : null;
  if (!PROCESS_VERBS.includes(verb)) return rawHc(args, bytes);
  const s = scopeFor(scope), started = before(s, since);
  const tokens = flatten(args), onAt = Array.isArray(args) ? args.indexOf("--on") : -1;
  checkProcess(s, tokens, onAt >= 0 ? args[onAt + 1] : undefined);
  let result;
  try { result = await rawHc(args, bytes); }
  catch (error) { stillCurrentAfterSend(s, started); throw error; }
  // The process was started under the config that is gone. It cannot be un-started, but nothing may ACT on it (select its tab, label it, report
  // success): the caller gets the refusal, as for every other gated sink.
  stillCurrentAfterSend(s, started);
  return result;
}

/** A Herdr `run(name, args)`. Verbs that only move Herdr's own UI (space.new with a machine, tab.select, terminal.peek, mod.open...) pass. A verb that
 *  carries a command to start (`argv`, `command`, `cmd`, `program`: tab.new, pane.split, space.new with a program) starts a process just like `hc run`, so it is checked against the scope. */
export const COMMAND_KEYS = Object.freeze(["argv", "command", "cmd", "program"]);
export function gatedRun(rawRun, name, args, scope) {
  if (args && typeof args === "object" && COMMAND_KEYS.some((key) => args[key] !== undefined && args[key] !== null)) {
    const s = scopeFor(scope), tokens = flatten(COMMAND_KEYS.map((key) => args[key]).filter((v) => v !== undefined && v !== null));
    // A process started in a pane of a Herdr machine (its address is `<machine>/<pane>`) runs ON that machine: it is judged by where it runs, like `hc run --on`.
    const machine = typeof args.pane === "string" && args.pane.includes("/") ? args.pane.slice(0, args.pane.indexOf("/")) : undefined;
    checkProcess(s, tokens, machine);
  }
  return rawRun(name, args);
}

/** A multi-step operation (resolve an address, read a revision, POST): it fixes ONE scope and that scope's generation at its start, and every request it sends
 *  through `.fetch` is refused if the config changed since or if it names another OpenRig than its scope's. `check()` is for a step that is not a request. */
export function gatedOperation(scope) {
  const s = scopeFor(scope), since = s.generation, id = s.id;
  return {
    since, scope: id,
    fetch: (url, init) => gatedFetch(url, init, since, id),
    localHealth: (url) => gatedLocalHealth(url, since, id),
    // The rig CLI and Herdr's process verbs under the same generation: they refuse to START after a change, and their results are judged by it.
    exec: (rawExec, command, args, options) => gatedExec(rawExec, command, args, options, since, id),
    hc: (rawHc, args, bytes) => gatedHc(rawHc, args, bytes, since, id),
    check: () => stillCurrent(s, since),
  };
}

/** `gatedOperation()` for a caller that has no place to catch the refusal where it starts (a view method): under an unloaded config, or with several scopes and none named,
 *  the operation exists and every request, process and check of it fails with that refusal, exactly as a plain gated call would. */
export function gatedOperationOrRefusal(scope) {
  try { return gatedOperation(scope); }
  catch (error) {
    const fail = () => Promise.reject(error);
    return { since: -1, scope: scope ?? null, fetch: fail, localHealth: fail, exec: fail, hc: fail, check: () => { throw error; } };
  }
}

/** An event-stream connection. The socket it returns is closed if the config changed while it was being made. */
export async function gatedConnect(rawConnect, host, port, scope) {
  const s = scopeFor(scope), started = s.generation, known = knownAddress(s);
  if (soleOpenCount() < 2) { /* one connection: no destination to mistake */ } else if (known !== null) { const u = addressParts(known); if (!u) throw new GateRefusal(UNREADABLE(known)); if ( u.hostname.replace(/^\[|\]$/g, "") !== String(host).replace(/^\[|\]$/g, "") || String(u.port || (u.protocol === "https:" ? "443" : "80")) !== String(port)) throw new GateRefusal(WRONG_DESTINATION(originOf(known))); }
  else throw new GateRefusal(WRONG_DESTINATION(null));
  let socket;
  try { socket = await rawConnect(host, port); }
  catch (error) { stillCurrent(s, started); throw error; } // a connect that fails after the settings changed failed for the old settings
  try { stillCurrent(s, started); } catch (error) { try { socket?.close?.(); } catch (_) {} throw error; }
  return socket;
}
/** For a `.catch` that swallows failures on purpose (a read that falls back to a default): a gate refusal is NOT a failure to swallow, it is the answer
 *  ("nothing was sent, here is why"), so it is rethrown and reaches whoever can tell the person. Other errors give `fallback` (a value or a function). */
export const rethrowGate = (fallback) => (error) => {
  if (error?.code === "GATE_REFUSED") throw error;
  return typeof fallback === "function" ? fallback(error) : fallback;
};

