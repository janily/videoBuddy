import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {SourceCodeSchema,loadVerifiedFilmPackage,CaptionPackageSchema} from '../../src/contracts/video/film-package';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {readPublishedPreview} from '../../src/services/video/preview/commit';
import type {MediaJobHandle} from '../../src/services/video/media/executor';
import {DockerExecutor,computeStageKey} from '../../src/services/video/media/docker-executor';
import {technicalVideoQa} from '../../src/services/video/media/technical-qa';
import {assemblePictureSequence,type PictureClip} from '../../src/services/video/media/picture-sequence';
import {composeVideo} from '../../src/services/video/media/compose';
import {verifyPostMixNarration} from '../../src/services/video/audio/postmix-asr';
import {resolvePreviewPostMixReview} from '../../src/services/video/preview/postmix-review';
import {validateNarrationPolicySource} from '../../src/services/video/audio/narration-policy';
import {wholeFilmVisualPlan} from '../../src/services/video/quality/whole-visual-plan';
import {extractVisualFrames,readVisualEvidence,type VisualEvidence} from '../../src/services/video/quality/visual-evidence';
import {observeProbePicture} from './helpers/probe-picture';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--verify-clear-1080p-technical-film')throw Error('CLEAR_FULL_FILM_FLAG_REQUIRED');
 const published=JSON.parse(await readFile('docs/engineering/evidence/clear-frozen-preview-continuation-probe.json','utf8'));
 if(published.status!=='preview_published'||published.operation.status!=='succeeded')throw Error('CLEAR_FULL_FILM_SOURCE_REQUIRED');
 const {root:sourceRoot,projectId,operation}=published,store=new FileStore(sourceRoot),projects=new ProjectStore(store),prefix=`projects/${projectId}/`,keys=[prefix+'control',prefix+'budget',prefix+'operations/'+operation.id,prefix+'operations/'+published.sourceOperationId],before=await Promise.all(keys.map(async key=>canonicalHash((await store.readFresh(key)).value))),path='docs/engineering/evidence/clear-full-film-technical-probe.json',journalOperationId=randomUUID(),journal={store,prefix:prefix+`operations/${journalOperationId}/media-effects`},report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',sourceRoot,projectId,sourceOperationId:operation.id,journalOperationId,newModelCalls:0,formalProductionApproval:false,resultPublished:false,deliveryEligible:false};await claimProbeReport(path,report);
 globalThis.fetch=async()=>{throw Error('CLEAR_FULL_FILM_NETWORK_FORBIDDEN')};
 async function assertSource(){if(canonicalHash(before)!==canonicalHash(await Promise.all(keys.map(async key=>canonicalHash((await store.readFresh(key)).value)))))throw Error('CLEAR_FULL_FILM_SOURCE_CHANGED');await projects.access('new-theme-validation',projectId)}
 async function save(){await persistProbeReport(path,report)}
 try{
  const bundle=await readPublishedPreview(projects,projectId,operation.id,operation.consentEpoch,operation.previewId,sourceRoot),revisionPrefix=prefix+`revisions/${bundle.revisionId}/`,frozen=await loadVerifiedFilmPackage(store,await readNarrationJson(store,bundle.filmSpecRef,revisionPrefix+'film/'),sourceRoot),spec=frozen.filmSpec;
  if(spec.qualityPolicyVersion!=='v5.1-package-4-clear-book-captions'||spec.output.width!==1920||spec.output.height!==1080||!frozen.filmAudioTrack)throw Error('CLEAR_FULL_FILM_SOURCE_CHANGED');
  // A nested exclusive root keeps new render inputs/caches separate. It also
  // places the technical movie within the original private composition root,
  // allowing the standing same-source voice policy to recheck actual bytes.
  const parent=join(sourceRoot,'composition');await mkdir(parent,{recursive:true,mode:0o700});if(await realpath(parent)!==parent)throw Error('CLEAR_FULL_FILM_PATH_CHANGED');const root=await mkdtemp(join(parent,'clear-full-'));report.root=root;report.bundle=bundle;await save();
  const digest=spec.runtimeDigest,env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+digest,VIDEO_MEDIA_RUNTIME_DIGEST:digest,VIDEO_MEDIA_TIMEOUT_SECONDS:'600',VIDEO_ASR_IMAGE_REF:'sha256:caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4',VIDEO_ASR_RUNTIME_DIGEST:'caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4',VIDEO_ASR_MODEL:'Systran/faster-whisper-medium'},executor=new DockerExecutor(root,env),{width,height,fps,totalFrames}=spec.output,shots:PictureClip[]=[],handles:MediaJobHandle[]=[];
  report.handles=handles;report.shots=shots;
  for(const [index,shot] of frozen.timeline.shots.entries()){
   await assertSource();const sourceModule=frozen.sourceManifest.modules.find(m=>m.id===shot.sourceModule);if(!sourceModule)throw Error('CLEAR_FULL_FILM_SOURCE_CHANGED');const code=SourceCodeSchema.parse(await readNarrationJson(store,sourceModule.sourceRef,revisionPrefix)),parameters={projectId,bundleHash:bundle.bundleHash,runtimeDigest:digest,sourceHtml:code.html,logicalWidth:width,logicalHeight:height,outputWidth:width,outputHeight:height,fps,startFrame:shot.startFrame,endFrame:shot.endFrame,seed:spec.seed,fence:operation.consentEpoch},job={...parameters,operationId:journalOperationId,attemptId:'full-'+index,stageKey:computeStageKey(parameters)};
   await observeProbePicture(executor,job,async handle=>{handles.push(handle);report.currentShot=shot.id;await save()},assertSource,630000);
   const qa=await technicalVideoQa(join(root,'media',job.stageKey),'sha256:'+digest,'output/picture.mp4',{width,height,fps,durationSec:(shot.endFrame-shot.startFrame)/fps,audio:false});shots.push({shotId:shot.id,startFrame:shot.startFrame,endFrame:shot.endFrame,stageKey:job.stageKey,sha256:qa.sha256});await assertSource();await save();console.log(JSON.stringify({completedShot:shot.id}));
  }
  const sequenceInput={projectId,revisionId:bundle.revisionId,shots,width,height,fps,runtimeDigest:digest,fence:operation.consentEpoch},sequence=await assemblePictureSequence(root,sequenceInput,env,{assertActive:assertSource,journal});report.sequence=sequence;await save();
  const cues=frozen.timing.captions.map(cue=>({...cue,startMs:Math.round(cue.startFrame*1000/fps),endMs:Math.round(cue.endFrame*1000/fps)})),captionEntry=frozen.sourceManifest.captionStyles[0],style=CaptionPackageSchema.parse(await readNarrationJson(store,captionEntry.styleRef,revisionPrefix)).profiles.full,composeSpec={width,height,fps,durationSec:totalFrames/fps,bundleHash:bundle.bundleHash,fence:operation.consentEpoch};
  const movie=await composeVideo(root,join(root,'picture-sequence',sequence.stageKey),frozen.filmAudioTrack,cues,style,composeSpec,env,{producerReceipt:true,assertActive:assertSource,journal});report.movie=movie;await save();
  const voice=(await store.readFresh<{planRef:Parameters<typeof readNarrationJson>[1];verifiedRef:Parameters<typeof readNarrationJson>[1]}>(revisionPrefix+'voice-stage')).value,{plan,verified}=await validateNarrationPolicySource(projects,sourceRoot,projectId,bundle.revisionId,voice.planRef,voice.verifiedRef),film={outputPath:movie.outputPath,sha256:movie.technicalQa.sha256,durationMs:totalFrames*1000/fps,technicalQa:'pass' as const},review=(context:Parameters<typeof resolvePreviewPostMixReview>[4])=>resolvePreviewPostMixReview(projects,sourceRoot,projectId,bundle.revisionId,context,{mustExist:true,verified});
  const postmix=await verifyPostMixNarration(sourceRoot,film,plan,verified,env,undefined,{downmix:'stereo_average',journal,assertActive:assertSource,resolveReview:review});report.postmix=postmix;await save();
  const coldMovie=await composeVideo(root,join(root,'picture-sequence',sequence.stageKey),frozen.filmAudioTrack,cues,style,composeSpec,env,{producerReceipt:true,mustExist:true,assertActive:assertSource,journal}),coldMix=await verifyPostMixNarration(sourceRoot,film,plan,verified,env,undefined,{downmix:'stereo_average',journal,mustExist:true,assertActive:assertSource,resolveReview:review});if(canonicalHash(movie)!==canonicalHash(coldMovie)||canonicalHash(postmix)!==canonicalHash(coldMix))throw Error('CLEAR_FULL_FILM_COLD_CHANGED');report.coldMoviePostmixMatches=true;
  const visualPlan=wholeFilmVisualPlan(frozen.timeline),batches:Array<{round:1|2;index:number;evidence:VisualEvidence}>=[];report.visualPlan=visualPlan;report.visualBatches=batches;
  for(const round of visualPlan.rounds)for(const batch of round.batches){const evidence=await extractVisualFrames(root,{outputPath:movie.outputPath,sha256:movie.technicalQa.sha256,width,height,totalFrames},batch.frames,'sha256:'+digest,{assertActive:assertSource});await readVisualEvidence(root,evidence);batches.push({round:round.round,index:batch.index,evidence});await save()}
  report.status='actual_clear_1080p_composition_postmix_and_two_round_frames_verified';
 }catch(error){report.status='failed';report.errorCode=(error as Error).message;process.exitCode=1}
 finally{report.originalControlBudgetOperationsUnchanged=canonicalHash(before)===canonicalHash(await Promise.all(keys.map(async key=>canonicalHash((await store.readFresh(key)).value))));report.nativeInvocations=await Promise.all((await store.listKeys(journal.prefix,1)).map(async key=>(await store.readFresh(key)).value));if(!report.originalControlBudgetOperationsUnchanged){report.status='failed';report.errorCode='CLEAR_FULL_FILM_SOURCE_CHANGED';process.exitCode=1}await save();console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,visualBatches:(report.visualBatches as unknown[]|undefined)?.length}));}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
