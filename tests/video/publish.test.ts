import{it,expect}from'vitest';
import{assertPublishable,qualityGate}from'@/services/video/quality/publish-gate';
it('AT-038/083 not_checked is never pass; technical failures and license uncertainty block final download',()=>{
 expect(()=>qualityGate([{ruleId:'decode',result:'not_checked',severity:'blocking',evidenceRefs:[]}])).toThrow('QUALITY_BLOCKED');
 expect(()=>qualityGate([{ruleId:'license',result:'fail',severity:'blocking',evidenceRefs:[]}])).toThrow('QUALITY_BLOCKED');
 expect(()=>qualityGate([{ruleId:'decode',result:'pass',severity:'blocking',evidenceRefs:[]}])).toThrow('QUALITY_BLOCKED');
});
it('AT-037/039 stale fences and changed bundles cannot be published',()=>{
 const approved={bundleHash:'a',consentEpoch:2,owner:'owner',operationId:'op'};
 expect(()=>assertPublishable({bundleHash:'a',consentEpoch:3,owner:'owner',activeOperationId:'op'},approved)).toThrow('PUBLISH_FENCED');
 expect(()=>assertPublishable({bundleHash:'b',consentEpoch:2,owner:'owner',activeOperationId:'op'},approved)).toThrow('PREVIEW_STALE');
});
it('explicit silent intent allows audio N/A, not a global QA bypass',()=>{
 expect(()=>qualityGate([{ruleId:'decode',result:'pass',severity:'blocking',evidenceRefs:['actual-decode-report']},{ruleId:'loudness',result:'not_applicable',severity:'blocking',evidenceRefs:[],reason:'silent'}],['loudness'])).not.toThrow();
 expect(()=>qualityGate([{ruleId:'decode',result:'not_applicable',severity:'blocking',evidenceRefs:[],reason:'silent'}],['loudness'])).toThrow('QUALITY_BLOCKED');
});
