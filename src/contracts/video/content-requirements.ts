import {z} from 'zod';
import {FactSchema} from './domain';
import {canonicalHash} from '@/services/video/domain/hash';
import {guardContentRequirements} from './content-review';
const digest=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(120),text=z.string().min(1).max(3000).refine(s=>Boolean(s.trim())),kind=z.enum(['literal','semantic','restriction']);
const input=z.strictObject({understandingSha256:digest,facts:z.array(FactSchema).max(100)});
const segment=z.strictObject({sourceText:z.string().min(1).max(2000),kind,reason:text});
export const RequirementsProposalSchema=z.strictObject({schemaVersion:z.literal(1),contextSha256:digest,facts:z.array(z.strictObject({factId:id,segments:z.array(segment).min(1).max(100)})).max(100)});
export const RequirementsAuditSchema=z.strictObject({schemaVersion:z.literal(1),contextSha256:digest,proposalSha256:digest,facts:z.array(z.strictObject({factId:id,segments:z.array(segment.omit({reason:true}).extend({result:z.enum(['accept','reject','not_checked']),reason:text})).min(1).max(100)})).max(100)});
export type RequirementsContext=z.infer<typeof input>&{contextSha256:string};
export type RequirementsProposal=z.infer<typeof RequirementsProposalSchema>;
export type RequirementsAudit=z.infer<typeof RequirementsAuditSchema>;
function unique(values:string[]){return new Set(values).size===values.length}
export function requirementsContext(raw:unknown):RequirementsContext{
 const parsed=input.safeParse(raw);if(!parsed.success)throw Error('CONTENT_REQUIREMENTS_INVALID');const value=parsed.data;
 if(!unique(value.facts.map(f=>f.id))||value.facts.some(f=>!f.text.trim()||f.id!==f.id.trim()||f.id.length>120||!['provided','confirmed'].includes(f.status)))throw Error('CONTENT_REQUIREMENTS_INVALID');
 return{...value,contextSha256:canonicalHash(value)};
}
function verifyContext(context:RequirementsContext){const{contextSha256,...raw}=context;if(requirementsContext(raw).contextSha256!==contextSha256)throw Error('CONTENT_REQUIREMENTS_BASELINE_CHANGED')}
/** Deterministic floors complement independent source analysis; this parser is
 * not a complete name/entity recognizer. Unknown names require literal treatment
 * by the classifier and independent auditor, never by the film reviewer. */
function literalFloors(source:string){
 const spans:Array<{start:number;end:number;sentenceSequence?:boolean}>=[];
 const digits='[0-9〇零一二三四五六七八九十百千万两]';
 const patterns=[new RegExp(`(?:${digits}{2,4}年)?${digits}{1,3}月${digits}{1,3}(?:日|号)`,'g'),new RegExp(`${digits}+(?:年|月|日|号|天|元|个|秒|分|人)`,'g'),/[￥¥$€£]?[-+−]?\d+(?:[.,]\d+)*(?:%|％)?/g,/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:\d{1,2}(?:st|nd|rd|th)?|[a-z]+(?:[ -][a-z]+)?)\b/gi];
 for(const pattern of patterns)for(const match of source.matchAll(pattern))spans.push({start:match.index,end:match.index+match[0].length});
 for(const pattern of [/“([^”]+)”/g,/‘([^’]+)’/g,/「([^」]+)」/g,/『([^』]+)』/g,/"([^"\n]+)"/g,/'([^'\n]+)'/g])for(const match of source.matchAll(pattern))if(match[1].trim()){
  const prefix=source.slice(0,match.index).split(/[“”‘’「」『』"'。！？；;，,]/).at(-1)??'';
  // Only an explicit narration quotation gets sentence-level verification.
  // Punctuation inside a title (e.g. 你好！李焕英) is part of its name.
  const sentenceSequence=/^\s*旁白(?:原文|与字幕|文本|是|为|[:：])/.test(prefix)&&!/(?:名字|名称|片名|电影名|标题|标语|品牌|型号|署名|片尾|结尾|画面)/.test(prefix);
  spans.push({start:match.index+1,end:match.index+1+match[1].length,sentenceSequence});
 }
 return spans;
}
export function guardRequirementsProposal(raw:unknown,context:RequirementsContext):RequirementsProposal{
 verifyContext(context);const parsed=RequirementsProposalSchema.safeParse(raw);if(!parsed.success)throw Error('CONTENT_REQUIREMENTS_INVALID');const value=parsed.data;
 if(value.contextSha256!==context.contextSha256)throw Error('CONTENT_REQUIREMENTS_BASELINE_CHANGED');
 if(value.facts.length!==context.facts.length||!unique(value.facts.map(f=>f.factId)))throw Error('CONTENT_REQUIREMENTS_INVALID');
 for(const fact of context.facts){
  const item=value.facts.find(f=>f.factId===fact.id);if(!item||item.segments.map(s=>s.sourceText).join('')!==fact.text||item.segments.some(s=>s.kind==='literal'&&!s.sourceText.trim()))throw Error('CONTENT_REQUIREMENTS_INVALID');
  let offset=0;const literals:Array<{start:number;end:number}>=[];for(const s of item.segments){const start=offset;offset+=s.sourceText.length;if(s.kind==='literal')literals.push({start,end:offset})}
  if(literalFloors(fact.text).some(floor=>{
   if(literals.some(span=>span.start<=floor.start&&span.end>=floor.end))return false;
   if(!floor.sentenceSequence)return true;
   // A multi-sentence quotation may appear as consecutive captions. Preserve
   // every character literally, joining only at complete sentence boundaries.
   // A name, date, number or unfinished sentence cannot use fragmented proof.
   let covered=floor.start;
   for(const span of literals){
    if(span.end<=covered)continue;
    if(span.start>covered)return true;
    covered=span.end;if(covered>=floor.end)return false;
    if(!/[。！？]$/.test(fact.text.slice(span.start,span.end)))return true;
   }
   return true;
  }))throw Error('CONTENT_REQUIREMENTS_LITERAL_MISSING');
 }
 return value;
}
export function guardRequirementsAudit(raw:unknown,context:RequirementsContext,proposal:RequirementsProposal):RequirementsAudit{
 guardRequirementsProposal(proposal,context);const parsed=RequirementsAuditSchema.safeParse(raw);if(!parsed.success)throw Error('CONTENT_REQUIREMENTS_INVALID');const value=parsed.data;
 if(value.contextSha256!==context.contextSha256||value.proposalSha256!==canonicalHash(proposal))throw Error('CONTENT_REQUIREMENTS_BASELINE_CHANGED');
 if(value.facts.length!==proposal.facts.length||!unique(value.facts.map(f=>f.factId)))throw Error('CONTENT_REQUIREMENTS_INVALID');
 for(const fact of proposal.facts){const item=value.facts.find(f=>f.factId===fact.factId);if(!item||canonicalHash(item.segments.map(({sourceText,kind})=>({sourceText,kind})))!==canonicalHash(fact.segments.map(({sourceText,kind})=>({sourceText,kind}))))throw Error('CONTENT_REQUIREMENTS_INVALID')}
 return value;
}
export function approvedRequirements(context:RequirementsContext,proposal:RequirementsProposal,audit:RequirementsAudit){
 guardRequirementsProposal(proposal,context);guardRequirementsAudit(audit,context,proposal);
 if(audit.facts.some(f=>f.segments.some(s=>s.result!=='accept')))throw Error('CONTENT_REQUIREMENTS_UNAPPROVED');
 const requirements=context.facts.map(f=>{const segments=proposal.facts.find(p=>p.factId===f.id)!.segments,seen=new Set<string>(),exactText=segments.filter(s=>s.kind==='literal').map(s=>s.sourceText).filter(text=>{const key=text.normalize('NFC');if(seen.has(key))return false;seen.add(key);return true});return{factId:f.id,representation:segments.every(s=>s.kind==='literal')?'literal' as const:'semantic' as const,exactText}});
 try{return guardContentRequirements(requirements,context.facts)}catch(error){if((error as Error).message==='CONTENT_INPUT_INVALID')throw Error('CONTENT_REQUIREMENTS_INVALID');throw error}
}
