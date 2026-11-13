// Page location and view selection are independent of navigation history.
export const SYSTEM_PAGE_VIEWS = [["overview","Overview"],["people","People"],["config","Configuration"],["health","Health"],
  ["connections","Connections"],["usage","Usage"],["cost","Cost"],["notifications","Notifications"]];
export function pageViewKind(entry = {}) {
  if(entry.section==='scopes'&&entry.workflow)return entry.packet?'packet':'workflow';
  if(entry.section==='scopes'&&entry.mission&&!entry.slice)return 'mission';
  return entry.section === "topology" && ["rig","seat"].includes(entry.kind) ? entry.kind
    : entry.section === "specs" && entry.id ? "spec" : ["needs","system"].includes(entry.section) ? entry.section : null;
}
export function pageViewOptions(entry = {}, spec = null, counts = {}) {
  const kind=pageViewKind(entry);
  if(kind==='workflow')return counts.workflowsSupported===false?[]:[['work','Work'],['obligations','Obligations'],['plan','Plan and sources']];
  if(kind==='mission')return [['slices','Slices'],...(counts.workflowsSupported?[['workflows',`Workflows (${counts.workflows??0})`]]:[])];
  if(kind==="rig")return [["table","Table"],["recent","Recent"],["overview","Overview"],["graph","Graph"],["health","Health"]];
  if(kind==="seat")return [["activity","Activity"],["queue","Queue"],["files","Files"]];
  if(kind==="needs")return entry.id?[]:[["requests",`Requests (${counts.requests??0})`],["updates",`Updates (${counts.updates??0})`]];
  if(kind==="spec")return spec?.kind==="rig"?[["graph","Graph"],["yaml","YAML"]]:[["yaml","YAML"]];
  return kind==="system"?SYSTEM_PAGE_VIEWS:[];
}
export function selectedPageView(entry = {}, memory = {}, spec = null, counts = {}) {
  const kind=pageViewKind(entry), options=pageViewOptions(entry,spec,counts), allowed=new Set(options.map(([id])=>id));
  let explicit=kind==="rig"?entry.tab:kind==="seat"?entry.seatTab:kind==="needs"?entry.needsTab:kind==="spec"?entry.specTab
    :kind==='workflow'?entry.workflowTab:kind==='mission'?entry.missionTab
    :kind==="system"?(entry.subview==="usage-hosts"||entry.openUsageHosts?"usage":entry.subview??(entry.settingKey||entry.category?"config":null)):null;
  if(kind==="rig"&&!explicit&&entry.openRecent)explicit="recent";
  if(allowed.has(explicit)){memory[kind]=explicit;return explicit;}
  return allowed.has(memory[kind])?memory[kind]:options[0]?.[0]??null;
}
export function entryWithPageView(entry, view, {preserveScope=false}={}) {
  const kind=pageViewKind(entry), next={...entry};
  if(kind==="rig")next.tab=view;
  else if(kind==='workflow')next.workflowTab=view;
  else if(kind==='mission')next.missionTab=view;
  else if(kind==="seat")next.seatTab=view;
  else if(kind==="needs")next.needsTab=view;
  else if(kind==="spec")next.specTab=view;
  else if(kind==="system"){
    next.subview=view; // Explicit Overview must beat a remembered Health tab.
    if(!preserveScope){delete next.category;delete next.settingKey;delete next.openUsageHosts;}
    if(view!=="health"){delete next.healthRigId;delete next.healthRigName;delete next.healthQitem;}
  }
  return next;
}
export function visiblePageTabs(options, width) {
  return width < 480 ? { tabs:options.slice(0,3), more:options.slice(3) } : { tabs:options, more:[] };
}
export function pageSectionChoices(counts={}) {
  return [["topology","Topology"],["specs","Specs"],["scopes","Scopes"],["terminals","Terminals"],["needs","Needs"],["system","System"]]
    .map(([section,label])=>({label,count:counts[section]??null,entry:{section}}));
}
export function compactLocationCrumbs(crumbs, width) {
  return width<480&&crumbs.length>2?[crumbs[0],{text:"…",ancestors:crumbs.slice(1,-1)},crumbs.at(-1)]:crumbs;
}
