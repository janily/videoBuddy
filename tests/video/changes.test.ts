import{it,expect}from'vitest';
import{classifyChange,assertDeferredChange}from'@/services/video/domain/change-policy';
const context={currentArtifactId:'a',revisionId:'r',consentEpoch:3,briefVersion:1,availableBudget:10,userMessageIds:['message']};
it('AT-040/085 explicit global music gain may be reversible; old playhead never makes it local',()=>{
 const plan=classifyChange({targetArtifactId:'a',revisionId:'r',sourceMessageId:'message',operations:[{field:'musicGainDb',value:-3}],authorization:'explicit_message',factsChanged:false,estimatedCost:2},context);
 expect(plan.risk).toBe('safe_direct');expect(plan.scope).toBe('entire_film');
});
it('AT-041/086 large creative changes or uncertain readability require a new preview',()=>{
 for(const field of ['styleSlug','durationSec','color','fontSize'])expect(classifyChange({targetArtifactId:'a',revisionId:'r',sourceMessageId:'message',operations:[{field,value:'new'}],authorization:'explicit_message',factsChanged:false,estimatedCost:2},context).risk).toBe('preview_required');
});
it('missing target or invented facts require clarification; model suggestions are not authorization',()=>{
 expect(classifyChange({targetArtifactId:'other',revisionId:'r',sourceMessageId:'message',operations:[],authorization:'explicit_message',factsChanged:false,estimatedCost:2},context).risk).toBe('clarify');
 expect(()=>classifyChange({targetArtifactId:'a',revisionId:'r',sourceMessageId:'assistant-message',operations:[{field:'musicGainDb',value:-3}],authorization:'explicit_message',factsChanged:false,estimatedCost:2},context)).toThrow('AUTHORIZATION_REQUIRED');
});
it('AT-042 deferred changes cannot revive across cancellation epochs or changed baselines',()=>{
 expect(()=>assertDeferredChange({consentEpoch:2,targetArtifactId:'a',briefVersion:1},context)).toThrow('CHANGE_STALE');
});
