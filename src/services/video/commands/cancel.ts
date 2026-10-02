import {AtomicStore,updateJson} from '@/services/video/storage/atomic-store';
import {ProjectControl} from '@/contracts/video/project';
const terminal=new Set(['succeeded','failed','cancelled','interrupted']);
export async function cancelReply(store:AtomicStore,projectId:string,operationId:string){
 const p=`projects/${projectId}`;
 const control=await updateJson(store,`${p}/control`,(c:ProjectControl&{replyCancelOperationIds?:string[]})=>{
  if(c.deletedAt)throw Error('ACCESS_NOT_FOUND');
  if(c.activeConversation!==operationId)return c;
  return {...c,controlVersion:c.controlVersion+1,replyCancelOperationIds:[...new Set([...(c.replyCancelOperationIds||[]),operationId])]};
 });
 if(control.activeConversation!==operationId)return 'already_completed';
 const operation=await updateJson(store,`${p}/operations/${operationId}`,(o:{status:string;fence:number;canonicalRunId?:string|null})=>terminal.has(o.status)||o.status==='cancelling'?o:{...o,status:o.status==='reserved'&&!o.canonicalRunId?'cancelled':'cancelling',fence:o.fence+1});
 if(operation.status==='cancelled'){await updateJson(store,`${p}/control`,(c:ProjectControl)=>({...c,activeConversation:c.activeConversation===operationId?null:c.activeConversation,controlVersion:c.controlVersion+1}));return 'cancelled';}
 return terminal.has(operation.status)?'already_completed':'cancelling';
}
