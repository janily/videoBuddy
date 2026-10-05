import {expect,it} from 'vitest';
import {DirectorResponseSchema,GuidanceDecisionSchema} from '@/mastra/video/director';
it('excludes executing previews from native model output while retaining the historical decision contract',()=>{
 const d={action:'suggest_preview',reply:'已记下调整，请点击按钮查看效果。',effect:'no_change',executionIntent:'prepare_preview',evidenceMessageIds:[]};
 expect(GuidanceDecisionSchema.safeParse(d).success).toBe(true);expect(DirectorResponseSchema.safeParse(d).success).toBe(false);
 expect(DirectorResponseSchema.safeParse({...d,executionIntent:'none'}).success).toBe(true);
 expect(DirectorResponseSchema.safeParse({...d,executionIntent:'classify_change'}).success).toBe(true);
});
