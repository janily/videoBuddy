import {readFile,writeFile} from 'node:fs/promises';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {loadVerifiedFilmPackage} from '../../src/contracts/video/film-package';
import {selectPreviewExcerpt} from '../../src/services/video/preview/select-excerpt';
import {preparePreviewExcerptStage} from '../../src/services/video/preview/excerpt-stage';
import type {ProjectControl} from '../../src/contracts/video/project';
import {probeEnvironment} from './helpers/real-probe';
import {technicalVideoQa} from '../../src/services/video/media/technical-qa';
import {join} from 'node:path';
async function main(){
 if(!process.argv.includes('--excerpt'))throw Error('SELECTED_EXCERPT_OPT_IN_REQUIRED');
 const native=JSON.parse(await readFile('docs/engineering/evidence/native-package-probe.json','utf8')),projects=new ProjectStore(new FileStore(native.root)),prefix='projects/'+native.projectId;
 const raw=await readNarrationJson(projects.store,native.film.filmSpecRef,prefix+'/revisions/'+native.revisionId+'/film/'),frozen=await loadVerifiedFilmPackage(projects.store,raw,native.root),control=(await projects.store.readFresh<ProjectControl>(prefix+'/control')).value;
 if(!control.activeProduction)throw Error('SELECTED_EXCERPT_OPERATION_MISSING');
 const segments=selectPreviewExcerpt(frozen.timeline,frozen.facts.facts.filter(fact=>fact.critical||fact.mustInclude).map(fact=>fact.id));
 const fetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('SELECTED_EXCERPT_NETWORK_FORBIDDEN')};
 try{
  const options={root:native.root,env:probeEnvironment(native.root)},record=await preparePreviewExcerptStage(projects,native.projectId,native.revisionId,control.activeProduction,control.consentEpoch,frozen.treatment.planRef,segments,options);
  const replay=await preparePreviewExcerptStage(projects,native.projectId,native.revisionId,control.activeProduction,control.consentEpoch,frozen.treatment.planRef,segments,options);
  if(JSON.stringify(record)!==JSON.stringify(replay))throw Error('SELECTED_EXCERPT_REPLAY_CHANGED');
  const historical=JSON.parse(await readFile('docs/engineering/evidence/selected-excerpt-probe.json','utf8'));let historicalMonoRejected=false;
  try{await technicalVideoQa(join(native.root,'preview',historical.record.stageKey),options.env.VIDEO_MEDIA_IMAGE_REF!,'output/preview.mp4',{width:1280,height:720,durationSec:11,fps:24,audio:true,audioChannels:2})}catch(error){if((error as Error).message!=='QA_FAILED: media metadata')throw error;historicalMonoRejected=true}
  if(record.audioChannels!==2||record.technicalQa.audioChannels!==2||!historicalMonoRejected)throw Error('SELECTED_EXCERPT_STEREO_FAILED');
  const evidence={executedAt:new Date().toISOString(),status:'pass',sourceFilmSpecSha256:native.film.filmSpecRef.sha256,sourceFilmSha256:native.composite.technicalQa.sha256,segments,record,replayIdentical:true,historicalMonoRejected,additionalModelCalls:0,limits:'Real frozen native stereo movie excerpt; old mono artifact independently rejected by actual channel QA. Only technical QA, sentence/caption-safe selection and private artifact staging; no published user preview, approval, final semantic or listening quality pass.'};
  await writeFile('docs/engineering/evidence/stereo-selected-excerpt-probe.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:'pass',durationMs:record.durationMs,sha256:record.previewArtifactSha256,qa:record.technicalQa,segments}));
 }finally{globalThis.fetch=fetch}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
