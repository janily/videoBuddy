import {userActivity} from '@/services/video/commands/user-activity';
import {AtomicStore,updateJson} from '@/services/video/storage/atomic-store';
import {ProjectControl} from '@/contracts/video/project';
import {clearUnstartedMediaStop} from '@/services/video/media/stop-state';
const terminal=new Set(['succeeded','failed','cancelled','interrupted']);
export async function cancelReply(store:AtomicStore,projectId:string,operationId:string){
 const p=`projects/${projectId}`;
 const control=await updateJson(store,`${p}/control`,(c:ProjectControl&{replyCancelOperationIds?:string[]})=>{
  if(c.deletedAt)throw Error('ACCESS_NOT_FOUND');
  if(c.activeConversation!==operationId||c.replyCancelOperationIds?.includes(operationId))return c;
  return {...c,...userActivity(c),controlVersion:c.controlVersion+1,replyCancelOperationIds:[...new Set([...(c.replyCancelOperationIds||[]),operationId])]};
 });
 if(control.activeConversation!==operationId)return 'already_completed';
 const operation=await updateJson(store,`${p}/operations/${operationId}`,(o:{status:string;fence:number;canonicalRunId?:string|null})=>terminal.has(o.status)||o.status==='cancelling'?o:{...o,status:o.status==='reserved'&&!o.canonicalRunId?'cancelled':'cancelling',fence:o.fence+1});
 if(operation.status==='cancelled'){await updateJson(store,`${p}/control`,(c:ProjectControl)=>({...c,activeConversation:c.activeConversation===operationId?null:c.activeConversation,controlVersion:c.controlVersion+1}));return 'cancelled';}
 return terminal.has(operation.status)?'already_completed':'cancelling';
}
export async function cancelProduction(store:AtomicStore,projectId:string,operationId:string){
 const p=`projects/${projectId}`;let owned=false;
 const before=(await store.readFresh<{kind?:string}>(`${p}/operations/${operationId}`)).value;
 await updateJson(store,`${p}/control`,(control:ProjectControl)=>{
  if(control.deletedAt)throw Error('ACCESS_NOT_FOUND');
  owned=control.activeProduction===operationId;
  if(!owned)return control;
  return{...control,...userActivity(control),controlVersion:control.controlVersion+1,consentEpoch:control.consentEpoch+1,activeProduction:null,cancelRequestedProductionId:operationId,unresolvedMediaStops:{...control.unresolvedMediaStops,[operationId]:before.kind==='preview'?'preview' as const:'render' as const},phase:'cancelled' as const,previewState:control.previewState==='ready'?'stale' as const:control.previewState};
 });
 const key=`${p}/operations/${operationId}`;
 if(!owned){const operation=(await store.readFresh<{status:string;canonicalRunId?:string|null}>(key)).value;if(operation.status==='cancelled'&&!operation.canonicalRunId)await clearUnstartedMediaStop(store,projectId,operationId);return operation.status==='cancelled'?'cancelled':operation.status==='cancelling'?'cancelling':'already_completed'}
 const operation=await updateJson(store,key,(current:{status:string;fence:number;canonicalRunId?:string|null})=>{
  if(terminal.has(current.status)||current.status==='cancelling')return current;
  return{...current,status:(current.status==='reserved'||current.status==='queued')&&!current.canonicalRunId?'cancelled':'cancelling',fence:current.fence+1};
 });
 // An unclaimed reservation is proof that no producer was started. Running
 // operations retain their blocker until the worker commits a verified outcome.
 if(operation.status==='cancelled')await clearUnstartedMediaStop(store,projectId,operationId);
 return operation.status==='cancelled'?'cancelled':operation.status==='cancelling'?'cancelling':'already_completed';
}
