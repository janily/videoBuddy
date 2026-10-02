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
