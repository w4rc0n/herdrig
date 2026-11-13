// Copy & edit of a built-in rig spec as a whole folder (rig.yaml + CULTURE.md + guidance/...), so the copy can launch.
// The steps are plain async functions over a `host` the page supplies, so they can be tested without a page:
//   host.specText(spec)            the daemon's YAML for a library entry
//   host.validate(text)            { ok, errors } from the daemon's own validator
//   host.addFolder(request, grant) the box (or this machine) copies the folder and rewrites the copy's agent paths
//   host.library(fresh)            the spec library list (fresh: re-index first)
//   host.rename(id, name)          the daemon renames a library spec; returns its entry
// Nothing here opens a file or runs a program: every path it sees came from the daemon and is only text.
import { copyableSpecText } from "./rig-spec-copy.js";
import { specCopyName } from "./rig-lib.js";

/** A built-in rig spec that lives in a folder of its own (rig.yaml): the only kind copied as a folder. */
export const folderCopyable = (s) => s?.sourceType === "builtin" && s?.kind === "rig" && typeof s?.sourcePath === "string" && s.sourcePath.endsWith("/rig.yaml");

/** `<name>-copy`, then `-copy-2`, `-copy-3`..., the first name no library spec has. */
export function copyDisplayName(base, taken) {
  const stem = `${specCopyName(base)}-copy`;
  for (let i = 1; i < 100; i++) {
    const name = i === 1 ? stem : `${stem}-${i}`;
    if (!taken.has(name)) return name;
  }
  throw new Error(`No free name for a copy of ${base}.`);
}

const RELATIVE_AGENT_REF = /^[ \t]*(?:-[ \t]+)?agent_ref:[ \t]*["']?local:/m;
const inCopyFolder=(file,folder)=>typeof file==='string'&&typeof folder==='string'&&folder.startsWith('/')&&folder!=='/'
  &&!/[\u0000-\u001f\u007f]/.test(file+folder)&&![...file.split('/'),...folder.split('/')].some(p=>p==='.'||p==='..')
  &&file.startsWith(folder+'/')&&/\.ya?ml$/i.test(file);

/** First copy of a built-in. Returns { ok, copy, folder } | { needsConsent, confirmation } | { ok:false, reason } | { exists, folder }. */
export async function copyBuiltinFolder(host, spec, grant = null) {
  const source = await host.specText(spec);
  const prepared = copyableSpecText(source, spec.sourcePath);
  if (prepared.refused) return { ok: false, reason: prepared.refused };
  const checked = await host.validate(prepared.text);
  if (!checked.ok) return { ok: false, reason: checked.errors?.[0] ?? "OpenRig can't validate this spec, so it wasn't copied.", errors: checked.errors };
  let result;
  try { result = await host.addFolder({ sourcePath: spec.sourcePath, content: prepared.text }, grant); }
  catch (error) { if (error?.code === "copy_exists" && typeof error.folder === "string") return { exists: true, folder: error.folder }; throw error; }
  if (result.needsConsent) return result;
  if (!result.ok) throw new Error(result.reason ?? "The copy wasn't confirmed.");
  // The copy is found by its path, never by the id `rig specs add` prints (that is the built-in's id).
  const list = await host.library(true);
  const copy = list.find((x) => x.sourceType === "user_file" && x.sourcePath === result.path);
  if (!copy) throw new Error("The copy was made, but isn't indexed yet. Refresh the library before copying again.");
  const name = copyDisplayName(spec.name, new Set(list.map((x) => x.name)));
  const renamed = await host.rename(copy.id, name);
  return { ok: true, copy: renamed ?? { ...copy, name }, folder: result.folder };
}

/** A copy folder already exists. Opens the finished copy; renames and offers the fixed text of an unfinished one.
 *  Returns { state: "finished", entry } | { state: "unfinished", entry, baseText, rewritten } | { state: "unindexed" }. */
export async function findExistingCopy(host, spec, folder) {
  const list = await host.library(true);
  const mine = list.filter((x) => x.sourceType === "user_file" && inCopyFolder(x.sourcePath,folder));
  if (!mine.length) return { state: "unindexed" };
  // An unfinished copy first: it is the one the person's earlier attempt left behind.
  for (const entry of mine) {
    let current = entry, text = await host.specText(entry);
    if (entry.name !== spec.name && !RELATIVE_AGENT_REF.test(text)) continue;
    if (entry.name === spec.name) {
      const name = copyDisplayName(spec.name, new Set(list.map((x) => x.name)));
      current = (await host.rename(entry.id, name)) ?? { ...entry, name };
      if(!inCopyFolder(current.sourcePath,folder))return{state:'unindexed',reason:"The copy's location changed. Refresh the library before opening it."};
      text = await host.specText(current); // the rename rewrote the name inside the file: fix the file as it is now
    }
    const prepared = copyableSpecText(text, current.sourcePath);
    if (prepared.refused) return { state: "unindexed", reason: prepared.refused };
    return { state: "unfinished", entry: current, baseText: text, rewritten: prepared.text };
  }
  return { state: "finished", entry: mine[0] };
}
