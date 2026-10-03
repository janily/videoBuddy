import {readFile,writeFile} from 'node:fs/promises';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {composeApprovedFilm} from '../../src/services/video/render/composition';
import type {ProjectControl} from '../../src/contracts/video/project';
import type {PreviewBundle} from '../../src/services/video/preview/bundle';
async function main(){
 if(!process.argv.includes('--compose'))throw Error('APPROVED_COMPOSITION_OPT_IN_REQUIRED');
 const proof=JSON.parse(await readFile('docs/engineering/evidence/approved-pictures-probe.json','utf8')),projects=new ProjectStore(new FileStore(proof.root)),key=`projects/${proof.projectId}/control`;
 const before=(await projects.store.readFresh<ProjectControl>(key)).value;
 if(!before.currentPreviewId)throw Error('PREVIEW_REQUIRED');
 const bundle=(await projects.store.readFresh<PreviewBundle>(`projects/${proof.projectId}/previews/${before.currentPreviewId}/manifest`)).value,digest=bundle.renderInputs.runtimeDigests.media;
 const env={...process.env,VIDEO_DATA_DIR:proof.root,VIDEO_MEDIA_IMAGE_REF:'sha256:'+digest,VIDEO_MEDIA_RUNTIME_DIGEST:digest,VIDEO_MEDIA_TIMEOUT_SECONDS:'600'};
 let additionalModelCalls=0;globalThis.fetch=async()=>{additionalModelCalls++;throw Error('APPROVED_COMPOSITION_NETWORK_FORBIDDEN')};
 const record=await composeApprovedFilm(projects,before.ownerKeyHash,proof.projectId,proof.operationId,0,{root:proof.root,env});
 const replay=await composeApprovedFilm(new ProjectStore(new FileStore(proof.root)),before.ownerKeyHash,proof.projectId,proof.operationId,0,{root:proof.root,env});
 if(canonicalHash(record)!==canonicalHash(replay)||additionalModelCalls||canonicalHash(before)!==canonicalHash((await projects.store.readFresh<ProjectControl>(key)).value))throw Error('APPROVED_COMPOSITION_REPLAY_CHANGED');
 const result={executedAt:new Date().toISOString(),status:'pass',root:proof.root,projectId:proof.projectId,operationId:proof.operationId,approvalId:proof.approvalId,bundleHash:bundle.bundleHash,record,replayIdentical:true,controlUnchanged:true,additionalModelCalls,resultPublished:false,limits:'Actual approved frozen HTML and archived stereo music/foley mixed at full 1080p, independently decoded and loudness measured. Diagnostic copied approval; no regenerated content or model calls. Original spoken-name/visual style failures remain failures. This no-narration variant proves frozen audio reuse, not narrated post-mix ASR, full visual/listening quality or final delivery.'};
 await writeFile('docs/engineering/evidence/approved-composition-probe.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:'pass',technicalQa:record.movie.technicalQa,loudness:record.movie.loudness,postMix:record.postMix,replayIdentical:true,additionalModelCalls,resultPublished:false}));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
