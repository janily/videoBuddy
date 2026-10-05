import {expect,it} from 'vitest';
import {compileApprovedDeliveryChecks} from '@/services/video/quality/approved-delivery';
import {filmDeliveryPolicy,validateNewDelivery} from '@/services/video/quality/delivery';
import {canonicalHash} from '@/services/video/domain/hash';
import type {FilmTimeline} from '@/contracts/video/film';
const timeline:FilmTimeline={fps:24,totalFrames:480,sampleRate:48000,sections:[],shots:[],cues:[],narration:[],music:[],foley:[],captions:[],intentionalBlackRanges:[],intentionalSilenceRanges:[]};
const sha='a'.repeat(64),policy={...filmDeliveryPolicy(timeline,'mvp'),audioIntent:'voiced' as const,captions:true};
const composition={movie:{technicalQa:{sha256:sha},loudness:{status:'pass',filmSha256:sha}},postMix:{status:'pass',filmSha256:sha}};
const visual={filmSha256:sha,result:'pass' as const,criticalFactsResult:'pass' as const};
const content={report:{filmSha256:sha,result:'pass' as const,scope:'two_round_provided_frames_and_verified_transcripts' as const,deliveryEligible:false as const},ref:'content'};
const core={filmSha256:sha,fontCoverage:'pass' as const,subtitleSync:'pass' as const,license:'pass' as const,ref:'checked-package'};
it('publishes MVP only with separate core proofs and checked final narration, keeping C2 limitations explicit',()=>{
 const checks=compileApprovedDeliveryChecks(policy,composition,visual,'technical','visual',content,core);
 expect(validateNewDelivery({policy,expectedPolicySha256:canonicalHash(policy),expectedFileSha256:sha,actualFileSha256:sha,checks}).status).toBe('passed');
 for(const rule of ['visual_review','listening_review'])expect(checks.find(c=>c.ruleId===rule)).toMatchObject({severity:'warning',result:'not_checked'});
 for(const missing of ['license','fontCoverage','subtitleSync'] as const){const incomplete={...core,[missing]:'not_checked' as const};expect(()=>validateNewDelivery({policy,expectedPolicySha256:canonicalHash(policy),expectedFileSha256:sha,actualFileSha256:sha,checks:compileApprovedDeliveryChecks(policy,composition,visual,'t','v',content,incomplete)})).toThrow('QUALITY_BLOCKED')}
 const unreviewed=compileApprovedDeliveryChecks(policy,{...composition,postMix:{status:'not_checked',filmSha256:sha}},visual,'t','v',content,core);expect(unreviewed.find(c=>c.ruleId==='postmix_narration')?.result).toBe('not_checked');
});
it('does not attach another movie proof or downgrade an observed visual/content failure',()=>{
 expect(()=>compileApprovedDeliveryChecks(policy,composition,visual,'t','v',content,{...core,filmSha256:'b'.repeat(64)})).toThrow('RENDER_OUTPUT_CHANGED');
 const checks=compileApprovedDeliveryChecks(policy,composition,{...visual,result:'fail'},'t','v',content,core);
 expect(()=>validateNewDelivery({policy,expectedPolicySha256:canonicalHash(policy),expectedFileSha256:sha,actualFileSha256:sha,checks})).toThrow('QUALITY_BLOCKED');
});
