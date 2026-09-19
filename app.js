import {WalkSimulation,validateConfig,LIMITS,NORTH_SIDEWALK_WIDTH_M} from './network-simulation.js';
import {StreetRenderer} from './network-renderer.js';
import {organizeWorkspace} from './presentation.js';
import {ExperimentLog} from './experiment-log.js';
import {experimentUI} from './experiment-ui.js';
import {autoExploreUI} from './auto-explore-ui.js';

organizeWorkspace();

const $=id=>document.getElementById(id);
const fields={
  baselinePeople:'baseline-people',
  baselineFillRate:'baseline-fill-rate',
  inflowA:'inflow-a',
  inflowB:'inflow-b',
  mainToAlleyRate:'main-to-alley-rate',
  entryGateMask:'entry-gate-mask',
  exitGateMask:'exit-gate-mask',
  entryAvoidanceRate:'entry-avoidance-rate',
  rightHandRate:'right-hand-rate',
  peoplePer100M2:'people-per-100m2',
  buildingReleaseRate:'building-release-rate',
  storeEntryRate:'store-entry-rate',
  storeDwellSeconds:'store-dwell-seconds',
  storeUsableRate:'store-usable-rate',
  storeCapacityDensity:'store-capacity-density',
  stallDepth:'stall-depth',
  stallStopRate:'stall-stop-rate',
  stallDwellSeconds:'stall-dwell-seconds',
  capacityDensity:'density',
  analysisMinutes:'analysis-minutes',
  setback:'setback',
  walkSpeed:'walk-speed'
};
// Range controls are convenience handles, not scientific limits.
for(const [key,id] of Object.entries(fields)){
 const control=$(id);if(control.type==='hidden')continue;
 if(['baselinePeople','baselineFillRate','inflowA','inflowB'].includes(key)){
  control.type='number';control.min=LIMITS[key][0];control.max=LIMITS[key][1];control.step=key==='baselinePeople'?'1':'any';control.classList.add('direct-value');
  control.title='최대 10,000은 계산 보호 범위이며 실제 수용한도가 아닙니다.';continue;
 }
 const direct=document.createElement('input');direct.type='number';direct.className='direct-value';
 direct.min=LIMITS[key][0];direct.max=LIMITS[key][1];direct.step=['baselinePeople','analysisMinutes'].includes(key)?'1':'any';direct.value=control.value;
 const label=document.querySelector(`label[for="${id}"]`)?.textContent??control.closest('fieldset,section')?.querySelector('legend,h3')?.textContent??key;
 direct.setAttribute('aria-label',`${label} 직접 입력`);direct.dataset.configKey=key;
 direct.title=`직접 입력 ${direct.min}~${direct.max}. 백분율 외 상한은 계산 지원 범위이며 안전기준이 아닙니다.`;
 control.insertAdjacentElement('afterend',direct);
 direct.addEventListener('change',()=>{
  if(!direct.checkValidity()||direct.value===''){direct.reportValidity();direct.value=control.value;return;}
  const value=Number(direct.value);
  if(control.tagName==='SELECT'&&![...control.options].some(option=>Number(option.value)===value))control.add(new Option(`${value}분`,String(value)));
  if(control.type==='range'){control.min=Math.min(Number(control.min),value);control.max=Math.max(Number(control.max),value);control.step='any';}
  control.value=value;control.dispatchEvent(new Event('input'));
 });
 control.addEventListener('input',()=>{direct.value=control.value;});
}
let excluded=new Set(),editMode=null,wasRunning=false,solutionBaseline=null,solutionBaselineStats=null;
const appliedSolutions=new Set();
let sim,scene,renderer,running=false,lastTime=0,accumulator=0,uiElapsed=0,raf=0,restartTimer;
let logStorage;try{logStorage=window.localStorage;}catch{logStorage={getItem:()=>null,setItem:()=>{throw Error('Storage unavailable');}};}
const experiments=new ExperimentLog(logStorage);
const experimentView=experimentUI(experiments,()=>{if(sim)experiments.sample(sim,true);},()=>setRunning(false));
let lastLogSave=0;
const number=(x,digits=0)=>Number(x).toLocaleString('ko-KR',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const values=()=>Object.fromEntries(Object.entries(fields).map(([k,id])=>[k,Number($(id).value)]));
const autoExplorer=autoExploreUI({
  getCurrentConfig:values,
  getSetup:()=>({scene,baseConfig:values(),excluded:[...excluded]}),
  onStart:()=>setRunning(false),
  onReplay:replayPattern,
  storage:logStorage
});
experimentView.attachExplore(autoExplorer.panel);
function updateOutputs(){
  for(const direct of document.querySelectorAll("[data-config-key]"))direct.value=$(fields[direct.dataset.configKey]).value;
  const baseline=Number($('baseline-people').value),inflowA=Number($('inflow-a').value),inflowB=Number($('inflow-b').value);
  const footprintArea=scene?.storefrontSummary?.matchedBuildingFootprintAreaM2??1649.9;
  const per100=Number($('people-per-100m2').value);
  const release=Number($('building-release-rate').value),buildingPopulation=footprintArea*per100/100,buildingPerMinute=buildingPopulation*release/100/10;
  const external=inflowA+inflowB,totalDemand=external+buildingPerMinute;
  const alleyPerMinute=inflowA*Number($('main-to-alley-rate').value)/100;
  const avoidedPerMinute=alleyPerMinute*Number($('entry-avoidance-rate').value)/100;
  $('baseline-people-value').textContent=`${$('baseline-people').value}명`;
  $('inflow-a-value').textContent=`${inflowA}명/분`;$('inflow-b-value').textContent=`${inflowB}명/분`;
  $('external-demand-total').textContent=`${external}명/분`;
  $('people-per-100m2-value').textContent=`${per100}명`;
  $('building-release-rate-value').textContent=`${release}% · 약 ${number(buildingPerMinute,1)}명/분`;
  $('building-population').textContent=`${number(buildingPopulation)}명`;
  $('store-entry-rate-value').textContent=`${$('store-entry-rate').value}% · 약 ${number(totalDemand*Number($('store-entry-rate').value)/100,1)}명/분`;
  $('store-dwell-seconds-value').textContent=`${$('store-dwell-seconds').value}초`;
  $('store-usable-rate-value').textContent=`${$('store-usable-rate').value}%`;
  $('store-capacity-density-value').textContent=`${Number($('store-capacity-density').value).toFixed(1)}명/㎡`;
  $('stall-depth-value').textContent=`양쪽 ${Number($('stall-depth').value).toFixed(1)}m`;
  $('stall-stop-rate-value').textContent=`${$('stall-stop-rate').value}% · 약 ${number(totalDemand*Number($('stall-stop-rate').value)/100,1)}명/분`;
  $('stall-dwell-seconds-value').textContent=`${$('stall-dwell-seconds').value}초`;
  $('main-to-alley-rate-value').textContent=`${$('main-to-alley-rate').value}% · 약 ${number(alleyPerMinute,1)}명/분`;
  $('entry-avoidance-rate-value').textContent=`${$('entry-avoidance-rate').value}% · 최대 약 ${number(avoidedPerMinute,1)}명/분`;
  $('right-hand-rate-value').textContent=`${$('right-hand-rate').value}% · 현재 ${number(sim?.stats().rightHandAgents??baseline*Number($('right-hand-rate').value)/100)}명`;
  $('analysis-minutes-value').textContent=Number($('analysis-minutes').value)?`${$('analysis-minutes').value}분`:'제한 없음';
  $('setback-value').textContent=`양쪽 각각 ${Number($('setback').value).toFixed(1)} m`;
  $('walk-speed-value').textContent=`${Number($('walk-speed').value).toFixed(1)} m/s`;
  const density=Number($('density').value);
  $('density-value').textContent=`${density.toFixed(1)} 명/㎡`;$('density-inline').textContent=density.toFixed(1);
  $('scenario-current').textContent=`기준 ${baseline}명 + 추가 약 ${number(totalDemand,1)}명/분`;
  if(sim){
    const reference=Math.floor(sim.area*density),main=sim.capacitySections[0];
    $('reference-people').textContent=number(reference);$('reference-capacity-main').textContent=`${number(reference)}명`;
    $('analysis-length').textContent=`약 ${number(sim.studyLengthM)}m`;$('effective-area-main').textContent=`${number(sim.area)}㎡`;
    $('minimum-width-main').textContent=`${number(main.minimumEffectiveWidthM,1)}m`;$('flow-capacity-main').textContent=`${number(main.flowCapacityPerMinute)}명/분`;
    $('effective-area').textContent=`약 ${number(sim.area,1)}`;$('min-width').textContent=`${number(main.minimumEffectiveWidthM,1)} m`;$('store-capacity-total').textContent=`${number(sim.totalStoreCapacity)}명`;
  }
}
function updateResponseGuide(st){
  const waiting=st.waitingApproach+st.waitingOutside+st.waitingStores+st.waitingStoreEntry;
  const extraPerMinute=sim.config.inflowA+sim.config.inflowB+st.buildingDemandPerMinute;
  const main=st.capacitySections[0],flowUse=main.flowCapacityPerMinute?st.studyDemandPerMinute/main.flowCapacityPerMinute*100:0;
  $('guide-basis').textContent=`${$('clock').textContent} · 체류 ${number(st.peakInside)}/${number(st.referenceCapacity)}명 · 수요/처리 ${number(st.studyDemandPerMinute,1)}/${number(main.flowCapacityPerMinute)}명/분 · 대기 최대 ${number(st.peakWaiting)}명`;
  $('result-demand').textContent=`약 ${number(extraPerMinute,1)}명/분`;
  $('result-requested').textContent=`${number(st.extraRequested+st.buildingRequested)}명`;
  $('result-entered').textContent=`${number(st.studyEntries)}명`;
  $('result-exited').textContent=`${number(st.completed)}명`;
  $('result-peak-wait').textContent=`${number(st.peakWaiting)}명`;
  $('result-stops').textContent=`${number(st.stallStops)}명`;
  $('result-store-entries').textContent=`${number(st.storeEntries)}명`;
  $('result-store-full').textContent=`${number(st.storeFullEncounters)}회`;
  let signal,reason,action;
  if(flowUse>100){
    signal=`설정 접근 수요가 통과 처리 비교값의 ${number(flowUse)}%예요`;
    reason=`완구거리 대표 최소 유효폭 ${number(main.minimumEffectiveWidthM,1)}m에 30명/분/m를 적용한 처리 비교값은 ${number(main.flowCapacityPerMinute)}명/분이고, 현재 접근 수요는 약 ${number(st.studyDemandPerMinute,1)}명/분입니다. 대기가 계속 늘어나는지도 함께 확인하세요.`;
    action='추가 유입을 낮추거나 공간 확보를 적용해 수요/처리 비율과 대기 변화 비교';
  }else if(st.capacityUsePercent>100){
    signal=`선택한 수용 기준을 최대 ${number(st.capacityUsePercent)}% 사용했어요`;
    reason=`매대 ${number(st.stallAreaM2,1)}㎡를 제외한 유효면적 ${number(st.modelAreaM2,1)}㎡에서 최대 ${number(st.peakInside)}명이 머물러, 비교 기준 ${number(st.referenceCapacity)}명을 넘은 시간이 ${number(st.capacityExceedSeconds/60,1)}분입니다.`;
    action='추가 유입이나 사용 가능한 공간을 바꿔 대기 변화 비교';
  }else if(st.waitingStoreEntry>0){
    signal=`매장 수용인원을 넘어 입구에서 ${number(st.waitingStoreEntry)}명이 기다려요`;
    reason=`모형 매장 수용 합계 ${number(st.totalStoreCapacity)}명 중 현재 ${number(st.currentStoreVisitors)}명이 체류 중이며, 만석을 만난 횟수는 ${number(st.storeFullEncounters)}회입니다.`;
    action='영업공간 비율·실내 밀도·매장 체류시간을 바꿔 입구 대기 비교';
  }else if(st.waitingOutside>0||st.waitingStores>0){
    signal=`외부 ${number(st.waitingOutside)}명·건물 ${number(st.waitingStores)}명이 진입을 기다려요`;
    reason=`외부 출입구 대기 ${number(st.waitingOutside)}명, 건물 안 유출 대기 ${number(st.waitingStores)}명입니다. 설정 수요가 현재 공간의 처리 흐름보다 빠른지 확인할 수 있어요.`;
    action='대로 보행자 중 골목 진입률과 분당 유입량 낮추기';
  }else if(st.waitingApproach>0){
    signal=`인도·연결길 안에서 ${number(st.waitingApproach)}명이 멈춰 있어요`;
    reason=`분석구간 바깥의 연결부에서 1초 이상 움직이지 못한 현재 인원입니다. ${excluded.size?'직접 제외한 공간과 ':''}마주 오는 흐름이 통행폭을 나눠 쓰는지 먼저 확인할 수 있어요.`;
    action='A·C·D의 진입·퇴장 허용을 직접 바꿔 맞부딪힘과 대기 비교';
  }else if(st.entryAvoided>0){
    signal=`입구의 사람을 보고 진입하지 않은 경우가 누적 ${number(st.entryAvoided)}명이에요`;
    reason='이 수치는 실제 관측이 아니라 설정한 8m 시야와 포기 확률의 결과입니다. 입구 대기줄이 이동선을 가리는 상황을 가정해 비교할 수 있어요.';
    action='진입 포기 확률과 골목 진입 비율을 함께 비교';
  }else if(st.elapsedSeconds<20){
    signal=`기준 ${number(st.baselineTarget)}명에 추가 약 ${number(extraPerMinute,1)}명/분을 넣고 있어요`;
    reason='대로·연결길 유입, 건물 유출, 매대 구경 체류를 합친 혼잡일 조건입니다. 실행하면서 최대 인원과 대기 누적이 평상시보다 얼마나 늘어나는지 계산합니다.';
    action='먼저 현재 혼잡일 가정을 실행한 뒤 평상시와 같은 시간으로 비교';
  }else{
    signal='현재 입력에서는 뚜렷한 대기 신호가 없어요';
    reason=`현재 전체 대기는 ${number(waiting)}명이고, 최근 1분 구간 이탈은 ${number(st.passedLastMinute)}명입니다. 이 결과도 유효하지만 더 높은 수요·건물 유출·매대 체류 조건에서 대기 시작점을 확인해야 해요.`;
    action='추가 유입·건물 유출·매대 체류를 한 단계씩 올려 대기 시작점 찾기';
  }
  $('guide-signal').textContent=signal;$('guide-reason').textContent=reason;$('guide-action').textContent=action;
}
function updateMetrics(){
  if(!sim)return;const st=sim.stats();
  const segments=[...st.capacitySections,...st.connectorCapacitySections],main=st.capacitySections[0];
  const flowUse=main.flowCapacityPerMinute?st.studyDemandPerMinute/main.flowCapacityPerMinute*100:0;
  $('inside').innerHTML=`${number(st.inside)}<small>명</small>`;
  $('peak-inside').innerHTML=`${number(st.peakInside)}<small>명</small>`;
  $('waiting').innerHTML=`${number(st.waitingApproach+st.waitingOutside+st.waitingStores+st.waitingStoreEntry)}<small>명</small>`;
  $('stall-viewers').innerHTML=`${number(st.currentStallViewers)}<small>명</small>`;
  $('store-visitors').innerHTML=`${number(st.currentStoreVisitors)}<small>명</small>`;
  $('store-waiting').innerHTML=`${number(st.waitingStoreEntry)}<small>명</small>`;
  $('flow').innerHTML=`${number(st.passedLastMinute)}<small>명</small>`;
  $('travel').innerHTML=`${st.averageTravelSeconds===null?'—':number(st.averageTravelSeconds)}<small>초</small>`;
  $('capacity-use').textContent=`${number(st.capacityUsePercent)}%`;
  $('flow-use').textContent=`${number(st.studyDemandPerMinute,1)} / ${number(main.flowCapacityPerMinute)}명/분 · ${number(flowUse)}%`;
  $('peak-local-density').textContent=`${number(st.peakLocalDensity,2)}명/㎡`;
  $('study-entered').textContent=`${number(st.studyEntries)}명`;
  $('study-exited').textContent=`${number(st.completed)}명`;
  $('over-time').textContent=st.capacityExceedSeconds?`${number(st.capacityExceedSeconds/60,1)}분`:'0분';
  const minutes=Math.floor(st.elapsedSeconds/60),seconds=Math.floor(st.elapsedSeconds%60);
  $('clock').textContent=`${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  const over=st.capacityUsePercent>100||flowUse>100,near=false;
  const verdict=st.elapsedSeconds===0?'재생해서 대기가 쌓이는지 확인하세요':over?'선택한 비교 기준을 넘는 조건입니다':near?'선택한 비교 기준에 가까운 조건입니다':'현재 조건은 선택한 두 비교 기준 이내입니다';
  $('capacity-verdict').className=`capacity-verdict ${over?'over':near?'near':'within'}`;
  $('capacity-verdict').innerHTML=`<strong>${verdict}</strong><span>${st.elapsedSeconds===0?'아직 실행 전입니다.':`실행 ${number(st.elapsedSeconds/60,1)}분 · 누적 최대 인원과 현재 설정 수요를 비교합니다.`}</span>`;
  const currentWaiting=st.waitingApproach+st.waitingOutside+st.waitingStores+st.waitingStoreEntry;
  $('headline-occupancy').textContent=`${number(st.inside)} / ${number(st.referenceCapacity)}명`;
  $('headline-occupancy-note').textContent=`현재 / 기준 · 이번 실행 최대 ${number(st.peakInside)}명`;
  $('headline-demand').textContent=`${number(st.studyDemandPerMinute,1)} / ${number(main.flowCapacityPerMinute)}`;
  $('headline-wait').textContent=`${number(currentWaiting)}명`;
  $('headline-wait-note').textContent=`이번 실행 최대 ${number(st.peakWaiting)}명 · 전체 모형 범위`;
  $('next-experiment-text').textContent=over?'다음 시험: 유입량이나 사용 공간을 바꿔 대기가 줄어드는지 비교하세요.':currentWaiting>0?'기준 이내여도 대기가 있습니다. 지도에서 위치를 보고 출입 방향을 직접 지정해 보세요.':'다음 시험: 추가 유입을 늘려 대기가 쌓이기 시작하는 조건을 찾아보세요.';
  const reached=st.inside>=st.referenceCapacity,remaining=Math.max(0,st.referenceCapacity-st.inside);
  $('impact-state').textContent=reached?'동시 체류 비교 기준 도달·초과':`동시 체류 비교 기준까지 ${number(remaining)}명`;
  $('impact-title').textContent=reached?'기준선을 넘은 뒤 이동 결과를 확인하세요':`${number(st.referenceCapacity)}명은 즉시 사고가 발생하는 숫자가 아닙니다`;
  $('impact-explanation').textContent=reached?`현재 ${number(st.inside)}명입니다. 사람을 튕겨내지 않고 이동을 계속 계산하며, 대기 증가·체류시간 증가·이탈 처리량 감소가 함께 나타나는지 평가합니다.`:`현재 ${number(st.inside)}명입니다. 기준에 가까워질 때 대기와 체류시간이 늘고 이탈 처리량이 낮아지는지가 실제 수용 가능 여부를 판단하는 핵심입니다.`;
  $('capacity-impact').classList.toggle('over',reached);
  $('impact-occupancy').textContent=`${number(st.inside)}/${number(st.referenceCapacity)}명`;$('impact-waiting').textContent=`${number(currentWaiting)}명`;
  $('impact-throughput').textContent=`${number(st.passedLastMinute)}명`;$('impact-travel').textContent=st.averageTravelSeconds===null?'—':`${number(st.averageTravelSeconds)}초`;
  updateSolutionComparison(st);
  $('segment-results-body').innerHTML=segments.map(section=>`<tr><td><b>${section.name}</b></td><td>${number(section.lengthM,1)}m</td><td>${number(section.areaM2,1)}㎡</td><td>${number(section.averageEffectiveWidthM,1)}m</td><td>${number(section.minimumEffectiveWidthM,1)}m</td><td>${number(section.currentOccupancy)}/${number(section.occupancyCapacity)}명</td><td>${number(section.flowCapacityPerMinute)}명/분</td></tr>`).join('');
  $('status-note').textContent=`추가 요청 ${number(st.extraRequested)}명 + 초기 건물 유출 ${number(st.buildingRequested)}명(남은 예정 ${number(st.buildingReleasePoolRemaining)}명) · 구간 진입 ${number(st.studyEntries)}명 · 이탈 ${number(st.completed)}명 · 매장 진입 ${number(st.storeEntries)}명(현재 ${number(st.currentStoreVisitors)}명 / 모형 수용 ${number(st.totalStoreCapacity)}명) · 입구 대기 ${number(st.waitingStoreEntry)}명. 현재 값은 시나리오 계산이며 실측 보정 전입니다.`;
  for(const store of st.storeStatus){const item=document.querySelector(`[data-store-status="${store.id}"]`);if(item)item.textContent=`${store.occupancy}/${store.capacity}명 · 대기 ${store.waiting} · 추정 ${number(store.usableAreaM2,1)}㎡`;}
  const activeStores=st.storeStatus.filter(store=>store.occupancy||store.waiting).sort((a,b)=>(b.waiting-a.waiting)||((b.occupancy/b.capacity)-(a.occupancy/a.capacity))||(b.occupancy-a.occupancy)).slice(0,3);
  $('store-hotspots').innerHTML=activeStores.length?activeStores.map(store=>`<span><b>${store.id}</b> ${store.occupancy}/${store.capacity}명${store.waiting?` · 대기 ${store.waiting}`:''}</span>`).join(''):'아직 매장 방문 없음';
  updateResponseGuide(st);
}
function setRunning(value){running=Boolean(value);if(running&&experiments.active)experiments.active.status='recording';if(!running&&sim){experiments.sample(sim,true);experiments.save();experimentView.render();}const started=Boolean(sim&&sim.time>0);$('play').textContent=running?'Ⅱ 일시정지':started?'▶ 계속 실행':'시뮬레이션 시작';$('play').setAttribute('aria-pressed',String(running));}
function reset(){
  if(!scene)return;if(sim)experiments.finish(sim,'restarted');sim=new WalkSimulation(scene,values(),excluded);experiments.begin(sim);experimentView.newRun();renderer.updateGeometry(sim);accumulator=0;
  $('run-hint').textContent='현재 조건으로 새로 비교하려면 ‘처음부터’를 누르세요.';
  updateOutputs();updateMetrics();renderer.draw(sim,.05);
}
function replayPattern(replay){
  if(!scene)throw new Error('공간자료를 아직 불러오는 중입니다.');
  clearTimeout(restartTimer);setRunning(false);
  document.querySelectorAll('[data-preset]').forEach(item=>item.classList.remove('active'));
  clearSolutionExperiment('자동 탐색의 대표 실행을 0분부터 재생 중');
  for(const [key,value]of Object.entries(replay.config)){
    const control=$(fields[key]);if(!control||!Number.isFinite(Number(value)))continue;
    if(control.tagName==='SELECT'&&![...control.options].some(option=>Number(option.value)===Number(value)))control.add(new Option(`${value}분`,String(value)));
    if(control.type==='range'){control.min=Math.min(Number(control.min),Number(value));control.max=Math.max(Number(control.max),Number(value));}
    control.value=value;
  }
  for(const direction of ['entry','exit']){
    const mask=Number($(`${direction}-gate-mask`).value);
    document.querySelectorAll(`[data-${direction}-gate]`).forEach((button,index)=>button.setAttribute('aria-pressed',String(Boolean(mask&(1<<index)))));
  }
  if(Array.isArray(replay.excluded))excluded=new Set(replay.excluded);
  renderer.excluded=excluded;renderer.dirty=true;
  if(sim)experiments.finish(sim,'restarted');
  sim=new WalkSimulation(scene,values(),excluded,{seed:replay.seed,demandSeed:replay.seed,behaviourSeed:(replay.seed^0x5f3759df)>>>0});
  experiments.begin(sim);experimentView.newRun();renderer.updateGeometry(sim);accumulator=0;
  updateOutputs();updateMetrics();renderer.draw(sim,.05);
  experimentView.showView('settings');setScenarioOpen(true);
  $('run-hint').textContent=`자동 탐색 패턴 ${replay.rank} · ${replay.section} · 시드 ${number(replay.seed)} · ${number(replay.durationMinutes)}분 실행${replay.spaceExact?'':' · 현재 제외 공간 사용'}`;
  setRunning(true);
}
function reconfigure(){
  if(!scene)return;
  if(!sim){reset();return;}
  try{
    experiments.sample(sim,true);
    sim=WalkSimulation.reconfiguredFrom(sim,values(),excluded);
    experiments.change(sim);experimentView.render();
    renderer.updateGeometry(sim,true);accumulator=Math.min(accumulator,.099);
    updateOutputs();updateMetrics();renderer.draw(sim,0);
  }catch(error){
    excluded=new Set(sim.excluded);renderer.excluded=excluded;renderer.dirty=true;
    for(const [key,id]of Object.entries(fields))$(id).value=sim.config[key];
    updateOutputs();$('status-note').textContent=error.message;
  }
}
function updateSolutionUI(message=''){
  for(const key of ['space','inflow'])$(`solution-${key}`).setAttribute('aria-pressed',String(appliedSolutions.has(key)));
  $('solution-restore').disabled=!solutionBaseline;
  $('solution-status').textContent=message||'버튼을 누르면 현재 사람과 시간을 유지한 채 바로 적용됩니다.';
}
function updateSolutionComparison(current=sim?.stats()){
  const box=$('solution-comparison');
  if(!solutionBaselineStats||!current){box.hidden=true;box.innerHTML='';return;}
  const before=solutionBaselineStats,after=current,beforeMain=before.capacitySections[0],afterMain=after.capacitySections[0];
  const beforeWait=before.waitingApproach+before.waitingOutside+before.waitingStores+before.waitingStoreEntry;
  const afterWait=after.waitingApproach+after.waitingOutside+after.waitingStores+after.waitingStoreEntry;
  box.hidden=false;box.innerHTML=`<b>해결 적용 전 → 현재</b><span>유효면적 ${number(before.modelAreaM2,1)} → ${number(after.modelAreaM2,1)}㎡</span><span>최소폭 ${number(beforeMain.minimumEffectiveWidthM,1)} → ${number(afterMain.minimumEffectiveWidthM,1)}m</span><span>처리값 ${number(beforeMain.flowCapacityPerMinute)} → ${number(afterMain.flowCapacityPerMinute)}명/분</span><span>접근수요 ${number(before.studyDemandPerMinute,1)} → ${number(after.studyDemandPerMinute,1)}명/분</span><span>현재대기 ${number(beforeWait)} → ${number(afterWait)}명</span>`;
}
function applySolution(key){
  document.dispatchEvent(new Event('show-scenario-settings'));
  const target=$(key==='space'?'stall-depth':'inflow-a');
  for(let parent=target.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  setScenarioOpen(true);target.scrollIntoView({block:'center',behavior:'smooth'});target.focus();
  updateSolutionUI('원하는 수치를 직접 입력하세요. 조건은 자동 변경하지 않습니다.');
}
function clearSolutionExperiment(message='직접 바꾼 조건으로 계속 실행 중'){
  solutionBaseline=null;solutionBaselineStats=null;appliedSolutions.clear();updateSolutionUI(message);updateSolutionComparison();
}
function animate(now){
  const wallDt=lastTime?Math.min(.15,(now-lastTime)/1000):0;lastTime=now;
  let modelDt=0;
  if(sim&&running&&!document.hidden){
    const scale=Number($('speed').value);modelDt=wallDt*scale;accumulator+=modelDt;
    let steps=0;
    const limit=sim.config.analysisMinutes*60;
    while(accumulator>=.1&&steps<60){sim.update(.1);experiments.sample(sim);accumulator-=.1;steps++;if(limit&&sim.time>=limit){setRunning(false);experiments.complete(sim);experimentView.render();break;}}
  }
  if(sim){
    renderer.draw(sim,running?Math.max(wallDt,modelDt):0);
    uiElapsed+=wallDt;if(uiElapsed>.2){updateMetrics();uiElapsed=0;}
    const limit=sim.config.analysisMinutes*60;
    if(limit&&sim.time>=limit)$('status-note').textContent=`설정한 ${sim.config.analysisMinutes}분 분석이 끝났어요. 결과표를 확인하거나 ‘처음부터’로 같은 조건을 다시 실행하세요.`;
  }
  if(sim&&now-lastLogSave>5000){experiments.save();experimentView.render();lastLogSave=now;}
  raf=requestAnimationFrame(animate);
}
function explanation(){
  $('info-content').innerHTML=`
    <h3>색칠한 범위와 실제 도형</h3>
    <p>기존 완구거리 A–B에 종로 쪽 인도, 가운데 연결길, 오른쪽 연결길, 동쪽·남쪽 연장부를 연결했어요. 골목 도형 14개와 종로 도로 도형 10개, 주변 건물 외곽선 ${scene.buildings.length}개를 원본에서 추출했습니다.</p>
    <p>원본: changsin_2grids_spatial_base.gpkg. 도로 출처는 ${scene.source.roadSourceFile}, 건물 출처는 ${scene.source.buildingSourceFile}입니다. 좌표계는 EPSG:5179이며 원본 DBF 속성은 없는 자료입니다. 사용자 표시를 도로 연결 구조에 맞춘 작업 범위예요.</p>
    <h3>북쪽 인도는 ${NORTH_SIDEWALK_WIDTH_M.toFixed(1)}m로 고정했어요</h3>
    <p>첨부한 2026년 4월 로드뷰에서 확인한 북쪽 인도와 공간자료의 도로경계 범위를 연결해 ${NORTH_SIDEWALK_WIDTH_M.toFixed(1)}m 보행면으로 고정했습니다. 이제 시나리오에서 인도 폭 자체는 바꿀 수 없고, 가판대·표지판·적치물처럼 실제로 차지한 부분만 지도에서 직접 제외합니다. 독립 보도 경계 측량자료가 아니므로 최종 제출 전 현장 실측값과 대조해야 합니다.</p>
    <h3>모든 끝과 합류부를 열린 길로 연결했어요</h3>
    <p>실행 시작 때 ‘기준 인원 설정’만큼 완구거리 안에 배치합니다. 혼잡일에는 이 평상시 인원 위에 W·E·R·S 외부 유입과 초기 건물 유출을 추가합니다. 건물 유출은 설정한 내부 시나리오 인원 중 선택한 비율만 첫 10분 동안 나누어 나오며, 같은 인원을 이후에도 무한 반복 생성하지 않습니다. 이후 매장 방문객은 각자의 체류가 끝나면 별도로 거리로 나옵니다.</p>
    <h3>점포 26곳과 진입부 건물 출입 1곳을 연결했어요</h3>
    <p>공개지도에 등록된 A–B 구간의 문구·완구점 26곳을 원본 건물 외곽과 결합했습니다. 두 번째 표시 이미지의 진입부 B0178은 건물 전면이 도로에서 0.12m인데 공개지도 상호 점포점이 없어, ‘상호 미확인 건물 출입’ 1곳으로 별도 추가했습니다. 총 27개 접근점과 21개 건물이 연결됩니다. 매대는 연결점 앞 2.2m와 모든 교차로를 비웁니다.</p>
    <p>지나는 사람은 설정한 비율로 27개 접근점 중 하나를 목적지로 고릅니다. 점포 선택은 남은 수용인원이 많은 곳에 더 높은 확률을 주며, 입구 앞 1.1m 안에 도착하면 건물 내부의 여러 위치를 옮겨 다닙니다. 체류시간이 끝나면 내부에서 입구까지 이동하고, 입구 칸이 비었을 때 다시 거리로 나옵니다. 만석이면 여유 있는 다른 점포를 고르고 모든 점포가 차면 입구에서 기다립니다.</p>
    <p>연결 건물 외곽면적 합계는 ${number(scene.storefrontSummary.matchedBuildingFootprintAreaM2,1)}㎡입니다. 실제 점포 전용면적이 없으므로 같은 건물에 연결된 점포 수로 외곽면적을 균등 배분하고, ‘추정 영업공간 비율 × 실내 밀도’로 모형 수용인원을 계산합니다. 층수·창고·벽·실측 문 위치를 반영한 공식 수용인원이 아니라 비교용 가정입니다.</p>
    <h3>대로에서 골목을 선택하고, 입구에서 다시 판단해요</h3>
    <p>종로 W·E에서 들어오는 사람 중 ‘대로 보행자 중 골목 진입’ 비율만 사용자가 ‘진입 허용’으로 고른 A·C·D 중 한 곳과 R·S 중 한 출구를 선택합니다. R·S에서 종로 쪽으로 가는 사람은 사용자가 ‘퇴장 허용’으로 고른 연결부를 이용합니다. 같은 연결부를 양쪽에 고르면 양방향이고, 한쪽에만 고르면 진입 전용 또는 퇴장 전용입니다. 물리적으로 길을 막지는 않습니다. 이미 걷고 있는 사람은 현재 경로를 마치고, 변경 뒤 새로 들어오는 사람부터 선택이 반영됩니다.</p>
    <p>C를 고른 사람은 C–M 가운데 연결길을, D를 고른 사람은 D–J 오른쪽 연결길을 실제 경유합니다. 골목으로 가려던 사람이 입구 안쪽 8m에서 한 명 이상을 보면 ‘입구에 사람이 보일 때 진입 안 함’ 확률로 계획을 바꾸고 종로 반대편으로 계속 이동합니다.</p>
    <p>이 진입 비율, 8m 가시 범위와 포기 확률은 관측값이 아니라 비교용 조건입니다. ‘대로에서 골목 실제 진입’과 ‘사람을 보고 진입 안 함’에 누적 결과를 따로 표시합니다.</p>
    <h3>자유 이동과 우측통행을 섞을 수 있어요</h3>
    <p>우측통행 0%에서는 오른쪽 가중치를 완전히 끄고, 사람마다 바뀌는 작은 좌우 선택값으로 빈 공간을 자유롭게 이용합니다. 비율을 높이면 해당 비율의 사람만 자신의 진행 방향을 기준으로 오른쪽 빈 칸을 더 선호합니다. 100%도 오른쪽 이동을 강제하는 벽이나 전용 차선은 아닙니다.</p>
    <h3>서로 부딪혀 튕기지 않도록 바꿨어요</h3>
    <p>보행 공간은 약 0.55m 칸으로 계산하지만, 앞사람이 있으면 먼저 감속·정지하고 옆의 진행 가능한 칸을 찾습니다. 단순히 1.2초 막혔다는 이유로 뒤로 튕기던 규칙은 제거했습니다. 5초 이상 길이 막힌 경우에만 한 번 양보 이동을 하고, 같은 방향으로 연속 후퇴하지 않도록 4초 동안 다시 후퇴하지 않습니다. 서로 마주치면 반발하는 공이 아니라 감속·대기·짧은 측면 회피 순서로 처리합니다.</p>
    <p>지도에 보이던 0.55m 격자 줄무늬와 출입구 배지는 실제 벽이 아니어서 화면에서 제거했습니다. 도로는 평평한 한 면으로 표시하고, 보행자 점은 칸 사이를 일정한 속도로 이어서 그립니다. 확대 후 드래그로 지도를 이동할 수 있어요.</p>
    <p>인도 가장자리에서 몸의 중심을 0.22m 띄우며, 골목 가장자리 제외 폭에는 최소 0.22m를 적용합니다. 0.55m 격자로 공간을 근사하기 때문에 아주 좁은 통로의 연결과 통과량은 격자 해상도의 영향을 받습니다. 실행 평균 인원은 매 0.1초 완구거리 안 인원을 시간가중 평균한 값입니다.</p>
    <h3>체류와 통과를 분리해 계산해요</h3><p>완구거리 A–J, 가운데 연결길 C–M, 오른쪽 연결길 D–J를 각각 평가합니다. 임의로 같은 길이의 5조각으로 나누던 방식은 없앴습니다. 각 길의 길이와 유효면적은 0.55m 보행격자에서 계산하고, 2m 간격 단면 폭 중 하위 10%를 ‘대표 최소 유효폭’으로 사용해 한 칸짜리 도형 오차가 병목값을 결정하지 않게 했습니다.</p><p>동시 체류 기준은 유효면적 × 선택 밀도입니다. 통과 처리 비교값은 대표 최소 유효폭 × 30명/분/m입니다. 30명/분/m는 국내 도로용량편람의 보행 서비스수준 E 경계를 인용한 연구값을 비교선으로 쓴 것이며, 법정 안전 한도나 현장 보증값이 아닙니다. 실제 적용에는 첨두 15분 현장 통행량과 실측 유효폭으로 보정해야 합니다.</p><p>지도 색면과 글자는 표시일 뿐 보행 칸, 충돌, 이동 경로에는 영향을 주지 않습니다. 기준 목표 인원과 혼잡일 추가 수요를 분리하고, 누적 요청·진입·이탈·최대 대기·최대 구간 인원·기준 초과 시간을 함께 계산합니다.</p><p>국지 밀도는 거리 안 각 보행자 주변 반경 2m에서 실제로 열려 있는 보행 칸의 면적과 그 안의 사람 수를 1초마다 비교한 모형값입니다. 지도에는 현재 가장 높은 한 지점만 표시합니다. 현장 계측값이나 법정 혼잡 판정 기준은 아닙니다.</p>
    <h3>설정은 현재 실행에 이어서 적용돼요</h3><p>수요·건물·매대·통행·시간 수치를 바꿔도 현재 사람과 경과 시간을 초기화하지 않습니다. 다만 서로 다른 시나리오를 공정하게 비교하려면 조건을 고른 뒤 ‘처음부터’로 같은 시간만큼 실행해야 합니다.</p>
    <h3>원하는 공간을 직접 제외</h3><p>지도에서 공간 줄이기를 누르고 원하는 부분을 칠하면 해당 칸을 보행 공간에서 제외합니다. 여러 위치를 자유롭게 지정하고 복원할 수 있습니다. 편집 중에는 일시정지하고 손을 떼면 현재 사람과 시간을 유지한 채 새 공간 조건을 적용합니다. W·E·R·S와 A·C·D·M·J 주변은 모든 길의 연결을 보장하기 위해 보호하며, 그 외를 가로질러 완전히 칠하면 해당 통로는 실제로 끊깁니다. 이 편집은 현재 페이지에서 유지됩니다.</p><h3>지표의 범위</h3>
    <ul><li>완구거리 안 인원: 기존 A–B 도형 안에 현재 있는 모의 인원입니다.</li><li>실행 평균 인원: 실행 시작부터 현재까지 완구거리 안 인원의 시간가중 평균입니다.</li><li>인도·연결길 대기: 분석 구간 밖에서 1초 이상 정체한 사람과 외부 경계에서 진입을 기다리는 사람의 합입니다.</li><li>최근 1분 구간 이탈: 완구거리 분석 경계 밖으로 나간 모의 인원입니다.</li><li>구간 평균 체류: 실행 후 새로 유입되어 분석 구간에서 나간 사람의 구간 내 체류 시간입니다.</li><li>참고 인원: 분석 구간 안의 사용 가능한 칸 면적 × 설정 밀도이며 안전 한도 판정값은 아닙니다.</li></ul>
    <p>원본 A–B 도로경계 면적은 ${number(scene.roadBoundaryAreaM2,1)}㎡입니다. 생활인구 250m 격자를 골목 인원이나 밀도로 사용하지 않았으며, 현장 검증과 실제 인파 재현은 아직 하지 않았습니다.</p>`;
}
function registerAgentTools(){
  if(!document.modelContext?.registerTool)return;
  const lifecycle=new AbortController();
  const register=tool=>{if(tool.name==='configure_walking_simulation')for(const [key,bounds] of Object.entries(LIMITS)){const property=tool.inputSchema.properties[key];if(property){property.minimum=bounds[0];property.maximum=bounds[1];}}try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
  register({name:'read_walking_simulation',title:'보행 실험 상태 확인',description:'현재 화면의 모의 보행 조건, 재생 상태, 결과를 읽습니다.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({config:sim.config,running,comparisonDensity:Number($('density').value),...sim.stats()})});
  register({name:'configure_walking_simulation',title:'보행 조건 설정',description:'현재 사람과 경과 시간을 유지하면서 화면의 보행 조건을 변경합니다.',inputSchema:{type:'object',properties:{baselinePeople:{type:'integer',minimum:0,maximum:10000},baselineFillRate:{type:'number',minimum:0,maximum:10000},inflowA:{type:'number',minimum:0,maximum:180},inflowB:{type:'number',minimum:0,maximum:180},mainToAlleyRate:{type:'number',minimum:0,maximum:100},entryGateMask:{type:'integer',minimum:1,maximum:31,description:'A=1, C=2, D=4, R=8, S=16의 합으로 정한 진입 허용 연결부'},exitGateMask:{type:'integer',minimum:1,maximum:31,description:'A=1, C=2, D=4, R=8, S=16의 합으로 정한 퇴장 허용 연결부'},entryAvoidanceRate:{type:'number',minimum:0,maximum:100},rightHandRate:{type:'number',minimum:0,maximum:100},peoplePer100M2:{type:'number',minimum:0,maximum:50},buildingReleaseRate:{type:'number',minimum:0,maximum:100},storeEntryRate:{type:'number',minimum:0,maximum:100},storeDwellSeconds:{type:'number',minimum:10,maximum:900},storeUsableRate:{type:'number',minimum:30,maximum:90},storeCapacityDensity:{type:'number',minimum:.2,maximum:1.5},stallDepth:{type:'number',minimum:0,maximum:1.5},stallStopRate:{type:'number',minimum:0,maximum:100},stallDwellSeconds:{type:'number',minimum:0,maximum:180},capacityDensity:{type:'number',minimum:.2,maximum:2},analysisMinutes:{type:'number',minimum:0,maximum:240},setback:{type:'number',minimum:0,maximum:1},walkSpeed:{type:'number',minimum:.6,maximum:1.6}},additionalProperties:false},annotations:{readOnlyHint:false},execute:input=>{const valid=validateConfig(input);for(const [k,v] of Object.entries(valid))$(fields[k]).value=v;clearTimeout(restartTimer);reconfigure();return {config:sim.config,...sim.stats()};}});
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}

function paintSpace(point){
 const radius=Number($('brush-size').value)/2;
 let protectedOpening=false;
 for(const [i,kind]of scene.grid.cells){
  const p=sim.point(i);
  if(Math.hypot(p.x-point.x,p.y-point.y)>radius+.15)continue;
  const protectedCell=Object.values(scene.nodes).some(node=>Math.hypot(p.x-node.point[0],p.y-node.point[1])<=(node.port?2.2:2.75));
  if(editMode==='paint'&&protectedCell){protectedOpening=true;continue;}
  if(editMode==='erase')excluded.delete(i);else excluded.add(i);
 }
 renderer.excluded=excluded;renderer.dirty=true;
 $('edit-note').textContent=`직접 제외한 공간 약 ${number(excluded.size*scene.grid.step**2,1)}㎡${protectedOpening?' · 출입구·합류부는 열린 상태로 유지':''} · 손을 떼면 현재 실행에 적용해요.`;
}
function setEdit(mode){
 if(editMode===mode)mode=null;
 if(!editMode&&mode){wasRunning=running;setRunning(false);}
 editMode=mode;if(renderer){renderer.editMode=mode;renderer.transform();}
 $('edit-space').setAttribute('aria-pressed',String(mode==='paint'));$('erase-space').setAttribute('aria-pressed',String(mode==='erase'));
 if(!mode)setRunning(wasRunning);
}
$('edit-space').addEventListener('click',()=>setEdit('paint'));
$('erase-space').addEventListener('click',()=>setEdit('erase'));
$('clear-space').addEventListener('click',()=>{excluded.clear();reconfigure();$('edit-note').textContent='직접 제외했던 공간을 모두 복원했어요. 현재 실행은 그대로 이어집니다.';});
$('brush-size').addEventListener('input',()=>{$('brush-size-value').textContent=Number($('brush-size').value).toFixed(1)+' m';});
$('info-open').addEventListener('click',()=>$('info-dialog').showModal());
$('info-close').addEventListener('click',()=>$('info-dialog').close());
$('info-dialog').addEventListener('click',e=>{if(e.target===$('info-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('info-content').textContent='공간자료를 불러오고 있어요.';
function setScenarioOpen(open,restoreFocus=false){
  const isOpen=Boolean(open);$('scenario-controls').classList.toggle('is-open',isOpen);document.body.classList.toggle('scenario-open',isOpen);$('scenario-toggle').setAttribute('aria-expanded',String(isOpen));
  if(isOpen)$('scenario-controls').scrollTop=0;else if(restoreFocus)$('scenario-toggle').focus();
}
$('scenario-toggle').addEventListener('click',()=>setScenarioOpen(true));
$('scenario-close').addEventListener('click',()=>setScenarioOpen(false,true));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('scenario-controls').classList.contains('is-open'))setScenarioOpen(false,true);});
$('play').addEventListener('click',()=>{if(editMode){setEdit(null);setRunning(true);return;}const limit=sim?.config.analysisMinutes*60;if(!experiments.active||(limit&&sim?.time>=limit)){reset();setRunning(true);return;}setRunning(!running);});
$('reset').addEventListener('click',()=>{clearTimeout(restartTimer);reset();});
$('historical-scenario').addEventListener('change',()=>{
  const selected=$('historical-scenario').value;
  $('historical-status').textContent=selected==='children-2026'
    ?'2026년 5월 5일 주변 2개 격자의 생활인구 자료를 확인한 항목입니다. 아직 골목 실제 유입 명/분으로 보정되지 않아 현재 시뮬레이션 수치를 자동 변경하지 않습니다.'
    :'현재 수치는 사용자가 직접 조정하는 가정값입니다. 생활인구는 주변 수요의 배경이며 골목 유입 명/분으로 자동 변환하지 않습니다.';
});
for(const id of Object.values(fields))$(id).addEventListener('input',()=>{clearTimeout(restartTimer);if($(id).value===''||!$(id).checkValidity())return;document.querySelectorAll('[data-preset]').forEach(item=>item.classList.remove('active'));clearSolutionExperiment();updateOutputs();restartTimer=setTimeout(reconfigure,140);});
const presets={
  normal:{inflowA:0,inflowB:0},
  busy:{inflowA:40,inflowB:20},
  stress:{inflowA:180,inflowB:180}
};
for(const button of document.querySelectorAll('[data-preset]'))button.addEventListener('click',()=>{
  for(const [key,value]of Object.entries(presets[button.dataset.preset]))$(fields[key]).value=value;
  document.querySelectorAll('[data-preset]').forEach(item=>item.classList.toggle('active',item===button));
  clearSolutionExperiment('선택한 시나리오 조건으로 계속 실행 중');updateOutputs();clearTimeout(restartTimer);reconfigure();
});
for(const key of ['space','inflow'])$(`solution-${key}`).addEventListener('click',()=>applySolution(key));
function toggleGate(direction,button){
  const buttons=[...document.querySelectorAll(`[data-${direction}-gate]`)];
  const wasPressed=button.getAttribute('aria-pressed')==='true';
  if(wasPressed&&buttons.filter(item=>item.getAttribute('aria-pressed')==='true').length===1){
    updateSolutionUI(`${direction==='entry'?'진입':'퇴장'} 허용 지점은 최소 한 곳 필요합니다.`);return;
  }
  if(!solutionBaseline){solutionBaseline={values:values(),excluded:new Set(excluded)};solutionBaselineStats=sim.stats();}
  button.setAttribute('aria-pressed',String(!wasPressed));
  const mask=buttons.reduce((value,item,index)=>value|(item.getAttribute('aria-pressed')==='true'?1<<index:0),0);
  $(`${direction}-gate-mask`).value=mask;appliedSolutions.add('gates');
  clearTimeout(restartTimer);reconfigure();updateSolutionUI(`출입구 분리 적용 중 · ${direction==='entry'?'진입':'퇴장'} 허용 ${buttons.filter(item=>item.getAttribute('aria-pressed')==='true').map(item=>item.textContent).join('·')}`);
}
for(const button of document.querySelectorAll('[data-entry-gate]'))button.addEventListener('click',()=>toggleGate('entry',button));
for(const button of document.querySelectorAll('[data-exit-gate]'))button.addEventListener('click',()=>toggleGate('exit',button));
$('solution-restore').addEventListener('click',()=>{if(!solutionBaseline)return;for(const [key,value]of Object.entries(solutionBaseline.values))$(fields[key]).value=value;for(const direction of ['entry','exit']){const mask=Number($(`${direction}-gate-mask`).value);document.querySelectorAll(`[data-${direction}-gate]`).forEach((button,index)=>button.setAttribute('aria-pressed',String(Boolean(mask&(1<<index)))));}excluded=new Set(solutionBaseline.excluded);renderer.excluded=excluded;solutionBaseline=null;solutionBaselineStats=null;appliedSolutions.clear();updateOutputs();reconfigure();updateSolutionUI('적용 전 조건을 복원했습니다 · 사람과 경과 시간 유지');updateSolutionComparison();});
for(const [id,mode]of [['view-all','all'],['view-entrance','entrance'],['zoom-in','in'],['zoom-out','out']])$(id).addEventListener('click',()=>{if(renderer){renderer.view(mode);renderer.draw(sim,0);}});
$('callout-reset').addEventListener('click',()=>{if(!renderer)return;renderer.resetLabelPositions();renderer.draw(sim,0);});
$('density-toggle').addEventListener('click',()=>{if(!renderer)return;renderer.showDensity=!renderer.showDensity;$('density-toggle').setAttribute('aria-pressed',String(renderer.showDensity));$('density-toggle').textContent=`혼잡 ${renderer.showDensity?'켬':'끔'}`;renderer.draw(sim,0);});
$('capacity-toggle').addEventListener('click',()=>{if(!renderer)return;renderer.showCapacitySections=!renderer.showCapacitySections;renderer.dirty=true;$('capacity-toggle').setAttribute('aria-pressed',String(renderer.showCapacitySections));$('capacity-toggle').textContent=`수용능력 ${renderer.showCapacitySections?'켬':'끔'}`;renderer.draw(sim,0);});
document.addEventListener('visibilitychange',()=>{lastTime=0;});
window.addEventListener('pagehide',e=>{autoExplorer.cancel();if(sim)experiments.sample(sim,true);experiments.save();cancelAnimationFrame(raf);if(!e.persisted)renderer?.destroy();});
window.addEventListener('pageshow',e=>{if(e.persisted){renderer?.observer.observe($('map'));registerAgentTools();lastTime=0;raf=requestAnimationFrame(animate);}});
updateOutputs();
try {
  const response=await fetch('./scene.json');if(!response.ok)throw new Error('공간자료를 불러오지 못했어요.');
  scene=await response.json();
  if(scene.version!==3||!scene.grid?.cells?.length)throw new Error('연결부 공간자료 형식을 확인할 수 없어요.');
  $('storefront-count').textContent=`${scene.storefrontSummary.mappedStoreCount}곳 + 출입 ${scene.storefrontSummary.accessPointCount-scene.storefrontSummary.mappedStoreCount}곳`;
  $('storefront-buildings').textContent=`${scene.storefrontSummary.buildingCount}동`;
  $('storefront-area').textContent=`약 ${number(scene.storefrontSummary.matchedBuildingFootprintAreaM2)}㎡`;
  $('storefront-list').innerHTML=scene.storefronts.map(store=>`<div class="store-row"><b>${store.id}</b><span title="${store.name}">${store.name}</span><em data-store-status="${store.id}">계산 중</em></div>`).join('');
  updateOutputs();
  renderer=new StreetRenderer($('map'),scene);renderer.onPaint=paintSpace;renderer.onPaintEnd=()=>{reconfigure();};reset();explanation();registerAgentTools();
  $('play').disabled=false;setRunning(false);
  raf=requestAnimationFrame(animate);
}catch(error){
  $('scene-error').hidden=false;$('scene-error').textContent=`${error.message} 페이지를 새로고침해 주세요.`;
  $('play').textContent='불러오기 실패';$('reset').disabled=true;$('status-note').textContent='시뮬레이션을 시작하지 못했어요.';
}
