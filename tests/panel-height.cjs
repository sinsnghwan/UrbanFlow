// PLAYWRIGHT_MODULE=/path/to/playwright node tests/panel-height.cjs [--live]
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const live=process.argv.includes('--live');
const origin='https://urbanflow.sumpyo.kr';

(async()=>{
  const browser=await chromium.launch({args:['--no-sandbox']});
  try{
    const page=await browser.newPage(),errors=[],results=[];
    page.on('pageerror',error=>errors.push(error.message));
    if(!live)await page.route(`${origin}/**`,async route=>{
      const file=new URL(route.request().url()).pathname.slice(1)||'index.html';
      const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json'};
      await route.fulfill({body:await fs.readFile(path.join(__dirname,'..',file)),contentType:types[path.extname(file)]});
    });
    const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
    const measure=()=>page.evaluate(()=>{
      const workspace=document.querySelector('.workspace'),controls=document.querySelector('.controls');
      const rect=workspace.getBoundingClientRect();
      return {workspace:rect.height,controls:controls.getBoundingClientRect().height,main:document.querySelector('main').getBoundingClientRect().height,
        blank:rect.bottom-workspace.lastElementChild.getBoundingClientRect().bottom,
        scrollTop:controls.scrollTop,maxScroll:controls.scrollHeight-controls.clientHeight};
    });
    const folds=page.locator('.result-details>.disclosure');
    for(const viewport of [{width:1440,height:1000},{width:1024,height:768},{width:851,height:900}]){
      await page.setViewportSize(viewport);
      await page.goto(origin);
      await page.waitForFunction(()=>!document.getElementById('play').disabled&&document.querySelector('.population-table'));
      await settle();
      const baseline=await measure();
      assert.ok(baseline.blank<3,JSON.stringify(baseline));
      const restores=async label=>{
        await settle();
        const collapsed=await measure();
        for(const key of ['workspace','controls','main'])assert.ok(Math.abs(collapsed[key]-baseline[key])<1.1,`${viewport.width}px ${label}: ${key} stayed enlarged: ${JSON.stringify({baseline,collapsed})}`);
        assert.ok(collapsed.blank<3,`White space remains: ${JSON.stringify(collapsed)}`);
        assert.ok(collapsed.scrollTop<=collapsed.maxScroll+1);
        return collapsed;
      };
      // Reproduce: expand, scroll down, then collapse each section.
      for(let index=0;index<3;index++){
        await folds.nth(index).locator(':scope>summary').click();
        await settle();
        const expanded=await measure();
        assert.ok(expanded.workspace>baseline.workspace+50);
        assert.ok(Math.abs(expanded.workspace-expanded.controls)<1.1);
        await page.evaluate(()=>{window.scrollTo(0,document.body.scrollHeight);const c=document.querySelector('.controls');c.scrollTop=c.scrollHeight;});
        await folds.nth(index).locator(':scope>summary').click();
        await restores(`section ${index}`);
      }
      // Include nested content and repeated expansion in every sidebar tab.
      for(const tab of ['show-settings','show-records','show-explore']){
        await page.evaluate(tab=>document.getElementById(tab).click(),tab);
        await folds.evaluateAll(nodes=>nodes.forEach(node=>{node.open=true;node.querySelectorAll('details').forEach(child=>child.open=true);}));
        await settle();
        await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
        await folds.evaluateAll(nodes=>nodes.forEach(node=>{node.open=false;node.querySelectorAll('details').forEach(child=>child.open=false);}));
        await restores(tab);
      }
      await page.evaluate(()=>document.getElementById('show-settings').click());
      await page.evaluate(()=>window.scrollTo(0,0));
      if(viewport.width===1440)await page.screenshot({path:`/tmp/urbanflow-panel-collapse-${live?'live':'preview'}.png`,fullPage:true});
      results.push({viewport,...await restores('final')});
    }
    // Crossing the mobile breakpoint must not leave a stale desktop height.
    await page.setViewportSize({width:390,height:844});
    await page.locator('#scenario-toggle').click();
    await settle();
    assert.ok((await measure()).controls<=844*.72+1);
    await page.locator('#scenario-close').click();
    await folds.evaluateAll(nodes=>nodes.forEach(node=>node.open=true));
    await settle();
    await folds.evaluateAll(nodes=>nodes.forEach(node=>node.open=false));
    await page.setViewportSize({width:1440,height:1000});
    await settle();
    const returned=await measure();
    assert.ok(Math.abs(returned.workspace-results[0].workspace)<1.1,JSON.stringify(returned));
    assert.ok(Math.abs(returned.controls-returned.workspace)<1.1);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({mode:live?'live':'preview',results,returned,errors},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
