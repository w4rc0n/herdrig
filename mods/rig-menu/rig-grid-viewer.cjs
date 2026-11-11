// A plain tmux viewer: reuse Attach's argv validation and local private-server lookup, without OSC or HTTP polling.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const { validServerArgs, tmuxArgv, localServerArgs, termFor, tmuxFailureMessage } = require("./rig-attach-relay.cjs");
function viewerArgs(cfg) {
  const named = validServerArgs(cfg.serverArgs);
  return tmuxArgv(cfg.session, named && named.length ? named : (named ? localServerArgs(cfg.openrigHome) : cfg.serverArgs));
}
function main(payload) {
  let argv, cfg, child, parked = false;
  // Herdr keeps adopted terminals: exiting would replace this viewer with an interactive shell.
  // Keep an inert notice instead, including when stdin is closed or the tmux client exits successfully.
  const park = (message) => {
    if (parked) return; parked = true;
    process.stderr.write(`${message.trimEnd()}\nClose this pane, then reopen the rig space to retry.\n`);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.pause();
    setInterval(() => {}, 2147483647);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => {
    try { child?.kill(sig); } catch (_) {}
    process.exit(0);
  });
  try { cfg = JSON.parse(Buffer.from(String(payload || ""), "base64").toString("utf8")); argv = viewerArgs(cfg); }
  catch (e) { park(`Rig grid: ${e.message}`); return; }
  if (argv[0] === "-S" && !fs.existsSync(argv[1])) {
    park(tmuxFailureMessage(cfg.session)); return;
  }
  const env = { ...process.env }; delete env.TMUX; env.TERM = termFor(env.TERM);
  child = spawn("tmux", argv, { stdio: "inherit", env, shell: false });
  child.on("error", (e) => park(`Rig grid: tmux did not start (${e.message})\n${tmuxFailureMessage(cfg.session)}`));
  child.on("exit", (code) => park(code ? tmuxFailureMessage(cfg.session) : `The viewer for ${cfg.session} ended. Its tmux session may have stopped.`));
}
module.exports = { viewerArgs };
if (require.main === module) main(process.argv[2]);
