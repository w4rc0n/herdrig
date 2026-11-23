import {activationPair} from './rig-activation.js';
/** Public summary projection only. Archived rigs never contribute active seats or counts. */
export function withArchivedHosts(records, nodesFor, conn = null) {
  return archivedOnHost(records).map(r => {
    const explicit = r.host ?? r.hostSelfId ?? r.hostId;
    const nodes = nodesFor(r.id);
    const hosts = [...new Set((Array.isArray(nodes) ? nodes : []).map(n => n.host ?? n.hostSelfId ?? n.hostId).filter(h => typeof h === "string" && h))];
    return { ...r, hosts: hosts.length ? hosts : [explicit || "unknown"], ...(conn ? { conn } : {}) };
  });
}
export function archivedOnHost(records, host = null) {
  return (Array.isArray(records) ? records : []).filter(r => r?.archivedAt && typeof r.id === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(r.id)
    && (host === null || (r.hosts ?? [r.host ?? r.hostSelfId ?? r.hostId ?? "local"]).includes(host)));
}
export function archivedElements({ div, svg, h_flex }, t, records, { host = null, showHost = false, open = false, toggle, restore, menu, icon, indent = 18, now = Date.now(), register = () => {}, focusFor=()=>null, focusOwner=records } = {}) {
  const rigs = archivedOnHost(records, host);
  if (!rigs.length) return [];
  const key = `archived:${host ?? "all"}`;
  const control=(id,el,act)=>{
    const handle=focusFor(id),activation=activationPair(focusOwner,id);
    return el.when(!!handle,node=>node.track_focus(handle).tab_stop(true).tab_index(0))
      .when(!!handle?.is_focused?.(),node=>node.border_1().border_color(t.accent))
      .on_mouse_down('left',activation.pointer((_e,cx)=>{cx.stop_propagation();handle?.focus?.();}))
      .on_click(activation.click((event,cx)=>{cx.stop_propagation();act(event,cx);}))
      .on_key_down(activation.key((event,cx)=>{if(handle?.is_focused?.()&&['enter','space',' '].includes(event.key)){cx.stop_propagation();act(event,cx);}}));
  };
  register({ key, foldKey: key, expandable: true, isOpen: open, parentKey: "branch:topology" });
  return [control(key,h_flex().id(key).tooltip(`${open ? 'Hide' : 'Show'} the ${rigs.length} archived rigs`).pl(indent).pr(8).h(22).gap(6).items_center().text_color(t.dim).cursor_pointer(),toggle)
    .child(svg(icon(open ? "chevron-down" : "chevron-right")).size(11))
    .child(div().text_size(12).child(`Archived (${rigs.length})`)),
  ...(open ? rigs.map(r => {
    // 0.7.11 also serves SQLite UTC timestamps without an explicit zone.
    const rawStamp = String(r.archivedAt), stamp = Date.parse(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(rawStamp) ? rawStamp.replace(" ", "T") + "Z" : rawStamp);
    const minutes = Math.max(0, Math.floor((now - stamp) / 60000));
    const ago = !Number.isFinite(stamp) ? "archived" : minutes < 1 ? "archived just now" : minutes < 60 ? `archived ${minutes}m ago` : `archived ${Math.floor(minutes / 60)}h ago`;
    const label = `${r.name ?? r.id}${showHost ? ` · ${(r.hosts ?? [r.host ?? r.hostSelfId ?? r.hostId ?? "local"]).join(", ")}` : ""}`;
    return h_flex().id(`archived-rig-${r.id}`).pl(indent + 16).pr(8).h(24).gap(6).items_center().text_color(t.dim)
      .on_mouse_down("right", () => menu(r)).tooltip(`${r.name ?? r.id} · ${ago}`)
      .child(svg(icon("rig-archive")).size(12))
      .child(div().flex_1().min_w(0).truncate().text_size(12).tooltip(`${label}\n${ago}`).child(label))
      .child(control(`restore-rig-${r.id}`,div().id(`restore-rig-${r.id}`).tooltip(`Restore ${r.name ?? r.id} from the archive`).px(6).h(20).rounded(5).bg(t.raised).text_size(11).text_color(t.accent).flex().items_center().cursor_pointer(),()=>restore(r)).child("Restore"));
  }) : [])];
}
