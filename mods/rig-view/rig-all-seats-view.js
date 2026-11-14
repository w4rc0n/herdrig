import {div,svg} from 'gpui-kit';
import {h_flex,v_flex} from 'gpui-base';
import {allSeatsModel,allSeatsLayout} from './rig-all-seats.js';
import {statusLook,statusMark,relativeTimeText,iconsAt,MOD_IDS} from './rig-lib.js';
import {assistantWord,assistantTarget} from './rig-connected-assistants.js';
import {assistantEntry} from './rig-connected-assistants-view.js';
import {pageBodyLayout} from './rig-page-layout.js';

/** Uses the page's existing row keys, marks, Attach and seat menu. No data reads. */
export function allSeatsView(page,t,cx,models,attention,{navigate,menu,attach,openSpecs,orderMap={},hostedMembers=null}){
 const padding=pageBodyLayout(page.pageWidth).padding;
 const width=(page.pageWidth??960)-padding*2;
 const model=allSeatsModel(models,attention,{order:page.allSeatsOrder,pulse:page.pulseFilter,filter:page.filter??'',orderMap,hostedMembers});
 const layout=allSeatsLayout(width,model.rigWidth);
 const cell=(id,text,size=120,color=t.foreground)=>div().when(!!id,el=>el.id(id)).min_w(120).when(!!size,el=>el.w(size).flex_none()).when(!size,el=>el.flex_1())
  .truncate().text_size(12).text_color(color).tooltip(String(text??'')).child(text??'');
 const link=(id,rig)=>cell(id,rig.name,model.rigWidth,t.muted).cursor_pointer().hover(el=>el.underline()).on_click((_e,cx)=>{cx?.stop_propagation?.();navigate({section:'topology',kind:'rig',rigId:rig.id,name:rig.name});});
 const row=r=>{
  if(r.assistant){
   const m=r.assistant,target=assistantTarget(m,r.rig),entry=assistantEntry(m,r.rig),selected=page.pageSel===r.key,id=`${m.conn}-${m.seat}`,open=()=>navigate(entry);
   page.pageRows.push({key:r.key,entry,target,expandable:false,open});
   const last=m.lastCheckInAt?` · checked in ${page.time(m.lastCheckInAt)}`:'',cadence=m.expectedMinutes?` · every ${m.expectedMinutes} min`:'';
   const words=assistantWord(m.status)+last+cadence;
   const line=h_flex().px(6).min_h(34).gap(8).items_center().child(div().w(14).flex_none().child(svg(iconsAt(`mods/${MOD_IDS.view}`)('rig-queue')).size(14).text_color(t.muted).tooltip('Checks its own queue')))
    .child(cell(`all-assistant-name-${id}`,m.name,null));
   if(!layout.compact)line.child(link(`all-assistant-rig-${id}`,r.rig)).when(layout.runtime,el=>el.child(cell(null,'connected assistant',120,t.dim)))
    .child(cell(`all-assistant-status-${id}`,words,120,m.status==='check-in-overdue'?t.working:t.muted)).when(layout.runtime,el=>el.child(div().w(36).flex_none()));
   line.child(h_flex().id(`all-assistant-actions-${id}`).w(layout.attach?110:20).flex_none().when(selected,el=>el.child(page.moreButton(t,`all-assistant-more-${id}`,()=>menu(target)))));
   return v_flex().id(`all-assistant-row-${id}`).rounded(5).bg(selected?t.selection:t.background).hover(el=>el.bg(t.hover)).cursor_pointer()
    .on_click((e,cx)=>{if((e?.click_count??1)>=2)open();else page.selectPageRow(r.key,cx);}).on_mouse_down('right',()=>menu(target)).child(line)
    .when(layout.compact,el=>el.child(div().pl(26).text_size(11.5).text_color(t.muted).child(`${r.rig.name} · ${words}`)));
  }
  const {seat,rig}=r,id=`${rig.id}-${seat.session??seat.logicalId}`,selected=page.pageSel===r.key;
  const entry={section:'topology',kind:'seat',rig:rig.name,rigId:rig.id,name:seat.logicalId,session:seat.session,pod:seat.pod};
  const target={kind:'seat',rig:rig.name,rigId:rig.id,conn:rig.conn,session:seat.session,logicalId:seat.logicalId,runtime:seat.runtime,model:seat.model,
   lifecycle:models.find(m=>m.rig.id===rig.id)?.lifecycle,terminal:seat.terminal,attachable:r.attachable,status:seat.status,
   tmuxAttachCommand:seat.tmuxAttachCommand,host:seat.host,sessionAlive:r.attachable,allSeats:true,compactActions:!layout.attach};
  const open=()=>navigate(entry);
  page.pageRows.push({key:r.key,entry,target,expandable:false,open});
  const look=statusLook(r.status),age=r.since&&r.status!=='unknown'?relativeTimeText(r.since).replace(/ ago$/,'').replace('just now','<1m').replace(' min','m').replace(' hr','h').replace(/ days?$/,'d'):'';
  const words=`${look.word}${age?` · ${age}`:''}`,runtime=[seat.runtime,seat.model].filter(Boolean).join(' · ');
  const actions=()=>h_flex().w(layout.attach?110:20).gap(4).items_center().flex_none()
   .when(layout.attach&&r.attachable,el=>el.child(page.button(t,`all-seat-attach-${id}`,'Attach',(_e,cx)=>{cx?.stop_propagation?.();attach(target,cx);},{small:true,iconName:'terminal'})))
   .child(page.moreButton(t,`all-seat-more-${id}`,()=>menu(target)));
  const logical=String(seat.logicalId??seat.session??''),dot=logical.lastIndexOf('.');
  const name=h_flex().id(`all-seat-name-${id}`).min_w(120).flex_1().gap(0).items_center().tooltip([logical,runtime].filter(Boolean).join('\n'))
   .when(dot>=0,el=>el.child(div().min_w(0).max_w(80).truncate().text_color(t.dim).text_size(12.5).child(logical.slice(0,dot+1))))
   .child(div().min_w(0).truncate().text_color(t.foreground).text_size(12.5).child(logical.slice(dot+1)));
  const mark=()=>page.dot(t,r.status,14,seat.session,r.needIds);
  const el=v_flex().id(`all-seat-row-${id}`).py(layout.compact?6:0).min_h(layout.compact?48:34).gap(4).rounded(5)
   .bg(selected?(t.selection??t.selected):t.background).hover(el=>el.bg(t.hover)).cursor_pointer()
   .on_click((e,cx)=>{if((e?.click_count??1)>=2)open();else page.selectPageRow(r.key,cx);})
   .on_mouse_down('right',()=>menu(target));
  if(layout.compact)return el.child(h_flex().gap(6).px(6).items_center().child(mark()).child(name).when(selected,el=>el.child(actions())))
   .child(h_flex().id(`all-seat-line2-${id}`).pl(26).pr(6).min_w(120).gap(6).items_center()
    .child(div().id(`all-seat-rig-${id}`).min_w(0).max_w(Math.max(40,width-50-words.length*6.5)).truncate().text_size(11.5).text_color(t.muted).tooltip(rig.name).cursor_pointer().hover(el=>el.underline())
      .on_click((_e,cx)=>{cx?.stop_propagation?.();navigate({section:'topology',kind:'rig',rigId:rig.id,name:rig.name});}).child(rig.name))
    .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`· ${words}`)));
  return el.child(h_flex().px(6).h(34).gap(8).items_center().child(div().w(14).flex_none().child(mark())).child(name)
   .child(link(`all-seat-rig-${id}`,rig))
   .when(layout.runtime,el=>el.child(cell(`all-seat-runtime-${id}`,runtime,120,t.dim)))
   .child(cell(`all-seat-status-${id}`,words,120,t[statusMark(r.status).word]??t.muted))
   .when(layout.runtime,el=>el.child(div().w(36).flex_none().text_size(11.5).text_color(t.blocked).child(r.needIds.length?`◆ ${r.needIds.length}`:'')))
   .child(selected?actions():div().w(layout.attach?110:20).flex_none()));
 };
 const pulseName={idle:'idle',working:'working',blocked:'blocked',needs:'needs you',unreported:'not reported'}[page.pulseFilter]??page.pulseFilter;
 const noMatch=page.filter?`No seats match ‹${page.filter}›${pulseName?` in ${pulseName}`:''}.`:`No seats in ${pulseName??'the current filters'}.`;
 const empty=()=>{
  const key='all-seats-empty-action',open=cx=>{if(!models.length)openSpecs();else{page.pulseFilter=null;page.filter=null;navigate({section:'topology',topologyTab:'seats',filter:''});}cx?.notify?.();};
  page.pageRows.push({key,expandable:false,open});
  return v_flex().id('all-seats-empty').gap(6).child(div().text_size(12).text_color(t.dim)
  .child(models.length?noMatch:'No rigs are running.'))
  .child(div().id('all-seats-show-all').px(4).rounded(3).bg(page.pageSel===key?t.selection:t.background).text_size(12).text_color(t.accent).cursor_pointer().child(models.length?'Show all':'Open Specs to start one.')
   .on_click((_e,cx)=>open(cx)));
 };
 const group=g=>{
  const countItems=[['working',g.counts.working,t.ansi2],['needs you',g.counts.needs,t.blocked],['blocked',g.counts.blocked,t.blocked],
    ['idle',g.counts.idle,t.muted],['not reported',g.counts.unreported,t.dim]].filter(([,n])=>n);
  const line=h_flex().id(`all-seats-group-${g.rig.id}`).px(6).py(6).gap(6).items_center().flex_wrap().text_size(12).text_color(t.muted)
   .child(div().font_semibold().child(g.rig.name));
  if(g.state==='loading')line.child(div().text_color(t.dim).child('loading seats…'));
  else if(g.state==='failed'){
   const key=`all-seats-retry:${g.rig.id}`,retry=cx=>{page.read(cx,`/api/rigs/${encodeURIComponent(g.rig.id)}/nodes`,true);cx.notify();};
   page.pageRows.push({key,expandable:false,open:retry});
   line.child(div().text_color(t.dim).child(`Couldn't load seats for ${g.rig.name}.`))
    .child(div().id(`all-seats-retry-${g.rig.id}`).px(4).rounded(3).bg(page.pageSel===key?t.selection:t.background)
     .text_color(t.accent).cursor_pointer().child('Retry').on_click((_e,cx)=>retry(cx)));
  }
  else line.child(div().text_color(t.dim).child(`${g.total} seat${g.total===1?'':'s'}`))
   .children(countItems.map(([word,n,color])=>div().text_color(color).child(`· ${n} ${word}`)));
  if(g.assistantCount)line.child(div().text_color(t.dim).child(`· ${g.assistantCount} connected assistant${g.assistantCount===1?'':'s'}`));
  return v_flex().id(`all-seats-rig-${g.rig.id}`).gap(2).child(line).children(g.rows.map(row));
 };
 const result=v_flex().id('all-seats-table').gap(6);
 if(hostedMembers?.state==='unavailable')result.child(div().id('all-assistants-unavailable').text_size(11.5).text_color(t.dim).child(hostedMembers.line));
 else if(hostedMembers?.members?.some(m=>m.invalid))result.child(div().text_size(11.5).text_color(t.dim).child('Connected assistant unavailable (invalid address)'));
 if(!layout.compact)result.child(h_flex().id('all-seats-columns').px(6).gap(8).h(28).items_center().text_color(t.dim)
  .child(div().w(14).flex_none()).child(cell(null,'Seat',null,t.dim)).child(cell(null,'Rig',model.rigWidth,t.dim))
  .when(layout.runtime,el=>el.child(cell(null,'Runtime',120,t.dim))).child(cell(null,'Status',120,t.dim))
  .when(layout.runtime,el=>el.child(div().w(36).text_size(11).child('Needs'))).child(div().w(layout.attach?110:20).flex_none()));
 const failures=model.groups.filter(g=>g.state!=='ready');
 if(page.allSeatsOrder==='status'){
  result.children(failures.map(group)).children(model.rows.filter(r=>!r.assistant).map(row));
  const assistants=model.rows.filter(r=>r.assistant);
  if(assistants.length)result.child(div().id('all-assistants-heading').py(6).text_size(12).text_color(t.muted).font_semibold().child('Connected assistants')).children(assistants.map(row));
 }
 else result.children(model.groups.filter(g=>g.rows.length||g.state!=='ready'||!page.pulseFilter&&!page.filter).map(group));
 if(!model.rows.length&&!failures.length)result.child(empty());
 return result;
}
