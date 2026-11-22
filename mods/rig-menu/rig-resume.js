import {div} from 'gpui-kit';
import {v_flex} from 'gpui-base';
import {readCommand,relativeTimeText} from './rig-lib.js';
import {formatAbsoluteTime} from './rig-time.js';
import {plainError} from './rig-words.js';
import {isHerdrUrl} from './rig-openrig-http.js';

const ACTIONS={'resume-original':'resumes its conversation','fresh-primed':'starts fresh (seat policy)','awaiting-decision':'needs a decision','leave-attached':'left attached'};
const BUCKETS=[['originalConversation','Conversation back'],['agentRunningConversationUnproven','Agent running, conversation not proven'],['bareShell','Bare shell, no agent'],['sessionMissing','No session'],['unknown','Not reported yet']];
const UNMATCHED="herdrig couldn't match this seat to the rig's list; start it from its seat page.";
const errorText=error=>{const text=plainError(error).text.trim();return /[.!?]$/.test(text)?text:text+'.';};
const failure=(r,fallback)=>new Error(String(r?.stderr?.trim()||r?.error||fallback));
async function cli(host,config,args,json=true){
  const cmd=readCommand(config,json?[...args,'--json']:args,{env:['OPENRIG_HOST_SELECTED=local']});
  const r=await host.exec(cmd.command,cmd.args,{timeout:60000});
  if(r?.code!==0)throw failure(r,'OpenRig could not read this rig.');
  if(!json)return String(r.stdout??'');
  try{return JSON.parse(r.stdout);}catch{throw new Error("OpenRig's answer was not valid JSON.");}
}
export function restorePlan(value){
  if(value?.status!=='plan'||!Array.isArray(value.nodes)||value.mutated===true||value.error)throw new Error("OpenRig's answer was not a restore plan.");
  if(value.nodes.some(n=>!n||typeof n.logicalId!=='string'||!n.logicalId.trim()||!Object.prototype.hasOwnProperty.call(ACTIONS,n.intendedAction)))throw new Error("OpenRig's restore plan has an unrecognised seat action.");
  const summary=Object.keys(ACTIONS).map(key=>{const n=value.nodes.filter(x=>x.intendedAction===key).length;return n?`${n} ${(n===1?{'resume-original':'resumes its conversation','fresh-primed':'starts fresh','awaiting-decision':'needs a decision','leave-attached':'left attached'}:{'resume-original':'resume their conversations','fresh-primed':'start fresh','awaiting-decision':'need a decision','leave-attached':'left attached'})[key]}`:null;}).filter(Boolean).join(' · ');
  return{...value,supported:true,ready:true,summary};
}
export async function readRestorePlan(host,target,config){
  if(isHerdrUrl(config?.daemonUrl))return{supported:false,ready:true,transport:'herdr'};
  const help=await cli(host,config,['up','--help'],false);
  if(!/(?:^|\s)--plan(?:\s|,|$)/m.test(help))return{supported:false,ready:true};
  const response=await host.fetch(`${config.daemonUrl}/api/up`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceRef:target.rig,plan:true})});
  const value=await response.json();
  if(!response.ok)throw new Error(String(value?.error?.fact??value?.error??`OpenRig answered with error ${response.status}`));
  if((target.rigId&&value.rigId!==target.rigId)||(value.rigName&&value.rigName!==target.rig))throw new Error('The rig changed while its restore plan was read. Close this and open it again.');
  return restorePlan(value);
}
export function conversationRollCall(value,nodes=[]){
  if(!value||!Object.prototype.hasOwnProperty.call(value,'rollCall'))return{supported:false};
  const roll=value.rollCall;
  if(!Number.isInteger(roll?.agentSeats)||roll.agentSeats<0)throw new Error("OpenRig's roll call did not report its agent seats.");
  let total=0;
  const rows=BUCKETS.map(([key,label])=>{
    const b=roll[key];
    if(!b||!Number.isInteger(b.count)||b.count<0||!Array.isArray(b.seats)||b.seats.length!==b.count||b.seats.some(s=>typeof s!=='string')||typeof b.evidence!=='string')throw new Error("OpenRig's roll call was incomplete.");
    total+=b.count;
    return{key,label,...b,seats:b.seats.map(name=>{
      const matches=nodes.filter(n=>n.logicalId===name||n.canonicalSessionName===name);
      return{name,logicalId:matches.length===1&&typeof matches[0].logicalId==='string'?matches[0].logicalId:null};
    })};
  });
  if(total!==roll.agentSeats)throw new Error("OpenRig's roll-call counts did not match its agent seats.");
  return{supported:true,agentSeats:roll.agentSeats,rows:rows.filter(r=>r.count),didNotStart:roll.bareShell.count+roll.sessionMissing.count,unknown:roll.unknown.count};
}
export async function readConversationRollCall(host,target,config){
  if(isHerdrUrl(config?.daemonUrl))return{supported:false};
  const value=await cli(host,config,['ps','--nodes','--rig',target.rig,'--summary']);
  let nodes=[];
  // Inventory is only an identity map for actions; never use it to reconstruct a bucket.
  if(value?.rollCall?.bareShell?.count&&target.rigId){
    try{const response=await host.fetch(`${config.daemonUrl}/api/rigs/${encodeURIComponent(target.rigId)}/nodes`);if(response.ok){const body=await response.json();if(Array.isArray(body))nodes=body;}}catch{/* The names remain visible without an unproven action. */}
  }
  return conversationRollCall(value,nodes);
}
export function restorePlanView(t,plan,rig,button,fresh){
  if(!plan||plan.loading)return div().child("Reading OpenRig's restore plan…");
  if(plan.error)return v_flex().gap(6).child(div().child(`Couldn't read OpenRig's restore plan: ${errorText(plan.error)} Nothing was started.`)).child(button('resume-plan-retry','Retry','plan'));
  if(!plan.supported)return v_flex().gap(4).child(div().child(`Each seat of ${rig} comes back from the saved conversation where the harness allows; none starts fresh by itself.`)).child(div().child(plan.transport==='herdr'?"The restore plan and roll call aren't available over Herdr's connection yet.":"This OpenRig can't preview a restore."));
  const stamp=plan.snapshot?.createdAt;
  const instant=typeof stamp==='string'&&/^\d{4}-\d\d-\d\d \d\d:/.test(stamp)?stamp.replace(' ','T')+'Z':stamp;
  return v_flex().id('resume-plan').flex_1().min_h(0).gap(6)
    .child(div().id('resume-plan-snapshot').flex_none().child(plan.snapshot?`From the ${plan.snapshot.kind} snapshot taken ${relativeTimeText(instant)} (${formatAbsoluteTime(instant,{exact:true})})`:"No saved snapshot: OpenRig saves the current state, then restores from it."))
    .child(div().id('resume-plan-summary').flex_none().child(plan.summary))
    .when(plan.nodes.some(n=>n.intendedAction==='awaiting-decision'),el=>el.child(div().id('resume-plan-decision').flex_none().child("Seats that need a decision aren't started. Start them fresh here, or resume the rest now.")))
    .child(v_flex().id('resume-plan-rows').flex_1().min_h(0).gap(6).overflow_y_scrollbar().children(plan.nodes.map((n,i)=>v_flex().id(`resume-plan-seat-${i}`).gap(2)
      .child(div().child(`${n.logicalId} · ${ACTIONS[n.intendedAction]}`))
      .when(!!n.reason,el=>el.child(div().text_color(t.dim).child(plainError(n.reason).text)))
      .when(!!n.permission?.summary,el=>el.child(div().text_color(t.dim).child(String(n.permission.summary))))
      .when(!!n.runtimePrompt,el=>el.child(div().text_color(t.dim).child(String(n.runtimePrompt))))
      .when(n.intendedAction==='awaiting-decision'&&n.freshRequired===true,el=>el.child(fresh(`resume-plan-fresh-${i}`,n.logicalId))))));
}
export function rollCallView(t,roll,button,fresh){
  if(!roll||roll.loading)return div().child('Checking which conversations came back…');
  if(roll.error)return v_flex().gap(4).child(div().child(`Couldn't check which conversations came back: ${errorText(roll.error)}`)).child(button('resume-rollcall-check','Check again','rollcall'));
  if(!roll.supported)return div();
  return v_flex().id('resume-rollcall').gap(5).child(div().font_semibold().child(`Roll call · ${roll.agentSeats} agent seat${roll.agentSeats===1?'':'s'}`))
    .children(roll.rows.map(row=>v_flex().id(`resume-rollcall-${row.key}`).gap(2).tooltip(row.evidence)
      .child(div().text_color(['bareShell','sessionMissing'].includes(row.key)?t.blocked:row.key==='originalConversation'?t.working:t.muted).child(`${row.label}: ${row.count}`))
      .children(row.seats.map((s,i)=>div().id(`resume-rollcall-${row.key}-${i}`).child(s.logicalId??s.name)
        .when(row.key==='bareShell'&&!!s.logicalId,el=>el.child(fresh(`resume-rollcall-fresh-${i}`,s.logicalId)))
        .when(row.key==='bareShell'&&!s.logicalId,el=>el.tooltip(UNMATCHED))))))
    .child(button('resume-rollcall-check','Check again','rollcall'));
}
