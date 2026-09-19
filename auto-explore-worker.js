import {runExploreJob} from './auto-explore-runner.js';

let scene=null;

self.onmessage=event=>{
  const data=event.data??{};
  if(data.type==='init'){
    scene=data.scene;
    self.postMessage({type:'ready'});
    return;
  }
  if(data.type!=='run'||!scene)return;
  try{
    self.postMessage({type:'result',result:runExploreJob(scene,data.job,data.excluded??[],data.durationSeconds)});
  }catch(error){
    self.postMessage({type:'result',result:{id:data.job?.id,seed:data.job?.seed,varied:data.job?.varied,error:error?.message??String(error)}});
  }
};
