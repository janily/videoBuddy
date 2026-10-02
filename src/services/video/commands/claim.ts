import {AtomicStore,updateJson} from '@/services/video/storage/atomic-store';
interface Claimable{canonicalRunId:string|null;status:string;fence:number}
export async function claimOperation(store:AtomicStore,key:string,runId:string){
 const op=await updateJson(store,key,(c:Claimable)=>{if(c.canonicalRunId||['cancelled','cancelling','succeeded','failed','superseded'].includes(c.status))return c;return{...c,canonicalRunId:runId,status:'running'}});
 return{claimed:op.canonicalRunId===runId&&op.status==='running',canonicalRunId:op.canonicalRunId||runId};
}
