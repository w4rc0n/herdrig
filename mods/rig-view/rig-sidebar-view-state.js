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
