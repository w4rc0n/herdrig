// The Attach relay: runs one seat's tmux client in a herdr terminal and reports the seat's state to herdr as OSC 7501
// escape sequences (working, blocked, idle, done, clear).
//
// Run as `node rig-attach-relay.cjs <base64 JSON payload>` by attachToSeat (rig-lib.js). The payload is data only:
// the session name, an optional tmux server flag pair, and what to show. The relay never runs a command string: it
// validates the session and the server flags again here and starts `tmux` directly with an argv (no shell). Polling
// the daemon reads the seat's state for the status dot; nothing it returns is executed.
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/** A tmux session name OpenRig can create (its validateSessionName charset), with no leading `-` or `@`, at most 200 chars.
 *  tmux also matches -t by prefix and glob; the charset has no `*`, `?`, `:` or space, and the relay targets `=<name>`. */
const SESSION_RE = /^[A-Za-z0-9._][A-Za-z0-9._@-]{0,199}$/;
/** A `tmux -L` socket name, and a `tmux -S` socket path (absolute, plain characters, no `..` segment). */
const SOCKET_NAME_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/;
const SOCKET_PATH_RE = /^\/[A-Za-z0-9._\/-]{1,255}$/;

function validSession(session) {
  return typeof session === "string" && SESSION_RE.test(session);
}

/** `[]`, `["-L", name]` or `["-S", path]`, each value checked; anything else is null (refused). */
function validServerArgs(args) {
  if (args === undefined || args === null) return [];
  if (!Array.isArray(args)) return null;
  if (args.length === 0) return [];
  if (args.length !== 2) return null;
  const [flag, value] = args;
  if (flag === "-L" && typeof value === "string" && SOCKET_NAME_RE.test(value)) return ["-L", value];
  if (flag === "-S" && typeof value === "string" && SOCKET_PATH_RE.test(value) && !value.split("/").includes("..")) return ["-S", value];
  return null;
}

/** The tmux client's argv: `[...server flags, "attach-session", "-t", "=<session>"]` (`=` targets that exact session). */
function tmuxArgv(session, serverArgs) {
  if (!validSession(session)) throw new Error(`refused: "${String(session)}" isn't a tmux session name OpenRig makes`);
  const server = validServerArgs(serverArgs);
  if (server === null) throw new Error("refused: the tmux server flags aren't -L <name> or -S <path>");
  return [...server, "attach-session", "-t", `=${session}`];
}

/**
 * The private tmux server beside the configured OpenRig home (`<dirname(openrigHome)>/tmux-<uid>/default`), for when
 * OpenRig's attach command names no server. `openrigHome` is the mod's own config on this machine, never the daemon's.
 * Every step is checked without following links: a real directory owned by this user, holding a socket owned by this
 * user. tmux refuses a socket directory others can read, so one that is gets 0700, through a no-follow handle.
 */
function localServerArgs(openrigHome, { uid = process.getuid?.() } = {}) {
  if (typeof openrigHome !== "string" || !SOCKET_PATH_RE.test(openrigHome) || openrigHome.split("/").includes("..")) return [];
  if (typeof uid !== "number") return [];
  const dir = path.join(path.dirname(openrigHome), `tmux-${uid}`);
  const sock = path.join(dir, "default");
  try {
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.uid !== uid) return [];
    const ss = fs.lstatSync(sock);
    if (!ss.isSocket() || ss.uid !== uid) return [];
    if ((st.mode & 0o077) !== 0) {
      const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      try { fs.fchmodSync(fd, 0o700); } finally { fs.closeSync(fd); }
    }
  } catch (_) {
    return [];
  }
  return SOCKET_PATH_RE.test(sock) ? ["-S", sock] : [];
}

/** Where terminfo lives (ncurses' search order, plus Homebrew's). */
function terminfoDirs(env) {
  return [env.TERMINFO, ...String(env.TERMINFO_DIRS || "").split(":"), env.HOME ? `${env.HOME}/.terminfo` : null,
    "/etc/terminfo", "/lib/terminfo", "/usr/share/terminfo", "/usr/lib/terminfo", "/usr/local/share/terminfo", "/opt/homebrew/share/terminfo"]
    .filter((d) => typeof d === "string" && d.startsWith("/"));
}

/** TERM for the tmux client: the inherited one when this machine has its terminfo, else xterm-256color. herdr passes its
 *  own (xterm-ghostty), and tmux refuses a terminal it can't describe ("missing or unsuitable terminal"). */
function termFor(term, { exists = fs.existsSync, dirs = terminfoDirs(process.env) } = {}) {
  const t = String(term || "");
  // `dumb` and `unknown` have terminfo entries, but tmux can't draw a client in them; some launchers pass one.
  if (!/^[A-Za-z0-9._+-]{1,64}$/.test(t) || t === "dumb" || t === "unknown") return "xterm-256color";
  const first = [t[0], t.charCodeAt(0).toString(16)];
  return dirs.some((d) => first.some((f) => exists(`${d}/${f}/${t}`))) ? t : "xterm-256color";
}

const cleanApp = (v) => String(v || "").replace(/[^A-Za-z0-9_.+\-,/=]/g, "").slice(0, 32);
const cleanB64 = (v) => String(v || "").replace(/[^A-Za-z0-9+/=]/g, "");

/** The OSC 7501 state for one daemon node (`/api/rigs/:id/nodes`), or clear when there is none. */
function mapNode(n) {
  if (!n) return { state: "clear" };
  const running = n.sessionStatus ? (n.sessionStatus === "running" || n.sessionStatus === "ready" || n.sessionStatus === "starting") : n.sessionAlive !== false;
  if (!running || n.sessionAlive === false) return { state: "done", clearAfter: true };
  if (n.nodeKind === "infrastructure" || n.runtime === "terminal") return { state: "clear" };
  const act = n.agentActivity?.state ?? n.activityState?.state;
  const disp = n.activityState?.display;
  const arb = n.arbitratedNeedsInput ?? n.activityState?.needsInput;
  const hasLiveActivity = Boolean(n.activityState && typeof n.activityState === "object");
  const needs = hasLiveActivity
    ? Boolean(act === "needs_input" || disp === "needs-input" || disp === "needs_input" || disp === "blocked" || (arb && (arb.count > 0 || arb.needed)))
    : Boolean(n.needsAttention || act === "needs_input" || (arb !== undefined && arb !== null ? (typeof arb === "object" ? (arb.count > 0 || Boolean(arb.needed)) : Boolean(arb)) : false) || n.lifecycleState === "attention_required" || n.lifecycleState === "failed" || n.blockedWorkCount > 0);
  if (needs) {
    const ev = String(arb?.kind ?? arb?.reason ?? n.needsInputEvidence?.kind ?? n.agentActivity?.reason ?? "").toLowerCase();
    const kind = ev.includes("perm") ? "permission" : ev.includes("auth") ? "auth" : "question";
    return { state: "blocked", kind };
  }
  if (act === "working" || act === "running" || disp === "working" || disp === "active") return { state: "working" };
  if (act === "done") return { state: "done" };
  if (act === "idle" || act === "starting" || disp === "idle") return { state: "idle" };
  return { state: n.inProgressWorkCount > 0 ? "working" : "idle" };
}

function main(payloadArg) {
  let cfg;
  try {
    cfg = JSON.parse(Buffer.from(String(payloadArg || ""), "base64").toString("utf8"));
  } catch (_) {
    process.stderr.write("rig-attach-relay: the payload isn't readable\n");
    return process.exit(2);
  }
  let argv;
  try {
    // OpenRig's own server flag when it named one; else the private server beside the configured OpenRig home.
    const named = validServerArgs(cfg.serverArgs);
    if (named && !named.length && typeof cfg.openrigHome === "string" && cfg.openrigHome && !SOCKET_PATH_RE.test(cfg.openrigHome)) {
      process.stderr.write("rig-attach-relay: openrigHome has a space or a character such as @, so the private tmux server beside it isn't looked up; using tmux's default server\n");
    }
    argv = tmuxArgv(cfg.session, named && named.length ? named : (named ? localServerArgs(cfg.openrigHome) : cfg.serverArgs));
  } catch (e) {
    process.stderr.write(`rig-attach-relay: ${e.message}\n`);
    return process.exit(2);
  }
  // A daemon URL is only ever fetched from, for state; a non-http(s) one is dropped.
  const daemonUrl = /^https?:\/\/[^\s/]+$/i.test(String(cfg.daemonUrl || "").replace(/\/+$/, "")) ? String(cfg.daemonUrl).replace(/\/+$/, "") : "";

  let lastSeq = "";
  const write = (seq) => {
    if (seq === lastSeq) return;
    lastSeq = seq;
    try { process.stdout.write(seq); } catch (_) {}
  };
  const emit = (st, kind) => {
    if (!st) return;
    if (st === "clear") return write("\x1b]7501;state=clear\x07");
    const parts = [`state=${st}`];
    if (st === "blocked" && (kind === "permission" || kind === "question" || kind === "auth")) parts.push(`kind=${kind}`);
    const app = cleanApp(cfg.app);
    if (app) parts.push(`app=${app}`);
    const title = cleanB64(cfg.titleB64);
    if (title) parts.push(`title=${title}`);
    write(`\x1b]7501;${parts.join(":")}\x07`);
  };
  emit(["working", "blocked", "idle", "done", "clear"].includes(cfg.initialState) ? cfg.initialState : "idle");

  const listOf = (d) => (Array.isArray(d) ? d : (Array.isArray(d?.nodes) ? d.nodes : []));
  // The rig's id, else its name (the daemon takes either in /api/rigs/:id/nodes); a name it refuses is looked up in the
  // summary once. What comes back is only read for the seat's state.
  let rigId = String(cfg.rigId || cfg.rig || "");
  const fetchNodes = async () => {
    if (!daemonUrl || !rigId) return null;
    const r = await fetch(`${daemonUrl}/api/rigs/${encodeURIComponent(rigId)}/nodes`);
    if (r.ok) return listOf(await r.json());
    if (cfg.rig && rigId === cfg.rig) {
      const sr = await fetch(`${daemonUrl}/api/rigs/summary`);
      const list = sr.ok ? await sr.json() : null;
      const hit = Array.isArray(list) ? list.find((x) => x && (x.name === cfg.rig || x.id === cfg.rig)) : null;
      if (hit && typeof hit.id === "string" && hit.id !== rigId) {
        rigId = hit.id;
        const r2 = await fetch(`${daemonUrl}/api/rigs/${encodeURIComponent(rigId)}/nodes`);
        if (r2.ok) return listOf(await r2.json());
      }
    }
    return null;
  };
  const poll = async () => {
    try {
      const nodes = await fetchNodes();
      if (!Array.isArray(nodes)) return;
      // The seat is found by its exact session name, and only its state is read.
      const hit = nodes.find((n) => n && n.canonicalSessionName === cfg.session);
      if (!hit) return;
      const mapped = mapNode(hit);
      if (mapped.clearAfter) {
        if (lastSeq !== "done:clear") { emit(mapped.state, mapped.kind); emit("clear"); lastSeq = "done:clear"; }
      } else emit(mapped.state, mapped.kind);
    } catch (_) {}
  };
  void poll();
  const timer = setInterval(poll, Number(cfg.pollIntervalMs) > 0 ? Number(cfg.pollIntervalMs) : 1500);
  timer.unref?.();

  const childEnv = { ...process.env };
  delete childEnv.TMUX;
  childEnv.TERM = termFor(childEnv.TERM);
  const child = spawn("tmux", argv, { stdio: "inherit", env: childEnv, shell: false });
  const cleanup = () => { clearInterval(timer); emit("clear"); };
  child.on("error", (e) => { process.stderr.write(`rig-attach-relay: tmux didn't start (${e.message})\n`); cleanup(); process.exit(1); });
  child.on("exit", (code) => { cleanup(); process.exit(code ?? 0); });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { cleanup(); try { child.kill(sig); } catch (_) {} });
}

module.exports = { SESSION_RE, validSession, validServerArgs, tmuxArgv, mapNode, termFor, localServerArgs };
if (require.main === module) main(process.argv[2]);
