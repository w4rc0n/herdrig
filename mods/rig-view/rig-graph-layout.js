// Pure geometry for the rig graph. Both saved specs and running rigs use this layout.
export const CARD_W=168, CARD_H=50, CARD_GAP=12, POD_PAD=10, POD_HEAD=26, POD_GAP=16;
export const MARGIN=16, LANE=6, CH_BASE=20, CH_EMPTY=28, GUTTER_GAP=12, DENSE=12;
const hierarchy=new Set(["delegates_to","spawned_by"]);
export const graphPodOf=ref=>String(ref).startsWith("pod:")?ref.slice(4):String(ref).split(".")[0];
const key=(...parts)=>JSON.stringify(parts);
const round=n=>Math.round(n*10)/10;
const unique=xs=>[...new Set(xs)];
export function graphHeaderChips(p){
  const count=`${p.seats.length} seat${p.seats.length===1?"":"s"}`,budget=p.w-12-40;
  const label=Math.min(10+7.2*String(p.label??p.id).length,CARD_W+POD_PAD-6-40);
  let rightWidth=8+6.3*p.id.length+6+6.2*count.length,rightText=`${p.id} · ${count}`;
  if(label+rightWidth>budget){rightWidth=8+6.3*p.id.length;rightText=p.id;}
  if(label+rightWidth>budget){rightWidth=0;rightText=null;}
  return{labelWidth:Math.max(0,Math.min(label,budget)),rightWidth,rightText};
}
export const graphChipZones=p=>{
  const {labelWidth,rightWidth}=graphHeaderChips(p),y=(p.y??0)+5;
  return [[p.x+6,y,p.x+6+labelWidth,y+16],...(rightWidth?[[p.x+p.w-6-rightWidth,y,p.x+p.w-6,y+16]]:[])];
};
export function graphFreeInterval(en,side){
  if(en.isPod)return[en.x+en.w*.25,en.x+en.w*.75];
  let a=en.x+en.w*.14,b=en.x+en.w*.86;
  if(side==="top"&&en.prow===0)for(const[x0,,x1]of graphChipZones(en.pod)){
    if(x1<=a||x0>=b)continue;
    const left=[a,Math.min(b,x0-6)],right=[Math.max(a,x1+6),b];
    [a,b]=left[1]-left[0]>=right[1]-right[0]?left:right;
  }
  return[a,b];
}
export function simplifyGraphPoints(points){
  const out=[];for(const p of points){const a=out.at(-2),b=out.at(-1);
    if(b&&b[0]===p[0]&&b[1]===p[1])continue;
    if(a&&((a[0]===b[0]&&b[0]===p[0])||(a[1]===b[1]&&b[1]===p[1])))out[out.length-1]=p;
    else out.push(p);
  }return out;
}

export function rankGraphPods(graph){
  const ids=graph.pods.map(p=>p.id),succ=new Map(ids.map(id=>[id,[]]));
  for(const e of graph.edges){
    const a=graphPodOf(e.from),b=graphPodOf(e.to);
    if(hierarchy.has(e.kind)&&a!==b&&succ.has(a)&&succ.has(b)&&!succ.get(a).includes(b))succ.get(a).push(b);
  }
  const seen=new Set(),order=[];
  const visit=id=>{seen.add(id);for(const next of succ.get(id))if(!seen.has(next))visit(next);order.push(id);};
  for(const id of ids)if(!seen.has(id))visit(id);
  order.reverse();const positions=new Map(order.map((id,i)=>[id,i])),rank=Object.fromEntries(ids.map(id=>[id,0]));
  for(const id of order)for(const next of succ.get(id))if(positions.get(next)>positions.get(id))rank[next]=Math.max(rank[next],rank[id]+1);
  return rank;
}
export function orderGraphPods(graph,rank){
  const observes=new Set(graph.edges.filter(e=>e.kind==="can_observe").map(e=>key(graphPodOf(e.from),graphPodOf(e.to))));
  const later=p=>graph.pods.some(q=>observes.has(key(p.id,q.id))&&rank[q.id]===rank[p.id])?1:0;
  return graph.pods.map((p,i)=>({p,i})).sort((a,b)=>rank[a.p.id]-rank[b.p.id]||later(a.p)-later(b.p)||a.i-b.i).map(x=>x.p);
}
export function orderGraphSeats(pod,edges){
  const seats=[...pod.seats];
  for(const e of edges){const a=seats.findIndex(s=>s.lid===e.from),b=seats.findIndex(s=>s.lid===e.to);
    if(a>=0&&b>=0&&a>b&&e.kind!=="collaborates_with")seats.splice(b,0,seats.splice(a,1)[0]);}
  return seats;
}
export function drawnGraphEdges(graph){
  const cross=graph.edges.filter(e=>graphPodOf(e.from)!==graphPodOf(e.to));
  if(cross.length<=DENSE)return{edges:graph.edges.map(e=>({...e,members:[e]})),dense:false};
  const groups=new Map();for(const e of cross){const k=key(graphPodOf(e.from),graphPodOf(e.to),e.kind);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);}
  const edges=graph.edges.filter(e=>graphPodOf(e.from)===graphPodOf(e.to)).map(e=>({...e,members:[e]}));
  for(const members of groups.values())edges.push({from:unique(members.map(e=>e.from)).length===1?members[0].from:"pod:"+graphPodOf(members[0].from),
    to:unique(members.map(e=>e.to)).length===1?members[0].to:"pod:"+graphPodOf(members[0].to),kind:members[0].kind,members});
  return{edges,dense:true};
}
export function layoutGraphPods(graph,width){
  const inner=width-2*MARGIN,rank=rankGraphPods(graph),maxCols=Math.max(1,Math.floor((inner-2*POD_PAD+CARD_GAP)/(CARD_W+CARD_GAP)));
  const pods=orderGraphPods(graph,rank).map(p=>{
    const seats=orderGraphSeats(p,graph.edges),cols=Math.max(1,Math.min(seats.length,maxCols)),prows=Math.max(1,Math.ceil(seats.length/cols));
    return{...p,seats,cols,prows,rank:rank[p.id],w:2*POD_PAD+cols*CARD_W+(cols-1)*CARD_GAP,h:POD_HEAD+prows*CARD_H+(prows-1)*CARD_GAP+POD_PAD};
  });
  const rows=[];
  for(const rank of unique(pods.map(p=>p.rank)).sort((a,b)=>a-b)){
    let current=[],used=0;
    for(const pod of pods.filter(p=>p.rank===rank)){
      let need=pod.w+(current.length?POD_GAP:0);
      if(current.length&&used+need>inner){rows.push(current);current=[];used=0;need=pod.w;}
      current.push(pod);used+=need;
    }
    if(current.length)rows.push(current);
  }
  rows.forEach((row,i)=>{
    const rowWidth=row.reduce((n,p)=>n+p.w,0)+POD_GAP*(row.length-1);let x=MARGIN+Math.max(0,Math.floor((inner-rowWidth)/2));
    for(const p of row){p.row=i;p.x=x;x+=p.w+POD_GAP;}
  });
  return{pods,rows};
}

export function routeGraph(graph,width){
  const{pods,rows}=layoutGraphPods(graph,width),ent=Object.create(null),plans=[];
  for(const p of pods){ent["pod:"+p.id]={pod:p,isPod:true,x:p.x,w:p.w};
    p.seats.forEach((s,i)=>{ent[s.lid]={...s,pod:p,isPod:false,col:i%p.cols,prow:Math.floor(i/p.cols),x:p.x+POD_PAD+(i%p.cols)*(CARD_W+CARD_GAP),w:CARD_W};});}
  const{edges,dense}=drawnGraphEdges(graph);
  for(const e of edges){
    let s=ent[e.from],t=ent[e.to];if(!s||!t)continue;
    const rs=s.pod.row,rt=t.pod.row;
    const how=s.pod===t.pod?(!s.isPod&&!t.isPod&&s.prow===t.prow&&Math.abs(s.col-t.col)===1?"side":"under")
      :Math.abs(rs-rt)===1?"adj":rs===rt?"same":"skip";
    const down=rt>rs,[sside,tside]=how==="side"?[null,null]:["under","same"].includes(how)?["bottom","bottom"]:down?["bottom","top"]:["top","bottom"];
    const reach=(en,side)=>!["side","under"].includes(how)&&!en.isPod&&
      ((side==="top"&&en.prow>0)||(side==="bottom"&&en.prow<en.pod.prows-1))?ent["pod:"+en.pod.id]:en;
    s=reach(s,sside);t=reach(t,tside);
    plans.push({e,s,t,sref:s.isPod?"pod:"+s.pod.id:e.from,tref:t.isPod?"pod:"+t.pod.id:e.to,how,rs,rt,sside,tside});
  }
  const gutters={left:new Map(),right:new Map()},gx=new Map();
  for(const pl of plans.filter(p=>p.how==="skip")){
    const lo=Math.min(pl.rs,pl.rt),hi=Math.max(pl.rs,pl.rt),middle=pods.filter(p=>lo<p.row&&p.row<hi);
    const left=Math.min(...middle.map(p=>p.x)),right=Math.max(...middle.map(p=>p.x+p.w));
    const ends=(pl.s.x+pl.s.w/2+pl.t.x+pl.t.w/2)/2,side=ends<(left+right)/2?"left":"right";
    const k=key(pl.e.from,pl.e.kind);if(!gutters[side].has(k))gutters[side].set(k,{left,right});pl.gside=side;pl.gkey=k;
  }
  for(const[side,items]of Object.entries(gutters)){let i=0;for(const[k,{left,right}]of items){
    gx.set(k,Math.min(Math.max(side==="left"?left-GUTTER_GAP-LANE*i:right+GUTTER_GAP+LANE*i,6),width-6));i++;}}
  for(const pl of plans)if(pl.how==="skip")pl.gx=gx.get(pl.gkey);

  const sides=new Map(),ports=new Map(),center=en=>en.x+en.w/2;
  const sideItem=(ref,side,k,far)=>{const id=key(ref,side);if(!sides.has(id))sides.set(id,{ref,side,items:new Map()});const items=sides.get(id).items;
    if(!items.has(k))items.set(k,[]);items.get(k).push(far);};
  for(const pl of plans){if(pl.how==="side")continue;
    pl.skey=key("out",pl.e.kind);pl.tkey=key("in",pl.e.from,pl.e.kind);
    sideItem(pl.sref,pl.sside,pl.skey,pl.how==="skip"?pl.gx:center(pl.t));
    sideItem(pl.tref,pl.tside,pl.tkey,pl.how==="skip"?pl.gx:center(pl.s));}
  for(const[id,{ref,side,items}]of sides){
    const average=values=>values.reduce((a,b)=>a+b,0)/values.length;
    const keys=[...items.keys()].sort((a,b)=>average(items.get(a))-average(items.get(b))),[a,b]=graphFreeInterval(ent[ref],side);
    keys.forEach((k,i)=>ports.set(key(id,k),Math.round(a+(b-a)*(i+1)/(keys.length+1))));}
  for(const pl of plans)if(pl.how!=="side"){
    pl.sx=ports.get(key(key(pl.sref,pl.sside),pl.skey));pl.tx=ports.get(key(key(pl.tref,pl.tside),pl.tkey));}
  const outgoing=new Map(),incoming=new Map();
  for(const pl of plans)if(pl.how!=="side"){
    const a=key(pl.sref,pl.sside),b=key(pl.tref,pl.tside);outgoing.set(a,(outgoing.get(a)??0)+1);incoming.set(b,(incoming.get(b)??0)+1);
  }
  for(const pl of plans)if(pl.how==="adj"&&outgoing.get(key(pl.sref,pl.sside))===1&&incoming.get(key(pl.tref,pl.tside))===1){
    const[a,b]=graphFreeInterval(pl.t,pl.tside);if(a<=pl.sx&&pl.sx<=b)pl.tx=pl.sx;
  }
  const used=new Map();
  for(const pl of plans)if(!["side","under"].includes(pl.how))for(const[end,side,xk,ref,k]of[
    ["s",pl.sside,"sx",pl.sref,pl.skey],["t",pl.tside,"tx",pl.tref,pl.tkey]]){
    const en=pl[end],channel=en.pod.row-(side==="top"?1:0),owner=key(ref,side,k);
    if(!used.has(channel))used.set(channel,new Map());const columns=used.get(channel);let x=pl[xk];
    // A lone straight edge's two stems meet, rather than overlap. Do not separate it from itself.
    const ownStraightStem=xk==="tx"&&pl.how==="adj"&&pl.sx===x&&outgoing.get(key(pl.sref,pl.sside))===1&&incoming.get(key(pl.tref,pl.tside))===1
      &&columns.get(x)===key(pl.sref,pl.sside,pl.skey);
    if(columns.has(x)&&columns.get(x)!==owner&&!ownStraightStem){
      const[a,b]=graphFreeInterval(en,side);
      for(const d of [LANE,-LANE,2*LANE,-2*LANE,3*LANE,-3*LANE])if(a<=x+d&&x+d<=b&&(!columns.has(x+d)||columns.get(x+d)===owner)){x+=d;break;}
      for(const q of plans)if(!["side","under"].includes(q.how)){
        if(key(q.sref,q.sside,q.skey)===owner)q.sx=x;
        if(key(q.tref,q.tside,q.tkey)===owner)q.tx=x;
      }
    }columns.set(x,owner);
  }

  const buses=rows.map(()=>new Map()),lanes=new Map(),nlanes={};
  const bus=(c,k,a,b)=>{if(!buses[c].has(k))buses[c].set(k,[]);buses[c].get(k).push([a,b]);};
  for(const pl of plans){const f=pl.e.from,k=pl.e.kind;
    if(["adj","same"].includes(pl.how)){const c=pl.how==="adj"?Math.min(pl.rs,pl.rt):pl.rs;
      pl.ch=[[c,key(f,k,"out")]];bus(c,pl.ch[0][1],pl.sx,pl.tx);
    }else if(pl.how==="skip"){
      const down=pl.rt>pl.rs,c1=down?pl.rs:pl.rs-1,c2=down?pl.rt-1:pl.rt;
      pl.ch=[[c1,key(f,k,"out")],[c2,key(f,k,"in")]];bus(c1,pl.ch[0][1],pl.sx,pl.gx);bus(c2,pl.ch[1][1],pl.gx,pl.tx);
    }}
  const laneSpans=[];
  buses.forEach((bs,c)=>{
    const spans=[...bs].map(([k,v])=>({a:Math.min(...v.flat()),b:Math.max(...v.flat()),k})).sort((a,b)=>a.a-b.a||a.b-b.b||(a.k<b.k?-1:a.k>b.k?1:0));
    const ends=[];
    for(const{a,b,k}of spans){let i=ends.findIndex(end=>a>end+8);if(i<0)i=ends.length;ends[i]=b;lanes.set(key(c,k),i);laneSpans.push({channel:c,lane:i,from:a,to:b,bus:k});}
    nlanes[c]=ends.length;
  });
  for(const p of pods){p.under=unique(plans.filter(pl=>pl.how==="under"&&pl.s.pod===p).map(pl=>key(pl.e.from,pl.e.kind)));p.h+=LANE*p.under.length+(p.under.length?4:0);}
  const channelHeight=c=>nlanes[c]?CH_BASE+LANE*(nlanes[c]-1):CH_EMPTY;
  const rowY=[];let y=MARGIN;
  rows.forEach((row,i)=>{rowY.push(y);y+=Math.max(...row.map(p=>p.h));if(i<rows.length-1||nlanes[i])y+=channelHeight(i);});
  for(const p of pods)p.y=rowY[p.row];
  for(const en of Object.values(ent)){en.y=en.pod.y+(en.isPod?0:POD_HEAD+en.prow*(CARD_H+CARD_GAP));en.h=en.isPod?en.pod.h:CARD_H;}
  const rowBottom=i=>rowY[i]+Math.max(...rows[i].map(p=>p.h));
  const laneY=([c,k])=>Math.round(rowBottom(c)+(channelHeight(c)-LANE*(nlanes[c]-1))/2+LANE*lanes.get(key(c,k)));
  for(const pl of plans){const{s,t,e}=pl;let points;
    if(pl.how==="side"){const ym=s.y+CARD_H/2;points=s.x<t.x?[[s.x+CARD_W,ym],[t.x,ym]]:[[s.x,ym],[t.x+CARD_W,ym]];}
    else{
      const sy=pl.sside==="bottom"?s.y+s.h:s.y,ty=pl.tside==="bottom"?t.y+t.h:t.y;
      if(pl.how==="under"){const p=s.pod,ly=p.y+p.h-POD_PAD+2-LANE*(p.under.length-1-p.under.indexOf(key(e.from,e.kind)));
        points=[[pl.sx,sy],[pl.sx,ly],[pl.tx,ly],[pl.tx,ty]];
      }else if(["adj","same"].includes(pl.how)){const ly=laneY(pl.ch[0]);points=[[pl.sx,sy],[pl.sx,ly],[pl.tx,ly],[pl.tx,ty]];}
      else{const l1=laneY(pl.ch[0]),l2=laneY(pl.ch[1]);points=[[pl.sx,sy],[pl.sx,l1],[pl.gx,l1],[pl.gx,l2],[pl.tx,l2],[pl.tx,ty]];}
    }
    pl.routePoints=points.map(([x,y])=>[round(x),round(y)]);
    pl.pts=simplifyGraphPoints(pl.routePoints);
  }
  return{pods,ent,plans,dense,height:y+MARGIN,width,lanes:nlanes,laneSpans,gutterLanes:Object.fromEntries(Object.entries(gutters).map(([k,v])=>[k,v.size]))};
}

export function graphSeatPath(layout,from,to){
  let plan=layout.plans.find(pl=>pl.e.from===from&&pl.e.to===to);
  if(plan)return{points:plan.pts,plan};
  plan=layout.plans.find(pl=>pl.e.members.some(m=>m.from===from&&m.to===to));
  if(!plan)return null;
  const points=plan.routePoints.map(p=>[...p]),s=layout.ent[from],t=layout.ent[to];if(!s||!t)return null;
  const reachable=(en,side)=>en.isPod||(side==="top"?en.prow===0:en.prow===en.pod.prows-1);
  const port=(en,side,refs,ref)=>{const[a,b]=graphFreeInterval(en,side);return Math.round(a+(b-a)*(.3+.4*(refs.indexOf(ref)+1)/(refs.length+1)));};
  if(plan.s.isPod&&reachable(s,plan.sside)){const refs=unique(plan.e.members.map(m=>m.from)).sort((a,b)=>layout.ent[a].x-layout.ent[b].x),x=port(s,plan.sside,refs,from),y=plan.sside==="bottom"?s.y+s.h:s.y;
    points.splice(0,2,[x,y],[x,points[1][1]]);}
  if(plan.t.isPod&&reachable(t,plan.tside)){const refs=unique(plan.e.members.map(m=>m.to)).sort((a,b)=>layout.ent[a].x-layout.ent[b].x),x=port(t,plan.tside,refs,to),y=plan.tside==="bottom"?t.y+t.h:t.y;
    points.splice(points.length-2,2,[x,points.at(-2)[1]],[x,y]);}
  return{points:simplifyGraphPoints(points),plan};
}

/** Work may have no topology edge. Use card-row gaps and pod gutters without moving the saved layout. */
export function graphWorkPath(layout,from,to){
  const authored=graphSeatPath(layout,from,to);if(authored)return authored;
  const s=layout.ent[from],t=layout.ent[to];if(!s||!t)return null;
  const exit=en=>[[en.x+en.w,en.y+en.h/2],[en.x+en.w+6,en.y+en.h/2],[en.x+en.w+6,en.y+en.h+6],[en.pod.x+en.pod.w+6,en.y+en.h+6]];
  const a=exit(s),b=exit(t),points=[...a];
  if(s.pod!==t.pod){
    const bottom=en=>Math.max(...layout.pods.filter(p=>p.row===en.pod.row).map(p=>p.y+p.h))+8;
    const gutter=Math.min(layout.width-6,Math.max(...layout.pods.map(p=>p.x+p.w))+8),sy=bottom(s),ty=bottom(t);
    points.push([a.at(-1)[0],sy],[gutter,sy],[gutter,ty],[b.at(-1)[0],ty]);
  }
  points.push(...b.reverse());return {points:simplifyGraphPoints(points)};
}

/** Prefer the longest usable run, sliding within it to clear cards and arrowheads. No clear run means no chip. */
export function graphWorkChip(layout,points,text,arrowPaths=[],placedChips=[]){
  const w=Math.max(18,text.length*6+10),h=16,pad=2;
  const obstacles=[...Object.values(layout.ent).map(r=>r.isPod?{...r,h:POD_HEAD}:r),...placedChips].map(({x,y,w,h})=>({x,y,w,h}));
  for(const p of Object.values(layout.ent).filter(r=>r.isPod))obstacles.push(
    {x:p.x,y:p.y,w:0,h:p.h},{x:p.x+p.w,y:p.y,w:0,h:p.h},
    {x:p.x,y:p.y,w:p.w,h:0},{x:p.x,y:p.y+p.h,w:p.w,h:0});
  for(const path of arrowPaths){
    const end=path.at(-1),prior=path.slice(0,-1).reverse().find(p=>p[0]!==end?.[0]||p[1]!==end?.[1]);
    if(!end||!prior)continue;
    const dx=Math.sign(end[0]-prior[0]),dy=Math.sign(end[1]-prior[1]);
    obstacles.push({x:Math.min(end[0],end[0]-dx*6)-Math.abs(dy)*4,y:Math.min(end[1],end[1]-dy*6)-Math.abs(dx)*4,w:Math.abs(dx)*6+Math.abs(dy)*8,h:Math.abs(dy)*6+Math.abs(dx)*8});
  }
  const runs=points.slice(1).map((b,i)=>({a:points[i],b,length:Math.abs(b[0]-points[i][0])+Math.abs(b[1]-points[i][1])})).sort((a,b)=>b.length-a.length);
  for(const {a,b}of runs){
    const horizontal=a[1]===b[1],axis=horizontal?0:1,cross=horizontal?1:0,half=(horizontal?w:h)/2,across=(horizontal?h:w)/2;
    const fixed=a[cross],crossLimit=horizontal?layout.height:layout.width;
    if(fixed-across<0||fixed+across>crossLimit)continue;
    let ranges=[[Math.max(Math.min(a[axis],b[axis])+half,half),Math.min(Math.max(a[axis],b[axis])-half,(horizontal?layout.width:layout.height)-half)]];
    ranges=ranges.filter(([lo,hi])=>lo<=hi);
    for(const r of obstacles){
      const start=horizontal?r.y:r.x,size=horizontal?r.h:r.w;
      if(fixed+across<=start-pad||fixed-across>=start+size+pad)continue;
      const lo=(horizontal?r.x:r.y)-half-pad,hi=(horizontal?r.x+r.w:r.y+r.h)+half+pad;
      ranges=ranges.flatMap(([l,u])=>hi<=l||lo>=u?[[l,u]]:[[l,Math.min(u,lo)],[Math.max(l,hi),u]].filter(([l,u])=>l<=u));
    }
    if(!ranges.length)continue;
    const mid=(a[axis]+b[axis])/2,center=ranges.map(([l,u])=>Math.max(l,Math.min(u,mid))).sort((x,y)=>Math.abs(x-mid)-Math.abs(y-mid))[0];
    return{x:(horizontal?center:fixed)-w/2,y:(horizontal?fixed:center)-h/2,w,h};
  }
  return null;
}

/** Filled segment geometry, including the last arrowhead. Bounds remain local hover targets. */
export function graphWorkInk(points,width=2.5,{dashed=false}={}){
  const pts=points.filter((p,i)=>!i||p[0]!==points[i-1][0]||p[1]!==points[i-1][1]).map(p=>[...p]);
  if(pts.length<2)return[];
  const end=[...pts.at(-1)],previous=pts.at(-2),hx=Math.sign(end[0]-previous[0]),hy=Math.sign(end[1]-previous[1]);
  const trim=Math.min(6,Math.abs(end[0]-previous[0])+Math.abs(end[1]-previous[1]));
  pts.at(-1)[0]-=hx*trim;pts.at(-1)[1]-=hy*trim;
  const ink=[];
  for(let i=0;i<pts.length-1;i++){
    let [x1,y1]=pts[i],[x2,y2]=pts[i+1];const dx=Math.sign(x2-x1),dy=Math.sign(y2-y1),polygons=[];
    if(i>0){x1-=dx*width/2;y1-=dy*width/2;}
    if(i<pts.length-2){x2+=dx*width/2;y2+=dy*width/2;}
    if(x1!==x2||y1!==y2){
      const left=Math.min(x1,x2)-(y1===y2?0:width/2),top=Math.min(y1,y2)-(x1===x2?0:width/2);
      const right=Math.max(x1,x2)+(y1===y2?0:width/2),bottom=Math.max(y1,y2)+(x1===x2?0:width/2);
      if(!dashed)polygons.push([[left,top],[right,top],[right,bottom],[left,bottom]]);
      else{
        const horizontal=y1===y2,length=horizontal?right-left:bottom-top;
        for(let offset=0;offset<length;offset+=10){
          const end=Math.min(offset+6,length),a=horizontal?left+offset:top+offset,b=horizontal?left+end:top+end;
          polygons.push(horizontal?[[a,top],[b,top],[b,bottom],[a,bottom]]:[[left,a],[right,a],[right,b],[left,b]]);
        }
      }
    }
    if(i===pts.length-2){
      const [x,y]=end,px=-hy*4,py=hx*4;
      polygons.push([[x-hx*6-px,y-hy*6-py],[x,y],[x-hx*6+px,y-hy*6+py]]);
    }
    if(!polygons.length)continue;
    const all=polygons.flat(),x=Math.min(...all.map(p=>p[0])),y=Math.min(...all.map(p=>p[1]));
    ink.push({x,y,w:Math.max(...all.map(p=>p[0]))-x,h:Math.max(...all.map(p=>p[1]))-y,polygons:polygons.map(poly=>poly.map(p=>[p[0]-x,p[1]-y]))});
  }
  return ink;
}

/** Arrow keys select the nearest card in that half-plane, with transverse distance as a tie breaker. */
export function nearestGraphSeat(layout,current,direction){
  const seats=Object.entries(layout.ent).filter(([,s])=>!s.isPod);
  if(!seats.length)return null;if(!layout.ent[current])return seats[0][0];
  const source=layout.ent[current],horizontal=direction==="left"||direction==="right",sign=["left","up"].includes(direction)?-1:1;
  return seats.filter(([id,s])=>id!==current&&sign*(horizontal?s.x-source.x:s.y-source.y)>0)
    .sort(([,a],[,b])=>Math.hypot(a.x-source.x,a.y-source.y)-Math.hypot(b.x-source.x,b.y-source.y))[0]?.[0]??current;
}
