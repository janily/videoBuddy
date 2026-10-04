import {createHash} from 'node:crypto';
import {copyFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {loadVerifiedFilmPackage} from '../../src/contracts/video/film-package';
import {loadAudioExecution} from '../../src/services/video/audio/execution-package';
import {composeVideo} from '../../src/services/video/media/compose';
import {captionStyleForProfile} from '../../src/services/video/timeline/package';
import {verifyPostMixNarration,type PostMixFilm} from '../../src/services/video/audio/postmix-asr';
import {createPostMixReviewChallenge,type PostMixReviewContext} from '../../src/services/video/audio/postmix-review';
import type {TimingStageRecord} from '../../src/services/video/preview/timing-stage';
import type {TimingDraft} from '../../src/services/video/preview/timing-draft';
import type {NarrationPlan} from '../../src/services/video/audio/narration';
import type {VerifiedNarrationManifest} from '../../src/services/video/audio/asr';
import type {PictureSequenceRecord} from '../../src/services/video/preview/picture-sequence-stage';
import type {AudioPlanStageRecord} from '../../src/services/video/preview/audio-plan-stage';
import type {NarrationPackageStageRecord} from '../../src/services/video/preview/narration-package-stage';
import {claimProbeReport,persistProbeReport} from './helpers/probe-report';
async function main(){
 if(process.argv.slice(2).join(' ')!=='--prepare-exact-book-mix-listening')throw Error('BOOK_MIX_FLAG_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/new-theme-book-caption-preview-v2-probe.json','utf8'));
 if(source.status!=='blocked'||source.errorCode!=='POSTMIX_ASR_MISMATCH'||source.stages.operation.status!=='failed')throw Error('BOOK_MIX_SOURCE_REQUIRED');
 const {root,projectId}=source,op=source.stages.operation,store=new FileStore(root),projects=new ProjectStore(store),prefix=`projects/${projectId}/`,revisionPrefix=prefix+`revisions/${op.revisionId}/`,journal={store,prefix:prefix+`operations/${op.id}/media-effects`},path='docs/engineering/evidence/book-preview-postmix-probe.json';
 const controls=[prefix+'control',prefix+'budget',prefix+'operations/'+op.id],before=await Promise.all(controls.map(async key=>canonicalHash((await store.readFresh(key)).value))),beforeKeys=await store.listKeys(journal.prefix,1);
 const report:Record<string,unknown>={executedAt:new Date().toISOString(),status:'started',root,projectId,sourceOperationId:op.id,sourceRevisionId:op.revisionId,newModelCalls:0,deliveryEligible:false,formalProductionApproval:false};await claimProbeReport(path,report);
 try{
  if(canonicalHash((await store.readFresh(prefix+'operations/'+op.id)).value)!==canonicalHash(op))throw Error('BOOK_MIX_SOURCE_CHANGED');
  const stage=source.stages.stageRecords['film-package-v2-stage'];if(canonicalHash(stage)!==canonicalHash((await store.readFresh(revisionPrefix+'film-package-v2-stage')).value))throw Error('BOOK_MIX_SOURCE_CHANGED');const spec=await readNarrationJson(store,stage.filmSpecRef,revisionPrefix+'film/'),frozen=await loadVerifiedFilmPackage(store,spec,root);
  if(frozen.filmSpec.qualityPolicyVersion!=='v5.1-package-3-book-captions')throw Error('BOOK_MIX_POLICY_CHANGED');
  const timingRecord=(await store.readFresh<TimingStageRecord>(revisionPrefix+'timing-stage')).value,timing=await readNarrationJson(store,timingRecord.draftRef,revisionPrefix+'timing-draft/') as TimingDraft,picture=(await store.readFresh<PictureSequenceRecord>(revisionPrefix+'picture-sequence/preview')).value,voice=source.stages.stageRecords['voice-stage'],narration=(await store.readFresh<NarrationPackageStageRecord>(revisionPrefix+'narration-package-stage')).value,audio=(await store.readFresh<AudioPlanStageRecord>(revisionPrefix+'audio-plan-stage')).value,executionRef=source.stages.stageRecords['audio-execution-v2-stage'].packageRef;
  for(const [name,value] of [['timing-stage',timingRecord],['narration-package-stage',narration],['audio-plan-stage',audio],['voice-stage',(await store.readFresh(revisionPrefix+'voice-stage')).value],['audio-execution-v2-stage',(await store.readFresh(revisionPrefix+'audio-execution-v2-stage')).value]] as const)if(canonicalHash(value)!==canonicalHash(source.stages.stageRecords[name]))throw Error('BOOK_MIX_SOURCE_CHANGED');
  const execution=await loadAudioExecution(store,root,projectId,op.revisionId,executionRef,audio.planRef,timingRecord.draftRef),bundleHash=canonicalHash({projectId,revisionId:op.revisionId,treatmentSha256:frozen.treatment.planRef.sha256,timingDraftSha256:timingRecord.draftRef.sha256,pictureSequenceHash:canonicalHash(picture),voiceVerifiedSha256:voice.verifiedRef.sha256,narrationPackageSha256:narration.packageRef.sha256,audioPlanSha256:audio.planRef.sha256,audioExecutionSha256:executionRef.sha256}),digest=frozen.filmSpec.runtimeDigest,env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+digest,VIDEO_MEDIA_RUNTIME_DIGEST:digest,VIDEO_MEDIA_TIMEOUT_SECONDS:'600',VIDEO_ASR_IMAGE_REF:'sha256:caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4',VIDEO_ASR_RUNTIME_DIGEST:'caa3fca3e3e6866dab7351346367768db612bb411f06fbd4a7a44f767747f5d4',VIDEO_ASR_MODEL:'Systran/faster-whisper-medium'};
  const composed=await composeVideo(root,join(root,'picture-sequence',picture.stageKey),execution.track,timing.captions.map(cue=>({...cue,startMs:Math.round(cue.startFrame*1000/timing.fps),endMs:Math.round(cue.endFrame*1000/timing.fps)})),captionStyleForProfile('preview',frozen.filmSpec.output,frozen.filmSpec.qualityPolicyVersion),{width:1280,height:720,durationSec:20,fps:24,bundleHash,fence:op.consentEpoch},env,{mustExist:true,journal});report.composed=composed;
  const plan=await readNarrationJson(store,voice.planRef,revisionPrefix+'voice-plan/') as NarrationPlan,verified=await readNarrationJson(store,voice.verifiedRef,revisionPrefix+'voice-verified/') as VerifiedNarrationManifest,film:PostMixFilm={outputPath:composed.outputPath,sha256:composed.technicalQa.sha256,durationMs:20000,technicalQa:'pass'};let context:PostMixReviewContext|undefined;
  try{await verifyPostMixNarration(root,film,plan,verified,env,undefined,{mustExist:true,journal,resolveReview:async value=>{context=value;return undefined}});throw Error('BOOK_MIX_NO_MISMATCH')}
  catch(error){if(!(error instanceof Error)||!error.message.startsWith('POSTMIX_ASR_MISMATCH:')||!context)throw error}
  const challengeRef=await createPostMixReviewChallenge(projects,root,projectId,op.revisionId,context),{window,lineId}=context,key=createHash('sha256').update(JSON.stringify([film.sha256,lineId,context.transcript.language,window.startMs,window.lengthMs,window.mediaRuntimeDigest,'postmix-v1'])).digest('hex'),wav=join(root,'postmix',key,'output/line.wav'),destination='docs/engineering/evidence/new-theme-book-postmix-spoken-review.wav',bytes=await readFile(wav);
  if(createHash('sha256').update(bytes).digest('hex')!==context.transcript.voiceSha256)throw Error('BOOK_MIX_AUDIO_CHANGED');
  await copyFile(wav,destination,1);report.context=context;report.challengeRef=challengeRef;report.filmSpecRef=stage.filmSpecRef;report.audioFile=destination;report.audioBytes=bytes.length;report.planRef=voice.planRef;report.verifiedRef=voice.verifiedRef;report.treatmentRef=frozen.treatment.planRef;report.status='exact_new_book_mix_mismatch_ready_for_listening';
 }catch(error){report.status='failed';report.errorCode=String((error as Error).message).slice(0,300);process.exitCode=1}
 finally{const afterKeys=await store.listKeys(journal.prefix,1);report.nativeInvocationCountBefore=beforeKeys.length;report.nativeInvocationCountAfter=afterKeys.length;report.sourceStateUnchanged=canonicalHash(before)===canonicalHash(await Promise.all(controls.map(async key=>canonicalHash((await store.readFresh(key)).value))));if(!report.sourceStateUnchanged||canonicalHash(beforeKeys)!==canonicalHash(afterKeys)){report.status='failed';report.errorCode='BOOK_MIX_STATE_CHANGED';process.exitCode=1}await persistProbeReport(path,report);console.log(JSON.stringify({status:report.status,errorCode:report.errorCode,sourceStateUnchanged:report.sourceStateUnchanged,newModelCalls:0}))}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
