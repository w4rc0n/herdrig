import {div,svg} from "gpui-kit";
import {h_flex,v_flex} from "gpui-base";
import {settings} from "herdr";
import {routeGraph,graphSeatPath,nearestGraphSeat} from "./rig-graph-layout.js";
import {GraphMotion,GRAPH_TARGET_FADE_MS} from "./rig-graph-state.js";
import {statusMarkElement,seatStatus,statusLook} from "./rig-lib.js";

export const GRAPH_EDGE_LOOK={
  delegates_to:{width:1.5,color:"muted",head:"fill",word:"delegates"},
  escalates_to:{width:1.5,color:"muted",head:"fill",dashed:true,word:"escalates"},
  can_observe:{width:1,color:"dim",head:"open",dashed:true,word:"observes"},
  collaborates_with:{width:1,color:"dim",head:"dots",word:"collaborates"},
  spawned_by:{width:1,color:"muted",head:"fill",dashed:true,word:"spawned"},
  uses:{width:1,color:"dim",head:"open",dashed:true,word:"uses"},
};
const look=kind=>GRAPH_EDGE_LOOK[kind]??{width:1,color:"dim",head:"open",word:kind};
const placed=(x,y,w,h)=>div().absolute().left(x).top(y).w(w).h(h);
const direction=([ax,ay],[bx,by])=>by>ay?"down":by<ay?"up":bx>ax?"right":"left";
const distance=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);
const counted=(n,word)=>`${n} ${word}${n===1?"":"s"}`;

/** Border runs and rounded two-border elbows. Each element is a native GPUI element. */
export function graphPathElements(points,kind,t,assets,override={}){
  if(points.length<2)return[];
  const style={...look(kind),...override},color=override.color??t[style.color],w=style.width;
  const pts=points.filter((p,i)=>!i||distance(p,points[i-1])>0).map(p=>[...p]);if(pts.length<2)return[];
  const end=[...pts.at(-1)],dir=direction(pts.at(-2),end),head=style.head;
  if(head!=="dots"){
    const previous=pts.at(-2),trim=Math.min(5,distance(previous,end));
    pts.at(-1)[0]-=Math.sign(end[0]-previous[0])*trim;pts.at(-1)[1]-=Math.sign(end[1]-previous[1])*trim;
  }
  const radius=pts.map((p,i)=>i&&i<pts.length-1?Math.min(4,distance(pts[i-1],p)/2,distance(p,pts[i+1])/2):0),out=[];
  const finish=e=>{e.border_color(color);if(style.dashed)e.border_dashed();return e;};
  for(let i=0;i<pts.length-1;i++){
    let[x1,y1]=pts[i],[x2,y2]=pts[i+1];const dx=Math.sign(x2-x1),dy=Math.sign(y2-y1);
    x1+=dx*radius[i];y1+=dy*radius[i];x2-=dx*radius[i+1];y2-=dy*radius[i+1];
    // Native probe: a box thinner than 2px loses its single-side border. Leave one pixel behind the stroke.
    if(y1===y2)out.push(finish(placed(Math.min(x1,x2),y1-w/2,Math.abs(x2-x1),w+1).border_t(w)));
    else out.push(finish(placed(x1-w/2,Math.min(y1,y2),w+1,Math.abs(y2-y1)).border_l(w)));
  }
  for(let i=1;i<pts.length-1;i++){
    const[x0,y0]=pts[i-1],[x,y]=pts[i],[x2,y2]=pts[i+1],r=radius[i];if(!r)continue;
    let horizontal,vertical,bx,by;
    if(y0===y){horizontal=y2>y?"t":"b";vertical=x0<x?"r":"l";bx=x0<x?x-r:x;by=y2>y?y:y-r;}
    else{horizontal=y0<y?"b":"t";vertical=x2>x?"l":"r";bx=x2>x?x:x-r;by=y0<y?y-r:y;}
    const e=placed(bx-w/2,by-w/2,r,r);e["border_"+horizontal](w);e["border_"+vertical](w);e["rounded_"+horizontal+vertical](r+w/2);out.push(finish(e));
  }
  if(head==="dots")for(const[x,y]of[points[0],end])out.push(placed(x-2.5,y-2.5,5,5).rounded(3).bg(color));
  else{
    const vertical=dir==="up"||dir==="down",ox=dir==="right"?-6:vertical?-4:0,oy=dir==="down"?-6:dir==="up"?0:-4;
    out.push(placed(end[0]+ox,end[1]+oy,vertical?8:6,vertical?6:8).child(svg(`${assets}/rig-arrow-${head}-${dir}.svg`).w_full().h_full().text_color(color)));
  }
  return out;
}

export function graphPacketElement(packet,points,t,id){
  const pts=points.filter((p,i)=>!i||distance(p,points[i-1])>0);if(pts.length<2)return null;
  const total=pts.slice(1).reduce((n,p,i)=>n+distance(p,pts[i]),0);let elapsed=0;
  const root=placed(pts[0][0],pts[0][1],1,1).id(id),wrappers=[];
  for(let i=1;i<pts.length;i++){
    const dx=pts[i][0]-pts[i-1][0],dy=pts[i][1]-pts[i-1][1],duration=packet.duration*distance(pts[i-1],pts[i])/total;
    const wrapper=placed(packet.started?dx:0,packet.started?dy:0,1,1).id(id+"-run-"+i)
      .transition(dx?"left":"top",{duration,delay:elapsed,easing:i===pts.length-1?"ease-out":"linear"});
    elapsed+=duration;wrappers.push(wrapper);
  }
  const size=packet.cross?10:11,color=packet.cross?t.muted:t.ansi2;
  let child=div().relative().w(1).h(1)
    .child(placed(-size/2-3,-size/2-3,size+6,size+6).rounded(size).bg(color).opacity(packet.cross ? .18 : .3))
    .child(placed(-size/2,-size/2,size,size).rounded(size).bg(color).border(2).border_color(t.background));
  // Complete each wrapper before consuming it as a child: native GPUI elements are single-use values.
  for(let i=wrappers.length-1;i>=0;i--)child=wrappers[i].child(child);
  root.child(child);
  return root.opacity(packet.arrived?0:packet.cross?.86:1).transition("opacity",{duration:450});
}

export class RigGraph{
  constructor(){this.width=700;this.motion=new GraphMotion();this.selected=null;this.hovered=null;this.eventCursor=0;}
  reset(){this.motion.leave();this.active=false;}
  render(t,cx,graph,{id,assets,running=false,events=[],open,menu,now=Date.now()}={}){
    if(this.graphData!==graph||this.layoutWidth!==this.width){this.layout=routeGraph(graph,this.width);this.graphData=graph;this.layoutWidth=this.width;}
    const layout=this.layout;
    const mono=settings()?.font_family??"monospace";
    const schedule=(ms,fn)=>this.liveCx.timer.after(ms,live=>{this.liveCx=live;fn();}),notify=()=>this.liveCx?.notify?.();
    this.liveCx=cx;
    if(!this.active){this.active=true;this.eventCursor=events.at(-1)?.serial??0;if(running)this.motion.enter(schedule,notify,layout.pods.length+graph.seatCount);}
    if(running)for(const event of events){if(event.serial<=this.eventCursor)continue;this.eventCursor=event.serial;
      // This event-triggered render is already the start frame: only targets/arrival/cleanup need a notify.
      this.motion.handoff(event,graph,(a,b)=>graphSeatPath(layout,a,b),schedule,notify,{notifyStart:false});}
    if(!this.focus&&!this.focusPending&&cx.focus_handle){this.focusPending=true;
      schedule(0,()=>{this.focus=this.liveCx.focus_handle();this.focusPending=false;notify();});}
    const focus=this.focus,emphasis=this.hovered??this.selected;
    const root=div().id(id).relative().w_full().h(layout.height).when(Boolean(focus),e=>e.track_focus(focus))
      .on_mouse_down("left",(_e,cx)=>{cx.stop_propagation?.();focus?.focus?.();this.selected=null;cx.notify();})
      .on_key_down((e,cx)=>{if(e.modifiers?.alt||e.modifiers?.control||e.modifiers?.platform)return;
        const key=String(e?.key??"").toLowerCase().replace(/^arrow/,"");if(key==="escape"){this.selected=null;cx.stop_propagation?.();cx.notify();}
        else if(["left","right","up","down"].includes(key)){this.selected=nearestGraphSeat(layout,this.selected,key);cx.stop_propagation?.();cx.notify();}
        else if(["enter","return"].includes(key)&&this.selected){cx.stop_propagation?.();if(running)open?.(layout.ent[this.selected]);}})
      .on_size_change((size,cx)=>{const width=Math.floor(size.width);if(width>0&&width!==this.width){this.width=width;cx.notify();}});
    let index=0;const entrance=new Map();for(const p of layout.pods){entrance.set("pod:"+p.id,index++);for(const s of p.seats)entrance.set(s.lid,index++);}
    const nodeMotion=(e,key,y)=>{
      if(!running||!this.motion.entering)return e;
      const delay=Math.min(entrance.get(key)*50,2000);
      return e.top(y+(this.motion.started?0:8)).opacity(this.motion.started?1:0)
        .transition("opacity",{duration:200,delay,easing:"ease-out"}).transition("top",{duration:200,delay,easing:"ease-out"});
    };
    for(const p of layout.pods)root.child(nodeMotion(placed(p.x,p.y,p.w,p.h).id(id+"-pod-"+p.id).rounded(8).bg(t.raised).border_1().border_color(t.border),"pod:"+p.id,p.y));
    const edges=placed(0,0,this.width,layout.height).id(id+"-edges");
    if(running&&this.motion.entering)edges.opacity(this.motion.started?1:0).transition("opacity",{duration:300,delay:Math.min(index*50+100,2000),easing:"ease-out"});
    for(const[pi,pl]of layout.plans.entries()){
      const own=emphasis&&pl.e.members.filter(e=>e.from===emphasis||e.to===emphasis),layer=placed(0,0,this.width,layout.height).id(id+"-edge-"+pi).opacity(emphasis ? .28 : 1)
        .children(graphPathElements(pl.pts,pl.e.kind,t,assets));
      edges.child(layer);
      if(own?.length)for(const e of own){const path=graphSeatPath(layout,e.from,e.to);if(path)edges.children(graphPathElements(path.points,e.kind,t,assets,{color:t.foreground,width:look(e.kind).width>1?2:1.5}));}
      if(pl.e.members.length>1){let best=0;for(let i=1;i<pl.pts.length-1;i++)if(distance(pl.pts[i],pl.pts[i+1])>distance(pl.pts[best],pl.pts[best+1]))best=i;
        const a=pl.pts[best],b=pl.pts[best+1],color=t[look(pl.e.kind).color];
        edges.child(placed((a[0]+b[0])/2-7.5,(a[1]+b[1])/2-7.5,15,15).id(id+"-chip-"+pi).rounded(8).bg(t.surface).border_1().border_color(color).text_size(10).text_color(color).text_center()
          .opacity(emphasis&&!own?.length ? .28 : 1).tooltip(pl.e.members.map(e=>`${e.from} ${look(e.kind).word} ${e.to}`).join("\n")).child(String(pl.e.members.length)));}
    }
    root.child(edges);
    for(const p of layout.pods){
      root.child(nodeMotion(placed(p.x+6,p.y+5,p.w-12,16).px(4).bg(t.raised).child(h_flex().gap(6).items_center()
        .child(div().min_w(0).flex_1().truncate().text_size(11.5).font_semibold().text_color(t.muted).child(p.label))
        .child(div().text_size(10.5).font_family(mono).text_color(t.dim).child(p.id))
        .child(div().text_size(11).text_color(t.dim).child(counted(p.seats.length,"seat")))),"pod:"+p.id,p.y+5));
      for(const seat of p.seats){const s=layout.ent[seat.lid],status=running?(seat.status??seatStatus(seat.node??{})):null;
        const needs=["blocked","needs_input","attention_required"].includes(status),parts=seat.lid.split("."),model=String(seat.model??"").split("/").at(-1),profile=["default","none"].includes(seat.profile)?null:seat.profile;
        const card=placed(s.x,s.y,s.w,s.h).id(id+"-seat-"+seat.lid).px(9).py(7).rounded(6).bg(t.background).border_1().border_color(needs?t.blocked:emphasis===seat.lid?t.input:t.border).cursor_pointer()
          .tooltip([seat.lid,seat.runtime,seat.model,profile,running?statusLook(status).word:null,
            ...["pendingWorkCount","inProgressWorkCount","blockedWorkCount"].filter(k=>running&&Number.isFinite(seat.node?.[k])).map(k=>`${seat.node[k]} ${k==="pendingWorkCount"?"pending":k==="inProgressWorkCount"?"in progress":"blocked"}`)].filter(Boolean).join(" · "))
          .on_hover((on,cx)=>{this.hovered=on?seat.lid:null;cx.notify();})
          .on_mouse_down("left",(_e,cx)=>{cx.stop_propagation?.();focus?.focus?.();})
          .on_mouse_down("right",(_e,cx)=>{cx.stop_propagation?.();if(running)menu?.(seat);})
          .on_click((e,cx)=>{cx.stop_propagation?.();this.selected=seat.lid;if(running&&e.click_count>=2)open?.(seat);cx.notify();})
          .child(h_flex().h(16).gap(6).items_center().child(svg(`${assets}/rig-seat.svg`).size(12).text_color(t.muted))
            .child(h_flex().min_w(0).flex_1().child(div().text_size(12.5).text_color(t.dim).child(parts.shift()+"."))
              .child(div().truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(parts.join("."))))
            .when(running,e=>e.child(statusMarkElement({div,svg},t,status,{iconOf:name=>`${assets}/${name}.svg`}))));
        card.child(h_flex().h(18).mt(3).gap(6).items_center().child(div().px(5).h(16).rounded(3).bg(t.raised).text_size(10.5).font_family(mono).text_color(t.muted).child(seat.runtime??"?"))
          .when(Boolean(model),e=>e.child(div().flex_1().truncate().text_size(11).text_color(t.dim).child(model)))
          .when(Boolean(profile),e=>e.child(div().text_size(11).text_color(t.muted).child("· "+profile))));
        if(emphasis===seat.lid)card.child(div().absolute().left(1).top(1).right(1).bottom(1).rounded(5).border_1().border_color(t.input));
        root.child(nodeMotion(card,seat.lid,s.y));
        const flash=this.motion.flashes.get(seat.lid);if(running&&flash){
          const holder=placed(s.x-4,s.y-4,s.w+8,s.h+8).id(id+"-flash-"+seat.lid+"-"+flash.version).opacity(flash.phase==="target"&&!flash.started?0:1);
          if(flash.phase==="target")holder.transition("opacity",{duration:1,delay:flash.delay});
          holder.child(div().w_full().h_full().rounded(9).border(2).border_color(t.ansi2).opacity(flash.started?0:flash.phase==="target"?.9:.55)
            .transition("opacity",{duration:flash.phase==="target"?GRAPH_TARGET_FADE_MS:650,delay:flash.delay??0,easing:"ease-out"}));root.child(holder);}
      }
    }
    if(running)for(const packet of this.motion.packets.values()){
      let points=packet.route?.points;
      if(packet.cross){const s=layout.ent[packet.target??packet.source],x=s.x+s.w/2;points=packet.target?[[x,0],[x,s.y]]:[[x,s.y],[x,0]];
        root.children(graphPathElements(points,"can_observe",t,assets,{color:t.muted}));
        const other=packet.target?packet.event.from:packet.event.to,at=other.lastIndexOf("@");
        root.child(placed(Math.min(x+8,this.width-180),2,172,16).text_size(11).text_color(t.muted).child(`${packet.target?"from":"to"} ${other.slice(at+1)} · ${other.slice(0,at)}`));
      }else root.child(placed(0,0,this.width,layout.height).opacity(packet.arrived?0:1).transition("opacity",{duration:450})
        .children(graphPathElements(points,"delegates_to",t,assets,{color:t.ansi2,width:2.25})));
      root.child(graphPacketElement(packet,points,t,id+"-packet-"+packet.key+"-"+packet.version));
    }
    const count=[counted(graph.seatCount??graph.pods.reduce((n,p)=>n+p.seats.length,0),"seat"),counted(graph.pods.length,"pod"),counted(graph.edges.length,"edge")].join(" · ");
    const last=running&&this.motion.last,note=last?`Last handoff ${Math.max(0,Math.floor((now-Number(new Date(last.at)))/1000))} s ago: ${last.source??last.from} → ${last.target??last.to}`:count;
    const legend=h_flex().gap(12).flex_wrap().children([...new Set(graph.edges.map(e=>e.kind))].map(kind=>h_flex().gap(5).items_center()
      .child(div().relative().w(24).h(10).children(graphPathElements([[0,5],[22,5]],kind,t,assets))).child(div().text_size(11).text_color(t.muted).child(look(kind).word))));
    return v_flex().w_full().rounded(8).border_1().border_color(t.border)
      .child(h_flex().px(16).py(7).gap(12).items_center().flex_wrap().child(div().text_size(11.5).text_color(t.dim).child(note)).child(div().flex_1()).child(legend))
      .when(layout.dense,e=>e.child(div().px(16).text_size(11).text_color(t.dim).child("Grouped by pod; hover a seat for its own edges.")))
      .child(root);
  }
}
