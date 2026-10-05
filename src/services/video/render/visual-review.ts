import type {ProjectStore} from '@/services/video/storage/project-store';
import type {Environment} from '@/services/video/config/environment';
import {readConfiguration,requireGeneration} from '@/services/video/config/environment';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {StoreMissing,createOrRead} from '@/services/video/storage/atomic-store';
import {readNarrationJson} from '@/services/video/audio/narration-package';
import {reserveModelBudget,modelLimits,type ModelLimits} from '@/services/video/budget/model-budget';
import {withAccountedModel} from '@/services/video/budget/model-call';
import {runEffect} from '@/services/video/commands/effect-ledger';
import {guardVisualReview,type VisualReviewContext,type VisualReview} from '@/contracts/video/visual-review';
import type {ObjectRef} from '@/contracts/video/domain';
import {runVisualCritic,prepareVisualCriticInput} from '@/mastra/video/critic';
import {loadStageKnowledge} from '@/services/video/styles/knowledge-loader';
import {aggregateWholeVisualReviews} from '@/services/video/quality/whole-visual-plan';
import {VisualEvidenceSchema,readVisualEvidence} from '@/services/video/quality/visual-evidence';
import {assertApprovedRenderFence} from './approved-inputs';
import {prepareApprovedVisualEvidence} from './visual-evidence';

interface BatchReviewRecord{schemaVersion:1;inputHash:string;compositionHash:string;contextRef:ObjectRef;evidenceRef:ObjectRef;reviewRef:ObjectRef}
type Options=Parameters<typeof prepareApprovedVisualEvidence>[5]&{limits?:ModelLimits;decide?:(context:VisualReviewContext,images:ReadonlyMap<string,Uint8Array>)=>Promise<VisualReview>};
// A real model result remains a sampled visual judgment. Listening and the
// other mandatory delivery checks are intentionally independent gates.
export async function reviewApprovedWholeFilm(projects:ProjectStore,owner:string,projectId:string,operationId:string,expectedFence:number,options:Options){
 const prepared=await prepareApprovedVisualEvidence(projects,owner,projectId,operationId,expectedFence,options),{record,inputs,baseline}=prepared,{root}=options,env:Environment=options.env||process.env;
 const prefix=`projects/${projectId}/approvals/${inputs.approval.approvalId}/`,entries=[],reviews=[];
 for(const batch of record.batches){
  await assertApprovedRenderFence(projects,inputs);
  const context=await readNarrationJson(projects.store,batch.contextRef,prefix+'visual-context/') as VisualReviewContext,evidence=VisualEvidenceSchema.parse(await readNarrationJson(projects.store,batch.evidenceRef,prefix+'visual-frame-evidence/'));
  const images=await (options.readImages||readVisualEvidence)(root,evidence),stageKey=canonicalHash({inputHash:inputs.inputHash,compositionHash:record.compositionHash,contextRef:batch.contextRef,evidenceRef:batch.evidenceRef}),key=prefix+'visual-review-batches-v1/'+stageKey;
  let saved:BatchReviewRecord|undefined;try{saved=(await projects.store.readFresh<BatchReviewRecord>(key)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
  let review:VisualReview;
  if(saved){
   if(saved.schemaVersion!==1||saved.inputHash!==inputs.inputHash||saved.compositionHash!==record.compositionHash||canonicalHash(saved.contextRef)!==canonicalHash(batch.contextRef)||canonicalHash(saved.evidenceRef)!==canonicalHash(batch.evidenceRef))throw Error('CRITIC_BASELINE_CHANGED');
   review=guardVisualReview(await readNarrationJson(projects.store,saved.reviewRef,prefix+'visual-review/'),context);
  }else{
   if(options.mustExist)throw Error('CRITIC_REVIEW_MISSING');
   const effectKey=`projects/${projectId}/operations/${operationId}/effects/formal-visual-critic/${stageKey}`;
   let prior:unknown;try{prior=(await projects.store.readFresh(effectKey)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
   let execute:()=>Promise<VisualReview>;
   if(options.decide){const decide=options.decide;execute=()=>decide(context,images)}else{
    if(prior===undefined){
     requireGeneration(readConfiguration(env));await prepareVisualCriticInput(context,images,8000);await assertApprovedRenderFence(projects,inputs);const knowledge=await loadStageKnowledge(context.styleSlug,'style');
     const reservation=await reserveModelBudget(projects.store,projectId,operationId+'-formal-critic-'+stageKey,{inputTokens:Buffer.byteLength(canonicalJson({context,styleRules:knowledge.rules}))+4096+context.frames.length*8192,outputTokens:8000},options.limits||modelLimits(env));
     execute=()=>withAccountedModel(projects.store,reservation.reservation,()=>runVisualCritic(context,images,reservation.maxOutputTokens,env,{assertActive:()=>assertApprovedRenderFence(projects,inputs)}));
    }else execute=async()=>{throw Error('CRITIC_EFFECT_CHANGED')};
   }
   await assertApprovedRenderFence(projects,inputs);
   review=guardVisualReview(await runEffect(projects.store,effectKey,async()=>{await assertApprovedRenderFence(projects,inputs);return guardVisualReview(await execute(),context)}),context);
   await assertApprovedRenderFence(projects,inputs);await (options.readImages||readVisualEvidence)(root,evidence);
   const reviewRef=await projects.index.immutable(prefix+'visual-review',review),candidate:BatchReviewRecord={schemaVersion:1,inputHash:inputs.inputHash,compositionHash:record.compositionHash,contextRef:batch.contextRef,evidenceRef:batch.evidenceRef,reviewRef};
   saved=await createOrRead(projects.store,key,candidate);if(canonicalHash(saved)!==canonicalHash(candidate))throw Error('CRITIC_BASELINE_CHANGED');
  }
  await assertApprovedRenderFence(projects,inputs);entries.push({context,review});reviews.push(saved);
 }
 const report=aggregateWholeVisualReviews(record.plan,baseline,entries),candidate={schemaVersion:1 as const,inputHash:inputs.inputHash,evidenceHash:canonicalHash(record),reviews,report,deliveryEligible:false as const};
 // Recheck actual movie/receipt and every image after the model calls. A
 // replaced source cannot retain the already-collected visual judgments.
 const latest=await prepareApprovedVisualEvidence(projects,owner,projectId,operationId,expectedFence,{...options,mustExist:true});
 if(canonicalHash(latest.record)!==canonicalHash(record))throw Error('CRITIC_BASELINE_CHANGED');
 await assertApprovedRenderFence(projects,inputs);
 const saved=await createOrRead(projects.store,prefix+'whole-visual-review-v1-stage',candidate);if(canonicalHash(saved)!==canonicalHash(candidate))throw Error('CRITIC_BASELINE_CHANGED');return candidate;
}
