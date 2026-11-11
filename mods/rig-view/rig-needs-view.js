// Derived from herdr-app, defaults/mods/agents/main.js at commit e77f112ac2ea136b84fe510efa42d41163bfd776
// (https://github.com/herdrdev/herdr-app), licensed under the Apache License, Version 2.0.
// Modified for herdrig: OpenRig seats and asks instead of herdr agents; see Third-party code in README.md.
// This file is licensed under the Apache License, Version 2.0 (LICENSES/herdr-app-Apache-2.0.txt).
import { needsToastFor, diffNeedsNotifications, findAttachedSeat, statusMarkElement } from "./rig-lib.js";

export const PRIORITY_GROUPS = [
  { rank: 4, label: "Needs you", tone: "blocked" }, { rank: 3, label: "Done", tone: "ansi4" },
  { rank: 2, label: "Working", tone: "ansi2" }, { rank: 1, label: "Idle", tone: "muted" },
];
const RANK = { needs: 4, done: 3, working: 2, idle: 1 };
const excluded = (seat) => seat.terminal || ["stopped", "detached", "exited"].includes(seat.sessionStatus) || ["terminal", "stopped", "detached", "exited", "unknown"].includes(seat.status);
const needs = (seat) => !excluded(seat) && ["needs_input", "attention_required", "failed"].includes(seat.status);
const helperStatus = (child) => ["blocked", "error", "needs_input"].includes(child.status) ? "needs" : child.status === "working" ? "working" : "idle";
function helpersOf(seat, terminals) {
  const known = seat.native?.children ?? [];
  const all = new Map(known.map((c) => [c.address, c]));
  for (const t of terminals) all.set(t.address, { ...(all.get(t.address) ?? {}), ...t });
  const seen = new Set(), rows = [];
  const visit = (address, depth) => {
    const child = all.get(address);
    if (!child || seen.has(address) || (child.state != null && child.state !== "live")) return;
    seen.add(address); rows.push({ ...child, depth });
    for (const next of all.values()) if (next.parent === address) visit(next.address, depth + 1);
  };
  for (const child of known) if (!known.some((p) => p.address === all.get(child.address)?.parent)) visit(child.address, 0);
  if (seat.native?.address) for (const child of all.values()) if (child.parent === seat.native.address) visit(child.address, 0);
  return rows;
}
export function priorityDuration(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** State changes survive a restart; viewing Done acknowledges it but holds its place until left. */
export class NeedsTracker {
  constructor(storage) {
    this.storage = storage;
    try { this.changed = JSON.parse(storage?.getItem("rig.needs.changed") ?? "{}"); } catch (_) { this.changed = {}; }
    if (!this.changed || Array.isArray(this.changed) || typeof this.changed !== "object") this.changed = {};
    this.held = null;
  }

  update(topology = [], attention = [], { now = Date.now(), focusedSession = null, terminals = [] } = {}) {
    const rows = topology.flatMap((rig) => rig.pods.flatMap((pod) => pod.seats.map((seat) => ({
      key: `seat:${seat.session}`, kind: "seat", seat, rig, pod: pod.name, name: seat.logicalId, asks: [],
      helpers: helpersOf(seat, terminals),
    }))));
    const bySession = new Map(rows.map((r) => [r.seat.session, r]));
    for (const ask of attention ?? []) {
      if (!needsToastFor(ask) || ["done", "closed", "canceled"].includes(ask.state)) continue;
      const session = ask.answer?.verb === "resolve" ? ask.destinationSession : ask.asker;
      const owner = bySession.get(session);
      if (owner && !excluded(owner.seat)) owner.asks.push(ask);
      else rows.push({ key: `ask:${ask.id}`, kind: "ask", ask, name: ask.summary ?? ask.title ?? ask.id, helpers: [], asks: [ask] });
    }
    for (const row of rows) {
      if (row.kind === "ask") {
        row.rank = 4; row.mark = "needs_input"; row.since = Date.parse(row.ask.at ?? row.ask.tsCreated ?? "") || now;
        continue;
      }
      const s = row.seat;
      const raw = excluded(s) ? "idle" : needs(s) || row.asks.length ? "needs" : ["active", "blocked"].includes(s.status) ? "working" : "idle";
      const prev = Object.hasOwn(this.changed, row.key) ? this.changed[row.key] : null;
      // Attaching viewers can briefly trip window sampling. Require a working stretch or stronger evidence.
      const worked = prev?.s === "working" && (prev.strong === true || (Number.isFinite(prev.at) && now - prev.at >= 10000));
      const freshDone = !excluded(s) && raw === "idle" && (worked || (!prev && s.agentActivity?.state === "done"));
      const changed = prev?.s !== raw;
      const record = { s: raw, at: changed ? now : prev.at, done: freshDone || (!changed && !!prev?.done), seen: changed ? false : !!prev?.seen };
      if (raw === "working") {
        const source = s.activityState?.decidedBy;
        record.strong = (!changed && prev?.strong === true) || (typeof source === "string" && source.trim() !== "" && source !== "window-sampling");
      }
      if (excluded(s)) record.done = false;
      const looking = s.session === focusedSession;
      const held = looking && this.held === row.key && record.done;
      row.rank = raw === "idle" && record.done && (!record.seen || held) ? 3 : RANK[raw];
      if (looking && row.rank === 3) { record.seen = true; this.held = row.key; }
      else if (this.held === row.key && (!looking || raw !== "idle")) this.held = null;
      row.since = record.at;
      if (row.asks.length) row.since = Math.max(row.since, ...row.asks.map((a) => Date.parse(a.at ?? a.tsCreated ?? "") || 0));
      if (!excluded(s)) row.rank = Math.max(row.rank, ...row.helpers.map((c) => RANK[helperStatus(c)]));
      row.mark = row.rank === 4 ? "needs_input" : row.rank === 3 ? "completed" : row.rank === 2 ? "active"
        : ["stopped", "detached", "exited"].includes(s.sessionStatus) ? s.sessionStatus : s.terminal ? "terminal" : s.status;
      row.focused = looking;
      Object.defineProperty(this.changed, row.key, { value: record, writable: true, enumerable: true, configurable: true });
    }
    const listed = new Set(rows.map((r) => r.key));
    for (const [key, value] of Object.entries(this.changed)) if (!listed.has(key) && now - value.at > 30 * 86400000) delete this.changed[key];
    const serialized = JSON.stringify(this.changed);
    if (serialized !== this.saved) {
      try { this.storage?.setItem("rig.needs.changed", serialized); } catch (_) { /* memory fallback */ }
      this.saved = serialized;
    }
    return rows.sort((a, b) => b.rank - a.rank || b.since - a.since || a.name.localeCompare(b.name));
  }
}

/** One transition diff and batch limit for seat prompts and asks. Seen keys remain silent while still present. */
export function diffPriorityNotifications(topology, attention, previous, options = {}) {
  const candidates = (attention ?? []).map(needsToastFor).filter(Boolean).map((c) => ({ ...c, id: `ask:${c.id}` }));
  for (const rig of topology ?? []) for (const pod of rig.pods) for (const seat of pod.seats) {
    if (!needs(seat)) continue;
    const evidence = String(seat.arbitratedNeedsInput?.kind ?? seat.needsInputEvidence?.kind ?? "").toLowerCase();
    const reason = seat.status === "failed" ? "startup failed" : evidence.includes("mcp") ? "an MCP approval" : /perm|auth|trust/.test(evidence) ? "a permission prompt" : /question|input/.test(evidence) ? "a question" : "";
    candidates.push({ id: `seat:${seat.session}`, at: "", isUrgent: true, isEscalation: false,
      silent: options.focusedSession === seat.session || !!findAttachedSeat(options.terminals ?? [], options.spaces ?? [], seat.session),
      toast: { title: `${seat.logicalId} needs you`, body: `${rig.name}${reason ? ` · ${reason}` : ""}`, level: "error", timeout: 12000,
        action: { name: `rig.open-seat:${seat.session}`, args: { session: seat.session } } } });
  }
  return diffNeedsNotifications(attention, previous, { ...options, candidates, transitionOnly: true, maxSeen: Number.MAX_SAFE_INTEGER });
}

/** Herdr's compact exclamation and pill; other statuses use round-six marks. */
export function needsMark(ui, t, key, compact, iconOf) {
  if (key !== "needs_input") return statusMarkElement(ui, t, key, { iconOf });
  const { div } = ui;
  if (compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
}

export function priorityElements(ui, t, rows, { folds, fold, open, menu, helper, hover, hovered, selected, iconOf, register, now = Date.now() }) {
  const { div, svg, h_flex } = ui;
  const out = [];
  const many = rows.filter((r) => r.kind === "seat").length > 12;
  for (const group of PRIORITY_GROUPS) {
    const members = rows.filter((r) => r.rank === group.rank);
    if (!members.length) continue;
    const key = `priority:${group.rank}`, expanded = folds[key] ?? !(group.rank === 1 && many);
    register({ key, foldKey: key, expandable: true, isOpen: expanded, parentKey: "branch:topology" });
    out.push(h_flex().id(key).px(16).h(30).pt(8).gap(6).items_center().text_size(11).font_medium().cursor_pointer()
      .on_click((_e, cx) => fold(key, !expanded, cx))
      .child(div().text_color(t[group.tone] ?? t.dim).child(group.label))
      .child(div().text_color(t.dim).child(String(members.length)))
      .child(div().flex_1()).child(svg(iconOf(expanded ? "chevron-down" : "chevron-right")).size(11).text_color(t.dim)));
    if (!expanded) continue;
    for (const row of members) {
      const helperKey = `priority-helpers:${row.key}`, helpersOpen = folds[helperKey] ?? true;
      register({ key: row.key, foldKey: helperKey, expandable: row.helpers.length > 0, isOpen: helpersOpen, parentKey: key, priorityRow: row });
      out.push(h_flex().id(`priority-${row.key}`).px(12).h(30).gap(7).rounded(8).items_center().cursor_pointer()
        .when(row.focused || selected === row.key, (el) => el.bg(t.selected ?? t.selection ?? t.raised))
        .hover((el) => el.bg(t.hover))
        .on_hover((on, cx) => hover(on ? row.key : null, cx))
        .on_click(() => open(row)).on_mouse_down("right", () => menu(row))
        .child(svg(iconOf(row.kind === "ask" ? "rig-bell" : row.seat.terminal ? "rig-terminal-prompt" : "rig-seat")).size(13).flex_none().text_color(t.muted))
        .child(h_flex().flex_1().min_w(0).gap(4).text_size(12.5)
          .child(div().min_w(0).max_w(130).truncate().text_color(row.rank === 1 ? t.muted : t.foreground).child(row.name))
          .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`· ${row.rig?.name ?? "no seat"}`)))
        .when(row.helpers.length > 0, (el) => el.child(div().id(`priority-fold-${row.key}`).px(3).h(18).text_color(t.dim)
          .on_click((_e, cx) => { cx.stop_propagation(); fold(helperKey, !helpersOpen, cx); })
          .child(svg(iconOf(helpersOpen ? "chevron-down" : "chevron-right")).size(11))
          .when(!helpersOpen, (el) => el.child(div().text_size(11).child(String(row.helpers.length))))))
        .when(hovered !== row.key, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(priorityDuration(now - row.since))))
        .child(needsMark(ui, t, row.mark, true, iconOf)));
      if (helpersOpen) for (const [i, child] of row.helpers.entries()) {
        const childKey = `priority-helper:${child.address}`;
        register({ key: childKey, expandable: false, parentKey: row.key, helper: child });
        out.push(h_flex().id(childKey).pl(26 + child.depth * 12).pr(12).h(26).gap(8).items_center().hover((el) => el.bg(t.hover))
          .on_click(() => helper(child)).child(div().w(9).h(17).border_l(1.5).border_b(1.5).border_color(t.input ?? t.border).when(i === row.helpers.length - 1, (el) => el.rounded_bl(6)))
          .child(div().flex_1().truncate().text_size(12).text_color(t.muted).child(child.label ?? child.name ?? child.address))
          .child(needsMark(ui, t, helperStatus(child) === "needs" ? "needs_input" : helperStatus(child) === "working" ? "active" : "idle", true, iconOf)));
      }
    }
  }
  return out;
}
