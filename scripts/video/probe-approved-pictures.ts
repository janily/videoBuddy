import {mkdtemp,cp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {LocalOperationQueue} from '../../src/services/video/commands/local-queue';
import {approvePreview} from '../../src/services/video/preview/approve';
import {claimOperation} from '../../src/services/video/commands/claim';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {loadApprovedRenderInputs} from '../../src/services/video/render/approved-inputs';
import {renderApprovedPictures} from '../../src/services/video/render/pictures';
async function main(){
 if(process.argv.includes('--replay')){
  const proof=JSON.parse(await readFile('docs/engineering/evidence/approved-pictures-probe.json','utf8')),mediaDigest=proof.record.shots[0].technicalQa? '75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919':'';
  globalThis.fetch=async()=>{throw Error('APPROVED_RENDER_NETWORK_FORBIDDEN')};
  const record=await renderApprovedPictures(new ProjectStore(new FileStore(proof.root)),(await new FileStore(proof.root).readFresh<{ownerKeyHash:string}>(`projects/${proof.projectId}/control`)).value.ownerKeyHash,proof.projectId,proof.operationId,0,{root:proof.root,env:{VIDEO_MEDIA_IMAGE_REF:'sha256:'+mediaDigest,VIDEO_MEDIA_RUNTIME_DIGEST:mediaDigest,VIDEO_MEDIA_TIMEOUT_SECONDS:'600'}});
  if(canonicalHash(record)!==canonicalHash(proof.record))throw Error('APPROVED_RENDER_REPLAY_CHANGED');
  await writeFile('docs/engineering/evidence/approved-pictures-probe.json',JSON.stringify({...proof,coldReplayExecutedAt:new Date().toISOString()},null,2)+'\n');console.log(JSON.stringify({status:'pass',coldReplay:true,additionalModelCalls:0,technicalQa:record.sequence.technicalQa}));return;
 }
 if(!process.argv.includes('--render'))throw Error('APPROVED_PICTURE_OPT_IN_REQUIRED');
 const evidence=JSON.parse(await readFile('docs/engineering/evidence/preview-publication-probe.json','utf8'));
 const root=await mkdtemp(join(resolve('.video-local'),'approved-pictures-'));
 await cp(join(evidence.stateRoot,'projects'),join(root,'projects'),{recursive:true});
 await cp(join(evidence.mediaRoot,'objects'),join(root,'objects'),{recursive:true});
 try{await cp(join(evidence.stateRoot,'runtime-receipts'),join(root,'runtime-receipts'),{recursive:true})}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 const projects=new ProjectStore(new FileStore(root)),projectId=evidence.input.projectId;
 const initial=await projects.store.readFresh<{ownerKeyHash:string;currentResultId?:string}>(`projects/${projectId}/control`),owner=initial.value.ownerKeyHash,bundle=evidence.bundle;
 const env={VIDEO_DATA_DIR:root,VIDEO_MEDIA_IMAGE_REF:'sha256:'+bundle.renderInputs.runtimeDigests.media,VIDEO_MEDIA_RUNTIME_DIGEST:bundle.renderInputs.runtimeDigests.media,VIDEO_MEDIA_TIMEOUT_SECONDS:'600'};
 process.env.VIDEO_DATA_DIR=root;
 let modelCalls=0;globalThis.fetch=async()=>{modelCalls++;throw Error('APPROVED_RENDER_NETWORK_FORBIDDEN')};
 const receipt=await approvePreview(projects,new LocalOperationQueue(projects.store,root),owner,projectId,{schemaVersion:5,clientCommandId:randomUUID(),previewId:bundle.previewId,revisionId:bundle.revisionId,expectedBriefVersion:bundle.briefVersion,bundleHash:bundle.bundleHash,scriptHash:bundle.scriptHash,factsHash:bundle.factsHash});
 if(!receipt.operationId)throw Error('APPROVED_RENDER_NOT_RESERVED');
 const claim=await claimOperation(projects.store,`projects/${projectId}/operations/${receipt.operationId}`,receipt.operationId);if(!claim.claimed)throw Error('APPROVED_RENDER_NOT_CLAIMED');
 const fence=(await projects.store.readFresh<{fence:number}>(`projects/${projectId}/operations/${receipt.operationId}`)).value.fence;
 const inputs=await loadApprovedRenderInputs(projects,owner,projectId,receipt.operationId,fence,{root,env});
 const record=await renderApprovedPictures(projects,owner,projectId,receipt.operationId,fence,{root,env});
 const replay=await renderApprovedPictures(new ProjectStore(new FileStore(root)),owner,projectId,receipt.operationId,fence,{root,env});
 if(canonicalHash(record)!==canonicalHash(replay)||modelCalls)throw Error('APPROVED_RENDER_REPLAY_CHANGED');
 const after=(await projects.store.readFresh<{currentResultId?:string;phase:string}>(`projects/${projectId}/control`)).value;
 if(after.currentResultId!==initial.value.currentResultId||after.phase!=='rendering')throw Error('APPROVED_RENDER_PREMATURE_PUBLICATION');
 const result={executedAt:new Date().toISOString(),status:'pass',root,projectId,operationId:receipt.operationId,approvalId:inputs.approval.approvalId,bundleHash:bundle.bundleHash,inputHash:inputs.inputHash,record,replayIdentical:true,additionalModelCalls:modelCalls,resultPublished:false,limits:'Isolated diagnostic approval of existing technical preview; real frozen source rendered at approved 1080p and independently decoded, then cold-replayed. No regeneration, original state mutation or model calls. Picture-only technical evidence; known style/readability failures remain, audio composition/full QA/delivery not passed.'};
 await writeFile('docs/engineering/evidence/approved-pictures-probe.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:'pass',root,technicalQa:record.sequence.technicalQa,replayIdentical:true,additionalModelCalls:modelCalls,resultPublished:false}));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
