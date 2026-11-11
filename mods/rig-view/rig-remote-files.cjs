// Local stdin bridge for Herdr's public `hc file write` CLI. No shell, no daemon values.
"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const RELAY_SHA256 = "a82da5dfb3d37644316bb36ad24102483473dad66ae9961d2709958ab5e81270";
const RELAY_FOLDER = ".local/share/herdr-openrig";
const goodHome = (s) => typeof s === "string" && s.startsWith("/") && s !== "/" && !/[\x00-\x1f\x7f]/.test(s) && s.split("/").slice(1).every((p) => p && p !== "." && p !== "..");
const line = (value) => String(value ?? "").replace(/\r?\n$/, "");
function inspectRemote(run, expectedHome = null) {
  const output = (cmd, args) => {
    const result = run(cmd, args);
    if (result?.code !== 0) throw new Error(result?.stderr || `Remote ${cmd} failed.`);
    return line(result.stdout);
  };
  const test = (flag, file) => {
    const result = run("test", [flag, file]);
    if (result?.code !== 0 && result?.code !== 1) throw new Error(result?.stderr || "Remote path check failed.");
    return result.code === 0;
  };
  const home = output("printenv", ["HOME"]);
  if (!goodHome(home) || (expectedHome !== null && home !== expectedHome)) throw new Error("Invalid or changed remote home.");
  if (output("readlink", ["-f", "--", home]) !== home || !test("-d", home)) throw new Error("Refused symlinked or invalid remote home.");
  let current = home, sha256 = null;
  const parts = [".local", "share", "herdr-openrig", "rig-attach-relay.cjs"];
  for (let i = 0; i < parts.length; i++) {
    current += "/" + parts[i];
    if (test("-L", current)) throw new Error("Refused relay path: symlink.");
    if (test("-e", current)) {
      if (!test(i === parts.length - 1 ? "-f" : "-d", current)) throw new Error("Refused relay path: unexpected file type.");
      if (output("readlink", ["-f", "--", current]) !== current) throw new Error("Refused symlinked relay path.");
      if (i === parts.length - 1) {
        const hash = output("sha256sum", ["--", current]);
        if (!/^[a-f0-9]{64} [ *]/.test(hash)) throw new Error("Invalid remote relay hash.");
        sha256 = hash.slice(0, 64);
      }
    }
  }
  return { home, path: current, sha256 };
}
function shippedBytes() {
  const p = path.join(__dirname, "rig-attach-relay.cjs");
  if (!fs.lstatSync(p).isFile() || fs.lstatSync(p).isSymbolicLink()) throw new Error("The shipped relay must be a regular file.");
  const bytes = fs.readFileSync(p);
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== RELAY_SHA256) throw new Error("The shipped relay differs from this release. Reinstall the mod.");
  return bytes;
}
function install(machine, home, run = spawnSync) {
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(machine ?? "") || !goodHome(home)) throw new Error("Refused invalid machine or remote home.");
  const dest = path.posix.join(home, RELAY_FOLDER, "rig-attach-relay.cjs");
  const bytes = shippedBytes();
  const invoke = (args, input) => {
    const result = run("hc", args, { ...(input ? { input } : {}), encoding: "utf8", shell: false, timeout: 30000, maxBuffer: 1024 * 1024 });
    if (result.error) throw new Error(result.error.message);
    return result;
  };
  const hc = (args, input) => {
    const result = invoke(args, input);
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || "Remote relay operation failed.");
    return result.stdout;
  };
  const body = JSON.parse(hc(["machine", "ls", "--json"]));
  const rows = Array.isArray(body) ? body : body.machines;
  const record = Array.isArray(rows) && rows.find((m) => m.name === machine);
  if (!record || record.temporary !== false || record.state !== "connected") throw new Error("Remote relay requires a connected persistent Herdr machine.");
  const inspect = () => {
    const info = inspectRemote((cmd, args) => {
      const r = invoke(["exec", "--on", machine, "--", cmd, ...args]);
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    }, home);
    if (info.home !== home || info.path !== dest) throw new Error("Remote relay destination changed.");
    return info;
  };
  inspect(); // Last operation before the public write, including parent and destination lstat checks.
  hc(["file", "write", "--on", machine, "--json", "--", dest], bytes);
  if (inspect().sha256 !== RELAY_SHA256) throw new Error("Remote relay verification failed.");
  return { path: dest, sha256: RELAY_SHA256 };
}
if (require.main === module) {
  try {
    const [mode, machine, home] = process.argv.slice(2);
    const result = mode === "inspect" ? { sha256: crypto.createHash("sha256").update(shippedBytes()).digest("hex") }
      : mode === "install" ? install(machine, home) : (() => { throw new Error("Unknown relay-file operation."); })();
    console.log(JSON.stringify(result));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { RELAY_SHA256, RELAY_FOLDER, inspectRemote, goodHome, shippedBytes, install };
