// Sidebar presentation only. The old flat keys belong to the primary connection;
// daemon actions still resolve their own stamped target, never this view state.
export const SIDEBAR_VIEW_FIELDS = { 'rig.topology.view':'topologyView', 'rig.open.sidebar':'open', 'rig.sel':'selection' };
const validId=id=>typeof id==='string'&&/^conn-[A-Za-z0-9]{1,40}$/.test(id);
const mode=value=>value==='priority'||value==='rig';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function cleanSidebarView(value){
 if(!object(value))return {};
 const out={};
 if(mode(value.topologyView))out.topologyView=value.topologyView;
 if(object(value.open))out.open=Object.fromEntries(Object.entries(value.open).filter(([,v])=>typeof v==='boolean'));
 // A fold or view change does not select the row again: keep its identity too.
 if(object(value.selection)&&typeof value.selection.key==='string')out.selection=value.selection;
 return out;
}
export function cleanSidebarViews(value){
 return object(value)?Object.fromEntries(Object.entries(value).filter(([id])=>validId(id)).map(([id,row])=>[id,cleanSidebarView(row)])):{};
}
export function readSidebarView(shared,key,id,primary){
 if(!Object.hasOwn(SIDEBAR_VIEW_FIELDS,key))return undefined;
 const field=SIDEBAR_VIEW_FIELDS[key],stored=shared('rig.sidebar.views');
 const row=object(stored)&&Object.hasOwn(stored,id)?stored[id]:undefined;
 const owner=shared('rig.sidebar.primary');
 const legacy=id===primary&&(owner===undefined||owner===primary)?shared(key):undefined;
 const value=legacy!==undefined?legacy:object(row)&&Object.hasOwn(row,field)?row[field]:undefined;
 return field==='topologyView'?(mode(value)?value:'priority'):field==='open'?(object(value)?value:{}):value;
}
export function writeSidebarView(host,key,value,id,primary){
 if(!validId(id)||!validId(primary)||!Object.hasOwn(SIDEBAR_VIEW_FIELDS,key))return false;
 const views=cleanSidebarViews(host.shared('rig.sidebar.views'));
 const owner=host.shared('rig.sidebar.primary');
 views[primary]=cleanSidebarView({...views[primary],...(owner===undefined||owner===primary?{topologyView:host.shared('rig.topology.view')??'priority',open:host.shared('rig.open.sidebar')??{},selection:host.shared('rig.sel')}:{})});
 views[id]=cleanSidebarView({...views[id],[SIDEBAR_VIEW_FIELDS[key]]:value});
 host.setShared('rig.sidebar.views',views);
 if(id===primary){
  for(const [legacy,field]of Object.entries(SIDEBAR_VIEW_FIELDS))host.setShared(legacy,views[primary][field]??(field==='open'?{}:field==='topologyView'?'priority':null));
  host.setShared('rig.sidebar.primary',primary);
 }
 return true;
}

export const AWAY_STATE_FIELDS = {
  'rig.lastSeenNeedsAt': 'lastSeenNeedsAt',
  'rig.lastEndedModeApplicationId': 'lastEndedModeApplicationId',
  'rig.lastActiveModeApplicationId': 'lastActiveModeApplicationId',
};
const nonEmpty = value => typeof value === 'string' && value.length > 0;
export function cleanAwayState(value) {
  if (!object(value)) return {};
  const out = {};
  if (nonEmpty(value.lastSeenNeedsAt)) out.lastSeenNeedsAt = value.lastSeenNeedsAt;
  if (nonEmpty(value.lastEndedModeApplicationId)) out.lastEndedModeApplicationId = value.lastEndedModeApplicationId;
  if (nonEmpty(value.lastActiveModeApplicationId)) out.lastActiveModeApplicationId = value.lastActiveModeApplicationId;
  return out;
}
export function cleanAwayStates(value, { keepEmpty = false } = {}) {
  if (!object(value)) return {};
  const out = {};
  for (const [id, row] of Object.entries(value)) {
    if (!validId(id) || !object(row)) continue;
    const cleaned = cleanAwayState(row);
    if (keepEmpty || Object.keys(cleaned).length > 0) out[id] = cleaned;
  }
  return out;
}
export function readAwayState(shared, key, id, primary) {
  if (!validId(id) || !Object.hasOwn(AWAY_STATE_FIELDS, key)) return null;
  const field = AWAY_STATE_FIELDS[key], stored = shared('rig.away.states');
  const owner = shared('rig.away.primary');
  const legacy = id === primary && (owner === undefined || owner === primary) ? shared(key) : undefined;
  if (legacy !== undefined) return nonEmpty(legacy) ? legacy : null;
  const row = object(stored) && Object.hasOwn(stored, id) ? stored[id] : undefined;
  return object(row) && nonEmpty(row[field]) ? row[field] : null;
}
export function writeAwayState(host, patch, id, primary) {
  if (!validId(id) || !validId(primary) || !object(patch)) return false;
  const states = cleanAwayStates(host.shared('rig.away.states'), { keepEmpty: true });
  const owner = host.shared('rig.away.primary');
  if (!Object.hasOwn(states, primary) && (owner === undefined || owner === primary)) {
    const seeded = cleanAwayState({
      lastSeenNeedsAt: host.shared('rig.lastSeenNeedsAt'),
      lastEndedModeApplicationId: host.shared('rig.lastEndedModeApplicationId'),
      lastActiveModeApplicationId: host.shared('rig.lastActiveModeApplicationId'),
    });
    if (Object.keys(seeded).length > 0) states[primary] = seeded;
  }
  const nextRow = { ...(states[id] ?? {}) };
  for (const field of Object.values(AWAY_STATE_FIELDS)) {
    if (patch[field] !== undefined) {
      if (nonEmpty(patch[field])) nextRow[field] = String(patch[field]);
      else delete nextRow[field];
    }
  }
  states[id] = nextRow;
  host.setShared('rig.away.states', states);
  if (id === primary) {
    const primaryRow = states[primary] ?? {};
    for (const [legacyKey, field] of Object.entries(AWAY_STATE_FIELDS)) {
      if (nonEmpty(primaryRow[field]) || nonEmpty(host.shared(legacyKey))) {
        host.setShared(legacyKey, nonEmpty(primaryRow[field]) ? primaryRow[field] : null);
      }
    }
    host.setShared('rig.away.primary', primary);
  } else if (owner === undefined) {
    host.setShared('rig.away.primary', primary);
  }
  return true;
}
export function restoreAwayStateMap(host, primary) {
  if (!validId(primary)) return;
  const states = cleanAwayStates(host.shared('rig.away.states'), { keepEmpty: true });
  const owner = host.shared('rig.away.primary');
  if (!Object.hasOwn(states, primary) && (owner === undefined || owner === primary)) {
    const seeded = cleanAwayState({
      lastSeenNeedsAt: host.shared('rig.lastSeenNeedsAt'),
      lastEndedModeApplicationId: host.shared('rig.lastEndedModeApplicationId'),
      lastActiveModeApplicationId: host.shared('rig.lastActiveModeApplicationId'),
    });
    if (Object.keys(seeded).length > 0) states[primary] = seeded;
  }
  host.setShared('rig.away.states', states);
  const primaryRow = states[primary] ?? {};
  for (const [legacyKey, field] of Object.entries(AWAY_STATE_FIELDS)) {
    if (nonEmpty(primaryRow[field]) || nonEmpty(host.shared(legacyKey))) {
      host.setShared(legacyKey, nonEmpty(primaryRow[field]) ? primaryRow[field] : null);
    }
  }
  host.setShared('rig.away.primary', primary);
}

export function cleanNotifiedNeeds(value) {
  if (!object(value)) return null;
  const out = {};
  if (typeof value.seeded === 'boolean') out.seeded = value.seeded;
  if (object(value.seen)) {
    const seen = {};
    for (const [k, v] of Object.entries(value.seen)) {
      if (typeof v === 'string') seen[k] = v;
    }
    out.seen = seen;
  }
  return Object.keys(out).length > 0 ? out : null;
}
export function cleanNotifiedNeedsMap(value) {
  if (!object(value)) return {};
  const out = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!validId(id)) continue;
    const cleaned = cleanNotifiedNeeds(entry);
    if (cleaned) out[id] = cleaned;
  }
  return out;
}
