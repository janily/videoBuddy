interface ChangeInput{targetArtifactId:string;revisionId:string;sourceMessageId:string;operations:{field:string;value:string|number}[];authorization:string;factsChanged:boolean;estimatedCost:number}
interface ChangeContext{currentArtifactId:string;revisionId:string;consentEpoch:number;briefVersion:number;availableBudget:number;userMessageIds:string[]}
export function classifyChange(input:ChangeInput,context:ChangeContext){
 if(input.authorization!=='explicit_message'||!context.userMessageIds.includes(input.sourceMessageId))throw Error('AUTHORIZATION_REQUIRED');
 if(!Number.isFinite(input.estimatedCost)||input.estimatedCost<0||input.estimatedCost>context.availableBudget)throw Error('BUDGET_LIMIT');
 if(input.targetArtifactId!==context.currentArtifactId||input.revisionId!==context.revisionId||!input.operations.length)return{risk:'clarify' as const,scope:'entire_film' as const};
 const safe=!input.factsChanged&&input.operations.every(op=>op.field==='musicGainDb'&&typeof op.value==='number'&&op.value<=0&&op.value>=-6);
 return{risk:safe?'safe_direct' as const:'preview_required' as const,scope:'entire_film' as const,consentEpoch:context.consentEpoch,briefVersion:context.briefVersion,targetArtifactId:context.currentArtifactId};
}
export function assertDeferredChange(plan:{consentEpoch:number;targetArtifactId:string;briefVersion:number},context:ChangeContext){if(plan.consentEpoch!==context.consentEpoch||plan.targetArtifactId!==context.currentArtifactId||plan.briefVersion!==context.briefVersion)throw Error('CHANGE_STALE')}
