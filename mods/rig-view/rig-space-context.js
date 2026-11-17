import { publishedUnder, gateGeneration, gateSameConfig, gateIdentity, gatedFetch } from "./rig-gate.js";
import { decodeRelayToken } from "./rig-relay-payload.js";
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
function viewerServerFlags(labels,decode=decodeBase64Json){
  let argv;
  try{argv=JSON.parse(labels?.["herdr-openrig.viewer-argv"]??"null");}catch{return null;}
  if(!Array.isArray(argv))return null;
  const payload=decode(String(argv.at(-1)??""));
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

/** Classify every relevant terminal, including unstamped ones. A stamp is evidence, never authentication. */
export function classifyRigSpace(host,config,names,space,liveId){
  const expected=rigOrigin(config?.daemonUrl),own=hostLabelValue(liveId);
  const terminals=rigTerminals(host,space,nameSet(names)).map(terminal=>{
    const labels=terminal.labels??{},origin=labels["herdr-openrig.origin"],stamp=hostLabelValue(labels["herdr-openrig.host"]);
    const kind=origin&&sameDaemonOrigin(origin,expected,config?.daemonMachine)?"ours"
      :!origin&&labels["herdr-openrig.rig"]?"ours-legacy"
      :!labels["herdr-openrig.rig"]?"unknown"
      :origin&&stamp&&own?(stamp===own?"ours-by-stamp":"theirs"):"unknown";
    return {terminal,kind};
  });
  const kind=terminals.some(t=>t.kind==="theirs")?"theirs"
    :!terminals.length||terminals.some(t=>t.kind==="unknown")?"unknown"
    :terminals.some(t=>t.kind==="ours-by-stamp")?"ours-by-stamp":"ours";
  return {kind,terminals};
}

// For a named or indeterminate id, both independent pieces must be present for every seat.
function sessionVouch(terminals,{sessions,servers}){
  const listed=new Set(sessions??[]),seats=terminals.map(t=>t.terminal).filter(t=>t.labels?.["herdr-openrig.seat"]);
  return seats.length>0&&seats.every(t=>{
    const session=t.labels["herdr-openrig.seat"],wanted=servers instanceof Map?servers.get(session):null,actual=viewerServerFlags(t.labels,portableViewerPayload);
    return listed.has(session)&&Array.isArray(wanted)&&Array.isArray(actual)&&JSON.stringify(wanted)===JSON.stringify(actual);
  });
}

// Decode the grid viewer's server flags portably, without relying on host-provided encoding globals.
function portableViewerPayload(text){
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))return null;
  try{
    const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let value=0,bits=0,escaped="";
    for(const ch of text.replace(/=+$/,"")){
      value=(value<<6)|alphabet.indexOf(ch);bits+=6;
      if(bits>=8){bits-=8;escaped+="%"+((value>>>bits)&255).toString(16).padStart(2,"0");}
    }
    return JSON.parse(decodeURIComponent(escaped));
  }catch{return null;}
}

// One review and relabel operation per connection/space. Host wrappers differ between callers, so share the decision, never their host.
// Same-module callers share a promise here; callers in OTHER mods (each mod loads its own copy of this file) find the review
// in host shared state (REVIEWS_KEY) and wait for its outcome, so one Cancel settles every caller and only one dialog opens.
const pendingSpaceAdoptions=new Map();
const REVIEWS_KEY="rig.spaceAdoptionReviews";
/** An owner refreshes its entry while it waits; an entry this much older belongs to a mod that stopped (a restart), and is replaced. */
const REVIEW_STALE_MS=5000;
/** How long a settled outcome stays for callers that were already waiting on it. */
const REVIEW_KEEP_MS=30000;
/** After the person cancels a review, a new review of the same connection/space within this time refuses instead of asking
 *  again: another mod's slower route (a remote identity check can take seconds) must not reopen the question just answered. */
const CANCEL_HOLD_MS=10000;
const CANCELLED_JUST_NOW="This space's review was cancelled just now. Nothing was changed; open it again if you meant to.";
const reviewsOf=host=>host.shared?.(REVIEWS_KEY)??{};
/** Claim the review of `key` unless a live one exists: one synchronous read and write of the host's shared store. herdr-app keeps
 *  that store in one thread-local map that every mod calls synchronously (mods.rs shared/set_shared), so no other mod can run
 *  between the read and the write. Returns { claimed: true } or the existing entry to join, or a recent Cancel to honour. */
function claimReview(host,key,entry){
  const now=Date.now(),theirs=reviewsOf(host)[key];
  if(theirs?.settledAt&&theirs.cancelled&&now-theirs.settledAt<CANCEL_HOLD_MS)return {cancelled:true};
  if(theirs&&!theirs.settledAt&&now-(theirs.beat??0)<REVIEW_STALE_MS)return {join:theirs};
  writeReview(host,key,entry);
  return {claimed:true};
}
function writeReview(host,key,entry){
  if(!host.setShared)return;
  const now=Date.now(),all={...reviewsOf(host)};
  for(const [k,e] of Object.entries(all))if(e?.settledAt&&now-e.settledAt>REVIEW_KEEP_MS)delete all[k];
  if(entry)all[key]=entry;else delete all[key];
  host.setShared(REVIEWS_KEY,all);
}

/** The only address-change adoption stage. Writing roots call it before choosing a destination; read-only and marked lookups stay unchanged. */
export async function prepareRigSpaceAdoption(host,config,names,options={}){
  const machine=config?.daemonMachine||null,expected=rigOrigin(config?.daemonUrl),rigNames=nameSet(names);
  const pinnedId=value=>{const conn=value?.connections?.find(c=>c.id===value.connectionId);return conn?conn.expectedHostId:value?.expectedHostId;};
  const expectedHostId=pinnedId(config);
  const candidates=get(host,"spaces").filter(space=>(space.machine??(String(space.id).includes("/")?space.id.split("/")[0]:null))===machine
    &&rigTerminals(host,space,rigNames).some(t=>t.labels?.["herdr-openrig.origin"]&&!sameDaemonOrigin(t.labels["herdr-openrig.origin"],expected,machine)));
  if(!candidates.length)return {ok:true,space:null};
  const generation=host.gateToken?.()??gateGeneration(config?.connectionId);
  const current=()=>{
    const generationCurrent=host.gateCurrent?host.gateCurrent(generation):gateGeneration(config?.connectionId)===generation;
    // THIS connection's live config: a worker host serves several connections and answers the first's when asked for none.
    const live=host.currentConfig?.(config);
    return generationCurrent
      &&(!host.currentConfig||live&&!live.configInvalid&&gateSameConfig(config,live)&&rigOrigin(live.daemonUrl)===expected&&pinnedId(live)===expectedHostId);
  };
  const oldOrigins=[...new Set(candidates.flatMap(space=>rigTerminals(host,space,rigNames).map(t=>t.labels?.["herdr-openrig.origin"]).filter(Boolean)))];
  const refuse=reason=>({ok:false,unconfirmedSpace:true,reason:`Herdr cannot tell whether the existing space made with ${oldOrigins.join(", ")} belongs to ${config.daemonUrl}. ${reason} ${unconfirmedSpaceNextSteps(candidates[0].name??[...rigNames].at(-1)??"the rig")}`});
  if(!current())return refuse("OpenRig's connection changed. No space was adopted.");
  let identity;
  try{
    if(machine)identity=await host.prepareHome?.(config);
    else if(host.health)identity=await host.health(config.daemonUrl);
    else {const response=await gatedFetch(`${expected}/healthz`,undefined,undefined,config?.connectionId);if(response.ok)identity=await response.json();}
  }catch{return refuse("OpenRig's live host identity could not be checked. No space was adopted.");}
  if(!current())return refuse("OpenRig's connection changed. No space was adopted.");
  const liveId=hostLabelValue(identity?.selfHostId);
  if(!liveId||identity?.ok===false)return refuse("OpenRig did not confirm its live host identity. No space was adopted.");
  if(expectedHostId&&expectedHostId!==liveId)return refuse("OpenRig's live host identity does not match the expected host. Nothing was opened or relabelled.");
  const decisions=candidates.map(space=>({space,...classifyRigSpace(host,config,names,space,liveId)}));
  const excluded=new Set(decisions.filter(d=>d.kind==="theirs").map(d=>d.space.id));
  const scoped={...host,selfHostId:()=>liveId,
    spaces:()=>get(host,"spaces").filter(s=>!excluded.has(s.id)),
    terminals:()=>get(host,"terminals").filter(t=>!excluded.has(qualifiedSpace(t))),
    panes:()=>{const tabs=new Set(get(host,"spaces").filter(s=>excluded.has(s.id)).flatMap(s=>s.tabs??[]).map(t=>t.id));return get(host,"panes").filter(p=>!tabs.has(p.tab));}};
  const unknown=decisions.find(d=>d.kind==="unknown");
  if(unknown)return refuse("The existing rig space contains terminals whose OpenRig cannot be confirmed. It was left unchanged; no second space was opened.");
  const selected=decisions.filter(d=>d.kind==="ours-by-stamp");
  if(selected.length>1)return refuse("More than one existing space matches this OpenRig's host identity. No space was adopted.");
  if(!selected.length)return {ok:true,space:null,hostId:liveId,host:scoped};
  const decision=selected[0];
  const snapshot=JSON.stringify(classifyRigSpace(host,config,names,decision.space,liveId));
  const key=JSON.stringify([config?.connectionId??null,decision.space.id]);
  const automatic=identity.selfHostIdSource==="generated"||sessionVouch(decision.terminals,options);
  const binding=JSON.stringify([gateIdentity(config),expectedHostId,generation,liveId,identity.selfHostIdSource,automatic,snapshot]);
  // Across mods the gate generation is each mod's own counter, so the shared evidence leaves it out; every caller still checks its own generation through current().
  const sharedBinding=JSON.stringify([gateIdentity(config),expectedHostId,liveId,identity.selfHostIdSource,automatic,snapshot]);
  let pending=pendingSpaceAdoptions.get(key);
  if(pending&&pending.binding!==binding)return refuse("This space is already being checked under different settings or terminal evidence. Finish that review and open it again.");
  if(!pending){
    pending={binding,promise:Promise.resolve().then(async()=>{
      // Another mod's copy may already be reviewing this connection/space: wait for its outcome instead of opening a second review.
      const token=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const claim=claimReview(host,key,{token,binding:sharedBinding,beat:Date.now()});
      if(claim.cancelled)return refuse(CANCELLED_JUST_NOW);
      const theirs=claim.join;
      if(theirs){
        if(theirs.binding!==sharedBinding)return refuse("This space is already being checked under different settings or terminal evidence. Finish that review and open it again.");
        while(current()){
          const now=reviewsOf(host)[key];
          if(!now||now.token!==theirs.token)return refuse("The review of this space ended without an answer. Nothing was changed; open it again.");
          if(now.settledAt)return now.outcome?.ok?{ok:true}:refuse(now.outcome?.reason??"The review of this space was cancelled. Nothing was changed.");
          if(!host.wait)return refuse("This space is being reviewed in another window. Finish that review and open it again.");
          if(Date.now()-(now.beat??0)>=REVIEW_STALE_MS)return refuse("The review of this space stopped answering. Nothing was changed; open it again.");
          await host.wait(100);
        }
        return refuse("OpenRig's connection changed. No space was adopted.");
      }
      let personCancelled=false;
      const settle=outcome=>{const mine=reviewsOf(host)[key];if(mine?.token===token)writeReview(host,key,{...mine,settledAt:Date.now(),...(personCancelled?{cancelled:true}:{}),outcome:{ok:outcome.ok,...(outcome.ok?{}:{reason:outcome.reason})}});return outcome;};
      return settle(await (async()=>{
      if(!automatic){
        const confirmation={space:decision.space.id,origin:decision.terminals.find(t=>t.kind==="ours-by-stamp").terminal.labels["herdr-openrig.origin"],daemonUrl:config.daemonUrl};
        const answer=await confirmRigSpaceAdoption(host,confirmation,current,{token,beat:()=>{const mine=reviewsOf(host)[key];if(mine?.token===token&&!mine.settledAt)writeReview(host,key,{...mine,beat:Date.now()});}});
        if(answer!==true){personCancelled=answer==="cancel";return refuse("The existing space has a matching host stamp, but its identity is not unique. Review it before choosing Use it. Nothing was changed.");}
        if(!current())return refuse("OpenRig's connection changed. No space was adopted.");
        // A dialog authorises only the terminal snapshot the person saw.
        if(JSON.stringify(classifyRigSpace(host,config,names,decision.space,liveId))!==snapshot)return refuse("The rig space changed during its review. Nothing was relabelled.");
      }
      try{await relabelRigSpaceOrigin(host,config,decision,current);}
      catch(error){return refuse(String(error?.message??error));}
      return {ok:true};
      })());
    })};
    pendingSpaceAdoptions.set(key,pending);
  }
  try{
    const result=await pending.promise;
    if(!result.ok)return result;
    if(!current())return refuse("OpenRig's connection changed. No space was adopted for this request.");
    // Relabelling the space cannot change a running relay's destination. Report the actual argv, never a saved argv label.
    const relayOrigin=rigOrigin(machine?identity.daemonUrl:config.daemonUrl);
    const viewerNames=new Map(),display=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,160):'';
    const published=host.shared?.('rig.data'),ownPublished=publishedUnder(config,published)?(published?.byConnection?.[config.connectionId]??((config.connections?.length??0)<=1?published:null)):null;
    const ownTopology=(host.topology?.()??ownPublished?.topology??[]).filter(rig=>!rig.conn||rig.conn===config.connectionId);
    const nodes=[...Object.values(ownPublished?.nodesByRig??{}).flat(),...ownTopology.flatMap(rig=>Array.isArray(rig.seats)?rig.seats:(rig.pods??[]).flatMap(pod=>pod.seats??[]))]
      .filter(node=>!node.conn||node.conn===config.connectionId);
    const staleViewerTabs=decision.terminals.flatMap(({terminal:t})=>{
      const argv=t.foreground?.argv??t.argv;
      if(t.labels?.["herdr-openrig.role"]!=="attach"||!Array.isArray(argv)||argv.length!==3||!/(?:^|\/)rig-attach-relay\.cjs$/.test(argv[1]))return [];
      const payload=decodeRelayToken(argv[2]),origin=rigOrigin(payload?.daemonUrl);
      if(!relayOrigin||!origin||origin===relayOrigin)return [];
      const address=String(t.address??t.terminal??""),rawTab=t.labels?.["herdr.tab"],prefix=address.includes("/")?address.slice(0,address.indexOf("/"))+"/":"";
      const tab=decision.space.tabs?.find(tab=>tab.id===rawTab||tab.id===prefix+rawTab);
      const session=display(t.labels?.["herdr-openrig.attach"]),matches=nodes.filter(node=>(node.canonicalSessionName??node.session)===session);
      const logicalIds=[...new Set(matches.map(node=>display(node.logicalId)).filter(Boolean))];
      const seat=logicalIds.length===1?logicalIds[0]:session;
      const title=display(tab?.name??tab?.title);
      viewerNames.set(address,seat||(![rawTab,tab?.id,address].includes(title)&&title)||null);
      return [{terminal:address,tab:rawTab&&!rawTab.includes("/")?prefix+rawTab:rawTab,daemonUrl:payload.daemonUrl}];
    });
    const named=staleViewerTabs.map(t=>viewerNames.get(t.terminal)).filter(Boolean),unnamed=staleViewerTabs.length-named.length;
    const list=[...named,...(unnamed&&named.length?[`${unnamed} other Attach tab${unnamed===1?'':'s'}`]:[])];
    const joined=list.length>1?`${list.slice(0,-1).join(', ')} and ${list.at(-1)}`:list[0];
    const single=staleViewerTabs.length===1;
    const subject=named.length?`The Attach tab${single?'':'s'} for ${joined}`:single?'The Attach tab':`The ${unnamed} Attach tabs`;
    const viewerNotice=staleViewerTabs.length?{needsViewerRefresh:true,staleViewerTabs,
      reason:`Space recognised at the new address. ${subject} still ${single?'uses':'use'} the earlier address. Attach ${single?'that seat':'each seat'} again and choose Replace viewer. Nothing was restarted.`}:{};
    if(staleViewerTabs.length)host.setShared?.("rig.viewerRefreshNotices",{...(host.shared?.("rig.viewerRefreshNotices")??{}),[decision.space.id]:{...viewerNotice,conn:config.connectionId??null}});
    return {ok:true,space:decision.space,hostId:liveId,host:scoped,...viewerNotice};
  }finally{if(pendingSpaceAdoptions.get(key)===pending)pendingSpaceAdoptions.delete(key);}
}

async function confirmRigSpaceAdoption(host,confirmation,current,{token=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,beat=()=>{}}={}){
  if(host.confirmRigSpace)return host.confirmRigSpace(confirmation);
  if(!host.openOverlay||!host.wait||!host.shared||!host.setShared)return false;
  const overlay=host.openOverlay({mod:"rig-menu",kind:"dialog",modal:true,width:520,height:360,
    props:{target:{kind:"rig"},step:{action:"adopt-address-space",token,confirmation}}});
  try{
    let beatAt=Date.now();
    while(current()){
      const decision=host.shared("rig.spaceAdoptionDecisions")?.[token];
      if(decision)return decision==="allow"?true:"cancel"; // "cancel": the person said no (marks the space); false below: the connection changed
      if(Date.now()-beatAt>=1000){beat();beatAt=Date.now();}
      await host.wait(100);
    }
    return false;
  }finally{
    if(overlay)host.closeOverlay?.(overlay);
    const decisions={...(host.shared("rig.spaceAdoptionDecisions")??{})};delete decisions[token];host.setShared("rig.spaceAdoptionDecisions",decisions);
  }
}

/** Change only origin on the chosen space's proven terminals. A failed write never authorises creating a replacement space. */
async function relabelRigSpaceOrigin(host,config,decision,current){
  for(const {terminal,kind} of decision.terminals){
    if(kind!=="ours-by-stamp")continue;
    if(!current())throw Error("OpenRig's connection changed. No further terminal was relabelled.");
    const result=await host.hc(["label",terminal.address??terminal.terminal,`herdr-openrig.origin=${rigOrigin(config.daemonUrl)}`]);
    if(result?.code!==0)throw Error("Herdr could not finish updating the space's address. No second space was opened; retry the open to check the remaining terminals.");
    if(!current())throw Error("OpenRig's connection changed while updating the space. No second space was opened.");
  }
}
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
/** A rig space whose only content is the Rig page (its seat and Attach tabs were closed): no terminal is left to carry a label, and a mod pane carries none, so nothing durable names the rig.
 *  It is recognised by OUR creation signature plus the rig's name, never by a name alone: the id starts `sp-openrig-` (and is not the OpenRig home space), the space has no terminal at
 *  all, exactly one tab and that tab holds only a Rig page. */
function pageOnlyRigSpace(host,context,rigNames){
  const {space}=context,id=String(space.id),local=id.includes("/")?id.slice(id.indexOf("/")+1):id;
  if(context.home||!local.startsWith("sp-openrig-")||local.startsWith("sp-openrig-home-")||!rigNames.has(space.name))return false;
  if((space.tabs??[]).length!==1)return false;
  if(get(host,"terminals").some(t=>qualifiedSpace(t)===space.id))return false;
  const tabs=new Set(space.tabs.map(t=>t.id)),inSpace=get(host,"panes").filter(p=>tabs.has(p.tab));
  return inSpace.length>0&&inSpace.every(p=>!p.terminal&&p.mod==="rig-view");
}
function lookup(host,config,names,{markedOnly=false,sessions=null,hostId=null,servers=null,strictOrigin=false}={}){
  const expected=rigOrigin(config?.daemonUrl);if(!expected)return {space:null,unconfirmed:null};
  const rigNames=nameSet(names),machine=config?.daemonMachine||null;
  const state=host.routeState?.()??host.shared?.("rig.spaceState")??{};
  const onMachine=openRigSpaceContext(get(host,"spaces"),get(host,"terminals"),get(host,"panes"),state)
    .filter(context=>(context.space.machine??(context.id.includes("/")?context.id.split("/")[0]:null))===machine);
  const links=context=>markedOnly?context.markedRigLinks:context.rigLinks;
  // strictOrigin (every path that adopts, marks or builds into a space): a rig terminal with an origin must carry THIS daemon's. One WITHOUT an origin counts only when it carries OUR rig label
  // (herdr-openrig.rig: a space an older herdrig wrote before the origin label existed, which markRigSpace never gave one); a terminal labelled only in OpenRig's native namespace
  // (openrig.rig, openrig.seat, ...) never does, whatever its seat names say: two OpenRigs with a same-named rig have identical session names (<member>@<rig>). A space whose rig terminals are
  // all of that kind is never adopted, marked or built into: the open asks and writes nothing.
  const counts=(link,machineAlias=null)=>strictOrigin?(link.origin?sameOrigin(link.origin,expected,machineAlias):link.ours):sameOrigin(link.origin,expected,machineAlias);
  // Another daemon's explicit origin on a rig terminal is positive evidence the space is theirs (an alias spelling of this daemon's address on a box is not another daemon), so under strictOrigin it vetoes the space (not for the marked lookup: our own mark is our own adoption record, and a copied-label terminal inside our grid is handled by the grid) even when
  // one of our origin-less legacy terminals sits in it.
  const foreign=context=>strictOrigin&&!markedOnly&&links(context).some(link=>rigNames.has(link.rig)&&link.origin&&!sameOrigin(link.origin,expected,machine));
  const exact=onMachine.filter(context=>!foreign(context)&&links(context).some(link=>rigNames.has(link.rig)&&counts(link)));
  if(exact.length)return {space:(exact.find(context=>context.space.active)??exact[0]).space,unconfirmed:null};
  if(strictOrigin){
    const bare=onMachine.filter(context=>{const mine=links(context).filter(link=>rigNames.has(link.rig));return mine.length>0&&mine.every(link=>!link.origin&&!link.ours);});
    const labelledAlias=onMachine.some(context=>links(context).some(link=>rigNames.has(link.rig)&&link.origin&&machine&&sameOrigin(link.origin,expected,machine)));
    if(bare.length&&!labelledAlias)return {space:null,unconfirmed:{space:bare[0].space,origin:null,unvouched:true}};
  }
  // A rig space made with an origin that is not this daemon's (and no terminal of ours in it) is either CONFIRMED to be another OpenRig's (its host stamp is another daemon's: the open builds its own space beside it) or
  // CANNOT BE TOLD (no stamp, or a stamp we cannot compare: it may be this daemon at a new address): the open asks and writes nothing (RC9e), the same way it asks for a space it cannot vouch for.
  if(strictOrigin&&!markedOnly){
    const undecided=onMachine.filter(foreign).map(context=>({context,verdict:vouched(host,context.space,rigNames,{sessions,hostId,servers})})).find(item=>item.verdict!=="other");
    if(undecided){
      const link=links(undecided.context).find(item=>rigNames.has(item.rig)&&item.origin&&!sameOrigin(item.origin,expected,machine));
      return {space:null,unconfirmed:{space:undecided.context.space,origin:link?.origin??null,foreign:true}};
    }
  }
  // The last resort for the open that may adopt (not background activation): the rig's page-only space. One candidate is adopted; several are asked about, never guessed.
  const pageOnly=()=>{
    if(markedOnly)return {space:null,unconfirmed:null};
    const found=onMachine.filter(context=>pageOnlyRigSpace(host,context,rigNames));
    // A page-only space names no daemon (a mod pane carries no label): with two OpenRig connections on this machine
    // it may be the other one's, so it is never silently adopted here. But when a candidate DOES exist, say so as an
    // unconfirmed candidate rather than returning nothing: a caller that asks the person cannot build a second space
    // by mistake, while one that got only `{space:null,unconfirmed:null}` could reasonably go on to build one.
    if((config?.connections??[]).filter(c=>(c?.machine??null)===machine).length>1){
      return found.length?{space:null,unconfirmed:{space:found[0].space,origin:null,multiConnection:true}}:{space:null,unconfirmed:null};
    }
    if(found.length===1)return {space:found[0].space,unconfirmed:null};
    return found.length>1?{space:null,unconfirmed:{space:found[0].space,origin:null,ambiguous:found.length}}:{space:null,unconfirmed:null};
  };
  if(!machine)return pageOnly();
  const loose=onMachine.filter(context=>!foreign(context)&&links(context).some(link=>rigNames.has(link.rig)&&counts(link,machine)))
    .map(context=>({context,verdict:vouched(host,context.space,rigNames,{sessions,hostId,servers})}));
  const same=loose.filter(item=>item.verdict==="same").map(item=>item.context);
  if(same.length)return {space:(same.find(context=>context.space.active)??same[0]).space,unconfirmed:null};
  const unknown=loose.find(item=>item.verdict==="unknown")?.context;
  const origin=unknown?(links(unknown).find(link=>rigNames.has(link.rig))?.origin??null):null;
  return unknown?{space:null,unconfirmed:{space:unknown.space,origin}}:pageOnly();
}

/** What every open path says, and nothing new opens, when the rig's space on a machine can't be confirmed (ONE RIG == ONE SPACE: the grid,
 *  Attach and worker views all ask instead of making a second space). */
export const unconfirmedSpaceNextSteps=rigName=>`If this space belongs to another OpenRig, leave it open and use that OpenRig's connection. If you choose to replace this OpenRig's existing space, save any work in it before closing it, then open ${rigName} again from the selected connection.`;
export const unconfirmedSpaceReason=(rigName,machine,origin,daemonUrl,other=null)=>other?.foreign?`${rigName} already has a space${machine?` on ${machine}`:""} whose terminals were made with ${other.origin??"another address"}, not ${daemonUrl}, so Herdr cannot tell whether it is another OpenRig's or this OpenRig at a new address: nothing was opened, marked or built. ${unconfirmedSpaceNextSteps(rigName)}`:other?.multiConnection?`${rigName} has a rig space that holds only its Rig page, but with more than one OpenRig connection on this machine it may belong to another one of them: nothing was opened or built. Close it if it is not ${rigName}'s, or open ${rigName} from the connection it actually belongs to.`:other?.unvouched?`${rigName} already has a space${machine?` on ${machine}`:""} made of OpenRig's own native seats of a rig of that name, but none of its terminals carry ${daemonUrl}'s address, so Herdr cannot tell whose it is: nothing was opened, marked or built. If it is another OpenRig's, leave it and open ${rigName} from that one. This mod does not open a space of native seats as the rig space yet, so use those seats' own tabs.`:other?.ambiguous?`${rigName} has more than one rig space that holds only its Rig page (${other.ambiguous}), so nothing was opened or built: Herdr cannot tell which one is its space. Close the extra ones and open ${rigName} again.`:`${rigName} already has a space${machine?` on ${machine}`:""}, made with the address ${origin??"an earlier one"}. Herdr could not confirm it is the same OpenRig as ${daemonUrl}, so nothing new was opened. ${unconfirmedSpaceNextSteps(rigName)}`;
/** The rig the sidebar published (by id or name), for the sessions that vouch for a space of it; null when it isn't known. */
export function topologyRig(host,refs,config){
  // The sidebar's rows vouch only for the daemon they were read from: the same gate as every other reader of `rig.data` (a refused list or no config reads nothing; other settings' rows are not used).
  const published=host.topology?null:host.shared?.("rig.data");
  const topology=host.topology?.()??(config&&!config.configInvalid&&publishedUnder(config,published)?published?.topology:null)??[];
  const wanted=(refs??[]).filter(Boolean);
  return topology.find(rig=>wanted.some(ref=>rig.id===ref||rig.name===ref))??null;
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
    // Backstop: a terminal with no origin is stamped only when it carries OUR rig label; OpenRig's native seats (openrig.* labels alone) are never ours to stamp.
    if(!labels["herdr-openrig.origin"]&&!labels["herdr-openrig.rig"])continue;
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
          const link={rig,origin:labels["herdr-openrig.origin"]??null,ours:Boolean(labels["herdr-openrig.rig"])};rigs.add(rig);rigLinks.push(link);
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
