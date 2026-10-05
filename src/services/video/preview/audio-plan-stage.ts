import {isAbsolute} from 'node:path';
import {z} from 'zod';
import {ObjectRefSchema,type ObjectRef,type Understanding} from '@/contracts/video/domain';
import {guardTreatment} from '@/contracts/video/treatment';
import {guardAudioPlan,type AudioPlan} from '@/contracts/video/audio-plan';
import type {ProjectControl} from '@/contracts/video/project';
import {runAudioPlan,guardModelAudioPlan,RejectedAudioPlan,type AudioPlanCorrection} from '@/mastra/video/audio-plan';
import {configuredModel} from '@/mastra/video/model-adapter';
import {reserveModelBudget,modelLimits,type ModelLimits} from '@/services/video/budget/model-budget';
import {runEffect} from '@/services/video/commands/effect-ledger';
import {readConfiguration,requireGeneration,type Environment} from '@/services/video/config/environment';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {loadStageKnowledge} from '@/services/video/styles/knowledge-loader';
import {revisionSeed} from '@/services/video/timeline/seed';
import {TimingDraftSchema,type TimingDraft} from './timing-draft';
import {prepareTimingStage} from './timing-stage';
import {assertPreviewProductionFence} from './fence';

import {withAccountedModel} from '@/services/video/budget/model-call';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const RecordSchema=z.strictObject({schemaVersion:z.literal(1),briefVersion:z.number().int().nonnegative(),understandingSha256:digest,treatmentSha256:digest,timingDraftSha256:digest,seed:z.number().int().min(0).max(0xffffffff),planRef:ObjectRefSchema,executionStatus:z.literal('not_started')});
export type AudioPlanStageRecord=z.infer<typeof RecordSchema>;
type Decide=(understanding:Understanding,treatment:unknown,timing:TimingDraft,timingHash:string,seed:number,maxOutputTokens:number,env:Environment,correction?:AudioPlanCorrection)=>Promise<unknown>;
interface Options{root?:string;env?:Environment;decide?:Decide;limits?:ModelLimits;mustExist?:boolean}

async function readRef<T>(projects:ProjectStore,ref:ObjectRef,prefix:string):Promise<T>{
 if(ref.mime!=='application/json'||ref.bytes<1||!ref.key.startsWith(prefix))throw Error('AUDIO_REF_CHANGED');
 try{const value=(await projects.store.readFresh<T>(ref.key)).value;if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('AUDIO_REF_CHANGED');return value}catch{throw Error('AUDIO_REF_CHANGED')}
}
function checkAssets(plan:AudioPlan,control:ProjectControl){for(const source of plan.sources)if(source.kind==='user_track'&&!control.assets.some(asset=>asset.id===source.assetId&&asset.status==='ready'))throw Error('AUDIO_ASSET_NOT_READY')}

export async function prepareAudioPlanStage(projects:ProjectStore,projectId:string,revisionId:string,operationId:string,expectedConsentEpoch:number,treatmentRef:ObjectRef,options:Options={}):Promise<AudioPlanStageRecord>{
 if(![projectId,revisionId,operationId].every(id=>z.uuid().safeParse(id).success)||!Number.isSafeInteger(expectedConsentEpoch)||expectedConsentEpoch<0)throw Error('VALIDATION_FAILED');
 const env=options.env||process.env,root=options.root||env.VIDEO_DATA_DIR;
 if(!root||!isAbsolute(root))throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 const prefix=`projects/${projectId}`,revisionPrefix=`${prefix}/revisions/${revisionId}/`,control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 const understanding=await readRef<Understanding>(projects,control.understandingRef,`${prefix}/understanding/`);
 if(!understanding.preferences.styleSlug||understanding.briefVersion!==control.briefVersion)throw Error('AUDIO_BASELINE_CHANGED');
 const knowledge=await loadStageKnowledge(understanding.preferences.styleSlug,'style'),treatment=guardTreatment(await readRef<unknown>(projects,treatmentRef,`${revisionPrefix}treatment-plan/`),understanding,knowledge.sha256);
 const timingRecord=await prepareTimingStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true}),timing=TimingDraftSchema.parse(await readRef<unknown>(projects,timingRecord.draftRef,`${revisionPrefix}timing-draft/`)),seed=revisionSeed(projectId,revisionId),key=`${revisionPrefix}audio-plan-stage`;
 const baseline={schemaVersion:1 as const,briefVersion:control.briefVersion,understandingSha256:control.understandingRef.sha256,treatmentSha256:treatmentRef.sha256,timingDraftSha256:timingRecord.draftRef.sha256,seed,executionStatus:'not_started' as const};
 async function verify(raw:unknown){
  const parsed=RecordSchema.safeParse(raw);if(!parsed.success)throw Error('AUDIO_STAGE_CONFLICT');
  const record=parsed.data,{planRef,...storedBaseline}=record;
  if(canonicalHash(storedBaseline)!==canonicalHash(baseline))throw Error('AUDIO_STAGE_CONFLICT');
  const plan=guardAudioPlan(await readRef<unknown>(projects,planRef,`${revisionPrefix}audio-plan/`),understanding,treatment,timing,timingRecord.draftRef.sha256,seed);
  const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
  assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});checkAssets(plan,latest);
  return record;
 }
 try{return await verify((await projects.store.readFresh<unknown>(key)).value)}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(options.mustExist)throw Error('AUDIO_STAGE_MISSING');
 if(!options.decide){requireGeneration(readConfiguration(env));configuredModel('audio',env)}
 const contextBytes=Buffer.byteLength(canonicalJson({understanding,treatment,timing:{...timing,track:{sha256:timing.track.sha256,samples:timing.track.samples,silence:timing.track.silence}},seed}))+Buffer.byteLength(knowledge.rules);
 if(contextBytes>180000)throw Error('CONTEXT_LIMIT');
 const reservation=await reserveModelBudget(projects.store,projectId,`${operationId}-audio-${revisionId}`,{inputTokens:contextBytes+4096,outputTokens:12000},options.limits||modelLimits(env));
 const plan=await runEffect<AudioPlan>(projects.store,`${prefix}/operations/${operationId}/effects/audio/${revisionId}`,async()=>{
  async function attempt(current:typeof reservation,correction?:AudioPlanCorrection){
   const assertActive=async()=>assertPreviewProductionFence((await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
   await assertActive();
   const invoke=()=>runAudioPlan(understanding,treatment,timing,timingRecord.draftRef.sha256,seed,current.maxOutputTokens,env,correction,assertActive);
   const raw=options.decide?await options.decide(understanding,treatment,timing,timingRecord.draftRef.sha256,seed,current.maxOutputTokens,env,correction):await withAccountedModel(projects.store,current.reservation,invoke);
   return guardModelAudioPlan(raw,understanding,treatment,timing,timingRecord.draftRef.sha256,seed);
  }
  try{return await attempt(reservation)}catch(error){
   // Only a completed, accounted, schema-valid response can be corrected. No
   // transport/usage/unknown replay and no automatic native producer retry.
   if(env.VIDEO_DELIVERY_PROFILE!=='mvp'||!(error instanceof RejectedAudioPlan))throw error;
   await projects.index.immutable(`${revisionPrefix}audio-rejected`,{schemaVersion:1,reason:error.reason,plan:error.plan});
   const correction={reason:error.reason,previousPlan:error.plan},extraBytes=Buffer.byteLength(canonicalJson(correction))+2048;
   if(contextBytes+extraBytes>180000)throw Error('CONTEXT_LIMIT');
   const second=await reserveModelBudget(projects.store,projectId,`${operationId}-audio-${revisionId}-correction-1`,{inputTokens:contextBytes+extraBytes+4096,outputTokens:12000},options.limits||modelLimits(env));
   return attempt(second,correction);
  }
 });
 guardAudioPlan(plan,understanding,treatment,timing,timingRecord.draftRef.sha256,seed);checkAssets(plan,control);
 const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});checkAssets(plan,latest);
 const record={...baseline,planRef:await projects.index.immutable(`${revisionPrefix}audio-plan`,plan)},stored=await createOrRead(projects.store,key,record);
 if(canonicalHash(stored)!==canonicalHash(record))throw Error('AUDIO_STAGE_CONFLICT');
 return verify(stored);
}
