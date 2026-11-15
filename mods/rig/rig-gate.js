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
//
// A refused call THROWS `GateRefusal`: every caller already has a catch for a failed request, and its message is the sentence for the person.
import { CONNECTIONS_LIST_REFUSED } from "./rig-connections.js";

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
export const NON_DAEMON_COMMANDS = Object.freeze(["false", "git", "printenv", "realpath", "tmux", "which"]);
let current; // undefined: never observed (unloaded). Otherwise the last non-null config.
let generation = 0, identityKey = null, discovered = null;

// What makes a config a different one for the requests already in flight: the list refusal, the connection, the address THE FILE names, the machine
// the OpenRig home and the configured rig command (another wrapper can select another OpenRig home). An address the CLI found is NOT part of that identity: a default install has no daemonUrl, so its first discovery turns the same
// file config into one with an address, and calls that began before it finished (the menu and New rig both ask at once) must not be dropped for it.
// A DIFFERENT address found later (the daemon moved) is a change, tracked on its own below.
const fileAddress = (config) => (config.daemonUrlSource === "cli" || config.daemonUrlSource === "default" ? null : (config.daemonUrl ?? null));
const identity = (config) => JSON.stringify([config.connectionsRefused ?? null, config.connectionId ?? null, fileAddress(config), config.daemonMachine ?? null, config.openrigHome ?? null, config.rig ?? null]);

/** Whether two configs are the same one for what is in flight (the file's identity; an address the CLI found is not a change). A dialog that captured
 *  its config when it opened compares it with a fresh read before it sends. */
export const gateSameConfig = (a, b) => identity(a) === identity(b);
/** The same identity as a string, for a fingerprint a flow keeps between a review and a later confirm. */
export const gateIdentity = (config) => identity(config ?? {});

/** Called by every assignment of a mod's `config`. Null and undefined are ignored (a constructor's placeholder is not a config). */
export function observeConfig(config) {
  if (config === null || config === undefined || typeof config !== "object") return;
  current = config;
  const key = identity(config);
  if (key !== identityKey) { identityKey = key; discovered = null; generation++; }
  // The address the CLI found: null to an address is the same config being enriched (no change); one address to another is the daemon moving (a change).
  // A config that carries no found address (a fresh read of config.json) does not make the mod forget the one it knows.
  if (config.daemonUrlSource === "cli" && config.daemonUrl) {
    if (discovered !== null && discovered !== config.daemonUrl) generation++;
    discovered = config.daemonUrl;
  }
}
/** Test seam only: forgets everything (a fresh module). */
export function resetGate() { current = undefined; generation = 0; identityKey = null; discovered = null; }
export const gateGeneration = () => generation;
/** Why nothing may be sent now, or null: the list line, or "still loading" for a mod that has never been given a config. */
export function gateRefusal() {
  if (current === undefined) return CONFIG_LOADING;
  if (current.connectionsRefused) return current.connectionsRefused;
  return null;
}
/** Whether rows or an address another mod published (`rig.data`) belong to the reader's settings: the same connection (when the publisher names one: the sidebar always does), machine and OpenRig home, and (when both name one) the same address. A reader that has
 *  no address yet (the CLI has not found it) reads its home's rows; a publication that carries no config is not judged (nothing to compare). */
export function publishedUnder(config, published) {
  const p = published?.config;
  if (!p) return true;
  const n = (v) => v ?? null;
  if ((p.connectionId && n(config?.connectionId) !== p.connectionId) || n(config?.daemonMachine) !== n(p.daemonMachine) || n(config?.openrigHome) !== n(p.openrigHome)) return false;
  return !(config?.daemonUrl && p.daemonUrl && config.daemonUrl !== p.daemonUrl);
}
const refuse = () => { const reason = gateRefusal(); if (reason) throw new GateRefusal(reason); };
// After an await: the answer belongs to the config it was asked under.
const stillCurrent = (started) => { refuse(); if (started !== generation) throw new GateRefusal(CONFIG_CHANGED); };
// The same check AFTER the thing was sent: its refusal says so (the outcome is unconfirmed, not "not sent").
const stillCurrentAfterSend = (started) => { try { stillCurrent(started); } catch (error) { if (error instanceof GateRefusal) error.dispatched = true; throw error; } };

const basename = (command) => String(command ?? "").split("/").pop();

/** An HTTP request. The body of the answer is read under the same check, so a list that arrives while it is read still drops it. */
export async function gatedFetch(url, init, since) {
  refuse();
  // `since`: the generation an operation began under (gatedOperation). An address captured before an await belongs to that generation, so a send
  // after the config changed is refused BEFORE it reaches the old daemon, not merely checked when its answer comes back.
  if (since !== undefined && since !== generation) throw new GateRefusal(CONFIG_CHANGED);
  const started = since ?? generation;
  let response;
  // A request that fails after the settings changed failed for the old settings: the caller gets the gate's refusal, never an ordinary error.
  try { response = await globalThis.fetch(url, init); }
  catch (error) { stillCurrentAfterSend(started); throw error; }
  stillCurrentAfterSend(started);
  return new Proxy(response, {
    get(target, prop) {
      if (prop === "json" || prop === "text" || prop === "arrayBuffer" || prop === "blob") {
        return async (...args) => {
          let value;
          try { value = await target[prop](...args); }
          catch (error) { stillCurrentAfterSend(started); throw error; } // a body that fails to read under settings that are gone is not a parse error to fall back from
          stillCurrentAfterSend(started);
          return value;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** A process run for the mod (the OpenRig CLI is `env ... rig ...`). Under a refused or unloaded config only the listed local utilities run. */
export async function gatedExec(rawExec, command, args, options, since) {
  const local = NON_DAEMON_COMMANDS.includes(basename(command));
  if (!local) { refuse(); if (since !== undefined && since !== generation) throw new GateRefusal(CONFIG_CHANGED); }
  const started = since ?? generation;
  let result;
  // A process that fails after the settings changed failed for the old settings: the caller gets the gate's refusal, never an ordinary error it could
  // read as "that command does not work, use the default".
  try { result = await rawExec(command, args, options); }
  catch (error) { if (!local) stillCurrentAfterSend(started); throw error; }
  if (!local) stillCurrentAfterSend(started);
  return result;
}

/** A Herdr command. Verbs that only drive Herdr itself (ls, get, label, space, tab, pane, machine...) send nothing to a daemon and start no process:
 *  they pass. `run` and `exec` start a process (a TUI, an attach relay, a spec helper), so under a refused or unloaded config they are refused. */
export const PROCESS_VERBS = Object.freeze(["run", "exec", "file"]); // `file` writes on another machine
export async function gatedHc(rawHc, args, bytes, since) {
  const verb = Array.isArray(args) ? args[0] : null;
  if (!PROCESS_VERBS.includes(verb)) return rawHc(args, bytes);
  refuse();
  if (since !== undefined && since !== generation) throw new GateRefusal(CONFIG_CHANGED);
  const started = since ?? generation;
  let result;
  try { result = await rawHc(args, bytes); }
  catch (error) { stillCurrentAfterSend(started); throw error; }
  // The process was started under the config that is gone. It cannot be un-started, but nothing may ACT on it (select its tab, label it, report
  // success): the caller gets the refusal, as for every other gated sink.
  stillCurrentAfterSend(started);
  return result;
}

/** A Herdr `run(name, args)`. Verbs that only move Herdr's own UI (space.new with a machine, tab.select, terminal.peek, mod.open...) pass. A verb that
 *  carries a command to start (`argv`, `command`, `cmd`: tab.new, pane.split, space.new with a program) starts a process just like `hc run`, so under a
 *  refused or unloaded config it is refused. */
export const COMMAND_KEYS = Object.freeze(["argv", "command", "cmd", "program"]);
export function gatedRun(rawRun, name, args) {
  if (args && typeof args === "object" && COMMAND_KEYS.some((key) => args[key] !== undefined && args[key] !== null)) refuse();
  return rawRun(name, args);
}

/** A multi-step operation (resolve an address, read a revision, POST): it captures the generation once, at its start, and every request it sends
 *  through `.fetch` is refused if the config changed since. `check()` is for a step that is not a request (before writing a file). */
export function gatedOperation() {
  refuse();
  const since = generation;
  return {
    since,
    fetch: (url, init) => gatedFetch(url, init, since),
    // The rig CLI and Herdr's process verbs under the same generation: they refuse to START after a change, and their results are judged by it.
    exec: (rawExec, command, args, options) => gatedExec(rawExec, command, args, options, since),
    hc: (rawHc, args, bytes) => gatedHc(rawHc, args, bytes, since),
    check: () => { refuse(); if (since !== generation) throw new GateRefusal(CONFIG_CHANGED); },
  };
}

/** `gatedOperation()` for a caller that has no place to catch the refusal where it starts (a view method): under a refused or unloaded config the
 *  operation exists and every request, process and check of it fails with that refusal, exactly as a plain gated call would. */
export function gatedOperationOrRefusal() {
  try { return gatedOperation(); }
  catch (error) {
    const fail = () => Promise.reject(error);
    return { since: -1, fetch: fail, exec: fail, hc: fail, check: () => { throw error; } };
  }
}

/** An event-stream connection. The socket it returns is closed if the config changed while it was being made. */
export async function gatedConnect(rawConnect, host, port) {
  refuse();
  const started = generation;
  let socket;
  try { socket = await rawConnect(host, port); }
  catch (error) { stillCurrent(started); throw error; } // a connect that fails after the settings changed failed for the old settings
  try { stillCurrent(started); } catch (error) { try { socket?.close?.(); } catch (_) {} throw error; }
  return socket;
}
/** For a `.catch` that swallows failures on purpose (a read that falls back to a default): a gate refusal is NOT a failure to swallow, it is the answer
 *  ("nothing was sent, here is why"), so it is rethrown and reaches whoever can tell the person. Other errors give `fallback` (a value or a function). */
export const rethrowGate = (fallback) => (error) => {
  if (error?.code === "GATE_REFUSED") throw error;
  return typeof fallback === "function" ? fallback(error) : fallback;
};
/** The line a refused argv hand-off (the attach relay's daemon address) gives. Callers that build an argv for another process call this first. */
export function assertMaySend() { refuse(); }

export { CONNECTIONS_LIST_REFUSED };
