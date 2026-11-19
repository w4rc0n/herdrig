import {div} from "gpui-kit";
import {v_flex,h_flex} from "gpui-base";
import {consentOf,CODE_ERROR_NEXT,formatHostId,HERDR_CONNECTION_OFFERED} from "./rig-connections.js";
import {machineSetupReceiptLabel} from "./rig-machine-setup.js";

// System > Connections: one block per connection and "Add a machine…". Drawn only with two or more connections: with one, System looks as it always did.
const STATE_WORD={connected:"Connected",down:"Not answering",error:"Check failed",checking:"Checking…"};
/** `states[id]` is `{status: "checking"|"connected"|"down"|"error", hostId, message}` (error: herdrig's own error while reading it) from one read of that connection's /healthz; `consentText` is machine-consent.json. */
/** `selected` is the highlighted block (Up and Down move it, clamped, and move the keyboard to that block's Remove… when `handles[i]` exists); `onSelect(i, cx)` stores it. */
/** A tunnel connection on a Herdr machine offers "Use Herdr's connection instead…" (`onSwitch`) only while `herdrOffered` (HERDR_CONNECTION_OFFERED);
 *  a switched one always offers "Switch back to the tunnel…" (`onSwitchBack`). */
export function connectionBlocks(t,{connections,states={},consentText=null,mono="monospace",timezone,onRemove,onAdd,onSwitch,onSwitchBack,herdrOffered=HERDR_CONNECTION_OFFERED,selected=null,onSelect,handles=[]}={}){
  const row=(id,label,value,{font=false,tip}={})=>h_flex().gap(8).items_center()
    .child(div().w(68).flex_none().whitespace_nowrap().text_color(t.muted).child(label))
    .child(div().id(id).flex_1().min_w(0).truncate().when(font,el=>el.font_family(mono).text_size(11)).when(!!tip,el=>el.tooltip(tip)).child(value));
  const key=(event,cx,act)=>{if(["enter"," ","space"].includes(String(event.key??"").toLowerCase())){cx.stop_propagation();act(cx);}};
  const blocks=connections.map((c,index)=>{
    const state=states[c.id]??{status:"checking"},word=STATE_WORD[state.status]??STATE_WORD.checking,hostId=state.hostId??c.expectedHostId??null;
    const helper=c.machine?(consentOf(consentText,c.id)?"Approved":"Needs approval"):null;
    const receipt=consentOf(consentText,c.id),verified=receipt?.machine===c.machine&&(receipt?.origin===c.daemonUrl||(!!c.retainedDaemonUrl&&receipt?.origin===c.retainedDaemonUrl))&&receipt?.verifiedAt; // a switched connection's helper receipt was made on its kept tunnel
    return v_flex().id(`connection-block-${c.id}`).gap(3).p(8).rounded(6).bg(t.raised).border_1().border_color(index===selected?t.accent:"#00000000")
      .on_click((_e,cx)=>onSelect?.(index,cx))
      .child(h_flex().gap(8).items_center()
        .child(div().id(`connection-name-${c.id}`).min_w(0).truncate().font_semibold().tooltip(c.machine??"This computer").child(c.machine??"This computer"))
        .child(div().id(`connection-state-${c.id}`).when(state.status==="error"&&!!state.message,el=>el.tooltip(`herdrig hit an error while checking this connection (${state.message}). It isn't a connection problem. ${CODE_ERROR_NEXT}`)).text_color(state.status==="down"||state.status==="error"?t.blocked:state.status==="connected"?t.working:t.muted).child(word)))
      .child(row(`connection-address-${c.id}`,"Address",c.daemonUrl??"—",{font:true,tip:c.daemonUrl??undefined}))
      .child(row(`connection-host-${c.id}`,"Host",formatHostId(hostId),{font:Boolean(hostId),tip:hostId?`Host ${hostId}`:undefined}))
      .when(!!helper,el=>el.child(row(`connection-helper-${c.id}`,"Helper",helper)))
      .when(!!verified,el=>el.child(div().id(`connection-receipt-${c.id}`).text_color(t.muted).text_size(11).child(machineSetupReceiptLabel(receipt,timezone))))
      .child(row(`connection-home-${c.id}`,"Home",c.openrigHome??"Not set",{font:true,tip:c.openrigHome??undefined}))
      .when(herdrOffered&&!!onSwitch&&!!c.machine&&/^https?:\/\//.test(c.daemonUrl??""),el=>el.child(div().id(`connection-switch-${c.id}`).role("button").tab_stop(true).px(6).py(3).text_size(12).text_color(t.accent).cursor_pointer()
        .focus(el=>el.border_1().border_color(t.accent)).on_click((_e,cx)=>onSwitch(c,cx)).on_key_down((e,cx)=>key(e,cx,cx2=>onSwitch(c,cx2))).child("Use Herdr's connection instead…")))
      .when(!!onSwitchBack&&String(c.daemonUrl??"").startsWith("herdr://")&&!!c.retainedDaemonUrl,el=>el.child(div().id(`connection-switch-back-${c.id}`).role("button").tab_stop(true).px(6).py(3).text_size(12).text_color(t.accent).cursor_pointer()
        .focus(el=>el.border_1().border_color(t.accent)).on_click((_e,cx)=>onSwitchBack(c,cx)).on_key_down((e,cx)=>key(e,cx,cx2=>onSwitchBack(c,cx2))).child("Switch back to the tunnel…")))
      .child(div().id(`connection-remove-${c.id}`).role("button").tab_stop(true).px(6).py(3).text_size(12).text_color(t.accent).cursor_pointer()
        .when(!!handles[index],el=>el.track_focus(handles[index]))
        .focus(el=>el.border_1().border_color(t.accent))
        .on_click((_e,cx)=>onRemove?.(c,cx)).on_key_down((e,cx)=>key(e,cx,cx2=>onRemove?.(c,cx2))).child("Remove…"));
  });
  // Its focus handle is the one after the connections' own: without one, Tab could not reach it and its keys never arrived.
  const addHandle=handles[connections.length];
  const add=div().id("connection-add-machine").role("button").tab_stop(true).px(6).py(3).text_size(12).text_color(t.accent).cursor_pointer()
    .when(!!addHandle,el=>el.track_focus(addHandle))
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
