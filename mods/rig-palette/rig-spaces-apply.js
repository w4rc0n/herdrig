// Applies a Spaces-list change to the person's PERSONAL layout, in the order the opt-in screen promised:
//   1. re-read the layout; if it is not the one the screen showed, stop ("Your layout changed. Review it again.");
//   2. a layout herdr ships is cloned first (herdr's own layout.clone, which shows the copy), and the change goes in the copy;
//   3. the way back is recorded, then 4. the whole tree is sent with layout.set, and 5. read back and compared with the tree
//      that was planned. A difference (a concurrent edit) is planned again once; if it still differs, the layout is restored to
//      what was read and nothing is claimed.
// herdrig never edits `mods/spaces` or a shipped layout file and never switches the person to another layout (the clone in step 2
// is the one exception, named on the screen). `host` supplies layout(), layoutName(), layouts(), run(), wait(ms), writeState(state).
import { planMode, sameTree, isShippedLayout, BASE_HERDR } from "./rig-spaces-mode.js";

const SETTLE_MS = 200, SETTLE_TRIES = 15;

async function settled(host, ready) {
  for (let i = 0; i < SETTLE_TRIES; i++) {
    if (ready()) return true;
    await host.wait(SETTLE_MS);
  }
  return ready();
}

export const freeCopyName = (name, existing) => {
  const taken = new Set(existing ?? []);
  for (let i = 1; i < 100; i++) { const candidate = i === 1 ? `${name}-copy` : `${name}-copy-${i}`; if (!taken.has(candidate)) return candidate; }
  return null;
};

/** Returns { ok: true, layout, cloned, plan } or { ok: false, reason, stale?, restored? }. `shown` is { layout, tree }: what the screen showed. */
export async function applySpacesMode(host, shown, target) {
  const name = host.layoutName(), tree = host.layout();
  if (name !== shown.layout || !sameTree(tree, shown.tree)) return { ok: false, stale: true, reason: "Your layout changed. Review it again." };
  let working = name, workingTree = tree, cloned = null;
  if (isShippedLayout(name)) {
    const copy = freeCopyName(name, host.layouts?.());
    if (!copy) return { ok: false, reason: "Couldn't name a copy of your layout. Nothing was changed." };
    host.run("layout.clone", { name, as: copy });
    const ready = await settled(host, () => host.layoutName() === copy && !!host.layout());
    if (!ready) return { ok: false, reason: "Herdr didn't show the copy of your layout, so nothing was changed in it." };
    cloned = copy; working = copy; workingTree = host.layout();
  }
  let plan = planMode(workingTree, target);
  if (!plan.ok) return { ok: false, reason: plan.reason, cloned };
  // The way back first: a crash between here and the change still leaves a record of what was meant.
  await host.writeState({ layout: working, cloned, from: plan.from, to: plan.to, at: Date.now(), base: BASE_HERDR });
  for (let attempt = 1; attempt <= 2; attempt++) {
    host.run("layout.set", { layout: plan.tree });
    if (await settled(host, () => host.layoutName() === working && sameTree(host.layout(), plan.tree))) return { ok: true, layout: working, cloned, plan };
    if (attempt === 1) {
      const again = planMode(host.layout() ?? workingTree, target);
      if (!again.ok) break;
      plan = again;
    }
  }
  // Put back what was read, then LOOK before saying so: "Nothing was changed" is only said when the read-back matches.
  let back = false;
  if (host.layoutName() === working) {
    host.run("layout.set", { layout: workingTree });
    back = await settled(host, () => host.layoutName() === working && sameTree(host.layout(), workingTree));
  }
  const made = cloned ? ` The copy ${cloned} was made and is shown; ${name} itself is as it was.` : "";
  return back
    ? { ok: false, restored: true, cloned, reason: `Couldn't change the layout safely. Nothing was changed${cloned ? ` in ${working}` : ""}.${made}` }
    : { ok: false, restored: false, cloned, reason: `Couldn't change the layout safely, and couldn't confirm it is back as it was.${made} Check it in System → Layout.` };
}
