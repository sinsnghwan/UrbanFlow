import {EXPLORE_VARIABLES,createExploreJobs,exploreCSV,mixSeed,normalizeRanges,patternReplay,suggestedRanges,summarizeExplore} from './auto-explore.js';

const STORAGE_KEY='walk-auto-explore-v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const number=(value,digits=0)=>Number(value??0).toLocaleString('ko-KR',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const stamp=()=>{
  const values=new Uint32Array(1);
  if(globalThis.crypto?.getRandomValues)crypto.getRandomValues(values);
  return mixSeed(values[0]??Date.now());
};

function rangeRows(ranges){
  return EXPLORE_VARIABLES.map(variable=>{
    const [low,high]=ranges[variable.key];
    return `<div class="explore-range-row" data-range="${variable.key}"><span>${esc(variable.label)} <small>${esc(variable.unit)}</small></span><label>최소<input type="number" data-low min="${variable.limit[0]}" max="${variable.limit[1]}" step="1" value="${low}"></label><i>–</i><label>최대<input type="number" data-high min="${variable.limit[0]}" max="${variable.limit[1]}" step="1" value="${high}"></label></div>`;
  }).join('');
}

function runWorkers({scene,jobs,excluded,durationSeconds,onProgress}){
  let cancelTask;
  const promise=new Promise((resolve,reject)=>{
    const workers=[],results=new Array(jobs.length);
    let next=0,finished=0,retired=0,settled=false,lastPaint=0;
    const close=()=>workers.forEach(worker=>worker.terminate());
    const fail=error=>{if(settled)return;settled=true;close();reject(error);};
    const dispatch=worker=>{
      if(next>=jobs.length){
        retired++;
        if(retired===workers.length&&!settled){settled=true;close();resolve(results);}
        return;
      }
      worker.postMessage({type:'run',job:jobs[next++],excluded,durationSeconds});
    };
    const hardware=Math.max(1,Number(navigator.hardwareConcurrency)||2);
    const workerCount=Math.min(jobs.length,Math.max(1,Math.min(4,hardware-1)));
    for(let index=0;index<workerCount;index++){
      const worker=new Worker(new URL('./auto-explore-worker.js',import.meta.url),{type:'module'});
      workers.push(worker);
      worker.onmessage=event=>{
        if(event.data?.type==='ready'){dispatch(worker);return;}
        if(event.data?.type!=='result')return;
        const result=event.data.result;
        results[Math.max(0,Number(result.id)-1)]=result;finished++;
        const now=performance.now();
        if(now-lastPaint>80||finished===jobs.length){lastPaint=now;onProgress(finished,jobs.length,workerCount);}
        dispatch(worker);
      };
      worker.onerror=event=>fail(new Error(event.message||'자동 탐색 작업자가 중단됐습니다.'));
      worker.postMessage({type:'init',scene});
    }
    cancelTask=()=>{
      if(settled)return;
      const error=new DOMException('사용자가 자동 탐색을 중단했습니다.','AbortError');
      fail(error);
    };
  });
  return {promise,cancel:()=>cancelTask?.()};
}

export function autoExploreUI({getCurrentConfig,getSetup,onStart,onReplay,storage=localStorage}){
  const initial=suggestedRanges(getCurrentConfig());
  const panel=document.createElement('section');
  panel.className='auto-explore-panel';panel.id='auto-explore';panel.hidden=true;
  panel.innerHTML=`
    <div class="explore-heading"><div><h2>자동 문제 탐색</h2><p>정수 1단위 조건을 골고루 뽑아 같은 보행 모형을 반복 실행합니다.</p></div><span class="assumed-badge">가정 탐색</span></div>
    <div class="explore-explainer"><b>무엇을 찾나</b><p>접근 수요가 통과 비교값을 넘거나, 체류 기준을 일정 시간 넘거나, 실행 끝에도 대기가 남는 경우를 모아 공통 패턴을 최대 5개로 줄입니다. 5개를 억지로 채우지 않습니다.</p></div>
    <div class="explore-core">
      <label>반복 횟수<select id="explore-count"><option value="100">100회 · 빠른 확인</option><option value="300" selected>300회 · 기본</option><option value="1000">1,000회 · 정밀</option></select></label>
      <label>한 번의 모형 시간<select id="explore-duration"><option value="5" selected>5분</option><option value="10">10분</option><option value="30">30분</option></select></label>
    </div>
    <fieldset class="explore-criteria"><legend>‘문제 발생’으로 묶을 조건 <span class="assumed-badge">사용자 기준</span></legend>
      <label>접근 수요 / 통과 비교값이 <span><input id="explore-flow-use" type="number" min="1" max="10000" step="1" value="100">% 이상</span></label>
      <b>또는</b>
      <label>동시 체류 기준 초과가 <span><input id="explore-over-seconds" type="number" min="1" max="86400" step="1" value="60">초 이상</span></label>
      <b>또는</b>
      <label>끝날 때 전체 대기가 <span><input id="explore-waiting" type="number" min="1" max="10000" step="1" value="10">명 이상</span></label>
    </fieldset>
    <details class="explore-ranges"><summary>탐색할 조건 범위 <span>모두 1단위</span></summary><div id="explore-range-list">${rangeRows(initial)}</div><button type="button" id="explore-suggest">현재 조건 기준으로 범위 다시 맞추기</button><p>두 끝값을 포함한 정수 중 표본을 고릅니다. 전 조합을 모두 검사하는 방식은 아닙니다.</p></details>
    <details class="explore-seed"><summary>재현 설정</summary><label>묶음 시드<input id="explore-seed" type="number" min="1" max="4294967295" step="1" value="${stamp()}"></label><label class="explore-check"><input id="explore-lock-seed" type="checkbox">같은 시드를 유지해 결과 재현</label><p>체크하지 않으면 시작할 때마다 새 시드가 생겨 다른 조건 조합과 행동 변동을 탐색합니다.</p></details>
    <div class="explore-actions"><button id="explore-start" type="button">새 표본 탐색</button><button id="explore-cancel" type="button" disabled>중단</button><button id="explore-csv" type="button" disabled>전체 결과 CSV</button><button id="explore-delete" type="button" disabled>결과 삭제</button></div>
    <div class="explore-progress" id="explore-progress" hidden><div><span id="explore-progress-label">준비 중</span><b id="explore-progress-value">0%</b></div><progress id="explore-progress-bar" max="100" value="0"></progress><small>화면 시뮬레이션은 잠시 멈춥니다. 1,000회·30분은 기기에 따라 오래 걸릴 수 있습니다.</small></div>
    <p class="explore-status" id="explore-status" aria-live="polite">아직 자동 탐색 결과가 없습니다.</p>
    <div id="explore-results"></div>
    <p class="explore-footnote">결과는 시뮬레이션 가정 안의 연관 패턴이며 실제 사고 원인이나 안전 판정이 아닙니다. 완료한 최근 결과 1개는 이 브라우저에 저장됩니다.</p>`;

  const $=selector=>panel.querySelector(selector);
  let batch=null,current=null;
  const controls=[...panel.querySelectorAll('input,select,button')].filter(control=>control.id!=='explore-cancel');
  const setBusy=busy=>{
    for(const control of controls)control.disabled=busy||(control.id==='explore-csv'&&!batch)||(control.id==='explore-delete'&&!batch);
    $('#explore-cancel').disabled=!busy;
    $('#explore-start').textContent=busy?'탐색 실행 중':'새 표본 탐색';
  };
  const readRanges=()=>normalizeRanges(Object.fromEntries(EXPLORE_VARIABLES.map(variable=>{
    const row=panel.querySelector(`[data-range="${variable.key}"]`);
    return [variable.key,[Number(row.querySelector('[data-low]').value),Number(row.querySelector('[data-high]').value)]];
  })));
  const writeRanges=ranges=>{
    for(const variable of EXPLORE_VARIABLES){
      const row=panel.querySelector(`[data-range="${variable.key}"]`);
      row.querySelector('[data-low]').value=ranges[variable.key][0];row.querySelector('[data-high]').value=ranges[variable.key][1];
    }
  };
  const save=()=>{
    try{storage.setItem(STORAGE_KEY,JSON.stringify(batch));return true;}
    catch{$('#explore-status').textContent='결과는 화면에 표시됐지만 브라우저 저장 공간이 부족해 저장하지 못했습니다. CSV로 내려받으세요.';return false;}
  };
  const render=()=>{
    $('#explore-csv').disabled=!batch;$('#explore-delete').disabled=!batch;
    const target=$('#explore-results');
    if(!batch){target.replaceChildren();return;}
    const summary=batch.summary??summarizeExplore(batch.results,batch.criteria);batch.summary=summary;
    const criteria=`수요/통과 ${number(batch.criteria.minFlowUsePercent??100)}% 이상, 체류 기준 ${number(batch.criteria.minExceedSeconds)}초 이상 초과 또는 종료 대기 ${number(batch.criteria.minEndingWaiting)}명 이상`;
    const patterns=summary.patterns.map(pattern=>{
      const drivers=pattern.drivers.map(driver=>`<li><span>${esc(driver.label)}</span><b>${number(driver.q25,driver.q25%1?1:0)}–${number(driver.q75,driver.q75%1?1:0)}${esc(driver.unit)}</b><small>가운데 50% · 중앙 ${number(driver.median,driver.median%1?1:0)}</small></li>`).join('');
      return `<article class="explore-pattern"><header><span>패턴 ${pattern.rank}</span><b>${number(pattern.count)}회 · 전체의 ${number(pattern.shareOfAll,1)}%</b></header><h3>${esc(pattern.section)}</h3><p class="explore-signal">${esc(pattern.signal)}</p><div class="explore-output"><span>수요 / 처리<b>${number(pattern.output.flowUsePercent.median)}%</b></span><span>최대 구간 인원<b>${number(pattern.output.peakInside.median)}명</b></span><span>종료 대기<b>${number(pattern.output.finalWaiting.median)}명</b></span><span>체류 기준 초과<b>${number(pattern.output.capacityExceedSeconds.median/60,1)}분</b></span></div><h4>자주 함께 나타난 입력 구간</h4><ul>${drivers}</ul><small class="explore-example">대표 재현 시드 ${pattern.exampleSeed.toLocaleString('ko-KR')} · 문제 실행 중 ${number(pattern.shareOfProblems,1)}%</small><button class="explore-replay" type="button" data-replay-pattern="${pattern.rank}">이 패턴으로 지도에서 재생</button></article>`;
    }).join('');
    target.innerHTML=`<section class="explore-summary"><span>${esc(new Date(batch.createdAt).toLocaleString('ko-KR'))} · 시드 ${number(batch.masterSeed)} · ${number(batch.durationMinutes)}분씩</span><strong>${number(summary.total)}회 중 ${number(summary.problemCount)}회</strong><b>문제 묶음 ${number(summary.problemRate,1)}%</b><p>${esc(criteria)}${summary.errors?` · 오류 ${number(summary.errors)}회 제외`:''}</p></section>${patterns?`<div class="explore-patterns">${patterns}</div>`:`<div class="explore-empty"><b>설정한 문제 조건에 해당한 실행이 없었습니다.</b><p>이 결과도 유효합니다. 탐색 범위나 문제 묶음 기준을 확인한 뒤 새 표본을 실행하세요.</p></div>`}`;
    $('#explore-status').textContent=`최근 탐색: ${number(summary.total)}회 완료 · 서로 다른 실행 시드 ${number(summary.total)}개 · 패턴 ${summary.patterns.length}개`;
  };
  try{
    const restored=JSON.parse(storage.getItem(STORAGE_KEY));
    if(restored?.results?.length&&restored?.criteria){batch=restored;render();}
  }catch{/* A malformed previous cache should never stop the simulator. */}

  $('#explore-suggest').onclick=()=>{writeRanges(suggestedRanges(getCurrentConfig()));$('#explore-status').textContent='현재 화면의 입력값을 기준으로 탐색 범위를 다시 맞췄습니다.';};
  $('#explore-cancel').onclick=()=>current?.cancel();
  $('#explore-delete').onclick=()=>{
    batch=null;try{storage.removeItem(STORAGE_KEY);}catch{/* no-op */}
    render();$('#explore-status').textContent='저장된 자동 탐색 결과를 삭제했습니다.';
  };
  $('#explore-csv').onclick=()=>{
    if(!batch)return;
    const blob=new Blob([exploreCSV(batch)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`walking-auto-explore-${new Date(batch.createdAt).toISOString().slice(0,10)}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('#explore-results').onclick=event=>{
    const button=event.target.closest('[data-replay-pattern]');
    if(!button||current||!batch)return;
    const rank=Number(button.dataset.replayPattern),pattern=batch.summary?.patterns?.find(item=>item.rank===rank);
    const replay=patternReplay(batch,pattern);
    if(!replay){$('#explore-status').textContent='이전 결과에서 대표 실행을 찾지 못했습니다. 새 표본 탐색을 실행해 주세요.';return;}
    try{
      onReplay?.(replay);
      $('#explore-status').textContent=replay.spaceExact
        ?`패턴 ${rank}의 실제 대표 실행을 지도에서 재생 중입니다. 자동 탐색 결과는 그대로 유지됩니다.`
        :`패턴 ${rank}의 설정과 시드는 재현했습니다. 이전 형식 결과라 직접 제외 공간만 현재 지도 상태를 사용합니다.`;
    }catch(error){$('#explore-status').textContent=`패턴을 재생하지 못했습니다: ${error.message}`;}
  };
  $('#explore-start').onclick=async()=>{
    try{
      const setup=getSetup();
      if(!setup?.scene)throw new Error('공간자료를 아직 불러오는 중입니다. 잠시 뒤 다시 시작하세요.');
      const ranges=readRanges(),count=Number($('#explore-count').value),durationMinutes=Number($('#explore-duration').value);
      const minFlowUsePercent=Math.round(Number($('#explore-flow-use').value)),minExceedSeconds=Math.round(Number($('#explore-over-seconds').value)),minEndingWaiting=Math.round(Number($('#explore-waiting').value));
      if(!Number.isFinite(minFlowUsePercent)||minFlowUsePercent<1||!Number.isFinite(minExceedSeconds)||minExceedSeconds<1||!Number.isFinite(minEndingWaiting)||minEndingWaiting<1)throw new Error('문제 발생 기준은 1 이상의 정수로 입력하세요.');
      let masterSeed=Math.round(Number($('#explore-seed').value));
      if(!$('#explore-lock-seed').checked){masterSeed=stamp();$('#explore-seed').value=masterSeed;}
      const criteria={minFlowUsePercent,minExceedSeconds,minEndingWaiting,ranges};
      const jobs=createExploreJobs({count,masterSeed,baseConfig:setup.baseConfig,ranges});
      onStart?.();setBusy(true);
      $('#explore-progress').hidden=false;$('#explore-progress-bar').value=0;$('#explore-progress-value').textContent='0%';
      $('#explore-progress-label').textContent=`0 / ${number(count)}회`;
      $('#explore-status').textContent=`새 표본 ${number(count)}회를 준비했습니다. 각 실행은 독립 시드를 사용합니다.`;
      current=runWorkers({scene:setup.scene,jobs,excluded:setup.excluded,durationSeconds:durationMinutes*60,onProgress:(done,total,workers)=>{
        const percent=done/total*100;$('#explore-progress-bar').value=percent;$('#explore-progress-value').textContent=`${number(percent)}%`;$('#explore-progress-label').textContent=`${number(done)} / ${number(total)}회 · 병렬 ${workers}개`;
      }});
      const results=await current.promise;
      batch={version:2,createdAt:new Date().toISOString(),masterSeed,durationMinutes,baseConfig:setup.baseConfig,excluded:[...setup.excluded],excludedCount:setup.excluded.length,criteria,results,summary:null};
      batch.summary=summarizeExplore(results,criteria);save();render();
      $('#explore-progress-label').textContent=`${number(results.length)} / ${number(results.length)}회 완료`;
    }catch(error){
      $('#explore-status').textContent=error.name==='AbortError'?'자동 탐색을 중단했습니다. 완료 전 임시 결과는 저장하지 않았습니다.':`자동 탐색을 시작하지 못했습니다: ${error.message}`;
    }finally{current=null;setBusy(false);}
  };
  setBusy(false);
  return {panel,cancel:()=>current?.cancel()};
}
