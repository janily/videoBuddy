import {z} from 'zod';
import type {Understanding, ObjectRef} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {guardTreatment, type TreatmentPlan} from '@/contracts/video/treatment';
import {runTreatment} from '@/mastra/video/treatment';
import {reserveModelBudget, modelLimits, type ModelLimits} from '@/services/video/budget/model-budget';
import {readConfiguration, requireGeneration, type Environment} from '@/services/video/config/environment';
import {runEffect} from '@/services/video/commands/effect-ledger';
import {canonicalHash, canonicalJson} from '@/services/video/domain/hash';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {loadStageKnowledge} from '@/services/video/styles/knowledge-loader';
import {assertPreviewProductionFence} from './fence';

type Decide = (understanding:Understanding, maxOutputTokens:number, env:Environment)=>Promise<unknown>;
interface StageOptions {decide?:Decide; limits?:ModelLimits; env?:Environment}

export async function prepareTreatmentStage(projects:ProjectStore, projectId:string, revisionId:string, operationId:string, expectedConsentEpoch:number, options:StageOptions={}):Promise<ObjectRef> {
 if (![projectId,revisionId,operationId].every(id=>z.uuid().safeParse(id).success)||!Number.isSafeInteger(expectedConsentEpoch)||expectedConsentEpoch<0) throw Error('VALIDATION_FAILED');
 const prefix=`projects/${projectId}`,control=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(control,projectId,operationId,expectedConsentEpoch);
 const understanding=(await projects.store.readFresh<Understanding>(control.understandingRef.key)).value;
 if (canonicalHash(understanding)!==control.understandingRef.sha256||understanding.briefVersion!==control.briefVersion||!understanding.preferences.styleSlug||!understanding.subject.trim()||understanding.unresolvedConflictIds.length) throw Error('TREATMENT_BASELINE_CHANGED');
 const knowledge=await loadStageKnowledge(understanding.preferences.styleSlug,'style');
 const env=options.env||process.env;
 if (!options.decide) requireGeneration(readConfiguration(env));
 const contextBytes=Buffer.byteLength(canonicalJson({understanding,styleRules:knowledge.rules}));
 if (contextBytes>100000) throw Error('CONTEXT_LIMIT');
 const limits=options.limits||modelLimits(env);
 const plan=await runEffect<TreatmentPlan>(projects.store,`${prefix}/operations/${operationId}/effects/treatment/${revisionId}`,async()=>{
  const reservation=await reserveModelBudget(projects.store,projectId,`${operationId}-treatment-${revisionId}`,{inputTokens:contextBytes+4096,outputTokens:5000},limits);
  return guardTreatment(await (options.decide||runTreatment)(understanding,reservation.maxOutputTokens,env),understanding,knowledge.sha256);
 });
 guardTreatment(plan,understanding,knowledge.sha256);
 const latest=(await projects.store.readFresh<ProjectControl>(`${prefix}/control`)).value;
 assertPreviewProductionFence(latest,projectId,operationId,expectedConsentEpoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});
 return projects.index.immutable(`${prefix}/revisions/${revisionId}/treatment-plan`,plan);
}
