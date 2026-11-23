import { errorDiagnostic } from "./rig-words.js";
import {activationPair} from './rig-activation.js';
import {withFocusContext,releaseFocusTargets} from './rig-lib.js';
import {div,svg} from "gpui-kit";
import {errorBlock} from "./rig-error-view.js";
import {v_flex,h_flex,InputState,Input} from "gpui-base";
import {machineSetupGate,listAddableMachines} from "./rig-remote.js";
import {connectionsOf,nextTunnelAddress,tunnelCommand,openrigHomeProblem,openrigHomeWarning,formatHostId,plainExecError,localConnectionMissing} from "./rig-connections.js";

// The "add a machine" dialog. One gate per open dialog; it is expired on save, on cancel and when the dialog goes away.
// Phases: checking (the box side) -> ready (the tunnel section) -> tunnel (reading it) -> verified -> saving -> done; "nothing" when no OpenRig answers there.
// Keys: Enter in either field runs Check and never Save; Save needs a tick for the current address and a valid home; Esc leaves like Cancel; Tab wraps in the dialog.
// A short id reads as itself; only a long one is cut (the full id stays in the tooltip).
const shortHost=formatHostId;
export class AddMachinePanel {
  constructor(host,machine,picked,{liveConfig,done,cancel,mono="monospace",copyIcon,cancelHandle,primaryHandle,copyHandles={}}={}){
    this.host=host;this.machine=machine;this.picked=picked??null;this.liveConfig=liveConfig;this.done=done;this.cancel=cancel;
    this.mono=mono;this.copyIcon=copyIcon;this.cancelHandle=cancelHandle;this.primaryHandle=primaryHandle;this.copyHandles=copyHandles;
    this.phase="checking";this.error=null;this.tunnelError=null;this.verified=null;this.homeTouched=false;this.focusedField=null;
    this.homeCheckedPath=null;this.homeExists=null;this.homeProbeTask=null;this.homeProbeGen=0;
    this.gate=machineSetupGate(host,machine,picked);
    this.addressInput=InputState.new({value:"",placeholder:"http://127.0.0.2:7433"});
    this.homeInput=InputState.new({value:"",placeholder:"/path/to/this/connection's/openrig-home"});
    // Editing the address means what was checked is no longer what would be saved; editing either field re-draws the command and Save.
    this.addressInput.on("change",(_e,cx)=>{if(this.verified){this.verified=null;if(this.phase==="verified")this.phase="ready";}this.tunnelError=null;cx.notify();});
    this.homeInput.on("change",(_e,cx)=>{this.homeProbeGen++;this.homeCheckedPath=null;this.homeExists=null;cx.spawn(async next=>{await this.probeHome(next);});cx.notify();});
    for(const state of [this.addressInput,this.homeInput]){
      state.on("focus",()=>{this.focusedField=state;});
      state.on("blur",()=>{if(this.focusedField===state)this.focusedField=null;});
      state.on("submit",(_e,cx)=>this.checkTunnel(cx)); // Enter checks; it never saves
    }
  }
  expire(){this.expired=true;releaseFocusTargets(this);this.gate.expire();this.pendingFocus=null;this.focusTask?.cancel?.();}
  /** Puts the keyboard in a field once it is drawn; a refused check keeps the person in the field it names. */
  focusField(state,cx,{select=false}={}){
    this.pendingFocus={state,select};
  }
  homeText(){return String(this.homeInput.value()??"").trim();}
  homeWarning(){
    const text=this.homeText();
    if(openrigHomeProblem(text))return null;
    const paths=this.gate.machinePaths?.()??null;
    const exists=this.homeCheckedPath===text?this.homeExists:null;
    return openrigHomeWarning(text,{
      machine:this.machine,exists,
      localHome:this.host.localHome?.()??null,
      machineHome:paths?.home??null,workspaceRoot:paths?.workspaceRoot??null,
      machineFolders:this.host.machineFolders?.(this.machine)??[],
    });
  }
  probeHome(cx){
    if(this.homeProbeTask)return this.homeProbeTask;
    if(typeof this.host.localFolderExists!=="function"||openrigHomeProblem(this.homeText())||this.gate.expired())return Promise.resolve();
    // A real completion barrier, not Promise.resolve(TaskHandle). Publish it before
    // running so an immediate no-op cannot overwrite its own finally cleanup.
    let finish,fail;const completion=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});this.homeProbeTask=completion;
    const run=async nextCx=>{
      try{
        while(!this.gate.expired()){
          const target=this.homeText(),gen=this.homeProbeGen;
          if(openrigHomeProblem(target)){this.homeCheckedPath=null;this.homeExists=null;break;}
          if(this.homeCheckedPath===target&&this.homeExists!==null)break;
          let exists=null;
          try{exists=await this.host.localFolderExists(target);}catch(_){exists=null;}
          if(this.gate.expired())return;
          if(this.homeProbeGen===gen&&this.homeText()===target){this.homeCheckedPath=target;this.homeExists=exists;nextCx?.notify?.();break;}
        }
      }finally{if(this.homeProbeTask===completion)this.homeProbeTask=null;}
    };
    // All callers supply a task context: input changes spawn in their event, while
    // check/checkTunnel already run in tasks. Do not spawn from their late continuations.
    run(cx).then(finish,fail);
    return completion;
  }
  /** The box side, then the suggested tunnel: the next unused loopback with the box's own port, and the command to make it. */
  async check(cx){
    if(this.busy)return;
    this.phase="checking";this.error=null;cx.notify();
    try{
      const found=await this.gate.checkIdentity();
      if(!found){this.phase="nothing";this.error=`OpenRig doesn't answer on ${this.machine}. Check rig status on that machine, then check again.`;cx.notify();return;}
      let existing=[];
      try{existing=connectionsOf(JSON.parse(await this.host.readConfig()??"{}")).connections;}catch(_){}
      const live=this.liveConfig?.();
      // A switched connection's kept tunnel address is taken too: suggesting it would put two connections on one address after a switch back.
      const taken=[...existing,...existing.filter(c=>c?.retainedDaemonUrl).map(c=>({daemonUrl:c.retainedDaemonUrl})),...(live?.daemonUrl?[{daemonUrl:live.daemonUrl}]:[])];
      const address=nextTunnelAddress(taken,found.port);
      this.suggested=address;
      // What the person typed stays: a second check (after a refusal or an expired screen) never overwrites the field.
      if(!String(this.addressInput.value()??"").trim())this.addressInput.set_value?.(address??"");
      this.boxPort=found.port;this.found=found;this.phase="ready";
      await this.probeHome(cx);
      this.focusField(this.addressInput,cx,{select:true});
    }catch(error){this.phase="error";this.error=plainExecError(error,{machine:this.machine,kind:"remote"});}
    cx.notify();
  }
  /** [Check]: reads /healthz through the address the person gave and compares the host id with the machine's. */
  checkTunnel(cx){
    if(this.busy||!["ready","verified"].includes(this.phase))return;
    const checkedAddress=String(this.addressInput.value()??"").trim();
    this.busy=true;this.phase="tunnel";this.tunnelError=null;this.verified=null;this.homeTouched=true;this.homeProbeGen++;this.homeCheckedPath=null;this.homeExists=null;cx.notify();
    cx.spawn(async cx=>{
      const homeCheck=this.probeHome(cx);
      try{
        const verified=await this.gate.checkTunnel(checkedAddress,{liveConfig:this.liveConfig?.()??undefined});
        await homeCheck;
        if(String(this.addressInput.value()??"").trim()!==checkedAddress){this.phase="ready";return;}
        this.verified=verified;this.phase="verified";
        if(openrigHomeProblem(this.homeText())||this.homeWarning())this.focusField(this.homeInput,cx);
      }catch(error){
        await homeCheck;
        this.phase="ready";
        if(String(this.addressInput.value()??"").trim()===checkedAddress){this.tunnelError=errorDiagnostic(error);this.focusField(this.addressInput,cx);}
      }
      finally{this.busy=false;cx.notify();}
    });
  }
  /** [Save]: the compare-and-swap save of exactly what [Check] verified, plus the OpenRig home the person typed. */
  save(cx){
    if(this.busy||this.phase!=="verified")return;
    this.busy=true;this.phase="saving";this.error=null;cx.notify();
    cx.spawn(async cx=>{
      try{
        const before=await this.host.readConfig()??null;
        const saved=await this.gate.save(before,{openrigHome:this.homeText(),liveConfig:this.liveConfig?.()??null});
        this.saved=saved;this.phase="done";
        try{await this.host.saved?.(saved);}catch(error){this.warning="Herdr couldn't update its own saved state for this connection.";}
      }catch(error){
        this.phase="verified";this.error=error?.code==="CONFIG_CHANGED"?`${error.message} Reopen it and check again.`:errorDiagnostic(error);this.homeTouched=true;
        this.focusField(openrigHomeProblem(this.homeText())?this.homeInput:this.addressInput,cx);
      }
      finally{this.busy=false;cx.notify();}
    });
  }
  button(id,text,callback,{disabled=false,primary=false}={}){
    const activation=activationPair(this,id);
    const handle=id==="add-machine-cancel"?this.cancelHandle:["add-machine-add","add-machine-check-again","add-machine-done-button"].includes(id)?this.primaryHandle:null;
    return div().id(`${id}-focus`).p(2).border(2).border_color("#00000000").rounded(7).role("button").tab_stop(!disabled)
      .when(!disabled&&!!handle,el=>el.track_focus(handle))
      .focus(el=>el.border_color(this.theme.accent))
      .on_mouse_down('left',activation.pointer())
      .on_key_down(activation.key((event,cx)=>{if(!disabled&&["enter"," ","space"].includes(String(event.key??"").toLowerCase())){cx.stop_propagation();callback(cx);}}))
      .child(div().id(id).px(10).py(6).rounded(5).text_size(12).bg(primary?this.theme.accent:this.theme.raised)
        .text_color(primary?this.theme.solid_foreground:this.theme.foreground)
        .when(disabled,el=>el.opacity(.45)).when(!disabled,el=>el.cursor_pointer())
        .on_mouse_down('left',activation.pointer()).on_click(activation.click((_e,cx)=>{if(!disabled)callback(cx);})).child(text));
  }
  render(...args){return withFocusContext(this,args[1],()=>this.renderFocused(...args));}
  renderFocused(t,cx){
    this.theme=t;
    if(this.pendingFocus){const {state,select}=this.pendingFocus;this.pendingFocus=null;this.focusTask?.cancel?.();
      this.focusTask=cx.timer?.after?.(0,next=>{if(this.gate.expired())return;state.focus?.();if(select)state.set_selected_range?.({start:0,end:String(state.value()??"").length});next.notify?.();});}
    const ready=["ready","tunnel","verified","saving"].includes(this.phase),done=this.phase==="done";
    const addressText=String(this.addressInput.value()??"").trim(),homeProblem=openrigHomeProblem(this.homeText()),homeWarning=this.homeWarning();
    const command=ready?tunnelCommand(addressText,this.boxPort,this.machine,this.picked?.target):null;
    const canSave=this.phase==="verified"&&!homeProblem,retry=this.phase==="nothing"||this.phase==="error";
    // Tab wraps inside the dialog: past the last enabled control it returns to the Address field (or Cancel before the tunnel section exists).
    const cycle=(forward,cx)=>{
      cx.stop_propagation();
      if(this.busy)return;
      const first=ready?{focus:()=>this.addressInput.focus(),is_focused:()=>this.focusedField===this.addressInput}:this.cancelHandle;
      const last=done||retry||canSave?this.primaryHandle:this.cancelHandle;
      const boundary=forward&&last?.is_focused?.()?first:!forward&&first?.is_focused?.()?last:null;
      if(boundary){this.focusTask?.cancel?.();this.focusTask=cx.timer.after(16,nextCx=>{boundary.focus();nextCx.notify();});}
      else if(forward)globalThis.window.focus_next();else globalThis.window.focus_prev();
    };
    const root=v_flex().id("add-machine").size_full().p(14).gap(10).bg(t.surface).text_color(t.foreground).text_size(12)
      .key_context("RigDialog").on_action("rig-dialog-next",(_e,cx)=>cycle(true,cx)).on_action("rig-dialog-prev",(_e,cx)=>cycle(false,cx))
      .on_key_down((event,cx)=>{
        if(event.key==="tab"&&!event.modifiers?.control&&!event.modifiers?.platform&&!event.modifiers?.alt)cycle(!event.modifiers?.shift,cx);
        else if(event.key==="escape"&&!this.busy){cx.stop_propagation();this.expire();(done?this.done:this.cancel)?.(cx,this.saved);}})
      .child(div().text_size(15).font_semibold().child(`Add ${this.machine}`));
    let body=v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(8);
    if(this.phase==="checking")body=body.child(div().id("add-machine-checking").text_color(t.muted).child(`◌ Checking Herdr machine ${this.machine} for OpenRig…`));
    if(retry)body=body.child(div().id("add-machine-error").text_color(t.blocked).child(errorBlock(this,t,"add-machine-error-detail",this.error,{where:"this computer"})));
    if(ready||done){
      body=body.child(div().child(`OpenRig also runs on ${this.machine}. This shows its rigs here too.`))
        .child(v_flex().gap(3).id("add-machine-checks")
          .child(div().child(`✓ Connected through Herdr machine ${this.machine}`))
          .child(div().child(`✓ OpenRig answers there · host ${this.found?.selfHostId}`)))
        .child(div().font_semibold().child("How this computer reaches it"))
        .child(div().text_color(t.muted).child("Address"))
        .child(Input.new(this.addressInput).id("add-machine-address"))
        .when(this.phase==="tunnel",el=>el.child(div().id("add-machine-tunnel-progress").text_color(t.muted).child(`◌ Checking ${addressText}…`)))
        .when(!!this.tunnelError,el=>el.child(div().id("add-machine-tunnel-error").text_color(t.blocked).child(errorBlock(this,t,"add-machine-tunnel-error-detail",this.tunnelError,{where:"this computer",prefix:"✗ "}))))
        .when(!!this.verified,el=>el.child(div().id("add-machine-tunnel-ok").tooltip(`Host ${this.verified.selfHostId}`).text_color(t.working).child(`✓ Reaches ${this.machine}'s OpenRig (host ${shortHost(this.verified.selfHostId)})`)))
        .child(div().text_color(t.muted).child(`A tunnel from this computer to ${this.machine}. Herdr never creates it. Create it with:`))
        .child(command?h_flex().gap(8).items_start()
          .child(div().id("add-machine-command").flex_1().min_w(0).font_family(this.mono).text_size(11).child(command))
          .child(div().id("add-machine-copy-command").role("button").tab_stop(true).size(20).flex_none().cursor_pointer().tooltip("Copy the command")
            .when(!!this.copyHandles.Command,el=>el.track_focus(this.copyHandles.Command)).focus(el=>el.border(1).border_color(t.accent))
            .on_mouse_down('left',activationPair(this,'add-machine-copy-command').pointer())
            .on_click(activationPair(this,'add-machine-copy-command').click((_e,cx)=>cx.write_to_clipboard(command)))
            .on_key_down(activationPair(this,'add-machine-copy-command').key((event,cx)=>{if(!event.is_held&&["enter"," ","space"].includes(String(event.key??"").toLowerCase())){cx.stop_propagation();cx.write_to_clipboard(command);}}))
            .child(svg(this.copyIcon).size(12).text_color(t.muted))):div().id("add-machine-no-address").text_color(t.muted).child(this.suggested?"The command appears when the address is a loopback address such as http://127.0.0.2:7433.":"No free loopback address was found. Type one yourself."))
        .child(div().text_color(t.muted).child("OpenRig home on this computer"))
        .child(Input.new(this.homeInput).id("add-machine-home"))
        .child(div().text_color(t.muted).text_size(11).child(`The folder rig on this computer uses for ${this.machine}'s OpenRig: its settings and sign-in. Each OpenRig needs its own.`))
        .when(this.homeTouched&&!!homeProblem&&!done,el=>el.child(div().id("add-machine-home-error").text_color(t.blocked).child(`✗ ${homeProblem}`)))
        .when(!homeProblem&&!!homeWarning&&!done,el=>el.child(div().id("add-machine-home-warning").text_color(t.working).child(`⚠ ${homeWarning}`)))
        .child(this.button("add-machine-check","Check",cx=>this.checkTunnel(cx),{disabled:this.busy||done}));
    }
    if(this.phase==="saving")body=body.child(div().id("add-machine-progress").text_color(t.muted).child("Saving…"));
    if(ready&&this.error&&this.error!==homeProblem)body=body.child(div().id("add-machine-save-error").text_color(t.blocked).child(errorBlock(this,t,"add-machine-save-error-detail",this.error,{where:"this computer"})));
    if(done)body=body.child(div().id("add-machine-done").child(`✓ Added ${this.machine}. Its first Attach asks you to approve the helper there.`))
      .when(!!this.warning,el=>el.child(div().id("add-machine-warning").text_color(t.working).child(this.warning)));
    const footer=h_flex().gap(8).justify_end().flex_none();
    if(done)footer.child(this.button("add-machine-done-button","Done",cx=>{this.expire();this.done?.(cx,this.saved);},{primary:true}));
    else if(!this.busy){
      footer.child(this.button("add-machine-cancel","Cancel",cx=>{this.expire();this.cancel?.(cx);}));
      if(retry)footer.child(this.button("add-machine-check-again","Check again",cx=>cx.spawn(cx=>this.check(cx)),{primary:true}));
      else footer.child(this.button("add-machine-add","Save",cx=>this.save(cx),{disabled:!canSave,primary:true}));
    }
    return root.child(body).child(footer);
  }
}

/** "Add a machine…" by hand: the person picks one of Herdr's connected machines that has no connection yet, then the same screen as the offer
 *  runs for it. With none left it says so and offers only Close. Nothing is run on any machine until one is picked. */
/** The handle when it can still be used (is_focused() on a released one throws), else null. */
const liveFocus=h=>{if(!h)return null;try{h.is_focused?.();return h;}catch(_){return null;}};
export class AddMachineChooser {
  constructor(host,{liveConfig,makePanel,makeLocalPanel,cancel,cancelHandle,primaryHandle}={}){
    this.host=host;this.liveConfig=liveConfig;this.makePanel=makePanel;this.makeLocalPanel=makeLocalPanel;this.cancel=cancel;this.cancelHandle=cancelHandle;this.primaryHandle=primaryHandle;
    this.phase="loading";this.rows=[];this.error=null;this.panel=null;
  }
  expire(){this.expired=true;releaseFocusTargets(this);this.focusTask?.cancel?.();this.panel?.expire?.();for(const handle of this.rowHandles??[])handle?.release?.();this.rowHandles=[];}
  hasChoices(){return this.phase==="choose" ? Boolean(this.rows.length||this.local) : this.phase==="error"&&this.local;}
  cycleFocus(forward,cx){
    cx.stop_propagation();
    const handles=[...(this.hasChoices()?this.rowHandles??[]:[]),this.cancelHandle].map(liveFocus).filter(Boolean);
    if(this.expired||this.panel||!handles.length)return;
    const index=handles.findIndex(handle=>handle.is_focused?.());
    const next=handles[index<0?(forward?0:handles.length-1):(index+(forward?1:-1)+handles.length)%handles.length];
    // Created by the key/action entry point, using existing owned handles. Correct native Tab traversal after it runs.
    this.focusTask?.cancel?.();
    this.focusTask=cx.timer.after(16,nextCx=>{if(!this.expired&&!this.panel&&liveFocus(next)){next.focus();nextCx.notify();}});
  }
  async load(cx){
    try{
      const live=this.liveConfig?.()??{},taken=[live.daemonMachine,...(live.connections??[]).map(c=>c?.machine)];
      this.local=localConnectionMissing(live)&&typeof this.makeLocalPanel==='function';
      this.rows=await listAddableMachines(this.host,taken);this.phase="choose";
    }catch(error){this.rows=[];this.phase="error";this.error=plainExecError(error,{machine:this.machine,kind:"remote"});}
    // The next draw creates focus handles, so they belong to this view.
    for(const handle of this.rowHandles??[])handle?.release?.();
    this.rowHandles=[];
    cx.notify();
  }
  async chooseLocal(cx){
    if(this.expired||this.panel||!this.local)return;
    // This method starts from the chooser's live event task, before its first await.
    this.panel=this.makeLocalPanel(cx);cx.notify();await this.panel.open(cx);
  }
  async choose(row,cx){
    if(this.expired||this.panel)return;
    this.panel=this.makePanel(row.name,{target:row.target,session:row.session});
    cx.notify();await this.panel.check(cx);
  }
  /** From a draw (the view's own call): one timer that makes a focus handle per machine row (never in the draw itself, which Herdr refuses). */
  rowHandlesFor(cx){
    const rows=this.rows,count=rows.length+(this.local?1:0);
    if(this.expired||this.rowHandlesPending||!count||!cx?.timer?.after||(this.rowHandles?.length===count&&this.rowHandles.every(h=>liveFocus(h))))return;
    this.rowHandlesPending=true;
    cx.timer.after(0,next=>{
      this.rowHandlesPending=false;
      if(this.expired||this.rows!==rows||!next?.focus_handle)return;
      this.rowHandles=Array.from({length:count},(_,i)=>liveFocus(this.rowHandles?.[i])??next.focus_handle());
      next.notify?.();
    });
  }
  render(...args){return withFocusContext(this,args[1],()=>this.renderFocused(...args));}
  renderFocused(t,cx){
    if(this.panel)return this.panel.render(t,cx);
    this.theme=t;
    const hasChoices=this.hasChoices();
    if(hasChoices)this.rowHandlesFor(cx);
    const root=v_flex().id("add-machine-choose").size_full().p(14).gap(10).bg(t.surface).text_color(t.foreground).text_size(12)
      .key_context("RigDialog").on_action("rig-dialog-next",(_e,cx)=>this.cycleFocus(true,cx)).on_action("rig-dialog-prev",(_e,cx)=>this.cycleFocus(false,cx))
      .on_key_down((event,cx)=>{if(event.key==="tab"&&!event.modifiers?.control&&!event.modifiers?.platform&&!event.modifiers?.alt)this.cycleFocus(!event.modifiers?.shift,cx);else if(event.key==="escape"){cx.stop_propagation();this.expire();this.cancel?.(cx);}})
      .child(div().text_size(15).font_semibold().child("Add a machine"));
    let body=v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(6);
    if(this.phase==="loading")body=body.child(div().id("add-machine-loading").text_color(t.muted).child("◌ Reading Herdr's machines…"));
    else if(this.phase==="error")body=body.child(div().id("add-machine-choose-error").text_color(t.blocked).child(errorBlock(this,t,"add-machine-choose-error-detail",this.error,{where:"this computer"})));
    else if(!hasChoices)body=body.child(div().id("add-machine-none").child("Every connected Herdr machine already has a connection."));
    if(hasChoices){
      body=body.child(div().text_color(t.muted).child("Machine"));
      if(this.local){const activation=activationPair(this,'pick-local');body=body.child(v_flex().id('add-machine-pick-local').role('button').tab_stop(true).px(8).py(5).rounded(5).bg(t.raised).cursor_pointer()
        .when(!!this.rowHandles?.[0],el=>el.track_focus(this.rowHandles[0])).focus(el=>el.border_1().border_color(t.accent))
        .on_mouse_down('left',activation.pointer()).on_click(activation.click((_e,next)=>next.spawn(task=>this.chooseLocal(task))))
        .on_key_down(activation.key((e,next)=>{if(['enter',' ','space'].includes(e.key)&&!e.is_held){next.stop_propagation();next.spawn(task=>this.chooseLocal(task));}}))
        .child(div().child('This computer')).child(div().text_size(11).text_color(t.muted).child('The OpenRig that runs here')));}
      for(const [i,row] of this.rows.entries())body=body.child(div().id(`add-machine-pick-${row.name}`).role("button").tab_stop(true).px(8).py(5).rounded(5).bg(t.raised).cursor_pointer()
        .when(!!this.rowHandles?.[i+(this.local?1:0)],el=>el.track_focus(this.rowHandles[i+(this.local?1:0)]))
        .focus(el=>el.border_1().border_color(t.accent))
        .on_mouse_down('left',activationPair(this,`pick-${row.name}`).pointer())
        .on_click(activationPair(this,`pick-${row.name}`).click((_e,cx)=>cx.spawn(cx=>this.choose(row,cx))))
        .on_key_down(activationPair(this,`pick-${row.name}`).key((e,cx)=>{if(!e.is_held&&["enter"," ","space"].includes(String(e.key??"").toLowerCase())){cx.stop_propagation();cx.spawn(cx=>this.choose(row,cx));}})).child(row.name));
    }
    const closeLabel=hasChoices?"Cancel":"Close";
    const close=div().id("add-machine-choose-close-focus").p(2).border(2).border_color("#00000000").rounded(7).role("button").tab_stop(true)
      .when(!!this.cancelHandle,el=>el.track_focus(this.cancelHandle)).focus(el=>el.border_color(t.accent))
      .on_mouse_down('left',activationPair(this,'choose-close').pointer())
      .on_key_down(activationPair(this,'choose-close').key((e,cx)=>{if(!e.is_held&&["enter"," ","space"].includes(String(e.key??"").toLowerCase())){cx.stop_propagation();this.expire();this.cancel?.(cx);}}))
      .child(div().id("add-machine-choose-close").px(10).py(6).rounded(5).text_size(12).bg(t.raised).cursor_pointer()
        .on_mouse_down('left',activationPair(this,'choose-close').pointer())
        .on_click(activationPair(this,'choose-close').click((_e,cx)=>{this.expire();this.cancel?.(cx);})).child(closeLabel));
    return root.child(body).child(h_flex().gap(8).justify_end().flex_none().child(close));
  }
}
