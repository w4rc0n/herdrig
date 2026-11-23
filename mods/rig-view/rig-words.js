// Plain display words. Kept dependency-free so transport and presentation modules can use the same vocabulary.
export const counted = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export function errorDiagnostic(error) {
  return /^(?:TypeError|SyntaxError|RangeError|ReferenceError)$/.test(error?.name ?? "") ? String(error) : String(error?.message ?? error);
}
const STATUS_WORDS = {
  rig: { running: "running", stopped: "stopped", recoverable: "stopped (can be resumed)", degraded: "partly working", attention_required: "needs attention", partially_restored: "partly restored", left_attached: "left attached", unknown: "not reported" },
  daemon: { stopped: "it's stopped", stale: "it stopped answering", unhealthy: "it reports a problem", unreachable: "it can't be reached", unknown: "not reported" },
  startup: { bootstrap_failed: "failed to start", spec_missing: "its spec is missing", degraded: "partly working", failed: "failed", stopped: "stopped" },
  seat: { pending: "waiting", needs_input: "needs you", attention_required: "needs you", active: "working", unknown: "not reported" },
  severity: { warning: "Warning", critical: "Critical" },
  health: { active: "open", indeterminate: "unclear", resolved: "resolved" },
  queue: { pending: "waiting", claimed: "picked up", "in-progress": "in progress", blocked: "blocked", "handed-off": "handed on", done: "done", canceled: "canceled" },
  policy: { auto_decline: "declines new asks", auto_decide: "decides routine work itself", hold: "holds new asks for you" },
  gateway: { needs_reauth: "needs signing in again", reconnect: "reconnect it" },
  workflow: { active: "in progress", closed: "closed", blocked: "blocked" },
  runtime: { "claude-code": "Claude Code", codex: "Codex", pi: "Pi" },
};
export function statusWord(token, kind) {
  const value = String(token ?? "unknown");
  return STATUS_WORDS[kind]?.[value] ?? value.replace(/[_-]+/g, " ");
}
export const requestFailed = (what, status) => `OpenRig couldn't send ${what} (error ${status}).`;
export function requestWhat(path) {
  const p = String(path ?? "").split("?")[0];
  if (p === "/api/rigs/summary") return "the rig list";
  if (p === "/api/health") return "health information";
  if (p === "/api/slices") return "the slice list";
  if (p.startsWith("/api/specs/library/")) return "that spec";
  if (p === "/api/queue/list") return "the queue list";
  if (p === "/api/scopes") return "the scopes list";
  return "that list";
}
function withoutPaths(text) {
  // Protect URLs, which are addresses the person can act on, before hiding absolute file paths.
  const urls = [];
  return text.replace(/\b(?:https?|herdr):\/\/[^\s<>"']+/g, value => `\u0001${urls.push(value) - 1}\u0002`)
    .replace(/(^|[\s("'=:\[])(\/api(?:\/[^\s<>"'`]*)?|\/[A-Za-z][A-Za-z0-9_-]*)(?=$|[\s.,;:!?)\]])/g,
      (_, before, value) => `${before}\u0001${urls.push(value) - 1}\u0002`)
    .replace(/(^|[\s("'=:\[])(?:[A-Za-z]:[\\/]|~\/|\/)[^\s<>"'`]*[^\s<>"'`.,;:!?)\]]/g, "$1a file")
    .replace(/\u0001(\d+)\u0002/g, (_, index) => urls[Number(index)]);
}
/** Human wording plus the original diagnostic. Callers keep detail in Details/Copy and their error log. */
export function plainError(error, { where = "OpenRig's machine", what = null, who = where === "OpenRig's machine" ? "OpenRig" : where === "this computer" ? "The rig command" : where, toast = false, readingReply = true, outcomeUnknown = false } = {}) {
  const exceptionName = /^(?:TypeError|SyntaxError|RangeError|ReferenceError)$/;
  const detail = typeof error === "string" ? error : exceptionName.test(error?.name ?? "") ? String(error) : String(error?.message ?? error?.error?.message ?? error?.error ?? error ?? "The operation failed without saying why.");
  // Certainty wins over nicer wording. Preserve the whole caution, including the producer's recovery advice.
  if (outcomeUnknown || /\bunconfirmed\b|\boutcome\s+is\s+unknown\b|\bnot\s+confirmed\b|\b(?:may|might)\s+(?:still\s+)?(?:not\s+)?have\b|\bdid(?:n't| not)\s+finish\s+in\s+time\b|\bpartly done\b|\bearlier part was recorded\b|\bwrite reached\b|\banswer couldn't be read\b/i.test(detail)) {
    return { text: withoutPaths(detail), detail };
  }
  // These producers already explain what failed and what still works. Replace only their diagnostic.
  if (toast && /^(?:Needs notifications|Live updates) stopped working\b/.test(detail)) {
    const diagnosticAt = detail.indexOf(": "), recoveryAt = detail.lastIndexOf(". The sidebar ");
    if (diagnosticAt > 0 && recoveryAt > diagnosticAt) {
      return {text:`${withoutPaths(detail.slice(0,diagnosticAt))}. The details are in the log${withoutPaths(detail.slice(recoveryAt))}`,detail};
    }
  }
  const http = detail.match(/^(?:GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s+→\s+(\d+)(?::\s*([\s\S]*))?$/);
  if (http) return {text:`${requestFailed(requestWhat(http[1]),http[2])}${http[3] ? ` OpenRig said: ${plainError(http[3],{where,what,who,toast,readingReply}).text}` : ""}`,detail};
  const framed = detail.match(/^([\s\S]*?)\(([\s\S]*)\)([\s\S]*)$/);
  if (framed && /may (?:still )?have|write reached|answer couldn't be read|nothing (?:more )?was (?:sent|changed|started|stopped)|partly done|earlier part was recorded/i.test(framed[1] + framed[3])) {
    const inner = plainError(framed[2], { where, what, who, toast, readingReply });
    if (inner.text !== inner.detail) {
      const clause = inner.text.replace(/\. (?:Try again in a moment|Details has the exact error|It's in the log)\./g, "")
        .replace(/has run out/g, "had run out").replace(/is out of/g, "was out of").replace(/is busy/g, "was busy")
        .replace(/[.!?]+$/, "");
      return { text: `${withoutPaths(framed[1])}(${clause})${withoutPaths(framed[3])}`, detail };
    }
  }
  const code = String(error?.code ?? "") + " " + detail;
  const receipts = detail.match(/(?:Nothing (?:more )?was (?:sent|started|changed|stopped)|It (?:may|might) (?:still )?have (?:arrived|been (?:delivered|recorded)|finished)|The write[^.()]*may still have arrived|(?:Check|Refresh) before [^.]*|Your earlier part was recorded; the rest was not sent)\.?/gi) ?? [];
  let text;
  if (/\bcx is no longer valid\b/i.test(detail)) {
    const retry = receipts.some(receipt => /^(?:Check|Refresh) before|^Nothing more was/i.test(receipt)) ? "" : " Try again.";
    text = `Herdrig could not finish this step.${retry} ${toast ? "The exact error is in the log." : "Details has the exact error."}`;
  }
  else if (/\b(?:ENFILE|EMFILE)\b/.test(code)) text = `${where} has run out of open files. Try again in a moment.`;
  else if (/\bENOSPC\b/.test(code)) text = `${where} is out of disk space.`;
  else if (/\b(?:EACCES|EPERM)\b/.test(code)) text = `${where} didn't allow access to a file OpenRig needs.`;
  else if (/\bENOENT\b/.test(code)) text = `A file OpenRig needs is missing on ${where}.`;
  else if (/\b(?:EAGAIN|EBUSY)\b/.test(code)) text = `${where} is busy. Try again in a moment.`;
  else if (/\bEADDRINUSE\b/.test(code)) text = `A port OpenRig needs is already in use on ${where}.`;
  else {
    const exception = detail.match(/\b(TypeError|SyntaxError|RangeError|ReferenceError):/);
    const token = detail.trim().replace(/^read:\s*/i, "").replace(/\.$/, "");
    if (exception) text = `${exception[1] === "SyntaxError" && readingReply ? `${who}'s answer couldn't be read.` : what ? `Something went wrong with ${what}.` : "Something went wrong."}${toast ? " It's in the log." : " Details has the exact error."}`;
    else if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(token)) {
      text = token === "qitem_not_found" ? "That request isn't in OpenRig's queue any more."
        : token === "action_failed" ? what ? `OpenRig couldn't ${what}.` : "OpenRig couldn't do that."
        : token === "decision_revision_changed" ? "The request changed since you opened it. Here it is now."
        : `OpenRig answered "${statusWord(token)}".`;
    } else text = withoutPaths(detail);
  }
  // A nicer diagnostic must not erase an existing delivery/partial-work warning or a proven-unsent receipt.
  if (text !== detail) {
    if (/may (?:still )?have|partly done|earlier part was recorded/i.test(detail)) text = text.replace(" Try again in a moment.", "");
    for (const receipt of receipts) {
      const sentence = withoutPaths(receipt).trim().replace(/\.?$/, ".");
      if (!text.toLowerCase().includes(sentence.toLowerCase())) text += ` ${sentence}`;
    }
  }
  return { text, detail };
}
