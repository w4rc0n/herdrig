// Reads the person's herdr-core shell setting, never daemon data. Public contract:
// herdr-core docs/security.md ("Paths"): ~/.config/herdr-core/config.toml, overridden by XDG_CONFIG_HOME;
// docs/commands.md (Settings) names that same user-owned file.
"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
// A conservative parser for a top-level TOML string array. Unsupported syntax fails closed.
function configuredShell(text) {
  const match = /^\s*shell\s*=\s*(\[[\s\S]*)/m.exec(text);
  if (!match || /^\s*\[[^\n]*\]/m.test(text.slice(0, match.index))) return null;
  const source = match[1]; let i = 1; const argv = [];
  const skip = () => { for (;;) { while (/\s/.test(source[i] ?? "") && i < source.length) i++; if (source[i] !== "#") return; while (i < source.length && source[i] !== "\n") i++; } };
  for (;;) {
    skip(); if (source[i] === "]") return argv.length && argv[0] ? argv : null;
    const quote = source[i]; if (quote !== '"' && quote !== "'") return null;
    const start = i++; let escaped = false;
    while (i < source.length) { const c = source[i++]; if (!escaped && c === quote) break; if (quote === '"' && !escaped && c === "\\") escaped = true; else escaped = false; }
    if (source[i - 1] !== quote) return null;
    const token = source.slice(start, i); let value;
    try { value = quote === '"' ? JSON.parse(token) : token.slice(1, -1); } catch { return null; }
    if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value)) return null;
    argv.push(value); skip(); if (source[i] === "]") return argv[0] ? argv : null;
    if (source[i++] !== ",") return null;
  }
}
function readShell(env = process.env) {
  const folder = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  let fd;
  try {
    const file = path.join(folder, "herdr-core", "config.toml");
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd), limit = 1048576;
    if (!stat.isFile() || stat.size > limit) return null;
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > limit) return null;
    const text = bytes.subarray(0, length).toString("utf8");
    if (/^\s*shell\s*=/m.test(text)) return configuredShell(text);
  } catch (e) { if (e.code !== "ENOENT") return null; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  // Without an explicit setting, leave recognition to the controller's common-shell fallback.
  return null;
}
if (require.main === module) console.log(JSON.stringify(readShell()));
module.exports = { configuredShell, readShell };
