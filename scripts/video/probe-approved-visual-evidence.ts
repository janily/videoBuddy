import {readFile,writeFile} from 'node:fs/promises';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {FileStore} from '../../src/services/video/storage/file-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {prepareApprovedVisualEvidence} from '../../src/services/video/render/visual-evidence';
import type {ProjectControl} from '../../src/contracts/video/project';
async function main(){
 if(!process.argv.includes('--extract'))throw Error('APPROVED_VISUAL_EVIDENCE_OPT_IN_REQUIRED');
 const proof=JSON.parse(await readFile('docs/engineering/evidence/approved-composition-probe.json','utf8')),projects=new ProjectStore(new FileStore(proof.root)),key=`projects/${proof.projectId}/control`,before=(await projects.store.readFresh<ProjectControl>(key)).value;
 const digest=proof.record.movie.loudness.runtimeDigest,env={VIDEO_DATA_DIR:proof.root,VIDEO_MEDIA_IMAGE_REF:'sha256:'+digest,VIDEO_MEDIA_RUNTIME_DIGEST:digest,VIDEO_MEDIA_TIMEOUT_SECONDS:'600'};
 let additionalModelCalls=0;globalThis.fetch=async()=>{additionalModelCalls++;throw Error('APPROVED_VISUAL_NETWORK_FORBIDDEN')};
 const first=await prepareApprovedVisualEvidence(projects,before.ownerKeyHash,proof.projectId,proof.operationId,0,{root:proof.root,env});
 const second=await prepareApprovedVisualEvidence(new ProjectStore(new FileStore(proof.root)),before.ownerKeyHash,proof.projectId,proof.operationId,0,{root:proof.root,env,mustExist:true});
 if(canonicalHash(first.record)!==canonicalHash(second.record)||additionalModelCalls||canonicalHash(before)!==canonicalHash((await projects.store.readFresh<ProjectControl>(key)).value))throw Error('APPROVED_VISUAL_REPLAY_CHANGED');
 const result={executedAt:new Date().toISOString(),status:'pass',root:proof.root,projectId:proof.projectId,operationId:proof.operationId,approvalId:proof.approvalId,filmSha256:first.baseline.filmSha256,record:first.record,replayIdentical:true,controlUnchanged:true,additionalModelCalls,visualQualityPassed:false,resultPublished:false,limits:'Actual approved 1080p movie decoded into two shifted overview rounds plus entire-shot action cadence and caption boundaries. Conservative whole-shot sampling because no frozen action-window declarations exist. Every PNG has an extractor receipt and actual byte hash. Evidence collection only; no critic, continuous-motion, listening or delivery pass. Historical style/name failures remain failures.'};
 await writeFile('docs/engineering/evidence/approved-visual-evidence-probe.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:'pass',filmSha256:result.filmSha256,rounds:first.record.plan.rounds.map(round=>({round:round.round,frames:round.frames.length,batches:round.batches.length})),replayIdentical:true,additionalModelCalls,visualQualityPassed:false,resultPublished:false}));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
