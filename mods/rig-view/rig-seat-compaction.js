// Public OpenRig compaction receipts. A request is never proof that Claude compacted.
import {writeCommand,cliRefusal,asOf} from './rig-lib.js';
import {formatAbsoluteTime} from './rig-time.js';
import {isKnownUnsentError} from './rig-connections.js';
const STOP_WORDS={preparation_incomplete:'the restore map was not completed',draft_input_busy:'the input box is busy',draft_input_unknown:'the input box could not be read',draft_input_changed:'the input box changed',stale_generation:'the seat changed',map_complete_seat_never_idle:'the map is ready, but the seat did not become idle',preparation_needs_input:'the seat needs an answer to a prompt',occupant_generation_unavailable:'the seat generation could not be checked',terminal_policy_refused:'the terminal policy refused the request'};
const cancelled = reason => reason === 'compaction_cancelled' || reason === 'preparation_cancelled';
function observedTime(at,timezone){
  const date=new Date(at),today=new Date(Date.now()),utc=timezone==='UTC'||timezone==='Etc/UTC';
  const day=d=>utc?`${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`:d.toDateString();
  return day(date)===day(today)?asOf(date,timezone):`as of ${formatAbsoluteTime(date,{timezone,date:true})}`;
}
const changedSeat = session => `${session} changed since this page read it, so nothing was sent. Try again from its current card.`;
const UNCONFIRMED_REASON = "The last request wasn't confirmed. Use Send again anyway, or Clear this.";
const ACCEPTED_READ_FAILED = "The request reached OpenRig, but Herdrig couldn't refresh its state. Check the pane or OpenRig's CLI before trying again.";
const DISPATCH_CLOCK_SKEW_MS=3000;
const stageWords={preparing:'preparation started','compact-sent':'compaction sent','restore-sent':'restore requested','audit-sent':'restore check requested',cancelled:'cancelled','skipped-or-failed':'stopped'};
const contextPercent=node=>Number.isFinite(node.contextUsage?.usedPercentage)?Math.round(node.contextUsage.usedPercentage):null;
const timestamp=value=>typeof value==='number'?value:Date.parse(value??'');
export const compactionRuntime = n => ['claude-code','pi'].includes(n?.runtime);
export const compactionVersion = health => health?.semver??health?.openrigVersion?.semver??null;
export function compactionCommand(config, session, cancel=false) {
  const refusal=cliRefusal(config);if(refusal)throw Error(refusal);
  if(typeof session!=='string'||!session||session.startsWith('-')||/[\s\x00-\x1f\x7f]/.test(session))throw Error('This seat has no usable session address.');
  // No inherited or person-as-seat transport identity, no --operator/--skip-map.
  return writeCommand({...config,person:null},['compact',...(cancel?['--cancel']:[]),'--json','--',session]);
}
export function compactionConfirmation(seat,cancel=false){
  const name=seat.canonicalSessionName;
  return cancel?{title:'Cancel this compaction?',body:"A /compact already sent can't be undone. OpenRig stops the preparation and any restore steps still to come, without typing anything into the seat.",confirm:'Cancel compaction',dismiss:'Keep going'}
    :{title:`Compact ${name} now?`,body:seat.runtime==='pi'?`OpenRig asks ${name}'s Pi runner to compact natively when it's idle.`:`OpenRig asks ${name} to write a restore map, then sends /compact when it's idle and its input box is empty, then asks it to restore. Preparation has 3 minutes. If you're typing in that seat, finish first.`,confirm:'Compact now'};
}
export function compactionStartCopy(session){
  return {
    waitMs:15000,
    starting:'Starting compaction…',
    unsent:`The request wasn't sent, so nothing reached ${session}. Try again.`,
    uncertain:`OpenRig hasn't confirmed a start yet. The request may have reached it; check ${session}'s card before trying again.`,
  };
}
export function compactionSnapshot(node,status,tenures,hostId){
  const row=tenures?.rows?.[0],coverage=tenures?.coverage,source=tenures?.source;
  if(!node?.nodeId||status?.session_status!=='running'||status.current_occupant!==node.canonicalSessionName||status.runtime!==node.runtime||typeof row?.generationUuid!=='string'||!row.generationUuid.trim()||typeof row.generationOrdinal!=='string'||!/^\d+$/.test(row.generationOrdinal)||row.generationOrdinal==='0'
    ||row.nodeId!==node.nodeId||!hostId||source?.hostId!==hostId||!source.bootEpoch
    ||coverage?.status!=='retained_window'||coverage?.gapCount!==0||!Array.isArray(coverage?.gaps)||coverage.gaps.length||coverage.gapDetailsTruncated||tenures.schemaVersion!==1||tenures.stream!=='tenures'
    ||tenures.page?.through!==row.generationOrdinal||tenures.page.retainedHighWatermark!==row.generationOrdinal||tenures.page.withheld)return null;
  return {nodeId:node.nodeId,session:status.current_occupant,running:status.session_status,runtime:status.runtime,
    handoverAt:status.handover_at??null,generation:row.generationUuid,ordinal:row.generationOrdinal,
    hostId,bootEpoch:source.bootEpoch,watermark:tenures.page.through};
}
export const sameCompactionSnapshot=(a,b)=>Boolean(a&&b&&JSON.stringify(a)===JSON.stringify(b));
export function compactionView(data,{runtime,session,pending=false,localError=null,automatic=false,expectedAttemptId=null}={}){
  const p=data?.preparation,s=data?.state,compact=p?.compact;
  const guidance=[data?.guidance,data?.stranded?.detail,data?.owedRestore?.detail].filter(v=>typeof v==='string'&&v);
  if(localError)return {text:localError,live:false,cancel:false,guidance};
  if(runtime==='pi'){
    if(pending&&!expectedAttemptId)return {text:'Requested. Waiting for the Pi runner.',live:true,cancel:false,guidance};
    if(expectedAttemptId&&s?.attemptId!==expectedAttemptId)return {text:"OpenRig hasn't reported this compaction request's result.",live:pending,cancel:false,guidance};
    const words={completed:'Compacted.',failed:'Compaction failed.',aborted:'Compaction was aborted.',unsupported:"This Pi runner can't compact.",uncertain:"OpenRig can't tell whether it compacted."};
    const requested=Date.parse(s?.requestedAt??''),age=Date.now()-requested;
    return {text:words[s?.status]??(pending?'Requested. Waiting for the Pi runner.':''),live:pending||s?.status==='uncertain'&&Number.isFinite(age)&&age>=0&&age<300000,cancel:false,guidance};
  }
  let text='',live=false,cancel=false;
  const reason=p?.reason??s?.reason??data?.reason??'';
  if(automatic&&p&&p.status!=='stopped'){text=`An automatic compaction is already under way for ${session}.`;live=true;}
  else if(compact==='uncertain')text='/compact may have reached the seat without Enter. Check the pane before trying again.';
  else if(s?.stage==='restore-sent'){text=`${session} was asked to restore from its map.`;live=true;}
  else if(s?.stage==='audit-sent')text=`${session} was asked to check its restore.`;
  else if(s?.stage==='cancelled'||s?.stage==='skipped-or-failed'||p?.status==='stopped'){
    const effect=compact==='submitted_unconfirmed'||compact==='uncertain'?'/compact may have been sent; check the pane before trying again.'
      :p?.delivery==='delivered'?`${session} got the request to write its map; /compact wasn't sent.`
      :p?.delivery==='uncertain'?`The map request may have reached ${session}; check the pane before trying again.`
      :p?.delivery==='not_sent'&&compact==='not_sent'?`Nothing was sent to ${session}.`
      :`OpenRig hasn't reported whether input was sent. Check the pane before trying again.`;
    text=cancelled(reason)?`Cancelled. ${effect}`:`Stopped: ${STOP_WORDS[reason]||'OpenRig stopped this attempt'}. ${effect}`;
  }else if(compact==='submitted_unconfirmed'||s?.stage==='compact-sent'){text="/compact was sent. OpenRig doesn't confirm that it ran; the context bar shows the result.";live=s?.stage!=='audit-sent';}
  else if(p&&(p.status==='waiting'||p.status==='sending')||s?.stage==='preparing'){
    text=p?.mapReadyAt?`Map ready; /compact goes in when ${session} is idle with an empty box.`:`Preparing: ${session} is writing its restore map${p?.deadlineAt?` (until ${new Date(p.deadlineAt).toISOString()})`:''}.`;
    live=true;cancel=!automatic&&p?.mode==='manual'&&(!compact||compact==='not_sent');
  }else if(pending){text='Requested. Waiting for OpenRig to start (this can take a few minutes).';live=true;}
  return {text,live:live||pending,cancel,guidance};
}

// No timers or handles here. The page calls tick from its existing owned timer.
export class SeatCompaction {
  constructor(host){this.host=host;this.support=new Map();this.unconfirmed=new Map();this.closed=false;}
  recovery(e){
    return this.host.readUnconfirmed?this.host.readUnconfirmed(e.recoveryKey):this.unconfirmed.get(e.recoveryKey);
  }
  saveRecovery(e,value){
    if(this.host.writeUnconfirmed)this.host.writeUnconfirmed(e.recoveryKey,value);
    else if(value)this.unconfirmed.set(e.recoveryKey,value);
    else this.unconfirmed.delete(e.recoveryKey);
  }
  clearRecovery(e,cx){
    if(this.closed||this.entry!==e||!this.recovery(e)||e.review||e.start||e.busy||e.cancelling||e.checking)return;
    this.resetRecovery(e);
    this.changed(e,cx);
  }
  resetRecovery(e){
    this.saveRecovery(e,null);
    e.recoveryToken=null;
    e.uncertain=false;
    e.error=null;
    e.requestedAttemptId=null;
  }
  recordRecovery(e,dispatch,accepted=false){
    if(e.dispatch!==dispatch)return;
    const current=this.recovery(e);
    if(current){
      if(accepted&&current.token===dispatch.token)this.saveRecovery(e,{...current,accepted:true});
      return;
    }
    if(e.recordedDispatch===dispatch.token)return;
    // A later receipt failure must not restore a warning the user cleared.
    e.recordedDispatch=dispatch.token;
    e.recoveryToken=dispatch.token;
    this.saveRecovery(e,{...dispatch,attemptId:e.requestedAttemptId??null,accepted});
  }
  keepPendingRecovery(e){
    if(e?.start?.dispatched&&e.dispatch?.token===e.start.token)this.recordRecovery(e,e.dispatch);
  }
  recoveryClock(at){return formatAbsoluteTime(at,{timezone:this.host.timezone?.()});}
  checkRecovery(e,data,record){
    if(this.recovery(e)?.token!==record.token)return;
    const p=data?.preparation,s=data?.state,pi=e.node.runtime==='pi';
    const updated=timestamp(pi?s?.requestedAt:s?.updatedAt);
    const recent=Number.isFinite(updated)&&updated>=record.at;
    const sameAttempt=record.attemptId&&(pi?s?.attemptId:p?.attemptId)===record.attemptId;
    const preparation=!Number.isFinite(updated)&&p?.mode==='manual'&&p.attemptId&&p.attemptId!==record.baseline;
    const stage=pi?(s?.status==='completed'?'completed':null):Object.hasOwn(stageWords,s?.stage)?stageWords[s.stage]:null;
    const isBaseline=p?.attemptId&&p.attemptId===record.baseline;
    const matched=record.attemptId?sameAttempt:!isBaseline&&(recent||preparation);
    const settled=pi?s?.status==='completed'&&matched
      :p?.mode!=='automatic'&&p?.compact!=='uncertain'&&matched&&(stage||preparation);
    if(settled){
      const at=this.recoveryClock(recent?updated:Date.now()),seat=e.node.canonicalSessionName,words=stage??stageWords.preparing;
      this.resetRecovery(e);
      e.recoveryEvidence=recent?`OpenRig recorded a manual compaction for ${seat} at ${at} (${words}), after your request.`
        :`At ${at}, Herdrig saw OpenRig's manual compaction record for ${seat} (${words}), after your request.`;
      return;
    }
    this.saveRecovery(e,{...record,contextNow:contextPercent(e.node)});
  }
  show(cx,config,node,version=null){
    const key=JSON.stringify([this.host.identity(config),node.nodeId,node.canonicalSessionName,node.runtime]);
    let e=this.entry;
    if(e?.key===key){
      e.node={...node};
      if(e.recoveryToken&&!this.recovery(e)){
        e.recoveryToken=null;
        e.uncertain=false;
        e.error=null;
      }
      // An upgrade refreshes support without dropping an open review or a receipt's uncertainty.
      if(!version||version===e.version||e.reading||e.polling||e.busy||e.cancelling||e.review||e.start)return e;
      e.version=version;
      e.reading=true;
    }else{
      this.keepPendingRecovery(e);
      const recoveryKey=JSON.stringify([config.connectionId,config.daemonUrl,config.openrigHome,node.canonicalSessionName]);
      e=this.entry={key,recoveryKey,config,version,node:{...node},busy:false,reading:true,data:null,snapshot:null,nextAt:0};
    }
    cx?.spawn?.(async task=>{
      try{
        const op=this.host.operation(config);
        // A cold card can key its first probe from the health read it already needs.
        const cold=!e.version;
        const initialHealth=cold?await this.host.get(config,'/healthz',op):null;
        if(cold){
          if(this.closed||this.entry!==e)return;
          e.version=compactionVersion(initialHealth);
        }
        await this.probeSupport(e,op);
        const status=await this.host.get(config,`/api/seat/status/${encodeURIComponent(node.canonicalSessionName)}`,op);
        const [tenure,health]=await Promise.all([this.host.get(config,`/api/telemetry/v1/nodes/${encodeURIComponent(node.nodeId)}/tenures?limit=1`,op),cold?initialHealth:this.host.get(config,'/healthz',op)]);
        e.snapshot=compactionSnapshot(node,status,tenure,health.selfHostId);
        await this.readState(e,op);
        e.automatic=e.data?.preparation?.mode==='automatic';e.nextAt=Date.now()+5000;
      }catch(error){e.error=String(error.message??error);}
      finally{e.reading=false;this.changed(e,task);}
    });return e;
  }
  async probeSupport(e,op,retry=false){
    const config=e.config,id=JSON.stringify([this.host.identity(config),e.version]);
    e.cliReason=this.host.cliReason?.(config)??null;
    if(config.daemonUrl?.startsWith('herdr://')||e.cliReason)return;
    const cached=this.support.get(id);
    if(!retry&&cached!==undefined){e.support=cached;return;}
    if(retry)this.support.delete(id);
    try{e.support=await this.host.help(config,op);}
    catch{e.support=null;}
    if(typeof e.support==='boolean'&&!this.closed&&this.entry===e)this.support.set(id,e.support);
  }
  supportReason(e){
    if(e.support===true)return null;
    return e.support===false?"This OpenRig can't compact a seat on request.":"Couldn't check compaction support. Check again to retry.";
  }
  reason(e,resend=false){
    const recovery=this.recovery(e);
    if(!resend&&recovery)return recovery.accepted
      ?"OpenRig accepted the last request, but its state couldn't be refreshed. Use Send again anyway, or Clear this."
      :UNCONFIRMED_REASON;
    if(e.reading||e.checking)return 'Checking compaction support…';
    if(e.config.daemonUrl?.startsWith('herdr://'))return "Not available over Herdr's connection yet.";
    const unsupported=e.cliReason??this.supportReason(e);
    if(unsupported)return unsupported;
    const uncertain=e.uncertain||e.data?.preparation?.compact==='uncertain'||e.node.runtime==='pi'&&e.data?.state?.status==='uncertain';
    return e.node.sessionStatus!=='running'?"This seat isn't running.":!e.snapshot?'The current seat generation could not be checked. Look again.':!resend&&uncertain?'Check the seat before another compaction request.':e.busy||e.review||e.start?'A compaction request is already open.':e.automatic&&compactionView(e.data,{runtime:e.node.runtime,session:e.node.canonicalSessionName,automatic:true}).live?'An automatic compaction is already under way.':null;
  }
  view(e,forPolling=false){
    const v=compactionView(e.data,{runtime:e.node.runtime,session:e.node.canonicalSessionName,pending:e.busy,localError:forPolling?null:e.error,automatic:e.automatic,expectedAttemptId:e.requestedAttemptId});
    if(e.start)return {...v,text:e.start.copy.starting,live:true,cancel:false};
    const recovery=this.recovery(e);
    if(recovery){
      const {at,contextBefore,contextNow}=recovery;
      const evidence=contextNow!=null&&contextBefore!=null&&contextNow<contextBefore?`Context is now ${contextNow}% (was ${contextBefore}% when you asked).`:null;
      const text=recovery.accepted?ACCEPTED_READ_FAILED:`Your compaction request at ${this.recoveryClock(at)} wasn't confirmed. OpenRig may or may not have compacted ${e.node.canonicalSessionName}.`;
      return {...v,text,live:false,cancel:false,recovery:true,evidence};
    }
    if(e.recoveryEvidence)v.evidence=e.recoveryEvidence;
    if(e.config.daemonUrl?.startsWith('herdr://')||e.pollError)v.cancel=false;
    else if(!v.text&&!e.reading&&!e.checking&&!e.cliReason&&e.support==null)v.text=this.supportReason(e);
    if(v.live&&e.pollStartedAt!=null&&Date.now()-e.pollStartedAt>=300000){v.live=false;if(e.node.runtime==='claude-code'&&v.text)v.text+=` (${observedTime(e.observedAt??e.pollStartedAt,this.host.timezone?.())})`;}
    return v;
  }
  async readState(e,op,{start,poll=false}={}){
    const read=e.stateRead=(e.stateRead??0)+1;
    const active=()=>!this.closed&&this.entry===e&&!start?.expired;
    let data;
    try{
      data=await this.host.get(e.config,`/api/compaction/state?session=${encodeURIComponent(e.node.canonicalSessionName)}`,op??this.host.operation(e.config));
    }catch(error){
      if(!active()||e.stateRead!==read)return null;
      if(!poll)throw error;
      const detail=String(error.message??error);
      if(e.pollError!==detail)console.error(`Couldn't refresh compaction state: ${detail}`);
      e.pollError=detail;
      return null;
    }
    if(!active())return null;
    const applied=e.stateRead===read;
    if(applied){
      e.pollError=null;
      this.observed(e,data);
    }
    // A command can still verify its receipt against this read, even if a newer
    // read has already taken over the card's displayed state.
    return {applied,data};
  }
  observed(e,data){
    e.data=data;e.observedAt=Date.now();e.automatic=data?.preparation?.mode==='automatic';
    const live=compactionView(data,{runtime:e.node.runtime,session:e.node.canonicalSessionName,automatic:e.automatic,expectedAttemptId:e.requestedAttemptId}).live;
    const preparationId=data?.preparation?.attemptId;
    const attempt=preparationId??data?.state?.attemptId??data?.state?.requestedAt??'unidentified';
    const start=e.start;
    // Released Claude triggers return after preparation, without an attempt ID.
    // Before the receipt, require a new preparation consistent with this anonymous CLI request.
    const actor=data?.preparation?.policyActor;
    const preparationAt=timestamp(data?.preparation?.requestedAt??data?.state?.requestedAt??data?.state?.updatedAt);
    const pendingPreparation=['sending','waiting'].includes(data?.preparation?.status)
      &&(!actor||actor.source==='caller'&&actor.session==null)
      &&(!Number.isFinite(preparationAt)||preparationAt>=start?.dispatchedAt-DISPATCH_CLOCK_SKEW_MS);
    if(start?.dispatched&&Date.now()<start.deadline&&(
      e.node.runtime==='pi'
        ? e.requestedAttemptId&&data?.state?.attemptId===e.requestedAttemptId
        : data?.preparation?.mode==='manual'&&preparationId
          &&(e.requestedAttemptId?preparationId===e.requestedAttemptId
            :preparationId!==start.baseline&&(start.allowBaseline||!start.receiptRead&&pendingPreparation))
    )){
      this.host.reportStart(start.token,'started');
      e.start=null;
    }
    // Time spent with an idle card does not consume a later attempt's budget.
    // Polling the same live attempt never extends it.
    if(live&&(!e.observedLive||e.observedAttempt!==attempt))e.pollStartedAt=e.observedAt;
    else if(!live)e.pollStartedAt=null;
    e.observedLive=live;e.observedAttempt=attempt;
    // Only an id from this call's own successful receipt can identify its result.
    // A new id seen in state, null/idle, or an automatic completion proves nothing.
    const id=e.requestedAttemptId,p=data?.preparation,s=data?.state;
    const terminal=Boolean(id)&&(e.node.runtime==='pi'?s?.attemptId===id&&['completed','failed','aborted','unsupported'].includes(s.status)
      :p?.attemptId===id&&p.mode==='manual'&&['audit-sent','cancelled','skipped-or-failed'].includes(s?.stage)&&p.compact!=='uncertain'&&p.delivery!=='uncertain');
    if(e.uncertain&&id&&terminal&&!this.recovery(e)){e.uncertain=false;e.error=null;}
  }
  changed(e,cx){if(!this.closed&&this.entry===e)this.host.notify(cx);}
  review(e,cancel=false,resend=false){
    const recovery=resend&&this.recovery(e);
    if(this.closed||this.entry!==e||resend&&!recovery||e.config.daemonUrl?.startsWith('herdr://')||(!cancel&&e.busy)||e.cancelling||e.review||(!cancel&&this.reason(e,resend))||(cancel&&!this.view(e).cancel))return;
    if(this.host.currentConfig&&this.host.identity(this.host.currentConfig(e.config))!==this.host.identity(e.config)){e.error=changedSeat(e.node.canonicalSessionName);return;}
    const token=`compact-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    e.review={token,cancel,recoveryToken:recovery?.token,expires:Date.now()+300000,snapshot:e.snapshot,operation:this.host.operation(e.config)};
    const seat=e.node.canonicalSessionName;
    const duplicateEffect=e.node.runtime==='pi'?`${seat}'s Pi runner may be asked to compact twice.`:`${seat} may be asked to write its restore map twice.`;
    const outcome=recovery?.accepted?"reached OpenRig, but Herdrig couldn't refresh its state. It":"wasn't confirmed and";
    const copy=recovery?{title:'Send another compaction request?',body:`The request at ${this.recoveryClock(recovery.at)} ${outcome} may already have run or still run. If both go through, ${duplicateEffect} Check its pane first if you can.`,confirm:'Send again',dismiss:'Cancel',focusCancel:true}:compactionConfirmation(e.node,cancel);
    this.host.confirm(e,token,copy,cancel?null:compactionStartCopy(e.node.canonicalSessionName));
  }
  expireStart(e,start,cx){
    start.expired=true;
    e.start=null;
    e.busy=false;
    e.uncertain=!!start.dispatched;
    e.error=start.dispatched?start.copy.uncertain:start.copy.unsent;
    if(start.dispatched&&e.dispatch?.token===start.token)this.recordRecovery(e,e.dispatch);
    this.host.reportStart?.(start.token,'error',e.error);
    this.changed(e,cx);
  }
  tick(cx){
    const e=this.entry;if(this.closed||!e)return;
    if(e.start&&Date.now()>=e.start.deadline)this.expireStart(e,e.start,cx);
    if(!e.review&&(e.reading||e.polling||Date.now()<e.nextAt||!this.view(e,true).live))return;
    if(e.review){
      const decision=this.host.decision(e.review.token);
      if(Date.now()>e.review.expires){e.review=null;this.changed(e,cx);}
      else if(decision){
        const review=e.review;e.review=null;
        if(decision.status==='expired'){
          e.error=compactionStartCopy(e.node.canonicalSessionName).unsent;this.changed(e,cx);
        }else if(decision==='allow'||decision.status==='allow'){
          if(!review.cancel&&typeof decision==='object'){
            const start=review.start=e.start={token:review.token,deadline:decision.deadline,
              allowBaseline:false,
              copy:compactionStartCopy(e.node.canonicalSessionName)};
            if(!Number.isFinite(start.deadline)||Date.now()>=start.deadline||!this.host.reportStart?.(start.token,'checking')){
              this.expireStart(e,start,cx);return;
            }
          }
          if(review.cancel)e.cancelling=true;
          else{e.busy=true;e.requestedAttemptId=null;e.pollStartedAt=Date.now();}
          e.error=null;this.changed(e,cx);cx.spawn(task=>this.act(e,review,task));
        }
      }
    }
    if(e.reading||e.polling||Date.now()<e.nextAt||!this.view(e,true).live)return;
    if(this.host.visible&&!this.host.visible(e))return;
    e.polling=true;e.nextAt=Date.now()+5000;
    cx.spawn(async task=>{
      try{await this.readState(e,null,{poll:true});}
      finally{e.polling=false;this.changed(e,task);}
    });
  }
  async check(e,cx){
    if(this.closed||this.entry!==e||e.reading||e.polling)return;
    e.polling=true;e.checking=true;this.changed(e,cx);
    try{
      const op=this.host.operation(e.config);
      await this.probeSupport(e,op,true);
      const tenure=await this.host.get(e.config,`/api/telemetry/v1/nodes/${encodeURIComponent(e.node.nodeId)}/tenures?limit=1`,op);
      const status=await this.host.get(e.config,`/api/seat/status/${encodeURIComponent(e.node.canonicalSessionName)}`,op);
      const health=await this.host.get(e.config,'/healthz',op);
      e.snapshot=compactionSnapshot(e.node,status,tenure,health.selfHostId);
      const recovery=this.recovery(e);
      const observed=await this.readState(e,op);
      if(observed?.applied){
        if(recovery){
          op.check();
          if(!this.closed&&this.entry===e)this.checkRecovery(e,observed.data,recovery);
        }
        else if(!e.uncertain)e.error=null;
      }
      e.nextAt=Date.now()+5000;
    }
    catch(error){
      if(this.recovery(e))e.pollError=String(error.message??error);
      else e.error=String(error.message??error);
    }finally{e.polling=false;e.checking=false;this.changed(e,cx);}
  }
  async act(e,review,cx){
    const start=review.start;
    let dispatched=false,received=false,accepted=false,dispatch=null,data=null,priorWarning=null;
    try{
      const op=review.operation??this.host.operation(e.config);
      const tenure=await this.host.get(e.config,`/api/telemetry/v1/nodes/${encodeURIComponent(e.node.nodeId)}/tenures?limit=1`,op);
      const status=await this.host.get(e.config,`/api/seat/status/${encodeURIComponent(e.node.canonicalSessionName)}`,op);
      if(start?.expired)return;
      const fresh=compactionSnapshot(e.node,status,tenure,review.snapshot?.hostId);
      if(this.closed||this.entry!==e||!sameCompactionSnapshot(review.snapshot,fresh)){
        e.error=changedSeat(e.node.canonicalSessionName);
        e.uncertain=false;
        return;
      }
      op.check();const command=compactionCommand(e.config,e.node.canonicalSessionName,review.cancel);if(!command)throw Error('This connection cannot run compaction.');
      if(!review.cancel)priorWarning=this.recovery(e);
      if(!review.cancel&&priorWarning?.token!==review.recoveryToken){
        e.error='The compaction warning changed. Check the current seat card before trying again.';
        return;
      }
      if(start){
        if(Date.now()>=start.deadline||!this.host.reportStart(start.token,'dispatched')){
          this.expireStart(e,start,cx);return;
        }
        start.dispatched=true;
      }
      // A state read started before this command cannot describe its result.
      const dispatchRead=e.stateRead=(e.stateRead??0)+1;
      if(!review.cancel){
        if(priorWarning)this.resetRecovery(e);
        dispatch=e.dispatch={token:review.token,at:Date.now(),baseline:e.data?.preparation?.attemptId??null,contextBefore:contextPercent(e.node)};
        if(start){
          start.dispatchedAt=dispatch.at;
          start.baseline=dispatch.baseline;
        }
        e.recoveryEvidence=null;
      }
      dispatched=true;const result=await this.host.exec(command,op,240000);
      received=true;
      if(start)start.receiptRead=true;
      try{data=JSON.parse(result.stdout);}catch{throw Object.assign(Error(result.stderr||'OpenRig returned no compaction receipt.'),{outcomeUnknown:true});}
      accepted=result.code===0&&data.ok===true;
      if(!review.cancel&&accepted&&typeof data.attemptId==='string'&&data.attemptId.trim()){
        const record=this.recovery(e);
        if(record?.token===dispatch.token)this.saveRecovery(e,{...record,attemptId:data.attemptId});
        if(!start?.expired)e.requestedAttemptId=data.attemptId;
      }
      if(start?.expired)return;
      if(start)start.allowBaseline=accepted&&data.session===e.node.canonicalSessionName&&data.stage==='compact-sent';
      const refused=result.code!==0||data.ok===false;
      if(refused&&data.preparation&&e.stateRead===dispatchRead)e.data=data;
      // Always read authoritative state; a trigger receipt alone never completes a request.
      const observed=await this.readState(e,op,{start});
      if(start?.expired)return;
      if(refused){
        // Released Claude triggers return a failure receipt when Cancel stops preparation.
        const receipt=data.preparation, latest=observed?.data?.preparation;
        const confirmedCancel=receipt?.attemptId&&receipt.attemptId===latest?.attemptId
          &&cancelled(receipt.reason)&&latest.status==='stopped'&&cancelled(latest.reason);
        if(!confirmedCancel)e.error=data.error??data.reason??'OpenRig refused compaction.';
      }
    }catch(error){
      // A gate refusal during readback describes the GET, never the preceding command.
      const unsent=!dispatched||(!received&&isKnownUnsentError(error));
      if(unsent&&priorWarning&&dispatch&&e.dispatch===dispatch){
        const current=this.recovery(e);
        if(current?.token===dispatch.token||!current&&e.recordedDispatch!==dispatch.token)this.saveRecovery(e,priorWarning);
      }
      if(!start?.expired){
        e.error=accepted?ACCEPTED_READ_FAILED
          :unsent?`${String(error.message??error)} Nothing was sent.`
          :`${String(error.message??error)} The request may have reached OpenRig. Check the pane or OpenRig's CLI before trying again.`;
        e.uncertain=!unsent;
        if(!unsent&&dispatch&&(accepted||typeof data?.ok!=='boolean'))this.recordRecovery(e,dispatch,accepted);
      }
    }
    finally{
      if(!start?.expired){
        if(start&&e.start===start&&e.error){this.host.reportStart(start.token,'error',e.error);e.start=null;}
        if(review.cancel)e.cancelling=false;else e.busy=false;
        e.nextAt=Date.now();this.changed(e,cx);
      }
    }
  }
  close(){this.keepPendingRecovery(this.entry);this.closed=true;this.entry=null;}
}
