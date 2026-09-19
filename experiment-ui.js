import {summary,toCSV} from './experiment-log.js';
const fmt=n=>Number(n||0).toLocaleString('ko-KR',{maximumFractionDigits:1});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function experimentUI(log,snapshot,onActiveRemoved){
 const panel=document.createElement('section');panel.className='experiment-panel';panel.id='experiment-records';
 panel.innerHTML=`<div class="experiment-heading"><div><h2>실험 기록과 비교</h2><p id="log-state" aria-live="polite">첫 기록을 기다리는 중</p></div><div class="log-actions"><button id="log-save">현재 기록 저장</button><button id="log-csv">전체 CSV</button><button id="log-delete">선택 기록 삭제</button></div></div><p class="log-error" id="log-error" role="status"></p><div class="log-selectors"><label>기록 보기<select id="log-a"></select></label><label>비교할 실험<select id="log-b"><option value="">비교 안 함</option></select></label></div><div class="log-delete-notice" id="log-delete-notice" role="status"></div><details class="log-cleanup"><summary>여러 기록 정리</summary><div class="log-cleanup-actions"><button id="log-select-all" type="button">전체 선택</button><button id="log-delete-many" type="button">선택 삭제</button><button id="log-undo" type="button" disabled>삭제 되돌리기</button></div><div id="log-cleanup-list"></div><p>현재 실험을 삭제하면 기록만 중단됩니다. ‘처음부터’를 누르면 새 기록을 시작합니다. 되돌리기는 최근 삭제 묶음에 한해 이 페이지를 떠나기 전까지 가능합니다.</p></details><div id="log-results"></div><details class="log-detail"><summary>설정값 · 변경 이력 · 시간별 데이터</summary><div id="log-detail-body"></div></details><p class="log-footnote">이 브라우저에 자동 저장 · 다른 기기와 동기화되지 않음 · 10초 간격 + 조건 변경·저장 시 기록. 고정 난수 시드이므로 같은 조건의 반복 실행은 통계적으로 독립된 반복 실험이 아닙니다.</p>`;
 panel.querySelector('.log-cleanup p').textContent='삭제한 기록은 브라우저 저장 기록에서 즉시 빠집니다. 현재 실험을 삭제하면 실행도 멈추며, 다음 재생은 0분부터 새 기록으로 시작합니다. 되돌리기용 사본은 최근 삭제 묶음 하나만 이 페이지를 떠나기 전까지 임시로 유지됩니다.';
 const controls=document.querySelector('.controls'),desk=controls.querySelector('.run-desk');
 // Match the complete left workspace card instead of calculating a separate viewport height.
 const workspace=document.querySelector('.workspace');
 const fitPanel=()=>{controls.style.setProperty('--workspace-height',`${Math.ceil(workspace.getBoundingClientRect().height)}px`);};
 const panelSizer=new ResizeObserver(fitPanel);panelSizer.observe(workspace);window.addEventListener('resize',fitPanel);fitPanel();
 controls.append(panel);panel.hidden=true;
 const tabs=document.createElement('div');tabs.className='experiment-tabs';tabs.setAttribute('role','group');tabs.setAttribute('aria-label','분석 패널 전환');
 tabs.innerHTML='<button type="button" id="show-settings" aria-pressed="true">조건 설정</button><button type="button" id="show-records" aria-pressed="false" aria-controls="experiment-records">실험 기록</button><button type="button" id="show-explore" aria-pressed="false" aria-controls="auto-explore">자동 탐색</button>';
 tabs.id='analysis-view-tabs';
 controls.querySelector('.control-header').after(tabs);
 let explorePanel=null;
 const showView=view=>{
  controls.classList.toggle('record-view',view==='records');controls.classList.toggle('explore-view',view==='explore');
  panel.hidden=view!=='records';if(explorePanel)explorePanel.hidden=view!=='explore';
  tabs.querySelector('#show-settings').setAttribute('aria-pressed',String(view==='settings'));
  tabs.querySelector('#show-records').setAttribute('aria-pressed',String(view==='records'));
  tabs.querySelector('#show-explore').setAttribute('aria-pressed',String(view==='explore'));
  controls.scrollTop=0;
 };
 tabs.querySelector('#show-settings').onclick=()=>showView('settings');tabs.querySelector('#show-records').onclick=()=>showView('records');tabs.querySelector('#show-explore').onclick=()=>showView('explore');
 document.addEventListener('show-scenario-settings',()=>showView('settings'));
 const badge=document.createElement('button');badge.className='log-jump';badge.type='button';desk.append(badge);badge.onclick=()=>{showView('records');controls.classList.add('is-open');document.body.classList.add('scenario-open');document.getElementById('scenario-toggle').setAttribute('aria-expanded','true');};
 const a=panel.querySelector('#log-a'),b=panel.querySelector('#log-b');let follow=true;const checked=new Set();
 a.onchange=()=>{follow=false;render();};b.onchange=render;
 const notice=message=>{panel.querySelector('#log-delete-notice').textContent=message;};
 const remove=ids=>{snapshot();const removedActive=Boolean(log.active&&ids.includes(log.active.id));if(removedActive)onActiveRemoved?.();const count=log.remove(ids);checked.clear();follow=false;notice(removedActive?`${count}개 기록을 삭제하고 실행을 멈췄습니다. 다음 재생은 0분부터 새 기록을 만듭니다.`:`${count}개 기록을 브라우저 저장 기록에서 삭제했습니다. ‘여러 기록 정리’에서 되돌릴 수 있습니다.`);render();};
 panel.querySelector('#log-delete').onclick=()=>remove([a.value]);
 panel.querySelector('#log-delete-many').onclick=()=>remove([...checked]);
 panel.querySelector('#log-select-all').onclick=()=>{const all=checked.size===log.runs.length;checked.clear();if(!all)for(const run of log.runs)checked.add(run.id);render();};
 panel.querySelector('#log-undo').onclick=()=>{const count=log.undoRemove();notice(`${count}개 기록을 복원했습니다. 삭제했던 현재 실험은 보관 기록으로 복원됩니다.`);render();};
 panel.querySelector('#log-cleanup-list').onchange=event=>{const id=event.target.dataset.runId;if(!id)return;if(event.target.checked)checked.add(id);else checked.delete(id);panel.querySelector('#log-delete-many').disabled=!checked.size;};
 panel.querySelector('#log-save').onclick=()=>{snapshot();log.save();render();};
 panel.querySelector('#log-csv').onclick=()=>{snapshot();log.save();const blob=new Blob([toCSV(log.runs)],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='walking-experiments.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);render();};
 const configNames={baselinePeople:'기준 인원 (명)',baselineFillRate:'자동 보충 (명/분)',inflowA:'북쪽 추가 유입 (명/분)',inflowB:'동·남쪽 추가 유입 (명/분)',entryGateMask:'진입 허용',exitGateMask:'퇴장 허용',analysisMinutes:'설정 실행 시간 (분, 0=무제한)',capacityDensity:'공간 비교 밀도 (명/㎡)',stallDepth:'매대 폭 (m)',walkSpeed:'보행 속도 (m/s)',mainToAlleyRate:'골목 진입 (%)',entryAvoidanceRate:'진입 회피 (%)',rightHandRate:'우측통행 (%)',peoplePer100M2:'건물 100㎡당 인원',buildingReleaseRate:'건물 유출 (%)',storeEntryRate:'점포 진입 (%)',storeDwellSeconds:'점포 체류 (초)',storeUsableRate:'영업공간 (%)',storeCapacityDensity:'점포 밀도 (명/㎡)',stallStopRate:'매대 구경 (%)',stallDwellSeconds:'구경 시간 (초)',setback:'가장자리 제외 폭 (m)'};
 const val=(key,v)=>key.endsWith('GateMask')?['A','C','D','R','S'].filter((_,i)=>v&(1<<i)).join(' · '):fmt(v);
 const table=(heads,rows)=>`<div class="log-table-wrap"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 function render(){
  const selected=a.value,compare=b.value;const options=log.runs.map(r=>`<option value="${esc(r.id)}">${esc(r.name)} · ${fmt(summary(r).duration/60)}분${r===log.active?(r.status==='completed'?' · 완료':' · 현재'):''}</option>`).join('');a.innerHTML=options;b.innerHTML='<option value="">비교 안 함</option>'+options;
  a.value=follow?(log.active?.id||log.runs.at(-1)?.id||''):selected;if(!a.value&&log.runs.length)a.value=log.runs.at(-1).id;b.value=compare;
  const left=log.runs.find(r=>r.id===a.value),right=log.runs.find(r=>r.id===b.value);
  badge.textContent=`실험 기록 ${log.runs.length}개 · ${log.active?(log.active.status==='completed'?'실행 완료':'자동 기록 중'):'기록 보기'}`;
  panel.querySelector('#log-state').textContent=log.active?`${log.active.name} · ${log.active.status==='completed'?'실행 완료':'자동 기록'} · ${log.active.samples.length}개 시점`:`보관된 실험 ${log.runs.length}개`;
  panel.querySelector('#log-error').textContent=log.error;
  panel.querySelector('#log-csv').disabled=!log.runs.length;
  panel.querySelector('#log-delete').disabled=!left;
  panel.querySelector('#log-save').disabled=!log.active;
  panel.querySelector('#log-delete-many').disabled=!checked.size;
  panel.querySelector('#log-undo').disabled=!log.deleted?.length;
  panel.querySelector('#log-select-all').disabled=!log.runs.length;
  panel.querySelector('#log-select-all').textContent=checked.size&&checked.size===log.runs.length?'선택 해제':'전체 선택';
  panel.querySelector('#log-cleanup-list').innerHTML=log.runs.map(run=>`<label><input type="checkbox" data-run-id="${esc(run.id)}" ${checked.has(run.id)?'checked':''}><span>${esc(run.name)} · ${fmt(summary(run).duration/60)}분${run===log.active?' · 현재 실험':''}</span></label>`).join('');
  if(!left){panel.querySelector('#log-results').textContent='보관된 기록이 없습니다. 처음부터 실행하면 새 기록이 쌓입니다.';panel.querySelector('#log-detail-body').replaceChildren();return;}
  const selectedRuns=right&&right!==left?[left,right]:[left];const summaries=selectedRuns.map(summary);
  const metrics=[['실제 실행 시간 (분)',x=>fmt(x.duration/60)],['최대 구간 인원 (명)',x=>fmt(x.peakInside)],['최대 전체 대기 (명)',x=>fmt(x.peakWaiting)],['누적 구간 진입 (회)',x=>fmt(x.entries)],['누적 구간 이탈 (회)',x=>fmt(x.exits)],['분석영역 기준 초과 (초)',x=>fmt(x.exceedSeconds)],['중간 조건 변경 (회)',x=>fmt(x.changes)]];
  let warning='';if(right&&right!==left){if(Math.abs(summaries[0].duration-summaries[1].duration)>1)warning+='실행 시간이 다릅니다. 누적 인원을 단순 비교하지 마세요. ';if(summaries.some(s=>s.changes))warning+='중간 조건 변경이 포함된 실험입니다. ';if(left.modelVersion!==right.modelVersion||JSON.stringify(left.source)!==JSON.stringify(right.source))warning+='모형 또는 원본 자료가 다릅니다. ';}
  const plot=run=>{const samples=run.samples,max=Math.max(1,...samples.map(s=>Math.max(s.inside,s.waiting))),end=Math.max(1,samples.at(-1)?.time||0);const points=key=>samples.filter((_,i)=>i%Math.max(1,Math.ceil(samples.length/400))===0||i===samples.length-1).map(s=>`${(32+s.time/end*500).toFixed(1)},${(132-s[key]/max*110).toFixed(1)}`).join(' ');return `<div class="log-chart"><b>${esc(run.name)}</b><svg viewBox="0 0 560 165" role="img" aria-label="${esc(run.name)} 시간별 구간 인원과 전체 대기 변화"><path d="M32 20 V132 H535" fill="none" stroke="#bcc8d8"/><text x="2" y="26">${fmt(max)}</text><text x="14" y="135">0</text><text x="32" y="155">0분</text><text x="470" y="155">${fmt(end/60)}분</text><polyline points="${points('inside')}" fill="none" stroke="#2458d3" stroke-width="2.5"/><polyline points="${points('waiting')}" fill="none" stroke="#b45f10" stroke-width="2.5"/></svg><small><span style="color:#2458d3">파랑: 구간 인원</span> · <span style="color:#b45f10">주황: 전체 대기</span> · 단위 명</small></div>`;};
  panel.querySelector('#log-results').innerHTML=(warning?`<p class="log-warning">${esc(warning)}</p>`:'')+table(['결과',...selectedRuns.map(r=>r.name)],metrics.map(([title,get])=>[title,...summaries.map(get)]))+`<div class="log-charts">${selectedRuns.map(plot).join('')}</div>`;
  panel.querySelector('#log-detail-body').innerHTML=table(['시작 조건',...selectedRuns.map(r=>r.name)],Object.keys(left.initialConfig).map(k=>[configNames[k]||k,...selectedRuns.map(r=>val(k,r.initialConfig[k]))]))+selectedRuns.map(run=>`<h3>${esc(run.name)} · ${esc(new Date(run.createdAt).toLocaleString('ko-KR'))}</h3><p>직접 제외한 공간: 시작 ${run.initialExcluded.length}칸 · 시드 ${run.seed} · ${run.status==='interrupted'?'이전 접속에서 중단됨':run===log.active?'기록 중':'보관됨'}</p>${table(['변경 시각 (초)','바뀐 값'],run.events.map((e,i)=>{const old=i?run.events[i-1].config:run.initialConfig;return [fmt(e.time),Object.keys(e.config).filter(k=>e.config[k]!==old[k]).map(k=>`${configNames[k]||k}: ${val(k,old[k])} → ${val(k,e.config[k])}`).join(' / ')+` · 제외공간 ${e.excluded.length}칸`];}))}<p>최근 20개 시점 · 전체 시점·구간별 밀도·제외공간 좌표 인덱스는 CSV에 포함됩니다.</p>${table(['초','구간 인원','전체 대기','진입 누적','이탈 누적'],run.samples.slice(-20).map(s=>[fmt(s.time),s.inside,s.waiting,s.entries,s.exits]))}`).join('');
 }
 render();return {render,newRun(){follow=true;render();},attachExplore(element){explorePanel=element;controls.append(element);element.hidden=true;},showView};
}
