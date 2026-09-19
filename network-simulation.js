// Connected spatial cell model. Demand, route choice and behaviour are scenario assumptions.
export const DEFAULTS=Object.freeze({
  baselinePeople:80,
  baselineFillRate:30,
  inflowA:40,
  inflowB:20,
  mainToAlleyRate:50,
  entryGateMask:31,
  exitGateMask:31,
  entryAvoidanceRate:30,
  rightHandRate:0,
  peoplePer100M2:12,
  buildingReleaseRate:25,
  storeEntryRate:25,
  storeDwellSeconds:120,
  storeUsableRate:65,
  storeCapacityDensity:.7,
  stallDepth:.8,
  stallStopRate:40,
  stallDwellSeconds:45,
  capacityDensity:.8,
  analysisMinutes:120,
  setback:.3,
  walkSpeed:1.2
});

export const LIMITS=Object.freeze({
  baselinePeople:[0,10000],
  baselineFillRate:[0,10000],
  inflowA:[0,10000],
  inflowB:[0,10000],
  mainToAlleyRate:[0,100],
  entryGateMask:[1,31],
  exitGateMask:[1,31],
  entryAvoidanceRate:[0,100],
  rightHandRate:[0,100],
  peoplePer100M2:[0,10000],
  buildingReleaseRate:[0,100],
  storeEntryRate:[0,100],
  storeDwellSeconds:[10,86400],
  storeUsableRate:[0,100],
  storeCapacityDensity:[.01,10],
  stallDepth:[0,20],
  stallStopRate:[0,100],
  stallDwellSeconds:[0,86400],
  capacityDensity:[.01,10],
  analysisMinutes:[0,10080],
  setback:[0,20],
  walkSpeed:[.1,5]
});

const MAIN_PORTS=['W','E'];
const ALLEY_PORTS=['R','S'];
const ALL_PORTS=[...MAIN_PORTS,...ALLEY_PORTS];
const MAIN_ENTRIES=['A','C','D'];
const JUNCTION_NODES=['A','C','D','M','J'];
const ENTRY_SIGHT_DISTANCE_M=8;
const STORE_ENTRY_RADIUS_M=1.1;
const PORT_OPENING_RADIUS_M=2.2;
const JUNCTION_OPENING_RADIUS_M=2.75;
const LOCAL_DENSITY_RADIUS_M=2;
// Korean Highway Capacity Manual LOS-E boundary used here as an operating comparison line.
// It is not a statutory safety limit.
export const SPECIFIC_FLOW_REFERENCE_PER_MIN_M=30;
export const NORTH_SIDEWALK_WIDTH_M=4;
// Remaining finite bounds protect browser computation; none are physical capacity limits.

function pointInRing([x,y],ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
  }
  return inside;
}
function pointInPolygons(point,polygons){
  return polygons.some(polygon=>pointInRing(point,polygon.outer)&&!polygon.holes.some(hole=>pointInRing(point,hole)));
}

export function validateConfig(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('조건은 객체로 입력해야 합니다.');
  for(const [key,value]of Object.entries(input)){
    if(['baselinePeople','entryGateMask','exitGateMask','analysisMinutes'].includes(key)&&!Number.isInteger(value))throw new Error(`정수로 입력할 조건: ${key}`);
    if(!LIMITS[key]||!Number.isFinite(value)||value<LIMITS[key][0]||value>LIMITS[key][1]){
      throw new Error(`허용 범위를 벗어난 조건: ${key}`);
    }
  }
  return {...input};
}

class Heap{
  constructor(){this.items=[];}
  push(index,distance){
    const items=this.items;let cursor=items.length;items.push([index,distance]);
    while(cursor){
      const parent=(cursor-1)>>1;if(items[parent][1]<=distance)break;
      items[cursor]=items[parent];cursor=parent;
    }
    items[cursor]=[index,distance];
  }
  pop(){
    const items=this.items;if(!items.length)return null;
    const first=items[0],last=items.pop();
    if(items.length){
      let cursor=0;
      while(2*cursor+1<items.length){
        let child=2*cursor+1;
        if(child+1<items.length&&items[child+1][1]<items[child][1])child++;
        if(items[child][1]>=last[1])break;
        items[cursor]=items[child];cursor=child;
      }
      items[cursor]=last;
    }
    return first;
  }
}

export class WalkSimulation{
  constructor(scene,config={},excludedCells=[],options={}){
    this.scene=scene;
    this.config={...DEFAULTS,...validateConfig(config)};
    this.grid=scene.grid;
    this.excluded=new Set(excludedCells);
    this.time=0;
    // Live runs retain the original fixed seeds. Batch exploration can supply
    // independent seeds without changing the default, reproducible scenario.
    const suppliedSeed=Number.isFinite(options.seed)?Number(options.seed)>>>0:null;
    this.seed=(suppliedSeed??20260505)>>>0;
    this.initialSeed=this.seed;
    this.demandSeed=(Number.isFinite(options.demandSeed)?Number(options.demandSeed):suppliedSeed??20260505)>>>0;
    this.behaviourSeed=(Number.isFinite(options.behaviourSeed)
      ?Number(options.behaviourSeed)
      :suppliedSeed===null?19910227:(suppliedSeed^19910227))>>>0;
    this.demandDigest=0;
    this.serial=0;
    this.agents=[];
    this.arrivals=0;
    this.initialCount=0;
    this.networkExited=0;
    this.mainAlleyChoices=0;
    this.mainAlleyEntries=0;
    this.mainEntryAvoided=0;
    this.externalEntryAvoided=0;
    this.entryChecks=0;
    this.exits=[];
    this.completedTrips=[];
    this.remainders=[0,0];
    this.baselineRemainder=0;
    this.buildingRemainder=0;
    this.buildingQueue=0;
    this.extraRequested=0;
    this.baselineArrivals=0;
    this.buildingRequested=0;
    this.buildingArrivals=0;
    this.studyEntries=0;
    this.stallStops=0;
    this.stallStopsCompleted=0;
    this.storeEntries=0;
    this.storeVisitsCompleted=0;
    this.storeFullEncounters=0;
    this.storeReroutes=0;
    this.capacityExceedSeconds=0;
    this.peakInside=0;
    this.peakWaiting=0;
    this.occupancyIntegral=0;
    this.occupancySampleTime=0;
    this.currentLocalDensity=0;
    this.currentDensityCell=null;
    this.peakLocalDensity=0;
    this.peakDensityCell=null;
    this.nextDensitySampleAt=0;
    this.localDensityRadiusM=LOCAL_DENSITY_RADIUS_M;
    this.queues={W:[],E:[],R:[],S:[]};

    const size=this.grid.cols*this.grid.rows;
    this.active=new Uint8Array(size);
    this.kind=new Uint8Array(size);
    this.study=new Uint8Array(size);
    this.occupied=new Int32Array(size);
    this.protectedOpenings=new Uint8Array(size);
    this.stallFront=new Uint8Array(size);
    this.stallCells=new Set();
    this.cells=[];
    this.neighbors=new Array(size);
    this.targets={};
    this.fields={};this.geometryFields={};
    this.chainage=new Float32Array(size);
    this.studyEdgeDistance=new Float32Array(size);

    const edgeCandidates=this.grid.cells
      .filter(([,kind,,,inStudy,,edgeDistance])=>kind===1&&inStudy&&edgeDistance<=.65)
      .map(([index])=>index);
    this.storefrontAnchors=[];
    this.storefrontData=[];
    const usedAnchors=new Set();
    for(const store of scene.storefronts??[]){
      const ranked=edgeCandidates
        .map(index=>[index,this.distanceTo(index,store.access)])
        .filter(([,distance])=>distance<=2.2)
        .sort((a,b)=>a[1]-b[1]);
      const match=ranked.find(([index])=>!usedAnchors.has(index))??ranked[0];
      if(!match)continue;
      usedAnchors.add(match[0]);this.storefrontAnchors.push(match[0]);
      this.storefrontData.push({...store,anchorCell:match[0]});
    }

    for(const [index,kind,clearance,curbDistance,inStudy,,studyBoundaryDistance,chainage]of this.grid.cells){
      this.chainage[index]=chainage;
      this.studyEdgeDistance[index]=studyBoundaryDistance;
      this.kind[index]=kind;
      this.study[index]=inStudy;
      const junction=this.isNearJunction(index);
      const opening=this.isNearMatchingPort(index,kind)||junction;
      if(opening)this.protectedOpenings[index]=1;
      const entranceOpening=this.storefrontAnchors.some(anchor=>{const point=this.point(anchor);return this.distanceTo(index,[point.x,point.y])<=1.1;});
      const stall=kind===1&&inStudy&&studyBoundaryDistance<=this.config.stallDepth
        &&!opening&&!this.isNearStallJunction(index)&&!entranceOpening;
      if(stall)this.stallCells.add(index);
      const allowed=!stall&&(junction||(kind===2
        ?curbDistance>=.22&&curbDistance<=NORTH_SIDEWALK_WIDTH_M-.22
        :clearance>=Math.max(.22,this.config.setback)));
      // Exterior ends are always left open, even if the editing brush crossed them.
      if(allowed&&(!this.excluded.has(index)||opening)){
        this.active[index]=1;
        this.cells.push(index);
      }
    }

    for(const index of this.cells){
      const column=index%this.grid.cols,row=Math.floor(index/this.grid.cols),neighbors=[];
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const x=column+dx,y=row+dy;
        if(x<0||x>=this.grid.cols||y<0||y>=this.grid.rows)continue;
        const next=y*this.grid.cols+x;
        if(!this.active[next])continue;
        // A narrow continuous sidewalk may be represented only by touching diagonal cells.
        if(dx&&dy&&!this.active[row*this.grid.cols+x]&&!this.active[y*this.grid.cols+column]
          &&!(this.kind[index]===2&&this.kind[next]===2))continue;
        neighbors.push(next);
      }
      this.neighbors[index]=neighbors;
    }

    for(const stall of this.stallCells){
      const column=stall%this.grid.cols,row=Math.floor(stall/this.grid.cols);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const x=column+dx,y=row+dy,index=y*this.grid.cols+x;
        if(x>=0&&x<this.grid.cols&&y>=0&&y<this.grid.rows&&this.active[index]&&this.study[index])this.stallFront[index]=1;
      }
    }
    this.storefrontCells=[];
    this.storefrontEntries=[];
    for(const store of this.storefrontData){
      const anchor=store.anchorCell;
      const point=this.point(anchor);
      let nearest=null,best=Infinity;
      for(const cell of this.cells){
        if(!this.study[cell]||this.kind[cell]!==1)continue;
        const distance=this.distanceTo(cell,[point.x,point.y]);
        if(distance<best){best=distance;nearest=cell;}
      }
      if(nearest!==null&&best<=2.5){
        if(!this.storefrontCells.includes(nearest))this.storefrontCells.push(nearest);
        this.storefrontEntries.push({...store,cell:nearest});
      }
    }
    this.prepareStoreModels();

    for(const [id,node]of Object.entries(scene.nodes)){
      const radius=node.port?1.05:1.25;
      let goals=this.cells.filter(index=>this.distanceTo(index,node.point)<=radius);
      if(id==='W')goals=this.cells.filter(index=>this.kind[index]===2&&this.chainage[index]<=2);
      if(id==='E')goals=this.cells.filter(index=>this.kind[index]===2&&this.chainage[index]>=this.grid.curbLengthM-2);
      if(id==='R')goals=this.cells.filter(index=>this.kind[index]===1&&this.point(index).x>=214.6);
      if(id==='S')goals=this.cells.filter(index=>this.kind[index]===1&&this.point(index).y<=26.4);
      if(!goals.length){
        let nearest=-1,bestDistance=2.5;
        for(const index of this.cells){
          const distance=this.distanceTo(index,node.point);
          if(distance<bestDistance){bestDistance=distance;nearest=index;}
        }
        if(nearest>=0)goals=[nearest];
      }
      this.targets[id]=goals;
      this.fields[id]=this.distanceField(goals);
      this.geometryFields[id]=this.distanceField(goals,false);
    }
    this.storefrontTargetIds=[];
    for(const entry of this.storefrontEntries){
      const target=`SHOP_${entry.id}`;
      this.targets[target]=[entry.cell];
      this.fields[target]=this.distanceField([entry.cell]);
      this.storefrontTargetIds.push(target);
    }

    this.visibilityCells={};
    for(const id of [...MAIN_ENTRIES,...ALLEY_PORTS]){
      this.visibilityCells[id]=this.cells.filter(index=>
        this.kind[index]===1&&this.distanceTo(index,this.scene.nodes[id].point)<=ENTRY_SIGHT_DISTANCE_M
      );
    }

    const studyCells=this.cells.filter(index=>this.study[index]);
    this.area=studyCells.length*this.grid.step**2;
    this.studyLengthM=Math.min(...(this.targets.A??[]).map(index=>this.geometryFields.J?.[index]??Infinity).filter(Number.isFinite));
    if(!Number.isFinite(this.studyLengthM))this.studyLengthM=0;
    const capacitySection=(name,start,end,cells,index)=>{
      const lengthM=Math.min(...(this.targets[start]??[]).map(cell=>this.geometryFields[end]?.[cell]??Infinity).filter(Number.isFinite));
      const center={x:0,y:0};
      for(const cell of cells){const point=this.point(cell);center.x+=point.x;center.y+=point.y;}
      if(cells.length){center.x/=cells.length;center.y/=cells.length;}
      const areaM2=cells.length*this.grid.step**2;
      const binM=2,binCount=Math.max(1,Math.ceil(lengthM/binM));
      const counts=new Uint32Array(binCount);
      for(const cell of cells){const along=this.geometryFields[end]?.[cell];if(Number.isFinite(along))counts[Math.min(binCount-1,Math.floor(along/binM))]++;}
      const widths=[...counts].slice(1,-1).map(count=>count*this.grid.step**2/binM).filter(width=>width>=this.grid.step).sort((a,b)=>a-b);
      // A low percentile suppresses a one-cell raster notch while retaining the sustained bottleneck.
      const minimumEffectiveWidthM=widths.length?widths[Math.floor((widths.length-1)*.1)]:areaM2/Math.max(lengthM,1);
      const averageEffectiveWidthM=areaM2/Math.max(lengthM,1);
      const occupancyCapacity=Math.floor(areaM2*this.config.capacityDensity);
      const flowCapacityPerMinute=Math.floor(minimumEffectiveWidthM*SPECIFIC_FLOW_REFERENCE_PER_MIN_M);
      return {index,name,start,end,lengthM,cells,center,areaM2,capacity:occupancyCapacity,occupancyCapacity,
        minimumEffectiveWidthM,averageEffectiveWidthM,flowCapacityPerMinute,specificFlowReference:SPECIFIC_FLOW_REFERENCE_PER_MIN_M};
    };
    const tolerance=this.grid.step*7;
    const corridorCells=(start,end)=>{
      const lengthM=Math.min(...(this.targets[start]??[]).map(cell=>this.geometryFields[end]?.[cell]??Infinity).filter(Number.isFinite));
      return this.cells.filter(cell=>!this.study[cell]&&this.kind[cell]===1
        &&Number.isFinite(this.geometryFields[start]?.[cell])&&Number.isFinite(this.geometryFields[end]?.[cell])
        &&this.geometryFields[start][cell]+this.geometryFields[end][cell]<=lengthM+tolerance);
    };
    this.capacitySections=[capacitySection('완구거리 A–J','A','J',studyCells,0)];
    this.connectorCapacitySections=[['가운데 연결길 C–M','C','M'],['오른쪽 연결길 D–J','D','J']].map(([name,start,end],index)=>
      capacitySection(name,start,end,corridorCells(start,end),index+1));
    this.allCapacitySections=[...this.capacitySections,...this.connectorCapacitySections];
    this.mainMinimumEffectiveWidthM=this.capacitySections[0].minimumEffectiveWidthM;
    this.minWidth=NORTH_SIDEWALK_WIDTH_M;
    if(!options.skipInitial){
      for(let count=0;count<Math.min(this.config.baselinePeople,studyCells.length)&&studyCells.length;count++)for(let attempt=0;attempt<500;attempt++){
        const cell=studyCells[Math.floor(this.random()*studyCells.length)];
        if(!this.occupied[cell]){
          this.addAgent(cell,count%2,this.randomRoute(null,cell),{initial:true,baseline:true});
          this.initialCount++;
          break;
        }
      }
    }
    this.peakInside=this.initialCount;
    this.sampleLocalDensity();
    this.nextDensitySampleAt=1;

  }

  static reconfiguredFrom(previous,config={},excludedCells=previous.excluded){
    const next=new WalkSimulation(previous.scene,config,excludedCells,{skipInitial:true});
    const gatesChanged=next.config.entryGateMask!==previous.config.entryGateMask||next.config.exitGateMask!==previous.config.exitGateMask;
    for(const key of ['time','initialSeed','seed','demandSeed','behaviourSeed','demandDigest','serial','arrivals','initialCount',
      'baselineRemainder','buildingRemainder','buildingQueue','extraRequested','baselineArrivals','buildingRequested','buildingArrivals','studyEntries','stallStops','stallStopsCompleted','storeEntries','storeVisitsCompleted','storeFullEncounters','storeReroutes','occupancyIntegral','occupancySampleTime','peakInside','peakWaiting',
      'networkExited','mainAlleyChoices','mainAlleyEntries','mainEntryAvoided','externalEntryAvoided','entryChecks']){
      next[key]=previous[key];
    }
    next.capacityExceedSeconds=previous.config.capacityDensity===next.config.capacityDensity&&previous.area===next.area?previous.capacityExceedSeconds:0;
    next.exits=previous.exits.map(event=>({...event}));
    next.completedTrips=[...previous.completedTrips];
    next.remainders=[...previous.remainders];
    next.queues=Object.fromEntries(Object.entries(previous.queues).map(([id,requests])=>[
      id,requests.map(request=>({...request,route:[...request.route]}))
    ]));

    const used=new Set();
    const available=(cell,target)=>next.active[cell]&&!used.has(cell)
      &&(!target||Number.isFinite(next.fields[target]?.[cell]));
    const nearest=(oldCell,target)=>{
      const source=previous.point(oldCell),oldKind=previous.kind[oldCell];
      let best=null,bestScore=Infinity;
      for(const cell of next.cells){
        if(!available(cell,target))continue;
        const point=next.point(cell),kindPenalty=next.kind[cell]===oldKind?0:4;
        const score=(point.x-source.x)**2+(point.y-source.y)**2+kindPenalty;
        if(score<bestScore){bestScore=score;best=cell;}
      }
      return best;
    };

    for(const old of previous.agents){
      const route=[...old.route];let stage=old.stage,target=old.storeTarget??route[stage]??null;
      let cell=(old.insideStore||gatesChanged)&&next.active[old.cell]&&!used.has(old.cell)?old.cell:available(old.cell,target)?old.cell:nearest(old.cell,target);
      if(cell===null){target=null;cell=available(old.cell,null)?old.cell:nearest(old.cell,null);}
      if(cell===null)throw new Error('현재 사람 수를 유지할 보행 공간이 부족해요. 제외 범위를 조금 복원해 주세요.');
      if(target&&!Number.isFinite(next.fields[target]?.[cell]))target=null;
      if(!target&&stage<route.length){
        const exits=ALL_PORTS.filter(id=>Number.isFinite(next.fields[id]?.[cell]));
        route.splice(0,route.length,...(exits.length?[exits[old.id%exits.length]]:[]));stage=0;
      }
      const agent={...old,cell,route,stage,
        previousCell:next.active[old.previousCell]?old.previousCell:null,
        keepRight:next.agentKeepsRight(old.id)};
      if(gatesChanged)next.refreshRoute(agent);
      next.agents.push(agent);
      if(!agent.insideStore){next.occupied[cell]=agent.id;used.add(cell);}
    }
    next.peakLocalDensity=previous.peakLocalDensity;
    if(gatesChanged)for(const [origin,requests]of Object.entries(next.queues))for(const request of requests){
      const replacement=next.demandRequest(origin,request.group);Object.assign(request,replacement);
    }
    next.peakDensityCell=previous.peakDensityCell;
    next.nextDensitySampleAt=previous.nextDensitySampleAt;
    next.sampleLocalDensity();
    return next;
  }

  isNearMatchingPort(index,kind){
    const ids=kind===2?MAIN_PORTS:ALLEY_PORTS;
    return ids.some(id=>this.distanceTo(index,this.scene.nodes[id].point)<=PORT_OPENING_RADIUS_M);
  }

  isNearJunction(index){
    return JUNCTION_NODES.some(id=>this.distanceTo(index,this.scene.nodes[id].point)<=JUNCTION_OPENING_RADIUS_M);
  }

  isNearStallJunction(index){
    return JUNCTION_NODES.some(id=>{
      const radius=id==='J'?11:id==='M'?8:6;
      return this.distanceTo(index,this.scene.nodes[id].point)<=radius;
    });
  }

  prepareStoreModels(){
    const buildings=new Map((this.scene.buildings??[]).map(building=>[building.id,building]));
    const groups=new Map();
    for(const entry of this.storefrontEntries){
      if(!groups.has(entry.buildingId))groups.set(entry.buildingId,[]);
      groups.get(entry.buildingId).push(entry);
    }
    for(const entries of groups.values()){
      const building=buildings.get(entries[0].buildingId);
      const polygons=building?.polygons??[];
      const coordinates=polygons.flatMap(polygon=>polygon.outer);
      const xs=coordinates.map(point=>point[0]),ys=coordinates.map(point=>point[1]);
      const samples=[];
      if(xs.length){
        const step=.9;
        for(let y=Math.min(...ys)+step/2;y<Math.max(...ys);y+=step){
          for(let x=Math.min(...xs)+step/2;x<Math.max(...xs);x+=step){
            if(pointInPolygons([x,y],polygons))samples.push([x,y]);
          }
        }
      }
      for(const entry of entries){
        const allocatedArea=entry.footprintAreaM2/entries.length;
        const usableArea=allocatedArea*this.config.storeUsableRate/100;
        const owned=samples.filter(point=>{
          const own=Math.hypot(point[0]-entry.poi[0],point[1]-entry.poi[1]);
          return entries.every(other=>other===entry||own<=Math.hypot(point[0]-other.poi[0],point[1]-other.poi[1]));
        });
        entry.allocatedAreaM2=allocatedArea;
        entry.usableAreaM2=usableArea;
        entry.capacity=Math.max(0,Math.floor(usableArea*this.config.storeCapacityDensity));
        entry.interiorPoints=(owned.length?owned:samples.length?samples:[entry.poi]);
      }
    }
    this.storefrontById=new Map(this.storefrontEntries.map(entry=>[entry.id,entry]));
    this.totalStoreCapacity=this.storefrontEntries.reduce((sum,entry)=>sum+entry.capacity,0);
  }

  storeOccupancy(storeId){return this.agents.filter(agent=>agent.insideStore&&agent.storeAccessId===storeId).length;}

  storeStatuses(){
    const occupied=new Map(),waiting=new Map();
    for(const agent of this.agents){
      if(agent.insideStore)occupied.set(agent.storeAccessId,(occupied.get(agent.storeAccessId)??0)+1);
      if(agent.waitingForStore)waiting.set(agent.storeAccessId,(waiting.get(agent.storeAccessId)??0)+1);
    }
    return this.storefrontEntries.map(entry=>({id:entry.id,name:entry.name,capacity:entry.capacity,
      occupancy:occupied.get(entry.id)??0,waiting:waiting.get(entry.id)??0,
      allocatedAreaM2:entry.allocatedAreaM2,usableAreaM2:entry.usableAreaM2}));
  }

  chooseStoreEntry(excludeId=null){
    const choices=this.storefrontEntries.filter(entry=>entry.id!==excludeId);
    if(!choices.length)return null;
    const available=choices.filter(entry=>this.storeOccupancy(entry.id)<entry.capacity);
    const pool=available.length?available:choices;
    const weights=pool.map(entry=>Math.max(1,entry.capacity-this.storeOccupancy(entry.id)));
    const total=weights.reduce((sum,value)=>sum+value,0);
    let pick=this.behaviourRandom()*total;
    for(let index=0;index<pool.length;index++){pick-=weights[index];if(pick<=0)return pool[index];}
    return pool.at(-1);
  }

  pickInteriorPoint(entry,agentId,visitIndex){
    const points=entry?.interiorPoints??[entry?.poi??[0,0]];
    return [...points[(agentId*17+visitIndex*29)%points.length]];
  }

  currentStorePosition(agent){
    const from=agent.storeMovementFrom??this.storefrontById.get(agent.storeAccessId)?.poi??[0,0];
    const to=agent.storeMovementTo??from;
    const progress=Math.max(0,Math.min(1,(this.time-agent.storeMoveStartedAt)/Math.max(.1,agent.storeMoveDuration)));
    return [from[0]+(to[0]-from[0])*progress,from[1]+(to[1]-from[1])*progress];
  }

  setStoreMovement(agent,from,to,speed=.75){
    agent.storeMovementFrom=[...from];agent.storeMovementTo=[...to];agent.storeMoveStartedAt=this.time;
    agent.storeMoveDuration=Math.max(.8,Math.hypot(to[0]-from[0],to[1]-from[1])/speed);
  }

  beginStoreVisit(agent,entry){
    agent.insideStore=true;agent.waitingForStore=false;agent.storeEnteredAt=this.time;
    const dwellFactor=.5+this.behaviourRandom();
    agent.storeUntil=this.time+Math.max(10,this.config.storeDwellSeconds*dwellFactor);agent.storeVisited=true;agent.storeTarget=null;
    agent.storeLeaving=false;agent.storeWanderCount=0;
    this.setStoreMovement(agent,entry.poi,this.pickInteriorPoint(entry,agent.id,0));
    this.occupied[agent.cell]=0;this.storeEntries++;
  }

  updateStoreVisit(agent){
    const entry=this.storefrontById.get(agent.storeAccessId);if(!entry)return;
    const movementDone=this.time>=agent.storeMoveStartedAt+agent.storeMoveDuration;
    if(this.time>=agent.storeUntil&&!agent.storeLeaving){
      const current=this.currentStorePosition(agent);agent.storeLeaving=true;this.setStoreMovement(agent,current,entry.poi,.85);return;
    }
    if(agent.storeLeaving){
      if(movementDone&&!this.occupied[agent.cell]){
        agent.insideStore=false;agent.storeExitStartedAt=this.time;this.occupied[agent.cell]=agent.id;this.storeVisitsCompleted++;
      }
      return;
    }
    if(movementDone){
      const current=agent.storeMovementTo;agent.storeWanderCount++;
      this.setStoreMovement(agent,current,this.pickInteriorPoint(entry,agent.id,agent.storeWanderCount));
    }
  }

  agentKeepsRight(id){
    const mixed=Math.imul((id^0x45d9f3b)>>>0,0x27d4eb2d)>>>0;
    return mixed%10000/100<this.config.rightHandRate;
  }

  randomRoute(origin,cell){
    const ports=ALL_PORTS.filter(id=>this.portAllowed(id,'exit')&&id!==origin&&this.targets[id]?.length&&Number.isFinite(this.fields[id]?.[cell]));
    if(!ports.length)return [];
    return [ports[Math.floor(this.demandRandom()*ports.length)]];
  }

  routeThroughEntry(entry,exit,reverse=false){
    const outward={A:['A','M','J'],C:['C','M','J'],D:['D','J']}[entry]??[entry];
    return reverse?[...outward].reverse().concat(exit):outward.concat(exit);
  }

  selectedMainGates(mask){
    return MAIN_ENTRIES.filter((id,index)=>(mask&(1<<index))&&this.targets[id]?.length);
  }

  portAllowed(id,direction){
    const bit={R:8,S:16}[id];return !bit||Boolean(this.config[`${direction}GateMask`]&bit);
  }

  canStep(from,to){
    if(this.kind[from]===this.kind[to])return true;
    // Classify each sidewalk/alley crossing by its nearest junction. No cells are removed.
    const a=this.point(from),b=this.point(to),point=[(a.x+b.x)/2,(a.y+b.y)/2];
    let gate=0,best=Infinity;
    MAIN_ENTRIES.forEach((id,index)=>{const p=this.scene.nodes[id].point,d=Math.hypot(p[0]-point[0],p[1]-point[1]);if(d<best){best=d;gate=index;}});
    const direction=this.kind[from]===2?'entry':'exit';
    return Boolean(this.config[`${direction}GateMask`]&(1<<gate));
  }

  refreshRoute(agent){
    if(agent.storeTarget&&!Number.isFinite(this.fields[agent.storeTarget]?.[agent.cell]))agent.storeTarget=null;
    if(agent.mainToAlleyIntent&&!agent.studyVisited&&this.kind[agent.cell]===2){
      const entries=this.selectedMainGates(this.config.entryGateMask).filter(id=>Number.isFinite(this.fields[id][agent.cell]));
      if(entries.length){
        const entry=entries[agent.id%entries.length],inside=this.targets.M?.[0];
        const exit=this.randomRoute(null,inside)[0];
        if(exit){agent.route=[entry,'M',exit];agent.stage=0;agent.entryNode=entry;return;}
      }
    }
    agent.route=this.randomRoute(null,agent.cell);agent.stage=0;
  }

  demandRequest(origin,group){
    const cell=this.targets[origin]?.[0];
    if(cell===undefined)return {origin,group,route:[],entryNode:null,mainToAlleyIntent:false};
    if(MAIN_PORTS.includes(origin)){
      const mainToAlleyIntent=this.demandRandom()*100<this.config.mainToAlleyRate;
      if(!mainToAlleyIntent){
        return {origin,group,route:[origin==='W'?'E':'W'],entryNode:null,mainToAlleyIntent:false};
      }
      this.mainAlleyChoices++;
      const entries=this.selectedMainGates(this.config.entryGateMask).filter(id=>Number.isFinite(this.fields[id][cell]));
      const preferredExits=ALLEY_PORTS.filter(id=>this.portAllowed(id,'exit'));
      const exits=(preferredExits.length?preferredExits:MAIN_PORTS).filter(id=>this.targets[id]?.length&&Number.isFinite(this.fields[id][cell]));
      if(!entries.length||!exits.length)return {origin,group,route:[],entryNode:null,mainToAlleyIntent:true};
      const entryNode=entries[Math.floor(this.demandRandom()*entries.length)];
      const exit=exits[Math.floor(this.demandRandom()*exits.length)];
      return {origin,group,route:this.routeThroughEntry(entryNode,exit),entryNode,mainToAlleyIntent:true};
    }
    const destinations=ALL_PORTS.filter(id=>this.portAllowed(id,'exit')&&id!==origin&&this.targets[id]?.length&&Number.isFinite(this.fields[id]?.[cell]));
    if(!destinations.length)return {origin,group,route:[],entryNode:null,mainToAlleyIntent:false};
    const destination=destinations[Math.floor(this.demandRandom()*destinations.length)];
    if(MAIN_PORTS.includes(destination)){
      const entries=this.selectedMainGates(this.config.exitGateMask).filter(id=>Number.isFinite(this.fields[id]?.[cell]));
      if(entries.length){
        const entry=entries[Math.floor(this.demandRandom()*entries.length)];
        return {origin,group,route:this.routeThroughEntry(entry,destination,true),entryNode:null,mainToAlleyIntent:false};
      }
    }
    return {origin,group,route:[destination],entryNode:null,mainToAlleyIntent:false};
  }

  random(){
    this.seed=(Math.imul(1664525,this.seed)+1013904223)>>>0;
    return this.seed/4294967296;
  }

  demandRandom(){
    this.demandSeed=(Math.imul(1664525,this.demandSeed)+1013904223)>>>0;
    return this.demandSeed/4294967296;
  }

  behaviourRandom(){
    this.behaviourSeed=(Math.imul(1664525,this.behaviourSeed)+1013904223)>>>0;
    return this.behaviourSeed/4294967296;
  }

  point(value){
    const index=typeof value==='number'?value:value.cell;
    return {
      x:this.grid.x0+(index%this.grid.cols)*this.grid.step,
      y:this.grid.y0+Math.floor(index/this.grid.cols)*this.grid.step
    };
  }

  distanceTo(index,point){
    const value=this.point(index);
    return Math.hypot(value.x-point[0],value.y-point[1]);
  }

  stepDistance(from,to){
    const difference=Math.abs(from-to);
    return this.grid.step*(difference===1||difference===this.grid.cols?1:Math.SQRT2);
  }

  distanceField(goals,respectGates=true){
    const field=new Float32Array(this.active.length);field.fill(Infinity);
    const heap=new Heap();
    for(const index of goals){field[index]=0;heap.push(index,0);}
    while(heap.items.length){
      const [index,distance]=heap.pop();
      if(distance>field[index]+.0001)continue;
      for(const next of this.neighbors[index]){
        if(respectGates&&!this.canStep(next,index))continue;
        const candidate=distance+this.stepDistance(index,next);
        if(candidate<field[next]-.0001){field[next]=candidate;heap.push(next,candidate);}
      }
    }
    return field;
  }

  addAgent(cell,group,route,options={}){
    const id=++this.serial;
    const choosesStore=!options.buildingSource&&this.storefrontTargetIds.length
      &&this.behaviourRandom()*100<this.config.storeEntryRate;
    const chosenStore=choosesStore?this.chooseStoreEntry():null;
    const storeTarget=chosenStore?`SHOP_${chosenStore.id}`:null;
    const agent={
      id,
      cell,
      group,
      route:[...route],
      stage:0,
      credit:0,
      blocked:0,
      previousCell:null,
      headingX:0,
      headingY:0,
      wanderBias:(this.behaviourRandom()-.5)*.24,
      nextWanderTime:this.time+3+this.behaviourRandom()*7,
      nextYieldTime:0,
      pauseUntil:0,
      shoppingUntil:0,
      viewingStall:false,
      insideStore:false,
      storeUntil:0,
      storeTarget,
      storeAccessId:options.storeAccessId??chosenStore?.id??null,
      storeEnteredAt:0,
      storeExitStartedAt:options.storeAccessId?this.time:null,
      storeVisited:false,
      waitingForStore:false,
      nextStoreRetryAt:0,
      lastFullStoreId:null,
      stallDecisionMade:Boolean(options.buildingSource),
      initial:Boolean(options.initial),
      baseline:Boolean(options.baseline),
      buildingSource:Boolean(options.buildingSource),
      origin:options.origin??null,
      entryNode:options.entryNode??null,
      entryDecisionMade:false,
      entryDeclined:false,
      keepRight:this.agentKeepsRight(id),
      studyActive:Boolean(this.study[cell]),
      studyVisited:Boolean(this.study[cell]),
      studyStart:this.study[cell]?this.time:null,
      outsideSince:null
    };
    this.agents.push(agent);
    this.occupied[cell]=agent.id;
    return agent;
  }

  visiblePeople(entryId,excludeAgentId=null){
    let count=0;
    for(const cell of this.visibilityCells[entryId]??[]){
      const id=this.occupied[cell];
      if(id&&id!==excludeAgentId)count++;
    }
    return count;
  }

  shouldAvoid(entryId,excludeAgentId=null){
    return this.visiblePeople(entryId,excludeAgentId)>0
      &&this.behaviourRandom()*100<this.config.entryAvoidanceRate;
  }

  processReachedTargets(agent){
    if(agent.storeTarget){
      if((this.fields[agent.storeTarget]?.[agent.cell]??Infinity)<=STORE_ENTRY_RADIUS_M){
        const entry=this.storefrontById.get(agent.storeAccessId);
        if(entry&&this.storeOccupancy(entry.id)<entry.capacity){this.beginStoreVisit(agent,entry);return;}
        agent.waitingForStore=true;
        if(this.time>=agent.nextStoreRetryAt){
          if(agent.lastFullStoreId!==entry?.id){this.storeFullEncounters++;agent.lastFullStoreId=entry?.id??null;}
          agent.nextStoreRetryAt=this.time+2;
          const alternative=this.chooseStoreEntry(entry?.id);
          if(alternative&&this.storeOccupancy(alternative.id)<alternative.capacity){
            agent.storeAccessId=alternative.id;agent.storeTarget=`SHOP_${alternative.id}`;agent.waitingForStore=false;this.storeReroutes++;
          }
        }
      }
      return;
    }
    while(agent.stage<agent.route.length&&this.fields[agent.route[agent.stage]]?.[agent.cell]===0){
      const reached=agent.route[agent.stage];
      if(reached===agent.entryNode&&!agent.entryDecisionMade){
        agent.entryDecisionMade=true;
        this.entryChecks++;
        if(this.shouldAvoid(reached,agent.id)){
          agent.entryDeclined=true;
          this.mainEntryAvoided++;
          agent.route=[agent.origin==='W'?'E':'W'];
          agent.stage=0;
          return;
        }
        this.mainAlleyEntries++;
      }
      agent.stage++;
    }
  }

  finishStudy(agent){
    if(!agent.studyActive)return;
    const exitTime=agent.outsideSince??this.time;
    this.exits.push({id:agent.id,time:exitTime});
    if(!agent.initial&&agent.studyStart!==null)this.completedTrips.push(exitTime-agent.studyStart);
    agent.studyActive=false;
    agent.studyStart=null;
    agent.outsideSince=null;
  }

  updateStudy(agent){
    if(this.study[agent.cell]){
      if(!agent.studyVisited)this.studyEntries++;
      agent.studyVisited=true;
      if(!agent.studyActive){agent.studyActive=true;agent.studyStart=this.time;}
      agent.outsideSince=null;
    }else if(agent.studyActive){
      if(agent.outsideSince===null)agent.outsideSince=this.time;
      if(this.time-agent.outsideSince>=2)this.finishStudy(agent);
    }
  }

  baselineRequest(){
    const availableAlley=ALLEY_PORTS.filter(id=>this.portAllowed(id,'entry'));
    const fromMain=!availableAlley.length||this.demandRandom()<.6;
    const origins=fromMain?MAIN_PORTS:availableAlley;
    const origin=origins[Math.floor(this.demandRandom()*origins.length)];
    const cell=this.targets[origin]?.[0];
    if(cell===undefined)return null;
    let route=[],entryNode=null;
    if(fromMain){
      const entries=this.selectedMainGates(this.config.entryGateMask).filter(id=>Number.isFinite(this.fields[id]?.[cell]));
      const preferredExits=ALLEY_PORTS.filter(id=>this.portAllowed(id,'exit'));
      const exits=(preferredExits.length?preferredExits:MAIN_PORTS).filter(id=>this.targets[id]?.length&&Number.isFinite(this.fields[id]?.[cell]));
      if(entries.length&&exits.length){entryNode=entries[Math.floor(this.demandRandom()*entries.length)];route=this.routeThroughEntry(entryNode,exits[Math.floor(this.demandRandom()*exits.length)]);}
    }else{
      const entries=this.selectedMainGates(this.config.exitGateMask).filter(id=>Number.isFinite(this.fields[id]?.[cell]));
      const exits=MAIN_PORTS.filter(id=>this.targets[id]?.length&&Number.isFinite(this.fields[id]?.[cell]));
      if(entries.length&&exits.length)route=this.routeThroughEntry(entries[Math.floor(this.demandRandom()*entries.length)],exits[Math.floor(this.demandRandom()*exits.length)],true);
    }
    return route.length?{origin,group:fromMain?0:1,route,entryNode,mainToAlleyIntent:fromMain,baseline:true}:null;
  }

  maintainBaseline(dt){
    const inside=this.agents.filter(agent=>!agent.insideStore&&this.study[agent.cell]).length;
    const approaching=this.agents.filter(agent=>agent.baseline&&!agent.studyVisited).length;
    const queued=Object.values(this.queues).flat().filter(request=>request.baseline).length;
    const deficit=Math.max(0,this.config.baselinePeople-inside-approaching-queued);
    if(!deficit){this.baselineRemainder=Math.min(this.baselineRemainder,.999);return;}
    this.baselineRemainder+=this.config.baselineFillRate*dt/60;
    const count=Math.min(deficit,Math.floor(this.baselineRemainder+1e-10));
    this.baselineRemainder-=count;
    for(let index=0;index<count;index++){
      const request=this.baselineRequest();if(!request)continue;
      this.arrivals++;this.baselineArrivals++;this.queues[request.origin].push(request);
    }
  }

  buildingPopulation(){
    const area=this.scene.storefrontSummary?.matchedBuildingFootprintAreaM2??0;
    return area*this.config.peoplePer100M2/100;
  }

  buildingDemandPerMinute(){
    return this.buildingPopulation()*this.config.buildingReleaseRate/100/10;
  }

  queueBuildingDemand(dt){
    const progress=Math.min(1,this.time/600);
    const target=Math.floor(this.buildingPopulation()*this.config.buildingReleaseRate/100*progress+1e-10);
    const count=Math.max(0,target-this.buildingRequested);
    this.buildingQueue+=count;this.buildingRequested+=count;
  }

  releaseBuildingPeople(){
    if(!this.buildingQueue||!this.storefrontCells.length)return;
    const open=this.storefrontEntries.filter(entry=>!this.occupied[entry.cell]).sort(()=>this.random()-.5);
    for(const entry of open){
      if(!this.buildingQueue)break;
      const cell=entry.cell;
      const route=this.randomRoute(null,cell);if(!route.length)continue;
      this.buildingQueue--;this.arrivals++;this.buildingArrivals++;this.studyEntries++;
      this.addAgent(cell,2,route,{buildingSource:true,storeAccessId:entry.id});
    }
  }

  sampleLocalDensity(){
    const radiusCells=Math.ceil(LOCAL_DENSITY_RADIUS_M/this.grid.step);
    let bestDensity=0,bestCell=null;
    const centers=this.agents.filter(agent=>!agent.insideStore&&this.study[agent.cell]).map(agent=>agent.cell);
    for(const center of centers){
      const column=center%this.grid.cols,row=Math.floor(center/this.grid.cols),point=this.point(center);
      let people=0,areaCells=0;
      for(let dy=-radiusCells;dy<=radiusCells;dy++)for(let dx=-radiusCells;dx<=radiusCells;dx++){
        const x=column+dx,y=row+dy;if(x<0||x>=this.grid.cols||y<0||y>=this.grid.rows)continue;
        const cell=y*this.grid.cols+x;if(!this.active[cell]||!this.study[cell])continue;
        const candidate=this.point(cell);if(Math.hypot(candidate.x-point.x,candidate.y-point.y)>LOCAL_DENSITY_RADIUS_M)continue;
        areaCells++;if(this.occupied[cell])people++;
      }
      const density=areaCells?people/(areaCells*this.grid.step**2):0;
      if(density>bestDensity){bestDensity=density;bestCell=center;}
    }
    this.currentLocalDensity=bestDensity;
    this.currentDensityCell=bestCell;
    if(bestDensity>this.peakLocalDensity){this.peakLocalDensity=bestDensity;this.peakDensityCell=bestCell;}
  }

  queueDemand(dt){
    [this.config.inflowA,this.config.inflowB].forEach((rate,group)=>{
      this.remainders[group]+=rate*dt/60;
      const count=Math.floor(this.remainders[group]+1e-10);
      this.remainders[group]-=count;
      for(let index=0;index<count;index++){
        const origins=group?ALLEY_PORTS:MAIN_PORTS;
        const origin=origins[this.demandRandom()<.5?0:1];
        const request=this.demandRequest(origin,group);
        this.arrivals++;this.extraRequested++;
        for(const character of origin+request.route.join('')){
          this.demandDigest=(Math.imul(this.demandDigest,31)+character.charCodeAt(0))>>>0;
        }
        // A person approaching an alley from outside may see someone within 8 m and pass by.
        if(ALLEY_PORTS.includes(origin)&&this.shouldAvoid(origin)){
          this.externalEntryAvoided++;
          continue;
        }
        this.queues[origin].push(request);
      }
    });
    this.maintainBaseline(dt);
    this.queueBuildingDemand(dt);
  }

  update(dt){
    if(!Number.isFinite(dt)||dt<=0||dt>.11)throw new Error('시간 간격은 0.1초 이하여야 합니다.');
    this.time+=dt;
    this.queueDemand(dt);
    this.releaseBuildingPeople();

    const order=[...this.agents];
    for(let index=order.length-1;index>0;index--){
      const other=Math.floor(this.random()*(index+1));
      [order[index],order[other]]=[order[other],order[index]];
    }

    const departed=new Set(),diagonals=new Map();
    for(const agent of order){
      if(agent.insideStore){
        this.updateStoreVisit(agent);if(agent.insideStore)continue;
      }
      if(!agent.route.length&&!agent.storeTarget){agent.blocked+=dt;continue;}
      this.processReachedTargets(agent);
      if(agent.insideStore)continue;
      if(!agent.storeTarget&&agent.stage===agent.route.length){
        this.finishStudy(agent);
        this.occupied[agent.cell]=0;
        departed.add(agent.id);
        this.networkExited++;
        continue;
      }

      if(agent.viewingStall&&this.time>=agent.shoppingUntil){agent.viewingStall=false;this.stallStopsCompleted++;}
      if(!agent.stallDecisionMade&&this.stallFront[agent.cell]){
        agent.stallDecisionMade=true;
        if(this.behaviourRandom()*100<this.config.stallStopRate){
          agent.viewingStall=true;agent.shoppingUntil=this.time+this.config.stallDwellSeconds;this.stallStops++;
        }
      }
      if(agent.viewingStall&&this.time<agent.shoppingUntil){this.updateStudy(agent);continue;}
      if(this.time<agent.pauseUntil){agent.blocked+=dt;this.updateStudy(agent);continue;}
      agent.credit=Math.min(1.1,agent.credit+this.config.walkSpeed*dt);
      if(agent.credit<this.grid.step){this.updateStudy(agent);continue;}

      const target=agent.storeTarget??agent.route[agent.stage];
      const field=this.fields[target];
      const current=field?.[agent.cell]??Infinity;
      const position=this.point(agent);
      const targetCell=this.targets[target]?.[0];
      const targetPoint=targetCell===undefined?position:this.point(targetCell);
      const goal=this.scene.nodes[target]?.point??[targetPoint.x,targetPoint.y];
      const goalX=goal[0]-position.x,goalY=goal[1]-position.y;
      const goalLength=Math.hypot(goalX,goalY)||1;
      let best=null,bestScore=Infinity;
      const deliberateYield=agent.blocked>5&&this.time>=agent.nextYieldTime;
      if(!agent.keepRight&&this.time>=agent.nextWanderTime){
        agent.wanderBias=(this.behaviourRandom()-.5)*.24;
        agent.nextWanderTime=this.time+3+this.behaviourRandom()*7;
      }

      for(const cell of this.neighbors[agent.cell]){
        if(!this.canStep(agent.cell,cell))continue;
        if(this.occupied[cell]||!Number.isFinite(field?.[cell]))continue;
        if(cell===agent.previousCell&&!deliberateYield)continue;
        if(field[cell]>current+(deliberateYield?this.grid.step*1.1:.03))continue;
        const cost=this.stepDistance(agent.cell,cell);
        if(cost>agent.credit+1e-8)continue;
        const next=this.point(cell),dx=next.x-position.x,dy=next.y-position.y;
        let diagonal=null;
        if(Math.abs(cell-agent.cell)!==1&&Math.abs(cell-agent.cell)!==this.grid.cols){
          const square=Math.min(Math.floor(cell/this.grid.cols),Math.floor(agent.cell/this.grid.cols))*this.grid.cols
            +Math.min(cell%this.grid.cols,agent.cell%this.grid.cols);
          diagonal={square,orientation:Math.sign(dx*dy)};
          if(diagonals.has(square)&&diagonals.get(square)!==diagonal.orientation)continue;
        }
        const congestion=this.neighbors[cell].reduce((sum,neighbor)=>sum+(this.occupied[neighbor]?1:0),0);
        // Positive rightward means the candidate step is on the walker's right side.
        const rightward=(dx*goalY-dy*goalX)/(goalLength*this.grid.step);
        const lateralPreference=agent.keepRight?-rightward*.18:rightward*agent.wanderBias;
        const headingLength=Math.hypot(agent.headingX,agent.headingY);
        const headingAlignment=headingLength?(dx*agent.headingX+dy*agent.headingY)/(cost*headingLength):1;
        const turnPenalty=(1-headingAlignment)*.16;
        const retreatPenalty=field[cell]>current?.8:0;
        const score=field[cell]+congestion*.12+turnPenalty+retreatPenalty+this.random()*(agent.keepRight?.035:.11)+lateralPreference;
        if(score<bestScore){bestScore=score;best={cell,cost,diagonal};}
      }

      if(best){
        const improving=field[best.cell]<current;
        const previous=agent.cell,next=this.point(best.cell);
        this.occupied[agent.cell]=0;
        agent.cell=best.cell;
        this.occupied[agent.cell]=agent.id;
        agent.previousCell=previous;
        agent.headingX=agent.headingX*.55+(next.x-position.x)*.45;
        agent.headingY=agent.headingY*.55+(next.y-position.y)*.45;
        agent.credit-=best.cost;
        if(!improving){agent.nextYieldTime=this.time+4;agent.pauseUntil=this.time+.35;}
        agent.blocked=improving?0:Math.max(0,agent.blocked-1.5);
        if(best.diagonal)diagonals.set(best.diagonal.square,best.diagonal.orientation);
      }else{
        agent.blocked+=dt;
        agent.credit=Math.min(agent.credit,.85);
      }
      this.updateStudy(agent);
    }

    if(departed.size)this.agents=this.agents.filter(agent=>!departed.has(agent.id));
    for(const origin of ALL_PORTS){
      if(!this.portAllowed(origin,'entry'))continue;
      const openCells=this.targets[origin]
        .filter(cell=>!this.occupied[cell])
        .map(cell=>[cell,this.random()])
        .sort((a,b)=>a[1]-b[1])
        .map(value=>value[0]);
      for(const cell of openCells){
        if(!this.queues[origin].length)break;
        const request=this.queues[origin][0];
        if(!request.route.length||!Number.isFinite(this.fields[request.route[0]]?.[cell]))continue;
        this.queues[origin].shift();
        this.addAgent(cell,request.group,request.route,request);
      }
    }
    this.occupancyIntegral+=this.agents.filter(agent=>!agent.insideStore&&this.study[agent.cell]).length*dt;
    this.occupancySampleTime+=dt;
    const insideNow=this.agents.filter(agent=>!agent.insideStore&&this.study[agent.cell]).length;
    const waitingNow=Object.values(this.queues).reduce((sum,queue)=>sum+queue.length,0)+this.buildingQueue
      +this.agents.filter(agent=>!this.study[agent.cell]&&agent.blocked>=1).length
      +this.agents.filter(agent=>agent.waitingForStore).length;
    this.peakInside=Math.max(this.peakInside,insideNow);
    this.peakWaiting=Math.max(this.peakWaiting,waitingNow);
    if(insideNow>Math.floor(this.area*this.config.capacityDensity))this.capacityExceedSeconds+=dt;
    if(this.time+1e-9>=this.nextDensitySampleAt){this.sampleLocalDensity();this.nextDensitySampleAt=Math.floor(this.time)+1;}
  }

  stats(){
    const queued=Object.fromEntries(Object.entries(this.queues).map(([key,value])=>[key,value.length]));
    const waitingOutside=Object.values(queued).reduce((sum,value)=>sum+value,0);
    const waitingApproach=this.agents.filter(agent=>!this.study[agent.cell]&&agent.blocked>=1).length;
    const inside=this.agents.filter(agent=>!agent.insideStore&&this.study[agent.cell]).length;
    const entryAvoided=this.mainEntryAvoided+this.externalEntryAvoided;
    const storeStatus=this.storeStatuses();
    const directionCounts={east:0,west:0,north:0,south:0,still:0};
    for(const agent of this.agents){
      if(agent.insideStore)continue;
      const magnitude=Math.hypot(agent.headingX,agent.headingY);
      if(magnitude<.01)directionCounts.still++;
      else if(Math.abs(agent.headingX)>Math.abs(agent.headingY))directionCounts[agent.headingX>0?'east':'west']++;
      else directionCounts[agent.headingY>0?'north':'south']++;
    }
    return {
      elapsedSeconds:this.time,
      inside,
      averageInside:this.occupancySampleTime?this.occupancyIntegral/this.occupancySampleTime:inside,
      baselineTarget:this.config.baselinePeople,
      networkInside:this.agents.length,
      waitingA:queued.W+queued.E,
      waitingB:queued.R+queued.S,
      waitingApproach,
      waitingOutside,
      waitingStores:this.buildingQueue,
      queued,
      completed:this.exits.length,
      networkExited:this.networkExited,
      passedLastMinute:new Set(this.exits.filter(event=>event.time>this.time-60).map(event=>event.id)).size,
      demandDigest:this.demandDigest,
      averageTravelSeconds:this.completedTrips.length
        ?this.completedTrips.reduce((sum,value)=>sum+value,0)/this.completedTrips.length
        :null,
      arrivals:this.arrivals,
      extraRequested:this.extraRequested,
      baselineArrivals:this.baselineArrivals,
      buildingRequested:this.buildingRequested,
      buildingArrivals:this.buildingArrivals,
      studyEntries:this.studyEntries,
      buildingPopulation:this.buildingPopulation(),
      storefrontCount:this.storefrontEntries.length,
      storefrontBuildingCount:this.scene.storefrontSummary?.buildingCount??0,
      storefrontFootprintAreaM2:this.scene.storefrontSummary?.matchedBuildingFootprintAreaM2??0,
      buildingDemandPerMinute:this.buildingDemandPerMinute(),
      buildingReleasePoolRemaining:Math.max(0,Math.floor(this.buildingPopulation()*this.config.buildingReleaseRate/100)-this.buildingRequested),
      stallStops:this.stallStops,
      stallStopsCompleted:this.stallStopsCompleted,
      currentStallViewers:this.agents.filter(agent=>agent.viewingStall).length,
      currentStoreVisitors:this.agents.filter(agent=>agent.insideStore).length,
      waitingStoreEntry:this.agents.filter(agent=>agent.waitingForStore).length,
      storeEntries:this.storeEntries,
      storeVisitsCompleted:this.storeVisitsCompleted,
      storeFullEncounters:this.storeFullEncounters,
      storeReroutes:this.storeReroutes,
      totalStoreCapacity:this.totalStoreCapacity,
      storeStatus,
      stallAreaM2:this.stallCells.size*this.grid.step**2,
      peakInside:this.peakInside,
      peakWaiting:this.peakWaiting,
      referenceCapacity:Math.floor(this.area*this.config.capacityDensity),
      capacityUsePercent:this.area?this.peakInside/(this.area*this.config.capacityDensity)*100:0,
      capacityExceedSeconds:this.capacityExceedSeconds,
      localDensityRadiusM:LOCAL_DENSITY_RADIUS_M,
      currentLocalDensity:this.currentLocalDensity,
      currentDensityCell:this.currentDensityCell,
      peakLocalDensity:this.peakLocalDensity,
      peakDensityCell:this.peakDensityCell,
      initialCount:this.initialCount,
      mainAlleyChoices:this.mainAlleyChoices,
      mainAlleyEntries:this.mainAlleyEntries,
      mainEntryAvoided:this.mainEntryAvoided,
      externalEntryAvoided:this.externalEntryAvoided,
      entryAvoided,
      entryChecks:this.entryChecks,
      rightHandAgents:this.agents.filter(agent=>agent.keepRight).length,
      entryGateMask:this.config.entryGateMask,
      exitGateMask:this.config.exitGateMask,
      modelAreaM2:this.area,
      sourceBoundaryAreaM2:this.scene.roadBoundaryAreaM2??0,
      studyLengthM:this.studyLengthM,
      studyDemandPerMinute:this.config.inflowB+this.config.inflowA*this.config.mainToAlleyRate/100+this.buildingDemandPerMinute(),
      capacitySections:this.capacitySections.map(section=>this.capacitySectionStats(section)),
      connectorCapacitySections:this.connectorCapacitySections.map(section=>this.capacitySectionStats(section)),
      directionCounts,
      minModelWidthM:this.minWidth
    };
  }

  capacitySectionStats({cells,...section}){
    return {...section,currentOccupancy:cells.reduce((count,cell)=>count+(this.occupied[cell]?1:0),0)};
  }
}
