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
const safeCodes=new Set(['EFFECT_UNKNOWN','BUDGET_EXCEEDED','MODEL_BUDGET_OVERRUN','MODEL_USAGE_UNCERTAIN','MODEL_ACCOUNTING_MIGRATION_REQUIRED','ASR_MISMATCH','CAPTION_CONFLICT','GENERATION_DISABLED','CONFIGURATION_REQUIRED','CRITIC_REVIEW_INVALID','PREVIEW_STALE','PREVIEW_OPERATION_CHANGED','PREVIEW_QUALITY_BLOCKED','PREVIEW_PACKAGE_INVALID','PREVIEW_ARTIFACT_MISMATCH','QA_FAILED']);
export async function runPreviewOperation(store:AtomicStore,events:LocalEventLog,projectId:string,operationId:string,options:{root:string;env?:Environment;build?:typeof buildPreviewPipeline}){
 const prefix=`projects/${projectId}`,key=prefix+'/operations/'+operationId,projects=new ProjectStore(store);
 const before=(await store.readFresh<PreviewOperation>(key)).value;
 if(before.id!==operationId||before.projectId!==projectId||before.kind!=='preview')throw Error('PREVIEW_OPERATION_CHANGED');
 if(before.status!=='cancelling'&&!(await claimOperation(store,key,operationId)).claimed)return;
 const op=(await store.readFresh<PreviewOperation>(key)).value,input={projectId,operationId,revisionId:op.revisionId,previewId:op.previewId,expectedConsentEpoch:op.consentEpoch};
 async function emit(type:string,payload:object){
  const existing=await events.readFrom(projectId,operationId,0);
  if(existing.some(({event})=>event.epoch===op.streamEpoch&&event.type===type&&canonicalHash(event.payload)===canonicalHash(payload)))return;
  await events.append(StreamEventSchema.parse({schemaVersion:5,projectId,operationId,epoch:op.streamEpoch,eventId:randomUUID(),createdAt:new Date().toISOString(),type,payload}));
 }
 async function activity(stage:string,label:string){
  await updateJson(store,key,(value:PreviewOperation)=>{if(value.status!=='running')throw Error('PREVIEW_STALE');return{...value,stage}});
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
   if(!c.previewOutcomes?.[operationId])return c;
   if(canonicalHash(c.previewOutcomes[operationId])!==canonicalHash(outcome))throw Error('PREVIEW_OUTCOME_CHANGED');
   const remaining={...c.previewOutcomes};delete remaining[operationId];return{...c,controlVersion:c.controlVersion+1,previewOutcomes:remaining};
  });
 }
 let resumed=(await store.readFresh<ProjectControl>(prefix+'/control')).value.previewOutcomes?.[operationId];
 if(!resumed)try{resumed=(await store.readFresh<Outcome>(key+'/preview-outcome')).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(resumed){await finish(resumed);return}
 try{
  if(before.status==='cancelling')throw Error('PREVIEW_STALE');
  const control=(await store.readFresh<ProjectControl>(prefix+'/control')).value;
  await assertPreviewOperation(projects,control,operationId,op.revisionId,op.previewId,op.consentEpoch);
  if(control.currentPreviewId!==op.previewId)await (options.build||buildPreviewPipeline)(projects,input,options,activity);
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
  if(c.currentPreviewId===op.previewId&&c.briefVersion===op.briefVersion&&c.consentEpoch===op.consentEpoch&&!corrupt)throw error;
  const code=error instanceof Error?error.message.split(':')[0]:'PROVIDER_UNAVAILABLE',errorCode=safeCodes.has(code)?code:'PROVIDER_UNAVAILABLE';
  const failed=await updateJson(store,prefix+'/control',(current:ProjectControl)=>{
   if(current.previewOutcomes?.[operationId])return current;
   const published=current.currentPreviewId===op.previewId&&current.consentEpoch===op.consentEpoch&&current.briefVersion===op.briefVersion&&!current.activeProduction;
   const status=current.cancelRequestedProductionId===operationId?'cancelled' as const:published&&corrupt?'failed' as const:current.activeProduction!==operationId||current.consentEpoch!==op.consentEpoch?'superseded' as const:'failed' as const;
   const owned=current.activeProduction===operationId||published;
   return{...current,controlVersion:current.controlVersion+1,previewOutcomes:{...current.previewOutcomes,[operationId]:{status,errorCode}},...(owned?{latestPreviewOutcome:{operationId,briefVersion:op.briefVersion,consentEpoch:op.consentEpoch,controlVersion:current.controlVersion+1},activeProduction:null,phase:status==='failed'?'attention' as const:current.phase,...(published&&corrupt?{previewState:'stale' as const}:{})}:{})};
  });
  await finish(failed.previewOutcomes![operationId]);
 }
}
