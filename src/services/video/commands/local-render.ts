import {randomUUID,createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {z} from 'zod';
import type {AtomicStore} from '@/services/video/storage/atomic-store';
import {createOrRead,StoreMissing,updateJson} from '@/services/video/storage/atomic-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import type {ProjectControl} from '@/contracts/video/project';
import {StreamEventSchema} from '@/contracts/video/commands';
import type {LocalEventLog} from '@/services/video/stream/local-event-log';
import {canonicalHash} from '@/services/video/domain/hash';
import type {ApprovalRecord} from '@/services/video/preview/approve';
import {validateDelivery} from '@/services/video/quality/delivery';
import {publishResult,readResultManifest} from '@/services/video/results/publish';
import {renderApproved,type RenderTargets} from '@/services/video/render/pipeline';
import {assertApprovedRenderFence,loadApprovedRenderInputs} from '@/services/video/render/approved-inputs';
import {persistArchiveObject} from '@/services/video/exports/archive-object';
import type {ArtifactRecord} from '@/services/video/exports/access';
import {actualArtifactSha256} from '@/services/video/exports/verified-file';
import {claimOperation} from './claim';
interface RenderOperation{id:string;projectId:string;commandId:string;kind:'render';status:string;canonicalRunId:string|null;streamEpoch:number;fence:number;approvalId:string;bundleHash:string;consentEpoch:number;mediaAttemptStarted?:boolean}
type Outcome=NonNullable<ProjectControl['renderOutcomes']>[string];
const safe=new Set(['QUALITY_BLOCKED','EFFECT_UNKNOWN','BUDGET_EXCEEDED','MODEL_BUDGET_OVERRUN','MODEL_USAGE_UNCERTAIN','MODEL_ACCOUNTING_MIGRATION_REQUIRED','GENERATION_DISABLED','CONFIGURATION_REQUIRED','QA_FAILED','RENDER_OUTPUT_CHANGED','RENDER_STAGE_CONFLICT','STAGE_UNKNOWN','COMPOSITION_STAGE_UNKNOWN','CRITIC_REVIEW_INVALID','ASR_MISMATCH','POSTMIX_ASR_MISMATCH','VISUAL_ASSET_RUNTIME_UNAVAILABLE','APPROVED_AUDIO_NOT_READY']);
export async function runApprovedRenderOperation(store:AtomicStore,events:LocalEventLog,projectId:string,operationId:string,options:Parameters<typeof renderApproved>[6]&{build?:typeof renderApproved}){
 if(![projectId,operationId].every(id=>z.uuid().safeParse(id).success)||!isAbsolute(options.root))throw Error('VALIDATION_FAILED');
 const prefix=`projects/${projectId}`,key=prefix+'/operations/'+operationId,projects=new ProjectStore(store),before=(await store.readFresh<RenderOperation>(key)).value;
 if(before.id!==operationId||before.projectId!==projectId||before.kind!=='render')throw Error('RENDER_FENCED');
 async function emit(type:string,payload:object){
  if((await events.readFrom(projectId,operationId,0)).some(({event})=>event.epoch===before.streamEpoch&&event.type===type&&canonicalHash(event.payload)===canonicalHash(payload)))return;
  await events.append(StreamEventSchema.parse({schemaVersion:5,projectId,operationId,epoch:before.streamEpoch,eventId:randomUUID(),createdAt:new Date().toISOString(),type,payload}));
 }
 async function finish(outcome:Outcome){
  const saved=await createOrRead(store,key+'/render-outcome',outcome);if(canonicalHash(saved)!==canonicalHash(outcome))throw Error('RENDER_OUTCOME_CHANGED');
  if(outcome.status==='succeeded'){
   if(!outcome.resultId||!outcome.resultHash)throw Error('RENDER_OUTCOME_CHANGED');
   const result=await readResultManifest(projects,projectId,outcome.resultId);if(canonicalHash(result)!==outcome.resultHash||result.approvalId!==before.approvalId||result.bundleHash!==before.bundleHash)throw Error('RENDER_OUTCOME_CHANGED');
   await emit('result.ready',{artifactId:result.artifactId,revisionId:result.revisionId});
  }
  await emit('operation.terminal',{status:outcome.status,...(outcome.errorCode?{errorCode:outcome.errorCode}:{}),retryable:false});
  await updateJson(store,key,(op:RenderOperation)=>({...op,status:outcome.status,...(outcome.errorCode?{errorCode:outcome.errorCode}:{})}));
  await updateJson(store,prefix+'/control',(c:ProjectControl)=>{
   const clearStop=outcome.status==='cancelled'&&c.unresolvedMediaStops?.[operationId];
   if(!c.renderOutcomes?.[operationId]&&!clearStop)return c;
   if(c.renderOutcomes?.[operationId]&&canonicalHash(c.renderOutcomes[operationId])!==canonicalHash(outcome))throw Error('RENDER_OUTCOME_CHANGED');
   const remaining={...c.renderOutcomes},unresolvedMediaStops={...c.unresolvedMediaStops};delete remaining[operationId];if(clearStop)delete unresolvedMediaStops[operationId];return{...c,controlVersion:c.controlVersion+1,renderOutcomes:remaining,...(clearStop?{unresolvedMediaStops}:{})};
  });
 }
 async function knownOutcome(){
  const c=(await store.readFresh<ProjectControl>(prefix+'/control')).value;if(c.renderOutcomes?.[operationId])return c.renderOutcomes[operationId];
  try{return(await store.readFresh<Outcome>(key+'/render-outcome')).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 }
 const known=await knownOutcome();if(known){await finish(known);return}
 const approval=(await store.readFresh<ApprovalRecord>(prefix+'/approvals/'+before.approvalId)).value;
 if(approval.projectId!==projectId||approval.approvalId!==before.approvalId||approval.clientCommandId!==before.commandId||approval.bundleHash!==before.bundleHash||approval.consentEpoch!==before.consentEpoch)throw Error('RENDER_FENCED');
 const owner=approval.ownerKeyHash;
 async function fail(raw:string){
  const c=await updateJson(store,prefix+'/control',(current:ProjectControl)=>{
   if(current.renderOutcomes?.[operationId])return current;
   const cancelled=current.cancelRequestedProductionId===operationId||before.status==='cancelled'||before.status==='cancelling';
   const owned=current.activeProduction===operationId,stopUnknown=raw==='MEDIA_STOP_UNKNOWN';
   const affected=owned||stopUnknown&&!current.activeProduction&&current.cancelRequestedProductionId===operationId;
   const status=stopUnknown?'interrupted' as const:cancelled?'cancelled' as const:!owned||current.consentEpoch!==before.consentEpoch||current.deletedAt||Date.parse(current.expiresAt)<=Date.now()?'superseded' as const:'failed' as const;
   const outcome:Outcome={status,...(stopUnknown?{errorCode:'MEDIA_STOP_UNKNOWN'}:cancelled?{}:{errorCode:safe.has(raw)?raw:'RENDER_FAILED'})};
   return{...current,controlVersion:current.controlVersion+1,renderOutcomes:{...current.renderOutcomes,[operationId]:outcome},...(stopUnknown?{unresolvedMediaStops:{...current.unresolvedMediaStops,[operationId]:'render' as const}}:{}),...(affected?{activeProduction:null,phase:status==='failed'||stopUnknown?'attention' as const:current.phase,latestRenderOutcome:{operationId,briefVersion:stopUnknown?current.briefVersion:approval.briefVersion,consentEpoch:stopUnknown?current.consentEpoch:approval.consentEpoch,controlVersion:current.controlVersion+1}}:{})};
  });
  await finish(c.renderOutcomes![operationId]);
 }
 // A cold worker has no process-local proof that previously started media stopped.
 // Cancellation may have persisted its control fence but lost the operation ACK.
 const entryControl=(await store.readFresh<ProjectControl>(prefix+'/control')).value;
 if(before.status==='cancelling'||before.status==='interrupted'||before.mediaAttemptStarted&&before.status==='running'||before.canonicalRunId&&before.status==='running'&&(entryControl.activeProduction!==operationId||entryControl.consentEpoch!==before.consentEpoch||entryControl.deletedAt||Date.parse(entryControl.expiresAt)<=Date.now())){await fail('MEDIA_STOP_UNKNOWN');return}
 if(['cancelled','failed','superseded'].includes(before.status)){await fail(before.status==='failed'?'RENDER_FAILED':'RENDER_FENCED');return}
 if(!(await claimOperation(store,key,operationId)).claimed)return;
 const op=(await store.readFresh<RenderOperation>(key)).value;
 try{
  const inputs=await loadApprovedRenderInputs(projects,owner,projectId,operationId,op.fence,options);
  const targets=await createOrRead<RenderTargets>(store,key+'/render-targets',{resultId:randomUUID(),artifactId:randomUUID(),createdAt:new Date().toISOString()});
  async function activity(stage:string,label:string){await assertApprovedRenderFence(projects,inputs);await updateJson(store,key,(current:RenderOperation)=>{if(current.status!=='running'||current.fence!==op.fence)throw Error('RENDER_FENCED');return{...current,stage}});await emit('activity.updated',{stage,label})}
  await updateJson(store,key,(current:RenderOperation)=>{if(current.status!=='running'||current.fence!==op.fence||current.mediaAttemptStarted)throw Error('MEDIA_STOP_UNKNOWN');return{...current,mediaAttemptStarted:true}});
  const built=await(options.build||renderApproved)(projects,owner,projectId,operationId,op.fence,targets,options,activity),result=built.result;
  if(result.resultId!==targets.resultId||result.artifactId!==targets.artifactId||result.createdAt!==targets.createdAt||result.approvalId!==op.approvalId||result.bundleHash!==op.bundleHash||result.revisionId!==approval.revisionId||result.previewId!==approval.previewId)throw Error('RENDER_OUTPUT_CHANGED');
  if(!/^\/[A-Za-z0-9_./-]+$/.test(built.outputPath)||!built.outputPath.startsWith(join(options.root,'composition')+'/')||!/^[a-f0-9]{64}\/output\/final\.mp4$/.test(built.outputPath.slice(join(options.root,'composition').length+1)))throw Error('RENDER_OUTPUT_CHANGED');
  const actual=await realpath(built.outputPath),base=await realpath(join(options.root,'composition'));if(!actual.startsWith(base+'/'))throw Error('RENDER_OUTPUT_CHANGED');
  const file=await open(built.outputPath,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;
  try{const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.size!==result.mp4Bytes||info.size<1024||info.size>150*1024*1024)throw Error('RENDER_OUTPUT_CHANGED');bytes=await file.readFile();const after=await file.stat();if(after.size!==info.size||after.mtimeMs!==info.mtimeMs||after.ctimeMs!==info.ctimeMs||after.nlink!==1)throw Error('RENDER_OUTPUT_CHANGED')}finally{await file.close()}
  const actualSha=createHash('sha256').update(bytes).digest('hex');
  validateDelivery({policy:result.qualityPolicy,expectedPolicySha256:inputs.bundle.renderInputs.qualityPolicySha256,expectedFileSha256:result.mp4Sha256,actualFileSha256:actualSha,checks:result.qualityChecks});
  await assertApprovedRenderFence(projects,inputs);await activity('publication','正在保存完整视频');
  const objectRef={key:`projects/${projectId}/artifacts/${result.artifactId}/files/final.mp4`,sha256:actualSha,bytes:bytes.length,mime:'video/mp4'};
  await persistArchiveObject(options.root,objectRef.key,actualSha,bytes);
  if(await actualArtifactSha256(options.root,objectRef.key,bytes.length)!==actualSha)throw Error('RENDER_OUTPUT_CHANGED');
  const artifact:ArtifactRecord={id:result.artifactId,revisionId:result.revisionId,objectRef,qaPassed:true,uploaded:true,filename:'VideoBuddy.mp4'};
  if(canonicalHash(await createOrRead(store,prefix+'/artifacts/'+result.artifactId+'/manifest',artifact))!==canonicalHash(artifact))throw Error('RENDER_OUTPUT_CHANGED');
  await assertApprovedRenderFence(projects,inputs);
  await publishResult(projects,owner,projectId,operationId,op.fence,result,options.root);
  const completed=await knownOutcome();if(!completed||completed.status!=='succeeded')throw Error('RENDER_OUTCOME_CHANGED');await finish(completed);
 }catch(error){
  // Never replace a committed publication or failure after losing its ACK.
  if(await knownOutcome())throw error;
  await fail(error instanceof Error?error.message.split(':')[0]:'RENDER_FAILED');
 }
}
