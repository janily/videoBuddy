import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
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
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'vb-approved-render-')),projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
 const bundle=await seedPreviewBundle(projects,{projectId,previewArtifactSha256:'7'.repeat(64)}),operationId=randomUUID(),approvalId=randomUUID(),commandId=randomUUID();
 await projects.store.create(`projects/${projectId}/previews/${bundle.previewId}/manifest`,bundle);
 const spec=(await projects.store.readFresh<{understandingRef:ProjectControl['understandingRef']}>(bundle.filmSpecRef.key)).value;
 const approval:ApprovalRecord={approvalId,projectId,previewId:bundle.previewId,revisionId:bundle.revisionId,bundleHash:bundle.bundleHash,scriptHash:bundle.scriptHash,factsHash:bundle.factsHash,briefVersion:bundle.briefVersion,clientCommandId:commandId,source:'preview_button',ownerKeyHash:'owner',approvedAt:new Date().toISOString(),consentEpoch:0};
 await projects.store.create(`projects/${projectId}/approvals/${approvalId}`,approval);
 await projects.store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,commandId,kind:'render',status:'running',canonicalRunId:operationId,streamEpoch:0,fence:0,approvalId,bundleHash:bundle.bundleHash,consentEpoch:0});
 await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:bundle.briefVersion,understandingRef:spec.understandingRef,phase:'rendering' as const,currentPreviewId:bundle.previewId,currentApprovalId:approvalId,activeProduction:operationId,previewState:'ready' as const}));
 const env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+'1'.repeat(64),VIDEO_MEDIA_RUNTIME_DIGEST:'1'.repeat(64),VIDEO_MEDIA_TIMEOUT_SECONDS:'600'};
 return{root,projects,projectId,operationId,bundle,approval,env};
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
it.each(['timeout','inspect'])('a %s failure stops the submitted handle and preserves the original error',async(mode)=>{
 const f=await setup();try{
  const now=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(now);let cancellations=0;
  const executor:MediaExecutor={submit:async job=>({containerName:'test',containerId:'test',stageKey:job.stageKey,runtimeDigest:job.runtimeDigest}),inspect:async()=>{if(mode==='inspect')throw Error('MEDIA_STATUS_UNKNOWN');clock.mockReturnValue(now+700000);return{status:'running',outputs:[]}},cancel:async()=>{cancellations++;throw Error('STOP_ACK_UNKNOWN')}};
  await expect(renderApprovedPictures(f.projects,'owner',f.projectId,f.operationId,0,{root:f.root,env:f.env,executor,pollMs:0})).rejects.toThrow(mode==='inspect'?'MEDIA_STATUS_UNKNOWN':'STAGE_UNKNOWN');
  expect(cancellations).toBe(1);
 }finally{vi.restoreAllMocks();await rm(f.root,{recursive:true,force:true})}
});
