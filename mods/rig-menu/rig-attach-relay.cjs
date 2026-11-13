// The Attach relay: runs one seat's tmux client in a herdr terminal and reports the seat's state to herdr as OSC 7501
// escape sequences (working, blocked, idle, done, clear).
//
// Run as `node rig-attach-relay.cjs <base64 JSON payload>` by attachToSeat (rig-lib.js). The payload is data only:
// the session name, an optional tmux server flag pair, and what to show. The relay never runs a command string: it
// validates the session and the server flags again here and starts `tmux` directly with an argv (no shell). Polling
// the daemon reads the seat's state for the status dot; nothing it returns is executed.
// An explicit grid mode uses the shared sizing viewer below, without OSC or daemon requests. No other mode is accepted.
// Encoded payloads must be canonical base64 containing a UTF-8 JSON object, at most 16 KiB decoded.
"use strict";
const { spawn, spawnSync } = require("node:child_process");
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
  let fd;
  try {
    fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    const st = fs.fstatSync(fd);
    if (!st.isDirectory() || st.uid !== uid) return [];
    if ((st.mode & 0o077) !== 0) fs.fchmodSync(fd, 0o700);
    const ss = fs.lstatSync(sock);
    if (!ss.isSocket() || ss.uid !== uid) return [];
  } catch (_) {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
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

/** Only a local HTTP(S) origin may supply relay state; validate again at the process boundary. */
function relayDaemonUrl(value) {
  if (typeof value !== "string") return "";
  const m = /^(https?):\/\/(localhost|\[::1\]|0\.0\.0\.0|127\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::(\d{1,5}))?\/?$/i.exec(value.trim());
  if (!m) return "";
  const scheme = m[1].toLowerCase(), host = m[2].toLowerCase(), port = m[3] == null ? null : Number(m[3]);
  if (host.startsWith("127.") && host.split(".").some((part) => Number(part) > 255 || String(Number(part)) !== part)) return "";
  if (port !== null && (port < 1 || port > 65535)) return "";
  return `${scheme}://${host}${port !== null && port !== (scheme === "https" ? 443 : 80) ? `:${port}` : ""}`;
}

/** The OSC 7501 state for one daemon node (`/api/rigs/:id/nodes`), or clear when there is none. */
function mapNode(n) {
  if (!n) return { state: "clear" };
  const running = n.sessionStatus ? (n.sessionStatus === "running" || n.sessionStatus === "ready" || n.sessionStatus === "starting") : n.sessionAlive !== false;
  if (!running || n.sessionAlive === false) return { state: "done", clearAfter: true };
  if (n.nodeKind === "infrastructure" || n.runtime === "terminal") return { state: "clear" };
  const act = n.activityState?.activity ?? n.activityState?.state ?? (n.needsAttention !== false ? n.agentActivity?.state : null);
  const disp = n.activityState?.display;
  const arb = n.arbitratedNeedsInput ?? n.activityState?.needsInput;
  const arbitrated = arb != null ? (typeof arb === "object" ? arb.count > 0 || Boolean(arb.needed) : Boolean(arb)) : null;
  const needs = n.startupStatus === "failed" || n.needsAttention === true ||
    (n.needsAttention == null && (n.startupStatus === "attention_required" || n.lifecycleState === "attention_required" || n.lifecycleState === "failed")) ||
    disp === "blocked" ||
    (n.needsAttention !== false && arbitrated !== false &&
      (arbitrated || act === "needs_input" || disp === "needs-input" || disp === "needs_input" ||
        (!n.activityState && n.blockedWorkCount > 0)));
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

function tmuxFailureMessage(session) {
  return `Couldn't open ${session}'s tmux session here. Check that the seat is running (rig ps) and that this account can open OpenRig's tmux.\n`;
}
const MAX_PAYLOAD_BYTES = 16384;
function decodeRelayPayload(value) {
  if (typeof value !== "string" || !value || value.length > 4 * Math.ceil(MAX_PAYLOAD_BYTES / 3)) throw new Error("payload is missing or too large");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > MAX_PAYLOAD_BYTES || bytes.toString("base64") !== value) throw new Error("payload is not canonical base64");
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error("payload is not UTF-8");
  const cfg = JSON.parse(text);
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error("payload is not an object");
  if (Object.hasOwn(cfg, "mode") && cfg.mode !== "grid") throw new Error("unsupported relay mode");
  if(cfg.mode==="grid"&&Object.hasOwn(cfg,"readOnly")&&typeof cfg.readOnly!=="boolean")throw new Error("readOnly must be a boolean");
  if(cfg.mode==="grid"&&Object.hasOwn(cfg,"title")&&typeof cfg.title!=="string")throw new Error("title must be text");
  return cfg;
}
function main(payloadArg) {
  let cfg;
  try {
    cfg = decodeRelayPayload(payloadArg);
  } catch (_) {
    process.stderr.write("rig-attach-relay: the payload isn't readable\n");
    return process.exit(2);
  }
  if (cfg.mode === "grid") return gridMain(payloadArg);
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
  const daemonUrl = relayDaemonUrl(cfg.daemonUrl);
  // Some tmux versions exit zero when the parent directory of -S is missing.
  if (argv[0] === "-S" && !fs.existsSync(argv[1])) {
    process.stderr.write(tmuxFailureMessage(cfg.session));
    return process.exit(1);
  }

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
  child.on("error", (e) => { process.stderr.write(`rig-attach-relay: tmux didn't start (${e.message})\n${tmuxFailureMessage(cfg.session)}`); cleanup(); process.exit(1); });
  child.on("exit", (code) => { if (code) process.stderr.write("Attach viewer ended. Close this tab, then Attach again if needed.\n"); cleanup(); process.exit(code ?? 0); });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { cleanup(); try { child.kill(sig); } catch (_) {} });
}

// Grid mode shares the local viewer implementation; it has no OSC or daemon polling.
function ignoreSizeArgs(version) {
  const match = /^tmux (\d+)\.(\d+)(?:[a-z]|\b)/.exec(String(version ?? "").trim());
  return match && (+match[1] > 3 || +match[1] === 3 && +match[2] >= 2) ? ["-f", "ignore-size"] : [];
}
const SIZING_INTERVAL_MS = 5000;
// tmux replaces control characters in format output; use printable separators.
const CLIENT_FORMAT = "#{client_pid}|#{client_tty}|#{client_flags}";
const runTmux = args => new Promise((resolve,reject)=>{
  const env={...process.env};delete env.TMUX;
  const command=spawn("tmux",args,{stdio:["ignore","pipe","pipe"],shell:false,env});
  let stdout="",stderr="",settled=false;
  const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve({stdout});};
  const timer=setTimeout(()=>{command.kill("SIGKILL");finish(new Error("tmux metadata timed out"));},1000);
  command.stdout.on("data",data=>{stdout+=data;if(stdout.length>65536){command.kill("SIGKILL");finish(new Error("tmux metadata too large"));}});
  command.stderr.on("data",data=>{stderr=(stderr+data).slice(0,4096);});
  command.on("error",finish);command.on("close",code=>finish(code===0?null:new Error(stderr||"tmux metadata failed")));
});
function sizingClients(stdout) {
  return String(stdout ?? "").trim().split("\n").flatMap(line => {
    const [pid,tty,flags] = line.split("|");
    return /^[1-9][0-9]*$/.test(pid) && /^\/dev\/(?:pts\/[0-9]+|tty[a-zA-Z0-9]+)$/.test(tty ?? "")
      ? [{pid:Number(pid),tty,ignore:String(flags ?? "").split(",").includes("ignore-size")}] : [];
  });
}
function sizingChange(stdout, ownPid) {
  const clients=sizingClients(stdout), own=clients.find(c=>c.pid===ownPid);
  if(!own)return null;
  const ignore=clients.some(c=>c.pid!==ownPid&&!c.ignore);
  return own.ignore===ignore?null:{tty:own.tty,ignore};
}
function viewerArgs(cfg, version, clients = "") {
  if(Object.hasOwn(cfg,"readOnly")&&typeof cfg.readOnly!=="boolean")throw new Error("readOnly must be a boolean");
  const named = validServerArgs(cfg.serverArgs);
  const argv = tmuxArgv(cfg.session, named && named.length ? named : (named ? localServerArgs(cfg.openrigHome) : cfg.serverArgs));
  if(cfg.readOnly===true)argv.splice(argv.indexOf("attach-session")+1,0,"-r");
  if(sizingClients(clients).some(c=>!c.ignore))argv.splice(argv.indexOf("attach-session") + 1, 0, ...ignoreSizeArgs(version));
  return argv;
}
async function gridMain(payload) {
  let argv, cfg, child, parked = false;
  try { cfg = decodeRelayPayload(payload); }
  catch (e) { process.stderr.write(`Rig grid: ${e.message}\n`); process.exitCode = 2; return; }
  // Remote grids accept checked session/server flags, an explicit read-only bit and a display title only.
  if (cfg.mode === "grid") cfg = { session: cfg.session, serverArgs: cfg.serverArgs,
    ...(Object.hasOwn(cfg,"readOnly")?{readOnly:cfg.readOnly}:{}),
    title:String(cfg.title??"").replace(/[\u0000-\u001f\u007f-\u009f]/g," ").slice(0,256) };
  let sizingTimer, resizeTimer, sizingBusy=false, sizingSupported=false;
  // Herdr keeps adopted terminals: exiting would replace this viewer with an interactive shell.
  // Keep an inert notice instead, including when stdin is closed or the tmux client exits successfully.
  const park = (message) => {
    if (parked) return; parked = true;
    clearInterval(sizingTimer);clearTimeout(resizeTimer);
    process.stderr.write(`${message.trimEnd()}\nClose this pane, then reopen the rig space to retry.\n`);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.pause();
    setInterval(() => {}, 2147483647);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => {
    try { child?.kill(sig); } catch (_) {}
    process.exit(0);
  });
  try {
    argv = viewerArgs(cfg, null); // Validate before probing anything.
    // One bounded startup probe (up to 3 s), never repeated by the sizing timer.
    const version = spawnSync("tmux", ["-V"], { encoding: "utf8", timeout: 3000, shell: false });
    const value=version.status===0?version.stdout:null;sizingSupported=ignoreSizeArgs(value).length>0;
    let clients="";
    if(sizingSupported){try{clients=(await runTmux([...argv.slice(0,argv.indexOf("attach-session")),"list-clients","-t",`=${cfg.session}`,"-F",CLIENT_FORMAT])).stdout;}catch{}}
    argv = viewerArgs(cfg, value, clients);
  }
  catch (e) { park(`Rig grid: ${e.message}`); return; }
  if (argv[0] === "-S" && !fs.existsSync(argv[1])) {
    park(tmuxFailureMessage(cfg.session)); return;
  }
  const env = { ...process.env }; delete env.TMUX; env.TERM = termFor(env.TERM);
  if(cfg.title)process.stdout.write(`\x1b]0;${cfg.title}\x07`);
  child = spawn("tmux", argv, { stdio: "inherit", env, shell: false });
  // Only this wrapper's child PID is eligible. Its inherited tty remains held by
  // this live wrapper, and tmux targets client tty names exactly (no prefix match).
  const server=argv.slice(0,argv.indexOf("attach-session"));
  let sizingError=false,lastSizingAt=0;
  const reconcile=async()=>{
    if(sizingBusy||parked||child.exitCode!==null||Date.now()-lastSizingAt<1000)return;
    sizingBusy=true;lastSizingAt=Date.now();
    try{
      const result=await runTmux([...server,"list-clients","-t",`=${cfg.session}`,"-F",CLIENT_FORMAT]);
      const change=sizingChange(result.stdout,child.pid);
      if(change&&!parked&&child.exitCode===null)await runTmux([...server,"refresh-client","-t",change.tty,"-f",change.ignore?"ignore-size":"!ignore-size"]);
      sizingError=false;
    }catch{
      if(!sizingError&&!parked){process.stderr.write("Grid sizing could not be refreshed; reopen this tile to retry.\n");sizingError=true;}
    }finally{sizingBusy=false;}
  };
  if(sizingSupported){
    sizingTimer=setInterval(reconcile,SIZING_INTERVAL_MS);
    process.on("SIGWINCH",()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(reconcile,250);});
  }
  child.on("error", (e) => park(`Rig grid: tmux did not start (${e.message})\n${tmuxFailureMessage(cfg.session)}`));
  child.on("exit", (code) => park(code ? tmuxFailureMessage(cfg.session) : `The viewer for ${cfg.session} ended. Its tmux session may have stopped.`));
}
module.exports = { SESSION_RE, validSession, validServerArgs, tmuxArgv, mapNode, termFor, localServerArgs, relayDaemonUrl, tmuxFailureMessage, decodeRelayPayload, MAX_PAYLOAD_BYTES, gridMain, viewerArgs, ignoreSizeArgs, sizingClients, sizingChange, SIZING_INTERVAL_MS };
if (require.main === module) main(process.argv[2]);
