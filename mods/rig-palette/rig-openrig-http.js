// Requests to an OpenRig reached over Herdr's connection. Such a connection's address is `herdr://<machine>/<selfHostId>`, so every caller
// keeps building `${daemonUrl}/api/...` and the gate hands those URLs here instead of to fetch:
// - GETs issued together are batched into one exec of the pinned helper (at most 16 paths each), because each exec costs a few hundred ms;
// - a POST goes through the local bridge, its body on stdin, and is never retried;
// - the event stream becomes a socket-shaped long-poll, so the sidebar's stream reader and its idle and reconnect rules stay as they are.
// The mod runtime has no TextEncoder, so the stream's bytes are UTF-8-encoded here by hand.
const MACHINE = "[a-z0-9][a-z0-9._-]{0,31}", HOST = "[A-Za-z0-9._:-]{1,128}";
const HERDR_URL = new RegExp(`^herdr://(${MACHINE})/(${HOST})(/[^#\\s]*)?$`);
const MAX_BATCH = 16;
/** Herdr's own words for a socket read that waited 30 s with no bytes; the stream reader treats it as a quiet stream, not a closed one. */
export const IDLE_ERROR = "Resource temporarily unavailable (os error 11)";

export const herdrOrigin = (machine, hostId) => `herdr://${machine}/${hostId}`;
/** Said for a rig CLI run the helper's rig verb doesn't carry (terminal views, specs add, CLI reads). */
export const HERDR_CLI_REFUSED = "This isn't available over Herdr's connection yet. Nothing was sent.";

// The rig CLI writes the mod builds (rig-lib writeCommand, freshArgs, the Add-rig and people actions), as the helper's rig verb carries them:
// "$n" is value n of the shape, "@" the person given with --actor, "#" the queue body (stdin). A missing "$n" is "". launch-spec and new-rig
// build the same argv, so it maps to launch-spec. A test keeps this list equal to the helper's table.
const RIG_TEMPLATES = [
  ["send", ["send", "--json", "--", "$0", "$1"]],
  ["queue-create", ["queue", "create", "--destination", "$0", "--summary", "$1", "--body", "#", "--json"]],
  ["pause", ["down", "--yes", "--json", "--", "$0"]],
  ["resume", ["up", "--existing", "--json", "--", "$0"]],
  ["delete", ["down", "--delete", "--yes", "--json", "--", "$0"]],
  ["archive", ["archive", "--json", "--", "$0"]],
  ["unarchive", ["unarchive", "--json", "--", "$0"]],
  ["snapshot", ["snapshot", "--", "$0"]],
  ["fresh", ["seat", "launch", "--fresh", "--reason", "$1", "--json", "--", "$0"]],
  ["launch-spec", ["up", "--cwd", "$0", "--yes", "--json", "--", "$2"], 3],
  ["launch-spec", ["up", "--cwd", "$0", "--name", "$1", "--yes", "--json", "--", "$2"], 3],
  ["create-rig", ["create", "--runtime", "$0", "--cwd", "$1", "--json", "--", "$2"]],
  ["quiet-set-until", ["gateway", "human", "quiet", "set", "$0", "--until", "$1", "--actor", "@", "--json"]],
  ["quiet-set-daily", ["gateway", "human", "quiet", "set", "$0", "--daily", "$1", "--actor", "@", "--json"]],
  ["quiet-end", ["gateway", "human", "quiet", "end", "$0", "--actor", "@", "--json"]],
  ["quiet-clear", ["gateway", "human", "quiet", "clear", "$0", "--actor", "@", "--json"]],
  ["mode-end", ["gateway", "human", "mode", "end", "$0", "--actor", "@", "--json"]],
  ["mode-apply", ["gateway", "human", "mode", "apply", "$0", "$1", "--actor", "@", "--json"], 3],
  ["mode-apply", ["gateway", "human", "mode", "apply", "$0", "$1", "--until", "$2", "--actor", "@", "--json"], 3],
  ["mode-save-sleep", ["gateway", "human", "mode", "save", "$0", "sleep", "--availability", "off", "--quiet", "22:00-08:00", "--actor", "@", "--json"]],
  ["mode-save-focus", ["gateway", "human", "mode", "save", "$0", "focus", "--availability", "focus", "--expected-back", "in 2h", "--quiet", "until-end",
    "--decision-room", "Proceed on reversible routine work; escalate irreversible or prod-affecting changes.", "--actor", "@", "--json"]],
];
export const RIG_TEMPLATE_SHAPES = [...new Set(RIG_TEMPLATES.map(([shape]) => shape))];
/** `{shape, values, actor, body}` for a rig CLI argv the helper carries, or null. */
export function rigShapeOf(cliArgs) {
  for (const [shape, template, count] of RIG_TEMPLATES) {
    if (template.length !== cliArgs.length) continue;
    const values = [], found = { actor: null, body: null };
    const fits = template.every((t, i) => {
      const a = cliArgs[i];
      if (typeof a !== "string") return false;
      if (t === "@") { found.actor = a; return true; }
      if (t === "#") { found.body = a; return true; }
      const slot = /^\$(\d)$/.exec(t);
      if (slot) { values[Number(slot[1])] = a; return true; }
      return t === a;
    });
    if (!fits) continue;
    const n = count ?? Math.max(-1, ...template.map((t) => (/^\$(\d)$/.exec(t) ? Number(t.slice(1)) : -1))) + 1;
    return { shape, values: Array.from({ length: n }, (_, k) => values[k] ?? ""), actor: found.actor, body: found.body };
  }
  return null;
}
export const isHerdrUrl = (url) => typeof url === "string" && url.startsWith("herdr://");
/** `{machine, hostId, origin, path}` of a herdr:// URL, or null. */
export function parseHerdrUrl(url) {
  const m = HERDR_URL.exec(String(url ?? ""));
  return m ? { machine: m[1], hostId: m[2], origin: herdrOrigin(m[1], m[2]), path: m[3] || "/" } : null;
}

/** A text as UTF-8 bytes (no TextEncoder in the mod runtime). */
export function utf8Bytes(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) { const d = text.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // a lone surrogate, as TextEncoder writes it
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/** The helper's answer for one path as the little of a fetch Response the mod uses (the runtime's own answer has no headers either). */
function responseOf(origin, r) {
  if (r?.tooLarge) throw Object.assign(Error(`OpenRig's answer to ${r.path} is too large for Herdr's connection.`), { tooLarge: true });
  if (r?.error) throw Error(`OpenRig's answer to ${r.path} was refused: ${r.error}.`);
  const body = typeof r?.body === "string" ? r.body : "", status = Number(r?.status) || 0;
  return { ok: status >= 200 && status < 300, status, url: origin + r.path, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) };
}

const markUnsent = (e) => {
  if (e && typeof e === "object" && e.outcomeUnknown !== true) {
    if (e.code === "GATE_REFUSED") delete e.dispatched;
    else e.notSent = true;
  }
  return e;
};
const unsentError = (msg, extra = {}) => Object.assign(Error(msg), { notSent: true, ...extra });

export class HerdrTransport {
  /** `connection(scope, parsed)` gives `{remote, config}` for a request: that connection's RemoteOpenRig and its config, or throws when the
   *  scope has no such connection. */
  constructor({ connection, onPrepared = () => {}, generation = null }) { this.connection = connection; this.onPrepared = onPrepared; this.generation = generation; this.ready = new Map(); this.batches = new Map(); this.cursors = new Map(); this.pending = new Map(); }
  key(scope, parsed) { return `${scope ?? ""}\u0000${parsed.origin}`; }
  /** A write's check of its connection's settings, taken when the write starts: true while that connection's gate generation is the same. */
  writeCheck(scope) { if (typeof this.generation !== "function") return null; const at = this.generation(scope); return () => this.generation(scope) === at; }
  /** The prepared helper for a connection, once: approval, install and the host id pin. A failure is not kept, so the next request asks again. */
  prepared(scope, parsed) {
    const key = this.key(scope, parsed);
    if (!this.ready.has(key)) {
      const job = (async () => {
        try {
          const { remote, config } = this.connection(scope, parsed);
          // Waiting for the person's approval: the same answer until the settings (the gate generation) or the stored approval change. Each
          // prepare is about twenty remote execs, so a refresh every few seconds must not repeat it (one local file read instead).
          // Held only where the stored approval can be read: otherwise approving could never be noticed.
          const canHold = typeof remote.host?.readOpenRigConsent === "function";
          const generation = typeof this.generation === "function" ? this.generation(scope) : null;
          const stored = canHold ? JSON.stringify((await remote.host.readOpenRigConsent()) ?? null) : null;
          const pending = canHold ? this.pending.get(key) : null;
          // A fresh error (and confirmation) each time: a caller that tags or edits the error it caught must not change what the next caller gets.
          if (pending && pending.generation === generation && pending.stored === stored) throw unsentError(pending.message, JSON.parse(pending.extra));
          this.pending.delete(key);
          const p = await remote.prepare(config);
          if (!p.ok) {
            const message = `${parsed.machine} needs your approval before herdrig uses OpenRig there over Herdr's connection.`, extra = { needsConsent: true, confirmation: p.confirmation };
            if (canHold) this.pending.set(key, { generation, stored, message, extra: JSON.stringify(extra) }); // a copy: its confirmation too
            throw unsentError(message, extra);
          }
          if (p.hostId !== parsed.hostId) throw unsentError(`${parsed.machine} now runs a different OpenRig than this connection was set up for. Nothing was sent.`, { wrongHost: true });
          this.onPrepared(scope, parsed, config); // the helper answered as the host id in the address: what a switched connection's old labels wait for
          return { remote, p };
        } catch (e) { throw markUnsent(e); }
      })();
      this.ready.set(key, job);
      job.catch(() => { if (this.ready.get(key) === job) this.ready.delete(key); });
    }
    return this.ready.get(key);
  }
  /** Called with every new config: a connection whose settings changed (its address, machine, expected host or kept tunnel, so a switch away
   *  and a switch back each count) loses its prepared helper and its event cursor, so nothing from before the change is reused or replayed. */
  observe(config) {
    const seen = new Map();
    for (const c of Array.isArray(config?.connections) ? config.connections : []) {
      if (c?.id) seen.set(c.id, JSON.stringify([c.daemonUrl ?? null, c.machine ?? c.daemonMachine ?? null, c.expectedHostId ?? null, c.retainedDaemonUrl ?? null]));
    }
    for (const [id, print] of this.observed ?? new Map()) if (seen.get(id) !== print) this.forgetScope(id);
    this.observed = seen;
  }
  /** Forgets every prepared helper and cursor of one connection (scope). */
  forgetScope(scope) { for (const map of [this.ready, this.cursors, this.pending]) for (const key of [...map.keys()]) if (key.startsWith(`${scope ?? ""}\u0000`)) map.delete(key); }
  /** Forgets a connection's prepared helper and cursor (its settings changed, or it answered as another OpenRig). */
  forget(scope, origin) { for (const map of [this.ready, this.cursors, this.pending]) for (const key of [...map.keys()]) if (key === `${scope ?? ""}\u0000${origin}`) map.delete(key); }
  /** A failure with no answer from the helper (it didn't run, was killed, said nothing readable) drops the prepared helper, so the next request
   *  checks the machine, the approval and the helper again. A clean error the helper answered (OpenRig stopped there, an older daemon) keeps it:
   *  preparing again would cost about twenty hc calls on every refresh for nothing. The cursor stays, unless the answer came from another
   *  OpenRig: its events are another log. */
  failed(scope, parsed, error) {
    if (/different OpenRig/.test(String(error?.message)) || error?.wrongHost) this.forget(scope, parsed.origin);
    else if (!error?.answered) this.ready.delete(this.key(scope, parsed));
    throw error;
  }

  fetch(url, init = {}, scope = null) {
    const parsed = parseHerdrUrl(url);
    if (!parsed) return Promise.reject(unsentError(`Not an address of an OpenRig over Herdr's connection: ${String(url).slice(0, 80)}`));
    const method = String(init?.method ?? "GET").toUpperCase();
    if (method === "GET") return this.get(scope, parsed);
    if (method === "POST") return this.post(scope, parsed, init);
    return Promise.reject(unsentError(`${method} requests aren't available over Herdr's connection yet. Nothing was sent.`));
  }
  /** GETs made in the same turn share one exec (or several of at most 16 paths). */
  get(scope, parsed) {
    const key = this.key(scope, parsed);
    return new Promise((resolve, reject) => {
      let batch = this.batches.get(key);
      if (!batch) { batch = []; this.batches.set(key, batch); Promise.resolve().then(() => this.flush(key, scope, parsed)); }
      batch.push({ path: parsed.path, resolve, reject });
    });
  }
  async flush(key, scope, parsed) {
    const batch = this.batches.get(key) ?? []; this.batches.delete(key);
    for (let i = 0; i < batch.length; i += MAX_BATCH) {
      const part = batch.slice(i, i + MAX_BATCH);
      try {
        const { remote, p } = await this.prepared(scope, parsed);
        const answer = await remote.get(p, part.map((x) => x.path)).catch((e) => this.failed(scope, parsed, e));
        part.forEach((x, j) => {
          const one = answer.results?.[j];
          if (!one || one.path !== x.path) return x.reject(Error(`OpenRig's helper on ${parsed.machine} gave no answer for ${x.path}.`)); // never an empty answer
          try { x.resolve(responseOf(parsed.origin, one)); } catch (e) { x.reject(e); }
        });
      } catch (error) { part.forEach((x) => x.reject(error)); }
    }
  }
  async post(scope, parsed, init) {
    const body = init.body ?? "";
    if (typeof body !== "string") throw unsentError("A request body over Herdr's connection must be text. Nothing was sent.");
    const headers = init.headers ?? {}, type = headers["content-type"] ?? headers["Content-Type"] ?? "application/json";
    const stillCurrent = this.writeCheck(scope);
    const { remote, p } = await this.prepared(scope, parsed);
    const answer = await remote.post(p, parsed.path, type, body, { stillCurrent }).catch((e) => this.failed(scope, parsed, e));
    // The helper sent it: an answer too large or refused (a redirect) means the write happened and only its answer can't be read.
    if (answer?.tooLarge || answer?.error) throw Object.assign(Error(`The write reached OpenRig on ${parsed.machine}, but its answer couldn't be read (${answer.error ?? "too large"}). Check before sending it again.`), { outcomeUnknown: true });
    return responseOf(parsed.origin, answer);
  }
  /** A rig CLI run (`env -u … K=V … <rig> <args>`, as cliEnv and writeCommand build it) on a herdr:// connection: carried by the helper's rig verb
   *  when it is one of its writes, refused plainly otherwise. Returns what exec returns: `{code, stdout, stderr}`. */
  async cli(command, args, scope = null) {
    if (command !== "env" || !Array.isArray(args)) throw unsentError(HERDR_CLI_REFUSED);
    let i = 0; const vars = {};
    while (i < args.length) {
      if (args[i] === "-u") { i += 2; continue; }
      const m = /^([A-Z_][A-Z0-9_]*)=([\s\S]*)$/.exec(String(args[i]));
      if (!m) break;
      vars[m[1]] = m[2]; i++;
    }
    const parsed = parseHerdrUrl(vars.OPENRIG_URL);
    if (!parsed) throw unsentError(HERDR_CLI_REFUSED);
    let config;
    try { ({ config } = this.connection(scope, parsed)); } catch (e) { throw markUnsent(e); }
    const prefix = Array.isArray(config?.rig) && config.rig.length ? config.rig : ["rig"];
    if (!prefix.every((t, k) => args[i + k] === t)) throw unsentError(HERDR_CLI_REFUSED);
    const match = rigShapeOf(args.slice(i + prefix.length));
    if (!match) throw unsentError(HERDR_CLI_REFUSED);
    const person = match.actor ?? vars.OPENRIG_SESSION_NAME ?? "-";
    const stillCurrent = this.writeCheck(scope);
    const { remote, p } = await this.prepared(scope, parsed);
    const data = await remote.rig(p, match.shape, person, match.values, match.body, { stillCurrent }).catch((e) => this.failed(scope, parsed, e));
    return { code: data.code, stdout: data.stdout ?? "", stderr: data.stderr ?? "" };
  }
  /** One long-poll for the connection, resuming where its last delivered one (on any socket) stopped. Returns the events and `commit()`, which
   *  the caller runs only once it has really handed the events on: a poll whose socket closed meanwhile, or that failed, moves nothing. */
  async events(scope, parsed, waitMs) {
    const key = this.key(scope, parsed), { remote, p } = await this.prepared(scope, parsed);
    const answer = await remote.events(p, this.cursors.get(key) ?? null, waitMs).catch((e) => this.failed(scope, parsed, e));
    const events = answer.events ?? [];
    // A guessed anchor ("0" on a daemon without a watermark, when the log looked empty) would replay history as live if a later poll resumed from
    // it, so a quiet guessed poll keeps nothing. Once events arrived, their last id is a real cursor and is kept.
    const keep = typeof answer.cursor === "string" && !(answer.anchor === "guess" && events.length === 0);
    return { events, commit: () => { if (keep) this.cursors.set(key, answer.cursor); } };
  }
  /** A socket-shaped event stream: an HTTP 200 head only after remote preparation and a successful anchor read. A locally made wrapper is not
   *  a live connection: returning the head before a read reset the sidebar's backoff on every outage attempt. The initial anchor has no long
   *  poll wait, so a quiet connection opens promptly. Keep its result until read, so closing before delivery moves no cursor. A quiet poll reads as Herdr's idle
   *  timeout, so the stream reader asks its health check and reads again; a failure is thrown and the reader reconnects with its backoff. */
  eventSocket(url, scope = null) {
    const parsed = parseHerdrUrl(url);
    if (!parsed) throw Error(`Not an address of an OpenRig over Herdr's connection: ${String(url).slice(0, 80)}`);
    let closed = false, asked = false, headSent = false, firstPoll = null;
    // A new stream starts from the newest event, as a reconnected SSE stream does: after an outage, a sleep or a switch away and back, the stored
    // backlog is never replayed as if it were live. The sidebar's own refresh brings the state up to date.
    this.cursors.delete(this.key(scope, parsed));
    return {
      write: async () => { asked = true; },
      read: async () => {
        if (closed) return null;
        if (!asked) throw Error("The event stream was read before it was asked for.");
        if (!headSent) {
          firstPoll = await this.events(scope, parsed, 0);
          if (closed) return null;
          headSent = true;
          return utf8Bytes("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n\r\n");
        }
        const { events, commit } = firstPoll ?? await this.events(scope, parsed);
        firstPoll = null;
        if (closed) return null; // closed while the poll was out: nothing delivered, so the cursor stays where it was
        commit();
        if (!events.length) throw Error(IDLE_ERROR);
        return utf8Bytes(events.map((e) => `${e.id !== null && e.id !== undefined ? `id: ${e.id}\n` : ""}${String(e.data).split("\n").map((l) => `data: ${l}`).join("\n")}\n\n`).join(""));
      },
      close: () => { closed = true; },
    };
  }
}
