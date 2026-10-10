import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import {migrateQuickOnly} from '@/services/video/storage/migrate-quick-only';
import type {ProjectControl} from '@/contracts/video/project';
it('previews legacy approval migration without writes, then applies once and preserves archive refs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-migrate-'));try{
 const store=new FileStore(root),projects=new ProjectStore(store),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
 const before=await updateJson(store,`projects/${projectId}/control`,(c:Omit<ProjectControl,'phase'|'unresolvedMediaStops'>&{phase:string;unresolvedMediaStops?:Record<string,string>})=>({...c,phase:'preview_ready',currentPreviewId:randomUUID(),currentApprovalId:randomUUID(),previewState:'ready',reviewPolicy:'preview_first'}));
 const dry=await migrateQuickOnly(projects);expect(dry).toMatchObject([{projectId,status:'would_migrate'}]);expect((await store.readFresh(`projects/${projectId}/control`)).value).toEqual(before);
 expect(await migrateQuickOnly(projects,{apply:true})).toMatchObject([{projectId,status:'migrated'}]);
 const after=await projects.access('owner',projectId);expect(after).toMatchObject({phase:'collecting',messagesIndexRef:before.messagesIndexRef,ownerKeyHash:'owner',legacyMigrationNotice:expect.any(String)});expect(after).not.toHaveProperty('currentPreviewId');expect(after).not.toHaveProperty('currentApprovalId');
 expect(await migrateQuickOnly(projects,{apply:true})).toMatchObject([{projectId,status:'unchanged'}]);expect((await projects.access('owner',projectId)).controlVersion).toBe(after.controlVersion);
 }finally{await rm(root,{recursive:true,force:true})}
});
it('never clears a live producer or an unresolved physical stop',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-migrate-busy-'));try{
 const projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
 const before=await updateJson(projects.store,`projects/${projectId}/control`,(c:Omit<ProjectControl,'phase'|'unresolvedMediaStops'>&{phase:string;unresolvedMediaStops?:Record<string,string>})=>({...c,phase:'preview_ready',activeProduction:randomUUID(),unresolvedMediaStops:{[randomUUID()]:'render'}}));
 expect(await migrateQuickOnly(projects,{apply:true})).toMatchObject([{projectId,status:'blocked'}]);expect((await projects.store.readFresh(`projects/${projectId}/control`)).value).toEqual(before);
 }finally{await rm(root,{recursive:true,force:true})}
});
it.each(['unstarted','confirmed'])('migrates a legacy project with a proven stopped historical cancellation (%s)',async kind=>{
 const root=await mkdtemp(join(tmpdir(),'vb-migrate-cancel-'));try{
  const store=new FileStore(root),projects=new ProjectStore(store),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),id=randomUUID(),key=`projects/${projectId}/operations/${id}`;
  await store.create(key,{id,projectId,status:'cancelled',canonicalRunId:kind==='unstarted'?null:randomUUID(),mediaAttemptStarted:kind!=='unstarted'});
  if(kind==='confirmed')await store.create(key+'/media-stop-proof',{schemaVersion:1,projectId,operationId:id,stopped:true});
  await updateJson(store,`projects/${projectId}/control`,(c:Omit<ProjectControl,'phase'>&{phase:string})=>({...c,phase:'preview_ready',cancelRequestedProductionId:id}));
  expect(await migrateQuickOnly(projects)).toMatchObject([{projectId,status:'would_migrate'}]);expect(await migrateQuickOnly(projects,{apply:true})).toMatchObject([{projectId,status:'migrated'}]);expect((await projects.access('owner',projectId)).phase).toBe('collecting');
 }finally{await rm(root,{recursive:true,force:true})}
});
it.each(['running','interrupted','missing','foreign-proof'])('does not infer stopped from a historical cancellation with %s evidence',async evidence=>{
 const root=await mkdtemp(join(tmpdir(),'vb-migrate-unknown-'));try{
  const store=new FileStore(root),projects=new ProjectStore(store),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),id=randomUUID(),key=`projects/${projectId}/operations/${id}`;
  if(evidence!=='missing')await store.create(key,{id,projectId,status:evidence==='foreign-proof'?'cancelled':evidence,canonicalRunId:randomUUID(),mediaAttemptStarted:true});
  if(evidence==='foreign-proof')await store.create(key+'/media-stop-proof',{schemaVersion:1,projectId,operationId:randomUUID(),stopped:true});
  await updateJson(store,`projects/${projectId}/control`,(c:Omit<ProjectControl,'phase'>&{phase:string})=>({...c,phase:'preview_ready',cancelRequestedProductionId:id}));
  expect(await migrateQuickOnly(projects,{apply:true})).toMatchObject([{projectId,status:'blocked'}]);
 }finally{await rm(root,{recursive:true,force:true})}
});
