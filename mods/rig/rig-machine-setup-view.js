import {div,svg} from "gpui-kit";
import {v_flex,h_flex} from "gpui-base";
import {reviewMachineSetup,approveMachineSetup,stopUsingMachine} from "./rig-machine-setup.js";

export class MachineSetupPanel {
  constructor(host,config,machine,{done,cancel,mono="monospace",copyIcon,stop=false,cancelHandle,primaryHandle,copyHandles={}}={}){
    this.host=host;this.config=config;this.machine=machine;this.done=done;this.cancel=cancel;
    this.mono=mono;this.copyIcon=copyIcon;this.stop=stop;this.phase=stop?"ready":"checking";
    this.cancelHandle=cancelHandle;this.primaryHandle=primaryHandle;
    this.copyHandles=copyHandles;
  }
  async check(cx){
    if(this.busy)return;this.phase="checking";this.error=null;cx.notify();
    this.review=await reviewMachineSetup(this.host,this.config,this.machine);
    this.phase=this.review.ok?"ready":"error";this.error=this.review.ok?null:this.review.reason;cx.notify();
  }
  approve(cx){
    if(this.busy||this.phase!=="ready")return;
    this.busy=true;this.phase="working";this.error=null;cx.notify();
    cx.spawn(async cx=>{
      try{
        await this.host.beforeApprove?.();
        const result=this.stop?await stopUsingMachine(this.host,this.config,this.machine):await approveMachineSetup(this.host,this.review,phase=>{
          this.progress=phase;cx.notify();
        });
        if(result.ok){this.result=result;this.phase="done";await this.host.saved?.(result,this.stop);}
        else if(result.needsConsent){this.phase="error";this.error="The machine or helper changed. Check again and review its details.";}
        else {this.phase="error";this.error=result.reason;}
      }catch(error){this.phase="error";this.error=String(error?.message??error);}
      finally{this.busy=false;cx.notify();const handle=this.phase==='done'?this.primaryHandle:this.stop&&this.phase==='error'?this.cancelHandle:null;if(handle)cx.timer.after(0,nextCx=>{handle.focus();nextCx.notify();});}
    });
  }
  button(id,text,callback,{disabled=false,primary=false}={}){
    return div().id(`${id}-focus`).p(2).border(2).border_color('#00000000').rounded(7).role("button").tab_stop(!disabled)
      .when(!!(id==='machine-setup-cancel'?this.cancelHandle:this.primaryHandle),el=>el.track_focus(id==='machine-setup-cancel'?this.cancelHandle:this.primaryHandle))
      .focus(el=>el.border_color(this.theme.accent))
      .on_key_down((event,cx)=>{if(!disabled&&["enter"," ","space"].includes(String(event.key??"").toLowerCase())){cx.stop_propagation();callback(cx);}})
      .child(div().id(id).px(10).py(6).rounded(5)
      .text_size(12).bg(primary?this.theme.accent:this.theme.raised).text_color(primary?this.theme.solid_foreground:this.theme.foreground)
      .when(disabled,el=>el.opacity(.45)).when(!disabled,el=>el.cursor_pointer().hover(el=>el.bg(primary?this.theme.accent:this.theme.hover)))
      .on_click((_e,cx)=>{if(!disabled)callback(cx);})
      .on_key_down((event,cx)=>{if(!disabled&&["enter"," ","space"].includes(String(event.key??"").toLowerCase())){cx.stop_propagation();callback(cx);}}).child(text));
  }
  value(label,value,{copy=false}={}){
    return h_flex().gap(8).items_start()
      .child(div().w(76).flex_none().text_color(this.theme.muted).child(label))
      .child(div().flex_1().min_w(0).font_family(this.mono).text_size(11).child(value))
      .when(copy,el=>el.child(div().id(`machine-setup-copy-${label==="SHA-256"?"sha":label.toLowerCase()}`).role("button").tab_stop(true).size(20).flex_none().cursor_pointer().tooltip("Copy SHA-256")
        .when(!!this.copyHandles[label],el=>el.track_focus(this.copyHandles[label])).focus(el=>el.border(1).border_color(this.theme.accent))
        .on_click((_e,cx)=>cx.write_to_clipboard(value))
        .on_key_down((event,cx)=>{if(event.key==="enter"){cx.stop_propagation();cx.write_to_clipboard(value);}})
        .child(svg(this.copyIcon).size(12).text_color(this.theme.muted))));
  }
  render(t,cx){
    this.theme=t;
    const c=this.review?.confirmation,done=this.phase==="done",update=!!this.review?.alreadyConfigured&&c?.fileState==="older";
    const cycle=(forward,cx)=>{
      cx.stop_propagation();
      const copies=this.stop?[this.copyHandles.Command]:!done&&this.phase!=='checking'&&c?[this.copyHandles.Folder,this.copyHandles['SHA-256']]:[];
      const first=copies[0]??(done?this.primaryHandle:this.cancelHandle);
      const last=this.busy?copies.at(-1):done||this.phase==='ready'||this.phase==='error'&&!this.stop?this.primaryHandle:this.cancelHandle;
      if(this.busy&&!last)return;
      const boundary=forward&&last?.is_focused?.()?first:!forward&&first?.is_focused?.()?last:null;
      if(boundary){this.focusTask?.cancel?.();this.focusTask=cx.timer.after(16,nextCx=>{boundary.focus();nextCx.notify();});}
      else if(forward)globalThis.window.focus_next();else globalThis.window.focus_prev();
    };
    const root=v_flex().id("machine-setup").size_full().p(14).gap(10).bg(t.surface).text_color(t.foreground).text_size(12)
      .key_context('RigDialog').on_action('rig-dialog-next',(_e,cx)=>cycle(true,cx)).on_action('rig-dialog-prev',(_e,cx)=>cycle(false,cx))
      .on_key_down((event,cx)=>{
        if(event.key==='tab'&&!event.modifiers?.control&&!event.modifiers?.platform&&!event.modifiers?.alt){cycle(!event.modifiers?.shift,cx);}
        else if(event.key==="escape"&&!this.busy){cx.stop_propagation();(done?this.done:this.cancel)?.(cx,this.result);}})
      .child(div().text_size(15).font_semibold().child(this.stop?`Stop using ${this.machine}?`:update?`Update the Attach helper on ${this.machine}`:`Use ${this.machine}`));
    let body=v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(8);
    if(this.stop)body=body.child(div().child(`OpenRig's spaces will open on this computer again. Seats on ${this.machine} keep running; open box tiles stay until you close them. The Attach helper stays on that machine.`))
      .child(div().text_color(t.muted).child(`To remove the helper yourself, run this on ${this.machine}:`))
      .child(this.value("Command","rm ~/.local/share/herdr-openrig/rig-attach-relay.cjs",{copy:true}));
    else if(this.phase==="checking")body=body.child(div().text_color(t.muted).child("◌ Checking the Herdr machine, OpenRig identity and Attach helper…"));
    else if(c&&!done){
      body=body.child(div().child(update?`herdrig has a new Attach helper. Approve it to keep opening seats on ${c.machine}.`:`Herdr will open OpenRig's spaces, Attach and the Operator on ${c.machine}.`))
        .child(v_flex().gap(3).id("machine-setup-checks")
          .child(div().child(`✓ Connected through Herdr machine ${c.machine}`))
          .child(div().child("✓ OpenRig answers there"))
          .child(div().child(`✓ Same OpenRig as your tunnel · host ${c.selfHostId}`)))
        .child(div().font_semibold().child("This saves on this computer"))
        .child(div().text_color(t.muted).child(this.review.alreadyConfigured?"daemonMachine: already set in openrig/config.json":`daemonMachine = ${c.machine} in openrig/config.json`))
        .child(div().font_semibold().child(`This installs on ${c.machine}`))
        .child(this.value("File","rig-attach-relay.cjs (the Attach helper)"))
        .child(this.value("Folder",c.folder,{copy:true})).child(this.value("Account",`${c.user} on ${c.target}`))
        .child(this.value("SHA-256",c.sha256,{copy:true}))
        .child(div().id("machine-setup-file-state").text_color(t.muted).child(c.fileState==="same"?"Installed, same version: nothing to write":c.fileState==="older"?"Older version: this replaces it":"Not installed yet"))
        .child(div().font_semibold().child("What it allows"))
        .child(div().child("Herdr machine access gives programs on this computer, including Herdr mods, full shell access to that account: its commands, files and terminals. This setup installs and runs the Attach helper there, and reads seat names from OpenRig."))
        .child(div().text_color(t.muted).child("A changed helper checksum asks for approval again. Saving specs on that machine asks separately; this approval does not include it."));
    }
    if(this.error)body=body.child(div().id("machine-setup-error").text_color(t.blocked).child(`✗ ${this.error}`));
    if(done)body=body.child(div().id("machine-setup-done").child(this.stop?`✓ Stopped using ${this.machine}. Open box tiles and the helper were left in place.`
      :`✓ Using ${this.machine}. Attach helper ${this.result.installed?"installed and verified":"already installed, verified"}.`));
    if(this.busy)body=body.child(div().id("machine-setup-progress").text_color(t.muted).child(this.stop?"Saving…":this.progress==="install"?"Installing the Attach helper…":this.progress==="verify"?"Checking its SHA-256…":"Saving…"));
    const footer=h_flex().gap(8).justify_end().flex_none();
    if(done)footer.child(this.button("machine-setup-done-button","Done",cx=>this.done?.(cx,this.result),{primary:true}));
    else if(!this.busy){
      footer.child(this.button("machine-setup-cancel","Cancel",cx=>this.cancel?.(cx)));
      if(this.phase==="error"&&!this.stop)footer.child(this.button("machine-setup-check-again","Check again",cx=>cx.spawn(cx=>this.check(cx)),{primary:true}));
      else footer.child(this.button("machine-setup-approve",this.stop?`Stop using ${this.machine}`:update?"Update helper":`Use ${this.machine}`,cx=>this.approve(cx),{disabled:this.phase!=="ready",primary:true}));
    }
    return root.child(body).child(footer);
  }
}
