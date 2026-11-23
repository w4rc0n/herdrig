import {div} from "gpui-kit";
import {v_flex,h_flex} from "gpui-base";
import {consentOf,CODE_ERROR_NEXT,formatHostId,HERDR_CONNECTION_OFFERED} from "./rig-connections.js";
import {machineSetupReceiptLabel} from "./rig-machine-setup.js";
import {activationPair} from './rig-activation.js';
import {OPENRIG_HELPER_SHA256} from './rig-openrig-pin.js';

// System > Connections: one block per connection and "Add a machine…". Drawn only with two or more connections: with one, System looks as it always did.
const STATE_WORD={connected:"Connected",down:"Not answering",error:"Check failed",checking:"Checking…"};
/** An approvals file that exists but couldn't be read (a missing file is `null`): its rows say "Couldn't check", never "Needs approval". */
export const CONSENT_UNREADABLE=Object.freeze({unreadable:true});
const unreadable=text=>text===CONSENT_UNREADABLE||text?.unreadable===true;
/** "Open seats" (machine-consent.json: opening seat tiles on that machine). Nothing waits on it: the dialog comes up by itself on the first open. */
function seatsRow(text,c,verified){
  if(unreadable(text))return {value:"Couldn't check",muted:true,tip:"Herdrig couldn't read its approvals file. Opening a seat there will ask again. Nothing was changed."};
  if(verified)return {value:"Allowed",muted:false};
  return consentOf(text,c.id)?{value:"Asks again next time",muted:true}:{value:"Asks the first time",muted:true};
}
/** "OpenRig helper" (openrig-consent.json: the helper that reads OpenRig over Herdr's connection), for a herdr:// connection only. */
function helperRow(text,c,needsApproval){
  if(unreadable(text))return {value:"Couldn't check",tone:"muted"};
  let sha=null;const record=consentOf(text,c.id);
  try{sha=record?.key?JSON.parse(record.key)?.sha256??null:null;}catch{sha=null;}
  if(record&&sha&&sha!==OPENRIG_HELPER_SHA256)return {value:"Needs approval again (updated)",tone:"warning",ask:true,
    tip:`This version of Herdrig ships a new helper. Check it and approve it to keep reading ${c.machine??"the machine"}'s OpenRig. Nothing runs until you approve.`};
  if(!record||needsApproval)return {value:"Needs approval",tone:"warning",ask:true};
  return {value:"Approved",tone:"text"};
}
/** `states[id]` is `{status: "checking"|"connected"|"down"|"error", hostId, message, needsApproval}` (error: herdrig's own error while reading it) from one read of that connection's /healthz;
 *  `needsApproval`: the sidebar's read said this herdr:// connection waits for its helper approval (OpenRig answered "not until you approve": not an outage).
 *  `consentText` is machine-consent.json and `openrigConsentText` openrig-consent.json: text, `null` when missing, or CONSENT_UNREADABLE. */
/** `selected` is the highlighted block (Up and Down move it, clamped, and move the keyboard to that block's Remove… when `handles[i]` exists); `onSelect(i, cx)` stores it. */
/** A tunnel connection on a Herdr machine offers "Use Herdr's connection instead…" (`onSwitch`) only while `herdrOffered` (HERDR_CONNECTION_OFFERED);
 *  a switched one always offers "Switch back to the tunnel…" (`onSwitchBack`). */
export function connectionBlocks(t,{connections,activationOwner=connections,states={},consentText=null,openrigConsentText=null,mono="monospace",timezone,onRemove,onAdd,onSwitch,onSwitchBack,onApprove,herdrOffered=HERDR_CONNECTION_OFFERED,selected=null,onSelect,handles=[],actionHandles={}}={}){
  const activation=id=>activationPair(activationOwner,id);
  const row=(id,label,value,{font=false,tip,color}={})=>h_flex().gap(8).items_center()
    .child(div().w(120).flex_none().whitespace_nowrap().truncate().text_color(t.muted).child(label))
    .child(div().id(id).flex_1().min_w(0).truncate().when(font,el=>el.font_family(mono).text_size(11)).when(!!color,el=>el.text_color(color)).when(!!tip,el=>el.tooltip(tip)).child(value));
  const warning=t.ansi3;
  const key=(event,cx,act)=>{if(["enter"," ","space"].includes(String(event.key??"").toLowerCase())){cx.stop_propagation();act(cx);}};
  const blocks=connections.map((c,index)=>{
    const state=states[c.id]??{status:"checking"},waiting=state.needsApproval===true,hostId=state.hostId??c.expectedHostId??null;
    const word=waiting?"Waiting for approval":STATE_WORD[state.status]??STATE_WORD.checking;
    const herdr=String(c.daemonUrl??"").startsWith("herdr://");
    const receipt=unreadable(consentText)?null:consentOf(consentText,c.id),verified=receipt?.machine===c.machine&&(receipt?.origin===c.daemonUrl||(!!c.retainedDaemonUrl&&receipt?.origin===c.retainedDaemonUrl))&&receipt?.verifiedAt; // a switched connection's helper receipt was made on its kept tunnel
    const seats=c.machine?seatsRow(consentText,c,!!verified):null,helper=c.machine&&herdr?helperRow(openrigConsentText,c,waiting):null;
    return v_flex().id(`connection-block-${c.id}`).gap(3).p(8).rounded(6).bg(t.raised).border_1().border_color(index===selected?t.accent:"#00000000")
      .on_click((_e,cx)=>onSelect?.(index,cx))
      .child(h_flex().gap(8).items_center()
        .child(div().id(`connection-name-${c.id}`).min_w(0).truncate().font_semibold().tooltip(c.machine??"This computer").child(c.machine??"This computer"))
        .child(div().id(`connection-state-${c.id}`).when(state.status==="error"&&!!state.message,el=>el.tooltip(`herdrig hit an error while checking this connection (${state.message}). It isn't a connection problem. ${CODE_ERROR_NEXT}`)).text_color(waiting?warning:state.status==="down"||state.status==="error"?t.blocked:state.status==="connected"?t.working:t.muted).child(word)))
      .child(row(`connection-address-${c.id}`,"Address",c.daemonUrl??"—",{font:true,tip:c.daemonUrl??undefined}))
      .child(row(`connection-host-${c.id}`,"Host",formatHostId(hostId),{font:Boolean(hostId),tip:hostId?`Host ${hostId}`:undefined}))
      .when(!!seats,el=>el.child(row(`connection-seats-${c.id}`,"Open seats",seats.value,{tip:seats.tip,color:seats.muted?t.muted:undefined})))
      .when(!!helper,el=>el.child(row(`connection-openrig-helper-${c.id}`,"OpenRig helper",helper.value,{tip:helper.tip,color:helper.tone==="warning"?warning:helper.tone==="muted"?t.muted:undefined})))
      .when(!!verified,el=>el.child(div().id(`connection-receipt-${c.id}`).text_color(t.muted).text_size(11).child(machineSetupReceiptLabel(receipt,timezone))))
      .child(row(`connection-home-${c.id}`,"Home",c.openrigHome??"Not set",{font:true,tip:c.openrigHome??undefined}))
      .when(herdrOffered&&!!onSwitch&&!!c.machine&&/^https?:\/\//.test(c.daemonUrl??""),el=>el.child(div().id(`connection-switch-${c.id}`).tooltip("Reach this OpenRig over Herdr's connection instead of the tunnel: asks first").role("button").tab_stop(true).px(6).py(3).text_size(12).text_color(t.accent).cursor_pointer()
        .when(!!actionHandles[`connection-switch-${c.id}`],el=>el.track_focus(actionHandles[`connection-switch-${c.id}`]))
        .focus(el=>el.border_1().border_color(t.accent)).on_mouse_down('left',activation(`switch-${c.id}`).pointer())
        .on_click(activation(`switch-${c.id}`).click((_e,cx)=>onSwitch(c,cx))).on_key_down(activation(`switch-${c.id}`).key((e,cx)=>key(e,cx,cx2=>onSwitch(c,cx2)))).child("Use Herdr's connection instead…")))
      // A herdr:// connection whose helper approval is missing or stale (the sidebar's read said so): the review, then that connection's approval.
      .when(herdrOffered&&!!onApprove&&herdr&&waiting,el=>el.child(div().id(`connection-approve-${c.id}`).tooltip(`Check the helper Herdrig uses on ${c.machine ?? "the machine"}, then approve it. Nothing is approved until you choose Approve.`).role("button").tab_stop(true).px(6).py(3).text_size(12).text_color(t.accent).cursor_pointer()
        .when(!!actionHandles[`connection-approve-${c.id}`],el=>el.track_focus(actionHandles[`connection-approve-${c.id}`]))
        .focus(el=>el.border_1().border_color(t.accent)).on_mouse_down('left',activation(`approve-${c.id}`).pointer())
        .on_click(activation(`approve-${c.id}`).click((_e,cx)=>onApprove(c,cx))).on_key_down(activation(`approve-${c.id}`).key((e,cx)=>key(e,cx,cx2=>onApprove(c,cx2)))).child("Approve helper…")))
      .when(!!onSwitchBack&&String(c.daemonUrl??"").startsWith("herdr://")&&!!c.retainedDaemonUrl,el=>el.child(div().id(`connection-switch-back-${c.id}`).tooltip("Go back to reaching this OpenRig through its tunnel: asks first").role("button").tab_stop(true).px(6).py(3).text_size(12).text_color(t.accent).cursor_pointer()
        .when(!!actionHandles[`connection-switch-back-${c.id}`],el=>el.track_focus(actionHandles[`connection-switch-back-${c.id}`]))
        .focus(el=>el.border_1().border_color(t.accent)).on_mouse_down('left',activation(`switch-back-${c.id}`).pointer())
        .on_click(activation(`switch-back-${c.id}`).click((_e,cx)=>onSwitchBack(c,cx))).on_key_down(activation(`switch-back-${c.id}`).key((e,cx)=>key(e,cx,cx2=>onSwitchBack(c,cx2)))).child("Switch back to the tunnel…")))
      .child(div().id(`connection-remove-${c.id}`).tooltip(c.machine ? `Remove ${c.machine}'s connection: asks first; nothing on ${c.machine} changes` : "Remove this computer's connection: asks first; OpenRig on this computer isn't changed").role("button").tab_stop(true).px(6).py(3).text_size(12).text_color(t.accent).cursor_pointer()
        .when(!!handles[index],el=>el.track_focus(handles[index]))
        .focus(el=>el.border_1().border_color(t.accent))
        .on_mouse_down('left',activation(`remove-${c.id}`).pointer())
        .on_click(activation(`remove-${c.id}`).click((_e,cx)=>onRemove?.(c,cx))).on_key_down(activation(`remove-${c.id}`).key((e,cx)=>key(e,cx,cx2=>onRemove?.(c,cx2)))).child("Remove…"));
  });
  // Its focus handle is the one after the connections' own: without one, Tab could not reach it and its keys never arrived.
  const addHandle=handles[connections.length];
  const add=div().id("connection-add-machine").tooltip("Add another Herdr machine's OpenRig").role("button").tab_stop(true).px(6).py(3).text_size(12).text_color(t.accent).cursor_pointer()
    .when(!!addHandle,el=>el.track_focus(addHandle))
    .focus(el=>el.border_1().border_color(t.accent))
    .on_mouse_down('left',activation('add-machine').pointer())
    .on_click(activation('add-machine').click((_e,cx)=>onAdd?.(cx))).on_key_down(activation('add-machine').key((e,cx)=>key(e,cx,cx2=>onAdd?.(cx2)))).child("Add a machine…");
  // Up and Down move between blocks, like the other System rows; Enter on a block opens nothing (Remove… and Add a machine… are the controls).
  const move=(event,cx)=>{
    if(event.key!=="up"&&event.key!=="down")return;
    cx.stop_propagation();
    const from=Number.isInteger(selected)?selected:-1,next=Math.max(0,Math.min(connections.length-1,from+(event.key==="down"?1:-1)));
    onSelect?.(next,cx);handles[next]?.focus?.();
  };
  return v_flex().id("connection-blocks").gap(8).on_key_down(move).children(blocks).child(add);
}
