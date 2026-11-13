import {div,svg} from 'gpui-kit';
import {h_flex,v_flex} from 'gpui-base';
import {relativeTimeText,iconsAt} from './rig-lib.js';
import {workflowEntry,workflowWord,workflowSourceEntry,packetNextSteps,WORKFLOW_CAVEAT,RECEIPT_CAVEAT,WORKFLOW_PURPOSE_MISSING} from './rig-workflow.js';
const icon=iconsAt('mods/rig-view');
/** Read-only presentation. Suggested commands are only literal text and clipboard content. */
export class WorkflowPanel {
  constructor(page,{navigate,ownerEntry,queueEntry,time,monoFamily='JetBrains Mono'}={}){this.page=page;this.navigate=navigate;this.ownerEntry=ownerEntry;this.queueEntry=queueEntry;this.time=time;this.monoFamily=monoFamily;}
  muted(t,text){return div().text_size(11.5).text_color(t.dim).child(text);}
  link(t,id,label,entry){return div().id(id).text_size(12).text_color(entry?t.accent:t.dim)
    .when(!!entry,el=>el.cursor_pointer().tab_stop(true).on_click(()=>this.navigate(entry))
      .on_key_down((e,cx)=>{if(e.key==='enter'){cx.stop_propagation();this.navigate(entry);}})).child(label);}
  owner(t,id,session){return typeof session==='string'&&session.trim()?this.link(t,id,workflowWord(session),session==='INDETERMINATE'?null:this.ownerEntry(session)):div();}
  fields(t,rows){return v_flex().gap(4).children(rows.map(([label,value,mono])=>h_flex().gap(8).items_start().flex_wrap()
    .child(div().min_w(90).text_size(11.5).text_color(t.dim).child(label))
    .child(div().flex_1().min_w(80).text_size(12).when(!!mono,el=>el.font_family(this.monoFamily)).text_color(value==='unknown'||value==='not reported'?t.dim:t.foreground).child(value))));}
  command(t,id,text){return v_flex().gap(5).p(8).rounded(5).bg(t.raised).child(h_flex().gap(8).items_start()
    .child(div().flex_1().min_w(0).font_family(this.monoFamily).text_size(11.5).child(workflowWord(text)))
    .when(typeof text==='string'&&text!=='INDETERMINATE',el=>el.child(this.page.copyButton(t,text,id,'suggested command'))));}
  entry(context,wf,packet){return workflowEntry(context,wf,packet);}
  render(t,cx,entry,model){
    const context={project:entry.project??model.project,mission:entry.mission??model.mission};
    if(!model.supported)return this.muted(t,"This OpenRig doesn't serve workflow views.");
    const wf=model.instances.find(w=>w.id===entry.workflow);
    if(entry.workflow&&!wf)return this.muted(t,"This workflow isn't in the mission's current view.");
    if(!wf)return this.page.card(t,'Workflows',model.instances.length?model.instances.map((w,i)=>
      h_flex().id(`workflow-instance-${i}`).gap(8).items_center().flex_wrap()
        .child(this.link(t,`workflow-open-${i}`,w.title,this.entry(context,w)))
        .child(this.muted(t,w.status))):[
      div().text_size(12).child('No workflows are bound to this mission.'),
      h_flex().gap(3).flex_wrap().text_size(11.5).text_color(t.dim)
        .child(div().child("A workflow runs when a mission's lifecycle is instantiated:"))
        .child(div().font_family(this.monoFamily).child('rig workflow instantiate-lifecycle'))
        .child(div().child('. Its steps and current work then appear here.'))]);
    const packet=wf.packets.find(p=>p.packet_id===entry.packet);
    if(entry.packet&&!packet)return this.muted(t,"This packet is no longer current work in this workflow.");
    if(packet)return this.packet(t,context,wf,packet);
    const current=wf.steps.filter(s=>s.current),position=current.length===1?`step ${wf.steps.indexOf(current[0])+1} of ${wf.steps.length} · ${current[0].id}`:`${current.length} current steps`;
    const name=workflowWord(wf.workflow_name),version=`version ${workflowWord(wf.workflow_version)}`;
    this.page.pageHeading={title:wf.title,icon:'rig-split',status:`${wf.status} · ${position} · ${wf.title===name?'':name+' · '}${version} · as of ${this.time(model.derivedAt)}`};
    const tab=entry.workflowTab??this.page.activePageView??'work';
    if(tab==='obligations')return this.page.card(t,'Obligations',[
      this.muted(t,RECEIPT_CAVEAT),...wf.obligations.map((o,i)=>v_flex().id(`workflow-obligation-${i}`).gap(4)
        .child(div().text_size(12).child(`${workflowWord(o.stepId)} · ${o.required===true?'required':o.required===false?'extension':'unknown'} · ${workflowWord(o.state)} · ${o.receiptState==='not-required'?'no receipt needed':'receipt '+workflowWord(o.receiptState)}`))
        .when(!!o.receipt,el=>el.child(this.fields(t,[['Evidence',workflowWord(o.receipt.evidenceRef)],['Recorder',workflowWord(o.receipt.actorSession)],['At',this.time(o.receipt.closedAt,true)]]))))
    ]);
    if(tab==='plan')return this.plan(t,wf);
    return v_flex().gap(12).child(this.page.card(t,'Steps',wf.steps.map((s,i)=>{
      const closed=s.state==='closed',gate=!!s.gate;
      const mark=closed?svg(icon('check')).size(13).text_color(t.accent):gate?svg(icon('rig-lock')).size(13).text_color(t.working)
        :div().size(8).rounded(4).border_1().border_color(s.current?t.accent:t.dim).when(s.current,el=>el.bg(t.accent));
      return h_flex().id(`workflow-step-${i}`).gap(8).py(5).items_center().flex_wrap().child(mark)
        .child(div().min_w(80).text_size(12).child(s.id))
        .children(s.owners.map((owner,j)=>this.owner(t,`workflow-owner-${i}-${j}`,owner)))
        .child(this.muted(t,s.packets[0]?.latest_transition?.ts?`${workflowWord(s.packets[0].queue_state)} · ${relativeTimeText(s.packets[0].latest_transition.ts)}`:s.state))
        .when(s.current,el=>el.child(this.link(t,`workflow-step-open-${i}`,'open work',this.entry(context,wf,s.packets[0]))));
    })))
      .child(this.page.card(t,'Current work',[
        ...(wf.packets.length?[]:[this.muted(t,'No current work reported')]),...wf.packets.map((p,i)=>h_flex().gap(8).items_center().flex_wrap()
          .child(this.link(t,`workflow-packet-${i}`,workflowWord(p.step_id),this.entry(context,wf,p)))
          .child(this.muted(t,workflowWord(p.queue_state))).child(this.owner(t,`workflow-packet-owner-${i}`,p.owner))),this.muted(t,WORKFLOW_CAVEAT)]))
      .child(this.page.card(t,'Sources',wf.sources.filter(s=>s.kind==='slice').map((s,i)=>{
        const target=workflowSourceEntry(context,s);return this.link(t,`workflow-source-${i}`,target?`Slice ${target.slice}`:'Slice source not reported',target);
      })));
  }
  plan(t,wf){
    const recon=wf.reconciliation??{},graph=wf.graph_source??{};
    return v_flex().gap(12).child(this.page.card(t,'Plan and sources',[
      this.fields(t,[['Workflow',workflowWord(wf.workflow_name)],['Version',workflowWord(wf.workflow_version)],['Graph source',workflowWord(graph.mode)],
        ['Comparison',workflowWord(recon.status)],['Reasons',Array.isArray(recon.reasons)&&recon.reasons.length?recon.reasons.map(workflowWord).join('; '):'None reported'],['Input digest',workflowWord(wf.compiled_input_digest),true]]),
      ...wf.sources.map((s,i)=>h_flex().gap(8).items_center().flex_wrap().child(this.muted(t,workflowWord(s.kind)))
        .child(div().flex_1().min_w(0).font_family(this.monoFamily).text_size(11.5).text_color(t.foreground).child(workflowWord(s.path)))
        .child(this.page.copyButton(t,String(s.path??''),`workflow-plan-source-${i}`,'source path'))),
      ...wf.failures.filter(f=>f.status==='unresolved').map((f,i)=>v_flex().gap(4)
        .child(div().text_size(12).text_color(t.blocked).child(`${workflowWord(f.step_id)} · ${workflowWord(f.failure_reason)}`))
        .child(this.command(t,`workflow-failure-${i}`,f.targeted_action))),
      this.muted(t,wf.unknowns.length?wf.unknowns.map(workflowWord).join('; '):'No unknowns reported'),
      ...[['Instance id',wf.id],['Operation key',wf.operation_key]].map(([label,value])=>h_flex().gap(8).items_center().flex_wrap()
        .child(this.muted(t,label)).child(div().font_family(this.monoFamily).text_size(11.5).text_color(t.foreground).child(workflowWord(value)))
        .child(this.page.copyButton(t,String(value??''),`workflow-copy-${label}` ,label)))
    ])).child(this.page.card(t,'Next action',[
      this.muted(t,"Run by the owner when needed. herdrig shows it; it doesn't run it."),this.command(t,'workflow-reconcile-action',recon.nextAction)]));
  }
  packet(t,context,wf,p){
    this.page.pageHeading={title:`Work · ${workflowWord(p.step_id)}`,status:`${workflowWord(p.queue_state)} · ${workflowWord(p.owner)} · ${relativeTimeText(p.latest_transition?.ts)}`,
      statusView:h_flex().gap(6).items_center().flex_wrap().child(this.muted(t,workflowWord(p.queue_state)))
        .child(this.owner(t,'workflow-packet-owner',p.owner)).child(this.muted(t,relativeTimeText(p.latest_transition?.ts)))};
    const blocker=p.blocker??{},wake=p.wake_schedule??{},transition=p.latest_transition??{};
    const wakeText=Number.isFinite(wake.interval_seconds)?`scheduled check every ${wake.interval_seconds} s (a check, not guaranteed delivery)`
      :p.wake?.kind==='epoch'||p.wake?.phase==='pending'?'wake pending':p.wake?`${workflowWord(p.wake.kind)} · ${workflowWord(p.wake.phase)}`:'No wake reported';
    return v_flex().gap(12)
      .child(this.page.card(t,'Purpose',[div().text_size(12).text_color(p.objective==='INDETERMINATE'?t.dim:t.foreground).child(p.objective==null?WORKFLOW_PURPOSE_MISSING:workflowWord(p.objective))]))
      .child(this.page.card(t,'Waiting and continuation',[
        this.fields(t,[['Last change',workflowWord(transition.transition_note)],['Recorded by',workflowWord(transition.actor_session)],['At',this.time(transition.ts,true)],['Wake',wakeText]]),
        ...(p.blocked_on?[h_flex().gap(8).items_center().flex_wrap().child(this.muted(t,'Blocked on'))
          .child(this.link(t,'workflow-blocker',workflowWord(blocker.summary??p.blocked_on),this.queueEntry(blocker.qitem_id??p.blocked_on)))
          .child(this.muted(t,workflowWord(blocker.state))).child(this.owner(t,'workflow-blocker-owner',blocker.destination_session))]:[])]))
      .child(this.page.card(t,'Next action',[
        this.muted(t,"Run by the owner when the work is done. herdrig shows it; it doesn't run it."),this.command(t,'workflow-targeted-action',p.targeted_action)]))
      .child(this.page.card(t,'Then',packetNextSteps(wf,p).map(s=>v_flex().gap(4).child(div().text_size(12).child(s.id))
        .when(!!s.gate,el=>el.child(this.muted(t,`${workflowWord(s.gate.target)} · ${workflowWord(s.gate.summary)}`))))
        .concat(packetNextSteps(wf,p).length?[]:[this.muted(t,'No next step reported')])) )
      .child(h_flex().gap(8).items_center().flex_wrap().child(this.link(t,'workflow-queue-item',p.packet_id,this.queueEntry(p.packet_id)).font_family(this.monoFamily))
        .child(this.page.copyButton(t,p.packet_id,'workflow-packet-id','queue item id')))
      .child(this.muted(t,`Evidence · ${p.evidence_ref==null?'none yet':workflowWord(p.evidence_ref)}`));
  }
}
