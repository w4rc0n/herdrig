/** Screen text only, from OpenRig's public tail API. Never reads harness files or input drafts. */
const plain = s => s.replace(/\*\*|`/g, "").replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim();
const ansi = s => s.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
const incoming = s => /^(?:(?:[›❯>]\s*)|(?:you(?:\s*\(steer\))?\s*▸\s*))?From:\s*/i.test(s.trim().replace(/^[│┃]\s*/, "")) || /^you\s*\(steer\)\s*▸/i.test(s.trim());
// Observed inputs: Claude ❯ (also boxed), Codex ›, OMP > / you ▸. No separating space is required.
const prompt = s => /^\s*(?:[❯›>]|you\s*▸|╭[─━]|╰[─━])/.test(s);
const marker = s => /^\s*[●•]\s/.test(s);
const border = s => /^[\s─━│┃┌┐└┘├┤┬┴┼╭╮╰╯═]+$/.test(s);
const headline = s => {
  const text = plain(s).replace(/\s+/g, " ");
  const end = text.search(/[.!?](?:\s+(?=[A-Z0-9])|$)/);
  return (end >= 0 ? text.slice(0, end + 1) : text).replace(/:$/, "").slice(0, 200);
};

/** Pure normalizer. Returns a composed line and at most ten cleaned screen lines for native text views. */
export function nowLine(content, runtime = "") {
  if (!String(content ?? "").trim()) return { line: "", lines: [], working: false, elapsed: "" };
  if (!/claude|codex|omp|open-model/i.test(runtime)) return {
    line: "", lines: [], working: false, elapsed: "", withheld: true,
    withheldReason: "This runtime's input boundaries aren't supported; screen text withheld.",
  };
  const source = ansi(String(content ?? "").slice(-64000)).replace(/\r\n?/g, "\n").split("\n");
  const kept = []; let inMessage = false, ambiguous = false;
  for (let i = 0; i < source.length; i++) {
    const s = source[i], trim = s.trim();
    if (/^\s*(?:[❯›>]\s*From:|you\s*▸\s*From:)/.test(s)) { ambiguous = true; break; }
    if (incoming(s)) { kept.push({ boundary: true }); inMessage = true; }
    if (inMessage) { if (/↩\s*(?:Reply:|Sent by OpenRig)/.test(s)) inMessage = false; continue; }
    if (/↩\s*(?:Reply:|Sent by OpenRig)/.test(s)) {
      // A tail may start halfway through an incoming message: discard its unmarked prefix too.
      while (kept.length && !kept.at(-1).boundary) kept.pop();
      kept.push({ boundary: true }); continue;
    }
    if (prompt(s)) {
      // A multiline draft may itself contain assistant glyphs. Never infer a later turn past input.
      break;
    }
    if (/^\s*│/.test(s) || border(s)) continue;
    kept.push({ text: s });
  }
  if (ambiguous || inMessage) return { line: "", lines: [], working: false, elapsed: "", withheld: true };
  const omp = /omp|open-model/i.test(runtime), claude = /claude/i.test(runtime), codex = /codex/i.test(runtime);
  const widths = new Map();
  if (omp) for (const { text } of kept) if (text && text.length >= 40) widths.set(text.length, (widths.get(text.length) ?? 0) + 1);
  const hardWidth = [...widths].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
  const blocks = []; let current = null, output = false, tip = false;
  const add = (type, text, extra = {}) => {
    current = { type, text: plain(text), ...extra };
    if (type === "prose" && /:$/.test(current.text)) current.headlineText = current.text;
    blocks.push(current);
  };
  for (let i = 0; i < kept.length; i++) {
    const rec = kept[i];
    if (rec.boundary) { add("boundary", ""); output = tip = false; continue; }
    let s = rec.text, tr = s.trim();
    if (!tr) { current = null; tip = false; continue; }
    if (/bypass permissions|for shortcuts|ctrl\+o to expand|ctrl \+ t to view transcript|\^t to expand|^\+ Show details|^GPT-.* ·|^← for agents/i.test(tr)) continue;
    if (/^(?:[└⎿]\s*)?Tip:/.test(tr)) { tip = true; continue; }
    if (tip && /^\s{2,}/.test(s) && !marker(s)) continue;
    tip = false;
    const working = tr.match(/^[•◦·✶✽✢✳✻]?\s*(?:Working|[A-Za-z]+…|[A-Za-z]+\.\.\.)\s*\(([^)]*)\)(.*)$/);
    if (working && (codex || claude)) {
      const elapsed = working[1].match(/(?:\d+h\s*)?(?:\d+m\s*)?\d+s|\d+m/)?.[0] ?? "";
      const note = working[2].match(/(\d+ background terminals?)/)?.[1] ?? "";
      add("status", "", { working: true, elapsed, note }); output = false; continue;
    }
    if (/^[✻✽✢✶]\s.*(?:done|for \d)|^•\s*(?:Worked for|Done)/i.test(tr)) { add("status", "", { working: false }); output = false; continue; }
    if (omp && /^⚙\s*/.test(tr)) {
      const tool = tr.match(/^⚙\s*([^\s]+)/)?.[1] ?? "tool";
      const running = !/\bdone\b/.test(tr);
      add("action", tool, { running, tool }); output = false; continue;
    }
    if (claude && /^●\s*\w+\(/.test(tr)) {
      const m = tr.match(/^●\s*(\w+)\((.*)/);
      add("action", `${m[1]} ${m[2].replace(/\)\s*$/, "").split(";")[0]}`); output = true; continue;
    }
    if (codex && /^•\s*(?:Ran|Explored|Edited|Called)\b/.test(tr)) {
      add("action", tr.replace(/^•\s*/, "").replace(/^Explored\s*$/, "Exploring")); output = true; continue;
    }
    if (codex && output && /^(?:└\s*)?(?:Read|Search|List)\b/.test(tr)) {
      add("action", tr.replace(/^└\s*/, "")); continue;
    }
    if (/^[└⎿]/.test(tr)) { output = true; continue; }
    if (marker(s)) { add("prose", tr.replace(/^[●•]\s*/, ""), { message: true }); output = false; continue; }
    if (output) continue;
    if (omp && hardWidth && i > 0 && kept[i - 1].text?.length === hardWidth && current?.type === "prose") { current.text += s; continue; }
    if (current?.type === "prose" && (/^\s{2,}/.test(s) || omp)) {
      current.text += ` ${plain(s)}`;
      if (!current.headlineText && /:$/.test(current.text)) current.headlineText = current.text;
      continue;
    }
    add("prose", tr);
  }
  const visible = blocks.filter(b => b.type === "prose" || b.type === "action");
  const barrier = blocks.findLastIndex(b => b.type === "boundary" || b.type === "action");
  const latestMessage = blocks.slice(barrier + 1).find(b => b.type === "prose" && b.text)
    ?? [...blocks].reverse().find(b => b.type === "prose" && b.text);
  const latestMarker = blocks.findLastIndex(b => b.type === "prose" && b.message);
  const prose = latestMarker >= 0 ? blocks[latestMarker] : latestMessage;
  const status = [...blocks].reverse().find(b => b.type === "status");
  const action = [...blocks].reverse().find(b => b.type === "action");
  const hasOwnWords = blocks.some(b => b.type === "prose" && b.text);
  let line = "", active = false, elapsed = "";
  if (omp && blocks.at(-1)?.type === "action" && blocks.at(-1).running && hasOwnWords) { line = `Running ${blocks.at(-1).tool}`; active = true; }
  else if (status?.working && (hasOwnWords || action || status.note)) {
    active = true; elapsed = status.elapsed;
    const afterProse = action && blocks.lastIndexOf(action) > blocks.lastIndexOf(prose);
    const tail = status.note || (afterProse ? action.text : headline(prose?.headlineText ?? prose?.text ?? ""));
    line = `Working${elapsed ? ` ${elapsed}` : ""}${tail ? ` · ${tail}` : ""}`;
  } else if (prose) line = headline(prose.headlineText ?? prose.text);
  return { line: line.slice(0, 200), lines: visible.map(b => plain(b.text)).filter(Boolean).slice(-10), working: active, elapsed };
}

/** Per-view cache: only clean screen text is retained; callers supply the currently expanded rows each refresh. */
export class NowTailCache {
  constructor(fetchTail, changed = () => {}) {
    this.fetchTail = fetchTail; this.changed = changed; this.records = new Map(); this.pending = [];
    this.inflight = new Set(); this.wanted = new Set(); this.cursors = { working: 0, other: 0 }; this.closed = false;
  }
  refresh(seats, { visible = true, now = Date.now() } = {}) {
    const valid = visible ? [...new Map(seats.filter(s => !s.terminal && !s.hidden && /^[A-Za-z0-9_.@-]+$/.test(s.session ?? "")).map(s => [s.session, s])).values()] : [];
    this.wanted = new Set(valid.map(s => s.session));
    this.pending = this.pending.filter(s => this.wanted.has(s.session));
    const eligible = s => !this.inflight.has(s.session) && !this.pending.some(p => p.session === s.session)
      && now - (this.records.get(s.session)?.attemptAt ?? -Infinity) >= 5000;
    const picked = valid.filter(s => s.open && eligible(s)).slice(0, 1);
    for (const group of ["working", "other"]) {
      const rows = valid.filter(s => !s.open && (group === "working" ? /^(?:active|working|running)$/.test(s.status ?? "") : !/^(?:active|working|running)$/.test(s.status ?? "")));
      if (!rows.length) continue;
      const start = this.cursors[group] % rows.length; let used = 0;
      for (let i = 0; i < rows.length && picked.length < 12; i++) {
        const s = rows[(start + i) % rows.length]; used++;
        if (eligible(s)) picked.push(s);
      }
      this.cursors[group] = (start + used) % rows.length;
    }
    this.pending.push(...picked); this.pump(now); return picked.map(s => s.session);
  }
  pump(now = Date.now()) {
    if (this.closed) return;
    while (this.inflight.size < 4 && this.pending.length) {
      const seat = this.pending.shift(); if (!this.wanted.has(seat.session)) continue;
      const key = seat.session, previous = this.records.get(key);
      this.records.set(key, { ...previous, attemptAt: now }); this.inflight.add(key);
      Promise.resolve().then(() => this.fetchTail(seat)).then(response => {
        if (this.closed) return;
        const data = response.data ?? {}, ok = response.ok !== false;
        const parsed = typeof data.content === "string" ? nowLine(data.content, data.ingestHealth?.runtime ?? seat.runtime) : nowLine("");
        const record = { parsed, ingestHealth: data.ingestHealth ?? previous?.ingestHealth ?? {},
          status: response.status, error: ok ? null : String(data.error ?? response.error ?? "Transcript unavailable"),
          fetchedAt: Date.now(), attemptAt: now };
        this.records.set(key, record);
        const fingerprint = r => JSON.stringify([r?.parsed, r?.error, r?.status, r?.ingestHealth?.state, r?.ingestHealth?.reason]);
        if (fingerprint(previous) !== fingerprint(record)) this.changed(key);
      }).catch(error => {
        if (!this.closed) {
          const message = String(error?.message ?? error);
          this.records.set(key, { ...previous, parsed: nowLine(""), attemptAt: now, error: message });
          if (previous?.error !== message || previous?.parsed?.line) this.changed(key);
        }
      }).finally(() => { this.inflight.delete(key); this.pump(); });
    }
  }
  close() { this.closed = true; this.pending = []; this.wanted.clear(); }
}

/** Fetch age is visible after thirty seconds even when the last ingest report said live. */
export function nowTailPresentation(record, now = Date.now()) {
  const health = record?.ingestHealth ?? {}, captured = typeof health.lastCapturedAt === "number" ? health.lastCapturedAt : Date.parse(health.lastCapturedAt ?? "");
  const ageBase = Number.isFinite(captured) ? captured : record?.fetchedAt ?? now;
  const seconds = Math.max(0, Math.floor((now - ageBase) / 1000));
  const stale = Boolean(record?.error) || health.state !== "live" || now - (record?.fetchedAt ?? 0) > 30000;
  const age = seconds >= 3600 ? `${Math.floor(seconds / 3600)} h ago` : seconds >= 60 ? `${Math.floor(seconds / 60)} min ago` : `${seconds} s ago`;
  const unsupported = record?.status === 404;
  return { line: record?.parsed?.line ?? "", lines: record?.parsed?.lines ?? [], stale,
    prefix: stale ? `${age} · ` : "", asOf: Number.isFinite(captured) ? new Date(captured).toLocaleTimeString() : "time unknown",
    state: record?.parsed?.withheld ? "withheld" : stale ? "not live" : "live", reason: record?.parsed?.withheld ? record.parsed.withheldReason ?? "Ambiguous input or incoming-message boundary; screen text withheld." : unsupported ? "This OpenRig doesn't serve transcripts." : String(record?.error ?? health.reason ?? "No recent screen text from OpenRig.").replace(/_/g, " "),
    working: Boolean(record?.parsed?.working), elapsed: record?.parsed?.elapsed ?? "" };
}
