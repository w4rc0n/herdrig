import { configDefinition, validateConfigValue, configPairPlan, configConsequence, configDeletesHistory,CONFIG_TERMINAL_KEYS } from "./rig-config-schema.js";

export const CONFIG_RESULT_MS = 10000;
export const PRESSURE_WARNING = "health.context_pressure.warning_percent";
export const PRESSURE_CRITICAL = "health.context_pressure.critical_percent";
const shown = entry => entry?.visibility !== "withheld" && !CONFIG_TERMINAL_KEYS.includes(entry?.key) && !/token|credential/i.test(entry?.key ?? "");
const valueOf = entry => shown(entry) ? String(entry?.value ?? "") : "";
const normalized = (def,value) => def.type === 'int' && /^-?\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? String(Number(value)) : String(value??'');
const restorable = entry => entry && shown(entry) && ['file','default'].includes(entry.source) && !configDefinition(entry).readOnly;

/** One editor, one pending confirmation, no implicit writes. Callers inject the reviewed transport. */
export class ConfigEditor {
  constructor(connection = '') { this.connection=connection;this.entries = []; this.row = null; this.results = new Map(); this.busy = false; this.approved = new WeakSet(); }
  observe(browser) { this.entries = Array.isArray(browser?.entries) ? browser.entries : []; }
  entry(key) { return this.entries.find(e => e.key === key); }
  open(key) {
    const entry = this.entry(key), def = configDefinition(entry);
    if (!entry || def.readOnly || this.busy) return false;
    if (this.row?.key === key) return true;
    if (this.row && this.dirty()) return false;
    this.cancel();
    const paired = [PRESSURE_WARNING, PRESSURE_CRITICAL].includes(key);
    const keys = paired ? [PRESSURE_WARNING, PRESSURE_CRITICAL] : [key];
    if(paired&&keys.some(k=>configDefinition(this.entry(k)).readOnly))return false;
    this.row = { key, keys, initial: Object.fromEntries(keys.map(k => [k, shown(this.entry(k)) ? valueOf(this.entry(k)) : null])), error: null };
    this.row.values = { ...this.row.initial };this.row.touched={};
    return true;
  }
  dirty() { return !!this.row && this.row.keys.some(key => this.row.values[key] !== this.row.initial[key]); }
  change(key, value) { if (this.row?.keys.includes(key) && !this.busy) { this.row.values[key] = value;this.row.touched[key]=true; this.row.error = null; this.confirmation = null; } }
  cancel() { if (!this.busy) { this.row = null; this.confirmation = null; } }
  cancelConfirmation() { this.confirmation=null; }
  commit() {
    if(this.busy||!this.row||this.confirmation)return null;
    if(this.row.keys.every(key=>normalized(configDefinition(this.entry(key)),this.row.values[key])===normalized(configDefinition(this.entry(key)),valueOf(this.entry(key))))){this.cancel();return null;}
    const plan=this.plan();
    if(plan.error){this.row.error=plan.error;return null;}
    const changes=plan.changes.filter(([key,value])=>normalized(configDefinition(this.entry(key)),value)!==normalized(configDefinition(this.entry(key)),valueOf(this.entry(key))));
    if(!changes.length){this.cancel();return null;}
    return this.request(changes);
  }
  plan() {
    if (!this.row) return { error: "Open a setting first" };
    for (const key of this.row.keys) {
      const error = validateConfigValue(configDefinition(this.entry(key)), this.row.values[key]);
      if (error) return { error };
    }
    const value=key=>normalized(configDefinition(this.entry(key)),this.row.values[key]);
    if (this.row.keys.length === 2) return configPairPlan(value(PRESSURE_WARNING), value(PRESSURE_CRITICAL), valueOf(this.entry(PRESSURE_WARNING)), valueOf(this.entry(PRESSURE_CRITICAL)));
    return { changes: [[this.row.key, value(this.row.key)]] };
  }
  request(changes, reset = false, undoReceipt = null) {
    if (this.busy || !changes.length) return null;
    if(undoReceipt&&undoReceipt!==this.latestReceipt)return null;
    if (this.row && this.dirty() && changes.some(([key]) => !this.row.keys.includes(key))) {
      return null;
    }
    for (const [key, value] of changes) {
      const def = configDefinition(this.entry(key));
      if (!this.entry(key) || def.readOnly || (!reset && validateConfigValue(def, value))) return null;
    }
    const groupKeys=undoReceipt?undoReceipt.keys:this.row&&changes.every(([key])=>this.row.keys.includes(key))?[...this.row.keys]:changes.map(([key])=>key);
    const old=groupKeys.map(key=>{const e=this.entry(key);return {key,value:restorable(e)?valueOf(e):null,source:restorable(e)?e.source:null};});
    const operations=changes.map(([key,value])=>({key,value,reset:undoReceipt?undoReceipt.old.find(v=>v.key===key)?.source==='default':reset}));
    const high = changes.find(([key,value]) => undoReceipt?configDeletesHistory(configDefinition(this.entry(key)),value,this.entry(key)?.value):configDefinition(this.entry(key)).risk === "high");
    const pending = { changes: changes.map(v => [...v]), operations,groupKeys,connection:this.connection,undoOf:undoReceipt, reset, old };
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
  async save(pending, write, refresh, now = Date.now, readCurrent = async key=>this.entry(key)) {
    if (this.busy || !pending || !this.approved.has(pending)) return false;
    this.approved.delete(pending);
    if(!pending.undoOf){this.results.clear();this.latestReceipt=null;this.lastSavedText=null;}
    this.busy = true; this.error = null; if(this.row)this.row.error=null; let completed = 0,finished=false;
    try {
      if(pending.connection!==this.connection)throw new Error('OpenRig connection changed; Undo is no longer available');
      if(pending.undoOf){
        await refresh();
        if(pending.undoOf!==this.latestReceipt||!this.receipt(pending.undoOf.keys[0],typeof now==='function'?now():now))throw new Error('Undo is no longer available');
        for(const key of pending.undoOf.keys){
          if(!restorable(this.entry(key))){pending.undoOf.changed=true;throw new Error("It changed since you saved, so it wasn't undone.");}
          const current=await readCurrent(key),expected=pending.undoOf.expected.find(v=>v.key===key);
          if(!restorable(this.entry(key))||!current||current.source!==expected?.source||JSON.stringify(current.value)!==JSON.stringify(expected?.value)){
            pending.undoOf.changed=true;throw new Error("It changed since you saved, so it wasn't undone.");
          }
        }
      }
      const expected=[];
      for (const {key,value,reset} of pending.operations) {
        // Re-check at the write boundary. A UI control or stale confirmation cannot add an unknown key.
        const def = configDefinition(this.entry(key));
        if (def.readOnly || !this.entry(key) || (!reset && validateConfigValue(def, value))) throw new Error("Setting changed; reopen it before saving");
        const result = await write(key, value, reset);
        if (!result.ok) throw new Error(result.error ?? "OpenRig refused the save");
        completed++;
        if(completed===1){this.results.clear();this.latestReceipt=null;}
        await refresh();
        const current = this.entry(key);
        const resolved = current ? {value:current.value,source:current.source} : result.resolved;
        const produced=result.resolved??resolved;
        expected.push({key,value:restorable(current)&&['file','default'].includes(produced?.source)?produced.value:null,source:produced?.source});
        this.lastSavedText=configSavedText(def,{...result,resolved,withheld:!shown(current)},reset);
      }
      for(const key of pending.groupKeys)if(!expected.some(v=>v.key===key)){const e=this.entry(key);expected.push({key,value:e?.value,source:e?.source});}
      // Finish checking before publishing Saved/Undo, so slow tunnels do not spend the usable window.
      await refresh();
      const receipt={at:typeof now==='function'?now():now,text:this.lastSavedText,keys:pending.groupKeys,old:pending.old,expected,connection:this.connection,
        undo:!pending.undoOf&&pending.old.every(v=>v.source!==null)&&pending.groupKeys.every(key=>restorable(this.entry(key)))?true:null};
      this.latestReceipt=receipt;for(const key of pending.groupKeys)this.results.set(key,receipt);
      this.row = null; this.confirmation = null;
      finished=true;
      return true;
    } catch (error) {
      if (this.row) this.row.error = `${completed ? `${completed} setting saved; the next was refused.\n` : ""}${error.message}`;
      else this.error = error.message;
      return false;
    } finally {
      if(!finished)try { await refresh(); } catch (error) { this.error = `Could not refresh configuration: ${error.message}`; }
      this.busy = false;
    }
  }
  receipt(key, now = Date.now()) { const r = this.results.get(key); return r && now - r.at < CONFIG_RESULT_MS ? r : null; }
  undoBlocked(key,now=Date.now()) {
    const r=this.receipt(key,now);if(!r||r.undo===null)return 'Undo is no longer available';
    if(this.busy)return 'Saving and checking; Undo is not ready yet.';
    if(r.connection!==this.connection)return 'OpenRig connection changed';
    if(r.changed||r.expected.some(v=>{const current=this.entry(v.key);return !restorable(current)||current.source!==v.source||JSON.stringify(current.value)!==JSON.stringify(v.value);}))return "Changed since, so it wasn't undone.";
    return null;
  }
  undo(key, now = Date.now()) {
    const receipt = this.receipt(key, now);
    if (this.undoBlocked(key,now)) return null;
    let changes=receipt.old.map(v=>[v.key,v.value]);
    if(receipt.keys.includes(PRESSURE_WARNING)&&receipt.keys.includes(PRESSURE_CRITICAL)){
      const value=k=>receipt.old.find(v=>v.key===k)?.value;
      const plan=configPairPlan(value(PRESSURE_WARNING),value(PRESSURE_CRITICAL),valueOf(this.entry(PRESSURE_WARNING)),valueOf(this.entry(PRESSURE_CRITICAL)));
      if(plan.error){this.error=plan.error;return null;}changes=plan.changes;
    }
    return this.request(changes,false,receipt);
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
