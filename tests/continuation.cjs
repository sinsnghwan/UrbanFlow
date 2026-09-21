// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package.
// --live verifies the published assets; test state is confined to a fresh browser.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const origin='https://urbanflow.sumpyo.kr';
const live=process.argv.includes('--live');

// Expose state only in this test's intercepted module. Production has no test API.
// Move the clock to the boundary after building a real crowd, then use the real
// animation loop to finish. This exercises completion without a 30-minute wait.
const hook=`
window.continuationTest={
  freeze(){cancelAnimationFrame(raf);},
  advance(seconds){for(let i=0;i<seconds*10;i++){accumulator=.1;lastTime=0;animate(performance.now());cancelAnimationFrame(raf);}updateMetrics();updatePlaybackControls();},
  complete(){sim.time=sim.config.analysisMinutes*60-.1;running=true;accumulator=.1;lastTime=0;animate(performance.now());cancelAnimationFrame(raf);},
  snapshot(){return {
    running,config:{...sim.config},runId:experiments.active?.id,runCount:experiments.runs.length,status:experiments.active?.status,
    events:structuredClone(experiments.active?.events),samples:structuredClone(experiments.active?.samples),
    state:{time:sim.time,agents:sim.agents.map(a=>({id:a.id,cell:a.cell,insideStore:a.insideStore,route:a.route})),
      queues:structuredClone(sim.queues),exits:structuredClone(sim.exits),completedTrips:[...sim.completedTrips],
      serial:sim.serial,arrivals:sim.arrivals,studyEntries:sim.studyEntries,extraRequested:sim.extraRequested,
      peakInside:sim.peakInside,peakWaiting:sim.peakWaiting,seed:sim.seed,demandSeed:sim.demandSeed}}
  }
};
`;

(async()=>{
  const browser=await chromium.launch({args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route(`${origin}/**`,async route=>{
      const name=new URL(route.request().url()).pathname.slice(1)||'index.html';
      if(live){
        if(name!=='app.js')return route.continue();
        const response=await route.fetch();
        assert.equal(response.status(),200);
        return route.fulfill({response,body:await response.text()+hook});
      }
      const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
      const contents=await fs.readFile(path.join(root,name));
      return route.fulfill({body:name==='app.js'?contents.toString()+hook:contents,contentType:types[path.extname(name)]});
    });
    await page.goto(origin);
    await page.waitForFunction(()=>window.continuationTest);
    await page.evaluate(()=>window.continuationTest.freeze());
    const snapshot=()=>page.evaluate(()=>window.continuationTest.snapshot());
    const click=id=>page.evaluate(id=>document.getElementById(id).click(),id);
    const edit=async (values,resume=false)=>page.evaluate(({values,resume})=>{
      for(const [id,value]of Object.entries(values)){
        const control=document.getElementById(id);
        if(control.tagName==='SELECT'&&![...control.options].some(option=>option.value===String(value)))control.add(new Option(`${value}분`,String(value)));
        control.value=String(value);control.dispatchEvent(new Event('input'));
      }
      if(resume)document.getElementById('play').click();
    },{values,resume});
    await edit({'analysis-minutes':30,'inflow-a':10000,'inflow-b':10000},true);
    await page.evaluate(()=>window.continuationTest.advance(2));
    const started=await snapshot();
    assert.equal(started.running,true);
    assert.ok(started.state.agents.length>0);
    assert.ok(Object.values(started.state.queues).some(queue=>queue.length>0),'Regression needs a nonempty queue');

    // Ordinary pause/change/resume must preserve people, queues, time and run ID.
    await click('play');
    const paused=await snapshot();
    assert.equal(paused.running,false);
    await edit({'inflow-a':300},true);
    const resumed=await snapshot();
    assert.equal(resumed.runId,paused.runId);
    assert.deepEqual(resumed.state,paused.state);
    assert.equal(resumed.config.inflowA,300);
    assert.equal(resumed.config.analysisMinutes,30);

    await page.evaluate(()=>window.continuationTest.complete());
    const completed=await snapshot();
    assert.equal(completed.status,'completed');
    assert.equal(completed.running,false);
    assert.ok(Math.abs(completed.state.time-1800)<1e-6);
    assert.equal(await page.locator('#run-continuation').isVisible(),true);
    assert.match(await page.locator('#play').innerText(),/이어서 실행/);
    assert.match(await page.locator('#continuation-range').innerText(),/총 60분/);

    // Check the new controls at the narrow sidebar and mobile breakpoints.
    for(const width of [1440,1024,851,390,320]){
      await page.setViewportSize({width,height:1000});
      if(width<=850)await click('scenario-toggle');
      const layout=await page.locator('.run-desk').evaluate(desk=>{
        const bounds=desk.getBoundingClientRect();
        return [...desk.querySelectorAll('button,select,label,p')].filter(el=>el.getClientRects().length).flatMap(el=>{
          const box=el.getBoundingClientRect();
          return box.left<bounds.left-1||box.right>bounds.right+1||el.scrollWidth>el.clientWidth+1?[el.id||el.tagName]:[];
        });
      });
      assert.deepEqual(layout,[],`Controls overflow at ${width}px`);
      if(width<=850)await click('scenario-close');
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('.run-desk').screenshot({path:`/tmp/urbanflow-continuation-${live?'live':'preview'}.png`});

    // Immediate play must flush the input debounce and continue the same crowd.
    await edit({'inflow-a':0,'inflow-b':0},true);
    const extended=await snapshot();
    assert.equal(extended.running,true);
    assert.equal(extended.status,'recording');
    assert.equal(extended.runId,completed.runId);
    assert.equal(extended.runCount,completed.runCount);
    assert.deepEqual(extended.state,completed.state);
    assert.equal(extended.config.analysisMinutes,60);
    assert.equal(extended.config.inflowA,0);
    assert.equal(extended.config.inflowB,0);
    assert.equal(await page.locator('#run-continuation').isVisible(),false);
    assert.equal(await page.locator('[data-config-key="analysisMinutes"]').inputValue(),'60');
    assert.equal(extended.events.at(-1).time,1800);
    assert.equal(extended.events.at(-1).config.analysisMinutes,60);
    assert.deepEqual(extended.samples.slice(0,-1),completed.samples.slice(0,-1));
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('walk-experiments-v1')));
    assert.equal(saved.at(-1).id,completed.runId);
    assert.equal(saved.at(-1).status,'recording');

    await page.evaluate(()=>window.continuationTest.advance(1));
    assert.ok((await snapshot()).state.time>1800);
    await page.evaluate(()=>window.continuationTest.complete());
    const twiceCompleted=await snapshot();
    await page.selectOption('#continuation-minutes','10');
    await click('play');
    const twiceExtended=await snapshot();
    assert.equal(twiceExtended.config.analysisMinutes,70);
    assert.equal(twiceExtended.runId,completed.runId);
    assert.deepEqual(twiceExtended.state,twiceCompleted.state);

    // Raising the total manually resumes to that total without an extra interval.
    await page.evaluate(()=>window.continuationTest.complete());
    await edit({'analysis-minutes':120},true);
    assert.equal((await snapshot()).config.analysisMinutes,120);
    assert.equal((await snapshot()).runId,completed.runId);

    // Map editing after completion must use the same extension path.
    await page.evaluate(()=>window.continuationTest.complete());
    await click('edit-space');
    const beforeEditResume=await snapshot();
    await click('play');
    assert.equal((await snapshot()).config.analysisMinutes,130);
    assert.deepEqual((await snapshot()).state,beforeEditResume.state);
    assert.equal(await page.locator('#edit-space').getAttribute('aria-pressed'),'false');

    // Unlimited continuation and the existing maximum duration both work.
    await page.evaluate(()=>window.continuationTest.complete());
    await page.selectOption('#continuation-minutes','0');
    await click('play');
    assert.equal((await snapshot()).config.analysisMinutes,0);
    assert.equal((await snapshot()).runId,completed.runId);
    await click('play');
    await edit({'analysis-minutes':10080},true);
    await page.evaluate(()=>window.continuationTest.complete());
    assert.equal(await page.locator('#continuation-minutes').inputValue(),'0');
    assert.equal(await page.locator('#continuation-minutes option[value="10"]').isDisabled(),true);
    await click('play');
    assert.equal((await snapshot()).config.analysisMinutes,0);

    // An explicit restart still creates a fresh run from time zero.
    await click('play');
    await click('reset');
    const reset=await snapshot();
    assert.equal(reset.state.time,0);
    assert.notEqual(reset.runId,completed.runId);
    assert.equal(reset.runCount,completed.runCount+1);
    assert.equal(await page.locator('#play').innerText(),'시뮬레이션 시작');
    assert.deepEqual(errors,[]);
    console.log(`PASS (${live?'live':'preview'}): paused/ended continuation, crowd and queues, history, immediate edits, repeated/custom/unlimited extension, map edit, duration bound, explicit restart, 5 responsive widths.`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
