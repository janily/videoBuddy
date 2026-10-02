import{AtomicStore,createOrRead,updateJson}from'@/services/video/storage/atomic-store';
import{canonicalHash}from'@/services/video/domain/hash';
export interface ModelLimits{projectCalls:number;projectInputTokens:number;projectOutputTokens:number;dailyCalls:number}
interface Cost{inputTokens:number;outputTokens:number}
interface Counter{calls:number;inputTokens:number;outputTokens:number;reservations:Record<string,string>}
const empty:Counter={calls:0,inputTokens:0,outputTokens:0,reservations:{}};
export async function reserveModelBudget(store:AtomicStore,projectId:string,stage:string,cost:Cost,limits:ModelLimits){
 if([...Object.values(limits),...Object.values(cost)].some(n=>!Number.isSafeInteger(n)||n<1))throw Error('CONFIGURATION_REQUIRED');
 const hash=canonicalHash(cost),id=canonicalHash({projectId,stage});
 const intent=await createOrRead(store,`projects/${projectId}/budget-intents/${id}`,{hash,day:new Date().toISOString().slice(0,10)});
 if(intent.hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');
 async function reserve(key:string,maxCalls:number,inputMax:number,outputMax:number){
  await createOrRead(store,key,empty);
  return updateJson(store,key,(c:Counter)=>{
   if(c.reservations[id]){if(c.reservations[id]!==hash)throw Error('IDEMPOTENCY_CONFLICT');return c;}
   if(c.calls+1>maxCalls||c.inputTokens+cost.inputTokens>inputMax||c.outputTokens+cost.outputTokens>outputMax)throw Error('BUDGET_EXCEEDED');
   return{calls:c.calls+1,inputTokens:c.inputTokens+cost.inputTokens,outputTokens:c.outputTokens+cost.outputTokens,reservations:{...c.reservations,[id]:hash}};
  });
 }
 // Daily reservation is conservative if the later project CAS fails. Never refund an unknown effect.
 await reserve(`budgets/daily/${intent.day}`,limits.dailyCalls,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER);
 await reserve(`projects/${projectId}/budget`,limits.projectCalls,limits.projectInputTokens,limits.projectOutputTokens);
 return{maxOutputTokens:cost.outputTokens};
}
export function modelLimits(env:Record<string,string|undefined>=process.env):ModelLimits{return{projectCalls:Number(env.VIDEO_PROJECT_MAX_MODEL_CALLS),projectInputTokens:Number(env.VIDEO_PROJECT_MAX_INPUT_TOKENS),projectOutputTokens:Number(env.VIDEO_PROJECT_MAX_OUTPUT_TOKENS),dailyCalls:Number(env.VIDEO_DAILY_MAX_MODEL_CALLS)}}
