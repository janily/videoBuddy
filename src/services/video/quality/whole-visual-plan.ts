import {z} from 'zod';
import {canonicalHash} from '@/services/video/domain/hash';
import {guardVisualReview,type VisualReview,type VisualReviewContext} from '@/contracts/video/visual-review';
import {visualSamplePlan} from './visual-evidence';

const range={startFrame:z.number().int().nonnegative(),endFrame:z.number().int().positive()};
const clockSchema=z.object({fps:z.union([z.literal(24),z.literal(30),z.literal(60)]),totalFrames:z.number().int().positive().max(7200),shots:z.array(z.object({id:z.string().min(1),...range})).min(1).max(80),captions:z.array(z.object({...range,stableReadableStartFrame:z.number().int().nonnegative()})).max(200)});
type Clock=z.input<typeof clockSchema>;
// No frozen action-window contract exists yet. Cover every shot at action
// cadence rather than inferring that undeclared actions need no inspection.
export function wholeFilmVisualPlan(raw:Clock){
 const parsed=clockSchema.safeParse(raw);if(!parsed.success)throw Error('VISUAL_SAMPLE_INVALID');const clock=parsed.data;
 if(clock.totalFrames<20*clock.fps||clock.totalFrames>120*clock.fps||clock.totalFrames%clock.fps||new Set(clock.shots.map(s=>s.id)).size!==clock.shots.length)throw Error('VISUAL_SAMPLE_INVALID');
 for(const cue of clock.captions)if(cue.startFrame>=cue.endFrame||cue.endFrame>clock.totalFrames||cue.stableReadableStartFrame<cue.startFrame||cue.stableReadableStartFrame>=cue.endFrame)throw Error('VISUAL_SAMPLE_INVALID');
 const rounds=([1,2] as const).map(round=>{
  const sampled=visualSamplePlan({fps:clock.fps,totalFrames:clock.totalFrames,shots:clock.shots,actions:clock.shots.map(({startFrame,endFrame})=>({startFrame,endFrame}))},round),set=new Set(sampled);
  for(const cue of clock.captions)for(const frame of [cue.startFrame,cue.stableReadableStartFrame,cue.endFrame-1])set.add(frame);
  const frames=[...set].sort((a,b)=>a-b),batches=[];
  for(let offset=0;offset<frames.length;offset+=8)batches.push({index:batches.length,frames:frames.slice(offset,offset+8)});
  return{round,frames,batches};
 });
 return{schemaVersion:1 as const,clock,actionCoverage:'entire_shots' as const,batchSize:8 as const,rounds};
}
/** MVP samples every shot and caption; no continuous action certification. */
export function mvpFilmVisualPlan(raw:Clock,sampling:'legacy'|'caption_shot_v2'|'caption_shot_v3'='legacy'){
 const full=wholeFilmVisualPlan(raw),clock=full.clock;
 if(clock.totalFrames>30*clock.fps)throw Error('MVP_PROFILE_UNSUPPORTED');
 const batchSize=sampling==='legacy'?8:sampling==='caption_shot_v2'?4:2;
 const rounds=([1,2] as const).map(round=>{
  const set=new Set<number>();
  if(sampling==='legacy'){
   for(const shot of clock.shots){const span=shot.endFrame-shot.startFrame;for(const frame of [shot.startFrame,shot.endFrame-1,shot.startFrame+Math.floor(span*(round===1?0.5:0.25))])set.add(frame)}
   for(const cue of clock.captions){const span=cue.endFrame-cue.stableReadableStartFrame;set.add(cue.stableReadableStartFrame+Math.floor(span*(round===1?0.5:0.25)));set.add(cue.endFrame-1)}
  }else{
   // Every caption has a physically readable sample in each independent round.
   // A caption frame can also represent its shot; uncaptained shots get a sample.
   for(const cue of clock.captions)set.add(cue.stableReadableStartFrame+Math.floor((cue.endFrame-cue.stableReadableStartFrame)*(round===1?0.5:0.25)));
   for(const shot of clock.shots)if(![...set].some(f=>f>=shot.startFrame&&f<shot.endFrame))set.add(shot.startFrame+Math.floor((shot.endFrame-shot.startFrame)*(round===1?0.5:0.25)));
  }
  const frames=[...set].sort((a,b)=>a-b),batches=[];for(let offset=0;offset<frames.length;offset+=batchSize)batches.push({index:batches.length,frames:frames.slice(offset,offset+batchSize)});
  return{round,frames,batches};
 });
 if(sampling==='caption_shot_v3')return{schemaVersion:4 as const,profile:'mvp' as const,sampling,clock,actionCoverage:'sampled_shots' as const,batchSize:2 as const,rounds};
 if(sampling==='caption_shot_v2')return{schemaVersion:3 as const,profile:'mvp' as const,sampling,clock,actionCoverage:'sampled_shots' as const,batchSize:4 as const,rounds};
 return{schemaVersion:2 as const,profile:'mvp' as const,clock,actionCoverage:'sampled_shots' as const,batchSize:8 as const,rounds};
}
export type WholeFilmVisualPlan=ReturnType<typeof wholeFilmVisualPlan>|ReturnType<typeof mvpFilmVisualPlan>;
export type VisualReviewBaseline=Omit<VisualReviewContext,'round'|'frames'|'frameSetSha256'>;
type Result='pass'|'fail'|'not_checked';
function combined(results:Result[]):Result{return results.includes('fail')?'fail':results.every(result=>result==='pass')?'pass':'not_checked'}
export function aggregateWholeVisualReviews(plan:WholeFilmVisualPlan,baseline:VisualReviewBaseline,entries:Array<{context:VisualReviewContext;review:VisualReview}>){
 if(canonicalHash(plan.schemaVersion===1?wholeFilmVisualPlan(plan.clock):mvpFilmVisualPlan(plan.clock,plan.schemaVersion===4?'caption_shot_v3':plan.schemaVersion===3?'caption_shot_v2':'legacy'))!==canonicalHash(plan))throw Error('WHOLE_VISUAL_PLAN_CHANGED');
 const batches=plan.rounds.flatMap(round=>round.batches.map(batch=>({round:round.round,frames:batch.frames}))),byBatch=new Map<string,VisualReview>();
 for(const entry of entries){
  const {context}=entry;
  for(const field of ['filmSha256','filmSpecSha256','styleSlug','styleRulesHash'] as const)if(context[field]!==baseline[field])throw Error('CRITIC_BASELINE_CHANGED');
  if(canonicalHash(context.facts)!==canonicalHash(baseline.facts))throw Error('CRITIC_BASELINE_CHANGED');
  if(canonicalHash(context.sourceCriteria||null)!==canonicalHash(baseline.sourceCriteria||null))throw Error('CRITIC_BASELINE_CHANGED');
  const key=canonicalHash({round:context.round,frames:context.frames.map(f=>f.frame)});
  if(byBatch.has(key)||!batches.some(batch=>canonicalHash(batch)===key))throw Error('WHOLE_VISUAL_COVERAGE_MISSING');
  byBatch.set(key,guardVisualReview(entry.review,context));
 }
 if(byBatch.size!==batches.length)throw Error('WHOLE_VISUAL_COVERAGE_MISSING');
 const reviews=batches.map(batch=>byBatch.get(canonicalHash(batch))!);
 const facts=baseline.facts.map(fact=>{
  const rounds=([1,2] as const).map(round=>{
   const checks=reviews.filter(review=>review.round===round).map(review=>review.facts.find(check=>check.factId===fact.id)!);
   const result:Result=checks.some(check=>check.result==='fail')?'fail':checks.some(check=>check.result==='pass')?'pass':'not_checked';
   return{round,result};
  });return{factId:fact.id,result:combined(rounds.map(check=>check.result)),rounds};
 });
 const style=combined(reviews.map(review=>review.style.result)),readability=combined(reviews.map(review=>review.readability.result)),blockingIssues=reviews.flatMap(review=>review.observations.flatMap(observation=>observation.issues.filter(issue=>issue.severity==='blocking').map(issue=>({round:review.round,frameId:observation.frameId,...issue}))));
 const factConflicts=reviews.flatMap(review=>review.observations.flatMap(observation=>observation.issues.filter(issue=>issue.kind==='fact_conflict').map(issue=>({round:review.round,frameId:observation.frameId,...issue}))));
 const literalFacts=baseline.sourceCriteria?baseline.facts.flatMap(f=>baseline.sourceCriteria!.requirements.find(r=>r.factId===f.id)!.exactText.map(sourceExcerpt=>{
  const rounds=([1,2] as const).map(round=>{const checks=reviews.filter(r=>r.round===round).map(r=>{if(r.schemaVersion!==2)throw Error('CRITIC_BASELINE_CHANGED');return r.facts.find(c=>c.factId===f.id)!.literalChecks.find(c=>c.sourceExcerpt===sourceExcerpt)!});return{round,result:checks.some(c=>c.result==='fail')?'fail' as const:checks.some(c=>c.result==='pass')?'pass' as const:'not_checked' as const}});
  return{factId:f.id,sourceExcerpt,result:combined(rounds.map(r=>r.result)),rounds};
 })):undefined;
 const literalFactsResult:Result=factConflicts.length||reviews.some(r=>r.facts.some(f=>f.result==='fail'))?'fail':combined(literalFacts?.map(c=>c.result)||[]);
 const criticalFactsResult:Result=baseline.sourceCriteria?literalFactsResult==='fail'?'fail':'not_checked':factConflicts.length?'fail':combined(facts.map(f=>f.result));
 return{schemaVersion:1 as const,filmSha256:baseline.filmSha256,filmSpecSha256:baseline.filmSpecSha256,planSha256:canonicalHash(plan),scope:'two_round_sampled_frames' as const,result:blockingIssues.length?'fail' as const:combined([style,readability,baseline.sourceCriteria?literalFactsResult:criticalFactsResult]),style,readability,criticalFactsResult,facts,...(literalFacts?{sourceCriteriaSha256:canonicalHash(baseline.sourceCriteria),sourceFactsManifestSha256:baseline.sourceCriteria!.factsRef.sha256,literalFactsResult,literalFacts}:{}),factConflicts,blockingIssues,batchCount:reviews.length,continuousMotion:'not_supplied' as const,audio:'not_supplied' as const,deliveryEligible:false as const};
}
