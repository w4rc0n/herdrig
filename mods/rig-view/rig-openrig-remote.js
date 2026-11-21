import { errorDiagnostic } from "./rig-words.js";
// Reaching a machine's OpenRig over Herdr's connection: the pinned helper on that machine answers each request (one `hc exec`), so no tunnel
// is needed. Using it is its own permission per machine: a spec-save grant never satisfies it, and it never satisfies a spec save.
// Reads and the event long-poll run the helper directly; a write's body goes through the local bridge (rig-openrig-transport.cjs) as stdin.
import { RemoteMachine, goodHome } from './rig-remote.js';
import { OPENRIG_HELPER_SHA256 } from './rig-openrig-pin.js';

const identity = (r) => [r.target ?? '', r.id ?? '', r.via ?? '', r.session ?? ''];
const short = (id) => `${String(id ?? '').slice(0, 4)}…`;
export const OPENRIG_HELPER_FOLDER = '.local/share/herdr-openrig';
export const openrigHelperPath = (home) => `${home}/${OPENRIG_HELPER_FOLDER}/rig-openrig-helper.cjs`;
// Exec timeouts: a read gives up well before Herdr notices a dead link (about 42 s), and the long-poll's own wait (25 s) stays under its timeout.
export const READ_TIMEOUT_MS = 10000, EVENTS_WAIT_MS = 25000, EVENTS_TIMEOUT_MS = 40000;
// The first read after preparing may have to find the daemon cold (the helper allows `rig status` 15 s, then /healthz 5 s): give it room.
export const FIRST_READ_TIMEOUT_MS = 30000;
// A write through the bridge: about twenty small hc calls (the machine check twice, the helper path's inspection, which node, the write), each
// allowed 30 s. This is well above their normal total; a link slow enough to pass it gets the write reported as may-have-arrived, never retried.
export const WRITE_BUDGET_MS = 170000;
// A rig CLI write: the helper kills the CLI at 170 s, Herdr's exec allows 200 s and the local hc 230 s, plus the bridge's small hc calls before it.
export const RIG_BUDGET_MS = 300000;

/** The approval text: what the person allows, on which machine and account, and which helper runs. */
export function openrigConsentWords(c) {
  // The strongest things the helper's write table allows, then its catch-all: its get and post verbs send any GET or POST to an /api/ path.
  return `Use OpenRig on ${c.machine} as ${c.user}, over Herdr's connection. This lets Herdrig see what that OpenRig shows and act there as you: `
    + `send messages and requests to agents and answer them; start, stop, create, archive and delete rigs; launch rigs from specs in folders on ${c.machine}; `
    + `start seats over without their conversation; take snapshots; and change your quiet hours and modes. It can make any GET or POST request to OpenRig's API on ${c.machine}. `
    + `Helper: ${c.helperPath} (sha256 ${String(c.sha256).slice(0, 12)}).`;
}

function answer(r, what) {
  let data;
  try { data = JSON.parse(r?.stdout ?? ''); } catch { throw Error(r?.stderr || `${what}: no answer from the OpenRig helper.`); }
  // The helper's own error is a sentence it wrote; its stderr is raw, so an answer without an error says only that the step failed.
  // An answered failure without outcomeUnknown sent nothing (the helper and bridge mark every failure after a write left as outcomeUnknown).
  if (data?.ok !== true) throw Object.assign(Error(typeof data?.error === 'string' && data.error.trim() ? data.error : `${what} failed.`), { answered: true, tooLarge: data?.tooLarge === true, outcomeUnknown: data?.outcomeUnknown === true, notSent: data?.outcomeUnknown !== true, wrongHost: data?.wrongHost === true, status: data?.status ?? null });
  return data;
}

const markPreSend = (e) => {
  if (e && typeof e === 'object' && e.outcomeUnknown !== true) {
    if (e.code === 'GATE_REFUSED') delete e.dispatched;
    else e.notSent = true;
  }
  return e;
};

export class RemoteOpenRig {
  constructor(host) { this.host = host; }
  bridge(config, mode, args = [], timeout = 60000) {
    const node = config.rig?.[0]?.match(/(?:^|\/)node$/) ? config.rig[0] : 'node';
    return this.host.exec(node, [this.host.openrigBridgePath, mode, ...args], { timeout }).then((r) => answer(r, 'The OpenRig bridge'));
  }
  /** Checks the machine, asks for (or finds) this machine's approval, installs the pinned helper, and checks it reaches the expected OpenRig.
   *  Returns `{ok:true, ...}` ready for get/events/post, or `{ok:false, needsConsent:true, confirmation}`. */
  async prepare(config, consent = null) {
    const host = this.host, machine = config.daemonMachine;
    const record = await new RemoteMachine(host).ready(machine);
    const info = await new RemoteMachine(host).machineInfo(config);
    const shipped = await this.bridge(config, 'inspect');
    if (shipped.sha256 !== OPENRIG_HELPER_SHA256) throw Error('The OpenRig helper differs from this release. Reinstall the mod.');
    const key = JSON.stringify({ capability: 'openrig', machine, profile: identity(record), home: info.home, user: info.user, sha256: OPENRIG_HELPER_SHA256 });
    if (consent && consent.key !== key) throw Error('The machine or the helper changed since you approved it. Review it again.');
    const stored = await host.readOpenRigConsent();
    if (stored?.key !== key && consent?.key !== key) {
      const confirmation = { key, machine, user: info.user, helperPath: openrigHelperPath(info.home), sha256: OPENRIG_HELPER_SHA256 };
      return { ok: false, needsConsent: true, confirmation: { ...confirmation, words: openrigConsentWords(confirmation) } };
    }
    const fresh = await new RemoteMachine(host).ready(machine);
    if (JSON.stringify(identity(fresh)) !== JSON.stringify(identity(record))) throw Error('The Herdr machine changed. Nothing was sent.');
    const installed = await this.bridge(config, 'install', [machine, info.home, JSON.stringify(record)]);
    if (installed.path !== openrigHelperPath(info.home) || installed.sha256 !== OPENRIG_HELPER_SHA256) throw Error(`The OpenRig helper on ${machine} didn't verify after install. Nothing was sent.`);
    // The helper's installed path and the hash the bridge verified there: reads check it before every run; a write re-inspects the machine in the bridge.
    const ready = { config, machine, home: info.home, node: info.node, record, key, hostId: null, cold: true, helper: { path: installed.path, sha256: installed.sha256, stat: installed.stat ?? null } };
    const health = await this.get(ready, ['/healthz'], { timeout: FIRST_READ_TIMEOUT_MS });
    if (!health.hostId) throw Error(`OpenRig on ${machine} didn't name its host id. Nothing was sent.`);
    if (config.expectedHostId && health.hostId !== config.expectedHostId)
      throw Error(`${machine} now runs a different OpenRig: it was set up for host ${short(config.expectedHostId)} and answers as host ${short(health.hostId)}. Nothing was sent.`);
    if (consent && stored?.key !== key) await host.writeOpenRigConsent({ key });
    return { ok: true, ...ready, hostId: health.hostId };
  }
  /** The helper's answer, checked: an error comes back as that error, and once pinned, an answer from another OpenRig is refused. */
  checked(p, r, what) {
    const data = answer(r, what);
    if (p.hostId && data.hostId !== p.hostId) throw Error(`${p.machine} answered from a different OpenRig (host ${short(data.hostId)}, expected ${short(p.hostId)}).`);
    return data;
  }
  /** Before a read or an event poll: the installed helper must be the file install checked (its stat, without following a link), still owned by the same
   *  user and writable by no one else. A changed or unsafe helper refuses, and the caller prepares again (a full re-inspect and reinstall). */
  async checkHelper(p) {
    const was = p.helper?.stat;
    if (!was) throw Error(`The OpenRig helper on ${p.machine} hasn't been checked. Nothing was asked.`);
    // A check that fails on the machine (the helper deleted) is no answered refusal: the connection must prepare again and reinstall.
    let now;
    try { now = await this.bridge(p.config, 'stat', [p.machine, p.home]); }
    catch (error) { throw Error(`The OpenRig helper on ${p.machine} couldn't be checked (${error?.message ?? error}). Nothing was asked.`); }
    const unsafe = now.uid !== was.uid || (now.mode & 0o022) !== 0 || now.type !== 'regular file';
    if (unsafe || now.size !== was.size || now.mtime !== was.mtime || now.ctime !== was.ctime || now.inode !== was.inode)
      throw Error(`The OpenRig helper on ${p.machine} changed since it was checked${unsafe ? ' (its owner, permissions or type)' : ''}. Nothing was asked.`);
  }
  /** Up to 16 paths in one exec, in order, each `{path, status, body}`. Before the host id is known it is learned with "-". */
  async get(p, paths, { timeout = null } = {}) {
    const config = p.config, node = p.node, helper = p.helper;
    if (!goodHome(node)) throw Error(`The Node executable on ${p.machine} isn't known. Nothing was asked.`);
    if (helper?.sha256 !== OPENRIG_HELPER_SHA256) throw Error(`The OpenRig helper on ${p.machine} isn't the verified one. Nothing was asked.`);
    await this.checkHelper(p);
    // A read after a failure (or the first after preparing) may find the daemon cold again (its port moved, a restart): it gets the longer timeout.
    const wait = timeout ?? (p.cold ? FIRST_READ_TIMEOUT_MS : READ_TIMEOUT_MS);
    try { const answer = this.checked(p, await this.host.exec(node, [helper.path, 'get', p.hostId ?? '-', ...paths], { on: config.daemonMachine, timeout: wait }), `Reading OpenRig on ${p.machine}`); p.cold = false; return answer; }
    catch (error) { p.cold = true; throw error; }
  }
  /** One long-poll: the events after `cursor` (or from the newest stored one), and the cursor to pass next time. */
  async events(p, cursor = null, waitMs = EVENTS_WAIT_MS) {
    const config = p.config, node = p.node, helper = p.helper;
    if (!p.hostId) throw Error(`The OpenRig on ${p.machine} isn't known yet (no host id). Nothing was asked.`);
    if (!goodHome(node)) throw Error(`The Node executable on ${p.machine} isn't known. Nothing was asked.`);
    if (helper?.sha256 !== OPENRIG_HELPER_SHA256) throw Error(`The OpenRig helper on ${p.machine} isn't the verified one. Nothing was asked.`);
    await this.checkHelper(p);
    return this.checked(p, await this.host.exec(node, [helper.path, 'events', p.hostId, cursor ?? '-', String(waitMs)], { on: config.daemonMachine, timeout: EVENTS_TIMEOUT_MS }), `OpenRig events on ${p.machine}`);
  }
  /** Before a write is dispatched: the connection's settings must still be the ones this write was prepared under (a change while the body was staged
   *  could point the connection at another machine while the prepared one is still named here). Nothing has been sent yet, so it is a plain refusal.
   *  The dispatch that follows is a few microtasks later, through the gated exec, which checks the scope again as it starts. */
  async refuseIfChanged(p, stillCurrent, name) {
    if (typeof stillCurrent !== 'function' || stillCurrent()) return;
    if (name && name !== '-') await this.bridge(p.config, 'remove', [this.host.appHome, name]).catch(() => {});
    throw Object.assign(Error(`OpenRig's connection changed while this write to ${p.machine} was being prepared. Nothing was sent.`), { notSent: true });
  }
  /** A write through the rig CLI on the machine (the helper's rig verb builds and checks the argv): a shape, the person (or "-") and its values,
   *  and a queue row's body, which goes on stdin. Like every write it is never retried on its own; one that may have arrived says so. */
  async rig(p, shape, person, values, body = null, { stillCurrent = null } = {}) {
    if (!p.hostId) throw Object.assign(Error(`The OpenRig on ${p.machine} isn't known (no host id). Nothing was sent.`), { notSent: true });
    const appHome = this.host.appHome;
    let name = "-";
    if (body !== null) {
      try { ({ name } = await this.bridge(p.config, 'prepare', [appHome])); }
      catch (error) { throw markPreSend(error); }
      try { await this.host.writeText(`${appHome}/openrig/${name}`, body, ''); }
      catch (error) { await this.bridge(p.config, 'remove', [appHome, name]).catch(() => {}); throw markPreSend(error); }
    }
    await this.refuseIfChanged(p, stillCurrent, name);
    let data;
    try { data = await this.bridge(p.config, 'rig', [appHome, name, p.machine, p.home, p.node, p.hostId, JSON.stringify(p.record), shape, person, ...values], RIG_BUDGET_MS); }
    catch (error) {
      if (error?.outcomeUnknown) throw error;
      if (error?.answered) { error.notSent = true; throw error; }
      // A refusal herdrig's gate raised before the bridge ran sent nothing: it is said as itself, never as "may have arrived".
      if (error?.code === 'GATE_REFUSED' && error.dispatched !== true) throw error;
      throw Object.assign(Error(`The write to OpenRig on ${p.machine} may still have arrived (${errorDiagnostic(error).slice(0, 200)}). Check before sending it again.`), { outcomeUnknown: true });
    }
    if (p.hostId && data.hostId !== p.hostId)
      throw Object.assign(Error(`${p.machine} answered from a different OpenRig (host ${short(data.hostId)}). The write may have reached it; check there.`), { outcomeUnknown: true });
    return data;
  }
  /** A write. The body goes on stdin through the bridge; the helper's digest of what arrived is checked there. Never retried on its own. */
  async post(p, apiPath, type, body, { stillCurrent = null } = {}) {
    // The helper refuses to send unless the daemon answers as this host; an unknown host is refused here, before any transfer.
    if (!p.hostId) throw Object.assign(Error(`The OpenRig on ${p.machine} isn't known (no host id). Nothing was sent.`), { notSent: true });
    const appHome = this.host.appHome;
    let name;
    try { ({ name } = await this.bridge(p.config, 'prepare', [appHome])); }
    catch (error) { throw markPreSend(error); }
    try {
      await this.host.writeText(`${appHome}/openrig/${name}`, body, '');
    } catch (error) { await this.bridge(p.config, 'remove', [appHome, name]).catch(() => {}); throw markPreSend(error); }
    // A failure with no answer from the bridge (killed past WRITE_BUDGET_MS, cut off, unreadable) may come after the helper sent the write, so it is
    // "may have arrived" and is never retried; a refusal the bridge answered (nothing sent) stays plain.
    await this.refuseIfChanged(p, stillCurrent, name);
    let data;
    try { data = await this.bridge(p.config, 'post', [appHome, name, p.machine, p.home, p.node, p.hostId, apiPath, type, JSON.stringify(p.record)], WRITE_BUDGET_MS); }
    catch (error) {
      if (error?.outcomeUnknown) throw error;
      if (error?.answered) { error.notSent = true; throw error; }
      // A refusal herdrig's gate raised before the bridge ran sent nothing: it is said as itself, never as "may have arrived".
      if (error?.code === 'GATE_REFUSED' && error.dispatched !== true) throw error;
      throw Object.assign(Error(`The write to OpenRig on ${p.machine} may still have arrived (${errorDiagnostic(error).slice(0, 200)}). Check before sending it again.`), { outcomeUnknown: true });
    }
    if (p.hostId && data.hostId !== p.hostId)
      throw Object.assign(Error(`${p.machine} answered from a different OpenRig (host ${short(data.hostId)}). The write may have reached it; check there.`), { outcomeUnknown: true });
    return data;
  }
}
