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
import {runPreviewOperation} from '@/services/video/commands/local-preview';
import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {runQueuedOnce} from '@/services/video/commands/local-worker';
import {buildPreviewPipeline} from '@/services/video/preview/pipeline';
import {preparePreview} from '@/services/video/preview/prepare';
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'vb-preview-worker-')),store=new FileStore(root),projects=new ProjectStore(store);
 const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),operationId=randomUUID(),revisionId=randomUUID(),previewId=randomUUID();
 const c=await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,phase:'preparing_preview' as const,activeProduction:operationId}));
 await store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,kind:'preview',commandId:randomUUID(),status:'reserved',canonicalRunId:null,streamEpoch:0,fence:0,revisionId,previewId,briefVersion:c.briefVersion,consentEpoch:c.consentEpoch,understandingRef:c.understandingRef});
 return{root,store,projects,projectId,operationId,revisionId,previewId,events:new LocalEventLog(root)};
}
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
 const build:typeof buildPreviewPipeline=async()=>{
  calls++;
  if(boundary==='operation'){const cas=f.store.cas.bind(f.store);f.store.cas=async(key,etag,value)=>{if(key===`projects/${f.projectId}/operations/${f.operationId}`){dead=true;throw Error('POWER_LOSS')}return cas(key,etag,value)}}
  if(boundary!=='timeout')await cancelProduction(f.store,f.projectId,f.operationId);dead=true;throw Error('MEDIA_STOP_UNKNOWN');
 };
 try{
  await expect(runPreviewOperation(store,f.events,f.projectId,f.operationId,{root:f.root,build})).rejects.toThrow('POWER_LOSS');
  const cold=new ProjectStore(new FileStore(f.root));
  if(boundary!=='timeout')expect((await cold.access('owner',f.projectId)).unresolvedMediaStops).toEqual({[f.operationId]:'preview'});
  await runPreviewOperation(cold.store,new LocalEventLog(f.root),f.projectId,f.operationId,{root:f.root,build});
  expect(calls).toBe(1);expect((await cold.operation(f.projectId,f.operationId))?.status).toBe('interrupted');
  expect((await cold.access('owner',f.projectId)).unresolvedMediaStops).toEqual({[f.operationId]:'preview'});
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('missing pinned media configuration rejects before model or production activity',async()=>{
 const f=await setup();try{
  let activity=0;
  await expect(buildPreviewPipeline(f.projects,{projectId:f.projectId,operationId:f.operationId,revisionId:f.revisionId,previewId:f.previewId,expectedConsentEpoch:0},{root:f.root,env:{}},async()=>{activity++})).rejects.toThrow('CAPABILITY_UNAVAILABLE');
  expect(activity).toBe(0);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('a real durable queue dispatches preview work and retains an unknown paid effect without retry',async()=>{
 const f=await setup();try{
  const queue=new LocalOperationQueue(f.store,f.root);await queue.enqueue(f.projectId,f.operationId,'preview');let calls=0;
  await runQueuedOnce(queue,f.store,job=>runPreviewOperation(f.store,f.events,job.projectId,job.operationId,{root:f.root,build:async()=>{calls++;throw Error('EFFECT_UNKNOWN')}}));
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
  await runPreviewOperation(f.store,f.events,f.projectId,f.operationId,{root:f.root,build:async()=>{await cancelProduction(f.store,f.projectId,f.operationId);throw Error('PREVIEW_STALE')}});
  expect((await f.projects.access('owner',f.projectId)).phase).toBe('cancelled');
  expect((await f.store.readFresh<{status:string}>(`projects/${f.projectId}/operations/${f.operationId}`)).value.status).toBe('cancelled');
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('unknown physical stop remains interrupted after cancellation and cold recovery does not retry production',async()=>{
 const f=await setup();try{
  const queue=new LocalOperationQueue(f.store,f.root);await queue.enqueue(f.projectId,f.operationId,'preview');let calls=0;
  const build:typeof buildPreviewPipeline=async()=>{calls++;await cancelProduction(f.store,f.projectId,f.operationId);throw Error('MEDIA_STOP_UNKNOWN')};
  await runQueuedOnce(queue,f.store,job=>runPreviewOperation(f.store,f.events,job.projectId,job.operationId,{root:f.root,build}));
  const cold=new ProjectStore(new FileStore(f.root));
  expect((await cold.operation(f.projectId,f.operationId))?.status).toBe('interrupted');
  expect((await f.store.readFresh(`projects/${f.projectId}/operations/${f.operationId}/preview-outcome`)).value).toEqual({status:'interrupted',errorCode:'MEDIA_STOP_UNKNOWN'});
  expect((await cold.view('owner',f.projectId)).productionFailure).toMatchObject({operationId:f.operationId,errorCode:'MEDIA_STOP_UNKNOWN'});
  await runQueuedOnce(new LocalOperationQueue(cold.store,f.root),cold.store,async()=>{calls++});expect(calls).toBe(1);
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
  await expect(runPreviewOperation(f.store,new LosingLog(f.root),f.projectId,f.operationId,options)).rejects.toThrow('ACK_LOST');
  await runPreviewOperation(new FileStore(f.root),f.events,f.projectId,f.operationId,options);expect(calls).toBe(1);
  const terminals=(await f.events.readFrom(f.projectId,f.operationId,0)).filter(({event})=>event.type==='operation.terminal');expect(terminals).toHaveLength(1);expect(terminals[0].event.payload).toMatchObject({status:'interrupted',errorCode:'MEDIA_STOP_UNKNOWN'});
  expect((await f.projects.access('owner',f.projectId)).unresolvedMediaStops).toEqual({[f.operationId]:'preview'});
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('an old unknown stop records its blocker without clearing a newer production lane',async()=>{
 const f=await setup();try{
  const newer=randomUUID();await runPreviewOperation(f.store,f.events,f.projectId,f.operationId,{root:f.root,build:async()=>{
   await updateJson(f.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,activeProduction:newer,consentEpoch:c.consentEpoch+1}));throw Error('MEDIA_STOP_UNKNOWN');
  }});
  const c=await f.projects.access('owner',f.projectId);expect(c.activeProduction).toBe(newer);expect(c.unresolvedMediaStops).toEqual({[f.operationId]:'preview'});expect(c.phase).toBe('preparing_preview');
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('a superseded preview worker leaves the new production lane untouched',async()=>{
 const f=await setup();try{
  const newer=randomUUID();
  await runPreviewOperation(f.store,f.events,f.projectId,f.operationId,{root:f.root,build:async()=>{
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
  await expect(runPreviewOperation(f.store,new LosingLog(f.root),f.projectId,f.operationId,options)).rejects.toThrow('ACK_LOST');
  await runPreviewOperation(new FileStore(f.root),f.events,f.projectId,f.operationId,options);
  const terminals=(await f.events.readFrom(f.projectId,f.operationId,0)).filter(({event})=>event.type==='operation.terminal');
  expect(terminals).toHaveLength(1);expect(terminals[0].event.payload).toMatchObject({status:'failed',errorCode:'EFFECT_UNKNOWN'});expect(calls).toBe(1);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('a cold queue rebuilds only the authorized active preview after enqueue was lost',async()=>{
 const f=await setup();try{
  let calls=0;const queue=new LocalOperationQueue(new FileStore(f.root),f.root);
  await runQueuedOnce(queue,f.store,job=>runPreviewOperation(f.store,f.events,job.projectId,job.operationId,{root:f.root,build:async()=>{calls++;throw Error('EFFECT_UNKNOWN')}}));
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
