import {getWorkflowMetadata,getWritable}from 'workflow';
import {productionStore}from '@/services/video/storage/blob-store';
import {ProjectStore}from '@/services/video/storage/project-store';
import {claimOperation}from '@/services/video/commands/claim';
import {runEffect}from '@/services/video/commands/effect-ledger';
import {updateJson}from '@/services/video/storage/atomic-store';
import {ProjectControl,ArchivedMessage}from '@/contracts/video/project';
import {Understanding}from '@/contracts/video/domain';
import {StreamEventSchema,StreamEvent}from '@/contracts/video/commands';
import {CommandIntent}from '@/services/video/commands/submit';
import {reserveModelBudget,modelLimits} from '@/services/video/budget/model-budget';
import {runDirector,applyUnderstandingPatch}from '@/mastra/video/director';
export async function directorTurnWorkflow(projectId:string,operationId:string){'use workflow';const claimed=await claimStep(projectId,operationId);if(!claimed)return;await directorStep(projectId,operationId)}
async function claimStep(projectId:string,operationId:string){'use step';return(await claimOperation(productionStore(),`projects/${projectId}/operations/${operationId}`,getWorkflowMetadata().workflowRunId)).claimed}
async function directorStep(projectId:string,operationId:string){
 'use step';
 const store=productionStore(),projects=new ProjectStore(store),p=`projects/${projectId}`,opKey=`${p}/operations/${operationId}`;
 const candidateId=crypto.randomUUID();
 const op=await updateJson(store,opKey,(o:{commandId:string;fence:number;streamEpoch:number;status:string;assistantMessageId?:string})=>({...o,assistantMessageId:o.assistantMessageId||candidateId}));
 const intent=(await store.readFresh<CommandIntent>(`${p}/commands/${op.commandId}`)).value;
 const control=(await store.readFresh<ProjectControl>(`${p}/control`)).value;
 const messages=await projects.messages(control),understanding=(await store.readFresh<Understanding>(control.understandingRef.key)).value;
 const assistantId=op.assistantMessageId!;const ordinal=control.ordinalReservations[operationId]?.assistant||control.nextOrdinal;
 const writer=getWritable<StreamEvent>().getWriter();
 const emit=async(type:string,payload:object)=>{const event=StreamEventSchema.parse({schemaVersion:5,projectId,operationId,epoch:op.streamEpoch,eventId:crypto.randomUUID(),type,createdAt:new Date().toISOString(),payload});if(Buffer.byteLength(JSON.stringify(event))>16384)throw Error('STREAM_RECORD_TOO_LARGE');try{await writer.write(event)}catch{/* Durable publication remains authoritative when the reader disconnects. */}};
 try{
  await emit('message.started',{messageId:assistantId,contentVersion:1,role:'assistant',ordinal});
  await emit('activity.updated',{stage:'understanding',label:'正在整理你的想法'});
  const decision=await runEffect(store,`${p}/operations/${operationId}/effects/director`,async()=>{const context=messages.map(m=>({id:m.id,role:m.role,text:m.text}));const bytes=Buffer.byteLength(JSON.stringify({understanding,messages:context}));if(bytes>60000)throw Error('CONTEXT_LIMIT');const budget=await reserveModelBudget(store,projectId,`${operationId}-director`,{inputTokens:bytes+4096,outputTokens:2000},modelLimits());return runDirector(understanding,context,budget.maxOutputTokens)});
  const currentOp=(await store.readFresh<{status:string}>(opKey)).value;
  if(currentOp.status==='cancelling'||currentOp.status==='cancelled'){
   await projects.archiveMessage(projectId,{id:assistantId,ordinal,role:'assistant',text:'',status:'stopped',contentVersion:1,operationId});
   await updateJson(store,opKey,(o:typeof op)=>({...o,status:'cancelled'}));
   await updateJson(store,`${p}/control`,(c:ProjectControl)=>({...c,activeConversation:c.activeConversation===operationId?null:c.activeConversation,controlVersion:c.controlVersion+1}));
   await emit('message.stopped',{messageId:assistantId,contentVersion:1});await emit('operation.terminal',{status:'cancelled',retryable:false});return;
  }
  const message:ArchivedMessage={id:assistantId,ordinal,role:'assistant',text:decision.reply,status:'completed',contentVersion:1,operationId};
  const messageRef=await projects.index.immutable(`${p}/messages/${assistantId}/1`,message);
  await updateJson(store,`${p}/control`,async(c:ProjectControl)=>{
   if(c.deletedAt||(c as ProjectControl&{replyCancelOperationIds?:string[]}).replyCancelOperationIds?.includes(operationId)||c.activeConversation!==operationId)throw Error('ACCESS_NOT_FOUND');
   const u=(await store.readFresh<Understanding>(c.understandingRef.key)).value;
   const next=decision.understandingPatch?applyUnderstandingPatch(u,decision.understandingPatch,messages.map(m=>({id:m.id,role:m.role,text:m.text}))):u;
   return{...c,controlVersion:c.controlVersion+1,briefVersion:next.briefVersion,previewState:next.briefVersion!==c.briefVersion&&c.previewState==='ready'?'stale':c.previewState,understandingRef:await projects.index.immutable(`${p}/understanding/${next.briefVersion}`,next),messagesIndexRef:await projects.index.append(`${p}/indexes/messages`,c.messagesIndexRef,{id:assistantId,ordinal,ref:messageRef}),activeConversation:null};
  });
  // Validated actual model reply; one logical delta, no artificial token timers.
  for(let offset=0;offset<decision.reply.length;){let end=Math.min(offset+1024,decision.reply.length);if(/[\uD800-\uDBFF]/.test(decision.reply[end-1])&&end<decision.reply.length)end--;await emit('message.delta',{messageId:assistantId,contentVersion:1,offset,text:decision.reply.slice(offset,end)});offset=end;}
  await emit('message.committed',{messageId:assistantId,contentVersion:1,archiveRevision:messageRef.sha256});
  await updateJson(store,opKey,(o:typeof op)=>({...o,status:'succeeded'}));
  await emit('operation.terminal',{status:'succeeded',retryable:false});
 }catch(error){
  const latest=(await store.readFresh<ProjectControl>(`${p}/control`)).value;
  const archived=(await projects.messages(latest)).find(m=>m.id===assistantId);
  const cancelled=(latest as ProjectControl&{replyCancelOperationIds?:string[]}).replyCancelOperationIds?.includes(operationId);
  const status=archived?.status==='completed'?'succeeded':cancelled?'cancelled':'interrupted';
  if(!archived||archived.status!=='completed')await projects.archiveMessage(projectId,{id:assistantId,ordinal,role:'assistant',text:archived?.text||'',status:cancelled?'stopped':'interrupted',contentVersion:1,operationId});
  await updateJson(store,opKey,(o:typeof op)=>['succeeded','failed','cancelled','interrupted'].includes(o.status)?o:{...o,status});
  await updateJson(store,`${p}/control`,(c:ProjectControl)=>({...c,activeConversation:c.activeConversation===operationId?null:c.activeConversation,controlVersion:c.controlVersion+1}));
  await emit('operation.terminal',{status,...(status==='interrupted'?{errorCode:error instanceof Error&&error.message==='BUDGET_EXCEEDED'?'BUDGET_LIMIT':'PROVIDER_UNAVAILABLE'}:{}),retryable:false});
 }finally{try{await writer.close()}catch{/* The persisted reply is independent of stream closure. */}}

 void intent;
}
