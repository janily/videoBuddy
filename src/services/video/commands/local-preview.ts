import {randomUUID} from 'node:crypto';
import type {AtomicStore} from '@/services/video/storage/atomic-store';
import {updateJson,createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import type {ProjectControl} from '@/contracts/video/project';
import {StreamEventSchema} from '@/contracts/video/commands';
import {canonicalHash} from '@/services/video/domain/hash';
import type {LocalEventLog} from '@/services/video/stream/local-event-log';
import type {Environment} from '@/services/video/config/environment';
import {assertPreviewOperation} from '@/services/video/preview/operation';
import type {PreviewOperation} from '@/services/video/preview/prepare';
import {buildPreviewPipeline} from '@/services/video/preview/pipeline';
import {readPublishedPreview} from '@/services/video/preview/commit';
import {claimOperation} from './claim';
const safeCodes=new Set(['COMPOSITION_PRODUCER_UNKNOWN','EFFECT_UNKNOWN','BUDGET_EXCEEDED','MODEL_BUDGET_OVERRUN','MODEL_USAGE_UNCERTAIN','MODEL_ACCOUNTING_MIGRATION_REQUIRED','ASR_MISMATCH','POSTMIX_ASR_MISMATCH','ASR_TIMINGS_UNAVAILABLE','PICTURE_RENDER_FAILED','VISUAL_SOURCE_INVALID','MODEL_OUTPUT_INVALID','AUDIO_PLAN_INVALID','AUDIO_EVENT_INVALID','AUDIO_TIMELINE_INVALID','CAPTION_CONFLICT','GENERATION_DISABLED','CONFIGURATION_REQUIRED','CRITIC_REVIEW_INVALID','PREVIEW_STALE','PREVIEW_OPERATION_CHANGED','PREVIEW_QUALITY_BLOCKED','PREVIEW_PACKAGE_INVALID','PREVIEW_ARTIFACT_MISMATCH','QA_FAILED']);
// Internal diagnostics use explicit codes only; provider text, paths and stacks
// never enter this private record or the public operation/SSE outcome.
const privateDiagnosticCodes=new Set([...safeCodes,'MEDIA_STOP_UNKNOWN','COMPOSITE_FONT_CHANGED','COMPOSITE_TRACK_CHANGED','COMPOSITE_CAPTION_CHANGED','COMPOSITE_STAGE_CONFLICT','COMPOSITE_STAGE_MISSING','COMPOSITE_AUDIO_EXECUTION_NOT_READY','COMPOSITE_OUTPUT_CHANGED','COMPOSITE_OUTPUT_INVALID','COMPOSITION_INVALID','COMPOSITION_SOURCE_CHANGED','COMPOSITION_STAGE_UNKNOWN','COMPOSITION_STAGE_MISSING','COMPOSITION_LOUDNESS_FAILED','BOOK_CAPTION_READING_CONFLICT','FONT_GLYPH_MISSING','FILM_FONT_CHANGED','FILM_PACKAGE_CONFLICT','FILM_RUNTIME_CHANGED','FILM_VISUAL_SOURCE_INCOMPLETE','PICTURE_SEQUENCE_CONFLICT','PICTURE_SEQUENCE_OUTPUT_CHANGED','STORE_IO_FAILED','STORE_NOT_FOUND','STORE_CONFLICT','ENOENT','EACCES','EPERM','ENOSPC','EIO','EMFILE']);
export async function runPreviewOperation(store:AtomicStore,events:LocalEventLog,projectId:string,operationId:string,options:{root:string;env?:Environment;build?:typeof buildPreviewPipeline}){
 const prefix=`projects/${projectId}`,key=prefix+'/operations/'+operationId,projects=new ProjectStore(store);
 const before=(await store.readFresh<PreviewOperation>(key)).value;
 if(before.id!==operationId||before.projectId!==projectId||before.kind!=='preview')throw Error('PREVIEW_OPERATION_CHANGED');
 const op=(await store.readFresh<PreviewOperation>(key)).value,input={projectId,operationId,revisionId:op.revisionId,previewId:op.previewId,expectedConsentEpoch:op.consentEpoch};
 async function emit(type:string,payload:object){
  const existing=await events.readFrom(projectId,operationId,0);
  if(existing.some(({event})=>event.epoch===op.streamEpoch&&event.type===type&&canonicalHash(event.payload)===canonicalHash(payload)))return;
  await events.append(StreamEventSchema.parse({schemaVersion:5,projectId,operationId,epoch:op.streamEpoch,eventId:randomUUID(),createdAt:new Date().toISOString(),type,payload}));
 }
 let lastStage:string|null='stage' in op&&typeof op.stage==='string'?op.stage:null;
 async function activity(stage:string,label:string){
  await updateJson(store,key,(value:PreviewOperation)=>{if(value.status!=='running')throw Error('PREVIEW_STALE');return{...value,stage}});
  lastStage=stage;
  await emit('activity.updated',{stage,label});
 }
 type Outcome=NonNullable<ProjectControl['previewOutcomes']>[string];
 async function finish(outcome:Outcome){
  const saved=await createOrRead(store,key+'/preview-outcome',outcome);
  if(canonicalHash(saved)!==canonicalHash(outcome))throw Error('PREVIEW_OUTCOME_CHANGED');
  if(outcome.status==='succeeded')await emit('preview.ready',{previewId:op.previewId,revisionId:op.revisionId,briefVersion:op.briefVersion});
  await emit('operation.terminal',{...outcome,retryable:false});
  await updateJson(store,key,(value:PreviewOperation)=>({...value,...outcome}));
  await updateJson(store,prefix+'/control',(c:ProjectControl)=>{
   const clearStop=outcome.status==='cancelled'&&c.unresolvedMediaStops?.[operationId];
   if(!c.previewOutcomes?.[operationId]&&!clearStop)return c;
   if(c.previewOutcomes?.[operationId]&&canonicalHash(c.previewOutcomes[operationId])!==canonicalHash(outcome))throw Error('PREVIEW_OUTCOME_CHANGED');
   const remaining={...c.previewOutcomes},unresolvedMediaStops={...c.unresolvedMediaStops};delete remaining[operationId];if(clearStop)delete unresolvedMediaStops[operationId];return{...c,controlVersion:c.controlVersion+1,previewOutcomes:remaining,...(clearStop?{unresolvedMediaStops}:{})};
  });
 }
 let resumed=(await store.readFresh<ProjectControl>(prefix+'/control')).value.previewOutcomes?.[operationId];
 if(!resumed)try{resumed=(await store.readFresh<Outcome>(key+'/preview-outcome')).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(resumed){await finish(resumed);return}
 // A persisted fence alone cannot prove that a previous worker stopped media.
 const entryControl=(await store.readFresh<ProjectControl>(prefix+'/control')).value;
 const published=entryControl.currentPreviewId===op.previewId&&entryControl.briefVersion===op.briefVersion&&entryControl.consentEpoch===op.consentEpoch&&!entryControl.deletedAt&&Date.parse(entryControl.expiresAt)>Date.now();
 const coldStopUnknown=before.status==='cancelling'||before.status==='interrupted'||Boolean(before.status==='running'&&!published&&(before.mediaAttemptStarted||before.canonicalRunId&&(entryControl.activeProduction!==operationId||entryControl.consentEpoch!==op.consentEpoch||entryControl.deletedAt||Date.parse(entryControl.expiresAt)<=Date.now())));
 if(!coldStopUnknown&&!(await claimOperation(store,key,operationId)).claimed)return;
 try{
  if(coldStopUnknown)throw Error('MEDIA_STOP_UNKNOWN');
  const control=(await store.readFresh<ProjectControl>(prefix+'/control')).value;
  await assertPreviewOperation(projects,control,operationId,op.revisionId,op.previewId,op.consentEpoch);
  if(control.currentPreviewId!==op.previewId){
   await updateJson(store,key,(current:PreviewOperation)=>{if(current.status!=='running'||current.fence!==op.fence||current.mediaAttemptStarted)throw Error('MEDIA_STOP_UNKNOWN');return{...current,mediaAttemptStarted:true}});
   await (options.build||buildPreviewPipeline)(projects,input,options,activity);
  }
  await readPublishedPreview(projects,projectId,operationId,op.consentEpoch,op.previewId,options.root);
  const completed=await updateJson(store,prefix+'/control',(c:ProjectControl)=>{
   if(c.previewOutcomes?.[operationId])return c;
   if(c.currentPreviewId!==op.previewId||c.consentEpoch!==op.consentEpoch||c.briefVersion!==op.briefVersion)throw Error('PREVIEW_STALE');
   return{...c,controlVersion:c.controlVersion+1,latestPreviewOutcome:{operationId,briefVersion:op.briefVersion,consentEpoch:op.consentEpoch,controlVersion:c.controlVersion+1},previewOutcomes:{...c.previewOutcomes,[operationId]:{status:'succeeded' as const}}};
  });
  await finish(completed.previewOutcomes![operationId]);
 }catch(error){
  const c=(await store.readFresh<ProjectControl>(prefix+'/control')).value;
  // Publication may already be durable. Leave it recoverable after any lost ACK.
  let frozenOutcome:Outcome|undefined;try{frozenOutcome=(await store.readFresh<Outcome>(key+'/preview-outcome')).value}catch(missing){if(!(missing instanceof StoreMissing))throw missing}
  if(c.previewOutcomes?.[operationId]||frozenOutcome)throw error;
  const rawCode=error instanceof Error?error.message.split(':')[0]:'';
  const corrupt=['PREVIEW_ARTIFACT_MISMATCH','PREVIEW_PACKAGE_INVALID','PREVIEW_OPERATION_CHANGED'].includes(rawCode);
  if(c.currentPreviewId===op.previewId&&c.briefVersion===op.briefVersion&&c.consentEpoch===op.consentEpoch&&!corrupt&&rawCode!=='MEDIA_STOP_UNKNOWN')throw error;
  const code=error instanceof Error?error.message.split(':')[0]:'PROVIDER_UNAVAILABLE',errorCode=code==='MEDIA_STOP_UNKNOWN'?code:safeCodes.has(code)?code:'PROVIDER_UNAVAILABLE';
  try{
   const errno=error instanceof Error&&(error as NodeJS.ErrnoException).code;
   const internalCode=privateDiagnosticCodes.has(code)?code:typeof errno==='string'&&privateDiagnosticCodes.has(errno)?errno:'UNCLASSIFIED';
   const errorClass=error instanceof TypeError?'TypeError':error instanceof RangeError?'RangeError':error instanceof SyntaxError?'SyntaxError':error instanceof Error?'Error':'NonError';
   await createOrRead(store,key+'/failure-diagnostic',{schemaVersion:1,projectId,operationId,revisionId:op.revisionId,stage:lastStage,internalCode,errorClass,publicErrorCode:errorCode,observedAt:new Date().toISOString(),errorFingerprint:canonicalHash({errorClass,message:error instanceof Error?error.message:''})});
  }catch{
   // Diagnostic storage failure must not prevent the original terminal outcome.
  }
  const failed=await updateJson(store,prefix+'/control',(current:ProjectControl)=>{
   if(current.previewOutcomes?.[operationId])return current;
   const published=current.currentPreviewId===op.previewId&&current.consentEpoch===op.consentEpoch&&current.briefVersion===op.briefVersion&&!current.activeProduction;
   const stopUnknown=code==='MEDIA_STOP_UNKNOWN';
   const status=stopUnknown?'interrupted' as const:current.cancelRequestedProductionId===operationId?'cancelled' as const:published&&corrupt?'failed' as const:current.activeProduction!==operationId||current.consentEpoch!==op.consentEpoch?'superseded' as const:'failed' as const;
   const owned=current.activeProduction===operationId||published||stopUnknown&&!current.activeProduction&&current.cancelRequestedProductionId===operationId;
   return{...current,controlVersion:current.controlVersion+1,previewOutcomes:{...current.previewOutcomes,[operationId]:{status,errorCode}},...(stopUnknown?{unresolvedMediaStops:{...current.unresolvedMediaStops,[operationId]:'preview' as const}}:{}),...(owned?{latestPreviewOutcome:{operationId,briefVersion:stopUnknown?current.briefVersion:op.briefVersion,consentEpoch:stopUnknown?current.consentEpoch:op.consentEpoch,controlVersion:current.controlVersion+1},activeProduction:null,phase:status==='failed'||stopUnknown?'attention' as const:current.phase,...(published&&corrupt?{previewState:'stale' as const}:{})}:{})};
  });
  await finish(failed.previewOutcomes![operationId]);
 }
}
