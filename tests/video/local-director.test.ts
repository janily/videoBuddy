import{afterEach,beforeEach,expect,it,vi}from'vitest';import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{FileStore}from'@/services/video/storage/file-store';import{ProjectStore}from'@/services/video/storage/project-store';import{updateJson}from'@/services/video/storage/atomic-store';import{ProjectControl}from'@/contracts/video/project';import{LocalEventLog}from'@/services/video/stream/local-event-log';
import{runDirectorOperation}from'@/services/video/commands/local-director';
let dir:string;beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'vb-director-'))});afterEach(async()=>{vi.unstubAllEnvs();await rm(dir,{recursive:true,force:true})});
it.each([false,true])('schedules a draft after a completed conversation, isolating queue failure: %s',async failQueue=>{
 vi.stubEnv('VIDEO_FLOW','quick');
 const store=new FileStore(dir),projects=new ProjectStore(store),events=new LocalEventLog(dir);
 const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
 const append=events.append.bind(events);events.append=async(event)=>{if(event.type==='message.committed')expect((await projects.access('owner',projectId)).activeScript).toBeTruthy();return append(event)};
 const operationId=crypto.randomUUID(),userId=crypto.randomUUID();
 await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,activeConversation:operationId,ordinalReservations:{[operationId]:{user:1,assistant:2}},nextOrdinal:3}));
 await store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,commandId:crypto.randomUUID(),kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});
 await projects.archiveMessage(projectId,{id:userId,ordinal:1,role:'user',text:'用水墨画家人团圆',status:'completed',contentVersion:1,operationId});
 let queueAttempted=false;const create=store.create.bind(store);store.create=async(key,value)=>{if(key.startsWith('queue/')){queueAttempted=true;if(failQueue)throw Error('QUEUE_UNAVAILABLE')}return create(key,value)};
 await runDirectorOperation(store,events,projectId,operationId,{root:failQueue?'/dev/null/unwritable':dir,decide:async()=>({action:'acknowledge',reply:'画风选好了，我来写脚本。',effect:'update_brief',executionIntent:'none',evidenceMessageIds:[userId],understandingPatch:{baseBriefVersion:0,operations:[{op:'replace_summary',subject:'家人团圆',audience:'家人',summary:['家人团圆'],sourceMessageIds:[userId]},{op:'set_preference',field:'styleSlug',value:'ink-wash',sourceMessageIds:[userId]}]}}),limits:{projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10}});
 const control=await projects.access('owner',projectId);
 expect((await projects.messages(control)).at(-1)?.status).toBe('completed');
 expect((await store.readFresh<{status:string}>(`projects/${projectId}/operations/${operationId}`)).value.status).toBe('succeeded');
 expect(control.activeProduction).toBeFalsy();expect(control.activeScript).toBeTruthy();
 expect(queueAttempted).toBe(true);
});
it('a queued Director job archives the real decision before committed SSE, and a restart does not call twice',async()=>{
 const store=new FileStore(dir),projects=new ProjectStore(store),events=new LocalEventLog(dir);const owner='owner';
 const{projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});const operationId=crypto.randomUUID(),userId=crypto.randomUUID();
 await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,activeConversation:operationId,ordinalReservations:{[operationId]:{user:1,assistant:2}},nextOrdinal:3}));
 await store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,commandId:crypto.randomUUID(),kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});
 await projects.archiveMessage(projectId,{id:userId,ordinal:1,role:'user',text:'给我的咖啡店做视频',status:'completed',contentVersion:1,operationId});
 const ui={canvasFocus:'brief' as const,quickReplies:[{label:'招牌咖啡',text:'重点介绍招牌咖啡'}],canvasRefs:[{text:'咖啡',target:'brief' as const}],readiness:{brief:'partial' as const,nextStep:'ask' as const}};
 let calls=0;const decide=async()=>{calls++;return{action:'ask' as const,reply:'你希望重点介绍哪款咖啡？',effect:'no_change' as const,executionIntent:'none' as const,evidenceMessageIds:[userId],...ui}};
 const limits={projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10};
 await runDirectorOperation(store,events,projectId,operationId,{decide,limits});
 await runDirectorOperation(new FileStore(dir),new LocalEventLog(dir),projectId,operationId,{decide,limits});
 expect(calls).toBe(1);const view=await new ProjectStore(new FileStore(dir)).view(owner,projectId);
 expect(view.messages.map(m=>m.text)).toEqual(['给我的咖啡店做视频','你希望重点介绍哪款咖啡？']);
 expect(view.messages.at(-1)?.ui).toEqual(ui);
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
it.each(['interrupted','cancelled'] as const)('persists native fragments before completion and retains them when %s',async status=>{
 const store=new FileStore(dir),projects=new ProjectStore(store),events=new LocalEventLog(dir);
 const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()}),operationId=crypto.randomUUID();
 await updateJson(store,'projects/'+projectId+'/control',(c:ProjectControl)=>({...c,activeConversation:operationId,ordinalReservations:{[operationId]:{user:1,assistant:2}},nextOrdinal:3}));
 await store.create('projects/'+projectId+'/operations/'+operationId,{id:operationId,projectId,commandId:crypto.randomUUID(),kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});
 const decideStream=async(_understanding:unknown,_messages:unknown,_max:number|undefined,onDelta:(text:string)=>Promise<void>=async()=>{})=>{
  await onDelta('正在理解🌱');
  const stream=await events.readFrom(projectId,operationId,0);expect(stream.filter(x=>x.event.type==='message.delta').map(x=>x.event.payload)).toEqual([expect.objectContaining({offset:0,text:'正在理解🌱'})]);
  if(status==='interrupted')throw Error('NETWORK_DISCONNECTED');
  const {cancelReply}=await import('@/services/video/commands/cancel');await cancelReply(store,projectId,operationId);
  await onDelta('这部分应被停止');
  return{action:'acknowledge' as const,reply:'正在理解🌱这部分应被停止',effect:'no_change' as const,executionIntent:'none' as const,evidenceMessageIds:[]};
 };
 await runDirectorOperation(store,events,projectId,operationId,{decideStream,limits:{projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10}});
 const view=await projects.view('owner',projectId);expect(view.messages.at(-1)).toMatchObject({text:'正在理解🌱',status:status==='cancelled'?'stopped':'interrupted'});
 const stream=await events.readFrom(projectId,operationId,0);expect(stream.filter(x=>x.event.type==='message.delta')).toHaveLength(1);expect(stream.at(-1)?.event.payload).toMatchObject({status});
});
it('a cold worker archives durable fragments from an uncertain started effect without calling the model again',async()=>{
 const store=new FileStore(dir),projects=new ProjectStore(store),events=new LocalEventLog(dir),operationId=crypto.randomUUID(),assistantId=crypto.randomUUID();
 const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
 await updateJson(store,'projects/'+projectId+'/control',(c:ProjectControl)=>({...c,activeConversation:operationId,ordinalReservations:{[operationId]:{user:1,assistant:2}},nextOrdinal:3}));
 await store.create('projects/'+projectId+'/operations/'+operationId,{id:operationId,projectId,commandId:crypto.randomUUID(),kind:'chat',status:'running',canonicalRunId:operationId,streamEpoch:0,fence:0,assistantMessageId:assistantId});
 await store.create('projects/'+projectId+'/operations/'+operationId+'/effects/director',{status:'started',attemptId:crypto.randomUUID()});
 await events.append({schemaVersion:5,projectId,operationId,epoch:0,eventId:crypto.randomUUID(),createdAt:new Date().toISOString(),type:'message.delta',payload:{messageId:assistantId,contentVersion:1,offset:0,text:'已经收到的真实片段🌱'}});
 let calls=0;await runDirectorOperation(new FileStore(dir),new LocalEventLog(dir),projectId,operationId,{decide:async()=>{calls++;throw Error('MUST_NOT_RETRY')},limits:{projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10}});
 expect(calls).toBe(0);expect((await projects.view('owner',projectId)).messages.at(-1)).toMatchObject({text:'已经收到的真实片段🌱',status:'interrupted'});
 expect((await events.readFrom(projectId,operationId,0)).filter(x=>x.event.type==='message.delta')).toHaveLength(1);
});
it('archives one large native Chinese fragment through bounded Unicode-safe durable events',async()=>{
 const store=new FileStore(dir),projects=new ProjectStore(store),events=new LocalEventLog(dir),operationId=crypto.randomUUID();
 const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
 await updateJson(store,'projects/'+projectId+'/control',(c:ProjectControl)=>({...c,activeConversation:operationId,ordinalReservations:{[operationId]:{user:1,assistant:2}},nextOrdinal:3}));
 await store.create('projects/'+projectId+'/operations/'+operationId,{id:operationId,projectId,commandId:crypto.randomUUID(),kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});
 const reply='中'.repeat(1023)+'🌱'+'文'.repeat(5000);
 await runDirectorOperation(store,events,projectId,operationId,{decideStream:async(_u,_m,_max,onDelta)=>{await onDelta!(reply);return{action:'acknowledge',reply,effect:'no_change',executionIntent:'none',evidenceMessageIds:[]}},limits:{projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10}});
 expect((await projects.view('owner',projectId)).messages.at(-1)).toMatchObject({text:reply,status:'completed'});
 const deltas=(await events.readFrom(projectId,operationId,0)).filter(x=>x.event.type==='message.delta');let rebuilt='';
 for(const {event} of deltas){if(event.type!=='message.delta')throw Error('BAD_TEST_EVENT');expect(event.payload.offset).toBe(rebuilt.length);expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThan(16384);expect(/[\uD800-\uDBFF]$/.test(event.payload.text)).toBe(false);rebuilt+=event.payload.text}
 expect(rebuilt).toBe(reply);
});
it('recovers a fragment fsynced to the log when its append acknowledgement is lost',async()=>{
 const store=new FileStore(dir),projects=new ProjectStore(store),events=new LocalEventLog(dir),operationId=crypto.randomUUID();
 const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
 await updateJson(store,'projects/'+projectId+'/control',(c:ProjectControl)=>({...c,activeConversation:operationId,ordinalReservations:{[operationId]:{user:1,assistant:2}},nextOrdinal:3}));
 await store.create('projects/'+projectId+'/operations/'+operationId,{id:operationId,projectId,commandId:crypto.randomUUID(),kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});
 const append=events.append.bind(events);events.append=async event=>{const index=await append(event);if(event.type==='message.delta')throw Error('ACK_LOST_AFTER_FSYNC');return index};
 await runDirectorOperation(store,events,projectId,operationId,{decideStream:async(_u,_m,_max,onDelta)=>{await onDelta!('持久片段🌱');throw Error('UNREACHABLE')},limits:{projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10}});
 expect((await projects.view('owner',projectId)).messages.at(-1)).toMatchObject({text:'持久片段🌱',status:'interrupted'});
});
it.each(['before_call','during_success','during_failure'] as const)('deletion %s prevents new reply archival and leaves unknown effects untouched',async when=>{
 const store=new FileStore(dir),projects=new ProjectStore(store),events=new LocalEventLog(dir),operationId=crypto.randomUUID();
 const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
 await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,activeConversation:operationId}));
 await store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,commandId:crypto.randomUUID(),kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});
 if(when==='before_call')await projects.tombstone('owner',projectId);
 let calls=0;const decide=async()=>{calls++;await projects.tombstone('owner',projectId);if(when==='during_failure')throw Error('NETWORK_UNKNOWN');return{action:'acknowledge' as const,reply:'不应保存到已删除项目',effect:'no_change' as const,executionIntent:'none' as const,evidenceMessageIds:[]}};
 await runDirectorOperation(store,events,projectId,operationId,{decide,limits:{projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10}});
 expect(calls).toBe(when==='before_call'?0:1);expect((await store.readFresh<{status:string}>(`projects/${projectId}/operations/${operationId}`)).value.status).toBe('cancelled');
 expect(await projects.messages((await store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value)).toEqual([]);
 if(when==='during_failure')expect((await store.readFresh(`projects/${projectId}/operations/${operationId}/effects/director`)).value).toMatchObject({status:'started'});
});
it('passes persisted image observations to Director as untrusted material, without invented image facts',async()=>{
 const store=new FileStore(dir),projects=new ProjectStore(store),events=new LocalEventLog(dir),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()}),assetId=crypto.randomUUID(),userId=crypto.randomUUID(),operationId=crypto.randomUUID(),sha256='d'.repeat(64);
 const imageAnalysis={schemaVersion:1,assetId,sourceSha256:sha256,mime:'image/png',description:'可见一株绿色植物',observations:[],visibleText:[],uncertainties:['无法确定品种'],scope:'provided_image_only',trust:'untrusted_material'};
 const analysisRef=await projects.index.immutable(`projects/${projectId}/assets/${assetId}/analysis/${sha256}`,{schemaVersion:5,assetId,mime:'image/png',sha256,text:imageAnalysis.description+'\n未确认：无法确定品种',imageAnalysis,trust:'untrusted_material'});
 await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,activeConversation:operationId,assets:[{id:assetId,commandId:crypto.randomUUID(),bodyHash:sha256,reservationId:crypto.randomUUID(),filename:'参考.png',declaredBytes:100,declaredMime:'image/png',intendedUse:'参考画面',rightsConfirmed:true,status:'ready',expiresAt:new Date(Date.now()+60000).toISOString(),sha256,bytes:100,analysisRef,quotaReserved:true}],ordinalReservations:{[operationId]:{user:1,assistant:2}},nextOrdinal:3}));
 await store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,commandId:crypto.randomUUID(),kind:'chat',status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0});
 await projects.archiveMessage(projectId,{id:userId,ordinal:1,role:'user',text:'用这张图片',attachmentIds:[assetId],status:'completed',contentVersion:1,operationId});let calls=0;
 await runDirectorOperation(store,events,projectId,operationId,{decide:async(_u,messages)=>{calls++;expect(messages[0].attachments?.[0]).toMatchObject({assetId,mime:'image/png',imageAnalysis});return{action:'acknowledge',reply:'收到图片，植物品种还未确认。',effect:'no_change',executionIntent:'none',evidenceMessageIds:[userId]}},limits:{projectCalls:10,projectInputTokens:100000,projectOutputTokens:10000,dailyCalls:10}});
 expect(calls).toBe(1);expect((await projects.view('owner',projectId)).messages.at(-1)?.text).toBe('收到图片，植物品种还未确认。');
});
