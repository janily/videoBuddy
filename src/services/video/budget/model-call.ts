import {AsyncLocalStorage} from 'node:async_hooks';
import type {AtomicStore} from '@/services/video/storage/atomic-store';
import {startModelAttempt,settleModelUsage,markModelUsageUnknown,type ModelReservation} from './model-budget';
interface Context{store:AtomicStore;reservation:ModelReservation;attempted:boolean;settled:boolean}
const scope=new AsyncLocalStorage<Context>();

export async function withAccountedModel<T>(store:AtomicStore,reservation:ModelReservation,task:()=>Promise<T>):Promise<T>{
 if(scope.getStore())throw Error('MODEL_SCOPE_NESTED');
 const context:Context={store,reservation,attempted:false,settled:false};
 return scope.run(context,async()=>{
  try{
   const value=await task();
   if(!context.attempted)throw Error('MODEL_ATTEMPT_NOT_STARTED');
   if(!context.settled)throw Error('MODEL_USAGE_UNCERTAIN');
   return value;
  }finally{
   if(context.attempted&&!context.settled)await markModelUsageUnknown(store,reservation);
  }
 });
}
export async function markModelCallStarted(){
 const context=scope.getStore();if(!context)return;
 if(context.attempted)throw Error('MULTIPLE_MODEL_CALLS');
 await startModelAttempt(context.store,context.reservation);context.attempted=true;
}
export async function recordModelUsage(usage:unknown){
 const context=scope.getStore();if(!context)return;
 if(!context.attempted||context.settled)throw Error('MODEL_USAGE_INVALID');
 // SDK total input/output already include provider reasoning; do not add it twice.
 const parsed=typeof usage==='object'&&usage!==null?usage as {inputTokens?:unknown;outputTokens?:unknown}:null;
 const result=await settleModelUsage(context.store,context.reservation,{inputTokens:parsed?.inputTokens,outputTokens:parsed?.outputTokens});
 context.settled=true;
 if(result.state==='overrun')throw Error('MODEL_BUDGET_OVERRUN');
}
