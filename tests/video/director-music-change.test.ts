import {it,expect} from 'vitest';
import {GuidanceDecisionSchema,guardGuidance,type DirectorProjectContext} from '@/mastra/video/director';
const userId=crypto.randomUUID(),artifactId=crypto.randomUUID(),revisionId=crypto.randomUUID();
const messages=[{id:userId,role:'user' as const,text:'这版音乐调小一点',target:{artifactId,revisionId,sourceTimeMs:null}}];
const context:DirectorProjectContext={phase:'ready',activeProductionId:null,briefVersion:1,consentEpoch:2};
const decision={action:'change',effect:'pending_followup',executionIntent:'classify_change',reply:'记下这版配乐的调整，视频还没有改动。',evidenceMessageIds:[userId],musicChange:{sourceMessageId:userId,targetArtifactId:artifactId,revisionId,musicGainDb:-3,gainMode:'relative',requestQuote:'音乐调小一点',reason:'用户明确要求降低整片配乐'}};
it('T13 Director accepts structured music interpretation bound to the current turn and current result',()=>{
 const parsed=GuidanceDecisionSchema.parse(decision);expect(()=>guardGuidance(parsed,messages,false,undefined,{...context,currentTurnUserMessageIds:[userId],currentResult:{artifactId,revisionId}})).not.toThrow();
});
it('T13 Director rejects old/assistant sources, invented quotes, different results and playhead targets',()=>{
 const active={...context,currentTurnUserMessageIds:[userId],currentResult:{artifactId,revisionId}};
 for(const input of [{...active,currentTurnUserMessageIds:[]},{...active,currentResult:{artifactId:crypto.randomUUID(),revisionId}},{...active,activeProductionId:crypto.randomUUID()}])expect(()=>guardGuidance(GuidanceDecisionSchema.parse(decision),messages,false,undefined,input)).toThrow();
 for(const source of [{...messages[0],role:'assistant' as const},{...messages[0],target:{artifactId,revisionId,sourceTimeMs:1000}}])expect(()=>guardGuidance(GuidanceDecisionSchema.parse(decision),[source],false,undefined,active)).toThrow();
 expect(()=>guardGuidance(GuidanceDecisionSchema.parse({...decision,musicChange:{...decision.musicChange,requestQuote:'用户没有说过的要求'}}),messages,false,undefined,active)).toThrow('AUTHORIZATION_REQUIRED');
});
it('T13 structured music interpretation cannot mutate the brief or claim production intent',()=>{
 for(const patch of [{action:'acknowledge'},{effect:'update_brief'},{executionIntent:'prepare_preview'}])expect(()=>guardGuidance(GuidanceDecisionSchema.parse({...decision,...patch}),messages,false,undefined,{...context,currentTurnUserMessageIds:[userId],currentResult:{artifactId,revisionId}})).toThrow();
});
it('T13 explicit absolute gains remain distinct and a relative zero cannot masquerade as a reduction',()=>{
 const active={...context,currentTurnUserMessageIds:[userId],currentResult:{artifactId,revisionId}},quote='整片配乐增益设到0dB',absolute=GuidanceDecisionSchema.parse({...decision,musicChange:{...decision.musicChange,musicGainDb:0,gainMode:'absolute',requestQuote:quote}});
 expect(()=>guardGuidance(absolute,[{...messages[0],text:quote}],false,undefined,active)).not.toThrow();expect(()=>GuidanceDecisionSchema.parse({...decision,musicChange:{...decision.musicChange,musicGainDb:0}})).toThrow();
});
