import {it,expect} from 'vitest';
import {validateDelivery,validateNewDelivery,mandatoryDeliveryRules} from '@/services/video/quality/delivery';
import {canonicalHash} from '@/services/video/domain/hash';
const policy={schemaVersion:1 as const,audioIntent:'voiced' as const,captions:true,requiredRules:[...mandatoryDeliveryRules]},sha='a'.repeat(64),checks=mandatoryDeliveryRules.map(ruleId=>({ruleId,result:'pass' as const,severity:'blocking' as const,evidenceRefs:['unit-protocol-only']})),input={policy,expectedPolicySha256:canonicalHash(policy),expectedFileSha256:sha,actualFileSha256:sha,checks};
it('requires independent content evidence for new publication while preserving existing frozen policy hashes',()=>{
 expect(()=>validateDelivery(input)).not.toThrow();expect(()=>validateNewDelivery(input)).toThrow('QUALITY_BLOCKED');
 const content={ruleId:'content_coverage',result:'pass' as const,severity:'blocking' as const,evidenceRefs:['owned/content-stage']};expect(()=>validateNewDelivery({...input,checks:[...checks,content]})).not.toThrow();
 for(const result of ['not_checked','fail','waived','not_applicable'] as const)expect(()=>validateNewDelivery({...input,checks:[...checks,{...content,result}]})).toThrow('QUALITY_BLOCKED');
 expect(()=>validateNewDelivery({...input,checks:[...checks,{...content,severity:'warning'}]})).toThrow('QUALITY_BLOCKED');
});
