import {div} from "gpui-kit";
import {v_flex,h_flex} from "gpui-base";
import {consentOf} from "./rig-connections.js";

// System > Connections: one block per connection and "Add a machine…". Drawn only with two or more connections: with one, System looks as it always did.
const shortHost=id=>id?`${String(id).slice(0,4)}…`:"—";
const STATE_WORD={connected:"Connected",down:"Not answering",checking:"Checking…"};
/** `states[id]` is `{status: "checking"|"connected"|"down", hostId}` from one read of that connection's /healthz; `consentText` is machine-consent.json. */
/** `selected` is the highlighted block (Up and Down move it, clamped, and move the keyboard to that block's Remove… when `handles[i]` exists); `onSelect(i, cx)` stores it. */
export function connectionBlocks(t,{connections,states={},consentText=null,mono="monospace",onRemove,onAdd,selected=null,onSelect,handles=[]}={}){
  const row=(id,label,value,{font=false,tip}={})=>h_flex().gap(8).items_start()
    .child(div().w(64).flex_none().text_color(t.muted).child(label))
    .child(div().id(id).flex_1().min_w(0).when(font,el=>el.font_family(mono).text_size(11)).when(!!tip,el=>el.tooltip(tip)).child(value));
  const key=(event,cx,act)=>{if(["enter"," ","space"].includes(String(event.key??"").toLowerCase())){cx.stop_propagation();act(cx);}};
  const blocks=connections.map((c,index)=>{
    const state=states[c.id]??{status:"checking"},word=STATE_WORD[state.status]??STATE_WORD.checking,hostId=state.hostId??c.expectedHostId??null;
    const helper=c.machine?(consentOf(consentText,c.id)?"Approved":"Needs approval"):null;
    return v_flex().id(`connection-block-${c.id}`).gap(3).p(8).rounded(6).bg(t.raised).border_1().border_color(index===selected?t.accent:"#00000000")
      .on_click((_e,cx)=>onSelect?.(index,cx))
      .child(h_flex().gap(8).items_center()
        .child(div().id(`connection-name-${c.id}`).min_w(0).truncate().font_semibold().tooltip(c.machine??"This computer").child(c.machine??"This computer"))
        .child(div().id(`connection-state-${c.id}`).text_color(state.status==="down"?t.blocked:state.status==="connected"?t.working:t.muted).child(word)))
      .child(row(`connection-address-${c.id}`,"Address",c.daemonUrl??"—",{font:true}))
      .child(row(`connection-host-${c.id}`,"Host",shortHost(hostId),{tip:hostId?`Host ${hostId}`:undefined}))
      .when(!!helper,el=>el.child(row(`connection-helper-${c.id}`,"Helper",helper)))
      .child(row(`connection-home-${c.id}`,"Home",c.openrigHome??"Not set",{font:true}))
      .child(div().id(`connection-remove-${c.id}`).role("button").tab_stop(true).px(6).py(3).text_size(12).text_color(t.accent).cursor_pointer()
        .when(!!handles[index],el=>el.track_focus(handles[index]))
        .focus(el=>el.border_1().border_color(t.accent))
        .on_click((_e,cx)=>onRemove?.(c,cx)).on_key_down((e,cx)=>key(e,cx,cx2=>onRemove?.(c,cx2))).child("Remove…"));
  });
  const add=div().id("connection-add-machine").role("button").tab_stop(true).px(6).py(3).text_size(12).text_color(t.accent).cursor_pointer()
    .focus(el=>el.border_1().border_color(t.accent))
    .on_click((_e,cx)=>onAdd?.(cx)).on_key_down((e,cx)=>key(e,cx,cx2=>onAdd?.(cx2))).child("Add a machine…");
  // Up and Down move between blocks, like the other System rows; Enter on a block opens nothing (Remove… and Add a machine… are the controls).
  const move=(event,cx)=>{
    if(event.key!=="up"&&event.key!=="down")return;
    cx.stop_propagation();
    const from=Number.isInteger(selected)?selected:-1,next=Math.max(0,Math.min(connections.length-1,from+(event.key==="down"?1:-1)));
    onSelect?.(next,cx);handles[next]?.focus?.();
  };
  return v_flex().id("connection-blocks").gap(8).on_key_down(move).children(blocks).child(add);
}
