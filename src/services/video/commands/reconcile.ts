import{AtomicStore,updateJson}from'@/services/video/storage/atomic-store';
import{ProjectControl}from'@/contracts/video/project';
import{ProjectStore}from'@/services/video/storage/project-store';
interface Operation{status:string;canonicalRunId:string|null;kind:string;assistantMessageId?:string;userMessageId?:string}
const terminal=new Set(['succeeded','failed','cancelled','interrupted','superseded']);
export async function reconcileConversation(store:AtomicStore,projectId:string,inspect:(runId:string)=>Promise<string>,start:(operationId:string)=>Promise<void>){
 const p=`projects/${projectId}`,c=(await store.readFresh<ProjectControl>(`${p}/control`)).value,id=c.activeConversation;if(!id)return 'idle';
 const key=`${p}/operations/${id}`,operation=(await store.readFresh<Operation>(key)).value;
 let status=operation.status;
 if(!terminal.has(status)){
  if(!operation.canonicalRunId){
   if(status!=='reserved')return 'unknown';
   const archived=await new ProjectStore(store).messages(c);
   if(!operation.userMessageId||!archived.some(m=>m.id===operation.userMessageId&&m.role==='user'))return 'not_started';
   await start(id);return 'starting';
  }
  let runStatus:string;try{runStatus=await inspect(operation.canonicalRunId)}catch{return 'unknown'}
  if(!['completed','failed','cancelled'].includes(runStatus))return 'running';
  const latest=(await store.readFresh<ProjectControl>(`${p}/control`)).value;
  const message=operation.assistantMessageId?(await new ProjectStore(store).messages(latest)).find(m=>m.id===operation.assistantMessageId):undefined;
  const resolved=message?.status==='completed'?'succeeded':runStatus==='cancelled'?'cancelled':'interrupted';
  const finalized=await updateJson(store,key,(o:Operation)=>terminal.has(o.status)?o:{...o,status:resolved});status=finalized.status;
 }
 await updateJson(store,`${p}/control`,(current:ProjectControl)=>({...current,activeConversation:current.activeConversation===id?null:current.activeConversation,controlVersion:current.controlVersion+1}));
 return status;
}
