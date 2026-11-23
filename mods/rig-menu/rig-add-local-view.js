import {div} from 'gpui-kit';
import {v_flex,h_flex,InputState,Input} from 'gpui-base';
import {activationPair} from './rig-activation.js';
import {errorBlock} from './rig-error-view.js';
import {errorDiagnostic,plainError} from './rig-words.js';
import {releaseFocusTargets} from './rig-lib.js';
import {localSetupGate} from './rig-remote.js';

/** Created in a dialog event or its draw-set timer, before any await. */
export class AddLocalPanel {
  constructor(host,{rigArgv,done,cancel,mono='monospace',cancelHandle,primaryHandle}={}){
    Object.assign(this,{host,done,cancel,mono,cancelHandle,primaryHandle});
    this.gate=localSetupGate(host,{rigArgv});this.phase='edit';this.generation=0;
    this.homeInput=InputState.new({value:'',placeholder:"/path/to/this/computer's/openrig-home"});
    this.homeInput.on('change',(_e,cx)=>{
      if(this.phase==='saving'||this.phase==='done'||this.phase==='uncertain')return;
      this.generation++;this.gate.invalidate();this.verified=null;this.error=null;this.phase='edit';cx.notify();
    });
    this.homeInput.on('submit',(_e,cx)=>this.check(cx));
    this.homeInput.on('focus',()=>{this.homeFocused=true;});this.homeInput.on('blur',()=>{this.homeFocused=false;});
  }
  expire(){if(this.expired)return;this.expired=this.closed=true;this.generation++;this.gate.expire();this.pendingFocus=null;this.focusTask?.cancel?.();this.homeInput.release?.();this.checkHandle?.release?.();releaseFocusTargets(this);}
  homeText(){return String(this.homeInput.value()??'').trim();}
  async open(cx){
    const value=await this.gate.prefill();
    if(this.expired)return;
    if(value&&!this.homeText())this.homeInput.set_value(value);
    cx.notify();
  }
  runOperation(cx,run){
    // The operation can finish after the dialog closes. Its redraw belongs
    // to the dialog, so start that task while the event still owns the view.
    let finish;
    const completion=new Promise(resolve=>{finish=resolve;});
    cx.spawn(async task=>{
      await completion;
      if(!this.expired)task.notify();
    });
    return cx.spawn(async task=>{
      try{await run(task);}finally{finish();}
    },{owner:null});
  }
  check(cx){
    if(this.expired||this.busy||['done','uncertain'].includes(this.phase))return;
    const home=this.homeText(),generation=this.generation;
    this.busy=true;this.phase='checking';this.verified=null;this.error=null;cx.notify();
    return this.runOperation(cx,async task=>{
      try{
        const verified=await this.gate.check(home,this.host.requestFor?.(task)??this.host.setupFetch);
        if(this.expired||this.generation!==generation)return;
        this.verified=verified;this.phase='verified';
      }catch(error){if(!this.expired&&this.generation===generation){this.phase='edit';this.error=errorDiagnostic(error);this.pendingFocus='home';}}
      finally{if(!this.expired)this.busy=false;}
    });
  }
  save(cx){
    if(this.expired||this.busy||this.phase!=='verified')return;
    this.busy=true;this.phase='saving';this.error=null;cx.notify();
    return this.runOperation(cx,async task=>{
      let outcome;
      try{
        const saved=await this.gate.save(this.host.requestFor?.(task)??this.host.setupFetch);
        this.saved=saved;outcome={ok:true,saved};
        if(!this.expired){this.phase='done';try{await this.host.saved?.(saved);}catch(_){this.warning="The connection was saved, but Herdr couldn't refresh the sidebar. Refresh it to check.";}}
      }catch(error){
        outcome={ok:false,uncertain:error?.uncertain===true,error:errorDiagnostic(error)};
        if(!this.expired){this.phase=outcome.uncertain?'uncertain':'edit';this.verified=null;this.error=outcome.error;this.pendingFocus='home';}
      }finally{
        if(this.expired){if(outcome?.ok||outcome?.uncertain)this.host.closedOutcome?.(outcome);}
        else this.busy=false;
      }
    });
  }
  cycle(forward,cx){
    cx.stop_propagation();if(this.expired||this.busy)return;
    const input={focus:()=>this.homeInput.focus(),is_focused:()=>this.homeFocused===true};
    const detail=this.detailsShown?this.focusTargets?.get('add-local-error-detail-details'):null;
    const controls=this.phase==='done'?[this.primaryHandle]:this.phase==='uncertain'?[detail,this.cancelHandle]:[input,this.checkHandle,detail,this.cancelHandle,...(this.phase==='verified'?[this.primaryHandle]:[])];
    const handles=controls.filter(Boolean),at=handles.findIndex(h=>h.is_focused?.());if(!handles.length)return;
    const target=handles[at<0?(forward?0:handles.length-1):(at+(forward?1:-1)+handles.length)%handles.length];
    this.focusTask?.cancel?.();this.focusTask=cx.timer.after(16,next=>{if(this.expired)return;target.focus();next.notify();});
  }
  button(id,text,callback,{disabled=false,primary=false}={}){
    const activation=activationPair(this,id),handle=id==='add-local-check'?this.checkHandle:id==='add-local-cancel'?this.cancelHandle:this.primaryHandle;
    return div().id(`${id}-focus`).p(2).border(2).border_color('#00000000').rounded(7).role('button').tab_stop(!disabled)
      .when(!!handle&&!disabled,el=>el.track_focus(handle)).focus(el=>el.border_color(this.theme.accent))
      .on_mouse_down('left',activation.pointer())
      .on_key_down(activation.key((event,cx)=>{if(!disabled&&!event.is_held&&['enter',' ','space'].includes(event.key)){cx.stop_propagation();callback(cx);}}))
      .child(div().id(id).px(10).py(6).rounded(5).text_size(12).bg(primary?this.theme.accent:this.theme.raised)
        .text_color(primary?this.theme.solid_foreground:this.theme.foreground).when(disabled,el=>el.opacity(.45)).when(!disabled,el=>el.cursor_pointer())
        .on_mouse_down('left',activation.pointer()).on_click(activation.click((_e,cx)=>{if(!disabled)callback(cx);})).child(text));
  }
  render(t,cx){
    if(this.expired)return div().id('add-local-closed');
    this.theme=t;
    if(!this.expired&&!this.checkHandle&&!this.checkHandlePending){this.checkHandlePending=true;cx.timer.after(0,next=>{this.checkHandlePending=false;if(this.expired)return;this.checkHandle=next.focus_handle();next.notify();});}
    if(this.pendingFocus){this.pendingFocus=null;const generation=this.generation;this.focusTask?.cancel?.();this.focusTask=cx.timer.after(0,next=>{if(this.expired||generation!==this.generation||['saving','done','uncertain'].includes(this.phase))return;this.homeInput.focus();next.notify();});}
    const done=this.phase==='done',uncertain=this.phase==='uncertain',v=this.verified;
    const root=v_flex().id('add-local').size_full().p(14).gap(10).bg(t.surface).text_color(t.foreground).text_size(12)
      .key_context('RigDialog').on_action('rig-dialog-next',(_e,next)=>this.cycle(true,next)).on_action('rig-dialog-prev',(_e,next)=>this.cycle(false,next))
      .on_key_down((event,next)=>{if(event.key==='tab')this.cycle(!event.modifiers?.shift,next);else if(event.key==='escape'&&!this.busy){next.stop_propagation();this.expire();(done?this.done:this.cancel)?.(next,this.saved);}})
      .child(div().text_size(15).font_semibold().child('Add this computer'));
    let body=v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(8).child(div().text_color(t.muted).child('OpenRig home on this computer'));
    body.child(this.phase==='saving'||done||uncertain?div().font_family(this.mono).child(v?.home??this.homeText()):Input.new(this.homeInput).id('add-local-home'));
    body.child(div().text_color(t.muted).text_size(11).child('The folder OpenRig uses on this computer for its settings and sign-in. Usually .openrig in your home folder.'))
      .child(this.button('add-local-check','Check',next=>this.check(next),{disabled:this.busy||done||uncertain}));
    if(this.phase==='checking')body.child(div().id('add-local-checking').text_color(t.muted).child("Checking this computer's OpenRig…"));
    this.detailsShown=false;
    if(this.error){const message=/nothing was saved|couldn.t confirm|may have/i.test(this.error)?this.error:`${this.error} Nothing was saved.`,words=plainError(message,{where:'this computer'});this.detailsShown=words.detail!==words.text;body.child(div().id('add-local-error').text_color(t.blocked).child(errorBlock(this,t,'add-local-error-detail',message,{cx,where:'this computer'})));}
    if(v)body.child(v_flex().gap(3).id('add-local-ok').child(div().child(`✓ OpenRig answers at ${v.daemonUrl}`)).child(div().child(`✓ Host ${v.selfHostId} · not another connection's OpenRig`)))
      .child(div().font_semibold().child('This saves on this computer'))
      .child(v_flex().id('add-local-summary').gap(2).child(div().child('A connection "This computer" in openrig/config.json:'))
        .child(div().font_family(this.mono).text_size(11).child(`address ${v.daemonUrl} · home ${v.home} · host ${v.selfHostId}`))
        .child(div().text_color(t.muted).child('Nothing else changes: your other connections, spaces and tiles stay as they are.')));
    if(this.phase==='saving')body.child(div().id('add-local-progress').text_color(t.muted).child('Saving…'));
    if(done)body.child(div().id('add-local-done').child('✓ Added this computer. Its rigs show in the sidebar again.'));
    if(this.warning)body.child(div().id('add-local-warning').text_color(t.working).child(this.warning));
    const footer=h_flex().gap(8).justify_end().flex_none();
    if(done)footer.child(this.button('add-local-done-button','Done',next=>{this.expire();this.done?.(next,this.saved);},{primary:true}));
    else if(!this.busy){footer.child(this.button('add-local-cancel',uncertain?'Close':'Cancel',next=>{this.expire();this.cancel?.(next);}));if(!uncertain)footer.child(this.button('add-local-save','Add this computer',next=>this.save(next),{disabled:this.phase!=='verified',primary:true}));}
    return root.child(body).child(footer);
  }
}
