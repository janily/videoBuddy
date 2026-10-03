import {readFile,writeFile,realpath,cp,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,relative,isAbsolute,join} from 'node:path';
import type {ObjectRef} from '../../src/contracts/video/domain';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {prepareNarrationPackageStage} from '../../src/services/video/preview/narration-package-stage';
import {prepareAudioExecutionStage} from '../../src/services/video/preview/audio-execution-stage';
import {prepareFilmPackageStage} from '../../src/services/video/preview/film-package-stage';
import {loadVerifiedFilmPackage} from '../../src/contracts/video/film-package';
import {prepareCompositeStage} from '../../src/services/video/preview/composite-stage';
import {loadAudioExecution} from '../../src/services/video/audio/execution-package';
import {probeEnvironment} from './helpers/real-probe';
async function main(){
 if(!process.argv.includes('--package'))throw Error('NATIVE_PACKAGE_OPT_IN_REQUIRED');
 const creation=JSON.parse(await readFile('docs/engineering/evidence/real-creation-no-voice-probe.json','utf8')),root=await realpath(creation.root),rel=relative(await realpath(resolve('.video-local/real-creation')),root);
 if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('NATIVE_PACKAGE_BASELINE_REQUIRED');
 const projects=new ProjectStore(new FileStore(root)),{projectId,revisionId,operationId}=creation.stages.project,env=probeEnvironment(root),treatmentRef=creation.stages.treatment.treatmentRef as ObjectRef;
 const saved=globalThis.fetch;globalThis.fetch=async()=>{throw Error('NATIVE_PACKAGE_NETWORK_FORBIDDEN')};
 const cold=await mkdtemp(join(tmpdir(),'vb-native-package-cold-'));
 try{
  await prepareNarrationPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env});
  const audio=await prepareAudioExecutionStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env});
  const film=await prepareFilmPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env});
  const spec=(await projects.store.readFresh(film.filmSpecRef.key)).value;
  const loaded=await loadVerifiedFilmPackage(projects.store,spec,root);
  if(!loaded.audioExecution||!loaded.filmAudioTrack||loaded.audioExecution.tracks.voice.wav.peakDbfs!==null||loaded.timeline.music.length!==15||loaded.timeline.foley.length!==7)throw Error('NATIVE_PACKAGE_OUTPUT_CHANGED');
  if(JSON.stringify(await prepareFilmPackageStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env,mustExist:true}))!==JSON.stringify(film))throw Error('NATIVE_PACKAGE_REPLAY_CHANGED');
  // A cold read from only durable objects proves that working media is not needed by the package loader.
  await mkdir(join(cold,'objects'),{recursive:true});await cp(join(root,'objects'),join(cold,'objects'),{recursive:true});
  await mkdir(join(cold,'projects'),{recursive:true});await cp(join(root,'projects',projectId),join(cold,'projects',projectId),{recursive:true});
  const independentlyLoaded=await loadVerifiedFilmPackage(new FileStore(cold),spec,cold);
  if(independentlyLoaded.filmAudioTrack?.wav.sha256!==loaded.filmAudioTrack.wav.sha256)throw Error('NATIVE_PACKAGE_COLD_CHANGED');
  let composite;
  if(process.argv.includes('--compose')){
   composite=await prepareCompositeStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env,profile:'preview'});
   const replay=await prepareCompositeStage(projects,projectId,revisionId,operationId,0,treatmentRef,{root,env,profile:'preview'});
   if(composite.audioExecutionSha256!==audio.packageRef.sha256||composite.audioPlanSha256!==loaded.audioManifest.planRef.sha256||composite.technicalQa.audioChannels!==2||composite.loudness.status!=='pass'||composite.postMix.status!=='not_applicable'||!('reason' in composite.postMix)||composite.postMix.reason!=='no_narration'||JSON.stringify(composite)!==JSON.stringify(replay))throw Error('NATIVE_PACKAGE_COMPOSITION_CHANGED');
  }
  const music=loaded.audioExecution.tracks.music.audioRef,path=join(cold,'objects',music.key);await writeFile(path,'deliberately corrupted');
  let tamperRejected=false;try{await loadVerifiedFilmPackage(new FileStore(cold),spec,cold)}catch{tamperRejected=true}
  if(!tamperRejected)throw Error('NATIVE_PACKAGE_TAMPER_ACCEPTED');
  await loadAudioExecution(projects.store,root,projectId,revisionId,audio.packageRef,loaded.audioManifest.planRef,loaded.audioManifest.timingDraftRef);
  const evidence={executedAt:new Date().toISOString(),status:'pass',root,projectId,revisionId,actualModelVisualAndAudio:true,additionalModelCalls:0,film,audio,outputTarget:loaded.filmSpec.output,audioSources:loaded.audioManifest.sources.length,musicEvents:loaded.timeline.music.length,foleyEvents:loaded.timeline.foley.length,tracks:loaded.audioExecution.tracks,...(composite?{composite}:{}),qualityPolicy:(await projects.store.readFresh(film.qualityPolicyRef.key)).value,coldObjectsOnlyRead:true,tamperRejected,replayIdentical:true,limits:'Actual frozen native model creation and executed offline stereo audio now form an independently readable FilmSpec. Cold copy includes only durable JSON state and byte objects; no workfiles, model or render re-execution. Optional 720p Composite stage verifies bound stereo master and ASR applicability, no final quality, user preview/approval, 1080p render, listening/style or 43-style baseline claim.'};
  await writeFile('docs/engineering/evidence/native-package-probe.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({status:'pass',filmSha256:film.filmSpecRef.sha256,audioExecutionSha256:audio.packageRef.sha256,coldObjectsOnlyRead:true,tamperRejected,musicEvents:15,foleyEvents:7,additionalModelCalls:0,composite:composite?{technicalQa:composite.technicalQa,loudness:composite.loudness,postMix:composite.postMix}:null}));
 }finally{globalThis.fetch=saved;await rm(cold,{recursive:true,force:true})}
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:String(error?.message||'NATIVE_PACKAGE_FAILED').replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,250)}));process.exitCode=1});
