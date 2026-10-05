import {z} from 'zod';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {FactSchema,ObjectRefSchema} from './domain';
import {guardContentRequirements} from './content-review';
const digest=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(120);
const result=z.enum(['pass','fail','not_checked']);
const assessment=z.strictObject({result,frameIds:z.array(id).max(24),reason:z.string().min(1).max(2000)});
const frame=z.strictObject({id,frame:z.number().int().nonnegative(),sha256:digest,bytes:z.number().int().positive().max(8*1024*1024)});
const sourceCriteria=z.strictObject({factsRef:ObjectRefSchema,contentRequirementsRef:ObjectRefSchema,facts:z.array(FactSchema).max(100),requirements:z.array(z.strictObject({factId:id,representation:z.enum(['literal','semantic']),exactText:z.array(z.string().min(1).max(3000)).max(100)})).max(100)});
const input=z.strictObject({filmSha256:digest,filmSpecSha256:digest,styleSlug:id,styleRulesHash:digest,round:z.union([z.literal(1),z.literal(2)]),frames:z.array(frame).min(1).max(24),facts:z.array(z.strictObject({id,text:z.string().min(1).max(2000)})).max(100),sourceCriteria:sourceCriteria.optional()});
const LegacyVisualReviewSchema=z.strictObject({
 schemaVersion:z.literal(1),filmSha256:digest,filmSpecSha256:digest,frameSetSha256:digest,styleSlug:id,styleRulesHash:digest,round:z.union([z.literal(1),z.literal(2)]),scope:z.literal('sampled_frames'),
 observations:z.array(z.strictObject({frameId:id,visibleText:z.array(z.string().min(1).max(2000)).max(100),issues:z.array(z.strictObject({kind:z.enum(['clipped_text','occlusion','fact_conflict','style_drift','unreadable','other']),severity:z.enum(['blocking','warning']),description:z.string().min(1).max(2000)})).max(100)})).min(1).max(24),
 facts:z.array(assessment.extend({factId:id})).max(100),style:assessment,readability:assessment,
});
const AuditedVisualReviewSchema=LegacyVisualReviewSchema.extend({schemaVersion:z.literal(2),sourceCriteriaSha256:digest,facts:z.array(assessment.extend({factId:id,literalChecks:z.array(assessment.extend({sourceExcerpt:z.string().min(1).max(3000)})).max(100)})).max(100)});
export const VisualReviewSchema=z.discriminatedUnion('schemaVersion',[LegacyVisualReviewSchema,AuditedVisualReviewSchema]);
export type VisualReview=z.infer<typeof VisualReviewSchema>;
export function assertPreviewReviewEligible(review:VisualReview){
 if(review.style.result!=='pass'||review.readability.result!=='pass'||review.facts.some(f=>f.result==='fail')||review.observations.some(o=>o.issues.some(i=>i.severity==='blocking')))throw Error('PREVIEW_QUALITY_BLOCKED');
}
export type VisualReviewContext=z.infer<typeof input>&{frameSetSha256:string};
function unique(values:string[]){return new Set(values).size===values.length}
export function visualReviewContext(raw:z.input<typeof input>):VisualReviewContext{
 const parsed=input.safeParse(raw);if(!parsed.success)throw Error('CRITIC_INPUT_INVALID');const value=parsed.data;
 if(!unique(value.frames.map(f=>f.id))||!unique(value.frames.map(f=>String(f.frame)))||!unique(value.facts.map(f=>f.id)))throw Error('CRITIC_INPUT_INVALID');
 if(value.sourceCriteria){
  const source=value.sourceCriteria;
  try{guardContentRequirements(source.requirements,source.facts)}catch{throw Error('CRITIC_BASELINE_CHANGED')}
  const manifest={schemaVersion:2,facts:source.facts,contentRequirementsRef:source.contentRequirementsRef};
  if(source.factsRef.mime!=='application/json'||source.contentRequirementsRef.mime!=='application/json'||!unique(source.facts.map(f=>f.id))||source.facts.some(f=>!['provided','confirmed'].includes(f.status))||canonicalHash(manifest)!==source.factsRef.sha256||Buffer.byteLength(canonicalJson(manifest))!==source.factsRef.bytes||canonicalHash(source.facts.filter(f=>f.critical||f.mustInclude).map(({id,text})=>({id,text})))!==canonicalHash(value.facts))throw Error('CRITIC_BASELINE_CHANGED');
 }
 return{...value,frameSetSha256:canonicalHash(value.frames)};
}
function normalized(text:string){return text.normalize('NFC').replace(/[\s，。！？、：；,.!?:;]/g,'')}
// Numeric punctuation and token boundaries carry meaning: 8日 is not 18日,
// and removing a decimal point must not turn 1.8元 into evidence for 18元.
function containsLiteral(observed:string,expected:string){
 const number=/[0-9０-９〇零一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟]/u;
 const numericContinuation=/[+＋\-−－.,，。．․﹒:：٫٬/／⁄%％‰‱eEｅＥ]/u;
 const normalize=(text:string)=>text.normalize('NFC').replace(/\s/g,'').replace(/[，。！？、：；,.!?:;]/g,(mark,index,whole)=>number.test(whole[index-1]??'')&&number.test(whole[index+1]??'')?mark:'');
 const text=normalize(observed),literal=normalize(expected);
 for(let index=text.indexOf(literal);index>=0;index=text.indexOf(literal,index+1)){
  const before=text[index-1]??'',after=text[index+literal.length]??'';
  if(number.test(literal[0])&&(number.test(before)||numericContinuation.test(before)))continue;
  if(number.test(literal.at(-1)!)&&(number.test(after)||numericContinuation.test(after)))continue;
  return true;
 }
 return false;
}
export function guardVisualReview(raw:unknown,context:VisualReviewContext):VisualReview{
 const {frameSetSha256,...input}=context,verified=visualReviewContext(input);if(verified.frameSetSha256!==frameSetSha256)throw Error('CRITIC_BASELINE_CHANGED');
 const parsed=VisualReviewSchema.safeParse(raw);if(!parsed.success)throw Error('CRITIC_REVIEW_INVALID');const value=parsed.data;
 if(context.sourceCriteria?value.schemaVersion!==2||value.sourceCriteriaSha256!==canonicalHash(context.sourceCriteria):value.schemaVersion!==1)throw Error('CRITIC_BASELINE_CHANGED');
 for(const field of ['filmSha256','filmSpecSha256','frameSetSha256','styleSlug','styleRulesHash','round'] as const)if(value[field]!==context[field])throw Error('CRITIC_BASELINE_CHANGED');
 const frames=new Set(context.frames.map(f=>f.id)),facts=new Set(context.facts.map(f=>f.id));
 if(value.observations.length!==frames.size||!unique(value.observations.map(o=>o.frameId))||value.observations.some(o=>!frames.has(o.frameId))||value.facts.length!==facts.size||!unique(value.facts.map(f=>f.factId))||value.facts.some(f=>!facts.has(f.factId)))throw Error('CRITIC_EVIDENCE_INVALID');
 for(const check of [...value.facts,value.style,value.readability])if(!unique(check.frameIds)||check.frameIds.some(id=>!frames.has(id))||check.result==='pass'&&!check.frameIds.length)throw Error('CRITIC_EVIDENCE_INVALID');
 if(value.schemaVersion===2){
  for(const check of value.facts){
   const requirement=context.sourceCriteria!.requirements.find(r=>r.factId===check.factId)!;
   if(check.literalChecks.length!==requirement.exactText.length||!unique(check.literalChecks.map(c=>c.sourceExcerpt.normalize('NFC')))||check.literalChecks.some(c=>!requirement.exactText.includes(c.sourceExcerpt)))throw Error('CRITIC_FACT_EVIDENCE_INVALID');
   for(const literal of check.literalChecks){
    if(!unique(literal.frameIds)||literal.frameIds.some(id=>!frames.has(id))||literal.result==='pass'&&(!literal.frameIds.length||!literal.frameIds.some(id=>value.observations.find(o=>o.frameId===id)!.visibleText.some(text=>containsLiteral(text,literal.sourceExcerpt)))))throw Error('CRITIC_FACT_EVIDENCE_INVALID');
   }
   if(check.result==='pass'&&(!check.literalChecks.length||check.literalChecks.some(c=>c.result!=='pass'||!c.frameIds.some(id=>check.frameIds.includes(id))))||check.result!=='fail'&&check.literalChecks.some(c=>c.result==='fail'))throw Error('CRITIC_FACT_EVIDENCE_INVALID');
  }
 }else for(const check of value.facts)if(check.result==='pass'){
  const expected=normalized(context.facts.find(f=>f.id===check.factId)!.text);
  if(!check.frameIds.some(id=>value.observations.find(o=>o.frameId===id)!.visibleText.some(text=>normalized(text).includes(expected))))throw Error('CRITIC_FACT_EVIDENCE_INVALID');
 }
 if(value.readability.result==='pass'&&value.observations.some(o=>o.issues.some(issue=>issue.severity==='blocking'&&['clipped_text','occlusion','unreadable'].includes(issue.kind)))||value.style.result==='pass'&&value.observations.some(o=>o.issues.some(issue=>issue.severity==='blocking'&&issue.kind==='style_drift')))throw Error('CRITIC_EVIDENCE_INVALID');
 return value;
}
export function visualReviewSchemaForContext(context:VisualReviewContext):z.ZodType<VisualReview>{return context.sourceCriteria?AuditedVisualReviewSchema:LegacyVisualReviewSchema}
