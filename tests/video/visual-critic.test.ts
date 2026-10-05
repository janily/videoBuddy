import {expect,it} from 'vitest';
import {assertPreviewReviewEligible,guardVisualReview,visualReviewContext,type VisualReviewContext,type VisualReview} from '@/contracts/video/visual-review';
import {canonicalHash} from '@/services/video/domain/hash';
const d='a'.repeat(64),film='b'.repeat(64),rules='c'.repeat(64);
it('an actual failed sampled review blocks preview publication while retaining its evidence',()=>{
 expect(()=>assertPreviewReviewEligible(report())).not.toThrow();
 for(const field of ['style','readability'] as const){const failed=report();failed[field].result='fail';expect(()=>assertPreviewReviewEligible(failed)).toThrow('PREVIEW_QUALITY_BLOCKED')}
 const failed=report();failed.facts[0].result='fail';expect(()=>assertPreviewReviewEligible(failed)).toThrow('PREVIEW_QUALITY_BLOCKED');
 const unknown=report();unknown.style.result='not_checked';expect(()=>assertPreviewReviewEligible(unknown)).toThrow('PREVIEW_QUALITY_BLOCKED');
});
const context=visualReviewContext({filmSha256:film,filmSpecSha256:d,styleSlug:'crayon-book',styleRulesHash:rules,frames:[{id:'frame-24',frame:24,sha256:d,bytes:1000},{id:'frame-48',frame:48,sha256:rules,bytes:1200}],facts:[{id:'date',text:'2026年10月8日'},{id:'place',text:'上海青禾社区'}],round:1});
function report(c:VisualReviewContext=context):Extract<VisualReview,{schemaVersion:1}>{return{schemaVersion:1,filmSha256:c.filmSha256,filmSpecSha256:c.filmSpecSha256,frameSetSha256:c.frameSetSha256,styleSlug:c.styleSlug,styleRulesHash:c.styleRulesHash,round:c.round,scope:'sampled_frames',observations:c.frames.map(frame=>({frameId:frame.id,visibleText:['2026年10月8日','上海青禾社区'],issues:[]})),facts:c.facts.map(fact=>({factId:fact.id,result:'pass',frameIds:[c.frames[0].id],reason:'该帧可见完整文字'})),style:{result:'pass',frameIds:c.frames.map(f=>f.id),reason:'所示帧可见蜡笔材质'},readability:{result:'pass',frameIds:c.frames.map(f=>f.id),reason:'所示文字清晰完整'}}}
it('binds an independent read-only review to exact film/spec/frame bytes, chosen rules and round',()=>{
 expect(guardVisualReview(report(),context).scope).toBe('sampled_frames');
 expect(context.frameSetSha256).toBe(canonicalHash(context.frames));
 for(const field of ['filmSha256','filmSpecSha256','frameSetSha256','styleRulesHash'])expect(()=>guardVisualReview({...report(),[field]:'d'.repeat(64)},context)).toThrow('CRITIC_BASELINE_CHANGED');
 expect(()=>guardVisualReview({...report(),round:2},context)).toThrow('CRITIC_BASELINE_CHANGED');
});
it('rejects invented frame IDs, skipped observations, duplicated facts and unsupported listening claims',()=>{
 const unknown=report();unknown.facts[0].frameIds=['unknown'];expect(()=>guardVisualReview(unknown,context)).toThrow('CRITIC_EVIDENCE_INVALID');
 const missing=report();missing.observations.pop();expect(()=>guardVisualReview(missing,context)).toThrow('CRITIC_EVIDENCE_INVALID');
 const duplicate=report();duplicate.facts.push(duplicate.facts[0]);expect(()=>guardVisualReview(duplicate,context)).toThrow('CRITIC_EVIDENCE_INVALID');
 expect(()=>guardVisualReview({...report(),listening:{result:'pass'}},context)).toThrow('CRITIC_REVIEW_INVALID');
});
it('cannot pass facts from script assertions when actual supplied-frame observations show a wrong or incomplete proper name',()=>{
 const wrong=report();wrong.observations[0].visibleText=['2026年10月8日','上海清和社区'];expect(()=>guardVisualReview(wrong,context)).toThrow('CRITIC_FACT_EVIDENCE_INVALID');
 const validFailure=report();validFailure.observations[0].visibleText=['2026年10月8日','上海青禾社'];validFailure.facts[1].result='fail';validFailure.facts[1].reason='关键名称未完整显示';
 expect(guardVisualReview(validFailure,context).facts[1].result).toBe('fail');
 const contradiction=report();contradiction.observations[0].issues.push({kind:'clipped_text',severity:'blocking',description:'地点被裁切'});
 expect(()=>guardVisualReview(contradiction,context)).toThrow('CRITIC_EVIDENCE_INVALID');
});
