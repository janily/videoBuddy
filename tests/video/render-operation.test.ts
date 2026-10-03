import {expect,it} from 'vitest';
import {rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {seedApprovedProject} from './fixtures/approved-project';
import {LocalEventLog} from '@/services/video/stream/local-event-log';
import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {runQueuedOnce} from '@/services/video/commands/local-worker';
import {runApprovedRenderOperation} from '@/services/video/commands/local-render';
import {cancelProduction} from '@/services/video/commands/cancel';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import {renderApproved} from '@/services/video/render/pipeline';
import {mandatoryDeliveryRules} from '@/services/video/quality/delivery';
import {getArtifactAccess} from '@/services/video/exports/access';
import {preparePreview} from '@/services/video/preview/prepare';
import {runPreviewOperation} from '@/services/video/commands/local-preview';
import {approvePreview} from '@/services/video/preview/approve';
import {spawn} from 'node:child_process';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';

it.each(['outcome','operation','timeout'])('cold cancellation retains unknown physical stop after power loss before %s persistence',async boundary=>{
 const f=await seedApprovedProject();let dead=false,calls=0;
 const original=f.projects.store;
 const store={create:original.create.bind(original),cas:original.cas.bind(original),readFresh:async<T>(key:string)=>{if(dead)throw Error('POWER_LOSS');return original.readFresh<T>(key)}};
 const build:typeof renderApproved=async()=>{
  calls++;
  if(boundary==='operation'){const cas=original.cas.bind(original);original.cas=async(key,etag,value)=>{if(key===`projects/${f.projectId}/operations/${f.operationId}`){dead=true;throw Error('POWER_LOSS')}return cas(key,etag,value)}}
  if(boundary!=='timeout')await cancelProduction(original,f.projectId,f.operationId);dead=true;throw Error('MEDIA_STOP_UNKNOWN');
 };
 try{
  await expect(runApprovedRenderOperation(store,new LocalEventLog(f.root),f.projectId,f.operationId,{root:f.root,env:f.env,build})).rejects.toThrow('POWER_LOSS');
  const cold=new ProjectStore(new FileStore(f.root));
  if(boundary!=='timeout')expect((await cold.access('owner',f.projectId)).unresolvedMediaStops).toEqual({[f.operationId]:'render'});
  await runApprovedRenderOperation(cold.store,new LocalEventLog(f.root),f.projectId,f.operationId,{root:f.root,env:f.env,build});
  expect(calls).toBe(1);expect((await cold.operation(f.projectId,f.operationId))?.status).toBe('interrupted');
  expect((await cold.access('owner',f.projectId)).unresolvedMediaStops).toEqual({[f.operationId]:'render'});
 }finally{await rm(f.root,{recursive:true,force:true})}
});

async function protocolDelivery(f:Awaited<ReturnType<typeof seedApprovedProject>>,targets:Parameters<typeof renderApproved>[5]){
 // Synthetic QA/non-video bytes verify lifecycle, never real media quality.
 const bytes=Buffer.alloc(2048,3),sha256=createHash('sha256').update(bytes).digest('hex'),outputPath=join(f.root,'composition','9'.repeat(64),'output','final.mp4');
 await mkdir(join(f.root,'composition','9'.repeat(64),'output'),{recursive:true});await writeFile(outputPath,bytes);
 return{outputPath,result:{...targets,revisionId:f.bundle.revisionId,previewId:f.bundle.previewId,approvalId:f.approval.approvalId,bundleHash:f.bundle.bundleHash,mp4Sha256:sha256,mp4Bytes:bytes.length,qualityPolicy:{schemaVersion:1 as const,audioIntent:'silent' as const,captions:false,requiredRules:[...mandatoryDeliveryRules]},qualityChecks:[...mandatoryDeliveryRules,'decoded_silence'].map(ruleId=>({ruleId,result:'pass' as const,severity:'blocking' as const,evidenceRefs:['synthetic-protocol-QA-not-real-video']}))}};
}

it('T12 successful qualified protocol result publishes once and cold finalization does not rerender',async()=>{
 const f=await seedApprovedProject(),events=new LocalEventLog(f.root);let builds=0;
 try{
  const build:typeof renderApproved=async(_p,_o,_id,_op,_fence,targets)=>{builds++;return protocolDelivery(f,targets)};
  await runApprovedRenderOperation(f.projects.store,events,f.projectId,f.operationId,{root:f.root,env:f.env,build});
  await runApprovedRenderOperation(f.projects.store,new LocalEventLog(f.root),f.projectId,f.operationId,{root:f.root,env:f.env,build});
  expect(builds).toBe(1);expect((await f.projects.access('owner',f.projectId)).phase).toBe('ready');
  const log=await events.readFrom(f.projectId,f.operationId,0);expect(log.filter(({event})=>event.type==='result.ready')).toHaveLength(1);expect(log.filter(({event})=>event.type==='operation.terminal')).toHaveLength(1);
  expect((await f.projects.operation(f.projectId,f.operationId))?.status).toBe('succeeded');
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('T12 publication ACK loss then tombstone repairs success without rebuilding objects or opening download',async()=>{
 const f=await seedApprovedProject(),events=new LocalEventLog(f.root),original=f.projects.store.cas.bind(f.projects.store);let lost=false,builds=0;
 try{
  f.projects.store.cas=async(key,etag,value)=>{await original(key,etag,value);if(key===`projects/${f.projectId}/control`&&(value as ProjectControl).phase==='ready'&&!lost){lost=true;throw Error('PUBLICATION_ACK_LOST')}};
  const build:typeof renderApproved=async(_p,_o,_id,_op,_fence,targets)=>{builds++;return protocolDelivery(f,targets)};
  await expect(runApprovedRenderOperation(f.projects.store,events,f.projectId,f.operationId,{root:f.root,env:f.env,build})).rejects.toThrow('PUBLICATION_ACK_LOST');
  const c=await f.projects.access('owner',f.projectId),outcome=c.renderOutcomes![f.operationId],manifest=(await f.projects.store.readFresh<{artifactId:string}>(`projects/${f.projectId}/results/${outcome.resultId}/manifest`)).value;
  await f.projects.tombstone('owner',f.projectId);await rm(join(f.root,'objects'),{recursive:true,force:true});
  const queue=new LocalOperationQueue(f.projects.store,f.root);await runQueuedOnce(queue,f.projects.store,job=>runApprovedRenderOperation(f.projects.store,events,job.projectId,job.operationId,{root:f.root,env:f.env,build}));
  expect(builds).toBe(1);expect(await queue.pending()).toEqual([]);expect((await f.projects.operation(f.projectId,f.operationId))?.status).toBe('succeeded');
  await expect(getArtifactAccess(f.projects,'owner',f.projectId,manifest.artifactId,'download')).rejects.toThrow('ACCESS_NOT_FOUND');
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('T12 control failure ACK loss resumes the fixed outcome with zero additional builds',async()=>{
 const f=await seedApprovedProject(),events=new LocalEventLog(f.root),original=f.projects.store.cas.bind(f.projects.store);let lost=false,builds=0;
 try{
  f.projects.store.cas=async(key,etag,value)=>{await original(key,etag,value);if(key===`projects/${f.projectId}/control`&&(value as ProjectControl).phase==='attention'&&!lost){lost=true;throw Error('FAILURE_ACK_LOST')}};
  const build:typeof renderApproved=async()=>{builds++;throw Error('MODEL_ACCOUNTING_MIGRATION_REQUIRED')};
  await expect(runApprovedRenderOperation(f.projects.store,events,f.projectId,f.operationId,{root:f.root,env:f.env,build})).rejects.toThrow('FAILURE_ACK_LOST');
  const queue=new LocalOperationQueue(f.projects.store,f.root);await runQueuedOnce(queue,f.projects.store,job=>runApprovedRenderOperation(f.projects.store,events,job.projectId,job.operationId,{root:f.root,env:f.env,build}));
  expect(builds).toBe(1);expect(await queue.pending()).toEqual([]);expect((await f.projects.operation(f.projectId,f.operationId))?.status).toBe('failed');
  expect((await events.readFrom(f.projectId,f.operationId,0)).filter(({event})=>event.type==='operation.terminal')).toHaveLength(1);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('T12 cancellation during media completion prevents copying or publishing a late result',async()=>{
 const f=await seedApprovedProject(),events=new LocalEventLog(f.root);
 try{
  const build:typeof renderApproved=async(_p,_o,_id,_op,_fence,targets)=>{const delivered=await protocolDelivery(f,targets);await cancelProduction(f.projects.store,f.projectId,f.operationId);return delivered};
  await runApprovedRenderOperation(f.projects.store,events,f.projectId,f.operationId,{root:f.root,env:f.env,build});
  expect((await f.projects.operation(f.projectId,f.operationId))?.status).toBe('cancelled');expect((await f.projects.access('owner',f.projectId)).currentResultId).toBeUndefined();
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('T12 an unknown container stop is never reported as successful cancellation or silently retried',async()=>{
 const f=await seedApprovedProject(),events=new LocalEventLog(f.root);let builds=0;
 try{
  const build:typeof renderApproved=async()=>{builds++;await cancelProduction(f.projects.store,f.projectId,f.operationId);throw Error('MEDIA_STOP_UNKNOWN')};
  await runApprovedRenderOperation(f.projects.store,events,f.projectId,f.operationId,{root:f.root,env:f.env,build});
  const outcome=(await f.projects.store.readFresh(`projects/${f.projectId}/operations/${f.operationId}/render-outcome`)).value;
  expect(outcome).toEqual({status:'interrupted',errorCode:'MEDIA_STOP_UNKNOWN'});
  expect((await f.projects.view('owner',f.projectId)).productionFailure).toMatchObject({operationId:f.operationId,errorCode:'MEDIA_STOP_UNKNOWN'});
  await runApprovedRenderOperation(f.projects.store,new LocalEventLog(f.root),f.projectId,f.operationId,{root:f.root,env:f.env,build});expect(builds).toBe(1);
  expect((await events.readFrom(f.projectId,f.operationId,0)).filter(({event})=>event.type==='operation.terminal')).toHaveLength(1);
  expect((await f.projects.access('owner',f.projectId)).currentResultId).toBeUndefined();
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('T12 a retained unknown physical stop blocks approval even after the logical preview state changes',async()=>{
 const f=await seedApprovedProject(),events=new LocalEventLog(f.root);
 try{
  await runApprovedRenderOperation(f.projects.store,events,f.projectId,f.operationId,{root:f.root,env:f.env,build:async()=>{await cancelProduction(f.projects.store,f.projectId,f.operationId);throw Error('MEDIA_STOP_UNKNOWN')}});
  await updateJson(f.projects.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,phase:'preview_ready' as const,previewState:'ready' as const}));
  const queue=new LocalOperationQueue(f.projects.store,f.root),b=f.bundle;
  await expect(approvePreview(f.projects,queue,'owner',f.projectId,{schemaVersion:5,clientCommandId:randomUUID(),previewId:b.previewId,revisionId:b.revisionId,bundleHash:b.bundleHash,scriptHash:b.scriptHash,factsHash:b.factsHash,expectedBriefVersion:b.briefVersion})).rejects.toThrow('MEDIA_STOP_UNKNOWN');expect(await queue.pending()).toEqual([]);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('T12 cold queue never dispatches an orphan render reservation before approval is committed',async()=>{
 const f=await seedApprovedProject(),queue=new LocalOperationQueue(f.projects.store,f.root);
 try{
  await updateJson(f.projects.store,`projects/${f.projectId}/operations/${f.operationId}`,(op:object)=>({...op,status:'reserved',canonicalRunId:null}));
  await updateJson(f.projects.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,phase:'preview_ready' as const,activeProduction:null}));
  await queue.reconcileRenders();expect(await queue.pending()).toEqual([]);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('T12 the latest preview failure after a render failure is shown instead of a stale render error',async()=>{
 const f=await seedApprovedProject(),events=new LocalEventLog(f.root);
 try{
  await runApprovedRenderOperation(f.projects.store,events,f.projectId,f.operationId,{root:f.root,env:f.env,build:async()=>{throw Error('QUALITY_BLOCKED')}});
  const c=await f.projects.access('owner',f.projectId),next=await preparePreview(f.projects,new LocalOperationQueue(f.projects.store,f.root),'owner',f.projectId,{schemaVersion:5,clientCommandId:randomUUID(),expectedBriefVersion:c.briefVersion});
  await runPreviewOperation(f.projects.store,events,f.projectId,next.operationId,{root:f.root,env:f.env,build:async()=>{throw Error('PREVIEW_QUALITY_BLOCKED')}});
  expect((await f.projects.view('owner',f.projectId)).productionFailure).toMatchObject({operationId:next.operationId,errorCode:'PREVIEW_QUALITY_BLOCKED'});
 }finally{await rm(f.root,{recursive:true,force:true})}
});

it('T12 worker consumes render tasks, archives quality failure and keeps preview and old result',async()=>{
 const f=await seedApprovedProject(),queue=new LocalOperationQueue(f.projects.store,f.root),events=new LocalEventLog(f.root),old=randomUUID();
 try{
  await updateJson(f.projects.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,currentResultId:old}));
  await queue.enqueue(f.projectId,f.operationId,'render');let builds=0;
  await runQueuedOnce(queue,f.projects.store,job=>runApprovedRenderOperation(f.projects.store,events,job.projectId,job.operationId,{root:f.root,env:f.env,build:async()=>{builds++;throw Error('QUALITY_BLOCKED')}}));
  expect(builds).toBe(1);expect(await queue.pending()).toEqual([]);
  expect((await f.projects.store.readFresh(`projects/${f.projectId}/operations/${f.operationId}/render-outcome`)).value).toEqual({status:'failed',errorCode:'QUALITY_BLOCKED'});
  const c=await f.projects.access('owner',f.projectId);expect(c.phase).toBe('attention');expect(c.activeProduction).toBeNull();expect(c.currentResultId).toBe(old);expect(c.currentPreviewId).toBe(f.bundle.previewId);
  expect((await events.readFrom(f.projectId,f.operationId,0)).filter(({event})=>event.type==='operation.terminal')).toHaveLength(1);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('T12 a committed approval with lost enqueue keeps the same receipt and is discovered cold',async()=>{
 const f=await seedApprovedProject();
 try{
  await updateJson(f.projects.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,phase:'preview_ready' as const,activeProduction:null}));
  const input={schemaVersion:5 as const,clientCommandId:randomUUID(),previewId:f.bundle.previewId,revisionId:f.bundle.revisionId,expectedBriefVersion:f.bundle.briefVersion,bundleHash:f.bundle.bundleHash,scriptHash:f.bundle.scriptHash,factsHash:f.bundle.factsHash},queue=new LocalOperationQueue(f.projects.store,f.root);
  await expect(approvePreview(f.projects,{enqueue:async()=>{throw Error('LOST_ENQUEUE')}} as unknown as LocalOperationQueue,'owner',f.projectId,input)).rejects.toThrow('START_FAILED');
  const c=await f.projects.access('owner',f.projectId);await queue.reconcileRenders();expect((await queue.pending()).map(job=>job.operationId)).toEqual([c.activeProduction]);
  const retry=await approvePreview(f.projects,queue,'owner',f.projectId,input);expect(retry.operationId).toBe(c.activeProduction);expect(retry.status).toBe('replayed');
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('T12 authenticated approve HTTP returns one render operation and rejects changed hashes or another session',async()=>{
 const f=await seedApprovedProject(),{issueSession,ownerHash,verifySession}=await import('@/services/video/access/session'),{budgetKeys}=await import('@/services/video/config/environment'),{writeWorkerHeartbeat}=await import('@/services/video/commands/worker-heartbeat');
 const keys={current:'s'.repeat(64),environment:'local',keyId:'v1'},session=issueSession(keys),foreign=issueSession(keys),owner=ownerHash(verifySession(session.token,keys).sid,keys),names=['VIDEO_SESSION_SIGNING_KEY','VIDEO_ENVIRONMENT','VIDEO_DATA_DIR','VIDEO_APP_ORIGIN','VIDEO_GENERATION_ENABLED','MODEL_API_KEY','VIDEO_DIRECTOR_MODEL',...budgetKeys],old=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 try{
  Object.assign(process.env,{VIDEO_SESSION_SIGNING_KEY:keys.current,VIDEO_ENVIRONMENT:'local',VIDEO_DATA_DIR:f.root,VIDEO_APP_ORIGIN:'https://video.test',VIDEO_GENERATION_ENABLED:'true',MODEL_API_KEY:'test-protocol-only-never-requested',VIDEO_DIRECTOR_MODEL:'test-protocol-only'});for(const name of budgetKeys)process.env[name]='1000000';await writeWorkerHeartbeat(f.root);
  await updateJson(f.projects.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,ownerKeyHash:owner,phase:'preview_ready' as const,activeProduction:null}));
  const {POST}=await import('@/app/api/video/projects/[projectId]/preview/approve/route'),input={schemaVersion:5,clientCommandId:randomUUID(),previewId:f.bundle.previewId,revisionId:f.bundle.revisionId,expectedBriefVersion:f.bundle.briefVersion,bundleHash:f.bundle.bundleHash,scriptHash:f.bundle.scriptHash,factsHash:f.bundle.factsHash};
  const send=(token:string,body:unknown=input)=>POST(new Request('https://video.test/api/video/projects/'+f.projectId+'/preview/approve',{method:'POST',headers:{origin:'https://video.test',cookie:`vb-session=${token}`,'content-type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({projectId:f.projectId})});
  expect((await send(foreign.token)).status).toBe(404);
  const response=await send(session.token);expect(response.status).toBe(202);const receipt=await response.json();expect(receipt.status).toBe('accepted');
  const replay=await send(session.token);expect(replay.status).toBe(202);expect((await replay.json()).operationId).toBe(receipt.operationId);
  expect((await send(session.token,{...input,bundleHash:'9'.repeat(64)})).status).toBe(409);
  const queue=new LocalOperationQueue(f.projects.store,f.root);expect(await queue.pending()).toEqual([{projectId:f.projectId,operationId:receipt.operationId,kind:'render'}]);
 }finally{for(const[name,value]of Object.entries(old))if(value===undefined)delete process.env[name];else process.env[name]=value;await rm(f.root,{recursive:true,force:true})}
});
it('T12 preclaim cancellation and cold recovery settle without rendering and restore one terminal SSE',async()=>{
 const f=await seedApprovedProject(),queue=new LocalOperationQueue(f.projects.store,f.root),events=new LocalEventLog(f.root);
 try{
  await updateJson(f.projects.store,`projects/${f.projectId}/operations/${f.operationId}`,(op:object)=>({...op,status:'reserved',canonicalRunId:null}));
  expect(await cancelProduction(f.projects.store,f.projectId,f.operationId)).toBe('cancelled');
  await runQueuedOnce(queue,f.projects.store,job=>runApprovedRenderOperation(f.projects.store,events,job.projectId,job.operationId,{root:f.root,env:f.env,build:async()=>{throw Error('MUST_NOT_BUILD')}}));
  expect((await f.projects.store.readFresh(`projects/${f.projectId}/operations/${f.operationId}/render-outcome`)).value).toEqual({status:'cancelled'});
  expect((await events.readFrom(f.projectId,f.operationId,0)).filter(({event})=>event.type==='operation.terminal')).toHaveLength(1);expect(await queue.pending()).toEqual([]);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('T12 the real cold worker discovers render approval and fails closed before media/model work when generation is disabled',async()=>{
 const f=await seedApprovedProject(),worker=spawn(process.execPath,['--import','tsx','scripts/video/worker.ts'],{cwd:process.cwd(),env:{NODE_ENV:'test',PATH:process.env.PATH,VIDEO_DATA_DIR:f.root,VIDEO_GENERATION_ENABLED:'false',...f.env},stdio:['ignore','ignore','pipe']});
 let errors='';worker.stderr.on('data',(part:Buffer)=>{errors+=part.toString()});const exited=new Promise<number|null>((resolve,reject)=>{worker.once('error',reject);worker.once('close',resolve)});
 try{
  let failed=false;
  for(let i=0;i<100;i++){const op=await f.projects.operation(f.projectId,f.operationId);if(op?.status==='failed'){failed=true;break}if(worker.exitCode!==null)throw Error(errors||'WORKER_FAILED');await new Promise(resolve=>setTimeout(resolve,100))}
  expect(failed,errors).toBe(true);expect(Number.isFinite(Date.parse(await readFile(join(f.root,'worker-heartbeat'),'utf8')))).toBe(true);
  expect((await f.projects.store.readFresh(`projects/${f.projectId}/operations/${f.operationId}/render-outcome`)).value).toEqual({status:'failed',errorCode:'GENERATION_DISABLED'});
  expect((await new LocalEventLog(f.root).readFrom(f.projectId,f.operationId,0)).filter(({event})=>event.type==='operation.terminal')).toHaveLength(1);
  worker.kill('SIGTERM');expect(await exited,errors).toBe(0);
 }finally{if(worker.exitCode===null)worker.kill('SIGKILL');await exited;await rm(f.root,{recursive:true,force:true})}
},15000);
