import { div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, Select, Popup } from "gpui-base";
import { configRows, iconsAt } from "./rig-lib.js";
import { ConfigEditor, PRESSURE_WARNING, PRESSURE_CRITICAL } from "./rig-config-editor.js";
import { configDefinition, validateConfigValue } from "./rig-config-schema.js";
import { configWriteError, writeDaemonConfig } from "./rig-config-write.js";
import { timezoneNote } from './rig-time.js';
const icon = iconsAt("mods/rig-view");
const hidden = e => e?.visibility === "withheld" || /token|credential/i.test(e?.key ?? "");
const textValue = e => hidden(e) ? "Value withheld by OpenRig" : String(e?.value ?? "unset");
const sourceName = e => ({file:"saved",env:"environment",default:"default"}[e.source] ?? e.source ?? "unreported");

/** The page owns this presentation object; the model contains no native input state. */
export class ConfigPanel {
  constructor(page) { this.page = page; this.model = new ConfigEditor(); this.inputs = {}; this.selected = null; }
  origin() { return this.page.config?.daemonUrl ?? ""; }
  daemonName() { return this.page.config?.daemonMachine || `the OpenRig at ${this.origin().replace(/^https?:\/\//,"")}`; }
  definition(entry) {
    const def=configDefinition(entry);
    if([PRESSURE_WARNING,PRESSURE_CRITICAL].includes(entry?.key)){
      const blocked=[PRESSURE_WARNING,PRESSURE_CRITICAL].map(k=>configDefinition(this.model.entry(k))).find(d=>d.readOnly);
      if(blocked)return {...def,readOnly:`These paired thresholds are read-only here. ${blocked.readOnly}`};
    }
    return def;
  }
  releaseInputs() { for (const input of Object.values(this.inputs)) input.release?.(); this.inputs = {}; this.dropdown=null; this.selectHandles={}; }
  sync(origin, browser, probe) {
    if (this.boundOrigin !== origin) { this.releaseInputs(); this.model = new ConfigEditor(); this.boundOrigin = origin; }
    this.model.observe(browser);
    this.detected = !probe?.error && Object.hasOwn(probe?.data ?? {}, "value") && ["file","env","default"].includes(probe?.data?.source);
  }
  open(key, cx) {
    if (!this.detected || this.model.busy) return;
    if (!this.model.open(key)) { cx.notify(); return; }
    this.releaseInputs();
    for (const field of this.model.row.keys) {
      const def = configDefinition(this.model.entry(field));
      if(def.choices?.length>4)this.selectHandles[field]={trigger:cx.focus_handle(),list:cx.focus_handle()};
      if (["enum","bool"].includes(def.type)) continue;
      const input = InputState.new({ value: this.model.row.values[field], placeholder: field });
      input.on("change", (_e, cx) => { this.model.change(field, input.value()); cx.notify(); });
      input.on("submit", (_e, cx) => this.save(cx));
      this.inputs[field] = input;
    }
    Object.values(this.inputs)[0]?.focus?.(); cx.notify();
  }
  cancel(cx) { this.model.cancel(); this.releaseInputs(); cx.notify(); }
  keyDown(event,cx) {
    if(event.key==="escape"&&(this.model.row||this.model.confirmation)) {
      cx.stop_propagation();if(this.model.busy)return true;
      if(this.model.confirmation)this.model.confirmation=null;else this.cancel(cx);cx.notify();return true;
    }
    if(event.key==="enter"&&this.selected&&!this.model.row&&!this.model.confirmation) {
      cx.stop_propagation();this.open(this.selected,cx);return true;
    }
    return false;
  }
  async refresh(origin) {
    const response = await fetch(`${origin.replace(/\/$/, "")}/api/config?view=browser`);
    if (!response.ok) throw new Error(`GET configuration → ${response.status}`);
    const data = await response.json();
    if (this.origin() !== origin) throw new Error("OpenRig connection changed during the save");
    this.page.cache["/api/config?view=browser"] = { data, at: Date.now() }; this.model.observe(data);
    const zone=data?.entries?.find(e=>e.key==='ui.timezone'&&!hidden(e));
    this.page.cache['/api/config/ui.timezone']={data:zone?{value:zone.value}:null,at:Date.now()};
  }
  execute(cx, pending) {
    if (!pending) {
      if(this.model.confirmation){this.cancelHandle??=cx.focus_handle?.();this.cancelHandle?.focus?.();}
      cx.notify(); return;
    }
    const origin = this.boundOrigin, model = this.model;
    cx.spawn(async cx => {
      await model.save(pending, (key, value, reset) => {
        if (this.origin() !== origin || this.model !== model) return { ok:false, error:"OpenRig connection changed; reopen the setting" };
        return writeDaemonConfig({origin,key,value,reset,entry:model.entry(key),detected:this.detected})
          .then(result=>({...result,daemon:this.daemonName()}));
      }, () => this.refresh(origin));
      if (!model.row) this.releaseInputs();
      cx.notify();
    });
    cx.notify();
  }
  save(cx) { if(!this.model.row)return; const plan = this.model.plan(); if (plan.error) { this.model.row.error = plan.error; cx.notify(); return; } this.execute(cx,this.model.request(plan.changes)); }
  toggle(entry, cx) { this.execute(cx,this.model.request([[entry.key,entry.value === true || entry.value === "true" ? "false" : "true"]])); }
  reset(entry, cx) { this.more = null; this.execute(cx,this.model.request([[entry.key,String(entry.defaultValue ?? "")]],true)); }
  action(t,id,label,fn,options={}) {
    return this.page.button(t,id,label,fn,{small:true,...options})
      .when(options.primary&&!options.disabled,el=>el.bg(t.accent).text_color(t.solid_foreground).hover(s=>s.bg(t.accent)));
  }

  select(t,field,def,value) {
    const handles=this.selectHandles[field],open=this.dropdown===field;
    const choose=(choice,cx)=>{this.model.change(field,choice);this.dropdown=null;handles.trigger.focus();cx.notify();};
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

  render(t,cx,browser,probe,scope={}) {
    this.sync(this.origin(),browser,probe);
    const m=this.model, ownRows=configRows(browser,scope), filter=String(this.page.filter ?? "").toLowerCase();
    const rows=ownRows.map(row=>({entry:m.entry(row.key),group:row.group})).filter(row=>row.entry && (!filter || `${row.entry.key} ${row.group}`.toLowerCase().includes(filter)));
    const editable=rows.filter(({entry})=>!this.definition(entry).readOnly).length;
    const out=[div().id("config-edit-summary").text_size(11.5).text_color(t.muted).child(`${editable} settable · ${rows.length-editable} read-only`)];
    if (!this.detected) out.push(div().id("config-edit-unavailable").text_size(11.5).text_color(t.dim)
      .child(probe?.status ? configWriteError(probe.status,probe.errorData)
        : "This OpenRig hasn't confirmed support for editing settings from Herdr. Use rig config set on that machine."));
    if(m.error)out.push(div().id("config-edit-error").text_size(12).text_color(t.blocked).child(m.error));
    let group=null,pair=false;
    for(const {entry,group:entryGroup} of [...rows.filter(r=>!this.definition(r.entry).readOnly),...rows.filter(r=>this.definition(r.entry).readOnly)]) {
      const def=this.definition(entry), readOnly=!!def.readOnly;
      const nextGroup=readOnly?"Read-only here":entryGroup;
      if(nextGroup!==group){group=nextGroup;out.push(div().text_size(12).font_semibold().text_color(t.muted).mt(6).child(group));}
      const paired=[PRESSURE_WARNING,PRESSURE_CRITICAL].includes(entry.key);
      if(paired && pair)continue;if(paired)pair=true;
      const key=entry.key, editing=m.row?.keys.includes(key), selected=this.selected===key;
      const row=v_flex().id(`config-row-${key}`).p(8).gap(5).rounded(6)
        .when(editing,el=>el.bg(t.raised)).when(selected,el=>el.border_l(2).border_color(t.accent))
        .on_click((event,ctx)=>{this.selected=key;if((event?.click_count??1)>=2&&!readOnly)this.open(key,ctx);ctx.notify();})
        .on_key_down((event,ctx)=>{if(event.key==="escape"&&editing){ctx.stop_propagation();this.cancel(ctx);}
          else if(event.key==="enter"&&selected&&!readOnly&&!editing){ctx.stop_propagation();this.open(key,ctx);}});
      const line=h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(12).font_family("monospace").child(paired?"health.context_pressure · warning / critical":key))
        .child(this.page.copyButton(t,key,`config-key-${key}`,"setting key"))
        .child(div().id(`config-source-${key}`).text_size(10.5).text_color(entry.source==="env"?t.working:entry.source==="file"?t.accent:t.dim).child(sourceName(entry)));
      if(!editing){
        const valueLabel = paired ? `${textValue(m.entry(PRESSURE_WARNING))}% / ${textValue(m.entry(PRESSURE_CRITICAL))}%` : textValue(entry);
        if(def.type==="bool"&&!readOnly&&def.risk!=="high") {
          const on=entry.value===true||entry.value==="true";
          line.child(h_flex().id(`config-toggle-${key}`).gap(5).items_center().cursor_pointer()
            .on_click((_e,ctx)=>{ctx.stop_propagation();if(this.detected&&!m.busy)this.toggle(entry,ctx);})
            .child(div().size(13).rounded(3).border_1().border_color(on?t.accent:t.border).when(on,el=>el.bg(t.accent)
              .child(svg(icon("check")).size(10).text_color(t.solid_foreground))))
            .child(div().text_size(12).text_color(t.foreground).child(on?"On":"Off")));
        }else line.child(div().max_w(340).truncate().text_size(12).text_color(t.foreground).tooltip(valueLabel).child(valueLabel));
        if(readOnly)line.child(svg(icon("rig-lock")).size(12).text_color(t.dim));
        else line.child(this.action(t,`config-edit-${key}`,"Edit",(_e,ctx)=>this.open(key,ctx),{disabled:!this.detected||m.busy}));
      }
      if(entry.source==="file"&&!readOnly)line.child(this.action(t,`config-more-${key}`,"⋯",(_e,ctx)=>{ctx.stop_propagation();this.more=this.more===key?null:key;ctx.notify();}));
      row.child(line);
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
          if(fieldDef.choices?.length>4 && this.selectHandles[field])row.child(this.select(t,field,fieldDef,value));
          else if(fieldDef.choices && fieldDef.type!=="stream") {
            const choices=h_flex().id(`config-choices-${field}`).gap(4).flex_wrap();
            for(const choice of fieldDef.choices)choices.child(this.action(t,`config-choice-${field}-${choice||"unset"}`,choice||"unset",(_e,ctx)=>{m.change(field,choice);ctx.notify();},{primary:value===choice,disabled:m.busy}));
            row.child(choices);
          }else if(fieldDef.type==="bool") {
            row.child(h_flex().gap(4).child(this.action(t,`config-on-${field}`,"On",(_e,ctx)=>{m.change(field,"true");ctx.notify();},{primary:value==="true"}))
              .child(this.action(t,`config-off-${field}`,"Off",(_e,ctx)=>{m.change(field,"false");ctx.notify();},{primary:value==="false"})));
          }else if(this.inputs[field])row.child(div().id(`config-input-guard-${field}`)
            .on_mouse_down("left",(_e,ctx)=>ctx.stop_propagation())
            .on_key_down((event,ctx)=>{
              if(event.key==="escape"){ctx.stop_propagation();this.cancel(ctx);}
              else this.page.typing=true;
            }).child(Input.new(this.inputs[field]).id(`config-input-${field}`).h(30).px(8).rounded(5).border_1().border_color(t.border).bg(t.background).text_color(t.foreground)));
          if(fieldDef.type==="path")row.child(div().text_size(11).text_color(t.dim).child(`Herdr doesn't check this folder. OpenRig uses the path as given on ${this.daemonName()}.`));
          if(fieldDef.type==="int")row.child(div().text_size(11).text_color(t.dim).child(`${fieldDef.max===undefined?`any whole number ≥ ${fieldDef.min}`:`${fieldDef.min}–${fieldDef.max}`}${fieldDef.unit?" "+fieldDef.unit:""} · default ${m.entry(field)?.defaultValue??"unset"}`));
          const error=validateConfigValue(fieldDef,value);if(error)row.child(div().text_size(11.5).text_color(t.blocked).child(error));
        }
        if(m.row.error)row.child(div().id("config-save-refusal").text_size(12).text_color(t.blocked).child(m.row.error));
        row.child(h_flex().gap(6).child(this.action(t,`config-save-${key}`,m.busy?"Saving…":"Save",(_e,ctx)=>this.save(ctx),{primary:true,disabled:m.busy||!!m.plan().error}))
          .child(this.action(t,`config-cancel-${key}`,"Cancel",(_e,ctx)=>this.cancel(ctx),{disabled:m.busy})));
      }
      const receipt=m.receipt(key);if(receipt){this.page.ticking=true;row.child(h_flex().gap(6).items_center()
        .child(div().id(`config-result-${key}`).text_size(11.5).text_color(t.muted).child(receipt.text))
        .when(receipt.undo!==null&&!readOnly,el=>el.child(this.action(t,`config-undo-${key}`,"Undo",(_e,ctx)=>{
          this.execute(ctx,m.undo(key));},{disabled:m.busy}))));}
      out.push(row);
    }
    if(m.discardFor)out.push(this.page.card(t,`Discard your change to ${m.row.key}?`,[
      h_flex().gap(6).child(this.action(t,"config-discard","Discard",(_e,ctx)=>{const key=m.discardFor;m.cancel();this.open(key,ctx);}))
        .child(this.action(t,"config-keep-editing","Keep editing",(_e,ctx)=>{m.discardFor=null;ctx.notify();},{primary:true}))]));
    if(m.confirmation){const confirmation=m.confirmation,key=confirmation.changes[0][0];
      out.push(this.page.card(t,`${confirmation.reset?"Reset":"Change"} ${key}${confirmation.reset?"":` to ${confirmation.changes[0][1]}`}?`,[
        div().text_size(12).text_color(t.foreground).child(confirmation.consequence),
        h_flex().gap(6).child(this.action(t,"config-confirm-cancel","Cancel",(_e,ctx)=>{m.confirmation=null;ctx.notify();})
          .when(!!this.cancelHandle,el=>el.track_focus(this.cancelHandle).tab_stop(true).tab_index(0)))
          .child(this.action(t,"config-confirm-save",confirmation.destructive?"Delete older history":`Save ${key}`,(_e,ctx)=>this.execute(ctx,m.confirm()),{disabled:m.busy,primary:true})
            .when(confirmation.destructive,el=>el.bg(t.blocked).text_color(t.solid_foreground).hover(s=>s.bg(t.blocked))))]));
    }
    return out;
  }
}
