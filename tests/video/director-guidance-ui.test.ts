import {expect,it} from 'vitest';
import {GuidanceDecisionSchema,guardGuidance,directorContext} from '@/mastra/video/director';
import {initialUnderstanding} from '@/contracts/video/domain';

const base={action:'acknowledge',reply:'画风放在左边，看看第 3 镜。',effect:'no_change',executionIntent:'none',evidenceMessageIds:[]};
const recommendations=[{styleId:'ink-wash',reason:'写意山水很适合团圆祝福',primary:true},{styleId:'papercut-red',reason:'红色剪纸喜庆温暖',primary:false}];
it('accepts valid canvas guidance and derives the compatible primary style',()=>{
 const decision=GuidanceDecisionSchema.parse({...base,recommendations,canvasFocus:'style',quickReplies:[{label:'你定吧',text:'画风你定吧'}],canvasRefs:[{text:'画风',target:'style'}],readiness:{brief:'enough',nextStep:'choose_style'}});
 guardGuidance(decision,[],false);
 expect(decision.recommendedStyleId).toBe('ink-wash');expect(decision.recommendations).toEqual(recommendations);
});
it('drops malformed optional fields while preserving valid independent presentation fields',()=>{
 const decision=GuidanceDecisionSchema.parse({...base,recommendations:'broken',canvasFocus:'nowhere',readiness:{brief:'invalid'},quickReplies:[{label:'可以',text:'就这样'},null,{label:'太'.repeat(9),text:'无效'},{label:'长',text:'长'.repeat(61)}],canvasRefs:[{text:'不存在',target:'brief'},{text:'第 3 镜',target:'script'},false]});
 guardGuidance(decision,[],false);
 expect(decision.quickReplies).toEqual([{label:'可以',text:'就这样'}]);expect(decision.canvasRefs).toEqual([{text:'第 3 镜',target:'script'}]);
 expect(decision.recommendations).toBeUndefined();expect(decision.canvasFocus).toBeUndefined();expect(decision.readiness).toBeUndefined();
});
it.each([
 [{...recommendations[0],styleId:'made-up'},recommendations[1]],
 [recommendations[0],recommendations[0]],
 recommendations.map(r=>({...r,primary:false})),
 recommendations.map(r=>({...r,primary:true})),
 [recommendations[0]],
])('discards invalid recommendations without failing the reply',invalid=>{
 const decision=GuidanceDecisionSchema.parse({...base,recommendations:invalid});expect(()=>guardGuidance(decision,[],false)).not.toThrow();expect(decision.recommendations).toBeUndefined();
});
it('retains at most four valid quick replies',()=>{
 const decision=GuidanceDecisionSchema.parse({...base,quickReplies:Array.from({length:6},(_,i)=>({label:`选${i}`,text:`选第${i}个`}))});
 guardGuidance(decision,[],false);expect(decision.quickReplies).toHaveLength(4);
});
it('turns an unsupported promise of a future edit into an explicit clarification without losing streamed text',()=>{
 const decision=GuidanceDecisionSchema.parse({...base,reply:'已记下，作为下一次修改。',action:'change',effect:'pending_followup'});
 guardGuidance(decision,[],false);
 expect(decision).toMatchObject({action:'ask',effect:'no_change',executionIntent:'none',question:{required:true}});
 expect(decision.reply).toBe('已记下，作为下一次修改。这条修改还未写入下一版，具体想改哪一处？');
 guardGuidance(decision,[],false);expect(decision.reply.match(/具体想改哪一处/g)).toHaveLength(1);
});
it('derives readiness and delegation from current user context without executing generation',()=>{
 const understanding={...initialUnderstanding(),subject:'中秋祝福'};
 const context=directorContext(understanding,[{id:'a',role:'user',text:'你定吧，直接做'}]);
 expect(context).toMatchObject({guidance:{brief:'enough',deferToAssistant:true}});
 expect(directorContext({...understanding,audience:'家人'},[])).toMatchObject({guidance:{brief:'enough',deferToAssistant:false}});
 expect(directorContext(understanding,[])).toMatchObject({guidance:{brief:'partial'}});
});
it('links the complete style library through the existing canvas reference protocol',()=>{
 const decision=GuidanceDecisionSchema.parse({...base,reply:'都不太对的话，看全部画风。',canvasRefs:[{text:'看全部画风',target:'style-library'}]});
 guardGuidance(decision,[],false);expect(decision.canvasRefs).toEqual([{text:'看全部画风',target:'style-library'}]);
});
