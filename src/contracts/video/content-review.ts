import {z} from 'zod';
import {assertRecognitionExpected} from '@/services/video/audio/recognition-policy';
import {FactSchema,ObjectRefSchema} from './domain';
import {canonicalHash} from '@/services/video/domain/hash';
const digest=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(120).refine(value=>value===value.trim()),text=z.string().min(1).max(3000).refine(value=>value.trim().length>0),result=z.enum(['pass','fail','not_checked']);
const frame=z.strictObject({id,frame:z.number().int().nonnegative(),sha256:digest,bytes:z.number().int().positive().max(8*1024*1024)});
const transcript=z.strictObject({id,startSample:z.number().int().nonnegative(),endSample:z.number().int().positive(),audioSha256:digest,text,verification:z.enum(['pass','trusted_review','trusted_policy']),spokenTextEvidence:z.strictObject({policy:z.literal('mandarin_pronunciation_v1'),expectedText:text,sourceRef:ObjectRefSchema}).optional()});
const requirement=z.strictObject({factId:id,representation:z.enum(['literal','semantic']),exactText:z.array(text).max(100)});
const Input=z.strictObject({filmSha256:digest,filmSpecSha256:digest,factsManifestSha256:digest,contentRequirementsRef:ObjectRefSchema.optional(),fps:z.union([z.literal(24),z.literal(30),z.literal(60)]),totalFrames:z.number().int().positive(),facts:z.array(FactSchema).max(100),frames:z.array(frame).min(1).max(24),transcripts:z.array(transcript).max(200),requirements:z.array(requirement).max(100).optional(),reviewBatch:z.strictObject({round:z.union([z.literal(1),z.literal(2)]),index:z.number().int().nonnegative()}).optional()});
export type ContentReviewContext=Omit<z.infer<typeof Input>,'requirements'>&{requirements:z.infer<typeof requirement>[];contextSha256:string};
const evidence=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('frame_scene'),frameId:id,quote:text}),
 z.strictObject({kind:z.literal('frame_text'),frameId:id,quote:text}),
 z.strictObject({kind:z.literal('transcript'),transcriptId:id,quote:text}),
]);
export const ContentReviewSchema=z.strictObject({schemaVersion:z.literal(1),contextSha256:digest,scope:z.literal('provided_frames_and_verified_transcripts'),
 observations:z.array(z.strictObject({frameId:id,description:text,visibleText:z.array(text).max(100)})).min(1).max(24),
 facts:z.array(z.strictObject({factId:id,result,coverage:z.enum(['complete','partial','none']),reason:text,evidence:z.array(evidence).max(100),literalChecks:z.array(z.strictObject({sourceExcerpt:text,result,evidence:z.array(evidence).max(24),reason:text})).max(100)})).max(100),
 conflicts:z.array(z.strictObject({factId:id,description:text,frameIds:z.array(id).max(24),transcriptIds:z.array(id).max(200)})).max(100),
});
export type ContentReview=z.infer<typeof ContentReviewSchema>;
function unique(ids:string[]){return new Set(ids).size===ids.length}
function normalized(value:string){return value.normalize('NFC').replace(/[\s，。！？、：；,.!?:;]/g,'')}
/** Shared source-freezing and review boundary: reject unusable literal anchors
 * before a creative package can make them immutable. */
export function guardContentRequirements(raw:unknown,facts:ReadonlyArray<{id:string;text:string}>){
 const parsed=z.array(requirement).max(100).safeParse(raw);if(!parsed.success)throw Error('CONTENT_INPUT_INVALID');const requirements=parsed.data;
 if(requirements.length!==facts.length||!unique(requirements.map(r=>r.factId))||requirements.some(r=>{const fact=facts.find(f=>f.id===r.factId);return!fact||r.representation==='literal'&&!r.exactText.length||!unique(r.exactText.map(s=>s.normalize('NFC')))||r.exactText.some(t=>!normalized(t)||!fact.text.normalize('NFC').includes(t.normalize('NFC')))}))throw Error('CONTENT_INPUT_INVALID');
 return requirements;
}
/** Caller must load the complete immutable facts manifest and verified physical
 * evidence. The digest prevents silently dropping facts from that manifest. */
export function contentReviewContext(raw:unknown):ContentReviewContext{
 const parsed=Input.safeParse(raw);if(!parsed.success)throw Error('CONTENT_INPUT_INVALID');const value={...parsed.data,requirements:parsed.data.requirements??parsed.data.facts.map(f=>({factId:f.id,representation:'literal' as const,exactText:[f.text]}))},totalSamples=value.totalFrames*48000/value.fps;
 if(value.totalFrames<20*value.fps||value.totalFrames>120*value.fps||value.totalFrames%value.fps||!Number.isSafeInteger(totalSamples)||!unique(value.facts.map(f=>f.id))||value.facts.some(f=>f.id.length>120||f.id!==f.id.trim()||!f.text.trim())||!unique(value.frames.map(f=>f.id))||!unique(value.transcripts.map(t=>t.id))||value.frames.some((f,i)=>f.frame>=value.totalFrames||i>0&&f.frame<=value.frames[i-1].frame)||value.transcripts.some(t=>t.startSample>=t.endSample||t.endSample>totalSamples))throw Error('CONTENT_INPUT_INVALID');
 const manifest=value.contentRequirementsRef?{schemaVersion:2,facts:value.facts,contentRequirementsRef:value.contentRequirementsRef}:{schemaVersion:1,facts:value.facts};
 if(canonicalHash(manifest)!==value.factsManifestSha256)throw Error('CONTENT_INPUT_CHANGED');
 for(const line of value.transcripts)if(line.spokenTextEvidence){if(line.verification!=='pass'||line.spokenTextEvidence.sourceRef.mime!=='application/json'||/[\p{N}A-Za-z]/u.test(line.spokenTextEvidence.expectedText+line.text))throw Error('CONTENT_INPUT_INVALID');assertRecognitionExpected(line.spokenTextEvidence.expectedText,line.spokenTextEvidence.expectedText,line.text,line.spokenTextEvidence.policy)}
 guardContentRequirements(value.requirements,value.facts);
 return{...value,contextSha256:canonicalHash(value)};
}
/** Validates references and literal quotations, not the truth of an arbitrary
 * scene description. Only the independent actual-image Critic supplies it.
 * This limited-scope review never replaces the existing visual literal guard. */
export function guardContentReview(raw:unknown,context:ContentReviewContext):ContentReview{
 const {contextSha256,...input}=context,verified=contentReviewContext(input);if(verified.contextSha256!==contextSha256)throw Error('CONTENT_INPUT_CHANGED');
 const parsed=ContentReviewSchema.safeParse(raw);if(!parsed.success)throw Error('CONTENT_REVIEW_INVALID');const value=parsed.data;
 if(value.contextSha256!==contextSha256)throw Error('CONTENT_BASELINE_CHANGED');
 const frames=new Set(context.frames.map(f=>f.id)),facts=new Map(context.facts.map(f=>[f.id,f])),transcripts=new Map(context.transcripts.map(t=>[t.id,t]));
 if(value.observations.length!==frames.size||!unique(value.observations.map(o=>o.frameId))||value.observations.some(o=>!frames.has(o.frameId))||value.facts.length!==facts.size||!unique(value.facts.map(f=>f.factId))||value.facts.some(f=>!facts.has(f.factId)))throw Error('CONTENT_EVIDENCE_INVALID');
 const observations=new Map(value.observations.map(o=>[o.frameId,o]));
 function assertEvidence(items:z.infer<typeof evidence>[]){
  if(!unique(items.map(item=>canonicalHash(item))))throw Error('CONTENT_EVIDENCE_INVALID');
  for(const item of items){
   const texts=item.kind==='transcript'?[transcripts.get(item.transcriptId)?.text]:item.kind==='frame_scene'?[observations.get(item.frameId)?.description]:observations.get(item.frameId)?.visibleText;
   if(!texts?.some(value=>value?.normalize('NFC').includes(item.quote.normalize('NFC'))))throw Error('CONTENT_EVIDENCE_INVALID');
  }
 }
 for(const check of value.facts){
  assertEvidence(check.evidence);
  const fact=facts.get(check.factId)!,required=context.requirements.find(r=>r.factId===check.factId)!.exactText;
  if(check.literalChecks.length!==required.length||!unique(check.literalChecks.map(l=>l.sourceExcerpt.normalize('NFC')))||check.literalChecks.some(l=>!required.some(t=>t.normalize('NFC')===l.sourceExcerpt.normalize('NFC'))))throw Error('CONTENT_LITERAL_EVIDENCE_INVALID');
  if(check.result==='pass'&&(check.coverage!=='complete'||!check.evidence.length||fact.status==='conflicting'||check.literalChecks.some(l=>l.result!=='pass')))throw Error('CONTENT_EVIDENCE_INVALID');
  for(const literal of check.literalChecks){
   assertEvidence(literal.evidence);
   if(!normalized(literal.sourceExcerpt)||!fact.text.normalize('NFC').includes(literal.sourceExcerpt.normalize('NFC')))throw Error('CONTENT_LITERAL_EVIDENCE_INVALID');
   if(literal.result==='pass'&&(!literal.evidence.length||literal.evidence.some(item=>item.kind==='frame_scene')||literal.evidence.some(item=>{if(normalized(item.quote).includes(normalized(literal.sourceExcerpt)))return false;const line=item.kind==='transcript'?transcripts.get(item.transcriptId):undefined;return !line?.spokenTextEvidence||normalized(line.spokenTextEvidence.expectedText)!==normalized(literal.sourceExcerpt)||normalized(item.quote)!==normalized(line.text)})))throw Error('CONTENT_LITERAL_EVIDENCE_INVALID');
  }
 }
 for(const conflict of value.conflicts){
  if(!facts.has(conflict.factId)||!unique(conflict.frameIds)||!unique(conflict.transcriptIds)||!conflict.frameIds.length&&!conflict.transcriptIds.length||conflict.frameIds.some(id=>!frames.has(id))||conflict.transcriptIds.some(id=>!transcripts.has(id))||value.facts.find(f=>f.factId===conflict.factId)!.result==='pass')throw Error('CONTENT_EVIDENCE_INVALID');
 }
 return value;
}
