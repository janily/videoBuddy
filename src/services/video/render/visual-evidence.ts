import type {ProjectStore} from '@/services/video/storage/project-store';
import type {Environment} from '@/services/video/config/environment';
import {canonicalHash} from '@/services/video/domain/hash';
import {createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
import {visualReviewContext} from '@/contracts/video/visual-review';
import {getStyle} from '@/services/video/styles/registry';
import {wholeFilmVisualPlan} from '@/services/video/quality/whole-visual-plan';
import {extractVisualFrames,readVisualEvidence} from '@/services/video/quality/visual-evidence';
import {assertApprovedRenderFence,loadApprovedRenderInputs} from './approved-inputs';
import {composeApprovedFilm} from './composition';

interface Options{root:string;env?:Environment;mustExist?:boolean;compose?:typeof composeApprovedFilm;extract?:typeof extractVisualFrames;readImages?:typeof readVisualEvidence}
// Evidence collection is model-free. It does not turn image extraction into a
// quality pass or relax formal rendering into the preview production fence.
export async function prepareApprovedVisualEvidence(projects:ProjectStore,owner:string,projectId:string,operationId:string,expectedFence:number,options:Options){
 const {root}=options,env=options.env||process.env,inputs=await loadApprovedRenderInputs(projects,owner,projectId,operationId,expectedFence,{root,env});
 const plan=wholeFilmVisualPlan(inputs.frozen.timeline),prefix=`projects/${projectId}/approvals/${inputs.approval.approvalId}/`,key=prefix+'visual-evidence-v1-stage';
 let previous:unknown;try{previous=(await projects.store.readFresh(key)).value}catch(error){if(!(error instanceof StoreMissing))throw error}
 if(previous===undefined&&options.mustExist)throw Error('CRITIC_EVIDENCE_MISSING');
 const readOnly=options.mustExist||previous!==undefined;
 const composition=await (options.compose||composeApprovedFilm)(projects,owner,projectId,operationId,expectedFence,{root,env,mustExist:readOnly});
 if(composition.inputHash!==inputs.inputHash||composition.deliveryEligible!==false||composition.movie.qaStatus!=='semantic_not_checked')throw Error('CRITIC_BASELINE_CHANGED');
 const {movie}=composition,{width,height,totalFrames}=inputs.frozen.filmSpec.output;
 const baseline={filmSha256:movie.technicalQa.sha256,filmSpecSha256:inputs.bundle.filmSpecRef.sha256,styleSlug:inputs.frozen.filmSpec.style.slug,styleRulesHash:getStyle(inputs.frozen.filmSpec.style.slug).rulesHash,facts:inputs.frozen.facts.facts.filter(f=>f.critical||f.mustInclude).map(({id,text})=>({id,text}))};
 const batches=[];
 for(const round of plan.rounds)for(const batch of round.batches){
  const assertActive=()=>assertApprovedRenderFence(projects,inputs);await assertActive();
  const evidence=await (options.extract||extractVisualFrames)(root,{outputPath:movie.outputPath,sha256:baseline.filmSha256,width,height,totalFrames},batch.frames,'sha256:'+inputs.frozen.filmSpec.runtimeDigest,{assertActive,mustExist:readOnly});
  if(evidence.filmSha256!==baseline.filmSha256||evidence.runtimeDigest!==inputs.frozen.filmSpec.runtimeDigest||evidence.width!==width||evidence.height!==height||canonicalHash(evidence.frames.map(f=>f.frame))!==canonicalHash(batch.frames))throw Error('CRITIC_EVIDENCE_INVALID');
  await (options.readImages||readVisualEvidence)(root,evidence);
  const context=visualReviewContext({...baseline,round:round.round,frames:evidence.frames.map(({id,frame,sha256,bytes})=>({id,frame,sha256,bytes}))});
  await assertActive();
  const evidenceRef=await projects.index.immutable(prefix+'visual-frame-evidence',evidence),contextRef=await projects.index.immutable(prefix+'visual-context',context);
  batches.push({round:round.round,index:batch.index,evidenceRef,contextRef});
 }
 const record={schemaVersion:1 as const,inputHash:inputs.inputHash,compositionHash:canonicalHash(composition),plan,batches,qualityStatus:'not_reviewed' as const,deliveryEligible:false as const};
 if(previous!==undefined&&canonicalHash(previous)!==canonicalHash(record))throw Error('CRITIC_EVIDENCE_INVALID');
 const latest=await loadApprovedRenderInputs(projects,owner,projectId,operationId,expectedFence,{root,env});
 if(latest.inputHash!==inputs.inputHash)throw Error('RENDER_FENCED');
 const saved=await createOrRead(projects.store,key,record);if(canonicalHash(saved)!==canonicalHash(record))throw Error('CRITIC_EVIDENCE_INVALID');return{record,inputs,composition,baseline};
}
