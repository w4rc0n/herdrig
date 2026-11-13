"use strict";
// Runs only on the configured machine. Roots are derived here, never authorised by host input.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const MAX_BYTES = 1024 * 1024;
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const absolute = s => typeof s === "string" && Buffer.byteLength(s) <= 4096 && s.startsWith("/") && s !== "/"
  && !/[\x00-\x1f\x7f]/.test(s) && s.split("/").slice(1).every(p => p && p !== "." && p !== "..");
const targetName = s => absolute(s) && /\.ya?ml$/i.test(s);
const failure = (message, code = "refused", extra = {}) => Object.assign(new Error(message), { code }, extra);
function utf8(bytes) {
  if (bytes.length > MAX_BYTES) throw failure("The spec exceeds 1 MiB.");
  const text = bytes.toString("utf8");
  if (!Buffer.from(text,"utf8").equals(bytes) || text.includes("\0")) throw failure("The spec must be UTF-8 text without binary bytes.");
  return text;
}
function rootState({ io = fs, run = spawnSync, home = process.env.HOME, searchPath = process.env.PATH } = {}) {
  if (!absolute(home) || typeof searchPath !== "string" || !searchPath || /[\x00-\x1f\x7f]/.test(searchPath)) throw failure("Invalid box home or executable search path.");
  const r = run("rig", ["config","get","workspace.specs_root","--json"], {
    env:{HOME:home,PATH:searchPath}, encoding:"utf8", shell:false, timeout:15000, maxBuffer:65536 });
  if (r.error || r.status !== 0) throw failure("Couldn't read the box's spec folders. Check rig config on that machine.");
  let configured;try { configured=JSON.parse(r.stdout).value; } catch { throw failure("Invalid box spec-folder response."); }
  let packageRoot=null;
  try{
    const found=run("which",["rig"],{env:{HOME:home,PATH:searchPath},encoding:"utf8",shell:false,timeout:5000,maxBuffer:65536});
    if(found.status===0){
      let dir=path.posix.dirname(io.realpathSync(String(found.stdout).trim()));
      for(;;){
        try{if(JSON.parse(io.readFileSync(path.posix.join(dir,"package.json"),"utf8")).name==="@openrig/cli"){packageRoot=dir;break;}}catch{}
        const next=path.posix.dirname(dir);if(next===dir)break;dir=next;
      }
    }
  }catch{}
  const roots=[],rejected=[];
  for (const candidate of [path.posix.join(home,".openrig/specs"),configured].filter(Boolean)) {
    try {
      if(!absolute(candidate))throw failure("Invalid or broad box spec folder.");
      const real=io.realpathSync(candidate);
      if(!absolute(real)||real===io.realpathSync(home)||real.split("/").includes("node_modules")
        ||packageRoot&&(real===packageRoot||real.startsWith(packageRoot+"/"))||!io.statSync(real).isDirectory())
        throw failure("Refused a broad, built-in or non-directory spec folder.");
      roots.push(real);
    }catch(e){rejected.push({path:candidate,reason:e.code==="ENOENT"?"The folder does not exist.":String(e.message??e).replace(/[\r\n]+/g," ")});}
  }
  if (!roots.length) throw failure("No spec folder exists on this machine. Create its OpenRig user spec folder first.");
  return {roots:[...new Set(roots)],rejected};
}
const rootsFor=options=>rootState(options).roots;
function safeParent(target, roots, io) {
  if(!targetName(target))throw failure("Refused: use one absolute .yaml or .yml path without traversal or control characters.");
  const parent=path.posix.dirname(target);
  let current="";
  for(const part of parent.split("/").slice(1)){
    current+="/"+part;const st=io.lstatSync(current);
    if(st.isSymbolicLink()||!st.isDirectory())throw failure("Refused a symlink or non-directory in the spec path.");
  }
  const real=io.realpathSync(parent);
  if(real!==parent || !roots.some(root=>real===root||real.startsWith(root+"/")))throw failure("The spec is outside this machine's user spec folders.");
  return parent;
}
function readFd(fd, io) {
  const st=io.fstatSync(fd);if(!st.isFile()||st.size>MAX_BYTES)throw failure("The spec must be a regular UTF-8 file of at most 1 MiB.");
  const buffer=Buffer.alloc(MAX_BYTES+1);let used=0,n;
  while((n=io.readSync(fd,buffer,used,buffer.length-used,used))>0){used+=n;if(used>MAX_BYTES)throw failure("The spec exceeds 1 MiB.");}
  const bytes=buffer.subarray(0,used);utf8(bytes);return bytes;
}
function same(a,b){return a.dev===b.dev&&a.ino===b.ino&&a.isFile()&&b.isFile();}

// Copy & edit of a built-in: OpenRig's own `rig specs add` copies the built-in's whole folder (rig.yaml, CULTURE.md, guidance/...).
// Everything that selects what is copied is derived HERE from the executable actually run; the request supplies only the
// built-in rig.yaml path, and that path is accepted only when it is a real file in a real folder inside this machine's own
// installed @openrig/cli (public shipped content), with no symlink on the way.
function packageRootOf(rigReal, io) {
  let dir = path.posix.dirname(rigReal);
  for (;;) {
    try { if (JSON.parse(io.readFileSync(path.posix.join(dir, "package.json"), "utf8")).name === "@openrig/cli") return dir; } catch {}
    const next = path.posix.dirname(dir); if (next === dir) return null; dir = next;
  }
}
function installedRig({ io, run, home, searchPath }) {
  const found = run("which", ["rig"], { env: { HOME: home, PATH: searchPath }, encoding: "utf8", shell: false, timeout: 5000, maxBuffer: 65536 });
  if (found.error || found.status !== 0) throw failure("OpenRig's rig command wasn't found on this machine.");
  const exe = io.realpathSync(String(found.stdout).trim());
  if (!absolute(exe)) throw failure("OpenRig's rig command has an unusable path.");
  const pkg = packageRootOf(exe, io);
  if (!pkg) throw failure("The rig command isn't from an installed @openrig/cli package, so its built-in specs can't be located.");
  return { exe, builtinRoot: io.realpathSync(path.posix.join(pkg, "daemon/specs")) };
}
/** The built-in folder named by `sourcePath` (a built-in's rig.yaml), or a refusal. Takes nothing else from the request. */
function builtinFolder(sourcePath, builtinRoot, io) {
  if (!absolute(sourcePath) || !sourcePath.endsWith("/rig.yaml")) throw failure("Refused: a built-in is named by the absolute path of its rig.yaml.");
  const folder = path.posix.dirname(sourcePath);
  if (!folder.startsWith(builtinRoot + "/")) throw failure("That spec isn't a built-in of this machine's OpenRig install.");
  let current = builtinRoot;
  for (const part of folder.slice(builtinRoot.length + 1).split("/")) {
    current += "/" + part;
    const st = io.lstatSync(current);
    if (st.isSymbolicLink() || !st.isDirectory()) throw failure("Refused a symlink or non-directory in the built-in's path.");
  }
  if (io.realpathSync(folder) !== folder) throw failure("The built-in's folder isn't its own real path.");
  const yaml = io.lstatSync(sourcePath);
  if (yaml.isSymbolicLink() || !yaml.isFile()) throw failure("The built-in's rig.yaml must be a regular file.");
  return folder;
}
function copyFolder(sourcePath, input, options, io, roots) {
  const run = options.run ?? spawnSync, home = options.home ?? process.env.HOME, searchPath = options.searchPath ?? process.env.PATH;
  if (input?.expectedRoots !== undefined && JSON.stringify(input.expectedRoots) !== JSON.stringify(roots))
    throw failure("The spec folders changed. Review the permission again.", "roots_changed");
  const { exe, builtinRoot } = installedRig({ io, run, home, searchPath });
  const folder = builtinFolder(sourcePath, builtinRoot, io);
  // The destination is the helper's to check, never the CLI's: the library only looks in the user's own spec folders.
  let userRoot;
  try { userRoot = io.realpathSync(path.posix.join(home, ".openrig/specs")); } catch { userRoot = null; }
  if (!userRoot || !roots.includes(userRoot)) throw failure("This machine's OpenRig keeps its specs somewhere other than the default spec folder in its home folder, so a built-in's folder isn't copied.");
  const dest = path.posix.join(userRoot, path.posix.basename(folder));
  try { io.lstatSync(dest); throw failure("A copy of this built-in already exists.", "copy_exists", { folder: dest }); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  const r = run(exe, ["specs", "add", "--json", "--", folder], { env: { HOME: home, PATH: searchPath }, encoding: "utf8", shell: false, timeout: 120000, maxBuffer: 262144 });
  if (r.error || r.status !== 0) throw failure(String(r.stderr || r.stdout || "OpenRig could not add the built-in's folder.").replace(/[\r\n\x00-\x1f\x7f]+/g, " ").trim().slice(0, 300));
  let printed; try { printed = JSON.parse(r.stdout).path; } catch { throw failure("OpenRig's answer to specs add wasn't readable."); }
  // Trust only what is on disk where we expect it, not the CLI's words.
  if (typeof printed !== "string" || io.realpathSync(printed) !== dest) throw failure("OpenRig put the copy somewhere unexpected. Nothing more was done.");
  const folderStat = io.lstatSync(dest);
  if (folderStat.isSymbolicLink() || !folderStat.isDirectory()) throw failure("The copied folder isn't a regular folder.");
  const file = path.posix.join(dest, "rig.yaml"), fileStat = io.lstatSync(file);
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) throw failure("The copy's rig.yaml isn't a regular file.");
  const copied = io.readFileSync(file); utf8(copied);
  if (typeof input?.content !== "string") return { ok: true, folder: dest, path: file, sha256: hash(copied) };
  // The one rewrite (agent paths made absolute): only when the copy is exactly the built-in's rig.yaml.
  if (!io.readFileSync(sourcePath).equals(copied)) throw failure("The copied rig.yaml differs from the built-in's, so it wasn't rewritten.", "refused", { folder: dest });
  return operation("save", file, { content: input.content, expectedSha256: hash(copied), expectedRoots: roots }, options);
}
function operation(verb,target,input,options={}) {
  const io=options.io??fs,{roots,rejected}=rootState(options);
  if(verb==="roots") {if(target!==undefined)throw failure("roots takes no target.");return{ok:true,roots,rejected};}
  if(verb==="copy-folder")return copyFolder(target,input,options,io,roots);
  if(!["save","copy"].includes(verb))throw failure("Unknown spec-helper operation.");
  const parent=safeParent(target,roots,io);
  if(!input||typeof input!=="object"||Array.isArray(input)||typeof input.content!=="string")throw failure("Missing spec content.");
  const bytes=Buffer.from(input.content,"utf8");if(bytes.toString("utf8")!==input.content)throw failure("Invalid UTF-8 spec content.");utf8(bytes);
  // Compare consent roots only; these never grant containment authority.
  if(JSON.stringify(input.expectedRoots)!==JSON.stringify(roots))throw failure("The spec folders changed. Review spec-save permission again.","roots_changed");
  if(!Number.isInteger(io.constants.O_NOFOLLOW))throw failure("This machine cannot safely open spec files.");
  const nofollow=io.constants.O_NOFOLLOW, nonblock=io.constants.O_NONBLOCK;
  let fd=null,temp=null,created=null;
  try{
    if(verb==="copy"){
      for(const root of roots){try{io.lstatSync(path.posix.join(root,path.posix.basename(target)));throw failure("That copy name already exists. Choose the next copy name.","copy_exists");}catch(e){if(e.code!=="ENOENT")throw e;}}
      fd=io.openSync(target,io.constants.O_WRONLY|io.constants.O_CREAT|io.constants.O_EXCL|nofollow|nonblock,0o600);
      created=io.fstatSync(fd);if(!created.isFile())throw failure("The copy is not a regular file.");
      io.writeFileSync(fd,bytes);io.fsyncSync(fd);
      if(!same(created,io.lstatSync(target)))throw failure("The copy changed during creation.","conflict");
      return{ok:true,path:target,sha256:hash(bytes)};
    }
    if(!/^[a-f0-9]{64}$/.test(input.expectedSha256??""))throw failure("Missing loaded-content hash.");
    const before=io.lstatSync(target);if(before.isSymbolicLink()||!before.isFile())throw failure("The spec must be a regular file, never a symlink or device.");
    fd=io.openSync(target,io.constants.O_RDONLY|nofollow|nonblock);
    const opened=io.fstatSync(fd);if(!same(before,opened))throw failure("The spec changed; reload before saving.","conflict");
    if(hash(readFd(fd,io))!==input.expectedSha256)throw failure("The spec changed; reload before saving.","conflict");
    temp=path.posix.join(parent,`.herdr-spec-${crypto.randomBytes(16).toString("hex")}.tmp`);
    const out=io.openSync(temp,io.constants.O_WRONLY|io.constants.O_CREAT|io.constants.O_EXCL|nofollow,opened.mode&0o777);
    try{io.fchmodSync(out,opened.mode&0o777);io.writeFileSync(out,bytes);io.fsyncSync(out);}finally{io.closeSync(out);}
    safeParent(target,roots,io);
    if(!same(opened,io.lstatSync(target))||!same(opened,io.fstatSync(fd))||hash(readFd(fd,io))!==input.expectedSha256)
      throw failure("The spec changed; reload before saving.","conflict");
    io.renameSync(temp,target);temp=null;
    const dir=io.openSync(parent,io.constants.O_RDONLY);try{io.fsyncSync(dir);}finally{io.closeSync(dir);}
    return{ok:true,path:target,sha256:hash(bytes)};
  }catch(e){
    if(verb==="copy"&&created){try{if(same(created,io.lstatSync(target)))io.unlinkSync(target);}catch{}}
    if(e.code==="EEXIST")throw failure("That copy name already exists.","copy_exists");
    throw e;
  }finally{if(fd!==null)io.closeSync(fd);if(temp)try{io.unlinkSync(temp);}catch{}}
}
function parseArgs(args){
  if(args.length===1&&args[0]==="roots")return{verb:"roots"};
  // copy-folder -- <rig.yaml>          the box: expected roots and the rewritten text arrive on stdin
  // copy-folder --local -- <rig.yaml>  this computer: no stdin, no consent roots (the person's own machine and CLI)
  if(args[0]==="copy-folder"){
    const local=args[1]==="--local",rest=local?args.slice(2):args.slice(1);
    if(rest.length!==2||rest[0]!=="--"||!targetName(rest[1])||!rest[1].endsWith("/rig.yaml"))throw failure("Expected copy-folder, optionally --local, then -- and one absolute rig.yaml path.");
    return{verb:"copy-folder",target:rest[1],local};
  }
  if(args.length!==3||!["save","copy"].includes(args[0])||args[1]!=="--"||!targetName(args[2]))throw failure("Expected save or copy, then -- and one absolute YAML target.");
  return{verb:args[0],target:args[2]};
}
if(require.main===module){
  try{
    const parsed=parseArgs(process.argv.slice(2)),{verb,target}=parsed;let input;
    // A local copy-folder reads no stdin (the page's exec can't supply one); every other verb but roots does.
    if(verb!=="roots"&&!(verb==="copy-folder"&&parsed.local)){
      const chunks=[];let size=0;const buf=Buffer.alloc(8192);let n;
      while((n=fs.readSync(0,buf,0,buf.length,null))>0){size+=n;if(size>6*MAX_BYTES+65536)throw failure("Spec input is too large.");chunks.push(Buffer.from(buf.subarray(0,n)));}
      const raw=Buffer.concat(chunks),text=raw.toString("utf8");if(!Buffer.from(text).equals(raw))throw failure("Invalid UTF-8 input.");input=JSON.parse(text);
    }
    console.log(JSON.stringify(operation(verb,target,input)));
  }catch(e){console.log(JSON.stringify({error:String(e.message??e).replace(/[\r\n\x00-\x1f\x7f]+/g," "),code:e.code??"refused",...(typeof e.folder==="string"?{folder:e.folder}:{})}));process.exitCode=1;}
}
module.exports={MAX_BYTES,hash,absolute,targetName,utf8,rootState,rootsFor,safeParent,operation,parseArgs};
