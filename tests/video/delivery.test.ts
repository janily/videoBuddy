import{it,expect}from'vitest';
import{validateArchiveEntries,assertArtifactAccess}from'@/services/video/exports/export';
import{mkdtemp,mkdir,rm,writeFile}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{createHash,randomUUID}from'node:crypto';
import{FileStore}from'@/services/video/storage/file-store';
import{ProjectStore}from'@/services/video/storage/project-store';
import{updateJson}from'@/services/video/storage/atomic-store';
import{restoreResult}from'@/services/video/results/restore';
import type{ProjectControl}from'@/contracts/video/project';
import{mandatoryDeliveryRules}from'@/services/video/quality/delivery';
it.each(['.env.local','fonts/private.ttf','weights/model.onnx','cache/model.safetensors','../other/file','tmp/signed-url.txt'])('AT-044 excludes credentials, fonts, weights and temporary data: %s',path=>expect(()=>validateArchiveEntries([{path,bytes:100,symlink:false,hardlinks:1}],[])).toThrow('ARCHIVE_INVALID'));
it('allowlisted source files can be included without claiming missing files exist',()=>{
 expect(validateArchiveEntries([{path:'source/scene.js',bytes:100,symlink:false,hardlinks:1}],['source/scene.js'])).toEqual(['source/scene.js']);
});
it('AT-089 tombstones and unvalidated media cannot acquire new signed download access',()=>{
 expect(()=>assertArtifactAccess({deletedAt:'now'}, {qaPassed:true,uploaded:true,mime:'video/mp4'})).toThrow('ACCESS_NOT_FOUND');
 expect(()=>assertArtifactAccess({}, {qaPassed:false,uploaded:true,mime:'video/mp4'})).toThrow('QUALITY_BLOCKED');
});
it('AT-087 restores the previous approved result by pointer, with one effect per command',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vb-restore-'));
 try{
  const projects=new ProjectStore(new FileStore(dir)),owner='owner';
  const {projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const a={resultId:randomUUID(),artifactId:randomUUID(),revisionId:randomUUID()},b={resultId:randomUUID(),artifactId:randomUUID(),revisionId:randomUUID()};
  for(const item of[a,b]){
   const bytes=Buffer.from('ftyp previous media bytes '+item.resultId),sha=createHash('sha256').update(bytes).digest('hex'),key=`projects/${projectId}/artifacts/${item.artifactId}/files/final.mp4`;
   await mkdir(join(dir,'objects',`projects/${projectId}/artifacts/${item.artifactId}/files`),{recursive:true});await writeFile(join(dir,'objects',key),bytes);
   await projects.store.create(`projects/${projectId}/artifacts/${item.artifactId}/manifest`,{id:item.artifactId,revisionId:item.revisionId,objectRef:{key,sha256:sha,bytes:bytes.length,mime:'video/mp4'},qaPassed:true,uploaded:true,filename:'final.mp4'});
   await projects.store.create(`projects/${projectId}/results/${item.resultId}/manifest`,{resultId:item.resultId,artifactId:item.artifactId,revisionId:item.revisionId,previewId:randomUUID(),approvalId:randomUUID(),bundleHash:'a'.repeat(64),mp4Sha256:sha,mp4Bytes:bytes.length,qualityPolicy:{schemaVersion:1,audioIntent:'voiced',captions:true,requiredRules:[...mandatoryDeliveryRules]},qualityChecks:mandatoryDeliveryRules.map(ruleId=>({ruleId,result:'pass',severity:'blocking',evidenceRefs:['old-qa']})),createdAt:new Date().toISOString()});
  }
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,phase:'ready' as const,currentResultId:b.resultId,previousResultId:a.resultId}));
  const request={schemaVersion:5 as const,clientCommandId:randomUUID()};
  await expect(restoreResult(projects,owner,projectId,randomUUID(),{schemaVersion:5,clientCommandId:randomUUID()},dir)).rejects.toThrow('RESULT_STALE');
  const restored=await restoreResult(projects,owner,projectId,a.artifactId,request,dir);
  expect(restored).toMatchObject({currentResult:{resultId:a.resultId,artifactId:a.artifactId},previousResult:{resultId:b.resultId}});
  expect((await restoreResult(projects,owner,projectId,a.artifactId,request,dir)).currentResult?.resultId).toBe(a.resultId);
  expect((await projects.access(owner,projectId)).consentEpoch).toBe(1);
  await writeFile(join(dir,'objects',`projects/${projectId}/artifacts/${b.artifactId}/files/final.mp4`),Buffer.alloc(Buffer.byteLength('ftyp previous media bytes '+b.resultId)));
  await expect(restoreResult(projects,owner,projectId,b.artifactId,{schemaVersion:5,clientCommandId:randomUUID()},dir)).rejects.toThrow('ARTIFACT_INVALID');
  expect((await projects.access(owner,projectId)).currentResultId).toBe(a.resultId);
 }finally{await rm(dir,{recursive:true,force:true})}
});
