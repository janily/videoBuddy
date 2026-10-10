import {archiveAssistantMilestone,milestoneContent} from './milestones';
import {userErrorMessage} from '@/services/video/http/user-messages';
import {randomUUID} from 'node:crypto';
import {UnderstandingSchema,type Understanding,type ObjectRef} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import type {ScriptDraft,ScriptShot} from '@/contracts/video/canvas';
import {guardTreatment,type TreatmentPlan} from '@/contracts/video/treatment';
import {StreamEventSchema} from '@/contracts/video/commands';
import {runTreatment} from '@/mastra/video/treatment';
import {configuredModel} from '@/mastra/video/model-adapter';
import {reserveModelBudget,modelLimits} from '@/services/video/budget/model-budget';
import {withAccountedModel} from '@/services/video/budget/model-call';
import {readConfiguration,requireGeneration,type Environment} from '@/services/video/config/environment';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {createOrRead,StoreMissing,updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import type {LocalOperationQueue} from '@/services/video/commands/local-queue';
import type {LocalEventLog} from '@/services/video/stream/local-event-log';
import {loadStageKnowledge} from '@/services/video/styles/knowledge-loader';
import {getStyle} from '@/services/video/styles/registry';
import {quickFlow} from './settings';

export interface ScriptOperation {id:string;projectId:string;kind:'script';canonicalRunId:string|null;status:'reserved'|'running'|'succeeded'|'failed'|'superseded';streamEpoch:number;briefVersion:number;understandingRef:ObjectRef;base:string;notBefore:number;stage?:string;errorCode?:string}
export interface ShotProgress {state:NonNullable<ScriptShot['state']>;posterArtifactId?:string;clipArtifactId?:string;take?:number}
export interface CanvasProgress {shots:Record<string,ShotProgress>}
export async function quickTreatmentContext(projects:ProjectStore,control:ProjectControl){
 const stored=UnderstandingSchema.parse((await projects.store.readFresh(control.understandingRef.key)).value);
 if(canonicalHash(stored)!==control.understandingRef.sha256||stored.briefVersion!==control.briefVersion)throw Error('PREVIEW_STALE');
 const understanding:Understanding={...stored,preferences:{...stored.preferences,voiceMode:'none',musicMode:'none',captions:'none'}};
 const style=getStyle(understanding.preferences.styleSlug!),knowledge=await loadStageKnowledge(style.slug,'style');
 // Shared with the complete film: script preview never creates a second cache namespace.
 const base=`projects/${control.projectId}/quick/b${understanding.briefVersion}/${canonicalHash({understanding:control.understandingRef.sha256,style:knowledge.sha256}).slice(0,16)}`;
 const contextBytes=Buffer.byteLength(canonicalJson({understanding,styleRules:knowledge.rules}));
 if(contextBytes>100000)throw Error('CONTEXT_LIMIT');
 return{understanding,style,knowledge,base,contextBytes};
}
export async function readOrCreateTreatment(projects:ProjectStore,context:Awaited<ReturnType<typeof quickTreatmentContext>>,make:()=>Promise<TreatmentPlan>){
 let result:TreatmentPlan;
 try{result=(await projects.store.readFresh<{value:TreatmentPlan}>(`${context.base}/treatment`)).value.value}
 catch(error){if(!(error instanceof StoreMissing))throw error;const value=guardTreatment(await make(),context.understanding,context.knowledge.sha256);result=(await createOrRead(projects.store,`${context.base}/treatment`,{value})).value}
 return guardTreatment(result,context.understanding,context.knowledge.sha256);
}
export async function generateQuickTreatment(projects:ProjectStore,context:Awaited<ReturnType<typeof quickTreatmentContext>>,operationId:string,env:Environment,assertActive:()=>Promise<void>){
 requireGeneration(readConfiguration(env));configuredModel('director',env);await assertActive();
 const reservation=await reserveModelBudget(projects.store,context.base.split('/')[1],`${operationId}-quick-treatment-${randomUUID()}`,{inputTokens:context.contextBytes+4096,outputTokens:5000},modelLimits(env));
 await assertActive();
 return withAccountedModel(projects.store,reservation.reservation,()=>runTreatment(context.understanding,reservation.maxOutputTokens,env));
}
/** Durable debounce: only the worker executes it, after this persisted deadline. */
export async function scheduleScriptDraft(projects:ProjectStore,queue:LocalOperationQueue,projectId:string,options:{env?:Environment;now?:number;retry?:boolean}={}){
 if(!quickFlow(options.env||process.env))return null;
 const key=`projects/${projectId}/control`,control=(await projects.store.readFresh<ProjectControl>(key)).value;
 if(control.deletedAt||Date.parse(control.expiresAt)<=Date.now()||control.activeConversation||control.activeProduction)return null;
 const understanding=(await projects.store.readFresh<Understanding>(control.understandingRef.key)).value;
 if(!understanding.subject.trim()||!understanding.preferences.styleSlug||understanding.unresolvedConflictIds.length)return null;
 const context=await quickTreatmentContext(projects,control);
 if(control.latestScript?.base===context.base){
  const old=(await projects.store.readFresh<ScriptOperation>(`projects/${projectId}/operations/${control.latestScript.operationId}`)).value;
  if(['succeeded','failed','superseded'].includes(old.status)&&control.activeScript===old.id)await updateJson(projects.store,key,(c:ProjectControl)=>c.activeScript===old.id?{...c,controlVersion:c.controlVersion+1,activeScript:null}:c);
  if(old.status==='succeeded'||old.status==='failed'&&!options.retry)return null;
  if(old.status==='reserved'||old.status==='running'){await queue.enqueue(projectId,old.id,'script');return old}
 }
 let previousBase=control.latestScript?.base;
 if(previousBase){try{await projects.store.readFresh(`${previousBase}/treatment`)}catch(error){if(!(error instanceof StoreMissing))throw error;previousBase=control.latestScript?.previousBase}}
 const id=randomUUID(),operation:ScriptOperation={id,projectId,kind:'script',canonicalRunId:null,status:'reserved',streamEpoch:0,briefVersion:control.briefVersion,understandingRef:control.understandingRef,base:context.base,notBefore:(options.now??Date.now())+3000};
 await createOrRead(projects.store,`projects/${projectId}/operations/${id}`,operation);
 const saved=await updateJson(projects.store,key,(c:ProjectControl)=>{
  if(c.deletedAt||c.activeConversation||c.activeProduction||c.briefVersion!==control.briefVersion||canonicalHash(c.understandingRef)!==canonicalHash(control.understandingRef))return c;
  if(c.latestScript?.base===context.base&&c.latestScript.operationId!==control.latestScript?.operationId)return c;
  return{...c,controlVersion:c.controlVersion+1,activeScript:id,latestScript:{...(control.latestScript?.base!==context.base?{previousBase}:{}),base:context.base,briefVersion:control.briefVersion,operationId:id}};
 });
 if(saved.activeScript!==id){await updateJson(projects.store,`projects/${projectId}/operations/${id}`,(op:ScriptOperation)=>({...op,status:'superseded' as const}));return null}
 await queue.enqueue(projectId,id,'script');return operation;
}
export async function runScriptOperation(projects:ProjectStore,events:LocalEventLog,projectId:string,operationId:string,options:{env?:Environment;now?:number;generate?:(context:Awaited<ReturnType<typeof quickTreatmentContext>>)=>Promise<TreatmentPlan>}={}){
 const key=`projects/${projectId}/operations/${operationId}`,op=(await projects.store.readFresh<ScriptOperation>(key)).value;
 if(op.kind!=='script'||op.id!==operationId||op.projectId!==projectId)throw Error('SCRIPT_OPERATION_CHANGED');
 if(!['reserved','running'].includes(op.status)||(options.now??Date.now())<op.notBefore)return;
 const emit=async(type:string,payload:object)=>events.append(StreamEventSchema.parse({schemaVersion:5,projectId,operationId,epoch:op.streamEpoch,eventId:randomUUID(),createdAt:new Date().toISOString(),type,payload}));
 const assertActive=async()=>{const c=(await projects.store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;if(c.deletedAt||Date.parse(c.expiresAt)<=Date.now()||c.briefVersion!==op.briefVersion||canonicalHash(c.understandingRef)!==canonicalHash(op.understandingRef)||c.latestScript?.operationId!==op.id)throw Error('SCRIPT_STALE');return c};
 let status:ScriptOperation['status']='succeeded',errorCode:string|undefined;
 try{
  const c=await assertActive();await updateJson(projects.store,key,(value:ScriptOperation)=>({...value,status:'running' as const,canonicalRunId:operationId,stage:'treatment'}));
  const context=await quickTreatmentContext(projects,c);
  await emit('activity.updated',{stage:'treatment',label:'正在写脚本，画好的内容会出现在画布上'});
  const treatment=await readOrCreateTreatment(projects,context,()=>options.generate?options.generate(context):generateQuickTreatment(projects,context,operationId,options.env||process.env,async()=>{await assertActive()}));
  await assertActive();
  const message=await archiveAssistantMilestone(projects,projectId,operationId,'script-ready',milestoneContent('script-ready',treatment.summary),c=>c.briefVersion===op.briefVersion&&c.latestScript?.operationId===op.id);
  if(message)await emit('message.committed',message);
  await assertActive();await emit('script.ready',{briefVersion:op.briefVersion});
 }catch(error){status=error instanceof Error&&error.message==='SCRIPT_STALE'?'superseded':'failed';errorCode=status==='failed'?'SCRIPT_DRAFT_FAILED':undefined}
 await updateJson(projects.store,key,(value:ScriptOperation)=>({...value,status,...(errorCode?{errorCode}:{})}));
 await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>c.activeScript===operationId?{...c,controlVersion:c.controlVersion+1,activeScript:null}:c);
 await emit('operation.terminal',{status,...(errorCode?{errorCode}:{}),retryable:status==='failed'});
}
export async function readScriptView(projects:ProjectStore,control:ProjectControl):Promise<ScriptDraft|undefined>{
 const marker=control.latestScript;if(!marker)return;
 let treatment:TreatmentPlan|undefined,progress:CanvasProgress={shots:{}},op:ScriptOperation|undefined;
 try{treatment=(await projects.store.readFresh<{value:TreatmentPlan}>(`${marker.base}/treatment`)).value.value}catch(error){if(!(error instanceof StoreMissing))throw error}
 let displayBase=marker.base;
 if(!treatment&&marker.previousBase){try{treatment=(await projects.store.readFresh<{value:TreatmentPlan}>(`${marker.previousBase}/treatment`)).value.value;displayBase=marker.previousBase}catch(error){if(!(error instanceof StoreMissing))throw error}}
 try{progress=(await projects.store.readFresh<CanvasProgress>(`${displayBase}/canvas`)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 try{op=(await projects.store.readFresh<ScriptOperation>(`projects/${control.projectId}/operations/${marker.operationId}`)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 const state=marker.briefVersion!==control.briefVersion?'stale':op?.kind==='script'&&op.status==='failed'?'failed':displayBase!==marker.base?'stale':treatment?'ready':'drafting';
 return{briefVersion:treatment?.briefVersion??marker.briefVersion,summary:treatment?.summary||'',selectionReason:treatment?.selectionReason||'',shots:treatment?.shots.map(shot=>({id:shot.id,startSec:shot.startFrame/treatment!.fps,endSec:shot.endFrame/treatment!.fps,scriptLine:shot.scriptLine,visualIntent:shot.visualIntent,...(progress.shots[shot.id]||{state:'text' as const})}))||[],state,operationId:marker.operationId,...(state==='failed'?{errorMessage:userErrorMessage('SCRIPT_DRAFT_FAILED')}:{})};
}
