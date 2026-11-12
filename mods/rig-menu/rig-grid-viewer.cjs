// A plain tmux viewer: reuse Attach's argv validation and local private-server lookup, without OSC or HTTP polling.
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const { validServerArgs, tmuxArgv, localServerArgs, termFor, tmuxFailureMessage } = require("./rig-attach-relay.cjs");
function ignoreSizeArgs(version) {
  const match = /^tmux (\d+)\.(\d+)(?:[a-z]|\b)/.exec(String(version ?? "").trim());
  return match && (+match[1] > 3 || +match[1] === 3 && +match[2] >= 2) ? ["-f", "ignore-size"] : [];
}
const SIZING_INTERVAL_MS = 5000;
// tmux replaces control characters in format output; use printable separators.
const CLIENT_FORMAT = "#{client_pid}|#{client_tty}|#{client_flags}";
const runTmux = args => new Promise((resolve,reject)=>{
  const env={...process.env};delete env.TMUX;
  const command=spawn("tmux",args,{stdio:["ignore","pipe","pipe"],shell:false,env});
  let stdout="",stderr="",settled=false;
  const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve({stdout});};
  const timer=setTimeout(()=>{command.kill("SIGKILL");finish(new Error("tmux metadata timed out"));},1000);
  command.stdout.on("data",data=>{stdout+=data;if(stdout.length>65536){command.kill("SIGKILL");finish(new Error("tmux metadata too large"));}});
  command.stderr.on("data",data=>{stderr=(stderr+data).slice(0,4096);});
  command.on("error",finish);command.on("close",code=>finish(code===0?null:new Error(stderr||"tmux metadata failed")));
});
function sizingClients(stdout) {
  return String(stdout ?? "").trim().split("\n").flatMap(line => {
    const [pid,tty,flags] = line.split("|");
    return /^[1-9][0-9]*$/.test(pid) && /^\/dev\/(?:pts\/[0-9]+|tty[a-zA-Z0-9]+)$/.test(tty ?? "")
      ? [{pid:Number(pid),tty,ignore:String(flags ?? "").split(",").includes("ignore-size")}] : [];
  });
}
function sizingChange(stdout, ownPid) {
  const clients=sizingClients(stdout), own=clients.find(c=>c.pid===ownPid);
  if(!own)return null;
  const ignore=clients.some(c=>c.pid!==ownPid&&!c.ignore);
  return own.ignore===ignore?null:{tty:own.tty,ignore};
}
function viewerArgs(cfg, version, clients = "") {
  const named = validServerArgs(cfg.serverArgs);
  const argv = tmuxArgv(cfg.session, named && named.length ? named : (named ? localServerArgs(cfg.openrigHome) : cfg.serverArgs));
  if(sizingClients(clients).some(c=>!c.ignore))argv.splice(argv.indexOf("attach-session") + 1, 0, ...ignoreSizeArgs(version));
  return argv;
}
async function main(payload) {
  let argv, cfg, child, parked = false;
  let sizingTimer, resizeTimer, sizingBusy=false, sizingSupported=false;
  // Herdr keeps adopted terminals: exiting would replace this viewer with an interactive shell.
  // Keep an inert notice instead, including when stdin is closed or the tmux client exits successfully.
  const park = (message) => {
    if (parked) return; parked = true;
    clearInterval(sizingTimer);clearTimeout(resizeTimer);
    process.stderr.write(`${message.trimEnd()}\nClose this pane, then reopen the rig space to retry.\n`);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.pause();
    setInterval(() => {}, 2147483647);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => {
    try { child?.kill(sig); } catch (_) {}
    process.exit(0);
  });
  try {
    cfg = JSON.parse(Buffer.from(String(payload || ""), "base64").toString("utf8"));
    argv = viewerArgs(cfg, null); // Validate before probing anything.
    // One bounded startup probe (up to 3 s), never repeated by the sizing timer.
    const version = spawnSync("tmux", ["-V"], { encoding: "utf8", timeout: 3000, shell: false });
    const value=version.status===0?version.stdout:null;sizingSupported=ignoreSizeArgs(value).length>0;
    let clients="";
    if(sizingSupported){try{clients=(await runTmux([...argv.slice(0,argv.indexOf("attach-session")),"list-clients","-t",`=${cfg.session}`,"-F",CLIENT_FORMAT])).stdout;}catch{}}
    argv = viewerArgs(cfg, value, clients);
  }
  catch (e) { park(`Rig grid: ${e.message}`); return; }
  if (argv[0] === "-S" && !fs.existsSync(argv[1])) {
    park(tmuxFailureMessage(cfg.session)); return;
  }
  const env = { ...process.env }; delete env.TMUX; env.TERM = termFor(env.TERM);
  child = spawn("tmux", argv, { stdio: "inherit", env, shell: false });
  // Only this wrapper's child PID is eligible. Its inherited tty remains held by
  // this live wrapper, and tmux targets client tty names exactly (no prefix match).
  const server=argv.slice(0,argv.indexOf("attach-session"));
  let sizingError=false,lastSizingAt=0;
  const reconcile=async()=>{
    if(sizingBusy||parked||child.exitCode!==null||Date.now()-lastSizingAt<1000)return;
    sizingBusy=true;lastSizingAt=Date.now();
    try{
      const result=await runTmux([...server,"list-clients","-t",`=${cfg.session}`,"-F",CLIENT_FORMAT]);
      const change=sizingChange(result.stdout,child.pid);
      if(change&&!parked&&child.exitCode===null)await runTmux([...server,"refresh-client","-t",change.tty,"-f",change.ignore?"ignore-size":"!ignore-size"]);
      sizingError=false;
    }catch{
      if(!sizingError&&!parked){process.stderr.write("Grid sizing could not be refreshed; reopen this tile to retry.\n");sizingError=true;}
    }finally{sizingBusy=false;}
  };
  if(sizingSupported){
    sizingTimer=setInterval(reconcile,SIZING_INTERVAL_MS);
    process.on("SIGWINCH",()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(reconcile,250);});
  }
  child.on("error", (e) => park(`Rig grid: tmux did not start (${e.message})\n${tmuxFailureMessage(cfg.session)}`));
  child.on("exit", (code) => park(code ? tmuxFailureMessage(cfg.session) : `The viewer for ${cfg.session} ended. Its tmux session may have stopped.`));
}
module.exports = { viewerArgs, ignoreSizeArgs, sizingClients, sizingChange, SIZING_INTERVAL_MS };
if (require.main === module) main(process.argv[2]);
