import {z} from 'zod';
import {canonicalHash} from '@/services/video/domain/hash';
const digest=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(120);
const result=z.enum(['pass','fail','not_checked']);
const assessment=z.strictObject({result,frameIds:z.array(id).max(24),reason:z.string().min(1).max(2000)});
const frame=z.strictObject({id,frame:z.number().int().nonnegative(),sha256:digest,bytes:z.number().int().positive().max(8*1024*1024)});
const input=z.strictObject({filmSha256:digest,filmSpecSha256:digest,styleSlug:id,styleRulesHash:digest,round:z.union([z.literal(1),z.literal(2)]),frames:z.array(frame).min(1).max(24),facts:z.array(z.strictObject({id,text:z.string().min(1).max(2000)})).max(100)});
export const VisualReviewSchema=z.strictObject({
 schemaVersion:z.literal(1),filmSha256:digest,filmSpecSha256:digest,frameSetSha256:digest,styleSlug:id,styleRulesHash:digest,round:z.union([z.literal(1),z.literal(2)]),scope:z.literal('sampled_frames'),
 observations:z.array(z.strictObject({frameId:id,visibleText:z.array(z.string().min(1).max(2000)).max(100),issues:z.array(z.strictObject({kind:z.enum(['clipped_text','occlusion','fact_conflict','style_drift','unreadable','other']),severity:z.enum(['blocking','warning']),description:z.string().min(1).max(2000)})).max(100)})).min(1).max(24),
 facts:z.array(assessment.extend({factId:id})).max(100),style:assessment,readability:assessment,
});
export type VisualReview=z.infer<typeof VisualReviewSchema>;
export function assertPreviewReviewEligible(review:VisualReview){
 if(review.style.result!=='pass'||review.readability.result!=='pass'||review.facts.some(f=>f.result==='fail')||review.observations.some(o=>o.issues.some(i=>i.severity==='blocking')))throw Error('PREVIEW_QUALITY_BLOCKED');
}
export type VisualReviewContext=z.infer<typeof input>&{frameSetSha256:string};
function unique(values:string[]){return new Set(values).size===values.length}
export function visualReviewContext(raw:z.input<typeof input>):VisualReviewContext{
 const parsed=input.safeParse(raw);if(!parsed.success)throw Error('CRITIC_INPUT_INVALID');const value=parsed.data;
 if(!unique(value.frames.map(f=>f.id))||!unique(value.frames.map(f=>String(f.frame)))||!unique(value.facts.map(f=>f.id)))throw Error('CRITIC_INPUT_INVALID');
 return{...value,frameSetSha256:canonicalHash(value.frames)};
}
function normalized(text:string){return text.normalize('NFC').replace(/[\s，。！？、：；,.!?:;]/g,'')}
export function guardVisualReview(raw:unknown,context:VisualReviewContext):VisualReview{
 const parsed=VisualReviewSchema.safeParse(raw);if(!parsed.success)throw Error('CRITIC_REVIEW_INVALID');const value=parsed.data;
 for(const field of ['filmSha256','filmSpecSha256','frameSetSha256','styleSlug','styleRulesHash','round'] as const)if(value[field]!==context[field])throw Error('CRITIC_BASELINE_CHANGED');
 const frames=new Set(context.frames.map(f=>f.id)),facts=new Set(context.facts.map(f=>f.id));
 if(value.observations.length!==frames.size||!unique(value.observations.map(o=>o.frameId))||value.observations.some(o=>!frames.has(o.frameId))||value.facts.length!==facts.size||!unique(value.facts.map(f=>f.factId))||value.facts.some(f=>!facts.has(f.factId)))throw Error('CRITIC_EVIDENCE_INVALID');
 for(const check of [...value.facts,value.style,value.readability])if(!unique(check.frameIds)||check.frameIds.some(id=>!frames.has(id))||check.result==='pass'&&!check.frameIds.length)throw Error('CRITIC_EVIDENCE_INVALID');
 for(const check of value.facts)if(check.result==='pass'){
  const expected=normalized(context.facts.find(f=>f.id===check.factId)!.text);
  if(!check.frameIds.some(id=>value.observations.find(o=>o.frameId===id)!.visibleText.some(text=>normalized(text).includes(expected))))throw Error('CRITIC_FACT_EVIDENCE_INVALID');
 }
 if(value.readability.result==='pass'&&value.observations.some(o=>o.issues.some(issue=>issue.severity==='blocking'&&['clipped_text','occlusion','unreadable'].includes(issue.kind)))||value.style.result==='pass'&&value.observations.some(o=>o.issues.some(issue=>issue.severity==='blocking'&&issue.kind==='style_drift')))throw Error('CRITIC_EVIDENCE_INVALID');
 return value;
}
