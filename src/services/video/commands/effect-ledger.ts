import {randomUUID} from 'node:crypto';
import {AtomicStore,createOrRead,updateJson} from '@/services/video/storage/atomic-store';
interface Effect<T>{status:'started'|'completed';attemptId:string;output?:T}
export async function runEffect<T>(store:AtomicStore,key:string,execute:()=>Promise<T>):Promise<T>{
 const attemptId=randomUUID();const record=await createOrRead<Effect<T>>(store,key,{status:'started',attemptId});
 if(record.status==='completed')return record.output!;
 if(record.attemptId!==attemptId)throw Error('EFFECT_UNKNOWN');
 // If execution throws or times out, leave started: provider may already have charged.
 const output=await execute();
 await updateJson(store,key,(c:Effect<T>)=>{if(c.attemptId!==attemptId)throw Error('EFFECT_UNKNOWN');return{...c,status:'completed' as const,output}});
 return output;
}
