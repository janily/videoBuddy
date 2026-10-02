import{it,expect}from'vitest';
import{mkdtemp,rm}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{randomUUID}from'node:crypto';
import{mapPreviewTime,validateExcerptMap}from'@/services/video/preview/excerpt';
import{assertPreviewArtifact,createPreviewBundle,verifyPreviewBundle}from'@/services/video/preview/bundle';
import type{PreviewBundleInput}from'@/services/video/preview/bundle';
import{commitPreviewBundle,readPreviewBundle}from'@/services/video/preview/commit';
import{ProjectStore}from'@/services/video/storage/project-store';
import{FileStore}from'@/services/video/storage/file-store';
import{updateJson}from'@/services/video/storage/atomic-store';
import type{ProjectControl}from'@/contracts/video/project';
const preview={previewArtifactId:'artifact',revisionId:'revision',excerptMap:[{previewStartMs:0,previewEndMs:3000,sourceStartMs:0,sourceEndMs:3000,shotId:'one'},{previewStartMs:3000,previewEndMs:6000,sourceStartMs:18000,sourceEndMs:21000,shotId:'two'},{previewStartMs:6000,previewEndMs:9000,sourceStartMs:40000,sourceEndMs:43000,shotId:'three'}]};
it('AT-036 second preview segment maps to actual source time',()=>expect(mapPreviewTime(preview,4000)).toEqual({artifactId:'artifact',revisionId:'revision',previewTimeMs:4000,sourceTimeMs:19000}));
it('AT-081 unmapped transition time never receives a false source location',()=>{expect(mapPreviewTime(preview,-1)).toBeNull();expect(mapPreviewTime(preview,9000)).toBeNull()});
it('an excerpt is six to twelve seconds and source intervals retain equal duration',()=>{
 expect(validateExcerptMap(preview.excerptMap,45000)).toBe(9000);
 expect(()=>validateExcerptMap([{previewStartMs:0,previewEndMs:5000,sourceStartMs:0,sourceEndMs:4000,shotId:'bad'}],45000)).toThrow('EXCERPT_INVALID');
});
const sha=(letter:string)=>letter.repeat(64);
const bundleInput={
 previewId:'00000000-0000-4000-8000-000000000001',revisionId:'00000000-0000-4000-8000-000000000002',briefVersion:3,
 filmSpecRef:{key:'projects/p/revisions/r/film',sha256:sha('a'),bytes:500,mime:'application/json'},
 renderInputs:{sourceCodeSha256:sha('b'),timelineSha256:sha('c'),audioSha256:sha('d'),assetSha256s:[sha('e')],fontSha256s:[sha('f')],profile:{width:1920,height:1080,fps:24 as const},runtimeDigests:{media:sha('1'),voice:sha('2')},qualityPolicySha256:sha('3')},
 script:['上海的活动将在十月八日开始。'],facts:[{text:'活动在十月八日开始',source:'用户确认'}],criticalFacts:[{text:'活动在十月八日开始',source:'用户确认'}],summary:'活动预告',
 previewArtifactId:'00000000-0000-4000-8000-000000000003',previewArtifactSha256:sha('4'),
 excerptMap:preview.excerptMap,sourceDurationMs:45000,qualityEvidenceRefs:['projects/p/qa/a']
} satisfies PreviewBundleInput;
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
  const bundle=createPreviewBundle(bundleInput);
  await commitPreviewBundle(projects,projectId,operationId,0,bundle,sha('4'));
  const control=(await projects.access(owner,projectId));
  expect(control).toMatchObject({phase:'preview_ready',previewState:'ready',currentPreviewId:bundle.previewId,activeProduction:null});
  expect(await readPreviewBundle(projects,projectId,bundle.previewId)).toEqual(bundle);
  expect((await projects.view(owner,projectId)).currentPreview).toMatchObject({previewId:bundle.previewId,bundleHash:bundle.bundleHash,script:bundle.script,state:'ready'});
  await expect(commitPreviewBundle(projects,projectId,operationId,0,{...bundle,summary:'changed'},sha('4'))).rejects.toThrow('PREVIEW_ID_CONFLICT');
  await expect(commitPreviewBundle(projects,projectId,operationId,0,bundle,sha('5'))).rejects.toThrow('PREVIEW_ARTIFACT_MISMATCH');
 }finally{await rm(dir,{recursive:true,force:true})}
});
it('T11 rejects a completed render after new input or cancellation fenced the slot',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vb-preview-'));
 try{
  const projects=new ProjectStore(new FileStore(dir)),owner='owner';
  const {projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const operationId=randomUUID(),bundle=createPreviewBundle(bundleInput);
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:3,phase:'preparing_preview' as const,activeProduction:operationId,inputPending:true}));
  await expect(commitPreviewBundle(projects,projectId,operationId,0,bundle,sha('4'))).rejects.toThrow('PREVIEW_STALE');
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,inputPending:false,consentEpoch:1,activeProduction:null}));
  await expect(commitPreviewBundle(projects,projectId,operationId,0,bundle,sha('4'))).rejects.toThrow('PREVIEW_STALE');
  expect((await projects.access(owner,projectId)).currentPreviewId).toBeUndefined();
 }finally{await rm(dir,{recursive:true,force:true})}
});
