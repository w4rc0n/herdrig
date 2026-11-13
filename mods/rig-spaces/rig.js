// herdrig's changes to herdr's Spaces list. main.js is herdr's file; it calls the hooks below (the lines marked
// "herdrig hook") and nothing else. Everything here only reads the shared key `herdrig.spaces`, which the Rig sidebar
// publishes from what it already knows (labels on terminals and its own record of the OpenRig home): space id ->
// { home?: true, rig?: name, rigId?: id, status?: "working" | "needs" | "idle", needs?: count }. This file never talks to OpenRig.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { shared, props, openOverlay, spaces } from "herdr";

export const KEY = "herdrig.spaces";
const known = () => shared(KEY) ?? {};
const entryOf = (w) => known()[w.id] ?? null;
const isRig = (w) => !!entryOf(w);
// What a stored colour name looks like on an avatar: herdr's own table, so a rig space keeps its colour under our mark.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const fillOf = (w, t) => {
  const color = (shared("space.colors") ?? {})[w.id] ?? "ansi6";
  return color.startsWith("#") ? color : (MARK[color] ?? t[color]);
};
const ICON = (name) => `mods/rig-spaces/${name}.svg`;
const none = () => div().absolute().size(0);

export const rig = {
  /** This copy of the list shows only rig spaces (the "Rig spaces" block of the Both mode). */
  only: () => props()?.only === true,

  /** The rows this list shows: all of them, or in the Rig spaces block only rig spaces and the OpenRig home. */
  keep(rows) { return rig.only() ? rows.filter((r) => isRig(r.w)) : rows; },

  /** A row's rig changes, drawn over the row's own content (the hook sits after the avatar, so these paint on top of it; positions are
   *  within that content row, whose first 18 px is the avatar): the OpenRig icon on the home space (D1), a small rig mark on a rig
   *  space's avatar (A1) and the rig's own status at the row's right (B1). A worktree row and any other space get nothing. */
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
    openOverlay({ mod: "rig-menu", kind: "popup", width: 230, height: 320,
      props: { target: { kind: "rigspace", space: w.id, name: w.name, rig: e.rig ?? null, rigId: e.rigId ?? null, home: !!e.home } } });
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
