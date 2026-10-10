import {publishQuickFilm,readAnyResultManifest} from '@/services/video/results/publish-film';
import {actualArtifactSha256} from '@/services/video/exports/verified-file';
import {inspectArtifact} from '@/services/video/exports/access';
import {assertProductionFence} from '@/services/video/commands/production-fence';
import {archiveAssistantMilestone,milestoneContent,type AssistantMilestone} from './milestones';
import {applyPendingDirectorFeedback} from '@/services/video/revisions/pending-feedback';
import {randomUUID} from 'node:crypto';
import type {AtomicStore} from '@/services/video/storage/atomic-store';
import {createOrRead,updateJson,StoreMissing} from '@/services/video/storage/atomic-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import type {ProjectControl} from '@/contracts/video/project';
import {StreamEventSchema} from '@/contracts/video/commands';
import {canonicalHash} from '@/services/video/domain/hash';
import type {LocalEventLog} from '@/services/video/stream/local-event-log';
import type {Environment} from '@/services/video/config/environment';
import type {PreviewOperation} from '@/services/video/quick/prepare';
import {claimOperation} from '@/services/video/commands/claim';
import {buildQuickFilm,type Activity} from './film';
import {confirmOperationStopped} from '@/services/video/media/recovery';

// Error codes that may be shown to the person; anything else becomes PROVIDER_UNAVAILABLE.
const publicCodes=new Set(['NONDETERMINISTIC_SCENE','RENDER_FRAME_TIMEOUT','RESOURCE_BLOCKED','SANDBOX_UNAVAILABLE','SANDBOX_REQUIRED','CHROMIUM_SANDBOX_UNAVAILABLE','RENDER_SERVICE_UNAVAILABLE','RENDER_SERVICE_DISCONNECTED','RENDER_SERVICE_TIMEOUT','MEDIA_ABORTED','EFFECT_UNKNOWN','MEDIA_STOP_UNKNOWN','PREVIEW_STALE','PREVIEW_OPERATION_CHANGED','MODEL_ACCOUNTING_MIGRATION_REQUIRED','PICTURE_RENDER_FAILED','VISUAL_SOURCE_INVALID','MODEL_OUTPUT_INVALID','TREATMENT_INVALID','TREATMENT_OPTIONS_INVALID','TREATMENT_TIMELINE_INVALID','TREATMENT_FACT_INVALID','TREATMENT_BASELINE_CHANGED','BUDGET_EXCEEDED','MODEL_BUDGET_OVERRUN','MODEL_USAGE_UNCERTAIN','GENERATION_DISABLED','CONFIGURATION_REQUIRED','CAPABILITY_UNAVAILABLE','MUSIC_TRACK_MISSING','MUSIC_LIBRARY_INVALID','QA_FAILED','CONTEXT_LIMIT']);

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
  if((await events.readFrom(projectId,operationId,0)).some(({event})=>event.epoch===op.streamEpoch&&event.type===type&&canonicalHash(event.payload)===canonicalHash(payload)))return;
  await events.append(StreamEventSchema.parse({schemaVersion:5,projectId,operationId,epoch:op.streamEpoch,eventId:randomUUID(),createdAt:new Date().toISOString(),type,payload}));
 }
 let lastStage:string|null='stage' in op&&typeof op.stage==='string'?op.stage:null;
 const activity:Activity=async(stage,label,progress)=>{
  await updateJson(store,key,(value:PreviewOperation)=>{if(value.status!=='running')throw Error('PREVIEW_STALE');return{...value,stage}});
  lastStage=stage;
  await emit('activity.updated',{stage,label,...progress});
 }
 async function milestone(kind:AssistantMilestone){
  const message=await archiveAssistantMilestone(projects,projectId,operationId,kind,milestoneContent(kind),kind==='film-started'?c=>c.activeProduction===operationId&&c.consentEpoch===op.consentEpoch:undefined);
  if(message)await emit('message.committed',message);
 }
 type Outcome=NonNullable<ProjectControl['previewOutcomes']>[string];
 let stopConfirmed=false;
 async function finish(outcome:Outcome){
  const saved=await createOrRead(store,key+(stopConfirmed?'/media-stop-outcome':'/preview-outcome'),outcome);
  if(canonicalHash(saved)!==canonicalHash(outcome))throw Error('PREVIEW_OUTCOME_CHANGED');
  if(outcome.status==='succeeded')await milestone('film-completed');
  else if(outcome.status==='failed')await milestone('film-failed');
  await emit('operation.terminal',{...outcome,retryable:stopConfirmed&&outcome.status==='failed'});
  await updateJson(store,key,(value:PreviewOperation)=>({...value,...outcome}));
  // The durable copy lives with the operation; keep the control record small (it caps pending outcomes).
  await updateJson(store,prefix+'/control',(c:ProjectControl)=>{const clearStop=(stopConfirmed||outcome.status==='cancelled')&&c.unresolvedMediaStops?.[operationId];if(!c.previewOutcomes?.[operationId]&&!clearStop)return c;const remaining={...c.previewOutcomes},unresolvedMediaStops={...c.unresolvedMediaStops};delete remaining[operationId];if(clearStop)delete unresolvedMediaStops[operationId];return{...c,controlVersion:c.controlVersion+1,previewOutcomes:remaining,...(clearStop?{unresolvedMediaStops}:{})}});
 }
 const entry=(await store.readFresh<ProjectControl>(prefix+'/control')).value;
 let resumed:Outcome|undefined=entry.previewOutcomes?.[operationId];if(!resumed)try{resumed=(await store.readFresh<Outcome>(key+'/preview-outcome')).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 // A stop acknowledgement is an append-only fact. It permits a new command,
 // never a replay of the interrupted operation or its paid model calls.
 let proof:{schemaVersion:number;projectId:string;operationId:string;stopped:boolean}|undefined;
 try{proof=(await store.readFresh<NonNullable<typeof proof>>(key+'/media-stop-proof')).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(proof&&(proof.schemaVersion!==1||proof.projectId!==projectId||proof.operationId!==operationId||proof.stopped!==true))throw Error('MEDIA_STOP_UNKNOWN');
 const coldStopUnknown=op.status==='cancelling'||op.status==='interrupted'||Boolean(op.status==='running'&&op.mediaAttemptStarted);
 if(!proof&&coldStopUnknown&&(!resumed||resumed.status==='interrupted'&&resumed.errorCode==='MEDIA_STOP_UNKNOWN')){
  const confirmed=await confirmOperationStopped(options.root,options.env||process.env,{projectId,operationId}).catch(()=>false);
  if(confirmed)proof=await createOrRead(store,key+'/media-stop-proof',{schemaVersion:1,projectId,operationId,stopped:true});
 }
 if(proof){
  stopConfirmed=true;
  let recovered:Outcome|undefined;try{recovered=(await store.readFresh<Outcome>(key+'/media-stop-outcome')).value}catch(error){if(!(error instanceof StoreMissing))throw error}
  if(recovered){await finish(recovered);return}
  const settled=await updateJson(store,prefix+'/control',(c:ProjectControl)=>{
   const existing=c.previewOutcomes?.[operationId];if(existing&&existing.status!=='interrupted')return c;
   const owns=c.activeProduction===operationId,latest=!c.activeProduction&&c.latestPreviewOutcome?.operationId===operationId&&c.consentEpoch===op.consentEpoch;
   const status=c.cancelRequestedProductionId===operationId?'cancelled' as const:(owns||latest)&&c.consentEpoch===op.consentEpoch?'failed' as const:'superseded' as const;
   const outcome:Outcome={status,...(status==='failed'?{errorCode:'RENDER_PROCESS_CRASHED'}:{})},unresolvedMediaStops={...c.unresolvedMediaStops};delete unresolvedMediaStops[operationId];
   return{...c,controlVersion:c.controlVersion+1,unresolvedMediaStops,previewOutcomes:{...c.previewOutcomes,[operationId]:outcome},...(owns||latest?{activeProduction:null,phase:status==='cancelled'?'cancelled' as const:c.currentResultId?'ready' as const:'attention' as const,latestPreviewOutcome:{operationId,briefVersion:c.briefVersion,consentEpoch:c.consentEpoch,controlVersion:c.controlVersion+1}}:{})};
  });
  try{await applyPendingDirectorFeedback(projects,projectId)}catch{/* Reconciliation retries pending edits. */}
  await finish(settled.previewOutcomes![operationId]);return;
 }
 if(resumed){if(resumed.status==='succeeded'){const publication=(await store.readFresh<{resultId:string}>(key+'/quick-publication')).value;const result=await readAnyResultManifest(projects,projectId,publication.resultId);if(result.operationId!==operationId)throw Error('RESULT_INVALID');const artifact=await inspectArtifact(projects,entry.ownerKeyHash,projectId,result.artifactId);if(await actualArtifactSha256(options.root,artifact.objectRef.key,result.mp4Bytes)!==result.mp4Sha256)throw Error('ARTIFACT_INVALID')}await finish(resumed);return}
 if(!coldStopUnknown&&!(await claimOperation(store,key,operationId)).claimed)return;
 try{
  if(coldStopUnknown)throw Error('MEDIA_STOP_UNKNOWN');
  assertProductionFence((await store.readFresh<ProjectControl>(prefix+'/control')).value,projectId,operationId,op.consentEpoch,op);
  await updateJson(store,key,(current:PreviewOperation)=>{if(current.status!=='running'||current.fence!==op.fence||current.mediaAttemptStarted)throw Error('MEDIA_STOP_UNKNOWN');return{...current,mediaAttemptStarted:true}});
  await milestone('film-started');
  const film=await (options.build||buildQuickFilm)(projects,{projectId,operationId,expectedConsentEpoch:op.consentEpoch},{...options,onShot:shot=>emit('shot.updated',shot)},activity);
  await activity('publication','正在保存视频',{completed:film.shots.length,total:film.shots.length,unit:'shots'});
  const result=await publishQuickFilm(projects,projectId,operationId,op,film,options.root);
  try{await applyPendingDirectorFeedback(projects,projectId)}catch{/* Idle worker reconciliation retries next-version feedback. */}
  await milestone('film-completed');
  await emit('result.ready',{artifactId:result.artifactId,revisionId:result.revisionId});
  await finish({status:'succeeded'});
 }catch(error){
  const current=(await store.readFresh<ProjectControl>(prefix+'/control')).value;
  let saved:Outcome|undefined;try{saved=(await store.readFresh<Outcome>(key+'/preview-outcome')).value}catch(missing){if(!(missing instanceof StoreMissing))throw missing}
  if(current.previewOutcomes?.[operationId]||saved)throw error;
  const raw=error instanceof Error?error.message.split(':')[0]:'',errorCode=publicCodes.has(raw)?raw:'PROVIDER_UNAVAILABLE';
  try{
   const errno=error instanceof Error&&(error as NodeJS.ErrnoException).code;
   const known=new Set([...publicCodes,'PICTURE_SEQUENCE_CONFLICT','PICTURE_SEQUENCE_OUTPUT_CHANGED','STORE_IO_FAILED','ENOENT','EACCES','EPERM','ENOSPC','EIO','EMFILE']);
   const internalCode=known.has(raw)?raw:typeof errno==='string'&&known.has(errno)?errno:'UNCLASSIFIED';
   const errorClass=error instanceof TypeError?'TypeError':error instanceof RangeError?'RangeError':error instanceof SyntaxError?'SyntaxError':error instanceof Error?'Error':'NonError';
   await createOrRead(store,key+'/failure-diagnostic',{schemaVersion:1,projectId,operationId,revisionId:op.revisionId,stage:lastStage,internalCode,errorClass,publicErrorCode:errorCode,observedAt:new Date().toISOString(),errorFingerprint:canonicalHash({errorClass,message:error instanceof Error?error.message:''})});
  }catch{/* Diagnostic I/O never replaces the original terminal outcome. */}
  const failed=await updateJson(store,`${prefix}/control`,(c:ProjectControl)=>{
   if(c.previewOutcomes?.[operationId])return c;
   const stopUnknown=raw==='MEDIA_STOP_UNKNOWN',owned=c.activeProduction===operationId||stopUnknown&&!c.activeProduction&&c.cancelRequestedProductionId===operationId;
   const status=stopUnknown?'interrupted' as const:c.cancelRequestedProductionId===operationId?'cancelled' as const:owned&&c.consentEpoch===op.consentEpoch?'failed' as const:'superseded' as const;
   return{...c,controlVersion:c.controlVersion+1,previewOutcomes:{...c.previewOutcomes,[operationId]:{status,errorCode}},...(stopUnknown?{unresolvedMediaStops:{...c.unresolvedMediaStops,[operationId]:'preview' as const}}:{}),...(owned?{activeProduction:null,phase:c.currentResultId?'ready' as const:'attention' as const,latestPreviewOutcome:{operationId,briefVersion:stopUnknown?c.briefVersion:op.briefVersion,consentEpoch:stopUnknown?c.consentEpoch:op.consentEpoch,controlVersion:c.controlVersion+1}}:{})};
  });
  try{await applyPendingDirectorFeedback(projects,projectId)}catch{/* Idle worker reconciliation retries next-version feedback. */}
  await finish(failed.previewOutcomes![operationId]);
 }
}

/** Stores the MP4 as a private artifact and makes it the current result; the previous one stays restorable. */
