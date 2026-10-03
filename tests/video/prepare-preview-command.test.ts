import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {preparePreview} from '@/services/video/preview/prepare';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {updateJson} from '@/services/video/storage/atomic-store';
import {initialUnderstanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';

async function fixture(root:string){
 const projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),understanding={...initialUnderstanding(),briefVersion:1,subject:'社区图书交换日',preferences:{...initialUnderstanding().preferences,styleSlug:'crayon-book',voiceMode:'none' as const}};
 const understandingRef=await projects.index.immutable('projects/'+projectId+'/understanding/1',understanding);
 await updateJson(projects.store,'projects/'+projectId+'/control',(c:ProjectControl)=>({...c,briefVersion:1,understandingRef}));
 return{projects,projectId,queue:new LocalOperationQueue(projects.store,root),request:{schemaVersion:5 as const,clientCommandId:randomUUID(),expectedBriefVersion:1}};
}
it('authorizes a preview once, freezes its baseline and IDs, and replays a queued command without a render approval',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-preview-command-'));try{
  const {projects,queue,projectId,request}=await fixture(root),first=await preparePreview(projects,queue,'owner',projectId,request),again=await preparePreview(projects,queue,'owner',projectId,request);
  expect(first.status).toBe('accepted');expect(again).toMatchObject({operationId:first.operationId,status:'replayed'});expect(await queue.pending()).toEqual([{projectId,operationId:first.operationId,kind:'preview'}]);
  const control=(await projects.store.readFresh<ProjectControl>('projects/'+projectId+'/control')).value;
  expect(control).toMatchObject({phase:'preparing_preview',activeProduction:first.operationId,briefVersion:1});expect(control.currentApprovalId).toBeUndefined();
  expect((await projects.store.readFresh('projects/'+projectId+'/operations/'+first.operationId)).value).toMatchObject({kind:'preview',briefVersion:1,consentEpoch:0,understandingRef:control.understandingRef,revisionId:expect.any(String),previewId:expect.any(String)});
  await expect(preparePreview(projects,queue,'owner',projectId,{...request,expectedBriefVersion:2})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('retries only durable queue dispatch after a dispatch failure and never creates another production intent',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-preview-dispatch-'));try{
  const {projects,queue,projectId,request}=await fixture(root),enqueue=queue.enqueue.bind(queue);let failed=true;
  queue.enqueue=async(...args)=>{if(failed)throw Error('QUEUE_IO_FAILED');return enqueue(...args)};
  await expect(preparePreview(projects,queue,'owner',projectId,request)).rejects.toThrow('START_FAILED');
  const control=(await projects.store.readFresh<ProjectControl>('projects/'+projectId+'/control')).value;failed=false;
  expect(await preparePreview(projects,queue,'owner',projectId,request)).toMatchObject({operationId:control.activeProduction,status:'replayed'});expect(await queue.pending()).toHaveLength(1);
 }finally{await rm(root,{recursive:true,force:true})}
});
it.each(['wrong_owner','brief_changed','input_pending','chat_running','production_running'] as const)('rejects %s before creating queued work',async cause=>{
 const root=await mkdtemp(join(tmpdir(),'vb-preview-denied-'));try{
  const {projects,queue,projectId,request}=await fixture(root);
  await updateJson(projects.store,'projects/'+projectId+'/control',(c:ProjectControl)=>({...c,...(cause==='input_pending'?{inputPending:true}:cause==='chat_running'?{activeConversation:randomUUID()}:cause==='production_running'?{activeProduction:randomUUID()}:cause==='brief_changed'?{briefVersion:2}:{})}));
  await expect(preparePreview(projects,queue,cause==='wrong_owner'?'stranger':'owner',projectId,request)).rejects.toThrow();expect(await queue.pending()).toHaveLength(0);
 }finally{await rm(root,{recursive:true,force:true})}
});
it('a concurrent duplicate can finish after the worker has already claimed the same operation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-preview-race-'));try{
  const {projects,queue,projectId,request}=await fixture(root),read=projects.store.readFresh.bind(projects.store);let controls=0,armed=true,originalOperation='';
  projects.store.readFresh=async<T>(key:string)=>{
   const snapshot=await read<T>(key);
   if(armed&&key==='projects/'+projectId+'/control'&&++controls===2){
    armed=false;const original=await preparePreview(projects,queue,'owner',projectId,request);originalOperation=original.operationId;
    await updateJson(projects.store,'projects/'+projectId+'/operations/'+originalOperation,(operation:Record<string,unknown>)=>({...operation,status:'running',canonicalRunId:originalOperation}));
   }
   return snapshot;
  };
  const duplicate=await preparePreview(projects,queue,'owner',projectId,request);expect(duplicate.operationId).toBe(originalOperation);expect(await queue.pending()).toHaveLength(1);
 }finally{await rm(root,{recursive:true,force:true})}
});
