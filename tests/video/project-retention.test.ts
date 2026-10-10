import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';
import {FileStore} from './helpers/file-store';import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson,StoreConflict} from '@/services/video/storage/atomic-store';import type {ProjectControl} from '@/contracts/video/project';
import {coordinateProjectExpiration,sweepRetentionPage} from '@/services/video/commands/project-retention';
let root:string,store:FileStore,projects:ProjectStore;
const now=Date.parse('2026-10-03T14:00:00Z');
beforeEach(async()=>{root=await mkdtemp(`${tmpdir()}/vb-retention-`);store=new FileStore(root);projects=new ProjectStore(store)});afterEach(async()=>{await rm(root,{recursive:true,force:true})});
async function create(expiresAt:string){const id=(await projects.create('a',{schemaVersion:5,clientCreateId:crypto.randomUUID(),clientCommandId:crypto.randomUUID()})).projectId;await updateJson(store,`projects/${id}/control`,(c:ProjectControl)=>({...c,expiresAt}));return id}
it('expiry is a single durable tombstone, cancels jobs and keeps own requests 410 and foreign requests 404',async()=>{
 const id=await create('2026-10-01T00:00:00Z'),op=crypto.randomUUID();await store.create(`projects/${id}/operations/${op}`,{id:op,projectId:id,status:'queued',canonicalRunId:null,fence:0});
 const first=await coordinateProjectExpiration(store,id,now);expect(first).toMatchObject({status:'cancelling',operationsPending:0});expect(await coordinateProjectExpiration(new FileStore(root),id,now+100)).toEqual(first);
 const c=(await store.readFresh<ProjectControl>(`projects/${id}/control`)).value;expect(c.consentEpoch).toBe(1);expect(c.controlVersion).toBe(1);expect(c.deletedAt).toBe(new Date(now).toISOString());
 await expect(projects.view('a',id)).rejects.toThrow('PROJECT_EXPIRED');await expect(projects.view('b',id)).rejects.toThrow('ACCESS_NOT_FOUND');
 expect((await store.readFresh(`projects/${id}/operations/${op}`)).value).toMatchObject({status:'cancelled',fence:1});
});
it('expiry pages inspect a bounded set of controls and leave live projects intact',async()=>{
 const ids=await Promise.all(Array.from({length:5},()=>create('2026-10-01T00:00:00Z'))),live=await create('2030-01-01T00:00:00Z');let cursor:string|null=null,total=0;
 do{const page=await sweepRetentionPage(store,{now,pageSize:2,cursor});expect(page.inspected).toBeLessThanOrEqual(2);expect(page.failed).toBe(0);total+=page.expired;cursor=page.nextCursor}while(cursor);
 expect(total).toBe(ids.length);expect((await projects.view('a',live)).phase).toBe('collecting');
});
it('fresh CAS prevents expiry after simultaneous user activity extends retention',async()=>{
 const id=await create('2026-10-01T00:00:00Z'),key=`projects/${id}/control`;let raced=false;
 const racing={readFresh:store.readFresh.bind(store),create:store.create.bind(store),listKeys:store.listKeys.bind(store),cas:async<T>(k:string,e:string,v:T)=>{if(k===key&&!raced){raced=true;await updateJson(store,key,(c:ProjectControl)=>({...c,expiresAt:'2030-01-01T00:00:00Z',lastUserActivityAt:new Date(now).toISOString(),controlVersion:c.controlVersion+1}));throw new StoreConflict()}await store.cas(k,e,v)}};
 expect(await coordinateProjectExpiration(racing,id,now)).toEqual({status:'retained'});expect((await projects.view('a',id)).phase).toBe('collecting');
});
it('invalid cursors and clocks do not mutate projects',async()=>{
 const id=await create('2026-10-01T00:00:00Z');await expect(sweepRetentionPage(store,{now,pageSize:2,cursor:'../../other'})).rejects.toThrow('VALIDATION_FAILED');await expect(coordinateProjectExpiration(store,id,NaN)).rejects.toThrow('VALIDATION_FAILED');expect((await store.readFresh<ProjectControl>(`projects/${id}/control`)).value.deletedAt).toBeUndefined();
});
it.each(['markdown','pdf'] as const)('background %s analysis cannot extend user retention',async kind=>{
 const {writeFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');const {publishMarkdownAnalysis,publishPdfAnalysis}=await import('@/services/video/assets/analysis');
 const id=await create('2030-01-01T00:00:00Z'),assetId=crypto.randomUUID(),bytes=Buffer.from('活动日期：10月8日'),sha256=createHash('sha256').update(bytes).digest('hex'),lastUserActivityAt='2026-09-20T00:00:00Z';
 await updateJson(store,`projects/${id}/control`,(c:ProjectControl)=>({...c,lastUserActivityAt,assets:[{id:assetId,commandId:crypto.randomUUID(),bodyHash:'a'.repeat(64),reservationId:crypto.randomUUID(),filename:'资料',declaredBytes:100,declaredMime:kind==='markdown'?'text/markdown':'application/pdf',intendedUse:'reference',rightsConfirmed:true,status:'uploaded',expiresAt:'2030-01-01T00:00:00Z',sha256,bytes:bytes.length,quotaReserved:true}]}));
 if(kind==='markdown'){const path=root+'/source.md';await writeFile(path,bytes);await publishMarkdownAnalysis(projects,id,assetId,path)}else await publishPdfAnalysis(projects,id,assetId,['活动日期：10月8日']);
 expect((await store.readFresh<ProjectControl>(`projects/${id}/control`)).value).toMatchObject({lastUserActivityAt,expiresAt:'2030-01-01T00:00:00Z'});
});
it('upload admission extends retention once while duplicate background-free replays do not',async()=>{
 const {reserveAsset,markUploaded}=await import('@/services/video/assets/reservations');const id=await create('2030-01-01T00:00:00Z'),key=`projects/${id}/control`;
 await updateJson(store,key,(c:ProjectControl)=>({...c,lastUserActivityAt:'2026-09-20T00:00:00Z'}));
 const input={filename:'资料.md',declaredBytes:100,declaredMime:'text/markdown',intendedUse:'reference',rightsConfirmed:true},command=crypto.randomUUID(),asset=await reserveAsset(store,key,input,command),first=(await store.readFresh<ProjectControl>(key)).value;
 expect(first.lastUserActivityAt).not.toBe('2026-09-20T00:00:00Z');expect(Date.parse(first.expiresAt)-Date.parse(first.lastUserActivityAt)).toBe(30*86400000);
 await reserveAsset(store,key,input,command);expect((await store.readFresh<ProjectControl>(key)).value.lastUserActivityAt).toBe(first.lastUserActivityAt);
 await markUploaded(store,key,asset.id,'a'.repeat(64),10);const complete=(await store.readFresh<ProjectControl>(key)).value;await markUploaded(store,key,asset.id,'a'.repeat(64),10);expect((await store.readFresh<ProjectControl>(key)).value.lastUserActivityAt).toBe(complete.lastUserActivityAt);
});
it('maintenance keeps its page cursor across a cold restart without changing live deadlines',async()=>{
 const {runRetentionMaintenance}=await import('@/services/video/commands/project-retention');
 await Promise.all(Array.from({length:102},()=>create('2030-01-01T00:00:00Z')));
 const first=await runRetentionMaintenance(store,now);expect(first.inspected).toBe(100);expect(first.nextCursor).toBeTruthy();expect(first.expired).toBe(0);
 const second=await runRetentionMaintenance(new FileStore(root),now);expect(second.inspected).toBe(2);expect(second.nextCursor).toBeNull();expect(second.expired).toBe(0);
});
it('an invalid deadline is reported without blocking healthy expiration or altering accounting',async()=>{
 const invalid=await create('invalid'),healthy=await create('2026-10-01T00:00:00Z');await store.create(`projects/${healthy}/budget`,{modelCalls:8,modelOutputTokens:78879});
 const page=await sweepRetentionPage(store,{now});expect(page).toMatchObject({inspected:2,expired:1,failed:1});expect((await store.readFresh<ProjectControl>(`projects/${invalid}/control`)).value.deletedAt).toBeUndefined();expect((await store.readFresh(`projects/${healthy}/budget`)).value).toEqual({modelCalls:8,modelOutputTokens:78879});
});
it('expiry CAS acknowledgement loss leaves one marker and cold cancellation resumes without resetting budget',async()=>{
 const id=await create('2026-10-01T00:00:00Z'),key=`projects/${id}/control`,op=crypto.randomUUID();await store.create(`projects/${id}/operations/${op}`,{id:op,projectId:id,status:'queued',canonicalRunId:null,fence:0});let lost=false;
 const faulty={readFresh:store.readFresh.bind(store),create:store.create.bind(store),listKeys:store.listKeys.bind(store),cas:async<T>(k:string,e:string,v:T)=>{await store.cas(k,e,v);if(k===key&&!lost){lost=true;throw Error('ACK_LOST')}}};
 await expect(coordinateProjectExpiration(faulty,id,now)).rejects.toThrow('ACK_LOST');await expect(projects.access('a',id)).rejects.toThrow('PROJECT_EXPIRED');
 expect(await coordinateProjectExpiration(new FileStore(root),id,now+1000)).toEqual({status:'cancelling',operationsPending:0});expect((await store.readFresh<ProjectControl>(key)).value).toMatchObject({controlVersion:1,consentEpoch:1,deletedAt:new Date(now).toISOString()});expect((await store.readFresh(`projects/${id}/operations/${op}`)).value).toMatchObject({status:'cancelled',fence:1});
});
it('explicit activity survives a cold command replay and rejects command reuse and expired resurrection',async()=>{
 const {recordUserCommandActivity}=await import('@/services/video/commands/user-activity');const id=await create('2030-01-01T00:00:00Z'),command=crypto.randomUUID(),hash='a'.repeat(64),key=`projects/${id}/control`;
 await updateJson(store,key,(c:ProjectControl)=>({...c,lastUserActivityAt:'2026-09-20T00:00:00Z'}));
 const first=await recordUserCommandActivity(projects,'a',id,command,hash);expect(Date.parse(first.expiresAt)-Date.parse(first.lastUserActivityAt)).toBe(30*86400000);
 expect((await recordUserCommandActivity(new ProjectStore(new FileStore(root)),'a',id,command,hash)).lastUserActivityAt).toBe(first.lastUserActivityAt);
 await expect(recordUserCommandActivity(projects,'a',id,command,'b'.repeat(64))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 await updateJson(store,key,(c:ProjectControl)=>({...c,expiresAt:'2026-01-01T00:00:00Z'}));await expect(recordUserCommandActivity(projects,'a',id,command,hash)).rejects.toThrow('PROJECT_EXPIRED');
});
it.each(['reply','production'] as const)('late %s cancellation cannot renew an already expired project',async scope=>{
 const {cancelReply,cancelProduction}=await import('@/services/video/commands/cancel');const id=await create('2026-01-01T00:00:00Z'),op=crypto.randomUUID(),key=`projects/${id}/control`;
 await updateJson(store,key,(c:ProjectControl)=>({...c,activeConversation:scope==='reply'?op:null,activeProduction:scope==='production'?op:null}));await store.create(`projects/${id}/operations/${op}`,{id:op,projectId:id,status:'running',canonicalRunId:'live',fence:0});
 await expect(scope==='reply'?cancelReply(store,id,op):cancelProduction(store,id,op)).rejects.toThrow('PROJECT_EXPIRED');expect((await store.readFresh<ProjectControl>(key)).value.expiresAt).toBe('2026-01-01T00:00:00Z');expect((await store.readFresh(`projects/${id}/operations/${op}`)).value).toMatchObject({status:'running',fence:0});
});
it('a malformed retention deadline fails closed for the owner and remains hidden from other owners',async()=>{
 const id=await create('invalid');await expect(projects.view('a',id)).rejects.toThrow('RETENTION_RECORD_INVALID');await expect(projects.view('b',id)).rejects.toThrow('ACCESS_NOT_FOUND');
});
it('user message archival and new chat admission cannot resurrect an expired project',async()=>{
 const {CommandService}=await import('@/services/video/commands/submit');const id=await create('2026-01-01T00:00:00Z');let starts=0;
 await expect(projects.archiveMessage(id,{id:crypto.randomUUID(),ordinal:1,role:'user',text:'过期后不应接收',status:'completed',contentVersion:1})).rejects.toThrow('PROJECT_EXPIRED');
 const commands=new CommandService(store,async()=>{starts++;return{runId:'unit-only'}});await expect(commands.submit(id,'chat',{clientCommandId:crypto.randomUUID(),text:'不会付费'})).rejects.toThrow('PROJECT_EXPIRED');expect(starts).toBe(0);
 const control=(await store.readFresh<ProjectControl>(`projects/${id}/control`)).value;expect(control.expiresAt).toBe('2026-01-01T00:00:00Z');expect(control.activeConversation).toBeUndefined();expect(await projects.messages(control)).toEqual([]);
});
it('first chat command admission records activity even when durable message work is delayed',async()=>{
 const {CommandService}=await import('@/services/video/commands/submit');const id=await create(new Date(Date.now()+10000).toISOString()),key=`projects/${id}/control`,old=Date.now()-30*86400000+10000;
 await updateJson(store,key,(c:ProjectControl)=>({...c,lastUserActivityAt:new Date(old).toISOString()}));let starts=0;const service=new CommandService(store,async()=>{starts++;return{runId:'unit-only'}}),input={clientCommandId:crypto.randomUUID(),text:'明确用户活动'};
 await service.submit(id,'chat',input);const first=(await store.readFresh<ProjectControl>(key)).value;expect(Date.parse(first.lastUserActivityAt)).toBeGreaterThan(old);await service.submit(id,'chat',input);expect((await store.readFresh<ProjectControl>(key)).value.lastUserActivityAt).toBe(first.lastUserActivityAt);expect(starts).toBe(1);
});
it('cold chat recovery cannot count delayed user archival as another day of user activity',async()=>{
 const {CommandService}=await import('@/services/video/commands/submit');const id=await create('2030-01-01T00:00:00Z'),key=`projects/${id}/control`,messageId=crypto.randomUUID(),input={clientCommandId:crypto.randomUUID(),text:'首次明确用户消息'};let fail=true;
 const start=async(p:string,operationId:string)=>{if(fail)throw Error('POWER_LOSS');await projects.archiveMessage(p,{id:messageId,ordinal:1,role:'user',text:input.text,status:'completed',contentVersion:1,operationId});return{runId:operationId}};
 await expect(new CommandService(store,start).submit(id,'chat',input)).rejects.toThrow('START_FAILED');const first=(await store.readFresh<ProjectControl>(key)).value;
 fail=false;const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse(first.lastUserActivityAt)+86400000);
 try{await new CommandService(new FileStore(root),start).submit(id,'chat',input);expect((await store.readFresh<ProjectControl>(key)).value).toMatchObject({lastUserActivityAt:first.lastUserActivityAt,expiresAt:first.expiresAt})}finally{clock.mockRestore()}
});
