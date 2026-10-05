import {protocolContentVerifier} from './fixtures/protocol-content';
import{it,expect}from'vitest';
import{canonicalHash}from'@/services/video/domain/hash';
import{validateDelivery}from'@/services/video/quality/delivery';
import type{DeliveryPolicy}from'@/services/video/quality/delivery';
import type{QualityCheck}from'@/services/video/quality/publish-gate';
import{mkdtemp,mkdir,rm,writeFile}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{createHash,randomUUID}from'node:crypto';
import{FileStore}from'@/services/video/storage/file-store';
import{ProjectStore}from'@/services/video/storage/project-store';
import{LocalOperationQueue}from'@/services/video/commands/local-queue';
import{updateJson}from'@/services/video/storage/atomic-store';
import{seedPreviewBundle,seedPreviewOperation}from'./fixtures/preview-package';
import{commitPreviewBundle}from'@/services/video/preview/commit';
import{approvePreview}from'@/services/video/preview/approve';
import{publishResult}from'@/services/video/results/publish';
import type{ProjectControl}from'@/contracts/video/project';
import{cancelProduction}from'@/services/video/commands/cancel';
import{resolveArtifact}from'@/services/video/exports/access';

const evidence=(ruleId:string):QualityCheck=>({ruleId,result:'pass',severity:'blocking',evidenceRefs:[`qa/${ruleId}/actual`]});
const baseline=['decode','media_metadata','duration','file_hash','source_integrity','resource_ready','license','critical_facts','visual_review','listening_review','loudness','true_peak','subtitle_sync','font_coverage'];
const policy:DeliveryPolicy={schemaVersion:1,audioIntent:'voiced',captions:true,requiredRules:baseline};
const expected='a'.repeat(64),checks=baseline.map(evidence);
it('AT-038/083/084 rejects missing evidence, wrong media hash, unchecked hearing and license',()=>{
 const input={policy,expectedPolicySha256:canonicalHash(policy),expectedFileSha256:expected,actualFileSha256:expected,checks};
 expect(validateDelivery(input).status).toBe('passed');
 expect(()=>validateDelivery({...input,actualFileSha256:'b'.repeat(64)})).toThrow('QUALITY_BLOCKED');
 expect(()=>validateDelivery({...input,expectedPolicySha256:'c'.repeat(64)})).toThrow('QUALITY_BLOCKED');
 expect(()=>validateDelivery({...input,checks:checks.map(c=>c.ruleId==='listening_review'?{...c,result:'not_checked' as const,evidenceRefs:[]}:c)})).toThrow('QUALITY_BLOCKED');
 expect(()=>validateDelivery({...input,checks:checks.map(c=>c.ruleId==='license'?{...c,result:'not_checked' as const,evidenceRefs:[]}:c)})).toThrow('QUALITY_BLOCKED');
 expect(()=>validateDelivery({...input,policy:{...policy,requiredRules:['decode']}})).toThrow('QUALITY_BLOCKED');
});
it('actual measured silence permits sound N/A, while missing proof or omitted captions do not',()=>{
 const silentPolicy:DeliveryPolicy={schemaVersion:1,audioIntent:'silent',captions:false,requiredRules:baseline};
 const silentChecks=checks.map(c=>['listening_review','loudness','true_peak','subtitle_sync'].includes(c.ruleId)?{...c,result:'not_applicable' as const,evidenceRefs:[],reason:'measured silence/no captions'}:c);
 const input={policy:silentPolicy,expectedPolicySha256:canonicalHash(silentPolicy),expectedFileSha256:expected,actualFileSha256:expected,checks:[...silentChecks,evidence('decoded_silence')]};
 expect(validateDelivery(input).status).toBe('passed');
 expect(()=>validateDelivery({...input,checks:silentChecks})).toThrow('QUALITY_BLOCKED');
 expect(()=>validateDelivery({...input,policy:{...silentPolicy,audioIntent:'voiced' as const}})).toThrow('QUALITY_BLOCKED');
});
async function preparedRender(){
 const dir=await mkdtemp(join(tmpdir(),'vb-publish-'));
  const projects=new ProjectStore(new FileStore(dir)),queue=new LocalOperationQueue(projects.store,dir),owner='owner';
  const {projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const prepareId=randomUUID();
  const previewMedia=Buffer.alloc(100);previewMedia.write('ftyp',4);const previewSha=createHash('sha256').update(previewMedia).digest('hex');
  const bundle=await seedPreviewBundle(projects,{projectId,briefVersion:1,durationSec:20,script:['真实创作内容'],factTexts:[],summary:'预览',previewArtifactSha256:previewSha});
  const previewKey=`projects/${projectId}/artifacts/${bundle.previewArtifactId}/files/preview.mp4`;
  await mkdir(join(dir,'objects',`projects/${projectId}/artifacts/${bundle.previewArtifactId}/files`),{recursive:true});await writeFile(join(dir,'objects',previewKey),previewMedia);
  await projects.store.create(`projects/${projectId}/artifacts/${bundle.previewArtifactId}/manifest`,{id:bundle.previewArtifactId,revisionId:bundle.revisionId,objectRef:{key:previewKey,sha256:previewSha,bytes:previewMedia.length,mime:'video/mp4'},qaPassed:true,uploaded:true,filename:'preview.mp4'});
  await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:1,phase:'preparing_preview' as const,activeProduction:prepareId}));
  await seedPreviewOperation(projects,prepareId,bundle);
  await commitPreviewBundle(projects,projectId,prepareId,0,bundle,dir);
  const request={schemaVersion:5 as const,clientCommandId:randomUUID(),previewId:bundle.previewId,revisionId:bundle.revisionId,expectedBriefVersion:1,bundleHash:bundle.bundleHash,scriptHash:bundle.scriptHash,factsHash:bundle.factsHash};
  const approved=await approvePreview(projects,queue,owner,projectId,request),approvalId=(await projects.access(owner,projectId)).currentApprovalId!;
  await updateJson(projects.store,`projects/${projectId}/operations/${approved.operationId}`,(op:{status:string;fence:number})=>({...op,status:'running'}));
  const artifactId=randomUUID(),resultId=randomUUID();
  const media=Buffer.alloc(100);media.write('ftyp',4);const actualSha=createHash('sha256').update(media).digest('hex');
  const objectKey=`projects/${projectId}/artifacts/${artifactId}/files/final.mp4`;
  await mkdir(join(dir,'objects',`projects/${projectId}/artifacts/${artifactId}/files`),{recursive:true});await writeFile(join(dir,'objects',objectKey),media);
  await projects.store.create(`projects/${projectId}/artifacts/${artifactId}/manifest`,{id:artifactId,revisionId:bundle.revisionId,objectRef:{key:objectKey,sha256:actualSha,bytes:media.length,mime:'video/mp4'},qaPassed:true,uploaded:true,filename:'final.mp4'});
  const result={resultId,artifactId,revisionId:bundle.revisionId,previewId:bundle.previewId,approvalId,bundleHash:bundle.bundleHash,mp4Sha256:actualSha,mp4Bytes:media.length,qualityPolicy:{...policy,audioIntent:'silent' as const,captions:false},qualityChecks:[...checks,evidence('decoded_silence'),{...evidence('content_coverage'),evidenceRefs:[`projects/${projectId}/approvals/${approvalId}/content-review-v1-stage`]}],createdAt:new Date().toISOString()};
  return{dir,projects,owner,projectId,approved,result,media,objectKey,verifyContent:protocolContentVerifier(actualSha,bundle.filmSpecRef.sha256)};
}
it('AT-037/039 publishes only the approved bundle and rejects a late result after cancellation',async()=>{
 const{dir,projects,owner,projectId,approved,result}=await preparedRender();
 try{
  await expect(publishResult(projects,owner,projectId,approved.operationId!,0,{...result,bundleHash:'9'.repeat(64)},dir)).rejects.toThrow('PREVIEW_STALE');
  expect(await cancelProduction(projects.store,projectId,approved.operationId!)).toBe('cancelling');
  await expect(publishResult(projects,owner,projectId,approved.operationId!,0,result,dir)).rejects.toThrow('PUBLISH_FENCED');
  expect((await projects.access(owner,projectId)).currentResultId).toBeUndefined();
 }finally{await rm(dir,{recursive:true,force:true})}
});
it('a matching approved result becomes the current immutable result only after file bytes and QA match',async()=>{
 const{dir,projects,owner,projectId,approved,result,media,objectKey,verifyContent}=await preparedRender();
 try{
  const path=join(dir,'objects',objectKey);
  await expect(resolveArtifact(projects,owner,projectId,result.artifactId)).rejects.toThrow('ACCESS_NOT_FOUND');
  await writeFile(path,Buffer.alloc(media.length,1));
  await expect(publishResult(projects,owner,projectId,approved.operationId!,0,result,dir)).rejects.toThrow('QUALITY_BLOCKED');
  await writeFile(path,media);
  const view=await publishResult(projects,owner,projectId,approved.operationId!,0,result,dir,{verifyContent});
  expect(view).toMatchObject({phase:'ready',currentResult:{resultId:result.resultId,artifactId:result.artifactId,bundleHash:result.bundleHash}});
  expect((await resolveArtifact(projects,owner,projectId,result.artifactId)).objectRef.sha256).toBe(result.mp4Sha256);
  expect((await projects.access(owner,projectId)).currentResultId).toBe(result.resultId);
  expect((await publishResult(projects,owner,projectId,approved.operationId!,0,result,dir)).currentResult?.resultId).toBe(result.resultId);
 }finally{await rm(dir,{recursive:true,force:true})}
});
it('blocks new publication when content coverage is absent, belongs to another film, or names a foreign stage',async()=>{
 const{dir,projects,owner,projectId,approved,result,verifyContent}=await preparedRender();try{
  const publish=(value:typeof result,verify=verifyContent)=>publishResult(projects,owner,projectId,approved.operationId!,0,value,dir,{verifyContent:verify});
  await expect(publish({...result,qualityChecks:result.qualityChecks.filter(c=>c.ruleId!=='content_coverage')})).rejects.toThrow('QUALITY_BLOCKED');
  await expect(publish(result,async(...args)=>{const proof=await verifyContent(...args);return{...proof,report:{...proof.report,filmSha256:'f'.repeat(64)}}})).rejects.toThrow('QUALITY_BLOCKED');
  await expect(publish({...result,qualityChecks:result.qualityChecks.map(c=>c.ruleId==='content_coverage'?{...c,evidenceRefs:['foreign/content-stage']}:c)})).rejects.toThrow('QUALITY_BLOCKED');
  await expect(publish(result,async()=>{throw Error('CONTENT_REVIEW_MISSING')})).rejects.toThrow('CONTENT_REVIEW_MISSING');
  expect((await projects.access(owner,projectId)).currentResultId).toBeUndefined();
 }finally{await rm(dir,{recursive:true,force:true})}
});
it('requires measured loudness and listening for music without narration',()=>{
 const musical:DeliveryPolicy={...policy,audioIntent:'music',captions:false};
 const baseChecks=checks.map(c=>c.ruleId==='subtitle_sync'?{...c,result:'not_applicable' as const,reason:'no captions'}:c);
 const input={policy:musical,expectedPolicySha256:canonicalHash(musical),expectedFileSha256:expected,actualFileSha256:expected,checks:baseChecks};
 expect(validateDelivery(input).status).toBe('passed');
 for(const rule of ['listening_review','loudness','true_peak']){
  expect(()=>validateDelivery({...input,checks:baseChecks.map(c=>c.ruleId===rule?{...c,result:'not_applicable' as const,reason:'no narrator'}:c)})).toThrow('QUALITY_BLOCKED');
 }
});
