export const EXPLORE_VARIABLES=Object.freeze([
  {key:'baselinePeople',label:'평상시 기준 인원',unit:'명',limit:[0,10000]},
  {key:'inflowA',label:'북쪽 추가 유입',unit:'명/분',limit:[0,10000]},
  {key:'inflowB',label:'동·남쪽 추가 유입',unit:'명/분',limit:[0,10000]},
  {key:'mainToAlleyRate',label:'대로→골목 진입',unit:'%',limit:[0,100]},
  {key:'buildingReleaseRate',label:'건물 유출 비율',unit:'%',limit:[0,100]},
  {key:'storeEntryRate',label:'점포 진입 비율',unit:'%',limit:[0,100]},
  {key:'stallStopRate',label:'매대 구경 비율',unit:'%',limit:[0,100]}
]);

const uint=value=>Number(value)>>>0;
export function mixSeed(value){
  let seed=uint(value)+0x9e3779b9;
  seed=Math.imul(seed^(seed>>>16),0x21f0aaad);
  seed=Math.imul(seed^(seed>>>15),0x735a2d97);
  return uint(seed^(seed>>>15))||1;
}

export function seededRandom(seed){
  let state=mixSeed(seed);
  return ()=>{
    state^=state<<13;state^=state>>>17;state^=state<<5;
    return uint(state)/4294967296;
  };
}

export function suggestedRanges(base={}){
  const bounded=(value,min,max)=>Math.max(min,Math.min(max,Math.round(Number(value)||0)));
  return {
    baselinePeople:[0,bounded(Math.max(200,(base.baselinePeople??80)*3),0,10000)],
    inflowA:[0,bounded(Math.max(180,(base.inflowA??40)*3),0,10000)],
    inflowB:[0,bounded(Math.max(180,(base.inflowB??20)*3),0,10000)],
    mainToAlleyRate:[0,100],
    buildingReleaseRate:[0,100],
    storeEntryRate:[0,100],
    stallStopRate:[0,100]
  };
}

export function normalizeRanges(input={}){
  const ranges={};
  for(const variable of EXPLORE_VARIABLES){
    const pair=input[variable.key]??variable.limit;
    let low=Math.round(Number(pair[0])),high=Math.round(Number(pair[1]));
    if(!Number.isFinite(low)||!Number.isFinite(high))throw new Error(`${variable.label} 범위를 숫자로 입력하세요.`);
    if(low>high)[low,high]=[high,low];
    low=Math.max(variable.limit[0],low);high=Math.min(variable.limit[1],high);
    if(low>high)throw new Error(`${variable.label} 범위가 모형 지원값을 벗어났습니다.`);
    ranges[variable.key]=[low,high];
  }
  return ranges;
}

function shuffle(values,random){
  for(let index=values.length-1;index>0;index--){
    const other=Math.floor(random()*(index+1));
    [values[index],values[other]]=[values[other],values[index]];
  }
  return values;
}

// Latin-hypercube columns spread each input over its whole integer range. If
// there are more trials than integer values, values repeat but the random seed
// still makes every run an independent stochastic replication.
export function createExploreJobs({count,masterSeed,baseConfig,ranges}){
  const total=Math.max(1,Math.min(5000,Math.round(Number(count)||1)));
  const seed=mixSeed(masterSeed);
  const random=seededRandom(seed);
  const normalized=normalizeRanges(ranges);
  const columns={};
  for(const variable of EXPLORE_VARIABLES){
    const [low,high]=normalized[variable.key],span=high-low+1;
    columns[variable.key]=shuffle(Array.from({length:total},(_,index)=>{
      const fraction=(index+random())/total;
      return Math.min(high,low+Math.floor(fraction*span));
    }),random);
  }
  return Array.from({length:total},(_,index)=>{
    const config={...baseConfig};
    for(const variable of EXPLORE_VARIABLES)config[variable.key]=columns[variable.key][index];
    return {
      id:index+1,
      seed:mixSeed(seed^Math.imul(index+1,0x85ebca6b)),
      config,
      varied:Object.fromEntries(EXPLORE_VARIABLES.map(variable=>[variable.key,config[variable.key]]))
    };
  });
}

const quantile=(values,fraction)=>{
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b),position=(sorted.length-1)*fraction;
  const lower=Math.floor(position),upper=Math.ceil(position),weight=position-lower;
  return sorted[lower]*(1-weight)+sorted[upper]*weight;
};
const rounded=value=>Math.round(Number(value)*10)/10;

export function issueFlags(result,criteria){
  const capacity=Number(result.capacityExceedSeconds)>0&&Number(result.capacityExceedSeconds)>=Number(criteria.minExceedSeconds);
  const queue=Number(result.finalWaiting)>=Number(criteria.minEndingWaiting);
  const flow=Number(result.flowUsePercent)>=Number(criteria.minFlowUsePercent??Infinity);
  return {capacity,queue,flow,problem:capacity||queue||flow};
}

const queueLabel=result=>{
  const entries=[
    ['외부 출입구 대기',result.finalWaitingOutside],
    ['연결부 이동 정체',result.finalWaitingApproach],
    ['건물 유출 대기',result.finalWaitingStores],
    ['점포 입구 대기',result.finalWaitingStoreEntry]
  ].sort((a,b)=>Number(b[1])-Number(a[1]));
  return Number(entries[0][1])>0?entries[0][0]:'대기 위치 혼합';
};

const compactStats=values=>({
  min:rounded(Math.min(...values)),
  q25:rounded(quantile(values,.25)),
  median:rounded(quantile(values,.5)),
  q75:rounded(quantile(values,.75)),
  max:rounded(Math.max(...values))
});

export function summarizeExplore(results,criteria){
  const valid=results.filter(result=>!result.error);
  const problem=valid.filter(result=>issueFlags(result,criteria).problem);
  const normal=valid.filter(result=>!issueFlags(result,criteria).problem);
  const groups=new Map();
  for(const result of problem){
    const flags=issueFlags(result,criteria);
    const signal=[flags.flow?'통과 처리 비교값 초과':'',flags.capacity?'체류 기준 초과':'',flags.queue?queueLabel(result):''].filter(Boolean).join(' + ');
    const section=result.dominantSection?.name??'구간 미확인';
    const key=`${section}|${signal}`;
    if(!groups.has(key))groups.set(key,{section,signal,runs:[]});
    groups.get(key).runs.push(result);
  }
  const baselinePool=normal.length?normal:valid;
  const patterns=[...groups.values()].sort((a,b)=>b.runs.length-a.runs.length).slice(0,5).map((group,index)=>{
    const inputs=Object.fromEntries(EXPLORE_VARIABLES.map(variable=>[
      variable.key,compactStats(group.runs.map(run=>Number(run.varied[variable.key])))
    ]));
    const drivers=EXPLORE_VARIABLES.map(variable=>{
      const stat=inputs[variable.key],[low,high]=criteria.ranges[variable.key],span=Math.max(1,high-low);
      const comparison=quantile(baselinePool.map(run=>Number(run.varied[variable.key])),.5);
      const separation=Math.abs(stat.median-comparison)/span;
      const consistency=1-Math.min(1,(stat.q75-stat.q25)/span);
      return {...variable,...stat,score:separation+consistency*.2};
    }).sort((a,b)=>b.score-a.score).slice(0,4);
    const values=key=>group.runs.map(run=>Number(run[key])||0);
    return {
      rank:index+1,
      section:group.section,
      signal:group.signal,
      count:group.runs.length,
      shareOfProblems:problem.length?group.runs.length/problem.length*100:0,
      shareOfAll:valid.length?group.runs.length/valid.length*100:0,
      inputs,
      drivers,
      output:{
        flowUsePercent:compactStats(values('flowUsePercent')),
        peakInside:compactStats(values('peakInside')),
        finalWaiting:compactStats(values('finalWaiting')),
        peakWaiting:compactStats(values('peakWaiting')),
        capacityExceedSeconds:compactStats(values('capacityExceedSeconds')),
        entries:compactStats(values('studyEntries')),
        exits:compactStats(values('completed')),
        peakLocalDensity:compactStats(values('peakLocalDensity'))
      },
      exampleRunId:group.runs[0].id,
      exampleSeed:group.runs[0].seed
    };
  });
  return {
    total:valid.length,
    errors:results.length-valid.length,
    problemCount:problem.length,
    normalCount:normal.length,
    problemRate:valid.length?problem.length/valid.length*100:0,
    patterns
  };
}

export function patternReplay(batch,pattern){
  if(!batch?.results?.length||!pattern)return null;
  const result=batch.results.find(run=>pattern.exampleRunId!==undefined&&run.id===pattern.exampleRunId)
    ??batch.results.find(run=>Number(run.seed)===Number(pattern.exampleSeed));
  if(!result||result.error)return null;
  const durationMinutes=Math.max(0,Number(batch.durationMinutes)||0);
  const hasSavedSpace=Array.isArray(batch.excluded),hadNoEdits=Number(batch.excludedCount)===0;
  return {
    rank:pattern.rank,
    section:pattern.section,
    seed:Number(result.seed)>>>0,
    durationMinutes,
    config:{...batch.baseConfig,...result.varied,analysisMinutes:durationMinutes},
    excluded:hasSavedSpace?[...batch.excluded]:hadNoEdits?[]:null,
    spaceExact:hasSavedSpace||hadNoEdits,
    expected:result
  };
}

const csvValue=value=>`"${String(value??'').replaceAll('"','""')}"`;
export function exploreCSV(batch){
  const headers=['run','seed',...EXPLORE_VARIABLES.map(item=>item.key),'problem','problemSignals','dominantSection','studyDemandPerMinute','flowCapacityPerMinute','flowUsePercent','peakInside','referenceCapacity','capacityExceedSeconds','peakWaiting','finalWaiting','waitingOutside','waitingApproach','waitingStores','waitingStoreEntry','studyEntries','completed','averageTravelSeconds','peakLocalDensity'];
  const rows=batch.results.map(result=>{
    const flags=issueFlags(result,batch.criteria);
    return [result.id,result.seed,...EXPLORE_VARIABLES.map(item=>result.varied?.[item.key]),flags.problem,[flags.flow?'flow':'',flags.capacity?'capacity':'',flags.queue?'queue':''].filter(Boolean).join('+'),result.dominantSection?.name,result.studyDemandPerMinute,result.flowCapacityPerMinute,result.flowUsePercent,result.peakInside,result.referenceCapacity,result.capacityExceedSeconds,result.peakWaiting,result.finalWaiting,result.finalWaitingOutside,result.finalWaitingApproach,result.finalWaitingStores,result.finalWaitingStoreEntry,result.studyEntries,result.completed,result.averageTravelSeconds,result.peakLocalDensity];
  });
  return '\ufeff'+[headers,...rows].map(row=>row.map(csvValue).join(',')).join('\n');
}
