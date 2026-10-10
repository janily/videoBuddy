import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,writeFile,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {LocalEventLog} from '@/services/video/stream/local-event-log';
import {updateJson} from '@/services/video/storage/atomic-store';
import {requestExport} from '@/services/video/exports/request';
import {runExportOperation,cancelExport} from '@/services/video/exports/operation';
import {getArtifactAccess} from '@/services/video/exports/access';
import {prepareExportPoster} from '@/services/video/exports/poster';
import {persistArchiveObject} from '@/services/video/exports/archive-object';
import type {ProjectControl} from '@/contracts/video/project';
import {writeWorkerHeartbeat} from '@/services/video/commands/worker-heartbeat';
import {protocolPng} from './fixtures/png';
let root:string;const owner='a'.repeat(64);const prior=process.env.VIDEO_SESSION_SIGNING_KEY;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'vb-export-op-'));process.env.VIDEO_SESSION_SIGNING_KEY='s'.repeat(64);await writeWorkerHeartbeat(root)});
afterEach(async()=>{await rm(root,{recursive:true,force:true});if(prior===undefined)delete process.env.VIDEO_SESSION_SIGNING_KEY;else process.env.VIDEO_SESSION_SIGNING_KEY=prior});
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
 const store=new FileStore(root),projects=new ProjectStore(store),queue=new LocalOperationQueue(store,root),events=new LocalEventLog(root),{projectId}=await projects.create(owner,{schemaVersion:5,clientCreateId:randomUUID(),clientCommandId:randomUUID()});
 const artifactId=randomUUID(),bytes=Buffer.alloc(2048,1),sha256=hash(bytes),revisionId=randomUUID(),resultId=randomUUID();
 const key=`projects/${projectId}/artifacts/${artifactId}/files/final.mp4`;await mkdir(join(root,'objects',`projects/${projectId}/artifacts/${artifactId}/files`),{recursive:true});await writeFile(join(root,'objects',key),bytes);
 await store.create(`projects/${projectId}/artifacts/${artifactId}/manifest`,{id:artifactId,revisionId,objectRef:{key,sha256,bytes:bytes.length,mime:'video/mp4'},qaPassed:true,uploaded:true,filename:'final.mp4'});
 const manifest={kind:'quick' as const,resultId,artifactId,revisionId,operationId:randomUUID(),bundleHash:'b'.repeat(64),mp4Sha256:sha256,mp4Bytes:bytes.length,briefVersion:1,styleSlug:'watercolor',aspect:'16:9' as const,durationSec:20,shots:[{id:'s1',scriptLine:'Protocol fixture only',startFrame:0,endFrame:480,take:0}],music:null,aiLabel:true as const,createdAt:new Date().toISOString()};
 await store.create(`projects/${projectId}/results/${resultId}/manifest`,manifest);
 await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,phase:'ready' as const,currentResultId:resultId}));
 const request={schemaVersion:5 as const,clientCommandId:randomUUID(),artifactId,format:'poster' as const};
 return{store,projects,queue,events,projectId,artifactId,resultId,manifest,request,key};
}
// Explicit protocol PNG avoids pretending this unit test rendered real video.
const png=protocolPng();
const poster:typeof prepareExportPoster=(projects,owner,pid,aid,root,options)=>prepareExportPoster(projects,owner,pid,aid,root,{...options,extract:async()=>png});
it('quick MP4 downloads immediately without requiring an export worker',async()=>{
 const f=await fixture();await rm(join(root,'worker-heartbeat'));
 const request={...f.request,format:'mp4' as const};
 const first=await requestExport(f.projects,f.queue,owner,f.projectId,request,root);
 expect(first).toMatchObject({status:200,artifactId:f.artifactId,access:{mime:'video/mp4',purpose:'download'}});
 expect((await requestExport(f.projects,f.queue,owner,f.projectId,request,root)).status).toBe(200);
 expect(await f.queue.pending()).toEqual([]);
});
it.each(['source_zip','srt','treatment','credits','quality'])('rejects removed %s exports before creating work',async format=>{
 const f=await fixture();await expect(requestExport(f.projects,f.queue,owner,f.projectId,{...f.request,format} as never,root)).rejects.toThrow();expect(await f.queue.pending()).toEqual([]);
});
it('poster dispatch is idempotent, cold replay builds once, and download remains private',async()=>{
 const f=await fixture(),first=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(first.status!==202)throw Error('TEST');
 expect(await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root)).toEqual(first);expect(await f.queue.pending()).toHaveLength(1);
 let calls=0;const build:typeof poster=async(...args)=>{calls++;return poster(...args)};
 await runExportOperation(f.store,f.events,f.projectId,first.operationId,{root,poster:build});await runExportOperation(new FileStore(root),new LocalEventLog(root),f.projectId,first.operationId,{root,poster:build});expect(calls).toBe(1);
 const completed=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(completed.status!==200)throw Error('TEST');
 expect(completed.access).toMatchObject({mime:'image/png',filename:'VideoBuddy-poster.png'});
 const artifact=(await f.store.readFresh<{objectRef:{key:string}}>(`projects/${f.projectId}/artifacts/${completed.artifactId}/manifest`)).value;expect(await readFile(join(root,'objects',artifact.objectRef.key))).toEqual(png);
 expect((await f.events.readFrom(f.projectId,first.operationId,0)).filter(e=>e.event.type==='operation.terminal')).toHaveLength(1);
 await expect(getArtifactAccess(f.projects,'foreign',f.projectId,completed.artifactId,'download')).rejects.toThrow('ACCESS_NOT_FOUND');
 await expect(getArtifactAccess(f.projects,owner,f.projectId,completed.artifactId,'play')).rejects.toThrow('ACCESS_NOT_FOUND');
 await f.projects.tombstone(owner,f.projectId);await expect(getArtifactAccess(f.projects,owner,f.projectId,completed.artifactId,'download')).rejects.toThrow('ACCESS_NOT_FOUND');
});
it('rejects altered MP4 bytes and unqualified source before dispatch',async()=>{
 const f=await fixture();await writeFile(join(root,'objects',f.key),Buffer.alloc(2048,2));
 await expect(requestExport(f.projects,f.queue,owner,f.projectId,f.request,root)).rejects.toThrow('ARTIFACT_INVALID');expect(await f.queue.pending()).toEqual([]);
});
it('changed command body cannot be reused for another export',async()=>{
 const f=await fixture();await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);
 await expect(requestExport(f.projects,f.queue,owner,f.projectId,{...f.request,format:'mp4'},root)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
});
it('cancel during poster generation blocks publication; new commands retry, original stays terminal',async()=>{
 const f=await fixture(),first=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(first.status!==202)throw Error('TEST');
 await runExportOperation(f.store,f.events,f.projectId,first.operationId,{root,poster:async(...args)=>{const built=await poster(...args);await cancelExport(f.projects,owner,f.projectId,first.operationId,f.events);return built}});
 expect((await f.projects.operation(f.projectId,first.operationId))?.status).toBe('cancelled');expect((await f.projects.access(owner,f.projectId)).publishedExports).toBeUndefined();
 const next=await requestExport(f.projects,f.queue,owner,f.projectId,{...f.request,clientCommandId:randomUUID()},root);expect(next.operationId).not.toBe(first.operationId);
 expect((await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root)).operationId).toBe(first.operationId);
});
it('cancellation after prepared publication denies the orphan poster and permits an explicit retry',async()=>{
 const f=await fixture(),first=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(first.status!==202)throw Error('TEST');
 const create=f.store.create.bind(f.store);let orphanId='';
 f.store.create=async(key,value)=>{await create(key,value);if(key.endsWith('/exports/poster')){orphanId=(value as {artifactId:string}).artifactId;await cancelExport(f.projects,owner,f.projectId,first.operationId,f.events)}};
 await runExportOperation(f.store,f.events,f.projectId,first.operationId,{root,poster});expect(orphanId).not.toBe('');
 await expect(getArtifactAccess(f.projects,owner,f.projectId,orphanId,'download')).rejects.toThrow('ACCESS_NOT_FOUND');
 f.store.create=create;const retry=await requestExport(f.projects,f.queue,owner,f.projectId,{...f.request,clientCommandId:randomUUID()},root);if(retry.status!==202)throw Error('TEST');
 await runExportOperation(f.store,f.events,f.projectId,retry.operationId,{root,poster});expect((await f.projects.operation(f.projectId,retry.operationId))?.status).toBe('succeeded');
});
it('cold recovery repairs a slot saved before dispatch acknowledgement',async()=>{
 const f=await fixture(),create=f.store.create.bind(f.store);let lost=false;
 f.store.create=async(key,value)=>{await create(key,value);if(key.endsWith('/export-requests/poster')&&!lost){lost=true;throw Error('SLOT_ACK_LOST')}};
 await expect(requestExport(f.projects,f.queue,owner,f.projectId,f.request,root)).rejects.toThrow('SLOT_ACK_LOST');
 const store=new FileStore(root),queue=new LocalOperationQueue(store,root);await queue.reconcileExports();expect(await queue.pending()).toHaveLength(1);
 const first=(await queue.pending())[0],replay=await requestExport(new ProjectStore(store),queue,owner,f.projectId,f.request,root);expect(replay.operationId).toBe(first.operationId);
});
it.each([false,true])('lost publication acknowledgement settles without rebuilding (deleted=%s)',async deleted=>{
 const f=await fixture(),first=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(first.status!==202)throw Error('TEST');
 const cas=f.store.cas.bind(f.store);let lost=false,calls=0;const build:typeof poster=async(...args)=>{calls++;return poster(...args)};
 f.store.cas=async(key,etag,value)=>{await cas(key,etag,value);if(key===`projects/${f.projectId}/control`&&(value as ProjectControl).publishedExports&&!lost){lost=true;throw Error('PUBLICATION_ACK_LOST')}};
 await expect(runExportOperation(f.store,f.events,f.projectId,first.operationId,{root,poster:build})).rejects.toThrow('PUBLICATION_ACK_LOST');
 if(deleted){await f.projects.tombstone(owner,f.projectId);await rm(join(root,'objects'),{recursive:true,force:true})}
 await runExportOperation(new FileStore(root),new LocalEventLog(root),f.projectId,first.operationId,{root,poster:build});expect(calls).toBe(1);expect((await f.projects.operation(f.projectId,first.operationId))?.status).toBe('succeeded');
});
it('rejects invalid or wrong-aspect PNG without publishing it',async()=>{
 const f=await fixture();
 for(const bytes of [Buffer.from('not png'),protocolPng(1080,1920)])await expect(prepareExportPoster(f.projects,owner,f.projectId,f.artifactId,root,{extract:async()=>bytes})).rejects.toThrow('EXPORT_POSTER_INVALID');
});
it('private immutable poster writer rejects symlink folders and unexpected hardlinks',async()=>{
 const outside=await mkdtemp(join(tmpdir(),'vb-export-outside-'));try{
  const key=`projects/${randomUUID()}/artifacts/${randomUUID()}/files/poster.png`;
  await symlink(outside,join(root,'objects'));await expect(persistArchiveObject(root,key,hash(png),png)).rejects.toThrow('ARTIFACT_INVALID');
  await rm(join(root,'objects'));await persistArchiveObject(root,key,hash(png),png);await link(join(root,'objects',key),join(outside,'poster.png'));
  await expect(persistArchiveObject(root,key,hash(png),png)).rejects.toThrow('ARTIFACT_INVALID');expect(await readFile(join(outside,'poster.png'))).toEqual(png);
 }finally{await rm(outside,{recursive:true,force:true})}
});
it('poster and source MP4 remain accessible when a previous quick result is restored idempotently',async()=>{
 const f=await fixture(),first=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(first.status!==202)throw Error('TEST');
 await runExportOperation(f.store,f.events,f.projectId,first.operationId,{root,poster});
 const ready=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(ready.status!==200)throw Error('TEST');
 const nextResultId=randomUUID();await f.store.create(`projects/${f.projectId}/results/${nextResultId}/manifest`,{...f.manifest,resultId:nextResultId,artifactId:randomUUID(),revisionId:randomUUID()});
 await updateJson(f.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,currentResultId:nextResultId,previousResultId:f.resultId}));
 expect((await getArtifactAccess(f.projects,owner,f.projectId,ready.artifactId,'download')).mime).toBe('image/png');
 const {restoreResult}=await import('@/services/video/results/restore'),command={schemaVersion:5 as const,clientCommandId:randomUUID()};
 await restoreResult(f.projects,owner,f.projectId,f.artifactId,command,root);await restoreResult(f.projects,owner,f.projectId,f.artifactId,command,root);
 expect((await f.projects.access(owner,f.projectId)).currentResultId).toBe(f.resultId);
 expect((await getArtifactAccess(f.projects,owner,f.projectId,ready.artifactId,'download')).mime).toBe('image/png');
 expect((await getArtifactAccess(f.projects,owner,f.projectId,f.artifactId,'play')).mime).toBe('video/mp4');
});
it('authenticated export HTTP, worker and range download reject foreign or expired owners',async()=>{
 const f=await fixture(),{issueSession,ownerHash,verifySession}=await import('@/services/video/access/session'),keys={current:'s'.repeat(64),environment:'local',keyId:'v1'},session=issueSession(keys),foreign=issueSession(keys),scope=ownerHash(verifySession(session.token,keys).sid,keys);
 await updateJson(f.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,ownerKeyHash:scope}));
 const environment={VIDEO_DATA_DIR:process.env.VIDEO_DATA_DIR,VIDEO_ENVIRONMENT:process.env.VIDEO_ENVIRONMENT,VIDEO_APP_ORIGIN:process.env.VIDEO_APP_ORIGIN};
 Object.assign(process.env,{VIDEO_DATA_DIR:root,VIDEO_ENVIRONMENT:'local',VIDEO_APP_ORIGIN:'https://video.test'});
 try{
  const {POST}=await import('@/app/api/video/projects/[projectId]/exports/route'),{GET}=await import('@/app/api/video/projects/[projectId]/artifacts/[artifactId]/file/route');
  const send=(token:string)=>POST(new Request(`https://video.test/api/video/projects/${f.projectId}/exports`,{method:'POST',headers:{origin:'https://video.test',cookie:`vb-session=${token}`,'content-type':'application/json'},body:JSON.stringify(f.request)}),{params:Promise.resolve({projectId:f.projectId})});
  expect((await send(foreign.token)).status).toBe(404);const accepted=await send(session.token);expect(accepted.status).toBe(202);const started=await accepted.json();
  const {runQueuedOnce}=await import('@/services/video/commands/local-worker');await runQueuedOnce(f.queue,f.store,job=>runExportOperation(f.store,f.events,job.projectId,job.operationId,{root,poster}));
  expect((await f.projects.operation(f.projectId,started.operationId))?.status).toBe('succeeded');const completed=await send(session.token);expect(completed.status).toBe(200);const ready=await completed.json();
  const params={params:Promise.resolve({projectId:f.projectId,artifactId:ready.artifactId})};
  const read=(token:string,range='bytes=0-7')=>GET(new Request('https://video.test'+ready.access.url,{headers:{cookie:`vb-session=${token}`,range}}),params);
  const file=await read(session.token);expect(file.status).toBe(206);expect(file.headers.get('content-type')).toBe('image/png');expect(file.headers.get('cache-control')).toBe('private,no-store');expect(Buffer.from(await file.arrayBuffer())).toEqual(png.subarray(0,8));
  expect((await read(session.token,'bytes=999999999-')).status).toBe(416);expect((await read(foreign.token)).status).toBe(404);
  await updateJson(f.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,expiresAt:'2000-01-01T00:00:00.000Z'}));expect((await read(session.token)).status).toBe(410);
 }finally{for(const[name,value]of Object.entries(environment))if(value===undefined)delete process.env[name];else process.env[name]=value}
});
it('unqualified artifacts and retired preview-only artifacts cannot be exported',async()=>{
 const f=await fixture(),key=`projects/${f.projectId}/artifacts/${f.artifactId}/manifest`,artifact=await f.store.readFresh<{qaPassed:boolean}>(key);
 await f.store.cas(key,artifact.etag,{...artifact.value,qaPassed:false});
 await expect(requestExport(f.projects,f.queue,owner,f.projectId,f.request,root)).rejects.toThrow('QUALITY_BLOCKED');expect(await f.queue.pending()).toEqual([]);
 const latest=await f.store.readFresh(key);await f.store.cas(key,latest.etag,artifact.value);
 await updateJson(f.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,currentResultId:undefined}));
 await expect(getArtifactAccess(f.projects,owner,f.projectId,f.artifactId,'download')).rejects.toThrow('ACCESS_NOT_FOUND');
 await expect(requestExport(f.projects,f.queue,owner,f.projectId,{...f.request,clientCommandId:randomUUID()},root)).rejects.toThrow('RESULT_STALE');
});
it('a completed poster whose bytes changed cannot be returned as a cached export',async()=>{
 const f=await fixture(),first=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(first.status!==202)throw Error('TEST');
 await runExportOperation(f.store,f.events,f.projectId,first.operationId,{root,poster});
 const ready=await requestExport(f.projects,f.queue,owner,f.projectId,f.request,root);if(ready.status!==200)throw Error('TEST');
 const artifact=(await f.store.readFresh<{objectRef:{key:string}}>(`projects/${f.projectId}/artifacts/${ready.artifactId}/manifest`)).value;
 await writeFile(join(root,'objects',artifact.objectRef.key),Buffer.alloc(png.length,1));
 await expect(requestExport(f.projects,f.queue,owner,f.projectId,f.request,root)).rejects.toThrow('ARTIFACT_INVALID');
});
