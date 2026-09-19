import {WalkSimulation} from './network-simulation.js';

function snapshotSections(stats,peaks){
  for(const section of [...stats.capacitySections,...stats.connectorCapacitySections]){
    const previous=peaks.get(section.name)??{...section,peakOccupancy:0,peakUsePercent:0};
    const use=section.occupancyCapacity?section.currentOccupancy/section.occupancyCapacity*100:0;
    if(section.currentOccupancy>previous.peakOccupancy)previous.peakOccupancy=section.currentOccupancy;
    if(use>previous.peakUsePercent)previous.peakUsePercent=use;
    peaks.set(section.name,previous);
  }
}

export function runExploreJob(scene,job,excluded=[],durationSeconds=300){
  const sim=new WalkSimulation(scene,job.config,excluded,{
    seed:job.seed,
    demandSeed:job.seed,
    behaviourSeed:(job.seed^0x5f3759df)>>>0
  });
  const dt=.1,totalSteps=Math.ceil(durationSeconds/dt),peaks=new Map();
  snapshotSections(sim.stats(),peaks);
  for(let step=0;step<totalSteps;step++){
    sim.update(dt);
    if(step%50===49||step===totalSteps-1)snapshotSections(sim.stats(),peaks);
  }
  const stats=sim.stats();
  const mainSection=stats.capacitySections[0];
  const flowUsePercent=mainSection?.flowCapacityPerMinute?stats.studyDemandPerMinute/mainSection.flowCapacityPerMinute*100:0;
  const dominantSection=[...peaks.values()].sort((a,b)=>b.peakUsePercent-a.peakUsePercent||b.peakOccupancy-a.peakOccupancy)[0]??null;
  const finalWaiting=stats.waitingOutside+stats.waitingApproach+stats.waitingStores+stats.waitingStoreEntry;
  return {
    id:job.id,
    seed:job.seed,
    varied:job.varied,
    elapsedSeconds:stats.elapsedSeconds,
    peakInside:stats.peakInside,
    referenceCapacity:stats.referenceCapacity,
    capacityExceedSeconds:stats.capacityExceedSeconds,
    capacityUsePercent:stats.capacityUsePercent,
    studyDemandPerMinute:stats.studyDemandPerMinute,
    flowCapacityPerMinute:mainSection?.flowCapacityPerMinute??0,
    flowUsePercent,
    peakWaiting:stats.peakWaiting,
    finalWaiting,
    finalWaitingOutside:stats.waitingOutside,
    finalWaitingApproach:stats.waitingApproach,
    finalWaitingStores:stats.waitingStores,
    finalWaitingStoreEntry:stats.waitingStoreEntry,
    studyEntries:stats.studyEntries,
    completed:stats.completed,
    networkExited:stats.networkExited,
    averageTravelSeconds:stats.averageTravelSeconds,
    peakLocalDensity:stats.peakLocalDensity,
    demandDigest:stats.demandDigest,
    dominantSection:dominantSection?{
      name:dominantSection.name,
      peakOccupancy:dominantSection.peakOccupancy,
      occupancyCapacity:dominantSection.occupancyCapacity,
      peakUsePercent:dominantSection.peakUsePercent,
      minimumEffectiveWidthM:dominantSection.minimumEffectiveWidthM,
      flowCapacityPerMinute:dominantSection.flowCapacityPerMinute
    }:null
  };
}
