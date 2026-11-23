import * as kit from "gpui-kit";
const {div,svg}=kit;
import {h_flex,v_flex} from "gpui-base";
import {settings} from "herdr";
import {routeGraph,graphSeatPath,graphWorkPath,graphWorkInk,graphWorkChip,nearestGraphSeat,graphHeaderChips} from "./rig-graph-layout.js";
import {GraphMotion,GRAPH_FADE_MS} from "./rig-graph-state.js";
import {GraphWorkProjection,WORK_PULSE} from "./rig-graph-work.js";
import {statusMarkElement,seatStatus,statusLook,counted} from "./rig-lib.js";
import {statusWord} from "./rig-words.js";

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

/** Square joints overlap by half a stroke; thin boxes keep the extra pixel required by GPUI. */
export function graphPathElements(points,kind,t,assets,override={}){
  if(points.length<2)return[];
  const style={...look(kind),...override},color=override.color??t[style.color],w=style.width;
  const pts=points.filter((p,i)=>!i||distance(p,points[i-1])>0).map(p=>[...p]);if(pts.length<2)return[];
  const end=[...pts.at(-1)],dir=direction(pts.at(-2),end),head=style.head;
  if(head!=="dots"){
    const previous=pts.at(-2),trim=Math.min(6,distance(previous,end));
    pts.at(-1)[0]-=Math.sign(end[0]-previous[0])*trim;pts.at(-1)[1]-=Math.sign(end[1]-previous[1])*trim;
  }
  const out=[];
  const finish=e=>{e.border_color(color);if(style.dashed)e.border_dashed();return e;};
  for(let i=0;i<pts.length-1;i++){
    let[x1,y1]=pts[i],[x2,y2]=pts[i+1];const dx=Math.sign(x2-x1),dy=Math.sign(y2-y1);
    if(i>0){x1-=dx*w/2;y1-=dy*w/2;}
    if(i<pts.length-2){x2+=dx*w/2;y2+=dy*w/2;}
    // Native probe: a box thinner than 2px loses its single-side border. Leave one pixel behind the stroke.
    if(y1===y2)out.push(finish(placed(Math.min(x1,x2),y1-w/2,Math.abs(x2-x1),w+1).border_t(w)));
    else out.push(finish(placed(x1-w/2,Math.min(y1,y2),w+1,Math.abs(y2-y1)).border_l(w)));
  }
  if(head==="dots")for(const[x,y]of[points[0],end])out.push(placed(x-2.5,y-2.5,5,5).rounded(3).bg(color));
  else{
    const vertical=dir==="up"||dir==="down",ox=dir==="right"?-6:vertical?-4:0,oy=dir==="down"?-6:dir==="up"?0:-4;
    out.push(placed(end[0]+ox,end[1]+oy,vertical?8:6,vertical?6:8).child(svg(`${assets}/rig-arrow-${head}-${dir}.svg`).w_full().h_full().text_color(color)));
  }
  return out;
}

/** "N s" under a minute, then "N min", then "N h": the status line changes once a minute after the first, not every second. */
export function handoffAgo(seconds) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h`;
}

export class RigGraph{
  constructor(){this.width=700;this.motion=new GraphMotion();this.selected=null;this.hovered=null;this.eventCursor=0;this.workProjection=new GraphWorkProjection();this.workRoutes=new Map();}
  reset(){this.workPulseTimer?.cancel?.();this.workPulseTimer=null;this.workPulseUntil=null;this.workPulseEpoch=(this.workPulseEpoch??0)+1;this.motion.leave();this.active=false;this.workProjection.reset();this.workRoutes.clear();this.workChipLines=null;this.workChips=null;this.workChipLayout=null;}
  render(t,cx,graph,{id,assets,running=false,reducedMotion=false,events=[],workRows=[],workReady=true,open,menu,now=Date.now()}={}){
    if(this.graphData!==graph||this.layoutWidth!==this.width){this.layout=routeGraph(graph,this.width);this.graphData=graph;this.layoutWidth=this.width;}
    const layout=this.layout;
    const mono=settings()?.font_family??"monospace";
    const schedule=(ms,fn)=>this.liveCx.timer.after(ms,live=>{this.liveCx=live;fn();}),notify=()=>this.liveCx?.notify?.();
    this.liveCx=cx;
    if(reducedMotion){this.motion.entering=false;this.motion.started=true;}
    if(!this.active){this.active=true;this.eventCursor=events.at(-1)?.serial??0;if(running)this.motion.enter(schedule,notify,layout.pods.length+graph.seatCount,{reducedMotion});}
    if(running)for(const event of events){if(event.serial<=this.eventCursor)continue;this.eventCursor=event.serial;
      // This event-triggered render is the start frame; only fade and cleanup need a notify.
      this.motion.handoff(event,graph,(a,b)=>graphSeatPath(layout,a,b),schedule,notify,{notifyStart:false,reducedMotion});}
    if(!this.focus&&!this.focusPending&&cx.focus_handle){this.focusPending=true;
      schedule(0,()=>{this.focus=this.liveCx.focus_handle();this.focusPending=false;notify();});}
    const focus=this.focus,emphasis=this.hovered??this.selected;
    const root=div().id(id).relative().w_full().h(layout.height).when(Boolean(focus),e=>e.track_focus(focus))
      .on_mouse_down("left",(_e,cx)=>{cx.stop_propagation?.();focus?.focus?.();this.selected=null;cx.notify();})
      .on_key_down((e,cx)=>{if(e.modifiers?.alt||e.modifiers?.control||e.modifiers?.platform)return;
        const key=String(e?.key??"").toLowerCase().replace(/^arrow/,"");if(key==="escape"){this.selected=null;this.hovered=null;this.detail=null;cx.stop_propagation?.();cx.notify();}
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
    const edges=placed(0,0,this.width,layout.height).id(id+"-edges"),countChips=[];
    if(running&&this.motion.entering)edges.opacity(this.motion.started?1:0).transition("opacity",{duration:300,delay:Math.min(index*50+100,2000),easing:"ease-out"});
    for(const[pi,pl]of layout.plans.entries()){
      const own=emphasis&&pl.e.members.filter(e=>e.from===emphasis||e.to===emphasis),segments=graphPathElements(pl.pts,pl.e.kind,t,assets);
      // Only selection needs a dimming group. Plain edges share the existing plane without a full-canvas box each.
      if(emphasis)edges.child(placed(0,0,this.width,layout.height).id(id+"-edge-"+pi).opacity(.28).children(segments));
      else edges.children(segments);
      if(own?.length)for(const e of own){const path=graphSeatPath(layout,e.from,e.to);if(path)edges.children(graphPathElements(path.points,e.kind,t,assets,{color:t.foreground,width:look(e.kind).width>1?2:1.5}));}
      if(pl.e.members.length>1){let best=0;for(let i=1;i<pl.pts.length-1;i++)if(distance(pl.pts[i],pl.pts[i+1])>distance(pl.pts[best],pl.pts[best+1]))best=i;
        const a=pl.pts[best],b=pl.pts[best+1],color=t[look(pl.e.kind).color];
        countChips.push(placed((a[0]+b[0])/2-7.5,(a[1]+b[1])/2-7.5,15,15).id(id+"-chip-"+pi).rounded(8).bg(t.surface).border_1().border_color(color).text_size(10).text_color(color).text_center()
           .opacity(emphasis&&!own?.length ? .28 : 1)
          .on_hover((on,cx)=>{this.detail=on?`${pl.e.members.length} edges: `+pl.e.members.map(e=>`${e.from} ${look(e.kind).word} ${e.to}`).join(", "):null;cx.notify();})
          .child(String(pl.e.members.length)));}
    }
    root.child(edges);
    const {lines:work,taskCount}=running?this.workProjection.read(graph,workRows,now,{ready:workReady,reducedMotion}):{lines:[],taskCount:0};
    // Native loops repaint a cached snapshot without rerunning this JS. A line stops breathing only at the end of its worker's idle debounce:
    // one explicit invalidation then removes the loop even with no new event.
    const pulseUntil=work.reduce((at,line)=>line.pulseUntil?Math.min(at,line.pulseUntil):at,Infinity);
    const nextPulse=Number.isFinite(pulseUntil)?pulseUntil:null;
    if(this.workPulseUntil!==nextPulse){
      this.workPulseTimer?.cancel?.();this.workPulseTimer=null;this.workPulseUntil=nextPulse;
      const epoch=this.workPulseEpoch=(this.workPulseEpoch??0)+1;
      if(nextPulse!==null)this.workPulseTimer=schedule(Math.max(0,nextPulse-now),()=>{
        if(this.workPulseEpoch!==epoch)return;
        this.workPulseTimer=null;this.workPulseUntil=null;this.workProjection.expire();notify();
      });
    }
    // Namespace lookup avoids linking a missing export on older supported Herdr versions.
    const nativeInk=typeof kit.PathBuilder?.fill==='function'&&typeof globalThis.window?.paint_path==='function';
    if(this.workLayout!==layout){this.workRoutes.clear();this.workLayout=layout;}
    for(const line of work)if(!this.workRoutes.has(line.key))this.workRoutes.set(line.key,graphWorkPath(layout,line.source,line.target));
    if(this.workChipLines!==work||this.workChipLayout!==layout){
      const arrows=[...layout.plans.map(plan=>plan.pts),...work.map(line=>this.workRoutes.get(line.key)?.points).filter(Boolean)];
      const placedChips=[];this.workChips=new Map();
      for(const line of work)if(line.chip){
        const chip=graphWorkChip(layout,this.workRoutes.get(line.key)?.points??[],line.chip,arrows,placedChips);
        this.workChips.set(line.key,chip);if(chip)placedChips.push(chip);
      }
      this.workChipLines=work;this.workChipLayout=layout;
    }
    const workChipElements=[],steadyWork=new Map(),workLegend=new Map();
    // Every working line breathes in one shared layer, so all of them share one phase (and one native loop).
    let breathing=null;
    for(const [i,line]of work.entries()){
      const route=this.workRoutes.get(line.key);if(!route)continue;
      const label=line.dashed?'open task, seat idle'
        :line.color==='ansi3'?'open task, seat needs you or blocked'
        :line.status==='terminal_gone'?'open task, seat unreachable'
        :line.color==='muted'?'open task, seat stopped'
        :(line.pulseUntil!==null||line.status==='active')?'open task, seat working':'open task';
      workLegend.set(label,{color:t[line.color],width:2.5,dashed:line.dashed});
      if(nativeInk&&(!route.ink||route.ink.dashed!==line.dashed)){
        const segments=graphWorkInk(route.points,2.5,{dashed:line.dashed}),builder=kit.PathBuilder.fill();
        for(const segment of segments)for(const polygon of segment.polygons)builder.add_polygon(polygon.map(([x,y])=>[x+segment.x,y+segment.y]),true);
        // A render can be interrupted during construction. Publish only the complete
        // geometry and Path together, so the next draw retries an unfinished build.
        route.ink={segments,path:builder.build(),dashed:line.dashed};
      }
      // NativePath ignores element opacity on 0.1.16. Background alpha is
      // honoured; older hosts and border/SVG paths keep an opacity wrapper.
      const animated=line.pulse&&!reducedMotion;
      if(animated&&!breathing){
        breathing=placed(0,0,this.width,layout.height).id(id+'-work-breathing').opacity(line.opacity);
        if(typeof breathing.loop==='function')breathing.loop('opacity',WORK_PULSE);
      }
      const layer=animated?breathing:null;
      let alpha=null;
      if(!layer&&nativeInk&&typeof kit.Background?.solid==='function'){
        const color=t[line.color];
        if(route.workPaint?.color!==color||route.workPaint?.opacity!==line.opacity){
          const solid=kit.Background.solid(color);
          if(typeof solid?.opacity==='function')route.workPaint={color,opacity:line.opacity,value:solid.opacity(line.opacity)};
        }
        alpha=route.workPaint?.color===color&&route.workPaint?.opacity===line.opacity?route.workPaint.value:null;
      }
      const key=alpha?'alpha':`wrapper-${i}`;
      if(!layer&&!steadyWork.has(key)){
        const plane=placed(0,0,this.width,layout.height).id(id+'-work-steady'+(alpha?'':`-${key}`));
        if(!alpha)plane.opacity(line.opacity);
        steadyWork.set(key,plane);
      }
      const target=layer??steadyWork.get(key);
      if(nativeInk){
        const paint=window.paint_path(route.ink.path,alpha??t[line.color]).absolute().inset_0();
        paint.id(id+'-work-'+i);
        target.child(paint);
        // Native Path has no tooltip listeners. Plain divs keep hover bounds on the actual segments.
        target.children(route.ink.segments.map(segment=>placed(segment.x,segment.y,segment.w,segment.h).tooltip(line.tip)));
      }else target.children(graphPathElements(route.points,'delegates_to',t,assets,{color:t[line.color],width:2.5,dashed:line.dashed}).map((el,j)=>{
        if(j===0)el.id(id+'-work-'+i);
        return el.tooltip(line.tip);
      }));
      const chip=this.workChips.get(line.key);
      if(chip){
        workChipElements.push(placed(chip.x,chip.y,chip.w,chip.h).id(id+'-work-chip-'+i).rounded(8).bg(t.surface).border_1().border_color(t[line.chipColor??line.color])
          .text_size(10).text_color(t[line.chipColor??line.color]).text_center().tooltip(line.tip).child(line.chip));}
    }
    // Steady routes must not cover breathing segments or their hover targets.
    root.children([...steadyWork.values(),...(breathing?[breathing]:[])]);
    if(running)for(const path of this.motion.paths.values()){
      const route=path.cross?null:graphSeatPath(layout,path.source,path.target);
      if(!path.cross&&!route)continue;
      let points=route?.points,kind=route?.plan?.e.kind??"can_observe";
      if(path.cross){const seat=layout.ent[path.target??path.source];if(!seat)continue;const x=seat.x+seat.w/2;
        points=path.target?[[x,0],[x,seat.y]]:[[x,seat.y],[x,0]];
      }
      const layer=placed(0,0,this.width,layout.height).id(id+"-lit-"+path.key+"-"+path.version).opacity(path.fading?0:1);
      // Seed the native opacity channel at1 without animation before its later target0 fade.
      if(!reducedMotion)layer.transition("opacity",{duration:path.fading?GRAPH_FADE_MS:0,easing:"ease-out"});
      layer.children(graphPathElements(points,kind,t,assets,{color:t.ansi2,width:look(kind).width+1,dashed:false}));
      if(path.cross){const other=path.target?path.event.from:path.event.to,at=other.lastIndexOf("@"),x=points[0][0];
        layer.child(placed(Math.min(x+8,this.width-180),2,172,16).text_size(11).text_color(t.muted)
          .child(`${path.target?"from":"to"} ${other.slice(at+1)} · ${other.slice(0,at)}`));
      }
      root.child(layer);
    }
    root.children(countChips);
    for(const p of layout.pods){
      const chip=(x,w,text)=>nodeMotion(placed(x,p.y+5,w,16).px(4).bg(t.raised).truncate().text_size(11.5).text_color(t.muted)
        .on_hover((on,cx)=>{this.detail=on?`${p.label} · ${p.id} · ${counted(p.seats.length,"seat")}`:null;cx.notify();}).child(text),"pod:"+p.id,p.y+5);
      const {labelWidth,rightWidth,rightText}=graphHeaderChips(p);
      root.child(chip(p.x+6,labelWidth,p.label));
      if(rightWidth)root.child(chip(p.x+p.w-6-rightWidth,rightWidth,h_flex().gap(6).items_center()
        .child(div().text_size(10.5).font_family(mono).text_color(t.dim).child(p.id))
        .when(rightText!==p.id,e=>e.child(div().text_size(11).text_color(t.dim).child(counted(p.seats.length,"seat")))))
        .id(id+"-pod-meta-"+p.id));
      for(const seat of p.seats){const s=layout.ent[seat.lid],status=running?(seat.status??seatStatus(seat.node??{})):null;
        const needs=["blocked","needs_input","attention_required"].includes(status),parts=seat.lid.split("."),model=String(seat.model??"").split("/").at(-1),profile=["default","none"].includes(seat.profile)?null:seat.profile;
        const card=placed(s.x,s.y,s.w,s.h).id(id+"-seat-"+seat.lid).tooltip(running ? `Double-click to open ${seat.lid}'s page; right-click for its actions` : "Highlight this seat's edges").px(9).py(7).rounded(6).bg(t.background).border_1().border_color(needs?t.blocked:emphasis===seat.lid?t.input:t.border).cursor_pointer()
          .on_hover((on,cx)=>{this.hovered=on?seat.lid:null;cx.notify();})
          .on_mouse_down("left",(_e,cx)=>{cx.stop_propagation?.();focus?.focus?.();})
          .on_mouse_down("right",(_e,cx)=>{cx.stop_propagation?.();if(running)menu?.(seat);})
          .on_click((e,cx)=>{cx.stop_propagation?.();this.selected=seat.lid;if(running&&e.click_count>=2)open?.(seat);cx.notify();})
          .child(h_flex().h(16).gap(6).items_center().child(svg(`${assets}/rig-seat.svg`).size(12).text_color(t.muted))
            .child(h_flex().min_w(0).flex_1().child(div().text_size(12.5).text_color(t.dim).child(parts.shift()+"."))
              .child(div().truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(parts.join("."))))
            .when(running,e=>e.child(statusMarkElement({div,svg},t,status,{iconOf:name=>`${assets}/${name}.svg`}))));
        card.child(h_flex().h(18).mt(3).gap(6).items_center().child(div().px(5).h(16).rounded(3).bg(t.raised).text_size(10.5).font_family(mono).text_color(t.muted).child(statusWord(seat.runtime??"?","runtime")))
          .when(Boolean(model),e=>e.child(div().flex_1().truncate().text_size(11).text_color(t.dim).child(model)))
          .when(Boolean(profile),e=>e.child(div().text_size(11).text_color(t.muted).child("· "+profile))));
        if(emphasis===seat.lid)card.child(div().absolute().left(1).top(1).right(1).bottom(1).rounded(5).border_1().border_color(t.input));
        root.child(nodeMotion(card,seat.lid,s.y));
        const flash=this.motion.flashes.get(seat.lid);if(running&&flash){
          const holder=placed(s.x-4,s.y-4,s.w+8,s.h+8).id(id+"-flash-"+seat.lid+"-"+flash.version).opacity(flash.fading?0:1);
          if(!reducedMotion)holder.transition("opacity",{duration:flash.fading?GRAPH_FADE_MS:0,easing:"ease-out"});
          holder.child(div().w_full().h_full().rounded(9).border(2).border_color(t.ansi2).opacity(.9));root.child(holder);
        }
      }
    }
    root.children(workChipElements);
    const count=[counted(graph.seatCount??graph.pods.reduce((n,p)=>n+p.seats.length,0),"seat"),counted(graph.pods.length,"pod"),counted(graph.edges.length,"edge")].join(" · ");
    const last=running&&this.motion.last,baseNote=last?`Last handoff ${handoffAgo(Math.max(0,Math.floor((now-Number(new Date(last.at)))/1000)))} ago: ${last.source??last.from} → ${last.target??last.to}`:count;
    const note=taskCount?`${counted(taskCount,'task')} in progress · ${last?'last'+baseNote.slice(4):baseNote}`:baseNote;
    const seat=emphasis&&layout.ent[emphasis];
    const detail=this.detail??(seat?[seat.lid,seat.runtime,seat.model,seat.profile,running?statusLook(seat.status??seatStatus(seat.node??{})).word:null,
      ...["pendingWorkCount","inProgressWorkCount","blockedWorkCount"].filter(k=>running&&Number.isFinite(seat.node?.[k])).map(k=>`${seat.node[k]} ${k==="pendingWorkCount"?"pending":k==="inProgressWorkCount"?"in progress":"blocked"}`)].filter(Boolean).join(" · "):null);
    // The legend shrinks and wraps inside its own box at narrow widths (its items are fixed, so the row's shape depends on the width alone).
    const legend=h_flex().id(id+"-legend").flex_shrink(1).min_w(0).flex_wrap().gap(12).children([...new Set(graph.edges.map(e=>e.kind))].map(kind=>h_flex().gap(5).items_center()
      .child(div().relative().w(24).h(10).children(graphPathElements([[0,5],[22,5]],kind,t,assets))).child(div().text_size(11).text_color(t.muted).child(look(kind).word))));
    for(const [label,style]of workLegend)legend.child(h_flex().gap(5).items_center()
      .child(div().relative().w(24).h(10).children(graphPathElements([[0,5],[22,5]],'delegates_to',t,assets,style)))
      .child(div().text_size(11).text_color(t.muted).child(label)));
    return v_flex().w_full().rounded(8).border_1().border_color(t.border)
      // The row never wraps: the status keeps at least 120 px, takes what the legend leaves and ends in an ellipsis, so its length (it changes every
      // second) never moves the legend.
      .child(h_flex().id(id+"-header").px(16).py(7).gap(12).items_center()
        .child(div().id(id+"-status").flex_1().min_w(120).text_size(11.5).text_color(t.dim).truncate().child(detail??note)).child(legend))
      .when(layout.dense,e=>e.child(div().px(16).text_size(11).text_color(t.dim).child("Grouped by pod; hover a seat for its own edges.")))
      .child(root);
  }
}
