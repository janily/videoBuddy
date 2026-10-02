import {randomUUID} from 'node:crypto';
import {AtomicStore,updateJson} from '@/services/video/storage/atomic-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {claimOperation} from './claim';
import {runEffect} from './effect-ledger';
import {ProjectControl,ArchivedMessage} from '@/contracts/video/project';
import {Understanding} from '@/contracts/video/domain';
import {StreamEventSchema} from '@/contracts/video/commands';
import {LocalEventLog} from '@/services/video/stream/local-event-log';
import {reserveModelBudget,modelLimits,ModelLimits} from '@/services/video/budget/model-budget';
import {runDirector,applyUnderstandingPatch,GuidanceDecisionSchema,guardGuidance,SourceMessage} from '@/mastra/video/director';
import {TextAnalysis} from '@/services/video/assets/analysis';

type Decide=typeof runDirector;
export async function runDirectorOperation(store:AtomicStore,events:LocalEventLog,projectId:string,operationId:string,options:{decide?:Decide;limits?:ModelLimits}={}){
 const p=`projects/${projectId}`,opKey=`${p}/operations/${operationId}`;
 const claim=await claimOperation(store,opKey,operationId);
 if(!claim.claimed)return;
 const projects=new ProjectStore(store),candidateId=randomUUID();
 const op=await updateJson(store,opKey,(value:{assistantMessageId?:string;streamEpoch:number;status:string})=>({...value,assistantMessageId:value.assistantMessageId||candidateId}));
 const control=(await store.readFresh<ProjectControl>(`${p}/control`)).value;
 const messages=await projects.messages(control),understanding=(await store.readFresh<Understanding>(control.understandingRef.key)).value;
 const assistantId=op.assistantMessageId!,ordinal=control.ordinalReservations[operationId]?.assistant||control.nextOrdinal;
 const emit=async(type:string,payload:object)=>{
  const event=StreamEventSchema.parse({schemaVersion:5,projectId,operationId,epoch:op.streamEpoch,eventId:randomUUID(),type,createdAt:new Date().toISOString(),payload});
  await events.append(event);
 };
 try{
  await emit('message.started',{messageId:assistantId,contentVersion:1,role:'assistant',ordinal});
  await emit('activity.updated',{stage:'understanding',label:'正在整理你的想法'});
  const context:SourceMessage[]=await Promise.all(messages.map(async message=>({
   id:message.id,role:message.role,text:message.text,
   ...(message.attachmentIds?.length?{attachments:await Promise.all(message.attachmentIds.map(async assetId=>{
    const asset=control.assets.find(item=>item.id===assetId);
    if(!asset||asset.status!=='ready'||!['text/markdown','application/pdf','audio/wav','audio/mpeg','audio/mp4'].includes(asset.declaredMime)||!asset.analysisRef)throw Error('SOURCE_INVALID');
    const analysis=(await store.readFresh<TextAnalysis>(asset.analysisRef.key)).value;
    if(analysis.assetId!==assetId||analysis.sha256!==asset.sha256||analysis.mime!==asset.declaredMime||analysis.trust!=='untrusted_material'||(asset.declaredMime==='application/pdf'&&!analysis.pages?.length)||(asset.declaredMime.startsWith('audio/')&&(!analysis.segments?.length||!analysis.language)))throw Error('SOURCE_INVALID');
    return{assetId,filename:asset.filename,mime:asset.declaredMime,sha256:analysis.sha256,text:analysis.text,...(analysis.pages?{pages:analysis.pages}:{}),...(analysis.segments?{segments:analysis.segments}:{})};
   }))}:{}),
  })));
  const decision=await runEffect(store,`${p}/operations/${operationId}/effects/director`,async()=>{
   const bytes=Buffer.byteLength(JSON.stringify({understanding,messages:context}));if(bytes>60000)throw Error('CONTEXT_LIMIT');
   const reservation=await reserveModelBudget(store,projectId,`${operationId}-director`,{inputTokens:bytes+4096,outputTokens:2000},options.limits||modelLimits());
   const result=GuidanceDecisionSchema.parse(await (options.decide||runDirector)(understanding,context,reservation.maxOutputTokens));
   guardGuidance(result,context,false,understanding);return result;
  });
  const currentOp=(await store.readFresh<{status:string}>(opKey)).value;
  if(currentOp.status==='cancelling'||currentOp.status==='cancelled'){
   await projects.archiveMessage(projectId,{id:assistantId,ordinal,role:'assistant',text:'',status:'stopped',contentVersion:1,operationId});
   await updateJson(store,opKey,(value:typeof op)=>({...value,status:'cancelled'}));
   await updateJson(store,`${p}/control`,(value:ProjectControl)=>({...value,activeConversation:value.activeConversation===operationId?null:value.activeConversation,controlVersion:value.controlVersion+1}));
   await emit('message.stopped',{messageId:assistantId,contentVersion:1});await emit('operation.terminal',{status:'cancelled',retryable:false});return;
  }
  const message:ArchivedMessage={id:assistantId,ordinal,role:'assistant',text:decision.reply,status:'completed',contentVersion:1,operationId};
  const messageRef=await projects.index.immutable(`${p}/messages/${assistantId}/1`,message);
  await updateJson(store,`${p}/control`,async(value:ProjectControl)=>{
   if(value.deletedAt||(value as ProjectControl&{replyCancelOperationIds?:string[]}).replyCancelOperationIds?.includes(operationId)||value.activeConversation!==operationId)throw Error('ACCESS_NOT_FOUND');
   const latest=(await store.readFresh<Understanding>(value.understandingRef.key)).value;
   const next=decision.understandingPatch?applyUnderstandingPatch(latest,decision.understandingPatch,context):latest;
   return{...value,controlVersion:value.controlVersion+1,briefVersion:next.briefVersion,previewState:next.briefVersion!==value.briefVersion&&value.previewState==='ready'?'stale':value.previewState,understandingRef:await projects.index.immutable(`${p}/understanding/${next.briefVersion}`,next),messagesIndexRef:await projects.index.append(`${p}/indexes/messages`,value.messagesIndexRef,{id:assistantId,ordinal,ref:messageRef}),activeConversation:null};
  });
  for(let offset=0;offset<decision.reply.length;){let end=Math.min(offset+1024,decision.reply.length);if(/[\uD800-\uDBFF]/.test(decision.reply[end-1])&&end<decision.reply.length)end--;await emit('message.delta',{messageId:assistantId,contentVersion:1,offset,text:decision.reply.slice(offset,end)});offset=end;}
  await emit('message.committed',{messageId:assistantId,contentVersion:1,archiveRevision:messageRef.sha256});
  await updateJson(store,opKey,(value:typeof op)=>({...value,status:'succeeded'}));
  await emit('operation.terminal',{status:'succeeded',retryable:false});
 }catch(error){
  const latest=(await store.readFresh<ProjectControl>(`${p}/control`)).value;
  const archived=(await projects.messages(latest)).find(m=>m.id===assistantId);
  const cancelled=(latest as ProjectControl&{replyCancelOperationIds?:string[]}).replyCancelOperationIds?.includes(operationId);
  const status=archived?.status==='completed'?'succeeded':cancelled?'cancelled':'interrupted';
  if(!archived||archived.status!=='completed')await projects.archiveMessage(projectId,{id:assistantId,ordinal,role:'assistant',text:archived?.text||'',status:cancelled?'stopped':'interrupted',contentVersion:1,operationId});
  await updateJson(store,opKey,(value:typeof op)=>['succeeded','failed','cancelled','interrupted'].includes(value.status)?value:{...value,status});
  await updateJson(store,`${p}/control`,(value:ProjectControl)=>({...value,activeConversation:value.activeConversation===operationId?null:value.activeConversation,controlVersion:value.controlVersion+1}));
  await emit('operation.terminal',{status,...(status==='interrupted'?{errorCode:error instanceof Error&&error.message==='BUDGET_EXCEEDED'?'BUDGET_LIMIT':'PROVIDER_UNAVAILABLE'}:{}),retryable:false});
 }
}
