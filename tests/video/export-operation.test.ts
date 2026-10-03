import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {LocalEventLog} from '@/services/video/stream/local-event-log';
import {updateJson} from '@/services/video/storage/atomic-store';
import {mandatoryDeliveryRules} from '@/services/video/quality/delivery';
import {requestExport} from '@/services/video/exports/request';
import {runExportOperation,cancelExport} from '@/services/video/exports/operation';
import {getArtifactAccess} from '@/services/video/exports/access';
import type {ProjectControl} from '@/contracts/video/project';
import {seedPreviewBundle} from './fixtures/preview-package';
import {writeWorkerHeartbeat} from '@/services/video/commands/worker-heartbeat';
let root:string;const owner='a'.repeat(64);const prior=process.env.VIDEO_SESSION_SIGNING_KEY;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'vb-export-op-'));process.env.VIDEO_SESSION_SIGNING_KEY='s'.repeat(64);await writeWorkerHeartbeat(root)});
afterEach(async()=>{await rm(root,{recursive:true,force:true});if(prior===undefined)delete process.env.VIDEO_SESSION_SIGNING_KEY;else process.env.VIDEO_SESSION_SIGNING_KEY=prior});
async function fixture(){
 const store=new FileStore(root),projects=new ProjectStore(store),queue=new LocalOperationQueue(store,root),events=new LocalEventLog(root),{projectId}=await projects.create(owner,{schemaVersion:5,clientCreateId:randomUUID(),clientCommandId:randomUUID()});
 const artifactId=randomUUID(),bytes=Buffer.from('protocol fixture only; not a real qualified movie'),sha256=createHash('sha256').update(bytes).digest('hex'),revisionId=randomUUID(),resultId=randomUUID();
 const bundle=await seedPreviewBundle(projects,{projectId,revisionId,durationSec:20,briefVersion:1,previewArtifactSha256:'b'.repeat(64)});
 await store.create(`projects/${projectId}/previews/${bundle.previewId}/manifest`,bundle);
 const key=`projects/${projectId}/artifacts/${artifactId}/files/final.mp4`;await mkdir(join(root,'objects',`projects/${projectId}/artifacts/${artifactId}/files`),{recursive:true});await writeFile(join(root,'objects',key),bytes);
 await store.create(`projects/${projectId}/artifacts/${artifactId}/manifest`,{id:artifactId,revisionId,objectRef:{key,sha256,bytes:bytes.length,mime:'video/mp4'},qaPassed:true,uploaded:true,filename:'final.mp4'});
 const manifest={resultId,artifactId,revisionId,previewId:bundle.previewId,approvalId:randomUUID(),bundleHash:bundle.bundleHash,mp4Sha256:sha256,mp4Bytes:bytes.length,qualityPolicy:{schemaVersion:1,audioIntent:'silent',captions:false,requiredRules:[...mandatoryDeliveryRules]},qualityChecks:[...mandatoryDeliveryRules,'decoded_silence'].map(ruleId=>({ruleId,result:'pass',severity:'blocking',evidenceRefs:['protocol-fixture-not-real-QA']})),createdAt:new Date().toISOString()};
 await store.create(`projects/${projectId}/results/${resultId}/manifest`,manifest);
 await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,phase:'ready' as const,currentResultId:resultId}));
 const request={schemaVersion:5 as const,clientCommandId:randomUUID(),artifactId,format:'source_zip' as const};
 return{store,projects,queue,events,projectId,artifactId,resultId,manifest,request};
}
it('T14 source ZIP request dispatches once, produces actual ZIP, replays SSE once and opens private download',async()=>{
 const f=await fixture(),first=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);
 expect(first.status).toBe(202);if(first.status!==202)throw Error('TEST');
 const repeated=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);expect(repeated).toEqual(first);
 expect(await f.queue.pending()).toHaveLength(1);
 let builds=0;const {prepareFrozenSourceArchive}=await import('@/services/video/exports/source-archive');
 const build:typeof prepareFrozenSourceArchive=async(...args)=>{builds++;return prepareFrozenSourceArchive(...args)};
 await runExportOperation(f.store,f.events,f.projectId,first.operationId,{root,build});
 await runExportOperation(new FileStore(root),new LocalEventLog(root),f.projectId,first.operationId,{root,build});
 expect(builds).toBe(1);const completed=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);
 expect(completed.status).toBe(200);if(completed.status!==200)throw Error('TEST');
 expect(completed.access.mime).toBe('application/zip');const exportedId=completed.artifactId;
 const artifact=(await f.store.readFresh<{objectRef:{key:string}}>(`projects/${f.projectId}/artifacts/${exportedId}/manifest`)).value;
 expect((await readFile(join(root,'objects',artifact.objectRef.key))).subarray(0,4).toString('hex')).toBe('504b0304');
 expect((await f.events.readFrom(f.projectId,first.operationId,0)).filter(e=>e.event.type==='operation.terminal')).toHaveLength(1);
 expect((await f.projects.access(owner,f.projectId)).currentResultId).toBe(f.resultId);
 await expect(getArtifactAccess(f.projects,owner,f.projectId,exportedId,'play')).rejects.toThrow('ACCESS_NOT_FOUND');
 await f.projects.tombstone(owner,f.projectId);await expect(getArtifactAccess(f.projects,owner,f.projectId,exportedId,'download')).rejects.toThrow('ACCESS_NOT_FOUND');
});
it('T14 rejects unqualified or unpublished results and changed idempotency bodies before dispatch',async()=>{
 const f=await fixture();await expect(requestExport(f.projects,f.queue,'foreign',f.projectId,f.request,root)).rejects.toThrow('ACCESS_NOT_FOUND');
 await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);
 await expect(requestExport(f.projects,f.queue,owner,f.projectId,{...f.request,format:'mp4'},root)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 const key=`projects/${f.projectId}/results/${f.resultId}/manifest`,old=await f.store.readFresh(key);await f.store.cas(key,old.etag,{...f.manifest,qualityChecks:[]});
 await expect(requestExport(f.projects,f.queue,owner,f.projectId,{...f.request,clientCommandId:randomUUID()},root)).rejects.toThrow('QUALITY_BLOCKED');
});
it('T14 preclaim export cancellation never builds and does not cancel production',async()=>{
 const f=await fixture(),started=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(started.status!==202)throw Error('TEST');
 const before=await f.projects.access(owner,f.projectId);expect(await cancelExport(f.projects,owner,f.projectId,started.operationId)).toBe('cancelled');
 await runExportOperation(f.store,f.events,f.projectId,started.operationId,{root,build:async()=>{throw Error('MUST_NOT_BUILD')}});
 expect((await f.projects.access(owner,f.projectId)).consentEpoch).toBe(before.consentEpoch);
});
it('T14 a lost cancellation ACK repairs terminal archive/SSE even after a new attempt replaces its slot',async()=>{
 const f=await fixture(),started=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(started.status!==202)throw Error('TEST');
 const original=f.store.cas.bind(f.store);let lost=false;
 f.store.cas=async(key,etag,value)=>{await original(key,etag,value);if(key===`projects/${f.projectId}/operations/${started.operationId}`&&(value as {status:string}).status==='cancelled'&&!lost){lost=true;throw Error('CANCEL_ACK_LOST')}};
 await expect(cancelExport(f.projects,owner,f.projectId,started.operationId,f.events)).rejects.toThrow('CANCEL_ACK_LOST');
 await requestExport(f.projects,f.queue,owner,f.projectId,{...f.request,clientCommandId:randomUUID()},root);
 const {runQueuedOnce}=await import('@/services/video/commands/local-worker');
 await runQueuedOnce(f.queue,f.store,async job=>{if(job.operationId===started.operationId)await runExportOperation(new FileStore(root),new LocalEventLog(root),job.projectId,job.operationId,{root,build:async()=>{throw Error('MUST_NOT_BUILD')}})});
 expect((await f.queue.pending()).some(job=>job.operationId===started.operationId)).toBe(false);
 expect((await f.store.readFresh(`projects/${f.projectId}/operations/${started.operationId}/export-outcome`)).value).toEqual({status:'cancelled'});
 expect((await f.events.readFrom(f.projectId,started.operationId,0)).filter(({event})=>event.type==='operation.terminal')).toHaveLength(1);
});
it('T14 cold worker repairs a lost enqueue and concurrent different commands share the same export',async()=>{
 const f=await fixture(),lost={enqueue:async()=>{throw Error('LOST_ENQUEUE')}} as unknown as LocalOperationQueue;
 await expect(requestExport(f.projects,lost,owner,f.projectId,f.request,root)).rejects.toThrow('START_FAILED');
 expect(await f.queue.pending()).toEqual([]);await f.queue.reconcileExports();expect(await f.queue.pending()).toHaveLength(1);
 const a=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root),b=await requestExport(f.projects,f.queue,owner,f.projectId,{...f.request,clientCommandId:randomUUID()},root);
 expect(a.operationId).toEqual(b.operationId);
});
it('T14 cold discovery repairs a missing operation file from the reserved result slot',async()=>{
 const f=await fixture(),started=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(started.status!==202)throw Error('TEST');
 await rm(join(root,`projects/${f.projectId}/operations/${started.operationId}.json`));await rm(join(root,'queue'),{recursive:true,force:true});
 await f.queue.reconcileExports();expect(await f.queue.pending()).toHaveLength(1);
 const {runQueuedOnce}=await import('@/services/video/commands/local-worker');await runQueuedOnce(f.queue,f.store,job=>runExportOperation(f.store,f.events,job.projectId,job.operationId,{root}));
 expect((await f.projects.operation(f.projectId,started.operationId))?.status).toBe('succeeded');
});
it('T14 cold slot recovery binds the original command before another command can cancel and replace its attempt',async()=>{
 const f=await fixture(),originalCreate=f.store.create.bind(f.store);let lost=false;
 f.store.create=async(key,value)=>{await originalCreate(key,value);if(key.endsWith('/export-requests/source_zip')&&!lost){lost=true;throw Error('LOST_SLOT_ACK')}};
 await expect(requestExport(f.projects,f.queue,owner,f.projectId,f.request,root)).rejects.toThrow('LOST_SLOT_ACK');
 f.store.create=originalCreate;await f.queue.reconcileExports();const old=(await f.queue.pending())[0].operationId;
 const other=await requestExport(f.projects,f.queue,owner,f.projectId,{...f.request,clientCommandId:randomUUID()},root);expect(other.operationId).toBe(old);
 await cancelExport(f.projects,owner,f.projectId,old,f.events);
 const replacement=await requestExport(f.projects,f.queue,owner,f.projectId,{...f.request,clientCommandId:randomUUID()},root);expect(replacement.operationId).not.toBe(old);
 const retriedOriginal=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);expect(retriedOriginal.operationId).toBe(old);
});
it('T14 cancellation during archive creation blocks publication and terminal SSE reports cancelled',async()=>{
 const f=await fixture(),started=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(started.status!==202)throw Error('TEST');
 const {prepareFrozenSourceArchive}=await import('@/services/video/exports/source-archive');
 await runExportOperation(f.store,f.events,f.projectId,started.operationId,{root,build:async(...args)=>{const built=await prepareFrozenSourceArchive(...args);await cancelExport(f.projects,owner,f.projectId,started.operationId,f.events);return built}});
 expect((await f.projects.operation(f.projectId,started.operationId))?.status).toBe('cancelled');
 expect((await f.projects.access(owner,f.projectId)).publishedExports).toBeUndefined();
 expect((await f.events.readFrom(f.projectId,started.operationId,0)).at(-1)?.event.payload).toMatchObject({status:'cancelled'});
});
it('T14 cancellation after a prepared publication record wins the visibility CAS and denies orphan ZIP access',async()=>{
 const f=await fixture(),started=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(started.status!==202)throw Error('TEST');
 const original=f.store.create.bind(f.store);let orphanId='';
 f.store.create=async(key,value)=>{await original(key,value);if(key.endsWith('/exports/source_zip')){orphanId=(value as {artifactId:string}).artifactId;await cancelExport(f.projects,owner,f.projectId,started.operationId,f.events)}};
 await runExportOperation(f.store,f.events,f.projectId,started.operationId,{root});
 expect(orphanId).not.toBe('');expect((await f.projects.operation(f.projectId,started.operationId))?.status).toBe('cancelled');
 await expect(getArtifactAccess(f.projects,owner,f.projectId,orphanId,'download')).rejects.toThrow('ACCESS_NOT_FOUND');
 const retry=await requestExport(f.projects,f.queue,owner,f.projectId,{...f.request,clientCommandId:randomUUID()},root);if(retry.status!==202)throw Error('TEST');
 expect(retry.operationId).not.toBe(started.operationId);await runExportOperation(f.store,f.events,f.projectId,retry.operationId,{root});
 expect((await f.projects.operation(f.projectId,retry.operationId))?.status).toBe('succeeded');
});
it('T14 explicit new commands may retry a cancelled export while the original command keeps its terminal identity',async()=>{
 const f=await fixture(),first=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(first.status!==202)throw Error('TEST');
 await cancelExport(f.projects,owner,f.projectId,first.operationId,f.events);
 const next=await requestExport(f.projects,f.queue,owner,f.projectId,{...f.request,clientCommandId:randomUUID()},root);if(next.status!==202)throw Error('TEST');expect(next.operationId).not.toBe(first.operationId);
 const original=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);expect(original.operationId).toBe(first.operationId);
 expect((await f.projects.operation(f.projectId,first.operationId))?.status).toBe('cancelled');
});
it('T14 resumes after a lost publication CAS acknowledgement with zero additional builders',async()=>{
 const f=await fixture(),started=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(started.status!==202)throw Error('TEST');
 const original=f.store.cas.bind(f.store);let lost=false,builds=0;
 f.store.cas=async(key,etag,value)=>{await original(key,etag,value);if(key===`projects/${f.projectId}/control`&&(value as ProjectControl).publishedExports&&!lost){lost=true;throw Error('LOST_PUBLICATION_ACK')}};
 const {prepareFrozenSourceArchive}=await import('@/services/video/exports/source-archive');
 const build:typeof prepareFrozenSourceArchive=async(...args)=>{builds++;return prepareFrozenSourceArchive(...args)};
 await expect(runExportOperation(f.store,f.events,f.projectId,started.operationId,{root,build})).rejects.toThrow('LOST_PUBLICATION_ACK');
 await runExportOperation(new FileStore(root),new LocalEventLog(root),f.projectId,started.operationId,{root,build});expect(builds).toBe(1);
 expect((await f.projects.operation(f.projectId,started.operationId))?.status).toBe('succeeded');
 expect((await f.events.readFrom(f.projectId,started.operationId,0)).filter(e=>e.event.type==='operation.terminal')).toHaveLength(1);
});
it('T14 a deleted project settles a committed export after lost ACK, without recreating files or granting access',async()=>{
 const f=await fixture(),started=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(started.status!==202)throw Error('TEST');
 const original=f.store.cas.bind(f.store);let lost=false;
 f.store.cas=async(key,etag,value)=>{await original(key,etag,value);if(key===`projects/${f.projectId}/control`&&(value as ProjectControl).publishedExports&&!lost){lost=true;throw Error('LOST_PUBLICATION_ACK')}};
 await expect(runExportOperation(f.store,f.events,f.projectId,started.operationId,{root})).rejects.toThrow('LOST_PUBLICATION_ACK');
 await f.projects.tombstone(owner,f.projectId);await rm(join(root,'objects'),{recursive:true,force:true});
 const {runQueuedOnce}=await import('@/services/video/commands/local-worker');
 await runQueuedOnce(f.queue,f.store,job=>runExportOperation(new FileStore(root),new LocalEventLog(root),job.projectId,job.operationId,{root,build:async()=>{throw Error('MUST_NOT_BUILD')}}));
 expect(await f.queue.pending()).toEqual([]);expect((await f.projects.operation(f.projectId,started.operationId))?.status).toBe('succeeded');
 await expect(requestExport(f.projects,f.queue,owner,f.projectId,f.request,root)).rejects.toThrow('ACCESS_NOT_FOUND');
});
it('T14 authenticated HTTP POST, worker and file route deliver real ZIP bytes and reject foreign sessions',async()=>{
 const f=await fixture(),{issueSession,ownerHash,verifySession}=await import('@/services/video/access/session'),keys={current:'s'.repeat(64),environment:'local',keyId:'v1'},session=issueSession(keys),foreign=issueSession(keys),scope=ownerHash(verifySession(session.token,keys).sid,keys);
 await updateJson(f.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,ownerKeyHash:scope}));
 const environment={VIDEO_DATA_DIR:process.env.VIDEO_DATA_DIR,VIDEO_ENVIRONMENT:process.env.VIDEO_ENVIRONMENT,VIDEO_APP_ORIGIN:process.env.VIDEO_APP_ORIGIN};
 Object.assign(process.env,{VIDEO_DATA_DIR:root,VIDEO_ENVIRONMENT:'local',VIDEO_APP_ORIGIN:'https://video.test'});
 try{
  const {POST}=await import('@/app/api/video/projects/[projectId]/exports/route'),{GET}=await import('@/app/api/video/projects/[projectId]/artifacts/[artifactId]/file/route');
  const send=(token:string)=>POST(new Request(`https://video.test/api/video/projects/${f.projectId}/exports`,{method:'POST',headers:{origin:'https://video.test',cookie:`vb-session=${token}`,'content-type':'application/json'},body:JSON.stringify(f.request)}),{params:Promise.resolve({projectId:f.projectId})});
  expect((await send(foreign.token)).status).toBe(404);
  const accepted=await send(session.token);expect(accepted.status).toBe(202);const started=await accepted.json();expect(started.receipt.commandId).toBe(f.request.clientCommandId);
  const {runQueuedOnce}=await import('@/services/video/commands/local-worker');
  await runQueuedOnce(f.queue,f.store,job=>runExportOperation(f.store,f.events,job.projectId,job.operationId,{root}));
  const completed=await send(session.token);expect(completed.status).toBe(200);const ready=await completed.json();
  const request=new Request('https://video.test'+ready.access.url,{headers:{cookie:`vb-session=${session.token}`}}),params={params:Promise.resolve({projectId:f.projectId,artifactId:ready.artifactId})};
  const file=await GET(request,params);expect(file.status).toBe(200);expect(file.headers.get('content-type')).toBe('application/zip');expect(file.headers.get('cache-control')).toBe('private,no-store');expect(Buffer.from(await file.arrayBuffer()).subarray(0,4).toString('hex')).toBe('504b0304');
  const forged=await GET(new Request('https://video.test'+ready.access.url,{headers:{cookie:`vb-session=${foreign.token}`}}),params);expect(forged.status).toBe(404);
  await f.projects.tombstone(scope,f.projectId);expect((await GET(request,params)).status).toBe(404);
 }finally{for(const[name,value]of Object.entries(environment))if(value===undefined)delete process.env[name];else process.env[name]=value}
});
it('T14 rejects symlink object folders and unexplained hardlinks without overwriting external files',async()=>{
 const {persistArchiveObject}=await import('@/services/video/exports/archive-object'),{symlink,link}=await import('node:fs/promises'),outside=await mkdtemp(join(tmpdir(),'vb-export-outside-'));
 try{
  const bytes=Buffer.from('bounded writer protocol'),digest=createHash('sha256').update(bytes).digest('hex'),projectId=randomUUID(),artifactId=randomUUID(),key=`projects/${projectId}/artifacts/${artifactId}/files/source.zip`;
  await symlink(outside,join(root,'objects'));await expect(persistArchiveObject(root,key,digest,bytes)).rejects.toThrow('ARTIFACT_INVALID');
  await rm(join(root,'objects'));await persistArchiveObject(root,key,digest,bytes);
  const path=join(root,'objects',key);await link(path,join(outside,'unexplained.zip'));
  await expect(persistArchiveObject(root,key,digest,bytes)).rejects.toThrow('ARTIFACT_INVALID');expect(await readFile(join(outside,'unexplained.zip'))).toEqual(bytes);
 }finally{await rm(outside,{recursive:true,force:true})}
});
it('T14 the real worker boots with generation disabled and no model credentials for independent exports',async()=>{
 await rm(join(root,'worker-heartbeat'));
 const worker=spawn(process.execPath,['--import','tsx','scripts/video/worker.ts'],{cwd:process.cwd(),env:{NODE_ENV:'test',PATH:process.env.PATH,VIDEO_DATA_DIR:root,VIDEO_GENERATION_ENABLED:'false'},stdio:['ignore','ignore','pipe']});
 let errors='';worker.stderr.on('data',(part:Buffer)=>{errors+=part.toString('utf8')});
 const exited=new Promise<number|null>((resolve,reject)=>{worker.once('error',reject);worker.once('close',resolve)});
 try{
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
   try{const heartbeat=await readFile(join(root,'worker-heartbeat'),'utf8');ready=Number.isFinite(Date.parse(heartbeat));if(ready)break}catch{}
   if(worker.exitCode!==null)throw Error('WORKER_FAILED: '+errors);
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  expect(ready,errors).toBe(true);worker.kill('SIGTERM');expect(await exited,errors).toBe(0);
 }finally{if(worker.exitCode===null)worker.kill('SIGKILL');await exited}
},15000);
