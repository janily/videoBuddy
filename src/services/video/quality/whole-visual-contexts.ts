import {visualReviewContext,type VisualReviewContext} from '@/contracts/video/visual-review';
import {canonicalHash} from '@/services/video/domain/hash';
import {VisualEvidenceSchema,type VisualEvidence} from './visual-evidence';
import {wholeFilmVisualPlan,type WholeFilmVisualPlan,type VisualReviewBaseline} from './whole-visual-plan';
export interface WholeVisualBatch{round:1|2;index:number;evidence:VisualEvidence}
/** Validate complete physical batch coverage before starting the first paid call.
 * Actual PNG bytes still require readVisualEvidence at the caller boundary. */
export function prepareWholeVisualContexts(plan:WholeFilmVisualPlan,baseline:VisualReviewBaseline,batches:WholeVisualBatch[],runtimeDigest:string):VisualReviewContext[]{
 if(canonicalHash(wholeFilmVisualPlan(plan.clock))!==canonicalHash(plan))throw Error('WHOLE_VISUAL_PLAN_CHANGED');
 const expected=plan.rounds.flatMap(r=>r.batches.map(b=>({round:r.round,index:b.index,frames:b.frames})));
 if(batches.length!==expected.length)throw Error('WHOLE_VISUAL_COVERAGE_MISSING');
 return expected.map((batch,index)=>{
  const actual=batches[index];
  const evidence=VisualEvidenceSchema.parse(actual.evidence);
  if(actual.round!==batch.round||actual.index!==batch.index||canonicalHash(evidence.frames.map(f=>f.frame))!==canonicalHash(batch.frames))throw Error('WHOLE_VISUAL_COVERAGE_MISSING');
  if(evidence.filmSha256!==baseline.filmSha256||evidence.runtimeDigest!==runtimeDigest)throw Error('CRITIC_BASELINE_CHANGED');
  return visualReviewContext({...baseline,round:batch.round,frames:evidence.frames.map(({id,frame,sha256,bytes})=>({id,frame,sha256,bytes}))});
 });
}
