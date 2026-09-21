// Presentation only: measurement overlays and layout never enter collision geometry.
export function organizeWorkspace(){
  const workspace=document.querySelector('.workspace');
  const controls=document.querySelector('.controls');
  const scene=workspace.querySelector('.scene');
  scene.after(scene.querySelector('.legend'));
  const fold=(title,nodes,parent)=>{
    const details=document.createElement('details');details.className='disclosure';
    const summary=document.createElement('summary');summary.textContent=title;details.append(summary);
    for(const node of nodes)if(node)details.append(node);
    parent.append(details);return details;
  };
  const outcome=document.createElement('section');outcome.className='outcome';outcome.setAttribute('aria-label','현재 조건의 수용능력 결과');
  outcome.innerHTML=`<div class="outcome-kicker"><b>결과</b> 현재 입력 조건의 모의 결과 <span>실제 어린이날 판정 아님</span></div>
    <div id="outcome-verdict"></div>
    <div class="essential-results">
      <div><span>완구거리 동시 체류</span><strong id="headline-occupancy">계산 중</strong><small id="headline-occupancy-note">현재 인원 / 선택 밀도 기준</small></div>
      <div><span>완구거리 접근 수요</span><strong id="headline-demand">계산 중</strong><small>명/분 · 설정 수요 / 폭 기준 비교값</small></div>
      <div><span>인도·연결길·점포 대기</span><strong id="headline-wait">계산 중</strong><small id="headline-wait-note">현재 대기 / 이번 실행 최대</small></div>
    </div>
    <div class="next-experiment"><span id="next-experiment-text">재생 후 대기와 이동 변화를 확인하세요.</span><button id="next-experiment" type="button">조건 바꿔 시험하기</button></div>`;
  workspace.insertBefore(outcome,workspace.querySelector('.capacity-strip'));
  outcome.querySelector('#outcome-verdict').append(document.getElementById('capacity-verdict'));
  // Keep the map directly below the compact result; guidance belongs after playback.
  workspace.querySelector('.playback').after(outcome.querySelector('.next-experiment'));
  const detailArea=document.createElement('div');detailArea.className='result-details';workspace.append(detailArea);
  fold('거리 크기와 수용기준 계산', [workspace.querySelector('.capacity-strip'),workspace.querySelector('.segment-results')],detailArea);
  fold('실행 통계와 기준 도달 시 변화',[workspace.querySelector('.metrics'),workspace.querySelector('.decision-summary'),workspace.querySelector('.capacity-impact'),document.getElementById('status-note')],detailArea);
  // Gate selection remains user-controlled and visible beside the map.
  const solutions=document.querySelector('.solution-lab');controls.insertBefore(solutions,controls.querySelector('.preset-control'));
  const advanced=[...controls.children].filter(n=>n.matches('fieldset,section')&&!n.matches('.solution-lab,.preset-control,.baseline-control')&&!n.querySelector('#inflow-a'));
  fold('상세 조건 · 점포 · 매대 · 공간 편집',advanced,controls);
  const history=controls.querySelector('.historical-control');
  const evidence=fold('실제 주변 수요 비교 · 어린이날 / 일반 화요일',[history],detailArea);
  const comparison=document.createElement('div');comparison.className='population-context';comparison.textContent='저장된 주변 수요 비교자료를 불러오는 중입니다.';evidence.append(comparison);
  fetch('./population-context.json').then(response=>{if(!response.ok)throw new Error('자료 요청 실패');return response.json();}).then(data=>{
    const fmt=n=>Number(n).toLocaleString('ko-KR',{maximumFractionDigits:1});
    const changeCell=value=>`<td class="population-change ${value>0?'is-increase':value<0?'is-decrease':''}">${value>0?'+':''}${fmt(value)}</td>`;
    comparison.innerHTML=`<table class="population-table">
      <caption><strong>평균 생활인구</strong><span>2026년 5월 5일 · ${data.window} 평균</span></caption>
      <colgroup><col class="population-position-column"><col class="population-count-column"><col class="population-count-column"><col class="population-change-column"></colgroup>
      <thead><tr><th scope="col">250m 격자</th><th scope="col">일반 화요일<span class="population-unit">(명)</span></th><th scope="col">어린이날<span class="population-unit">(명)</span></th><th scope="col">증감<span class="population-unit">(%)</span></th></tr></thead>
      <tbody>${data.rows.map(row=>`<tr><th scope="row">${row.POSITION}</th><td>${fmt(row.NORMAL_AVG_12_17)}</td><td>${fmt(row.EVENT_AVG_12_17)}</td>${changeCell(row.CHANGE_12_17_PCT)}</tr>`).join('')}</tbody>
      <tfoot><tr><th scope="row">두 격자 합계</th><td>${fmt(data.totalNormalMean)}</td><td>${fmt(data.totalEventMean)}</td>${changeCell(data.changePercent)}</tr></tfoot>
    </table><p class="evidence-status">주변 두 격자의 평균 생활인구 합계이며 누적 방문객이나 골목 안 인원이 아닙니다. 저장된 분석 GPKG를 연결했습니다. 일반 화요일의 날짜 목록·월간 원본 CSV는 이번 작업에서 재대조하지 못했습니다.</p>`;
  }).catch(()=>{comparison.textContent='주변 수요 비교자료를 불러오지 못했습니다. 새로고침 후 다시 확인하세요.';});
  const note=document.createElement('p');note.className='evidence-status';note.textContent='2026 어린이날과 평상시의 실제 비교: 미확정. 두 격자 생활인구는 주변 수요 배경이며, 입구별 시간대 통행 계수가 없어 골목 접근 명/분으로 연결하지 않았습니다. 위 평상시·혼잡일 버튼은 가정 시나리오입니다.';evidence.append(note);
  note.textContent='주변 생활인구 비교는 연결 완료. 실제 골목 수요와 처리량 비교는 입구별 계수 미확보로 미확정입니다. 위 평상시·혼잡일 버튼은 계속 가정 시나리오로 작동합니다.';
  const report=document.createElement('p');report.className='evidence-status';report.innerHTML='현장 보도: <a href="https://news.nate.com/view/20260504n27855" target="_blank" rel="noopener">더팩트 2026-05-04</a>는 상인 인터뷰로 낮까지 방문객 1만 명 이상을 전합니다. 집계 시작 시각·범위·방법과 입구별 흐름은 제시하지 않아 분당 유입값으로 환산하지 않았습니다. <a href="https://v.daum.net/v/20260506000354515" target="_blank" rel="noopener">중앙일보 2026-05-06</a>는 5월 3~4일 현장 혼잡과 경찰·구청 관리를 보도합니다. 수요 비교 확정에는 동일 경계의 평상시·어린이날 시간대별 출입 계수가 필요합니다.';evidence.append(report);
  document.querySelector('.control-header h2').textContent='조건을 바꿔 비교하기';
  document.querySelector('.control-header p').textContent='사람과 시간은 유지됩니다. 새 실험은 ‘처음부터’.';
  document.querySelector('.map-heading h2').textContent='창신동 문구·완구거리';
  document.querySelector('.map-heading p').textContent='분석 대상 · 종로52길과 연결 보행로';
  document.querySelector('.mode-label').textContent='시나리오 분석';
  document.querySelector('.control-header .eyebrow').textContent='분석 조건';
  document.querySelector('[data-preset="normal"]').textContent='추가 유입 없음';
  document.querySelector('.preset-control .hint').textContent='예시 유입값만 변경합니다. 독립 실험은 조건 선택 후 ‘처음부터’.';
  const caution=document.createElement('p');caution.className='evidence-status';
  caution.textContent='해석 범위: 도로·건물은 공간자료 기반, 유입·점포·매대는 가정 조건입니다. 수용기준은 법정 최대인원이나 안전 판정이 아닙니다. 실행 중 조건을 바꾸면 이전 조건의 최대 인원도 남습니다. 새 조건만 평가하려면 처음부터 실행하세요.';
  evidence.append(caution);
  const policy=controls.querySelector('.solution-lab>p');policy.style.display='block';
  // The default surface is an execution desk. Existing controls are moved, never copied.
  const header=controls.querySelector('.control-header');
  header.querySelector('h2').textContent='시뮬레이션 실행';
  header.querySelector('p').textContent='아래 순서대로 선택하면 바로 실행할 수 있습니다.';
  const quickGuide=document.createElement('ol');quickGuide.className='quick-guide';
  quickGuide.innerHTML='<li><b>상황 선택</b><span>예시 또는 직접 입력</span></li><li><b>실행 시간</b><span>비교할 시간 선택</span></li><li><b>시작</b><span>지도와 결과 확인</span></li>';
  header.after(quickGuide);
  const playback=workspace.querySelector('.playback');
  const runDesk=document.createElement('div');runDesk.className='run-desk';
  const runTitle=document.createElement('div');runTitle.className='run-title';runTitle.innerHTML='<span class="step-number">3</span> 시뮬레이션 시작';
  runDesk.append(playback);
  const demand=document.getElementById('inflow-a').closest('fieldset');
  demand.classList.add('primary-demand');
  demand.querySelector('legend').innerHTML='<span class="step-number">1</span> 상황과 추가 유입 선택';
  demand.querySelector('.hint').textContent='명/분 · 직접 설정하는 가정값. 변경해도 사람과 시간은 유지됩니다.';
  // Numeric input stays unrestricted within the disclosed computational range.
  for(const id of ['inflow-a','inflow-b']){
    const input=document.getElementById(id);
    const row=document.createElement('div');row.className='demand-stepper';
    input.before(row);
    for(const delta of [-10,10]){
      const button=document.createElement('button');button.type='button';
      button.textContent=delta<0?'−10':'+10';
      const label=document.querySelector(`label[for="${id}"]`).textContent;
      button.setAttribute('aria-label',`${label} ${Math.abs(delta)}명/분 ${delta<0?'줄이기':'늘리기'}`);
      button.addEventListener('click',()=>{
        input.value=Math.min(Number(input.max),Math.max(Number(input.min),(Number(input.value)||0)+delta));
        input.dispatchEvent(new Event('input',{bubbles:true}));
      });
      row.append(button);if(delta<0)row.append(input);
    }
  }
  const preset=controls.querySelector('.preset-control');
  preset.querySelector('span').textContent='빠른 상황 선택';
  preset.querySelector('.hint').textContent='관측값이 아닌 예시입니다. 유입량만 변경합니다.';
  demand.insertBefore(preset,demand.querySelector('.slider-heading'));
  document.querySelector('[data-preset="normal"]').textContent='평상시';
  document.querySelector('[data-preset="busy"]').textContent='혼잡 예시';
  document.querySelector('[data-preset="stress"]').textContent='고수요 예시';
  const baseline=controls.querySelector('.baseline-control');
  const refill=document.getElementById('baseline-fill-rate').closest('fieldset');
  const duration=document.getElementById('analysis-minutes').closest('fieldset');
  duration.classList.add('primary-duration');
  duration.querySelector('legend').innerHTML='<span class="step-number">2</span> 총 관찰 시간';
  duration.querySelector('label').textContent='총 관찰 시간 (0분부터)';
  demand.after(duration);
  duration.after(runTitle);
  runTitle.after(runDesk);
  const setup=fold('기준 인원과 자동 보충',[baseline,refill],controls);
  runDesk.after(setup);
  const policyFold=fold('출입구 · 공간 조건 바꿔보기',[solutions],controls);
  policyFold.classList.add('policy-fold');setup.after(policyFold);
  solutions.querySelector('#solution-title').textContent='진입과 퇴장 직접 지정';
  const advancedFold=[...controls.children].find(node=>node.matches('details')&&node.querySelector('#store-entry-rate'));
  if(advancedFold){
    advancedFold.querySelector('summary').textContent='세부 모형 설정';
    policyFold.after(advancedFold);
    for(const group of [...advancedFold.children].filter(node=>node.matches('fieldset,section'))){
      const title=group.querySelector('legend,h3')?.textContent??'추가 조건';
      fold(title,[group],advancedFold).classList.add('model-group');
    }
  }
  const hint=document.createElement('p');hint.className='run-hint';hint.id="run-hint";
  hint.innerHTML='<b>3. 시작</b> 버튼을 누르면 지도와 위쪽 결과가 함께 갱신됩니다.';
  runDesk.append(hint);
  const continuation=document.createElement('div');continuation.className='run-continuation';continuation.id='run-continuation';continuation.hidden=true;
  continuation.innerHTML='<label for="continuation-minutes">추가 관찰 시간</label><select id="continuation-minutes"><option value="10">10분 더</option><option value="30" selected>30분 더</option><option value="60">60분 더</option><option value="120">120분 더</option><option value="0">제한 없이 계속</option></select><p id="continuation-range"></p>';
  runDesk.prepend(continuation);
  const runStatus=document.createElement('p');runStatus.className='run-status';runStatus.id='run-status';runStatus.setAttribute('role','status');
  runDesk.append(runStatus);

  document.getElementById('next-experiment').addEventListener('click',()=>{
    document.dispatchEvent(new Event('show-scenario-settings'));
    controls.classList.add('is-open');document.body.classList.add('scenario-open');
    document.getElementById('scenario-toggle').setAttribute('aria-expanded','true');
    policyFold.open=true;policyFold.scrollIntoView({block:'nearest',behavior:'smooth'});solutions.querySelector('button[data-entry-gate]').focus({preventScroll:true});
  });
}
