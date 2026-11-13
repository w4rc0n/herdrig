"use strict";
// Host bridge: only the fixed private transfer file is read locally. A spec
// target is forwarded to the selected machine, never statted or resolved here.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {spawnSync}=require("node:child_process");
const {MAX_BYTES,utf8,targetName,absolute,rootState}=require("./rig-spec-files.cjs");
const SPEC_SHA256="162d0c552afc5c86e5d9918d9bbb51cf11c40fcb386ebb386efbc5e39ced2330";
const FOLDER=".local/share/herdr-openrig",FILE="rig-spec-files.cjs";
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
function transferPath(appHome){
 if(!absolute(appHome)||fs.realpathSync(appHome)!==appHome)throw Error("Invalid private app folder.");
 const folder=path.join(appHome,"openrig");
 try{fs.mkdirSync(folder,{mode:0o700});}catch(e){if(e.code!=="EEXIST")throw e;}
 const st=fs.lstatSync(folder);if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(folder)!==folder)throw Error("Refused unsafe spec transfer folder.");
 return path.join(folder,"spec-transfer.txt");
}
function prepare(appHome){const file=transferPath(appHome),fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.closeSync(fd);return{ok:true};}
function readTransfer(appHome){
 const file=transferPath(appHome),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const st=fs.fstatSync(fd);if(!st.isFile()||(st.mode&0o777)!==0o600||st.uid!==process.getuid()||st.size>MAX_BYTES)throw Error("Refused unsafe or oversize spec transfer.");
  const b=Buffer.alloc(MAX_BYTES+1);let used=0,n;while((n=fs.readSync(fd,b,used,b.length-used,used))>0){used+=n;if(used>MAX_BYTES)throw Error("The spec exceeds 1 MiB.");}
  const bytes=b.subarray(0,used);utf8(bytes);return{file,bytes,stat:st};
 }finally{fs.closeSync(fd);}
}
function remove(appHome){const f=transferPath(appHome);try{const s=fs.lstatSync(f);if(s.isSymbolicLink()||!s.isFile()||(s.mode&0o777)!==0o600||s.uid!==process.getuid())throw Error("Refused unsafe spec transfer cleanup.");fs.unlinkSync(f);}catch(e){if(e.code!=="ENOENT")throw e;}return{ok:true};}
function digest(appHome){const r=readTransfer(appHome);try{return{ok:true,sha256:hash(r.bytes)};}finally{remove(appHome);}}
function invoke(run,args,input){
 const r=run("hc",args,{...(input!==undefined?{input}:{}),encoding:"utf8",shell:false,timeout:30000,maxBuffer:8*MAX_BYTES});
 if(r.error)throw Error(r.error.message);return r;
}
function profile(run,machine,expected){
 if(!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(machine??""))throw Error("Invalid configured Herdr machine.");
 const r=invoke(run,["machine","ls","--json"]);if(r.status!==0)throw Error("Could not check the configured Herdr machine.");
 const parsed=JSON.parse(r.stdout),rows=Array.isArray(parsed)?parsed:parsed.machines,record=rows?.find(x=>x.name===machine);
 if(!record||record.temporary!==false||record.state!=="connected")throw Error("Spec editing needs a connected persistent Herdr machine.");
 const identity=x=>[x.target??"",x.id??"",x.via??"",x.session??""];
 if(!expected||JSON.stringify(identity(record))!==JSON.stringify(identity(expected)))throw Error("The configured Herdr machine changed. Review spec-save permission again.");
 return record;
}
function inspect(run,machine,home){
 if(!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(machine??""))throw Error("Invalid configured Herdr machine.");
 const output=(cmd,args)=>{const r=invoke(run,["exec","--on",machine,"--",cmd,...args]);if(r.status!==0)throw Error(r.stderr||"Remote spec-helper check failed.");return String(r.stdout).replace(/\r?\n$/,"");};
 const test=(flag,file)=>{const r=invoke(run,["exec","--on",machine,"--","test",flag,file]);if(![0,1].includes(r.status))throw Error("Remote path check failed.");return r.status===0;};
 if(!absolute(home)||output("printenv",["HOME"])!==home||output("readlink",["-f","--",home])!==home)throw Error("The remote home changed or is unsafe.");
 let current=home,sha256=null;
 for(const part of [...FOLDER.split("/"),FILE]){
  current+="/"+part;if(test("-L",current))throw Error("Refused symlinked spec-helper path.");
  if(test("-e",current)){
   if(!test(part===FILE?"-f":"-d",current)||output("readlink",["-f","--",current])!==current)throw Error("Refused nonregular spec-helper path.");
   if(part===FILE){const text=output("sha256sum",["--",current]);if(!/^[a-f0-9]{64} [ *]/.test(text))throw Error("Invalid spec-helper hash.");sha256=text.slice(0,64);}
  }
 }
 return{path:current,sha256};
}
function shipped(){const f=path.join(__dirname,FILE),s=fs.lstatSync(f);if(!s.isFile()||s.isSymbolicLink())throw Error("Invalid shipped spec helper.");const bytes=fs.readFileSync(f);if(hash(bytes)!==SPEC_SHA256)throw Error("The spec helper does not match this release. Reinstall the mod.");return bytes;}
// Read-only root preview before permission to install a helper. Reuse its root
// policy with an adapter that issues fixed public argv operations on the box.
function preview(machine,home,searchPath,record,run=spawnSync){
 profile(run,machine,record);
 const remote=(cmd,args)=>invoke(run,["exec","--on",machine,"--",cmd,...args]);
 const configRun=(cmd,args)=>{
  if(cmd==="rig"&&JSON.stringify(args)===JSON.stringify(["config","get","workspace.specs_root","--json"]))
   return invoke(run,["exec","--on",machine,"--","env","-i",`HOME=${home}`,`PATH=${searchPath}`,"rig","config","get","workspace.specs_root","--json"]);
  if(cmd==="which"&&args.length===1&&args[0]==="rig")return invoke(run,["exec","--on",machine,"--","which","rig"]);
  throw Error("Unexpected spec-root command.");
 };
 const output=(cmd,args)=>{const r=remote(cmd,args);if(r.status!==0)throw Error(r.stderr||"Could not inspect box spec folders.");return String(r.stdout).replace(/\r?\n$/,"");};
 const io={
  realpathSync:file=>{if(typeof file!=="string"||!file.startsWith("/"))throw Error("Invalid box path.");return output("readlink",["-e","--",file]);},
  statSync:file=>({isDirectory:()=>remote("test",["-d",file]).status===0}),
  readFileSync:file=>output("cat",["--",file]),
 };
 const result=rootState({io,run:configRun,home,searchPath});profile(run,machine,record);
 return{ok:true,...result};
}
function install(machine,home,expected,run=spawnSync){
 if(!absolute(home))throw Error("Invalid remote home.");
 const dest=path.posix.join(home,FOLDER,FILE);
 profile(run,machine,expected);const bytes=shipped(),info=inspect(run,machine,home);
 if(info.path!==dest)throw Error("The spec helper destination changed.");
 if(info.sha256!==SPEC_SHA256){
  profile(run,machine,expected);inspect(run,machine,home);
  const r=invoke(run,["file","write","--on",machine,"--json","--",dest],bytes);if(r.status!==0)throw Error(r.stderr||"Could not install the spec helper.");
 }
 if(inspect(run,machine,home).sha256!==SPEC_SHA256)throw Error("Spec-helper verification failed.");
 return{ok:true,path:info.path,sha256:SPEC_SHA256};
}
function execute({appHome,machine,home,node,verb,target,expectedSha256,expectedRoots,record},run=spawnSync){
 if(!["roots","save","copy"].includes(verb)||!absolute(node)||verb!=="roots"&&!targetName(target))throw Error("Invalid remote spec operation.");
 profile(run,machine,record);const info=inspect(run,machine,home);
 if(info.sha256!==SPEC_SHA256)throw Error("The spec helper needs installation or approval for this release.");
 const nodeCheck=invoke(run,["exec","--on",machine,"--","which","node"]);
 if(nodeCheck.status!==0||String(nodeCheck.stdout).trim()!==node)throw Error("The remote Node executable changed.");
 let input;
 try{
  if(verb!=="roots"){
   const transfer=readTransfer(appHome);
   if(verb==="save"&&!/^[a-f0-9]{64}$/.test(expectedSha256??""))throw Error("Missing loaded-content hash.");
   input=JSON.stringify({content:transfer.bytes.toString("utf8"),expectedSha256,expectedRoots});
  }
  profile(run,machine,record);
  const args=["exec","--on",machine,...(verb!=="roots"?["--stdin"]:[]),"--json","--",node,info.path,verb,...(verb==="roots"?[]:["--",target])];
  const r=invoke(run,args,input);let result;
  try{
   // hc exec --json reports the remote program's streams as base64, including
   // on failure. Refuse incomplete output before interpreting helper JSON.
   const outer=JSON.parse(r.stdout);
   if(outer.timed_out||outer.truncated||typeof outer.stdout!=="string"||outer.stdout.length>262144)throw Error();
   const bytes=Buffer.from(outer.stdout,"base64");
   if(bytes.toString("base64")!==outer.stdout)throw Error();
   result=JSON.parse(utf8(bytes));
   if(outer.code!==0&&!result.error)throw Error();
  }catch{throw Error(r.stderr||"Invalid remote spec-helper response.");}
  return result;
 }finally{if(verb!=="roots")remove(appHome);}
}
if(require.main===module){
 try{
  const[mode,...args]=process.argv.slice(2);let result;
  if(mode==="inspect"){if(args.length)throw Error("Invalid inspect arguments.");result={ok:true,sha256:hash(shipped())};}
  else if(["prepare","digest","remove"].includes(mode)){if(args.length!==1)throw Error("Invalid transfer arguments.");result={prepare,digest,remove}[mode](args[0]);}
  else if(mode==="install"){if(args.length!==3)throw Error("Invalid install arguments.");result=install(args[0],args[1],JSON.parse(args[2]));}
  else if(mode==="preview"){if(args.length!==4)throw Error("Invalid root-preview arguments.");result=preview(args[0],args[1],args[2],JSON.parse(args[3]));}
  else if(mode==="run"){if(args.length!==9)throw Error("Invalid remote arguments.");const[appHome,machine,home,node,verb,target,expectedSha256,roots,record]=args;result=execute({appHome,machine,home,node,verb,target,expectedSha256,expectedRoots:JSON.parse(roots),record:JSON.parse(record)});}
  else throw Error("Unknown spec transport operation.");
  console.log(JSON.stringify(result));if(result.error)process.exitCode=1;
 }catch(e){console.log(JSON.stringify({error:String(e.message??e).replace(/[\r\n\x00-\x1f\x7f]+/g," ")}));process.exitCode=1;}
}
module.exports={SPEC_SHA256,FOLDER,FILE,transferPath,prepare,readTransfer,remove,digest,profile,inspect,install,execute,shipped,preview};
