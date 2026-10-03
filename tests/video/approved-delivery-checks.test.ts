import {expect,it} from 'vitest';
import {compileApprovedDeliveryChecks} from '@/services/video/quality/approved-delivery';
import {mandatoryDeliveryRules,validateDelivery} from '@/services/video/quality/delivery';
import {canonicalHash} from '@/services/video/domain/hash';
const sha='a'.repeat(64),policy={schemaVersion:1 as const,audioIntent:'music' as const,captions:false,requiredRules:[...mandatoryDeliveryRules]};
const composition={movie:{technicalQa:{sha256:sha},loudness:{status:'pass' as const,filmSha256:sha}},postMix:{status:'not_applicable' as const,filmSha256:sha,reason:'no_narration'}};
const visual={filmSha256:sha,result:'pass' as const,criticalFactsResult:'pass' as const};
it('AT083 sampled visual pass and ASR not-applicable do not silently pass listening, motion, font or license checks',()=>{
 const checks=compileApprovedDeliveryChecks(policy,composition,visual,'approved/composite','approved/visual');
 for(const rule of ['visual_review','listening_review','font_coverage','license'])expect(checks.find(c=>c.ruleId===rule)?.result).toBe('not_checked');
 expect(()=>validateDelivery({policy,expectedPolicySha256:canonicalHash(policy),expectedFileSha256:sha,actualFileSha256:sha,checks})).toThrow('QUALITY_BLOCKED');
});
it('AT083 only intentional decoded silence permits listening N/A, music without narration still requires listening',()=>{
 const silent={...policy,audioIntent:'silent' as const},evidence={...composition,movie:{...composition.movie,loudness:{status:'not_applicable' as const,filmSha256:sha}},postMix:{...composition.postMix,reason:'intentional_silence'}};
 expect(compileApprovedDeliveryChecks(silent,evidence,visual,'c','v').find(c=>c.ruleId==='listening_review')?.result).toBe('not_applicable');
 expect(compileApprovedDeliveryChecks(silent,composition,visual,'c','v').find(c=>c.ruleId==='listening_review')?.result).toBe('not_checked');
});
it('AT038 fails wrong-film loudness/ASR/visual evidence and preserves observed fact or visual failures',()=>{
 for(const altered of [{...composition,movie:{...composition.movie,loudness:{...composition.movie.loudness,filmSha256:'b'.repeat(64)}}},{...composition,postMix:{...composition.postMix,filmSha256:'b'.repeat(64)}}])expect(()=>compileApprovedDeliveryChecks(policy,altered,visual,'c','v')).toThrow('RENDER_OUTPUT_CHANGED');
 expect(()=>compileApprovedDeliveryChecks(policy,composition,{...visual,filmSha256:'b'.repeat(64)},'c','v')).toThrow('RENDER_OUTPUT_CHANGED');
 const failed=compileApprovedDeliveryChecks(policy,composition,{...visual,result:'fail',criticalFactsResult:'fail'},'c','v');
 expect(failed.find(c=>c.ruleId==='critical_facts')?.result).toBe('fail');expect(failed.find(c=>c.ruleId==='visual_review')?.result).toBe('fail');
});
