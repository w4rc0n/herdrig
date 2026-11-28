import * as kit from "gpui-kit";
const {div,svg}=kit;
import {h_flex,v_flex} from "gpui-base";
import {settings} from "herdr";
import {routeGraphColumns,graphHeadingTitle,graphWorkPath,graphWorkInk,nearestGraphSeat} from "./rig-graph-layout.js";
import {GraphMotion,GRAPH_FADE_MS} from "./rig-graph-state.js";
import {GraphWorkProjection,WORK_PULSE,graphWorkForSeat} from "./rig-graph-work.js";
import {statusMarkElement,seatStatus,statusLook,counted,singleLineText} from "./rig-lib.js";
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

function roundedLink(points,thickness=1.4,arrow=null){
  const toward=(a,b,d)=>[a[0]+Math.sign(b[0]-a[0])*d,a[1]+Math.sign(b[1]-a[1])*d];
  const last=points.at(-1),prior=points.at(-2),end=toward(last,prior,Math.min(6,distance(last,prior)));
  const route=[...points.slice(0,-1),end],samples=[route[0]];
  for(let i=1;i<route.length-1;i++){
    const a=route[i-1],b=route[i],c=route[i+1],r=Math.min(7,distance(a,b)/2,distance(b,c)/2);
    if(!r)continue;
    const start=toward(b,a,r),finish=toward(b,c,r);
    samples.push(start);
    for(let j=1;j<=5;j++){
      const t=j/5,u=1-t;
      samples.push(start.map((v,k)=>u*u*v+2*u*t*b[k]+t*t*finish[k]));
    }
  }
  samples.push(end);
  return strokePath(samples,thickness,arrow);
}

function strokePath(samples,thickness,arrow=null){
  const normals=[];
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1],b=samples[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    normals.push(length?[-dy/length,dx/length]:[0,0]);
  }
  const side=sign=>samples.map(([x,y],i)=>{
    const a=normals[Math.max(i-1,0)],b=normals[Math.min(i,normals.length-1)];
    const scale=sign*thickness/2/(1+a[0]*b[0]+a[1]*b[1]||1);
    return [x+(a[0]+b[0])*scale,y+(a[1]+b[1])*scale];
  });
  const path=kit.PathBuilder.fill().add_polygon([...side(1),...side(-1).reverse()],true);
  if(arrow)path.add_polygon(arrow,true);
  return path.build();
}

function panelCurve([x1,y1],[x2,y2]){
  const steps=Math.max(8,Math.ceil(Math.hypot(x2-x1,y2-y1)/4));
  return Array.from({length:steps+1},(_,i)=>{
    const t=i/steps,u=1-t;
    return [x1+(x2-x1)*(t*t*t+1.5*u*t),y1+(y2-y1)*(3*u*t*t+t*t*t)];
  });
}

/** "N s" under a minute, then "N min", then "N h": the status line changes once a minute after the first, not every second. */
export function handoffAgo(seconds) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h`;
}

export class RigGraph{
  constructor(){this.width=960;this.motion=new GraphMotion();this.selected=null;this.hovered=null;this.eventCursor=0;this.workProjection=new GraphWorkProjection();this.workRoutes=new Map();}
  reset(){this.workPulseTimer?.cancel?.();this.workPulseTimer=null;this.workPulseUntil=null;this.workPulseEpoch=(this.workPulseEpoch??0)+1;this.motion.leave();this.active=false;this.workProjection.reset();this.workRoutes.clear();}
  render(t,cx,graph,{id,assets,running=false,reducedMotion=false,events=[],workRows=[],workReady=true,open,menu,now=Date.now()}={}){
    const schedule=(ms,fn)=>this.liveCx.timer.after(ms,live=>{this.liveCx=live;fn();}),notify=()=>this.liveCx?.notify?.();
    this.liveCx=cx;
    const {lines:work,taskCount}=running?this.workProjection.read(graph,workRows,now,{ready:workReady,reducedMotion}):{lines:[],taskCount:0};
    const workKey=JSON.stringify(work.map(line=>line.key).sort());
    if(this.graphData!==graph||this.layoutWidth!==this.width||this.layoutWorkKey!==workKey||!this.layout){
      this.layout=routeGraphColumns(graph,this.width,{work:work.slice().sort((a,b)=>a.key.localeCompare(b.key))});
      this.graphData=graph;this.layoutWidth=this.width;this.layoutWorkKey=workKey;
    }
    const layout=this.layout, width=this.width;
    const mono=settings()?.font_family??"monospace";
    if(reducedMotion){this.motion.entering=false;this.motion.started=true;}
    if(!this.active){this.active=true;this.eventCursor=events.at(-1)?.serial??0;if(running)this.motion.enter(schedule,notify,layout.pods.length+graph.seatCount,{reducedMotion});}
    if(running)for(const event of events){if(event.serial<=this.eventCursor)continue;this.eventCursor=event.serial;
      // This event-triggered render is the start frame; only fade and cleanup need a notify.
      this.motion.handoff(event,graph,(a,b)=>graphWorkPath(layout,a,b),schedule,notify,{notifyStart:false,reducedMotion});}
    if(!this.focus&&!this.focusPending&&cx.focus_handle){this.focusPending=true;
      schedule(0,()=>{this.focus=this.liveCx.focus_handle();this.focusPending=false;notify();});}
    const focus=this.focus,emphasis=this.hovered??this.selected;
    const selectedSeat=layout.ent[this.selected];
    const panelSeat=this.panelOpen&&selectedSeat?.lid?selectedSeat:null;
    if(!panelSeat)this.panelOpen=false;
    const select=(seat,cx)=>{this.selected=seat;this.panelOpen=true;this.hovered=null;this.detail=null;this.expandedRelations=new Set();focus?.focus?.();cx.notify();};
    const closePanel=cx=>{this.panelOpen=false;this.hovered=null;this.detail=null;focus?.focus?.();cx.notify();};
    const root=div().id(id).relative().w_full().when(!panelSeat,e=>e.h(layout.height)).when(Boolean(focus),e=>e.track_focus(focus))
      .on_mouse_down("left",(_e,cx)=>{cx.stop_propagation?.();focus?.focus?.();if(!panelSeat){this.selected=null;cx.notify();}})
      .on_key_down((e,cx)=>{if(e.modifiers?.alt||e.modifiers?.control||e.modifiers?.platform)return;
        const key=String(e?.key??"").toLowerCase().replace(/^arrow/,"");
        if(panelSeat){
          if(key==="escape"){cx.stop_propagation?.();closePanel(cx);}
          if(key==="left"||key==="right"){
            const seats=layout.pods.flatMap(pod=>pod.seats.map(s=>s.lid)),index=seats.indexOf(this.selected);
            cx.stop_propagation?.();
            const next=seats[index+(key==="left"?-1:1)];
            if(next)select(next,cx);
          }
          return;
        }
        if(key==="escape"){this.selected=null;this.hovered=null;this.detail=null;cx.stop_propagation?.();cx.notify();}
        else if(["left","right","up","down"].includes(key)){this.selected=nearestGraphSeat(layout,this.selected,key);cx.stop_propagation?.();cx.notify();}
        else if(["enter","return"].includes(key)&&this.selected){cx.stop_propagation?.();select(this.selected,cx);}})
      .on_size_change((size,cx)=>{const width=Math.floor(size.width);if(width>0&&width!==this.width){this.width=width;cx.notify();}});
    const nativeInk=typeof kit.PathBuilder?.fill==='function'&&typeof globalThis.window?.paint_path==='function';
    // Native loops need one notification when the idle debounce ends.
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
    if(panelSeat)return root.child(this.seatPanel(t,graph,layout,panelSeat,{id,assets,running,nativeInk,work,workRows,open,menu,select,closePanel}));
    let index=0;const entrance=new Map();for(const p of layout.pods){entrance.set("pod:"+p.id,index++);for(const s of p.seats)entrance.set(s.lid,index++);}
    const nodeMotion=(e,key,y)=>{
      if(!running||!this.motion.entering)return e;
      const delay=Math.min(entrance.get(key)*50,2000);
      return e.top(y+(this.motion.started?0:8)).opacity(this.motion.started?1:0)
        .transition("opacity",{duration:200,delay,easing:"ease-out"}).transition("top",{duration:200,delay,easing:"ease-out"});
    };
    for(const p of layout.pods)root.child(nodeMotion(placed(p.x,p.y,p.w,p.h).id(id+"-pod-"+p.id).rounded(8).bg(t.raised).border_1().border_color(t.border),"pod:"+p.id,p.y));
    if(layout.noDelegation&&layout.pods.length){
      const first=layout.pods[0],bottom=Math.max(...layout.pods.filter(p=>p.row===0).map(p=>p.y+p.h));
      root.child(placed(first.x,bottom+3,width-first.x,16).text_size(11).text_color(t.dim).child("No delegation in this rig's spec."));
    }
    for(const [i,bracket] of layout.brackets.entries()){
      const {heading,x,end,y,label,titleHeight}=bracket;
      if(label){
        const last=layout.brackets.findLast(part=>part.heading===heading&&part.row===bracket.row);
        const title=singleLineText(graphHeadingTitle(graph,heading));
        const labelWidth=layout.narrow?width-32:Math.min(width-32,Math.max(last.end-x,title.length*6.4+20));
        const labelX=layout.narrow?16:Math.max(16,Math.min(width-labelWidth-16,(x+last.end-labelWidth)/2));
        const titleY=y-titleHeight-4;
        root.child(placed(labelX,titleY,Math.max(1,labelWidth),titleHeight).id(id+"-heading-"+i).tooltip(title)
          .whitespace_normal().line_height("16px").text_size(11.5).text_color(t.muted)
          .when(!layout.narrow,e=>e.text_center())
          .child(title));
        if(!layout.narrow&&heading===layout.headings[0]){
          const top=layout.pods[0],stemY=top.y+top.h;
          root.child(placed(top.x+top.w/2,stemY,2,titleY-stemY).border_l(1.25).border_color(t.dim));
        }
      }
      if(!layout.narrow)root.children([
        placed(x,y,end-x,2).border_t(1.25).border_color(t.dim),
        placed(x,y,2,6).border_l(1.25).border_color(t.dim),
        placed(end-1,y,2,6).border_l(1.25).border_color(t.dim),
      ]);
    }
    const edges=placed(0,0,this.width,layout.height).id(id+"-edges");
    if(running&&this.motion.entering)edges.opacity(this.motion.started?1:0).transition("opacity",{duration:300,delay:Math.min(index*50+100,2000),easing:"ease-out"});
    for(const pl of layout.plans)if(!work.some(line=>line.source===pl.e.from&&line.target===pl.e.to)){
      const fallback=graphPathElements(pl.pts,pl.e.kind,t,assets,{color:t.accent,width:1.4,head:"fill",dashed:false});
      if(nativeInk&&pl.pts.length>2){
        pl.ink??=roundedLink(pl.pts);
        edges.child(window.paint_path(pl.ink,t.accent).absolute().inset_0()).child(fallback.at(-1));
      }else edges.children(fallback);
    }
    root.child(edges);
    const workBySeat=new Map(), headingSources=new Map(layout.headings.map(heading=>[heading.source,heading]));
    for(const line of work){
      if(!workBySeat.has(line.target))workBySeat.set(line.target,{count:0,tips:[],active:false,pulse:false});
      const entry=workBySeat.get(line.target);
      entry.count+=line.rows.length;entry.tips.push(line.tip);
      if(headingSources.get(line.source)?.covered.has(line.target)){
        entry.active||=line.status==="active"||line.pulseUntil!==null;
        entry.pulse||=line.pulse;
      }
    }
    if(this.workLayout!==layout){this.workRoutes.clear();this.workLayout=layout;}
    for(const line of work)if(!this.workRoutes.has(line.key))this.workRoutes.set(line.key,graphWorkPath(layout,line.source,line.target));
    const steadyWork=new Map(),workLegend=new Map();
    // Every working line breathes in one shared layer, so all of them share one phase (and one native loop).
    let breathing=null;
    for(const [i,line]of work.entries()){
      const route=this.workRoutes.get(line.key);if(!route)continue;
      const label=line.dashed?'open task, seat idle'
        :line.color==='ansi3'?'open task, seat needs you or blocked'
        :line.status==='terminal_gone'?'open task, seat unreachable'
        :line.color==='muted'?'open task, seat stopped'
        :(line.pulseUntil!==null||line.status==='active')?'open task, seat working':'open task';
      workLegend.set(label,{color:t[line.color],width:2,dashed:line.dashed});
      if(nativeInk&&(!route.ink||route.ink.dashed!==line.dashed)){
        const segments=graphWorkInk(route.points,2,{dashed:line.dashed});
        const absolute=(segment,polygon)=>polygon.map(([x,y])=>[x+segment.x,y+segment.y]);
        let path;
        if(!line.dashed&&route.points.length>2){
          const last=segments.at(-1);
          path=roundedLink(route.points,2,absolute(last,last.polygons.at(-1)));
        }else{
          const builder=kit.PathBuilder.fill();
          for(const segment of segments)for(const polygon of segment.polygons)builder.add_polygon(absolute(segment,polygon),true);
          path=builder.build();
        }
        // A render can be interrupted during construction. Publish only the complete
        // geometry and Path together, so the next draw retries an unfinished build.
        route.ink={segments,path,dashed:line.dashed};
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
      }else target.children(graphPathElements(route.points,'delegates_to',t,assets,{color:t[line.color],width:2,dashed:line.dashed}).map((el,j)=>{
        if(j===0)el.id(id+'-work-'+i);
        return el.tooltip(line.tip);
      }));
    }
    // Steady routes must not cover breathing segments or their hover targets.
    root.children([...steadyWork.values(),...(breathing?[breathing]:[])]);
    if(running&&!layout.narrow)for(const path of this.motion.paths.values()){
      const route=path.cross?null:graphWorkPath(layout,path.source,path.target);
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
    for(const p of layout.pods){
      const label=p.label??p.id;
      const header=placed(p.x+10,p.y+4,p.w-20,p.headerHeight-8).id(id+"-pod-meta-"+p.id)
        .tooltip(label).on_hover((on,cx)=>{this.detail=on?`${label} · ${p.id} · ${counted(p.seats.length,"seat")}`:null;cx.notify();})
        .child(h_flex().w_full().gap(8).items_start()
          .child(div().id(id+"-pod-label-"+p.id).flex_1().min_w(0).whitespace_normal().line_height("16px").text_size(11.5).text_color(t.muted).child(label))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(counted(p.seats.length,"seat"))));
      root.child(nodeMotion(header,"pod:"+p.id,p.y+4));
      for(const seat of p.seats){const s=layout.ent[seat.lid],status=running?(seat.status??seatStatus(seat.node??{})):null;
        const needs=["blocked","needs_input","attention_required"].includes(status),parts=seat.lid.split("."),model=singleLineText(String(seat.model??"").split("/").at(-1));
        const watchers=layout.observers.get(seat.lid);
        const tags=layout.tags.get(seat.lid)??[],tasks=workBySeat.get(seat.lid);
        const card=placed(s.x,s.y,s.w,s.h).id(id+"-seat-"+seat.lid).tooltip(running ? `Show ${seat.lid}'s relationships; right-click for its actions` : "Show seat relationships").px(9).py(7).rounded(6).bg(t.background).border_1().border_color(needs?t.blocked:emphasis===seat.lid?t.input:t.border).cursor_pointer()
          .on_hover((on,cx)=>{this.hovered=on?seat.lid:null;cx.notify();})
          .on_mouse_down("left",(_e,cx)=>{cx.stop_propagation?.();focus?.focus?.();})
          .on_mouse_down("right",(_e,cx)=>{cx.stop_propagation?.();if(running)menu?.(seat);})
          .on_click((_e,cx)=>{cx.stop_propagation?.();select(seat.lid,cx);})
          .child(h_flex().h(16).gap(6).items_center().child(svg(`${assets}/rig-seat.svg`).size(12).text_color(t.muted))
            .child(h_flex().min_w(0).flex_1().child(div().text_size(12.5).text_color(t.dim).child(parts.shift()+"."))
              .child(div().truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(parts.join("."))))
            .when(headingSources.has(seat.lid),e=>e.child(div().flex_none().text_size(10).text_color(t.dim).child("Lead")))
            .when(Boolean(tasks),e=>e.child(div().id(id+"-seat-tasks-"+seat.lid).flex_none().px(4).rounded(3)
              .text_size(10).text_color(t.ansi2).bg(t.raised).tooltip(tasks.tips.join("\n")).child(counted(tasks.count,"task"))))
            .when(running,e=>e.child(statusMarkElement({div,svg},t,status,{iconOf:name=>`${assets}/${name}.svg`}))));
        card.child(h_flex().h(18).mt(3).gap(6).items_center().child(div().px(5).h(16).rounded(3).bg(t.raised).text_size(10.5).font_family(mono).text_color(t.muted).child(statusWord(seat.runtime??"?","runtime")))
          .when(Boolean(model),e=>e.child(div().flex_1().min_w(0).truncate().tooltip(model).text_size(11).text_color(t.dim).child(model)))
          .when(Boolean(watchers),e=>e.child(h_flex().flex_none().gap(3).items_center().tooltip(counted(watchers,"observer"))
            .child(svg(`${assets}/rig-follow.svg`).size(11).text_color(t.dim)).child(div().text_size(10).text_color(t.dim).child(String(watchers)))))
        );
        if(tags.length)card.child(h_flex().gap(6).items_center().mt(3)
          .children(tags.slice(0,2).map(({peer,incoming})=>div().truncate().text_size(10.5).text_color(t.accent).cursor_pointer()
            .tooltip(`Show ${peer}'s relationships`)
            .on_click((_e,cx)=>{cx.stop_propagation?.();select(peer,cx);}).child(`${incoming?"←":"→"} ${peer}`)))
          .when(tags.length>2,e=>e.child(div().text_size(10.5).text_color(t.dim).child(`+${tags.length-2}`))));
        if(tasks?.active){
          const ring=div().absolute().inset_0().rounded(6).border_1().border_color(t.ansi2).opacity(.7);
          card.child(tasks.pulse&&typeof ring.loop==="function"?ring.loop("opacity",WORK_PULSE):ring);
        }
        if(emphasis===seat.lid)card.child(div().absolute().left(1).top(1).right(1).bottom(1).rounded(5).border_1().border_color(t.input));
        root.child(nodeMotion(card,seat.lid,s.y));
        const flash=this.motion.flashes.get(seat.lid);if(running&&flash){
          const holder=placed(s.x-4,s.y-4,s.w+8,s.h+8).id(id+"-flash-"+seat.lid+"-"+flash.version).opacity(flash.fading?0:1);
          if(!reducedMotion)holder.transition("opacity",{duration:flash.fading?GRAPH_FADE_MS:0,easing:"ease-out"});
          holder.child(div().w_full().h_full().rounded(9).border(2).border_color(t.ansi2).opacity(.9));root.child(holder);
        }
      }
    }
    const count=[counted(graph.seatCount??graph.pods.reduce((n,p)=>n+p.seats.length,0),"seat"),counted(graph.pods.length,"pod"),counted(graph.edges.length,"edge")].join(" · ");
    const last=running&&this.motion.last,baseNote=last?`Last handoff ${handoffAgo(Math.max(0,Math.floor((now-Number(new Date(last.at)))/1000)))} ago: ${last.source??last.from} → ${last.target??last.to}`:count;
    const note=taskCount?`${counted(taskCount,'task')} in progress · ${last?'last'+baseNote.slice(4):baseNote}`:baseNote;
    const seat=emphasis&&layout.ent[emphasis];
    const detail=this.detail??(seat?[seat.lid,seat.runtime,seat.model,seat.profile,running?statusLook(seat.status??seatStatus(seat.node??{})).word:null,
      ...["pendingWorkCount","inProgressWorkCount","blockedWorkCount"].filter(k=>running&&Number.isFinite(seat.node?.[k])).map(k=>`${seat.node[k]} ${k==="pendingWorkCount"?"pending":k==="inProgressWorkCount"?"in progress":"blocked"}`)].filter(Boolean).join(" · "):null);
    // The legend shrinks and wraps inside its own box at narrow widths (its items are fixed, so the row's shape depends on the width alone).
    const legend=h_flex().id(id+"-legend").flex_shrink(1).min_w(0).flex_wrap().gap(12)
      .when(layout.plans.some(plan=>plan.type!=="chain"&&!plan.e.workOnly),el=>el.child(h_flex().gap(5).items_center()
        .child(div().relative().w(24).h(10).children(graphPathElements([[0,5],[22,5]],"delegates_to",t,assets,{color:t.accent,width:1.4})))
        .child(div().text_size(11).text_color(t.muted).child("pod link"))));
    for(const [label,style]of workLegend)legend.child(h_flex().gap(5).items_center()
      .child(div().relative().w(24).h(10).children(graphPathElements([[0,5],[22,5]],'delegates_to',t,assets,style)))
      .child(div().text_size(11).text_color(t.muted).child(label)));
    return v_flex().w_full().rounded(8).border_1().border_color(t.border)
      // The row never wraps: the status keeps at least 120 px, takes what the legend leaves and ends in an ellipsis, so its length (it changes every
      // second) never moves the legend.
      .child(h_flex().id(id+"-header").px(16).py(7).gap(12).items_center()
        .child(div().id(id+"-status").flex_1().min_w(120).text_size(11.5).text_color(t.dim).truncate().child(detail??note)).child(legend))
      .when(layout.noDelegation&&!layout.pods.length,e=>e.child(div().px(16).text_size(11).text_color(t.dim).child("No delegation in this rig's spec.")))
      .child(root);
  }

  seatPanel(t,graph,layout,seat,{id,assets,running,nativeInk,work,workRows,open,menu,select,closePanel}){
    const panelId=id+"-panel",lid=seat.lid;
    const incoming=new Map(),watchers=new Map(),outgoing=new Set();
    const toSeat=ref=>layout.ent[ref]?.lid;
    for(const edge of graph.edges){
      const from=toSeat(edge.from),to=toSeat(edge.to);
      if(!from||!to||from===to)continue;
      if(edge.kind==="can_observe"&&to===lid)watchers.set(from,{lid:from,kind:"watch"});
      if(edge.kind!=="delegates_to"&&edge.kind!=="spawned_by")continue;
      if(from===lid)outgoing.add(to);
      if(to===lid){
        const leads=layout.headings.some(heading=>heading.source===from&&heading.covered.has(lid));
        incoming.set(from,{lid:from,kind:leads?"delegates":"link"});
      }
    }
    const workFrom=new Map();
    for(const line of work){
      if(line.source===lid)outgoing.add(line.target);
      if(line.target!==lid)continue;
      workFrom.set(line.source,line);
      if(!incoming.has(line.source))incoming.set(line.source,{lid:line.source,kind:"link"});
    }
    const tasks=running?graphWorkForSeat(workRows,seat).map(task=>singleLineText(task.summary??"Task")||"Task"):[];
    const firstTask=tasks.length?[...tasks[0]]:[];
    const taskPreview=firstTask.length>22?firstTask.slice(0,21).join("")+"…":firstTask.join("");
    const byName=(a,b)=>a.lid.localeCompare(b.lid);
    const senders=[...incoming.values()].sort((a,b)=>Number(b.kind==="delegates")-Number(a.kind==="delegates")||byName(a,b));
    const watching=[...watchers.values()].sort(byName);
    const statusOf=entry=>entry.status??seatStatus(entry.node??{});
    const mark=entry=>statusMarkElement({div,svg},t,statusOf(entry),{iconOf:name=>`${assets}/${name}.svg`});
    const link=(text,choose)=>div().text_size(11.5).text_color(t.accent).cursor_pointer()
      .on_click((_event,cx)=>{cx.stop_propagation?.();choose(cx);}).child(text);
    const card=v_flex().id(panelId+"-seat").gap(8).p(12).rounded(6).bg(t.raised).border_1().border_color(t.border)
      .child(h_flex().gap(6).items_center().when(running,e=>e.child(mark(seat))).child(div().text_size(14).font_semibold().child(lid)))
      .child(div().text_size(11.5).text_color(t.dim).child([...new Set([seat.pod.label??seat.pod.id,statusWord(seat.runtime??"?","runtime"),
        running?statusLook(statusOf(seat)).word:null].filter(Boolean))].join(" · ")))
      .child(h_flex().gap(5).flex_wrap().items_center().child(div().text_size(11.5).text_color(t.dim).child("sends to:"))
        .children(outgoing.size?[...outgoing].sort().map(peer=>link(peer,cx=>select(peer,cx))):[div().text_size(11.5).text_color(t.dim).child("nobody")]))
      .when(running,e=>e.child(div().text_size(11.5).text_color(tasks.length?t.ansi2:t.dim)
        .tooltip(tasks.join("\n"))
        .child(tasks.length?`open tasks: ${tasks.length} · ${taskPreview}${tasks.length>1?` +${tasks.length-1}`:""}`:"open tasks: none")))
      .on_mouse_down("right",(_event,cx)=>{cx.stop_propagation?.();if(running)menu?.(seat);});
    if(running&&open)card.child(link("Open seat page",()=>open(seat)).id(panelId+"-open-seat"));

    const visible=(side,items)=>items.length>8&&!this.expandedRelations.has(side)?items.slice(0,7):items;
    const countRows=(side,items)=>visible(side,items).length+Number(items.length>8&&!this.expandedRelations.has(side));
    const list=(side,title,items)=>{
      const shown=visible(side,items);
      return v_flex().gap(4).child(div().text_size(11.5).text_color(t.muted).child(title))
        .when(!shown.length,e=>e.child(div().text_size(11.5).text_color(t.dim).child("nobody")))
        .children(shown.map(item=>h_flex().id(`${panelId}-${side}-${item.lid}`).h(26).gap(5).px(6).items_center().rounded(4).bg(t.raised)
          .when(running,e=>e.child(mark(layout.ent[item.lid])))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).child(item.lid))
          .child(item.kind==="watch"?svg(`${assets}/rig-follow.svg`).size(11).text_color(t.dim):
            div().text_size(10.5).text_color(item.kind==="delegates"?t.muted:t.accent).child(item.kind))))
        .when(shown.length<items.length,e=>e.child(link(`+${items.length-shown.length} more`,cx=>{
          this.expandedRelations.add(side);cx.notify();
        }).id(`${panelId}-${side}-more`)));
    };
    const header=h_flex().w_full().px(12).py(8).gap(10).items_center()
      .child(link("← Back to graph",closePanel))
      .child(div().flex_1())
      .child(div().text_size(11).text_color(t.dim).child("Esc closes · ← → next seat"));
    const panel=v_flex().id(panelId).w_full().rounded(8).border_1().border_color(t.border).child(header);
    if(layout.width<520)return panel.child(v_flex().gap(12).px(12).pb(12).child(card)
      .child(list("send","gives it work",senders)).child(list("watch","watches it",watching)));

    const width=Math.min(layout.width,860),sideWidth=Math.min(170,Math.floor((width-304)/2));
    const left=12,right=width-sideWidth-12;
    const cardW=Math.min(300,width-2*(sideWidth+48)),cardX=(width-cardW)/2,cardY=38;
    const outgoingWidth=[...outgoing].reduce((total,name)=>total+(name.length+1)*7,54);
    const cardHeight=cardY+145+Math.ceil(outgoingWidth/(cardW-24))*22;
    const height=Math.max(cardHeight,40+30*Math.max(countRows("send",senders),countRows("watch",watching)));
    const scene=div().relative().w(width).flex_none().h(height);
    const breathing=placed(0,0,width,height);
    let hasPulse=false;
    for(const [side,items] of [["send",visible("send",senders)],["watch",visible("watch",watching)]]){
      for(const [index,item] of items.entries()){
        const isWatcher=side==="watch",line=isWatcher?null:workFrom.get(item.lid);
        const rowY=31+index*30,portY=cardY+24+index*60/Math.max(1,items.length);
        const x1=isWatcher?cardX+cardW:left+sideWidth,x2=isWatcher?right:cardX;
        const mid=Math.round(x1+(x2-x1)*(.25+.5*(index+1)/(items.length+1)));
        const points=isWatcher?[[x1,portY],[mid,portY],[mid,rowY],[x2,rowY]]:[[x1,rowY],[mid,rowY],[mid,portY],[x2,portY]];
        const color=isWatcher?t.dim:line?t[line.color]:item.kind==="delegates"?t.muted:t.accent;
        const paint=line?.pulse?breathing:scene;
        if(line?.pulse)hasPulse=true;
        if(isWatcher){
          if(nativeInk)for(const [x,y] of panelCurve(points[0],points.at(-1)))paint.child(placed(x,y,1.25,1.25).rounded(1).bg(color));
          else for(let i=1;i<points.length;i++){
            const [x,y]=points[i-1],[endX,endY]=points[i],length=distance(points[i-1],points[i]);
            for(let step=0;step<length;step+=5)paint.child(placed(x+Math.sign(endX-x)*step,y+Math.sign(endY-y)*step,1.25,1.25).rounded(1).bg(color));
          }
        }else{
          const fallback=graphPathElements(points,"delegates_to",t,assets,{color,width:line?2:1.4,dashed:line?.dashed??false});
          if(nativeInk&&!line?.dashed){
            const curve=panelCurve(points[0],[x2-6,portY]);
            paint.child(window.paint_path(strokePath(curve,line?2:1.4),color).absolute().inset_0()).child(fallback.at(-1));
          }else paint.children(fallback);
        }
      }
    }
    if(hasPulse)scene.child(typeof breathing.loop==="function"?breathing.loop("opacity",WORK_PULSE):breathing);
    scene.child(div().absolute().left(left).top(0).w(sideWidth).child(list("send","gives it work",senders)))
      .child(div().absolute().left(cardX).top(cardY).w(cardW).child(card))
      .child(div().absolute().left(right).top(0).w(sideWidth).child(list("watch","watches it",watching)));
    return panel.child(h_flex().w_full().justify_center().child(scene));
  }
}
