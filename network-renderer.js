const COLORS=['#12796e','#bc610b','#7042ad'];
function pathOf(polygons){const path=new Path2D();for(const p of polygons)for(const ring of [p.outer,...p.holes]){ring.forEach(([x,y],i)=>i?path.lineTo(x,y):path.moveTo(x,y));path.closePath();}return path;}
function sidewalkPath(curb,width){
 const edge=curb.map((p,i)=>{const a=curb[Math.max(0,i-1)],b=curb[Math.min(curb.length-1,i+1)];const dx=b[0]-a[0],dy=b[1]-a[1],n=Math.hypot(dx,dy);return[p[0]-dy/n*width,p[1]+dx/n*width];});
 return pathOf([{outer:[...curb,...edge.reverse()],holes:[]}]);
}
export class StreetRenderer{
 constructor(canvas,scene){
  this.canvas=canvas;this.ctx=canvas.getContext('2d');this.scene=scene;this.display=new Map();
  if(!this.ctx)throw new Error('이 브라우저에서 지도 화면을 열 수 없습니다.');
  this.background=document.createElement('canvas');this.road=pathOf(scene.road);this.main=pathOf(scene.mainRoad);this.study=pathOf(scene.studyRoad);
  this.buildings=scene.buildings.map(b=>({id:b.id,path:pathOf(b.polygons)}));this.storeBuildingIds=new Set((scene.storefronts??[]).map(store=>store.buildingId));this.zoom=1;this.focus={x:129.5,y:108.5};this.showDensity=false;this.showCapacitySections=false;this.dirty=true;
  this.labelStorageKey='urbanflow-callout-positions-v1';this.labelPositions=this.loadLabelPositions();
  this.events=new AbortController();const options={signal:this.events.signal};
  canvas.addEventListener('pointerdown',e=>{
   if(this.editMode){this.painting=true;canvas.setPointerCapture(e.pointerId);this.paintAt(e);return;}
   const point=this.pointerPoint(e),box=this.labelAt(point);
   if(box){this.labelDrag={id:box.id,grabX:point.x-(box.left+box.right)/2,grabY:point.y-(box.top+box.bottom)/2,width:box.right-box.left,height:box.bottom-box.top};canvas.setPointerCapture(e.pointerId);this.setCursor();return;}
   if(this.zoom<=1)return;this.drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);this.setCursor();
  },options);
  canvas.addEventListener('pointermove',e=>{
   if(this.painting){this.paintAt(e);return;}
   if(this.labelDrag){const point=this.pointerPoint(e),halfW=this.labelDrag.width/2,halfH=this.labelDrag.height/2,centerX=Math.max(8+halfW,Math.min(this.w-8-halfW,point.x-this.labelDrag.grabX)),centerY=Math.max(100+halfH,Math.min(this.h-35-halfH,point.y-this.labelDrag.grabY));this.labelPositions[this.labelDrag.id]={x:centerX/this.w,y:centerY/this.h};this.dirty=true;return;}
   if(!this.drag){this.hoverLabel=this.labelAt(this.pointerPoint(e));this.setCursor();return;}this.focus.x-=(e.clientX-this.drag.x)/this.scale;this.focus.y+=(e.clientY-this.drag.y)/this.scale;this.drag={x:e.clientX,y:e.clientY};this.clampFocus();this.transform();
  },options);
  const release=()=>{if(this.labelDrag)this.saveLabelPositions();this.labelDrag=null;this.drag=null;this.setCursor();if(this.painting){this.painting=false;this.lastPaint=null;this.onPaintEnd?.();}};canvas.addEventListener('pointerup',release,options);canvas.addEventListener('pointercancel',release,options);
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);this.resize();
 }
 pointerPoint(e){const r=this.canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
 labelAt(point){return[...(this.labelBoxes??[])].reverse().find(item=>item.id&&point.x>=item.left&&point.x<=item.right&&point.y>=item.top&&point.y<=item.bottom)??null;}
 loadLabelPositions(){try{const value=JSON.parse(localStorage.getItem(this.labelStorageKey)||'{}');return value&&typeof value==='object'?value:{};}catch{return{};}}
 saveLabelPositions(){try{localStorage.setItem(this.labelStorageKey,JSON.stringify(this.labelPositions));}catch{}}
 resetLabelPositions(){this.labelPositions={};try{localStorage.removeItem(this.labelStorageKey);}catch{}this.dirty=true;}
 setCursor(){this.canvas.style.cursor=this.editMode?'crosshair':this.labelDrag?'grabbing':this.hoverLabel||this.zoom>1?'grab':'default';}
 paintAt(e){const r=this.canvas.getBoundingClientRect(),p={x:(e.clientX-r.left-this.tx)/this.scale,y:(this.ty-e.clientY+r.top)/this.scale};const a=this.lastPaint??p,n=Math.max(1,Math.ceil(Math.hypot(p.x-a.x,p.y-a.y)/.2));for(let i=1;i<=n;i++)this.onPaint?.({x:a.x+(p.x-a.x)*i/n,y:a.y+(p.y-a.y)*i/n});this.lastPaint=p;}
 resize(){const r=this.canvas.getBoundingClientRect();this.w=r.width;this.h=r.height;this.dpr=devicePixelRatio||1;this.canvas.width=Math.round(this.w*this.dpr);this.canvas.height=Math.round(this.h*this.dpr);this.background.width=this.canvas.width;this.background.height=this.canvas.height;this.transform();}
 clampFocus(){this.focus.x=Math.max(35,Math.min(222,this.focus.x));this.focus.y=Math.max(20,Math.min(190,this.focus.y));}
 transform(){this.scale=Math.min(this.w/197,(this.h-76)/191)*this.zoom;this.tx=this.w/2-this.focus.x*this.scale;this.ty=this.h/2+8+this.focus.y*this.scale;this.dirty=true;this.canvas.style.touchAction=this.editMode||this.zoom>1?'none':'pan-y';this.setCursor();}
 view(mode){if(mode==='all'){this.zoom=1;this.focus={x:129.5,y:108.5};}else if(mode==='entrance'){this.zoom=3;this.focus={x:77,y:127};}else{this.zoom=Math.max(1,Math.min(6,this.zoom*(mode==='in'?1.4:1/1.4)));if(this.zoom===1)this.focus={x:129.5,y:108.5};}this.transform();return this.zoom;}
 project(x,y){return{x:this.tx+x*this.scale,y:this.ty-y*this.scale};}
 updateGeometry(sim,preservePeople=false){if(!preservePeople)this.display.clear();this.excluded=sim.excluded;this.stallCells=sim.stallCells;this.storefrontCells=sim.storefrontCells;this.storefrontEntries=sim.storefrontEntries;this.storefrontById=new Map((sim.storefrontEntries??[]).map(entry=>[entry.id,entry]));this.capacitySections=sim.capacitySections;this.connectorCapacitySections=sim.connectorCapacitySections;this.sidewalk=sidewalkPath(this.scene.curb,sim.minWidth);this.dirty=true;}
 paintBackground(sim){
  this.labelBoxes=[];
  const c=this.background.getContext('2d'),d=this.dpr,s=this.scale,g=sim.grid;
  c.setTransform(d,0,0,d,0,0);c.fillStyle='#edf1f6';c.fillRect(0,0,this.w,this.h);
  c.setTransform(d*s,0,0,-d*s,d*this.tx,d*this.ty);
  c.strokeStyle='#e0e6ef';c.lineWidth=.12;
  for(let x=0;x<280;x+=10){c.beginPath();c.moveTo(x,0);c.lineTo(x,230);c.stroke();}
  for(let y=0;y<230;y+=10){c.beginPath();c.moveTo(0,y);c.lineTo(280,y);c.stroke();}
  for(const b of this.buildings){const matched=this.storeBuildingIds.has(b.id);c.fillStyle=matched?'#ccd7e6':'#dce3ec';c.strokeStyle=matched?'#667f9d':'#afbdcf';c.lineWidth=matched ? .32 : .2;c.fill(b.path,'evenodd');c.stroke(b.path);}
  c.fillStyle='#b7c2d0';c.strokeStyle='#8597af';c.lineWidth=.22;c.fill(this.main,'evenodd');c.stroke(this.main);
  c.fillStyle='#ffffff';c.fill(this.road,'evenodd');c.strokeStyle='#92a7c2';c.stroke(this.road);
  // Capacity sections are a paint-only overlay. They never change the walkable grid.
  if(this.showCapacitySections)for(const section of this.capacitySections??[]){
   c.fillStyle=['#55c5bb2e','#4aa8c22b','#67c4a92b','#3e91b82b','#6bc7c02e'][section.index%5];
   for(const index of section.cells){const point=sim.point(index);c.fillRect(point.x-g.step/2,point.y-g.step/2,g.step,g.step);}
  }
  if(this.showCapacitySections)for(const section of this.connectorCapacitySections??[]){
   c.fillStyle=section.index?'#7fb6d638':'#8ac7e03d';
   for(const index of section.cells){const point=sim.point(index);c.fillRect(point.x-g.step/2,point.y-g.step/2,g.step,g.step);}
  }
  c.save();c.clip(this.main,'evenodd');c.fillStyle='#ffffff';c.fill(this.sidewalk);c.restore();
  c.fillStyle='#ba8148';c.strokeStyle='#f1c17e';c.lineWidth=.08;for(const i of this.stallCells??[]){const p=sim.point(i);c.fillRect(p.x-g.step/2,p.y-g.step/2,g.step,g.step);c.strokeRect(p.x-g.step/2,p.y-g.step/2,g.step,g.step);}
  c.fillStyle='#f8e1b4';c.strokeStyle='#4c2d12';c.lineWidth=.12;for(const entry of this.storefrontEntries??[]){const p=sim.point(entry.cell);c.beginPath();c.arc(p.x,p.y,.36,0,Math.PI*2);c.fill();c.stroke();}
  if(this.zoom>=2.4){c.strokeStyle='#e7bd77';c.lineWidth=.12;c.setLineDash([.45,.3]);for(const entry of this.storefrontEntries??[]){const p=sim.point(entry.cell);c.beginPath();c.moveTo(p.x,p.y);c.lineTo(entry.poi[0],entry.poi[1]);c.stroke();}c.setLineDash([]);}
  c.fillStyle='#da647ac0';for(const i of this.excluded??[]){const p=sim.point(i);c.fillRect(p.x-g.step/2,p.y-g.step/2,g.step,g.step);}
  c.setTransform(d,0,0,d,0,0);
  this.buildLabelMask();
  this.label(c,116,178,'종로 · 차도 (보행 제외)',{id:'base-main-road',size:14});
  this.label(c,108,157,`북쪽 인도 ${sim.minWidth.toFixed(1)}m`,{id:'base-north-sidewalk',size:14});
  this.label(c,57,121,'A · 진입부',{id:'base-entrance-a',align:'right',size:14});
  this.label(c,190,38,'B · 구간 끝',{id:'base-end-b',align:'right',size:14});
  this.backgroundLabelBoxes=[...this.labelBoxes];this.dirty=false;
 }
 // A summed-area mask makes every label avoid roads and sidewalks at any zoom.
 buildLabelMask(){
  const unit=4,w=Math.ceil(this.w/unit),h=Math.ceil(this.h/unit),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const c=canvas.getContext('2d');c.setTransform(this.scale/unit,0,0,-this.scale/unit,this.tx/unit,this.ty/unit);
  c.fillStyle='#fff';c.fill(this.road,'evenodd');c.save();c.clip(this.main,'evenodd');c.fill(this.sidewalk);c.restore();
  const data=c.getImageData(0,0,w,h).data,stride=w+1,sum=new Uint32Array((w+1)*(h+1));
  for(let y=1;y<=h;y++){let row=0;for(let x=1;x<=w;x++){row+=data[((y-1)*w+x-1)*4+3]>0?1:0;sum[y*stride+x]=sum[(y-1)*stride+x]+row;}}
  this.labelMask={unit,w,h,stride,sum};this.labelCache=new Map();
 }
 clearLabelRect(box){
  const {unit,w,h,stride,sum}=this.labelMask;
  const l=Math.max(0,Math.floor(box.left/unit)),r=Math.min(w,Math.ceil(box.right/unit)),t=Math.max(0,Math.floor(box.top/unit)),b=Math.min(h,Math.ceil(box.bottom/unit));
  return sum[b*stride+r]-sum[t*stride+r]-sum[b*stride+l]+sum[t*stride+l]===0;
 }
 label(c,x,y,text,{id=null,color='#203853',size=14,align='center',offsetY=0,background='#ffffff'}={}){
  const p=this.project(x,y);if(p.x<0||p.x>this.w||p.y<0||p.y>this.h)return;
  c.save();c.font=`600 ${Math.max(14,size)}px "Malgun Gothic",system-ui,sans-serif`;
  const width=c.measureText(text).width,left=align==='left'?p.x:align==='right'?p.x-width:p.x-width/2;
  const key=`${x},${y},${Math.ceil(width)},${offsetY},${align}`,cached=this.labelCache.get(key);
  const saved=id?this.labelPositions[id]:null,candidates=[];
  if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y)){
   const centerX=Math.max(16+width/2,Math.min(this.w-16-width/2,saved.x*this.w)),centerY=Math.max(116,Math.min(this.h-51,saved.y*this.h)),px=Math.round(centerX-width/2),py=Math.round(centerY+5);
   candidates.push({left:px-8,right:px+width+8,top:py-21,bottom:py+11,px,py,manual:true});
  }else if(cached)candidates.push(cached);
  if(!saved&&!cached)for(const radius of [24,48,80,120,170,230,300])for(const [dx,dy]of [[0,-1],[-1,0],[1,0],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){
   const px=Math.round(left+dx*radius),py=Math.round(p.y+offsetY+dy*radius);
   candidates.push({left:px-8,right:px+width+8,top:py-21,bottom:py+11,px,py});
  }
  const box=candidates.find(b=>b.left>=8&&b.right<=this.w-8&&b.top>=100&&b.bottom<=this.h-35&&(b.manual||(this.clearLabelRect(b)&&!this.labelBoxes.some(a=>b.left<a.right&&b.right>a.left&&b.top<a.bottom&&b.bottom>a.top))));
  if(!box){this.labelCache.delete(key);c.restore();return;}
  if(!box.manual)this.labelCache.set(key,box);box.id=id;this.labelBoxes.push(box);
  const {px,py}=box;
  // Thin leader ends at the box edge; the label itself never covers walking space.
  const endX=Math.max(box.left+3,Math.min(box.right-3,p.x)),endY=Math.max(box.top+3,Math.min(box.bottom-3,p.y));
  c.strokeStyle='#8b9cb2';c.lineWidth=.75;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(endX,endY);c.stroke();
  c.fillStyle=background;c.fillRect(px-5,py-17,width+10,24);c.strokeStyle='#c1ccdb';c.strokeRect(px-5,py-17,width+10,24);
  c.textAlign='left';c.fillStyle=color;c.fillText(text,px,py);c.restore();
 }
 draw(sim,dt){
  if(this.dirty)this.paintBackground(sim);
  this.labelBoxes=[...(this.backgroundLabelBoxes??[])];
  const c=this.ctx,d=this.dpr,s=this.scale;c.setTransform(1,0,0,1,0,0);c.drawImage(this.background,0,0);
  c.setTransform(d*s,0,0,-d*s,d*this.tx,d*this.ty);
  if(this.showDensity&&sim.currentDensityCell!==null&&sim.currentLocalDensity>0){
   const p=sim.point(sim.currentDensityCell),radius=sim.localDensityRadiusM;
   c.beginPath();c.arc(p.x,p.y,radius,0,Math.PI*2);c.fillStyle='#ed7b4038';c.fill();c.lineWidth=.22;c.strokeStyle='#ffb36d';c.stroke();
  }
  const live=new Set();
  for(const a of sim.agents){
   live.add(a.id);const roadPoint=sim.point(a),entry=this.storefrontById?.get(a.storeAccessId);let target=roadPoint;
   if(a.insideStore&&entry){
    const position=sim.currentStorePosition(a);target={x:position[0],y:position[1]};
   }
   const emerging=entry&&a.storeExitStartedAt!==null&&sim.time-a.storeExitStartedAt<1.4;
   if(emerging){const progress=Math.max(0,Math.min(1,(sim.time-a.storeExitStartedAt)/1.4));target={x:entry.poi[0]+(roadPoint.x-entry.poi[0])*progress,y:entry.poi[1]+(roadPoint.y-entry.poi[1])*progress};}
   let p=this.display.get(a.id);if(!p){p=emerging?{x:entry.poi[0],y:entry.poi[1]}:{...roadPoint};this.display.set(a.id,p);}
   const dx=target.x-p.x,dy=target.y-p.y,distance=Math.hypot(dx,dy);
   const maxStep=(a.insideStore||emerging?3.2:sim.config.walkSpeed)*Math.max(0,dt)*1.15;
   if(distance&&maxStep){const ratio=Math.min(1,maxStep/distance);p.x+=dx*ratio;p.y+=dy*ratio;}
   const headingLength=Math.hypot(a.headingX,a.headingY);
   if(!a.insideStore&&headingLength>.01){const nx=a.headingX/headingLength,ny=a.headingY/headingLength;c.beginPath();c.moveTo(p.x-nx*.62,p.y-ny*.62);c.lineTo(p.x+nx*.32,p.y+ny*.32);c.strokeStyle=COLORS[a.group]??COLORS[0];c.lineWidth=.16;c.stroke();}
   const r=Math.max(.25,2/s);c.beginPath();c.arc(p.x,p.y,r,0,Math.PI*2);c.fillStyle=COLORS[a.group]??COLORS[0];c.fill();c.lineWidth=a.insideStore?.16:a.viewingStall?.16:a.keepRight?.11:.08;c.strokeStyle=a.insideStore?'#ffe2ad':a.viewingStall?'#fff4c9':a.blocked>=1?'#fff8df':a.keepRight?'#9dc8ff':'#ffffff90';c.stroke();
  }
  for(const id of this.display.keys())if(!live.has(id))this.display.delete(id);
  c.setTransform(d,0,0,d,0,0);
  {
   for(const [index,id]of ['A','C','D','R','S'].entries()){
    const entry=Boolean(sim.config.entryGateMask&(1<<index)),exit=Boolean(sim.config.exitGateMask&(1<<index));
    const label=entry&&exit?'양방향':entry?'진입':exit?'퇴장':'미사용',p=this.project(...this.scene.nodes[id].point);
    if(p.x<34||p.x>this.w-34||p.y<62||p.y>this.h-42)continue;
    this.label(c,...this.scene.nodes[id].point,`${id} ${label}`,{id:`gate-${id}`,color:'#fff',background:entry&&exit?'#203b62':entry?'#126a60':exit?'#995008':'#4c5c72'});
   }
  }
  if(this.showCapacitySections){
   for(const section of this.capacitySections??[]){
    this.label(c,section.center.x,section.center.y,`완구거리 ${section.minimumEffectiveWidthM.toFixed(1)}m · ${section.flowCapacityPerMinute}명/분`,{id:`capacity-main-${section.id??section.index}`,offsetY:28});
   }
   for(const section of this.connectorCapacitySections??[]){
    this.label(c,section.center.x,section.center.y,`${section.start}–${section.end} ${section.minimumEffectiveWidthM.toFixed(1)}m · ${section.flowCapacityPerMinute}명/분`,{id:`capacity-connector-${section.id??section.index}`,offsetY:-35+(section.index%3)*30});
   }
  }
  if(this.showDensity&&sim.currentDensityCell!==null&&sim.currentLocalDensity>0){
   const point=sim.point(sim.currentDensityCell),p=this.project(point.x,point.y);
   if(p.x>62&&p.x<this.w-62&&p.y>70&&p.y<this.h-62)this.label(c,point.x,point.y,`현재 최고 ${sim.currentLocalDensity.toFixed(2)}명/㎡`,{id:'density-current-peak',color:'#9b3023',offsetY:-30});
  }
  if(this.zoom>=2.4)for(const status of sim.storeStatuses()){
   const entry=this.storefrontById.get(status.id),p=this.project(entry.poi[0],entry.poi[1]);if(p.x<32||p.x>this.w-32||p.y<65||p.y>this.h-45)continue;
   const full=status.occupancy>=status.capacity;
   this.label(c,entry.poi[0],entry.poi[1],`${status.id} ${status.occupancy}/${status.capacity}`,{id:`store-${status.id}`,color:'#fff',background:full?'#9b3023':'#203b62'});
  }
  for(const [id,q]of Object.entries(sim.queues))if(q.length){const point=this.scene.nodes[id].point;this.label(c,point[0],point[1],`범위 밖 대기 ${q.length}명`,{id:`queue-${id}`,color:'#854409',offsetY:-20});}
  const length=this.zoom>2?5:20,pixels=length*s;
  c.strokeStyle='#344a65';c.lineWidth=2;c.beginPath();c.moveTo(this.w-20-pixels,this.h-77);c.lineTo(this.w-20,this.h-77);c.stroke();c.fillStyle='#263c59';c.font='14px system-ui';c.textAlign='center';c.fillText(`${length} m`,this.w-20-pixels/2,this.h-85);
  c.textAlign='right';c.fillStyle='#263c59';c.fillText('N ↑',this.w-20,79);
 }
 destroy(){this.observer.disconnect();this.events.abort();}
}
