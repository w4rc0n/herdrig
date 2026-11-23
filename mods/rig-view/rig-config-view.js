import { div, svg } from "gpui-kit";
import {activationPair} from './rig-activation.js';
import { errorBlock } from "./rig-error-view.js";
import { h_flex, v_flex, InputState, Input, Select, Popup } from "gpui-base";
import { configRows, iconsAt, requestFailed, counted, withFocusContext, releaseFocusTargets } from "./rig-lib.js";
import { ConfigEditor, PRESSURE_WARNING, PRESSURE_CRITICAL } from "./rig-config-editor.js";
import { configDefinition, validateConfigValue,configPairPlan,CONFIG_TERMINAL_KEYS } from "./rig-config-schema.js";
import { configWriteError, writeDaemonConfig, readDaemonConfig,configOperationRequest,CONFIG_SAVE_TIMEOUT,configRejectedSaveResidual,configWriteState,waitForConfigWrites,beginConfigReconcile,finishConfigReconcile,failConfigReconcile,configReconcileResult,closeConfigWrites } from "./rig-config-write.js";
import { timezoneNote } from './rig-time.js';
import { gatedFetch, gatedOperationOrRefusal,gateSameConfig,GateRefusal,CONFIG_CHANGED_OPEN } from "./rig-gate.js";
const fetch = gatedFetch; // every request goes through the send gate
const icon = iconsAt("mods/rig-view");
const hidden = e => e?.visibility === "withheld" || CONFIG_TERMINAL_KEYS.includes(e?.key) || /token|credential/i.test(e?.key ?? "");
const textValue = e => hidden(e) ? "Value withheld by OpenRig" : String(e?.value ?? "unset");
const sourceName = e => ({file:"saved",env:"environment",default:"default"}[e.source] ?? e.source ?? "unreported");
const sameReviewConfig=(a,b)=>gateSameConfig(a,b)&&(a.person??null)===(b.person??null)&&JSON.stringify(a.rig??null)===JSON.stringify(b.rig??null);

/** The page owns this presentation object; the model contains no native input state. */
export class ConfigPanel {
  constructor(page) { this.page = page; this.model = new ConfigEditor(); this.inputs = {}; this.inputRevisions=new WeakMap();this.selected = null; this.releasedReviews=new WeakSet();this.reviewConfigs=new WeakMap();this.saves=new Map();this.writeWatches=new Map();this.reconcileStopped=new Set();this.writeOwner={}; }
  close(){this.disposed=true;releaseFocusTargets(this);this.writeWatchHandoff?.handle?.cancel?.();this.writeWatchHandoff=null;this.writeWatches.clear();this.cancelQueuedEditor();this.afterSave=null;this.releaseInputs();closeConfigWrites(this.writeOwner);for(const handle of this.controlHandles?.values()??[])handle.release();this.controlHandles?.clear();}
  get saving(){return this.saves.has(this.identity());}
  /** The connection this page SHOWS (v0.5.0: a page opened for box B reads and writes B). Null when that connection is no longer set up: the
   *  panel then has no origin and sends nothing; it never falls back to another connection (the first one above all). */
  cfg() { return typeof this.page.activeConfig === "function" ? this.page.activeConfig() : this.page.config; }
  origin() { return this.cfg()?.daemonUrl ?? ""; }
  identity() { const c=this.cfg();return JSON.stringify([this.origin(),c?.daemonMachine??null,c?.connectionId??null,c?.expectedHostId??null]); } // a changed host id is another OpenRig: another identity, nothing sent under the old
  daemonNameOf(identity) { try { const [origin,machine]=JSON.parse(identity);return machine||`the OpenRig at ${String(origin??"").replace(/^https?:\/\//,"")}`; } catch (_) { return "the earlier OpenRig"; } }
  /** The gate scope the bound identity was taken under: every send of a save or a reconcile names it. */
  scopeOf(identity) {
    if (!((this.page.config?.connections ?? []).length > 1)) return undefined; // one connection: the gate's only scope, exactly as before
    try { return JSON.parse(identity)?.[2] ?? null; } catch (_) { return null; }
  }
  hasFocus() { return Boolean(this.focusedField||[...(this.controlOrder??[]),...(this.controlHandles?.values()??[])].some(handle=>handle?.is_focused?.())); }
  selectRow(key,cx) {
    this.selected=key;this.selectedScope=this.page.settingsScope;this.page.pageSel=null;
    if(cx){this.keyboardLatches?.delete(`config-toggle-${key}`);this.focusHandle(`config-row-${key}`,cx)?.focus();}
  }
  clearSelection() { this.selected=null;this.selectedScope=null; }
  hasSelection() { return Boolean(this.selected&&this.selectedScope===this.page.settingsScope&&this.controlHandles?.get(`config-row-${this.selected}`)?.is_focused?.()); }
  ownsEscape() { return Boolean(this.more||this.model.row||this.model.confirmation||this.saving||this.model.busy||this.hasQueuedEditor()); }
  hasQueuedEditor() {const q=this.queuedTyping;return Boolean(q&&q.model===this.model&&q.identity===this.identity());}
  daemonName() { return this.cfg()?.daemonMachine || `the OpenRig at ${this.origin().replace(/^https?:\/\//,"")}`; }
  definition(entry) {
    const def=configDefinition(entry);
    if([PRESSURE_WARNING,PRESSURE_CRITICAL].includes(entry?.key)){
      const blocked=[PRESSURE_WARNING,PRESSURE_CRITICAL].map(k=>configDefinition(this.model.entry(k))).find(d=>d.readOnly);
      if(blocked)return {...def,readOnly:`These paired thresholds are read-only here. ${blocked.readOnly}`};
    }
    return def;
  }
  releaseInputs() { this.queuedOverflowRow=null;this.blurGeneration=(this.blurGeneration??0)+1;if(this.focusedField)this.page.typing=false;this.focusedField=null;for (const input of Object.values(this.inputs)) input.release?.(); this.inputs = {}; this.dropdown=null; this.selectHandles={}; }
  sync(origin, browser, probe) {
    const identity=this.identity();
    if (this.boundIdentity !== identity) {
      this.cancelQueuedEditor();
      // The page now shows another connection (or this one's address changed). An open edit is NOT dropped: its typed values are frozen
      // as a draft the person can copy, nothing is sent, and the panel rebinds to the new connection.
      const row=this.model?.row,touched=row?Object.keys(row.touched??{}).filter(k=>row.values?.[k]!==row.initial?.[k]):[];
      if(this.boundIdentity!==undefined&&row&&touched.length){this.frozenDraft={from:this.daemonNameOf(this.boundIdentity),values:touched.map(k=>[k,row.values[k]])};this.keyboardLatches?.delete("config-connection-draft-dismiss");}
      this.releaseInputs(); this.selected=null;this.model = new ConfigEditor(identity); this.boundOrigin = origin;this.boundIdentity=identity;this.nextKey=null;
    }
    this.model.observe(browser);
    if(configWriteState(identity)?.uncertain){this.model.results.clear();this.model.latestReceipt=null;this.model.lastSavedText=null;}
    const editingKeys=this.model.row?.keys??this.model.confirmation?.changes.map(([key])=>key)??[];
    if(!this.saving&&!this.model.busy&&editingKeys.some(key=>this.definition(this.model.entry(key)).readOnly)){
      this.model.cancel();this.releaseInputs();this.model.error='This setting is now read-only. The open edit was not saved.';
    }
    this.detected = !probe?.error && Object.hasOwn(probe?.data ?? {}, "value") && ["file","env","default"].includes(probe?.data?.source);
  }
  queueEditor(key) {
    if(this.queuedTyping?.key!==key||this.queuedTyping.model!==this.model||this.queuedTyping.identity!==this.identity())
      this.queuedTyping={key,model:this.model,identity:this.identity(),events:[],units:0,overflow:false};
    this.nextKey=key;
  }
  cancelQueuedEditor() {
    const key=this.queuedTyping?.key;
    if(key&&this.afterSave?.open===key)this.afterSave=null;
    this.queuedTyping=null;this.nextKey=null;
  }
  retainQueuedKey(event,cx) {
    const q=this.queuedTyping;
    if(!q)return false;
    if(q.model!==this.model||q.identity!==this.identity()){this.cancelQueuedEditor();return false;}
    if(this.model.row?.key===q.key&&this.inputs[q.key])return false;
    if(['bool','enum'].includes(this.definition(this.model.entry(q.key)).type))return false;
    if(event.modifiers?.control||event.modifiers?.platform||event.modifiers?.alt)return false;
    const backspace=event.key==='backspace';
    const text=typeof event.key_char==='string'?event.key_char:event.key==='space'?' ':Array.from(event.key??'').length===1?event.key:null;
    if(!backspace&&(!text||/[\x00-\x1f\x7f]/.test(text)))return false;
    cx.stop_propagation();
    if(q.events.length>=256||q.units+(text?.length??0)>4096)q.overflow=true;
    else {q.events.push(backspace?{backspace:true}:{text});q.units+=text?.length??0;}
    cx.notify();return true;
  }
  replayQueuedTyping(key) {
    const q=this.queuedTyping,input=this.inputs[key];
    if(!q||q.key!==key||q.model!==this.model||q.identity!==this.identity())return;
    this.queuedTyping=null;
    if(!input||!q.events.length)return;
    // A newly opened field selects its old value. The first edit replaces that
    // selection; later edits apply at the end, exactly as ordered key presses do.
    let value='';
    for(const edit of q.events)value=edit.backspace?Array.from(value).slice(0,-1).join(''):value+edit.text;
    this.inputRevisions.set(input,(this.inputRevisions.get(input)??0)+1);
    input.set_value(value);this.model.change(key,value);
    input.set_selected_range({start:value.length,end:value.length});
    if(q.overflow){this.queuedOverflowRow=this.model.row;this.model.row.error='Too much typing arrived before this setting opened. Only the first 256 keys (up to 4096 characters) were kept. Edit or cancel this value before saving.';}
  }
  open(key, cx, focus=true) {
    if(this.pauseWrites(cx))return;
    if (!this.detected || this.definition(this.model.entry(key)).readOnly) {if(this.queuedTyping?.key===key)this.cancelQueuedEditor();return;}
    if(this.saving||this.model.busy){if(this.model.row?.key!==key)this.queueEditor(key);else this.cancelQueuedEditor();return;}
    if(this.queuedTyping&&this.queuedTyping.key!==key)this.cancelQueuedEditor();
    if(this.model.confirmation)return;
    if(this.model.row?.keys.includes(key)){this.focusField(key,cx);return;}
    if(this.model.row){this.save(cx);if(this.model.row){if(this.saving)this.queueEditor(key);return;}}
    if (!this.model.open(key)) { cx.notify(); return; }
    if(!this.keysBound){
      cx.bind_keys([{keystroke:'tab',action:'herdrig_config_next',context:'HerdrigConfigInput'},
        {keystroke:'shift-tab',action:'herdrig_config_previous',context:'HerdrigConfigInput'}]);this.keysBound=true;
    }
    this.releaseInputs();
    const model=this.model,row=model.row;
    for (const field of this.model.row.keys) {
      const def = configDefinition(this.model.entry(field));
      if(def.choices?.length>4)this.selectHandles[field]={trigger:cx.focus_handle(),list:cx.focus_handle()};
      if (["enum","bool"].includes(def.type)) continue;
      const input = InputState.new({ value: this.model.row.values[field], placeholder: "" });
      const current=()=>this.model===model&&model.row===row&&this.inputs[field]===input;
      input.on("change", (_e, cx) => { if(!current())return;this.queuedOverflowRow=null;this.inputRevisions.set(input,(this.inputRevisions.get(input)??0)+1);model.change(field, input.value()); cx.notify(); });
      input.on("submit", (_e, cx) => {if(current())this.save(cx);});
      input.on('focus',(_e,cx)=>{
        if(!current())return;this.focusedField=field;this.page.typing=true;
        const value=input.value(),revision=this.inputRevisions.get(input),select=()=>input.set_selected_range({start:0,end:String(value??'').length});select();
        // Native Tab traversal may finish after the focus event. Do not replace text typed meanwhile.
        cx.timer?.after(16,next=>{if(current()&&this.focusedField===field&&input.value()===value&&this.inputRevisions.get(input)===revision)select();next.notify();});
      });
      input.on('blur',(_e,cx)=>{if(!current())return;if(this.focusedField===field){this.focusedField=null;this.page.typing=false;}this.deferBlur(cx);});
      this.inputs[field] = input;
    }
    if(focus){this.editorHandle??=cx.focus_handle();this.focusField(key,cx,true);}this.replayQueuedTyping(key);cx.notify();
  }
  focusField(key,cx,select=false) {
    const input=this.inputs[key]??Object.values(this.inputs)[0],row=this.model.row,generation=this.blurGeneration,revision=input?this.inputRevisions.get(input):undefined;
    const focus=(context)=>{if(this.disposed||this.model.row!==row||!row||this.blurGeneration!==generation)return;input?.focus();if(select&&input&&this.inputRevisions.get(input)===revision)input.set_selected_range({start:0,end:String(input.value()??'').length});if(!input){const def=configDefinition(this.model.entry(key)),value=row.values[key],choice=def.choices?.[Math.max(0,def.choices.indexOf(value))]??value;(this.selectHandles[key]?.trigger??this.focusHandle(`config-choice-${key}-${choice||'unset'}`,context))?.focus();}};
    focus(cx);cx.timer?.after(0,next=>{focus(next);next.notify();});
  }
  deferBlur(cx) {
    const row=this.model.row,generation=this.blurGeneration;
    cx.timer.after(0,next=>{if(this.model.row===row&&this.blurGeneration===generation&&!this.focusedField&&!this.model.confirmation&&!this.saving)this.save(next);next.notify();});
  }
  tabField(field,backward,cx) {
    if(this.saving||this.model.busy||this.model.confirmation||!this.model.row)return;
    const keys=this.model.row.keys,index=keys.indexOf(field),next=index+(backward?-1:1);
    if(next>=0&&next<keys.length){this.focusField(keys[next],cx,true);return;}
    const order=(this.controlOrder??[]).filter(Boolean),controlIndex=order.findIndex(handle=>handle.field===field),target=order[controlIndex+(backward?-1:1)];
    if(this.save(cx)!==false){if(target)target.focus();else if(backward)window.focus_prev();else window.focus_next();}
  }
  cancel(cx) { this.cancelQueuedEditor();if(this.saving||this.model.busy)return;this.model.cancel();this.releaseInputs(); cx.notify(); }
  keyDown(event,cx) {
    if(event.key==="escape"&&this.more){cx.stop_propagation();this.more=null;cx.notify();return true;}
    if(event.key==="escape"&&(this.model.row||this.model.confirmation||this.saving||this.model.busy||this.queuedTyping)) {
      cx.stop_propagation();this.cancelQueuedEditor();if(this.saving||this.model.busy)return true;
      if(this.model.confirmation){this.model.cancelConfirmation();this.focusField(this.model.row?.key,cx);}else this.cancel(cx);cx.notify();return true;
    }
    if(this.retainQueuedKey(event,cx))return true;
    if(["enter","space"," "].includes(event.key)&&this.hasSelection()&&!this.model.row&&!this.model.confirmation) {
      cx.stop_propagation();this.keyboardAction(`config-toggle-${this.selected}`,event,cx,()=>this.activate(this.model.entry(this.selected),cx));return true;
    }
    return false;
  }
  async refresh(origin,request=fetch,model=this.model,identity=this.identity()) {
    const response = await request(`${origin.replace(/\/$/, "")}/api/config?view=browser`);
    if (!response.ok) throw new Error(requestFailed("its settings", response.status));
    const data = await response.json();
    return this.applyRefresh(data,origin,model,identity);
  }
  applyRefresh(data,origin,model,identity){
    if (this.disposed||this.origin() !== origin||this.identity()!==identity||this.model!==model) throw new Error("OpenRig connection changed during the save");
    this.page.cache["/api/config?view=browser"] = { data, at: Date.now() }; model.observe(data);
    const zone=data?.entries?.find(e=>e.key==='ui.timezone'&&!hidden(e));
    this.page.cache['/api/config/ui.timezone']={data:zone?{value:zone.value}:null,at:Date.now()};
    return data;
  }
  pauseWrites(cx){
    const state=this.writePauseState();if(!state?.blocked)return false;
    this.model.error=state.reason;if(this.model.row)this.model.row.error=state.reason;
    if(state.uncertain)this.watchWrites(cx);cx.notify();return true;
  }
  writePauseState(){
    const identity=this.identity(),state=configWriteState(identity);
    if(state?.pending)return state;
    return this.reconcileStopped.has(identity)?{blocked:true,uncertain:true,failed:true,reason:'The last save could not be checked on this page. Reopen this page before saving again.'}:state;
  }
  watchWrites(cx,binding={origin:this.origin(),model:this.model,identity:this.identity()}){
    if(this.disposed)return;
    const {model,identity}=binding;
    const op=binding.op??gatedOperationOrRefusal(this.scopeOf(identity)); // the reconciling reads belong to the generation and the connection the origin was captured under
    if(configWriteState(identity)?.ownerClosed||this.reconcileStopped.has(identity)||this.writeWatches.get(identity)?.model===model)return;
    this.writeWatches.set(identity,{model,binding:{...binding,op},settled:waitForConfigWrites(identity),pending:true});
    cx.notify();
  }
  consumeWriteWatches(cx){
    if(this.disposed||this.writeWatchHandoff||![...this.writeWatches.values()].some(watch=>watch.pending))return;
    const ticket={handle:null};this.writeWatchHandoff=ticket;
    ticket.handle=cx.timer.after(0,live=>{
      if(this.disposed||this.writeWatchHandoff!==ticket)return;
      this.writeWatchHandoff=null;
      for(const [identity,watch]of this.writeWatches){
        if(!watch.pending)continue;
        watch.pending=false;this.runWriteWatch(live,identity,watch);
      }
    });
  }
  runWriteWatch(cx,identity,watch){
    if(this.disposed||this.writeWatches.get(identity)!==watch)return;
    const {origin,model,rejected,op}=watch.binding;
    cx.spawn(async next=>{
      let request,record,token;
      const current=()=>!this.disposed&&this.identity()===identity&&this.model===model;
      try{
        // Keep the pure settlement reference from request time: another panel
        // may finish and retire the shared record before this page gets a draw.
        record=await watch.settled;
        const state=configWriteState(identity);
        if(record?.ownerClosed||state?.ownerClosed)return;
        let result;
        if(!state?.uncertain){result=record?.result;if(!result?.ok)return;}
        else{
         if(!current()){failConfigReconcile(identity,record);this.reconcileStopped.add(identity);return;}
         token=beginConfigReconcile(identity,record,this.writeOwner);
         if(token){
          // Reconciliation resumes after a raw write settles, outside this view's call.
          // Its bounded deadline has no ambient view owner and is cancelled in finally.
          request=configOperationRequest(op.fetch,(ms,fn)=>next.timer.after(ms,fn,{owner:null}));
          const data=await this.refresh(origin,request,model,identity);
          finishConfigReconcile(identity,record,token,data);result={ok:true,data};
         }else result=await configReconcileResult(record);
        }
        if(!result.ok)throw new Error('The last save could not be reconciled');
        if(current()){
          this.applyRefresh(result.data,origin,model,identity);this.reconciledModel=model;this.reconciledRejectedModel=record?.rejected?model:null;
          const entry=model.entry(rejected?.key);this.reconciledRejectedText=configRejectedSaveResidual(entry&&!hidden(entry)?rejected?.value:null);
          model.error=null;
          if(model.row)model.row.error=null;
        }
      }catch(error){
        if(token)finishConfigReconcile(identity,record,token,null,error);
        this.reconcileStopped.add(identity);
        if(current()){model.error=configWriteState(identity)?.reason??error.message;if(model.row)model.row.error=model.error;}
      }finally{request?.finish();if(this.writeWatches.get(identity)===watch)this.writeWatches.delete(identity);if(!this.disposed)next.notify();}
    });
  }
  execute(cx, pending) {
    if (!pending) {
      if(this.model.confirmation){
        const confirmation=this.model.confirmation;this.cancelHandle??=cx.focus_handle?.();this.confirmHandle??=cx.focus_handle?.();
        const shown=this.cfg();if(!this.reviewConfigs.has(confirmation))this.reviewConfigs.set(confirmation,{...shown,rig:Array.isArray(shown?.rig)?[...shown.rig]:shown?.rig});
        const handle=this.cancelHandle;handle?.focus?.();
        cx.timer?.after(16,next=>{if(this.model.confirmation===confirmation)handle?.focus();next.notify();});
      }
      cx.notify(); return;
    }
    if(this.saving||this.model.busy)return;
    if(this.pauseWrites(cx))return;
    const origin = this.boundOrigin, model = this.model,identity=this.boundIdentity,draft=model.row,expectedHost=this.cfg()?.expectedHostId??null;
    const op=gatedOperationOrRefusal(this.scopeOf(identity)); // the origin above belongs to this generation and this connection: a deferred send after the settings changed is refused
    const reviewed=this.reviewConfigs.get(pending);
    const checkCurrent=()=>{
      if(this.identity()!==identity||this.model!==model||(reviewed&&!sameReviewConfig(reviewed,this.cfg())))throw new GateRefusal(CONFIG_CHANGED_OPEN);
      op.check();
    };
    const request=configOperationRequest((...args)=>{checkCurrent();return op.fetch(...args);},(ms,fn)=>cx.timer.after(ms,fn),identity,this.writeOwner,this.daemonName());
    this.saves.set(identity,request);this.reconciledModel=null;this.reconciledRejectedModel=null;this.reconciledRejectedText=null;
    cx.spawn(async cx => {
      let rejected;
      try{await model.save(pending, (key, value, reset) => {
        if (this.identity() !== identity || this.model !== model) return { ok:false, error:"OpenRig connection changed; reopen the setting" };
        // A connection that recorded its OpenRig's host id writes only to that OpenRig: its address answering as another one refuses before the write
        // (the same rule as a box spec save). A null expectedHostId (the legacy connection) is decided by the address, as before.
        const sameHost=expectedHost?request(`${origin}/healthz`).then(async r=>{let h;try{h=await r.json();}catch{h=null;}return h?.selfHostId===expectedHost?null:h?.selfHostId??'';}):Promise.resolve(null);
        return sameHost.then(other=>other!==null?{ok:false,error:`This setting wasn't saved: ${this.daemonNameOf(identity)}'s connection now reaches a different OpenRig. Nothing was written.`}
          :writeDaemonConfig({origin,key,value,reset,entry:model.entry(key),detected:this.detected},request))
          .then(result=>{if(!result.ok)rejected={key,value:hidden(model.entry(key))?null:reset?'the default':value};return {...result,daemon:this.daemonName()};});
      }, () => this.refresh(origin,request,model,identity),Date.now,async key=>{
        if(this.identity()!==identity||this.model!==model)throw new Error('OpenRig connection changed; Undo is no longer available');
        const result=await readDaemonConfig({origin,key,entry:model.entry(key),detected:this.detected},request);
        if(!result.ok)throw new Error(result.error);return result.resolved;
      },checkCurrent);}finally{
        if(request.expired()){
          model.results.clear();model.latestReceipt=null;model.lastSavedText=null;model.error=CONFIG_SAVE_TIMEOUT;
          if(!model.row&&draft)model.row=draft;
          if(model.row)model.row.error=CONFIG_SAVE_TIMEOUT;
        }
        request.finish();if(this.saves.get(identity)===request)this.saves.delete(identity);
        if(configWriteState(identity)?.uncertain){
          const reason=configWriteState(identity).reason;model.error=reason;if(model.row)model.row.error=reason;
          this.watchWrites(cx,{origin,model,identity,rejected,op});
        }
      }
      // After the save's awaits: what opens or takes focus next is made by the panel's next draw (afterSave), never here, where its inputs and
      // focus handles would belong to whichever view drained the promise jobs.
      if(request.expired()&&this.model===model&&!model.row){this.cancelQueuedEditor();this.afterSave={model,open:pending.changes[0][0],error:CONFIG_SAVE_TIMEOUT};}
      else if(this.model===model){
        if (!model.row) {this.releaseInputs();const key=this.nextKey;this.nextKey=null;if(key)this.afterSave={model,open:key};}
        else {this.cancelQueuedEditor();this.afterSave={model,focus:model.row.key};}
      }
      cx.notify();
    });
    cx.notify();
  }
  save(cx) {
    if(!this.model.row||this.saving||this.model.busy||this.model.confirmation)return;
    if(this.queuedOverflowRow===this.model.row){cx.notify();return false;}
    if(this.pauseWrites(cx))return false;
    const pending=this.model.commit();
    if(!this.model.row){this.releaseInputs();cx.notify();return;}
    if(this.model.row.error){this.focusField(this.model.row.key,cx);cx.notify();return false;}
    this.execute(cx,pending);return !this.model.confirmation;
  }
  activate(entry,cx){if(!entry||this.definition(entry).readOnly)return;this.selectRow(entry.key);if(configDefinition(entry).type==='bool')this.toggle(entry,cx);else this.open(entry.key,cx);}
  choose(field,value,cx){this.model.change(field,value);this.dropdown=null;this.save(cx);}
  // A bool commits immediately: focusing its transient choice would leave native focus
  // on a removed control after save, outside the card's Tab context. Keep the row/control.
  toggle(entry, cx) { this.open(entry.key,cx,false);if(this.model.row?.keys.includes(entry.key)&&!this.saving){this.model.change(entry.key,entry.value === true || entry.value === "true" ? "false" : "true");this.save(cx);} }
  reset(entry, cx) {
    this.more=null;if(this.saving||this.model.busy)return;
    if(this.pauseWrites(cx))return;
    this.open(entry.key,cx);if(!this.model.row?.keys.includes(entry.key))return;
    let changes=this.model.row.keys.map(key=>[key,String(this.model.entry(key)?.defaultValue??'')]);
    if(this.model.row.keys.every(key=>this.model.entry(key)?.source==='default')){this.cancel(cx);return;}
    if(this.model.row.keys.length===2){
      const value=key=>changes.find(v=>v[0]===key)?.[1],current=key=>String(this.model.entry(key)?.value??'');
      const plan=configPairPlan(value(PRESSURE_WARNING),value(PRESSURE_CRITICAL),current(PRESSURE_WARNING),current(PRESSURE_CRITICAL));
      if(plan.error){this.model.row.error=plan.error;this.focusField(entry.key,cx);cx.notify();return;}changes=plan.changes;
    }
    for(const [key,value]of changes){this.model.change(key,value);this.inputs[key]?.set_value(value);}
    this.execute(cx,this.model.request(changes,true));
  }
  focusHandle(id,cx){
    this.controlHandles??=new Map();this.pendingHandles??=new Set();
    if(!this.controlHandles.has(id)&&!this.pendingHandles.has(id)){
      this.pendingHandles.add(id);
      // Herdr forbids creating handles during render. Retain them after the event frame instead.
      cx.timer.after(0,next=>{this.pendingHandles.delete(id);if(this.disposed)return;
        if(!this.controlsBound){next.bind_keys([{keystroke:'tab',action:'herdrig_settings_next',context:'HerdrigSettings'},{keystroke:'shift-tab',action:'herdrig_settings_previous',context:'HerdrigSettings'}]);this.controlsBound=true;}
        this.controlHandles.set(id,next.focus_handle());next.notify();});
    }
    return this.controlHandles.get(id);
  }
  keyboardAction(id,event,cx,fn){
    this.keyboardLatches??=new Map();
    if(!['enter','space',' '].includes(event.key)){this.keyboardLatches.delete(id);return;}
    cx.stop_propagation();
    // X11 repeat may contain release/press pairs. A release alone never rearms a save.
    // Keep the latch through temporary removal while saving; explicit navigation or a click rearms it.
    if(event.is_held||this.keyboardLatches.get(id)===event.key)return;
    this.keyboardLatches.set(id,event.key);fn({},cx);
  }
  focusControl(t,cx,id,child,fn,{disabled=false,handle,tabStop=true,onKey,writeActivation=true,tip}={}){
    const paired=activationPair(this,id);
    handle??=this.focusHandle(id,cx);
    if(!disabled&&tabStop)this.controlOrder?.push(handle);
    return div().id(`${id}-focus`).when(!!tip,el=>el.tooltip(tip)).p(2).border(2).border_color('#00000000').rounded(7).role('button')
      .when(!!handle,el=>el.track_focus(handle)).tab_stop(!disabled&&tabStop).focus(el=>el.border_color(t.accent))
      .on_mouse_down('left',paired.pointer()).on_key_down(paired.key((event,ctx)=>{
        if(onKey?.(event,ctx))return;
        if(disabled)return;
        // Reversible navigation does not share the persistent write latch.
        if(!writeActivation){if(['enter','space',' '].includes(event.key)){ctx.stop_propagation();if(!event.is_held)fn({},ctx);}return;}
        this.keyboardAction(id,event,ctx,fn);
      })).child(child);
  }
  tabControl(backward,cx){
    this.keyboardLatches?.clear();
    const handles=(this.controlOrder??[]).filter(Boolean),index=handles.findIndex(handle=>handle.is_focused());
    const next=index<0?(backward?handles.length-1:0):index+(backward?-1:1);
    if(next<0||next>=handles.length)return false;
    handles[next].focus();cx.notify();return true;
  }
  action(t,cx,id,label,fn,options={}) {
    const paired=activationPair(this,id);
    const child=this.page.button(t,id,label,paired.click((event,ctx)=>{this.keyboardLatches?.delete(id);fn(event,ctx);}),{small:true,...options})
      .on_mouse_down('left',paired.pointer())
      .when(options.primary&&!options.disabled,el=>el.bg(t.accent).text_color(t.solid_foreground).hover(s=>s.bg(t.accent)));
    return options.keyboard===false?child:this.focusControl(t,cx,id,child,fn,options);
  }
  choices(t,cx,field,values,value,disabled=false){
    const handles=values.map(choice=>this.focusHandle(`config-choice-${field}-${choice||'unset'}`,cx));
    const focused=handles.findIndex(handle=>handle?.is_focused());
    const active=focused<0?Math.max(0,values.indexOf(value)):focused;
    return h_flex().id(`config-choices-${field}`).gap(4).flex_wrap().children(values.map((choice,index)=>
      this.action(t,cx,`config-choice-${field}-${choice||'unset'}`,choice||'unset',(_e,ctx)=>this.choose(field,choice,ctx),{
        tip:`Set ${field} to ${choice||'unset'} and save`,primary:value===choice,disabled,handle:handles[index],tabStop:index===active,
        onKey:(event,ctx)=>{
          if(event.key!=='left'&&event.key!=='right')return false;
          ctx.stop_propagation();handles[Math.max(0,Math.min(values.length-1,index+(event.key==='right'?1:-1)))]?.focus();ctx.notify();return true;
        }
      })));
  }
  integerHint(def,field) {
    const bounds=def.min===undefined&&def.max===undefined?'any whole number':def.max===undefined?`any whole number ≥ ${def.min}`:def.min===undefined?`any whole number ≤ ${def.max}`:`${def.min}–${def.max}`;
    return `${bounds}${def.unit?' '+def.unit:''} · default ${this.model.entry(field)?.defaultValue??'unset'}`;
  }
  cancelReview(cx){this.model.cancelConfirmation();this.focusField(this.model.row?.key,cx);cx.notify();}
  reviewAction(t,id,label,fn,handle,{disabled=false,primary=false,destructive=false,tip}={}){
    const paired=activationPair(this,id);
    if(!disabled)this.controlOrder?.push(handle);
    const model=this.model,review=model.confirmation,activation=key=>['enter','space',' '].includes(key);
    return div().id(`${id}-focus`).when(!!tip,el=>el.tooltip(tip)).p(2).border(2).border_color('#00000000').rounded(7).role('button')
      .when(!!handle&&!disabled,el=>el.track_focus(handle)).tab_stop(!disabled).focus(el=>el.border_color(t.accent))
      // Cancel-first is the repeat safety boundary. This release gate is secondary; explicit Tab navigation arms it too.
      .on_key_up((event,cx)=>{if((activation(event.key)||event.key==='tab')&&this.model===model&&model.confirmation===review){cx.stop_propagation();this.releasedReviews.add(review);}})
      .on_mouse_down('left',paired.pointer())
      .on_key_down(paired.key((event,cx)=>{if(activation(event.key)){cx.stop_propagation();if(!disabled&&!event.is_held&&this.model===model&&model.confirmation===review&&this.releasedReviews.has(review))fn({},cx);}}))
      .child(this.action(t,null,id,label,fn,{disabled,primary,keyboard:false,tip}).when(destructive,el=>el.bg(t.blocked).text_color(t.solid_foreground).hover(s=>s.bg(t.blocked))));
  }

  select(t,cx,field,def,value) {
    const handles=this.selectHandles[field],open=this.dropdown===field;
    this.controlOrder?.push(open?handles.list:handles.trigger);
    const choose=(choice,cx)=>{this.choose(field,choice,cx);cx.notify();};
    const trigger=h_flex().id(`config-select-trigger-${field}`).gap(8).px(8).h(28).items_center().rounded(5).border_1().border_color(t.border)
      .tooltip(`Choose a value for ${field}`).cursor_pointer().on_click((_e,cx)=>{
        this.dropdown=open?null:field;this.highlight=Math.max(0,def.choices.indexOf(value));
        if(!open)cx.timer.after(0,next=>{if(this.dropdown===field)handles.list.focus();next.notify();});
        else handles.trigger.focus();cx.notify();
      }).child(value===null?"Choose…":value||"unset").child(svg(icon("chevron-down")).size(12).text_color(t.muted));
    const list=v_flex().id(`config-select-list-${field}`).p(4).gap(2).rounded(5).bg(t.raised).border_1().border_color(t.border)
      .track_focus(handles.list).tab_stop(true).on_key_down((event,cx)=>{
        if(event.key==="up"||event.key==="down"){
          cx.stop_propagation();this.highlight=((this.highlight??0)+(event.key==="down"?1:-1)+def.choices.length)%def.choices.length;cx.notify();
        }else if(event.key==="enter"){cx.stop_propagation();choose(def.choices[this.highlight??0],cx);}
      }).children(def.choices.map((choice,index)=>this.action(t,cx,`config-option-${field}-${index}`,choice||"unset",(_e,cx)=>choose(choice,cx),{primary:this.highlight===index,keyboard:false,tip:`Set ${field} to ${choice||'unset'} and save`})
        .role("list_box_option").aria_selected(value===choice).when(this.highlight===index,el=>el.aria_active_descendant())));
    return Select.new(`config-select-${field}`).accessibility_label(field).open(open).track_focus(handles.trigger)
      .content_focus_handle(handles.list).on_open_change((next,cx)=>{
        this.dropdown=next?field:null;this.highlight=Math.max(0,def.choices.indexOf(value));cx.notify();
      }).on_confirm((_e,cx)=>choose(def.choices[this.highlight??0],cx))
      .child(Popup.new(`config-select-popup-${field}`,div().id(`config-select-trigger-${field}-focus`).p(2).border(2).border_color('#00000000').rounded(7)
        .track_focus(handles.trigger).tab_stop(true).focus(el=>el.border_color(t.accent)).child(trigger)).when(open,el=>el.content(list)));
  }

  control(t,cx) {
    const m=this.model,row=m.row;
    const control=v_flex().id(`config-control-${row.key}`).gap(4).min_w(140).max_w(400).flex_1()
      // Anything pressed or clicked inside the editor (an input, a sub-label, a hint line, the gap between inputs) is the editor's: the row's click would focus the row, blur the input and save a half-typed value.
      .on_mouse_down('left',(_e,ctx)=>ctx.stop_propagation())
      .on_click((_e,ctx)=>ctx.stop_propagation())
      .on_mouse_down_out((_e,ctx)=>{
        if(m!==this.model||m.row!==row||m.confirmation||this.saving||m.busy)return;
        if(this.save(ctx)===false)ctx.stop_propagation();
      });
    if(this.saving||m.busy)return control.child(div().text_color(t.dim).text_size(12).child('Saving and checking…'));
    for(const field of row.keys){
      const def=configDefinition(m.entry(field)),value=row.values[field];
      if(row.keys.length>1)control.child(div().text_size(11).text_color(t.dim).child(field===PRESSURE_WARNING?'Warning':'Critical'));
      if(def.choices?.length>4&&this.selectHandles[field])control.child(this.select(t,cx,field,def,value));
      else if(def.choices&&def.type!=='stream')control.child(this.choices(t,cx,field,def.choices,value,m.busy));
      else if(def.type==='bool')control.child(this.choices(t,cx,field,['true','false'],value,m.busy));
      else if(this.inputs[field]){const input=this.inputs[field];this.controlOrder?.push({field,focus:()=>input.focus(),is_focused:()=>this.focusedField===field});control.child(div().id(`config-input-guard-${field}`)
        .key_context('HerdrigConfigInput')
        .on_action('herdrig_config_next',(_e,ctx)=>{ctx.stop_propagation();this.tabField(field,false,ctx);})
        .on_action('herdrig_config_previous',(_e,ctx)=>{ctx.stop_propagation();this.tabField(field,true,ctx);})
        .on_key_down((event,ctx)=>{
          if(event.key==='escape'){ctx.stop_propagation();this.cancel(ctx);}
          else if(event.key==='enter'){ctx.stop_propagation();this.save(ctx);}
          else if(event.key==='tab'){
            ctx.stop_propagation();this.tabField(field,!!event.modifiers?.shift,ctx);
          }else this.page.typing=true;
        }).child(Input.new(input).id(`config-input-${field}`).h(30).px(8).rounded(5).border_1().border_color(t.border).bg(t.background).text_color(t.foreground)));}
      if(row.keys.length>1&&def.type==='int')control.child(div().id(`config-hint-${field}`).text_size(11).text_color(t.dim).child(this.integerHint(def,field)));
    }
    return control;
  }

  rowPlan(browser,scope,filter) {
    const m=this.model,pinned=new Set([this.selected,...(m.row?.keys??[]),...(m.confirmation?.changes.map(([key])=>key)??[])].filter(Boolean));
    const ownRows=configRows(browser,scope);
    for(const row of configRows(browser))if(pinned.has(row.key)&&!ownRows.some(other=>other.key===row.key))ownRows.push(row);
    const names={instance:'Instance',context:'Context',display:'Display',waiting:'Waiting',recovery:'Recovery',activity:'Activity',agents:'Agents',slack:'Slack',all:'Other',readonly:'Read-only here'};
    const rows=ownRows.map(row=>({entry:m.entry(row.key),group:row.group,sourceGroup:row.group})).filter(row=>row.entry).map(row=>({...row,group:this.definition(row.entry).readOnly?'readonly':row.group}));
    const editable=rows.filter(row=>row.group!=='readonly').length;
    const ordered=[...rows.filter(row=>row.group!=='readonly'),...rows.filter(row=>row.group==='readonly')];
    if(filter){
      const matches=ordered.filter(row=>pinned.has(row.entry.key)||`${row.entry.key} ${row.sourceGroup}`.toLowerCase().includes(filter));
      const ordinary=matches.filter(row=>!pinned.has(row.entry.key));
      const shown=new Set(ordinary.slice(0,40).map(row=>row.entry.key));
      return{editable,total:rows.length,filtered:true,blocks:[{rows:matches.filter(row=>pinned.has(row.entry.key)||shown.has(row.entry.key))}],more:ordinary.length-shown.size};
    }
    const categories=rows.length>30;
    const blocks=Object.entries(names).map(([group,label])=>{
      const all=ordered.filter(row=>row.group===group),pins=all.filter(row=>pinned.has(row.entry.key));
      const active=this.activeCategory===group,forced=pins.length>0;
      const normal=new Set(all.filter(row=>!pinned.has(row.entry.key)).slice(0,40).map(row=>row.entry.key));
      const visible=!categories?all:active?all.filter(row=>pinned.has(row.entry.key)||normal.has(row.entry.key)):pins;
      const heldByReview=all.some(row=>m.confirmation?.changes.some(([key])=>key===row.entry.key));
      const heldByEdit=all.some(row=>m.row?.keys.includes(row.entry.key));
      const pinReason=heldByReview?'Held open by changes waiting to be saved':heldByEdit?'Finish or cancel the edit first':'Held open by the selected row';
      return{group,label,total:all.length,forced,active,rows:visible,more:all.length-visible.length,pinReason};
    }).filter(block=>block.total);
    return{editable,total:rows.length,categories,blocks};
  }
  categoryChange(group,forced,cx,open) {
    if(open===false){if(!forced&&this.activeCategory===group)this.activeCategory=null;}
    else this.activeCategory=this.activeCategory===group&&open!==true&&!forced?null:group;
    cx.notify();
  }
  navigateRows(id,key,cx) {
    const order=this.rowNavigation??[],headers=order.filter(item=>item.groupHeader),index=order.findIndex(item=>item.id===id);
    let target;
    if(key==='home')target=headers[0];
    else if(key==='end')target=headers.at(-1);
    else if(key==='up'||key==='down')target=order[index+(key==='up'?-1:1)];
    else if(key==='left'&&!order[index]?.groupHeader)target=headers.find(item=>item.group===order[index]?.group);
    else return false;
    cx.stop_propagation();if(!target)return true;
    if(target.key){this.selected=target.key;this.selectedScope=this.page.settingsScope;}
    this.controlHandles?.get(target.id)?.focus();cx.notify();return true;
  }
  categoryHeader(t,cx,block) {
    const id=`config-category-${block.group}`,handle=this.focusHandle(id,cx),paired=activationPair(this,id),open=block.active||block.forced;
    this.controlOrder.push(handle);this.rowNavigation.push({id,group:block.group,groupHeader:true});
    return h_flex().id(id).h(26).gap(8).items_center().px(8).rounded(4).role('button').cursor_pointer().hover(el=>el.bg(t.hover))
      .tooltip(block.forced?block.pinReason:open?'Collapse':'Expand')
      .when(!!handle,el=>el.track_focus(handle)).tab_stop(true).focus(el=>el.border_l(2).border_color(t.accent))
      .on_mouse_down('left',(event,ctx)=>{ctx.stop_propagation();paired.pointer()(event,ctx);handle?.focus();})
      .on_click(paired.click((_event,ctx)=>{ctx.stop_propagation();this.categoryChange(block.group,block.forced,ctx);}))
      .on_key_down(paired.key((event,ctx)=>{
        if(['enter','space',' '].includes(event.key)){ctx.stop_propagation();if(!event.is_held)this.categoryChange(block.group,block.forced,ctx);}
        else if(event.key==='right'||event.key==='left'){ctx.stop_propagation();this.categoryChange(block.group,block.forced,ctx,event.key==='right');}
        else this.navigateRows(id,event.key,ctx);
      }))
      .child(div().text_size(12).text_color(t.muted).child(block.label))
      .child(div().flex_1().text_size(11).text_color(t.dim).child(`${block.total} ${block.group==='readonly'?'read-only':'settable'}`))
      .child(div().id(`${id}-chevron`).when(block.forced,el=>el.tooltip(block.pinReason))
        .child(svg(icon(open?'chevron-down':'chevron-right')).size(12).text_color(block.forced?t.dim:t.muted)));
  }
  render(...args){return withFocusContext(this,args[1],()=>this.renderFocused(...args));}
  renderFocused(t,cx,browser,probe,scope={}) {
    this.consumeWriteWatches(cx);
    this.controlOrder=[];
    this.rowNavigation=[];
    // What a save asked to open or focus next: made through a timer set from this draw, so its inputs and focus handles are the page's own.
    if(this.afterSave&&!this.afterSaveTimer&&cx?.timer?.after){
      this.afterSaveTimer=true;
      cx.timer.after(0,next=>{
        this.afterSaveTimer=false;const want=this.afterSave;this.afterSave=null;
        if(!want||this.disposed||this.model!==want.model||!next)return;
        if(want.open){this.open(want.open,next);if(want.error&&this.model.row)this.model.row.error=want.error;}
        else if(want.focus&&this.model.row?.key===want.focus)this.focusField(want.focus,next);
        next.notify?.();
      });
    }
    this.sync(this.origin(),browser,probe);
    const m=this.model,filter=String(this.page.filter??'').trim().toLowerCase(),plan=this.rowPlan(browser,scope,filter);
    const out=[div().id("config-edit-summary").text_size(11.5).text_color(t.muted).child(`${plan.editable} settable · ${plan.total-plan.editable} read-only`)];
    const writePause=this.writePauseState();
    if(writePause?.uncertain)out.push(div().id('config-write-paused').text_size(12).text_color(writePause.ownerClosed||writePause.failed?t.blocked:t.working).child(errorBlock(this,t,"config-write-paused-detail",writePause.reason)));
    if (!this.detected) out.push(div().id("config-edit-unavailable").text_size(11.5).text_color(t.dim)
      .child(probe?.status ? errorBlock(this,t,"config-probe-error",configWriteError(probe.status,probe.errorData))
        : "This OpenRig hasn't confirmed support for editing settings from Herdr. Use rig config set on that machine."));
    if(this.frozenDraft){
      const d=this.frozenDraft,text=d.values.map(([k,v])=>`${k} = ${v}`).join("\n");
      out.push(v_flex().id("config-connection-draft").gap(4).p(8).rounded(6).bg(t.raised??t.hover).border_1().border_color(t.border)
        .child(div().text_size(13.5).text_color(t.foreground).child("This page's OpenRig changed, so nothing more is sent from it."))
        .child(div().text_size(12).text_color(t.muted).child(`Your edit for ${d.from} wasn't saved: ${d.values.map(([k,v])=>`${k} = ${v}`).join(", ")}. Copy it, then set it again where you want it.`))
        .child(h_flex().gap(8).items_center()
          .child(h_flex().id("config-connection-draft-copy").gap(4).items_center().child(this.page.copyButton(t,text,"config-connection-draft","my text")).child(div().text_size(12).text_color(t.muted).child("Copy my text")))
          .child(this.focusControl(t,cx,"config-connection-draft-dismiss",
            div().id("config-connection-draft-dismiss").tooltip('Hide this note; your copied text stays on the clipboard').px(6).py(2).rounded(4).text_size(12).text_color(t.muted).cursor_pointer().hover(s=>s.bg(t.hover))
              .on_click((_e,ctx)=>{this.keyboardLatches?.delete("config-connection-draft-dismiss");this.frozenDraft=null;ctx.notify();}).child("Dismiss"),
            (_e,ctx)=>{this.frozenDraft=null;ctx.notify();}))))
    }
    if(m.error&&!writePause?.uncertain)out.push(div().id("config-edit-error").text_size(12).text_color(m.errorTone==='working'?t.working:t.blocked).child(errorBlock(this,t,"config-edit-error-detail",m.error)));
    if(this.reconciledModel===m){
      const rejected=this.reconciledRejectedModel===m,message=rejected?(this.reconciledRejectedText??configRejectedSaveResidual()):'OpenRig’s current settings were checked. Review your draft before saving again.';
      out.push(div().id('config-write-recovered').text_size(11.5).text_color(rejected?t.working:t.muted).tooltip(message).child(message));
    }
    let pair=false;
    for(const block of plan.blocks){
    if(plan.categories)out.push(this.categoryHeader(t,cx,block));
    else if(!plan.filtered)out.push(div().text_size(12).font_semibold().text_color(t.muted).mt(6).child(block.label));
    for(const {entry,group:entryGroup,sourceGroup} of block.rows) {
      const def=this.definition(entry), readOnly=!!def.readOnly;
      const paired=[PRESSURE_WARNING,PRESSURE_CRITICAL].includes(entry.key);
      if(paired && pair)continue;if(paired)pair=true;
      const key=entry.key, editing=m.row?.keys.includes(key), selected=this.selected===key;
      this.rowNavigation.push({id:`config-row-${key}`,key,group:entryGroup});
      const reviewing=m.confirmation?.changes.some(([field])=>field===key||(paired&&[PRESSURE_WARNING,PRESSURE_CRITICAL].includes(field)));
      const rowHandle=this.focusHandle(`config-row-${key}`,cx);
      const row=v_flex().id(`config-row-${key}`).p(8).gap(5).rounded(6)
        .when(!!rowHandle,el=>el.track_focus(rowHandle)).tab_stop(false)
        .when(editing,el=>el.bg(t.raised)).when(selected,el=>el.border_l(2).border_color(t.accent))
        .on_mouse_down('left',activationPair(this,`config-row-${key}`).pointer())
        .on_click(activationPair(this,`config-row-${key}`).click((_event,ctx)=>{this.selectRow(key,ctx);ctx.notify();}))
        .on_key_down(activationPair(this,`config-row-${key}`).key((event,ctx)=>{if(event.key==="escape"&&editing){ctx.stop_propagation();this.cancel(ctx);}
          else if(!editing&&plan.categories&&this.navigateRows(`config-row-${key}`,event.key,ctx))return;
          else if(['enter','space',' '].includes(event.key)&&selected&&this.hasSelection()&&!readOnly&&!editing){ctx.stop_propagation();this.keyboardAction(`config-toggle-${key}`,event,ctx,()=>this.activate(entry,ctx));}}));
      const line=h_flex().gap(8).items_center()
        .when(plan.filtered,el=>el.child(div().text_size(11).text_color(t.dim).child(`${sourceGroup==='all'?'other':sourceGroup} ·`)))
        .child(div().flex_1().min_w(0).text_size(12).font_family("monospace").child(paired?"health.context_pressure · warning / critical":key))
        .child(this.page.copyButton(t,key,`config-key-${key}`,"setting key"))
        .child(div().id(`config-source-${key}`).text_size(10.5).text_color(entry.source==="env"?t.working:entry.source==="file"?t.accent:t.dim).child(sourceName(entry)));
      if(!editing){
        const valueLabel = paired ? `${textValue(m.entry(PRESSURE_WARNING))}% / ${textValue(m.entry(PRESSURE_CRITICAL))}%` : textValue(entry);
        if(def.type==="bool"&&!readOnly) {
          const on=entry.value===true||entry.value==="true";
          this.controlOrder.push(this.focusHandle(`config-toggle-${key}`,cx));
          line.child(h_flex().id(`config-toggle-${key}`).tooltip(`Turn ${key} ${on?'off':'on'} and save`).p(2).border(2).border_color('#00000000').rounded(7)
            .when(!!this.focusHandle(`config-toggle-${key}`,cx),el=>el.track_focus(this.controlHandles.get(`config-toggle-${key}`))).tab_stop(true).focus(el=>el.border_color(t.accent))
            .on_key_down(activationPair(this,`config-toggle-${key}`).key((event,ctx)=>this.keyboardAction(`config-toggle-${key}`,event,ctx,()=>{if(this.detected&&!m.busy)this.toggle(entry,ctx);})))
            .gap(5).items_center().cursor_pointer()
            .on_mouse_down('left',activationPair(this,`config-toggle-${key}`).pointer())
            .on_click(activationPair(this,`config-toggle-${key}`).click((_e,ctx)=>{ctx.stop_propagation();this.keyboardLatches?.delete(`config-toggle-${key}`);if(this.detected&&!m.busy)this.toggle(entry,ctx);}))
            .child(div().size(13).rounded(3).border_1().border_color(on?t.accent:t.border).when(on,el=>el.bg(t.accent)
              .child(svg(icon("check")).size(10).text_color(t.solid_foreground))))
            .child(div().text_size(12).text_color(t.foreground).child(on?"On":"Off")));
        }else if(readOnly)line.child(div().id(`config-locked-${key}`).max_w(340).truncate().text_size(12).text_color(t.foreground).tooltip(def.readOnly).child(valueLabel));
        else {
          const value=div().id(`config-value-${key}`).max_w(340).min_w(80).px(5).py(2).rounded(4).border_1().border_color('#00000000')
            .hover(s=>s.border_color(t.border)).cursor_text().truncate().text_size(12).text_color(t.foreground).tooltip(valueLabel)
            .on_mouse_down('left',activationPair(this,`config-value-${key}`).pointer())
            .on_click(activationPair(this,`config-value-${key}`).click((_e,ctx)=>{ctx.stop_propagation();this.selectRow(key,ctx);this.open(key,ctx);}))
            .on_key_down(activationPair(this,`config-value-${key}`).key((event,ctx)=>{if(['enter','space',' '].includes(event.key)){ctx.stop_propagation();this.activate(entry,ctx);}})).child(valueLabel);
          line.child(this.focusControl(t,cx,`config-value-${key}`,value,(_e,ctx)=>this.activate(entry,ctx),{tip:valueLabel}));
        }
        if(readOnly)line.child(svg(icon("rig-lock")).size(12).text_color(t.dim));
      }else line.child(this.control(t,cx));
      if(!readOnly)line.child(this.action(t,cx,`config-more-${key}`,"⋯",(_e,ctx)=>{ctx.stop_propagation();this.more=this.more===key?null:key;ctx.notify();},{writeActivation:false,tip:'More for this setting: reset to default'}));
      row.child(line);
      if(writePause?.uncertain&&(editing||selected))row.child(div().id('config-row-write-paused').text_size(11.5).text_color(t.dim).child('Saving paused'));
      if(this.reconciledModel===m&&editing)row.child(div().id('config-reconciled-value').text_size(11.5).text_color(t.muted).child(`OpenRig currently reports: ${textValue(entry)} (${sourceName(entry)}).`));
      if(reviewing)row.child(div().id('config-confirm-below').text_size(11.5).text_color(t.foreground)
        .child(`Confirm below: ${m.confirmation.destructive?'Delete older history?':'Save this change?'}`));
      const zoneNote=key==='ui.timezone'&&!hidden(entry)?timezoneNote(entry.value):null;
      if(zoneNote)row.child(div().id('config-timezone-note').text_size(11).text_color(t.dim).child(zoneNote));
      const instruction=readOnly&&key.startsWith("policies.claude_compaction.")&&entry.source!=="env"&&entry.visibility==="withheld";
      const help=def.readOnly ?? (def.restart?"Applies after a daemon restart; herdrig never restarts it.":"OpenRig doesn't confirm when this takes effect.");
      row.child(instruction?h_flex().gap(3).flex_wrap().text_size(11).text_color(t.dim)
        .child(div().child("Value withheld by OpenRig. Edit it with"))
        .child(div().font_family("monospace").child("rig config set"))
        .child(div().child("in a terminal on that machine."))
        :div().text_size(11).text_color(t.dim).child(help));
      const defaultLabel=hidden(entry)?'withheld':def.type==='bool'&&[true,false,'true','false'].includes(entry.defaultValue)?(String(entry.defaultValue)==='true'?'On':'Off'):String(entry.defaultValue??'unset');
      if(this.more===key)row.child(this.action(t,cx,`config-reset-${key}`,`Reset to default (${defaultLabel})`,(_e,ctx)=>this.reset(entry,ctx),{disabled:!this.detected||m.busy,tip:`Reset ${key} to its default (${defaultLabel}): asks first`}));
      if(editing){
        for(const field of m.row.keys){const fieldDef=configDefinition(m.entry(field)),value=m.row.values[field];
          if(fieldDef.type==="path")row.child(div().text_size(11).text_color(t.dim).child(`Herdr doesn't check this folder. OpenRig uses the path as given on ${this.daemonName()}.`));
          if(fieldDef.type==="int"&&m.row.keys.length===1)row.child(div().text_size(11).text_color(t.dim).child(this.integerHint(fieldDef,field)));
          const error=m.row.touched?.[field]?validateConfigValue(fieldDef,value):null;if(error)row.child(div().text_size(11.5).text_color(t.blocked).child(error));
        }
        if(m.row.error&&!writePause?.uncertain&&!m.row.keys.some(field=>m.row.touched?.[field]&&validateConfigValue(configDefinition(m.entry(field)),m.row.values[field])===m.row.error))
          row.child(div().id("config-save-refusal").text_size(12).text_color(m.row.errorTone==='working'?t.working:t.blocked).child(errorBlock(this,t,"config-save-refusal-detail",m.row.error)));
      }
      const receipt=m.receipt(key);if(receipt){this.page.ticking=true;row.child(h_flex().gap(6).items_center()
        .child(div().id(`config-result-${key}`).text_size(11.5).text_color(t.muted).child(receipt.text))
        .when(receipt.undo!==null&&!readOnly,el=>el.child(this.action(t,cx,`config-undo-${key}`,"Undo",(_e,ctx)=>{
          this.execute(ctx,m.undo(key));},{disabled:this.saving||!!m.undoBlocked(key)}).tooltip(m.undoBlocked(key)??'Restore the previous setting after a fresh check. Another change during the write may still be overwritten.'))));
        if(receipt.undo!==null&&m.undoBlocked(key))row.child(div().id(`config-undo-reason-${key}`).text_size(11).text_color(t.dim).child(m.undoBlocked(key)));}
      if(reviewing){
        const confirmation=m.confirmation,confirmKey=confirmation.changes[0][0];
        row.child(this.page.card(t,`${confirmation.reset?"Reset":"Change"} ${confirmKey}${confirmation.reset?"":` to ${confirmation.changes[0][1]}`}?`,[
        div().text_size(12).text_color(t.foreground).child(confirmation.consequence),
        h_flex().gap(6).items_center()
          .child(this.reviewAction(t,'config-confirm-cancel','Cancel',(_e,ctx)=>this.cancelReview(ctx),this.cancelHandle,{tip:'Cancel this change; nothing is saved'}))
          .child(this.reviewAction(t,'config-confirm-save',confirmation.destructive?'Delete older history':`Save ${confirmKey}`,(_e,ctx)=>this.execute(ctx,m.confirm()),this.confirmHandle,{disabled:m.busy||this.saving,primary:true,destructive:confirmation.destructive,tip:`${confirmation.destructive?'Delete the older history':`Save ${confirmKey}`}: this is the change described above`}))]).id('config-confirmation'));
      }
      out.push(row);
    }
    if(plan.categories&&block.more&&(block.active||block.forced))out.push(div().id(`config-category-${block.group}-more`).text_size(11).text_color(t.dim)
      .child(`${block.more} more in ${block.label}. ${block.active?'Filter to find one.':'Open it to see them.'}`));
    }
    if(plan.more)out.push(div().id('config-filter-more').text_size(11).text_color(t.dim).child(`${counted(plan.more,'more match','more matches')}. Type more to narrow it.`));
    return out;
  }
}
