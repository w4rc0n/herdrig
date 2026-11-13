"use strict";
// Runs only on the configured machine. Roots are derived here, never authorised by host input.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const MAX_BYTES = 1024 * 1024;
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const absolute = s => typeof s === "string" && Buffer.byteLength(s) <= 4096 && s.startsWith("/") && s !== "/"
  && !/[\x00-\x1f\x7f]/.test(s) && s.split("/").slice(1).every(p => p && p !== "." && p !== "..");
const targetName = s => absolute(s) && /\.ya?ml$/i.test(s);
const failure = (message, code = "refused") => Object.assign(new Error(message), { code });
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
function operation(verb,target,input,options={}) {
  const io=options.io??fs,{roots,rejected}=rootState(options);
  if(verb==="roots") {if(target!==undefined)throw failure("roots takes no target.");return{ok:true,roots,rejected};}
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
  if(args.length!==3||!["save","copy"].includes(args[0])||args[1]!=="--"||!targetName(args[2]))throw failure("Expected save or copy, then -- and one absolute YAML target.");
  return{verb:args[0],target:args[2]};
}
if(require.main===module){
  try{
    const{verb,target}=parseArgs(process.argv.slice(2));let input;
    if(verb!=="roots"){
      const chunks=[];let size=0;const buf=Buffer.alloc(8192);let n;
      while((n=fs.readSync(0,buf,0,buf.length,null))>0){size+=n;if(size>6*MAX_BYTES+65536)throw failure("Spec input is too large.");chunks.push(Buffer.from(buf.subarray(0,n)));}
      const raw=Buffer.concat(chunks),text=raw.toString("utf8");if(!Buffer.from(text).equals(raw))throw failure("Invalid UTF-8 input.");input=JSON.parse(text);
    }
    console.log(JSON.stringify(operation(verb,target,input)));
  }catch(e){console.log(JSON.stringify({error:String(e.message??e).replace(/[\r\n\x00-\x1f\x7f]+/g," "),code:e.code??"refused"}));process.exitCode=1;}
}
module.exports={MAX_BYTES,hash,absolute,targetName,utf8,rootState,rootsFor,safeParent,operation,parseArgs};
