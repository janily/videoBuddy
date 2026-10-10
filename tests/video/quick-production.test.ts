import {it,expect} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {LocalEventLog} from '@/services/video/stream/local-event-log';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import {cancelProduction} from '@/services/video/commands/cancel';
import {runQuickFilmOperation} from '@/services/video/quick/operation';
import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {runQueuedOnce} from '@/services/video/commands/local-worker';
import {buildQuickFilm} from '@/services/video/quick/film';
import {preparePreview} from '@/services/video/quick/prepare';
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'vb-preview-worker-')),store=new FileStore(root),projects=new ProjectStore(store);
 const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),operationId=randomUUID(),revisionId=randomUUID(),previewId=randomUUID();
 const c=await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,phase:'generating' as const,activeProduction:operationId}));
 await store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,kind:'preview',commandId:randomUUID(),status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0,revisionId,previewId,briefVersion:c.briefVersion,consentEpoch:c.consentEpoch,understandingRef:c.understandingRef});
 return{root,store,projects,projectId,operationId,revisionId,previewId,events:new LocalEventLog(root)};
}
it.each([
 {error:Error('PICTURE_SEQUENCE_OUTPUT_CHANGED: /private/provider-secret'),internalCode:'PICTURE_SEQUENCE_OUTPUT_CHANGED',errorClass:'Error'},
 {error:Object.assign(Error('open /private/provider-secret failed'),{code:'ENOENT'}),internalCode:'ENOENT',errorClass:'Error'},
 {error:TypeError('provider-secret https://private.example/?token=secret'),internalCode:'UNCLASSIFIED',errorClass:'TypeError'},
])('a private preview diagnostic retains $internalCode without exposing error text',async({error,internalCode,errorClass})=>{
 const f=await setup();try{
  await runQuickFilmOperation(f.store,f.events,f.projectId,f.operationId,{root:f.root,build:async(_projects,_input,_options,activity)=>{await activity('composition','正在合成画面和声音');throw error}});
  const diagnostic=(await new FileStore(f.root).readFresh(`projects/${f.projectId}/operations/${f.operationId}/failure-diagnostic`)).value;
  expect(diagnostic).toMatchObject({schemaVersion:1,operationId:f.operationId,revisionId:f.revisionId,stage:'composition',internalCode,errorClass,publicErrorCode:'PROVIDER_UNAVAILABLE'});
  expect(JSON.stringify(diagnostic)).not.toContain('provider-secret');expect(JSON.stringify(diagnostic)).not.toContain('private.example');
  const view=await new ProjectStore(new FileStore(f.root)).view('owner',f.projectId);
  expect(view.productionFailure?.errorCode).toBe('PROVIDER_UNAVAILABLE');
  const events=(await f.events.readFrom(f.projectId,f.operationId,0)).map(({event})=>event);
  expect(JSON.stringify({view,events})).not.toContain('internalCode');expect(JSON.stringify({view,events})).not.toContain('provider-secret');
  await runQuickFilmOperation(f.store,f.events,f.projectId,f.operationId,{root:f.root,build:async()=>{throw Error('MUST_NOT_RETRY')}});
  expect((await f.store.readFresh(`projects/${f.projectId}/operations/${f.operationId}/failure-diagnostic`)).value).toEqual(diagnostic);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('diagnostic storage failure preserves the original terminal outcome and does not retry media',async()=>{
 const f=await setup(),create=f.store.create.bind(f.store);let calls=0;
 try{
  f.store.create=async(key,value)=>{if(key.endsWith('/failure-diagnostic'))throw Error('STORE_IO_FAILED');return create(key,value)};
  const options={root:f.root,build:async()=>{calls++;throw Error('PICTURE_SEQUENCE_OUTPUT_CHANGED')}};
  await runQuickFilmOperation(f.store,f.events,f.projectId,f.operationId,options);
  await runQuickFilmOperation(f.store,f.events,f.projectId,f.operationId,options);
  expect(calls).toBe(1);
  expect((await f.events.readFrom(f.projectId,f.operationId,0)).at(-1)?.event.payload).toMatchObject({status:'failed',errorCode:'PROVIDER_UNAVAILABLE'});
  expect((await f.projects.view('owner',f.projectId)).activeProduction).toBeNull();
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it.each(['retry','queue'])('unclaimed cancellation repairs a lost blocker-clearing ACK via %s without starting media',async recovery=>{
 const f=await setup(),cas=f.store.cas.bind(f.store);let controls=0,calls=0;
 try{
  const queue=new LocalOperationQueue(f.store,f.root);await queue.enqueue(f.projectId,f.operationId,'preview');
  f.store.cas=async(key,etag,value)=>{if(key===`projects/${f.projectId}/control`&&++controls===2)throw Error('POWER_LOSS');return cas(key,etag,value)};
  await expect(cancelProduction(f.store,f.projectId,f.operationId)).rejects.toThrow('POWER_LOSS');
  const cold=new ProjectStore(new FileStore(f.root));
  if(recovery==='retry')expect(await cancelProduction(cold.store,f.projectId,f.operationId)).toBe('cancelled');
  await runQueuedOnce(new LocalOperationQueue(cold.store,f.root),cold.store,async()=>{calls++});
  expect(calls).toBe(0);expect((await cold.access('owner',f.projectId)).unresolvedMediaStops).toEqual({});
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it.each(['outcome','operation','timeout'])('preview cold recovery retains unknown stop after power loss before %s persistence',async boundary=>{
 const f=await setup();let dead=false,calls=0;
 const store={create:f.store.create.bind(f.store),cas:f.store.cas.bind(f.store),readFresh:async<T>(key:string)=>{if(dead)throw Error('POWER_LOSS');return f.store.readFresh<T>(key)}};
 const build:typeof buildQuickFilm=async()=>{
  calls++;
  if(boundary==='operation'){const cas=f.store.cas.bind(f.store);f.store.cas=async(key,etag,value)=>{if(key===`projects/${f.projectId}/operations/${f.operationId}`){dead=true;throw Error('POWER_LOSS')}return cas(key,etag,value)}}
  if(boundary!=='timeout')await cancelProduction(f.store,f.projectId,f.operationId);dead=true;throw Error('MEDIA_STOP_UNKNOWN');
 };
 try{
  await expect(runQuickFilmOperation(store,f.events,f.projectId,f.operationId,{root:f.root,build})).rejects.toThrow('POWER_LOSS');
  const cold=new ProjectStore(new FileStore(f.root));
  if(boundary!=='timeout')expect((await cold.access('owner',f.projectId)).unresolvedMediaStops).toEqual({[f.operationId]:'preview'});
  await runQuickFilmOperation(cold.store,new LocalEventLog(f.root),f.projectId,f.operationId,{root:f.root,build});
  expect(calls).toBe(1);expect((await cold.operation(f.projectId,f.operationId))?.status).toBe('interrupted');
  expect((await cold.access('owner',f.projectId)).unresolvedMediaStops).toEqual({[f.operationId]:'preview'});
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('missing pinned media configuration rejects before model or production activity',async()=>{
 const f=await setup();try{
  let activity=0;
  await expect(buildQuickFilm(f.projects,{projectId:f.projectId,operationId:f.operationId,expectedConsentEpoch:0},{root:f.root,env:{}},async()=>{activity++})).rejects.toThrow('GENERATION_DISABLED');
  expect(activity).toBe(0);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('a real durable queue dispatches preview work and retains an unknown paid effect without retry',async()=>{
 const f=await setup();try{
  const queue=new LocalOperationQueue(f.store,f.root);await queue.enqueue(f.projectId,f.operationId,'preview');let calls=0;
  await runQueuedOnce(queue,f.store,job=>runQuickFilmOperation(f.store,f.events,job.projectId,job.operationId,{root:f.root,build:async()=>{calls++;throw Error('EFFECT_UNKNOWN')}}));
  await runQueuedOnce(queue,f.store,async()=>{calls++});
  expect(calls).toBe(1);expect(await queue.pending()).toEqual([]);
  expect((await f.projects.access('owner',f.projectId)).phase).toBe('attention');
  const last=(await f.events.readFrom(f.projectId,f.operationId,0)).at(-1)!.event;
  expect(last.type).toBe('operation.terminal');expect(last.payload).toMatchObject({status:'failed',errorCode:'EFFECT_UNKNOWN',retryable:false});
  const cold=new ProjectStore(new FileStore(f.root));
  expect((await cold.view('owner',f.projectId)).productionFailure).toMatchObject({operationId:f.operationId,errorCode:'EFFECT_UNKNOWN'});
  await updateJson(f.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:c.briefVersion+1}));
  expect((await cold.view('owner',f.projectId)).productionFailure).toBeUndefined();
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('cancellation during preview work prevents further production and persists terminal SSE',async()=>{
 const f=await setup();try{
  await runQuickFilmOperation(f.store,f.events,f.projectId,f.operationId,{root:f.root,build:async()=>{await cancelProduction(f.store,f.projectId,f.operationId);throw Error('PREVIEW_STALE')}});
  expect((await f.projects.access('owner',f.projectId)).phase).toBe('cancelled');
  expect((await f.store.readFresh<{status:string}>(`projects/${f.projectId}/operations/${f.operationId}`)).value.status).toBe('cancelled');
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('unknown physical stop remains interrupted after cancellation and cold recovery does not retry production',async()=>{
 const f=await setup();try{
  const queue=new LocalOperationQueue(f.store,f.root);await queue.enqueue(f.projectId,f.operationId,'preview');let calls=0;
  const build:typeof buildQuickFilm=async()=>{calls++;await cancelProduction(f.store,f.projectId,f.operationId);throw Error('MEDIA_STOP_UNKNOWN')};
  await runQueuedOnce(queue,f.store,job=>runQuickFilmOperation(f.store,f.events,job.projectId,job.operationId,{root:f.root,build}));
  const cold=new ProjectStore(new FileStore(f.root));
  expect((await cold.operation(f.projectId,f.operationId))?.status).toBe('interrupted');
  expect((await f.store.readFresh(`projects/${f.projectId}/operations/${f.operationId}/preview-outcome`)).value).toEqual({status:'interrupted',errorCode:'MEDIA_STOP_UNKNOWN'});
  expect((await cold.view('owner',f.projectId)).productionFailure).toMatchObject({operationId:f.operationId,errorCode:'MEDIA_STOP_UNKNOWN'});
  await runQueuedOnce(new LocalOperationQueue(cold.store,f.root),cold.store,job=>runQuickFilmOperation(cold.store,f.events,job.projectId,job.operationId,{root:f.root,build}));expect(calls).toBe(1);
  await expect(preparePreview(cold,queue,'owner',f.projectId,{schemaVersion:5,clientCommandId:randomUUID(),expectedBriefVersion:0})).rejects.toThrow('MEDIA_STOP_UNKNOWN');
  expect((await f.events.readFrom(f.projectId,f.operationId,0)).at(-1)?.event.payload).toMatchObject({status:'interrupted',errorCode:'MEDIA_STOP_UNKNOWN',retryable:false});
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it.each([false,true])('an unknown stop outcome survives terminal SSE acknowledgement loss (fsync=%s)',async afterWrite=>{
 const f=await setup();class LosingLog extends LocalEventLog{
  armed=true;async append(event:Parameters<LocalEventLog['append']>[0]){if(this.armed&&event.type==='operation.terminal'){this.armed=false;if(afterWrite)await super.append(event);throw Error('ACK_LOST')}return super.append(event)}
 }
 try{
  let calls=0;const options={root:f.root,build:async()=>{calls++;await cancelProduction(f.store,f.projectId,f.operationId);throw Error('MEDIA_STOP_UNKNOWN')}};
  await expect(runQuickFilmOperation(f.store,new LosingLog(f.root),f.projectId,f.operationId,options)).rejects.toThrow('ACK_LOST');
  await runQuickFilmOperation(new FileStore(f.root),f.events,f.projectId,f.operationId,options);expect(calls).toBe(1);
  const terminals=(await f.events.readFrom(f.projectId,f.operationId,0)).filter(({event})=>event.type==='operation.terminal');expect(terminals).toHaveLength(1);expect(terminals[0].event.payload).toMatchObject({status:'interrupted',errorCode:'MEDIA_STOP_UNKNOWN'});
  expect((await f.projects.access('owner',f.projectId)).unresolvedMediaStops).toEqual({[f.operationId]:'preview'});
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('an old unknown stop records its blocker without clearing a newer production lane',async()=>{
 const f=await setup();try{
  const newer=randomUUID();await runQuickFilmOperation(f.store,f.events,f.projectId,f.operationId,{root:f.root,build:async()=>{
   await updateJson(f.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,activeProduction:newer,consentEpoch:c.consentEpoch+1}));throw Error('MEDIA_STOP_UNKNOWN');
  }});
  const c=await f.projects.access('owner',f.projectId);expect(c.activeProduction).toBe(newer);expect(c.unresolvedMediaStops).toEqual({[f.operationId]:'preview'});expect(c.phase).toBe('generating');
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('a superseded preview worker leaves the new production lane untouched',async()=>{
 const f=await setup();try{
  const newer=randomUUID();
  await runQuickFilmOperation(f.store,f.events,f.projectId,f.operationId,{root:f.root,build:async()=>{
   await updateJson(f.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,activeProduction:newer,consentEpoch:c.consentEpoch+1}));throw Error('PREVIEW_STALE');
  }});
  expect((await f.projects.access('owner',f.projectId)).activeProduction).toBe(newer);
  expect((await f.store.readFresh<{status:string}>(`projects/${f.projectId}/operations/${f.operationId}`)).value.status).toBe('superseded');
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it.each([false,true])('a failed outcome survives a lost terminal acknowledgement (fsync=%s)',async(afterWrite)=>{
 const f=await setup();class LosingLog extends LocalEventLog{
  armed=true;
  async append(event:Parameters<LocalEventLog['append']>[0]){
   if(this.armed&&event.type==='operation.terminal'){this.armed=false;if(afterWrite)await super.append(event);throw Error('ACK_LOST')}
   return super.append(event);
  }
 }
 try{
  let calls=0;const options={root:f.root,build:async()=>{calls++;throw Error('EFFECT_UNKNOWN')}};
  await expect(runQuickFilmOperation(f.store,new LosingLog(f.root),f.projectId,f.operationId,options)).rejects.toThrow('ACK_LOST');
  await runQuickFilmOperation(new FileStore(f.root),f.events,f.projectId,f.operationId,options);
  const terminals=(await f.events.readFrom(f.projectId,f.operationId,0)).filter(({event})=>event.type==='operation.terminal');
  expect(terminals).toHaveLength(1);expect(terminals[0].event.payload).toMatchObject({status:'failed',errorCode:'EFFECT_UNKNOWN'});expect(calls).toBe(1);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('a cold queue rebuilds only the authorized active preview after enqueue was lost',async()=>{
 const f=await setup();try{
  let calls=0;const queue=new LocalOperationQueue(new FileStore(f.root),f.root);
  await runQueuedOnce(queue,f.store,job=>runQuickFilmOperation(f.store,f.events,job.projectId,job.operationId,{root:f.root,build:async()=>{calls++;throw Error('EFFECT_UNKNOWN')}}));
  expect(calls).toBe(1);expect(await queue.pending()).toEqual([]);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('one reconciliation failure does not prevent a healthy queued operation from running',async()=>{
 const f=await setup();try{
  const queue=new LocalOperationQueue(f.store,f.root),other='ffffffff-ffff-4fff-8fff-ffffffffffff';
  await queue.enqueue(f.projectId,f.operationId,'preview');await queue.enqueue(f.projectId,other,'chat');
  await f.store.create(`projects/${f.projectId}/operations/${other}`,{status:'reserved'});let healthy=0;
  await expect(runQueuedOnce(queue,f.store,async(job)=>{if(job.operationId===f.operationId)throw Error('ACK_LOST');healthy++;await updateJson(f.store,`projects/${f.projectId}/operations/${other}`,()=>({status:'succeeded'}))})).rejects.toThrow('ACK_LOST');
  expect(healthy).toBe(1);expect((await queue.pending()).map(j=>j.operationId)).toEqual([f.operationId]);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('a damaged queue record is reported while other queued operations continue',async()=>{
 const f=await setup();try{
  const queue=new LocalOperationQueue(f.store,f.root),other='ffffffff-ffff-4fff-8fff-ffffffffffff';
  await queue.enqueue(f.projectId,f.operationId,'preview');await queue.enqueue(f.projectId,other,'chat');
  await f.store.create(`projects/${f.projectId}/operations/${other}`,{status:'reserved'});
  await writeFile(f.store.path(queue.key(f.projectId,f.operationId)),'{broken JSON');let healthy=0;
  await expect(runQueuedOnce(queue,f.store,async()=>{healthy++;await updateJson(f.store,`projects/${f.projectId}/operations/${other}`,()=>({status:'succeeded'}))})).rejects.toBeDefined();
  expect(healthy).toBe(1);expect((await queue.pendingWithFailures()).failure?.message).toBe('QUEUE_RECORD_INVALID');
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it.each([
 ['VISUAL_SOURCE_INVALID','这个镜头没有画好，已画好的镜头都保留了，请重试。'],
 ['PICTURE_RENDER_FAILED','这个镜头没有生成成功，已画好的镜头都保留了，请重试。'],
 ['MODEL_OUTPUT_INVALID','脚本内容没有通过检查，资料和已有内容已保留，请重试。'],
])('persists %s as the real failure category without leaking native diagnostic details',async(code,message)=>{
 const f=await setup();try{
  let calls=0;const options={root:f.root,build:async()=>{calls++;throw Error(code+': /private/provider-secret diagnostics')}};
  await runQuickFilmOperation(f.store,f.events,f.projectId,f.operationId,options);
  const cold=new ProjectStore(new FileStore(f.root));
  expect((await cold.view('owner',f.projectId)).productionFailure).toMatchObject({errorCode:code,message});
  const events=(await f.events.readFrom(f.projectId,f.operationId,0)).map(({event})=>event);
  expect(events.at(-1)?.payload).toMatchObject({status:'failed',errorCode:code,retryable:false});expect(JSON.stringify(events)).not.toContain('provider-secret');
  await runQuickFilmOperation(cold.store,f.events,f.projectId,f.operationId,options);expect(calls).toBe(1);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
