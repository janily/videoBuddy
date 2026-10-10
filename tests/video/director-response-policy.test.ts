import {expect,it} from 'vitest';
import {DirectorResponseSchema,GuidanceDecisionSchema} from '@/mastra/video/director';
it('excludes executing previews from native model output while retaining the historical decision contract',()=>{
 const d={action:'suggest_generate',reply:'已记下调整，请点击按钮查看效果。',effect:'no_change',executionIntent:'prepare_preview',evidenceMessageIds:[]};
 expect(GuidanceDecisionSchema.safeParse(d).success).toBe(false);expect(DirectorResponseSchema.safeParse(d).success).toBe(false);
 expect(DirectorResponseSchema.safeParse({...d,executionIntent:'none'}).success).toBe(true);
 expect(DirectorResponseSchema.safeParse({...d,executionIntent:'classify_change'}).success).toBe(false);
});
it.each(['objective','subject','audience'] as const)('invalidates the preview brief when only %s changes',async field=>{
 const {initialUnderstanding}=await import('@/contracts/video/domain'),{applyUnderstandingPatch}=await import('@/mastra/video/director'),{randomUUID}=await import('node:crypto');
 const base=initialUnderstanding(),id=randomUUID(),next=applyUnderstandingPatch(base,{baseBriefVersion:base.briefVersion,operations:[{op:'replace_summary',summary:base.summary,[field]:'新的创意方向',sourceMessageIds:[id]}]},[{id,role:'user',text:'新的创意方向'}]);
 expect(next.briefVersion).toBe(base.briefVersion+1);expect(next[field]).toBe('新的创意方向');
 expect(applyUnderstandingPatch(next,{baseBriefVersion:next.briefVersion,operations:[{op:'replace_summary',summary:next.summary,[field]:next[field],sourceMessageIds:[id]}]},[{id,role:'user',text:'新的创意方向'}]).briefVersion).toBe(next.briefVersion);
});
