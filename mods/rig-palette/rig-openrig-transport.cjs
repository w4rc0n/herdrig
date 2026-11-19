"use strict";
// Host bridge for reaching a machine's OpenRig over Herdr's connection. It installs the pinned helper (rig-openrig-helper.cjs) on the machine,
// and it carries a write's body from a private per-request transfer file under the app folder to the helper's stdin (`hc exec --stdin`), so a
// body is never in argv and never on the machine's disk. Reads and the event long-poll don't come here: the mod runs the helper directly.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {spawnSync}=require("node:child_process");
const {invoke,profile,inspect}=require("./rig-spec-transport.cjs");
const {absolute}=require("./rig-spec-files.cjs");
const {checkPath,MAX_BODY}=require("./rig-openrig-helper.cjs");
const OPENRIG_HELPER_SHA256="ba850b07f6fb3cd92eab71ad4fd39171a177a1a7acb0c7c1a2b90589ab43b1f1";
const FOLDER=".local/share/herdr-openrig",FILE="rig-openrig-helper.cjs";
const NAME=/^openrig-transfer-[a-f0-9]{16}\.txt$/;
const WORDS={use:"Using OpenRig over Herdr's connection",grant:"permission to use OpenRig there"};
const MAX_ANSWER=8*1024*1024;
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");

function folder(appHome){
 if(!absolute(appHome)||fs.realpathSync(appHome)!==appHome)throw Error("Invalid private app folder.");
 const dir=path.join(appHome,"openrig");
 try{fs.mkdirSync(dir,{mode:0o700});}catch(e){if(e.code!=="EEXIST")throw e;}
 const st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(dir)!==dir)throw Error("Refused an unsafe transfer folder.");
 return dir;
}
function transferPath(appHome,name){if(typeof name!=="string"||!NAME.test(name))throw Error("Invalid transfer name.");return path.join(folder(appHome),name);}
// One transfer file per write, so two writes never share one and a slow spec save never holds a send behind it.
function prepare(appHome){
 const name=`openrig-transfer-${crypto.randomBytes(8).toString("hex")}.txt`;
 fs.closeSync(fs.openSync(transferPath(appHome,name),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600));
 return{ok:true,name};
}
function readTransfer(appHome,name){
 const fd=fs.openSync(transferPath(appHome,name),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const st=fs.fstatSync(fd);if(!st.isFile()||(st.mode&0o777)!==0o600||st.uid!==process.getuid()||st.size>MAX_BODY)throw Error("Refused an unsafe or oversize transfer.");
  const b=Buffer.alloc(MAX_BODY+1);let used=0,n;while((n=fs.readSync(fd,b,used,b.length-used,used))>0){used+=n;if(used>MAX_BODY)throw Error("The request body is too large.");}
  return b.subarray(0,used);
 }finally{fs.closeSync(fd);}
}
function remove(appHome,name){
 const f=transferPath(appHome,name);
 try{const s=fs.lstatSync(f);if(s.isSymbolicLink()||!s.isFile()||(s.mode&0o777)!==0o600||s.uid!==process.getuid())throw Error("Refused an unsafe transfer cleanup.");fs.unlinkSync(f);}
 catch(e){if(e.code!=="ENOENT")throw e;}
 return{ok:true};
}
// The helper beside this bridge, opened without following a link and checked against the pin.
function shipped(){
 const fd=fs.openSync(path.join(__dirname,FILE),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let bytes;
 try{if(!fs.fstatSync(fd).isFile())throw Error("Invalid shipped OpenRig helper.");bytes=fs.readFileSync(fd);}finally{fs.closeSync(fd);}
 if(hash(bytes)!==OPENRIG_HELPER_SHA256)throw Error("The OpenRig helper does not match this release. Reinstall the mod.");
 return bytes;
}
function install(machine,home,expected,run=spawnSync){
 if(!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(machine??""))throw Error("Invalid configured Herdr machine.");
 if(!absolute(home))throw Error("Invalid remote home.");
 const dest=path.posix.join(home,FOLDER,FILE);
 profile(run,machine,expected,WORDS);const bytes=shipped(),info=inspect(run,machine,home,FILE);
 if(info.path!==dest)throw Error("The OpenRig helper's destination changed.");
 if(info.sha256!==OPENRIG_HELPER_SHA256){
  profile(run,machine,expected,WORDS);inspect(run,machine,home,FILE);
  const r=invoke(run,["file","write","--on",machine,"--json","--",dest],bytes);if(r.status!==0)throw Error(r.stderr||"Could not install the OpenRig helper.");
 }
 const verified=inspect(run,machine,home,FILE);
 if(verified.sha256!==OPENRIG_HELPER_SHA256)throw Error("The OpenRig helper didn't verify after install.");
 return{ok:true,path:dest,sha256:verified.sha256};
}
// hc exec --json carries the helper's stdout as base64. A timed-out write may still have arrived, so it is never reported as not sent.
function envelope(r){
 let outer;try{outer=JSON.parse(r.stdout);}catch{throw Error(r.stderr||"Invalid answer from the machine.");}
 if(outer?.timed_out)throw Object.assign(Error("The machine didn't answer in time. The write may still have arrived; check before sending it again."),{outcomeUnknown:true});
 if(outer?.truncated||typeof outer?.stdout!=="string"||outer.stdout.length>MAX_ANSWER)throw Error("Invalid answer from the machine.");
 const bytes=Buffer.from(outer.stdout,"base64");if(bytes.toString("base64")!==outer.stdout)throw Error("Invalid answer from the machine.");
 let result;try{result=JSON.parse(bytes.toString("utf8"));}catch{throw Error("Invalid answer from the OpenRig helper.");}
 if(outer.code!==0&&!result?.error)throw Error("Invalid answer from the OpenRig helper.");
 return result;
}
function post({appHome,name,machine,home,node,hostId,apiPath,type,record},run=spawnSync){
 try{
  if(!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(machine??""))throw Error("Invalid configured Herdr machine.");
  checkPath(apiPath);
  // The helper checks this host id before it sends anything; without one there is nothing to check against, so nothing is sent.
  if(hostId==="-"||!/^[A-Za-z0-9._:-]{1,128}$/.test(hostId??""))throw Error("The OpenRig this write is for isn't known (no host id). Nothing was sent.");
  if(!/^[a-z]+\/[a-z0-9.+-]+$/i.test(type??"")||!absolute(node))throw Error("Invalid OpenRig write.");
  profile(run,machine,record,WORDS);const info=inspect(run,machine,home,FILE);
  if(info.sha256!==OPENRIG_HELPER_SHA256)throw Error("The OpenRig helper needs installing or approval for this release.");
  const nodeCheck=invoke(run,["exec","--on",machine,"--","which","node"]);
  if(nodeCheck.status!==0||String(nodeCheck.stdout).trim()!==node)throw Error("The remote Node executable changed.");
  const body=readTransfer(appHome,name),sent=hash(body);
  profile(run,machine,record,WORDS);
  // From here the write may reach OpenRig: a failure that isn't the helper's own clean answer (hc killed, a link lost mid-write, output that doesn't
  // decode) is "may have arrived", never "not sent", so nothing retries it into a second send.
  let result;
  try{result=envelope(invoke(run,["exec","--on",machine,"--stdin","--json","--",node,info.path,"post",hostId,apiPath,type],body));}
  catch(e){if(e?.outcomeUnknown)throw e;throw Object.assign(Error(`The write may still have arrived (${String(e?.message??e).replace(/[\r\n\x00-\x1f\x7f]+/g," ").slice(0,200)}). Check before sending it again.`),{outcomeUnknown:true});}
  // The helper hashes what it received: a different digest means the body that arrived isn't the one written here.
  if(result.ok&&result.sha256!==sent)throw Object.assign(Error("The machine received a different body than the one sent. Check before sending it again."),{outcomeUnknown:true});
  return result;
 }finally{remove(appHome,name);}
}
// A write through the rig CLI on the machine (the helper's rig verb builds and checks the argv itself). The body of a queue row, when there is
// one, goes on stdin from a private transfer file; everything else is the shape's own values. A launch or up can take minutes. Herdr ends an
// exec after its own --timeout (60 s by default, at most 600), so the write asks for RIG_HERDR_TIMEOUT_S: above the helper's own kill of the CLI
// (170 s, after up to about 20 s of locate()). The local hc process gets RIG_EXEC_MS, above that again.
const RIG_HERDR_TIMEOUT_S=200,RIG_EXEC_MS=230000;
function rig({appHome,name,machine,home,node,hostId,record,shape,person,values},run=spawnSync){
 const body=name!=="-";
 try{
  if(!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(machine??""))throw Error("Invalid configured Herdr machine.");
  if(!["send","queue-create","pause","resume","delete","archive","unarchive","snapshot","fresh","launch-spec","new-rig","create-rig","quiet-set-until","quiet-set-daily","quiet-end","quiet-clear","mode-end","mode-apply","mode-save-sleep","mode-save-focus"].includes(shape))throw Error("Unknown OpenRig write. Nothing was sent.");
  if(hostId==="-"||!/^[A-Za-z0-9._:-]{1,128}$/.test(hostId??""))throw Error("The OpenRig this write is for isn't known (no host id). Nothing was sent.");
  if(!absolute(node)||!Array.isArray(values)||!values.every(v=>typeof v==="string")||typeof person!=="string")throw Error("Invalid OpenRig write.");
  profile(run,machine,record,WORDS);const info=inspect(run,machine,home,FILE);
  if(info.sha256!==OPENRIG_HELPER_SHA256)throw Error("The OpenRig helper needs installing or approval for this release.");
  const nodeCheck=invoke(run,["exec","--on",machine,"--","which","node"]);
  if(nodeCheck.status!==0||String(nodeCheck.stdout).trim()!==node)throw Error("The remote Node executable changed.");
  const bytes=body?readTransfer(appHome,name):undefined,sent=body?hash(bytes):null;
  profile(run,machine,record,WORDS);
  // From here the write may reach OpenRig: a failure that isn't the helper's own clean answer is "may have arrived", never "not sent".
  let result;
  try{result=envelope(invoke(run,["exec","--on",machine,"--timeout",String(RIG_HERDR_TIMEOUT_S),...(body?["--stdin"]:[]),"--json","--",node,info.path,"rig",hostId,shape,person,...values],bytes,RIG_EXEC_MS));}
  catch(e){if(e?.outcomeUnknown)throw e;throw Object.assign(Error(`The write may still have arrived (${String(e?.message??e).replace(/[\r\n\x00-\x1f\x7f]+/g," ").slice(0,200)}). Check before sending it again.`),{outcomeUnknown:true});}
  if(body&&result.ok&&result.sha256!==sent)throw Object.assign(Error("The machine received a different body than the one sent. Check before sending it again."),{outcomeUnknown:true});
  return result;
 }finally{if(body)remove(appHome,name);}
}
if(require.main===module){
 try{
  const[mode,...args]=process.argv.slice(2);let result;
  if(mode==="inspect"){if(args.length)throw Error("Invalid inspect arguments.");result={ok:true,sha256:hash(shipped())};}
  else if(mode==="prepare"){if(args.length!==1)throw Error("Invalid transfer arguments.");result=prepare(args[0]);}
  else if(mode==="remove"){if(args.length!==2)throw Error("Invalid transfer arguments.");result=remove(args[0],args[1]);}
  else if(mode==="install"){if(args.length!==3)throw Error("Invalid install arguments.");result=install(args[0],args[1],JSON.parse(args[2]));}
  else if(mode==="rig"){if(args.length<9)throw Error("Invalid write arguments.");const[appHome,name,machine,home,node,hostId,record,shape,person,...values]=args;result=rig({appHome,name,machine,home,node,hostId,record:JSON.parse(record),shape,person,values});}
  else if(mode==="post"){if(args.length!==9)throw Error("Invalid write arguments.");const[appHome,name,machine,home,node,hostId,apiPath,type,record]=args;result=post({appHome,name,machine,home,node,hostId,apiPath,type,record:JSON.parse(record)});}
  else throw Error("Unknown OpenRig transport operation.");
  console.log(JSON.stringify(result));if(result.error||result.ok===false)process.exitCode=1;
 }catch(e){console.log(JSON.stringify({ok:false,error:String(e.message??e).replace(/[\r\n\x00-\x1f\x7f]+/g," "),...(e?.outcomeUnknown?{outcomeUnknown:true}:{})}));process.exitCode=1;}
}
module.exports={OPENRIG_HELPER_SHA256,FILE,transferPath,prepare,readTransfer,remove,shipped,install,envelope,post,rig};
