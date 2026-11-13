import { configDefinition, validateConfigValue, configPairPlan, configConsequence, configDeletesHistory } from "./rig-config-schema.js";

export const CONFIG_RESULT_MS = 10000;
export const PRESSURE_WARNING = "health.context_pressure.warning_percent";
export const PRESSURE_CRITICAL = "health.context_pressure.critical_percent";
const shown = entry => entry?.visibility !== "withheld" && !/token|credential/i.test(entry?.key ?? "");
const valueOf = entry => shown(entry) ? String(entry?.value ?? "") : "";

/** One editor, one pending confirmation, no implicit writes. Callers inject the reviewed transport. */
export class ConfigEditor {
  constructor() { this.entries = []; this.row = null; this.results = new Map(); this.busy = false; this.approved = new WeakSet(); }
  observe(browser) { this.entries = Array.isArray(browser?.entries) ? browser.entries : []; }
  entry(key) { return this.entries.find(e => e.key === key); }
  open(key) {
    const entry = this.entry(key), def = configDefinition(entry);
    if (!entry || def.readOnly || this.busy) return false;
    if (this.row?.key === key) return true;
    if (this.row && this.dirty()) { this.discardFor = key; return false; }
    this.cancel();
    const paired = [PRESSURE_WARNING, PRESSURE_CRITICAL].includes(key);
    const keys = paired ? [PRESSURE_WARNING, PRESSURE_CRITICAL] : [key];
    if(paired&&keys.some(k=>configDefinition(this.entry(k)).readOnly))return false;
    this.row = { key, keys, initial: Object.fromEntries(keys.map(k => [k, shown(this.entry(k)) ? valueOf(this.entry(k)) : null])), error: null };
    this.row.values = { ...this.row.initial };
    return true;
  }
  dirty() { return !!this.row && this.row.keys.some(key => this.row.values[key] !== this.row.initial[key]); }
  change(key, value) { if (this.row?.keys.includes(key) && !this.busy) { this.row.values[key] = value; this.row.error = null; this.confirmation = null; } }
  cancel() { if (!this.busy) { this.row = null; this.discardFor = null; this.confirmation = null; } }
  discard() { const key = this.discardFor; this.cancel(); if (key) this.open(key); }
  plan() {
    if (!this.row) return { error: "Open a setting first" };
    for (const key of this.row.keys) {
      const error = validateConfigValue(configDefinition(this.entry(key)), this.row.values[key]);
      if (error) return { error };
    }
    if (this.row.keys.length === 2) return configPairPlan(this.row.values[PRESSURE_WARNING], this.row.values[PRESSURE_CRITICAL], this.row.initial[PRESSURE_WARNING], this.row.initial[PRESSURE_CRITICAL]);
    return { changes: [[this.row.key, this.row.values[this.row.key]]] };
  }
  request(changes, reset = false) {
    if (this.busy || !changes.length) return null;
    if (this.row && this.dirty() && changes.some(([key]) => !this.row.keys.includes(key))) {
      this.discardFor = changes[0][0]; return null;
    }
    for (const [key, value] of changes) {
      const def = configDefinition(this.entry(key));
      if (!this.entry(key) || def.readOnly || (!reset && validateConfigValue(def, value))) return null;
    }
    const high = changes.find(([key]) => configDefinition(this.entry(key)).risk === "high");
    const pending = { changes: changes.map(v => [...v]), reset, old: changes.map(([key]) => [key, valueOf(this.entry(key))]) };
    if (high) {
      const def = configDefinition(this.entry(high[0]));
      const current=shown(this.entry(high[0]))?this.entry(high[0]).value:null;
      this.confirmation = { ...pending, consequence: configConsequence(def, high[1],current), destructive: configDeletesHistory(def,high[1],current) };
      return null;
    }
    this.approved.add(pending);
    return pending;
  }
  confirm() { const pending = this.confirmation; if (!pending) return null; this.confirmation = null; this.approved.add(pending); return pending; }
  async save(pending, write, refresh, now = Date.now) {
    if (this.busy || !pending || !this.approved.has(pending)) return false;
    this.approved.delete(pending);
    this.busy = true; this.error = null; if(this.row)this.row.error=null; let completed = 0;
    try {
      for (const [key, value] of pending.changes) {
        // Re-check at the write boundary. A UI control or stale confirmation cannot add an unknown key.
        const def = configDefinition(this.entry(key));
        if (def.readOnly || !this.entry(key) || (!pending.reset && validateConfigValue(def, value))) throw new Error("Setting changed; reopen it before saving");
        const result = await write(key, value, pending.reset);
        if (!result.ok) throw new Error(result.error ?? "OpenRig refused the save");
        completed++;
        const undo = def.type === "bool" && def.risk !== "high" && !pending.reset && shown(this.entry(key));
        await refresh();
        const current = this.entry(key);
        const resolved = current ? {value:current.value,source:current.source} : result.resolved;
        this.results.set(key, { at: typeof now === "function" ? now() : now,
          text: configSavedText(def, {...result,resolved,withheld:!shown(current),daemon:result.daemon}, pending.reset),
          undo: undo ? pending.old.find(v => v[0] === key)?.[1] : null });
      }
      this.row = null; this.confirmation = null;
      return true;
    } catch (error) {
      if (this.row) this.row.error = `${completed ? `${completed} setting saved; the next was refused.\n` : ""}${error.message}`;
      else this.error = error.message;
      return false;
    } finally {
      try { await refresh(); } catch (error) { this.error = `Could not refresh configuration: ${error.message}`; }
      this.busy = false;
    }
  }
  receipt(key, now = Date.now()) { const r = this.results.get(key); return r && now - r.at < CONFIG_RESULT_MS ? r : null; }
  undo(key, now = Date.now()) {
    const receipt = this.receipt(key, now);
    if (!receipt || receipt.undo === null) return null;
    const pending = this.request([[key,receipt.undo]]);
    if (pending) this.results.delete(key);
    return pending;
  }
}

export function configSavedText(def, result, reset = false) {
  const where = result.daemon ? ` on ${result.daemon}` : "";
  if (result.resolved?.source === "env") return `Saved${where}, but OpenRig is using ${result.withheld ? "a withheld value" : result.resolved.value} from its environment instead.`;
  if (reset) return `✓ Reset to the default${where}.`;
  if (result.resolved?.source === "default") return `✓ Saved${where} (same as the default).`;
  if (def.restart) return `✓ Saved${where}. Takes effect when the daemon restarts.`;
  if (def.key.startsWith("retention.")) return `✓ Saved${where}. Applies at the next retention sweep.`;
  if (def.key.startsWith("snapshots.periodic.")) return `✓ Saved${where}. Selected when the snapshot scheduler starts.`;
  return `✓ Saved${where}. OpenRig doesn't confirm when it takes effect.`;
}
