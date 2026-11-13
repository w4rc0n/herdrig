// Copy & edit of a built-in spec (pure functions: text in, text out; no file, no network, no host call).
//
// A built-in rig spec names its agents relative to its own folder (`agent_ref: "local:../../../agents/development/qa"`),
// and OpenRig resolves `local:` against the directory of the spec file being launched. A copy in the user's library
// sits somewhere else, so those refs find nothing and OpenRig's preflight refuses the copy. OpenRig's own hint for this
// is "keep the agents/ tree beside the rig YAML, or switch those refs to path:/absolute/path". `copyableSpecText` does the
// second: each relative `local:` ref becomes the `path:` ref of the same folder, worked out as text from the directory of
// the spec's `sourcePath` (a string the daemon listed over HTTP: it is never opened here).
//
// Other files a built-in names beside itself (`culture_file`, startup file paths, `compose_file`) must stay relative
// in OpenRig, so they cannot be pointed back at the built-in; `siblingFileNames` finds them so the person can be told.

const REF_LINE = /^(\s*(?:-\s+)?agent_ref:[ \t]*)(?:"local:([^"\r\n]*)"|'local:([^'\r\n]*)'|local:([^\s"'#]+))([ \t]*(?:#.*)?)$/;
// A value that is plain in YAML after `agent_ref:` (no space, no `#`, no quote, no `: `).
const PLAIN = /^[A-Za-z0-9._\/@+=,:-]+$/;
const UNSAFE_CHAR = /[\u0000-\u001f\u007f-\u009f\u2028\u2029"\\]/;

/** The directory of an absolute path, or null when the path can't be used. */
function directoryOf(sourcePath) {
  if (typeof sourcePath !== "string" || !sourcePath.startsWith("/") || UNSAFE_CHAR.test(sourcePath)) return null;
  const at = sourcePath.lastIndexOf("/");
  return at <= 0 ? "/" : sourcePath.slice(0, at);
}

/** `rel` against `base`, both POSIX, as text. Null if it would climb above the root. */
function resolvePosix(base, rel) {
  const out = [];
  for (const seg of `${base}/${rel}`.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (!out.length) return null; out.pop(); continue; }
    out.push(seg);
  }
  return `/${out.join("/")}`;
}

/**
 * The text of a copy of a spec whose file is `sourcePath`, with every relative `local:` agent_ref made absolute.
 * Returns { text, rewritten, refused }. When a ref can't be rewritten safely (no usable `sourcePath`, a ref with a
 * backslash or control character, a ref that climbs above the root) the text is returned unchanged and `refused`
 * says why: the caller must not write a copy that is silently broken.
 */
export function copyableSpecText(text, sourcePath) {
  const parts = String(text).split(/(\r?\n)/);
  const dir = directoryOf(sourcePath);
  let rewritten = 0;
  let refused = null;
  const out = parts.map((line, i) => {
    if (i % 2 === 1) return line; // a line terminator
    const m = REF_LINE.exec(line);
    if (!m) return line;
    const rel = m[2] ?? m[3] ?? m[4];
    if (!rel || rel.startsWith("/")) return line; // not a relative ref: OpenRig's own validation reports it
    if (!dir) { refused ??= "This spec's location isn't known, so its agents can't be found from a copy. Nothing was copied."; return line; }
    if (UNSAFE_CHAR.test(rel)) { refused ??= "An agent reference in this spec has a character a copy can't carry safely. Nothing was copied."; return line; }
    const abs = resolvePosix(dir, rel);
    if (!abs) { refused ??= "An agent reference in this spec points above the top of the file system, so a copy can't find it. Nothing was copied."; return line; }
    const value = `path:${abs}`;
    const quote = m[2] !== undefined ? '"' : m[3] !== undefined ? "'" : "";
    const written = PLAIN.test(value) ? `${quote}${value}${quote}` : `"${value}"`;
    rewritten++;
    return `${m[1]}${written}${m[5]}`;
  });
  return refused ? { text: String(text), rewritten: 0, refused } : { text: out.join(""), rewritten, refused: null };
}

const KEY_VALUE = (key) => new RegExp(`^(\\s*)(?:-\\s+)?${key}:[ \\t]*(?:"([^"\\r\\n]*)"|'([^'\\r\\n]*)'|([^\\s"'#][^\\r\\n#]*?))[ \\t]*(?:#.*)?$`);
const CULTURE = KEY_VALUE("culture_file");
const COMPOSE = KEY_VALUE("compose_file");
const STARTUP = /^(\s*)startup:[ \t]*(?:#.*)?$/;
const PATH_ITEM = KEY_VALUE("path");

/** A name OpenRig accepts for a file beside a spec: relative, no `..`, no control characters. */
function safeRelative(name) {
  if (typeof name !== "string" || !name.length || name.length > 240 || name.startsWith("/") || UNSAFE_CHAR.test(name)) return false;
  return !name.split("/").some((seg) => seg === ".." || seg === "");
}

/** The files a spec names beside itself: `culture_file`, `compose_file` and the `path:` of each startup file, in order, once each. */
export function siblingFileNames(text) {
  const names = [];
  const add = (m) => { const name = m?.[2] ?? m?.[3] ?? m?.[4]; if (name !== undefined && safeRelative(name) && !names.includes(name)) names.push(name); };
  const lines = String(text).split(/\r?\n/);
  let startupIndent = null;
  for (const line of lines) {
    const blank = !line.trim() || line.trim().startsWith("#");
    const indent = line.length - line.trimStart().length;
    if (startupIndent !== null && !blank && indent <= startupIndent) startupIndent = null;
    const startup = STARTUP.exec(line);
    if (startup) { startupIndent = startup[1].length; continue; }
    if (blank) continue;
    if (startupIndent !== null) { add(PATH_ITEM.exec(line)); continue; }
    add(CULTURE.exec(line));
    add(COMPOSE.exec(line));
  }
  return names;
}

/** What to tell the person about files a copy lacks, or null when there are none. */
export function siblingFileNote(files) {
  if (!Array.isArray(files) || !files.length) return null;
  const many = files.length > 1;
  return `This copy names ${files.join(", ")}, which ${many ? "live" : "lives"} beside the built-in, not in your library. `
    + `It will not launch until ${many ? "they exist" : "it exists"} beside it. `
    + `Copy ${many ? "them" : "it"} next to this spec, or remove the ${many ? "lines" : "line"} that name${many ? "" : "s"} ${many ? "them" : "it"}.`;
}
