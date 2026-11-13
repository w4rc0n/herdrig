// Space identity and sidebar size state use public lists and labels, never display names.
const qualifiedSpace = terminal => {
  const id = terminal?.labels?.["herdr.space"], address = String(terminal?.address ?? terminal?.terminal ?? "");
  if (typeof id !== "string" || !id) return null;
  const machine = address.includes("/") ? address.slice(0, address.indexOf("/")) : null;
  if (!machine) return id.includes("/") ? null : id;
  return id.includes("/") ? (id.startsWith(machine + "/") ? id : null) : machine + "/" + id;
};

// HTTP origins keep their scheme and port. Only the three loopback host spellings are aliases.
export function rigOrigin(value) {
  const match=/^(https?):\/\/(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9._-]+)(?::([0-9]+))?\/?$/i.exec(String(value??""));
  if(!match)return null;
  const scheme=match[1].toLowerCase(),rawHost=match[2].toLowerCase(),host=["localhost","[::1]"].includes(rawHost)?"127.0.0.1":rawHost;
  const port=match[3]===undefined?null:Number(match[3]);
  if(port!==null&&(!Number.isInteger(port)||port<1||port>65535))return null;
  return `${scheme}://${host}${port!==null&&port!==(scheme==="https"?443:80)?":"+port:""}`;
}
const get=(host,key)=>(typeof host[key]==="function"?host[key]():host[key])??[];
// On a configured Herdr machine the daemon is that machine's OpenRig, reached through a tunnel whose local address can be spelled
// 127.0.0.1, 127.0.0.3 or localhost depending on when a space was made. Scheme and port still decide which daemon; the loopback
// spelling does not. Anything not loopback on both sides, or any difference in scheme or port, stays a different OpenRig.
const loopbackParts=value=>{
  const match=/^(https?):\/\/([^:/]+)(?::([0-9]+))?$/i.exec(String(value??""));
  return match&&(match[2]==="127.0.0.1"||/^127(?:\.[0-9]{1,3}){3}$/.test(match[2]))?{scheme:match[1].toLowerCase(),port:match[3]??""}:null;
};
export function sameDaemonOrigin(label,expected,machine=null){
  const a=rigOrigin(label),b=rigOrigin(expected);
  if(!a||!b)return false;
  if(a===b)return true;
  if(!machine)return false;
  const x=loopbackParts(a),y=loopbackParts(b);
  return Boolean(x&&y&&x.scheme===y.scheme&&x.port===y.port);
}
const sameOrigin=(label,expected,machine=null)=>!label||sameDaemonOrigin(label,expected,machine);
const ownsRigSpace=labels=>labels["herdr-openrig.space"]==="1"||labels["herdr-openrig.attach"]
  ||labels["herdr-openrig.role"]&&labels["herdr-openrig.role"]!=="tui"||labels["openrig.rig"]&&labels["openrig.seat"];

/** The sessions the configured daemon lists for a rig (topology rig: flat `seats` or `pods[].seats`). */
export function rigSessions(rig){
  const seats=Array.isArray(rig?.seats)?rig.seats:(rig?.pods??[]).flatMap(pod=>pod?.seats??[]);
  return seats.map(seat=>seat?.session??seat?.canonicalSessionName).filter(Boolean);
}
const decodeBase64Json=text=>{
  try{
    const raw=typeof atob==="function"?atob(text):(typeof Buffer==="function"?Buffer.from(text,"base64").toString("binary"):null);
    return raw===null?null:JSON.parse(decodeURIComponent(raw.split("").map(c=>"%"+c.charCodeAt(0).toString(16).padStart(2,"0")).join("")));
  }catch{return null;}
};
/** The tmux server flags a seat terminal's viewer was started with: the grid payload's `serverArgs`, or the flags before `attach` in a
 *  plain tmux argv. null when the label is absent or not either shape (nothing to compare). */
function viewerServerFlags(labels){
  let argv;
  try{argv=JSON.parse(labels?.["herdr-openrig.viewer-argv"]??"null");}catch{return null;}
  if(!Array.isArray(argv))return null;
  const payload=decodeBase64Json(String(argv.at(-1)??""));
  if(payload&&Array.isArray(payload.serverArgs))return payload.serverArgs.map(String);
  const at=argv.findIndex(part=>/(?:^|\/)tmux$/.test(String(part)));
  if(at<0)return null;
  const flags=[];
  for(let i=at+1;i<argv.length;i++){
    const part=String(argv[i]);
    if(part==="-L"||part==="-S"){flags.push(part,String(argv[i+1]??""));i++;}
    else if(part.startsWith("-"))continue;
    else break;
  }
  return flags;
}
const nameSet=names=>new Set((Array.isArray(names)?names:[names]).filter(Boolean));
const rigLabel=labels=>labels["herdr-openrig.rig"]||labels["openrig.rig"];
/** The daemon's host id as it may be written in a label (letters, digits and . _ : - only). */
export const hostLabelValue=hostId=>typeof hostId==="string"&&/^[A-Za-z0-9._:-]{1,128}$/.test(hostId)?hostId:null;
const rigTerminals=(host,space,rigNames)=>get(host,"terminals").filter(t=>qualifiedSpace(t)===space.id&&rigNames.has(rigLabel(t.labels??{})));
/** Who vouches for a space whose origin label only differs in the loopback spelling. One answer: "same" (adopt), "other" (a different
 *  daemon's space: never adopt, never offer), or "unknown" (cannot be shown: do not adopt and do not duplicate).
 *  1. Stamped: terminals carry `herdr-openrig.host` (new spaces). It must equal the configured daemon's host id, exactly; a different id
 *     is another daemon's space; a stamp with no configured host id to compare is unknown.
 *  2. Unstamped (spaces made before the stamp): the space is on the configured machine (the caller's filter), at least one terminal names a
 *     seat session, and every such session is one the configured daemon lists for this rig. Those terminals attach to tmux ON that machine,
 *     where a session name is one per tmux server and only the OpenRig that manages it lists it; a host-local daemon's space lives on Local
 *     and fails the machine check before this runs. */
function vouched(host,space,rigNames,{sessions=null,hostId=null,servers=null}={}){
  const terminals=rigTerminals(host,space,rigNames);
  const stamps=terminals.map(t=>t.labels?.["herdr-openrig.host"]).filter(value=>value!==undefined&&value!==null&&value!=="");
  if(stamps.length){
    const own=hostLabelValue(hostId);
    if(!own)return "unknown";
    return stamps.every(stamp=>stamp===own)?"same":"other";
  }
  const listed=new Set(Array.isArray(sessions)?sessions:sessions instanceof Set?[...sessions]:[]);
  const seats=terminals.map(t=>t.labels?.["herdr-openrig.seat"]).filter(Boolean);
  if(!(seats.length>0&&seats.every(session=>listed.has(session))))return "unknown";
  // When both sides say which tmux server the seat is on, they must say the same one. A deliberate exclusion remains: two daemons on one
  // machine sharing an identical tmux socket and identical session names cannot be told apart without the host stamp.
  for(const terminal of terminals){
    const session=terminal.labels?.["herdr-openrig.seat"],wanted=servers instanceof Map?servers.get(session):undefined,actual=viewerServerFlags(terminal.labels);
    if(session&&wanted&&actual&&JSON.stringify(wanted)!==JSON.stringify(actual))return "unknown";
  }
  return "same";
}
/** The same vouching, for a caller that only reads (the Spaces list marks): "same", "other" or "unknown"; it never writes a label. */
export const vouchedSpace=vouched;
function lookup(host,config,names,{markedOnly=false,sessions=null,hostId=null,servers=null}={}){
  const expected=rigOrigin(config?.daemonUrl);if(!expected)return {space:null,unconfirmed:null};
  const rigNames=nameSet(names),machine=config?.daemonMachine||null;
  const state=host.routeState?.()??host.shared?.("rig.spaceState")??{};
  const onMachine=openRigSpaceContext(get(host,"spaces"),get(host,"terminals"),get(host,"panes"),state)
    .filter(context=>(context.space.machine??(context.id.includes("/")?context.id.split("/")[0]:null))===machine);
  const links=context=>markedOnly?context.markedRigLinks:context.rigLinks;
  const exact=onMachine.filter(context=>links(context).some(link=>rigNames.has(link.rig)&&sameOrigin(link.origin,expected)));
  if(exact.length)return {space:(exact.find(context=>context.space.active)??exact[0]).space,unconfirmed:null};
  if(!machine)return {space:null,unconfirmed:null};
  const loose=onMachine.filter(context=>links(context).some(link=>rigNames.has(link.rig)&&sameOrigin(link.origin,expected,machine)))
    .map(context=>({context,verdict:vouched(host,context.space,rigNames,{sessions,hostId,servers})}));
  const same=loose.filter(item=>item.verdict==="same").map(item=>item.context);
  if(same.length)return {space:(same.find(context=>context.space.active)??same[0]).space,unconfirmed:null};
  const unknown=loose.find(item=>item.verdict==="unknown")?.context;
  const origin=unknown?(links(unknown).find(link=>rigNames.has(link.rig))?.origin??null):null;
  return {space:null,unconfirmed:unknown?{space:unknown.space,origin}:null};
}

/** One label-based destination lookup for pages, grids and Attach; never infer ownership from a display name. */
export function resolveRigSpace(host,config,names,options={}) {
  return lookup(host,config,names,options).space;
}

/** The box space that looks like the rig's but was made with another address and cannot be confirmed: never adopted, never duplicated. */
export function unconfirmedRigSpace(host,config,names,options={}) {
  return lookup(host,config,names,options).unconfirmed;
}

/** The OpenRig home space made with another spelling of this daemon's address (or none: the strict lookup handles that). `contexts` are
 *  `openRigSpaceContext` results. A home space is vouched for the same way a rig's space is: STAMPED terminals must carry the configured
 *  daemon's host id; UNSTAMPED ones must each be running `rig tui` (the box's own OpenRig) on the configured machine, which the space's
 *  machine filter already fixes. Returns { context, terminals } to adopt, or { unconfirmed: { space, origin } } to refuse, or {}. */
export function homeCandidate(contexts,config,{hostId=null}={}){
  const expected=rigOrigin(config?.daemonUrl),machine=config?.daemonMachine||null;
  if(!expected||!machine)return {};
  const machineOf=context=>context.space.machine??(String(context.id??"").includes("/")?String(context.id).split("/")[0]:null);
  let unconfirmed=null;
  for(const context of contexts??[]){
    if(!context.home||machineOf(context)!==machine||!context.tuis?.length)continue;
    const labelled=context.tuis.filter(t=>t.labels?.["herdr-openrig.origin"]);
    if(!labelled.length||labelled.every(t=>sameDaemonOrigin(t.labels["herdr-openrig.origin"],expected)&&rigOrigin(t.labels["herdr-openrig.origin"])===expected))continue;
    if(!labelled.every(t=>sameOrigin(t.labels["herdr-openrig.origin"],expected,machine)))continue;
    const stamps=context.tuis.map(t=>t.labels?.["herdr-openrig.host"]).filter(value=>value!==undefined&&value!==null&&value!=="");
    let verdict;
    if(stamps.length){const own=hostLabelValue(hostId);verdict=!own?"unknown":stamps.every(stamp=>stamp===own)?"same":"other";}
    else verdict=context.tuis.every(t=>Array.isArray(t.argv)&&t.argv.length>=2&&t.argv.at(-2)==="rig"&&t.argv.at(-1)==="tui")?"same":"unknown";
    if(verdict==="same")return {context,terminals:context.tuis};
    if(verdict==="unknown"&&!unconfirmed)unconfirmed={space:context.space,origin:labelled[0].labels["herdr-openrig.origin"]};
  }
  return unconfirmed?{unconfirmed}:{};
}

/** Give an adopted home space's TUI terminals today's origin and the daemon's host stamp, once. */
export async function markHomeSpace(host,config,terminals,{hostId=null}={}){
  const configured=String(config?.daemonUrl??"").replace(/\/$/,""),stamp=hostLabelValue(hostId);
  for(const terminal of terminals??[]){
    const labels=terminal.labels??{},marks=[];
    if(labels["herdr-openrig.origin"]&&rigOrigin(labels["herdr-openrig.origin"])!==rigOrigin(configured))marks.push(`herdr-openrig.origin=${configured}`);
    if(stamp&&!labels["herdr-openrig.host"])marks.push(`herdr-openrig.host=${stamp}`);
    if(!marks.length)continue;
    if(typeof host.hc!=="function")throw new Error("Herdr cannot mark OpenRig's home space. Open the Rig sidebar and try again.");
    const result=await host.hc(["label",terminal.address??terminal.terminal,...marks]);
    if(result?.code!==0)throw new Error(result?.stderr||"Herdr could not mark OpenRig's home space; no second home was opened.");
  }
}

/** Repair only matching legacy ownership labels in the selected space; keep its name and every tab in place. A terminal whose origin label
 *  differs from the configured one only in the loopback spelling takes the configured origin (and the daemon's host stamp), once, and only
 *  when the space is vouched for as above; otherwise it is left exactly as it is. */
export async function markRigSpace(host,config,names,space,{sessions=null,hostId=null,servers=null}={}) {
  const expected=rigOrigin(config?.daemonUrl),rigNames=nameSet(names);
  if(!space||!expected)return;
  const machine=config?.daemonMachine||null,configured=String(config.daemonUrl).replace(/\/$/,"");
  const adopted=machine?vouched(host,space,rigNames,{sessions,hostId,servers})==="same":false,stamp=hostLabelValue(hostId);
  for(const terminal of get(host,"terminals")){
    const labels=terminal.labels??{};
    if(qualifiedSpace(terminal)!==space.id||!rigNames.has(labels["herdr-openrig.rig"]??labels["openrig.rig"]))continue;
    const exact=sameOrigin(labels["herdr-openrig.origin"],expected);
    if(!exact&&!(adopted&&sameOrigin(labels["herdr-openrig.origin"],expected,machine)))continue;
    if(!ownsRigSpace(labels))continue;
    const marks=[];
    if(labels["herdr-openrig.space"]!=="1"&&exact)marks.push("herdr-openrig.space=1");
    if(!exact){
      if(labels["herdr-openrig.space"]!=="1")marks.push("herdr-openrig.space=1");
      marks.push(`herdr-openrig.origin=${configured}`);
      if(stamp&&!labels["herdr-openrig.host"])marks.push(`herdr-openrig.host=${stamp}`);
    }
    if(!marks.length)continue;
    if(typeof host.hc!=="function")throw new Error("Herdr cannot mark the existing rig space. Open the Rig sidebar and try again.");
    const result=await host.hc(["label",terminal.address??terminal.terminal,...marks]);
    if(result?.code!==0)throw new Error(result?.stderr||"Herdr could not mark the existing rig space; no duplicate space was opened.");
  }
}

export function openRigSpaceContext(spaces = [], terminals = [], panes = [], state = {}, viewMod = "rig-view") {
  return spaces.map(space => {
    const terms = terminals.filter(t => qualifiedSpace(t) === space.id);
    const tabs = new Set((space.tabs ?? []).map(t => t.id));
    const pages = panes.filter(p => p.mod === viewMod && tabs.has(p.tab));
    const rigs = new Set();
    const rigLinks = [];
    const markedRigLinks = [];
    let rigOwned = false;
    for (const terminal of terms) {
      const labels = terminal.labels ?? {};
      const own = ownsRigSpace(labels);
      if (own) {
        rigOwned = true;
        const rig = labels["herdr-openrig.rig"] || labels["openrig.rig"];
        if (rig) {
          const link={rig,origin:labels["herdr-openrig.origin"]??null};rigs.add(rig);rigLinks.push(link);
          if(labels["herdr-openrig.space"]==="1")markedRigLinks.push(link);
        }
      }
    }
    const currentTerminal = t => panes.some(p=>p.terminal===t.address&&tabs.has(p.tab));
    const home = state.homeSpace === space.id || Object.values(state.homeSpaces??{}).includes(space.id)
      || terms.some(t => t.labels?.["herdr-openrig.home"] === "1"&&currentTerminal(t));
    const tuis = terms.filter(t => t.labels?.["herdr-openrig.role"] === "tui"&&currentTerminal(t));
    const legacy = !home && !rigOwned && (pages.length > 0 || tuis.length > 0);
    return { space, id: space.id, owned: Boolean(home || rigOwned || legacy), home, rigs: home ? [] : [...rigs], rigLinks, markedRigLinks, pages, tuis, legacy };
  });
}

const validSize = size => size && Number.isFinite(size.px) && size.px > 0 ? { px: size.px }
  : size && Number.isFinite(size.weight) && size.weight > 0 ? { weight: size.weight } : null;
const isHeaderSize = size => size?.px === 30;
const sameSize = (a,b) => !!a&&!!b&&a.px===b.px&&a.weight===b.weight;

/** Layout mutations run only from scheduled callbacks. Each transition cancels older pending switches. */
export class SidebarSpaceFold {
  constructor(savedSize = null) {
    this.savedSize = validSize(savedSize);
    this.spaceId = undefined;
    this.manualSpace = null;
    this.folded = false;
    this.applied = false;
    this.warned = false;
  }
  expand(spaceId) { this.manualSpace = spaceId; }
  observe(context, block, { after, run, save, warn, notify }) {
    const id = context?.id ?? null;
    if (id !== this.spaceId) { this.spaceId = id; this.manualSpace = null; }
    const measured = validSize(block?.size);
    // A command and its layout snapshot arrive on different turns. Never read our old size as a drag.
    if(this.awaiting&&sameSize(measured,this.awaiting.size)){
      this.awaiting=null;this.acknowledged=true;this.resizeFailed=false;
    }
    if (this.applied && this.acknowledged && !this.awaiting && measured && !isHeaderSize(measured)
      && !sameSize(measured,this.savedSize) && !sameSize(measured,this.lastRequested)) {
      this.manualSpace = id;
      this.savedSize = measured;
      this.applied = false;
      save?.(measured);
    }
    const folded = Boolean(context && !context.owned && this.manualSpace !== id);
    if (folded === this.folded && this.scheduledSpace === id) return folded;
    const wasFolded = this.folded;
    this.folded = folded;
    this.scheduledSpace = id;
    if (folded && !wasFolded && !this.applied && !this.awaiting && measured && !isHeaderSize(measured)) {
      this.savedSize = measured;
      save?.(measured);
    }
    this.pending={folded,block,measured,wasFolded};
    const schedule=()=>{
      if(this.queued||this.cooldown)return;
      this.queued=true;
      after(0,()=>{
      this.queued=false;
      const pending=this.pending;this.pending=null;if(!pending)return;
      const {folded,block,measured}=pending;
      if (!block?.id) {
        if (folded && !this.warned) { this.warned = true; warn?.("Add an id to the rig block to let OpenRig fold it."); }
        notify?.();
        return;
      }
      if(this.resizeFailed){notify?.();return;}
      try {
        const target=folded?{px:30}:(this.savedSize??{weight:2});
        const needsResize=folded||this.applied||pending.wasFolded||isHeaderSize(measured);
        this.applied=folded;
        if(needsResize&&(!sameSize(measured,target)||this.awaiting&&!sameSize(this.awaiting.size,target))){
          const acknowledgement={size:target};this.awaiting=acknowledgement;this.acknowledged=false;
          this.lastRequested=target;
          run("layout.resize",{id:block.id,...target});
          after(1000,()=>{
            if(this.awaiting!==acknowledgement)return;
            this.resizeFailed=true;
            if(!this.warned){this.warned=true;warn?.("Herdr did not confirm the sidebar resize; OpenRig will keep its header without resizing again.");}
            notify?.();
          });
        }else if(needsResize){
          this.acknowledged=true;this.lastRequested=target;
        }
      } catch {
        this.applied = false;
        this.resizeFailed = true;
        if (!this.warned) { this.warned = true; warn?.("OpenRig could not resize this sidebar block; its header still works."); }
      }
      // Leading edge is immediate; only changes inside this window wait and collapse to the latest state.
      this.cooldown=true;
      after(150,()=>{this.cooldown=false;if(this.pending)schedule();});
      notify?.();
      });
    };
    schedule();
    return folded;
  }
}
