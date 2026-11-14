import {div,svg} from 'gpui-kit';
import {h_flex,v_flex} from 'gpui-base';
import {assistantsForRig,assistantTarget,assistantWord} from './rig-connected-assistants.js';

export const assistantEntry=(member,rig)=>({section:'topology',kind:'assistant',conn:member.conn,rig:member.rig,rigId:rig.id,name:member.name,session:member.seat});
/** Same disclosure and queue-only rows in the sidebar and the Rig page; no activity/status marks. */
export function assistantGroup(t,cx,roster,rig,host){
 if(!roster||roster.state==='off')return null;
 if(roster.state==='unavailable')return div().id(`${host.prefix}-assistants-unavailable-${rig.id}`).pl(host.indent??0).py(4).text_size(11.5).text_color(t.dim).child(roster.line);
 const members=assistantsForRig(roster,rig.name,rig.conn),invalid=roster.members.some(m=>m.invalid);
 if(!members.length&&invalid)return div().text_size(11.5).text_color(t.dim).child('Connected assistant unavailable (invalid address)');
 if(!members.length&&!invalid)return null;
 const key=`assistants:${rig.conn}:${rig.id}`,open=host.folds?.[key]===true,entry={section:'topology',kind:'rig',conn:rig.conn,rigId:rig.id,name:rig.name};
 host.rows.push({key,foldKey:key,expandable:true,isOpen:open,parentKey:host.parentKey,entry});
 const toggle=(_e,cx)=>{cx?.stop_propagation?.();host.fold(key,!open);cx?.notify?.();};
 const group=v_flex().id(`${host.prefix}-assistants-${rig.id}`).gap(2);
 // The sidebar's ScrollHandle indexes direct children; pages retain their grouped layout.
 const append=(row,key)=>host.append?host.append(row,key):group.child(row);
 append(h_flex().id(`${host.prefix}-assistants-header-${rig.id}`).pl(host.indent??0).pr(8).h(24).gap(6).items_center().cursor_pointer().on_click(toggle)
  .child(svg(host.icon(open?'chevron-down':'chevron-right')).size(11).text_color(t.dim))
  .child(div().flex_1().truncate().text_size(12).font_semibold().text_color(t.muted).child('Connected assistants'))
  .child(div().text_size(11).text_color(t.dim).child(String(members.length))),key);
 if(open){
  for(const member of members){
   const target=assistantTarget(member,rig),rowKey=`assistant:${member.conn}:${member.seat}`,entry=assistantEntry(member,rig);
   const go=()=>host.open(entry);host.rows.push({key:rowKey,entry,target,parentKey:key,expandable:false,open:go});
   let row=h_flex().id(`${host.prefix}-assistant-${member.seat}`).pl((host.indent??0)+18).pr(8).h(26).gap(6).items_center().cursor_pointer().hover(s=>s.bg(t.hover))
    .on_click((e,cx)=>{if((e?.click_count??1)>=2)go();else host.select(rowKey,entry,cx);}).on_mouse_down('right',()=>host.menu(target))
    .child(svg(host.icon('rig-queue')).size(13).flex_none().text_color(t.muted).tooltip('Checks its own queue'))
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).tooltip(member.seat).child(member.name))
    .child(div().text_size(11).text_color(member.status==='check-in-overdue'?t.working:t.muted).child(assistantWord(member.status)));
   if(host.decorate)row=host.decorate(row,{rowKey,entry,popoutId:`assistant-popout-${member.conn}-${member.seat}`});
   append(row,rowKey);
  }
  if(invalid)append(div().text_size(11.5).text_color(t.dim).child('Connected assistant unavailable (invalid address)'));
  if(roster.truncated)append(div().text_size(11.5).text_color(t.dim).child('Showing the first 200 connected assistants.'));
 }
 return host.append?null:group;
}
