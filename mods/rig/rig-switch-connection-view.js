import {div} from "gpui-kit";
import {v_flex,h_flex} from "gpui-base";
import {switchConnection,switchBack,HERDR_CONNECTION_OFFERED,SWITCH_NOT_OFFERED} from "./rig-connections.js";

// "Use Herdr's connection for <machine>?" and "Switch <machine> back to the tunnel?" (one click each, never automatic). Cancel is focused first;
// Tab wraps; Esc cancels. The switch asks this machine's own approval for the helper (its words say what it allows), installs it, and checks that
// the helper and the tunnel reach the SAME OpenRig (one host id) before it writes anything. The tunnel address is kept for switching back.
export class SwitchConnectionPanel {
  /** `host`: readConfig/writeConfig (compare-and-swap), health(url). `makeRemote()`: this connection's RemoteOpenRig. `direction`: "herdr" | "back". */
  constructor(host,connection,{direction="herdr",offered=HERDR_CONNECTION_OFFERED,makeRemote,done,cancel,cancelHandle,primaryHandle}={}){
    Object.assign(this,{host,connection,direction,offered,makeRemote,done,cancel,cancelHandle,primaryHandle});
    this.phase="ready";this.error=null;this.confirmation=null;
    this.name=connection?.machine??"this connection";
  }
  expire(){}
  config(){return{...this.connection,daemonMachine:this.connection.machine,expectedHostId:this.connection.expectedHostId??null};}
  act(cx){
    if(this.busy)return;
    this.busy=true;this.error=null;cx.notify();
    cx.spawn(async cx=>{
      try{
        if(this.direction==="back"){
          await switchBack(this.host,await this.host.readConfig()??null,this.connection.id);
          this.phase="done";this.done?.(cx,this.connection);return;
        }
        // Not offered: refused before any helper is prepared, installed or asked for.
        if(!this.offered)throw new Error(SWITCH_NOT_OFFERED);
        const remote=this.makeRemote(),consent=this.confirmation?{key:this.confirmation.key}:null;
        const p=await remote.prepare(this.config(),consent);
        if(!p.ok){this.confirmation=p.confirmation;this.phase="consent";return;} // the approval comes first; nothing was installed yet
        // The same OpenRig on both roads, or nothing changes: the tunnel's own /healthz must name the host id the helper reached.
        const tunnel=await this.host.health(this.connection.daemonUrl);
        if(!tunnel?.selfHostId||tunnel.selfHostId!==p.hostId)
          throw new Error(`The tunnel and Herdr's connection reach different OpenRigs on ${this.name} (host ${String(tunnel?.selfHostId??"unknown").slice(0,4)}… and ${String(p.hostId).slice(0,4)}…), so the connection wasn't switched. The helper stays installed and approved on ${this.name}, unused.`);
        await switchConnection(this.host,await this.host.readConfig()??null,this.connection.id,`herdr://${this.connection.machine}/${p.hostId}`,this.connection.daemonUrl,{offered:this.offered});
        this.phase="done";this.done?.(cx,this.connection);
      }catch(error){this.error=error?.code==="CONFIG_CHANGED"?`${error.message} Reopen it and try again.`:String(error?.message??error);}
      finally{this.busy=false;cx.notify();}
    });
  }
  button(id,text,callback,{primary=false}={}){
    const handle=id.endsWith("-cancel")?this.cancelHandle:this.primaryHandle;
    return div().id(`${id}-focus`).p(2).border(2).border_color("#00000000").rounded(7).role("button").tab_stop(true)
      .when(!!handle,el=>el.track_focus(handle)).focus(el=>el.border_color(this.theme.accent))
      .on_key_down((event,cx)=>{if(["enter"," ","space"].includes(String(event.key??"").toLowerCase())){cx.stop_propagation();callback(cx);}})
      .child(div().id(id).px(10).py(6).rounded(5).text_size(12).bg(primary?this.theme.accent:this.theme.raised).text_color(primary?this.theme.solid_foreground:this.theme.foreground)
        .cursor_pointer().on_click((_e,cx)=>callback(cx)).child(text));
  }
  words(){
    if(this.direction==="back")return{title:`Switch ${this.name} back to the tunnel?`,body:`herdrig will reach ${this.name}'s OpenRig through its tunnel again. The helper stays on ${this.name}, unused; nothing there changes.`,address:this.connection.retainedDaemonUrl,go:"Switch back"};
    if(this.phase==="consent")return{title:`Approve the helper on ${this.name}`,body:this.confirmation?.words??"",go:"Approve and switch"};
    return{title:`Use Herdr's connection for ${this.name}?`,
      address:this.connection.daemonUrl,body:`herdrig will reach ${this.name}'s OpenRig through Herdr's own connection instead of its tunnel, which is kept so you can switch back in one click. It installs a small helper on ${this.name} after you approve it. Commands run there as you: on a machine shared with other users, they could briefly see a message being sent (its text, or a queue row's summary line, never the body).`,
      go:"Continue"};
  }
  render(t,cx){
    this.theme=t;
    const cycle=(forward,cx)=>{
      cx.stop_propagation();if(this.busy)return;
      const first=this.cancelHandle,last=this.primaryHandle;
      const boundary=forward&&last?.is_focused?.()?first:!forward&&first?.is_focused?.()?last:null;
      if(boundary){this.focusTask?.cancel?.();this.focusTask=cx.timer.after(16,nextCx=>{boundary.focus();nextCx.notify();});}
      else if(forward)globalThis.window.focus_next();else globalThis.window.focus_prev();
    };
    const w=this.words();
    const root=v_flex().id("switch-connection").size_full().p(14).gap(10).bg(t.surface).text_color(t.foreground).text_size(12)
      .key_context("RigDialog").on_action("rig-dialog-next",(_e,cx)=>cycle(true,cx)).on_action("rig-dialog-prev",(_e,cx)=>cycle(false,cx))
      .on_key_down((event,cx)=>{
        if(event.key==="tab"&&!event.modifiers?.control&&!event.modifiers?.platform&&!event.modifiers?.alt)cycle(!event.modifiers?.shift,cx);
        else if(event.key==="escape"&&!this.busy){cx.stop_propagation();this.cancel?.(cx);}})
      .child(div().id("switch-connection-title").text_size(15).font_semibold().child(w.title))
      .child(div().id("switch-connection-body").child(w.body))
      // The tunnel's address on a line of its own: inside the sentence it wrapped at a slash ("http:/ /127…").
      .when(!!w.address,el=>el.child(h_flex().gap(8).child(div().text_color(t.muted).child("Tunnel"))
        .child(div().id("switch-connection-address").min_w(0).truncate().whitespace_nowrap().font_family("monospace").text_size(11).tooltip(String(w.address)).child(String(w.address)))));
    if(this.error)root.child(div().id("switch-connection-error").text_color(t.blocked).child(`✗ ${this.error}`));
    if(this.busy)root.child(div().id("switch-connection-progress").text_color(t.muted).child(this.direction==="back"?"Switching back…":"Checking the machine and the helper…"));
    const footer=h_flex().gap(8).justify_end().flex_none();
    if(!this.busy){
      footer.child(this.button("switch-connection-cancel","Cancel",cx=>this.cancel?.(cx)));
      footer.child(this.button("switch-connection-go",w.go,cx=>this.act(cx),{primary:true}));
    }
    return root.child(v_flex().flex_1()).child(footer);
  }
}
