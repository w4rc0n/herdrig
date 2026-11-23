import { errorDiagnostic,plainError } from "./rig-words.js";
import {activationPair} from './rig-activation.js';
import {div} from "gpui-kit";
import {errorBlock} from "./rig-error-view.js";
import {withFocusContext,releaseFocusTargets} from './rig-lib.js';
import {v_flex,h_flex} from "gpui-base";
import {removeConnection} from "./rig-connections.js";

// "Remove <machine>?". Cancel is focused first; Tab wraps; Esc cancels. It removes only the connection's entry from config.json
// (a compare-and-swap write); it never touches a tunnel, a space, a tile or the machine, and says so.
export class RemoveConnectionPanel {
  constructor(host,connection,{done,cancel,cancelHandle,primaryHandle}={}){
    this.host=host;this.connection=connection;this.done=done;this.cancel=cancel;this.cancelHandle=cancelHandle;this.primaryHandle=primaryHandle;
    this.phase="ready";this.error=null;
    this.name=connection?.machine??"this connection";
  }
  expire(){this.expired=true;releaseFocusTargets(this);}
  remove(cx){
    if(this.busy||this.phase!=="ready")return;
    this.busy=true;this.phase="working";this.error=null;cx.notify();
    cx.spawn(async cx=>{
      try{
        const before=await this.host.readConfig()??null;
        await removeConnection(this.host,before,this.connection.id);
        this.phase="done";
        try{await this.host.saved?.(this.connection);}catch(_){this.warning="Herdr couldn't update its own saved state for this removal.";}
        this.done?.(cx,this.connection);
      }catch(error){this.phase="ready";this.error=error?.code==="CONFIG_CHANGED"?`${error.message} Reopen it and try again.`:errorDiagnostic(error);}
      finally{this.busy=false;cx.notify();}
    });
  }
  button(id,text,callback,{primary=false,disabled=false}={}){
    const activation=activationPair(this,id);
    const handle=id==="remove-connection-cancel"?this.cancelHandle:this.primaryHandle;
    return div().id(`${id}-focus`).p(2).border(2).border_color("#00000000").rounded(7).role("button").tab_stop(!disabled)
      .when(!disabled&&!!handle,el=>el.track_focus(handle)).focus(el=>el.border_color(this.theme.accent))
      .on_mouse_down('left',activation.pointer()).on_key_down(activation.key((event,cx)=>{if(!disabled&&["enter"," ","space"].includes(String(event.key??"").toLowerCase())){cx.stop_propagation();callback(cx);}}))
      .child(div().id(id).px(10).py(6).rounded(5).text_size(12).bg(primary?this.theme.accent:this.theme.raised).text_color(primary?this.theme.solid_foreground:this.theme.foreground)
        .when(disabled,el=>el.opacity(.45)).when(!disabled,el=>el.cursor_pointer()).on_mouse_down('left',activation.pointer()).on_click(activation.click((_e,cx)=>{if(!disabled)callback(cx);})).child(text));
  }
  render(...args){return withFocusContext(this,args[1],()=>this.renderFocused(...args));}
  renderFocused(t,cx){
    this.theme=t;
    const error=this.error?plainError(this.error,{where:"this computer"}):null;
    const cycle=(forward,cx)=>{
      cx.stop_propagation();if(this.busy)return;
      const detail=error&&error.detail!==error.text&&this.focusTargets?.get('remove-connection-error-detail-details');
      const handles=[detail,this.cancelHandle,this.primaryHandle].filter(Boolean);
      if(!handles.length)return;
      const at=handles.findIndex(handle=>handle.is_focused?.());
      const target=handles[at<0?(forward?0:handles.length-1):(at+(forward?1:-1)+handles.length)%handles.length];
      this.focusTask?.cancel?.();
      this.focusTask=cx.timer.after(16,nextCx=>{if(this.expired)return;target.focus();nextCx.notify();});
    };
    const root=v_flex().id("remove-connection").size_full().p(14).gap(10).bg(t.surface).text_color(t.foreground).text_size(12)
      .key_context("RigDialog").on_action("rig-dialog-next",(_e,cx)=>cycle(true,cx)).on_action("rig-dialog-prev",(_e,cx)=>cycle(false,cx))
      .on_key_down((event,cx)=>{
        if(event.key==="tab"&&!event.modifiers?.control&&!event.modifiers?.platform&&!event.modifiers?.alt)cycle(!event.modifiers?.shift,cx);
        else if(event.key==="escape"&&!this.busy){cx.stop_propagation();this.cancel?.(cx);}})
      .child(div().text_size(15).font_semibold().child(`Remove ${this.name}?`))
      .child(div().id("remove-connection-body").child(`Its rigs and needs leave the sidebar. Its spaces and tiles stay as they are, and nothing on ${this.name} changes.${this.connection&&!this.connection.machine?' You can add it back from Add a machine.':''}`));
    if(this.error)root.child(div().id("remove-connection-error").text_color(t.blocked).child(errorBlock(this,t,"remove-connection-error-detail",this.error,{where:"this computer"})));
    if(this.warning)root.child(div().id("remove-connection-warning").text_color(t.working).child(this.warning));
    if(this.busy)root.child(div().id("remove-connection-progress").text_color(t.muted).child("Removing…"));
    const footer=h_flex().gap(8).justify_end().flex_none();
    if(!this.busy){
      footer.child(this.button("remove-connection-cancel","Cancel",cx=>this.cancel?.(cx)));
      footer.child(this.button("remove-connection-remove","Remove",cx=>this.remove(cx),{primary:true}));
    }
    return root.child(v_flex().flex_1()).child(footer);
  }
}
