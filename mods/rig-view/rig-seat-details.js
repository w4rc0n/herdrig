/** The public /api/rigs/:id/nodes activity contract (captured from OpenRig 0.7.11). */
import { formatAbsoluteTime } from './rig-time.js';
export function seatActivityDetails(node, now = Date.now(), timezone = null) {
  const activity = node?.activityState ?? {}, agent = node?.agentActivity ?? {};
  const text = (value) => typeof value === "string" && value ? value : null;
  const changedAt = text(agent.eventAt) ?? text(node?.lastActivityAt);
  const stamp = changedAt ? new Date(changedAt) : null;
  const elapsed = stamp && Number.isFinite(stamp.getTime()) ? Math.max(0, now - stamp.getTime()) : null;
  const ago = elapsed === null ? null : elapsed < 60000 ? "<1m ago" : elapsed < 3600000
    ? `${Math.floor(elapsed / 60000)}m ago` : elapsed < 86400000 ? `${Math.floor(elapsed / 3600000)}h ago` : `${Math.floor(elapsed / 86400000)}d ago`;
  return {
    state: text(activity.display) ?? text(activity.activity) ?? text(agent.state) ?? "—",
    evidence: [text(agent.evidenceSource), text(agent.evidence)].filter(Boolean).join(" · ") || "—",
    reason: text(agent.reason) ?? text(activity.needsInput?.reason) ?? "—",
    decidedBy: text(activity.decidedBy) ?? "—",
    signal: [text(agent.rawEvent), text(agent.rawSubtype)].filter(Boolean).join(" · ") || "—",
    changed: ago ? `${formatAbsoluteTime(stamp,{timezone,exact:true})} · ${ago}` : "—",
    flags: [agent.stale === true ? "stale" : null, agent.fallback === true ? "fallback" : null].filter(Boolean),
  };
}

/** Plain presentation of the public activity fields; raw evidence remains available separately. */
export function seatActivityWords(node, now = Date.now(), timezone = null) {
  const a = node?.agentActivity ?? {}, s = node?.activityState ?? {};
  const state = String(s.display ?? s.activity ?? a.state ?? "unknown").replace(/_/g, " ");
  const label = /needs.?input|attention/.test(state) ? "Needs you" : state === "working" || state === "running" ? "Working"
    : state === "idle" ? "Idle" : state === "blocked" ? "Blocked" : state === "done" ? "Done" : "Not reported";
  const source = a.evidenceSource === "runtime_hook" ? "seen from the runtime's own hooks"
    : a.evidenceSource === "window-sampling" ? "seen from the terminal screen" : "";
  const stamp = Date.parse(a.eventAt ?? node?.lastActivityAt ?? "");
  const age = Number.isFinite(stamp) ? Math.max(0, Math.floor((now - stamp) / 60000)) : null;
  const ago = age === null ? "" : age < 1 ? "less than a minute ago" : age < 60 ? `${age} min ago` : `${Math.floor(age / 60)} h ago`;
  return { line: `${label}${source ? ` · ${source}` : ""}`, changed: Number.isFinite(stamp)
    ? `Changed ${formatAbsoluteTime(stamp,{timezone})} · ${ago}` : "",
    note: a.reason === "generation_unverifiable" ? "OpenRig couldn't confirm the latest turn" : "",
    stale: a.stale === true && ago ? `Last confirmed ${ago}` : "" };
}

export function seatQueuePaths(session) {
  const base = `/api/queue/list?destinationSession=${encodeURIComponent(session)}`;
  return { open: `${base}&state=pending,in-progress,blocked&limit=100`,
    finished: `${base}&state=done,handed-off&sort=updated&limit=3` };
}
export function seatQueueDetails(openData, finishedData) {
  const rows = Array.isArray(openData) ? openData : null;
  const finished = Array.isArray(finishedData) ? finishedData : null;
  return {
    current: (rows ?? []).filter((r) => r.state === "in-progress"),
    pending: (rows ?? []).filter((r) => r.state === "pending"),
    blocked: (rows ?? []).filter((r) => r.state === "blocked"),
    finished: (finished ?? []).filter((r) => ["done", "handed-off"].includes(r.state)),
    count: rows?.length ?? null, partial: (rows?.length ?? 0) >= 100,
    available: !!rows, finishedAvailable: !!finished,
  };
}
