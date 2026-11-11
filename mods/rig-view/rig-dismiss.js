import { needTarget, missionAction, isUpdateNeed } from "./rig-lib.js";

export const UNDO_MS = 10000;
const RETAIN_MS = 30 * 86400000;
export const dismissible = (item) => !!item?.id && isUpdateNeed(item) && !item.native
  && !item.answer?.verb && !["answer", "resolve", "native"].includes(item.reply);
export const updateKey = (item) => JSON.stringify([item.id, needTarget(item).summary]);
export const dismissalScope = (config) => JSON.stringify([config?.daemonUrl ?? "", config?.person ?? ""]);
const localNote = "Hidden here only; other OpenRig clients may still show it.";

export function dismissalRecipient(config, perspective) {
  const configured = typeof config?.person === "string" ? config.person.trim() : "";
  if (/^[^@\s]+@external$/.test(configured)) return configured;
  const raw = perspective?.actingAs?.person || perspective?.personId;
  const person = typeof raw === "string" ? raw.trim() : "";
  const address = person.includes("@") ? person : person ? `${person}@external` : "";
  return /^[^@\s]+@external$/.test(address) ? address : null;
}

/** Shared UI messages may select current items, never invent the row or recipient passed to the model. */
export function liveDismissalItems(requested, liveItems, records = []) {
  return requested.flatMap((item) => {
    if (!dismissible(item)) return [];
    const live = liveItems.find((i) => dismissible(i) && updateKey(i) === updateKey(item));
    const restored = records.find((r) => r.restored && r.status === "closed" && r.key === updateKey(item));
    const actual = live ?? restored?.item;
    return actual ? [{ ...actual, dismissalPosition: item.dismissalPosition }] : [];
  });
}

/** Herdr mods have cx.timer, not browser AbortSignal/setTimeout. Bound both fetch and JSON body reading.
 * A timed-out POST may have committed; stop waiting, keep it local/uncertain, and never retry automatically.
 */
export function boundedDismissalRequest(request, after, timeoutMs = 15000) {
  return (req) => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, result) => { if (!settled) { settled = true; fn(result); } };
    after(timeoutMs, () => finish(reject, new Error("OpenRig dismissal request timed out; the close was not confirmed.")));
    Promise.resolve().then(() => request(req)).then((r) => finish(resolve, r), (e) => finish(reject, e));
  });
}

/** Local presentation state only. The sidebar owns commits, including after the Needs page closes. */
export class DismissedUpdates {
  constructor(saved = {}, now = Date.now()) {
    this.show = saved.show === true;
    this.records = (Array.isArray(saved.records) ? saved.records : []).filter((r) =>
      r && dismissible(r.item) && typeof r.key === "string" && r.key === updateKey(r.item)
      && Number.isFinite(r.at) && (!r.missingSince || now - r.missingSince < RETAIN_MS))
      .map((r) => ({ ...r, status: r.status === "sending" ? "local" : r.status,
        note: r.status === "sending" ? "Hidden here; the previous close was not confirmed. Check OpenRig before retrying." : r.note }));
    this.receipts = [];
  }
  saved() { return { show: this.show, records: this.records }; }
  observe(items, now = Date.now()) {
    const keys = new Set(items.filter(dismissible).map(updateKey));
    for (const r of this.records) {
      if (keys.has(r.key)) delete r.missingSince;
      else r.missingSince ??= now;
    }
    this.records = this.records.filter((r) => !r.missingSince || now - r.missingSince < RETAIN_MS);
  }
  dismiss(items, now = Date.now()) {
    const added = [];
    for (const raw of items) {
      if (!dismissible(raw)) continue;
      const item = needTarget(raw), key = updateKey(item);
      const old = this.records.find((r) => r.key === key);
      if (old && !old.restored) continue;
      if (old) { old.restored = false; old.at = now; if (old.status === "pending") old.due = now + UNDO_MS; added.push(key); continue; }
      this.records.push({ key, item, at: now, due: now + UNDO_MS, status: "pending", restored: false });
      added.push(key);
    }
    if (added.length) this.receipts.push({ id: `${now}:${this.receipts.length}`, keys: added, at: now, position: items[0]?.dismissalPosition ?? 0,
      summary: added.length === 1 ? items.find((i) => updateKey(i) === added[0])?.summary : null });
    return added;
  }
  undo(id, now = Date.now()) {
    const receipt = this.receipts.find((r) => r.id === id && now - r.at < UNDO_MS);
    if (!receipt) return;
    for (const key of receipt.keys) {
      const r = this.records.find((v) => v.key === key);
      if (!r || r.status === "sending") continue;
      if (r.status === "pending") this.records = this.records.filter((v) => v !== r);
      else r.restored = true;
    }
    this.receipts = this.receipts.filter((r) => r !== receipt);
  }
  restore(key) { const r = this.records.find((v) => v.key === key); if (r && r.status !== "sending") r.restored = true; }
  visible(items) {
    return items.filter((i) => !dismissible(i) || !this.records.some((r) => r.key === updateKey(i) && !r.restored))
      .concat(this.records.filter((r) => r.restored && !items.some((i) => updateKey(i) === r.key)).map((r) => r.item));
  }
  hidden() { return this.records.filter((r) => !r.restored).sort((a, b) => b.at - a.at); }
  receiptRows(now = Date.now()) { return this.receipts.filter((r) => now - r.at < UNDO_MS); }
  leave() { this.receipts = []; }
  async flush(commit, persist, now = Date.now()) {
    for (const r of this.records) {
      if (r.status !== "pending" || r.restored || r.due > now) continue;
      // Persist before sending. A restart after an uncertain response never resends a close automatically.
      r.status = "sending"; await persist();
      let result;
      try { result = await commit(r.item); }
      catch (_) { result = { status: "local", note: "Hidden here; the close was not confirmed. Check OpenRig before retrying." }; }
      Object.assign(r, result); await persist();
    }
  }
}

export function dismissalSnapshot(sharedState) {
  const model = new DismissedUpdates(sharedState ?? {});
  model.receipts = sharedState?.receipts ?? [];
  return model;
}

/** Public HTTP only. No daemon-selected actor, route, verb, host, or authentication source. */
export async function commitDismissal(config, item, request, { attentionItems = [], person = null } = {}) {
  if (!dismissible(item) || !/^queue-update:qitem-[A-Za-z0-9-]+$/.test(item.id)) return { status: "local", note: localNote };
  const live = attentionItems.find((i) => dismissible(i) && updateKey(i) === updateKey(item));
  if (!live) return { status: "local", note: "Hidden here only; this update is no longer in the live Needs list." };
  const qitemId = item.id.slice("queue-update:".length);
  const got = await request({ path: `/api/queue/${encodeURIComponent(qitemId)}`, method: "GET" });
  const row = got.data?.item ?? got.data?.qitem ?? got.data;
  if (!got.ok || row?.humanIntent !== "update") return { status: "local", note: "Hidden here only; OpenRig could not confirm that this is still an update." };
  person = dismissalRecipient(config, { actingAs: { person } });
  if (!person || row.destinationSession !== person || live.recipient !== person)
    return { status: "local", note: "Hidden here only; OpenRig could not confirm that this update is addressed to you." };
  if (["done", "handed-off"].includes(row.state)) return { status: "closed", note: "Closed in OpenRig." };
  if (!["pending", "in-progress", "blocked"].includes(row.state)) return { status: "local", note: "Hidden here only; this queue state cannot be dismissed." };
  if (!row.decisionRevision) return { status: "local", note: "Hidden here only; this OpenRig cannot guard a dismissal against a changed row." };
  // Try the public route; a refusal stays local and never becomes another write verb.
  const req = missionAction(config, { qitemId }, { verb: "approve", expectedRevision: row.decisionRevision,
    reason: "dismissed in herdrig" });
  const res = await request(req);
  if (res.ok && !res.data?.error && res.data?.ok !== false || res.data?.error === "qitem_already_terminal") return { status: "closed", note: "Closed in OpenRig." };
  if (res.status === 401) return { status: "local", note: "Hidden here only; OpenRig is protected (401). Dismiss this update in the TUI." };
  return { status: "local", note: `Hidden here only; OpenRig refused the close (${res.status ?? "unavailable"}).` };
}

export function requestDismissal(host, action, value) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  host.setShared("rig.updateActions", { ...(host.shared("rig.updateActions") ?? {}), [id]: { action, value, scope: host.scope ?? host.shared("rig.dismissedUpdates")?.scope } });
  host.run(`rig.update-action:${id}`);
}
