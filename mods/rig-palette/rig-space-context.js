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
const sameOrigin=(label,expected)=>!label||rigOrigin(label)===expected;
const ownsRigSpace=labels=>labels["herdr-openrig.space"]==="1"||labels["herdr-openrig.attach"]
  ||labels["herdr-openrig.role"]&&labels["herdr-openrig.role"]!=="tui"||labels["openrig.rig"]&&labels["openrig.seat"];

/** One label-based destination lookup for pages, grids and Attach; never infer ownership from a display name. */
export function resolveRigSpace(host,config,names,{markedOnly=false}={}) {
  const expected=rigOrigin(config?.daemonUrl);if(!expected)return null;
  const rigNames=new Set((Array.isArray(names)?names:[names]).filter(Boolean)),machine=config?.daemonMachine||null;
  const state=host.routeState?.()??host.shared?.("rig.spaceState")??{};
  const candidates=openRigSpaceContext(get(host,"spaces"),get(host,"terminals"),get(host,"panes"),state)
    .filter(context=>(context.space.machine??(context.id.includes("/")?context.id.split("/")[0]:null))===machine
      &&(markedOnly?context.markedRigLinks:context.rigLinks).some(link=>rigNames.has(link.rig)&&sameOrigin(link.origin,expected)));
  return (candidates.find(context=>context.space.active)??candidates[0])?.space??null;
}

/** Repair only matching legacy ownership labels in the selected space; keep its name and every tab in place. */
export async function markRigSpace(host,config,names,space) {
  const expected=rigOrigin(config?.daemonUrl),rigNames=new Set((Array.isArray(names)?names:[names]).filter(Boolean));
  if(!space||!expected)return;
  for(const terminal of get(host,"terminals")){
    const labels=terminal.labels??{};
    if(qualifiedSpace(terminal)!==space.id||labels["herdr-openrig.space"]==="1"
      ||!rigNames.has(labels["herdr-openrig.rig"]??labels["openrig.rig"])
      ||!sameOrigin(labels["herdr-openrig.origin"],expected))continue;
    if(!ownsRigSpace(labels))continue;
    if(typeof host.hc!=="function")throw new Error("Herdr cannot mark the existing rig space. Open the Rig sidebar and try again.");
    const result=await host.hc(["label",terminal.address??terminal.terminal,"herdr-openrig.space=1"]);
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
