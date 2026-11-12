// Bounded status changes only. A refresh or a newly opened view never starts a working pulse.
import {needTarget,needsToastFor,statusMark,WORKING_STATUS_PULSE_MS,NEED_STATUS_PULSE_MS} from "./rig-lib.js";
export const STATUS_START_MS=16,WORKING_PULSE_MS=WORKING_STATUS_PULSE_MS,NEED_PULSE_MS=NEED_STATUS_PULSE_MS;
export class StatusMotion {
  constructor(){this.scope=null;this.states=new Map();this.diamonds=new Map();this.pulses=new Map();this.sequence=0;this.seeded=false;this.knownNeeds=new Set();this.freshNeeds=new Set();this.needs=[];}
  reset(){this.states.clear();this.diamonds.clear();this.pulses.clear();this.knownNeeds=new Set();this.seeded=false;}
  close(){this.reset();this.closed=true;}
  begin(scope,cx,{attention,ready=Array.isArray(attention)}={}){
    if(scope!==this.scope){this.reset();this.scope=scope;}
    this.cx=cx;this.freshNeeds=new Set();
    this.needs=(attention??[]).filter(n=>needsToastFor(n)&&!["done","closed","canceled"].includes(n.state)).map(needTarget);
    if(ready){
      const ids=new Set(this.needs.map(n=>n.id));
      if(this.seeded)for(const id of ids)if(!this.knownNeeds.has(id))this.freshNeeds.add(id);
      this.knownNeeds=ids;this.seeded=true;
    }
  }
  seatNeeds(session,rig,logicalId){
    return this.needs.filter(n=>n.session===session||(n.rig===rig&&(n.logicalId??n.seat)===logicalId)).map(n=>n.id);
  }
  observe(key,status,needIds=[]){
    if(!key||this.closed)return null;
    const shape=statusMark(status).shape,working=shape==="glow",diamond=shape==="diamond",previous=this.states.get(key),previousDiamond=this.diamonds.get(key);
    if(status!=null&&status!=="unknown"){this.states.set(key,working);this.diamonds.set(key,diamond);}
    if(this.states.size>1024){const oldest=this.states.keys().next().value;this.states.delete(oldest);this.diamonds.delete(oldest);this.pulses.delete(oldest);}
    let pulse=this.pulses.get(key);
    if(pulse&&(pulse.kind==="working"?!working:pulse.need?!needIds.includes(pulse.need):!diamond))this.pulses.delete(key);
    const need=needIds.find(id=>this.freshNeeds.has(id));
    // Multiple marks of one identity in a render share one pulse and one pair of callbacks.
    const kind=(need&&pulse?.need!==need)||(previousDiamond===false&&diamond)?"need":previous===false&&working?"working":null;
    if(kind){
      pulse={kind,need:kind==="need"?need??null:null,started:false,elementId:`status-pulse-${++this.sequence}-${key}`};
      this.pulses.set(key,pulse);
      const duration=kind==="working"?WORKING_PULSE_MS:NEED_PULSE_MS;
      const valid=()=>!this.closed&&this.pulses.get(key)===pulse;
      this.cx.timer.after(STATUS_START_MS,live=>{if(!valid())return;this.cx=live;pulse.started=true;live.notify();});
      this.cx.timer.after(STATUS_START_MS+duration,live=>{if(!valid())return;this.cx=live;this.pulses.delete(key);live.notify();});
    }
    return this.pulses.get(key)??null;
  }
}
