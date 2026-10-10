import {archiveAssistantMilestone,milestoneContent,type AssistantMilestone} from './milestones';
import {applyPendingDirectorFeedback} from '@/services/video/revisions/pending-feedback';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {AtomicStore} from '@/services/video/storage/atomic-store';
import {createOrRead,updateJson,StoreMissing} from '@/services/video/storage/atomic-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import type {ProjectControl} from '@/contracts/video/project';
import {StreamEventSchema} from '@/contracts/video/commands';
import {canonicalHash} from '@/services/video/domain/hash';
import type {LocalEventLog} from '@/services/video/stream/local-event-log';
import type {Environment} from '@/services/video/config/environment';
import type {PreviewOperation} from '@/services/video/preview/prepare';
import {persistArchiveObject} from '@/services/video/exports/archive-object';
import type {ArtifactRecord} from '@/services/video/exports/access';
import {parseQuickManifest,quickResultKey,type QuickResultManifest} from '@/services/video/results/publish';
import {claimOperation} from '@/services/video/commands/claim';
import {buildQuickFilm,type QuickFilmOutput,type Activity} from './film';

// Error codes that may be shown to the person; anything else becomes PROVIDER_UNAVAILABLE.
const publicCodes=new Set(['PICTURE_RENDER_FAILED','VISUAL_SOURCE_INVALID','MODEL_OUTPUT_INVALID','TREATMENT_INVALID','TREATMENT_OPTIONS_INVALID','TREATMENT_TIMELINE_INVALID','TREATMENT_FACT_INVALID','TREATMENT_BASELINE_CHANGED','BUDGET_EXCEEDED','MODEL_BUDGET_OVERRUN','MODEL_USAGE_UNCERTAIN','GENERATION_DISABLED','CONFIGURATION_REQUIRED','CAPABILITY_UNAVAILABLE','MUSIC_TRACK_MISSING','MUSIC_LIBRARY_INVALID','QA_FAILED','CONTEXT_LIMIT']);

/**
 * Runs a "preview" operation as the quick flow: the finished film is published
 * straight away as the project's current result. Reuses the preview command,
 * queue, fence and cancellation, so the API and the worker queue are unchanged.
 */
export async function runQuickFilmOperation(store:AtomicStore,events:LocalEventLog,projectId:string,operationId:string,options:{root:string;env?:Environment;build?:typeof buildQuickFilm}){
 const prefix=`projects/${projectId}`,key=`${prefix}/operations/${operationId}`,projects=new ProjectStore(store);
 const op=(await store.readFresh<PreviewOperation>(key)).value;
 if(op.id!==operationId||op.projectId!==projectId||op.kind!=='preview')throw Error('PREVIEW_OPERATION_CHANGED');
 async function emit(type:string,payload:object){
  await events.append(StreamEventSchema.parse({schemaVersion:5,projectId,operationId,epoch:op.streamEpoch,eventId:randomUUID(),createdAt:new Date().toISOString(),type,payload}));
 }
 const activity:Activity=async(stage,label,progress)=>{
  await updateJson(store,key,(value:PreviewOperation)=>{if(value.status!=='running')throw Error('PREVIEW_STALE');return{...value,stage}});
  await emit('activity.updated',{stage,label,...progress});
 }
 async function milestone(kind:AssistantMilestone){
  const message=await archiveAssistantMilestone(projects,projectId,operationId,kind,milestoneContent(kind),kind==='film-started'?c=>c.activeProduction===operationId&&c.consentEpoch===op.consentEpoch:undefined);
  if(message)await emit('message.committed',message);
 }
 type Outcome=NonNullable<ProjectControl['previewOutcomes']>[string];
 async function finish(outcome:Outcome){
  const saved=await createOrRead(store,key+'/preview-outcome',outcome);
  if(canonicalHash(saved)!==canonicalHash(outcome))throw Error('PREVIEW_OUTCOME_CHANGED');
  if(outcome.status==='succeeded')await milestone('film-completed');
  else if(outcome.status==='failed')await milestone('film-failed');
  await emit('operation.terminal',{...outcome,retryable:false});
  await updateJson(store,key,(value:PreviewOperation)=>({...value,...outcome}));
  // The durable copy lives with the operation; keep the control record small (it caps pending outcomes).
  await updateJson(store,prefix+'/control',(c:ProjectControl)=>{if(!c.previewOutcomes?.[operationId])return c;const remaining={...c.previewOutcomes};delete remaining[operationId];return{...c,controlVersion:c.controlVersion+1,previewOutcomes:remaining}});
 }
 let resumed:Outcome|undefined;try{resumed=(await store.readFresh<Outcome>(key+'/preview-outcome')).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(resumed){await finish(resumed);return}
 if(!(await claimOperation(store,key,operationId)).claimed)return;
 try{
  await milestone('film-started');
  const film=await (options.build||buildQuickFilm)(projects,{projectId,operationId,expectedConsentEpoch:op.consentEpoch},{...options,onShot:shot=>emit('shot.updated',shot)},activity);
  await activity('publication','正在保存视频',{completed:film.shots.length,total:film.shots.length,unit:'shots'});
  const result=await publishQuickFilm(projects,projectId,operationId,op,film,options.root);
  try{await applyPendingDirectorFeedback(projects,projectId)}catch{/* Idle worker reconciliation retries next-version feedback. */}
  await milestone('film-completed');
  await emit('result.ready',{artifactId:result.artifactId,revisionId:result.revisionId});
  await finish({status:'succeeded'});
 }catch(error){
  const raw=error instanceof Error?error.message.split(':')[0]:'',errorCode=publicCodes.has(raw)?raw:'PROVIDER_UNAVAILABLE';
  const failed=await updateJson(store,`${prefix}/control`,(c:ProjectControl)=>{
   if(c.previewOutcomes?.[operationId])return c;
   const owned=c.activeProduction===operationId,status=c.cancelRequestedProductionId===operationId?'cancelled' as const:owned&&c.consentEpoch===op.consentEpoch?'failed' as const:'superseded' as const;
   return{...c,controlVersion:c.controlVersion+1,previewOutcomes:{...c.previewOutcomes,[operationId]:{status,errorCode}},...(owned?{activeProduction:null,phase:c.currentResultId?'ready' as const:'attention' as const,latestPreviewOutcome:{operationId,briefVersion:op.briefVersion,consentEpoch:op.consentEpoch,controlVersion:c.controlVersion+1}}:{})};
  });
  try{await applyPendingDirectorFeedback(projects,projectId)}catch{/* Idle worker reconciliation retries next-version feedback. */}
  await finish(failed.previewOutcomes![operationId]);
 }
}

/** Stores the MP4 as a private artifact and makes it the current result; the previous one stays restorable. */
export async function publishQuickFilm(projects:ProjectStore,projectId:string,operationId:string,op:PreviewOperation,film:QuickFilmOutput,root:string):Promise<QuickResultManifest>{
 const prefix=`projects/${projectId}`,intent=await createOrRead(projects.store,`${prefix}/operations/${operationId}/quick-publication`,{resultId:randomUUID(),artifactId:randomUUID(),createdAt:new Date().toISOString()});
 const bytes=await readFile(film.outputPath);
 if(bytes.length!==film.bytes)throw Error('QA_FAILED');
 const objectKey=`${prefix}/artifacts/${intent.artifactId}/files/final.mp4`;
 await persistArchiveObject(root,objectKey,film.sha256,bytes);
 const artifact:ArtifactRecord={id:intent.artifactId,revisionId:op.revisionId,objectRef:{key:objectKey,sha256:film.sha256,bytes:film.bytes,mime:'video/mp4'},qaPassed:true,uploaded:true,filename:'VideoBuddy.mp4'};
 if(canonicalHash(await createOrRead(projects.store,`${prefix}/artifacts/${intent.artifactId}/manifest`,artifact))!==canonicalHash(artifact))throw Error('ARTIFACT_INVALID');
 const result=parseQuickManifest({kind:'quick',resultId:intent.resultId,artifactId:intent.artifactId,revisionId:op.revisionId,operationId,bundleHash:canonicalHash({kind:'quick-film-v1',sha256:film.sha256}),mp4Sha256:film.sha256,mp4Bytes:film.bytes,briefVersion:film.briefVersion,styleSlug:film.styleSlug,aspect:film.aspect,durationSec:film.durationSec,shots:film.shots,music:film.music,aiLabel:true,createdAt:intent.createdAt});
 if(canonicalHash(await createOrRead(projects.store,quickResultKey(projectId,result.resultId),result))!==canonicalHash(result))throw Error('RESULT_ID_CONFLICT');
 await updateJson(projects.store,`${prefix}/control`,(c:ProjectControl)=>{
  if(c.currentResultId===result.resultId)return c;
  if(c.deletedAt||c.activeProduction!==operationId||c.consentEpoch!==op.consentEpoch||c.briefVersion!==op.briefVersion)throw Error('PREVIEW_STALE');
  return{...c,controlVersion:c.controlVersion+1,phase:'ready' as const,previousResultId:c.currentResultId,currentResultId:result.resultId,activeProduction:null,previewOutcomes:{...c.previewOutcomes,[operationId]:{status:'succeeded' as const}},latestPreviewOutcome:{operationId,briefVersion:op.briefVersion,consentEpoch:op.consentEpoch,controlVersion:c.controlVersion+1}};
 });
 return result;
}
