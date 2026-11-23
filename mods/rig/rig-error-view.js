import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { plainError } from "./rig-words.js";
import {focusTarget} from './rig-lib.js';

/** Keep diagnostics intact until the display boundary. The raw value is available only on deliberate expansion. */
export function errorBlock(owner, t, id, error, options = {}) {
  const result = plainError(error, options);
  const open = owner.errorDetails?.[id] === result.detail;
  const details=result.detail!==result.text?focusTarget(owner,options.cx??owner.focusRenderCx,`${id}-details`,
    div().id(`${id}-details`).tooltip(open ? "Hide the original error message." : "Show the original error message from OpenRig or Herdr.").text_size(11.5).text_color(t.muted).cursor_pointer(),
    cx=>{owner.errorDetails??={};if(Object.keys(owner.errorDetails).length>=64)delete owner.errorDetails[Object.keys(owner.errorDetails)[0]];owner.errorDetails[id]=owner.errorDetails[id]===result.detail?null:result.detail;cx.notify();},
    el=>el.border_1().border_color(t.accent)):null;
  if (owner.errorLog?.[id] !== result.detail) {
    owner.errorLog ??= {};
    if (Object.keys(owner.errorLog).length >= 64) delete owner.errorLog[Object.keys(owner.errorLog)[0]];
    owner.errorLog[id] = result.detail;
    console.error(result.detail);
  }
  return v_flex().gap(4)
    .child(div().text_size(12).text_color(options.tone ?? t.blocked).child(`${options.prefix ?? ""}${result.text}${options.suffix ?? ""}`))
    .when(result.detail !== result.text, el => el.child(details.child(open ? "Hide details" : "Details")))
    .when(open, el => el.child(div().id(`${id}-detail-text`).text_size(11.5).text_color(t.dim).child(result.detail)));
}

/** Toasts have no expansion area; preserve the original in the log before sending the plain message. */
export function errorNotice(notify, notice) {
  const { where = "OpenRig's machine", what = null, ...value } = notice;
  if (["error", "warning", "warn"].includes(value.level) && value.body) {
    const result = plainError(value.body, { where, what, toast: true });
    console.error(result.detail);
    return notify({ ...value, body: result.text });
  }
  return notify(value);
}
