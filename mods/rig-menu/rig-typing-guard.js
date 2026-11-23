import {readCommand,typingGuardCommand,typingGuardState,heldMessageText,heldMessagePage,sameConfig} from './rig-lib.js';

export const TYPING_GUARD_UNSUPPORTED="This OpenRig can't keep reminders out while you type. A newer OpenRig can.";
export const TYPING_GUARD_HERDR="Quiet while I type isn't available over Herdr's connection yet. Use OpenRig's CLI.";
export const TYPING_GUARD_TIP="OpenRig's own reminders arrive as queue rows instead of typing into this seat. Messages people and agents send still type, but never over your draft. Reminders won't wake this seat while it's on.";
const capabilities=new Map();
const stamp=config=>JSON.stringify(config);
export const typingGuardReview = guard => guard?.nodeId ? JSON.stringify([
  guard.nodeId, guard.desiredMode, guard.desiredLevel, guard.effectiveMode, guard.effectiveLevel, guard.pending === true,
]) : null;

/** View-local operation state. Held bodies are never returned as diagnostics or published to shared state. */
export class SeatTypingGuard {
  constructor(host,config,seat,{version=null,label=seat}={}){this.host=host;this.config=config;this.seat=seat;this.label=label;this.version=version;this.items=[];this.total=0;this.generation=0;}
  live(){return !this.host.closed?.()&&sameConfig(this.config,this.host.currentConfig?.()??this.config);}
  async json(path,after=this.host.after){
    return new Promise((resolve,reject)=>{
      let settled=false,timer;
      const finish=(fn,value)=>{if(settled)return;settled=true;timer?.cancel?.();fn(value);};
      timer=after(15000,()=>finish(reject,new Error('OpenRig did not answer in time.')));
      const read=async()=>{
        const response=await this.host.fetch(`${this.config.daemonUrl}${path}`);
        if(!response.ok)throw new Error('OpenRig refused this read.');
        return response.json();
      };
      read().then(value=>finish(resolve,value),()=>finish(reject,new Error('OpenRig returned no usable answer.')));
    });
  }
  async load(){
    const generation=++this.generation;this.error=null;this.checking=true;
    if(String(this.config?.daemonUrl??'').startsWith('herdr://')){this.reason=TYPING_GUARD_HERDR;this.checking=false;return;}
    try{
      const identity=this.version??this.config.expectedHostId;
      const key=stamp(this.config),old=capabilities.get(this.config.connectionId);
      if(old&&(old.key!==key||old.identity!==identity))capabilities.delete(this.config.connectionId);
      let supported=identity&&old?.key===key&&old.identity===identity?old.supported:null;
      if(supported===null){
        const cmd=readCommand(this.config,['seat','set-typing-guard','--help']);
        const reply=await this.host.exec(cmd.command,cmd.args,{timeout:15000});
        if(!this.live()||generation!==this.generation)return;
        if(reply?.code!==0)throw new Error('Typing guard help did not complete.');
        supported=/\bqueue-only\b/.test(String(reply.stdout??''));
        if(identity)capabilities.set(this.config.connectionId,{key,identity,supported});
      }
      if(!supported){if(this.live()&&generation===this.generation)this.reason=TYPING_GUARD_UNSUPPORTED;return;}
      const status=await this.json(`/api/seat/status/${encodeURIComponent(this.seat)}`);
      if(!this.live()||generation!==this.generation)return;
      this.guard=status.typingGuard;this.state=typingGuardState(this.guard);
      this.reason=supported&&this.state?null:TYPING_GUARD_UNSUPPORTED;
    }catch{if(this.live()&&generation===this.generation){this.reason='This seat’s typing guard could not be read. Nothing was changed.';}}
    finally{if(generation===this.generation)this.checking=false;}
  }
  async set(mode,{review=typingGuardReview(this.guard)}={}){
    if(this.busy||!this.live()||this.reason)return{ok:false,text:this.reason??'This view is no longer current. Nothing was changed.'};
    this.busy=true;
    try{
      const fresh=await this.host.readConfig();
      if(!(this.host.sameConfig??sameConfig)(this.config,fresh)||!this.live())return{ok:false,text:'The connection changed. Nothing was sent.'};
      const status=await this.json(`/api/seat/status/${encodeURIComponent(this.seat)}`),guard=status.typingGuard;
      if(!this.live())return{ok:false,text:'This view is no longer current. Nothing was sent.'};
      if(!review||guard?.pending===true||typingGuardReview(guard)!==review){
        this.guard=guard;this.state=typingGuardState(guard);
        return{ok:false,text:'This seat’s typing guard changed. Open its menu again before replacing it. Nothing was changed.'};
      }
      const command=typingGuardCommand(this.config,this.seat,mode);
      if(!command)return{ok:false,text:TYPING_GUARD_HERDR};
      const result=await this.host.exec(command.command,command.args,{timeout:15000});
      if(!this.live())return{ok:false,text:'The connection changed while the request was running. Its result is not confirmed.'};
      if(result?.code!==0)return{ok:false,text:/invalid_typing_guard/.test(String(result?.stdout??'')+String(result?.stderr??''))?TYPING_GUARD_UNSUPPORTED:'The typing guard change is not confirmed. Read the seat’s status before trying again.'};
      await this.load();
      if(!this.live()||!this.state||this.reason)return{ok:false,text:'The typing guard change could not be read back. Its result is not confirmed.'};
      if(mode==='queue-only'&&(this.guard.desiredLevel!=='queue-only'||(!this.guard.pending&&this.guard.effectiveLevel!=='queue-only')))
        return{ok:false,treatedAsHold:this.state.treatedAsHold,text:this.state.treatedAsHold?`This OpenRig treated it as hold: managed compaction is paused for ${this.seat}.`:`OpenRig reports ${this.state.word}, but the Quiet change is not confirmed.`};
      if(mode==='off'&&this.guard.desiredMode!=='off')return{ok:false,text:'OpenRig did not report the guard as off. Its result is not confirmed.'};
      return{ok:true,text:mode==='off'?(this.guard.pending?`${this.label}: reminders will type again once its current operation finishes.`:`${this.label}: reminders type into this seat again.`):this.guard.pending?`${this.label}: quiet while you type, once its current operation finishes.`:`${this.label}: quiet while you type. OpenRig's reminders arrive as queue rows.`};
    }catch{return{ok:false,text:'The typing guard change is not confirmed. Read the seat’s status before trying again.'};}
    finally{this.busy=false;}
  }
  async more(after=this.host.after){
    if(this.loading||!this.live())return;this.loading=true;this.error=null;const generation=this.generation;
    try{
      if(!this.items.length){const count=await this.json(`/api/seat/held-messages/${encodeURIComponent(this.seat)}?limit=1&offset=0`,after);this.total=Number.isSafeInteger(count.total)?Math.max(0,count.total):0;}
      if(!this.live()||generation!==this.generation)return;
      const page=heldMessagePage(this.total,this.scanned??0);if(!page.limit)return;
      const list=await this.json(`/api/seat/held-messages/${encodeURIComponent(this.seat)}?limit=${page.limit}&offset=${page.offset}`,after);
      if(!this.live()||generation!==this.generation)return;
      this.scanned=(this.scanned??0)+page.limit;
      const seen=new Set(this.items.map(item=>item.id));
      this.items.push(...(Array.isArray(list.items)?list.items:[]).slice(0,20).reverse().filter(item=>typeof item.outboxId==='string'&&!seen.has(item.outboxId)).map(item=>({id:item.outboxId,time:heldMessageText(item.tsDispatched,128).text,sender:heldMessageText(item.senderSession??'OpenRig',256).text,summary:heldMessageText(String(item.body??'').split(/\r\n?|\n/)[0],512).text})));
    }catch{if(this.live()&&generation===this.generation)this.error='Held messages could not be read. No message was sent or retired.';}
    finally{if(generation===this.generation)this.loading=false;}
  }
  async detail(id,after=this.host.after){
    const generation=this.generation,seq=this.detailSeq=(this.detailSeq??0)+1;this.error=null;
    try{
      const reply=await this.json(`/api/seat/held-messages/${encodeURIComponent(this.seat)}?id=${encodeURIComponent(id)}`,after);
      if(!this.live()||generation!==this.generation||seq!==this.detailSeq)return;
      if(reply.entry?.outboxId!==id)throw new Error('Wrong message');
      const shown=heldMessageText(reply.entry.body,65536,{body:true});
      const copyText=heldMessageText(reply.entry.body,1048576,{body:true,maxLines:Infinity}).text;
      let copyLines=1,shownLines=1;
      for(const char of copyText)if(char==='\n')copyLines++;
      for(const char of shown.text)if(char==='\n')shownLines++;
      this.selected={id,...shown,copyText,copyLines,hiddenLines:Math.max(0,copyLines-shownLines)};
    }catch{if(this.live()&&generation===this.generation&&seq===this.detailSeq)this.error=`Held message ${heldMessageText(id,128).text} could not be read.`;}
  }
  close(){this.generation++;this.items=[];this.selected=null;this.scanned=0;this.loading=false;}
}
