import {z} from 'zod';
import {createOrRead,StoreMissing,updateJson,type AtomicStore} from '@/services/video/storage/atomic-store';
export const timingStages=['treatment','visual','picture','composition','music'] as const;
export type TimingStage=typeof timingStages[number];
type TimingLog=Partial<Record<TimingStage,Array<{ms:number;operationId?:string}>>>;
export type TimingEstimates=Partial<Record<TimingStage,{samples:number;medianMs:number}>>;
const inputSchema=z.strictObject({projectId:z.string().uuid(),stage:z.enum(timingStages),ms:z.number().finite().int().min(0).max(86400000),operationId:z.string().max(128).regex(/^[\w-]+$/).optional()});
export async function recordStepTiming(store:AtomicStore,projectId:string,stage:TimingStage,ms:number,operationId?:string){
 if(!inputSchema.safeParse({projectId,stage,ms,operationId}).success)throw Error('VALIDATION_FAILED');
 const key=`projects/${projectId}/quick/timings`;await createOrRead(store,key,{} as TimingLog);
 await updateJson<TimingLog>(store,key,current=>({...current,[stage]:[...(current[stage]||[]),{ms,...(operationId?{operationId}:{})}].slice(-20)}));
}
export async function readStepTimings(store:AtomicStore,projectId:string):Promise<TimingEstimates>{
 let log:TimingLog;try{log=(await store.readFresh<TimingLog>(`projects/${projectId}/quick/timings`)).value}catch(error){if(!(error instanceof StoreMissing))throw error;return{}}
 const result:TimingEstimates={};
 for(const stage of timingStages){const values=(log[stage]||[]).map(value=>value.ms).sort((a,b)=>a-b);if(!values.length)continue;const mid=Math.floor(values.length/2);result[stage]={samples:values.length,medianMs:values.length%2?values[mid]:(values[mid-1]+values[mid])/2}}
 return result;
}
