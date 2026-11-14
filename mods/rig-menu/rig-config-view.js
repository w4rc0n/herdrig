import { div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, Select, Popup } from "gpui-base";
import { configRows, iconsAt } from "./rig-lib.js";
import { ConfigEditor, PRESSURE_WARNING, PRESSURE_CRITICAL } from "./rig-config-editor.js";
import { configDefinition, validateConfigValue,configPairPlan,CONFIG_TERMINAL_KEYS } from "./rig-config-schema.js";
import { configWriteError, writeDaemonConfig, readDaemonConfig,configOperationRequest,CONFIG_SAVE_TIMEOUT,configRejectedSaveResidual,configWriteState,waitForConfigWrites,beginConfigReconcile,finishConfigReconcile,failConfigReconcile,configReconcileResult,closeConfigWrites } from "./rig-config-write.js";
import { timezoneNote } from './rig-time.js';
const icon = iconsAt("mods/rig-view");
const hidden = e => e?.visibility === "withheld" || CONFIG_TERMINAL_KEYS.includes(e?.key) || /token|credential/i.test(e?.key ?? "");
const textValue = e => hidden(e) ? "Value withheld by OpenRig" : String(e?.value ?? "unset");
const sourceName = e => ({file:"saved",env:"environment",default:"default"}[e.source] ?? e.source ?? "unreported");

/** The page owns this presentation object; the model contains no native input state. */
export class ConfigPanel {
  constructor(page) { this.page = page; this.model = new ConfigEditor(); this.inputs = {}; this.selected = null; this.releasedReviews=new WeakSet();this.saves=new Map();this.writeWatches=new Map();this.reconcileStopped=new Set();this.writeOwner={}; }
  close(){this.disposed=true;closeConfigWrites(this.writeOwner);}
  get saving(){return this.saves.has(this.identity());}
  origin() { return this.page.config?.daemonUrl ?? ""; }
  identity() { return JSON.stringify([this.origin(),this.page.config?.daemonMachine??null,this.page.config?.connectionId??null]); }
  daemonName() { return this.page.config?.daemonMachine || `the OpenRig at ${this.origin().replace(/^https?:\/\//,"")}`; }
  definition(entry) {
    const def=configDefinition(entry);
    if([PRESSURE_WARNING,PRESSURE_CRITICAL].includes(entry?.key)){
      const blocked=[PRESSURE_WARNING,PRESSURE_CRITICAL].map(k=>configDefinition(this.model.entry(k))).find(d=>d.readOnly);
      if(blocked)return {...def,readOnly:`These paired thresholds are read-only here. ${blocked.readOnly}`};
    }
    return def;
  }
  releaseInputs() { this.blurGeneration=(this.blurGeneration??0)+1;if(this.focusedField)this.page.typing=false;this.focusedField=null;for (const input of Object.values(this.inputs)) input.release?.(); this.inputs = {}; this.dropdown=null; this.selectHandles={}; }
  sync(origin, browser, probe) {
    const identity=this.identity();
    if (this.boundIdentity !== identity) { this.releaseInputs(); this.model = new ConfigEditor(identity); this.boundOrigin = origin;this.boundIdentity=identity;this.nextKey=null; }
    this.model.observe(browser);
    if(configWriteState(identity)?.uncertain){this.model.results.clear();this.model.latestReceipt=null;this.model.lastSavedText=null;}
    const editingKeys=this.model.row?.keys??this.model.confirmation?.changes.map(([key])=>key)??[];
    if(!this.saving&&!this.model.busy&&editingKeys.some(key=>this.definition(this.model.entry(key)).readOnly)){
      this.model.cancel();this.releaseInputs();this.model.error='This setting is now read-only. The open edit was not saved.';
    }
    this.detected = !probe?.error && Object.hasOwn(probe?.data ?? {}, "value") && ["file","env","default"].includes(probe?.data?.source);
  }
  open(key, cx) {
    if(this.pauseWrites(cx))return;
    if (!this.detected || this.definition(this.model.entry(key)).readOnly) return;
    if(this.saving||this.model.busy){if(this.model.row?.key!==key)this.nextKey=key;return;}
    if(this.model.confirmation)return;
    if(this.model.row?.keys.includes(key)){this.focusField(key,cx);return;}
    if(this.model.row){this.save(cx);if(this.model.row){if(this.saving)this.nextKey=key;return;}}
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
      input.on("change", (_e, cx) => { if(!current())return;model.change(field, input.value()); cx.notify(); });
      input.on("submit", (_e, cx) => {if(current())this.save(cx);});
      input.on('focus',(_e,cx)=>{
        if(!current())return;this.focusedField=field;this.page.typing=true;
        const value=input.value(),select=()=>input.set_selected_range({start:0,end:String(value??'').length});select();
        // Native Tab traversal may finish after the focus event. Do not replace text typed meanwhile.
        cx.timer?.after(16,next=>{if(current()&&this.focusedField===field&&input.value()===value)select();next.notify();});
      });
      input.on('blur',(_e,cx)=>{if(!current())return;if(this.focusedField===field){this.focusedField=null;this.page.typing=false;}this.deferBlur(cx);});
      this.inputs[field] = input;
    }
    this.editorHandle??=cx.focus_handle();this.focusField(key,cx,true);cx.notify();
  }
  focusField(key,cx,select=false) {
    const input=this.inputs[key]??Object.values(this.inputs)[0],row=this.model.row,generation=this.blurGeneration;
    const focus=()=>{if(this.model.row!==row||!row||this.blurGeneration!==generation)return;input?.focus();if(select&&input)input.set_selected_range({start:0,end:String(input.value()??'').length});if(!input)(this.selectHandles[key]?.trigger??this.editorHandle)?.focus();};
    focus();cx.timer?.after(0,next=>{focus();next.notify();});
  }
  deferBlur(cx) {
    const row=this.model.row,generation=this.blurGeneration;
    cx.timer.after(0,next=>{if(this.model.row===row&&this.blurGeneration===generation&&!this.focusedField&&!this.model.confirmation&&!this.saving)this.save(next);next.notify();});
  }
  tabField(field,backward,cx) {
    if(this.saving||this.model.busy||this.model.confirmation||!this.model.row)return;
    const keys=this.model.row.keys,index=keys.indexOf(field),next=index+(backward?-1:1);
    if(next>=0&&next<keys.length){this.focusField(keys[next],cx,true);return;}
    if(this.save(cx)!==false){if(backward)window.focus_prev();else window.focus_next();}
  }
  cancel(cx) { if(this.saving||this.model.busy)return;this.model.cancel();this.nextKey=null; this.releaseInputs(); cx.notify(); }
  keyDown(event,cx) {
    if(event.key==="escape"&&(this.model.row||this.model.confirmation)) {
      cx.stop_propagation();if(this.saving||this.model.busy)return true;
      if(this.model.confirmation){this.model.cancelConfirmation();this.focusField(this.model.row?.key,cx);}else this.cancel(cx);cx.notify();return true;
    }
    if(["enter","space"," "].includes(event.key)&&this.selected&&!this.model.row&&!this.model.confirmation) {
      cx.stop_propagation();this.activate(this.model.entry(this.selected),cx);return true;
    }
    return false;
  }
  async refresh(origin,request=fetch,model=this.model,identity=this.identity()) {
    const response = await request(`${origin.replace(/\/$/, "")}/api/config?view=browser`);
    if (!response.ok) throw new Error(`GET configuration → ${response.status}`);
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
    const {origin,model,identity,rejected}=binding;
    if(configWriteState(identity)?.ownerClosed||this.reconcileStopped.has(identity)||this.writeWatches.get(identity)?.model===model)return;
    const watch={model};this.writeWatches.set(identity,watch);
    cx.spawn(async next=>{
      let request,record,token;
      const current=()=>!this.disposed&&this.identity()===identity&&this.model===model;
      try{
        record=await waitForConfigWrites(identity);
        if(!configWriteState(identity)?.uncertain||configWriteState(identity)?.ownerClosed)return;
        if(!current()){failConfigReconcile(identity,record);this.reconcileStopped.add(identity);return;}
        token=beginConfigReconcile(identity,record,this.writeOwner);
        let result;
        if(token){
          request=configOperationRequest(fetch,(ms,fn)=>next.timer.after(ms,fn));
          const data=await this.refresh(origin,request,model,identity);
          finishConfigReconcile(identity,record,token,data);result={ok:true,data};
        }else result=await configReconcileResult(record);
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
      }finally{request?.finish();if(this.writeWatches.get(identity)===watch)this.writeWatches.delete(identity);next.notify();}
    });
  }
  execute(cx, pending) {
    if (!pending) {
      if(this.model.confirmation){
        const confirmation=this.model.confirmation;this.cancelHandle??=cx.focus_handle?.();this.confirmHandle??=cx.focus_handle?.();
        const handle=this.cancelHandle;handle?.focus?.();
        cx.timer?.after(16,next=>{if(this.model.confirmation===confirmation)handle?.focus();next.notify();});
      }
      cx.notify(); return;
    }
    if(this.saving||this.model.busy)return;
    if(this.pauseWrites(cx))return;
    const origin = this.boundOrigin, model = this.model,identity=this.boundIdentity,draft=model.row;
    const request=configOperationRequest(fetch,(ms,fn)=>cx.timer.after(ms,fn),identity,this.writeOwner,this.daemonName());
    this.saves.set(identity,request);this.reconciledModel=null;this.reconciledRejectedModel=null;this.reconciledRejectedText=null;
    cx.spawn(async cx => {
      let rejected;
      try{await model.save(pending, (key, value, reset) => {
        if (this.identity() !== identity || this.model !== model) return { ok:false, error:"OpenRig connection changed; reopen the setting" };
        return writeDaemonConfig({origin,key,value,reset,entry:model.entry(key),detected:this.detected},request)
          .then(result=>{if(!result.ok)rejected={key,value:hidden(model.entry(key))?null:reset?'the default':value};return {...result,daemon:this.daemonName()};});
      }, () => this.refresh(origin,request,model,identity),Date.now,async key=>{
        if(this.identity()!==identity||this.model!==model)throw new Error('OpenRig connection changed; Undo is no longer available');
        const result=await readDaemonConfig({origin,key,entry:model.entry(key),detected:this.detected},request);
        if(!result.ok)throw new Error(result.error);return result.resolved;
      });}finally{
        if(request.expired()){
          model.results.clear();model.latestReceipt=null;model.lastSavedText=null;model.error=CONFIG_SAVE_TIMEOUT;
          if(!model.row&&draft)model.row=draft;
          if(model.row)model.row.error=CONFIG_SAVE_TIMEOUT;
        }
        request.finish();if(this.saves.get(identity)===request)this.saves.delete(identity);
        if(configWriteState(identity)?.uncertain){
          const reason=configWriteState(identity).reason;model.error=reason;if(model.row)model.row.error=reason;
          this.watchWrites(cx,{origin,model,identity,rejected});
        }
      }
      if(request.expired()&&this.model===model&&!model.row){this.open(pending.changes[0][0],cx);if(model.row)model.row.error=CONFIG_SAVE_TIMEOUT;}
      if(this.model===model){
        if (!model.row) {this.releaseInputs();const key=this.nextKey;this.nextKey=null;if(key)this.open(key,cx);}
        else {this.nextKey=null;this.focusField(model.row.key,cx);}
      }
      cx.notify();
    });
    cx.notify();
  }
  save(cx) {
    if(!this.model.row||this.saving||this.model.busy||this.model.confirmation)return;
    if(this.pauseWrites(cx))return false;
    const pending=this.model.commit();
    if(!this.model.row){this.releaseInputs();cx.notify();return;}
    if(this.model.row.error){this.focusField(this.model.row.key,cx);cx.notify();return false;}
    this.execute(cx,pending);return !this.model.confirmation;
  }
  activate(entry,cx){if(!entry||this.definition(entry).readOnly)return;this.selected=entry.key;if(configDefinition(entry).type==='bool')this.toggle(entry,cx);else this.open(entry.key,cx);}
  choose(field,value,cx){this.model.change(field,value);this.dropdown=null;this.save(cx);}
  toggle(entry, cx) { this.open(entry.key,cx);if(this.model.row?.keys.includes(entry.key)&&!this.saving){this.model.change(entry.key,entry.value === true || entry.value === "true" ? "false" : "true");this.save(cx);} }
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
  action(t,id,label,fn,options={}) {
    return this.page.button(t,id,label,fn,{small:true,...options})
      .when(options.primary&&!options.disabled,el=>el.bg(t.accent).text_color(t.solid_foreground).hover(s=>s.bg(t.accent)));
  }
  integerHint(def,field) {
    const bounds=def.min===undefined&&def.max===undefined?'any whole number':def.max===undefined?`any whole number ≥ ${def.min}`:def.min===undefined?`any whole number ≤ ${def.max}`:`${def.min}–${def.max}`;
    return `${bounds}${def.unit?' '+def.unit:''} · default ${this.model.entry(field)?.defaultValue??'unset'}`;
  }
  cancelReview(cx){this.model.cancelConfirmation();this.focusField(this.model.row?.key,cx);cx.notify();}
  reviewAction(t,id,label,fn,handle,{disabled=false,primary=false,destructive=false}={}){
    const model=this.model,review=model.confirmation,activation=key=>['enter','space',' '].includes(key);
    return div().id(`${id}-focus`).p(2).border(2).border_color('#00000000').rounded(7).role('button')
      .when(!!handle,el=>el.track_focus(handle)).tab_stop(!disabled).focus(el=>el.border_color(t.accent))
      // Cancel-first is the repeat safety boundary. This release gate is secondary; explicit Tab navigation arms it too.
      .on_key_up((event,cx)=>{if((activation(event.key)||event.key==='tab')&&this.model===model&&model.confirmation===review){cx.stop_propagation();this.releasedReviews.add(review);}})
      .on_key_down((event,cx)=>{if(activation(event.key)){cx.stop_propagation();if(!disabled&&!event.is_held&&this.model===model&&model.confirmation===review&&this.releasedReviews.has(review))fn({},cx);}})
      .child(this.action(t,id,label,fn,{disabled,primary}).when(destructive,el=>el.bg(t.blocked).text_color(t.solid_foreground).hover(s=>s.bg(t.blocked))));
  }

  select(t,field,def,value) {
    const handles=this.selectHandles[field],open=this.dropdown===field;
    const choose=(choice,cx)=>{this.choose(field,choice,cx);cx.notify();};
    const trigger=h_flex().id(`config-select-trigger-${field}`).gap(8).px(8).h(28).items_center().rounded(5).border_1().border_color(t.border)
      .track_focus(handles.trigger).tab_stop(true).cursor_pointer().on_click((_e,cx)=>{
        this.dropdown=open?null:field;this.highlight=Math.max(0,def.choices.indexOf(value));
        if(!open)cx.timer.after(0,next=>{if(this.dropdown===field)handles.list.focus();next.notify();});
        else handles.trigger.focus();cx.notify();
      }).child(value===null?"Choose…":value||"unset").child(svg(icon("chevron-down")).size(12).text_color(t.muted));
    const list=v_flex().id(`config-select-list-${field}`).p(4).gap(2).rounded(5).bg(t.raised).border_1().border_color(t.border)
      .track_focus(handles.list).tab_stop(true).on_key_down((event,cx)=>{
        if(event.key==="up"||event.key==="down"){
          cx.stop_propagation();this.highlight=((this.highlight??0)+(event.key==="down"?1:-1)+def.choices.length)%def.choices.length;cx.notify();
        }else if(event.key==="enter"){cx.stop_propagation();choose(def.choices[this.highlight??0],cx);}
      }).children(def.choices.map((choice,index)=>this.action(t,`config-option-${field}-${index}`,choice||"unset",(_e,cx)=>choose(choice,cx),{primary:this.highlight===index})
        .role("list_box_option").aria_selected(value===choice).when(this.highlight===index,el=>el.aria_active_descendant())));
    return Select.new(`config-select-${field}`).accessibility_label(field).open(open).track_focus(handles.trigger)
      .content_focus_handle(handles.list).on_open_change((next,cx)=>{
        this.dropdown=next?field:null;this.highlight=Math.max(0,def.choices.indexOf(value));cx.notify();
      }).on_confirm((_e,cx)=>choose(def.choices[this.highlight??0],cx))
      .child(Popup.new(`config-select-popup-${field}`,trigger).when(open,el=>el.content(list)));
  }

  control(t,cx) {
    const m=this.model,row=m.row;
    const control=v_flex().id(`config-control-${row.key}`).gap(4).min_w(140).max_w(400).flex_1()
      .on_mouse_down_out((_e,ctx)=>{
        if(m!==this.model||m.row!==row||m.confirmation||this.saving||m.busy)return;
        if(this.save(ctx)===false)ctx.stop_propagation();
      });
    if(this.saving||m.busy)return control.child(div().text_color(t.dim).text_size(12).child('Saving and checking…'));
    if(!Object.keys(this.inputs).length)control.track_focus(this.editorHandle).tab_stop(true);
    for(const field of row.keys){
      const def=configDefinition(m.entry(field)),value=row.values[field];
      if(row.keys.length>1)control.child(div().text_size(11).text_color(t.dim).child(field===PRESSURE_WARNING?'Warning':'Critical'));
      if(def.choices?.length>4&&this.selectHandles[field])control.child(this.select(t,field,def,value));
      else if(def.choices&&def.type!=='stream')control.child(h_flex().id(`config-choices-${field}`).gap(4).flex_wrap()
        .children(def.choices.map(choice=>this.action(t,`config-choice-${field}-${choice||'unset'}`,choice||'unset',(_e,ctx)=>this.choose(field,choice,ctx),{primary:value===choice,disabled:m.busy}))));
      else if(def.type==='bool')control.child(h_flex().gap(4)
        .child(this.action(t,`config-on-${field}`,'On',(_e,ctx)=>this.choose(field,'true',ctx),{primary:value==='true'}))
        .child(this.action(t,`config-off-${field}`,'Off',(_e,ctx)=>this.choose(field,'false',ctx),{primary:value==='false'})));
      else if(this.inputs[field])control.child(div().id(`config-input-guard-${field}`)
        .key_context('HerdrigConfigInput')
        .on_action('herdrig_config_next',(_e,ctx)=>{ctx.stop_propagation();this.tabField(field,false,ctx);})
        .on_action('herdrig_config_previous',(_e,ctx)=>{ctx.stop_propagation();this.tabField(field,true,ctx);})
        .on_mouse_down('left',(_e,ctx)=>ctx.stop_propagation())
        .on_key_down((event,ctx)=>{
          if(event.key==='escape'){ctx.stop_propagation();this.cancel(ctx);}
          else if(event.key==='enter'){ctx.stop_propagation();this.save(ctx);}
          else if(event.key==='tab'){
            ctx.stop_propagation();this.tabField(field,!!event.modifiers?.shift,ctx);
          }else this.page.typing=true;
        }).child(Input.new(this.inputs[field]).id(`config-input-${field}`).h(30).px(8).rounded(5).border_1().border_color(t.border).bg(t.background).text_color(t.foreground)));
      if(row.keys.length>1&&def.type==='int')control.child(div().id(`config-hint-${field}`).text_size(11).text_color(t.dim).child(this.integerHint(def,field)));
    }
    return control;
  }

  render(t,cx,browser,probe,scope={}) {
    this.sync(this.origin(),browser,probe);
    const m=this.model, ownRows=configRows(browser,scope), filter=String(this.page.filter ?? "").toLowerCase();
    const pinned=new Set([...(m.row?.keys??[]),...(m.confirmation?.changes.map(([key])=>key)??[])]);
    for(const row of configRows(browser))if(pinned.has(row.key)&&!ownRows.some(r=>r.key===row.key))ownRows.push(row);
    const rows=ownRows.map(row=>({entry:m.entry(row.key),group:row.group})).filter(row=>row.entry && (pinned.has(row.entry.key)||!filter || `${row.entry.key} ${row.group}`.toLowerCase().includes(filter)));
    const editable=rows.filter(({entry})=>!this.definition(entry).readOnly).length;
    const out=[div().id("config-edit-summary").text_size(11.5).text_color(t.muted).child(`${editable} settable · ${rows.length-editable} read-only`)];
    const writePause=this.writePauseState();
    if(writePause?.uncertain)out.push(div().id('config-write-paused').text_size(12).text_color(writePause.ownerClosed||writePause.failed?t.blocked:t.working).child(writePause.reason));
    if (!this.detected) out.push(div().id("config-edit-unavailable").text_size(11.5).text_color(t.dim)
      .child(probe?.status ? configWriteError(probe.status,probe.errorData)
        : "This OpenRig hasn't confirmed support for editing settings from Herdr. Use rig config set on that machine."));
    if(m.error&&!writePause?.uncertain)out.push(div().id("config-edit-error").text_size(12).text_color(m.errorTone==='working'?t.working:t.blocked).child(m.error));
    if(this.reconciledModel===m){
      const rejected=this.reconciledRejectedModel===m,message=rejected?(this.reconciledRejectedText??configRejectedSaveResidual()):'OpenRig’s current settings were checked. Review your draft before saving again.';
      out.push(div().id('config-write-recovered').text_size(11.5).text_color(rejected?t.working:t.muted).tooltip(message).child(message));
    }
    let group=null,pair=false;
    for(const {entry,group:entryGroup} of [...rows.filter(r=>!this.definition(r.entry).readOnly),...rows.filter(r=>this.definition(r.entry).readOnly)]) {
      const def=this.definition(entry), readOnly=!!def.readOnly;
      const nextGroup=readOnly?"Read-only here":entryGroup;
      if(nextGroup!==group){group=nextGroup;out.push(div().text_size(12).font_semibold().text_color(t.muted).mt(6).child(group));}
      const paired=[PRESSURE_WARNING,PRESSURE_CRITICAL].includes(entry.key);
      if(paired && pair)continue;if(paired)pair=true;
      const key=entry.key, editing=m.row?.keys.includes(key), selected=this.selected===key;
      const reviewing=m.confirmation?.changes.some(([field])=>field===key||(paired&&[PRESSURE_WARNING,PRESSURE_CRITICAL].includes(field)));
      const row=v_flex().id(`config-row-${key}`).p(8).gap(5).rounded(6)
        .when(editing,el=>el.bg(t.raised)).when(selected,el=>el.border_l(2).border_color(t.accent))
        .on_click((_event,ctx)=>{this.selected=key;ctx.notify();})
        .on_key_down((event,ctx)=>{if(event.key==="escape"&&editing){ctx.stop_propagation();this.cancel(ctx);}
          else if(['enter','space',' '].includes(event.key)&&selected&&!readOnly&&!editing){ctx.stop_propagation();this.activate(entry,ctx);}});
      const line=h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(12).font_family("monospace").child(paired?"health.context_pressure · warning / critical":key))
        .child(this.page.copyButton(t,key,`config-key-${key}`,"setting key"))
        .child(div().id(`config-source-${key}`).text_size(10.5).text_color(entry.source==="env"?t.working:entry.source==="file"?t.accent:t.dim).child(sourceName(entry)));
      if(!editing){
        const valueLabel = paired ? `${textValue(m.entry(PRESSURE_WARNING))}% / ${textValue(m.entry(PRESSURE_CRITICAL))}%` : textValue(entry);
        if(def.type==="bool"&&!readOnly) {
          const on=entry.value===true||entry.value==="true";
          line.child(h_flex().id(`config-toggle-${key}`).gap(5).items_center().cursor_pointer()
            .on_click((_e,ctx)=>{ctx.stop_propagation();if(this.detected&&!m.busy)this.toggle(entry,ctx);})
            .child(div().size(13).rounded(3).border_1().border_color(on?t.accent:t.border).when(on,el=>el.bg(t.accent)
              .child(svg(icon("check")).size(10).text_color(t.solid_foreground))))
            .child(div().text_size(12).text_color(t.foreground).child(on?"On":"Off")));
        }else if(readOnly)line.child(div().id(`config-locked-${key}`).max_w(340).truncate().text_size(12).text_color(t.foreground).tooltip(def.readOnly).child(valueLabel));
        else {
          const value=div().id(`config-value-${key}`).max_w(340).min_w(80).px(5).py(2).rounded(4).border_1().border_color('#00000000')
            .hover(s=>s.border_color(t.border)).cursor_text().tab_stop(true).truncate().text_size(12).text_color(t.foreground).tooltip(valueLabel)
            .on_click((_e,ctx)=>{ctx.stop_propagation();this.selected=key;this.open(key,ctx);})
            .on_key_down((event,ctx)=>{if(['enter','space',' '].includes(event.key)){ctx.stop_propagation();this.activate(entry,ctx);}}).child(valueLabel);
          line.child(value);
        }
        if(readOnly)line.child(svg(icon("rig-lock")).size(12).text_color(t.dim));
      }else line.child(this.control(t,cx));
      if(!readOnly)line.child(this.action(t,`config-more-${key}`,"⋯",(_e,ctx)=>{ctx.stop_propagation();this.more=this.more===key?null:key;ctx.notify();}));
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
      if(this.more===key)row.child(this.action(t,`config-reset-${key}`,`Reset to default (${hidden(entry)?"withheld":String(entry.defaultValue??"unset")})`,(_e,ctx)=>this.reset(entry,ctx),{disabled:!this.detected||m.busy}));
      if(editing){
        for(const field of m.row.keys){const fieldDef=configDefinition(m.entry(field)),value=m.row.values[field];
          if(fieldDef.type==="path")row.child(div().text_size(11).text_color(t.dim).child(`Herdr doesn't check this folder. OpenRig uses the path as given on ${this.daemonName()}.`));
          if(fieldDef.type==="int"&&m.row.keys.length===1)row.child(div().text_size(11).text_color(t.dim).child(this.integerHint(fieldDef,field)));
          const error=m.row.touched?.[field]?validateConfigValue(fieldDef,value):null;if(error)row.child(div().text_size(11.5).text_color(t.blocked).child(error));
        }
        if(m.row.error&&!writePause?.uncertain&&!m.row.keys.some(field=>m.row.touched?.[field]&&validateConfigValue(configDefinition(m.entry(field)),m.row.values[field])===m.row.error))
          row.child(div().id("config-save-refusal").text_size(12).text_color(m.row.errorTone==='working'?t.working:t.blocked).child(m.row.error));
      }
      const receipt=m.receipt(key);if(receipt){this.page.ticking=true;row.child(h_flex().gap(6).items_center()
        .child(div().id(`config-result-${key}`).text_size(11.5).text_color(t.muted).child(receipt.text))
        .when(receipt.undo!==null&&!readOnly,el=>el.child(this.action(t,`config-undo-${key}`,"Undo",(_e,ctx)=>{
          this.execute(ctx,m.undo(key));},{disabled:this.saving||!!m.undoBlocked(key)}).tooltip(m.undoBlocked(key)??'Restore the previous setting after a fresh check. Another change during the write may still be overwritten.'))));
        if(receipt.undo!==null&&m.undoBlocked(key))row.child(div().id(`config-undo-reason-${key}`).text_size(11).text_color(t.dim).child(m.undoBlocked(key)));}
      if(reviewing){
        const confirmation=m.confirmation,confirmKey=confirmation.changes[0][0];
        row.child(this.page.card(t,`${confirmation.reset?"Reset":"Change"} ${confirmKey}${confirmation.reset?"":` to ${confirmation.changes[0][1]}`}?`,[
        div().text_size(12).text_color(t.foreground).child(confirmation.consequence),
        h_flex().gap(6).items_center()
          .child(this.reviewAction(t,'config-confirm-cancel','Cancel',(_e,ctx)=>this.cancelReview(ctx),this.cancelHandle))
          .child(this.reviewAction(t,'config-confirm-save',confirmation.destructive?'Delete older history':`Save ${confirmKey}`,(_e,ctx)=>this.execute(ctx,m.confirm()),this.confirmHandle,{disabled:m.busy||this.saving,primary:true,destructive:confirmation.destructive}))]).id('config-confirmation'));
      }
      out.push(row);
    }
    return out;
  }
}
