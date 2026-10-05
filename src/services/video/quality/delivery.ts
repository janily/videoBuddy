import{z}from 'zod';
import{canonicalHash}from '@/services/video/domain/hash';
import{qualityGate,type QualityCheck}from './publish-gate';
import type{Understanding}from '@/contracts/video/domain';
import type{FilmTimeline}from '@/contracts/video/film';

export const mandatoryDeliveryRules=[
 'decode','media_metadata','duration','file_hash','source_integrity','resource_ready','license','critical_facts',
 'visual_review','listening_review','loudness','true_peak','subtitle_sync','font_coverage'
] as const;
const Digest=z.string().regex(/^[a-f0-9]{64}$/);
export const mvpDeliveryRules=['decode','media_metadata','duration','file_hash','source_integrity','resource_ready','license','critical_facts','sampled_visual_review','loudness','true_peak','subtitle_sync','font_coverage','postmix_narration','content_coverage'] as const;
const common={audioIntent:z.enum(['voiced','music','silent']),captions:z.boolean()};
export const DeliveryPolicySchema=z.discriminatedUnion('schemaVersion',[z.strictObject({schemaVersion:z.literal(1),...common,requiredRules:z.array(z.string().min(1)).min(mandatoryDeliveryRules.length)}),z.strictObject({schemaVersion:z.literal(2),profile:z.literal('mvp'),...common,requiredRules:z.array(z.string().min(1)).min(mvpDeliveryRules.length)})]);
const Check=z.strictObject({ruleId:z.string().min(1),result:z.enum(['pass','fail','not_checked','not_applicable','waived']),severity:z.enum(['blocking','warning']),evidenceRefs:z.array(z.string().min(1)),reason:z.string().optional(),waiverActor:z.string().optional()});
export type DeliveryPolicy=z.input<typeof DeliveryPolicySchema>;
export function filmDeliveryPolicy(timeline:FilmTimeline,profile:'full'|'mvp'='full'):DeliveryPolicy{
 return{...(profile==='mvp'?{schemaVersion:2 as const,profile:'mvp' as const}:{schemaVersion:1 as const}),audioIntent:timeline.narration.length?'voiced':timeline.music.length||timeline.foley.length?'music':'silent',captions:Boolean(timeline.captions.length),requiredRules:[...(profile==='mvp'?mvpDeliveryRules:mandatoryDeliveryRules)]};
}
export interface DeliveryInput{policy:DeliveryPolicy;expectedPolicySha256:string;expectedFileSha256:string;actualFileSha256:string;checks:QualityCheck[]}

export function validateDelivery(input:DeliveryInput){
 const policy=DeliveryPolicySchema.safeParse(input.policy),checks=z.array(Check).safeParse(input.checks);
 if(!policy.success||!checks.success||!Digest.safeParse(input.expectedPolicySha256).success||!Digest.safeParse(input.expectedFileSha256).success||!Digest.safeParse(input.actualFileSha256).success)throw Error('QUALITY_BLOCKED');
 const required=policy.data.requiredRules;
 if(new Set(required).size!==required.length||(policy.data.schemaVersion===2?mvpDeliveryRules:mandatoryDeliveryRules).some(rule=>!required.includes(rule))||canonicalHash(policy.data)!==input.expectedPolicySha256||input.actualFileSha256!==input.expectedFileSha256)throw Error('QUALITY_BLOCKED');
 if(policy.data.schemaVersion===2&&checks.data.some(c=>c.result==='fail'))throw Error('QUALITY_BLOCKED');
 const allowed:string[]=[];
 if(policy.data.schemaVersion===2&&policy.data.audioIntent!=='voiced')allowed.push('postmix_narration');
 if(policy.data.audioIntent==='silent'){
  const silence=checks.data.find(check=>check.ruleId==='decoded_silence');
  if(!silence||silence.severity!=='blocking'||silence.result!=='pass'||!silence.evidenceRefs.length)throw Error('QUALITY_BLOCKED');
  allowed.push('listening_review','loudness','true_peak');
 }
 if(!policy.data.captions)allowed.push('subtitle_sync');
 qualityGate(checks.data,allowed,required);
 return{status:'passed' as const,reportHash:canonicalHash({policySha256:input.expectedPolicySha256,fileSha256:input.actualFileSha256,checks:checks.data})};
}
/** New publications require content coverage without rewriting a previously
 * frozen policy or changing validation of existing historical results. */
export function validateNewDelivery(input:DeliveryInput){
 const outcome=validateDelivery(input);
 qualityGate(input.checks.filter(check=>check.ruleId==='content_coverage'),[],['content_coverage']);
 return outcome;
}

export function assertMvpProfile(understanding:Understanding){
 const p=understanding.preferences;if(p.styleSlug!=='crayon-book'||p.aspect!=='16:9'||p.durationSec<20||p.durationSec>30||!['zh-CN','en'].includes(p.language))throw Error('MVP_PROFILE_UNSUPPORTED');
}
export function verifyFrozenDeliveryPolicy(timeline:FilmTimeline,raw:unknown,understanding:Understanding){
 const policy=DeliveryPolicySchema.parse(raw);if(policy.schemaVersion===2)assertMvpProfile(understanding);
 const expected=filmDeliveryPolicy(timeline,policy.schemaVersion===2?'mvp':'full');if(canonicalHash(policy)!==canonicalHash(expected))throw Error('QUALITY_POLICY_CHANGED');return policy;
}
