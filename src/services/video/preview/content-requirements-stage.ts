import {z} from 'zod';
import {UnderstandingSchema} from '@/contracts/video/domain';
import {ContentRequirementsProofSchema as RecordSchema,verifyContentRequirementsProof} from '@/contracts/video/content-requirements-proof';
import type {ProjectControl} from '@/contracts/video/project';
import {requirementsContext,guardRequirementsProposal,guardRequirementsAudit,approvedRequirements,type RequirementsContext,type RequirementsProposal} from '@/contracts/video/content-requirements';
import {runRequirementsProposal,runRequirementsAudit,requirementsPayload} from '@/mastra/video/content-requirements';
import {configuredModel} from '@/mastra/video/model-adapter';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {createOrRead,StoreMissing,type AtomicStore} from '@/services/video/storage/atomic-store';
import {readNarrationJson} from '@/services/video/audio/narration-package';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {reserveModelBudget,modelLimits,type ModelLimits} from '@/services/video/budget/model-budget';
import {withAccountedModel} from '@/services/video/budget/model-call';
import {runEffect} from '@/services/video/commands/effect-ledger';
import {readConfiguration,requireGeneration,type Environment} from '@/services/video/config/environment';
import {assertPreviewProductionFence} from './fence';
import {assertPreviewOperation} from './operation';
type Options={env?:Environment;limits?:ModelLimits;mustExist?:boolean;propose?:(context:RequirementsContext)=>Promise<unknown>;audit?:(context:RequirementsContext,proposal:RequirementsProposal)=>Promise<unknown>};
function prefix(projectId:string,revisionId:string){if(![projectId,revisionId].every(id=>z.uuid().safeParse(id).success))throw Error('VALIDATION_FAILED');return`projects/${projectId}/revisions/${revisionId}/`}
/** Read-only source proof; current creation/publication fences remain mandatory
 * at the consuming stage. Reading historical proof never grants fresh consent. */
export async function loadContentRequirements(store:AtomicStore,projectId:string,revisionId:string,expected:Omit<RequirementsContext,'contextSha256'>){
 const p=prefix(projectId,revisionId);return verifyContentRequirementsProof(store,projectId,revisionId,(await store.readFresh(p+'content-requirements-v1-stage')).value,expected);
}
export async function prepareContentRequirementsStage(projects:ProjectStore,projectId:string,revisionId:string,operationId:string,epoch:number,options:Options={}){
 const p=prefix(projectId,revisionId);if(!z.uuid().safeParse(operationId).success||!Number.isSafeInteger(epoch)||epoch<0)throw Error('VALIDATION_FAILED');
 const control=(await projects.store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;
 const before=(await projects.store.readFresh<{previewId:string;fence?:number}>(`projects/${projectId}/operations/${operationId}`)).value;
 async function fence(){const c=(await projects.store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;assertPreviewProductionFence(c,projectId,operationId,epoch,{briefVersion:control.briefVersion,understandingRef:control.understandingRef});const op=await assertPreviewOperation(projects,c,operationId,revisionId,before.previewId,epoch),raw=(await projects.store.readFresh<typeof before>(`projects/${projectId}/operations/${operationId}`)).value;if(op.status!=='running'||raw.fence!==before.fence)throw Error('PREVIEW_STALE')}
 await fence();
 const understanding=UnderstandingSchema.parse(await readNarrationJson(projects.store,control.understandingRef,`projects/${projectId}/understanding/`)),context=requirementsContext({understandingSha256:control.understandingRef.sha256,facts:understanding.facts.filter(f=>['provided','confirmed'].includes(f.status))});
 if(understanding.briefVersion!==control.briefVersion||understanding.unresolvedConflictIds.length)throw Error('CONTENT_REQUIREMENTS_BASELINE_CHANGED');
 const expected={understandingSha256:context.understandingSha256,facts:context.facts};
 let existing:unknown;try{existing=(await projects.store.readFresh(p+'content-requirements-v1-stage')).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(existing!==undefined){const saved=await loadContentRequirements(projects.store,projectId,revisionId,expected);if(saved.operationId!==operationId||saved.consentEpoch!==epoch)throw Error('CONTENT_REQUIREMENTS_BASELINE_CHANGED');await fence();return saved}
 if(options.mustExist)throw Error('CONTENT_REQUIREMENTS_MISSING');
 const env=options.env||process.env;if(Buffer.byteLength(canonicalJson(context))>160000)throw Error('CONTEXT_LIMIT');
 const contextRef=await projects.index.immutable(p+'content-requirements-context',context);
 async function effect(phase:'proposal'|'audit',proposal?:RequirementsProposal){
  const identity=canonicalHash({contextSha256:context.contextSha256,...(proposal?{proposalSha256:canonicalHash(proposal)}:{}),phase}),key=`projects/${projectId}/operations/${operationId}/effects/content-requirements/${identity}`;
  const decide=phase==='proposal'?options.propose:options.audit;let prior:unknown;
  try{prior=(await projects.store.readFresh(key)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
  let reservation:Awaited<ReturnType<typeof reserveModelBudget>>|undefined;
  const payload=prior===undefined?requirementsPayload(context,proposal,8000):undefined;
  if(prior===undefined&&!decide){
   requireGeneration(readConfiguration(env));configuredModel(phase==='proposal'?'director':'critic',env);
   reservation=await reserveModelBudget(projects.store,projectId,`${operationId}-requirements-${identity}`,{inputTokens:Buffer.byteLength(payload!)+8192,outputTokens:8000},options.limits||modelLimits(env));await fence();
  }
  const output=await runEffect(projects.store,key,async()=>{await fence();
   if(decide)return phase==='proposal'?options.propose!(context):options.audit!(context,proposal!);
   if(!reservation)throw Error('CONTENT_REQUIREMENTS_EFFECT_CHANGED');
   return withAccountedModel(projects.store,reservation.reservation,()=>phase==='proposal'?runRequirementsProposal(context,reservation.maxOutputTokens,env,fence):runRequirementsAudit(context,proposal!,reservation.maxOutputTokens,env,fence));
  });await fence();return output;
 }
 const proposal=guardRequirementsProposal(await effect('proposal'),context);await fence();const proposalRef=await projects.index.immutable(p+'content-requirements-proposal',proposal);
 const audit=guardRequirementsAudit(await effect('audit',proposal),context,proposal),requirements=approvedRequirements(context,proposal,audit);await fence();const auditRef=await projects.index.immutable(p+'content-requirements-audit',audit);
 const candidate=RecordSchema.parse({schemaVersion:1,operationId,consentEpoch:epoch,understandingRef:control.understandingRef,contextRef,proposalRef,auditRef,requirements,scope:'source_requirements_only',productionApproval:false});await fence();
 if(canonicalHash(await createOrRead(projects.store,p+'content-requirements-v1-stage',candidate))!==canonicalHash(candidate))throw Error('CONTENT_REQUIREMENTS_BASELINE_CHANGED');
 const saved=await loadContentRequirements(projects.store,projectId,revisionId,expected);await fence();return saved;
}
