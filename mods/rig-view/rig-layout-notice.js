import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { focusTarget } from './rig-lib.js';
import { hasOldProviderStrip, oldProviderViews, oldStripLayoutLabel, readStripLayout } from './rig-old-views.js';

// A plain `rig terminal open` or the Rig TUI's "Open terminals", run inside Herdr, switches the window to OpenRig's Rig layout:
// a strip of views the person can't close with Herdr. By default herdrig switches back to the person's own layout with Herdr's
// public layout.switch, once per open, and says so. OpenRig's views stay open (System lists them); no seat is touched and
// OpenRig's files are never changed. Every herdrig copy (Rig sidebar, Rig page) runs this from its 1 s timer; a hidden Rig page
// tab keeps its timer, so it works without a Rig sidebar. With no herdrig copy in the window at all, nothing can notice.

/** At most one toast every 2 minutes (restores in that window still happen): an agent looping on opens can't flood the person. */
export const RIG_LAYOUT_TOAST_GAP = 120000;
/** OpenRig counts a view as opened once herdr-app has shown and selected it; restoring before that makes the open report
 *  "unconfirmed" to whoever ran it. herdrig waits this long after an appearance before switching back. */
export const RESTORE_AFTER_MS = 1500;
const RESTORED_KEYS_KEPT = 20;
const safeName = name => typeof name === 'string' && !!name && name !== '.' && name !== '..' && !/[\/\\\u0000-\u001f]/.test(name);

/** "Keep my layout when OpenRig opens views" (Rig page → System → Layout). Default on. */
export const restoreLayoutOn = shared => (shared('rig.settings')?.restoreLayout ?? true) !== false;
const notificationsOn = shared => (shared('rig.settings')?.notifications ?? true) !== false;

/** Back's destination: the layout the person was using (rig.ownLayout, recorded only from layouts without OpenRig's strip),
 *  while Herdr still lists it. Otherwise null, and herdrig names the palette instead of guessing. */
export function ownLayoutTarget(shared, names) {
  const name = shared('rig.ownLayout');
  return safeName(name) && (names ?? []).includes(name) ? name : null;
}

/**
 * Every herdrig copy calls this from its 1 s timer; the copy that sees an appearance first handles it (the shared marker
 * rig.rigLayoutNotice = {appearance, shown, isReturn, mode, postedAt, restoringAt, kept}). An appearance is the shown layout
 * changing from no `rig-strip` to `rig-strip`; its key is the layout name plus the sorted view ids, so a new open gives a new
 * key. Returns null, {kind: 'restore', key, target} (the caller waits RESTORE_AFTER_MS, then finishRigLayoutRestore), or
 * {kind: 'toast', toast}.
 * - Restore on, a remembered layout, a new key: restore.
 * - Restore on and a key already restored (OpenRig re-showed the same views, or the person picked it): no second restore;
 *   the "showing again" toast, never suppressed, whose click goes back.
 * - Restore off, or nothing remembered: the notice (at most one every 2 minutes) and the card.
 */
export function rigLayoutAppearance(shared, setShared, name, tree, names, now = Date.now()) {
  const notice = shared('rig.rigLayoutNotice') ?? {};
  if (!hasOldProviderStrip(tree)) {
    // Herdr reloads every mod right after layout.switch, so the restore's own task usually never resumes to say it worked.
    // The restore marked itself 'switching' first; the first copy to see its target shown confirms it and posts the toast.
    if (notice.mode === 'switching' && name === notice.switchTarget && Number.isFinite(notice.switchingAt) && now - notice.switchingAt < SWITCH_CONFIRM_MS) {
      setShared('rig.rigLayoutNotice', { ...notice, shown: false, mode: 'restored' });
      if (!shared('rig.rigLayoutSeen')?.left) setShared('rig.rigLayoutSeen', { left: true });
      const toast = restoredToast(shared, setShared, now);
      return toast ? { kind: 'toast', toast } : null;
    }
    // Any other layout without the strip means the switch didn't land there: retire the marker, so a later visit to the
    // target (the person's own choice) is never announced as herdrig's restore.
    if (notice.mode === 'switching') {
      setShared('rig.rigLayoutNotice', { ...notice, shown: false, mode: 'notice' });
      if (!shared('rig.rigLayoutSeen')?.left) setShared('rig.rigLayoutSeen', { left: true });
      return null;
    }
    if (notice.shown) {
      setShared('rig.rigLayoutNotice', { ...notice, shown: false });
      if (!shared('rig.rigLayoutSeen')?.left) setShared('rig.rigLayoutSeen', { left: true });
    }
    return null;
  }
  if (notice.shown) return null;
  const appearance = `${name ?? ''}|${oldProviderViews(tree).map(view => view.id).sort().join(',')}`;
  const isReturn = Boolean(shared('rig.rigLayoutSeen')?.left);
  const target = ownLayoutTarget(shared, names);
  const mark = (mode, extra = {}) => setShared('rig.rigLayoutNotice', { appearance, shown: true, isReturn, mode, postedAt: notice.postedAt ?? null, kept: null, ...extra });
  if (restoreLayoutOn(shared) && target) {
    if ((shared('rig.rigLayoutRestored') ?? []).includes(appearance)) {
      mark('again');
      return { kind: 'toast', toast: { title: "OpenRig's Rig layout is showing again", body: `Click to go back to ${oldStripLayoutLabel(target)}.`,
        level: 'info', timeout: 8000, action: { name: 'layout.switch', args: { name: target } } } };
    }
    // A key can recur (the same views shown again later), so each appearance also gets its own instance id.
    const instance = `${now}-${Math.random().toString(36).slice(2, 10)}`;
    mark('restoring', { restoringAt: now, instance });
    return { kind: 'restore', key: appearance, target, instance };
  }
  const due = appearance !== notice.appearance && !(Number.isFinite(notice.postedAt) && now - notice.postedAt < RIG_LAYOUT_TOAST_GAP);
  mark('notice', { postedAt: due ? now : notice.postedAt ?? null });
  if (!due) return null;
  return { kind: 'toast', toast: noticeToast(isReturn, target) };
}

function noticeToast(isReturn, target) {
  const title = isReturn ? "OpenRig's Rig layout is back" : 'OpenRig opened its Rig layout';
  if (!target) return { title, body: 'Pick a layout: Ctrl+Shift+P, then Layout.', level: 'info', timeout: 8000 };
  return { title, body: isReturn ? 'A view was opened inside Herdr. Click to leave.' : `Click to go back to ${oldStripLayoutLabel(target)}. Seats keep running.`,
    level: 'info', timeout: 8000, action: { name: 'layout.switch', args: { name: target } } };
}

/**
 * After RESTORE_AFTER_MS: switch back with Herdr's layout.switch, then check it. host = {layout, layouts, readTextFile, run,
 * shared, setShared, wait, currentLayout}. Returns the toast to post, or null. Stops quietly when the window has already left
 * this appearance. The remembered layout must still be `ready` (a readable layout without OpenRig's strip).
 */
export async function finishRigLayoutRestore(host, appHome, event, now = Date.now()) {
  // `now` is when the restore began; the layout read below can take a while, so the switch marker uses the dispatch time.
  const startedAt = Date.now();
  // The person's own choice always wins: this exact appearance must still be waiting, still shown, and restore still on,
  // both now and again right before the switch (after the file read). Completion updates touch only this appearance.
  const live = () => {
    const current = host.shared('rig.rigLayoutNotice') ?? {};
    return current.instance === event.instance && current.mode === 'restoring' && current.shown && current.kept !== current.appearance
      && hasOldProviderStrip(host.layout()) ? current : null;
  };
  const setMode = (mode, extra = {}) => {
    const current = host.shared('rig.rigLayoutNotice') ?? {};
    if (current.instance === event.instance) host.setShared('rig.rigLayoutNotice', { ...current, mode, ...extra });
  };
  let notice = live();
  if (!notice) return null;
  if (!restoreLayoutOn(host.shared)) { setMode('notice'); return null; }
  const target = await readStripLayout(host, appHome, event.target);
  notice = live();
  if (!notice) return null;
  if (!restoreLayoutOn(host.shared)) { setMode('notice'); return null; }
  if (target.state !== 'ready') {
    const due = !(Number.isFinite(notice.postedAt) && now - notice.postedAt < RIG_LAYOUT_TOAST_GAP);
    setMode('notice', due ? { postedAt: now } : {});
    return due ? noticeToast(notice.isReturn, null) : null;
  }
  host.setShared('rig.rigLayoutRestored', [...(host.shared('rig.rigLayoutRestored') ?? []).filter(key => key !== event.key), event.key].slice(-RESTORED_KEYS_KEPT));
  // The marker survives Herdr's reload of the mods during the switch (see rigLayoutAppearance).
  setMode('switching', { switchTarget: event.target, switchingAt: now + (Date.now() - startedAt) });
  let switched = false;
  try {
    const reply = await host.run('layout.switch', { name: event.target });
    if (!reply?.error) for (let i = 0; i < 30 && !switched; i++) {
      switched = host.currentLayout() === event.target && !hasOldProviderStrip(host.layout());
      if (!switched) await host.wait(50);
    }
  } catch { switched = false; }
  // A timer tick may already have confirmed this switch and said so: only the copy that ends 'switching' speaks.
  const current = host.shared('rig.rigLayoutNotice') ?? {};
  if (current.instance !== event.instance || current.mode !== 'switching') return null;
  if (!switched) {
    setMode('failed');
    return { title: "herdrig couldn't restore your layout", body: "Herdr stayed on OpenRig's Rig layout. Leave it from System, or choose a Layout in the palette (Ctrl+Shift+P). Seats keep running.", level: 'warning', timeout: 10000 };
  }
  // The switch is confirmed, so this appearance has ended now: a quick second open is a new one, not this one (no waiting
  // for a timer to see the layout without the strip).
  setMode('restored', { shown: false });
  if (!host.shared('rig.rigLayoutSeen')?.left) host.setShared('rig.rigLayoutSeen', { left: true });
  return restoredToast(host.shared, host.setShared, now);
}

/** How long after the switch a copy that sees the person's layout still counts it as this restore. */
const SWITCH_CONFIRM_MS = 10000;

/** "herdrig restored your layout": under Notifications, at most one every 2 minutes. */
function restoredToast(shared, setShared, now) {
  const toastAt = shared('rig.rigLayoutRestoreToastAt');
  if (!notificationsOn(shared) || Number.isFinite(toastAt) && now - toastAt < RIG_LAYOUT_TOAST_GAP) return null;
  setShared('rig.rigLayoutRestoreToastAt', now);
  return { title: 'herdrig restored your layout', body: 'OpenRig switched it to open a view. Seats keep running.', level: 'info' };
}

/** The card shows while OpenRig's Rig layout is shown, until Keep (for this appearance); never during the brief restore wait. */
export function rigLayoutCardState(shared, tree, names, now = Date.now()) {
  if (!hasOldProviderStrip(tree)) return null;
  const notice = shared('rig.rigLayoutNotice') ?? {};
  if (notice.kept && notice.kept === notice.appearance) return null;
  if (notice.mode === 'restoring' && Number.isFinite(notice.restoringAt) && now - notice.restoringAt < RESTORE_AFTER_MS + 3500) return null;
  const target = ownLayoutTarget(shared, names);
  const viewList = oldProviderViews(tree);
  return { views: viewList.length, viewList, mode: notice.mode ?? 'notice', isReturn: Boolean(notice.isReturn ?? shared('rig.rigLayoutSeen')?.left),
    restoreOff: !restoreLayoutOn(shared), target, label: target ? oldStripLayoutLabel(target) : null };
}

/** Keep always wins: it also cancels a restore that is still pending, whatever its age (finishRigLayoutRestore re-checks). */
export function keepRigLayout(shared, setShared) {
  const notice = shared('rig.rigLayoutNotice') ?? {};
  setShared('rig.rigLayoutNotice', { ...notice, kept: notice.appearance ?? null, ...(notice.mode === 'restoring' ? { mode: 'notice' } : {}) });
}

/**
 * The card (sidebar's OpenRig section, or the Rig page when the layout has no Rig sidebar). Back runs Herdr's built-in
 * layout.switch; the owner checks the result (owner.rigLayoutBackFailed). Close views… opens today's Leave dialog.
 */
export function rigLayoutCard(owner, t, cx, state, { back, closeViews, keep }) {
  const n = state.views;
  const text = state.mode === 'again'
    ? "OpenRig's Rig layout is showing again. herdrig restores your layout once per open, so it left this one for you."
    : state.isReturn
    ? "OpenRig's Rig layout is back. OpenRig shows it whenever a view is opened inside Herdr: from the Rig TUI's Terminals screen, or by an agent running rig terminal open."
    : `OpenRig opened its Rig layout in this window: ${n} view${n === 1 ? '' : 's'} above your tabs. Your seats keep running.`;
  const button = (id, label, act, primary) => focusTarget(owner, cx, id,
    div().id(id).px(8).py(4).rounded(4).when(primary, e => e.bg(t.hover)).text_size(12).text_color(primary ? t.accent : t.muted).cursor_pointer()
      .hover(s => s.bg(primary ? t.raised : t.hover)).child(label), act);
  return v_flex().id('rig-layout-card').mx(8).my(4).p(8).gap(6).rounded(6).bg(t.raised)
    .child(div().text_size(11.5).text_color(t.muted).child(text))
    .when(!state.target, el => el.child(div().id('rig-layout-card-pick').text_size(11.5).text_color(t.muted).child('Pick a layout: Ctrl+Shift+P, then Layout.')))
    .when(!!owner.rigLayoutBackFailed || state.mode === 'failed', el => el.child(div().id('rig-layout-card-failed').text_size(11.5).text_color(t.blocked)
      .child("Herdr didn't switch back. Open the palette (Ctrl+Shift+P) and choose a Layout.")))
    .child(h_flex().gap(12)
      .when(!!state.target, el => el.child(button('rig-layout-back', `Back to ${state.label}`, back, true)))
      .when(!!closeViews, el => el.child(button('rig-layout-close-views', 'Close views…', closeViews, false)))
      .child(button('rig-layout-keep', 'Keep', keep, false)))
    .when(!closeViews, el => el.child(div().id('rig-layout-close-needs-sidebar').text_size(11.5).text_color(t.muted)
      .child("To close OpenRig's views, open the Rig sidebar, then use System.")))
    .when(!!state.restoreOff, el => el.child(div().id('rig-layout-card-setting').text_size(11.5).text_color(t.muted).child('herdrig can do this for you: System → Layout.')));
}
