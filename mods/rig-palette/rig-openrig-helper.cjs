"use strict";
// Runs ON a Herdr machine, started once per request by `hc exec --on <machine>`, so herdrig can reach that machine's own OpenRig over
// Herdr's connection instead of a tunnel. It is a narrow client of the daemon on that machine:
// - the address comes only from that machine's own OpenRig, through its public `rig status --json`, and is always loopback; redirects are not followed;
// - only GET and POST, only /api/... and /healthz paths, checked again as the URL that will really be requested (no scheme, host, dot segment,
//   encoded dot, slash or backslash, "//" or control character);
// - before a write or a poll, the daemon's selfHostId must be the one the caller expects, or nothing is sent; every answer names it;
// - an answer too large for Herdr's exec output is refused, never cut short;
// - a POST body arrives on stdin (never in argv) and its sha256 comes back, so the caller can check what arrived.
// The daemon's HTTP API takes no credential from herdrig; nothing secret passes through here.
// Usage: node rig-openrig-helper.cjs get <host-id|-> <path>...             (1 to 16 paths, read in order; "-" only to learn the host id)
//        node rig-openrig-helper.cjs post <host-id> <path> <content-type>  (body on stdin)
//        node rig-openrig-helper.cjs events <host-id> <cursor|-> <wait-ms> (long-poll; "-" anchors at the newest stored event: `anchor` says how)
//        node rig-openrig-helper.cjs rig <host-id> <shape> <person|-> <value>...  (a write: the rig CLI on this machine, argv built here from a fixed table)
// A port that answered as the expected host is kept beside this file, so most requests don't start the rig CLI.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), { spawn } = require("node:child_process");

const MAX_OUTPUT = 5 * 1024 * 1024; // bytes. Herdr's exec output is capped at 8 MiB, base64-encoded (about 6 MiB of bytes), with room for its wrapper
const MAX_BODY = 1024 * 1024;
const MAX_PATHS = 16;
const PATH_OK = /^\/(?:api\/[A-Za-z0-9._~\-\/?=&%:,+]*|healthz)$/;
const HOST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const CURSOR = /^[A-Za-z0-9._:-]{1,64}$/;
const ANCHOR_QUIET_MS = 500; // after the stream's headers: the newest stored event is replayed at once, so silence means an empty log
const PORT_FILE = path.join(__dirname, "rig-openrig-port.json");
const bytes = (text) => Buffer.byteLength(String(text), "utf8");

function fail(message, extra = {}) { return { ok: false, error: String(message).replace(/[\r\n\x00-\x1f\x7f]+/g, " "), ...extra }; }

function checkPath(p) {
  if (typeof p !== "string" || !PATH_OK.test(p) || p.includes("..") || p.includes("//") || p.includes("\\") || /%(?:2e|2f|5c)/i.test(p)) throw Error(`Refused path: ${String(p).slice(0, 80)}`);
  return p;
}
/** The URL that will really be requested, which must be exactly the checked path on the local daemon (fetch normalizes before sending). */
function requestUrl(base, p) {
  checkPath(p);
  const u = new URL(base + p);
  if (u.origin !== base || !(u.pathname.startsWith("/api/") || u.pathname === "/healthz") || u.pathname + u.search !== p) throw Error(`Refused path: ${p.slice(0, 80)}`);
  return u.href;
}

/** The machine's own OpenRig, as its public `rig status --json` reports it. The daemon is always reached on loopback, at the port it reports. */
function statusBase(env) {
  return new Promise((resolve, reject) => {
    let stdout = "", settled = false;
    const done = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
    const child = spawn("rig", ["status", "--json"], { env, stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); done(reject, Error("rig status on this machine didn't answer.")); }, 15000);
    child.stdout.on("data", (c) => { if (stdout.length < 1024 * 1024) stdout += c; });
    child.on("error", (e) => done(reject, Error(e?.code === "ENOENT" ? "The rig command isn't on this machine's PATH." : `rig status failed on this machine: ${e?.message ?? e}`)));
    child.on("close", () => {
      let d = null;
      try { d = JSON.parse(stdout).daemon; } catch { d = null; }
      if (!d || typeof d !== "object" || d.reachable !== true || d.healthy === false) return done(reject, Error("OpenRig isn't running on this machine (rig status reports no reachable daemon)."));
      const port = Number(d.port);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) return done(reject, Error("rig status on this machine reports no valid daemon port."));
      done(resolve, `http://127.0.0.1:${port}`);
    });
  });
}

function readPortFile() {
  let fd;
  try {
    fd = fs.openSync(PORT_FILE, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o077) !== 0 || st.size > 256) return null;
    const port = Number(JSON.parse(fs.readFileSync(fd, "utf8")).port);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function writePortFile(port) {
  const tmp = `${PORT_FILE}.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
  try {
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeSync(fd, JSON.stringify({ port })); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, PORT_FILE);
  } catch { try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ } } // a cache only: a failure costs a rig status next time
}

/** The daemon's selfHostId, or null when /healthz doesn't answer with one. */
async function hostId(base) {
  try { const r = await fetch(base + "/healthz", { redirect: "manual", signal: AbortSignal.timeout(5000) }); if (r.status !== 200) return null; const j = await r.json(); return typeof j?.selfHostId === "string" ? j.selfHostId : null; } catch { return null; }
}

/** The local daemon and its host id. With an expected id, a kept port that answers as that host is used without starting the rig CLI,
 *  and the daemon `rig status` reports must answer as that host, or nothing is sent. */
async function locate(expected, env) {
  if (expected !== null) {
    const kept = readPortFile();
    if (kept !== null) { const base = `http://127.0.0.1:${kept}`; if (await hostId(base) === expected) return { base, id: expected }; }
  }
  const base = await statusBase(env), id = await hostId(base);
  if (id === null) throw Object.assign(Error("OpenRig on this machine isn't answering (no host id from /healthz). Nothing was sent."), { extra: { hostId: null } });
  if (expected !== null && id !== expected) throw Object.assign(Error("OpenRig on this machine is a different one than expected. Nothing was sent."), { extra: { wrongHost: true, hostId: id } });
  if (expected !== null) writePortFile(Number(new URL(base).port));
  return { base, id };
}

async function request(base, method, p, init = {}) {
  const r = await fetch(requestUrl(base, p), { method, redirect: "manual", ...init });
  if (r.status >= 300 && r.status < 400) return { path: p, status: r.status, error: "redirect refused" };
  const text = await r.text();
  if (bytes(text) > MAX_OUTPUT) return { path: p, status: r.status, tooLarge: true, error: "This answer is too large for Herdr's connection; ask for less." };
  return { path: p, status: r.status, body: text };
}

async function readStdin(limit) {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) { size += chunk.length; if (size > limit) throw Error("The request body is too large."); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

/** Reads one SSE stream, calling `onEvent({id, data})` per complete event, until `signal` aborts or the stream ends. Returns the status. */
async function readStream(url, headers, signal, onEvent, onOpen = () => {}) {
  const r = await fetch(url, { signal, redirect: "manual", headers: { accept: "text/event-stream", ...headers } });
  if (r.status !== 200 || !r.body) return r.status;
  onOpen();
  const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      let id = null; const data = [];
      for (const line of block.split("\n")) { if (line.startsWith("id:")) id = line.slice(3).trim(); else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, "")); }
      if (data.length) onEvent({ id, data: data.join("\n") });
    }
  }
  return 200;
}
const aborted = (e) => e?.name === "AbortError" || e?.name === "TimeoutError";

/** Where a first poll starts, so a quiet first poll still leaves a cursor and nothing stored after it is lost. The newest stored event
 *  itself is not delivered: it happened before this caller started listening.
 *  - OpenRig's attention read names the newest stored seq (`watermark`): an exact anchor.
 *  - A daemon without it: the newest stored event, from replay=1 (exact when one comes back). With no event within a short window after the
 *    stream's headers, the log is taken as empty and the anchor is 0. That last case is a guess, and the answer says so. */
async function anchor(base, wait) {
  try {
    const r = await fetch(base + "/api/attention", { redirect: "manual", signal: AbortSignal.timeout(Math.min(wait, 5000)) });
    if (r.status === 200) { const w = (await r.json())?.watermark; if (Number.isSafeInteger(w) && w >= 0) return { status: 200, cursor: String(w), anchor: "watermark" }; }
    else await r.body?.cancel();
  } catch (e) { if (!aborted(e) && !(e instanceof SyntaxError)) throw e; }
  const ac = new AbortController(); let id = null, quiet = null;
  const limit = setTimeout(() => ac.abort(), wait);
  try {
    const status = await readStream(base + "/api/events?replay=1", {}, ac.signal, (e) => { if (e.id !== null) { id = e.id; ac.abort(); } },
      () => { quiet = setTimeout(() => ac.abort(), ANCHOR_QUIET_MS); });
    if (status !== 200) return { status };
  } catch (e) { if (!aborted(e)) throw e; } finally { clearTimeout(limit); if (quiet) clearTimeout(quiet); }
  if (id !== null) return { status: 200, cursor: id, anchor: "newest-event" };
  return quiet !== null ? { status: 200, cursor: "0", anchor: "guess" } : { status: 0 }; // no headers in time is a failure, never an empty log
}

/** The events after `cursor` until the first ones arrive (plus a short window to gather a burst) or `waitMs`. Returns the last id seen. */
async function events(base, cursor, waitMs) {
  const wait = Math.max(1000, Math.min(Number(waitMs) || 25000, 30000)), started = Date.now();
  let resume = cursor && cursor !== "-" ? String(cursor) : null;
  if (resume !== null && !CURSOR.test(resume)) throw Error("Invalid event cursor.");
  let anchored = null;
  if (resume === null) {
    const a = await anchor(base, Math.min(wait, 5000));
    if (a.status !== 200) return fail(a.status ? `OpenRig's event stream answered ${a.status}.` : "OpenRig's event stream didn't answer.", { status: a.status });
    resume = a.cursor; anchored = a.anchor;
  }
  const ac = new AbortController(), got = []; let last = resume, size = 0, gather = null, tooLarge = false;
  const timer = setTimeout(() => ac.abort(), Math.max(200, wait - (Date.now() - started)));
  let status = 200;
  try {
    status = await readStream(base + "/api/events", { "last-event-id": resume }, ac.signal, (e) => {
      size += bytes(e.data);
      if (size > MAX_OUTPUT) { tooLarge = true; ac.abort(); return; }
      got.push(e); if (e.id !== null) last = e.id;
      if (!gather) gather = setTimeout(() => ac.abort(), 200);
    });
  } catch (e) { if (!aborted(e)) throw e; } finally { clearTimeout(timer); if (gather) clearTimeout(gather); }
  // A refused stream (an older daemon has none) is an error, so the caller backs off instead of polling again at once.
  if (status !== 200) return fail(`OpenRig's event stream answered ${status}.`, { status, cursor: resume });
  if (tooLarge && !got.length) return fail("The next event is too large for Herdr's connection.", { tooLarge: true, cursor: resume });
  return { ok: true, status: 200, events: got, cursor: last, ...(anchored ? { anchor: anchored } : {}) };
}

// Writes. The rig CLI runs here, against the OpenRig just checked (OPENRIG_URL is that loopback address), authenticating from its own home as a
// local run does. The caller names a SHAPE and its values; the argv is built here from this table, with every value checked in its slot, so no
// caller argv is ever passed through. Every value from outside goes after "--" or in an option's own slot (checked not to start with "-"), and the
// person's text goes after "--" (send) or on stdin (queue body). Gateway writes put their options first, then "--" and the id (the CLI accepts it).
const ONE_LINE = (max) => (v) => typeof v === "string" && v.length > 0 && v.length <= max && !/[\r\n\x00-\x1f\x7f]/.test(v) && !v.startsWith("-");
const V = {
  session: (v) => /^[A-Za-z0-9._][A-Za-z0-9._@-]{0,199}$/.test(v),
  rig: (v) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v),
  id: (v) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(v),
  seat: (v) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}@[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v),
  path: (v) => typeof v === "string" && v.startsWith("/") && v !== "/" && v.length <= 4096 && !/[\x00-\x1f\x7f]/.test(v),
  source: (v) => typeof v === "string" && v.length > 0 && v.length <= 4096 && !/[\x00-\x1f\x7f]/.test(v) && !v.startsWith("-"),
  name: (v) => v === "" || /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v),
  runtime: (v) => /^[a-z][a-z0-9-]{0,31}$/.test(v),
  iso: (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(v),
  isoOrNone: (v) => v === "" || V.iso(v),
  daily: (v) => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(v),
  mode: (v) => /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(v),
  summary: ONE_LINE(200),
  reason: ONE_LINE(200),
  text: (v) => typeof v === "string" && v.length > 0 && Buffer.byteLength(v, "utf8") <= 32 * 1024,
};
const FOCUS_ROOM = "Proceed on reversible routine work; escalate irreversible or prod-affecting changes.";
/** shape: { slots: validators in order, gateway: an `--actor <person>` write (person required), stdin: the queue body, build(values, person) }. */
const RIG_SHAPES = Object.freeze({
  send: { slots: [V.session, V.text], build: ([s, t]) => ["send", "--json", "--", s, t] },
  "queue-create": { slots: [V.session, V.summary], stdin: true, build: ([s, sum]) => ["queue", "create", "--destination", s, "--summary", sum, "--body", "-", "--json"] },
  pause: { slots: [V.rig], build: ([r]) => ["down", "--yes", "--json", "--", r] },
  resume: { slots: [V.rig], build: ([r]) => ["up", "--existing", "--json", "--", r] },
  delete: { slots: [V.rig], build: ([r]) => ["down", "--delete", "--yes", "--json", "--", r] },
  archive: { slots: [V.rig], build: ([r]) => ["archive", "--json", "--", r] },
  unarchive: { slots: [V.id], build: ([id]) => ["unarchive", "--json", "--", id] },
  snapshot: { slots: [V.rig], build: ([r]) => ["snapshot", "--", r] },
  fresh: { slots: [V.seat, V.reason], build: ([seat, why]) => ["seat", "launch", "--fresh", "--reason", why, "--json", "--", seat] },
  "launch-spec": { slots: [V.path, V.name, V.source], build: ([cwd, n, src]) => ["up", "--cwd", cwd, ...(n ? ["--name", n] : []), "--yes", "--json", "--", src] },
  "new-rig": { slots: [V.path, V.name, V.source], build: ([cwd, n, src]) => ["up", "--cwd", cwd, ...(n ? ["--name", n] : []), "--yes", "--json", "--", src] },
  "create-rig": { slots: [V.runtime, V.path, V.rig], build: ([rt, cwd, n]) => ["create", "--runtime", rt, "--cwd", cwd, "--json", "--", n] },
  "quiet-set-until": { slots: [V.id, V.iso], gateway: true, build: ([id, until], p) => ["gateway", "human", "quiet", "set", "--until", until, "--actor", p, "--json", "--", id] },
  "quiet-set-daily": { slots: [V.id, V.daily], gateway: true, build: ([id, d], p) => ["gateway", "human", "quiet", "set", "--daily", d, "--actor", p, "--json", "--", id] },
  "quiet-end": { slots: [V.id], gateway: true, build: ([id], p) => ["gateway", "human", "quiet", "end", "--actor", p, "--json", "--", id] },
  "quiet-clear": { slots: [V.id], gateway: true, build: ([id], p) => ["gateway", "human", "quiet", "clear", "--actor", p, "--json", "--", id] },
  "mode-end": { slots: [V.id], gateway: true, build: ([id], p) => ["gateway", "human", "mode", "end", "--actor", p, "--json", "--", id] },
  "mode-apply": { slots: [V.id, V.mode, V.isoOrNone], gateway: true, build: ([id, m, until], p) => ["gateway", "human", "mode", "apply", ...(until ? ["--until", until] : []), "--actor", p, "--json", "--", id, m] },
  "mode-save-sleep": { slots: [V.id], gateway: true, build: ([id], p) => ["gateway", "human", "mode", "save", "--availability", "off", "--quiet", "22:00-08:00", "--actor", p, "--json", "--", id, "sleep"] },
  "mode-save-focus": { slots: [V.id], gateway: true, build: ([id], p) => ["gateway", "human", "mode", "save", "--availability", "focus", "--expected-back", "in 2h", "--quiet", "until-end", "--decision-room", FOCUS_ROOM, "--actor", p, "--json", "--", id, "focus"] },
});
const PERSON = /^[^@\s-][^@\s]*@external$/;
const RIG_STDOUT_MAX = 1024 * 1024, RIG_KILL_MS = 170000;

/** The argv and child env for a write, or throws: an unknown shape, a wrong count, a value failing its slot, a gateway write with no person. */
function rigCommand(shape, person, values, base, env) {
  const spec = Object.prototype.hasOwnProperty.call(RIG_SHAPES, shape) ? RIG_SHAPES[shape] : null;
  if (!spec) throw Error("Unknown OpenRig write.");
  if (person !== "-" && !PERSON.test(person ?? "")) throw Error("Invalid person for the write.");
  if (spec.gateway && person === "-") throw Error("This write needs your OpenRig name.");
  if (values.length !== spec.slots.length || !spec.slots.every((ok, i) => ok(values[i]))) throw Error(`Invalid value for the OpenRig write ${shape}.`);
  // OPENRIG_HOME, when the helper has one, goes too: locate() asked `rig status` with it, so the CLI uses the same home as the OpenRig just checked.
  const childEnv = { HOME: env.HOME ?? "", PATH: env.PATH ?? "", ...(env.OPENRIG_HOME ? { OPENRIG_HOME: env.OPENRIG_HOME } : {}), OPENRIG_URL: base, OPENRIG_HOST_SELECTED: "local",
    ...(!spec.gateway && person !== "-" ? { OPENRIG_SESSION_NAME: person } : {}) };
  return { argv: spec.build(values, person), env: childEnv, stdin: !!spec.stdin };
}

/** Runs the rig CLI with that argv and env: stdout capped (refused, never cut), killed after RIG_KILL_MS (the write may have happened). */
function runRig({ argv, env }, body, killMs = RIG_KILL_MS) {
  return new Promise((resolve) => {
    let out = "", err = "", size = 0, over = false, settled = false;
    const child = spawn("rig", argv, { env, stdio: ["pipe", "pipe", "pipe"] });
    const done = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); done(fail("The write didn't finish in time. It may still have happened; check before sending it again.", { outcomeUnknown: true })); }, killMs);
    child.stdout.on("data", (c) => { size += c.length; if (size > RIG_STDOUT_MAX) { over = true; child.kill("SIGKILL"); } else out += c; });
    child.stderr.on("data", (c) => { if (err.length < 65536) err += c; });
    child.on("error", (e) => done(fail(e?.code === "ENOENT" ? "The rig command isn't on this machine's PATH. Nothing was sent." : `rig failed to start: ${e?.message ?? e}`)));
    child.on("close", (code) => {
      if (over) return done(fail("rig's answer is too large for Herdr's connection. The write may have happened; check before sending it again.", { outcomeUnknown: true, tooLarge: true }));
      let json = null; try { json = JSON.parse(out); } catch { json = null; }
      done({ ok: true, code, stdout: out, json, stderr: String(err).replace(/[\x00-\x08\x0b-\x1f\x7f]+/g, " ").slice(0, 4096) });
    });
    child.stdin.on("error", () => {});
    if (body) child.stdin.end(body); else child.stdin.end();
  });
}

async function main(argv, env = process.env) {
  if (typeof fetch !== "function" || typeof AbortSignal?.timeout !== "function") throw Error("The OpenRig helper needs Node 18 or newer on this machine.");
  const [verb, host, ...args] = argv;
  if (!["get", "post", "events", "rig"].includes(verb)) throw Error("Unknown verb.");
  if (host === "-" ? verb !== "get" : !HOST_ID.test(host ?? "")) throw Error(`${verb} needs the expected OpenRig host id${verb === "get" ? ' (or "-")' : ""}.`);
  if (verb === "get") { if (!args.length || args.length > MAX_PATHS) throw Error("get takes 1 to 16 paths."); args.forEach(checkPath); }
  if (verb === "post") { if (args.length !== 2 || !/^[a-z]+\/[a-z0-9.+-]+$/i.test(args[1])) throw Error("post takes a path and a content type."); checkPath(args[0]); }
  if (verb === "events" && args.length !== 2) throw Error("events takes a cursor and a wait in ms.");
  // A write is checked whole before anything is sent: the shape, the person and every value (the address comes after locate()).
  if (verb === "rig") { if (args.length < 2) throw Error("rig takes a shape, a person and its values."); rigCommand(args[0], args[1], args.slice(2), "http://127.0.0.1:1", env); }
  let base, id;
  try { ({ base, id } = await locate(host === "-" ? null : host, env)); } catch (e) { return JSON.stringify(fail(e.message, e.extra ?? {})); }
  let result;
  if (verb === "get") {
    const results = []; for (const p of args) results.push(await request(base, "GET", p));
    result = { ok: true, results };
  } else if (verb === "post") {
    const body = await readStdin(MAX_BODY);
    const sha256 = crypto.createHash("sha256").update(body).digest("hex");
    result = { ok: true, sha256, ...(await request(base, "POST", args[0], { headers: { "content-type": args[1] }, body })) };
  } else if (verb === "rig") {
    const command = rigCommand(args[0], args[1], args.slice(2), base, env);
    const body = command.stdin ? await readStdin(MAX_BODY) : null;
    result = { ...(await runRig(command, body)), ...(body ? { sha256: crypto.createHash("sha256").update(body).digest("hex") } : {}) };
  } else result = await events(base, args[0], args[1]);
  result.hostId = id;
  const out = JSON.stringify(result);
  return bytes(out) > MAX_OUTPUT ? JSON.stringify(fail("The answer is too large for Herdr's connection; ask for less.", { tooLarge: true, hostId: id })) : out;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((out) => { process.stdout.write(out); if (JSON.parse(out).ok !== true) process.exitCode = 1; },
    (e) => { process.stdout.write(JSON.stringify(fail(e?.message ?? e))); process.exitCode = 1; });
}
module.exports = { main, statusBase, locate, checkPath, requestUrl, events, anchor, rigCommand, runRig, RIG_SHAPES, MAX_OUTPUT, MAX_BODY, MAX_PATHS, PORT_FILE };
