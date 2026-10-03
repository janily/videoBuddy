import{it,expect}from'vitest';
import{mkdtemp,mkdir,rm,writeFile}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{createHash,randomUUID}from'node:crypto';
import{mapPreviewTime,validateExcerptMap}from'@/services/video/preview/excerpt';
import{assertPreviewArtifact,createPreviewBundle,verifyPreviewBundle}from'@/services/video/preview/bundle';
import type{PreviewBundleInput}from'@/services/video/preview/bundle';
import{commitPreviewBundle,readPreviewBundle}from'@/services/video/preview/commit';
import{approvePreview}from'@/services/video/preview/approve';
import{LocalOperationQueue}from'@/services/video/commands/local-queue';
import{resolveArtifact}from'@/services/video/exports/access';
import{ProjectStore}from'@/services/video/storage/project-store';
import{FileStore}from'@/services/video/storage/file-store';
import{updateJson,StoreConflict}from'@/services/video/storage/atomic-store';
import type{ProjectControl}from'@/contracts/video/project';
import{seedPreviewBundle,seedPreviewOperation}from'./fixtures/preview-package';
import{canonicalHash}from'@/services/video/domain/hash';
const preview={previewArtifactId:'artifact',revisionId:'revision',excerptMap:[{previewStartMs:0,previewEndMs:3000,sourceStartMs:0,sourceEndMs:3000,shotId:'one'},{previewStartMs:3000,previewEndMs:6000,sourceStartMs:18000,sourceEndMs:21000,shotId:'two'},{previewStartMs:6000,previewEndMs:9000,sourceStartMs:40000,sourceEndMs:43000,shotId:'three'}]};
it('AT-036 second preview segment maps to actual source time',()=>expect(mapPreviewTime(preview,4000)).toEqual({artifactId:'artifact',revisionId:'revision',previewTimeMs:4000,sourceTimeMs:19000}));
it('AT-081 unmapped transition time never receives a false source location',()=>{expect(mapPreviewTime(preview,-1)).toBeNull();expect(mapPreviewTime(preview,9000)).toBeNull()});
it('an excerpt is six to twelve seconds and source intervals retain equal duration',()=>{
 expect(validateExcerptMap(preview.excerptMap,45000)).toBe(9000);
 expect(()=>validateExcerptMap([{previewStartMs:0,previewEndMs:5000,sourceStartMs:0,sourceEndMs:4000,shotId:'bad'}],45000)).toThrow('EXCERPT_INVALID');
});
const sha=(letter:string)=>letter.repeat(64);
it('the final publication CAS rechecks Understanding after a concurrent baseline replacement',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vb-preview-race-'));
 class RacingStore extends FileStore{
  armed=false;
  async cas<T>(key:string,etag:string,value:T){
   if(this.armed&&key.endsWith('/control')){
    this.armed=false;
    const old=(await this.readFresh<ProjectControl>(key)).value;
    await super.cas(key,etag,{...old,understandingRef:{...old.understandingRef,sha256:'9'.repeat(64)}});
    throw new StoreConflict();
   }
   return super.cas(key,etag,value);
  }
 }
 try{
  const store=new RacingStore(dir),projects=new ProjectStore(store),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),operationId=randomUUID();
  const bundle=await storedBundle(projects,projectId);await storedPreviewArtifact(projects,dir,projectId,bundle);
  await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:3,phase:'preparing_preview' as const,activeProduction:operationId}));
  await seedPreviewOperation(projects,operationId,bundle);store.armed=true;
  await expect(commitPreviewBundle(projects,projectId,operationId,0,bundle,dir)).rejects.toThrow('PREVIEW_STALE');
  expect((await projects.access('owner',projectId)).currentPreviewId).toBeUndefined();
 }finally{await rm(dir,{recursive:true,force:true})}
});
const previewBytes=Buffer.alloc(100);previewBytes.write('ftyp',4);
const previewSha=createHash('sha256').update(previewBytes).digest('hex');
it('cold recovery verifies committed preview bytes before resolving its started media marker',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vb-published-recovery-'));
 try{
  const projects=new ProjectStore(new FileStore(dir)),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),operationId=randomUUID();
  const bundle=await storedBundle(projects,projectId);await storedPreviewArtifact(projects,dir,projectId,bundle);
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:3,phase:'preparing_preview' as const,activeProduction:operationId}));
  await seedPreviewOperation(projects,operationId,bundle);
  await updateJson(projects.store,`projects/${projectId}/operations/${operationId}`,(op:object)=>({...op,mediaAttemptStarted:true}));
  await commitPreviewBundle(projects,projectId,operationId,0,bundle,dir);
  // Synthetic bytes test archive verification/recovery only, never media QA.
  const {runPreviewOperation}=await import('@/services/video/commands/local-preview'),{LocalEventLog}=await import('@/services/video/stream/local-event-log');let calls=0;
  const cold=new ProjectStore(new FileStore(dir));
  await runPreviewOperation(cold.store,new LocalEventLog(dir),projectId,operationId,{root:dir,build:async()=>{calls++;throw Error('UNEXPECTED_BUILD')}});
  expect(calls).toBe(0);expect((await cold.operation(projectId,operationId))?.status).toBe('succeeded');
  expect((await cold.access('owner',projectId)).unresolvedMediaStops).toBeUndefined();
 }finally{await rm(dir,{recursive:true,force:true})}
});
async function storedPreviewArtifact(projects:ProjectStore,dir:string,projectId:string,bundle:{previewArtifactId:string;revisionId:string}){
 const key=`projects/${projectId}/artifacts/${bundle.previewArtifactId}/files/preview.mp4`,path=join(dir,'objects',key);
 await mkdir(join(dir,'objects',`projects/${projectId}/artifacts/${bundle.previewArtifactId}/files`),{recursive:true});await writeFile(path,previewBytes);
 await projects.store.create(`projects/${projectId}/artifacts/${bundle.previewArtifactId}/manifest`,{id:bundle.previewArtifactId,revisionId:bundle.revisionId,objectRef:{key,sha256:previewSha,bytes:previewBytes.length,mime:'video/mp4'},qaPassed:true,uploaded:true,filename:'preview.mp4'});
 return path;
}
const bundleInput={
 previewId:'00000000-0000-4000-8000-000000000001',revisionId:'00000000-0000-4000-8000-000000000002',briefVersion:3,
 filmSpecRef:{key:'projects/p/revisions/r/film',sha256:sha('a'),bytes:500,mime:'application/json'},
 renderInputs:{sourceCodeSha256:sha('b'),timelineSha256:sha('c'),audioSha256:sha('d'),assetSha256s:[sha('e')],fontSha256s:[sha('f')],profile:{width:1920,height:1080,fps:24 as const},runtimeDigests:{media:sha('1'),voice:sha('2')},qualityPolicySha256:sha('3')},
 script:['上海的活动将在十月八日开始。'],facts:[{text:'活动在十月八日开始',source:'用户确认'}],criticalFacts:[{text:'活动在十月八日开始',source:'用户确认'}],summary:'活动预告',
 previewArtifactId:'00000000-0000-4000-8000-000000000003',previewArtifactSha256:sha('4'),
 excerptMap:preview.excerptMap,sourceDurationMs:45000,qualityEvidenceRefs:['projects/p/qa/a']
} satisfies PreviewBundleInput;
async function storedBundle(projects:ProjectStore,projectId:string){return seedPreviewBundle(projects,{projectId,previewArtifactSha256:previewSha,previewId:bundleInput.previewId,revisionId:bundleInput.revisionId,previewArtifactId:bundleInput.previewArtifactId})}
it('T11 seals the creative inputs, not the preview file or expiring display metadata',()=>{
 const first=createPreviewBundle(bundleInput,Date.parse('2026-10-02T00:00:00Z'));
 const replay=createPreviewBundle({...bundleInput,previewId:'00000000-0000-4000-8000-000000000004',previewArtifactId:'00000000-0000-4000-8000-000000000005',previewArtifactSha256:sha('5')},Date.parse('2026-10-03T00:00:00Z'));
 expect(first.bundleHash).toBe(replay.bundleHash);
 expect(first.expiresAt).toBe('2026-10-03T00:00:00.000Z');
 expect(verifyPreviewBundle(first)).toBe(true);
 expect(verifyPreviewBundle({...first,renderInputs:{...first.renderInputs,audioSha256:sha('9')}})).toBe(false);
 expect(verifyPreviewBundle({...first,script:['活动将在十月九日开始。']})).toBe(false);
 expect(verifyPreviewBundle({...first,previewArtifactSha256:sha('5')})).toBe(true);
 expect(()=>assertPreviewArtifact(first,sha('5'))).toThrow('PREVIEW_ARTIFACT_MISMATCH');
});
it('T11 rejects missing creative references and malformed excerpt mappings',()=>{
 expect(()=>createPreviewBundle({...bundleInput,renderInputs:{...bundleInput.renderInputs,sourceCodeSha256:''}})).toThrow('PREVIEW_BUNDLE_INVALID');
 expect(()=>createPreviewBundle({...bundleInput,excerptMap:[{...preview.excerptMap[0],sourceEndMs:2900}]})).toThrow('EXCERPT_INVALID');
});
it('T11 commits one immutable preview only for the live brief and production slot',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vb-preview-'));
 try{
  const projects=new ProjectStore(new FileStore(dir)),owner='owner';
  const {projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const operationId=randomUUID();
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:3,phase:'preparing_preview' as const,activeProduction:operationId}));
  const bundle=await storedBundle(projects,projectId),path=await storedPreviewArtifact(projects,dir,projectId,bundle);
  await seedPreviewOperation(projects,operationId,bundle);
  const changedInputs={...bundle.renderInputs,qualityPolicySha256:'0'.repeat(64)};
  const unboundPolicy={...bundle,renderInputs:changedInputs,bundleHash:canonicalHash({filmSpecSha256:bundle.filmSpecRef.sha256,scriptHash:bundle.scriptHash,factsHash:bundle.factsHash,...changedInputs})};
  await expect(commitPreviewBundle(projects,projectId,operationId,0,unboundPolicy,dir)).rejects.toThrow('PREVIEW_PACKAGE_INVALID');
  await expect(resolveArtifact(projects,owner,projectId,bundle.previewArtifactId)).rejects.toThrow('ACCESS_NOT_FOUND');
  const fakeRef={...bundle.filmSpecRef,sha256:sha('9')},forged={...bundle,filmSpecRef:fakeRef,bundleHash:canonicalHash({filmSpecSha256:fakeRef.sha256,scriptHash:bundle.scriptHash,factsHash:bundle.factsHash,...bundle.renderInputs})};
  await expect(commitPreviewBundle(projects,projectId,operationId,0,forged,dir)).rejects.toThrow('PREVIEW_PACKAGE_INVALID');
  const changedScript=['活动将在十月九日开始。'],changedScriptHash=canonicalHash(changedScript),forgedScript={...bundle,script:changedScript,scriptHash:changedScriptHash,bundleHash:canonicalHash({filmSpecSha256:bundle.filmSpecRef.sha256,scriptHash:changedScriptHash,factsHash:bundle.factsHash,...bundle.renderInputs})};
  await expect(commitPreviewBundle(projects,projectId,operationId,0,forgedScript,dir)).rejects.toThrow('PREVIEW_PACKAGE_INVALID');
  await expect(commitPreviewBundle(projects,projectId,operationId,0,{...bundle,excerptMap:[{...bundle.excerptMap[0],shotId:'missing'}]},dir)).rejects.toThrow('PREVIEW_PACKAGE_INVALID');
  await expect(commitPreviewBundle(projects,projectId,operationId,0,{...bundle,previewId:randomUUID()},dir)).rejects.toThrow('PREVIEW_OPERATION_CHANGED');
  await commitPreviewBundle(projects,projectId,operationId,0,bundle,dir);
  const published=await projects.access(owner,projectId);
  await expect(commitPreviewBundle(projects,projectId,operationId,0,bundle,dir)).resolves.toEqual(published);
  expect((await projects.access(owner,projectId)).controlVersion).toBe(published.controlVersion);
  await expect(commitPreviewBundle(projects,projectId,randomUUID(),0,bundle,dir)).rejects.toThrow('PREVIEW_STALE');
  expect((await resolveArtifact(projects,owner,projectId,bundle.previewArtifactId)).objectRef.sha256).toBe(previewSha);
  const control=(await projects.access(owner,projectId));
  expect(control).toMatchObject({phase:'preview_ready',previewState:'ready',currentPreviewId:bundle.previewId,activeProduction:null});
  expect(await readPreviewBundle(projects,projectId,bundle.previewId)).toEqual(bundle);
  expect((await projects.view(owner,projectId)).currentPreview).toMatchObject({previewId:bundle.previewId,bundleHash:bundle.bundleHash,script:bundle.script,state:'ready'});
  await expect(commitPreviewBundle(projects,projectId,operationId,0,{...bundle,summary:'changed'},dir)).rejects.toThrow('PREVIEW_PACKAGE_INVALID');
  await expect(commitPreviewBundle(projects,projectId,operationId,0,{...bundle,qualityEvidenceRefs:['different']},dir)).rejects.toThrow('PREVIEW_ID_CONFLICT');
  await writeFile(path,Buffer.alloc(previewBytes.length));
  await expect(commitPreviewBundle(projects,projectId,operationId,0,bundle,dir)).rejects.toThrow('PREVIEW_ARTIFACT_MISMATCH');
  const oldFilm=await projects.store.readFresh<{seed:number}>(bundle.filmSpecRef.key);
  await projects.store.cas(bundle.filmSpecRef.key,oldFilm.etag,{...oldFilm.value,seed:2});
  await expect(readPreviewBundle(projects,projectId,bundle.previewId)).rejects.toThrow('PREVIEW_PACKAGE_INVALID');
 }finally{await rm(dir,{recursive:true,force:true})}
});
it('T11 rejects a completed render after new input or cancellation fenced the slot',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vb-preview-'));
 try{
  const projects=new ProjectStore(new FileStore(dir)),owner='owner';
  const {projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const operationId=randomUUID(),bundle=await storedBundle(projects,projectId);
  await storedPreviewArtifact(projects,dir,projectId,bundle);
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:3,phase:'preparing_preview' as const,activeProduction:operationId,inputPending:true}));
  await expect(commitPreviewBundle(projects,projectId,operationId,0,bundle,dir)).rejects.toThrow('PREVIEW_STALE');
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,inputPending:false,consentEpoch:1,activeProduction:null}));
  await expect(commitPreviewBundle(projects,projectId,operationId,0,bundle,dir)).rejects.toThrow('PREVIEW_STALE');
  expect((await projects.access(owner,projectId)).currentPreviewId).toBeUndefined();
 }finally{await rm(dir,{recursive:true,force:true})}
});
it('T11 cannot expose a preview manifest without its private media object',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vb-preview-'));
 try{
  const projects=new ProjectStore(new FileStore(dir)),owner='owner';
  const {projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const operationId=randomUUID(),bundle=await storedBundle(projects,projectId);
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:3,phase:'preparing_preview' as const,activeProduction:operationId}));
  await expect(commitPreviewBundle(projects,projectId,operationId,0,bundle,dir)).rejects.toThrow('PREVIEW_ARTIFACT_MISMATCH');
  expect((await projects.access(owner,projectId)).currentPreviewId).toBeUndefined();
 }finally{await rm(dir,{recursive:true,force:true})}
});
it('AT-035 one preview button approval creates one durable render intent and replays',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vb-preview-'));
 try{
  const projects=new ProjectStore(new FileStore(dir)),queue=new LocalOperationQueue(projects.store,dir),owner='owner';
  const {projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const prepareId=randomUUID(),bundle=await storedBundle(projects,projectId);
  await storedPreviewArtifact(projects,dir,projectId,bundle);
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:3,phase:'preparing_preview' as const,activeProduction:prepareId}));
  await seedPreviewOperation(projects,prepareId,bundle);
  await commitPreviewBundle(projects,projectId,prepareId,0,bundle,dir);
  const request={schemaVersion:5 as const,clientCommandId:randomUUID(),previewId:bundle.previewId,revisionId:bundle.revisionId,expectedBriefVersion:3,bundleHash:bundle.bundleHash,scriptHash:bundle.scriptHash,factsHash:bundle.factsHash};
  await expect(approvePreview(projects,queue,owner,projectId,{...request,clientCommandId:randomUUID(),bundleHash:sha('9')})).rejects.toThrow('PREVIEW_STALE');
  const [a,b]=await Promise.all([approvePreview(projects,queue,owner,projectId,request),approvePreview(projects,queue,owner,projectId,request)]);
  expect(a.operationId).toBe(b.operationId);
  const control=await projects.access(owner,projectId);
  expect(control).toMatchObject({phase:'rendering',activeProduction:a.operationId});
  expect(control.receipts.filter(item=>item.commandId===request.clientCommandId)).toHaveLength(1);
  expect(await queue.pending()).toEqual([{projectId,operationId:a.operationId,kind:'render'}]);
  const approval=(await projects.store.readFresh<{source:string;bundleHash:string;ownerKeyHash:string}>(`projects/${projectId}/approvals/${control.currentApprovalId}`)).value;
  expect(approval).toMatchObject({source:'preview_button',bundleHash:bundle.bundleHash,ownerKeyHash:owner});
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,receipts:[]}));
  expect((await approvePreview(projects,queue,owner,projectId,request)).operationId).toBe(a.operationId);
 }finally{await rm(dir,{recursive:true,force:true})}
});
it('AT-082 rejects approval after preview expiry without silently refreshing the token',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vb-preview-'));
 try{
  const projects=new ProjectStore(new FileStore(dir)),queue=new LocalOperationQueue(projects.store,dir),owner='owner';
  const {projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const bundle=await seedPreviewBundle(projects,{projectId,previewArtifactSha256:previewSha,briefVersion:3,createdAt:Date.now()-2*86400000});
  await projects.store.create(`projects/${projectId}/previews/${bundle.previewId}/manifest`,bundle);
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:3,phase:'preview_ready' as const,previewState:'ready' as const,currentPreviewId:bundle.previewId,activeProduction:null}));
  const request={schemaVersion:5 as const,clientCommandId:randomUUID(),previewId:bundle.previewId,revisionId:bundle.revisionId,expectedBriefVersion:3,bundleHash:bundle.bundleHash,scriptHash:bundle.scriptHash,factsHash:bundle.factsHash};
  await expect(approvePreview(projects,queue,owner,projectId,request)).rejects.toThrow('PREVIEW_STALE');
  expect((await projects.access(owner,projectId)).phase).toBe('preview_ready');
  expect(await queue.pending()).toEqual([]);
 }finally{await rm(dir,{recursive:true,force:true})}
});
it('AT-035 two distinct approval commands cannot reserve two render slots',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vb-preview-'));
 try{
  const projects=new ProjectStore(new FileStore(dir)),queue=new LocalOperationQueue(projects.store,dir),owner='owner';
  const {projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const prepareId=randomUUID(),bundle=await storedBundle(projects,projectId);
  await storedPreviewArtifact(projects,dir,projectId,bundle);
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:3,phase:'preparing_preview' as const,activeProduction:prepareId}));
  await seedPreviewOperation(projects,prepareId,bundle);
  await commitPreviewBundle(projects,projectId,prepareId,0,bundle,dir);
  const body={schemaVersion:5 as const,previewId:bundle.previewId,revisionId:bundle.revisionId,expectedBriefVersion:3,bundleHash:bundle.bundleHash,scriptHash:bundle.scriptHash,factsHash:bundle.factsHash};
  const results=await Promise.allSettled([approvePreview(projects,queue,owner,projectId,{...body,clientCommandId:randomUUID()}),approvePreview(projects,queue,owner,projectId,{...body,clientCommandId:randomUUID()})]);
  expect(results.filter(item=>item.status==='fulfilled')).toHaveLength(1);
  expect(await queue.pending()).toHaveLength(1);
  expect((await projects.access(owner,projectId)).receipts.filter(item=>item.status==='accepted')).toHaveLength(1);
 }finally{await rm(dir,{recursive:true,force:true})}
});
