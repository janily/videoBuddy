import {expect,it} from 'vitest';
import {wholeFilmVisualPlan,aggregateWholeVisualReviews} from '@/services/video/quality/whole-visual-plan';
import {visualReviewContext,type VisualReview} from '@/contracts/video/visual-review';

const timeline={fps:24 as const,totalFrames:480,shots:[{id:'one',startFrame:0,endFrame:240},{id:'two',startFrame:240,endFrame:480}],captions:[{startFrame:15,endFrame:95,stableReadableStartFrame:20}]};
it('derives both rounds from the frozen clock, conservatively covers whole shots and keeps captions and endpoints',()=>{
 const plan=wholeFilmVisualPlan(timeline);
 expect(plan.actionCoverage).toBe('entire_shots');expect(plan.rounds).toHaveLength(2);
 for(const round of plan.rounds){
  const frames=round.batches.flatMap(batch=>batch.frames);
  expect(frames).toEqual(round.frames);expect(new Set(frames).size).toBe(frames.length);
  expect(round.batches.every(batch=>batch.frames.length<=8)).toBe(true);
  for(const frame of [0,15,20,94,239,240,479])expect(frames).toContain(frame);
  for(let n=1;n<frames.length;n++)expect(frames[n]-frames[n-1]).toBeLessThanOrEqual(5);
 }
 expect(plan.rounds[1].frames).toContain(12);
 expect(()=>wholeFilmVisualPlan({...timeline,shots:[timeline.shots[0]]})).toThrow('VISUAL_SAMPLE_INVALID');
 expect(()=>wholeFilmVisualPlan({...timeline,captions:[{startFrame:15,endFrame:95,stableReadableStartFrame:100}]})).toThrow('VISUAL_SAMPLE_INVALID');
});
function report(context:ReturnType<typeof visualReviewContext>):VisualReview{
 return{schemaVersion:1,filmSha256:context.filmSha256,filmSpecSha256:context.filmSpecSha256,frameSetSha256:context.frameSetSha256,styleSlug:context.styleSlug,styleRulesHash:context.styleRulesHash,round:context.round,scope:'sampled_frames',observations:context.frames.map(f=>({frameId:f.id,visibleText:['Known fact'],issues:[]})),facts:context.facts.map(f=>({factId:f.id,result:'pass',frameIds:[context.frames[0].id],reason:'visible'})),style:{result:'pass',frameIds:[context.frames[0].id],reason:'visible'},readability:{result:'pass',frameIds:[context.frames[0].id],reason:'visible'}};
}
it('requires exact two-round batch coverage and bound reviews, preserving failures and unknown facts',()=>{
 const plan=wholeFilmVisualPlan(timeline),baseline={filmSha256:'a'.repeat(64),filmSpecSha256:'b'.repeat(64),styleSlug:'swiss-motion',styleRulesHash:'c'.repeat(64),facts:[{id:'fact',text:'Known fact'}]};
 const entries=plan.rounds.flatMap(round=>round.batches.map(batch=>{
  const context=visualReviewContext({...baseline,round:round.round,frames:batch.frames.map(frame=>({id:'frame-'+frame,frame,sha256:'d'.repeat(64),bytes:100}))});return{context,review:report(context)};
 }));
 expect(aggregateWholeVisualReviews(plan,baseline,entries).result).toBe('pass');
 expect(()=>aggregateWholeVisualReviews(plan,baseline,entries.slice(1))).toThrow('WHOLE_VISUAL_COVERAGE_MISSING');
 const wrong=structuredClone(entries);wrong[0].context.filmSha256='e'.repeat(64);wrong[0].review.filmSha256='e'.repeat(64);
 expect(()=>aggregateWholeVisualReviews(plan,baseline,wrong)).toThrow('CRITIC_BASELINE_CHANGED');
 const failed=structuredClone(entries);failed[0].review.style.result='fail';
 expect(aggregateWholeVisualReviews(plan,baseline,failed).result).toBe('fail');
 const conflict=structuredClone(entries);conflict[0].review.observations[0].issues.push({kind:'fact_conflict',severity:'warning',description:'A required date contradicts the frozen source'});
 expect(aggregateWholeVisualReviews(plan,baseline,conflict)).toMatchObject({result:'fail',criticalFactsResult:'fail'});
 const unknown=structuredClone(entries);for(const item of unknown){item.review.facts[0].result='not_checked';item.review.facts[0].frameIds=[]}
 expect(aggregateWholeVisualReviews(plan,baseline,unknown)).toMatchObject({result:'not_checked',facts:[{factId:'fact',result:'not_checked'}]});
});
