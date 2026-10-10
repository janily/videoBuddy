import{afterEach,beforeEach,expect,it}from'vitest';import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{FileStore}from'@/services/video/storage/file-store';import{LocalOperationQueue}from'@/services/video/commands/local-queue';
let dir:string;beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'vb-queue-'))});afterEach(async()=>{await rm(dir,{recursive:true,force:true})});
const projectId='10000000-0000-4000-8000-000000000001',operationId='20000000-0000-4000-8000-000000000002';
it('a cold process discovers the same durable operation once after enqueue',async()=>{
 const store=new FileStore(dir);const queue=new LocalOperationQueue(store,dir);await queue.enqueue(projectId,operationId,'chat');await queue.enqueue(projectId,operationId,'chat');
 expect(await new LocalOperationQueue(new FileStore(dir),dir).pending()).toEqual([{projectId,operationId,kind:'chat'}]);
 await queue.complete(projectId,operationId);expect(await new LocalOperationQueue(store,dir).pending()).toEqual([]);
});
it('a queue intent with reused ID and changed kind is rejected',async()=>{
 const queue=new LocalOperationQueue(new FileStore(dir),dir);await queue.enqueue(projectId,operationId,'chat');await expect(queue.enqueue(projectId,operationId,'render')).rejects.toThrow('IDEMPOTENCY_CONFLICT');
});
it('generation refuses a stale or missing worker heartbeat',async()=>{
 const {assertWorkerReady,writeWorkerHeartbeat}=await import('@/services/video/commands/worker-heartbeat');
 await expect(assertWorkerReady(dir)).rejects.toThrow('WORKER_UNAVAILABLE');
 await writeWorkerHeartbeat(dir);await expect(assertWorkerReady(dir)).resolves.toBeUndefined();
 const {utimes}=await import('node:fs/promises');const old=new Date(Date.now()-60000);await utimes(join(dir,'worker-heartbeat'),old,old);
 await expect(assertWorkerReady(dir)).rejects.toThrow('WORKER_UNAVAILABLE');
});
it('worker scan processes queued work and does not reprocess terminal work after restart',async()=>{
 const {runQueuedOnce}=await import('@/services/video/commands/local-worker');
 const store=new FileStore(dir),queue=new LocalOperationQueue(store,dir);await store.create(`projects/${projectId}/operations/${operationId}`,{status:'reserved'});
 await queue.enqueue(projectId,operationId,'chat');let calls=0;
 await runQueuedOnce(queue,store,async()=>{calls++;const current=await store.readFresh<{status:string}>(`projects/${projectId}/operations/${operationId}`);await store.cas(`projects/${projectId}/operations/${operationId}`,current.etag,{status:'succeeded'})});
 await runQueuedOnce(new LocalOperationQueue(new FileStore(dir),dir),store,async()=>{calls++});
 expect(calls).toBe(1);expect(await queue.pending()).toEqual([]);
});
it('upload maintenance skips budget-only historical diagnostics without changing their accounting',async()=>{
 const {expirePendingUploads}=await import('@/services/video/commands/local-worker');
 const root=dir,store=new FileStore(root),record={calls:1,inputTokens:100,outputTokens:50,reservations:{}};
 await store.create(`projects/${projectId}/budget`,record);await expect(expirePendingUploads(root,store)).resolves.toBeUndefined();expect((await store.readFresh(`projects/${projectId}/budget`)).value).toEqual(record);
});

it('admits saved chat after the quick model phase and blocks new media until that chat finishes',async()=>{
 const {createWorkerLanes,runQueuedOnce,quickProductionAllowsChat}=await import('@/services/video/commands/local-worker');
 const store=new FileStore(dir),queue=new LocalOperationQueue(store,dir),chatId='30000000-0000-4000-8000-000000000003',nextFilmId='40000000-0000-4000-8000-000000000004';
 for(const id of [operationId,chatId,nextFilmId])await store.create(`projects/${projectId}/operations/${id}`,{id,projectId,kind:id===chatId?'chat':'preview',status:'running',stage:'visual'});
 let releaseFilm!:()=>void,releaseChat!:()=>void;
 const filmGate=new Promise<void>(resolve=>{releaseFilm=resolve}),chatGate=new Promise<void>(resolve=>{releaseChat=resolve}),calls:string[]=[];
 const lanes=createWorkerLanes(async job=>{
  calls.push(job.operationId);if(job.operationId===operationId)await filmGate;if(job.operationId===chatId)await chatGate;
  const key=`projects/${projectId}/operations/${job.operationId}`,current=await store.readFresh(key);await store.cas(key,current.etag,{status:'succeeded'});
 },error=>{throw error},{canRunChatAlongside:job=>quickProductionAllowsChat(store,job,{VIDEO_FLOW:'quick'})});
 await queue.enqueue(projectId,operationId,'preview');
 await runQueuedOnce(queue,store,job=>lanes.dispatch(job));expect(calls).toEqual([operationId]);
 await queue.enqueue(projectId,chatId,'chat');await queue.enqueue(projectId,nextFilmId,'preview');
 await runQueuedOnce(queue,store,job=>lanes.dispatch(job));expect(calls).toEqual([operationId]);
 const key=`projects/${projectId}/operations/${operationId}`,current=await store.readFresh<Record<string,unknown>>(key);
 await store.cas(key,current.etag,{...current.value,stage:'picture'});
 expect(await quickProductionAllowsChat(store,{projectId,operationId,kind:'preview'},{VIDEO_FLOW:'staged'})).toBe(false);
 await runQueuedOnce(queue,store,job=>lanes.dispatch(job));expect(calls).toEqual([operationId,chatId]);
 releaseFilm();await runQueuedOnce(queue,store,job=>lanes.dispatch(job));await runQueuedOnce(queue,store,job=>lanes.dispatch(job));
 expect(calls).toEqual([operationId,chatId]);
 releaseChat();await lanes.drain();await runQueuedOnce(queue,store,job=>lanes.dispatch(job));await lanes.drain();
 expect(calls).toEqual([operationId,chatId,nextFilmId]);
});

it('serializes by default and admits at most one model-using chat even across projects',async()=>{
 const {createWorkerLanes}=await import('@/services/video/commands/local-worker');
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve}),calls:string[]=[];
 const execute=async(job:{operationId:string})=>{calls.push(job.operationId);await gate};
 const conservative=createWorkerLanes(execute,error=>{throw error});
 await conservative.dispatch({projectId,operationId:'film',kind:'preview'});
 await conservative.dispatch({projectId,operationId:'chat',kind:'chat'});expect(calls).toEqual(['film']);
 release();await conservative.drain();
 let releaseConcurrent!:()=>void;const concurrentGate=new Promise<void>(resolve=>{releaseConcurrent=resolve}),concurrentCalls:string[]=[];
 const lanes=createWorkerLanes(async job=>{concurrentCalls.push(job.operationId);await concurrentGate},error=>{throw error},{canRunChatAlongside:async()=>true});
 await lanes.dispatch({projectId,operationId:'film',kind:'preview'});
 await Promise.all([lanes.dispatch({projectId,operationId:'chat-1',kind:'chat'}),lanes.dispatch({projectId:'another',operationId:'chat-2',kind:'chat'})]);
 expect(concurrentCalls).toEqual(['film','chat-1']);releaseConcurrent();await lanes.drain();
});
