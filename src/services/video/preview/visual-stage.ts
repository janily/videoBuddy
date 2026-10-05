import {withAccountedModel} from '@/services/video/budget/model-call';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {ObjectRef,Understanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {guardTreatment} from '@/contracts/video/treatment';
import {guardVisualShot,type VisualShotSource} from '@/contracts/video/visual-shot';
import {runVisualShot,guardModelVisualSource,RejectedVisualSource,type VisualSourceCorrection} from '@/mastra/video/visual-shot';
import {configuredModel} from '@/mastra/video/model-adapter';
import {reserveModelBudget,modelLimits,type ModelLimits} from '@/services/video/budget/model-budget';
import {runEffect} from '@/services/video/commands/effect-ledger';
import {readConfiguration,requireGeneration,type Environment} from '@/services/video/config/environment';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {loadStageKnowledge} from '@/services/video/styles/knowledge-loader';
import {TimingDraftSchema} from './timing-draft';
import {prepareTimingStage} from './timing-stage';
import {assertPreviewProductionFence} from './fence';
import {revisionSeed} from '@/services/video/timeline/seed';

type Decide=(understanding:Understanding,treatment:unknown,timing:ReturnType<typeof TimingDraftSchema.parse>,timingHash:string,shotId:string,maxOutputTokens:number,env:Environment,seed:number,correction?:VisualSourceCorrection,continuitySource?:VisualShotSource)=>Promise<unknown>;
interface Options{root?:string;env?:Environment;decide?:Decide;limits?:ModelLimits;mustExist?:boolean}
export interface VisualStageRecord{schemaVersion:1;briefVersion:number;treatmentSha256:string;timingDraftSha256:string;shotId:string;sourceRef:ObjectRef;sourceSha256:string;runtimeStatus:'not_checked';continuityRef?:ObjectRef}

async function readRef<T>(projects:ProjectStore,ref:ObjectRef,prefix:string):Promise<T>{
 if(ref.mime!=='application/json'||ref.bytes<1||!ref.key.startsWith(prefix))throw Error('VISUAL_REF_CHANGED');
 let value:T;try{value=(await projects.store.readFresh<T>(ref.key)).value}catch{throw Error('VISUAL_REF_CHANGED')}
 try{if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('VISUAL_REF_CHANGED')}catch{throw Error('VISUAL_REF_CHANGED')}
 return value;
}

export async function prepareVisualShotStage(projects:ProjectStore,projectId:string,revisionId:string,operationId:string,expectedConsentEpoch:number,treatmentRef:ObjectRef,shotId:string,options:Options={}):Promise<VisualStageRecord>{
 if(![projectId,revisionId,operationId].every(id=>z.uuid().safeParse(id).success)||!shotId||shotId.length>120||!Number.isSafeInteger(expectedConsentEpoch)||expectedConsentEpoch<0)throw Error('VALIDATION_FAILED');
 const prefix=`projects/${projectId}`,revisionPrefix=`${prefix}/revisions/${revisionId}/`,control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 const understanding=await readRef<Understanding>(projects,control.understandingRef,`${prefix}/understanding/`);
 if(understanding.briefVersion!==control.briefVersion||!understanding.preferences.styleSlug||!treatmentRef.key.startsWith(`${revisionPrefix}treatment-plan/`))throw Error('VISUAL_BASELINE_CHANGED');
 const treatment=await readRef<unknown>(projects,treatmentRef,revisionPrefix),knowledge=await loadStageKnowledge(understanding.preferences.styleSlug,'style');
 const plan=guardTreatment(treatment,understanding,knowledge.sha256);
 if(!plan.shots.some(shot=>shot.id===shotId))throw Error('VISUAL_BASELINE_CHANGED');
 const env=options.env||process.env,root=options.root||env.VIDEO_DATA_DIR;
 if(!root)throw Error('CONFIGURATION_REQUIRED: VIDEO_DATA_DIR');
 const timingRecord=await prepareTimingStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,{root,env,mustExist:true});
 const timing=TimingDraftSchema.parse(await readRef<unknown>(projects,timingRecord.draftRef,revisionPrefix));
 const seed=revisionSeed(projectId,revisionId),shotKey=canonicalHash({shotId}),key=`${revisionPrefix}visual/${shotKey}`,effectKey=`${prefix}/operations/${operationId}/effects/visual/${revisionId}/${shotKey}`;
 async function verifyRecord(record:VisualStageRecord){
  if(record.schemaVersion!==1||record.briefVersion!==control.briefVersion||record.treatmentSha256!==treatmentRef.sha256||record.timingDraftSha256!==timingRecord.draftRef.sha256||record.shotId!==shotId||record.runtimeStatus!=='not_checked'||!record.sourceRef.key.startsWith(`${revisionPrefix}visual-source/${shotKey}/`))throw Error('VISUAL_STAGE_CONFLICT');
  if(record.continuityRef){const first=await prepareVisualShotStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,plan.shots[0].id,{...options,mustExist:true});if(shotId===plan.shots[0].id||canonicalHash(first.sourceRef)!==canonicalHash(record.continuityRef))throw Error('VISUAL_BASELINE_CHANGED')}
  const archived=await readRef<VisualShotSource>(projects,record.sourceRef,revisionPrefix);
  guardVisualShot(archived,understanding,plan,timing,timingRecord.draftRef.sha256,seed);
  if(createHash('sha256').update(archived.sourceHtml).digest('hex')!==record.sourceSha256)throw Error('VISUAL_REF_CHANGED');
  const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
  assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
  if(archived.assetIds.some(id=>!latest.assets.some(asset=>asset.id===id&&asset.status==='ready')))throw Error('VISUAL_ASSET_NOT_READY');
  return record;
 }
 try{return await verifyRecord((await projects.store.readFresh<VisualStageRecord>(key)).value)}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(options.mustExist)throw Error('VISUAL_STAGE_MISSING');
 if(!options.decide){requireGeneration(readConfiguration(env));configuredModel('visual',env)}
 const imageAssets=control.assets.filter(asset=>asset.status==='ready'&&asset.rightsConfirmed&&['image/png','image/jpeg','image/webp'].includes(asset.declaredMime)&&understanding.assetUses.some(use=>use.assetId===asset.id)).map(asset=>({id:asset.id,mime:asset.declaredMime}));
 let continuityRef:ObjectRef|undefined,continuitySource:VisualShotSource|undefined;
 if(env.VIDEO_DELIVERY_PROFILE==='mvp'&&understanding.preferences.styleSlug==='crayon-book'&&shotId!==plan.shots[0].id){const first=await prepareVisualShotStage(projects,projectId,revisionId,operationId,expectedConsentEpoch,treatmentRef,plan.shots[0].id,{...options,mustExist:true});continuityRef=first.sourceRef;continuitySource=await readRef<VisualShotSource>(projects,first.sourceRef,revisionPrefix)}
 const contextBytes=Buffer.byteLength(canonicalJson({understanding,treatment:plan,timing:{...timing,track:{sha256:timing.track.sha256,samples:timing.track.samples,silence:timing.track.silence}},shotId,...(continuitySource?{continuitySource}:{}),imageAssets:imageAssets.map(asset=>({...asset,runtimeUrl:'/assets/'+asset.id+'.bin'}))}))+Buffer.byteLength(knowledge.rules);
 if(contextBytes>180000)throw Error('CONTEXT_LIMIT');
 const reservation=await reserveModelBudget(projects.store,projectId,`${operationId}-visual-${revisionId}-${shotKey}`,{inputTokens:contextBytes+4096,outputTokens:12000},options.limits||modelLimits(env));
 const source=await runEffect<VisualShotSource>(projects.store,effectKey,async()=>{
  async function attempt(current:typeof reservation,correction?:VisualSourceCorrection){
   const assertActive=async()=>assertPreviewProductionFence((await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
   await assertActive();
   const invoke=()=>runVisualShot(understanding,plan,timing,timingRecord.draftRef.sha256,shotId,current.maxOutputTokens,env,seed,imageAssets,correction,assertActive,continuitySource);
   const raw=options.decide?await options.decide(understanding,plan,timing,timingRecord.draftRef.sha256,shotId,current.maxOutputTokens,env,seed,correction,continuitySource):await withAccountedModel(projects.store,current.reservation,invoke);
   return guardModelVisualSource(raw,understanding,plan,timing,timingRecord.draftRef.sha256,seed);
  }
  try{return await attempt(reservation)}catch(error){
   if(env.VIDEO_DELIVERY_PROFILE!=='mvp'||!(error instanceof RejectedVisualSource))throw error;
   await projects.index.immutable(`${revisionPrefix}visual-rejected/${shotKey}`,{schemaVersion:1,...error.correction});
   const extraBytes=Buffer.byteLength(canonicalJson(error.correction))+2048;
   if(contextBytes+extraBytes>180000)throw Error('CONTEXT_LIMIT');
   const second=await reserveModelBudget(projects.store,projectId,`${operationId}-visual-${revisionId}-${shotKey}-correction-1`,{inputTokens:contextBytes+extraBytes+4096,outputTokens:12000},options.limits||modelLimits(env));
   return attempt(second,error.correction);
  }
 });
 guardVisualShot(source,understanding,plan,timing,timingRecord.draftRef.sha256,seed);
 if(source.assetIds.some(id=>!control.assets.some(asset=>asset.id===id&&asset.status==='ready')))throw Error('VISUAL_ASSET_NOT_READY');
 const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
 if(source.assetIds.some(id=>!latest.assets.some(asset=>asset.id===id&&asset.status==='ready')))throw Error('VISUAL_ASSET_NOT_READY');
 const record:VisualStageRecord={schemaVersion:1,briefVersion:control.briefVersion,treatmentSha256:treatmentRef.sha256,timingDraftSha256:timingRecord.draftRef.sha256,shotId,sourceRef:await projects.index.immutable(`${revisionPrefix}visual-source/${shotKey}`,source),sourceSha256:createHash('sha256').update(source.sourceHtml).digest('hex'),runtimeStatus:'not_checked',...(continuityRef?{continuityRef}:{})};
 const stored=await createOrRead(projects.store,key,record);
 if(canonicalHash(stored)!==canonicalHash(record))throw Error('VISUAL_STAGE_CONFLICT');
 return verifyRecord(stored);
}
