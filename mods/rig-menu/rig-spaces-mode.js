// Which Spaces list a layout shows (Herdr's, herdrig's, or both), and the change from one to another.
// Pure functions over a layout tree (herdr's own JSON: nodes with `id`, `children`, `size`, `content: { mod, props }`):
// nothing here reads a file, sends a command or calls OpenRig. The page that owns the opt-in screen applies a plan.
//
//   herdr    one block shows herdr's `spaces`
//   herdrig  one block shows our `rig-spaces` (the full list: every space, with the rig changes)
//   both     herdr's `spaces` block stays and a block below it shows `rig-spaces` with `props.only`: only rig spaces
//
// Only blocks that show one of those two mods are ever touched, found by mod name (never by id or position alone), and the
// block we add for Both is found again by its mod, its `only` prop and its id, so a block the person made is left alone.

export const HERDR_MOD = "spaces";
export const OUR_MOD = "rig-spaces";
export const ONLY_ID = "rig-spaces-only";
/** The layouts herdr ships. It rewrites them at every start and takes no structure change to them. */
export const SHIPPED_LAYOUTS = Object.freeze(["main", "terminals", "win98"]);
/** The herdr-app commit our copy of herdr's list was taken from (the drift test pins the same). */
export const BASE_HERDR = "3d76790";

export const MODES = Object.freeze(["herdr", "herdrig", "both"]);
export const MODE_LABEL = Object.freeze({ herdr: "Herdr's", herdrig: "herdrig's", both: "Both" });

const modOf = (node) => node?.content?.mod ?? null;
const isOnly = (node) => modOf(node) === OUR_MOD && node?.content?.props?.only === true;
const isOurs = (node) => modOf(node) === OUR_MOD;
const isFull = (node) => isOurs(node) && !isOnly(node);
const isAdded = (node) => isOnly(node) && typeof node.id === "string" && node.id.startsWith(ONLY_ID);
const clone = (value) => JSON.parse(JSON.stringify(value));

/** Every node, depth first, with its parent and index. */
export function walk(tree, visit, parent = null, index = -1) {
  if (!tree || typeof tree !== "object") return;
  visit(tree, parent, index);
  (tree.children ?? []).forEach((child, i) => walk(child, visit, tree, i));
}

const ids = (tree) => { const out = new Set(); walk(tree, (n) => { if (typeof n.id === "string") out.add(n.id); }); return out; };

/** What the layout shows now: counts of each kind of block and the mode they add up to ("custom" when they don't). */
export function detectMode(tree) {
  let herdr = 0, full = 0, only = 0;
  walk(tree, (n) => { if (modOf(n) === HERDR_MOD) herdr++; else if (isFull(n)) full++; else if (isOnly(n)) only++; });
  const mode = herdr + full + only === 0 ? "none"
    : herdr > 0 && full === 0 && only === 0 ? "herdr"
    : herdr === 0 && full > 0 && only === 0 ? "herdrig"
    : herdr > 0 && full === 0 && only > 0 ? "both"
    : "custom";
  return { mode, herdr, full, only };
}

const LINES = {
  herdr: {
    herdrig: ["Block: Spaces shows herdrig's list (rig-spaces) instead of Herdr's (spaces)."],
    both: ["Adds a block, Rig spaces (rig-spaces), below Spaces. Herdr's Spaces block stays."],
  },
  herdrig: {
    herdr: ["Spaces shows Herdr's list. The Rig spaces block is removed."],
    both: ["Spaces shows Herdr's list again, and a Rig spaces block is added below it."],
  },
  both: {
    herdr: ["Spaces shows Herdr's list. The Rig spaces block is removed."],
    herdrig: ["Spaces shows herdrig's list (rig-spaces) instead of Herdr's (spaces). The Rig spaces block is removed."],
  },
};

/** The change from the layout as it is to `target`, or why there is none to make.
 *  Returns { ok: true, tree, from, to, lines, blocks, added, removed } with `tree` a changed copy, or { ok: false, reason }. */
export function planMode(tree, target) {
  if (!MODES.includes(target)) return { ok: false, reason: "That isn't a Spaces list choice." };
  const now = detectMode(tree);
  if (now.mode === "none") return { ok: false, reason: "This layout has no Spaces block, so there's nothing to change." };
  if (now.mode === "custom") return { ok: false, reason: "This layout mixes Herdr's list and herdrig's in a way herdrig didn't make, so it leaves it alone." };
  if (now.mode === target) return { ok: false, reason: `This layout already shows ${MODE_LABEL[target]} Spaces list.` };
  const next = clone(tree), taken = ids(next);
  const changed = [];
  let added = 0, removed = 0;
  // Our added Rig spaces block goes (to Herdr's or herdrig's), found by mod, only prop and id.
  const dropAll = () => { const doomed = []; walk(next, (n, parent) => { if (parent && isAdded(n)) doomed.push([parent, n]); }); for (const [parent, n] of doomed) { parent.children.splice(parent.children.indexOf(n), 1); removed++; } };
  const swap = (from, to) => walk(next, (n) => { if (from(n)) { n.content = { mod: to }; changed.push(n.id ?? null); } });
  if (target === "herdr") { swap(isFull, HERDR_MOD); dropAll(); }
  else if (target === "herdrig") { swap((n) => modOf(n) === HERDR_MOD, OUR_MOD); dropAll(); }
  else {
    swap(isFull, HERDR_MOD);
    let place = null;
    walk(next, (n, parent, index) => { if (!place && modOf(n) === HERDR_MOD && parent) place = { n, parent, index }; });
    if (!place) return { ok: false, reason: "Herdr's Spaces block isn't inside a column or row, so there is nowhere to add the Rig spaces block." };
    let id = ONLY_ID;
    for (let i = 2; taken.has(id); i++) id = `${ONLY_ID}-${i}`;
    // A third of the Spaces block (its weight, or for a px layout its px with room for three rows); the person's own drag wins after.
    const px = Number.isFinite(place.n.size?.px) && place.n.size.px > 0 ? place.n.size.px : null;
    const weight = Number.isFinite(place.n.size?.weight) && place.n.size.weight > 0 ? place.n.size.weight : 1;
    const block = { id, type: "block", size: px ? { px: Math.max(90, Math.round(px / 3)) } : { weight: Number((weight / 3).toFixed(2)) }, min: 90, content: { mod: OUR_MOD, props: { only: true } } };
    place.parent.children.splice(place.parent.children.indexOf(place.n) + 1, 0, block);
    added++;
    changed.push(id);
  }
  return { ok: true, tree: next, from: now.mode, to: target, lines: LINES[now.mode][target], blocks: changed.length, added, removed };
}

/** Does `after` equal the tree the plan made, field for field? A concurrent edit, or herdr changing something else, makes it differ. */
export function sameTree(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  // herdr keeps sizes as 32-bit floats: a weight of 0.33 reads back as 0.33000001311302185. Equal as herdr stores them is equal.
  return typeof value === "number" ? Math.fround(value) : value;
}

/** Is `layout` one herdr ships (so structure can't change in it: the page makes a personal copy first)? */
export const isShippedLayout = (name) => SHIPPED_LAYOUTS.includes(name);

/** Does a shipped `spaces` mod already keep the active space in view itself? By shape, not version: it makes a ScrollHandle,
 *  attaches it with `.track_scroll(` and calls `scroll_to_item(`, as herdr's tabs mod does. An unreadable file shows nothing. */
export function shippedSpacesHasReveal(source) {
  const text = typeof source === "string" ? source : "";
  return /ScrollHandle\.new\s*\(/.test(text) && /\.track_scroll\s*\(/.test(text) && /scroll_to_item\s*\(/.test(text);
}

/** The mod name of herdrig's Rig sidebar block. */
export const RIG_MOD = "rig";

/** Which of herdrig's mods a layout still names in a block (`rig`, `rig-spaces`): what uninstall must take out of a personal layout
 *  before the folders go, or Herdr falls back to its own layout at the next start. */
export function namedOurMods(tree) {
  const found = new Set();
  walk(tree, (n) => { const mod = modOf(n); if (mod === RIG_MOD || mod === OUR_MOD) found.add(mod); });
  return [...found];
}

/** What uninstall does to a personal layout: herdrig's Spaces blocks go back to Herdr's list (as `switchBack`), the block herdrig added
 *  goes, and every block of the Rig sidebar (mod `rig`) goes. Nothing else is touched; a row or column that only held those blocks
 *  goes with them. Returns { ok: true, tree, spaces, rigBlocks } or null when the layout names none of ours. */
export function uninstallPlan(tree) {
  const back = switchBack(tree);
  const next = clone(back?.ok ? back.tree : tree);
  let rigBlocks = 0;
  const strip = (node, isRoot) => {
    if (!Array.isArray(node?.children)) return false;
    const before = node.children.length;
    node.children = node.children.filter((child) => modOf(child) === RIG_MOD ? (rigBlocks++, false) : !strip(child, false));
    return !isRoot && before > 0 && node.children.length === 0;
  };
  strip(next, true);
  if (!back?.ok && rigBlocks === 0) return null;
  return { ok: true, tree: next, spaces: !!back?.ok, rigBlocks };
}

/** Switch every `rig-spaces` block of a layout back to Herdr's (the uninstall and the way back): the plan to `herdr`, or null when
 *  the layout shows none of ours. */
export function switchBack(tree) {
  const now = detectMode(tree);
  if (now.full === 0 && now.only === 0) return null;
  if (now.mode === "custom" || now.mode === "none") {
    // Mixed on purpose by the person: only our own full blocks and the block we added are put back or removed.
    const next = clone(tree);
    let blocks = 0;
    walk(next, (n) => { if (isFull(n)) { n.content = { mod: HERDR_MOD }; blocks++; } });
    const doomed = [];
    walk(next, (n, parent) => { if (parent && isAdded(n)) doomed.push([parent, n]); });
    for (const [parent, n] of doomed) { parent.children.splice(parent.children.indexOf(n), 1); blocks++; }
    return blocks ? { ok: true, tree: next, from: now.mode, to: "herdr", lines: LINES.herdrig.herdr, blocks } : null;
  }
  return planMode(tree, "herdr");
}

/** The words of the opt-in screen for one change, so the dialog only draws them. `layout` is the layout shown now; `shipped` says it is
 *  one herdr ships (a personal copy is made first, named `copy`). Exact values are flagged `mono`. */
export function describeChange({ layout, shipped = false, copy = null, from, to, lines = [] }) {
  const target = shipped ? (copy ?? `${layout}-copy`) : layout;
  const mine = to !== "herdr";
  const title = to === "herdrig" ? "Use herdrig's Spaces list" : to === "both" ? "Add the Rig spaces block" : "Switch back to Herdr's Spaces list";
  const intro = to === "herdrig"
    ? "herdrig's copy of Herdr's Spaces list shows which spaces are rigs and offers their rig actions. Everything else works the same: click, rename, close, new space, drag to reorder, machine groups."
    : to === "both"
      ? "A second block, Rig spaces, lists only your rig spaces and the OpenRig home, with the rig marks and actions. Herdr's Spaces block stays as it is."
      : "Spaces shows Herdr's list again. Nothing else in the layout changes.";
  return {
    title, intro,
    note: shipped ? `Your current layout, ${layout}, is Herdr's own, and Herdr doesn't allow changes to it. Herdr makes a personal copy, ${target}, with the same blocks and shows it. ${layout} itself stays as it is.` : null,
    changes: [
      ["Layout", shipped ? `${target} (new, a copy of ${layout})` : `${layout} (your personal layout)`, true],
      ["Block", lines[0] ?? "", false],
    ],
    unchanged: "Nothing else in the layout changes: block order, sizes and other blocks stay as they are.",
    stays: "Herdr's own Spaces list and Herdr's shipped layouts. Your other layouts keep what they show now.",
    good: mine ? `It's a copy of Herdr's list from Herdr ${BASE_HERDR}. Herdr's later changes to its list reach it only when herdrig updates.` : null,
    wayBack: "System → Layout → Spaces list, or the palette. Choosing Herdr's puts Herdr's list back in this layout and changes nothing else. Uninstalling herdrig switches back first.",
    confirm: to === "herdr" ? "Switch back" : shipped ? (to === "herdrig" ? "Copy layout and use herdrig's list" : "Copy layout and add the block") : (to === "herdrig" ? "Use herdrig's list" : "Add the block"),
    from, to, target,
  };
}
