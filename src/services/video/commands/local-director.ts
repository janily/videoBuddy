import {randomUUID} from 'node:crypto';
import {AtomicStore,updateJson,createOrRead,StoreMissing} from '@/services/video/storage/atomic-store';
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
import {deferDirectorFeedback} from '@/services/video/revisions/pending-feedback';
import {canonicalHash} from '@/services/video/domain/hash';
interface FrozenDirectorInput{control:ProjectControl;messages:ArchivedMessage[];understanding:Understanding;context:SourceMessage[]}
interface DirectorInputRecord{schemaVersion:5;input:FrozenDirectorInput;sha256:string}
function verifyInput(record:DirectorInputRecord,projectId:string,operationId:string){
 if(record.schemaVersion!==5||canonicalHash(record.input)!==record.sha256||record.input.control.projectId!==projectId||record.input.control.activeConversation!==operationId||record.input.understanding.briefVersion!==record.input.control.briefVersion)throw Error('DIRECTOR_INPUT_CHANGED');
 return record.input;
}

type Decide=typeof runDirector;
export async function runDirectorOperation(store:AtomicStore,events:LocalEventLog,projectId:string,operationId:string,options:{decide?:Decide;decideStream?:typeof runDirectorStream;limits?:ModelLimits}={}){
 const p=`projects/${projectId}`,opKey=`${p}/operations/${operationId}`;
 const claim=await claimOperation(store,opKey,operationId);
 if(!claim.claimed)return;
 const finishDeleted=async()=>{
  const current=await updateJson(store,opKey,(value:{status:string;streamEpoch:number})=>['succeeded','failed','cancelled','interrupted','superseded'].includes(value.status)?value:{...value,status:'cancelled'});
  if(current.status==='cancelled'&&!(await events.readFrom(projectId,operationId,0)).some(({event})=>event.epoch===current.streamEpoch&&event.type==='operation.terminal'&&event.payload.status==='cancelled'))await events.append(StreamEventSchema.parse({schemaVersion:5,projectId,operationId,epoch:current.streamEpoch,eventId:randomUUID(),type:'operation.terminal',createdAt:new Date().toISOString(),payload:{status:'cancelled',retryable:false}}));
 };
 if((await store.readFresh<ProjectControl>(`${p}/control`)).value.deletedAt){await finishDeleted();return}
 const projects=new ProjectStore(store),candidateId=randomUUID();
 const op=await updateJson(store,opKey,(value:{assistantMessageId?:string;streamEpoch:number;status:string})=>({...value,assistantMessageId:value.assistantMessageId||candidateId}));
 let control=(await store.readFresh<ProjectControl>(`${p}/control`)).value;
 let messages=await projects.messages(control),understanding=(await store.readFresh<Understanding>(control.understandingRef.key)).value;
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
  let savedInput:FrozenDirectorInput|undefined;
  try{savedInput=verifyInput((await store.readFresh<DirectorInputRecord>(`${opKey}/director-input`)).value,projectId,operationId)}catch(error){if(!(error instanceof StoreMissing))throw error}
  if(savedInput){control=savedInput.control;messages=savedInput.messages;understanding=savedInput.understanding}
  else{
   // A legacy completed effect has no provable original baseline. Never
   // infer its authorization from a later control snapshot.
   try{if((await store.readFresh<{status:string}>(`${opKey}/effects/director`)).value.status==='completed')throw Error('DIRECTOR_INPUT_MISSING')}catch(error){if(!(error instanceof StoreMissing))throw error}
  }
  const previous=await durableReply();streamedText=previous.text;
  if(!previous.started)await emit('message.started',{messageId:assistantId,contentVersion:1,role:'assistant',ordinal});
  await emit('activity.updated',{stage:'understanding',label:'正在整理你的想法'});
  let context:SourceMessage[]=savedInput?.context??await Promise.all(messages.map(async message=>({
   id:message.id,role:message.role,text:message.text,
   ...(message.attachmentIds?.length?{attachments:await Promise.all(message.attachmentIds.map(async assetId=>{
    const asset=control.assets.find(item=>item.id===assetId);
    if(!asset||asset.status!=='ready'||!['text/markdown','application/pdf','audio/wav','audio/mpeg','audio/mp4'].includes(asset.declaredMime)||!asset.analysisRef)throw Error('SOURCE_INVALID');
    const analysis=(await store.readFresh<TextAnalysis>(asset.analysisRef.key)).value;
    if(analysis.assetId!==assetId||analysis.sha256!==asset.sha256||analysis.mime!==asset.declaredMime||analysis.trust!=='untrusted_material'||(asset.declaredMime==='application/pdf'&&!analysis.pages?.length)||(asset.declaredMime.startsWith('audio/')&&(!analysis.segments?.length||!analysis.language)))throw Error('SOURCE_INVALID');
    return{assetId,filename:asset.filename,mime:asset.declaredMime,sha256:analysis.sha256,text:analysis.text,...(analysis.pages?{pages:analysis.pages}:{}),...(analysis.segments?{segments:analysis.segments}:{})};
   }))}:{}),
  })));
  const input:FrozenDirectorInput={control,messages,understanding,context};
  const frozen=verifyInput(await createOrRead(store,`${opKey}/director-input`,{schemaVersion:5 as const,input,sha256:canonicalHash(input)}),projectId,operationId);
  control=frozen.control;messages=frozen.messages;understanding=frozen.understanding;context=frozen.context;
  const projectContext={phase:control.phase,activeProductionId:control.activeProduction??null,briefVersion:control.briefVersion,consentEpoch:control.consentEpoch};
  const bytes=Buffer.byteLength(JSON.stringify(directorContext(understanding,context,projectContext)));if(bytes>60000)throw Error('CONTEXT_LIMIT');
  const assertActive=async()=>{const latest=(await store.readFresh<ProjectControl>(`${p}/control`)).value,current=(await store.readFresh<{status:string}>(opKey)).value;if(latest.deletedAt||latest.activeConversation!==operationId||current.status!=='running')throw Error('ACCESS_NOT_FOUND');if(!Number.isFinite(Date.parse(latest.expiresAt))||Date.parse(latest.expiresAt)<=Date.now())throw Error('PROJECT_EXPIRED')};
  await assertActive();
  const reservation=await reserveModelBudget(store,projectId,`${operationId}-director`,{inputTokens:bytes+4096,outputTokens:2000},options.limits||modelLimits());
  const decision=await runEffect(store,`${p}/operations/${operationId}/effects/director`,async()=>{
   await assertActive();
   const raw=options.decide?await options.decide(understanding,context,reservation.maxOutputTokens,{assertActive,projectContext}):options.decideStream?await options.decideStream(understanding,context,reservation.maxOutputTokens,onDelta,process.env,{assertActive,projectContext}):await withAccountedModel(store,reservation.reservation,()=>runDirectorStream(understanding,context,reservation.maxOutputTokens,onDelta,process.env,{assertActive,projectContext}));
   const result=GuidanceDecisionSchema.parse(raw);
   guardGuidance(result,context,false,understanding);return result;
  });
  if((await store.readFresh<ProjectControl>(`${p}/control`)).value.deletedAt){await finishDeleted();return}
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
   if(decision.understandingPatch&&!control.activeProduction&&value.consentEpoch!==control.consentEpoch)throw Error('CHANGE_STALE');
   const deferred=Boolean((decision.understandingPatch||decision.effect==='pending_followup')&&(control.activeProduction||value.activeProduction));
   // Validate the proposed correction against its original understanding, but
   // never mutate the active production's frozen brief or revive a cancelled one.
   if(deferred&&decision.understandingPatch)applyUnderstandingPatch(understanding,decision.understandingPatch,context);
   const next=decision.understandingPatch&&!deferred?applyUnderstandingPatch(latest,decision.understandingPatch,context):latest;
   const pendingFeedbackIndexRef=deferred?await deferDirectorFeedback(projects,value,control.activeProduction?control:{...control,activeProduction:value.activeProduction},operationId,messages,decision.understandingPatch):value.pendingFeedbackIndexRef;
   return{...value,...(pendingFeedbackIndexRef?{pendingFeedbackIndexRef}:{}),controlVersion:value.controlVersion+1,briefVersion:next.briefVersion,previewState:next.briefVersion!==value.briefVersion&&value.previewState==='ready'?'stale':value.previewState,understandingRef:deferred?value.understandingRef:await projects.index.immutable(`${p}/understanding/${next.briefVersion}`,next),messagesIndexRef:await projects.index.append(`${p}/indexes/messages`,value.messagesIndexRef,{id:assistantId,ordinal,ref:messageRef}),activeConversation:null};
  });
  await emit('message.committed',{messageId:assistantId,contentVersion:1,archiveRevision:messageRef.sha256});
  await updateJson(store,opKey,(value:typeof op)=>({...value,status:'succeeded'}));
  await emit('operation.terminal',{status:'succeeded',retryable:false});
 }catch(error){
  if((await store.readFresh<ProjectControl>(`${p}/control`)).value.deletedAt){await finishDeleted();return}
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
