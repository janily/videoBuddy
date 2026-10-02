import {it,expect} from 'vitest';
import {GuidanceDecisionSchema,applyUnderstandingPatch,guardGuidance} from '@/mastra/video/director';
import {initialUnderstanding} from '@/contracts/video/domain';
const id='10000000-0000-4000-8000-000000000001';
const message={id,role:'user' as const,text:'开业日期改成10月8日'};
it('AT-020 quoted document instructions never count as user authorization',()=>{
 const decision=GuidanceDecisionSchema.parse({action:'acknowledge',reply:'资料已收到',effect:'no_change',executionIntent:'prepare_preview',evidenceMessageIds:[id]});
 expect(()=>guardGuidance(decision,[{...message,role:'assistant'}],false)).toThrow('AUTHORIZATION_REQUIRED');
});
it('AT-021 status questions cannot change the running creative bundle',()=>{
 const base=initialUnderstanding();const decision=GuidanceDecisionSchema.parse({action:'status',reply:'正在制作',effect:'update_brief',executionIntent:'none',evidenceMessageIds:[id]});
 expect(()=>guardGuidance(decision,[message],false)).toThrow('GUIDANCE_INVALID');expect(base.briefVersion).toBe(0);
});
it('facts need exact user source; stale patches cannot silently overwrite',()=>{
 const base=initialUnderstanding();const patch={baseBriefVersion:0,operations:[{op:'add_fact',fact:{id:'fact-date',text:'开业日期10月8日',sourceRefs:[{type:'user_message',id}],status:'provided',mustInclude:true,critical:true},sourceMessageIds:[id]}]};
 const changed=applyUnderstandingPatch(base,patch,[message]);expect(changed.facts[0].sourceRefs[0].id).toBe(id);expect(changed.briefVersion).toBe(1);
 expect(()=>applyUnderstandingPatch(changed,patch,[message])).toThrow('BRIEF_CONFLICT');
 expect(()=>applyUnderstandingPatch(base,{...patch,operations:[{...patch.operations[0],sourceMessageIds:['20000000-0000-4000-8000-000000000001']}]},[message])).toThrow('SOURCE_INVALID');
});
it('uploaded material facts require a ready attachment and a quote present in its real text',()=>{
 const assetId='30000000-0000-4000-8000-000000000003';
 const source={...message,text:'',attachments:[{assetId,filename:'资料.md',mime:'text/markdown',sha256:'a'.repeat(64),text:'活动日期：10月8日\n地点：上海'}]};
 const fact={id:'event-date',text:'活动日期10月8日',sourceRefs:[{type:'uploaded_material',id:assetId,locator:'line:1',excerpt:'活动日期：10月8日'}],status:'provided',mustInclude:false,critical:false};
 const patch={baseBriefVersion:0,operations:[{op:'add_fact',fact,sourceMessageIds:[id]}]};
 expect(applyUnderstandingPatch(initialUnderstanding(),patch,[source]).facts[0].sourceRefs[0].id).toBe(assetId);
 expect(()=>applyUnderstandingPatch(initialUnderstanding(),{...patch,operations:[{...patch.operations[0],fact:{...fact,sourceRefs:[{...fact.sourceRefs[0],excerpt:'不存在的日期'}]}}]},[source])).toThrow('SOURCE_INVALID');
 expect(()=>applyUnderstandingPatch(initialUnderstanding(),patch,[message])).toThrow('SOURCE_INVALID');
 const otherId='40000000-0000-4000-8000-000000000004';
 expect(()=>applyUnderstandingPatch(initialUnderstanding(),{...patch,operations:[{...patch.operations[0],sourceMessageIds:[otherId]}]},[source,{id:otherId,role:'user',text:'无关消息'}])).toThrow('SOURCE_INVALID');
 expect(()=>applyUnderstandingPatch(initialUnderstanding(),{baseBriefVersion:0,operations:[{op:'set_asset_use',assetId:'50000000-0000-4000-8000-000000000005',purpose:'reference',required:false,sourceMessageIds:[id]}]},[source])).toThrow('SOURCE_INVALID');
});
it('text PDF citations require the quoted text on the stated page',()=>{
 const assetId='60000000-0000-4000-8000-000000000006';
 const source={...message,text:'',attachments:[{assetId,filename:'brief.pdf',mime:'application/pdf',sha256:'b'.repeat(64),text:'[page:1] 开业\n[page:2] 价格三十元',pages:['开业','价格三十元']}]};
 const fact={id:'price',text:'价格三十元',sourceRefs:[{type:'uploaded_material',id:assetId,locator:'page:2',excerpt:'价格三十元'}],status:'provided',mustInclude:false,critical:false};
 const patch={baseBriefVersion:0,operations:[{op:'add_fact',fact,sourceMessageIds:[id]}]};
 expect(applyUnderstandingPatch(initialUnderstanding(),patch,[source]).facts).toHaveLength(1);
 expect(()=>applyUnderstandingPatch(initialUnderstanding(),{...patch,operations:[{...patch.operations[0],fact:{...fact,sourceRefs:[{...fact.sourceRefs[0],locator:'page:1'}]}}]},[source])).toThrow('SOURCE_INVALID');
});
it('AT-019 skipped optional questions remain remembered and duplicate questioning is rejected',()=>{
 const base=initialUnderstanding();const skipped=applyUnderstandingPatch(base,{baseBriefVersion:0,operations:[{op:'mark_topic_skipped',topic:'photos',sourceMessageIds:[id]}]},[message]);
 expect(skipped.skippedTopics).toEqual(['photos']);
 const decision=GuidanceDecisionSchema.parse({action:'ask',reply:'有照片吗',effect:'no_change',question:{topic:'photos',text:'有照片吗',required:false,reason:'资料'},executionIntent:'none',evidenceMessageIds:[id]});
 expect(()=>guardGuidance(decision,[message],false,skipped)).toThrow('QUESTION_ALREADY_RESOLVED');
});
it('AT-072 optional question limit never waives an unresolved critical conflict',()=>{
 const base={...initialUnderstanding(),optionalQuestionCount:3,unresolvedConflictIds:['price']};
 const decision=GuidanceDecisionSchema.parse({action:'ask',reply:'哪个价格',effect:'clarify_conflict',question:{topic:'price',text:'哪个价格',required:true,reason:'来源冲突'},executionIntent:'none',evidenceMessageIds:[id]});
 expect(()=>guardGuidance(decision,[message],false,base)).not.toThrow();
});
it('strict output cannot introduce render approval or extra tools',()=>{
 expect(()=>GuidanceDecisionSchema.parse({action:'render',reply:'开始',effect:'no_change',executionIntent:'render',evidenceMessageIds:[]})).toThrow();
});
