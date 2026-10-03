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
import {runDirector,runDirectorStream,applyUnderstandingPatch,GuidanceDecisionSchema,guardGuidance,SourceMessage,directorContext} from '@/mastra/video/director';
import {TextAnalysis} from '@/services/video/assets/analysis';

import {withAccountedModel} from '@/services/video/budget/model-call';

type Decide=typeof runDirector;
export async function runDirectorOperation(store:AtomicStore,events:LocalEventLog,projectId:string,operationId:string,options:{decide?:Decide;decideStream?:typeof runDirectorStream;limits?:ModelLimits}={}){
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
 let streamedText='';
 const durableReply=async()=>{
  let text='',started=false;
  for(const {event} of await events.readFrom(projectId,operationId,0)){
   if(event.epoch!==op.streamEpoch)continue;
   if(event.type==='message.started'&&event.payload.messageId===assistantId)started=true;
   if(event.type!=='message.delta'||event.payload.messageId!==assistantId||event.payload.contentVersion!==1)continue;
   if(event.payload.offset!==text.length||text.length+event.payload.text.length>8000)throw Error('DIRECTOR_STREAM_CHANGED');
   text+=event.payload.text;
  }
  return{text,started};
 };
 const onDelta=async(text:string)=>{
  if(!text||streamedText.length+text.length>8000)throw Error('DIRECTOR_STREAM_INVALID');
  for(let offset=0;offset<text.length;){
   let end=Math.min(offset+1024,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
   const part=text.slice(offset,end),current=(await store.readFresh<{status:string}>(opKey)).value,latest=(await store.readFresh<ProjectControl>(`${p}/control`)).value;
   if(latest.deletedAt||latest.activeConversation!==operationId||['cancelling','cancelled'].includes(current.status)||(latest as ProjectControl&{replyCancelOperationIds?:string[]}).replyCancelOperationIds?.includes(operationId))return;
   await emit('message.delta',{messageId:assistantId,contentVersion:1,offset:streamedText.length,text:part});streamedText+=part;offset=end;
  }
 };
 try{
  const previous=await durableReply();streamedText=previous.text;
  if(!previous.started)await emit('message.started',{messageId:assistantId,contentVersion:1,role:'assistant',ordinal});
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
  const bytes=Buffer.byteLength(JSON.stringify(directorContext(understanding,context)));if(bytes>60000)throw Error('CONTEXT_LIMIT');
  const reservation=await reserveModelBudget(store,projectId,`${operationId}-director`,{inputTokens:bytes+4096,outputTokens:2000},options.limits||modelLimits());
  const decision=await runEffect(store,`${p}/operations/${operationId}/effects/director`,async()=>{
   const raw=options.decide?await options.decide(understanding,context,reservation.maxOutputTokens):options.decideStream?await options.decideStream(understanding,context,reservation.maxOutputTokens,onDelta):await withAccountedModel(store,reservation.reservation,()=>runDirectorStream(understanding,context,reservation.maxOutputTokens,onDelta));
   const result=GuidanceDecisionSchema.parse(raw);
   guardGuidance(result,context,false,understanding);return result;
  });
  const currentOp=(await store.readFresh<{status:string}>(opKey)).value;
  if(currentOp.status==='cancelling'||currentOp.status==='cancelled'){
   await projects.archiveMessage(projectId,{id:assistantId,ordinal,role:'assistant',text:streamedText,status:'stopped',contentVersion:1,operationId});
   await updateJson(store,opKey,(value:typeof op)=>({...value,status:'cancelled'}));
   await updateJson(store,`${p}/control`,(value:ProjectControl)=>({...value,activeConversation:value.activeConversation===operationId?null:value.activeConversation,controlVersion:value.controlVersion+1}));
   await emit('message.stopped',{messageId:assistantId,contentVersion:1});await emit('operation.terminal',{status:'cancelled',retryable:false});return;
  }
  if(!decision.reply.startsWith(streamedText))throw Error('DIRECTOR_STREAM_CHANGED');
  if(decision.reply.length>streamedText.length)await onDelta(decision.reply.slice(streamedText.length));
  const message:ArchivedMessage={id:assistantId,ordinal,role:'assistant',text:decision.reply,status:'completed',contentVersion:1,operationId};
  const messageRef=await projects.index.immutable(`${p}/messages/${assistantId}/1`,message);
  await updateJson(store,`${p}/control`,async(value:ProjectControl)=>{
   if(value.deletedAt||(value as ProjectControl&{replyCancelOperationIds?:string[]}).replyCancelOperationIds?.includes(operationId)||value.activeConversation!==operationId)throw Error('ACCESS_NOT_FOUND');
   const latest=(await store.readFresh<Understanding>(value.understandingRef.key)).value;
   const next=decision.understandingPatch?applyUnderstandingPatch(latest,decision.understandingPatch,context):latest;
   return{...value,controlVersion:value.controlVersion+1,briefVersion:next.briefVersion,previewState:next.briefVersion!==value.briefVersion&&value.previewState==='ready'?'stale':value.previewState,understandingRef:await projects.index.immutable(`${p}/understanding/${next.briefVersion}`,next),messagesIndexRef:await projects.index.append(`${p}/indexes/messages`,value.messagesIndexRef,{id:assistantId,ordinal,ref:messageRef}),activeConversation:null};
  });
  await emit('message.committed',{messageId:assistantId,contentVersion:1,archiveRevision:messageRef.sha256});
  await updateJson(store,opKey,(value:typeof op)=>({...value,status:'succeeded'}));
  await emit('operation.terminal',{status:'succeeded',retryable:false});
 }catch(error){
  // append can fsync successfully and lose its acknowledgement; the log wins.
  // If the log cannot be read, leave the operation recoverable instead of
  // committing an empty terminal archive over an unknown durable fragment.
  streamedText=(await durableReply()).text;
  const latest=(await store.readFresh<ProjectControl>(`${p}/control`)).value;
  const archived=(await projects.messages(latest)).find(m=>m.id===assistantId);
  const cancelled=(latest as ProjectControl&{replyCancelOperationIds?:string[]}).replyCancelOperationIds?.includes(operationId);
  const status=archived?.status==='completed'?'succeeded':cancelled?'cancelled':'interrupted';
  if(!archived||archived.status!=='completed')await projects.archiveMessage(projectId,{id:assistantId,ordinal,role:'assistant',text:archived?.text||streamedText,status:cancelled?'stopped':'interrupted',contentVersion:1,operationId});
  await updateJson(store,opKey,(value:typeof op)=>['succeeded','failed','cancelled','interrupted'].includes(value.status)?value:{...value,status});
  await updateJson(store,`${p}/control`,(value:ProjectControl)=>({...value,activeConversation:value.activeConversation===operationId?null:value.activeConversation,controlVersion:value.controlVersion+1}));
  const reason=error instanceof Error?error.message:'PROVIDER_UNAVAILABLE';
  const budgetCode=['BUDGET_EXCEEDED','MODEL_BUDGET_OVERRUN'].includes(reason)?'BUDGET_LIMIT':['MODEL_USAGE_UNCERTAIN','MODEL_USAGE_INVALID','MODEL_ACCOUNTING_INVALID','MODEL_ATTEMPT_ALREADY_STARTED','MODEL_RESERVATION_EXPIRED','MODEL_ACCOUNTING_MIGRATION_REQUIRED'].includes(reason)?'MODEL_USAGE_UNCERTAIN':'PROVIDER_UNAVAILABLE';
  await emit('operation.terminal',{status,...(status==='interrupted'?{errorCode:budgetCode}:{}),retryable:false});
 }
}
