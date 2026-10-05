import {expect,it} from 'vitest';
import {filmDeliveryPolicy,validateNewDelivery,verifyFrozenDeliveryPolicy} from '@/services/video/quality/delivery';
import {initialUnderstanding} from '@/contracts/video/domain';
import {canonicalHash} from '@/services/video/domain/hash';
import type {FilmTimeline} from '@/contracts/video/film';
const timeline:FilmTimeline={fps:24,totalFrames:480,sampleRate:48000,sections:[],shots:[],cues:[],narration:[],music:[],foley:[],captions:[],intentionalBlackRanges:[],intentionalSilenceRanges:[]};
it('freezes a separate MVP policy while leaving the full delivery contract intact',()=>{
 const full=filmDeliveryPolicy(timeline),mvp=filmDeliveryPolicy(timeline,'mvp');expect(full.schemaVersion).toBe(1);expect(mvp).toMatchObject({schemaVersion:2,profile:'mvp'});expect(mvp.requiredRules).toContain('sampled_visual_review');expect(mvp.requiredRules).toContain('license');expect(mvp.requiredRules).not.toContain('listening_review');
});
it('allows explicitly unreviewed continuous aesthetics only in MVP, never known failures or missing core evidence',()=>{
 const policy=filmDeliveryPolicy(timeline,'mvp'),sha='a'.repeat(64),checks=[...policy.requiredRules.map(ruleId=>({ruleId,result:'pass' as const,severity:'blocking' as const,evidenceRefs:['unit-protocol-only']})),{ruleId:'decoded_silence',result:'pass' as const,severity:'blocking' as const,evidenceRefs:['unit-protocol-only']},{ruleId:'visual_review',result:'not_checked' as const,severity:'warning' as const,evidenceRefs:[],reason:'Continuous motion is not certified.'}],input={policy,expectedPolicySha256:canonicalHash(policy),expectedFileSha256:sha,actualFileSha256:sha,checks};
 expect(validateNewDelivery(input).status).toBe('passed');expect(()=>validateNewDelivery({...input,checks:checks.filter(c=>c.ruleId!=='license')})).toThrow('QUALITY_BLOCKED');expect(()=>validateNewDelivery({...input,checks:checks.map(c=>c.ruleId==='visual_review'?{...c,result:'fail'}:c)})).toThrow('QUALITY_BLOCKED');expect(()=>validateNewDelivery({...input,policy:{...policy,requiredRules:policy.requiredRules.filter(r=>r!=='critical_facts')}})).toThrow('QUALITY_BLOCKED');
});
it('freezes small-batch sampling in new policies while preserving old frozen MVP policies',()=>{
 const u=initialUnderstanding();u.preferences={...u.preferences,styleSlug:'crayon-book',durationSec:20};
 const policy=filmDeliveryPolicy(timeline,'mvp');expect(policy).toHaveProperty('visualSampling','caption_shot_v3');
 expect(verifyFrozenDeliveryPolicy(timeline,policy,u)).toEqual(policy);
 const old=filmDeliveryPolicy(timeline,'mvp','legacy');expect(old).not.toHaveProperty('visualSampling');expect(verifyFrozenDeliveryPolicy(timeline,old,u)).toEqual(old);expect(canonicalHash(old)).not.toBe(canonicalHash(policy));
 expect(()=>verifyFrozenDeliveryPolicy(timeline,{...policy,visualSampling:'unsupported'},u)).toThrow();
 const four=filmDeliveryPolicy(timeline,'mvp','caption_shot_v2');expect(verifyFrozenDeliveryPolicy(timeline,four,u)).toEqual(four);expect(canonicalHash(four)).not.toBe(canonicalHash(policy));
});

it('preserves historical policies without opting them into content pronunciation evidence',()=>{
 const u=initialUnderstanding();u.preferences={...u.preferences,styleSlug:'crayon-book',durationSec:20};
 const current=filmDeliveryPolicy(timeline,'mvp');expect(current).toHaveProperty('contentNarration','mandarin_pronunciation_v1');
 const old=filmDeliveryPolicy(timeline,'mvp','caption_shot_v3','legacy');expect(old).not.toHaveProperty('contentNarration');expect(verifyFrozenDeliveryPolicy(timeline,old,u)).toEqual(old);expect(canonicalHash(current)).not.toBe(canonicalHash(old));
});
