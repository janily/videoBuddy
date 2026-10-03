import{afterEach,beforeEach,expect,it}from'vitest';import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{FileStore}from'@/services/video/storage/file-store';import{ProjectStore}from'@/services/video/storage/project-store';import{updateJson}from'@/services/video/storage/atomic-store';import{ProjectControl}from'@/contracts/video/project';import{LocalEventLog}from'@/services/video/stream/local-event-log';
import{runDirectorOperation}from'@/services/video/commands/local-director';
let dir:string;beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'vb-director-'))});afterEach(async()=>{await rm(dir,{recursive:true,force:true})});
it('a queued Director job archives the real decision before committed SSE, and a restart does not call twice',async()=>{
 const store=new FileStore(dir),projects=new ProjectStore(store),events=new LocalEventLog(dir);const owner='owner';
 const{projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});const operationId=crypto.randomUUID(),userId=crypto.randomUUID();
 await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,activeConversation:operationId,ordinalReservations:{[operationId]:{user:1,assistant:2}},nextOrdinal:3}));
 await store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,commandId:crypto.randomUUID(),kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});
 await projects.archiveMessage(projectId,{id:userId,ordinal:1,role:'user',text:'给我的咖啡店做视频',status:'completed',contentVersion:1,operationId});
 let calls=0;const decide=async()=>{calls++;return{action:'ask' as const,reply:'你希望重点介绍哪款咖啡？',effect:'no_change' as const,executionIntent:'none' as const,evidenceMessageIds:[userId]}};
 const limits={projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10};
 await runDirectorOperation(store,events,projectId,operationId,{decide,limits});
 await runDirectorOperation(new FileStore(dir),new LocalEventLog(dir),projectId,operationId,{decide,limits});
 expect(calls).toBe(1);const view=await new ProjectStore(new FileStore(dir)).view(owner,projectId);
 expect(view.messages.map(m=>m.text)).toEqual(['给我的咖啡店做视频','你希望重点介绍哪款咖啡？']);
 const stream=await events.readFrom(projectId,operationId,0);expect(stream.some(x=>x.event.type==='message.committed')).toBe(true);
 expect(stream.at(-1)?.event.type).toBe('operation.terminal');
});
it('attachment-only input gives the Director actual saved Markdown bytes with asset identity',async()=>{
 const store=new FileStore(dir),projects=new ProjectStore(store),events=new LocalEventLog(dir),owner='owner';
 const{projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
 const operationId=crypto.randomUUID(),userId=crypto.randomUUID(),assetId=crypto.randomUUID(),sha256='a'.repeat(64);
 const analysisRef=await projects.index.immutable(`projects/${projectId}/assets/${assetId}/analysis/${sha256}`,{schemaVersion:5,assetId,mime:'text/markdown',sha256,text:'活动日期：10月8日',trust:'untrusted_material'});
 await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,activeConversation:operationId,assets:[{id:assetId,commandId:crypto.randomUUID(),bodyHash:sha256,reservationId:crypto.randomUUID(),filename:'资料.md',declaredBytes:100,declaredMime:'text/markdown',intendedUse:'reference',rightsConfirmed:true,status:'ready',expiresAt:new Date(Date.now()+60000).toISOString(),sha256,bytes:30,analysisRef,quotaReserved:true}],ordinalReservations:{[operationId]:{user:1,assistant:2}},nextOrdinal:3}));
 await store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,commandId:crypto.randomUUID(),kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});
 await projects.archiveMessage(projectId,{id:userId,ordinal:1,role:'user',text:'',attachmentIds:[assetId],status:'completed',contentVersion:1,operationId});
 const decide=async(_understanding:unknown,messages:{attachments?:{assetId:string;text:string}[]}[])=>{
  expect(messages[0].attachments?.[0]).toMatchObject({assetId,text:'活动日期：10月8日'});
  return{action:'acknowledge' as const,reply:'资料写着活动日期是10月8日。',effect:'no_change' as const,executionIntent:'none' as const,evidenceMessageIds:[userId]};
 };
 await runDirectorOperation(store,events,projectId,operationId,{decide,limits:{projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10}});
 expect((await projects.view(owner,projectId)).messages.at(-1)?.text).toBe('资料写着活动日期是10月8日。');
});
it.each(['MODEL_BUDGET_OVERRUN','MODEL_USAGE_UNCERTAIN','MODEL_RESERVATION_EXPIRED','MODEL_ACCOUNTING_MIGRATION_REQUIRED'])('archives interruption and emits the actual budget blocking reason (%s)',async code=>{
 const store=new FileStore(dir),projects=new ProjectStore(store),events=new LocalEventLog(dir);
 const{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
 const operationId=crypto.randomUUID();
 await updateJson(store,'projects/'+projectId+'/control',(c:ProjectControl)=>({...c,activeConversation:operationId,ordinalReservations:{[operationId]:{user:1,assistant:2}},nextOrdinal:3}));
 await store.create('projects/'+projectId+'/operations/'+operationId,{id:operationId,projectId,commandId:crypto.randomUUID(),kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});
 await runDirectorOperation(store,events,projectId,operationId,{decide:async()=>{throw Error(code)},limits:{projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10}});
 const stream=await events.readFrom(projectId,operationId,0),last=stream.at(-1)?.event;
 expect(last?.type).toBe('operation.terminal');
 expect(last?.payload).toMatchObject({status:'interrupted',errorCode:code==='MODEL_BUDGET_OVERRUN'?'BUDGET_LIMIT':'MODEL_USAGE_UNCERTAIN',retryable:false});
 expect((await projects.view('owner',projectId)).messages.at(-1)?.status).toBe('interrupted');
});
