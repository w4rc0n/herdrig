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
export const CONFIG_CHANGED = "OpenRig's settings changed while this was running, so its answer was not used.";

export class GateRefusal extends Error {
  constructor(message) { super(message); this.name = "GateRefusal"; this.code = "GATE_REFUSED"; }
}

/** Commands that are not the OpenRig CLI and talk to no daemon: local read utilities a refused or unloaded config may still run. Everything else
 *  (`env`, which carries the rig CLI, `rig`, `node` running it) is refused. Listed by name so a new one is a decision, not an accident. */
export const NON_DAEMON_COMMANDS = Object.freeze(["false", "git", "printenv", "realpath", "tmux", "which"]);
let current; // undefined: never observed (unloaded). Otherwise the last non-null config.
let generation = 0, identityKey = null;

// What makes a config a different one for the requests already in flight: the list refusal, the connection, the address the FILE names (an address
// the CLI found is not a change), the machine and the OpenRig home.
const identity = (config) => JSON.stringify([config.connectionsRefused ?? null, config.connectionId ?? null,
  config.daemonUrlSource === "cli" ? "cli" : (config.daemonUrl ?? null), config.daemonMachine ?? null, config.openrigHome ?? null]);

/** Called by every assignment of a mod's `config`. Null and undefined are ignored (a constructor's placeholder is not a config). */
export function observeConfig(config) {
  if (config === null || config === undefined || typeof config !== "object") return;
  current = config;
  const key = identity(config);
  if (key !== identityKey) { identityKey = key; generation++; }
}
/** Test seam only: forgets everything (a fresh module). */
export function resetGate() { current = undefined; generation = 0; identityKey = null; }
export const gateGeneration = () => generation;
/** Why nothing may be sent now, or null: the list line, or "still loading" for a mod that has never been given a config. */
export function gateRefusal() {
  if (current === undefined) return CONFIG_LOADING;
  if (current.connectionsRefused) return current.connectionsRefused;
  return null;
}
const refuse = () => { const reason = gateRefusal(); if (reason) throw new GateRefusal(reason); };
// After an await: the answer belongs to the config it was asked under.
const stillCurrent = (started) => { refuse(); if (started !== generation) throw new GateRefusal(CONFIG_CHANGED); };

const basename = (command) => String(command ?? "").split("/").pop();

/** An HTTP request. The body of the answer is read under the same check, so a list that arrives while it is read still drops it. */
export async function gatedFetch(url, init) {
  refuse();
  const started = generation;
  const response = await globalThis.fetch(url, init);
  stillCurrent(started);
  return new Proxy(response, {
    get(target, prop) {
      if (prop === "json" || prop === "text" || prop === "arrayBuffer" || prop === "blob") {
        return async (...args) => { const value = await target[prop](...args); stillCurrent(started); return value; };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** A process run for the mod (the OpenRig CLI is `env ... rig ...`). Under a refused or unloaded config only the listed local utilities run. */
export async function gatedExec(rawExec, command, args, options) {
  const local = NON_DAEMON_COMMANDS.includes(basename(command));
  if (!local) refuse();
  const started = generation;
  const result = await rawExec(command, args, options);
  if (!local) stillCurrent(started);
  return result;
}

/** A Herdr command. Verbs that only drive Herdr itself (ls, get, label, space, tab, pane, machine...) send nothing to a daemon and start no process:
 *  they pass. `run` and `exec` start a process (a TUI, an attach relay, a spec helper), so under a refused or unloaded config they are refused. */
export const PROCESS_VERBS = Object.freeze(["run", "exec", "file"]); // `file` writes on another machine
export async function gatedHc(rawHc, args, bytes) {
  const verb = Array.isArray(args) ? args[0] : null;
  if (!PROCESS_VERBS.includes(verb)) return rawHc(args, bytes);
  refuse();
  const started = generation;
  const result = await rawHc(args, bytes);
  // The process was started under the config that is gone. It cannot be un-started, but nothing may ACT on it (select its tab, label it, report
  // success): the caller gets the refusal, as for every other gated sink.
  stillCurrent(started);
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

/** An event-stream connection. The socket it returns is closed if the config changed while it was being made. */
export async function gatedConnect(rawConnect, host, port) {
  refuse();
  const started = generation;
  const socket = await rawConnect(host, port);
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
