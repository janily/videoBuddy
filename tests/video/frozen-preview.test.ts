import {expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {ObjectRef} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import {LocalOperationQueue} from '@/services/video/commands/local-queue';
import {canonicalHash} from '@/services/video/domain/hash';
import {preparePreview,type PreviewOperation} from '@/services/video/preview/prepare';
import {FrozenPreviewSchema,readFrozenPreview} from '@/services/video/preview/frozen-preview';
import {seedPreviewBundle} from './fixtures/preview-package';
async function fixture(root:string){
 const store=new FileStore(root),projects=new ProjectStore(store),owner='owner',queue=new LocalOperationQueue(store,root),{projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),prefix=`projects/${projectId}`;
 const bundle=await seedPreviewBundle(projects,{projectId,briefVersion:1,durationSec:20,previewArtifactSha256:'a'.repeat(64)}),spec=(await store.readFresh<{treatmentRef:ObjectRef;audioManifestRef:ObjectRef;sourceManifestRef:ObjectRef;understandingRef:ObjectRef}>(bundle.filmSpecRef.key)).value;
 const treatment=(await store.readFresh<{planRef:ObjectRef}>(spec.treatmentRef.key)).value,audio=(await store.readFresh<{planRef:ObjectRef}>(spec.audioManifestRef.key)).value,sources=(await store.readFresh<{modules:Array<{sourceRef:ObjectRef}>}>(spec.sourceManifestRef.key)).value,code=(await store.readFresh<{visualSourceRef:ObjectRef}>(sources.modules[0].sourceRef.key)).value;
 await store.create(prefix+`/revisions/${bundle.revisionId}/film-package-v2-stage`,{schemaVersion:2,briefVersion:1,filmSpecRef:bundle.filmSpecRef});
 const source:PreviewOperation&{stage:string;errorCode:string}={id:randomUUID(),projectId,commandId:randomUUID(),kind:'preview',status:'failed',canonicalRunId:null,streamEpoch:0,fence:0,revisionId:bundle.revisionId,previewId:bundle.previewId,briefVersion:1,consentEpoch:0,understandingRef:spec.understandingRef,stage:'composition',errorCode:'QA_FAILED'};
 await store.create(prefix+'/operations/'+source.id,source);
 await store.create(prefix+`/operations/${source.id}/effects/audio/${source.revisionId}`,{status:'completed',attemptId:randomUUID(),output:(await store.readFresh(audio.planRef.key)).value});
 const visualKey=prefix+`/operations/${source.id}/effects/visual/${source.revisionId}/${canonicalHash({shotId:'shot'})}`;await store.create(visualKey,{status:'completed',attemptId:randomUUID(),output:(await store.readFresh(code.visualSourceRef.key)).value});
 await updateJson(store,prefix+'/control',(c:ProjectControl)=>({...c,briefVersion:1,understandingRef:spec.understandingRef,phase:'attention' as const,activeProduction:null}));
 const dir=join(root,'composition','fixture');await mkdir(dir,{recursive:true});const bytes=Buffer.alloc(2048,1),outputPath=join(dir,'final.mp4');await writeFile(outputPath,bytes);
 // Synthetic container tests hash/admission; it does not claim real media QA.
 const frozenPreview={sourceOperationId:source.id,treatmentRef:treatment.planRef,filmSpecRef:bundle.filmSpecRef,film:{outputPath,sha256:createHash('sha256').update(bytes).digest('hex'),durationMs:20000,technicalQa:'pass' as const}};
 return{root,store,projects,owner,queue,projectId,prefix,source,visualKey,frozenPreview,request:{schemaVersion:5 as const,clientCommandId:randomUUID(),expectedBriefVersion:1}};
}
it('uses a new operation with the same exact creative revision and an immutable replay intent',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-frozen-preview-'));try{
 const f=await fixture(root),receipt=await preparePreview(f.projects,f.queue,f.owner,f.projectId,f.request,{root,frozenPreview:f.frozenPreview}),next=(await f.store.readFresh<PreviewOperation>(f.prefix+'/operations/'+receipt.operationId)).value;
 expect(next.id).not.toBe(f.source.id);expect(next.revisionId).toBe(f.source.revisionId);expect(next.previewId).not.toBe(f.source.previewId);
 expect(await preparePreview(f.projects,f.queue,f.owner,f.projectId,f.request,{root,frozenPreview:f.frozenPreview})).toMatchObject({operationId:next.id,status:'replayed'});
 expect(await readFrozenPreview(new ProjectStore(new FileStore(root)),root,f.projectId,next.id,next.revisionId,0)).toEqual(f.frozenPreview);
 expect((await f.store.readFresh(f.prefix+'/operations/'+f.source.id)).value).toEqual(f.source);
 }finally{await rm(root,{recursive:true,force:true})}
});
it('refuses unknown creative effects and stale consent before activating a technical attempt',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-frozen-unknown-'));try{
 const f=await fixture(root),before=await f.projects.access(f.owner,f.projectId),effect=await f.store.readFresh<Record<string,unknown>>(f.visualKey);await f.store.cas(f.visualKey,effect.etag,{...effect.value,status:'started'});
 await expect(preparePreview(f.projects,f.queue,f.owner,f.projectId,f.request,{root,frozenPreview:f.frozenPreview})).rejects.toThrow('FROZEN_PREVIEW_EFFECT_UNKNOWN');expect(await f.projects.access(f.owner,f.projectId)).toEqual(before);
 await f.store.cas(f.visualKey,(await f.store.readFresh(f.visualKey)).etag,effect.value);await updateJson(f.store,f.prefix+'/control',(c:ProjectControl)=>({...c,consentEpoch:1}));
 await expect(preparePreview(f.projects,f.queue,f.owner,f.projectId,f.request,{root,frozenPreview:f.frozenPreview})).rejects.toThrow('FROZEN_PREVIEW_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('cold retry never falls back to creation after its command or film is lost',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-frozen-command-'));try{
 const f=await fixture(root),receipt=await preparePreview(f.projects,f.queue,f.owner,f.projectId,f.request,{root,frozenPreview:f.frozenPreview}),next=(await f.store.readFresh<PreviewOperation>(f.prefix+'/operations/'+receipt.operationId)).value;
 const key=f.prefix+'/commands/'+f.request.clientCommandId,command=(await f.store.readFresh<Record<string,unknown>>(key)).value;await rm(f.store.path(key));
 await expect(readFrozenPreview(f.projects,root,f.projectId,next.id,next.revisionId,0)).rejects.toThrow('FROZEN_PREVIEW_CHANGED');
 await f.store.create(key,command);await writeFile(f.frozenPreview.film.outputPath,Buffer.alloc(2048,2));
 await expect(readFrozenPreview(f.projects,root,f.projectId,next.id,next.revisionId,0)).rejects.toThrow('POSTMIX_SOURCE_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});

it('rejects competing review authorities and whole postmix evidence on a non-narrated film before activation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-frozen-group-'));try{
  const f=await fixture(root),ref={key:f.prefix+'/postmix-verifications/'+('b'.repeat(64)),sha256:'b'.repeat(64),bytes:100,mime:'application/json'};
  expect(FrozenPreviewSchema.safeParse({...f.frozenPreview,reviewRef:ref,postMixVerificationRef:ref}).success).toBe(false);
  const before=await f.projects.access(f.owner,f.projectId);
  await expect(preparePreview(f.projects,f.queue,f.owner,f.projectId,f.request,{root,frozenPreview:{...f.frozenPreview,postMixVerificationRef:ref}})).rejects.toThrow('FROZEN_PREVIEW_CHANGED');
  expect(await f.projects.access(f.owner,f.projectId)).toEqual(before);
 }finally{await rm(root,{recursive:true,force:true})}
});
