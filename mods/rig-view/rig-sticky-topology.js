// Sticky Topology header layout and scroll-position math for the Explorer sidebar.
//
// Herdr's mod runtime (`gpui-kit`) exposes `.relative()` / `.absolute()`, `on_scroll_wheel`,
// `on_size_change`, and `ScrollHandle.scroll_to_item(index)`, without CSS `position: sticky`
// or a `ScrollHandle` offset getter. From the sidebar's known row heights, measured viewport
// height, wheel deltas, and `scroll_to_item` reveal bounds, this module computes which
// expanded Topology container headers stay pinned at the top of the scroll viewport while
// scrolling through their children.

export const STICKY_LIST_PAD_Y = 4;
export const DEFAULT_NOTICE_HEIGHT = 52;

/** Known unzoomed design-pixel height for keyed sidebar rows; null for variable-height notices. */
export function defaultSidebarRowHeight(key) {
  if (!key) return null;
  if (
    key.startsWith("branch:") ||
    key.startsWith("rig:") ||
    key.startsWith("assistants:") ||
    key === "needs:updates" ||
    key.startsWith("more:") ||
    key.startsWith("dismissed:")
  ) {
    return 24;
  }
  if (key.startsWith("assistant:") || key.startsWith("priority-helper:")) return 26;
  if (key.startsWith("priority:")) return 30;
  return 22;
}

/** Clamp `scrollTop` into `[0, maxScroll]` when `viewportHeight` is known. */
export function clampScrollTop(scrollTop, contentHeight, viewportHeight) {
  const raw = Math.max(0, Number(scrollTop) || 0);
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return raw;
  const maxScroll = Math.max(0, (Number(contentHeight) || 0) - viewportHeight);
  return Math.min(raw, maxScroll);
}

/**
 * Build per-row `[top, bottom)` coordinates and per-container `subtreeBottom` extents
 * in a single O(N) pass over the sidebar scroll list's direct children.
 */
export function buildStickyScrollLayout(rows, visibleTreeRows, stickySpecs, { padY = STICKY_LIST_PAD_Y } = {}) {
  const parentByKey = new Map();
  for (const row of visibleTreeRows ?? []) {
    if (row?.key) parentByKey.set(row.key, row.parentKey ?? null);
  }

  const items = [];
  const rowByKey = new Map();
  const subtreeBottom = new Map();
  let cursor = padY;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const h = Number.isFinite(r?.height) && r.height > 0
      ? r.height
      : (defaultSidebarRowHeight(r?.key) ?? DEFAULT_NOTICE_HEIGHT);
    const top = cursor;
    const bottom = top + h;
    cursor = bottom;

    const item = { index: i, key: r?.key ?? null, height: h, top, bottom, parentKey: r?.parentKey ?? null };
    items.push(item);
    if (item.key) rowByKey.set(item.key, item);

    let anc = item.key ? (parentByKey.get(item.key) ?? item.parentKey) : item.parentKey;
    let guard = 0;
    while (anc && guard++ < 16) {
      const prev = subtreeBottom.get(anc) ?? 0;
      if (bottom > prev) subtreeBottom.set(anc, bottom);
      anc = parentByKey.get(anc) ?? null;
    }
  }

  const contentHeight = cursor + padY;
  const rigAndPrioritySpecs = [];
  const hostSpecs = [];
  const secondaryByParent = new Map();

  for (const spec of stickySpecs?.values?.() ?? stickySpecs ?? []) {
    if (!spec?.key || !spec.isOpen) continue;
    const row = rowByKey.get(spec.key);
    if (!row) continue;
    const end = subtreeBottom.get(spec.key) ?? row.bottom;
    if (end <= row.bottom) continue; // open container with zero rendered children never pins
    const hydrated = {
      ...spec,
      rowIndex: row.index,
      top: row.top,
      bottom: row.bottom,
      height: row.height,
      subtreeBottom: end,
    };
    if (spec.kind === "rig" || spec.kind === "priority") {
      rigAndPrioritySpecs.push(hydrated);
    } else if (spec.kind === "host") {
      hostSpecs.push(hydrated);
    } else if (spec.parentKey) {
      let bucket = secondaryByParent.get(spec.parentKey);
      if (!bucket) {
        bucket = [];
        secondaryByParent.set(spec.parentKey, bucket);
      }
      bucket.push(hydrated);
    }
  }

  return {
    items,
    rowByKey,
    contentHeight,
    rigAndPrioritySpecs,
    hostSpecs,
    secondaryByParent,
  };
}

/**
 * Compute the 0..2 expanded Topology headers pinned at `scrollTop`:
 * - Slot 1: active expanded Rig (or Priority group in Priority view, or Host between rigs)
 * - Slot 2: active expanded Pod / Connected assistants / Views child under that Rig
 */
export function computeStickyTopology(layout, scrollTop, viewportHeight = null) {
  if (!layout) return [];
  if (Number.isFinite(viewportHeight) && viewportHeight > 0 && viewportHeight < 96) return [];
  const y = clampScrollTop(scrollTop, layout.contentHeight, viewportHeight);
  if (y <= 0) return [];

  const maxSlots = Number.isFinite(viewportHeight) && viewportHeight > 0 && viewportHeight < 156 ? 1 : 2;

  let slot1 = null;
  for (const spec of layout.rigAndPrioritySpecs) {
    if (spec.top < y && spec.subtreeBottom > y + spec.height) {
      slot1 = spec;
      break;
    }
  }
  if (!slot1) {
    for (const spec of layout.hostSpecs) {
      if (spec.top < y && spec.subtreeBottom > y + spec.height) {
        slot1 = spec;
        break;
      }
    }
  }
  if (!slot1) return [];
  if (maxSlots < 2 || slot1.kind !== "rig") return [slot1];

  const edge = y + slot1.height;
  const children = layout.secondaryByParent.get(slot1.key) ?? [];
  for (const spec of children) {
    if (spec.top < edge && spec.subtreeBottom > edge + spec.height) {
      return [slot1, spec];
    }
  }
  return [slot1];
}

export function stickySignature(pinned) {
  if (!pinned?.length) return "";
  return pinned.map((p) => p.key).join("\n");
}

/** Mirror GPUI `Scrollable` minimal-delta `scroll_to_item` behavior (`scroll.rs:186-194`). */
export function nextScrollTopAfterReveal(layout, index, scrollTop, viewportHeight) {
  const item = layout?.items?.[index];
  if (!item || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return Math.max(0, Number(scrollTop) || 0);
  }
  let next = clampScrollTop(scrollTop, layout.contentHeight, viewportHeight);
  if (item.height > viewportHeight || item.top < next) {
    next = item.top;
  } else if (item.bottom > next + viewportHeight) {
    next = item.bottom - viewportHeight;
  }
  return clampScrollTop(next, layout.contentHeight, viewportHeight);
}

/**
 * Compute the `ScrollHandle.scroll_to_item` index and resulting `scrollTop` for keyboard
 * selection reveals so upward movement clears any pinned Topology header overlay.
 */
export function revealTargetForSelection(layout, selectedIndex, scrollTop, viewportHeight) {
  if (!layout || !Number.isInteger(selectedIndex) || selectedIndex < 0) {
    return { targetIndex: selectedIndex, nextScrollTop: Math.max(0, Number(scrollTop) || 0) };
  }
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return { targetIndex: selectedIndex, nextScrollTop: Math.max(0, Number(scrollTop) || 0) };
  }
  const item = layout.items[selectedIndex];
  if (!item) {
    return { targetIndex: selectedIndex, nextScrollTop: clampScrollTop(scrollTop, layout.contentHeight, viewportHeight) };
  }
  const directTop = nextScrollTopAfterReveal(layout, selectedIndex, scrollTop, viewportHeight);
  const pinned = computeStickyTopology(layout, directTop, viewportHeight);
  const stickyHeight = pinned.reduce((sum, s) => sum + s.height, 0);
  if (stickyHeight > 0 && item.top < directTop + stickyHeight && selectedIndex > 0) {
    const neededTop = item.top - stickyHeight;
    let target = selectedIndex;
    while (target > 0 && layout.items[target].top > neededTop) {
      target -= 1;
    }
    return {
      targetIndex: target,
      nextScrollTop: nextScrollTopAfterReveal(layout, target, scrollTop, viewportHeight),
    };
  }
  return { targetIndex: selectedIndex, nextScrollTop: directTop };
}
