import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {ObjectRef,Understanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {guardTreatment} from '@/contracts/video/treatment';
import {guardVisualShot,type VisualShotSource} from '@/contracts/video/visual-shot';
import {runVisualShot} from '@/mastra/video/visual-shot';
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

type Decide=(understanding:Understanding,treatment:unknown,timing:ReturnType<typeof TimingDraftSchema.parse>,timingHash:string,shotId:string,maxOutputTokens:number,env:Environment,seed:number)=>Promise<unknown>;
interface Options{root?:string;env?:Environment;decide?:Decide;limits?:ModelLimits;mustExist?:boolean}
export interface VisualStageRecord{schemaVersion:1;briefVersion:number;treatmentSha256:string;timingDraftSha256:string;shotId:string;sourceRef:ObjectRef;sourceSha256:string;runtimeStatus:'not_checked'}

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
 const contextBytes=Buffer.byteLength(canonicalJson({understanding,treatment:plan,timing:{...timing,track:{sha256:timing.track.sha256,samples:timing.track.samples,silence:timing.track.silence}},shotId}))+Buffer.byteLength(knowledge.rules);
 if(contextBytes>180000)throw Error('CONTEXT_LIMIT');
 const reservation=await reserveModelBudget(projects.store,projectId,`${operationId}-visual-${revisionId}-${shotKey}`,{inputTokens:contextBytes+4096,outputTokens:12000},options.limits||modelLimits(env));
 const source=await runEffect<VisualShotSource>(projects.store,effectKey,async()=>{
  return guardVisualShot(await (options.decide||runVisualShot)(understanding,plan,timing,timingRecord.draftRef.sha256,shotId,reservation.maxOutputTokens,env,seed),understanding,plan,timing,timingRecord.draftRef.sha256,seed);
 });
 guardVisualShot(source,understanding,plan,timing,timingRecord.draftRef.sha256,seed);
 if(source.assetIds.some(id=>!control.assets.some(asset=>asset.id===id&&asset.status==='ready')))throw Error('VISUAL_ASSET_NOT_READY');
 const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
 if(source.assetIds.some(id=>!latest.assets.some(asset=>asset.id===id&&asset.status==='ready')))throw Error('VISUAL_ASSET_NOT_READY');
 const record:VisualStageRecord={schemaVersion:1,briefVersion:control.briefVersion,treatmentSha256:treatmentRef.sha256,timingDraftSha256:timingRecord.draftRef.sha256,shotId,sourceRef:await projects.index.immutable(`${revisionPrefix}visual-source/${shotKey}`,source),sourceSha256:createHash('sha256').update(source.sourceHtml).digest('hex'),runtimeStatus:'not_checked'};
 const stored=await createOrRead(projects.store,key,record);
 if(canonicalHash(stored)!==canonicalHash(record))throw Error('VISUAL_STAGE_CONFLICT');
 return verifyRecord(stored);
}
