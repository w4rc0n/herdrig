// herdrig's changes to herdr's Spaces list. main.js is herdr's file; it calls the hooks below (the lines marked
// "herdrig hook") and nothing else. The marks read the shared key `herdrig.spaces`, which the Rig sidebar
// publishes from what it already knows (labels on terminals and its own record of the OpenRig home): space id ->
// { home?: true, rig?: name, rigId?: id, status?: "working" | "needs" | "idle", needs?: count }. This file never talks to OpenRig.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { shared, props, openOverlay, spaces } from "herdr";

export const KEY = "herdrig.spaces";
const known = () => shared(KEY) ?? {};
const entryOf = (w) => known()[w.id] ?? null;
const isRig = (w) => !!entryOf(w);
/** The settings the rows these menu targets are built from were published under (the sidebar's rig.data.config): the menu judges the target by this stamp against a fresh read of config.json. The stamp is the
 *  ROW's own connection identity (the same fields rowsIdentityOf in rig-lib.js builds for the sidebar's own menus): a row of the second connection carries ITS address, machine and home, never the sidebar's, so
 *  the stale-rows check judges it by its own settings. A connection that is no longer listed stamps its id alone (the menu then refuses it); the folder here has no rig-lib, so the shape is copied. */
const rowsFor = (conn) => { const stamp = rowsStamp(conn); return stamp ? { rowsConfig: stamp } : {}; };
const rowsStamp = (conn) => {
  const c = shared("rig.data")?.config; if (!c) return undefined;
  const own = !conn || conn === c.connectionId, listed = own ? null : (c.connections ?? []).find((x) => x?.id === conn);
  if (!own && !listed) return { connectionId: conn };
  const e = own ? c : { daemonUrl: listed.daemonUrl || undefined, daemonMachine: listed.machine || undefined, openrigHome: listed.openrigHome || undefined };
  return { connectionId: own ? c.connectionId : listed.id, daemonUrl: e.daemonUrl, daemonUrlSource: own ? c.daemonUrlSource : undefined, daemonMachine: e.daemonMachine, openrigHome: e.openrigHome, rig: c.rig, configInvalid: c.configInvalid };
};
// What a stored colour name looks like on an avatar: herdr's own table, so a rig space keeps its colour under our mark.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const fillOf = (w, t) => {
  const color = (shared("space.colors") ?? {})[w.id] ?? "ansi6";
  return color.startsWith("#") ? color : (MARK[color] ?? t[color]);
};
const ICON = (name) => `mods/rig-spaces/${name}.svg`;
const none = () => div().absolute().size(0);
const MACHINE_NAME = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const MAX_ARGV_FIELD = 1024;
const safeArgvField = (v) => typeof v === "string" && v.length >= 1 && v.length <= MAX_ARGV_FIELD && !v.startsWith("-") && !/[\x00-\x1f\x7f]/.test(v);
const UNKNOWN_MACHINE_ERROR = "This machine isn't known any more. Add it again with ⚠ / Add a machine.";
const INVALID_MACHINE_ERROR = "Invalid machine details; reconnect refused.";
const persistRemovedOnly = (state) => {
  if (!state || typeof state !== "object") return state;
  Object.defineProperty(state, "toJSON", {
    value() { return { removed: Boolean(this.removed) }; },
    configurable: true,
  });
  return state;
};
const checkMachineFields = (machine) => {
  if (!machine || typeof machine !== "object" || Array.isArray(machine)) {
    return { ok: false, validName: false, hasTarget: false, name: "" };
  }
  const name = typeof machine.name === "string" ? machine.name : "";
  const validName = MACHINE_NAME.test(name) && !(name in Object.prototype);
  const hasTarget = typeof machine.target === "string" && machine.target.length > 0;
  const validTarget = safeArgvField(machine.target);
  const session = machine.session;
  const validSession = session === undefined || session === null || session === "" || safeArgvField(session);
  const via = machine.via;
  const validVia = via === undefined || via === null || typeof via === "boolean" || safeArgvField(via);
  return { ok: validName && validTarget && validSession && validVia, validName, hasTarget, name };
};

export const rig = {
  /** Idle git/layout checks need no 250ms wake-up. Keep that cadence only during a drag or reconnect. */
  watchSpaces(view,cx) {
    if(view.rigPollArmed)return true;
    const arm=live=>{
      if(view.closed)return;
      view.rigPollArmed=true;
      const active=view.pressed||view.over||Object.values(view.reconnecting??{}).some(state=>state?.busy);
      live.timer.after(active?250:1000,next=>{
        view.rigPollArmed=false;
        if(view.closed)return;
        const current=next??live;
        try{view.checkNew(current);}finally{arm(current);}
      });
    };
    arm(cx);return true;
  },
  /** Keep birth-time measurements only for spaces still in the current host snapshot. */
  pruneBorn(born, at) {
    for (const id of Object.keys(born)) if (!Object.hasOwn(at, id)) delete born[id];
  },
  /** Sanitize persisted `machines.reconnecting` on init: persist `{ removed }` only and keep only `{ name }` in memory, stripping any persisted `target`/`session`/`via`. */
  reconnecting(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [k, v] of Object.entries(raw)) {
      if (!MACHINE_NAME.test(k) || k in Object.prototype || !v || typeof v !== "object" || Array.isArray(v)) continue;
      out[k] = persistRemovedOnly({ removed: Boolean(v.removed), machine: Object.freeze({ name: k }) });
    }
    return out;
  },

  /** Serialize only `{ removed }` whenever `machines.reconnecting` is written to `localStorage`, keeping validated `state.machine` in memory so a failed `machine add` after `machine rm` can retry. */
  persistReconnecting(state) { persistRemovedOnly(state); },

  /** Validate `name`, `target`, `session`, and `via` before `reconnect()` builds `hc machine rm/add` argv. */
  canReconnect(machine, reconnecting, cx) {
    if (!machine || typeof machine !== "object" || Array.isArray(machine)) {
      if (reconnecting && typeof reconnecting === "object") {
        for (const [k, prev] of Object.entries(reconnecting)) {
          if (MACHINE_NAME.test(k) && !(k in Object.prototype) && !prev?.busy && prev?.removed && !checkMachineFields(prev?.machine).ok) {
            reconnecting[k] = persistRemovedOnly({ removed: true, machine: Object.freeze({ name: k }), busy: false, error: UNKNOWN_MACHINE_ERROR });
          }
        }
      }
      cx?.notify?.();
      return false;
    }
    const check = checkMachineFields(machine);
    if (check.ok) {
      if (reconnecting && typeof reconnecting === "object" && Object.prototype.hasOwnProperty.call(reconnecting, check.name)) {
        const prev = reconnecting[check.name];
        if (prev && typeof prev === "object" && !prev.busy) prev.machine = machine;
      }
      return true;
    }
    if (check.validName && reconnecting && typeof reconnecting === "object") {
      const prev = Object.prototype.hasOwnProperty.call(reconnecting, check.name) ? reconnecting[check.name] : null;
      if (!prev?.busy) {
        const error = !check.hasTarget ? UNKNOWN_MACHINE_ERROR : INVALID_MACHINE_ERROR;
        reconnecting[check.name] = persistRemovedOnly({ removed: Boolean(prev?.removed), machine: Object.freeze({ name: check.name }), busy: false, error });
      }
    }
    cx?.notify?.();
    return false;
  },

  /** This copy of the list shows only rig spaces (the "Rig spaces" block of the Both mode). */
  only: () => props()?.only === true,

  /** The rows this list shows: all of them, or in the Rig spaces block only rig spaces and the OpenRig home. */
  keep(rows) { return rig.only() ? rows.filter((r) => isRig(r.w)) : rows; },

  /** A row's rig changes, drawn over the row's own content (the hook sits after the avatar, so these paint on top of it; positions are
   *  within that content row, whose first 18 px is the avatar): the OpenRig icon on the home space, a small rig mark on a rig
   *  space's avatar and the rig's own status at the row's right. A worktree row and any other space get nothing. */
  row(w, t, tree) {
    const e = entryOf(w);
    if (!e || tree) return none();
    const status = e.status === "needs" || (e.needs ?? 0) > 0 ? "needs" : e.status === "working" ? "working" : null;
    return div().id(`rig-space-${w.id}`).absolute().left(0).right(0).top(0).bottom(0)
      .when(e.home, (el) => el.child(div().absolute().left(0).top(0).size(18).rounded(5).bg(fillOf(w, t)).flex().items_center().justify_center()
        .child(svg(ICON("rig-view")).size(12).text_color("#ffffff"))))
      .when(!e.home, (el) => el.child(div().absolute().left(9).top(9).size(12).rounded(6).bg(t.chrome).border_1().border_color(t.dim).flex().items_center().justify_center()
        .child(svg(ICON("rig-seat")).size(8).text_color(t.foreground))))
      .when(status === "needs", (el) => el.child(div().absolute().right(2).top(5).child(svg(ICON("rig-diamond")).size(9).text_color(t.blocked))))
      .when(status === "working", (el) => el.child(div().absolute().right(3).top(5).size(7).rounded(4).bg(t.working ?? t.ansi2)));
  },

  /** The narrow rail's cell: the same rig mark, small, in the corner. */
  compact(w, t) {
    const e = entryOf(w);
    if (!e) return none();
    return div().absolute().left(1).top(1).size(10).rounded(5).bg(t.chrome).flex().items_center().justify_center()
      .child(svg(ICON(e.home ? "rig-view" : "rig-seat")).size(7).text_color(t.foreground));
  },

  /** Right-click on a rig space opens the rig menu (herdr's Rename and Close first); any other space keeps herdr's menu. */
  menu(w) {
    const e = entryOf(w);
    if (!e) return false;
    const spaceConn = e.conn ?? e.spaceConn;
    openOverlay({ mod: "rig-menu", kind: "popup", width: 230, height: 320,
      props: { target: { kind: "rigspace", conn: e.conn, ...(e.spaceConn ? { spaceConn: e.spaceConn } : {}), space: w.id, name: w.name, rig: e.rig ?? null, rigId: e.rigId ?? null, home: !!e.home, ...rowsFor(spaceConn) } } });
    return true;
  },

  /** The Rig spaces block of the Both mode: herdr's header and scroll container, titled for what it holds. */
  block(view, t, collapsed, list) {
    const any = spaces().some(isRig);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, (el) => el.pl(0).pr(0).justify_center())
        .when(!collapsed, (el) => el.child("Rig spaces")))
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("always").track_scroll(view.scroll)
        .on_size_change((_size, cx) => { if (view.activeAt >= 0) { view.scroll.scroll_to_item(view.activeAt); cx.notify(); } })
        .on_mouse_up("left", (_e, cx) => { view.pressed = null; cx.notify(); })
        .children(any ? list : [div().id("rig-spaces-empty").px(8).py(6).text_size(11.5).text_color(t.dim)
          .child(collapsed ? "·" : "No rig spaces yet. Open a rig's space from the OpenRig block.")]));
  },
};
