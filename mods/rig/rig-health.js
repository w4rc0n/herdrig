// Public /api/health presentation. No daemon internals, mutations, or diagnostic judgments.
export function currentHealthRecords(records = []) {
  return (Array.isArray(records) ? records : []).filter(r => r && typeof r === "object" && !classifyHealth(r).cleared);
}
function severityRank(record) {
  const severity = String(record?.severity ?? "").toLowerCase();
  // Legacy aliases retain the existing sidebar's interpretation; current public severities are info/warning/critical.
  return ["critical", "error", "fatal"].includes(severity) ? 2
    : ["warning", "warn", "high", "medium", "degraded"].includes(severity) ? 1 : 0;
}
/** Cleared wins over stale severity/status. Context housekeeping is never an alert. */
export function classifyHealth(record) {
  const cleared = record?.resolved === true || record?.cleared === true || Boolean(record?.clearedAt || record?.resolvedAt)
    || ["cleared","resolved","closed","ok","healthy"].includes(String(record?.status ?? "").toLowerCase())
    || (String(record?.status ?? "").toLowerCase() !== "active"
      && /\b(?:cleared naturally|resolved naturally)\b|^(?:cleared|resolved)(?:\s|[.:]|$)/i.test(String(record?.summary ?? "")));
  const context = /^context[.-]pressure(?:[.-]|$)/i.test(String(record?.detector ?? ""))
    || String(record?.category ?? "").toLowerCase() === "context";
  const actionable = !cleared && !context && record?.status === "active" && severityRank(record) > 0;
  return { cleared, context, actionable, rank: actionable ? severityRank(record) : 0 };
}
export const healthRank = record => classifyHealth(record).rank;
/** Optional history is shape-checked; a current record wins over a stale cleared snapshot. */
export function mergeHealthHistory(current = [], history) {
  const records=[...current],seen=new Set(records.map(r=>r?.id));
  if (!Array.isArray(history?.records)) return records;
  for(const record of history.records){
    if(!record||typeof record.id!=="string"||!classifyHealth(record).cleared||seen.has(record.id))continue;
    seen.add(record.id);records.push(record);
  }
  return records;
}
export function healthCounts(records) {
  const list = currentHealthRecords(records), problems = list.filter(r => healthRank(r) > 0).length;
  return { problems, notes: list.length - problems, worst: Math.max(0, ...list.map(healthRank)) };
}
export function healthInRig(record, rig, seats = []) {
  const scope = record?.scope ?? {};
  if (scope.type === "instance") return false;
  if (scope.rigId) return scope.rigId === rig?.id;
  if (scope.rig) return scope.rig === rig?.name;
  return seats.some(n => (scope.seatId && scope.seatId === (n.nodeId ?? n.id))
    || (scope.nodeId && scope.nodeId === (n.nodeId ?? n.id))
    || (scope.sessionName && scope.sessionName === n.canonicalSessionName)
    || (scope.session && scope.session === n.canonicalSessionName));
}
export function healthForRig(records, rig, seats = [], includeInstance = false, includeCleared = false) {
  return (includeCleared ? records ?? [] : currentHealthRecords(records)).filter(r => (includeInstance && r.scope?.type === "instance") || healthInRig(r, rig, seats));
}
export function healthAge(seconds) {
  if (!Number.isFinite(seconds)) return "age not reported";
  if (seconds < 60) return "less than 1 min old";
  return seconds < 3600 ? `${Math.floor(seconds / 60)} min old` : `${Math.floor(seconds / 3600)} h old`;
}
export function healthQueueId(record) {
  return record?.ceremony?.lineageId ?? record?.evidence?.find(e => typeof e.qitemId === "string")?.qitemId ?? null;
}
export const validHealthQitemId = id => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
export function healthContextPercentage(record) {
  const samples = (record?.evidence ?? []).filter(e => e.type === "context-usage" && Number.isFinite(e.usedPercentage));
  // Evidence can contain the episode's first, peak and latest samples.
  // Show the newest sample rather than whichever the daemon put first.
  samples.sort((a,b) => (Date.parse(b.observedAt) || 0) - (Date.parse(a.observedAt) || 0)
    || (b.sourceOrder ?? 0) - (a.sourceOrder ?? 0));
  const value = samples[0]?.usedPercentage;
  return Number.isFinite(value) ? `${value}%` : "percentage not reported";
}
export function healthPhrases(records) {
  const first = records[0] ?? {}, counts = records.map(r => Number(String(r.explanation ?? "").match(/^(\d+) coordination transitions\b/)?.[1])).filter(Number.isFinite);
  if (first.detector === "context.pressure") return {
    title: "Context pressure",
    what: `${records.length === 1 ? "This seat is" : "These seats are"} close to ${records.length === 1 ? "its" : "their"} conversation context limit. The latest reported usage is shown for each seat.`,
    todo: "Open the seat and check whether it needs a handover or a fresh conversation."
  };
  if (first.detector === "process.ceremony-amplification") {
    if (first.status === "indeterminate") {
      const range = counts.length ? Math.min(...counts) === Math.max(...counts) ? String(counts[0]) : `${Math.min(...counts)} to ${Math.max(...counts)}` : null;
      const missingLink = records.every(r => (r.ceremony?.missingFacts ?? []).some(f => /(?:project\/mission linkage|scope identity|slice identity).*missing|scope identity unresolved/i.test(f)));
      return { title: "Long queue histories OpenRig couldn't assess",
        what: `These pieces of work went through many queue changes${range ? ` (${range})` : ""}. OpenRig can't tell whether that was too much back-and-forth${missingLink ? ", because the work isn't linked to a project or mission" : " from the available evidence"}.`,
        todo: "Nothing, normally. To check one, open its queue item." };
    }
    if (first.status === "active") return {
      title: "A lot of coordination for this work",
      what: `This work has ${counts.length === 1 ? `${counts[0]} queue changes` : "many queue changes"} compared with its recorded results. OpenRig suggests checking whether that coordination is useful.`,
      todo: "Open the queue item and check whether its coordination can be simpler." };
  }
  return { title: first.summary || first.detector || "Health finding",
    what: String(first.explanation ?? "No explanation reported.").split(/(?<=[.!?])\s/)[0],
    todo: first.suggestedInspection || "No suggested inspection reported." };
}
export function groupHealthRecords(records) {
  const groups = new Map();
  for (const record of records ?? []) {
    if (!record || typeof record !== "object") continue;
    const key = classifyHealth(record).cleared ? "cleared" : JSON.stringify([record.detector ?? "unknown", record.status ?? "unknown", record.severity ?? "unknown"]);
    if (!groups.has(key)) groups.set(key, { key, records: [] });
    groups.get(key).records.push(record);
  }
  return [...groups.values()].map(g => ({ ...g, ...healthPhrases(g.records), ...healthCounts(g.records),
    ...(g.key === "cleared" ? { title:"Cleared", what:"These findings cleared. No action is needed.", todo:"Nothing.", cleared:true, worst:0 }
      : {rawRank: Math.max(0,...g.records.map(severityRank))}),
    startedAt: g.records.map(r => r.startedAt).filter(Boolean).sort()[0] ?? null,
    ageSeconds: Math.max(...g.records.map(r => r.freshness?.ageSeconds).filter(Number.isFinite)),
    stale: g.records.some(r => r.freshness?.state === "stale") }))
    .sort((a, b) => Number(Boolean(a.cleared))-Number(Boolean(b.cleared)) || b.worst - a.worst || (b.rawRank??0)-(a.rawRank??0) || String(a.startedAt).localeCompare(String(b.startedAt)) || a.key.localeCompare(b.key));
}
export function healthScopeTarget(record, rigs = [], nodesByRig = {}) {
  const scope = record?.scope ?? {};
  if (scope.type === "instance") return { label: "Whole OpenRig", entry: null };
  const rig = rigs.find(r => r.id === scope.rigId || (scope.rig && r.name === scope.rig));
  const nodes = rig ? nodesByRig[rig.id] ?? [] : Object.values(nodesByRig).flat();
  const seat = nodes.find(n => (scope.seatId && scope.seatId === (n.nodeId ?? n.id)) || (scope.nodeId && scope.nodeId === (n.nodeId ?? n.id))
    || (scope.sessionName && scope.sessionName === n.canonicalSessionName) || (scope.session && scope.session === n.canonicalSessionName));
  if (seat && rig) return { label: `Seat ${seat.logicalId}`, entry: { section: "topology", kind: "seat", rigId: rig.id, rig: rig.name, name: seat.logicalId, session: seat.canonicalSessionName } };
  if (scope.type === "seat" || scope.seatId || scope.nodeId) return { label: `Seat ${scope.seatId ?? scope.nodeId ?? scope.sessionName ?? scope.session ?? "not identified"}`, entry: null };
  if (rig) return { label: `Rig ${rig.name}`, entry: { section: "topology", kind: "rig", rigId: rig.id, name: rig.name } };
  return { label: `${scope.type ?? "Unknown scope"}${scope.missionId ? ` ${scope.missionId}` : scope.sliceId ? ` ${scope.sliceId}` : ""}`, entry: null };
}
