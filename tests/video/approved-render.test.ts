import {it,expect,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import type {ApprovalRecord} from '@/services/video/preview/approve';
import {seedPreviewBundle} from './fixtures/preview-package';
import {loadApprovedRenderInputs,assertApprovedRenderFence} from '@/services/video/render/approved-inputs';
import {renderApprovedPictures} from '@/services/video/render/pictures';
import type {MediaExecutor} from '@/services/video/media/executor';
import {composeApprovedFilm} from '@/services/video/render/composition';
import type {technicalVideoQa} from '@/services/video/media/technical-qa';
import type {assemblePictureSequence} from '@/services/video/media/picture-sequence';
async function setup(assetKind?:'image/png'|'text/markdown'){
 const root=await mkdtemp(join(tmpdir(),'vb-approved-render-')),projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
 const assets=[];if(assetKind){const id=randomUUID(),data=assetKind==='text/markdown'?Buffer.from('# Source\n'):Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489','hex'),sha256=createHash('sha256').update(data).digest('hex');await mkdir(join(root,'assets',projectId),{recursive:true});await writeFile(join(root,'assets',projectId,id+'.bin'),data);const analysisRef=await projects.index.immutable(`projects/${projectId}/assets/${id}/analysis/${sha256}`,{assetId:id,sha256,mime:assetKind,trust:'untrusted_material'}),rightsRef=await projects.index.immutable(`projects/${projectId}/revisions/${randomUUID()}/rights`,{basis:'user_supplied',source:'protocol confirmed upload'});assets.push({id,analysisRef,rightsRef,originalRef:{key:`assets/${projectId}/${id}.bin`,sha256,bytes:data.length,mime:assetKind},usage:'Protocol source'});}
 const revisionId=assets.length?assets[0].rightsRef.key.split('/')[3]:undefined;
 const bundle=await seedPreviewBundle(projects,{projectId,revisionId,assets,visualAssetIds:assetKind==='image/png'?assets.map(a=>a.id):[],previewArtifactSha256:'7'.repeat(64)}),operationId=randomUUID(),approvalId=randomUUID(),commandId=randomUUID();
 await projects.store.create(`projects/${projectId}/previews/${bundle.previewId}/manifest`,bundle);
 const spec=(await projects.store.readFresh<{understandingRef:ProjectControl['understandingRef']}>(bundle.filmSpecRef.key)).value;
 const approval:ApprovalRecord={approvalId,projectId,previewId:bundle.previewId,revisionId:bundle.revisionId,bundleHash:bundle.bundleHash,scriptHash:bundle.scriptHash,factsHash:bundle.factsHash,briefVersion:bundle.briefVersion,clientCommandId:commandId,source:'preview_button',ownerKeyHash:'owner',approvedAt:new Date().toISOString(),consentEpoch:0};
 await projects.store.create(`projects/${projectId}/approvals/${approvalId}`,approval);
 await projects.store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,commandId,kind:'render',status:'running',canonicalRunId:operationId,streamEpoch:0,fence:0,approvalId,bundleHash:bundle.bundleHash,consentEpoch:0});
 await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:bundle.briefVersion,understandingRef:spec.understandingRef,phase:'rendering' as const,currentPreviewId:bundle.previewId,currentApprovalId:approvalId,activeProduction:operationId,previewState:'ready' as const}));
 const env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+'1'.repeat(64),VIDEO_MEDIA_RUNTIME_DIGEST:'1'.repeat(64),VIDEO_MEDIA_TIMEOUT_SECONDS:'600'};
 return{root,projects,projectId,operationId,bundle,approval,env,assets};
}
it('approved inputs compile full-size jobs from exactly the frozen source without model configuration',async()=>{
 const f=await setup();try{
  const inputs=await loadApprovedRenderInputs(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env});
  expect(inputs.jobs).toHaveLength(1);expect(inputs.jobs[0]).toMatchObject({bundleHash:f.bundle.bundleHash,outputWidth:1920,outputHeight:1080,startFrame:0,endFrame:1080});
  expect(inputs.jobs[0].sourceHtml).toContain('window.render');expect(inputs.frozen.treatment.script).toEqual(f.bundle.script);
  await assertApprovedRenderFence(f.projects,inputs);
  await updateJson(f.projects.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,consentEpoch:c.consentEpoch+1,activeProduction:null}));
  await expect(assertApprovedRenderFence(f.projects,inputs)).rejects.toThrow('RENDER_FENCED');
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('approved creation rejects replaced Understanding and a mismatched operation before execution',async()=>{
 const f=await setup();try{
  await updateJson(f.projects.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,understandingRef:{...c.understandingRef,sha256:'9'.repeat(64)}}));
  await expect(loadApprovedRenderInputs(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env})).rejects.toThrow('RENDER_FENCED');
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('formal composition refuses a missing frozen audio execution instead of generating fallback sound',async()=>{
 const f=await setup();try{
  await expect(composeApprovedFilm(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env})).rejects.toThrow('APPROVED_AUDIO_NOT_READY');
  await expect(f.projects.store.readFresh(`projects/${f.projectId}/approvals/${f.approval.approvalId}/composite-v2-stage`)).rejects.toThrow();
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('read-only approved rendering does not submit missing picture or composition stages',async()=>{
 const f=await setup();try{
  let submissions=0;const executor:MediaExecutor={submit:async()=>{submissions++;throw Error('UNEXPECTED_SUBMISSION')},inspect:async()=>{throw Error('UNEXPECTED_INSPECT')},cancel:async()=>({status:'cancelled'})};
  await expect(renderApprovedPictures(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env,executor,mustExist:true})).rejects.toThrow('RENDER_STAGE_MISSING');
  await expect(composeApprovedFilm(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env,mustExist:true})).rejects.toThrow('RENDER_STAGE_MISSING');expect(submissions).toBe(0);
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('cancellation during approved picture execution stops the actual executor handle and saves no stage',async()=>{
 const f=await setup();try{
  let submissions=0,cancellations=0;
  const executor:MediaExecutor={submit:async job=>{submissions++;return{containerName:'isolated-test',containerId:'test',stageKey:job.stageKey,runtimeDigest:job.runtimeDigest}},inspect:async()=>{
   await updateJson(f.projects.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,consentEpoch:c.consentEpoch+1,activeProduction:null}));return{status:'running',outputs:[]};
  },cancel:async()=>{cancellations++;return{status:'cancelled'}}};
  await expect(renderApprovedPictures(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env,executor,pollMs:0})).rejects.toThrow('RENDER_FENCED');
  expect(submissions).toBe(1);expect(cancellations).toBe(1);
  await expect(f.projects.store.readFresh(`projects/${f.projectId}/approvals/${f.approval.approvalId}/picture-stage`)).rejects.toThrow();
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it.each(['timeout','inspect'])('a %s failure preserves unknown physical stop instead of only the original error',async(mode)=>{
 const f=await setup();try{
  const now=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(now);let cancellations=0;
  const executor:MediaExecutor={submit:async job=>({containerName:'test',containerId:'test',stageKey:job.stageKey,runtimeDigest:job.runtimeDigest}),inspect:async()=>{if(mode==='inspect')throw Error('MEDIA_STATUS_UNKNOWN');clock.mockReturnValue(now+700000);return{status:'running',outputs:[]}},cancel:async()=>{cancellations++;throw Error('STOP_ACK_UNKNOWN')}};
  await expect(renderApprovedPictures(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env,executor,pollMs:0})).rejects.toThrow('MEDIA_STOP_UNKNOWN');
  expect(cancellations).toBe(1);
 }finally{vi.restoreAllMocks();await rm(f.root,{recursive:true,force:true})}
});
it('retains unknown when a submitted picture cancellation is still in progress',async()=>{
 const f=await setup();try{
  const executor:MediaExecutor={submit:async job=>({containerName:'test',containerId:'test',stageKey:job.stageKey,runtimeDigest:job.runtimeDigest}),inspect:async()=>{throw Error('MEDIA_STATUS_UNKNOWN')},cancel:async()=>({status:'cancelling'})};
  await expect(renderApprovedPictures(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env,executor})).rejects.toThrow('MEDIA_STOP_UNKNOWN');
 }finally{await rm(f.root,{recursive:true,force:true})}
});
it('binds picture assembly to the approved operation journal',async()=>{
 const f=await setup();try{
  const executor:MediaExecutor={submit:async job=>({containerName:'test',containerId:'test',stageKey:job.stageKey,runtimeDigest:job.runtimeDigest}),inspect:async()=>({status:'succeeded',outputs:['output/picture.mp4']}),cancel:async()=>({status:'cancelled'})};
  // Protocol-only producer/QA. This does not certify media or approve delivery.
  const technicalQa={result:'pass' as const,sha256:'a'.repeat(64),bytes:2048,width:1920,height:1080,durationSec:45,fps:24,frames:1080,audio:false};
  const qa=vi.fn<typeof technicalVideoQa>(async()=>technicalQa),assemble=vi.fn<typeof assemblePictureSequence>(async(_root,_input,_env,options)=>{if(!options?.journal)throw Error('MEDIA_JOURNAL_CONTEXT_MISSING');await options.assertActive?.();return{totalFrames:1080,stageKey:'b'.repeat(64),outputPath:join(f.root,'picture-sequence','fixture','output','picture.mp4'),technicalQa}});
  await renderApprovedPictures(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env,executor,qa,assemble});
  expect(assemble.mock.calls[0][3]?.journal).toEqual({store:f.projects.store,prefix:`projects/${f.projectId}/operations/${f.operationId}/media-effects`});
 }finally{await rm(f.root,{recursive:true,force:true})}
});

it.each(['image/png','text/markdown'] as const)('uses only frozen picture resources while allowing %s as a source',async(kind)=>{
 const f=await setup(kind);try{const inputs=await loadApprovedRenderInputs(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env});expect(inputs.frozen.assetManifest.assets).toHaveLength(1);if(kind==='image/png')expect(inputs.jobs[0].assets).toEqual(f.assets.map(a=>({id:a.id,mime:a.originalRef.mime,sha256:a.originalRef.sha256,bytes:a.originalRef.bytes})));else expect(inputs.jobs[0].assets||[]).toEqual([]);await writeFile(join(f.root,'assets',f.projectId,f.assets[0].id+'.bin'),Buffer.from('changed'));await expect(loadApprovedRenderInputs(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env})).rejects.toThrow('PREVIEW_PACKAGE_INVALID')}finally{await rm(f.root,{recursive:true,force:true})}
});
